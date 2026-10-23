// Crowd chant director (port of src/client/chantdir.ts, line for line: same rules, order and random draws).
// UnityEngine-free so unity/CoreTests/ChantCheck.cs can replay tests/chants.ts's random game and compare the log.
using System;
using System.Collections.Generic;
using Hoops.Core;

namespace Hoops.Game
{
    /// <summary>What the director needs each frame (Chants.cs fills ONE instance in place).</summary>
    public sealed class CCtx
    {
        public bool live, over, clutch, dead, ftStar, speaking;
        public int home, pos, q, ft, ftTm;
        public double mom;
        public double[] sc = new double[2], run = new double[2];
        public string ftN = "", bench = "";
        public string[] names = { "", "" };
        public Func<string, int> tmOf = n => -1;
    }

    public sealed class CReq
    {
        public string id, word;
        public int side;
        public double gain, delay, t;
    }

    public sealed class ChantDir
    {
        /// <summary>id: [length s, cooldown s, priority] (chantdir.ts CH).</summary>
        public static readonly Dictionary<string, double[]> CH = new Dictionary<string, double[]>
        {
            ["defense"] = new double[] { 5, 14, 6 },
            ["letsgo"] = new double[] { 5, 22, 3 },
            ["mvp"] = new double[] { 4.8, 30, 8 },
            ["airball"] = new double[] { 3.75, 25, 9 },
            ["overtime"] = new double[] { 5, 60, 7 },
            ["wewant"] = new double[] { 5, 90, 2 },
            ["rockyou"] = new double[] { 6, 45, 3 },
            ["charge"] = new double[] { 0.8, 20, 4 },
            ["boo"] = new double[] { 3, 8, 10 },
            ["roar"] = new double[] { 3.5, 2, 10 },
            ["aww"] = new double[] { 1.8, 4, 10 },
            ["shh"] = new double[] { 1.4, 6, 10 },
        };
        public static readonly string[] IDS = { "defense", "letsgo", "mvp", "airball", "overtime", "wewant", "rockyou", "charge", "boo", "roar", "aww", "shh" };
        public static bool IsReact(string id) => id == "boo" || id == "roar" || id == "aww" || id == "shh";
        public const double CHARGE_AT = 1.875;
        static readonly string[] BIGP = { "dunk", "dunkAnd1", "splash", "block", "and1" };

        sealed class Pend { public string id, word; public int side; public double gain, prio, exp; }

        public bool on = true;
        public double now, busy, act, hush, exc = 0.3;
        readonly Dictionary<string, double> cool = new Dictionary<string, double>();
        readonly List<Pend> pend = new List<Pend>();
        public readonly List<CReq> log = new List<CReq>();
        int lastQ, ftId, posN, lastPos = -1, posTried = -1;
        bool deadTried, wasOver;
        double stopT = -99;
        readonly double[] prev = new double[2];
        readonly Func<double> rnd;

        public ChantDir(Func<double> rnd) { this.rnd = rnd; }

        public void Reset()
        {
            now = busy = act = hush = 0;
            exc = 0.3;
            cool.Clear();
            pend.Clear();
            lastQ = ftId = posN = 0;
            lastPos = posTried = -1;
            deadTried = false;
            stopT = -99;
            prev[0] = prev[1] = 0;
            wasOver = false;
        }

        static double Clamp(double v, double a, double b) => v < a ? a : v > b ? b : v;
        double Cool(string id) => cool.TryGetValue(id, out var v) ? v : 0;

        public double Energy(CCtx c)
        {
            int h = c.home, a = 1 - h;
            double m = h == 0 ? c.mom : -c.mom, mg = c.sc[h] - c.sc[a];
            double e = 0.3 + 0.3 * m + 0.03 * Math.Min(c.run[h], 12) - 0.02 * Math.Min(c.run[a], 12) + 0.15 * exc;
            if (Math.Abs(mg) <= 6) e += c.q >= 4 ? 0.2 : 0.08;
            else if (mg < -15) e -= 0.15;
            if (c.clutch) e += 0.2;
            if (c.q > 4) e += 0.1;
            return Clamp(e, 0.05, 1);
        }

        void Add(string id, string word, int side, double gain, double prio, double life)
        {
            foreach (var p in pend)
                if (p.id == id)
                {
                    p.word = word;
                    p.side = side;
                    p.gain = Math.Max(p.gain, gain);
                    p.prio = Math.Max(p.prio, prio);
                    p.exp = Math.Max(p.exp, now + life);
                    return;
                }
            pend.Add(new Pend { id = id, word = word, side = side, gain = gain, prio = prio, exp = now + life });
        }
        void React(string id, double gain, CCtx c) => Add(id, "", c.home, gain, 10, 0.6);

        /// <summary>One sim FX (after GameMain drained it).</summary>
        public void OnFx(Fx f, CCtx c)
        {
            if (!on) return;
            int h = c.home;
            double e = Energy(c);
            switch (f.k)
            {
                case "x":
                    exc = Math.Max(exc, f.v);
                    break;
                case "air":
                    {
                        double t = f.hasTm ? f.tm : f.v;
                        if (t != h) Add("airball", "", h, 0.7 + 0.3 * e, 9, 2.5);
                        else React("aww", 0.6, c);
                        break;
                    }
                case "chant":
                    if ((f.hasTm && f.tm == h) || (!f.hasTm && c.pos != h)) Add("defense", "", h, 0.6 + 0.4 * e, 6, 3);
                    break;
                case "cm":
                    {
                        int t = c.tmOf(f.n ?? "");
                        if (Array.IndexOf(BIGP, f.e) >= 0) { if (t == h) React("roar", 0.6 + 0.4 * e, c); }
                        else if (f.e == "three") { if (t == h) React("roar", 0.45 + 0.3 * e, c); }
                        else if (f.e == "fire") { if (t == h) { React("roar", 0.8, c); Add("mvp", f.n ?? "", h, 0.7 + 0.3 * e, 8, 8); } }
                        else if (f.e == "flagrant" || f.e == "tech" || f.e == "goaltend") { if (t == h) React("boo", 0.7 + 0.3 * e, c); }
                        else if (f.e == "miss") { if (c.tmOf(f.n2 ?? "") == h && t != h) stopT = now; }
                        else if (f.e == "timeout") deadTried = false;
                        break;
                    }
                case "t":
                    if (f.s == "GAME WINNER!" || f.s == "BUZZER BEATER!") React(c.sc[h] > prev[h] ? "roar" : "aww", 1, c);
                    break;
            }
        }

        /// <summary>Music started an organ riff: the crowd answers (CHARGE!) or chants along on the bar (DE-FENSE).</summary>
        public CReq Riff(string name, CCtx c)
        {
            if (!on || !c.live || now < busy || c.speaking) return null;
            int h = c.home;
            double e = Energy(c);
            if (name == "charge" && c.pos == h && Cool("charge") <= now && rnd() < 0.5 + 0.5 * e) return Start(new Pend { id = "charge", word = "", side = h, gain = 0.6 + 0.4 * e, prio = 4 }, CHARGE_AT, e);
            if (name == "defense" && c.pos != h && Cool("defense") <= now && rnd() < 0.3 + 0.6 * e) return Start(new Pend { id = "defense", word = "", side = h, gain = 0.55 + 0.45 * e, prio = 6 }, 0, e);
            return null;
        }

        CReq Start(Pend p, double delay, double e)
        {
            double d = CH[p.id][0];
            cool[p.id] = now + delay + CH[p.id][1];
            if (IsReact(p.id))
            {
                act = Math.Max(act, now + d);
                busy = Math.Max(busy, now + Math.Min(d, 2) + 1);
            }
            else
            {
                act = now + delay + d;
                busy = now + delay + d + 2 + 5 * (1 - e);
            }
            var r = new CReq { id = p.id, word = p.word, side = p.side, gain = Clamp(p.gain, 0, 1.2), delay = delay, t = now };
            log.Add(r);
            if (log.Count > 64) log.RemoveAt(0);
            return r;
        }

        /// <summary>Per frame (after the frame's FX): the chant / reaction to start now (or null).</summary>
        public CReq Tick(double dt, CCtx c)
        {
            now += dt;
            exc = Math.Max(0.2, exc - dt * 0.25);
            if (!on)
            {
                pend.Clear();
                hush = 0;
                return null;
            }
            int h = c.home, a = 1 - h;
            double e = Energy(c);
            if (c.over && !wasOver)
            {
                wasOver = true;
                React(c.sc[h] > c.sc[a] ? "roar" : "aww", 1, c);
            }
            else if (!c.over) wasOver = false;
            if (!c.live && !c.over)
            {
                pend.Clear();
                hush = 0;
                prev[0] = c.sc[0];
                prev[1] = c.sc[1];
                lastQ = c.q;
                return null;
            }
            if (c.live)
            {
                if (c.q > 4 && c.q != lastQ) Add("overtime", "", h, 0.7 + 0.3 * e, 7, 10);
                lastQ = c.q;
                if (c.ft != 0 && c.ft != ftId)
                {
                    ftId = c.ft;
                    if (c.ftTm != h) React("boo", (0.5 + 0.5 * e) * (c.clutch ? 1.2 : 1), c);
                    else if (c.clutch) React("shh", 0.7, c);
                    else if (c.ftStar) Add("mvp", c.ftN, h, 0.6 + 0.4 * e, 7, 4);
                }
                hush = c.ft != 0 && c.ftTm == h && c.clutch ? 1 : 0;
                if (c.pos != lastPos) { lastPos = c.pos; posN++; }
                if (c.pos != h && !c.dead && posTried != posN)
                {
                    posTried = posN;
                    bool want = now - stopT < 8 || (c.q >= 3 && Math.Abs(c.sc[h] - c.sc[a]) <= 8) || e > 0.65;
                    if (want && rnd() < 0.3 + 0.6 * e) Add("defense", "", h, 0.55 + 0.45 * e, 5, 4);
                }
                if (c.dead && c.ft == 0)
                {
                    if (!deadTried)
                    {
                        deadTried = true;
                        if (c.bench != "" && c.q >= 2 && rnd() < 0.2) Add("wewant", c.bench, h, 0.5 + 0.4 * e, 2, 4);
                        else if (c.run[a] >= 8 && rnd() < 0.5) Add("letsgo", c.names[a], a, 0.35, 2, 4);
                        else if (rnd() < 0.25 + 0.6 * e)
                        {
                            if (rnd() < 0.6) Add("letsgo", c.names[h], h, 0.5 + 0.5 * e, 3, 4);
                            else Add("rockyou", "", h, 0.5 + 0.5 * e, 3, 4);
                        }
                    }
                }
                else if (!c.dead) deadTried = false;
            }
            for (int i = pend.Count - 1; i >= 0; i--) if (pend[i].exp < now) pend.RemoveAt(i);
            int best = -1;
            for (int i = 0; i < pend.Count; i++)
            {
                var p = pend[i];
                bool r = IsReact(p.id);
                if (Cool(p.id) > now) continue;
                if (!r && (now < busy || (c.speaking && p.prio < 8))) continue;
                if (best < 0 || p.prio > pend[best].prio) best = i;
            }
            CReq res = null;
            if (best >= 0)
            {
                var p = pend[best];
                pend.RemoveAt(best);
                res = Start(p, 0, e);
            }
            prev[0] = c.sc[0];
            prev[1] = c.sc[1];
            return res;
        }

        /// <summary>Music multiplier: the organ backs off under a chant, lower still for a hush.</summary>
        public double Duck() => hush != 0 ? 0.25 : now < act ? 0.45 : 1;

        /// <summary>mulberry32 (chantsyn.ts rng32): the same sequence as the browser.</summary>
        public static Func<double> Rng32(uint seed)
        {
            uint a = seed;
            return () =>
            {
                unchecked
                {
                    a += 0x6D2B79F5u;
                    uint t = a;
                    t = (t ^ (t >> 15)) * (t | 1u);
                    t ^= t + (t ^ (t >> 7)) * (t | 61u);
                    return (t ^ (t >> 14)) / 4294967296.0;
                }
            };
        }
    }
}
