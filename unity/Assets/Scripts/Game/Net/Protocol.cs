// Wire format (port of src/net/protocol.ts, PROTO 10): quantized integer snapshots of the authoritative sim,
// delta-compressed against a baseline the receivers already hold; absolute input state with edge counters; event ring
// for texts/sounds. Identical layout to the browser build, so Unity and browser peers can share a room.
// Snapshots are double[] holding integers (proFlags needs 40 bits; JSON numbers are doubles on both ends).
// Pure C# (no UnityEngine).
using System;
using System.Collections.Generic;
using Hoops.Core;
using static Hoops.Core.Sim;

namespace Hoops.Game.Net
{
    public sealed class WireInput
    {
        public double n; // guest input tick
        public double dx, dy, sp, post;
        public double[] c = new double[Protocol.EDGES.Length]; // counters per EDGES
        public double mt; // meter time of the last release (ms, shooter's own clock)
        public double tp = -1; // tempo tap time (ms), -1 none
    }

    public static class Protocol
    {
        static readonly string[] MODE = { "i", "c", "s", "b" }, BMODE = { "held", "air", "pass" }, SMODE = { "menu", "play", "over" };
        static double r(double v) => Util.Round(v);
        static double wrapA(double a) => Math.Atan2(Math.Sin(a), Math.Cos(a));
        const double TAU100 = 628.3185;

        public const int HDR = 43; // header ints
        public const int PST = 28; // per-player ints (without pose)
        public static readonly int QN = Pose.QK.Length;

        static int Idx(Player p) => p == null ? -1 : P.IndexOf(p);
        static int IndexOf(string[] a, string s) { for (int i = 0; i < a.Length; i++) if (a[i] == s) return i; return -1; }

        /// <summary>Full snapshot of the sim. During replays the joint angles of every player are appended.</summary>
        public static double[] EncodeSnap(int k)
        {
            var f = ftq;
            bool rp = RPL != null;
            int n = HDR + P.Count * PST + (rp ? P.Count * QN : 0);
            var a = new double[n];
            a[0] = k;
            a[1] = IndexOf(SMODE, S);
            a[2] = q;
            a[3] = r(clock * 10);
            a[4] = r(shot * 10);
            a[5] = sc[0];
            a[6] = sc[1];
            a[7] = pos;
            a[8] = r(Math.Max(0, inb) * 100);
            a[9] = r(Math.Max(0, rs) * 100);
            a[10] = f != null ? Idx(f.s) : -1;
            a[11] = f != null ? f.i : 0;
            a[12] = f != null ? f.n : 0;
            a[13] = f != null ? (Util.T(f.tech) ? 1 : 0) : 0;
            a[14] = tf[0];
            a[15] = tf[1];
            a[16] = r(T * 100);
            a[17] = rp ? 1 : 0;
            a[18] = Idx(OFFS[0]);
            a[19] = Idx(OFFS[1]);
            a[20] = Idx(B.owner);
            a[21] = Math.Max(0, IndexOf(BMODE, B.mode));
            a[22] = r(B.x * 10);
            a[23] = r(B.y * 10);
            a[24] = r(B.z * 10);
            a[25] = r(B.vx);
            a[26] = r(B.vy);
            a[27] = r(B.vz);
            a[28] = r((((B.a * 100) % TAU100) + TAU100) % TAU100);
            a[29] = Idx(B.to);
            a[30] = Util.T(B.sh) ? 1 : 0;
            a[31] = Util.T(B.sc) ? 1 : 0;
            a[32] = Util.I(B.ptype);
            a[33] = r(B.dh * 10);
            // jump ball clock (-1 none), timeouts left, momentum, defense settings / play calls, clutch time
            a[34] = JB != null ? r(JB.t * 100) : -1;
            a[35] = TS.to[0];
            a[36] = TS.to[1];
            a[37] = r(TS.mom * 100);
            a[38] = TS.ds[0] + TS.ds[1] * 8 + TS.pc[0] * 64 + TS.pc[1] * 512;
            a[39] = TS.clutch;
            // broadcast splits: points in the paint, fast-break and second-chance points (team 0 + 1024 x team 1)
            a[40] = TS.xs.paint[0] + TS.xs.paint[1] * 1024;
            a[41] = TS.xs.fb[0] + TS.xs.fb[1] * 1024;
            a[42] = TS.xs.sec[0] + TS.xs.sec[1] * 1024;
            int o = HDR;
            foreach (var p in P)
            {
                a[o++] = r(p.x * 10);
                a[o++] = r(p.y * 10);
                a[o++] = r(p.z * 10);
                a[o++] = r(p.vx);
                a[o++] = r(p.vy);
                a[o++] = r(p.vz);
                a[o++] = r(wrapA(p.f) * 100);
                a[o++] = Math.Max(0, IndexOf(MODE, p.mode));
                a[o++] = r(Math.Min(p.t, 9) * 100);
                a[o++] = r((((p.ph * 100) % TAU100) + TAU100) % TAU100);
                a[o++] = Util.I(p.sv);
                a[o++] = r(Math.Max(-1, p.mvT) * 100);
                a[o++] = r(Math.Min(9, p.mvE) * 100);
                a[o++] = Util.I(p.mvk);
                a[o++] = Util.I(p.mvS);
                a[o++] = r(p.brk * 100);
                a[o++] = Util.T(p.postA) ? 1 : 0;
                a[o++] = r(Math.Max(-1, p.pT) * 100);
                a[o++] = r(Math.Max(-1, p.sbw) * 100);
                a[o++] = r(p.en * 100);
                a[o++] = Util.T(p.hk) ? 1 : 0;
                a[o++] = r(Math.Max(-1, p.slow) * 100);
                a[o++] = p.cw == null ? -1 : r(p.cw.Value * 100);
                a[o++] = Util.I(p.heat);
                a[o++] = p.celT > 0 && Util.T(p.cel) ? p.cel * 1000 + r(Math.Min(9.99, p.celT) * 100) : 0;
                // contact: strength (hitT, 0.01 s) and direction (degrees) - guests replay the same reaction
                a[o++] = p.hitT > 0 ? r(p.hitT * 100) * 1000 + ((r(Math.Atan2(p.hitY, p.hitX) * 180 / Math.PI) + 360) % 360) : 0;
                // one-shot actions (pump fake, jab, fall, dive, fumble, blocked) + triple threat + FT routine clock
                a[o++] = (p.actT > 0 && Util.T(p.act) ? p.act * 1000 + r(Math.Min(9.99, p.actT) * 100) : 0) + (p.ttT > 0 ? 100000 : 0) + r(Math.Min(9, p.ftT) * 10) * 1000000;
                a[o++] = ProFlags(p);
            }
            // replay poses: joints x players at 0.01 rad
            if (rp)
                foreach (var p in P)
                    for (int j = 0; j < QN; j++)
                    {
                        double v = p.q != null ? p.q[j] : 0;
                        a[o++] = r((double.IsNaN(v) ? 0 : v) * 100);
                    }
            return a;
        }

        // reused guest-side objects (applySnap runs every rendered frame: no allocations)
        static readonly ReplayState rplNet = new ReplayState();
        static readonly JumpBall jbNet = new JumpBall { c = new Player[0], jt = new double[] { -1, -1 }, ai = new double[] { 0, 0 } };
        static FtQueue ftqNet;

        static double[] sa, sb;
        static double su, span, h00, h10, h01, h11;
        static double L(int i) => sb != null ? sa[i] + (sb[i] - sa[i]) * su : sa[i];
        // Cubic Hermite position from two samples and their velocities (px/s): curves through cuts instead of zig-zagging.
        static double H(int i, int vi, double s)
        {
            if (sb == null) return sa[i] / s;
            double p0 = sa[i] / s, p1 = sb[i] / s;
            if (Math.Abs(p1 - p0) > 60) return su < 0.5 ? p0 : p1; // teleports (inbounds, FTs) snap
            return h00 * p0 + h10 * span * sa[vi] + h01 * p1 + h11 * span * sb[vi];
        }
        // interpolate angles the short way round
        static double LA(int i, double s)
        {
            if (sb == null) return sa[i] / s;
            double d = (sb[i] - sa[i]) / s;
            d = Math.Atan2(Math.Sin(d), Math.Cos(d));
            return sa[i] / s + d * su;
        }
        static Player At(double j) => j >= 0 && j < P.Count ? P[(int)j] : null;

        /// <summary>Apply a decoded snapshot (or an interpolation of a and b at u) onto the local sim objects.
        /// skip = a player index left alone (the guest's predicted player), -1 none.</summary>
        public static void ApplySnap(double[] a, double[] b, double u, int skip = -1)
        {
            sa = a; sb = b; su = u;
            span = b != null ? Math.Max(1, b[0] - a[0]) / 60 : 0;
            double u2 = u * u, u3 = u2 * u;
            h00 = 2 * u3 - 3 * u2 + 1; h10 = u3 - 2 * u2 + u; h01 = -2 * u3 + 3 * u2; h11 = u3 - u2;
            int fi = (int)a[10];
            int sm = (int)a[1];
            S = sm >= 0 && sm < SMODE.Length ? SMODE[sm] : "play";
            q = a[2];
            clock = L(3) / 10;
            shot = L(4) / 10;
            sc[0] = a[5];
            sc[1] = a[6];
            pos = a[7];
            inb = a[8] / 100;
            rs = a[9] / 100;
            if (fi >= 0 && fi < P.Count)
            {
                var f = ftqNet ??= new FtQueue();
                f.s = P[fi]; f.i = a[11]; f.n = a[12]; f.tech = a[13]; f.next = 0; f.w = 0; f.fired = 0;
                ftq = f;
            }
            else ftq = null;
            tf[0] = a[14];
            tf[1] = a[15];
            T = L(16) / 100;
            if (Util.T(a[17])) { rplNet.i = 0; RPL = rplNet; } else RPL = null;
            if (a[34] >= 0) { jbNet.t = a[34] / 100; JB = jbNet; } else JB = null;
            TS.to[0] = a[35];
            TS.to[1] = a[36];
            TS.mom = L(37) / 100;
            int dsv = (int)a[38];
            TS.ds[0] = dsv & 7;
            TS.ds[1] = (dsv >> 3) & 7;
            TS.pc[0] = (dsv >> 6) & 7;
            TS.pc[1] = (dsv >> 9) & 7;
            TS.clutch = a[39];
            Split(TS.xs.paint, a[40]);
            Split(TS.xs.fb, a[41]);
            Split(TS.xs.sec, a[42]);
            OFFS[0] = At(a[18]);
            OFFS[1] = At(a[19]);
            B.owner = At(a[20]);
            int bm = (int)a[21];
            B.mode = bm >= 0 && bm < BMODE.Length ? BMODE[bm] : null;
            B.x = H(22, 25, 10);
            B.y = H(23, 26, 10);
            B.z = H(24, 27, 10);
            B.vx = a[25];
            B.vy = a[26];
            B.vz = a[27];
            B.a = LA(28, 100);
            B.to = At(a[29]);
            B.sh = a[30];
            B.sc = a[31];
            B.ptype = a[32];
            for (int k = 0; k < P.Count; k++)
            {
                if (k == skip) continue;
                var p = P[k];
                int o = HDR + k * PST;
                if (o + PST > a.Length) break;
                p.x = H(o, o + 3, 10);
                p.y = H(o + 1, o + 4, 10);
                p.z = H(o + 2, o + 5, 10);
                p.vx = L(o + 3);
                p.vy = L(o + 4);
                p.vz = L(o + 5);
                p.f = LA(o + 6, 100);
                ApplyDiscrete(p, a, o);
                p.t = L(o + 8) / 100;
                p.ph = LA(o + 9, 100);
                p.mvE = L(o + 12) / 100;
                p.brk = L(o + 15) / 100;
                p.en = L(o + 19) / 100;
            }
            if (Util.T(a[17]) && a.Length >= HDR + P.Count * (PST + QN) && (b == null || b.Length == a.Length))
            {
                int qo = HDR + P.Count * PST;
                for (int k = 0; k < P.Count; k++)
                {
                    var p = P[k];
                    p.q ??= new Q();
                    for (int j = 0; j < QN; j++) p.q[j] = L(qo + k * QN + j) / 100;
                }
            }
            sa = sb = null;
        }

        static void Split(double[] d, double v)
        {
            d[0] = v % 1024;
            d[1] = Math.Floor(v / 1024);
        }

        static double q6(double v, double s) => Math.Max(0, Math.Min(63, r(v * s)));
        /// <summary>Pro Play pose flags + the miss face, packed in one int (base-64 digits): hand-up contest, plant step,
        /// rim body english (+ its lean), pass style, double clutch, frustration, released, chinned, hedge, help, huddle
        /// hands-in (40 bits: still exact in a double). So guests see the same body language.</summary>
        static double ProFlags(Player p)
        {
            return q6(p.hupT, 100) +
                64 * (q6(p.plantT, 100) + 64 * (q6(p.engT, 100) + 64 * (Math.Max(0, Math.Min(31, r(p.eng * 15) + 16)) + 32 * ((Util.I(p.pk) & 3) + 4 * (Math.Min(31, q6(p.dcl, 100)) + 32 * (Math.Min(31, q6(p.frT, 10)) + 32 * ((Util.T(p.rl) ? 1 : 0) + 2 * ((p.chinT > 0 ? 1 : 0) + 2 * ((p.hdgT > 0 ? 1 : 0) + 2 * ((p.helpT > 0 ? 1 : 0) + 2 * (p.hudT > 0 ? 1 : 0)))))))))));
        }
        static double pv;
        static double Dg(double n)
        {
            double x = pv % n;
            pv = Math.Floor(pv / n);
            return x;
        }
        static void ProApply(Player p, double v)
        {
            pv = v;
            p.hupT = Dg(64) / 100;
            p.plantT = Dg(64) / 100;
            p.engT = Dg(64) / 100;
            p.eng = (Dg(32) - 16) / 15;
            p.pk = Dg(4);
            p.dcl = Dg(32) / 100;
            p.frT = Dg(32) / 10;
            p.rl = Dg(2);
            p.chinT = Util.T(Dg(2)) ? 0.2 : 0; // (chinned rebound: heldBall 4 on the guest too)
            p.hdgT = Util.T(Dg(2)) ? 0.2 : 0; // (hedge / trap: arms wide)
            p.helpT = Util.T(Dg(2)) ? 0.2 : 0; // (help defender: brace / verticality)
            p.hudT = Util.T(Dg(2)) ? 0.2 : 0; // (timeout huddle: hands in - the circle's centre is fixed per team)
            if (Util.T(p.hudT)) { p.hcx = 470 + (Util.T(p.tm) ? 1 : -1) * 130; p.hcy = 34; }
        }

        /// <summary>Discrete per-player fields (never interpolated).</summary>
        public static void ApplyDiscrete(Player p, double[] a, int o)
        {
            int md = (int)a[o + 7];
            p.mode = md >= 0 && md < MODE.Length ? MODE[md] : "i";
            p.sv = a[o + 10];
            p.mvT = a[o + 11] / 100;
            p.mvk = a[o + 13];
            p.mvS = a[o + 14];
            p.postA = a[o + 16];
            p.pT = a[o + 17] / 100;
            p.sbw = a[o + 18] / 100;
            p.hk = a[o + 20];
            p.slow = a[o + 21] / 100;
            p.cw = a[o + 22] < 0 ? (double?)null : a[o + 22] / 100;
            p.heat = a[o + 23];
            int ce = Util.I(a[o + 24]);
            p.cel = ce / 1000;
            p.celT = (ce % 1000) / 100.0;
            int hv = Util.I(a[o + 25]);
            if (hv != 0)
            {
                double an = (hv % 1000) * Math.PI / 180;
                p.hitT = (hv / 1000) / 100.0;
                p.hitX = Math.Cos(an);
                p.hitY = Math.Sin(an);
            }
            else p.hitT = 0;
            int av = Util.I(a[o + 26]), lo = av % 100000;
            p.act = lo / 1000;
            p.actT = (lo % 1000) / 100.0;
            p.ttT = av % 1000000 >= 100000 ? 0.5 : 0;
            p.ftT = Math.Floor(av / 1000000.0) / 10;
            if (o + 27 < a.Length) ProApply(p, a[o + 27]);
        }

        /// <summary>Restore one player's full predicted-relevant state from a snapshot (used for reconciliation).</summary>
        public static void ApplyPlayer(Player p, double[] a, int k)
        {
            int o = HDR + k * PST;
            p.x = a[o] / 10;
            p.y = a[o + 1] / 10;
            p.z = a[o + 2] / 10;
            p.vx = a[o + 3];
            p.vy = a[o + 4];
            p.vz = a[o + 5];
            p.f = a[o + 6] / 100;
            ApplyDiscrete(p, a, o);
            p.t = a[o + 8] / 100;
            p.ph = a[o + 9] / 100;
            p.mvE = a[o + 12] / 100;
            p.brk = a[o + 15] / 100;
            p.en = a[o + 19] / 100;
        }

        // ---- delta compression: [gap, diff] pairs against a baseline array of the same layout ----
        public static List<double> DeltaEnc(double[] cur, double[] bas)
        {
            if (cur.Length != bas.Length) return null;
            var o = new List<double>();
            int last = 0;
            for (int i = 1; i < cur.Length; i++)
                if (cur[i] != bas[i])
                {
                    o.Add(i - last);
                    o.Add(cur[i] - bas[i]);
                    last = i;
                }
            return o;
        }
        public static double[] DeltaDec(double[] d, double[] bas, double k)
        {
            var a = (double[])bas.Clone();
            a[0] = k;
            int i = 0;
            for (int j = 0; j + 1 < d.Length; j += 2)
            {
                i += (int)d[j];
                if (i < 0 || i >= a.Length) break; // (garbled delta: ignore the rest)
                a[i] = bas[i] + d[j + 1];
            }
            return a;
        }

        // ---- inputs: absolute stick + held buttons + monotonically increasing edge counters ----
        public static readonly string[] EDGES = { "sd", "su", "e", "sb", "mv1", "mv2", "mv3", "lob", "sw", "skip", "pf", "to", "ch", "ds" };
        public static int Edge(string e) { for (int i = 0; i < EDGES.Length; i++) if (EDGES[i] == e) return i; return -1; }

        public static double[] PackInput(WireInput w)
        {
            var a = new double[6 + EDGES.Length];
            a[0] = w.n;
            a[1] = r(w.dx * 100);
            a[2] = r(w.dy * 100);
            a[3] = (Util.T(w.sp) ? 1 : 0) | (Util.T(w.post) ? 2 : 0);
            for (int i = 0; i < EDGES.Length; i++) a[4 + i] = w.c[i];
            a[4 + EDGES.Length] = r(w.mt);
            a[5 + EDGES.Length] = r(w.tp);
            return a;
        }
        public static WireInput UnpackInput(double[] a, WireInput into = null)
        {
            var w = into ?? new WireInput();
            double At(int i) => i < a.Length ? a[i] : 0;
            w.n = At(0);
            w.dx = At(1) / 100;
            w.dy = At(2) / 100;
            int f = (int)At(3);
            w.sp = f & 1;
            w.post = (f >> 1) & 1;
            for (int i = 0; i < EDGES.Length; i++) w.c[i] = At(4 + i);
            w.mt = At(4 + EDGES.Length);
            w.tp = 5 + EDGES.Length < a.Length ? a[5 + EDGES.Length] : -1;
            return w;
        }

        // ---- box score + events ----
        /// <summary>Box score for everyone who played (subs online): [team, roster id, pts, reb, ast, fgm, fga, tpm, tpa, blk].</summary>
        public static List<object> EncodeBox()
        {
            var o = new List<object>();
            for (int t = 0; t < 2; t++)
                foreach (var p in ROST[t])
                    o.Add(new double[] { t, p.rid, p.stt.pts, p.stt.reb, p.stt.ast, p.stt.fgm, p.stt.fga, p.stt.tpm, p.stt.tpa, p.stt.blk });
            return o;
        }
        public static void ApplyBox(List<object> x)
        {
            if (x == null) return;
            foreach (var e in x)
            {
                var s = Json.Nums(e);
                if (s == null || s.Length < 10) continue;
                int t = (int)s[0];
                if (t < 0 || t > 1) continue;
                double rid = s[1];
                Player p = null;
                foreach (var c in P) if (c.tm == t && c.rid == rid) { p = c; break; }
                if (p == null) foreach (var c in BENCH[t]) if (c.tm == t && c.rid == rid) { p = c; break; }
                if (p == null) continue;
                p.stt.pts = s[2]; p.stt.reb = s[3]; p.stt.ast = s[4]; p.stt.fgm = s[5]; p.stt.fga = s[6]; p.stt.tpm = s[7]; p.stt.tpa = s[8]; p.stt.blk = s[9];
                if (!ROST[t].Contains(p)) ROST[t].Add(p);
            }
        }

        static object Ov(Fx f, string k) => f.o != null && f.o.TryGetValue(k, out var v) ? v : null;
        static double OvD(Fx f, string k, double d)
        {
            var v = Ov(f, k);
            return v is double x ? x : v is int i ? i : v is bool b ? (b ? 1 : 0) : d;
        }

        /// <summary>Recent FX for guests: texts (world/screen), sounds, crowd excitement, game end. Compact tuples, oldest first.</summary>
        public static List<object> EncodeFx(IReadOnlyList<Fx> fxl, int max)
        {
            var o = new List<object>();
            for (int i = fxl.Count - 1; i >= 0 && o.Count < max; i--)
            {
                var f = fxl[i];
                double id = f.id;
                switch (f.k)
                {
                    case "t":
                        if (f.x != null) o.Add(new List<object> { id, "t", f.s, r(f.x.Value), r(f.y ?? 0), r(f.z ?? 0), f.c });
                        else o.Add(new List<object> { id, "T", f.s, r(f.sx ?? 0), r(f.sy ?? 0), f.c });
                        break;
                    case "s": o.Add(new List<object> { id, "s", f.f, f.d, f.ty, f.v }); break;
                    case "x": o.Add(new List<object> { id, "x", f.v }); break;
                    case "end": o.Add(new List<object> { id, "e", f.w }); break;
                    case "shake": case "slow": case "chant": case "ooh": o.Add(new List<object> { id, "g", f.k, double.IsNaN(f.v) ? 0 : f.v }); break;
                    case "whistle": o.Add(new List<object> { id, "g", "whistle", f.tm }); break;
                    case "duck": o.Add(new List<object> { id, "g", "duck", r(f.x ?? 0) * 1000 + r(f.y ?? 0) }); break;
                    case "ban": o.Add(new List<object> { id, "b", f.s, f.sub ?? "", f.c }); break;
                    case "cm": o.Add(new List<object> { id, "c", f.e, f.n ?? "", f.n2 ?? "" }); break;
                    case "tg": o.Add(new List<object> { id, "q", f.n, OvD(f, "off", 0), OvD(f, "win", 0), Ov(f, "g"), OvD(f, "gr", 0) != 0 ? 1 : 0, OvD(f, "c", -1) }); break;
                }
            }
            o.Reverse();
            return o;
        }

        public static Fx DecodeFx(List<object> e)
        {
            if (e == null || e.Count < 2) return null;
            object E(int i) => i < e.Count ? e[i] : null;
            double N(int i) => E(i) is double d ? d : 0;
            string Sx(int i) => E(i) as string;
            int id = (int)N(0);
            switch (Sx(1))
            {
                case "t": return new Fx { id = id, k = "t", s = Sx(2), x = N(3), y = N(4), z = N(5), c = Sx(6) };
                case "T": return new Fx { id = id, k = "t", s = Sx(2), sx = N(3), sy = N(4), c = Sx(5) };
                case "s": return new Fx { id = id, k = "s", f = N(2), d = N(3), ty = Sx(4), v = N(5) };
                case "x": return new Fx { id = id, k = "x", v = N(2) };
                case "e": return new Fx { id = id, k = "end", w = N(2) };
                case "g":
                    if (Sx(2) == "whistle") return new Fx { id = id, k = "whistle", tm = N(3), hasTm = true };
                    if (Sx(2) == "duck") return new Fx { id = id, k = "duck", x = Math.Floor(N(3) / 1000), y = N(3) % 1000 };
                    return new Fx { id = id, k = Sx(2), v = N(3) };
                case "b": return new Fx { id = id, k = "ban", s = Sx(2), sub = Sx(3), c = Sx(4) };
                case "c": return new Fx { id = id, k = "cm", e = Sx(2), n = Sx(3), n2 = Sx(4) };
                case "q":
                    {
                        var o = new Dictionary<string, object> { { "off", N(3) }, { "win", N(4) }, { "g", Sx(5) }, { "gr", N(6) != 0 } };
                        if (E(7) is double c && c >= 0) o["c"] = c;
                        return new Fx { id = id, k = "tg", n = Sx(2), o = o };
                    }
            }
            return null;
        }
    }
}
