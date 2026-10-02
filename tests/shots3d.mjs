// 3D screenshots for visual review: broadcast, 2K, player-lock cameras after some play (docs/look-*.png).
import { chromium } from "playwright";
import path from "node:path";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const pg = await b.newPage({ viewport: { width: 1000, height: 700 } });
const errs = [];
pg.on("pageerror", (e) => errs.push(String(e)));
await pg.goto("file://" + path.resolve("dist/hoops2k27-hub.html"));
await pg.waitForTimeout(400);
await pg.evaluate(() => document.querySelector('button[data-g="5v5-3d"][data-my="0"][data-mp="0"]').click());
await pg.waitForTimeout(1000);
await pg.evaluate(() => document.getElementById("tip").click());
await pg.evaluate(() => { const { G } = window.H2K; for (let i = 0; i < 420; i++) G.upd(1 / 60); });
for (const m of [0, 1, 3]) {
  await pg.evaluate((m) => { window.H2K.V.CAMM = m; for (let i = 0; i < 40; i++) { window.H2K.G.upd(1 / 60); window.H2K.V.GL.render(); } }, m);
  await pg.screenshot({ path: `docs/look-cam${m}.png`, clip: { x: 20, y: 0, width: 960, height: 540 }, timeout: 120000 });
}
console.log(errs.length ? errs : "no errors", await pg.evaluate(() => JSON.stringify(window.H2K.V.perf)));
await b.close();
