// LIFE town dressing on Medium (after `npm run build`): Kenney benches / bins / dumpsters / planters / parked cars,
// Blender driveway hoops + playground (instanced GLBs) and the KTX2 concrete / asphalt detail all load in the real
// world; navmesh errand walkers move along baked paths. SwiftShader ~1 fps: everything is read through H2K_LIFE.
import { chromium } from "playwright";
import path from "node:path";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const pg = await b.newPage({ viewport: { width: 960, height: 540 } });
const errs = [];
pg.on("pageerror", (e) => errs.push(String(e)));
await pg.addInitScript(() => localStorage.getItem("h2k_set") || localStorage.setItem("h2k_set", JSON.stringify({ q2: 1 })));
const ev = (f, a) => pg.evaluate(f, a);
const waitFor = (sel, ms = 60000) => pg.waitForFunction((s) => !!document.querySelector(s), sel, { timeout: ms, polling: 100 });
const fails = [];
const ok = (c, m) => (c ? console.log("ok  ", m) : (fails.push(m), console.log("FAIL", m)));
await pg.goto("file://" + path.resolve("dist/hoops2k27-hub.html") + "?life&nointro&lifetest&nocloud");
await waitFor("#life [data-new]");
await ev(() => document.querySelector("#life [data-new='0']").click());
await pg.fill("#cn", "Prop Kid");
await ev(() => document.querySelector("#cgo").click());
await waitFor("#life .cut button");
await ev(() => document.querySelector("#life .cut button").click());
await pg.waitForFunction(() => window.H2K_LIFE && H2K_LIFE.mode === "world", null, { polling: 100, timeout: 60000 });
const st = await pg
  .waitForFunction(() => H2K_LIFE.W && H2K_LIFE.W.props && H2K_LIFE.W.props(), null, { polling: 250, timeout: 180000 })
  .then((h) => h.jsonValue())
  .catch(() => null);
console.log(JSON.stringify(st));
ok(st, "props loaded");
if (st) {
  ok(st.bench >= 6 && st.bin >= 6, `benches ${st.bench} / bins ${st.bin}`);
  ok(st.cars >= 10, `Kenney parked cars ${st.cars}`);
  ok(st.hoops >= 1 && st.playground === 1, `driveway hoops ${st.hoops}, playground ${st.playground}`);
  ok(st.tex >= 2, `KTX2 detail on sidewalks / roads (${st.tex})`);
  ok(st.parts > 10, `instanced parts ${st.parts}`);
}
const draws = await ev(() => H2K_LIFE.W.R.info.render.calls);
ok(draws > 0 && draws < 900, "draw calls with props " + draws);
await pg.screenshot({ path: "docs/life-props.png" }).catch(() => {});
await b.close();
fails.push(...errs);
if (fails.length) (console.log("FAIL\n  " + fails.join("\n  ")), process.exit(1));
console.log("browser_life_props OK");
