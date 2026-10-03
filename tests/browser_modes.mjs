// Game modes in the real page: every mode starts from the matchup screen's mode strip, runs, and finishes
// (shots are driven through the sim with perfect timing), the season records a game, halftime appears and resumes,
// the settings drawer's new sections exist, and nothing throws.
import { chromium } from "playwright";
import path from "node:path";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const pg = await b.newPage({ viewport: { width: 1200, height: 900 } });
const errs = [];
pg.on("pageerror", (e) => errs.push(String(e)));
const url = "file://" + path.resolve("dist/hoops2k27-hub.html");
await pg.goto(url);
await pg.waitForTimeout(400);
await pg.evaluate(() => document.querySelector('button[data-g="5v5-2d"][data-my="0"][data-mp="0"]').click());
await pg.waitForFunction(() => document.getElementById("tip"));
const ev = (f, a) => pg.evaluate(f, a);
const waitFor = (f, ms) => pg.waitForFunction(f, null, { timeout: ms }).catch(async (e) => {
  console.log("TIMEOUT", JSON.stringify(res), await ev(() => ({ S: window.H2K.G.S, M: { kind: window.H2K.MODE.kind, done: window.H2K.MODE.done, dunk: window.H2K.MODE.dunk, tries: window.H2K.MODE.tries, wait: window.H2K.MODE.wait, scores: window.H2K.MODE.scores, let: window.H2K.MODE.let, rack: window.H2K.MODE.rack, ball: window.H2K.MODE.ball, time: window.H2K.MODE.time }, ov: document.getElementById("ov").style.display })), errs);
  throw e;
});
const res = {};
res.strip = await ev(() => [...document.querySelectorAll("[data-mode]")].map((b) => b.dataset.mode).join(","));
await ev(() => document.getElementById("set").click());
res.drawer = await ev(() => ["rf", "rc", "rv", "rs", "rb", "cmt", "mu", "cb", "bm", "au"].every((k) => document.querySelector(`[data-${k}]`)) && document.querySelectorAll("[data-key]").length >= 15);
await ev(() => document.getElementById("sdx").click());
// a perfectly timed jumper for the human (slot 0) wherever he stands
const shoot = () =>
  ev(() => {
    const G = window.H2K.G,
      p = G.P[0];
    if (G.B.owner !== p || p.mode !== "i") return 0;
    p.mode = "s";
    p.t = 0.4;
    p.rl = 0;
    p.mt = p.st === 1 ? 0.45 : 0.6;
    p.sv = 0;
    p.cw = 0;
    G.launch(p);
    return 1;
  });
const run = (s) =>
  ev((s) => {
    const G = window.H2K.G;
    for (let i = 0; i < s * 60; i++) G.upd(1 / 60);
  }, s);
const M = () => ev(() => window.H2K.MODE);
// ---- 3-point contest: 25 balls
await ev(() => window.H2K.openMode("3pt"));
res.tp0 = (await M()).kind;
for (let n = 0; n < 40 && !(await M()).done; n++) {
  await run(0.3);
  await shoot();
  await run(2.2);
}
res.tp = await ev(() => ({ done: window.H2K.MODE.done, pts: window.H2K.MODE.pts, shots: window.H2K.MODE.shots.length }));
await waitFor(() => document.getElementById("mag"), 8000);
res.tpScreen = await ev(() => document.querySelector(".fin .logo").textContent);
await ev(() => document.getElementById("mme").click());
// ---- practice: ball comes back after a shot
await ev(() => window.H2K.openMode("practice"));
await run(0.5);
await shoot();
await run(3);
res.practice = await ev(() => ({ att: window.H2K.MODE.st.att, back: window.H2K.G.B.owner === window.H2K.G.P[0] || window.H2K.G.B.mode === "pass" }));
// ---- tutorial: step 1 (move) completes
await ev(() => window.H2K.openMode("tutorial"));
for (let i = 0; i < 60; i++)
  await ev(() => {
    const G = window.H2K.G;
    G.P[0].in = { dx: 1, dy: 0 };
    G.P[0].vx = 220;
    G.upd(1 / 60);
  });
res.tut = (await M()).step;
// ---- dunk contest: drive in with the ball and finish, three times
await ev(() => window.H2K.openMode("dunk"));
for (let k = 0; k < 8 && !(await M()).done && !((await M()).dunk >= 3); k++) {
  await run(0.2);
  await ev(() => {
    const G = window.H2K.G,
      p = G.P[0];
    if (G.B.owner !== p || G.RPL) return;
    p.x = G.hoop(0) - 30;
    p.y = G.HY + 6;
    p.mode = "s";
    p.t = 0.27;
    p.rl = 0;
    p.mt = p.st === 1 ? 0.45 : 0.6;
    p.sv = 13;
    p.hk = 1;
    p.cw = 0;
    p.z = 30;
    G.launch(p);
  });
  for (let i = 0; i < 60; i++) {
    const s = await ev(() => ({ w: window.H2K.MODE.wait, r: !!window.H2K.G.RPL, own: window.H2K.G.B.owner === window.H2K.G.P[0], d: window.H2K.MODE.dunk }));
    if (s.d >= 3 || (!s.r && s.own && !(s.w > 0) && i > 2)) break;
    await run(0.25);
  }
}
await waitFor(() => document.getElementById("mag"), 15000);
res.dunk = await ev(() => ({ scores: window.H2K.MODE.scores, screen: document.querySelector(".fin .logo").textContent }));
await ev(() => document.getElementById("mme").click());
// ---- HORSE: the human bricks everything, so the CPU spells it on him
await ev(() => window.H2K.openMode("horse"));
for (let k = 0; k < 600 && !(await M()).done; k++) {
  await run(0.4);
  await ev(() => {
    const G = window.H2K.G,
      M = window.H2K.MODE,
      p = G.P[0];
    if (M.cur === p && G.B.owner === p && p.mode === "i" && !(M.wait > 0)) {
      p.mode = "s";
      p.t = 0.4;
      p.rl = 0;
      p.mt = 0.1;
      p.sv = 0;
      p.cw = 0;
      G.launch(p);
    }
  });
}
res.horse = await ev(() => ({ done: window.H2K.MODE.done, letters: window.H2K.MODE.let }));
await waitFor(() => document.getElementById("mag"), 8000);
await ev(() => document.getElementById("mme").click());
// ---- clutch challenge list + first scenario starts in Q4 with the right clock, and ends
await ev(() => window.H2K.openMode("clutch"));
res.cc = await ev(() => document.querySelectorAll("[data-cc]").length);
await ev(() => document.querySelector('[data-cc="0"]').click());
res.clutch = await ev(() => ({ q: window.H2K.G.q, clock: window.H2K.G.clock, sc: window.H2K.G.sc.slice(), kind: window.H2K.MODE.kind }));
for (let i = 0; i < 40 && !(await M()).done; i++) await run(1);
await waitFor(() => document.getElementById("mag"), 15000);
res.clutchEnd = await ev(() => document.querySelector(".fin .logo").textContent);
await ev(() => document.getElementById("mme").click());
// ---- season: record one game
await ev(() => window.H2K.openMode("season"));
await ev(() => document.getElementById("snx").click());
await ev(() => {
  const G = window.H2K.G;
  for (let i = 0; i < 400 && G.JB; i++) G.upd(1 / 60);
  G.sc[0] = 30;
  G.sc[1] = 10;
  for (let q = 0; q < 6 && G.S !== "over"; q++) {
    if (G.S === "half") G.setS("play");
    G.setClock(0);
    G.setRs(0);
    G.setInb(0);
    for (let i = 0; i < 30 && G.S === "play"; i++) G.upd(1 / 60);
  }
});
await waitFor(() => document.getElementById("ssn"), 20000);
await ev(() => document.getElementById("ssn").click());
res.season = await ev(() => !!document.querySelector(".season") && document.querySelector(".season").textContent.includes("W 30-10"));
// ---- halftime in a normal game
await ev(() => window.H2K.menu());
await ev(() => document.getElementById("tip").click());
await ev(() => {
  const G = window.H2K.G;
  for (let i = 0; i < 400 && G.JB; i++) G.upd(1 / 60);
  for (let q = 0; q < 2; q++) {
    G.setClock(0);
    G.setRs(0);
    G.setInb(0);
    G.upd(1 / 60);
  }
});
await waitFor(() => document.getElementById("h2"), 8000);
res.half = await ev(() => window.H2K.G.S);
await ev(() => document.getElementById("h2").click());
res.afterHalf = await ev(() => window.H2K.G.S);
console.log(JSON.stringify(res), errs.length ? errs : "no errors");
const ok =
  res.strip.split(",").length === 7 &&
  res.drawer &&
  res.tp0 === "3pt" &&
  res.tp.done &&
  res.tp.shots >= 20 &&
  res.tp.pts >= 12 &&
  /3-POINT/.test(res.tpScreen) &&
  res.practice.att === 1 &&
  res.practice.back &&
  res.tut >= 1 &&
  res.dunk.scores.length === 3 &&
  /DUNK/.test(res.dunk.screen) &&
  res.horse.done &&
  res.horse.letters[0] === 5 &&
  res.cc === 6 &&
  res.clutch.q === 4 &&
  res.clutch.clock <= 12 &&
  res.clutch.kind === "clutch" &&
  /CHALLENGE/.test(res.clutchEnd) &&
  res.season &&
  res.half === "half" &&
  res.afterHalf === "play" &&
  !errs.length;
console.log(ok ? "MODES OK" : "MODES FAIL");
await b.close();
process.exit(ok ? 0 : 1);
