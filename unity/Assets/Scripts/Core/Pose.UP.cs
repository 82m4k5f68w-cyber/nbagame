// Pro Play animation upgrades (cfg.UP = 1 in Unity; shared with the TS pose.ts since v5.4 as cfg.AP = 1), one pose layer called from pose3 before the additive/feet/head
// layers (so the stepping, blending, limits and contact passes all still run after it). Sim side: Sim.UP.cs.
// Shots: gather -> dip -> rise -> set -> release -> follow-through by form (dp/k/ft/gs/lk), catch-and-shoot 1-2 step vs
// hop gather off the dribble, elbow under the ball, leg drive + toe extension, landing knees by jump height, contest
// lean-away, signature forms (Curry one-motion, Durant high release, Jokic push shot, Doncic step-back, Antetokounmpo
// slow set), FT set, layup gathers (plant foot, ball protect, off-arm shield, full reach), floater / sky hook clips.
// Guide hand (upGuide, post-blend): the off palm sits on the side of the ball until the release (damped Gauss-Newton
// on the guide arm against the exact palm FK; tests: CoreTests/GuideHand.cs).
// Moves: in-and-out, crossover, snatch-back with anticipation and settle. Defense: slide hip turn, swipe-down, hand check, contest
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
        /// <summary>This pose layer is on: Unity's cfg.UP, or the shared animation pack cfg.AP (TS pose.ts runs the same code).</summary>
        public static bool upA => cfg.UP != 0 || cfg.AP != 0;
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
        static double Bump(double u) => u <= 0 || u >= 1 ? 0 : JsMath.Sin(u * Math.PI);

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
            // (both hands are on the ball - triple threat, fakes, inbounds: the two-hand IK was solved for this crouch and lean,
            // so the body dips below would pull the palms off the ball)
            bool held = has && md == "i" && (hold != 0 || inb > 0);
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
                        dk = p.t < td ? JsMath.Sin(p.t / td * Math.PI / 2) : 1 - 0.25 * SS((p.t - td) / 0.12); // dip, then a slight rise into the set
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
                        var r1 = armIK(p, u.cr, hx, HY, 108, 1, 0.5, u.ln, u.cx);
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
            else if (md == "i" && p.mvEnd != null && Sim.T - p.mvEnd.Value < 0.3 && !air && !held)
            {
                // follow-through / settle out of the move
                double w = 1 - (Sim.T - p.mvEnd.Value) / 0.3;
                u.cr += 0.1 * w * w; u.ln += 0.05 * w;
            }
            if (md == "i" && p.fsT > 0.22 && !air && !held) { double a = Bump((0.28 - p.fsT) / 0.06); u.cr += 0.08 * a; u.ln -= 0.04 * a; } // counter-dip into the first step
            // ================= landings flow into the next action =================
            if (p.landT > 0 && md == "i" && !air && sp > 80 && !held)
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
                    double lat = (-p.vx * JsMath.Sin(p.f) + p.vy * JsMath.Cos(p.f)) / sp, w = Math.Min(1, sp / 150);
                    u.ty += 0.3 * lat * w; u.hs += 0.08 * lat * w;
                }
                if (p.swpT > 0)
                {
                    double s = 1 - p.swpT / 0.36; // high to low through the ball, no reach-in foul, no steal
                    u.aR = 2.3 - 2.0 * SS(s); u.eR = 0.3; u.sz = 0.25; u.gR = 0.05; u.ln += 0.1 * Bump(s);
                }
                else if (p.hcT > 0)
                {
                    // hand check: the near hand jabs out to the handler's hip and comes straight back (forearm, palm flat)
                    double w = Bump(1 - p.hcT / 0.3);
                    var r = armIK(p, u.cr, ow.x, ow.y, ow.z + ow.ht * 4.6, 0, 0.7, u.ln, u.cx);
                    if (r.right) { u.aR += (r.a - u.aR) * w; u.eR += (Math.Max(0.25, r.e) - u.eR) * w; u.sz += (r.ab - u.sz) * w; u.wR -= 0.4 * w; }
                    else { u.aL += (r.a - u.aL) * w; u.eL += (Math.Max(0.25, r.e) - u.eL) * w; u.ZL(u.zL + (r.ab - u.zL) * w); u.wL -= 0.4 * w; }
                    u.cr += 0.06 * w;
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
                        if (ow == null && sp > 100) { u.aL += (2.2 + 0.5 * JsMath.Sin(Sim.T * 18 + p.k) - u.aL) * w; u.ZL(u.zL + (0.7 - u.zL) * w); } // late: flailing
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
                    double s = (p.setT + 0.45) / 0.45, a = JsMath.Atan2(ow.y - p.y, ow.x - p.x) - p.f;
                    a = JsMath.Atan2(JsMath.Sin(a), JsMath.Cos(a));
                    u.ty += clamp(a, -0.6, 0.6) * Bump(s);
                }
                if (B.mode == "pass" && B.to == p && p.z > 10)
                {
                    // alley-oop catch: both hands up to where the ball is going, one each side
                    double fx = B.x + B.vx * 0.08, fy = B.y + B.vy * 0.08, fz = B.z + B.vz * 0.08,
                        w = clamp(1 - Hypot(fx - p.x, fy - p.y) / 90, 0, 1);
                    var r = armIK(p, u.cr, fx, fy, fz, 1, 0.8, u.ln, u.cx);
                    u.aR += (r.a - u.aR) * w; u.eR += (r.e - u.eR) * w; u.sz += (r.ab - u.sz) * w;
                    r = armIK(p, u.cr, fx, fy, fz, -1, 0.8, u.ln, u.cx);
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
    public partial class Player
    {
        public double gdW, gdV; // guide-hand lock weight (critically damped) and its velocity
        public double[] gdD; // last applied guide-arm correction (a, e, ab) - fades out after the release
        public double[] gdO; // shooting-arm assist offsets (a, e, ab) while the guide hand can't reach the ball
        public double gdErr = -1; // palm-to-ball-surface error left after the solve (px, -1 = not locked this tick)
    }
    public static partial class Pose
    {
        static readonly double[] GDT = new double[3], GDC = new double[3], R0 = new double[3], R1 = new double[3], R2 = new double[3], R3 = new double[3],
            JA = new double[3], JE = new double[3], JZ = new double[3];
        static double Dot(double[] a, double[] b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        /// <summary>Guide palm miss (target GDT - palm) for candidate guide-arm angles; returns its length.</summary>
        static double gdRes(Player p, Q oq, bool mir, double a, double e, double ab, double[] r)
        {
            if (mir) { oq.aR = a; oq.eR = e; oq.sz = ab; } else { oq.aL = a; oq.eL = e; oq.zL = ab; }
            guidePalm(p, oq, GDC);
            r[0] = GDT[0] - GDC[0]; r[1] = GDT[1] - GDC[1]; r[2] = GDT[2] - GDC[2];
            return Math.Sqrt(Dot(r, r));
        }
        /// <summary>Palm point (0, -0.62, 0.1) of the guide (non-shooting) wrist for the current p.q.</summary>
        static void guidePalm(Player p, Q q, double[] o)
        {
            double m = q.mir;
            q.mir = m != 0 ? 0 : 1;
            var h = handPos(p);
            q.mir = m;
            o[0] = h[0]; o[1] = h[1]; o[2] = h[2];
        }

        /// <summary>Damped Gauss-Newton on the guide arm (shoulder raise, elbow, abduction) against the exact palm FK (target
        /// GDT), from a start pose: the nearest arm that puts the palm there (armIK's abduction model only holds for a hanging
        /// arm, and it ignores the torso's lean / twist). Leaves the arm at the start values; returns the best miss (px).</summary>
        static double gdSolve(Player p, Q oq, bool mir, double sa, double se, double sz, int iters, out double ba, out double be, out double bz)
        {
            double xa = sa, xe = clamp(se, 0.05, 2.7), xz = clamp(sz, -1.5, 1.2), best = 1e9;
            ba = xa; be = xe; bz = xz;
            for (int it = 0; it < iters; it++)
            {
                double er = gdRes(p, oq, mir, xa, xe, xz, R0);
                if (er < best) { best = er; ba = xa; be = xe; bz = xz; }
                if (er < 0.03) break;
                const double h = 1e-3;
                gdRes(p, oq, mir, xa + h, xe, xz, R1); gdRes(p, oq, mir, xa, xe + h, xz, R2); gdRes(p, oq, mir, xa, xe, xz + h, R3);
                // J columns = d(palm)/dx = -(dR)/h ; normal equations (J'J + lambda I) dx = J' r
                for (int k = 0; k < 3; k++) { JA[k] = (R0[k] - R1[k]) / h; JE[k] = (R0[k] - R2[k]) / h; JZ[k] = (R0[k] - R3[k]) / h; }
                const double lam = 3;
                double m00 = Dot(JA, JA) + lam, m01 = Dot(JA, JE), m02 = Dot(JA, JZ), m11 = Dot(JE, JE) + lam, m12 = Dot(JE, JZ), m22 = Dot(JZ, JZ) + lam,
                    b0 = Dot(JA, R0), b1 = Dot(JE, R0), b2 = Dot(JZ, R0),
                    det = m00 * (m11 * m22 - m12 * m12) - m01 * (m01 * m22 - m12 * m02) + m02 * (m01 * m12 - m11 * m02);
                if (Math.Abs(det) < 1e-9) break;
                double da = (b0 * (m11 * m22 - m12 * m12) - m01 * (b1 * m22 - m12 * b2) + m02 * (b1 * m12 - m11 * b2)) / det,
                    de = (m00 * (b1 * m22 - m12 * b2) - b0 * (m01 * m22 - m12 * m02) + m02 * (m01 * b2 - b1 * m02)) / det,
                    dz = (m00 * (m11 * b2 - b1 * m12) - m01 * (m01 * b2 - b1 * m02) + b0 * (m01 * m12 - m11 * m02)) / det,
                    sl = Math.Max(Math.Abs(da), Math.Max(Math.Abs(de), Math.Abs(dz)));
                if (sl > 0.5) { da *= 0.5 / sl; de *= 0.5 / sl; dz *= 0.5 / sl; }
                xa += da; xe = clamp(xe + de, 0.05, 2.7); xz = clamp(xz + dz, -1.5, 1.2);
            }
            return best;
        }

        /// <summary>One damped least-squares step of the shooting arm (a, e, ab) that moves the ball centre so the guide palm's
        /// best reachable point lands on its surface; accumulated into the assist offsets o (rate- and size-limited).</summary>
        static void upAssist(Player p, Q oq, bool mir, double ga, double ge, double gz, double cx, double cy, double cz, double[] o)
        {
            gdRes(p, oq, mir, ga, ge, gz, R0); // guide palm at its best -> GDC
            double vx = GDC[0] - cx, vy = GDC[1] - cy, vz = GDC[2] - cz, vl = Math.Sqrt(vx * vx + vy * vy + vz * vz);
            if (vl < 1e-6) return;
            double k = 1 - BR / vl;
            R0[0] = vx * k; R0[1] = vy * k; R0[2] = vz * k; // wanted ball move
            double sa = mir ? oq.aL : oq.aR, se = mir ? oq.eL : oq.eR, ss = mir ? oq.zL : oq.sz;
            const double h = 1e-3;
            for (int j = 0; j < 3; j++)
            {
                double[] J = j == 0 ? JA : j == 1 ? JE : JZ;
                if (mir) { oq.aL = sa + (j == 0 ? h : 0); oq.eL = se + (j == 1 ? h : 0); oq.zL = ss + (j == 2 ? h : 0); }
                else { oq.aR = sa + (j == 0 ? h : 0); oq.eR = se + (j == 1 ? h : 0); oq.sz = ss + (j == 2 ? h : 0); }
                var hp = handPos(p);
                J[0] = (hp[0] - cx) / h; J[1] = (hp[1] - cy) / h; J[2] = (hp[2] - cz) / h;
            }
            if (mir) { oq.aL = sa; oq.eL = se; oq.zL = ss; } else { oq.aR = sa; oq.eR = se; oq.sz = ss; }
            const double lam = 120;
            double m00 = Dot(JA, JA) + lam, m01 = Dot(JA, JE), m02 = Dot(JA, JZ), m11 = Dot(JE, JE) + lam, m12 = Dot(JE, JZ), m22 = Dot(JZ, JZ) + lam,
                b0 = Dot(JA, R0), b1 = Dot(JE, R0), b2 = Dot(JZ, R0),
                det = m00 * (m11 * m22 - m12 * m12) - m01 * (m01 * m22 - m12 * m02) + m02 * (m01 * m12 - m11 * m02);
            if (Math.Abs(det) < 1e-9) return;
            double da = (b0 * (m11 * m22 - m12 * m12) - m01 * (b1 * m22 - m12 * b2) + m02 * (b1 * m12 - m11 * b2)) / det,
                de = (m00 * (b1 * m22 - m12 * b2) - b0 * (m01 * m22 - m12 * m02) + m02 * (m01 * b2 - b1 * m02)) / det,
                dz = (m00 * (m11 * b2 - b1 * m12) - m01 * (m01 * b2 - b1 * m02) + b0 * (m01 * m12 - m11 * m02)) / det;
            o[0] = clamp(o[0] + clamp(da * 0.6, -0.05, 0.05), -0.35, 0.35);
            o[1] = clamp(o[1] + clamp(de * 0.6, -0.05, 0.05), -0.35, 0.35);
            o[2] = clamp(o[2] + clamp(dz * 0.6, -0.05, 0.05), -0.35, 0.35);
        }

        /// <summary>UP guide hand (post-blend, after every other pass): from the set until the release the off hand's palm
        /// sits on the side of the ball (the ball centre is the shooting palm, where the renderers pin it). The contact point
        /// slides continuously from the ball's side toward its underside-back as the ball rises above the guide shoulder (a
        /// set point overhead is out of reach of the side). Warm-started from last tick's solution (smooth, 1-2 steps). The
        /// correction eases in over the gather and rides a critically damped weight, so it fades out after the release
        /// instead of popping.</summary>
        public static void upGuide(Player p, Q oq, string md, bool has)
        {
            var d = p.gdD ?? (p.gdD = new double[6]);
            bool mir = oq.mir != 0;
            int sv = I(Or0(p.sv));
            bool on = has && B.mode == "held" && !Util.T(p.postA)
                && (md == "c" || md == "s" && !Util.T(p.rl) && sv != 10 && sv != 25 && (!IsLaySv(sv) || sv == 11 || sv == 14 || sv == 15) && !(Util.T(p.hk) && sv != 11 && sv != 14 && sv != 15));
            double wt = on ? (md == "c" ? SS(p.t / 0.1) : 1) : 0;
            bool warm = p.gdErr >= 0;
            p.gdErr = -1;
            // shooting-arm assist (pre-release): where the guide arm can't reach the ball, the shooting arm has eased the ball
            // a little toward it (offsets built up below, a few hundredths of a radian per tick); applied with the lock's
            // weight, so it fades out with it after the release
            var o = p.gdO ?? (p.gdO = new double[3]);
            double wa = on ? wt : p.gdW;
            if (wa > 0 && (o[0] != 0 || o[1] != 0 || o[2] != 0))
            {
                if (mir) { oq.aL += o[0] * wa; oq.eL = clamp(oq.eL + o[1] * wa, -0.05, 2.75); oq.zL += o[2] * wa; }
                else { oq.aR += o[0] * wa; oq.eR = clamp(oq.eR + o[1] * wa, -0.05, 2.75); oq.sz += o[2] * wa; }
            }
            if (!on && p.gdW < 0.002) { o[0] = o[1] = o[2] = 0; }
            if (on)
            {
                var c = handPos(p);
                double cx = c[0], cy = c[1], cz = c[2], f = fv(p), fx = JsMath.Cos(f), fy = JsMath.Sin(f), lx = -fy, ly = fx, sd = mir ? -1 : 1,
                    s = p.ht / 6.4,
                    // guide shoulder (approximate: upright chest) and the ball's height above it
                    shx = p.x + lx * sd * RIG.shX * p.bk * s * 10, shy = p.y + ly * sd * RIG.shX * p.bk * s * 10,
                    shz = p.z + (RIG.hip + RIG.chest + RIG.sh) * s * 10 - oq.cr * 4,
                    ux = shx - cx, uy = shy - cy, uz = shz - cz, ul = Math.Max(1e-6, Math.Sqrt(ux * ux + uy * uy + uz * uz)),
                    k = clamp((cz - shz) / 16, 0, 1.4);
                // the side of the ball, a touch behind it (thumb toward the shooter) - the classic guide position
                double nx = lx * sd * 0.97 - fx * 0.2 + k * ux / ul, ny = ly * sd * 0.97 - fy * 0.2 + k * uy / ul, nz = 0.12 + k * uz / ul,
                    nl = Math.Sqrt(nx * nx + ny * ny + nz * nz);
                GDT[0] = cx + nx / nl * BR; GDT[1] = cy + ny / nl * BR; GDT[2] = cz + nz / nl * BR;
                double a0 = mir ? oq.aR : oq.aL, e0 = mir ? oq.eR : oq.eL, z0 = mir ? oq.sz : oq.zL;
                double ba = a0, be = e0, bz = z0, best = 1e9;
                if (warm) best = gdSolve(p, oq, mir, d[3], d[4], d[5], 6, out ba, out be, out bz);
                if (best > 0.3)
                {
                    double best2 = gdSolve(p, oq, mir, a0, e0, z0, 10, out var a2, out var e2, out var z2);
                    if (best2 < best - 0.2) { best = best2; ba = a2; be = e2; bz = z2; }
                }
                // preferred spot out of reach (a set point far across / overhead): settle on the nearest reachable part of the
                // ball's surface instead - re-target to the surface point under the best palm, a couple of rounds
                for (int rr = 0; rr < 3 && best > 0.25; rr++)
                {
                    gdRes(p, oq, mir, ba, be, bz, R0);
                    double px = GDC[0] - cx, py = GDC[1] - cy, pz = GDC[2] - cz, pl = Math.Sqrt(px * px + py * py + pz * pz);
                    if (pl < 1e-6) break;
                    double sdist = Math.Abs(pl - BR);
                    if (sdist < 0.2) { best = sdist; break; }
                    GDT[0] = cx + px / pl * BR; GDT[1] = cy + py / pl * BR; GDT[2] = cz + pz / pl * BR;
                    double b3 = gdSolve(p, oq, mir, ba, be, bz, 6, out var a3, out var e3, out var z3);
                    if (b3 < sdist) { best = b3; ba = a3; be = e3; bz = z3; } else { best = sdist; break; }
                }
                if (best > 0.4) upAssist(p, oq, mir, ba, be, bz, cx, cy, cz, o);
                else for (int j = 0; j < 3; j++) o[j] *= 1 - Math.Min(1, DT * 5); // not needed: leak back to the clip's arm
                if (mir) { oq.aR = a0; oq.eR = e0; oq.sz = z0; } else { oq.aL = a0; oq.eL = e0; oq.zL = z0; }
                if (best < 20)
                {
                    d[0] = wrapPi(ba - a0); d[1] = be - e0; d[2] = bz - z0;
                    d[3] = ba; d[4] = be; d[5] = bz;
                    p.gdErr = best;
                }
                else wt = 0;
            }
            // weight: eased by the gather ramp while on (exact), a critically damped fade once off
            if (on && wt > 0) { p.gdW = wt; p.gdV = 0; }
            else
            {
                const double om = 26;
                p.gdV += (om * om * (0 - p.gdW) - 2 * om * p.gdV) * DT;
                p.gdW = Math.Max(0, p.gdW + p.gdV * DT);
            }
            if (p.gdW < 0.002) { p.gdW = 0; p.gdV = 0; return; }
            double w = p.gdW;
            if (mir) { oq.aR += d[0] * w; oq.eR = clamp(oq.eR + d[1] * w, -0.05, 2.75); oq.sz += d[2] * w; oq.gR = Math.Min(oq.gR, 0.15); }
            else { oq.aL += d[0] * w; oq.eL = clamp(oq.eL + d[1] * w, -0.05, 2.75); oq.zL += d[2] * w; oq.gL = Math.Min(oq.gL, 0.15); }
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

namespace Hoops.Core
{
    public partial class Player
    {
        public double? shV; // per-shot variety draw (set at the gather)
        public string apM; // pose mode at the last apPose (to spot a new gather)
    }
    public static partial class Pose
    {
        /// <summary>Additive head yaw for this tick (a frustrated head shake), consumed by the head layer like HEADX.</summary>
        public static double HEADY = 0;
        /// <summary>Big celebrations that draw a reaction from the players around.</summary>
        static bool bigCel(double c) => c >= 1 && c <= 8 || c == 13 || c == 14;

        /// <summary>Animation pack v5.4 additions (cfg.AP; TS twin apPose in pose.ts, same order): defenders read the fakes,
        /// on-ball bounce, the floor reacts to big plays, shooter frustration, shot-to-shot follow-through variety.</summary>
        public static void apPose(Player p, UPV u, string md, bool has, bool air, double sp)
        {
            var ow = B.owner;
            bool free = md == "i" && !air && !has && !(p.celT > 0) && !Util.T(p.postA) && !(p.setT > 0);
            // ---- defenders read the fakes: a pump fake brings the ones who stayed down up out of their stance; a jab rocks
            //      the man in front back on his heels
            if (ow != null && ow.tm != p.tm && free && (ow.act == 1 || ow.act == 2) && ow.actT > 0)
            {
                double d = Hypot(ow.x - p.x, ow.y - p.y);
                if (d < 75)
                {
                    double prox = clamp((75 - d) / 30, 0, 1);
                    if (ow.act == 1)
                    {
                        double b = Bump((0.42 - ow.actT) / 0.34) * prox * clamp((100 - (Util.T(p.d) ? p.d : 70)) / 40, 0.4, 1);
                        u.cr -= 0.3 * b; u.kL -= 0.3 * b; u.kR -= 0.3 * b; u.toe += 0.3 * b;
                        u.aR += (2.75 - u.aR) * b; u.eR += (0.3 - u.eR) * b; u.aL += (2.1 - u.aL) * b; u.eL += (0.45 - u.eL) * b;
                        u.ln -= 0.12 * b;
                        HEADX -= 0.2 * b; // eyes follow the ball up
                    }
                    else
                    {
                        double b = Bump((0.38 - ow.actT) / 0.32) * prox;
                        u.ln -= 0.2 * b; u.cr += 0.1 * b; u.cx -= 0.06 * b; u.aL -= 0.25 * b; u.aR -= 0.25 * b;
                    }
                }
            }
            // ---- on-ball defender standing his man up: alive on the balls of his feet, a small bounce ----
            if (ow != null && ow.tm != p.tm && free && sp < 25 && u.st == ST.def)
            {
                double d = Hypot(ow.x - p.x, ow.y - p.y);
                if (d < 70)
                {
                    double w = clamp((70 - d) / 25, 0, 1) * (1 - sp / 25);
                    u.cr += 0.04 * (0.5 + 0.5 * JsMath.Sin(Sim.T * 9 + p.k * 1.9)) * w;
                    u.toe += 0.12 * w;
                }
            }
            // ---- the floor reacts to a big play: teammates pump a fist or clap, the other side sags ----
            if (free && sp < 200)
            {
                Player cq = null;
                double cd = 260;
                foreach (var q in P)
                    if (q != p && !Util.T(q.off) && q.celT > 0 && bigCel(q.cel))
                    {
                        double d = Hypot(q.x - p.x, q.y - p.y);
                        if (d < cd) { cd = d; cq = q; }
                    }
                if (cq != null)
                {
                    double e = CEL_T - cq.celT - 0.07 * (p.k % 4),
                        w = clamp(Math.Min(e / 0.3, (cq.celT - 0.2) / 0.4), 0, 1);
                    if (w > 0 && cq.tm == p.tm)
                    {
                        if (p.k % 2 == 0)
                        {
                            double pm = Math.Max(0, JsMath.Sin(e * 11)); // fist pump (twice)
                            u.aR += (1.85 + 0.5 * pm - u.aR) * w; u.eR += (1.95 - 0.55 * pm - u.eR) * w; u.sz += (0.3 - u.sz) * w; u.gR += (1 - u.gR) * w;
                        }
                        else
                        {
                            double cl = Math.Abs(JsMath.Sin(e * 9)); // claps in front of the chest
                            u.aL += (1.3 - u.aL) * w; u.aR += (1.3 - u.aR) * w; u.eL += (1.0 - u.eL) * w; u.eR += (1.0 - u.eR) * w;
                            u.sz += (-0.1 + 0.45 * cl - u.sz) * w; u.ZL(u.zL + (-0.1 + 0.45 * cl - u.zL) * w);
                            u.gL = u.gR = 0.1;
                        }
                    }
                    else if (w > 0)
                    {
                        // deflated: hands on the hips, head drops
                        u.aL += (-0.15 - u.aL) * w; u.aR += (-0.15 - u.aR) * w; u.eL += (1.55 - u.eL) * w; u.eR += (1.55 - u.eR) * w;
                        u.sz += (0.62 - u.sz) * w; u.ZL(u.zL + (0.62 - u.zL) * w); u.hL += (1.25 - u.hL) * w; u.hR += (1.25 - u.hR) * w;
                        HEADX += 0.22 * w;
                    }
                }
            }
            // ---- the shooter after his miss is rebounded: a head shake, a frustrated clap, or both hands to the head ----
            if (free && p.frT > 0.55 && sp < 260)
            {
                double e = 1.8 - p.frT, w = clamp(Math.Min(e / 0.2, (p.frT - 0.55) / 0.3), 0, 1), v = p.k % 3;
                if (v == 0) { HEADY += 0.32 * JsMath.Sin(e * 13) * w; HEADX += 0.2 * w; }
                else if (v == 1)
                {
                    double cl = Bump((e - 0.05) / 0.35);
                    u.aL += (1.2 - u.aL) * w; u.aR += (1.2 - u.aR) * w; u.eL += (1.1 - u.eL) * w; u.eR += (1.1 - u.eR) * w;
                    u.sz += (0.5 - 0.62 * cl - u.sz) * w; u.ZL(u.zL + (0.5 - 0.62 * cl - u.zL) * w);
                    HEADX += 0.15 * w;
                }
                else
                {
                    u.aL += (2.45 - u.aL) * w; u.aR += (2.45 - u.aR) * w; u.eL += (2.2 - u.eL) * w; u.eR += (2.2 - u.eR) * w;
                    u.sz += (0.72 - u.sz) * w; u.ZL(u.zL + (0.72 - u.zL) * w);
                    HEADX -= 0.18 * w;
                }
            }
            // ---- shot-to-shot variety inside each player's form (after the release only: the release point never moves) ----
            if (md == "c" && p.apM != "c") p.shV = ((Math.Floor(Sim.T * 60) * 2654435761.0 + p.k * 40503) % 1000) / 1000;
            if (md == "s" && has && p.shV != null)
            {
                string kind = CKofP(p.sv);
                if (!IsLaySv(I(Or0(p.sv))) && kind != "hang" && kind != "hook" && kind != "sky")
                {
                    double k = upK(p, kind), rk = kind != null && RELK.TryGetValue(kind, out var rr) ? rr : 0.7,
                        post = k > rk ? Math.Min(1, (k - rk) / Math.Max(0.05, 1 - rk)) : 0;
                    if (post > 0)
                    {
                        double v = p.shV.Value, v2 = v * 7 % 1, v3 = v * 13 % 1, kk = SS((k - 0.55) / 0.25) * (0.06 + 0.12 * v3);
                        u.aR += (v - 0.5) * 0.16 * post; u.wR += (v2 - 0.5) * 0.22 * post; u.tR -= kk; u.kR += kk * 1.3;
                    }
                }
            }
            p.apM = md;
        }
    }
}

namespace Hoops.Core
{
    public partial class Player
    {
        public double trY, trV, trS; // hip turn: root yaw offset, its velocity, the side chosen (pose.ts turnRun)
    }
    public static partial class Pose
    {
        /// <summary>Hip turn (cfg.AP; TS twin turnRun): a player backpedaling or sliding faster than a stance allows opens his
        /// hips and runs - the drawn root (p.ry, via fv) turns toward the run while the sim facing, the chest (partly) and the
        /// head stay on the play. Straight back he opens toward the ball. Critically damped spring; held in the air.</summary>
        public static double turnRun(Player p)
        {
            double sp = Hypot(p.vx, p.vy), tgt = 0;
            if (p.z > 1) tgt = p.trY;
            else if (p.mode == "i" && B.owner != p && !Util.T(p.postA) && !(p.setT > 0) && !(p.actT > 0 && (p.act == 3 || p.act == 4)) && sp > 140)
            {
                double rel = wrapPi(JsMath.Atan2(p.vy, p.vx) - p.f), ar = Math.Abs(rel),
                    w = clamp((sp - 150) / 60, 0, 1) * clamp((ar - 1.25) / 0.45, 0, 1);
                if (w > 0)
                {
                    if (ar < 2.2 || (!Util.T(p.trS) && ar < 2.4)) p.trS = rel > 0 ? 1 : -1;
                    else if (!Util.T(p.trS)) p.trS = JsMath.Sin(p.f) * (B.x - p.x) - JsMath.Cos(p.f) * (B.y - p.y) > 0 ? -1 : 1;
                    tgt = p.trS * (ar - 0.55) * w;
                }
            }
            if (tgt == 0 && Math.Abs(p.trY) < 0.05) p.trS = 0;
            const double om = 11;
            p.trV += (om * om * (tgt - p.trY) - 2 * om * p.trV) * DT;
            p.trY += p.trV * DT;
            return p.trY;
        }
    }
}

namespace Hoops.Core
{
    public static partial class Pose
    {
        /// <summary>(AP) A ball holder who has to be on his feet - inbounding, triple threat, fakes, the FT routine: a fall /
        /// dive left over from before he got the ball is not drawn (TS twin upGot).</summary>
        public static bool upGot(Player p)
        {
            if (cfg.AP == 0 || !(p.act == 3 || p.act == 4) || B.owner != p || p.mode != "i") return false;
            double h = heldBall(p);
            return inb > 0 || (h > 0 && h != 4);
        }
    }
}

namespace Hoops.Core
{
    public partial class Player
    {
        public double? rfP, rfX, rfY; // root yaw continuity: last sim facing / position seen by faceLag
        public double rfO, rfV; // facing-snap offset and its velocity
    }
    public static partial class Pose
    {
        /// <summary>Root yaw continuity (AP; TS twin faceLag): more than 0.3 rad of facing change in one tick is drawn as a
        /// quick turn - the excess goes into an offset that decays on a critically damped spring. A teleport resets it.</summary>
        public static double faceLag(Player p)
        {
            bool tele = p.rfX != null && Hypot(p.x - p.rfX.Value, p.y - p.rfY.Value) > 30;
            double df = p.rfP == null || tele ? 0 : wrapPi(p.f - p.rfP.Value);
            p.rfP = p.f; p.rfX = p.x; p.rfY = p.y;
            if (tele) { p.rfO = 0; p.rfV = 0; }
            if (Math.Abs(df) > 0.3) p.rfO = wrapPi(p.rfO - (df - (df > 0 ? 0.3 : -0.3)));
            // (exact critically damped step - stable at any stiffness)
            double om = (p.mode == "c" || p.mode == "s") && B.owner == p ? 30 : 22,
                x = p.rfO, v = p.rfV, j = v + om * x, e = JsMath.Exp(-om * DT);
            p.rfO = (x + j * DT) * e;
            p.rfV = (v - om * j * DT) * e;
            return p.rfO;
        }
    }
}
