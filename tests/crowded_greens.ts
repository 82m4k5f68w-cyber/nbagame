// Regression: green jumpers must count even with every other player crowding the rim for the rebound
// (rebounders used to snatch a dropping green out of the cylinder).
import * as G from "../src/core/sim";
import { rapInit } from "../src/core/physics";
await rapInit();
Object.assign(G.cfg, { NP: 5, physics: "rapier", hand: true, MYM: 0 });
let ev: any = {};
G.cfg.input = () => { const i = { dx: 0, dy: 0, ...ev }; ev = {}; return i; };
G.setCtrls([G.mkCtrl("p1", 0)]);
let made = 0, snatched = 0, greens = 0, gMade = 0; const n = 80;
for (let i = 0; i < n; i++) {
  G.start(1); const P = G.P, p = P[0]; G.setup(0); G.setInb(0);
  p.x = 887.5 - 240 + Math.random() * 20; p.y = 200 + Math.random() * 100; p.vx = p.vy = 0;
  P.forEach((q, k) => { if (k) { q.x = 860 + Math.random() * 25; q.y = 225 + Math.random() * 50; } });
  const B = G.B; B.owner = p; B.mode = "held";
  ev.sd = 1; G.upd(1 / 60);
  let tm = 0;
  while (p.mode === "c" && tm < 2) { if (p.t >= (p.st === 1 ? 0.45 : 0.6)) ev.su = 1; G.upd(1 / 60); tm += 1 / 60; }
  let T = 0;
  while (B.owner === p && T < 1.5) { G.upd(1 / 60); T += 1 / 60; }
  const green = B.gn; T = 0;
  while (T < 4 && !B.sc) {
    // worst case: two defenders camp directly under the rim and leap as the ball comes down
    for (const k of [5, 6]) { const q = P[k]; q.x = 884 + (k - 5) * 6; q.y = 248; q.vx = q.vy = 0; if (B.vz < 0 && B.z < 160 && q.z <= 0) q.vz = 180; }
    G.upd(1 / 60); T += 1 / 60; if (B.owner && B.owner !== p) break;
  }
  if (B.sc) made++; else if (green && B.owner && B.z > 50) snatched++;
  if (green) (greens++, B.sc && gMade++);
}
console.log("crowded greens made", made + "/" + n, "greens", gMade + "/" + greens, "snatched above rim", snatched);
if (gMade < greens || greens < n * 0.9) process.exit(1); // (every green goes in, even with bodies leaping at it under the rim)
