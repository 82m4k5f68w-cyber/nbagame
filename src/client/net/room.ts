// Transports available to the browser: the claude.ai room capability (published artifact) or a WebSocket relay.
import type { Peer, Transport } from "../../net/transport";
import { WsTransport } from "../../net/ws";

/** The claude.ai room, made resilient:
 *  - sends are paced (one presence call in flight, >= 33 ms apart) and merged, so a burst never piles up requests;
 *  - a failed send is retried with the WHOLE merged state after a backoff (presence is absolute state, so the newest
 *    full state is always the right thing to resend), and an idle peer re-asserts it every 3 s - a dropped update
 *    (the lobby, a side pick, a ready flag) heals itself instead of leaving a friend stuck;
 *  - a room that stays disconnected for 5 s is rejoined (same name), listeners carried over. */
export class RoomTransport implements Transport {
  readonly kind = "room";
  private mine: Record<string, any> = {};
  private pend: Record<string, any> | null = null;
  private busy = false;
  private lastSend = 0;
  private timer: any = null;
  private fails = 0;
  private subs = new Set<(p: Peer[]) => void>();
  private unsubs: (() => void)[] = [];
  private wd: any = null;
  private downAt = 0;
  private rejoining = false;
  private left = false;
  constructor(
    private r: any,
    private rejoin?: () => Promise<any>,
  ) {
    this.wd = setInterval(() => this.watch(), 1000);
  }
  get me() {
    const p = this.r.peers().find((p: any) => p.sameTab);
    return p ? p.peer : "";
  }
  private map(a: readonly any[]): Peer[] {
    return a.map((p) => ({ id: p.peer, me: !!p.sameTab, state: (p.presence || {}) as Record<string, any> }));
  }
  peers() {
    return this.map(this.r.peers());
  }
  private hook(fn: (p: Peer[]) => void) {
    const u = this.r.onPeers(
      (ch: any) => fn(this.map(ch.peers)),
      (e: any) => console.warn("room", e && e.code),
    );
    this.unsubs.push(typeof u === "function" ? u : () => {});
  }
  onPeers(fn: (p: Peer[]) => void) {
    this.subs.add(fn);
    this.hook(fn);
    return () => this.subs.delete(fn);
  }
  presence(patch: Record<string, any>) {
    for (const k in patch) {
      if (patch[k] === undefined) continue;
      if (patch[k] === null) delete this.mine[k];
      else this.mine[k] = patch[k];
    }
    const clean: Record<string, any> = {};
    for (const k in patch) if (patch[k] !== undefined) clean[k] = patch[k];
    this.pend = Object.assign(this.pend || {}, clean);
    this.kick();
  }
  private retryAt = 0;
  // (send right away when it's due - a host in a background tab gets its timers throttled to ~1/s, so a timer is only
  // the fallback for a send that is early; the next presence() call flushes it as soon as it's due anyway)
  private kick() {
    if (this.busy || !this.pend || this.left) return;
    const now = Date.now(),
      due = Math.max(this.lastSend + 33, this.retryAt);
    if (now >= due) {
      clearTimeout(this.timer);
      this.timer = null;
      this.flush();
    } else if (!this.timer) this.timer = setTimeout(() => ((this.timer = null), this.kick()), due - now);
  }
  private flush() {
    this.timer = null;
    if (!this.pend || this.busy || this.left) return;
    const p = this.pend;
    this.pend = null;
    this.busy = true;
    this.lastSend = Date.now();
    let pr: Promise<any>;
    try {
      pr = Promise.resolve(this.r.presence(p));
    } catch (e) {
      pr = Promise.reject(e);
    }
    pr.then(
      () => {
        this.busy = false;
        this.fails = 0;
        this.kick();
      },
      (e: any) => {
        this.busy = false;
        this.fails++;
        if (this.fails < 4 || this.fails % 10 === 0) console.warn("presence", e && (e.code || e.message), "- retrying");
        // resend everything we have (newest state wins), after a backoff
        this.pend = Object.assign({ ...this.mine }, this.pend || {});
        this.retryAt = Date.now() + Math.min(3000, 60 * 2 ** Math.min(this.fails, 5));
        this.kick();
      },
    );
  }
  private watch() {
    if (this.left) return;
    const up = this.connected();
    if (up) this.downAt = 0;
    else if (!this.downAt) this.downAt = Date.now();
    // idle heartbeat: re-assert the full state now and then (heals an update the room dropped)
    if (up && !this.busy && !this.pend && Date.now() - this.lastSend > 3000 && Object.keys(this.mine).length) this.presence({ ...this.mine });
    // gone for 5 s: rejoin the room and carry the listeners over
    if (!up && this.downAt && Date.now() - this.downAt > 5000 && this.rejoin && !this.rejoining) {
      this.rejoining = true;
      this.rejoin()
        .then((r) => {
          if (this.left) return r.leave && r.leave().catch(() => {});
          for (const u of this.unsubs) u();
          this.unsubs = [];
          try {
            this.r.leave && this.r.leave().catch(() => {});
          } catch {}
          this.r = r;
          for (const f of this.subs) this.hook(f);
          this.downAt = 0;
          this.presence({ ...this.mine });
        })
        .catch((e) => console.warn("rejoin", e && (e.code || e.message)))
        .finally(() => (this.rejoining = false));
    }
  }
  connected() {
    try {
      return !!this.r.connected();
    } catch {
      return false;
    }
  }
  leave() {
    this.left = true;
    clearInterval(this.wd);
    clearTimeout(this.timer);
    this.r.leave().catch(() => {});
  }
}

let roomNs: any = undefined;
/** Which online backend this page can use. */
export async function detect(): Promise<"room" | "ws" | null> {
  const w = window as any;
  if (new URLSearchParams(location.search).get("ws")) return "ws";
  if (w.claude && typeof w.claude.use === "function") {
    // On the published page: live rooms only (never guess a server on the page's own host).
    if (roomNs === undefined) roomNs = await w.claude.use("room").catch(() => null);
    return roomNs ? "room" : null;
  }
  return wsUrl() ? "ws" : null;
}
export function wsUrl(): string | null {
  const q = new URLSearchParams(location.search).get("ws");
  if (q) return q;
  if (/^https?:$/.test(location.protocol) && !/claude\.(ai|com)|claudeusercontent/.test(location.host) && (window as any).__H2K_WS !== false)
    return (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws";
  return null;
}
export async function connect(code: string): Promise<Transport> {
  const name = "h2k-" + code.toLowerCase();
  const kind = await detect();
  if (kind === "room") return new RoomTransport(await roomNs.join(name), () => roomNs.join(name));
  if (kind === "ws") return new WsTransport(wsUrl()!, name).connect();
  throw new Error("Online play needs the published Hoops 2K27 page on claude.ai or a Hoops relay server.");
}
