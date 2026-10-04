import * as G from "../src/core/sim";
import { rapInit } from "../src/core/physics";
import { handPos, skeleton } from "../src/core/pose";
(async () => {
  await rapInit();
  let s = 99;
  Math.random = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  Object.assign(G.cfg, { NP: 5, physics: "rapier", hand: true, MYM: 0 });
  G.cfg.input = () => ({ dx: 0, dy: 0 }); G.setCtrls([]); G.start(0); G.setup(0); G.setInb(0);
  const SK = new Float32Array(60);
  const acc: Record<string, number[]> = {};
  const add = (k: string, v: number) => (acc[k] = acc[k] || []).push(v);
  for (let i = 0; i < 60 * 120; i++) {
    G.upd(1 / 60);
    if (G.RPL || G.S !== "play") continue;
    const o = G.B.owner;
    if (!o || !o.q) continue;
    if (o.mode === "c" || o.mode === "s") {
      const h = handPos(o)!;
      add("shot " + o.mode, Math.hypot(h[0] - G.B.x, h[1] - G.B.y, h[2] - G.B.z));
    } else if (o.mode === "i") {
      skeleton(o, SK);
      // nearest hand (joints 15 L hand, 19 R hand) to the ball
      const dL = Math.hypot(SK[45] - G.B.x, SK[46] - G.B.y, SK[47] - G.B.z), dR = Math.hypot(SK[57] - G.B.x, SK[58] - G.B.y, SK[59] - G.B.z);
      const d = Math.min(dL, dR);
      // at the top of the bounce (the catch) the hand should be on the ball
      if (G.B.vz > -5 && G.B.vz < 5 && G.B.z > 20) add("dribble catch", d);
      else add("dribble any", d);
    }
  }
  for (const [k, a] of Object.entries(acc)) { a.sort((x, y) => x - y); console.log(k.padEnd(14), "n", a.length, "median", a[a.length >> 1].toFixed(1), "p90", a[Math.floor(a.length * 0.9)].toFixed(1), "px"); }
})();
