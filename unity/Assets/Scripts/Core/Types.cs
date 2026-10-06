// Shared core types for the C# port of src/core (sim.ts / pose.ts / modes.ts). Pure C#: no UnityEngine, so the same
// code runs in Unity (IL2CPP) and in the csc/.NET test harness (scripts/unity/cs.sh).
// Port conventions (see unity/PORTING.md): TS `undefined` numeric fields read as 0 -> plain double fields; fields the
// TS code tests against null/undefined (`??`, `!= null`) are double?; object fields are typed classes.
using System.Collections.Generic;

namespace Hoops.Core
{
    /// <summary>One tick of a human's intent. Edge flags are true only on the tick they happened.</summary>
    public sealed class Input
    {
        public double dx, dy;
        public bool sd, su, e, sb, post, lob, sp, sw, pf, to, ch, ds; // shoot down/up, pass, step-back, post, lob, sprint, switch, fake, timeout, challenge, defense call
        public double mv; // 1 hesi / 2 spin / 3 behind the back
        public Player pass;
        public double? mt, tp; // client-measured meter time / tempo tap (online)
        public Input Clone() => (Input)MemberwiseClone();
        public void Clear() { dx = dy = 0; sd = su = e = sb = post = lob = sp = sw = pf = to = ch = ds = false; mv = 0; pass = null; mt = tp = null; }
    }

    /// <summary>A human controlling one player. fixed = My Player (never auto-switches).</summary>
    public sealed class Ctrl
    {
        public string id;
        public int tm, idx;
        public bool fixed_;
        public double tempo;
        public Input inp = new Input();
        public Player lastO;
        public double lag; // seconds of one-way latency for lag-compensated contests (online)
    }

    /// <summary>Box score line.</summary>
    public sealed class Stats { public double pts, reb, ast, fgm, fga, tpm, tpa, blk, orb, chg, dv, sa, min, tov; }

    /// <summary>Scouting record per range [rim, mid, three]: decayed attempts, makes, contest.</summary>
    public sealed class Scout { public double[] a = new double[3], m = new double[3], c = new double[3]; }

    /// <summary>Effect for the shell: k = "t" text (world x/y/z or screen sx/sy), "s" sound, "x" excitement, "cm"
    /// commentary, "ban" banner, "end", "whistle", "shake", "slow", "chant", "ooh", "duck", "half", "mode", "tg".</summary>
    public sealed class Fx
    {
        public int id;
        public string k, s, c, ty, e, n, n2, sub;
        public double? x, y, z, sx, sy;
        public double f, d, v, w, tm;
        public bool hasTm;
        public Dictionary<string, object> o; // rare payloads (timing grade fields, mode events)
    }

    public static class Rng
    {
        // xorshift128+ -> [0,1): deterministic when seeded (parity tests seed the TS build with the same generator)
        static ulong s0 = 0x9E3779B97F4A7C15UL, s1 = 0xBF58476D1CE4E5B9UL;
        public static void Seed(ulong seed)
        {
            s0 = seed ^ 0x9E3779B97F4A7C15UL;
            s1 = (seed * 0xBF58476D1CE4E5B9UL) ^ 0x94D049BB133111EBUL;
            if (s0 == 0 && s1 == 0) s1 = 1;
            for (int i = 0; i < 8; i++) R();
        }
        /// <summary>Math.random() replacement.</summary>
        public static long N; // calls so far (parity traces)
        public static double R()
        {
            N++;
            ulong x = s0, y = s1;
            s0 = y;
            x ^= x << 23;
            s1 = x ^ y ^ (x >> 17) ^ (y >> 26);
            return ((s1 + y) >> 11) * (1.0 / 9007199254740992.0);
        }
    }
}
