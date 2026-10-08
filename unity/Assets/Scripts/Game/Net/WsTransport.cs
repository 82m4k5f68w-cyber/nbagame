// WebSocket transport to the Hoops relay (port of src/net/ws.ts; server/relay.ts protocol). Same presence semantics as
// the claude.ai room: each peer keeps one merged state object; sends are coalesced to ~30 Hz; reconnects keep the peer
// id; heartbeat ping every 2 s, a socket silent for 6 s is replaced; reconnect backoff 0.5 .. 5 s; garbled frames are
// ignored. The socket itself is pluggable (IWsSocket): .NET ClientWebSocket (Editor / desktop), the .jslib socket
// (WebGL), or an in-memory relay (tests). Pure C# (no UnityEngine). Everything runs from Poll() on the main thread.
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Hoops.Game.Net
{
    public enum WsEv { Open, Message, Close, Error }

    /// <summary>A text WebSocket. Events are queued by the implementation and drained on the main thread.</summary>
    public interface IWsSocket
    {
        /// <summary>0 connecting, 1 open, 2 closing, 3 closed (like WebSocket.readyState).</summary>
        int State { get; }
        void Send(string s);
        void Close();
        bool TryNext(out WsEv ev, out string data);
    }

    public sealed class WsTransport : ITransport
    {
        public string Kind => "ws";
        public string Me { get; private set; } = "";
        readonly string url, room;
        readonly Func<string, IWsSocket> open;
        readonly Func<double> now;
        IWsSocket ws;
        readonly Dictionary<string, Dictionary<string, object>> st = new Dictionary<string, Dictionary<string, object>>();
        readonly List<string> stOrder = new List<string>();
        readonly Dictionary<string, object> mine = new Dictionary<string, object>();
        Dictionary<string, object> pend;
        double lastSend, flushAt = -1, lastMsg, nextBeat = -1, reconnectAt = -1;
        readonly List<Action<List<Peer>>> subs = new List<Action<List<Peer>>>();
        bool isOpen, closed, everOpen;
        List<Peer> list = new List<Peer>();
        int tries;
        /// <summary>Optional: raw relay frames for features layered on top (none in PROTO 10).</summary>
        public Action<Dictionary<string, object>> onRaw;

        public WsTransport(string url, string room, Func<string, IWsSocket> open, Func<double> now = null)
        {
            this.url = url;
            this.room = room;
            this.open = open;
            this.now = now ?? NetClock.Mono;
        }

        /// <summary>Open the socket (the join is sent once it opens). Poll() until Connected().</summary>
        public WsTransport Connect()
        {
            lastMsg = now();
            ws = open(url);
            return this;
        }

        public bool EverConnected => everOpen;

        public void Poll()
        {
            double t = now();
            var s = ws;
            if (s != null)
                while (s.TryNext(out var ev, out var data))
                {
                    if (s != ws) break;
                    switch (ev)
                    {
                        case WsEv.Open:
                            lastMsg = t;
                            var j = new Dictionary<string, object> { { "t", "join" }, { "room", room } };
                            if (!string.IsNullOrEmpty(Me)) j["id"] = Me;
                            s.Send(Json.Write(j));
                            break;
                        case WsEv.Message:
                            lastMsg = t;
                            OnMessage(data);
                            break;
                        case WsEv.Error:
                        case WsEv.Close:
                            if (!isOpen && ev == WsEv.Error) break; // (a close follows)
                            Dropped(t);
                            break;
                    }
                }
            // reconnect with backoff
            if (reconnectAt >= 0 && t >= reconnectAt && !closed)
            {
                reconnectAt = -1;
                Connect();
            }
            // heartbeat
            if (isOpen && nextBeat >= 0 && t >= nextBeat)
            {
                nextBeat = t + 2000;
                if (ws != null && ws.State == 1)
                {
                    if (t - lastMsg > 6000)
                    {
                        isOpen = false;
                        Emit();
                        try { ws.Close(); } catch (Exception) { }
                        ws = null;
                        Connect();
                    }
                    else
                        try { ws.Send("{\"t\":\"ping\"}"); } catch (Exception) { }
                }
            }
            else if (!isOpen && ws != null && ws.State == 3 && reconnectAt < 0 && !closed) Dropped(t);
            // a connecting socket that never opens (half-open network): give up after 6 s and retry
            if (!isOpen && ws != null && ws.State == 0 && t - lastMsg > 6000 && !closed)
            {
                try { ws.Close(); } catch (Exception) { }
                ws = null;
                reconnectAt = t + Math.Min(5000, 500 * Math.Pow(2, tries++));
            }
            if (flushAt >= 0 && t >= flushAt) Flush();
        }

        void Dropped(double t)
        {
            var s = ws;
            ws = null;
            try { s?.Close(); } catch (Exception) { }
            bool was = isOpen;
            isOpen = false;
            if (was) Emit();
            // reconnect with backoff: 0.5 s, 1, 2, 4 ... capped at 5 s; the relay keeps our peer id when it can
            if (!closed && reconnectAt < 0) reconnectAt = t + Math.Min(5000, 500 * Math.Pow(2, tries++));
        }

        void OnMessage(string raw)
        {
            if (!Json.TryParse(raw, out var v) || !(v is Dictionary<string, object> d)) return; // (a garbled frame never takes the client down)
            switch (d.Str("t"))
            {
                case "hello":
                    Me = d.Str("me") ?? "";
                    isOpen = true;
                    everOpen = true;
                    tries = 0;
                    nextBeat = now() + 2000;
                    st.Clear();
                    stOrder.Clear();
                    if (d.Arr("peers") is List<object> ps)
                        foreach (var po in ps)
                            if (po is Dictionary<string, object> p && p.Str("id") is string id)
                                Set(id, p.Obj("state") ?? new Dictionary<string, object>());
                    if (mine.Count > 0) Send(new Dictionary<string, object>(mine)); // re-assert after reconnect
                    Emit();
                    break;
                case "p":
                    if (d.Str("id") is string pid) { Set(pid, d.Obj("state") ?? new Dictionary<string, object>()); Emit(); }
                    break;
                case "left":
                    if (d.Str("id") is string lid) { st.Remove(lid); stOrder.Remove(lid); Emit(); }
                    break;
                case "pong": break;
                default: onRaw?.Invoke(d); break;
            }
        }

        void Set(string id, Dictionary<string, object> s)
        {
            if (!st.ContainsKey(id)) stOrder.Add(id);
            st[id] = s;
        }

        void Emit()
        {
            var a = new List<Peer> { new Peer { id = Me, me = true, state = mine } };
            foreach (var id in stOrder) if (id != Me) a.Add(new Peer { id = id, me = false, state = st[id] });
            list = a;
            for (int i = 0; i < subs.Count; i++) subs[i](a);
        }

        public List<Peer> Peers() => list;

        public Action OnPeers(Action<List<Peer>> fn)
        {
            subs.Add(fn);
            if (list.Count > 0) fn(list);
            return () => subs.Remove(fn);
        }

        public void Presence(Dictionary<string, object> patch)
        {
            pend ??= new Dictionary<string, object>();
            foreach (var kv in patch)
            {
                if (ReferenceEquals(kv.Value, Json.Undefined)) continue;
                if (kv.Value == null) mine.Remove(kv.Key);
                else mine[kv.Key] = kv.Value;
                pend[kv.Key] = kv.Value;
            }
            double t = now(), wait = 33 - (t - lastSend);
            if (wait <= 0) Flush();
            else if (flushAt < 0) flushAt = t + wait;
        }

        void Flush()
        {
            flushAt = -1;
            if (pend == null) return;
            Send(pend);
            pend = null;
            lastSend = now();
        }

        void Send(Dictionary<string, object> patch)
        {
            if (ws != null && isOpen)
                try { ws.Send(Json.Write(new Dictionary<string, object> { { "t", "p" }, { "patch", patch } })); }
                catch (Exception) { } // (closing socket: the reconnect re-asserts everything)
        }

        /// <summary>Send a raw relay frame (e.g. {t:"host", code}).</summary>
        public void SendRaw(Dictionary<string, object> m)
        {
            if (ws != null && isOpen) try { ws.Send(Json.Write(m)); } catch (Exception) { }
        }

        public bool Connected() => isOpen;

        /// <summary>Ask the relay to start a dedicated authoritative host for this room code.</summary>
        public void RequestHost(string code) => SendRaw(new Dictionary<string, object> { { "t", "host" }, { "code", code } });

        public void Leave()
        {
            closed = true;
            try { ws?.Close(); } catch (Exception) { }
        }
    }

    /// <summary>IWsSocket over System.Net.WebSockets.ClientWebSocket (Editor, desktop, server; not WebGL). Receives on
    /// a background task into a queue; sends are serialized on another.</summary>
    public sealed class DotNetWsSocket : IWsSocket
    {
        readonly ClientWebSocket ws = new ClientWebSocket();
        readonly ConcurrentQueue<(WsEv, string)> q = new ConcurrentQueue<(WsEv, string)>();
        readonly BlockingCollection<string> outq = new BlockingCollection<string>();
        readonly CancellationTokenSource cts = new CancellationTokenSource();
        volatile int state;

        public DotNetWsSocket(string url)
        {
            Task.Run(async () =>
            {
                try
                {
                    await ws.ConnectAsync(new Uri(url), cts.Token);
                    state = 1;
                    q.Enqueue((WsEv.Open, null));
                    _ = Task.Run(SendLoop);
                    var buf = new byte[64 * 1024];
                    var sb = new StringBuilder();
                    while (ws.State == WebSocketState.Open)
                    {
                        var r = await ws.ReceiveAsync(new ArraySegment<byte>(buf), cts.Token);
                        if (r.MessageType == WebSocketMessageType.Close) break;
                        sb.Append(Encoding.UTF8.GetString(buf, 0, r.Count));
                        if (r.EndOfMessage)
                        {
                            q.Enqueue((WsEv.Message, sb.ToString()));
                            sb.Clear();
                        }
                    }
                }
                catch (Exception e)
                {
                    q.Enqueue((WsEv.Error, e.Message));
                }
                state = 3;
                q.Enqueue((WsEv.Close, null));
            });
        }

        async Task SendLoop()
        {
            try
            {
                foreach (var s in outq.GetConsumingEnumerable(cts.Token))
                {
                    var b = Encoding.UTF8.GetBytes(s);
                    await ws.SendAsync(new ArraySegment<byte>(b), WebSocketMessageType.Text, true, cts.Token);
                }
            }
            catch (Exception) { }
        }

        public int State => state;
        public void Send(string s)
        {
            if (state == 1) outq.Add(s);
        }
        public void Close()
        {
            if (state >= 2) return;
            state = 2;
            try { cts.Cancel(); } catch (Exception) { }
            try { ws.Abort(); } catch (Exception) { }
        }
        public bool TryNext(out WsEv ev, out string data)
        {
            if (q.TryDequeue(out var e)) { ev = e.Item1; data = e.Item2; return true; }
            ev = default; data = null;
            return false;
        }
    }
}
