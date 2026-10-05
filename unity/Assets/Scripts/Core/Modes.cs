// Port of src/core/modes.ts. Game modes on top of the core sim (DOM-free): Practice, Tutorial, 3-Point Contest, Dunk
// Contest, HORSE and Clutch Challenges (+ Street / King / All-Star / Daily). They drive the normal sim through
// HOOK.pre/post: unused players are parked off the floor (p.off), the clocks are frozen, shots are watched until they
// resolve, and results go to the shell as FX {k:"mode"} (payload in Fx.o: "ev", "kind", "res", ...).
using System;
using System.Collections.Generic;
using static Hoops.Core.Util;
using static Hoops.Core.Data;
using static Hoops.Core.Sim;
using static Hoops.Core.Pose;

namespace Hoops.Core
{
    public partial class Player
    {
        public double horseT; // HORSE: the CPU shooter borrowed team 0's basket (stopMode gives him back to team 1)
    }

    /// <summary>watchShot memory (M.w).</summary>
    public sealed class ShotWatch
    {
        public double live, t, lc, sv, spd;
        public bool dunk, three, green, perf;
    }

    /// <summary>watchShot result.</summary>
    public sealed class ShotResult
    {
        public bool made, dunk, three, green, perf;
    }

    /// <summary>Practice shot lab: makes and summed timing offset per zone.</summary>
    public sealed class ZoneStat { public double a, m, off; }

    public sealed class PracticeStats
    {
        public double att, made, gr, streak, best, tpm;
        public Dictionary<int, ZoneStat> z = new Dictionary<int, ZoneStat>(); // TS sparse array indexed by tg.z
    }

    /// <summary>A contest field entry (3pt: c rating, dunk: j rating; s = their score).</summary>
    public sealed class FieldEntry
    {
        public string n;
        public double c, j, s;
    }

    public sealed class ClutchSpec
    {
        public string n, d, goal;
        public double me, op, t, pos;
        public ClutchSpec(string n, string d, double me, double op, double t, double pos, string goal)
        {
            this.n = n; this.d = d; this.me = me; this.op = op; this.t = t; this.pos = pos; this.goal = goal;
        }
        public ClutchSpec Clone() => (ClutchSpec)MemberwiseClone();
    }

    public sealed class DailySpec
    {
        public double seed, me, op;
        public ClutchSpec c;
    }

    public sealed class BeginOpts
    {
        public double np, half, to, astar;
    }

    /// <summary>The mode state (TS `M: any`).</summary>
    public sealed class ModeState
    {
        public string kind = "";
        public int np0;
        public double t, done;
        public ShotWatch w;
        // king
        public List<int> ladder;
        public double kme, rung;
        // dunk: the shooter's real jump rating, restored by stopMode
        public double? jb;
        public Player jbP;
        // practice / tutorial
        public PracticeStats st;
        public double step, mvd, spr, fb;
        // 3pt
        public double rack, ball, pts, time, wait;
        public double[] racks;
        public List<double> shots;
        public List<FieldEntry> field;
        // dunk
        public double dunk, tries, style, last, spd;
        public List<double> scores;
        public double finT; // the TS setTimeout(finish, 1800) as a sim-time countdown
        // horse
        public Player[] pl;
        public double[] let;
        public double setter;
        public string ph;
        public double[] spot;
        public Input cin;
        public Player cur;
        public double ct, rel;
        // clutch / daily
        public double ci;
        public string goal;
        public DailySpec daily;
    }

    public static partial class Modes
    {
        public static readonly ModeState M = new ModeState();

        public static void PARK(Player p, double k)
        {
            p.off = 1;
            p.x = 300 + k * 30;
            p.y = -400;
            p.z = p.vx = p.vy = p.vz = 0;
            p.mode = "i";
        }
        public static void unpark(Player p, double x, double y)
        {
            p.off = 0;
            p.x = x;
            p.y = y;
            p.vx = p.vy = p.vz = p.z = 0;
            p.mode = "i";
            p.t = 0;
            p.f = Math.Atan2(HY - y, hoop(p.tm) - x);
        }
        public static void give(Player p)
        {
            var B = Sim.B;
            B.owner = p;
            B.mode = "held";
            B.sh = 0;
            B.sc = 0;
            B.to = null;
            B.last = p;
            B.vx = B.vy = B.vz = 0;
            B.x = p.x;
            B.y = p.y;
            B.z = 40;
            setPos(p.tm);
        }
        /// <summary>Pass the ball back out from under the rim (a rebounder feeding the shooter).</summary>
        public static void feed(Player p)
        {
            var B = Sim.B;
            double hx = hoop(p.tm), fl = 0.7;
            B.owner = null;
            B.mode = "pass";
            B.to = p;
            B.ptype = 0;
            B.sh = 0;
            B.sc = 0;
            B.age = 0;
            B.last = null;
            B.x = hx + (hx > 470 ? -8 : 8);
            B.y = HY;
            B.z = 50;
            B.vx = (p.x - B.x) / fl;
            B.vy = (p.y - B.y) / fl;
            B.vz = (55 - B.z + 0.5 * g * fl * fl) / fl;
            B.wv = new double[] { 0, 0, 0 };
            setPos(p.tm);
        }
        public static Player me() => P[0];
        public static void say(string s, string c = "#ffd23f") => txt(s, 480, 220, c);
        /// <summary>FX {k:"mode", ...o}: the payload goes into Fx.o.</summary>
        public static void evt(Dictionary<string, object> o) => fxp(new Fx { k = "mode", o = o });

        /// <summary>Watch the human's (or anyone's) shot from release to make / miss.</summary>
        public static ShotResult watchShot(Player p, double dt)
        {
            var B = Sim.B;
            var W = M.w ?? (M.w = new ShotWatch { live = 0, t = 0, lc = p.lc });
            if (p.lc != W.lc && B.last == p)
            {
                W.live = 1;
                W.t = 0;
                W.dunk = Util.T(B.dk);
                W.three = Util.T(B.three);
                W.green = Util.T(B.gn);
                W.perf = Util.T(p.perf);
                W.sv = p.sv;
                W.spd = M.spd;
            }
            W.lc = p.lc;
            if (!Util.T(W.live)) return null;
            W.t += dt;
            if (Util.T(B.sc))
            {
                W.live = 0;
                return new ShotResult { made = true, dunk = W.dunk, three = W.three, green = W.green, perf = W.perf };
            }
            if ((B.owner != null && W.t > 0.3) || (B.z < 8 && W.t > 0.5) || W.t > 3.2)
            {
                W.live = 0;
                return new ShotResult { made = false, dunk = W.dunk, three = W.three, green = W.green, perf = W.perf };
            }
            return null;
        }
        /// <summary>Swap a player into slot 0 of his team (the slot the human controls in every mode).</summary>
        public static void toSlot0(double t, Player p)
        {
            int NP = cfg.NP;
            double k = p.k;
            var a = P[(int)t * NP];
            int i = P.IndexOf(p);
            if (i == (int)t * NP) return;
            P[(int)t * NP] = p;
            P[i] = a;
            a.k = k;
            p.k = 0;
        }
        public static Player best(double t, Func<Player, double> f)
        {
            var l = new List<Player>();
            foreach (var p in P) if (p.tm == t) l.Add(p);
            SortStable(l, (a, b) => Cmp(f(b) - f(a)));
            return l.Count > 0 ? l[0] : null;
        }
        public sealed class Saved { public int JB = 1, FOULS = 1, VIOL = 1, SUBS = 1; }
        public static readonly Saved saved = new Saved();
        /// <summary>Modes that are a real game (the normal sim runs them; the mode only sets the rules and reads the result).</summary>
        public static readonly HashSet<string> GAMELIKE = new HashSet<string> { "clutch", "street", "king", "allstar", "daily" };
        /// <summary>Common start: a normal game with no jump ball, then the mode takes over.</summary>
        public static void begin(string kind, double sel, double? opp, BeginOpts o = null)
        {
            if (o == null) o = new BeginOpts();
            stopMode();
            saved.JB = cfg.JB; saved.FOULS = cfg.FOULS; saved.VIOL = cfg.VIOL; saved.SUBS = cfg.SUBS;
            M.np0 = cfg.NP;
            if (Util.T(o.np)) cfg.NP = (int)o.np;
            cfg.HALF = (int)o.half;
            cfg.TO = o.to;
            cfg.ASTAR = (int)o.astar;
            cfg.JB = 0;
            cfg.GM = kind;
            cfg.ONLINE = 0;
            if (!GAMELIKE.Contains(kind) || kind == "allstar")
            {
                cfg.FOULS = 0;
                cfg.VIOL = 0;
                cfg.SUBS = 0;
            }
            if (kind == "street" || kind == "king") { cfg.VIOL = 0; cfg.SUBS = 0; }
            start(sel, opp != null && opp >= 0 ? new StartOpts { j = opp } : new StartOpts());
            cfg.JB = saved.JB;
            FX.Clear(); // no "INBOUND" from the normal start
            if (!GAMELIKE.Contains(kind))
            {
                // the human always runs slot 0 (the mode's shooter); no inbound pass to a parked teammate
                setInb(0);
                foreach (var c in CT)
                {
                    c.fixed_ = true;
                    c.idx = c.tm * cfg.NP;
                }
            }
            M.kind = kind;
            M.t = 0;
            M.w = null;
            M.done = 0;
            HOOK.pre = pre;
            HOOK.post = post;
            HOOK.end = kind == "clutch" || kind == "daily" ? postClutch : GAMELIKE.Contains(kind) ? endGameMode : (Action)null;
        }
        /// <summary>Street / King / All-Star: the game itself decides; report the result.</summary>
        public static void endGameMode()
        {
            if (Util.T(M.done)) return;
            bool win = sc[0] > sc[1];
            if (M.kind == "king")
            {
                if (win) M.rung++;
                int r = (int)M.rung;
                finish(new Dictionary<string, object> {
                    { "win", win }, { "rung", M.rung }, { "total", (double)M.ladder.Count },
                    { "next", r < M.ladder.Count ? (object)(double)M.ladder[r] : null }, { "opp", cl[1] } });
                return;
            }
            finish(new Dictionary<string, object> { { "win", win }, { "sc", (double[])sc.Clone() }, { "teams", (string[])cl.Clone() } });
        }
        public static void stopMode()
        {
            if (M.kind != "") { cfg.FOULS = saved.FOULS; cfg.VIOL = saved.VIOL; cfg.SUBS = saved.SUBS; }
            if (M.kind != "" && M.np0 != 0) cfg.NP = M.np0;
            M.np0 = 0;
            cfg.HALF = 0; cfg.TO = 0; cfg.ASTAR = 0;
            M.kind = "";
            cfg.GM = "game";
            HOOK.pre = null; HOOK.post = null; HOOK.end = null;
            foreach (var p in P)
            {
                p.off = 0;
                if (Util.T(p.horseT)) { p.tm = 1; p.horseT = 0; }
            }
            if (M.jb != null)
            {
                var p = M.jbP;
                if (p != null) p.j = M.jb.Value;
                M.jb = null;
            }
        }
        public static void finish(Dictionary<string, object> res)
        {
            if (Util.T(M.done)) return;
            M.done = 1;
            evt(new Dictionary<string, object> { { "ev", "end" }, { "kind", M.kind }, { "res", res } });
        }

        // ======================= Practice / Tutorial =======================
        public static readonly string[][] TUT = {
            new[] { "Move with WASD or the arrow keys", "move" },
            new[] { "Hold SHIFT to sprint", "sprint" },
            new[] { "Hold SPACE to rise up, let go at the top of the meter", "shot" },
            new[] { "Hit a GREEN release (let go when the meter is in the green)", "green" },
            new[] { "Pump fake with G (stick still), jab step with G + direction", "fake" },
            new[] { "Step-back with F", "sb" },
            new[] { "Dribble moves: C hesitation · X spin · V behind the back", "move2" },
            new[] { "Attack the rim and finish (shoot close to the basket)", "lay" },
            new[] { "Post up: hold B near the paint", "post" },
        };
        public static void startPractice(double sel, bool tut = false)
        {
            begin(tut ? "tutorial" : "practice", sel, null);
            int NP = cfg.NP;
            for (int k = 0; k < P.Count; k++)
            {
                var p0 = P[k];
                if (p0.tm == 1 || (tut && p0 != me())) PARK(p0, k);
            }
            var p = me();
            unpark(p, hoop(0) - 200, HY);
            give(p);
            M.st = new PracticeStats();
            M.step = 0;
            M.mvd = 0;
            M.spr = 0;
            M.fb = 0;
            if (tut) ban("TUTORIAL", TUT[0][0], "#9fe7ff");
            else ban("PRACTICE", NP > 1 ? "Your team · no defense · ball comes back to you" : "Free shooting · ball comes back to you", "#9fe7ff");
        }
        public static void tutTick(Player p, double dt, ShotResult r)
        {
            string k = M.step < TUT.Length ? TUT[(int)M.step][1] : null;
            if (k == null) return;
            bool ok = false;
            if (k == "move") ok = (M.mvd += Hypot(p.vx, p.vy) * dt) > 160;
            else if (k == "sprint") ok = (M.spr += p.@in.sp && Hypot(p.vx, p.vy) > 150 ? dt : 0) > 0.8;
            else if (k == "shot") ok = r != null;
            else if (k == "green") ok = r != null && r.green;
            else if (k == "fake") ok = (p.act == 1 || p.act == 2) && p.actT > 0;
            else if (k == "sb") ok = p.mode == "b";
            else if (k == "move2") ok = p.mvT > 0 && p.mvk >= 1 && p.mvk <= 3;
            else if (k == "lay") ok = r != null && r.made && (r.dunk || Hypot(hoop(0) - p.x, HY - p.y) < 120);
            else if (k == "post") ok = Util.T(p.postA);
            if (ok)
            {
                M.step++;
                snd(880, 0.15, "triangle", 0.08);
                if (M.step >= TUT.Length)
                {
                    ban("TUTORIAL COMPLETE", "You're ready — tip it off!", "#2ecc71");
                    finish(new Dictionary<string, object> { { "done", 1.0 } });
                }
                else ban("✔ NICE", TUT[(int)M.step][0], "#2ecc71");
            }
        }

        // ======================= 3-Point Contest =======================
        public static readonly double[][] RACKS = mkRacks();
        static double[][] mkRacks()
        {
            double[] ds = { 80, 40, 0, -40, -80 };
            var r = new double[5][];
            for (int k = 0; k < 5; k++)
            {
                double a = (ds[k] * Math.PI) / 180, hx = hoop(0);
                r[k] = new[] { hx - 243 * Math.Cos(a), HY + 243 * Math.Sin(a) };
            }
            return r;
        }
        static bool onFloor(string n)
        {
            foreach (var q in P) if (q.n == n) return true;
            return false;
        }
        public static void start3pt(double sel)
        {
            begin("3pt", sel, null);
            var p = cfg.NP > 1 ? best(0, (q) => q.c) : me();
            toSlot0(0, p);
            for (int k = 0; k < P.Count; k++) if (P[k] != p) PARK(P[k], k);
            M.rack = 0;
            M.ball = 0;
            M.pts = 0;
            M.time = 60;
            M.wait = 1.2;
            M.racks = new double[] { 0, 0, 0, 0, 0 };
            M.shots = new List<double>();
            unpark(p, RACKS[0][0], RACKS[0][1]);
            give(p);
            ban("3-POINT CONTEST", "5 racks · 25 balls · 60 seconds · last ball of each rack = MONEY BALL", "#ffd23f");
            // the field: the best shooters from the other teams
            var all = new List<FieldEntry>();
            foreach (var t in TM) foreach (var a in t.ps) if (!onFloor(a.n)) all.Add(new FieldEntry { n = a.n, c = a.c });
            SortStable(all, (a, b) => Cmp(b.c - a.c));
            M.field = new List<FieldEntry>();
            for (int k = 0; k < Math.Min(3, all.Count); k++)
            {
                var a = all[k];
                double s = 0;
                double pk = Math.Min(0.72, Math.Max(0.25, 0.2 + (a.c - 60) / 55));
                for (int i = 0; i < 25; i++) if (Rng.R() < pk) s += i % 5 == 4 ? 2 : 1;
                M.field.Add(new FieldEntry { n = a.n, s = s });
            }
        }
        static Dictionary<string, object> res3() =>
            new Dictionary<string, object> { { "pts", M.pts }, { "field", M.field }, { "racks", M.racks } };
        public static void tick3(Player p, double dt)
        {
            var spot = RACKS[(int)M.rack];
            if (M.time > 0 && M.wait <= 0) M.time = Math.Max(0, M.time - dt);
            if (M.wait > 0) M.wait -= dt;
            var r = watchShot(p, dt);
            if (r != null)
            {
                bool money = M.ball == 4;
                double pts = r.made ? (money ? 2 : 1) : 0;
                M.pts += pts;
                M.racks[(int)M.rack] += pts;
                M.shots.Add(pts);
                if (r.made) txtW(money ? "MONEY BALL! +2" : "+1", p.x, p.y, 120, money ? "#ffd23f" : "#fff");
                M.ball++;
                if (M.ball >= 5)
                {
                    M.ball = 0;
                    M.rack++;
                }
                if (M.rack >= 5 || M.time <= 0) { finish(res3()); return; }
                if (M.ball == 0)
                {
                    var s = RACKS[(int)M.rack];
                    unpark(p, s[0], s[1]);
                    M.wait = 0.35;
                }
                give(p);
                if (M.ball == 4) txtW("MONEY BALL", p.x, p.y, 130, "#ffd23f");
                return;
            }
            if (M.time <= 0 && !(M.w != null && Util.T(M.w.live)) && Sim.B.owner == p && p.mode == "i") { finish(res3()); return; }
            // planted at the rack: no drifting, no step-backs, no passes
            if (p.mode == "i")
            {
                p.x += (spot[0] - p.x) * 0.3;
                p.y += (spot[1] - p.y) * 0.3;
            }
        }

        // ======================= Dunk Contest =======================
        public static readonly Dictionary<int, double> DBASE = new Dictionary<int, double> { { 6, 37 }, { 11, 38 }, { 12, 41 }, { 13, 44 }, { 14, 42 }, { 15, 46 } };
        public static readonly Dictionary<int, string> DNAME = new Dictionary<int, string> { { 6, "One-hand slam" }, { 11, "Two-hand power" }, { 12, "Tomahawk" }, { 13, "Windmill" }, { 14, "Reverse" }, { 15, "360" } };
        static bool dkey(double sv, out int k)
        {
            k = (int)sv;
            return k == sv;
        }
        public static void startDunk(double sel)
        {
            begin("dunk", sel, null);
            var p = cfg.NP > 1 ? best(0, (q) => q.j + q.i * 0.3) : me();
            toSlot0(0, p);
            for (int k = 0; k < P.Count; k++) if (P[k] != p) PARK(P[k], k);
            M.jb = p.j;
            M.jbP = p;
            p.j = Math.Max(p.j, 82); // everybody gets bounce in the contest
            M.dunk = 0;
            M.tries = 0;
            M.scores = new List<double>();
            M.style = 0;
            M.last = -1;
            M.wait = 0;
            M.finT = 0;
            reset(p);
            ban("DUNK CONTEST", "3 dunks · 2 tries each · green release = clean finish", "#ffd23f");
            say("Pick a dunk on the approach: C tomahawk · X 360 · V windmill · G reverse · none = power", "#9fe7ff");
            var all = new List<FieldEntry>();
            foreach (var t in TM) foreach (var a in t.ps) if (!onFloor(a.n)) all.Add(new FieldEntry { n = a.n, j = a.j });
            SortStable(all, (a, b) => Cmp(b.j - a.j));
            M.field = new List<FieldEntry>();
            for (int k = 0; k < Math.Min(3, all.Count); k++)
            {
                var a = all[k];
                double s = 0;
                for (int i = 0; i < 3; i++) s += Round(Math.Min(50, 34 + a.j / 8 + Rng.R() * 9));
                M.field.Add(new FieldEntry { n = a.n, s = s });
            }
        }
        public static void reset(Player p)
        {
            unpark(p, 470, HY + (Rng.R() - 0.5) * 120);
            give(p);
            M.style = 0;
            M.spd = 0;
        }
        public static void tickDunk(Player p, double dt)
        {
            // TS: setTimeout(() => finish(...), 1800) after the last dunk; here a countdown in sim time
            if (M.finT > 0)
            {
                M.finT -= dt;
                if (M.finT <= 0)
                {
                    double tot = 0;
                    foreach (var v in M.scores) tot += v;
                    finish(new Dictionary<string, object> { { "scores", M.scores }, { "total", tot }, { "field", M.field } });
                }
            }
            if (M.wait > 0)
            {
                M.wait -= dt;
                if (M.wait <= 0 && RPL == null) reset(p);
                return;
            }
            // approach: the last move pressed picks the dunk
            var i = p.@in;
            double D = Hypot(hoop(0) - p.x, HY - p.y);
            if (Util.T(i.mv)) M.style = i.mv == 1 ? 12 : i.mv == 2 ? 15 : 13;
            if (i.pf) M.style = 14;
            M.spd = Math.Max(M.spd * 0.98, Hypot(p.vx, p.vy));
            if (i.sd && p.mode == "i" && Sim.B.owner == p)
            {
                if (D < 65)
                {
                    p.fsv = Util.T(M.style) ? M.style : (p.j >= 85 ? 11 : 6);
                    p.hk = 1;
                }
                else if (D > 110) say("Get to the rim to dunk!", "#ff9966");
            }
            var r = watchShot(p, dt);
            if (r == null) return;
            M.tries++;
            double sc = 0;
            if (r.made && r.dunk)
            {
                double sv = M.w.sv;
                bool hk = dkey(sv, out int ik);
                double db = hk && DBASE.TryGetValue(ik, out var dv) ? dv : 36;
                string dn = hk && DNAME.TryGetValue(ik, out var ds) ? ds : null;
                sc = db + Math.Min(3, M.w.spd / 90) + (r.perf ? 2 : 0) - (sv == M.last ? 4 : 0);
                sc = Round(Math.Max(30, Math.Min(50, sc)));
                M.last = sv;
                var j = judges(sc);
                fxp(new Fx { k = "mode", o = new Dictionary<string, object> { { "ev", "judges" }, { "j", j }, { "s", sc }, { "name", dn ?? "Slam" } } });
                ban(dn != null ? dn.ToUpperInvariant() + "!" : "SLAM!", string.Join(" · ", j) + "  =  " + sc, sc >= 47 ? "#ff5a5a" : "#ffd23f");
                if (recN > 80 && cfg.replays) startReplay();
            }
            else
            {
                ban(r.made ? "THAT'S A LAYUP" : "MISSED!", M.tries < 2 ? "One more try" : "Dunk over", "#ff9966");
                if (M.tries >= 2) sc = 25;
            }
            if (Util.T(sc))
            {
                M.scores.Add(sc);
                M.dunk++;
                M.tries = 0;
            }
            M.wait = 1.6;
            if (M.dunk >= 3)
            {
                M.wait = 99;
                M.finT = 1.8;
            }
        }
        public static double[] judges(double s)
        {
            var j = new double[] { 10, 10, 10, 10, 10 };
            double off = 50 - s;
            int k = 0;
            while (off > 0)
            {
                if (j[k % 5] > 6) { j[k % 5]--; off--; }
                k += 1 + I(Rng.R() * 3);
            }
            return j;
        }

        // ======================= HORSE =======================
        public static readonly double[][] HSPOTS = {
            new double[] { 0, 120 }, new double[] { 40, 150 }, new double[] { -40, 150 }, new double[] { 0, 243 }, new double[] { 70, 243 }, new double[] { -70, 243 },
            new double[] { 85, 243 }, new double[] { -85, 243 }, new double[] { 25, 200 }, new double[] { -25, 200 }, new double[] { 0, 60 }, new double[] { 55, 95 },
        };
        public static double[] spotXY(double[] s)
        {
            double a = (s[0] * Math.PI) / 180;
            return new[] { hoop(0) - s[1] * Math.Cos(a), HY + s[1] * Math.Sin(a) };
        }
        public static void startHorse(double sel, double? opp = null)
        {
            begin("horse", sel, opp);
            var a = cfg.NP > 1 ? best(0, (q) => q.c + q.i) : me();
            var b = best(1, (q) => q.c + q.i);
            toSlot0(0, a);
            toSlot0(1, b);
            // both players shoot at the same (right) hoop: the CPU borrows team 0's basket by standing in for it
            for (int k = 0; k < P.Count; k++) if (P[k] != a && P[k] != b) PARK(P[k], k);
            b.tm = 0; // same basket for both
            b.horseT = 1;
            M.pl = new[] { a, b };
            M.let = new double[] { 0, 0 };
            M.setter = 0;
            M.ph = "set";
            M.spot = null;
            M.wait = 0.6;
            M.cin = new Input();
            turn();
            ban("H-O-R-S-E", "Make it, they have to match it. Miss the match = a letter.", "#ffd23f");
        }
        public static void turn()
        {
            Player a = M.pl[0], b = M.pl[1];
            var sh = M.ph == "set" ? M.pl[(int)M.setter] : M.pl[1 - (int)M.setter];
            var other = sh == a ? b : a;
            PARK(other, 9);
            double x, y;
            if (M.ph == "match") { x = M.spot[0]; y = M.spot[1]; }
            else if (sh == b)
            {
                var s = spotXY(HSPOTS[I(Rng.R() * HSPOTS.Length)]);
                x = s[0]; y = s[1];
            }
            else { x = hoop(0) - 220; y = HY; }
            unpark(sh, x, y);
            give(sh);
            M.w = null;
            M.cur = sh;
            M.ct = 0;
            M.rel = 0.6 + (Rng.R() - 0.5) * 0.12;
            // the human only controls his own guy; the CPU shoots by itself
            foreach (var c in CT) c.idx = 0;
            ban(M.ph == "set" ? (sh == a ? "YOUR SHOT" : sh.n.ToUpperInvariant() + " SETS IT") : sh == a ? "MATCH IT!" : sh.n.ToUpperInvariant() + " TO MATCH",
                sh == a && M.ph == "set" ? "Shoot from anywhere" : "", "#9fe7ff");
        }
        public static void tickHorse(double dt)
        {
            Player sh = M.cur, a = M.pl[0];
            if (M.wait > 0)
            {
                M.wait -= dt;
                if (M.wait <= 0) turn();
                return;
            }
            if (sh != a)
            {
                // CPU: settle, rise up, let go
                M.ct += dt;
                var i = M.cin;
                i.dx = i.dy = 0;
                i.sd = i.su = false;
                if (sh.mode == "i" && Sim.B.owner == sh && M.ct > 0.8) i.sd = true;
                if (sh.mode == "c" && sh.t >= M.rel) i.su = true;
                sh.@in = i;
            }
            else if (M.ph == "match" && sh.mode == "i")
            {
                // matching: you shoot from the spot
                sh.x += (M.spot[0] - sh.x) * 0.3;
                sh.y += (M.spot[1] - sh.y) * 0.3;
            }
        }
        public static void postHorse(double dt)
        {
            var sh = M.cur;
            if (sh == null || M.wait > 0) return;
            var r = watchShot(sh, dt);
            if (r == null) return;
            const string L = "HORSE";
            if (M.ph == "set")
            {
                if (r.made)
                {
                    M.spot = new[] { sh.x, sh.y };
                    M.ph = "match";
                    txtW("GOOD — MATCH IT", sh.x, sh.y, 120, "#2ecc71");
                }
                else
                {
                    M.setter = 1 - M.setter; // miss: the other guy sets
                    txtW("MISS — " + M.pl[(int)M.setter].n.ToUpperInvariant() + "'S SHOT", sh.x, sh.y, 120, "#ff9966");
                }
            }
            else
            {
                int mi = 1 - (int)M.setter;
                if (!r.made)
                {
                    M.let[mi]++;
                    string lt = L.Substring(0, Math.Min(L.Length, (int)M.let[mi]));
                    ban(string.Join("-", lt.ToCharArray()), M.pl[mi].n.ToUpperInvariant() + " PICKS UP A LETTER", "#ff6b4a");
                    if (M.let[mi] >= 5)
                    {
                        finish(new Dictionary<string, object> { { "win", mi == 1 }, { "letters", M.let }, { "names", new[] { M.pl[0].n, M.pl[1].n } } });
                        return;
                    }
                }
                else txtW("MATCHED!", sh.x, sh.y, 120, "#2ecc71");
                M.ph = "set"; // the setter keeps control
            }
            M.wait = 1.1;
            evt(new Dictionary<string, object> { { "ev", "horse" }, { "letters", (double[])M.let.Clone() } });
        }

        // ======================= Clutch Challenges =======================
        public static readonly ClutchSpec[] CLUTCH = {
            new ClutchSpec("Down 2, 12 seconds left", "Your ball. Tie it or win it.", 98, 100, 12, 0, "win"),
            new ClutchSpec("Down 3, 8 seconds left", "Your ball. Hit a three to force overtime (or win it).", 95, 98, 8, 0, "ot"),
            new ClutchSpec("Up 1, 15 seconds left", "Their ball. Get a stop.", 101, 100, 15, 1, "win"),
            new ClutchSpec("Tied, 6 seconds left", "Your ball. Win it at the buzzer.", 104, 104, 6, 0, "win"),
            new ClutchSpec("Down 5, 24 seconds left", "Your ball. Find a way.", 96, 101, 24, 0, "win"),
            new ClutchSpec("Down 1, 3.5 seconds left", "Inbound in the frontcourt. One shot.", 99, 100, 3.5, 0, "win"),
        };
        public static void startClutch(int i, double sel, double? opp = null)
        {
            var c = CLUTCH[i];
            setQtrLen(720); // a real-time clock: 12 s means 12 s
            begin("clutch", sel, opp);
            setScalars(new Scalars { q = 4, clock = c.t, sc = new[] { c.me, c.op } });
            setup(c.pos);
            if (i == 5) foreach (var p in P) p.x += (hoop(0) - 470) * 0.55; // frontcourt inbound
            TS.clutch = 1;
            M.ci = i;
            M.goal = c.goal;
            ban("CLUTCH CHALLENGE", c.n.ToUpperInvariant() + " · " + c.d, "#ff5a5a");
        }
        public static void postClutch()
        {
            if (Util.T(M.done)) return;
            if (M.goal == "ot" && Sim.q > 4)
            {
                setS("over");
                finish(new Dictionary<string, object> { { "win", true }, { "ci", M.ci } });
                return;
            }
            if (S == "over") finish(new Dictionary<string, object> { { "win", sc[0] > sc[1] }, { "ci", M.ci }, { "margin", sc[0] - sc[1] }, { "daily", M.daily } });
        }

        // ======================= Street 21 / King of the Court / All-Star / Daily =======================
        /// <summary>Team index -> that team's best player in the 1v1 list (-1 if none).</summary>
        public static double starOfTeam(double ti)
        {
            var s = (Tuple[])TM[(int)ti].ps.Clone();
            SortStable(s, (a, b) => Ov2(b) - Ov2(a));
            var bst = s[0];
            for (int k = 0; k < ALL.Count; k++) if (ALL[k].a == bst) return k;
            return -1;
        }
        /// <summary>1v1 list index -> that player's team.</summary>
        public static double teamOfStar(double i) => i >= 0 && i < ALL.Count && i == Math.Floor(i) ? ALL[(int)i].t : 0;
        /// <summary>Street ball: half court, check ball at the top, 1s and 2s, make-it-take-it, call your own fouls, first to 21.</summary>
        public static void startStreet(double? sel, double? opp, int np)
        {
            stopMode(); // read the menu's team size, not the last mode's
            int from = cfg.NP;
            double? map(double? i) => i == null || i < 0 ? (double?)null : np == 1 && from > 1 ? starOfTeam(i.Value) : np > 1 && from == 1 ? teamOfStar(i.Value) : i;
            double? s = map(sel), o = map(opp);
            if (o == s) o = null; // TS ===: undefined === undefined too
            begin("street", s ?? 0, o, new BeginOpts { np = np, half = 1, to = 21 }); // TS passes undefined when sel < 0
            setup(0);
            ban("STREET · " + (np == 1 ? "1-ON-1" : np + "-ON-" + np) + " TO 21", "Half court · 1s and 2s · make it, take it · take it back on a change of possession", "#ff9a2e");
        }
        /// <summary>King of the Court: 1-on-1 to 11 (1s and 2s) up a ladder of opponents, weakest first. Lose once and you're off.</summary>
        public static void startKing(double sel, double rung = 0)
        {
            stopMode();
            double me0 = cfg.NP > 1 ? starOfTeam(sel) : sel;
            if (!Util.T(rung) || M.ladder == null)
            {
                Tuple mine = me0 >= 0 && me0 < ALL.Count ? ALL[(int)me0].a : null;
                var idx = new List<int>();
                for (int i = 0; i < ALL.Count; i++) if (ALL[i].a != mine) idx.Add(i);
                SortStable(idx, (a, b) => Ov2(ALL[a].a) - Ov2(ALL[b].a));
                int st = Math.Max(1, idx.Count / 10);
                var ld0 = new List<int>();
                for (int k = 0; k < idx.Count && ld0.Count < 10; k++) if (k % st == 0) ld0.Add(idx[k]);
                M.ladder = ld0;
                M.kme = me0;
                M.rung = 0;
            }
            double r = rung;
            var ld = M.ladder;
            double meK = M.kme;
            begin("king", meK, r >= 0 && r < ld.Count ? ld[(int)r] : (double?)null, new BeginOpts { np = 1, half = 1, to = 11 });
            M.ladder = ld;
            M.kme = meK;
            M.rung = r;
            setup(0);
            ban("KING OF THE COURT", "Challenger " + (r + 1) + " of " + ld.Count + ": " + cl[1].ToUpperInvariant() + " · first to 11, 1s and 2s", "#ffd23f");
        }
        /// <summary>All-Star game: the league's ten best split into Team Gold and Team Ice; no defense, lots of lobs.</summary>
        public static void startAllStar()
        {
            stopMode();
            begin("allstar", 0, 1, new BeginOpts { np = cfg.NP == 1 ? 3 : cfg.NP, astar = 1 });
            setup(0);
            ban("ALL-STAR GAME", "Team Gold vs Team Ice · fouls off · let it fly", "#e0a526");
        }
        /// <summary>Daily Challenge: one scenario per day (same for everybody that day), seeded by the (local) date.</summary>
        public static DailySpec dailySpec(DateTime? d0 = null)
        {
            var d = d0 ?? DateTime.Now;
            double seed = d.Year * 10000 + d.Month * 100 + d.Day; // JS (getMonth() + 1)
            double h = seed;
            // JS: (h * 1103515245 + 12345) >>> 0 in doubles (the product is rounded past 2^53), then mod 2^32
            double r()
            {
                double v = h * 1103515245.0 + 12345.0;
                v %= 4294967296.0;
                if (v < 0) v += 4294967296.0;
                h = v;
                return h / 4294967296.0;
            }
            var bse = CLUTCH[I(r() * CLUTCH.Length)];
            double me = I(r() * TM.Length);
            double op = I(r() * TM.Length);
            if (op == me) op = (op + 1) % TM.Length;
            double dm = I(r() * 3) - 1;
            var c = bse.Clone();
            c.t = Math.Max(4, bse.t + I(r() * 9) - 4);
            c.me = bse.me + dm;
            // n: base.n.replace(/Down \d|Up \d/, m => m) is the identity
            return new DailySpec { seed = seed, me = me, op = op, c = c };
        }
        public static void startDaily()
        {
            stopMode();
            var s = dailySpec();
            var c = s.c;
            int np = cfg.NP;
            setQtrLen(720);
            begin("daily", np > 1 ? s.me : starOfTeam(s.me), np > 1 ? s.op : starOfTeam(s.op));
            setScalars(new Scalars { q = 4, clock = c.t, sc = new[] { c.me, c.op } });
            setup(c.pos);
            TS.clutch = 1;
            M.ci = -1;
            M.daily = s;
            M.goal = c.goal;
            ban("DAILY CHALLENGE", cl[0] + " vs " + cl[1] + " · " + c.me + "-" + c.op + " · " + Round(c.t) + " s · " + c.d, "#ff5a5a");
        }

        // ======================= hooks =======================
        public static void pre(double dt)
        {
            string k = M.kind;
            if (k == "street" || k == "king")
            {
                setClock(QTRLEN); // no game clock: first to the target score
                return;
            }
            if (k == "allstar") return;
            if (k != "clutch" && k != "daily")
            {
                setClock(QTRLEN);
                setShot(24);
            }
            var p = me();
            if (k == "3pt" && p.mode == "i")
            {
                p.@in.dx = p.@in.dy = 0;
                p.@in.sb = p.@in.e = p.@in.lob = p.@in.post = false;
                p.@in.mv = 0;
            }
            if (k == "horse") tickHorse(dt);
        }
        /// <summary>HOOK.post: always false (the TS hook returns undefined, the sim tick goes on).</summary>
        public static bool post(double dt)
        {
            string k = M.kind;
            var p = me();
            var B = Sim.B;
            if (GAMELIKE.Contains(k))
            {
                if (k == "clutch" || k == "daily") postClutch();
                return false;
            }
            if (rs > 0) setRs(0); // no inbounds after makes: the mode decides what happens next
            if (Util.T(M.done)) return false;
            if (k == "practice" || k == "tutorial")
            {
                var r = watchShot(p, dt);
                if (r != null)
                {
                    var s = M.st;
                    s.att++;
                    if (r.made)
                    {
                        s.made++;
                        s.streak++;
                        s.best = Math.Max(s.best, s.streak);
                        if (r.three) s.tpm++;
                    }
                    else s.streak = 0;
                    if (r.green) s.gr++;
                    // shot lab: makes and average timing per zone
                    var tg = p.tg;
                    if (tg != null && !r.dunk)
                    {
                        int zk = (int)tg.z;
                        if (!s.z.TryGetValue(zk, out var z)) s.z[zk] = z = new ZoneStat();
                        z.a++;
                        if (r.made) z.m++;
                        z.off += Math.Abs(tg.off);
                    }
                    M.fb = 0.9;
                }
                if (k == "tutorial") tutTick(p, dt, r);
                // ball comes back: after the shot settles, or if it's lying around
                if (M.fb > 0)
                {
                    M.fb -= dt;
                    if (M.fb <= 0 && B.owner != p) feed(p);
                }
                else if (B.owner == null && B.mode == "air" && !Util.T(B.sh) && B.z < 10 && Hypot(B.vx, B.vy) < 40) feed(p);
                return false;
            }
            if (k == "3pt") { tick3(p, dt); return false; }
            if (k == "dunk") { tickDunk(p, dt); return false; }
            if (k == "horse") { postHorse(dt); return false; }
            return false;
        }
        // TS re-exports isDunkSv from data: use Data.IsDunkSv.
    }
}
