// Green window vs contest (sim.ts cwin / greenWin / shotContest): the table, the HUD meter's window equals the one launch
// judges (same function, same locked contest), the window shrinks live as a defender closes in while the shot is
// charged, and every non-blocked green goes in even when contested (hand up, or a defender leaping at it).
//   npx tsx tests/green_window.ts
import * as G from "../src/core/sim";
import { rapInit } from "../src/core/physics";
(async () => {
  await rapInit();
  let fails = 0;
  const ok = (c: boolean, m: string) => (console.log((c ? "ok   " : "FAIL ") + m), c || fails++);
  let s = 5;
  Math.random = () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296;
  Object.assign(G.cfg, { NP: 5, physics: "rapier", hand: true, MYM: 0, JB: 0 });
  G.setQtrLen(120);
  // ---- 1. the table ----
  const rows = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 1].map((c) => [c, G.cwin(c)]);
  console.log("contest -> window: " + rows.map(([c, w]) => c.toFixed(2) + " " + Math.round(w * 100) + "%").join(" | "));
  ok(G.cwin(0) === 1 && Math.abs(G.cwin(0.3) - 0.7) < 1e-9 && G.cwin(0.75) === 0.25 && G.cwin(1) === 0.25, "open = full window, light contest -30%, smothered -75% (floor: greens stay achievable)");
  ok(rows.every((r, k) => !k || r[1] <= rows[k - 1][1]), "the window never grows with the contest");
  let tk = 0,
    script: (t: number) => any = () => ({ dx: 0, dy: 0 });
  G.cfg.input = () => script(tk);
  const run = (n: number, each?: () => void) => {
    for (let i = 0; i < n; i++, tk++) {
      if (each) each();
      G.upd(1 / 60);
      if (G.RPL) G.skipReplay();
      G.FX.length = 0;
    }
  };
  const scene = (x: number) => {
    G.setCtrls([G.mkCtrl("p1", 0)]);
    G.start(0, { j: 1 });
    G.setup(0);
    G.setInb(0);
    G.setClock(100);
    G.setShot(24);
    G.P.forEach((q: any, k: number) => ((q.x = 120 + k * 15), (q.y = k < 5 ? 40 : 460), (q.vx = q.vy = q.vz = q.z = 0), (q.mode = "i"), (q.cd = 0)));
    const me = G.P[0];
    (me.x = x), (me.y = 250);
    G.B.owner = me;
    G.B.mode = "held";
    tk = 0;
    return { me, d: G.P.find((q: any) => q.tm === 1 && G.guardOf(q) === me) };
  };
  const hudWin = (p: any) => {
    const D0 = Math.hypot(G.hoop(p.tm) - p.x, G.HY - p.y),
      rat = G.shotRat(p, D0, !!G.ftq);
    return G.greenWin(p, rat, G.shotContest(p), D0 < 90 || p.hk ? 1 : G.winMul(p, D0));
  };
  // ---- 2. live shrink while charging: a defender walks up from 9 ft to 2 ft ----
  {
    const { me, d } = scene(620);
    script = (t) => (t === 0 ? { dx: 0, dy: 0, sd: 1 } : { dx: 0, dy: 0 });
    const ws: number[] = [];
    run(40, () => {
      (d.x = 710 - Math.min(70, tk * 2.2)), (d.y = 250), (d.vx = d.vy = 0);
      if (tk > 0 && me.mode === "c") ws.push(hudWin(me));
    });
    ok(ws.length > 20 && ws[ws.length - 1] < ws[0] * 0.45, "the meter's window shrinks live as he closes in: " + (ws[0] * 1000).toFixed(0) + " -> " + (ws[ws.length - 1] * 1000).toFixed(0) + " ms");
  }
  // ---- 3. HUD == launch, and every non-blocked green goes in, open / hand up / leaping ----
  const shoot = (gap: number, leap: boolean) => {
    const { me, d } = scene(560 + (tk % 7));
    const hold = () => ((d.x = me.x + gap), (d.y = me.y), (d.vx = d.vy = 0), (d.hupT = gap < 40 ? 0.5 : 0));
    script = (t) => (t === 0 ? { dx: 0, dy: 0, sd: 1 } : { dx: 0, dy: 0 });
    run(1, hold);
    // release at the middle of the window the meter shows
    let rel = false;
    for (let n = 0; n < 90 && me.mode === "c"; n++) {
      const D0 = Math.hypot(887.5 - me.x, 250 - me.y),
        wm = 0.07 + (G.shotRat(me, D0, false) / 100) * 0.05,
        cen = (me.st === 1 ? 0.45 : 0.6) + (wm - hudWin(me));
      if (leap && me.t > 0.25 && d.z <= 0) d.vz = 150;
      const now = !rel && me.t + 1 / 60 >= cen;
      if (now) (script = () => ({ dx: 0, dy: 0, su: 1, mt: cen })), (rel = true);
      run(1, () => ((d.x = me.x + gap), (d.y = me.y)));
      if (now) script = () => ({ dx: 0, dy: 0 });
    }
    let same = true;
    for (let n = 0; n < 40 && G.B.owner === me; n++) run(1);
    if (me.tg && me.mode === "s") same = Math.abs(me.tg.win - Math.round(hudWin(me) * 1000)) <= 1;
    const gn = G.B.gn,
      blocked = !G.B.sh && !G.B.sc && G.B.last !== me;
    for (let n = 0; n < 200 && !G.B.sc && !G.B.owner; n++) run(1);
    return { gn, made: !!G.B.sc, blocked, same, cw: me.cw };
  };
  for (const [gap, leap, label] of [[200, false, "open"], [34, false, "hand up at 3 ft"], [22, true, "leaping at it"]] as const) {
    let g = 0,
      m = 0,
      b = 0,
      same = 0,
      n = 40,
      cw = 0;
    for (let k = 0; k < n; k++) {
      const r = shoot(gap, leap);
      if (r.blocked) b++;
      else if (r.gn) (g++, r.made && m++);
      if (r.same) same++;
      cw += r.cw || 0;
    }
    console.log(label + ": contest " + (cw / n).toFixed(2) + ", window x" + G.cwin(cw / n).toFixed(2) + ", greens made " + m + "/" + g + ", blocked " + b);
    ok(m === g && g >= n * 0.5, label + ": every non-blocked green goes in (" + m + "/" + g + ")");
    ok(same === n, label + ": the meter's window is the one launch judged (" + same + "/" + n + ")");
  }
  console.log(fails ? "GREEN WINDOW FAIL " + fails : "GREEN WINDOW OK");
  process.exit(fails ? 1 : 0);
})();
