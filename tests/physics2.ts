// Physics v3 (cfg.PH3): air drag / Magnus, surfaces, spin on the bounce, rolling resistance, shooter's touch, rim wobble +
// board shake, the shattered backboard (and its setting), chain nets, knockdowns / stumbles, screens that get run
// through, box-outs, bobbled passes, balls off feet, fatigue (lower jumps, tired jumpers short), sweat spots + slips.
//   npx tsx tests/physics2.ts
import * as G from "../src/core/sim";
let fails = 0;
const ok = (c: boolean, m: string) => (console.log((c ? "ok   " : "FAIL ") + m), c || fails++);
const RND = Math.random;
const fresh = () => {
  Object.assign(G.cfg, { NP: 5, physics: "legacy", hand: false, PH3: 1, SHATTER: 1, HALF: 0, GM: "game", JB: 0 });
  G.cfg.input = () => ({ dx: 0, dy: 0 });
  G.setCtrls([]);
  G.start(0, { j: 1 });
  G.setJB(null);
  G.setScalars({ S: "play", rs: 0, inb: 0, ftq: null });
  for (const p of G.P) (p.off = 1), (p.x = 470), (p.y = 30 + p.tm * 440 + p.k * 5), (p.vx = p.vy = 0);
  G.B.owner = null;
};
const ball = (x: number, y: number, z: number, vx: number, vy: number, vz: number, w = [0, 0, 0], mode = "air") =>
  Object.assign(G.B, { x, y, z, vx, vy, vz, wv: w.slice(), mode, owner: null, sh: 0, sc: 0, age: 0.5, to: null, last: null, dk: 0, dfl: 0, ft: 0 });
const run = (s: number, f?: () => boolean | void) => {
  for (let i = 0; i < s * 120; i++) {
    G.bstep(1 / 120);
    if (f && f()) return i / 120;
  }
  return s;
};

// 1. air: quadratic drag, Magnus from backspin
{
  const acc = (v: number[], w: number[]) => (G.AV.splice(0, 6, ...v, ...w), G.airAcc(0.01), [...G.AV.slice(0, 3)]);
  const d1 = 300 - acc([300, 0, 0], [0, 0, 0])[0],
    d2 = 600 - acc([600, 0, 0], [0, 0, 0])[0];
  ok(Math.abs(d2 / d1 - 4) < 0.01, `drag is quadratic (x${(d2 / d1).toFixed(2)} at twice the speed; ${(d1 * 100).toFixed(0)} px/s^2 at 30 ft/s = ${((d1 * 100) / 320 * 100).toFixed(0)}% of g)`);
  const lift = acc([300, 0, 0], [0, -16, 0])[2]; // backspin on a ball flying +x: w = (0, -16, 0)
  ok(lift > 0, `backspin lifts the ball (Magnus +${(lift * 100).toFixed(0)} px/s^2)`);
}

// 2. surfaces: bounce height, backspin bites, asphalt rolls out sooner
{
  fresh();
  const drop = (half: number) => {
    G.cfg.HALF = half;
    ball(300, 250, 100, 0, 0, 0);
    let vin = 0,
      vout = 0;
    run(2, () => {
      const v = G.B.vz;
      G.bstep(1 / 120);
      if (v < -30 && G.B.vz > 0) return ((vin = -v), (vout = G.B.vz), true);
    });
    return vout / vin;
  };
  const ew = drop(0),
    ea = drop(1);
  ok(Math.abs(ew - 0.8) < 0.02, `hardwood bounce e ${ew.toFixed(3)} (~.8)`);
  ok(ea < ew - 0.02, `asphalt is deader: e ${ea.toFixed(3)}`);
  const pass = (wy: number) => {
    G.cfg.HALF = 0;
    ball(300, 250, 20, 300, 0, -150, [0, wy, 0]);
    let vx = 0;
    run(1, () => {
      const v = G.B.vz;
      G.bstep(1 / 120);
      if (v < 0 && G.B.vz >= 0) return ((vx = G.B.vx), true);
    });
    return vx;
  };
  const none = pass(0),
    back = pass(-60),
    top = pass(60);
  ok(back < none - 30 && top > none, `bounce pass vx after the bounce: backspin ${back.toFixed(0)} < none ${none.toFixed(0)} < topspin ${top.toFixed(0)}`);
  const roll = (half: number) => {
    G.cfg.HALF = half;
    ball(300, 250, G.BR, 150, 0, 0, [0, 150 / G.BR, 0]);
    return run(10, () => G.B.vx === 0) as number;
  };
  const rw = roll(0),
    ra = roll(1);
  ok(rw < 5 && ra < rw * 0.7, `rolling at 150 px/s stops after ${rw.toFixed(2)} s (wood) / ${ra.toFixed(2)} s (asphalt)`);
  G.cfg.HALF = 0;
}

// 3. shooter's touch + make captions bookkeeping
{
  fresh();
  const s = G.P[0];
  (s.c = 95), (s.i = 90);
  Math.random = () => 0;
  G.B.owner = s;
  s.mode = "s";
  G.launch(s);
  const t1 = G.B.tch;
  (s.c = 60), (s.i = 60), (G.B.owner = s), G.launch(s);
  Math.random = RND;
  ok(t1 > 0.1 && G.B.tch === 0 && G.B.rh === 0, `shooter's touch: ${t1.toFixed(3)} for a 95 shooter, 0 for a 60 one`);
}

// 4. rim wobble + board shake + shatter
{
  fresh();
  const N = G.NETS[1];
  (N.tvx = 30), (N.tvy = 0), (N.bsv = 60);
  ball(470, 250, 50, 0, 0, 0);
  let mx = 0,
    mb = 0;
  for (let i = 0; i < 60; i++) G.netSim(1 / 60), (mx = Math.max(mx, Math.abs(N.tx))), (mb = Math.max(mb, Math.abs(N.bs)));
  ok(mx > 0.3 && mb > 0.3, `a dunk kick tilts the rim (${mx.toFixed(2)} px) and shakes the board (${mb.toFixed(2)} px)`);
  for (let i = 0; i < 180; i++) G.netSim(1 / 60);
  ok(Math.abs(N.tx) < 0.05 && Math.abs(N.bs) < 0.05, "both ring out within 4 s");
  const top = N.p.filter((q: any) => q.f);
  (N.tx = 1), (N.ty = 0);
  G.netSim(1 / 60);
  const side = top.reduce((a: number, q: any) => a + (q.x > N.hx ? q.z : -q.z), 0);
  ok(side < 0, "the net's top ring rides the tilt (the +x side dips)");
  // shatter: a monster dunker, the roll at 0
  const L = G.P[0];
  Object.assign(L, { bk: 1.3, ht: 7.0, j: 95, off: 0 });
  G.B.last = L;
  Math.random = () => 0;
  G.FX.length = 0;
  const yes = G.ph3Shatter(G.HXs[1]);
  ok(yes && G.NETS[1].shT > 0 && G.FX.some((f: any) => f.k === "shatter"), `a monster dunk can shatter the glass (power ${(L.bk * L.ht * (0.6 + L.j / 200)).toFixed(2)}): FX + ${G.NETS[1].shT} s stoppage`);
  G.cfg.SHATTER = 0;
  ok(!G.ph3Shatter(G.HXs[1]), "never with the setting off");
  G.cfg.SHATTER = 1;
  Object.assign(L, { bk: 1, ht: 6.4, j: 70 });
  ok(!G.ph3Shatter(G.HXs[1]), "never for an ordinary dunker (power below 7.2)");
  Math.random = RND;
  for (let i = 0; i < 9 * 60; i++) G.netSim(1 / 60);
  ok(!(G.NETS[1].shT > 0), "the new board is up after the stoppage");
}

// 5. chain nets in street games
{
  fresh();
  G.cfg.HALF = 1;
  ok(G.chainNet(), "street = chain nets");
  G.FX.length = 0;
  ball(G.HXs[1], G.HY, 110, 0, 0, -250);
  for (let i = 0; i < 30; i++) G.bstep(1 / 120), G.bstep(1 / 120), G.netSim(1 / 60);
  ok(G.FX.some((f: any) => f.k === "chain"), "a ball through a chain net clanks (FX chain)");
  G.cfg.HALF = 0;
  ok(!G.chainNet(), "arena = nylon");
}

// 6. bodies: knockdown by the jolt, screens run through, box-outs
{
  const crash = (ph3: number) => {
    fresh();
    G.cfg.PH3 = ph3;
    const A = G.P[0],
      C = G.P[5];
    Object.assign(A, { off: 0, x: 400, y: 250, z: 0, vx: 300, vy: 0, bk: 1.3, ht: 7.0, mode: "i", actT: 0, act: 0, f: 0 });
    Object.assign(C, { off: 0, x: 410, y: 250, z: 0, vx: -300, vy: 0, bk: 0.9, ht: 6.2, mode: "i", actT: 0, act: 0, f: Math.PI });
    Math.random = () => 0;
    G.collide();
    Math.random = RND;
    return [A.act, C.act, C.slow];
  };
  const [a1, c1, s1] = crash(1),
    [, c0] = crash(0);
  ok(c1 === 3 && a1 !== 3, `a head-on crash floors the lighter man (act ${c1}), not the big one`);
  ok(s1 >= 0.22, "and he stumbles first");
  ok(c0 !== 3, "PH3 0: no knockdowns");
  G.cfg.PH3 = 1;
  fresh();
  const sc = G.P[0],
    df = G.P[5];
  Object.assign(sc, { off: 0, x: 400, y: 250, z: 0, vx: 0, vy: 0, bk: 0.9, ht: 6.2, setT: 1, f: Math.PI });
  Object.assign(df, { off: 0, x: 415, y: 250, z: 0, vx: -220, vy: 0, bk: 1.3, ht: 7.0, scr: 0, f: Math.PI });
  const f0 = G.PH3C.fight || 0;
  G.collide();
  ok((G.PH3C.fight || 0) > f0 && df.scr < 0.4, `a much heavier man at speed fights through a screen (stopped ${df.scr.toFixed(2)} s, screener rocked)`);
  fresh();
  const s2 = G.P[0],
    d2 = G.P[5];
  Object.assign(s2, { off: 0, x: 400, y: 250, z: 0, vx: 0, vy: 0, bk: 1.25, ht: 7.0, setT: 1, f: Math.PI });
  Object.assign(d2, { off: 0, x: 415, y: 250, z: 0, vx: -220, vy: 0, bk: 0.9, ht: 6.2, scr: 0, f: Math.PI });
  G.collide();
  ok(d2.scr > 0.55 && Math.abs(d2.vx) < 120, `a big screener stops a small man dead (${d2.scr.toFixed(2)} s, his run eaten: vx ${d2.vx.toFixed(0)})`);
  // box-out: the defender sealing his man under a missed shot holds him off the rim
  const box = (ph3: number) => {
    fresh();
    G.cfg.PH3 = ph3;
    const X = G.P[5],
      O = G.P[0];
    Object.assign(X, { off: 0, x: 840, y: 250, z: 0, f: Math.PI });
    Object.assign(O, { off: 0, x: 822, y: 250, z: 0, f: 0 });
    ball(870, 250, 130, 0, 0, 0);
    Object.assign(G.B, { sh: 1, last: G.P[1], age: 0.3 });
    const x0 = O.x;
    for (let t = 0; t < 60; t++) (O.vx = 180), (O.vy = 0), (X.vx = X.vy = 0), (O.x += 3), G.collide();
    return O.x - x0;
  };
  const b1 = box(1),
    b0 = box(0);
  ok(b1 < b0 - 20, `box-outs: the man gets ${b1.toFixed(0)} px toward the rim (PH3 0: ${b0.toFixed(0)})`);
  G.cfg.PH3 = 1;
}

// 7. ball handling: bobbled hard pass, ball off a foot (no steals: the receiver / passer's team keeps a live ball)
{
  fresh();
  const ps = G.P[1],
    r = G.P[0];
  Object.assign(ps, { off: 0, x: 200, y: 250 });
  Object.assign(r, { off: 0, x: 400, y: 250, z: 0, vx: 0, vy: 0, mode: "i", s: 70, f: Math.PI });
  ball(390, 250, 50, 720, 0, 0, [0, 0, 0], "pass");
  Object.assign(G.B, { to: r, last: ps, pp: { p: ps, t: G.T } });
  Math.random = () => 0;
  G.bstep(1 / 120);
  Math.random = RND;
  ok(G.B.mode === "air" && G.B.last === r && G.B.vz > 80 && !G.B.owner, `a 720 px/s pass is bobbled: pops up off his hands (vz ${G.B.vz.toFixed(0)})`);
  fresh();
  const q = G.P[6],
    to = G.P[0],
    pa = G.P[1];
  Object.assign(q, { off: 0, x: 400, y: 250, z: 0 });
  Object.assign(to, { off: 0, x: 600, y: 250 });
  Object.assign(pa, { off: 0, x: 200, y: 250 });
  ball(396, 250, 5, 300, 0, 0, [0, 0, 0], "pass");
  Object.assign(G.B, { to, last: pa });
  G.bstep(1 / 120);
  ok(G.B.last === q && G.B.mode === "air" && G.B.vx < 0, "a low pass skidding into a defender's foot kicks off it (he touched it last)");
}

// 8. fatigue: lower jumps, tired jumpers come up short (never a human green), heavy landings
{
  ok(G.ph3Fat({ en: 1 }) === 0 && Math.abs(G.ph3Fat({ en: 0.2 }) - 1) < 1e-9 && Math.abs(G.ph3Fat({ en: 0.45 }) - 0.5) < 1e-9, "tiredness 0 at energy .7+, 1 at .2");
  const range = (en: number) => {
    fresh();
    const s = G.P[0];
    Object.assign(s, { off: 0, x: 700, y: 250, z: 0, en, c: 85, i: 80, mode: "s", t: 0.4 });
    G.B.owner = s;
    Math.random = () => 0.01;
    G.launch(s);
    Math.random = RND;
    return Math.hypot(G.B.vx, G.B.vy);
  };
  const r1 = range(1),
    r0 = range(0.2);
  ok(r0 < r1 * 0.995 && r0 > r1 * 0.98, `a tired CPU jumper comes up short (${((1 - r0 / r1) * 100).toFixed(2)}% less carry)`);
}

// 9. sweat spots late in games: they build up, a slip on one, the ball kids mop them in a timeout
{
  fresh();
  G.setScalars({ q: 3 });
  const [x, y] = G.swPos(3);
  for (let k = 0; k < 4; k++) Object.assign(G.P[k], { off: 0, x: x + k, y, z: 0 });
  for (let i = 0; i < 60 * 120; i++) G.collide();
  const w = G.wetAt(x, y);
  ok(w > 0.5, `four players in the paint for 2 min in Q3 wet the spot (${w.toFixed(2)})`);
  ok(G.wetAt(470, 250) === 0, "mid-court stays dry");
  G.TS.hud = 1;
  G.collide();
  G.TS.hud = 0;
  ok(G.wetAt(x, y) === 0, "a timeout: mopped");
}

console.log(fails ? `PHYSICS2 FAIL (${fails})` : "PHYSICS2 OK");
process.exit(fails ? 1 : 0);
