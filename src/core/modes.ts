// Game modes on top of the core sim (DOM-free): Practice, Tutorial, 3-Point Contest, Dunk Contest, HORSE and Clutch
// Challenges. They drive the normal sim through HOOK.pre/post: unused players are parked off the floor (p.off),
// the clocks are frozen, shots are watched until they resolve, and results go to the shell as FX {k:"mode"}.
import * as G from "./sim";
import { cfg, HOOK, type Player } from "./sim";
import { TM, isDunkSv } from "./data";

export const M: any = { kind: "" };
const PARK = (p: Player, k: number) => {
  p.off = 1;
  p.x = 300 + k * 30;
  p.y = -400;
  p.z = p.vx = p.vy = p.vz = 0;
  p.mode = "i";
};
const unpark = (p: Player, x: number, y: number) => {
  p.off = 0;
  p.x = x;
  p.y = y;
  p.vx = p.vy = p.vz = p.z = 0;
  p.mode = "i";
  p.t = 0;
  p.f = Math.atan2(G.HY - y, G.hoop(p.tm) - x);
};
const give = (p: Player) => {
  const B = G.B;
  B.owner = p;
  B.mode = "held";
  B.sh = 0;
  B.sc = 0;
  B.to = null;
  B.last = p;
  B.vx = B.vy = B.vz = 0;
  B.x = p.x;
  B.y = p.y;
  B.z = 40;
  G.setPos(p.tm);
};
/** Pass the ball back out from under the rim (a rebounder feeding the shooter). */
function feed(p: Player) {
  const B = G.B,
    hx = G.hoop(p.tm),
    fl = 0.7;
  B.owner = null;
  B.mode = "pass";
  B.to = p;
  B.ptype = 0;
  B.sh = 0;
  B.sc = 0;
  B.age = 0;
  B.last = null;
  B.x = hx + (hx > 470 ? -8 : 8);
  B.y = G.HY;
  B.z = 50;
  B.vx = (p.x - B.x) / fl;
  B.vy = (p.y - B.y) / fl;
  B.vz = (55 - B.z + 0.5 * G.g * fl * fl) / fl;
  B.wv = [0, 0, 0];
  G.setPos(p.tm);
}
const me = () => G.P[0];
const say = (s: string, c = "#ffd23f") => G.txt(s, 480, 220, c);
const evt = (o: any) => G.fxp({ k: "mode", ...o });
/** Watch the human's (or anyone's) shot from release to make / miss. */
function watchShot(p: Player, dt: number): null | { made: boolean; dunk: boolean; three: boolean; green: boolean; perf: boolean } {
  const B = G.B,
    W = M.w || (M.w = { live: 0, t: 0, lc: p.lc || 0 });
  if ((p.lc || 0) !== W.lc && B.last === p) {
    W.live = 1;
    W.t = 0;
    W.dunk = !!B.dk;
    W.three = !!B.three;
    W.green = !!B.gn;
    W.perf = !!p.perf;
    W.sv = p.sv;
    W.spd = M.spd || 0;
  }
  W.lc = p.lc || 0;
  if (!W.live) return null;
  W.t += dt;
  if (B.sc) {
    W.live = 0;
    return { made: true, dunk: W.dunk, three: W.three, green: W.green, perf: W.perf };
  }
  if ((B.owner && W.t > 0.3) || (B.z < 8 && W.t > 0.5) || W.t > 3.2) {
    W.live = 0;
    return { made: false, dunk: W.dunk, three: W.three, green: W.green, perf: W.perf };
  }
  return null;
}
/** Swap a player into slot 0 of his team (the slot the human controls in every mode). */
function toSlot0(t: number, p: Player) {
  const NP = cfg.NP,
    k = p.k,
    a = G.P[t * NP],
    i = G.P.indexOf(p);
  if (i === t * NP) return;
  G.P[t * NP] = p;
  G.P[i] = a;
  a.k = k;
  p.k = 0;
}
const best = (t: number, f: (p: Player) => number) => G.P.filter((p) => p.tm === t).sort((a, b) => f(b) - f(a))[0];
const saved = { JB: 1, FOULS: 1, VIOL: 1, SUBS: 1 };
/** Common start: a normal game with no jump ball, then the mode takes over. */
function begin(kind: string, sel: number, opp: number | undefined) {
  stopMode();
  Object.assign(saved, { JB: cfg.JB, FOULS: cfg.FOULS, VIOL: cfg.VIOL, SUBS: cfg.SUBS });
  cfg.JB = 0;
  cfg.GM = kind;
  cfg.ONLINE = 0;
  if (kind !== "clutch") {
    cfg.FOULS = 0;
    cfg.VIOL = 0;
    cfg.SUBS = 0;
  }
  G.start(sel, opp != null && opp >= 0 ? { j: opp } : {});
  cfg.JB = saved.JB;
  G.FX.length = 0; // no "INBOUND" from the normal start
  if (kind !== "clutch") {
    // the human always runs slot 0 (the mode's shooter); no inbound pass to a parked teammate
    G.setInb(0);
    for (const c of G.CT) {
      c.fixed = true;
      c.idx = c.tm * cfg.NP;
    }
  }
  M.kind = kind;
  M.t = 0;
  M.w = null;
  M.done = 0;
  HOOK.pre = pre;
  HOOK.post = post;
  HOOK.end = kind === "clutch" ? postClutch : null;
}
export function stopMode() {
  if (M.kind) Object.assign(cfg, { FOULS: saved.FOULS, VIOL: saved.VIOL, SUBS: saved.SUBS });
  M.kind = "";
  cfg.GM = "game";
  HOOK.pre = HOOK.post = HOOK.end = null;
  for (const p of G.P) {
    p.off = 0;
    if (p.horseT) (p.tm = 1), (p.horseT = 0);
  }
  if (M.jb != null) {
    const p = M.jbP;
    if (p) p.j = M.jb;
    M.jb = null;
  }
}
function finish(res: any) {
  if (M.done) return;
  M.done = 1;
  evt({ ev: "end", kind: M.kind, res });
}
// ======================= Practice / Tutorial =======================
export const TUT: [string, string][] = [
  ["Move with WASD or the arrow keys", "move"],
  ["Hold SHIFT to sprint", "sprint"],
  ["Hold SPACE to rise up, let go at the top of the meter", "shot"],
  ["Hit a GREEN release (let go when the meter is in the green)", "green"],
  ["Pump fake with G (stick still), jab step with G + direction", "fake"],
  ["Step-back with F", "sb"],
  ["Dribble moves: C hesitation · X spin · V behind the back", "move2"],
  ["Attack the rim and finish (shoot close to the basket)", "lay"],
  ["Post up: hold B near the paint", "post"],
];
export function startPractice(sel: number, tut = false) {
  begin(tut ? "tutorial" : "practice", sel, undefined);
  const NP = cfg.NP;
  G.P.forEach((p, k) => {
    if (p.tm === 1 || (tut && p !== me())) PARK(p, k);
  });
  const p = me();
  unpark(p, G.hoop(0) - 200, G.HY);
  give(p);
  M.st = { att: 0, made: 0, gr: 0, streak: 0, best: 0, tpm: 0 };
  M.step = 0;
  M.mvd = 0;
  M.spr = 0;
  M.fb = 0;
  if (tut) G.ban("TUTORIAL", TUT[0][0], "#9fe7ff");
  else G.ban("PRACTICE", NP > 1 ? "Your team · no defense · ball comes back to you" : "Free shooting · ball comes back to you", "#9fe7ff");
}
function tutTick(p: Player, dt: number, r: any) {
  const k = TUT[M.step] && TUT[M.step][1];
  if (!k) return;
  let ok = false;
  if (k === "move") ok = (M.mvd += Math.hypot(p.vx, p.vy) * dt) > 160;
  else if (k === "sprint") ok = (M.spr += p.in.sp && Math.hypot(p.vx, p.vy) > 150 ? dt : 0) > 0.8;
  else if (k === "shot") ok = !!r;
  else if (k === "green") ok = !!(r && r.green);
  else if (k === "fake") ok = (p.act === 1 || p.act === 2) && p.actT > 0;
  else if (k === "sb") ok = p.mode === "b";
  else if (k === "move2") ok = p.mvT > 0 && p.mvk >= 1 && p.mvk <= 3;
  else if (k === "lay") ok = !!(r && r.made && (r.dunk || Math.hypot(G.hoop(0) - p.x, G.HY - p.y) < 120));
  else if (k === "post") ok = !!p.postA;
  if (ok) {
    M.step++;
    G.snd(880, 0.15, "triangle", 0.08);
    if (M.step >= TUT.length) {
      G.ban("TUTORIAL COMPLETE", "You're ready — tip it off!", "#2ecc71");
      finish({ done: 1 });
    } else G.ban("✔ NICE", TUT[M.step][0], "#2ecc71");
  }
}
// ======================= 3-Point Contest =======================
const RACKS = [80, 40, 0, -40, -80].map((d) => {
  const a = (d * Math.PI) / 180,
    hx = G.hoop(0);
  return [hx - 243 * Math.cos(a), G.HY + 243 * Math.sin(a)];
});
export function start3pt(sel: number) {
  begin("3pt", sel, undefined);
  const p = cfg.NP > 1 ? best(0, (q) => q.c) : me();
  toSlot0(0, p);
  G.P.forEach((q, k) => q !== p && PARK(q, k));
  M.rack = 0;
  M.ball = 0;
  M.pts = 0;
  M.time = 60;
  M.wait = 1.2;
  M.racks = [0, 0, 0, 0, 0];
  M.shots = [] as number[];
  unpark(p, RACKS[0][0], RACKS[0][1]);
  give(p);
  G.ban("3-POINT CONTEST", "5 racks · 25 balls · 60 seconds · last ball of each rack = MONEY BALL", "#ffd23f");
  // the field: the best shooters from the other teams
  M.field = TM.flatMap((t) => t[2].map((a) => ({ n: a[0], c: a[1] })))
    .filter((a) => !G.P.some((q) => q.n === a.n))
    .sort((a, b) => b.c - a.c)
    .slice(0, 3)
    .map((a) => {
      let s = 0;
      const pk = Math.min(0.72, Math.max(0.25, 0.2 + (a.c - 60) / 55));
      for (let i = 0; i < 25; i++) if (Math.random() < pk) s += i % 5 === 4 ? 2 : 1;
      return { n: a.n, s };
    });
}
function tick3(p: Player, dt: number) {
  const spot = RACKS[M.rack];
  if (M.time > 0 && M.wait <= 0) M.time = Math.max(0, M.time - dt);
  if (M.wait > 0) M.wait -= dt;
  const r = watchShot(p, dt);
  if (r) {
    const money = M.ball === 4,
      pts = r.made ? (money ? 2 : 1) : 0;
    M.pts += pts;
    M.racks[M.rack] += pts;
    M.shots.push(pts);
    if (r.made) G.txtW(money ? "MONEY BALL! +2" : "+1", p.x, p.y, 120, money ? "#ffd23f" : "#fff");
    M.ball++;
    if (M.ball >= 5) {
      M.ball = 0;
      M.rack++;
    }
    if (M.rack >= 5 || M.time <= 0) return finish({ pts: M.pts, field: M.field, racks: M.racks });
    if (M.ball === 0) {
      const s = RACKS[M.rack];
      unpark(p, s[0], s[1]);
      M.wait = 0.35;
    }
    give(p);
    if (M.ball === 4) G.txtW("MONEY BALL", p.x, p.y, 130, "#ffd23f");
    return;
  }
  if (M.time <= 0 && !(M.w && M.w.live) && G.B.owner === p && p.mode === "i") return finish({ pts: M.pts, field: M.field, racks: M.racks });
  // planted at the rack: no drifting, no step-backs, no passes
  if (p.mode === "i") {
    p.x += (spot[0] - p.x) * 0.3;
    p.y += (spot[1] - p.y) * 0.3;
  }
}
// ======================= Dunk Contest =======================
const DBASE: Record<number, number> = { 6: 37, 11: 38, 12: 41, 13: 44, 14: 42, 15: 46 },
  DNAME: Record<number, string> = { 6: "One-hand slam", 11: "Two-hand power", 12: "Tomahawk", 13: "Windmill", 14: "Reverse", 15: "360" };
export function startDunk(sel: number) {
  begin("dunk", sel, undefined);
  const p = cfg.NP > 1 ? best(0, (q) => q.j + q.i * 0.3) : me();
  toSlot0(0, p);
  G.P.forEach((q, k) => q !== p && PARK(q, k));
  M.jb = p.j;
  M.jbP = p;
  p.j = Math.max(p.j, 82); // everybody gets bounce in the contest
  M.dunk = 0;
  M.tries = 0;
  M.scores = [] as number[];
  M.style = 0;
  M.last = -1;
  M.wait = 0;
  reset(p);
  G.ban("DUNK CONTEST", "3 dunks · 2 tries each · green release = clean finish", "#ffd23f");
  say("Pick a dunk on the approach: C tomahawk · X 360 · V windmill · G reverse · none = power", "#9fe7ff");
  M.field = TM.flatMap((t) => t[2].map((a) => ({ n: a[0], j: a[5] })))
    .filter((a) => !G.P.some((q) => q.n === a.n))
    .sort((a, b) => b.j - a.j)
    .slice(0, 3)
    .map((a) => ({ n: a.n, s: [0, 1, 2].reduce((s) => s + Math.round(Math.min(50, 34 + a.j / 8 + Math.random() * 9)), 0) }));
}
function reset(p: Player) {
  unpark(p, 470, G.HY + (Math.random() - 0.5) * 120);
  give(p);
  M.style = 0;
  M.spd = 0;
}
function tickDunk(p: Player, dt: number) {
  if (M.wait > 0) {
    M.wait -= dt;
    if (M.wait <= 0 && !G.RPL) reset(p);
    return;
  }
  // approach: the last move pressed picks the dunk
  const i = p.in,
    D = Math.hypot(G.hoop(0) - p.x, G.HY - p.y);
  if (i.mv) M.style = i.mv === 1 ? 12 : i.mv === 2 ? 15 : 13;
  if (i.pf) M.style = 14;
  M.spd = Math.max(M.spd * 0.98, Math.hypot(p.vx, p.vy));
  if (i.sd && p.mode === "i" && G.B.owner === p) {
    if (D < 65) {
      p.fsv = M.style || (p.j >= 85 ? 11 : 6);
      p.hk = 1;
    } else if (D > 110) say("Get to the rim to dunk!", "#ff9966");
  }
  const r = watchShot(p, dt);
  if (!r) return;
  M.tries++;
  let sc = 0;
  if (r.made && r.dunk) {
    const sv = M.w.sv;
    sc = (DBASE[sv] || 36) + Math.min(3, (M.w.spd || 0) / 90) + (r.perf ? 2 : 0) - (sv === M.last ? 4 : 0);
    sc = Math.round(Math.max(30, Math.min(50, sc)));
    M.last = sv;
    const j = judges(sc);
    G.fxp({ k: "mode", ev: "judges", j, s: sc, name: DNAME[sv] || "Slam" });
    G.ban(DNAME[sv] ? DNAME[sv].toUpperCase() + "!" : "SLAM!", j.join(" · ") + "  =  " + sc, sc >= 47 ? "#ff5a5a" : "#ffd23f");
    if (G.recN > 80 && cfg.replays) G.startReplay();
  } else {
    G.ban(r.made ? "THAT'S A LAYUP" : "MISSED!", M.tries < 2 ? "One more try" : "Dunk over", "#ff9966");
    if (M.tries >= 2) sc = 25;
  }
  if (sc) {
    M.scores.push(sc);
    M.dunk++;
    M.tries = 0;
  }
  M.wait = 1.6;
  if (M.dunk >= 3) {
    M.wait = 99;
    setTimeout(() => finish({ scores: M.scores, total: M.scores.reduce((a: number, b: number) => a + b, 0), field: M.field }), 1800);
  }
}
const judges = (s: number) => {
  const j = [10, 10, 10, 10, 10];
  let off = 50 - s,
    k = 0;
  while (off > 0) {
    if (j[k % 5] > 6) (j[k % 5]--, off--);
    k += 1 + ((Math.random() * 3) | 0);
  }
  return j;
};
// ======================= HORSE =======================
const HSPOTS = [
  [0, 120], [40, 150], [-40, 150], [0, 243], [70, 243], [-70, 243], [85, 243], [-85, 243], [25, 200], [-25, 200], [0, 60], [55, 95],
];
const spotXY = (s: number[]) => {
  const a = (s[0] * Math.PI) / 180;
  return [G.hoop(0) - s[1] * Math.cos(a), G.HY + s[1] * Math.sin(a)];
};
export function startHorse(sel: number, opp?: number) {
  begin("horse", sel, opp);
  const NP = cfg.NP,
    a = cfg.NP > 1 ? best(0, (q) => q.c + q.i) : me(),
    b = best(1, (q) => q.c + q.i);
  toSlot0(0, a);
  toSlot0(1, b);
  // both players shoot at the same (right) hoop: the CPU borrows team 0's basket by standing in for it
  G.P.forEach((q, k) => q !== a && q !== b && PARK(q, k));
  b.tm = 0; // same basket for both
  b.horseT = 1;
  M.pl = [a, b];
  M.let = [0, 0];
  M.setter = 0;
  M.ph = "set";
  M.spot = null;
  M.wait = 0.6;
  M.cin = { dx: 0, dy: 0 };
  void NP;
  turn();
  G.ban("H-O-R-S-E", "Make it, they have to match it. Miss the match = a letter.", "#ffd23f");
}
function turn() {
  const [a, b] = M.pl,
    sh = M.ph === "set" ? M.pl[M.setter] : M.pl[1 - M.setter],
    other = sh === a ? b : a;
  PARK(other, 9);
  let x: number, y: number;
  if (M.ph === "match") [x, y] = M.spot;
  else if (sh === b) [x, y] = spotXY(HSPOTS[(Math.random() * HSPOTS.length) | 0]);
  else [x, y] = [G.hoop(0) - 220, G.HY];
  unpark(sh, x, y);
  give(sh);
  M.w = null;
  M.cur = sh;
  M.ct = 0;
  M.rel = 0.6 + (Math.random() - 0.5) * 0.12;
  // the human only controls his own guy; the CPU shoots by itself
  for (const c of G.CT) c.idx = 0;
  G.ban(M.ph === "set" ? (sh === a ? "YOUR SHOT" : sh.n.toUpperCase() + " SETS IT") : sh === a ? "MATCH IT!" : sh.n.toUpperCase() + " TO MATCH", sh === a && M.ph === "set" ? "Shoot from anywhere" : "", "#9fe7ff");
}
function tickHorse(dt: number) {
  const sh = M.cur,
    a = M.pl[0];
  if (M.wait > 0) {
    M.wait -= dt;
    if (M.wait <= 0) turn();
    return;
  }
  if (sh !== a) {
    // CPU: settle, rise up, let go
    M.ct += dt;
    const i = M.cin;
    i.dx = i.dy = 0;
    i.sd = i.su = 0;
    if (sh.mode === "i" && G.B.owner === sh && M.ct > 0.8) i.sd = 1;
    if (sh.mode === "c" && sh.t >= M.rel) i.su = 1;
    sh.in = i;
  } else if (M.ph === "match" && sh.mode === "i") {
    // matching: you shoot from the spot
    sh.x += (M.spot[0] - sh.x) * 0.3;
    sh.y += (M.spot[1] - sh.y) * 0.3;
  }
}
function postHorse(dt: number) {
  const sh = M.cur;
  if (!sh || M.wait > 0) return;
  const r = watchShot(sh, dt);
  if (!r) return;
  const L = "HORSE";
  if (M.ph === "set") {
    if (r.made) {
      M.spot = [sh.x, sh.y];
      M.ph = "match";
      G.txtW("GOOD — MATCH IT", sh.x, sh.y, 120, "#2ecc71");
    } else {
      M.setter = 1 - M.setter; // miss: the other guy sets
      G.txtW("MISS — " + M.pl[M.setter].n.toUpperCase() + "'S SHOT", sh.x, sh.y, 120, "#ff9966");
    }
  } else {
    const mi = 1 - M.setter;
    if (!r.made) {
      M.let[mi]++;
      G.ban(L.slice(0, M.let[mi]).split("").join("-"), M.pl[mi].n.toUpperCase() + " PICKS UP A LETTER", "#ff6b4a");
      if (M.let[mi] >= 5) return finish({ win: mi === 1, letters: M.let, names: M.pl.map((p: Player) => p.n) });
    } else G.txtW("MATCHED!", sh.x, sh.y, 120, "#2ecc71");
    M.ph = "set"; // the setter keeps control
  }
  M.wait = 1.1;
  evt({ ev: "horse", letters: M.let.slice() });
}
// ======================= Clutch Challenges =======================
export const CLUTCH = [
  { n: "Down 2, 12 seconds left", d: "Your ball. Tie it or win it.", me: 98, op: 100, t: 12, pos: 0, goal: "win" },
  { n: "Down 3, 8 seconds left", d: "Your ball. Hit a three to force overtime (or win it).", me: 95, op: 98, t: 8, pos: 0, goal: "ot" },
  { n: "Up 1, 15 seconds left", d: "Their ball. Get a stop.", me: 101, op: 100, t: 15, pos: 1, goal: "win" },
  { n: "Tied, 6 seconds left", d: "Your ball. Win it at the buzzer.", me: 104, op: 104, t: 6, pos: 0, goal: "win" },
  { n: "Down 5, 24 seconds left", d: "Your ball. Find a way.", me: 96, op: 101, t: 24, pos: 0, goal: "win" },
  { n: "Down 1, 3.5 seconds left", d: "Inbound in the frontcourt. One shot.", me: 99, op: 100, t: 3.5, pos: 0, goal: "win" },
];
export function startClutch(i: number, sel: number, opp?: number) {
  const c = CLUTCH[i];
  G.setQtrLen(720); // a real-time clock: 12 s means 12 s
  begin("clutch", sel, opp);
  G.setScalars({ q: 4, clock: c.t, sc: [c.me, c.op] });
  G.setup(c.pos);
  if (i === 5) for (const p of G.P) p.x += (G.hoop(0) - 470) * 0.55; // frontcourt inbound
  G.TS.clutch = 1;
  M.ci = i;
  M.goal = c.goal;
  G.ban("CLUTCH CHALLENGE", c.n.toUpperCase() + " · " + c.d, "#ff5a5a");
}
function postClutch() {
  if (M.done) return;
  if (M.goal === "ot" && G.q > 4) {
    G.setS("over");
    return finish({ win: true, ci: M.ci });
  }
  if (G.S === "over") finish({ win: G.sc[0] > G.sc[1], ci: M.ci });
}
// ======================= hooks =======================
function pre(dt: number) {
  const k = M.kind;
  if (k !== "clutch") {
    G.setClock(G.QTRLEN);
    G.setShot(24);
  }
  const p = me();
  if (k === "3pt" && p.mode === "i") {
    p.in.dx = p.in.dy = 0;
    p.in.sb = p.in.mv = p.in.e = p.in.lob = p.in.post = 0;
  }
  if (k === "horse") tickHorse(dt);
}
function post(dt: number) {
  const k = M.kind,
    p = me(),
    B = G.B;
  if (G.rs > 0 && k !== "clutch") G.setRs(0); // no inbounds after makes: the mode decides what happens next
  if (k === "clutch") return void postClutch();
  if (M.done) return;
  if (k === "practice" || k === "tutorial") {
    const r = watchShot(p, dt);
    if (r) {
      const s = M.st;
      s.att++;
      if (r.made) (s.made++, s.streak++, (s.best = Math.max(s.best, s.streak)), r.three && s.tpm++);
      else s.streak = 0;
      if (r.green) s.gr++;
      M.fb = 0.9;
    }
    if (k === "tutorial") tutTick(p, dt, r);
    // ball comes back: after the shot settles, or if it's lying around
    if (M.fb > 0) {
      M.fb -= dt;
      if (M.fb <= 0 && B.owner !== p) feed(p);
    } else if (!B.owner && B.mode === "air" && !B.sh && B.z < 10 && Math.hypot(B.vx, B.vy) < 40) feed(p);
    return;
  }
  if (k === "3pt") return void tick3(p, dt);
  if (k === "dunk") return void tickDunk(p, dt);
  if (k === "horse") return void postHorse(dt);
}
export { isDunkSv };
