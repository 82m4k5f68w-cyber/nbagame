// Fun features through the full pipeline: alley-oops get thrown down; greens can swish; AI games produce highlights.
import * as G from "../src/core/sim";
import { rapInit } from "../src/core/physics";
await rapInit();
Object.assign(G.cfg, { NP: 5, physics: "rapier", hand: true, MYM: 0 });
G.setCtrls([]);
let oops = 0, oopMade = 0;
for (let n = 0; n < 40; n++) {
  G.start(4); // Spurs: Wembanyama finishes lobs
  const P = G.P;
  G.setup(0);
  G.setInb(0);
  const h = P[0], r = P[4];
  h.x = 700; h.y = 200; r.x = 860; r.y = 265; r.vx = r.vy = 0;
  P.forEach((q, k) => { if (k >= 5) { q.x = 300; q.y = 40 + k * 20; } });
  G.B.owner = h; G.B.mode = "held"; G.B.x = h.x + 8; G.B.y = h.y; G.B.z = 40;
  G.pass(h, r, 2);
  const s0 = G.sc[0];
  for (let i = 0; i < 180 && G.sc[0] === s0; i++) { G.upd(1 / 60); if (r.oop || (r.sv === 6 && r.mode === "s")) oops++; }
  if (G.sc[0] > s0) oopMade++;
}
const seen: Record<string, number> = {};
for (const f of G.FX) if (f.k === "t") seen[f.s] = (seen[f.s] || 0) + 1;
console.log("alley-oop dunk frames", oops, "lob possessions scored", oopMade + "/40", "callouts", JSON.stringify(seen));
if (oopMade < 25) process.exit(1);
