// WebSocket transport reliability against the real relay (server/relay.ts on a free port):
//  - a dropped socket reconnects by itself and re-asserts its presence (the other side sees it again),
//  - a silent socket (half-open: nothing arrives any more) is detected by the heartbeat and replaced,
//  - a garbled frame from the server never throws.
import { spawn } from "node:child_process";
import { WsTransport } from "../src/net/ws";
const port = 18000 + Math.floor(Math.random() * 1000);
const srv = spawn(process.execPath, ["--import", "tsx", "server/relay.ts", String(port)], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise<void>((res) => srv.stdout!.on("data", (d) => String(d).includes("relay") && res()));
const url = `ws://127.0.0.1:${port}/ws`;
const fails: string[] = [];
const ok = (c: boolean, m: string) => (console.log((c ? "ok   " : "FAIL ") + m), c || fails.push(m));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => boolean, ms: number) => {
  const t0 = Date.now();
  while (!f() && Date.now() - t0 < ms) await wait(50);
  return f();
};
try {
  const a = await new WsTransport(url, "h2k-test").connect(),
    b = await new WsTransport(url, "h2k-test").connect();
  a.presence({ v: 1, who: "A", n: 1 });
  b.presence({ v: 1, who: "B" });
  ok(await until(() => b.peers().some((p) => !p.me && p.state.who === "A"), 3000), "B sees A");
  // 1) the socket drops: A reconnects and re-asserts its state (with a newer value set while it was down)
  (a as any).ws.close();
  await wait(100);
  a.presence({ n: 2 });
  ok(await until(() => a.connected(), 4000), "A reconnected by itself");
  ok(await until(() => b.peers().some((p) => !p.me && p.state.who === "A" && p.state.n === 2), 4000), "B sees A again, with the newest state");
  // 2) the socket goes silent (half-open): stop handling anything that arrives - the heartbeat must notice
  const ws = (a as any).ws;
  ws.onmessage = () => {};
  ws.onclose = () => {};
  ok(await until(() => (a as any).ws !== ws && a.connected(), 12000), "a silent socket is detected and replaced (heartbeat)");
  a.presence({ n: 3 });
  ok(await until(() => b.peers().some((p) => !p.me && p.state.n === 3), 4000), "...and A's updates flow again");
  // 3) a garbled frame
  let threw = false;
  try {
    (a as any).ws.onmessage({ data: "{not json" });
  } catch {
    threw = true;
  }
  ok(!threw, "a garbled frame is ignored");
  a.leave();
  b.leave();
} catch (e) {
  fails.push(String(e));
  console.log("ERR", e);
}
srv.kill();
console.log(fails.length ? "WS RECONNECT FAIL" : "WS RECONNECT OK");
process.exit(fails.length ? 1 : 0);
