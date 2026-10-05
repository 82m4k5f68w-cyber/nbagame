// Help defense: a driver who beats his man draws a helper from the lane side, a second defender rotates onto the
// man the helper left ("help the helper"), the driver reads it, and the defender whose man catches the kick-out
// sprints to close out. Plus full games: help, rotations and kick-outs all happen.
import * as G from "../src/core/sim";
import { rapInit } from "../src/core/physics";
(async () => {
  await rapInit();
  let fails = 0;
  const ok = (c: boolean, m: string) => (console.log((c ? "ok   " : "FAIL ") + m), c || fails++);
  let s = 99;
  Math.random = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  Object.assign(G.cfg, { NP: 5, physics: "rapier", hand: true, MYM: 0 });
  G.setQtrLen(120);
  G.setCtrls([G.mkCtrl("p1", 0, true, 0)]);
  G.cfg.input = () => ({ dx: 1, dy: 0, sp: 1 }); // the human drives straight at the rim
  G.start(0, { j: 1 });
  G.setup(0);
  G.setInb(0);
  const P = G.P,
    me = P[0],
    // offense: driver at the top, four spaced out; defense: everyone on his man, the driver's man beaten (behind him)
    spots = [[700, 250], [820, 60], [820, 440], [700, 70], [700, 430]];
  for (let k = 0; k < 5; k++) {
    const o = P[k];
    (o.x = spots[k][0]), (o.y = spots[k][1]), (o.vx = o.vy = 0), (o.mode = "i");
  }
  (me.vx = 220), (me.vy = 0);
  G.B.owner = me;
  G.B.mode = "held";
  for (let k = 5; k < 10; k++) {
    const d = P[k],
      o = P[k - 5];
    (d.mode = "i"), (d.vx = d.vy = 0), (d.manT = 3), (d.man = k - 5);
    (d.x = o.x + (887.5 - o.x) * 0.12), (d.y = o.y + (250 - o.y) * 0.12);
  }
  (P[5].x = 670), (P[5].y = 250); // beaten: trailing the driver
  const start = P.map((q) => [q.x, q.y]);
  let h: any = null,
    r: any = null,
    m: any = null;
  for (let i = 0; i < 20 && !(h && r); i++) {
    G.upd(1 / 60);
    if (G.HPL.h) (h = G.HPL.h), (r = G.HPL.r), (m = G.HPL.m);
  }
  ok(!!h && h !== P[5] && h.tm === 1, "a helper steps up (" + (h && h.n) + "), not the beaten man");
  if (h) {
    const k = P.indexOf(h),
      off0 = Math.abs(start[k][1] - 250); // distance off the driving line (the driver goes straight down y = 250)
    G.cfg.input = () => ({ dx: 0.3, dy: 0 }); // (slow the drive so the help has time to arrive)
    for (let i = 0; i < 12; i++) G.upd(1 / 60);
    const off1 = Math.abs(h.y - 250);
    ok(off1 < off0 - 8, "...and slides into the driving lane (" + off0.toFixed(0) + " -> " + off1.toFixed(0) + " px off the line)");
  }
  ok(!!r && r !== h && r !== P[5] && m === P[P.indexOf(h) - 5], "a second defender rotates onto the helper's man (" + (r && r.n) + " -> " + (m && m.n) + ")");
  // kick-out: the ball goes to a corner; his defender sprints at him
  G.cfg.input = () => ({ dx: 0, dy: 0 });
  const tgt = m || P[1];
  G.pass(me, tgt);
  let caught = false;
  for (let i = 0; i < 90 && !caught; i++) G.upd(1 / 60), (caught = G.B.owner === tgt);
  ok(caught, "the kick-out is caught by " + tgt.n);
  const cd = P.filter((q) => q.tm === 1 && !q.off).sort((a, b) => Math.hypot(a.x - tgt.x, a.y - tgt.y) - Math.hypot(b.x - tgt.x, b.y - tgt.y))[0];
  const d0 = Math.hypot(cd.x - tgt.x, cd.y - tgt.y);
  for (let i = 0; i < 12; i++) G.upd(1 / 60);
  const d1 = Math.hypot(cd.x - tgt.x, cd.y - tgt.y);
  ok(d1 < d0 || d1 < 30, "the nearest defender closes out (" + d0.toFixed(0) + " -> " + d1.toFixed(0) + " px)");
  // CPU vs CPU: it all happens in real games
  G.setCtrls([]);
  for (const k of ["help", "rot", "kick", "kA"]) G.STAT[k] = 0;
  G.setQtrLen(60);
  G.start(2, { j: 4 });
  for (let n = 0; n < 60 * 60 * 6 && G.S !== "over"; n++) {
    G.upd(1 / 60);
    if (G.RPL) G.skipReplay();
    if (G.S === "half") G.setS("play");
    G.FX.length = 0;
  }
  const S = G.STAT;
  console.log("game: help", S.help, "rotations", S.rot, "kick-outs", S.kick, "shots off kick-outs", S.kA);
  ok(S.help > 10 && S.rot > 5 && S.kick > 3, "help, rotations and kick-outs in a CPU game");
  // spot inbounds: a frontcourt violation comes in from the nearest line at the spot (baseline / sideline), a
  // backcourt one from the baseline as usual; the inbound pass is caught by a teammate and is never called out
  G.setQtrLen(120);
  for (const [x, y, nm, ex, ey] of [
    [900, 380, "baseline", 934, null],
    [700, 495, "sideline", 700, 496],
    [300, 10, "backcourt", 6, 250],
  ] as any) {
    G.start(0, { j: 1 });
    G.setupAt(0, x, y);
    const ib = G.B.owner,
      o0 = G.STAT.oob || 0,
      ix = Math.round(ib.x),
      iy = Math.round(ib.y);
    let got: any = null;
    for (let i = 0; i < 200 && !got; i++) {
      G.upd(1 / 60);
      G.FX.length = 0;
      if (G.B.owner && G.B.owner !== ib) got = G.B.owner;
    }
    ok(ix === ex && (ey == null || iy === ey) && !!got && got.tm === 0 && (G.STAT.oob || 0) === o0, nm + " inbound from " + ix + "," + iy + " caught by " + (got && got.n));
  }
  if (fails) process.exit(1);
  console.log("HELP OK");
})();
