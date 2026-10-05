// TS twin of unity/CoreTests/GameRun.cs: same games, legacy ball physics, same summary line.
//   npx tsx scripts/unity/gamerun.ts [N] [QL]
import * as G from "../../src/core/sim";
const N = +(process.argv[2] || 4), QL = +(process.argv[3] || 180);
let s = 2024;
Math.random = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
Object.assign(G.cfg, { NP: 5, physics: "legacy", MYM: 0, DIFF: 2 });
G.cfg.input = () => ({ dx: 0, dy: 0 });
const A = { pts: 0, fga: 0, fgm: 0, tpa: 0, tpm: 0, reb: 0, ast: 0, blk: 0 };
let teams = 0, ticksAll = 0;
const t0 = performance.now();
for (let g = 0; g < N; g++) {
  G.setQtrLen(QL);
  G.setCtrls([]);
  G.start(g % 7, { j: (g + 3) % 7 });
  let ticks = 0;
  while (G.S !== "over" && ticks < 60 * QL * 6) {
    G.upd(1 / 60);
    if (G.RPL) G.skipReplay();
    G.FX.length = 0;
    ticks++;
    if (G.S === "half") G.setS("play");
  }
  ticksAll += ticks;
  console.log(`game ${g}: ${G.cl[0]} ${G.sc[0]} - ${G.sc[1]} ${G.cl[1]}  (${G.S}, ${ticks} ticks)`);
  for (let t = 0; t < 2; t++) {
    teams++;
    for (const p of G.ROST[t]) for (const k of Object.keys(A) as (keyof typeof A)[]) A[k] += p.stt[k];
  }
}
const k = (48 * 60) / (4 * QL) / teams;
console.log(`per team/48: pts ${(A.pts * k).toFixed(1)} fga ${(A.fga * k).toFixed(1)} fg% ${((100 * A.fgm) / A.fga).toFixed(1)} 3pa ${(A.tpa * k).toFixed(1)} 3p% ${((100 * A.tpm) / A.tpa).toFixed(1)} reb ${(A.reb * k).toFixed(1)} ast ${(A.ast * k).toFixed(1)} blk ${(A.blk * k).toFixed(1)}`);
console.log(`sim: ${((performance.now() - t0) / ticksAll).toFixed(3)} ms/tick over ${ticksAll} ticks`);
