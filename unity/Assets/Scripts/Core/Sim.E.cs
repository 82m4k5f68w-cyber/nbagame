// Port of src/core/sim.ts lines 2774-3246: SORTP, bstep (the ball state machine: held / dribbled ball, flight,
// legacy rim + board, scoring, net drag, lodged ball, out of bounds, world bounds, cylinder rule + goaltending, loose
// ball / pass catches, tip-outs, rebounds, putbacks, alley-oops), ZIN / ZERO_IN / zin.
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
        public double _ks;  // loose-ball contest key (bstep)
        public double boxT; // boxing out (read by bstep's contest key)
    }

    public static partial class Sim
    {
        public static readonly List<Player> SORTP = new List<Player>();
        static readonly Comparison<Player> SORTP_CMP = (a, b) => Cmp(b._ks - a._ks);
        static readonly double[] DRIB0 = { 0, 8 };
        // tip-out: teammates sorted farthest from the shooter's hoop first (event only)
        static readonly List<Player> MATES = new List<Player>();
        static double MATES_HX;
        static readonly Comparison<Player> MATES_CMP = (a2, b2) => Cmp(Hypot(MATES_HX - b2.x, HY - b2.y) - Hypot(MATES_HX - a2.x, HY - a2.y));

        // TS: (!B.gtc && ((B.gtc = 1), Math.random() < 0.05))
        static bool gtcRoll()
        {
            if (Util.T(B.gtc)) return false;
            B.gtc = 1;
            return Rng.R() < 0.05;
        }

        public static void bstep(double dt)
        {
            var o = B.owner;
            if (o != null)
            {
                {
                    // Dribbling: the ball sits out beside the dribbling hand, a little in front; crossovers, behind-the-backs and
                    // spins carry it to the other hand along their own paths (see dribHand).
                    double hold = heldBall(o);
                    double lat, fwd;
                    if (Util.T(hold)) { var hp = HOLDP[(int)hold]; lat = hp[0]; fwd = hp[1]; }
                    else if (o.mode == "i" && !Util.T(o.postA)) { var dh = dribHand(o, dt); lat = dh.lat; fwd = dh.fwd; }
                    else { lat = DRIB0[0]; fwd = DRIB0[1]; }
                    double off = lat,
                        // (a pump fake carries the ball up AND out in front of the forehead)
                        fw = fwd + (hold == 2 && o.act == 1 ? 7 * Math.Sin(Math.Min(1, 1 - o.actT / 0.42) * Math.PI) : 0),
                        tx = o.x + Math.Cos(o.f) * fw - Math.Sin(o.f) * off,
                        ty = o.y + Math.Sin(o.f) * fw + Math.Cos(o.f) * off;
                    if (cfg.PRO != 0 && o.mode == "i" && B.hold == o && !Util.T(PREDICT))
                    {
                        // Dribble physics: the ball has momentum; the hand pulls it with a stiff, critically damped spring,
                        // so crossovers and hard cuts swing it across the body instead of teleporting.
                        const double k = 900;
                        double c = 2 * Math.Sqrt(k);
                        B.dvx = B.dvx + ((tx - B.x) * k - B.dvx * c) * dt;
                        B.dvy = B.dvy + ((ty - B.y) * k - B.dvy * c) * dt;
                        B.x += B.dvx * dt;
                        B.y += B.dvy * dt;
                        if (Hypot(tx - B.x, ty - B.y) > 14 && T - (B.fr0 ?? -9) > 0.35) { B.x = tx; B.y = ty; } // (the first dribble out of the hands swings over, no snap)
                    }
                    else
                    {
                        B.x = tx;
                        B.y = ty;
                        B.dvx = o.vx;
                        B.dvy = o.vy;
                    }
                    B.hold = o;
                }
                B.z =
                    o.mode == "c"
                        ? cfg.PRO != 0 && o.st == 1
                            ? o.z + 38
                            : o.z + 55
                        : o.mode == "s"
                            ? cfg.PRO != 0 && o.st == 1
                                ? o.z + 38 + Math.Min(1, o.t / 0.3) * 52
                                : o.z + 55 + Math.Min(1, o.t / 0.4) * 28
                            : inb > 0 && o.mode == "i"
                                ? o.z + o.ht * 11.6 // inbounder holds it overhead
                                : Util.T((double)heldBall(o))
                                    ? heldZ(o)
                                    : dz(o, dt);
                if (Util.T((double)heldBall(o))) { B.dho = null; B.dhoNull = true; } // the dribble starts fresh from the hand when he puts it on the floor
                // gather and shot: the ball sits in the shooting hand's palm (the same FK the release uses)
                if ((o.mode == "c" || o.mode == "s") && cfg.hand && cfg.PRO != 0 && o.q != null && o.posed)
                {
                    var h = handPos(o);
                    if (h != null && h[2] > 10) { B.x = clamp(h[0], 6, CW - 6); B.y = clamp(h[1], 6, CH - 6); B.z = h[2]; } // (a finish on the end line can reach past the wall)
                }
                // held in both hands (triple threat, pump fake, jab, FT routine, inbound): the formula spot is where the hands
                // are GOING (B.tg*, the pose's IK target); the ball itself sits between the drawn palms
                if (o.mode == "i" && !Util.T(o.postA) && (Util.T((double)heldBall(o)) || inb > 0) && cfg.hand && cfg.PRO != 0 && o.q != null && o.posed)
                {
                    B.tgx = B.x;
                    B.tgy = B.y;
                    B.tgz = B.z;
                    B.tgo = o;
                    skeleton(o, HSK);
                    double z = ((double)HSK[47] + HSK[59]) / 2;
                    if (z > 8) { B.x = clamp(((double)HSK[45] + HSK[57]) / 2, 6, CW - 6); B.y = clamp(((double)HSK[46] + HSK[58]) / 2, 6, CH - 6); B.z = z; }
                }
                else B.tgo = null;
                B.vx = B.vy = B.vz = 0;
                return;
            }
            B.age += dt;
            // Shots, loose balls AND passes fly through Rapier (passes bounce off the real floor; bodies ignore passes).
            bool RA = useRap() && (B.mode == "air" || B.mode == "pass");
            if (!RA)
            {
                B.vz -= g * dt;
                B.vx *= 1 - 0.1 * dt;
                B.vy *= 1 - 0.1 * dt;
            }
            // a pass that died (rolling slowly on the floor, or stopped against a wall) is a loose ball: anyone can get it.
            if (B.mode == "pass" && !Util.T(PREDICT) && (B.age > 3 || (B.age > 0.5 && B.z < 12 && Hypot(B.vx, B.vy) < 45)))
            {
                B.mode = "air";
                B.to = null;
                B.sh = 0;
            }
            if (B.mode == "pass" && B.to != null && B.age > 0.04)
            {
                var r = B.to;
                double dx = r.x + r.vx * 0.12 - B.x,
                    dy = r.y + r.vy * 0.12 - B.y,
                    ds = Hypot(dx, dy),
                    sp = Hypot(B.vx, B.vy);
                if (!Util.T(ds)) ds = 1;
                B.vx += ((dx / ds) * sp - B.vx) * Math.Min(1, dt * 2.5);
                B.vy += ((dy / ds) * sp - B.vy) * Math.Min(1, dt * 2.5);
            }
            double pz = B.z;
            if (RA) Phys.RAP.Step(dt, B);
            else
            {
                B.x += B.vx * dt;
                B.y += B.vy * dt;
                B.z += B.vz * dt;
            }
            B.a += B.vx * dt * 0.1;
            foreach (var hx in HXs)
            {
                double rx = B.x - hx,
                    ry = B.y - HY,
                    d = Hypot(rx, ry);
                int b = hx > 470 ? 1 : 0;
                if (d > 0 && !RA)
                {
                    double cx = hx + (rx / d) * RR,
                        cy = HY + (ry / d) * RR,
                        vx = B.x - cx,
                        vy = B.y - cy,
                        vz = B.z - 100,
                        dd = Hypot(vx, vy, vz),
                        m = BR + 0.8;
                    if (dd < m && dd > 0)
                    {
                        double nx = vx / dd,
                            ny = vy / dd,
                            nz = vz / dd;
                        B.x = cx + nx * m;
                        B.y = cy + ny * m;
                        B.z = 100 + nz * m;
                        double dot = B.vx * nx + B.vy * ny + B.vz * nz;
                        if (dot < 0)
                        {
                            B.vx -= 1.55 * dot * nx;
                            B.vy -= 1.55 * dot * ny;
                            B.vz -= 1.55 * dot * nz;
                            B.vx *= 0.93;
                            B.vy *= 0.93;
                            snd(300, 0.06, "triangle");
                        }
                    }
                }
                double bx = b != 0 ? 900 : 40;
                if (!RA && (b != 0 ? B.x > bx - BR && B.x < bx + 6 : B.x < bx + BR && B.x > bx - 6) && Math.Abs(B.y - HY) < 30 && B.z > 93 && B.z < 136)
                {
                    B.x = b != 0 ? bx - BR : bx + BR;
                    B.vx = -B.vx * 0.6;
                    snd(200, 0.05, "square");
                }
                if (Util.T(B.sh) && B.z >= 100 && d < RR + 2) B.abv = b; // was above this rim
                if (Util.T(B.sh) && d < 20) B.rim = Math.Min(B.rim ?? 99, Hypot(d - RR, B.z - 100)); // closest approach to the iron
                if (Util.T(B.sh) && !Util.T(B.sc) && B.vz < 0 && ((pz >= 100 && B.z < 100 && d < RR - 1.2) || (B.abv == b && B.z < 97 && B.z > 80 && d < RR - 0.6)))
                {
                    B.sc = 1;
                    double t = cfg.HALF != 0 && B.last != null ? B.last.tm : b != 0 ? 0 : 1,
                        pts = Util.T(B.ft) ? 1 : cfg.HALF != 0 ? (Util.T(B.three) ? 2 : 1) : Util.T(B.three) && B.last.tm == t ? 3 : 2;
                    int ti = (int)t;
                    sc[ti] += pts;
                    exc(1);
                    runAdd(t, pts);
                    if (!Util.T(B.ft) && B.last != null && cfg.HALF == 0)
                    {
                        // broadcast splits: points in the paint, fast-break points, second-chance points
                        if ((B.d0 ?? 999) < 160 && !Util.T(B.three)) TS.xs.paint[ti] += pts;
                        if (Util.T(B.fb)) TS.xs.fb[ti] += pts;
                        if (Util.T(B.sc2)) TS.xs.sec[ti] += pts;
                    }
                    if (!Util.T(B.ft) && B.last != null)
                    {
                        zoneRes(B.last, B.d0, true);
                        var L = B.last;
                        bool ast = B.pp != null && B.pp.p != L && B.pp.p.tm == L.tm && T - B.pp.t < 3.5;
                        cm(Util.T(B.dk) ? (B.flBy != null ? "dunkAnd1" : "dunk") : pts == 3 ? (Util.T(B.gn) && (B.rim ?? 99) > BR + 1.1 ? "splash" : "three") : Util.T(B.fl) ? "and1" : "two", L.n, ast ? B.pp.p.n : null);
                    }
                    {
                        var L = B.last;
                        if (L != null && L.stt != null)
                        {
                            L.stt.pts += pts;
                            if (!Util.T(B.ft))
                            {
                                L.stt.fgm++;
                                if (Util.T(B.three)) L.stt.tpm++;
                            }
                            if (B.pp != null && B.pp.p != L && B.pp.p.tm == L.tm && T - B.pp.t < 3.5 && !Util.T(B.ft)) B.pp.p.stt.ast++;
                        }
                    }
                    if (B.last != null)
                    {
                        B.last.heat = Math.Min(3, B.last.heat + 1);
                        if (B.last.heat == 3) { txtW("ON FIRE!", B.last.x, B.last.y, 105, "#ff9a2e"); cm("fire", B.last.n); }
                    }
                    txtW("+" + pts, hx > 470 ? hx - 50 : hx + 20, HY, 125, pts == 3 ? "#ffd23f" : "#fff");
                    if (!Util.T(B.ft) && !Util.T(B.dk) && (B.rim ?? 99) > BR + 1.1) txtW(pts == 3 ? "SPLASH!" : "SWISH!", hx, HY, 140, "#9fe7ff");
                    if (!Util.T(B.ft) && B.clk != null && B.clk.Value < 1.5 && clock <= 0.05)
                    {
                        bool lead = sc[ti] > sc[1 - ti] && sc[ti] - pts <= sc[1 - ti];
                        txt(B.q >= 4 && lead ? "GAME WINNER!" : "BUZZER BEATER!", 480, 170, "#ffd23f");
                        fx(new Fx { k = "slow", v = 1.6 });
                        fx(new Fx { k = "shake", v = 0.6 });
                        RQ = 1;
                        RPK = 1; // the replay gets the clutch camera sequence
                        HLN = (B.q >= 4 && lead ? "Game winner — " : "Buzzer beater — ") + (B.last != null ? B.last.n : "");
                    }
                    if (!Util.T(B.ft) && B.last != null)
                    {
                        // signature celebration: clutch / on fire > dunk or and-one > three
                        var L = B.last;
                        bool clutch = (B.clk != null && B.clk.Value < 1.5 && clock <= 0.05) || L.heat == 3;
                        if (clutch) celebrate(L, 2);
                        else if (Util.T(B.dk) || Util.T(B.fl)) celebrate(L, 1);
                        else if (pts == 3 && (Util.T(B.gn) || Rng.R() < 0.5)) celebrate(L, 0);
                    }
                    snd(900, 0.25, "sine", 0.1);
                    if (ftq != null)
                    {
                        ftq.next = 1.3;
                        // a made free throw: the shooter and the closest teammate dap it up (pose CEL 9)
                        var sh = ftq.s;
                        if (sh != null && !Util.T(PREDICT))
                        {
                            Player m = null;
                            double md = 1e9;
                            foreach (var o2 in P)
                                if (o2 != sh && o2.tm == sh.tm)
                                {
                                    double d2 = Hypot(o2.x - sh.x, o2.y - sh.y);
                                    if (d2 < md) { md = d2; m = o2; }
                                }
                            sh.cel = 9; sh.celT = CEL_T;
                            if (m != null) { m.cel = 9; m.celT = CEL_T; }
                        }
                    }
                    else if (Util.T(B.fl) && cfg.HALF == 0)
                    {
                        txtW("AND ONE!", B.last.x, B.last.y, 110, "#ffd23f");
                        {
                            Player m = null;
                            double md = 1e9;
                            foreach (var o2 in P)
                                if (o2 != B.last && o2.tm == B.last.tm)
                                {
                                    double dd = Hypot(o2.x - B.last.x, o2.y - B.last.y);
                                    if (dd < md) { md = dd; m = o2; }
                                }
                            if (m != null && !Util.T(PREDICT)) { m.cel = 13; m.celT = CEL_T; }
                        }
                        statAdd("andOnes", 1);
                        if (B.flBy != null)
                        {
                            tf[(int)B.flBy.tm]++;
                            B.flBy.pf++;
                        }
                        exc(1);
                        startFT(B.last, 1);
                    }
                    else
                    {
                        rs = 1.4;
                        pend = cfg.HALF != 0 ? t : 1 - t; // street: make it, take it
                        if (Util.T(cfg.TO) && sc[ti] >= cfg.TO)
                        {
                            rs = 0;
                            endGame();
                        }
                        if (cfg.replays && (Util.T(B.dk) || (Util.T(B.gn) && Util.T(B.three) && isH(B.last))))
                        {
                            RQ = 1;
                            HLN = (Util.T(B.dk) ? (Util.T(B.oop) ? "Alley-oop — " : "Slam — ") : "From deep — ") + (B.last != null ? B.last.n : "");
                        }
                    }
                    B.sh = 0;
                    fin = 0;
                }
                if (Util.T(B.sc) && B.z > 60 && B.z < 100 && d < RR + 3)
                {
                    // the net grabs the ball: horizontal motion dies, the drop slows, then it falls out the bottom
                    B.vx *= 0.86;
                    B.vy *= 0.86;
                    if (B.z > 82) B.vz *= 0.975;
                }
            }
            if (!RA && B.z < BR)
            {
                B.z = BR;
                if (Math.Abs(B.vz) > 60) snd(110, 0.05, "sine", 0.1);
                B.vz *= -0.72;
                B.vx *= 0.9;
                B.vy *= 0.9;
                if (Math.Abs(B.vz) < 25) B.vz = 0;
            }
            // A ball balanced on the iron or wedged between the back iron and the glass: after a beat it rolls off,
            // away from the middle of the rim - but never toward the backboard (that just wedged it again)
            if (B.owner == null && !Util.T(B.sc) && B.z > 94 && B.z < 112 && !inNet() && Hypot(B.vx, B.vy, B.vz) < 30)
            {
                B.stk = B.stk + dt;
                if (B.stk > 1.2 && !Util.T(PREDICT))
                {
                    B.stk = 0;
                    double hx = Math.Abs(B.x - HXs[0]) < Math.Abs(B.x - HXs[1]) ? HXs[0] : HXs[1],
                        court = hx > 470 ? -1 : 1, // toward mid-court
                        dy = B.y - HY,
                        side = Math.Abs(dy) > 1 ? Sign(dy) : Rng.R() < 0.5 ? -1 : 1;
                    double dx = B.x - hx;
                    if (dx * court < -(RR + 1) && gameLike() && S == "play")
                    {
                        // wedged between the back iron and the glass: the ref blows it dead (a held ball; the defense gets it)
                        var L = B.last;
                        double tm = L != null ? L.tm : pos;
                        if (L != null && Util.T(B.sh)) zoneRes(L, B.d0, false);
                        fx(new Fx { k = "whistle", tm = tm, hasTm = true });
                        ban("LODGED BALL", "HELD BALL · " + cl[(int)(1 - tm)].ToUpperInvariant() + " BALL", "#ffd23f");
                        statAdd("lodged", 1);
                        setup(1 - tm);
                        return;
                    }
                    // (practice / contests: no possession to give - lift a wedged ball out in front of the rim)
                    if (dx * court < -(RR + 1)) { B.x = hx + court * (RR + 6); B.z = Math.Max(B.z, 106); dx = court * 4; }
                    if (dx * court < 0) dx = court * (2 + Rng.R() * 4); // behind the rim: roll it out front
                    double dl = Hypot(dx, dy);
                    if (!Util.T(dl)) dl = 1;
                    B.vx = (dx / dl) * 55;
                    B.vy = (dy / dl) * 55 + side * 12;
                    B.vz = 40;
                    B.x += court * 2; // off the glass
                }
            }
            else B.stk = 0;
            // Out of bounds: a loose ball that reaches the lines is out - the other team than the last one to touch it gets it
            if (cfg.VIOL != 0 && !Util.T(PREDICT) && B.owner == null && (B.mode == "air" || B.mode == "pass") && (B.x < 6 || B.x > CW - 6 || B.y < 6 || B.y > CH - 6) && !(B.mode == "pass" && B.age < 0.3) && B.last != null && ftq == null && JB == null && rs <= 0 && inb <= 0 && S == "play" && gameLike() && !Util.T(B.sc))
            {
                statAdd("oob", 1);
                var L = B.last;
                if (L.stt != null) L.stt.tov = L.stt.tov + 1;
                violation(L.tm, "OUT OF BOUNDS", L);
                return;
            }
            // World bounds for both engines (a fast Rapier ball could tunnel past or fly over the thin arena walls).
            {
                if (B.x < 6 || B.x > CW - 6)
                {
                    B.x = clamp(B.x, 6, CW - 6);
                    B.vx *= -0.5;
                }
                if (B.y < 6 || B.y > CH - 6)
                {
                    if (B.owner == null && Hypot(B.vx, B.vy) > 160 && !Util.T(PREDICT) && T - B.duckT > 1) { B.duckT = T; fx(new Fx { k = "duck", x = B.x, y = B.y }); } // into the courtside seats
                    B.y = clamp(B.y, 6, CH - 6);
                    B.vy *= -0.5;
                }
            }
            if (Util.T(B.sc)) return;
            if (ftq != null) return;
            // Cylinder rule: nobody may touch a live shot in the imaginary cylinder above either rim
            if (Util.T(B.sh) && B.mode == "air" && B.z > 55 && (Hypot(B.x - HXs[0], B.y - HY) < 22 || Hypot(B.x - HXs[1], B.y - HY) < 22))
            {
                // goaltending: a defender who swats it on the way down above the rim gives up the basket
                if (cfg.VIOL != 0 && !Util.T(PREDICT) && B.last != null && !Util.T(B.ft) && B.vz < 0 && B.z > 101 && !Util.T(B.gt))
                {
                    double hx = hoop(B.last.tm);
                    foreach (var p in P)
                        if (p.tm != B.last.tm && p.z > 10 && Hypot(p.x - B.x, p.y - B.y) < 13 && B.z < p.z + 68 + p.j * 0.2 && Hypot(B.x - hx, B.y - HY) < 22 && (isH(p) || gtcRoll()))
                        {
                            B.gt = 1;
                            double t = B.last.tm,
                                pts = Util.T(B.three) ? 3 : 2;
                            sc[(int)t] += pts;
                            B.last.stt.pts += pts;
                            B.last.stt.fgm++;
                            if (Util.T(B.three)) B.last.stt.tpm++;
                            runAdd(t, pts);
                            ban("GOALTENDING", p.n.ToUpperInvariant() + " · BASKET COUNTS", "#ff6b4a");
                            fx(new Fx { k = "whistle", tm = p.tm, hasTm = true });
                            cm("goaltend", p.n);
                            B.sh = 0;
                            B.sc = 1;
                            B.vx *= -0.3;
                            B.vy *= -0.3;
                            rs = 1.4;
                            pend = 1 - t;
                            return;
                        }
                }
                return;
            }
            // Contest for the loose ball: jumpers and defenders first, with some randomness.
            SORTP.Clear();
            foreach (var p in P)
            {
                SORTP.Add(p);
                // (+ the defense has inside position on a missed shot, more so when it boxed out: NBA ORB% ~24)
                p._ks = p.j + p.d * 0.3 + (p.z > 5 ? 25 : 0) + Rng.R() * 40 + (hasB(p, "GC") ? 18 : 0) + (Util.T(B.sh) && B.last != null && p.tm != B.last.tm ? 9 + (p.boxT > 0 ? 8 : 0) : 0);
            }
            SortStable(SORTP, SORTP_CMP);
            foreach (var p in SORTP)
            {
                if ((p == B.last && B.age < 0.3) || p.mode == "s") continue;
                double d = Hypot(p.x - B.x, p.y - B.y);
                bool rc = B.mode == "pass" && p == B.to;
                // a pass is caught in the HANDS: once the receiver's body is close, it sticks when it reaches either palm
                if (rc && d < 26 && d > 12 && Util.T(p.skelOk) && p.skel != null && !Util.T(PREDICT))
                {
                    var k = p.skel;
                    double hd = Math.Min(Hypot(k[45] - B.x, k[46] - B.y, k[47] - B.z), Hypot(k[57] - B.x, k[58] - B.y, k[59] - B.z));
                    if (hd > 9 && B.age < 2.5 && d > 17) d = 99; // not in his hands yet: let it come (the pass homes in on him)
                }
                if (d < (rc ? 26 : 12) && B.z > p.z + (rc ? -8 : 2) && B.z < p.z + 68 + p.j * 0.2 + (rc && B.ptype == 2 ? 55 : 0))
                {
                    if (B.mode == "pass" && p != B.to) continue;
                    if (B.mode == "air" && B.age < 0.5 && (B.vz > 0 || p.tm == B.last.tm)) continue;
                    // a contested catch can be fumbled (accidental turnover - steals stay off)
                    if (B.mode == "pass" && p == B.to && !Util.T(PREDICT) && ftq == null && inb <= 0 && B.age > 0.15)
                    {
                        double near = 1e9;
                        foreach (var q2 in P) if (q2.tm != p.tm) near = Math.Min(near, Hypot(q2.x - p.x, q2.y - p.y));
                        if (near < 16 && Rng.R() < 0.05 * (1.3 - p.s / 120))
                        {
                            B.mode = "air";
                            B.to = null;
                            B.vx = -B.vx * 0.3 + (Rng.R() - 0.5) * 90;
                            B.vy = -B.vy * 0.3 + (Rng.R() - 0.5) * 90;
                            B.vz = 70;
                            B.last = p;
                            B.age = 0;
                            p.act = 5;
                            p.actT = 0.5;
                            txtW("FUMBLED!", p.x, p.y, 95, "#ff6b4a");
                            break;
                        }
                    }
                    bool wasShot = Util.T(B.sh) && B.last != null && !Util.T(B.sc);
                    var shooter = B.last;
                    if (wasShot && p.z > 8 && !Util.T(PREDICT) && ftq == null && cfg.NP > 1 && Hypot(hoop(shooter.tm) - p.x, HY - p.y) > 20)
                    {
                        Player rival = null;
                        foreach (var q2 in P) if (q2.tm != p.tm && q2.z > 6 && Hypot(q2.x - p.x, q2.y - p.y) < 18) { rival = q2; break; }
                        if (rival != null && Rng.R() < 0.4)
                        {
                            MATES_HX = hoop(shooter.tm);
                            MATES.Clear();
                            foreach (var mm in P) if (mm.tm == p.tm && mm != p && !C_on(mm.off)) MATES.Add(mm);
                            SortStable(MATES, MATES_CMP);
                            var m = MATES.Count > 0 ? MATES[0] : null;
                            if (m != null)
                            {
                                const double fl = 0.6;
                                B.mode = "pass";
                                B.to = m;
                                B.ptype = 0;
                                B.sh = 0;
                                B.last = p;
                                B.age = 0;
                                B.vx = (m.x - B.x) / fl;
                                B.vy = (m.y - B.y) / fl;
                                B.vz = (55 - B.z + 0.5 * g * fl * fl) / fl;
                                p.stt.reb++;
                                if (p.tm == shooter.tm) p.stt.orb++;
                                txtW(p.tm == shooter.tm ? "TAPPED BACK OUT" : "TIPPED OUT", p.x, p.y, 110, "#9fe7ff");
                                cm("tipout", p.n, m.n);
                                break;
                            }
                        }
                    }
                    bool oop = B.mode == "pass" && B.ptype == 2 && p == B.to && p.j >= 45 && Hypot(hoop(p.tm) - p.x, HY - p.y) < 110 && ftq == null && inb <= 0;
                    if (Util.T(B.sh) && B.last != null && !Util.T(B.sc))
                    {
                        p.stt.reb++;
                        if (p.tm == B.last.tm) { p.stt.orb++; TS.orbP[(int)p.tm] = 1; }
                        if (!Util.T(B.ft)) zoneRes(B.last, B.d0, false);
                        if (!Util.T(B.ft)) cm(p.tm == B.last.tm ? "missO" : "miss", B.last.n, p.n);
                        if (!Util.T(B.ft) && !Util.T(PREDICT)) B.last.frT = 1.8; // the shooter's face drops (TS: && B.last.tm != null, always true)
                        if (!Util.T(B.ft) && (B.rim ?? 99) < BR + 2.5) fx(new Fx { k = "ooh" }); // in and out: the whole building groans
                        if (hasB(p, "GC") && Rng.R() < 0.3) cm("board", p.n);
                    }
                    if (Util.T(B.sh) && B.last != null && !Util.T(B.sc)) B.last.heat = Math.Max(-2, B.last.heat - 1);
                    // a rebound in traffic is chinned: both hands, ball under the chin, elbows out, until he lands and looks up
                    if (Util.T(B.sh) && !Util.T(B.ft) && !Util.T(PREDICT) && p.mode == "i") p.chinT = p.z > 6 ? 0.45 + p.z / 200 : 0.35;
                    if (B.mode == "pass" && Util.T(B.kick) && p == B.to && !Util.T(PREDICT)) { p.kickT = 2.5; statAdd("kick", 1); }
                    if (B.ctl != null && !Util.T(PREDICT)) { if (p.tm == B.ctl.Value) statAdd("ctlKeep", 1); B.ctl = null; }
                    B.owner = p;
                    B.mode = "held";
                    B.sh = 0;
                    B.to = null;
                    if (p.tm != pos)
                    {
                        pos = p.tm;
                        shot = 24;
                        PCNT[0] = PCNT[1] = 0;
                        if (cfg.HALF == 0 && !Util.T(PREDICT)) TS.trT[(int)p.tm] = T; // a live-ball change of possession: a transition chance
                        TS.orbP[0] = TS.orbP[1] = 0;
                        // street: a change of possession has to be taken back and checked at the top
                        if (cfg.HALF != 0 && !Util.T(PREDICT) && rs <= 0)
                        {
                            rs = 0.5;
                            pend = p.tm;
                            txtW("TAKE IT BACK", p.x, p.y, 100, "#9fe7ff");
                        }
                    }
                    snd(180, 0.05, "square");
                    if (wasShot && shooter != null && shooter != p && shooter.cw != null && shooter.cw.Value < 0.35 && Rng.R() < 0.6 && !Util.T(PREDICT)) { shooter.cel = 11; shooter.celT = CEL_T; } // missed an open look
                    if (B.mode == "held" && p.mode == "i" && p.z <= 0 && !oop) p.ttT = 1.3; // squares up in the triple threat
                    // offensive rebound in the air at the rim: tip it in or throw down the putback
                    if (wasShot && shooter != null && shooter.tm == p.tm && p.z > 8 && !oop && ftq == null && Hypot(hoop(p.tm) - p.x, HY - p.y) < 45)
                    {
                        p.mode = "s";
                        p.t = 0.27;
                        p.sv = p.j >= 65 ? 11 : 16;
                        p.rl = 0;
                        p.hk = 1;
                        txtW(p.sv == 11 ? "PUTBACK SLAM!" : "TIP-IN", p.x, p.y, 115, "#ffd23f");
                    }
                    if (cfg.UP != 0 && !oop && p.mode == "i") upPutback(p, wasShot, shooter);
                    if (oop)
                    {
                        // ALLEY-OOP: catch it in the air and throw it down
                        p.mode = "s";
                        p.t = 0.27;
                        p.sv = Rng.R() < 0.5 ? 6 : 11;
                        p.rl = 0;
                        p.vz = Math.Max(p.vz, 175);
                        p.oop = 1;
                        txtW("ALLEY-OOP!", p.x, p.y, 120, "#ffd23f");
                        exc(1);
                    }
                    break;
                }
            }
        }

        public static Input ZIN() => new Input { dx = 0, dy = 0 };
        public static readonly List<Input> ZERO_IN = new List<Input>();
        public static Input zin(int k)
        {
            while (ZERO_IN.Count <= k) ZERO_IN.Add(null);
            return NOIN(ZERO_IN[k] ?? (ZERO_IN[k] = ZIN()));
        }
    }
}
