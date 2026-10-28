// Tools Lab smoke test: ONNX Runtime Web runs the inlined pose model (matches PyTorch), Tone.js renders audio offline,
// three-gpu-pathtracer path-traces a Kenney bench + ball (photo mode). Builds dist/labs/tools unless --nobuild.
//   node tests/browser_tools.mjs [--nobuild]
import { chromium } from "playwright";
import path from "node:path";
import { execSync } from "node:child_process";
if (!process.argv.includes("--nobuild")) execSync("npx vite build --config scripts/assets/demo.vite.ts", { stdio: "ignore", env: { ...process.env, LAB: "tools" } });
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const pg = await b.newPage({ viewport: { width: 900, height: 900 } });
const errs = [];
pg.on("pageerror", (e) => errs.push(String(e)));
await pg.goto("file://" + path.resolve("dist/labs/tools/index.html"));
await pg.waitForFunction(() => window.__TOOLS && window.__TOOLS.done, null, { timeout: 300000, polling: 500 });
const R = await pg.evaluate(() => window.__TOOLS);
await pg.screenshot({ path: "docs/tools-lab.png" }).catch(() => {});
await b.close();
const f = [...R.errors, ...errs];
if (!(R.onnx && R.onnx.maxDiffVsTorch < 1e-4 && R.onnx.mseOut < R.onnx.mseIn)) f.push("onnx " + JSON.stringify(R.onnx));
if (!(R.tone && R.tone.rms > 0.005)) f.push("tone " + JSON.stringify(R.tone));
if (!(R.pathtracer && R.pathtracer.litFrac > 0.1)) f.push("pathtracer " + JSON.stringify(R.pathtracer));
console.log(JSON.stringify({ onnx: R.onnx, tone: R.tone, pathtracer: R.pathtracer }));
if (f.length) (console.log("FAIL\n  " + f.join("\n  ")), process.exit(1));
console.log("browser_tools OK");
