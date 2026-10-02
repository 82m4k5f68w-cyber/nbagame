// Dribble move displacement and ball security for none / hesi / spin / behind-the-back while driving right.
import * as G from "../src/core/sim";
G.cfg.NP = 5; G.cfg.MYM = 0;
let ev: any = {};
G.cfg.input = () => { const i = { dx: 1, dy: 0, ...ev }; ev = {}; return i; };
G.setCtrls([G.mkCtrl("p1", 0)]);
const out: Record<string, any> = {};
for (const key of [0, 1, 2, 3]) {
  G.start(1); const P = G.P; G.setup(0); G.setInb(0);
  const p = P[0]; p.x = 500; p.y = 250; p.vx = p.vy = 0; G.B.owner = p; G.B.mode = "held";
  const d = P[5]; d.x = 530; d.y = 250;
  let maxs = 0, mvSeen = 0, hasBall = 0; const x0 = p.x, y0 = p.y;
  for (let i = 0; i < 90; i++) { if (i === 10 && key) ev.mv = key; G.upd(0.016); maxs = Math.max(maxs, Math.hypot(p.vx, p.vy)); if (p.mvT > 0) mvSeen++; if (G.B.owner === p) hasBall++; }
  out[["none", "hesi", "spin", "btb"][key]] = { maxSpeed: maxs.toFixed(0), dx: (p.x - x0).toFixed(0), dy: (p.y - y0).toFixed(0), moveFrames: mvSeen, ballKept: hasBall + "/90" };
}
console.log(JSON.stringify(out));
