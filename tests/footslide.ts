// Foot sliding A/B: the same seeded 5v5 stretch with core foot planting (cfg.PLANT=1) and without. A foot is on the
// floor when its ankle is within 1 px of it; sliding = how fast such a foot moves over the floor (px/s), measured on the
// analytic skeleton (what the 2D view, replays and the server see; the 3D client's footIK refines the rest).
import * as G from "../src/core/sim";
import { rapInit } from "../src/core/physics";
import { skeleton } from "../src/core/pose";
const NAME = ["idle", "run", "def", "drib", "shot", "air", "move", "post", "scr", "cel", "rest", "cat"];
function run(plant: number) {
  let s = 777;
  Math.random = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  Object.assign(G.cfg, { NP: 5, physics: "rapier", hand: true, MYM: 0, PLANT: plant });
  G.cfg.input = () => ({ dx: 0, dy: 0 });
  G.setCtrls([]);
  G.start(0); G.setup(0); G.setInb(0);
  const SK = new Float32Array(60), prev = new Map<any, number[]>(), qp = new Map<any, any>(), jerk: number[] = [];
  const W = (a: number) => a - Math.round(a / (2 * Math.PI)) * 2 * Math.PI;
  const by: Record<string, [number, number]> = {};
  let slide = 0, contact = 0;
  for (let i = 0; i < 60 * 90; i++) {
    G.upd(1 / 60);
    if (G.RPL || G.S !== "play") { prev.clear(); continue; }
    for (const p of G.P) {
      // pops in the leg joints (2nd difference per tick) - placement must not buy its grip with snaps
      const pq = qp.get(p);
      // (a teleport - setup after a basket, a substitution - is a cut, not a pop: skip a few ticks after one)
      const tp = pq && Math.hypot(p.x - pq._x, p.y - pq._y) > 15;
      p._tpT = tp ? 4 : Math.max(0, (p._tpT || 0) - 1);
      if (pq && !p._tpT && !(p.hitT > 0))
        for (const k of ["tL", "tR", "kL", "kR", "fL", "fR", "hz", "hs", "cr"]) if (pq["_" + k] != null) jerk.push(Math.abs(W(p.q[k] - pq[k]) - W(pq[k] - pq["_" + k])));
      const nq: any = { ...p.q, _x: p.x, _y: p.y };
      if (pq) for (const k of ["tL", "tR", "kL", "kR", "fL", "fR", "hz", "hs", "cr"]) nq["_" + k] = pq[k];
      qp.set(p, nq);
      if (p.z > 1) { prev.delete(p); continue; }
      skeleton(p, SK);
      const f = [SK[18], SK[19], SK[20], SK[30], SK[31], SK[32]], pf = prev.get(p); // ankles L (6), R (10)
      if (pf && Math.hypot(p.x - pf[6], p.y - pf[7]) < 15)
        for (const o of [0, 3])
          if (f[o + 2] < 1 && pf[o + 2] < 1) {
            const d = Math.hypot(f[o] - pf[o], f[o + 1] - pf[o + 1]);
            slide += d; contact += 1 / 60;
            const k = NAME[p.anS] || "?";
            (by[k] = by[k] || [0, 0]), (by[k][0] += d), (by[k][1] += 1 / 60);
          }
      prev.set(p, [...f, p.x, p.y]);
    }
  }
  jerk.sort((a, b) => a - b);
  return { j: jerk[Math.floor(jerk.length * 0.999)], v: slide / contact, rows: Object.entries(by).map(([k, [d, t]]) => `${k}:${(d / t).toFixed(0)}`).join(" ") };
}
(async () => {
  await rapInit();
  const a = run(0), b = run(1);
  console.log("foot slide px/s  off:", a.v.toFixed(1), "|", a.rows, "\n                 on: ", b.v.toFixed(1), "|", b.rows);
  console.log("leg jerk p99.9   off:", a.j.toFixed(3), " on:", b.j.toFixed(3));
  const ok = b.v < a.v * 0.2 && b.j < a.j * 2.2; // TODO tighten the jerk budget as stepping improves
  console.log(ok ? "FOOTSLIDE OK" : "FOOTSLIDE FAIL");
  process.exit(ok ? 0 : 1);
})();
