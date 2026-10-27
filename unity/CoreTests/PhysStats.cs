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

        PH2();

        Console.WriteLine(fails == 0 ? "PASS" : $"FAIL ({fails})");
        Environment.Exit(fails == 0 ? 0 : 1);
    }

    // ================= PH2 (cfg.UP = 1): full body, slider, rim / glass / net polish, dribble, box-outs, blocks =================
    /// <summary>A standing player with a hand-built skeleton (joints as in Pose.skeleton): legOut = how far the right
    /// foot is stepped out sideways (px), armsOut = upper arms held out sideways.</summary>
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
    /// <summary>Runs a ball past / onto players (SyncPlayers each tick, two half steps). Returns the first contact
    /// flag and position.</summary>
    static int Run(BallSim s, List<Player> P, Ball b, double secs, out double cz, out double cy)
    {
        int c0 = s.Contacts; cz = cy = double.NaN;
        int flag = 0;
        for (double t = 0; t < secs; t += 1 / 60.0)
        {
            s.SyncPlayers(P, b);
            for (int k = 0; k < 2; k++)
            {
                int cc = s.Contacts;
                b.age += H; s.Step(H, b);
                if (s.Contacts != cc && flag == 0 && s.LastFlag != BallSim.F_FLOOR) { flag = s.LastFlag; cz = b.z; cy = b.y; }
            }
        }
        return flag;
    }
    static string FN(int f) => f == 0 ? "none" : f == BallSim.F_BODY ? "torso" : f == BallSim.F_ARM ? "forearm/hand" : f == BallSim.F_LIMB ? "head/upper arm" : f == BallSim.F_LEG ? "leg" : f == BallSim.F_FLOOR ? "floor" : "flag " + f;

    static void PH2()
    {
        double hx = HXs[1];
        Console.WriteLine("== PH2 (6) full body for loose balls: legs, head, upper arms (UP=0 -> UP=1) ==");
        {
            Ball Loose(double x, double y, double z, double vx, double vy, double vz, double sh = 0)
            { var b = Ball(x, y, z, vx, vy, vz); b.age = 0.5; b.sh = sh; return b; }
            // a ball skidding past a player whose right foot is stepped out 14 px (outside the torso capsule)
            int[] f = new int[4]; double[] ex = new double[4];
            for (int m = 0; m < 4; m++)
            {
                bool up = m > 0;
                var s = new BallSim { UP = up ? 1 : 0 };
                var P = new List<Player> { Body(400, 250, 14) };
                double sp = m == 2 ? 60 : 260;
                var b = Loose(400 - 60, 250 + 17, 9, sp, 0, 0, m == 3 ? 1 : 0);
                f[m] = Run(s, P, b, 1.2, out _, out _);
                ex[m] = Math.Sqrt((b.vx - sp) * (b.vx - sp) + b.vy * b.vy); // (how much the contact changed its course)
            }
            Console.WriteLine($"  ball skidding at 260 px/s past a foot stepped out: UP=0 {FN(f[0])}, UP=1 {FN(f[1])} (velocity change {ex[1]:F0} px/s); slow 60 px/s roller UP=1 {FN(f[2])}; shot in flight UP=1 {FN(f[3])}");
            Check(f[0] == 0 && f[1] == BallSim.F_LEG && ex[1] > 20, "a loose ball skidding into a leg is kicked off it (UP=1 only)");
            Check(f[2] == 0, "a slow roller is left for the hands (no leg contact)");
            Check(f[3] == 0, "never a shot in flight");
            // a ball dropped onto a head: UP=0 lands on the torso capsule top, UP=1 bounces off the head higher up
            double z0, z1;
            var s0 = new BallSim { UP = 0 }; var s1 = new BallSim { UP = 1 };
            int h0 = Run(s0, new List<Player> { Body(400, 250) }, Loose(400.5, 250, 110, 0, 0, -60), 1.0, out z0, out _);
            int h1 = Run(s1, new List<Player> { Body(400, 250) }, Loose(400.5, 250, 110, 0, 0, -60), 1.0, out z1, out _);
            Console.WriteLine($"  ball dropped on his head: UP=0 first touch {FN(h0)} at z {z0:F1}, UP=1 {FN(h1)} at z {z1:F1}");
            Check(h1 == BallSim.F_LIMB && z1 > z0 + 5, "the head is a body part (UP=1)");
            // arms held out: a loose ball at shoulder height beside him
            int a0 = Run(new BallSim { UP = 0 }, new List<Player> { Body(400, 250, 0, true) }, Loose(400, 250 + 60, 52, 0, -220, 60), 1.0, out _, out _);
            int a1 = Run(new BallSim { UP = 1 }, new List<Player> { Body(400, 250, 0, true) }, Loose(400, 250 + 60, 52, 0, -220, 60), 1.0, out _, out double ay);
            Console.WriteLine($"  loose ball at his outstretched arm (shoulder height): UP=0 first touch {FN(a0)}, UP=1 {FN(a1)} at y {ay - 250:F1}");
            Check(a1 == BallSim.F_LIMB && a0 != BallSim.F_LIMB, "an outstretched upper arm deflects it (UP=1)");
            // a crowd of rebounders: loose balls rained around them, contacts per bone group
            var rnd = new Random(4);
            int[,] hits = new int[2, 5];
            for (int m = 0; m < 2; m++)
            {
                var s = new BallSim { UP = m };
                var P = new List<Player> { Body(820, 230, 10, true), Body(830, 275, -8), Body(800, 255, 6), Body(845, 250, 0, true) };
                var r2 = new Random(4);
                for (int k = 0; k < 150; k++)
                {
                    var b = Loose(800 + r2.NextDouble() * 60, 220 + r2.NextDouble() * 70, 95 + r2.NextDouble() * 20, (r2.NextDouble() - 0.5) * 300, (r2.NextDouble() - 0.5) * 300, -50 + r2.NextDouble() * 150);
                    int c0 = s.BodyHits, c1 = s.ArmHits, c2 = s.LimbHits, c3 = s.LegHits;
                    Run(s, P, b, 1.4, out _, out _);
                    hits[m, 0] += s.BodyHits - c0; hits[m, 1] += s.ArmHits - c1; hits[m, 2] += s.LimbHits - c2; hits[m, 3] += s.LegHits - c3;
                }
            }
            Console.WriteLine($"  150 loose balls into 4 rebounders: UP=0 torso {hits[0, 0]} hands {hits[0, 1]} | UP=1 torso {hits[1, 0]} hands {hits[1, 1]} head/upper arms {hits[1, 2]} legs {hits[1, 3]}");
            Check(hits[1, 2] + hits[1, 3] > 0, "the extra bones take part in a scramble");
        }

        Console.WriteLine("== PH2 (7) arcade .. sim slider cfg.PHYS (BallSim UP=1) ==");
        {
            string row = "";
            double[] fr = new double[3], hard = new double[3], bp = new double[3], kick = new double[3];
            for (int m = 0; m < 3; m++)
            {
                double k = m * 0.5;
                var s = new BallSim { UP = 1, PHYS = k };
                fr[m] = Ratio(s, Ball(hx, HY, 100, -300, 0, 0), 1, 0, 0);
                hard[m] = Ratio(s, Ball(hx, HY, 100, -900, 0, 0), 1, 0, 0);
                // backspin bounce pass: vx after the floor
                var b = Ball(300, 250, 30, 300, 0, -150, 0, -150, 0);
                for (int i = 0; i < 120; i++) { double vz0 = b.vz; s.Step(H, b); if (vz0 < 0 && b.vz > 0) break; }
                bp[m] = b.vx;
                // a still ball hit by a leg swinging at 300 px/s
                var P = new List<Player> { Body(400, 250, 10) };
                var lb = Ball(400, 250 + 18, BR, 0, 0, 0); lb.vy = -40; lb.age = 0.5; // (he runs into it: legs need relative speed)
                s.SyncPlayers(P, lb);
                for (int t = 0; t < 30; t++)
                {
                    foreach (var q in P) { q.y += 300 / 60.0; for (int j = 1; j < 60; j += 3) q.skel[j] += (float)(300 / 60.0); q.vy = 300; }
                    s.SyncPlayers(P, lb); lb.age += H; s.Step(H, lb); lb.age += H; s.Step(H, lb);
                }
                kick[m] = lb.vy;
                row += $"  PHYS {k:F1}: front iron ratio {fr[m]:F3} (900 px/s hit {hard[m]:F3}), backspin bounce pass vx {bp[m]:F0}, kicked by a leg {kick[m]:F0} px/s\n";
            }
            var s0 = new BallSim { UP = 0 };
            double f0 = Ratio(s0, Ball(hx, HY, 100, -300, 0, 0), 1, 0, 0), h0 = Ratio(s0, Ball(hx, HY, 100, -900, 0, 0), 1, 0, 0);
            Console.Write(row);
            Console.WriteLine($"  UP=0 reference: front iron {f0:F3}, 900 px/s hit {h0:F3}");
            Check(fr[0] < fr[1] && fr[1] < fr[2], "arcade iron is softer, sim iron livelier");
            Check(Math.Abs(fr[1] - f0) < 0.02, "the middle of the slider keeps the PH iron at normal speeds");
            // (physics v3 shares the flex soak with the browser: UP=0 soaks hard hits too; PH3 = 0 is the old UP-only rule)
            Check(hard[1] < fr[1] - 0.08 && (cfg.PH3 != 0 ? h0 < f0 - 0.08 : Math.Abs(h0 - f0) < 0.02), cfg.PH3 != 0 ? "a hard hit loses more bounce to the flex (UP 0 and 1: physics v3)" : "a hard hit loses more bounce to the flex (UP=1 only)");
            Check(bp[0] > bp[1] && bp[1] > bp[2], "spin bites harder toward sim");
            Check(kick[0] < kick[1] && kick[1] < kick[2], "body contacts are stronger toward sim");
        }

        Console.WriteLine("== PH2 (8) glass thud + net drag ==");
        {
            double g0 = Ratio(new BallSim { UP = 0 }, Ball(880, 262, 120, 1100, 0, 0), -1, 0, 0), g1 = Ratio(new BallSim { UP = 1 }, Ball(880, 262, 120, 1100, 0, 0), -1, 0, 0),
                gs = Ratio(new BallSim { UP = 1 }, Ball(880, 262, 120, 400, 0, 0), -1, 0, 0);
            Console.WriteLine($"  glass at 1100 px/s: UP=0 {g0:F3}, UP=1 {g1:F3} (400 px/s UP=1 {gs:F3})");
            Check(g1 < g0 - 0.03 && Math.Abs(gs - g0) < 0.02, "a hard throw thuds off the glass, a soft bank is unchanged");
            double Exit(int up, out double vh, out double tn)
            {
                var s = new BallSim { UP = up };
                var b = B;
                b.x = hx - 2; b.y = HY; b.z = 112; b.vx = 70; b.vy = 0; b.vz = -240; b.mode = "air"; b.owner = null; b.sc = 1; b.wv[0] = b.wv[1] = b.wv[2] = 0;
                tn = 0; vh = 0;
                for (int i = 0; i < 160; i++)
                {
                    s.Step(H, b);
                    if (i % 2 == 1) netSim(1 / 60.0);
                    if (b.z < 99 && b.z > 78) { tn += H; vh += Math.Sqrt(b.vx * b.vx + b.vy * b.vy) * H; }
                    if (b.z < 78) break;
                }
                vh /= Math.Max(H, tn); // mean sideways speed inside the net
                return -b.vz;
            }
            double e0 = Exit(0, out double vh0, out double t0), e1 = Exit(1, out double vh1, out double t1);
            Console.WriteLine($"  swish drifting 70 px/s: UP=0 exits at {e0:F0} px/s down, {vh0:F0} px/s sideways in the net ({t0 * 1000:F0} ms); UP=1 {e1:F0} down, {vh1:F0} sideways ({t1 * 1000:F0} ms)");
            Check(vh1 < vh0 * 0.8 && e1 > 40 && t1 < 0.4, "the nylon drags it sideways and still lets it drop");
        }

        Console.WriteLine("== PH2 (9) dribble: real floor contact + spin (bstep with a running handler) ==");
        {
            cfg.NP = 5; cfg.MYM = 0; cfg.physics = "legacy"; cfg.input = c => new Input();
            Phys.RAP = null;
            setCtrls(new List<Ctrl>());
            start(0);
            foreach (var mode in new[] { "TS dz (UP=0)", "PH2 arcade", "PH2 default", "PH2 sim" })
            {
                cfg.UP = mode.StartsWith("TS") ? 0 : 1; Sim.PH2 = true;
                cfg.PHYS = mode.EndsWith("arcade") ? 0 : mode.EndsWith("sim") ? 1 : 0.5;
                var o = P[0];
                for (int k = 1; k < P.Count; k++) { P[k].x = 60 + k * 10; P[k].y = 30; }
                o.x = 300; o.y = 250; o.z = 0; o.f = 0; o.mode = "i"; o.ttT = 0; o.act = 0; o.actT = 0; o.chinT = 0; o.postA = 0;
                inb = 0; JB = null; ftq = null; PREDICT = 0;
                B.owner = o; B.mode = "held"; B.hold = o; B.dho = null; B.dhoNull = true; B.z = 40; B.wv[0] = B.wv[1] = B.wv[2] = 0;
                int bounces = 0, catches = 0; double maxSpin = 0, maxDev = 0, apexLow = 1e9;
                int b0 = phDrib, s0 = phDribShort;
                for (int t = 0; t < 240; t++)
                {
                    double sp = t < 120 ? 0 : 220; // stand, then run
                    o.vx = sp; o.vy = 0; o.x += sp / 60;
                    for (int h = 0; h < 2; h++)
                    {
                        double dh0 = B.dhd, v0 = B.dvv;
                        bstep(1 / 120.0);
                        if (t < 10) continue; // (the first push out of the hands)
                        if (v0 < 0 && B.dvv > 0 && B.dhd <= 0) bounces++;
                        if (dh0 <= 0 && B.dhd > 0) { catches++; apexLow = Math.Min(apexLow, B.dh - (B.dtop ?? 0)); }
                    }
                    if (t >= 10) maxSpin = Math.Max(maxSpin, Math.Sqrt(B.wv[0] * B.wv[0] + B.wv[1] * B.wv[1]));
                    if (t > 130) maxDev = Math.Max(maxDev, Math.Abs(B.dvx - o.vx));
                }
                Console.WriteLine($"  {mode,-13}: {bounces} bounces in 4 s, {catches} catches (lowest catch {apexLow:F1} px from dribTop, short hops {phDribShort - s0}), spin up to {maxSpin:F0} rad/s, ball speed off the hand up to {maxDev:F0} px/s");
                if (mode.StartsWith("TS")) { Check(maxSpin == 0, "TS dribble: no spin"); DRB0 = bounces; }
                else
                {
                    Check(apexLow > -1.01 && phDribShort == s0, "the hand still catches every bounce at dribTop");
                    Check(maxSpin > 5 && maxSpin < 80, "the dribbled ball spins (hand roll + floor friction)");
                    Check(Math.Abs(bounces - DRB0) <= 1, $"rhythm kept ({bounces} vs {DRB0} bounces)");
                }
            }
            cfg.UP = 0; cfg.PHYS = 0.5;
        }

        Console.WriteLine("== PH2 (10) box-outs in collide (defender seals, man drives at the rim for 1 s) ==");
        {
            foreach (var cs in new[] { ("UP=0", 0, 1.0, 6.7, 1.0, 6.7), ("UP=1 equal", 1, 1.0, 6.7, 1.0, 6.7), ("UP=1 big boxer", 1, 1.25, 7.0, 0.9, 6.4), ("UP=1 small boxer", 1, 0.9, 6.3, 1.25, 7.0) })
            {
                cfg.UP = cs.Item2; Sim.PH2 = true; cfg.PRO = 1;
                int ph3 = cfg.PH3;
                if (cs.Item1 == "UP=0") cfg.PH3 = 0; // (the no-box-out reference: physics v3 boxes out with UP 0 too)
                start(0);
                foreach (var q in P) { q.off = 1; }
                var X = P[cfg.NP]; var O = P[0]; // defender (team 1), his man (team 0, attacks the right hoop)
                X.off = 0; O.off = 0;
                X.bk = cs.Item3; X.ht = cs.Item4; O.bk = cs.Item5; O.ht = cs.Item6;
                X.x = 840; X.y = 250; X.z = 0; O.x = 822; O.y = 250; O.z = 0; X.f = Math.PI; O.f = 0;
                B.owner = null; B.mode = "air"; B.sh = 1; B.sc = 0; B.last = P[1]; B.age = 0.3; B.x = 870; B.y = 250; B.z = 130;
                double x0 = O.x, xd0 = X.x; int n0 = phBoxN;
                for (int t = 0; t < 60; t++)
                {
                    O.vx = 180; O.vy = 0; X.vx = 0; X.vy = 0;
                    O.x += O.vx / 60; // drives into him
                    collide();
                }
                Console.WriteLine($"  {cs.Item1,-16}: the man gained {O.x - x0:F1} px toward the rim, the boxer gave up {X.x - xd0:F1} px ({phBoxN - n0} box-out ticks)");
                cfg.PH3 = ph3;
                if (cs.Item1 == "UP=0") { BX0 = O.x - x0; BXD0 = X.x - xd0; }
                else if (cs.Item1 == "UP=1 equal") { Check(X.x - xd0 < BXD0 * 0.5 && O.x - x0 < BX0 - 3, "a box-out holds position and keeps the man off the rim"); BX1 = X.x - xd0; }
                else if (cs.Item1 == "UP=1 big boxer") BXB = X.x - xd0;
                else Check(X.x - xd0 > BXB + 1, "a bigger, heavier man moves a small boxer more");
            }
            cfg.UP = 0;
        }

        Console.WriteLine("== PH2 (11) physical blocks: the hand capsule shapes the deflection (rule decides the outcome) ==");
        {
            cfg.UP = 1; Sim.PH2 = true; cfg.PHYS = 0.5;
            start(0);
            var sh = P[0]; var blk = P[cfg.NP];
            (double, double, double, double, double, double, double) Blk(int kind, double hdx, double hdy, double hdz)
            {
                sh.x = 800; sh.y = 250; sh.z = 10;
                blk.x = 812; blk.y = 250; blk.z = 20; blk.vx = -60; blk.vy = 0; blk.vz = 120;
                B.x = 806; B.y = 250; B.z = 88; B.wv[0] = B.wv[1] = B.wv[2] = 0;
                blk.skelOk = 1; blk.skel = blk.skel ?? new float[60];
                for (int j = 0; j < 60; j += 3) { blk.skel[j] = 812; blk.skel[j + 1] = 250; blk.skel[j + 2] = 60; }
                void J(int k, double x, double y, double z) { blk.skel[k * 3] = (float)x; blk.skel[k * 3 + 1] = (float)y; blk.skel[k * 3 + 2] = (float)z; }
                // right arm reaching to (B + hd): elbow, wrist, hand
                J(16, 812, 254, 75); J(17, B.x + hdx * 2.6 + 4, B.y + hdy * 2.6 + 2, B.z + hdz * 2.6); J(18, B.x + hdx * 1.4, B.y + hdy * 1.4, B.z + hdz * 1.4); J(19, B.x + hdx, B.y + hdy, B.z + hdz);
                J(13, 812, 240, 70); J(14, 812, 238, 66); J(15, 812, 238, 64);
                double rvx = (sh.x - blk.x) * 8, rvy = 0, rvz = 60;
                if (kind == 2) { rvx = (sh.x - blk.x) * 6; rvy = 300; rvz = 30; }
                B.vx = rvx; B.vy = rvy; B.vz = rvz;
                phBlock(sh, blk, kind);
                return (B.vx, B.vy, B.vz, Math.Sqrt(B.wv[0] * B.wv[0] + B.wv[1] * B.wv[1] + B.wv[2] * B.wv[2]), rvx, rvy, rvz);
            }
            var top = Blk(0, 1, 0, 6.5); var side = Blk(0, 0, 6.5, 0.5); var under = Blk(0, 1, 0, -6.5); var sw = Blk(2, 1, 0, 6.5); var ct = Blk(1, 1, 0, 6.5);
            Console.WriteLine($"  rule pop (vx {top.Item5:F0}, vy 0, vz 60) -> hand on top: ({top.Item1:F0},{top.Item2:F0},{top.Item3:F0}) spin {top.Item4:F0}; hand at his side +y: ({side.Item1:F0},{side.Item2:F0},{side.Item3:F0}); hand under: ({under.Item1:F0},{under.Item2:F0},{under.Item3:F0})");
            Console.WriteLine($"  swat (rule vy 300 to the sideline) with the hand on top: ({sw.Item1:F0},{sw.Item2:F0},{sw.Item3:F0}); control block keeps the rule velocity: ({ct.Item1:F0},{ct.Item2:F0},{ct.Item3:F0}) spin {ct.Item4:F0}");
            Check(top.Item3 < -20 && under.Item3 > top.Item3 + 100, "a hand on top spikes it down, a hand under it pops it up");
            Check(side.Item2 < -40, "a hand at the side knocks it the other way");
            Check(sw.Item2 == 300 && sw.Item3 < 30, "a swat keeps its sideline, the hand on top drives it down");
            Check(ct.Item1 == ct.Item5 && ct.Item3 == ct.Item7 && ct.Item4 > 0, "a control block keeps its target and leaves the fingers spinning");
            cfg.UP = 0;
        }
    }
    static double BX0, BXD0, BX1, BXB;
    static int DRB0;

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
