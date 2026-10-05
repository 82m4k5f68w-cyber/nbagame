// Online reliability on the published-page path, with a FAULTY stand-in room: ~35% of presence updates fail (and are
// not applied), and mid-game the guest's room goes down for 7 s (presence fails, nothing in or out, connected() is
// false). The lobby must still come together, the game start, and after the outage the guest must rejoin, receive
// snapshots again and get his seat back from the AI.
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
const html = fs.readFileSync("dist/hoops2k27-hub.html");
const srv = http.createServer((q, r) => r.writeHead(200, { "content-type": "text/html" }).end(html)).listen(0);
const url = `http://127.0.0.1:${srv.address().port}/`;
const MOCK = `(() => {
  window.__FAIL = 0.35; window.__DOWN = false;
  const ch = new BroadcastChannel("h2k-mock-room"), me = Math.random().toString(36).slice(2, 18);
  function makeRoom(name) {
    const peers = new Map(), subs = new Set(); let mine = {};
    const list = () => [{ peer: me, sameTab: true, isMe: true, presence: mine }, ...[...peers].map(([peer, presence]) => ({ peer, sameTab: false, isMe: false, presence }))];
    const fire = () => { const ps = list(); queueMicrotask(() => subs.forEach((f) => f({ peers: ps, joined: [], left: [], updated: [] }))); }; // (event-driven like the real room: not tied to the page's frames)
    ch.addEventListener("message", (e) => { const d = e.data; if (d.room !== name || d.peer === me || window.__DOWN || R.dead) return; if (d.bye) peers.delete(d.peer); else peers.set(d.peer, d.state); fire(); if (d.hello) ch.postMessage({ room: name, peer: me, state: mine }); });
    let tm = null;
    const R = { dead: false,
      peers: list,
      onPeers(f) { subs.add(f); fire(); return () => subs.delete(f); },
      presence(patch) { if (window.__DOWN || R.dead || Math.random() < window.__FAIL) return Promise.reject({ code: "unavailable" }); for (const k in patch) patch[k] === null ? delete mine[k] : (mine[k] = patch[k]); mine = { ...mine };
        if (JSON.stringify(mine).length > 4096) return Promise.reject({ code: "invalid_argument" });
        if (!tm) tm = setTimeout(() => { tm = null; if (!window.__DOWN && !R.dead) ch.postMessage({ room: name, peer: me, state: mine }); }, 33); return Promise.resolve(); },
      connected: () => !window.__DOWN && !R.dead, onConnection(f) { f(true); return () => {}; },
      leave() { R.dead = true; ch.postMessage({ room: name, peer: me, bye: 1 }); return Promise.resolve(); },
    };
    ch.postMessage({ room: name, peer: me, state: {}, hello: 1 });
    (window.__rooms = window.__rooms || []).push(R);
    return R;
  }
  const room = { join: async (n) => { if (window.__DOWN) throw { code: "unavailable" }; window.__joins = (window.__joins || 0) + 1; return makeRoom(n); } };
  window.claude = { use: async (n) => (n === "room" ? room : null) };
})();`;
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await b.newContext({ viewport: { width: 1000, height: 900 } });
await ctx.addInitScript(MOCK);
const errs = [];
const open = async (tag) => {
  const pg = await ctx.newPage();
  pg.on("pageerror", (e) => errs.push(tag + ": " + e));
  await pg.goto(url);
  await pg.waitForTimeout(400);
  await pg.evaluate(() => { const lo = () => window.H2K && ((window.H2K.V.QL = 0), (window.H2K.V.FX = 0)); lo(); setInterval(lo, 500); });
  return pg;
};
let ok = false;
try {
  const H = await open("host");
  // the host plays as a background tab (document.hidden): it simulates on its timer, the way a real host does when
  // his friend's window is in front - and it exercises the paced sender under timer throttling
  await H.evaluate(() => Object.defineProperty(document, "hidden", { get: () => true, configurable: true }));
  // (1v1 at the lowest quality: two software-rendered 3D pages at once would crawl and starve the host's sim)
  await H.evaluate(() => document.querySelector('[data-on="host"][data-g="1v1-3d"]').click());
  await H.waitForFunction(() => window.H2K && window.H2K.NET.code, null, { timeout: 30000 });
  const code = await H.evaluate(() => window.H2K.NET.code);
  console.log("step: hosted", code);
  const Gp = await open("guest");
  await Gp.bringToFront(); // (the guest is the window in front; the host simulates as a background tab)
  await Gp.fill("#hc", code);
  await Gp.evaluate(() => document.getElementById("hj").click());
  await Gp.waitForSelector('[data-sd="1"]', { timeout: 60000 });
  console.log("step: guest sees the lobby");
  await Gp.evaluate(() => document.querySelector('[data-sd="1"]').click());
  await Gp.waitForTimeout(500);
  await Gp.evaluate(() => document.getElementById("rd").click());
  // like a real host: start once the friend shows up in the lobby as seated and READY
  await H.waitForFunction(() => { const go = document.getElementById("go"); return go && !go.style.opacity && [...document.querySelectorAll(".pl span")].filter((e) => e.textContent === "READY").length >= 2; }, null, { timeout: 30000 });
  console.log("step: host sees the guest ready");
  await H.evaluate(() => document.getElementById("go").click());
  await Gp.waitForFunction(() => window.H2K.G.S === "play", null, { timeout: 30000 });
  console.log("step: game on");
  const ht0 = await H.evaluate(() => [window.H2K.G.T, document.hidden, document.visibilityState]);
  await Gp.waitForTimeout(2000);
  const ht1 = await H.evaluate(() => [window.H2K.G.T, document.hidden]);
  console.log("host clock over 2 s", JSON.stringify(ht0), JSON.stringify(ht1));
  await Gp.waitForTimeout(3000);
  const before = await Gp.evaluate(() => window.H2K.NET.rel());
  // the guest's connection drops for 7 s
  // (and that room never comes back: only a rejoin recovers)
  await Gp.evaluate(() => { window.__DOWN = true; for (const r of window.__rooms) r.dead = true; });
  await Gp.waitForTimeout(7500);
  const during = await H.evaluate(() => window.H2K.NET.rel()); // the host has handed the silent seat to the AI
  await Gp.waitForTimeout(1000);
  await Gp.evaluate(() => (window.__DOWN = false));
  console.log("step: back up", JSON.stringify(await Gp.evaluate(() => ({ ...window.H2K.NET.rel(), joins: window.__joins }))));
  await Gp.waitForFunction((s) => window.H2K.NET.rel().snap > s + 60, before.snap, { timeout: 30000 });
  await H.waitForFunction(() => window.H2K.NET.rel().remote === 1, null, { timeout: 30000 });
  await Gp.waitForFunction(() => window.H2K.G.CT[window.H2K.V.focus] && window.H2K.G.CT[window.H2K.V.focus].id === window.H2K.NET.dbg().me, null, { timeout: 15000 });
  const after = await Gp.evaluate(() => ({ ...window.H2K.NET.rel(), joins: window.__joins, S: window.H2K.G.S, me: window.H2K.G.CT[window.H2K.V.focus]?.tm }));
  const hs = await H.evaluate(() => ({ S: window.H2K.G.S, ...window.H2K.NET.rel(), ct: window.H2K.G.CT.map((c) => c.id) }));
  console.log("guest ids", await Gp.evaluate(() => JSON.stringify({ ct: window.H2K.G.CT.map((c) => c.id), me: window.H2K.NET.dbg().me, focus: window.H2K.V.focus })));
  console.log("code", code, "before", JSON.stringify(before), "host during outage", JSON.stringify(during), "after", JSON.stringify(after), "host", JSON.stringify(hs));
  ok = before.snap > 0 && before.seats.every((x) => x[1]) && during.remote === 0 && after.snap > before.snap + 60 && after.joins >= 2 && after.S === "play" && after.me === 1 && hs.remote === 1 && hs.S === "play";
} catch (e) {
  console.log("ERR", e.message);
  for (const pg of ctx.pages()) console.log("  page", await pg.evaluate(() => JSON.stringify({ S: window.H2K && window.H2K.G.S, role: window.H2K && window.H2K.NET.role, d: window.H2K && window.H2K.NET.dbg(), r: window.H2K && window.H2K.NET.rel(), sizes: window.H2K && window.H2K.NET.sizes && window.H2K.NET.sizes() })).catch((e) => String(e)));
}
console.log(errs.length ? errs.slice(0, 5) : "no page errors", ok ? "ROOM FAULTS OK" : "ROOM FAULTS FAIL");
await b.close();
srv.close();
process.exit(ok && !errs.length ? 0 : 1);
