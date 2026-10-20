// Pro Play v2 (cfg.PP = 2, v5.4): defender reads on dribble moves, pull-ups out of a move, jumper balance in the green
// window, side-steps, post back-down battles by strength (+ a human body-up), body-ups / cut-offs on drives, block
// timing, charges read from position, off-ball humans (call for the ball, call for a screen, flick cuts), and CPU games
// where it all happens without steals, NaN or ankle breakers on every move.   npx tsx tests/propl2.ts
import * as G from "../src/core/sim";
import { rapInit } from "../src/core/physics";
(async () => {
  await rapInit();
  let fails = 0;
  const ok = (c: boolean, m: string) => (console.log((c ? "ok   " : "FAIL ") + m), c || fails++);
  let s = 11;
  Math.random = () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296;
  Object.assign(G.cfg, { NP: 5, physics: "rapier", hand: true, MYM: 0, JB: 0, PP: 2, FOULS: 1, BADGES: 1 });
  G.setQtrLen(120);
  let tk = 0,
    script: (id: string, t: number) => any = () => ({ dx: 0, dy: 0 });
  G.cfg.input = (c: any) => script(c.id, tk);
  const run = (n: number, each?: () => void) => {
    for (let i = 0; i < n; i++, tk++) {
      if (each) each();
      G.upd(1 / 60);
      if (G.RPL) G.skipReplay();
      G.FX.length = 0;
    }
  };
  const C = (k: string) => G.PPC[k] || 0;
  const HX = 887.5;
  /** P[0] at (x, y) with the ball (or P[1] has it: offBall), everyone else parked; humans: p1 (team 0) [+ p2 (team 1)]. */
  const scene = (x = 600, y = 250, o: { two?: boolean; my?: boolean; offBall?: boolean; pp?: number } = {}) => {
    G.cfg.PP = o.pp ?? 2;
    G.cfg.MYM = o.my ? 1 : 0;
    const cs = [G.mkCtrl("p1", 0, !!o.my, 0)];
    if (o.two) cs.push(G.mkCtrl("p2", 1, false, 0));
    G.setCtrls(cs);
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
    G.B.owner = o.offBall ? G.P[1] : me;
    G.B.mode = "held";
    tk = 0;
    return me;
  };
  const Dof = (p: any) => Math.hypot(HX - p.x, 250 - p.y);

  // ---- 1. defender reads: the same crossover vs a wrong-footed defender and vs one already sliding that way ----
  const beats = () => C("beat") + C("stumble") + C("ankle");
  const readRate = (dvy: number, n = 70) => {
    let w = 0,
      l = 0;
    for (let k = 0; k < n; k++) {
      scene(600, 250);
      const d = G.P[5];
      (d.x = 624), (d.y = 250), (d.vx = 0), (d.vy = dvy);
      const b0 = beats(),
        s0 = C("stayed");
      script = (_id, t) => (t === 0 ? { dx: 0, dy: 1, mv: 3 } : { dx: 0, dy: 1 }); // V + stick sideways = crossover to +y
      run(1);
      (w += beats() - b0), (l += C("stayed") - s0);
    }
    return w / Math.max(1, w + l);
  };
  const rWrong = readRate(-130),
    rThere = readRate(130),
    rStill = readRate(0);
  ok(rWrong > rThere + 0.25, "a crossover beats a wrong-footed defender far more often (" + (rWrong * 100).toFixed(0) + "%) than one already sliding that way (" + (rThere * 100).toFixed(0) + "%)");
  ok(rStill > rThere && rStill < rWrong, "a set defender is in between (" + (rStill * 100).toFixed(0) + "%)");
  {
    // spin: off contact, not from range
    const spin = (dx: number, n = 60) => {
      let w = 0,
        l = 0;
      for (let k = 0; k < n; k++) {
        scene(600, 250);
        const d = G.P[5];
        (d.x = 600 + dx), (d.y = 250);
        const b0 = beats(),
          s0 = C("stayed");
        script = (_id, t) => (t === 0 ? { dx: 1, dy: 0, mv: 2 } : { dx: 1, dy: 0 });
        run(1);
        (w += beats() - b0), (l += C("stayed") - s0);
      }
      return w / Math.max(1, w + l);
    };
    const sTight = spin(22),
      sFar = spin(52);
    ok(sTight > sFar + 0.15, "a spin works off contact (" + (sTight * 100).toFixed(0) + "%) not from range (" + (sFar * 100).toFixed(0) + "%)");
  }
  {
    // a read costs the handler: he has to reset before the next move
    let cd = 0;
    for (let k = 0; k < 40 && !cd; k++) {
      const me = scene(600, 250);
      const d = G.P[5];
      (d.x = 624), (d.y = 250), (d.vy = 130);
      const s0 = C("stayed");
      script = (_id, t) => (t === 0 ? { dx: 0, dy: 1, mv: 3 } : { dx: 0, dy: 1 });
      run(1);
      if (C("stayed") > s0) cd = me.cd;
    }
    ok(cd > 0.65, "STAYED IN FRONT: the handler's next move waits (cd " + cd.toFixed(2) + " s)");
  }
  // ---- 2. pull-up out of a move: the move ends into the shot (rhythm in the green window) ----
  {
    const me = scene(600, 250);
    const p0 = C("pullUp");
    script = (_id, t) => (t === 0 ? { dx: 1, dy: 0, mv: 1 } : t === 6 ? { dx: 1, dy: 0, sd: 1 } : { dx: 1, dy: 0 });
    run(7);
    const n: string[] = [];
    G.winMul(me, Dof(me), n);
    ok(me.mode === "c" && C("pullUp") > p0 && !(me.mvT > 0) && n.includes("RHYTHM"), "hesitation pull-up: the move ends into the jumper, in rhythm (" + n.join(",") + ")");
  }
  // ---- 3. balance at the gather sets the green window ----
  {
    const bal = (vx: number, vy: number, beat = false) => {
      const me = scene(600, 250);
      (me.vx = vx), (me.vy = vy);
      if (beat) me.beatT = G.T;
      script = (_id, t) => (t === 0 ? { dx: 0, dy: 0, sd: 1 } : { dx: 0, dy: 0 });
      run(1);
      const n: string[] = [];
      return { sqn: me.sqn, w: G.winMul(me, Dof(me), n), n: n.join(",") };
    };
    const st = bal(0, 0),
      ob = bal(0, 260),
      fd = bal(-200, 0),
      om = bal(235, 0),
      cs = bal(0, 0, true);
    ok(st.sqn === 0, "a set-feet jumper has no balance note (" + st.n + ")");
    ok(ob.sqn === 1 && Math.abs(ob.w / st.w - 0.84) < 0.01, "OFF BALANCE (fading sideways at speed): window x" + (ob.w / st.w).toFixed(2));
    ok(fd.sqn === 2 && fd.w < st.w, "FADING (drifting back): window x" + (fd.w / st.w).toFixed(2));
    ok(om.sqn === 3 && om.w < st.w && om.w > ob.w, "ON THE MOVE (full-speed pull-up): window x" + (om.w / st.w).toFixed(2));
    ok(cs.sqn === 4 && cs.w > st.w, "CREATED SPACE (just beat his man): window x" + (cs.w / st.w).toFixed(2));
  }
  // ---- 3b. the stick picks the jumper: away from the rim = fadeaway, sideways inside the arc = leaner ----
  {
    const shot = (x: number, dx: number, dy: number) => {
      const me = scene(x, 250),
        d = G.P.find((q: any) => q.tm === 1 && G.guardOf(q) === me);
      (d.x = x + 30), (d.y = 250);
      script = (_id, t) => (t === 0 ? { dx, dy, sd: 1 } : t === 20 ? { dx, dy, su: 1 } : { dx, dy });
      run(1);
      const g = { fade: me.fade, fsv: me.fsv, sqn: me.sqn };
      run(20, () => ((d.x = x + 30), (d.y = 250), (d.vx = d.vy = 0)));
      return { ...g, sv: me.sv, cw: me.cw, vx: me.vx };
    };
    const plain = shot(600, 0, 0),
      fade = shot(600, -1, 0),
      lean = shot(720, 0, 1);
    ok(fade.fade === 1 && fade.fsv === 2 && fade.sqn === 5 && fade.sv === 2, "stick away + shoot = FADEAWAY (fade clip, window note " + fade.sqn + ")");
    ok(fade.vx < -50 && fade.cw < plain.cw * 0.85, "the fadeaway drifts back (vx " + fade.vx.toFixed(0) + ") and creates separation: contest " + plain.cw.toFixed(2) + " -> " + fade.cw.toFixed(2));
    ok(lean.fade === 2 && lean.sv === 20 && lean.sqn === 6, "stick sideways inside the arc = LEANER (sv " + lean.sv + ")");
    ok(!plain.fade, "no stick: no stick-picked jumper (sv " + plain.sv + " from pickClip)");
  }
  // ---- 3c. catch-and-shoot buffer: shoot pressed as a pass arrives doesn't jump; the jumper starts on the catch ----
  {
    const cs = (pp: number) => {
      const me = scene(640, 120, { my: true, offBall: true, pp }),
        h = G.P[1];
      (h.x = 560), (h.y = 250);
      script = () => ({ dx: 0, dy: 0 });
      run(2); // (the ball into his hands first)
      G.pass(h, me, 0);
      let pressed = -1,
        jumped = false,
        shotUp = false;
      script = (_id, t) => (t === pressed ? { dx: 0, dy: 0, sd: 1 } : { dx: 0, dy: 0 });
      for (let n = 0; n < 40; n++) {
        if (pressed < 0 && G.B.mode === "pass" && Math.hypot(G.B.x - me.x, G.B.y - me.y) / Math.hypot(G.B.vx, G.B.vy) < 0.3) pressed = tk;
        run(1);
        if (me.z > 2 && G.B.owner !== me) jumped = true;
        if (me.mode === "c" || me.mode === "s") shotUp = true;
      }
      return { jumped, shotUp };
    };
    const b2 = cs(2),
      b1 = cs(1);
    ok(!b2.jumped && b2.shotUp && C("csBuf") > 0, "shoot pressed as the pass arrives: no jump, CATCH & SHOOT on the catch");
    ok(b1.jumped && !b1.shotUp, "(v5.3: the same press jumped and caught it in the air)");
  }
  // ---- 4. side-step: step-back key + stick sideways hops across, not back ----
  {
    const me = scene(600, 250);
    script = (_id, t) => (t === 0 ? { dx: 0, dy: 1, sb: 1 } : { dx: 0, dy: 1 });
    run(1);
    ok(me.mode === "b" && me.bsd === 1 && Math.abs(me.by) > 0.95 && Math.abs(me.bx) < 0.1, "side-step: hops across (bx " + me.bx.toFixed(2) + ", by " + me.by.toFixed(2) + ")");
    const m2 = scene(600, 250);
    script = (_id, t) => (t === 0 ? { dx: 1, dy: 0, sb: 1 } : { dx: 1, dy: 0 });
    run(1);
    ok(m2.mode === "b" && !m2.bsd && m2.bx < -0.95, "stick at the rim: still a step-back (bx " + m2.bx.toFixed(2) + ")");
  }
  // ---- 5. post battles: strength vs strength; a human defender bodies up with the stick ----
  {
    const post = (o: { pb: number; ph: number; pi: number; db: number; dh: number; dd: number }, human: boolean) => {
      const me = scene(HX - 150, 250, { two: human });
      const d = G.P[5];
      (me.bk = o.pb), (me.ht = o.ph), (me.i = o.pi), (d.bk = o.db), (d.ht = o.dh), (d.d = o.dd);
      script = (id) => (id === "p1" ? { dx: 0, dy: 0, post: 1 } : { dx: -1, dy: 0 }); // (p2: stick into the post man)
      const w0 = C("postWin"),
        h0 = C("postHold");
      run(150, () => {
        (me.x = HX - 150), (me.y = 250), (me.vx = me.vy = 0), (me.mode = "i"), (G.B.owner = me), (G.B.mode = "held");
        (d.x = HX - 133), (d.y = 250), (d.vx = d.vy = 0), (d.mode = "i");
        if (human) G.CT[1].idx = 5;
      });
      return { w: C("postWin") - w0, h: C("postHold") - h0 };
    };
    const strong = post({ pb: 1.3, ph: 7.0, pi: 90, db: 0.9, dh: 6.2, dd: 60 }, false),
      weak = post({ pb: 0.9, ph: 6.2, pi: 60, db: 1.3, dh: 7.0, dd: 90 }, false),
      evenCpu = post({ pb: 1, ph: 6.6, pi: 80, db: 1, dh: 6.6, dd: 80 }, false),
      evenHum = post({ pb: 1, ph: 6.6, pi: 80, db: 1, dh: 6.6, dd: 80 }, true);
    ok(strong.w > 2 && strong.h === 0, "a strong post man backs a small defender down (" + strong.w + " wins)");
    ok(weak.h > 2 && weak.w === 0, "a weak post man gets stood up (" + weak.h + " holds)");
    ok(evenCpu.w > 2 && evenHum.h > 2 && evenHum.w === 0, "even matchup: moves a CPU defender (" + evenCpu.w + "), a human defender bodying up holds (" + evenHum.h + ")");
  }
  // ---- 6. drive body-ups: a set defender cuts the driver off; a moving one gets bumped off ----
  {
    G.cfg.FOULS = 0; // (no charge calls here: just the contact)
    const bump = (dvy: number) => {
      const me = scene(600, 250),
        d = G.P[5];
      (d.x = 619), (d.y = 250), (d.vy = dvy);
      me.vx = 230;
      const c0 = C("cutOff"),
        b0 = C("bumpOff");
      script = () => ({ dx: 1, dy: 0 });
      run(1);
      return { v: me.vx, cut: C("cutOff") - c0, off: C("bumpOff") - b0 };
    };
    const set = bump(0),
      mov = bump(150);
    ok(set.cut === 1 && mov.off === 1, "set defender = CUT OFF, sliding defender = BUMPED OFF");
    ok(set.v < mov.v * 0.8, "cut off: the drive loses its speed into him (" + mov.v.toFixed(0) + " -> " + set.v.toFixed(0) + " px/s)");
    G.cfg.FOULS = 1;
  }
  // ---- 7. block timing ----
  ok(G.pp2BlkT({ vz: 0 }) === 1.3 && G.pp2BlkT({ vz: -200 }) === 0.55 && G.pp2BlkT({ vz: 160 }) < 0.6, "block timing: at the top of the jump x1.3, rising early / coming down x0.55");
  // ---- 8. charges read from position: set feet square in the chest vs stepping into the driver ----
  {
    const chg = (dvx: number, n = 30) => {
      let c = 0,
        f = 0;
      for (let k = 0; k < n; k++) {
        const me = scene(560, 250 + (k % 3) * 2, { two: true }),
          d = G.P[5];
        (d.x = 640), (d.y = 250);
        const c0 = d.stt.chg,
          f0 = G.STAT.fouls || 0;
        script = (id, t) => (id === "p1" ? (t < 30 ? { dx: 0, dy: 0 } : { dx: 1, dy: 0, sp: 1 }) : t < 30 ? { dx: 0, dy: 0 } : { dx: dvx, dy: 0 });
        // (130 ticks: the 2 s contact-foul cooldown of one trial must not leak into the next)
        run(130, () => {
          G.CT[1].idx = 5;
          if (tk < 30) (me.x = 560), (me.vx = me.vy = 0);
        });
        (c += d.stt.chg - c0), (f += (G.STAT.fouls || 0) - f0);
      }
      return { c: c / n, f: f / n };
    };
    const setD = chg(0),
      into = chg(-1);
    ok(setD.c > 0.4, "a set defender square in the driver's path takes the charge (" + (setD.c * 100).toFixed(0) + "% of drives)");
    ok(into.c < 0.1, "a defender stepping into the driver never draws one (" + (into.c * 100).toFixed(0) + "%; fouls " + (into.f * 100).toFixed(0) + "%)");
  }
  // ---- 9. off the ball (My Player): call for the ball, call for a screen, flick cut ----
  {
    const me = scene(700, 130, { my: true, offBall: true }),
      h = G.P[1];
    (h.x = 600), (h.y = 250);
    script = (_id, t) => (t === 0 ? { dx: 0, dy: 0, e: 1 } : { dx: 0, dy: 0 });
    let got = false;
    run(40, () => (got = got || (G.B.mode === "pass" && G.B.to === me) || G.B.owner === me));
    ok(got && C("callBall") > 0 && C("feed") > 0, "pass key off the ball: BALL! - the CPU handler feeds him");
    const m2 = scene(700, 130, { my: true, offBall: true }),
      h2 = G.P[1],
      e = G.P[6];
    (h2.x = 600), (h2.y = 250), (e.x = 650), (e.y = 190);
    const d0 = C("feedDenied");
    script = (_id, t) => (t === 0 ? { dx: 0, dy: 0, e: 1 } : { dx: 0, dy: 0 });
    let got2 = false;
    run(10, () => ((e.x = 650), (e.y = 190), (got2 = got2 || (G.B.mode === "pass" && G.B.to === m2))));
    ok(!got2 && C("feedDenied") > d0, "a defender in the lane: DENIED, no pass");
  }
  {
    const me = scene(600, 250),
      d = G.P.find((q: any) => q.tm === 1 && G.guardOf(q) === me),
      big = G.P[4];
    (d.x = 625), (d.y = 250), (big.x = 540), (big.y = 330); // (his man on him, a big a few steps away)
    G.TS.pc[0] = 2; // (the play call is a pin-down for a shooter: no ball screen is coming unless he calls one)
    script = (_id, t) => (t < 10 ? { dx: 0, dy: 0, post: 1 } : { dx: 0, dy: 0 });
    let set = false,
      dmin = 1e9;
    const c0 = C("callScreen");
    run(240, () => {
      (me.x = 600), (me.y = 250), (me.vx = me.vy = 0);
      const pl = G.PLAY[0];
      if (pl && pl.use === me && pl.kind === "pnr" && pl.ph === "set" && C("callScreen") > c0) (set = true), (dmin = Math.min(dmin, Math.hypot(pl.scr.x - me.x, pl.scr.y - me.y)));
    });
    ok(set && dmin < 40, "post key out top with the ball: SCREEN! - a big comes and sets it (" + dmin.toFixed(0) + " px from him)");
  }
  {
    const cut = (pp: number) => {
      const me = scene(600, 130, { my: true, offBall: true, pp }),
        h = G.P[1];
      (h.x = 500), (h.y = 250);
      script = (_id, t) => (t < 5 ? { dx: 0, dy: 0 } : { dx: 1, dy: 0 });
      run(14);
      return { v: Math.hypot(me.vx, me.vy), c: me.cutT };
    };
    const c2 = cut(2),
      c1 = cut(1);
    ok(c2.v > c1.v * 1.08, "flick cut off the ball: burst " + c1.v.toFixed(0) + " -> " + c2.v.toFixed(0) + " px/s");
    // backdoor: his defender is up the line, denying the pass -> a flick at the rim leaves him a step behind
    let bd = 0;
    for (let k = 0; k < 12; k++) {
      const me = scene(640, 120, { my: true, offBall: true }),
        h = G.P[1],
        md = G.P.find((q: any) => q.tm === 1 && G.guardOf(q) === me);
      (h.x = 560), (h.y = 250), (md.x = 630), (md.y = 140);
      const b0 = C("backdoor");
      script = (_id, t) => (t < 3 ? { dx: 0, dy: 0 } : { dx: 0.8, dy: 0.6 });
      run(5, () => {
        if (tk < 3) (md.x = 630), (md.y = 140);
      });
      bd += C("backdoor") - b0;
    }
    ok(bd >= 4, "BACKDOOR! vs a denying defender: " + bd + "/12");
  }
  // ---- 10. CPU games: the reads, pull-ups, side-steps, post battles, cut-offs and charges happen; steals stay off ----
  G.setCtrls([]);
  G.cfg.PP = 2;
  G.cfg.MYM = 0;
  G.cfg.JB = 1;
  for (const k of Object.keys(G.PPC)) delete G.PPC[k];
  let nan = 0,
    stole = 0;
  for (let g = 0; g < 2; g++) {
    G.setQtrLen(90);
    G.start(g * 3 + 1, { j: 5 + g });
    for (let n = 0; n < 60 * 60 * 8 && G.S !== "over"; n++) {
      const o0 = G.B.owner,
        mv0 = o0 ? o0.mvT : 0;
      G.upd(1 / 60);
      if (G.RPL) G.skipReplay();
      if (G.S === "half") G.setS("play");
      G.FX.length = 0;
      for (const p of G.P) if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.vx)) nan++;
      // a dribble move never hands the ball to the defense (a whistle - charge, violation - gives it to an inbounder)
      if (o0 && mv0 > 0 && G.B.owner && G.B.owner.tm !== o0.tm && G.inb <= 0 && Math.hypot(G.B.owner.x - o0.x, G.B.owner.y - o0.y) < 45) stole++;
    }
  }
  const P2 = G.PPC;
  console.log("PPC", JSON.stringify(P2));
  const moves = (P2.beat || 0) + (P2.stumble || 0) + (P2.ankle || 0) + (P2.stayed || 0);
  ok(nan === 0, "no NaN in two CPU games");
  ok(stole === 0, "steals stay off: no move ever turned the ball over");
  ok(moves > 20 && (P2.stayed || 0) > 3 && (P2.beat || 0) + (P2.stumble || 0) > 5, "CPU moves are read: " + moves + " (stayed " + (P2.stayed || 0) + ")");
  ok((P2.ankle || 0) / Math.max(1, moves) < 0.12, "ankle breakers stay rare: " + (P2.ankle || 0) + "/" + moves);
  ok((P2.pullUp || 0) > 0, "CPU pull-ups out of moves (" + (P2.pullUp || 0) + "; side-steps " + (P2.sideStep || 0) + ")");
  ok((P2.cutOff || 0) + (P2.bumpOff || 0) > 5, "drive contact: cut off " + (P2.cutOff || 0) + ", bumped off " + (P2.bumpOff || 0));
  ok((P2.postWin || 0) + (P2.postHold || 0) > 0, "post battles: " + (P2.postWin || 0) + " won, " + (P2.postHold || 0) + " held");
  console.log(fails ? "PRO PLAY 2 FAIL " + fails : "PRO PLAY 2 OK");
  process.exit(fails ? 1 : 0);
})();
