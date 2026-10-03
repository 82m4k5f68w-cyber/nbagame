// Drop balls straight through the net (swish) at three speeds: must score, and the net must slow the ball.
import { rapInit } from "../src/core/physics";
import * as G from "../src/core/sim";
G.cfg.NP = 1; G.cfg.MYM = 0; G.cfg.JB = 0; // no opening tip: the test drops its own ball
G.cfg.input = () => ({ dx: 0, dy: 0 });
G.setCtrls([G.mkCtrl("p1", 0)]);
await rapInit();
const fails: string[] = [];
for (const v0 of [-150, -300, -450]) {
  G.start(1); G.setInb(0);
  const B = G.B; const hx = G.HXs[1];
  for (const p of G.P) { p.x = 300; p.y = 100; }
  B.owner = null; B.mode = "air"; B.sh = 1; B.x = hx + 0.5; B.y = G.HY; B.z = 112; B.vx = 0; B.vy = 0; B.vz = v0; B.wv = [0, 0, 0];
  let tIn = 0, minVz = 0, exitV = 0, sc = 0, t = 0;
  for (let i = 0; i < 120; i++) {
    G.upd(1 / 60); t += 1 / 60;
    if (B.z < 99 && B.z > 82) tIn += 1 / 60;
    if (B.z < 82 && !exitV) exitV = B.vz;
    sc = sc || B.sc;
  }
  const N = G.NETS[1]; const minZ = Math.min(...N.p.map((q: any) => q.z));
  if (!sc || Math.abs(exitV) >= Math.abs(v0) * 0.95) fails.push(`v0 ${v0}: scored ${sc} exit ${exitV.toFixed(0)}`);
  console.log(`v0 ${v0}: scored ${sc} timeInNet ${tIn.toFixed(2)}s exitVz ${exitV.toFixed(0)} netLowest ${minZ.toFixed(1)}`);
}
if (fails.length) {
  console.log("FAIL", fails);
  process.exit(1);
}
console.log("swish ok");
