// WebSocket transport to the Hoops relay (server/relay.ts). Same presence semantics as the claude.ai room:
// each peer keeps one merged state object; sends are coalesced to ~30 Hz; reconnects keep the peer id.
import type { Peer, Transport } from "./transport";

export class WsTransport implements Transport {
  readonly kind = "ws";
  me = "";
  private ws: WebSocket | null = null;
  private st = new Map<string, Record<string, any>>();
  private mine: Record<string, any> = {};
  private pend: Record<string, any> | null = null;
  private lastSend = 0;
  private timer: any = null;
  private subs = new Set<(p: Peer[]) => void>();
  private open = false;
  private closed = false;
  private list: Peer[] = [];
  private lastMsg = 0;
  private hb: any = null;
  private tries = 0;
  constructor(
    private url: string,
    private room: string,
  ) {}
  connect(): Promise<this> {
    return new Promise((res, rej) => {
      const ws = (this.ws = new WebSocket(this.url));
      let first = true;
      ws.onopen = () => {
        this.lastMsg = Date.now();
        ws.send(JSON.stringify({ t: "join", room: this.room, id: this.me || undefined }));
      };
      ws.onmessage = (m) => {
        this.lastMsg = Date.now();
        let d: any;
        try {
          d = JSON.parse(String(m.data));
        } catch {
          return; // (a garbled frame never takes the client down)
        }
        if (d.t === "hello") {
          this.me = d.me;
          this.open = true;
          this.tries = 0;
          this.beat();
          this.st.clear();
          for (const p of d.peers) this.st.set(p.id, p.state);
          if (Object.keys(this.mine).length) this.send({ ...this.mine }); // re-assert after reconnect
          this.emit();
          if (first) {
            first = false;
            res(this);
          }
        } else if (d.t === "p") {
          this.st.set(d.id, d.state);
          this.emit();
        } else if (d.t === "left") {
          this.st.delete(d.id);
          this.emit();
        }
      };
      ws.onerror = () => first && rej(new Error("relay unreachable"));
      ws.onclose = () => {
        if (ws !== this.ws) return; // (an old socket the watchdog already replaced)
        this.open = false;
        this.emit();
        // reconnect with backoff: 0.5 s, 1, 2, 4 ... capped at 5 s; the relay keeps our peer id when it can
        if (!this.closed) setTimeout(() => this.connect().catch(() => {}), Math.min(5000, 500 * 2 ** this.tries++));
      };
    });
  }
  /** Heartbeat: a ping every 2 s; a socket that has heard nothing for 6 s is dead (half-open TCP, a sleeping laptop,
   *  a captive Wi-Fi) - close it and reconnect instead of waiting minutes for the OS to notice. */
  private beat() {
    if (this.hb) return;
    this.hb = setInterval(() => {
      if (this.closed) return clearInterval(this.hb);
      const ws = this.ws;
      if (!ws || ws.readyState !== 1) return;
      if (Date.now() - this.lastMsg > 6000) {
        this.open = false;
        this.emit();
        try {
          ws.close();
        } catch {}
        this.ws = null;
        this.connect().catch(() => {});
        return;
      }
      try {
        ws.send('{"t":"ping"}');
      } catch {}
    }, 2000);
  }
  private emit() {
    const a: Peer[] = [{ id: this.me, me: true, state: this.mine }];
    for (const [id, s] of this.st) if (id !== this.me) a.push({ id, me: false, state: s });
    this.list = a;
    for (const f of this.subs) f(a);
  }
  peers() {
    return this.list;
  }
  onPeers(fn: (p: Peer[]) => void) {
    this.subs.add(fn);
    if (this.list.length) queueMicrotask(() => fn(this.list));
    return () => this.subs.delete(fn);
  }
  presence(patch: Record<string, any>) {
    for (const k in patch) {
      if (patch[k] === undefined) continue;
      if (patch[k] === null) delete this.mine[k];
      else this.mine[k] = patch[k];
    }
    this.pend = Object.assign(this.pend || {}, patch);
    const now = Date.now(),
      wait = 33 - (now - this.lastSend);
    if (wait <= 0) this.flush();
    else if (!this.timer) this.timer = setTimeout(() => this.flush(), wait);
  }
  private flush() {
    this.timer = null;
    if (!this.pend) return;
    this.send(this.pend);
    this.pend = null;
    this.lastSend = Date.now();
  }
  private send(patch: any) {
    if (this.ws && this.open)
      try {
        this.ws.send(JSON.stringify({ t: "p", patch }));
      } catch {} // (closing socket: the reconnect re-asserts everything)
  }
  connected() {
    return this.open;
  }
  /** Ask the relay to start a dedicated authoritative host for this room code. */
  requestHost(code: string) {
    if (this.ws && this.open) this.ws.send(JSON.stringify({ t: "host", code }));
  }
  leave() {
    this.closed = true;
    clearInterval(this.hb);
    this.ws && this.ws.close();
  }
}
