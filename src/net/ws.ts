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
  constructor(
    private url: string,
    private room: string,
  ) {}
  connect(): Promise<this> {
    return new Promise((res, rej) => {
      const ws = (this.ws = new WebSocket(this.url));
      let first = true;
      ws.onopen = () => ws.send(JSON.stringify({ t: "join", room: this.room, id: this.me || undefined }));
      ws.onmessage = (m) => {
        const d = JSON.parse(String(m.data));
        if (d.t === "hello") {
          this.me = d.me;
          this.open = true;
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
        this.open = false;
        this.emit();
        if (!this.closed) setTimeout(() => this.connect().catch(() => {}), 1000);
      };
    });
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
    if (this.ws && this.open) this.ws.send(JSON.stringify({ t: "p", patch }));
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
    this.ws && this.ws.close();
  }
}
