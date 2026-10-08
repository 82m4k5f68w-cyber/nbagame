// Guide hand audit: while a shooter holds the ball in his set (mode 'c' from 0.12 s in, mode 's' until the release) the
// off hand's palm must sit on the side of the ball. Distance = | |guide palm - ball centre| - BR | in px, ball centre =
// the shooting palm (handPos, where the renderers pin the ball), guide palm = the same palm point in the other wrist
// frame. Seeded CPU 5v5 stretches; hooks / one-hand finishes / post moves are left out (no guide hand by design).
//   scripts/unity/cs.sh unity/CoreTests/GuideHand.cs UP=0|1 [secs=240] [worst=1] [ph2=0]
//@include unity/CoreTests/Common/*.cs
using System;
using System.Collections.Generic;
using Hoops.Core;
using static Hoops.Core.Sim;

static class GuideHand
{
    static readonly double[] GPv = new double[3];
    /// <summary>Palm point (0, -0.62, 0.1) in the guide (non-shooting) wrist frame.</summary>
    public static double[] GuidePalm(Player p)
    {
        var q = p.q;
        double m = q.mir;
        q.mir = m != 0 ? 0 : 1;
        var h = Pose.handPos(p);
        q.mir = m;
        GPv[0] = h[0]; GPv[1] = h[1]; GPv[2] = h[2];
        return GPv;
    }
    /// <summary>The guide hand belongs on the ball this tick (two-hand set, before the release).</summary>
    public static string Phase(Player p)
    {
        if (B.owner != p || p.q == null || !p.posed || p.postA != 0 || B.mode != "held") return null;
        int sv = (int)p.sv;
        if (p.mode == "c") return p.t >= 0.12 ? (ftq != null && ftq.s == p ? "ftSet" : p.gath != 0 ? "gather" : "set") : null;
        if (p.mode != "s" || Util.T(p.rl)) return null;
        if (sv == 10 || sv == 25 || p.hk != 0 && sv != 11 && sv != 14 && sv != 15) return null; // hooks, one-hand finishes
        if (Data.IsLaySv(sv) && sv != 11 && sv != 14 && sv != 15) return null;
        if (ftq != null || Util.T(B.ft)) return "ft";
        if (p.sv == 9 || p.sg != null && p.sg.cl != 0) return "curry";
        return sv == 24 ? "floater" : Data.IsDunkSv(sv) ? "dunk2" : "jumper";
    }
    static void Main(string[] a)
    {
        int up = UH.ArgI(a, "UP", 0), secs = UH.ArgI(a, "secs", 240);
        var bk = new Buckets();
        var worst = new List<(double d, string s)>();
        var miss = new Dictionary<string, int>();
        foreach (var (seed, ta, tb) in new[] { (91UL, 0, 3), (92UL, 5, 1), (93UL, 2, 6) })
        {
            UH.Game(seed, up, ta, tb, 150);
            Sim.PH2 = UH.Arg(a, "ph2", "1") != "0"; // (PH2 ball physics under UP; ph2=0 to measure without it)
            for (int i = 0; i < 60 * secs && UH.Tick(); i++)
            {
                if (S != "play") continue;
                var p = B.owner;
                if (p == null) continue;
                string ph = Phase(p);
                if (ph == null) continue;
                var h = Pose.handPos(p);
                double bx = h[0], by = h[1], bz = h[2];
                var g = GuidePalm(p);
                double d = Math.Abs(Math.Sqrt((g[0] - bx) * (g[0] - bx) + (g[1] - by) * (g[1] - by) + (g[2] - bz) * (g[2] - bz)) - BR);
                bk.Add(ph, d);
                if (d > 1.5) { string mk = ph + " sv" + p.sv + " " + p.n; miss.TryGetValue(mk, out int mc); miss[mk] = mc + 1; }
                if (d > 3) worst.Add((d, $"{UH.F(d, 2)} {ph} {p.n} md {p.mode} t {UH.F(p.t)} sv {p.sv} gs {(p.sg != null ? p.sg.gs : 0)} lockErr {UH.F(p.gdErr, 2)} w {UH.F(p.gdW, 2)} mir {p.q.mir} T {UH.F(T - UH.T0, 2)}"));
            }
        }
        Console.WriteLine($"UP={up} guide palm to ball surface (px), n {bk.All.Count}: p50 {UH.F(Buckets.Pct(bk.All, 0.5), 2)}  p95 {UH.F(Buckets.Pct(bk.All, 0.95), 2)}  p99 {UH.F(Buckets.Pct(bk.All, 0.99), 2)}  max {UH.F(Buckets.Max(bk.All), 2)}");
        var keys = new List<string>(bk.B.Keys); keys.Sort(StringComparer.Ordinal);
        foreach (var k in keys) { var l = bk.B[k]; Console.WriteLine($"  {k.PadRight(8)} n {l.Count,6}  p50 {UH.F(Buckets.Pct(l, 0.5), 2)}  p95 {UH.F(Buckets.Pct(l, 0.95), 2)}  max {UH.F(Buckets.Max(l), 2)}"); }
        if (UH.Arg(a, "worst", "0") == "1") foreach (var kv in miss) if (kv.Value >= 3) Console.WriteLine($"  miss>1.5 {kv.Key}: {kv.Value}");
        if (UH.Arg(a, "worst", "0") == "1") { worst.Sort((x, y) => y.d.CompareTo(x.d)); for (int i = 0; i < Math.Min(25, worst.Count); i++) Console.WriteLine("  worst " + worst[i].s); }
        bool ok = Buckets.Pct(bk.All, 0.95) <= 1.5;
        Console.WriteLine(ok ? "GUIDE OK" : "GUIDE FAIL (p95 > 1.5 px)");
        Environment.Exit(ok ? 0 : 1);
    }
}
