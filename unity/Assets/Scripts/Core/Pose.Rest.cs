// Port of src/core/pose.ts lines 1-112 (mocap layer, shot clips, fv) and 1736-2380 (body avoidance, procedural
// stepping, faces, inertialization, arm IK, rig constants, hand FK, full-body skeleton). Allocation-free per tick.
using System;
using System.Collections.Generic;
using static Hoops.Core.Util;
using static Hoops.Core.Data;
using static Hoops.Core.Sim;
using static Hoops.Core.Pose;

namespace Hoops.Core
{
    /// <summary>Joint values of one pose (TS p.q / clip output CO / QT): one double per QK channel + mir (lefty shot
    /// mirrored, 1/0). TS `undefined` reads as 0 here (every reader uses `|| 0`). zL is always written by pose3
    /// (VALS[15] = zL ?? sz), so the TS `q.zL ?? q.sz` reads are plain q.zL.</summary>
    public sealed class Q
    {
        public double tL, tR, kL, kR, aL, aR, eL, eR, sz, cr, ln, rz, ty, wR, wL, zL, hz, cx, cy, nk, hy, hp, fL, fR, gL, gR, hs, oL, oR, hL, hR;
        public double mir;

        /// <summary>Channel by QK index (0..30).</summary>
        public double this[int j]
        {
            get
            {
                switch (j)
                {
                    case 0: return tL; case 1: return tR; case 2: return kL; case 3: return kR; case 4: return aL;
                    case 5: return aR; case 6: return eL; case 7: return eR; case 8: return sz; case 9: return cr;
                    case 10: return ln; case 11: return rz; case 12: return ty; case 13: return wR; case 14: return wL;
                    case 15: return zL; case 16: return hz; case 17: return cx; case 18: return cy; case 19: return nk;
                    case 20: return hy; case 21: return hp; case 22: return fL; case 23: return fR; case 24: return gL;
                    case 25: return gR; case 26: return hs; case 27: return oL; case 28: return oR; case 29: return hL;
                    case 30: return hR;
                }
                return double.NaN; // (TS: undefined)
            }
            set
            {
                switch (j)
                {
                    case 0: tL = value; break; case 1: tR = value; break; case 2: kL = value; break; case 3: kR = value; break;
                    case 4: aL = value; break; case 5: aR = value; break; case 6: eL = value; break; case 7: eR = value; break;
                    case 8: sz = value; break; case 9: cr = value; break; case 10: ln = value; break; case 11: rz = value; break;
                    case 12: ty = value; break; case 13: wR = value; break; case 14: wL = value; break; case 15: zL = value; break;
                    case 16: hz = value; break; case 17: cx = value; break; case 18: cy = value; break; case 19: nk = value; break;
                    case 20: hy = value; break; case 21: hp = value; break; case 22: fL = value; break; case 23: fR = value; break;
                    case 24: gL = value; break; case 25: gR = value; break; case 26: hs = value; break; case 27: oL = value; break;
                    case 28: oR = value; break; case 29: hL = value; break; case 30: hR = value; break;
                }
            }
        }

        /// <summary>Channel index of a QK name (-1 = none).</summary>
        public static int Idx(string k)
        {
            switch (k)
            {
                case "tL": return 0; case "tR": return 1; case "kL": return 2; case "kR": return 3; case "aL": return 4;
                case "aR": return 5; case "eL": return 6; case "eR": return 7; case "sz": return 8; case "cr": return 9;
                case "ln": return 10; case "rz": return 11; case "ty": return 12; case "wR": return 13; case "wL": return 14;
                case "zL": return 15; case "hz": return 16; case "cx": return 17; case "cy": return 18; case "nk": return 19;
                case "hy": return 20; case "hp": return 21; case "fL": return 22; case "fR": return 23; case "gL": return 24;
                case "gR": return 25; case "hs": return 26; case "oL": return 27; case "oR": return 28; case "hL": return 29;
                case "hR": return 30;
            }
            return -1;
        }
        public double Get(string k) => k == "mir" ? mir : this[Idx(k)];
        public void Set(string k, double v) { if (k == "mir") mir = v; else this[Idx(k)] = v; }
        public void CopyFrom(Q o)
        {
            for (int j = 0; j < 31; j++) this[j] = o[j];
            mir = o.mir;
        }
    }

    /// <summary>Decoded mocap cycle (TS MCC entry).</summary>
    public sealed class Mcc
    {
        public int n;
        public float[] v, mean;
        public double speed, stride;
        public int dir;
    }

    /// <summary>armIK result (shared object, TS IK).</summary>
    public sealed class IKRes { public bool right = true; public double a, e, ab, over; }

    /// <summary>Head look target (TS LOOK).</summary>
    public sealed class Look { public double x, y, z, on; }

    /// <summary>Rig spec (feet at 6.4 ft); rig3d builds its bones from it.</summary>
    public sealed class Rig
    {
        public readonly double hip = 3.2, hipX = 0.32, chest = 1.0, sh = 0.9, shX = 0.88 * 0.95, neck = 1.02, head = 0.28, L1 = 1.58, L2 = 1.6, ua = 1.02, fa = 1.0, fing = 0.22;
    }

    /// <summary>Animation states (TS ST).</summary>
    public static class ST
    {
        public const int idle = 0, run = 1, def = 2, drib = 3, shot = 4, air = 5, move = 6, post = 7, scr = 8, cel = 9, rest = 10, cat = 11;
    }

    /// <summary>One foot of the procedural stepper (TS FootS + the ad-hoc fields stepSolve hangs on it).</summary>
    public sealed class FootS
    {
        public double st, x, y, z, sx, sy, sz, u, dur, tx, ty;
        public double zo, sw0, fr, pd, pa;
        public double? pst;
    }

    /// <summary>p.stp: stepping state (w = weight, f = feet [L, R], drop = pelvis dip).</summary>
    public sealed class StepState
    {
        public double w;
        public FootS[] f = new FootS[2];
        public double drop, last = -1, dv;
        public double? px, py, duty, reg;
    }

    /// <summary>p.fc: facial expression (see face()).</summary>
    public sealed class FaceState { public double jw, sm, br, an, sq, wd, bl, ex, ey; }

    /// <summary>Face targets for this tick (TS FT).</summary>
    public sealed class FaceT { public double jw, sm, br, an, sq, wd; }

    /// <summary>Skeleton frame: rotation (row-major 3x3) + translation.</summary>
    public sealed class Fr { public double[] R = new double[9]; public double[] t = new double[3]; }

    /// <summary>3-vector (TS V tuple), a struct so the hand FK allocates nothing.</summary>
    public struct V3
    {
        public double x, y, z;
        public V3(double x, double y, double z) { this.x = x; this.y = y; this.z = z; }
    }

    public partial class Player
    {
        public Q q;            // joint values (pose3)
        public float[] skel;   // last skeleton (avoidBodies)
        public double skelOk, off, ry, anS, hk, act, actT, tread, celT, cel, callT, hitT, frT;
        public StepState stp;
        public FaceState fc;
    }

    public static partial class Pose
    {
        static double Or0(double v) => Util.T(v) ? v : 0; // TS `v || 0`

        // ---- motion capture base layer (CMU mocap retargeted by scripts/mocap/retarget.ts) ----
        public static readonly Dictionary<string, Mcc> MCC = BuildMCC();
        static Dictionary<string, Mcc> BuildMCC()
        {
            var r = new Dictionary<string, Mcc>();
            foreach (var kv in MC_RAW)
            {
                var c = kv.Value;
                byte[] raw = Convert.FromBase64String(c.d);
                int C = MC_CH.Length;
                var v = new float[raw.Length];
                var mean = new float[C];
                for (int i = 0; i < raw.Length; i++) v[i] = (float)((sbyte)raw[i] / 40.0); // int8 -> rad
                for (int j = 0; j < C; j++)
                {
                    double s = 0;
                    for (int i = 0; i < c.n; i++) s += v[i * C + j];
                    mean[j] = (float)(s / c.n);
                }
                r[kv.Key] = new Mcc { n = c.n, v = v, mean = mean, speed = c.speed, stride = c.stride, dir = c.dir };
            }
            return r;
        }
        public static readonly Dictionary<string, int> MI = BuildMI();
        static Dictionary<string, int> BuildMI()
        {
            var r = new Dictionary<string, int>();
            for (int i = 0; i < MC_CH.Length; i++) r[MC_CH[i]] = i;
            return r;
        }
        public static readonly float[] MO = new float[MC_CH.Length], MT = new float[MC_CH.Length];
        static readonly int[] MIRS = { MI["tL"], MI["tR"], MI["kL"], MI["kR"], MI["fL"], MI["fR"], MI["aL"], MI["aR"], MI["eL"], MI["eR"], MI["sz"], MI["zL"] };
        static readonly int[] MIRN = { MI["hs"], MI["ty"], MI["rz"], MI["cy"] };

        /// <summary>Sample clip `name` at gait phase ph (rad) into out; amp scales the swing of thighs/knees/arms around
        /// the mean; mirror swaps left/right (sideways clips used in the other direction).</summary>
        public static void mcSample(string name, double ph, double amp, bool mirror, float[] @out)
        {
            var c = MCC[name];
            int C = MC_CH.Length;
            double u = ((((ph / (Math.PI * 2)) % 1) + 1) % 1) * c.n;
            int i0 = (int)Math.Floor(u) % c.n,
                i1 = (i0 + 1) % c.n;
            double f = u - Math.Floor(u);
            for (int j = 0; j < C; j++)
            {
                double a = c.v[i0 * C + j] + (c.v[i1 * C + j] - c.v[i0 * C + j]) * f;
                bool swing = j <= 3 || (j >= 13 && j <= 16);
                @out[j] = (float)(swing ? c.mean[j] + (a - c.mean[j]) * amp : a);
            }
            if (mirror)
            {
                // sw(tL,tR) sw(kL,kR) sw(fL,fR) sw(aL,aR) sw(eL,eR) sw(sz,zL)
                for (int i = 0; i < MIRS.Length; i += 2)
                {
                    float t = @out[MIRS[i]];
                    @out[MIRS[i]] = @out[MIRS[i + 1]];
                    @out[MIRS[i + 1]] = t;
                }
                for (int i = 0; i < MIRN.Length; i++) @out[MIRN[i]] = -@out[MIRN[i]];
            }
        }
        /// <summary>Blend two clips (b weighted u) for the current gait phase into MO.</summary>
        public static void mcBlend(string a, string b, double u, double ph, double amp, bool mirror)
        {
            mcSample(a, ph, amp, mirror, MO);
            if (b != null && b.Length > 0 && u > 0)
            {
                mcSample(b, ph, amp, mirror, MT);
                for (int j = 0; j < MO.Length; j++) MO[j] = (float)(MO[j] + (MT[j] - MO[j]) * u);
            }
        }

        /// <summary>Keyframe track [k0, v0, k1, v1, ...] sampled with smoothstep; null track -> null.</summary>
        public static double? smp(double[] a, double k)
        {
            if (a == null) return null;
            if (k <= a[0]) return a[1];
            for (int i = 2; i < a.Length; i += 2)
                if (k <= a[i])
                {
                    double u = (k - a[i - 2]) / (a[i] - a[i - 2]),
                        s = u * u * (3 - 2 * u);
                    return a[i - 1] + (a[i + 1] - a[i - 1]) * s;
                }
            return a[a.Length - 1];
        }
        static double[] Trk(Clip c, string n) => c != null && c.TryGetValue(n, out var a) ? a : null;

        public static readonly string[] CLIPK = { "aR", "eR", "aL", "eL", "tL", "tR", "kL", "kR", "ln", "sz", "cr", "rz", "ty", "wR", "wL", "zL", "oR", "oL" };
        static readonly int[] CLIPI = BuildClipI();
        static int[] BuildClipI()
        {
            var r = new int[CLIPK.Length];
            for (int i = 0; i < r.Length; i++) r[i] = Q.Idx(CLIPK[i]);
            return r;
        }
        public static readonly Q CO = new Q();
        static readonly Form NOFORM = new Form();
        static string CKof(double sv) { int i = (int)sv; return sv == i && i >= 0 && i < CK.Length ? CK[i] : null; }

        /// <summary>Sample the player's shot clip at phase k (0..1), with signature tweaks. Returns a shared object.</summary>
        public static Q clip(Player p, double k)
        {
            string ck = CKof(p.sv);
            Clip c = ck != null && CL.TryGetValue(ck, out var cc) && cc != null ? cc : CL["jump"];
            var o = CO;
            var jump = CL["jump"];
            for (int i = 0; i < CLIPK.Length; i++)
            {
                string n = CLIPK[i];
                double? v = smp(Trk(c, n), k);
                o[CLIPI[i]] = v == null ? (smp(Trk(jump, n), k) ?? 0) : v.Value;
            }
            var g = p.sg ?? NOFORM;
            double up = Math.Min(1, k / 0.7);
            o.aR += Or0(g.a) * up;
            o.sz += Or0(g.f) * up;
            o.ln += Or0(g.l) * Math.Sin(Math.Min(1, k) * 3.14);
            o.tL += Or0(g.k) * (k > 0.5 ? 1 : 0);
            o.aL -= Or0(g.g) * 0.4 * (k > 0.7 ? (k - 0.7) / 0.3 : 0);
            o.wR *= 1 + Or0(g.w);
            // personal touches
            double rel = k > 0.72 ? Math.Min(1, (k - 0.72) / 0.28) : 0;
            o.aR += Or0(g.ft) * 0.25 * rel; // holds the follow-through up high
            o.wR += Or0(g.ft) * 0.35 * rel;
            o.tR += Or0(g.lk) * (k > 0.6 ? 1 : 0); // leg kick
            o.kR += Or0(g.lk) * 0.9 * (k > 0.6 ? 1 : 0);
            o.ty += Or0(g.tw) * Math.Sin(Math.Min(1, k) * 3.14);
            o.aL += Or0(g.gh) * 0.35 * up;
            o.zL += Or0(g.gh) * 0.25 * up;
            if (k < 0.3) o.aR -= Or0(g.dp) * Math.Sin((k / 0.3) * 3.14) * 0.6; // dip before the rise
            if (ck == "curry" && p.sbw > 0)
            {
                o.ln -= 0.22;
                o.tR -= 0.2;
            }
            return o;
        }

        /// <summary>Drawn facing: the sim's facing plus the root yaw of a spin move (p.ry, 0 otherwise).</summary>
        public static double fv(Player p) => p.f + Or0(p.ry);

        // ---- body avoidance ----
        public static readonly float[] AV = new float[60];
        public sealed class SegR { public double d, nx, ny; }
        public static readonly SegR SEG = new SegR();
        // arm parts tested against other torsos: skeleton joint, radius (px at 6.4 ft), kind (0 shoulder 1 elbow 2 hand)
        public static readonly int[] AVJ = { 13, 17, 15, 19, 12, 16 };
        public static readonly float[] AVR = { 1.7f, 1.7f, 1.3f, 1.3f, 2.6f, 2.6f };
        public static readonly int[] AVK = { 1, 1, 2, 2, 0, 0 };
        /// <summary>Distance from a point to the segment between skeleton joints a and b, and the push-out direction (xy) into SEG.</summary>
        public static void segDist(double px, double py, double pz, float[] s, int a, int b)
        {
            double ax = s[a * 3], ay = s[a * 3 + 1], az = s[a * 3 + 2], bx = s[b * 3], by = s[b * 3 + 1], bz = s[b * 3 + 2];
            double vx = bx - ax, vy = by - ay, vz = bz - az, L2 = vx * vx + vy * vy + vz * vz;
            if (!Util.T(L2)) L2 = 1;
            double u = clamp(((px - ax) * vx + (py - ay) * vy + (pz - az) * vz) / L2, 0, 1);
            double qx = ax + vx * u - px, qy = ay + vy * u - py, qz = az + vz * u - pz;
            SEG.d = Hypot(qx, qy, qz);
            SEG.nx = -qx;
            SEG.ny = -qy;
        }
        public static void avoidBodies(Player p, Q o)
        {
            var sk = p.skel ?? (p.skel = new float[60]);
            skeleton(p, AV);
            double s = p.ht / 6.4,
                cf = Math.Cos(fv(p)),
                sf = Math.Sin(fv(p)),
                ua = RIG.ua * s * 10,
                sw = RIG.shX * p.bk * s * 10;
            double dsz = 0, dzL = 0, daR = 0, daL = 0, deR = 0, deL = 0, dcy = 0;
            for (int qi = 0; qi < P.Count; qi++)
            {
                var q = P[qi];
                if (q == p || Util.T(q.off) || !Util.T(q.skelOk) || Hypot(q.x - p.x, q.y - p.y) > 32) continue;
                double R0 = 4.8 * (q.ht / 6.4) * Math.Min(1.15, q.bk);
                // joints: 12/16 shoulders, 13/17 elbows, 15/19 hands; torso capsule = pelvis (0) .. neck (2)
                for (int n = 0; n < 6; n++)
                {
                    int j = AVJ[n],
                        part = AVK[n];
                    segDist(AV[j * 3], AV[j * 3 + 1], AV[j * 3 + 2], q.skel, 0, 2);
                    double nx = SEG.nx,
                        ny = SEG.ny,
                        pen = R0 + AVR[n] * s - SEG.d;
                    if (pen <= 0) continue;
                    double nn = Hypot(nx, ny);
                    if (!Util.T(nn)) nn = 1;
                    double fw = (nx * cf + ny * sf) / nn, // + = push the part forward (the other body is behind it)
                        lat = (nx * sf - ny * cf) / nn; // + = push toward the body's right
                    bool left = (n & 1) == 0; // joints 13/15/12 are the LEFT arm (skeleton order: left first)
                    if (part == 0)
                    {
                        dcy += -fw * (pen / sw) * (left ? -1 : 1) * 0.8; // twist the chest so that shoulder slips past
                        continue;
                    }
                    double k = Math.Min(0.6, (pen / ua) * 3);
                    // sideways: tuck the arm in (a push toward the body's centre line reduces abduction)
                    double inward = Math.Max(0, left ? lat : -lat); // + = the push points inward for this arm
                    if (left) dzL -= k * 1.6 * inward;
                    else dsz -= k * 1.6 * inward;
                    // in front of him: bend the elbow, drop the arm a little; behind: raise it forward
                    double bk = Math.Max(0, -fw),
                        fr = Math.Max(0, fw);
                    if (left)
                    {
                        deL += k * 1.8 * bk;
                        daL += k * 0.8 * (fr - bk);
                    }
                    else
                    {
                        deR += k * 1.8 * bk;
                        daR += k * 0.8 * (fr - bk);
                    }
                }
            }
            // (proportional to the penetration, which grows and shrinks continuously: contact starts and ends smoothly)
            if (Util.T(dsz) || Util.T(dzL) || Util.T(daR) || Util.T(daL) || Util.T(deR) || Util.T(deL) || Util.T(dcy))
            {
                double z0 = o.zL; // (TS o.zL ?? o.sz: zL is always set on p.q)
                o.sz += clamp(dsz, -0.7, 0);
                o.zL = z0 + clamp(dzL, -0.7, 0);
                o.aR += clamp(daR, -0.6, 0.6);
                o.aL += clamp(daL, -0.6, 0.6);
                o.eR = Math.Min(2.6, o.eR + clamp(deR, 0, 1));
                o.eL = Math.Min(2.6, o.eL + clamp(deL, 0, 1));
                o.cy = Or0(o.cy) + clamp(dcy, -0.5, 0.5);
                skeleton(p, AV);
            }
            Array.Copy(AV, sk, 60);
            p.skelOk = 1;
        }
        /// <summary>Foot placement in the core (2D view, replays, the server skeleton and the 3D rig all agree).</summary>
        public static void plantFeet(Player p, Q o, double sp) => stepSolve(p, o, sp);

        // ---- procedural stepping ----
        public static readonly float[] PSK = new float[60];
        public static readonly int[] LYJ = { 3, 5, 6, 7, 9, 10, 11, 13, 15, 17, 19 }; // head, knees, ankles, toes, elbows, hands
        public static double SWA = 0.6;
        public static double setSWA(double v) => SWA = v;
        public static void stepSolve(Player p, Q o, double sp)
        {
            string md = p.mode;
            double st = p.anS;
            // (+ the gather of a jumper: the feet stay planted - or take the hop into the clip's stance - while the hips dip)
            bool gat = md == "c" && st == ST.shot && !Util.T(p.hk) && !IsLaySv(I(Or0(p.sv))) && !IsDunkSv(I(Or0(p.sv))),
                ok = p.z < 1 && (md == "i" || gat) && !(p.actT > 0 && (p.act == 3 || p.act == 4 || p.act == 5)) && (st == ST.idle || st == ST.run || st == ST.def || st == ST.drib || st == ST.scr || st == ST.cat || st == ST.rest || st == ST.post || st == ST.move || gat || (st == ST.air && md == "i") || (st == ST.cel && sp > 25));
            var S = p.stp ?? (p.stp = new StepState());
            S.w += ((ok ? 1 : 0) - S.w) * Math.Min(1, DT * (ok ? 8 : 14));
            skeleton(p, PSK);
            double s = p.ht / 6.4,
                L1 = RIG.L1 * s * 10,
                L2 = RIG.L2 * s * 10,
                Lm = L1 + L2,
                cf = Math.Cos(fv(p)),
                sf = Math.Sin(fv(p));
            // lying on the floor (a dive, knocked down): nothing may sink through it - lift the whole body by the deepest point
            if (p.actT > 0 && (p.act == 3 || p.act == 4) && p.z < 2)
            {
                double m = 0;
                for (int i = 0; i < LYJ.Length; i++) m = Math.Min(m, PSK[LYJ[i] * 3 + 2]);
                if (m < 0) o.cr += m / 4; // (cr lowers the root by 4 px per unit)
            }
            if (S.w < 0.01)
            {
                S.f[0] = S.f[1] = null; // re-seeded from the animated feet next time
                return;
            }
            // treadmill (Animation Studio: the body stays put while "moving"): the floor slides back under the feet
            if (Util.T(p.tread))
                for (int i = 0; i < 2; i++)
                {
                    var F = S.f[i];
                    if (F != null)
                    {
                        F.x -= p.vx * DT; F.y -= p.vy * DT; F.sx -= p.vx * DT; F.sy -= p.vy * DT; F.tx -= p.vx * DT; F.ty -= p.vy * DT;
                    }
                }
            // teleported (inbound setup, substitution): re-seed the feet from the animation
            if (S.px != null && Hypot(p.x - S.px.Value, p.y - S.py.Value) > 30) S.f[0] = S.f[1] = null;
            S.px = p.x;
            S.py = p.y;
            double v = sp,
                spd = Math.Min(1, v / 250);
            double side = v > 1 ? Math.Abs((p.vx / v) * sf - (p.vy / v) * cf) : 0; // 1 = moving straight sideways (a slide)
            // duty factor (slides never leave the floor), eased; capped so a planted foot stays within the leg's reach
            double rq = Lm * 0.95, rz0 = PSK[14] - 4 * s;
            double reachH = Math.Sqrt(Math.Max(1, rq * rq - rz0 * rz0)),
                dT = Math.Min(Math.Min(0.75, 0.62 - 0.27 * spd + 0.22 * side), (1.7 * reachH) / (2 * stepLen(v)));
            S.duty = S.duty == null ? dT : S.duty.Value + (dT - S.duty.Value) * Math.Min(1, DT * 4);
            double reg = S.reg == 1 ? (v > 18 ? 1 : 0) : v > 30 ? 1 : 0; // moving / standing, with hysteresis (no flip-flop)
            double duty = reg != 0 ? S.duty.Value : 1,
                stepL = stepLen(v),
                ux = v > 1 ? p.vx / v : cf,
                uy = v > 1 ? p.vy / v : sf;
            double drop = 0;
            // regime change (moving <-> standing): a foot that is mid-air finishes its step from where it is now
            if (S.reg != reg)
            {
                for (int i = 0; i < 2; i++)
                {
                    var F = S.f[i];
                    if (F != null && !Util.T(F.st)) { F.sx = F.x; F.sy = F.y; F.sz = F.z; F.u = 0; F.dur = 0.15; }
                }
                S.reg = reg;
            }
            // standing: which foot steps? the one that is farthest from where it belongs (a turn in place pivots on the other)
            int need = -1;
            if (reg == 0 && S.f[0] != null && S.f[1] != null && Util.T(S.f[0].st) && Util.T(S.f[1].st))
            {
                double best = 7 * s;
                for (int k = 0; k < 2; k++)
                {
                    int P0 = k != 0 ? 8 : 4;
                    double hx = PSK[P0 * 3],
                        hy = PSK[P0 * 3 + 1],
                        lat = ((PSK[(P0 + 2) * 3] - hx) * sf - (PSK[(P0 + 2) * 3 + 1] - hy) * cf) * (st == ST.post ? 1.6 : 1) + (st == ST.post ? (k != 0 ? 2 : -2) * s : 0),
                        e = gat ? Hypot(S.f[k].x - PSK[(P0 + 2) * 3], S.f[k].y - PSK[(P0 + 2) * 3 + 1]) : Hypot(S.f[k].x - (hx + sf * lat), S.f[k].y - (hy - cf * lat));
                    if (e > best && S.last != k) { best = e; need = k; }
                }
            }
            for (int k = 0; k < 2; k++)
            {
                int P0 = k != 0 ? 8 : 4;
                double hx = PSK[P0 * 3],
                    hy = PSK[P0 * 3 + 1],
                    hz = PSK[P0 * 3 + 2],
                    ax = PSK[(P0 + 2) * 3],
                    ay = PSK[(P0 + 2) * 3 + 1];
                var F = S.f[k];
                if (F == null) F = S.f[k] = new FootS { st = 1, x = ax, y = ay, z = 0, sx = ax, sy = ay, sz = 0, u = 0, dur = 0.2, tx = ax, ty = ay };
                // the animated foot's spread from the hip (stance width, slides) = where this foot naturally lands sideways
                // (posting up: a wide, low base to lean into the defender)
                double lat = ((ax - hx) * sf - (ay - hy) * cf) * (st == ST.post ? 1.6 : 1) + (st == ST.post ? (k != 0 ? 2 : -2) * s : 0);
                // (a jumper's gather keeps the clip's stagger too: the shooting foot a little ahead)
                double restX = gat ? ax : hx + sf * lat,
                    restY = gat ? ay : hy - cf * lat;
                if (reg != 0)
                {
                    // gait schedule: leg phase 0 = touchdown (L lands at ph = pi/2, R at 3pi/2)
                    double ph = (((p.ph - (k != 0 ? 1.5 : 0.5) * Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
                    bool stance = ph < duty * 2 * Math.PI;
                    if (stance && !Util.T(F.st))
                    {
                        // touchdown, where the foot is (normally its target: the swing ends there)
                        F.st = 1;
                        F.zo = F.z; // (an early touchdown settles the last bit instead of snapping)
                        F.z = 0;
                    }
                    else if (!stance && Util.T(F.st))
                    {
                        // lift-off: swing to where the body will be half a stance from now ... plus that half stance ahead
                        F.st = 0;
                        F.sx = F.x; F.sy = F.y; F.sz = F.z;
                        double s0 = (ph - duty * 2 * Math.PI) / ((1 - duty) * 2 * Math.PI);
                        F.sw0 = s0 > 0.1 ? s0 : 0; // a swing started mid-phase (from standing) counts from here; a normal toe-off from 0
                        F.fr = 1; // aim the landing spot from the first swing tick
                    }
                    if (!Util.T(F.st))
                    {
                        double sw0 = (ph - duty * 2 * Math.PI) / ((1 - duty) * 2 * Math.PI),
                            sw = clamp((sw0 - Or0(F.sw0)) / Math.Max(0.05, 1 - Or0(F.sw0)), 0, 1), // 0..1 through the swing
                            tLeft = ((1 - sw) * (1 - duty) * 2 * stepL) / Math.Max(v, 1), // seconds until touchdown
                            ahead = duty * stepL * (1 - 0.35 * side); // touch down this far ahead of the hip; slides take shorter steps
                        // (the landing spot is eased: a sudden cut moves it, it doesn't teleport the swinging foot)
                        double tr = Util.T(p.tread) ? 0 : tLeft; // on the studio treadmill the body doesn't travel - the floor does
                        double nx = restX + p.vx * tr + ux * ahead,
                            ny = restY + p.vy * tr + uy * ahead;
                        {
                            // keep the whole stance within the leg's reach (a wide slide narrows instead of over-stretching)
                            double hX = hx + p.vx * tr,
                                hY = hy + p.vy * tr,
                                R = reachH * 0.92,
                                trv = duty * 2 * stepL;
                            double al = (nx - hX) * ux + (ny - hY) * uy,
                                lt = -(nx - hX) * uy + (ny - hY) * ux;
                            al = Math.Min(al, R);
                            if (al - trv < -R) al = trv - R;
                            double am = Math.Max(Math.Abs(al), Math.Abs(al - trv)),
                                lm = Math.Sqrt(Math.Max(0, R * R - am * am));
                            lt = clamp(lt, -lm, lm);
                            // (a step never lands across the body's midline: the legs don't cross in slides and cuts)
                            double mid = RIG.hipX * s * 10;
                            lt = k != 0 ? Math.Max(lt, -mid + 1) : Math.Min(lt, mid - 1);
                            nx = hX + ux * al - uy * lt;
                            ny = hY + uy * al + ux * lt;
                        }
                        double ke = Util.T(F.fr) ? 1 : Math.Min(1, DT * 18);
                        F.fr = 0;
                        F.tx += (nx - F.tx) * ke;
                        F.ty += (ny - F.ty) * ke;
                        // swing profile: e(0)=0, e'(0)=a, e(1)=1, e'(1)=0
                        double a = SWA,
                            e = sw * (a + sw * (3 - 2 * a + sw * (a - 2)));
                        F.x = F.sx + (F.tx - F.sx) * e;
                        F.y = F.sy + (F.ty - F.sy) * e;
                        // arc with no vertical kick at lift-off / touchdown; sideways steps (slides) stay low
                        F.z = F.sz * (1 - e) + (2.5 + 9 * spd) * (1 - 0.7 * side) * s * 16 * sw * sw * (1 - sw) * (1 - sw);
                    }
                }
                else
                {
                    // standing: feet stay planted; a shuffle step when the body turned or drifted away from this foot
                    if (Util.T(F.st) && need == k)
                    {
                        // a longer step takes a little longer (a pivot's quarter turn ~.2 s, a reset after a big drift ~.3 s)
                        double dd = Hypot(F.x - restX, F.y - restY);
                        F.st = 0; F.u = 0; F.dur = clamp(0.14 + dd / (s * 160), 0.16, 0.3); F.sx = F.x; F.sy = F.y; F.sz = F.z; S.last = k;
                    }
                    if (!Util.T(F.st))
                    {
                        F.u = Math.Min(1, F.u + DT / F.dur);
                        double e = F.u * F.u * (3 - 2 * F.u);
                        F.x = F.sx + (restX - F.sx) * e;
                        F.y = F.sy + (restY - F.sy) * e;
                        F.z = F.sz * (1 - e) + 3 * s * 16 * F.u * F.u * (1 - F.u) * (1 - F.u);
                        F.tx = restX;
                        F.ty = restY;
                        if (F.u >= 1) { F.st = 1; F.z = 0; S.last = -1; }
                    }
                }
                if (Util.T(F.st) && Util.T(F.zo)) F.zo = F.zo < 0.05 ? 0 : F.zo * Math.Exp(-DT / 0.035);
                // pelvis dip so a planted foot stays within reach
                double fw = (F.x - hx) * cf + (F.y - hy) * sf;
                if (Util.T(F.st))
                {
                    double r9 = Lm * 0.965;
                    drop = Math.Max(drop, hz - F.z - Math.Sqrt(Math.Max(0, r9 * r9 - fw * fw)));
                }
            }
            // the dip rides a critically damped spring (it would step whenever a foot lands or lifts)
            {
                double w = 22;
                // (+ a defender sits in his stance: now that his feet are really on the floor the knees only bend if the hips drop)
                double sit = st == ST.def ? 3 * s : st == ST.post ? 5 * s : 0;
                S.dv = Or0(S.dv) + (w * w * (clamp(drop + sit, 0, 5 + sit) - S.drop) - 2 * w * Or0(S.dv)) * DT;
                S.drop = Math.Max(0, S.drop + S.dv * DT);
            }
            double W = S.w * S.w * (3 - 2 * S.w);
            o.cr += (S.drop / 4) * W;
            // solve both legs from the (lowered) hips
            double abL = 0,
                abR = 0;
            for (int k = 0; k < 2; k++)
            {
                var F = S.f[k];
                int P0 = k != 0 ? 8 : 4;
                double hx = PSK[P0 * 3],
                    hy = PSK[P0 * 3 + 1],
                    hz = PSK[P0 * 3 + 2] - S.drop * W,
                    fw = (F.x - hx) * cf + (F.y - hy) * sf,
                    lt = (F.x - hx) * sf - (F.y - hy) * cf, // + = the body's right
                    dz = F.z + (Util.T(F.st) ? Or0(F.zo) : 0) - hz,
                    vert = Hypot(dz, lt),
                    ds = Lm * 0.88, // (soft IK from 88% of reach: lift-off pops otherwise)
                    d0 = Math.Max(0.35 * Lm, Hypot(fw, vert)),
                    d = d0 > ds ? ds + (Lm - ds) * (1 - Math.Exp(-(d0 - ds) / (Lm - ds))) : d0,
                    a1 = Math.Acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1)),
                    tI = Math.Atan2(fw, vert) + a1,
                    kI = Math.PI - Math.Acos(clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1)),
                    ab = Math.Atan2(lt, Math.Max(5, -dz));
                if (k != 0)
                {
                    o.tR += (tI - o.tR) * W;
                    o.kR += (kI - o.kR) * W;
                }
                else
                {
                    o.tL += (tI - o.tL) * W;
                    o.kL += (kI - o.kL) * W;
                }
                // feet: flat through stance (rolling onto the toes at the end), toes down in the swing
                double fz = tI - kI;
                if (reg != 0)
                {
                    double ph = (((p.ph - (k != 0 ? 1.5 : 0.5) * Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI),
                        roll = (0.55 * spd + 0.1) * (1 - 0.8 * side); // slides keep the feet flat
                    if (Util.T(F.st))
                    {
                        double u = ph / (duty * 2 * Math.PI);
                        double m = Math.Max(0, (u - 0.7) / 0.3);
                        fz += m * m * roll;
                    }
                    else
                    {
                        double sw0 = (ph - duty * 2 * Math.PI) / ((1 - duty) * 2 * Math.PI),
                            sw = clamp((sw0 - Or0(F.sw0)) / Math.Max(0.05, 1 - Or0(F.sw0)), 0, 1),
                            r0 = Util.T(F.sw0) ? 0 : 1; // a swing that started from standing has no toe-off roll to carry
                        fz += r0 * roll * (1 - sw) * (1 - sw) * (1 + 2 * sw); // smooth fade (zero slope at touchdown)
                    }
                }
                else if (!Util.T(F.st)) fz += 0.2 * Math.Sin(Math.PI * F.u);
                {
                    // the toe roll / swing pitch are continuous by design, except where a contact flips early: carry the gap and fade it
                    double add = fz - (tI - kI);
                    if (F.pst != null && F.pst.Value != F.st) F.pd = Or0(F.pa) - add;
                    else F.pd = Math.Abs(Or0(F.pd)) < 1e-3 ? 0 : F.pd * Math.Exp(-DT / 0.06);
                    add += F.pd;
                    F.pa = add;
                    F.pst = F.st;
                    fz = tI - kI + add;
                }
                // (an ankle only dorsiflexes so far: past it the heel comes up and he is on the ball of the foot)
                if (k != 0) o.fR += (Math.Max(fz, -0.6) - o.fR) * W;
                else o.fL += (Math.Max(fz, -0.6) - o.fL) * W;
                if (k != 0) abR = ab;
                else abL = ab;
            }
            // per-leg abduction (rig: abd L = hs - hz, abd R = hs + hz)
            o.hz += ((abR - abL) / 2 - o.hz) * W;
            o.hs += ((abR + abL) / 2 - o.hs) * W;
        }

        // ---- facial expression (p.fc) ----
        public static readonly FaceT FT = new FaceT();
        public static void face(Player p, double st, double hyT, double hpT)
        {
            var c = p.fc ?? (p.fc = new FaceState());
            var t = FT;
            string md = p.mode;
            double cel = p.celT > 0 ? p.cel : 0,
                e = CEL_T - Or0(p.celT);
            t.jw = t.sm = t.br = t.an = t.sq = t.wd = 0;
            if (p.callT > 0) p.callT -= DT;
            switch (cel)
            {
                case 1: // shimmy, three-up, point up, dap, help up, hyping a teammate: grin
                case 4:
                case 8:
                case 9:
                case 16:
                    t.sm = 1; t.jw = 0.14; t.br = 0.25;
                    break;
                case 13:
                    t.sm = 1; t.jw = 0.2 + 0.35 * Math.Abs(Math.Sin(e * 9)); t.br = 0.3; // "let's go!"
                    break;
                case 2: // night-night, shh: a smirk
                case 7:
                    t.sm = 0.55; t.sq = 0.35; t.br = -0.1;
                    break;
                case 3: // flex, chest thump, roar, the block stare-down, jersey tug: yell
                case 5:
                case 6:
                case 14:
                    t.jw = 0.95; t.an = 0.85; t.sq = 0.55; t.wd = 0.8; t.sm = -0.1;
                    break;
                case 15:
                    t.jw = 0.45 + 0.25 * Math.Abs(Math.Sin(e * 7)); t.an = 0.5; t.sq = 0.4; t.wd = 0.5;
                    break;
                case 11: // missed an open look: wince
                    t.jw = 0.3; t.br = 0.9; t.sq = 0.6; t.sm = -0.7; t.wd = 0.3;
                    break;
                case 12: // arguing a call: talking, brows knit
                    t.jw = 0.12 + 0.4 * Math.Abs(Math.Sin(e * 11) * Math.Sin(e * 4.3)); t.an = 0.75; t.br = 0.2; t.sm = -0.4;
                    break;
                case 10: // held follow-through on a green: cool, confident
                    t.sm = 0.35; t.sq = 0.2;
                    break;
                default:
                    if (Or0(p.hitT) > 0.04) { t.an = 0.7; t.sq = 1; t.wd = 1; t.jw = 0.12; t.sm = -0.35; } // contact: gritted teeth
                    else if (md == "s" && p.z > 6 && IsDunkSv(I(Or0(p.sv)))) { t.jw = 0.75; t.an = 0.7; t.wd = 0.7; t.sq = 0.35; } // throwing it down
                    else if (Or0(p.callT) > 0) { t.jw = 0.35 + 0.3 * Math.Abs(Math.Sin(Sim.T * 9)); t.br = 0.5; t.wd = 0.3; } // "Ball! Ball!"
                    else if (Or0(p.frT) > 0) { t.sm = -0.85; t.br = 0.75; t.jw = 0.18 + (p.frT > 1.2 ? 0.25 : 0); t.sq = 0.3; } // frustration after a miss
                    else if (md == "s" || md == "c") { t.an = 0.3; t.sq = 0.3; t.sm = -0.12; } // focus: lips pressed
                    else if (S == "over")
                    {
                        bool won = sc[(int)p.tm] > sc[1 - (int)p.tm];
                        if (won) { t.sm = 1; t.jw = 0.18; t.br = 0.3; }
                        else { t.sm = -0.75; t.br = 0.6; t.sq = 0.2; }
                    }
                    else if (st == ST.def) { t.an = 0.4; t.sq = 0.25; t.sm = -0.1; }
                    else if (p.en < 0.6) t.jw = 0.22 + 0.12 * Math.Sin(Sim.T * 4.5 + p.k); // gassed: breathing through the mouth (TS p.en ?? 1)
                    break;
            }
            double kf = Math.Min(1, DT * 10),
                kj = Math.Min(1, DT * 16);
            c.jw += (t.jw - c.jw) * kj;
            c.sm += (t.sm - c.sm) * kf;
            c.br += (t.br - c.br) * kf;
            c.an += (t.an - c.an) * kf;
            c.sq += (t.sq - c.sq) * kf;
            c.wd += (t.wd - c.wd) * kj;
            // blinks: every 2.6-4.6 s per player (slot-seeded), a quick 0.15 s close; a flinch blink on contact
            double per = 2.6 + ((p.k * 7) % 5) * 0.5,
                ph = (Sim.T + p.k * 1.37) % per;
            c.bl = ph < 0.15 ? Math.Sin((ph / 0.15) * Math.PI) : 0;
            if (Or0(p.hitT) > 0.3) c.bl = 1;
            // eyes take what the head turn did not (clamped to the eye's travel), and lead it a little
            var q = p.q;
            c.ex += (clamp((hyT - Or0(q.hy)) * 0.8, -0.55, 0.55) - c.ex) * Math.Min(1, DT * 20);
            c.ey += (clamp((hpT - Or0(q.hp)) * 0.8, -0.45, 0.45) - c.ey) * Math.Min(1, DT * 20);
        }

        public static double wrapPi(double a) => a - Round(a / (2 * Math.PI)) * 2 * Math.PI;
        /// <summary>Inertialization offset at time t (Bollo): starts at x0 with velocity v0, reaches 0 with zero velocity
        /// and acceleration at tf; velocity pointing away from zero is dropped and tf shortened so it never overshoots.</summary>
        public static double inert(double x0, double v0, double tf, double t)
        {
            if (x0 == 0 && v0 == 0) return 0;
            if (x0 * v0 > 0) v0 = 0;
            if (v0 != 0) tf = Math.Min(tf, Math.Max(1e-3, (-5 * x0) / v0));
            if (t >= tf) return 0;
            double tf2 = tf * tf;
            double a0 = (-8 * v0 * tf - 20 * x0) / tf2;
            if (a0 * x0 < 0) a0 = 0; // must accelerate toward zero, never away
            double A = -(a0 * tf2 + 6 * v0 * tf + 12 * x0) / (2 * tf2 * tf2 * tf),
                Bq = (3 * a0 * tf2 + 16 * v0 * tf + 30 * x0) / (2 * tf2 * tf2),
                C = -(3 * a0 * tf2 + 12 * v0 * tf + 20 * x0) / (2 * tf2 * tf);
            return (((A * t + Bq) * t + C) * t + a0 / 2) * t * t + v0 * t + x0;
        }

        /// <summary>Two-bone arm IK toward a game-space point (px). side: +1 right arm, -1 left, 0 = the arm on the
        /// target's side. Returns shoulder raise a, elbow e, abduction ab (for zL/sz), and how far the target is beyond
        /// reach (over). Shared result object.</summary>
        public static readonly IKRes IK = new IKRes();
        public static IKRes armIK(Player p, double cr, double x, double y, double z, double side, double abMax)
        {
            double S2 = p.ht / 6.4;
            // W3(p.x, p.y, p.z) and W3(x, y, z), inline (no allocation)
            double w0 = (p.x - 470) * 0.1, w1 = p.z * 0.1, w2 = (p.y - 250) * 0.1;
            double b0 = (x - 470) * 0.1, b1 = z * 0.1, b2 = (y - 250) * 0.1;
            double th = Math.PI / 2 - fv(p),
                X1 = b0 - w0,
                Y1 = b1 - (w1 - cr * 0.4),
                Z1 = b2 - w2,
                lx = (X1 * Math.Cos(th) - Z1 * Math.Sin(th)) / S2,
                lz = (X1 * Math.Sin(th) + Z1 * Math.Cos(th)) / S2;
            bool right = Util.T(side) ? side > 0 : lx >= 0;
            double tx = right ? lx - RIG.shX * p.bk : lx + RIG.shX * p.bk,
                ty2 = Y1 / S2 - (RIG.hip + RIG.chest + RIG.sh),
                tz = lz,
                L1 = 1.02,
                L2 = 1.15,
                raw = Hypot(tx, ty2, tz),
                d = Math.Min(L1 + L2 - 0.02, Math.Max(0.3, raw)),
                ph2 = Math.Atan2(tz, -ty2),
                al = Math.Acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
            IK.right = right;
            IK.a = ph2 - al;
            // keep the shoulder in its real range (a target straight overhead and a hair behind wraps atan2)
            if (IK.a < -2.6) IK.a += 2 * Math.PI;
            IK.e = Math.PI - Math.Acos(clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
            IK.ab = clamp(Math.Atan2(right ? tx : -tx, Math.Max(0.2, Math.Abs(ty2))), -0.4, abMax);
            IK.over = raw - (L1 + L2);
            return IK;
        }
        /// <summary>A shoulder angle in armIK's range (-2.6 .. 2 pi - 2.6): over the top stays over the top.</summary>
        public static double armN(double a) => a < -2.6 ? a + 2 * Math.PI : a > 2 * Math.PI - 2.6 ? a - 2 * Math.PI : a;
        /// <summary>Clip phase (0..1) at which each shot clip's wrist snaps = the ball's release.</summary>
        public static readonly Dictionary<string, double> RELK = new() { ["jump"] = 0.7, ["mshot"] = 0.7, ["upunder"] = 0.7, ["quick"] = 0.46, ["fade"] = 0.7, ["step"] = 0.7, ["float"] = 0.6, ["hop"] = 0.58, ["curry"] = 0.78, ["hook"] = 0.95, ["lay"] = 0.7, ["euro"] = 0.7, ["roll"] = 0.72, ["revlay"] = 0.6, ["contact"] = 0.6, ["leaner"] = 0.68, ["runner"] = 0.66, ["dunk"] = 0.7, ["dunk2"] = 0.72, ["tomahawk"] = 0.76, ["windmill"] = 0.76, ["reverse"] = 0.78, ["d360"] = 0.68, ["hang"] = 1 };

        /// <summary>Joint channel names in p.q order (TS sim.ts QK).</summary>
        public static readonly string[] QK = { "tL", "tR", "kL", "kR", "aL", "aR", "eL", "eR", "sz", "cr", "ln", "rz", "ty", "wR", "wL", "zL", "hz", "cx", "cy", "nk", "hy", "hp", "fL", "fR", "gL", "gR", "hs", "oL", "oR", "hL", "hR" };
        public const int NQ = 31;
        public static readonly double[] VALS = new double[NQ];
        public static readonly Look LOOK = new Look();
        public static double HEADX = 0,
            MCF = 0, // weight of the mocap layer this tick (feet use it after the upper-body layers)
            MFL = 0,
            MFR = 0;
        /// <summary>Blend times in seconds when entering / tracking each animation state (index = ST).</summary>
        public static readonly double[] BLEND = { 0.16, 0.12, 0.15, 0.1, 0.05, 0.08, 0.07, 0.2, 0.22, 0.18, 0.4, 0.09 };

        // ---- forward kinematics (mirrors the three.js rig hierarchy exactly; rig3d builds its bones from RIG) ----
        // G: pos(w0, w1 - cr*0.4, w2), rotY(PI/2 - f), scale ht/6.4 -> pelvis bd: pos(0,3.2,0) Euler(ln,ty,rz,'YXZ')
        // -> chest: pos(0,1,0) Euler(cx,cy,0,'YXZ') -> R shoulder: pos(0.88*0.95*bk, 0.9, 0) Euler(-aR, -hR, sz,'XZY')
        // -> elbow: pos(0,-1.02,0) rotX(-eR) -> wrist: pos(0,-1,0) rotX(-wR) -> palm point (0,-0.62,0.1).
        // chest -> neck pos(0,1.02,0) rotX(nk) -> head pos(0,0.28,0) Euler(hp,hy,0,'YXZ'). hips pos(+-0.32,3.2,0)
        // Euler(-t,0,+-(hz+-hs)) -> knee pos(0,-1.58,0) rotX(k) -> ankle pos(0,-1.6,0) rotX(f). wrist -> fingers pos(0,-0.22,0) rotX(-g*1.4).
        public static readonly Rig RIG = new Rig();
        /// <summary>Left/right hip abduction (wide stance hz plus the shuffle asymmetry hs).</summary>
        public static double hipAb(Q q, double sd) => sd * (Or0(q.hz) + sd * Or0(q.hs));
        public static V3 rx(V3 v, double a)
        {
            double c = Math.Cos(a), s = Math.Sin(a);
            return new V3(v.x, v.y * c - v.z * s, v.y * s + v.z * c);
        }
        public static V3 ry(V3 v, double a)
        {
            double c = Math.Cos(a), s = Math.Sin(a);
            return new V3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
        }
        public static V3 rz(V3 v, double a)
        {
            double c = Math.Cos(a), s = Math.Sin(a);
            return new V3(v.x * c - v.y * s, v.x * s + v.y * c, v.z);
        }
        public static V3 add(V3 a, V3 b) => new V3(a.x + b.x, a.y + b.y, a.z + b.z);

        /// <summary>Right palm (ball center while holding) for candidate joint values this tick (handPos chain, before
        /// p.q is written). Only these ten channels are ever set on QT (the rest read 0 like TS undefined).</summary>
        public static readonly Q QT = new Q();
        public static double[] palmAt(Player p, double aR, double eR, double sz, double wR, double ln, double ty, double rz, double cx, double cy, double cr)
        {
            QT.aR = aR;
            QT.eR = eR;
            QT.sz = sz;
            QT.wR = wR;
            QT.ln = ln;
            QT.ty = ty;
            QT.rz = rz;
            QT.cx = cx;
            QT.cy = cy;
            QT.cr = cr;
            var q0 = p.q;
            p.q = QT;
            var h = handPos(p);
            p.q = q0;
            return h;
        }
        // handPos results come from a small ring (allocation-free; TS returned a fresh array): a result stays valid for
        // the next 7 calls. Copy it if you keep it longer.
        const int HPN = 8;
        static readonly double[][] HP = BuildHP();
        static double[][] BuildHP() { var r = new double[HPN][]; for (int i = 0; i < HPN; i++) r[i] = new double[3]; return r; }
        static int hpi;
        /// <summary>World position (game coords) of a point in the shooting wrist frame (the right one; the left one while
        /// a lefty's shot is mirrored, q.mir); default = palm (0, -0.62, 0.1). Null when the player has no pose yet.</summary>
        public static double[] handPos(Player p) => handPos(p, 0, -0.62, 0.1);
        public static double[] handPos(Player p, double[] pt) => pt == null ? handPos(p) : handPos(p, pt[0], pt[1], pt[2]);
        public static double[] handPos(Player p, double ptx, double pty, double ptz)
        {
            var q = p.q;
            if (q == null) return null;
            bool L = Util.T(q.mir);
            var v = ry(rx(new V3(ptx, pty, ptz), -Or0(L ? q.wL : q.wR)), Or0(L ? q.oL : q.oR)); // wrist flex, then forearm twist
            v = add(v, new V3(0, -RIG.fa, 0));
            v = rx(v, -(L ? q.eL : q.eR));
            v = add(v, new V3(0, -RIG.ua, 0));
            // shoulder XZY Euler: R = Rx * Rz * Ry (applied right-to-left: the humeral twist about the bone first)
            v = L ? rx(rz(ry(v, Or0(q.hL)), -q.zL), -q.aL) : rx(rz(ry(v, -Or0(q.hR)), q.sz), -q.aR); // (TS q.zL ?? q.sz)
            v = add(v, new V3((L ? -1 : 1) * RIG.shX * p.bk, RIG.sh, 0));
            // YXZ Euler: R = Ry * Rx * Rz
            v = ry(rx(v, Or0(q.cx)), Or0(q.cy));
            v = add(v, new V3(0, RIG.chest, 0));
            v = ry(rx(rz(v, q.rz), q.ln), q.ty);
            v = add(v, new V3(0, RIG.hip, 0));
            double s = p.ht / 6.4;
            v = new V3(v.x * s, v.y * s, v.z * s);
            v = ry(v, Math.PI / 2 - fv(p));
            double w0 = (p.x - 470) * 0.1, w1 = p.z * 0.1, w2 = (p.y - 250) * 0.1; // W3(p.x, p.y, p.z)
            v = add(v, new V3(w0, w1 - q.cr * 0.4, w2));
            var r = HP[hpi++ % HPN];
            if (hpi >= HPN) hpi = 0;
            r[0] = v.x * 10 + 470;
            r[1] = v.z * 10 + 250;
            r[2] = v.y * 10;
            return r;
        }

        // ---- full-body forward kinematics (2D renderer, effects): 20 joints in game coordinates ----
        // 0 pelvis 1 chest 2 neck 3 head | 4-7 L hip/knee/ankle/toe | 8-11 R hip/knee/ankle/toe
        // 12-15 L shoulder/elbow/wrist/hand | 16-19 R shoulder/elbow/wrist/hand
        /// <summary>Row-major 3x3 product a*b into o.</summary>
        public static double[] mm(double[] a, double[] b, double[] o)
        {
            for (int r = 0; r < 3; r++)
                for (int c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
            return o;
        }
        public static double[] rot(int ax, double t, double[] o)
        {
            double c = Math.Cos(t),
                s = Math.Sin(t);
            if (ax == 0) { o[0] = 1; o[1] = 0; o[2] = 0; o[3] = 0; o[4] = c; o[5] = -s; o[6] = 0; o[7] = s; o[8] = c; }
            else if (ax == 1) { o[0] = c; o[1] = 0; o[2] = s; o[3] = 0; o[4] = 1; o[5] = 0; o[6] = -s; o[7] = 0; o[8] = c; }
            else { o[0] = c; o[1] = -s; o[2] = 0; o[3] = s; o[4] = c; o[5] = 0; o[6] = 0; o[7] = 0; o[8] = 1; }
            return o;
        }
        // (allocation-free: skeleton() runs several times per player per tick, so its matrices and frames come from
        // pools that are rewound at the start of every call)
        public const int MPN = 160;
        public static readonly double[][] MP = BuildMP();
        static double[][] BuildMP() { var r = new double[MPN][]; for (int i = 0; i < MPN; i++) r[i] = new double[9]; return r; }
        public static int mpi = 0;
        public static double[] M() => MP[mpi++ % MPN];
        public static double[] euler(double x, double y, double z, string order, double[] o)
        {
            double[] A = rot(0, x, M()),
                Bm = rot(1, y, M()),
                Cm = rot(2, z, M()),
                t = M();
            return order == "XYZ" ? mm(mm(A, Bm, t), Cm, o) : order == "XZY" ? mm(mm(A, Cm, t), Bm, o) : mm(mm(Bm, A, t), Cm, o);
        }
        public const int FPN = 48;
        public static readonly Fr[] FP = BuildFP();
        static Fr[] BuildFP() { var r = new Fr[FPN]; for (int i = 0; i < FPN; i++) r[i] = new Fr(); return r; }
        public static int fpi = 0;
        public static Fr child(Fr f, double ox, double oy, double oz, double[] R)
        {
            var o = FP[fpi++ % FPN];
            var fr = f.R;
            for (int r = 0; r < 3; r++) o.t[r] = fr[r * 3] * ox + fr[r * 3 + 1] * oy + fr[r * 3 + 2] * oz + f.t[r];
            if (R != null) mm(fr, R, o.R);
            else Array.Copy(fr, o.R, 9);
            return o;
        }
        public static double[] pt(Fr f, double ox, double oy, double oz) => child(f, ox, oy, oz, null).t;
        public static readonly Fr SKF = new Fr();
        static readonly Q EMPTYQ = new Q();
        static void put(float[] @out, int i, double[] v)
        {
            @out[i * 3] = (float)(v[0] * 10 + 470);
            @out[i * 3 + 1] = (float)(v[2] * 10 + 250);
            @out[i * 3 + 2] = (float)(v[1] * 10);
        }
        /// <summary>Joint positions in game coords (x, y, z up), written into out[0..59].</summary>
        public static float[] skeleton(Player p, float[] @out)
        {
            mpi = fpi = 0;
            var q = p.q ?? EMPTYQ;
            double s = p.ht / 6.4,
                k = p.bk;
            double w0 = (p.x - 470) * 0.1, w1 = p.z * 0.1, w2 = (p.y - 250) * 0.1; // W3(p.x, p.y, p.z)
            var RG = rot(1, Math.PI / 2 - fv(p), SKF.R);
            for (int i = 0; i < 9; i++) RG[i] *= s;
            var G = SKF;
            G.t[0] = w0; G.t[1] = w1 - Or0(q.cr) * 0.4; G.t[2] = w2;
            Fr bd = child(G, 0, RIG.hip, 0, euler(Or0(q.ln), Or0(q.ty), Or0(q.rz), "YXZ", M())),
                ch = child(bd, 0, RIG.chest, 0, euler(Or0(q.cx), Or0(q.cy), 0, "YXZ", M())),
                nk = child(ch, 0, RIG.neck, 0, rot(0, Or0(q.nk), M())),
                hd = child(nk, 0, RIG.head, 0, euler(Or0(q.hp), Or0(q.hy), 0, "YXZ", M()));
            put(@out, 0, pt(bd, 0, 0, 0));
            put(@out, 1, pt(ch, 0, 0.5, 0));
            put(@out, 2, nk.t);
            put(@out, 3, pt(hd, 0, 0.44, 0));
            for (int si = 0; si < 2; si++)
            {
                double sd = si != 0 ? 1 : -1,
                    tq = sd < 0 ? Or0(q.tL) : Or0(q.tR),
                    kq = sd < 0 ? Or0(q.kL) : Or0(q.kR),
                    fq = sd < 0 ? Or0(q.fL) : Or0(q.fR);
                Fr th = child(G, sd * RIG.hipX, RIG.hip, 0, euler(-tq, 0, hipAb(q, sd), "XYZ", M())),
                    kn = child(th, 0, -RIG.L1, 0, rot(0, kq, M())),
                    an = child(kn, 0, -RIG.L2, 0, rot(0, fq, M()));
                int j = 4 + si * 4;
                put(@out, j, th.t);
                put(@out, j + 1, kn.t);
                put(@out, j + 2, an.t);
                put(@out, j + 3, pt(an, 0, -0.06, 0.52));
            }
            for (int si = 0; si < 2; si++)
            {
                double sd = si != 0 ? 1 : -1,
                    a = sd < 0 ? Or0(q.aL) : Or0(q.aR),
                    e = sd < 0 ? Or0(q.eL) : Or0(q.eR),
                    wq = sd < 0 ? Or0(q.wL) : Or0(q.wR),
                    oq = sd < 0 ? Or0(q.oL) : Or0(q.oR),
                    zz = sd < 0 ? -(q.zL) : Or0(q.sz), // (TS: zL == null ? sz || 0 : zL; zL is always set on a written pose)
                    tw = sd < 0 ? Or0(q.hL) : -Or0(q.hR); // humeral twist about the upper-arm bone, applied first (XZY)
                Fr sh = child(ch, sd * RIG.shX * k, RIG.sh, 0, euler(-a, tw, zz, "XZY", M())),
                    el = child(sh, 0, -RIG.ua, 0, rot(0, -e, M())),
                    wr = child(el, 0, -RIG.fa, 0, mm(rot(1, oq, M()), rot(0, -wq, M()), M()));
                int j = 12 + si * 4;
                put(@out, j, sh.t);
                put(@out, j + 1, el.t);
                put(@out, j + 2, wr.t);
                put(@out, j + 3, pt(wr, 0, -0.32, 0.05));
            }
            return @out;
        }
    }
}
