import * as G from "../src/core/sim";
import { rapInit } from "../src/core/physics";
import { skeleton } from "../src/core/pose";
(globalThis as any).shown = 0;
(async () => {
  await rapInit();
  let s = 99;
  Math.random = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  Object.assign(G.cfg, { NP: 5, physics: "rapier", hand: true, MYM: 0, AVOID: +(process.env.AV ?? 1) });
  G.cfg.input = () => ({ dx: 0, dy: 0 }); G.setCtrls([]); G.start(0); G.setup(0); G.setInb(0);
  const SK = G.P.map(() => new Float32Array(60));
  let ticks = 0;
  const cnt: Record<string, number> = {};
  // joints: 1 chest, 12/16 shoulders, 13/17 elbows, 15/19 hands, 5/9 knees; radii (px, at scale 1)
  const parts: [number, number, string][] = [[1, 4.6, "chest"], [12, 2.6, "sh"], [16, 2.6, "sh"], [13, 1.6, "el"], [17, 1.6, "el"], [15, 1.2, "hand"], [19, 1.2, "hand"], [5, 2, "knee"], [9, 2, "knee"]];
  for (let i = 0; i < 60 * 120; i++) {
    G.upd(1 / 60);
    if (G.RPL || G.S !== "play") continue;
    ticks++;
    G.P.forEach((p, k) => p.q && skeleton(p, SK[k]));
    for (let a = 0; a < G.P.length; a++) for (let b = a + 1; b < G.P.length; b++) {
      const A = G.P[a], Bp = G.P[b];
      if (!A.q || !Bp.q || Math.hypot(A.x - Bp.x, A.y - Bp.y) > 40) continue;
      const seen = new Set<string>();
      for (const [ja, ra, na] of parts) for (const [jb, rb, nb] of parts) {
        const sa = SK[a], sb = SK[b];
        const d = Math.hypot(sa[ja * 3] - sb[jb * 3], sa[ja * 3 + 1] - sb[jb * 3 + 1], sa[ja * 3 + 2] - sb[jb * 3 + 2]);
        const ctx = G.ftq ? "ft" : G.inb > 0 ? "inb" : G.rs > 0 ? "dead" : G.JB ? "jb" : (A.z > 8 || Bp.z > 8) ? "air" : "live";
        const key = [na, nb].sort().join("-") + "/" + ctx;
        if (d < (ra * A.ht + rb * Bp.ht) / 6.4 && !seen.has(key)) {
          if (key === "sh-sh/live" && (globalThis as any).shown++ < 12) { const dd = Math.hypot(A.x - Bp.x, A.y - Bp.y), sA = Math.abs(Math.sin(Math.atan2(Bp.y - A.y, Bp.x - A.x) - A.f)), sB = Math.abs(Math.sin(Math.atan2(A.y - Bp.y, A.x - Bp.x) - Bp.f)); console.log("d", dd.toFixed(1), "sA", sA.toFixed(2), "sB", sB.toFixed(2), A.n, A.anS, A.tm, "|", Bp.n, Bp.anS, Bp.tm, "z", A.z | 0, Bp.z | 0, "sz", A.q.sz.toFixed(2), Bp.q.sz.toFixed(2), "ja/jb", ja, jb, "dist", d.toFixed(1)); } seen.add(key); cnt[key] = (cnt[key] || 0) + 1; }
      }
    }
  }
  console.log("ticks", ticks, Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${(v / ticks * 100).toFixed(1)}%`).join(" "));
})();
