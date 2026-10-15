// Pro Play pack (cfg.PP, v5.3): the dribble moves the stick picks, the human move buffer + cancel window, sprint burst,
// on-ball stance (quicker slides, auto hand up), contest timing, drive gathers, deflections that never change
// possession, and the features showing up in real CPU games (PPC counters). Each check runs PP on vs off where it
// makes sense.   npx tsx tests/propl.ts
import * as G from "../src/core/sim";
import { rapInit } from "../src/core/physics";
(async () => {
  await rapInit();
  let fails = 0;
  const ok = (c: boolean, m: string) => (console.log((c ? "ok   " : "FAIL ") + m), c || fails++);
  let s = 7;
  Math.random = () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296;
  Object.assign(G.cfg, { NP: 5, physics: "rapier", hand: true, MYM: 0, JB: 0 });
  G.setQtrLen(120);
  let tk = 0,
    script: (t: number) => any = () => ({ dx: 0, dy: 0 });
  G.cfg.input = () => script(tk);
  const run = (n: number) => {
    for (let i = 0; i < n; i++, tk++) {
      G.upd(1 / 60);
      if (G.RPL) G.skipReplay();
      G.FX.length = 0;
    }
  };
  /** Human handler (P[0]) at (x, y) with the ball, everyone else parked far away. */
  const scene = (pp: number, x = 600, y = 250, ctrlTeam = 0) => {
    G.cfg.PP = pp;
    G.setCtrls([G.mkCtrl("p1", ctrlTeam, ctrlTeam === 0, 0)]);
    G.start(0, { j: 1 });
    G.setup(0);
    G.setInb(0);
    G.setClock(100);
    G.setShot(24);
    G.P.forEach((q: any, k: number) => {
      (q.x = 120 + k * 15), (q.y = k < 5 ? 40 : 460), (q.vx = q.vy = q.vz = q.z = 0), (q.mode = "i"), (q.cd = 0), (q.mvT = 0);
    });
    const me = G.P[0];
    (me.x = x), (me.y = y);
    G.B.owner = me;
    G.B.mode = "held";
    tk = 0;
    return me;
  };
  // ---- 1. the stick picks the move variant ----
  const variant = (pp: number, mv: number, dx: number, dy: number, vx = 0) => {
    const me = scene(pp);
    me.vx = vx;
    script = (t) => (t === 0 ? { dx, dy, mv } : { dx, dy });
    run(2);
    return me.mvk;
  };
  ok(variant(1, 1, 1, 0) === 1, "C toward the rim = hesitation");
  ok(variant(1, 1, 0, 1) === 5, "C + stick sideways = in-and-out");
  ok(variant(1, 1, -1, 0) === 7, "C + stick pulled back = snatch-back");
  ok(variant(1, 3, 0, -1) === 6, "V + stick sideways = crossover");
  ok(variant(0, 1, 0, 1) === 1, "(PP off: C + sideways is still a hesitation)");
  {
    // flick at speed = crossover
    const me = scene(1);
    (me.vx = 200), (me.li = [1, 0]);
    script = (t) => (t === 0 ? { dx: -1, dy: 0.2 } : { dx: 1, dy: 0 });
    run(2);
    ok(me.mvk === 6, "flick the stick back at speed = crossover (mvk " + me.mvk + ")");
  }
  {
    // bug: reversing the stick to back out (retreat dribble) fired a crossover that drove him back at the rim
    const me = scene(1, 800, 250);
    (me.vx = 200), (me.li = [1, 0]);
    script = () => ({ dx: -1, dy: 0 });
    run(12);
    ok(!(me.mvT > 0) && me.vx < 0, "a retreat dribble (stick straight back at speed) is not a crossover: vx " + me.vx.toFixed(0));
  }
  {
    // bug: the rebound assist steered a human who was running the other way (and jumped for him)
    const me = scene(1, 700, 250);
    G.B.owner = null;
    G.B.mode = "air";
    G.B.sh = 1;
    G.B.last = G.P[6];
    (G.B.x = 760), (G.B.y = 250), (G.B.z = 60), (G.B.vx = G.B.vy = 0), (G.B.vz = -50), (G.B.age = 1);
    script = () => ({ dx: -1, dy: 0 });
    run(10);
    ok(me.vx < -100 && me.z <= 0, "a human running away from a loose ball keeps his stick (vx " + me.vx.toFixed(0) + ", no auto-jump)");
  }
  // ---- 2. move buffer + cancel window: a spin pressed mid-hesitation starts as soon as the window opens ----
  const chain = (pp: number) => {
    const me = scene(pp);
    script = (t) => (t === 0 ? { dx: 1, dy: 0, mv: 1 } : t === 16 ? { dx: 1, dy: 0, mv: 2 } : { dx: 1, dy: 0 });
    let at = -1;
    for (let i = 0; i < 60 && at < 0; i++) {
      run(1);
      if (me.mvk === 2 && me.mvT > 0) at = tk;
    }
    return { at, combo: me.combo };
  };
  const c1 = chain(1),
    c0 = chain(0);
  ok(c1.at > 0 && c1.at - 16 <= 16 && c1.combo >= 2, "PP: spin pressed mid-move starts " + (c1.at - 16) + " ticks later as a combo x" + c1.combo);
  ok(c0.at < 0, "(PP off: the same press is lost)");
  // ---- 3. sprint burst: the first steps of a sprint get up to speed quicker ----
  const burst = (pp: number) => {
    const me = scene(pp, 300, 250);
    G.B.owner = null;
    G.B.mode = "air";
    (G.B.x = 900), (G.B.y = 40), (G.B.z = 0);
    script = () => ({ dx: 1, dy: 0, sp: 1 });
    run(9);
    return Math.hypot(me.vx, me.vy);
  };
  const b1 = burst(1),
    b0 = burst(0);
  ok(b1 > b0 * 1.05, "sprint burst: speed after 0.15 s " + b0.toFixed(0) + " -> " + b1.toFixed(0) + " px/s");
  // ---- 4. on-ball stance: a human guarding the handler slides quicker and gets a hand up on his shot ----
  const stance = (pp: number) => {
    scene(pp, 600, 250, 1);
    const h = G.P[0],
      d = G.P[5];
    (d.x = 640), (d.y = 250);
    G.CT[0].idx = 5;
    h.in = { dx: 0, dy: 0 };
    script = () => ({ dx: 0, dy: 1 });
    // hold the CPU handler still: he is the one being guarded
    const keep = () => ((h.x = 600), (h.y = 250), (h.vx = h.vy = 0), (h.mode = "i"), (G.B.owner = h));
    let v = 0;
    for (let i = 0; i < 8; i++) keep(), run(1), (v = Math.abs(d.vy));
    const stc = d.stc;
    // he rises to shoot right in front of the defender
    script = () => ({ dx: 0, dy: 0 });
    (d.x = 630), (d.y = 250), (d.vx = d.vy = 0);
    keep();
    h.mode = "c";
    h.t = 0;
    run(1);
    return { v, stc, hup: d.hupT > 0, ct: G.contestOf(h)[0] };
  };
  const s1 = stance(1),
    s0 = stance(0);
  ok(s1.stc === 1 && !s0.stc, "a human guarding the handler is in his stance (stc)");
  ok(s1.v > s0.v * 1.1, "stance slides: lateral speed after 8 ticks " + s0.v.toFixed(0) + " -> " + s1.v.toFixed(0) + " px/s");
  ok(s1.hup && s1.ct > s0.ct, "the hand goes up on a shot in his face: contest " + s0.ct.toFixed(2) + " -> " + s1.ct.toFixed(2));
  // ---- 5. contest timing: a defender already coming down contests less than one on the way up ----
  {
    scene(1);
    const sh = G.P[0],
      d = G.P[5];
    (d.x = sh.x + 20), (d.y = sh.y), (d.z = 30);
    d.vz = 120;
    const up = G.contestOf(sh)[0];
    d.vz = -150;
    const down = G.contestOf(sh)[0];
    ok(down < up * 0.85, "contest rising " + up.toFixed(2) + " vs coming down " + down.toFixed(2));
  }
  // ---- 6. drive gather: shooting while attacking the rim at speed from ~13 ft gathers first, then releases ----
  {
    const me = scene(1, 887.5 - 130, 250);
    me.vx = 240;
    script = (t) => (t === 0 ? { dx: 1, dy: 0, sd: 1, su: 1 } : { dx: 1, dy: 0 });
    run(1);
    const g0 = me.gath;
    let launched = -1;
    for (let i = 0; i < 40 && launched < 0; i++) run(1), G.B.owner !== me && launched < 0 && (launched = tk);
    ok(g0 > 0, "drive gather started (kind " + g0 + ")");
    ok(launched > 15, "...and the release waits for the takeoff (ball out at tick " + launched + ")");
  }
  // ---- 7. full CPU games: the new moves / finishes / reads happen; deflections never change possession ----
  G.setCtrls([]);
  G.cfg.PP = 1;
  G.cfg.JB = 1;
  for (const k of Object.keys(G.PPC)) delete G.PPC[k];
  let defl = 0,
    kept = 0,
    lost = 0,
    pend = -1,
    inst = 0;
  for (let g = 0; g < 2; g++) {
    G.setQtrLen(90);
    G.start(g * 3, { j: 4 + g });
    for (let n = 0; n < 60 * 60 * 8 && G.S !== "over"; n++) {
      const d0 = G.PPC.deflect || 0,
        last = G.B.last;
      G.upd(1 / 60);
      if (G.RPL) G.skipReplay();
      if (G.S === "half") G.setS("play");
      G.FX.length = 0;
      if ((G.PPC.deflect || 0) > d0 && last) {
        defl++;
        if (G.B.owner && G.B.owner.tm !== last.tm) inst++;
        pend = last.tm;
      }
      if (pend >= 0 && G.B.owner) {
        if (G.B.owner.tm === pend) kept++;
        else lost++;
        pend = -1;
      }
    }
  }
  const C = G.PPC;
  console.log("PPC", JSON.stringify(C));
  ok((C.mv5 || 0) + (C.mv6 || 0) + (C.mv7 || 0) > 10, "CPU uses in-and-outs / crossovers / snatch-backs");
  ok((C.gather || 0) + (C.hopStep || 0) + (C.spinGather || 0) > 3, "CPU drive gathers");
  ok((C.floater || 0) > 0, "floaters");
  ok((C.sizeUp || 0) > 10, "signature size-ups");
  ok((C.vcut || 0) > 3, "V-cuts off the ball");
  ok(inst === 0, "a deflection never hands the ball to the defender (steals stay off)");
  ok(defl >= 3 && kept / Math.max(1, kept + lost) >= 0.85, "deflections " + defl + ": the passing team kept it " + kept + "/" + (kept + lost));
  console.log(fails ? "PRO PLAY FAIL " + fails : "PRO PLAY OK");
  process.exit(fails ? 1 : 0);
})();
