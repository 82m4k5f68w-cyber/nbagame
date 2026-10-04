// Body overlap in live play: how often (share of ticks) some pair of players has an arm, shoulder or chest inside the
// other's body (spheres on the analytic skeleton). Orientation-aware spacing in collide() (shoulder to shoulder needs
// more room than chest to chest) and the pose's avoidBodies() keep it down. A/B: cfg.AVOID 0 vs 1.
import * as G from "../src/core/sim";
import { rapInit } from "../src/core/physics";
import { skeleton } from "../src/core/pose";
const parts: [number, number, string][] = [[1, 4.6, "chest"], [12, 2.6, "sh"], [16, 2.6, "sh"], [13, 1.6, "el"], [17, 1.6, "el"], [15, 1.2, "hand"], [19, 1.2, "hand"]];
// (pooled over two seeded stretches: one run is chaotic - any change anywhere sends it down a different game)
function run(avoid: number) {
  let ticks = 0;
  const cnt: Record<string, number> = {};
  for (const seed of [99, 4242]) ticks += run1(avoid, seed, cnt);
  const pc = (k: string) => ((cnt[k] || 0) / ticks) * 100;
  return { pc, row: Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${((v / ticks) * 100).toFixed(1)}%`).join(" ") };
}
function run1(avoid: number, seed: number, cnt: Record<string, number>) {
  let s = seed;
  Math.random = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  Object.assign(G.cfg, { NP: 5, physics: "rapier", hand: true, MYM: 0, AVOID: avoid });
  G.cfg.input = () => ({ dx: 0, dy: 0 }); G.setCtrls([]); G.start(0); G.setup(0); G.setInb(0);
  const SK = G.P.map(() => new Float32Array(60));
  let ticks = 0;
  for (let i = 0; i < 60 * 120; i++) {
    G.upd(1 / 60);
    if (G.RPL || G.S !== "play" || G.ftq || G.inb > 0 || G.rs > 0 || G.JB) continue;
    ticks++;
    G.P.forEach((p, k) => p.q && skeleton(p, SK[k]));
    const seen = new Set<string>();
    for (let a = 0; a < G.P.length; a++) for (let b = a + 1; b < G.P.length; b++) {
      const A = G.P[a], Bp = G.P[b];
      if (!A.q || !Bp.q || A.z > 8 || Bp.z > 8 || Math.hypot(A.x - Bp.x, A.y - Bp.y) > 40) continue;
      for (const [ja, ra, na] of parts) for (const [jb, rb, nb] of parts) {
        const sa = SK[a], sb = SK[b];
        const d = Math.hypot(sa[ja * 3] - sb[jb * 3], sa[ja * 3 + 1] - sb[jb * 3 + 1], sa[ja * 3 + 2] - sb[jb * 3 + 2]);
        const key = [na, nb].sort().join("-");
        if (d < (ra * A.ht + rb * Bp.ht) / 6.4 && !seen.has(key)) seen.add(key);
      }
    }
    for (const k of seen) cnt[k] = (cnt[k] || 0) + 1;
  }
  return ticks;
}
(async () => {
  await rapInit();
  const a = run(0), b = run(1);
  console.log("overlap (share of live ticks)  avoid off:", a.row, "\n                               avoid on: ", b.row);
  const ok = b.pc("chest-el") < a.pc("chest-el") * 0.6 && b.pc("sh-sh") < 10 && b.pc("chest-sh") < 6;
  console.log(ok ? "OVERLAP OK" : "OVERLAP FAIL");
  process.exit(ok ? 0 : 1);
})();
