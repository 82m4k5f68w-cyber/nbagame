// Curry hitting green (hold & release at the ideal .45 s) by range, through the full upd() pipeline with Rapier.
import * as G from "../src/core/sim";
import { rapInit } from "../src/core/physics";
(async () => {
  await rapInit();
  Object.assign(G.cfg, { NP: 5, physics: "rapier", hand: true, MYM: 0 });
  const K: any = {}; let ev: any = {};
  G.cfg.input = () => { const i = { dx: K.R ? 1 : 0, dy: 0, ...ev }; ev = {}; return i; };
  G.setCtrls([G.mkCtrl("p1", 0)]);
  const out: Record<string, string> = {};
  let bad = 0;
  for (const [lo, hi, label, mv] of [[560, 660, "mid/3 (23-33ft)", 0], [430, 560, "deep (33-45ft)", 0], [330, 430, "heave (45ft+)", 0], [560, 660, "moving toward hoop", 1]] as const) {
    let made = 0, greens = 0, gMade = 0, why = ""; const n = 60;
    for (let i = 0; i < n; i++) {
      G.start(1); const P = G.P, p = P[0]; G.setup(0); G.setInb(0);
      P.forEach((q, k) => { if (k) (q.x = 60), (q.y = 20 + k * 8); });
      p.x = lo + Math.random() * (hi - lo); p.y = 120 + Math.random() * 260; p.vx = p.vy = 0;
      const B = G.B; B.owner = p; B.mode = "held";
      if (mv) K.R = true;
      ev.sd = 1; G.upd(1 / 60);
      let tm = 0;
      while (p.mode === "c" && tm < 2) { if (p.t >= 0.45) ev.su = 1; G.upd(1 / 60); tm += 1 / 60; }
      K.R = false;
      let T = 0;
      while (B.owner === p && T < 1.5) { G.upd(1 / 60); T += 1 / 60; }
      const gn = B.gn, blk = !B.sh && !B.sc;
      T = 0;
      while (T < 5 && !B.owner) { G.upd(1 / 60); T += 1 / 60; if (B.sc) break; }
      if (B.sc) made++;
      if (gn) (greens++, B.sc ? gMade++ : (why += " miss@" + Math.round(Math.hypot(887.5 - p.x, 250 - p.y)) + (blk ? "(blocked)" : "")));
      else why += " notGreen@" + Math.round(Math.hypot(887.5 - p.x, 250 - p.y)) + "(off " + (p.tg ? p.tg.off + "/" + p.tg.win : "?") + ")";
    }
    out[label] = made + "/" + n + " greens " + gMade + "/" + greens + why;
    if (gMade < greens) bad = 1;
  }
  console.log("Curry greens", JSON.stringify(out));
  // every green goes in (heaves and moving shots included)
  if (bad) process.exit(1);
})();
