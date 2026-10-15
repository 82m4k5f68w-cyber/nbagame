// The cloth net must be SEEN to move and must feel right (the old net barely moved: ~1 px for 0.1 s, frozen in replays).
//  1. straight drops through the middle at three speeds: score, the net slows the ball (vs free fall) but never
//     holds it, the mesh moves
//  2. real perfect releases (launch, stepped like upd: bstep x2 + netSim): every one goes in, the mesh visibly whips
//     (max knot displacement, the hem kicked up), keeps ~2/3 of the ball's speed, then settles back to rest
//  3. a rim-out ripples the loops, a dunk bends the rim (the rim ring of knots rides it) and swings the net
//  4. the net keeps moving in a replay (netSim with rp) and sways slightly at rest; nothing goes NaN
import { rapInit } from "../src/core/physics";
import * as G from "../src/core/sim";
G.cfg.NP = 1; G.cfg.MYM = 0; G.cfg.JB = 0; // no opening tip: the test drops its own ball
G.cfg.input = () => ({ dx: 0, dy: 0 });
G.setCtrls([G.mkCtrl("p1", 0)]);
await rapInit();
const fails: string[] = [];
const ok = (c: boolean, m: string) => c || fails.push(m);
const N: any = G.NETS[1], hx = G.HXs[1];
let B: any = G.B; // (start() makes a new ball: re-read it after every start)
let rest: number[][] = [];
const snapRest = () => (rest = N.p.map((q: any) => [q.x, q.y, q.z]));
const disp = () => { let m = 0, up = 0; N.p.forEach((q: any, k: number) => { m = Math.max(m, Math.hypot(q.x - rest[k][0], q.y - rest[k][1], q.z - rest[k][2])); if (k >= N.p.length - 16) up = Math.max(up, q.z - rest[k][2]); }); return [m, up]; };
const settle = () => { const bx = B.x, by = B.y, bz = B.z; B.x = 300; B.y = 100; B.z = 50; for (let i = 0; i < 400; i++) G.netSim(1 / 60); B.x = bx; B.y = by; B.z = bz; snapRest(); };
const away = () => { B.owner = null; B.x = 300; B.y = 100; B.z = 50; B.vx = B.vy = B.vz = 0; };

// 1. straight drops
for (const v0 of [-150, -300, -450]) {
  G.start(1); G.setInb(0); B = G.B;
  for (const p of G.P) { p.x = 300; p.y = 100; }
  away(); settle();
  B.owner = null; B.mode = "air"; B.sh = 1; B.sc = 0; B.x = hx + 0.5; B.y = G.HY; B.z = 112; B.vx = 0; B.vy = 0; B.vz = v0; B.wv = [0, 0, 0];
  let tIn = 0, exitV = 0, sc = 0, md = 0;
  for (let i = 0; i < 90; i++) {
    G.upd(1 / 60);
    if (B.z < 99 && B.z > 82) tIn += 1 / 60;
    if (B.z < 82 && !exitV) exitV = B.vz;
    sc = sc || B.sc;
    md = Math.max(md, disp()[0]);
    if (exitV && B.z < 40) away();
  }
  const vff = Math.sqrt(v0 * v0 + 2 * G.g * 30); // free fall from 112 to 82
  ok(!!sc, `drop ${v0}: no score`);
  ok(Math.abs(exitV) < vff * 0.995 && Math.abs(exitV) > vff * 0.5, `drop ${v0}: exit ${exitV.toFixed(0)} vs free fall ${vff.toFixed(0)}`);
  ok(tIn < 0.3, `drop ${v0}: held in the net ${tIn.toFixed(2)} s`);
  ok(md > 0.4, `drop ${v0}: net hardly moved (${md.toFixed(2)} px)`);
  console.log(`drop v0 ${v0}: scored ${sc} timeInNet ${tIn.toFixed(2)}s exitVz ${exitV.toFixed(0)} (free fall ${vff.toFixed(0)}) maxDisp ${md.toFixed(2)}px`);
}

// 2. real perfect releases
{
  G.cfg.NP = 5; G.start(0); B = G.B;
  const P = G.P;
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let made = 0, n = 30, sumD = 0, sumUp = 0, sumKeep = 0, nk = 0, minD = 99, maxSettle = 0;
  for (let i = 0; i < n; i++) {
    G.setup(0);
    const p = P[0];
    P.forEach((q, k) => { if (k) (q.x = 60), (q.y = 20 + k * 8); });
    p.x = 480 + rnd() * 330; p.y = 60 + rnd() * 380; p.z = 20; p.vz = 0;
    p.mode = "s"; p.t = 0.4; p.sv = 0; p.rl = 0; p.mt = p.st === 1 ? 0.45 : 0.6;
    B.owner = p; B.mode = "held";
    settle();
    G.launch(p); B.sc = 0;
    let T = 0, md = 0, up = 0, vIn = 0, vOut = 0, last = 0, tIn = 0;
    let prev = N.p.map((q: any) => q.z);
    while (T < 4) {
      G.bstep(1 / 120); G.bstep(1 / 120); G.netSim(1 / 60); T += 1 / 60;
      if (B.owner) break;
      const [m, u] = disp();
      md = Math.max(md, m); up = Math.max(up, u);
      // still swinging: a knot moving faster than 3 px/s (the idle sway is ~0.1 px/s)
      if (N.p.some((q: any, k: number) => Math.abs(q.z - prev[k]) > 0.05)) last = T;
      prev = N.p.map((q: any) => q.z);
      if (!vIn && B.z < 100 && Math.hypot(B.x - hx, B.y - G.HY) < 12) (vIn = Math.hypot(B.vx, B.vy, B.vz)), (tIn = T);
      if (B.sc && !vOut && B.z < 82) vOut = Math.hypot(B.vx, B.vy, B.vz);
      if (B.z < 40 && vOut) { B.x = 300; B.z = 200; B.vx = B.vy = B.vz = 0; }
    }
    if (B.sc) made++;
    sumD += md; sumUp += up; minD = Math.min(minD, md);
    if (vIn && vOut) (sumKeep += vOut / vIn), nk++;
    maxSettle = Math.max(maxSettle, last - tIn);
  }
  const keep = sumKeep / Math.max(1, nk);
  console.log(`greens: made ${made}/${n} mean maxDisp ${(sumD / n).toFixed(2)}px (min ${minD.toFixed(2)}) hem up ${(sumUp / n).toFixed(2)}px speed kept ${(keep * 100).toFixed(0)}% settles (knots < 3 px/s) ${maxSettle.toFixed(2)}s after the ball drops in`);
  ok(made >= n - 1, `greens: only ${made}/${n} made`);
  ok(sumD / n > 4, `greens: net whip too small (${(sumD / n).toFixed(2)} px)`);
  ok(minD > 1.5, `greens: a swish barely moved the net (${minD.toFixed(2)} px)`);
  ok(sumUp / n > 2.5, `greens: hem not kicked up (${(sumUp / n).toFixed(2)} px)`);
  ok(keep > 0.5 && keep < 0.95, `greens: speed kept ${(keep * 100).toFixed(0)}%`);
  ok(maxSettle < 2, `greens: net still swinging after ${maxSettle.toFixed(2)} s`);
}

// 3. rim-out ripple + dunk
{
  G.cfg.NP = 1; G.start(1); G.setInb(0); B = G.B;
  for (const p of G.P) { p.x = 300; p.y = 100; }
  away(); settle();
  B.owner = null; B.mode = "air"; B.sh = 1; B.sc = 0; B.x = hx - 9.5; B.y = G.HY; B.z = 115; B.vx = 20; B.vy = 0; B.vz = -250; B.wv = [0, 0, 0];
  let md = 0;
  for (let i = 0; i < 40; i++) { G.upd(1 / 60); md = Math.max(md, disp()[0]); }
  console.log(`rim-out: scored ${B.sc} ripple ${md.toFixed(2)}px`);
  ok(!B.sc && md > 1.5, `rim-out: ripple ${md.toFixed(2)} px (sc ${B.sc})`);

  G.start(1); G.setInb(0); B = G.B;
  for (const p of G.P) { p.x = 300; p.y = 100; }
  away(); settle();
  B.owner = null; B.mode = "air"; B.sh = 1; B.sc = 0; B.dk = 1; B.x = hx; B.y = G.HY; B.z = 116; B.vx = 0; B.vy = 0; B.vz = -130; B.wv = [0, 0, 0];
  let fz = 0, ring = 0, dd = 0;
  for (let i = 0; i < 40; i++) {
    G.upd(1 / 60);
    fz = Math.max(fz, N.fz); dd = Math.max(dd, disp()[0]);
    ring = Math.max(ring, Math.abs(N.p[0].z - (100 - N.fz)));
    if (B.z < 40) away();
  }
  console.log(`dunk: scored ${B.sc} rim flex ${fz.toFixed(2)}px net swing ${dd.toFixed(2)}px rim ring off the iron ${ring.toFixed(4)}`);
  ok(fz > 1.5, `dunk: rim flex ${fz.toFixed(2)} px`);
  ok(dd > 3, `dunk: net swing ${dd.toFixed(2)} px`);
  ok(ring < 1e-9, `dunk: rim ring of knots left the iron (${ring})`);
}

// 4. replay + idle sway + NaN
{
  away(); settle();
  B.x = hx + 1; B.y = G.HY; B.z = 112;
  G.netSim(1 / 60, 1);
  let md = 0;
  for (let i = 0; i < 12; i++) { B.z -= 3; G.netSim((1 / 60) * 0.4, 1); md = Math.max(md, disp()[0]); }
  console.log(`replay: net moved ${md.toFixed(2)}px`);
  ok(md > 0.3, `replay: the net did not move (${md.toFixed(2)} px)`);
  away(); settle();
  let mn = 1e9, mx = -1e9;
  for (let i = 0; i < 1200; i++) { G.netSim(1 / 60); mn = Math.min(mn, N.p[90].x); mx = Math.max(mx, N.p[90].x); }
  console.log(`idle sway: hem ${(mx - mn).toFixed(2)}px`);
  ok(mx - mn > 0.1 && mx - mn < 1.5, `idle sway ${(mx - mn).toFixed(2)} px`);
  ok(G.NETS.every((n: any) => n.p.every((q: any) => Number.isFinite(q.x + q.y + q.z))), "NaN knot");
}
if (fails.length) {
  console.log("FAIL", fails);
  process.exit(1);
}
console.log("net ok");
