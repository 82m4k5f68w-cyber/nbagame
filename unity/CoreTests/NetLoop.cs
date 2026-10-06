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

/// <summary>The guest side; instantiated inside its own load context through reflection.</summary>
public static class GuestSide
{
    static GuestSession g;
    static WsTransport t;
    static int fc;
    static double maxVx, errSum, hostVx;
    static int errN, nan;
    public static object[] Init(Func<double> clock, Func<int> open, Action<int, string> send, Func<int, string> recv, Action<int> close, Func<int, bool> isOpen)
    {
        NetClock.Wall = clock;
        NetClock.Mono = clock;
        Rng.Seed(99);
        cfg.physics = "legacy";
        t = new WsTransport("mem://relay", "h2k-test", u => new MemSocket(open, send, recv, close, isOpen), clock).Connect();
        g = new GuestSession(t, new GuestMe { n = "Tester", tok = "tok123", code = "TEST" }, clock);
        Action<double> frame = Frame;
        Func<string, string> q = Query;
        return new object[] { frame, q };
    }
    static void Frame(double dt)
    {
        t.Poll();
        if (g.L != null && g.L.st == "lobby" && g.side != 0) { g.SetSide(0); g.SetReady(1); }
        fc++;
        g.Frame(dt, () =>
        {
            var i = new Input { dx = 1, dy = Math.Sin(fc / 40.0) * 0.5 };
            if (fc % 150 == 0) i.sd = true;
            if (fc % 150 == 30) i.su = true;
            return i;
        });
        if (g.myIdx >= 0 && g.snaps.Count > 0)
        {
            var p = P[g.myIdx];
            var s = g.snaps[g.snaps.Count - 1];
            int o = Protocol.HDR + g.myIdx * Protocol.PST;
            maxVx = Math.Max(maxVx, p.vx);
            errSum += Math.Sqrt(Math.Pow(p.x - s[o] / 10, 2) + Math.Pow(p.y - s[o + 1] / 10, 2));
            errN++;
            hostVx = Math.Max(hostVx, s[o + 3]);
        }
        foreach (var p in P) if (double.IsNaN(p.x) || double.IsNaN(p.y) || double.IsNaN(p.z)) nan++;
    }
    static string Query(string what)
    {
        if (what == "pos")
        {
            // render tick + every player's rendered position
            double rt = g.off == null ? -1 : NetClock.Mono() / 1000 * 60 + g.off.Value - g.D;
            var a = new List<object> { rt, (double)g.myIdx };
            foreach (var p in P) { a.Add(p.x); a.Add(p.y); }
            return Json.Write(a);
        }
        var st = g.stats;
        var sub = P.Count > 0 ? P[0] : null;
        var outP = BENCH[0].FirstOrDefault(b => b.rid == 0);
        return Json.Write(new Dictionary<string, object>
        {
            { "gid", (double)g.gid }, { "lobby", g.L?.st }, { "full", (double)st.full }, { "delta", (double)st.delta }, { "corr", st.corr + "/" + st.recon },
            { "rtt", Math.Round(g.rtt) }, { "D", Math.Round(g.D, 1) }, { "myIdx", (double)g.myIdx }, { "predVxMax", Math.Round(maxVx) }, { "hostVxMax", hostVx },
            { "avgPredLeadPx", Math.Round(errSum / Math.Max(1, errN), 1) }, { "nan", (double)nan }, { "score", sc[0] + "-" + sc[1] },
            { "subRid", sub != null ? sub.rid : -1 }, { "subOk", sub != null && sub.rid == 5 && outP != null && ROST[0].Contains(sub) }, { "np", (double)cfg.NP },
            { "maxHostPres", (double)(g.host != null ? Json.Write(g.host.state).Length : 0) },
        });
    }
}

static class NetLoop
{
    static double simT = 1000;
    static int fails;
    static void Check(bool ok, string m) { if (!ok) { Console.WriteLine("FAIL: " + m); fails++; } }
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
        var relay = new MemRelay(clock);

        // ---- host (this load context): dedicated, like server/headless-host.ts ----
        Rng.Seed(2024);
        cfg.physics = "legacy";
        cfg.replays = true;
        var ht = new WsTransport("mem://relay", "h2k-test", u => new MemSocket(() => relay.Open(LAG / 2, JIT / 2, 0), relay.Send, relay.Recv, relay.Close, relay.IsOpen), clock).Connect();
        HostSession H = null;
        // ---- guest (second load context: its own copy of the static sim) ----
        var alc = new AssemblyLoadContext("guest", true);
        var asm = alc.LoadFromAssemblyPath(typeof(NetLoop).Assembly.Location);
        var init = asm.GetType("GuestSide").GetMethod("Init");
        var gs = (object[])init.Invoke(null, new object[] { clock, (Func<int>)(() => relay.Open(LAG / 2, JIT / 2, DROP)), (Action<int, string>)relay.Send, (Func<int, string>)relay.Recv, (Action<int>)relay.Close, (Func<int, bool>)relay.IsOpen });
        var gFrame = (Action<double>)gs[0];
        var gQuery = (Func<string, string>)gs[1];

        int frames = 0, endFrame = -1, maxPres = 0, hostStarted = -1;
        double interpErr = 0;
        int interpN = 0;
        var hist = new Dictionary<int, double[]>(); // host tick -> positions
        while (true)
        {
            simT += 1000 / 60.0;
            frames++;
            relay.Pump();
            ht.Poll();
            if (H == null && ht.Connected())
            {
                H = new HostSession(ht, new HostMe { n = "Server", tok = "", play = false }, 5, 1, 60, "TEST", true, clock);
                cfg.input = c => H.IsRemote(c) ? H.RemoteInput(c) : new Input();
            }
            if (H != null)
            {
                H.Poll();
                if (H.L.st == "lobby" && H.L.slots.Count > 0 && H.L.slots.All(s => s.rdy != 0)) { H.Start(); hostStarted = frames; }
                if (H.L.st != "lobby")
                {
                    upd(1 / 60.0);
                    H.Tick();
                    FX.Clear(); // (the shell drains FX every frame)
                    if (H.k == 180 && cfg.NP == 5) { var U = lineup(); U[0][0] = 5; applyLineup(U); } // online substitution
                    var pos = new double[P.Count * 2];
                    for (int i = 0; i < P.Count; i++) { pos[2 * i] = P[i].x; pos[2 * i + 1] = P[i].y; }
                    hist[H.k] = pos;
                }
                else H.Pub(false);
                maxPres = Math.Max(maxPres, Json.Write(ht.Peers().Count > 0 ? ht.Peers()[0].state : null).Length);
            }
            gFrame(1 / 60.0);
            // interpolation accuracy: the guest's rendered others vs the host's positions at the guest's render tick
            if (hostStarted > 0 && frames > hostStarted + 120)
            {
                var a = Json.Nums(Json.Parse(gQuery("pos")));
                int rt = (int)Math.Round(a[0]), me = (int)a[1];
                if (rt > 0 && hist.TryGetValue(rt, out var hp) && a.Length - 2 == hp.Length)
                    for (int i = 0; i < hp.Length / 2; i++)
                        if (i != me) { interpErr += Math.Sqrt(Math.Pow(a[2 + 2 * i] - hp[2 * i], 2) + Math.Pow(a[3 + 2 * i] - hp[2 * i + 1], 2)); interpN++; }
            }
            if (hostStarted > 0 && endFrame < 0) endFrame = frames + (int)(SECS * 60);
            if (endFrame > 0 && frames >= endFrame) break;
            if (frames > 60 * 60) { Check(false, "game never started"); break; }
        }
        var res = (Dictionary<string, object>)Json.Parse(gQuery("stats"));
        res["avgInterpErrPx"] = Math.Round(interpErr / Math.Max(1, interpN), 2);
        res["hostPresenceMaxBytes"] = (double)maxPres;
        Console.WriteLine(Json.Write(res));
        Check(res.Num("nan") == 0, "NaN state");
        Check(res.Num("delta") >= 10, "delta snapshots not used");
        Check(res.Num("rtt") > 0, "no ping measured");
        Check(res.Num("hostVxMax") >= 100, "guest input did not drive the host player");
        Check(res.Num("predVxMax") >= 100, "guest prediction did not move the player");
        Check(maxPres <= 4096, "host presence exceeds the 4 KiB room limit");
        Check(res.Num("avgInterpErrPx") < 8, "interpolated players far from the host");
        Check(res.Num("np") != 5 || Json.Truthy(res.Get("subOk")), "guest did not follow the host's substitution");
        Console.WriteLine(fails == 0 ? "net loop ok" : $"net loop: {fails} failure(s)");
        Environment.Exit(fails == 0 ? 0 : 1);
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
