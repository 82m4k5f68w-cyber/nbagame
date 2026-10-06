// Authoritative host (port of src/net/host.ts): runs the real Core sim, turns guests' presence into controller inputs,
// and publishes delta-compressed snapshots + events + acks. Pure C# (no UnityEngine).
// The shell calls Poll() every frame (lobby heartbeat) and Tick() after every sim tick (G.upd).
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using Hoops.Core;
using static Hoops.Core.Sim;

namespace Hoops.Game.Net
{
    public sealed class Slot : IJsonable
    {
        public string id; // peer id ("host" for the local host player)
        public string tok = ""; // reconnect token
        public string n;
        public int tm;
        public int rdy;
        public int on; // currently connected
        public double? gone; // when a lobby seat lost its connection (kept 15 s for a reconnect)
        public double elo = 1000; // ranked rating (each client keeps its own; shown in the lobby)

        public Dictionary<string, object> ToJson()
        {
            var o = new Dictionary<string, object> { { "id", id }, { "tok", tok ?? "" }, { "n", n }, { "tm", (double)tm }, { "rdy", (double)rdy }, { "on", (double)on } };
            if (gone != null) o["gone"] = gone.Value;
            o["elo"] = elo;
            return o;
        }
        public static Slot From(Dictionary<string, object> o) => new Slot
        {
            id = o.Str("id") ?? "",
            tok = o.Str("tok") ?? "",
            n = o.Str("n") ?? "Player",
            tm = (int)o.Num("tm"),
            rdy = (int)o.Num("rdy"),
            on = (int)o.Num("on"),
            gone = o.Get("gone") is double g ? g : (double?)null,
            elo = o.Num("elo", 1000),
        };
    }

    /// <summary>Tournament (friends' 1v1 bracket): players (slot ids), matches so far + current, winners, current index.</summary>
    public sealed class Tour : IJsonable
    {
        public List<string> ids = new List<string>();
        public Dictionary<string, string> names = new Dictionary<string, string>();
        public List<string[]> m = new List<string[]>();
        public List<string> w = new List<string>();
        public int i;
        public string bye, champ;

        public Dictionary<string, object> ToJson()
        {
            var nm = new Dictionary<string, object>();
            foreach (var kv in names) nm[kv.Key] = kv.Value;
            var ml = new List<object>();
            foreach (var x in m) ml.Add(new List<object> { x[0], x[1] });
            var o = new Dictionary<string, object> { { "ids", new List<object>(ids) }, { "names", nm }, { "m", ml }, { "w", new List<object>(w) }, { "i", (double)i } };
            if (bye != null) o["bye"] = bye;
            if (champ != null) o["champ"] = champ;
            return o;
        }
        public static Tour From(Dictionary<string, object> o)
        {
            if (o == null) return null;
            var t = new Tour { i = (int)o.Num("i"), bye = o.Str("bye"), champ = o.Str("champ") };
            if (o.Arr("ids") is List<object> ids) foreach (var x in ids) t.ids.Add(x as string);
            if (o.Obj("names") is Dictionary<string, object> nm) foreach (var kv in nm) t.names[kv.Key] = kv.Value as string;
            if (o.Arr("m") is List<object> ml) foreach (var x in ml) if (x is List<object> p && p.Count >= 2) t.m.Add(new[] { p[0] as string, p[1] as string });
            if (o.Arr("w") is List<object> w) foreach (var x in w) t.w.Add(x as string);
            return t;
        }
    }

    public sealed class Lobby : IJsonable
    {
        public string st = "lobby"; // lobby | game | over
        public int gid, np = 5, pro = 1, ql = 60; // ql = quarter length (s)
        public int[] teams = { 0, 1 };
        public List<Slot> slots = new List<Slot>();
        public string code = "";
        public int ded; // dedicated (headless) host
        public Tour tour;
        public bool tourNull; // tour was explicitly cleared (serialized as null, like the TS lobby after a tournament)

        public Dictionary<string, object> ToJson()
        {
            var sl = new List<object>();
            foreach (var s in slots) sl.Add(s.ToJson());
            var o = new Dictionary<string, object>
            {
                { "st", st }, { "gid", (double)gid }, { "np", (double)np }, { "pro", (double)pro }, { "ql", (double)ql },
                { "teams", new List<object> { (double)teams[0], (double)teams[1] } }, { "slots", sl }, { "code", code }, { "ded", (double)ded },
            };
            if (tour != null) o["tour"] = tour.ToJson();
            else if (tourNull) o["tour"] = null;
            return o;
        }
        public static Lobby From(Dictionary<string, object> o)
        {
            var L = new Lobby
            {
                st = o.Str("st") ?? "lobby",
                gid = (int)o.Num("gid"),
                np = (int)o.Num("np", 5),
                pro = (int)o.Num("pro", 1),
                ql = (int)o.Num("ql", 60),
                code = o.Str("code") ?? "",
                ded = (int)o.Num("ded"),
                tour = Tour.From(o.Obj("tour")),
            };
            var tm = Json.Nums(o.Get("teams"));
            if (tm != null && tm.Length >= 2) L.teams = new[] { (int)tm[0], (int)tm[1] };
            if (o.Arr("slots") is List<object> sl) foreach (var x in sl) if (x is Dictionary<string, object> d) L.slots.Add(Slot.From(d));
            return L;
        }
        public Slot Find(string id) { foreach (var s in slots) if (s.id == id) return s; return null; }
    }

    public sealed class HostMe
    {
        public string n = "Player", tok = "";
        public int tm;
        public bool play = true;
        public double elo = 1000;
    }

    public sealed class HostSession
    {
        sealed class GuestRec
        {
            public string id;
            public Dictionary<string, object> st;
            public WireInput w;
            public double[] last; // counters already consumed
            public List<string> pend = new List<string>();
            public double ack = -1;
            public List<double> acks = new List<double>(); // snapshot ticks this guest has confirmed
            public double ping, D = 6;
            public double q; // last quick-chat sequence consumed
            public double seen; // when this guest's presence last changed
            public bool stale;
        }

        /// <summary>Quick chat / emotes (keys 1-6).</summary>
        public static readonly string[] CHAT = { "Nice shot!", "Pass it!", "My bad", "Good game", "\U0001F525 On fire!", "\U0001F602" };

        public Lobby L;
        public readonly ITransport t;
        public readonly HostMe me;
        readonly Dictionary<string, GuestRec> guests = new Dictionary<string, GuestRec>();
        readonly List<string> order = new List<string>(); // guests in join order (JS Map iteration order)
        readonly Dictionary<int, double[]> hist = new Dictionary<int, double[]>();
        public int k;
        int lastBox;
        /// <summary>Quick-chat ring relayed to everyone: [seq, who (slot id), message index].</summary>
        public readonly List<object[]> Q = new List<object[]>();
        int qn;
        public Action onChange;
        public Action<string, int> onChat;
        readonly Action unsub;
        readonly HashSet<string> remote = new HashSet<string>();
        readonly Func<double> now;
        double hbAt;
        // events of the sim, kept here (the shell drains Sim.FX every frame)
        readonly List<Fx> fxRing = new List<Fx>();
        int fxSeen;

        public HostSession(ITransport t, HostMe me, int np, int pro, int ql, string code, bool ded = false, Func<double> now = null)
        {
            this.t = t;
            this.me = me;
            this.now = now ?? NetClock.Wall;
            L = new Lobby { np = np, pro = pro, ql = ql, code = code, ded = ded ? 1 : 0 };
            if (me.play) L.slots.Add(new Slot { id = "host", tok = me.tok, n = me.n, tm = me.tm, rdy = 1, on = 1, elo = me.elo });
            unsub = t.OnPeers(Peers);
            Pub(true);
            hbAt = this.now();
        }

        /// <summary>Per frame: the lobby heartbeat (re-publish every 2 s; let go of seats gone 15 s).</summary>
        public void Poll()
        {
            double n = now();
            if (n - hbAt >= 2000)
            {
                hbAt = n;
                Heartbeat(n);
            }
        }

        public void Heartbeat(double n)
        {
            if (L.st == "game") return;
            int c = L.slots.Count;
            L.slots.RemoveAll(s => !(s.on != 0 || s.gone == null || n - s.gone.Value < 15000));
            Pub(true);
            if (c != L.slots.Count) onChange?.Invoke();
        }

        public IEnumerable<string> GuestIds() => order;
        public double GuestPing(string id) => guests.TryGetValue(id, out var g) ? g.ping : 0;
        public Dictionary<string, object> GuestState(string id) => guests.TryGetValue(id, out var g) ? g.st : null;
        public int GuestCount => guests.Count;
        public bool IsRemote(Ctrl c) => remote.Contains(c.id);

        /// <summary>Humans per side: 1 in 1v1, everyone in 2v2/3v3, two in 5v5 (the AI fills the rest).</summary>
        public int Cap() => L.np == 1 ? 1 : L.np <= 3 ? L.np : 2;
        public int SideCount(int tm, string ex = null)
        {
            int n = 0;
            foreach (var s in L.slots) if (s.tm == tm && s.id != ex) n++;
            return n;
        }

        /// <summary>Presence of everyone: register guests, consume inputs/acks, handle joins, side requests and reconnects.</summary>
        void Peers(List<Peer> ps)
        {
            bool changed = false;
            var seen = new HashSet<string>();
            double tnow = now();
            foreach (var p in ps)
            {
                var st = p.state;
                if (p.me || st == null || st.Num("v", -1) != NetConst.PROTO || Json.Truthy(st.Get("H"))) continue;
                var code = st.Get("code");
                if (Json.Truthy(code) && !(code is string cs && cs == L.code)) continue;
                seen.Add(p.id);
                if (!guests.TryGetValue(p.id, out var g))
                {
                    var q0 = st.Arr("q");
                    g = new GuestRec { id = p.id, st = st, q = q0 != null && q0.Count > 0 ? Json.D(q0[0]) : 0, seen = tnow };
                    guests[p.id] = g;
                    order.Add(p.id);
                    changed = true;
                }
                if (!ReferenceEquals(g.st, st) || !Equals(g.st.Get("t"), st.Get("t"))) g.seen = tnow;
                g.st = st;
                g.ping = Json.Plus(st.Get("rt"), 0);
                if (double.IsNaN(g.ping)) g.ping = 0;
                g.D = Json.Plus(st.Get("D"), 0);
                if (!Json.Truthy(g.D)) g.D = 6;
                if (st.Get("zk") is double zk && (g.acks.Count == 0 || g.acks[g.acks.Count - 1] != zk))
                {
                    g.acks.Add(zk);
                    if (g.acks.Count > 48) g.acks.RemoveAt(0);
                }
                string tok = st.Str("tok");
                // Reconnect: a known token re-attaches to its slot under the new peer id.
                var s = L.Find(p.id);
                if (s == null && !string.IsNullOrEmpty(tok)) foreach (var x in L.slots) if (!string.IsNullOrEmpty(x.tok) && x.tok == tok && x.id != "host") { s = x; break; }
                if (s != null && s.id != p.id)
                {
                    s.id = p.id;
                    changed = true;
                }
                if (s != null && s.on == 0 && !(g.stale && tnow - g.seen > 6000))
                {
                    s.on = 1;
                    g.stale = false;
                    s.gone = null;
                    changed = true;
                    if (L.st == "game") RebuildCtrls();
                }
                double elo = Json.Plus(st.Get("elo"), 0);
                if (!Json.Truthy(elo)) elo = 1000;
                if (s != null && elo != s.elo)
                {
                    s.elo = elo;
                    changed = true;
                }
                // quick chat: one new message per presence update is plenty
                var qa = st.Arr("q");
                if (qa != null && qa.Count > 0 && Json.D(qa[0]) > g.q)
                {
                    g.q = Json.D(qa[0]);
                    if (s != null || L.st != "game") Chat(s != null ? s.id : p.id, qa.Count > 1 ? Util.I(Json.D(qa[1])) : 0);
                }
                // Side request (lobby only): tm 0/1 to sit, -1 to spectate.
                var wantO = st.Get("tm");
                double want = wantO is double wd ? wd : double.NaN;
                if (L.st == "lobby")
                {
                    if (s != null && want == -1)
                    {
                        L.slots.Remove(s);
                        s = null;
                        changed = true;
                    }
                    else if (want == 0 || want == 1)
                    {
                        if (s == null && SideCount((int)want) < Cap())
                        {
                            L.slots.Add(s = new Slot { id = p.id, tok = tok ?? "", n = Clean(st.Get("n")), tm = (int)want, rdy = 0, on = 1, elo = elo });
                            changed = true;
                        }
                        else if (s != null && s.tm != want && SideCount((int)want, s.id) < Cap())
                        {
                            s.tm = (int)want;
                            changed = true;
                        }
                    }
                    if (s != null)
                    {
                        int rd = Json.Truthy(st.Get("rdy")) ? 1 : 0;
                        string n = Clean(st.Get("n"));
                        if (s.rdy != rd || s.n != n)
                        {
                            s.rdy = rd;
                            s.n = n;
                            changed = true;
                        }
                    }
                }
                // Inputs: edge counters -> pending one-shot events.
                var I = Json.Nums(st.Get("I"));
                if (I != null && s != null)
                {
                    var w = Protocol.UnpackInput(I);
                    if (g.last == null || st.Num("gid", double.NaN) != L.gid) g.last = (double[])w.c.Clone();
                    else
                        for (int j = 0; j < Protocol.EDGES.Length; j++)
                            if (w.c[j] > g.last[j])
                            {
                                g.pend.Add(Protocol.EDGES[j]);
                                g.last[j] = w.c[j];
                            }
                    g.w = w;
                    foreach (var c in CT)
                        if (c.id == p.id)
                        {
                            c.tempo = Json.Truthy(st.Get("tmp")) ? 1 : 0;
                            c.lag = Math.Min(0.3, g.ping / 2000 + g.D / 60);
                            break;
                        }
                }
            }
            for (int i = order.Count - 1; i >= 0; i--)
            {
                string id = order[i];
                if (seen.Contains(id)) continue;
                guests.Remove(id);
                order.RemoveAt(i);
                var s = L.Find(id);
                if (s != null)
                {
                    if (L.st == "lobby") { s.on = 0; s.gone = tnow; } // (a blip: keep the seat for 15 s)
                    else
                    {
                        s.on = 0; // keep the seat for a reconnect; the AI plays it meanwhile
                        RebuildCtrls();
                    }
                }
                changed = true;
            }
            if (changed)
            {
                Pub(true);
                onChange?.Invoke();
            }
        }

        public void SetSide(int tm)
        {
            var s = L.Find("host");
            if (s != null && s.tm != tm && SideCount(tm, "host") < Cap()) s.tm = tm;
            me.tm = tm;
            Pub(true);
        }
        public void SetTeams(int i, int j)
        {
            L.teams = new[] { i, j };
            Pub(true);
        }
        /// <summary>k = "pro" | "ql" | "np".</summary>
        public void SetOpt(string k, int v)
        {
            if (k == "pro") L.pro = v;
            else if (k == "ql") L.ql = v;
            else if (k == "np") L.np = v;
            Pub(true);
        }

        // ---------------- tournament: a 1v1 bracket for 2-4 friends (everyone connected plays; one bye with three) ----------------
        public bool TourStart(double tempo = 0)
        {
            foreach (var id in order)
            {
                var g = guests[id];
                if (L.Find(g.id) == null)
                {
                    double e = Json.Plus(g.st.Get("elo"), 0);
                    L.slots.Add(new Slot { id = g.id, tok = g.st.Str("tok") ?? "", n = Clean(g.st.Get("n")), tm = -1, rdy = 1, on = 1, elo = Json.Truthy(e) ? e : 1000 });
                }
            }
            var ids = new List<string>();
            foreach (var s in L.slots) if (s.on != 0) ids.Add(s.id);
            // shuffle (Fisher-Yates)
            for (int i = ids.Count - 1; i > 0; i--)
            {
                int j = (int)(NetClock.Random01() * (i + 1));
                (ids[i], ids[j]) = (ids[j], ids[i]);
            }
            if (ids.Count > 4) ids.RemoveRange(4, ids.Count - 4);
            if (ids.Count < 2) return false;
            var tr = new Tour { ids = ids };
            foreach (var s in L.slots) tr.names[s.id] = s.n;
            if (ids.Count == 4) { tr.m.Add(new[] { ids[0], ids[1] }); tr.m.Add(new[] { ids[2], ids[3] }); }
            else tr.m.Add(new[] { ids[0], ids[1] });
            tr.bye = ids.Count == 3 ? ids[2] : null;
            L.tour = tr;
            TourPlay(tempo);
            return true;
        }
        /// <summary>Seat the current match (others watch) and start it.</summary>
        public void TourPlay(double tempo = 0)
        {
            var tr = L.tour;
            var ab = tr.m[tr.i];
            foreach (var s in L.slots) s.tm = s.id == ab[0] ? 0 : s.id == ab[1] ? 1 : -1;
            Start(tempo);
        }
        /// <summary>After a tournament game: record the winner, schedule the final, report whether another match follows.</summary>
        public bool TourResult()
        {
            var tr = L.tour;
            if (tr == null || tr.champ != null) return false;
            var ab = tr.m[tr.i];
            tr.w.Add(sc[0] >= sc[1] ? ab[0] : ab[1]);
            tr.i++;
            if (tr.ids.Count == 4 && tr.i == 2) tr.m.Add(new[] { tr.w[0], tr.w[1] });
            if (tr.ids.Count == 3 && tr.i == 1) tr.m.Add(new[] { tr.w[0], tr.bye });
            if (tr.i >= tr.m.Count) tr.champ = tr.w[tr.w.Count - 1];
            Pub(true);
            return tr.champ == null;
        }

        /// <summary>Every seat is ready AND every connected guest has decided (seated, or chose to watch).</summary>
        public bool CanStart()
        {
            foreach (var g in guests.Values)
            {
                var tm = g.st?.Get("tm");
                if (!(tm is double d && d == -1) && L.Find(g.id) == null) return false;
            }
            foreach (var s in L.slots) if (s.rdy == 0 && s.id != "host") return false;
            return true;
        }

        /// <summary>Seat every connected human as a controller; disconnected seats are played by the AI.</summary>
        public void RebuildCtrls()
        {
            var cs = new List<Ctrl>();
            foreach (var s in L.slots)
            {
                if (s.on == 0 || s.tm < 0) continue; // tournament spectators
                string cid = s.id == "host" ? "p1" : s.id;
                Ctrl c = null;
                foreach (var x in CT) if (x.id == cid) { c = x; break; }
                c ??= mkCtrl(cid, s.tm, false, 0);
                if (s.id != "host") remote.Add(cid);
                cs.Add(c);
            }
            setCtrls(cs);
        }

        public void Start(double tempo = 0)
        {
            cfg.ONLINE = 1;
            cfg.GM = "game";
            cfg.NP = L.np;
            cfg.PRO = L.pro;
            cfg.MYM = 0;
            setQtrLen(L.ql);
            setCtrls(new List<Ctrl>());
            RebuildCtrls();
            foreach (var c in CT) if (c.id == "p1") c.tempo = tempo;
            L.st = "game";
            L.gid++;
            double n = now();
            foreach (var g in guests.Values)
            {
                g.last = null;
                g.pend.Clear();
                g.acks.Clear();
                g.seen = n; // (a guest idle in the lobby isn't stale: give him time to load the game)
                g.stale = false;
            }
            hist.Clear();
            start(L.teams[0], new StartOpts { j = L.teams[1] });
            fxRing.Clear();
            fxSeen = FX.Count > 0 ? FX[FX.Count - 1].id : 0;
            k = 0;
            Pub(true);
        }

        /// <summary>Quick chat from a seat ("host" for the local player): relayed in the host presence.</summary>
        public void Chat(string who, int kk)
        {
            if (kk < 0 || kk >= CHAT.Length) return;
            Q.Add(new object[] { (double)(++qn), who, (double)kk });
            if (Q.Count > 6) Q.RemoveAt(0);
            Pub(false);
            onChat?.Invoke(who, kk);
        }

        /// <summary>Guests who asked for a rematch of the game that just ended: (votes, seated guests).</summary>
        public (int, int) RematchVotes()
        {
            int n = 0, m = 0;
            foreach (var g in guests.Values) if (g.st != null && g.st.Num("rm", -1) == L.gid && L.Find(g.id) != null) n++;
            foreach (var s in L.slots) if (s.id != "host" && s.on != 0) m++;
            return (n, m);
        }
        /// <summary>Same seats, same teams, straight into a new game.</summary>
        public void Rematch(double tempo = 0) => Start(tempo);

        public void BackToLobby()
        {
            L.st = "lobby";
            if (L.tour != null)
            {
                L.tour = null;
                L.tourNull = true;
                L.slots.RemoveAll(s => !(s.tm >= 0 || s.id == "host"));
                foreach (var s in L.slots) if (s.tm < 0) s.tm = 0;
            }
            foreach (var s in L.slots) if (s.id != "host") s.rdy = 0;
            setS("menu");
            Pub(true);
        }

        /// <summary>Build one controller input from a guest's latest presence. Called by the sim (cfg.input) for remote controllers.</summary>
        public Hoops.Core.Input RemoteInput(Ctrl c)
        {
            var i = new Hoops.Core.Input();
            if (!guests.TryGetValue(c.id, out var g) || g.w == null) return i;
            var w = g.w;
            i.dx = w.dx;
            i.dy = w.dy;
            i.sp = Util.T(w.sp);
            i.post = Util.T(w.post);
            g.ack = w.n;
            bool fired = false;
            int keep = 0;
            for (int j = 0; j < g.pend.Count; j++)
            {
                string e = g.pend[j];
                if (e == "su" && fired)
                {
                    g.pend[keep++] = e; // press and release in the same frame: release next tick
                    continue;
                }
                switch (e)
                {
                    case "sd":
                        i.sd = true;
                        fired = true;
                        if (w.tp >= 0) i.tp = w.tp / 1000;
                        break;
                    case "su":
                        i.su = true;
                        if (w.mt > 0) i.mt = w.mt / 1000;
                        break;
                    case "mv1": i.mv = 1; break;
                    case "mv2": i.mv = 2; break;
                    case "mv3": i.mv = 3; break;
                    case "skip": skipReplay(); break;
                    case "e": i.e = true; break;
                    case "sb": i.sb = true; break;
                    case "lob": i.lob = true; break;
                    case "sw": i.sw = true; break;
                    case "pf": i.pf = true; break;
                    case "to": i.to = true; break;
                    case "ch": i.ch = true; break;
                    case "ds": i.ds = true; break;
                }
            }
            g.pend.RemoveRange(keep, g.pend.Count - keep);
            return i;
        }

        /// <summary>In a game a guest's presence changes many times a second; 6 s of silence means his link is gone even
        /// if the room hasn't said so yet - the AI takes his seat until he's heard from again.</summary>
        public void StaleCheck(double n)
        {
            if (L.st != "game") return;
            bool ch = false;
            foreach (var g in guests.Values)
            {
                var s = L.Find(g.id);
                if (s == null) continue;
                bool stale = n - g.seen > 6000;
                if (stale && s.on != 0) { s.on = 0; g.stale = true; ch = true; }
                else if (!stale && s.on == 0 && g.stale) { s.on = 1; g.stale = false; ch = true; }
            }
            if (ch)
            {
                RebuildCtrls();
                Pub(true);
                onChange?.Invoke();
            }
        }

        /// <summary>After every sim tick: collect the sim's events, publish a snapshot every 2nd tick (30 Hz).</summary>
        public void Tick()
        {
            CollectFx();
            k++;
            if (k % 30 == 0) StaleCheck(now());
            if (k % 2 != 0) return;
            Pub(false);
        }

        void CollectFx()
        {
            foreach (var f in FX)
            {
                if (f.id <= fxSeen) continue;
                fxSeen = f.id;
                fxRing.Add(f);
            }
            if (fxRing.Count > 64) fxRing.RemoveRange(0, fxRing.Count - 64);
        }

        /// <summary>Delta baseline = newest snapshot every watching guest has confirmed; else -1 (full snapshot).</summary>
        int Base()
        {
            int best = -1;
            if (guests.Count == 0) return -1;
            foreach (var tk in hist.Keys)
            {
                if (tk <= best) continue;
                bool ok = true;
                foreach (var g in guests.Values)
                    if (Json.Truthy(g.st.Get("nf")) || !g.acks.Contains(tk))
                    {
                        ok = false;
                        break;
                    }
                if (ok) best = tk;
            }
            return best;
        }

        readonly List<int> drop = new List<int>();
        public void Pub(bool lobbyChanged)
        {
            var o = new Dictionary<string, object> { { "v", (double)NetConst.PROTO }, { "H", 1.0 }, { "n", me.n }, { "tok", me.tok }, { "code", L.code } };
            if (lobbyChanged || k % 60 == 0) o["L"] = L.ToJson();
            if (Q.Count > 0)
            {
                var ql = new List<object>();
                foreach (var x in Q) ql.Add(new List<object>(x));
                o["Q"] = ql;
            }
            if (L.st == "game" || L.st == "over")
            {
                if (S == "over" && L.st == "game")
                {
                    L.st = "over";
                    o["L"] = L.ToJson();
                }
                CollectFx();
                var full = Protocol.EncodeSnap(k);
                hist[k] = full;
                drop.Clear();
                foreach (var tk in hist.Keys) if (tk < k - 120) drop.Add(tk);
                foreach (var tk in drop) hist.Remove(tk);
                int b = Base();
                var d = b >= 0 ? Protocol.DeltaEnc(full, hist[b]) : null;
                o["Z"] = d != null && d.Count < full.Length
                    ? new Dictionary<string, object> { { "k", (double)k }, { "b", (double)b }, { "d", d } }
                    : new Dictionary<string, object> { { "k", (double)k }, { "f", full } };
                var A = new Dictionary<string, object>();
                var Pg = new Dictionary<string, object>();
                foreach (var id in order)
                {
                    var g = guests[id];
                    A[id] = g.ack;
                    Pg[id] = g.st.Get("t") is double tt ? tt : 0.0;
                }
                o["A"] = A;
                o["Pg"] = Pg;
                o["gid"] = (double)L.gid;
                var C = new List<object>();
                foreach (var c in CT) C.Add(new List<object> { c.id == "p1" ? "host" : c.id, (double)c.tm, (double)c.idx });
                o["C"] = C;
                var U = lineup(); // (subs: who is on the floor - guests swap in the same generated reserves)
                o["U"] = new List<object> { U[0], U[1] };
                if (k - lastBox >= 30 || S == "over")
                {
                    lastBox = k;
                    o["X"] = Protocol.EncodeBox();
                }
                // The merged presence (including the lobby object kept from earlier patches) must fit the 4 KiB limit.
                int n = 14;
                o["E"] = Protocol.EncodeFx(fxRing, n);
                int lobLen = o.ContainsKey("L") ? 0 : Json.Write(L.ToJson()).Length + 6;
                while (Json.Write(o).Length + lobLen > NetConst.PRESENCE_MAX && n > 0)
                {
                    if (o.ContainsKey("X") && n < 8) o.Remove("X");
                    o["E"] = Protocol.EncodeFx(fxRing, n -= 3);
                }
            }
            t.Presence(o);
        }

        public void Close()
        {
            unsub();
        }

        /// <summary>Player names on the wire: letters, digits, space, _ . - only; at most 14 UTF-16 units.</summary>
        public static string Clean(object v)
        {
            string s = v is string str ? str : v == null ? "Player" : Convert.ToString(v, CultureInfo.InvariantCulture);
            if (string.IsNullOrEmpty(s)) s = "Player";
            var sb = new StringBuilder();
            for (int i = 0; i < s.Length; i++)
            {
                char c = s[i];
                if (char.IsHighSurrogate(c) && i + 1 < s.Length && char.IsLowSurrogate(s[i + 1]))
                {
                    var cat = CharUnicodeInfo.GetUnicodeCategory(s, i);
                    if (IsLN(cat)) sb.Append(c).Append(s[i + 1]);
                    i++;
                    continue;
                }
                if (c == ' ' || c == '_' || c == '.' || c == '-' || IsLN(char.GetUnicodeCategory(c))) sb.Append(c);
            }
            var r = sb.Length > 14 ? sb.ToString(0, 14) : sb.ToString();
            return r.Length > 0 ? r : "Player";
        }
        static bool IsLN(UnicodeCategory c) =>
            c == UnicodeCategory.UppercaseLetter || c == UnicodeCategory.LowercaseLetter || c == UnicodeCategory.TitlecaseLetter || c == UnicodeCategory.ModifierLetter ||
            c == UnicodeCategory.OtherLetter || c == UnicodeCategory.DecimalDigitNumber || c == UnicodeCategory.LetterNumber || c == UnicodeCategory.OtherNumber;
    }
}
