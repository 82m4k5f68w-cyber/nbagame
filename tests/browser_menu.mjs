// Menu flows: matchup screen (opponent arrows, difficulty, settings drawer), tip off with the chosen opponent,
// final screen (record, player of the game, rematch), and Quick Play from the hub.
import { chromium } from "playwright";
import path from "node:path";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const pg = await b.newPage({ viewport: { width: 1200, height: 900 } });
const errs = [];
pg.on("pageerror", (e) => errs.push(String(e)));
const url = "file://" + path.resolve("dist/hoops2k27-hub.html") + "?nointro";
await pg.goto(url);
await pg.waitForTimeout(400);
await pg.evaluate(() => document.querySelector('button[data-g="5v5-2d"][data-my="0"][data-mp="0"]').click());
await pg.waitForFunction(() => document.getElementById("tip"));
const ev = (f, a) => pg.evaluate(f, a);
await ev(() => document.querySelector('.arw[data-cy="o"][data-d="1"]').click()); // opponent: first team that isn't mine
await ev(() => document.querySelector('[data-df="3"]').click()); // Hall of Fame
await ev(() => document.getElementById("set").click());
const drawer = await ev(() => !document.getElementById("sd").hidden);
await ev(() => document.getElementById("sdx").click());
const opp = await ev(() => document.querySelectorAll(".side")[1].querySelector(".tn b").textContent);
await ev(() => document.getElementById("tip").click());
const g = await ev(() => ({ S: window.H2K.G.S, away: window.H2K.G.cl[1], diff: window.H2K.G.cfg.DIFF, ql: window.H2K.G.QTRLEN }));
// finish the game with us ahead
await ev(() => { const G = window.H2K.G; for (let i = 0; i < 400 && G.JB; i++) G.upd(1 / 60); G.sc[0] = 21; G.sc[1] = 9; for (let q = 0; q < 4 && G.S === "play"; q++) { G.setClock(0); G.setRs(0); G.setInb(0); for (let i = 0; i < 30 && G.S === "play"; i++) G.upd(1 / 60); } });
await pg.waitForFunction(() => document.querySelector(".fin"), null, { timeout: 20000 });
const fin = await ev(() => ({ head: document.querySelector(".fin .logo").textContent, pog: !!document.querySelector(".pog"), rec: localStorage.getItem("h2k_rec") }));
await pg.screenshot({ path: "docs/menu-final.png", clip: { x: 0, y: 0, width: 1200, height: 900 } });
await ev(() => document.getElementById("rm").click());
const rem = await ev(() => ({ S: window.H2K.G.S, away: window.H2K.G.cl[1] }));
// Quick Play from a fresh hub
await pg.goto(url);
await pg.waitForTimeout(400);
await ev(() => document.getElementById("qpb").click());
await pg.waitForFunction(() => window.H2K && window.H2K.G.S === "play", null, { timeout: 20000 });
const qp = await ev(() => ({ S: window.H2K.G.S, home: window.H2K.G.cl[0], away: window.H2K.G.cl[1] }));
console.log(JSON.stringify({ drawer, opp, g, fin, rem, qp }), errs.length ? errs : "no errors");
const ok = drawer && g.away === opp && g.diff === 3 && /VICTORY/.test(fin.head) && fin.pog && rem.S === "play" && rem.away === opp && qp.S === "play" && qp.away === opp && !errs.length;
console.log(ok ? "MENU OK" : "MENU FAIL");
await b.close();
process.exit(ok ? 0 : 1);
