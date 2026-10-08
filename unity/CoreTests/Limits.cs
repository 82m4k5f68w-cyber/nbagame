// C# port of tests/limits.ts (+ per-feature counts): joint-limit audit over a seeded 5v5 stretch - knees and elbows
// never bend backwards, ankles stop at ~0.6 rad of dorsiflexion with the foot planted, the neck stays in range.
//   scripts/unity/cs.sh unity/CoreTests/Limits.cs UP=0|1 [secs=200]
//@include unity/CoreTests/Common/*.cs
using System;
using System.Collections.Generic;
using Hoops.Core;
using static Hoops.Core.Sim;

static class Limits
{
    static readonly string[] K = { "kL", "kR", "eL", "eR", "hp", "fL", "fR" };
    static readonly double[] LO = { -0.1, -0.1, -0.1, -0.1, -0.9, -0.7, -0.7 }, HI = { 2.7, 2.7, 2.8, 2.8, 0.85, 9, 9 };
    static void Main(string[] a)
    {
        int up = UH.ArgI(a, "UP", 0), secs = UH.ArgI(a, "secs", 200);
        var cnt = new Dictionary<string, int>();
        var n = new Dictionary<string, int>();
        int all = 0, bad = 0;
        string fired = "";
        foreach (var (seed, ta, tb) in new[] { (555UL, 4, 1), (556UL, 2, 6) })
        {
            UH.Game(seed, up, ta, tb, 120);
            for (int i = 0; i < 60 * secs && UH.Tick(); i++)
            {
                if (S != "play") continue;
                foreach (var p in P)
                {
                    if (p.off != 0 || !p.posed) continue;
                    all++;
                    string tag = upTag(p);
                    n.TryGetValue(tag, out int c0); n[tag] = c0 + 1;
                    for (int k = 0; k < K.Length; k++)
                    {
                        if (k >= 5 && (p.z > 1 || !(p.stp != null && p.stp.w > 0.9))) continue;
                        double v = p.q.Get(K[k]);
                        if (v < LO[k] || v > HI[k]) { bad++; string key = tag + "." + K[k]; cnt.TryGetValue(key, out int c); cnt[key] = c + 1; }
                    }
                }
            }
            fired += UH.Counts() + " | ";
        }
        var keys = new List<string>(cnt.Keys); keys.Sort(StringComparer.Ordinal);
        Console.WriteLine($"UP={up} player-ticks {all} outside the limits: {bad} ({UH.F(100.0 * bad / all)}%)");
        foreach (var k in keys) { string tag = k.Split('.')[0]; Console.WriteLine($"  {k.PadRight(18)} {cnt[k]} of {n[tag]} ({UH.F(100.0 * cnt[k] / n[tag], 2)}%)"); }
        if (up != 0) Console.WriteLine("UP features fired: " + fired);
        bool ok = (double)bad / all < 0.002;
        Console.WriteLine(ok ? "LIMITS OK" : "LIMITS FAIL");
        Environment.Exit(ok ? 0 : 1);
    }
}
