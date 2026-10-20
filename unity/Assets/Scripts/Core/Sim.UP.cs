// Pro Play pack (cfg.PP = 1, the default in BOTH engines since v5.3; the TS twin is the "Pro Play pack" block in
// src/core/sim.ts - same names, same order of random draws, so CoreTests/Trace.cs stays bit-identical to the TS).
// Started as the Unity-only UP moves: new dribble moves and combo chains, drive gathers (two-step / hop-step / spin),
// floaters, sky hooks, off-hand reverses, contest reactions, stronger landings, power putbacks, drive bumps, defensive
// swipe-downs and hand checks, V-cuts. v5.3 adds: human move buffer + cancel window (ppBuffer), sprint burst, on-ball
// stance (ppStance), contest timing + feedback (ppRelease), pass deflections that never change possession (ppDeflect),
// height on the glass, box-outs that wear off. Sim side only: the extra Unity poses stay in Pose.UP.cs under cfg.UP.
//
// Move codes (Input.mv / p.mvk): 1 hesitation, 2 spin, 3 behind the back, 4 post move (TS) + 5 in-and-out, 6 crossover,
// 7 snatch-back (UP). Keys stay the same; the stick picks the variant at the moment the move key is pressed:
//   C (LB)  hesitation  | stick sideways -> IN-AND-OUT (5) | stick pulled back (away from the rim) -> SNATCH-BACK (7)
//   X (RB)  spin
//   V       behind the back | stick sideways -> CROSSOVER (6) toward the stick
//   flick the stick to the other side at speed -> CROSSOVER (6) (TS: behind the back); again within 0.5 s of the end
//   of a crossover -> DOUBLE CROSSOVER (crosses back). Any move started within 0.5 s of the last one chains a combo.
// Shooting (no new keys): Space while driving at the rim from 8-16 ft -> gather (two-step, hop-step past a defender at
// the side, spin-gather around one in front), floaters vs a rim protector, sky hook for tall / skilled post scorers
// (post + C), off-hand reverse on baseline drives from the right side of the rim.
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
        public double gath, gathT, gsu, gSd; // drive gather: kind (1 two-step, 2 hop-step, 3 spin), time, deferred release, side
        public double lnA, lnS; // contest reaction: lean-away weight and side (+ = his left)
        public double offH; // finishing with the off hand (reverse off the glass): the shot pose is mirrored
        public double bmpT, swpT, vcT, hcT; // drive-bump cooldown, defender swipe-down timer, V-cut timer, hand-check timer
        public double catchT = -9, jg; // last catch time; jumper gather: 1 catch-and-shoot 1-2 step, 2 off the dribble hop
        public double mvP; // the move before the current one (combo names)
        public double upLand; // last landing strength (0..1.3)
        public double tdT; // takeoff time of the last jumper (pose: rise / extension)
        public string upF; // active UP feature this tick (tests bucket their numbers by it)
        public double gfw; // forward drive speed when the gather / shot started
        public double mvB, mvBT; // buffered move (human): code and press time
        public double stc; // human on-ball defensive stance this tick (host-side)
        public double spT; // seconds of the current sprint press (human): the first .35 s is a burst
    }

    public static partial class Sim
    {
        /// <summary>Counters per UP feature (moves started, gathers, floaters, ...) for the tests.</summary>
        public static readonly Dictionary<string, double> UPC = new Dictionary<string, double>();
        static void upc(string k)
        {
            if (PREDICT != 0) return;
            UPC.TryGetValue(k, out var v);
            UPC[k] = v + 1;
        }
        static readonly string[] MV_UP = { "", "HESITATION", "SPIN MOVE", "BEHIND THE BACK", "", "IN-AND-OUT", "CROSSOVER", "SNATCH-BACK" };

        /// <summary>UP move start (replaces the TS non-post branch of step when cfg.UP != 0).</summary>
        public static void upMoveStart(Player p, Input i, Player d, double dist, double Sd, bool u, double ux, double uy, double D)
        {
            double mvq = i.mv;
            double sl = Hypot(i.dx, i.dy),
                lat = sl > 0.3 ? (i.dx * -uy + i.dy * ux) / D / sl : 0,
                fw = sl > 0.3 ? (i.dx * ux + i.dy * uy) / D / sl : 0;
            if (mvq == 1) { if (fw < -0.55) mvq = 7; else if (Math.Abs(lat) > 0.55) mvq = 5; }
            else if (mvq == 3 && Math.Abs(lat) > 0.55) mvq = 6;
            if ((mvq == 5 || mvq == 6) && Math.Abs(lat) > 0.4) Sd = Sign(lat);
            bool chain = p.mvEnd != null && T - p.mvEnd.Value < 0.5;
            bool dbl = chain && mvq == 6 && p.mvk == 6;
            p.combo = chain && (p.mvk != mvq || dbl) ? Math.Min(4, (Util.T(p.combo) ? p.combo : 1) + 1) : 1;
            if (dbl) Sd = -p.mvS; // cross it right back
            p.mvP = chain ? p.mvk : 0;
            p.mvk = mvq;
            p.mvT = mvq == 5 ? 0.46 : mvq == 6 ? (p.combo > 1 ? 0.34 : 0.4) : mvq == 7 ? 0.44 : p.combo > 1 ? 0.42 : 0.5;
            p.mvE = 0;
            p.mvS = Sd;
            p.cd = mvq == 7 ? 0.5 : 0.55;
            upc("mv" + mvq);
            if (p.combo > 1) upc("combo");
            if (u)
            {
                int mi = (int)mvq;
                string mt = dbl ? "DOUBLE CROSSOVER" : p.mvP == 1 && mvq == 6 ? "HESI CROSS" : p.mvP == 5 && mvq == 6 ? "KILLER CROSS" : mi >= 0 && mi < MV_UP.Length ? MV_UP[mi] : "MOVE";
                txtW(mt + (p.combo > 1 && !dbl ? " · COMBO x" + p.combo : ""), p.x, p.y, 100, "#ffd23f");
            }
            if (PREDICT != 0) return;
            if (mvq == 7)
            {
                // snatch-back: hop away from a defender who is crowding / closing - space for the pull-up
                if (dist < 45)
                {
                    d.slow = Math.Max(d.slow, 0.35);
                    if (u) txtW("CREATED SPACE", p.x, p.y, 95, "#ffd23f");
                }
                return;
            }
            if (cfg.PP >= 2)
            {
                pp2Read(p, d, dist, mvq, Sd, ux, uy, D, u); // (v5.4: the defender's read decides it)
                return;
            }
            double bon = mvq == 5 ? 0.06 : mvq == 6 ? 0.04 : 0;
            if (dist < 60 && Rng.R() < 0.5 + (p.s - d.d) / 250 + (hasB(p, "AB") ? 0.12 : 0) + (p.combo - 1) * 0.12 + bon)
            {
                d.slow = Math.Max(d.slow, 0.7);
                d.scr = Math.Max(d.scr, 0.35);
                d.hitT = 0.34;
                d.hitX = -uy * Sd;
                d.hitY = ux * Sd;
                upc("ankle");
                if (u) txtW("ANKLE BREAKER!", d.x, d.y, 95, "#ff6b6b");
            }
        }

        /// <summary>Velocity profile of the UP moves (fraction toward the rim f, sideways l x side).</summary>
        public static void upMoveVel(double k, double e, out double f, out double l)
        {
            f = 0; l = 0;
            if (k == 5)
            {
                if (e < 0.16) { f = 0.35; l = -0.45; } // sell the crossover
                else if (e < 0.24) { f = 0.2; l = 0; } // plant
                else { f = 1.3; l = 0.55; } // and go the same way
            }
            else if (k == 6)
            {
                if (e < 0.1) { f = 0.35; l = -0.3; } // a short counter-step the other way
                else { f = 0.95; l = 1.05; }
            }
            else if (k == 7)
            {
                if (e < 0.24) f = -1.15; // two hops straight back
                else f = 0.05;
            }
        }

        /// <summary>CPU dribble move (UP): the signature package (formOf dk) picks it. Same single random draw as the TS.</summary>
        public static double upCpuMove(Player p, Player dn, double r)
        {
            double dk = p.sg != null ? p.sg.dk : 0,
                dd = Hypot(dn.x - p.x, dn.y - p.y),
                cl = (dn.vx * (p.x - dn.x) + dn.vy * (p.y - dn.y)) / Math.Max(1, dd),
                D = Hypot(hoop(p.tm) - p.x, HY - p.y);
            if (cl > 120 && dd < 40 && D > 150 && D < 260 && r < 0.5) return 7; // closing hard: snatch it back
            // 0 btb + cross, 1 Curry: between the legs / in-and-out chains, 2 Doncic: slow hesitations and snatch-backs,
            // 3 Edwards: hard crosses and spins
            double[] pk = dk == 1 ? PK1 : dk == 2 ? PK2 : dk == 3 ? PK3 : PK0;
            return pk[Math.Min(pk.Length - 1, (int)(r * pk.Length))];
        }
        static readonly double[] PK0 = { 1, 3, 6, 6, 5, 2 }, PK1 = { 3, 5, 5, 6, 1, 3 }, PK2 = { 1, 1, 7, 5, 6, 2 }, PK3 = { 6, 6, 2, 6, 1, 5 };

        /// <summary>A defender between him and the rim, close to it: floater territory.</summary>
        public static bool rimProt(Player p)
        {
            double hx = hoop(p.tm), D = Hypot(hx - p.x, HY - p.y);
            foreach (var o in P)
            {
                if (o.tm == p.tm || Util.T(o.off)) continue;
                double dr = Hypot(o.x - hx, o.y - HY);
                if (dr < 60 && dr < D - 20) return true;
            }
            return false;
        }

        /// <summary>Mode i -> c (UP): start a drive gather when attacking the rim fast from 8-16 ft.</summary>
        public static void upGatherStart(Player p, double ux, double uy, double D)
        {
            p.gath = 0;
            p.gsu = 0;
            p.gfw = (p.vx * ux + p.vy * uy) / D; // drive speed at the gather (the charge damps it before the clip is picked)
            p.jg = T - p.catchT < 1.0 && Hypot(p.vx, p.vy) < 60 ? 1 : Hypot(p.vx, p.vy) > 60 ? 2 : 0;
            if (B.owner != p || ftq != null || Util.T(p.postA) || p.upu > 0 || p.fsv != null) return;
            double fw = (p.vx * ux + p.vy * uy) / D;
            if (fw < 150 || D < 80 || D > 165 || rimProt(p) && D > 110) return;
            // what is in the way decides the footwork
            Player d = P[(int)nearest(1 - p.tm, p.x, p.y)];
            double dx = d.x - p.x, dy = d.y - p.y, dd = Hypot(dx, dy),
                ahead = (dx * ux + dy * uy) / D,
                side = (dx * -uy + dy * ux) / D;
            p.gSd = side >= 0 ? -1 : 1; // away from him
            p.gath = dd < 34 && ahead > 6 && Math.Abs(side) < 12 && p.s >= 72 ? 3 : dd < 50 && ahead > -6 && Math.Abs(side) >= 8 ? 2 : 1;
            p.gathT = 0;
            p.jg = 0;
            upc(p.gath == 3 ? "spinGather" : p.gath == 2 ? "hopStep" : "gather");
            if (isH(p)) txtW(p.gath == 3 ? "SPIN GATHER" : p.gath == 2 ? "HOP STEP" : "GATHER", p.x, p.y, 95, "#ffd23f");
        }

        /// <summary>Mode c (UP): the gather keeps the drive's momentum toward the rim (true = skip the TS damping). A release
        /// pressed during it waits for the takeoff.</summary>
        public static bool upGather(Player p, Input i, double dt, double ux, double uy, double D, bool hum)
        {
            if (!(p.gath > 0)) return false;
            double dur = p.gath == 3 ? 0.4 : p.gath == 2 ? 0.36 : 0.32;
            if (i.su) { p.gsu = 1; i.su = false; }
            p.gathT += dt;
            if (p.gathT >= dur || D < 62 || B.owner != p)
            {
                p.gath = -p.gath; // done: the pose keeps the kind for the takeoff, the release goes now
                if (Util.T(p.gsu) || !hum) i.su = true;
                return false;
            }
            double sp = clamp(Hypot(p.vx, p.vy), 130, 250),
                ex = ux / D, ey = uy / D, lx = -ey * p.gSd, ly = ex * p.gSd;
            double f = sp, l = 0;
            if (p.gath == 2) { if (p.gathT > 0.14 && p.gathT < 0.28) { f = sp * 0.55; l = 150; } else f = sp * 0.8; } // the hop to the side
            else if (p.gath == 3) { f = sp * 0.75; l = 70 * JsMath.Sin(p.gathT / dur * Math.PI); } // spin round him
            double tx = ex * f + lx * l, ty = ey * f + ly * l, k = Math.Min(1, dt * 14);
            p.vx += (tx - p.vx) * k;
            p.vy += (ty - p.vy) * k;
            return true;
        }

        /// <summary>After the shot clip was picked (UP): floaters, sky hooks, off-hand reverses.</summary>
        public static void upAfterClip(Player p, double D, bool lay)
        {
            p.offH = 0;
            double hx = hoop(p.tm), dir = hx > 470 ? 1 : -1, fw = Math.Max(p.vx * dir, p.gfw);
            if (p.sv == 10 && (p.ht >= 6.9 || p.i >= 88)) { p.sv = 25; upc("skyHook"); if (isH(p)) txtW("SKY HOOK", p.x, p.y, 100, "#ffd23f"); return; }
            if (!lay && D >= 90 && D < 180 && fw > 60 && (rimProt(p) || p.st == 4) && (p.sv == 21 || p.sv == 8 || p.sv == 22 || p.sv == 0 || p.sv == 1 || p.sv == 4 || p.sv == 20 || p.sv == 2 || p.sv == 3)) // (a fade / step-back form while charging the rim = a floater too)
            {
                p.sv = 24;
                upc("floater");
                return;
            }
            // reverse under the rim from the right side (his right hand would be on the defense's side): off hand off the glass
            if (p.sv == 17 && (p.y - HY) * dir < 0) { p.offH = 1; upc("offHand"); }
            if (lay && Math.Abs(p.gath) == 2) upc("hopFinish");
            if (lay && Math.Abs(p.gath) == 3) upc("spinFinish");
        }

        /// <summary>Mode s (UP): a late hard closeout makes the shooter lean / fade away from the hand and get it off a beat
        /// quicker and higher. Returns the release-time adjustment.</summary>
        public static double upContest(Player p, double D, bool has)
        {
            if (p.lnA > 0) return -0.03;
            if (!has || D < 90 || ftq != null || p.t < 0.05 || p.t > 0.25 || Util.T(p.react)) return 0;
            foreach (var o in P)
            {
                if (o.tm == p.tm || Util.T(o.off)) continue;
                double dx = p.x - o.x, dy = p.y - o.y, d = Hypot(dx, dy);
                if (d > 36 || d < 1) continue;
                double cl = (o.vx * dx + o.vy * dy) / d;
                if (cl < 110 && !(o.z > 8 && d < 30)) continue;
                p.lnA = 1;
                // side of his hand in the shooter's frame (+ = shooter's left): lean the other way
                double sd = (-(o.x - p.x) * JsMath.Sin(p.f) + (o.y - p.y) * JsMath.Cos(p.f));
                p.lnS = sd >= 0 ? -1 : 1;
                if (PREDICT == 0)
                {
                    p.vx += dx / d * 45;
                    p.vy += dy / d * 45;
                    if (isH(p) && p.cw != null) p.cw = Math.Max(0, p.cw.Value - 0.08);
                    upc("leanAway");
                    if (isH(p)) txtW("LEANS AWAY", p.x, p.y, 112, "#ffd23f");
                }
                return -0.03;
            }
            return 0;
        }

        /// <summary>Landing (UP): softer for small hops, deeper for real drops (jump height from the touchdown speed).</summary>
        public static void upLanding(Player p)
        {
            double v = -p.vz;
            if (v < 60) return;
            p.landT = Math.Min(0.36, v / 700);
            p.upLand = Math.Min(1.3, v / 230);
            if (v > 180) upc("land");
        }

        /// <summary>Offensive board on the floor right under the rim (CPU): go straight back up strong.</summary>
        public static void upPutback(Player p, bool wasShot, Player shooter)
        {
            if (!wasShot || shooter == null || shooter.tm != p.tm || p.z > 8 || isH(p) || ftq != null || PREDICT != 0) return;
            if (Hypot(hoop(p.tm) - p.x, HY - p.y) > 60 || p.j < 45 || Rng.R() > 0.65) return;
            p.mode = "s";
            p.t = 0.1;
            p.sv = p.j < 60 ? 5 : p.j >= 80 && Rng.R() < 0.4 ? 12 : 11; // (power layup for the lower leapers)
            p.rl = 0;
            p.hk = 1;
            p.vz = 150 + p.j * 0.9;
            p.ttT = 0;
            upc("putback");
            txtW(p.sv == 5 ? "PUTBACK" : "PUTBACK SLAM!", p.x, p.y, 115, "#ffd23f");
        }

        /// <summary>CPU drive (UP): attacking the rim at speed, start the gather from 9-14 ft (layup / floater territory).</summary>
        public static bool upCpuGather(Player p, double D)
        {
            var a = p.ai;
            if (!(a.r > 0 && a.r < 90) || D > 150 || D < 95 || p.cd > 0 || p.mvT > 0) return false;
            double hx = hoop(p.tm), fw = (p.vx * (hx - p.x) + p.vy * (HY - p.y)) / D;
            if (fw < 160) return false;
            p.@in.sd = true;
            a.rel = 0.3;
            return true;
        }

        /// <summary>V-cut (UP): a spacer whose man is up on him sinks a step toward the rim, plants and pops out to the spot.</summary>
        public static bool upVcut(Player p, double spX, double spY, double hx, Player md)
        {
            double d = Hypot(spX - p.x, spY - p.y);
            if (!(p.vcT > 0))
            {
                if (d > 45 || md == null || Hypot(md.x - p.x, md.y - p.y) > 30 || B.owner == null || JsMath.Sin(T * 0.9 + p.k * 2.3) < 0.93) return false;
                p.vcT = 0.75;
                upc("vcut");
            }
            p.br = "vcut";
            if (p.vcT > 0.4) mv(p, spX + (hx - spX) * 0.22, spY + (HY - spY) * 0.22, 0.85); // sell the cut
            else mv(p, spX, spY, 1.3); // plant and pop
            return true;
        }

        /// <summary>Once per tick after every step (UP): timers, drive bumps, swipe-downs, catch times.</summary>
        public static void upTick(double dt)
        {
            for (int k = 0; k < P.Count; k++)
            {
                var p = P[k];
                if (Util.T(p.off)) continue;
                p.bmpT -= dt;
                if (p.swpT > -5) p.swpT -= dt;
                if (p.vcT > 0) p.vcT -= dt;
                if (p.hcT > -5) p.hcT -= dt;
                if (p.boxT > 0) p.boxT -= dt; // (a box-out holds while he keeps it: it used to count forever)
                if (p.mode != "s") p.lnA = Math.Max(0, p.lnA - dt * 5);
                if (p.mode == "i") { if (p.z <= 0) p.offH = 0; if (p.gath > 0 || p.z <= 0) p.gath = 0; }
                if (p.mode == "s" && p.t < 0.02) p.tdT = T;
                if (cfg.PP >= 2)
                {
                    p.stillT = p.z <= 0 && Hypot(p.vx, p.vy) < 45 ? p.stillT + dt : 0; // (feet set: charges)
                    if (p.cutT > -1) p.cutT -= dt;
                }
            }
            var o = B.owner;
            if (o != null && B.hold != o) o.catchT = T;
            if (o == null || o.mode != "i" || PREDICT != 0 || Util.T(o.postA)) return;
            double sp = Hypot(o.vx, o.vy);
            Player d = P[(int)nearest(1 - o.tm, o.x, o.y)];
            double dx = d.x - o.x, dy = d.y - o.y, dd = Hypot(dx, dy);
            // shoulder bump on the drive: both bodies recoil, the driver loses a little speed
            if (sp > 140 && o.bmpT <= 0 && dd < 21 && dd > 1 && (dx * o.vx + dy * o.vy) / (dd * sp) > 0.3)
            {
                o.bmpT = 0.7;
                double nx = dx / dd, ny = dy / dd, f = (o.bk * o.ht) / (d.bk * d.ht);
                o.hitT = 0.18; o.hitX = -nx; o.hitY = -ny;
                d.hitT = 0.22; d.hitX = nx; d.hitY = ny;
                if (cfg.PP >= 2)
                {
                    if (pp2Bump(o, d, nx, ny, dd)) return; // (v5.4: cut off by a set defender - maybe a charge - or bumps a beaten one off)
                }
                else
                {
                    o.vx *= 0.86; o.vy *= 0.86;
                    d.x += nx * 2.5 * f; d.y += ny * 2.5 * f;
                }
                upc("bump");
            }
            // on-ball defender swipes down at the ball on the drive (never a steal: steals are off by design)
            if (dd < 34 && sp > 90 && d.swpT < -1.2 && d.z <= 0 && Rng.R() < dt * 1.5)
            {
                d.swpT = 0.36;
                upc("swipe");
            }
            // hand check: the on-ball defender jabs a hand into the handler's hip as he sizes him up (legal - the handler's
            // torso gives a little and he loses a step of speed; no foul, no steal)
            else if (dd < 30 && dd > 1 && sp < 150 && d.hcT < -0.9 && d.swpT <= 0 && d.z <= 0 && Rng.R() < dt * 1.1)
            {
                d.hcT = 0.3;
                double nx = dx / dd, ny = dy / dd;
                o.hitT = Math.Max(o.hitT, 0.12); o.hitX = -nx; o.hitY = -ny;
                o.vx *= 0.94; o.vy *= 0.94;
                upc("handCheck");
            }
        }

        /// <summary>Human move buffer + cancel window: a move pressed while it can't start is kept 0.25 s; pressed in (or
        /// buffered into) the last 0.15 s of the current move it cancels the tail and starts at once (a combo chain).</summary>
        public static void ppBuffer(Player p, Input i)
        {
            if (Util.T(i.mv)) { p.mvB = i.mv; p.mvBT = T; }
            if (!Util.T(p.mvB)) return;
            if (T - p.mvBT > 0.25 || Util.T(p.postA) || ftq != null || pos != p.tm)
            {
                p.mvB = 0;
                return;
            }
            if (p.mvT > 0)
            {
                if (p.mvk != 4 && p.mvT < 0.15)
                {
                    p.mvT = 0;
                    p.mvEnd = T;
                    p.cd = 0;
                    i.mv = p.mvB;
                    p.mvB = 0;
                    upc("cancel");
                }
                return;
            }
            if (p.cd <= 0)
            {
                i.mv = p.mvB;
                p.mvB = 0;
            }
        }

        /// <summary>Human on-ball defense: guarding the handler (no sprint, feet down, within 70 px) = in a stance.</summary>
        public static void ppStance(Player p, Input i, bool has, bool hum)
        {
            var o = B.owner;
            p.stc = hum && !has && o != null && o.tm != p.tm && !i.sp && p.z <= 0 && p.mode == "i" && !(p.actT > 0) && Hypot(o.x - p.x, o.y - p.y) < 70 ? 1 : 0;
            // a shooter gathering right in front of him: the hand goes up by itself (a contest without leaving his feet)
            if (Util.T(p.stc) && (o.mode == "c" || o.mode == "s") && Hypot(o.x - p.x, o.y - p.y) < 42 && !(p.hupT > 0)) p.hupT = 0.5;
        }

        /// <summary>A pass in flight past a defender's hands can be tipped: it slows and wobbles, but stays a pass to its
        /// target (steals are off: a deflection never changes possession). One check per pass.</summary>
        public static void ppDeflect()
        {
            var L = B.last;
            if (L == null) return;
            foreach (var o in P)
            {
                if (o.tm == L.tm || Util.T(o.off) || o.actT > 0 || o == B.to) continue;
                double d = Hypot(o.x - B.x, o.y - B.y);
                if (d > 14 || B.z < o.z + 18 || B.z > o.z + 78 + o.ht * 2) continue;
                B.dfl = 1;
                if (Rng.R() < clamp(0.18 + (o.d - 60) / 220, 0.08, 0.42))
                {
                    double w = (Rng.R() - 0.5) * 0.5, // turned up to ~14 degrees, 30% slower
                        vx = B.vx,
                        vy = B.vy;
                    B.vx = (vx - vy * w) * 0.7;
                    B.vy = (vy + vx * w) * 0.7;
                    B.vz = Math.Max(B.vz, 0) + 55;
                    o.swpT = 0.3;
                    B.dfl = 2; // (really tipped)
                    statAdd("defl", 1);
                    upc("deflect");
                    if (isH(o) || isH(L)) txtW("DEFLECTED!", o.x, o.y, 95, "#9fe7ff");
                }
                return;
            }
        }

        /// <summary>Feedback on the release (humans): contest timing for the defender, shot selection for the shooter.</summary>
        public static void ppRelease(Player p, double ct, Player o2, double D)
        {
            if (PREDICT != 0 || ftq != null) return;
            if (o2 != null && isH(o2) && ct > 0.3)
            {
                if (o2.z > 8)
                {
                    bool good = o2.vz > -90;
                    txtW(good ? "GREAT CONTEST" : "JUMPED EARLY", o2.x, o2.y, 105, good ? "#7cff9e" : "#ff9966");
                    upc(good ? "goodContest" : "earlyJump");
                }
                else if (o2.hupT > 0) upc("handUp");
            }
            if (!isH(p) || D < 90 || ct < 0.55 || shot < 8 || cfg.NP < 2) return;
            // a forced, contested jumper early in the clock with a teammate wide open in his range
            foreach (var m in P)
            {
                if (m.tm != p.tm || m == p || Util.T(m.off)) continue;
                double md = Hypot(hoop(m.tm) - m.x, HY - m.y);
                if (md > (m.c >= 75 ? 270 : 200)) continue;
                double near = 1e9;
                foreach (var q in P) if (q.tm != p.tm && !Util.T(q.off)) near = Math.Min(near, Hypot(q.x - m.x, q.y - m.y));
                if (near > 75)
                {
                    txtW("FORCED IT · " + m.n.ToUpperInvariant() + " WAS OPEN", p.x, p.y, 125, "#ff9966");
                    statAdd("badShot", 1);
                    return;
                }
            }
        }

        /// <summary>The active UP feature of a player this tick (tests bucket jerk / limits / foot slide by it). Works
        /// with UP off too (same states, base animation) so A/B numbers compare like with like.</summary>
        public static string upTag(Player p)
        {
            if (p.mvT > 0) return p.mvk == 1 ? "hesi" : p.mvk == 2 ? "spin" : p.mvk == 3 ? "btb" : p.mvk == 4 ? "post" : p.mvk == 5 ? "inout" : p.mvk == 6 ? (p.combo > 1 && p.mvP == 6 ? "dblcross" : "cross") : "snatch";
            if (p.mvEnd != null && T - p.mvEnd.Value < 0.3 && p.mode == "i") return "settle";
            if (p.mode == "c") return p.gath != 0 ? (Math.Abs(p.gath) == 3 ? "spinGather" : Math.Abs(p.gath) == 2 ? "hopStep" : "gather") : ftq != null && ftq.s == p ? "ftSet" : "jumpSet";
            if (p.mode == "s")
            {
                if (p.lnA > 0) return "leanAway";
                if (p.sv == 9) return "curry";
                if (p.sv == 24) return "floater";
                if (p.sv == 25 || p.sv == 10) return "hook";
                if (Util.T(p.offH)) return "offHand";
                if (ftq != null || Util.T(B.ft) && B.last == p) return "ft";
                if (IsDunkSv((int)p.sv)) return "dunk";
                if (IsLaySv((int)p.sv)) return "layup";
                return "jumper";
            }
            if (p.landT > 0) return "landing";
            if (p.swpT > 0) return "swipe";
            if (p.hcT > 0) return "handCheck";
            if (p.vcT > 0) return "vcut";
            if (p.hitT > 0 && p.bmpT > 0) return "bump";
            if (B.mode == "pass" && B.to == p && p.z > 10) return "oopCatch";
            if (p.setT > 0) return "screen";
            if (B.owner != null && B.owner.tm != p.tm && p.mode == "i" && Hypot(p.vx, p.vy) > 40) return "defSlide";
            if (B.owner != null && B.owner.tm == p.tm && B.owner != p && Hypot(p.vx, p.vy) > 120) return "cut";
            if (B.owner == p) return "drib";
            return "base";
        }
    }
}

namespace Hoops.Core
{
    public static partial class Sim
    {
        /// <summary>Ball path kinds 5 (in-and-out: most of the way across and back, same hand) and 7 (snatch-back: pulled
        /// back to the hip) never switch hands.</summary>
        static void upSw(double kind, double dur)
        {
            if (kind != 5 && kind != 7) { dhSw(kind, dur); return; }
            B.dswf = B.dsw > 0 ? B.dlat : dhBase();
            B.dsw = dur;
            B.dswd = dur;
            B.dswk = kind;
            B.dcd = 0.75;
        }
        /// <summary>A UP dribble move started this tick (dribHand).</summary>
        public static void upDribMove(Player o)
        {
            if (o.mvk == 5) upSw(5, 0.3);
            else if (o.mvk == 6) upSw(1, 0.18);
            else if (o.mvk == 7) upSw(7, 0.3);
        }
        static readonly double[][] SZK = { new double[] { 3, 1, 5 }, new double[] { 3, 3, 5, 1 }, new double[] { 1, 5, 1 }, new double[] { 1, 1, 5 } },
            SZD = { new double[] { 0.26, 0.2, 0.26 }, new double[] { 0.18, 0.18, 0.24, 0.18 }, new double[] { 0.32, 0.34, 0.32 }, new double[] { 0.15, 0.15, 0.22 } };
        static readonly double[] SZC = { 0.55, 0.3, 0.9, 0.55 };
        /// <summary>Signature size-up chains (UP): formOf dk picks the package, the moves run in order.</summary>
        public static void upSizeUp(Player o)
        {
            int dk = o.sg != null ? (int)clamp(o.sg.dk, 0, 3) : 0;
            var ks = SZK[dk];
            int j = (int)(B.dsz % ks.Length);
            B.dsz = B.dsz + 1;
            upSw(ks[j], SZD[dk][j]);
            B.dcd = SZC[dk];
            upc("sizeUp");
        }
        /// <summary>Lateral / forward offsets of the UP ball paths (u0 0..1, arc = sin(pi u0)).</summary>
        static void upDribPath(double u0, double arc, ref double lat, ref double fwd, double from)
        {
            if (B.dswk == 5) { lat = from + 12 * B.dhn * 0.62 * arc; fwd = 6 + 2 * arc; } // toward the other hand ... and back
            else if (B.dswk == 7) { lat = from - 2 * B.dhn * arc; fwd = 6 - 9 * arc; } // ripped back to the hip
        }
    }
}
