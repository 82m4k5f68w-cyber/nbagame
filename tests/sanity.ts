// Gameplay sanity sweep (things a player would notice), over seeded CPU 5v5 games plus one with a passive human:
//  - bodies through each other: two upright players' centres < 9 px for 0.4 s+ in live play
//  - a frozen handler: the ball handler (CPU) standing still (< 4 px/s) for 4 s+ in live play
//  - needless heaves: a CPU FGA from 36 ft+ with 5 s+ on both the shot and the game clock
//  - backcourt dawdling: a handler 6 s+ in his own backcourt (8-second risk)
//  - dead-ball stalls: no live play (rs/inb/ftq) for 12 s+ in a row
//  - a passive human (no input at all) never shoots, passes, jumps or fakes by himself while he has the ball
// Prints the counts; fails on the hard ones (stalls, frozen handlers, passive-human actions, through-bodies > budget).
//   N=3 npx tsx tests/sanity.ts
import * as G from "../src/core/sim";
import { rapInit } from "../src/core/physics";
(async () => {
  await rapInit();
  let fails = 0;
  const ok = (c: boolean, m: string) => (console.log((c ? "ok   " : "FAIL ") + m), c || fails++);
  const N = +(process.env.N || 3),
    QL = +(process.env.QL || 120);
  let s = +(process.env.SEED || 11);
  Math.random = () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296;
  Object.assign(G.cfg, { NP: 5, physics: "rapier", hand: true, MYM: 0, DIFF: 2 });
  const R = { through: 0, frozen: 0, heave: 0, backc: 0, stall: 0, humAct: 0, ticks: 0, fga: 0 };
  const near = new Map<string, number>();
  for (let g = 0; g <= N; g++) {
    const human = g === N; // the last game: a passive human on team 0
    G.cfg.input = () => ({ dx: 0, dy: 0 });
    G.setQtrLen(QL);
    G.setCtrls(human ? [G.mkCtrl("p1", 0, true, 0)] : []);
    G.start(g % 7, { j: (g + 2) % 7 });
    near.clear();
    let still = 0,
      bc = 0,
      dead = 0,
      lastLc = new Map<any, number>(),
      ticks = 0;
    while (G.S !== "over" && ticks < 60 * QL * 6) {
      const me = human ? G.P[0] : null,
        hadBall = me && G.B.owner === me && me.mode === "i",
        lc0 = me ? me.lc || 0 : 0,
        z0 = me ? me.vz : 0,
        pp0 = G.B.pp;
      G.upd(1 / 60);
      if (G.RPL) G.skipReplay();
      if (G.S === "half") G.setS("play");
      G.FX.length = 0;
      ticks++;
      R.ticks++;
      const live = G.rs <= 0 && G.inb <= 0 && !G.ftq && G.S === "play";
      dead = live ? 0 : dead + 1 / 60;
      if (dead > 12) R.stall++, (dead = -1e9);
      if (hadBall && me) {
        // he had the ball and touched nothing: anything he did is an auto-action
        if ((me.lc || 0) !== lc0 || me.mode === "c" || me.mode === "s" || (me.vz > 0 && z0 <= 0) || me.act === 1 || me.act === 2 || (G.B.mode === "pass" && G.B.pp !== pp0 && G.B.last === me))
          R.humAct++, process.env.DBG && console.log("humAct " + JSON.stringify({ lc: (me.lc || 0) !== lc0, mode: me.mode, jump: me.vz > 0 && z0 <= 0, act: me.act, pass: G.B.mode === "pass", sv: me.sv, x: me.x | 0, y: me.y | 0, shot: G.shot.toFixed(1), clock: G.clock.toFixed(1), z: me.z | 0 }));
      }
      if (!live) {
        (still = 0), (bc = 0);
        continue;
      }
      // bodies through each other
      for (let a = 0; a < G.P.length; a++)
        for (let b = a + 1; b < G.P.length; b++) {
          const p = G.P[a],
            q = G.P[b];
          if (p.off || q.off || p.act === 3 || p.act === 4 || q.act === 3 || q.act === 4 || p.z > 20 || q.z > 20) continue;
          const k = a + "-" + b,
            d = Math.hypot(p.x - q.x, p.y - q.y),
            t = d < 9 ? (near.get(k) || 0) + 1 / 60 : 0;
          near.set(k, t);
          if (t > 0.4 && t - 1 / 60 <= 0.4) R.through++;
        }
      const o = G.B.owner;
      if (o && o.mode === "i" && !G.isH(o)) {
        still = Math.hypot(o.vx, o.vy) < 4 ? still + 1 / 60 : 0;
        if (still > 4) R.frozen++, (still = -1e9);
        const back = G.hoop(o.tm) > 470 ? o.x < 470 : o.x > 470;
        bc = back ? bc + 1 / 60 : 0;
        if (bc > 6) R.backc++, (bc = -1e9);
      } else still = 0;
      for (const p of G.P) {
        const lc = p.lc || 0;
        if (lc !== (lastLc.get(p) ?? lc) && !G.ftq) {
          R.fga++;
          const D = Math.hypot(G.hoop(p.tm) - p.x, 250 - p.y);
          if (!G.isH(p) && D > 360 && G.shot > 5 && G.clock > 5) R.heave++, process.env.DBG && console.log("heave", p.n, "D", D | 0, "shot", G.shot.toFixed(1), "clock", G.clock.toFixed(1), "q", G.q, "mode", p.mode, "sv", p.sv, "x", p.x | 0, "pass?", G.B.mode);
        }
        lastLc.set(p, lc);
      }
    }
    console.log("game", g, human ? "(passive human)" : "", G.sc.join("-"), "q", G.q, "ticks", ticks);
  }
  console.log("sanity", JSON.stringify(R));
  ok(R.stall === 0, "no dead-ball stalls (12 s+): " + R.stall);
  ok(R.frozen === 0, "no frozen CPU ball handlers (4 s+ standing): " + R.frozen);
  ok(R.humAct === 0, "a passive human never acts by himself with the ball: " + R.humAct);
  ok(R.heave <= 1, "needless CPU heaves (36 ft+, time on both clocks): " + R.heave);
  ok(R.backc <= 1, "backcourt dawdling (6 s+): " + R.backc);
  ok(R.through <= N * 4, "bodies through each other (0.4 s+ under 9 px): " + R.through);
  console.log(fails ? "SANITY FAIL " + fails : "SANITY OK");
  process.exit(fails ? 1 : 0);
})();
