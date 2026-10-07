// BallSim contact tests: drop-test energy loss vs restitution, backspin bounce pass, rolling stop, spin -> roll
// transfer, and no tunnelling through the iron / glass at any speed.
//   scripts/unity/cs.sh unity/CoreTests/Bounce.cs
using System;
using Hoops.Core;
using static Hoops.Core.Sim;

static class Bounce
{
    const double H = 1 / 120.0;
    static int fails;
    static void Check(bool ok, string what)
    {
        Console.WriteLine((ok ? "  ok   " : "  FAIL ") + what);
        if (!ok) fails++;
    }
    static Ball Ball(double x, double y, double z, double vx, double vy, double vz, double w0 = 0, double w1 = 0, double w2 = 0)
    {
        var b = new Ball { x = x, y = y, z = z, vx = vx, vy = vy, vz = vz, mode = "air" };
        b.wv[0] = w0; b.wv[1] = w1; b.wv[2] = w2;
        return b;
    }

    static void Main()
    {
        var sim = new BallSim();

        // 1. drop test: apex ratio per bounce ~ e^2 (e = Average(.72 ball, .8 floor) = .76); speed ratio ~ e
        {
            var b = Ball(470, 250, 100, 0, 0, 0);
            double e = (0.72 + 0.8) / 2, prevVz = 0, apex = b.z, lastApex = -1;
            var apexes = new System.Collections.Generic.List<double> { b.z - BR };
            var ratios = new System.Collections.Generic.List<double>();
            bool rising = false;
            for (int i = 0; i < 120 * 8; i++)
            {
                double vzIn = b.vz;
                sim.Step(H, b);
                if (vzIn < -30 && b.vz > 0) ratios.Add(b.vz / -vzIn);
                if (b.vz > 0) { rising = true; apex = b.z; }
                else if (rising) { rising = false; apexes.Add(apex - BR); lastApex = apex; }
                prevVz = b.vz;
            }
            Console.WriteLine("drop from 100 px: apex heights " + string.Join(" ", apexes.ConvertAll(v => v.ToString("F1"))));
            Console.WriteLine("  speed ratios " + string.Join(" ", ratios.ConvertAll(v => v.ToString("F3"))) + $"  (e = {e:F3})");
            for (int k = 0; k < Math.Min(3, ratios.Count); k++) Check(Math.Abs(ratios[k] - e) < 0.02, $"bounce {k + 1}: speed ratio {ratios[k]:F3} ~ e {e:F3}");
            for (int k = 1; k < Math.Min(4, apexes.Count); k++) Check(Math.Abs(apexes[k] / apexes[k - 1] - e * e) < 0.06, $"bounce {k}: apex ratio {apexes[k] / apexes[k - 1]:F3} ~ e^2 {e * e:F3}");
            Check(b.z < BR + 0.5 && Math.Abs(b.vz) < 5, $"settled on the floor after 8 s (z {b.z:F2}, vz {b.vz:F2})");
        }

        // 2. bounce pass: backspin bites (slows / reverses), topspin skids on
        {
            double Pass(double vx, double vz, double w1)
            {
                var b = Ball(300, 250, 30, vx, 0, vz, 0, w1, 0);
                for (int i = 0; i < 120; i++)
                {
                    double before = b.vz;
                    sim.Step(H, b);
                    if (before < 0 && b.vz > 0) return b.vx;
                }
                return double.NaN;
            }
            double none = Pass(300, -150, 0), back = Pass(300, -150, -150), top = Pass(300, -150, 150), rev = Pass(100, -300, -150);
            Console.WriteLine($"bounce pass vx after the bounce (in 300): no spin {none:F0}, backspin {back:F0}, topspin {top:F0}; steep backspin (in 100) {rev:F0}");
            Check(back < none - 60, "backspin slows the bounce pass");
            Check(top > none, "topspin skids on faster than no spin");
            Check(rev < 0, "a steep backspin bounce comes back toward the passer");
        }

        // 3. a rolling ball stops within a few seconds
        {
            var b = Ball(300, 250, BR, 150, 0, 0, 0, 150 / BR, 0);
            double t = 0;
            while (t < 10 && (b.vx != 0 || b.vy != 0)) { sim.Step(H, b); t += H; }
            Console.WriteLine($"rolling at 150 px/s: stops after {t:F2} s, {b.x - 300:F0} px");
            Check(t < 5, "rolling ball stops within 5 s");
            Check(Math.Abs(b.z - BR) < 0.1, "rolls on the floor (no hop)");
        }

        // 4. spin -> velocity: a ball spinning in place, dropped, ends up rolling at ~2/7 R w0 (rolling without slipping)
        {
            double w0 = 60;
            var b = Ball(300, 250, 20, 0, 0, 0, 0, w0, 0);
            double vRoll = 0;
            for (int i = 0; i < 240; i++)
            {
                sim.Step(H, b);
                double slip = b.vx - b.wv[1] * BR;
                if (b.z < BR + 0.05 && Math.Abs(b.vz) < 3 && Math.Abs(slip) < 1) { vRoll = b.vx; break; }
            }
            double expect = 2.0 / 7 * BR * w0;
            Console.WriteLine($"spinning drop (w {w0}): rolls off at {vRoll:F1} px/s (2/7 R w0 = {expect:F1}, less a little damping/rolling resistance)");
            Check(vRoll > expect * 0.8 && vRoll <= expect * 1.02, "spin turns into rolling speed ~ 2/7 R w0");
        }

        // 5. a fast ball never passes through the iron or the glass
        {
            var rnd = new Random(5);
            int through = 0, n = 0, bounced = 0;
            double minClear = 1e9;
            for (int s = 0; s < 3000; s++)
            {
                int hp = s & 1;
                double hx = HXs[hp], a = rnd.NextDouble() * Math.PI * 2, sp = 600 + rnd.NextDouble() * 3400,
                    // aim at a point on the iron from 40 px away, random elevation
                    tx = hx + Math.Cos(a) * RR, ty = HY + Math.Sin(a) * RR, tz = 100 + (rnd.NextDouble() - 0.5) * 3,
                    el = (rnd.NextDouble() - 0.5) * 1.6, az = rnd.NextDouble() * Math.PI * 2,
                    dx = Math.Cos(az) * Math.Cos(el), dy = Math.Sin(az) * Math.Cos(el), dz = Math.Sin(el);
                var b = Ball(tx - dx * 40, ty - dy * 40, tz - dz * 40, dx * sp, dy * sp, dz * sp);
                if (Torus(b, hx) < BR + 0.55) continue; // starts inside the iron
                n++;
                int c0 = sim.RimHits;
                double px = b.x, py = b.y, pz = b.z;
                for (int i = 0; i < 12; i++)
                {
                    int cc = sim.Contacts;
                    sim.Step(H, b);
                    double clr = Torus(b, hx) - BR - 0.55;
                    if (clr < -0.05 && minClear >= -0.05) Console.WriteLine($"    inside: shot {s} step {i} clr {clr:F3} at ({b.x:F2},{b.y:F2},{b.z:F2}) v ({b.vx:F0},{b.vy:F0},{b.vz:F0}) speed {sp:F0}");
                    minClear = Math.Min(minClear, clr);
                    // the straight path of a step without any contact must stay clear of the tube
                    if (sim.Contacts == cc)
                        for (int k = 1; k < 40; k++)
                        {
                            double f = k / 40.0;
                            var q = Ball(px + (b.x - px) * f, py + (b.y - py) * f, pz + (b.z - pz) * f, 0, 0, 0);
                            if (Torus(q, hx) < BR + 0.55 - 0.05) { through++; if (through < 4) Console.WriteLine($"    through: shot {s} step {i} from ({px:F2},{py:F2},{pz:F2}) to ({b.x:F2},{b.y:F2},{b.z:F2}) v ({b.vx:F0},{b.vy:F0},{b.vz:F0})"); i = 99; break; }
                        }
                    px = b.x; py = b.y; pz = b.z;
                }
                if (sim.RimHits > c0) bounced++;
            }
            Console.WriteLine($"fast balls at the iron: {n} shots 600..4000 px/s, {bounced} hit it, tunnelled {through}, min clearance after a step {minClear:F3} px");
            Check(through == 0, "no ball passes through the iron");
            Check(minClear > -0.05, "never ends a step inside the iron");
            int glassThrough = 0;
            for (int s = 0; s < 200; s++)
            {
                double sp = 1000 + s * 20, zz = 100 + (s % 30);
                var b = Ball(860, 250 + (s % 40) - 20, zz, sp, 0, 0);
                for (int i = 0; i < 20; i++) sim.Step(H, b);
                if (b.x > 900 - BR + 0.05) glassThrough++;
            }
            Check(glassThrough == 0, $"200 balls at 1000..5000 px/s never get through the glass ({glassThrough})");
        }

        Console.WriteLine(fails == 0 ? "PASS" : $"FAIL ({fails})");
        Environment.Exit(fails == 0 ? 0 : 1);
    }

    static double Torus(Ball b, double hx)
    {
        double d = Math.Sqrt((b.x - hx) * (b.x - hx) + (b.y - HY) * (b.y - HY));
        return Math.Sqrt((d - RR) * (d - RR) + (b.z - 100) * (b.z - 100));
    }
}
