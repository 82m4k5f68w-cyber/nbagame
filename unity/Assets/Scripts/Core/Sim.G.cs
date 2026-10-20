// Port of src/core/sim.ts lines 3669-4449: matchups (manOf, starOf, isoNow), half-court plays (Play / PLAY, newPlay,
// offBall + the joint spacing assignment SPA), loose balls / rebounding (loose), cuts, shot clip choice (pickClip),
// shooting-foul contact model (FLAG, shootingFoul), contests (contestRaw / contestOf), body collisions + screens
// (collide), the cloth net (NS, NETS, SEGR, netSim, inNet) and instant replays / highlights (REC ring buffer).
// Per-tick paths allocate nothing (scratch arrays / lists, no LINQ, no lambdas).
using System;
using System.Collections.Generic;
using static Hoops.Core.Util;
using static Hoops.Core.Data;
using static Hoops.Core.Sim;
using static Hoops.Core.Pose;

namespace Hoops.Core
{
    /// <summary>Half-court play (sim.ts Play). kind "pnr" | "pin" | "flare"; ph "go" | "set" | "out".</summary>
    public sealed partial class Play
    {
        public string kind;
        public double t0;
        public Player scr; // screener
        public Player use; // player using the screen
        public Player def; // defender being screened
        public string ph;
        public double sx, sy, setAt;
        public double? rd; // pick-and-roll read (CPU screeners): 0 set it, 1 slip it to the rim, 2 ghost it and pop to the arc
    }

    /// <summary>Spacers' joint spot assignment, once per tick per team (sim.ts SPA).</summary>
    public sealed class SpaState
    {
        public double t = -1, at = -1;
        public Dictionary<Player, int> m = new Dictionary<Player, int>();
    }

    /// <summary>A net knot (verlet point). f = fixed to the rim.</summary>
    public sealed class NetKnot
    {
        public double x, y, z, px, py, pz;
        public bool f;
    }

    /// <summary>A net constraint [a, b, rest length, stiffness, strand?] - strands are drawn; ring ties only hold the shape.</summary>
    public sealed class NetCon
    {
        public NetKnot a, b;
        public double rest, k;
        public bool draw;
    }

    public sealed class Net
    {
        public NetKnot[] p;
        public NetCon[] c;
        public double hx, quiet, ring;
        /// <summary>fz/fv: rim flex (px, + = bent down) and its rate (the rim ring of knots rides it; renderers move the
        /// hoop by it); dk: this dunk already yanked it; b*: the ball as the net last saw it (position, velocity; bok 0
        /// none / 1 position / 2 both); r*: the reaction the net handed the ball; w*: idle-sway oscillators; hold: how
        /// long a ball has sat slow in the mesh (then the net lets go of it).</summary>
        public double fz, fv, dk, bx, by, bz, bvx, bvy, bvz, bok, rvx, rvy, rvz, wx, wy, wx2, wy2, hold;
    }

    /// <summary>A saved highlight (copy of the replay buffer): label, frame count, frames, quarter, speed.</summary>
    public sealed class Highlight
    {
        public string s;
        public double n;
        public float[] buf;
        public double? q;
        public double k;
    }

    /// <summary>Live state saved while a replay plays (sim.ts LIVE).</summary>
    public sealed class LiveState
    {
        public double[][] p; // [x, y, z, f] per player
        public Q[] q;        // pose copies (null = none)
        public double[] b;   // ball [x, y, z, a]
    }

    public partial class PlayerAi
    {
        public double sealT, cutT;
        public double? spj; // spacing spot index last assigned (SPA stickiness)
    }

    public static partial class Sim
    {
        // (off / act / ... are declared with different types by different parts until integration)
        static bool G_on(bool v) => v;
        static bool G_on(double v) => Util.T(v);
        static bool G_on(double? v) => Util.T(v);

        static Player G_at(int k) => k >= 0 && k < P.Count ? P[k] : null;

        public static Player manOf(Player o)
        {
            int t = 1 - (int)o.tm;
            int oi = P.IndexOf(o);
            foreach (var d in P) if (d.tm == t && d.manT > 0 && d.man == oi) return d;
            var mu = TS.mu[t];
            if (mu != null)
            {
                int k = -1;
                for (int j = 0; j < mu.Length; j++) if (mu[j] == o.k) { k = j; break; }
                if (k >= 0) return G_at(t * cfg.NP + k);
            }
            return G_at(t * cfg.NP + (int)o.k);
        }

        /// <summary>Isolation: called by the user, or the CPU clears out for its star late in the clock.</summary>
        public static Player starOf(double t)
        {
            // (stable sort by ovr descending, [0] = the first of the best)
            Player best = null;
            double bo = 0;
            foreach (var q in P)
            {
                if (q.tm != t) continue;
                double o = ovr(q);
                if (best == null || o > bo) { best = q; bo = o; }
            }
            return best;
        }

        public static bool isoNow(double t) => TS.pc[(int)t] == 4 || (!ctHas(t) && shot < 8 && B.owner == starOf(t));

        public static readonly Play[] PLAY = { null, null };
        static readonly List<Player> G_ms = new List<Player>(10);

        static double G_offOf(Player q) => q.sg != null && Util.T(q.sg.off) ? q.sg.off : 0;

        public static Play newPlay(double t)
        {
            var h = B.owner;
            var ms = G_ms;
            ms.Clear();
            foreach (var q in P) if (q.tm == t && q != h) ms.Add(q);
            if (h == null || ms.Count < 2) return null;
            double pc = TS.pc[(int)t];
            // (stable sorts, descending: [0] = the first of the best)
            Player big = null, sh = null;
            double bk = 0, sk = 0;
            foreach (var q in ms)
            {
                double v = q.ht * q.bk + q.i / 60;
                if (big == null || v > bk) { big = q; bk = v; }
                double w = q.c + 30 * G_offOf(q);
                if (sh == null || w > sk) { sh = q; sk = w; }
            }
            double r = Rng.R();
            if (pc >= 5 && cfg.NP >= 3 && Hypot(hoop(t) - h.x, HY - h.y) > 330) return null; // (a called set starts in the half court)
            var tp = tpSet(t, h, ms, big, sh, pc); // (named sets: horns, Spain pick-and-roll, stagger, zipper, post entry, ATO)
            if (tp != null) return tp;
            // Curry-style shooters get pindowns/flares; otherwise pick-and-roll is the bread and butter
            string kind = pc == 1 || pc >= 5 ? "pnr" : pc == 2 ? "pin" : pc == 3 ? "flare" : sh.c >= 82 && sh != big && r < 0.5 ? (r < 0.3 ? "pin" : "flare") : "pnr";
            Player scr;
            if (kind == "pnr") scr = big;
            else
            {
                scr = null;
                double sv = 0;
                foreach (var q in ms)
                {
                    if (q == sh) continue;
                    double v = q.ht * q.bk;
                    if (scr == null || v > sv) { scr = q; sv = v; }
                }
            }
            var use = kind == "pnr" ? h : sh;
            // (fa: called in the backcourt - re-called once the ball crosses into the half court)
            return new Play { kind = kind, t0 = T, scr = scr, use = use, def = manOf(use), ph = "go", sx = 0, sy = 0, setAt = 0, fa = cfg.NP >= 3 && cpuIQ(t) >= 1 && Hypot(hoop(t) - h.x, HY - h.y) > 330 ? 1 : 0 };
        }

        public static readonly SpaState SPA = new SpaState();
        static readonly double[] G_spX = new double[5], G_spY = new double[5];
        static readonly double[,] G_cost = new double[5, 5];
        static readonly bool[] G_used = new bool[5];
        static readonly int[] G_cur = new int[5], G_out = new int[5];
        static double G_best;
        static int G_n;

        static bool G_nearBusy(double x, double y, Player scr, Player use, Player h, double t)
        {
            if (scr != null && scr.tm == t && Hypot(scr.x - x, scr.y - y) < 80) return true;
            if (use != null && use.tm == t && Hypot(use.x - x, use.y - y) < 80) return true;
            if (h != null && h.tm == t && Hypot(h.x - x, h.y - y) < 80) return true;
            return false;
        }

        static void G_rec(int k, double acc)
        {
            if (acc >= G_best) return;
            if (k == G_n)
            {
                G_best = acc;
                for (int j = 0; j < G_n; j++) G_out[j] = G_cur[j];
                return;
            }
            for (int j = 0; j < 5; j++)
                if (!G_used[j])
                {
                    G_used[j] = true;
                    G_cur[k] = j;
                    G_rec(k + 1, acc + G_cost[k, j]);
                    G_used[j] = false;
                }
        }

        public static bool offBall(Player p, double t)
        {
            if (cfg.NP < 2) return false;
            int ti = (int)t;
            double hx = hoop(t),
                dir = hx > 470 ? -1 : 1; // from the hoop toward half court
            var h = B.owner;
            {
                // never camp in the lane (3 seconds): step out to the short corner / wing
                int k = P.IndexOf(p);
                if (cfg.VIOL != 0 && TS.lane[k] > 2.1)
                {
                    mv(p, hx + dir * 205, p.y < HY ? HY - 130 : HY + 130, 1.15);
                    p.br = "lane";
                    return true;
                }
            }
            bool iso = isoNow(t);
            Play pl = iso ? null : PLAY[ti];
            if (!iso && (pl == null || T - pl.t0 > (TP_v(pl) ? 6.5 : 5.5) || (Util.T(pl.fa) && pl.ph == "go" && h != null && Hypot(hx - h.x, HY - h.y) <= 330) || pl.use.tm != t || (pl.kind == "pnr" && pl.use != h) || pl.scr == h || (pl.s2 != null && (pl.s2 == h || pl.s2.tm != t)))) pl = PLAY[ti] = newPlay(t);
            if (iso) PLAY[ti] = null;
            OFFS[ti] = null;
            if (pl == null && !iso) return false;
            // post entry delivered: he goes to work on the block
            if (pl != null && pl.v == "post" && h == pl.use && !Util.T(pl.fed)) { pl.fed = 1; h.ai.post = 1; h.ai.pw = 0; statAdd("postFed", 1); }
            Player scr = pl != null ? pl.scr : null,
                use = pl != null ? pl.use : null,
                def = pl != null ? (pl.def = manOf(use)) : null;
            double side = (use ?? p).y < HY ? -1 : 1;
            if (pl != null)
            {
                // screen spot: on the defender's hip, on the side the user will run past
                if (pl.ph != "set")
                {
                    if (pl.kind == "pnr")
                    {
                        double mid = HY - use.y > 0 ? 1 : -1; // screen toward the middle of the floor
                        pl.sx = def.x + dir * 6;
                        pl.sy = def.y + mid * 13;
                    }
                    else if (TP_v(pl)) tpSpot(pl, hx, dir);
                    else if (pl.kind == "pin")
                    {
                        pl.sx = hx + dir * 120;
                        pl.sy = HY + side * 70;
                    }
                    else
                    {
                        pl.sx = hx + dir * 175;
                        pl.sy = HY - side * 40;
                    }
                }
                if (p == scr)
                {
                    p.br = "scr";
                    if (pl.ph == "go")
                    {
                        if (T - pl.t0 < 0.05 && isH(h) && Util.T(TS.pc[ti])) txtW(PCN[(int)TS.pc[ti]], p.x, p.y, 95, "#9fe7ff");
                        // read the coverage once: a hedge / trap jumps the handler - slip to the rim before contact; a
                        // switch-everything defense just swaps - a shooting screener ghosts it (pops before anybody switches)
                        if (pl.kind == "pnr" && pl.rd == null)
                        {
                            double cov = TS.cov[1 - ti],
                                ds = TS.ds[1 - ti],
                                r = Rng.R();
                            pl.rd = (cov == 1 || cov == 3 || TS.dbl[1 - ti] == P.IndexOf(use)) && r < 0.45 ? 1 : ds == 3 && p.c >= 78 && r < 0.5 ? 2 : 0;
                        }
                        if (Util.T(pl.rd) && Hypot(p.x - pl.sx, p.y - pl.sy) < 26)
                        {
                            pl.ph = "out";
                            pl.setAt = T;
                            statAdd(pl.rd == 1 ? "slip" : "ghost", 1);
                            if (pl.rd == 1 && Rng.R() < 0.35) cm("slip", p.n);
                            return true;
                        }
                        mv(p, pl.sx, pl.sy, 1.2);
                        if (Hypot(p.x - pl.sx, p.y - pl.sy) < 7 || T - pl.t0 > (TP_v(pl) ? 1.8 : 2.6))
                        {
                            pl.ph = "set";
                            pl.setAt = T;
                        }
                    }
                    else if (pl.ph == "set")
                    {
                        p.@in.dx = p.@in.dy = 0; // planted
                        p.vx *= 0.5;
                        p.vy *= 0.5;
                        p.setT = 0.25;
                        if (T - pl.setAt > (TP_v(pl) ? tpSetLen(pl) : pl.kind == "pnr" ? 1.25 : 1.5)) pl.ph = "out"; // (named sets run quicker)
                    }
                    else
                    {
                        // roll hard to the rim, or pop to the arc if he can shoot (read the coverage: a big sitting back
                        // in drop leaves the arc open for any decent shooter; a hedge leaves the rim open, so everybody
                        // dives; a ghost always pops)
                        double cov = TS.cov[1 - ti];
                        bool pop = pl.rd == 2 || (pl.rd != 1 && (cov == 1 ? false : scr.c >= (cov == 0 && !ctHas(1 - t) ? 74 : 80) && scr.i < 85));
                        double gx = pop ? hx + dir * 225 : hx + dir * 30,
                            gy = pop ? HY + side * -60 : HY + side * 14;
                        pl.pop = pop ? 1 : 0;
                        mv(p, gx, gy, 1.2);
                        var mo = manOf(p);
                        if (!pop && Hypot(p.x - hx, p.y - HY) < 90 && Hypot(mo.x - p.x, mo.y - p.y) > 30) OFFS[ti] = p;
                        if (pop && Hypot(mo.x - p.x, mo.y - p.y) > 40) OFFS[ti] = p;
                    }
                    return true;
                }
                if (pl.s2 != null && p == pl.s2) return tpS2(p, pl, t, hx, dir);
                if (p == use && pl.kind != "pnr")
                {
                    p.br = "use";
                    if (TP_v(pl)) return tpUse(p, pl, t, hx, dir);
                    if (pl.ph == "go") mv(p, hx + dir * 28, HY + side * 60, 1); // set up low
                    else
                    {
                        // run tight off the screener's shoulder, then up to the wing/top
                        double gx = pl.kind == "pin" ? hx + dir * 230 : hx + dir * 220,
                            gy = pl.kind == "pin" ? HY + side * 95 : HY - side * 150;
                        bool nearS = Hypot(p.x - scr.x, p.y - scr.y) > 22 && pl.ph == "set";
                        mv(p, nearS ? scr.x + dir * 4 : gx, nearS ? scr.y + side * 9 : gy, 1.25);
                        if (Hypot(def.x - p.x, def.y - p.y) > 34 && Hypot(p.x - hx, p.y - HY) > 180) OFFS[ti] = p;
                    }
                    return true;
                }
            }
            // a post scorer with a small on him (after a switch): seal on the ball-side block and call for it
            if (p != scr && p != use && cfg.NP > 1 && !G_ctrls(t, p))
            {
                var mm = manOf(p);
                // (a short window per possession, and only while the ball is out at the arc to feed him: no clogged lane)
                if (mm != null && !G_on(mm.off) && p.i >= 76 && p.ht - mm.ht >= 0.4 && !(TS.lane[P.IndexOf(p)] > 1.6) && p.ai.sealT < 2.5 && Hypot(hx - h.x, HY - h.y) > 200 && Hypot(hx - h.x, HY - h.y) < 300)
                {
                    p.ai.sealT = p.ai.sealT + DT;
                    p.br = "seal";
                    double bs = h.y < HY ? -1 : 1;
                    mv(p, hx + dir * 40, HY + bs * 48, 1.1);
                    if (Hypot(p.x - (hx + dir * 40), p.y - (HY + bs * 48)) < 20)
                    {
                        p.callT = Math.Max(p.callT, 0.3);
                        statAdd("seal", 1);
                    }
                    return true;
                }
            }
            // spacing + backdoor cuts for everyone else
            var ms = G_ms;
            ms.Clear();
            Player s2 = pl != null ? pl.s2 : null;
            foreach (var q in P) if (q.tm == t && q != h && q != scr && q != use && q != s2) ms.Add(q);
            G_spX[0] = hx + dir * 15; G_spY[0] = HY - 230;
            G_spX[1] = hx + dir * 15; G_spY[1] = HY + 230;
            G_spX[2] = hx + dir * 190; G_spY[2] = HY - 175;
            G_spX[3] = hx + dir * 190; G_spY[3] = HY + 175;
            G_spX[4] = hx + dir * 250; G_spY[4] = HY;
            int kk = ms.IndexOf(p);
            if (kk < 0) return false;
            // the spacers' spots are assigned together, once per tick: the assignment with the least total travel (no
            // one running across the floor through a teammate to the spot nobody else wanted), a spot where the ball is
            // or where the driver is heading taken last, and a little stickiness so nobody flip-flops between two spots
            if (SPA.t != t || SPA.at != T)
            {
                SPA.t = t;
                SPA.at = T;
                SPA.m.Clear();
                double bx = h != null ? h.x + h.vx * 0.5 : B.x,
                    by = h != null ? h.y + h.vy * 0.5 : B.y;
                int n = Math.Min(ms.Count, 5);
                for (int k = 0; k < n; k++)
                {
                    var q = ms[k];
                    for (int j = 0; j < 5; j++)
                    {
                        double sx = G_spX[j], sy = G_spY[j];
                        G_cost[k, j] =
                            Hypot(sx - q.x, sy - q.y) +
                            (Hypot(sx - B.x, sy - B.y) < 90 || Hypot(sx - bx, sy - by) < 120 ? 400 : 0) +
                            (G_nearBusy(sx, sy, scr, use, h, t) || (s2 != null && s2.tm == t && Hypot(s2.x - sx, s2.y - sy) < 80) ? 300 : 0) +
                            (q.ai.spj == j ? -45 : 0);
                    }
                }
                G_best = 1e18;
                G_n = n;
                for (int j = 0; j < 5; j++) G_used[j] = false;
                G_rec(0, 0);
                for (int k = 0; k < n; k++)
                {
                    SPA.m[ms[k]] = G_out[k];
                    ms[k].ai.spj = G_out[k];
                }
            }
            int si = SPA.m.TryGetValue(p, out var sv) ? sv : 0;
            double spX = G_spX[si], spY = G_spY[si];
            var md = manOf(p);
            bool deny = Hypot(md.x - p.x, md.y - p.y) < 20 && Hypot(md.x - hx, md.y - HY) > Hypot(p.x - hx, p.y - HY) - 5;
            if (deny && !iso && Rng.R() < 0.02) p.ai.cutT = T;
            p.br = Util.T(p.ai.cutT) && T - p.ai.cutT < 1.1 ? "cut" : "spot";
            if (Util.T(p.ai.cutT) && T - p.ai.cutT < 1.1)
            {
                mv(p, hx + dir * 25, HY + (p.y < HY ? -18 : 18), 1.25); // backdoor
                if (Hypot(md.x - p.x, md.y - p.y) > 26) OFFS[ti] = p;
            }
            else if (cfg.PP != 0 && upVcut(p, spX, spY, hx, md)) { }
            else mv(p, spX + JsMath.Sin(T * 0.8 + p.k) * 10, spY, 0.95);
            return true;
        }

        /// <summary>CT.some(c => c.tm === t && P[c.idx] === p)</summary>
        static bool G_ctrls(double t, Player p)
        {
            for (int k = 0; k < CT.Count; k++) if (CT[k].tm == t && G_at(CT[k].idx) == p) return true;
            return false;
        }

        // scratch for loose(): [distance, slot] pairs sorted stably by distance
        static readonly double[] G_ld = new double[16];
        static readonly int[] G_lk = new int[16];
        static void G_sortPairs(int n)
        {
            for (int a = 1; a < n; a++)
            {
                double v = G_ld[a];
                int kv = G_lk[a];
                int b = a - 1;
                while (b >= 0 && Cmp(G_ld[b] - v) > 0) { G_ld[b + 1] = G_ld[b]; G_lk[b + 1] = G_lk[b]; b--; }
                G_ld[b + 1] = v;
                G_lk[b + 1] = kv;
            }
        }

        public static void loose(Player p, double t)
        {
            int NP = cfg.NP;
            var i = p.@in;
            double hx = B.last != null ? hoop(B.last.tm) : hoop(t),
                dir = hx > 470 ? -1 : 1;
            int tb = (int)p.tm * NP;
            for (int k = 0; k < NP; k++)
            {
                var q = P[tb + k];
                G_ld[k] = Hypot(q.x - hx, q.y - HY);
                G_lk[k] = k;
            }
            G_sortPairs(NP);
            int rk = -1;
            for (int k = 0; k < NP; k++) if (G_lk[k] == p.k) { rk = k; break; }
            int K2 = NP > 2 ? 2 : 1;
            double d = Hypot(B.x - p.x, B.y - p.y);
            bool sh = B.last != null && B.last.tm == p.tm,
                fly = Util.T(B.sh) && B.last != null && B.z > 45 && B.age < 1.3 && B.vz > -120 && Hypot(B.x - hx, B.y - HY) > 40;
            if (fly && !sh && NP > 1 && rk < 3)
            {
                // box out: get between your man and the rim, then hold him there
                var man = guardOf(p);
                double md = Hypot(man.x - hx, man.y - HY);
                if (md < 160)
                {
                    double mdd = Util.T(md) ? md : 1;
                    mv(p, man.x + (hx - man.x) * (12 / mdd), man.y + (HY - man.y) * (12 / mdd), 1.15);
                    if (Hypot(man.x - p.x, man.y - p.y) < 18) p.boxT = 0.3;
                    return;
                }
            }
            if (fly)
            {
                // (modern spacing: the shooting side sends its closest man and a big; the rest get back)
                if (rk < K2 && !(sh && rk > 0 && p.ht < 6.75 && NP > 2)) mv(p, hx + dir * (26 + rk * 22), HY + (rk != 0 ? 36 : -8) * (Util.T(p.k % 2) ? 1 : -1), 1.1);
                else if (sh) mv(p, hx + dir * 190, HY + (p.k - 2) * 45, 0.7);
                else mv(p, hx + dir * 70, HY + (p.k - 2) * 50, 0.8);
            }
            else
            {
                for (int k = 0; k < NP; k++)
                {
                    var q = P[tb + k];
                    G_ld[k] = Hypot(q.x - B.x, q.y - B.y);
                    G_lk[k] = k;
                }
                G_sortPairs(NP);
                bool nr = false;
                for (int k = 0; k < K2 && k < NP; k++) if (G_lk[k] == p.k) { nr = true; break; }
                if (nr || d < 90)
                {
                    mv(p, B.x + B.vx * 0.25, B.y + B.vy * 0.25, 1.15);
                    // dive on the floor for a loose ball when the other team is closing in on it
                    if (!Util.T(PREDICT) && !Util.T(B.sh) && B.z < 14 && d > 12 && d < 36 && p.z <= 0 && !(p.actT > 0) && Rng.R() < 0.12)
                    {
                        double rival = 1e9;
                        foreach (var q in P) if (q.tm != p.tm) rival = Math.Min(rival, Hypot(q.x - B.x, q.y - B.y));
                        if (rival < 45)
                        {
                            p.act = 4;
                            p.actT = 0.75;
                            p.stt.dv++;
                            p.vx = ((B.x - p.x) / d) * 300;
                            p.vy = ((B.y - p.y) / d) * 300;
                            if (isH(p) || isH(B.last)) txtW("DIVE!", p.x, p.y, 70, "#ffd23f");
                        }
                    }
                    if (B.z > 50 && d < 28 && p.z <= 0) i.sd = true;
                }
                else if (sh) mv(p, hx + dir * 190, HY + (p.k - 2) * 45, 0.7);
                else mv(p, hx + dir * 80, HY + (p.k - 2) * 50, 0.8);
            }
        }

        public static bool cut(Player p, double t)
        {
            double hx = hoop(t),
                dir = hx > 470 ? -1 : 1,
                ph = (T * 0.7 + p.k * 1.3) % 4;
            if (ph < 0.8)
            {
                mv(p, hx + dir * 40, HY + (Util.T(p.k % 2) ? 30 : -30), 1.1);
                return true;
            }
            if (ph < 1.8)
            {
                mv(p, hx + dir * 215, HY + (Util.T(p.k % 2) ? 1 : -1) * (80 + p.k * 20), 1);
                return true;
            }
            return false;
        }

        public static double pickClip(Player p, double D, bool lay)
        {
            if (p.fsv != null)
            {
                double v = p.fsv.Value;
                p.fsv = null;
                return v;
            }
            double c = contestOf(p).Item1,
                dir = hoop(p.tm) > 470 ? 1 : -1,
                fw = p.vx * dir,
                sp = Hypot(p.vx, p.vy);
            if (lay)
            {
                // finish package: picked by leaping ability, speed, approach angle and traffic
                double hx = hoop(p.tm);
                bool bse = Math.Abs(p.y - HY) > 40 && Math.Abs(p.x - hx) < 45; // driving along the baseline
                double r = Rng.R();
                if (D < 50 && p.j >= 55)
                {
                    if (c > 0.4) return 11; // two-hand power through traffic
                    if (bse && r < 0.5) return 14; // reverse slam along the baseline
                    if (sp > 190 && p.j >= 75) return r < 0.3 ? 15 : r < 0.65 ? 13 : 12; // 360 / windmill / tomahawk
                    if (p.j >= 70 && r < 0.45) return 12;
                    return r < 0.55 ? 6 : 11;
                }
                if (c > 0.35 && sp > 60) return 7; // euro step around the help
                if (bse && r < 0.6) return 17; // reverse layup under the rim
                if (c < 0.2 && sp > 140) return 16; // finger roll in space
                return 5;
            }
            if (p.sg != null && Util.T(p.sg.cl)) return 9;
            if (p.sbw > 0) return 3;
            {
                // runners and leaners: shaped by how the shooter is moving
                double lat = Math.Abs(-p.vx * JsMath.Sin(p.f) + p.vy * JsMath.Cos(p.f));
                if (fw > 150 && D > 90 && D < 230) return 21;
                if (lat > 130 && D > 150) return 20;
            }
            if (fw > 110 && D > 110) return 8;
            if (p.st == 4) return 4;
            if (p.st == 2 || (c > 0.5 && p.st != 1)) return 2;
            if (p.st == 3) return 3;
            // standard jumpers use the motion-captured shot (players with a hand-tuned SIG form keep their classic clip)
            return p.st == 1 ? 1 : SIGK(p) ? 0 : 22;
        }

        /// <summary>Flagrant flag of the last shooting foul (1 = flagrant 1).</summary>
        public static double FLAG = 0;
        public static double LASTP_FOUL = 0.8; // how clear the last shooting foul was (challenge odds)

        /// <summary>Shooting-foul contact model. A foul needs real contact: a hard closeout into the shooter's space, a
        /// defender flying sideways through him (straight up = verticality, rarely a foul), or bodies already touching.
        /// Good defenders foul less; drives and strong finishers draw more. Returns the fouling defender or null.</summary>
        public static Player shootingFoul(Player p, bool lay)
        {
            FLAG = 0;
            if (cfg.FOULS == 0) return null;
            Player best = null;
            double bp = 0, fl = 0;
            foreach (var o in P)
            {
                if (o.tm == p.tm) continue;
                double dx = p.x - o.x,
                    dy = p.y - o.y,
                    d = Hypot(dx, dy);
                if (!Util.T(d)) d = 1;
                if (d > 28) continue;
                double close = (o.vx * dx + o.vy * dy) / d, // speed toward the shooter
                    hs = Hypot(o.vx, o.vy);
                double c = 0;
                c += clamp((close - 50) / 220, 0, 1) * 0.32; // late, hard closeout
                if (o.z > 4) c += hs > 50 ? 0.3 : 0.03; // flying in vs. straight up
                if (d < 15) c += 0.14; // already chest to chest
                if (lay && d < 22) c += 0.1 + (p.i - 60) / 400 + (p.bk - 1) * 0.2 + (hasB(p, "PZ") ? 0.08 : 0);
                c *= (1.2 - o.d / 220) * (cfg.PP >= 2 ? 0.52 : 0.42); // (x.42: calibrated to NBA free-throw rate; Pro Play v2: x.52 with fewer and-ones)
                if (c > bp)
                {
                    bp = c;
                    best = o;
                    fl = lay && o.z > 4 && hs > 170 && close > 140 ? 1 : 0;
                }
            }
            if (best == null || Rng.R() >= clamp(bp, 0, 0.6)) return null;
            statAdd("shootFouls", 1);
            FLAG = Util.T(fl) && Rng.R() < 0.08 ? 1 : 0;
            LASTP_FOUL = clamp(bp * 1.6, 0.35, 0.95);
            return best;
        }

        /// <summary>Raw contest (0..1.5) from the closest defender within 6 ft; airborne defenders count 1.5x.</summary>
        public static (double, Player) contestRaw(Player p)
        {
            var fr = lagFrame(p);
            double ct = 0;
            Player o2 = null;
            for (int k = 0; k < P.Count; k++)
            {
                var o = P[k];
                if (o.tm == p.tm) continue;
                double ox = fr != null ? fr[k * 3] : o.x,
                    oy = fr != null ? fr[k * 3 + 1] : o.y,
                    oz = fr != null ? fr[k * 3 + 2] : o.z,
                    d = Hypot(ox - p.x, oy - p.y);
                if (d < 60)
                {
                    double c2 = (1 - d / 60) * (oz > 8 ? (cfg.PP != 0 && o.vz < -90 ? 1.15 : 1.5) : o.hupT > 0 ? 1.2 : 1) /* (Pro Play: coming down already = a weaker contest) */ * (hasB(o, "LD") ? 1.15 : 1);
                    if (c2 > ct)
                    {
                        ct = c2;
                        o2 = o;
                    }
                }
                if (d < 95 && d > 1)
                {
                    // a hard closeout bothers the shot before he gets there (the shooter sees him coming, hurries it)
                    double ap = (o.vx * (p.x - ox) + o.vy * (p.y - oy)) / d,
                        c3 = clamp((ap - 90) / 160, 0, 1) * (1 - d / 95) * 0.8;
                    if (c3 > ct)
                    {
                        ct = c3;
                        o2 = o;
                    }
                }
            }
            return (ct, o2);
        }

        public static (double, Player) contestOf(Player p)
        {
            var (ct, o2) = contestRaw(p);
            // (Pro Play v2: a stick-picked fadeaway / leaner creates separation - here, so the meter shows it while charging)
            return (Math.Min(1, ct * (p.sbw > 0 ? 0.25 : 1) * (cfg.PP >= 2 && Util.T(p.fade) && (p.mode == "c" || p.mode == "s") ? (p.fade == 1 ? 0.82 : 0.9) : 1)), o2);
        }

        public static void collide()
        {
            for (int a = 0; a < P.Count; a++)
                for (int b = a + 1; b < P.Count; b++)
                {
                    Player A = P[a],
                        C = P[b];
                    if (G_on(A.off) || G_on(C.off)) continue;
                    double dx = A.x - C.x,
                        dy = A.y - C.y,
                        d = Hypot(dx, dy);
                    // bodies are wider than deep: face to face they stop at 16 px, shoulder to shoulder at up to ~28 (the
                    // rig's real shoulder width) - how sideways each one stands to the other
                    double dm = 16;
                    if (cfg.PRO != 0 && d < 29 && d > 0)
                    {
                        double sA = Math.Abs(JsMath.Sin(JsMath.Atan2(-dy, -dx) - A.f)),
                            sC = Math.Abs(JsMath.Sin(JsMath.Atan2(dy, dx) - C.f));
                        dm = 16 + 5 * (sA * Math.Min(1.2, A.bk) + sC * Math.Min(1.2, C.bk));
                    }
                    if (d < dm && d > 0 && A.z < 8 && C.z < 8)
                    {
                        if (cfg.PRO == 0)
                        {
                            double s = (16 - d) / 2 / d;
                            A.x += dx * s;
                            A.y += dy * s;
                            C.x -= dx * s;
                            C.y -= dy * s;
                            continue;
                        }
                        double nx = dx / d,
                            ny = dy / d,
                            mA = A.bk * A.ht * (A.setT > 0 ? 3 : Util.T(A.postA) ? 1.7 : 1),
                            mC = C.bk * C.ht * (C.setT > 0 ? 3 : Util.T(C.postA) ? 1.7 : 1),
                            rv = (A.vx - C.vx) * nx + (A.vy - C.vy) * ny,
                            ov = dm - d;
                        // PH2 box-out (Sim.PH.cs): the defender sealing his man on a shot / rebound plays heavy
                        int bxo = phOn() ? phBox(A, C) : 0;
                        if (bxo == 1) mA *= PH_BOXM; else if (bxo == 2) mC *= PH_BOXM;
                        for (int w = 0; w < 2; w++)
                        {
                            Player sc0 = w == 0 ? A : C,
                                df = w == 0 ? C : A;
                            if (sc0.setT > 0 && df.tm != sc0.tm && df != B.owner)
                            {
                                if (!(df.scr > 0))
                                {
                                    statAdd("screens", 1);
                                    sc0.stt.sa++;
                                    df.scr = 0.55; // hits the screen: stopped dead for half a second
                                    df.hitT = 0.35;
                                    df.hitX = -nx * (df == A ? -1 : 1);
                                    df.hitY = -ny * (df == A ? -1 : 1);
                                    if (isH(B.owner) || isH(df)) txtW("SCREEN", sc0.x, sc0.y, 88, "#9ad");
                                    var pl = PLAY[(int)sc0.tm];
                                    // the screener's defender switches onto the ball handler some of the time
                                    if (pl != null && pl.kind == "pnr" && Rng.R() < (TS.ds[(int)df.tm] == 3 ? 1 : 0.35))
                                    {
                                        var sd = manOf(sc0);
                                        int NP = cfg.NP;
                                        sd.man = sc0.tm * NP + pl.use.k;
                                        sd.manT = 3;
                                        df.man = sc0.tm * NP + sc0.k;
                                        df.manT = 3;
                                        // "Switch!": both point at their new man and call it out
                                        if (!Util.T(PREDICT))
                                        {
                                            sd.swT = 0.7;
                                            df.swT = 0.7;
                                            sd.callT = 0.5;
                                            df.callT = 0.5;
                                        }
                                        if (isH(B.owner) || isH(df) || isH(sd)) txtW("SWITCH!", sd.x, sd.y, 92, "#9fe7ff");
                                    }
                                }
                            }
                        }
                        A.x += (nx * ov * mC) / (mA + mC);
                        A.y += (ny * ov * mC) / (mA + mC);
                        C.x -= (nx * ov * mA) / (mA + mC);
                        C.y -= (ny * ov * mA) / (mA + mC);
                        if (bxo == 1) phShove(A, C, -nx, -ny, mA, mC);
                        else if (bxo == 2) phShove(C, A, nx, ny, mC, mA);
                        if (rv < 0)
                        {
                            double j = (-1.05 * rv) / (1 / mA + 1 / mC),
                                hit = -rv;
                            A.vx += (j * nx) / mA;
                            A.vy += (j * ny) / mA;
                            C.vx -= (j * nx) / mC;
                            C.vy -= (j * ny) / mC;
                            if (hit > 150 && fc <= 0 && rs <= 0 && ftq == null && inb <= 0 && cfg.FOULS != 0)
                            {
                                Player sx = A.setT > 0 ? A : C.setT > 0 ? C : null;
                                if (sx != null)
                                {
                                    var o = sx == A ? C : A;
                                    if (o.tm != sx.tm && Hypot(sx.vx, sx.vy) > 110 && Rng.R() < 0.35)
                                    {
                                        fc = 2;
                                        txtW("ILLEGAL SCREEN", sx.x, sx.y, 95, "#ff6b4a");
                                        tf[(int)sx.tm]++;
                                        sx.pf++;
                                        whistle(sx, o, 0.6);
                                        setup(o.tm);
                                    }
                                }
                            }
                            if (hit > 60)
                            {
                                // both bodies react to the bump, away from each other
                                A.hitT = C.hitT = Math.Min(0.35, hit / 500);
                                A.hitX = nx;
                                A.hitY = ny;
                                C.hitX = -nx;
                                C.hitY = -ny;
                                for (int w = 0; w < 2; w++)
                                {
                                    var q = w == 0 ? A : C;
                                    if (hit > 120) q.slow = Math.Max(q.slow, 0.12);
                                    if (q.mode == "c" || q.mode == "s") q.bmp = Math.Min(1, q.bmp + hit / 260);
                                }
                                var h = B.owner;
                                if (hit > 170 && fc <= 0 && rs <= 0 && ftq == null && inb <= 0 && h != null && (A == h || C == h) && cfg.FOULS != 0)
                                {
                                    var o = A == h ? C : A;
                                    fc = 2;
                                    if (o.tm != h.tm)
                                    {
                                        bool sh = h.mode == "c" || h.mode == "s";
                                        // (no charge in the restricted area under the rim; a help defender who got there
                                        // and set his feet draws it more often)
                                        bool ra = Hypot(o.x - hoop(h.tm), o.y - HY) < 40;
                                        if (cfg.PP >= 2 ? pp2Charge(o, h, ra) : !ra && Hypot(o.vx, o.vy) < 70 && Hypot(h.vx, h.vy) > 170 && Rng.R() < (o.helpT > 0 ? 0.62 : 0.5)) // (Pro Play v2: read from position)
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
                                        else if (Rng.R() < (sh ? 0.2 : 0.05) * (hit > 240 ? 1.6 : 1) * (cfg.PP >= 2 ? pp2BlkK(o) : 1)) foul(o, h, sh ? "SHOOTING" : "BLOCKING", sh ? 1 : 0, 0); // (blocking: calibrated to NBA personal-foul rates)
                                    }
                                }
                            }
                        }
                    }
                }
        }

        // ---- physics net: 16-strand diamond weave, 6 rings, verlet; the ball collides with strands, not just knots ----
        public const int NS = 16;
        static readonly double[][] NR =
        {
            new[] { 7.5, 100 },
            new[] { 6.9, 96.4 },
            new[] { 6.25, 92.8 },
            new[] { 5.6, 89.4 },
            new[] { 5.05, 86.2 },
            new[] { 4.65, 83.2 }, // (a little wider than the ball at the hem: it hugs a swish, never holds a ball)
        };
        const double NET_DAMP = 0.984, // velocity kept per 1/60 s tick (nylon + air): a whipped net swings ~2 s before it hangs still
            NET_STR = 0.4, // strand stretch correction per solver pass: elastic nylon - a swish stretches the mesh, it recoils
            // (the same stiffness over the 3 passes of a quiet net: 1 - (1 - k)^(7/3), so it hangs exactly as low)
            NET_STR3 = 0.6963642404913704,
            NET_HEM3 = 0.8821109920435076,
            NET_TIE3 = 0.37064021485998855,
            NET_MAXS = 1.15, // stretch limit: past 15% the nylon is a rope again (fully stiff)
            NET_MU = 0.45, // ball-strand friction: the share of the ball's slide the touched knots follow (drags the mesh along)
            NET_RK = 1, // reaction on the ball per px the mesh still pushes back per tick
            NET_RUP = 0.25, // ... of which its vertical part counts this much
            NET_RF = 0.35, // ... and per px of mesh it drags along (the momentum it hands the nylon)
            NET_VCAP = 14, // most the nylon takes off the ball's drop per tick (px/s): a swish keeps ~70% of its speed
            NET_CK = 900, // centering spring (1/s^2) + damping (1/s) on a ball pressing into the side of the mesh
            NET_CC = 30,
            NET_BRZ = 18, // idle sway: arena air on the mesh (px/s^2 at the hem)
            RIM_W = 24, // rim flex spring (rad/s) + damping ratio: a dunk or a hard hit rings the iron and the net rides it
            RIM_Z = 0.19,
            // idle-sway oscillators: (cos, sin) rotated by 0.011 and 0.00625 rad per tick (plain arithmetic: TS == C#)
            BRC = 0.9999395006100392,
            BRS = 0.010999778168008754,
            BRC2 = 0.9999804688135782,
            BRS2 = 0.006249959309975306;
        static Net[] G_nets;
        /// <summary>One net per hoop (built on first use: partial-class static initializer order across files is not
        /// guaranteed, and this reads HXs).</summary>
        public static Net[] NETS => G_nets ??= G_mkNets();

        static Net[] G_mkNets()
        {
            var r0 = new Net[HXs.Length];
            for (int hi = 0; hi < HXs.Length; hi++)
            {
                double hx = HXs[hi];
                var p = new List<NetKnot>();
                var c = new List<NetCon>();
                var gr = new List<List<NetKnot>>();
                for (int r = 0; r < NR.Length; r++)
                {
                    gr.Add(new List<NetKnot>());
                    for (int k = 0; k < NS; k++)
                    {
                        double a = ((double)k / NS) * 6.283 + (r % 2 != 0 ? 3.1416 / NS : 0);
                        var q = new NetKnot { x = hx + JsMath.Cos(a) * NR[r][0], y = HY + JsMath.Sin(a) * NR[r][0], z = NR[r][1], f = r == 0 };
                        q.px = q.x;
                        q.py = q.y;
                        q.pz = q.z;
                        p.Add(q);
                        gr[r].Add(q);
                    }
                }
                void L(NetKnot a, NetKnot b, double k, int draw = 1) => c.Add(new NetCon { a = a, b = b, rest = Math.Sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y) + (a.z - b.z) * (a.z - b.z)), k = k, draw = draw != 0 });
                for (int r = 1; r < NR.Length; r++)
                    for (int k = 0; k < NS; k++)
                    {
                        int o = r % 2 != 0 ? 0 : -1; // odd rings sit between the knots of the ring above
                        L(gr[r][k], gr[r - 1][(k + o + NS) % NS], 1);
                        L(gr[r][k], gr[r - 1][(k + o + 1) % NS], 1);
                    }
                for (int k = 0; k < NS; k++) L(gr[NR.Length - 1][k], gr[NR.Length - 1][(k + 1) % NS], 0.6); // bottom hem
                for (int r = 1; r < NR.Length - 1; r++) for (int k = 0; k < NS; k++) L(gr[r][k], gr[r][(k + 1) % NS], 0.18, 0); // soft hoop ties
                var N = new Net { p = p.ToArray(), c = c.ToArray(), hx = hx, quiet = 0, ring = 0, wx = 1, wy = 0, wx2 = 0, wy2 = 1 };
                for (int i = 0; i < 240; i++) netTick(N, 1 / 60.0, 0, 0, 0, 0, 0, 0, false, true); // let it hang: the rest pose is its equilibrium
                foreach (var q in N.p) { q.px = q.x; q.py = q.y; q.pz = q.z; }
                r0[hi] = N;
            }
            return r0;
        }

        public const double SEGR = BR + 0.45;
        static double NRX0, NRX1, NRX2;

        /// <summary>One net step: verlet knots (the rim ring pinned to the flexing iron), elastic strands, and (touch) the
        /// ball moving x0 -> x1 in sub-steps with push-out + friction. The mesh displacement the ball caused (its reaction)
        /// -> NRX0..2.</summary>
        static void netTick(Net N, double dt, double x0, double y0, double z0, double x1, double y1, double z1, bool touch, bool settle)
        {
            int SUB = !touch ? 1 : Math.Sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0) + (z1 - z0) * (z1 - z0)) > 4 ? 4 : 2; // (TS: Math.sqrt of the sum, not hypot - bit parity)
            double h = dt / SUB,
                damp = SUB == 1 ? NET_DAMP : SUB == 2 ? Math.Sqrt(NET_DAMP) : Math.Sqrt(Math.Sqrt(NET_DAMP)),
                gz = g * h * h,
                fzz = 100 - N.fz,
                ax = settle ? 0 : NET_BRZ * (N.wx * 0.7 + N.wx2 * 0.3) * h * h,
                ay = settle ? 0 : NET_BRZ * (N.wy * 0.5 + N.wy2 * 0.5) * h * h;
            int its = touch || N.quiet < 120 ? 7 : 3; // (a net nothing has touched for 2 s only sways: a cheaper solve)
            NRX0 = NRX1 = NRX2 = 0;
            for (int sub = 0; sub < SUB; sub++)
            {
                double u1 = (double)(sub + 1) / SUB,
                    bx = x0 + (x1 - x0) * u1,
                    by = y0 + (y1 - y0) * u1,
                    bz = z0 + (z1 - z0) * u1,
                    sx = (x1 - x0) / SUB, // the ball's slide this sub-step
                    sy = (y1 - y0) / SUB,
                    sz = (z1 - z0) / SUB;
                foreach (var q in N.p)
                {
                    if (q.f)
                    {
                        q.pz = q.z; // the rim ring rides the iron
                        q.z = fzz;
                        continue;
                    }
                    double vx = (q.x - q.px) * damp,
                        vy = (q.y - q.py) * damp,
                        vz = (q.z - q.pz) * damp,
                        dep = (100 - q.z) * 0.06; // (the air moves the hem more than the loops at the rim)
                    q.px = q.x;
                    q.py = q.y;
                    q.pz = q.z;
                    q.x += vx + ax * dep;
                    q.y += vy + ay * dep;
                    q.z += vz - gz;
                }
                for (int it = 0; it < its; it++)
                {
                    foreach (var c in N.c)
                    {
                        NetKnot a = c.a,
                            b = c.b;
                        double dx = b.x - a.x,
                            dy = b.y - a.y,
                            dz = b.z - a.z,
                            d = Math.Sqrt(dx * dx + dy * dy + dz * dz);
                        if (!Util.T(d)) d = 1;
                        double f;
                        if (c.k >= 1)
                        {
                            // nylon strand: slack in compression, elastic when stretched, a rope again past the stretch limit
                            if (d <= c.rest) continue;
                            double lim = c.rest * NET_MAXS,
                                st = its == 7 ? NET_STR : NET_STR3;
                            f = d > lim ? ((d - lim + (lim - c.rest) * st) / d) * 0.5 : ((d - c.rest) / d) * 0.5 * st;
                        }
                        else f = ((d - c.rest) / d) * 0.5 * (its == 7 ? c.k : c.k > 0.5 ? NET_HEM3 : NET_TIE3);
                        if (!a.f)
                        {
                            a.x += dx * f;
                            a.y += dy * f;
                            a.z += dz * f;
                        }
                        if (!b.f)
                        {
                            b.x -= dx * f;
                            b.y -= dy * f;
                            b.z -= dz * f;
                        }
                    }
                    if (touch)
                        foreach (var c in N.c)
                        {
                            if (!c.draw) continue;
                            NetKnot a = c.a,
                                b = c.b;
                            double ex = b.x - a.x,
                                ey = b.y - a.y,
                                ez = b.z - a.z,
                                l2 = ex * ex + ey * ey + ez * ez;
                            if (!Util.T(l2)) l2 = 1;
                            double t = clamp(((bx - a.x) * ex + (by - a.y) * ey + (bz - a.z) * ez) / l2, 0, 1),
                                cx = a.x + ex * t - bx,
                                cy = a.y + ey * t - by,
                                cz = a.z + ez * t - bz,
                                d = Math.Sqrt(cx * cx + cy * cy + cz * cz);
                            if (d < SEGR && d > 0)
                            {
                                double push = (SEGR - d) / d;
                                // friction (first pass): the strand follows the ball's slide along it (not the part
                                // pressing into it) - that drags the mesh down on a swish, and the stretched nylon whips
                                // it back up when the ball is through
                                double fx = 0,
                                    fy = 0,
                                    fz = 0;
                                if (it == 0)
                                {
                                    double nx = cx / d,
                                        ny = cy / d,
                                        nz = cz / d,
                                        sn = sx * nx + sy * ny + sz * nz;
                                    fx = (sx - sn * nx) * NET_MU;
                                    fy = (sy - sn * ny) * NET_MU;
                                    fz = (sz - sn * nz) * NET_MU;
                                }
                                for (int e = 0; e < 2; e++)
                                {
                                    var q = e == 0 ? a : b;
                                    double w = e == 0 ? 1 - t : t;
                                    if (q.f) continue;
                                    double mx = (cx * push + fx) * w,
                                        my = (cy * push + fy) * w,
                                        mz = (cz * push + fz) * w;
                                    q.x += mx;
                                    q.y += my;
                                    q.z += mz;
                                    // reaction: the drag (first pass) + what the mesh still pushes back at the end (last pass)
                                    // (the push holds the ball up or down only weakly: a ball leaning on the funnel of the mesh
                                    // drops through it - full support left a ball hovering in the net)
                                    if (bz < 99 && it == 0) { NRX0 += fx * w * NET_RF; NRX1 += fy * w * NET_RF; NRX2 += fz * w * NET_RF; }
                                    if (bz < 99 && it == 6) { NRX0 += mx; NRX1 += my; NRX2 += mz * NET_RUP; }
                                }
                            }
                        }
                }
            }
        }

        /// <summary>Cloth net: verlet knots on elastic nylon strands (slack in compression, stiff past 15% stretch), real
        /// gravity, the rim ring riding the flexing iron, sub-stepped along the ball's real path while it is inside (no
        /// tunnelling). Two-way: strands the ball pushes or drags push back (the net grabs and slows a swish, then whips
        /// back up as the ball drops out); a ball ringing off the iron bends the rim and jerks the loops by the hit (a
        /// ripple runs down and round the mesh); a dunk yanks the rim down and a player hanging on it holds it there; a
        /// slight sway at rest. The ball's motion is read from its positions (not B.v*), so replays (rp: no reaction on
        /// the ball, dt scaled by the replay speed) and online guests drive the net the same way.</summary>
        public static void netSim(double dt, bool rp = false)
        {
            if (!(dt > 0)) return;
            foreach (var N in NETS)
            {
                // the ball's path this tick, from its positions (a teleport - setup, a replay cut - is no motion)
                double jx = B.x - N.bx,
                    jy = B.y - N.by,
                    jz = B.z - N.bz;
                bool cut = N.bok == 0 || Math.Sqrt(jx * jx + jy * jy + jz * jz) > 40;
                double x0 = cut ? B.x : N.bx,
                    y0 = cut ? B.y : N.by,
                    z0 = cut ? B.z : N.bz,
                    vx = cut ? 0 : jx / dt,
                    vy = cut ? 0 : jy / dt,
                    vz = cut ? 0 : jz / dt;
                bool two = !cut && N.bok > 1;
                // the hit the ball took this tick: its velocity change beyond gravity and the net's own pull on it
                double dvx = two ? vx - N.bvx - N.rvx : 0,
                    dvy = two ? vy - N.bvy - N.rvy : 0,
                    dvz = two ? vz - N.bvz - N.rvz + g * dt : 0,
                    J = Math.Sqrt(dvx * dvx + dvy * dvy + dvz * dvz);
                N.bok = cut ? 1 : 2;
                N.bx = B.x;
                N.by = B.y;
                N.bz = B.z;
                N.bvx = vx;
                N.bvy = vy;
                N.bvz = vz;
                N.rvx = N.rvy = N.rvz = 0;
                double ox = B.x - N.hx,
                    oy = B.y - HY,
                    dxy = Math.Sqrt(ox * ox + oy * oy);
                bool near = !cut && dxy < 20 && B.z > 66 && B.z < 114,
                    free = B.owner == null;
                double rd = Math.Sqrt((dxy - RR) * (dxy - RR) + (B.z - 100) * (B.z - 100));
                if (near && free && J > 45 && N.ring <= 0)
                {
                    if (rd < BR + 2.5)
                    {
                        // rim hit: the iron bends (down when hit from above) and the loops by the hit jerk away from it
                        N.ring = 0.1;
                        N.fv += clamp(J * 0.05 * ((B.z - 100) / (Util.T(rd) ? rd : 1) + 0.25), -30, 60);
                        double s0 = Math.Min(2.4, J * 0.008) / J,
                            ux = dxy > 0 ? ox / dxy : 1,
                            uy = dxy > 0 ? oy / dxy : 0;
                        for (int k = NS; k < NS * 3; k++)
                        {
                            var q = N.p[k];
                            double qx = q.x - N.hx,
                                qy = q.y - HY,
                                ql = Math.Sqrt(qx * qx + qy * qy),
                                w = (1 + (qx * ux + qy * uy) / (Util.T(ql) ? ql : 1)) * 0.5,
                                s = s0 * w * w * (k < NS * 2 ? 1 : 0.55);
                            // (verlet velocity = x - px) the loops jump: away from the ball's kick sideways, and up (the
                            // nylon is slack that way, so the hit shows) as the ring snaps
                            q.px += dvx * s;
                            q.py += dvy * s;
                            q.pz -= J * s * 0.6;
                        }
                    }
                    else if (Math.Abs(B.x - (N.hx > 470 ? 900 : 40)) < BR + 2.5 && B.z > 93)
                    {
                        N.ring = 0.1;
                        N.fv += Math.Min(12, J * 0.012); // off the glass: the board shakes the iron a little
                    }
                }
                if (N.ring > 0) N.ring -= dt;
                // a dunk yanks the iron down (once per dunk); a player hanging on it holds it bent
                if (Util.T(B.dk) && N.dk == 0 && near && B.z < 106 && dxy < 10) { N.dk = 1; N.fv += 55; }
                if (!Util.T(B.dk)) N.dk = 0;
                double hang = 0;
                foreach (var p in P) if (p.hangT > 0 && p.z > 15 && (p.x - N.hx) * (p.x - N.hx) + (p.y - HY) * (p.y - HY) < 26 * 26) hang = 2.2;
                N.fv += (-RIM_W * RIM_W * (N.fz - hang) - 2 * RIM_Z * RIM_W * N.fv) * dt;
                N.fz += N.fv * dt;
                if (N.fz > 4) { N.fz = 4; N.fv = Math.Min(0, N.fv); }
                if (N.fz < -1.5) { N.fz = -1.5; N.fv = Math.Max(0, N.fv); }
                // idle sway oscillators (renormalised: no drift)
                {
                    double a = N.wx * BRC - N.wy * BRS,
                        b = N.wx * BRS + N.wy * BRC,
                        l = Math.Sqrt(a * a + b * b),
                        a2 = N.wx2 * BRC2 - N.wy2 * BRS2,
                        b2 = N.wx2 * BRS2 + N.wy2 * BRC2,
                        l2 = Math.Sqrt(a2 * a2 + b2 * b2);
                    if (!Util.T(l)) l = 1;
                    if (!Util.T(l2)) l2 = 1;
                    N.wx = a / l;
                    N.wy = b / l;
                    N.wx2 = a2 / l2;
                    N.wy2 = b2 / l2;
                }
                N.quiet = near ? 0 : N.quiet + 1;
                netTick(N, dt, x0, y0, z0, B.x, B.y, B.z, near, false);
                // reaction on the ball (below the rim only: rim rolls and makes are decided by the iron, not the nylon); a
                // ball that sits slow in the mesh for half a second is let go (nothing may hold a live ball forever)
                bool slow = near && B.z < 99 && dxy < RR && Math.Sqrt(vx * vx + vy * vy + vz * vz) < 25;
                N.hold = slow ? N.hold + dt : 0;
                if (near && free && !rp && B.z < 99 && N.hold < 0.5 && (Util.T(NRX0) || Util.T(NRX1) || Util.T(NRX2)))
                {
                    double K = NET_RK / dt,
                        cap = 45,
                        ex = -clamp(NRX0 * K, -cap, cap),
                        ey = -clamp(NRX1 * K, -cap, cap),
                        ez = -clamp(NRX2 * K, -NET_VCAP, NET_VCAP); // (the nylon kills the sideways speed but only slows the drop)
                    // the funnel of the mesh steers a ball pressing into it back to the middle (it falls out of the hem there)
                    double ux = dxy > 0.3 ? ox / dxy : 0,
                        uy = dxy > 0.3 ? oy / dxy : 0,
                        vr = vx * ux + vy * uy,
                        ac = clamp(-(NET_CK * dxy + NET_CC * vr) * dt, -40, 40);
                    B.vx += ex + ux * ac;
                    B.vy += ey + uy * ac;
                    B.vz += ez;
                    N.rvx = ex + ux * ac;
                    N.rvy = ey + uy * ac;
                    N.rvz = ez;
                }
            }
        }

        /// <summary>Is the ball inside a net right now (between rim and hem)? Used to slow a swish realistically.</summary>
        public static bool inNet()
        {
            foreach (var hx in HXs) if (Hypot(B.x - hx, B.y - HY) < RR - 0.5 && B.z < 100 && B.z > 82) return true;
            return false;
        }

        // ---- instant replays: allocation-free ring buffer of positions + poses (QK: Pose.QK) ----
        public const int RCAP = 331;
        public static readonly int PST = 4 + QK.Length,
            FST = 4 + 10 * PST + 1;
        public static readonly float[] REC = new float[RCAP * FST];
        public static int recS = 0;
        public static int recN = 0;
        /// <summary>Replay kind: 0 normal director, 1 clutch (buzzer beater / game winner) multi-angle sequence.</summary>
        public static double RPK = 0;
        public static double setRPK(double v) => RPK = v;
        public static void recClear()
        {
            recS = recN = 0;
        }
        public static void hlClear() => HL.Clear();

        public static void recFrame()
        {
            if (!cfg.replays || RPL != null) return;
            if (recN >= RCAP)
            {
                recS = (recS + 1) % RCAP;
                recN--;
            }
            int o = ((recS + recN) % RCAP) * FST;
            REC[o] = (float)B.x;
            REC[o + 1] = (float)B.y;
            REC[o + 2] = (float)B.z;
            REC[o + 3] = (float)B.a;
            for (int k = 0; k < P.Count; k++)
            {
                var p = P[k];
                int b = o + 4 + k * PST;
                REC[b] = (float)p.x;
                REC[b + 1] = (float)p.y;
                REC[b + 2] = (float)p.z;
                REC[b + 3] = (float)(p.f + p.ry); // (the drawn facing: hip turns and spins replay too - Pose fv)
                var qq = p.q;
                for (int j = 0; j < QK.Length; j++) REC[b + 4 + j] = qq != null ? (float)qq[j] : float.NaN;
            }
            recN++;
        }

        static void recApply(int n)
        {
            int o = ((recS + n) % RCAP) * FST;
            B.x = REC[o];
            B.y = REC[o + 1];
            B.z = REC[o + 2];
            B.a = REC[o + 3];
            for (int k = 0; k < P.Count; k++)
            {
                var p = P[k];
                int b = o + 4 + k * PST;
                p.x = REC[b];
                p.y = REC[b + 1];
                p.z = REC[b + 2];
                p.f = REC[b + 3];
                p.ry = 0; // (the recorded facing already carries it)
                if (!float.IsNaN(REC[b + 4]))
                {
                    if (p.q == null) p.q = new Q();
                    for (int j = 0; j < QK.Length; j++) p.q[j] = REC[b + 4 + j];
                    p.posed = true;
                }
            }
        }

        public static LiveState LIVE = null;
        /// <summary>Replay speed (slow motion by default; [ and ] change it).</summary>
        public static readonly double[] RSP = { 0.15, 0.25, 0.4, 0.7, 1 };
        public static double RSPD = 0.4;
        public static double setRplSpeed(double d) => RSPD = RSP[(int)clamp(Array.IndexOf(RSP, RSPD) + d, 0, RSP.Length - 1)];
        /// <summary>Game highlights (copies of the replay buffer) for the end-of-game reel and saved reels.</summary>
        public static readonly List<Highlight> HL = new List<Highlight>();
        public static string HLN = ""; // label for the next highlight
        public static string setHLN(string s) => HLN = s;
        public static int FSTN() => FST;

        static void saveHL()
        {
            int n = Math.Min(250, recN);
            var buf = new float[n * FST];
            for (int k = 0; k < n; k++)
            {
                int o = ((recS + recN - n + k) % RCAP) * FST;
                Array.Copy(REC, o, buf, k * FST, FST);
            }
            HL.Add(new Highlight { s = string.IsNullOrEmpty(HLN) ? "Highlight" : HLN, n = n, buf = buf, q = q });
            HLN = "";
            if (HL.Count > 8) HL.RemoveAt(0);
        }

        static LiveState G_live()
        {
            var l = new LiveState { p = new double[P.Count][], q = new Q[P.Count], b = new[] { B.x, B.y, B.z, B.a } };
            for (int k = 0; k < P.Count; k++)
            {
                var p = P[k];
                l.p[k] = new[] { p.x, p.y, p.z, p.f };
                if (p.q != null)
                {
                    var c = new Q();
                    c.CopyFrom(p.q);
                    l.q[k] = c;
                }
            }
            return l;
        }

        /// <summary>Load a saved clip into the replay buffer and play it (end-of-game reel / saved reel).</summary>
        public static void playClip(Highlight c)
        {
            recS = 0;
            recN = (int)Math.Min(c.n, RCAP);
            Array.Copy(c.buf, 0, REC, 0, recN * FST);
            LIVE = G_live();
            RPL = new ReplayState { i = 0, reel = 1, rs = rs, k = Util.T(c.k) ? c.k : 1 };
        }

        public static void startReplay()
        {
            LIVE = G_live();
            RPL = new ReplayState { i = Math.Max(0, recN - 250) };
            if (cfg.replays && !Util.T(PREDICT)) saveHL();
        }

        public static void skipReplay()
        {
            if (RPL != null) RPL.i = 1e9;
        }

        public static void rplStep(double dt)
        {
            var r = RPL;
            r.i += dt * 60 * RSPD * (Util.T(r.k) ? r.k : 1);
            int n = (int)Math.Floor(r.i);
            if (n >= recN - 1)
            {
                if (LIVE != null) // (TS throws without a saved live state; never happens on the host)
                {
                    for (int k = 0; k < P.Count; k++)
                    {
                        var p = P[k];
                        var l = LIVE.p[k];
                        p.x = l[0];
                        p.y = l[1];
                        p.z = l[2];
                        p.f = l[3];
                        p.q = LIVE.q[k];
                    }
                    B.x = LIVE.b[0];
                    B.y = LIVE.b[1];
                    B.z = LIVE.b[2];
                    B.a = LIVE.b[3];
                }
                double reel = r.reel;
                RPL = null;
                RQ = 0;
                RPK = 0;
                recClear();
                rs = Util.T(reel) ? r.rs : 0.001; // a reel (halftime / final) must not trigger the next inbound
                return;
            }
            recApply(n);
        }

        /// <summary>Replay state for online guests: host says "replay at frame i".</summary>
        public static ReplayState setRPL(ReplayState v) => RPL = v;
    }
}
