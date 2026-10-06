// Unity glue for online play in WebGL builds: C# side of Assets/Plugins/WebGL/HoopsNet.jslib. The page's JavaScript
// queues every event (room joined / peers / presence results, WebSocket open / message / close, WebRTC sdp / open /
// message / close); JsBridge.Poll() drains them once per frame (one JSON array) and hands them to the objects below,
// which implement the pure-C# seams: IRoomConn (RoomTransport), IWsSocket (WsTransport), IRtcLink (RtcTransport).
// Outside WebGL the extern calls are stubbed (the Editor / desktop use DotNetWsSocket and no room / WebRTC).
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace Hoops.Game.Net
{
    public static class JsBridge
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] static extern void HN_Detect();
        [DllImport("__Internal")] static extern string HN_WsUrl();
        [DllImport("__Internal")] static extern int HN_HasRtc();
        [DllImport("__Internal")] static extern string HN_Poll();
        [DllImport("__Internal")] internal static extern int HN_RoomJoin(string name);
        [DllImport("__Internal")] internal static extern void HN_RoomPresence(int h, string json, int seq);
        [DllImport("__Internal")] internal static extern int HN_RoomConnected(int h);
        [DllImport("__Internal")] internal static extern void HN_RoomLeave(int h);
        [DllImport("__Internal")] internal static extern int HN_WsOpen(string url);
        [DllImport("__Internal")] internal static extern void HN_WsSend(int h, string s);
        [DllImport("__Internal")] internal static extern void HN_WsClose(int h);
        [DllImport("__Internal")] internal static extern int HN_WsState(int h);
        [DllImport("__Internal")] internal static extern int HN_RtcNew();
        [DllImport("__Internal")] internal static extern void HN_RtcOffer(int h);
        [DllImport("__Internal")] internal static extern void HN_RtcAnswer(int h, string sdp);
        [DllImport("__Internal")] internal static extern void HN_RtcAccept(int h, string sdp);
        [DllImport("__Internal")] internal static extern void HN_RtcSend(int h, string s);
        [DllImport("__Internal")] internal static extern void HN_RtcClose(int h);
        public const bool WebGL = true;
#else
        static void HN_Detect() => detectKind = "";
        static string HN_WsUrl() => "";
        static int HN_HasRtc() => 0;
        static string HN_Poll() => null;
        internal static int HN_RoomJoin(string name) => -1;
        internal static void HN_RoomPresence(int h, string json, int seq) { }
        internal static int HN_RoomConnected(int h) => 0;
        internal static void HN_RoomLeave(int h) { }
        internal static int HN_WsOpen(string url) => -1;
        internal static void HN_WsSend(int h, string s) { }
        internal static void HN_WsClose(int h) { }
        internal static int HN_WsState(int h) => 3;
        internal static int HN_RtcNew() => -1;
        internal static void HN_RtcOffer(int h) { }
        internal static void HN_RtcAnswer(int h, string sdp) { }
        internal static void HN_RtcAccept(int h, string sdp) { }
        internal static void HN_RtcSend(int h, string s) { }
        internal static void HN_RtcClose(int h) { }
        public const bool WebGL = false;
#endif
        static string detectKind; // null = still detecting, "" = no backend, "room" | "ws"
        static bool detecting;
        internal static readonly Dictionary<int, JsRoomConn> rooms = new Dictionary<int, JsRoomConn>();
        internal static readonly Dictionary<int, JsWsSocket> socks = new Dictionary<int, JsWsSocket>();
        internal static readonly Dictionary<int, JsRtcLink> rtcs = new Dictionary<int, JsRtcLink>();

        /// <summary>Which backend the page offers: null while detecting, "" none, "room" (claude.ai), "ws" (relay).</summary>
        public static string Detect()
        {
            if (!detecting) { detecting = true; HN_Detect(); }
            return detectKind;
        }
        /// <summary>The relay URL the page implies (?ws=..., or /ws on the page's own host), "" none.</summary>
        public static string PageWsUrl() => HN_WsUrl() ?? "";
        public static bool HasRtc => HN_HasRtc() != 0;

        /// <summary>Drain the page's event queue (call once per frame, before the transports' Poll).</summary>
        public static void Poll()
        {
            string s = HN_Poll();
            if (string.IsNullOrEmpty(s) || !Json.TryParse(s, out var v) || !(v is List<object> evs)) return;
            foreach (var eo in evs)
            {
                if (!(eo is Dictionary<string, object> e)) continue;
                int h = (int)e.Num("h", -1);
                switch (e.Str("e"))
                {
                    case "detect": detectKind = e.Str("kind") ?? ""; break;
                    case "room": if (rooms.TryGetValue(h, out var r)) r.On(e); break;
                    case "ws": if (socks.TryGetValue(h, out var w)) w.On(e); break;
                    case "rtc": if (rtcs.TryGetValue(h, out var c)) c.On(e); break;
                }
            }
        }
    }

    /// <summary>A claude.ai room joined through the page (`window.claude.use("room").join(name)`).</summary>
    public sealed class JsRoomConn : IRoomConn
    {
        readonly int h;
        bool joined, failed;
        List<Peer> peers = new List<Peer>();
        readonly Dictionary<string, Dictionary<string, object>> states = new Dictionary<string, Dictionary<string, object>>();
        readonly Dictionary<int, Action<bool, string>> pend = new Dictionary<int, Action<bool, string>>();
        int seq;
        Action<List<Peer>> fn;
        public Action onJoined;
        public Action<string> onFail;

        public JsRoomConn(string name)
        {
            h = JsBridge.HN_RoomJoin(name);
            JsBridge.rooms[h] = this;
        }

        internal void On(Dictionary<string, object> e)
        {
            switch (e.Str("k"))
            {
                case "joined": joined = true; onJoined?.Invoke(); break;
                case "fail": failed = true; onFail?.Invoke(e.Str("d") ?? "join failed"); break;
                case "pres":
                    int s = (int)e.Num("seq");
                    if (pend.TryGetValue(s, out var done)) { pend.Remove(s); done(e.Num("ok") != 0, e.Str("d")); }
                    break;
                case "peers":
                    var l = new List<Peer>();
                    var seen = new HashSet<string>();
                    if (e.Arr("d") is List<object> d)
                        foreach (var po in d)
                        {
                            if (!(po is Dictionary<string, object> p) || !(p.Str("id") is string id)) continue;
                            seen.Add(id);
                            if (!(Json.Truthy(p.Get("same")) && states.TryGetValue(id, out var st))) states[id] = st = p.Obj("st") ?? new Dictionary<string, object>();
                            l.Add(new Peer { id = id, me = Json.Truthy(p.Get("me")), state = st });
                        }
                    var gone = new List<string>();
                    foreach (var k in states.Keys) if (!seen.Contains(k)) gone.Add(k);
                    foreach (var k in gone) states.Remove(k);
                    peers = l;
                    fn?.Invoke(l);
                    break;
            }
        }

        public List<Peer> Peers() => peers;
        public void SetListener(Action<List<Peer>> f) => fn = f;
        public void Presence(Dictionary<string, object> patch, Action<bool, string> done)
        {
            if (!joined) { done(false, failed ? "join failed" : "joining"); return; }
            pend[++seq] = done;
            JsBridge.HN_RoomPresence(h, Json.Write(patch), seq);
        }
        public bool Connected() => joined && JsBridge.HN_RoomConnected(h) != 0;
        public void Leave()
        {
            JsBridge.HN_RoomLeave(h);
            JsBridge.rooms.Remove(h);
            // (pending presence calls on a left room never complete: fail them so RoomTransport isn't stuck busy)
            var p = new List<Action<bool, string>>(pend.Values);
            pend.Clear();
            foreach (var d in p) d(false, "left");
        }
        public void Poll() { }
    }

    /// <summary>A browser WebSocket (to server/relay.ts) through the page.</summary>
    public sealed class JsWsSocket : IWsSocket
    {
        readonly int h;
        readonly Queue<(WsEv, string)> q = new Queue<(WsEv, string)>();
        bool closed;
        public JsWsSocket(string url)
        {
            h = JsBridge.HN_WsOpen(url);
            JsBridge.socks[h] = this;
        }
        internal void On(Dictionary<string, object> e)
        {
            switch (e.Str("k"))
            {
                case "open": q.Enqueue((WsEv.Open, null)); break;
                case "msg": q.Enqueue((WsEv.Message, e.Str("d"))); break;
                case "err": q.Enqueue((WsEv.Error, null)); break;
                case "close": closed = true; q.Enqueue((WsEv.Close, null)); JsBridge.socks.Remove(h); break;
            }
        }
        public int State => closed ? 3 : JsBridge.HN_WsState(h);
        public void Send(string s) => JsBridge.HN_WsSend(h, s);
        public void Close() { closed = true; JsBridge.HN_WsClose(h); JsBridge.socks.Remove(h); }
        public bool TryNext(out WsEv ev, out string data)
        {
            if (q.Count > 0) { (ev, data) = q.Dequeue(); return true; }
            ev = default; data = null;
            return false;
        }
    }

    /// <summary>An RTCPeerConnection + unreliable data channel through the page.</summary>
    public sealed class JsRtcLink : IRtcLink
    {
        readonly int h;
        readonly Queue<(RtcEv, string)> q = new Queue<(RtcEv, string)>();
        public JsRtcLink()
        {
            h = JsBridge.HN_RtcNew();
            JsBridge.rtcs[h] = this;
        }
        internal void On(Dictionary<string, object> e)
        {
            switch (e.Str("k"))
            {
                case "sdp": q.Enqueue((RtcEv.Sdp, e.Str("d"))); break;
                case "open": q.Enqueue((RtcEv.Open, null)); break;
                case "msg": q.Enqueue((RtcEv.Message, e.Str("d"))); break;
                case "close": q.Enqueue((RtcEv.Closed, e.Str("d"))); break;
            }
        }
        public void CreateOffer() => JsBridge.HN_RtcOffer(h);
        public void AcceptOffer(string sdp) => JsBridge.HN_RtcAnswer(h, sdp);
        public void AcceptAnswer(string sdp) => JsBridge.HN_RtcAccept(h, sdp);
        public void Send(string s) => JsBridge.HN_RtcSend(h, s);
        public void Close() { JsBridge.HN_RtcClose(h); JsBridge.rtcs.Remove(h); }
        public bool TryNext(out RtcEv ev, out string data)
        {
            if (q.Count > 0) { (ev, data) = q.Dequeue(); return true; }
            ev = default; data = null;
            return false;
        }
    }
}
