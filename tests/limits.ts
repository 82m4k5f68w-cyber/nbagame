// Joint-limit audit on a seeded 5v5 stretch: knees and elbows never bend backwards, ankles stop at ~0.6 rad of
// dorsiflexion (past it the heel comes up), the neck stays in range. Counts player-ticks outside the limits.
import * as G from "../src/core/sim";
import { rapInit } from "../src/core/physics";
(async () => {
  await rapInit();
  let s = 555;
  Math.random = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  Object.assign(G.cfg, { NP: 5, physics: "rapier", hand: true, MYM: 0 });
  G.cfg.input = () => ({ dx: 0, dy: 0 });
  G.setCtrls([]);
  G.setQtrLen(120);
  G.start(4, { j: 1 });
  const L: Record<string, [number, number]> = { kL: [-0.1, 2.7], kR: [-0.1, 2.7], eL: [-0.1, 2.8], eR: [-0.1, 2.8], hp: [-0.9, 0.85], fL: [-0.7, 9], fR: [-0.7, 9] };
  const cnt: Record<string, number> = {};
  let n = 0;
  for (let i = 0; i < 60 * 200 && G.S !== "over"; i++) {
    G.upd(1 / 60);
    if (G.RPL) G.skipReplay();
    G.FX.length = 0;
    if (G.S === "half") G.setS("play");
    if (G.S !== "play") continue;
    for (const p of G.P) {
      if (p.off || !p.q) continue;
      n++;
      for (const k in L) {
        // (ankle dorsiflexion only matters with the foot on the floor)
        if ((k === "fL" || k === "fR") && (p.z > 1 || !(p.stp && p.stp.w > 0.9))) continue;
        const v = p.q[k];
        if (v < L[k][0] || v > L[k][1]) cnt[k] = (cnt[k] || 0) + 1;
      }
    }
  }
  const bad = Object.values(cnt).reduce((a, b) => a + b, 0);
  console.log("player-ticks", n, "outside the limits:", JSON.stringify(cnt), ((100 * bad) / n).toFixed(3) + "%");
  const ok = bad / n < 0.002;
  console.log(ok ? "LIMITS OK" : "LIMITS FAIL");
  process.exit(ok ? 0 : 1);
})();
