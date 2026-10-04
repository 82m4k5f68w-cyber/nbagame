// Animation blending A/B: the same seeded 5v5 stretch with inertialization (cfg.INZ=1) and with the old exponential
// smoothing (INZ=0). Measures jerk (2nd difference of every joint per tick): inertialization must cut the pops
// (99.9th percentile and the single worst one) while following the targets about as closely (lag = mean |pose - target|).
import * as G from "../src/core/sim";
import { rapInit } from "../src/core/physics";
const W = (a: number) => a - Math.round(a / (2 * Math.PI)) * 2 * Math.PI;
function run(inz: number) {
  let s = 12345;
  Math.random = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  Object.assign(G.cfg, { NP: 5, physics: "rapier", hand: true, MYM: 0, PRO: 1, INZ: inz, PLANT: 0, AVOID: 0 }); // blending alone (placement and avoidance have their own tests)
  G.cfg.input = () => ({ dx: 0, dy: 0 });
  G.setCtrls([]);
  G.start(0); G.setup(0); G.setInb(0);
  const prev = new Map<any, any>();
  const big: number[] = [];
  let lag = 0, ln = 0;
  for (let i = 0; i < 60 * 90; i++) {
    G.upd(1 / 60);
    if (G.RPL || G.S !== "play") { prev.clear(); continue; }
    for (const p of G.P) {
      const q = p.q, pq = prev.get(p);
      const tp = pq && Math.hypot(p.x - pq._x, p.y - pq._y) > 20; // teleported (inbound setup, substitution)
      if (pq && !tp && !(p.hitT > 0))
        for (const k of G.QK) {
          if (k === "wR" || k === "wL" || k === "gL" || k === "gR" || pq["_" + k] == null) continue; // wrist snaps / grips are instant
          big.push(Math.abs(W(q[k] - pq[k]) - W(pq[k] - pq["_" + k]))); // angles are circular (2 pi = same pose)
        }
      if (p.inz) for (let j = 0; j < G.QK.length; j++) if (j !== 13) (lag += Math.abs(q[G.QK[j]] - p.inz.pt[j])), ln++;
      const nq: any = { ...q, _x: p.x, _y: p.y };
      if (pq && !tp) for (const k of G.QK) nq["_" + k] = pq[k];
      prev.set(p, nq);
    }
  }
  big.sort((a, b) => a - b);
  return { p999: big[Math.floor(big.length * 0.999)], max: big[big.length - 1], lag: lag / ln };
}
// shot timing: the shooting arm must rise into a layup as fast as with the old smoothing (no blend lag on releases)
import { pose3 } from "../src/core/pose";
function layArm(inz: number) {
  G.cfg.NP = 1; G.cfg.INZ = inz; G.setCtrls([]); G.start(0); G.setup(0); G.setInb(0);
  const p = G.P[0];
  (p.x = 850), (p.y = 250), (p.f = 0), (p.vx = p.vy = 0), (p.inz = null), (p.q = null);
  const out: number[] = [];
  for (let i = 0; i < 40; i++) {
    const t = Math.max(0, 0.25 - (39 - i) / 60);
    (p.mode = t > 0 ? "s" : "i"), (p.sv = 5), (p.t = t), (p.z = 20), (G.B.owner = p), (G.B.mode = "held");
    pose3(p);
    out.push(p.q.aR);
  }
  return out;
}
(async () => {
  await rapInit();
  const la0 = layArm(0), la1 = layArm(1);
  const shotLag = Math.max(...la0.map((v, i) => Math.abs(v - la1[i])));
  console.log("layup arm max gap vs old blend (rad):", shotLag.toFixed(3));
  const old = run(0), inz = run(1);
  const f = (r: any) => ({ p999: r.p999.toFixed(3), max: r.max.toFixed(2), lag: r.lag.toFixed(4) });
  console.log({ old: f(old), inertialized: f(inz) });
  const ok = inz.p999 < old.p999 * 0.7 && inz.max < old.max * 0.5 && inz.lag <= old.lag * 1.3 && shotLag < 0.3;
  console.log(ok ? "BLEND OK" : "BLEND FAIL");
  process.exit(ok ? 0 : 1);
})();
