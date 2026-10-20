// Port of src/core/sim.ts lines 1555-2026: step (player movement / dribble moves / fakes / shooting state machine),
// mv (steer toward a point), NOIN (clear an input).
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
        public double scr, setT, manT, ttT, chinT, hdgT, drv, upu, ftT, landT, plantT, fsT, hupT, helpT, swT, rotT, engT;
        public double acc, pvx, pvy, mvT, mvE, mvS, mvk, postA, combo, jabX, jabY, bdT, lateJ, react, dcl, brk;
        public double? fsv;
        // (also needs p.frT: double, declared by Pose.Rest.cs)
        public double[] li; // last non-zero stick direction (null = never moved)
        public string br; // debug tag: the off-ball branch that moved him
    }

    public static partial class Sim
    {
        // truthiness of a cfg flag / badge test whichever type the owning part chose (bool or number)
        static bool C_on(bool v) => v;
        static bool C_on(double v) => Util.T(v);
        static bool C_on(double? v) => Util.T(v);

        static readonly string[] MV_TXT = { "", "HESITATION", "SPIN MOVE", "BEHIND THE BACK" };

        public static void step(Player p, double dt)
        {
            Input i = p.@in;
            bool has = B.owner == p;
            double oh = hoop(p.tm),
                ux = oh - p.x,
                uy = HY - p.y,
                Dh = Hypot(ux, uy),
                D = Util.T(Dh) ? Dh : 1;
            bool hum = isH(p);
            double TEMPO = hum ? tempoOf(p) : 0;
            p.cd -= dt;
            p.slow -= dt;
            p.sbw -= dt;
            p.pT = p.pT - dt;
            p.bmp = Math.Max(0, p.bmp - dt * 1.5);
            p.scr = Math.Max(0, p.scr - dt);
            p.setT = p.setT - dt;
            p.manT = p.manT - dt;
            p.hitT = Math.Max(0, p.hitT - dt);
            if (p.frT > 0) p.frT -= dt;
            if (p.celT > 0) p.celT = Math.Max(0, p.celT - dt);
            if (p.actT > 0) p.actT = Math.Max(0, p.actT - dt);
            if (p.ttT > 0) p.ttT = Math.Max(0, p.ttT - dt);
            if (p.chinT > 0) p.chinT = Math.Max(0, p.chinT - dt);
            if (p.hdgT > 0) p.hdgT = Math.Max(0, p.hdgT - dt);
            // scouting the drive: which way does this handler go when he attacks the basket? (+ = his right, decays slowly)
            if (B.owner == p && p.mode == "i" && PREDICT == 0)
            {
                double hx = hoop(p.tm),
                    dx = hx - p.x,
                    dy = HY - p.y,
                    dd = Hypot(dx, dy),
                    svd = Hypot(p.vx, p.vy);
                if (dd < 320 && dd > 60 && svd > 140 && (p.vx * dx + p.vy * dy) / (dd * svd) > 0.5)
                {
                    double side = (p.vx * dy - p.vy * dx) / (dd * svd); // + = drifting to the right of the line to the rim
                    p.drv = Clamp(p.drv * (1 - dt * 0.08) + Sign(side) * dt * (Math.Abs(side) > 0.15 ? 1 : 0), -3, 3);
                }
            }
            if (p.upu > 0) p.upu -= dt;
            if (ftq != null && ftq.s == p && has && p.mode == "i") p.ftT = p.ftT + dt;
            else p.ftT = 0;
            p.landT = Math.Max(0, p.landT - dt);
            if (p.plantT > 0) p.plantT -= dt;
            if (p.fsT > 0) p.fsT -= dt;
            if (p.hupT > 0) p.hupT -= dt;
            if (p.helpT > 0) p.helpT -= dt;
            if (p.swT > 0) p.swT -= dt;
            if (p.rotT > 0) p.rotT -= dt;
            if (p.kickT > 0) p.kickT -= dt;
            if (p.engT > 0) p.engT -= dt;
            {
                // smoothed acceleration along the facing direction (body leans into it)
                double ax = (p.vx - p.pvx) / dt,
                    ay = (p.vy - p.pvy) / dt;
                p.acc = p.acc * 0.85 + (ax * JsMath.Cos(p.f) + ay * JsMath.Sin(p.f)) * 0.15;
                p.pvx = p.vx;
                p.pvy = p.vy;
            }
            {
                double sv2 = Hypot(p.vx, p.vy);
                // sprinting burns the tank fast; running up and down slowly wears everyone down (subs in 5v5); standing recovers
                bool rot = C_on(cfg.SUBS) && cfg.NP > 1 && PREDICT == 0 && cfg.GM == "game";
                double use = i.sp && sv2 > 150 ? 0.1 : rot ? (sv2 > 60 ? sv2 * 0.00013 : -0.01) : -0.04;
                p.en = Math.Max(0, Math.Min(1, p.en - dt * use));
            }
            if (has && p.mode == "i" && p.cd <= 0 && !(p.mvT > 0) && (Util.T(i.dx) || Util.T(i.dy)) && p.li != null && i.dx * p.li[0] + i.dy * p.li[1] < -0.3 && Hypot(p.vx, p.vy) > 110 && (i.dx * ux + i.dy * uy) / D > -0.5 * Hypot(i.dx, i.dy)) // (not a retreat dribble)
            {
                if (!Util.T(i.mv)) i.mv = cfg.PP != 0 ? 6 : 3; // (Pro Play: flick-to-cross is a crossover)
            }
            if (Util.T(i.dx) || Util.T(i.dy))
            {
                if (p.li == null) p.li = new double[2]; // (reused: no per-tick allocation)
                p.li[0] = i.dx;
                p.li[1] = i.dy;
            }
            p.postA = has && i.post && p.mode == "i" && D < 190 && ftq == null && !(p.mvT > 0) ? 1 : 0;
            if (Util.T(p.postA))
            {
                i.dx = (ux / D) * 0.3;
                i.dy = (uy / D) * 0.3;
            }
            if (cfg.PP != 0)
            {
                if (hum && has && p.mode == "i") ppBuffer(p, i);
                ppStance(p, i, has, hum);
                p.spT = hum && i.sp ? p.spT + dt : 0;
                if (cfg.PP >= 2 && hum)
                {
                    if (i.post && !Util.T(p.postA)) pp2Screen(p, has, D); // (post key away from the post: call a screen)
                    pp2Cut(p, i, has, ux, uy, D);
                }
            }
            if (p.mvT > 0)
            {
                p.mvE = p.mvE + dt;
                p.mvT -= dt;
                if (p.mvT <= 0) p.mvEnd = T;
                double e = p.mvE,
                    Sd = Util.T(p.mvS) ? p.mvS : 1,
                    k = p.mvk;
                double f = 0,
                    l = 0;
                if (k == 1)
                {
                    if (e < 0.22) f = 0.05;
                    else
                    {
                        f = 1.5;
                        l = 0.25;
                    }
                }
                else if (k == 2)
                {
                    if (e < 0.15) l = 0.6;
                    else
                    {
                        l = 0.9;
                        f = 0.9;
                    }
                }
                else if (k == 3)
                {
                    if (e < 0.3)
                    {
                        l = 1.3;
                        f = 0.3;
                    }
                    else f = 1.1;
                }
                else if (k >= 5) upMoveVel(k, e, out f, out l);
                else
                {
                    if (e < 0.15)
                    {
                        l = 0.7;
                        f = 0.2;
                    }
                    else
                    {
                        l = 0.2;
                        f = 1.4;
                    }
                }
                i.dx = (ux / D) * f - (uy / D) * l * Sd;
                i.dy = (uy / D) * f + (ux / D) * l * Sd;
                if (p.mvT <= 0 && k == 4 && has)
                {
                    p.hk = 1;
                    i.sd = true;
                    i.su = true;
                }
            }
            else if (Util.T(i.mv) && has && p.mode == "i" && p.cd <= 0 && ftq == null && pos == p.tm)
            {
                Player d = P[(int)nearest(1 - p.tm, p.x, p.y)];
                double dist = Hypot(d.x - p.x, d.y - p.y),
                    Sd = -uy * (p.x - d.x) + ux * (p.y - d.y) >= 0 ? 1 : -1;
                bool u = hum;
                if (Util.T(p.postA))
                {
                    if (i.mv == 2 && p.upu > 0)
                    {
                        p.mvk = 4;
                        p.mvT = 0.45;
                        p.mvE = 0;
                        p.mvS = -Sd; // fake one way, spin back the other
                        p.cd = 0.9;
                        if (PREDICT == 0 && dist < 40)
                        {
                            d.slow = Math.Max(d.slow, 0.9);
                            d.act = 3;
                            d.actT = 0.8;
                        }
                        if (u) txtW("DREAM SHAKE!", p.x, p.y, 100, "#ffd23f");
                    }
                    else if (i.mv == 1)
                    {
                        p.hk = 1;
                        p.fsv = 10; // (UP: sky hook for the tall / skilled, upAfterClip)
                        i.sd = true;
                        i.su = true;
                        if (u) txtW("HOOK", p.x, p.y, 100, "#ffd23f");
                    }
                    else if (i.mv == 3)
                    {
                        p.hk = 1;
                        p.fsv = 2;
                        i.sd = true;
                        i.su = true;
                        if (u) txtW("TURNAROUND", p.x, p.y, 100, "#ffd23f");
                    }
                    else if (i.mv == 2)
                    {
                        p.mvk = 4;
                        p.mvT = 0.48;
                        p.mvE = 0;
                        p.mvS = -Sd; // spin away from the defender's top shoulder, to the baseline
                        p.cd = 0.9;
                        if (PREDICT == 0 && dist < 30 && Rng.R() < 0.45 + (p.s - d.d) / 300) d.slow = Math.Max(d.slow, 0.55);
                        if (u) txtW("POST SPIN", p.x, p.y, 100, "#ffd23f");
                    }
                    else
                    {
                        p.mvk = 4;
                        p.mvT = 0.4;
                        p.mvE = 0;
                        p.mvS = Sd;
                        p.cd = 0.9;
                        if (u) txtW("DROP STEP", p.x, p.y, 100, "#ffd23f");
                    }
                }
                else if (cfg.PP != 0) upMoveStart(p, i, d, dist, Sd, u, ux, uy, D);
                else
                {
                    // chaining moves right off the end of the last one builds a combo: quicker, and harder to stay in front of
                    p.combo = p.mvEnd != null && T - p.mvEnd.Value < 0.5 && p.mvk != i.mv ? Math.Min(4, (Util.T(p.combo) ? p.combo : 1) + 1) : 1;
                    p.mvk = i.mv;
                    p.mvT = p.combo > 1 ? 0.42 : 0.5;
                    p.mvE = 0;
                    p.mvS = Sd;
                    p.cd = 0.55;
                    if (u)
                    {
                        int mi = (int)i.mv;
                        string mt = i.mv == mi && mi >= 0 && mi < MV_TXT.Length ? MV_TXT[mi] : "undefined";
                        txtW(mt + (p.combo > 1 ? " · COMBO x" + p.combo : ""), p.x, p.y, 100, "#ffd23f");
                    }
                    if (PREDICT == 0 && dist < 60 && Rng.R() < 0.5 + (p.s - d.d) / 250 + (C_on(hasB(p, "AB")) ? 0.12 : 0) + (p.combo - 1) * 0.12)
                    {
                        d.slow = Math.Max(d.slow, 0.7);
                        d.scr = Math.Max(d.scr, 0.35);
                        // the defender's feet get crossed up: a hard sideways stumble (pose spring + flailing arms)
                        d.hitT = 0.34;
                        d.hitX = -uy * Sd;
                        d.hitY = ux * Sd;
                        if (u) txtW("ANKLE BREAKER!", d.x, d.y, 95, "#ff6b6b");
                    }
                }
            }

            // a diving or fallen player has no control until he is back up
            if (p.actT > 0 && (p.act == 3 || p.act == 4))
            {
                i.dx = i.dy = 0;
                i.sd = i.su = i.e = i.pf = false;
                i.mv = 0;
                p.vx *= p.act == 4 ? 0.9 : 0.6;
                p.vy *= p.act == 4 ? 0.9 : 0.6;
            }
            if (has && p.mode == "i" && Hypot(p.vx, p.vy) > 70) p.ttT = 0; // leaves the triple threat once he drives
            // Pump fake (no stick) / jab step (stick held) / shoulder fake (posting up). Defenders can bite.
            if (i.pf && has && p.mode == "i" && pos == p.tm && p.cd <= 0 && ftq == null && !(p.mvT > 0))
            {
                Player d = P[(int)nearest(1 - p.tm, p.x, p.y)];
                double dist = Hypot(d.x - p.x, d.y - p.y);
                bool stick = Hypot(i.dx, i.dy) > 0.5;
                p.cd = 0.45;
                if (Util.T(p.postA))
                {
                    p.act = 8; // shoulder fake
                    p.actT = 0.4;
                    p.upu = 1.3; // the next shot / drop step out of the post becomes an up-and-under / dream shake
                    if (PREDICT == 0 && dist < 40 && Rng.R() < 0.55 - d.d / 300)
                    {
                        d.slow = Math.Max(d.slow, 0.6);
                        d.hitT = 0.2;
                        d.hitX = (p.x - d.x) / (Util.T(dist) ? dist : 1);
                        d.hitY = (p.y - d.y) / (Util.T(dist) ? dist : 1);
                    }
                    if (hum) txtW("SHOULDER FAKE", p.x, p.y, 100, "#ffd23f");
                }
                else if (stick && Hypot(p.vx, p.vy) < 70)
                {
                    p.act = 2; // jab step toward the stick
                    p.actT = 0.38;
                    p.jabX = i.dx;
                    p.jabY = i.dy;
                    p.ttT = Math.Max(p.ttT, 0.6);
                    if (PREDICT == 0 && dist < 60 && Rng.R() < 0.6 - d.d / 250)
                    {
                        d.slow = Math.Max(d.slow, 0.45);
                        d.vx += i.dx * 60;
                        d.vy += i.dy * 60;
                    }
                    if (hum) txtW("JAB STEP", p.x, p.y, 100, "#ffd23f");
                }
                else
                {
                    p.act = 1; // pump fake
                    p.actT = 0.42;
                    p.ttT = Math.Max(p.ttT, 0.6);
                    bool bit = false;
                    if (PREDICT == 0)
                        foreach (var o in P)
                            if (o.tm != p.tm && o.z <= 0 && Hypot(o.x - p.x, o.y - p.y) < 55 && Rng.R() < 0.62 - o.d / 260)
                            {
                                o.vz = 126 + o.j * 0.9; // leaves his feet
                                o.slow = Math.Max(o.slow, 0.5);
                                bit = true;
                            }
                    if (hum) txtW(bit ? "PUMP FAKE — BIT!" : "PUMP FAKE", p.x, p.y, 100, "#ffd23f");
                }
                i.sd = false;
            }
            // backing down in the post: shoulder bumps into the defender every ~0.45 s
            if (Util.T(p.postA) && has && PREDICT == 0)
            {
                p.bdT = p.bdT + dt;
                Player d = P[(int)nearest(1 - p.tm, p.x, p.y)];
                double dist = Hypot(d.x - p.x, d.y - p.y);
                if (dist < 22 && p.bdT > 0.45)
                {
                    p.bdT = 0;
                    double nx = (d.x - p.x) / (Util.T(dist) ? dist : 1),
                        ny = (d.y - p.y) / (Util.T(dist) ? dist : 1),
                        f = (p.bk * p.ht) / (d.bk * d.ht);
                    if (cfg.PP >= 2) pp2Backdown(p, d, nx, ny); // (v5.4: strength vs strength)
                    else
                    {
                        d.x += nx * 3 * f;
                        d.y += ny * 3 * f;
                    }
                    d.hitT = 0.16;
                    d.hitX = nx;
                    d.hitY = ny;
                    p.hitT = 0.12;
                    p.hitX = -nx;
                    p.hitY = -ny;
                }
            }
            if (p.mode == "i" && i.sb && has && pos == p.tm && p.cd <= 0 && D > 60)
            {
                p.mode = "b";
                p.t = 0;
                p.bn = p.st == 1 ? 2 : 1;
                p.cd = 1.6;
                p.bx = -ux / D;
                p.by = -uy / D;
                if (cfg.PP >= 2) pp2SideStep(p, i, ux, uy, D); // (stick held sideways: a side-step)
                if (PREDICT == 0)
                {
                    Player d = P[(int)nearest(1 - p.tm, p.x, p.y)];
                    d.slow = 0.5 + 0.25 * p.bn;
                    if (Hypot(d.x - p.x, d.y - p.y) < 30 && Rng.R() < 0.12 + (p.s - d.d) / 400 + (C_on(hasB(p, "AB")) ? 0.12 : 0))
                    {
                        d.act = 3; // lost his footing on the step-back
                        d.actT = 1.0;
                        if (hum) txtW("SHOOK HIM!", d.x, d.y, 95, "#ff6b6b");
                    }
                }
                if (hum) txtW(cfg.PP >= 2 && Util.T(p.bsd) ? "SIDE-STEP!" : p.bn > 1 ? "DOUBLE STEP-BACK!" : "STEP-BACK!", p.x, p.y, 95, "#ffd23f");
            }
            if (p.mode == "b")
            {
                p.t += dt;
                bool m = p.t < 0.17 || (p.bn > 1 && p.t > 0.23 && p.t < 0.4);
                p.vx = m ? p.bx * 190 : 0;
                p.vy = m ? p.by * 190 : 0;
                if (i.sd && p.t > 0.12 && has)
                {
                    p.mode = "c";
                    p.t = 0;
                    p.sbw = 0.9;
                    if (cfg.PP >= 2) { p.sqn = 0; p.fade = 0; } // (a step-back jumper is balanced by definition: its own rhythm)
                }
                else if (p.t >= (p.bn > 1 ? 0.4 : 0.2))
                {
                    p.mode = "i";
                    p.sbw = 0.9;
                    p.vx = p.vy = 0;
                }
            }
            if (cfg.PP >= 2 && hum) pp2CsCatch(p, i, has); // (a shot pressed as the pass arrived goes up on the catch)
            if (p.mode == "i")
            {
                if (i.sd)
                {
                    if (has && pos == p.tm)
                    {
                        p.mode = "c";
                        p.t = 0;
                        if (Util.T(TEMPO)) i.su = true;
                        if (cfg.PP != 0) upGatherStart(p, ux, uy, D);
                        if (cfg.PP >= 2) pp2Gather(p, i, ux, uy, D, hum); // (pull-up out of a move; balance of the jumper; stick-picked fade / leaner)
                    }
                    else if (!has && p.z <= 0 && !(cfg.PP >= 2 && pp2CsBuf(p, hum)))
                    {
                        // (Pro Play v2: not with a pass about to arrive - that press is a catch-and-shoot)
                        p.vz = 126 + p.j * 0.9;
                        // jumping at a shot that's already gone: he lands off balance
                        if (Util.T(B.sh) && B.last != null && B.last.tm != p.tm && B.age > 0.12 && Hypot(B.last.x - p.x, B.last.y - p.y) < 40) p.lateJ = 1;
                    }
                }
                if (has && (i.pass != null || i.e || i.lob))
                {
                    Player r = i.pass ?? pick(p, i);
                    // (a fronted post man - his defender between him and the ball - gets it over the top)
                    bool fronted = false;
                    if (r != null && !isH(p) && r.br == "seal")
                    {
                        Player dm = manOf(r);
                        fronted = dm != null && Hypot(dm.x - r.x, dm.y - r.y) < 24 && Hypot(dm.x - p.x, dm.y - p.y) < Hypot(r.x - p.x, r.y - p.y);
                    }
                    bool astar = C_on(cfg.ASTAR);
                    bool lobIt = !i.lob && !isH(p) && r != null && (fronted || (r.j >= (astar ? 45 : 55) && Hypot(hoop(r.tm) - r.x, HY - r.y) < (astar ? 140 : 100) && Rng.R() < (astar ? 0.92 : 0.6)));
                    if (r != null && PREDICT == 0) pass(p, r, i.lob || lobIt ? 2 : (double?)null);
                }
                else if (i.e && !(cfg.PP >= 2 && pp2Call(p, hum)) && p.cd <= 0)
                {
                    // (Pro Play v2: off the ball on offense the pass key calls for the ball)
                    p.cd = 0.8; // steals are OFF by design (user request): reach-ins do nothing
                }
            }
            if (p.mode == "c")
            {
                p.t += dt;
                if (!(cfg.PP != 0 && upGather(p, i, dt, ux, uy, D, hum)))
                {
                    p.vx *= 0.85;
                    p.vy *= 0.85;
                }
                if (!has) p.mode = "i";
                else if (i.su || p.t > 1.4)
                {
                    p.mt = i.su && i.mt != null ? Clamp(i.mt.Value, p.t - 0.25, p.t + 0.05) : p.t;
                    var cto = contestOf(p);
                    p.cw = Math.Min(1, cto.Item1 + p.bmp * 0.5);
                    if (p.upu > 0 && D < 120 && ftq == null)
                    {
                        p.fsv = 23; // up-and-under: step through for a layup
                        p.hk = 1;
                        p.upu = 0;
                        if (hum) txtW("UP & UNDER", p.x, p.y, 100, "#ffd23f");
                    }
                    p.mode = "s";
                    p.t = 0;
                    p.rl = 0;
                    p.react = 0;
                    p.dcl = 0;
                    bool lay = D < 90 && ftq == null;
                    double k = cfg.PP >= 2 && p.fade == 1 ? 95 : p.st == 2 ? 70 : p.st == 3 ? 110 : 0; // (Pro Play v2: a fadeaway drifts back)
                    bool pro = C_on(cfg.PRO);
                    p.sv = pro
                        ? pickClip(p, D, lay)
                        : lay
                            ? D < 50 && p.j >= 55
                                ? 6
                                : 5
                            : p.st == 2
                                ? 2
                                : p.st == 3
                                    ? 3
                                    : p.st == 4
                                        ? 4
                                        : p.st == 1
                                            ? 1
                                            : 0;
                    if (cfg.PP != 0) { upAfterClip(p, D, lay); ppRelease(p, cto.Item1, cto.Item2, D); }
                    p.tp = null;
                    p.vz = ftq != null ? 60 : ((lay ? 150 : 126) + p.j * 0.9) * (pro && p.st == 1 && !lay ? 0.75 : 1);
                    p.vx = ftq != null ? 0 : lay ? (ux / D) * 100 : pro && p.sv == 8 ? p.vx * 0.5 : (-ux / D) * k;
                    p.vy = ftq != null ? 0 : lay ? (uy / D) * 100 : (-uy / D) * k;
                }
            }
            if (p.mode == "s")
            {
                if (Util.T(TEMPO) && i.sd && p.tp == null && p.t > 0.03) p.tp = i.tp != null ? Clamp(i.tp.Value, p.t - 0.25, p.t + 0.05) : p.t;
                p.t += dt;
                if (!Util.T(p.rl) && has && PREDICT == 0 && !Util.T(p.react) && D >= 90 && ftq == null && p.t > 0.12 && p.t < 0.3)
                {
                    // a defender flying at the shot: double-clutch under it, or hang and wait for him to come down
                    Player fl = null;
                    foreach (var o in P)
                        if (o.tm != p.tm && o.z > 10 && o.vz > 0 && Hypot(o.x - p.x, o.y - p.y) < 28) { fl = o; break; }
                    if (fl != null)
                    {
                        p.react = 1;
                        double r = Rng.R();
                        if (r < 0.35 + p.s / 400)
                        {
                            p.dcl = 0.1; // pull it down and bring it back up
                            if (isH(p) || isH(fl)) txtW("DOUBLE CLUTCH!", p.x, p.y, 120, "#ffd23f");
                        }
                        else if (r < 0.75)
                        {
                            p.vz += 45; // hang time
                            p.dcl = 0.06;
                            if (isH(p) || isH(fl)) txtW("HANGS IN THE AIR", p.x, p.y, 120, "#ffd23f");
                        }
                        else p.react = 2; // rushes it out early
                    }
                }
                double upq = cfg.PP != 0 && !Util.T(p.rl) ? upContest(p, D, has) : 0; // (lean away from a late closeout)
                if (!Util.T(p.rl) && has && PREDICT == 0 && p.t >= (D < 90 ? 0.28 : p.st == 1 ? 0.3 : 0.4) + p.dcl - (p.react == 2 ? 0.05 : 0) + upq) launch(p);
                if (p.t > 0.7 && p.z <= 0)
                {
                    p.mode = "i";
                    p.vx = p.vy = 0;
                    p.hk = 0;
                }
            }
            if (p.mode == "i")
            {
                double sp =
                        (150 + p.s * 1.1) *
                        (p.scr > 0 ? 0.15 : p.slow > 0 ? 0.4 : 1) *
                        (0.75 + 0.25 * p.en) *
                        (has ? 0.96 : 1) *
                        (i.sp ? 1.2 : 1) *
                        (p.z > 0 ? 0.5 : 1) *
                        (Util.T(p.stc) ? 1.08 : 1) * // (Pro Play: a human in his defensive stance slides a little quicker)
                        (p.cutT > 0 ? 1.1 : 1), // (Pro Play v2: an off-ball flick cut)
                    k = Math.Min(1, dt * (p.z > 0 ? 1.5 : 9));
                if (C_on(cfg.PRO) && p.z <= 0)
                {
                    double dx = i.dx * sp - p.vx,
                        dy = i.dy * sp - p.vy,
                        dl = Hypot(dx, dy),
                        cur = Hypot(p.vx, p.vy);
                    bool brk = cur > 40 && dx * p.vx + dy * p.vy < 0,
                        first = p.fsT > 0;
                    double ac = (brk ? (p.plantT > 0 ? 1500 : 1100) : (620 + p.s * 3) * (first ? 1.55 : 1)) * (p.mvT > 0 ? 2.6 : 1) * (Util.T(p.stc) ? 1.3 : p.spT > 0 && p.spT < 0.35 ? 1.35 : 1) * (p.cutT > 0 ? 1.4 : 1) * dt, // (+ stance slides / sprint burst / cut)
                        mm = Math.Min(dl, ac);
                    // a hard cut at speed: plant the outside foot (two-three steps to stop), and sometimes slip
                    if (brk && cur > 170 && !(p.plantT > 0) && !(p.brk > 0.5))
                    {
                        p.plantT = 0.2;
                        if (PREDICT == 0 && cur > 235 && Rng.R() < 0.025 + (78 - p.s) / 1500)
                        {
                            p.hitT = 0.3;
                            p.hitX = p.vx / cur;
                            p.hitY = p.vy / cur;
                            p.slow = Math.Max(p.slow, 0.35);
                            if (isH(p)) txtW("SLIPPED!", p.x, p.y, 90, "#ff9966");
                        }
                    }
                    // explosive first step out of a standstill
                    if (cur < 35 && Hypot(i.dx, i.dy) > 0.6) p.fsT = 0.28;
                    if (dl > 0)
                    {
                        p.vx += (dx / dl) * mm;
                        p.vy += (dy / dl) * mm;
                    }
                    p.brk = brk ? 1 : Math.Max(0, p.brk - dt * 4);
                }
                else
                {
                    p.vx += (i.dx * sp - p.vx) * k;
                    p.vy += (i.dy * sp - p.vy) * k;
                }
            }
            p.x = Clamp(p.x + p.vx * dt, 8, CW - 8);
            p.y = Clamp(p.y + p.vy * dt, 8, CH - 8);
            double sv = Hypot(p.vx, p.vy);
            p.ph += ((sv * dt) / stepLen(sv)) * Math.PI; // one step = half a gait cycle, so the feet travel with the body
            if (p.mode != "i") p.f = JsMath.Atan2(uy, ux);
            else
            {
                double? tf = null;
                if (pos != p.tm && B.owner != null) tf = JsMath.Atan2(B.y - p.y, B.x - p.x);
                else if (has) tf = sv > 1 && (p.vx * ux + p.vy * uy) / D < -0.3 * sv ? JsMath.Atan2(uy, ux) /* (sv > 1: not on float noise) */ : sv > 20 ? JsMath.Atan2(p.vy, p.vx) : (double?)null;
                else tf = sv > 150 ? JsMath.Atan2(p.vy, p.vx) : JsMath.Atan2(B.y - p.y, B.x - p.x);
                if (tf != null)
                {
                    double dd = JsMath.Atan2(JsMath.Sin(tf.Value - p.f), JsMath.Cos(tf.Value - p.f));
                    p.f += dd * Math.Min(1, dt * 10);
                }
            }
            if (Util.T(p.postA)) p.f = JsMath.Atan2(-uy, -ux);
            if (p.hangT > 0)
            {
                // hanging on the rim after a dunk: hands on the iron, body under the front of the rim
                p.hangT -= dt;
                if (p.hangT < 0.42 && IsDunkSv((int)p.sv)) p.sv = 19;
                double hx = hoop(p.tm),
                    dir = hx > 470 ? 1 : -1;
                p.x += (hx - dir * 9 - p.x) * Math.Min(1, dt * 12);
                p.y += (HY - p.y) * Math.Min(1, dt * 12);
                p.z = Math.Max(p.z, 100 - (75 * p.ht) / 6.4);
                p.vx = p.vy = 0;
                p.vz = 0;
                p.f = dir > 0 ? 0 : Math.PI;
                if (p.hangT <= 0) p.vz = -10; // let go
            }
            else if (p.z > 0 || p.vz > 0)
            {
                p.vz -= g * dt;
                p.z += p.vz * dt;
                if (p.z <= 0)
                {
                    if (cfg.PP != 0) upLanding(p);
                    else if (p.vz < -120) p.landT = Math.Min(0.28, -p.vz / 900); // absorb the landing
                    if (Util.T(p.lateJ) && PREDICT == 0)
                    {
                        p.lateJ = 0;
                        double dh = Hypot(p.vx, p.vy), d = Util.T(dh) ? dh : 1;
                        p.hitT = 0.28;
                        double hxv = p.vx / d, hyv = p.vy / d;
                        p.hitX = Util.T(hxv) ? hxv : JsMath.Cos(p.f);
                        p.hitY = Util.T(hyv) ? hyv : JsMath.Sin(p.f);
                        p.slow = Math.Max(p.slow, 0.45);
                    }
                    p.z = 0;
                    p.vz = 0;
                }
            }
        }

        public static void mv(Player p, double tx, double ty, double s = 1)
        {
            double dx = tx - p.x,
                dy = ty - p.y,
                d = Hypot(dx, dy);
            if (d > 6)
            {
                p.@in.dx = (dx / d) * Math.Min(1, d / 30) * s;
                p.@in.dy = (dy / d) * Math.Min(1, d / 30) * s;
            }
        }

        public static Input NOIN(Input o)
        {
            o.dx = o.dy = 0;
            o.sd = o.su = o.e = o.sb = o.post = o.lob = o.sp = o.sw = false;
            o.mv = 0;
            o.pass = null;
            o.mt = o.tp = null;
            return o;
        }
    }
}
