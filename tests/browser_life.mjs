// LIFE end to end (after `npm run build`): title -> new life -> world (walk) -> a door -> class with the OFFLINE
// question bank (lesson, quiz, grade recorded) -> phone (calendar, Hoopr post + replies) -> sleep (next morning) ->
// game day: walk into the arena, play a real engine game (forced to a quick finish), back to LIFE with the line booked.
// SwiftShader is ~1 fps here, so the test drives the world through window.H2K_LIFE and DOM clicks (no waiting on rAF).
import { chromium } from "playwright";
import path from "node:path";
const SHOTS = process.env.SHOTS || "";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const pg = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
pg.on("pageerror", (e) => errs.push(String(e)));
const ev = (f, a) => pg.evaluate(f, a);
const click = (sel) => ev((s) => document.querySelector(s).click(), sel);
// SwiftShader frames are slow and the panels fade in: wait for presence, not visibility
const waitFor = (sel, ms = 60000) => pg.waitForFunction((s) => !!document.querySelector(s), sel, { timeout: ms, polling: 100 });
const shot = async (n) => SHOTS && (await pg.screenshot({ path: path.join(SHOTS, n + ".png") }));
const fails = [];
const ok = (c, m) => (c ? console.log("ok  ", m) : (fails.push(m), console.log("FAIL", m)));
await pg.goto("file://" + path.resolve("dist/hoops2k27-hub.html") + "?life&nointro&lifetest");
await waitFor("#life [data-new]");
await shot("01-title");
await click("#life [data-new='0']");
await pg.fill("#cn", "Test Kid");
await click("[data-ar='Sharpshooter']");
await shot("02-create");
await click("#cgo");
await waitFor("#life .cut button");
await shot("03-dayone");
await click("#life .cut button");
await pg.waitForFunction(() => window.H2K_LIFE && H2K_LIFE.mode === "world", null, { polling: 100, timeout: 30000 });
const L0 = await ev(() => ({ t: H2K_LIFE.L.t, n: H2K_LIFE.L.p.n, c: H2K_LIFE.L.p.c, stage: H2K_LIFE.L.stage }));
ok(L0.n === "TEST KID" && L0.stage === "hs" && L0.c === 68, "new life: name, HS stage, archetype ratings");
// walk (keyboard): the player moves
const p0 = await ev(() => ({ ...H2K_LIFE.L.pos }));
await pg.keyboard.down("KeyW");
await pg.waitForTimeout(2500);
await pg.keyboard.up("KeyW");
const p1 = await ev(() => ({ ...H2K_LIFE.L.pos }));
ok(Math.hypot(p1.x - p0.x, p1.z - p0.z) > 0.3, "W walks the player (" + Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(2) + " ft)");
await shot("04-world");
// walk to a door: Central High at 8:50 (class window), E enters
await ev(() => {
  H2K_LIFE.setTime(8 * 60 + 50);
  H2K_LIFE.goto("hs");
});
await pg.waitForTimeout(300);
const prompt = await ev(() => !document.querySelector("#life .prompt").hidden && document.querySelector("#life .prompt").textContent);
ok(prompt && /Central High/.test(prompt), "door prompt at Central High: " + prompt);
await pg.keyboard.press("KeyE");
await waitFor("#life #lq");
const lesson = await ev(() => document.querySelector("#life .slide").textContent);
ok(lesson.length > 20, "lesson slide (offline): " + lesson.slice(0, 50));
await shot("05-lesson");
await click("#life #lq");
let answered = 0;
for (let i = 0; i < 5; i++) {
  await waitFor("#life .ans button").catch(async (e) => {
    console.log("DBG0", i, await ev(() => ({ html: document.querySelector("#life .scr") && document.querySelector("#life .scr").innerText.slice(0, 300), mode: H2K_LIFE.mode })));
    throw e;
  });
  if (i === 0) await shot("06-quiz");
  await pg.keyboard.press("Digit" + ((i % 4) + 1));
  await waitFor("#life #qn").catch(async (e) => {
    console.log("DBG", i, await ev(() => ({ a: document.activeElement && document.activeElement.outerHTML.slice(0, 80), qx: document.querySelector("#qx") && document.querySelector("#qx").innerHTML, mode: H2K_LIFE.mode, n: document.querySelectorAll("#life .scr").length })));
    throw e;
  });
  answered++;
  await click("#life #qn");
}
await waitFor("#life .scr [data-o='__x']");
const cls = await ev(() => ({ sc: H2K_LIFE.L.courses[0].sc.length, v: H2K_LIFE.L.courses[0].sc[0]?.v, hw: H2K_LIFE.L.courses[0].hw, t: H2K_LIFE.L.t, txt: document.querySelector("#life .scr h2").textContent }));
ok(answered === 5 && cls.sc === 1 && cls.v >= 0 && cls.hw >= 0 && cls.t >= 600, "class: 5 answers, grade " + cls.txt + " recorded, homework set, clock at 10:00+");
await shot("07-grade");
await click("#life .scr [data-o='__x']");
await pg.waitForFunction(() => H2K_LIFE.mode === "world", null, { polling: 100, timeout: 10000 });
// phone: calendar + Hoopr post with replies
await pg.keyboard.press("KeyP");
await waitFor("#life .phone.on");
await click("#life .phone .lock");
await waitFor("#life [data-app='cal']");
await shot("08-phone");
await click("#life [data-app='cal']");
const calN = await ev(() => document.querySelectorAll("#life .ev").length);
ok(calN >= 4, "calendar lists events (" + calN + ")");
await shot("09-calendar");
await click("#life [data-back='home']");
await click("#life [data-app='hoopr']");
await waitFor("#life #hpi");
const f0 = await ev(() => H2K_LIFE.L.followers);
await pg.fill("#life #hpi", "First day done. Locked in 🔒 #grind");
await click("#life #hpp");
await pg.waitForTimeout(400);
const post = await ev(() => ({ me: H2K_LIFE.L.feed[0].me, re: (H2K_LIFE.L.feed[0].re || []).length, f: H2K_LIFE.L.followers, shown: document.querySelectorAll("#life .post .rep div").length }));
ok(post.me === 1 && post.re >= 2 && post.shown >= 2 && post.f > f0, `Hoopr: posted, ${post.re} replies shown, followers ${f0} -> ${post.f}`);
await shot("10-hoopr");
await click("#life [data-back='home']");
await click("#life [data-app='msg']");
const thr = await ev(() => document.querySelectorAll("#life [data-th]").length);
ok(thr >= 3, "messages: threads (" + thr + ")");
await pg.keyboard.press("Escape");
await pg.keyboard.press("Escape");
await pg.waitForTimeout(500);
// sleep at home -> next morning at the alarm
await ev(() => {
  H2K_LIFE.setTime(22 * 60);
  H2K_LIFE.goto("home");
});
await pg.waitForTimeout(300);
await pg.keyboard.press("KeyE");
await waitFor("#life .scr [data-o='sleep']");
await shot("11-home");
await click("#life .scr [data-o='sleep']");
await pg.waitForFunction(() => H2K_LIFE.L.t >= 1440 + 7 * 60, null, { polling: 100, timeout: 10000 });
const sl = await ev(() => ({ t: H2K_LIFE.L.t, e: H2K_LIFE.L.energy }));
ok(sl.t === 1440 + 7 * 60 && sl.e > 80, "slept to 7:00 AM day 2, energy " + Math.round(sl.e));
await pg.waitForTimeout(800);
await ev(() => document.querySelector("#life .scr [data-o='__x']") && document.querySelector("#life .scr [data-o='__x']").click());
await pg.waitForTimeout(500);
// game day (Tuesday 19:00): walk into the arena, play, finish, return
const g = await ev(() => H2K_LIFE.L.cal.find((e) => e.k === "game"));
await ev((g) => {
  H2K_LIFE.setTime(g.day * 1440 + g.st - 30);
  H2K_LIFE.L.courses.forEach((c) => c.sc.push({ k: "q", v: 90, d: 0 })); // eligible
  H2K_LIFE.goto("arena");
}, g);
await pg.waitForTimeout(400);
await pg.keyboard.press("KeyE");
await waitFor("#life .scr [data-o='play']");
await shot("12-pregame");
await click("#life .scr [data-o='play']");
await pg.waitForFunction(() => window.H2K && window.H2K.G && window.H2K.G.S === "play", null, { polling: 100, timeout: 180000 });
const gm = await ev(() => ({ home: H2K.G.cl[0], away: H2K.G.cl[1], my: H2K.G.P.some((p) => p.my && p.n === "TEST KID"), life: getComputedStyle(document.getElementById("life")).display }));
ok(gm.my && gm.life === "none" && /Central/.test(gm.home), `engine game: ${gm.home} vs ${gm.away}, My Player on the floor, LIFE hidden`);
await pg.waitForTimeout(1500);
await shot("13-game");
await ev(() => {
  const G = window.H2K.G;
  for (let i = 0; i < 400 && G.JB; i++) G.upd(1 / 60);
  for (let i = 0; i < 900 && G.S === "play"; i++) {
    G.upd(1 / 60);
    if (G.RPL) G.skipReplay();
  }
  G.sc[0] = 30;
  G.sc[1] = 20;
  for (let q = 0; q < 4 && G.S === "play"; q++) {
    G.setClock(0);
    G.setRs(0);
    G.setInb(0);
    for (let i = 0; i < 30 && G.S === "play"; i++) G.upd(1 / 60);
  }
});
await waitFor("#lifeback");
await shot("14-final");
await click("#lifeback");
await waitFor("#life .scr h2");
const pgm = await ev(() => ({ txt: document.querySelector("#life .scr h2").textContent, gp: H2K_LIFE.L.line.gp, w: H2K_LIFE.L.team.w, life: getComputedStyle(document.getElementById("life")).display, idle: window.H2K.G && true, feed: H2K_LIFE.L.feed.length, res: H2K_LIFE.L.cal.find((e) => e.k === "game").res }));
ok(/WIN/.test(pgm.txt) && pgm.gp === 1 && pgm.w === 1 && pgm.life !== "none" && pgm.res && pgm.res.played, "back in LIFE: " + pgm.txt + ", game booked (1 GP, W)");
await shot("15-postgame");
await click("#life .scr [data-o='__x']");
await pg.waitForFunction(() => H2K_LIFE.mode === "world", null, { polling: 100, timeout: 10000 });
await pg.waitForTimeout(1500);
await shot("16-after");
// save round trip
const sv = await ev(() => {
  H2K_LIFE.save();
  const s = JSON.parse(localStorage.getItem("h2k_life_0"));
  return { gp: s.line.gp, n: s.p.n };
});
ok(sv.gp === 1 && sv.n === "TEST KID", "saved to slot 1");
ok(!errs.length, "no page errors" + (errs.length ? ": " + errs.slice(0, 5).join(" | ") : ""));
console.log(fails.length ? "LIFE BROWSER FAIL (" + fails.length + ")" : "LIFE BROWSER OK");
await b.close();
process.exit(fails.length ? 1 : 0);
