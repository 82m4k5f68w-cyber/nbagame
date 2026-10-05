// Hoops 2K27 relay server: serves the built game and relays presence between peers in named rooms
// (the same model as the claude.ai room capability). It can also spawn a dedicated, authoritative headless host
// per room code (POST-free: a client sends {t:"host", code}).
//   npm run server            -> http://localhost:8787  (WebSocket on /ws)
// Test knobs per connection (query string on /ws): lag=ms, jitter=ms, drop=0..1 (drops coalesced presence updates).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = +(process.env.PORT || process.argv[2] || 8787);

interface Conn {
  ws: WebSocket;
  id: string;
  room: string;
  state: Record<string, any>;
  last: number;
  timer: any;
  lag: number;
  jitter: number;
  drop: number;
}
const rooms = new Map<string, Map<string, Conn>>();
const hosts = new Map<string, ChildProcess>();
const rid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);

const server = http.createServer((req, res) => {
  const u = new URL(req.url || "/", "http://x");
  if (u.pathname === "/favicon.ico") {
    res.writeHead(204).end();
    return;
  }
  let f = u.pathname === "/" ? "/hoops2k27-hub.html" : u.pathname;
  f = path.join(ROOT, "dist", path.normalize(f).replace(/^(\.\.[/\\])+/, ""));
  if (!f.startsWith(path.join(ROOT, "dist")) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "content-type": f.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 64 * 1024 });

function out(c: Conn, msg: any) {
  const s = JSON.stringify(msg);
  const d = c.lag + Math.random() * c.jitter;
  if (d > 0) setTimeout(() => c.ws.readyState === 1 && c.ws.send(s), d);
  else if (c.ws.readyState === 1) c.ws.send(s);
}
function broadcast(from: Conn) {
  const r = rooms.get(from.room);
  if (!r) return;
  from.last = Date.now();
  from.timer = null;
  for (const c of r.values()) if (c !== from && !(c.drop && Math.random() < c.drop)) out(c, { t: "p", id: from.id, state: from.state });
}
wss.on("connection", (ws, req) => {
  const q = new URL(req.url || "/", "http://x").searchParams;
  let c: Conn | null = null;
  // keep-alive: a protocol ping every 15 s; a socket that didn't pong since the last one is dead - drop it, so its
  // peer leaves the room (otherwise the host keeps a ghost seat)
  (ws as any).alive = true;
  ws.on("pong", () => ((ws as any).alive = true));
  ws.on("message", (raw) => {
    let m: any;
    try {
      m = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (m.t === "join" && !c) {
      const room = String(m.room || "").slice(0, 48);
      if (!/^[a-z0-9][a-z0-9_.-]{0,47}$/.test(room)) return ws.close();
      let r = rooms.get(room);
      if (!r) rooms.set(room, (r = new Map()));
      const id = typeof m.id === "string" && /^[a-z0-9]{16}$/.test(m.id) && !r.has(m.id) ? m.id : rid();
      c = { ws, id, room, state: {}, last: 0, timer: null, lag: +(q.get("lag") || 0), jitter: +(q.get("jitter") || 0), drop: +(q.get("drop") || 0) };
      r.set(id, c);
      out(c, { t: "hello", me: id, peers: [...r.values()].filter((x) => x !== c).map((x) => ({ id: x.id, state: x.state })) });
      for (const x of r.values()) if (x !== c) out(x, { t: "p", id, state: c.state });
    } else if (m.t === "p" && c && m.patch && typeof m.patch === "object") {
      for (const k in m.patch) {
        if (m.patch[k] === null) delete c.state[k];
        else c.state[k] = m.patch[k];
      }
      // Sender-side coalescing to ~30 Hz: every receiver gets the same subset of states.
      const wait = 33 - (Date.now() - c.last);
      if (wait <= 0) broadcast(c);
      else if (!c.timer) {
        const cc = c;
        c.timer = setTimeout(() => broadcast(cc), wait);
      }
    } else if (m.t === "ping") out(c || ({ ws, lag: 0, jitter: 0 } as any), { t: "pong" });
    else if (m.t === "host" && c) spawnHost(String(m.code || ""), c.room);
  });
  ws.on("close", () => {
    if (!c) return;
    const r = rooms.get(c.room);
    if (!r) return;
    clearTimeout(c.timer);
    r.delete(c.id);
    for (const x of r.values()) out(x, { t: "left", id: c.id });
    if (!r.size) rooms.delete(c.room);
  });
});
/** Dedicated authoritative host: a headless Node sim for this room code. */
function spawnHost(code: string, room: string) {
  if (!/^[A-Z]{4}$/.test(code) || hosts.has(room)) return;
  const ch = fork(path.join(ROOT, "server/headless-host.ts"), [code, `ws://127.0.0.1:${PORT}/ws`, room], { execArgv: ["--import", "tsx"], stdio: "inherit" });
  hosts.set(room, ch);
  ch.on("exit", () => hosts.delete(room));
}
setInterval(() => {
  for (const ws of wss.clients) {
    if (!(ws as any).alive) {
      ws.terminate();
      continue;
    }
    (ws as any).alive = false;
    try {
      ws.ping();
    } catch {}
  }
}, 15000).unref();
const bye = () => {
  for (const ch of hosts.values()) ch.kill();
  process.exit(0);
};
process.on("SIGTERM", bye);
process.on("SIGINT", bye);
server.listen(PORT, () => console.log(`Hoops 2K27 relay on http://localhost:${PORT}  (ws /ws)`));
