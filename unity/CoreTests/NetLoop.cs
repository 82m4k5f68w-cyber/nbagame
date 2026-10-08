// Online loopback test (pure C#, no Unity): an in-memory port of server/relay.ts (rooms, 30 Hz sender coalescing,
// injected lag / jitter / dropped updates) + a dedicated HostSession running the Core sim + a GuestSession running
// its own copy of the Core sim. The sim is static, so the guest lives in a second AssemblyLoadContext (same dll,
// separate statics); the two sides only exchange relay frames as JSON strings, i.e. the real wire format.
// Simulated clock: fast and deterministic. Also checks RoomTransport (pacing, retries, rejoin) against a flaky fake room.
//   scripts/unity/cs.sh unity/CoreTests/NetLoop.cs [lag=80] [jitter=40] [drop=0.1] [seconds=12]
//@include unity/Assets/Scripts/Game/Net/Json.cs
//@include unity/Assets/Scripts/Game/Net/Transport.cs
//@include unity/Assets/Scripts/Game/Net/Protocol.cs
//@include unity/Assets/Scripts/Game/Net/HostSession.cs
//@include unity/Assets/Scripts/Game/Net/GuestSession.cs
//@include unity/Assets/Scripts/Game/Net/WsTransport.cs
//@include unity/Assets/Scripts/Game/Net/RoomTransport.cs
//@include unity/Assets/Scripts/Game/Net/RtcTransport.cs
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Reflection;
using System.Runtime.Loader;
using Hoops.Core;
using Hoops.Game.Net;
using static Hoops.Core.Sim;

/// <summary>In-memory relay (server/relay.ts semantics). Lives in the default load context; clients talk strings.</summary>
sealed class MemRelay
{
    sealed class Conn
    {
        public int h;
        public string id, room;
        public Dictionary<string, object> state = new Dictionary<string, object>();
        public double last, timerAt = -1, lag, jitter, drop;
        public bool open = true;
        public readonly List<(double at, string s)> inbox = new List<(double, string)>();
    }
    readonly Dictionary<int, Conn> conns = new Dictionary<int, Conn>();
    readonly Dictionary<string, List<Conn>> rooms = new Dictionary<string, List<Conn>>();
    readonly Func<double> now;
    readonly Random rnd = new Random(7);
    int nh, nid;
    public MemRelay(Func<double> now) { this.now = now; }

    public int Open(double lag, double jitter, double drop)
    {
        var c = new Conn { h = ++nh, lag = lag, jitter = jitter, drop = drop };
        conns[c.h] = c;
        return c.h;
    }
    void Out(Conn c, object msg)
    {
        if (!c.open) return;
        double at = now() + c.lag + rnd.NextDouble() * c.jitter;
        c.inbox.Add((at, Json.Write(msg)));
    }
    void Broadcast(Conn from)
    {
        from.last = now();
        from.timerAt = -1;
        if (!rooms.TryGetValue(from.room, out var r)) return;
        foreach (var c in r) if (c != from && !(c.drop > 0 && rnd.NextDouble() < c.drop)) Out(c, new Dictionary<string, object> { { "t", "p" }, { "id", from.id }, { "state", Json.Parse(Json.Write(from.state)) } });
    }
    public void Send(int h, string raw)
    {
        if (!conns.TryGetValue(h, out var c) || !c.open) return;
        if (!Json.TryParse(raw, out var v) || !(v is Dictionary<string, object> m)) return;
        string t = m.Str("t");
        if (t == "join" && c.room == null)
        {
            c.room = m.Str("room");
            if (!rooms.TryGetValue(c.room, out var r)) rooms[c.room] = r = new List<Conn>();
            string want = m.Str("id");
            c.id = want != null && !r.Any(x => x.id == want) ? want : "peer" + (++nid).ToString("D12");
            r.Add(c);
            Out(c, new Dictionary<string, object> { { "t", "hello" }, { "me", c.id }, { "peers", r.Where(x => x != c).Select(x => (object)new Dictionary<string, object> { { "id", x.id }, { "state", x.state } }).ToList() } });
            foreach (var x in r) if (x != c) Out(x, new Dictionary<string, object> { { "t", "p" }, { "id", c.id }, { "state", c.state } });
        }
        else if (t == "p" && c.room != null && m.Obj("patch") is Dictionary<string, object> patch)
        {
            foreach (var kv in patch) { if (kv.Value == null) c.state.Remove(kv.Key); else c.state[kv.Key] = kv.Value; }
            double wait = 33 - (now() - c.last);
            if (wait <= 0) Broadcast(c);
            else if (c.timerAt < 0) c.timerAt = now() + wait;
        }
        else if (t == "ping") Out(c, new Dictionary<string, object> { { "t", "pong" } });
    }
    public string Recv(int h)
    {
        if (!conns.TryGetValue(h, out var c)) return null;
        for (int i = 0; i < c.inbox.Count; i++)
            if (c.inbox[i].at <= now())
            {
                var s = c.inbox[i].s;
                c.inbox.RemoveAt(i);
                return s;
            }
        return null;
    }
    public void Close(int h)
    {
        if (!conns.TryGetValue(h, out var c) || !c.open) return;
        c.open = false;
        if (c.room != null && rooms.TryGetValue(c.room, out var r))
        {
            r.Remove(c);
            foreach (var x in r) Out(x, new Dictionary<string, object> { { "t", "left" }, { "id", c.id } });
        }
    }
    public bool IsOpen(int h) => conns.TryGetValue(h, out var c) && c.open;
    public void Pump()
    {
        foreach (var c in conns.Values) if (c.open && c.timerAt >= 0 && now() >= c.timerAt) Broadcast(c);
    }
}

/// <summary>IWsSocket over the relay's string delegates (compiled into both load contexts).</summary>
sealed class MemSocket : IWsSocket
{
    readonly int h;
    readonly Action<int, string> send;
    readonly Func<int, string> recv;
    readonly Action<int> close;
    readonly Func<int, bool> isOpen;
    bool opened;
    int st;
    public MemSocket(Func<int> open, Action<int, string> send, Func<int, string> recv, Action<int> close, Func<int, bool> isOpen)
    {
        h = open();
        this.send = send; this.recv = recv; this.close = close; this.isOpen = isOpen;
    }
    public int State => st == 3 ? 3 : opened ? 1 : 0;
    public void Send(string s) { if (st != 3) send(h, s); }
    public void Close() { st = 3; close(h); }
    public bool TryNext(out WsEv ev, out string data)
    {
        data = null;
        ev = default;
        if (st == 3) return false;
        if (!opened) { opened = true; ev = WsEv.Open; return true; }
        if (!isOpen(h)) { st = 3; ev = WsEv.Close; return true; }
        var s = recv(h);
        if (s == null) return false;
        ev = WsEv.Message;
        data = s;
        return true;
    }
}

/// <summary>In-memory WebRTC (default load context): offer/answer pairing, open after a handshake unless the network
/// isolates clients (then nothing ever opens), unreliable unordered delivery with its own latency / jitter / drop.</summary>
sealed class FakeRtcHub
{
    readonly Func<double> now;
    readonly Random rnd = new Random(11);
    public bool isolation;
    public double lag, jitter, drop;
    int nh;
    readonly Dictionary<int, int> pair = new Dictionary<int, int>();
    readonly Dictionary<int, List<(double at, string e)>> q = new Dictionary<int, List<(double, string)>>();
    readonly HashSet<int> closed = new HashSet<int>();
    public FakeRtcHub(Func<double> now) { this.now = now; }
    void Q(int h, double after, string e) { if (!closed.Contains(h)) q[h].Add((now() + after, e)); }
    public int New() { q[++nh] = new List<(double, string)>(); return nh; }
    public void Op(int h, int op, string arg)
    {
        if (closed.Contains(h)) return;
        switch (op)
        {
            case 0: Q(h, 50, "Sfake:" + h); break; // offer (ICE gathering ~50 ms)
            case 1: // accept offer -> answer
                if (int.TryParse(arg.Trim().Substring(5), out int o) && q.ContainsKey(o)) { pair[h] = o; pair[o] = h; }
                Q(h, 50, "Sfake:" + h);
                break;
            case 2: // accept answer -> both ends open (unless isolated)
                if (!isolation && pair.TryGetValue(h, out int b)) { Q(h, 60, "O"); Q(b, 60, "O"); }
                break;
            case 3: // send
                if (pair.TryGetValue(h, out int to) && !closed.Contains(to) && !(drop > 0 && rnd.NextDouble() < drop)) Q(to, lag + rnd.NextDouble() * jitter, "M" + arg);
                break;
            case 4: // close
                closed.Add(h);
                if (pair.TryGetValue(h, out int c2)) Q(c2, 20, "C");
                break;
        }
    }
    /// <summary>The direct path dies (NAT rebinding, Wi-Fi switch): every open channel closes at once.</summary>
    public void Kill()
    {
        foreach (var kv in pair) if (!closed.Contains(kv.Key)) { Q(kv.Key, 0, "C"); closed.Add(kv.Key); }
    }
    public string Next(int h)
    {
        var l = q[h];
        int best = -1;
        for (int i = 0; i < l.Count; i++) if (l[i].at <= now() && (best < 0 || l[i].at < l[best].at)) best = i;
        if (best < 0) return null;
        var e = l[best].e;
        l.RemoveAt(best);
        return e;
    }
}

sealed class FakeRtcLink : IRtcLink
{
    readonly int h;
    readonly Action<int, int, string> op;
    readonly Func<int, string> next;
    public FakeRtcLink(Func<int> nw, Action<int, int, string> op, Func<int, string> next) { h = nw(); this.op = op; this.next = next; }
    public void CreateOffer() => op(h, 0, null);
    public void AcceptOffer(string sdp) => op(h, 1, sdp);
    public void AcceptAnswer(string sdp) => op(h, 2, sdp);
    public void Send(string s) => op(h, 3, s);
    public void Close() => op(h, 4, null);
    public bool TryNext(out RtcEv ev, out string data)
    {
        ev = default; data = null;
        var e = next(h);
        if (e == null) return false;
        switch (e[0])
        {
            case 'S': ev = RtcEv.Sdp; data = e.Substring(1); break;
            case 'O': ev = RtcEv.Open; break;
            case 'M': ev = RtcEv.Message; data = e.Substring(1); break;
            default: ev = RtcEv.Closed; break;
        }
        return true;
    }
}

/// <summary>Shared by the host side and every guest context: how a side opens its transport.</summary>
static class Side
{
    public static void Opts(string o)
    {
        bool on = o.Contains("improved");
        NetOpts.Direct = on && o.Contains("rtc");
        NetOpts.AdaptiveDelay = NetOpts.InputRedundancy = NetOpts.Fast60 = NetOpts.SmoothCorrection = NetOpts.LagCap150 = NetOpts.Migration = NetOpts.AutoRematch = on;
    }
    public static ITransport Open(Dictionary<string, Delegate> d, Func<double> clock, double lag, double jit, double drop)
    {
        var relOpen = (Func<double, double, double, int>)d["open"];
        var ws = new WsTransport("mem://relay", "h2k-test", u => new MemSocket(() => relOpen(lag, jit, drop), (Action<int, string>)d["send"], (Func<int, string>)d["recv"], (Action<int>)d["close"], (Func<int, bool>)d["isOpen"]), clock).Connect();
        if (!NetOpts.Direct) return ws;
        return new RtcTransport(ws, () => new FakeRtcLink((Func<int>)d["rtcNew"], (Action<int, int, string>)d["rtcOp"], (Func<int, string>)d["rtcNext"]), clock);
    }
}

/// <summary>The guest side; instantiated inside its own load context through reflection.</summary>
public static class GuestSide
{
    static GuestSession g;
    static HostSession H; // after a host migration
    static ITransport t;
    static string name;
    static int fc;
    static bool voted;
    static double maxVx, errSum, hostVx, rpx = double.NaN, rpy, maxJump, migratedAt = -1;
    static int errN, nan, jumpN;
    static readonly List<double> jumps = new List<double>();
    static Input Sample()
    {
        var i = new Input { dx = 1, dy = Math.Sin(fc / 40.0) * 0.5 };
        if (fc % 150 == 0) i.sd = true;
        if (fc % 150 == 30) i.su = true;
        return i;
    }
    public static object[] Init(Dictionary<string, Delegate> d, string opts, string nm, double lag, double jit, double drop)
    {
        var clock = (Func<double>)d["clock"];
        NetClock.Wall = clock;
        NetClock.Mono = clock;
        Side.Opts(opts);
        Rng.Seed(99);
        cfg.physics = "legacy";
        name = nm;
        t = Side.Open(d, clock, lag, jit, drop);
        g = new GuestSession(t, new GuestMe { n = nm, tok = "tok-" + nm, code = "TEST" }, clock);
        Action<double> frame = Frame;
        Func<string, string> q = Query;
        return new object[] { frame, q };
    }
    static void Frame(double dt)
    {
        t.Poll();
        fc++;
        if (H != null)
        {
            // I am the host now
            H.Poll();
            upd(1 / 60.0);
            H.Tick();
            FX.Clear();
            return;
        }
        if (g.ShouldMigrate())
        {
            H = HostSession.TakeOver(g, new HostMe { n = name, tok = "tok-" + name });
            cfg.input = c => H.IsRemote(c) ? H.RemoteInput(c) : Sample();
            migratedAt = H.k;
            return;
        }
        if (g.L != null && g.L.st == "lobby" && g.side != 0) { g.SetSide(0); g.SetReady(1); }
        if (g.L != null && g.L.st == "over" && !voted) { g.WantRematch(); voted = true; } // (quick rematch)
        if (g.L != null && g.L.st == "game") voted = false;
        g.Frame(dt, Sample);
        if (g.myIdx >= 0 && g.snaps.Count > 0)
        {
            var p = P[g.myIdx];
            var s = g.snaps[g.snaps.Count - 1];
            int o = Protocol.HDR + g.myIdx * Protocol.PST;
            maxVx = Math.Max(maxVx, p.vx);
            errSum += Math.Sqrt(Math.Pow(p.x - s[o] / 10, 2) + Math.Pow(p.y - s[o + 1] / 10, 2));
            errN++;
            hostVx = Math.Max(hostVx, s[o + 3]);
            // drawn motion of my player: deviation from moving at its own velocity (pops / snaps), teleports excluded
            if (!double.IsNaN(rpx))
            {
                double j = Math.Sqrt(Math.Pow(p.x - rpx - p.vx * dt, 2) + Math.Pow(p.y - rpy - p.vy * dt, 2));
                if (j < 60) { jumps.Add(j); maxJump = Math.Max(maxJump, j); }
            }
            rpx = p.x; rpy = p.y;
        }
        foreach (var p in P) if (double.IsNaN(p.x) || double.IsNaN(p.y) || double.IsNaN(p.z)) nan++;
    }
    static string Query(string what)
    {
        if (what == "link") return t is ILinkInfo l0 && g.HostId != null ? l0.LinkOf(g.HostId) : "RELAY";
        if (what == "pos")
        {
            double rt = H != null || g.off == null ? -1 : NetClock.Mono() / 1000 * 60 + g.off.Value - g.D;
            var a = new List<object> { rt, (double)g.myIdx };
            foreach (var p in P) { a.Add(p.x); a.Add(p.y); }
            return Json.Write(a);
        }
        var st = g.stats;
        var sub = P.Count > 0 ? P[0] : null;
        var outP = BENCH[0].FirstOrDefault(b => b.rid == 0);
        jumps.Sort();
        string link = t is ILinkInfo li && g.HostId != null ? li.LinkOf(g.HostId) : "RELAY";
        return Json.Write(new Dictionary<string, object>
        {
            { "who", name }, { "role", H != null ? "host" : "guest" }, { "migratedAt", migratedAt }, { "hostTick", H != null ? (double)H.k : -1 },
            { "gid", (double)g.gid }, { "lobby", g.L?.st }, { "full", (double)st.full }, { "delta", (double)st.delta }, { "corr", st.corr + "/" + st.recon },
            { "rtt", Math.Round(g.rtt) }, { "D", Math.Round(g.D, 1) }, { "myIdx", (double)g.myIdx }, { "predVxMax", Math.Round(maxVx) }, { "hostVxMax", hostVx },
            { "avgPredLeadPx", Math.Round(errSum / Math.Max(1, errN), 1) }, { "nan", (double)nan }, { "score", sc[0] + "-" + sc[1] }, { "clock", Math.Round(clock, 1) }, { "q", q },
            { "subRid", sub != null ? sub.rid : -1 }, { "subOk", sub != null && sub.rid == 5 && outP != null && ROST[0].Contains(sub) }, { "np", (double)cfg.NP },
            { "maxHostPres", (double)(g.host != null ? Json.Write(g.host.state).Length : 0) }, { "link", link },
            { "loss", Math.Round(g.LossPct, 1) }, { "jitterMs", Math.Round(g.JitterMs, 1) }, { "late", Math.Round(g.LatePct, 2) },
            { "snaps40", (double)g.snaps40 }, { "maxCorr", Math.Round(g.maxCorr, 1) },
            { "jumpP99", jumps.Count > 0 ? Math.Round(jumps[Math.Min(jumps.Count - 1, (int)(jumps.Count * 0.99))], 2) : 0 }, { "jumpMax", Math.Round(maxJump, 1) },
            { "lastSnap", g.Latest != null ? g.Latest[0] : -1 }, { "hostGone", g.hostGoneAt != 0 },
        });
    }
}

static class NetLoop
{
    static double simT = 1000;
    static int fails;
    static void Check(bool ok, string m) { if (!ok) { Console.WriteLine("  FAIL: " + m); fails++; } }
    static double Arg(string[] a, string k, double d)
    {
        var s = a.FirstOrDefault(x => x.StartsWith(k + "="));
        return s != null ? double.Parse(s.Substring(k.Length + 1), CultureInfo.InvariantCulture) : d;
    }

    static void Main(string[] args)
    {
        double LAG = Arg(args, "lag", 80), JIT = Arg(args, "jitter", 40), DROP = Arg(args, "drop", 0.1), SECS = Arg(args, "seconds", 12);
        Func<double> clock = () => simT;
        NetClock.Wall = clock;
        NetClock.Mono = clock;
        RoomTest();
        string only = args.FirstOrDefault(a => !a.Contains("="));
        foreach (var sc in new[] { "faithful", "improved", "improved+rtc", "improved+rtc+isolation", "improved+rtc+flap", "improved+rtc+migration", "improved+rematch" })
            if (only == null || only == sc) Scenario(sc, LAG, JIT, DROP, SECS);
        Console.WriteLine(fails == 0 ? "net loop ok" : $"net loop: {fails} failure(s)");
        Environment.Exit(fails == 0 ? 0 : 1);
    }

    static void Scenario(string mode, double LAG, double JIT, double DROP, double SECS)
    {
        Console.WriteLine($"== {mode}  (lag {LAG} ms, jitter {JIT} ms, drop {DROP})");
        Func<double> clock = () => simT;
        var relay = new MemRelay(clock);
        var rtc = new FakeRtcHub(clock) { isolation = mode.Contains("isolation"), lag = LAG / 4, jitter = JIT / 4, drop = 0.02 };
        var d = new Dictionary<string, Delegate>
        {
            { "clock", clock }, { "open", (Func<double, double, double, int>)((l, j, dr) => relay.Open(l, j, dr)) }, { "send", (Action<int, string>)relay.Send },
            { "recv", (Func<int, string>)relay.Recv }, { "close", (Action<int>)relay.Close }, { "isOpen", (Func<int, bool>)relay.IsOpen },
            { "rtcNew", (Func<int>)rtc.New }, { "rtcOp", (Action<int, int, string>)rtc.Op }, { "rtcNext", (Func<int, string>)rtc.Next },
        };
        bool migr = mode.Contains("migration");
        // ---- host (this load context): dedicated, like server/headless-host.ts ----
        Side.Opts(mode);
        Rng.Seed(2024);
        cfg.physics = "legacy";
        cfg.replays = true;
        var ht = Side.Open(d, clock, LAG / 2, JIT / 2, 0);
        HostSession H = null;
        // ---- guests (each in its own load context: its own copy of the static sim) ----
        var gFrame = new List<Action<double>>();
        var gQuery = new List<Func<string, string>>();
        for (int gi = 0; gi < (migr ? 2 : 1); gi++)
        {
            var alc = new AssemblyLoadContext("guest" + gi + mode, true);
            var asm = alc.LoadFromAssemblyPath(typeof(NetLoop).Assembly.Location);
            var gs = (object[])asm.GetType("GuestSide").GetMethod("Init").Invoke(null, new object[] { d, mode, "G" + gi, LAG / 2, JIT / 2, DROP });
            gFrame.Add((Action<double>)gs[0]);
            gQuery.Add((Func<string, string>)gs[1]);
            for (int f = 0; f < 20; f++) { simT += 1000 / 60.0; relay.Pump(); ht.Poll(); gFrame[gi](1 / 60.0); } // (join in order)
        }

        int frames = 0, endFrame = -1, maxPres = 0, hostStarted = -1, hostLeft = -1;
        bool flap = mode.Contains("flap"), rematch = mode.Contains("rematch");
        string midLink = null;
        double maxLag = 0;
        double interpErr = 0;
        int interpN = 0;
        var hist = new Dictionary<int, double[]>(); // host tick -> positions
        while (true)
        {
            simT += 1000 / 60.0;
            frames++;
            relay.Pump();
            if (hostLeft < 0)
            {
                ht.Poll();
                if (H == null && ht.Connected())
                {
                    H = new HostSession(ht, new HostMe { n = "Server", tok = "", play = false }, 5, 1, 60, "TEST", true, clock);
                    cfg.input = c => H.IsRemote(c) ? H.RemoteInput(c) : new Input();
                }
                if (H != null)
                {
                    H.Poll();
                    if (H.L.st == "lobby" && H.L.slots.Count >= gFrame.Count && H.L.slots.All(s => s.rdy != 0)) { H.Start(); hostStarted = frames; }
                    if (H.L.st != "lobby")
                    {
                        upd(1 / 60.0);
                        H.Tick();
                        FX.Clear(); // (the shell drains FX every frame)
                        if (H.k == 180 && cfg.NP == 5 && H.L.gid == 1) { var U = lineup(); U[0][0] = 5; applyLineup(U); } // online substitution
                        if (rematch && H.L.gid == 1 && H.k == 300 && S == "play") endGame(); // final buzzer -> the guest votes, the host restarts
                        foreach (var c in CT) maxLag = Math.Max(maxLag, c.lag);
                        var pos = new double[P.Count * 2];
                        for (int i = 0; i < P.Count; i++) { pos[2 * i] = P[i].x; pos[2 * i + 1] = P[i].y; }
                        hist[H.k] = pos;
                    }
                    else H.Pub(false);
                    var me = ht.Peers().FirstOrDefault(p => p.me);
                    if (me != null) maxPres = Math.Max(maxPres, Json.Write(me.state).Length);
                }
                // migration scenario: the host vanishes 6 s into the game
                if (migr && hostStarted > 0 && frames == hostStarted + 360) { ht.Leave(); hostLeft = frames; }
            }
            foreach (var f in gFrame) f(1 / 60.0);
            if (flap && hostStarted > 0)
            {
                // the direct path dies 4 s in and stays blocked 3 s: relay meanwhile, back to direct after the 5 s retry
                if (frames == hostStarted + 240) { rtc.isolation = true; rtc.Kill(); }
                if (frames == hostStarted + 420) { rtc.isolation = false; midLink = gQuery[0]("link"); }
            }
            // interpolation accuracy: the guest's rendered others vs the host's positions at the guest's render tick
            if (hostStarted > 0 && frames > hostStarted + 120 && hostLeft < 0)
            {
                var a = Json.Nums(Json.Parse(gQuery[0]("pos")));
                int rt = (int)Math.Round(a[0]), me = (int)a[1];
                if (rt > 0 && hist.TryGetValue(rt, out var hp) && a.Length - 2 == hp.Length)
                    for (int i = 0; i < hp.Length / 2; i++)
                        if (i != me) { interpErr += Math.Sqrt(Math.Pow(a[2 + 2 * i] - hp[2 * i], 2) + Math.Pow(a[3 + 2 * i] - hp[2 * i + 1], 2)); interpN++; }
            }
            if (hostStarted > 0 && endFrame < 0) endFrame = frames + (int)(SECS * 60);
            if (endFrame > 0 && frames >= endFrame) break;
            if (frames > 60 * 60) { Check(false, "game never started"); break; }
        }
        var res = (Dictionary<string, object>)Json.Parse(gQuery[0]("stats"));
        res["avgInterpErrPx"] = Math.Round(interpErr / Math.Max(1, interpN), 2);
        res["hostPresenceMaxBytes"] = (double)maxPres;
        if (ht is RtcTransport hr) { res["hostDirectRx"] = (double)hr.directMsgs; res["hostAllDirect"] = hr.AllDirect(); }
        res["maxLagMs"] = Math.Round(maxLag * 1000);
        if (midLink != null) res["linkDuringOutage"] = midLink;
        Console.WriteLine("  " + Json.Write(res));
        Check(res.Num("nan") == 0, "NaN state");
        Check(res.Num("delta") >= 10, "delta snapshots not used");
        Check(res.Num("rtt") > 0, "no ping measured");
        Check(res.Num("hostVxMax") >= 100, "guest input did not drive the host player");
        Check(res.Num("predVxMax") >= 100, "guest prediction did not move the player");
        Check(maxPres <= 4096, "host presence exceeds the 4 KiB room limit");
        Check(res.Num("np") != 5 || rematch || Json.Truthy(res.Get("subOk")), "guest did not follow the host's substitution");
        if (!migr) Check(res.Num("avgInterpErrPx") < 8, "interpolated players far from the host");
        if (mode.Contains("improved") && !migr)
        {
            Check(res.Num("late") < 2, "more than 2% late snapshots with the adaptive delay");
        }
        Check(maxLag > 0 && maxLag <= (mode.Contains("improved") ? 0.15 : 0.3) + 1e-9, "lag compensation rewind missing or above its cap");
        if (flap)
        {
            Check(res.Str("linkDuringOutage") == "RELAY", "a dead direct channel must fall back to the relay");
            Check(res.Str("link") == "DIRECT" && Json.Truthy(res.Get("hostAllDirect")), "the direct channel did not come back after the retry");
        }
        if (rematch) Check(res.Num("gid") == 2 && res.Str("lobby") == "game" && res.Num("myIdx") >= 0, "quick rematch did not start a new game for the guest");
        if (mode == "improved+rtc") Check(res.Str("link") == "DIRECT" && Json.Truthy(res.Get("hostAllDirect")), "direct channel not used");
        if (mode.Contains("isolation")) Check(res.Str("link") == "RELAY", "isolated clients must stay on the relay");
        if (migr)
        {
            var r1 = (Dictionary<string, object>)Json.Parse(gQuery[1]("stats"));
            Console.WriteLine("  " + Json.Write(r1));
            // the longest-seated guest (first in the host's slot order) takes over; the other keeps following
            var nh = res.Str("role") == "host" ? res : r1;
            var fo = nh == res ? r1 : res;
            Check(nh.Str("role") == "host", "no guest took over");
            Check(fo.Str("role") == "guest" && !Json.Truthy(fo.Get("hostGone")), "the other guest lost the game after the migration");
            Check(fo.Num("lastSnap") > nh.Num("migratedAt") + 120, "the other guest gets no snapshots from the new host");
            Check(fo.Num("gid") == 1, "the game restarted instead of continuing");
            r1 = fo;
            Check(r1.Num("nan") == 0, "NaN on the second guest");
        }
    }

    // ---------------- RoomTransport against a flaky fake room ----------------
    sealed class FakeHub
    {
        public readonly Dictionary<string, Dictionary<string, object>> st = new Dictionary<string, Dictionary<string, object>>();
        public readonly List<FakeConn> conns = new List<FakeConn>();
        public double failP;
        public readonly Random rnd = new Random(3);
        public void Changed() { foreach (var c in conns) if (c.up) c.dirty = true; }
    }
    sealed class FakeConn : IRoomConn
    {
        readonly FakeHub hub;
        readonly string me;
        public bool up = true, dirty = true;
        Action<List<Peer>> fn;
        readonly List<(double at, bool ok, Action<bool, string> done)> calls = new List<(double, bool, Action<bool, string>)>();
        public FakeConn(FakeHub hub, string me) { this.hub = hub; this.me = me; hub.conns.Add(this); if (!hub.st.ContainsKey(me)) hub.st[me] = new Dictionary<string, object>(); hub.Changed(); }
        public List<Peer> Peers() => hub.st.Select(kv => new Peer { id = kv.Key, me = kv.Key == me, state = kv.Value }).ToList();
        public void SetListener(Action<List<Peer>> f) => fn = f;
        public void Presence(Dictionary<string, object> patch, Action<bool, string> done)
        {
            bool ok = up && hub.rnd.NextDouble() >= hub.failP;
            if (ok)
            {
                var s = new Dictionary<string, object>(hub.st[me]);
                foreach (var kv in patch) if (kv.Value == null) s.Remove(kv.Key); else s[kv.Key] = kv.Value;
                hub.st[me] = s;
                hub.Changed();
            }
            calls.Add((simT + 40, ok, done));
        }
        public bool Connected() => up;
        public void Leave() { up = false; hub.conns.Remove(this); }
        public void Poll()
        {
            for (int i = 0; i < calls.Count; i++) if (calls[i].at <= simT) { var c = calls[i]; calls.RemoveAt(i--); c.done(c.ok, c.ok ? null : "net"); }
            if (dirty && up && fn != null) { dirty = false; fn(Peers()); }
        }
    }
    static void RoomTest()
    {
        var hub = new FakeHub { failP = 0.3 };
        FakeConn a0 = new FakeConn(hub, "A");
        var A = new RoomTransport(a0, (ok, err) => ok(new FakeConn(hub, "A")));
        var Bt = new RoomTransport(new FakeConn(hub, "B"));
        Dictionary<string, object> seenA = null;
        Bt.OnPeers(ps => seenA = ps.FirstOrDefault(p => p.id == "A")?.state);
        int calls = 0;
        for (int f = 0; f < 60 * 20; f++)
        {
            simT += 1000 / 60.0;
            if (f < 300) { A.Presence(new Dictionary<string, object> { { "n", (double)f } }); calls++; }
            if (f == 400) a0.up = false; // the room drops A; A must rejoin after 5 s and re-assert
            if (f == 400) A.Presence(new Dictionary<string, object> { { "late", 1.0 } });
            A.Poll();
            Bt.Poll();
        }
        bool ok = seenA != null && seenA.Num("n") == 299 && seenA.Num("late") == 1;
        Console.WriteLine($"room: {calls} presence calls under 30% failures + a dropped room -> peer sees n={seenA?.Num("n")} late={seenA?.Num("late")} connected={A.Connected()}");
        Check(ok && A.Connected(), "RoomTransport did not converge (retry / rejoin)");
        hub.failP = 0;
    }
}
