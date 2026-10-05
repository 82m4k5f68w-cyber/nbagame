// A ball resting on the iron or wedged between the back iron and the glass must come free within a few seconds
// (it froze a game once: the old nudge pushed it into the board). Both hoops, a few spots, Rapier.
import * as G from "../src/core/sim";
import { rapInit } from "../src/core/physics";
(async () => {
  await rapInit();
  Object.assign(G.cfg, { NP: 1, physics: "rapier", hand: true, MYM: 0 });
  G.cfg.input = () => ({ dx: 0, dy: 0 });
  G.setCtrls([]);
  const fails: string[] = [];
  for (const hx of G.HXs)
    // (11-12 px behind: between the back iron and the glass - it froze a game; now the ref calls a held ball)
    for (const [ox, oy, z] of [[10.5, -3, 98], [10.5, 0, 99], [7.6, 4, 101], [-7.6, 0, 101], [0, 7.6, 101], [11.5, -2, 100], [12, 0, 100], [11, 2, 101]]) {
      G.start(0); G.setup(0); G.setInb(0);
      for (const p of G.P) (p.x = 470), (p.y = 60 + G.P.indexOf(p) * 30); // nobody near the hoop
      const dir = hx > 470 ? 1 : -1, B = G.B;
      B.owner = null; B.mode = "air"; B.sh = 1; B.sc = 0; B.last = G.P[0];
      B.x = hx + ox * dir; B.y = G.HY + oy; B.z = z; B.vx = B.vy = B.vz = 0;
      let t = 0;
      while (t < 5 && Math.abs(B.x - hx) < 14 && B.z > 90 && !B.sc) { G.upd(1 / 60); if (G.RPL) G.skipReplay(); t += 1 / 60; }
      if (t >= 5) fails.push(`stuck at ${[ox, oy, z]} hoop ${hx}: ball ${[B.x, B.y, B.z].map((v) => v.toFixed(0))}`);
    }
  console.log(fails.length ? "RIM WEDGE FAIL\n" + fails.join("\n") : "RIM WEDGE OK");
  process.exit(fails.length ? 1 : 0);
})();
