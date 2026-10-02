// Pass accuracy by type (auto / chest / bounce / lob) to a moving receiver, no defenders in the lane.
import * as G from "../src/core/sim";
import { rapInit } from "../src/core/physics";
await rapInit();
for (const phys of ["rapier", "legacy"] as const) {
G.cfg.physics = phys;
G.cfg.NP = 5;
G.start(1);
const P = G.P, res: Record<string, any> = {};
for (const ty of [undefined, 0, 1, 2]) {
  let ok = 0, loose = 0, wrong = 0; const n = 300;
  for (let i = 0; i < n; i++) {
    G.setup(0);
    const p = P[0], r = P[2];
    P.forEach((q, k) => { if (k !== 0 && k !== 2) { q.x = 60; q.y = 20 + k * 10; } });
    p.x = 300 + Math.random() * 200; p.y = 100 + Math.random() * 300; p.z = 0; p.vx = p.vy = 0;
    const ang = Math.random() * 6.28, d = 80 + Math.random() * 260;
    r.x = Math.min(900, Math.max(30, p.x + Math.cos(ang) * d)); r.y = Math.min(480, Math.max(20, p.y + Math.sin(ang) * d));
    const sp = Math.random() * 150, a2 = Math.random() * 6.28; r.vx = Math.cos(a2) * sp; r.vy = Math.sin(a2) * sp; r.z = 0; r.mode = "i";
    const B = G.B; B.owner = p; B.mode = "held"; B.x = p.x + 8; B.y = p.y; B.z = 35;
    G.pass(p, r, ty);
    let T = 0;
    while (T < 2.5) { G.bstep(0.008); T += 0.008; r.x = Math.min(920, Math.max(20, r.x + r.vx * 0.008)); r.y = Math.min(480, Math.max(20, r.y + r.vy * 0.008)); if (B.owner) break; }
    if (B.owner === r) ok++; else if (B.owner) wrong++; else loose++;
  }
  res[ty === undefined ? "auto" : ty] = { caught: ((100 * ok) / n).toFixed(0) + "%", loose: ((100 * loose) / n).toFixed(0) + "%", other: ((100 * wrong) / n).toFixed(0) + "%" };
}
console.log(phys, JSON.stringify(res));
}
