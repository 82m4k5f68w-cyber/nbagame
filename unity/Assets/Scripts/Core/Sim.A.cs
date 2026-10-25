// Port of src/core/sim.ts lines 1-1037: header constants, cfg, module state, FX helpers, setters, rosters, start, jump
// ball, players / reserves, badges + hot zones, team state, scouting + game plans, timeouts / challenges / subs, rule
// ticks, violations + spot inbounds, tendencies, matchups, nearest.
using System;
using System.Collections.Generic;
using System.Globalization;
using static Hoops.Core.Util;
using static Hoops.Core.Data;
using static Hoops.Core.Sim;
using static Hoops.Core.Pose;

namespace Hoops.Core
{
    // ---------------- helper classes for TS object literals in this part ----------------

    /// <summary>Mode flags (sim.ts cfg). NP and physics are set by the shell before start().</summary>
    public sealed class Cfg
    {
        public int NP = 5;
        public int PRO = 1;
        public int AVOID = 1; // arms/shoulders kept out of other players' torsos (0 = off, A/B tests)
        public int PLANT = 1; // stance feet pinned to the floor in the core pose (0 = off)
        public int INZ = 1; // inertialized animation blending (0 = old exponential smoothing)
        public int AP = 1; // animation pack v5.4 (shared with TS cfg.AP): the Pose.UP.cs pose layer runs with AP or UP; 0 = v5.3 poses
        public int TP = 1; // team play pack v5.4 (Sim.TP.cs); 0 = off (A/B tests)
        public int PP = 2; // Pro Play level (shared with the TS sim: cfg.PP): 2 = v5.4 (Sim.PP2.cs: reads, pull-ups, body-ups, post battles, off-ball calls), 1 = v5.3 pack (Sim.UP.cs), 0 = the v5.2 game
        public int UP = 0; // Unity Pro Play upgrades (Sim.UP.cs / Pose.UP.cs): new moves, finishes, reactions. 0 = TS parity
        public double PHYS = 0.5; // ball physics feel with UP (Sim.PH.cs / BallSim): 0 arcade .. 1 sim (restitution, spin, contact strength)
        public string physics = "rapier"; // "rapier" | "legacy"
        public bool hand = true; // release from the rig's real hand (3D) instead of a fixed height (2D legacy)
        public bool replays = true;
        public int MYM = 0;
        public int DIFF = 1; // CPU difficulty: 0 Rookie, 1 Pro, 2 All-Star, 3 Hall of Fame
        public bool playerBodies = true; // kinematic player capsules (ball can deflect off bodies)
        public int JB = 1; // opening jump ball (0 = start with an inbound)
        // ---- custom rules (settings drawer) ----
        public int FOULS = 1, SCLK = 1, VIOL = 1, SUBS = 1, BADGES = 1, ONLINE = 0, HALF = 0;
        public double TO = 0; // points to win (street / king); 0 = timed quarters
        public int ASTAR = 0;
        public string GM = "game"; // game | practice | tutorial | 3pt | dunk | horse | clutch | street | king | allstar | daily
        public Func<Ctrl, Input> input;
    }

    /// <summary>Game-mode hooks (modes.ts): pre after inputs/AI, post after posing (true = skip the rest), end.</summary>
    public sealed class Hook
    {
        public Action<double> pre;
        public Func<double, bool> post;
        public Action end;
    }

    /// <summary>Authoritative scalar state for online guests (setScalars). Null / unset = keep the current value.</summary>
    public sealed class Scalars
    {
        public string S;
        public double? q, clock, shot, pos, rs, inb, T;
        public double[] sc, tf;
        public bool hasFtq; // TS: "ftq" in o
        public FtQueue ftq;
        public string[] cl, PC;
    }

    /// <summary>Free-throw queue (sim.ts ftq, see startFT).</summary>
    public sealed class FtQueue
    {
        public Player s;
        public double n, i = -1, ret, tech, next = 0.9, w = 1.2, fired, keep;
    }

    /// <summary>Replay cursor (sim.ts RPL): frame i, reel flag, restore rs, speed k.</summary>
    public sealed class ReplayState
    {
        public double i, reel, rs, k;
    }

    /// <summary>Opening tip (sim.ts JB).</summary>
    public sealed class JumpBall
    {
        public double t;
        public Player[] c;
        public double[] jt, ai;
    }

    public sealed class AllEntry
    {
        public int t;
        public Tuple a;
    }

    /// <summary>My Player editable data (MYP.d).</summary>
    public sealed class MyPlayerData
    {
        public string n = "MY PLAYER", sk = "#c68642", col = "#e8541e";
        public double c = 80, i = 78, s = 80, d = 72, j = 60, st = 0, hr = 1, bd = 0, ht = 6.6, bk = 1, no = 1;
    }

    public sealed class MyPlayer
    {
        public MyPlayerData d = new MyPlayerData();
        public Tuple t;
    }

    public sealed class StartOpts
    {
        public double? j, sel;
    }

    public sealed class ShotRec
    {
        public double t, x, y, m, th, q;
    }

    /// <summary>Last whistle that can be challenged {t: team that can challenge, d, o, until, p}.</summary>
    public sealed class WhistleCall
    {
        public double t, until, p;
        public Player d, o;
    }

    /// <summary>Broadcast splits per team.</summary>
    public sealed class Splits
    {
        public double[] paint = new double[2], fb = new double[2], sec = new double[2];
    }

    /// <summary>Team state (sim.ts TS).</summary>
    public sealed partial class TeamState
    {
        public double[] to = { 4, 4 };
        public double[] ds = { 0, 0 }; // 0 normal, 1 sag, 2 tight / deny, 3 switch everything, 4 2-3 zone (5v5)
        public double[] pc = { 0, 0 }; // 0 auto, 1 pick-and-roll, 2 pindown, 3 flare, 4 isolation
        public double[] chal = { 1, 1 };
        public double[] run = { 0, 0 }; // [team, points] of the current unanswered run
        public double mom, clutch, half;
        public double[] lane = new double[10]; // seconds in the paint per slot
        public double bc; // seconds the ball has been in the backcourt this possession
        public WhistleCall call;
        public double gt;
        public double[][] mu = new double[2][]; // matchups per team (defender slot -> opponent slot), null = none
        public double adv = -1; // team whose next inbound is advanced to the frontcourt (late timeout)
        public List<double[]> qs = new List<double[]>(); // cumulative score at the end of each quarter
        public Scout[] sk = { scoutNew(), scoutNew() };
        public double[] gp = { 0, 0 }, gpT = { 0, 0 }, trT = { -99, -99 }, tr = { 0, 0 }, fbA = { -1, -1 };
        public Splits xs = new Splits();
        public double[] orbP = { 0, 0 }, cov = { 0, 0 }, dbl = { -1, -1 };
        public double hud;
    }

    /// <summary>Spot-inbound action (sim.ts INB).</summary>
    public sealed class InbState
    {
        public double on, tm;
        public Dictionary<Player, double[]> tg = new Dictionary<Player, double[]>();
    }

    /// <summary>form(p, r): pct -1 = not enough shots. A struct so per-tick callers allocate nothing.</summary>
    public readonly struct ShotForm
    {
        public readonly double pct, ct, n;
        public ShotForm(double pct, double ct, double n) { this.pct = pct; this.ct = ct; this.n = n; }
    }

    public partial class Player
    {
        // also used here, declared by other parts: heat, off, cel, celT (double), hupT (double), mvEnd (double?)
        public double fo, inAt;
        public Player sub;
    }

    public static partial class Sim
    {
        static readonly HashSet<string> SIGN = new HashSet<string> { "Curry", "Doncic", "Jokic", "Wembanyama", "Edwards", "Gilgeous-Alexander", "Brunson", "Towns", "Fox", "LaMelo Ball", "Porzingis", "Holmgren" };
        public static bool SIGK(Player p) => p.n != null && SIGN.Contains(p.n);

        public const double CW = 940, CH = 500, g = 320, HY = 250, RR = 7.5, BR = 3.9;
        public static readonly double[] HXs = { 52.5, 887.5 };
        /// <summary>The basket team t attacks. Half-court games: everyone plays at the right basket.</summary>
        public static double hoop(double t) => cfg.HALF != 0 ? HXs[1] : T(t) ? HXs[0] : HXs[1];
        public static double clamp(double v, double a, double b) => Math.Max(a, Math.Min(b, v));
        public static double[] W3(double x, double y, double z = 0) => new[] { (x - 470) * 0.1, z * 0.1, (y - 250) * 0.1 };

        public static Cfg cfg = new Cfg();

        public static string S = "menu";
        public static List<Player> P = new List<Player>();
        public static Ball B = new Ball();
        public static double[] sc = { 0, 0 };
        public static double q = 1, clock = 60, shot = 24, pos = 0, T = 0, rs = 0, pend = 0, fin = 0;
        public static string[] cl = { "", "" };
        public static string[] PC = { "#7b3fb5", "#1d428a" };
        public static double[] PCNT = { 0, 0 }, LASTP = { -9, -9 };
        public static double DT = 0.016, fc = 0;
        public static FtQueue ftq = null;
        public static double[] tf = { 0, 0 };
        public static double inb = 0, RQ = 0;
        public static ReplayState RPL = null;
        public static double QTRLEN = 60;
        public static List<Ctrl> CT = new List<Ctrl> { mkCtrlRaw("p1", 0) };
        static Ctrl mkCtrlRaw(string id, int tm) => new Ctrl { id = id, tm = tm, idx = 0, fixed_ = false, tempo = 0, inp = new Input(), lastO = null };

        /// <summary>Effects the shell renders: floating texts, sounds, crowd excitement, game end.</summary>
        public static readonly List<Fx> FX = new List<Fx>();
        static int fxId = 0;
        /// <summary>Client-side prediction mode: step() runs for the local player only, with no side effects.</summary>
        public static double PREDICT = 0;
        public static double setPredict(double v) => PREDICT = v;
        public static void fx(Fx o)
        {
            if (T(PREDICT)) return;
            o.id = ++fxId;
            FX.Add(o);
            if (FX.Count > 64) FX.RemoveAt(0);
        }
        public static void txt(string s, double x, double y, string c = "#fff") => fx(new Fx { k = "t", s = s, sx = x, sy = y, c = c });
        public static void txtW(string s, double x, double y, double z, string c = "#fff") => fx(new Fx { k = "t", s = s, x = x, y = y, z = z, c = c });
        public static void snd(double f, double d, string ty = "sine", double v = 0.07) => fx(new Fx { k = "s", f = f, d = d, ty = ty, v = v });
        public static void exc(double v) => fx(new Fx { k = "x", v = v });
        public static void fxp(Fx o) => fx(o);
        public static readonly Hook HOOK = new Hook();

        // ---- setters for the shell ----
        public static double setInb(double v) => inb = v;
        public static double setRs(double v) => rs = v;
        public static double setClock(double v) => clock = v;
        public static double setShot(double v) => shot = v;
        public static double setT(double v) => T = v;
        public static string setS(string v) => S = v;
        public static double setPos(double v) => pos = v;
        public static JumpBall setJB(JumpBall v) => JB = v;
        public static double setRQ(double v) => RQ = v;
        public static double setQtrLen(double v) => QTRLEN = v;
        public static List<Ctrl> setCtrls(List<Ctrl> c) => CT = c;
        public static Ctrl mkCtrl(string id, int tm, bool fixed_ = false, double tempo = 0) =>
            new Ctrl { id = id, tm = tm, idx = tm * cfg.NP, fixed_ = fixed_, tempo = tempo, inp = new Input(), lastO = null };
        /// <summary>Apply authoritative scalar state (used by online guests).</summary>
        public static void setScalars(Scalars o)
        {
            if (o.S != null) S = o.S;
            if (o.q.HasValue) q = o.q.Value;
            if (o.clock.HasValue) clock = o.clock.Value;
            if (o.shot.HasValue) shot = o.shot.Value;
            if (o.pos.HasValue) pos = o.pos.Value;
            if (o.rs.HasValue) rs = o.rs.Value;
            if (o.inb.HasValue) inb = o.inb.Value;
            if (o.T.HasValue) T = o.T.Value;
            if (o.sc != null) sc = o.sc;
            if (o.tf != null) tf = o.tf;
            if (o.hasFtq) ftq = o.ftq;
            if (o.cl != null) cl = o.cl;
            if (o.PC != null) PC = o.PC;
        }
        public static List<Player> setPlayers(List<Player> a) => P = a;
        public static Ball setBall(Ball b) => B = b;

        // ---- rosters ----
        public static readonly List<AllEntry> ALL = mkALL();
        static List<AllEntry> mkALL()
        {
            var l = new List<AllEntry>();
            for (int ti = 0; ti < TM.Length; ti++)
                foreach (var a in TM[ti].ps) l.Add(new AllEntry { t = ti, a = a });
            return l;
        }
        public static readonly MyPlayer MYP = mkMYP();
        static MyPlayer mkMYP()
        {
            var m = new MyPlayer();
            m.t = tupleOf(m.d);
            return m;
        }
        static Tuple tupleOf(MyPlayerData d) =>
            new Tuple(d.n, (int)d.c, (int)d.i, (int)d.s, (int)d.d, (int)d.j, (int)d.st, d.sk, (int)d.hr, (int)d.bd, d.ht, d.bk, (int)d.no);
        public static void mkT() { MYP.t = tupleOf(MYP.d); }
        public static int nChoices() => cfg.NP > 1 ? TM.Length : ALL.Count;
        public static (string col, Tuple[] ps, string name) RO(double i)
        {
            int ii = (int)i;
            if (cfg.NP > 1)
            {
                Tuple[] ps;
                if (cfg.NP >= 5) ps = TM[ii].ps;
                else
                {
                    var s = (Tuple[])TM[ii].ps.Clone();
                    SortStable(s, (a, b) => ov2(b) - ov2(a));
                    ps = new Tuple[Math.Min(cfg.NP, s.Length)];
                    Array.Copy(s, ps, ps.Length);
                }
                return (TM[ii].col, ps, TM[ii].name);
            }
            return (TM[ALL[ii].t].col, new[] { ALL[ii].a }, ALL[ii].a.n);
        }
        static int ov2(Tuple a) => Ov2(a);
        /// <summary>All-Star teams: the league's best, drafted alternately into Team Gold and Team Ice.</summary>
        public static (string col, Tuple[] ps, string name) allStar(double t)
        {
            var all = new List<Tuple>();
            foreach (var x in TM) all.AddRange(x.ps);
            SortStable(all, (a, b) => ov2(b) - ov2(a));
            var pick = new List<Tuple>();
            int n = Math.Min(cfg.NP * 2, all.Count);
            for (int k = 0; k < n; k++) if ((k % 4 == 0 || k % 4 == 3 ? 0 : 1) == t) pick.Add(all[k]);
            // bigs at the back of the lineup so the positions read right
            SortStable(pick, (a, b) => Cmp(a.ht - b.ht));
            return T(t) ? ("#4fb3ff", pick.ToArray(), "Team Ice") : ("#e0a526", pick.ToArray(), "Team Gold");
        }
        static double SEL = 0;
        public static (string col, Tuple[] ps, string name) RS(double ti, double t)
        {
            if (cfg.ASTAR != 0 && cfg.NP > 1) return allStar(t);
            if (cfg.MYM != 0 && t == 0)
            {
                if (cfg.NP == 1) return (MYP.d.col, new[] { MYP.t }, MYP.t.n);
                var b = RO(ti);
                int w = 0;
                for (int k = 0; k < b.ps.Length; k++) if (ov2(b.ps[k]) < ov2(b.ps[w])) w = k;
                var l = new List<Tuple> { MYP.t };
                for (int k = 0; k < b.ps.Length; k++) if (k != w) l.Add(b.ps[k]);
                return (b.col, l.ToArray(), b.name);
            }
            if (cfg.MYM != 0 && t == 1 && cfg.NP == 1) return RO(SEL);
            return RO(ti);
        }
        public static double ovr(Player p) => OV.TryGetValue(p.n ?? "", out var v) && v != 0 ? v : Round(68 + (Math.Max(p.c, p.i) - 75) * 0.4);

        /// <summary>Shot chart: every field-goal attempt (team, spot, made, three, quarter).</summary>
        public static readonly List<ShotRec> SHOTS = new List<ShotRec>();
        public static double start(double i, StartOpts o = null)
        {
            if (o == null) o = new StartOpts();
            int NP = cfg.NP;
            SHOTS.Clear();
            SEL = o.j ?? o.sel ?? i; // My Player 1v1 faces the chosen opponent, else the selected card
            double? jn = o.j;
            if (jn == null)
                do jn = I(Rng.R() * nChoices());
                while (jn == i);
            double j = jn.Value;
            P = new List<Player>();
            double[] tis = { i, j };
            for (int t = 0; t < 2; t++)
            {
                double ti = tis[t];
                string col = t != 0 && RS(ti, t).col == RS(i, 0).col ? "#b03a2e" : RS(ti, t).col;
                var ps = RS(ti, t).ps;
                for (int k = 0; k < ps.Length; k++)
                {
                    var p = mkP(ps[k], t, k, col);
                    p.rid = k;
                    P.Add(p);
                }
                // generated reserves (fictional), deterministic from the team (online guests build the same bench); rid 5+
                var bl = new List<Player>();
                if (NP >= 5 && cfg.ASTAR == 0)
                {
                    var rv = reserves(RS(ti, t).ps, RS(ti, t).name);
                    for (int k = 0; k < rv.Length; k++)
                    {
                        var p = mkP(rv[k], t, k, col);
                        p.rid = 5 + k;
                        bl.Add(p);
                    }
                }
                BENCH[t] = bl;
            }
            ROST[0] = new List<Player>();
            ROST[1] = new List<Player>();
            foreach (var p in P) if (p.tm == 0) ROST[0].Add(p);
            foreach (var p in P) if (p.tm == 1) ROST[1].Add(p);
            resetRules();
            PC = new[] { RS(i, 0).col, RS(j, 1).col };
            cl = new[] { RS(i, 0).name, RS(j, 1).name };
            sc = new double[] { 0, 0 };
            tf = new double[] { 0, 0 };
            ftq = null;
            inb = 0;
            q = 1;
            clock = QTRLEN;
            fin = 0;
            rs = 0;
            RPL = null;
            RQ = 0;
            recClear();
            HL.Clear();
            B = new Ball { x = 0, y = 0, z = 0, vx = 0, vy = 0, vz = 0, owner = null, mode = "held", sh = 0, sc = 0, last = null, age = 0, to = null, three = 0, a = 0 };
            for (int k = 0; k < CT.Count; k++)
            {
                var c = CT[k];
                c.fixed_ = cfg.MYM != 0 && k == 0 && c.tm == 0;
                c.idx = c.tm * NP;
                c.lastO = null;
            }
            setup(0);
            S = "play";
            if (cfg.JB != 0) beginJB();
            snd(500, 0.2, "square");
            return j;
        }

        // ---- opening tip: centers dap, the ball goes up, a timed jump wins the tip to a teammate ----
        public static JumpBall JB = null;
        static Player tallest(double t)
        {
            // first of a stable descending sort = the first player with the highest key
            Player best = null;
            double bv = 0;
            foreach (var p in P)
            {
                if (p.tm != t) continue;
                double v = p.ht + p.j / 200;
                if (best == null || v > bv) { best = p; bv = v; }
            }
            return best;
        }
        static readonly double[] JBK = { 0.6, 0.85, 1, 1.25 };
        static void beginJB()
        {
            Player c0 = tallest(0),
                c1 = tallest(1);
            int a = 0,
                b2 = 0;
            foreach (var p in P)
            {
                p.vx = p.vy = p.z = p.vz = 0;
                p.mode = "i";
                if (p == c0) { p.x = 461; p.y = 250; p.f = 0; }
                else if (p == c1) { p.x = 479; p.y = 250; p.f = Math.PI; }
                else
                {
                    int k = T(p.tm) ? b2++ : a++;
                    double ang = (T(p.tm) ? 0 : Math.PI) + (k - 1.5) * 0.75;
                    p.x = 470 + JsMath.Cos(ang) * 82;
                    p.y = 250 + JsMath.Sin(ang) * 82;
                    p.f = JsMath.Atan2(250 - p.y, 470 - p.x);
                }
            }
            c0.cel = 9; c0.celT = CEL_T; // dap before the tip
            c1.cel = 9; c1.celT = CEL_T;
            B.owner = null;
            B.mode = "air";
            B.sh = 0;
            B.last = null;
            B.x = 470;
            B.y = 250;
            B.z = 62;
            B.vx = B.vy = B.vz = 0;
            inb = 0;
            double aiT(Player c) => 0.3 + ((Rng.R() - 0.5) * 0.24) / cpuK(c, JBK);
            double t0 = aiT(c0), t1 = aiT(c1);
            JB = new JumpBall { t = 0, c = new[] { c0, c1 }, jt = new double[] { -1, -1 }, ai = new[] { t0, t1 } };
            txt("JUMP BALL", 480, 200, "#ffd23f");
        }
        public const double TOSS = 1.7;
        public static void jbStep(double dt)
        {
            var J = JB;
            J.t += dt;
            double tt = J.t - TOSS;
            if (tt >= 0)
            {
                B.z = Math.Max(62, 62 + 230 * tt - 160 * tt * tt);
                B.vz = 230 - 320 * tt;
            }
            for (int s = 0; s < 2; s++)
            {
                var c = J.c[s];
                Ctrl hc = null;
                foreach (var k in CT) if (k.tm == s) { hc = k; break; }
                bool wants = hc != null ? hc.inp.sd : tt >= J.ai[s];
                if (wants && tt > -0.3 && J.jt[s] < 0 && c.z <= 0)
                {
                    J.jt[s] = tt;
                    c.vz = 126 + c.j * 0.9;
                }
                if (c.z > 0 || c.vz > 0)
                {
                    c.vz -= g * dt;
                    c.z = Math.Max(0, c.z + c.vz * dt);
                    if (c.z <= 0) c.vz = 0;
                }
            }
            if (tt >= 0.86)
            {
                // the ball comes down through the centers' reach: highest hand wins
                double r0 = J.c[0].ht * 13.3 + J.c[0].z + Rng.R() * 6;
                double r1 = J.c[1].ht * 13.3 + J.c[1].z + Rng.R() * 6;
                int w = r0 >= r1 ? 0 : 1;
                var win = J.c[w];
                double tx = T(win.tm) ? 520 : 420;
                Player mate = null;
                double md = 0;
                foreach (var p in P)
                {
                    if (p.tm != win.tm || p == win) continue;
                    double d = Math.Abs(p.x - tx);
                    if (mate == null || d < md) { mate = p; md = d; }
                }
                if (mate == null) mate = win;
                const double fl = 0.55;
                B.mode = mate == win ? "air" : "pass";
                B.to = mate == win ? null : mate;
                B.ptype = 0;
                B.last = win;
                B.age = 0;
                B.vx = (mate.x - B.x) / fl;
                B.vy = (mate.y - B.y) / fl;
                B.vz = (52 - B.z + 0.5 * g * fl * fl) / fl;
                B.wv = new double[] { 0, 0, 0 };
                pos = win.tm;
                shot = 24;
                txtW("TIP WON", win.x, win.y, 120, "#ffd23f");
                JB = null;
            }
        }

        // ================= gameplay pack: badges, hot zones, rotations, timeouts, momentum, violations, challenges =================
        public static Player mkP(Tuple a, double t, double k, string col)
        {
            return new Player
            {
                n = a.n, c = a.c, i = a.i, s = a.s, d = a.d, j = a.j, st = a.st, tm = t, k = k, col = col,
                skin = a.skin, x = 0, y = 0, z = 0, vx = 0, vy = 0, vz = 0, f = 0, ph = 0, mode = "i", t = 0, cd = 0, rl = 0, mt = 0,
                ai = new PlayerAi(), @in = new Input(),
                stt = new Stats(),
                my = a == MYP.t, sg = FormOf(a.n), slow = 0, sbw = 0, sv = 0, tp = null, pf = 0, bn = 1, bx = 0, by = 0,
                hr = a.hr, bd = a.bd, ht = a.ht, bk = a.bk, no = a.num, en = 1, hzm = new double[6], cold = 0,
            };
        }
        public static readonly string[] RNAME = { "Okafor", "Lindqvist", "Brannon", "Delacroix", "Mwangi", "Petrakis", "Holloway", "Sato", "Ferreira", "Quist", "Abernathy", "Vukovic", "Castellanos", "Nkemelu", "Harlan", "Iwu", "Renner", "Toussaint", "Beaumont", "Kowal", "Adeyemi" };
        static readonly string[] RSKIN = { "#8d5524", "#c68642", "#6b4226", "#f1c27d" };
        static readonly int[] RST = { 0, 1, 4 }, RNUM = { 2, 9, 31 }, RK = { 0, 2, 4 };
        /// <summary>JS `x >>> 0` of a (possibly huge, already rounded) double.</summary>
        static double u32(double v) => v - Math.Floor(v / 4294967296.0) * 4294967296.0;
        /// <summary>JS `x % m` with a possibly negative index into a table (negative -> undefined/null).</summary>
        static string pickS(string[] a, int k) => k >= 0 && k < a.Length ? a[k] : null;
        /// <summary>Three fictional reserves per team: a guard, a wing and a big, ~6 points below the starters.</summary>
        public static Tuple[] reserves(Tuple[] st, string tn)
        {
            double h = 7;
            foreach (char ch in tn) h = u32(h * 31 + ch);
            double r() { h = u32(h * 1103515245 + 12345); return h / 4294967296.0; }
            int m(double v) => (int)Round(clamp(v - 4 - r() * 6, 30, 90));
            var res = new Tuple[3];
            for (int n = 0; n < 3; n++)
            {
                var a = st[RK[n]];
                string nm = RNAME[(int)((h + n * 7) % RNAME.Length)];
                int c = m(a.c), i = m(a.i), s = m(a.s), d = m(a.d), j = m(a.j);
                int stl = RST[n];
                int hi = unchecked((int)(uint)h); // JS h >> k works on the int32 value
                string skin = pickS(RSKIN, (hi >> 3) % 4);
                int hr = 1 + ((hi >> 5) % 3);
                int bd = (hi >> 7) % 2;
                double ht = a.ht + (r() - 0.5) * 0.2;
                hi = unchecked((int)(uint)h);
                int num = RNUM[n] + ((hi >> 9) % 5);
                res[n] = new Tuple(nm, c, i, s, d, j, stl, skin, hr, bd, ht, a.bk, num);
            }
            return res;
        }
        /// <summary>Bench players (not on the floor) and everyone who played (box score), per team.</summary>
        public static List<Player>[] BENCH = { new List<Player>(), new List<Player>() },
            ROST = { new List<Player>(), new List<Player>() };
        /// <summary>Badges from ratings: DR deep range, PZ posterizer, AB ankle breaker, LD lockdown, CL clutch, GC glass cleaner.</summary>
        public static readonly Dictionary<string, (string name, Func<Player, bool> f)> BADGE = new Dictionary<string, (string, Func<Player, bool>)>
        {
            ["DR"] = ("Deep Range", p => p.c >= 88),
            ["PZ"] = ("Posterizer", p => p.j >= 72 && p.i >= 82),
            ["AB"] = ("Ankle Breaker", p => p.s >= 84),
            ["LD"] = ("Lockdown", p => p.d >= 86),
            ["CL"] = ("Clutch", p => (OV.TryGetValue(p.n ?? "", out var v) ? v : 0) >= 88 || (p.c + p.i) / 2 >= 85),
            ["GC"] = ("Glass Cleaner", p => p.ht >= 6.9 && (p.i >= 80 || p.d >= 85)),
        };
        public static bool hasB(Player p, string b) => cfg.BADGES != 0 && p != null && BADGE[b].f(p);
        public static List<string> badgesOf(Player p)
        {
            var l = new List<string>();
            foreach (var kv in BADGE) if (kv.Value.f(p)) l.Add(kv.Key);
            return l;
        }
        /// <summary>Shot zone: 0 paint, 1 mid left, 2 mid right, 3 three left wing/corner, 4 three top, 5 three right.</summary>
        public static int zoneOf(Player p, double D0)
        {
            double s = (p.y - HY) * (T(p.tm) ? 1 : -1); // shooter's left is negative
            if (D0 < 90) return 0;
            if (D0 < 237) return s < 0 ? 1 : 2;
            return Math.Abs(p.y - HY) < 90 ? 4 : s < 0 ? 3 : 5;
        }
        public static readonly string[] ZN = { "PAINT", "LEFT ELBOW", "RIGHT ELBOW", "LEFT WING", "TOP OF THE KEY", "RIGHT WING" };
        public static bool clutchTime() => q >= 4 && clock <= Math.Max(12, QTRLEN * 0.4) && Math.Abs(sc[0] - sc[1]) <= 5;
        /// <summary>Team state: timeouts, defense setting, play call, challenge, runs, momentum, scouting, plans.</summary>
        public static readonly TeamState TS = new TeamState();
        public static Scout scoutNew() => new Scout();
        public static readonly string[] GPN = { "BALANCED", "ATTACK THE PAINT", "MID-RANGE & POST", "LET IT FLY", "FEED THE HOT HAND" };
        public static readonly string[] DSN = { "NORMAL", "SAG / PROTECT PAINT", "TIGHT / DENY", "SWITCH EVERYTHING", "2-3 ZONE", "BOX-AND-ONE" },
            PCN = { "AUTO", "PICK & ROLL", "PINDOWN", "FLARE", "ISOLATION", "HORNS", "SPAIN PICK & ROLL", "POST UP" },
            // CPU pick-and-roll coverages (TS.cov)
            COVN = { "DROP", "HEDGE", "ICE", "BLITZ" };
        /// <summary>CT.some(c => c.tm === t), allocation-free.</summary>
        static bool ctHas(double t)
        {
            for (int k = 0; k < CT.Count; k++) if (CT[k].tm == t) return true;
            return false;
        }
        public static void resetRules()
        {
            TS.to = new double[] { 4, 4 };
            TS.ds = new double[] { 0, 0 };
            TS.pc = new double[] { 0, 0 };
            TS.chal = new double[] { 1, 1 };
            TS.run = new double[] { 0, 0 };
            TS.mom = 0;
            TS.clutch = 0;
            TS.half = 0;
            Array.Clear(TS.lane, 0, TS.lane.Length);
            TS.bc = 0;
            TS.call = null;
            TS.gt = 0;
            TS.qs = new List<double[]>();
            TS.adv = -1;
            TS.hud = 0;
            TS.mu = new double[2][];
            TS.sk = new[] { scoutNew(), scoutNew() };
            TS.gp = new double[] { 0, 0 };
            TS.gpT = new double[] { 0, 0 };
            TS.trT = new double[] { -99, -99 };
            TS.tr = new double[] { 0, 0 };
            TS.cov = new double[] { 0, 0 };
            TS.dbl = new double[] { -1, -1 };
            TS.xs = new Splits();
            TS.orbP = new double[] { 0, 0 };
            TS.ato = new double[] { 0, 0 };
            TS.l2 = new double[] { 0, 0 };
            TS.bon = new double[] { 0, 0 };
            TS.box = new double[] { -1, -1 };
            TS.cls = new double[] { 0, 0 };
            TS.setN = new double[] { 0, 0 };
            for (int t = 0; t < 2; t++) if (!ctHas(t)) TS.mu[t] = autoMatch(t);
        }
        /// <summary>Commentary hook (captions + optional voice) and broadcast banners.</summary>
        public static void cm(string e, string n = null, string n2 = null) => fx(new Fx { k = "cm", e = e, n = n, n2 = n2 });
        public static void ban(string s, string sub = "", string c = "#ffd23f") => fx(new Fx { k = "ban", s = s, sub = sub, c = c });
        /// <summary>Shot-window multiplier from badges, hot zones, rhythm, streaks, momentum and clutch. Shared with the HUD meter.</summary>
        /// <summary>Green-window factor of a contest: open = full, light (.3) -30%, heavy / smothered (.75+) -75% (sim.ts cwin).</summary>
        public static double cwin(double cx) => Math.Max(0.25, 1 - cx);
        /// <summary>The contest a human's window uses: live while charging (contestOf + body contact), locked at release (p.cw).</summary>
        public static double shotContest(Player p) => p.mode == "s" && p.cw != null ? p.cw.Value : Math.Min(1, contestOf(p).Item1 + p.bmp * 0.5);
        /// <summary>The green window (s; x1.2 with tempo): launch and the HUD meter share it (sim.ts greenWin).</summary>
        public static double greenWin(Player p, double rat, double cx, double wm0) => (0.07 + (rat / 100) * 0.05) * cwin(cx) * (0.85 + 0.15 * p.en) * wm0;

        public static double winMul(Player p, double D0, List<string> note = null)
        {
            if (cfg.BADGES == 0 || cfg.ONLINE != 0) return 1;
            if (ftq != null)
            {
                // the road team at the line in crunch time hears it from the whole building
                if (T(TS.clutch) && p.tm == 1 && cfg.GM == "game")
                {
                    note?.Add("ROAD NERVES");
                    return 0.85;
                }
                return 1;
            }
            double m = 1;
            void add(double k, string s)
            {
                m *= k;
                note?.Add(s);
            }
            if (D0 > 265 && !hasB(p, "DR") && p.heat < 3) add(0.88, "DEEP");
            if (D0 > 265 && hasB(p, "DR")) add(1.08, "DEEP RANGE");
            if (p.hzm != null && p.hzm[zoneOf(p, D0)] >= 2) add(1.12, "HOT ZONE");
            if ((p.mvEnd != null && T - p.mvEnd.Value < 0.45) || p.sbw > 0.4) add(1.1, "RHYTHM");
            if (cfg.PP >= 2 && Util.T(p.sqn) && (p.mode == "c" || p.mode == "s")) add(p.sq, SQN[(int)p.sqn]); // (Pro Play v2: balance at the gather)
            if (p.cold >= 3) add(0.9, "COLD");
            if (clutchTime() && hasB(p, "CL")) add(1.15, "CLUTCH");
            double mo = T(p.tm) ? -TS.mom : TS.mom;
            if (mo > 0.5) add(1.05, "MOMENTUM");
            if (T(TS.clutch) && p.tm == 0 && cfg.GM == "game") add(1.05, "HOME CROWD");
            return m;
        }
        /// <summary>Make/miss bookkeeping for hot zones and cold streaks.</summary>
        public static void zoneRes(Player p, double? D0n, bool made)
        {
            if (p == null || p.hzm == null || D0n == null) return;
            double D0 = D0n.Value;
            scout(p, D0, made, B.cx ?? 0);
            if (T(B.kk))
            {
                statAdd("kA", 1);
                if (made) statAdd("kM", 1);
            }
            if (B.lx != null && !T(PREDICT) && SHOTS.Count < 400) SHOTS.Add(new ShotRec { t = p.tm, x = B.lx.Value, y = B.ly ?? double.NaN, m = made ? 1 : 0, th = D0 >= 237 ? 1 : 0, q = q });
            if (T(B.kk) && made && D0 >= 237 && Rng.R() < 0.5) cm("kick", p.n);
            int z = zoneOf(p, D0);
            if (made)
            {
                p.hzm[z] = Math.Min(4, p.hzm[z] + 1);
                if (p.hzm[z] == 2 && isH(p) && cfg.BADGES != 0) txtW("HOT ZONE: " + ZN[z], p.x, p.y, 135, "#ff9a2e");
                p.cold = 0;
            }
            else
            {
                p.hzm[z] = Math.Max(0, p.hzm[z] - 1);
                p.cold = p.cold + 1;
                if (p.cold == 3 && cfg.BADGES != 0) { txtW("ICE COLD", p.x, p.y, 120, "#7fd4ff"); cm("cold", p.n); }
            }
        }
        /// <summary>Scouting range: 0 rim, 1 mid, 2 three.</summary>
        public static int rngOf(double D0) => D0 < 90 ? 0 : D0 < 237 ? 1 : 2;
        /// <summary>Every field goal feeds a decayed record per range for the shooter (~last 6) and his team (~last 14).</summary>
        public static void scout(Player p, double D0, bool made, double cx)
        {
            int r = rngOf(D0);
            var s = p.sk ?? (p.sk = scoutNew());
            var k = TS.sk[(int)p.tm];
            if (k == null) return;
            for (int w = 0; w < 2; w++)
            {
                var o = w != 0 ? k : s;
                double dec = w != 0 ? 0.93 : 0.84;
                for (int j = 0; j < 3; j++) { o.a[j] *= dec; o.m[j] *= dec; o.c[j] *= dec; }
                o.a[r] += 1;
                o.m[r] += made ? 1 : 0;
                o.c[r] += cx;
            }
        }
        /// <summary>Expected points per shot from a range, shrunk toward a league prior.</summary>
        public static readonly double[] PRI = { 1.25, 0.84, 1.08 };
        public static double pps(Scout o, double rr)
        {
            int r = (int)rr;
            double n = o.a[r],
                w = n / (n + 4);
            return w * ((o.m[r] / (T(n) ? n : 1)) * (r == 2 ? 3 : 2)) + (1 - w) * PRI[r];
        }
        /// <summary>How a player is doing from a range lately (pct -1 = not enough shots) and how tight his looks have been.</summary>
        public static ShotForm form(Player p, double rr)
        {
            int r = (int)rr;
            var s = p.sk;
            if (s == null || s.a[r] < 1.5) return new ShotForm(-1, 0, s != null ? s.a[r] : 0);
            return new ShotForm(s.m[r] / s.a[r], s.c[r] / s.a[r], s.a[r]);
        }
        public static bool hotNow(Player q) => q.heat >= 3 || (q.hzm != null && Max(q.hzm) >= 3);
        /// <summary>CPU coaching: re-read the team's shooting every few possessions and pick a game plan; defensively, take
        /// away what the other team is living on. Human teams keep their own calls.</summary>
        public static void gamePlan(double tt)
        {
            if (ctHas(tt) || cfg.NP < 2 || !gameLike() || cfg.ASTAR != 0) return;
            int t = (int)tt;
            double lv = cpuIQ(t);
            if (++TS.gpT[t] < 6 - lv) return; // (smarter coaches re-read the game sooner: every 6 .. 3 possessions)
            // defense reads the other side's sheet: they live at the rim -> sag; they're raining threes -> run them off the line
            var o = TS.sk[1 - t];
            bool rimHot = pps(o, 0) > 1.35 && o.a[0] >= 4;
            int bx = lv >= 2 ? boxTarget(t) : -1;
            // they live at the rim and can't shoot it: pack the paint with a zone (5v5), or at least sag; one shooter on
            // fire and nobody else hurting them: box-and-one
            double ds = bx >= 0 ? 5 : pps(o, 2) > 1.2 && o.a[2] >= 4 ? 2 : rimHot ? (cfg.NP == 5 && pps(o, 2) < 1.0 ? 4 : 1) : TS.ds[t] == 3 ? 3 : 0;
            TS.box[t] = bx;
            if (ds != TS.ds[t])
            {
                TS.ds[t] = ds;
                if (ds == 4) { ban("2-3 ZONE", cl[t].ToUpperInvariant() + " PACK THE PAINT", PC[t]); cm("zone", cl[t]); }
                else if (ds == 5) { ban("BOX-AND-ONE", cl[t].ToUpperInvariant() + " CHASE " + P[bx].n.ToUpperInvariant(), PC[t]); cm("boxone", cl[t], P[bx].n); statAdd("boxone", 1); }
                else if (T(ds)) txt(cl[t].ToUpperInvariant() + " DEFENSE: " + DSN[(int)ds], 480, 170, "#9fe7ff");
            }
            // pick-and-roll coverage: hedge out on a handler who punishes a big sitting back, otherwise drop; smarter
            // coaches blitz a star who is cooking and ICE a team that lives at the rim
            {
                var st = starOf(1 - t);
                double cov = (st != null && st.c >= 86) || (pps(o, 1) > 1.0 && o.a[1] >= 4) ? 1 : 0;
                if (lv >= 2 && cov == 1 && st != null && hotNow(st)) cov = 3;
                else if (lv >= 1 && cov == 0 && rimHot) cov = 2;
                if (lv == 0) cov = 0; // (a rookie coach drops every time)
                if (cfg.TP == 0) cov = cov == 1 || cov == 3 ? 1 : 0;
                if (cov != TS.cov[t])
                {
                    TS.cov[t] = cov;
                    txt(cl[t].ToUpperInvariant() + (cov == 1 ? " HEDGE THE PICK-AND-ROLL" : cov == 2 ? " ICE THE PICK-AND-ROLL" : cov == 3 ? " BLITZ THE PICK-AND-ROLL" : " DROP ON THE PICK-AND-ROLL"), 480, 150, "#9fe7ff");
                    if (cov >= 2) cm(cov == 2 ? "ice" : "blitz", cl[t], st != null ? st.n : "");
                }
            }
            // a scorer who is on fire gets doubled when he catches it (and the double comes off when he cools down)
            {
                int hi = -1;
                double hv = 0;
                for (int j = 0; j < cfg.NP; j++)
                {
                    var q = P[(1 - t) * cfg.NP + j];
                    double v = q.heat >= 3 ? 10 + q.stt.pts / 4 : 0;
                    if (v > hv) { hv = v; hi = (1 - t) * cfg.NP + j; }
                }
                if (cfg.NP < 3 || cfg.ASTAR != 0 || lv == 0 || TS.ds[t] == 5) hi = -1; // (no doubles from a rookie coach / in the box-and-one)
                if (hi != TS.dbl[t])
                {
                    TS.dbl[t] = hi;
                    if (hi >= 0) { ban("DOUBLE TEAM", cl[t].ToUpperInvariant() + " SEND TWO AT " + P[hi].n.ToUpperInvariant(), PC[t]); cm("double", cl[t], P[hi].n); }
                }
            }
            // somebody on the other side is cooking: the best defender takes the assignment
            var mu = TS.mu[t];
            int NP = cfg.NP;
            if (mu != null)
            {
                int hs = -1;
                double hv = 0;
                for (int j = 0; j < NP; j++)
                {
                    var q = P[(1 - t) * NP + j];
                    double v = q.heat + (q.hzm != null ? Max(q.hzm) : 0) * 0.5;
                    if (v >= 3 && v > hv) { hv = v; hs = j; }
                }
                if (hs >= 0)
                {
                    int bd = 0;
                    for (int j = 1; j < NP; j++) if (P[t * NP + j].d > P[t * NP + bd].d) bd = j;
                    int cur = Array.IndexOf(mu, (double)hs);
                    if (cur >= 0 && cur != bd && P[t * NP + bd].d > P[t * NP + cur].d + 3)
                    {
                        mu[cur] = mu[bd];
                        mu[bd] = hs;
                        txt(P[t * NP + bd].n.ToUpperInvariant() + " PICKS UP " + P[(1 - t) * NP + hs].n.ToUpperInvariant(), 480, 190, "#9fe7ff");
                        cm("assign", P[t * NP + bd].n, P[(1 - t) * NP + hs].n);
                    }
                }
            }
            var k = TS.sk[t];
            double n = k.a[0] + k.a[1] + k.a[2];
            if (n < 6) return;
            double e0 = pps(k, 0), e1 = pps(k, 1), e2 = pps(k, 2);
            double old = TS.gp[t];
            int gp = 0;
            bool hot = false;
            foreach (var q in P) if (q.tm == t && !T(q.off) && q.heat >= 3) { hot = true; break; }
            if (hot) gp = 4;
            else if (e2 < 0.85 && k.a[2] >= 4) gp = e0 >= e1 + 0.15 ? 1 : 2; // bricking from deep: get to the paint / the elbows
            else if (e0 < 0.95 && k.a[0] >= 4) gp = e2 >= 1.0 ? 3 : 2; // walled off at the rim: shoot over them
            else if (e2 > 1.25 && k.a[2] >= 4) gp = 3; // it's falling: keep firing
            if (gp != old && (gp != 0 || TS.gpT[t] >= 8))
            {
                TS.gp[t] = gp;
                TS.gpT[t] = 0;
                // a play call to match (pick-and-roll gets to the rim, pindowns free the mid-range, flares free shooters)
                TS.pc[t] = gp == 1 ? 1 : gp == 2 ? 2 : gp == 3 ? 3 : gp == 4 ? 4 : 0;
                statAdd("gp" + gp, 1);
                if (gp != 0)
                {
                    ban("ADJUSTMENT", cl[t].ToUpperInvariant() + ": " + GPN[gp], PC[t]);
                    cm("adjust", cl[t], GPN[gp].ToLowerInvariant());
                }
            }
        }
        /// <summary>Halftime: every CPU coach re-reads the first half. Returns what each CPU team changed; idempotent per half.</summary>
        static double halfAdj = -1;
        public static List<string> halftimeAdjust()
        {
            var output = new List<string>();
            if (halfAdj == T) return output;
            halfAdj = T;
            for (int t = 0; t < 2; t++)
            {
                if (ctHas(t)) continue;
                double g0 = TS.gp[t];
                TS.gpT[t] = 99;
                gamePlan(t);
                var k = TS.sk[t];
                double e3 = pps(k, 2),
                    e0 = pps(k, 0);
                var ci = CultureInfo.InvariantCulture;
                output.Add(cl[t] + ": " + (TS.gp[t] != g0 ? "new game plan — " : "sticking with ") + GPN[(int)TS.gp[t]].ToLowerInvariant()
                    + (T(TS.ds[t]) ? ", " + DSN[(int)TS.ds[t]].ToLowerInvariant() + " on D" : "")
                    + (k.a[2] >= 3 ? " (" + e3.ToString("F2", ci) + " pts/shot from three, " + e0.ToString("F2", ci) + " at the rim)" : ""));
            }
            return output;
        }
        /// <summary>Scoring runs drive momentum (crowd, small shot bonus) and AI timeouts.</summary>
        public static void runAdd(double t, double pts)
        {
            if (TS.run[0] == t) TS.run[1] += pts;
            else { TS.run[0] = t; TS.run[1] = pts; }
            TS.mom = clamp(TS.mom + (T(t) ? -1 : 1) * pts * 0.06, -1, 1);
            double r = TS.run[1];
            int ti = (int)t;
            if (r >= 8 && r - pts < 8) { ban(r + "-0 RUN", cl[ti].ToUpperInvariant(), PC[ti]); cm("run", cl[ti]); exc(1); }
            else if (r >= 12 && r - pts < 12) { ban(r + "-0 RUN", cl[ti].ToUpperInvariant() + " CAN'T MISS", PC[ti]); exc(1); }
        }
        /// <summary>Timeout: stops play, everybody gets a breather, the hot shooter on the other side cools off, momentum resets.</summary>
        public static bool callTO(double tt, string why = "")
        {
            int t = (int)tt;
            if (TS.to[t] <= 0 || ftq != null || JB != null || S != "play" || RPL != null) return false;
            bool dead = rs > 0;
            if (!dead && !(B.owner != null && B.owner.tm == t)) return false; // only with the ball or at a dead ball
            TS.to[t]--;
            ban("TIMEOUT", cl[t].ToUpperInvariant() + (why != "" ? " · " + why : "") + " · " + TS.to[t] + " LEFT", PC[t]);
            cm("timeout", cl[t]);
            foreach (var p in P) p.en = Math.Min(1, p.en + 0.35);
            foreach (var p in P) if (p.tm != t && p.heat > 1) p.heat = 1;
            TS.mom *= 0.3;
            TS.run[0] = t;
            TS.run[1] = 0;
            if (!dead) pend = t;
            rs = 3.2;
            TS.hud = 3.2; // both teams huddle in front of their benches (deadBall)
            if (!ctHas(t) && cpuIQ(t) >= 1 && cfg.NP >= 3) TS.ato[t] = 1; // the coach draws up a play (ATO)
            RQ = 0;
            if (q >= 4 && bcast() < 120 && pend == t && cfg.NP > 1)
            {
                TS.adv = t;
                txt("BALL ADVANCED TO THE FRONTCOURT", 480, 250, "#9fe7ff");
            }
            return true;
        }
        /// <summary>Coach's challenge on the last foul against your team (one per game). Overturned if the contact was marginal.</summary>
        public static bool challenge(double tt)
        {
            int t = (int)tt;
            var c = TS.call;
            if (c == null || c.t != t || T > c.until || TS.chal[t] <= 0) return false;
            TS.chal[t]--;
            TS.call = null;
            bool ok = Rng.R() > c.p;
            ban("COACH'S CHALLENGE", ok ? "CALL OVERTURNED" : "CALL STANDS — TIMEOUT LOST", ok ? "#2ecc71" : "#ff6b4a");
            cm(ok ? "chalWin" : "chalLose", cl[t]);
            if (ok)
            {
                if (c.d != null)
                {
                    c.d.pf = Math.Max(0, c.d.pf - 1);
                    tf[(int)c.d.tm] = Math.Max(0, tf[(int)c.d.tm] - 1);
                }
                ftq = null;
                B.sh = 0;
                setup(t);
            }
            else TS.to[t] = Math.Max(0, TS.to[t] - 1);
            return true;
        }
        /// <summary>Whistle bookkeeping: personal-foul limit, challengeable call. p = chance the call was correct.</summary>
        public static void whistle(Player d, Player o, double p)
        {
            if (ctHas(d.tm)) TS.call = new WhistleCall { t = d.tm, d = d, o = o, until = T + 4, p = p };
            if (cfg.SUBS != 0 && cfg.NP > 1 && d.pf >= 6 && !T(d.fo))
            {
                d.fo = 1;
                ban("FOULED OUT", d.n.ToUpperInvariant() + " · 6 FOULS", "#ff6b4a");
                cm("foulout", d.n);
            }
        }
        /// <summary>Substitutions at dead balls (5v5): tired or fouled-out players go to the bench, rested ones come back.
        /// Rotation rules (v5.4): foul trouble sits a starter until the next quarter (q + 1 fouls); the starters close
        /// (clutch time / overtime); garbage time (4th quarter, last 4 broadcast minutes, 20+ points) empties the bench.</summary>
        public static bool ftrb(Player p) => !T(p.fo) && q <= 4 && p.pf >= q + 1; // in foul trouble for this quarter
        public static void subs()
        {
            if (cfg.SUBS == 0 || cfg.NP < 2 || T(PREDICT) || BENCH[0] == null) return; // (online too: the host publishes the lineup)
            bool close = TS.clutch > 0 || q > 4,
                blow = q >= 4 && bcast() < 240 && Math.Abs(sc[0] - sc[1]) >= 20 && gameLike() && cfg.ASTAR == 0;
            for (int t = 0; t < 2; t++)
            {
                var bn = BENCH[t];
                if (bn.Count == 0) continue;
                for (int k = 0; k < cfg.NP; k++)
                {
                    int idx = t * cfg.NP + k;
                    var p = P[idx];
                    bool skip = p.my;
                    if (!skip) foreach (var c in CT) if (c.fixed_ && c.idx == idx) { skip = true; break; }
                    if (skip) continue;
                    bool fresh = T - p.inAt < 25; // nobody gets yanked right after checking in
                    bool tired = (p.en < (close ? 0.3 : 0.5) && !fresh) || T(p.fo),
                        st = p.rid < 5, // a starter
                        ftr = !close && st && ftrb(p),
                        garb = blow && st;
                    if (!tired && !ftr && !garb)
                    {
                        if (close && !st)
                        {
                            // closing time: a reserve on the floor makes way for a starter who can still go
                            Player c0 = null;
                            foreach (var b in bn) if (b.rid < 5 && !T(b.fo) && b.en > 0.35 && (c0 == null || Math.Abs(b.ht - p.ht) < Math.Abs(c0.ht - p.ht))) c0 = b;
                            if (c0 != null)
                            {
                                swap(t, k, c0);
                                statAdd("closer", 1);
                                if (!T(TS.cls[t])) { TS.cls[t] = 1; cm("closers", cl[t]); }
                            }
                            continue;
                        }
                        // a rested starter checks back in for his sub (not in foul trouble, not with the game out of reach)
                        if (p.sub != null && !T(p.fo) && !blow)
                        {
                            Player s0 = null;
                            foreach (var b in bn) if (b == p.sub && b.en > 0.85 && !T(b.fo) && !(!close && ftrb(b))) { s0 = b; break; }
                            if (s0 != null && (p.en < 0.8 || T(s0.ftS)) && !fresh) { s0.ftS = 0; swap(t, k, s0); }
                        }
                        continue;
                    }
                    Player best = null;
                    foreach (var b in bn) if (!T(b.fo) && b.en > (ftr || garb ? 0.45 : 0.7) && !(ftr && ftrb(b)) && !(garb && b.rid < 5) && (best == null || Math.Abs(b.ht - p.ht) < Math.Abs(best.ht - p.ht))) best = b;
                    if (best != null)
                    {
                        swap(t, k, best);
                        if (ftr) { p.ftS = 1; statAdd("ftrSit", 1); cm("foultrouble", p.n); }
                        if (garb) statAdd("garbage", 1);
                    }
                }
            }
        }
        public static void swap(double tt, double kk, Player inP)
        {
            int t = (int)tt, k = (int)kk;
            int idx = t * cfg.NP + k;
            var output = P[idx];
            var bn = BENCH[t];
            int bi = bn.IndexOf(inP);
            if (bi < 0) bi = bn.Count - 1; // splice(-1, 1) removes the last
            if (bi >= 0) bn.RemoveAt(bi);
            bn.Add(output);
            inP.k = k;
            inP.sub = output;
            inP.inAt = T;
            inP.x = output.x;
            inP.y = output.y;
            inP.f = output.f;
            inP.mode = "i";
            inP.ai = new PlayerAi();
            P[idx] = inP;
            if (!ROST[t].Contains(inP)) ROST[t].Add(inP);
            PLAY[t] = PLAY[1 - t] = null;
            OFFS[0] = OFFS[1] = null;
            if (ctHas(t)) txt("SUB: " + inP.n + " in for " + output.n, 480, 260, "#9fe7ff");
            SUBV++;
        }
        /// <summary>Bumped on every substitution (the 3D renderer rebuilds rigs for changed slots).</summary>
        public static double SUBV = 0;
        /// <summary>Online: who is on the floor, per team and slot, as stable roster ids (the host publishes it).</summary>
        public static double[][] lineup()
        {
            var r = new double[2][];
            for (int t = 0; t < 2; t++)
            {
                var l = new List<double>();
                foreach (var p in P) if (p.tm == t) l.Add(p.rid);
                r[t] = l.ToArray();
            }
            return r;
        }
        /// <summary>Online guest: make the floor match the host's lineup (the same swaps, from the same generated bench).</summary>
        public static void applyLineup(double[][] U)
        {
            if (U == null) return;
            int NP = cfg.NP;
            for (int t = 0; t < 2; t++)
                for (int k = 0; k < NP; k++)
                {
                    double? want = t < U.Length && U[t] != null && k < U[t].Length ? U[t][k] : (double?)null;
                    int ci = t * NP + k;
                    var cur = ci < P.Count ? P[ci] : null;
                    if (want == null || cur == null || cur.rid == want) continue;
                    Player q = null;
                    foreach (var b in BENCH[t]) if (b.rid == want) { q = b; break; }
                    if (q != null) swap(t, k, q);
                }
        }
        /// <summary>Rule ticks during live play: bench fatigue, paint/backcourt counts, momentum decay, clutch time, AI timeouts.</summary>
        public static void rulesTick(double dt)
        {
            for (int t = 0; t < 2; t++) foreach (var b in BENCH[t]) b.en = Math.Min(1, b.en + dt * 0.03);
            foreach (var p in P) p.stt.min += dt;
            TS.mom *= 1 - dt * 0.01;
            if (!T(TS.clutch) && clutchTime())
            {
                TS.clutch = 1;
                ban("CLUTCH TIME", "UNDER " + Math.Ceiling(clock) + " SECONDS · " + Math.Abs(sc[0] - sc[1]) + "-POINT GAME", "#ff5a5a");
                cm("clutch");
                exc(1);
            }
            // CPU timeout to stop an 8-0 run (or in clutch time to draw up a play)
            for (int t = 0; t < 2; t++)
                if (!ctHas(t) && TS.to[t] > 0 && B.owner != null && B.owner.tm == t && inb > 0 && ((TS.run[0] != t && TS.run[1] >= 8) || (TS.clutch == 1 && sc[t] < sc[1 - t] && clock < 15)))
                {
                    if (TS.clutch == 1) TS.clutch = 2;
                    callTO(t, TS.run[1] >= 8 ? "STOP THE RUN" : "DRAW IT UP");
                }
            {
                var o = B.owner;
                double dt2 = o != null ? 1 - o.tm : -1;
                if (o != null && cfg.FOULS != 0 && ftq == null && inb <= 0 && rs <= 0 && q >= 4 && bcast() < 40 && fc <= 0 && !ctHas(dt2) && sc[(int)o.tm] - sc[(int)dt2] >= 3 && sc[(int)o.tm] - sc[(int)dt2] <= 8 && o.mode == "i")
                {
                    // down two possessions with the clock running out: foul to stop it
                    Player d = null;
                    foreach (var p in P) if (p.tm == dt2 && Hypot(p.x - o.x, p.y - o.y) < 26) { d = p; break; }
                    if (d != null && Rng.R() < dt * 2)
                    {
                        fc = 2;
                        tf[(int)dt2] = Math.Max(tf[(int)dt2], 4); // in the bonus late: shooting two
                        cm("intfoul", d.n, o.n);
                        foul(d, o, "INTENTIONAL", 0, 0);
                        return;
                    }
                }
                // up three in the last seconds: foul before he can get a tying three off (two free throws can't tie it)
                if (o != null && cfg.FOULS != 0 && ftq == null && inb <= 0 && rs <= 0 && q >= 4 && bcast() < 7 && fc <= 0 && !ctHas(dt2) && sc[(int)dt2] - sc[(int)o.tm] == 3 && o.mode == "i" && Hypot(hoop(o.tm) - o.x, HY - o.y) > 200)
                {
                    Player d = null;
                    foreach (var p in P) if (p.tm == dt2 && Hypot(p.x - o.x, p.y - o.y) < 28) { d = p; break; }
                    if (d != null && Rng.R() < dt * 4)
                    {
                        fc = 2;
                        tf[(int)dt2] = Math.Max(tf[(int)dt2], 4);
                        cm("foulup3", d.n, o.n);
                        foul(d, o, "INTENTIONAL", 0, 0);
                        return;
                    }
                }
            }
            if (cfg.VIOL == 0 || cfg.HALF != 0 || ftq != null || inb > 0 || B.owner == null || rs > 0)
            {
                Array.Clear(TS.lane, 0, TS.lane.Length); // a shot / loose ball / dead ball resets the count
                return;
            }
            {
                double t = pos,
                    hx = hoop(t),
                    dir = hx > 470 ? -1 : 1;
                var o = B.owner;
                // 8 seconds to get it across half court
                bool back = dir < 0 ? o.x < 470 : o.x > 470;
                if (back) TS.bc += dt;
                else TS.bc = 99;
                if (TS.bc > 8 && TS.bc < 90)
                {
                    TS.bc = 99;
                    violation(t, "8-SECOND VIOLATION");
                    return;
                }
                // 3 seconds in the lane (offense, while the ball is in the frontcourt; not in 1v1)
                if (cfg.NP > 1)
                    for (int k = 0; k < P.Count; k++)
                    {
                        var p = P[k];
                        if (p.tm != t || back)
                        {
                            TS.lane[k] = 0;
                            continue;
                        }
                        bool inLane = Math.Abs(p.x - hx) < 190 && Math.Abs(p.y - HY) < 80 && p.z <= 0;
                        bool exempt = (p == o && (p.mode != "i" || Hypot(p.vx, p.vy) > 90)) || p.mode == "s" || p.mode == "c";
                        TS.lane[k] = inLane && !exempt ? TS.lane[k] + dt : inLane ? TS.lane[k] : 0;
                        if (TS.lane[k] > 3.05)
                        {
                            Array.Clear(TS.lane, 0, TS.lane.Length);
                            violation(t, "3 SECONDS", p);
                            return;
                        }
                    }
            }
        }
        public static void violation(double t, string s, Player p = null)
        {
            fx(new Fx { k = "whistle", tm = t, hasTm = true });
            ban(s, (p != null ? p.n.ToUpperInvariant() + " · " : "") + "TURNOVER", "#ff6b4a");
            cm("viol", p != null ? p.n : cl[(int)t], s);
            snd(700, 0.3, "square", 0.08);
            setupAt(1 - t, B.x, B.y);
        }
        /// <summary>Inbound at the spot (violations): frontcourt -> from the nearest line (baseline box set or sideline
        /// spread), defense goal-side + one up on the inbounder. Backcourt spots use the normal setup.</summary>
        public static void setupAt(double off, double x, double y)
        {
            setup(off);
            int NP = cfg.NP;
            double ah = hoop(off);
            if (cfg.HALF != 0 || NP < 2 || !((x - 470) * (ah - 470) > 0)) return;
            double dir = ah > 470 ? -1 : 1, // from the hoop toward mid-court
                endX = ah > 470 ? 934 : 6;
            bool @base = Math.Abs(x - endX) < Math.Min(y, 500 - y);
            var ib = B.owner;
            double ix, iy;
            if (@base)
            {
                ix = endX;
                iy = clamp(y, 40, 460);
                if (Math.Abs(iy - HY) < 45) iy = HY + (iy < HY ? -45 : 45);
            }
            else
            {
                ix = clamp(x, Math.Min(ah + dir * 60, 470), Math.Max(ah + dir * 60, 470));
                iy = y < HY ? 4 : 496;
            }
            double side = iy < HY ? -1 : 1;
            double[][] spots = @base
                ? new[]
                {
                    new[] { ah + dir * 48, HY - 55 },
                    new[] { ah + dir * 48, HY + 55 },
                    new[] { ah + dir * 150, HY - 70 },
                    new[] { ah + dir * 150, HY + 70 },
                }
                : new[]
                {
                    new[] { ix + dir * 30, HY + side * 150 },
                    new[] { ah + dir * 250, HY },
                    new[] { ah + dir * 70, HY + side * 60 },
                    new[] { ah + dir * 20, HY - side * 210 },
                };
            ib.x = ix;
            ib.y = iy;
            ib.f = JsMath.Atan2(HY - iy, (@base ? ah + dir * 120 : ix) - ix);
            int j = 0;
            foreach (var o in P)
                if (o.tm == off && o != ib && !T(o.off))
                {
                    var s = spots[j++ % spots.Length];
                    o.x = s[0];
                    o.y = s[1];
                    o.f = JsMath.Atan2(iy - o.y, ix - o.x);
                }
            foreach (var o in P)
                if (o.tm == off && !T(o.off))
                {
                    var d = manOf(o);
                    if (d == null || T(d.off)) continue;
                    if (o == ib)
                    {
                        // up on the inbounder, a step inside the line, arms up
                        double l = Hypot(ah + dir * 120 - ix, HY - iy);
                        if (!T(l)) l = 1;
                        d.x = ix + ((ah + dir * 120 - ix) / l) * 16;
                        d.y = iy + ((HY - iy) / l) * 16;
                        d.hupT = 1.2;
                    }
                    else
                    {
                        double l = Hypot(ah - o.x, HY - o.y);
                        if (!T(l)) l = 1;
                        d.x = o.x + ((ah - o.x) / l) * 22;
                        d.y = o.y + ((HY - o.y) / l) * 22;
                    }
                    d.f = JsMath.Atan2(o.y - d.y, o.x - d.x);
                }
            foreach (var p in P) { p.x = clamp(p.x, 4, CW - 4); p.y = clamp(p.y, 4, CH - 4); }
            B.x = ib.x;
            B.y = ib.y;
            statAdd("spotInb", 1);
            // the set's action while the inbounder counts: each player's target spot (see inbMove)
            INB.on = 1;
            INB.tm = off;
            INB.tg.Clear();
            var others = new List<Player>();
            foreach (var o in P) if (o.tm == off && o != ib && !T(o.off)) others.Add(o);
            for (int k = 0; k < others.Count; k++)
            {
                var o = others[k];
                double[] s = @base
                    ? // box: the low men pop to the corners, one high man dives to the rim, the other pops to the top
                    (k % 4) switch
                    {
                        0 => new[] { ah + dir * 14, HY - 215 },
                        1 => new[] { ah + dir * 14, HY + 215 },
                        2 => new[] { ah + dir * 26, HY + (iy < HY ? -12 : 12) },
                        _ => new[] { ah + dir * 250, HY },
                    }
                    : // sideline: the near man comes back to the ball, the top flashes to the elbow, the post seals, the corner holds
                    (k % 4) switch
                    {
                        0 => new[] { ix + dir * 70, iy - side * 70 },
                        1 => new[] { ah + dir * 150, HY + side * 50 },
                        2 => new[] { ah + dir * 30, HY + side * 30 },
                        _ => new[] { ah + dir * 20, HY - side * 210 },
                    };
                INB.tg[o] = new[] { clamp(s[0], 10, CW - 10), clamp(s[1], 10, CH - 10) };
            }
        }
        /// <summary>Spot-inbound action: offense runs to its set's spots while the inbounder counts; the defense trails.</summary>
        public static readonly InbState INB = new InbState();
        public static void inbMove(Player p)
        {
            if (p.tm == INB.tm)
            {
                if (INB.tg.TryGetValue(p, out var s) && s != null && inb < 1.0)
                {
                    mv(p, s[0], s[1], 1.15);
                    p.@in.sp = true;
                }
            }
            else
            {
                var o = guardOf(p);
                if (o == null || o == B.owner) return;
                double h = hoop(INB.tm),
                    l = Hypot(h - o.x, HY - o.y);
                if (!T(l)) l = 1;
                if (inb < 0.85) mv(p, o.x + ((h - o.x) / l) * 20, o.y + ((HY - o.y) / l) * 20, 0.9);
            }
        }
        /// <summary>Star tendencies (CPU): deep, mid, drive, post, pass, step-back. Stars have their own; everyone else is derived.</summary>
        public static readonly Dictionary<string, double[]> TEND = new Dictionary<string, double[]>
        {
            //                           deep  mid  drive post pass step
            ["Curry"] = new[] { 0.5, 0.2, 0.15, 0, 0.35, 0.5 },
            ["Doncic"] = new[] { 0.3, 0.2, 0.2, 0.2, 0.55, 0.7 },
            ["Jokic"] = new[] { 0.1, 0.15, 0.05, 0.6, 0.9, 0.1 },
            ["Gilgeous-Alexander"] = new[] { 0.08, 0.55, 0.32, 0, 0.25, 0.3 },
            ["Edwards"] = new[] { 0.22, 0.13, 0.62, 0, 0.18, 0.2 },
            ["Brunson"] = new[] { 0.12, 0.48, 0.28, 0.12, 0.3, 0.3 },
            ["Wembanyama"] = new[] { 0.25, 0.2, 0.15, 0.35, 0.25, 0.3 },
            ["Towns"] = new[] { 0.35, 0.15, 0.1, 0.35, 0.25, 0.1 },
            ["LaMelo Ball"] = new[] { 0.42, 0.15, 0.3, 0, 0.6, 0.3 },
            ["Fox"] = new[] { 0.12, 0.25, 0.6, 0, 0.35, 0.15 },
            ["Murray"] = new[] { 0.3, 0.4, 0.2, 0, 0.35, 0.3 },
            ["Antetokounmpo"] = new[] { 0.05, 0.1, 0.75, 0.2, 0.35, 0.05 },
            ["Durant"] = new[] { 0.28, 0.48, 0.15, 0.15, 0.25, 0.25 },
            ["Tatum"] = new[] { 0.35, 0.25, 0.3, 0.1, 0.35, 0.4 },
            ["Mitchell"] = new[] { 0.35, 0.2, 0.42, 0, 0.3, 0.35 },
            ["Irving"] = new[] { 0.3, 0.3, 0.35, 0, 0.3, 0.45 },
            ["Cunningham"] = new[] { 0.18, 0.35, 0.38, 0.05, 0.5, 0.2 },
            ["Banchero"] = new[] { 0.12, 0.25, 0.45, 0.2, 0.35, 0.15 },
            ["Sengun"] = new[] { 0.05, 0.15, 0.1, 0.6, 0.6, 0.05 },
        };
        /// <summary>Tendencies adapted for CPU players in game-like modes. Returns a shared scratch array: copy it to keep it.</summary>
        public static double[] tendOf(Player p)
        {
            var b = baseTend(p);
            if (cfg.ASTAR != 0 || !gameLike() || isH(p)) return b;
            // adapt: a cold or smothered shooter stops forcing threes; a hot one keeps firing; the game plan tilts everybody
            var o = TW;
            for (int j = 0; j < 6; j++) o[j] = b[j];
            var f3 = form(p, 2);
            var fm = form(p, 1);
            double cut = 0;
            if (p.cold >= 3) cut += 0.35;
            if (f3.pct >= 0 && f3.n >= 2.5 && f3.pct < 0.25) cut += 0.3;
            if (f3.pct >= 0 && f3.ct > 0.6) cut += 0.25; // every look has a hand in his face
            if (hotNow(p)) cut -= 0.4; // feeling it
            cut = clamp(cut, -0.4, 0.75);
            if (cut > 0)
            {
                double m = o[0] * cut,
                    toMid = fm.pct >= 0 && fm.pct < 0.3 ? 0.25 : p.c + 6 >= p.i ? 0.6 : 0.35;
                o[0] -= m;
                o[1] += m * toMid;
                o[2] += m * (1 - toMid) * (p.i >= 70 ? 0.8 : 0.5);
                o[3] += m * (1 - toMid) * (p.i >= 70 ? 0.2 : 0);
                o[4] += 0.1 * cut; // and moves it more
                o[5] *= 1 - 0.5 * cut; // fewer step-back threes
            }
            else if (cut < 0) o[0] *= 1 - cut;
            if (fm.pct >= 0 && fm.n >= 2.5 && fm.pct < 0.25) { o[2] += o[1] * 0.4; o[1] *= 0.6; }
            int od = 1 - (int)p.tm;
            // beating a zone: move it and shoot over it, don't drive into the packed paint
            if (TS.ds[od] == 4) { o[0] = o[0] * 1.3 + (p.c >= 72 ? 0.06 : 0); o[1] *= 1.2; o[2] *= 0.6; o[4] += 0.15; }
            // the defense sags: shooters let it fly; tight / denying: put it on the floor
            else if (TS.ds[od] == 1 && p.c >= 72) { o[0] *= 1.2; o[2] *= 0.85; }
            else if (TS.ds[od] == 2) { o[2] *= 1.3; o[0] *= 0.85; }
            switch ((int)TS.gp[(int)p.tm])
            {
                case 1:
                    o[0] *= 0.55; o[2] *= 1.5; o[3] *= 1.4;
                    break;
                case 2:
                    o[0] *= 0.6; o[1] = o[1] * 1.6 + 0.08; o[3] *= 1.5;
                    break;
                case 3:
                    o[0] = o[0] * 1.35 + (p.c >= 78 ? 0.08 : 0); o[2] *= 0.8;
                    break;
                case 4:
                    o[4] = hotNow(p) ? o[4] * 0.4 : o[4] + 0.35;
                    break;
            }
            return o;
        }
        public static readonly double[] TW = { 0, 0, 0, 0, 0, 0 };
        static readonly double[] TB = { 0, 0, 0, 0, 0, 0 }; // baseTend scratch (TS returns a fresh array; shared like TW)
        static readonly double[] TASD = { 0.2, 0.2, 0.3, 0.1, 0.4, 0.2 };
        public static double[] baseTend(Player p)
        {
            TEND.TryGetValue(p.n ?? "", out var t);
            if (cfg.ASTAR != 0)
            {
                // All-Star game: everybody wants the highlight dunk or the logo three
                var b = t ?? TASD;
                TB[0] = b[0] + 0.15; TB[1] = b[1] * 0.4; TB[2] = b[2] + 0.45; TB[3] = 0; TB[4] = b[4] + 0.2; TB[5] = b[5];
                return TB;
            }
            if (t != null) return t;
            // (modern shot diet: capable shooters live behind the arc, the mid-range is a speciality)
            TB[0] = p.c >= 84 ? 0.5 : p.c >= 75 ? 0.38 : p.c >= 68 ? 0.16 : 0.03;
            TB[1] = p.c >= 75 ? 0.14 : 0.2;
            TB[2] = p.s >= 84 || p.i >= 86 ? 0.35 : 0.2;
            TB[3] = p.i >= 84 && p.ht >= 6.8 ? 0.3 : 0;
            TB[4] = 0.3;
            TB[5] = p.st == 1 || p.st == 3 ? 0.4 : 0.1;
            return TB;
        }
        /// <summary>Modes that play a real game (rules, AI, scoring) rather than a drill.</summary>
        public static bool gameLike() => cfg.GM == "game" || cfg.GM == "clutch" || cfg.GM == "street" || cfg.GM == "king" || cfg.GM == "allstar" || cfg.GM == "daily";
        /// <summary>Seconds left on the broadcast (12-minute) clock, whatever the real quarter length.</summary>
        public static double bcast() => (clock * 720) / QTRLEN;
        /// <summary>Default matchups: best defender on their best scorer, worst on their worst.</summary>
        public static double[] autoMatch(double tt)
        {
            int NP = cfg.NP, t = (int)tt;
            if (NP < 2) return null;
            var mine = new List<int>();
            var theirs = new List<int>();
            for (int k = 0; k < NP; k++) { mine.Add(k); theirs.Add(k); }
            SortStable(mine, (a, b) => Cmp(P[t * NP + b].d - P[t * NP + a].d));
            SortStable(theirs, (a, b) => Cmp(ovr(P[(1 - t) * NP + b]) - ovr(P[(1 - t) * NP + a])));
            var mu = new double[NP];
            for (int j = 0; j < NP; j++) mu[mine[j]] = theirs[j];
            return mu;
        }
        public static Player guardOf(Player p)
        {
            int NP = cfg.NP;
            var mu = TS.mu[(int)p.tm];
            int k = (int)p.k;
            return P[(1 - (int)p.tm) * NP + (mu != null && k < mu.Length ? (int)mu[k] : k)];
        }
        /// <summary>Difficulty multiplier for CPU-controlled teams (no human on it); humans' teammates play at Pro level.</summary>
        public static double cpuK(Player p, double[] k) => ctHas(p.tm) ? k[1] : cfg.DIFF >= 0 && cfg.DIFF < k.Length ? k[cfg.DIFF] : 1;
        public static int nearest(double tt, double x, double y, int ex = -1, Func<int, bool> skip = null)
        {
            int t = (int)tt;
            int b = -1;
            double bd = 1e9;
            int NP = cfg.NP;
            for (int k = 0; k < NP; k++)
            {
                var p = P[t * NP + k];
                double d = Hypot(p.x - x, p.y - y);
                if (t * NP + k != ex && d < bd && !(skip != null && skip(t * NP + k)))
                {
                    bd = d;
                    b = t * NP + k;
                }
            }
            // Fall back to ignoring the skip filter, then the exclusion (1v1 has a single teammate).
            return b >= 0 ? b : skip != null ? nearest(t, x, y, ex) : ex >= 0 ? nearest(t, x, y) : t * NP;
        }
    }
}
