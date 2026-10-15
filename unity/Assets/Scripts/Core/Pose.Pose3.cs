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
        public double lnd0; // landT at the touchdown of the current landing (knee absorption ramps in from it)
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

        /// <summary>Smoothstep of a clamped 0..1 parameter (TS smooth01).</summary>
        public static double smooth01(double u)
        {
            u = u < 0 ? 0 : u > 1 ? 1 : u;
            return u * u * (3 - 2 * u);
        }
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
            double ux = (dx / l) * 0.55 + JsMath.Cos(f) * 0.45,
                uy = (dy / l) * 0.55 + JsMath.Sin(f) * 0.45,
                m = Hypot(ux, uy);
            if (!Util.T(m)) m = 1;
            rx0 = p.x + (ux / m) * 40;
            ry0 = p.y + (uy / m) * 40;
        }
        /// <summary>Pelvis height helper: vertical extension of a leg (thigh t, knee k).</summary>
        static double Ext(double t, double k) => RIG.L1 * JsMath.Cos(t) + RIG.L2 * JsMath.Cos(t - k);
        /// <summary>Blend offset wrap: cr (crouch, channel 9) is a distance, every other channel an angle.</summary>
        /// <summary>(the shoulder raise channels aL / aR go over the top: an offset up to 4 rad is a real arm path)</summary>
        static double Wq(int j, double a) => j == 9 ? a : j == 4 || j == 5 ? wrapArm(a) : wrapPi(a);
        /// <summary>Offset of a shoulder raise channel: plain up to 4 rad, a 2 pi alias beyond (TS wrapArm).</summary>
        public static double wrapArm(double a) => Math.Abs(a) <= 4 ? a : wrapPi(a);

        /// <summary>Write this tick's joint angles into p.q (in place, smoothed when Pro Play is on).</summary>
        public static void pose3(Player p)
        {
            if (!(p.mvT > 0 && p.mvk == 2)) p.ry = 0;
            bool PRO = cfg.PRO != 0,
                has = B.owner == p,
                air = p.z > 2;
            double sp = Hypot(p.vx, p.vy),
                spd = Math.Min(1, sp / 200),
                s = JsMath.Sin(p.ph),
                c = JsMath.Cos(p.ph);
            string md = p.mode;
            // stride-matched gait: thigh swing sized so the planted foot travels exactly one step (see sim stepLen)
            double legF = (3.18 * p.ht) / 6.4,
                A = JsMath.Asin(Math.Min(0.9, (stepLen(sp) / 10 / (2 * legF)) * 0.92)) * Math.Min(1, sp / 30),
                ksw = 0.45 + 0.95 * spd, // swing-knee flex: heel kick grows with speed
                mv = Math.Min(1, sp / 30); // 0 standing .. 1 moving
            double hL = 0, // humeral twist (+ = internal rotation), applied about the upper-arm bone
                hR = 0;
            double tL = s * A,
                tR = -s * A,
                kL = 0.07 + Math.Max(0, c) * Math.Sqrt(Math.Max(0, c)) * ksw * Math.Min(1, sp / 30),
                kR = 0.07 + Math.Max(0, -c) * Math.Sqrt(Math.Max(0, -c)) * ksw * Math.Min(1, sp / 30),
                // (standing: the swing dies out - the arms hang relaxed and a little forward, elbows soft)
                aL = -s * (0.2 * mv + 0.65 * spd) + 0.07 * (1 - mv),
                aR = s * (0.2 * mv + 0.65 * spd) + 0.07 * (1 - mv),
                eL = 0.3 + 0.15 * mv + spd * 1.0,
                eR = 0.3 + 0.15 * mv + spd * 1.0,
                sz = 0.13,
                // the body is lowest at mid-stance; standing, the knees stay soft (an athlete never locks them out)
                cr = 0.07 * spd * (1 - Math.Abs(s)) + 0.16 * (1 - mv),
                ln = 0.07 * spd + 0.05 * (1 - mv) - Or0(p.brk) * 0.3,
                rz = 0,
                ty = s * 0.18 * spd, // pelvis turns with the forward leg...
                wR = 0,
                wL = 0;
            double? zL = null;
            // new joints (animation engine v2)
            double cx = 0.07 * spd, // chest pitch on top of the pelvis lean
                cy = -s * 0.3 * spd, // ...and the chest counter-rotates (real running)
                gL = 0.35, // finger curl 0 open .. 1 fist (relaxed hands are half curled)
                gR = 0.35,
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
                    double dk = JsMath.Sin(Math.Min(1, p.t / 0.2) * Math.PI);
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
                double rT = IsLaySv(I(p.sv)) || kind0 == "hook" || kind0 == "sky" ? 0.28 : p.st == 1 ? 0.3 : 0.4,
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
                    double cf2 = JsMath.Cos(p.f),
                        sf2 = JsMath.Sin(p.f),
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
                    double sw = JsMath.Sin(Sim.T * 5.5 + p.k);
                    tL += sw * 0.18;
                    tR += sw * 0.18;
                    ln += sw * 0.06;
                    gL = gR = 0.85;
                }
                else if ((kind == "lay" || kind == "roll" || kind == "contact") && k > 0.4 && k < 0.92)
                {
                    // layup hand extends toward the rim around the release
                    double w = JsMath.Sin(((k - 0.4) / 0.52) * Math.PI) * 0.75;
                    var r1 = armIK(p, cr, hoop(p.tm), HY, 104, 1, 0.5, ln, cx);
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
                    ln = -0.5 * JsMath.Sin(Math.Min(1, k * 1.1) * 3.14);
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
                tL = JsMath.Sin(p.t * 28) * 0.7;
                tR = -tL;
                kL = Math.Max(0, -tL) + 0.4;
                kR = Math.Max(0, tL) + 0.4;
                aR = 0.7 + JsMath.Sin(p.t * 22) * 0.5;
                eR = 1.2;
                aL = 0.5;
                eL = 1;
                cr = 0.3;
                ty = JsMath.Sin(p.t * 22) * 0.3;
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
                cr = 0.5 - 0.2 * spd; // sitting down over the ball (taller when he runs with it)
                ln = 0.22 + spd * 0.08;
                cx += 0.05; // chest over the ball, head up
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
                // stance: hips back and down, chest up over the knees, hands out in front and alive (own rhythms)
                aL = 0.78 + JsMath.Sin(Sim.T * 7.3 + p.k) * 0.07;
                aR = 0.78 + JsMath.Sin(Sim.T * 8.1 + p.k + 1.7) * 0.07;
                eL = eR = 0.8;
                sz = 0.82 + JsMath.Sin(Sim.T * 6.2 + p.k * 2.1) * 0.06;
                zL = 0.82 + JsMath.Sin(Sim.T * 5.7 + p.k * 1.3) * 0.06;
                cr = 0.55;
                tL = s * 0.5 * spd + 0.35;
                tR = -s * 0.5 * spd + 0.35;
                kL = kR = 0.8;
                ln = 0.3;
                cx = -0.08;
            }
            double hz = 0.07 * (1 - mv); // (standing: feet a little outside the hips, an athletic base)
            {
                double sv = Hypot(p.vx, p.vy);
                bool def = pos != p.tm && B.owner != null;
                if (md == "i" && !air && sv > 25)
                {
                    double cf = JsMath.Cos(p.f),
                        sf = JsMath.Sin(p.f),
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
                        // a sprinter leans from the ankles into his speed (the capture ran upright)
                        if (!def && fw > 0.5) { ln += 0.1 * clamp((sv - 150) / 120, 0, 1) * w; cx += 0.04 * clamp((sv - 150) / 120, 0, 1) * w; }
                    }
                }
                else if (def && !air) hz = 0.14;
                if (PRO && has && md == "i" && !Util.T(p.postA))
                {
                    // Dribble hand IK with EITHER hand: whichever side of the body the ball is on (works on guests too: it
                    // only needs the ball position). The free arm relaxes, or becomes an arm-bar toward a close defender.
                    var k2 = armIK(p, cr, B.x, B.y, Math.Max(B.z, (B.dtop ?? p.z + p.ht * 5) - 8), 0, 0.6, ln, cx); // hand waits at the hip
                    bool right = k2.right;
                    double a2 = k2.a,
                        e2 = k2.e,
                        ab = k2.ab;
                    // closest defender: arm-bar with the free arm
                    double dd = NearOpp(p);
                    bool bar = dd < 45 && !(p.mvT > 0);
                    // (the free arm swings with the stride - against its own side's leg)
                    double fa = bar ? 0.62 : 0.4 + spd * 0.3 + (right ? -s : s) * 0.32 * spd, // arm-bar: upper arm out front, forearm across the chest at belly height
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
                    // a hand up at the shooter: rises as he closes in (eased by the distance)
                    double w = clamp((70 - Hypot(B.owner.x - p.x, B.owner.y - p.y)) / 18, 0, 1);
                    aR += (2.9 - aR) * w;
                    eR += (0.15 - eR) * w;
                    aL += (1.3 - aL) * w;
                    eL += (0.6 - eL) * w;
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
                    // hesitation: sit up and slow ... then explode low and forward (eased, no switch)
                    double u = smooth01((e - 0.16) / 0.12);
                    cr = 0.55 + (0.1 - 0.55) * u;
                    ln = -0.12 + (0.35 + 0.12) * u;
                    cx += 0.12 * u;
                }
                else if (p.mvk == 3)
                {
                    ty += JsMath.Sin(e * 10) * 0.9 * sd;
                    ln = 0.2;
                    cr = Math.Max(cr, 0.25); // sit into the between-the-legs; the hand IK carries the ball
                }
                else
                {
                    // crossover: low, the shoulders dip and turn toward the side the ball goes to
                    double b = JsMath.Sin(clamp(e / 0.4, 0, 1) * Math.PI);
                    ln = 0.3;
                    cr = 0.2 + 0.2 * b;
                    rz += 0.16 * b * sd;
                    cy += 0.14 * b * sd;
                }
            }
            // ---- smarter running: plant-and-cut lean, drive steps out of a standstill, braking stops ----
            {
                double hd = JsMath.Atan2(p.vy, p.vx);
                if (sp > 60 && p.hd0 != null)
                {
                    double dh = JsMath.Atan2(JsMath.Sin(hd - p.hd0.Value), JsMath.Cos(hd - p.hd0.Value));
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
                    double u = JsMath.Sin(clamp(1 - p.actT / 0.42, 0, 1) * Math.PI);
                    cr = 0.3 * (1 - u);
                    kL = kR = 0.6 - 0.45 * u;
                    tL = tR = 0.35 - 0.25 * u;
                    ln = 0.2 - 0.25 * u;
                    HEADX -= 0.3 * u;
                }
                else if (hold == 2 && p.act == 2)
                {
                    // jab step: the lead foot stabs out toward the jab, weight shifts onto it, ball ripped to the far hip
                    double u = JsMath.Sin(clamp(1 - p.actT / 0.38, 0, 1) * Math.PI);
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
                    // free-throw routine: square to the rim, ball spun in the fingertips at the chest, knees soft
                    cr = 0.2;
                    kL = kR = 0.3;
                    tL = tR = 0.1;
                    ln = 0.05;
                }
            }
            // ---- both hands on the ball: inbounds overhead, and every held-ball state ----
            if (PRO && has && md == "i" && (inb > 0 || Util.T(hold)))
            {
                // (the inbounder stands tall with the ball overhead - not in the dribbler's crouch)
                if (inb > 0 && !Util.T(hold)) { cr = Math.Min(cr, 0.12); ln = Math.Min(ln, 0.08); cx = Math.Min(cx, 0.02); }
                for (int si = 0; si < 2; si++)
                {
                    double sd = si == 0 ? 1 : -1;
                    // each hand on its own side of the ball (the right side is (sin f, -cos f))
                    // (aim for where the ball is going - B.tg*, set by the host's bstep - not the ball, which rides in these hands)
                    bool own = B.tgo == p;
                    double bx = own ? B.tgx : B.x,
                        by = own ? B.tgy : B.y,
                        bz = own ? B.tgz : B.z;
                    var k5 = armIK(p, cr, bx + JsMath.Sin(fv(p)) * 3 * sd, by - JsMath.Cos(fv(p)) * 3 * sd, bz, sd, 0.9, ln, cx);
                    if (sd > 0) { aR = k5.a; eR = k5.e; sz = k5.ab; }
                    else { aL = k5.a; eL = k5.e; zL = k5.ab; }
                }
                gL = gR = 0.4;
            }
            // ---- jump ball: the centers reach for the toss ----
            if (PRO && JB != null && air && (JB.c[0] == p || JB.c[1] == p))
            {
                var kj = armIK(p, cr, B.x, B.y, B.z, 1, 0.6, ln, cx);
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
                    double u = JsMath.Sin(clamp(e / 0.4, 0, 1) * Math.PI);
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
                var k6 = armIK(p, cr, B.x + JsMath.Cos(fv(p)) * 8, B.y + JsMath.Sin(fv(p)) * 8, B.z + 4, 1, 0.8, ln, cx);
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
                    var k3 = armIK(p, cr, tx3, ty3, Math.Max(18, B.z + 6), 0, 0.9, ln, cx);
                    if (k3.right) { aR += (k3.a - aR) * w; eR += (k3.e - eR) * w; sz += (k3.ab - sz) * w; }
                    else { aL += (k3.a - aL) * w; eL += (k3.e - eL) * w; zL = (zL ?? sz) + (k3.ab - (zL ?? sz)) * w; }
                }
                else if (!has && B.owner == null && (B.mode == "air" || B.mode == "pass") && bd < 45 && B.z > p.z + 30 && B.z < p.z + 150 && (air || B.to == p) && !(Util.T(B.sh) && B.age < 0.5))
                {
                    // (not a shot that just left the hand: it flies by too fast to track - the swat was the block layer's job)
                    // rebounds, tips and catches: both hands go to where the ball actually is (not behind him: a ball that
                    // went past his back is let go, the arms don't swing backwards after it)
                    double fw = (JsMath.Cos(fv(p)) * (B.x - p.x) + JsMath.Sin(fv(p)) * (B.y - p.y)) / (Util.T(bd) ? bd : 1),
                        w = clamp((45 - bd) / 20, 0, 1) * clamp((fw + 0.35) / 0.5, 0, 1);
                    var r1 = armIK(p, cr, B.x, B.y, B.z, 1, 1.0, ln, cx);
                    aR += (r1.a - aR) * w; eR += (r1.e - eR) * w; sz += (r1.ab - sz) * w;
                    var r2 = armIK(p, cr, B.x, B.y, B.z, -1, 1.0, ln, cx);
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
                    sd = JsMath.Sin(f) * (m.x - p.x) - JsMath.Cos(f) * (m.y - p.y) > 0 ? 1 : -1;
                var k = armIK(p, cr, m.x, m.y, p.z + p.ht * 7.4, sd, 0.9, ln, cx);
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
                    var k = armIK(p, cr, p.hcx + JsMath.Sin(fv(p)) * 2 * sd, p.hcy - JsMath.Cos(fv(p)) * 2 * sd, zc, sd, 0.6, ln, cx);
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
                    double c2 = JsMath.Sin(Sim.T * 22 + p.k),
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
                    var k8 = armIK(p, cr, ow.x, ow.y, ow.z + ow.ht * 5, -1, 0.9, ln, cx);
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
                            bs = JsMath.Sin(f) * (B.x - p.x) - JsMath.Cos(f) * (B.y - p.y) > 0 ? 1 : -1, // ball on his right?
                            zc = p.z + p.ht * 5.2; // (pointing low and soft, not a scarecrow)
                        // aim 40 px out along a direction between his facing and the target
                        PtAim(p, f, B.x, B.y, out double b2x, out double b2y);
                        PtAim(p, f, mk.x, mk.y, out double m2x, out double m2y);
                        // (as in the TS: armIK returns one shared object, so kb and km are the same - both hold the
                        // second solve. Kept for parity.)
                        var kb = armIK(p, cr, b2x, b2y, zc, bs, 0.7, ln, cx);
                        var km = armIK(p, cr, m2x, m2y, zc, -bs, 0.7, ln, cx);
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
                            bs = JsMath.Sin(f) * (lx - p.x) - JsMath.Cos(f) * (ly - p.y) > 0 ? 1 : -1;
                        var kd = armIK(p, cr, lx, ly, p.z + p.ht * 6.2, bs, 0.9, ln, cx);
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
                double cw = clamp((JsMath.Sin(Sim.T * 1.3 + p.k * 2.1) - 0.4) / 0.15, 0, 1); // (eased, never pops)
                if (open > 50 && Hypot(B.owner.vx, B.owner.vy) < 120 && cw > 0)
                {
                    aR += (2.6 - aR) * cw;
                    eR += (0.25 - eR) * cw;
                    sz += (0.25 - sz) * cw;
                    gR = 0.05;
                    LOOK.x = B.owner.x;
                    LOOK.y = B.owner.y;
                    LOOK.z = B.owner.z + 60;
                    LOOK.on = 1;
                }
            }
            // ---- Pro Play v3 ----
            if (PRO)
            {
                // closeout: a defender flying at the ball handler gets a hand up on the way, then breaks down with short
                // choppy steps (butt low, weight back) so he can't be blown by; the high hand takes the shot side, the low
                // hand the drive
                var ow = B.owner;
                if (ow != null && ow.tm != p.tm && !air && md == "i" && !(p.hupT > 0) && !(p.celT > 0))
                {
                    double dx = ow.x - p.x,
                        dy = ow.y - p.y,
                        d = Hypot(dx, dy);
                    if (!Util.T(d)) d = 1;
                    double ap = (p.vx * dx + p.vy * dy) / d;
                    if (d < 140 && d > 14 && ap > 50)
                    {
                        double w = clamp((ap - 50) / 110, 0, 1) * clamp((140 - d) / 50, 0, 1),
                            brk = clamp((85 - d) / 40, 0, 1) * w, // breaking down: chop steps
                            shoot = ow.mode == "c" || ow.mode == "s" ? 1 : 0.65,
                            ch = JsMath.Sin(Sim.T * 27 + p.k * 1.3);
                        aR += (2.2 + 0.7 * shoot - aR) * w;
                        eR += (0.5 - 0.35 * shoot - eR) * w;
                        sz += (0.2 - sz) * w;
                        aL += (0.75 - aL) * w;
                        eL += (0.7 - eL) * w;
                        gR = 0.05;
                        tL += (0.42 + ch * 0.12 - tL) * brk;
                        tR += (0.42 - ch * 0.12 - tR) * brk;
                        kL += (0.95 + Math.Max(0, ch) * 0.2 - kL) * brk;
                        kR += (0.95 + Math.Max(0, -ch) * 0.2 - kR) * brk;
                        ln += (0.24 - ln) * brk;
                        cr = Math.Max(cr, 0.5 * brk);
                        toe += 0.15 * brk; // up on the balls of the feet
                    }
                }
                // calling for the ball: an open shooter (nobody within 90 px) on the perimeter raises a hand and shouts for
                // it, in short bursts so the floor looks alive rather than everyone waving at once
                if (ow != null && ow.tm == p.tm && ow != p && !air && md == "i" && !(p.celT > 0) && !(p.setT > 0) && !Util.T(p.postA) && inb <= 0 && ftq == null)
                {
                    double dh = Hypot(ow.x - p.x, ow.y - p.y);
                    double nd = NearOpp(p);
                    double cyc = (Sim.T * 0.45 + p.k * 0.37) % 1;
                    if (nd > 90 && dh > 140 && dh < 420 && cyc < 0.3)
                    {
                        double w = Math.Min(1, Math.Min(cyc / 0.06, (0.3 - cyc) / 0.06));
                        aR += (2.75 - aR) * w;
                        eR += (0.35 - eR) * w;
                        sz += (0.35 - sz) * w;
                        gR = 0.0; // open palm
                        p.callT = 0.1; // the face shouts (face())
                    }
                }
                // on-ball defense up close: the trail hand rides the driver's hip (feeling him), the other hand stays active
                if (ow != null && ow.tm != p.tm && !air && md == "i" && !(p.hupT > 0) && !(p.celT > 0))
                {
                    double d = Hypot(ow.x - p.x, ow.y - p.y);
                    double hw = clamp((JsMath.Sin(Sim.T * 1.7 + p.k) + 0.3) / 0.25, 0, 1); // (on and off his hip, eased)
                    if (d < 34 && d > 10 && hw > 0)
                    {
                        var r = armIK(p, cr, ow.x - JsMath.Cos(ow.f) * 3, ow.y - JsMath.Sin(ow.f) * 3, ow.z + ow.ht * 4.4, 0, 0.9, ln, cx);
                        double w = clamp((34 - d) / 10, 0, 1) * (r.over < 0.4 ? 1 : 0) * hw;
                        if (r.right) { aR += (r.a - aR) * w; eR += (r.e - eR) * w; sz += (r.ab - sz) * w; gR = 0.1; }
                        else { aL += (r.a - aL) * w; eL += (r.e - eL) * w; zL = (zL ?? sz) + (r.ab - (zL ?? sz)) * w; gL = 0.1; }
                    }
                }
                // contest with a hand up, feet on the floor (vs a pump faker)
                if (Or0(p.hupT) > 0 && !air && !has)
                {
                    double w = Math.Min(1, p.hupT * 4);
                    aR += (2.95 - aR) * w;
                    eR += (0.05 - eR) * w;
                    sz += (0.12 - sz) * w;
                    aL += (1.3 - aL) * w;
                    eL += (0.6 - eL) * w;
                    gR = 0.05;
                }
                // pass styles: behind the back (throwing arm swings behind the hip), no-look (head away from the target)
                if (p.pT > 0 && Util.T(p.pk))
                {
                    double u = clamp(1 - p.pT / 0.25, 0, 1);
                    if (p.pk == 2)
                    {
                        aR = -0.55 - 0.35 * u;
                        eR = 1.2 - 0.6 * u;
                        sz = 0.35;
                        oR = -0.9 * u;
                        aL = 0.4;
                        eL = 0.5;
                        ty -= 0.25;
                    }
                    else if (p.pk == 1)
                    {
                        LOOK.x = p.x + JsMath.Cos(p.f) * 200;
                        LOOK.y = p.y + JsMath.Sin(p.f) * 200;
                        LOOK.z = 70;
                        LOOK.on = 1;
                    }
                    else if (p.pk == 3)
                    {
                        // wraparound: one arm sweeps around the defender's hip
                        aR = 0.9 + 0.3 * u;
                        eR = 0.4;
                        sz = 0.9 - 0.7 * u;
                        aL = 0.5;
                        ln += 0.2;
                        cr = Math.Max(cr, 0.25);
                    }
                }
                // one-hand catch on the run
                if (B.mode == "pass" && B.to == p && !air && sp > 150)
                {
                    aL = 0.35;
                    eL = 0.5;
                    zL = 0.1;
                }
                // double clutch: the ball comes down under the contest, then back up to the release
                if (md == "s" && Or0(p.dcl) >= 0.09 && !Util.T(p.rl))
                {
                    double w = clamp(JsMath.Sin(((p.t - 0.14) / 0.3) * Math.PI), 0, 1);
                    aR -= 0.95 * w;
                    eR += 0.55 * w;
                    aL -= 0.8 * w;
                    eL += 0.45 * w;
                    ln += 0.18 * w;
                    cr += 0.05 * w;
                }
                // planting the outside foot on a hard cut: sit down and lean back against the momentum
                if (Or0(p.plantT) > 0 && !air && md == "i")
                {
                    double w = Math.Min(1, p.plantT * 6);
                    cr += 0.28 * w;
                    ln -= 0.3 * w;
                    hs += 0.12 * w;
                }
                // body english: lean with the ball on the rim, arms out like you can steer it
                if (Or0(p.engT) > 0 && !has)
                {
                    double w = Math.Min(1, p.engT * 5),
                        s2 = Or0(p.eng);
                    rz += -0.35 * s2 * w;
                    ty += 0.2 * s2 * w;
                    aL += (1.0 - aL) * w;
                    aR += (1.0 - aR) * w;
                    eL += (0.45 - eL) * w;
                    eR += (0.45 - eR) * w;
                    sz += (0.65 - sz) * w;
                    zL = (zL ?? sz) + (0.65 - (zL ?? sz)) * w;
                }
            }
            // ---- free throws: players along the lane lean in, ready to box out ----
            if (PRO && ftq != null && ftq.s != p && md == "i" && Math.Abs(hoop(ftq.s.tm) - p.x) < 150 && Math.Abs(p.y - HY) < 70)
            {
                cr = 0.32;
                ln = 0.3;
                tL = tR = 0.35;
                kL = kR = 0.7;
                hz = 0.22;
                aL = aR = 0.75;
                eL = eR = 1.1;
                zL = 0.35;
                sz = 0.35;
            }
            // ---- fatigue body language: shoulders slump, head forward, shorter arm swing ----
            {
                double tired = clamp((0.6 - p.en) / 0.4, 0, 1); // (TS p.en ?? 1: en starts at 1)
                if (tired > 0 && md == "i" && !air)
                {
                    cx += 0.14 * tired;
                    ln += 0.06 * tired;
                    HEADX += 0.18 * tired;
                    if (!has) { aL *= 1 - 0.4 * tired; aR *= 1 - 0.4 * tired; }
                }
            }
            // Planted screener: wide base, knees bent, arms folded across the chest.
            if (p.setT > 0 && md == "i" && !air && !has)
            {
                st = ST.scr;
                gL = gR = 0.9;
                hs = 0;
                hz = 0.32;
                cr = 0.3;
                kL = kR = 0.55;
                tL = tR = 0.25;
                // (forearms folded across the stomach: the upper arms turn in about the bone, elbows tucked)
                aL = aR = 0.4;
                eL = eR = 1.85;
                hL = hR = 1.15;
                zL = 0.08;
                sz = 0.08;
                ln = 0.08;
            }
            // Pro Play contact + weight: bumps rock the torso away from the hit, landings sink into the knees,
            // and players lean into acceleration.
            if (PRO)
            {
                if (!(p.landT > 0)) p.lnd0 = 0;
                else if (p.landT > p.lnd0) p.lnd0 = p.landT; // a new landing
                if (p.landT > 0 && md != "s")
                {
                    // (the knees take the load over the first 60 ms after touchdown, then rise back)
                    double k = (p.landT / 0.28) * smooth01((p.lnd0 - p.landT) / 0.06);
                    // landing: feet split (one lands first) and the drift carries the stance sideways
                    tL += 0.22 * k;
                    tR -= 0.12 * k;
                    hs += clamp((-p.vx * JsMath.Sin(p.f) + p.vy * JsMath.Cos(p.f)) / 600, -0.25, 0.25) * k;
                    cr += 0.4 * k;
                    kL += 0.55 * k;
                    kR += 0.55 * k;
                    tL += 0.3 * k;
                    tR += 0.3 * k;
                    ln += 0.12 * k;
                }
                if (md == "i" && !air) ln += clamp(Or0(p.acc) / 2600, -0.14, sp < 150 ? 0.28 : 0.2);
            }
            if (Util.T(p.postA))
            {
                st = ST.post;
                cr = 0.45;
                ln = 0.25;
                sz = 0.8;
                aL = 1.2;
                if (PRO && has && md == "i")
                {
                    // backing down: low dribble on the far side, the off arm a bar into the defender, chest shielding
                    // (the sim's dribble hand, not the ball's side: a ball crossing his midline must not swap the arms)
                    var kp = armIK(p, cr, B.x, B.y, Math.Max(B.z, (B.dtop ?? p.z + p.ht * 4.4) - 8), (Util.T(B.dhn) ? B.dhn : 1) > 0 ? 1 : -1, 0.6, ln, cx);
                    if (kp.right) { aR = kp.a; eR = kp.e; sz = kp.ab; aL = 1.05; eL = 1.55; zL = 0.62; hL = 0.55; gR = 0.15; gL = 0.5; }
                    else { aL = kp.a; eL = kp.e; zL = kp.ab; aR = 1.05; eR = 1.55; sz = 0.62; hR = 0.55; gL = 0.15; gR = 0.5; }
                    cy += kp.right ? 0.18 : -0.18;
                }
            }
            // Signature celebration (CEL): arms and torso blend into the move while the legs keep running.
            // Hands on knees: catching a breath at dead balls (free throws, after makes) when tired or lined up.
            bool onLane = ftq != null && ftq.s != p && Math.Abs(hoop(ftq.s.tm) - p.x) < 150 && Math.Abs(p.y - HY) < 70;
            if (md == "i" && !has && !air && sp < 15 && !(p.celT > 0) && !(p.setT > 0) && onLane)
            {
                // lined up on the lane: knees bent, weight forward, hands out ready to box out on the miss
                cr = Math.Max(cr, 0.3);
                tL = tR = 0.35;
                kL = kR = 0.45;
                ln = 0.18;
                aL = aR = 0.75;
                eL = eR = 1.15;
                zL = 0.55;
                sz = 0.55;
                gL = gR = 0.15;
            }
            else if (md == "i" && !has && !air && sp < 15 && !(p.celT > 0) && !(p.setT > 0) && ftq != null && ftq.s != p && p.k % 2 == 1)
            {
                // behind the arc at a free throw: hands on the hips (the others rest on their knees)
                aL = aR = -0.15;
                zL = 0.62;
                sz = 0.62;
                eL = eR = 1.55;
                hL = hR = 1.25;
                cx = -0.05 + JsMath.Sin(Sim.T * 2 + p.k) * 0.04;
                gL = gR = 0.35;
            }
            else if (md == "i" && !has && !air && sp < 15 && !(p.celT > 0) && !(p.setT > 0) && (ftq != null ? ftq.s != p && !onLane : rs > 0.3 && p.en < 0.75))
            {
                st = ST.rest;
                ln = 0.55;
                cx = 0.22;
                cr = 0.32;
                tL = tR = 0.55;
                kL = kR = 0.62;
                aL = aR = 0.62;
                eL = eR = 0.35;
                sz = 0.22;
                zL = 0.22;
                hz = 0.14;
                gL = gR = 0.35;
            }
            else if (md == "i" && !has && !air && sp >= 15 && sp < 110 && p.en < 0.6 && (rs > 0.3 || ftq != null) && !(p.celT > 0) && !(p.setT > 0))
            {
                // gassed, walking at a dead ball: arms hang heavy, shoulders slump, a big breath (arms and chest only - the
                // legs keep walking)
                double br = JsMath.Sin(Sim.T * 2.4 + p.k) * 0.06;
                // hands on the hips: elbows out, forearms turned in to the hip bones, chest heaving
                aL = aR = -0.15;
                zL = 0.62;
                sz = 0.62;
                eL = eR = 1.55;
                hL = hR = 1.25;
                cx = -0.05 + br;
                gL = gR = 0.35;
            }
            if (p.celT > 0 && Util.T(p.cel) && md == "i" && !has && !air && !Util.T(p.postA) && !(p.setT > 0))
            {
                st = ST.cel;
                double e = CEL_T - p.celT,
                    k = Math.Min(1, Math.Min(e / 0.2, p.celT / 0.35)),
                    zl = zL == null ? sz : zL.Value;
                int cel = p.cel == Math.Floor(p.cel) ? (int)p.cel : -1;
                switch (cel)
                {
                    case 1: // shimmy: elbows tucked, shoulders shake (the chest shakes over still hips)
                        cy += JsMath.Sin(e * 50) * 0.25 * k;
                        gL = gR = Lp(gR, 0.6, k);
                        aL = Lp(aL, 0.45, k);
                        aR = Lp(aR, 0.45, k);
                        eL = Lp(eL, 1.75, k);
                        eR = Lp(eR, 1.75, k);
                        sz = Lp(sz, 0.3, k);
                        zL = Lp(zl, 0.3, k);
                        ty += JsMath.Sin(e * 50) * 0.08 * k;
                        rz += JsMath.Sin(e * 50) * 0.07 * k;
                        ln = Lp(ln, -0.05, k);
                        break;
                    case 2: // night night: hands together beside the cheek, head tilted onto them
                        HEADX = 0.35 * k;
                        aR = Lp(aR, 2.45, k);
                        eR = Lp(eR, 2.5, k);
                        aL = Lp(aL, 2.25, k);
                        eL = Lp(eL, 2.45, k);
                        sz = Lp(sz, -0.15, k);
                        zL = Lp(zl, -0.6, k);
                        rz = Lp(rz, 0.24, k);
                        ty = Lp(ty, 0.2, k);
                        break;
                    case 3: // front double-bicep flex with a pump: upper arms out level, forearms turned up (external rotation)
                        gL = gR = Lp(gR, 1, k);
                        aL = aR = Lp((aL + aR) / 2, 0.15, k);
                        eL = eR = Lp((eL + eR) / 2, 1.75 + JsMath.Sin(e * 12) * 0.18, k);
                        hL = Lp(hL, -1.45, k);
                        hR = Lp(hR, -1.45, k);
                        sz = Lp(sz, 1.45, k);
                        zL = Lp(zl, 1.45, k);
                        ln = Lp(ln, -0.14, k);
                        cr = Lp(cr, 0.15, k);
                        break;
                    case 4: // both arms up, three fingers to the crowd, pumping
                        gL = gR = Lp(gR, 0.4, k);
                        HEADX = -0.35 * k;
                        aL = Lp(aL, 2.7 + JsMath.Sin(e * 10) * 0.15, k);
                        aR = Lp(aR, 2.7 + JsMath.Sin(e * 10 + 1) * 0.15, k);
                        eL = Lp(eL, 0.35, k);
                        eR = Lp(eR, 0.35, k);
                        sz = Lp(sz, 0.35, k);
                        zL = Lp(zl, 0.35, k);
                        ln = Lp(ln, -0.16, k);
                        break;
                    case 5: // chest thump, chin up
                        gR = Lp(gR, 1, k);
                        aR = Lp(aR, 1.25, k);
                        eR = Lp(eR, 2.25 + Math.Max(0, JsMath.Sin(e * 15)) * 0.35, k);
                        sz = Lp(sz, -0.45, k);
                        aL = Lp(aL, 0.35, k);
                        zL = Lp(zl, 0.6, k);
                        ln = Lp(ln, -0.16, k);
                        break;
                    case 6: // power roar: crouched, arms flexed down and out
                        gL = gR = Lp(gR, 1, k);
                        aL = Lp(aL, 0.45, k);
                        aR = Lp(aR, 0.45, k);
                        eL = Lp(eL, 1.0, k);
                        eR = Lp(eR, 1.0, k);
                        sz = Lp(sz, 0.95, k);
                        zL = Lp(zl, 0.95, k);
                        ln = Lp(ln, 0.28, k);
                        cr = Lp(cr, 0.35, k);
                        break;
                    case 7: // shh: finger to the lips, looking around the arena
                        aR = Lp(aR, 2.2, k);
                        eR = Lp(eR, 2.55, k);
                        sz = Lp(sz, -0.3, k);
                        aL = Lp(aL, 0.2, k);
                        eL = Lp(eL, 0.35, k);
                        ty += JsMath.Sin(e * 2.2) * 0.35 * k;
                        break;
                    case 11: // missed an open look: hands on the head
                        aL = Lp(aL, 2.55, k);
                        aR = Lp(aR, 2.55, k);
                        eL = Lp(eL, 2.2, k);
                        eR = Lp(eR, 2.2, k);
                        sz = Lp(sz, 0.75, k);
                        zL = Lp(zl, 0.75, k);
                        HEADX = -0.25 * k;
                        break;
                    case 12:
                        {
                            // arguing the call: arms out, palms up, shrug
                            double sh = JsMath.Sin(e * 7) * 0.15;
                            aL = Lp(aL, 0.9 + sh, k);
                            aR = Lp(aR, 0.9 - sh, k);
                            eL = Lp(eL, 0.9, k);
                            eR = Lp(eR, 0.9, k);
                            sz = Lp(sz, 0.55, k);
                            zL = Lp(zl, 0.55, k);
                            oL = Lp(oL, 1.3, k);
                            oR = Lp(oR, -1.3, k);
                            gL = gR = Lp(gR, 0.05, k);
                            break;
                        }
                    case 13:
                        {
                            // hyping a teammate: clapping in front of the chest
                            double cl = Math.Abs(JsMath.Sin(e * 9));
                            aL = Lp(aL, 1.35, k);
                            aR = Lp(aR, 1.35, k);
                            eL = Lp(eL, 0.9, k);
                            eR = Lp(eR, 0.9, k);
                            sz = Lp(sz, -0.15 + 0.5 * cl, k);
                            zL = Lp(zl, -0.15 + 0.5 * cl, k);
                            break;
                        }
                    case 15:
                        // dead-ball fidget: left hand tugs the jersey at the chest, eyes down
                        aL = Lp(aL, 0.55, k);
                        eL = Lp(eL, 1.95, k);
                        zL = Lp(zl, -0.45, k);
                        gL = Lp(gL, 0.8, k);
                        HEADX = 0.2 * k;
                        break;
                    case 16:
                        {
                            // helping a teammate up: reach down and pull
                            var f2 = p.helpP;
                            if (f2 != null)
                            {
                                double pull = e > 0.45 ? (e - 0.45) * 0.6 : 0;
                                var k16 = armIK(p, cr, f2.x, f2.y, 18 + pull * 40, 1, 0.95, ln, cx);
                                aR = Lp(aR, k16.a, k);
                                eR = Lp(eR, k16.e, k);
                                sz = Lp(sz, k16.ab, k);
                                gR = Lp(gR, 0.7, k);
                                ln = Lp(ln, 0.45 - pull, k);
                                cr = Lp(cr, 0.35, k);
                                LOOK.x = f2.x;
                                LOOK.y = f2.y;
                                LOOK.z = 10;
                                LOOK.on = 1;
                            }
                            break;
                        }
                    case 14:
                        // swat hold: the blocking arm stays up, staring him down
                        aR = Lp(aR, 2.85, k);
                        eR = Lp(eR, 0.2, k);
                        wR = Lp(wR, -0.5, k);
                        gR = Lp(gR, 0.05, k);
                        ln = Lp(ln, -0.12, k);
                        break;
                    case 10:
                        {
                            // held follow-through (gooseneck) after a green, released after ~1 s
                            double h = e < 1.3 ? 1 : Math.Max(0, 1 - (e - 1.3) / 0.3);
                            aR = Lp(aR, aR + (2.75 - aR) * h, k);
                            eR = Lp(eR, eR + (0.15 - eR) * h, k);
                            wR = 1.15 * h;
                            gR = Lp(gR, 0.2, k);
                            break;
                        }
                    case 9:
                        {
                            // dap / low five with the nearest teammate (after a made free throw)
                            Player mate = null;
                            double bd2 = 1e9;
                            for (int i = 0; i < P.Count; i++)
                            {
                                var o2 = P[i];
                                if (o2 != p && o2.tm == p.tm)
                                {
                                    double d = Hypot(o2.x - p.x, o2.y - p.y);
                                    if (d < bd2) { bd2 = d; mate = o2; }
                                }
                            }
                            double reach = e < 0.7 ? JsMath.Sin((e / 0.7) * Math.PI) : 0;
                            aR = Lp(aR, 0.5 + reach * 0.9, k);
                            eR = Lp(eR, 0.9 - reach * 0.6, k);
                            sz = Lp(sz, -0.15, k);
                            gR = Lp(gR, 0.1, k);
                            if (mate != null) { LOOK.x = mate.x; LOOK.y = mate.y; LOOK.z = mate.z + mate.ht * 9; LOOK.on = 1; }
                            break;
                        }
                    case 8: // point to the sky
                        aR = Lp(aR, 2.95, k);
                        eR = Lp(eR, 0.12, k);
                        aL = Lp(aL, e > 0.6 ? 2.7 : 0.3, k);
                        eL = Lp(eL, e > 0.6 ? 0.2 : 0.8, k);
                        sz = Lp(sz, 0.15, k);
                        zL = Lp(zl, 0.15, k);
                        ln = Lp(ln, -0.22, k);
                        gL = gR = Lp(gR, 0.8, k);
                        HEADX = -0.5 * k; // eyes to the sky
                        break;
                }
            }
            // ---- box-outs and post battles: bodies lean into each other ----
            if (md == "i" && !air && !has && !(p.setT > 0) && !(p.celT > 0))
            {
                Player ob = null;
                double od = 1e9;
                for (int i = 0; i < P.Count; i++)
                {
                    var q = P[i];
                    if (q.tm != p.tm)
                    {
                        double d = Hypot(q.x - p.x, q.y - p.y);
                        if (d < od) { od = d; ob = q; }
                    }
                }
                bool shotUp = B.owner == null && (B.mode == "air" || Util.T(B.sh)) && B.z > 20;
                if (ob != null && od < 22 && shotUp && Hypot(hoop(1 - p.tm) - p.x, HY - p.y) < 130)
                {
                    // box-out (defense of that basket): sit low and wide, arms out to feel the man behind
                    st = ST.post;
                    cr = Math.Max(cr, 0.5);
                    hz = Math.Max(hz, 0.3);
                    aL = aR = 0.85;
                    eL = eR = 1.05;
                    sz = 0.9;
                    zL = 0.9;
                    ln = 0.26; // hips back into him (a hip hinge), chest up, eyes on the ball
                    cx = -0.1;
                    gL = gR = 0.1;
                }
                else if (ob != null && od < 22 && Util.T(ob.postA) && B.owner == ob)
                {
                    // fronting the post: forearm in his back, leaning into him
                    st = ST.post;
                    ln += 0.22;
                    cr = Math.Max(cr, 0.3);
                    aL = 1.0;
                    eL = 1.45;
                    zL = 0.1;
                }
            }
            // ---- standing life: slow, out-of-phase sways (weight from foot to foot, chest settling, shoulder roll), arms
            // drifting on their own rhythm; per-player phases. Fades out as he starts to move.
            if (md == "i" && !air && !has && (st == ST.idle || st == ST.rest || st == ST.def) && sp < 30)
            {
                double w = (1 - mv) * (st == ST.def ? 0.5 : 1),
                    k0 = p.k * 1.7;
                rz += JsMath.Sin(Sim.T * 0.55 + k0) * 0.035 * w;
                cy += JsMath.Sin(Sim.T * 0.37 + k0 * 1.3) * 0.06 * w;
                ty += JsMath.Sin(Sim.T * 0.29 + k0 * 0.7) * 0.04 * w;
                cx += JsMath.Sin(Sim.T * 0.21 + k0 * 2.1) * 0.025 * w;
                aL += JsMath.Sin(Sim.T * 0.8 + k0) * 0.035 * w; aR += JsMath.Sin(Sim.T * 0.73 + k0 + 2) * 0.035 * w;
            }
            // ---- secondary motion (light ragdoll): a damped spring on the torso. Contact impulses (sized by the hit, so the
            // momentum of the collision carries into the reaction) and the body's own inertia when speeding up, stopping or
            // cutting drive it; it overshoots and settles. Big hits make the arms flail for balance and force a recovery step.
            if (PRO)
            {
                double cf = JsMath.Cos(p.f),
                    sf = JsMath.Sin(p.f),
                    ax = (p.vx - (p.svx ?? p.vx)) / DT,
                    ay = (p.vy - (p.svy ?? p.vy)) / DT;
                p.svx = p.vx;
                p.svy = p.vy;
                double afw = clamp(ax * cf + ay * sf, -6000, 6000),
                    asd = clamp(-ax * sf + ay * cf, -6000, 6000);
                if (Or0(p.hitT) > Or0(p.hit0) + 0.01)
                {
                    double hfw = Or0(p.hitX) * cf + Or0(p.hitY) * sf,
                        hsd = -Or0(p.hitX) * sf + Or0(p.hitY) * cf;
                    p.sfv = Or0(p.sfv) + hfw * p.hitT * 13;
                    p.ssv = Or0(p.ssv) + hsd * p.hitT * 13;
                }
                p.hit0 = Or0(p.hitT);
                double air2 = p.z > 2 ? 0.4 : 1; // no footing in the air: softer
                p.sfv = Or0(p.sfv) + (-110 * Or0(p.sf) - 12 * Or0(p.sfv) - (md == "i" ? afw * 0.007 * air2 : 0)) * DT;
                p.ssv = Or0(p.ssv) + (-110 * Or0(p.ss) - 12 * Or0(p.ssv) - (md == "i" ? asd * 0.007 * air2 : 0)) * DT;
                p.sf = clamp(Or0(p.sf) + p.sfv * DT, -0.55, 0.55);
                p.ss = clamp(Or0(p.ss) + p.ssv * DT, -0.55, 0.55);
                ln += p.sf;
                rz += p.ss * 0.9;
                cx += p.sf * 0.4;
                // the head and loose arms trail the torso (they lag its spring velocity)
                HEADX -= p.sf * 0.55;
                if (md == "i" && !has)
                {
                    aL -= clamp(p.sfv * 0.06, -0.3, 0.3);
                    aR -= clamp(p.sfv * 0.06, -0.3, 0.3);
                }
                double wob = Hypot(p.sf, p.ss);
                if (wob > 0.12 && md == "i" && !has)
                {
                    // balance: arms out, a quick step to catch the fall
                    double k = Math.Min(1, (wob - 0.12) / 0.25);
                    sz += 0.7 * k;
                    zL = (zL ?? sz) + 0.7 * k;
                    aL += 0.4 * k;
                    aR += 0.4 * k;
                    hs += clamp(-p.ss * 0.9, -0.3, 0.3);
                    tL += p.sf * 0.5;
                    tR += p.sf * 0.5;
                }
            }
            // ---- Unity Pro Play upgrades (cfg.UP, Pose.UP.cs): shots, moves, gathers, defense, off-ball ----
            if (cfg.UP != 0 && PRO)
            {
                var U = UQ;
                U.tL = tL; U.tR = tR; U.kL = kL; U.kR = kR; U.aL = aL; U.aR = aR; U.eL = eL; U.eR = eR; U.sz = sz; U.cr = cr; U.ln = ln; U.rz = rz; U.ty = ty; U.wR = wR; U.wL = wL; U.hz = hz; U.cx = cx; U.cy = cy; U.hs = hs; U.gL = gL; U.gR = gR; U.oL = oL; U.oR = oR; U.hL = hL; U.hR = hR; U.toe = toe; U.st = st;
                U.zL = zL ?? sz; U.zSet = false;
                upPose(p, U, md, has, air, sp, hold);
                tL = U.tL; tR = U.tR; kL = U.kL; kR = U.kR; aL = U.aL; aR = U.aR; eL = U.eL; eR = U.eR; sz = U.sz; cr = U.cr; ln = U.ln; rz = U.rz; ty = U.ty; wR = U.wR; wL = U.wL; hz = U.hz; cx = U.cx; cy = U.cy; hs = U.hs; gL = U.gL; gR = U.gR; oL = U.oL; oR = U.oR; hL = U.hL; hR = U.hR; toe = U.toe; st = U.st;
                if (U.zSet) zL = U.zL;
            }
            // ---- additive layer: breathing (deeper when tired) ----
            {
                double tired = 1 - p.en; // (TS p.en ?? 1: en starts at 1)
                cx += JsMath.Sin(Sim.T * (2.1 + tired * 3) + p.k * 1.7) * (0.012 + tired * 0.05);
            }
            // ---- feet: flat on the floor through stance, toe-off behind the body, pointed in the air ----
            double fL = tL - kL + toe + (st == ST.run || st == ST.drib ? Math.Max(0, -tL - 0.12) * 0.9 * spd : 0),
                fR = tR - kR + toe + (st == ST.run || st == ST.drib ? Math.Max(0, -tR - 0.12) * 0.9 * spd : 0);
            if (MCF > 0 && !air) { fL += (MFL - fL) * MCF; fR += (MFR - fR) * MCF; } // captured ankles (heel-strike, toe-off)
            MCF = 0;
            // ---- head tracking: everyone follows the ball; the handler and shooters read the rim ----
            double hy = 0,
                hp = 0,
                hyT = 0,
                hpT = 0;
            double nk = -(ln + cx) * 0.35;
            {
                // idle glance: off the ball and standing at a dead ball, eyes wander (bench, crowd, a teammate) now and then
                double gl0 = JsMath.Sin(Sim.T * 0.37 + p.k * 2.1);
                if (!Util.T(LOOK.on) && !has && sp < 20 && (rs > 0 || ftq != null || inb > 0) && gl0 > 0.55)
                {
                    var o = P[(int)((p.k * 3 + Math.Floor((Sim.T * 0.37) / 3)) % P.Count)];
                    if (o != null && o != p) { LOOK.x = o.x; LOOK.y = o.y; LOOK.z = o.z + o.ht * 9; LOOK.on = 1; }
                    else { LOOK.x = p.x; LOOK.y = p.y < 250 ? -60 : 560; LOOK.z = 60; LOOK.on = 1; } // the crowd
                }
                if (!Util.T(LOOK.on))
                {
                    if ((has && (md == "c" || md == "s")) || (has && md == "i" && !Util.T(p.postA)))
                    {
                        double hx = hoop(p.tm);
                        LOOK.x = hx; LOOK.y = HY; LOOK.z = 100;
                        if (B.mode == "pass" && B.to != null) { LOOK.x = B.to.x; LOOK.y = B.to.y; LOOK.z = 60; }
                    }
                    else { LOOK.x = B.x; LOOK.y = B.y; LOOK.z = B.z; }
                }
                double dx = LOOK.x - p.x,
                    dy = LOOK.y - p.y,
                    dist = Hypot(dx, dy);
                if (dist > 6)
                {
                    double d = JsMath.Atan2(JsMath.Sin(JsMath.Atan2(dy, dx) - p.f), JsMath.Cos(JsMath.Atan2(dy, dx) - p.f)),
                        hz2 = p.z + p.ht * 9.3;
                    hyT = -d - ty - cy;
                    hpT = JsMath.Atan2(hz2 - LOOK.z, dist) - (ln + cx) * 0.9 - nk;
                    hy = clamp(hyT, -1.25, 1.25);
                    hp = clamp(hpT, -0.75, 0.8);
                    hy *= 1 - 0.6 * clamp((Math.Abs(hyT) - 1.8) / 0.6, 0, 1); // target behind: don't owl-turn (eases in, no snap)
                }
                hp += HEADX;
                LOOK.on = 0;
                HEADX = 0;
            }
            // ---- guide hand: on the side of the ball from the gather until the release, then it peels away ----
            if (PRO && has && (md == "c" || md == "s") && !Util.T(p.postA) && (!IsLaySv(I(Or0(p.sv))) || p.sv == 11 || p.sv == 14 || p.sv == 15 || md == "c"))
            {
                var ball = palmAt(p, aR, eR, sz, wR, ln, ty, rz, cx, cy, cr);
                if (ball != null)
                {
                    double lx = -JsMath.Sin(p.f),
                        ly = JsMath.Cos(p.f);
                    var r2 = armIK(p, cr, ball[0] + lx * 4.2, ball[1] + ly * 4.2, ball[2] + 0.5, -1, 0.9, ln, cx);
                    if (r2.over < 0.6)
                    {
                        double w = md == "c" ? Math.Min(1, p.t / 0.12) : 1;
                        // guide-hand style: 0 classic, 1 thumb flick at the release, 2 drops away early, 3 elbow flared out wide,
                        // 4 rides high with the ball after the release, 5 old-school two-hand push (both wrists snap)
                        double gs = p.sg != null ? Or0(p.sg.gs) : 0,
                            k7 = md == "s" && cfg.UP == 0 ? p.t / 0.4 : 0, // (UP: the guide hand stays on until the release; its style plays after it, upPose)
                            off = gs == 2 && k7 > 0.6 ? Math.Min(1, (k7 - 0.6) / 0.15) : 0;
                        aL += (r2.a - aL) * w * (1 - off);
                        eL += (r2.e - eL) * w * (1 - off);
                        zL = (zL ?? sz) + (r2.ab - (zL ?? sz)) * w * (1 - off);
                        wL = -0.35 * w;
                        if (gs == 1 && k7 > 0.68) { wL = 0.7; oL = 0.6; } // thumb flick
                        if (gs == 3) { zL = (zL ?? sz) + 0.28 * w; oL = -0.35 * w; } // elbow out, palm faces the ball's side
                        if (gs == 4 && k7 > 0.7)
                        {
                            double u = Math.Min(1, (k7 - 0.7) / 0.2); // the guide arm keeps rising beside the shooting arm
                            aL += (aR - 0.15 - aL) * u;
                            eL += (0.35 - eL) * u;
                            wL = -0.1;
                        }
                        if (gs == 5 && k7 > 0.66) { wL = 0.85; aL += 0.15; eL = Math.Max(0, eL - 0.3); } // pushes through with both
                        gL = 0.15;
                    }
                }
            }
            // ---- left-handed shooters: the whole shot is mirrored across the body (shooting arm, guide hand, legs, twist).
            // Everything above was solved for a right-hander (guide-hand IK included); mirroring is exact, and handPos follows
            // the left hand while q.mir is set, so the release point and the 3D ball stay in the shooting hand.
            bool mirr = (p.sg != null && Util.T(p.sg.lh)) != (cfg.UP != 0 && Util.T(p.offH) && md == "s") && (md == "s" || (md == "c" && has)); // (UP: an off-hand finish mirrors the shot)
            if (mirr)
            {
                double t = aL;
                aL = aR; aR = t; t = eL; eL = eR; eR = t;
                t = zL == null ? sz : zL.Value;
                zL = sz; sz = t;
                t = wL; wL = wR; wR = t; t = oL; oL = -oR; oR = -t; t = gL; gL = gR; gR = t; t = hL; hL = hR; hR = t;
                t = tL; tL = tR; tR = t; t = kL; kL = kR; kR = t; t = fL; fL = fR; fR = t;
                hs = -hs; ty = -ty; rz = -rz; cy = -cy; hy = -hy; hyT = -hyT;
            }
            // ---- blend: inertialization. On a state change the old pose's offset from the new target (and its velocity)
            // decays to zero along a quintic over that state's blend time (snappy into a shot, slow into a rest), so the new
            // animation plays with no lag while the transition stays smooth (C2, no overshoot). Inside a state only a light
            // 50 ms filter smooths the targets (IK and clip switches).
            bool sm = PRO && p.q != null && p.posed, // (TS q && q.wR != null)
                INZ = cfg.INZ != 0;
            double fS = sm ? 1 - JsMath.Exp((-DT * 3) / (INZ ? Math.Min(0.05, BLEND[st]) : BLEND[st])) : 1;
            var oq = p.q ?? (p.q = new Q());
            VALS[0] = tL;
            VALS[1] = tR;
            VALS[2] = kL;
            VALS[3] = kR;
            VALS[4] = aL;
            VALS[5] = aR;
            VALS[6] = clamp(eL, -0.05, 2.75); // (elbows never bend backwards)
            VALS[7] = clamp(eR, -0.05, 2.75);
            VALS[8] = sz;
            VALS[9] = cr;
            VALS[10] = ln;
            VALS[11] = rz;
            VALS[12] = ty;
            VALS[13] = wR;
            VALS[14] = wL;
            VALS[15] = zL == null ? sz : zL.Value;
            VALS[16] = hz;
            VALS[17] = cx;
            VALS[18] = cy;
            VALS[19] = nk;
            VALS[20] = hy;
            VALS[21] = clamp(hp, -0.85, 0.8); // (the neck has limits: looking far down at a low ball is the chest's job too)
            VALS[22] = fL;
            VALS[23] = fR;
            VALS[24] = gL;
            VALS[25] = gR;
            VALS[26] = hs;
            VALS[27] = oL;
            VALS[28] = oR;
            VALS[29] = hL;
            VALS[30] = hR;
            // per joint: x/v = offset and its velocity at the last restart, t/tf = time since and blend length, b = filtered
            // target, pt/pv = last target and its velocity (to spot a target that jumps), last/lv = last output and velocity
            var iz = p.inz ?? (p.inz = new Inz());
            bool trans = st != p.anS && sm && Util.T(iz.ok),
                fromReach = p.anS == ST.cat || p.anS == ST.air; // (hands out for a catch / up for a rebound, then straight into a shot)
            if (!sm || !Util.T(iz.ok))
                for (int j = 0; j < NQ; j++) { iz.b[j] = VALS[j]; iz.pt[j] = VALS[j]; iz.pv[j] = 0; iz.x[j] = 0; iz.v[j] = 0; iz.t[j] = 9; }
            p.anS = st;
            iz.ok = 1;
            for (int j = 0; j < NQ; j++)
            {
                double v = VALS[j];
                bool hd = j == 20 || j == 21;
                // wR is never smoothed (the wrist flick at release must be crisp); the head turns a bit quicker than the body
                if (j == 13 || !sm)
                {
                    oq[j] = v;
                    iz.b[j] = v;
                }
                else if (!INZ)
                {
                    iz.b[j] += (v - iz.b[j]) * (hd ? Math.Min(1, fS * 1.6) : fS);
                    oq[j] = iz.b[j];
                    iz.pt[j] = v;
                }
                else
                {
                    // restart this joint's blend on a state change, or when its target jumps (a clip/IK/look-target switch that
                    // would pop): the body carries on from where it is and eases into the new target
                    // (cr (crouch, j 9) is a distance, every other channel an angle: W = identity / wrapPi)
                    double dev = Math.Abs(Wq(j, v - (iz.pt[j] + iz.pv[j] * DT)));
                    bool jump = dev > (hd ? 0.08 : j >= 4 && j <= 8 ? 0.25 : 0.12) * (iz.t[j] < iz.tf[j] ? 3 : 1);
                    if (trans || jump)
                    {
                        // (from the blender's own last output: o[k] also carries the foot-placement IK, which must not leak in)
                        double cur = Util.T(iz.has) ? iz.last[j] : oq[j]; // (TS o[k] ?? v: sm implies p.q was fully written)
                        iz.x[j] = Wq(j, cur - v); // joint angles are circular: 2 pi apart is the same pose (spins, IK across +-pi)
                        iz.v[j] = clamp(iz.lv[j] - (jump ? iz.pv[j] : 0), -40, 40);
                        iz.t[j] = 0;
                        // (a state change uses that state's own blend time - snappy into a shot; inside a state, big jumps blend
                        // longer so the catch-up never whips, except during shots and moves where timing is everything)
                        bool quick = (st == ST.shot || st == ST.move) && !hd; // (the head never snaps)
                        double big = Math.Min(quick ? 0.1 : 0.32, 0.08 + Math.Abs(iz.x[j]) * (hd ? 0.12 : 0.1));
                        // (into a shot: crisp, but the arms coming down from a catch / rebound reach still get a few ticks, never 2)
                        double qk = quick ? (fromReach ? Math.Min(0.1, 0.02 + Math.Abs(iz.x[j]) * 0.05) : 0) : big * 0.75;
                        // (UP: a gather / move out of a sprint carries the arms a few ticks instead of snapping a big swing over)
                        if (cfg.UP != 0 && quick && trans && (md == "c" || st == ST.move)) qk = Math.Max(qk, Math.Min(0.12, 0.02 + Math.Abs(iz.x[j]) * 0.04));
                        iz.tf[j] = trans ? Math.Max(BLEND[st] * (hd ? 0.4 : 0.65), qk) : big;
                        iz.b[j] = v;
                    }
                    iz.pv[j] = jump ? 0 : Wq(j, v - iz.pt[j]) / DT; // a jump is not a velocity: predict from the new target next tick
                    iz.pt[j] = v;
                    if (j != 9 && Math.Abs(Wq(j, v - iz.b[j])) != Math.Abs(v - iz.b[j])) iz.b[j] = v; // the filter never runs the long way round (angles)
                    iz.b[j] += (v - iz.b[j]) * (hd ? Math.Min(1, fS * 1.6) : fS);
                    iz.t[j] += DT;
                    oq[j] = iz.b[j] + inert(iz.x[j], iz.v[j], iz.tf[j], iz.t[j]);
                }
                iz.lv[j] = (j == 9 ? oq[j] - iz.last[j] : j == 4 || j == 5 ? wrapArm(oq[j] - iz.last[j]) : wrapPi(oq[j] - iz.last[j])) / DT;
                iz.last[j] = oq[j];
                iz.has = 1;
            }
            if (mirr) oq.wL = wL; // the (now left) shooting wrist snaps crisp, like wR does
            oq.mir = mirr ? 1 : 0;
            p.posed = true;
            // contact (post-blend, so it holds even while the arms are still blending out of another pose):
            // - the dribble hand meets the ball at the top of every bounce,
            // - a receiver's two hands meet an incoming pass (either side of the ball) as it arrives.
            // Each arm solves for its own side; its weight eases in and out over ~60 ms and it fades out from its last solution
            // when contact ends (a pass, a shot), so the correction itself never pops; an IK branch flip is ignored.
            {
                var K = p.ctK ?? (p.ctK = new double[12]); // per arm: a, e, ab of the last solution + target x, y, z
                bool drib = PRO && has && md == "i" && !Util.T(p.postA) && !Util.T(hold) && inb <= 0 && B.mode == "held" && B.dtop != null && !(p.pT > 0) && !(p.mvT > 0 && (p.mvk == 2 || p.mvk == 3)); // (spins and behind-the-backs carry the ball on their own hand paths)
                double bd = Hypot(B.x - p.x, B.y - p.y),
                    cl = (B.vx * (p.x - B.x) + B.vy * (p.y - B.y)) / (Util.T(bd) ? bd : 1), // closing speed of the pass
                    tta = cl > 30 ? (bd - 24) / cl : 9; // seconds until it reaches the hands
                bool cat = PRO && !has && B.mode == "pass" && B.to == p && tta < 0.3 && B.z < p.z + 125 && md != "s";
                // contest: a defender close to a shooter in his gather/shot gets the ball-side hand up at the ball (late, fast)
                var sh = B.owner ?? (Util.T(B.sh) && B.age < 0.3 && !Util.T(B.ft) ? B.last : null); // (and just after the release: the hand stays up)
                bool con = PRO && !has && !air && !Util.T(p.postA) && sh != null && sh.tm != p.tm && (sh.mode == "c" || sh.mode == "s" || B.owner == null) && Hypot(sh.x - p.x, sh.y - p.y) < 48 && md != "s" && md != "c";
                double cwR = 0,
                    cwL = 0;
                if (!con) p.ctPo = 0;
                if (con)
                {
                    // (aim at the shooter's ball while he has it; after the release the hand stays where the ball left - same spot,
                    // same arm - not chasing it)
                    var P0 = p.ctP ?? (p.ctP = new double[] { 0, 0, 0, 1 });
                    if (B.owner != null || !Util.T(p.ctPo))
                    {
                        P0[0] = B.x;
                        P0[1] = B.y;
                        P0[2] = Math.Max(B.z + 10, p.z + p.ht * 10.6);
                        P0[3] = armIK(p, oq.cr, P0[0], P0[1], P0[2], 0, 0.6, oq.ln, oq.cx).right ? 1 : 0;
                    }
                    p.ctPo = 1;
                    double w = clamp((48 - Hypot(sh.x - p.x, sh.y - p.y)) / 14, 0, 1);
                    if (Util.T(P0[3])) { cwR = w; K[6] = P0[0]; K[7] = P0[1]; K[8] = P0[2]; }
                    else { cwL = w; K[9] = P0[0]; K[10] = P0[1]; K[11] = P0[2]; }
                }
                else if (drib)
                {
                    double dtop = B.dtop.Value,
                        bz = Math.Max(B.z, dtop - 8),
                        // (around the top of the bounce only: a ball still up at the chest after a catch is the other pose's business)
                        wt = clamp((B.z - (dtop - 16)) / 8, 0, 1) * clamp((dtop + 12 - B.z) / 6, 0, 1);
                    if (armIK(p, oq.cr, B.x, B.y, bz, 0, 0.6, oq.ln, oq.cx).right) { cwR = wt; K[6] = B.x; K[7] = B.y; K[8] = bz; }
                    else { cwL = wt; K[9] = B.x; K[10] = B.y; K[11] = bz; }
                }
                else if (cat)
                {
                    // both hands go out to where the ball will be caught (a quarter second ahead), one on each side of it; a bounce
                    // pass is taken at the knees, not off the floor
                    double t2 = clamp(tta, 0, 0.3),
                        fx = B.x + B.vx * t2,
                        fy = B.y + B.vy * t2,
                        fz = clamp(B.z + B.vz * t2, p.z + 24, p.z + 110),
                        fl = Hypot(fx - p.x, fy - p.y),
                        ux = (fx - p.x) / (Util.T(fl) ? fl : 1),
                        uy = (fy - p.y) / (Util.T(fl) ? fl : 1),
                        wt = clamp(1 - tta / 0.3, 0, 1);
                    cwR = cwL = wt;
                    K[6] = fx + uy * 3.5; K[7] = fy - ux * 3.5; K[8] = fz;
                    K[9] = fx - uy * 3.5; K[10] = fy + ux * 3.5; K[11] = fz;
                }
                // (TS also computes r = min(1, DT * (cat || con ? 24 : 16)) here, unused)
                double mode = con ? 3 : drib ? 1 : cat ? 2 : 0;
                // a switch of contact kind (the catch becomes a dribble) eases the solution over instead of jumping to it
                if (Util.T(mode) && mode != p.ctM) p.ctB = Sim.T;
                p.ctM = mode;
                double ks = Sim.T - (p.ctB ?? -9) < 0.18 ? 0.25 : 1;
                // contact starting from nothing: the stored solution starts at the drawn arm (a stale one from long ago would be
                // eased through - the arm swung via an old pose while the weight rose)
                if (cwR > 0 && Or0(p.ctR) < 0.01) { K[0] = oq.aR; K[1] = oq.eR; K[2] = oq.sz; }
                if (cwL > 0 && Or0(p.ctL) < 0.01) { K[3] = oq.aL; K[4] = oq.eL; K[5] = oq.zL; }
                // (weights ride a critically damped spring: they start and stop with zero velocity, so contact never pops)
                {
                    // (a spin / behind-the-back carries the ball on its own hand path: a leftover catch or dribble fade dies off faster)
                    double om = cat || con ? 22 : p.mvT > 0 && (p.mvk == 2 || p.mvk == 3) ? 30 : 18;
                    p.ctRv = Or0(p.ctRv) + (om * om * (cwR - Or0(p.ctR)) - 2 * om * Or0(p.ctRv)) * DT;
                    p.ctLv = Or0(p.ctLv) + (om * om * (cwL - Or0(p.ctL)) - 2 * om * Or0(p.ctLv)) * DT;
                    p.ctR = clamp(Or0(p.ctR) + p.ctRv * DT, 0, 1);
                    p.ctL = clamp(Or0(p.ctL) + p.ctLv * DT, 0, 1);
                }
                if (p.ctR > 0.01)
                {
                    if (cwR > 0)
                    {
                        var k = armIK(p, oq.cr, K[6], K[7], K[8], 1, cat ? 1 : 0.6, oq.ln, oq.cx);
                        if (con) { oq.wR = -0.2; oq.gR = 0.05; } // fingers spread, wrist back
                        K[0] = armN(K[0] + wrapPi(k.a - K[0]) * ks);
                        K[1] += (k.e - K[1]) * ks;
                        K[2] += (k.ab - K[2]) * ks;
                    }
                    // (contests: the plain difference; fades: wrapped, with an immediate guard below that lets go well before +-pi -
                    // a stored catch solution that crossed the wrap made the plain difference swing the arm the long way round)
                    if (con) p.ctPl = 1;
                    else if (drib || cat) p.ctPl = 0;
                    bool fade = !drib && !cat && !con && !Util.T(p.ctPl); // (a contest's fade keeps the contest's plain difference)
                    double da = drib || cat || fade ? wrapPi(K[0] - oq.aR) : K[0] - oq.aR;
                    // (an IK branch flip is not a correction; a fade keeps the last live guard, so a solution that was never shown
                    // does not appear while fading out; eased, never switched: a guard flickering tick to tick was a pop of its own)
                    double cgR = drib || cat ? clamp(1 - (Math.Abs(da) - 0.8) / 0.6, 0, 1) : con ? 1 : p.ctRg ?? 1;
                    p.ctRg = (p.ctRg ?? cgR) + (cgR - (p.ctRg ?? cgR)) * Math.Min(1, DT * 14);
                    double w = p.ctR * (fade ? Math.Min(p.ctRg ?? 1, clamp(1 - (Math.Abs(da) - 0.8) / 0.6, 0, 1)) : p.ctRg ?? 1);
                    if (cfg.UP != 0) { oq.aR += upCt(p, 0, da * w); oq.eR += upCt(p, 1, (K[1] - oq.eR) * w); oq.sz += upCt(p, 2, (K[2] - oq.sz) * w); }
                    else
                    {
                        oq.aR += da * w;
                        oq.eR += (K[1] - oq.eR) * w;
                        oq.sz += (K[2] - oq.sz) * w;
                    }
                }
                else if (cfg.UP != 0) { oq.aR += upCt(p, 0, 0); oq.eR += upCt(p, 1, 0); oq.sz += upCt(p, 2, 0); }
                if (p.ctL > 0.01)
                {
                    if (cwL > 0)
                    {
                        var k = armIK(p, oq.cr, K[9], K[10], K[11], -1, cat ? 1 : 0.6, oq.ln, oq.cx);
                        if (con) oq.gL = 0.05;
                        K[3] = armN(K[3] + wrapPi(k.a - K[3]) * ks);
                        K[4] += (k.e - K[4]) * ks;
                        K[5] += (k.ab - K[5]) * ks;
                    }
                    double z0 = oq.zL; // (TS o.zL ?? o.sz: zL is always written above)
                    bool fadeL = !drib && !cat && !con && !Util.T(p.ctPl);
                    double da = drib || cat || fadeL ? wrapPi(K[3] - oq.aL) : K[3] - oq.aL;
                    double gL2 = drib || cat ? clamp(1 - (Math.Abs(da) - 0.8) / 0.6, 0, 1) : con ? 1 : p.ctLg ?? 1;
                    p.ctLg = (p.ctLg ?? gL2) + (gL2 - (p.ctLg ?? gL2)) * Math.Min(1, DT * 14);
                    double w = p.ctL * (fadeL ? Math.Min(p.ctLg ?? 1, clamp(1 - (Math.Abs(da) - 0.8) / 0.6, 0, 1)) : p.ctLg ?? 1);
                    if (cfg.UP != 0) { oq.aL += upCt(p, 3, da * w); oq.eL += upCt(p, 4, (K[4] - oq.eL) * w); oq.zL = z0 + upCt(p, 5, (K[5] - z0) * w); }
                    else
                    {
                        oq.aL += da * w;
                        oq.eL += (K[4] - oq.eL) * w;
                        oq.zL = z0 + (K[5] - z0) * w;
                    }
                }
                else if (cfg.UP != 0) { oq.aL += upCt(p, 3, 0); oq.eL += upCt(p, 4, 0); oq.zL += upCt(p, 5, 0); }
            }
            if (PRO && cfg.PLANT != 0) plantFeet(p, oq, sp);
            if (PRO && cfg.AVOID != 0) avoidBodies(p, oq);
            if (cfg.UP != 0 && PRO) upGuide(p, oq, md, has); // (UP: guide palm on the side of the ball until the release)
            face(p, st, hyT, hpT);
        }
    }
}
