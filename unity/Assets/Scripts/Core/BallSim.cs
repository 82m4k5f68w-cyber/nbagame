// Custom deterministic ball physics (part PH): a pure-C# replacement for the browser's Rapier world
// (src/core/physics.ts) and Unity's PhysX port (Game/PhysXBall.cs). No UnityEngine: it runs in Unity and in the
// scripts/unity/cs.sh harness alike, and every number is a double, so two machines get the same bounces.
//
// World (game units: 10 px = 1 ft, z up): floor, 4 walls, two glass boards, 24-capsule rims (radius .55), kinematic
// player torso capsules with Rapier's enable rule, ball radius BR. Materials combine with Rapier's default Average rule.
// Integration = exactly the aim pre-simulation in Sim.launch (h = dt, drag, Magnus from B.wv, gravity, symplectic Euler,
// spin decaying with angular damping .3), so a ball that touches nothing lands bit-for-bit where launch predicted.
// Contacts: swept sphere (sub-samples of <= 1 px along the step's straight path + bisection to the time of impact, so
// nothing tunnels), restitution on the normal, Coulomb friction coupling linear and angular velocity (backspin bites,
// rim english, rolling without slipping as the limit), rolling resistance on the floor.
//
// Extras (Extras = true; false = the plain Rapier world for A/B numbers):
//  - net coupling: the Sim.NETS strands narrow around a ball below the rim and slow it ("snap", NetSnap[] for FX);
//    only below z 99, so makes are still decided by the iron
//  - backboard: glass is lively, the frame strip around its edge duller, the padding under it dead
//  - rim: back iron by the hook (and the bracket to the glass) is deader than the front iron; RimFlex spring per hoop
//    (hard hits, dunks, a player hanging); shooter's touch softens rim contacts when UP != 0 (higher rating = softer)
//  - spin: extra spin decay on the floor (wood grabs the ball), spin <-> velocity transfer on every contact
//  - bodies: torso capsules lean with the pose (p.skel pelvis -> neck), forearm / hand capsules (p.skel 13-15, 17-19)
//    for LOOSE balls above the catch zone (rebound tips), never a shot in flight or inside the cylinder
using System;
using System.Collections.Generic;

namespace Hoops.Core
{
    public sealed class BallSim : IBallPhysics
    {
        // ---- shape flags ----
        public const int F_FLOOR = 1, F_WALL = 2, F_GLASS = 4, F_PAD = 8, F_RIM = 16, F_BRACKET = 32, F_BODY = 64, F_ARM = 128;

        /// <summary>Extras on (net, board regions, rim regions, lean, arms, floor spin decay). False = plain Rapier world.</summary>
        public bool Extras = true;
        /// <summary>Shooter's touch on the rim (behind the Pro Play flag; GameMain sets it from cfg.UP).</summary>
        public int UP;

        /// <summary>Rim flex per hoop in game px (+ = bent down), a damped spring; for the renderer (hoop / net offset).</summary>
        public static readonly double[] RimFlex = new double[2];
        public static readonly double[] RimFlexV = new double[2];
        /// <summary>Net "snap" per hoop (decays; ~ how hard the ball is pulling the nylon) for sounds / net FX.</summary>
        public static readonly double[] NetSnap = new double[2];

        // ---- tunables ----
        const double K_MAG = 0.0032, ANG_DAMP = 0.3, BALL_E = 0.72, BALL_MU = 0.55;
        const double SUBLEN = 1.0; // max path length (px) between contact samples
        const double REST_THR = 12; // px/s: slower normal impacts don't bounce (lets the ball settle)
        const double CRR = 42; // rolling resistance deceleration on the floor (px/s^2)
        const double FLEX_W = 2 * Math.PI * 6, FLEX_Z = 0.22, FLEX_K = 0.05;

        // ---- debug counters (tests / stats dumps) ----
        public int Contacts, RimHits, GlassHits, FrameHits, PadHits, BracketHits, FloorHits, BodyHits, ArmHits, NetSteps;
        public double LastVn; // last impact normal speed (px/s, positive)
        public int LastFlag;
        /// <summary>The current flight touched a rim / board (a shot after that is a loose ball for the arms).</summary>
        public bool HoopTouched;

        struct Sh
        {
            public int kind, flag, hoop; // kind 0 box (a = centre, b = half extents), 1 capsule (a..b segment)
            public bool on;
            public double ax, ay, az, bx, by, bz, r, e, mu, vx, vy, vz;
            public double mnx, mny, mnz, mxx, mxy, mxz; // AABB
            public double pax, pay, paz, pbx, pby, pbz; // previous endpoints (kinematic velocity)
            public bool hasPrev;
        }

        readonly Sh[] S;
        readonly int nStatic;
        int nShapes;
        readonly int[] cand;
        int nc;
        double lastAge = -1, lastSh;
        bool dunkKick;
        double give; // rim softness for this flight (0..)

        public BallSim()
        {
            S = new Sh[64 + 5 * 24];
            cand = new int[S.Length];
            int n = 0;
            void Box(double cx, double cy, double cz, double hx, double hy, double hz, double e, double mu, int flag, int hoop = -1)
            {
                ref var s = ref S[n++];
                s.kind = 0; s.flag = flag; s.hoop = hoop; s.on = true;
                s.ax = cx; s.ay = cy; s.az = cz; s.bx = hx; s.by = hy; s.bz = hz; s.e = e; s.mu = mu;
                s.mnx = cx - hx; s.mny = cy - hy; s.mnz = cz - hz; s.mxx = cx + hx; s.mxy = cy + hy; s.mxz = cz + hz;
            }
            void Cap(double x0, double y0, double z0, double x1, double y1, double z1, double r, double e, double mu, int flag, int hoop)
            {
                ref var s = ref S[n++];
                s.kind = 1; s.flag = flag; s.hoop = hoop; s.on = true;
                SetCap(ref s, x0, y0, z0, x1, y1, z1, r);
                s.e = e; s.mu = mu;
            }
            Box(470, 250, -10, 700, 500, 10, 0.8, 0.6, F_FLOOR);
            Box(-5, 250, 300, 5, 500, 300, 0.5, 0.5, F_WALL); // (Rapier's default friction .5)
            Box(945, 250, 300, 5, 500, 300, 0.5, 0.5, F_WALL);
            Box(470, -5, 300, 700, 5, 300, 0.5, 0.5, F_WALL);
            Box(470, 505, 300, 700, 5, 300, 0.5, 0.5, F_WALL);
            for (int b = 0; b < 2; b++)
            {
                double hx = Sim.HXs[b], bx = b == 1 ? 900 : 40, sd = b == 1 ? 1 : -1;
                Box(bx + sd * 0.6, Sim.HY, 116, 0.6, 30, 20, 0.62, 0.3, F_GLASS, b);
                // padding wrapped round the bottom edge (extras): sticks out a little in front of the glass
                Box(bx + sd * 0.4, Sim.HY, 94.3, 1.4, 30.5, 1.7, 0.08, 0.9, F_PAD, b);
                for (int k = 0; k < 24; k++)
                {
                    double a0 = k / 24.0 * 6.283, a1 = (k + 1) / 24.0 * 6.283;
                    Cap(hx + Math.Cos(a0) * Sim.RR, Sim.HY + Math.Sin(a0) * Sim.RR, 100, hx + Math.Cos(a1) * Sim.RR, Sim.HY + Math.Sin(a1) * Sim.RR, 100, 0.55, 0.55, 0.4, F_RIM, b);
                }
                // the bracket / flange from the back iron to the glass (extras)
                Cap(hx + sd * (Sim.RR + 0.9), Sim.HY, 99.2, bx - sd * 0.3, Sim.HY, 99.2, 0.9, 0.3, 0.5, F_BRACKET, b);
            }
            nStatic = nShapes = n;
        }

        static void SetCap(ref Sh s, double x0, double y0, double z0, double x1, double y1, double z1, double r)
        {
            s.ax = x0; s.ay = y0; s.az = z0; s.bx = x1; s.by = y1; s.bz = z1; s.r = r;
            s.mnx = Math.Min(x0, x1) - r; s.mny = Math.Min(y0, y1) - r; s.mnz = Math.Min(z0, z1) - r;
            s.mxx = Math.Max(x0, x1) + r; s.mxy = Math.Max(y0, y1) + r; s.mxz = Math.Max(z0, z1) + r;
        }

        bool Active(ref Sh s)
        {
            if (!s.on) return false;
            if (!Extras && (s.flag & (F_PAD | F_BRACKET | F_ARM)) != 0) return false;
            return true;
        }

        // ---- flight bookkeeping (a launch / pass / fumble resets B.age) ----
        void NewFlight(Ball B)
        {
            if (B.age < lastAge - 1e-12 || (B.sh != 0 && lastSh == 0))
            {
                HoopTouched = false;
                dunkKick = false;
                give = 0;
                var L = B.last;
                if (UP != 0 && Extras && B.sh != 0 && L != null)
                {
                    double touch = B.three != 0 ? L.c : (L.c + L.i) / 2; // shooter's touch
                    give = Math.Max(0, Math.Min(1, (touch - 60) / 35)) * 0.3;
                }
            }
            lastAge = B.age;
            lastSh = B.sh;
        }

        /// <summary>rapStep: drag + Magnus from the spin, gravity, then the contact sweep (h = dt).</summary>
        public void Step(double dt, Ball B)
        {
            NewFlight(B);
            var W = B.wv;
            if (W == null) W = B.wv = new double[3];
            // (the same expressions, in the same order, as launch's pre-simulation)
            B.vx *= 1 - 0.1 * dt;
            B.vy *= 1 - 0.1 * dt;
            B.vz += K_MAG * (W[0] * B.vy - W[1] * B.vx) * dt - Sim.g * dt;
            double sx = B.vx * dt, sy = B.vy * dt, sz = B.vz * dt;
            Gather(B.x, B.y, B.z, sx, sy, sz);
            bool floor = false;
            if (nc == 0)
            {
                B.x += sx;
                B.y += sy;
                B.z += sz;
            }
            else floor = Sweep(B, W, dt);
            if (Extras) NetCouple(B, dt);
            if (floor) Floor(B, W, dt);
            if (Extras && B.dk != 0 && !dunkKick && B.z < 106)
                for (int h = 0; h < 2; h++)
                    if (Util.Hypot(B.x - Sim.HXs[h], B.y - Sim.HY) < 10) { RimFlexV[h] += 75; dunkKick = true; }
            double wd = 1 / (1 + dt * ANG_DAMP);
            W[0] *= wd;
            W[1] *= wd;
            W[2] *= wd;
            B.a += Math.Sqrt(W[0] * W[0] + W[1] * W[1] + W[2] * W[2]) * dt * 0.5;
        }

        void Gather(double x, double y, double z, double sx, double sy, double sz)
        {
            double m = Sim.BR + 1,
                mnx = Math.Min(x, x + sx) - m, mxx = Math.Max(x, x + sx) + m,
                mny = Math.Min(y, y + sy) - m, mxy = Math.Max(y, y + sy) + m,
                mnz = Math.Min(z, z + sz) - m, mxz = Math.Max(z, z + sz) + m;
            nc = 0;
            for (int i = 0; i < nShapes; i++)
            {
                ref var s = ref S[i];
                if (!Active(ref s)) continue;
                if (s.mxx < mnx || s.mnx > mxx || s.mxy < mny || s.mny > mxy || s.mxz < mnz || s.mnz > mxz) continue;
                cand[nc++] = i;
            }
        }

        /// <summary>Gap between the ball surface and shape s (negative = overlap), normal from the shape to the ball.</summary>
        static double Gap(ref Sh s, double px, double py, double pz, out double nx, out double ny, out double nz)
        {
            if (s.kind == 0)
            {
                double dx = px - s.ax, dy = py - s.ay, dz = pz - s.az,
                    qx = Math.Abs(dx) - s.bx, qy = Math.Abs(dy) - s.by, qz = Math.Abs(dz) - s.bz;
                if (qx > 0 || qy > 0 || qz > 0)
                {
                    double ox = Math.Max(qx, 0) * Math.Sign(dx), oy = Math.Max(qy, 0) * Math.Sign(dy), oz = Math.Max(qz, 0) * Math.Sign(dz),
                        d = Math.Sqrt(ox * ox + oy * oy + oz * oz);
                    nx = ox / d; ny = oy / d; nz = oz / d;
                    return d - Sim.BR;
                }
                // inside: out through the nearest face
                nx = ny = nz = 0;
                if (qx >= qy && qx >= qz) nx = dx >= 0 ? 1 : -1;
                else if (qy >= qz) ny = dy >= 0 ? 1 : -1;
                else nz = dz >= 0 ? 1 : -1;
                return Math.Max(qx, Math.Max(qy, qz)) - Sim.BR;
            }
            else
            {
                double vx = s.bx - s.ax, vy = s.by - s.ay, vz = s.bz - s.az, L2 = vx * vx + vy * vy + vz * vz,
                    u = L2 > 0 ? ((px - s.ax) * vx + (py - s.ay) * vy + (pz - s.az) * vz) / L2 : 0;
                if (u < 0) u = 0; else if (u > 1) u = 1;
                double cx = px - (s.ax + vx * u), cy = py - (s.ay + vy * u), cz = pz - (s.az + vz * u),
                    d = Math.Sqrt(cx * cx + cy * cy + cz * cz);
                if (d < 1e-9) { nx = 0; ny = 0; nz = 1; }
                else { nx = cx / d; ny = cy / d; nz = cz / d; }
                return d - s.r - Sim.BR;
            }
        }

        double MinGap(double px, double py, double pz)
        {
            double m = 1e9;
            for (int c = 0; c < nc; c++)
            {
                double g = Gap(ref S[cand[c]], px, py, pz, out _, out _, out _);
                if (g < m) m = g;
            }
            return m;
        }

        /// <summary>Moves the ball along v*dt with contacts. Returns true if it touched the floor.</summary>
        bool Sweep(Ball B, double[] W, double dt)
        {
            bool floor = false;
            // overlaps at the start (a body walked into the ball, the sim placed it on the iron, ...)
            for (int c = 0; c < nc; c++)
            {
                ref var s = ref S[cand[c]];
                double g = Gap(ref s, B.x, B.y, B.z, out double nx, out double ny, out double nz);
                if (g < 0)
                {
                    B.x -= nx * g; B.y -= ny * g; B.z -= nz * g;
                    if (Respond(ref s, B, W, nx, ny, nz) && s.flag == F_FLOOR) floor = true;
                }
            }
            double x0 = B.x, y0 = B.y, z0 = B.z, rem = 1;
            for (int guard = 0; ; guard++)
            {
                double sx = B.vx * dt * rem, sy = B.vy * dt * rem, sz = B.vz * dt * rem,
                    len = Math.Sqrt(sx * sx + sy * sy + sz * sz);
                if (guard > 0) Gather(x0, y0, z0, sx, sy, sz); // (a bounce changed the path: its own neighbourhood)
                int n = Math.Max(1, (int)Math.Ceiling(len / SUBLEN));
                double fPrev = 0, fHit = -1;
                for (int i = 1; i <= n; i++)
                {
                    double f = (double)i / n;
                    if (MinGap(x0 + sx * f, y0 + sy * f, z0 + sz * f) < 0)
                    {
                        double lo = fPrev, hi = f;
                        for (int it = 0; it < 12; it++)
                        {
                            double mid = (lo + hi) * 0.5;
                            if (MinGap(x0 + sx * mid, y0 + sy * mid, z0 + sz * mid) < 0) hi = mid; else lo = mid;
                        }
                        fHit = lo;
                        break;
                    }
                    fPrev = f;
                }
                if (fHit < 0)
                {
                    B.x = x0 + sx;
                    B.y = y0 + sy;
                    B.z = z0 + sz;
                    return floor;
                }
                B.x = x0 + sx * fHit;
                B.y = y0 + sy * fHit;
                B.z = z0 + sz * fHit;
                bool any = false;
                for (int c = 0; c < nc; c++)
                {
                    ref var s = ref S[cand[c]];
                    double g = Gap(ref s, B.x, B.y, B.z, out double nx, out double ny, out double nz);
                    if (g < 0.02)
                    {
                        if (g < 0) { B.x -= nx * g; B.y -= ny * g; B.z -= nz * g; }
                        if (Respond(ref s, B, W, nx, ny, nz)) { any = true; if (s.flag == F_FLOOR) floor = true; }
                    }
                }
                rem *= 1 - fHit;
                x0 = B.x; y0 = B.y; z0 = B.z;
                if (rem < 1e-9) return floor;
                if (guard >= 24 || !any && fHit == 0)
                {
                    // (wedged between shapes: stop at the contact this step rather than push through anything)
                    for (int c = 0; c < nc; c++)
                    {
                        ref var s = ref S[cand[c]];
                        double g = Gap(ref s, B.x, B.y, B.z, out double nx, out double ny, out double nz);
                        if (g < 0) { B.x -= nx * g; B.y -= ny * g; B.z -= nz * g; }
                    }
                    return floor;
                }
            }
        }

        /// <summary>Impulse response against a static / kinematic shape (ball mass 1, solid sphere I = .4 R^2).</summary>
        bool Respond(ref Sh s, Ball B, double[] W, double nx, double ny, double nz)
        {
            double R = Sim.BR, rx = -nx * R, ry = -ny * R, rz = -nz * R;
            double cvx = B.vx + (W[1] * rz - W[2] * ry) - s.vx,
                cvy = B.vy + (W[2] * rx - W[0] * rz) - s.vy,
                cvz = B.vz + (W[0] * ry - W[1] * rx) - s.vz,
                vn = cvx * nx + cvy * ny + cvz * nz;
            if (vn >= 0) return false;
            double es = s.e, ms = s.mu;
            if (Extras) Material(ref s, B, ref es, ref ms);
            double e = (BALL_E + es) * 0.5, mu = (BALL_MU + ms) * 0.5; // Rapier's Average combine rule
            if ((s.flag & F_RIM) != 0 && B.sh != 0) e *= 1 - give;
            if (-vn < REST_THR) e = 0;
            double jn = -(1 + e) * vn;
            B.vx += jn * nx;
            B.vy += jn * ny;
            B.vz += jn * nz;
            double tx = cvx - vn * nx, ty = cvy - vn * ny, tz = cvz - vn * nz, vt = Math.Sqrt(tx * tx + ty * ty + tz * tz);
            if (vt > 1e-9)
            {
                // Coulomb friction, capped at the impulse that makes the contact point roll without slipping
                double jt = Math.Min(mu * jn, vt / 3.5), Jx = -jt * tx / vt, Jy = -jt * ty / vt, Jz = -jt * tz / vt, iI = 1 / (0.4 * R * R);
                B.vx += Jx;
                B.vy += Jy;
                B.vz += Jz;
                W[0] += (ry * Jz - rz * Jy) * iI;
                W[1] += (rz * Jx - rx * Jz) * iI;
                W[2] += (rx * Jy - ry * Jx) * iI;
            }
            Contacts++;
            LastVn = -vn;
            LastFlag = s.flag;
            switch (s.flag)
            {
                case F_FLOOR: FloorHits++; break;
                case F_RIM: RimHits++; break;
                case F_GLASS: GlassHits++; break;
                case F_PAD: PadHits++; break;
                case F_BRACKET: BracketHits++; break;
                case F_BODY: BodyHits++; break;
                case F_ARM: ArmHits++; break;
            }
            if (s.hoop >= 0)
            {
                HoopTouched = true;
                if ((s.flag & (F_RIM | F_BRACKET)) != 0)
                    RimFlexV[s.hoop] += FLEX_K * jn * (nz + 0.25) * (1 + 2 * give); // a ball on top bends it down
            }
            return true;
        }

        /// <summary>Regional materials: frame strip round the glass, the back iron by the hook.</summary>
        void Material(ref Sh s, Ball B, ref double e, ref double mu)
        {
            if (s.flag == F_GLASS)
            {
                if (Math.Abs(B.y - Sim.HY) > 28.6 || B.z > 134.6) { e = 0.42; mu = 0.5; FrameHits++; }
            }
            else if (s.flag == F_RIM)
            {
                // angle of the contact round the ring: the back quarter (toward the glass) sits on the bracket - deader
                double hx = Sim.HXs[s.hoop], ax = (s.ax + s.bx) * 0.5 - hx, ay = (s.ay + s.by) * 0.5 - Sim.HY,
                    back = (s.hoop == 1 ? ax : -ax) / Sim.RR; // cos of the angle from the board direction
                if (back > 0.82) { e = 0.4; mu = 0.45; }
            }
        }

        /// <summary>Rolling resistance + the wood grabbing the spin.</summary>
        void Floor(Ball B, double[] W, double dt)
        {
            if (Math.Abs(B.vz) > 30 || B.z > Sim.BR + 0.5) return; // a bounce, not rolling
            double vh = Math.Sqrt(B.vx * B.vx + B.vy * B.vy);
            if (vh > 1e-9)
            {
                double k = Math.Max(0, vh - CRR * dt) / vh;
                B.vx *= k; B.vy *= k; W[0] *= k; W[1] *= k;
                vh *= k;
            }
            if (Extras) W[2] *= 1 / (1 + dt * 3); // spin about the vertical dies on the wood
            if (vh < 1.5 && Math.Abs(B.vz) < 3)
            {
                B.vx = B.vy = 0;
                W[0] = W[1] = 0;
            }
        }

        /// <summary>Ball vs the hanging net (Sim.NETS): the nylon narrows below the rim; a ball pressing into it is steered
        /// back to the middle and slowed (the snap of a swish). Below z 99 only: the iron decides makes.</summary>
        void NetCouple(Ball B, double dt)
        {
            if (B.z >= 99 || B.z < 78) return;
            for (int h = 0; h < 2; h++)
            {
                double hx = Sim.HXs[h], dx = B.x - hx, dy = B.y - Sim.HY, d = Math.Sqrt(dx * dx + dy * dy);
                if (d > Sim.RR + 1) continue;
                var N = Sim.NETS[h];
                // ring radii from the live knots (6 rings x NS)
                int rings = N.p.Length / Sim.NS;
                double rPrev = Sim.RR, zPrev = 100, rad = -1;
                for (int r = 1; r < rings; r++)
                {
                    double sr = 0, sz = 0;
                    for (int k = 0; k < Sim.NS; k++)
                    {
                        var q = N.p[r * Sim.NS + k];
                        sr += Math.Sqrt((q.x - hx) * (q.x - hx) + (q.y - Sim.HY) * (q.y - Sim.HY));
                        sz += q.z;
                    }
                    double rr = sr / Sim.NS, zz = sz / Sim.NS;
                    if (B.z <= zPrev && B.z >= zz)
                    {
                        double t = (zPrev - B.z) / Math.Max(1e-6, zPrev - zz);
                        rad = rPrev + (rr - rPrev) * t;
                        break;
                    }
                    rPrev = rr; zPrev = zz;
                }
                if (rad < 0) rad = rPrev; // below the hem: last ring
                double pen = d + Sim.SEGR - rad;
                if (pen <= 0) continue;
                NetSteps++;
                double ux = d > 1e-6 ? dx / d : 0, uy = d > 1e-6 ? dy / d : 0, vo = B.vx * ux + B.vy * uy;
                if (vo > 0) { B.vx -= 1.2 * vo * ux; B.vy -= 1.2 * vo * uy; } // soft nylon wall
                double ac = Math.Min(pen, 3) * 260 * dt; // pushed back toward the middle
                B.vx -= ux * ac;
                B.vy -= uy * ac;
                double grab = Math.Min(1, pen / 2.5);
                if (B.vz < 0) B.vz /= 1 + dt * 5 * grab; // the snap: the drop slows as the nylon stretches
                NetSnap[h] = Math.Max(NetSnap[h], grab * Math.Min(1, -B.vz / 200));
            }
        }

        /// <summary>Rim spring + net snap decay (once per sim tick, from SyncPlayers).</summary>
        void Tick(double dt, List<Player> P)
        {
            for (int h = 0; h < 2; h++)
            {
                double hang = 0;
                if (Extras)
                    foreach (var p in P)
                        if (p.hangT > 0 && p.z > 15 && Util.Hypot(p.x - Sim.HXs[h], p.y - Sim.HY) < 26) hang = 2.2; // hanging on it
                double a = -FLEX_W * FLEX_W * (RimFlex[h] - hang) - 2 * FLEX_Z * FLEX_W * RimFlexV[h];
                RimFlexV[h] += a * dt;
                RimFlex[h] += RimFlexV[h] * dt;
                if (RimFlex[h] > 4) { RimFlex[h] = 4; if (RimFlexV[h] > 0) RimFlexV[h] = 0; }
                if (RimFlex[h] < -1.5) { RimFlex[h] = -1.5; if (RimFlexV[h] < 0) RimFlexV[h] = 0; }
                NetSnap[h] *= Math.Exp(-dt * 6);
            }
        }

        /// <summary>Kinematic torso capsules (Rapier's enable rule) + forearm/hand capsules for loose balls.</summary>
        public void SyncPlayers(List<Player> P, Ball B)
        {
            NewFlight(B);
            Tick(1 / 60.0, P);
            int need = nStatic + P.Count * 5;
            if (need > S.Length) need = S.Length;
            for (int i = nShapes; i < need; i++) { S[i].hasPrev = false; S[i].on = false; }
            nShapes = need;
            bool air = B.mode == "air" && B.owner == null && B.age >= 0.12,
                nearRim = B.z > 55 && (Util.Hypot(B.x - Sim.HXs[0], B.y - Sim.HY) < 30 || Util.Hypot(B.x - Sim.HXs[1], B.y - Sim.HY) < 30),
                cyl = B.z > 55 && (Util.Hypot(B.x - Sim.HXs[0], B.y - Sim.HY) < 22 || Util.Hypot(B.x - Sim.HXs[1], B.y - Sim.HY) < 22),
                loose = B.sh == 0 || HoopTouched;
            for (int k = 0; k < P.Count && nStatic + k * 5 + 4 < S.Length; k++)
            {
                var p = P[k];
                double H = p.ht * 10, r = 8.5 * p.bk, hh = Math.Max(4, (H * 0.78 - 2 * r) / 2);
                double bx = p.x, by = p.y, bz = p.z + r, tx = p.x, ty = p.y, tz = p.z + r + 2 * hh;
                var sk = p.skel;
                bool skOk = sk != null && p.skelOk != 0;
                if (Extras && skOk)
                {
                    // lean with the pose: the top of the torso follows the neck relative to the pelvis
                    double lx = sk[6] - sk[0], ly = sk[7] - sk[1], lz = Math.Max(10, sk[8] - sk[2]),
                        sc = 2 * hh / lz, ox = lx * sc, oy = ly * sc, ol = Math.Sqrt(ox * ox + oy * oy);
                    if (ol > 18) { ox *= 18 / ol; oy *= 18 / ol; }
                    if (!double.IsNaN(ox + oy)) { tx += ox; ty += oy; }
                }
                bool torsoOn = air && !nearRim && !(B.last == p && B.age < 0.35);
                Kin(ref S[nStatic + k * 5], bx, by, bz, tx, ty, tz, r, 0.35, 0.5, F_BODY, torsoOn);
                for (int a = 0; a < 4; a++)
                {
                    int j0 = a < 2 ? 13 + a : 17 + (a - 2), j1 = j0 + 1;
                    ref var s = ref S[nStatic + k * 5 + 1 + a];
                    if (!skOk) { s.on = false; s.hasPrev = false; continue; }
                    // reaching above the catch zone (where the sim's hands would not take it anyway): tips, not catches
                    int wj = a < 2 ? 14 : 18;
                    bool on = Extras && torsoOn && loose && !cyl && sk[wj * 3 + 2] > p.z + 64 + p.j * 0.2 && B.z > p.z + 55;
                    Kin(ref s, sk[j0 * 3], sk[j0 * 3 + 1], sk[j0 * 3 + 2], sk[j1 * 3], sk[j1 * 3 + 1], sk[j1 * 3 + 2], (a & 1) == 0 ? 1.5 : 1.9, 0.3, 0.6, F_ARM, on);
                }
            }
        }

        static void Kin(ref Sh s, double x0, double y0, double z0, double x1, double y1, double z1, double r, double e, double mu, int flag, bool on)
        {
            s.kind = 1; s.flag = flag; s.hoop = -1; s.e = e; s.mu = mu;
            double mx = (x0 + x1) * 0.5, my = (y0 + y1) * 0.5, mz = (z0 + z1) * 0.5;
            if (s.hasPrev)
            {
                double px = (s.pax + s.pbx) * 0.5, py = (s.pay + s.pby) * 0.5, pz = (s.paz + s.pbz) * 0.5,
                    dx = mx - px, dy = my - py, dz = mz - pz;
                if (dx * dx + dy * dy + dz * dz > 900) s.vx = s.vy = s.vz = 0; // teleport (setup after a basket)
                else
                {
                    s.vx = dx * 60; s.vy = dy * 60; s.vz = dz * 60;
                    double v = Math.Sqrt(s.vx * s.vx + s.vy * s.vy + s.vz * s.vz);
                    if (v > 800) { s.vx *= 800 / v; s.vy *= 800 / v; s.vz *= 800 / v; }
                }
            }
            else s.vx = s.vy = s.vz = 0;
            SetCap(ref s, x0, y0, z0, x1, y1, z1, r);
            s.pax = x0; s.pay = y0; s.paz = z0; s.pbx = x1; s.pby = y1; s.pbz = z1;
            s.hasPrev = true;
            s.on = on;
        }

        /// <summary>Test helper: turn every kinematic body off (free-space experiments).</summary>
        public void ClearBodies()
        {
            for (int i = nStatic; i < nShapes; i++) { S[i].on = false; S[i].hasPrev = false; }
            nShapes = nStatic;
        }
    }
}
