// An idle human defender must never be walked into goaltending by the rebound assist (bug: on every CPU shot the
// (A CPU teammate who jumped and was then auto-switched to the human can still goaltend at the CPU rate, ~5% of tries.)
// assist jumped him at the ball above the rim). Idle human, CPU shots: count goaltends called on the human's team.
import * as G from "../src/core/sim";
import { rapInit } from "../src/core/physics";
await rapInit();
G.cfg.input = () => ({ dx: 0, dy: 0 }) as G.Input;
let gtH = 0, gtAll = 0, shots = 0;
for (const np of [5, 1]) {
  Object.assign(G.cfg, { NP: np, physics: "rapier", hand: true, MYM: 0, DIFF: 2 });
  G.setQtrLen(60);
  G.setCtrls([G.mkCtrl("p1", 0)]);
  G.start(np > 1 ? 3 : 7, { j: np > 1 ? 5 : 12 });
  let t = 0;
  while (G.S !== "over" && t < 60 * 60 * 8) {
    const lc = G.P.reduce((a, p) => a + (p.tm === 1 ? p.lc || 0 : 0), 0);
    G.upd(1 / 60);
    shots += G.P.reduce((a, p) => a + (p.tm === 1 ? p.lc || 0 : 0), 0) - lc;
    for (const f of G.FX) if (f.k === "ban" && f.s === "GOALTENDING") { gtAll++; const g = G.P.find((p) => (f.sub || "").startsWith(p.n.toUpperCase() + " ")); if (g && G.isH(g) && G.T - (g.hJ ?? -9) < 1.6) gtH++; }
    G.FX.length = 0;
    if (G.RPL) G.skipReplay();
    t++;
  }
}
console.log(`CPU shots ${shots}, goaltends ${gtAll}, charged to a human jump ${gtH}`);
if (gtH > 0) { console.log("FAIL: idle human goaltended"); process.exit(1); }
console.log("OK");
