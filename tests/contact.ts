// Contact QA on a seeded 5v5 stretch (analytic skeleton = what 2D, replays and the server see):
// - the dribble hand meets the ball at the top of the bounce (post-blend contact pass),
// - a ball held in both hands (triple threat, pump fake, jab, inbound) sits between the palms (placed by bstep from
//   the previous tick's pose, so within one tick of hand motion),
// - a pass is caught in the hands (palms vs ball on the tick before the catch),
// - feet never sink through the floor (also when lying on it after a dive or a knock-down).
import * as G from "../src/core/sim";
import { rapInit } from "../src/core/physics";
import { skeleton } from "../src/core/pose";
(async () => {
  await rapInit();
  let s = 4242;
  Math.random = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  Object.assign(G.cfg, { NP: 5, physics: "rapier", hand: true, MYM: 0 });
  G.cfg.input = () => ({ dx: 0, dy: 0 });
  G.setCtrls([]);
  G.setQtrLen(120);
  G.start(2, { j: 5 });
  const SK = new Float32Array(60),
    drib: number[] = [],
    held: number[] = [],
    toe: number[] = [],
    cat: number[] = [],
    PS = new Float32Array(60);
  let pto: any = null,
    pb = [0, 0, 0];
  for (let i = 0; i < 60 * 150 && G.S !== "over"; i++) {
    G.upd(1 / 60);
    if (G.RPL) G.skipReplay();
    G.FX.length = 0;
    if (G.S === "half") G.setS("play");
    if (G.S !== "play") continue;
    const B = G.B,
      o = B.owner;
    if (o && o === pto && G.inb <= 0) cat.push(Math.min(Math.hypot(PS[45] - pb[0], PS[46] - pb[1], PS[47] - pb[2]), Math.hypot(PS[57] - pb[0], PS[58] - pb[1], PS[59] - pb[2])));
    pto = B.mode === "pass" ? B.to : null;
    if (pto) skeleton(pto, PS), (pb = [B.x, B.y, B.z]);
    if (o && o.mode === "i" && B.mode === "held" && !o.postA) {
      skeleton(o, SK);
      if (G.heldBall(o) || G.inb > 0) held.push(Math.hypot((SK[45] + SK[57]) / 2 - B.x, (SK[46] + SK[58]) / 2 - B.y, (SK[47] + SK[59]) / 2 - B.z));
      else if (B.dtop != null && Math.abs(B.z - B.dtop) < 3) drib.push(Math.min(Math.hypot(SK[45] - B.x, SK[46] - B.y, SK[47] - B.z), Math.hypot(SK[57] - B.x, SK[58] - B.y, SK[59] - B.z)));
    }
    for (const p of G.P) {
      if (p.off) continue;
      skeleton(p, SK);
      toe.push(SK[23], SK[35]);
    }
  }
  for (const a of [drib, held, toe, cat]) a.sort((x, y) => x - y);
  const q = (a: number[], f: number) => a[Math.min(a.length - 1, Math.floor(a.length * f))];
  console.log(`dribble top hand-ball px p50 ${q(drib, 0.5).toFixed(1)} p90 ${q(drib, 0.9).toFixed(1)} (n ${drib.length}) | held ball off the palms px p90 ${q(held, 0.9).toFixed(2)} (n ${held.length}) | toe depth px p0.1 ${q(toe, 0.001).toFixed(1)} | pass caught: palm-ball px p50 ${q(cat, 0.5).toFixed(1)} (n ${cat.length})`);
  const ok = drib.length > 300 && q(drib, 0.5) < 6 && q(drib, 0.9) < 22 && held.length > 100 && q(held, 0.9) < 6 && q(toe, 0.001) > -4 && cat.length > 30 && q(cat, 0.5) < 21;
  console.log(ok ? "CONTACT OK" : "CONTACT FAIL");
  process.exit(ok ? 0 : 1);
})();
