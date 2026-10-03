// Game modes headless: 3v3 / 2v2 full games, Street 21 (1v1 and 3v3, half court), King of the Court, All-Star and the
// Daily Challenge all run to a result with no NaN; street scoring is 1s and 2s and play stays on the right half.
import * as G from "../src/core/sim";
import { rapInit } from "../src/core/physics";
import { M, startStreet, startKing, startAllStar, startDaily, stopMode } from "../src/core/modes";
(async () => {
  await rapInit();
  G.setCtrls([]);
  const fails: string[] = [];
  const run = (tag: string, max: number, check?: () => void) => {
    let n = 0,
      leftHalf = 0;
    while (G.S === "play" && !M.done && n < max) {
      G.upd(1 / 60);
      if (G.RPL) G.skipReplay();
      G.FX.length = 0;
      n++;
      for (const p of G.P) if (![p.x, p.y, p.z].every(isFinite)) return void fails.push(tag + ": NaN " + p.n);
      if (!isFinite(G.B.x)) return void fails.push(tag + ": NaN ball");
      if (G.cfg.HALF && G.B.x < 420 && G.B.owner) leftHalf++;
      if (check) check();
    }
    if (G.S === "play" && !M.done) fails.push(`${tag}: no result after ${n} ticks (${G.sc.join("-")})`);
    if (leftHalf > 900) fails.push(`${tag}: street ball in the far half for ${leftHalf} ticks`);
    console.log(tag, G.sc.join("-"), "q", G.q, "ticks", n, "done", M.done, "np", G.P.length / 2);
  };
  for (const np of [3, 2]) {
    G.cfg.NP = np;
    G.setQtrLen(30);
    G.start(1, { j: 4 });
    run("full " + np + "v" + np, 60 * 60 * 10);
    if (G.S !== "over") fails.push(np + "v" + np + " game did not end");
  }
  G.cfg.NP = 5;
  G.setQtrLen(30);
  startStreet(2, 5, 1);
  if (G.P.length !== 2 || !G.cfg.HALF || G.cfg.TO !== 21) fails.push("street 1v1 setup " + G.P.length + " " + G.cfg.HALF);
  run("street 1v1", 60 * 60 * 15, () => {
    if (G.sc[0] > 22 || G.sc[1] > 22) fails.push("street overshoot " + G.sc);
  });
  if (Math.max(...G.sc) < 21) fails.push("street did not reach 21: " + G.sc);
  startStreet(2, 5, 3);
  run("street 3v3", 60 * 60 * 15);
  stopMode();
  if (G.cfg.NP !== 5 || G.cfg.HALF) fails.push("stopMode did not restore NP/HALF");
  startKing(0);
  run("king rung " + M.rung, 60 * 60 * 15);
  startAllStar();
  if (!/Gold/.test(G.cl[0]) || G.P.length !== 10) fails.push("all-star teams " + G.cl);
  run("all-star", 60 * 60 * 12);
  G.setQtrLen(720);
  startDaily();
  run("daily", 60 * 60 * 4);
  stopMode();
  console.log(fails.length ? "FAIL\n" + fails.join("\n") : "modes sim ok");
  process.exit(fails.length ? 1 : 0);
})();
