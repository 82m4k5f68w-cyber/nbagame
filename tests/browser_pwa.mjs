// PWA + device probe: serve dist over http, the hub registers dist/sw.js + the manifest, the probe stores h2k_probe,
// then the page reloads OFFLINE from the service worker cache. file:// and artifact.html never register a worker.
//   npm run build && node tests/browser_pwa.mjs
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const root = path.resolve("dist"),
  types = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const srv = http.createServer((q, r) => {
  const f = path.join(root, decodeURIComponent(q.url.split("?")[0]));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return r.writeHead(404).end();
  r.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" }).end(fs.readFileSync(f));
});
await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
const port = srv.address().port;
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await b.newContext({ viewport: { width: 1100, height: 760 } }),
  pg = await ctx.newPage(),
  errs = [],
  fails = [];
pg.on("pageerror", (e) => errs.push(String(e)));
await pg.goto(`http://127.0.0.1:${port}/hoops2k27-hub.html?nointro`);
const sw = await pg.evaluate(async () => {
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 30000))]);
  return { reg: !!reg, manifest: !!document.querySelector('link[rel="manifest"]'), install: !!document.getElementById("hinst") };
});
if (!sw.reg) fails.push("service worker not ready");
if (!sw.manifest) fails.push("no manifest link on http");
if (!sw.install) fails.push("no install button element");
const probe = await pg.waitForFunction(() => localStorage.getItem("h2k_probe"), null, { timeout: 30000 }).then((h) => h.jsonValue()).catch(() => null);
if (!probe) fails.push("device probe did not run");
const pr = probe && JSON.parse(probe);
if (pr && !(pr.cpuMs > 0)) fails.push("probe cpuMs " + pr.cpuMs);
await pg.reload(); // the worker now controls the page and caches it (NetworkFirst)
await pg.waitForTimeout(1500);
await ctx.setOffline(true);
await pg.reload().catch((e) => fails.push("offline reload: " + e.message));
const title = await pg.title().catch(() => "");
if (!/Hoops/.test(title)) fails.push("offline page title: " + title);
await ctx.setOffline(false);
// file:// (and the artifact copy) must not register anything
const fp = await ctx.newPage();
await fp.goto("file://" + path.join(root, "artifact.html"));
await fp.waitForTimeout(1500);
const fileSw = await fp.evaluate(() => ({ m: !!document.querySelector('link[rel="manifest"]'), a: !!window.__H2K_ARTIFACT }));
if (fileSw.m) fails.push("manifest link on file://");
if (!fileSw.a) fails.push("artifact flag missing");
await b.close();
srv.close();
fails.push(...errs);
console.log(JSON.stringify({ sw, probe: pr && { cpuMs: pr.cpuMs, gpuTier: pr.gpuTier, type: pr.type, preset: pr.preset, npc: pr.npc }, offlineTitle: title, fileSw }));
if (fails.length) (console.log("FAIL\n  " + fails.join("\n  ")), process.exit(1));
console.log("browser_pwa OK");
