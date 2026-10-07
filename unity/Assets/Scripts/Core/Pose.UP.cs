// Unity-only Pro Play animation upgrades (cfg.UP = 1), one pose layer called from pose3 before the additive/feet/head
// layers (so the stepping, blending, limits and contact passes all still run after it). Sim side: Sim.UP.cs.
// Shots: gather -> dip -> rise -> set -> release -> follow-through by form (dp/k/ft/gs/lk), catch-and-shoot 1-2 step vs
// hop gather off the dribble, elbow under the ball, leg drive + toe extension, landing knees by jump height, contest
// lean-away, signature forms (Curry one-motion, Durant high release, Jokic push shot, Doncic step-back, Antetokounmpo
// slow set), FT set, layup gathers (plant foot, ball protect, off-arm shield, full reach), floater / sky hook clips.
// Moves: in-and-out, crossover, snatch-back with anticipation and settle. Defense: slide hip turn, swipe-down, contest
// variety (one hand high / verticality / late flail). Off ball: cut lean, V-cut plant, screen brace + roll turn, alley-oop
// catch hands. Landings flow into the next action.
using System;
using System.Collections.Generic;
using static Hoops.Core.Util;
using static Hoops.Core.Data;
using static Hoops.Core.Sim;
using static Hoops.Core.Pose;

namespace Hoops.Core
{
    /// <summary>The pose3 locals the UP layer may change (copied in and out around upPose).</summary>
    public sealed class UPV
    {
        public double tL, tR, kL, kR, aL, aR, eL, eR, sz, cr, ln, rz, ty, wR, wL, zL, hz, cx, cy, hs, gL, gR, oL, oR, hL, hR, toe;
        public bool zSet;
        public int st;
        public void ZL(double v) { zL = v; zSet = true; }
    }

    public static partial class Pose
    {
        public static readonly UPV UQ = new UPV();
        static bool upReg;
        /// <summary>UP clip names for sv 24 (floater) and 25 (sky hook); registers their clips on first use.</summary>
        static string upCK(int sv)
        {
            if (!upReg)
            {
                upReg = true;
                CL["floater"] = new Clip
                {
                    ["aR"] = new[] { 0, 1.1, 0.35, 1.9, 0.6, 2.85, 1, 2.9 }, ["eR"] = new[] { 0, 1.6, 0.35, 1.2, 0.6, 0.35, 1, 0.3 },
                    ["wR"] = new[] { 0, -0.3, 0.5, -0.5, 0.62, 0.7, 1, 0.8 }, ["aL"] = new[] { 0, 1.1, 0.35, 1.7, 0.55, 1.2, 1, 0.9 },
                    ["eL"] = new[] { 0, 1.6, 0.35, 1.2, 1, 1.0 }, ["zL"] = new[] { 0, 0.1, 1, 0.35 }, ["ln"] = new[] { 0, 0.25, 1, 0.15 },
                    ["tL"] = new[] { 0, 0.9, 1, 0.8 }, ["kL"] = new[] { 0, 1.2, 1, 1.0 }, ["tR"] = new[] { 0, -0.2, 1, -0.25 },
                    ["kR"] = new[] { 0, 0.5, 1, 0.4 }, ["sz"] = new[] { 0, 0.05, 1, 0.1 }, ["oR"] = new[] { 0, 0, 0.6, -0.4, 1, -0.5 },
                };
                CL["sky"] = new Clip
                {
                    ["aR"] = new[] { 0, 1.0, 0.3, 1.6, 0.6, 2.9, 0.9, 3.2, 1, 3.15 }, ["sz"] = new[] { 0, 1.1, 0.5, 0.85, 0.85, 0.25, 1, 0.2 },
                    ["eR"] = new[] { 0, 0.3, 1, 0.05 }, ["aL"] = new[] { 0, 1.3, 1, 1.25 }, ["eL"] = new[] { 0, 0.9, 1, 0.8 },
                    ["zL"] = new[] { 0, 0.7, 1, 0.7 }, ["ty"] = new[] { 0, 1.4, 1, 1.25 }, ["rz"] = new[] { 0, 0.2, 1, 0.15 },
                    ["ln"] = new[] { 0, 0.05, 1, 0.0 }, ["tL"] = new[] { 0, 1.0, 1, 1.15 }, ["kL"] = new[] { 0, 1.3, 1, 1.45 },
                    ["tR"] = new[] { 0, -0.15, 1, -0.15 }, ["kR"] = new[] { 0, 0.3, 1, 0.3 }, ["wR"] = new[] { 0, 0, 0.85, 0.3, 0.97, 1.0, 1, 1.0 },
                    ["oR"] = new[] { 0, 0, 0.6, -1, 1, -1 },
                };
                RELK["floater"] = 0.6;
                RELK["sky"] = 0.95;
            }
            return sv == 24 ? "floater" : sv == 25 ? "sky" : null;
        }

        static double SS(double u) { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); }
        static double Bump(double u) => u <= 0 || u >= 1 ? 0 : Math.Sin(u * Math.PI);

        /// <summary>Clip phase of the current shot (same mapping as pose3).</summary>
        static double upK(Player p, string kind)
        {
            double rT = IsLaySv(I(p.sv)) || kind == "hook" || kind == "sky" ? 0.28 : p.st == 1 ? 0.3 : 0.4;
            return Math.Min(1, p.t / rT * (kind != null && RELK.TryGetValue(kind, out var rk) ? rk : 0.7));
        }

        // signature form ids (by name)
        static int upSig(Player p) => p.n == "Curry" ? 1 : p.n == "Durant" ? 2 : p.n == "Jokic" ? 3 : p.n == "Doncic" ? 4 : p.n == "Antetokounmpo" ? 5 : 0;

        public static void upPose(Player p, UPV u, string md, bool has, bool air, double sp, double hold)
        {
            var g = p.sg;
            double dp = g != null ? Or0(g.dp) : 0, fk = g != null ? Or0(g.k) : 0, ft = g != null ? Or0(g.ft) : 0, lk = g != null ? Or0(g.lk) : 0, gs = g != null ? Or0(g.gs) : 0;
            int sig = upSig(p);
            bool curry = p.sv == 9 || (g != null && Util.T(g.cl));
            double hx = hoop(p.tm), D = Hypot(hx - p.x, HY - p.y);
            // ================= shots =================
            if (md == "c" && has)
            {
                if (p.gath != 0) upGatherPose(p, u);
                else if (ftq != null && ftq.s == p)
                {
                    // FT: the routine flows into a gentle set - ball to the chest, knees soften, dip, up
                    double d = Bump(Math.Min(1, p.t / 0.35));
                    u.aR = 1.15 - 0.35 * d; u.aL = 1.1 - 0.3 * d; u.eR = u.eL = 1.75;
                    u.cr = 0.22 + 0.18 * d; u.kL = u.kR = 0.45 + 0.35 * d; u.tL = u.tR = 0.22 + 0.15 * d; u.ln = 0.08;
                }
                else if (D >= 95)
                {
                    // jumper gather -> dip: depth / speed from the form; catch-and-shoot 1-2 step or a hop off the dribble
                    double td = curry ? 0.1 : sig == 5 ? 0.32 : 0.16 + dp * 0.18,
                        depth = curry ? 0.12 : 0.18 + dp * 0.45 + fk * 0.6 + (sig == 5 ? 0.15 : 0),
                        dk = p.t < td ? Math.Sin(p.t / td * Math.PI / 2) : 1 - 0.25 * SS((p.t - td) / 0.12); // dip, then a slight rise into the set
                    u.aR -= 0.35 * depth * dk * 2;
                    u.aL -= 0.3 * depth * dk * 2;
                    u.cr += 0.35 * depth * dk;
                    u.kL += 0.6 * depth * dk;
                    u.kR += 0.6 * depth * dk;
                    u.sz = u.sz + (0.03 - u.sz) * 0.6; // elbow under the ball
                    if (p.jg == 1)
                    {
                        // 1-2 step into the catch: inside foot then outside foot
                        double s1 = Bump(p.t / 0.12), s2 = Bump((p.t - 0.08) / 0.12);
                        u.tL += 0.3 * s1; u.kL += 0.25 * s1; u.tR += 0.3 * s2; u.kR += 0.25 * s2;
                    }
                    else if (p.jg == 2)
                    {
                        // hop gather off the dribble: both feet off together, landing loaded
                        double h = Bump(p.t / 0.14);
                        u.kL += 0.35 * h; u.kR += 0.35 * h; u.tL += 0.25 * h; u.tR += 0.25 * h; u.toe += 0.3 * h;
                    }
                    if (curry) { u.cr = Math.Min(u.cr, 0.32); u.aR = Math.Max(u.aR, 0.75); } // shallow load, the ball never drops below the chest
                }
            }
            else if (md == "s" && has)
            {
                string kind = CKofP(p.sv);
                double k = upK(p, kind), rk = kind != null && RELK.TryGetValue(kind, out var rr) ? rr : 0.7,
                    pre = Math.Min(1, k / rk), post = k > rk ? Math.Min(1, (k - rk) / Math.Max(0.05, 1 - rk)) : 0;
                bool lay = IsLaySv(I(p.sv)) || kind == "sky" || kind == "hook";
                if (!lay && kind != "hang")
                {
                    // rise: legs drive (knees extend into the jump), elbow under the ball, toes point at the release
                    if (p.z > 1 && p.vz > 0) { double e = SS(pre); u.kL *= 1 - 0.6 * e; u.kR *= 1 - 0.6 * e; u.toe += 0.35 + 0.3 * e; }
                    if (p.z > 1 && p.vz <= 0) { u.toe += 0.25; u.kL += 0.15 * post; u.kR += 0.15 * post; } // reaching for the floor
                    if (!curry && g != null && Or0(g.f) < 0.05) u.sz += (0.02 - u.sz) * 0.5 * (1 - post);
                    // follow-through held by form: wrist snapped, fingers at the rim, arm up
                    if (post > 0)
                    {
                        u.gR = 0.05;
                        u.wR += 0.15 + 0.25 * ft;
                        u.aR = Math.Max(u.aR, 2.75 + 0.15 * ft - 0.3 * post * (1 - ft));
                        // guide hand release styles, readable
                        if (gs == 1) { u.oL = 0.9; u.wL = 0.75; }
                        else if (gs == 2) { u.aL += (0.9 - u.aL) * post; u.eL += (1.0 - u.eL) * post; }
                        else if (gs == 3) u.ZL(u.zL + 0.3 * post);
                        else if (gs == 5) u.wL = 0.9;
                    }
                    // legs kick / split by style (st 2 fade splits, quick shooters stay tight)
                    double kick = (lk + (p.st == 2 ? 0.15 : 0) + (Hypot(p.vx, p.vy) > 70 ? 0.1 : 0)) * SS((k - 0.55) / 0.25);
                    u.tR -= 0.6 * kick; u.kR += 0.8 * kick; u.tL += 0.25 * kick;
                    // signature forms
                    if (sig == 2) { u.aR += 0.18 * pre; u.eR *= 1 - 0.25 * pre; } // Durant: high release, all arms
                    else if (sig == 3 && kind != "fade") { double w = 1 - post; u.aL += (u.aR - 0.1 - u.aL) * 0.6 * w; u.eL += (u.eR - u.eL) * 0.5 * w; u.aR -= 0.2 * (1 - pre); } // Jokic: two-hand push from low
                    else if (sig == 4 && p.sbw > 0) { u.ln -= 0.15; u.tR -= 0.3 * pre; u.kR += 0.35 * pre; } // Doncic: deep step-back lean, trail leg kicks
                    else if (sig == 5) { double hd = Bump(Math.Min(1, k / 0.55)); u.aR -= 0.3 * hd; u.cr += p.z < 2 ? 0.1 * hd : 0; } // Giannis: slow, deliberate set
                    if (curry)
                    {
                        // Curry (identity kept: low-load quick one-motion, no held set, release on the way up): ball straight up
                        // the midline, soft high snap with the fingers at the rim held a beat, guide hand off early, kick/split on
                        // deep or moving threes
                        u.sz += (0.0 - u.sz) * 0.7 * (1 - post);
                        u.oR += (-0.25 - u.oR) * 0.5 * pre;
                        if (post > 0) { u.wR += 0.25; u.gR = 0; u.aR = Math.Max(u.aR, 2.95); }
                        if (k > 0.62) { double w = SS((k - 0.62) / 0.15); u.aL += (1.05 - u.aL) * w; u.eL += (0.9 - u.eL) * w; }
                        if (D > 260 || Hypot(p.vx, p.vy) > 60) { double w = SS((k - 0.6) / 0.2); u.tR -= 0.35 * w; u.kR += 0.45 * w; u.tL += 0.12 * w; }
                    }
                }
                if (lay && kind != "hang")
                {
                    // finishing: ball protected with both hands on the way up, then the off arm shields, the shot arm reaches
                    // all the way to the rim
                    bool dunk = IsDunkSv(I(p.sv));
                    if (k < 0.3 && !dunk) { double w = 1 - SS(k / 0.3); u.aL += (u.aR - 0.15 - u.aL) * w; u.eL += (u.eR + 0.1 - u.eL) * w; }
                    else if (!dunk && kind != "sky")
                    {
                        double w = Bump((k - 0.3) / 0.6);
                        u.aL += (1.35 - u.aL) * w; u.eL += (0.9 - u.eL) * w; u.ZL(u.zL + (0.55 - u.zL) * w); u.gL = 0.1;
                    }
                    if ((kind == "lay" || kind == "roll" || kind == "contact" || kind == "euro" || kind == "revlay" || kind == "upunder") && k > 0.4 && k < 0.92)
                    {
                        double w = Bump((k - 0.4) / 0.52) * (kind == "lay" || kind == "roll" || kind == "contact" ? 0.3 : 0.85);
                        var r1 = armIK(p, u.cr, hx, HY, 108, 1, 0.5);
                        u.aR += (r1.a - u.aR) * w; u.eR += (r1.e - u.eR) * w; u.sz += (r1.ab - u.sz) * w;
                    }
                }
                // a late closeout: lean / fade away from his hand, release a touch higher
                if (p.lnA > 0)
                {
                    double w = p.lnA * (1 - 0.5 * post);
                    u.ln -= 0.25 * w; u.rz += 0.22 * p.lnS * w; u.aR += 0.1 * w; u.eR -= 0.1 * w;
                }
                if (kind == "floater" && g != null && g.fr >= 0.5) { u.tL = u.tR = 0.35; u.kL = u.kR = 0.6; } // two-foot floater
                // soft landing at the end of the shot: knees flex with the jump height
                if (p.z < 2 && k > 0.7 && !lay) { double w = Math.Min(1.3, Or0(p.upLand) + 0.3) * SS((k - 0.7) / 0.15); u.kL += 0.25 * w; u.kR += 0.25 * w; u.cr += 0.1 * w; }
            }
            // ================= moves =================
            if (p.mvT > 0 && md == "i" && p.mvk != 4)
            {
                double e = Or0(p.mvE), sd = Util.T(p.mvS) ? p.mvS : 1;
                // anticipation: a short counter-dip before every explosive move
                if (e < 0.07) { double a = Bump(e / 0.07); u.cr += 0.12 * a; u.ln -= 0.06 * a; }
                if (p.mvk == 5)
                {
                    if (e < 0.16) { double w = Bump(e / 0.16); u.rz -= 0.22 * sd * w; u.ty -= 0.35 * sd * w; u.cr = Math.Max(u.cr, 0.3); }
                    else if (e < 0.24) u.cr = Math.Max(u.cr, 0.38);
                    else { u.ln += 0.3; u.rz += 0.12 * sd; }
                    u.st = ST.move;
                }
                else if (p.mvk == 6)
                {
                    if (e < 0.1) u.rz -= 0.12 * sd * Bump(e / 0.1);
                    else { double w = SS((e - 0.1) / 0.12); u.rz += 0.2 * sd * w; u.ln += 0.25 * w; u.cr = Math.Max(u.cr, 0.3); }
                    u.st = ST.move;
                }
                else if (p.mvk == 7)
                {
                    if (e < 0.24) { double w = Bump(e / 0.24); u.ln -= 0.25 * w; u.cr = Math.Max(u.cr, 0.38); u.kL += 0.2 * w; u.kR += 0.2 * w; }
                    else u.ln += 0.12;
                    u.st = ST.move;
                }
            }
            else if (md == "i" && p.mvEnd != null && Sim.T - p.mvEnd.Value < 0.3 && !air)
            {
                // follow-through / settle out of the move
                double w = 1 - (Sim.T - p.mvEnd.Value) / 0.3;
                u.cr += 0.1 * w * w; u.ln += 0.05 * w;
            }
            if (md == "i" && p.fsT > 0.22 && !air) { double a = Bump((0.28 - p.fsT) / 0.06); u.cr += 0.08 * a; u.ln -= 0.04 * a; } // counter-dip into the first step
            // ================= landings flow into the next action =================
            if (p.landT > 0 && md == "i" && !air && sp > 80)
            {
                double k = p.landT / 0.28, w = Math.Min(1, (sp - 80) / 140);
                u.cr -= 0.2 * k * w; u.kL -= 0.25 * k * w; u.kR -= 0.25 * k * w; u.ln += 0.08 * k * w; // run out of it
            }
            // ================= defense =================
            var ow = B.owner;
            if (md == "i" && !air && pos != p.tm && ow != null && !has)
            {
                if (sp > 40 && u.st == ST.def)
                {
                    // slides: the hips open toward where he is going
                    double lat = (-p.vx * Math.Sin(p.f) + p.vy * Math.Cos(p.f)) / sp, w = Math.Min(1, sp / 150);
                    u.ty += 0.3 * lat * w; u.hs += 0.08 * lat * w;
                }
                if (p.swpT > 0)
                {
                    double s = 1 - p.swpT / 0.36; // high to low through the ball, no reach-in foul, no steal
                    u.aR = 2.3 - 2.0 * SS(s); u.eR = 0.3; u.sz = 0.25; u.gR = 0.05; u.ln += 0.1 * Bump(s);
                }
            }
            {
                var sh = ow != null && ow.tm != p.tm && (ow.mode == "c" || ow.mode == "s") ? ow : Util.T(B.sh) && ow == null && B.age < 0.4 && B.last != null && B.last.tm != p.tm && !Util.T(B.ft) ? B.last : null;
                if (sh != null && !has && md == "i")
                {
                    double d = Hypot(sh.x - p.x, sh.y - p.y), Ds = Hypot(hoop(sh.tm) - sh.x, HY - sh.y);
                    if (d < 48)
                    {
                        double w = clamp((48 - d) / 14, 0, 1);
                        bool front = Hypot(hoop(sh.tm) - p.x, HY - p.y) < Ds;
                        if (ow == null && sp > 100) { u.aL += (2.2 + 0.5 * Math.Sin(Sim.T * 18 + p.k) - u.aL) * w; u.ZL(u.zL + (0.7 - u.zL) * w); } // late: flailing
                        else if (p.ht >= 6.8 && front && Ds < 140) { u.aL += (3.05 - u.aL) * w; u.aR += (3.05 - u.aR) * w; u.eL += (0.08 - u.eL) * w; u.eR += (0.08 - u.eR) * w; u.sz += (0.08 - u.sz) * w; u.ZL(u.zL + (0.08 - u.zL) * w); } // verticality
                        else { u.aL += (1.0 - u.aL) * w; u.ZL(u.zL + (0.55 - u.zL) * w); } // one hand high, the other out wide
                    }
                }
            }
            // ================= off the ball =================
            if (md == "i" && !air && !has)
            {
                if ((p.br == "cut" || p.br == "use" || p.br == "vcut") && sp > 110) { u.ln += 0.08; u.rz += clamp(p.trn * 0.04, -0.2, 0.2); }
                if (p.vcT > 0.35 && p.vcT < 0.47) { double w = Bump((0.47 - p.vcT) / 0.12); u.cr += 0.2 * w; u.ln -= 0.05 * w; } // V-cut plant
                if (p.setT > 0)
                {
                    // screen: brace for the hit
                    double nd = 1e9;
                    foreach (var o in P) if (o.tm != p.tm) nd = Math.Min(nd, Hypot(o.x - p.x, o.y - p.y));
                    if (nd < 22) { double w = clamp((22 - nd) / 8, 0, 1); u.cr += 0.12 * w; u.cx -= 0.05 * w; u.hz += 0.1 * w; }
                }
                else if (p.setT > -0.45 && ow != null && ow.tm == p.tm)
                {
                    // rolling out of the screen: open up toward the ball
                    double s = (p.setT + 0.45) / 0.45, a = Math.Atan2(ow.y - p.y, ow.x - p.x) - p.f;
                    a = Math.Atan2(Math.Sin(a), Math.Cos(a));
                    u.ty += clamp(a, -0.6, 0.6) * Bump(s);
                }
                if (B.mode == "pass" && B.to == p && p.z > 10)
                {
                    // alley-oop catch: both hands up to where the ball is going, one each side
                    double fx = B.x + B.vx * 0.08, fy = B.y + B.vy * 0.08, fz = B.z + B.vz * 0.08,
                        w = clamp(1 - Hypot(fx - p.x, fy - p.y) / 90, 0, 1);
                    var r = armIK(p, u.cr, fx, fy, fz, 1, 0.8);
                    u.aR += (r.a - u.aR) * w; u.eR += (r.e - u.eR) * w; u.sz += (r.ab - u.sz) * w;
                    r = armIK(p, u.cr, fx, fy, fz, -1, 0.8);
                    u.aL += (r.a - u.aL) * w; u.eL += (r.e - u.eL) * w; u.ZL(u.zL + (r.ab - u.zL) * w);
                    u.gL = u.gR = 0.1;
                }
            }
        }

        static string CKofP(double sv) => CKof(sv);

        /// <summary>Drive gather (mode c): two long strides with the plant foot set for the finishing hand, a hop-step with
        /// both feet, or a spin around the defender (root yaw); the ball is ripped to the chest with both hands.</summary>
        static void upGatherPose(Player p, UPV u)
        {
            double kind = Math.Abs(p.gath), dur = kind == 3 ? 0.4 : kind == 2 ? 0.36 : 0.32,
                gg = clamp(p.gathT / dur, 0, 1);
            u.aL = u.aR = 1.15; u.eL = u.eR = 1.75; u.ZL(-0.05); u.sz = -0.05; u.wR = u.wL = -0.3; u.ln = 0.25; u.cr = 0.22;
            if (kind == 2 && gg > 0.4 && gg < 0.8)
            {
                double h = Bump((gg - 0.4) / 0.4);
                u.tL = u.tR = 0.4 * h + 0.1; u.kL = u.kR = 0.5 + 0.6 * h; u.toe += 0.4 * h; u.cr = 0.22 + 0.15 * h;
            }
            else
            {
                double s1 = Bump(gg / 0.5), s2 = Bump((gg - 0.45) / 0.55);
                u.tR = -0.2 + 0.55 * s1 - 0.3 * s2; u.kR = 0.45 + 0.3 * s1;
                u.tL = -0.2 + 0.6 * s2; u.kL = 0.5 + 0.35 * s2; // the plant (left) foot lands last: right-hand finish
            }
            if (kind == 3) p.ry = SS(gg) * 2 * Math.PI * (Util.T(p.gSd) ? p.gSd : 1);
        }
    }
}

namespace Hoops.Core
{
    public partial class Player { public double[] upCs; }
    public static partial class Pose
    {
        /// <summary>UP: the post-blend contact correction (dribble / catch / contest arm IK) rides a critically damped
        /// spring, so an IK branch flip or a contact switching on can't pop the arm (it lands ~2-3 ticks later).</summary>
        public static double upCt(Player p, int i, double target)
        {
            var c = p.upCs ?? (p.upCs = new double[12]);
            const double om = 38;
            c[6 + i] += (om * om * (target - c[i]) - 2 * om * c[6 + i]) * DT;
            c[i] += c[6 + i] * DT;
            return c[i];
        }
    }
}
