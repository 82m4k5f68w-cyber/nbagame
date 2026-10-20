// 400 perfectly timed shots from random spots (no defenders), Rapier and legacy physics: every green goes in
// (launch makes a human's green a make; greenGuide in bstep sees it through drag, spin and the iron).
import * as G from "../src/core/sim";
import { rapInit } from "../src/core/physics";
(async () => {
  await rapInit();
  let bad = 0;
  for (const phys of ["rapier", "legacy"] as const) {
    G.cfg.NP = 5;
    G.cfg.physics = phys;
    G.start(0);
    const P = G.P;
    const res: Record<string, number> = {};
    for (let i = 0; i < 400; i++) {
      G.setup(0);
      const p = P[0];
      P.forEach((q, k) => { if (k) (q.x = 60), (q.y = 20 + k * 8); });
      p.x = 480 + Math.random() * 330; p.y = 60 + Math.random() * 380; p.z = 20; p.vz = 0;
      p.mode = "s"; p.t = 0.4; p.sv = 0; p.rl = 0; p.mt = p.st === 1 ? 0.45 : 0.6;
      const B = G.B; B.owner = p; B.mode = "held";
      G.launch(p);
      const gn = B.gn;
      let T = 0; B.sc = 0;
      while (T < 4 && B.z > -5) { G.bstep(0.004); T += 0.004; if (B.owner) break; }
      const cat = !gn ? "not green" : B.sc ? "made" : B.owner ? "caught" : "miss";
      res[cat] = (res[cat] || 0) + 1;
    }
    console.log(phys, res);
    if ((res.made || 0) < 400) bad++;
  }
  G.cfg.physics = "rapier";
  console.log(bad ? "GREENS FAIL" : "GREENS OK (400/400 on both)");
  process.exit(bad ? 1 : 0);
})();
