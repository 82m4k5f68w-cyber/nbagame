// C# port of tests/footslide.ts (+ per-feature numbers): the same seeded 5v5 stretch with core foot planting
// (cfg.PLANT=1) and without. A foot is on the floor when its ankle is within 1 px of it; sliding = how fast such a foot
// moves over the floor (px/s), measured on the analytic skeleton. Planting must cut sliding to < 20% without buying
// it with leg pops (leg jerk p99.9 < 1.9x).   scripts/unity/cs.sh unity/CoreTests/FootSlide.cs UP=0|1 [secs=90]
//@include unity/CoreTests/Common/*.cs
using System;
using System.Collections.Generic;
using Hoops.Core;
using static Hoops.Core.Sim;

static class FootSlide
{
    static readonly string[] NAME = { "idle", "run", "def", "drib", "shot", "air", "move", "post", "scr", "cel", "rest", "cat" };
    static readonly int[] LEG = { 0, 1, 2, 3, 22, 23, 16, 26, 9 }; // tL tR kL kR fL fR hz hs cr

    static (double j, double v, string rows, string feat) Run(int plant, int up, int secs)
    {
        UH.Game(777, up, 0, 1);
        cfg.PLANT = plant;
        setup(0); setInb(0);
        var SK = new float[60];
        var prev = new Dictionary<Player, double[]>();
        var jk = new Jerk(LEG, 15);
        var by = new Dictionary<string, double[]>();
        var byF = new Dictionary<string, double[]>();
        double slide = 0, contact = 0;
        for (int i = 0; i < 60 * secs && UH.Tick(); i++)
        {
            if (S != "play") { prev.Clear(); jk.Reset(); continue; }
            foreach (var p in P)
            {
                if (p.off != 0) continue;
                string tag = upTag(p);
                jk.Track(p, tag);
                if (p.z > 1) { prev.Remove(p); continue; }
                Pose.skeleton(p, SK);
                double[] f = { SK[18], SK[19], SK[20], SK[30], SK[31], SK[32], p.x, p.y }; // ankles L (6), R (10)
                if (prev.TryGetValue(p, out var pf) && Math.Sqrt((p.x - pf[6]) * (p.x - pf[6]) + (p.y - pf[7]) * (p.y - pf[7])) < 15)
                    foreach (int o in new[] { 0, 3 })
                        if (f[o + 2] < 1 && pf[o + 2] < 1)
                        {
                            double d = Math.Sqrt((f[o] - pf[o]) * (f[o] - pf[o]) + (f[o + 1] - pf[o + 1]) * (f[o + 1] - pf[o + 1]));
                            slide += d; contact += 1 / 60.0;
                            int ai = (int)p.anS; string k = ai >= 0 && ai < NAME.Length ? NAME[ai] : "?";
                            if (!by.TryGetValue(k, out var r)) by[k] = r = new double[2];
                            r[0] += d; r[1] += 1 / 60.0;
                            if (!byF.TryGetValue(tag, out var rf)) byF[tag] = rf = new double[2];
                            rf[0] += d; rf[1] += 1 / 60.0;
                        }
                prev[p] = f;
            }
        }
        string rows = "";
        foreach (var n in NAME) if (by.TryGetValue(n, out var r) && r[1] > 0) rows += $"{n}:{r[0] / r[1]:F0} ";
        var keys = new List<string>(byF.Keys); keys.Sort(StringComparer.Ordinal);
        string feat = "";
        foreach (var k in keys) if (byF[k][1] > 1) feat += $"{k}:{byF[k][0] / byF[k][1]:F0} ";
        return (Buckets.Pct(jk.J.All, 0.999), slide / Math.Max(1e-9, contact), rows, feat);
    }

    static void Main(string[] a)
    {
        int up = UH.ArgI(a, "UP", 0), secs = UH.ArgI(a, "secs", 90);
        var off = Run(0, up, secs);
        var on = Run(1, up, secs);
        cfg.PLANT = 1;
        Console.WriteLine($"UP={up} foot slide px/s  off: {UH.F(off.v, 1)} | {off.rows}\n                 on:  {UH.F(on.v, 1)} | {on.rows}");
        Console.WriteLine($"  per feature (on): {on.feat}");
        Console.WriteLine($"leg jerk p99.9   off: {UH.F(off.j)}  on: {UH.F(on.j)}");
        bool ok = on.v < off.v * 0.2 && on.j < off.j * 1.9;
        Console.WriteLine(ok ? "FOOTSLIDE OK" : "FOOTSLIDE FAIL");
        Environment.Exit(ok ? 0 : 1);
    }
}
