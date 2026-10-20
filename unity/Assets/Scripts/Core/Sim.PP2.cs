// Pro Play v2 (cfg.PP >= 2, v5.4; the TS twin is the "Pro Play v2" block in src/core/sim.ts - same names, same order of
// random draws, so CoreTests/Trace.cs stays bit-identical to the TS).
// Defender reads (a dribble move beats, crosses up or drops a defender - or he reads it - by ratings, his momentum,
// spacing and the move's counter), pull-ups out of a move, shot balance in the green window (off balance / fading / on
// the move / created space), side-steps, post back-down battles by strength (a human defender bodies up with the
// stick), body-ups on drives (a set defender cuts the driver off; a beaten one gets bumped off), block timing (a
// blocker at the top of his jump), charges read from position (set feet, contact square in the chest), off-ball
// humans: call for the ball (pass key), call for a screen (post key away from the post), flick cuts / backdoors.
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
        public double sq = 1, sqn; // jumper balance at the gather: green-window factor and its note (SQN)
        public double beatT = -9; // last time his dribble move beat his man (TS: undefined)
        public double bsd, ssq; // this step-back is a side-step; CPU side-step queued by ai (side)
        public double stillT; // seconds his feet have been set (charges)
        public double cutT = -9; // off-ball flick cut timer (TS: undefined)
        public double pdx, pdy; // last tick's stick (flick detection)
        public double cfbT = -9; // called for the ball at (TS: null)
        public double scrCall = -9; // called for a screen at
        public double fade; // stick-picked jumper: 1 fadeaway, 2 leaner
        public double csB = -9; // catch-and-shoot buffer: shoot pressed (pass on its way) at
        public double coT = -9; // closeout burst timer (TS: undefined)
    }

    public static partial class Sim
    {
        static readonly string[] SQN = { "", "OFF BALANCE", "FADING", "ON THE MOVE", "CREATED SPACE", "FADEAWAY", "LEANER" };

        /// <summary>A dribble move vs the defender in front of him: beaten / crossed up / on the floor, or he reads it.</summary>
        public static void pp2Read(Player p, Player d, double dist, double k, double Sd, double ux, double uy, double D, bool u)
        {
            if (dist >= 60) return;
            double ex = ux / D,
                ey = uy / D,
                rx = d.x - p.x,
                ry = d.y - p.y,
                ahead = rx * ex + ry * ey, // how far he is between the handler and the rim
                dLat = (d.vx * -ey + d.vy * ex) * Sd, // + = already moving the way the move goes
                cl = dist > 1 ? (d.vx * -rx + d.vy * -ry) / dist : 0; // closing speed (- = backpedaling)
            bool set = d.z <= 0 && Hypot(d.vx, d.vy) < 45;
            if (ahead < -4) return; // already past him: nothing to read
            double c = 0.36 + (p.s - d.d) / 250 + (hasB(p, "AB") ? 0.1 : 0) + ((Util.T(p.combo) ? p.combo : 1) - 1) * 0.1 + (1 - d.en) * 0.3 - (1 - p.en) * 0.2;
            if (dLat < -40) c += 0.2; // wrong-footed: he is leaning the other way
            else if (dLat > 60) c -= 0.2; // he is already there
            if (k == 1) c += cl < -30 || cl > 100 ? 0.15 : set ? -0.06 : 0; // hesitation: freezes a retreating or charging man
            else if (k == 2) c += dist < 26 ? 0.15 : dist > 45 ? -0.15 : 0; // spin: off contact, not from range
            else if (k == 3 || k == 5 || k == 6) c += cl > 90 ? 0.12 : 0; // crosses: punish a hard closeout
            if (Util.T(d.stc)) c -= 0.08; // a human down in his stance
            c = clamp(c, 0.05, 0.9);
            double r = Rng.R();
            if (r < c)
            {
                p.beatT = T;
                if (r < c * 0.14 && (dLat < -40 || cl > 120 || p.combo >= 2) && !(d.actT > 0))
                {
                    d.act = 3; // ankles gone: on the floor
                    d.actT = 0.9;
                    d.slow = Math.Max(d.slow, 1.1);
                    upc("ankle");
                    if (u || isH(d)) txtW("ANKLE BREAKER!", d.x, d.y, 95, "#ff6b6b");
                    exc(0.7);
                }
                else if (r < c * 0.6)
                {
                    d.slow = Math.Max(d.slow, 0.7);
                    d.scr = Math.Max(d.scr, 0.35);
                    d.hitT = 0.34; // feet crossed: a sideways stumble
                    d.hitX = -uy * Sd;
                    d.hitY = ux * Sd;
                    upc("stumble");
                    if (u || isH(d)) txtW("CROSSED UP!", d.x, d.y, 95, "#ff6b6b");
                }
                else
                {
                    d.slow = Math.Max(d.slow, 0.45);
                    upc("beat");
                    if (u) txtW("BLOW-BY", d.x, d.y, 95, "#ffd23f");
                }
            }
            else
            {
                // he read it: stays in front, and the handler has to reset before the next move
                p.cd = Math.Max(p.cd, 0.75);
                d.slow = Math.Min(d.slow, 0);
                upc("stayed");
                if (isH(d)) txtW("READ IT!", d.x, d.y, 95, "#7cff9e");
                else if (u) txtW("STAYED IN FRONT", d.x, d.y, 95, "#ff9966");
            }
        }

        /// <summary>Mode i -> c: a shot out of a dribble move is a pull-up (the move ends into it: rhythm); the momentum at the
        /// gather sets the balance of a jumper (p.sq: the green window in winMul; p.sqn: what the meter / release text says).
        /// For a human the stick picks the jumper: away from the rim = a fadeaway, sideways inside the arc = a leaner.</summary>
        public static void pp2Gather(Player p, Input i, double ux, double uy, double D, bool hum)
        {
            p.sq = 1;
            p.sqn = 0;
            p.fade = 0;
            if (p.mvT > 0 && p.mvk != 4)
            {
                double k = p.mvk;
                p.mvT = 0;
                p.mvEnd = T;
                upc("pullUp");
                if (hum) txtW(k == 1 ? "HESI PULL-UP" : k == 7 ? "SNATCH-BACK J" : "PULL-UP", p.x, p.y, 112, "#ffd23f");
            }
            if (p.gath > 0 || D < 90 || ftq != null) return; // (drives, layups and free throws have their own rules)
            double lat = Math.Abs((p.vx * -uy + p.vy * ux) / D),
                fw = (p.vx * ux + p.vy * uy) / D,
                sp = Hypot(p.vx, p.vy);
            if (lat > 170) { p.sq = 0.84; p.sqn = 1; }
            else if (fw < -150 && !(p.sbw > 0)) { p.sq = 0.9; p.sqn = 2; }
            else if (sp > 205) { p.sq = 0.93; p.sqn = 3; }
            else if (T - p.beatT < 0.9) { p.sq = 1.08; p.sqn = 4; }
            if (Util.T(p.sqn)) upc("sq" + p.sqn);
            if (!hum || Util.T(p.postA) || p.fsv != null) return;
            double sl = Hypot(i.dx, i.dy);
            if (sl <= 0.6) return;
            double sf = (i.dx * ux + i.dy * uy) / D / sl,
                sx = (i.dx * -uy + i.dy * ux) / D / sl;
            if (sf < -0.6)
            {
                p.fsv = 2; // fade clip
                p.fade = 1;
                if (p.sqn == 0 || p.sqn == 4) { p.sq = 0.94; p.sqn = 5; }
                upc("fade");
                txtW("FADEAWAY", p.x, p.y, 112, "#ffd23f");
            }
            else if (Math.Abs(sx) > 0.7 && D < 237)
            {
                p.fsv = 20; // leaner clip
                p.fade = 2;
                if (p.sqn == 0 || p.sqn == 4) { p.sq = 0.96; p.sqn = 6; }
                upc("leaner");
                txtW("LEANER", p.x, p.y, 112, "#ffd23f");
            }
        }

        /// <summary>Catch-and-shoot buffer (human): shoot pressed with a chest / bounce pass arriving inside .45 s does not jump -
        /// it is held, and the jumper starts on the catch (pp2CsCatch). A lob still means go up and get it.</summary>
        public static bool pp2CsBuf(Player p, bool hum)
        {
            if (!hum || B.mode != "pass" || B.to != p || B.ptype == 2) return false;
            double hvh = Hypot(B.vx, B.vy), hv = Util.T(hvh) ? hvh : 1;
            if (Hypot(B.x - p.x, B.y - p.y) / hv > 0.45) return false;
            p.csB = T;
            return true;
        }
        public static void pp2CsCatch(Player p, Input i, bool has)
        {
            if (!(p.csB > T - 0.6)) return;
            if (i.su)
            {
                p.csB = -9; // let go before the catch: no shot
                return;
            }
            if (has && p.mode == "i" && pos == p.tm && ftq == null)
            {
                p.csB = -9;
                i.sd = true;
                upc("csBuf");
                txtW("CATCH & SHOOT", p.x, p.y, 100, "#ffd23f");
            }
        }

        /// <summary>Step-back key with the stick held sideways: a side-step (the same hop, across instead of back).</summary>
        public static void pp2SideStep(Player p, Input i, double ux, double uy, double D)
        {
            p.bsd = 0;
            double q = p.ssq, // (a CPU side-step queued by ai: the side)
                sl = Hypot(i.dx, i.dy);
            p.ssq = 0;
            if (Util.T(p.postA) || (!Util.T(q) && sl < 0.5)) return;
            double lat = Util.T(q) ? q : (i.dx * -uy + i.dy * ux) / D / sl;
            if (Math.Abs(lat) < 0.6) return;
            double s = lat > 0 ? 1 : -1;
            p.bx = (-uy / D) * s;
            p.by = (ux / D) * s;
            p.bn = 1;
            p.bsd = 1;
            upc("sideStep");
        }

        /// <summary>Post back-down: strength against strength (size, build, inside / defense ratings; a human defender holding
        /// the stick into him bodies up). The stronger man moves him; a weak post man gets stood up and pushed back.</summary>
        public static void pp2Backdown(Player p, Player d, double nx, double ny)
        {
            bool bu = isH(d) && d.@in != null && d.@in.dx * -nx + d.@in.dy * -ny > 0.5;
            double f = (p.bk * p.ht * (0.75 + p.i / 400)) / (d.bk * d.ht * (0.75 + d.d / 400) * (bu ? 1.25 : 1)),
                pd = f >= 1 ? 3 * f : 3 * f * f,
                po = f < 0.9 ? (0.9 - f) * 12 : 0;
            d.x += nx * pd;
            d.y += ny * pd;
            p.x -= nx * po;
            p.y -= ny * po;
            if (f >= 1) upc("postWin");
            else if (po > 0)
            {
                upc("postHold");
                if (isH(d)) txtW(bu ? "BODIED UP" : "HOLDS HIS GROUND", d.x, d.y, 95, "#7cff9e");
            }
        }

        /// <summary>Drive bump (upTick): a defender set in the driver's path cuts him off - the drive loses the part of its
        /// speed that goes into the defender, by size/strength; a defender who is beaten or moving gets bumped off his line.
        /// This is the contact, so a charge is read here (collide would only see the slowed driver). True = charge whistled.</summary>
        public static bool pp2Bump(Player o, Player d, double nx, double ny, double dd)
        {
            double hx = hoop(o.tm),
                rlh = Hypot(hx - o.x, HY - o.y),
                rl = Util.T(rlh) ? rlh : 1,
                ahead = ((d.x - o.x) * (hx - o.x) + (d.y - o.y) * (HY - o.y)) / rl,
                ds = Hypot(d.vx, d.vy);
            bool set = d.z <= 0 && ahead > 6 && (ds < 120 || (Util.T(d.stc) && ds < 170));
            double f = (o.bk * o.ht * (0.8 + o.s / 500)) / (d.bk * d.ht * (0.8 + d.d / 500) * (Util.T(d.stc) ? 1.15 : 1)),
                vn = o.vx * nx + o.vy * ny;
            if (set)
            {
                if (vn > 170 && fc <= 0 && rs <= 0 && ftq == null && inb <= 0 && cfg.FOULS != 0)
                {
                    fc = 2; // (the contact-foul cooldown, as in collide)
                    if (pp2Charge(d, o, Hypot(d.x - hx, d.y - HY) < 40))
                    {
                        pp2ChargeCall(d, o);
                        return true;
                    }
                }
                double keep = clamp(0.2 + 0.35 * f, 0.25, 0.75);
                if (vn > 0) { o.vx -= nx * vn * (1 - keep); o.vy -= ny * vn * (1 - keep); }
                d.x += nx * 1.2 * f;
                d.y += ny * 1.2 * f;
                upc("cutOff");
                if (isH(d)) txtW("CUT OFF", d.x, d.y, 95, "#7cff9e");
                else if (isH(o)) txtW("BODIED UP", o.x, o.y, 95, "#ff9966");
            }
            else
            {
                o.vx *= 0.93;
                o.vy *= 0.93;
                d.x += nx * 3.5 * f;
                d.y += ny * 3.5 * f;
                d.slow = Math.Max(d.slow, 0.3);
                upc("bumpOff");
                if (isH(o)) txtW("BUMPED HIM OFF", o.x, o.y, 95, "#ffd23f");
            }
            return false;
        }

        /// <summary>Offensive foul on the driver h: the defender o took the charge (same call as collide's).</summary>
        public static void pp2ChargeCall(Player o, Player h)
        {
            txtW("CHARGE!", h.x, h.y, 95, "#ff6b4a");
            o.act = 3; // took the charge: on the floor
            o.actT = 1.2;
            h.cel = 12; // arguing the call
            h.celT = CEL_T;
            tf[(int)h.tm]++;
            h.pf++;
            o.stt.chg++;
            fx(new Fx { k = "whistle", tm = h.tm, hasTm = true });
            cm("charge", o.n, h.n);
            whistle(h, o, 0.55);
            setup(o.tm);
        }

        /// <summary>Block timing: a blocker at the top of his jump gets there; rising early or already coming down, much less.</summary>
        public static double pp2BlkT(Player b) => clamp(1.3 - Math.Abs(b.vz) / 200, 0.55, 1.3);

        /// <summary>Charge or block, read from position: set feet (stillT, from before the contact) outside the restricted area,
        /// hit square in the chest (the driver's facing) by a man driving into it. Draws one number only when possible.</summary>
        public static bool pp2Charge(Player o, Player h, bool ra)
        {
            if (ra || o.z > 4 || Hypot(h.pvx, h.pvy) < 150) return false; // (he must be the one driving into it)
            double dx = o.x - h.x,
                dy = o.y - h.y,
                dlh = Hypot(dx, dy),
                dl = Util.T(dlh) ? dlh : 1,
                fr = (JsMath.Cos(h.f) * dx + JsMath.Sin(h.f) * dy) / dl, // 1 = straight into his chest
                st = o.stillT;
            double pc = 0;
            // (a defender who stepped into him - last tick's velocity toward the driver - is blocking, never a charge)
            if (fr > 0.55 && (o.pvx * -dx + o.pvy * -dy) / dl < 60) pc = st > 0.3 ? 0.72 : st > 0.12 ? 0.45 : 0.15;
            if (pc > 0 && o.helpT > 0) pc += 0.08;
            if (pc > 0) upc("chargeRead");
            return pc > 0 && Rng.R() < pc;
        }

        /// <summary>Blocking-foul odds factor: a defender moving into the driver fouls more, a set one less.</summary>
        public static double pp2BlkK(Player o) => o.stillT > 0.3 ? 0.6 : Hypot(o.vx, o.vy) > 90 ? 1.3 : 1;

        /// <summary>On-ball stance (human): a stick pushed roughly toward the handler's line is bent 30% toward the cut-off
        /// point - a step in front of where he will be in a quarter second.</summary>
        public static void pp2Angle(Player p, Input i, Player o)
        {
            double sl = Hypot(i.dx, i.dy);
            if (sl < 0.3) return;
            double hx = hoop(o.tm),
                rlh = Hypot(hx - o.x, HY - o.y),
                rl = Util.T(rlh) ? rlh : 1,
                ax = o.x + o.vx * 0.25 + ((hx - o.x) / rl) * 22 - p.x,
                ay = o.y + o.vy * 0.25 + ((HY - o.y) / rl) * 22 - p.y,
                al = Hypot(ax, ay);
            if (al < 4 || (i.dx * ax + i.dy * ay) / (sl * al) < 0.3) return;
            double nx = i.dx * 0.7 + (ax / al) * sl * 0.3,
                ny = i.dy * 0.7 + (ay / al) * sl * 0.3,
                nlh = Hypot(nx, ny),
                nl = Util.T(nlh) ? nlh : 1;
            i.dx = (nx / nl) * sl;
            i.dy = (ny / nl) * sl;
        }

        /// <summary>Closeout (human defender): pushing the stick at the ball handler from 45-160 px is a closeout burst.</summary>
        public static void pp2Close(Player p, Input i, bool has)
        {
            var o = B.owner;
            if (has || o == null || o.tm == p.tm || p.mode != "i" || p.z > 0 || p.coT > 0) return;
            double dx = o.x - p.x,
                dy = o.y - p.y,
                d = Hypot(dx, dy),
                sl = Hypot(i.dx, i.dy);
            if (d < 45 || d > 160 || sl < 0.6 || (i.dx * dx + i.dy * dy) / (d * sl) < 0.6 || p.coT > -0.5) return;
            p.coT = 0.5;
            upc("closeout");
        }

        /// <summary>Off the ball on offense (human): the pass key calls for the ball (the CPU handler feeds him if the lane is open).</summary>
        public static bool pp2Call(Player p, bool hum)
        {
            var h = B.owner;
            if (!hum || h == null || h == p || h.tm != p.tm || pos != p.tm) return false;
            p.cfbT = T;
            if (PREDICT == 0)
            {
                p.callT = 0.6; // (the face shouts for it)
                upc("callBall");
                txtW("BALL!", p.x, p.y, 100, "#9fe7ff");
            }
            return true;
        }

        /// <summary>CPU handler: a human teammate who called for it gets it at once when the lane is open (one look per call).</summary>
        public static bool pp2Feed(Player p, Input i)
        {
            double t = p.tm;
            foreach (var r in P)
            {
                if (r.tm != t || r == p || Util.T(r.off) || !(T - r.cfbT < 0.9)) continue;
                if (T - LASTP[(int)t] < 0.3 || Hypot(r.x - p.x, r.y - p.y) > 330) return false;
                double dx = r.x - p.x,
                    dy = r.y - p.y,
                    l2h = dx * dx + dy * dy,
                    l2 = Util.T(l2h) ? l2h : 1;
                foreach (var e in P)
                    if (e.tm != t && !Util.T(e.off))
                    {
                        double u = clamp(((e.x - p.x) * dx + (e.y - p.y) * dy) / l2, 0, 1);
                        if (Hypot(p.x + dx * u - e.x, p.y + dy * u - e.y) < 14)
                        {
                            r.cfbT = -9; // lane closed: he has to get open and call again
                            upc("feedDenied");
                            if (isH(r)) txtW("DENIED", r.x, r.y, 95, "#ff9966");
                            return false;
                        }
                    }
                r.cfbT = -9;
                i.pass = r;
                upc("feed");
                return true;
            }
            return false;
        }

        /// <summary>Post key away from the post (human): with the ball beyond 19 ft it calls a ball screen from the best big; off
        /// the ball it calls a pin-down from the nearest teammate. Once per 2 s.</summary>
        public static void pp2Screen(Player p, bool has, double D)
        {
            double t = p.tm;
            var h = B.owner;
            if (PREDICT != 0 || h == null || h.tm != t || pos != t || T - p.scrCall < 2 || cfg.NP < 2 || (has && D < 190)) return;
            var pl = PLAY[(int)t];
            if (pl != null && pl.use == p && pl.ph != "out") return; // (already coming)
            Player scr = null;
            double bv = -1e9;
            foreach (var q in P)
                if (q.tm == t && q != p && q != h && !Util.T(q.off) && !isH(q))
                {
                    double v = has ? q.ht * q.bk + q.i / 60 - Hypot(q.x - p.x, q.y - p.y) / 200 : -Hypot(q.x - p.x, q.y - p.y);
                    if (v > bv) { bv = v; scr = q; }
                }
            if (scr == null) return;
            p.scrCall = T;
            PLAY[(int)t] = new Play { kind = has ? "pnr" : "pin", t0 = T, scr = scr, use = p, def = manOf(p), ph = "go", sx = 0, sy = 0, setAt = 0 };
            upc("callScreen");
            txtW(has ? "SCREEN!" : "PIN-DOWN!", p.x, p.y, 100, "#9fe7ff");
        }

        /// <summary>Off-ball cut on a stick flick (human, offense, no ball): a burst the way he flicked it; at the rim past a
        /// defender who is denying him (playing the passing lane) it is a backdoor that leaves him a step behind.</summary>
        public static void pp2Cut(Player p, Input i, bool has, double ux, double uy, double D)
        {
            double ox = p.pdx,
                oy = p.pdy,
                pm = Hypot(ox, oy),
                sl = Hypot(i.dx, i.dy);
            p.pdx = i.dx;
            p.pdy = i.dy;
            if (has || pos != p.tm || B.owner == null || B.owner.tm != p.tm || sl < 0.9 || p.mode != "i" || p.z > 0) return;
            // a flick: from a resting stick (or from the other way) to full in one tick
            if (!(pm < 0.3 || (ox * i.dx + oy * i.dy) / (pm * sl) < -0.3)) return;
            if (p.cutT > -0.3) return; // (one per 0.75 s)
            p.cutT = 0.45;
            upc("cut");
            var md = manOf(p);
            double toRim = (i.dx * ux + i.dy * uy) / (D * sl);
            if (PREDICT == 0 && md != null && !Util.T(md.off) && toRim > 0.5)
            {
                // denying: his defender is up the line between him and the ball, not between him and the rim
                double bx = B.x - p.x,
                    by = B.y - p.y,
                    blh = Hypot(bx, by),
                    bl = Util.T(blh) ? blh : 1,
                    mdx = md.x - p.x,
                    mdy = md.y - p.y;
                bool deny = Hypot(mdx, mdy) < 40 && (mdx * bx + mdy * by) / bl > 4 && (mdx * ux + mdy * uy) / D < 8;
                if (deny && Rng.R() < 0.45 + (p.s - md.d) / 200)
                {
                    md.slow = Math.Max(md.slow, 0.5);
                    upc("backdoor");
                    txtW("BACKDOOR!", p.x, p.y, 100, "#ffd23f");
                }
            }
        }
    }
}
