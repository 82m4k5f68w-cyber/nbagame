// Transport abstraction for online play (port of src/net/transport.ts). Every peer publishes ONE latest-state object
// ("presence"); receivers always get the newest merged object per peer. Intermediate states may be dropped
// (sender-side coalescing ~30 Hz), so everything sent must be absolute state, never deltas without a baseline.
// Implementations: claude.ai room capability (RoomTransport over the WebGL .jslib), WebSocket relay (WsTransport over
// a .NET ClientWebSocket or the .jslib socket), in-memory relay (tests). Pure C#: no UnityEngine.
//
// Threading: nothing here is thread-safe. Socket backends queue what they receive; the owner calls Poll() once per
// frame on the main thread and every callback (onPeers) runs from inside Poll().
using System;
using System.Collections.Generic;
using System.Diagnostics;

namespace Hoops.Game.Net
{
    public sealed class Peer
    {
        public string id;
        public bool me;
        public Dictionary<string, object> state;
    }

    public interface ITransport
    {
        string Kind { get; }
        string Me { get; }
        List<Peer> Peers();
        /// <summary>Called when anyone's presence changes (and on join/leave). Returns an unsubscribe action.</summary>
        Action OnPeers(Action<List<Peer>> fn);
        /// <summary>Merge a patch into MY presence (a null value removes a field).</summary>
        void Presence(Dictionary<string, object> patch);
        bool Connected();
        void Leave();
        /// <summary>Main-thread pump: deliver received messages, run timers (pacing, heartbeats, reconnects).</summary>
        void Poll();
    }

    /// <summary>Optional: which path carries a peer's presence (RtcTransport).</summary>
    public interface ILinkInfo
    {
        /// <summary>"DIRECT" (WebRTC data channel open) or "RELAY" (room / relay only).</summary>
        string LinkOf(string peer);
        /// <summary>Every remote peer has an open direct channel (and there is at least one).</summary>
        bool AllDirect();
    }

    /// <summary>Online improvements beyond the browser's PROTO 10 behaviour. Each is a flag (false = the faithful port).
    /// All of them stay wire-compatible with browser peers: new presence fields are optional and ignored there.</summary>
    public static class NetOpts
    {
        /// <summary>WebRTC data channel guest &lt;-&gt; host next to the room/relay (RtcTransport), retried every 5 s.</summary>
        public static bool Direct = true;
        /// <summary>Interpolation delay = smallest delay that keeps late snapshots under 2% (measured lateness p98).</summary>
        public static bool AdaptiveDelay = true;
        /// <summary>Guests send their last 3 input ticks ("Ir"); the host plays them in order, one per tick.</summary>
        public static bool InputRedundancy = true;
        /// <summary>Host publishes every tick (60 Hz) when every guest has a direct channel (30 Hz on the relay).</summary>
        public static bool Fast60 = true;
        /// <summary>Mispredictions are corrected over ~120 ms with a decaying render offset (snap only above 40 px).</summary>
        public static bool SmoothCorrection = true;
        /// <summary>Lag compensation rewind (RTT/2 + the guest's interpolation delay: what he actually saw) capped at 150 ms
        /// (was 300 ms). Used for shot contests (Core contestRaw via ctrl.lag / LAGBUF); the Core has no pass interceptions
        /// (a pass is catchable only by its target, steals are off by design), so there is nothing else to rewind.</summary>
        public static bool LagCap150 = true;
        /// <summary>Host migration lite: when the host leaves mid-game the longest-seated guest takes over.</summary>
        public static bool Migration = true;
        /// <summary>Host starts the rematch by itself once every seated guest asked for one.</summary>
        public static bool AutoRematch = true;
        /// <summary>Seconds without the host before a guest takes over.</summary>
        public static double MigrateAfter = 3;
    }

    public static class NetConst
    {
        public const int PROTO = 10;
        /// <summary>Presence objects must stay under ~4 KiB of JSON (room capability limit).</summary>
        public const int PRESENCE_MAX = 3900;
    }

    /// <summary>Clocks: wall time (Date.now) and a monotonic one (performance.now), both in ms. Tests swap in a simulated clock.</summary>
    public static class NetClock
    {
        static readonly Stopwatch sw = Stopwatch.StartNew();
        static readonly double epoch0 = (DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
        /// <summary>Wall clock in ms (Date.now()).</summary>
        public static Func<double> Wall = () => epoch0 + sw.Elapsed.TotalMilliseconds;
        /// <summary>Monotonic clock in ms (performance.now()).</summary>
        public static Func<double> Mono = () => sw.Elapsed.TotalMilliseconds;
        static readonly Random rnd = new Random();
        public static Func<double> Random01 = () => rnd.NextDouble();
    }
}
