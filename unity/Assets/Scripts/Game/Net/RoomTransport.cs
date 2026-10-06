// The claude.ai room capability as a transport (port of src/client/net/room.ts RoomTransport, v5.1 reliability):
//  - sends are paced (one presence call in flight, >= 33 ms apart) and merged, so a burst never piles up requests;
//  - a failed send is retried with the WHOLE merged state after a backoff (60 ms .. 3 s) - presence is absolute state,
//    so the newest full state is always the right thing to resend - and an idle peer re-asserts it every 3 s;
//  - a room that stays disconnected for 5 s is rejoined (same name), listeners carried over.
// The room itself (IRoomConn) is the page's JavaScript in WebGL (Unity glue: JsRoomConn over HoopsNet.jslib), or a
// fake in tests. Pure C# (no UnityEngine). Everything runs from Poll() on the main thread.
using System;
using System.Collections.Generic;

namespace Hoops.Game.Net
{
    /// <summary>One joined room (claude.ai `room` capability): peers with their presence, async presence writes.</summary>
    public interface IRoomConn
    {
        List<Peer> Peers();
        /// <summary>The single listener for peer changes (called from Poll()).</summary>
        void SetListener(Action<List<Peer>> fn);
        /// <summary>Write a presence patch; done(ok, error) is called later from Poll().</summary>
        void Presence(Dictionary<string, object> patch, Action<bool, string> done);
        bool Connected();
        void Leave();
        void Poll();
    }

    public sealed class RoomTransport : ITransport
    {
        public string Kind => "room";
        IRoomConn r;
        readonly Action<Action<IRoomConn>, Action<string>> rejoin;
        readonly Func<double> now;
        readonly Dictionary<string, object> mine = new Dictionary<string, object>();
        Dictionary<string, object> pend;
        bool busy, rejoining, left;
        double lastSend, timerAt = -1, retryAt, downAt, wdAt;
        int fails;
        readonly List<Action<List<Peer>>> subs = new List<Action<List<Peer>>>();
        public Action<string> log;

        public RoomTransport(IRoomConn r, Action<Action<IRoomConn>, Action<string>> rejoin = null, Func<double> now = null)
        {
            this.r = r;
            this.rejoin = rejoin;
            this.now = now ?? NetClock.Wall;
            wdAt = this.now() + 1000;
            r.SetListener(Fan);
        }

        public string Me
        {
            get
            {
                foreach (var p in r.Peers()) if (p.me) return p.id;
                return "";
            }
        }

        void Fan(List<Peer> ps)
        {
            for (int i = 0; i < subs.Count; i++) subs[i](ps);
        }

        public List<Peer> Peers() => r.Peers();

        public Action OnPeers(Action<List<Peer>> fn)
        {
            subs.Add(fn);
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
            Kick();
        }

        // (send right away when it's due - a timer is only the fallback for a send that is early)
        void Kick()
        {
            if (busy || pend == null || left) return;
            double t = now(), due = Math.Max(lastSend + 33, retryAt);
            if (t >= due)
            {
                timerAt = -1;
                Flush();
            }
            else if (timerAt < 0) timerAt = due;
        }

        void Flush()
        {
            timerAt = -1;
            if (pend == null || busy || left) return;
            var p = pend;
            pend = null;
            busy = true;
            lastSend = now();
            var conn = r;
            try { conn.Presence(p, Done); }
            catch (Exception e) { Done(false, e.Message); }
        }

        void Done(bool ok, string err)
        {
            busy = false;
            if (ok)
            {
                fails = 0;
                Kick();
                return;
            }
            fails++;
            if (fails < 4 || fails % 10 == 0) log?.Invoke("presence " + err + " - retrying");
            // resend everything we have (newest state wins), after a backoff
            var all = new Dictionary<string, object>(mine);
            if (pend != null) foreach (var kv in pend) all[kv.Key] = kv.Value;
            pend = all;
            retryAt = now() + Math.Min(3000, 60 * Math.Pow(2, Math.Min(fails, 5)));
            Kick();
        }

        public void Poll()
        {
            r.Poll();
            double t = now();
            if (timerAt >= 0 && t >= timerAt)
            {
                timerAt = -1;
                Kick();
            }
            if (t >= wdAt)
            {
                wdAt = t + 1000;
                Watch(t);
            }
        }

        void Watch(double t)
        {
            if (left) return;
            bool up = Connected();
            if (up) downAt = 0;
            else if (downAt == 0) downAt = t;
            // idle heartbeat: re-assert the full state now and then (heals an update the room dropped)
            if (up && !busy && pend == null && t - lastSend > 3000 && mine.Count > 0) Presence(new Dictionary<string, object>(mine));
            // gone for 5 s: rejoin the room and carry the listeners over
            if (!up && downAt != 0 && t - downAt > 5000 && rejoin != null && !rejoining)
            {
                rejoining = true;
                rejoin(nr =>
                {
                    rejoining = false;
                    if (left) { try { nr.Leave(); } catch (Exception) { } return; }
                    try { r.Leave(); } catch (Exception) { }
                    r.SetListener(null);
                    r = nr;
                    r.SetListener(Fan);
                    downAt = 0;
                    busy = false; // (a call in flight on the old room is forgotten)
                    Presence(new Dictionary<string, object>(mine));
                }, e =>
                {
                    rejoining = false;
                    log?.Invoke("rejoin " + e);
                });
            }
        }

        public bool Connected()
        {
            try { return r.Connected(); }
            catch (Exception) { return false; }
        }

        public void Leave()
        {
            left = true;
            try { r.Leave(); } catch (Exception) { }
        }
    }
}
