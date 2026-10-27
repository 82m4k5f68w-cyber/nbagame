// Browser smoke test: hub -> each main mode -> tip off -> 5 sim-seconds -> renderer/physics/errors + screenshots.
// Usage: node tests/browser.mjs [mode ...]   (headless Chromium has no GPU; drive the sim with upd() instead of waiting)
import { chromium } from "playwright";
import path from "node:path";
const modes = process.argv.slice(2).length ? process.argv.slice(2) : ["5v5-3d", "5v5-2d", "1v1-3d", "1v1-2d"];
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
let bad = 0;
for (const m of modes) {
  const pg = await b.newPage({ viewport: { width: 1000, height: 900 } });
  const errs = [];
  pg.on("pageerror", (e) => errs.push(String(e)));
  // SwiftShader reads as a software GPU (Low by default): screenshot the High tier like a desktop GPU would draw it
  await pg.addInitScript(() => localStorage.getItem("h2k_set") || localStorage.setItem("h2k_set", JSON.stringify({ q2: 2 })));
  pg.on("console", (msg) => msg.type() === "error" && errs.push("console:" + msg.text()));
  await pg.goto("file://" + path.resolve("dist/hoops2k27-hub.html") + "?nointro");
  await pg.waitForTimeout(500);
  await pg.evaluate((m) => document.querySelector(`button[data-g="${m}"][data-my="0"][data-mp="0"]`).click(), m);
  await pg.waitForTimeout(1200);
  await pg.evaluate(() => document.getElementById("tip").click());
  await pg.evaluate(async () => {
    const { G } = window.H2K;
    G.setInb(0);
    for (let i = 0; i < 300; i++) G.upd(1 / 60);
  });
  for (const k of ["KeyD", "KeyW", "KeyX"]) {
    await pg.keyboard.down(k);
    await pg.waitForTimeout(250);
    await pg.keyboard.up(k);
  }
  await pg.keyboard.down("Space");
  await pg.waitForTimeout(400);
  await pg.keyboard.up("Space");
  await pg.waitForTimeout(800);
  // crowd chants: the buffers render in the background, the director answers a scripted airball, a chant plays
  const ch = await pg.evaluate(async () => {
    const { crowd, CC } = window.H2K;
    for (let i = 0; i < 100 && crowd.stats().ready.length < 6; i++) await new Promise((r) => setTimeout(r, 100));
    // a chant already running (busy) would hold the airball until it expires: start from an idle director, then
    // poll (SwiftShader 3D runs a few frames per second and the director only advances in the game loop)
    crowd.dir.busy = 0;
    crowd.fx({ k: "air", v: 1, tm: 1, n: "x" }, CC);
    for (let i = 0; i < 30 && !crowd.stats().log.some((l) => l.id === "airball"); i++) await new Promise((r) => setTimeout(r, 100));
    const played = crowd.play("defense");
    const s = crowd.stats();
    return { ready: s.ready.length, renderMs: s.renderMs, errors: s.errors, air: s.log.some((l) => l.id === "airball"), played, live: CC.live };
  });
  if (ch.errors.length || ch.ready < 6 || !ch.played || (ch.live && !ch.air)) errs.push("chants: " + JSON.stringify(ch));
  const st = await pg.evaluate(async () => ({ chants: 0, gl: window.H2K.V.GL ? "webgl" : window.H2K.V.r3d ? "canvas3d" : "2d", rap: await window.H2K.RAP(), S: window.H2K.G.S, np: window.H2K.G.P.length, t: window.H2K.G.T.toFixed(1) }));
  await pg.screenshot({ path: `docs/shot-${m}.png`, clip: { x: 20, y: 0, width: 960, height: 540 }, timeout: 120000 });
  st.chants = ch;
  console.log(m, JSON.stringify(st), errs.length ? errs.slice(0, 4) : "no errors");
  if (errs.length || st.S !== "play") bad++;
  await pg.close();
}
await b.close();
process.exit(bad ? 1 : 0);
