// Asset Lab smoke test (textures KTX2 via the inlined Basis transcoder, Kenney kits via meshopt, voice bank decode,
// bundled detect-gpu tables). Builds dist/assets-demo/index.html first unless --nobuild.
//   node tests/browser_assets.mjs [--nobuild]
import { chromium } from "playwright";
import path from "node:path";
import { execSync } from "node:child_process";
if (!process.argv.includes("--nobuild")) execSync("npx vite build --config scripts/assets/demo.vite.ts", { stdio: "ignore" });
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const pg = await b.newPage({ viewport: { width: 1100, height: 800 } });
const errs = [];
pg.on("pageerror", (e) => errs.push(String(e)));
pg.on("console", (m) => m.type() === "error" && errs.push("console:" + m.text()));
await pg.goto("file://" + path.resolve("dist/assets-demo/index.html"));
await pg.waitForFunction(() => window.__ASSETS && window.__ASSETS.done, null, { timeout: 90000 });
const A = await pg.evaluate(() => window.__ASSETS);
// voice: decode + play a full commentary line and a PA intro through the real player
const V = await pg.evaluate(async () => {
  document.getElementById("line").value = "Curry from downtown... BANG!";
  document.getElementById("say").click();
  document.getElementById("intro").click();
  await new Promise((r) => setTimeout(r, 300));
  return document.getElementById("info").textContent.startsWith("no full match") ? "nomatch" : "ok";
});
await pg.screenshot({ path: "docs/asset-lab.png" }).catch(() => {});
await b.close();
const fails = [];
const tex = Object.entries(A.tex).filter(([k]) => k !== "ktx2");
if (!A.tex.ktx2) fails.push("KTX2 transcoder not initialised");
if (tex.length < 9) fails.push("texture sets loaded: " + tex.length);
for (const [k, t] of tex) if (!t.ktx2 || !t.normal) fails.push(`tex ${k}: ktx2=${t.ktx2} normal=${t.normal}`);
for (const k of ["city", "roads", "cars", "furniture"]) if (!(A.models[k] > 5)) fails.push("models " + k + ": " + A.models[k]);
if (!A.voice || A.voice.failed || !(A.voice.c > 300)) fails.push("voice bank: " + JSON.stringify(A.voice));
if (V !== "ok") fails.push("voice line did not match the bank");
if (!A.gpu || typeof A.gpu.tier !== "number") fails.push("detect-gpu: " + JSON.stringify(A.gpu));
fails.push(...A.errors, ...errs.filter((e) => !/AudioContext|autoplay/i.test(e)));
console.log(JSON.stringify({ ktx2: A.tex.ktx2, tex: tex.length, models: A.models, voice: A.voice, gpu: A.gpu && { tier: A.gpu.tier, gpu: A.gpu.gpu, type: A.gpu.type } }));
if (fails.length) (console.log("FAIL\n  " + fails.join("\n  ")), process.exit(1));
console.log("browser_assets OK");
