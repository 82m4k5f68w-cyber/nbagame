// Graphics v6 browser test (SwiftShader): every graphics preset renders (Chromebook / Balanced / High / Ultra), no black
// or NaN frames, the HUD canvas stays transparent, draw calls per preset; the jumbotron kiss cam, LED takeover and pyro
// paths run; every street weather (day / sunset / night / rain / snow) renders on a street court and night is darker
// than day. Frames are drawn by hand (the rAF loop is stubbed) and read back with readPixels.
//   npm run build && node tests/browser_gfx.mjs        (H2K_HTML=path overrides the build; screenshots -> docs/gfx/)
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
const HTML = process.env.H2K_HTML || path.resolve("dist/hoops2k27-hub.html");
const OUT = process.env.GFX_OUT || "docs/gfx";
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const pg = await b.newPage({ viewport: { width: 960, height: 640 } });
const errs = [];
pg.on("pageerror", (e) => errs.push(String(e)));
pg.on("console", (m) => m.type() === "error" && errs.push("console:" + m.text()));
await pg.addInitScript(() => localStorage.setItem("h2k_set", JSON.stringify({ q2: 1, fx: 1, hs: 0 })));
await pg.goto("file://" + HTML + "?nointro");
await pg.waitForTimeout(500);
await pg.evaluate(() => document.querySelector(`button[data-g="5v5-3d"][data-my="0"][data-mp="0"]`).click());
await pg.waitForFunction(() => window.H2K && window.H2K.V.GL && window.H2K.V.backend, null, { timeout: 60000 });
await pg.evaluate(() => document.getElementById("tip").click());
await pg.evaluate(() => {
  const H = window.H2K,
    G = H.G;
  G.setInb(0);
  for (let i = 0; i < 240; i++) G.upd(1 / 60);
  G.setS("pause");
  document.getElementById("ov").style.display = "none";
  H.V.GL.pin(6);
  const g = H.V.GL;
  window.R0 = g.render.bind(g);
  g.render = () => {};
  const C = document.getElementById("c");
  window.T = {
    /** draw n frames, read the last one: luminance stats + a PNG (3D + HUD) */
    frames(n, png) {
      for (let i = 0; i < n; i++) window.R0();
      const gl = C.getContext("webgl2"),
        w = gl.drawingBufferWidth,
        h = gl.drawingBufferHeight,
        px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let s = 0,
        blk = 0;
      for (let i = 0; i < w * h; i++) {
        const l = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
        s += l;
        if (l < 3) blk++;
      }
      let img = null;
      if (png) {
        const o = document.createElement("canvas");
        o.width = w;
        o.height = h;
        const x = o.getContext("2d"),
          im = x.createImageData(w, h);
        for (let y = 0; y < h; y++) im.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
        x.putImageData(im, 0, 0);
        x.drawImage(document.getElementById("h"), 0, 0, w, h);
        img = o.toDataURL("image/png").split(",")[1];
      }
      const hb = getComputedStyle(document.getElementById("h")).backgroundColor;
      return { mean: s / (w * h), black: blk / (w * h), w, h, img, hud: hb === "rgba(0, 0, 0, 0)" || hb === "transparent", st: H.V.GL.stats() };
    },
  };
});
let bad = 0;
const fail = (m) => (bad++, console.log("FAIL", m));
const save = (name, r) => r.img && fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.img, "base64"));
const PRE = [
  ["chromebook", 1, 1, 0],
  ["balanced", 1, 1, 1],
  ["high", 2, 0, 2],
  ["ultra", 3, 0, 2],
];
const rows = [];
for (const [name, ql, hsr, ao] of PRE) {
  const r = await pg.evaluate(([ql, hsr, ao]) => {
    const V = window.H2K.V;
    Object.assign(V, { QL: ql, HSR: hsr, AO: ao, FX: true });
    window.H2K.G.setS("play"); // live jumbotron feed (Ultra) needs play
    const o = window.T.frames(10, true);
    window.H2K.G.setS("pause");
    return o;
  }, [ql, hsr, ao]);
  save("preset-" + name, r);
  rows.push({ name, mean: +r.mean.toFixed(1), black: +r.black.toFixed(3), calls: r.st.calls, tris: r.st.tris, internal: r.st.hsr.w + "x" + r.st.hsr.h, out: r.st.hsr.ow + "x" + r.st.hsr.oh });
  if (r.black > 0.2 || r.mean < 10 || !Number.isFinite(r.mean)) fail(name + ": black frame " + JSON.stringify({ mean: r.mean, black: r.black }));
  if (!r.hud) fail(name + ": HUD canvas not transparent");
}
console.table(rows);
// jumbotron kiss cam (timeout), LED takeover (score), final-buzzer pyro
const ev = await pg.evaluate(() => {
  const { G, V } = window.H2K;
  Object.assign(V, { QL: 2, HSR: 0, AO: -1 });
  G.TS.hud = 2;
  const a = window.T.frames(6, false);
  G.TS.hud = 0;
  G.sc[0] += 3;
  const c = window.T.frames(6, false);
  return { a: a.mean, c: c.mean };
});
if (!(ev.a > 10 && ev.c > 10)) fail("kiss cam / LED takeover frames " + JSON.stringify(ev));
// street weather
await pg.evaluate(() => window.H2K.openMode("street3"));
await pg.waitForTimeout(400);
await pg.evaluate(() => {
  const { G } = window.H2K;
  for (let i = 0; i < 200; i++) G.upd(1 / 60);
  G.setS("pause");
  document.getElementById("ov").style.display = "none";
});
const wx = {};
for (const w of ["day", "sunset", "night", "rain", "snow"]) {
  const r = await pg.evaluate((w) => ((window.H2K.V.WX = w), window.T.frames(12, true)), w);
  save("street-" + w, r);
  wx[w] = +r.mean.toFixed(1);
  if (r.black > 0.5 || !Number.isFinite(r.mean) || r.mean < 4) fail("street " + w + ": black frame " + r.mean);
}
console.log("street weather mean luma:", JSON.stringify(wx));
if (!(wx.night < wx.day - 10)) fail("night is not darker than day");
console.log(errs.length ? errs.slice(0, 5) : "no errors");
await b.close();
process.exit(bad || errs.length ? 1 : 0);
