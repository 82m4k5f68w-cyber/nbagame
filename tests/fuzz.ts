// Random-input fuzz over every mode flag combo (NP 5/1 x rapier/legacy x My Player/team, local 2P):
// no exceptions, no NaN positions/poses, My Player never drifts off index 0.
import * as G from "../src/core/sim";
import { rapInit } from "../src/core/physics";
(async () => {
  await rapInit();
  let mv = 0, post = 0, frames = 0, bad = 0;
  const K: any = {}; let ev: any = {};
  G.cfg.input = (c) => {
    const i: G.Input = { dx: (K.R ? 1 : 0) - (K.L ? 1 : 0), dy: (K.D ? 1 : 0) - (K.U ? 1 : 0), ...ev, post: K.B };
    if (c.id === "p1") ev = {};
    return i;
  };
  for (const [np, phys] of [[5, "rapier"], [5, "legacy"], [1, "rapier"], [1, "legacy"]] as const)
    for (let g = 0; g < 4; g++) {
      Object.assign(G.cfg, { NP: np, physics: phys, hand: phys === "rapier", MYM: g % 2, playerBodies: g === 3 });
      const cs = [G.mkCtrl("p1", 0)];
      if (g === 2) cs.push(G.mkCtrl("p2", 1, false, 1));
      G.setCtrls(cs);
      G.start(g % G.nChoices());
      for (let i = 0; i < 7000; i++) {
        if (i % 9 === 0) { K.R = Math.random() < 0.6; K.L = Math.random() < 0.3; K.U = Math.random() < 0.4; K.D = Math.random() < 0.4; K.B = Math.random() < 0.3; }
        const r = Math.random();
        if (r < 0.03) ev.sd = 1; else if (r < 0.06) ev.su = 1; else if (r < 0.08) ev.e = 1; else if (r < 0.1) ev.mv = 1; else if (r < 0.12) ev.mv = 2; else if (r < 0.14) ev.mv = 3; else if (r < 0.15) ev.sb = 1; else if (r < 0.155) ev.sw = 1;
        G.upd(1 / 60);
        if (G.RPL && Math.random() < 0.01) G.skipReplay();
        frames++;
        for (const p of G.P) {
          if (p.mvT > 0) mv++;
          if (p.postA) post++;
          if (![p.x, p.y, p.z, p.vx, p.vy].every(isFinite)) { console.log("NaN player", np, phys); bad++; }
          if (p.q) for (const v of Object.values(p.q)) if (!isFinite(v as number)) { bad++; break; }
        }
        if (![G.B.x, G.B.y, G.B.z].every(isFinite)) { console.log("NaN ball", np, phys); bad++; }
        if (G.cfg.MYM && G.CT[0].idx !== 0 && !(G.ftq && G.ftq.i >= 0)) { console.log("My Player drift", G.CT[0].idx); bad++; }
        if (G.S === "over") G.start(g % G.nChoices());
        if (bad) process.exit(1);
      }
    }
  console.log("fuzz ok frames", frames, "move frames", mv, "post frames", post);
})();
