// Dynamic arena music for the Unity build (port of src/client/music.ts), all procedural - no audio assets:
//  pregame - a head-nodding boom-bap beat for the intros and the tip
//  organ   - live play: the arena organ (drawbar voice) with soft chords + walking bass; the classic riffs at dead balls
//            ("Charge!", "De-fense", "Let's go"), crowd claps on defense when the building is loud, stingers after big plays
//  hype    - a team on a run: four-on-the-floor kick, claps, octave bass, organ stabs
//  clutch  - heartbeat kick, ticking hats, a low drone
//  calm    - halftime / pause / final: held organ chords
// WebGL has no OnAudioFilterRead, so every mode is pre-rendered ONCE into a seamless 4-bar loop (64 sixteenths at 96 BPM
// = exactly 10 s) with the same synth voices as the WebAudio graph (exp-ramp envelopes, RBJ biquads, drawbar organ with
// vibrato); all stems loop in lock-step and the mode only changes their volumes (short crossfade, like music.ts fading OUT).
// Riffs are pre-rendered one-bar clips started on the next bar line, phase-aligned to the loops.
// The mode is chosen every frame exactly like game.ts loop(). Update() allocates nothing.
using System;
using System.Collections;
using Hoops.Core;
using UnityEngine;
using static Hoops.Core.Sim;

namespace Hoops.Game
{
    public sealed class Music : MonoBehaviour
    {
        // ---- public state (game.ts sets these on `music` every frame; here Music reads the sim itself) ----
        public static bool On = true;
        public static float Volume = 1f; // master multiplier on top of the browser's levels
        public static string Mode = "off";
        public static float Level = 0.3f; // crowd energy 0..1
        public static bool Dead, Offense = true;
        public static float Duck = 1f; // Chants: the organ backs off while the crowd chants

        const int SR = 32000;
        const double BPM = 96, S16 = 60 / BPM / 4; // 0.15625 s
        const int SPS = 5000; // samples per sixteenth at 32 kHz (exact)
        const int LEN = SPS * 64; // 4 bars = 10 s
        static readonly double[] PROG = { 110, 87.31, 73.42, 82.41 }; // A minor: i - VI - iv - V (roots, Hz)
        static double Mtof(double m) => 440 * Math.Pow(2, (m - 69) / 12);

        // organ riffs: [16th step, midi note, length in 16ths]
        static readonly string[] RN = { "charge", "defense", "letsgo", "stinger", "sad" };
        static readonly int[][][] RIFFS =
        {
            new[] { new[] { 0, 67, 1 }, new[] { 1, 72, 1 }, new[] { 2, 76, 1 }, new[] { 3, 79, 2 }, new[] { 6, 76, 1 }, new[] { 7, 79, 5 } },
            new[] { new[] { 0, 55, 3 }, new[] { 4, 60, 3 }, new[] { 8, 55, 3 }, new[] { 12, 60, 3 } },
            new[] { new[] { 0, 72, 1 }, new[] { 1, 72, 1 }, new[] { 3, 72, 1 }, new[] { 4, 74, 1 }, new[] { 5, 76, 2 }, new[] { 8, 74, 1 }, new[] { 9, 72, 3 } },
            new[] { new[] { 0, 72, 1 }, new[] { 1, 76, 1 }, new[] { 2, 79, 1 }, new[] { 3, 84, 4 } },
            new[] { new[] { 0, 67, 2 }, new[] { 2, 66, 2 }, new[] { 4, 65, 2 }, new[] { 6, 64, 6 } },
        };

        // stems (all loop in sync): pregame, organ bass, organ chords, hype, clutch, crowd claps (organ on D)
        const int PRE = 0, OBASS = 1, OCH = 2, HYPE = 3, CLUTCH = 4, CLAPS = 5, NST = 6;
        readonly AudioSource[] loops = new AudioSource[NST];
        readonly float[] stemG = new float[NST], stemT = new float[NST];
        readonly AudioClip[] riffClips = new AudioClip[5];
        readonly AudioSource[] riffSrc = new AudioSource[2];
        int riffTurn;
        bool ready;
        float outG; // the browser's OUT gain
        // riff queue (music.riff: max 2 waiting), current riff bar
        readonly int[] rq = new int[2];
        int rqN, lastBar = -1;
        bool riffPlaying;
        static Music inst;

        /// <summary>One-shot organ riff on the next bar line (big plays, timeouts, game start).</summary>
        public static void Riff(string name)
        {
            if (inst == null) return;
            int i = Array.IndexOf(RN, name);
            if (i >= 0 && inst.rqN < 2) inst.rq[inst.rqN++] = i;
        }

        void Awake()
        {
            inst = this;
            try { On = PlayerPrefs.GetInt("h2k_music", 1) != 0; } catch { }
            for (int i = 0; i < NST; i++)
            {
                loops[i] = gameObject.AddComponent<AudioSource>();
                loops[i].loop = true;
                loops[i].playOnAwake = false;
                loops[i].volume = 0;
                loops[i].priority = 64;
            }
            for (int i = 0; i < 2; i++)
            {
                riffSrc[i] = gameObject.AddComponent<AudioSource>();
                riffSrc[i].playOnAwake = false;
                riffSrc[i].priority = 64;
            }
            StartCoroutine(Render());
        }

        /// <summary>Render one stem per frame (menu time), then start every loop together.</summary>
        IEnumerator Render()
        {
            for (int st = 0; st < NST; st++)
            {
                var buf = new float[LEN];
                var sy = new Synth(buf, true, 11 + st);
                for (int s = 0; s < 64; s++) Note(sy, st, s, s * SPS);
                loops[st].clip = Clip("music" + st, buf);
                yield return null;
            }
            for (int r = 0; r < RIFFS.Length; r++)
            {
                var buf = new float[SPS * 16 + SR / 3];
                var sy = new Synth(buf, false, 99 + r);
                foreach (var n in RIFFS[r]) sy.Organ(n[0] * SPS, Mtof(n[1]), n[2] * S16 * 0.95, 0.9);
                riffClips[r] = Clip("riff_" + RN[r], buf);
            }
            yield return null;
            foreach (var l in loops) l.Play();
            ready = true;
        }

        static AudioClip Clip(string name, float[] d)
        {
            var c = AudioClip.Create(name, d.Length, 1, SR, false);
            c.SetData(d, 0);
            return c;
        }

        /// <summary>music.ts note(): what stem `st` plays on sixteenth `s` (at sample `at`).</summary>
        static void Note(Synth y, int st, int s, int at)
        {
            int k = s & 15, bar = (s >> 4) & 3;
            double root = PROG[bar];
            switch (st)
            {
                case PRE: // boom-bap: kick on 1 and the "and" of 2, snare on 2 and 4, swung hats, sub bass, minor keys loop
                    if (k == 0 || k == 7 || k == 10) y.Kick(at, 1);
                    if (k == 4 || k == 12) y.Snare(at, 0.8);
                    if (k % 2 == 0) y.Hat(at + (k % 4 == 2 ? (int)(SPS * 0.18) : 0), 0.25);
                    if (k == 0 || k == 10) y.Tone(at, root / 2, S16 * 5, 0, 0.8, 300);
                    if (k == 0 || k == 6 || k == 12) { y.Tone(at, root * 2, S16 * 2.5, 1, 0.07, 2400); y.Tone(at, root * 2.378, S16 * 2.5, 1, 0.07, 2400); y.Tone(at, root * 2.997, S16 * 2.5, 1, 0.07, 2400); }
                    break;
                case OBASS: // live ball: walking bass
                    if (k == 0 || k == 8) y.Tone(at, root, S16 * 6, 1, 0.3, 500);
                    break;
                case OCH: // soft held organ chord under the crowd (level 0 gain; the stem volume adds the crowd level)
                    if (k == 0) { y.Organ(at, root * 2, S16 * 15, 0.12); y.Organ(at, root * 2.378, S16 * 15, 0.12); y.Organ(at, root * 2.997, S16 * 15, 0.12); }
                    break;
                case HYPE: // four on the floor + claps + octave bass + organ stabs
                    if (k % 4 == 0) y.Kick(at, 1);
                    if (k == 4 || k == 12) { y.Clap(at, 0.8); y.Snare(at, 0.5); }
                    if (k % 2 == 1) y.Hat(at, 0.22);
                    if (k % 2 == 0) y.Tone(at, k % 4 != 0 ? root * 2 : root, S16 * 0.9, 2, 0.35, 900);
                    if (k == 2 || k == 10) { y.Organ(at, root * 4, S16 * 0.7, 0.25); y.Organ(at, root * 4.757, S16 * 0.7, 0.25); y.Organ(at, root * 5.993, S16 * 0.7, 0.25); }
                    break;
                case CLUTCH:
                    if (k == 0 || k == 3 || k == 8 || k == 11) y.Kick(at, k % 8 != 0 ? 0.5 : 0.9);
                    if (k % 2 == 0) y.Hat(at, 0.22);
                    if (k == 0) y.Tone(at, root / 2, S16 * 15, 2, 0.16, 300);
                    break;
                case CLAPS: // crowd claps on D
                    if (k == 0 || k == 4 || k == 8 || k == 12) y.Clap(at, 0.35);
                    break;
            }
        }

        void Update()
        {
            float dt = Time.unscaledDeltaTime;
            Pick();
            if (!ready) return;
            // OUT gain: fade toward the mode's level (music.ts tick: 5% per 60 Hz frame)
            float vol = (!On || Mode == "off" ? 0 : Mode == "organ" ? 0.045f : Mode == "calm" ? 0.03f : 0.06f) * Duck;
            outG += (vol - outG) * (1 - Mathf.Exp(-3.1f * dt));
            for (int i = 0; i < NST; i++) stemT[i] = 0;
            switch (Mode)
            {
                case "pregame": stemT[PRE] = 1; break;
                case "organ":
                    stemT[OBASS] = 1;
                    stemT[OCH] = 1 + Level * 0.08f / 0.12f;
                    stemT[CLAPS] = !Offense && Level > 0.4f ? 1 : 0;
                    break;
                case "calm": stemT[OCH] = 0.1f / 0.12f; break;
                case "hype": stemT[HYPE] = 1; break;
                case "clutch": stemT[CLUTCH] = 1; break;
            }
            float kx = 1 - Mathf.Exp(-14f * dt); // ~70 ms crossfade between patterns (no clicks mid-note)
            for (int i = 0; i < NST; i++)
            {
                stemG[i] += (stemT[i] - stemG[i]) * kx;
                loops[i].volume = Mathf.Clamp01(outG * stemG[i] * Volume);
            }
            for (int i = 0; i < 2; i++) riffSrc[i].volume = Mathf.Clamp01(outG * Volume);

            // bar lines: dead-ball riffs (organ), then start a queued riff phase-aligned with the loops
            int pos = loops[0].timeSamples, bar = pos / (SPS * 16);
            if (bar != lastBar)
            {
                lastBar = bar;
                riffPlaying = false; // a riff lasts one bar
                if (Mode == "organ" && Dead && (bar & 1) == 0 && rqN == 0)
                    rq[rqN++] = Offense ? (UnityEngine.Random.value < 0.5f ? 0 : 2) : 1;
                if (rqN > 0 && outG > 0.002f)
                {
                    int r = rq[0];
                    rq[0] = rq[1];
                    rqN--;
                    var src = riffSrc[riffTurn];
                    riffTurn ^= 1;
                    src.clip = riffClips[r];
                    src.timeSamples = Mathf.Min(pos % (SPS * 16), riffClips[r].samples - 1);
                    src.Play();
                    riffPlaying = true;
                    Chants.OnRiff(RN[r], (float)(pos % (SPS * 16)) / SR); // crowd call-and-response (CHARGE! / DE-FENSE)
                }
                else if (outG <= 0.002f) rqN = 0;
            }
        }

        /// <summary>game.ts loop(): which mode the arena is in.</summary>
        static void Pick()
        {
            Level = Mathf.Min(1, GameAudio.EXC * 0.8f + Mathf.Abs((float)TS.mom) * 0.5f);
            int meT = CT.Count > 0 ? (int)CT[0].tm : 0;
            Offense = pos == meT;
            Dead = rs > 0 || inb > 0 || ftq != null;
            bool game = gameLike();
            Mode = S == "intro" || (JB != null && S == "play") ? "pregame"
                : S == "half" || S == "over" || S == "pause" ? "calm"
                : S != "play" && RPL == null ? "off"
                : !game ? "pregame"
                : Util.T(TS.clutch) ? "clutch"
                : TS.run[1] >= 8 ? "hype"
                : "organ";
        }

        /// <summary>Offline renderer of the music.ts WebAudio voices into a buffer (wrapping for seamless loops).</summary>
        sealed class Synth
        {
            readonly float[] o;
            readonly bool wrap;
            ulong rs;
            public Synth(float[] buf, bool wrap, int seed) { o = buf; this.wrap = wrap; rs = (ulong)seed * 0x9E3779B97F4A7C15UL | 1; }
            double Noise()
            {
                rs ^= rs << 13; rs ^= rs >> 7; rs ^= rs << 17;
                return (rs >> 11) * (2.0 / 9007199254740992.0) - 1;
            }
            void Add(int i, double v)
            {
                if (i < 0) return;
                if (i >= o.Length) { if (!wrap) return; i %= o.Length; }
                o[i] += (float)v;
            }
            /// <summary>exponentialRampToValueAtTime(0.0001, t + d) from v (then held at 0.0001 until the voice stops).</summary>
            static double Env(double t, double d, double v)
            {
                v = Math.Max(0.0002, v);
                return t >= d ? 0.0001 : v * Math.Pow(0.0001 / v, t / d);
            }
            // RBJ biquad (WebAudio BiquadFilterNode: lowpass/highpass Q in dB -> ~Butterworth for the default; bandpass Q 1)
            struct Bq
            {
                double b0, b1, b2, a1, a2, x1, x2, y1, y2;
                public static Bq Make(int type, double f, double q)
                {
                    double w = 2 * Math.PI * Math.Min(f, SR * 0.45) / SR, cs = Math.Cos(w), al = Math.Sin(w) / (2 * q), a0 = 1 + al;
                    var b = new Bq();
                    if (type == 0) { b.b0 = (1 - cs) / 2 / a0; b.b1 = (1 - cs) / a0; b.b2 = b.b0; } // lowpass
                    else if (type == 1) { b.b0 = (1 + cs) / 2 / a0; b.b1 = -(1 + cs) / a0; b.b2 = b.b0; } // highpass
                    else { b.b0 = al / a0; b.b1 = 0; b.b2 = -al / a0; } // bandpass
                    b.a1 = -2 * cs / a0;
                    b.a2 = (1 - al) / a0;
                    return b;
                }
                public double Run(double x)
                {
                    double y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
                    x2 = x1; x1 = x; y2 = y1; y1 = y;
                    return y;
                }
            }

            public void Kick(int at, double v)
            {
                // 130 -> 42 Hz exponential sweep over .12 s, exp decay .22 s, stops at .25 s
                int n = (int)(0.25 * SR);
                double ph = 0;
                for (int i = 0; i < n; i++)
                {
                    double t = (double)i / SR, f = t < 0.12 ? 130 * Math.Pow(42 / 130.0, t / 0.12) : 42;
                    ph += 2 * Math.PI * f / SR;
                    Add(at + i, Math.Sin(ph) * Env(t, 0.22, v));
                }
            }
            void NoiseHit(int at, double d, double v, double f, int type)
            {
                var bq = Bq.Make(type, f, type == 2 ? 1 : 0.7071);
                int n = (int)((d + 0.02) * SR);
                for (int i = 0; i < n; i++) Add(at + i, bq.Run(Noise()) * Env((double)i / SR, d, v));
            }
            public void Snare(int at, double v) => NoiseHit(at, 0.16, v * 0.6, 1600, 2);
            public void Hat(int at, double v) => NoiseHit(at, 0.04, v * 0.5, 7000, 1);
            public void Clap(int at, double v)
            {
                for (int i = 0; i < 3; i++) NoiseHit(at + (int)(i * 0.012 * SR), 0.08, v * 0.5, 1200, 2);
            }
            /// <summary>Oscillator (0 sine, 1 triangle, 2 sawtooth) -> lowpass(cut) -> exp envelope.</summary>
            public void Tone(int at, double f, double d, int ty, double v, double cut)
            {
                var bq = Bq.Make(0, cut, 0.7071);
                int n = (int)((d + 0.02) * SR);
                double ph = 0, inc = f / SR;
                for (int i = 0; i < n; i++)
                {
                    double x = ty == 0 ? Math.Sin(2 * Math.PI * ph) : ty == 1 ? 1 - 4 * Math.Abs(ph - 0.5) : 2 * ph - 1;
                    ph += inc;
                    if (ph >= 1) ph -= 1;
                    Add(at + i, bq.Run(x) * Env((double)i / SR, d, v));
                }
            }
            /// <summary>Drawbar organ: fundamental + octave + 12th + 2 octaves (sines), 6.2 Hz vibrato, flat organ envelope.</summary>
            public void Organ(int at, double f, double d, double v)
            {
                int n = (int)((d + 0.05) * SR);
                double p1 = 0, p2 = 0, p3 = 0, p4 = 0, g0 = v * 0.25, hold = Math.Max(0.02, d - 0.04);
                for (int i = 0; i < n; i++)
                {
                    double t = (double)i / SR,
                        g = t < 0.012 ? g0 * t / 0.012 : t < hold ? g0 : t < d ? g0 * (1 - (t - hold) / Math.Max(1e-4, d - hold)) : 0,
                        vib = Math.Sin(2 * Math.PI * 6.2 * t) * f * 0.004; // one LFO into every partial's frequency (Hz)
                    if (g <= 0) continue;
                    p1 += 2 * Math.PI * (f + vib) / SR;
                    p2 += 2 * Math.PI * (2 * f + vib) / SR;
                    p3 += 2 * Math.PI * (3 * f + vib) / SR;
                    p4 += 2 * Math.PI * (4 * f + vib) / SR;
                    Add(at + i, g * (Math.Sin(p1) + 0.6 * Math.Sin(p2) + 0.35 * Math.Sin(p3) + 0.25 * Math.Sin(p4)));
                }
            }
        }
    }
}
