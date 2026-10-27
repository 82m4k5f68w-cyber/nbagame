// Physics v3 (cfg.PH3, shared with the browser): port of the sim.ts "Physics v3" block - same names, same order, same
// random draws (CoreTests/Trace.cs stays identical to scripts/unity/trace.ts). Air: quadratic drag + Magnus k (w x v)
// + slow spin decay (passes keep the old model); surfaces hardwood / street asphalt (cfg.HALF): bounce, grip, rolling
// resistance, iron, glass; every legacy contact couples spin and velocity (spinHit); the shooter's touch (B.tch)
// softens the iron for his shot. Bodies: stumbles / knockdowns by the jolt each one takes in collide, screens that eat
// a defender's run (or get run through), box-outs (Sim.PH.cs phBox / phShove, now shared); loose-ball scrums, bobbled
// hard passes, balls off feet, spinning deflections; fatigue (lower jumps, slower first steps, heavy landings, tired
// jumpers fall short - never a human green); sweat spots late in games; shoe squeak / slip / chain FX; rim wobble,
// board shake and the (very rare) shattered backboard; chain nets on the street (Sim.G.cs NETMAT).
using System;
using System.Collections.Generic;
using static Hoops.Core.Util;
using static Hoops.Core.Data;
using static Hoops.Core.Sim;
using static Hoops.Core.Pose;

namespace Hoops.Core
{
    public partial class Player
    {
        public double sqkT = -9; // physics v3: last shoe squeak (T)
    }

    public static partial class Sim
    {
        public const double AIR_KD = 7.2e-4, // quadratic drag per px: a = KD |v| v
            AIR_KM = 0.005, // Magnus: a = KM (w x v)
            AIR_WD = 0.12; // spin decay in the air (1/s)
        /// <summary>By surface (0 hardwood, 1 street asphalt): bounce e, grip mu, rolling resistance, rim e x, rim soak x, glass e.</summary>
        public static readonly double[][] SURF =
        {
            new[] { 0.8, 0.6, 42, 1, 1, 0.6 },
            new[] { 0.76, 0.85, 80, 1.12, 0.45, 0.5 },
        };
        public static int surf() => cfg.PH3 != 0 && cfg.HALF != 0 ? 1 : 0;
        /// <summary>Event counters (TS PH3C).</summary>
        public static readonly Dictionary<string, double> PH3C = new Dictionary<string, double>();
        static void ph3c(string k) { PH3C.TryGetValue(k, out var v); PH3C[k] = v + 1; }
        /// <summary>Scratch for airAcc: vx vy vz w0 w1 w2.</summary>
        public static readonly double[] AV = new double[6];
        /// <summary>One step of v3 air on AV (drag + Magnus, no gravity): bstep, BallSim and launch's pre-sim.</summary>
        public static void airAcc(double h)
        {
            double vx = AV[0], vy = AV[1], vz = AV[2], w0 = AV[3], w1 = AV[4], w2 = AV[5],
                d = 1 - AIR_KD * Math.Sqrt(vx * vx + vy * vy + vz * vz) * h;
            AV[0] = vx * d + AIR_KM * (w1 * vz - w2 * vy) * h;
            AV[1] = vy * d + AIR_KM * (w2 * vx - w0 * vz) * h;
            AV[2] = vz * d + AIR_KM * (w0 * vy - w1 * vx) * h;
        }
        public static bool airV3() => cfg.PH3 != 0 && B.mode != "pass";

        static void spinHit(double nx, double ny, double nz, double jn, double mu)
        {
            var W = B.wv ?? (B.wv = new double[3]);
            double R = BR, rx = -nx * R, ry = -ny * R, rz = -nz * R,
                cvx = B.vx + (W[1] * rz - W[2] * ry),
                cvy = B.vy + (W[2] * rx - W[0] * rz),
                cvz = B.vz + (W[0] * ry - W[1] * rx),
                vn = cvx * nx + cvy * ny + cvz * nz,
                tx = cvx - vn * nx, ty = cvy - vn * ny, tz = cvz - vn * nz,
                vt = Math.Sqrt(tx * tx + ty * ty + tz * tz);
            if (vt < 1e-9) return;
            double jt = Math.Min(mu * jn, vt / 3.5), Jx = (-jt * tx) / vt, Jy = (-jt * ty) / vt, Jz = (-jt * tz) / vt, iI = 1 / (0.4 * R * R);
            B.vx += Jx;
            B.vy += Jy;
            B.vz += Jz;
            W[0] += (ry * Jz - rz * Jy) * iI;
            W[1] += (rz * Jx - rx * Jz) * iI;
            W[2] += (rx * Jy - ry * Jx) * iI;
        }
        static void ph3Floor()
        {
            double[] s = SURF[surf()];
            double vn = -B.vz;
            if (vn <= 0) return;
            B.vz = vn * s[0];
            spinHit(0, 0, 1, (1 + s[0]) * vn, s[1]);
            B.wv[2] /= 1.5;
            if (B.vz < 25) B.vz = 0;
        }
        static void ph3Roll(double dt)
        {
            double vh = Math.Sqrt(B.vx * B.vx + B.vy * B.vy),
                k = vh > 1.5 ? Math.Max(0, vh - SURF[surf()][2] * dt) / vh : 0;
            var W = B.wv ?? (B.wv = new double[3]);
            B.vx *= k;
            B.vy *= k;
            W[0] = -B.vy / BR;
            W[1] = B.vx / BR;
            W[2] /= 1 + dt * 3;
        }
        static double ph3RimE(bool back, double dot)
        {
            double[] s = SURF[surf()];
            return Math.Min(0.9, (back ? 0.4 : 0.55) * s[3]) * (1 - 0.3 * s[4] * clamp((-dot - 250) / 700, 0, 1)) * (Util.T(B.sh) ? 1 - B.tch : 1);
        }
        public static void ph3RimHit()
        {
            if (B.age - B.rhA > 0.08) B.rh = B.rh + 1;
            B.rhA = B.age;
        }
        static void ph3Launch(Player p, bool three)
        {
            double tc = three ? p.c : (p.c + p.i) / 2;
            B.tch = cfg.PH3 != 0 ? clamp((tc - 60) / 35, 0, 1) * 0.18 : 0;
            B.rh = 0;
            B.rhA = -9;
        }
        static void ph3MakeTxt(double hx)
        {
            if (!Util.T(B.ft) && !Util.T(B.dk) && B.rh >= 2) txtW(B.rh >= 3 ? "ROLLED IN!" : "SHOOTER'S ROLL!", hx, HY, 140, "#9fe7ff");
        }
        public static double ph3Fat(Player p) => cfg.PH3 != 0 ? clamp((0.7 - p.en) / 0.5, 0, 1) : 0;
        static void ph3Short(Player p)
        {
            double f = ph3Fat(p);
            if (f <= 0) return;
            double k = 1 - 0.012 * f;
            B.vx *= k;
            B.vy *= k;
            ph3c("short");
        }
        static void ph3Land(Player p, double v)
        {
            double f = ph3Fat(p);
            if (f <= 0 || v < 100) return;
            p.landT = Math.Max(p.landT, Math.Min(0.4, 0.1 + 0.2 * f));
            p.slow = Math.Max(p.slow, 0.12 * f);
            ph3c("heavyLand");
        }
        public const double SHAT_T = 7;
        static bool ph3Shatter(double hx)
        {
            var L = B.last;
            if (cfg.SHATTER == 0 || Util.T(PREDICT) || L == null || cfg.HALF != 0 || !gameLike() || S != "play") return false;
            double pw = L.bk * L.ht * (0.6 + L.j / 200);
            if (pw < 7.2 || Rng.R() >= 0.006 * Math.Min(1, (pw - 7.2) / 2)) return false;
            int b = hx > 470 ? 1 : 0;
            var N = NETS[b];
            N.shT = SHAT_T;
            N.bsv += 90;
            N.fv += 40;
            ph3c("shatter");
            statAdd("shatter", 1);
            fx(new Fx { k = "shatter", v = b, x = hx, y = HY });
            fx(new Fx { k = "shake", v = 1.2 });
            fx(new Fx { k = "slow", v = 1.5 });
            exc(1);
            ban("SHATTERED THE BACKBOARD!", L.n.ToUpperInvariant() + " · DELAY WHILE THE GLASS IS REPLACED", "#9fe7ff");
            txtW("GLASS!", hx, HY, 150, "#9fe7ff");
            if (cfg.replays) { RQ = 1; HLN = "Glass breaker — " + L.n; }
            return true;
        }
        static void ph3Yank(Net N)
        {
            var L = B.last;
            if (L == null) return;
            double dx = L.x - N.hx, dy = L.y - HY, dl = Math.Sqrt(dx * dx + dy * dy);
            if (!Util.T(dl)) dl = 1;
            double m = (L.bk * L.ht) / 6.5;
            N.tvx += (dx / dl) * 28 * m;
            N.tvy += (dy / dl) * 28 * m;
            N.bsv += 22 * m;
        }
        const double RW_W = 30, RW_Z = 0.08, BS_W = 45, BS_Z = 0.06;
        static void ph3Wobble(Net N, double dt, double gx, double gy)
        {
            N.tvx += (-RW_W * RW_W * (N.tx - gx) - 2 * RW_Z * RW_W * N.tvx) * dt;
            N.tvy += (-RW_W * RW_W * (N.ty - gy) - 2 * RW_Z * RW_W * N.tvy) * dt;
            N.tx += N.tvx * dt;
            N.ty += N.tvy * dt;
            if (N.tx > 1.2 || N.tx < -1.2) { N.tx = clamp(N.tx, -1.2, 1.2); N.tvx = 0; }
            if (N.ty > 1.2 || N.ty < -1.2) { N.ty = clamp(N.ty, -1.2, 1.2); N.tvy = 0; }
            N.bsv += (-BS_W * BS_W * N.bs - 2 * BS_Z * BS_W * N.bsv) * dt;
            N.bs += N.bsv * dt;
            if (N.bs > 3 || N.bs < -3) { N.bs = clamp(N.bs, -3, 3); N.bsv = 0; }
            if (N.shT > 0) N.shT -= dt;
        }

        // ---- bodies ----
        const double PHK = 0.5;
        /// <summary>Box-out (shared with PH2): 1 = A boxes C out, 2 = C boxes A out, 0 = none.</summary>
        static int ph3Box(Player A, Player C)
        {
            var L = B.last;
            if (L == null || B.owner != null || B.mode != "air" || Util.T(B.sc) || !(Util.T(B.sh) || B.age < 1.6) || A.tm == C.tm) return 0;
            double hx = hoop(L.tm), dA = Hypot(A.x - hx, A.y - HY), dC = Hypot(C.x - hx, C.y - HY);
            if (A.tm != L.tm && dA < dC && dA < 170) return 1;
            if (C.tm != L.tm && dC < dA && dC < 170) return 2;
            return 0;
        }
        static void ph3Shove(Player X, Player O, double ux, double uy, double mX, double mO)
        {
            double sh = ((1.6 * mX) / (mX + mO) - 0.5) * (0.6 + 0.8 * PHK);
            if (sh > 0)
            {
                O.x += ux * sh;
                O.y += uy * sh;
            }
            double vin = -(O.vx * ux + O.vy * uy);
            if (vin > 0)
            {
                O.vx += ux * vin * 0.5;
                O.vy += uy * vin * 0.5;
            }
            ph3c("box");
            phBoxN++; // (the PH2 test counters too)
            if (sh > 0) phBoxPx += sh;
        }
        static void ph3Hit(Player A, Player C, double j, double mA, double mC)
        {
            for (int w = 0; w < 2; w++)
            {
                var q2 = w == 0 ? A : C;
                double dv = j / (w == 0 ? mA : mC);
                if (dv > 130)
                {
                    q2.slow = Math.Max(q2.slow, 0.22);
                    ph3c("stumble");
                }
                if (dv > 240 && q2.z <= 0 && q2 != B.owner && q2.mode == "i" && !(q2.actT > 0) && !Util.T(PREDICT) && rs <= 0 && ftq == null && inb <= 0 && gameLike() && Rng.R() < Math.Min(0.35, (dv - 240) / 400))
                {
                    q2.act = 3;
                    q2.actT = 1.15;
                    ph3c("down");
                    statAdd("kd", 1);
                    txtW("KNOCKED DOWN!", q2.x, q2.y, 90, "#ff9966");
                    fx(new Fx { k = "ooh" });
                }
            }
        }
        static void ph3Screen(Player sc0, Player df)
        {
            double mS = sc0.bk * sc0.ht, mD = df.bk * df.ht, ux = sc0.x - df.x, uy = sc0.y - df.y, ul = Math.Sqrt(ux * ux + uy * uy);
            if (!Util.T(ul)) ul = 1;
            double vin = (df.vx * ux + df.vy * uy) / ul, r = mD / mS;
            if (r > 1.12 && vin > 140)
            {
                df.scr = 0.3;
                sc0.hitT = 0.35;
                sc0.hitX = ux / ul;
                sc0.hitY = uy / ul;
                sc0.slow = Math.Max(sc0.slow, 0.3);
                ph3c("fight");
                if (isH(df) || isH(B.owner)) txtW("FIGHTS THROUGH", df.x, df.y, 92, "#9ad");
            }
            else df.scr = 0.55 * clamp(1 / r, 0.8, 1.3);
            if (vin > 0)
            {
                df.vx -= (ux / ul) * vin;
                df.vy -= (uy / ul) * vin;
            }
        }

        // ---- ball handling ----
        static bool ph3Bobble(Player p)
        {
            double rx = B.vx - p.vx, ry = B.vy - p.vy, rz = B.vz - p.vz, rel = Math.Sqrt(rx * rx + ry * ry + rz * rz);
            var pp = B.pp != null ? B.pp.p : null;
            double pk = pp != null && Util.T(pp.pk) ? (pp.pk == 1 ? 0.02 : 0.04) : 0,
                f = JsMath.Cos(p.f) * rx + JsMath.Sin(p.f) * ry,
                back = f > 0.3 * rel ? 0.03 : 0,
                c = (clamp((rel - 560) / 500, 0, 1) * 0.25 + pk + back) * (1.25 - p.s / 140);
            if (c <= 0 || Rng.R() >= c) return false;
            double a = Rng.R() * 6.283;
            var W = B.wv ?? (B.wv = new double[3]);
            B.mode = "air";
            B.to = null;
            B.sh = 0;
            B.last = p;
            B.age = 0.15;
            B.vx = p.vx * 0.8 + rx * 0.1 + JsMath.Cos(a) * 30;
            B.vy = p.vy * 0.8 + ry * 0.1 + JsMath.Sin(a) * 30;
            B.vz = 90 + rel * 0.08;
            W[0] = JsMath.Sin(a) * 25;
            W[1] = -JsMath.Cos(a) * 25;
            W[2] = 12;
            p.act = 5;
            p.actT = 0.35;
            txtW("BOBBLED!", p.x, p.y, 95, "#ff9966");
            ph3c("bobble");
            return true;
        }
        static void ph3Legs()
        {
            double sp = Math.Sqrt(B.vx * B.vx + B.vy * B.vy);
            if (sp < 190) return;
            foreach (var q2 in P)
            {
                if (Util.T(q2.off) || q2 == B.to || q2 == B.last || q2.z > 4) continue;
                double dx = B.x - q2.x, dy = B.y - q2.y, d = Math.Sqrt(dx * dx + dy * dy);
                if (d > 5 || d < 1e-6) continue;
                double nx = dx / d, ny = dy / d, vn = B.vx * nx + B.vy * ny;
                if (vn >= 0) continue;
                var W = B.wv ?? (B.wv = new double[3]);
                double side = (B.vx * ny - B.vy * nx) / BR;
                B.vx = (B.vx - 1.5 * vn * nx) * 0.7;
                B.vy = (B.vy - 1.5 * vn * ny) * 0.7;
                B.vz = Math.Abs(B.vz) * 0.3 + 30;
                W[0] = (-B.vy / BR) * 0.5;
                W[1] = (B.vx / BR) * 0.5;
                W[2] = side * 0.3;
                if (isH(q2) || isH(B.last)) txtW("OFF HIS FOOT", q2.x, q2.y, 70, "#ff9966");
                B.mode = "air";
                B.to = null;
                B.sh = 0;
                B.last = q2;
                B.age = 0;
                ph3c("legs");
                return;
            }
        }
        static bool ph3Scrum(Player p)
        {
            Player r = null;
            foreach (var q2 in P)
                if (q2.tm != p.tm && !Util.T(q2.off) && !(q2.actT > 0) && q2.z < 20)
                {
                    double dx = q2.x - B.x, dy = q2.y - B.y;
                    if (Math.Sqrt(dx * dx + dy * dy) < 14) { r = q2; break; }
                }
            if (r == null || Rng.R() >= 0.3) return false;
            double a = Rng.R() * 6.283;
            var W = B.wv ?? (B.wv = new double[3]);
            B.vx = JsMath.Cos(a) * 110;
            B.vy = JsMath.Sin(a) * 110;
            B.vz = 70;
            B.last = a < 3.1415 ? p : r;
            B.age = 0;
            B.scm = B.scm + 1;
            W[0] = JsMath.Sin(a) * 28;
            W[1] = -JsMath.Cos(a) * 28;
            W[2] = 0;
            p.hitT = 0.25;
            r.hitT = 0.25;
            if (isH(p) || isH(r)) txtW("LOOSE BALL!", B.x, B.y, 60, "#ffd23f");
            ph3c("scrum");
            return true;
        }
        static void ph3DeflSpin(double w)
        {
            var W = B.wv ?? (B.wv = new double[3]);
            W[0] = W[0] * 0.3 - w * 40;
            W[1] = W[1] * 0.3 + w * 40;
            W[2] = w * 120;
        }

        // ---- floor ----
        public static readonly double[] SW = new double[6];
        static readonly double[] SWOX = { 45, 45, 110 }, SWOY = { -30, 30, 0 };
        static double SWQ = 0;
        static double swX(int i) => i < 3 ? HXs[0] + SWOX[i] : HXs[1] - SWOX[i - 3];
        static double swY(int i) => HY + SWOY[i % 3];
        static void ph3Sweat(double dt)
        {
            if (q != SWQ)
            {
                double k = q < SWQ ? 0 : 0.2;
                SWQ = q;
                for (int i = 0; i < 6; i++) SW[i] *= k;
            }
            if (TS.hud > 0) for (int i = 0; i < 6; i++) SW[i] = 0;
            if (q < 3 || cfg.HALF != 0 || !gameLike() || S != "play" || rs > 0) return;
            for (int i = 0; i < 6; i++)
            {
                int n = 0;
                double x = swX(i), y = swY(i);
                foreach (var p in P) if (!Util.T(p.off) && p.z <= 0 && Math.Sqrt((p.x - x) * (p.x - x) + (p.y - y) * (p.y - y)) < 25) n++;
                SW[i] = Math.Min(1, SW[i] + dt * 0.0022 * n);
            }
        }
        public static double wetAt(double x, double y)
        {
            if (cfg.PH3 == 0) return 0;
            double w = 0;
            for (int i = 0; i < 6; i++)
            {
                double dx = x - swX(i), dy = y - swY(i), d = Math.Sqrt(dx * dx + dy * dy);
                if (d < 24) w = Math.Max(w, SW[i] * (1 - d / 24));
            }
            return w;
        }
        static void ph3Slip(Player p)
        {
            double w = wetAt(p.x, p.y);
            if (w <= 0.2) return;
            if (!Util.T(PREDICT)) fx(new Fx { k = "slip", x = p.x, y = p.y, v = w });
            p.vx *= 0.75;
            p.vy *= 0.75;
            ph3c("sweatSlip");
            if (!isH(p)) txtW("SLIPPED ON THE WET SPOT", p.x, p.y, 90, "#ff9966");
        }
        static void ph3Squeak(Player p, double v)
        {
            if (cfg.PH3 == 0 || Util.T(PREDICT) || v < 200 || T - p.sqkT < 0.9) return; // (one per player per .9 s: hard plants only)
            p.sqkT = T;
            fx(new Fx { k = "squeak", x = p.x, y = p.y, v = Math.Min(1, v / 320) });
        }
    }
}
