// Broadcast presentation for the Unity build (port of src/client/broadcast.ts + the presentation parts of game.ts):
// centre banners with the slide-in animation (Fx "ban"), two-part play-by-play captions (Fx "cm": "Curry pulls up..."
// then "BANG!" on the same caption) with optional voice (browser speechSynthesis through HoopsSpeech.jslib, WebGL only),
// pre-game player introductions (the browser shell's S == "intro": emulated here by holding the sim in "intro" right
// after a new game with an opening tip), the tip-off card, the momentum / timeouts / play-call bug, the shot timing card
// (Fx "tg"), gamepad rumble (Fx "shake", jslib), and halftime (Fx "half": S == "half" -> stats panel, then play on).
// Fx are fed in by GameMain.DrainFx -> Broadcast.OnFx (which also forwards to Hud). Drawing happens from Hud.OnGUI so
// the layer order matches game.ts overlay(). Commentary randomness uses UnityEngine.Random, never the sim's Rng.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using Hoops.Core;
using UnityEngine;
using static Hoops.Core.Sim;

namespace Hoops.Game
{
    [DefaultExecutionOrder(-50)] // see a new game (and hold it in "intro") before GameMain ticks the sim
    public sealed class Broadcast : MonoBehaviour
    {
        // settings (view.ts V.*), saved in PlayerPrefs
        public static bool VOICE = true, COMM = true, RUMBLE = true, INTRO = true;

#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] static extern int HoopsSpeak(string s, float rate, float pitch, float vol, int now);
        [DllImport("__Internal")] static extern void HoopsSpeechCancel();
        [DllImport("__Internal")] static extern void HoopsRumble(float v, int ms);
#else
        static int HoopsSpeak(string s, float rate, float pitch, float vol, int now) => 0;
        static void HoopsSpeechCancel() { }
        static void HoopsRumble(float v, int ms) { }
#endif

        void Awake()
        {
            try
            {
                VOICE = PlayerPrefs.GetInt("h2k_voice", 1) != 0;
                COMM = PlayerPrefs.GetInt("h2k_comm", 1) != 0;
                RUMBLE = PlayerPrefs.GetInt("h2k_rumble", 1) != 0;
                INTRO = PlayerPrefs.GetInt("h2k_intro", 1) != 0;
            }
            catch { }
            if (GetComponent<Hud>() == null) gameObject.AddComponent<Hud>();
            if (GetComponent<Music>() == null) gameObject.AddComponent<Music>();
        }

        // ================= banners =================
        struct Ban { public string s, sub; public Color c; public float t; }
        static readonly Ban[] BN = new Ban[3];
        static int bnN;
        public static void Banner(string s, string sub = "", string c = "#ffd23f")
        {
            if (string.IsNullOrEmpty(s)) return;
            if (bnN > 0 && BN[bnN - 1].s == s && BN[bnN - 1].t > 1.5f) return;
            if (bnN == BN.Length) { BN[0] = BN[1]; BN[1] = BN[2]; bnN--; }
            BN[bnN++] = new Ban { s = s, sub = sub ?? "", c = Ui.Hex(c ?? "#ffd23f"), t = 2.8f };
        }

        // ================= commentary =================
        delegate string Line(string n, string n2);
        static T Pick<T>(T[] a) => a[UnityEngine.Random.Range(0, a.Length)];
        static string L(string n2) => n2 == null ? "" : n2;
        static readonly Dictionary<string, Line[]> LINES = new()
        {
            ["three"] = new Line[] { (n, a) => $"{n} from downtown... BANG!", (n, a) => $"{n} knocks down the three!", (n, a) => !string.IsNullOrEmpty(a) ? $"{a} finds {n} — three ball, good!" : $"{n} buries it from deep!" },
            ["splash"] = new Line[] { (n, a) => $"SPLASH! {n} doesn't even touch the rim!", (n, a) => $"Nothing but nylon from {n}!" },
            ["two"] = new Line[] { (n, a) => $"{n} gets the bucket.", (n, a) => !string.IsNullOrEmpty(a) ? $"Nice feed from {a}, {n} finishes." : $"{n} scores.", (n, a) => $"{n} with the touch." },
            ["dunk"] = new Line[] { (n, a) => $"{n} THROWS IT DOWN!", (n, a) => $"Oh, {n} with the hammer!", (n, a) => !string.IsNullOrEmpty(a) ? $"{a} to {n} — SLAM!" : $"{n} rises and flushes it!" },
            ["dunkAnd1"] = new Line[] { (n, a) => $"{n} DUNKS IT THROUGH THE CONTACT! And one!" },
            ["and1"] = new Line[] { (n, a) => $"{n} scores and draws the foul! And one!", (n, a) => $"Count it — and the foul on the shot by {n}!" },
            ["run"] = new Line[] { (t, a) => $"{t} are on a run — somebody call timeout!", (t, a) => $"This building is rocking, {t} can't miss!" },
            ["clutch"] = new Line[] { (n, a) => "We're in clutch time. Every possession matters now.", (n, a) => "Crunch time — who wants the ball?" },
            ["timeout"] = new Line[] { (t, a) => $"Timeout on the floor, {t} need to regroup.", (t, a) => $"{t} call time to talk it over." },
            ["viol"] = new Line[] { (n, s) => $"Whistle — {L(s).ToLowerInvariant()}. Turnover." },
            ["foulout"] = new Line[] { (n, a) => $"That's six — {n} has fouled out." },
            ["flagrant"] = new Line[] { (n, n2) => $"Flagrant foul on {n}! That was a dangerous play on {n2}." },
            ["goaltend"] = new Line[] { (n, a) => $"Goaltending on {n} — the basket counts!" },
            ["charge"] = new Line[] { (n, n2) => $"{n} plants and takes the charge from {n2}!" },
            ["kick"] = new Line[] { (n, a) => $"Drive, kick, and {n} knocks it down! The defense couldn't recover.", (n, a) => $"Great ball movement — the help came and {n} made them pay.", (n, a) => $"Inside-out, and {n} buries it." },
            ["slip"] = new Line[] { (n, a) => $"{n} slips the screen and they're scrambling!", (n, a) => $"Nice read by {n} — he slips it before the hedge gets there." },
            ["tech"] = new Line[] { (n, a) => $"Technical foul on {n}. He did not like that call." },
            ["cold"] = new Line[] { (n, a) => $"{n} has gone ice cold.", (n, a) => $"{n} can't buy one right now." },
            ["assign"] = new Line[] { (n, n2) => $"{n} gets the call — he'll check {n2} now.", (n, n2) => $"Defensive switch: {n} picks up the hot hand, {n2}." },
            ["break"] = new Line[] { (n, k) => !string.IsNullOrEmpty(k) ? $"{n} has nothing but open floor ahead of him!" : $"{n} pushes it up the floor — they've got numbers!", (n, a) => $"Here comes {n} in transition!" },
            ["double"] = new Line[] { (t, n) => $"The {t} are sending two at {n} every time he touches it.", (t, n) => $"Here comes the double team on {n}!" },
            ["foulup3"] = new Line[] { (n, n2) => $"Up three, {n} fouls {n2} before he can get a three off — smart basketball." },
            ["zone"] = new Line[] { (t, a) => $"The {t} switch to a two-three zone. They're daring you to shoot.", (t, a) => $"Zone defense from the {t} — everybody packed in the paint." },
            ["adjust"] = new Line[] { (t, s) => $"The {t} bench makes an adjustment — {s}.", (t, s) => $"New look from the {t}: {s}.", (t, s) => $"The {t} change it up. The word is {s}." },
            ["board"] = new Line[] { (n, a) => $"{n} cleans the glass again." },
            ["chalWin"] = new Line[] { (t, a) => "The challenge is successful — call overturned!" },
            ["chalLose"] = new Line[] { (t, a) => $"The call stands. {t} lose the challenge." },
            ["fire"] = new Line[] { (n, a) => $"{n} is ON FIRE!" },
            ["block"] = new Line[] { (n, a) => $"REJECTED by {n}!", (n, a) => $"Get that outta here! {n} with the block!" },
            ["tipout"] = new Line[] { (n, m) => $"{n} keeps it alive, taps it out to {m}!" },
            ["intfoul"] = new Line[] { (n, a) => $"They're going to foul to stop the clock — {n} grabs him." },
            ["tip"] = new Line[] { (a, b) => $"Welcome in, everybody. {a} and {b}, and we are ready for the tip.", (a, b) => $"It's {a} against {b} tonight. Here's the jump ball." },
            ["half"] = new Line[] { (a, b) => "That's the half. Let's look at the numbers." },
        };
        static readonly Dictionary<string, Func<string, string>[]> RISE = new()
        {
            ["deep"] = new Func<string, string>[] { n => $"{n} from way downtown...", n => $"{n} from the logo...", n => $"{n}, are you serious, from there..." },
            ["three"] = new Func<string, string>[] { n => $"{n} for three...", n => $"{n} lets it fly...", n => $"{n} from deep..." },
            ["step"] = new Func<string, string>[] { n => $"{n} steps back...", n => $"{n}, the step-back..." },
            ["fade"] = new Func<string, string>[] { n => $"{n} turns, fades...", n => $"{n} on the fadeaway..." },
            ["float"] = new Func<string, string>[] { n => $"{n} floats one up...", n => $"{n} on the runner..." },
            ["pull"] = new Func<string, string>[] { n => $"{n} pulls up...", n => $"{n} stops and pops..." },
            ["mid"] = new Func<string, string>[] { n => $"{n} rises...", n => $"{n} for the jumper..." },
        };
        static readonly Dictionary<string, string[]> TAIL = new()
        {
            ["three"] = new[] { "BANG!", "GOT IT!", "COUNT IT!", "YES!" },
            ["splash"] = new[] { "SPLASH!", "Nothing but net!", "Wet!" },
            ["two"] = new[] { "Good!", "Got it.", "Money." },
            ["and1"] = new[] { "Good — and the foul!" },
            ["miss"] = new[] { "No good.", "Off the iron.", "Rims out.", "Short." },
            ["missO"] = new[] { "No good — but they get the board!", "Off the rim, tipped back!" },
        };
        static readonly HashSet<string> BIG = new() { "dunk", "dunkAnd1", "and1", "fire", "run", "clutch", "block", "flagrant", "goaltend", "foulout", "chalWin", "chalLose" };
        sealed class Cap { public string s; public float t; }
        static readonly Cap[] CAP = { new Cap(), new Cap() }; // CAP[0] older, CAP[1] newest
        static int capN;
        static Cap rise;
        static string riseN;
        static float riseAt;

        static Cap PushCap(string s)
        {
            if (capN == 2) { var o = CAP[0]; CAP[0] = CAP[1]; CAP[1] = o; capN = 1; }
            var c = CAP[capN++];
            c.s = s;
            c.t = 3.6f;
            return c;
        }

        /// <summary>Speak a line. now = cut off whatever is being said (a new play); hype = louder, faster, higher.</summary>
        static void Say(string s, bool now, float hype = 0)
        {
            if (!VOICE) return;
            try { HoopsSpeak(s, 1.1f + hype * 0.15f, 0.92f + hype * 0.22f, 0.85f + hype * 0.15f, now ? 1 : 0); } catch { }
        }

        public static void Comment(string e, string n = "", string n2 = "")
        {
            n ??= "";
            float t = Time.unscaledTime;
            if (e == "rise")
            {
                var L2 = RISE.TryGetValue(n2 ?? "", out var r) ? r : RISE["mid"];
                string s = Pick(L2)(n);
                rise = PushCap(s);
                riseN = n;
                riseAt = t;
                Say(s, true, n2 == "deep" ? 0.4f : 0);
                return;
            }
            // the result of the shot he just rose up with
            if (rise != null && riseN == n && t - riseAt < 4 && TAIL.TryGetValue(e, out var tail))
            {
                string s = Pick(tail);
                rise.s += " " + s;
                rise.t = 3.6f;
                rise = null;
                Say(s, false, e == "three" || e == "splash" ? 1 : e == "two" || e == "and1" ? 0.5f : 0);
                return;
            }
            if (e == "miss" || e == "missO") return; // misses only get called as the end of a call
            if (!LINES.TryGetValue(e, out var lines)) return;
            string line = Pick(lines)(n, n2 ?? "");
            PushCap(line);
            bool big = BIG.Contains(e);
            Say(line, big && e != "run" && e != "clutch", big ? 1 : 0);
        }

        // ================= timing grade =================
        static bool tgOn;
        static float tgT, tgOff, tgWin, tgC;
        static string tgG, tgOffS;
        static bool tgGr, tgHasC;

        static double D(Dictionary<string, object> o, string k)
        {
            if (o == null || !o.TryGetValue(k, out var v) || v == null) return 0;
            try { return Convert.ToDouble(v); } catch { return 0; }
        }
        static void TimingGrade(Fx f)
        {
            var o = f.o;
            tgOn = true;
            tgT = 2.6f;
            tgOff = (float)D(o, "off");
            tgWin = (float)D(o, "win");
            tgG = o != null && o.TryGetValue("g", out var g) ? Convert.ToString(g) : "?";
            tgGr = o != null && o.TryGetValue("gr", out var gr) && gr is bool b && b;
            tgHasC = o != null && o.ContainsKey("c") && o["c"] != null;
            tgC = (float)D(o, "c");
            tgOffS = tgOff == 0 ? "dead on" : Mathf.Abs(tgOff) + " ms " + (tgOff > 0 ? "late" : "early");
        }

        // ================= rumble =================
        public static void Rumble(double v, double ms = 160)
        {
            if (!RUMBLE) return;
            try { HoopsRumble((float)Math.Min(1, v), (int)ms); } catch { }
        }

        // ================= Fx =================
        /// <summary>Every sim effect goes through here once (GameMain.DrainFx).</summary>
        public static void OnFx(Fx f)
        {
            Hud.OnFx(f);
            switch (f.k)
            {
                case "ban":
                    Banner(f.s, f.sub, f.c);
                    if (f.s != null && (f.s.Contains("RUN") || f.s.Contains("CLUTCH"))) Music.Riff("stinger");
                    else if (f.s != null && f.s.Contains("TIMEOUT")) Music.Riff("letsgo");
                    break;
                case "cm":
                    Comment(f.e, f.n, f.n2);
                    if (f.e == "dunk" || f.e == "dunkAnd1" || f.e == "splash" || f.e == "three" || f.e == "block")
                    {
                        int me = CT.Count > 0 ? (int)CT[0].tm : 0;
                        foreach (var p in P) if (p.n == f.n && p.tm == me) { Music.Riff("stinger"); break; }
                    }
                    break;
                case "tg":
                    foreach (var c in CT)
                        if (c.idx >= 0 && c.idx < P.Count && P[(int)c.idx].n == f.n) { TimingGrade(f); break; }
                    break;
                case "shake":
                    Rumble(f.v, 120 + f.v * 200);
                    break;
                case "half":
                    if (cfg.ONLINE == 0 && cfg.GM == "game" && S == "play" && RPL == null) BeginHalftime();
                    break;
            }
        }

        // ================= frame tick =================
        static List<Player> lastP;
        static float introT, halfT;
        static bool introDone;
        static string introRec;

        void Update()
        {
            float dt = Time.unscaledDeltaTime;
            // a new game (start() rebuilds P): reset the broadcast, run the intros before an opening tip
            if (!ReferenceEquals(P, lastP))
            {
                lastP = P;
                Reset();
                if (S == "play" && JB != null && cfg.GM == "game" && cfg.ONLINE == 0 && INTRO && P != null && P.Count > 0) BeginIntro();
            }
            // bcTick
            for (int i = 0; i < bnN; i++) BN[i].t -= dt;
            while (bnN > 0 && BN[0].t <= 0) { for (int i = 1; i < bnN; i++) BN[i - 1] = BN[i]; bnN--; }
            if (tgOn && (tgT -= dt) <= 0) tgOn = false;
            for (int i = 0; i < capN; i++) CAP[i].t -= dt;
            while (capN > 0 && CAP[0].t <= 0) { var o = CAP[0]; CAP[0] = CAP[1]; CAP[1] = o; capN--; }

            bool skip = UnityEngine.Input.GetKeyDown(KeyCode.Return) || UnityEngine.Input.GetKeyDown(KeyCode.KeypadEnter) || UnityEngine.Input.GetMouseButtonDown(0);
            if (S == "intro")
            {
                introT += dt;
                setT(T + dt); // the arena keeps breathing (idle animation clocks)
                if (introT >= IntroLen() || skip || UnityEngine.Input.GetKeyDown(KeyCode.Escape)) EndIntro();
            }
            else if (S == "half")
            {
                halfT += dt;
                setT(T + dt);
                if (halfT >= HALF_LEN || (halfT > 0.6f && skip)) EndHalftime();
            }
        }

        static void Reset()
        {
            bnN = capN = 0;
            rise = null;
            tgOn = false;
            Hud.ClearTexts();
            introDone = false;
            try { HoopsSpeechCancel(); } catch { }
        }

        // ================= pre-game player introductions =================
        static readonly string[] POSN = { "POINT GUARD", "SHOOTING GUARD", "SMALL FORWARD", "POWER FORWARD", "CENTER" };
        const float INTRO_TITLE = 1.8f;
        static float CardT() => cfg.NP > 1 ? 0.8f : 1.8f;
        static float IntroLen() => INTRO_TITLE + P.Count * CardT() + 0.4f;
        sealed class Card { public string no, head, name, line, foot; public string[] bad; public Color col; }
        static readonly Dictionary<Player, Card> cards = new();
        static string[] tipLines;
        static string vsName0, vsName1;

        static void BeginIntro()
        {
            setS("intro");
            introT = 0;
            introDone = true;
            string[] DIFFN = { "ROOKIE", "PRO", "ALL-STAR", "HALL OF FAME" };
            int w = 0, l = 0;
            try { w = PlayerPrefs.GetInt("h2k_rec_w", 0); l = PlayerPrefs.GetInt("h2k_rec_l", 0); } catch { }
            introRec = $"{cl[0]} vs {cl[1]} · {cfg.NP}-on-{cfg.NP} · {DIFFN[Mathf.Clamp(cfg.DIFF, 0, 3)]} · your record {w}-{l}";
            Prepare();
        }
        /// <summary>All intro / tip-card strings once per game (the draw calls then allocate nothing).</summary>
        static void Prepare()
        {
            cards.Clear();
            int NP = cfg.NP;
            vsName0 = (cl[0] ?? "").ToUpperInvariant();
            vsName1 = (cl[1] ?? "").ToUpperInvariant();
            tipLines = new string[P.Count];
            for (int i = 0; i < P.Count; i++)
            {
                var p = P[i];
                var bs = badgesOf(p);
                double ft = Math.Floor(p.ht);
                var c = new Card
                {
                    no = Ui.Num(p.no),
                    head = (NP >= 5 ? (p.k >= 0 && p.k < 5 ? POSN[(int)p.k] : "") : "STARTING") + " · " + (cl[(int)p.tm] ?? "").ToUpperInvariant() + (p.tm == 0 ? " (YOU)" : ""),
                    name = (p.n ?? "").ToUpperInvariant() is var u && u.Length > 15 ? u.Substring(0, 15) : (p.n ?? "").ToUpperInvariant(),
                    line = $"OVR {ovr(p)} · {ft}'{Math.Round((p.ht - ft) * 12)}\" · 3PT {p.c} · INS {p.i} · DEF {p.d}",
                    foot = "STARTING " + (NP > 1 ? "FIVE" : "TONIGHT"),
                    col = Ui.Hex(string.IsNullOrEmpty(p.col) ? PC[(int)p.tm] : p.col),
                };
                int nb = Math.Min(3, bs.Count);
                c.bad = new string[nb];
                for (int k = 0; k < nb; k++) c.bad[k] = "★ " + BADGE[bs[k]].name.ToUpperInvariant();
                cards[p] = c;
                tipLines[i] = $"#{p.no} {p.n}  ·  {ovr(p)}" + (bs.Count > 0 ? "  ★" + bs.Count : "");
            }
        }
        static void EndIntro()
        {
            if (S != "intro") return;
            setS("play");
            Comment("tip", cl[0], cl[1]);
            Music.Riff("charge");
        }

        // ================= halftime =================
        const float HALF_LEN = 14;
        static string[] halfRows;
        static string halfQ1a, halfQ1b, halfQ2a, halfQ2b, halfTa, halfTb, halfNote;
        static List<string> halfAdj;
        struct Bar { public string k, a, b; public float wa, wb; }
        static Bar[] halfBars;

        static void BeginHalftime()
        {
            setS("half");
            halfT = 0;
            Comment("half");
            Banner("HALFTIME", "FIRST-HALF NUMBERS", "#ffd23f");
            Music.Riff("charge");
            // the numbers (computed once)
            var qs = TS.qs;
            double[] q1 = qs.Count > 0 ? qs[0] : new double[] { 0, 0 };
            halfQ1a = Ui.Num(q1[0]); halfQ1b = Ui.Num(q1[1]);
            halfQ2a = Ui.Num(sc[0] - q1[0]); halfQ2b = Ui.Num(sc[1] - q1[1]);
            halfTa = Ui.Num(sc[0]); halfTb = Ui.Num(sc[1]);
            double Sum(int t, Func<Stats, double> f) { double a = 0; foreach (var p in ROST[t]) a += f(p.stt); return a; }
            int Pc(double m, double a) => a > 0 ? (int)Math.Round(100 * m / a) : 0;
            var bars = new List<Bar>();
            void Add(string k, double a, double b, string u = "")
            {
                double t = a + b;
                if (t <= 0) t = 1;
                bars.Add(new Bar { k = k, a = Ui.Num(a) + u, b = Ui.Num(b) + u, wa = (float)(a / t), wb = (float)(b / t) });
            }
            Add("FG%", Pc(Sum(0, s => s.fgm), Sum(0, s => s.fga)), Pc(Sum(1, s => s.fgm), Sum(1, s => s.fga)), "%");
            Add("3PT", Sum(0, s => s.tpm), Sum(1, s => s.tpm));
            Add("REBOUNDS", Sum(0, s => s.reb), Sum(1, s => s.reb));
            Add("ASSISTS", Sum(0, s => s.ast), Sum(1, s => s.ast));
            Add("BLOCKS", Sum(0, s => s.blk), Sum(1, s => s.blk));
            Add("PAINT PTS", TS.xs.paint[0], TS.xs.paint[1]);
            Add("FAST BREAK", TS.xs.fb[0], TS.xs.fb[1]);
            Add("2ND CHANCE", TS.xs.sec[0], TS.xs.sec[1]);
            Add("HUSTLE", Sum(0, s => s.orb + s.chg + s.dv), Sum(1, s => s.orb + s.chg + s.dv));
            halfBars = bars.ToArray();
            Player Top(int t, Func<Stats, double> f)
            {
                Player b = null;
                foreach (var p in ROST[t]) if (b == null || f(p.stt) > f(b.stt)) b = p;
                return b;
            }
            string Row(Func<Stats, double> f, string l)
            {
                var a = Top(0, f);
                var b = Top(1, f);
                return $"{a?.n} {(a != null ? f(a.stt) : 0)}   {l}   {(b != null ? f(b.stt) : 0)} {b?.n}";
            }
            halfRows = new[] { Row(s => s.pts, "POINTS"), Row(s => s.reb, "REBOUNDS"), Row(s => s.ast, "ASSISTS") };
            double d = sc[0] - sc[1];
            halfNote = d == 0 ? "All square at the break." : $"{cl[d > 0 ? 0 : 1]} lead by {Math.Abs(d)} at the half.";
            halfAdj = halftimeAdjust(); // CPU game plans change at the half (like game.ts halfStats)
        }
        static void EndHalftime()
        {
            if (S != "half") return;
            setS("play");
            Music.Riff("charge");
        }

        // ================= drawing (called from Hud.OnGUI) =================
        static readonly Color PLATE = new Color(8 / 255f, 10 / 255f, 24 / 255f, 0.86f);
        static readonly Color GOLD = new Color(1, 0.82f, 0.25f), SOFT = new Color(0.81f, 0.84f, 0.93f);

        /// <summary>Team colours can be very dark: lift them so the subtitle reads on the dark plate.</summary>
        static Color Light(Color c)
        {
            float l = (0.299f * c.r + 0.587f * c.g + 0.114f * c.b) * 255;
            if (l > 140) return c;
            float k = 150 / Mathf.Max(1, l);
            return new Color(Mathf.Min(1, c.r * k + 60 / 255f), Mathf.Min(1, c.g * k + 60 / 255f), Mathf.Min(1, c.b * k + 60 / 255f), c.a);
        }

        public static void DrawBanners()
        {
            float s = Ui.s;
            if (bnN > 0)
            {
                var b = BN[0];
                float life = 2.8f - b.t, a = Mathf.Min(1, Mathf.Min(life * 5, b.t * 3)), sl = Mathf.Max(0, 1 - life * 4) * 140;
                bool sub = !string.IsNullOrEmpty(b.sub);
                float tw = Ui.Measure(b.s, 28) / s, sw = sub ? Ui.Measure(b.sub, 13) / s : 0,
                    w = Mathf.Min(900, Mathf.Max(400, Mathf.Max(tw + 60, sw + 50))), x0 = 484 - w / 2 - sl, h = sub ? 64 : 46;
                Ui.RFill(Ui.X(x0), Ui.Y(132), w * s, h * s, 8 * s, Ui.A(PLATE, a));
                Ui.Fill(Ui.X(x0), Ui.Y(132), 8 * s, h * s, Ui.A(b.c, a));
                Ui.Text(b.s, Ui.X(484 - sl), Ui.Y(165), 28, Color.white, 0, FontStyle.Bold, a);
                if (sub) Ui.Text(b.sub, Ui.X(484 - sl), Ui.Y(186), 13, Light(b.c), 0, FontStyle.Bold, a);
            }
            // commentary lower third
            if (COMM)
                for (int k = 0; k < capN; k++)
                {
                    var c = CAP[k];
                    float a = Mathf.Min(1, Mathf.Min(c.t * 2, (3.6f - c.t) * 6)), y = 482 - (capN - 1 - k) * 22;
                    float w = Ui.Measure(c.s, 14, FontStyle.BoldAndItalic) + 34 * s;
                    Ui.RFill(Ui.XL(12), Ui.Y(y - 15), w, 20 * s, 5 * s, new Color(0, 0, 0, 0.6f * a));
                    Ui.Fill(Ui.XL(18), Ui.Y(y - 11), 3 * s, 12 * s, Ui.A(GOLD, a)); // the mic tag
                    Ui.Text(c.s, Ui.XL(28), Ui.Y(y), 14, new Color(0.91f, 0.93f, 0.99f), -1, FontStyle.BoldAndItalic, a);
                }
        }

        public static void DrawTiming()
        {
            if (!tgOn) return;
            float s = Ui.s, a = Mathf.Min(1, tgT * 2), x0 = 14, y0 = 400, w = 220, span = Mathf.Max(tgWin * 3, Mathf.Abs(tgOff) + 40);
            float Px(float ms) => x0 + w / 2 + ms / span * (w / 2);
            Ui.RFill(Ui.XL(x0 - 6), Ui.Y(y0 - 30), (w + 12) * s, 54 * s, 8 * s, new Color(8 / 255f, 10 / 255f, 24 / 255f, 0.82f * a));
            Ui.Fill(Ui.XL(x0), Ui.Y(y0), w * s, 8 * s, new Color(1, 1, 1, 0.15f * a));
            Ui.Fill(Ui.XL(Px(-tgWin)), Ui.Y(y0), (Px(tgWin + 30) - Px(-tgWin)) * s, 8 * s, Ui.A(Hud.CB ? Ui.Hex("#4ea8ff") : Ui.Hex("#2ecc71"), a)); // green window (+ a little late slack)
            Ui.Fill(Ui.XL(Px(0) - 1), Ui.Y(y0 - 3), 2 * s, 14 * s, new Color(1, 1, 1, a)); // perfect
            float mx = Mathf.Clamp(Px(tgOff), x0, x0 + w);
            Ui.Quad(Ui.XL(mx), Ui.Y(y0 - 2), Ui.XL(mx - 6), Ui.Y(y0 - 11), Ui.XL(mx + 6), Ui.Y(y0 - 11), Ui.XL(mx), Ui.Y(y0 - 2), Ui.A(tgGr ? GOLD : Ui.Hex("#ff6b4a"), a));
            Ui.Text(tgG != null ? GradeStr(tgG) : "", Ui.XL(x0), Ui.Y(y0 - 14), 15, tgGr ? GOLD : Ui.Hex("#ff6b4a"), -1, FontStyle.Bold, a);
            Ui.Text(tgOffS, Ui.XL(x0 + w), Ui.Y(y0 - 14), 11, SOFT, 1, FontStyle.Bold, a);
            Ui.Text("EARLY · PERFECT · LATE", Ui.XL(x0 + w / 2), Ui.Y(y0 + 20), 11, SOFT, 0, FontStyle.Bold, a);
            if (tgHasC)
            {
                float c = tgC;
                string lb = c < 15 ? "WIDE OPEN" : c < 35 ? "OPEN" : c < 65 ? "CONTESTED" : "SMOTHERED";
                var col = Ui.Hex(c < 15 ? "#7CFC7C" : c < 35 ? "#c8f07a" : c < 65 ? "#ffb347" : "#ff6b4a");
                Ui.Text(lb, Ui.XL(x0 + w / 2), Ui.Y(y0 - 14), 12, col, 0, FontStyle.Bold, a);
            }
        }
        static readonly Dictionary<string, string> grades = new();
        static string GradeStr(string g) => grades.TryGetValue(g, out var s) ? s : grades[g] = "GRADE " + g;

        /// <summary>Under the score bug: timeouts left (dots), momentum meter, your defense / play call / keys.</summary>
        static string bugS, momS0, momS1;
        static long bugK = -1;
        public static void DrawBug(int me)
        {
            if (!gameLike() || cfg.HALF != 0) return;
            float s = Ui.s;
            for (int t = 0; t < 2; t++)
                for (int k = 0; k < 4; k++)
                    Ui.Fill(Ui.X((t != 0 ? 590 : 310) + k * 16), Ui.Y(62), 11 * s, 3 * s, k < TS.to[t] ? GOLD : new Color(1, 1, 1, 0.18f));
            float m = Mathf.Clamp((float)TS.mom, -1, 1);
            Ui.Fill(Ui.X(400), Ui.Y(70), 160 * s, 6 * s, new Color(0, 0, 0, 0.6f));
            var mc = Ui.Hex(m >= 0 ? PC[0] : PC[1]);
            if (m >= 0) Ui.Fill(Ui.X(480), Ui.Y(70), m * 80 * s, 6 * s, mc);
            else Ui.Fill(Ui.X(480 + m * 80), Ui.Y(70), -m * 80 * s, 6 * s, mc);
            Ui.Fill(Ui.X(479), Ui.Y(68), 2 * s, 10 * s, Color.white);
            if (Mathf.Abs(m) > 0.5f)
            {
                momS0 ??= "MOMENTUM " + (cl[0] ?? "").ToUpperInvariant();
                momS1 ??= "MOMENTUM " + (cl[1] ?? "").ToUpperInvariant();
                Ui.Text(m > 0 ? momS0 : momS1, Ui.X(480), Ui.Y(90), 10, Ui.Hex("#ffb347"));
            }
            if (me >= 0 && CT.Count > 0 && cfg.NP > 1)
            {
                bool av = TS.call != null && TS.call.t == me && TS.chal[me] > 0;
                long k = (long)TS.ds[me] * 100 + (long)TS.pc[me] * 10 + (av ? 1 : 0);
                if (k != bugK)
                {
                    bugK = k;
                    bugS = $"DEF {DSN[(int)TS.ds[me]]} · PLAY {PCN[(int)TS.pc[me]]}  [Z]   TIMEOUT [Y] · CHALLENGE [H]{(av ? " ← available!" : "")}";
                }
                Ui.Text(bugS, Ui.XL(12), Ui.Y(506), 11, new Color(1, 1, 1, 0.75f), -1);
            }
        }

        /// <summary>The intro sequence: title card, then one card per starter (away team first, you last).</summary>
        public static void DrawPlayerIntro()
        {
            if (P.Count == 0) return;
            float s = Ui.s, t = introT;
            Ui.Fill(0, 0, Screen.width, Screen.height, new Color(4 / 255f, 6 / 255f, 16 / 255f, 0.55f));
            if (t < INTRO_TITLE)
            {
                float a = Mathf.Min(1, Mathf.Min(t * 3, (INTRO_TITLE - t) * 4));
                Ui.Text("TONIGHT · LIVE FROM THE ARENA", Ui.X(480), Ui.Y(190), 16, GOLD, 0, FontStyle.Bold, a);
                for (int k = 0; k < 2; k++)
                {
                    float x = k != 0 ? 690 : 270, sl = Mathf.Min(1, t * 2.5f), off = (k != 0 ? 1 - sl : sl - 1) * 120;
                    Ui.RFill(Ui.X(x - 170 + off), Ui.Y(215), 340 * s, 96 * s, 12 * s, Ui.A(Ui.Hex(PC[k]), a));
                    Ui.Text(k == 0 ? vsName0 : vsName1, Ui.X(x + off), Ui.Y(275), 40, Color.white, 0, FontStyle.Bold, a);
                }
                Ui.Text("VS", Ui.X(480), Ui.Y(275), 34, Color.white, 0, FontStyle.BoldAndItalic, a);
                Ui.Text(introRec, Ui.X(480), Ui.Y(345), 13, SOFT, 0, FontStyle.Bold, a);
            }
            else
            {
                float ct = CardT();
                int NP = cfg.NP, i = Mathf.Min(P.Count - 1, Mathf.FloorToInt((t - INTRO_TITLE) / ct));
                var p = i < NP ? (NP + i < P.Count ? P[NP + i] : null) : P[i - NP];
                float lt = t - INTRO_TITLE - i * ct, a = Mathf.Min(1, Mathf.Min(lt * 6, Mathf.Max(0, ct - lt) * 6)), sl = Mathf.Max(0, 1 - lt * 5) * 80;
                if (p != null && cards.TryGetValue(p, out var c))
                {
                    bool home = p.tm == 0;
                    float x0 = 200 + (home ? -sl : sl);
                    Ui.RFill(Ui.X(x0), Ui.Y(160), 560 * s, 210 * s, 14 * s, new Color(8 / 255f, 10 / 255f, 24 / 255f, 0.92f * a));
                    Ui.RFill(Ui.X(x0), Ui.Y(160), 190 * s, 210 * s, 14 * s, Ui.A(c.col, a));
                    Ui.Text(c.no, Ui.X(x0 + 95), Ui.Y(305), 110, new Color(1, 1, 1, 0.95f), 0, FontStyle.Bold, a);
                    Ui.Text(c.head, Ui.X(x0 + 215), Ui.Y(200), 14, GOLD, -1, FontStyle.Bold, a);
                    Ui.Text(c.name, Ui.X(x0 + 215), Ui.Y(248), 40, Color.white, -1, FontStyle.Bold, a);
                    Ui.Text(c.line, Ui.X(x0 + 215), Ui.Y(282), 15, SOFT, -1, FontStyle.Bold, a);
                    float bx = x0 + 215;
                    foreach (var b in c.bad)
                    {
                        float bw = Ui.Measure(b, 12) / s + 16;
                        Ui.RFill(Ui.X(bx), Ui.Y(305), bw * s, 24 * s, 6 * s, new Color(1, 0.82f, 0.25f, 0.15f * a));
                        Ui.Text(b, Ui.X(bx + 8), Ui.Y(322), 12, GOLD, -1, FontStyle.Bold, a);
                        bx += bw + 8;
                    }
                    if (c.bad.Length == 0) Ui.Text(c.foot, Ui.X(x0 + 215), Ui.Y(322), 12, new Color(1, 1, 1, 0.4f), -1, FontStyle.Bold, a);
                }
            }
            Ui.Text("ENTER / ESC / click to skip", Ui.X(480), Ui.Y(500), 12, new Color(1, 1, 1, 0.6f));
        }

        /// <summary>Tip-off card: both starting lineups with OVRs while the centres walk in (when the intros were skipped).</summary>
        public static void DrawTipCard()
        {
            if (JB == null || JB.t > 2.4 || P.Count == 0 || cfg.GM != "game" || introDone) return;
            if (tipLines == null || tipLines.Length != P.Count) Prepare();
            float s = Ui.s, a = Mathf.Min(1, Mathf.Min((float)JB.t * 4, (2.4f - (float)JB.t) * 3));
            int NP = cfg.NP;
            Ui.RFill(Ui.X(160), Ui.Y(120), 640 * s, (64 + NP * 22) * s, 10 * s, new Color(6 / 255f, 8 / 255f, 20 / 255f, 0.85f * a));
            for (int t = 0; t < 2; t++)
            {
                float x0 = t != 0 ? 640 : 320;
                Ui.Fill(Ui.X(t != 0 ? 480 : 160), Ui.Y(120), 320 * s, 5 * s, Ui.A(Ui.Hex(PC[t]), a));
                Ui.Text(t == 0 ? vsName0 : vsName1, Ui.X(x0), Ui.Y(152), 22, Color.white, 0, FontStyle.Bold, a);
                for (int k = 0; k < NP; k++)
                {
                    int i = t * NP + k;
                    if (i < tipLines.Length) Ui.Text(tipLines[i], Ui.X(x0), Ui.Y(176 + k * 22), 13, SOFT, 0, FontStyle.Normal, a);
                }
            }
            Ui.Text("VS", Ui.X(480), Ui.Y(152), 18, GOLD, 0, FontStyle.Bold, a);
        }

        /// <summary>Halftime panel over the arena: quarter scores, team comparison bars, leaders, CPU adjustments, shot charts.</summary>
        public static void DrawHalftime()
        {
            if (halfBars == null) return;
            float s = Ui.s, a = Mathf.Min(1, halfT * 3, (HALF_LEN - halfT) * 3);
            Color c0 = Ui.Hex(PC[0]), c1 = Ui.Hex(PC[1]);
            Ui.RFill(Ui.X(150), Ui.Y(84), 660 * s, 432 * s, 14 * s, new Color(6 / 255f, 8 / 255f, 20 / 255f, 0.9f * a));
            Ui.Text("HALFTIME", Ui.X(480), Ui.Y(124), 32, GOLD, 0, FontStyle.Bold, a);
            // score line
            Ui.Fill(Ui.X(170), Ui.Y(138), 6 * s, 30 * s, Ui.A(c0, a));
            Ui.Fill(Ui.X(784), Ui.Y(138), 6 * s, 30 * s, Ui.A(c1, a));
            Ui.Text(vsName0, Ui.X(186), Ui.Y(162), 18, Color.white, -1, FontStyle.Bold, a);
            Ui.Text(vsName1, Ui.X(774), Ui.Y(162), 18, Color.white, 1, FontStyle.Bold, a);
            Ui.Text(halfTa, Ui.X(440), Ui.Y(164), 28, Color.white, 1, FontStyle.Bold, a);
            Ui.Text("—", Ui.X(480), Ui.Y(162), 20, SOFT, 0, FontStyle.Bold, a);
            Ui.Text(halfTb, Ui.X(520), Ui.Y(164), 28, Color.white, -1, FontStyle.Bold, a);
            // quarter table
            Ui.Text("Q1", Ui.X(420), Ui.Y(190), 11, SOFT, 0, FontStyle.Bold, a);
            Ui.Text("Q2", Ui.X(480), Ui.Y(190), 11, SOFT, 0, FontStyle.Bold, a);
            Ui.Text("HALF", Ui.X(540), Ui.Y(190), 11, SOFT, 0, FontStyle.Bold, a);
            Ui.Text(vsName0, Ui.X(380), Ui.Y(207), 12, Color.white, 1, FontStyle.Bold, a);
            Ui.Text(halfQ1a, Ui.X(420), Ui.Y(207), 12, Color.white, 0, FontStyle.Normal, a);
            Ui.Text(halfQ2a, Ui.X(480), Ui.Y(207), 12, Color.white, 0, FontStyle.Normal, a);
            Ui.Text(halfTa, Ui.X(540), Ui.Y(207), 12, GOLD, 0, FontStyle.Bold, a);
            Ui.Text(vsName1, Ui.X(380), Ui.Y(223), 12, Color.white, 1, FontStyle.Bold, a);
            Ui.Text(halfQ1b, Ui.X(420), Ui.Y(223), 12, Color.white, 0, FontStyle.Normal, a);
            Ui.Text(halfQ2b, Ui.X(480), Ui.Y(223), 12, Color.white, 0, FontStyle.Normal, a);
            Ui.Text(halfTb, Ui.X(540), Ui.Y(223), 12, GOLD, 0, FontStyle.Bold, a);
            // comparison bars
            for (int i = 0; i < halfBars.Length; i++)
            {
                var b = halfBars[i];
                float y = 244 + i * 17, bw = 172, bx = 388;
                Ui.Text(b.a, Ui.X(380), Ui.Y(y + 10), 12, Color.white, 1, FontStyle.Bold, a);
                Ui.Fill(Ui.X(bx), Ui.Y(y), bw * s, 12 * s, new Color(1, 1, 1, 0.08f * a));
                Ui.Fill(Ui.X(bx), Ui.Y(y), bw * b.wa * s, 12 * s, Ui.A(c0, a * 0.85f));
                Ui.Fill(Ui.X(bx + bw * (1 - b.wb)), Ui.Y(y), bw * b.wb * s, 12 * s, Ui.A(c1, a * 0.85f));
                Ui.Text(b.k, Ui.X(bx + bw / 2), Ui.Y(y + 9.5f), 9, Color.white, 0, FontStyle.Bold, a);
                Ui.Text(b.b, Ui.X(568), Ui.Y(y + 10), 12, Color.white, -1, FontStyle.Bold, a);
            }
            // leaders
            for (int i = 0; i < halfRows.Length; i++) Ui.Text(halfRows[i], Ui.X(480), Ui.Y(418 + i * 16), 12, Color.white, 0, FontStyle.Normal, a);
            Ui.Text(halfNote, Ui.X(480), Ui.Y(472), 12, GOLD, 0, FontStyle.Italic, a);
            if (halfAdj != null)
                for (int i = 0; i < halfAdj.Count && i < 2; i++) Ui.Text(halfAdj[i], Ui.X(480), Ui.Y(487 + i * 13), 11, SOFT, 0, FontStyle.Italic, a);
            ShotChart(0, Ui.X(162), Ui.Y(244), 140 * s, a);
            ShotChart(1, Ui.X(658), Ui.Y(244), 140 * s, a);
            Ui.Text("ENTER for the 3rd quarter", Ui.X(480), Ui.Y(511), 12, new Color(1, 1, 1, 0.6f));
        }

        /// <summary>game.ts shotChart: a team's half court (baseline at the top), makes = team-colour dots, misses = x. Q1-2.</summary>
        static void ShotChart(int t, float x, float y, float w, float a)
        {
            float k = w / 500f, rx = x + w / 2, h = 300 * k, hy = y + 52.5f * k; // hy = the rim
            Ui.RFill(x, y, w, h, 6 * Ui.s, new Color(27 / 255f, 31 / 255f, 54 / 255f, a));
            var ln = new Color(1, 1, 1, 0.35f * a);
            float lw = Mathf.Max(1, Ui.s * 0.6f);
            // lane, free-throw circle, three-point line, rim
            Ui.Line(rx - 80 * k, y, rx - 80 * k, y + 190 * k, lw, ln);
            Ui.Line(rx + 80 * k, y, rx + 80 * k, y + 190 * k, lw, ln);
            Ui.Line(rx - 80 * k, y + 190 * k, rx + 80 * k, y + 190 * k, lw, ln);
            Ui.Arc(rx, y + 190 * k, 60 * k, 60 * k, 0, Mathf.PI, lw, ln);
            float ac = Mathf.Acos(220 / 237.5f), r3 = 237.5f * k;
            Ui.Line(rx - 220 * k, y, rx - 220 * k, hy + Mathf.Sin(ac) * r3, lw, ln);
            Ui.Line(rx + 220 * k, y, rx + 220 * k, hy + Mathf.Sin(ac) * r3, lw, ln);
            Ui.Arc(rx, hy, r3, r3, ac, Mathf.PI - ac, lw, ln);
            Ui.Arc(rx, hy, 7.5f * k, 7.5f * k, 0, 6.2832f, lw * 1.5f, Ui.A(Ui.Hex("#ff8a3a"), a));
            double hx = hoop(t);
            var tc = Ui.A(Light(Ui.Hex(PC[t])), a);
            var mc = new Color(1, 0.45f, 0.4f, 0.85f * a);
            float d = 2.2f * Ui.s * 0.8f;
            foreach (var sh in SHOTS)
            {
                if (sh.t != t || sh.q > 2) continue;
                float sx = Mathf.Clamp(rx + (float)(sh.y - 250) * k, x + 3, x + w - 3),
                    sy = Mathf.Min(hy + (float)Math.Abs(sh.x - hx) * k, y + h - 3);
                if (sh.m != 0) Ui.Dot(sx, sy, 2 * d, tc);
                else
                {
                    Ui.Line(sx - d, sy - d, sx + d, sy + d, lw, mc);
                    Ui.Line(sx - d, sy + d, sx + d, sy - d, lw, mc);
                }
            }
        }
    }
}
