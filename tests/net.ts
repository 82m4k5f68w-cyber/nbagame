// End-to-end online test: relay server + dedicated headless host (separate processes) + a guest here, over a
// link with injected latency, jitter and dropped updates. Checks snapshots (full/delta), ping, prediction
// error, that the guest's input drives its player on the host, and that nothing goes NaN.
//   tsx tests/net.ts [lag=80] [jitter=40] [drop=0.1] [seconds=12]
import { spawn } from "node:child_process";
import * as G from "../src/core/sim";
import { P } from "../src/core/sim";
import { WsTransport } from "../src/net/ws";
import { GuestSession } from "../src/net/guest";

const arg = (k: string, d: number) => +(process.argv.find((a) => a.startsWith(k + "="))?.split("=")[1] ?? d);
const LAG = arg("lag", 80), JIT = arg("jitter", 40), DROP = arg("drop", 0.1), SECS = arg("seconds", 12);
const PORT = 18000 + Math.floor(Math.random() * 1000);
const relay = spawn(process.execPath, ["--import", "tsx", "server/relay.ts", String(PORT)], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise<void>((r) => relay.stdout!.on("data", (d) => String(d).includes("relay on") && r()));
const fail = (m: string) => { console.log("FAIL:", m); relay.kill(); process.exit(1); };
try {
  const t = await new WsTransport(`ws://127.0.0.1:${PORT}/ws?lag=${LAG}&jitter=${JIT}&drop=${DROP}`, "h2k-test").connect();
  t.requestHost("TEST");
  const g = new GuestSession(t, { n: "Tester", tok: "tok123", code: "TEST" });
  let t0 = Date.now();
  while (!g.L && Date.now() - t0 < 15000) await new Promise((r) => setTimeout(r, 50));
  if (!g.L) fail("no lobby from dedicated host");
  console.log("lobby:", JSON.stringify({ np: g.L!.np, st: g.L!.st, code: g.L!.code }));
  g.setSide(0);
  g.setReady(1);
  t0 = Date.now();
  while (g.gid < 0 && Date.now() - t0 < 10000) await new Promise((r) => setTimeout(r, 30));
  if (g.gid < 0) fail("game did not start");
  // Play: hold right (toward the hoop we attack), tap shoot now and then.
  let maxPres = 0, frames = 0, maxVx = 0, nan = 0, errSum = 0, errN = 0, shots = 0, lastT = performance.now();
  const startX: number[] = [];
  const end = Date.now() + SECS * 1000;
  let fc = 0;
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, 16));
    const now = performance.now(), dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    fc++;
    const sample = () => {
      const i: G.Input = { dx: 1, dy: Math.sin(fc / 40) * 0.5 };
      if (fc % 150 === 0) { i.sd = 1; shots++; }
      if (fc % 150 === 30) i.su = 1;
      return i;
    };
    g.frame(dt, sample);
    frames++;
    if (g.host) maxPres = Math.max(maxPres, JSON.stringify(g.host.state).length);
    if (g.myIdx >= 0) {
      const p = P[g.myIdx];
      if (!startX.length) startX.push(p.x);
      maxVx = Math.max(maxVx, p.vx);
      const s = g.snaps[g.snaps.length - 1];
      if (s) { const o = 34 + g.myIdx * 24; errSum += Math.hypot(p.x - s[o] / 10, p.y - s[o + 1] / 10); errN++; }
    }
    for (const p of P) if (![p.x, p.y, p.z].every(isFinite)) nan++;
  }
  const st = g.stats;
  const hostVx = Math.max(...g.snaps.map((s) => (g.myIdx >= 0 ? s[34 + g.myIdx * 24 + 3] : 0)));
  const res = { frames, snaps: st.full + st.delta, full: st.full, delta: st.delta, avgBytes: Math.round(st.bytes / Math.max(1, st.full + st.delta)), rttMs: Math.round(g.rtt), interpTicks: +g.D.toFixed(1), myIdx: g.myIdx, predVxMax: Math.round(maxVx), hostVxMax: hostVx, avgPredLeadPx: +(errSum / Math.max(1, errN)).toFixed(1), corrections: st.corr + "/" + st.recon, hostPresenceMaxBytes: maxPres, score: G.sc, nan };
  console.log(JSON.stringify(res));
  if (nan) fail("NaN state");
  if (st.delta < 10) fail("delta snapshots not used");
  if (g.rtt <= 0) fail("no ping measured");
  if (hostVx < 100) fail("guest input did not drive the host player");
  if (maxPres > 4096) fail("host presence exceeds the 4 KiB room limit");
  console.log("net ok");
  t.leave();
} finally {
  relay.kill();
  setTimeout(() => process.exit(0), 300);
}
