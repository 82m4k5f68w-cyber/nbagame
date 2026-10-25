// H2K Super Resolution (HSR) browser test: every mode / upscaler switches without errors, the internal resolution
// follows the mode while the output canvas stays full size (and the HUD canvas transparent), no black / NaN frames;
// plus measurements on SwiftShader (CPU-rendered: absolute fps means nothing, so we compare relative frame cost,
// pixel counts, draw calls, SSIM vs native, ghosting on an orbiting camera and thin-line (net cord) flicker).
//   npm run build && node tests/browser_hsr.mjs [webgpu]
// Screenshots: docs/hsr/*.png
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
const GPU = process.argv.includes("webgpu");
fs.mkdirSync("docs/hsr", { recursive: true });
const b = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: GPU
    ? ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-vulkan=swiftshader", "--use-webgpu-adapter=swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"]
    : ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const pg = await b.newPage({ viewport: { width: 1000, height: 900 } });
const errs = [];
pg.on("pageerror", (e) => errs.push(String(e)));
pg.on("console", (m) => m.type() === "error" && errs.push("console:" + m.text()));
const QL = +(process.env.QL ?? 1);
await pg.addInitScript((ql) => localStorage.setItem("h2k_set", JSON.stringify({ q2: ql, fx: 1, hs: 0, fc: 1 })), QL);
await pg.goto("file://" + path.resolve("dist/hoops2k27-hub.html") + "?nointro" + (GPU ? "&webgpu" : ""));
await pg.waitForTimeout(500);
await pg.evaluate(() => document.querySelector(`button[data-g="5v5-3d"][data-my="0"][data-mp="0"]`).click());
await pg.waitForFunction(() => window.H2K && window.H2K.V.GL && window.H2K.V.backend, null, { timeout: 60000 });
await pg.evaluate(() => document.getElementById("tip").click());
await pg.evaluate(() => {
  const { G } = window.H2K;
  G.setInb(0);
  for (let i = 0; i < 240; i++) G.upd(1 / 60);
  G.setS("pause"); // frozen scene: equal-scene comparisons
  document.getElementById("ov").style.display = "none";
  window.H2K.V.GL.pin(6); // the frame-rate ladder would change the resolution under SwiftShader mid-comparison
});
let bad = 0;
const fail = (m) => (bad++, console.log("FAIL", m));
// in-page helpers: draw frames by hand, read pixels, SSIM / flicker metrics
await pg.evaluate((GPU) => {
  const H = window.H2K,
    C = document.getElementById("c");
  const gl = GPU ? null : C.getContext("webgl2");
  const read = () => {
    if (!gl) return null;
    const w = gl.drawingBufferWidth,
      h = gl.drawingBufferHeight,
      px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const L = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) L[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    return { w, h, L };
  };
  window.T = {
    frames(n, f) {
      let last = null;
      for (let i = 0; i < n; i++) {
        if (f) f(i);
        H.V.GL.render();
        if (i === n - 1) last = read();
      }
      return last;
    },
    time(n) {
      H.V.GL.render();
      read();
      const t0 = performance.now();
      for (let i = 0; i < n; i++) H.V.GL.render();
      read(); // sync: waits for the GPU (SwiftShader: the CPU) to finish
      return (performance.now() - t0) / n;
    },
    lum(a) {
      let s = 0,
        blk = 0;
      for (let i = 0; i < a.L.length; i++) (s += a.L[i]), a.L[i] < 3 && blk++;
      return { mean: s / a.L.length, black: blk / a.L.length };
    },
    ssim(a, b, x0 = 0, y0 = 0, x1 = a.w, y1 = a.h) {
      if (a.w !== b.w || a.h !== b.h) return -1;
      const c1 = 6.5, c2 = 58.5;
      let s = 0, n = 0;
      for (let y = y0; y + 8 <= y1; y += 4)
        for (let x = x0; x + 8 <= x1; x += 4) {
          let ma = 0, mb = 0, va = 0, vb = 0, cv = 0;
          for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { const k = (y + j) * a.w + x + i; ma += a.L[k]; mb += b.L[k]; }
          ma /= 64; mb /= 64;
          for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { const k = (y + j) * a.w + x + i, da = a.L[k] - ma, db = b.L[k] - mb; va += da * da; vb += db * db; cv += da * db; }
          va /= 63; vb /= 63; cv /= 63;
          s += ((2 * ma * mb + c1) * (2 * cv + c2)) / ((ma * ma + mb * mb + c1) * (va + vb + c2)); n++;
        }
      return s / n;
    },
    /** mean abs luma change between consecutive frames inside a box (thin-feature flicker) */
    flicker(n, box, f) {
      let prev = null, s = 0, k = 0;
      for (let i = 0; i < n; i++) {
        if (f) f(i);
        H.V.GL.render();
        const r = read();
        if (prev) {
          let d = 0, m = 0;
          for (let y = box[1]; y < box[3]; y++) for (let x = box[0]; x < box[2]; x++) { const q = y * r.w + x; d += Math.abs(r.L[q] - prev.L[q]); m++; }
          s += d / m; k++;
        }
        prev = r;
      }
      return s / k;
    },
  };
}, GPU);
const set = (hsr, m) => pg.evaluate(([hsr, m]) => ((window.H2K.V.HSR = hsr), (window.H2K.V.HSRM = m)), [hsr, m]);
const stats = () => pg.evaluate(() => window.H2K.V.GL.stats());
const shot = async (name) => {
  const bb = await pg.evaluate(() => { const r = document.getElementById("c").getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  await pg.screenshot({ path: `docs/hsr/${name}.png`, clip: bb, timeout: 120000 });
};
const canvasOK = () =>
  pg.evaluate(() => {
    const c = document.getElementById("c"),
      h = document.getElementById("h"),
      bg = getComputedStyle(h).backgroundColor;
    return { cw: c.width, ch: c.height, hudTransparent: bg === "rgba(0, 0, 0, 0)" || bg === "transparent" };
  });

// ---- 1) every mode x upscaler: switches, sizes, no black frames ----
const MODES = [
  [0, 0, "native"],
  [2, 1, "quality-T"],
  [3, 1, "balanced-T"],
  [4, 1, "performance-T"],
  [5, 1, "ultra-T"],
  [3, 2, "balanced-S"],
  [4, 2, "performance-S"],
  [1, 1, "auto-T"],
];
const SC = [1, 1, 0.67, 0.58, 0.5, 0.33];
await set(0, 0);
await pg.evaluate(() => window.T.frames(50)); // the broadcast camera eases in: let it settle first
const c0 = await canvasOK();
const rows = [];
for (const [h, m, name] of process.env.SKIP1 ? [] : MODES) {
  await set(h, m);
  const r = await pg.evaluate((GPU) => {
    const f = window.T.frames(GPU ? 6 : 24); // temporal converges over ~16-32 jittered frames
    if (f) window.REF = window.REF || f;
    return f ? { ...window.T.lum(f), ssim: window.T.ssim(window.REF, f) } : null;
  }, GPU);
  const st = await stats();
  const ms = await pg.evaluate((GPU) => window.T.time(GPU ? 3 : 6), GPU);
  const cv = await canvasOK();
  await shot(name);
  const hs = st.hsr;
  rows.push({ name, mode: hs.mode, scale: hs.scale, internal: hs.w + "x" + hs.h, output: hs.ow + "x" + hs.oh, px: hs.w * hs.h, calls: st.calls, ms: +ms.toFixed(1), mean: r && +r.mean.toFixed(1), black: r && +r.black.toFixed(3), ssim: r && +r.ssim.toFixed(4) });
  if (cv.cw !== c0.cw || cv.ch !== c0.ch) fail(name + ": output canvas resized " + JSON.stringify(cv));
  if (!cv.hudTransparent) fail("HUD canvas not transparent");
  if (h > 1 && (Math.abs(hs.scale - SC[h]) > 0.001 || Math.abs(hs.w / hs.ow - SC[h]) > 0.02)) fail(name + ": internal width " + hs.w + " vs output " + hs.ow);
  if (h === 0 && hs.mode !== 0) fail("native mode reports HSR " + hs.mode);
  if (h > 0 && hs.mode !== m) fail(name + ": upscaler " + hs.mode + " != " + m);
  if (r && (r.black > 0.2 || r.mean < 8)) fail(name + ": black frame " + JSON.stringify(r));
}
const base = rows[0] || {};
for (const r of rows) (r.cost = +(r.ms / base.ms).toFixed(2)), (r.pxRel = +(r.px / base.px).toFixed(2));
console.table(rows);

// ---- 2) ghosting on an orbiting camera, thin-line flicker (net cords), history vs no history ----
if (!GPU) {
  const g = await pg.evaluate(async () => {
    const H = window.H2K, T = window.T, out = {};
    const pose = (k) => (H.V.netCam = { b: 1, a: 2.2 + k * 0.035, d: 9, h: 8.2 });
    const run = (hsr, m, f) => { H.V.HSR = hsr; H.V.HSRM = m; return T.frames(16, (i) => (pose(i), f && f(i))); };
    const nat = run(0, 0);
    for (const [hsr, m, nm] of [[3, 1, "balanced-T"], [4, 1, "performance-T"], [4, 2, "performance-S"]]) out["moving " + nm] = +T.ssim(nat, run(hsr, m)).toFixed(4);
    // no-history control: reset every frame = raw jittered upscale
    out["moving performance-T no history"] = +T.ssim(nat, run(4, 1, () => H.V.GL.hsrReset())).toFixed(4);
    // static camera on the net: frame-to-frame flicker in the net box (thin cords)
    const box = [380, 120, 600, 420];
    const fl = (hsr, m, f) => { H.V.HSR = hsr; H.V.HSRM = m; pose(0); T.frames(16); return +T.flicker(8, box, f).toFixed(3); };
    out["flicker native"] = fl(0, 0);
    out["flicker balanced-T"] = fl(3, 1);
    out["flicker performance-T"] = fl(4, 1);
    out["flicker performance-T no history"] = fl(4, 1, () => H.V.GL.hsrReset());
    out["flicker performance-S"] = fl(4, 2);
    // static net close-up quality vs native (converged)
    const sn = (hsr, m) => { H.V.HSR = hsr; H.V.HSRM = m; pose(0); return T.frames(28); };
    const nn = sn(0, 0);
    for (const [hsr, m, nm] of [[2, 1, "quality-T"], [3, 1, "balanced-T"], [4, 1, "performance-T"], [4, 2, "performance-S"], [5, 1, "ultra-T"]]) out["net ssim " + nm] = +T.ssim(nn, sn(hsr, m)).toFixed(4);
    H.V.netCam = null;
    return out;
  });
  console.log("ghosting / thin lines:", JSON.stringify(g, null, 1));
  await set(4, 1);
  await pg.evaluate(() => ((window.H2K.V.netCam = { b: 1, a: 2.2, d: 9, h: 8.2 }), window.T.frames(40)));
  await shot("net-performance-T");
  await set(0, 0);
  await pg.evaluate(() => window.T.frames(3));
  await shot("net-native");
  await set(4, 2);
  await pg.evaluate(() => window.T.frames(3));
  await shot("net-performance-S");
  await pg.evaluate(() => (window.H2K.V.netCam = null));
  if (g["moving performance-T"] < g["moving performance-T no history"] - 0.02) fail("temporal ghosting: worse than no history while moving");
  if (g["flicker performance-T"] > g["flicker performance-T no history"]) fail("temporal history does not reduce thin-line flicker");
}

await pg.evaluate(() => window.H2K.V.GL.pin(-1));
// ---- 3) Auto: the real rAF loop on SwiftShader (very slow) must walk the internal scale down ----
await set(1, 1);
await pg.evaluate(() => window.H2K.G.setS("play"));
let au = null;
for (let i = 0; i < 20; i++) {
  await pg.waitForTimeout(1500);
  au = await stats();
  if (au.hsr.scale <= 0.46) break;
}
console.log("auto: scale", au.hsr.scale, au.hsr.w + "x" + au.hsr.h, "ladder", au.lvl, "perf", JSON.stringify(await pg.evaluate(() => window.H2K.V.perf)));
if (au.hsr.scale > 0.6) fail("auto did not lower the internal resolution on a crawling GPU");
await shot("auto-hud");
console.log(errs.length ? errs.slice(0, 5) : "no errors");
await b.close();
process.exit(bad || errs.length ? 1 : 0);
