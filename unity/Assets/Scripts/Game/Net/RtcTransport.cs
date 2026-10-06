// Direct path (NetOpts.Direct): a WebRTC data channel between each guest and the host, next to the room / relay.
//  - Signaling rides the existing presence: a temporary `rtc` field {peerId: [kind "o"|"a", session id, sdp]}; one
//    complete SDP each way (non-trickle ICE: the backend waits for gathering to finish; STUN stun.l.google.com:19302).
//    Guests offer to the host (the peer whose presence has H), the host answers (at most 2 pending answers at once so
//    the host presence stays under the 4 KiB room limit). The field is removed once the channel is open.
//  - Every presence update still goes to the room/relay (other peers, fallback) AND, when a channel is open, the whole
//    merged state goes over the channel (unordered, maxRetransmits 0). Every update carries a sequence number `sq`;
//    receivers keep the newest of the room/relay copy and the channel copy.
//  - A channel that fails, closes, or doesn't open within 10 s is dropped and retried after 5 s; meanwhile (and on
//    Wi-Fi with client isolation, where ICE never connects) everything simply flows over the room/relay.
// Pure C# (no UnityEngine); the WebRTC itself is an IRtcLink (the .jslib in WebGL, a fake in tests).
using System;
using System.Collections.Generic;

namespace Hoops.Game.Net
{
    public enum RtcEv { Sdp, Open, Message, Closed }

    /// <summary>One RTCPeerConnection + data channel "h2k" (unordered, maxRetransmits 0).</summary>
    public interface IRtcLink
    {
        /// <summary>Offerer: create the channel + offer; the complete local SDP comes back as RtcEv.Sdp.</summary>
        void CreateOffer();
        /// <summary>Answerer: take the remote offer, create the answer (RtcEv.Sdp when ICE gathering is complete).</summary>
        void AcceptOffer(string sdp);
        /// <summary>Offerer: take the remote answer.</summary>
        void AcceptAnswer(string sdp);
        void Send(string s);
        bool TryNext(out RtcEv ev, out string data);
        void Close();
    }

    public sealed class RtcTransport : ITransport, ILinkInfo
    {
        sealed class Link
        {
            public string peer, sid;
            public IRtcLink rtc;
            public bool offerer, open, sdpSent;
            public double startAt, lastRx;
            public Dictionary<string, object> best; // newest state received over the channel
        }

        public string Kind => "rtc+" + inner.Kind;
        public string Me => inner.Me;
        readonly ITransport inner;
        readonly Func<IRtcLink> mk;
        readonly Func<double> now;
        readonly Dictionary<string, Link> links = new Dictionary<string, Link>();
        readonly Dictionary<string, double> retryAt = new Dictionary<string, double>();
        readonly Dictionary<string, string> handled = new Dictionary<string, string>(); // host: offer session already answered per peer
        readonly Dictionary<string, object> mine = new Dictionary<string, object>();
        readonly Dictionary<string, object> sig = new Dictionary<string, object>(); // my rtc signaling entries
        readonly List<Action<List<Peer>>> subs = new List<Action<List<Peer>>>();
        List<Peer> basePeers = new List<Peer>(), list = new List<Peer>();
        double sq;
        int sidN;
        bool dirty;
        public int directMsgs, relayMsgs; // stats

        public RtcTransport(ITransport inner, Func<IRtcLink> mk, Func<double> now = null)
        {
            this.inner = inner;
            this.mk = mk;
            this.now = now ?? NetClock.Mono;
            sq = Math.Floor((now ?? NetClock.Wall)()); // (monotonic across reconnects of this page)
            inner.OnPeers(ps =>
            {
                basePeers = ps;
                relayMsgs++;
                Signal();
                Emit();
            });
        }

        bool IAmHost => Json.Truthy(mine.Get("H"));

        public string LinkOf(string peer) => links.TryGetValue(peer, out var l) && l.open ? "DIRECT" : "RELAY";
        public bool AllDirect()
        {
            int n = 0;
            foreach (var p in basePeers)
            {
                if (p.me) continue;
                if (!IsPartner(p)) continue;
                if (!(links.TryGetValue(p.id, out var l) && l.open)) return false;
                n++;
            }
            return n > 0;
        }
        /// <summary>A guest links to the host only; the host links to every peer that offers.</summary>
        bool IsPartner(Peer p) => IAmHost ? links.ContainsKey(p.id) || Json.Truthy(p.state.Get("v")) : Json.Truthy(p.state?.Get("H"));

        public List<Peer> Peers() => list;
        public Action OnPeers(Action<List<Peer>> fn)
        {
            subs.Add(fn);
            if (list.Count > 0) fn(list);
            return () => subs.Remove(fn);
        }

        /// <summary>Peer list with each state = the newest of the relay copy and the channel copy (by `sq`).</summary>
        void Emit()
        {
            var a = new List<Peer>(basePeers.Count);
            foreach (var p in basePeers)
            {
                var st = p.state;
                if (p.me) st = mine;
                else if (links.TryGetValue(p.id, out var l) && l.best != null && l.best.Num("sq", -1) > (st?.Num("sq", -1) ?? -1)) st = l.best;
                a.Add(new Peer { id = p.id, me = p.me, state = st });
            }
            list = a;
            for (int i = 0; i < subs.Count; i++) subs[i](a);
        }

        public void Presence(Dictionary<string, object> patch)
        {
            patch["sq"] = ++sq;
            foreach (var kv in patch)
            {
                if (ReferenceEquals(kv.Value, Json.Undefined)) continue;
                if (kv.Value == null) mine.Remove(kv.Key);
                else mine[kv.Key] = kv.Value;
            }
            inner.Presence(patch);
            dirty = true;
        }

        void SendDirect()
        {
            dirty = false;
            string s = null;
            foreach (var l in links.Values)
            {
                if (!l.open) continue;
                s ??= Json.Write(mine);
                try { l.rtc.Send(s); } catch (Exception) { }
            }
        }

        string NewSid() => (++sidN).ToString() + "-" + ((long)(NetClock.Random01() * 1e9)).ToString();

        void SetSig(string peer, object v)
        {
            if (v == null) { if (!sig.Remove(peer)) return; }
            else sig[peer] = v;
            Presence(new Dictionary<string, object> { { "rtc", sig.Count > 0 ? new Dictionary<string, object>(sig) : null } });
        }

        static List<object> SigFor(Peer p, string me) => p.state?.Obj("rtc")?.Get(me) as List<object>;

        /// <summary>Signaling: start offers (guest), answer offers (host), apply answers (guest).</summary>
        void Signal()
        {
            if (!NetOpts.Direct || string.IsNullOrEmpty(Me)) return;
            double t = now();
            var here = new HashSet<string>();
            foreach (var p in basePeers)
            {
                if (p.me || p.state == null) continue;
                here.Add(p.id);
                var s = SigFor(p, Me);
                if (IAmHost)
                {
                    // answer a new offer (one session per peer; a new session id replaces the old link)
                    if (s != null && s.Count >= 3 && s[0] as string == "o" && s[1] is string sid && s[2] is string sdp)
                    {
                        if (handled.TryGetValue(p.id, out var hs) && hs == sid) continue;
                        int pending = 0;
                        foreach (var l in links.Values) if (!l.open) pending++;
                        if (pending >= 2) continue; // (later: keeps the host presence small)
                        handled[p.id] = sid;
                        Drop(p.id, false);
                        var nl = new Link { peer = p.id, sid = sid, rtc = mk(), offerer = false, startAt = t };
                        links[p.id] = nl;
                        try { nl.rtc.AcceptOffer(Sdp.Expand(sdp)); } catch (Exception) { Drop(p.id, true); }
                    }
                }
                else if (Json.Truthy(p.state.Get("H")))
                {
                    if (links.TryGetValue(p.id, out var l))
                    {
                        if (!l.open && l.offerer && s != null && s.Count >= 3 && s[0] as string == "a" && s[1] as string == l.sid && s[2] is string ans && l.sdpSent)
                        {
                            l.sdpSent = false; // (answer applied once)
                            try { l.rtc.AcceptAnswer(Sdp.Expand(ans)); } catch (Exception) { Drop(p.id, true); }
                        }
                    }
                    else if (!retryAt.TryGetValue(p.id, out var ra) || t >= ra)
                    {
                        var nl = new Link { peer = p.id, sid = NewSid(), rtc = mk(), offerer = true, startAt = t };
                        links[p.id] = nl;
                        try { nl.rtc.CreateOffer(); } catch (Exception) { Drop(p.id, true); }
                    }
                }
            }
            // peers that left the room: close their links
            List<string> gone = null;
            foreach (var id in links.Keys) if (!here.Contains(id)) (gone ??= new List<string>()).Add(id);
            if (gone != null) foreach (var id in gone) Drop(id, false);
        }

        void Drop(string peer, bool retry)
        {
            if (links.TryGetValue(peer, out var l))
            {
                links.Remove(peer);
                try { l.rtc.Close(); } catch (Exception) { }
            }
            if (retry) retryAt[peer] = now() + 5000;
            if (sig.ContainsKey(peer)) SetSig(peer, null);
        }

        public void Poll()
        {
            inner.Poll();
            double t = now();
            bool emit = false;
            List<string> drop = null;
            foreach (var l in links.Values)
            {
                while (l.rtc.TryNext(out var ev, out var data))
                {
                    if (ev == RtcEv.Sdp)
                    {
                        // complete local description: publish it through the presence
                        l.sdpSent = true;
                        SetSig(l.peer, new List<object> { l.offerer ? "o" : "a", l.sid, Sdp.Compact(data) });
                    }
                    else if (ev == RtcEv.Open)
                    {
                        l.open = true;
                        l.lastRx = t;
                        if (sig.ContainsKey(l.peer)) SetSig(l.peer, null);
                        dirty = true;
                        emit = true;
                    }
                    else if (ev == RtcEv.Message)
                    {
                        l.lastRx = t;
                        if (Json.TryParse(data, out var v) && v is Dictionary<string, object> st && st.Num("sq", -1) > (l.best?.Num("sq", -1) ?? -1))
                        {
                            l.best = st;
                            directMsgs++;
                            emit = true;
                        }
                    }
                    else if (ev == RtcEv.Closed)
                    {
                        (drop ??= new List<string>()).Add(l.peer);
                        break;
                    }
                }
                // never opened in 10 s (client isolation, symmetric NAT without TURN), or silent 6 s: back to the relay
                if (!l.open && t - l.startAt > 10000) (drop ??= new List<string>()).Add(l.peer);
                else if (l.open && t - l.lastRx > 6000) (drop ??= new List<string>()).Add(l.peer);
            }
            if (drop != null)
            {
                foreach (var id in drop) Drop(id, true);
                emit = true;
            }
            if (dirty) SendDirect();
            if (emit) Emit();
        }

        public bool Connected() => inner.Connected();

        public void Leave()
        {
            foreach (var l in links.Values) try { l.rtc.Close(); } catch (Exception) { }
            links.Clear();
            inner.Leave();
        }
    }

    /// <summary>Compact SDP for the presence: drop lines a data-channel-only session doesn't need and join the rest
    /// with '\n' (Expand restores CRLF).</summary>
    public static class Sdp
    {
        static readonly string[] DROP = { "a=extmap-allow-mixed", "a=msid-semantic", "a=ice-options:trickle" };
        public static string Compact(string sdp)
        {
            if (sdp == null) return "";
            var sb = new System.Text.StringBuilder(sdp.Length);
            foreach (var raw in sdp.Split('\n'))
            {
                var ln = raw.TrimEnd('\r');
                if (ln.Length == 0) continue;
                bool skip = false;
                foreach (var d in DROP) if (ln.StartsWith(d, StringComparison.Ordinal)) { skip = true; break; }
                if (skip) continue;
                sb.Append(ln).Append('\n');
            }
            return sb.ToString();
        }
        public static string Expand(string c) => c == null ? "" : c.Replace("\r\n", "\n").Replace("\n", "\r\n");
    }
}
