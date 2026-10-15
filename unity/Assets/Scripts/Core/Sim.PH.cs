// PH2 (Unity, cfg.UP = 1): the sim side of the ball physics upgrades. Core/BallSim.cs does the engine part (full-body
// bones for loose balls, slider, rim / glass / net polish); this file holds what bstep / collide / launch call:
//  - dzPH: the dribble with a real floor contact - restitution from the slider (arcade = the TS .82, sim = the engine
//    floor), the bounce reads floor friction against the ball's spin (the xy kick goes into the hand spring, the spin
//    stays on the ball), the hand rolls the ball on the push and grips it on the catch; the push is scaled so the
//    bounce still comes back to dribTop (the hand catches there, or reaches down for a short one)
//  - box-outs in collide: a defender sealing his man on a shot / rebound plays heavy (he holds position) and shoves
//    him away from the rim by the mass ratio (build x height)
//  - phBlock: the block roll in launch decides the outcome; the blocker's hand capsule (p.skel) vs the ball shapes the
//    deflection (pop: mostly physics; swat: keeps the sideline, physics sets the height; control: the tip keeps its
//    target) and the spin off the fingers
// Nothing here runs with cfg.UP == 0 (CoreTests/Trace.cs lockstep vs TS); Sim.PH2 = false turns PH2 off with UP on
// (A/B numbers in the tests).
using System;
using System.Collections.Generic;
using static Hoops.Core.Util;
using static Hoops.Core.Data;
using static Hoops.Core.Sim;
using static Hoops.Core.Pose;

namespace Hoops.Core
{
    public static partial class Sim
    {
        /// <summary>PH2 master switch under cfg.UP (tests flip it for before / after numbers).</summary>
        public static bool PH2 = true;
        public static bool phOn() => cfg.UP != 0 && PH2;
        /// <summary>The arcade (0) .. sim (1) slider, clamped.</summary>
        public static double phK() => double.IsNaN(cfg.PHYS) ? 0.5 : Math.Max(0, Math.Min(1, cfg.PHYS));

        /// <summary>Counters for the tests: dribble bounces / short catches, box-out contact ticks and shove (px), blocks.</summary>
        public static int phDrib, phDribShort, phBoxN, phBlkN;
        public static double phBoxPx, phDribKick;
        /// <summary>Last physical block: contact normal (hand -> ball) and the velocity the physics alone gave.</summary>
        public static readonly double[] PHB = new double[6];

        // ---------------- dribble ----------------
        static bool phDr; // dzPH ran this sub-step (else the hands kill the spin)
        const double PH_WMAX = 45; // rad/s: most spin a dribble keeps
        public static double dzPH(Player o, double dt)
        {
            phDr = true;
            double top = dribTop(o),
                sp = Hypot(o.vx, o.vy),
                k = phK(),
                e = 0.82 + (0.76 - 0.82) * k, // arcade = the TS bounce .. sim = BallSim's floor (Average .72 / .8)
                R = BR;
            var W = B.wv ?? (B.wv = new double[3]);
            if (B.dho != o)
            {
                B.dh = B.dhoNull && B.hold == o ? clamp(B.z, top, top + 22) : top;
                B.dvv = 0;
                B.dhd = 0.08;
                B.dho = o;
                B.dhoNull = false;
                B.fr0 = T;
                W[0] = W[1] = W[2] = 0;
            }
            B.dtop = top;
            if (B.dhd > 0)
            {
                B.dhd -= dt;
                B.dvv *= JsMath.Exp(-28 * dt);
                B.dh = Math.Min(Math.Max(top + 5, B.dh), B.dh + B.dvv * dt);
                double gr = JsMath.Exp(-18 * dt); // the fingers grip it: the spin dies in the hand
                W[0] *= gr; W[1] *= gr; W[2] *= gr;
                if (B.dhd <= 0)
                {
                    double push = (165 + sp * 0.4) * (o.s >= 86 ? 1.15 : o.ht >= 6.9 ? 0.9 : 1),
                        h0 = Math.Max(0, B.dh - BR),
                        vImp = Math.Sqrt(push * push + 2 * g * h0) * 0.82 / e; // same speed off the floor as the TS bounce
                    B.dvv = -Math.Sqrt(Math.Max(push * push, vImp * vImp - 2 * g * h0));
                    // the hand rolls it forward over the top on the move (less in sim: the floor does the rest)
                    double roll = 0.85 - 0.45 * k;
                    W[0] = -o.vy / R * roll;
                    W[1] = o.vx / R * roll;
                }
            }
            else
            {
                double pv = B.dvv;
                B.dvv -= g * dt;
                B.dh += B.dvv * dt;
                if (B.dh < BR)
                {
                    B.dh = BR;
                    double vn = Math.Abs(B.dvv);
                    B.dvv = vn * e;
                    // floor friction vs the contact point's slip (ball xy + spin x radius), capped at rolling
                    double jn = (1 + e) * vn, mu = Math.Min(1, 0.7 * (0.5 + k)),
                        cvx = B.dvx - R * W[1], cvy = B.dvy + R * W[0], vt = Math.Sqrt(cvx * cvx + cvy * cvy);
                    if (vt > 1e-9)
                    {
                        double jt = Math.Min(mu * jn, vt / 3.5), Jx = -jt * cvx / vt, Jy = -jt * cvy / vt, iI = 1 / (0.4 * R * R),
                            ks = 0.35 + 0.65 * k; // how much of the kick the hand feels (arcade keeps it glued)
                        B.dvx += Jx * ks;
                        B.dvy += Jy * ks;
                        W[0] += R * Jy * iI;
                        W[1] += -R * Jx * iI;
                        phDribKick = Math.Max(phDribKick, Math.Sqrt(Jx * Jx + Jy * Jy) * ks);
                    }
                    W[2] *= 0.5;
                    double wh = Math.Sqrt(W[0] * W[0] + W[1] * W[1]);
                    if (wh > PH_WMAX) { W[0] *= PH_WMAX / wh; W[1] *= PH_WMAX / wh; } // (a crossover's sideways swing: no buzz saw)
                    phDrib++;
                }
                if (B.dvv > 0 && B.dh >= top - 1)
                {
                    B.dh = top - 1;
                    B.dhd = 0.05 + 0.05 / (1 + sp * 0.01);
                }
                else if (pv > 0 && B.dvv <= 0 && B.dh > BR + 1)
                {
                    // a short bounce (dead spot, slow push): the hand reaches down and takes it at the top of its hop
                    B.dhd = 0.05 + 0.05 / (1 + sp * 0.01);
                    phDribShort++;
                }
            }
            return B.dh;
        }

        /// <summary>After the held-ball height in bstep: a ball that was not dribbled this sub-step is in the hands (no spin).</summary>
        public static void phHeldSpin(double dt)
        {
            if (!phDr && B.wv != null)
            {
                double gr = JsMath.Exp(-25 * dt);
                B.wv[0] *= gr; B.wv[1] *= gr; B.wv[2] *= gr;
            }
            phDr = false;
        }

        // ---------------- box-outs (collide) ----------------
        public const double PH_BOXM = 3; // a seated box-out plays this much heavier
        /// <summary>1 = A boxes C out, 2 = C boxes A out, 0 = no box-out (a shot / miss in the air, the defender between
        /// his man and the rim).</summary>
        public static int phBox(Player A, Player C)
        {
            var L = B.last;
            if (L == null || B.owner != null || B.mode != "air" || Util.T(B.sc) || !(Util.T(B.sh) || B.age < 1.6) || A.tm == C.tm) return 0;
            double hx = hoop(L.tm), dA = Hypot(A.x - hx, A.y - HY), dC = Hypot(C.x - hx, C.y - HY);
            if (A.tm != L.tm && dA < dC && dA < 170) return 1;
            if (C.tm != L.tm && dC < dA && dC < 170) return 2;
            return 0;
        }
        /// <summary>The boxer X sits into his man O: O is moved away from the rim by the mass ratio and loses the speed
        /// he had into X. (ux, uy) = unit from X to O.</summary>
        public static void phShove(Player X, Player O, double ux, double uy, double mX, double mO)
        {
            double sh = (1.6 * mX / (mX + mO) - 0.5) * (0.6 + 0.8 * phK());
            if (sh > 0)
            {
                O.x += ux * sh;
                O.y += uy * sh;
                phBoxPx += sh;
            }
            double vin = -(O.vx * ux + O.vy * uy);
            if (vin > 0) { O.vx += ux * vin * 0.5; O.vy += uy * vin * 0.5; }
            phBoxN++;
        }

        // ---------------- blocks (launch) ----------------
        static readonly int[] PH_ARM = { 13, 14, 14, 15, 17, 18, 18, 19 };
        /// <summary>kind 0 = pop, 1 = control block, 2 = swat. Called right after the rule set B.v.</summary>
        public static void phBlock(Player p, Player blk, int kind)
        {
            double k = phK(), kC = 0.55 + 0.9 * k, R = BR;
            // the ball's path before the touch: up and out of the shooter's hand toward the rim
            double hx = hoop(p.tm), dx = hx - B.x, dy = HY - B.y, dh = Hypot(dx, dy);
            if (!Util.T(dh)) dh = 1;
            double vix = dx / dh * 220, viy = dy / dh * 220, viz = 260;
            // contact point: the nearest point of his forearm / hand bones, else a hand up over his head at the ball
            double cx = blk.x + (B.x - blk.x) * 0.6, cy = blk.y + (B.y - blk.y) * 0.6, cz = blk.z + blk.ht * 12.5;
            var sk = blk.skel;
            if (sk != null && Util.T(blk.skelOk))
            {
                double best = 1e9;
                for (int s = 0; s < 8; s += 2)
                {
                    int a = PH_ARM[s], b = PH_ARM[s + 1];
                    double ax = sk[a * 3], ay = sk[a * 3 + 1], az = sk[a * 3 + 2], vx = sk[b * 3] - ax, vy = sk[b * 3 + 1] - ay, vz = sk[b * 3 + 2] - az,
                        L2 = vx * vx + vy * vy + vz * vz, u = L2 > 0 ? clamp(((B.x - ax) * vx + (B.y - ay) * vy + (B.z - az) * vz) / L2, 0, 1) : 0,
                        qx = ax + vx * u, qy = ay + vy * u, qz = az + vz * u, d = Hypot(B.x - qx, B.y - qy, B.z - qz);
                    if (d < best && !double.IsNaN(d)) { best = d; cx = qx; cy = qy; cz = qz; }
                }
            }
            double nx = B.x - cx, ny = B.y - cy, nz = B.z - cz, nl = Hypot(nx, ny, nz);
            if (nl < 1e-6) { nx = B.x - blk.x; ny = B.y - blk.y; nz = 0.3; nl = Hypot(nx, ny, nz); if (nl < 1e-6) { nx = 0; ny = 0; nz = 1; nl = 1; } }
            nx /= nl; ny /= nl; nz /= nl;
            // the hand swings into the ball
            double hvx = blk.vx + nx * 240, hvy = blk.vy + ny * 240, hvz = blk.vz + nz * 240,
                rx = vix - hvx, ry = viy - hvy, rz = viz - hvz, vn = rx * nx + ry * ny + rz * nz,
                e = clamp(0.35 * kC, 0.15, 0.55), px, py, pz, w0 = 0, w1 = 0, w2 = 0;
            if (vn < 0)
            {
                double jn = -(1 + e) * vn;
                px = vix + jn * nx; py = viy + jn * ny; pz = viz + jn * nz;
                double tx = rx - vn * nx, ty = ry - vn * ny, tz = rz - vn * nz, vt = Hypot(tx, ty, tz);
                if (vt > 1e-9)
                {
                    double jt = Math.Min(0.6 * jn, vt / 3.5), Jx = -jt * tx / vt, Jy = -jt * ty / vt, Jz = -jt * tz / vt, iI = 1 / (0.4 * R * R),
                        qx = -nx * R, qy = -ny * R, qz = -nz * R;
                    px += Jx; py += Jy; pz += Jz;
                    w0 = (qy * Jz - qz * Jy) * iI; w1 = (qz * Jx - qx * Jz) * iI; w2 = (qx * Jy - qy * Jx) * iI;
                }
            }
            else { px = hvx + nx * 80; py = hvy + ny * 80; pz = hvz + nz * 80; }
            PHB[0] = nx; PHB[1] = ny; PHB[2] = nz; PHB[3] = px; PHB[4] = py; PHB[5] = pz;
            double wk = Math.Min(1, kC);
            if (kind == 0)
            {
                double f = 0.65 * wk;
                B.vx += (px - B.vx) * f; B.vy += (py - B.vy) * f; B.vz += (pz - B.vz) * f;
                if (B.vz < -40 && B.z < 40) B.vz = -40; // (low: let it hit the floor, not bury it)
            }
            else if (kind == 2)
            {
                B.vx += (px - B.vx) * 0.4 * wk;
                B.vz += (clamp(pz, -260, 160) - B.vz) * 0.5 * wk;
            }
            double sp = Hypot(B.vx, B.vy, B.vz);
            if (sp > 650) { B.vx *= 650 / sp; B.vy *= 650 / sp; B.vz *= 650 / sp; }
            var W = B.wv ?? (B.wv = new double[3]);
            double ks = 0.5 + k, wl = Hypot(w0, w1, w2) * ks;
            double wc = wl > 45 ? 45 / wl : 1;
            W[0] = w0 * ks * wc; W[1] = w1 * ks * wc; W[2] = w2 * ks * wc;
            phBlkN++;
        }
    }
}
