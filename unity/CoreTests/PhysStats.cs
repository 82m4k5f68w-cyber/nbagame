// BallSim extras + a physics stats dump (bounce heights, roll-outs, materials, net, bank shots, rim touch, bodies).
// Each block prints its numbers and checks the behaviour it is there for.
//   scripts/unity/cs.sh unity/CoreTests/PhysStats.cs
using System;
using System.Collections.Generic;
using Hoops.Core;
using static Hoops.Core.Sim;

static class PhysStats
{
    const double H = 1 / 120.0;
    static int fails;
    static readonly List<Player> NOP = new List<Player>();
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
    /// <summary>One sim tick worth of ball: SyncPlayers (rim spring) + two half steps, like Sim.upd.</summary>
    static void Tick(BallSim s, Ball b, List<Player> P = null)
    {
        s.SyncPlayers(P ?? NOP, b);
        for (int k = 0; k < 2; k++) { b.age += H; s.Step(H, b); }
    }
    /// <summary>Normal speed ratio of the first impact (|vn out| / |vn in|) along axis n.</summary>
    static double Ratio(BallSim s, Ball b, double nx, double ny, double nz)
    {
        double vin = -(b.vx * nx + b.vy * ny + b.vz * nz);
        int c0 = s.Contacts;
        for (int i = 0; i < 60 && s.Contacts == c0; i++) s.Step(H, b);
        return (b.vx * nx + b.vy * ny + b.vz * nz) / vin;
    }
    /// <summary>Fly a shot; made = the sim's rule (down through the ring plane well inside the iron).</summary>
    static bool Shot(BallSim s, Ball b, double hx, out double best, double maxT = 3)
    {
        best = 99;
        for (double t = 0; t < maxT; t += H)
        {
            double pz = b.z;
            b.age += H;
            s.Step(H, b);
            double d = Math.Sqrt((b.x - hx) * (b.x - hx) + (b.y - HY) * (b.y - HY));
            if (pz >= 100 && b.z < 100 && b.vz < 0) { best = Math.Min(best, d); if (d < RR - 1.2) return true; }
            if (b.z < BR + 0.5 && b.vz <= 0 && t > 0.3) return false;
        }
        return false;
    }
    /// <summary>A jumper from (x0, y0, z0) at a target point beside the hoop centre, aimed like Sim.launch (drag +
    /// Magnus pre-simulation), with launch's backspin.</summary>
    static Ball Aim(double x0, double y0, double z0, double tx, double ty)
    {
        double dx = tx - x0, dy = ty - y0, D = Math.Sqrt(dx * dx + dy * dy), dz = 100 - z0, th = D < 200 ? 0.9 : 0.86;
        double v = Math.Sqrt(g * D * D / (2 * Math.Pow(Math.Cos(th), 2) * Math.Max(1, D * Math.Tan(th) - dz)));
        double ge = g - 0.0032 * 16 * v * Math.Cos(th);
        v = Math.Sqrt(ge * D * D / (2 * Math.Pow(Math.Cos(th), 2) * Math.Max(1, D * Math.Tan(th) - dz)));
        var b = Ball(x0, y0, z0, 0, 0, v * Math.Sin(th));
        double TF = (b.vz + Math.Sqrt(Math.Max(0, b.vz * b.vz + 2 * ge * (z0 - 100)))) / ge, hv = D * 0.1 / (1 - Math.Exp(-0.1 * TF));
        b.vx = hv * dx / D; b.vy = hv * dy / D;
        for (int it = 0; it < 7; it++)
        {
            double hh = Math.Sqrt(b.vx * b.vx + b.vy * b.vy);
            b.wv[0] = 16 * b.vy / hh; b.wv[1] = -16 * b.vx / hh;
            double x = x0, y = y0, z = z0, vx = b.vx, vy = b.vy, vz = b.vz, T2 = 0, w0 = b.wv[0], w1 = b.wv[1], h = 1.0 / 120, wd = 1 / (1 + h * 0.3);
            while (T2 < 4)
            {
                vx *= 1 - 0.1 * h; vy *= 1 - 0.1 * h;
                vz += 0.0032 * (w0 * vy - w1 * vx) * h - g * h;
                double qz = z;
                x += vx * h; y += vy * h; z += vz * h; w0 *= wd; w1 *= wd; T2 += h;
                if (qz >= 100 && z < 100 && vz < 0) break;
            }
            b.vx += (tx - x) / Math.Max(0.2, T2) * 0.9;
            b.vy += (ty - y) / Math.Max(0.2, T2) * 0.9;
        }
        double h4 = Math.Sqrt(b.vx * b.vx + b.vy * b.vy);
        b.wv[0] = 16 * b.vy / h4; b.wv[1] = -16 * b.vx / h4;
        return b;
    }

    static void Main()
    {
        double hx = HXs[1];

        Console.WriteLine("== floor: bounce heights (dropped from rim height, z 100) ==");
        {
            var s = new BallSim();
            var b = Ball(470, 250, 100, 0, 0, 0);
            var ap = new List<double>();
            bool up = false; double apex = 0;
            for (int i = 0; i < 120 * 6; i++)
            {
                s.Step(H, b);
                if (b.vz > 0) { up = true; apex = b.z; } else if (up) { up = false; ap.Add(apex - BR); }
            }
            Console.WriteLine("  apexes (ball bottom, px): " + string.Join("  ", ap.ConvertAll(v => v.ToString("F1"))));
            Check(ap.Count > 4 && ap[0] > 50 && ap[0] < 62, "first bounce from 10 ft comes back to 5-6 ft (e .76)");
        }

        Console.WriteLine("== (1) net: a swish through the cloth net (Sim.NETS, two-way with netSim) ==");
        {
            double Exit(bool extras, out double tNet, out double snap)
            {
                var s = new BallSim { Extras = extras };
                var b = B; // the sim ball: netSim reads it
                b.x = hx; b.y = HY; b.z = 112; b.vx = 30; b.vy = 0; b.vz = -260; b.mode = "air"; b.owner = null; b.sc = 1; b.wv[0] = b.wv[1] = b.wv[2] = 0;
                tNet = 0; snap = 0;
                double vExit = 0;
                for (int i = 0; i < 120; i++)
                {
                    s.Step(H, b);
                    if (i % 2 == 1) netSim(1 / 60.0);
                    if (b.z < 99 && b.z > 78) tNet += H;
                    snap = Math.Max(snap, BallSim.NetSnap[1]);
                    if (b.z < 78) { vExit = b.vz; break; }
                }
                return vExit;
            }
            double v0 = Exit(false, out double t0, out _), v1 = Exit(true, out double t1, out double sn);
            Console.WriteLine($"  exit speed below the net: no coupling {-v0:F0} px/s ({t0 * 1000:F0} ms in the net), coupled {-v1:F0} px/s ({t1 * 1000:F0} ms), snap {sn:F2}");
            Check(-v1 < -v0 - 15, "the net slows a swish");
            Check(t1 < 0.25 && v1 < 0, "and still lets it drop through");
            Check(sn > 0.1, "snap is reported for FX");
        }

        Console.WriteLine("== (2) backboard: glass / frame / padding (normal speed ratio, 400 px/s straight in) ==");
        double rGlass, rFrame, rPad;
        {
            var s = new BallSim();
            rGlass = Ratio(s, Ball(880, 262, 120, 400, 0, 0), -1, 0, 0);
            rFrame = Ratio(s, Ball(880, 250, 135.2, 400, 0, 0), -1, 0, 0);
            rPad = Ratio(s, Ball(880, 262, 93.5, 400, 0, 0), -1, 0, 0);
            var p = new BallSim { Extras = false };
            double rPlain = Ratio(p, Ball(880, 262, 120, 400, 0, 0), -1, 0, 0);
            Console.WriteLine($"  glass {rGlass:F3} (Rapier world {rPlain:F3})  frame {rFrame:F3}  padding {rPad:F3}");
            Check(rPad < 0.5 && rPad < rFrame && rFrame < rGlass, "padding dead < frame < lively glass");
        }
        {
            // bank shots: per wing spot, find the best glass aim on a grid, then 60 shots with release jitter
            var s = new BallSim();
            double tot = 0; int spots = 0;
            bool det = true;
            foreach (var sp in new[] { (110.0, 45.0), (140.0, 45.0), (170.0, 40.0), (110.0, -45.0), (140.0, -45.0), (170.0, -40.0) })
            {
                double a = sp.Item2 * Math.PI / 180, x0 = hx - Math.Cos(a) * sp.Item1, y0 = HY + Math.Sin(a) * sp.Item1, z0 = 82;
                double bestD = 99, bgy = 0, bgz = 0;
                for (double gy = -22; gy <= 22; gy += 1)
                    for (double gz = 104; gz <= 132; gz += 1)
                    {
                        var b = Bank(x0, y0, z0, HY + gy, gz, 0, 0);
                        Shot(s, b, hx, out double d);
                        if (d < bestD) { bestD = d; bgy = gy; bgz = gz; }
                    }
                var rnd = new Random(3);
                int made = 0;
                for (int k = 0; k < 60; k++)
                {
                    double j1 = (rnd.NextDouble() - 0.5) * 0.012, j2 = (rnd.NextDouble() - 0.5) * 0.02;
                    if (Shot(s, Bank(x0, y0, z0, HY + bgy, bgz, j1, j2), hx, out _)) made++;
                }
                // determinism: the same release twice = the same result, to the bit
                var b1 = Bank(x0, y0, z0, HY + bgy, bgz, 0.003, 0.004); var b2 = Bank(x0, y0, z0, HY + bgy, bgz, 0.003, 0.004);
                Shot(new BallSim(), b1, hx, out _); Shot(new BallSim(), b2, hx, out _);
                if (b1.x != b2.x || b1.y != b2.y || b1.z != b2.z) det = false;
                Console.WriteLine($"  bank from {sp.Item1 / 10:F0} ft at {sp.Item2:F0} deg: aim glass y {bgy:+0;-0} z {bgz:F0} (best miss {bestD:F2} px), {made}/60 with jitter");
                tot += made / 60.0; spots++;
            }
            Check(tot / spots > 0.6, $"bank shots off the square go in consistently ({100 * tot / spots:F0}% with release jitter)");
            Check(det, "bit-identical replays of the same bank shot");
        }

        Console.WriteLine("== (3) rim: front iron vs back iron by the hook, flex, shooter's touch ==");
        {
            var s = new BallSim();
            double front = Ratio(s, Ball(hx, HY, 100, -300, 0, 0), 1, 0, 0); // from the middle out to the front iron
            double back = Ratio(s, Ball(hx, HY, 100, 300, 0, 0), -1, 0, 0); // ... and to the back iron by the bracket
            double side = Ratio(s, Ball(hx, HY, 100, 0, 300, 0), 0, -1, 0);
            Console.WriteLine($"  normal speed ratio: front iron {front:F3}, side {side:F3}, back iron (hook) {back:F3}");
            Check(back < front - 0.05, "the back iron by the bracket is deader than the front iron");
            // flex
            for (int h = 0; h < 2; h++) { BallSim.RimFlex[h] = 0; BallSim.RimFlexV[h] = 0; }
            var bh = Ball(hx - RR + 0.5, HY, 112, 0, 0, -500); // slammed onto the front iron
            double pk = 0;
            for (int i = 0; i < 40; i++) { Tick(s, bh); pk = Math.Max(pk, BallSim.RimFlex[1]); }
            var bd = Ball(hx, HY, 116, 0, 0, -130); bd.dk = 1; bd.sh = 1; // a dunk
            for (int h = 0; h < 2; h++) { BallSim.RimFlex[h] = 0; BallSim.RimFlexV[h] = 0; }
            double pd = 0;
            for (int i = 0; i < 40; i++) { Tick(s, bd); pd = Math.Max(pd, BallSim.RimFlex[1]); }
            for (int i = 0; i < 120; i++) Tick(s, Ball(470, 250, 300, 0, 0, 0));
            Console.WriteLine($"  rim flex peak: hard hit {pk:F2} px, dunk {pd:F2} px; settles to {BallSim.RimFlex[1]:F3} px after 2 s");
            Check(pk > 0.2 && pd > 1 && pd < 4.01, "rim flexes on hard hits and dunks (renderer: BallSim.RimFlex)");
            Check(Math.Abs(BallSim.RimFlex[1]) < 0.02, "and springs back");
            // shooter's touch (UP): near misses off the iron, low vs high touch
            var rnd = new Random(9);
            int[] mk = new int[3];
            double[] er = new double[3];
            var shooters = new[] { new Player { c = 60, i = 60 }, new Player { c = 96, i = 90 } };
            for (int k = 0; k < 600; k++)
            {
                double a = rnd.NextDouble() * Math.PI * 2, off = 3.4 + rnd.NextDouble() * 2.2, D = 120 + rnd.NextDouble() * 160, sa = (rnd.NextDouble() - 0.5) * 2.4;
                double x0 = hx - Math.Cos(sa) * D, y0 = HY + Math.Sin(sa) * D;
                for (int m = 0; m < 3; m++)
                {
                    var s2 = new BallSim { UP = m == 0 ? 0 : 1 };
                    var b = Aim(x0, y0, 82, hx + Math.Cos(a) * off, HY + Math.Sin(a) * off);
                    b.sh = 1; b.three = D >= 237 ? 1 : 0; b.last = shooters[m == 2 ? 1 : 0];
                    if (Shot(s2, b, hx, out _)) mk[m]++;
                }
            }
            Console.WriteLine($"  near misses (3.4-5.6 px off centre) that drop: UP=0 {mk[0] / 6.0:F1}%, UP=1 low touch {mk[1] / 6.0:F1}%, UP=1 high touch {mk[2] / 6.0:F1}%");
            var sT = new BallSim { UP = 1 };
            var bt = Ball(hx, HY, 100, -300, 0, 0); bt.sh = 1; bt.last = shooters[1];
            bt.age = 0; sT.Step(H, bt); // (new flight)
            double fT = Ratio(sT, bt, 1, 0, 0);
            Console.WriteLine($"  front iron ratio with a high-touch shooter (UP=1): {fT:F3} (vs {front:F3})");
            Check(fT < front - 0.05, "a soft touch takes the bounce out of the iron");
            Check(mk[2] > mk[0], "more friendly rolls for a high-touch shooter");
            Check(mk[1] == mk[0], "a low-touch shooter gets the plain iron");
        }

        Console.WriteLine("== (4) spin: floor grabs it, rim / glass trade spin for velocity ==");
        {
            double Spin(bool ex)
            {
                var s = new BallSim { Extras = ex };
                var b = Ball(300, 250, BR, 0, 0, 0, 0, 0, 40);
                for (int i = 0; i < 120; i++) s.Step(H, b);
                return b.wv[2];
            }
            double w0 = Spin(false), w1 = Spin(true);
            Console.WriteLine($"  a ball spinning on the floor (40 rad/s about vertical) after 1 s: air damping only {w0:F1}, with the floor {w1:F1}");
            Check(w1 < w0 * 0.3, "spin dies much faster on the wood");
            var s1 = new BallSim();
            double Gl(double w) { var b = Ball(880, 262, 120, 400, 0, 0, 0, w, 0); s1.Ratio0(b); return b.vz; }
            double none = Gl(0), back = Gl(-25), top = Gl(25);
            Console.WriteLine($"  off the glass (400 px/s in): vz after no spin {none:F0}, backspin {back:F0}, topspin {top:F0}");
            Check(back < none - 20 && top > none + 20, "backspin kicks it down off the glass, topspin up");
            double Rm(double w) { var b = Ball(hx - RR - 1.5, HY, 110, 0, 0, -150, 0, w, 0); var s = new BallSim(); int c0 = s.Contacts; for (int i = 0; i < 60 && s.Contacts == c0; i++) s.Step(H, b); return b.vx; }
            double rn = Rm(0), rb = Rm(-60), rt = Rm(60);
            Console.WriteLine($"  dropped on the front iron: vx after no spin {rn:F0}, backspin {rb:F0}, topspin {rt:F0} (+ = toward the rim)");
            Check(rt > rn && rb < rn, "rim english: topspin rolls in, backspin kicks out");
        }

        Console.WriteLine("== (5) bodies: leaning torso, hands for loose balls only ==");
        {
            Player Mk(double lean, bool armsUp)
            {
                var p = new Player { x = 400, y = 250, z = 0, ht = 6.6, bk = 1, j = 80, skelOk = 1, skel = new float[60] };
                void J(int k, double x, double y, double z) { p.skel[k * 3] = (float)x; p.skel[k * 3 + 1] = (float)y; p.skel[k * 3 + 2] = (float)z; }
                J(0, 400, 250, 38); J(2, 400 + lean, 250, 56);
                double hz = armsUp ? 1 : 0;
                J(13, 398, 244, armsUp ? 70 : 48); J(14, 398, 244, armsUp ? 86 : 38); J(15, 398, 244, armsUp ? 92 : 32);
                J(17, 402, 256, armsUp ? 70 : 48); J(18, 402, 256, armsUp ? 86 : 38); J(19, 402, 256, armsUp ? 92 : 32);
                return p;
            }
            int Hits(BallSim s, Player p, Ball b, Func<BallSim, int> what)
            {
                var P = new List<Player> { p };
                int h0 = what(s);
                for (int i = 0; i < 40; i++) { s.SyncPlayers(P, b); s.Step(H, b); s.Step(H, b); }
                return what(s) - h0;
            }
            Ball Drop(double x, double z, double sh, double y = 250) { var b = Ball(x, y, z, 0, 0, -40); b.age = 0.5; b.sh = sh; b.last = null; return b; }
            int lean = Hits(new BallSim(), Mk(16, false), Drop(418, 80, 0), q => q.BodyHits),
                straight = Hits(new BallSim { Extras = false }, Mk(16, false), Drop(418, 80, 0), q => q.BodyHits);
            Console.WriteLine($"  ball dropped 18 px in front of a leaning player: hits {lean} (upright Rapier capsule {straight})");
            Check(lean > 0 && straight == 0, "the torso capsule leans with the pose");
            int tip = Hits(new BallSim(), Mk(0, true), Drop(398, 112, 0, 245), q => q.ArmHits),
                shot = Hits(new BallSim(), Mk(0, true), Drop(398, 112, 1, 245), q => q.ArmHits),
                low = Hits(new BallSim(), Mk(0, false), Drop(398, 112, 0, 245), q => q.ArmHits);
            Console.WriteLine($"  hands up under a loose ball: arm hits {tip}; same ball as a shot in flight {shot}; hands down {low}");
            Check(tip > 0 && shot == 0 && low == 0, "hands tip loose balls only, reaching above the catch zone");
        }

        Console.WriteLine("== rim misses: where the ball ends up (roll-out distance from the hoop) ==");
        {
            var rnd = new Random(21);
            foreach (var off in new[] { 5.0, 7.0, 9.0, 12.0 })
            {
                double sum = 0, mx = 0, firstFloor = 0; int n = 0;
                for (int k = 0; k < 80; k++)
                {
                    double a = rnd.NextDouble() * Math.PI * 2, D = 160 + rnd.NextDouble() * 120, sa = (rnd.NextDouble() - 0.5) * 2.4;
                    var b = Aim(hx - Math.Cos(sa) * D, HY + Math.Sin(sa) * D, 82, hx + Math.Cos(a) * off, HY + Math.Sin(a) * off);
                    var s = new BallSim();
                    bool made = Shot(s, b, hx, out _, 1.6);
                    if (made) continue;
                    double ff = -1;
                    for (int i = 0; i < 240; i++) { s.Step(H, b); if (ff < 0 && b.z < BR + 0.3) ff = Math.Sqrt((b.x - hx) * (b.x - hx) + (b.y - HY) * (b.y - HY)); }
                    double d = Math.Sqrt((b.x - hx) * (b.x - hx) + (b.y - HY) * (b.y - HY));
                    sum += d; mx = Math.Max(mx, d); firstFloor += Math.Max(0, ff); n++;
                }
                Console.WriteLine($"  aimed {off,4:F1} px off centre: {n} misses, first floor touch {firstFloor / Math.Max(1, n) / 10:F1} ft out, after 2 s {sum / Math.Max(1, n) / 10:F1} ft (max {mx / 10:F1} ft)");
            }
        }

        Console.WriteLine(fails == 0 ? "PASS" : $"FAIL ({fails})");
        Environment.Exit(fails == 0 ? 0 : 1);
    }

    static void Ratio0(this BallSim s, Ball b)
    {
        int c0 = s.Contacts;
        for (int i = 0; i < 60 && s.Contacts == c0; i++) s.Step(H, b);
    }

    /// <summary>A bank shot: ballistic aim at a point on the glass face (y, z), launch's backspin, with jitter.</summary>
    static Ball Bank(double x0, double y0, double z0, double gy, double gz, double jSpeed, double jDir)
    {
        double gx = 900 - BR, dx = gx - x0, dy = gy - y0, D = Math.Sqrt(dx * dx + dy * dy), dz = gz - z0, th = 0.95;
        double v = Math.Sqrt(g * D * D / (2 * Math.Pow(Math.Cos(th), 2) * Math.Max(1, D * Math.Tan(th) - dz))) * 1.03 * (1 + jSpeed),
            az = Math.Atan2(dy, dx) + jDir;
        var b = Ball(x0, y0, z0, v * Math.Cos(th) * Math.Cos(az), v * Math.Cos(th) * Math.Sin(az), v * Math.Sin(th));
        double hh = v * Math.Cos(th);
        b.wv[0] = 16 * b.vy / hh; b.wv[1] = -16 * b.vx / hh;
        return b;
    }
}
