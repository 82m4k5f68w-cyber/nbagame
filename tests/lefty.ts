// Left-handed shooters (SIG lh): the shot is mirrored, the ball leaves the LEFT hand (handPos follows q.mir), and
// green releases still go in through the full upd() pipeline with Rapier.
import * as G from "../src/core/sim";
import { rapInit } from "../src/core/physics";
import { handPos } from "../src/core/pose";
(async () => {
  await rapInit();
  Object.assign(G.cfg, { NP: 5, physics: "rapier", hand: true, MYM: 0 });
  let ev: any = {};
  G.cfg.input = () => { const i = { dx: 0, dy: 0, ...ev }; ev = {}; return i; };
  let team = -1;
  for (let i = 0; i < 7 && team < 0; i++) { G.start(i); if (G.P.some((q) => q.tm === 0 && /Brunson/.test(q.n))) team = i; }
  const c = G.mkCtrl("p1", 0);
  G.setCtrls([c]);
  let made = 0, left = 0, mirSeen = 0;
  const n = 60;
  for (let i = 0; i < n; i++) {
    G.start(team); G.setup(0); G.setInb(0);
    const P = G.P, p = P.find((q) => /Brunson/.test(q.n))!;
    (c as any).idx = P.indexOf(p);
    P.forEach((q) => { if (q !== p) (q.x = 60), (q.y = 20 + P.indexOf(q) * 8); });
    p.x = 600 + Math.random() * 120; p.y = 120 + Math.random() * 260; p.vx = p.vy = 0;
    const B = G.B; B.owner = p; B.mode = "held";
    ev.sd = 1; G.upd(1 / 60);
    let tm = 0;
    while (p.mode === "c" && tm < 2) {
      if (p.t >= (p.st === 1 ? 0.45 : 0.6)) ev.su = 1;
      G.upd(1 / 60); tm += 1 / 60;
      if (p.q.mir) mirSeen++;
    }
    // where is the hand relative to the body at the release? (the rig's right shoulder is at facing - 90deg in game coords)
    const h = handPos(p)!, lx = Math.cos(p.f + Math.PI / 2), ly = Math.sin(p.f + Math.PI / 2);
    if ((h[0] - p.x) * lx + (h[1] - p.y) * ly > 2) left++;
    let T = 0;
    while (B.owner === p && T < 1.5) { G.upd(1 / 60); T += 1 / 60; }
    T = 0;
    while (T < 5 && !B.owner) { G.upd(1 / 60); T += 1 / 60; if (B.sc) break; }
    if (B.sc) made++;
  }
  console.log({ made: made + "/" + n, leftHand: left + "/" + n, mirFrames: mirSeen });
  const ok = made >= n * 0.9 && left >= n * 0.9 && mirSeen > 0;
  console.log(ok ? "LEFTY OK" : "LEFTY FAIL");
  process.exit(ok ? 0 : 1);
})();
