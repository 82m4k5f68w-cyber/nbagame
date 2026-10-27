// LIFE career flows in Chromium (after `npm run build`): HS year end -> Signing Day (official visit, commit, major) ->
// college -> declare -> combine, interviews, agent, Draft Night board -> NBA (story cards) -> League app -> free agency
// (counter-offer + sign). The world is driven through window.H2K_LIFE (SwiftShader ~1 fps).
import { chromium } from "playwright";
import path from "node:path";
const SHOTS = process.env.SHOTS || "";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const pg = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
pg.on("pageerror", (e) => errs.push(String(e)));
const ev = (f, a) => pg.evaluate(f, a);
const click = (sel) => ev((s) => document.querySelector(s).click(), sel);
const waitFor = (sel, ms = 60000) => pg.waitForFunction((s) => !!document.querySelector(s), sel, { timeout: ms, polling: 100 });
const waitFn = (f, ms = 60000) => pg.waitForFunction(f, null, { timeout: ms, polling: 100 });
const shot = async (n) => SHOTS && (await pg.screenshot({ path: path.join(SHOTS, n + ".png"), timeout: 120000 }).catch(() => {}));
const fails = [];
const ok = (c, m) => (c ? console.log("ok  ", m) : (fails.push(m), console.log("FAIL", m)));
await pg.goto("file://" + path.resolve("dist/hoops2k27-hub.html") + "?life&nointro&lifetest");
await waitFor("#life [data-new]", 30000);
await click("#life [data-new='1']");
await pg.fill("#cn", "Career Kid");
await click("#cgo");
await waitFor("#life .cut button", 120000);
await click("#life .cut button");
await waitFn(() => window.H2K_LIFE && H2K_LIFE.mode === "world");
// ---- end of the senior year: good grades and stats -> Signing Day
await ev(() => {
  const L = H2K_LIFE.L;
  L.flags.tut = 99;
  L.courses.forEach((c) => c.sc.push({ k: "q", v: 95, d: 0 }));
  L.line = { gp: 5, w: 4, pts: 80, reb: 30, ast: 20, blk: 5, fgm: 30, fga: 55, tpm: 8, tpa: 20 };
  H2K_LIFE.setTime((L.y0 + L.ylen) * 1440 + 8 * 60);
  H2K_LIFE.S.resolve(L);
});
ok(await ev(() => H2K_LIFE.L.pend === "signing" && H2K_LIFE.L.offers.length === 3), "senior year over -> Signing Day pending");
await waitFor("#life [data-vis]");
await shot("c01-signing");
await click("#life [data-vis]");
await waitFor("#life #vb");
const visit = await ev(() => document.querySelector("#life .scr table").textContent);
ok(/Projected role/.test(visit) && /NIL/.test(visit), "official visit card");
await shot("c02-visit");
await click("#life #vb");
await waitFor("#life [data-col]");
await click("#life [data-col]");
await waitFor("#life .cut button");
await click("#life .cut button");
await waitFor("#life [data-mj]");
await shot("c03-major");
await click("#life [data-mj='Kinesiology']");
await waitFn(() => H2K_LIFE.mode === "world");
const col = await ev(() => ({ st: H2K_LIFE.L.stage, mj: H2K_LIFE.L.major, games: H2K_LIFE.L.cal.filter((e) => e.k === "game").length, mm: H2K_LIFE.L.cal.filter((e) => e.big === "mm").length }));
ok(col.st === "college" && col.mj === "Kinesiology" && col.games === 6 && col.mm === 3, "college: major + 6 games incl. 3 March Madness rounds");
// ---- phone League app
await pg.keyboard.press("KeyP");
await waitFor("#life .phone.on");
await click("#life .phone .lock");
await waitFor("#life [data-app='lg']");
await click("#life [data-app='lg']");
const lg = await ev(() => ({ rows: document.querySelectorAll("#life .phone table tr").length, tour: /MARCH MADNESS/.test(document.querySelector("#life .phone #papp").textContent) }));
ok(lg.rows >= 9 && lg.tour, "League app: standings + March Madness");
await shot("c04-league");
await pg.keyboard.press("Escape");
await pg.keyboard.press("Escape");
// ---- end of freshman year -> declare -> combine, interviews, agent, draft board
await ev(() => {
  const L = H2K_LIFE.L;
  L.p.c = L.p.i = L.p.s = L.p.j = 82;
  L.line = { gp: 6, w: 5, pts: 120, reb: 40, ast: 30, blk: 6, fgm: 50, fga: 90, tpm: 12, tpa: 30 };
  H2K_LIFE.setTime((L.y0 + L.ylen) * 1440 + 8 * 60);
  H2K_LIFE.S.resolve(L);
});
await waitFor("#life .scr [data-d='go']");
await shot("c05-declare");
await click("#life .scr [data-d='go']");
await waitFor("#life #cbk");
const cmb = await ev(() => document.querySelector("#life .scr table").textContent);
ok(/vertical/.test(cmb) && /Lane agility/.test(cmb), "combine results");
await shot("c06-combine");
await click("#life #cbk");
for (let i = 0; i < 6; i++) {
  await waitFor("#life [data-iv]");
  if (i === 0) await shot("c07-interview");
  await click("#life [data-iv='0']");
}
await waitFor("#life [data-ag]");
await shot("c08-agent");
await click("#life [data-ag='Priya Vance']");
await waitFor("#life .cut button");
await click("#life .cut button"); // green room
await waitFor("#life #dskip");
await shot("c09-board");
await click("#life #dskip");
await waitFor("#life .cut button");
await click("#life .cut button"); // pick card
await waitFn(() => H2K_LIFE.L.stage === "nba");
const nba = await ev(() => ({ agent: H2K_LIFE.L.agent, fav: H2K_LIFE.L.fav, team: H2K_LIFE.L.team.name, pick: H2K_LIFE.L.draft.pick, story: H2K_LIFE.L.story.slice(), mock: H2K_LIFE.L.feed.some((p) => /MOCK|board|mock/i.test(p.x)) }));
ok(nba.agent === "Priya Vance" && nba.fav >= 0 && nba.pick >= 1 && nba.mock, `drafted #${nba.pick} by the ${nba.team} (agent, interviews, mock draft posts)`);
// story cards play when the player is free (role meeting, rookie duty)
await waitFn(() => H2K_LIFE.mode === "world" || !!document.querySelector("#life .cut"), 60000);
let cards = 0;
for (let i = 0; i < 4; i++) {
  const has = await pg.waitForFunction(() => document.querySelector("#life .cut button"), null, { timeout: 20000, polling: 100 }).then(() => true, () => false);
  if (!has) break;
  if (cards === 0) await shot("c10-story");
  cards++;
  await click("#life .cut button");
}
ok(cards >= 2 && (await ev(() => H2K_LIFE.L.story.length)) === 0, "story cards shown (" + cards + ")");
// ---- contract runs out -> free agency: counter + sign
await ev(() => {
  const L = H2K_LIFE.L;
  L.contract.yrs = 1;
  H2K_LIFE.setTime((L.y0 + L.ylen) * 1440 + 8 * 60);
  H2K_LIFE.S.resolve(L);
});
// late story cards (awards, role meeting) may still be up: dismiss them until the free-agency screen shows
for (let k = 0; k < 120 && !(await ev(() => !!document.querySelector("#life [data-cnt]"))); k++) {
  await ev(() => document.querySelector("#life .cut button") && document.querySelector("#life .cut button").click());
  await pg.waitForTimeout(500);
}
await waitFor("#life [data-cnt]");
await shot("c11-fa");
await ev(() => {
  const r = document.querySelector('#life [data-ask="1"]');
  r.value = String(Math.round(+r.min * 1.05));
  r.dispatchEvent(new Event("input"));
});
await click("#life [data-cnt='1']");
await waitFor("#life [data-sgn='1']");
const t0 = await ev(() => H2K_LIFE.L.team.tm);
await click("#life [data-sgn='1']");
await waitFor("#life .cut button");
await click("#life .cut button");
await waitFn(() => H2K_LIFE.L.pend === "" && H2K_LIFE.L.stage === "nba");
const fa = await ev(() => ({ tm: H2K_LIFE.L.team.tm, yrs: H2K_LIFE.L.contract.yrs, sal: H2K_LIFE.L.contract.sal, yr: H2K_LIFE.L.yr }));
ok(fa.tm !== t0 && fa.yrs >= 2 && fa.sal > 1e6 && fa.yr === 2, "free agency: signed with a new team for season 2");
ok(!errs.length, "no page errors" + (errs.length ? ": " + errs.slice(0, 5).join(" | ") : ""));
console.log(fails.length ? "LIFE CAREER FAIL (" + fails.length + ")" : "LIFE CAREER OK");
await b.close();
process.exit(fails.length ? 1 : 0);
