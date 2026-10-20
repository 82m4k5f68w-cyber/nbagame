// Port of the sim.ts "Team play pack (v5.4)" block: coach IQ (cpuIQ), box-and-one (boxTarget / boxCh), named sets
// (tpSet: horns, Spain pick-and-roll, stagger, zipper, post entry, ATO / end-of-quarter calls) and their movement
// (tpSpot / tpUse / tpS2), ICE / blitz pick-and-roll coverage (tpBig) and the blitz rotation (tpTag).
// Same names, same order of random draws as the TS. Per-tick paths allocate nothing.
using System;
using System.Collections.Generic;
using static Hoops.Core.Util;
using static Hoops.Core.Data;
using static Hoops.Core.Sim;
using static Hoops.Core.Pose;

namespace Hoops.Core
{
    public sealed partial class TeamState
    {
        public double[] ato = { 0, 0 }; // a CPU coach drew up a play in the timeout: the next set is his ATO call
        public double[] l2 = { 0, 0 }; // team fouls in the last two (broadcast) minutes of this period
        public double[] bon = { 0, 0 }; // in the bonus this period (announced once)
        public double[] box = { -1, -1 }; // box-and-one: the opponent (P index) the chaser follows (-1 = their top scorer)
        public double[] cls = { 0, 0 }; // the closing lineup has been announced
        public double[] setN = { 0, 0 }; // named sets run (commentary every few)
    }

    public sealed partial class Play
    {
        public string v; // null | horns | spain (pnr) | stagger | zip | post (pin)
        public Player s2; // second big (horns), back-screener (spain), second stagger screener
        public double sd, st, stT, pop, ato, fed, ic, bl, cal, fa;
        public string nm; // set name (HUD / commentary)
    }

    public partial class Player
    {
        public double ftS; // sat down in foul trouble (comes back when it clears)
    }

    public sealed class TagState
    {
        public double t = -1, at = -1;
        public Player tag;
    }

    public static partial class Sim
    {
        static bool TP_v(Play pl) => !string.IsNullOrEmpty(pl.v);
        static bool TP_on(double v) => Util.T(v);

        /// <summary>CPU basketball IQ 0..3 (Rookie .. Hall of Fame = cfg.DIFF) for a team with no human on it; a human's
        /// AI teammates play at All-Star level (2).</summary>
        public static double cpuIQ(double t) => ctHas(t) ? 2 : clamp(cfg.DIFF, 0, 3);

        /// <summary>Box-and-one target for team t's defense: the one opponent on fire from outside who carries their
        /// offense (35%+ of their points, 12+ scored) while nobody else is hot; -1 = none.</summary>
        public static int boxTarget(double tt)
        {
            int t = (int)tt;
            if (cfg.NP != 5 || cfg.ASTAR != 0 || cfg.HALF != 0) return -1;
            int bi = -1, n = 0;
            for (int j = 0; j < 5; j++)
            {
                var q = P[(1 - t) * 5 + j];
                if (q.heat >= 3)
                {
                    n++;
                    if (q.c >= 78 && sc[1 - t] >= 12 && q.stt.pts >= 0.35 * sc[1 - t]) bi = (1 - t) * 5 + j;
                }
            }
            return n == 1 ? bi : -1;
        }

        /// <summary>The box-and-one chaser of team t: whoever guards the target (TS.box; their top scorer otherwise).</summary>
        public static Player boxCh(double tt)
        {
            int t = (int)tt;
            Player s = TS.box[t] >= 0 ? P[(int)TS.box[t]] : null;
            if (s == null || s.tm == t)
            {
                s = null;
                foreach (var q in P) if (q.tm != t && !TP_on(q.off) && (s == null || q.stt.pts > s.stt.pts)) s = q;
            }
            return s != null ? manOf(s) : null;
        }

        static Play TP_mk(double t, Player h, string kind, string v, Player scr, Player use, Player x2, string nm, double ato = 0)
        {
            int ti = (int)t;
            statAdd("set_" + v, 1);
            if (ato == 1 || TS.setN[ti]++ % 3 == 0) cm(ato == 1 ? "ato" : "set", cl[ti], nm.ToLowerInvariant());
            if (ato == 1) txtW(nm, use.x, use.y, 110, "#9fe7ff");
            // a CPU handler runs the play: a beat more patience before he looks for his own shot
            if (!ctHas(t) && Util.T(h.ai.r)) h.ai.w = Math.Min(h.ai.w, v == "spain" ? -0.8 : -0.5);
            return new Play { kind = kind, v = v, t0 = T, scr = scr, use = use, def = manOf(use), ph = "go", sx = 0, sy = 0, setAt = 0, s2 = x2, sd = (v == "post" ? h.y : use.y) < HY ? -1 : 1, st = 0, stT = T, nm = nm, ato = ato };
        }

        static string TP_N(Player q) => q.n.ToUpperInvariant();

        /// <summary>Named sets (3+ a side) on top of the three base actions (sim.ts tpSet). null = the base play.</summary>
        public static Play tpSet(double t, Player h, List<Player> ms, Player big, Player sh, double pc)
        {
            if (cfg.NP < 3 || pc == 4) return null;
            int ti = (int)t;
            bool cpu = !ctHas(t);
            double lv = cpuIQ(t);
            // personnel: a second big, a shooter to back-screen, a post scorer, the cross-screener (smallest), the star
            Player b2 = null, s2 = null, pm = null;
            foreach (var q in ms)
            {
                if (q != big && q.ht >= 6.75 && (b2 == null || q.ht * q.bk > b2.ht * b2.bk)) b2 = q;
                if (q != big && q.c >= 76 && (s2 == null || q.c > s2.c)) s2 = q;
                if (q.i >= 80 && q.ht >= 6.7 && (pm == null || q.i > pm.i)) pm = q;
            }
            Player cs = null;
            foreach (var q in ms) if (q != pm && (cs == null || q.ht < cs.ht)) cs = q;
            Player star = starOf(t);
            // the human's play calls
            if (pc == 5) return b2 != null ? TP_mk(t, h, "pnr", "horns", big, h, b2, "HORNS") : null;
            if (pc == 6) return s2 != null ? TP_mk(t, h, "pnr", "spain", big, h, s2, "SPAIN PICK & ROLL") : null;
            if (pc == 7) return pm != null && cs != null ? TP_mk(t, h, "pin", "post", cs, pm, null, "POST UP " + TP_N(pm)) : null;
            if ((!cpu && Util.T(pc)) || lv < 1 || Hypot(hoop(t) - h.x, HY - h.y) > 330) return null; // (sets start in the half court)
            // after a timeout: the coach's best action for his star
            if (cpu && Util.T(TS.ato[ti]))
            {
                TS.ato[ti] = 0;
                statAdd("ato", 1);
                if (star == h)
                {
                    if (lv >= 2 && s2 != null) return TP_mk(t, h, "pnr", "spain", big, h, s2, "ATO: SPAIN FOR " + TP_N(star), 1);
                    if (b2 != null) return TP_mk(t, h, "pnr", "horns", big, h, b2, "ATO: HORNS FOR " + TP_N(star), 1);
                }
                else if (star == pm && cs != null) return TP_mk(t, h, "pin", "post", cs, star, null, "ATO: POST UP " + TP_N(star), 1);
                else if (star != big && star.c >= 82 && b2 != null && star != b2) return TP_mk(t, h, "pin", "stagger", big, star, b2, "ATO: FLOPPY FOR " + TP_N(star), 1);
                else if (star != big) return TP_mk(t, h, "pin", "zip", big, star, null, "ATO: ZIPPER FOR " + TP_N(star), 1);
            }
            // end of the quarter (the game clock is under the shot clock): get the star the last look
            if (cpu && lv >= 2 && clock < shot && clock < 12 && clock > 3)
            {
                if (star == h && b2 != null) return TP_mk(t, h, "pnr", "horns", big, h, b2, "LAST SHOT: HORNS FOR " + TP_N(star), 2);
                if (star != h && star != big && star != pm) return TP_mk(t, h, "pin", "zip", big, star, null, "LAST SHOT: ZIPPER FOR " + TP_N(star), 2);
            }
            double r = Rng.R();
            bool stg = lv >= 2 && b2 != null && sh.c >= 80 && sh != big && sh != b2;
            // the coach's play family (gamePlan) -> one of its variants
            if (pc == 1) return r < 0.3 && b2 != null ? TP_mk(t, h, "pnr", "horns", big, h, b2, "HORNS") : r < 0.5 && lv >= 2 && s2 != null ? TP_mk(t, h, "pnr", "spain", big, h, s2, "SPAIN PICK & ROLL") : null;
            if (pc == 2) return r < 0.3 && pm != null && cs != null ? TP_mk(t, h, "pin", "post", cs, pm, null, "POST UP " + TP_N(pm)) : r < 0.5 && stg ? TP_mk(t, h, "pin", "stagger", big, sh, b2, "STAGGER FOR " + TP_N(sh)) : r < 0.65 && sh != big ? TP_mk(t, h, "pin", "zip", big, sh, null, "ZIPPER FOR " + TP_N(sh)) : null;
            if (pc == 3) return r < 0.35 && stg ? TP_mk(t, h, "pin", "stagger", big, sh, b2, "STAGGER FOR " + TP_N(sh)) : null;
            // auto: personnel decides
            double w = 0;
            if (pm != null && cs != null && (w += 0.16) > r) return TP_mk(t, h, "pin", "post", cs, pm, null, "POST UP " + TP_N(pm));
            if (b2 != null && (w += 0.14) > r) return TP_mk(t, h, "pnr", "horns", big, h, b2, "HORNS");
            if (lv >= 2 && s2 != null && (w += 0.1) > r) return TP_mk(t, h, "pnr", "spain", big, h, s2, "SPAIN PICK & ROLL");
            if (stg && sh.c >= 82 && (w += 0.08) > r) return TP_mk(t, h, "pin", "stagger", big, sh, b2, "STAGGER FOR " + TP_N(sh));
            if (star != h && star != big && star.ht < 6.7 && (w += 0.08) > r) return TP_mk(t, h, "pin", "zip", big, star, null, "ZIPPER FOR " + TP_N(star));
            return null;
        }

        /// <summary>How long the screener of a named set stays planted.</summary>
        public static double tpSetLen(Play pl) => pl.v == "stagger" ? 1.4 : pl.kind == "pnr" ? 0.9 : 1.0;

        /// <summary>Screen spots of the pindown-family sets (stagger lower screen, zipper down screen, post cross screen).</summary>
        public static void tpSpot(Play pl, double hx, double dir)
        {
            double sd = Util.T(pl.sd) ? pl.sd : 1;
            if (pl.v == "stagger") { pl.sx = hx + dir * 85; pl.sy = HY + sd * 105; }
            else if (pl.v == "zip") { pl.sx = hx + dir * 150; pl.sy = HY + sd * 45; }
            else { pl.sx = hx + dir * 50; pl.sy = HY - sd * 25; }
        }

        /// <summary>The man the set is run for (pindown family).</summary>
        public static bool tpUse(Player p, Play pl, double t, double hx, double dir)
        {
            int ti = (int)t;
            double sd = Util.T(pl.sd) ? pl.sd : 1;
            Player scr = pl.scr, def = pl.def;
            if (pl.v == "post")
            {
                // from the weak side, across the lane off the cross screen to the ball-side block; seal and call for it
                if (pl.ph == "go") mv(p, hx + dir * 40, HY - sd * 85, 1);
                else
                {
                    double bx = hx + dir * 42,
                        by = HY + sd * 55,
                        d = Hypot(p.x - bx, p.y - by);
                    mv(p, bx, by, 1.2);
                    if (d < 22)
                    {
                        p.callT = Math.Max(p.callT, 0.3);
                        Player m = manOf(p);
                        // (open for the entry unless his man is fronting him: between him and the ball)
                        if (m != null && Hypot(m.x - B.x, m.y - B.y) > Hypot(p.x - B.x, p.y - B.y) - 4) { OFFS[ti] = p; tpCall(pl, t); }
                    }
                }
                return true;
            }
            if (pl.v == "zip")
            {
                // zipper: up from the block off the down screen to the top of the key, where the ball finds him
                if (pl.ph == "go") mv(p, hx + dir * 35, HY + sd * 85, 1);
                else
                {
                    bool nearS = Hypot(p.x - scr.x, p.y - scr.y) > 22 && pl.ph == "set";
                    mv(p, nearS ? scr.x + dir * 4 : hx + dir * 255, nearS ? scr.y - sd * 9 : HY + sd * 20, 1.3);
                    if (Hypot(def.x - p.x, def.y - p.y) > 30 && Hypot(p.x - hx, p.y - HY) > 200) { OFFS[ti] = p; tpCall(pl, t); }
                }
                return true;
            }
            // stagger (floppy): up from the baseline off the first screen, then the second, out to the wing
            if (pl.ph == "go")
            {
                mv(p, hx + dir * 20, HY + sd * 85, 1);
                return true;
            }
            Player s2 = pl.s2;
            if (pl.st == 0)
            {
                mv(p, scr.x + dir * 6, scr.y + sd * 10, 1.3);
                if (Hypot(p.x - scr.x - dir * 6, p.y - scr.y - sd * 10) < 22) { pl.st = 1; pl.stT = T; }
            }
            else if (pl.st == 1)
            {
                mv(p, s2.x + dir * 6, s2.y + sd * 10, 1.3);
                if (Hypot(p.x - s2.x - dir * 6, p.y - s2.y - sd * 10) < 22 || T - pl.stT > 1.3) { pl.st = 2; pl.stT = T; statAdd("stagger", 1); }
            }
            else
            {
                mv(p, hx + dir * 215, HY + sd * 185, 1.25);
                if (Hypot(def.x - p.x, def.y - p.y) > 34 && Hypot(p.x - hx, p.y - HY) > 180) { OFFS[ti] = p; tpCall(pl, t); }
            }
            return true;
        }

        /// <summary>The man the set was run for just came open: the CPU handler looks his way now.</summary>
        static void tpCall(Play pl, double t)
        {
            var h = B.owner;
            if (Util.T(pl.cal) || h == null || h.tm != t || isH(h)) return;
            pl.cal = 1;
            if (h.ai.pt > 0.12) h.ai.pt = 0.12;
        }

        static void plant(Player p)
        {
            p.@in.dx = p.@in.dy = 0;
            p.vx *= 0.5;
            p.vy *= 0.5;
            p.setT = 0.25;
        }

        /// <summary>The set's second man: horns' other big, Spain's back-screener, the stagger's second screener.</summary>
        public static bool tpS2(Player p, Play pl, double t, double hx, double dir)
        {
            int ti = (int)t;
            p.br = "s2";
            double sd = Util.T(pl.sd) ? pl.sd : 1;
            Player scr = pl.scr;
            if (pl.v == "horns")
            {
                // at the other elbow; then high-low: the screener popped -> dive, he rolled -> lift to the top
                Player m = manOf(p);
                double md = m != null ? Hypot(m.x - p.x, m.y - p.y) : 99;
                if (pl.ph != "out") mv(p, hx + dir * 175, HY - sd * 60, 1);
                else if (Util.T(pl.pop))
                {
                    mv(p, hx + dir * 35, HY - sd * 25, 1.2);
                    if (Hypot(p.x - hx, p.y - HY) < 80 && md > 30) OFFS[ti] = p;
                }
                else
                {
                    mv(p, hx + dir * 245, HY - sd * 45, 1.05);
                    if (md > 40) OFFS[ti] = p;
                }
                return true;
            }
            if (pl.v == "spain")
            {
                if (pl.ph == "go")
                {
                    mv(p, hx + dir * 235, HY + sd * 40, 1); // up top, behind the screen
                    return true;
                }
                Player r = manOf(scr);
                if (!Util.T(pl.st) && T - pl.setAt < 2.6 && r != null)
                {
                    // back screen on the roller's man as he steps up to meet the roll
                    double l = Hypot(hx - r.x, HY - r.y);
                    if (!Util.T(l)) l = 1;
                    double bx = r.x + ((hx - r.x) / l) * 12,
                        by = r.y + ((HY - r.y) / l) * 12;
                    mv(p, bx, by, 1.25);
                    p.@in.sp = true;
                    if (Hypot(p.x - bx, p.y - by) < 18) { pl.st = 1; pl.stT = T; statAdd("spain", 1); }
                    return true;
                }
                if (pl.st == 1 && T - pl.stT < 0.5)
                {
                    plant(p);
                    return true;
                }
                // then pop to the top of the arc for the three
                Player m = manOf(p);
                mv(p, hx + dir * 245, HY + sd * 20, 1.15);
                if (m != null && Hypot(m.x - p.x, m.y - p.y) > 40) OFFS[ti] = p;
                return true;
            }
            // stagger: the second screen, held until the shooter is through it
            double sx = hx + dir * 150,
                sy = HY + sd * 150;
            if (pl.st != 2 && T - pl.t0 < 4.5)
            {
                if (pl.ph == "go" || Hypot(p.x - sx, p.y - sy) > 8) mv(p, sx, sy, 1.1);
                else plant(p);
            }
            else mv(p, hx + dir * 250, HY - sd * 30, 0.95);
            return true;
        }

        /// <summary>Pick-and-roll coverage beyond drop / hedge for the screener's man: ICE (sit low, baseline side) and
        /// blitz (trap the handler with his man, then recover to the roller).</summary>
        public static void tpBig(Player p, double t, Player o, Player hb, Play opl, double dh)
        {
            int ti = (int)t;
            double dir = dh > 470 ? -1 : 1;
            if (TS.cov[ti] == 2)
            {
                mv(p, dh + dir * 50, HY + (hb.y < HY ? -62 : 62), 1.05);
                return;
            }
            if (opl.ph == "set" || T - opl.setAt < 1.1)
            {
                double sx = o.x - hb.x,
                    sy = o.y - hb.y,
                    l = Hypot(sx, sy);
                if (!Util.T(l)) l = 1;
                mv(p, hb.x + (sx / l) * 14 + (dh - hb.x) * 0.05, hb.y + (sy / l) * 14 + (HY - hb.y) * 0.05, 1.25);
                p.@in.sp = true;
                p.hdgT = 0.25; // (arms wide: the trap)
                if (!Util.T(opl.bl)) { opl.bl = 1; statAdd("blitz", 1); }
            }
            else mv(p, o.x + (dh - o.x) * 0.35, o.y + (HY - o.y) * 0.35, 1.15); // recover to the roller
        }

        /// <summary>Blitz rotation (once per tick per defending team): the defender nearest the rolling screener (not one
        /// of the trappers) tags him goal-side.</summary>
        public static readonly TagState TPD = new TagState();
        public static bool tpTag(Player p, double t, Play opl, double dh)
        {
            int ti = (int)t;
            if (TPD.t != t || TPD.at != T)
            {
                TPD.t = t;
                TPD.at = T;
                TPD.tag = null;
                if (TS.cov[ti] == 3 && opl != null && opl.kind == "pnr" && Util.T(opl.bl) && opl.ph == "out" && T - opl.setAt < 1.3 && opl.use == B.owner && Hypot(dh - opl.scr.x, HY - opl.scr.y) < 200)
                {
                    Player rm = manOf(opl.scr),
                        hm = manOf(opl.use);
                    double bd = 1e9;
                    foreach (var q in P)
                        if (q.tm == t && !TP_on(q.off) && q != rm && q != hm && !isH(q))
                        {
                            double d = Hypot(q.x - opl.scr.x, q.y - opl.scr.y);
                            if (d < bd) { bd = d; TPD.tag = q; }
                        }
                    if (TPD.tag != null && opl.bl == 1) { opl.bl = 2; statAdd("tag", 1); }
                }
            }
            if (TPD.tag != p || opl == null) return false;
            Player r = opl.scr;
            double l2 = Hypot(dh - r.x, HY - r.y);
            if (!Util.T(l2)) l2 = 1;
            mv(p, r.x + ((dh - r.x) / l2) * 16, r.y + ((HY - r.y) / l2) * 16, 1.2);
            p.@in.sp = true;
            return true;
        }
    }
}
