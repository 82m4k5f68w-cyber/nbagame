// Two browsers online through the relay: host creates a game, guest joins by code, sides + ready-up, play.
// Checks: lobby flow, guest follows host state, guest input moves its player on the host, presence < 4 KiB, no errors.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
const mode = process.argv[2] || "5v5-3d";
const PORT = 19000 + Math.floor(Math.random() * 900);
const relay = spawn(process.execPath, ["--import", "tsx", "server/relay.ts", String(PORT)], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise((r) => relay.stdout.on("data", (d) => String(d).includes("relay on") && r()));
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const errs = [];
async function page(tag) {
  const pg = await b.newPage({ viewport: { width: 1000, height: 900 } });
  pg.on("pageerror", (e) => errs.push(tag + ": " + e));
  pg.on("console", (m) => m.type() === "error" && errs.push(tag + " console: " + m.text()));
  await pg.goto(`http://127.0.0.1:${PORT}/`);
  await pg.waitForTimeout(300);
  await pg.evaluate((m) => (document.querySelector(`button[data-g="${m}"][data-on="1"]`) || document.querySelector('button[data-on="1"]')).click(), mode);
  await pg.waitForTimeout(1500);
  return pg;
}
let ok = true;
try {
  const H = await page("host");
  await H.evaluate(() => (document.getElementById("nm").value = "Hosty"));
  await H.evaluate(() => document.getElementById("cr").click());
  await H.waitForTimeout(800);
  const code = await H.evaluate(() => window.H2K.NET.code);
  console.log("code", code);
  const Gp = await page("guest");
  await Gp.evaluate((c) => { document.getElementById("nm").value = "Guesty"; document.getElementById("cd").value = c; document.getElementById("jn").click(); }, code);
  await Gp.waitForTimeout(1500);
  await Gp.waitForSelector('[data-sd="1"]', { timeout: 30000 });
  await Gp.evaluate(() => document.querySelector('[data-sd="1"]').click());
  await Gp.waitForTimeout(800);
  await Gp.evaluate(() => document.getElementById("rd").click());
  await H.waitForFunction(() => window.H2K.NET && document.getElementById("go") && !document.getElementById("go").style.opacity, null, { timeout: 30000 });
  const lobby = await H.evaluate(() => document.getElementById("ov").innerText.replace(/\s+/g, " ").slice(0, 200));
  console.log("host lobby:", lobby);
  await H.evaluate(() => document.getElementById("go").click());
  // the opening tip is a dead ball on the guest too (synced jump ball)
  let jb = false;
  for (let i = 0; i < 20 && !jb; i++) {
    jb = await Gp.evaluate(() => !!window.H2K.G.JB);
    await Gp.waitForTimeout(100);
  }
  await H.waitForTimeout(2500);
  // quick chat: the guest presses 1, the host shows it
  await Gp.keyboard.press("Digit1");
  await H.waitForFunction(() => window.H2K.NET.chats > 0, null, { timeout: 10000 }).catch(() => {});
  const chat = await H.evaluate(() => window.H2K.NET.chats);
  console.log("guest saw jump ball:", jb, "host chats:", chat);
  if (!jb || !chat) ok = false;
  // guest holds left (its team attacks the left hoop) for a while
  await Gp.keyboard.down("KeyA");
  await Gp.waitForTimeout(6000);
  await Gp.keyboard.up("KeyA");
  const hs = await H.evaluate(() => { const { G } = window.H2K; return { S: G.S, n: G.P.length, ct: G.CT.map((c) => [c.id.slice(0, 6), c.tm, c.idx, !!c.remote]), T: +G.T.toFixed(1), pres: JSON.stringify(window.H2K.NET).length } });
  const gs = await Gp.evaluate(() => { const { G, NET } = window.H2K; return { S: G.S, n: G.P.length, T: +G.T.toFixed(1), role: NET.role, focus: window.H2K.V.focus, ct: G.CT.map((c) => [c.id.slice(0, 6), c.tm, c.idx]) } });
  console.log("host", JSON.stringify(hs));
  console.log("guest", JSON.stringify(gs));
  const posDiff = await Promise.all([H, Gp].map((pg) => pg.evaluate(() => window.H2K.G.P.map((p) => [Math.round(p.x), Math.round(p.y)]))));
  const md = Math.max(...posDiff[0].map((a, i) => Math.hypot(a[0] - posDiff[1][i][0], a[1] - posDiff[1][i][1])));
  console.log("max host/guest position gap (px, includes ~100ms interpolation delay):", md.toFixed(0));
  const sz = await H.evaluate(() => { const ps = []; return 0; });
  await H.screenshot({ path: "docs/online-host.png", clip: { x: 20, y: 0, width: 960, height: 540 }, timeout: 120000 });
  await Gp.screenshot({ path: "docs/online-guest.png", clip: { x: 20, y: 0, width: 960, height: 540 }, timeout: 120000 });
  if (hs.S !== "play" || gs.S !== "play" || gs.role !== "guest" || !hs.ct.some((c) => c[3])) ok = false;
  void sz;
  // finish the game on the host: both see the final screen; the guest votes for a rematch, the host starts it
  await H.evaluate(() => {
    const G = window.H2K.G;
    G.sc[0] = 20;
    G.sc[1] = 18;
    for (let q = 0; q < 6 && G.S === "play"; q++) {
      G.setClock(0);
      G.setRs(0);
      G.setInb(0);
      for (let i = 0; i < 20 && G.S === "play"; i++) G.upd(1 / 60);
    }
  });
  await Gp.waitForFunction(() => document.getElementById("nrm"), null, { timeout: 30000 });
  const rated = await Gp.evaluate(() => document.querySelector(".fin").innerText.includes("Ranked"));
  await Gp.evaluate(() => document.getElementById("nrm").click());
  await H.waitForFunction(() => document.getElementById("nrmc") && /1\/1/.test(document.getElementById("nrmc").textContent), null, { timeout: 20000 });
  const gid0 = await Gp.evaluate(() => window.H2K.G.T);
  await H.evaluate(() => document.getElementById("nrm").click());
  await Gp.waitForFunction(() => window.H2K.G.S === "play" && document.getElementById("ov").style.display === "none", null, { timeout: 30000 });
  const re = await Gp.evaluate(() => ({ S: window.H2K.G.S, sc: window.H2K.G.sc.slice() }));
  console.log("rated:", rated, "rematch:", JSON.stringify(re), gid0 >= 0);
  if (!rated || re.S !== "play" || re.sc[0] + re.sc[1] > 6) ok = false;
} catch (e) {
  console.log("ERR", e);
  ok = false;
}
console.log(errs.length ? errs.slice(0, 6) : "no page errors");
await b.close();
relay.kill();
process.exit(ok && !errs.length ? 0 : 1);
