// C# port of tests/blend.ts (+ per-feature numbers): the same seeded 5v5 stretches with inertialized blending
// (cfg.INZ=1) and the old exponential smoothing (INZ=0); jerk = 2nd difference of every joint per tick (wrist snaps
// and grips excluded). Inertialization must cut the pops, follow the targets about as closely, and keep the layup arm
// as quick as the old blend.   scripts/unity/cs.sh unity/CoreTests/Blend.cs UP=0|1 [secs=150]
//@include unity/CoreTests/Common/*.cs
using System;
using System.Collections.Generic;
using Hoops.Core;
using static Hoops.Core.Sim;

static class Blend
{
    static readonly int[] CH = BuildCh();
    static int[] BuildCh() { var l = new List<int>(); for (int j = 0; j < 31; j++) if (j != 13 && j != 14 && j != 24 && j != 25) l.Add(j); return l.ToArray(); }

    static (double p999, double max, double lag, Jerk jk, string cnt) Run(int inz, int up, int secs)
    {
        var jk = new Jerk(CH, 20);
        double lag = 0; long ln = 0;
        string cnt = "";
        foreach (ulong seed in new ulong[] { 12345, 777 })
        {
            UH.Game(seed, up, seed == 12345 ? 0 : 3, seed == 12345 ? 1 : 5);
            cfg.INZ = inz; cfg.PLANT = 0; cfg.AVOID = 0; // blending alone (placement and avoidance have their own tests)
            setup(0); setInb(0);
            jk.Reset();
            for (int i = 0; i < 60 * secs && UH.Tick(); i++)
            {
                if (S != "play") { jk.Reset(); continue; }
                foreach (var p in P)
                {
                    if (p.off != 0) continue;
                    jk.Track(p, upTag(p));
                    if (DUMP != null && inz == 1 && p.n == DUMP[0] && T - UH.T0 >= double.Parse(DUMP[1]) && T - UH.T0 <= double.Parse(DUMP[2]))
                    {
                        int c = Q.Idx(DUMP[3]);
                        Console.WriteLine($"{UH.F(T - UH.T0)} md {p.mode} t {UH.F(p.t)} sv {p.sv} gath {p.gath} gT {UH.F(p.gathT)} st {p.anS} q {UH.F(p.q[c])} tgt {UH.F(p.inz.pt[c])} has {B.owner == p} z {UH.F(p.z, 1)} mvT {UH.F(p.mvT)} mvk {p.mvk} tag {upTag(p)} hold {heldBall(p)} ctR {UH.F(p.ctR)} ctL {UH.F(p.ctL)} sp {UH.F(Math.Sqrt(p.vx*p.vx+p.vy*p.vy),0)}");
                    }
                    if (p.inz != null) for (int j = 0; j < 31; j++) if (j != 13) { lag += Math.Abs(p.q[j] - p.inz.pt[j]); ln++; }
                }
            }
            cnt += UH.Counts() + " | ";
        }
        cfg.PLANT = 1; cfg.AVOID = 1; cfg.INZ = 1;
        var all = jk.J.All;
        return (Buckets.Pct(all, 0.999), Buckets.Max(all), lag / Math.Max(1, ln), jk, cnt);
    }

    // shot timing: the shooting arm must rise into a layup as fast as with the old smoothing
    static double[] LayArm(int inz, int up)
    {
        cfg.NP = 1; cfg.INZ = inz; cfg.UP = up; setCtrls(new List<Ctrl>()); start(0, new StartOpts()); setup(0); setInb(0);
        var p = P[0];
        p.x = 850; p.y = 250; p.f = 0; p.vx = p.vy = 0; p.inz = null; p.q = null; p.posed = false;
        var o = new double[40];
        for (int i = 0; i < 40; i++)
        {
            double t = Math.Max(0, 0.25 - (39 - i) / 60.0);
            p.mode = t > 0 ? "s" : "i"; p.sv = 5; p.t = t; p.z = 20; B.owner = p; B.mode = "held";
            Pose.pose3(p);
            o[i] = p.q.aR;
        }
        cfg.NP = 5; cfg.INZ = 1;
        return o;
    }

    static string[] DUMP;
    static void Main(string[] a)
    {
        var dm = UH.Arg(a, "dump", ""); if (dm != "") DUMP = dm.Split(':');
        int up = UH.ArgI(a, "UP", 0), secs = UH.ArgI(a, "secs", 150);
        var la0 = LayArm(0, up); var la1 = LayArm(1, up);
        double shotLag = 0;
        for (int i = 0; i < 40; i++) shotLag = Math.Max(shotLag, Math.Abs(la0[i] - la1[i]));
        Console.WriteLine($"UP={up}  layup arm max gap vs old blend (rad): {UH.F(shotLag)}");
        var old = Run(0, up, secs);
        var inz = Run(1, up, secs);
        Console.WriteLine($"old:          p99.9 {UH.F(old.p999)} max {UH.F(old.max, 2)} lag {UH.F(old.lag, 4)}");
        Console.WriteLine($"inertialized: p99.9 {UH.F(inz.p999)} max {UH.F(inz.max, 2)} lag {UH.F(inz.lag, 4)}");
        Console.WriteLine("per feature (inertialized):\n" + inz.jk.Report());
        if (UH.Arg(a, "worst", "0") == "1") foreach (var kv in inz.jk.WorstAt) Console.WriteLine("  worst " + kv.Key + ": " + kv.Value);
        if (up != 0) Console.WriteLine("UP features fired: " + inz.cnt);
        bool ok = inz.p999 < old.p999 * 0.7 && inz.max < Math.Max(old.max * 0.5, 1.3) && inz.lag <= old.lag * 1.3 && shotLag < 0.3;
        Console.WriteLine(ok ? "BLEND OK" : "BLEND FAIL");
        Environment.Exit(ok ? 0 : 1);
    }
}
