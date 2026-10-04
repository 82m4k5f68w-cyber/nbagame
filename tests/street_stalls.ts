// Street 3v3 stall hunt: seeded half-court games must keep scoring (no 90 s without a basket). npx tsx tests/street_stalls.ts
import * as G from "../src/core/sim";
import { rapInit } from "../src/core/physics";
import { M, startStreet } from "../src/core/modes";
(async () => {
  await rapInit();
  G.setCtrls([]);
  for (let seed = 1; seed <= (+process.env.N || 20); seed++) {
    let s = seed * 7919;
    Math.random = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
    G.cfg.NP = 5;
    startStreet(2, 5, 3);
    let n = 0, lastSc = 0, lastT = 0;
    while (G.S === "play" && !M.done && n < 60 * 60 * 15) {
      G.upd(1 / 60); if (G.RPL) G.skipReplay(); G.FX.length = 0; n++;
      const t = G.sc[0] + G.sc[1];
      if (t !== lastSc) (lastSc = t), (lastT = n);
      if (n - lastT > 60 * 90) {
        const B = G.B;
        console.log("STALL seed", seed, "tick", n, G.sc, { inb: G.inb, rs: G.rs, ftq: !!G.ftq, pos: G.pos, shot: G.shot, clock: G.clock, B: { o: B.owner && B.owner.n, m: B.mode, x: B.x | 0, y: B.y | 0, z: B.z | 0, vx: B.vx | 0, vz: B.vz | 0 } });
        for (const p of G.P) console.log(p.n, p.tm, p.mode, p.x | 0, p.y | 0, p.z | 0, Math.hypot(p.vx, p.vy) | 0, JSON.stringify(p.ai || {}).slice(0, 120));
        break;
      }
    }
    if (n - lastT > 60 * 90) break;
    console.log("seed", seed, G.sc.join("-"), n);
  }
})();
