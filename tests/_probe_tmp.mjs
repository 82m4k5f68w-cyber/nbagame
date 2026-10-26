import { chromium } from "playwright";
import path from "node:path";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const pg = await b.newPage({ viewport: { width: 1000, height: 900 } });
pg.on("pageerror", (e) => console.log("ERR", String(e)));
await pg.addInitScript(() => localStorage.setItem("h2k_set", JSON.stringify({ q2: 1, fx: 1, hs: 4, hm: 1 })));
await pg.goto("file://" + path.resolve("/home/user/testing/dist/hoops2k27-hub.html") + "?nointro");
await pg.waitForTimeout(500);
await pg.evaluate(() => document.querySelector(`button[data-g="5v5-3d"][data-my="0"][data-mp="0"]`).click());
await pg.waitForFunction(() => window.H2K && window.H2K.V.GL && window.H2K.V.backend, null, { timeout: 60000 });
await pg.evaluate(() => document.getElementById("tip").click());
const r = await pg.evaluate(() => {
  const H = window.H2K; H.G.setInb(0); for (let i = 0; i < 120; i++) H.G.upd(1 / 60);
  H.G.setS("pause"); H.V.GL.pin(6);
  const out = [];
  for (let i = 0; i < 6; i++) { H.V.netCam = { b: 1, a: 2.2 + i * 0.035, d: 9, h: 8.2 }; H.V.GL.render();
    out.push([[0.5, 0.5], [0.5, 0.2], [0.2, 0.5], [0.8, 0.8]].map(([u, v]) => H.V.GL.hsrProbe(u, v).map((x) => +x.toFixed(4)))); }
  return { out, st: H.V.GL.stats() };
});
console.log(JSON.stringify(r.out.slice(2)), JSON.stringify(r.st.hsr));
await b.close();
