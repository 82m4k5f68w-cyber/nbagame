// The published-page path: two pages, each with a stand-in claude.ai `room` capability (presence over a
// BroadcastChannel, same shape as the platform's), host clicks "Host 5v5" on the home screen and the guest
// types the code into the home-screen box. Checks the game starts on both and the guest controls a player.
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
const html = fs.readFileSync("dist/hoops2k27-hub.html");
const srv = http.createServer((q, r) => r.writeHead(200, { "content-type": "text/html" }).end(html)).listen(0);
const url = `http://127.0.0.1:${srv.address().port}/`;
const MOCK = `(() => {
  const ch = new BroadcastChannel("h2k-mock-room"), me = Math.random().toString(36).slice(2, 18);
  function makeRoom(name) {
    const peers = new Map(), subs = new Set(); let mine = {};
    const list = () => [{ peer: me, sameTab: true, isMe: true, presence: mine }, ...[...peers].map(([peer, presence]) => ({ peer, sameTab: false, isMe: false, presence }))];
    const fire = () => { const ps = list(); requestAnimationFrame(() => subs.forEach((f) => f({ peers: ps, joined: [], left: [], updated: [] }))); };
    ch.addEventListener("message", (e) => { const d = e.data; if (d.room !== name || d.peer === me) return; if (d.bye) peers.delete(d.peer); else peers.set(d.peer, d.state); fire(); if (d.hello) ch.postMessage({ room: name, peer: me, state: mine }); });
    let tm = null;
    const R = {
      peers: list,
      onPeers(f) { subs.add(f); fire(); return () => subs.delete(f); },
      presence(patch) { for (const k in patch) patch[k] === null ? delete mine[k] : (mine[k] = patch[k]); mine = { ...mine };
        if (JSON.stringify(mine).length > 4096) return Promise.reject({ code: "invalid_argument" });
        if (!tm) tm = setTimeout(() => { tm = null; ch.postMessage({ room: name, peer: me, state: mine }); }, 33); return Promise.resolve(); },
      connected: () => true, onConnection(f) { f(true); return () => {}; },
      leave() { ch.postMessage({ room: name, peer: me, bye: 1 }); return Promise.resolve(); },
    };
    ch.postMessage({ room: name, peer: me, state: {}, hello: 1 });
    return R;
  }
  const room = { join: async (n) => makeRoom(n) };
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
  return pg;
};
let ok = false;
try {
  const H = await open("host");
  await H.evaluate(() => document.querySelector('[data-on="host"][data-g="5v5-3d"]').click());
  await H.waitForFunction(() => window.H2K && window.H2K.NET.code, null, { timeout: 30000 });
  const code = await H.evaluate(() => window.H2K.NET.code);
  const Gp = await open("guest");
  await Gp.fill("#hc", code);
  await Gp.evaluate(() => document.getElementById("hj").click());
  await Gp.waitForSelector('[data-sd="1"]', { timeout: 30000 });
  await Gp.evaluate(() => document.querySelector('[data-sd="1"]').click());
  await Gp.waitForTimeout(500);
  await Gp.evaluate(() => document.getElementById("rd").click());
  // like a real host: start once the friend shows up in the lobby as seated and READY
  await H.waitForFunction(() => { const go = document.getElementById("go"); return go && !go.style.opacity && [...document.querySelectorAll(".pl span")].filter((e) => e.textContent === "READY").length >= 2; }, null, { timeout: 30000 });
  await H.evaluate(() => document.getElementById("go").click());
  await Gp.waitForFunction(() => window.H2K.G.S === "play", null, { timeout: 30000 });
  await Gp.keyboard.down("KeyA");
  await Gp.waitForTimeout(4000);
  await Gp.keyboard.up("KeyA");
  const hs = await H.evaluate(() => ({ S: window.H2K.G.S, remote: window.H2K.G.CT.filter((c) => c.remote).length, kind: window.H2K.NET.role }));
  const gs = await Gp.evaluate(() => ({ S: window.H2K.G.S, role: window.H2K.NET.role, me: window.H2K.G.CT[window.H2K.V.focus]?.tm }));
  console.log("code", code, "host", JSON.stringify(hs), "guest", JSON.stringify(gs));
  ok = hs.S === "play" && hs.remote === 1 && gs.role === "guest" && gs.me === 1;
} catch (e) {
  console.log("ERR", e.message);
}
console.log(errs.length ? errs.slice(0, 5) : "no page errors", ok ? "ROOM OK" : "ROOM FAIL");
await b.close();
srv.close();
process.exit(ok && !errs.length ? 0 : 1);
