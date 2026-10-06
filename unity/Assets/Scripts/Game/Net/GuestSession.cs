// Guest (port of src/net/guest.ts): renders everyone else ~100 ms in the past from interpolated snapshots, predicts its
// own player with its own inputs (reconciled against the host's acked state), measures ping, and sends input state.
// Pure C# (no UnityEngine): used by the Unity client and the loopback test (unity/CoreTests/NetLoop.cs).
using System;
using System.Collections.Generic;
using Hoops.Core;
using static Hoops.Core.Sim;

namespace Hoops.Game.Net
{
    public sealed class GuestMe
    {
        public string n = "Player", tok = "", code = "";
        public double elo = 1000;
    }

    public sealed class GuestStats
    {
        public int full, delta, corr, recon, resync;
        public long bytes;
    }

    public sealed class GuestSession
    {
        const double STEP = 1 / 60.0;
        public Peer host;
        public Lobby L;
        public int gid = -1;
        public readonly List<double[]> snaps = new List<double[]>(); // reconstructed snapshots, ascending tick
        public double ack = -1; // newest input tick the host has applied
        public int myIdx = -1, mySlot = -1;
        public int n; // input tick counter
        readonly List<(int n, Hoops.Core.Input i)> inbuf = new List<(int, Hoops.Core.Input)>();
        readonly Stack<Hoops.Core.Input> inPool = new Stack<Hoops.Core.Input>();
        double acc;
        public double? off; // host tick - local tick estimate (max-filtered)
        public double jit = 2;
        public double D = 6; // interpolation delay in ticks (~100 ms)
        public double rtt;
        double lastPg;
        double lastFx;
        public int stall;
        public int nf;
        double lastSnapAt;
        public double hostGoneAt;
        public int side = -2; // -2 undecided (the host waits), -1 watching, 0/1 playing
        public int rdy;
        public double tempo;
        public readonly GuestStats stats = new GuestStats();
        public Action<Lobby> onLobby;
        public Action onStart;
        public Action<Fx> onFx;
        public Action<string, int> onChat;
        double qn; // my quick-chat sequence
        double lastQ = -1; // newest relayed chat I've shown
        double rm = -1; // game id I asked a rematch of
        readonly Action unsub;
        public readonly ITransport t;
        public readonly GuestMe me;
        readonly Func<double> now;
        public readonly WireInput wire = new WireInput();
        readonly PSave mine = new PSave();
        readonly Hoops.Core.Input frozenIn = new Hoops.Core.Input();
        // ---- NetOpts additions ----
        readonly double[] lateRing = new double[240]; // arrival lateness of recent snapshots (ticks behind the best arrival)
        int lateN;
        readonly double[] tickRing = new double[120]; // ticks of recently received snapshots (loss estimate)
        int tickN;
        int frames, lateFrames; // rendered frames, frames that ran past the newest snapshot
        readonly List<double[]> redund = new List<double[]>(); // last 3 packed input ticks ("Ir")
        /// <summary>Visual offset of my predicted player (px): a correction is shown over ~120 ms instead of a jump.</summary>
        public double rox, roy;
        bool roOn;
        double roAx, roAy;
        public int snaps40; // corrections above 40 px (visible snaps)
        public double maxCorr; // largest reconciliation error seen (px)

        /// <summary>Snapshots that arrived too late to be interpolated, % of rendered frames (recent).</summary>
        public double LatePct => frames > 0 ? 100.0 * lateFrames / frames : 0;
        /// <summary>Arrival jitter in ms.</summary>
        public double JitterMs => jit * 1000 / 60;
        /// <summary>Snapshot loss in % over the last ~120 snapshots (gaps beyond the host's send interval).</summary>
        public double LossPct
        {
            get
            {
                int n = Math.Min(tickN, tickRing.Length);
                if (n < 10) return 0;
                double first = double.MaxValue, last = double.MinValue, gap = double.MaxValue, prev = double.NaN;
                for (int i = tickN - n; i < tickN; i++)
                {
                    double v = tickRing[i % tickRing.Length];
                    first = Math.Min(first, v);
                    last = Math.Max(last, v);
                    if (!double.IsNaN(prev) && v > prev) gap = Math.Min(gap, v - prev);
                    prev = v;
                }
                if (gap == double.MaxValue || last <= first) return 0;
                double expect = (last - first) / gap + 1;
                return Math.Max(0, 100 * (1 - n / expect));
            }
        }

        public GuestSession(ITransport t, GuestMe me, Func<double> now = null)
        {
            this.t = t;
            this.me = me;
            this.now = now ?? NetClock.Mono;
            unsub = t.OnPeers(Peers);
            Pub();
        }

        public void Pub(Dictionary<string, object> extra = null)
        {
            var o = new Dictionary<string, object>
            {
                { "v", (double)NetConst.PROTO }, { "n", me.n }, { "tok", me.tok }, { "code", me.code }, { "tm", (double)side }, { "rdy", (double)rdy },
                { "tmp", tempo }, { "gid", (double)gid }, { "zk", snaps.Count > 0 ? snaps[snaps.Count - 1][0] : -1.0 }, { "nf", (double)nf },
                { "t", Util.Round(now()) }, { "rt", Util.Round(rtt) }, { "D", Util.Round(D) }, { "elo", me.elo }, { "rm", rm },
            };
            if (extra != null) foreach (var kv in extra) o[kv.Key] = kv.Value;
            t.Presence(o);
        }

        public void SetSide(int tm)
        {
            side = tm;
            Pub();
        }
        public void Chat(int k)
        {
            qn = Math.Max(qn + 1, NetClock.Wall() % 1e9); // monotonic across reconnects
            Pub(new Dictionary<string, object> { { "q", new List<object> { Math.Floor(qn), (double)k } } });
        }
        public void WantRematch()
        {
            rm = gid;
            Pub();
        }
        public void SetReady(int r)
        {
            rdy = r;
            Pub();
        }

        void Peers(List<Peer> ps)
        {
            Peer h = null;
            foreach (var p in ps)
                if (!p.me && p.state != null && p.state.Num("v", -1) == NetConst.PROTO && Json.Truthy(p.state.Get("H")) && p.state.Str("code") == me.code) { h = p; break; }
            if (h == null)
            {
                if (host != null && hostGoneAt == 0) hostGoneAt = now();
                return;
            }
            hostGoneAt = 0;
            bool fresh = !ReferenceEquals(h.state, host?.state);
            host = h;
            if (!fresh) return;
            var s = h.state;
            if (s.Obj("L") is Dictionary<string, object> lo)
            {
                string prevSt = L?.st;
                L = Lobby.From(lo);
                mySlot = -1;
                for (int i = 0; i < L.slots.Count; i++)
                {
                    var x = L.slots[i];
                    if (x.id == t.Me || (!string.IsNullOrEmpty(x.tok) && x.tok == me.tok && x.id != "host")) { mySlot = i; break; }
                }
                if ((L.st == "game" || L.st == "over") && L.gid != gid) BeginGame(L);
                else if (L.st == "lobby" && prevSt != "lobby") setS("menu");
                onLobby?.Invoke(L);
            }
            if (s.Arr("Q") is List<object> Qa)
                foreach (var qo in Qa)
                {
                    if (!(qo is List<object> qq) || qq.Count < 3) continue;
                    double seq = Json.D(qq[0]);
                    if (lastQ < 0) lastQ = seq - 1; // joined late: only new messages
                    if (seq > lastQ)
                    {
                        lastQ = seq;
                        onChat?.Invoke(qq[1] as string, (int)Json.D(qq[2]));
                    }
                }
            if (s.Obj("Pg") is Dictionary<string, object> Pg && Pg.Get(t.Me) is double pg && pg != 0 && pg != lastPg)
            {
                lastPg = pg;
                double r = now() - lastPg;
                if (r >= 0 && r < 5000) rtt = rtt != 0 ? rtt * 0.8 + r * 0.2 : r;
            }
            if (gid < 0 || s.Num("gid", double.NaN) != gid || !(s.Obj("Z") is Dictionary<string, object> Z)) return;
            if (s.Obj("A") is Dictionary<string, object> A && A.Get(t.Me) is double ak) ack = ak;
            if (s.Arr("U") is List<object> U) // (substitutions: before the snapshot that has the new man in the slot)
            {
                var u = new double[U.Count][];
                for (int i = 0; i < u.Length; i++) u[i] = Json.Nums(U[i]);
                applyLineup(u);
            }
            if (s.Arr("C") is List<object> C) ApplyCtrls(C);
            Recv(Z);
            if (s.Arr("X") is List<object> X) Protocol.ApplyBox(X);
            if (s.Arr("E") is List<object> E)
                foreach (var eo in E)
                {
                    if (!(eo is List<object> e) || e.Count < 2) continue;
                    double id = Json.D(e[0]);
                    if (id <= lastFx) continue;
                    lastFx = id;
                    var f = Protocol.DecodeFx(e);
                    if (f != null) onFx?.Invoke(f);
                }
        }

        /// <summary>Rebuild the local roster exactly like the host did, then follow snapshots.</summary>
        public void BeginGame(Lobby l)
        {
            gid = l.gid;
            cfg.ONLINE = 1;
            cfg.GM = "game";
            cfg.NP = l.np;
            cfg.PRO = l.pro;
            cfg.MYM = 0;
            setQtrLen(l.ql);
            var cs = new List<Ctrl>();
            foreach (var s in l.slots) if (s.on != 0 && s.tm >= 0) cs.Add(mkCtrl(s.id == "host" ? "p1" : s.id, s.tm));
            setCtrls(cs);
            start(l.teams[0], new StartOpts { j = l.teams[1] });
            FX.Clear();
            snaps.Clear();
            foreach (var e in inbuf) inPool.Push(e.i);
            inbuf.Clear();
            off = null;
            ack = -1;
            lastFx = 0;
            nf = 0;
            myIdx = -1;
            onStart?.Invoke();
        }

        void Recv(Dictionary<string, object> Z)
        {
            double last = snaps.Count > 0 ? snaps[snaps.Count - 1][0] : -1;
            double zk = Z.Num("k", -1);
            if (zk <= last) return;
            double[] a;
            var f = Json.Nums(Z.Get("f"));
            if (f != null)
            {
                a = f;
                stats.full++;
            }
            else
            {
                double b = Z.Num("b", -1);
                double[] bas = null;
                foreach (var s in snaps) if (s[0] == b) { bas = s; break; }
                var d = Json.Nums(Z.Get("d"));
                if (bas == null || d == null)
                {
                    nf = 1; // lost our baseline: ask for a full snapshot
                    return;
                }
                a = Protocol.DeltaDec(d, bas, zk);
                stats.delta++;
            }
            if (a.Length < Protocol.HDR) return;
            nf = 0;
            if (lastSnapAt != 0 && now() - lastSnapAt > 1000)
            {
                // back from a stall: resync the clock and start the interpolation buffer fresh (no slow-motion catch-up)
                off = null;
                snaps.Clear();
                stats.resync++;
                needN = 0; // (the stall says nothing about the link from here on)
                if (NetOpts.AdaptiveDelay) D = 6;
            }
            stats.bytes += (f != null ? 8 + 4 * f.Length : 8 + 4 * Json.Nums(Z.Get("d")).Length); // (approximate JSON size)
            snaps.Add(a);
            while (snaps.Count > 90) snaps.RemoveAt(0);
            // Clock: host tick ~= local tick + off (max filter = least-delayed arrival), jitter tracks spread.
            double lt = now() / 1000 * 60, sample = a[0] - lt;
            if (off == null) off = sample;
            double late = Math.Max(0, off.Value - sample);
            jit = jit * 0.95 + late * 0.05;
            if (sample > off) off = sample;
            lateRing[lateN++ % lateRing.Length] = late;
            tickRing[tickN++ % tickRing.Length] = a[0];
            if (!NetOpts.AdaptiveDelay) D = Math.Max(4, Math.Min(15, 3 + jit * 2));
            else if (lateN < 60) D = Math.Max(4, Math.Min(15, 3 + jit * 2)); // (until there is enough history)
            lastSnapAt = now();
            Reconcile(a);
        }

        /// <summary>Smallest interpolation delay (ticks) that keeps late frames under ~2%. Every rendered frame records
        /// the delay it would have needed (live host clock minus the newest snapshot in hand: arrival jitter AND gaps
        /// from dropped snapshots); D = the 98th percentile of the last ~5 s + a small margin, eased (fast up, slow down).</summary>
        double AdaptiveD()
        {
            int n = Math.Min(needN, needRing.Length);
            if (n < 60) return D;
            var tmp = sortBuf ??= new double[needRing.Length];
            Array.Copy(needRing, tmp, n);
            Array.Sort(tmp, 0, n);
            double p98 = tmp[Math.Min(n - 1, (int)Math.Ceiling(n * 0.98) - 1)];
            double target = Math.Max(1.5, Math.Min(15, p98 + 1));
            return target > D ? D + (target - D) * 0.5 : D + (target - D) * 0.1;
        }
        readonly double[] needRing = new double[300];
        int needN;
        double[] sortBuf;

        /// <summary>Host's live controller map [[id, team, playerIdx]...]: which player I predict.</summary>
        void ApplyCtrls(List<object> C)
        {
            bool same = CT.Count == C.Count;
            if (same)
                for (int i = 0; i < C.Count; i++)
                    if (!(C[i] is List<object> c) || c.Count < 3 || !(c[0] is string id) || CT[i].id != id) { same = false; break; }
            if (!same)
            {
                var cs = new List<Ctrl>();
                foreach (var co in C) if (co is List<object> c && c.Count >= 3) cs.Add(mkCtrl(c[0] as string ?? "", (int)Json.D(c[1])));
                setCtrls(cs);
            }
            for (int i = 0; i < CT.Count && i < C.Count; i++) if (C[i] is List<object> c && c.Count >= 3) CT[i].idx = (int)Json.D(c[2]);
            myIdx = -1;
            foreach (var c in CT) if (c.id == t.Me) { myIdx = c.idx; break; }
        }

        /// <summary>Reset my player to the host's acked state, then replay my unacknowledged inputs.</summary>
        void Reconcile(double[] a)
        {
            int k = myIdx;
            if (k < 0 || k >= P.Count || Protocol.HDR + (k + 1) * Protocol.PST > a.Length) return;
            Unrender();
            var p = P[k];
            double ox = p.x, oy = p.y;
            Protocol.ApplyPlayer(p, a, k);
            int ownerIdx = (int)a[20];
            B.owner = ownerIdx >= 0 && ownerIdx < P.Count ? P[ownerIdx] : null;
            while (inbuf.Count > 0 && inbuf[0].n <= ack) { inPool.Push(inbuf[0].i); inbuf.RemoveAt(0); }
            setPredict(1);
            foreach (var e in inbuf)
            {
                p.@in = Frozen(p) ? Zero() : e.i.Clone();
                step(p, STEP);
            }
            setPredict(0);
            double ex = ox - p.x, ey = oy - p.y, err = Math.Sqrt(ex * ex + ey * ey);
            stats.recon++;
            if (err > 0.5) stats.corr++;
            maxCorr = Math.Max(maxCorr, err);
            if (NetOpts.SmoothCorrection)
            {
                // the sim state takes the corrected position at once (the next prediction starts from the truth); what is
                // DRAWN keeps the old position as an offset that decays over ~120 ms - never a visible snap under 40 px
                rox += ex;
                roy += ey;
                if (Math.Sqrt(rox * rox + roy * roy) > 40) { rox = roy = 0; snaps40++; }
            }
            else if (err < 40)
            {
                // smooth small corrections instead of snapping
                p.x += ex * 0.6;
                p.y += ey * 0.6;
            }
            else snaps40++;
        }

        /// <summary>Remove the render offset from my player (the sim works on true positions).</summary>
        void Unrender()
        {
            if (!roOn) return;
            roOn = false;
            if (myIdx >= 0 && myIdx < P.Count) { P[myIdx].x -= roAx; P[myIdx].y -= roAy; }
        }
        /// <summary>Add the decayed render offset to my player for drawing (until the next Frame / snapshot).</summary>
        void Render(double dt)
        {
            if (!NetOpts.SmoothCorrection || myIdx < 0 || myIdx >= P.Count) return;
            double k = Math.Exp(-dt / 0.04); // tau 40 ms: 95% gone after ~120 ms
            rox *= k;
            roy *= k;
            if (Math.Abs(rox) < 0.05 && Math.Abs(roy) < 0.05) { rox = roy = 0; return; }
            roAx = rox;
            roAy = roy;
            P[myIdx].x += roAx;
            P[myIdx].y += roAy;
            roOn = true;
        }

        Hoops.Core.Input Zero()
        {
            frozenIn.Clear();
            return frozenIn.Clone();
        }

        /// <summary>Per rendered frame: sample input at 60 Hz, predict, interpolate the rest, publish input.</summary>
        public void Frame(double dt, Func<Hoops.Core.Input> sample)
        {
            if (gid < 0 || P.Count == 0) return;
            Unrender();
            // 1) local input ticks + prediction
            acc += dt;
            int nn = 0;
            while (acc >= STEP && nn < 6)
            {
                acc -= STEP;
                nn++;
                InputTick(sample());
            }
            // 2) interpolation of everyone else
            double lt = now() / 1000 * 60;
            if (off != null && snaps.Count > 0)
            {
                off -= dt * 0.25; // slow decay so the max filter can follow clock drift
                double rt = lt + off.Value - D;
                if (NetOpts.AdaptiveDelay && L != null && L.st == "game" && hostGoneAt == 0)
                {
                    needRing[needN++ % needRing.Length] = lt + off.Value - snaps[snaps.Count - 1][0];
                    if (needN % 15 == 0 && lateN >= 60) D = AdaptiveD();
                }
                int i = snaps.Count - 1;
                while (i > 0 && snaps[i - 1][0] > rt) i--;
                double[] s1 = snaps[i], s0 = i > 0 ? snaps[i - 1] : s1;
                double u = ReferenceEquals(s1, s0) ? 0 : (rt - s0[0]) / (s1[0] - s0[0]);
                u = Math.Max(0, Math.Min(1, u));
                var latest = snaps[snaps.Count - 1];
                stall = rt > latest[0] + 15 ? 1 : 0;
                frames++;
                if (rt > latest[0]) lateFrames++;
                if (frames >= 600) { frames /= 2; lateFrames /= 2; } // (recent: halve now and then)
                int skip = myIdx >= 0 && myIdx < P.Count && RPL == null ? myIdx : -1;
                if (skip >= 0) mine.Save(P[skip]);
                Protocol.ApplySnap(s0, ReferenceEquals(s1, s0) || s1.Length != s0.Length ? null : s1, u, skip);
                if (skip >= 0) mine.Load(P[skip]);
                if (Util.T(latest[17])) Protocol.ApplySnap(latest, null, 0); // replays: show exactly what the host shows
                else if (rt > latest[0])
                {
                    // starved: dead-reckon everyone (not me) forward from the newest snapshot, at most 100 ms
                    double ex = Math.Min(6, rt - latest[0]) / 60;
                    for (int k = 0; k < P.Count; k++)
                        if (k != myIdx)
                        {
                            P[k].x += P[k].vx * ex;
                            P[k].y += P[k].vy * ex;
                        }
                    if (B.owner == null)
                    {
                        B.x += B.vx * ex;
                        B.y += B.vy * ex;
                        B.z = Math.Max(4, B.z + B.vz * ex);
                    }
                }
                // The ball sticks to my predicted hands when the host says I have it.
                if (myIdx >= 0 && myIdx < P.Count && latest[20] == myIdx && RPL == null) B.owner = P[myIdx];
            }
            if (B.owner != null) bstep(dt); // held-ball placement (dribble bounce) follows the rendered owner
            netSim(dt);
            if (RPL == null) foreach (var p in P) Pose.pose3(p);
            var ex2 = new Dictionary<string, object> { { "I", Protocol.PackInput(wire) } };
            if (NetOpts.InputRedundancy && redund.Count > 0) ex2["Ir"] = new List<object>(redund);
            ex2["nq"] = new List<object> { Math.Round(LossPct, 1), Math.Round(JitterMs), Math.Round(LatePct, 1) };
            Pub(ex2);
            Render(dt);
        }

        void InputTick(Hoops.Core.Input i)
        {
            int k = myIdx;
            var p = k >= 0 && k < P.Count ? P[k] : null;
            n++;
            var w = wire;
            w.n = n;
            w.dx = i.dx;
            w.dy = i.dy;
            w.sp = i.sp ? 1 : 0;
            w.post = i.post ? 1 : 0;
            if (i.sd)
            {
                Bump("sd");
                if (p != null && p.mode == "s") w.tp = Util.Round(p.t * 1000); // tempo tap on my own timeline
            }
            if (i.su)
            {
                Bump("su");
                if (p != null && p.mode == "c") w.mt = Util.Round((p.t + STEP) * 1000); // meter time on my own timeline
            }
            if (i.e) Bump("e");
            if (i.sb) Bump("sb");
            if (Util.T(i.mv)) Bump("mv" + (int)i.mv);
            if (i.lob) Bump("lob");
            if (i.sw) Bump("sw");
            if (i.pf) Bump("pf");
            if (i.to) Bump("to");
            if (i.ch) Bump("ch");
            if (i.ds) Bump("ds");
            if (Skip) { Bump("skip"); Skip = false; }
            if (NetOpts.InputRedundancy)
            {
                redund.Add(Protocol.PackInput(w));
                if (redund.Count > 3) redund.RemoveAt(0);
            }
            if (p != null && RPL == null && S == "play")
            {
                var c = inPool.Count > 0 ? inPool.Pop() : new Hoops.Core.Input();
                Copy(i, c);
                inbuf.Add((n, c));
                if (inbuf.Count > 120) { inPool.Push(inbuf[0].i); inbuf.RemoveAt(0); }
                setPredict(1);
                p.@in = Frozen(p) ? Zero() : i.Clone();
                step(p, STEP);
                setPredict(0);
            }
        }
        /// <summary>Set to ask the host to skip the running replay (sent as the "skip" edge on the next input tick).</summary>
        public bool Skip;

        void Bump(string e)
        {
            int j = Protocol.Edge(e);
            if (j >= 0) wire.c[j] += 1;
        }

        static void Copy(Hoops.Core.Input s, Hoops.Core.Input d)
        {
            d.dx = s.dx; d.dy = s.dy; d.sd = s.sd; d.su = s.su; d.e = s.e; d.sb = s.sb; d.post = s.post; d.lob = s.lob; d.sp = s.sp;
            d.sw = s.sw; d.pf = s.pf; d.to = s.to; d.ch = s.ch; d.ds = s.ds; d.mv = s.mv; d.pass = s.pass; d.mt = s.mt; d.tp = s.tp;
        }

        /// <summary>Same dead-ball rules as the host: no control during inbounds, others' free throws and after scores.</summary>
        bool Frozen(Player p) => inb > 0 || rs > 0 || JB != null || (ftq != null && ftq.s != p);

        public void Close()
        {
            Unrender();
            unsub();
        }

        // ---------------- host migration lite ----------------
        /// <summary>The newest snapshot (the state a new host continues from).</summary>
        public double[] Latest => snaps.Count > 0 ? snaps[snaps.Count - 1] : null;
        /// <summary>Should I take over? The host has been gone MigrateAfter s mid-game and I am the longest-seated guest
        /// still in the room (first slot in the host's join order).</summary>
        public bool ShouldMigrate()
        {
            if (!NetOpts.Migration || hostGoneAt == 0 || L == null || L.st != "game" || Latest == null) return false;
            if (now() - hostGoneAt < NetOpts.MigrateAfter * 1000) return false;
            var here = new HashSet<string>();
            foreach (var p in t.Peers()) here.Add(p.id);
            foreach (var s in L.slots)
            {
                if (s.id == "host" || !here.Contains(s.id)) continue;
                return s.id == t.Me;
            }
            return false;
        }
        /// <summary>The host this guest follows (a new one after a migration).</summary>
        public string HostId => host?.id;

        /// <summary>The predicted player's fields kept out of the snapshot interpolation (guest.ts PFIELDS).</summary>
        sealed class PSave
        {
            double x, y, z, vx, vy, vz, f, t, ph, sv, mvT, mvE, mvk, mvS, brk, postA, pT, sbw, en, hk, slow, cd, bn, bx, by, rl, mt, setT, manT, scr, bmp;
            double? cw, tp, fsv;
            double[] li;
            string mode;
            public void Save(Player p)
            {
                x = p.x; y = p.y; z = p.z; vx = p.vx; vy = p.vy; vz = p.vz; f = p.f; mode = p.mode; t = p.t; ph = p.ph; sv = p.sv; mvT = p.mvT; mvE = p.mvE;
                mvk = p.mvk; mvS = p.mvS; brk = p.brk; postA = p.postA; pT = p.pT; sbw = p.sbw; en = p.en; hk = p.hk; slow = p.slow; cw = p.cw; cd = p.cd;
                li = p.li; bn = p.bn; bx = p.bx; by = p.by; rl = p.rl; mt = p.mt; tp = p.tp; setT = p.setT; manT = p.manT; scr = p.scr; bmp = p.bmp; fsv = p.fsv;
            }
            public void Load(Player p)
            {
                p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz; p.f = f; p.mode = mode; p.t = t; p.ph = ph; p.sv = sv; p.mvT = mvT; p.mvE = mvE;
                p.mvk = mvk; p.mvS = mvS; p.brk = brk; p.postA = postA; p.pT = pT; p.sbw = sbw; p.en = en; p.hk = hk; p.slow = slow; p.cw = cw; p.cd = cd;
                p.li = li; p.bn = bn; p.bx = bx; p.by = by; p.rl = rl; p.mt = mt; p.tp = tp; p.setT = setT; p.manT = manT; p.scr = scr; p.bmp = bmp; p.fsv = fsv;
            }
        }
    }
}
