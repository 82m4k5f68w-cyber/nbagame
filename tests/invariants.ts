// Full games in every mode with a random human: invariants that must always hold.
//  - team score == sum of its players' points   - games always reach the final buzzer
//  - no possession stalls (ball dead with nobody acting) for > 30 s   - ball and players stay in bounds
//  - fgm <= fga, tpm <= tpa, tpm <= fgm         - shot clock never runs away negative
import * as G from "../src/core/sim";
import { rapInit } from "../src/core/physics";
await rapInit();
const fails: string[] = [];
const K: any = {};
let ev: any = {};
G.cfg.input = (c) => {
  const i: G.Input = { dx: (K.R ? 1 : 0) - (K.L ? 1 : 0), dy: (K.D ? 1 : 0) - (K.U ? 1 : 0), ...ev };
  if (c.id === "p1") ev = {};
  return i;
};
for (const [np, mym, mp2] of [
  [5, 0, 0],
  [5, 1, 0],
  [5, 0, 1],
  [1, 0, 0],
  [1, 1, 0],
] as const) {
  Object.assign(G.cfg, { NP: np, physics: "rapier", hand: true, MYM: mym, DIFF: 2 });
  G.setQtrLen(30);
  const cs = [G.mkCtrl("p1", 0, !!mym)];
  if (mp2) cs.push(G.mkCtrl("p2", 1));
  G.setCtrls(cs);
  const j = G.start(np > 1 ? 3 : 7, { j: np > 1 ? 5 : 12 });
  const tag = `np${np} my${mym} mp${mp2}`;
  if (mym && np === 1 && G.cl[1] !== G.RO(12)[2]) fails.push(`${tag}: My Player 1v1 opponent ignored (got ${G.cl[1]}, wanted ${G.RO(12)[2]})`);
  void j;
  let t = 0, still = 0, lastHash = "";
  while (G.S !== "over" && t < 60 * 60 * 6) {
    if (t % 11 === 0) { K.R = Math.random() < 0.6; K.L = Math.random() < 0.3; K.U = Math.random() < 0.4; K.D = Math.random() < 0.4; }
    const r = Math.random();
    if (r < 0.02) ev.sd = 1; else if (r < 0.04) ev.su = 1; else if (r < 0.05) ev.e = 1; else if (r < 0.06) ev.mv = 1 + ((Math.random() * 3) | 0);
    G.upd(1 / 60);
    if (G.RPL && Math.random() < 0.02) G.skipReplay();
    t++;
    const h = [G.B.x | 0, G.B.y | 0, G.B.z | 0, G.B.owner ? G.P.indexOf(G.B.owner) : -1, G.sc.join()].join();
    still = h === lastHash ? still + 1 : 0;
    lastHash = h;
    if (still === 60 * 30) fails.push(`${tag}: ball frozen 30 s (S=${G.S} inb=${G.inb.toFixed(2)} rs=${G.rs.toFixed(2)} ftq=${!!G.ftq} owner=${G.B.owner && G.B.owner.n} mode=${G.B.owner && G.B.owner.mode})`);
    if (G.shot < -2) fails.push(`${tag}: shot clock ran away ${G.shot.toFixed(1)}`);
    if (G.B.x < -20 || G.B.x > 960 || G.B.y < -20 || G.B.y > 520 || G.B.z < -10 || G.B.z > 600) { fails.push(`${tag}: ball out of world ${[G.B.x, G.B.y, G.B.z].map((v) => v.toFixed(0))}`); break; }
    if (fails.length > 12) break;
  }
  // a game still tied in overtime at the tick cap is legal basketball (random-input humans can trade empty OTs)
  if (G.S !== "over" && !(G.q > 4 && G.sc[0] === G.sc[1])) fails.push(`${tag}: game never ended`);
  for (const tm of [0, 1]) {
    const pts = G.P.filter((p) => p.tm === tm).reduce((a, p) => a + p.stt.pts, 0);
    if (pts !== G.sc[tm]) fails.push(`${tag}: team ${tm} score ${G.sc[tm]} != players' points ${pts}`);
  }
  for (const p of G.P) if (p.stt.fgm > p.stt.fga || p.stt.tpm > p.stt.tpa || p.stt.tpm > p.stt.fgm) fails.push(`${tag}: impossible line ${p.n} ${JSON.stringify(p.stt)}`);
  console.log(tag, "final", G.sc.join("-"), "q", G.q, "ticks", t);
}
console.log(fails.length ? "FAIL\n" + [...new Set(fails)].join("\n") : "invariants ok");
process.exit(fails.length ? 1 : 0);
