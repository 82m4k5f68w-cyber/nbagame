// BallSim contact tests: drop-test energy loss vs restitution, backspin bounce pass, rolling stop, spin -> roll
// transfer, and no tunnelling through the iron / glass at any speed; PH2 (UP=1) at both slider ends: the iron and the
// moving bones (head, upper arms, legs) of a running player.
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
            double e = Sim.cfg.PH3 != 0 ? Sim.SURF[0][0] : (0.72 + 0.8) / 2, prevVz = 0, apex = b.z, lastApex = -1; // (physics v3: the hardwood's own e)
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
            // (physics v3: real quadratic air drag takes up to ~10% off a rebound's height on top of e^2)
            for (int k = 1; k < Math.Min(4, apexes.Count); k++) Check(Math.Abs(apexes[k] / apexes[k - 1] - e * e) < (Sim.cfg.PH3 != 0 ? 0.1 : 0.06), $"bounce {k}: apex ratio {apexes[k] / apexes[k - 1]:F3} ~ e^2 {e * e:F3}");
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

        // 4. spin -> velocity: a ball spinning in place, dropped, leaves the first bounce rolling at 2/7 R w (rolling
        //    without slipping; angular momentum about the contact point is conserved)
        {
            var b = Ball(300, 250, 20, 0, 0, 0, 0, 60, 0);
            double vRoll = double.NaN, wHit = 0, slip = 0, vIn = 0;
            for (int i = 0; i < 240; i++)
            {
                double vzIn = b.vz, wIn = b.wv[1], vxIn = b.vx;
                sim.Step(H, b);
                if (vzIn < 0 && b.vz > 0) { vRoll = b.vx; wHit = wIn; vIn = vxIn; slip = b.vx - b.wv[1] * BR; break; }
            }
            // (angular momentum about the contact point: v' = (5 v + 2 R w) / 7; v is 0 unless Magnus (physics v3)
            // pushed the falling, spinning ball sideways first)
            double expect = (5 * vIn + 2 * BR * wHit) / 7;
            Console.WriteLine($"spinning drop: leaves the floor at {vRoll:F1} px/s (2/7 R w = {expect:F1}), slip after {slip:F2} px/s");
            Check(Math.Abs(vRoll - expect) < expect * 0.03, "spin turns into rolling speed 2/7 R w");
            Check(Math.Abs(slip) < 1, "rolling without slipping after the bounce");
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
            Check(minClear > -0.065, "never ends a step inside the iron"); // (vs the true torus: the 24 capsule chords sit up to RR (1 - cos(pi/24)) = .064 px inside it)
            int glassThrough = 0;
            for (int s = 0; s < 400; s++)
            {
                // straight at the glass above the rim (z 108..134 clears the iron), 1000..5000 px/s, both boards
                int hp = s & 1;
                double sp = 1000 + (s >> 1) * 20, zz = 108 + (s % 27), dir = hp == 1 ? 1 : -1, gx = hp == 1 ? 900 : 40;
                var b = Ball(gx - dir * 40, 250 + (s % 41) - 20, zz, dir * sp, 0, (s % 7 - 3) * 60);
                for (int i = 0; i < 20; i++)
                {
                    sim.Step(H, b);
                    if ((gx - b.x) * dir < BR - 0.05 && Math.Abs(b.y - HY) < 30 && b.z > 96 && b.z < 136) { glassThrough++; break; }
                }
            }
            Check(glassThrough == 0, $"400 balls at 1000..5000 px/s never get into / through the glass ({glassThrough})");
        }

        // 6. PH2 (cfg.UP = 1) at both ends of the slider: the iron (restitution now depends on PHYS + impact speed) and
        //    the new kinematic bones (head, upper arms, thighs, shins of a player running at 400 px/s) never get tunnelled
        foreach (var k in new[] { 0.0, 1.0 })
        {
            var s = new BallSim { UP = 1, PHYS = k };
            var rnd = new Random(8);
            int through = 0, n = 0, hit = 0;
            double minClear = 1e9;
            for (int sh = 0; sh < 1500; sh++)
            {
                double hx = HXs[sh & 1], a = rnd.NextDouble() * Math.PI * 2, sp = 600 + rnd.NextDouble() * 3400,
                    tx = hx + Math.Cos(a) * RR, ty = HY + Math.Sin(a) * RR, tz = 100 + (rnd.NextDouble() - 0.5) * 3,
                    el = (rnd.NextDouble() - 0.5) * 1.6, az = rnd.NextDouble() * Math.PI * 2,
                    dx = Math.Cos(az) * Math.Cos(el), dy = Math.Sin(az) * Math.Cos(el), dz = Math.Sin(el);
                var b = Ball(tx - dx * 40, ty - dy * 40, tz - dz * 40, dx * sp, dy * sp, dz * sp);
                b.sh = 1; b.age = 0.3;
                if (Torus(b, hx) < BR + 0.55) continue;
                n++;
                int c0 = s.RimHits;
                for (int i = 0; i < 12; i++)
                {
                    double px = b.x, py = b.y, pz = b.z;
                    int cc = s.Contacts;
                    s.Step(H, b);
                    minClear = Math.Min(minClear, Torus(b, hx) - BR - 0.55);
                    if (s.Contacts == cc)
                        for (int q = 1; q < 40; q++)
                        {
                            double f = q / 40.0;
                            var t = Ball(px + (b.x - px) * f, py + (b.y - py) * f, pz + (b.z - pz) * f, 0, 0, 0);
                            if (Torus(t, hx) < BR + 0.55 - 0.05) { through++; i = 99; break; }
                        }
                }
                if (s.RimHits > c0) hit++;
            }
            Check(through == 0 && minClear > -0.065, $"UP=1 PHYS {k}: {n} fast balls at the iron ({hit} hit it), tunnelled {through}, min clearance {minClear:F3}");
            // moving bones
            int inside = 0, contacts = 0, shots = 0;
            double worst = 0;
            var r2 = new Random(12);
            for (int sh = 0; sh < 600; sh++)
            {
                var p = Body(400, 250, (r2.NextDouble() - 0.5) * 24, r2.NextDouble() < 0.5);
                var P = new System.Collections.Generic.List<Player> { p };
                double vy = (r2.NextDouble() - 0.5) * 800; // he runs across at up to 400 px/s
                int bone = r2.Next(7), j0 = BONES[bone * 2], j1 = BONES[bone * 2 + 1];
                double u = r2.NextDouble(), gx = p.skel[j0 * 3] + (p.skel[j1 * 3] - p.skel[j0 * 3]) * u, gy = p.skel[j0 * 3 + 1] + (p.skel[j1 * 3 + 1] - p.skel[j0 * 3 + 1]) * u,
                    gz = p.skel[j0 * 3 + 2] + (p.skel[j1 * 3 + 2] - p.skel[j0 * 3 + 2]) * u,
                    sp = 300 + r2.NextDouble() * 2200, az = r2.NextDouble() * Math.PI * 2, el = (r2.NextDouble() - 0.3) * 0.8,
                    dx = Math.Cos(az) * Math.Cos(el), dy = Math.Sin(az) * Math.Cos(el), dz = Math.Sin(el);
                var b = Ball(gx - dx * 45, gy - dy * 45, Math.Max(BR + 0.5, gz - dz * 45), dx * sp, dy * sp, dz * sp);
                b.age = 0.5; b.sh = 0;
                shots++;
                s.ClearBodies();
                for (int t = 0; t < 12; t++)
                {
                    p.y += vy / 60; p.vy = vy;
                    for (int j = 1; j < 60; j += 3) p.skel[j] += (float)(vy / 60);
                    s.SyncPlayers(P, b);
                    bool legsOn = b.z < p.z + 46 && (b.vx * b.vx + (b.vy - vy) * (b.vy - vy)) > 110 * 110;
                    for (int h = 0; h < 2; h++)
                    {
                        int cc = s.Contacts;
                        b.age += H; s.Step(H, b);
                        contacts += s.Contacts - cc;
                        for (int q = 0; q < 7; q++)
                        {
                            if (q >= 3 && !legsOn) continue;
                            double pen = BR + BONER[q] - Seg(b, p.skel, BONES[q * 2], BONES[q * 2 + 1]);
                            if (pen > 0.05) { inside++; worst = Math.Max(worst, pen); }
                        }
                    }
                }
            }
            Check(inside == 0, $"UP=1 PHYS {k}: {shots} balls at 300..2500 px/s into the bones of a running player ({contacts} contacts): ended a step inside a bone {inside} times (worst {worst:F2} px)");
        }

        Console.WriteLine(fails == 0 ? "PASS" : $"FAIL ({fails})");
        Environment.Exit(fails == 0 ? 0 : 1);
    }

    // PH2 bones: head, upper arms, thighs, shins (as BallSim.BONE / BONER, build 1)
    static readonly int[] BONES = { 2, 3, 12, 13, 16, 17, 4, 5, 8, 9, 5, 6, 9, 10 };
    static readonly double[] BONER = { 4.6, 2.6, 2.6, 3.4, 3.4, 2.5, 2.5 };
    static double Seg(Ball b, float[] s, int a, int c)
    {
        double ax = s[a * 3], ay = s[a * 3 + 1], az = s[a * 3 + 2], vx = s[c * 3] - ax, vy = s[c * 3 + 1] - ay, vz = s[c * 3 + 2] - az,
            L2 = vx * vx + vy * vy + vz * vz, u = L2 > 0 ? Math.Max(0, Math.Min(1, ((b.x - ax) * vx + (b.y - ay) * vy + (b.z - az) * vz) / L2)) : 0,
            qx = b.x - ax - vx * u, qy = b.y - ay - vy * u, qz = b.z - az - vz * u;
        return Math.Sqrt(qx * qx + qy * qy + qz * qz);
    }
    /// <summary>A standing player with a hand-built skeleton (as PhysStats.Body).</summary>
    static Player Body(double x, double y, double legOut = 0, bool armsOut = false)
    {
        var p = new Player { x = x, y = y, z = 0, ht = 6.6, bk = 1, j = 70, skelOk = 1, skel = new float[60] };
        void J(int k, double jx, double jy, double jz) { p.skel[k * 3] = (float)(x + jx); p.skel[k * 3 + 1] = (float)(y + jy); p.skel[k * 3 + 2] = (float)jz; }
        J(0, 0, 0, 38); J(1, 0, 0, 48); J(2, 0, 0, 56); J(3, 0, 0, 62);
        J(4, 0, -4, 36); J(5, 1, -5, 20); J(6, 0, -5, 4); J(7, 3, -5, 1);
        J(8, 0, 4, 36); J(9, 1, 4 + legOut * 0.5, 20); J(10, 0, 4 + legOut, 4); J(11, 3, 4 + legOut, 1);
        double ao = armsOut ? 12 : 3;
        J(12, 0, -7, 53); J(13, 0, -7 - ao, armsOut ? 52 : 42); J(14, 2, -7 - ao * 1.6, armsOut ? 51 : 32); J(15, 3, -7 - ao * 1.9, armsOut ? 51 : 28);
        J(16, 0, 7, 53); J(17, 0, 7 + ao, armsOut ? 52 : 42); J(18, 2, 7 + ao * 1.6, armsOut ? 51 : 32); J(19, 3, 7 + ao * 1.9, armsOut ? 51 : 28);
        return p;
    }

    static double Torus(Ball b, double hx)
    {
        double d = Math.Sqrt((b.x - hx) * (b.x - hx) + (b.y - HY) * (b.y - HY));
        return Math.Sqrt((d - RR) * (d - RR) + (b.z - 100) * (b.z - 100));
    }
}
