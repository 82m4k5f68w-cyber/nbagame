// Crowd chants for the Unity build (browser: src/client/crowd.ts). ChantSynth renders every chant ONCE, a few units
// of work per frame (~3 ms budget) while the menus and intros run, into stereo 22.05 kHz AudioClips; ChantDir (the
// same director as the browser) decides what the building sings from the sim's FX + a context filled in place each
// frame. A roar / boo fades a running chant out; Music.Duck backs the organ off under a chant; GameAudio.Hush quiets
// the bed for a clutch home free throw. Settings: GameAudio.CrowdVol (page "vc") and Chants.On (page "ch").
using System.Collections.Generic;
using System.Diagnostics;
using Hoops.Core;
using UnityEngine;
using static Hoops.Core.Sim;

namespace Hoops.Game
{
    public sealed class Chants : MonoBehaviour
    {
        public static bool On = true;
        static Chants inst;
        readonly ChantDir dir = new ChantDir(() => UnityEngine.Random.value * 0.9999999);
        readonly CCtx C = new CCtx();
        readonly Dictionary<string, AudioClip> clips = new Dictionary<string, AudioClip>();
        readonly List<string> queue = new List<string>();
        ChantSynth.ChantJob job;
        readonly AudioSource[] src = new AudioSource[3];
        readonly float[] lvl = new float[3];
        int turn, cur = -1;
        // a call-and-response answer waiting for its beat (CHARGE!) / a request waiting for its clip
        CReq later;
        float laterAt, waitUntil;
        CReq waiting;
        object lastP, ftObj;
        int ftN;
        double benchT = -9;
        readonly Stopwatch sw = new Stopwatch();
        static readonly string[] COMMON = { "defense", "airball", "roar", "boo", "charge", "mvp", "overtime", "rockyou", "aww", "shh" };
        static readonly Dictionary<string, float> LEVEL = new Dictionary<string, float>
        {
            ["defense"] = 0.5f, ["letsgo"] = 0.45f, ["mvp"] = 0.5f, ["airball"] = 0.5f, ["overtime"] = 0.5f, ["wewant"] = 0.42f,
            ["rockyou"] = 0.55f, ["charge"] = 0.55f, ["boo"] = 0.42f, ["roar"] = 0.6f, ["aww"] = 0.32f, ["shh"] = 0.22f,
        };
        static string KeyOf(string id, string word) => id == "letsgo" || id == "wewant" ? id + ":" + word : id;

        void Awake()
        {
            inst = this;
            try { On = PlayerPrefs.GetInt("h2k_chants", 1) != 0; } catch { }
            for (int i = 0; i < src.Length; i++)
            {
                src[i] = gameObject.AddComponent<AudioSource>();
                src[i].playOnAwake = false;
                src[i].priority = 32;
            }
            queue.AddRange(COMMON);
            C.tmOf = TeamOf;
        }

        static int TeamOf(string n)
        {
            foreach (var p in P) if (p.n == n) return (int)p.tm;
            for (int t = 0; t < 2; t++) if (ROST[t] != null) foreach (var p in ROST[t]) if (p.n == n) return t;
            return -1;
        }

        /// <summary>Fill the director's context in place (game.ts crowdCtx).</summary>
        void Fill()
        {
            if (!ReferenceEquals(P, lastP))
            {
                lastP = P;
                C.names[0] = cl[0] ?? "";
                C.names[1] = cl[1] ?? "";
                dir.Reset();
                Need("letsgo", C.names[0]);
                Need("letsgo", C.names[1]);
            }
            bool game = gameLike();
            C.live = S == "play" && RPL == null && game;
            C.over = S == "over" && game && RPL == null;
            C.pos = (int)pos;
            C.sc[0] = sc[0];
            C.sc[1] = sc[1];
            C.q = (int)q;
            C.clutch = TS.clutch != 0;
            C.mom = TS.mom;
            C.run[0] = TS.run[0] == 0 ? TS.run[1] : 0;
            C.run[1] = TS.run[0] == 1 ? TS.run[1] : 0;
            C.dead = rs > 0 || inb > 0 || ftq != null;
            if (!ReferenceEquals(ftq, ftObj)) { ftObj = ftq; if (ftq != null) ftN++; }
            C.ft = ftq != null && ftq.s != null ? ftN : 0;
            if (C.ft != 0)
            {
                var s = ftq.s;
                double top = 0;
                foreach (var p in P) if (p.tm == s.tm && p != s) top = System.Math.Max(top, p.stt.pts);
                C.ftTm = (int)s.tm;
                C.ftN = s.n ?? "";
                C.ftStar = s.heat >= 2 || (s.stt.pts >= 10 && s.stt.pts >= top);
            }
            if (T - benchT > 1 || T < benchT)
            {
                benchT = T;
                string b = "";
                if (cfg.NP == 5 && ROST[0] != null)
                {
                    Player best = null;
                    foreach (var p in ROST[0]) if (!P.Contains(p) && ovr(p) >= 84 && (best == null || ovr(p) > ovr(best))) best = p;
                    if (best != null) b = best.n;
                }
                if (b != "" && b != C.bench) Need("wewant", b);
                C.bench = b;
            }
            C.speaking = Time.unscaledTime < Broadcast.SpeakUntil;
        }

        void Need(string id, string word)
        {
            string k = KeyOf(id, word);
            if (!clips.ContainsKey(k) && !queue.Contains(k) && (job == null || job.Key != k)) queue.Insert(0, k);
        }

        /// <summary>One sim FX (GameAudio.OnFx forwards everything).</summary>
        public static void OnFx(Fx f)
        {
            if (inst == null) return;
            inst.Fill();
            inst.dir.on = On;
            inst.dir.OnFx(f, inst.C);
        }

        /// <summary>Music started an organ riff `ago` seconds ago (it starts on the bar line): maybe the crowd answers.</summary>
        public static void OnRiff(string name, float ago)
        {
            if (inst == null || !On) return;
            var r = inst.dir.Riff(name, inst.C);
            if (r != null) { inst.later = r; inst.laterAt = Time.unscaledTime + Mathf.Max(0, (float)r.delay - ago); }
        }

        void Update()
        {
            float dt = Time.unscaledDeltaTime;
            Render(C.live ? 2 : 5);
            Fill();
            dir.on = On;
            var r = dir.Tick(dt, C);
            if (r != null) Play(r);
            if (later != null && Time.unscaledTime >= laterAt) { var l = later; later = null; Play(l); }
            if (waiting != null)
            {
                if (clips.ContainsKey(KeyOf(waiting.id, waiting.word))) { var w = waiting; waiting = null; Play(w); }
                else if (Time.unscaledTime > waitUntil) waiting = null;
            }
            Music.Duck = (float)dir.Duck();
            GameAudio.Hush = 1 - 0.8f * (float)dir.hush;
            float chb = (C.speaking ? 0.6f : 1f) * GameAudio.CrowdVol;
            // a chant cut by a reaction fades out over ~.4 s
            for (int i = 0; i < src.Length; i++)
            {
                if (!src[i].isPlaying) continue;
                if (fading[i])
                {
                    lvl[i] = Mathf.Max(0, lvl[i] - dt * 2.5f);
                    if (lvl[i] <= 0) { src[i].Stop(); fading[i] = false; }
                }
                src[i].volume = lvl[i] * chb; // crowd volume, under the commentary voice
            }
            if (cur >= 0 && !src[cur].isPlaying) cur = -1;
        }
        readonly bool[] fading = new bool[3];

        void Render(int budgetMs)
        {
            sw.Restart();
            while (sw.ElapsedMilliseconds < budgetMs)
            {
                if (job == null)
                {
                    if (queue.Count == 0) return;
                    string k = queue[0];
                    queue.RemoveAt(0);
                    if (clips.ContainsKey(k)) continue;
                    int i = k.IndexOf(':');
                    job = new ChantSynth.ChantJob(i < 0 ? k : k.Substring(0, i), i < 0 ? "" : k.Substring(i + 1));
                }
                if (job.Step())
                {
                    int n = job.L.Length;
                    var d = new float[n * 2];
                    for (int s = 0; s < n; s++) { d[2 * s] = job.L[s]; d[2 * s + 1] = job.R[s]; }
                    var c = AudioClip.Create("chant_" + job.Key, n, 2, ChantSynth.CSR, false);
                    c.SetData(d, 0);
                    clips[job.Key] = c;
                    job = null;
                }
            }
        }

        void Play(CReq r)
        {
            if (!clips.TryGetValue(KeyOf(r.id, r.word), out var clip))
            {
                Need(r.id, r.word);
                waiting = r;
                waitUntil = Time.unscaledTime + 1.5f;
                return;
            }
            bool react = ChantDir.IsReact(r.id);
            if (react && cur >= 0 && src[cur].isPlaying && !curReact) fading[cur] = true;
            int i = turn;
            turn = (turn + 1) % src.Length;
            fading[i] = false;
            src[i].Stop();
            src[i].clip = clip;
            lvl[i] = (LEVEL.TryGetValue(r.id, out var lv) ? lv : 0.5f) * (float)r.gain;
            src[i].panStereo = r.side != C.home ? 0.65f : 0f; // the visiting section, off in one corner
            src[i].volume = lvl[i] * GameAudio.CrowdVol;
            src[i].Play();
            if (!react || cur < 0 || !src[cur].isPlaying) { cur = i; curReact = react; }
        }
        bool curReact;
    }
}
