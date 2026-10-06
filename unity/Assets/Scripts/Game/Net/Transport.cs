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
