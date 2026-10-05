// Port of src/core/pose.ts lines 113-1735: pose3(p), the Pro Play pose solver (joint angles per player into p.q).
// Layers: base gait / shot clips / dribble -> upper-body layers (IK, defense, celebrations, ...) -> secondary motion
// -> feet -> head look -> guide hand -> lefty mirror -> inertialized blend -> post-blend contact -> stepping /
// body avoidance / face. Allocation-free per tick (shared IK result, pooled hand positions, per-player state reused).
using System;
using System.Collections.Generic;
using static Hoops.Core.Util;
using static Hoops.Core.Data;
using static Hoops.Core.Sim;
using static Hoops.Core.Pose;

namespace Hoops.Core
{
    /// <summary>p.inz: per-joint inertialization state. x/v = offset and its velocity at the last restart, t/tf = time
    /// since and blend length, b = filtered target, pt/pv = last target and its velocity, last/lv = last output and
    /// velocity.</summary>
    public sealed class Inz
    {
        public readonly double[] b = new double[NQ], x = new double[NQ], v = new double[NQ], t = Fill(9), tf = Fill(0.1), pt = new double[NQ], pv = new double[NQ], last = new double[NQ], lv = new double[NQ];
        public double ok, has;
        static double[] Fill(double v)
        {
            var a = new double[NQ];
            for (int i = 0; i < NQ; i++) a[i] = v;
            return a;
        }
    }

    public partial class Player
    {
        /// <summary>p.q has been written by the pose solver (TS `q.wR != null`). Code that fills a whole p.q itself
        /// (replays, snapshots) should set it too.</summary>
        public bool posed;
        public Inz inz;
        // post-blend contact (dribble / catch / contest): per arm a, e, ab of the last solution + target x, y, z
        public double[] ctK, ctP;
        public double ctPo, ctPl, ctR, ctL, ctRv, ctLv, ctM;
        public double? ctB, ctRg, ctLg;
        // smarter running (heading-change rate) and the torso spring (secondary motion)
        public double? hd0, svx, svy;
        public double trn, sf, ss, sfv, ssv, hit0;
        public double olf; // one-legged fadeaway forced (Animation Studio)
    }

    public static partial class Pose
    {
        // mocap channel indices (MC_CH order) and the captured jump tracks, resolved once
        static readonly int MI_tL = Array.IndexOf(MC_CH, "tL"), MI_tR = Array.IndexOf(MC_CH, "tR"), MI_kL = Array.IndexOf(MC_CH, "kL"), MI_kR = Array.IndexOf(MC_CH, "kR"),
            MI_fL = Array.IndexOf(MC_CH, "fL"), MI_fR = Array.IndexOf(MC_CH, "fR"), MI_hz = Array.IndexOf(MC_CH, "hz"), MI_hs = Array.IndexOf(MC_CH, "hs"),
            MI_ln = Array.IndexOf(MC_CH, "ln"), MI_ty = Array.IndexOf(MC_CH, "ty"), MI_rz = Array.IndexOf(MC_CH, "rz"), MI_aL = Array.IndexOf(MC_CH, "aL"),
            MI_aR = Array.IndexOf(MC_CH, "aR"), MI_eL = Array.IndexOf(MC_CH, "eL"), MI_eR = Array.IndexOf(MC_CH, "eR"), MI_sz = Array.IndexOf(MC_CH, "sz"),
            MI_zL = Array.IndexOf(MC_CH, "zL");
        static readonly double[] MJ_tL = MC_JUMP["tL"], MJ_tR = MC_JUMP["tR"], MJ_kL = MC_JUMP["kL"], MJ_kR = MC_JUMP["kR"], MJ_ln = MC_JUMP["ln"], MJ_cx = MC_JUMP["cx"];

        /// <summary>a + (b - a) * k (the TS celebration helper m()).</summary>
        static double Lp(double a, double b, double k) => a + (b - a) * k;
        /// <summary>Mocap layer blend: cur + (MO[i] - cur) * w.</summary>
        static double Mcm(double cur, int i, double w) => cur + (MO[i] - cur) * w;
        /// <summary>Nearest opponent distance (TS: for (const q of P) if (q.tm !== p.tm) near = min(near, hypot)).</summary>
        static double NearOpp(Player p)
        {
            double near = 1e9;
            for (int i = 0; i < P.Count; i++)
            {
                var q = P[i];
                if (q.tm != p.tm) near = Math.Min(near, Hypot(q.x - p.x, q.y - p.y));
            }
            return near;
        }
        /// <summary>Help-side pistols: aim 40 px out along a direction between his facing f and the target.</summary>
        static void PtAim(Player p, double f, double tx, double ty, out double rx0, out double ry0)
        {
            double dx = tx - p.x,
                dy = ty - p.y,
                l = Hypot(dx, dy);
            if (!Util.T(l)) l = 1;
            double ux = (dx / l) * 0.55 + Math.Cos(f) * 0.45,
                uy = (dy / l) * 0.55 + Math.Sin(f) * 0.45,
                m = Hypot(ux, uy);
            if (!Util.T(m)) m = 1;
            rx0 = p.x + (ux / m) * 40;
            ry0 = p.y + (uy / m) * 40;
        }
        /// <summary>Pelvis height helper: vertical extension of a leg (thigh t, knee k).</summary>
        static double Ext(double t, double k) => RIG.L1 * Math.Cos(t) + RIG.L2 * Math.Cos(t - k);

        /// <summary>Write this tick's joint angles into p.q (in place, smoothed when Pro Play is on).</summary>
        public static void pose3(Player p)
        {
            if (!(p.mvT > 0 && p.mvk == 2)) p.ry = 0;
            bool PRO = cfg.PRO != 0,
                has = B.owner == p,
                air = p.z > 2;
            double sp = Hypot(p.vx, p.vy),
                spd = Math.Min(1, sp / 200),
                s = Math.Sin(p.ph),
                c = Math.Cos(p.ph);
            string md = p.mode;
            // stride-matched gait: thigh swing sized so the planted foot travels exactly one step (see sim stepLen)
            double legF = (3.18 * p.ht) / 6.4,
                A = Math.Asin(Math.Min(0.9, (stepLen(sp) / 10 / (2 * legF)) * 0.92)) * Math.Min(1, sp / 30),
                ksw = 0.45 + 0.95 * spd; // swing-knee flex: heel kick grows with speed
            double hL = 0, // humeral twist (+ = internal rotation), applied about the upper-arm bone
                hR = 0;
            double tL = s * A,
                tR = -s * A,
                kL = 0.07 + Math.Pow(Math.Max(0, c), 1.5) * ksw * Math.Min(1, sp / 30),
                kR = 0.07 + Math.Pow(Math.Max(0, -c), 1.5) * ksw * Math.Min(1, sp / 30),
                aL = -s * (0.2 + 0.65 * spd),
                aR = s * (0.2 + 0.65 * spd),
                eL = 0.45 + spd * 1.0,
                eR = 0.45 + spd * 1.0,
                sz = 0.1,
                cr = 0.07 * spd * (1 - Math.Abs(s)), // the body is lowest at mid-stance
                ln = 0.07 * spd - Or0(p.brk) * 0.3,
                rz = 0,
                ty = s * 0.18 * spd, // pelvis turns with the forward leg...
                wR = 0,
                wL = 0;
            double? zL = null;
            // new joints (animation engine v2)
            double cx = 0.07 * spd, // chest pitch on top of the pelvis lean
                cy = -s * 0.3 * spd, // ...and the chest counter-rotates (real running)
                gL = 0.25, // finger curl 0 open .. 1 fist
                gR = 0.25,
                hs = 0, // asymmetric hip abduction (defensive shuffle)
                toe = 0, // extra plantar flex (toe-off / pointed in the air), both feet
                oL = 0, // forearm twist (+ = palm turns inward/up for the right arm)
                oR = 0;
            int st = ST.idle;
            if (sp > 30) st = ST.run;
            if (air && md != "s" && md != "c")
            {
                tL = 0.6;
                tR = 0.1;
                kL = 1;
                kR = 0.7;
                toe = 0.45;
                st = ST.air;
                if (PRO && sp < 160)
                {
                    // vertical jump (rebound, block, contest): captured legs and trunk (CMU 16_03), timed by where he is in
                    // his flight - takeoff extension, the tuck at the top, legs reaching for the floor before touchdown
                    double vz0 = Math.Sqrt(Math.Max(1, Or0(p.vz) * Or0(p.vz) + 2 * g * p.z)),
                        u = clamp((1 - Or0(p.vz) / vz0) / 2, 0, 1),
                        w = Math.Min(1, (160 - sp) / 80);
                    tL += (smp(MJ_tL, u).Value - tL) * w;
                    tR += (smp(MJ_tR, u).Value - tR) * w;
                    kL += (smp(MJ_kL, u).Value - kL) * w;
                    kR += (smp(MJ_kR, u).Value - kR) * w;
                    ln += (smp(MJ_ln, u).Value - ln) * w;
                    cx += (smp(MJ_cx, u).Value - cx) * w;
                    toe = 0.45 * (1 - w) + 0.6 * w * Math.Min(1, Math.Min(u * 6, (1 - u) * 3)); // pointed off the floor, flexing to land
                }
            }
            if (md == "c" || md == "s")
            {
                st = ST.shot;
                gR = 0.55;
                gL = 0.45;
                cy = 0;
                if (p.z > 2) toe = 0.5;
            }
            if (md == "c")
            {
                wR = -0.5;
                wL = -0.2;
                zL = -0.08;
                aL = aR = 1;
                eL = eR = 1.7;
                cr = 0.5;
                if (PRO && p.sg != null)
                {
                    // personal load: ball height at the gather and elbow flare
                    aR -= Or0(p.sg.dp) * 0.5;
                    aL -= Or0(p.sg.dp) * 0.4;
                    sz += Or0(p.sg.f);
                    cr += Or0(p.sg.k) * 0.6;
                }
                if (PRO && p.sg != null && Util.T(p.sg.cl))
                {
                    aR = 0.6;
                    eR = 1.3;
                    aL = 0.7;
                    eL = 1.4;
                    cr = 0.3;
                }
                tL = 0.3;
                tR = -0.2;
                kL = kR = 0.8;
                sz = 0.05;
                ty = 0;
                if (PRO && Hypot(hoop(p.tm) - p.x, HY - p.y) < 95)
                {
                    // gather step into a layup / dunk: long last stride, ball ripped to the chest with both hands, lead knee rising
                    double g2 = Math.Min(1, p.t / 0.15);
                    tL = 0.25 + 0.55 * g2;
                    kL = 0.5 + 0.5 * g2;
                    tR = -0.45;
                    kR = 0.55;
                    ln = 0.22;
                    cr = 0.25;
                    aL = aR = 1.15;
                    eL = eR = 1.75;
                    zL = -0.05;
                    sz = -0.05;
                    wR = wL = -0.3;
                }
                else if (PRO)
                {
                    // catch-and-dip: the ball drops toward the hip and comes back up into the shot pocket as the knees load
                    double dk = Math.Sin(Math.Min(1, p.t / 0.2) * Math.PI);
                    aR -= 0.45 * dk;
                    aL -= 0.4 * dk;
                    eR += 0.2 * dk;
                    cr += 0.15 * dk;
                    kL += 0.2 * dk;
                    kR += 0.2 * dk;
                }
            }
            else if (md == "s" && PRO)
            {
                // Clip time is scaled so each clip's wrist-snap keyframe lands exactly on the sim's release (launch) moment:
                // the ball leaves the fingertips as the wrist flicks, not after the follow-through.
                string kind0 = CKof(p.sv);
                double rT = IsLaySv(I(p.sv)) || kind0 == "hook" ? 0.28 : p.st == 1 ? 0.3 : 0.4,
                    k = Math.Min(1, (p.t / rT) * (kind0 != null && RELK.TryGetValue(kind0, out var rk) ? rk : 0.7));
                var o = clip(p, k);
                aR = o.aR;
                eR = o.eR;
                aL = o.aL;
                eL = o.eL;
                tL = o.tL;
                tR = o.tR;
                kL = o.kL;
                kR = o.kR;
                ln = o.ln;
                sz = o.sz;
                cr = p.z < 2 ? o.cr : 0;
                rz = o.rz;
                ty = o.ty;
                wR = o.wR;
                wL = o.wL;
                zL = o.zL;
                oR = o.oR;
                oL = o.oL;
                string kind = kind0;
                if (kind != "hang" && p.z > 0)
                {
                    // momentum shapes every jumper: drifting sideways tilts the body, fading falls back, attacking leans in
                    double cf2 = Math.Cos(p.f),
                        sf2 = Math.Sin(p.f),
                        fwv = p.vx * cf2 + p.vy * sf2,
                        sdv = -p.vx * sf2 + p.vy * cf2;
                    ln += clamp(fwv / 650, -0.3, 0.25);
                    rz += clamp(sdv / 700, -0.3, 0.3);
                }
                if (kind == "fade" && p.z > 2 && (Util.T(p.olf) || (p.ht >= 6.75 && p.c >= 80)))
                {
                    // signature one-legged fadeaway (tall mid-range scorers): the off knee drives up and kicks out for space
                    double w = clamp(p.z / 12, 0, 1);
                    tL += 0.75 * w;
                    kL += 0.95 * w;
                    rz -= 0.08 * w;
                }
                if (kind == "hang")
                {
                    // swinging under the rim, gripping the iron
                    double sw = Math.Sin(Sim.T * 5.5 + p.k);
                    tL += sw * 0.18;
                    tR += sw * 0.18;
                    ln += sw * 0.06;
                    gL = gR = 0.85;
                }
                else if ((kind == "lay" || kind == "roll" || kind == "contact") && k > 0.4 && k < 0.92)
                {
                    // layup hand extends toward the rim around the release
                    double w = Math.Sin(((k - 0.4) / 0.52) * Math.PI) * 0.75;
                    var r1 = armIK(p, cr, hoop(p.tm), HY, 104, 1, 0.5);
                    aR += (r1.a - aR) * w;
                    eR += (r1.e - eR) * w;
                    sz += (r1.ab - sz) * w;
                }
            }
            else if (md == "s")
            {
                double k = Math.Min(1, p.t / 0.4),
                    v = p.sv,
                    e = Math.Min(1, k / 0.55),
                    se = e * e * (3 - 2 * e),
                    rel = k < 0.6 ? 0 : Math.Min(1, (k - 0.6) / 0.15),
                    fo = k < 0.7 ? 0 : (k - 0.7) / 0.3;
                aR = k < 0.55 ? 1 + se * 1.25 : k < 0.7 ? 2.25 + ((k - 0.55) / 0.15) * 0.7 : 2.95 - fo * 0.35;
                eR = k < 0.55 ? 1.7 - se * 0.45 : k < 0.7 ? 1.25 - ((k - 0.55) / 0.15) * 1.1 : 0.15 + fo * 0.35;
                aL = k < 0.55 ? 1 + se * 0.95 : Math.Max(1.1, 1.95 - rel * 0.8);
                eL = k < 0.55 ? 1.5 : 1.3;
                sz = 0.03 + rel * 0.1;
                ln = -0.05;
                tL = 0.5 - rel * 0.3;
                tR = -0.1;
                kL = 0.9 - rel * 0.7;
                kR = 0.6 - rel * 0.5;
                ty = 0;
                cr = p.z < 2 && k > 0.7 ? 0.5 * Math.Min(1, (k - 0.7) / 0.15) : 0;
                if (v == 1)
                {
                    aR = k < 0.4 ? 1 + (k / 0.4) * 1.9 : 2.9 - fo * 0.3;
                    eR = k < 0.4 ? 1.7 - (k / 0.4) * 1.5 : 0.2;
                    kL = 0.4;
                    tL = 0.25;
                }
                if (v == 2)
                {
                    ln = -0.5 * Math.Sin(Math.Min(1, k * 1.1) * 3.14);
                    tL = 1.1;
                    kL = 0.2;
                    tR = -0.4;
                    kR = 0.5;
                }
                if (v == 3)
                {
                    ln = -0.35;
                    tL = 0.2;
                    tR = -0.5;
                    kR = 0.9;
                    kL = 0.6;
                }
                if (v == 4)
                {
                    aR = 2.7;
                    eR = 0.3;
                    aL = 0.5;
                    eL = 1;
                    ln = 0.15;
                    rz = 0.25;
                    tL = 0.3;
                }
                if (v == 5)
                {
                    aR = 3;
                    eR = 0.2;
                    aL = 0.5;
                    eL = 1.3;
                    ln = 0.3;
                    tL = 1.5;
                    kL = 1.5;
                    tR = -0.4;
                    kR = 0.3;
                }
                if (v == 6)
                {
                    aR = aL = k < 0.7 ? 3 : 1.7;
                    eR = eL = 0.2;
                    ln = 0.1;
                    tL = 0.7;
                    tR = 0.2;
                    kL = kR = 0.8;
                    sz = 0.2;
                }
            }
            else if (md == "b")
            {
                ln = -0.38;
                tL = Math.Sin(p.t * 28) * 0.7;
                tR = -tL;
                kL = Math.Max(0, -tL) + 0.4;
                kR = Math.Max(0, tL) + 0.4;
                aR = 0.7 + Math.Sin(p.t * 22) * 0.5;
                eR = 1.2;
                aL = 0.5;
                eL = 1;
                cr = 0.3;
                ty = Math.Sin(p.t * 22) * 0.3;
            }
            else if (has)
            {
                st = ST.drib;
                gR = 0.1;
                gL = 0.3;
                cy *= 0.3; // keep the dribbling shoulder square so the hand IK lands on the ball
                {
                    double u = clamp((B.z - 6) / 30, 0, 1);
                    aR = PRO ? 0.5 + u * 0.45 : 0.55 + u * 0.8;
                    eR = PRO ? 0.25 + u * 1.1 : 0.9;
                    if (PRO) wR = 0.8 - u * 1.2;
                }
                aL = 0.4 + spd * 0.3;
                eL = 1;
                cr = 0.2;
                ln = 0.08 + spd * 0.2;
                ty = 0;
            }
            else if (air)
            {
                aL = aR = 3;
                eL = eR = 0.1;
                sz = 0.12;
                gL = gR = 0.1;
            }
            else if (pos != p.tm)
            {
                st = ST.def;
                gL = gR = 0.05; // active hands
                cy = 0;
                aL = aR = 0.6;
                eL = eR = 0.9;
                sz = 1.1 + Math.Sin(Sim.T * 8 + p.k) * 0.1;
                cr = 0.4;
                tL = s * 0.5 * spd + 0.35;
                tR = -s * 0.5 * spd + 0.35;
                kL = kR = 0.8;
                ln = 0.18;
            }
            double hz = 0;
            {
                double sv = Hypot(p.vx, p.vy);
                bool def = pos != p.tm && B.owner != null;
                if (md == "i" && !air && sv > 25)
                {
                    double cf = Math.Cos(p.f),
                        sf = Math.Sin(p.f),
                        fw = (p.vx * cf + p.vy * sf) / sv,
                        sd2 = (-p.vx * sf + p.vy * cf) / sv;
                    if (!def && !(p.mvT > 0))
                    {
                        tL *= fw;
                        tR *= fw;
                        kL = Math.Max(0.05, kL * Math.Abs(fw));
                        kR = Math.Max(0.05, kR * Math.Abs(fw));
                        if (fw < -0.3) { ln -= 0.12; cx -= 0.06; } // backpedal: sit back, short steps
                    }
                    hz = Math.Abs(sd2) * (0.16 + 0.14 * Math.Abs(s)) * spd + (def ? 0.12 : 0);
                    // lateral shuffle: the lead leg opens, the trail leg closes (never crossing) - defenders and side steps
                    hs = s * Math.Abs(sd2) * (def ? 0.24 : 0.14) * spd * Sign(Util.T(sd2) ? sd2 : 1);
                    cr += Math.Abs(sd2) * 0.15 * spd;
                    if (def) { tL *= 0.35; tR *= 0.35; } // slides stay low and wide instead of running
                    if (PRO && !(p.mvT > 0) && !Util.T(p.postA) && !(p.setT > 0))
                    {
                        // Motion-captured locomotion (legs, pelvis, and the arm swing when the hands are free), chosen by
                        // what the player is doing and blended by speed. The thigh swing is scaled so a step covers the
                        // sim's step length.
                        string a = "walk",
                            b = null;
                        double u = 0;
                        bool mir = false,
                            dribbling = has && md == "i";
                        double near = 1e9;
                        if (dribbling) near = NearOpp(p);
                        if ((def || dribbling) && Math.Abs(sd2) > 0.6 && Math.Abs(fw) < 0.6)
                        {
                            a = "side";
                            mir = Sign(sd2) > 0; // capture slides toward our R side; sd2 > 0 moves toward our L
                        }
                        else if (fw < -0.4) a = "back";
                        else if (dribbling)
                        {
                            a = near < 40 && sv < 130 ? "low" : "drib";
                            if (sv > 170) { b = "run"; u = Math.Min(1, (sv - 170) / 70); }
                        }
                        else if (sv > 60) { b = "run"; u = Math.Min(1, (sv - 60) / 90); }
                        var c0 = MCC[a];
                        double strideC = (c0.stride + (b != null ? (MCC[b].stride - c0.stride) * u : 0)) * (p.ht / 6.4),
                            amp = clamp(stepLen(sv) / (strideC * 1.5), 0.75, 1.45),
                            w = Math.Min(1, (sv - 25) / 35);
                        mcBlend(a, b, u, p.ph, amp, mir);
                        tL = Mcm(tL, MI_tL, w);
                        tR = Mcm(tR, MI_tR, w);
                        kL = Mcm(kL, MI_kL, w);
                        kR = Mcm(kR, MI_kR, w);
                        hz = Mcm(hz, MI_hz, w);
                        hs = Mcm(hs, MI_hs, w);
                        ln = Mcm(ln, MI_ln, w);
                        ty = Mcm(ty, MI_ty, w);
                        rz = Mcm(rz, MI_rz, w);
                        MCF = w;
                        MFL = MO[MI_fL];
                        MFR = MO[MI_fR];
                        if (!has && !def && st == ST.run)
                        {
                            aL = Mcm(aL, MI_aL, w);
                            aR = Mcm(aR, MI_aR, w);
                            eL = Mcm(eL, MI_eL, w);
                            eR = Mcm(eR, MI_eR, w);
                            sz = Mcm(sz, MI_sz, w);
                            zL = Mcm(zL ?? sz, MI_zL, w);
                        }
                        // pelvis height from the legs: the stance leg (the longer one) stands on the floor
                        double crG = (RIG.L1 + RIG.L2 - Math.Max(Ext(tL, kL), Ext(tR, kR))) / 0.4;
                        cr += (crG - cr) * w;
                    }
                }
                else if (def && !air) hz = 0.14;
                if (PRO && has && md == "i" && !Util.T(p.postA))
                {
                    // Dribble hand IK with EITHER hand: whichever side of the body the ball is on (works on guests too: it
                    // only needs the ball position). The free arm relaxes, or becomes an arm-bar toward a close defender.
                    var k2 = armIK(p, cr, B.x, B.y, Math.Max(B.z, (B.dtop ?? p.z + p.ht * 5) - 8), 0, 0.6); // hand waits at the hip
                    bool right = k2.right;
                    double a2 = k2.a,
                        e2 = k2.e,
                        ab = k2.ab;
                    // closest defender: arm-bar with the free arm
                    double dd = NearOpp(p);
                    bool bar = dd < 45 && !(p.mvT > 0);
                    double fa = bar ? 0.62 : 0.4 + spd * 0.3, // arm-bar: upper arm out front, forearm across the chest at belly height
                        fe = bar ? 1.35 : 1,
                        fz = bar ? 0.22 : 0.12;
                    if (right)
                    {
                        aR = a2;
                        eR = e2;
                        sz = ab;
                        aL = fa;
                        eL = fe;
                        zL = fz;
                        hL = bar ? 0.75 : 0; // (the arm-bar's forearm turns in across the body)
                        gR = 0.1;
                        gL = bar ? 0.15 : 0.3;
                    }
                    else
                    {
                        aL = a2;
                        eL = e2;
                        zL = ab;
                        aR = fa;
                        eR = fe;
                        sz = fz;
                        hR = bar ? 0.75 : 0;
                        gL = 0.1;
                        gR = bar ? 0.15 : 0.3;
                        wL = wR;
                        wR = 0;
                    }
                }
                if (def && !air && (B.owner.mode == "c" || B.owner.mode == "s") && Hypot(B.owner.x - p.x, B.owner.y - p.y) < 70)
                {
                    aR = 2.9;
                    eR = 0.15;
                    aL = 1.3;
                    eL = 0.6;
                }
                if (p.pT > 0)
                {
                    // pass follow-through by type (B.ptype: 0 chest, 1 bounce, 2 lob): arms extend from the chest, thumbs turn down
                    double u = clamp(1 - p.pT / 0.25, 0, 1);
                    int ty2 = I(B.ptype);
                    if (ty2 == 2)
                    {
                        aL = aR = 2.0 + 0.7 * u;
                        eL = eR = 1.3 - 1.0 * u;
                        wR = wL = 0.9 * u;
                    }
                    else if (ty2 == 1)
                    {
                        aL = aR = 1.05 - 0.2 * u;
                        eL = eR = 1.5 - 1.35 * u;
                        ln += 0.18;
                        cr = Math.Max(cr, 0.15);
                    }
                    else
                    {
                        aL = aR = 1.25 + 0.3 * u;
                        eL = eR = 1.6 - 1.45 * u;
                        ln += 0.1;
                    }
                    oR = -1.1 * u;
                    oL = 1.1 * u;
                    zL = 0.12;
                    sz = 0.12;
                    gL = gR = 0.1;
                }
                if (B.mode == "pass" && B.to == p && !air)
                {
                    aL = aR = 1.35;
                    eL = eR = 0.5;
                    zL = 0.15;
                    gL = gR = 0.2; // target hands
                    st = ST.cat;
                }
            }
            if (p.mvT > 0)
            {
                st = ST.move;
                double e = Or0(p.mvE),
                    sd = Util.T(p.mvS) ? p.mvS : 1;
                if (p.mvk == 2)
                {
                    // spin: the whole body turns (root yaw p.ry, drawn by every renderer and solved by the stepping: the
                    // planted foot is the pivot, the free leg swings round); eased - it winds up, whips through, settles
                    double u = clamp(e / 0.45, 0, 1);
                    p.ry = u * u * (3 - 2 * u) * 6.283 * sd;
                    ln = 0.25;
                    cr = 0.2;
                }
                else if (p.mvk == 1)
                {
                    cr = e < 0.22 ? 0.55 : 0.1;
                    ln = e < 0.22 ? -0.12 : 0.35;
                }
                else if (p.mvk == 3)
                {
                    ty += Math.Sin(e * 10) * 0.9 * sd;
                    ln = 0.2;
                    cr = Math.Max(cr, 0.25); // sit into the between-the-legs; the hand IK carries the ball
                }
                else
                {
                    ln = 0.3;
                    cr = 0.2;
                }
            }
            // ---- smarter running: plant-and-cut lean, drive steps out of a standstill, braking stops ----
            {
                double hd = Math.Atan2(p.vy, p.vx);
                if (sp > 60 && p.hd0 != null)
                {
                    double dh = Math.Atan2(Math.Sin(hd - p.hd0.Value), Math.Cos(hd - p.hd0.Value));
                    p.trn = Or0(p.trn) * 0.75 + (dh / DT) * 0.25;
                }
                else p.trn = Or0(p.trn) * 0.8;
                p.hd0 = hd;
                if (md == "i" && !air && !Util.T(p.postA) && !(p.setT > 0) && (st == ST.run || st == ST.drib))
                {
                    double tr = clamp(p.trn, -9, 9),
                        gg = Math.Abs(tr) * sp;
                    rz += clamp((tr * sp) / 1400, -0.38, 0.38); // bank into the cut
                    cr += Math.Min(0.22, gg / 5000);
                    hs += Sign(tr) * Math.Min(0.18, gg / 6000); // the outside foot plants wide and pushes
                    double acc = Or0(p.acc);
                    if (acc > 900 && sp < 150)
                    {
                        // first steps: low, long, arms pumping
                        double k = Math.Min(1, (acc - 900) / 1500);
                        ln += 0.14 * k;
                        cx += 0.06 * k;
                        aL *= 1 + 0.6 * k;
                        aR *= 1 + 0.6 * k;
                    }
                    if (Or0(p.brk) > 0.3 && sp > 40)
                    {
                        // stride stop: lead leg out in front, weight back, arms forward for balance
                        bool lead = s >= 0;
                        tL = lead ? 0.55 : -0.12;
                        kL = lead ? 0.15 : 0.75;
                        tR = lead ? -0.12 : 0.55;
                        kR = lead ? 0.75 : 0.15;
                        cr += 0.18;
                        cx -= 0.08;
                        if (st == ST.run) { aL = aR = 0.55; eL = eR = 0.7; }
                    }
                }
            }
            // ---- held ball (triple threat, pump fake, jab, FT routine) - body first, the hands go on the ball below ----
            double hold = has && md == "i" ? heldBall(p) : 0;
            if (PRO && Util.T(hold))
            {
                st = ST.cat;
                if (hold == 1)
                {
                    // triple threat: low, ball at the hip, eyes up
                    cr = Math.Max(cr, 0.32);
                    kL = Math.Max(kL, 0.6);
                    kR = Math.Max(kR, 0.6);
                    tL = Math.Max(tL, 0.35);
                    tR = Math.Max(tR, 0.35);
                    ln = Math.Max(ln, 0.22);
                    hz = Math.Max(hz, 0.12);
                }
                else if (hold == 2 && p.act == 1)
                {
                    // pump fake: ball snaps up toward the forehead, legs straighten, then back down
                    double u = Math.Sin(clamp(1 - p.actT / 0.42, 0, 1) * Math.PI);
                    cr = 0.3 * (1 - u);
                    kL = kR = 0.6 - 0.45 * u;
                    tL = tR = 0.35 - 0.25 * u;
                    ln = 0.2 - 0.25 * u;
                    HEADX -= 0.3 * u;
                }
                else if (hold == 2 && p.act == 2)
                {
                    // jab step: the lead foot stabs out toward the jab, weight shifts onto it, ball ripped to the far hip
                    double u = Math.Sin(clamp(1 - p.actT / 0.38, 0, 1) * Math.PI);
                    tL = 0.35 + 0.55 * u;
                    kL = 0.6 + 0.3 * u;
                    tR = 0.2;
                    kR = 0.7;
                    ln = 0.25 + 0.2 * u;
                    cr = 0.35;
                    ty += 0.25 * u;
                }
                else if (hold == 4)
                {
                    // chinned rebound: sits down into the landing, leans over the ball, eyes up the floor
                    cr = Math.Max(cr, 0.3);
                    ln = Math.Max(ln, 0.28);
                    hz = Math.Max(hz, 0.16);
                    cx += 0.1;
                }
                else if (hold == 3)
                {
                    // free-throw routine: square to the rim, ball spun in the fingertips at the chest
                    cr = 0.1;
                    kL = kR = 0.25;
                    tL = tR = 0.1;
                    ln = 0.05;
                }
            }
            // ---- both hands on the ball: inbounds overhead, and every held-ball state ----
            if (PRO && has && md == "i" && (inb > 0 || Util.T(hold)))
            {
                for (int si = 0; si < 2; si++)
                {
                    double sd = si == 0 ? 1 : -1;
                    // each hand on its own side of the ball (the right side is (sin f, -cos f))
                    // (aim for where the ball is going - B.tg*, set by the host's bstep - not the ball, which rides in these hands)
                    bool own = B.tgo == p;
                    double bx = own ? B.tgx : B.x,
                        by = own ? B.tgy : B.y,
                        bz = own ? B.tgz : B.z;
                    var k5 = armIK(p, cr, bx + Math.Sin(fv(p)) * 3 * sd, by - Math.Cos(fv(p)) * 3 * sd, bz, sd, 0.9);
                    if (sd > 0) { aR = k5.a; eR = k5.e; sz = k5.ab; }
                    else { aL = k5.a; eL = k5.e; zL = k5.ab; }
                }
                gL = gR = 0.4;
            }
            // ---- jump ball: the centers reach for the toss ----
            if (PRO && JB != null && air && (JB.c[0] == p || JB.c[1] == p))
            {
                var kj = armIK(p, cr, B.x, B.y, B.z, 1, 0.6);
                aR = kj.a;
                eR = kj.e;
                sz = kj.ab;
                aL = 1.2;
                eL = 0.8;
            }
            // ---- one-shot actions (sim p.act / p.actT; synced online) ----
            if (PRO && p.actT > 0)
            {
                double a = p.act,
                    T0 = a == 3 ? 1.2 : a == 4 ? 0.75 : a == 5 ? 0.5 : a == 6 ? 0.45 : 0.4,
                    e = T0 - p.actT, // elapsed
                    outw = Math.Min(1, p.actT / 0.3); // blend out at the end
                if (a == 3)
                {
                    // fall: knocked back onto the floor (charge taken, crossed up), sits, then gets up
                    st = ST.post;
                    // seated on the floor, leaning back on both hands
                    double fall = Math.Min(1, e / 0.3) * outw;
                    ln = ln + (-0.55 - ln) * fall;
                    cr = cr + (4.6 - cr) * fall;
                    tL += (1.45 - tL) * fall;
                    tR += (1.35 - tR) * fall;
                    kL += (0.25 - kL) * fall;
                    kR += (0.6 - kR) * fall;
                    aL += (-0.75 - aL) * fall;
                    aR += (-0.75 - aR) * fall;
                    zL = 0.35 * fall;
                    sz = 0.35 * fall;
                    eL = eR = 0.15;
                    gL = gR = 0;
                }
                else if (a == 4)
                {
                    // dive: horizontal, both arms stretched for the ball
                    st = ST.air;
                    double d = Math.Min(1, e / 0.15) * outw;
                    ln += (1.35 - ln) * d;
                    cr += (5 - cr) * d;
                    aL += (2.8 - aL) * d;
                    aR += (2.8 - aR) * d;
                    eL = eR = 0.15;
                    tL += (-0.35 - tL) * d;
                    tR += (-0.2 - tR) * d;
                    kL = kR = 0.3;
                    gL = gR = 0.1;
                }
                else if (a == 5)
                {
                    // fumble: the ball pops off his hands
                    aL = aR = 1.7;
                    eL = eR = 0.25;
                    wL = wR = 0.6;
                    ln -= 0.15;
                    gL = gR = 0;
                }
                else if (a == 6)
                {
                    // blocked: the shooting arm is knocked back over his head
                    aR = 3.3;
                    eR = 0.25;
                    rz += 0.25 * outw;
                    ln -= 0.2 * outw;
                }
                else if (a == 8)
                {
                    // shoulder fake in the post: shoulders dip and turn one way
                    double u = Math.Sin(clamp(e / 0.4, 0, 1) * Math.PI);
                    ty += 0.55 * u;
                    rz += 0.2 * u;
                    cr += 0.1 * u;
                }
            }
            // ---- shot block attempt: the leaper's hand goes for the ball ----
            if (PRO && air && !has && md != "c" && md != "s" && B.owner != null && B.owner.tm != p.tm && (B.owner.mode == "c" || B.owner.mode == "s") && Hypot(B.x - p.x, B.y - p.y) < 40)
            {
                // (aimed a little in front of him and never past straight up: a ball right overhead used to flip the arm
                // over the top and back as it wobbled in front of / behind the shoulder)
                var k6 = armIK(p, cr, B.x + Math.Cos(fv(p)) * 8, B.y + Math.Sin(fv(p)) * 8, B.z + 4, 1, 0.8);
                aR = Math.Min(armN(k6.a), 3.25);
                eR = k6.e;
                sz = k6.ab;
                aL = 2.6;
                eL = 0.3;
                gR = 0.05;
            }
            // ---- full-body reaching ----
            if (PRO && !Util.T(p.postA) && !(p.setT > 0) && md != "c" && md != "s")
            {
                double bd = Hypot(B.x - p.x, B.y - p.y);
                if (st == ST.def && B.owner != null && B.owner.mode == "i" && bd < 70 && !air)
                {
                    // active hands: the ball-side hand mirrors the dribble (never touches it - steals are off)
                    double w = clamp((70 - bd) / 30, 0, 1),
                        tx3 = p.x + (B.x - p.x) * 0.7,
                        ty3 = p.y + (B.y - p.y) * 0.7;
                    var k3 = armIK(p, cr, tx3, ty3, Math.Max(18, B.z + 6), 0, 0.9);
                    if (k3.right) { aR += (k3.a - aR) * w; eR += (k3.e - eR) * w; sz += (k3.ab - sz) * w; }
                    else { aL += (k3.a - aL) * w; eL += (k3.e - eL) * w; zL = (zL ?? sz) + (k3.ab - (zL ?? sz)) * w; }
                }
                else if (!has && B.owner == null && (B.mode == "air" || B.mode == "pass") && bd < 45 && B.z > p.z + 30 && B.z < p.z + 150 && (air || B.to == p) && !(Util.T(B.sh) && B.age < 0.5))
                {
                    // (not a shot that just left the hand: it flies by too fast to track - the swat was the block layer's job)
                    // rebounds, tips and catches: both hands go to where the ball actually is (not behind him: a ball that
                    // went past his back is let go, the arms don't swing backwards after it)
                    double fw = (Math.Cos(fv(p)) * (B.x - p.x) + Math.Sin(fv(p)) * (B.y - p.y)) / (Util.T(bd) ? bd : 1),
                        w = clamp((45 - bd) / 20, 0, 1) * clamp((fw + 0.35) / 0.5, 0, 1);
                    var r1 = armIK(p, cr, B.x, B.y, B.z, 1, 1.0);
                    aR += (r1.a - aR) * w; eR += (r1.e - eR) * w; sz += (r1.ab - sz) * w;
                    var r2 = armIK(p, cr, B.x, B.y, B.z, -1, 1.0);
                    aL += (r2.a - aL) * w; eL += (r2.e - eL) * w; zL = (zL ?? sz) + (r2.ab - (zL ?? sz)) * w;
                    gL = gR = 0.2;
                }
            }
            // ---- hedge: the screener's defender jumps out wide, arms spread, to stop the handler turning the corner ----
            if (PRO && Or0(p.hdgT) > 0 && !has && !air && md == "i")
            {
                double w = Math.Min(1, p.hdgT * 6);
                aL += (0.85 - aL) * w;
                aR += (0.85 - aR) * w;
                sz += (1.15 - sz) * w;
                zL = (zL ?? sz) + (1.15 - (zL ?? sz)) * w;
                eL += (0.35 - eL) * w;
                eR += (0.35 - eR) * w;
                cr = Math.Max(cr, 0.28 * w);
                gL = gR = 0.05;
            }
            // ---- "Switch!": the defenders point at the man they just picked up ----
            if (PRO && Or0(p.swT) > 0 && !has && !air && md == "i" && p.man != null && PAt(p.man.Value) != null)
            {
                var m = PAt(p.man.Value);
                double w = Math.Min(1, p.swT * 4) * Math.Min(1, (0.7 - p.swT) * 8 + 0.2),
                    f = fv(p),
                    sd = Math.Sin(f) * (m.x - p.x) - Math.Cos(f) * (m.y - p.y) > 0 ? 1 : -1;
                var k = armIK(p, cr, m.x, m.y, p.z + p.ht * 7.4, sd, 0.9);
                double a = Math.Min(k.a, 1.7);
                if (sd > 0) { aR += (a - aR) * w; eR += (0.1 - eR) * w; sz += (k.ab - sz) * w; gR = 0.6; }
                else { aL += (a - aL) * w; eL += (0.1 - eL) * w; zL = (zL ?? sz) + (k.ab - (zL ?? sz)) * w; gL = 0.6; }
            }
            // ---- timeout huddle: hands in the middle ("1-2-3 ...!") ----
            if (PRO && Or0(p.hudT) > 0 && !has && !air /* && p.hcx != null: hcx is set together with hudT */)
            {
                double zc = p.z + p.ht * 7.6;
                for (int si = 0; si < 2; si++)
                {
                    double sd = si == 0 ? 1 : -1;
                    var k = armIK(p, cr, p.hcx + Math.Sin(fv(p)) * 2 * sd, p.hcy - Math.Cos(fv(p)) * 2 * sd, zc, sd, 0.6);
                    if (sd > 0) { aR = k.a; eR = k.e; sz = k.ab; }
                    else { aL = k.a; eL = k.e; zL = k.ab; }
                }
                gL = gR = 0.1;
                ln += 0.12;
            }
            // ---- help defender meeting the drive: brace for the charge (forearms across the chest), or go straight up
            //      with both arms (verticality) once the driver leaves his feet ----
            if (PRO && Or0(p.helpT) > 0 && !has && md == "i" && B.owner != null && B.owner.tm != p.tm)
            {
                var dv = B.owner;
                double d = Hypot(dv.x - p.x, dv.y - p.y),
                    w = clamp((60 - d) / 25, 0, 1) * Math.Min(1, p.helpT * 5);
                if (w > 0)
                {
                    if (dv.mode == "c" || dv.mode == "s")
                    {
                        aL += (2.95 - aL) * w;
                        aR += (2.95 - aR) * w;
                        eL += (0.15 - eL) * w;
                        eR += (0.15 - eR) * w;
                        sz += (0.12 - sz) * w;
                        zL = (zL ?? sz) + (0.12 - (zL ?? sz)) * w;
                        gL = gR = 0.05;
                    }
                    else if (!air)
                    {
                        aL += (0.55 - aL) * w;
                        aR += (0.55 - aR) * w;
                        eL += (2.0 - eL) * w;
                        eR += (2.0 - eR) * w;
                        hL += (0.95 - hL) * w;
                        hR += (0.95 - hR) * w;
                        sz += (0.25 - sz) * w;
                        zL = (zL ?? sz) + (0.25 - (zL ?? sz)) * w;
                        ln += 0.08 * w;
                        cr = Math.Max(cr, 0.25 * w);
                        gL = gR = 0.7;
                    }
                }
            }
            // ---- chop steps: a handler sizing up a close defender keeps his feet alive ----
            if (PRO && has && md == "i" && !Util.T(hold) && sp < 45 && !(p.mvT > 0) && !Util.T(p.postA) && !air)
            {
                double near = NearOpp(p);
                if (near < 50)
                {
                    double c2 = Math.Sin(Sim.T * 22 + p.k),
                        w = Math.Min(1, (50 - near) / 20) * (1 - sp / 45);
                    tL += (0.25 + c2 * 0.1 - tL) * w;
                    tR += (0.25 - c2 * 0.1 - tR) * w;
                    kL += (0.55 + Math.Max(0, c2) * 0.25 - kL) * w;
                    kR += (0.55 + Math.Max(0, -c2) * 0.25 - kR) * w;
                    cr = Math.Max(cr, 0.28 * w);
                }
            }
            // ---- defenders: hand-check a driver, squeeze over screens, point at their man ----
            if (PRO && pos != p.tm && B.owner != null && md == "i" && !air)
            {
                var ow = B.owner;
                double dd = Hypot(ow.x - p.x, ow.y - p.y);
                if (dd < 24 && Hypot(ow.vx, ow.vy) > 140)
                {
                    // hand on the driver's hip
                    var k8 = armIK(p, cr, ow.x, ow.y, ow.z + ow.ht * 5, -1, 0.9);
                    aL = k8.a;
                    eL = k8.e;
                    zL = k8.ab;
                    gL = 0.1;
                }
                if (p.scr > 0)
                {
                    // fighting over a screen: turn the shoulders sideways, arms tucked
                    ty += 1.0;
                    aL = aR = 0.5;
                    eL = eR = 1.7;
                    sz = -0.2;
                    zL = -0.2;
                }
                else if (!(p.helpT > 0) && !(p.rotT > 0) && !(p.hdgT > 0) && Hypot(ow.vx, ow.vy) < 260)
                {
                    // help side "pistols": away from the ball, one hand points at the ball, the other at his man (eased
                    // in with the distance, so it never switches on with a pop)
                    double bd = Hypot(B.x - p.x, B.y - p.y);
                    var mk = p.manT > 0 && p.man != null ? PAt(p.man.Value) : guardOf(p);
                    double w = clamp((bd - 150) / 70, 0, 1);
                    if (mk != null && mk != ow && w > 0)
                    {
                        double f = fv(p),
                            bs = Math.Sin(f) * (B.x - p.x) - Math.Cos(f) * (B.y - p.y) > 0 ? 1 : -1, // ball on his right?
                            zc = p.z + p.ht * 5.2; // (pointing low and soft, not a scarecrow)
                        // aim 40 px out along a direction between his facing and the target
                        PtAim(p, f, B.x, B.y, out double b2x, out double b2y);
                        PtAim(p, f, mk.x, mk.y, out double m2x, out double m2y);
                        // (as in the TS: armIK returns one shared object, so kb and km are the same - both hold the
                        // second solve. Kept for parity.)
                        var kb = armIK(p, cr, b2x, b2y, zc, bs, 0.7);
                        var km = armIK(p, cr, m2x, m2y, zc, -bs, 0.7);
                        double kbAb = kb.ab, kmAb = km.ab;
                        double ab = Math.Min(kb.a, 1.3),
                            am = Math.Min(km.a, 1.2);
                        if (bs > 0)
                        {
                            aR += (ab - aR) * w; eR += (0.35 - eR) * w; sz += (kbAb - sz) * w;
                            aL += (am - aL) * w; eL += (0.45 - eL) * w; zL = (zL ?? sz) + (kmAb - (zL ?? sz)) * w;
                        }
                        else
                        {
                            aL += (ab - aL) * w; eL += (0.35 - eL) * w; zL = (zL ?? sz) + (kbAb - (zL ?? sz)) * w;
                            aR += (am - aR) * w; eR += (0.45 - eR) * w; sz += (kmAb - sz) * w;
                        }
                        gL = gR = 0.55; // index finger out
                    }
                    // one pass away: deny - the ball-side hand goes into the passing lane between the ball and his man
                    double wd = clamp((150 - bd) / 40, 0, 1) * clamp((bd - 60) / 30, 0, 1);
                    if (mk != null && mk != ow && wd > 0 && Hypot(mk.x - p.x, mk.y - p.y) < 60)
                    {
                        double lx = mk.x + (B.x - mk.x) * 0.3,
                            ly = mk.y + (B.y - mk.y) * 0.3,
                            f = fv(p),
                            bs = Math.Sin(f) * (lx - p.x) - Math.Cos(f) * (ly - p.y) > 0 ? 1 : -1;
                        var kd = armIK(p, cr, lx, ly, p.z + p.ht * 6.2, bs, 0.9);
                        double ad = Math.Min(kd.a, 1.6);
                        if (bs > 0) { aR += (ad - aR) * wd; eR += (0.25 - eR) * wd; sz += (kd.ab - sz) * wd; gR = 0.1; }
                        else { aL += (ad - aL) * wd; eL += (0.25 - eL) * wd; zL = (zL ?? sz) + (kd.ab - (zL ?? sz)) * wd; gL = 0.1; }
                        cr = Math.Max(cr, 0.3 * wd); // down in a stance
                    }
                }
            }
            // ---- offense off the ball: open teammates call for it ----
            if (PRO && pos == p.tm && !has && B.owner != null && B.owner.tm == p.tm && md == "i" && !air && !(p.setT > 0))
            {
                double open = NearOpp(p);
                if (open > 50 && Hypot(B.owner.vx, B.owner.vy) < 120 && Math.Sin(Sim.T * 1.3 + p.k * 2.1) > 0.4)
                {
                    aR = 2.6;
                    eR = 0.25;
                    sz = 0.25;
                    gR = 0.05;
                    LOOK.x = B.owner.x;
                    LOOK.y = B.owner.y;
                    LOOK.z = B.owner.z + 60;
                    LOOK.on = 1;
                }
            }
//@@CONTINUE@@
        }
    }
}
