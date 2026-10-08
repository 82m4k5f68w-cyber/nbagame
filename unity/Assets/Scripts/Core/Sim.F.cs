// Port of src/core/sim.ts lines 3247-3668: upd (the 60 Hz tick), deadBall, postGame, endGame, foul, tech, startFT,
// ftLay, ftTick, ftIn, OFFS, STAT (+ stat / statAdd helpers). (Play / PLAY, declared at the end of this TS range, are
// ported with newPlay in Sim.G.cs.)
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
        public Player helpP; // teammate he is helping up (deadBall)
        public double pgDap, hcx, hcy, hudT, eng; // post-game dap done, huddle centre, hands-in timer, body english side
    }

    public static partial class Sim
    {
        // truthiness of a field whichever type the owning part chose (bool or number)
        static bool F_on(bool v) => v;
        static bool F_on(double v) => Util.T(v);
        static bool F_on(double? v) => Util.T(v);

        static readonly Input UPD_A = new Input(); // rebound-assist scratch input (TS: a fresh { dx: 0, dy: 0 })
        static readonly Input FT_IN = new Input(); // free-throw shooter input (TS: a fresh object every tick)

        public static void upd(double dt)
        {
            int NP = cfg.NP;
            T += dt;
            DT = dt;
            fc -= dt;
            if (RPL != null)
            {
                rplStep(dt);
                return;
            }
            if (S != "play") return;
            foreach (var c in CT) c.inp = cfg.input != null ? cfg.input(c) : ZIN();
            if (JB != null)
            {
                jbStep(dt);
                netSim(dt);
                recFrame();
                foreach (var p in P) pose3(p);
                return;
            }
            for (int k = 0; k < P.Count; k++)
            {
                var p = P[k];
                if (inb > 0 || (ftq != null && p != ftq.s) || F_on(p.off))
                {
                    p.@in = zin(k);
                    if (inb > 0 && Util.T(INB.on) && !F_on(p.off) && ctrlOf(k) == null && p != B.owner) inbMove(p);
                    continue;
                }
                var c = ctrlOf(k);
                if (c != null) p.@in = rs > 0 ? zin(k) : c.inp;
                else ai(p, dt);
            }
            // Rebound/loose-ball assist for idle humans.
            foreach (var c in CT)
            {
                var h = c.inp;
                if (rs <= 0 && B.owner == null && ftq == null && inb <= 0 && (B.mode != "pass" || B.to == P[c.idx]))
                {
                    var q = P[c.idx];
                    if (!Util.T(h.dx) && !Util.T(h.dy) && !h.sd && q.mode == "i")
                    {
                        q.@in = zin(c.idx);
                        loose(q, q.tm);
                    }
                    else if (q.mode == "i" && B.mode == "air" && Hypot(B.x - q.x, B.y - q.y) < 150)
                    {
                        var a = UPD_A;
                        a.Clear();
                        var sv = q.@in;
                        q.@in = a;
                        loose(q, q.tm);
                        q.@in = sv;
                        sv.dx = sv.dx * 0.4 + a.dx * 0.9;
                        sv.dy = sv.dy * 0.4 + a.dy * 0.9;
                        if (a.sd || (q.z <= 0 && B.z > 45 && Hypot(B.x - q.x, B.y - q.y) < 34)) sv.sd = true;
                    }
                }
            }
            foreach (var c in CT)
            {
                var h = c.inp;
                if (h.to && !callTO(c.tm)) txt(TS.to[c.tm] > 0 ? "TIMEOUT: only with the ball or at a dead ball" : "NO TIMEOUTS LEFT", 480, 240, "#ff9966");
                if (h.ch && !challenge(c.tm)) txt(TS.chal[c.tm] <= 0 ? "CHALLENGE ALREADY USED" : "NOTHING TO CHALLENGE", 480, 240, "#ff9966");
                if (h.ds)
                {
                    bool off = pos == c.tm && B.owner != null;
                    if (off) TS.pc[c.tm] = (TS.pc[c.tm] + 1) % PCN.Length;
                    else TS.ds[c.tm] = (TS.ds[c.tm] + 1) % DSN.Length;
                    if (off) PLAY[c.tm] = null;
                    txt(off ? "PLAY CALL: " + PCN[(int)TS.pc[c.tm]] : "DEFENSE: " + DSN[(int)TS.ds[c.tm]], 480, 150, "#9fe7ff");
                }
            }
            ftIn(dt);
            if (inb > 0)
            {
                inb -= dt;
                if (inb <= 0 && B.owner != null && B.mode == "held")
                {
                    var o = B.owner;
                    if (NP > 1 && cfg.HALF == 0)
                    {
                        Player b = null;
                        double bv = -1e9;
                        foreach (var q in P)
                            if (q.tm == o.tm && q != o)
                            {
                                var nd = P[(int)nearest(1 - o.tm, q.x, q.y)];
                                double v = Math.Min(80, Hypot(nd.x - q.x, nd.y - q.y)) - Hypot(q.x - o.x, q.y - o.y) * 0.1;
                                if (v > bv)
                                {
                                    bv = v;
                                    b = q;
                                }
                            }
                        pass(o, b, 0);
                    }
                }
            }
            // Which player each human controls.
            foreach (var c in CT)
            {
                if (c.inp.sw && !c.fixed_ && !(B.owner != null && B.owner.tm == c.tm)) c.idx = (int)nearestFree(c, B.x, B.y, c.idx);
                if (c.fixed_) c.idx = c.tm * NP; // My Player is always slot 0 of his team (and shoots his own FTs)
                else if (B.owner != null && B.owner.tm == c.tm)
                {
                    int k = (int)(c.tm * NP + B.owner.k);
                    bool taken = false;
                    foreach (var o in CT) if (o != c && o.idx == k) { taken = true; break; }
                    if (!taken) c.idx = k;
                }
                else if (B.owner != null)
                {
                    if (B.owner != c.lastO) c.idx = (int)nearestFree(c, B.owner.x, B.owner.y);
                }
                else if (P[c.idx].mode != "s") c.idx = (int)nearestFree(c, B.x, B.y);
                c.lastO = B.owner;
            }
            if ((rs > 0 || inb > 0) && !Util.T(PREDICT) && F_on(cfg.PRO)) deadBall(dt);
            if (HOOK.pre != null) HOOK.pre(dt);
            foreach (var p in P) if (!F_on(p.off)) step(p, dt);
            if (cfg.PP != 0) upTick(dt);
            // body english: the shooter leans and waves at a ball rolling around the rim
            if (Util.T(B.sh) && !Util.T(B.sc) && B.owner == null && B.last != null && !F_on(B.last.off))
            {
                var L = B.last;
                double hx = hoop(L.tm),
                    d = Hypot(B.x - hx, B.y - HY);
                if (d < 15 && B.z > 88 && B.z < 118)
                {
                    double ux = hx - L.x,
                        uy = HY - L.y,
                        ulh = Hypot(ux, uy),
                        ul = Util.T(ulh) ? ulh : 1;
                    L.engT = 0.25;
                    L.eng = clamp((((B.x - hx) * -uy + (B.y - HY) * ux) / ul) / 6, -1, 1);
                }
            }
            collide();
            if (useRap() && cfg.playerBodies) Phys.RAP.SyncPlayers(P, B);
            bstep(dt / 2);
            bstep(dt / 2);
            ftTick(dt);
            netSim(dt);
            recFrame();
            lagRec();
            foreach (var p in P) pose3(p);
            if (HOOK.post != null && HOOK.post(dt)) return;
            if (rs > 0)
            {
                rs -= dt;
                if (TS.hud > 0) TS.hud = Math.Max(0, TS.hud - dt); // (always: deadBall only runs with Pro Play on)
                if (rs <= 0)
                {
                    if (Util.T(RQ) && recN > 80)
                    {
                        startReplay();
                        return;
                    }
                    setup(pend);
                }
                return;
            }
            if (clock > 0 && ftq == null && inb <= 0) clock = Math.Max(0, clock - dt);
            if (q >= 4 && Math.Abs(sc[0] - sc[1]) <= 6 && B.owner != null && Math.Floor(T / 2.6) != Math.Floor((T - dt) / 2.6)) fx(new Fx { k = "chant", tm = 1 - pos, hasTm = true });
            if (gameLike()) rulesTick(dt);
            if (S != "play" || rs > 0) return; // a violation / timeout just stopped play
            if (B.owner != null && ftq == null && inb <= 0 && F_on(cfg.SCLK)) shot -= dt;
            if (shot <= 0 && ftq == null)
            {
                txt("SHOT CLOCK!", 470, 200, "#ff6b4a");
                setup(1 - pos);
            }
            if (clock <= 0 && ftq == null && !(Util.T(B.sh) && B.owner == null))
            {
                if (q >= 4 && sc[0] != sc[1]) endGame();
                else
                {
                    TS.qs.Add(new[] { sc[0], sc[1] });
                    q++;
                    tf = new double[] { 0, 0 };
                    foreach (var p in P) p.en = Math.Min(1, p.en + 0.25); // quarter break (TS: p.en ?? 1; en starts at 1)
                    if (q == 3 && !Util.T(TS.half))
                    {
                        TS.half = 1;
                        fx(new Fx { k = "half" });
                    }
                    clock = q > 4 ? (cfg.GM == "clutch" || cfg.GM == "daily" ? 30 : QTRLEN / 2) : QTRLEN; // scenario overtime: 30 real seconds
                    setup(q % 2 != 0 ? 0 : 1);
                    txt(q > 4 ? "OVERTIME" : "QUARTER " + q, 470, 200, "#ffd23f");
                }
            }
        }

        /// <summary>Dead balls: after a make everyone jogs back up the floor instead of standing frozen, teammates slap
        /// five, players tug their jerseys; a man on the floor gets helped up by the nearest teammate (also during inbounds).</summary>
        public static void deadBall(double dt)
        {
            int NP = cfg.NP;
            foreach (var p in P)
            {
                if (F_on(p.off) || (ftq != null && ftq.i >= 0)) continue;
                // help a teammate up
                if (!(p.actT > 0) && p.z <= 0 && p.mode == "i")
                {
                    Player f = null;
                    foreach (var o in P)
                        if (o.tm == p.tm && o != p && o.act == 3 && o.actT > 0.25 && Hypot(o.x - p.x, o.y - p.y) < 130) { f = o; break; }
                    if (f != null)
                    {
                        // first of the teammates (other than f) stably sorted by distance to f
                        Player nb = null;
                        double nbd = 0;
                        foreach (var o in P)
                            if (o.tm == p.tm && o != f)
                            {
                                double od = Hypot(o.x - f.x, o.y - f.y);
                                if (nb == null || od < nbd) { nb = o; nbd = od; }
                            }
                        if (nb == p)
                        {
                            double d = Hypot(f.x - p.x, f.y - p.y);
                            if (d > 13)
                            {
                                p.@in.dx = ((f.x - p.x) / d) * 0.7;
                                p.@in.dy = ((f.y - p.y) / d) * 0.7;
                            }
                            else
                            {
                                p.@in.dx = p.@in.dy = 0;
                                p.helpP = f;
                                if (!(p.celT > 0)) { p.cel = 16; p.celT = 0.9; }
                                f.actT = Math.Min(f.actT, 0.45);
                            }
                            continue;
                        }
                    }
                }
                if (rs <= 0) continue; // inbounds: everyone else holds his spot
                if (TS.hud > 0 && cfg.HALF == 0)
                {
                    // timeout huddle: a tight circle in front of the bench (far sideline), facing in; hands in at the end
                    int n = 0, j = -1;
                    foreach (var o in P)
                        if (o.tm == p.tm && !F_on(o.off))
                        {
                            if (o == p) j = n;
                            n++;
                        }
                    double cx = 470 + (Util.T(p.tm) ? 1 : -1) * 130,
                        cy = 34,
                        a = ((double)j / n) * Math.PI * 2 + 0.4,
                        r = 15 + n * 2,
                        tx = cx + Math.Cos(a) * r,
                        ty = cy + Math.Sin(a) * r,
                        d = Hypot(tx - p.x, ty - p.y);
                    p.hcx = cx;
                    p.hcy = cy;
                    if (d > 5)
                    {
                        p.@in.dx = ((tx - p.x) / d) * Math.Min(0.75, d / 40);
                        p.@in.dy = ((ty - p.y) / d) * Math.Min(0.75, d / 40);
                    }
                    else
                    {
                        p.@in.dx = p.@in.dy = 0;
                        p.f = Math.Atan2(cy - p.y, cx - p.x);
                    }
                    p.hudT = d < 12 && TS.hud < 0.75 ? 0.2 : 0; // hands in
                    continue;
                }
                // jog back: the team inbounding toward its backcourt, the other team back on defense
                bool offT = p.tm == pend;
                double txj = offT ? hoop(1 - pend) + (hoop(1 - pend) > 470 ? -170 : 170) : hoop(pend) + (hoop(pend) > 470 ? -150 : 150),
                    dx = txj - p.x;
                if (Math.Abs(dx) > 30 && !(p.celT > 0 && p.cel != 9))
                {
                    p.@in.dx = Sign(dx) * 0.42;
                    p.@in.dy = (250 + (p.k - (NP - 1) / 2.0) * 80 - p.y) / 300;
                }
                if (!(p.celT > 0) && Rng.R() < dt * 0.12) { p.cel = 15; p.celT = 0.9; } // tug the jersey
            }
            // a quick low five between the scorer's teammates right after the bucket
            if (rs > 1.36 && rs < 1.4 && B.last != null && Rng.R() < 0.5)
            {
                var L = B.last;
                Player m = null;
                double md = 0;
                foreach (var o in P)
                    if (o.tm == L.tm && o != L && !F_on(o.off))
                    {
                        double od = Hypot(o.x - L.x, o.y - L.y);
                        if (m == null || od < md) { m = o; md = od; }
                    }
                if (m != null && !(L.celT > 0) && Hypot(m.x - L.x, m.y - L.y) < 90)
                {
                    L.cel = 9; L.celT = 1.1;
                    m.cel = 9; m.celT = 1.1;
                }
            }
        }

        /// <summary>After the final buzzer (S === "over"): everyone walks toward his opposite number and daps him up.</summary>
        public static void postGame(double dt)
        {
            if (S != "over" || RPL != null) return;
            T += dt;
            DT = dt;
            int NP = cfg.NP;
            for (int k = 0; k < NP; k++)
            {
                Player a = k < P.Count ? P[k] : null,
                    b = NP + k < P.Count ? P[NP + k] : null;
                if (a == null || b == null) continue;
                double mx = (a.x + b.x) / 2,
                    my = (a.y + b.y) / 2;
                for (int w = 0; w < 2; w++)
                {
                    Player p = w == 0 ? a : b, o = w == 0 ? b : a;
                    double sx = p.x - o.x,
                        tx = mx + Sign(Util.T(sx) ? sx : 1) * 7,
                        dx = tx - p.x,
                        dy = my - p.y,
                        d = Hypot(dx, dy),
                        v = d > 4 ? Math.Min(110, d * 2) : 0;
                    p.vx = d > 0 ? (dx / d) * v : 0;
                    p.vy = d > 0 ? (dy / d) * v : 0;
                    p.x += p.vx * dt;
                    p.y += p.vy * dt;
                    p.z = 0;
                    p.mode = "i";
                    p.ph += ((v * dt) / stepLen(v)) * Math.PI;
                    double tfa = d > 6 ? Math.Atan2(dy, dx) : Math.Atan2(o.y - p.y, o.x - p.x);
                    p.f += Math.Atan2(Math.Sin(tfa - p.f), Math.Cos(tfa - p.f)) * Math.Min(1, dt * 8);
                    if (d < 6 && !(p.celT > 0) && !Util.T(p.pgDap)) { p.cel = 9; p.celT = CEL_T; p.pgDap = 1; }
                    if (p.celT > 0) p.celT = Math.Max(0, p.celT - dt);
                }
            }
            if (B.owner != null) B.owner = null;
            foreach (var p in P) pose3(p);
        }

        public static void endGame()
        {
            S = "over";
            fx(new Fx { k = "end", w = sc[0] > sc[1] ? 0 : 1 });
            if (HOOK.end != null) HOOK.end();
            snd(sc[0] > sc[1] ? 800 : 200, 0.5, "triangle");
        }

        public static void foul(Player d, Player o, string k, double sh, double th, double flag = 0)
        {
            fx(new Fx { k = "whistle", tm = d.tm, hasTm = true });
            tf[(int)d.tm]++;
            d.pf++;
            statAdd("fouls", 1);
            statAdd("f_" + k, 1);
            whistle(d, o, k == "SHOOTING" ? LASTP_FOUL : 0.6);
            if (!Util.T(PREDICT) && Rng.R() < 0.55) { d.cel = 12; d.celT = CEL_T; } // palms up: "I got ball!"
            txtW(k + " FOUL", d.x, d.y, 95, "#ff6b4a");
            snd(120, 0.3, "sawtooth", 0.1);
            B.sh = 0;
            B.ft = 0;
            double n = F_on(cfg.HALF) ? 0 : Util.T(sh) ? (Util.T(th) ? 3 : 2) : tf[(int)d.tm] >= 5 ? 2 : 0;
            if (Util.T(n))
            {
                startFT(o, n, Util.T(flag) ? o.tm : 0, 0);
                if (Util.T(flag)) ftq.keep = 1;
                if (!Util.T(flag) && tf[(int)d.tm] == 5 && !Util.T(sh)) txt("BONUS", 480, 230, "#ffd23f");
            }
            else
            {
                B.owner = o;
                B.mode = "held";
                setupAt(o.tm, o.x, o.y); // (side out at the spot of the foul)
            }
        }

        public static void tech(Player d, double ret)
        {
            if (!F_on(cfg.FOULS)) return;
            cm("tech", d.n);
            txtW("TECHNICAL FOUL", d.x, d.y, 95, "#ff3b3b");
            Player b = null;
            foreach (var p in P) if (p.tm != d.tm && (b == null || p.c > b.c)) b = p;
            B.sh = 0;
            startFT(b, 1, ret, 1);
        }

        public static void startFT(Player s, double n, double ret = 0, double tech = 0)
        {
            statAdd("fts", n);
            ftq = new FtQueue { s = s, n = n, i = -1, ret = ret, tech = tech, next = 0.9, w = 1.2, fired = 0 };
        }

        static readonly double[][] FT_SPOTS = { new double[] { 262, 0 }, new double[] { 215, -165 }, new double[] { 215, 165 }, new double[] { 262, -60 }, new double[] { 262, 60 } };
        static readonly int[] FT_LANE_K = { 0, 0, 1, 1, 2, 2 };
        static readonly bool[] FT_LANE_DEF = { true, true, false, false, true, true };

        public static void ftLay()
        {
            var f = ftq;
            var s = f.s;
            double hx = hoop(s.tm),
                d = hx > 470 ? -1 : 1,
                fc0 = hx > 470 ? 0 : Math.PI;
            // NBA lane: on each side the defense has the low block, then the offense, then the defense (bigs first);
            // everybody else waits behind the arc (the shooter's team up top for the long rebound, the rest on the wings)
            foreach (var p in P)
            {
                p.vx = p.vy = p.z = p.vz = 0;
                p.mode = "i";
            }
            List<Player> df = ftByHt(1 - s.tm, s), of = ftByHt(s.tm, s);
            int side = 0;
            for (int li = 0; li < FT_LANE_K.Length; li++)
            {
                var arr = FT_LANE_DEF[li] ? df : of;
                int k = FT_LANE_K[li];
                if (arr.Count == 0) continue;
                var p = arr[0];
                arr.RemoveAt(0);
                p.x = hx + d * (70 + k * 28);
                p.y = 250 + ((side++ & 1) != 0 ? 46 : -46);
                p.f = p.y < 250 ? Math.PI / 2 : -Math.PI / 2; // facing across the lane, at the rim side
                p.f += d * 0.35 * (p.y < 250 ? 1 : -1);
            }
            var rest = new List<Player>(of);
            rest.AddRange(df);
            for (int j = 0; j < rest.Count; j++)
            {
                var p = rest[j];
                var sp = FT_SPOTS[j % FT_SPOTS.Length];
                p.x = hx + d * sp[0];
                p.y = 250 + sp[1];
                p.f = fc0;
            }
            s.x = hx + d * 137;
            s.y = 250;
            s.f = fc0;
            s.ai = new PlayerAi();
            B.owner = s;
            B.mode = "held";
            B.sh = 0;
            B.sc = 0;
            B.ft = 1;
            pos = s.tm;
            shot = 24;
        }

        static List<Player> ftByHt(double t, Player s)
        {
            var l = new List<Player>();
            foreach (var p in P) if (p.tm == t && p != s && !F_on(p.off)) l.Add(p);
            SortStable(l, (a, b) => Cmp(b.ht - a.ht));
            return l;
        }

        public static void ftTick(double dt)
        {
            var f = ftq;
            if (f == null) return;
            if (f.next > 0)
            {
                f.next -= dt;
                if (f.next <= 0)
                {
                    f.fired = 0;
                    f.w = 1.1;
                    if (f.i + 1 < f.n)
                    {
                        f.i++;
                        ftLay();
                    }
                    else
                    {
                        ftq = null;
                        if (Util.T(f.tech) || Util.T(f.keep)) setup(f.ret);
                    }
                }
                return;
            }
            // a missed free throw (not the last) is dead: line up for the next one - also when the miss caroms straight
            // back into somebody's hands (a shooter who caught his own miss held the sequence forever)
            if (Util.T(f.fired) && !Util.T(B.sc) && (B.age > 1.3 || (B.owner != null && B.age > 0.3))) f.next = 0.3;
        }

        public static void ftIn(double dt)
        {
            var f = ftq;
            if (f == null || f.i < 0) return;
            var s = f.s;
            var a = s.ai;
            int k = P.IndexOf(s);
            // A human on the shooter's team shoots it (My Player only shoots his own).
            Ctrl c = null;
            foreach (var o in CT) if (o.tm == s.tm && (!o.fixed_ || s.my)) { c = o; break; }
            var si = FT_IN; // (TS assigns a fresh input object every tick)
            si.Clear();
            if (c != null)
            {
                c.idx = k;
                var h = c.inp;
                si.sd = h.sd;
                si.su = h.su;
                si.mt = h.mt;
                si.tp = h.tp;
                s.@in = si;
            }
            else
            {
                s.@in = si;
                f.w -= dt;
                if (f.w < 0 && s.mode == "i" && !Util.T(f.fired))
                {
                    s.@in.sd = true;
                    a.rel = 0.6 + (Rng.R() - 0.5) * 0.1;
                }
                if (s.mode == "c" && s.t >= (Util.T(a.rel) ? a.rel : 0.6)) s.@in.su = true;
            }
        }

        public static readonly Player[] OFFS = { null, null };

        /// <summary>Game counters (tests / tuning): screens that connected, shooting fouls, and-ones.</summary>
        public static readonly Dictionary<string, double> STAT = new Dictionary<string, double> { { "screens", 0 }, { "shootFouls", 0 }, { "andOnes", 0 }, { "fouls", 0 }, { "fts", 0 } };
        /// <summary>STAT[key] || 0</summary>
        public static double stat(string key) => STAT.TryGetValue(key, out var v) ? v : 0;
        /// <summary>STAT[key] = (STAT[key] || 0) + v</summary>
        public static void statAdd(string key, double v) => STAT[key] = stat(key) + v;
    }
}
