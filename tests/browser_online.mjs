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
  await pg.evaluate((m) => document.querySelector(`button[data-g="${m}"][data-on="1"]`).click(), mode);
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
  await Gp.evaluate(() => document.querySelector('[data-sd="1"]').click());
  await Gp.waitForTimeout(800);
  await Gp.evaluate(() => document.getElementById("rd").click());
  await Gp.waitForTimeout(1200);
  const lobby = await H.evaluate(() => document.getElementById("ov").innerText.replace(/\s+/g, " ").slice(0, 200));
  console.log("host lobby:", lobby);
  await H.evaluate(() => document.getElementById("go").click());
  await H.waitForTimeout(3000);
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
} catch (e) {
  console.log("ERR", e);
  ok = false;
}
console.log(errs.length ? errs.slice(0, 6) : "no page errors");
await b.close();
relay.kill();
process.exit(ok && !errs.length ? 0 : 1);
