// Sample clip for the mocap pipeline: renders the game's own rig (Animation Studio, dist build) doing one move from
// the side and encodes it as an MP4 - no third-party footage, so it is free to commit / redistribute.
//   npm run build && node scripts/assets/sample_clip.mjs [anim index=2 (Jog)] [seconds=3] [out=assets/mocap/sample_jog.mp4]
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const [ai = "2", secs = "3", out = "assets/mocap/sample_jog.mp4"] = process.argv.slice(2);
const FPS = +(process.env.FPS || 15),
  tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "h2kclip-"));
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const pg = await b.newPage({ viewport: { width: 480, height: 480 } });
await pg.goto("file://" + path.resolve("dist/hoops2k27-hub.html") + "?nointro");
await pg.waitForTimeout(400);
await pg.evaluate(() => document.querySelector('button[data-g="1v1-3d"][data-my="0"][data-mp="0"]').click());
await pg.waitForTimeout(1200);
await pg.evaluate(() => {
  document.getElementById("tip")?.click();
  window.H2K.studio();
  const st = document.createElement("style");
  st.textContent = "#h,#studio,#tc{visibility:hidden!important}"; // just the player, no UI
  document.head.appendChild(st);
});
await pg.waitForTimeout(600);
const n = Math.round(+secs * FPS);
for (let f = 0; f < n; f++) {
  await pg.evaluate(([i, t]) => {
    const H = window.H2K;
    H.studioPose(i, t, Math.PI / 2); // side view
    Object.assign(H.V.studio, { d: 16 });
    H.V.GL.render();
  }, [+ai, 1 + f / FPS]);
  await pg.screenshot({ path: path.join(tmp, `f${String(f).padStart(4, "0")}.png`) });
}
await b.close();
fs.mkdirSync(path.dirname(out), { recursive: true });
execFileSync("ffmpeg", ["-y", "-v", "error", "-framerate", String(FPS), "-i", path.join(tmp, "f%04d.png"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "26", out]);
fs.rmSync(tmp, { recursive: true });
console.log(`sample_clip: ${n} frames -> ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
