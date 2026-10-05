// Frame-rate guard: force High graphics on a software GPU (SwiftShader: seconds per High frame) and let the real
// rAF loop run; the guard must step the effects ladder AND the graphics level down until frames are playable.
//   node tests/browser_perf.mjs
import { chromium } from "playwright";
import path from "node:path";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const pg = await b.newPage({ viewport: { width: 1000, height: 900 } });
const errs = [];
pg.on("pageerror", (e) => errs.push(String(e)));
await pg.addInitScript(() => localStorage.setItem("h2k_set", JSON.stringify({ q2: 2, fx: 1 })));
await pg.goto("file://" + path.resolve("dist/hoops2k27-hub.html") + "?nointro");
await pg.waitForTimeout(500);
await pg.evaluate(() => document.querySelector(`button[data-g="5v5-3d"][data-my="0"][data-mp="0"]`).click());
await pg.waitForTimeout(1500);
const q0 = await pg.evaluate(() => window.H2K.V.QL);
await pg.evaluate(() => document.getElementById("tip").click());
let st;
const t0 = Date.now();
for (let i = 0; i < 150; i++) {
  await pg.waitForTimeout(2000);
  st = await pg.evaluate(() => ({ QL: window.H2K.V.QL, perf: window.H2K.V.perf }));
  if (st.QL === 0 && st.perf && st.perf.fps >= 20) break;
}
console.log("start QL", q0, "->", JSON.stringify(st), ((Date.now() - t0) / 1000).toFixed(0) + " s", errs.length ? errs.slice(0, 3) : "no errors");
await b.close();
process.exit(q0 === 2 && st.QL < 2 && !errs.length ? 0 : 1);
