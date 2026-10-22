// Team play pack (v5.4): named sets (horns, Spain pick-and-roll, stagger, zipper, post entry) run in CPU games and
// do their thing (back screens planted, staggers run through, post entries delivered); a Rookie coach knows none of
// them; human play calls 5-7 run horns / Spain / post-up; a CPU timeout draws up an ATO play for the star; coverages
// (hedge / ICE / blitz / drop by IQ); box-and-one on a lone hot shooter (the chaser stays on him); rotations (foul
// trouble sits a starter until the next quarter, the starters close, garbage time empties the bench); the bonus (5th
// team foul, 2nd in the last two minutes, 4th in overtime) and two timeouts per overtime.
import * as G from "../src/core/sim";
import { gameXP, awardXP, capOf } from "../src/client/career";
let fails = 0;
const ok = (c: boolean, m: string) => {
  console.log((c ? "ok   " : "FAIL ") + m);
  if (!c) fails++;
};
let seed = 7;
Math.random = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
Object.assign(G.cfg, { NP: 5, physics: "legacy", MYM: 0, JB: 1 });
G.cfg.input = () => ({ dx: 0, dy: 0 });
const clearStat = () => {
  for (const k in G.STAT) delete G.STAT[k];
  Object.assign(G.STAT, { screens: 0, shootFouls: 0, andOnes: 0, fouls: 0, fts: 0 });
};
const play = (ticks: number) => {
  let cms: Record<string, number> = {};
  for (let n = 0; n < ticks && G.S !== "over"; n++) {
    G.upd(1 / 60);
    if (G.RPL) G.skipReplay();
    if (G.S === "half") G.setS("play");
    for (const f of G.FX) if (f.k === "cm") cms[f.e] = (cms[f.e] || 0) + 1;
    G.FX.length = 0;
    for (const p of G.P) if (!isFinite(p.x) || !isFinite(p.y)) throw new Error("NaN player " + p.n);
  }
  return cms;
};
// ---- 1. sets in CPU games (All-Star coaches)
{
  G.cfg.DIFF = 2;
  G.setCtrls([]);
  G.setQtrLen(180);
  clearStat();
  const tot: Record<string, number> = {};
  for (let g = 0; g < 3; g++) {
    G.start(g * 3, { j: g * 3 + 4 });
    play(60 * 60 * 15);
    for (const k in G.STAT) tot[k] = (tot[k] || 0) + G.STAT[k];
    clearStat();
  }
  const sets = ["horns", "spain", "stagger", "zip", "post"].map((v) => [v, tot["set_" + v] || 0]);
  console.log("sets", JSON.stringify(sets), "spain back screens", tot.spain || 0, "staggers run", tot.stagger || 0, "post entries", tot.postFed || 0, "screens", tot.screens);
  ok(sets.filter(([, n]) => +n > 0).length >= 4, "CPU teams run at least four kinds of named sets");
  // the stagger itself (rarer in games: a shooter off the ball plus two bigs): a human holds the ball up top while the
  // AI teammates run a floppy for Curry - he must come off both screens to the wing
  let stg = 0;
  G.setCtrls([G.mkCtrl("p1", 0)]);
  for (let k = 0; k < 3; k++) {
    G.start(1, { j: 6 });
    G.setJB(null);
    G.setup(0);
    G.setInb(0);
    const gr = G.P.find((p) => p.n === "Green"),
      cu = G.P.find((p) => p.n === "Curry"),
      hx = G.hoop(0),
      sp = [[-30, 85], [-270, 0], [-200, -170], [-200, 170], [-20, -230]];
    G.B.owner = gr;
    G.P.filter((p) => p.tm === 0).forEach((p, j) => {
      const s2 = p === gr ? sp[1] : p === cu ? sp[0] : sp[[2, 3, 4][j % 3]];
      (p.x = hx + s2[0]), (p.y = 250 + s2[1] + k * 6);
    });
    for (const d of G.P) if (d.tm === 1) { const m = G.guardOf(d); (d.x = m.x + 20), (d.y = m.y); }
    const bigs = G.P.filter((p) => p.tm === 0 && p !== gr && p !== cu).sort((a, b) => b.ht - a.ht);
    G.PLAY[0] = { kind: "pin", v: "stagger", t0: G.T, scr: bigs[0], use: cu, def: G.guardOf(cu), ph: "go", sx: 0, sy: 0, setAt: 0, s2: bigs[1], sd: 1, st: 0, stT: G.T, nm: "FLOPPY" } as any;
    clearStat();
    for (let n = 0; n < 60 * 6 && G.B.owner === gr; n++) {
      G.upd(1 / 60);
      if (G.RPL) G.skipReplay();
      G.FX.length = 0;
    }
    if (G.STAT.stagger) stg++;
  }
  ok(stg >= 2, "a shooter runs all the way through the stagger screens (" + stg + "/3)");
  // Spain: the human handler waits up top, the big sets the ball screen and rolls, the shooter back-screens his man
  let spn = 0;
  for (let k = 0; k < 3; k++) {
    G.start(0, { j: 6 });
    G.setJB(null);
    G.setup(0);
    G.setInb(0);
    const dn = G.P.find((p) => p.n === "Doncic"),
      hx = G.hoop(0),
      big = G.P.find((p) => p.n === "Kessler"),
      sh = G.P.find((p) => p.n === "Reaves");
    G.B.owner = dn;
    const sp: Record<string, number[]> = { Doncic: [-260, 30], Kessler: [-120, -60], Reaves: [-250, -160], LaRavia: [-20, 230], Mamukelashvili: [-20, -230] };
    for (const p of G.P) if (p.tm === 0) (p.x = hx + sp[p.n][0]), (p.y = 250 + sp[p.n][1] + k * 6);
    for (const d of G.P) if (d.tm === 1) { const m = G.guardOf(d); (d.x = m.x + 20), (d.y = m.y); }
    G.PLAY[0] = { kind: "pnr", v: "spain", t0: G.T, scr: big, use: dn, def: G.guardOf(dn), ph: "go", sx: 0, sy: 0, setAt: 0, s2: sh, sd: 1, st: 0, stT: G.T, nm: "SPAIN" } as any;
    clearStat();
    for (let n = 0; n < 60 * 5 && G.B.owner === dn; n++) {
      G.upd(1 / 60);
      if (G.RPL) G.skipReplay();
      G.FX.length = 0;
    }
    if (G.STAT.spain) spn++;
  }
  G.setCtrls([]);
  ok(spn >= 2, "Spain: the shooter plants a back screen on the roller's man (" + spn + "/3; in games " + (tot.spain || 0) + ")");
  ok((tot.postFed || 0) > 0, "post entries get delivered to the block");
  ok(tot.screens >= 20, "screens still connect (" + tot.screens + ")");
}
// ---- 2. a Rookie coach knows none of it
{
  G.cfg.DIFF = 0;
  G.setQtrLen(60);
  clearStat();
  G.start(1, { j: 5 });
  play(60 * 60 * 3);
  const named = Object.keys(G.STAT).filter((k) => k.startsWith("set_")).reduce((a, k) => a + G.STAT[k], 0);
  ok(named === 0 && G.TS.cov[0] === 0 && G.TS.cov[1] === 0 && G.TS.dbl[0] < 0 && G.TS.dbl[1] < 0, "Rookie: no named sets, always drop, no doubles (" + named + ")");
  ok(G.cpuIQ(0) === 0, "cpuIQ follows the difficulty for CPU teams");
  G.setCtrls([G.mkCtrl("p1", 0)]);
  ok(G.cpuIQ(0) === 2 && G.cpuIQ(1) === 0, "a human's AI teammates play at All-Star IQ");
  G.setCtrls([]);
  G.cfg.DIFF = 2;
}
// ---- 3. the human's play calls 5-7
{
  G.setCtrls([G.mkCtrl("p1", 0)]);
  const got: string[] = [];
  for (const pc of [5, 6, 7]) for (let tries = 0; tries < 3 && got.length < [5, 6, 7].indexOf(pc) + 1; tries++) {
    G.start(0, { j: 3 }); // (Lakers: two bigs, shooters, a post scorer)
    G.setJB(null);
    G.TS.pc[0] = pc;
    G.setup(0);
    G.setInb(0);
    G.PLAY[0] = null;
    let v = "";
    // the handler brings it into the frontcourt (placed there: a human walking into a defender draws charges)
    const h0 = G.B.owner;
    h0.x = G.hoop(0) - 280;
    h0.y = 250;
    G.cfg.input = () => ({ dx: 0, dy: 0 });
    for (let n = 0; n < 600 && !v; n++) {
      G.upd(1 / 60);
      if (G.RPL) G.skipReplay();
      G.FX.length = 0;
      if (G.PLAY[0] && G.PLAY[0].v) v = G.PLAY[0].v;
    }
    if (!v && G.pos === 0 && tries === 2) got.push(""); // (kept the ball and never ran it: a real failure)
    else if (v) got.push(v);
    else if (tries === 2) got.push("");
  }
  G.cfg.input = () => ({ dx: 0, dy: 0 });
  ok(got.join() === "horns,spain,post", "play calls HORNS / SPAIN / POST UP run those sets (" + got.join() + ")");
  G.setCtrls([]);
}
// ---- 4. ATO: a CPU timeout draws up a play for the star
{
  G.start(2, { j: 6 });
  G.setJB(null);
  G.setup(1);
  G.setInb(0);
  const ok1 = G.callTO(1, "TEST");
  ok(ok1 && G.TS.ato[1] === 1, "CPU timeout -> ATO pending");
  clearStat();
  let ato: any = null;
  for (let n = 0; n < 60 * 40 && !ato; n++) {
    G.upd(1 / 60);
    if (G.RPL) G.skipReplay();
    G.FX.length = 0;
    if (G.PLAY[1] && G.PLAY[1].ato === 1) ato = G.PLAY[1];
  }
  ok(!!ato && G.STAT.ato === 1, "the next set is the ATO call: " + (ato ? ato.nm : "none"));
  const star = G.P.filter((p) => p.tm === 1).sort((a, b) => G.ovr(b) - G.ovr(a))[0];
  ok(!!ato && (ato.use === star || ato.nm.includes(star.n.toUpperCase())), "...run for the star (" + star.n + ")");
}
// ---- 5. coverages by IQ
{
  const cov = (diff: number, setup: () => void) => {
    G.cfg.DIFF = diff;
    G.start(0, { j: 1 });
    for (const p of G.P) (p.sk = null), (p.heat = 0), p.hzm.fill(0);
    setup();
    G.TS.gpT[1] = 10;
    G.gamePlan(1);
    return G.TS.cov[1];
  };
  const shooters = () => {
    for (const q of G.P) if (q.tm === 0) q.c = 92;
  };
  ok(cov(1, shooters) === 1, "Pro: hedge a pull-up shooting star");
  ok(cov(2, () => (shooters(), G.P.filter((p) => p.tm === 0).forEach((p) => (p.heat = 3)))) === 3, "All-Star: blitz the shooting star who is on fire");
  const rim = () => {
    for (const q of G.P) if (q.tm === 0) q.c = 60;
    const t0 = G.P.filter((p) => p.tm === 0);
    for (let k = 0; k < 8; k++) G.scout(t0[k % 5], 40, k % 4 !== 0, 0.3);
  };
  ok(cov(1, rim) === 2, "Pro: ICE a team that lives at the rim");
  ok(cov(0, shooters) === 0, "Rookie: drop, always");
  G.cfg.DIFF = 2;
}
// ---- 6. box-and-one on a lone hot shooter
{
  G.start(4, { j: 0 });
  G.setJB(null);
  const st = G.P.filter((p) => p.tm === 1).sort((a, b) => b.c - a.c)[0];
  for (const p of G.P) (p.heat = 0), (p.sk = null), p.hzm.fill(0);
  st.heat = 4;
  st.c = Math.max(st.c, 85);
  st.stt.pts = 14;
  G.sc[1] = 20;
  G.TS.gpT[0] = 10;
  G.gamePlan(0);
  ok(G.TS.ds[0] === 5 && G.TS.box[0] === G.P.indexOf(st), "lone hot shooter -> box-and-one on " + st.n + " (ds " + G.TS.ds[0] + ")");
  const ch = G.boxCh(0);
  G.setup(1);
  G.setInb(0);
  let dc = 0,
    n = 0;
  for (let k = 0; k < 60 * 45; k++) {
    G.upd(1 / 60);
    if (G.RPL) G.skipReplay();
    G.FX.length = 0;
    G.TS.ds[0] = 5;
    G.TS.box[0] = G.P.indexOf(st);
    if (G.B.owner && G.B.owner.tm === 1 && Math.abs(st.x - G.hoop(1)) < 300) (dc += Math.hypot(ch.x - st.x, ch.y - st.y)), n++;
  }
  ok(!!ch && n > 10 && dc / n < 95, "the chaser stays on him (" + (dc / Math.max(1, n)).toFixed(0) + " px avg over " + n + " ticks, " + (ch ? ch.n : "-") + ")");
}
// ---- 7. rotations: foul trouble, closers, garbage time
{
  G.cfg.SUBS = 1;
  G.start(3, { j: 5 });
  G.setJB(null);
  clearStat();
  const s = G.P[7]; // a starter on the CPU side
  s.pf = 2;
  G.setup(0);
  ok(!G.P.includes(s) && G.STAT.ftrSit === 1, "2 fouls in the 1st quarter: " + s.n + " sits");
  // (2 fouls in the 2nd quarter is not foul trouble any more: he checks back in at the next dead ball once his sub
  // has had his 25 s)
  G.setScalars({ q: 2 });
  for (const p of G.P) p.inAt = -99;
  G.setup(1);
  ok(G.P.includes(s), "foul trouble clears next quarter: " + s.n + " checks back in");
  // closing lineup
  G.start(3, { j: 5 });
  G.setJB(null);
  const st0 = G.P.filter((p) => p.tm === 1);
  const b = G.BENCH[1][0];
  for (const p of G.P) p.inAt = -99;
  st0[2].en = 0.2;
  G.setup(0); // the tired starter goes out
  ok(!G.P.includes(st0[2]), "a gassed starter sits");
  st0[2].en = 0.5;
  G.TS.clutch = 1;
  for (const p of G.P) p.inAt = -99;
  G.setup(0);
  ok(G.P.includes(st0[2]) && (G.STAT.closer || 0) >= 1, "clutch time: the starters close (" + st0[2].n + " back in)");
  G.TS.clutch = 0;
  void b;
  // garbage time
  G.start(3, { j: 5 });
  G.setJB(null);
  G.setScalars({ q: 4, clock: 10 });
  G.sc[0] = 40;
  G.sc[1] = 12;
  for (const p of G.P) p.inAt = -99;
  G.setup(0);
  const benchOn = G.P.filter((p) => (p.rid ?? 0) >= 5).length;
  ok(benchOn >= 4, "garbage time: the reserves are on the floor (" + benchOn + ")");
}
// ---- 8. the bonus and overtime timeouts
{
  G.start(0, { j: 1 });
  G.setJB(null);
  G.setQtrLen(60);
  G.setScalars({ q: 2, clock: 8 }); // last two broadcast minutes (8 s of a 60 s quarter = 96 s)
  G.setup(0);
  G.setInb(0);
  const d = G.P[5],
    o = G.P[0];
  G.tf[1] = 1;
  G.foul(d, o, "REACH", 0, 0);
  ok(!G.ftq, "1st foul in the last two minutes: side out");
  G.setup(0);
  G.setInb(0);
  G.foul(d, o, "REACH", 0, 0);
  ok(!!G.ftq && G.ftq.n === 2 && G.TS.bon[1] === 1, "2nd team foul in the last two minutes: two shots (bonus)");
  G.start(0, { j: 1 });
  G.setJB(null);
  G.setScalars({ q: 5, clock: 20 });
  G.tf[1] = 3;
  G.setup(0);
  G.setInb(0);
  G.foul(G.P[5], G.P[0], "REACH", 0, 0);
  ok(!!G.ftq && G.ftq.n === 2, "overtime: the 4th team foul is the bonus");
  // overtime timeouts
  G.start(0, { j: 1 });
  G.setJB(null);
  G.TS.to = [0, 1];
  G.setScalars({ q: 4, clock: 0.01 });
  G.sc[0] = G.sc[1] = 50;
  G.setup(0);
  G.setInb(0);
  G.setRs(0);
  for (let k = 0; k < 10 && G.q === 4; k++) G.upd(1 / 60);
  ok(G.q === 5 && G.TS.to[0] === 2 && G.TS.to[1] === 2, "overtime: two timeouts each (q " + G.q + ", to " + G.TS.to.join("/") + ")");
}
// ---- 9. full games still finish with every system on (Hall of Fame coaches)
{
  G.cfg.DIFF = 3;
  G.setCtrls([]);
  G.setQtrLen(60);
  let fin = 0;
  for (let g = 0; g < 2; g++) {
    G.start(g + 2, { j: g + 9 });
    play(60 * 60 * 10);
    if (G.S === "over") fin++;
  }
  ok(fin === 2, "Hall of Fame games finish (" + fin + "/2)");
}
// ---- 10. My Player career XP (client/career.ts): a game pays, levels raise the attribute cap
{
  const d = G.MYP.d;
  d.xp = 0;
  d.lv = 0;
  const cap0 = capOf(d),
    me = { stt: { pts: 30, reb: 8, ast: 6, blk: 1, fgm: 12, fga: 20, chg: 0, dv: 0, sa: 0 }, pf: 2 };
  const x1 = gameXP(me.stt, true, 2, G.QTRLEN),
    x0 = gameXP({ pts: 0, reb: 0, ast: 0, blk: 0, fgm: 0, fga: 6 }, false, 0, 180);
  let r: any = null;
  for (let k = 0; k < 4; k++) r = awardXP(me as any, true);
  ok(x1 > x0 && x0 >= 25, "XP: a big win pays more than a quiet loss (" + x1 + " vs " + x0 + ")");
  ok(d.lv >= 1 && capOf(d) === cap0 + 3 * d.lv && r.xp === x1, "levels raise the builder cap (level " + d.lv + ", cap " + capOf(d) + ")");
  d.xp = d.lv = 0;
  delete d.car;
}
if (fails) {
  console.log(fails + " FAILED");
  process.exit(1);
}
console.log("TEAMPLAY OK");
