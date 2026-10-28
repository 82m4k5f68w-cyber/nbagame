// Motion Studio (MediaPipe in the browser, everything inlined): the sample clip -> pose found on most frames, the knee /
// thigh curves move like a jog, Record -> Export JSON -> video2bvh.py turns it into a BVH. Builds unless --nobuild.
//   node tests/browser_motion.mjs [--nobuild]
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { execSync, execFileSync } from "node:child_process";
if (!process.argv.includes("--nobuild")) execSync("npx vite build --config scripts/assets/demo.vite.ts", { stdio: "ignore", env: { ...process.env, LAB: "motion" } });
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await b.newContext({ acceptDownloads: true, viewport: { width: 1000, height: 900 } }),
  pg = await ctx.newPage(),
  errs = [];
pg.on("pageerror", (e) => errs.push(String(e)));
await pg.goto("file://" + path.resolve("dist/labs/motion/index.html"));
await pg.waitForFunction(() => window.__MOTION && (window.__MOTION.ready || window.__MOTION.errors.length), null, { timeout: 180000, polling: 250 });
await pg.click("#sample");
await pg.click("#rec");
await pg.waitForFunction(() => window.__MOTION.frames >= 45, null, { timeout: 240000, polling: 500 });
await pg.click("#rec");
const [dl] = await Promise.all([pg.waitForEvent("download"), pg.click("#save")]);
const S = process.env.TMPDIR || "/tmp",
  jf = path.join(S, "motion_test.json");
await dl.saveAs(jf);
const M = await pg.evaluate(() => {
  const r = (a) => (a.length ? Math.max(...a) - Math.min(...a) : 0);
  const m = window.__MOTION;
  return { frames: m.frames, found: m.found, loadMs: m.loadMs, kL: r(m.ch.kL), tL: r(m.ch.tL), tR: r(m.ch.tR), errors: m.errors };
});
await pg.screenshot({ path: "docs/motion-studio.png" }).catch(() => {});
await b.close();
const f = [...M.errors, ...errs];
if (M.found / M.frames < 0.8) f.push(`pose found on ${M.found}/${M.frames} frames`);
if (!(M.tL > 0.25 && M.tR > 0.25)) f.push("thigh swing too small " + M.tL + " " + M.tR);
let bvh = "";
try {
  const tools = process.env.H2K_TOOLS || "/home/user/tools";
  execFileSync(`${tools}/venv/bin/python`, ["-I", "scripts/assets/video2bvh.py", jf, path.join(S, "motion_test.bvh")], { stdio: "pipe" });
  bvh = fs.readFileSync(path.join(S, "motion_test.bvh"), "utf8");
  if (!/^HIERARCHY[\s\S]*MOTION[\s\S]*Frames: \d+/.test(bvh)) f.push("bad BVH from the export");
} catch (e) {
  f.push("video2bvh on the export failed: " + String(e.stderr || e).slice(-300));
}
console.log(JSON.stringify({ ...M, bvhFrames: (/Frames: (\d+)/.exec(bvh) || [])[1] }));
if (f.length) (console.log("FAIL\n  " + f.join("\n  ")), process.exit(1));
console.log("browser_motion OK");
