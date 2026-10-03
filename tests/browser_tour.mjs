// Online extras through the relay: a 1v1 tournament bracket with three players (one bye, then the final) and a 3v3
// online game (team size picked in the lobby). Host + two guest pages.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
const PORT = 19900 + Math.floor(Math.random() * 90);
const relay = spawn(process.execPath, ["--import", "tsx", "server/relay.ts", String(PORT)], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise((r) => relay.stdout.on("data", (d) => String(d).includes("relay on") && r()));
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const errs = [];
async function page(tag, mode) {
  const pg = await b.newPage({ viewport: { width: 1000, height: 800 } });
  pg.on("pageerror", (e) => errs.push(tag + ": " + e));
  await pg.goto(`http://127.0.0.1:${PORT}/?nointro`);
  await pg.waitForTimeout(300);
  await pg.evaluate((m) => window.go(m, 0, 0, true), mode);
  await pg.waitForFunction(() => document.getElementById("nm"), null, { timeout: 20000 });
  return pg;
}
const finish = (H) =>
  H.evaluate(() => {
    const G = window.H2K.G;
    for (let i = 0; i < 400 && G.JB; i++) G.upd(1 / 60);
    G.sc[0] = 15;
    G.sc[1] = 9;
    for (let q = 0; q < 6 && G.S === "play"; q++) {
      G.setClock(0);
      G.setRs(0);
      G.setInb(0);
      for (let i = 0; i < 20 && G.S === "play"; i++) G.upd(1 / 60);
    }
  });
let ok = true;
const res = {};
try {
  // ---- tournament (1v1)
  const H = await page("host", "1v1-2d");
  await H.evaluate(() => {
    document.getElementById("nm").value = "Hosty";
    document.getElementById("cr").click();
  });
  await H.waitForFunction(() => window.H2K.NET.code, null, { timeout: 20000 });
  const code = await H.evaluate(() => window.H2K.NET.code);
  const gs = [];
  for (const n of ["Ann", "Bo"]) {
    const g = await page(n, "1v1-2d");
    await g.evaluate(([c, n]) => {
      document.getElementById("nm").value = n;
      document.getElementById("cd").value = c;
      document.getElementById("jn").click();
    }, [code, n]);
    await g.waitForSelector('[data-sd="-1"]', { timeout: 30000 });
    await g.evaluate(() => document.querySelector('[data-sd="-1"]').click());
    gs.push(g);
  }
  await H.waitForFunction(() => document.getElementById("trn"), null, { timeout: 30000 });
  await H.waitForTimeout(1500);
  await H.evaluate(() => document.getElementById("trn").click());
  await H.waitForFunction(() => window.H2K.G.S === "play", null, { timeout: 20000 });
  res.t0 = await H.evaluate(() => window.H2K.NET.dbg && window.H2K.G.CT.length);
  await finish(H);
  await H.waitForFunction(() => document.getElementById("ntm"), null, { timeout: 30000 });
  res.bracket1 = await H.evaluate(() => document.querySelector(".fin").innerText.includes("TOURNAMENT"));
  await H.evaluate(() => document.getElementById("ntm").click());
  await H.waitForFunction(() => window.H2K.G.S === "play", null, { timeout: 20000 });
  await finish(H);
  await H.waitForFunction(() => /wins the tournament/.test(document.querySelector(".fin") ? document.querySelector(".fin").innerText : ""), null, { timeout: 30000 });
  res.champ = true;
  res.guestSaw = await gs[0].evaluate(() => !!(document.querySelector(".fin") || document.querySelector("canvas")));
  await H.evaluate(() => document.getElementById("pa").click());
  for (const g of gs) await g.close();
  await H.close();
  // ---- 3v3 online
  const H3 = await page("host3", "5v5-2d");
  await H3.evaluate(() => {
    document.getElementById("nm").value = "Hosty";
    document.getElementById("cr").click();
  });
  await H3.waitForFunction(() => window.H2K.NET.code, null, { timeout: 20000 });
  const code3 = await H3.evaluate(() => window.H2K.NET.code);
  await H3.evaluate(() => document.querySelector('[data-np="3"]').click());
  const g3 = await page("guest3", "5v5-2d");
  await g3.evaluate((c) => {
    document.getElementById("nm").value = "Cy";
    document.getElementById("cd").value = c;
    document.getElementById("jn").click();
  }, code3);
  await g3.waitForSelector('[data-sd="1"]', { timeout: 30000 });
  await g3.evaluate(() => document.querySelector('[data-sd="1"]').click());
  await g3.waitForTimeout(800);
  await g3.evaluate(() => document.getElementById("rd").click());
  await H3.waitForFunction(() => document.getElementById("go") && !document.getElementById("go").style.opacity, null, { timeout: 30000 });
  await H3.evaluate(() => document.getElementById("go").click());
  await g3.waitForFunction(() => window.H2K.G.S === "play" && window.H2K.G.P.length === 6, null, { timeout: 30000 });
  res.v3 = await g3.evaluate(() => window.H2K.G.P.length);
} catch (e) {
  console.log("ERR", e.message);
  ok = false;
}
console.log(JSON.stringify(res), errs.length ? errs.slice(0, 5) : "no page errors");
ok = ok && res.bracket1 && res.champ && res.v3 === 6 && !errs.length;
console.log(ok ? "TOUR OK" : "TOUR FAIL");
await b.close();
relay.kill();
process.exit(ok ? 0 : 1);
