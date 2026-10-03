// Transports available to the browser: the claude.ai room capability (published artifact) or a WebSocket relay.
import type { Peer, Transport } from "../../net/transport";
import { WsTransport } from "../../net/ws";

class RoomTransport implements Transport {
  readonly kind = "room";
  constructor(private r: any) {}
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
  onPeers(fn: (p: Peer[]) => void) {
    return this.r.onPeers(
      (ch: any) => fn(this.map(ch.peers)),
      (e: any) => console.warn("room", e && e.code),
    );
  }
  presence(patch: Record<string, any>) {
    const clean: Record<string, any> = {};
    for (const k in patch) if (patch[k] !== undefined) clean[k] = patch[k];
    this.r.presence(clean).catch((e: any) => console.warn("presence", e && (e.code || e.message)));
  }
  connected() {
    return this.r.connected();
  }
  leave() {
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
  if (kind === "room") return new RoomTransport(await roomNs.join(name));
  if (kind === "ws") return new WsTransport(wsUrl()!, name).connect();
  throw new Error("Online play needs the published Hoops 2K27 page on claude.ai or a Hoops relay server.");
}
