// Port of tests/greens.ts: 400 perfectly timed jumpers from random spots (no defenders) -> expect >= 95% made with
// BallSim. Also checks that free flight is bit-identical to launch()'s aim pre-simulation (h = 1/120).
//   scripts/unity/cs.sh unity/CoreTests/Greens.cs [ball|plain|legacy|all] [N] [dt]
using System;
using System.Collections.Generic;
using Hoops.Core;
using static Hoops.Core.Sim;

static class Greens
{
    static void Main(string[] a)
    {
        string which = a.Length > 0 ? a[0] : "all";
        int N = a.Length > 1 ? int.Parse(a[1]) : 400;
        double dt = a.Length > 2 ? double.Parse(a[2], System.Globalization.CultureInfo.InvariantCulture) : 1 / 120.0;
        bool ok = true;
        foreach (var m in which == "all" ? new[] { "legacy", "plain", "ball", "ball+up" } : new[] { which })
        {
            double pct = Run(m, N, dt, out int bitBad, out int bitChecked);
            Console.WriteLine($"{m,-8} dt {dt:F4}: made {pct:F1}%" + (bitChecked > 0 ? $"  free-flight bit-identical {bitChecked - bitBad}/{bitChecked}" : ""));
            if (m != "legacy" && pct < 95) ok = false;
            if (bitBad > 0 && Math.Abs(dt - 1 / 120.0) < 1e-12) ok = false;
        }
        Console.WriteLine(ok ? "PASS" : "FAIL");
        Environment.Exit(ok ? 0 : 1);
    }

    static double Run(string mode, int N, double dt, out int bitBad, out int bitChecked)
    {
        Rng.Seed(7);
        cfg.NP = 5; cfg.MYM = 0; cfg.hand = true;
        cfg.input = c => new Input();
        BallSim bs = null;
        if (mode == "legacy") { cfg.physics = "legacy"; Phys.RAP = null; }
        else
        {
            cfg.physics = "rapier";
            Phys.RAP = bs = new BallSim { Extras = mode != "plain", UP = mode == "ball+up" ? 1 : 0 };
        }
        setCtrls(new List<Ctrl> { mkCtrl("p1", 0) });
        start(0);
        int made = 0, caught = 0, miss = 0;
        bitBad = 0; bitChecked = 0;
        var rnd = new Random(11);
        for (int i = 0; i < N; i++)
        {
            setup(0);
            var p = P[0];
            for (int k = 1; k < P.Count; k++) { P[k].x = 60; P[k].y = 20 + k * 8; }
            p.x = 480 + rnd.NextDouble() * 330; p.y = 60 + rnd.NextDouble() * 380; p.z = 20; p.vz = 0;
            p.mode = "s"; p.t = 0.4; p.sv = 0; p.rl = 0; p.mt = p.st == 1 ? 0.45 : 0.6;
            B.owner = p; B.mode = "held";
            launch(p);
            if (B.mode != "air") { i--; continue; } // (a foul / dunk path: not a jumper)
            // reference: launch's pre-simulation with the final aim
            double x = B.x, y = B.y, z = B.z, vx = B.vx, vy = B.vy, vz = B.vz, w0 = B.wv[0], w1 = B.wv[1];
            double h = 1.0 / 120, wd = 1 / (1 + h * 0.3);
            bool refOn = bs != null && i < 100 && Math.Abs(dt - h) < 1e-12, diverged = false;
            double T = 0; B.sc = 0;
            int contacts0 = bs?.Contacts ?? 0;
            while (T < 4 && B.z > -5)
            {
                bstep(dt); T += dt;
                if (refOn && !diverged)
                {
                    vx *= 1 - 0.1 * h;
                    vy *= 1 - 0.1 * h;
                    vz += 0.0032 * (w0 * vy - w1 * vx) * h - g * h;
                    double qz = z;
                    x += vx * h; y += vy * h; z += vz * h;
                    w0 *= wd; w1 *= wd;
                    if (bs.Contacts != contacts0) refOn = false; // touched something: the reference no longer applies
                    else if (x != B.x || y != B.y || z != B.z) { diverged = true; }
                    if (qz >= 100 && z < 100 && vz < 0) { bitChecked++; if (diverged) bitBad++; refOn = false; }
                }
                if (B.owner != null) break;
            }
            if (B.sc != 0) made++; else if (B.owner != null) caught++; else miss++;
        }
        Console.WriteLine($"  {mode}: made {made} caught {caught} miss {miss}" + (bs != null ? $"  rim hits {bs.RimHits} glass {bs.GlassHits} net steps {bs.NetSteps}" : ""));
        return 100.0 * made / N;
    }
}
