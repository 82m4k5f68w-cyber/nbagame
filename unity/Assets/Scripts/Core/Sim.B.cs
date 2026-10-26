// Port of src/core/sim.ts lines 1038-1554: setup / setupHalf, controller helpers, pass / pick, shotRat, launch (with
// the aim pre-simulation that mirrors the engine step), lag compensation buffer (LAGBUF / lagFrame / lagRec).
using System;
using System.Collections.Generic;
using static Hoops.Core.Util;
using static Hoops.Core.Data;
using static Hoops.Core.Sim;
using static Hoops.Core.Pose;

namespace Hoops.Core
{
    /// <summary>Timing grade of the last human jumper (sim.ts p.tg).</summary>
    public sealed class Tg
    {
        public double off, win, z, c;
        public string g;
        public bool gr;
    }

    public partial class Player
    {
        public double lc, perf, bmp, heat, kickT, hitX, hitY, oop, hangT, pk, pT; // hk, hitT, act, actT, cel, celT, off: Pose.Rest.cs
        public double? cw, mvEnd;

        public Tg tg;
    }

    public static partial class Sim
    {
        static readonly double[] SETUP_Y = { 250, 90, 170, 330, 410 };

        public static void setup(double off)
        {
            INB.on = 0;
            TS.hud = 0;
            if (cfg.HALF != 0) { setupHalf(off); return; }
            if (S == "play" && P.Count > 0) { subs(); gamePlan(1 - off); gamePlan(off); }
            TS.bc = 0;
            TS.tr[0] = TS.tr[1] = 0;
            TS.trT[0] = TS.trT[1] = -99;
            TS.orbP[0] = TS.orbP[1] = 0;
            Array.Fill(TS.lane, 0);
            int NP = (int)cfg.NP, of = (int)off;
            double ah = hoop(off), own = hoop(1 - off);
            var Y = SETUP_Y;
            for (int k = 0; k < NP; k++)
            {
                Player o = P[of * NP + k], e = P[(1 - of) * NP + k];
                o.x = k != 0 || NP == 1 ? own + (ah - own) * (k != 0 ? 0.3 : 0.12) : own < 470 ? 6 : 934;
                e.x = own + (ah - own) * 0.65;
                o.y = Y[k];
                e.y = Y[(k + 2) % 5];
            }
            foreach (var p in P)
            {
                p.vx = p.vy = p.z = p.vz = 0;
                p.mode = "i";
                p.t = 0;
                p.ai = new PlayerAi();
                p.cd = 0;
            }
            B.owner = P[of * NP];
            B.mode = "held";
            B.sc = 0;
            B.sh = 0;
            B.last = null;
            JB = null;
            pos = off;
            shot = 24;
            PCNT[0] = PCNT[1] = 0;
            foreach (var c in CT)
            {
                if (c.fixed_) c.idx = c.tm * NP;
                else c.idx = off != c.tm ? nearestFree(c, B.owner.x, B.owner.y) : c.tm * NP;
                c.lastO = null;
            }
            inb = 1.2;
            if (TS.adv == off)
            {
                // after a late timeout the inbound comes from the frontcourt sideline
                double sh = (hoop(off) - 470) * 0.55;
                foreach (var p in P) p.x += sh;
                TS.adv = -1;
            }
            txt("INBOUND", 480, 230);
        }

        static readonly double[][] HALF_SPOTS_D = { new double[] { -300, 0 }, new double[] { -200, -170 }, new double[] { -200, 170 }, new double[] { -60, -220 }, new double[] { -60, 220 } };

        /// <summary>Street / King of the Court: check the ball at the top; offense spread around the arc, defense in front of them.</summary>
        public static void setupHalf(double off)
        {
            int NP = (int)cfg.NP, of = (int)off;
            double hx = HXs[1];
            for (int k = 0; k < NP; k++)
            {
                Player o = P[of * NP + k], e = P[(1 - of) * NP + k];
                double s0 = hx + HALF_SPOTS_D[k][0], s1 = HY + HALF_SPOTS_D[k][1];
                o.x = s0;
                o.y = s1;
                e.x = s0 + (hx - s0) * 0.18;
                e.y = s1 + (HY - s1) * 0.18;
            }
            foreach (var p in P)
            {
                p.vx = p.vy = p.z = p.vz = 0;
                p.mode = "i";
                p.t = 0;
                p.ai = new PlayerAi();
                p.cd = 0;
                p.f = JsMath.Atan2(HY - p.y, hx - p.x) + (p.tm != off ? Math.PI : 0);
            }
            B.owner = P[of * NP];
            B.mode = "held";
            B.sc = 0;
            B.sh = 0;
            B.last = null;
            JB = null;
            pos = off;
            shot = 24;
            PCNT[0] = PCNT[1] = 0;
            foreach (var c in CT) if (!c.fixed_) c.idx = off == c.tm ? c.tm * NP : nearestFree(c, B.owner.x, B.owner.y);
            inb = 0.6;
            txt("CHECK BALL", 480, 230);
        }

        /// <summary>Nearest teammate for a controller, skipping players other humans already hold.</summary>
        public static int nearestFree(Ctrl c, double x, double y, int ex = -1)
        {
            return (int)nearest(c.tm, x, y, ex, (k) =>
            {
                foreach (var o in CT) if (o != c && o.idx == k) return true;
                return false;
            });
        }

        public static Ctrl ctrlOf(int k)
        {
            foreach (var c in CT) if (c.idx == k) return c;
            return null;
        }

        public static Player PAt(int k) => k >= 0 && k < P.Count ? P[k] : null; // (JS P[k] reads undefined out of range)
        public static Player PAt(double k) => PAt((int)k);

        public static bool isH(Player p)
        {
            if (p == null) return false;
            foreach (var c in CT) if (PAt(c.idx) == p) return true;
            return false;
        }

        public static double tempoOf(Player p)
        {
            foreach (var c in CT) if (PAt(c.idx) == p) return c.tempo;
            return 0;
        }

        static readonly string[] PK_TXT = { "", "NO-LOOK!", "BEHIND THE BACK!", "WRAPAROUND!" };

        public static void pass(Player p, Player r, double? tyIn = null)
        {
            double sk = Clamp((p.s + p.c) / 200, 0.4, 0.95);
            B.kick = HPL.h != null && T - HPL.at < 0.1 && HPL.t != p.tm ? 1 : 0; // a pass out of the help: drive-and-kick
            B.dfl = 0; // (Pro Play: not checked for a deflection yet)
            double near = 0;
            double ddx = r.x - B.x, ddy = r.y - B.y, l2v = ddx * ddx + ddy * ddy, l2 = Util.T(l2v) ? l2v : 1;
            foreach (var qq in P)
            {
                if (qq.tm == p.tm) continue;
                double u = Clamp(((qq.x - B.x) * ddx + (qq.y - B.y) * ddy) / l2, 0, 1);
                if (Hypot(B.x + ddx * u - qq.x, B.y + ddy * u - qq.y) < 20) near = 1;
            }
            double ty = tyIn ?? (Hypot(hoop(r.tm) - r.x, HY - r.y) < 110 && r.j >= 60 && near != 0 ? 2 : near != 0 ? 1 : 0);
            double spd = ty == 2 ? 380 : ty == 1 ? 460 : 560, zt = ty == 2 ? 100 : ty == 1 ? -20 : 62;
            double Tm = Math.Max(0.15, Hypot(ddx, ddy) / spd), tx = r.x, tz = r.y;
            for (int n = 0; n < 3; n++)
            {
                tx = r.x + r.vx * Tm * 0.9;
                tz = r.y + r.vy * Tm * 0.9;
                Tm = Math.Max(0.15, Hypot(tx - B.x, tz - B.y) / spd);
            }
            Player dp = P[(int)nearest(1 - p.tm, p.x, p.y)];
            double press = Hypot(dp.x - p.x, dp.y - p.y) < 45 ? 0.2 : 0,
                er = (1 - sk + press) * Math.Min(28, Hypot(ddx, ddy) * 0.08);
            tx += (Rng.R() - 0.5) * 2 * er;
            tz += (Rng.R() - 0.5) * 2 * er;
            if (ty == 2) Tm *= 1.25;
            B.owner = null;
            B.mode = "pass";
            B.ptype = ty;
            B.to = r;
            double bf = ty == 1 ? 1.07 : 1;
            B.vx = ((tx - B.x) / Tm) * bf;
            B.vy = ((tz - B.y) / Tm) * bf;
            B.vz = (zt - B.z + 0.5 * g * Tm * Tm) / Tm;
            B.age = 0;
            B.last = p;
            B.sh = 0;
            p.cd = 0.4;
            p.pT = 0.25;
            {
                // how it's thrown: behind the back to a man behind you, no-look on the move, wraparound around a defender
                double ang = Math.Abs(JsMath.Atan2(JsMath.Sin(JsMath.Atan2(ddy, ddx) - p.f), JsMath.Cos(JsMath.Atan2(ddy, ddx) - p.f)));
                p.pk = ang > 2.2 && p.s >= 72 && ty != 2 ? 2 : ang > 0.9 && Hypot(p.vx, p.vy) > 90 && p.s >= 75 && ty == 0 ? 1 : near != 0 && ty == 1 && p.s >= 80 ? 3 : 0;
                if (Util.T(p.pk) && isH(p)) txtW(PK_TXT[(int)p.pk], p.x, p.y, 95, "#9fe7ff");
            }
            PCNT[(int)p.tm]++;
            LASTP[(int)p.tm] = T;
            B.pp = new PassPlan { p = p, t = T };
            {
                // Backspin off the fingertips (lob floats, chest pass snaps, bounce pass checks up off the floor).
                double hv = Hypot(B.vx, B.vy), h = Util.T(hv) ? hv : 1, w = ty == 2 ? 5 : ty == 1 ? 7 : 10;
                B.wv = new double[] { (w * B.vy) / h, (-w * B.vx) / h, 0 };
            }
            snd(260, 0.05, "triangle");
        }

        public static Player pick(Player p, Input i)
        {
            Player b = null;
            double bs = -9;
            foreach (var r in P)
            {
                if (r.tm != p.tm || r == p) continue;
                double dx = r.x - p.x, dy = r.y - p.y, dh = Hypot(dx, dy), d = Util.T(dh) ? dh : 1, m = Hypot(i.dx, i.dy);
                double al = m > 0.1 ? (dx * i.dx + dy * i.dy) / d / m : (JsMath.Cos(p.f) * dx + JsMath.Sin(p.f) * dy) / d;
                Player nd = P[(int)nearest(1 - p.tm, r.x, r.y)];
                double s = al * 2 - d / 1500 + (Math.Min(80, Hypot(nd.x - r.x, nd.y - r.y)) / 80) * 0.12 - (al < 0.3 ? 1.5 : 0);
                if (s > bs)
                {
                    bs = s;
                    b = r;
                }
            }
            return b;
        }

        public static bool useRap() => Phys.RAP != null && cfg.physics == "rapier";

        /// <summary>Shot rating used by both the green window and the meter.</summary>
        public static double shotRat(Player p, double D0, bool isFT) =>
            (isFT ? p.c * 0.8 + 15 : D0 < 90 ? p.i : D0 < 237 ? (p.c + p.i) / 2 : p.c) + p.heat * 2;

        static readonly double[] CPUK_LAY = { 0.78, 0.92, 1, 1.1 }, CPUK_JMP = { 0.85, 0.94, 1, 1.06 };
        static readonly List<string> LAUNCH_NOTES = new List<string>();

        public static void launch(Player p)
        {
            p.rl = 1;
            p.lc = p.lc + 1; // launch counter (game modes watch it)
            p.perf = 0;
            double[] H = cfg.hand ? handPos(p) : null;
            bool HK = H != null && H[2] > 40 && H[2] < 170;
            double hx = hoop(p.tm),
                x0 = HK ? H[0] : p.x,
                y0 = HK ? H[1] : p.y,
                z0 = HK ? H[2] : p.z + 66 + (p.st == 2 ? 6 : 0),
                D0 = Hypot(hx - x0, HY - y0);
            bool three = D0 >= 237,
                lay = D0 < 90 || Util.T(p.hk),
                isFT = ftq != null,
                hum = isH(p);
            double TEMPO = tempoOf(p);
            bool tmp = Util.T(TEMPO);
            if (isFT)
            {
                B.ft = 1;
                ftq.fired = 1;
                if (ftq.i + 1 >= ftq.n && !Util.T(ftq.tech) && !Util.T(ftq.keep)) ftq = null;
            }
            else B.ft = 0;
            double b = D0 < 90 || Util.T(p.hk) ? (p.i / 100) * (Util.T(p.hk) ? 0.74 : 0.86) : D0 < 237 ? ((p.c * 0.5 + p.i * 0.5) / 100) * 0.58 : (p.c / 100) * 0.5;
            double ct = 0;
            Player blk = null;
            {
                var (c0, o0) = contestRaw(p);
                ct = c0;
                blk = o0;
            }
            b -= Math.Min(1, ct * (p.sbw > 0 ? 0.25 : 1)) * (D0 < 90 || Util.T(p.hk) ? 0.15 : 0.3); // (finishes: NBA at-rim ~65%)
            if (p.sbw > 0) b += 0.06;
            var notes = LAUNCH_NOTES;
            notes.Clear();
            double cx = hum && p.cw != null ? p.cw.Value : Math.Min(1, ct * (p.sbw > 0 ? 0.25 : 1) + p.bmp * 0.5),
                rat = shotRat(p, D0, isFT),
                wm0 = lay && !isFT ? 1 : winMul(p, D0, notes),
                win = greenWin(p, rat, cx, wm0), // (shared with the HUD meter: the contest shrinks it live)
                rT = lay ? 0.28 : p.st == 1 ? 0.3 : 0.4;
            bool gr;
            B.d0 = isFT ? (double?)null : D0;
            B.fb = !isFT && Util.T(TS.tr[(int)p.tm]) ? 1 : 0; // (broadcast stats: a fast-break shot)
            B.sc2 = !isFT && Util.T(TS.orbP[(int)p.tm]) ? 1 : 0; // (second-chance shot: this possession had an offensive rebound)
            B.cx = cx;
            B.lx = p.x; // (where it went up: shot chart)
            B.ly = p.y;
            B.kk = !isFT && p.kickT > 0 ? 1 : 0; // a shot off a kick-out
            // play-by-play: the call as he rises ("Curry pulls up..."); the result line follows on the make / miss
            if (!isFT && !lay && PREDICT == 0)
                cm("rise", p.n, D0 > 300 ? "deep" : three ? "three" : p.sbw > 0 ? "step" : p.sv == 2 ? "fade" : p.sv == 21 || p.sv == 20 ? "float" : Hypot(p.vx, p.vy) > 60 || (p.mvEnd != null && T - p.mvEnd.Value < 0.6) ? "pull" : "mid");
            if (hum && cx > 0.45 && !lay) txtW(cx > 0.75 ? "SMOTHERED" : "CONTESTED", p.x, p.y, 108, "#ff6b6b");
            if (hum && notes.Count > 0 && !lay)
            {
                bool cool = false;
                foreach (var n in notes) if (n == "DEEP" || n == "COLD") { cool = true; break; }
                txtW(string.Join(" · ", notes), p.x, p.y, 150, cool ? "#7fd4ff" : "#ffb347");
            }
            if (hum)
            {
                double wt = win * (tmp ? 1.2 : 1),
                    wmt = (0.07 + (rat / 100) * 0.05) * (tmp ? 1.2 : 1),
                    cen = (tmp ? rT : p.st == 1 ? 0.45 : 0.6) + (wmt - wt);
                {
                    double tt = tmp ? (p.tp ?? 9) : p.mt;
                    gr = tt >= cen - wt && tt <= cen + wt + 0.03;
                }
                if (gr && !lay && Math.Abs((tmp ? (p.tp ?? 9) : p.mt) - cen) < 0.012)
                {
                    txtW("PERFECT RELEASE", p.x, p.y, 118, "#7CFC7C");
                    p.perf = 1;
                }
                if (!lay)
                {
                    // timing grade: how far from the perfect release, against the size of this shot's green window
                    double? tt = tmp ? p.tp : p.mt;
                    double offT = tt == null ? 9 : tt.Value - cen,
                        rel = Math.Abs(offT) / Math.Max(0.01, wt);
                    string gg = tt == null ? "F" : Math.Abs(offT) < 0.012 ? "A+" : gr ? (rel < 0.45 ? "A" : rel < 0.8 ? "B+" : "B") : rel < 1.6 ? "C" : rel < 2.6 ? "D" : "F";
                    p.tg = new Tg { off = Round(offT * 1000), win = Round(wt * 1000), g = gg, gr = gr, z = zoneOf(p, D0), c = Round(cx * 100) };
                    if (PREDICT == 0)
                        fx(new Fx
                        {
                            k = "tg",
                            n = p.n,
                            o = new Dictionary<string, object> { { "off", p.tg.off }, { "win", p.tg.win }, { "g", p.tg.g }, { "gr", p.tg.gr }, { "z", p.tg.z }, { "c", p.tg.c } },
                        });
                }
                if (!gr && !lay)
                {
                    // shot feedback: how far off the timing was, and what else hurt it
                    double? tt = tmp ? p.tp : p.mt;
                    double offT = tt == null ? 9 : tt.Value - cen;
                    bool far = Math.Abs(offT) > wt * 2.2;
                    string why = cx > 0.6 ? " · HEAVY CONTEST" : p.en < 0.45 ? " · TIRED LEGS" : "";
                    txtW(tmp && p.tp == null ? "NO TEMPO" : (far ? "VERY " : "SLIGHTLY ") + (offT > 0 ? "LATE" : "EARLY") + why, p.x, p.y, 95, "#ff9966");
                }
            }
            else if (lay || isFT) gr = Rng.R() < Clamp(((rat / 100) * 0.75 + (isFT ? 0.1 : 0.22) - cx * (isFT ? 0.45 : 0.32) + (p.sbw > 0 ? 0.1 : 0)) * cpuK(p, CPUK_LAY) * Math.Sqrt(wm0), 0.05, 0.95);
            else
            {
                // CPU jumpers, calibrated to NBA shooting splits: an open three goes in ~30% (poor shooter) .. ~46% (elite),
                // mid-range ~36-50%, and a full contest takes about a third off (league: open 38% vs tight 33% from three)
                // (re-based for v5.0's spacing / kick-outs: open looks come more often, so each one is a touch harder)
                double bse = three ? 0.362 + (0.16 * (rat - 60)) / 40 : 0.29 + (0.14 * (rat - 60)) / 40,
                    pm = Clamp(bse * (1 - 0.25 * cx) * (p.sbw > 0 ? 0.95 : 1) * cpuK(p, CPUK_JMP) * Math.Sqrt(wm0), 0.04, 0.6);
                gr = Rng.R() < pm / (0.98 - cx * 0.25); // (the make roll below keeps its contest factor)
            }
            if (p.heat >= 3 && D0 > 265 && !isFT) txtW("HEAT CHECK!", p.x, p.y, 160, "#ff9a2e");
            B.owner = null;
            B.mode = "air";
            B.sh = 1;
            B.sc = 0;
            B.last = p;
            B.age = 0;
            B.three = three ? 1 : 0;
            B.to = null;
            if (!isFT)
            {
                p.stt.fga++;
                if (three) p.stt.tpa++;
            }
            B.x = x0;
            B.y = y0;
            B.z = z0;
            B.fl = 0;
            B.flBy = null;
            B.clk = clock;
            B.q = q;
            B.rim = 99;
            B.dk = 0;
            B.gn = 0;
            B.abv = -1;
            B.wv = new double[] { 0, 0, 0 };
            ph3Launch(p, three);
            B.gt = B.gtc = 0;
            B.gd = 0; // (green guide: set below for an intended green make)
            Player fd = isFT ? null : shootingFoul(p, lay);
            if (fd != null)
            {
                p.hitT = 0.4; // the shooter wears the contact
                double dlh = Hypot(p.x - fd.x, p.y - fd.y), dl = Util.T(dlh) ? dlh : 1;
                p.hitX = (p.x - fd.x) / dl;
                p.hitY = (p.y - fd.y) / dl;
            }
            bool dunkMiss = cfg.GM == "dunk" && IsDunkSv((int)p.sv) && !gr;
            if (IsDunkSv((int)p.sv) && !dunkMiss && (Util.T(p.oop) || cfg.GM == "dunk" || Rng.R() < 0.9))
            {
                p.oop = 0;
                Player vic = null;
                foreach (var o in P) if (o.tm != p.tm && o.z > 8 && Hypot(o.x - p.x, o.y - p.y) < 22) { vic = o; break; }
                if (vic != null)
                {
                    txtW("POSTERIZED!", vic.x, vic.y, 115, "#ff5a5a");
                    vic.hitT = 0.45;
                    double vh = Hypot(vic.x - p.x, vic.y - p.y), vd = Util.T(vh) ? vh : 1;
                    vic.hitX = (vic.x - p.x) / vd;
                    vic.hitY = (vic.y - p.y) / vd;
                    fx(new Fx { k = "shake", v = 0.8 });
                    fx(new Fx { k = "slow", v = 0.9 });
                }
                else fx(new Fx { k = "shake", v = 0.45 });
                if (fd != null && FLAG != 0)
                {
                    B.owner = p;
                    B.mode = "held";
                    B.sh = 0;
                    p.act = 3;
                    p.actT = 1.1;
                    p.stt.fga--;
                    ban("FLAGRANT 1", fd.n.ToUpperInvariant() + " · 2 SHOTS + THE BALL", "#ff3b3b");
                    cm("flagrant", fd.n, p.n);
                    foul(fd, p, "FLAGRANT", 1, 0, 1);
                    return;
                }
                if (fd != null)
                {
                    B.fl = 1;
                    B.flBy = fd;
                    fx(new Fx { k = "shake", v = 0.5 });
                }
                B.dk = 1;
                // hang on the rim for a beat (pose switches to the hang clip shortly after the slam)
                bool under = false;
                foreach (var o in P) if (o != p && Hypot(o.x - hx, o.y - HY) < 18 && o.z < 10) { under = true; break; }
                p.hangT = under ? 0.85 : 0.55; // don't land on him
                B.x = hx;
                B.y = HY;
                B.z = 116;
                B.vx = B.vy = 0;
                B.vz = -130;
                B.three = 0;
                txtW("DUNK!", hx, HY, 125, "#ffd23f");
                snd(150, 0.2, "square", 0.12);
                return;
            }
            if (fd == null && blk != null && blk.z > 10 && Hypot(blk.x - p.x, blk.y - p.y) < 24 && Rng.R() < (0.025 + (ct * 0.13 * blk.d) / 100) * (cfg.PP >= 2 ? pp2BlkT(blk) : 1)) // (Pro Play v2: block timing)
            {
                // three kinds of block: a control block tipped to himself or a teammate (good defenders keep it - it starts the
                // break), a volleyball swat into the stands, or the plain swat that pops it loose
                double rr = Rng.R();
                bool ctl = rr < 0.15 + (blk.d - 60) / 160,
                    swat = !ctl && rr < 0.5;
                if (ctl)
                {
                    Player mate = blk;
                    double md = 1e9;
                    foreach (var qq in P)
                        if (qq.tm == blk.tm && qq != blk && !Util.T(qq.off))
                        {
                            double d = Hypot(qq.x - blk.x, qq.y - blk.y);
                            if (d < md && d < 160) { md = d; mate = qq; }
                        }
                    double ctx = mate == blk ? blk.x + (470 - blk.x) * 0.06 : mate.x,
                        cty = mate == blk ? blk.y : mate.y,
                        ctt = 0.75;
                    B.vx = (ctx - B.x) / ctt;
                    B.vy = (cty - B.y) / ctt;
                    B.vz = (40 - B.z) / ctt + (g * ctt) / 2; // (lands about chest high at the target)
                    statAdd("ctlBlk", 1);
                    B.ctl = blk.tm;
                }
                else if (swat)
                {
                    // sent away: hard, flat, out toward the nearest sideline
                    double sl = B.y < HY ? -1 : 1;
                    B.vx = (p.x - blk.x) * 6 + (Rng.R() - 0.5) * 60;
                    B.vy = sl * (260 + Rng.R() * 120);
                    B.vz = 30;
                }
                else
                {
                    B.vx = (p.x - blk.x) * 8 + (Rng.R() - 0.5) * 80;
                    B.vy = (Rng.R() - 0.5) * 120;
                    B.vz = 60;
                }
                if (phOn()) phBlock(p, blk, ctl ? 1 : swat ? 2 : 0); // PH2: his hand vs the ball shapes the deflection
                B.sh = 0;
                B.last = blk; // (he touched it last: swatted out of bounds, the shooting team keeps it)
                blk.stt.blk++;
                exc(swat ? 1 : 0.9);
                txtW(ctl ? "BLOCKED - AND KEPT!" : swat ? "SENT AWAY!" : "BLOCKED!", blk.x, blk.y, 80, "#ff6b4a");
                cm("block", blk.n);
                p.act = 6; // the shooting arm gets knocked back
                p.actT = 0.45;
                if (PREDICT == 0) { blk.cel = 14; blk.celT = CEL_T; } // the blocker holds the swat / stares him down
                snd(150, 0.15, "square");
                if (Rng.R() < 0.12) tech(blk, p.tm);
                return;
            }
            bool rap = useRap();
            if (dunkMiss && hum) txtW("MISSED DUNK!", p.x, p.y, 120, "#ff6b4a");
            // (Pro Play v2: contact knocks a fouled shot off - layups x.5, CPU jumpers x.35; a human's green still counts)
            bool mk = dunkMiss ? false : lay ? (gr && hum) || Rng.R() < Clamp(b + (gr ? 0.15 : 0), 0.03, 0.97) * (fd != null && cfg.PP >= 2 ? 0.5 : 1) : gr && (Util.T(p.perf) || hum || Rng.R() < (0.98 - cx * 0.25) * (fd != null && cfg.PP >= 2 && !hum ? 0.35 : 1)); // (a human's green is a make)
            if (!hum && !lay && !isFT)
            {
                // (tuning counters: CPU jumpers launched / meant to go in)
                string jk = three ? "j3" : "j2";
                statAdd(jk + "n", 1);
                if (mk) statAdd(jk + "mk", 1);
            }
            double a = Rng.R() * 6.28,
                off = mk ? (rap || cfg.PH3 != 0 ? 0.3 : 1.2) : 9 + Rng.R() * 7, // (Physics v3: the legacy ball is pre-simulated too)
                tx = hx + JsMath.Cos(a) * off,
                ty = HY + JsMath.Sin(a) * off,
                dx = tx - x0,
                dy = ty - y0,
                Dh = Hypot(dx, dy),
                D = Util.T(Dh) ? Dh : 1,
                dz = 100 - z0;
            if (fd != null && (!mk || FLAG != 0))
            {
                B.owner = p;
                B.mode = "held";
                B.sh = 0;
                if (FLAG != 0)
                {
                    p.act = 3; // knocked to the floor
                    p.actT = 1.1;
                    p.stt.fga--;
                    if (three) p.stt.tpa--;
                    ban("FLAGRANT 1", fd.n.ToUpperInvariant() + " · 2 SHOTS + THE BALL", "#ff3b3b");
                    cm("flagrant", fd.n, p.n);
                    foul(fd, p, "FLAGRANT", 1, 0, 1);
                }
                else foul(fd, p, "SHOOTING", 1, three ? 1 : 0);
                return;
            }
            if (fd != null)
            {
                B.fl = 1;
                B.flBy = fd;
                if (lay) p.sv = 18; // finishes through the contact
            }
            // Release angles like real shooters (~48-55 deg; floaters and heaves higher), plus a small per-player arc from the form signature.
            double fa = p.sg != null && Util.T(p.sg.a) ? p.sg.a : 0;
            double th = (D < 90 ? 1.0 : D < 200 ? 0.9 : D < 300 ? 0.86 : D < 400 ? 0.97 : 1.1) + fa * 0.12;
            for (int k = 0; k < 8 && D * JsMath.Tan(th) - dz < 8 && th < 1.45; k++) th += 0.08;
            double ge = g,
                v = Math.Sqrt((ge * D * D) / (2 * Math.Pow(JsMath.Cos(th), 2) * Math.Max(1, D * JsMath.Tan(th) - dz)));
            if (cfg.PH3 != 0)
            {
                ge = g - AIR_KM * 16 * v * JsMath.Cos(th);
                v = Math.Sqrt((ge * D * D) / (2 * Math.Pow(JsMath.Cos(th), 2) * Math.Max(1, D * JsMath.Tan(th) - dz)));
            }
            else if (rap)
            {
                ge = g - 0.0032 * 16 * v * JsMath.Cos(th);
                v = Math.Sqrt((ge * D * D) / (2 * Math.Pow(JsMath.Cos(th), 2) * Math.Max(1, D * JsMath.Tan(th) - dz)));
            }
            B.vz = v * JsMath.Sin(th);
            // a tip from right under the rim can come out too soft to even reach it: give it enough lift to clear the iron
            if (B.vz * B.vz + 2 * ge * (z0 - 100) < 0) B.vz = Math.Sqrt(2 * ge * (106 - z0));
            double TF = (B.vz + Math.Sqrt(Math.Max(0, B.vz * B.vz + 2 * ge * (z0 - 100)))) / ge,
                hv = (D * 0.1) / (1 - JsMath.Exp(-0.1 * TF));
            B.vx = (hv * dx) / D;
            B.vy = (hv * dy) / D;
            {
                double h3v = Hypot(B.vx, B.vy), h3 = Util.T(h3v) ? h3v : 1;
                B.wv = new double[] { (16 * B.vy) / h3, (-16 * B.vx) / h3, 0 };
            }
            if (cfg.PH3 != 0)
            {
                // Physics v3 (engine and legacy alike): pre-simulate the same air step as bstep / the engine (quadratic drag
                // + Magnus, then gravity, the spin's slow decay) and correct range and sideways error; an arc that would not
                // get back down through the rim height gets more lift first
                for (int it = 0; it < 6; it++)
                {
                    double x = x0, y = y0, z = z0, vx = B.vx, vy = B.vy, vz = B.vz, T2 = 0, w0 = B.wv[0], w1 = B.wv[1], zm = z0;
                    bool hit = false;
                    double h = 1.0 / 120, wd = 1 / (1 + h * AIR_WD);
                    while (T2 < 4)
                    {
                        AV[0] = vx; AV[1] = vy; AV[2] = vz; AV[3] = w0; AV[4] = w1; AV[5] = 0;
                        airAcc(h);
                        vx = AV[0];
                        vy = AV[1];
                        vz = AV[2] - g * h;
                        double qz = z;
                        x += vx * h;
                        y += vy * h;
                        z += vz * h;
                        w0 *= wd;
                        w1 *= wd;
                        T2 += h;
                        if (z > zm) zm = z;
                        if (qz >= 100 && z < 100 && vz < 0) { hit = true; break; }
                        if (z < 0) break;
                    }
                    if (!hit || zm < 103)
                    {
                        B.vz *= 1.06;
                        continue;
                    }
                    B.vx += ((tx - x) / Math.Max(0.2, T2)) * 0.9;
                    B.vy += ((ty - y) / Math.Max(0.2, T2)) * 0.9;
                    double h4v = Hypot(B.vx, B.vy), h4 = Util.T(h4v) ? h4v : 1;
                    B.wv = new double[] { (16 * B.vy) / h4, (-16 * B.vx) / h4, 0 };
                }
            }
            else if (rap)
            {
                // Pre-simulate drag + Magnus and correct range and sideways error so perfect timing still goes in.
                for (int it = 0; it < 6; it++)
                {
                    double x = x0, y = y0, z = z0, vx = B.vx, vy = B.vy, vz = B.vz, T2 = 0, w0 = B.wv[0], w1 = B.wv[1];
                    // (exactly what rapStep + the engine do each half-frame: drag, Magnus, gravity, symplectic Euler, and the
                    // spin decaying with the ball body's angular damping .3 - a constant spin over-predicted the lift on long heaves)
                    double h = 1.0 / 120, wd = 1 / (1 + h * 0.3);
                    while (T2 < 4)
                    {
                        vx *= 1 - 0.1 * h;
                        vy *= 1 - 0.1 * h;
                        vz += 0.0032 * (w0 * vy - w1 * vx) * h - g * h;
                        double qz = z;
                        x += vx * h;
                        y += vy * h;
                        z += vz * h;
                        w0 *= wd;
                        w1 *= wd;
                        T2 += h;
                        if (qz >= 100 && z < 100 && vz < 0) break;
                    }
                    B.vx += ((tx - x) / Math.Max(0.2, T2)) * 0.9;
                    B.vy += ((ty - y) / Math.Max(0.2, T2)) * 0.9;
                    double h4v = Hypot(B.vx, B.vy), h4 = Util.T(h4v) ? h4v : 1;
                    B.wv = new double[] { (16 * B.vy) / h4, (-16 * B.vx) / h4, 0 };
                }
            }
            B.gn = gr ? 1 : 0;
            B.gd = gr && mk && hum ? 1 : 0; // a human's green (CPU odds stay calibrated with the iron): greenGuide (bstep) sees it through the iron, bodies and spin drift
            if (cfg.PH3 != 0 && !Util.T(B.gd) && !lay && !isFT) ph3Short(p); // (Physics v3: tired legs - never a human's green)
            B.ghx = hx;
            if (gr && hum) txtW("GREEN!", p.x, p.y, 95, "#2ecc71");
            if (gr && PREDICT == 0 && !(p.celT > 0))
            {
                // knows it's good: holds the follow-through through the landing (pose CEL 10)
                p.cel = 10;
                p.celT = CEL_T;
            }
            snd(380, 0.07, "triangle");
        }

        /// <summary>Positions of everyone as the shooter saw them (lag compensation for online guests): a past frame or null = now.</summary>
        public static readonly List<float[]> LAGBUF = new List<float[]>();

        public static float[] lagFrame(Player p)
        {
            Ctrl c = null;
            foreach (var o in CT) if (PAt(o.idx) == p) c = o;
            double back = c != null && Util.T(c.lag) ? Math.Min(14, Round(c.lag * 60)) : 0;
            return Util.T(back) && LAGBUF.Count > back ? LAGBUF[LAGBUF.Count - 1 - (int)back] : null;
        }

        public static void lagRec()
        {
            bool any = false;
            foreach (var c in CT) if (Util.T(c.lag)) { any = true; break; }
            if (!any)
            {
                LAGBUF.Clear();
                return;
            }
            float[] a = null;
            if (LAGBUF.Count > 14) { a = LAGBUF[0]; LAGBUF.RemoveAt(0); }
            if (a == null || a.Length != P.Count * 3) a = new float[P.Count * 3];
            for (int k = 0; k < P.Count; k++)
            {
                var p = P[k];
                a[k * 3] = (float)p.x;
                a[k * 3 + 1] = (float)p.y;
                a[k * 3 + 2] = (float)p.z;
            }
            LAGBUF.Add(a);
        }
    }
}
