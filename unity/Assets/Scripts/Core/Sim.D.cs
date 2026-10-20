// Port of src/core/sim.ts lines 2027-2773: ai (the CPU brain: ball handler, off-ball, transition, defense), helpPlan +
// HPL, the 2-3 zone (ZS / zoneMan), stepLen, celebrate, dribble height (dribTop / dz), free-throw routines (FTCUT /
// ftStyle), held ball (heldBall / HSK / HOLDP / heldZ) and the two-hand dribble (dribHand).
using System;
using System.Collections.Generic;
using static Hoops.Core.Util;
using static Hoops.Core.Data;
using static Hoops.Core.Sim;
using static Hoops.Core.Pose;

namespace Hoops.Core
{
    /// <summary>Help defense plan (sim.ts HPL): t defending team, at tick time, h helper, r rotator, m the man he takes.</summary>
    public sealed class HelpPlanState
    {
        public double t = -1, at = -1;
        public Player h, r, m;
    }

    /// <summary>A 2-3 zone spot (sim.ts ZS).</summary>
    public sealed class ZoneSpot
    {
        public double x, y;
    }

    public partial class Player
    {
        public Input aiIn; // the CPU's own input object (reused every tick)
        public double? man; // forced-switch assignment (P index), valid while manT > 0
    }

    public partial class PlayerAi
    {
        public double rel, r, w, pt, adj, dhoT, holdT, cs, post, pw, fk, j;
        public Player dho, dhoBy, hr;
    }

    public static partial class Sim
    {
        // truthiness of p.off whichever type the owning part chose
        static bool D_on(bool v) => v;
        static bool D_on(double v) => Util.T(v);
        static bool D_ctTm(double t)
        {
            for (int k = 0; k < CT.Count; k++) if (CT[k].tm == t) return true;
            return false;
        }
        static readonly double[] D_K_OU = { 1.35, 1.12, 1, 0.86 }, D_K_CON = { 0.7, 0.9, 1, 1.12 };
        static readonly List<Player> D_RUN = new List<Player>();
        static double D_oh;
        static readonly Comparison<Player> D_RUNCMP = (a, b) => Cmp(Hypot(D_oh - a.x, HY - a.y) - Hypot(D_oh - b.x, HY - b.y));

        // (ai's `ql` / `val` closures as static helpers)
        static double aiQl(Player r, double d) => d < 90 ? r.i : d < 237 ? (r.c + r.i) / 2 : r.c;
        static double aiVal(Player p, Player r, double t, double oh, double D)
        {
            Player o = P[nearest(1 - t, r.x, r.y)];
            double od = Hypot(o.x - r.x, o.y - r.y),
                dd = Hypot(oh - r.x, HY - r.y),
                dx = r.x - p.x,
                dy = r.y - p.y,
                l2 = dx * dx + dy * dy;
            if (!Util.T(l2)) l2 = 1;
            for (int k = 0; k < P.Count; k++)
            {
                var e = P[k];
                if (e.tm != t)
                {
                    double u = clamp(((e.x - p.x) * dx + (e.y - p.y) * dy) / l2, 0, 1);
                    if (Hypot(p.x + dx * u - e.x, p.y + dy * u - e.y) < 14) return -1;
                }
            }
            double star = !D_ctTm(t) && shot < 9 && r == starOf(t) && p != r ? 0.5 : 0,
                kick = D < 130 && dd >= 237 && od > 45 ? 0.25 : 0;
            // feed the mismatch (a switch left a small on the post scorer, or a slow big on a quick guard)
            Player mm = manOf(r);
            double mis = mm != null && !D_on(mm.off) ? (r.i >= 76 && r.ht - mm.ht >= 0.4 && dd < 190 ? 0.3 : 0) + (r.s - mm.s >= 15 && dd < 300 ? 0.12 : 0) : 0;
            return (Math.Min(od, 80) / 80) * 0.6 + (aiQl(r, dd) / 100) * 0.5 + (dd < D ? 0.12 : 0) + (OFFS[(int)t] == r ? 0.45 : 0) + (r.my || isH(r) ? 0.2 : 0) + star + kick + mis;
        }

        public static void ai(Player p, double dt)
        {
            p.br = ""; // (the off-ball branch tag is per tick)
            int NP = cfg.NP;
            var a = p.ai;
            double t = p.tm;
            int ti = (int)t;
            if (p.aiIn == null) p.aiIn = new Input();
            Input i = p.@in = NOIN(p.aiIn);
            bool has = B.owner == p;
            double dh = hoop(1 - t),
                oh = hoop(t);
            if (rs > 0) return;
            if (has)
            {
                if (p.mode == "c")
                {
                    if (p.t >= a.rel) i.su = true;
                    return;
                }
                if (p.mode != "i") return;
                if (cfg.PP >= 2 && pp2Feed(p, i)) return; // (a human teammate called for it)
                Player dn = P[nearest(1 - t, p.x, p.y)];
                double D0 = Hypot(oh - p.x, HY - p.y);
                // step-back: a weapon to create space once the possession has developed (or the clock is running out)
                {
                    double pf0 = clamp((QTRLEN - 30) / 150, 0, 1),
                        el0 = 24 - shot;
                    if (p.cd <= 0 && D0 > 150 && Hypot(dn.x - p.x, dn.y - p.y) < 38 && (el0 > 3 + 8 * pf0 || shot < 8) && Rng.R() < dt * 4 * tendOf(p)[5])
                    {
                        i.sb = true;
                        // (Pro Play v2: a third of them are side-steps, away from the defender's side)
                        if (cfg.PP >= 2 && Rng.R() < 0.35) p.ssq = (dn.x - p.x) * -(HY - p.y) + (dn.y - p.y) * (oh - p.x) >= 0 ? -1 : 1;
                    }
                }
                // the clock is about to run out (quarter or shot clock): get it up from wherever he is - a heave if he must
                if (!isH(p) && p.cd <= 0 && gameLike() && cfg.HALF == 0 && Math.Min(clock, shot) < 1.25 && (D0 < 520 || clock < 1.25))
                {
                    if (D0 > 420) txtW("HEAVE!", p.x, p.y, 90, "#ffd23f");
                    i.sd = true;
                    a.rel = 0.42;
                    a.r = 0;
                    return;
                }
                if (p.sbw > 0 && D0 > 120)
                {
                    i.sd = true;
                    a.rel = (p.st == 1 ? 0.45 : 0.6) + (Rng.R() - 0.5) * 0.16;
                    a.r = 0;
                    return;
                }
                double D = Hypot(oh - p.x, HY - p.y);
                Player md = manOf(p);
                double dirO = oh > 470 ? -1 : 1;
                // transition: a live-ball change of possession and the defense isn't back -> push it, hit the man ahead, finish
                if (NP > 1 && cfg.HALF == 0 && !isH(p) && T - TS.trT[ti] < 4.5)
                {
                    int back0 = 0;
                    Player ahead = null;
                    double av = 0;
                    for (int k = 0; k < P.Count; k++)
                    {
                        var qq = P[k];
                        if (D_on(qq.off)) continue;
                        double dq = Hypot(oh - qq.x, HY - qq.y);
                        if (qq.tm != t && dq < D + 25) back0++; // (level with him counts: he can still get back)
                        if (qq.tm == t && qq != p && dq < D - 80)
                        {
                            Player nd = P[nearest(1 - t, qq.x, qq.y)];
                            double op = Hypot(nd.x - qq.x, nd.y - qq.y),
                                v = op - dq * 0.2;
                            if (op > 40 && v > av) { av = v; ahead = qq; }
                        }
                    }
                    bool adv = back0 <= (NP >= 4 ? 1 : 0) || (back0 == 2 && NP == 5 && ahead != null && T - TS.trT[ti] < 2.5);
                    if (adv)
                    {
                        // (announced once per live-ball change of possession, however often the push stops and restarts)
                        if (!Util.T(TS.tr[ti]) && TS.fbA[ti] != TS.trT[ti])
                        {
                            TS.fbA[ti] = TS.trT[ti];
                            statAdd("fb", 1);
                            txtW(back0 != 0 ? "FAST BREAK" : "OPEN FLOOR", p.x, p.y, 90, "#ffd23f");
                            exc(0.5);
                            cm("break", p.n, back0 != 0 ? "" : "open");
                        }
                        TS.tr[ti] = 1;
                        if (ahead != null && D > 150 && T - LASTP[ti] > 0.5 && Rng.R() < dt * 6)
                        {
                            i.pass = ahead; // hit the man ahead (a lob if he's at the rim)
                            if (Hypot(oh - ahead.x, HY - ahead.y) < 90 && ahead.j >= 60) i.lob = true;
                            return;
                        }
                        if (D < 75 && p.cd <= 0)
                        {
                            i.sd = true;
                            a.rel = 0.45;
                            a.r = 0;
                            return;
                        }
                        mv(p, oh, HY + clamp(p.y - HY, -40, 40) * 0.5, 1);
                        i.sp = true;
                        a.r = 0;
                        return;
                    }
                    if (T - TS.trT[ti] > 1.5) TS.tr[ti] = 0; // the defense got back: run the half-court offense
                }
                else TS.tr[ti] = 0;
                // dribble handoff: a big with the ball out top holds it for a shooter running off him, hands it over at
                // the hip and stays planted as the screen (the defender trailing the shooter runs into him)
                if (NP >= 3 && !isH(p) && cfg.HALF == 0 && !Util.T(TS.tr[ti]) && D > 185 && D < 300 && shot > 7)
                {
                    if (a.dho == null && (p.c < 74 || p.ht >= 6.85) && Rng.R() < dt * 0.7)
                    {
                        Player best = null;
                        double bv0 = 0;
                        for (int k = 0; k < P.Count; k++)
                        {
                            var qq = P[k];
                            if (qq.tm == t && qq != p && !D_on(qq.off) && qq.c >= 74 && !isH(qq))
                            {
                                double v = qq.c - Hypot(qq.x - p.x, qq.y - p.y) * 0.08;
                                if (v > bv0) { bv0 = v; best = qq; }
                            }
                        }
                        if (best != null) { a.dho = best; a.dhoT = T; best.ai.dhoBy = p; }
                    }
                    if (a.dho != null)
                    {
                        Player gg = a.dho;
                        if (T - a.dhoT > 3.5 || gg.tm != t || D_on(gg.off)) { a.dho = null; gg.ai.dhoBy = null; }
                        else
                        {
                            if (Hypot(gg.x - p.x, gg.y - p.y) < 22)
                            {
                                i.pass = gg;
                                gg.ai.dhoBy = null;
                                a.dho = null;
                                a.holdT = T + 0.7; // stay planted: he is the screen now
                                statAdd("dho", 1);
                            }
                            return; // (holds the ball, pivoting, until the shooter arrives)
                        }
                    }
                }
                // catch-and-shoot: just caught a pass with space - shoot it in rhythm (a shooter from deep, anyone from mid-range)
                if (B.pp != null && B.pp.p != p && B.pp.p.tm == t && T - B.pp.t < 0.7 && !Util.T(a.cs) && p.cd <= 0)
                {
                    int pi = P.IndexOf(p);
                    bool ctMe = false;
                    for (int k = 0; k < CT.Count; k++) if (CT[k].tm == t && CT[k].idx == pi) { ctMe = true; break; }
                    if (!ctMe)
                    {
                        a.cs = 1;
                        double od0 = Hypot(dn.x - p.x, dn.y - p.y);
                        bool good = D >= 237 ? p.c >= 70 && D < 295 : D > 90 && p.c + p.i >= 140;
                        if (good && od0 > 36 && Rng.R() < 0.62 + (p.c - 75) / 50)
                        {
                            i.sd = true;
                            a.rel = (p.st == 1 ? 0.45 : 0.6) + (Rng.R() - 0.5) * 0.16;
                            a.r = 0;
                            return;
                        }
                    }
                }
                if (!(B.pp != null && T - B.pp.t < 0.7)) a.cs = 0;
                // in the lane too long: get a shot up
                if (cfg.VIOL != 0 && TS.lane[P.IndexOf(p)] > 2.3 && p.cd <= 0)
                {
                    i.sd = true;
                    a.rel = 0.5;
                    a.r = 0;
                    return;
                }
                // mismatch hunting: post up a smaller defender, or blow by a slower one
                if (!Util.T(a.r) && cfg.NP > 1 && md != null && p.i >= 76 && p.ht - md.ht >= 0.3 && Rng.R() < 0.6) a.post = 1;
                if (Util.T(a.post))
                {
                    a.pw = a.pw + dt;
                    if (D > 175) mv(p, oh + dirO * 70, HY + (p.y < HY ? -45 : 45), 1);
                    else if (D < 70)
                    {
                        // backed him all the way down: go up strong
                        i.sd = true;
                        a.rel = 0.45;
                        a.post = a.pw = 0;
                    }
                    else
                    {
                        i.post = true;
                        if (a.pw > 1.1 && p.cd <= 0)
                        {
                            double r0 = Rng.R();
                            if (r0 < 0.25 && !(p.upu > 0)) i.pf = true; // shoulder fake first
                            else i.mv = r0 < 0.6 ? 1 : r0 < 0.85 ? 3 : 2;
                            if (r0 >= 0.25) { a.post = 0; a.pw = 0; }
                        }
                    }
                    if (a.pw > 2) { a.post = 0; a.pw = 0; i.mv = 1; } // don't sit in the lane: go to the hook
                    return;
                }
                if (!Util.T(a.r) && md != null && p.s - md.s >= 12 && Rng.R() < 0.5) { a.r = 45 + Rng.R() * 30; a.w = 0; a.pt = 0.8; } // attack the slower man
                // down three late: it has to be a three
                if (!Util.T(a.r) && !isH(p) && q >= 4 && bcast() < 24 && sc[1 - ti] - sc[ti] == 3 && cfg.HALF == 0) { a.r = 248 + Rng.R() * 18; a.w = 0; a.pt = 0.8; a.adj = 1; }
                if (!Util.T(a.r))
                {
                    // where does he want his shot? from his tendencies (Curry deep, SGA mid-range, Edwards downhill, Jokic post)
                    double[] td = tendOf(p);
                    double r0 = Rng.R() * (td[0] + td[1] + td[2] + td[3] + 0.15);
                    a.w = 0;
                    a.pt = 0.8;
                    a.adj = 0;
                    if (r0 < td[0] && p.c >= 70) a.r = (p.c >= 90 ? 255 : 240) + Rng.R() * (p.c >= 95 ? 70 : 25);
                    else if (r0 < td[0] + td[1]) a.r = 140 + Rng.R() * 80;
                    else if (r0 < td[0] + td[1] + td[2]) a.r = 40 + Rng.R() * 40;
                    else if (r0 < td[0] + td[1] + td[2] + td[3] && cfg.NP > 1 && p.i >= 70)
                    {
                        a.post = 1;
                        return;
                    }
                    else a.r = p.c < 50 ? 55 + Rng.R() * 40 : 100 + Rng.R() * 130;
                    // two-for-one: ~35 s left in the quarter, get a quick shot up so you get the last possession too
                    if (clock > shot + 4 && clock < shot + 14 && QTRLEN >= 60) a.w = 0.3;
                }
                if (cfg.PP != 0 && upCpuGather(p, D)) return; // (UP: attack the rim with a gather from 9-14 ft)
                if (D > a.r) mv(p, oh, HY + JsMath.Sin(T * 1.5 + p.k) * 90, 1);
                else
                {
                    a.w += dt;
                    i.sp = false;
                    double dd0 = Hypot(dn.x - p.x, dn.y - p.y),
                        closing = (dn.vx * (p.x - dn.x) + dn.vy * (p.y - dn.y)) / (Util.T(dd0) ? dd0 : 1);
                    if (!Util.T(a.fk) && D > 120 && dd0 < 34 && closing > 90 && p.cd <= 0 && Rng.R() < 0.4)
                    {
                        i.pf = true;
                        a.fk = 1;
                        a.w = 0.25;
                        return;
                    }
                    // smothered behind the arc (or he's cold from there): don't force it - jab and go to the pull-up, or drive
                    if (!Util.T(a.adj) && D >= 230 && a.w > 0.3 && p.cd <= 0 && (dd0 < 22 || (p.cold >= 3 && dd0 < 40)) && !isH(p))
                    {
                        a.adj = 1;
                        statAdd("counter", 1);
                        var f3 = form(p, 2);
                        if (dd0 < 22 || f3.pct < 0.3 || Rng.R() < 0.6)
                        {
                            a.w = 0;
                            bool slow = md != null && p.s - md.s >= 4;
                            if (slow || p.i > p.c + 4 || Rng.R() < 0.4) { a.r = 40 + Rng.R() * 40; i.mv = Rng.R() < 0.5 ? (cfg.PP != 0 ? 5 : 1) : 0; } // (UP: in-and-out)
                            else { a.r = 150 + Rng.R() * 60; i.mv = 1; } // hesitation into the elbow pull-up
                            return;
                        }
                    }
                    if (a.fk == 1 && dn.z > 6)
                    {
                        a.fk = 2; // he bit: rise up as he flies by (or drive past him)
                        if (D < 230 || Rng.R() < 0.5) a.r = 40;
                    }
                    // hold for the last shot: close game, game clock under the shot clock -> run it down to ~4 s
                    double diff = sc[ti] - sc[1 - ti];
                    bool hold = !D_ctTm(t) && clock < shot && clock > 4.5 && diff >= -3 && diff <= 2 && !Util.T(PREDICT);
                    if (hold) a.w = Math.Min(a.w, 0.3);
                    // shot quality: a contested look early in the clock -> make the extra pass if someone is open
                    if (!hold && a.w > 0.45 && dd0 < 26 && shot > 6 && D > 90 && PCNT[ti] < 4 && !D_ctTm(t) && T - LASTP[ti] > 0.8)
                    {
                        Player op = null;
                        double ov = 0;
                        for (int k = 0; k < P.Count; k++)
                        {
                            var rr = P[k];
                            if (rr.tm == t && rr != p)
                            {
                                Player nd = P[nearest(1 - t, rr.x, rr.y)];
                                double od = Hypot(nd.x - rr.x, nd.y - rr.y),
                                    rd = Hypot(oh - rr.x, HY - rr.y),
                                    v = od - (rd > 237 ? 100 - rr.c : 100 - rr.i) * 0.6;
                                if (od > 45 && v > ov) { ov = v; op = rr; }
                            }
                        }
                        if (op != null && Rng.R() < 0.6)
                        {
                            i.pass = op;
                            a.r = 0;
                            return;
                        }
                    }
                    // patience (scaled by quarter length): early in the clock only a wide-open look, a shot at the rim or a
                    // transition chance goes up; otherwise work the ball
                    double pf = clamp((QTRLEN - 30) / 150, 0, 1),
                        el = 24 - shot;
                    int back = 0;
                    for (int k = 0; k < P.Count; k++)
                    {
                        var qq = P[k];
                        if (qq.tm != t && !D_on(qq.off) && Hypot(oh - qq.x, HY - qq.y) < D) back++;
                    }
                    double need = el < 1 + 6 * pf ? 58 : el < 2 + 10 * pf ? 40 : 30;
                    bool wait = NP > 1 && back >= Math.Min(3, NP) && D > 75 && dd0 < need && shot > 7 && el < 2 + 14 * pf;
                    // a shooter waiting behind the arc with a step of room lets it fly (it's still a good look)
                    if (wait && D >= 237 && p.c >= 76 && dd0 > 34 && a.w > 0.6 && Rng.R() < dt * 2.5)
                    {
                        a.fk = 0;
                        i.sd = true;
                        a.rel = (p.st == 1 ? 0.45 : 0.6) + (Rng.R() - 0.5) * 0.16;
                        a.r = 0;
                        return;
                    }
                    if (wait)
                    {
                        a.pt = Math.Min(a.pt, 0.15); // look for the extra pass
                        if (a.w > 0.9 && Rng.R() < dt * 1.5) { a.r = 45 + Rng.R() * 40; a.w = 0; } // or attack the basket
                    }
                    if (!hold && !wait && a.w > 0.45 && (dd0 > 30 || shot < 7 || a.w > 1.3))
                    {
                        a.fk = 0;
                        i.sd = true;
                        a.rel = (p.st == 1 ? 0.45 : 0.6) + (Rng.R() - 0.5) * 0.16;
                        a.r = 0;
                    }
                }
                // Use the ball screen: come off the screener's shoulder, away from the trapped defender, toward the rim.
                var pl = PLAY[ti];
                if (pl != null && pl.kind == "pnr" && pl.use == p && (pl.ph == "set" || (pl.ph == "out" && T - pl.setAt < 2.2)))
                {
                    var scr = pl.scr;
                    double dx = scr.x - pl.def.x,
                        dy = scr.y - pl.def.y,
                        dl = Hypot(dx, dy);
                    if (!Util.T(dl)) dl = 1;
                    if (pl.ph == "set") mv(p, scr.x + (dx / dl) * 16 + (oh - scr.x) * 0.08, scr.y + (dy / dl) * 16, 1.15);
                    else mv(p, oh + (oh > 470 ? -90 : 90), HY + (p.y < HY ? -40 : 40), 1.15);
                    i.sp = true;
                }
                // the help just committed to him: read it now (kick it to whoever the rotation gave up)
                if (HPL.h != null && HPL.t != t && a.hr != HPL.h && Hypot(HPL.h.x - p.x, HPL.h.y - p.y) < 55 && !isH(p)) { a.hr = HPL.h; a.pt = Math.Min(a.pt, 0.12 - p.s / 2000); }
                a.pt -= dt;
                if (a.pt < 0)
                {
                    a.pt = 0.5;
                    double own = (Math.Min(Hypot(dn.x - p.x, dn.y - p.y), 80) / 80) * 0.6 + (aiQl(p, D) / 100) * 0.5;
                    double pf2 = clamp((QTRLEN - 30) / 150, 0, 1);
                    Player bo = null;
                    double bv = own + 0.12 + (0.3 - tendOf(p)[4]) * 0.3 - (24 - shot < 12 ? 0.14 * pf2 : 0); // early in the clock: move it
                    for (int k = 0; k < P.Count; k++)
                    {
                        var rr = P[k];
                        if (rr.tm == t && rr != p)
                        {
                            double v = aiVal(p, rr, t, oh, D);
                            if (v > bv)
                            {
                                bv = v;
                                bo = rr;
                            }
                        }
                    }
                    bool prs = Hypot(dn.x - p.x, dn.y - p.y) < 40;
                    // doubled: two defenders on him -> somebody is open, find him (the pass out of the trap)
                    int on2 = 0;
                    for (int k = 0; k < P.Count; k++)
                    {
                        var qq = P[k];
                        if (qq.tm != t && !D_on(qq.off) && Hypot(qq.x - p.x, qq.y - p.y) < 45) on2++;
                    }
                    if (on2 >= 2 && !isH(p) && T - LASTP[ti] > 0.4)
                    {
                        Player ob = null;
                        double ov = 0;
                        for (int k = 0; k < P.Count; k++)
                        {
                            var rr = P[k];
                            if (rr.tm == t && rr != p && !D_on(rr.off))
                            {
                                double v = aiVal(p, rr, t, oh, D);
                                if (v > ov) { ov = v; ob = rr; }
                            }
                        }
                        if (ob != null && Rng.R() < 0.7)
                        {
                            i.pass = ob;
                            return;
                        }
                    }
                    if (
                        bo != null &&
                        PCNT[ti] < 3 + Round(3 * pf2) &&
                        T - LASTP[ti] > 1.1 - 0.4 * pf2 &&
                        Hypot(bo.x - p.x, bo.y - p.y) < 280 &&
                        (Math.Abs(hoop(t) - bo.x) < Math.Abs(hoop(t) - p.x) + 40 || prs || D < 130 || (shot < 9 && bo == starOf(t))) &&
                        Rng.R() < (prs ? 0.8 : 0.5)
                    )
                        i.pass = bo;
                }
                if (p.cd <= 0 && p.s >= 72 && Hypot(dn.x - p.x, dn.y - p.y) < 55 && Rng.R() < dt * 1.4)
                {
                    double r = Rng.R();
                    i.mv = cfg.PP != 0 ? upCpuMove(p, dn, r) : 1 + I(r * 3);
                }
            }
            else if (pos == t && B.mode != "held" && B.to == p) mv(p, B.x + B.vx * 0.2, B.y + B.vy * 0.2, 1);
            else if (pos == t && B.owner != null)
            {
                // the handoff man just gave it up: he is the screen - planted for a beat
                if (p.ai.holdT > T)
                {
                    p.br = "hold";
                    p.setT = 0.1;
                    return;
                }
                // running off a handoff: come at the big from the wing and brush his hip on the way to the top / the middle
                if (p.ai.dhoBy != null && B.owner == p.ai.dhoBy)
                {
                    Player h = p.ai.dhoBy;
                    double sd = p.y < h.y ? -1 : 1,
                        dir = oh > 470 ? -1 : 1;
                    mv(p, h.x + dir * 4, h.y + sd * 9, 1.2);
                    i.sp = true;
                    p.br = "dho";
                    return;
                }
                // transition: fill the lanes - the closest man runs to the rim, two wide to the corners, the last one trails
                if (Util.T(TS.tr[ti]) && B.owner.tm == t && NP > 1 && cfg.HALF == 0)
                {
                    double dir = oh > 470 ? -1 : 1;
                    var run = D_RUN;
                    run.Clear();
                    for (int k = 0; k < P.Count; k++)
                    {
                        var qq = P[k];
                        if (qq.tm == t && qq != B.owner && !D_on(qq.off)) run.Add(qq);
                    }
                    D_oh = oh;
                    SortStable(run, D_RUNCMP);
                    int rk = run.IndexOf(p);
                    // the two wings split the corners (the higher one takes the top side), not both to the same one
                    Player mate = rk == 1 ? (run.Count > 2 ? run[2] : null) : rk == 2 ? run[1] : null;
                    double side = mate != null ? (p.y < mate.y || (p.y == mate.y && rk == 1) ? -1 : 1) : p.y < HY ? -1 : 1;
                    double lx, ly;
                    if (rk == 0) { lx = oh + dir * 22; ly = HY + side * 18; }
                    else if (rk < 3) { lx = oh + dir * 55; ly = HY + side * 195; }
                    else { lx = oh + dir * 245; ly = HY + side * 50; }
                    mv(p, lx, ly, 1.1);
                    if (rk < 3) i.sp = true;
                    p.br = "tr";
                    return;
                }
                p.br = "ob";
                if (offBall(p, t)) return;
                p.br = "SP";
                double[] s = SP[(int)p.k];
                double x = Util.T(t) ? 52.5 + s[0] : 887.5 - s[0];
                Player nd = P[nearest(1 - t, p.x, p.y)];
                mv(p, x + (p.x - nd.x) * 0.35, s[1] + JsMath.Sin(T + p.k * 2) * 18 + (p.y - nd.y) * 0.3, 0.95);
            }
            else if (B.owner != null && Util.T(TS.tr[1 - ti]) && B.owner.tm != t && NP > 1 && cfg.HALF == 0 && !isH(p))
            {
                // transition defense: everybody sprints back; the deepest man protects the rim and stops the ball near it
                int deeper = 0;
                double my = Hypot(dh - p.x, HY - p.y);
                Player h = B.owner;
                double hd = Hypot(dh - h.x, HY - h.y);
                for (int k = 0; k < P.Count; k++)
                {
                    var qq = P[k];
                    if (qq.tm == t && qq != p && !D_on(qq.off) && Hypot(dh - qq.x, HY - qq.y) < my) deeper++;
                }
                double dir = dh > 470 ? -1 : 1;
                if (deeper == 0)
                {
                    if (hd < 130) mv(p, h.x + (dh - h.x) * 0.3, h.y + (HY - h.y) * 0.3, 1.1); // step up and stop the ball
                    else mv(p, dh + dir * 35, HY + (h.y - HY) * 0.25, 1.1);
                }
                else
                {
                    Player o = guardOf(p);
                    mv(p, o.x + (dh - o.x) * 0.25, o.y + (HY - o.y) * 0.25, 1.1);
                }
                i.sp = true;
            }
            else if (B.owner != null)
            {
                bool zone = (TS.ds[ti] == 4 || (TS.ds[ti] == 5 && p != boxCh(t))) && NP == 5 && cfg.HALF == 0; // (box-and-one: four in the zone)
                Player zo = zone ? zoneMan(p, t, dh) : null;
                Player o = zo ?? (p.manT > 0 && p.man != null ? P[(int)p.man.Value] : guardOf(p));
                double ds = TS.ds[ti],
                    od = Hypot(dh - o.x, HY - o.y);
                bool cpu = !D_ctTm(t),
                    hotO = o.heat >= 2 || (o.hzm != null && o.hzm[zoneOf(o, od)] >= 2);
                double ou = (B.owner == o ? 22 : 26) * cpuK(p, D_K_OU) * (cfg.ASTAR != 0 ? 1.6 : 1); // tighter on-ball defense on harder levels (All-Star: nobody plays D)
                if (ds == 1) ou = B.owner == o ? ou + 8 : ou * 1.6; // sag: go under screens, wall off the paint
                else if (ds == 2) ou = B.owner == o ? ou * 0.82 : ou * 0.6; // tight: pressure and deny
                else if (ds == 5 && NP == 5 && !zone) ou *= 0.62; // box-and-one: the chaser face-guards his man everywhere
                if (cpu && cfg.BADGES != 0 && od > 220 && o.c < 72 && B.owner != o) ou += 34; // sag off a non-shooter
                if (cpu && hotO) ou *= 0.78; // stay attached to the hot hand
                // the CPU scouts his man (human or not): where does he score? take that away, give him the other thing
                if (cpu && o.sk != null && cfg.ASTAR == 0)
                {
                    var s = o.sk;
                    double n = s.a[0] + s.a[1] + s.a[2];
                    if (n >= 3)
                    {
                        double p3 = s.a[2] / n,
                            pr = s.a[0] / n,
                            m3 = s.a[2] >= 1.5 ? s.m[2] / s.a[2] : 0.35,
                            mr = s.a[0] >= 1.5 ? s.m[0] / s.a[0] : 0.6;
                        if (od > 200 && (m3 >= 0.45 || (p3 > 0.55 && m3 >= 0.34))) ou *= 0.8; // a shooter: crowd him at the line
                        else if (od > 200 && pr > 0.5 && mr >= 0.55 && m3 < 0.34) ou += B.owner == o ? 10 : 6; // a driver who can't shoot: give him the jumper
                    }
                }
                double l = Util.T(od) ? od : 1;
                helpPlan(t, dh);
                // closeout: my man just caught it and I'm a step (or a rotation) away - sprint at him, then chop the feet
                if (B.owner == o && !zone && Hypot(o.x - p.x, o.y - p.y) > 45 && od < 300 && HPL.h != p && HPL.r != p) i.sp = true;
                Player hb = B.owner;
                double hh = Hypot(dh - hb.x, HY - hb.y);
                var opl = PLAY[1 - ti];
                // guarding the screener in a pick-and-roll (CPU teams; a switch already handed him the ball handler instead)
                bool pnrBig = cpu && !zone && opl != null && opl.kind == "pnr" && opl.scr == o && opl.use == hb && (opl.ph == "set" || (opl.ph == "out" && T - opl.setAt < 1.6)) && ds != 3;
                // doubling the hot hand: the nearest helper (not his own man) traps him as soon as he has it inside 32 ft
                bool trap = false;
                if (cpu && !zone && TS.dbl[ti] >= 0 && P[(int)TS.dbl[ti]] == hb && hh < 320 && o != hb)
                {
                    Player best = null;
                    double bd = 1e9;
                    for (int k = 0; k < P.Count; k++)
                    {
                        var qq = P[k];
                        if (qq.tm == t && !D_on(qq.off) && manOf(hb) != qq)
                        {
                            double d = Hypot(qq.x - hb.x, qq.y - hb.y);
                            if (d < bd) { bd = d; best = qq; }
                        }
                    }
                    trap = best == p && bd < 220;
                }
                if (trap)
                {
                    double lx = hb.y < HY ? 1 : -1; // from the side away from the middle: force him toward the sideline
                    mv(p, hb.x + (dh - hb.x) * 0.06, hb.y + lx * 15, 1.2);
                    i.sp = true;
                    p.hdgT = 0.25; // (arms wide, like a hedge)
                }
                else if (pnrBig)
                {
                    double dir = dh > 470 ? -1 : 1;
                    if (TS.cov[ti] >= 2) tpBig(p, t, o, hb, opl, dh); // ICE / blitz
                    else if (TS.cov[ti] == 1 && (opl.ph == "set" || T - opl.setAt < 0.55))
                    {
                        // hedge: jump out above the screen into the handler's path, then get back to the roller
                        mv(p, hb.x + (dh - hb.x) * 0.12 + (hb.y - HY) * -0.05, hb.y + (HY - hb.y) * 0.12, 1.2);
                        i.sp = true;
                        p.hdgT = 0.25; // (pose: big and wide, arms out to show the handler a wall)
                    }
                    else if (TS.cov[ti] == 1) mv(p, o.x + (dh - o.x) * 0.35, o.y + (HY - o.y) * 0.35, 1.15); // recover
                    else mv(p, dh + dir * 85, HY + (hb.y - HY) * 0.35, 1); // drop: sit at the free-throw line, wall off the drive and the roll
                }
                else if (HPL.h == p && !zone)
                {
                    // help: the driver beat his man - step into his path between him and the rim
                    mv(p, hb.x + (dh - hb.x) * 0.38, hb.y + (HY - hb.y) * 0.38, 1.2);
                    i.sp = true;
                }
                else if (HPL.r == p && !zone && HPL.m != null)
                {
                    // help the helper: sink onto the man the helper left (the one nearest the rim)
                    Player m = HPL.m;
                    double lm = Hypot(dh - m.x, HY - m.y);
                    if (!Util.T(lm)) lm = 1;
                    mv(p, m.x + ((dh - m.x) / lm) * 18, m.y + ((HY - m.y) / lm) * 18, 1.1);
                    i.sp = true;
                }
                else if (!zone && cpu && tpTag(p, t, opl, dh))
                {
                    // (blitz: the low man tags the roller the trap left open)
                }
                else if (zone && hh < 140 && nearest(t, hb.x, hb.y) == ti * NP + (int)p.k) mv(p, hb.x + (dh - hb.x) * 0.35, hb.y + (HY - hb.y) * 0.35, 1.1);
                else if (zone)
                {
                    // zone: guard whoever is in your area, but never leave it (the spot leans toward the ball)
                    double tx = ZS.x,
                        ty = ZS.y;
                    if (zo != null)
                    {
                        double cx = o.x + ((dh - o.x) / l) * Math.Min(ou, 30),
                            cy = o.y + ((HY - o.y) / l) * Math.Min(ou, 30),
                            d = Hypot(cx - ZS.x, cy - ZS.y),
                            k = d > 75 ? 75 / d : 1;
                        tx = ZS.x + (cx - ZS.x) * k;
                        ty = ZS.y + (cy - ZS.y) * k;
                    }
                    mv(p, tx, ty, 0.95);
                }
                else
                {
                    double tx = o.x + ((dh - o.x) / l) * ou,
                        ty = o.y + ((HY - o.y) / l) * ou;
                    // shade the ball handler's favourite drive: a step over to the side he keeps going to (CPU defenders)
                    if (cpu && B.owner == o && Math.Abs(o.drv) > 0.8 && od < 330)
                    {
                        double sh = clamp(o.drv / 3, -1, 1) * 7,
                            ux = (dh - o.x) / l,
                            uy = (HY - o.y) / l;
                        tx += -uy * sh * -1;
                        ty += ux * sh * -1;
                    }
                    // ICE: the handler's man gets over the top of a side pick-and-roll and sends him away from the screen
                    if (cpu && B.owner == o && TS.cov[ti] == 2 && opl != null && opl.kind == "pnr" && opl.use == o && opl.ph != "out" && Math.Abs(o.y - HY) > 60)
                    {
                        double sx = opl.scr.x - o.x,
                            sy = opl.scr.y - o.y,
                            sl = Hypot(sx, sy);
                        if (!Util.T(sl)) sl = 1;
                        tx += (sx / sl) * 12;
                        ty += (sy / sl) * 12;
                        if (!Util.T(opl.ic)) { opl.ic = 1; statAdd("ice", 1); }
                    }
                    // fronting the post: a smaller man on a big who is sealing on the block gets between him and the ball
                    if (cpu && B.owner != o && o.br == "seal" && o.ht - p.ht >= 0.3 && od < 120)
                    {
                        double bl = Hypot(B.x - o.x, B.y - o.y);
                        if (!Util.T(bl)) bl = 1;
                        tx = o.x + ((B.x - o.x) / bl) * 15;
                        ty = o.y + ((B.y - o.y) / bl) * 15;
                        statAdd("front", 1);
                    }
                    if (dh > 470 ? B.x < 470 : B.x > 470) tx = dh > 470 ? Math.Max(tx, 455) : Math.Min(tx, 485);
                    mv(p, tx, ty, 0.92);
                }
                if (Hypot(o.x - p.x, o.y - p.y) < 42 * cpuK(p, D_K_CON) && (o.mode == "c" || o.mode == "s") && p.z <= 0 && !Util.T(a.j))
                {
                    // a shooter who loves the pump fake gets a hand up, not a jump
                    if (Rng.R() < (o.act == 1 ? 0.75 : 0.35)) { p.hupT = 0.7; a.j = 1; }
                    else { a.j = 1; i.sd = true; }
                }
                if (o.mode == "i") a.j = 0;
                if ((dh > 470 ? B.x >= 470 : B.x <= 470) && B.owner == o && Hypot(o.x - p.x, o.y - p.y) < 22 && Rng.R() < dt * 0.7) i.e = true;
            }
            else
            {
                loose(p, t);
            }
        }

        /// <summary>Help defense, solved once per tick for the defending team (man defense, 3+ a side): when the ball
        /// handler has beaten his man on a drive, the defender nearest the driving lane steps up (h); the defender nearest
        /// the man he left rotates onto him (r, m).</summary>
        public static readonly HelpPlanState HPL = new HelpPlanState();
        public static void helpPlan(double t, double dh)
        {
            if (HPL.t == t && HPL.at == T) return;
            HPL.t = t;
            HPL.at = T;
            HPL.h = HPL.r = HPL.m = null;
            Player hb = B.owner;
            if (hb == null || hb.tm == t || cfg.NP < 3 || hb.mode != "i" || cfg.ASTAR != 0 || inb > 0 || ftq != null) return;
            double hh = Hypot(dh - hb.x, HY - hb.y);
            if (hh > 200) return;
            Player on = manOf(hb);
            double od = Hypot(dh - on.x, HY - on.y),
                gap = Hypot(on.x - hb.x, on.y - hb.y),
                sp = Hypot(hb.vx, hb.vy),
                toward = ((dh - hb.x) * hb.vx + (HY - hb.y) * hb.vy) / (Util.T(hh) ? hh : 1);
            if (!((od > hh - 6 || gap > 34) && (toward > 50 || (hh < 120 && sp < 60)))) return;
            double lx = hb.x + (dh - hb.x) * 0.38,
                ly = hb.y + (HY - hb.y) * 0.38;
            Player h = null;
            double hd = 170;
            for (int k = 0; k < P.Count; k++)
            {
                var qq = P[k];
                if (qq.tm == t && !D_on(qq.off) && qq != on && !isH(qq) && qq.z <= 0)
                {
                    double d = Hypot(qq.x - lx, qq.y - ly);
                    if (d < hd) { hd = d; h = qq; }
                }
            }
            if (h == null) return;
            HPL.h = h;
            if (!(h.helpT > 0)) statAdd("help", 1);
            h.helpT = 0.6;
            Player m = h.manT > 0 && h.man != null ? P[(int)h.man.Value] : guardOf(h);
            if (m == null || m == hb || Hypot(dh - m.x, HY - m.y) > 300) return;
            Player r = null;
            double rd = 1e9;
            for (int k = 0; k < P.Count; k++)
            {
                var qq = P[k];
                if (qq.tm == t && !D_on(qq.off) && qq != on && qq != h && !isH(qq))
                {
                    Player own = qq.manT > 0 && qq.man != null ? P[(int)qq.man.Value] : guardOf(qq);
                    // cost: distance to the open man + how dangerous the man I would leave is (a shooter far out is less so)
                    double thr = own != null ? (own.c / 100) * (Hypot(dh - own.x, HY - own.y) < 245 ? 60 : 25) : 0,
                        d = Hypot(qq.x - m.x, qq.y - m.y) + thr;
                    if (d < rd) { rd = d; r = qq; }
                }
            }
            if (r != null && rd < 260 && cpuIQ(t) >= 1) // (a rookie defense never rotates behind the help)
            {
                HPL.r = r;
                HPL.m = m;
                if (!(r.rotT > 0)) statAdd("rot", 1);
                r.rotT = 0.6;
            }
        }

        /// <summary>2-3 zone: the two smallest guard the top, the next two the blocks, the tallest the middle. Each
        /// defender's spot (ZS) shifts toward the ball; he takes the opponent nearest his spot inside his area (the ball
        /// handler first), or nobody (he holds his spot).</summary>
        public static readonly ZoneSpot ZS = new ZoneSpot();
        public static readonly int[] ZR = { 0, 1, 2, 3, 4 };
        public static Player zoneMan(Player p, double t, double dh)
        {
            int NP = cfg.NP;
            int ti = (int)t;
            double dir = dh > 470 ? -1 : 1;
            for (int k = 0; k < NP; k++) ZR[k] = k;
            // ZR.sort((a, b) => P[t*NP+a].ht - P[t*NP+b].ht || a - b) (stable insertion sort, no allocation)
            for (int u = 1; u < ZR.Length; u++)
            {
                int v = ZR[u];
                int w = u - 1;
                while (w >= 0)
                {
                    double c = P[ti * NP + ZR[w]].ht - P[ti * NP + v].ht;
                    if (!Util.T(c)) c = ZR[w] - v;
                    if (c <= 0) break;
                    ZR[w + 1] = ZR[w];
                    w--;
                }
                ZR[w + 1] = v;
            }
            int r = -1;
            for (int k = 0; k < ZR.Length; k++) if (ZR[k] == p.k) { r = k; break; }
            if (TS.ds[ti] == 5)
            {
                // box-and-one: the chaser is out of the zone - the other four make a box
                Player ch = boxCh(t);
                if (ch != null)
                {
                    int rc = -1;
                    for (int k = 0; k < ZR.Length; k++) if (ZR[k] == ch.k) { rc = k; break; }
                    if (rc < r) r--;
                }
            }
            double side = r == 0 || r == 2 ? -1 : 1,
                by = clamp(B.y - HY, -160, 160),
                bx = Math.Abs(B.x - dh);
            // spots: tops ~17 ft out at the elbows, blocks ~4 ft out wide of the lane, the middle under the rim
            double fx = r < 2 ? 165 : r < 4 ? 40 : 30,
                fy = r < 2 ? 62 * side : r < 4 ? 72 * side : 0;
            ZS.x = dh + dir * (fx + (r < 2 ? clamp(bx - 200, -40, 60) * 0.3 : 0));
            ZS.y = HY + fy + by * (r < 2 ? 0.35 : 0.25);
            Player best = null;
            double bd = r < 2 ? 120 : 95;
            for (int k = 0; k < P.Count; k++)
            {
                var qq = P[k];
                if (qq.tm == t || D_on(qq.off)) continue;
                double d = Hypot(qq.x - ZS.x, qq.y - ZS.y) - (B.owner == qq ? 40 : 0);
                if (d < bd) { bd = d; best = qq; }
            }
            return best;
        }

        /// <summary>Step length (px) at a ground speed (px/s): short walking steps up to long sprinting strides (~5.5 ft).</summary>
        public static double stepLen(double sv) => 24 + Math.Min(300, sv) * 0.11;

        /// <summary>Signature celebration after a big bucket (slot 0 three, 1 dunk/and-one, 2 clutch). Arms and torso
        /// only. Drawn by pose3 (CEL in pose.ts); synced to guests in the snapshot.</summary>
        public const double CEL_T = 1.8;
        static readonly double[] CEL_DEF = { 1, 6, 8 };
        public static void celebrate(Player p, int slot)
        {
            if (Util.T(PREDICT)) return;
            double c = p.sg != null && p.sg.ce != null && slot < p.sg.ce.Length ? p.sg.ce[slot] : 0;
            p.cel = Util.T(c) ? c : CEL_DEF[slot];
            p.celT = CEL_T;
        }

        /// <summary>Dribble catch height (px): about hip high, lower when a defender is close, a touch higher at full speed.</summary>
        public static double dribTop(Player o)
        {
            double sp = Hypot(o.vx, o.vy);
            double tight = 0;
            for (int k = 0; k < P.Count; k++)
            {
                var d = P[k];
                if (d.tm != o.tm && Hypot(d.x - o.x, d.y - o.y) < 34) tight = 1;
            }
            // (style: shifty guards keep it low, bigs dribble it high)
            double sty = o.s >= 86 || o.ht <= 6.35 ? -2.5 : o.ht >= 6.9 ? 3 : 0;
            return o.z + o.ht * 5 - tight * 5 + Math.Min(4, sp * 0.015) + sty;
        }

        /// <summary>Live-ball height while dribbling: the hand pushes the ball down, it bounces off the floor and rises
        /// back into the hand, which absorbs it for a moment and pushes again.</summary>
        public static double dz(Player o, double dt)
        {
            double top = dribTop(o),
                sp = Hypot(o.vx, o.vy);
            // (TS: B.dh == null || B.dho !== o; B.dh is always set together with B.dho, so dho decides)
            if (B.dho != o)
            {
                // the first push starts from the hands (a catch at the chest, a triple threat), not from a ball teleported to the hip
                // (TS distinguishes B.dho === null (cleared by bstep) from never set; C# null covers both)
                B.dh = B.dhoNull && B.hold == o ? clamp(B.z, top, top + 22) : top;
                B.dvv = 0;
                B.dhd = 0.08;
                B.dho = o;
                B.dhoNull = false;
                B.fr0 = T;
            }
            B.dtop = top;
            if (B.dhd > 0)
            {
                // in the hand: the catch is cushioned (the hand gives a little upward), then the push
                B.dhd -= dt;
                B.dvv *= JsMath.Exp(-28 * dt);
                B.dh = Math.Min(Math.Max(top + 5, B.dh), B.dh + B.dvv * dt);
                if (B.dhd <= 0) B.dvv = -(165 + sp * 0.4) * (o.s >= 86 ? 1.15 : o.ht >= 6.9 ? 0.9 : 1); // (quick handlers pound it, bigs bounce it)
            }
            else
            {
                B.dvv -= g * dt;
                B.dh += B.dvv * dt;
                if (B.dh < BR)
                {
                    B.dh = BR;
                    B.dvv = Math.Abs(B.dvv) * 0.82; // leather on hardwood
                }
                if (B.dvv > 0 && B.dh >= top - 1)
                {
                    B.dh = top - 1;
                    B.dhd = 0.05 + 0.05 / (1 + sp * 0.01);
                }
            }
            return B.dh;
        }

        /// <summary>Signature free-throw routine (from the name): how long he dribbles before he settles and spins it -
        /// 0 the classic, 1 a few quick ones, 2 a long dribble routine, 3 no dribble at all, just the spin.</summary>
        public static readonly double[] FTCUT = { 1.7, 1.0, 2.5, 0.15 };
        public static double ftStyle(Player o)
        {
            uint h = 7;
            string n = o.n ?? "";
            unchecked
            {
                for (int k = 0; k < n.Length; k++) h = h * 31 + n[k];
            }
            return h % 4;
        }

        /// <summary>Ball held (not dribbled): 1 triple threat at the right hip, 2 pump fake / jab rising toward the
        /// forehead, 3 free-throw routine (holding and spinning it before the shot), 4 chinned rebound.</summary>
        public static double heldBall(Player o)
        {
            if (o.mode != "i" || Util.T(o.postA) || inb > 0) return 0;
            if (o.chinT > 0) return 4;
            if (o.actT > 0 && (o.act == 1 || o.act == 2)) return 2;
            if (ftq != null && ftq.s == o && o.ftT % 3.4 > FTCUT[(int)ftStyle(o)]) return 3;
            if (o.ttT > 0 && Hypot(o.vx, o.vy) < 70 && ftq == null) return 1;
            return 0;
        }
        public static readonly float[] HSK = new float[60];
        public static readonly double[][] HOLDP = {
            new double[] { 0, 0 },
            new double[] { -5, 4 },
            new double[] { 0, 7 },
            new double[] { 0, 8 },
            new double[] { 0, 5 },
        };
        public static double heldZ(Player o)
        {
            double h = heldBall(o),
                hip = o.z + o.ht * 4.9;
            if (h == 2)
            {
                double k = 1 - o.actT / (o.act == 1 ? 0.42 : 0.38),
                    u = JsMath.Sin(Math.Min(1, k) * Math.PI);
                return o.act == 1 ? hip + u * o.ht * 4.2 : hip;
            }
            if (h == 3)
            {
                B.a += 0.25; // spins it in his hands
                return o.z + o.ht * 7.4;
            }
            if (h == 4) return o.z + o.ht * 7.3; // chinned (under the chin, at the top of the chest)

            return hip;
        }

        /// <summary>Two-hand dribble: which hand has it (B.dhn +1 right / -1 left) and the ball's lateral/forward offset
        /// (px; lateral negative = the handler's right). Ball position only - no gameplay.</summary>
        static double dhBase() => -6 * B.dhn;
        static void dhSw(double kind, double dur)
        {
            B.dswf = B.dsw > 0 ? B.dlat : dhBase(); // start from wherever the ball is right now
            B.dhn = -B.dhn;
            B.dsw = dur;
            B.dswd = dur;
            B.dswk = kind;
            B.dcd = 0.75;
        }
        public static (double lat, double fwd) dribHand(Player o, double dt)
        {
            if (B.dho2 != o)
            {
                B.dho2 = o;
                B.dhn = o.sg != null && Util.T(o.sg.lh) ? -1 : 1; // lefties start the dribble in the left hand
                B.dsw = 0;
                B.dcd = 0.4;
                B.dmv = 0;
                B.dsz = 0;
            }
            if (!Util.T(PREDICT))
            {
                B.dcd = Math.Max(0, B.dcd - dt);
                // a new dribble move started this tick
                if (o.mvT > 0 && B.dmv <= 0)
                {
                    if (o.mvk == 3) dhSw(3, 0.26);
                    else if (o.mvk == 2) dhSw(2, 0.34);
                    else if (cfg.PP != 0 && o.mvk >= 5) upDribMove(o);
                    else if (o.mvk != 1 && o.mvk != 4) dhSw(1, 0.2);
                }
                B.dmv = o.mvT;
                if (!(o.mvT > 0) && !(B.dsw > 0) && B.dcd <= 0)
                {
                    Player d = null;
                    double dd = 1e9;
                    for (int k = 0; k < P.Count; k++)
                    {
                        var qq = P[k];
                        if (qq.tm != o.tm)
                        {
                            double e = Hypot(qq.x - o.x, qq.y - o.y);
                            if (e < dd) { dd = e; d = qq; }
                        }
                    }
                    if (d != null && dd < 46)
                    {
                        // defender's side in the handler's frame (+ = right)
                        double rs2 = (d.x - o.x) * JsMath.Sin(o.f) - (d.y - o.y) * JsMath.Cos(o.f),
                            sp = Hypot(o.vx, o.vy);
                        if (Sign(rs2) == B.dhn && Math.Abs(rs2) > 7) dhSw(1, 0.22); // protect: cross away from the defender
                        else if (cfg.PP != 0 && sp < 25 && dd < 60) upSizeUp(o);
                        else if (sp < 25 && dd < 60)
                        {
                            // size-up, by signature package: 0 btb + cross, 1 rapid-fire between-the-legs combos (Curry),
                            // 2 slow, patient crosses (Doncic), 3 hard explosive crosses (Edwards)
                            B.dsz = B.dsz + 1;
                            double dk = o.sg != null ? o.sg.dk : 0;
                            if (dk == 1) { dhSw(Util.T(B.dsz % 3) ? 3 : 1, 0.18); B.dcd = 0.3; }
                            else if (dk == 2) { dhSw(1, 0.32); B.dcd = 0.95; }
                            else if (dk == 3) { dhSw(1, 0.15); B.dcd = 0.6; }
                            else { dhSw(Util.T(B.dsz % 2) ? 3 : 1, Util.T(B.dsz % 2) ? 0.26 : 0.2); B.dcd = 0.55; }
                        }
                    }
                }
            }
            double lat = dhBase(),
                fwd = 6;
            if (B.dsw > 0)
            {
                B.dsw = Math.Max(0, B.dsw - dt);
                double u0 = 1 - B.dsw / (Util.T(B.dswd) ? B.dswd : 0.2),
                    u = u0 * u0 * (3 - 2 * u0),
                    arc = JsMath.Sin(Math.PI * u0);
                double from = B.dswf ?? -lat;
                lat = from + (dhBase() - from) * u;
                if (B.dswk == 3) fwd = 6 - 10 * arc; // through the legs / behind the back
                else if (B.dswk == 2) { fwd = 6 * JsMath.Cos(Math.PI * u0); lat += 5 * arc * B.dhn; } // swung around the hip
                else if (B.dswk >= 5) upDribPath(u0, arc, ref lat, ref fwd, from);
                else fwd = 6 - 1.5 * arc; // crossover: low and tight across the front
            }
            B.dlat = lat;
            return (lat, fwd);
        }
    }
}
