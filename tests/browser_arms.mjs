// Arms are visible on every graphics tier (bug report "arms don't show"): in the Animation Studio the focused
// player stands in his idle pose; we screenshot him, then collapse both arm chains (shoulder bones scaled to ~0) and
// screenshot again. The arms must account for a real share of the pixels around the shoulders on Low, Medium and
// High (and with WebGPU when the browser has it: ?webgpu). Run after `npm run build`:  node tests/browser_arms.mjs
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exe = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const b = await chromium.launch({ executablePath: exe, args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const fails = [];
for (const Q of [0, 1, 2]) {
  const pg = await b.newPage({ viewport: { width: 800, height: 520 } });
  const errs = [];
  pg.on("pageerror", (e) => errs.push(String(e)));
  await pg.addInitScript((q) => {
    try {
      localStorage.setItem("h2k_set", JSON.stringify({ q2: q, fx: 0 }));
    } catch (e) {}
  }, Q);
  await pg.goto("file://" + root + "/dist/hoops2k27-hub.html?nointro");
  await pg.waitForTimeout(300);
  await pg.evaluate(() => document.querySelector('button[data-g="1v1-3d"][data-my="0"][data-mp="0"]').click());
  await pg.waitForTimeout(1000);
  await pg.evaluate(() => {
    document.getElementById("tip")?.click();
    window.H2K.studio();
    const st = document.createElement("style");
    st.textContent = "#h,#studio,#tc{visibility:hidden!important}";
    document.head.appendChild(st);
  });
  await pg.waitForTimeout(400);
  const shot = async (collapse) => {
    const box = await pg.evaluate((collapse) => {
      const H = window.H2K,
        p = H.V.focusP();
      H.studioPose(0, 1.2, 0.0); // idle, camera square in front
      Object.assign(H.V.studio, { d: 9, h: (p.ht / 6.4) * 4.6, dy: 0.2 });
      for (const b of [p.gl.sL, p.gl.sR]) b.scale.setScalar(collapse ? 1e-3 : 1);
      // only the player (and the lights) in the frame: no crowd / arena motion to compare against
      const S = p.gl.G.parent;
      for (const c of S.children) if (c !== p.gl.G && !c.isLight) c.visible = false;
      S.background = null;
      S.fog = null;
      for (let i = 0; i < 3; i++) H.V.GL.render();
      const r = document.getElementById("c").getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }, collapse);
    return pg.screenshot({ clip: { x: box.x + box.w * 0.25, y: box.y + box.h * 0.15, width: box.w * 0.5, height: box.h * 0.6 }, timeout: 300000 });
  };
  await shot(false); // warm-up (the hidden arena drops out of the first frame)
  const a = await shot(false),
    a2 = await shot(false),
    c = await shot(true);
  const cmp = (a, c) => pg.evaluate(
    async ([a, c]) => {
      const load = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = "data:image/png;base64," + s; });
      const [ia, ic] = await Promise.all([load(a), load(c)]);
      const cv = document.createElement("canvas");
      cv.width = ia.width;
      cv.height = ia.height;
      const x = cv.getContext("2d", { willReadFrequently: true });
      x.drawImage(ia, 0, 0);
      const da = x.getImageData(0, 0, cv.width, cv.height).data;
      x.drawImage(ic, 0, 0);
      const dc = x.getImageData(0, 0, cv.width, cv.height).data;
      let n = 0;
      for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - dc[i]) + Math.abs(da[i + 1] - dc[i + 1]) + Math.abs(da[i + 2] - dc[i + 2]) > 40) n++;
      return n / (da.length / 4);
    },
    [a.toString("base64"), c.toString("base64")],
  );
  // frame-to-frame noise (crowd, flags, lights) is measured with two identical shots and taken off
  if (process.env.ARMDBG) for (const [n, im] of [["a", a], ["a2", a2], ["c", c]]) (await import("fs")).writeFileSync(process.env.ARMDBG + `/arms_q${Q}_${n}.png`, im);
  const noise = await cmp(a, a2),
    diff = (await cmp(a, c)) - noise;
  console.log(`QL ${Q}: arm pixels ${(diff * 100).toFixed(2)}% of the frame around the player (noise ${(noise * 100).toFixed(2)}%)`);
  if (diff < 0.01) fails.push(`QL ${Q}: arms cover only ${(diff * 100).toFixed(2)}%`);
  if (errs.length) fails.push(`QL ${Q}: page errors ${errs.slice(0, 3).join(" | ")}`);
  await pg.close();
}
await b.close();
console.log(fails.length ? "ARMS FAIL\n" + fails.join("\n") : "ARMS OK");
process.exit(fails.length ? 1 : 0);
