// Adaptive CPU: a cold / smothered shooter changes his shot diet (mid-range pull-ups, drives), a hot one keeps firing,
// and a CPU team re-reads its own shooting every few possessions (game plan + matching play call) and adjusts its
// defense to what the other side lives on. Human teams keep their own calls.
import * as G from "../src/core/sim";
import { rapInit } from "../src/core/physics";
(async () => {
  await rapInit();
  let fails = 0;
  const ok = (c: boolean, m: string) => {
    console.log((c ? "ok   " : "FAIL ") + m);
    if (!c) fails++;
  };
  G.cfg.NP = 5;
  G.setCtrls([]);
  G.setQtrLen(60);
  G.start(0, { j: 1 });
  const fresh = () => {
    G.start(0, { j: 1 });
    for (const p of G.P) (p.sk = null), (p.cold = 0), (p.heat = 0), p.hzm.fill(0);
  };
  fresh();
  const sh = G.P.filter((p) => p.tm === 1).sort((a, b) => b.c - a.c)[0];
  const base = [...G.tendOf(sh)];
  // cold + smothered from three
  for (let k = 0; k < 5; k++) G.scout(sh, 260, false, 0.75);
  sh.cold = 5;
  const cold = [...G.tendOf(sh)];
  console.log(sh.n, "base", base.map((v) => v.toFixed(2)).join(" "), "| cold", cold.map((v) => v.toFixed(2)).join(" "));
  ok(cold[0] < base[0] * 0.5, "cold, contested shooter takes far fewer threes");
  ok(cold[1] + cold[2] + cold[3] > base[1] + base[2] + base[3] + base[0] * 0.3, "...and moves them to mid-range / drives / post");
  ok(cold[5] < base[5], "...and fewer step-backs");
  // hot shooter keeps firing
  fresh();
  const sh2 = G.P.find((p) => p.n === sh.n);
  sh2.heat = 3;
  ok(G.tendOf(sh2)[0] > base[0], "hot shooter shoots more threes");
  // a human-controlled player is never adapted
  fresh();
  for (let k = 0; k < 5; k++) G.scout(G.P[0], 260, false, 0.75);
  G.P[0].cold = 5;
  G.setCtrls([G.mkCtrl("p1", 0, true, 0)]);
  const hb = G.tendOf(G.P[0])[0];
  G.P[0].sk = null;
  G.P[0].cold = 0;
  ok(hb === G.tendOf(G.P[0])[0], "human-controlled player's tendencies are never adapted");
  G.setCtrls([]);
  // team: bricking threes, finishing at the rim -> attack the paint (pick-and-roll), and the other side runs them off the line
  fresh();
  const t1 = G.P.filter((p) => p.tm === 1);
  for (let k = 0; k < 10; k++) G.scout(t1[k % 5], 260, false, 0.4);
  for (let k = 0; k < 6; k++) G.scout(t1[k % 5], 40, true, 0.4);
  G.TS.gpT[1] = 10;
  G.gamePlan(1);
  ok(G.TS.gp[1] === 1 && G.TS.pc[1] === 1, "team bricking threes attacks the paint (gp " + G.TS.gp[1] + ", pc " + G.TS.pc[1] + ")");
  // walled off at the rim, threes falling -> let it fly (flares); the defense on the other side runs them off the line
  fresh();
  for (let k = 0; k < 8; k++) G.scout(t1[k % 5], 40, false, 0.8);
  for (let k = 0; k < 8; k++) G.scout(t1[k % 5], 260, k % 2 === 0, 0.4);
  G.TS.gpT[1] = 10;
  G.TS.gpT[0] = 10;
  G.gamePlan(1);
  G.gamePlan(0);
  ok(G.TS.gp[1] === 3 && G.TS.pc[1] === 3, "team walled off at the rim lets it fly (gp " + G.TS.gp[1] + ")");
  ok(G.TS.ds[0] === 2, "opponent raining threes -> tight / deny defense (ds " + G.TS.ds[0] + ")");
  // the other side scores at will at the rim and can't shoot: 2-3 zone
  fresh();
  {
    const t0 = G.P.filter((p) => p.tm === 0);
    for (let k = 0; k < 8; k++) G.scout(t0[k % 5], 40, k % 4 !== 0, 0.3);
    for (let k = 0; k < 5; k++) G.scout(t0[k % 5], 260, false, 0.3);
    G.TS.gpT[1] = 10;
    G.gamePlan(1);
    ok(G.TS.ds[1] === 4, "opponent living at the rim, cold from three -> 2-3 zone (ds " + G.TS.ds[1] + ")");
  }
  // pick-and-roll coverage: hedge against a pull-up shooting star, drop against a non-shooter
  fresh();
  for (const q of G.P) if (q.tm === 0) q.c = 92;
  G.TS.gpT[1] = 10;
  G.gamePlan(1);
  const hedge = G.TS.cov[1];
  fresh();
  for (const q of G.P) if (q.tm === 0) q.c = 60;
  G.TS.gpT[1] = 10;
  G.gamePlan(1);
  ok(hedge === 1 && G.TS.cov[1] === 0, "hedges the pick-and-roll vs a shooter, drops vs a non-shooter (" + hedge + "/" + G.TS.cov[1] + ")");
  // a hot scorer draws the best defender
  fresh();
  {
    const hot = G.P[0 * 5 + 3];
    hot.heat = 4;
    G.TS.gpT[1] = 10;
    G.gamePlan(1);
    const mu = G.TS.mu[1]!,
      who = mu.indexOf(3),
      best = [0, 1, 2, 3, 4].sort((a, b) => G.P[5 + b].d - G.P[5 + a].d)[0];
    ok(G.P[5 + who].d >= G.P[5 + best].d - 3, "hot scorer " + hot.n + " is now guarded by " + G.P[5 + who].n);
  }
  // too early to judge: nothing changes
  fresh();
  G.scout(t1[0], 260, false, 0.4);
  G.TS.gpT[1] = 10;
  G.gamePlan(1);
  ok(G.TS.gp[1] === 0, "one miss is not a trend");
  // human team keeps its own calls
  fresh();
  G.setCtrls([G.mkCtrl("p1", 0, true, 0)]);
  for (let k = 0; k < 10; k++) G.scout(G.P[k % 5], 260, false, 0.4);
  G.TS.gpT[0] = 10;
  G.gamePlan(0);
  ok(G.TS.gp[0] === 0 && G.TS.pc[0] === 0, "human team's play call is never changed");
  G.setCtrls([]);
  // full games: adjustments happen, not every possession
  let adj = 0,
    games = 3;
  for (let gi = 0; gi < games; gi++) {
    G.setQtrLen(120);
    G.start(gi % 7, { j: (gi + 2) % 7 });
    let n = 0;
    while (G.S === "play" && n < 60 * 60 * 15) {
      G.upd(1 / 60);
      if (G.RPL) G.skipReplay();
      n++;
      while (G.FX.length) {
        const f = G.FX.shift();
        if (f.k === "ban" && f.s === "ADJUSTMENT") adj++;
      }
    }
  }
  console.log("adjustments per game", (adj / games).toFixed(1));
  ok(adj > 0 && adj / games < 14, "CPU teams adjust a few times a game");
  if (fails) process.exit(1);
  console.log("adapt OK");
})();
