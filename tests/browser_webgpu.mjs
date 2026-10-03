// WebGPU renderer smoke test: Chromium's SwiftShader WebGPU adapter, ?webgpu, a 5v5 3D game for a few seconds.
// Passes if the WebGPU backend initializes, the game plays and nothing throws (else it reports the fallback).
import { chromium } from "playwright";
import path from "node:path";
const b = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-vulkan=swiftshader", "--use-webgpu-adapter=swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
});
const pg = await b.newPage({ viewport: { width: 960, height: 600 } });
const errs = [];
pg.on("pageerror", (e) => errs.push(String(e)));
await pg.goto("file://" + path.resolve("dist/hoops2k27-hub.html") + "?webgpu&nointro");
await pg.waitForTimeout(300);
await pg.evaluate(() => document.querySelector('button[data-g="5v5-3d"][data-my="0"][data-mp="0"]').click());
await pg.waitForFunction(() => window.H2K && window.H2K.V.backend, null, { timeout: 60000 });
await pg.evaluate(() => document.getElementById("tip").click());
await pg.waitForTimeout(5000);
const st = await pg.evaluate(() => ({ backend: window.H2K.V.backend, S: window.H2K.G.S, t: window.H2K.G.T.toFixed(1) }));
console.log(JSON.stringify(st), errs.length ? errs.slice(0, 3) : "no errors");
const ok = st.backend === "WebGPU" && st.S === "play" && !errs.length;
console.log(ok ? "WEBGPU OK" : "WEBGPU FAIL");
await b.close();
process.exit(ok ? 0 : 1);
