// Hoops 2K27 shared simulation core. DOM-free: runs in the browser (every mode) and in Node (tests, servers).
// Ported from the four near-identical mode copies; NP (players per team) and the physics backend are flags.
// Game coordinates: x 0..940, y 0..500 (10 px = 1 ft), z up (rim z=100). Team 0 attacks the RIGHT hoop.
import { TM, SP, OV, ov2, formOf, isDunkSv, SIG, type Tuple } from "./data";
const SIGK = (p: Player) => !!SIG[p.n];
import { pose3, handPos, skeleton } from "./pose";
import { RAP, rapStep, rapSyncPlayers } from "./physics";

export const CW = 940,
  CH = 500,
  g = 320,
  HXs = [52.5, 887.5],
  HY = 250,
  RR = 7.5,
  BR = 3.9;
/** The basket team t attacks. Half-court games (street / King of the Court): everyone plays at the right basket. */
export const hoop = (t: number) => (cfg.HALF ? HXs[1] : t ? HXs[0] : HXs[1]),
  clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const W3 = (x: number, y: number, z = 0) => [(x - 470) * 0.1, z * 0.1, (y - 250) * 0.1];

export type Player = any;
export type Ball = any;
/** One tick of a human's intent. Edge flags (sd/su/e/...) are true only on the tick they happened. */
export interface Input {
  dx: number;
  dy: number;
  sd?: any; // shoot/jump pressed
  su?: any; // shoot released
  e?: any; // pass (offense) / reach (defense, disabled)
  sb?: any; // step-back
  mv?: number; // 1 hesi / 2 spin / 3 behind the back
  post?: any;
  lob?: any;
  sp?: any; // sprint (held)
  pass?: Player;
  sw?: any; // switch defender
  mt?: number; // client-measured meter time at release (online: judged on the shooter's timeline)
  tp?: number; // client-measured tempo tap time
  pf?: any; // pump fake (no stick) / jab step (stick held) / shoulder fake (posting up)
  to?: any; // call timeout
  ch?: any; // coach's challenge
  ds?: any; // cycle defense setting (on defense) / play call (on offense)
}
/** A human controlling one player. `fixed` = My Player (never auto-switches). */
export interface Ctrl {
  id: string;
  tm: number;
  idx: number;
  fixed: boolean;
  tempo: number;
  inp: Input;
  lastO: Player | null;
  lag?: number; // seconds of one-way latency for lag-compensated contests (online)
}

/** Mode flags. NP and physics are set by the shell before start(). */
export const cfg = {
  NP: 5,
  PRO: 1,
  AVOID: 1, // arms/shoulders kept out of other players' torsos in the pose (0 = off, for A/B tests)
  PLANT: 1, // stance feet pinned to the floor in the core pose (0 = off, for A/B tests)
  INZ: 1, // inertialized animation blending (0 = the old exponential smoothing, for A/B tests)
  AP: 1, // animation pack v5.4 (pose.ts, C# Pose.UP.cs): shot loads / follow-through by form, finishes, move anticipation, D variety, exact guide palm; 0 = v5.3 poses (A/B)
  TP: 1, // team play pack v5.4 (named sets, ATO, ICE / blitz, box-and-one); 0 = off (A/B tests)
  PP: 2, // Pro Play level: 2 = v5.4 (defender reads, pull-ups, body-ups, post battles, off-ball calls), 1 = v5.3 pack (moves, gathers, floaters, stance D, deflections), 0 = the v5.2 game (A/B tests)
  PH3: 1, // physics v3 (sim.ts "Physics v3" block, C# Sim.PH3.cs): real air drag/Magnus, surfaces, rim/glass/net, bodies, fatigue, fumbles, floor; 0 = v5.4 physics (A/B)
  SHATTER: 1, // (physics v3) a monster dunk can very rarely shatter the backboard (stoppage while it is replaced); 0 = never
  physics: "rapier" as "rapier" | "legacy",
  hand: true, // release from the rig's real hand (3D) instead of a fixed height (2D legacy)
  replays: true,
  MYM: 0,
  DIFF: 1, // CPU difficulty: 0 Rookie, 1 Pro, 2 All-Star, 3 Hall of Fame (only the CPU side, never humans)
  playerBodies: true, // Rapier kinematic player capsules (ball can deflect off bodies)
  JB: 1, // opening jump ball (0 = start with an inbound, used by some tests)
  // ---- custom rules (settings drawer) ----
  FOULS: 1, // fouls called at all
  SCLK: 1, // 24-second shot clock
  VIOL: 1, // 3-second / 8-second violations, goaltending
  SUBS: 1, // fatigue substitutions + foul-outs (5v5, offline; online rosters stay fixed)
  BADGES: 1, // rating badges + hot zones + rhythm/cold streaks
  ONLINE: 0, // online game: rating-only shot windows (the guest's meter must match the host); subs are synced (lineup U)
  HALF: 0, // half-court game (street rules): check ball at the top, make-it-take-it, 1s and 2s
  TO: 0, // points to win (street / king); 0 = timed quarters
  ASTAR: 0, // All-Star game: mixed rosters, open floor, lobs, fouls off
  GM: "game" as string, // game mode: game | practice | tutorial | 3pt | dunk | horse | clutch (modes.ts)
  input: null as null | ((c: Ctrl) => Input),
};

export let S = "menu",
  P: Player[] = [],
  B: Ball = {},
  sc = [0, 0],
  q = 1,
  clock = 60,
  shot = 24,
  pos = 0,
  T = 0,
  rs = 0,
  pend = 0,
  fin = 0,
  cl: string[] = ["", ""],
  PC = ["#7b3fb5", "#1d428a"],
  PCNT = [0, 0],
  LASTP = [-9, -9],
  DT = 0.016,
  fc = 0,
  ftq: any = null,
  tf = [0, 0],
  inb = 0,
  RQ = 0,
  RPL: any = null,
  QTRLEN = 60,
  CT: Ctrl[] = [];
CT = [mkCtrlRaw("p1", 0)];
function mkCtrlRaw(id: string, tm: number): Ctrl {
  return { id, tm, idx: 0, fixed: false, tempo: 0, inp: { dx: 0, dy: 0 }, lastO: null };
}

/** Effects the shell renders: floating texts (world- or screen-anchored), sounds, crowd excitement, game end. */
export const FX: any[] = [];
let fxId = 0;
/** Client-side prediction mode: step() runs for the local player only, with no side effects on others. */
export let PREDICT = 0;
export const setPredict = (v: number) => (PREDICT = v);
const fx = (o: any) => {
  if (PREDICT) return;
  o.id = ++fxId;
  FX.push(o);
  if (FX.length > 64) FX.shift();
};
export const txt = (s: string, x: number, y: number, c = "#fff") => fx({ k: "t", s, sx: x, sy: y, c });
export const txtW = (s: string, x: number, y: number, z: number, c = "#fff") => fx({ k: "t", s, x, y, z, c });
export const snd = (f: number, d: number, ty = "sine", v = 0.07) => fx({ k: "s", f, d, ty, v });
const exc = (v: number) => fx({ k: "x", v });
export const fxp = (o: any) => fx(o);
/** Game-mode hooks (modes.ts): pre runs after inputs/AI and before stepping; post after posing (true = skip the rest). */
export const HOOK: { pre: null | ((dt: number) => void); post: null | ((dt: number) => boolean | void); end: null | (() => void) } = { pre: null, post: null, end: null };

// ---- setters for the shell (ES module bindings are read-only outside) ----
export const setInb = (v: number) => (inb = v);
export const setRs = (v: number) => (rs = v);
export const setClock = (v: number) => (clock = v);
export const setShot = (v: number) => (shot = v);
export const setT = (v: number) => (T = v);
export const setS = (v: string) => (S = v);
export const setPos = (v: number) => (pos = v);
export const setJB = (v: any) => (JB = v);
export const setRQ = (v: number) => (RQ = v);
export const setQtrLen = (v: number) => (QTRLEN = v);
export const setCtrls = (c: Ctrl[]) => (CT = c);
export const mkCtrl = (id: string, tm: number, fixed = false, tempo = 0): Ctrl => ({
  id,
  tm,
  idx: tm * cfg.NP,
  fixed,
  tempo,
  inp: { dx: 0, dy: 0 },
  lastO: null,
});
/** Apply authoritative scalar state (used by online guests). */
export function setScalars(o: any) {
  ({ S, q, clock, shot, pos, rs, inb, T } = Object.assign({ S, q, clock, shot, pos, rs, inb, T }, o));
  if (o.sc) sc = o.sc;
  if (o.tf) tf = o.tf;
  if ("ftq" in o) ftq = o.ftq;
  if (o.cl) cl = o.cl;
  if (o.PC) PC = o.PC;
}
export const setPlayers = (a: Player[]) => (P = a);
export const setBall = (b: Ball) => (B = b);

// ---- rosters ----
export const ALL = TM.flatMap((t, ti) => t[2].map((a) => ({ t: ti, a })));
export const MYP: { d: any; t: Tuple } = {
  d: { n: "MY PLAYER", c: 80, i: 78, s: 80, d: 72, j: 60, st: 0, sk: "#c68642", hr: 1, bd: 0, ht: 6.6, bk: 1, no: 1, col: "#e8541e" },
  t: null as any,
};
export const mkT = () => {
  const d = MYP.d;
  MYP.t = [d.n, d.c, d.i, d.s, d.d, d.j, d.st, d.sk, d.hr, d.bd, d.ht, d.bk, d.no];
};
mkT();
export const nChoices = () => (cfg.NP > 1 ? TM.length : ALL.length);
export const RO = (i: number): [string, Tuple[], string] =>
  cfg.NP > 1
    ? [TM[i][1], cfg.NP >= 5 ? TM[i][2] : TM[i][2].slice().sort((a, b) => ov2(b) - ov2(a)).slice(0, cfg.NP), TM[i][0]]
    : [TM[ALL[i].t][1], [ALL[i].a], ALL[i].a[0]];
/** All-Star teams: the league's best, drafted alternately into Team Gold and Team Ice. */
export function allStar(t: number): [string, Tuple[], string] {
  const all = TM.flatMap((x) => x[2]).sort((a, b) => ov2(b) - ov2(a)),
    pick = all.slice(0, cfg.NP * 2).filter((_, k) => (k % 4 === 0 || k % 4 === 3 ? 0 : 1) === t);
  // bigs at the back of the lineup so the positions read right
  pick.sort((a, b) => a[10] - b[10]);
  return t ? ["#4fb3ff", pick, "Team Ice"] : ["#e0a526", pick, "Team Gold"];
}
let SEL = 0;
function RS(ti: number, t: number): [string, Tuple[], string] {
  if (cfg.ASTAR && cfg.NP > 1) return allStar(t);
  if (cfg.MYM && t === 0) {
    if (cfg.NP === 1) return [MYP.d.col, [MYP.t], MYP.t[0]];
    const b = RO(ti);
    let w = 0;
    b[1].forEach((a, k) => {
      if (ov2(a) < ov2(b[1][w])) w = k;
    });
    return [b[0], [MYP.t, ...b[1].filter((a, k) => k !== w)], b[2]];
  }
  if (cfg.MYM && t === 1 && cfg.NP === 1) return RO(SEL);
  return RO(ti);
}
export const ovr = (p: Player) => OV[p.n] || Math.round(68 + (Math.max(p.c, p.i) - 75) * 0.4);

/** Shot chart: every field-goal attempt (team, where it went up, made, three, quarter) - final / halftime screens. */
export const SHOTS: { t: number; x: number; y: number; m: number; th: number; q: number }[] = [];
export function start(i: number, o: { j?: number; sel?: number } = {}) {
  const NP = cfg.NP;
  SHOTS.length = 0;
  SEL = o.j ?? o.sel ?? i; // My Player 1v1 faces the chosen opponent, else the selected card
  let j = o.j;
  if (j == null)
    do j = (Math.random() * nChoices()) | 0;
    while (j === i);
  P = [];
  [i, j].forEach((ti, t) => {
    const col = t && RS(ti, t)[0] === RS(i, 0)[0] ? "#b03a2e" : RS(ti, t)[0];
    RS(ti, t)[1].forEach((a, k) => P.push(Object.assign(mkP(a, t, k, col), { rid: k })));
    // generated reserves (fictional), a few points below the starters, for fatigue subs and foul-outs
    // (deterministic from the team: an online guest builds the very same bench; rid = stable roster id, bench 5+)
    BENCH[t] = NP >= 5 && !cfg.ASTAR ? reserves(RS(ti, t)[1], RS(ti, t)[2]).map((a, k) => Object.assign(mkP(a, t, k, col), { rid: 5 + k })) : [];
  });
  ROST[0] = P.filter((p) => p.tm === 0);
  ROST[1] = P.filter((p) => p.tm === 1);
  resetRules();
  PC = [RS(i, 0)[0], RS(j, 1)[0]];
  cl = [RS(i, 0)[2], RS(j, 1)[2]];
  sc = [0, 0];
  tf = [0, 0];
  ftq = null;
  inb = 0;
  q = 1;
  clock = QTRLEN;
  fin = 0;
  rs = 0;
  RPL = null;
  RQ = 0;
  recClear();
  HL.length = 0;
  B = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, owner: null, mode: "held", sh: 0, sc: 0, last: null, age: 0, to: null, three: 0, a: 0 };
  CT.forEach((c, k) => {
    c.fixed = !!cfg.MYM && k === 0 && c.tm === 0;
    c.idx = c.tm * NP;
    c.lastO = null;
  });
  setup(0);
  S = "play";
  if (cfg.JB !== 0) beginJB();
  snd(500, 0.2, "square");
  return j;
}
// ---- opening tip: centers dap, the ball goes up, a timed jump (shoot button / AI) wins the tip to a teammate ----
export let JB: any = null;
const tallest = (t: number) => P.filter((p) => p.tm === t).sort((a, b) => b.ht + b.j / 200 - (a.ht + a.j / 200))[0];
function beginJB() {
  const c0 = tallest(0),
    c1 = tallest(1);
  let a = 0,
    b2 = 0;
  for (const p of P) {
    p.vx = p.vy = p.z = p.vz = 0;
    p.mode = "i";
    if (p === c0) (p.x = 461), (p.y = 250), (p.f = 0);
    else if (p === c1) (p.x = 479), (p.y = 250), (p.f = Math.PI);
    else {
      const k = p.tm ? b2++ : a++,
        ang = (p.tm ? 0 : Math.PI) + (k - 1.5) * 0.75;
      p.x = 470 + Math.cos(ang) * 82;
      p.y = 250 + Math.sin(ang) * 82;
      p.f = Math.atan2(250 - p.y, 470 - p.x);
    }
  }
  for (const c of [c0, c1]) (c.cel = 9), (c.celT = CEL_T); // dap before the tip
  B.owner = null;
  B.mode = "air";
  B.sh = 0;
  B.last = null;
  B.x = 470;
  B.y = 250;
  B.z = 62;
  B.vx = B.vy = B.vz = 0;
  inb = 0;
  const aiT = (c: Player) => 0.3 + ((Math.random() - 0.5) * 0.24) / cpuK(c, [0.6, 0.85, 1, 1.25]);
  JB = { t: 0, c: [c0, c1], jt: [-1, -1], ai: [aiT(c0), aiT(c1)] };
  txt("JUMP BALL", 480, 200, "#ffd23f");
}
const TOSS = 1.7;
function jbStep(dt: number) {
  const J = JB;
  J.t += dt;
  const tt = J.t - TOSS;
  if (tt >= 0) {
    B.z = Math.max(62, 62 + 230 * tt - 160 * tt * tt);
    B.vz = 230 - 320 * tt;
  }
  for (let s = 0; s < 2; s++) {
    const c = J.c[s],
      hc = CT.find((k) => k.tm === s);
    const wants = hc ? !!hc.inp.sd : tt >= J.ai[s];
    if (wants && tt > -0.3 && J.jt[s] < 0 && c.z <= 0) {
      J.jt[s] = tt;
      c.vz = 126 + c.j * 0.9;
    }
    if (c.z > 0 || c.vz > 0) {
      c.vz -= g * dt;
      c.z = Math.max(0, c.z + c.vz * dt);
      if (c.z <= 0) c.vz = 0;
    }
  }
  if (tt >= 0.86) {
    // the ball comes down through the centers' reach: highest hand wins
    const reach = (s: number) => J.c[s].ht * 13.3 + J.c[s].z + Math.random() * 6;
    const w = reach(0) >= reach(1) ? 0 : 1,
      win = J.c[w],
      mates = P.filter((p) => p.tm === win.tm && p !== win).sort((a, b) => Math.abs(a.x - (win.tm ? 520 : 420)) - Math.abs(b.x - (win.tm ? 520 : 420)));
    const mate = mates[0] || win,
      fl = 0.55;
    B.mode = mate === win ? "air" : "pass";
    B.to = mate === win ? null : mate;
    B.ptype = 0;
    B.last = win;
    B.age = 0;
    B.vx = (mate.x - B.x) / fl;
    B.vy = (mate.y - B.y) / fl;
    B.vz = (52 - B.z + 0.5 * g * fl * fl) / fl;
    B.wv = [0, 0, 0];
    pos = win.tm;
    shot = 24;
    txtW("TIP WON", win.x, win.y, 120, "#ffd23f");
    JB = null;
  }
}
// ================= gameplay pack: badges, hot zones, rotations, timeouts, momentum, violations, challenges =================
function mkP(a: Tuple, t: number, k: number, col: string): Player {
  return {
    n: a[0], c: a[1], i: a[2], s: a[3], d: a[4], j: a[5], st: a[6], tm: t, k, col,
    skin: a[7], x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, f: 0, ph: 0, mode: "i", t: 0, cd: 0, rl: 0, mt: 0,
    ai: {}, in: { dx: 0, dy: 0 },
    stt: { pts: 0, reb: 0, ast: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, blk: 0, orb: 0, chg: 0, dv: 0, sa: 0, min: 0 },
    my: a === MYP.t, sg: formOf(a[0]), slow: 0, sbw: 0, sv: 0, tp: null, pf: 0, bn: 1, bx: 0, by: 0,
    hr: a[8], bd: a[9], ht: a[10], bk: a[11], no: a[12], en: 1, hzm: [0, 0, 0, 0, 0, 0], cold: 0,
  };
}
const RNAME = ["Okafor", "Lindqvist", "Brannon", "Delacroix", "Mwangi", "Petrakis", "Holloway", "Sato", "Ferreira", "Quist", "Abernathy", "Vukovic", "Castellanos", "Nkemelu", "Harlan", "Iwu", "Renner", "Toussaint", "Beaumont", "Kowal", "Adeyemi"];
/** Three fictional reserves per team: a guard, a wing and a big, ~6 points below the starters they back up. */
function reserves(st: Tuple[], tn: string): Tuple[] {
  let h = 7;
  for (const ch of tn) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const r = () => ((h = (h * 1103515245 + 12345) >>> 0) / 4294967296);
  return [0, 2, 4].map((k, n) => {
    const a = st[k],
      m = (v: number) => Math.round(clamp(v - 4 - r() * 6, 30, 90));
    return [RNAME[(h + n * 7) % RNAME.length], m(a[1]), m(a[2]), m(a[3]), m(a[4]), m(a[5]), [0, 1, 4][n], ["#8d5524", "#c68642", "#6b4226", "#f1c27d"][(h >> 3) % 4], 1 + ((h >> 5) % 3), (h >> 7) % 2, a[10] + (r() - 0.5) * 0.2, a[11], [2, 9, 31][n] + ((h >> 9) % 5)] as Tuple;
  });
}
/** Bench players (not on the floor) and everyone who played (box score), per team. */
export const BENCH: Player[][] = [[], []],
  ROST: Player[][] = [[], []];
/** Badges from ratings: DR deep range, PZ posterizer, AB ankle breaker, LD lockdown, CL clutch, GC glass cleaner. */
export const BADGE: Record<string, [string, (p: Player) => boolean]> = {
  DR: ["Deep Range", (p) => p.c >= 88],
  PZ: ["Posterizer", (p) => p.j >= 72 && p.i >= 82],
  AB: ["Ankle Breaker", (p) => p.s >= 84],
  LD: ["Lockdown", (p) => p.d >= 86],
  CL: ["Clutch", (p) => (OV[p.n] || 0) >= 88 || (p.c + p.i) / 2 >= 85],
  GC: ["Glass Cleaner", (p) => p.ht >= 6.9 && (p.i >= 80 || p.d >= 85)],
};
export const hasB = (p: Player, b: string) => !!cfg.BADGES && !!p && BADGE[b][1](p);
export const badgesOf = (p: Player) => Object.keys(BADGE).filter((b) => BADGE[b][1](p));
/** Shot zone: 0 paint, 1 mid left, 2 mid right, 3 three left wing/corner, 4 three top, 5 three right. */
export function zoneOf(p: Player, D0: number) {
  const s = (p.y - HY) * (p.tm ? 1 : -1); // shooter's left is negative
  if (D0 < 90) return 0;
  if (D0 < 237) return s < 0 ? 1 : 2;
  return Math.abs(p.y - HY) < 90 ? 4 : s < 0 ? 3 : 5;
}
export const ZN = ["PAINT", "LEFT ELBOW", "RIGHT ELBOW", "LEFT WING", "TOP OF THE KEY", "RIGHT WING"];
export const clutchTime = () => q >= 4 && clock <= Math.max(12, QTRLEN * 0.4) && Math.abs(sc[0] - sc[1]) <= 5;
/** Team state: timeouts left, defense setting, play call, challenge used, current scoring run, momentum (-1..1, + = team 0). */
export const TS = {
  to: [4, 4],
  ds: [0, 0], // 0 normal, 1 sag / protect paint, 2 tight / deny, 3 switch everything, 4 2-3 zone (5v5)
  pc: [0, 0], // 0 auto, 1 pick-and-roll, 2 pindown, 3 flare, 4 isolation
  chal: [1, 1],
  run: [0, 0] as number[], // [team, points] of the current unanswered run
  mom: 0,
  clutch: 0,
  half: 0,
  lane: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] as number[], // seconds in the paint per slot
  bc: 0, // seconds the ball has been in the backcourt this possession
  call: null as any, // last whistle that can be challenged {t: team that can challenge, d, o, n, until, p}
  gt: 0,
  mu: [null, null] as (number[] | null)[], // matchups per team (defender slot -> opponent slot)
  adv: -1, // team whose next inbound is advanced to the frontcourt (late timeout)
  qs: [] as number[][], // cumulative score at the end of each quarter
  // scouting (adaptive AI): per team, decayed shot attempts / makes / contest by range [rim, mid, three]
  sk: [scoutNew(), scoutNew()],
  gp: [0, 0], // game plan per team (GPN): what the CPU offense leans on after reading its own shooting
  gpT: [0, 0], // possessions since the last adjustment
  trT: [-99, -99], // when each team last got the ball live (defensive rebound, loose ball): transition window
  tr: [0, 0], // pushing in transition right now (handler attacks, wings run the lanes)
  fbA: [-1, -1], // the transition (trT) last announced
  xs: { paint: [0, 0], fb: [0, 0], sec: [0, 0] }, // broadcast splits per team
  orbP: [0, 0], // this possession had an offensive rebound (second chance)
  cov: [0, 0], // CPU pick-and-roll coverage: 0 drop (big sits in the paint), 1 hedge (big steps out at the handler)
  dbl: [-1, -1], // CPU double-teams this opponent (P index) when he has the ball: the hottest scorer on the floor
  hud: 0, // timeout huddle time left (players gather in front of their benches)
  // team play pack (v5.4)
  ato: [0, 0], // a CPU coach drew up a play in the timeout: the next set is his after-timeout (ATO) call
  l2: [0, 0], // team fouls in the last two (broadcast) minutes of this period (the second one is the bonus)
  bon: [0, 0], // in the bonus this period (announced once)
  box: [-1, -1], // box-and-one: the opponent (P index) the chaser follows (-1 = their top scorer)
  cls: [0, 0], // the closing lineup has been announced
  setN: [0, 0], // named sets run (commentary every few)
};
function scoutNew() {
  return { a: [0, 0, 0], m: [0, 0, 0], c: [0, 0, 0] };
}
export const GPN = ["BALANCED", "ATTACK THE PAINT", "MID-RANGE & POST", "LET IT FLY", "FEED THE HOT HAND"];
export const DSN = ["NORMAL", "SAG / PROTECT PAINT", "TIGHT / DENY", "SWITCH EVERYTHING", "2-3 ZONE", "BOX-AND-ONE"],
  PCN = ["AUTO", "PICK & ROLL", "PINDOWN", "FLARE", "ISOLATION", "HORNS", "SPAIN PICK & ROLL", "POST UP"],
  // CPU pick-and-roll coverages (TS.cov)
  COVN = ["DROP", "HEDGE", "ICE", "BLITZ"];
function resetRules() {
  TS.to = [4, 4];
  TS.ds = [0, 0];
  TS.pc = [0, 0];
  TS.chal = [1, 1];
  TS.run = [0, 0];
  TS.mom = 0;
  TS.clutch = 0;
  TS.half = 0;
  TS.lane.fill(0);
  TS.bc = 0;
  TS.call = null;
  TS.gt = 0;
  TS.qs = [];
  TS.adv = -1;
  TS.hud = 0;
  TS.mu = [null, null];
  TS.sk = [scoutNew(), scoutNew()];
  TS.gp = [0, 0];
  TS.gpT = [0, 0];
  TS.trT = [-99, -99];
  TS.tr = [0, 0];
  TS.cov = [0, 0];
  TS.dbl = [-1, -1];
  TS.xs = { paint: [0, 0], fb: [0, 0], sec: [0, 0] };
  TS.orbP = [0, 0];
  TS.ato = [0, 0];
  TS.l2 = [0, 0];
  TS.bon = [0, 0];
  TS.box = [-1, -1];
  TS.cls = [0, 0];
  TS.setN = [0, 0];
  for (let t = 0; t < 2; t++) if (!CT.some((c) => c.tm === t)) TS.mu[t] = autoMatch(t);
}
/** Commentary hook (client turns these into captions + optional voice) and broadcast banners. */
export const cm = (e: string, n?: string, n2?: string) => fx({ k: "cm", e, n, n2 });
export const ban = (s: string, sub = "", c = "#ffd23f") => fx({ k: "ban", s, sub, c });
/** Shot-window multiplier from badges, hot zones, rhythm, streaks, momentum and clutch. Shared with the HUD meter. */
export function winMul(p: Player, D0: number, note?: string[]) {
  if (!cfg.BADGES || cfg.ONLINE) return 1;
  if (ftq) {
    // the road team at the line in crunch time hears it from the whole building
    if (TS.clutch && p.tm === 1 && cfg.GM === "game") {
      if (note) note.push("ROAD NERVES");
      return 0.85;
    }
    return 1;
  }
  let m = 1;
  const add = (k: number, s: string) => {
    m *= k;
    if (note) note.push(s);
  };
  if (D0 > 265 && !hasB(p, "DR") && (p.heat || 0) < 3) add(0.88, "DEEP");
  if (D0 > 265 && hasB(p, "DR")) add(1.08, "DEEP RANGE");
  if (p.hzm && (p.hzm[zoneOf(p, D0)] || 0) >= 2) add(1.12, "HOT ZONE");
  if ((p.mvEnd != null && T - p.mvEnd < 0.45) || p.sbw > 0.4) add(1.1, "RHYTHM");
  if (cfg.PP >= 2 && p.sqn && (p.mode === "c" || p.mode === "s")) add(p.sq, SQN[p.sqn]); // (Pro Play v2: balance at the gather)
  if ((p.cold || 0) >= 3) add(0.9, "COLD");
  if (clutchTime() && hasB(p, "CL")) add(1.15, "CLUTCH");
  const mo = p.tm ? -TS.mom : TS.mom;
  if (mo > 0.5) add(1.05, "MOMENTUM");
  if (TS.clutch && p.tm === 0 && cfg.GM === "game") add(1.05, "HOME CROWD");
  return m;
}
/** The green-window factor of a contest (0..1): open = the full window, a light contest (.3) -30%, heavy / smothered
 *  (.75+) -75%. (Was 1 - .45 c: players didn't feel it.) */
export const cwin = (cx: number) => Math.max(0.25, 1 - cx);
/** The contest a human's window uses: measured live while he charges the shot (contestOf + body contact), locked at the
 *  release (p.cw, lag-compensated online). Launch, the HUD meter (and Unity Hud.cs) and the auto-release all read it. */
export function shotContest(p: Player) {
  return p.mode === "s" && p.cw != null ? p.cw : Math.min(1, contestOf(p)[0] + (p.bmp || 0) * 0.5);
}
/** The green window (s; x1.2 with tempo) from the shot rating, the contest, fatigue and winMul's factor wm0. The one
 *  formula launch and the meter share, so what the meter shows is what the release is judged on. */
export function greenWin(p: Player, rat: number, cx: number, wm0: number) {
  return (0.07 + (rat / 100) * 0.05) * cwin(cx) * (0.85 + 0.15 * (p.en == null ? 1 : p.en)) * wm0;
}
/** Make/miss bookkeeping for hot zones and cold streaks. */
function zoneRes(p: Player, D0: number, made: boolean) {
  if (!p || !p.hzm || D0 == null) return;
  scout(p, D0, made, B.cx ?? 0);
  if (B.kk) (STAT.kA = (STAT.kA || 0) + 1), made && (STAT.kM = (STAT.kM || 0) + 1);
  if (B.lx != null && !PREDICT && SHOTS.length < 400) SHOTS.push({ t: p.tm, x: B.lx, y: B.ly, m: made ? 1 : 0, th: D0 >= 237 ? 1 : 0, q });
  if (B.kk && made && D0 >= 237 && Math.random() < 0.5) cm("kick", p.n);
  const z = zoneOf(p, D0);
  if (made) {
    p.hzm[z] = Math.min(4, (p.hzm[z] || 0) + 1);
    if (p.hzm[z] === 2 && isH(p) && cfg.BADGES) txtW("HOT ZONE: " + ZN[z], p.x, p.y, 135, "#ff9a2e");
    p.cold = 0;
  } else {
    p.hzm[z] = Math.max(0, (p.hzm[z] || 0) - 1);
    p.cold = (p.cold || 0) + 1;
    if (p.cold === 3 && cfg.BADGES) (txtW("ICE COLD", p.x, p.y, 120, "#7fd4ff"), cm("cold", p.n));
  }
}
/** Scouting: every field goal feeds a decayed record per range (0 rim, 1 mid, 2 three) for the shooter (~last 6
 *  shots) and his team (~last 14). The CPU reads it: a cold or smothered shooter changes his diet, a team that can't
 *  hit from deep changes its whole offense (gamePlan). */
const rngOf = (D0: number) => (D0 < 90 ? 0 : D0 < 237 ? 1 : 2);
export function scout(p: Player, D0: number, made: boolean, cx: number) {
  const r = rngOf(D0),
    s = p.sk || (p.sk = scoutNew()),
    k = TS.sk[p.tm];
  if (!k) return;
  for (let w = 0; w < 2; w++) {
    const o = w ? k : s,
      dec = w ? 0.93 : 0.84;
    for (let j = 0; j < 3; j++) (o.a[j] *= dec), (o.m[j] *= dec), (o.c[j] *= dec);
    o.a[r] += 1;
    o.m[r] += made ? 1 : 0;
    o.c[r] += cx;
  }
}
/** Expected points per shot from a range, shrunk toward a league prior (so 1-for-1 doesn't change anything). */
const PRI = [1.25, 0.84, 1.08];
export function pps(o: any, r: number) {
  const n = o.a[r],
    w = n / (n + 4);
  return w * ((o.m[r] / (n || 1)) * (r === 2 ? 3 : 2)) + (1 - w) * PRI[r];
}
/** How a player is doing from a range lately (pct -1 = not enough shots) and how tight his looks have been. */
export function form(p: Player, r: number) {
  const s = p.sk;
  if (!s || s.a[r] < 1.5) return { pct: -1, ct: 0, n: s ? s.a[r] : 0 };
  return { pct: s.m[r] / s.a[r], ct: s.c[r] / s.a[r], n: s.a[r] };
}
const hotNow = (q: Player) => (q.heat || 0) >= 3 || (q.hzm && Math.max(...q.hzm) >= 3);
/** CPU coaching: re-read the team's shooting every few possessions and pick a game plan; defensively, take away what
 *  the other team is living on. Human teams keep their own calls (their defense/plays come from the pause menu). */
export function gamePlan(t: number) {
  if (CT.some((c) => c.tm === t) || cfg.NP < 2 || !gameLike() || cfg.ASTAR) return;
  const lv = cpuIQ(t);
  if (++TS.gpT[t] < 6 - lv) return; // (smarter coaches re-read the game sooner: every 6 .. 3 possessions)
  // defense reads the other side's sheet: they live at the rim -> sag; they're raining threes -> run them off the line
  const o = TS.sk[1 - t],
    rimHot = pps(o, 0) > 1.35 && o.a[0] >= 4,
    bx = lv >= 2 ? boxTarget(t) : -1,
    // they live at the rim and can't shoot it: pack the paint with a zone (5v5), or at least sag; one shooter on fire
    // and nobody else hurting them: box-and-one (the best defender chases him, four in a box)
    ds = bx >= 0 ? 5 : pps(o, 2) > 1.2 && o.a[2] >= 4 ? 2 : rimHot ? (cfg.NP === 5 && pps(o, 2) < 1.0 ? 4 : 1) : TS.ds[t] === 3 ? 3 : 0;
  TS.box[t] = bx;
  if (ds !== TS.ds[t]) {
    TS.ds[t] = ds;
    if (ds === 4) ban("2-3 ZONE", cl[t].toUpperCase() + " PACK THE PAINT", PC[t]), cm("zone", cl[t]);
    else if (ds === 5) ban("BOX-AND-ONE", cl[t].toUpperCase() + " CHASE " + P[bx].n.toUpperCase(), PC[t]), cm("boxone", cl[t], P[bx].n), (STAT.boxone = (STAT.boxone || 0) + 1);
    else if (ds) txt(cl[t].toUpperCase() + " DEFENSE: " + DSN[ds], 480, 170, "#9fe7ff");
  }
  // pick-and-roll coverage: hedge out on a handler who punishes a big sitting back (a pull-up shooter, or their pull-ups
  // are falling), otherwise drop and protect the rim; smarter coaches blitz a star who is cooking (trap him, make
  // somebody else beat them) and ICE a team that lives at the rim (force the handler away from the screen, baseline)
  {
    const st = starOf(1 - t);
    let cov = (st && st.c >= 86) || (pps(o, 1) > 1.0 && o.a[1] >= 4) ? 1 : 0;
    if (lv >= 2 && cov === 1 && st && hotNow(st)) cov = 3;
    else if (lv >= 1 && cov === 0 && rimHot) cov = 2;
    if (lv === 0) cov = 0; // (a rookie coach drops every time)
    if (!cfg.TP) cov = cov === 1 || cov === 3 ? 1 : 0;
    if (cov !== TS.cov[t]) {
      TS.cov[t] = cov;
      txt(cl[t].toUpperCase() + (cov === 1 ? " HEDGE THE PICK-AND-ROLL" : cov === 2 ? " ICE THE PICK-AND-ROLL" : cov === 3 ? " BLITZ THE PICK-AND-ROLL" : " DROP ON THE PICK-AND-ROLL"), 480, 150, "#9fe7ff");
      if (cov >= 2) cm(cov === 2 ? "ice" : "blitz", cl[t], st ? st.n : "");
    }
  }
  // a scorer who is on fire gets doubled when he catches it (and the double comes off when he cools down)
  {
    let hi = -1,
      hv = 0;
    for (let j = 0; j < cfg.NP; j++) {
      const q = P[(1 - t) * cfg.NP + j],
        v = (q.heat || 0) >= 3 ? 10 + q.stt.pts / 4 : 0;
      if (v > hv) (hv = v), (hi = (1 - t) * cfg.NP + j);
    }
    if (cfg.NP < 3 || cfg.ASTAR || lv === 0 || TS.ds[t] === 5) hi = -1; // (no doubles from a rookie coach / in the box-and-one)
    if (hi !== TS.dbl[t]) {
      TS.dbl[t] = hi;
      if (hi >= 0) ban("DOUBLE TEAM", cl[t].toUpperCase() + " SEND TWO AT " + P[hi].n.toUpperCase(), PC[t]), cm("double", cl[t], P[hi].n);
    }
  }
  // somebody on the other side is cooking: the best defender takes the assignment
  const mu = TS.mu[t],
    NP = cfg.NP;
  if (mu) {
    let hs = -1,
      hv = 0;
    for (let j = 0; j < NP; j++) {
      const q = P[(1 - t) * NP + j],
        v = (q.heat || 0) + (q.hzm ? Math.max(...q.hzm) : 0) * 0.5;
      if (v >= 3 && v > hv) (hv = v), (hs = j);
    }
    if (hs >= 0) {
      let bd = 0;
      for (let j = 1; j < NP; j++) if (P[t * NP + j].d > P[t * NP + bd].d) bd = j;
      const cur = mu.indexOf(hs);
      if (cur >= 0 && cur !== bd && P[t * NP + bd].d > P[t * NP + cur].d + 3) {
        (mu[cur] = mu[bd]), (mu[bd] = hs);
        txt(P[t * NP + bd].n.toUpperCase() + " PICKS UP " + P[(1 - t) * NP + hs].n.toUpperCase(), 480, 190, "#9fe7ff");
        cm("assign", P[t * NP + bd].n, P[(1 - t) * NP + hs].n);
      }
    }
  }
  const k = TS.sk[t],
    n = k.a[0] + k.a[1] + k.a[2];
  if (n < 6) return;
  const e = [pps(k, 0), pps(k, 1), pps(k, 2)],
    old = TS.gp[t];
  let gp = 0;
  if (P.some((q) => q.tm === t && !q.off && (q.heat || 0) >= 3)) gp = 4;
  else if (e[2] < 0.85 && k.a[2] >= 4) gp = e[0] >= e[1] + 0.15 ? 1 : 2; // bricking from deep: get to the paint / the elbows
  else if (e[0] < 0.95 && k.a[0] >= 4) gp = e[2] >= 1.0 ? 3 : 2; // walled off at the rim: shoot over them
  else if (e[2] > 1.25 && k.a[2] >= 4) gp = 3; // it's falling: keep firing
  if (gp !== old && (gp || TS.gpT[t] >= 8)) {
    TS.gp[t] = gp;
    TS.gpT[t] = 0;
    // a play call to match (pick-and-roll gets to the rim, pindowns free the mid-range, flares free shooters)
    TS.pc[t] = gp === 1 ? 1 : gp === 2 ? 2 : gp === 3 ? 3 : gp === 4 ? 4 : 0;
    STAT["gp" + gp] = (STAT["gp" + gp] || 0) + 1;
    if (gp) {
      ban("ADJUSTMENT", cl[t].toUpperCase() + ": " + GPN[gp], PC[t]);
      cm("adjust", cl[t], GPN[gp].toLowerCase());
    }
  }
}
/** Halftime: every CPU coach re-reads the first half (no waiting for the usual few possessions). Returns what each
 *  CPU team changed (for the halftime screen); idempotent per half. */
let halfAdj = -1;
export function halftimeAdjust() {
  const out: string[] = [];
  if (halfAdj === T) return out;
  halfAdj = T;
  for (let t = 0; t < 2; t++) {
    if (CT.some((c) => c.tm === t)) continue;
    const g0 = TS.gp[t];
    TS.gpT[t] = 99;
    gamePlan(t);
    const k = TS.sk[t],
      e3 = pps(k, 2),
      e0 = pps(k, 0);
    out.push(cl[t] + ": " + (TS.gp[t] !== g0 ? "new game plan — " : "sticking with ") + GPN[TS.gp[t]].toLowerCase() + (TS.ds[t] ? ", " + DSN[TS.ds[t]].toLowerCase() + " on D" : "") + (k.a[2] >= 3 ? ` (${e3.toFixed(2)} pts/shot from three, ${e0.toFixed(2)} at the rim)` : ""));
  }
  return out;
}
/** Scoring runs drive momentum (crowd, small shot bonus) and AI timeouts. */
function runAdd(t: number, pts: number) {
  if (TS.run[0] === t) TS.run[1] += pts;
  else TS.run = [t, pts];
  TS.mom = clamp(TS.mom + (t ? -1 : 1) * pts * 0.06, -1, 1);
  const r = TS.run[1];
  if (r >= 8 && r - pts < 8) (ban(r + "-0 RUN", cl[t].toUpperCase(), PC[t]), cm("run", cl[t]), exc(1));
  else if (r >= 12 && r - pts < 12) (ban(r + "-0 RUN", cl[t].toUpperCase() + " CAN'T MISS", PC[t]), exc(1));
}
/** Timeout: stops play, everybody gets a breather, the hot shooter on the other side cools off, momentum resets. */
export function callTO(t: number, why = "") {
  if (TS.to[t] <= 0 || ftq || JB || S !== "play" || RPL) return false;
  const dead = rs > 0;
  if (!dead && !(B.owner && B.owner.tm === t)) return false; // only with the ball or at a dead ball
  TS.to[t]--;
  ban("TIMEOUT", cl[t].toUpperCase() + (why ? " · " + why : "") + " · " + TS.to[t] + " LEFT", PC[t]);
  cm("timeout", cl[t]);
  for (const p of P) p.en = Math.min(1, (p.en ?? 1) + 0.35);
  for (const p of P) if (p.tm !== t && (p.heat || 0) > 1) p.heat = 1;
  TS.mom *= 0.3;
  TS.run = [t, 0];
  if (!dead) pend = t;
  rs = 3.2;
  TS.hud = 3.2; // both teams huddle in front of their benches (deadBall)
  if (!CT.some((c) => c.tm === t) && cpuIQ(t) >= 1 && cfg.NP >= 3) TS.ato[t] = 1; // the coach draws up a play (ATO)
  RQ = 0;
  if (q >= 4 && bcast() < 120 && pend === t && cfg.NP > 1) {
    TS.adv = t;
    txt("BALL ADVANCED TO THE FRONTCOURT", 480, 250, "#9fe7ff");
  }
  return true;
}
/** Coach's challenge on the last foul against your team (one per game). Overturned if the contact was marginal. */
export function challenge(t: number) {
  const c = TS.call;
  if (!c || c.t !== t || T > c.until || TS.chal[t] <= 0) return false;
  TS.chal[t]--;
  TS.call = null;
  const ok = Math.random() > c.p;
  ban("COACH'S CHALLENGE", ok ? "CALL OVERTURNED" : "CALL STANDS — TIMEOUT LOST", ok ? "#2ecc71" : "#ff6b4a");
  cm(ok ? "chalWin" : "chalLose", cl[t]);
  if (ok) {
    if (c.d) (c.d.pf = Math.max(0, c.d.pf - 1)), (tf[c.d.tm] = Math.max(0, tf[c.d.tm] - 1));
    ftq = null;
    B.sh = 0;
    setup(t);
  } else TS.to[t] = Math.max(0, TS.to[t] - 1);
  return true;
}
/** Whistle bookkeeping: personal-foul limit, challengeable call. p = chance the call was correct. */
function whistle(d: Player, o: Player | null, p: number) {
  if (CT.some((c) => c.tm === d.tm)) TS.call = { t: d.tm, d, o, until: T + 4, p };
  if (cfg.SUBS && cfg.NP > 1 && d.pf >= 6 && !d.fo) {
    d.fo = 1;
    ban("FOULED OUT", d.n.toUpperCase() + " · 6 FOULS", "#ff6b4a");
    cm("foulout", d.n);
  }
}
/** Substitutions at dead balls (5v5): tired or fouled-out players go to the bench, rested ones come back. Rotation
 *  rules (v5.4): foul trouble sits a player until the next quarter (2 fouls in the 1st, 3 in the 2nd, 4 in the 3rd, 5
 *  in the 4th); the starters close (clutch time / overtime: they come back in for the reserves); garbage time (4th
 *  quarter, last 4 broadcast minutes, 20+ points) empties the bench. */
const ftrb = (p: Player) => !p.fo && q <= 4 && (p.pf || 0) >= q + 1; // in foul trouble for this quarter
function subs() {
  if (!cfg.SUBS || cfg.NP < 2 || PREDICT || !BENCH[0]) return; // (online too: the host publishes the lineup, guests follow)
  const close = TS.clutch > 0 || q > 4,
    blow = q >= 4 && bcast() < 240 && Math.abs(sc[0] - sc[1]) >= 20 && gameLike() && !cfg.ASTAR;
  for (let t = 0; t < 2; t++) {
    const bn = BENCH[t];
    if (!bn.length) continue;
    for (let k = 0; k < cfg.NP; k++) {
      const idx = t * cfg.NP + k,
        p = P[idx];
      if (p.my || CT.some((c) => c.fixed && c.idx === idx)) continue;
      const fresh = T - (p.inAt || 0) < 25; // nobody gets yanked right after checking in
      const tired = ((p.en ?? 1) < (close ? 0.3 : 0.5) && !fresh) || p.fo,
        st = (p.rid ?? 0) < 5, // a starter
        ftr = !close && st && ftrb(p),
        garb = blow && st;
      if (!tired && !ftr && !garb) {
        if (close && !st) {
          // closing time: a reserve on the floor makes way for a starter who can still go
          let c0: Player | null = null;
          for (const b of bn) if ((b.rid ?? 0) < 5 && !b.fo && (b.en ?? 1) > 0.35 && (!c0 || Math.abs(b.ht - p.ht) < Math.abs(c0.ht - p.ht))) c0 = b;
          if (c0) {
            swap(t, k, c0);
            STAT.closer = (STAT.closer || 0) + 1;
            if (!TS.cls[t]) (TS.cls[t] = 1), cm("closers", cl[t]);
          }
          continue;
        }
        // a rested starter checks back in for his sub (not while he is in foul trouble or the game is out of reach)
        if (p.sub && !p.fo && !blow) {
          const s0 = bn.find((b) => b === p.sub && (b.en ?? 1) > 0.85 && !b.fo && !(!close && ftrb(b)));
          if (s0 && ((p.en ?? 1) < 0.8 || s0.ftS) && !fresh) (s0.ftS = 0), swap(t, k, s0);
        }
        continue;
      }
      let best: Player | null = null;
      for (const b of bn) if (!b.fo && (b.en ?? 1) > (ftr || garb ? 0.45 : 0.7) && !(ftr && ftrb(b)) && !(garb && (b.rid ?? 0) < 5) && (!best || Math.abs(b.ht - p.ht) < Math.abs(best.ht - p.ht))) best = b;
      if (best) {
        swap(t, k, best);
        if (ftr) (p.ftS = 1), (STAT.ftrSit = (STAT.ftrSit || 0) + 1), cm("foultrouble", p.n);
        if (garb) STAT.garbage = (STAT.garbage || 0) + 1;
      }
    }
  }
}
function swap(t: number, k: number, inP: Player) {
  const idx = t * cfg.NP + k,
    out = P[idx],
    bn = BENCH[t];
  bn.splice(bn.indexOf(inP), 1);
  bn.push(out);
  inP.k = k;
  inP.sub = out;
  inP.inAt = T;
  inP.x = out.x;
  inP.y = out.y;
  inP.f = out.f;
  inP.mode = "i";
  inP.ai = {};
  P[idx] = inP;
  if (!ROST[t].includes(inP)) ROST[t].push(inP);
  PLAY[t] = PLAY[1 - t] = null;
  OFFS[0] = OFFS[1] = null;
  if (CT.some((c) => c.tm === t)) txt("SUB: " + inP.n + " in for " + out.n, 480, 260, "#9fe7ff");
  SUBV++;
}
/** Bumped on every substitution (the 3D renderer rebuilds rigs for changed slots). */
export let SUBV = 0;
/** Online: who is on the floor, per team and slot, as stable roster ids (the host publishes it). */
export const lineup = () => [0, 1].map((t) => P.filter((p) => p.tm === t).map((p) => p.rid ?? p.k));
/** Online guest: make the floor match the host's lineup (the same swaps, from the same generated bench). */
export function applyLineup(U: number[][]) {
  if (!Array.isArray(U)) return;
  const NP = cfg.NP;
  for (let t = 0; t < 2; t++)
    for (let k = 0; k < NP; k++) {
      const want = U[t] && U[t][k],
        cur = P[t * NP + k];
      if (want == null || !cur || (cur.rid ?? cur.k) === want) continue;
      const q = BENCH[t].find((b) => b.rid === want);
      if (q) swap(t, k, q);
    }
}
/** Rule ticks during live play: fatigue on the bench, paint/backcourt counts, momentum decay, clutch time, AI timeouts. */
function rulesTick(dt: number) {
  for (let t = 0; t < 2; t++) for (const b of BENCH[t]) b.en = Math.min(1, (b.en ?? 1) + dt * 0.03);
  for (const p of P) p.stt.min += dt;
  TS.mom *= 1 - dt * 0.01;
  if (!TS.clutch && clutchTime()) {
    TS.clutch = 1;
    ban("CLUTCH TIME", "UNDER " + Math.ceil(clock) + " SECONDS · " + Math.abs(sc[0] - sc[1]) + "-POINT GAME", "#ff5a5a");
    cm("clutch");
    exc(1);
  }
  // CPU timeout to stop an 8-0 run (or in clutch time to draw up a play)
  for (let t = 0; t < 2; t++)
    if (!CT.some((c) => c.tm === t) && TS.to[t] > 0 && B.owner && B.owner.tm === t && inb > 0 && ((TS.run[0] !== t && TS.run[1] >= 8) || (TS.clutch === 1 && sc[t] < sc[1 - t] && clock < 15))) {
      if (TS.clutch === 1) TS.clutch = 2;
      callTO(t, TS.run[1] >= 8 ? "STOP THE RUN" : "DRAW IT UP");
    }
  {
    const o = B.owner,
      dt2 = o ? 1 - o.tm : -1;
    if (o && cfg.FOULS && !ftq && inb <= 0 && rs <= 0 && q >= 4 && bcast() < 40 && fc <= 0 && !CT.some((c) => c.tm === dt2) && sc[o.tm] - sc[dt2] >= 3 && sc[o.tm] - sc[dt2] <= 8 && o.mode === "i") {
      // down two possessions with the clock running out: foul to stop it
      const d = P.find((p) => p.tm === dt2 && Math.hypot(p.x - o.x, p.y - o.y) < 26);
      if (d && Math.random() < dt * 2) {
        fc = 2;
        tf[dt2] = Math.max(tf[dt2], 4); // in the bonus late: shooting two
        cm("intfoul", d.n, o.n);
        foul(d, o, "INTENTIONAL", 0, 0);
        return;
      }
    }
    // up three in the last seconds: foul before he can get a tying three off (two free throws can't tie it)
    if (o && cfg.FOULS && !ftq && inb <= 0 && rs <= 0 && q >= 4 && bcast() < 7 && fc <= 0 && !CT.some((c) => c.tm === dt2) && sc[dt2] - sc[o.tm] === 3 && o.mode === "i" && Math.hypot(hoop(o.tm) - o.x, HY - o.y) > 200) {
      const d = P.find((p) => p.tm === dt2 && Math.hypot(p.x - o.x, p.y - o.y) < 28);
      if (d && Math.random() < dt * 4) {
        fc = 2;
        tf[dt2] = Math.max(tf[dt2], 4);
        cm("foulup3", d.n, o.n);
        foul(d, o, "INTENTIONAL", 0, 0);
        return;
      }
    }
  }
  if (!cfg.VIOL || cfg.HALF || ftq || inb > 0 || !B.owner || rs > 0) {
    TS.lane.fill(0); // a shot / loose ball / dead ball resets the count
    return;
  }
  const t = pos,
    hx = hoop(t),
    dir = hx > 470 ? -1 : 1,
    o = B.owner;
  // 8 seconds to get it across half court
  const back = dir < 0 ? o.x < 470 : o.x > 470;
  if (back) TS.bc += dt;
  else TS.bc = 99;
  if (TS.bc > 8 && TS.bc < 90) {
    TS.bc = 99;
    violation(t, "8-SECOND VIOLATION");
    return;
  }
  // 3 seconds in the lane (offense, while the ball is in the frontcourt; not in 1v1)
  if (cfg.NP > 1)
  for (const p of P) {
    const k = P.indexOf(p);
    if (p.tm !== t || back) {
      TS.lane[k] = 0;
      continue;
    }
    const inLane = Math.abs(p.x - hx) < 190 && Math.abs(p.y - HY) < 80 && p.z <= 0;
    const exempt = (p === o && (p.mode !== "i" || Math.hypot(p.vx, p.vy) > 90)) || p.mode === "s" || p.mode === "c";
    TS.lane[k] = inLane && !exempt ? TS.lane[k] + dt : inLane ? TS.lane[k] : 0;
    if (TS.lane[k] > 3.05) {
      TS.lane.fill(0);
      violation(t, "3 SECONDS", p);
      return;
    }
  }
}
function violation(t: number, s: string, p?: Player) {
  fx({ k: "whistle", tm: t });
  ban(s, (p ? p.n.toUpperCase() + " · " : "") + "TURNOVER", "#ff6b4a");
  cm("viol", p ? p.n : cl[t], s);
  snd(700, 0.3, "square", 0.08);
  setupAt(1 - t, B.x, B.y);
}
/** Inbound at the spot (violations): in the offense's frontcourt the ball comes in from the nearest line where it
 *  happened - a baseline out-of-bounds play (box set under the rim) or a sideline one (spread on the wings) - with
 *  the defense man-to-man goal-side and one defender up on the inbounder. Backcourt spots use the normal setup. */
export function setupAt(off: number, x: number, y: number) {
  setup(off);
  const NP = cfg.NP,
    ah = hoop(off);
  if (cfg.HALF || NP < 2 || !((x - 470) * (ah - 470) > 0)) return;
  const dir = ah > 470 ? -1 : 1, // from the hoop toward mid-court
    endX = ah > 470 ? 934 : 6,
    base = Math.abs(x - endX) < Math.min(y, 500 - y),
    ib = B.owner as Player;
  let ix: number, iy: number;
  if (base) (ix = endX), (iy = clamp(y, 40, 460)), Math.abs(iy - HY) < 45 && (iy = HY + (iy < HY ? -45 : 45));
  else (ix = clamp(x, Math.min(ah + dir * 60, 470), Math.max(ah + dir * 60, 470))), (iy = y < HY ? 4 : 496);
  const side = iy < HY ? -1 : 1,
    spots: number[][] = base
      ? [
          [ah + dir * 48, HY - 55],
          [ah + dir * 48, HY + 55],
          [ah + dir * 150, HY - 70],
          [ah + dir * 150, HY + 70],
        ]
      : [
          [ix + dir * 30, HY + side * 150],
          [ah + dir * 250, HY],
          [ah + dir * 70, HY + side * 60],
          [ah + dir * 20, HY - side * 210],
        ];
  (ib.x = ix), (ib.y = iy), (ib.f = Math.atan2(HY - iy, (base ? ah + dir * 120 : ix) - ix));
  let j = 0;
  for (const o of P)
    if (o.tm === off && o !== ib && !o.off) {
      const s = spots[j++ % spots.length];
      (o.x = s[0]), (o.y = s[1]), (o.f = Math.atan2(iy - o.y, ix - o.x));
    }
  for (const o of P)
    if (o.tm === off && !o.off) {
      const d = manOf(o);
      if (!d || d.off) continue;
      if (o === ib) {
        // up on the inbounder, a step inside the line, arms up
        const l = Math.hypot(ah + dir * 120 - ix, HY - iy) || 1;
        (d.x = ix + ((ah + dir * 120 - ix) / l) * 16), (d.y = iy + ((HY - iy) / l) * 16);
        d.hupT = 1.2;
      } else {
        const l = Math.hypot(ah - o.x, HY - o.y) || 1;
        (d.x = o.x + ((ah - o.x) / l) * 22), (d.y = o.y + ((HY - o.y) / l) * 22);
      }
      d.f = Math.atan2(o.y - d.y, o.x - d.x);
    }
  for (const p of P) (p.x = clamp(p.x, 4, CW - 4)), (p.y = clamp(p.y, 4, CH - 4));
  B.x = ib.x;
  B.y = ib.y;
  STAT.spotInb = (STAT.spotInb || 0) + 1;
  // the set's action while the inbounder counts: each player's target spot (see inbMove)
  INB.on = 1;
  INB.tm = off;
  INB.tg.clear();
  const others = P.filter((o) => o.tm === off && o !== ib && !o.off);
  others.forEach((o, k) => {
    const s = base
      ? // box: the low men pop to the corners, one high man dives to the rim, the other pops to the top
        [
          [ah + dir * 14, HY - 215],
          [ah + dir * 14, HY + 215],
          [ah + dir * 26, HY + (iy < HY ? -12 : 12)],
          [ah + dir * 250, HY],
        ][k % 4]
      : // sideline: the near man comes back to the ball, the top flashes to the elbow, the post seals, the corner holds
        [
          [ix + dir * 70, iy - side * 70],
          [ah + dir * 150, HY + side * 50],
          [ah + dir * 30, HY + side * 30],
          [ah + dir * 20, HY - side * 210],
        ][k % 4];
    INB.tg.set(o, [clamp(s[0], 10, CW - 10), clamp(s[1], 10, CH - 10)]);
  });
}
/** Spot-inbound action: offense runs to its set's spots while the inbounder counts; the defense trails a beat behind. */
const INB = { on: 0, tm: 0, tg: new Map<Player, number[]>() };
function inbMove(p: Player) {
  if (p.tm === INB.tm) {
    const s = INB.tg.get(p);
    if (s && inb < 1.0) mv(p, s[0], s[1], 1.15), (p.in.sp = 1);
  } else {
    const o = guardOf(p);
    if (!o || o === B.owner) return;
    const h = hoop(INB.tm),
      l = Math.hypot(h - o.x, HY - o.y) || 1;
    if (inb < 0.85) mv(p, o.x + ((h - o.x) / l) * 20, o.y + ((HY - o.y) / l) * 20, 0.9);
  }
}
/** Star tendencies (CPU): how often a player looks for a deep three, a mid-range pull-up, a drive or a post-up, how
 *  willing he is to pass, and how much he loves the step-back. Stars have their own; everyone else is derived. */
const TEND: Record<string, number[]> = {
  //               deep  mid  drive post pass step
  Curry: [0.5, 0.2, 0.15, 0, 0.35, 0.5],
  Doncic: [0.3, 0.2, 0.2, 0.2, 0.55, 0.7],
  Jokic: [0.1, 0.15, 0.05, 0.6, 0.9, 0.1],
  "Gilgeous-Alexander": [0.08, 0.55, 0.32, 0, 0.25, 0.3],
  Edwards: [0.22, 0.13, 0.62, 0, 0.18, 0.2],
  Brunson: [0.12, 0.48, 0.28, 0.12, 0.3, 0.3],
  Wembanyama: [0.25, 0.2, 0.15, 0.35, 0.25, 0.3],
  Towns: [0.35, 0.15, 0.1, 0.35, 0.25, 0.1],
  "LaMelo Ball": [0.42, 0.15, 0.3, 0, 0.6, 0.3],
  Fox: [0.12, 0.25, 0.6, 0, 0.35, 0.15],
  Murray: [0.3, 0.4, 0.2, 0, 0.35, 0.3],
  Antetokounmpo: [0.05, 0.1, 0.75, 0.2, 0.35, 0.05],
  Durant: [0.28, 0.48, 0.15, 0.15, 0.25, 0.25],
  Tatum: [0.35, 0.25, 0.3, 0.1, 0.35, 0.4],
  Mitchell: [0.35, 0.2, 0.42, 0, 0.3, 0.35],
  Irving: [0.3, 0.3, 0.35, 0, 0.3, 0.45],
  Cunningham: [0.18, 0.35, 0.38, 0.05, 0.5, 0.2],
  Banchero: [0.12, 0.25, 0.45, 0.2, 0.35, 0.15],
  Sengun: [0.05, 0.15, 0.1, 0.6, 0.6, 0.05],
};
export function tendOf(p: Player): number[] {
  const b = baseTend(p);
  if (cfg.ASTAR || !gameLike() || isH(p)) return b;
  // adapt: a cold or smothered shooter stops forcing threes - he takes the mid-range pull-up or puts it on the floor;
  // a hot one keeps firing; the team's game plan tilts everybody
  const o = TW;
  for (let j = 0; j < 6; j++) o[j] = b[j];
  const f3 = form(p, 2),
    fm = form(p, 1);
  let cut = 0;
  if ((p.cold || 0) >= 3) cut += 0.35;
  if (f3.pct >= 0 && f3.n >= 2.5 && f3.pct < 0.25) cut += 0.3;
  if (f3.pct >= 0 && f3.ct > 0.6) cut += 0.25; // every look has a hand in his face
  if (hotNow(p)) cut -= 0.4; // feeling it
  cut = clamp(cut, -0.4, 0.75);
  if (cut > 0) {
    const m = o[0] * cut,
      toMid = fm.pct >= 0 && fm.pct < 0.3 ? 0.25 : p.c + 6 >= p.i ? 0.6 : 0.35;
    o[0] -= m;
    o[1] += m * toMid;
    o[2] += m * (1 - toMid) * (p.i >= 70 ? 0.8 : 0.5);
    o[3] += m * (1 - toMid) * (p.i >= 70 ? 0.2 : 0);
    o[4] += 0.1 * cut; // and moves it more
    o[5] *= 1 - 0.5 * cut; // fewer step-back threes
  } else if (cut < 0) o[0] *= 1 - cut;
  if (fm.pct >= 0 && fm.n >= 2.5 && fm.pct < 0.25) (o[2] += o[1] * 0.4), (o[1] *= 0.6);
  // beating a zone: move it and shoot over it, don't drive into the packed paint
  if (TS.ds[1 - p.tm] === 4) (o[0] = o[0] * 1.3 + (p.c >= 72 ? 0.06 : 0)), (o[1] *= 1.2), (o[2] *= 0.6), (o[4] += 0.15);
  // the defense sags: shooters let it fly; the defense is up tight / denying: put it on the floor, go backdoor
  else if (TS.ds[1 - p.tm] === 1 && p.c >= 72) (o[0] *= 1.2), (o[2] *= 0.85);
  else if (TS.ds[1 - p.tm] === 2) (o[2] *= 1.3), (o[0] *= 0.85);
  switch (TS.gp[p.tm]) {
    case 1:
      (o[0] *= 0.55), (o[2] *= 1.5), (o[3] *= 1.4);
      break;
    case 2:
      (o[0] *= 0.6), (o[1] = o[1] * 1.6 + 0.08), (o[3] *= 1.5);
      break;
    case 3:
      (o[0] = o[0] * 1.35 + (p.c >= 78 ? 0.08 : 0)), (o[2] *= 0.8);
      break;
    case 4:
      o[4] = hotNow(p) ? o[4] * 0.4 : o[4] + 0.35;
  }
  return o;
}
const TW = [0, 0, 0, 0, 0, 0];
function baseTend(p: Player): number[] {
  const t = TEND[p.n];
  if (cfg.ASTAR) {
    // All-Star game: everybody wants the highlight dunk or the logo three
    const b = t || [0.2, 0.2, 0.3, 0.1, 0.4, 0.2];
    return [b[0] + 0.15, b[1] * 0.4, b[2] + 0.45, 0, b[4] + 0.2, b[5]];
  }
  if (t) return t;
  // (modern shot diet: capable shooters live behind the arc, the mid-range is a speciality - NBA ~42% of shots are threes)
  return [p.c >= 84 ? 0.5 : p.c >= 75 ? 0.38 : p.c >= 68 ? 0.16 : 0.03, p.c >= 75 ? 0.14 : 0.2, p.s >= 84 || p.i >= 86 ? 0.35 : 0.2, p.i >= 84 && p.ht >= 6.8 ? 0.3 : 0, 0.3, p.st === 1 || p.st === 3 ? 0.4 : 0.1];
}
/** Modes that play a real game (rules, AI, scoring) rather than a drill. */
export const gameLike = () => cfg.GM === "game" || cfg.GM === "clutch" || cfg.GM === "street" || cfg.GM === "king" || cfg.GM === "allstar" || cfg.GM === "daily";
/** Seconds left on the broadcast (12-minute) clock, whatever the real quarter length. */
export const bcast = () => (clock * 720) / QTRLEN;
/** Default matchups: which opponent slot each defender guards. Best defender on their best scorer, worst on their worst. */
export function autoMatch(t: number) {
  const NP = cfg.NP;
  if (NP < 2) return null;
  const mine = [...Array(NP).keys()].sort((a, b) => P[t * NP + b].d - P[t * NP + a].d),
    theirs = [...Array(NP).keys()].sort((a, b) => ovr(P[(1 - t) * NP + b]) - ovr(P[(1 - t) * NP + a]));
  const mu: number[] = [];
  mine.forEach((k, j) => (mu[k] = theirs[j]));
  return mu;
}
export const guardOf = (p: Player) => {
  const NP = cfg.NP,
    mu = TS.mu[p.tm];
  return P[(1 - p.tm) * NP + (mu && mu[p.k] != null ? mu[p.k] : p.k)];
};
/** Difficulty multiplier for CPU-controlled teams (a team with no human on it); humans' teammates play at Pro level. */
const cpuK = (p: Player, k: number[]) => (CT.some((c) => c.tm === p.tm) ? k[1] : k[cfg.DIFF] ?? 1);
export function nearest(t: number, x: number, y: number, ex = -1, skip?: (k: number) => boolean) {
  let b = -1,
    bd = 1e9;
  const NP = cfg.NP;
  for (let k = 0; k < NP; k++) {
    const p = P[t * NP + k],
      d = Math.hypot(p.x - x, p.y - y);
    if (t * NP + k !== ex && d < bd && !(skip && skip(t * NP + k))) {
      bd = d;
      b = t * NP + k;
    }
  }
  // Fall back to ignoring the skip filter, then the exclusion (1v1 has a single teammate).
  return b >= 0 ? b : skip ? nearest(t, x, y, ex) : ex >= 0 ? nearest(t, x, y) : t * NP;
}
export function setup(off: number) {
  INB.on = 0;
  TS.hud = 0;
  if (cfg.HALF) return setupHalf(off);
  if (S === "play" && P.length) subs(), gamePlan(1 - off), gamePlan(off);
  TS.bc = 0;
  TS.tr[0] = TS.tr[1] = 0;
  TS.trT[0] = TS.trT[1] = -99;
  TS.orbP[0] = TS.orbP[1] = 0;
  TS.lane.fill(0);
  const NP = cfg.NP,
    ah = hoop(off),
    own = hoop(1 - off),
    Y = [250, 90, 170, 330, 410];
  for (let k = 0; k < NP; k++) {
    const o = P[off * NP + k],
      e = P[(1 - off) * NP + k];
    o.x = k || NP === 1 ? own + (ah - own) * (k ? 0.3 : 0.12) : own < 470 ? 6 : 934;
    e.x = own + (ah - own) * 0.65;
    o.y = Y[k];
    e.y = Y[(k + 2) % 5];
  }
  P.forEach((p) => {
    p.vx = p.vy = p.z = p.vz = 0;
    p.mode = "i";
    p.t = 0;
    p.ai = {};
    p.cd = 0;
  });
  B.owner = P[off * NP];
  B.mode = "held";
  B.sc = 0;
  B.sh = 0;
  B.last = null;
  JB = null;
  pos = off;
  shot = 24;
  PCNT[0] = PCNT[1] = 0;
  for (const c of CT) {
    if (c.fixed) c.idx = c.tm * NP;
    else c.idx = off !== c.tm ? nearestFree(c, B.owner.x, B.owner.y) : c.tm * NP;
    c.lastO = null;
  }
  inb = 1.2;
  if (TS.adv === off) {
    // after a late timeout the inbound comes from the frontcourt sideline
    const sh = (hoop(off) - 470) * 0.55;
    for (const p of P) p.x += sh;
    TS.adv = -1;
  }
  txt("INBOUND", 480, 230);
}
/** Street / King of the Court: check the ball at the top; offense spread around the arc, defense in front of them. */
function setupHalf(off: number) {
  const NP = cfg.NP,
    hx = HXs[1],
    spots = [
      [hx - 300, HY],
      [hx - 200, HY - 170],
      [hx - 200, HY + 170],
      [hx - 60, HY - 220],
      [hx - 60, HY + 220],
    ];
  for (let k = 0; k < NP; k++) {
    const o = P[off * NP + k],
      e = P[(1 - off) * NP + k],
      s = spots[k];
    o.x = s[0];
    o.y = s[1];
    e.x = s[0] + (hx - s[0]) * 0.18;
    e.y = s[1] + (HY - s[1]) * 0.18;
  }
  P.forEach((p) => {
    p.vx = p.vy = p.z = p.vz = 0;
    p.mode = "i";
    p.t = 0;
    p.ai = {};
    p.cd = 0;
    p.f = Math.atan2(HY - p.y, hx - p.x) + (p.tm !== off ? Math.PI : 0);
  });
  B.owner = P[off * NP];
  B.mode = "held";
  B.sc = 0;
  B.sh = 0;
  B.last = null;
  JB = null;
  pos = off;
  shot = 24;
  PCNT[0] = PCNT[1] = 0;
  for (const c of CT) if (!c.fixed) c.idx = off === c.tm ? c.tm * NP : nearestFree(c, B.owner.x, B.owner.y);
  inb = 0.6;
  txt("CHECK BALL", 480, 230);
}
/** Nearest teammate for a controller, skipping players other humans already hold. */
function nearestFree(c: Ctrl, x: number, y: number, ex = -1) {
  return nearest(c.tm, x, y, ex, (k) => CT.some((o) => o !== c && o.idx === k));
}
export const ctrlOf = (k: number) => {
  for (const c of CT) if (c.idx === k) return c;
  return null;
};
export const isH = (p: Player) => !!p && CT.some((c) => P[c.idx] === p);
const tempoOf = (p: Player) => {
  for (const c of CT) if (P[c.idx] === p) return c.tempo;
  return 0;
};

export function pass(p: Player, r: Player, ty?: number) {
  const sk = clamp((p.s + p.c) / 200, 0.4, 0.95);
  B.kick = HPL.h && T - HPL.at < 0.1 && HPL.t !== p.tm ? 1 : 0; // a pass out of the help: drive-and-kick
  B.dfl = 0; // (Pro Play: not checked for a deflection yet)
  let near = 0;
  const ddx = r.x - B.x,
    ddy = r.y - B.y,
    l2 = ddx * ddx + ddy * ddy || 1;
  for (const q of P) {
    if (q.tm === p.tm) continue;
    const u = clamp(((q.x - B.x) * ddx + (q.y - B.y) * ddy) / l2, 0, 1);
    if (Math.hypot(B.x + ddx * u - q.x, B.y + ddy * u - q.y) < 20) near = 1;
  }
  if (ty == null) ty = Math.hypot(hoop(r.tm) - r.x, HY - r.y) < 110 && r.j >= 60 && near ? 2 : near ? 1 : 0;
  const spd = ty === 2 ? 380 : ty === 1 ? 460 : 560,
    zt = ty === 2 ? 100 : ty === 1 ? -20 : 62;
  let Tm = Math.max(0.15, Math.hypot(ddx, ddy) / spd),
    tx = r.x,
    tz = r.y;
  for (let n = 0; n < 3; n++) {
    tx = r.x + r.vx * Tm * 0.9;
    tz = r.y + r.vy * Tm * 0.9;
    Tm = Math.max(0.15, Math.hypot(tx - B.x, tz - B.y) / spd);
  }
  const dp = P[nearest(1 - p.tm, p.x, p.y)],
    press = Math.hypot(dp.x - p.x, dp.y - p.y) < 45 ? 0.2 : 0,
    er = (1 - sk + press) * Math.min(28, Math.hypot(ddx, ddy) * 0.08);
  tx += (Math.random() - 0.5) * 2 * er;
  tz += (Math.random() - 0.5) * 2 * er;
  if (ty === 2) Tm *= 1.25;
  B.owner = null;
  B.mode = "pass";
  B.ptype = ty;
  B.to = r;
  const bf = ty === 1 ? 1.07 : 1;
  B.vx = ((tx - B.x) / Tm) * bf;
  B.vy = ((tz - B.y) / Tm) * bf;
  B.vz = (zt - B.z + 0.5 * g * Tm * Tm) / Tm;
  B.age = 0;
  B.last = p;
  B.sh = 0;
  p.cd = 0.4;
  p.pT = 0.25;
  {
    // how it's thrown: behind the back to a man behind you, no-look on the move, wraparound around a defender
    const ang = Math.abs(Math.atan2(Math.sin(Math.atan2(ddy, ddx) - p.f), Math.cos(Math.atan2(ddy, ddx) - p.f)));
    p.pk = ang > 2.2 && p.s >= 72 && ty !== 2 ? 2 : ang > 0.9 && Math.hypot(p.vx, p.vy) > 90 && p.s >= 75 && ty === 0 ? 1 : near && ty === 1 && p.s >= 80 ? 3 : 0;
    if (p.pk && isH(p)) txtW(["", "NO-LOOK!", "BEHIND THE BACK!", "WRAPAROUND!"][p.pk], p.x, p.y, 95, "#9fe7ff");
  }
  PCNT[p.tm]++;
  LASTP[p.tm] = T;
  B.pp = { p, t: T };
  {
    // Backspin off the fingertips (lob floats, chest pass snaps, bounce pass checks up off the floor).
    const h = Math.hypot(B.vx, B.vy) || 1,
      w = ty === 2 ? 5 : ty === 1 ? 7 : 10;
    B.wv = [(w * B.vy) / h, (-w * B.vx) / h, 0];
  }
  snd(260, 0.05, "triangle");
}
export function pick(p: Player, i: { dx: number; dy: number }) {
  let b = null,
    bs = -9;
  for (const r of P) {
    if (r.tm !== p.tm || r === p) continue;
    const dx = r.x - p.x,
      dy = r.y - p.y,
      d = Math.hypot(dx, dy) || 1,
      m = Math.hypot(i.dx, i.dy);
    const al = m > 0.1 ? (dx * i.dx + dy * i.dy) / d / m : (Math.cos(p.f) * dx + Math.sin(p.f) * dy) / d,
      nd = P[nearest(1 - p.tm, r.x, r.y)],
      s = al * 2 - d / 1500 + (Math.min(80, Math.hypot(nd.x - r.x, nd.y - r.y)) / 80) * 0.12 - (al < 0.3 ? 1.5 : 0);
    if (s > bs) {
      bs = s;
      b = r;
    }
  }
  return b;
}
const useRap = () => !!RAP && cfg.physics === "rapier";
/** Shot rating used by both the green window and the meter. */
export const shotRat = (p: Player, D0: number, isFT: boolean) =>
  (isFT ? p.c * 0.8 + 15 : D0 < 90 ? p.i : D0 < 237 ? (p.c + p.i) / 2 : p.c) + (p.heat || 0) * 2;
export function launch(p: Player) {
  p.rl = 1;
  p.lc = (p.lc || 0) + 1; // launch counter (game modes watch it)
  p.perf = 0;
  const H = cfg.hand ? handPos(p) : null,
    HK = H && H[2] > 40 && H[2] < 170,
    hx = hoop(p.tm),
    x0 = HK ? H[0] : p.x,
    y0 = HK ? H[1] : p.y,
    z0 = HK ? H[2] : p.z + 66 + (p.st === 2 ? 6 : 0),
    D0 = Math.hypot(hx - x0, HY - y0),
    three = D0 >= 237,
    lay = D0 < 90 || !!p.hk,
    isFT = !!ftq,
    hum = isH(p),
    TEMPO = tempoOf(p);
  if (isFT) {
    B.ft = 1;
    ftq.fired = 1;
    if (ftq.i + 1 >= ftq.n && !ftq.tech && !ftq.keep) ftq = null;
  } else B.ft = 0;
  let b = D0 < 90 || p.hk ? (p.i / 100) * (p.hk ? 0.74 : 0.86) : D0 < 237 ? ((p.c * 0.5 + p.i * 0.5) / 100) * 0.58 : (p.c / 100) * 0.5;
  let ct = 0,
    blk = null;
  {
    const [c0, o0] = contestRaw(p);
    ct = c0;
    blk = o0;
  }
  b -= Math.min(1, ct * (p.sbw > 0 ? 0.25 : 1)) * (D0 < 90 || p.hk ? 0.15 : 0.3); // (finishes: NBA at-rim ~65%)
  if (p.sbw > 0) b += 0.06;
  const cx = hum && p.cw != null ? p.cw : Math.min(1, ct * (p.sbw > 0 ? 0.25 : 1) + (p.bmp || 0) * 0.5),
    rat = shotRat(p, D0, isFT),
    notes: string[] = [],
    wm0 = lay && !isFT ? 1 : winMul(p, D0, notes),
    win = greenWin(p, rat, cx, wm0), // (shared with the HUD meter: the contest shrinks it live)
    rT = lay ? 0.28 : p.st === 1 ? 0.3 : 0.4;
  let gr;
  B.d0 = isFT ? null : D0;
  B.fb = !isFT && TS.tr[p.tm] ? 1 : 0; // (broadcast stats: a fast-break shot)
  B.sc2 = !isFT && TS.orbP[p.tm] ? 1 : 0; // (second-chance shot: this possession had an offensive rebound)
  B.cx = cx;
  B.lx = p.x; // (where it went up: shot chart)
  B.ly = p.y;
  B.kk = !isFT && p.kickT > 0 ? 1 : 0; // a shot off a kick-out
  // play-by-play: the call as he rises ("Curry pulls up..."); the result line follows on the make / miss
  if (!isFT && !lay && !PREDICT)
    cm("rise", p.n, D0 > 300 ? "deep" : three ? "three" : p.sbw > 0 ? "step" : p.sv === 2 ? "fade" : p.sv === 21 || p.sv === 20 ? "float" : Math.hypot(p.vx, p.vy) > 60 || (p.mvEnd != null && T - p.mvEnd < 0.6) ? "pull" : "mid");
  if (hum && cx > 0.45 && !lay) txtW(cx > 0.75 ? "SMOTHERED" : "CONTESTED", p.x, p.y, 108, "#ff6b6b");
  if (hum && notes.length && !lay) txtW(notes.join(" · "), p.x, p.y, 150, notes.some((n) => n === "DEEP" || n === "COLD") ? "#7fd4ff" : "#ffb347");
  if (hum) {
    const wt = win * (TEMPO ? 1.2 : 1),
      wmt = (0.07 + (rat / 100) * 0.05) * (TEMPO ? 1.2 : 1),
      cen = (TEMPO ? rT : p.st === 1 ? 0.45 : 0.6) + (wmt - wt);
    {
      const tt = TEMPO ? (p.tp == null ? 9 : p.tp) : p.mt;
      gr = tt >= cen - wt && tt <= cen + wt + 0.03;
    }
    if (gr && !lay && Math.abs((TEMPO ? (p.tp == null ? 9 : p.tp) : p.mt) - cen) < 0.012) {
      txtW("PERFECT RELEASE", p.x, p.y, 118, "#7CFC7C");
      p.perf = 1;
    }
    if (!lay) {
      // timing grade: how far from the perfect release, against the size of this shot's green window
      const tt = TEMPO ? p.tp : p.mt,
        off = tt == null ? 9 : tt - cen,
        rel = Math.abs(off) / Math.max(0.01, wt),
        g = tt == null ? "F" : Math.abs(off) < 0.012 ? "A+" : gr ? (rel < 0.45 ? "A" : rel < 0.8 ? "B+" : "B") : rel < 1.6 ? "C" : rel < 2.6 ? "D" : "F";
      p.tg = { off: Math.round(off * 1000), win: Math.round(wt * 1000), g, gr: !!gr, z: zoneOf(p, D0), c: Math.round(cx * 100) };
      if (!PREDICT) fx({ k: "tg", ...p.tg, n: p.n });
    }
    if (!gr && !lay) {
      // shot feedback: how far off the timing was, and what else hurt it
      const tt = TEMPO ? p.tp : p.mt,
        off = tt == null ? 9 : tt - cen,
        far = Math.abs(off) > wt * 2.2,
        why = cx > 0.6 ? " · HEAVY CONTEST" : (p.en ?? 1) < 0.45 ? " · TIRED LEGS" : "";
      txtW(TEMPO && p.tp == null ? "NO TEMPO" : (far ? "VERY " : "SLIGHTLY ") + (off > 0 ? "LATE" : "EARLY") + why, p.x, p.y, 95, "#ff9966");
    }
  } else if (lay || isFT) gr = Math.random() < clamp(((rat / 100) * 0.75 + (isFT ? 0.1 : 0.22) - cx * (isFT ? 0.45 : 0.32) + (p.sbw > 0 ? 0.1 : 0)) * cpuK(p, [0.78, 0.92, 1, 1.1]) * Math.sqrt(wm0), 0.05, 0.95);
  else {
    // CPU jumpers, calibrated to NBA shooting splits: an open three goes in ~30% (poor shooter) .. ~46% (elite),
    // mid-range ~36-50%, and a full contest takes about a third off (league: open 38% vs tight 33% from three)
    // (re-based for v5.0's spacing / kick-outs: open looks come more often, so each one is a touch harder)
    const base = three ? 0.362 + (0.16 * (rat - 60)) / 40 : 0.29 + (0.14 * (rat - 60)) / 40,
      pm = clamp(base * (1 - 0.25 * cx) * (p.sbw > 0 ? 0.95 : 1) * cpuK(p, [0.85, 0.94, 1, 1.06]) * Math.sqrt(wm0), 0.04, 0.6);
    gr = Math.random() < pm / (0.98 - cx * 0.25); // (the make roll below keeps its contest factor)
  }
  if ((p.heat || 0) >= 3 && D0 > 265 && !isFT) txtW("HEAT CHECK!", p.x, p.y, 160, "#ff9a2e");
  B.owner = null;
  B.mode = "air";
  B.sh = 1;
  B.sc = 0;
  B.last = p;
  B.age = 0;
  B.three = three;
  B.to = null;
  if (!isFT) {
    p.stt.fga++;
    if (three) p.stt.tpa++;
  }
  B.x = x0;
  B.y = y0;
  B.z = z0;
  B.fl = 0;
  B.flBy = null;
  B.clk = clock;
  B.q = q;
  B.rim = 99;
  B.dk = 0;
  B.gn = 0;
  B.abv = -1;
  B.wv = [0, 0, 0];
  ph3Launch(p, three);
  B.gt = B.gtc = 0;
  B.gd = 0; // (green guide: set below for an intended green make)
  const fd = isFT ? null : shootingFoul(p, lay);
  if (fd) {
    p.hitT = 0.4; // the shooter wears the contact
    const dl = Math.hypot(p.x - fd.x, p.y - fd.y) || 1;
    p.hitX = (p.x - fd.x) / dl;
    p.hitY = (p.y - fd.y) / dl;
  }
  const dunkMiss = cfg.GM === "dunk" && isDunkSv(p.sv) && !gr;
  if (isDunkSv(p.sv) && !dunkMiss && (p.oop || cfg.GM === "dunk" || Math.random() < 0.9)) {
    p.oop = 0;
    const vic = P.find((o) => o.tm !== p.tm && o.z > 8 && Math.hypot(o.x - p.x, o.y - p.y) < 22);
    if (vic) {
      txtW("POSTERIZED!", vic.x, vic.y, 115, "#ff5a5a");
      vic.hitT = 0.45;
      vic.hitX = (vic.x - p.x) / (Math.hypot(vic.x - p.x, vic.y - p.y) || 1);
      vic.hitY = (vic.y - p.y) / (Math.hypot(vic.x - p.x, vic.y - p.y) || 1);
      fx({ k: "shake", v: 0.8 });
      fx({ k: "slow", v: 0.9 });
    } else fx({ k: "shake", v: 0.45 });
    if (fd && FLAG) {
      B.owner = p;
      B.mode = "held";
      B.sh = 0;
      p.act = 3;
      p.actT = 1.1;
      p.stt.fga--;
      ban("FLAGRANT 1", fd.n.toUpperCase() + " · 2 SHOTS + THE BALL", "#ff3b3b");
      cm("flagrant", fd.n, p.n);
      foul(fd, p, "FLAGRANT", 1, 0, 1);
      return;
    }
    if (fd) {
      B.fl = 1;
      B.flBy = fd;
      fx({ k: "shake", v: 0.5 });
    }
    B.dk = 1;
    // hang on the rim for a beat (pose switches to the hang clip shortly after the slam)
    p.hangT = P.some((o) => o !== p && Math.hypot(o.x - hx, o.y - HY) < 18 && o.z < 10) ? 0.85 : 0.55; // don't land on him
    B.x = hx;
    B.y = HY;
    B.z = 116;
    B.vx = B.vy = 0;
    B.vz = -130;
    B.three = 0;
    txtW("DUNK!", hx, HY, 125, "#ffd23f");
    snd(150, 0.2, "square", 0.12);
    return;
  }
  if (!fd && blk && blk.z > 10 && Math.hypot(blk.x - p.x, blk.y - p.y) < 24 && Math.random() < (0.025 + (ct * 0.13 * blk.d) / 100) * (cfg.PP >= 2 ? pp2BlkT(blk) : 1)) {
    // (Pro Play v2: block timing - at the top of his jump, x1.3; early or coming down, down to x.55)
    // three kinds of block: a control block tipped to himself or a teammate (good defenders keep it - it starts the
    // break), a volleyball swat into the stands, or the plain swat that pops it loose
    const r = Math.random(),
      ctl = r < 0.15 + (blk.d - 60) / 160,
      swat = !ctl && r < 0.5;
    if (ctl) {
      let mate = blk,
        md = 1e9;
      for (const q of P)
        if (q.tm === blk.tm && q !== blk && !q.off) {
          const d = Math.hypot(q.x - blk.x, q.y - blk.y);
          if (d < md && d < 160) (md = d), (mate = q);
        }
      const tx = mate === blk ? blk.x + (470 - blk.x) * 0.06 : mate.x,
        ty = mate === blk ? blk.y : mate.y,
        tt = 0.75;
      B.vx = (tx - B.x) / tt;
      B.vy = (ty - B.y) / tt;
      B.vz = (40 - B.z) / tt + (g * tt) / 2; // (lands about chest high at the target)
      STAT.ctlBlk = (STAT.ctlBlk || 0) + 1;
      B.ctl = blk.tm;
    } else if (swat) {
      // sent away: hard, flat, out toward the nearest sideline
      const sl = B.y < HY ? -1 : 1;
      B.vx = (p.x - blk.x) * 6 + (Math.random() - 0.5) * 60;
      B.vy = sl * (260 + Math.random() * 120);
      B.vz = 30;
    } else {
      B.vx = (p.x - blk.x) * 8 + (Math.random() - 0.5) * 80;
      B.vy = (Math.random() - 0.5) * 120;
      B.vz = 60;
    }
    B.sh = 0;
    B.last = blk; // (he touched it last: swatted out of bounds, the shooting team keeps it)
    blk.stt.blk++;
    exc(swat ? 1 : 0.9);
    txtW(ctl ? "BLOCKED - AND KEPT!" : swat ? "SENT AWAY!" : "BLOCKED!", blk.x, blk.y, 80, "#ff6b4a");
    cm("block", blk.n);
    p.act = 6; // the shooting arm gets knocked back
    p.actT = 0.45;
    if (!PREDICT) (blk.cel = 14), (blk.celT = CEL_T); // the blocker holds the swat / stares him down
    snd(150, 0.15, "square");
    if (Math.random() < 0.12) tech(blk, p.tm);
    return;
  }
  const rap = useRap(),
    _dm = dunkMiss && hum ? txtW("MISSED DUNK!", p.x, p.y, 120, "#ff6b4a") : 0,
    // (Pro Play v2: contact knocks a fouled shot off - layups x.5, CPU jumpers x.35 - so and-ones are ~a fifth of the
    // shooting fouls like the NBA, not a third; a human's green still counts, and dunks went through above)
    mk = dunkMiss ? false : lay ? (gr && hum) || Math.random() < clamp(b + (gr ? 0.15 : 0), 0.03, 0.97) * (fd && cfg.PP >= 2 ? 0.5 : 1) : gr && (p.perf || hum || Math.random() < (0.98 - cx * 0.25) * (fd && cfg.PP >= 2 && !hum ? 0.35 : 1)), // (a human's green is a make: the contest already shrank his window)
    a = Math.random() * 6.28,
    off = mk ? (rap || cfg.PH3 ? 0.3 : 1.2) : 9 + Math.random() * 7, // (Physics v3: the legacy ball is pre-simulated too)
    tx = hx + Math.cos(a) * off,
    ty = HY + Math.sin(a) * off,
    dx = tx - x0,
    dy = ty - y0,
    D = Math.hypot(dx, dy) || 1,
    dz = 100 - z0;
  if (!hum && !lay && !isFT) {
    // (tuning counters: CPU jumpers launched / meant to go in - tests/stats.ts compares them with what went in)
    const k = three ? "j3" : "j2";
    STAT[k + "n"] = (STAT[k + "n"] || 0) + 1;
    if (mk) STAT[k + "mk"] = (STAT[k + "mk"] || 0) + 1;
  }
  if (fd && (!mk || FLAG)) {
    B.owner = p;
    B.mode = "held";
    B.sh = 0;
    if (FLAG) {
      p.act = 3; // knocked to the floor
      p.actT = 1.1;
      p.stt.fga--;
      if (three) p.stt.tpa--;
      ban("FLAGRANT 1", fd.n.toUpperCase() + " · 2 SHOTS + THE BALL", "#ff3b3b");
      cm("flagrant", fd.n, p.n);
      foul(fd, p, "FLAGRANT", 1, 0, 1);
    } else foul(fd, p, "SHOOTING", 1, three);
    return;
  }
  if (fd) {
    B.fl = 1;
    B.flBy = fd;
    if (lay) p.sv = 18; // finishes through the contact
  }
  // Release angles like real shooters (~48-55 deg; floaters and heaves higher), plus a small per-player arc from the form signature.
  const fa = (p.sg && p.sg.a) || 0;
  let th = (D < 90 ? 1.0 : D < 200 ? 0.9 : D < 300 ? 0.86 : D < 400 ? 0.97 : 1.1) + fa * 0.12;
  for (let k = 0; k < 8 && D * Math.tan(th) - dz < 8 && th < 1.45; k++) th += 0.08;
  let ge = g,
    v = Math.sqrt((ge * D * D) / (2 * Math.cos(th) ** 2 * Math.max(1, D * Math.tan(th) - dz)));
  if (cfg.PH3) {
    ge = g - AIR_KM * 16 * v * Math.cos(th);
    v = Math.sqrt((ge * D * D) / (2 * Math.cos(th) ** 2 * Math.max(1, D * Math.tan(th) - dz)));
  } else if (rap) {
    ge = g - 0.0032 * 16 * v * Math.cos(th);
    v = Math.sqrt((ge * D * D) / (2 * Math.cos(th) ** 2 * Math.max(1, D * Math.tan(th) - dz)));
  }
  B.vz = v * Math.sin(th);
  // a tip from right under the rim can come out too soft to even reach it: give it enough lift to clear the iron
  if (B.vz * B.vz + 2 * ge * (z0 - 100) < 0) B.vz = Math.sqrt(2 * ge * (106 - z0));
  const TF = (B.vz + Math.sqrt(Math.max(0, B.vz * B.vz + 2 * ge * (z0 - 100)))) / ge,
    hv = (D * 0.1) / (1 - Math.exp(-0.1 * TF));
  B.vx = (hv * dx) / D;
  B.vy = (hv * dy) / D;
  {
    const h3 = Math.hypot(B.vx, B.vy) || 1;
    B.wv = [(16 * B.vy) / h3, (-16 * B.vx) / h3, 0];
  }
  if (cfg.PH3) {
    // Physics v3 (Rapier and legacy alike): pre-simulate the same air step as bstep / rapStep (quadratic drag + Magnus,
    // then gravity, the spin's slow decay) and correct range and sideways error; an arc that would not get back down
    // through the rim height (drag eats the apex of a soft one) gets more lift first
    for (let it = 0; it < 6; it++) {
      let x = x0,
        y = y0,
        z = z0,
        vx = B.vx,
        vy = B.vy,
        vz = B.vz,
        T2 = 0,
        w0 = B.wv[0],
        w1 = B.wv[1],
        zm = z0,
        hit = 0;
      const h = 1 / 120,
        wd = 1 / (1 + h * AIR_WD);
      while (T2 < 4) {
        AV[0] = vx;
        AV[1] = vy;
        AV[2] = vz;
        AV[3] = w0;
        AV[4] = w1;
        AV[5] = 0;
        airAcc(h);
        vx = AV[0];
        vy = AV[1];
        vz = AV[2] - g * h;
        const qz = z;
        x += vx * h;
        y += vy * h;
        z += vz * h;
        w0 *= wd;
        w1 *= wd;
        T2 += h;
        if (z > zm) zm = z;
        if (qz >= 100 && z < 100 && vz < 0) {
          hit = 1;
          break;
        }
        if (z < 0) break;
      }
      if (!hit || zm < 103) {
        B.vz *= 1.06;
        continue;
      }
      B.vx += ((tx - x) / Math.max(0.2, T2)) * 0.9;
      B.vy += ((ty - y) / Math.max(0.2, T2)) * 0.9;
      const h4 = Math.hypot(B.vx, B.vy) || 1;
      B.wv = [(16 * B.vy) / h4, (-16 * B.vx) / h4, 0];
    }
  } else if (rap) {
    // Pre-simulate drag + Magnus and correct range and sideways error so perfect timing still goes in.
    for (let it = 0; it < 6; it++) {
      let x = x0,
        y = y0,
        z = z0,
        vx = B.vx,
        vy = B.vy,
        vz = B.vz,
        T2 = 0,
        w0 = B.wv[0],
        w1 = B.wv[1];
      // (exactly what rapStep + Rapier do each half-frame: drag, Magnus, gravity, symplectic Euler, and the spin
      // decaying with the ball body's angular damping .3 - a constant spin over-predicted the lift on long heaves)
      const h = 1 / 120,
        wd = 1 / (1 + h * 0.3);
      while (T2 < 4) {
        vx *= 1 - 0.1 * h;
        vy *= 1 - 0.1 * h;
        vz += 0.0032 * (w0 * vy - w1 * vx) * h - g * h;
        const qz = z;
        x += vx * h;
        y += vy * h;
        z += vz * h;
        w0 *= wd;
        w1 *= wd;
        T2 += h;
        if (qz >= 100 && z < 100 && vz < 0) break;
      }
      B.vx += ((tx - x) / Math.max(0.2, T2)) * 0.9;
      B.vy += ((ty - y) / Math.max(0.2, T2)) * 0.9;
      const h4 = Math.hypot(B.vx, B.vy) || 1;
      B.wv = [(16 * B.vy) / h4, (-16 * B.vx) / h4, 0];
    }
  }
  B.gn = gr;
  B.gd = gr && mk && hum ? 1 : 0; // a human's green (CPU odds stay calibrated with the iron): greenGuide (bstep) sees it through the iron, bodies and spin drift
  if (cfg.PH3 && !B.gd && !lay && !isFT) ph3Short(p); // (Physics v3: tired legs - never a human's green)
  B.ghx = hx;
  if (gr && hum) txtW("GREEN!", p.x, p.y, 95, "#2ecc71");
  if (gr && !PREDICT && !(p.celT > 0)) {
    // knows it's good: holds the follow-through through the landing (pose CEL 10)
    p.cel = 10;
    p.celT = CEL_T;
  }
  snd(380, 0.07, "triangle");
}
/** Positions of everyone as the shooter saw them (lag compensation for online guests): a past frame or null = now. */
const LAGBUF: Float32Array[] = [];
function lagFrame(p: Player): Float32Array | null {
  let c: any = null;
  for (const o of CT) if (P[o.idx] === p) c = o;
  const back = c && c.lag ? Math.min(14, Math.round(c.lag * 60)) : 0;
  return back && LAGBUF.length > back ? LAGBUF[LAGBUF.length - 1 - back] : null;
}
function lagRec() {
  if (!CT.some((c: any) => c.lag)) {
    LAGBUF.length = 0;
    return;
  }
  let a = LAGBUF.length > 14 ? LAGBUF.shift()! : null;
  if (!a || a.length !== P.length * 3) a = new Float32Array(P.length * 3);
  P.forEach((p, k) => {
    a[k * 3] = p.x;
    a[k * 3 + 1] = p.y;
    a[k * 3 + 2] = p.z;
  });
  LAGBUF.push(a);
}

// ---------------------------------------------------------------------------------------------------------------
// Pro Play pack (cfg.PP, v5.3; C# twin: unity Core/Sim.UP.cs - same names, same order of random draws).
// Ported from the Unity-only UP moves and shared by both engines now: in-and-out / crossover / snatch-back / double
// crossover + combo chains, drive gathers (two-step / hop-step / spin), floaters, sky hooks, off-hand reverses, lean-away
// vs late closeouts, landings, power putbacks, drive bumps, swipe-downs, hand checks, V-cuts, signature size-ups.
// New in v5.3: human move buffer + cancel window, sprint burst, on-ball stance (slide assist + auto hand up), contest
// timing (a defender coming down counts less) with feedback, pass deflections (never change possession), height in
// rebounding, box-outs that wear off, shot-selection feedback. Move codes (i.mv / p.mvk): 1 hesi, 2 spin, 3 behind the
// back, 4 post (TS) + 5 in-and-out, 6 crossover, 7 snatch-back. sv 24 floater, 25 sky hook.
// ---------------------------------------------------------------------------------------------------------------
/** Counters per Pro Play feature (moves started, gathers, floaters, deflections, ...) for the tests. */
export const PPC: Record<string, number> = {};
const ppc = (k: string) => {
  if (!PREDICT) PPC[k] = (PPC[k] || 0) + 1;
};
const MV_PP = ["", "HESITATION", "SPIN MOVE", "BEHIND THE BACK", "", "IN-AND-OUT", "CROSSOVER", "SNATCH-BACK"];
/** Dribble move start (replaces the old non-post branch of step): the stick picks the variant of the move key. */
function upMoveStart(p: Player, i: Input, d: Player, dist: number, Sd: number, u: boolean, ux: number, uy: number, D: number) {
  let mvq = i.mv || 0;
  const sl = Math.hypot(i.dx, i.dy),
    lat = sl > 0.3 ? (i.dx * -uy + i.dy * ux) / D / sl : 0,
    fw = sl > 0.3 ? (i.dx * ux + i.dy * uy) / D / sl : 0;
  if (mvq === 1) {
    if (fw < -0.55) mvq = 7;
    else if (Math.abs(lat) > 0.55) mvq = 5;
  } else if (mvq === 3 && Math.abs(lat) > 0.55) mvq = 6;
  if ((mvq === 5 || mvq === 6) && Math.abs(lat) > 0.4) Sd = Math.sign(lat);
  const chain = p.mvEnd != null && T - p.mvEnd < 0.5,
    dbl = chain && mvq === 6 && p.mvk === 6;
  p.combo = chain && (p.mvk !== mvq || dbl) ? Math.min(4, (p.combo || 1) + 1) : 1;
  if (dbl) Sd = -p.mvS; // cross it right back
  p.mvP = chain ? p.mvk : 0;
  p.mvk = mvq;
  p.mvT = mvq === 5 ? 0.46 : mvq === 6 ? (p.combo > 1 ? 0.34 : 0.4) : mvq === 7 ? 0.44 : p.combo > 1 ? 0.42 : 0.5;
  p.mvE = 0;
  p.mvS = Sd;
  p.cd = mvq === 7 ? 0.5 : 0.55;
  ppc("mv" + mvq);
  if (p.combo > 1) ppc("combo");
  if (u) {
    const mt = dbl ? "DOUBLE CROSSOVER" : p.mvP === 1 && mvq === 6 ? "HESI CROSS" : p.mvP === 5 && mvq === 6 ? "KILLER CROSS" : mvq >= 0 && mvq < MV_PP.length ? MV_PP[mvq] : "MOVE";
    txtW(mt + (p.combo > 1 && !dbl ? " · COMBO x" + p.combo : ""), p.x, p.y, 100, "#ffd23f");
  }
  if (PREDICT) return;
  if (mvq === 7) {
    // snatch-back: hop away from a defender who is crowding / closing - space for the pull-up
    if (dist < 45) {
      d.slow = Math.max(d.slow, 0.35);
      if (u) txtW("CREATED SPACE", p.x, p.y, 95, "#ffd23f");
    }
    return;
  }
  if (cfg.PP >= 2) {
    pp2Read(p, d, dist, mvq, Sd, ux, uy, D, u); // (v5.4: the defender's read decides it)
    return;
  }
  const bon = mvq === 5 ? 0.06 : mvq === 6 ? 0.04 : 0;
  if (dist < 60 && Math.random() < 0.5 + (p.s - d.d) / 250 + (hasB(p, "AB") ? 0.12 : 0) + (p.combo - 1) * 0.12 + bon) {
    d.slow = Math.max(d.slow, 0.7);
    d.scr = Math.max(d.scr || 0, 0.35);
    d.hitT = 0.34;
    d.hitX = -uy * Sd;
    d.hitY = ux * Sd;
    ppc("ankle");
    if (u) txtW("ANKLE BREAKER!", d.x, d.y, 95, "#ff6b6b");
  }
}
/** Velocity profile of the new moves: [toward the rim, sideways x side]. */
function upMoveVel(k: number, e: number): [number, number] {
  if (k === 5) {
    if (e < 0.16) return [0.35, -0.45]; // sell the crossover
    if (e < 0.24) return [0.2, 0]; // plant
    return [1.3, 0.55]; // and go the same way
  }
  if (k === 6) return e < 0.1 ? [0.35, -0.3] : [0.95, 1.05]; // a short counter-step the other way, then across
  if (k === 7) return e < 0.24 ? [-1.15, 0] : [0.05, 0]; // two hops straight back
  return [0, 0];
}
const PK0 = [1, 3, 6, 6, 5, 2],
  PK1 = [3, 5, 5, 6, 1, 3],
  PK2 = [1, 1, 7, 5, 6, 2],
  PK3 = [6, 6, 2, 6, 1, 5];
/** CPU dribble move: the signature package (formOf dk) picks it from ONE random draw r. */
function upCpuMove(p: Player, dn: Player, r: number) {
  const dk = p.sg ? p.sg.dk || 0 : 0,
    dd = Math.hypot(dn.x - p.x, dn.y - p.y),
    cl = (dn.vx * (p.x - dn.x) + dn.vy * (p.y - dn.y)) / Math.max(1, dd),
    D = Math.hypot(hoop(p.tm) - p.x, HY - p.y);
  if (cl > 120 && dd < 40 && D > 150 && D < 260 && r < 0.5) return 7; // closing hard: snatch it back
  // 0 btb + cross, 1 Curry: between the legs / in-and-out chains, 2 Doncic: hesitations and snatch-backs, 3 Edwards: crosses and spins
  const pk = dk === 1 ? PK1 : dk === 2 ? PK2 : dk === 3 ? PK3 : PK0;
  return pk[Math.min(pk.length - 1, (r * pk.length) | 0)];
}
/** A defender between him and the rim, close to it: floater territory. */
function rimProt(p: Player) {
  const hx = hoop(p.tm),
    D = Math.hypot(hx - p.x, HY - p.y);
  for (const o of P) {
    if (o.tm === p.tm || o.off) continue;
    const dr = Math.hypot(o.x - hx, o.y - HY);
    if (dr < 60 && dr < D - 20) return true;
  }
  return false;
}
/** Mode i -> c: start a drive gather when attacking the rim fast from 8-16 ft. */
function upGatherStart(p: Player, ux: number, uy: number, D: number) {
  p.gath = 0;
  p.gsu = 0;
  p.gfw = (p.vx * ux + p.vy * uy) / D; // drive speed at the gather (the charge damps it before the clip is picked)
  p.jg = T - (p.catchT ?? -9) < 1.0 && Math.hypot(p.vx, p.vy) < 60 ? 1 : Math.hypot(p.vx, p.vy) > 60 ? 2 : 0;
  if (B.owner !== p || ftq || p.postA || p.upu > 0 || p.fsv != null) return;
  const fw = (p.vx * ux + p.vy * uy) / D;
  if (fw < 150 || D < 80 || D > 165 || (rimProt(p) && D > 110)) return;
  // what is in the way decides the footwork
  const d = P[nearest(1 - p.tm, p.x, p.y)],
    dx = d.x - p.x,
    dy = d.y - p.y,
    dd = Math.hypot(dx, dy),
    ahead = (dx * ux + dy * uy) / D,
    side = (dx * -uy + dy * ux) / D;
  p.gSd = side >= 0 ? -1 : 1; // away from him
  p.gath = dd < 34 && ahead > 6 && Math.abs(side) < 12 && p.s >= 72 ? 3 : dd < 50 && ahead > -6 && Math.abs(side) >= 8 ? 2 : 1;
  p.gathT = 0;
  p.jg = 0;
  ppc(p.gath === 3 ? "spinGather" : p.gath === 2 ? "hopStep" : "gather");
  if (isH(p)) txtW(p.gath === 3 ? "SPIN GATHER" : p.gath === 2 ? "HOP STEP" : "GATHER", p.x, p.y, 95, "#ffd23f");
}
/** Mode c: the gather keeps the drive's momentum (true = skip the usual damping); a release pressed in it waits. */
function upGather(p: Player, i: Input, dt: number, ux: number, uy: number, D: number, hum: boolean) {
  if (!(p.gath > 0)) return false;
  const dur = p.gath === 3 ? 0.4 : p.gath === 2 ? 0.36 : 0.32;
  if (i.su) (p.gsu = 1), (i.su = 0);
  p.gathT += dt;
  if (p.gathT >= dur || D < 62 || B.owner !== p) {
    p.gath = -p.gath; // done: the pose keeps the kind for the takeoff, the release goes now
    if (p.gsu || !hum) i.su = 1;
    return false;
  }
  const sp = clamp(Math.hypot(p.vx, p.vy), 130, 250),
    ex = ux / D,
    ey = uy / D,
    lx = -ey * p.gSd,
    ly = ex * p.gSd;
  let f = sp,
    l = 0;
  if (p.gath === 2) {
    if (p.gathT > 0.14 && p.gathT < 0.28) (f = sp * 0.55), (l = 150);
    else f = sp * 0.8; // the hop to the side
  } else if (p.gath === 3) (f = sp * 0.75), (l = 70 * Math.sin((p.gathT / dur) * Math.PI)); // spin round him
  const tx = ex * f + lx * l,
    ty = ey * f + ly * l,
    k = Math.min(1, dt * 14);
  p.vx += (tx - p.vx) * k;
  p.vy += (ty - p.vy) * k;
  return true;
}
/** After the shot clip was picked: sky hooks, floaters, off-hand reverses. */
function upAfterClip(p: Player, D: number, lay: boolean) {
  p.offH = 0;
  const hx = hoop(p.tm),
    dir = hx > 470 ? 1 : -1,
    fw = Math.max(p.vx * dir, p.gfw || 0);
  if (p.sv === 10 && (p.ht >= 6.9 || p.i >= 88)) {
    p.sv = 25;
    ppc("skyHook");
    if (isH(p)) txtW("SKY HOOK", p.x, p.y, 100, "#ffd23f");
    return;
  }
  if (!lay && D >= 90 && D < 180 && fw > 60 && (rimProt(p) || p.st === 4) && (p.sv === 21 || p.sv === 8 || p.sv === 22 || p.sv === 0 || p.sv === 1 || p.sv === 4 || p.sv === 20 || p.sv === 2 || p.sv === 3)) { // (a fade / step-back form while charging the rim = a floater too)
    p.sv = 24;
    ppc("floater");
    return;
  }
  // reverse under the rim from the right side: off hand off the glass
  if (p.sv === 17 && (p.y - HY) * dir < 0) (p.offH = 1), ppc("offHand");
  if (lay && Math.abs(p.gath || 0) === 2) ppc("hopFinish");
  if (lay && Math.abs(p.gath || 0) === 3) ppc("spinFinish");
}
/** Mode s: a late hard closeout makes the shooter lean away and get it off a beat quicker. Returns the release shift. */
function upContest(p: Player, D: number, has: boolean) {
  if (p.lnA > 0) return -0.03;
  if (!has || D < 90 || ftq || p.t < 0.05 || p.t > 0.25 || p.react) return 0;
  for (const o of P) {
    if (o.tm === p.tm || o.off) continue;
    const dx = p.x - o.x,
      dy = p.y - o.y,
      d = Math.hypot(dx, dy);
    if (d > 36 || d < 1) continue;
    const cl = (o.vx * dx + o.vy * dy) / d;
    if (cl < 110 && !(o.z > 8 && d < 30)) continue;
    p.lnA = 1;
    // side of his hand in the shooter's frame (+ = shooter's left): lean the other way
    const sd = -(o.x - p.x) * Math.sin(p.f) + (o.y - p.y) * Math.cos(p.f);
    p.lnS = sd >= 0 ? -1 : 1;
    if (!PREDICT) {
      p.vx += (dx / d) * 45;
      p.vy += (dy / d) * 45;
      if (isH(p) && p.cw != null) p.cw = Math.max(0, p.cw - 0.08);
      ppc("leanAway");
      if (isH(p)) txtW("LEANS AWAY", p.x, p.y, 112, "#ffd23f");
    }
    return -0.03;
  }
  return 0;
}
/** Landing: softer for small hops, deeper for real drops (from the touchdown speed). */
function upLanding(p: Player) {
  const v = -p.vz;
  if (v < 60) return;
  p.landT = Math.min(0.36, v / 700);
  p.upLand = Math.min(1.3, v / 230);
  if (v > 180) ppc("land");
}
/** Offensive board on the floor right under the rim (CPU): go straight back up strong. */
function upPutback(p: Player, wasShot: any, shooter: Player) {
  if (!wasShot || !shooter || shooter.tm !== p.tm || p.z > 8 || isH(p) || ftq || PREDICT) return;
  if (Math.hypot(hoop(p.tm) - p.x, HY - p.y) > 60 || p.j < 45 || Math.random() > 0.65) return;
  p.mode = "s";
  p.t = 0.1;
  p.sv = p.j < 60 ? 5 : p.j >= 80 && Math.random() < 0.4 ? 12 : 11; // (power layup for the lower leapers)
  p.rl = 0;
  p.hk = 1;
  p.vz = 150 + p.j * 0.9;
  p.ttT = 0;
  ppc("putback");
  txtW(p.sv === 5 ? "PUTBACK" : "PUTBACK SLAM!", p.x, p.y, 115, "#ffd23f");
}
/** CPU drive: attacking the rim at speed, start the gather from 9-14 ft (layup / floater territory). */
function upCpuGather(p: Player, D: number) {
  const a = p.ai;
  if (!(a.r > 0 && a.r < 90) || D > 150 || D < 95 || p.cd > 0 || p.mvT > 0) return false;
  const hx = hoop(p.tm),
    fw = (p.vx * (hx - p.x) + p.vy * (HY - p.y)) / D;
  if (fw < 160) return false;
  p.in.sd = 1;
  a.rel = 0.3;
  return true;
}
/** V-cut: a spacer whose man is up on him sinks a step toward the rim, plants and pops out to the spot. */
function upVcut(p: Player, spX: number, spY: number, hx: number, md: Player) {
  const d = Math.hypot(spX - p.x, spY - p.y);
  if (!(p.vcT > 0)) {
    if (d > 45 || !md || Math.hypot(md.x - p.x, md.y - p.y) > 30 || !B.owner || Math.sin(T * 0.9 + p.k * 2.3) < 0.93) return false;
    p.vcT = 0.75;
    ppc("vcut");
  }
  p.br = "vcut";
  if (p.vcT > 0.4) mv(p, spX + (hx - spX) * 0.22, spY + (HY - spY) * 0.22, 0.85); // sell the cut
  else mv(p, spX, spY, 1.3); // plant and pop
  return true;
}
/** Once per tick after every step: timers, drive bumps, swipe-downs, hand checks, catch times. */
function upTick(dt: number) {
  for (let k = 0; k < P.length; k++) {
    const p = P[k];
    if (p.off) continue;
    p.bmpT = (p.bmpT || 0) - dt;
    if ((p.swpT || 0) > -5) p.swpT = (p.swpT || 0) - dt;
    if (p.vcT > 0) p.vcT -= dt;
    if ((p.hcT || 0) > -5) p.hcT = (p.hcT || 0) - dt;
    if (p.boxT > 0) p.boxT -= dt; // (a box-out holds while he keeps it: it used to count forever)
    if (p.mode !== "s") p.lnA = Math.max(0, (p.lnA || 0) - dt * 5);
    if (p.mode === "i") {
      if (p.z <= 0) p.offH = 0;
      if (p.gath > 0 || p.z <= 0) p.gath = 0;
    }
    if (p.mode === "s" && p.t < 0.02) p.tdT = T;
    if (cfg.PP >= 2) {
      p.stillT = p.z <= 0 && Math.hypot(p.vx, p.vy) < 45 ? (p.stillT || 0) + dt : 0; // (feet set: charges)
      if (p.cutT > -1) p.cutT -= dt;
      if (p.coT > -1) p.coT -= dt;
    }
  }
  const o = B.owner;
  if (o && B.hold !== o) o.catchT = T;
  if (!o || o.mode !== "i" || PREDICT || o.postA) return;
  const sp = Math.hypot(o.vx, o.vy),
    d = P[nearest(1 - o.tm, o.x, o.y)],
    dx = d.x - o.x,
    dy = d.y - o.y,
    dd = Math.hypot(dx, dy);
  // shoulder bump on the drive: both bodies recoil, the driver loses a little speed
  if (sp > 140 && o.bmpT <= 0 && dd < 21 && dd > 1 && (dx * o.vx + dy * o.vy) / (dd * sp) > 0.3) {
    o.bmpT = 0.7;
    const nx = dx / dd,
      ny = dy / dd,
      f = (o.bk * o.ht) / (d.bk * d.ht);
    o.hitT = 0.18;
    o.hitX = -nx;
    o.hitY = -ny;
    d.hitT = 0.22;
    d.hitX = nx;
    d.hitY = ny;
    if (cfg.PP >= 2) {
      if (pp2Bump(o, d, nx, ny, dd)) return; // (v5.4: cut off by a set defender - maybe a charge - or bumps a beaten one off)
    } else {
      o.vx *= 0.86;
      o.vy *= 0.86;
      d.x += nx * 2.5 * f;
      d.y += ny * 2.5 * f;
    }
    ppc("bump");
  }
  // on-ball defender swipes down at the ball on the drive (never a steal: steals are off by design)
  if (dd < 34 && sp > 90 && d.swpT < -1.2 && d.z <= 0 && Math.random() < dt * 1.5) {
    d.swpT = 0.36;
    ppc("swipe");
  }
  // hand check: a hand into the handler's hip as he sizes him up (legal: he loses a step; no foul, no steal)
  else if (dd < 30 && dd > 1 && sp < 150 && d.hcT < -0.9 && d.swpT <= 0 && d.z <= 0 && Math.random() < dt * 1.1) {
    d.hcT = 0.3;
    const nx = dx / dd,
      ny = dy / dd;
    o.hitT = Math.max(o.hitT, 0.12);
    o.hitX = -nx;
    o.hitY = -ny;
    o.vx *= 0.94;
    o.vy *= 0.94;
    ppc("handCheck");
  }
}
/** Human move buffer + cancel window: a move pressed while it can't start is kept 0.25 s; pressed in (or buffered
 *  into) the last 0.15 s of the current move it cancels the tail and starts at once (a combo chain). */
function ppBuffer(p: Player, i: Input) {
  if (i.mv) (p.mvB = i.mv), (p.mvBT = T);
  if (!p.mvB) return;
  if (T - p.mvBT > 0.25 || p.postA || ftq || pos !== p.tm) {
    p.mvB = 0;
    return;
  }
  if (p.mvT > 0) {
    if (p.mvk !== 4 && p.mvT < 0.15) {
      p.mvT = 0;
      p.mvEnd = T;
      p.cd = 0;
      i.mv = p.mvB;
      p.mvB = 0;
      ppc("cancel");
    }
    return;
  }
  if (p.cd <= 0) {
    i.mv = p.mvB;
    p.mvB = 0;
  }
}
/** Human on-ball defense: guarding the handler (no sprint, feet down, within 70 px) = in a stance. */
function ppStance(p: Player, i: Input, has: boolean, hum: boolean) {
  const o = B.owner;
  p.stc = hum && !has && o && o.tm !== p.tm && !i.sp && p.z <= 0 && p.mode === "i" && !(p.actT > 0) && Math.hypot(o.x - p.x, o.y - p.y) < 70 ? 1 : 0;
  // a shooter gathering right in front of him: the hand goes up by itself (a contest without leaving his feet)
  if (p.stc && (o.mode === "c" || o.mode === "s") && Math.hypot(o.x - p.x, o.y - p.y) < 42 && !(p.hupT > 0)) p.hupT = 0.5;
  if (cfg.PP >= 2 && p.stc) pp2Angle(p, i, o);
}
/** A pass in flight past a defender's hands can be tipped: it slows and wobbles, but stays a pass to its target
 *  (steals are off: a deflection never changes possession). One check per pass. */
function ppDeflect() {
  const L = B.last;
  if (!L) return;
  for (const o of P) {
    if (o.tm === L.tm || o.off || o.actT > 0 || o === B.to) continue;
    const d = Math.hypot(o.x - B.x, o.y - B.y);
    if (d > 14 || B.z < o.z + 18 || B.z > o.z + 78 + o.ht * 2) continue;
    B.dfl = 1;
    if (Math.random() < clamp(0.18 + (o.d - 60) / 220, 0.08, 0.42)) {
      const w = (Math.random() - 0.5) * 0.5, // turned up to ~14 degrees, 30% slower
        vx = B.vx,
        vy = B.vy;
      B.vx = (vx - vy * w) * 0.7;
      B.vy = (vy + vx * w) * 0.7;
      B.vz = Math.max(B.vz, 0) + 55;
      o.swpT = 0.3;
      B.dfl = 2; // (really tipped)
      if (cfg.PH3) ph3DeflSpin(w);
      STAT.defl = (STAT.defl || 0) + 1;
      ppc("deflect");
      if (isH(o) || isH(L)) txtW("DEFLECTED!", o.x, o.y, 95, "#9fe7ff");
    }
    return;
  }
}
/** Feedback on the release (humans): contest timing for the defender, shot selection for the shooter. */
function ppRelease(p: Player, ct: number, o2: Player | null, D: number) {
  if (PREDICT || ftq) return;
  if (o2 && isH(o2) && ct > 0.3) {
    if (o2.z > 8) {
      const good = o2.vz > -90;
      txtW(good ? "GREAT CONTEST" : "JUMPED EARLY", o2.x, o2.y, 105, good ? "#7cff9e" : "#ff9966");
      ppc(good ? "goodContest" : "earlyJump");
    } else if (o2.hupT > 0) ppc("handUp");
  }
  if (!isH(p) || D < 90 || ct < 0.55 || shot < 8 || cfg.NP < 2) return;
  // a forced, contested jumper early in the clock with a teammate wide open in his range
  for (const m of P) {
    if (m.tm !== p.tm || m === p || m.off) continue;
    const md = Math.hypot(hoop(m.tm) - m.x, HY - m.y);
    if (md > (m.c >= 75 ? 270 : 200)) continue;
    let near = 1e9;
    for (const q of P) if (q.tm !== p.tm && !q.off) near = Math.min(near, Math.hypot(q.x - m.x, q.y - m.y));
    if (near > 75) {
      txtW("FORCED IT · " + m.n.toUpperCase() + " WAS OPEN", p.x, p.y, 125, "#ff9966");
      STAT.badShot = (STAT.badShot || 0) + 1;
      return;
    }
  }
}
// ---------------------------------------------------------------------------------------------------------------
// Pro Play v2 (cfg.PP >= 2, v5.4; C# twin: unity Core/Sim.PP2.cs - same names, same order of random draws).
// Defender reads (a dribble move beats, crosses up or drops a defender - or he reads it - by ratings, his momentum,
// spacing and the move's counter), pull-ups out of a move, shot balance in the green window (off balance / fading / on
// the move / created space), side-steps, post back-down battles by strength (a human defender bodies up with the
// stick), body-ups on drives (a set defender cuts the driver off; a beaten one gets bumped off), block timing (a
// blocker at the top of his jump), charges read from position (set feet, contact square in the chest), off-ball
// humans: call for the ball (pass key), call for a screen (post key away from the post), flick cuts / backdoors.
// ---------------------------------------------------------------------------------------------------------------
const SQN = ["", "OFF BALANCE", "FADING", "ON THE MOVE", "CREATED SPACE", "FADEAWAY", "LEANER"];
/** A dribble move vs the defender in front of him: beaten / crossed up / on the floor, or he reads it. */
function pp2Read(p: Player, d: Player, dist: number, k: number, Sd: number, ux: number, uy: number, D: number, u: boolean) {
  if (dist >= 60) return;
  const ex = ux / D,
    ey = uy / D,
    rx = d.x - p.x,
    ry = d.y - p.y,
    ahead = rx * ex + ry * ey, // how far he is between the handler and the rim
    dLat = (d.vx * -ey + d.vy * ex) * Sd, // + = already moving the way the move goes
    cl = dist > 1 ? (d.vx * -rx + d.vy * -ry) / dist : 0, // closing speed (- = backpedaling)
    set = d.z <= 0 && Math.hypot(d.vx, d.vy) < 45;
  if (ahead < -4) return; // already past him: nothing to read
  let c = 0.36 + (p.s - d.d) / 250 + (hasB(p, "AB") ? 0.1 : 0) + ((p.combo || 1) - 1) * 0.1 + (1 - (d.en ?? 1)) * 0.3 - (1 - (p.en ?? 1)) * 0.2;
  if (dLat < -40) c += 0.2; // wrong-footed: he is leaning the other way
  else if (dLat > 60) c -= 0.2; // he is already there
  if (k === 1) c += cl < -30 || cl > 100 ? 0.15 : set ? -0.06 : 0; // hesitation: freezes a retreating or charging man
  else if (k === 2) c += dist < 26 ? 0.15 : dist > 45 ? -0.15 : 0; // spin: off contact, not from range
  else if (k === 3 || k === 5 || k === 6) c += cl > 90 ? 0.12 : 0; // crosses: punish a hard closeout
  if (d.stc) c -= 0.08; // a human down in his stance
  c = clamp(c, 0.05, 0.9);
  const r = Math.random();
  if (r < c) {
    p.beatT = T;
    if (r < c * 0.14 && (dLat < -40 || cl > 120 || p.combo >= 2) && !(d.actT > 0)) {
      d.act = 3; // ankles gone: on the floor
      d.actT = 0.9;
      d.slow = Math.max(d.slow, 1.1);
      ppc("ankle");
      if (u || isH(d)) txtW("ANKLE BREAKER!", d.x, d.y, 95, "#ff6b6b");
      exc(0.7);
    } else if (r < c * 0.6) {
      d.slow = Math.max(d.slow, 0.7);
      d.scr = Math.max(d.scr || 0, 0.35);
      d.hitT = 0.34; // feet crossed: a sideways stumble
      d.hitX = -uy * Sd;
      d.hitY = ux * Sd;
      ppc("stumble");
      if (u || isH(d)) txtW("CROSSED UP!", d.x, d.y, 95, "#ff6b6b");
    } else {
      d.slow = Math.max(d.slow, 0.45);
      ppc("beat");
      if (u) txtW("BLOW-BY", d.x, d.y, 95, "#ffd23f");
    }
  } else {
    // he read it: stays in front, and the handler has to reset before the next move
    p.cd = Math.max(p.cd, 0.75);
    d.slow = Math.min(d.slow, 0);
    ppc("stayed");
    if (isH(d)) txtW("READ IT!", d.x, d.y, 95, "#7cff9e");
    else if (u) txtW("STAYED IN FRONT", d.x, d.y, 95, "#ff9966");
  }
}
/** Mode i -> c: a shot out of a dribble move is a pull-up (the move ends into it: rhythm); the momentum at the gather
 *  sets the balance of a jumper (p.sq: the green window in winMul; p.sqn: what the meter / release text says). For a
 *  human the stick picks the jumper: held away from the rim = a fadeaway (drifts back, contest x.82, window x.94), held
 *  sideways inside the arc = a leaner (contest x.9, window x.96). */
function pp2Gather(p: Player, i: Input, ux: number, uy: number, D: number, hum: boolean) {
  p.sq = 1;
  p.sqn = 0;
  p.fade = 0;
  if (p.mvT > 0 && p.mvk !== 4) {
    const k = p.mvk;
    p.mvT = 0;
    p.mvEnd = T;
    ppc("pullUp");
    if (hum) txtW(k === 1 ? "HESI PULL-UP" : k === 7 ? "SNATCH-BACK J" : "PULL-UP", p.x, p.y, 112, "#ffd23f");
  }
  if (p.gath > 0 || D < 90 || ftq) return; // (drives, layups and free throws have their own rules)
  const lat = Math.abs((p.vx * -uy + p.vy * ux) / D),
    fw = (p.vx * ux + p.vy * uy) / D,
    sp = Math.hypot(p.vx, p.vy);
  if (lat > 170) (p.sq = 0.84), (p.sqn = 1);
  else if (fw < -150 && !(p.sbw > 0)) (p.sq = 0.9), (p.sqn = 2);
  else if (sp > 205) (p.sq = 0.93), (p.sqn = 3);
  else if (p.beatT != null && T - p.beatT < 0.9) (p.sq = 1.08), (p.sqn = 4);
  if (p.sqn) ppc("sq" + p.sqn);
  if (!hum || p.postA || p.fsv != null) return;
  const sl = Math.hypot(i.dx, i.dy);
  if (sl <= 0.6) return;
  const sf = (i.dx * ux + i.dy * uy) / D / sl,
    sx = (i.dx * -uy + i.dy * ux) / D / sl;
  if (sf < -0.6) {
    p.fsv = 2; // fade clip
    p.fade = 1;
    if (p.sqn === 0 || p.sqn === 4) (p.sq = 0.94), (p.sqn = 5);
    ppc("fade");
    txtW("FADEAWAY", p.x, p.y, 112, "#ffd23f");
  } else if (Math.abs(sx) > 0.7 && D < 237) {
    p.fsv = 20; // leaner clip
    p.fade = 2;
    if (p.sqn === 0 || p.sqn === 4) (p.sq = 0.96), (p.sqn = 6);
    ppc("leaner");
    txtW("LEANER", p.x, p.y, 112, "#ffd23f");
  }
}
/** Catch-and-shoot buffer (human): shoot pressed with a chest / bounce pass arriving inside .45 s does not jump - it
 *  is held, and the jumper starts on the catch (pp2CsCatch). A lob still means go up and get it. */
function pp2CsBuf(p: Player, hum: boolean) {
  if (!hum || B.mode !== "pass" || B.to !== p || B.ptype === 2) return false;
  const hv = Math.hypot(B.vx, B.vy) || 1;
  if (Math.hypot(B.x - p.x, B.y - p.y) / hv > 0.45) return false;
  p.csB = T;
  return true;
}
function pp2CsCatch(p: Player, i: Input, has: boolean) {
  if (!(p.csB > T - 0.6)) return;
  if (i.su) {
    p.csB = -9; // let go before the catch: no shot
    return;
  }
  if (has && p.mode === "i" && pos === p.tm && !ftq) {
    p.csB = -9;
    i.sd = 1;
    ppc("csBuf");
    txtW("CATCH & SHOOT", p.x, p.y, 100, "#ffd23f");
  }
}
/** Step-back key with the stick held sideways: a side-step (the same hop, across instead of back). */
function pp2SideStep(p: Player, i: Input, ux: number, uy: number, D: number) {
  p.bsd = 0;
  const q = p.ssq || 0, // (a CPU side-step queued by ai: the side)
    sl = Math.hypot(i.dx, i.dy);
  p.ssq = 0;
  if (p.postA || (!q && sl < 0.5)) return;
  const lat = q ? q : (i.dx * -uy + i.dy * ux) / D / sl;
  if (Math.abs(lat) < 0.6) return;
  const s = lat > 0 ? 1 : -1;
  p.bx = (-uy / D) * s;
  p.by = (ux / D) * s;
  p.bn = 1;
  p.bsd = 1;
  ppc("sideStep");
}
/** Post back-down: strength against strength (size, build, inside / defense ratings; a human defender holding the
 *  stick into him bodies up). The stronger man moves him; a weak post man gets stood up and pushed back. */
function pp2Backdown(p: Player, d: Player, nx: number, ny: number) {
  const bu = isH(d) && d.in && d.in.dx * -nx + d.in.dy * -ny > 0.5,
    f = (p.bk * p.ht * (0.75 + p.i / 400)) / (d.bk * d.ht * (0.75 + d.d / 400) * (bu ? 1.25 : 1)),
    pd = f >= 1 ? 3 * f : 3 * f * f,
    po = f < 0.9 ? (0.9 - f) * 12 : 0;
  d.x += nx * pd;
  d.y += ny * pd;
  p.x -= nx * po;
  p.y -= ny * po;
  if (f >= 1) ppc("postWin");
  else if (po > 0) {
    ppc("postHold");
    if (isH(d)) txtW(bu ? "BODIED UP" : "HOLDS HIS GROUND", d.x, d.y, 95, "#7cff9e");
  }
}
/** Drive bump (upTick): a defender set in the driver's path (between him and the rim, feet under him) cuts him off -
 *  the drive loses the part of its speed that goes into the defender, by size/strength; a defender who is beaten or
 *  moving gets bumped off his line. Replaces the v5.3 recoil. This is the contact, so a charge is read here (collide
 *  would only see the slowed driver). Returns true when a charge was whistled. */
function pp2Bump(o: Player, d: Player, nx: number, ny: number, dd: number) {
  const hx = hoop(o.tm),
    rl = Math.hypot(hx - o.x, HY - o.y) || 1,
    ahead = ((d.x - o.x) * (hx - o.x) + (d.y - o.y) * (HY - o.y)) / rl,
    ds = Math.hypot(d.vx, d.vy),
    set = d.z <= 0 && ahead > 6 && (ds < 120 || (d.stc && ds < 170)),
    f = (o.bk * o.ht * (0.8 + o.s / 500)) / (d.bk * d.ht * (0.8 + d.d / 500) * (d.stc ? 1.15 : 1)),
    vn = o.vx * nx + o.vy * ny;
  if (set) {
    if (vn > 170 && fc <= 0 && rs <= 0 && !ftq && inb <= 0 && cfg.FOULS) {
      fc = 2; // (the contact-foul cooldown, as in collide)
      if (pp2Charge(d, o, Math.hypot(d.x - hx, d.y - HY) < 40)) {
        pp2ChargeCall(d, o);
        return true;
      }
    }
    const keep = clamp(0.2 + 0.35 * f, 0.25, 0.75);
    if (vn > 0) (o.vx -= nx * vn * (1 - keep)), (o.vy -= ny * vn * (1 - keep));
    d.x += nx * 1.2 * f;
    d.y += ny * 1.2 * f;
    ppc("cutOff");
    if (isH(d)) txtW("CUT OFF", d.x, d.y, 95, "#7cff9e");
    else if (isH(o)) txtW("BODIED UP", o.x, o.y, 95, "#ff9966");
  } else {
    o.vx *= 0.93;
    o.vy *= 0.93;
    d.x += nx * 3.5 * f;
    d.y += ny * 3.5 * f;
    d.slow = Math.max(d.slow, 0.3);
    ppc("bumpOff");
    if (isH(o)) txtW("BUMPED HIM OFF", o.x, o.y, 95, "#ffd23f");
  }
  void dd;
  return false;
}
/** Offensive foul on the driver h: the defender o took the charge (same call as collide's). */
function pp2ChargeCall(o: Player, h: Player) {
  txtW("CHARGE!", h.x, h.y, 95, "#ff6b4a");
  o.act = 3; // took the charge: on the floor
  o.actT = 1.2;
  h.cel = 12; // arguing the call
  h.celT = CEL_T;
  tf[h.tm]++;
  h.pf++;
  o.stt.chg++;
  fx({ k: "whistle", tm: h.tm });
  cm("charge", o.n, h.n);
  whistle(h, o, 0.55);
  setup(o.tm);
}
/** Block timing: a blocker at the top of his jump gets there; rising early or already coming down, much less. */
export function pp2BlkT(b: Player) {
  return clamp(1.3 - Math.abs(b.vz) / 200, 0.55, 1.3);
}
/** Charge or block, read from position: a charge needs a defender whose feet were set (p.stillT) outside the restricted
 *  area, hit square in the chest by a driver at speed. Draws one number only when a charge is possible. */
function pp2Charge(o: Player, h: Player, ra: boolean) {
  // (runs after the collision impulse: speeds are post-contact, so read the set feet from before it - stillT, counted in
  // upTick - and the line of the drive from the driver's facing)
  if (ra || o.z > 4 || Math.hypot(h.pvx || 0, h.pvy || 0) < 150) return false; // (he must be the one driving into it)
  const dx = o.x - h.x,
    dy = o.y - h.y,
    dl = Math.hypot(dx, dy) || 1,
    fr = (Math.cos(h.f) * dx + Math.sin(h.f) * dy) / dl, // 1 = straight into his chest
    st = o.stillT || 0;
  let pc = 0;
  // (a defender who stepped into him - last tick's velocity toward the driver - is blocking, never a charge)
  if (fr > 0.55 && ((o.pvx || 0) * -dx + (o.pvy || 0) * -dy) / dl < 60) pc = st > 0.3 ? 0.72 : st > 0.12 ? 0.45 : 0.15;
  if (pc > 0 && o.helpT > 0) pc += 0.08;
  if (pc > 0) ppc("chargeRead");
  return pc > 0 && Math.random() < pc;
}
/** Blocking-foul odds factor: a defender moving into the driver fouls more, a set one less. */
function pp2BlkK(o: Player) {
  return (o.stillT || 0) > 0.3 ? 0.6 : Math.hypot(o.vx, o.vy) > 90 ? 1.3 : 1;
}
/** On-ball stance (human): a stick pushed roughly toward the handler's line is bent 30% toward the cut-off point - a
 *  step in front of where he will be in a quarter second - so slides take the right angle instead of chasing him. */
function pp2Angle(p: Player, i: Input, o: Player) {
  const sl = Math.hypot(i.dx, i.dy);
  if (sl < 0.3) return;
  const hx = hoop(o.tm),
    rl = Math.hypot(hx - o.x, HY - o.y) || 1,
    ax = o.x + o.vx * 0.25 + ((hx - o.x) / rl) * 22 - p.x,
    ay = o.y + o.vy * 0.25 + ((HY - o.y) / rl) * 22 - p.y,
    al = Math.hypot(ax, ay);
  if (al < 4 || (i.dx * ax + i.dy * ay) / (sl * al) < 0.3) return;
  const nx = i.dx * 0.7 + (ax / al) * sl * 0.3,
    ny = i.dy * 0.7 + (ay / al) * sl * 0.3,
    nl = Math.hypot(nx, ny) || 1;
  i.dx = (nx / nl) * sl;
  i.dy = (ny / nl) * sl;
}
/** Closeout (human defender): pushing the stick at the ball handler from 45-160 px is a closeout - a half-second burst
 *  (the stance takes over and chops the feet once he is there). */
function pp2Close(p: Player, i: Input, has: boolean) {
  const o = B.owner;
  if (has || !o || o.tm === p.tm || p.mode !== "i" || p.z > 0 || p.coT > 0) return;
  const dx = o.x - p.x,
    dy = o.y - p.y,
    d = Math.hypot(dx, dy),
    sl = Math.hypot(i.dx, i.dy);
  if (d < 45 || d > 160 || sl < 0.6 || (i.dx * dx + i.dy * dy) / (d * sl) < 0.6 || p.coT > -0.5) return; // (one per second)
  p.coT = 0.5;
  ppc("closeout");
}
/** Off the ball on offense (human): the pass key calls for the ball (the CPU handler feeds him if the lane is open). */
function pp2Call(p: Player, hum: boolean) {
  const h = B.owner;
  if (!hum || !h || h === p || h.tm !== p.tm || pos !== p.tm) return false;
  p.cfbT = T;
  if (!PREDICT) {
    p.callT = 0.6; // (the face shouts for it)
    ppc("callBall");
    txtW("BALL!", p.x, p.y, 100, "#9fe7ff");
  }
  return true;
}
/** CPU handler: a human teammate who called for it gets it at once when the lane is open (one look per call). */
function pp2Feed(p: Player, i: Input) {
  const t = p.tm;
  for (const r of P) {
    if (r.tm !== t || r === p || r.off || !(r.cfbT != null && T - r.cfbT < 0.9)) continue;
    if (T - LASTP[t] < 0.3 || Math.hypot(r.x - p.x, r.y - p.y) > 330) return false;
    const dx = r.x - p.x,
      dy = r.y - p.y,
      l2 = dx * dx + dy * dy || 1;
    for (const e of P)
      if (e.tm !== t && !e.off) {
        const u = clamp(((e.x - p.x) * dx + (e.y - p.y) * dy) / l2, 0, 1);
        if (Math.hypot(p.x + dx * u - e.x, p.y + dy * u - e.y) < 14) {
          r.cfbT = null; // lane closed: he has to get open and call again
          ppc("feedDenied");
          if (isH(r)) txtW("DENIED", r.x, r.y, 95, "#ff9966");
          return false;
        }
      }
    r.cfbT = null;
    i.pass = r;
    ppc("feed");
    return true;
  }
  return false;
}
/** Post key away from the post (human): with the ball beyond 19 ft it calls a ball screen from the best big; off the
 *  ball it calls a pin-down from the nearest teammate. Once per 2 s. */
function pp2Screen(p: Player, has: boolean, D: number) {
  const t = p.tm,
    h = B.owner;
  if (PREDICT || !h || h.tm !== t || pos !== t || T - (p.scrCall ?? -9) < 2 || cfg.NP < 2 || (has && D < 190)) return;
  const pl = PLAY[t];
  if (pl && pl.use === p && pl.ph !== "out") return; // (already coming)
  let scr: Player | null = null,
    bv = -1e9;
  for (const q of P)
    if (q.tm === t && q !== p && q !== h && !q.off && !isH(q)) {
      const v = has ? q.ht * q.bk + q.i / 60 - Math.hypot(q.x - p.x, q.y - p.y) / 200 : -Math.hypot(q.x - p.x, q.y - p.y);
      if (v > bv) (bv = v), (scr = q);
    }
  if (!scr) return;
  p.scrCall = T;
  PLAY[t] = { kind: has ? "pnr" : "pin", t0: T, scr, use: p, def: manOf(p), ph: "go", sx: 0, sy: 0, setAt: 0 };
  ppc("callScreen");
  txtW(has ? "SCREEN!" : "PIN-DOWN!", p.x, p.y, 100, "#9fe7ff");
}
/** Off-ball cut on a stick flick (human, offense, no ball): a burst the way he flicked it; at the rim past a
 *  defender who is denying him (playing the passing lane) it is a backdoor that leaves him a step behind. */
function pp2Cut(p: Player, i: Input, has: boolean, ux: number, uy: number, D: number) {
  const ox = p.pdx || 0,
    oy = p.pdy || 0,
    pm = Math.hypot(ox, oy),
    sl = Math.hypot(i.dx, i.dy);
  p.pdx = i.dx;
  p.pdy = i.dy;
  if (has || pos !== p.tm || !B.owner || B.owner.tm !== p.tm || sl < 0.9 || p.mode !== "i" || p.z > 0) return;
  // a flick: from a resting stick (or from the other way) to full in one tick
  if (!(pm < 0.3 || (ox * i.dx + oy * i.dy) / (pm * sl) < -0.3)) return;
  if (p.cutT > -0.3) return; // (one per 0.75 s)
  p.cutT = 0.45;
  ppc("cut");
  const md = manOf(p),
    toRim = (i.dx * ux + i.dy * uy) / (D * sl);
  if (!PREDICT && md && !md.off && toRim > 0.5) {
    // denying: his defender is up the line between him and the ball, not between him and the rim
    const bx = B.x - p.x,
      by = B.y - p.y,
      bl = Math.hypot(bx, by) || 1,
      mdx = md.x - p.x,
      mdy = md.y - p.y,
      deny = Math.hypot(mdx, mdy) < 40 && (mdx * bx + mdy * by) / bl > 4 && (mdx * ux + mdy * uy) / D < 8;
    if (deny && Math.random() < 0.45 + (p.s - md.d) / 200) {
      md.slow = Math.max(md.slow, 0.5);
      ppc("backdoor");
      txtW("BACKDOOR!", p.x, p.y, 100, "#ffd23f");
    }
  }
}

export function step(p: Player, dt: number) {
  const i = p.in,
    has = B.owner === p,
    oh = hoop(p.tm),
    ux = oh - p.x,
    uy = HY - p.y,
    D = Math.hypot(ux, uy) || 1,
    hum = isH(p),
    TEMPO = hum ? tempoOf(p) : 0;
  p.cd -= dt;
  p.slow -= dt;
  p.sbw -= dt;
  p.pT = (p.pT || 0) - dt;
  p.bmp = Math.max(0, (p.bmp || 0) - dt * 1.5);
  p.scr = Math.max(0, (p.scr || 0) - dt);
  p.setT = (p.setT || 0) - dt;
  p.manT = (p.manT || 0) - dt;
  p.hitT = Math.max(0, (p.hitT || 0) - dt);
  if (p.frT > 0) p.frT -= dt;
  if (p.celT > 0) p.celT = Math.max(0, p.celT - dt);
  if (p.actT > 0) p.actT = Math.max(0, p.actT - dt);
  if (p.ttT > 0) p.ttT = Math.max(0, p.ttT - dt);
  if (p.chinT > 0) p.chinT = Math.max(0, p.chinT - dt);
  if (p.hdgT > 0) p.hdgT = Math.max(0, p.hdgT - dt);
  // scouting the drive: which way does this handler go when he attacks the basket? (+ = his right, decays slowly)
  if (B.owner === p && p.mode === "i" && !PREDICT) {
    const hx = hoop(p.tm),
      dx = hx - p.x,
      dy = HY - p.y,
      dd = Math.hypot(dx, dy),
      sv = Math.hypot(p.vx, p.vy);
    if (dd < 320 && dd > 60 && sv > 140 && (p.vx * dx + p.vy * dy) / (dd * sv) > 0.5) {
      const side = (p.vx * dy - p.vy * dx) / (dd * sv); // + = drifting to the right of the line to the rim
      p.drv = clamp((p.drv || 0) * (1 - dt * 0.08) + Math.sign(side) * dt * (Math.abs(side) > 0.15 ? 1 : 0), -3, 3);
    }
  }
  if (p.upu > 0) p.upu -= dt;
  if (ftq && ftq.s === p && has && p.mode === "i") p.ftT = (p.ftT || 0) + dt;
  else p.ftT = 0;
  p.landT = Math.max(0, (p.landT || 0) - dt);
  if (p.plantT > 0) p.plantT -= dt;
  if (p.fsT > 0) p.fsT -= dt;
  if (p.hupT > 0) p.hupT -= dt;
  if (p.helpT > 0) p.helpT -= dt;
  if (p.swT > 0) p.swT -= dt;
  if (p.rotT > 0) p.rotT -= dt;
  if (p.kickT > 0) p.kickT -= dt;
  if (p.engT > 0) p.engT -= dt;
  {
    // smoothed acceleration along the facing direction (body leans into it)
    const ax = (p.vx - (p.pvx || 0)) / dt,
      ay = (p.vy - (p.pvy || 0)) / dt;
    p.acc = (p.acc || 0) * 0.85 + (ax * Math.cos(p.f) + ay * Math.sin(p.f)) * 0.15;
    p.pvx = p.vx;
    p.pvy = p.vy;
  }
  {
    const sv2 = Math.hypot(p.vx, p.vy);
    // sprinting burns the tank fast; running up and down slowly wears everyone down (subs in 5v5); standing recovers
    const rot = cfg.SUBS && cfg.NP > 1 && !PREDICT && cfg.GM === "game",
      use = i.sp && sv2 > 150 ? 0.1 : rot ? (sv2 > 60 ? sv2 * 0.00013 : -0.01) : -0.04;
    p.en = Math.max(0, Math.min(1, (p.en == null ? 1 : p.en) - dt * use));
  }
  // (not when the new stick points back away from the rim: that is a retreat dribble, and a move would drive him
  // right back at the basket)
  if (has && p.mode === "i" && p.cd <= 0 && !(p.mvT > 0) && (i.dx || i.dy) && p.li && i.dx * p.li[0] + i.dy * p.li[1] < -0.3 && Math.hypot(p.vx, p.vy) > 110 && (i.dx * ux + i.dy * uy) / D > -0.5 * Math.hypot(i.dx, i.dy))
    i.mv = i.mv || (cfg.PP ? 6 : 3); // (Pro Play: flick-to-cross is a crossover)
  if (i.dx || i.dy) p.li = [i.dx, i.dy];
  p.postA = has && i.post && p.mode === "i" && D < 190 && !ftq && !(p.mvT > 0) ? 1 : 0;
  if (p.postA) {
    i.dx = (ux / D) * 0.3;
    i.dy = (uy / D) * 0.3;
  }
  if (cfg.PP) {
    if (hum && has && p.mode === "i") ppBuffer(p, i);
    ppStance(p, i, has, hum);
    p.spT = hum && i.sp ? (p.spT || 0) + dt : 0;
    if (cfg.PP >= 2 && hum) {
      if (i.post && !p.postA) pp2Screen(p, has, D); // (post key away from the post: call a screen)
      pp2Cut(p, i, has, ux, uy, D);
      pp2Close(p, i, has);
    }
  }
  if (p.mvT > 0) {
    p.mvE = (p.mvE || 0) + dt;
    p.mvT -= dt;
    if (p.mvT <= 0) p.mvEnd = T;
    const e = p.mvE,
      S = p.mvS || 1,
      k = p.mvk;
    let f = 0,
      l = 0;
    if (k === 1) {
      if (e < 0.22) f = 0.05;
      else {
        f = 1.5;
        l = 0.25;
      }
    } else if (k === 2) {
      if (e < 0.15) l = 0.6;
      else {
        l = 0.9;
        f = 0.9;
      }
    } else if (k === 3) {
      if (e < 0.3) {
        l = 1.3;
        f = 0.3;
      } else f = 1.1;
    } else if (k >= 5) [f, l] = upMoveVel(k, e);
    else {
      if (e < 0.15) {
        l = 0.7;
        f = 0.2;
      } else {
        l = 0.2;
        f = 1.4;
      }
    }
    i.dx = (ux / D) * f - (uy / D) * l * S;
    i.dy = (uy / D) * f + (ux / D) * l * S;
    if (p.mvT <= 0 && k === 4 && has) {
      p.hk = 1;
      i.sd = 1;
      i.su = 1;
    }
  } else if (i.mv && has && p.mode === "i" && p.cd <= 0 && !ftq && pos === p.tm) {
    const d = P[nearest(1 - p.tm, p.x, p.y)],
      dist = Math.hypot(d.x - p.x, d.y - p.y),
      S = -uy * (p.x - d.x) + ux * (p.y - d.y) >= 0 ? 1 : -1,
      u = hum;
    if (p.postA) {
      if (i.mv === 2 && p.upu > 0) {
        p.mvk = 4;
        p.mvT = 0.45;
        p.mvE = 0;
        p.mvS = -S; // fake one way, spin back the other
        p.cd = 0.9;
        if (!PREDICT && dist < 40) (d.slow = Math.max(d.slow, 0.9)), (d.act = 3), (d.actT = 0.8);
        if (u) txtW("DREAM SHAKE!", p.x, p.y, 100, "#ffd23f");
      } else if (i.mv === 1) {
        p.hk = 1;
        p.fsv = 10;
        i.sd = 1;
        i.su = 1;
        if (u) txtW("HOOK", p.x, p.y, 100, "#ffd23f");
      } else if (i.mv === 3) {
        p.hk = 1;
        p.fsv = 2;
        i.sd = 1;
        i.su = 1;
        if (u) txtW("TURNAROUND", p.x, p.y, 100, "#ffd23f");
      } else if (i.mv === 2) {
        p.mvk = 4;
        p.mvT = 0.48;
        p.mvE = 0;
        p.mvS = -S; // spin away from the defender's top shoulder, to the baseline
        p.cd = 0.9;
        if (!PREDICT && dist < 30 && Math.random() < 0.45 + (p.s - d.d) / 300) d.slow = Math.max(d.slow, 0.55);
        if (u) txtW("POST SPIN", p.x, p.y, 100, "#ffd23f");
      } else {
        p.mvk = 4;
        p.mvT = 0.4;
        p.mvE = 0;
        p.mvS = S;
        p.cd = 0.9;
        if (u) txtW("DROP STEP", p.x, p.y, 100, "#ffd23f");
      }
    } else if (cfg.PP) upMoveStart(p, i, d, dist, S, u, ux, uy, D);
    else {
      // chaining moves right off the end of the last one builds a combo: quicker, and harder to stay in front of
      p.combo = p.mvEnd != null && T - p.mvEnd < 0.5 && p.mvk !== i.mv ? Math.min(4, (p.combo || 1) + 1) : 1;
      p.mvk = i.mv;
      p.mvT = p.combo > 1 ? 0.42 : 0.5;
      p.mvE = 0;
      p.mvS = S;
      p.cd = 0.55;
      if (u) txtW(["", "HESITATION", "SPIN MOVE", "BEHIND THE BACK"][i.mv] + (p.combo > 1 ? " · COMBO x" + p.combo : ""), p.x, p.y, 100, "#ffd23f");
      if (!PREDICT && dist < 60 && Math.random() < 0.5 + (p.s - d.d) / 250 + (hasB(p, "AB") ? 0.12 : 0) + (p.combo - 1) * 0.12) {
        d.slow = Math.max(d.slow, 0.7);
        d.scr = Math.max(d.scr || 0, 0.35);
        // the defender's feet get crossed up: a hard sideways stumble (pose spring + flailing arms)
        d.hitT = 0.34;
        d.hitX = -uy * S;
        d.hitY = ux * S;
        if (u) txtW("ANKLE BREAKER!", d.x, d.y, 95, "#ff6b6b");
      }
    }
  }

  // a diving or fallen player has no control until he is back up
  if (p.actT > 0 && (p.act === 3 || p.act === 4)) {
    i.dx = i.dy = 0;
    i.sd = i.su = i.e = i.mv = i.pf = 0;
    p.vx *= p.act === 4 ? 0.9 : 0.6;
    p.vy *= p.act === 4 ? 0.9 : 0.6;
  }
  if (has && p.mode === "i" && Math.hypot(p.vx, p.vy) > 70) p.ttT = 0; // leaves the triple threat once he drives
  // Pump fake (no stick) / jab step (stick held) / shoulder fake (posting up). Defenders can bite.
  if (i.pf && has && p.mode === "i" && pos === p.tm && p.cd <= 0 && !ftq && !(p.mvT > 0)) {
    const d = P[nearest(1 - p.tm, p.x, p.y)],
      dist = Math.hypot(d.x - p.x, d.y - p.y),
      stick = Math.hypot(i.dx, i.dy) > 0.5;
    p.cd = 0.45;
    if (p.postA) {
      p.act = 8; // shoulder fake
      p.actT = 0.4;
      p.upu = 1.3; // the next shot / drop step out of the post becomes an up-and-under / dream shake
      if (!PREDICT && dist < 40 && Math.random() < 0.55 - d.d / 300) (d.slow = Math.max(d.slow, 0.6)), (d.hitT = 0.2), (d.hitX = (p.x - d.x) / (dist || 1)), (d.hitY = (p.y - d.y) / (dist || 1));
      if (hum) txtW("SHOULDER FAKE", p.x, p.y, 100, "#ffd23f");
    } else if (stick && Math.hypot(p.vx, p.vy) < 70) {
      p.act = 2; // jab step toward the stick
      p.actT = 0.38;
      p.jabX = i.dx;
      p.jabY = i.dy;
      p.ttT = Math.max(p.ttT || 0, 0.6);
      if (!PREDICT && dist < 60 && Math.random() < 0.6 - d.d / 250) {
        d.slow = Math.max(d.slow, 0.45);
        d.vx += i.dx * 60;
        d.vy += i.dy * 60;
      }
      if (hum) txtW("JAB STEP", p.x, p.y, 100, "#ffd23f");
    } else {
      p.act = 1; // pump fake
      p.actT = 0.42;
      p.ttT = Math.max(p.ttT || 0, 0.6);
      let bit = 0;
      if (!PREDICT)
        for (const q of P)
          if (q.tm !== p.tm && q.z <= 0 && Math.hypot(q.x - p.x, q.y - p.y) < 55 && Math.random() < 0.62 - q.d / 260) {
            q.vz = 126 + q.j * 0.9; // leaves his feet
            q.slow = Math.max(q.slow, 0.5);
            bit = 1;
          }
      if (hum) txtW(bit ? "PUMP FAKE — BIT!" : "PUMP FAKE", p.x, p.y, 100, "#ffd23f");
    }
    i.sd = 0;
  }
  // backing down in the post: shoulder bumps into the defender every ~0.45 s
  if (p.postA && has && !PREDICT) {
    p.bdT = (p.bdT || 0) + dt;
    const d = P[nearest(1 - p.tm, p.x, p.y)],
      dist = Math.hypot(d.x - p.x, d.y - p.y);
    if (dist < 22 && p.bdT > 0.45) {
      p.bdT = 0;
      const nx = (d.x - p.x) / (dist || 1),
        ny = (d.y - p.y) / (dist || 1),
        f = (p.bk * p.ht) / (d.bk * d.ht);
      if (cfg.PP >= 2) pp2Backdown(p, d, nx, ny); // (v5.4: strength vs strength)
      else {
        d.x += nx * 3 * f;
        d.y += ny * 3 * f;
      }
      d.hitT = 0.16;
      d.hitX = nx;
      d.hitY = ny;
      p.hitT = 0.12;
      p.hitX = -nx;
      p.hitY = -ny;
    }
  }
  if (p.mode === "i" && i.sb && has && pos === p.tm && p.cd <= 0 && D > 60) {
    p.mode = "b";
    p.t = 0;
    p.bn = p.st === 1 ? 2 : 1;
    p.cd = 1.6;
    p.bx = -ux / D;
    p.by = -uy / D;
    if (cfg.PP >= 2) pp2SideStep(p, i, ux, uy, D); // (stick held sideways: a side-step)
    if (!PREDICT) {
      const d = P[nearest(1 - p.tm, p.x, p.y)];
      d.slow = 0.5 + 0.25 * p.bn;
      if (Math.hypot(d.x - p.x, d.y - p.y) < 30 && Math.random() < 0.12 + (p.s - d.d) / 400 + (hasB(p, "AB") ? 0.12 : 0)) {
        d.act = 3; // lost his footing on the step-back
        d.actT = 1.0;
        if (hum) txtW("SHOOK HIM!", d.x, d.y, 95, "#ff6b6b");
      }
    }
    if (hum) txtW(cfg.PP >= 2 && p.bsd ? "SIDE-STEP!" : p.bn > 1 ? "DOUBLE STEP-BACK!" : "STEP-BACK!", p.x, p.y, 95, "#ffd23f");
  }
  if (p.mode === "b") {
    p.t += dt;
    const m = p.t < 0.17 || (p.bn > 1 && p.t > 0.23 && p.t < 0.4);
    p.vx = m ? p.bx * 190 : 0;
    p.vy = m ? p.by * 190 : 0;
    if (i.sd && p.t > 0.12 && has) {
      p.mode = "c";
      p.t = 0;
      p.sbw = 0.9;
      if (cfg.PP >= 2) (p.sqn = 0), (p.fade = 0); // (a step-back jumper is balanced by definition: its own rhythm)
    } else if (p.t >= (p.bn > 1 ? 0.4 : 0.2)) {
      p.mode = "i";
      p.sbw = 0.9;
      p.vx = p.vy = 0;
    }
  }
  if (cfg.PP >= 2 && hum) pp2CsCatch(p, i, has); // (a shot pressed as the pass arrived goes up on the catch)
  if (p.mode === "i") {
    if (i.sd) {
      if (has && pos === p.tm) {
        p.mode = "c";
        p.t = 0;
        if (TEMPO) i.su = 1;
        if (cfg.PP) upGatherStart(p, ux, uy, D);
        if (cfg.PP >= 2) pp2Gather(p, i, ux, uy, D, hum); // (pull-up out of a move; balance of the jumper; stick-picked fade / leaner)
      } else if (!has && p.z <= 0 && !(cfg.PP >= 2 && pp2CsBuf(p, hum))) {
        // (Pro Play v2: not with a pass about to arrive - that press is a catch-and-shoot)
        p.vz = (126 + p.j * 0.9) * (1 - 0.12 * ph3Fat(p)); // (Physics v3: tired legs jump lower)
        // jumping at a shot that's already gone: he lands off balance
        if (B.sh && B.last && B.last.tm !== p.tm && B.age > 0.12 && Math.hypot(B.last.x - p.x, B.last.y - p.y) < 40) p.lateJ = 1;
      }
    }
    if (has && (i.pass || i.e || i.lob)) {
      const r = i.pass || pick(p, i);
      // (a fronted post man - his defender between him and the ball - gets it over the top)
      const fronted = !!r && !isH(p) && r.br === "seal" && (() => {
          const d = manOf(r);
          return !!d && Math.hypot(d.x - r.x, d.y - r.y) < 24 && Math.hypot(d.x - p.x, d.y - p.y) < Math.hypot(r.x - p.x, r.y - p.y);
        })(),
        lobIt = !i.lob && !isH(p) && r && (fronted || (r.j >= (cfg.ASTAR ? 45 : 55) && Math.hypot(hoop(r.tm) - r.x, HY - r.y) < (cfg.ASTAR ? 140 : 100) && Math.random() < (cfg.ASTAR ? 0.92 : 0.6)));
      if (r && !PREDICT) pass(p, r, i.lob || lobIt ? 2 : undefined);
    } else if (i.e && !(cfg.PP >= 2 && pp2Call(p, hum)) && p.cd <= 0) {
      // (Pro Play v2: off the ball on offense the pass key calls for the ball)
      p.cd = 0.8; // steals are OFF by design (user request): reach-ins do nothing
    }
  }
  if (p.mode === "c") {
    p.t += dt;
    if (!(cfg.PP && upGather(p, i, dt, ux, uy, D, hum))) {
      p.vx *= 0.85;
      p.vy *= 0.85;
    }
    if (!has) p.mode = "i";
    else if (i.su || p.t > 1.4) {
      p.mt = i.su && i.mt != null ? clamp(i.mt, p.t - 0.25, p.t + 0.05) : p.t;
      const cto = contestOf(p);
      p.cw = Math.min(1, cto[0] + (p.bmp || 0) * 0.5);
      if (p.upu > 0 && D < 120 && !ftq) {
        p.fsv = 23; // up-and-under: step through for a layup
        p.hk = 1;
        p.upu = 0;
        if (hum) txtW("UP & UNDER", p.x, p.y, 100, "#ffd23f");
      }
      p.mode = "s";
      p.t = 0;
      p.rl = 0;
      p.react = 0;
      p.dcl = 0;
      const lay = D < 90 && !ftq,
        k = cfg.PP >= 2 && p.fade === 1 ? 95 : p.st === 2 ? 70 : p.st === 3 ? 110 : 0; // (Pro Play v2: a fadeaway drifts back)
      p.sv = cfg.PRO
        ? pickClip(p, D, lay)
        : lay
          ? D < 50 && p.j >= 55
            ? 6
            : 5
          : p.st === 2
            ? 2
            : p.st === 3
              ? 3
              : p.st === 4
                ? 4
                : p.st === 1
                  ? 1
                  : 0;
      if (cfg.PP) upAfterClip(p, D, lay), ppRelease(p, cto[0], cto[1], D);
      p.tp = null;
      p.vz = ftq ? 60 : ((lay ? 150 : 126) + p.j * 0.9) * (cfg.PRO && p.st === 1 && !lay ? 0.75 : 1) * (1 - 0.12 * ph3Fat(p)); // (Physics v3: tired legs)
      p.vx = ftq ? 0 : lay ? (ux / D) * 100 : cfg.PRO && p.sv === 8 ? p.vx * 0.5 : (-ux / D) * k;
      p.vy = ftq ? 0 : lay ? (uy / D) * 100 : (-uy / D) * k;
    }
  }
  if (p.mode === "s") {
    if (TEMPO && i.sd && p.tp == null && p.t > 0.03) p.tp = i.tp != null ? clamp(i.tp, p.t - 0.25, p.t + 0.05) : p.t;
    p.t += dt;
    if (!p.rl && has && !PREDICT && !p.react && D >= 90 && !ftq && p.t > 0.12 && p.t < 0.3) {
      // a defender flying at the shot: double-clutch under it, or hang and wait for him to come down
      const fl = P.find((o) => o.tm !== p.tm && o.z > 10 && o.vz > 0 && Math.hypot(o.x - p.x, o.y - p.y) < 28);
      if (fl) {
        p.react = 1;
        const r = Math.random();
        if (r < 0.35 + p.s / 400) {
          p.dcl = 0.1; // pull it down and bring it back up
          if (isH(p) || isH(fl)) txtW("DOUBLE CLUTCH!", p.x, p.y, 120, "#ffd23f");
        } else if (r < 0.75) {
          p.vz += 45; // hang time
          p.dcl = 0.06;
          if (isH(p) || isH(fl)) txtW("HANGS IN THE AIR", p.x, p.y, 120, "#ffd23f");
        } else p.react = 2; // rushes it out early
      }
    }
    const upq = cfg.PP && !p.rl ? upContest(p, D, has) : 0; // (lean away from a late closeout)
    if (!p.rl && has && !PREDICT && p.t >= (D < 90 ? 0.28 : p.st === 1 ? 0.3 : 0.4) + (p.dcl || 0) - (p.react === 2 ? 0.05 : 0) + upq) launch(p);
    if (p.t > 0.7 && p.z <= 0) {
      p.mode = "i";
      p.vx = p.vy = 0;
      p.hk = 0;
    }
  }
  if (p.mode === "i") {
    const sp =
        (150 + p.s * 1.1) *
        (p.scr > 0 ? 0.15 : p.slow > 0 ? 0.4 : 1) *
        (0.75 + 0.25 * (p.en == null ? 1 : p.en)) *
        (has ? 0.96 : 1) *
        (i.sp ? 1.2 : 1) *
        (p.z > 0 ? 0.5 : 1) *
        (p.stc ? 1.08 : 1) * // (Pro Play: a human in his defensive stance slides a little quicker)
        (p.cutT > 0 || p.coT > 0 ? 1.1 : 1), // (Pro Play v2: an off-ball flick cut / a closeout)
      k = Math.min(1, dt * (p.z > 0 ? 1.5 : 9));
    if (cfg.PRO && p.z <= 0) {
      const dx = i.dx * sp - p.vx,
        dy = i.dy * sp - p.vy,
        dl = Math.hypot(dx, dy),
        cur = Math.hypot(p.vx, p.vy),
        brk = cur > 40 && dx * p.vx + dy * p.vy < 0,
        first = (p.fsT || 0) > 0,
        ac = (brk ? (p.plantT > 0 ? 1500 : 1100) : (620 + p.s * 3) * (first ? 1.55 : 1)) * (p.mvT > 0 ? 2.6 : 1) * (p.stc ? 1.3 : p.spT > 0 && p.spT < 0.35 ? 1.35 : 1) * (p.cutT > 0 ? 1.4 : p.coT > 0 ? 1.35 : 1) * (1 - 0.22 * ph3Fat(p)) * dt, // (+ stance slides / sprint burst / cut / closeout; Physics v3: tired = slower to get going and to stop)
        mm = Math.min(dl, ac);
      // a hard cut at speed: plant the outside foot (two-three steps to stop), and sometimes slip
      if (brk && cur > 170 && !(p.plantT > 0) && !(p.brk > 0.5)) {
        p.plantT = 0.2;
        ph3Squeak(p, cur); // (Physics v3: shoe squeak, FX for the audio)
        if (!PREDICT && cur > 235 && Math.random() < 0.025 + (78 - p.s) / 1500 + 0.2 * wetAt(p.x, p.y)) {
          p.hitT = 0.3;
          p.hitX = p.vx / cur;
          p.hitY = p.vy / cur;
          p.slow = Math.max(p.slow, 0.35);
          if (isH(p)) txtW("SLIPPED!", p.x, p.y, 90, "#ff9966");
          if (cfg.PH3) ph3Slip(p); // (a sweat spot: Physics v3)
        }
      }
      // explosive first step out of a standstill
      if (cur < 35 && Math.hypot(i.dx, i.dy) > 0.6) p.fsT = 0.28;
      if (dl > 0) {
        p.vx += (dx / dl) * mm;
        p.vy += (dy / dl) * mm;
      }
      p.brk = brk ? 1 : Math.max(0, (p.brk || 0) - dt * 4);
    } else {
      p.vx += (i.dx * sp - p.vx) * k;
      p.vy += (i.dy * sp - p.vy) * k;
    }
  }
  p.x = clamp(p.x + p.vx * dt, 8, CW - 8);
  p.y = clamp(p.y + p.vy * dt, 8, CH - 8);
  const sv = Math.hypot(p.vx, p.vy);
  p.ph += ((sv * dt) / stepLen(sv)) * Math.PI; // one step = half a gait cycle, so the feet travel with the body
  if (p.mode !== "i") p.f = Math.atan2(uy, ux);
  else {
    let tf: number | null = null;
    if (pos !== p.tm && B.owner) tf = Math.atan2(B.y - p.y, B.x - p.x);
    else if (has) tf = sv > 1 && (p.vx * ux + p.vy * uy) / D < -0.3 * sv ? Math.atan2(uy, ux) : sv > 20 ? Math.atan2(p.vy, p.vx) : null;
    else tf = sv > 150 ? Math.atan2(p.vy, p.vx) : Math.atan2(B.y - p.y, B.x - p.x);
    if (tf != null) {
      const dd = Math.atan2(Math.sin(tf - p.f), Math.cos(tf - p.f));
      p.f += dd * Math.min(1, dt * 10);
    }
  }
  if (p.postA) p.f = Math.atan2(-uy, -ux);
  if (p.hangT > 0) {
    // hanging on the rim after a dunk: hands on the iron, body under the front of the rim
    p.hangT -= dt;
    if (p.hangT < 0.42 && isDunkSv(p.sv)) p.sv = 19;
    const hx = hoop(p.tm),
      dir = hx > 470 ? 1 : -1;
    p.x += (hx - dir * 9 - p.x) * Math.min(1, dt * 12);
    p.y += (HY - p.y) * Math.min(1, dt * 12);
    p.z = Math.max(p.z, 100 - (75 * p.ht) / 6.4);
    p.vx = p.vy = 0;
    p.vz = 0;
    p.f = dir > 0 ? 0 : Math.PI;
    if (p.hangT <= 0) p.vz = -10; // let go
  } else if (p.z > 0 || p.vz > 0) {
    p.vz -= g * dt;
    p.z += p.vz * dt;
    if (p.z <= 0) {
      if (cfg.PP) upLanding(p);
      else if (p.vz < -120) p.landT = Math.min(0.28, -p.vz / 900); // absorb the landing
      if (cfg.PH3) ph3Land(p, -p.vz); // (tired legs land heavy)
      if (p.lateJ && !PREDICT) {
        p.lateJ = 0;
        const d = Math.hypot(p.vx, p.vy) || 1;
        p.hitT = 0.28;
        p.hitX = p.vx / d || Math.cos(p.f);
        p.hitY = p.vy / d || Math.sin(p.f);
        p.slow = Math.max(p.slow, 0.45);
      }
      p.z = 0;
      p.vz = 0;
    }
  }
}
function mv(p: Player, tx: number, ty: number, s = 1) {
  const dx = tx - p.x,
    dy = ty - p.y,
    d = Math.hypot(dx, dy);
  if (d > 6) {
    p.in.dx = (dx / d) * Math.min(1, d / 30) * s;
    p.in.dy = (dy / d) * Math.min(1, d / 30) * s;
  }
}
const NOIN = (o: Input) => {
  o.dx = o.dy = 0;
  o.sd = o.su = o.e = o.sb = o.mv = o.post = o.lob = o.sp = o.pass = o.sw = o.mt = o.tp = undefined;
  return o;
};
export function ai(p: Player, dt: number) {
  p.br = ""; // (the off-ball branch tag is per tick)
  const NP = cfg.NP,
    a = p.ai,
    t = p.tm,
    i = (p.in = NOIN(p.aiIn || (p.aiIn = { dx: 0, dy: 0 }))),
    has = B.owner === p,
    dh = hoop(1 - t),
    oh = hoop(t);
  if (rs > 0) return;
  if (has) {
    if (p.mode === "c") {
      if (p.t >= a.rel) i.su = 1;
      return;
    }
    if (p.mode !== "i") return;
    if (cfg.PP >= 2 && pp2Feed(p, i)) return; // (a human teammate called for it)
    const dn = P[nearest(1 - t, p.x, p.y)],
      D0 = Math.hypot(oh - p.x, HY - p.y);
    // step-back: a weapon to create space once the possession has developed (or the clock is running out), not the
    // first thing off the bring-up - at arcade quarter lengths it comes sooner
    {
      const pf = clamp((QTRLEN - 30) / 150, 0, 1),
        el = 24 - shot;
      if (p.cd <= 0 && D0 > 150 && Math.hypot(dn.x - p.x, dn.y - p.y) < 38 && (el > 3 + 8 * pf || shot < 8) && Math.random() < dt * 4 * tendOf(p)[5]) {
        i.sb = 1;
        // (Pro Play v2: a third of them are side-steps, away from the defender's side)
        if (cfg.PP >= 2 && Math.random() < 0.35) p.ssq = (dn.x - p.x) * -(HY - p.y) + (dn.y - p.y) * (oh - p.x) >= 0 ? -1 : 1;
      }
    }
    // the clock is about to run out (quarter or shot clock): get it up from wherever he is - a heave if he must
    if (!isH(p) && p.cd <= 0 && gameLike() && !cfg.HALF && Math.min(clock, shot) < 1.25 && (D0 < 520 || clock < 1.25)) {
      if (D0 > 420) txtW("HEAVE!", p.x, p.y, 90, "#ffd23f");
      i.sd = 1;
      a.rel = 0.42;
      a.r = 0;
      return;
    }
    if (p.sbw > 0 && D0 > 120) {
      i.sd = 1;
      a.rel = (p.st === 1 ? 0.45 : 0.6) + (Math.random() - 0.5) * 0.16;
      a.r = 0;
      return;
    }
    const D = Math.hypot(oh - p.x, HY - p.y),
      md = manOf(p),
      dirO = oh > 470 ? -1 : 1;
    // transition: a live-ball change of possession and the defense isn't back -> push it, hit the man ahead, finish
    if (NP > 1 && !cfg.HALF && !isH(p) && T - TS.trT[t] < 4.5) {
      let back = 0,
        ahead: Player | null = null,
        av = 0;
      for (const q of P) {
        if (q.off) continue;
        const dq = Math.hypot(oh - q.x, HY - q.y);
        if (q.tm !== t && dq < D + 25) back++; // (level with him counts: he can still get back)
        if (q.tm === t && q !== p && dq < D - 80) {
          const nd = P[nearest(1 - t, q.x, q.y)],
            op = Math.hypot(nd.x - q.x, nd.y - q.y),
            v = op - dq * 0.2;
          if (op > 40 && v > av) (av = v), (ahead = q);
        }
      }
      const adv = back <= (NP >= 4 ? 1 : 0) || (back === 2 && NP === 5 && !!ahead && T - TS.trT[t] < 2.5);
      if (adv) {
        // (announced once per live-ball change of possession, however often the push stops and restarts)
        if (!TS.tr[t] && TS.fbA[t] !== TS.trT[t]) (TS.fbA[t] = TS.trT[t]), (STAT.fb = (STAT.fb || 0) + 1), txtW(back ? "FAST BREAK" : "OPEN FLOOR", p.x, p.y, 90, "#ffd23f"), exc(0.5), cm("break", p.n, back ? "" : "open");
        TS.tr[t] = 1;
        if (ahead && D > 150 && T - LASTP[t] > 0.5 && Math.random() < dt * 6) {
          i.pass = ahead; // hit the man ahead (a lob if he's at the rim)
          if (Math.hypot(oh - ahead.x, HY - ahead.y) < 90 && ahead.j >= 60) i.lob = 1;
          return;
        }
        if (D < 75 && p.cd <= 0) {
          i.sd = 1;
          a.rel = 0.45;
          a.r = 0;
          return;
        }
        mv(p, oh, HY + clamp(p.y - HY, -40, 40) * 0.5, 1);
        i.sp = 1;
        a.r = 0;
        return;
      }
      if (T - TS.trT[t] > 1.5) TS.tr[t] = 0; // the defense got back: run the half-court offense
    } else TS.tr[t] = 0;
    // dribble handoff: a big with the ball out top holds it for a shooter running off him, hands it over at the hip
    // and stays planted as the screen (the defender trailing the shooter runs into him)
    if (NP >= 3 && !isH(p) && !cfg.HALF && !TS.tr[t] && D > 185 && D < 300 && shot > 7) {
      if (!a.dho && (p.c < 74 || p.ht >= 6.85) && Math.random() < dt * 0.7) {
        let best: Player | null = null,
          bv = 0;
        for (const q of P)
          if (q.tm === t && q !== p && !q.off && q.c >= 74 && !isH(q)) {
            const v = q.c - Math.hypot(q.x - p.x, q.y - p.y) * 0.08;
            if (v > bv) (bv = v), (best = q);
          }
        if (best) (a.dho = best), (a.dhoT = T), (best.ai.dhoBy = p);
      }
      if (a.dho) {
        const g = a.dho as Player;
        if (T - a.dhoT > 3.5 || g.tm !== t || g.off) (a.dho = null), (g.ai.dhoBy = null);
        else {
          if (Math.hypot(g.x - p.x, g.y - p.y) < 22) {
            i.pass = g;
            g.ai.dhoBy = null;
            a.dho = null;
            a.holdT = T + 0.7; // stay planted: he is the screen now
            STAT.dho = (STAT.dho || 0) + 1;
          }
          return; // (holds the ball, pivoting, until the shooter arrives)
        }
      }
    }
    // catch-and-shoot: just caught a pass with space - shoot it in rhythm (a shooter from deep, anyone from mid-range)
    if (B.pp && B.pp.p !== p && B.pp.p.tm === t && T - B.pp.t < 0.7 && !a.cs && p.cd <= 0 && !CT.some((c) => c.tm === t && c.idx === P.indexOf(p))) {
      a.cs = 1;
      const od0 = Math.hypot(dn.x - p.x, dn.y - p.y),
        good = D >= 237 ? p.c >= 70 && D < 295 : D > 90 && p.c + p.i >= 140;
      if (good && od0 > 36 && Math.random() < 0.62 + (p.c - 75) / 50) {
        i.sd = 1;
        a.rel = (p.st === 1 ? 0.45 : 0.6) + (Math.random() - 0.5) * 0.16;
        a.r = 0;
        return;
      }
    }
    if (!(B.pp && T - B.pp.t < 0.7)) a.cs = 0;
    // in the lane too long: get a shot up
    if (cfg.VIOL && TS.lane[P.indexOf(p)] > 2.3 && p.cd <= 0) {
      i.sd = 1;
      a.rel = 0.5;
      a.r = 0;
      return;
    }
    // mismatch hunting: post up a smaller defender, or blow by a slower one
    if (!a.r && cfg.NP > 1 && md && p.i >= 76 && p.ht - md.ht >= 0.3 && Math.random() < 0.6) a.post = 1;
    if (a.post) {
      a.pw = (a.pw || 0) + dt;
      if (D > 175) mv(p, oh + dirO * 70, HY + (p.y < HY ? -45 : 45), 1);
      else if (D < 70) {
        // backed him all the way down: go up strong
        i.sd = 1;
        a.rel = 0.45;
        a.post = a.pw = 0;
      } else {
        i.post = 1;
        if (a.pw > 1.1 && p.cd <= 0) {
          const r = Math.random();
          if (r < 0.25 && !(p.upu > 0)) i.pf = 1; // shoulder fake first
          else i.mv = r < 0.6 ? 1 : r < 0.85 ? 3 : 2;
          if (r >= 0.25) (a.post = 0), (a.pw = 0);
        }
      }
      if (a.pw > 2) (a.post = 0), (a.pw = 0), (i.mv = 1); // don't sit in the lane: go to the hook
      return;
    }
    if (!a.r && md && p.s - md.s >= 12 && Math.random() < 0.5) (a.r = 45 + Math.random() * 30), (a.w = 0), (a.pt = 0.8); // attack the slower man
    // down three late: it has to be a three
    if (!a.r && !isH(p) && q >= 4 && bcast() < 24 && sc[1 - t] - sc[t] === 3 && !cfg.HALF) (a.r = 248 + Math.random() * 18), (a.w = 0), (a.pt = 0.8), (a.adj = 1);
    if (!a.r) {
      // where does he want his shot? from his tendencies (Curry deep, SGA mid-range, Edwards downhill, Jokic post)
      const td = tendOf(p),
        r = Math.random() * (td[0] + td[1] + td[2] + td[3] + 0.15);
      a.w = 0;
      a.pt = 0.8;
      a.adj = 0;
      if (r < td[0] && p.c >= 70) a.r = (p.c >= 90 ? 255 : 240) + Math.random() * (p.c >= 95 ? 70 : 25);
      else if (r < td[0] + td[1]) a.r = 140 + Math.random() * 80;
      else if (r < td[0] + td[1] + td[2]) a.r = 40 + Math.random() * 40;
      else if (r < td[0] + td[1] + td[2] + td[3] && cfg.NP > 1 && p.i >= 70) {
        a.post = 1;
        return;
      } else a.r = p.c < 50 ? 55 + Math.random() * 40 : 100 + Math.random() * 130;
      // two-for-one: ~35 s left in the quarter, get a quick shot up so you get the last possession too
      if (clock > shot + 4 && clock < shot + 14 && QTRLEN >= 60) a.w = 0.3;
    }
    if (cfg.PP && upCpuGather(p, D)) return; // (attack the rim with a gather from 9-14 ft)
    if (D > a.r) mv(p, oh, HY + Math.sin(T * 1.5 + p.k) * 90, 1);
    else {
      a.w += dt;
      i.sp = 0;
      const dd0 = Math.hypot(dn.x - p.x, dn.y - p.y),
        closing = (dn.vx * (p.x - dn.x) + dn.vy * (p.y - dn.y)) / (dd0 || 1);
      if (!a.fk && D > 120 && dd0 < 34 && closing > 90 && p.cd <= 0 && Math.random() < 0.4) {
        i.pf = 1;
        a.fk = 1;
        a.w = 0.25;
        return;
      }
      // smothered behind the arc (or he's cold from there): don't force it - jab and go to the pull-up, or drive
      if (!a.adj && D >= 230 && a.w > 0.3 && p.cd <= 0 && (dd0 < 22 || ((p.cold || 0) >= 3 && dd0 < 40)) && !isH(p)) {
        a.adj = 1;
        STAT.counter = (STAT.counter || 0) + 1;
        const f3 = form(p, 2);
        if (dd0 < 22 || f3.pct < 0.3 || Math.random() < 0.6) {
          a.w = 0;
          const slow = !!md && p.s - md.s >= 4;
          if (slow || p.i > p.c + 4 || Math.random() < 0.4) (a.r = 40 + Math.random() * 40), (i.mv = Math.random() < 0.5 ? (cfg.PP ? 5 : 1) : undefined); // (Pro Play: in-and-out)
          else (a.r = 150 + Math.random() * 60), (i.mv = 1); // hesitation into the elbow pull-up
          return;
        }
      }
      if (a.fk === 1 && dn.z > 6) {
        a.fk = 2; // he bit: rise up as he flies by (or drive past him)
        if (D < 230 || Math.random() < 0.5) a.r = 40;
      }
      // hold for the last shot: close game, game clock under the shot clock -> run it down to ~4 s
      const diff = sc[t] - sc[1 - t],
        hold = !CT.some((c) => c.tm === t) && clock < shot && clock > 4.5 && diff >= -3 && diff <= 2 && !PREDICT;
      if (hold) a.w = Math.min(a.w, 0.3);
      // shot quality: a contested look early in the clock -> make the extra pass if someone is open
      if (!hold && a.w > 0.45 && dd0 < 26 && shot > 6 && D > 90 && PCNT[t] < 4 && !CT.some((c) => c.tm === t) && T - LASTP[t] > 0.8) {
        let op: Player | null = null,
          ov = 0;
        for (const r of P)
          if (r.tm === t && r !== p) {
            const nd = P[nearest(1 - t, r.x, r.y)],
              od = Math.hypot(nd.x - r.x, nd.y - r.y),
              rd = Math.hypot(oh - r.x, HY - r.y),
              v = od - (rd > 237 ? 100 - r.c : 100 - r.i) * 0.6;
            if (od > 45 && v > ov) (ov = v), (op = r);
          }
        if (op && Math.random() < 0.6) {
          i.pass = op;
          a.r = 0;
          return;
        }
      }
      // patience (scaled by quarter length: arcade 1-min quarters stay quick, 3-min+ play at NBA tempo): early in the
      // clock only a wide-open look, a shot at the rim or a transition chance goes up; otherwise work the ball
      const pf = clamp((QTRLEN - 30) / 150, 0, 1),
        el = 24 - shot;
      let back = 0;
      for (const q of P) if (q.tm !== t && !q.off && Math.hypot(oh - q.x, HY - q.y) < D) back++;
      const need = el < 1 + 6 * pf ? 58 : el < 2 + 10 * pf ? 40 : 30,
        wait = NP > 1 && back >= Math.min(3, NP) && D > 75 && dd0 < need && shot > 7 && el < 2 + 14 * pf;
      // a shooter waiting behind the arc with a step of room lets it fly (it's still a good look)
      if (wait && D >= 237 && p.c >= 76 && dd0 > 34 && a.w > 0.6 && Math.random() < dt * 2.5) {
        a.fk = 0;
        i.sd = 1;
        a.rel = (p.st === 1 ? 0.45 : 0.6) + (Math.random() - 0.5) * 0.16;
        a.r = 0;
        return;
      }
      if (wait) {
        a.pt = Math.min(a.pt, 0.15); // look for the extra pass
        if (a.w > 0.9 && Math.random() < dt * 1.5) (a.r = 45 + Math.random() * 40), (a.w = 0); // or attack the basket
      }
      if (!hold && !wait && a.w > 0.45 && (dd0 > 30 || shot < 7 || a.w > 1.3)) {
        a.fk = 0;
        i.sd = 1;
        a.rel = (p.st === 1 ? 0.45 : 0.6) + (Math.random() - 0.5) * 0.16;
        a.r = 0;
      }
    }
    // Use the ball screen: come off the screener's shoulder, away from the trapped defender, toward the rim.
    const pl = PLAY[t];
    if (pl && pl.kind === "pnr" && pl.use === p && (pl.ph === "set" || (pl.ph === "out" && T - pl.setAt < 2.2))) {
      const sc = pl.scr,
        dx = sc.x - pl.def.x,
        dy = sc.y - pl.def.y,
        dl = Math.hypot(dx, dy) || 1;
      if (pl.ph === "set") mv(p, sc.x + (dx / dl) * 16 + (oh - sc.x) * 0.08, sc.y + (dy / dl) * 16, 1.15);
      else mv(p, oh + (oh > 470 ? -90 : 90), HY + (p.y < HY ? -40 : 40), 1.15);
      i.sp = 1;
    }
    // the help just committed to him: read it now (kick it to whoever the rotation gave up), not on the next half-second
    if (HPL.h && HPL.t !== t && a.hr !== HPL.h && Math.hypot(HPL.h.x - p.x, HPL.h.y - p.y) < 55 && !isH(p)) (a.hr = HPL.h), (a.pt = Math.min(a.pt, 0.12 - p.s / 2000));
    a.pt -= dt;
    if (a.pt < 0) {
      a.pt = 0.5;
      const ql = (r: Player, d: number) => (d < 90 ? r.i : d < 237 ? (r.c + r.i) / 2 : r.c),
        val = (r: Player) => {
          const o = P[nearest(1 - t, r.x, r.y)],
            od = Math.hypot(o.x - r.x, o.y - r.y),
            dd = Math.hypot(oh - r.x, HY - r.y),
            dx = r.x - p.x,
            dy = r.y - p.y,
            l2 = dx * dx + dy * dy || 1;
          for (const e of P)
            if (e.tm !== t) {
              const u = clamp(((e.x - p.x) * dx + (e.y - p.y) * dy) / l2, 0, 1);
              if (Math.hypot(p.x + dx * u - e.x, p.y + dy * u - e.y) < 14) return -1;
            }
          const star = !CT.some((c) => c.tm === t) && shot < 9 && r === starOf(t) && p !== r ? 0.5 : 0,
            kick = D < 130 && dd >= 237 && od > 45 ? 0.25 : 0,
            // feed the mismatch (a switch left a small on the post scorer, or a slow big on a quick guard)
            mm = manOf(r),
            mis = mm && !mm.off ? (r.i >= 76 && r.ht - mm.ht >= 0.4 && dd < 190 ? 0.3 : 0) + (r.s - mm.s >= 15 && dd < 300 ? 0.12 : 0) : 0;
          return (Math.min(od, 80) / 80) * 0.6 + (ql(r, dd) / 100) * 0.5 + (dd < D ? 0.12 : 0) + (OFFS[t] === r ? 0.45 : 0) + (r.my || isH(r) ? 0.2 : 0) + star + kick + mis;
        };
      const own = (Math.min(Math.hypot(dn.x - p.x, dn.y - p.y), 80) / 80) * 0.6 + (ql(p, D) / 100) * 0.5;
      const pf2 = clamp((QTRLEN - 30) / 150, 0, 1);
      let bo = null,
        bv = own + 0.12 + (0.3 - tendOf(p)[4]) * 0.3 - (24 - shot < 12 ? 0.14 * pf2 : 0); // early in the clock: move it
      for (const r of P)
        if (r.tm === t && r !== p) {
          const v = val(r);
          if (v > bv) {
            bv = v;
            bo = r;
          }
        }
      const prs = Math.hypot(dn.x - p.x, dn.y - p.y) < 40;
      // doubled: two defenders on him -> somebody is open, find him (the pass out of the trap)
      let on2 = 0;
      for (const q of P) if (q.tm !== t && !q.off && Math.hypot(q.x - p.x, q.y - p.y) < 45) on2++;
      if (on2 >= 2 && !isH(p) && T - LASTP[t] > 0.4) {
        let ob: Player | null = null,
          ov = 0;
        for (const r of P)
          if (r.tm === t && r !== p && !r.off) {
            const v = val(r);
            if (v > ov) (ov = v), (ob = r);
          }
        if (ob && Math.random() < 0.7) {
          i.pass = ob;
          return;
        }
      }
      if (
        bo &&
        PCNT[t] < 3 + Math.round(3 * pf2) &&
        T - LASTP[t] > 1.1 - 0.4 * pf2 &&
        Math.hypot(bo.x - p.x, bo.y - p.y) < 280 &&
        (Math.abs(hoop(t) - bo.x) < Math.abs(hoop(t) - p.x) + 40 || prs || D < 130 || (shot < 9 && bo === starOf(t))) &&
        Math.random() < (prs ? 0.8 : 0.5)
      )
        i.pass = bo;
    }
    if (p.cd <= 0 && p.s >= 72 && Math.hypot(dn.x - p.x, dn.y - p.y) < 55 && Math.random() < dt * 1.4) {
      const r = Math.random();
      i.mv = cfg.PP ? upCpuMove(p, dn, r) : 1 + ((r * 3) | 0);
    }
  } else if (pos === t && B.mode !== "held" && B.to === p) mv(p, B.x + B.vx * 0.2, B.y + B.vy * 0.2, 1);
  else if (pos === t && B.owner) {
    // the handoff man just gave it up: he is the screen - planted for a beat
    if ((p.ai.holdT || 0) > T) {
      p.br = "hold";
      p.setT = 0.1;
      return;
    }
    // running off a handoff: come at the big from the wing and brush his hip on the way to the top / the middle
    if (p.ai.dhoBy && B.owner === p.ai.dhoBy) {
      const h = p.ai.dhoBy as Player,
        sd = p.y < h.y ? -1 : 1,
        dir = oh > 470 ? -1 : 1;
      mv(p, h.x + dir * 4, h.y + sd * 9, 1.2);
      i.sp = 1;
      p.br = "dho";
      return;
    }
    // transition: fill the lanes - the closest man runs to the rim, two wide to the corners, the last one trails
    if (TS.tr[t] && B.owner.tm === t && NP > 1 && !cfg.HALF) {
      const dir = oh > 470 ? -1 : 1,
        run = P.filter((q) => q.tm === t && q !== B.owner && !q.off).sort((a, b) => Math.hypot(oh - a.x, HY - a.y) - Math.hypot(oh - b.x, HY - b.y)),
        rk = run.indexOf(p),
        // the two wings split the corners (the higher one takes the top side), not both to the same one
        mate = rk === 1 ? run[2] : rk === 2 ? run[1] : null,
        side = mate ? (p.y < mate.y || (p.y === mate.y && rk === 1) ? -1 : 1) : p.y < HY ? -1 : 1,
        lane = rk === 0 ? [oh + dir * 22, HY + side * 18] : rk < 3 ? [oh + dir * 55, HY + side * 195] : [oh + dir * 245, HY + side * 50];
      mv(p, lane[0], lane[1], 1.1);
      if (rk < 3) i.sp = 1;
      p.br = "tr";
      return;
    }
    p.br = "ob";
    if (offBall(p, t)) return;
    p.br = "SP";
    const s = SP[p.k],
      x = t ? 52.5 + s[0] : 887.5 - s[0];
    const nd = P[nearest(1 - t, p.x, p.y)];
    mv(p, x + (p.x - nd.x) * 0.35, s[1] + Math.sin(T + p.k * 2) * 18 + (p.y - nd.y) * 0.3, 0.95);
  } else if (B.owner && TS.tr[1 - t] && B.owner.tm !== t && NP > 1 && !cfg.HALF && !isH(p)) {
    // transition defense: everybody sprints back; the deepest man protects the rim and stops the ball near it
    let deeper = 0;
    const my = Math.hypot(dh - p.x, HY - p.y),
      h = B.owner,
      hd = Math.hypot(dh - h.x, HY - h.y);
    for (const q of P) if (q.tm === t && q !== p && !q.off && Math.hypot(dh - q.x, HY - q.y) < my) deeper++;
    const dir = dh > 470 ? -1 : 1;
    if (deeper === 0) {
      if (hd < 130) mv(p, h.x + (dh - h.x) * 0.3, h.y + (HY - h.y) * 0.3, 1.1); // step up and stop the ball
      else mv(p, dh + dir * 35, HY + (h.y - HY) * 0.25, 1.1);
    } else {
      const o = guardOf(p);
      mv(p, o.x + (dh - o.x) * 0.25, o.y + (HY - o.y) * 0.25, 1.1);
    }
    i.sp = 1;
  } else if (B.owner) {
    const zone = (TS.ds[t] === 4 || (TS.ds[t] === 5 && p !== boxCh(t))) && NP === 5 && !cfg.HALF, // (box-and-one: four in the zone)
      zo = zone ? zoneMan(p, t, dh) : null,
      o = zo || (p.manT > 0 && p.man != null ? P[p.man] : guardOf(p)),
      ds = TS.ds[t],
      od = Math.hypot(dh - o.x, HY - o.y),
      cpu = !CT.some((c) => c.tm === t),
      hotO = (o.heat || 0) >= 2 || (o.hzm && o.hzm[zoneOf(o, od)] >= 2);
    let ou = (B.owner === o ? 22 : 26) * cpuK(p, [1.35, 1.12, 1, 0.86]) * (cfg.ASTAR ? 1.6 : 1); // tighter on-ball defense on harder levels (All-Star: nobody plays D)
    if (ds === 1) ou = B.owner === o ? ou + 8 : ou * 1.6; // sag: go under screens, wall off the paint
    else if (ds === 2) ou = B.owner === o ? ou * 0.82 : ou * 0.6; // tight: pressure and deny
    else if (ds === 5 && NP === 5 && !zone) ou *= 0.62; // box-and-one: the chaser face-guards his man everywhere
    if (cpu && cfg.BADGES && od > 220 && o.c < 72 && B.owner !== o) ou += 34; // sag off a non-shooter
    if (cpu && hotO) ou *= 0.78; // stay attached to the hot hand
    // the CPU scouts his man (human or not): where does he score? take that away, give him the other thing
    if (cpu && o.sk && !cfg.ASTAR) {
      const s = o.sk,
        n = s.a[0] + s.a[1] + s.a[2];
      if (n >= 3) {
        const p3 = s.a[2] / n,
          pr = s.a[0] / n,
          m3 = s.a[2] >= 1.5 ? s.m[2] / s.a[2] : 0.35,
          mr = s.a[0] >= 1.5 ? s.m[0] / s.a[0] : 0.6;
        if (od > 200 && (m3 >= 0.45 || (p3 > 0.55 && m3 >= 0.34))) ou *= 0.8; // a shooter: crowd him at the line
        else if (od > 200 && pr > 0.5 && mr >= 0.55 && m3 < 0.34) ou += B.owner === o ? 10 : 6; // a driver who can't shoot: give him the jumper
      }
    }
    const l = od || 1;
    helpPlan(t, dh);
    // closeout: my man just caught it and I'm a step (or a rotation) away - sprint at him, then chop the feet
    if (B.owner === o && !zone && Math.hypot(o.x - p.x, o.y - p.y) > 45 && od < 300 && HPL.h !== p && HPL.r !== p) i.sp = 1;
    const hb = B.owner,
      hh = Math.hypot(dh - hb.x, HY - hb.y),
      opl = PLAY[1 - t],
      // guarding the screener in a pick-and-roll (CPU teams; a switch already handed him the ball handler instead)
      pnrBig = cpu && !zone && opl && opl.kind === "pnr" && opl.scr === o && opl.use === hb && (opl.ph === "set" || (opl.ph === "out" && T - opl.setAt < 1.6)) && ds !== 3;
    // doubling the hot hand: the nearest helper (not his own man) traps him as soon as he has it inside 32 ft
    let trap = false;
    if (cpu && !zone && TS.dbl[t] >= 0 && P[TS.dbl[t]] === hb && hh < 320 && o !== hb) {
      let best: Player | null = null,
        bd = 1e9;
      for (const q of P)
        if (q.tm === t && !q.off && manOf(hb) !== q) {
          const d = Math.hypot(q.x - hb.x, q.y - hb.y);
          if (d < bd) (bd = d), (best = q);
        }
      trap = best === p && bd < 220;
    }
    if (trap) {
      const lx = hb.y < HY ? 1 : -1; // from the side away from the middle: force him toward the sideline
      mv(p, hb.x + (dh - hb.x) * 0.06, hb.y + lx * 15, 1.2);
      i.sp = 1;
      p.hdgT = 0.25; // (arms wide, like a hedge)
    } else if (pnrBig) {
      const dir = dh > 470 ? -1 : 1;
      if (TS.cov[t] >= 2) tpBig(p, t, o, hb, opl, dh); // ICE / blitz
      else if (TS.cov[t] === 1 && (opl.ph === "set" || T - opl.setAt < 0.55)) {
        // hedge: jump out above the screen into the handler's path, then get back to the roller
        mv(p, hb.x + (dh - hb.x) * 0.12 + (hb.y - HY) * -0.05, hb.y + (HY - hb.y) * 0.12, 1.2);
        i.sp = 1;
        p.hdgT = 0.25; // (pose: big and wide, arms out to show the handler a wall)
      } else if (TS.cov[t] === 1) mv(p, o.x + (dh - o.x) * 0.35, o.y + (HY - o.y) * 0.35, 1.15); // recover
      else mv(p, dh + dir * 85, HY + (hb.y - HY) * 0.35, 1); // drop: sit at the free-throw line, wall off the drive and the roll
    } else if (HPL.h === p && !zone) {
      // help: the driver beat his man - step into his path between him and the rim
      mv(p, hb.x + (dh - hb.x) * 0.38, hb.y + (HY - hb.y) * 0.38, 1.2);
      i.sp = 1;
    } else if (HPL.r === p && !zone && HPL.m) {
      // help the helper: sink onto the man the helper left (the one nearest the rim), give up the least dangerous one
      const m = HPL.m,
        lm = Math.hypot(dh - m.x, HY - m.y) || 1;
      mv(p, m.x + ((dh - m.x) / lm) * 18, m.y + ((HY - m.y) / lm) * 18, 1.1);
      i.sp = 1;
    } else if (!zone && cpu && tpTag(p, t, opl, dh)) {
      // (blitz: the low man tags the roller the trap left open)
    } else if (zone && hh < 140 && nearest(t, hb.x, hb.y) === t * NP + p.k) mv(p, hb.x + (dh - hb.x) * 0.35, hb.y + (HY - hb.y) * 0.35, 1.1);
    else if (zone) {
      // zone: guard whoever is in your area, but never leave it (the spot leans toward the ball)
      let tx = ZS.x,
        ty = ZS.y;
      if (zo) {
        const cx = o.x + ((dh - o.x) / l) * Math.min(ou, 30),
          cy = o.y + ((HY - o.y) / l) * Math.min(ou, 30),
          d = Math.hypot(cx - ZS.x, cy - ZS.y),
          k = d > 75 ? 75 / d : 1;
        tx = ZS.x + (cx - ZS.x) * k;
        ty = ZS.y + (cy - ZS.y) * k;
      }
      mv(p, tx, ty, 0.95);
    } else {
      let tx = o.x + ((dh - o.x) / l) * ou,
        ty = o.y + ((HY - o.y) / l) * ou;
      // shade the ball handler's favourite drive: a step over to the side he keeps going to (CPU defenders)
      if (cpu && B.owner === o && Math.abs(o.drv || 0) > 0.8 && od < 330) {
        const sh = clamp((o.drv || 0) / 3, -1, 1) * 7,
          ux = (dh - o.x) / l,
          uy = (HY - o.y) / l;
        tx += -uy * sh * -1;
        ty += ux * sh * -1;
      }
      // ICE: the handler's man gets over the top of a side pick-and-roll and sends him away from the screen (baseline)
      if (cpu && B.owner === o && TS.cov[t] === 2 && opl && opl.kind === "pnr" && opl.use === o && opl.ph !== "out" && Math.abs(o.y - HY) > 60) {
        const sx = opl.scr.x - o.x,
          sy = opl.scr.y - o.y,
          sl = Math.hypot(sx, sy) || 1;
        tx += (sx / sl) * 12;
        ty += (sy / sl) * 12;
        if (!opl.ic) (opl.ic = 1), (STAT.ice = (STAT.ice || 0) + 1);
      }
      // fronting the post: a smaller man on a big who is sealing on the block gets between him and the ball (the help
      // behind him takes the lob); the entry pass then has to go over the top
      if (cpu && B.owner !== o && o.br === "seal" && o.ht - p.ht >= 0.3 && od < 120) {
        const bl = Math.hypot(B.x - o.x, B.y - o.y) || 1;
        tx = o.x + ((B.x - o.x) / bl) * 15;
        ty = o.y + ((B.y - o.y) / bl) * 15;
        STAT.front = (STAT.front || 0) + 1;
      }
      if (dh > 470 ? B.x < 470 : B.x > 470) tx = dh > 470 ? Math.max(tx, 455) : Math.min(tx, 485);
      mv(p, tx, ty, 0.92);
    }
    if (Math.hypot(o.x - p.x, o.y - p.y) < 42 * cpuK(p, [0.7, 0.9, 1, 1.12]) && (o.mode === "c" || o.mode === "s") && p.z <= 0 && !a.j) {
      // a shooter who loves the pump fake gets a hand up, not a jump
      if (Math.random() < (o.act === 1 ? 0.75 : 0.35)) (p.hupT = 0.7), (a.j = 1);
      else i.sd = a.j = 1;
    }
    if (o.mode === "i") a.j = 0;
    if ((dh > 470 ? B.x >= 470 : B.x <= 470) && B.owner === o && Math.hypot(o.x - p.x, o.y - p.y) < 22 && Math.random() < dt * 0.7) i.e = 1;
  } else {
    loose(p, t);
  }
}

/** Help defense, solved once per tick for the defending team (man defense, 3+ a side): when the ball handler has
 *  beaten his man on a drive (he is inside 20 ft and level with or past his defender, or 34+ px clear of him), the
 *  defender nearest the driving lane steps up (`h`); the defender nearest the man he left rotates onto him (`r`, `m`),
 *  which leaves whoever the rotator had - the drive-and-kick the offense is looking for. Recovery is the normal
 *  man-to-man (with a sprint closeout when the kick-out arrives). */
export const HPL = { t: -1, at: -1, h: null as Player | null, r: null as Player | null, m: null as Player | null };
function helpPlan(t: number, dh: number) {
  if (HPL.t === t && HPL.at === T) return;
  HPL.t = t;
  HPL.at = T;
  HPL.h = HPL.r = HPL.m = null;
  const hb = B.owner;
  if (!hb || hb.tm === t || cfg.NP < 3 || hb.mode !== "i" || cfg.ASTAR || inb > 0 || ftq) return;
  const hh = Math.hypot(dh - hb.x, HY - hb.y);
  if (hh > 200) return;
  const on = manOf(hb),
    od = Math.hypot(dh - on.x, HY - on.y),
    gap = Math.hypot(on.x - hb.x, on.y - hb.y),
    sp = Math.hypot(hb.vx, hb.vy),
    toward = ((dh - hb.x) * hb.vx + (HY - hb.y) * hb.vy) / (hh || 1);
  if (!((od > hh - 6 || gap > 34) && (toward > 50 || (hh < 120 && sp < 60)))) return;
  const lx = hb.x + (dh - hb.x) * 0.38,
    ly = hb.y + (HY - hb.y) * 0.38;
  let h: Player | null = null,
    hd = 170;
  for (const q of P)
    if (q.tm === t && !q.off && q !== on && !isH(q) && q.z <= 0) {
      const d = Math.hypot(q.x - lx, q.y - ly);
      if (d < hd) (hd = d), (h = q);
    }
  if (!h) return;
  HPL.h = h;
  if (!(h.helpT > 0)) STAT.help = (STAT.help || 0) + 1;
  h.helpT = 0.6;
  const m = h.manT > 0 && h.man != null ? P[h.man] : guardOf(h);
  if (!m || m === hb || Math.hypot(dh - m.x, HY - m.y) > 300) return;
  let r: Player | null = null,
    rd = 1e9;
  for (const q of P)
    if (q.tm === t && !q.off && q !== on && q !== h && !isH(q)) {
      const own = q.manT > 0 && q.man != null ? P[q.man] : guardOf(q),
        // cost: distance to the open man + how dangerous the man I would leave is (a shooter far out is less so)
        thr = own ? (own.c / 100) * (Math.hypot(dh - own.x, HY - own.y) < 245 ? 60 : 25) : 0,
        d = Math.hypot(q.x - m.x, q.y - m.y) + thr;
      if (d < rd) (rd = d), (r = q);
    }
  if (r && rd < 260 && cpuIQ(t) >= 1) { // (a rookie defense never rotates behind the help)
    HPL.r = r;
    HPL.m = m;
    if (!(r.rotT > 0)) STAT.rot = (STAT.rot || 0) + 1;
    r.rotT = 0.6;
  }
}
/** 2-3 zone: the two smallest guard the top, the next two the blocks, the tallest the middle. Each defender's spot
 *  (ZS) shifts toward the ball; he takes the opponent nearest his spot inside his area (the ball handler first), or
 *  nobody (he holds his spot). */
const ZS = { x: 0, y: 0 },
  ZR = [0, 1, 2, 3, 4];
function zoneMan(p: Player, t: number, dh: number) {
  const NP = cfg.NP,
    dir = dh > 470 ? -1 : 1;
  for (let k = 0; k < NP; k++) ZR[k] = k;
  ZR.sort((a, b) => P[t * NP + a].ht - P[t * NP + b].ht || a - b);
  let r = ZR.indexOf(p.k);
  if (TS.ds[t] === 5) {
    // box-and-one: the chaser is out of the zone - the other four make a box (two up top, two on the blocks)
    const ch = boxCh(t);
    if (ch && ZR.indexOf(ch.k) < r) r--;
  }
  const side = r === 0 || r === 2 ? -1 : 1,
    by = clamp(B.y - HY, -160, 160),
    bx = Math.abs(B.x - dh);
  // spots: tops ~17 ft out at the elbows, blocks ~4 ft out wide of the lane, the middle under the rim
  const fx = r < 2 ? 165 : r < 4 ? 40 : 30,
    fy = r < 2 ? 62 * side : r < 4 ? 72 * side : 0;
  ZS.x = dh + dir * (fx + (r < 2 ? clamp(bx - 200, -40, 60) * 0.3 : 0));
  ZS.y = HY + fy + by * (r < 2 ? 0.35 : 0.25);
  let best: Player | null = null,
    bd = r < 2 ? 120 : 95;
  for (const q of P) {
    if (q.tm === t || q.off) continue;
    const d = Math.hypot(q.x - ZS.x, q.y - ZS.y) - (B.owner === q ? 40 : 0);
    if (d < bd) (bd = d), (best = q);
  }
  return best;
}
/** Step length (px) at a ground speed (px/s): short walking steps up to long sprinting strides (~5.5 ft). */
export const stepLen = (sv: number) => 24 + Math.min(300, sv) * 0.11;
/** Signature celebration after a big bucket (slot 0 three, 1 dunk/and-one, 2 clutch). Arms and torso only: the
 *  legs keep running back on defense. Drawn by pose3 (CEL in pose.ts); synced to guests in the snapshot. */
export const CEL_T = 1.8;
function celebrate(p: Player, slot: number) {
  if (PREDICT) return;
  p.cel = (p.sg && p.sg.ce && p.sg.ce[slot]) || [1, 6, 8][slot];
  p.celT = CEL_T;
}
/** Dribble catch height (px): about hip high, lower when a defender is close, a touch higher at full speed. */
export function dribTop(o: Player) {
  const sp = Math.hypot(o.vx, o.vy);
  let tight = 0;
  for (const d of P) if (d.tm !== o.tm && Math.hypot(d.x - o.x, d.y - o.y) < 34) tight = 1;
  // (style: shifty guards keep it low, bigs dribble it high)
  const sty = o.s >= 86 || o.ht <= 6.35 ? -2.5 : o.ht >= 6.9 ? 3 : 0;
  return o.z + o.ht * 5 - tight * 5 + Math.min(4, sp * 0.015) + sty;
}
/** Live-ball height while dribbling: the hand pushes the ball down, it bounces off the floor and rises back into the
 *  hand, which absorbs it for a moment and pushes again. Faster, harder pushes when driving; lower when guarded. */
function dz(o: Player, dt: number) {
  const top = dribTop(o),
    sp = Math.hypot(o.vx, o.vy);
  if (B.dh == null || B.dho !== o) {
    // the first push starts from the hands (a catch at the chest, a triple threat), not from a ball teleported to the hip
    B.dh = B.dho === null && B.hold === o ? clamp(B.z, top, top + 22) : top;
    B.dvv = 0;
    B.dhd = 0.08;
    B.dho = o;
    B.fr0 = T;
  }
  B.dtop = top;
  if (B.dhd > 0) {
    // in the hand: the catch is cushioned (the hand gives a little upward), then the push
    B.dhd -= dt;
    B.dvv *= Math.exp(-28 * dt);
    B.dh = Math.min(Math.max(top + 5, B.dh), B.dh + B.dvv * dt);
    if (B.dhd <= 0) B.dvv = -(165 + sp * 0.4) * (o.s >= 86 ? 1.15 : o.ht >= 6.9 ? 0.9 : 1); // (quick handlers pound it, bigs bounce it)
  } else {
    B.dvv -= g * dt;
    B.dh += B.dvv * dt;
    if (B.dh < BR) {
      B.dh = BR;
      B.dvv = Math.abs(B.dvv) * 0.82; // leather on hardwood
    }
    if (B.dvv > 0 && B.dh >= top - 1) {
      B.dh = top - 1;
      B.dhd = 0.05 + 0.05 / (1 + sp * 0.01);
    }
  }
  return B.dh;
}
/** Signature free-throw routine (from the name): how long he dribbles before he settles and spins it -
 *  0 the classic (half and half), 1 a few quick ones, 2 a long dribble routine, 3 no dribble at all, just the spin. */
const FTCUT = [1.7, 1.0, 2.5, 0.15];
export const ftStyle = (o: Player) => {
  let h = 7;
  for (let k = 0; k < (o.n || "").length; k++) h = (h * 31 + o.n.charCodeAt(k)) >>> 0;
  return h % 4;
};
/** Ball held (not dribbled): 1 triple threat at the right hip, 2 pump fake / jab rising toward the forehead,
 *  3 free-throw routine (holding and spinning it before the shot). */
export function heldBall(o: Player): number {
  if (o.mode !== "i" || o.postA || inb > 0) return 0;
  if (o.chinT > 0) return 4;
  if (o.actT > 0 && (o.act === 1 || o.act === 2)) return 2;
  if (ftq && ftq.s === o && (o.ftT || 0) % 3.4 > FTCUT[ftStyle(o)]) return 3;
  if (o.ttT > 0 && Math.hypot(o.vx, o.vy) < 70 && !ftq) return 1;
  return 0;
}
const HSK = new Float32Array(60);
const HOLDP: [number, number][] = [
  [0, 0],
  [-5, 4],
  [0, 7],
  [0, 8],
  [0, 5],
];
function heldZ(o: Player) {
  const h = heldBall(o),
    hip = o.z + o.ht * 4.9;
  if (h === 2) {
    const k = 1 - o.actT / (o.act === 1 ? 0.42 : 0.38),
      u = Math.sin(Math.min(1, k) * Math.PI);
    return o.act === 1 ? hip + u * o.ht * 4.2 : hip;
  }
  if (h === 3) {
    B.a += 0.25; // spins it in his hands
    return o.z + o.ht * 7.4;
  }
  if (h === 4) return o.z + o.ht * 7.3; // chinned (under the chin, at the top of the chest)

  return hip;
}
/** Two-hand dribble: which hand has it (B.dhn +1 right / -1 left) and the ball's lateral/forward offset (px; lateral
 *  negative = the handler's right). Moves switch hands (crossover low across the front, behind-the-back between the
 *  legs, spin around the hip); a close defender on the ball side makes the handler cross away from him; standing
 *  still in front of a defender, the handler sizes up with alternating crosses. Ball position only - no gameplay. */
const dhBase = () => -6 * B.dhn;
function dhSw(kind: number, dur: number) {
  B.dswf = B.dsw > 0 ? B.dlat : dhBase(); // start from wherever the ball is right now
  B.dhn = -B.dhn;
  B.dsw = dur;
  B.dswd = dur;
  B.dswk = kind;
  B.dcd = 0.75;
}
/** Pro Play ball paths 5 (in-and-out: most of the way across and back, same hand) and 7 (snatch-back: pulled back to
 *  the hip) never switch hands. */
function upSw(kind: number, dur: number) {
  if (kind !== 5 && kind !== 7) return dhSw(kind, dur);
  B.dswf = B.dsw > 0 ? B.dlat : dhBase();
  B.dsw = dur;
  B.dswd = dur;
  B.dswk = kind;
  B.dcd = 0.75;
}
function upDribMove(o: Player) {
  if (o.mvk === 5) upSw(5, 0.3);
  else if (o.mvk === 6) upSw(1, 0.18);
  else if (o.mvk === 7) upSw(7, 0.3);
}
const SZK = [[3, 1, 5], [3, 3, 5, 1], [1, 5, 1], [1, 1, 5]],
  SZD = [[0.26, 0.2, 0.26], [0.18, 0.18, 0.24, 0.18], [0.32, 0.34, 0.32], [0.15, 0.15, 0.22]],
  SZC = [0.55, 0.3, 0.9, 0.55];
/** Signature size-up chains: formOf dk picks the package, the moves run in order. */
function upSizeUp(o: Player) {
  const dk = o.sg ? clamp(o.sg.dk || 0, 0, 3) | 0 : 0,
    ks = SZK[dk],
    j = (B.dsz || 0) % ks.length;
  B.dsz = (B.dsz || 0) + 1;
  upSw(ks[j], SZD[dk][j]);
  B.dcd = SZC[dk];
  ppc("sizeUp");
}
function dribHand(o: Player, dt: number): [number, number] {
  if (B.dho2 !== o) {
    B.dho2 = o;
    B.dhn = o.sg && o.sg.lh ? -1 : 1; // lefties start the dribble in the left hand
    B.dsw = 0;
    B.dcd = 0.4;
    B.dmv = 0;
    B.dsz = 0;
  }
  const base = dhBase,
    sw = dhSw;
  if (!PREDICT) {
    B.dcd = Math.max(0, (B.dcd || 0) - dt);
    // a new dribble move started this tick
    if (o.mvT > 0 && (B.dmv || 0) <= 0) {
      if (o.mvk === 3) sw(3, 0.26);
      else if (o.mvk === 2) sw(2, 0.34);
      else if (cfg.PP && o.mvk >= 5) upDribMove(o);
      else if (o.mvk !== 1 && o.mvk !== 4) sw(1, 0.2);
    }
    B.dmv = o.mvT;
    if (!(o.mvT > 0) && !(B.dsw > 0) && B.dcd <= 0) {
      let d: Player | null = null,
        dd = 1e9;
      for (const q of P)
        if (q.tm !== o.tm) {
          const e = Math.hypot(q.x - o.x, q.y - o.y);
          if (e < dd) (dd = e), (d = q);
        }
      if (d && dd < 46) {
        // defender's side in the handler's frame (+ = right)
        const rs2 = (d.x - o.x) * Math.sin(o.f) - (d.y - o.y) * Math.cos(o.f),
          sp = Math.hypot(o.vx, o.vy);
        if (Math.sign(rs2) === B.dhn && Math.abs(rs2) > 7) sw(1, 0.22); // protect: cross away from the defender
        else if (cfg.PP && sp < 25 && dd < 60) upSizeUp(o);
        else if (sp < 25 && dd < 60) {
          // size-up, by signature package: 0 btb + cross, 1 rapid-fire between-the-legs combos (Curry),
          // 2 slow, patient crosses (Doncic), 3 hard explosive crosses (Edwards)
          B.dsz = (B.dsz || 0) + 1;
          const dk = (o.sg && o.sg.dk) || 0;
          if (dk === 1) sw(B.dsz % 3 ? 3 : 1, 0.18), (B.dcd = 0.3);
          else if (dk === 2) sw(1, 0.32), (B.dcd = 0.95);
          else if (dk === 3) sw(1, 0.15), (B.dcd = 0.6);
          else sw(B.dsz % 2 ? 3 : 1, B.dsz % 2 ? 0.26 : 0.2), (B.dcd = 0.55);
        }
      }
    }
  }
  let lat = base(),
    fwd = 6;
  if (B.dsw > 0) {
    B.dsw = Math.max(0, B.dsw - dt);
    const u0 = 1 - B.dsw / (B.dswd || 0.2),
      u = u0 * u0 * (3 - 2 * u0),
      arc = Math.sin(Math.PI * u0);
    lat = (B.dswf ?? -lat) + (base() - (B.dswf ?? -lat)) * u;
    if (B.dswk === 3) fwd = 6 - 10 * arc; // through the legs / behind the back
    else if (B.dswk === 2) (fwd = 6 * Math.cos(Math.PI * u0)), (lat += 5 * arc * B.dhn); // swung around the hip
    else if (B.dswk >= 5) {
      const from = B.dswf ?? -base();
      if (B.dswk === 5) (lat = from + 12 * B.dhn * 0.62 * arc), (fwd = 6 + 2 * arc); // toward the other hand ... and back
      else if (B.dswk === 7) (lat = from - 2 * B.dhn * arc), (fwd = 6 - 9 * arc); // ripped back to the hip
    } else fwd = 6 - 1.5 * arc; // crossover: low and tight across the front
  }
  B.dlat = lat;
  return [lat, fwd];
}
const SORTP: Player[] = [];
// ---------------- Physics v3 (cfg.PH3; C# Core/Sim.PH3.cs - same names, same order, same random draws) ----------------
// Air: quadratic drag + Magnus k (w x v) + slow spin decay (a 9.4" ball, Cd .54, air 1.2 kg/m^3); passes keep the old
// model (pass() aims for it). Surfaces: hardwood / street asphalt (cfg.HALF): bounce, grip, rolling resistance, iron,
// glass. Every legacy contact couples spin and velocity (spinHit); the shooter's touch (B.tch) softens the iron for his
// shot. Bodies: momentum by mass in collide (stumbles, knockdowns), screens that eat a defender's run (or get run
// through), box-outs; loose-ball scrums, bobbled hard passes, balls off feet; fatigue (lower jumps, slower first steps,
// heavy landings, tired jumpers fall short - never a human green); sweat spots late in games; shoe squeaks (FX).
export const AIR_KD = 7.2e-4, // quadratic drag per px: a = KD |v| v (~19% of g on a 30 ft/s three)
  AIR_KM = 0.005, // Magnus: a = KM (w x v)
  AIR_WD = 0.12; // spin decay in the air (1/s)
/** By surface (0 hardwood, 1 street asphalt): [bounce e, grip mu, rolling resistance px/s^2, rim e x, rim soak x, glass e]. */
export const SURF = [
  [0.8, 0.55, 42, 1, 1, 0.6],
  [0.76, 0.85, 80, 1.12, 0.45, 0.5],
];
export const surf = () => (cfg.PH3 && cfg.HALF ? 1 : 0);
/** Event counters (tests/physics2.ts; C# Sim.PH3C). */
export const PH3C: Record<string, number> = {};
const ph3c = (k: string) => (PH3C[k] = (PH3C[k] || 0) + 1);
/** Scratch for airAcc: vx vy vz w0 w1 w2. */
export const AV = [0, 0, 0, 0, 0, 0];
/** One step of v3 air on AV (drag + Magnus, no gravity): the same arithmetic in bstep, rapStep and launch's pre-sim. */
export function airAcc(h: number) {
  const vx = AV[0],
    vy = AV[1],
    vz = AV[2],
    w0 = AV[3],
    w1 = AV[4],
    w2 = AV[5],
    d = 1 - AIR_KD * Math.sqrt(vx * vx + vy * vy + vz * vz) * h;
  AV[0] = vx * d + AIR_KM * (w1 * vz - w2 * vy) * h;
  AV[1] = vy * d + AIR_KM * (w2 * vx - w0 * vz) * h;
  AV[2] = vz * d + AIR_KM * (w0 * vy - w1 * vx) * h;
}
/** v3 air for the free ball (passes keep the old model: pass() aims with it). */
export const airV3 = () => !!cfg.PH3 && B.mode !== "pass";
/** Coulomb friction at a legacy contact (ball mass 1, solid sphere I = .4 R^2), capped where the contact point stops
 *  slipping: spin <-> velocity (backspin checks a bounce up, english off the iron). n = outward normal, jn = impulse. */
function spinHit(nx: number, ny: number, nz: number, jn: number, mu: number) {
  const W = B.wv || (B.wv = [0, 0, 0]),
    R = BR,
    rx = -nx * R,
    ry = -ny * R,
    rz = -nz * R,
    cvx = B.vx + (W[1] * rz - W[2] * ry),
    cvy = B.vy + (W[2] * rx - W[0] * rz),
    cvz = B.vz + (W[0] * ry - W[1] * rx),
    vn = cvx * nx + cvy * ny + cvz * nz,
    tx = cvx - vn * nx,
    ty = cvy - vn * ny,
    tz = cvz - vn * nz,
    vt = Math.sqrt(tx * tx + ty * ty + tz * tz);
  if (vt < 1e-9) return;
  const jt = Math.min(mu * jn, vt / 3.5),
    Jx = (-jt * tx) / vt,
    Jy = (-jt * ty) / vt,
    Jz = (-jt * tz) / vt,
    iI = 1 / (0.4 * R * R);
  B.vx += Jx;
  B.vy += Jy;
  B.vz += Jz;
  W[0] += (ry * Jz - rz * Jy) * iI;
  W[1] += (rz * Jx - rx * Jz) * iI;
  W[2] += (rx * Jy - ry * Jx) * iI;
}
/** Legacy floor bounce: the surface's restitution + the friction / spin kick. */
function ph3Floor() {
  const s = SURF[surf()],
    vn = -B.vz;
  if (vn <= 0) return;
  B.vz = vn * s[0];
  spinHit(0, 0, 1, (1 + s[0]) * vn, s[1]);
  B.wv[2] /= 1.5;
  if (B.vz < 25) B.vz = 0;
}
/** Legacy rolling: the surface's rolling resistance, rolling without slipping, the spin about the vertical dies. */
function ph3Roll(dt: number) {
  const vh = Math.sqrt(B.vx * B.vx + B.vy * B.vy),
    k = vh > 1.5 ? Math.max(0, vh - SURF[surf()][2] * dt) / vh : 0,
    W = B.wv || (B.wv = [0, 0, 0]);
  B.vx *= k;
  B.vy *= k;
  W[0] = -B.vy / BR;
  W[1] = B.vx / BR;
  W[2] /= 1 + dt * 3;
}
/** Legacy rim restitution: the surface's iron (street: stiffer, soaks less), the flex soak, the shooter's touch. */
function ph3RimE(back: boolean, dot: number) {
  const s = SURF[surf()];
  return Math.min(0.9, (back ? 0.4 : 0.55) * s[3]) * (1 - 0.3 * s[4] * clamp((-dot - 250) / 700, 0, 1)) * (B.sh ? 1 - (B.tch || 0) : 1);
}
/** A touch of the iron, counted once per contact (make captions: shooter's roll / rolled in). */
export function ph3RimHit() {
  if (B.age - (B.rhA ?? -9) > 0.08) B.rh = (B.rh || 0) + 1;
  B.rhA = B.age;
}
/** At the release: the shooter's touch (soft hands = a softer iron for this shot), rim-touch counter reset. */
function ph3Launch(p: Player, three: boolean) {
  const tc = three ? p.c : (p.c + p.i) / 2;
  B.tch = cfg.PH3 ? clamp((tc - 60) / 35, 0, 1) * 0.18 : 0;
  B.rh = 0;
  B.rhA = -9;
}
function ph3MakeTxt(hx: number) {
  if (!B.ft && !B.dk && (B.rh || 0) >= 2) txtW(B.rh >= 3 ? "ROLLED IN!" : "SHOOTER'S ROLL!", hx, HY, 140, "#9fe7ff");
}
/** Tiredness 0 (energy .7+) .. 1 (energy .2). */
export function ph3Fat(p: Player) {
  return cfg.PH3 ? clamp((0.7 - (p.en ?? 1)) / 0.5, 0, 1) : 0;
}
/** Tired legs: a jumper that is not a human's green comes up a touch short (up to 1.2% of the range). */
function ph3Short(p: Player) {
  const f = ph3Fat(p);
  if (f <= 0) return;
  const k = 1 - 0.012 * f;
  B.vx *= k;
  B.vy *= k;
  ph3c("short");
}
/** Tired legs land heavy: a longer absorb and a slower first step. */
function ph3Land(p: Player, v: number) {
  const f = ph3Fat(p);
  if (f <= 0 || v < 100) return;
  p.landT = Math.max(p.landT || 0, Math.min(0.4, 0.1 + 0.2 * f));
  p.slow = Math.max(p.slow, 0.12 * f);
  ph3c("heavyLand");
}
/** A monster dunk (power from build x height x hops) very rarely shatters the glass: a stoppage while it is replaced. */
function ph3Shatter(hx: number) {
  const L = B.last;
  if (!cfg.SHATTER || PREDICT || !L || cfg.HALF || !gameLike() || S !== "play") return false;
  const pw = L.bk * L.ht * (0.6 + L.j / 200);
  if (pw < 7.2 || Math.random() >= 0.006 * Math.min(1, (pw - 7.2) / 2)) return false;
  const b = hx > 470 ? 1 : 0,
    N = NETS[b];
  N.shT = SHAT_T;
  N.bsv += 90;
  N.fv += 40;
  ph3c("shatter");
  STAT.shatter = (STAT.shatter || 0) + 1;
  fx({ k: "shatter", v: b, x: hx, y: HY });
  fx({ k: "shake", v: 1.2 });
  fx({ k: "slow", v: 1.5 });
  exc(1);
  ban("SHATTERED THE BACKBOARD!", L.n.toUpperCase() + " · DELAY WHILE THE GLASS IS REPLACED", "#9fe7ff");
  txtW("GLASS!", hx, HY, 150, "#9fe7ff");
  if (cfg.replays) (RQ = 1), (HLN = "Glass breaker — " + L.n);
  return true;
}
export const SHAT_T = 7; // s the board is gone (renderers hide the glass, shards on the floor)
/** A dunk tilts the iron toward the dunker (heavier = harder) and shakes the board. */
function ph3Yank(N: any) {
  const L = B.last;
  if (!L) return;
  const dx = L.x - N.hx,
    dy = L.y - HY,
    dl = Math.sqrt(dx * dx + dy * dy) || 1,
    m = (L.bk * L.ht) / 6.5;
  N.tvx += (dx / dl) * 28 * m;
  N.tvy += (dy / dl) * 28 * m;
  N.bsv += 22 * m;
}
const RW_W = 30, // rim wobble (tilt) spring (rad/s) + damping ratio: rings about a second after a dunk
  RW_Z = 0.08,
  BS_W = 45, // backboard shake spring + damping
  BS_Z = 0.06;
/** Rim tilt (tx/ty: px the edge at +x / +y dips) toward (gx, gy) - a hanging dunker holds it - and the board shake. */
function ph3Wobble(N: any, dt: number, gx: number, gy: number) {
  N.tvx += (-RW_W * RW_W * (N.tx - gx) - 2 * RW_Z * RW_W * N.tvx) * dt;
  N.tvy += (-RW_W * RW_W * (N.ty - gy) - 2 * RW_Z * RW_W * N.tvy) * dt;
  N.tx += N.tvx * dt;
  N.ty += N.tvy * dt;
  if (N.tx > 1.2 || N.tx < -1.2) (N.tx = clamp(N.tx, -1.2, 1.2)), (N.tvx = 0);
  if (N.ty > 1.2 || N.ty < -1.2) (N.ty = clamp(N.ty, -1.2, 1.2)), (N.tvy = 0);
  N.bsv += (-BS_W * BS_W * N.bs - 2 * BS_Z * BS_W * N.bsv) * dt;
  N.bs += N.bsv * dt;
  if (N.bs > 3 || N.bs < -3) (N.bs = clamp(N.bs, -3, 3)), (N.bsv = 0);
  if (N.shT > 0) N.shT -= dt;
}
// ---- bodies ----
const PH_BOXM = 3, // a seated box-out plays this much heavier (C# Sim.PH.cs, shared now)
  PHK = 0.5; // (C# phK(): the arcade .. sim slider at its default)
/** 1 = A boxes C out, 2 = C boxes A out, 0 = none (a shot / miss in the air, the defender between his man and the rim). */
function phBox(A: Player, C: Player) {
  const L = B.last;
  if (!L || B.owner || B.mode !== "air" || B.sc || !(B.sh || B.age < 1.6) || A.tm === C.tm) return 0;
  const hx = hoop(L.tm),
    dA = Math.hypot(A.x - hx, A.y - HY),
    dC = Math.hypot(C.x - hx, C.y - HY);
  if (A.tm !== L.tm && dA < dC && dA < 170) return 1;
  if (C.tm !== L.tm && dC < dA && dC < 170) return 2;
  return 0;
}
/** The boxer X sits into his man O: O moves away from the rim by the mass ratio and loses the speed he had into X. */
function phShove(X: Player, O: Player, ux: number, uy: number, mX: number, mO: number) {
  const sh = ((1.6 * mX) / (mX + mO) - 0.5) * (0.6 + 0.8 * PHK);
  if (sh > 0) {
    O.x += ux * sh;
    O.y += uy * sh;
  }
  const vin = -(O.vx * ux + O.vy * uy);
  if (vin > 0) {
    O.vx += ux * vin * 0.5;
    O.vy += uy * vin * 0.5;
  }
  ph3c("box");
}
/** A hard collision (impulse j): whoever takes the bigger jolt (j / mass) stumbles; a huge one can put him on the floor. */
function ph3Hit(A: Player, C: Player, j: number, mA: number, mC: number) {
  for (let w = 0; w < 2; w++) {
    const q = w === 0 ? A : C,
      dv = j / (w === 0 ? mA : mC);
    if (dv > 110) {
      q.slow = Math.max(q.slow, 0.22);
      ph3c("stumble");
    }
    if (dv > 200 && q.z <= 0 && q !== B.owner && q.mode === "i" && !(q.actT > 0) && !PREDICT && rs <= 0 && !ftq && inb <= 0 && gameLike() && Math.random() < Math.min(0.6, (dv - 200) / 300)) {
      q.act = 3; // on the floor; gets up (a teammate helps him up at a dead ball)
      q.actT = 1.15;
      ph3c("down");
      STAT.kd = (STAT.kd || 0) + 1;
      txtW("KNOCKED DOWN!", q.x, q.y, 90, "#ff9966");
      fx({ k: "ooh" });
    }
  }
}
/** A defender runs into a planted screen: his run into the screener is eaten (heavier screener = longer stop); a much
 *  heavier defender at speed fights through it and rocks the screener. */
function ph3Screen(sc0: Player, df: Player) {
  const mS = sc0.bk * sc0.ht,
    mD = df.bk * df.ht,
    ux = sc0.x - df.x,
    uy = sc0.y - df.y,
    ul = Math.sqrt(ux * ux + uy * uy) || 1,
    vin = (df.vx * ux + df.vy * uy) / ul,
    r = mD / mS;
  if (r > 1.12 && vin > 140) {
    df.scr = 0.3;
    sc0.hitT = 0.35;
    sc0.hitX = ux / ul;
    sc0.hitY = uy / ul;
    sc0.slow = Math.max(sc0.slow, 0.3);
    ph3c("fight");
    if (isH(df) || isH(B.owner)) txtW("FIGHTS THROUGH", df.x, df.y, 92, "#9ad");
  } else df.scr = 0.55 * clamp(1 / r, 0.8, 1.3);
  if (vin > 0) {
    df.vx -= (ux / ul) * vin;
    df.vy -= (uy / ul) * vin;
  }
}
// ---- ball handling ----
/** A hard pass (relative speed 520+ px/s), a fancy one (no-look / behind the back / wraparound) or one from behind can
 *  be bobbled: it pops up off his hands - no steal, he or a teammate usually gets it back. */
function ph3Bobble(p: Player) {
  const rx = B.vx - p.vx,
    ry = B.vy - p.vy,
    rz = B.vz - p.vz,
    rel = Math.sqrt(rx * rx + ry * ry + rz * rz),
    pp = B.pp ? B.pp.p : null,
    pk = pp && pp.pk ? (pp.pk === 1 ? 0.04 : 0.08) : 0,
    f = Math.cos(p.f) * rx + Math.sin(p.f) * ry,
    back = f > 0.3 * rel ? 0.06 : 0,
    c = (clamp((rel - 520) / 500, 0, 1) * 0.3 + pk + back) * (1.25 - p.s / 140);
  if (c <= 0 || Math.random() >= c) return false;
  const a = Math.random() * 6.283,
    W = B.wv || (B.wv = [0, 0, 0]);
  B.mode = "air";
  B.to = null;
  B.sh = 0;
  B.last = p;
  B.age = 0.15;
  B.vx = p.vx * 0.8 + rx * 0.1 + Math.cos(a) * 30;
  B.vy = p.vy * 0.8 + ry * 0.1 + Math.sin(a) * 30;
  B.vz = 90 + rel * 0.08;
  W[0] = Math.sin(a) * 25;
  W[1] = -Math.cos(a) * 25;
  W[2] = 12;
  p.act = 5;
  p.actT = 0.35;
  txtW("BOBBLED!", p.x, p.y, 95, "#ff9966");
  ph3c("bobble");
  return true;
}
/** A low pass / loose ball skidding into somebody's feet kicks off them (he touched it last: out of bounds is on him). */
function ph3Legs() {
  const sp = Math.sqrt(B.vx * B.vx + B.vy * B.vy);
  if (sp < 150) return;
  for (const q of P) {
    if (q.off || q === B.to || q === B.last || q.z > 4) continue;
    const dx = B.x - q.x,
      dy = B.y - q.y,
      d = Math.sqrt(dx * dx + dy * dy);
    if (d > 6.5 || d < 1e-6) continue;
    const nx = dx / d,
      ny = dy / d,
      vn = B.vx * nx + B.vy * ny;
    if (vn >= 0) continue;
    const W = B.wv || (B.wv = [0, 0, 0]),
      side = (B.vx * ny - B.vy * nx) / BR;
    B.vx = (B.vx - 1.5 * vn * nx) * 0.7;
    B.vy = (B.vy - 1.5 * vn * ny) * 0.7;
    B.vz = Math.abs(B.vz) * 0.3 + 30;
    W[0] = (-B.vy / BR) * 0.5;
    W[1] = (B.vx / BR) * 0.5;
    W[2] = side * 0.3;
    if (isH(q) || isH(B.last)) txtW("OFF HIS FOOT", q.x, q.y, 70, "#ff9966");
    B.mode = "air";
    B.to = null;
    B.sh = 0;
    B.last = q;
    B.age = 0;
    ph3c("legs");
    return;
  }
}
/** Loose ball on the floor with a rival in reach too: a scramble - it can squirt out (each loose ball twice at most). */
function ph3Scrum(p: Player) {
  let r: Player | null = null;
  for (const q of P)
    if (q.tm !== p.tm && !q.off && !(q.actT > 0) && q.z < 20) {
      const dx = q.x - B.x,
        dy = q.y - B.y;
      if (Math.sqrt(dx * dx + dy * dy) < 14) {
        r = q;
        break;
      }
    }
  if (!r || Math.random() >= 0.3) return false;
  const a = Math.random() * 6.283,
    W = B.wv || (B.wv = [0, 0, 0]);
  B.vx = Math.cos(a) * 110;
  B.vy = Math.sin(a) * 110;
  B.vz = 70;
  B.last = a < 3.1415 ? p : r;
  B.age = 0;
  B.scm = (B.scm || 0) + 1;
  W[0] = Math.sin(a) * 28;
  W[1] = -Math.cos(a) * 28;
  W[2] = 0;
  p.hitT = 0.25;
  r.hitT = 0.25;
  if (isH(p) || isH(r)) txtW("LOOSE BALL!", B.x, B.y, 60, "#ffd23f");
  ph3c("scrum");
  return true;
}
/** A tipped pass spins off the fingers (the bounce kicks with it). */
function ph3DeflSpin(w: number) {
  const W = B.wv || (B.wv = [0, 0, 0]);
  W[0] = W[0] * 0.3 - w * 40;
  W[1] = W[1] * 0.3 + w * 40;
  W[2] = w * 120;
}
// ---- floor ----
/** Sweat spots (wetness 0..1) in the paint at both ends (3 each), from Q3 on: players standing on them wet them; the
 *  ball kids mop them in timeouts (all) and between quarters (most). */
export const SW = [0, 0, 0, 0, 0, 0];
const SWOX = [45, 45, 110],
  SWOY = [-30, 30, 0];
let SWQ = 0;
const swX = (i: number) => (i < 3 ? HXs[0] + SWOX[i] : HXs[1] - SWOX[i - 3]),
  swY = (i: number) => HY + SWOY[i % 3];
export const swPos = (i: number) => [swX(i), swY(i)];
function ph3Sweat(dt: number) {
  if (q !== SWQ) {
    const k = q < SWQ ? 0 : 0.2; // (a new game starts dry)
    SWQ = q;
    for (let i = 0; i < 6; i++) SW[i] *= k;
  }
  if (TS.hud > 0) for (let i = 0; i < 6; i++) SW[i] = 0;
  if (q < 3 || cfg.HALF || !gameLike() || S !== "play" || rs > 0) return;
  for (let i = 0; i < 6; i++) {
    let n = 0;
    const x = swX(i),
      y = swY(i);
    for (const p of P) if (!p.off && p.z <= 0 && Math.sqrt((p.x - x) * (p.x - x) + (p.y - y) * (p.y - y)) < 25) n++;
    SW[i] = Math.min(1, SW[i] + dt * 0.0022 * n);
  }
}
/** How wet the floor is under (x, y). */
export function wetAt(x: number, y: number) {
  if (!cfg.PH3) return 0;
  let w = 0;
  for (let i = 0; i < 6; i++) {
    const dx = x - swX(i),
      dy = y - swY(i),
      d = Math.sqrt(dx * dx + dy * dy);
    if (d < 24) w = Math.max(w, SW[i] * (1 - d / 24));
  }
  return w;
}
/** A slip on a wet spot: FX for the audio / renderer, a little speed lost. */
function ph3Slip(p: Player) {
  const w = wetAt(p.x, p.y);
  if (w <= 0.2) return;
  if (!PREDICT) fx({ k: "slip", x: p.x, y: p.y, v: w });
  p.vx *= 0.75;
  p.vy *= 0.75;
  ph3c("sweatSlip");
  if (!isH(p)) txtW("SLIPPED ON THE WET SPOT", p.x, p.y, 90, "#ff9966");
}
/** Shoe squeak on a hard plant (FX for audio.ts). */
function ph3Squeak(p: Player, v: number) {
  if (cfg.PH3 && !PREDICT) fx({ k: "squeak", x: p.x, y: p.y, v: Math.min(1, v / 320) });
}
/** Green guide: a green release that was meant to go in (B.gd: not blocked, launch's make) is re-aimed at the middle
 *  of the rim on its way down, every half step, from .9 s out - the ballistic time to rim height, so drag, Magnus drift,
 *  aim rounding (legacy), a brush with a body and Unity's PhysX all wash out and nothing but a block can miss it. The
 *  corrections are a few px/s (invisible); a ball that clips something is steered back into the cylinder. */
function greenGuide(dt: number) {
  if (!B.gd || !B.sh || B.sc || B.mode !== "air" || B.vz >= 0 || B.z <= 100) return;
  const tt = (B.vz + Math.sqrt(B.vz * B.vz + 2 * g * (B.z - 100))) / g;
  if (tt < dt || tt > 0.9) return;
  B.vx = (B.ghx - B.x) / tt;
  B.vy = (HY - B.y) / tt;
}
export function bstep(dt: number) {
  const o = B.owner;
  if (o) {
    {
      // Dribbling: the ball sits out beside the dribbling hand, a little in front; crossovers, behind-the-backs and
      // spins carry it to the other hand along their own paths (see dribHand).
      const hold = heldBall(o),
        [lat, fwd] = hold ? HOLDP[hold] : o.mode === "i" && !o.postA ? dribHand(o, dt) : [0, 8],
        off = lat,
        // (a pump fake carries the ball up AND out in front of the forehead: straight up put the hands behind his
        // head, and the arms whipped back over when the real shot followed)
        fw = fwd + (hold === 2 && o.act === 1 ? 7 * Math.sin(Math.min(1, 1 - o.actT / 0.42) * Math.PI) : 0),
        tx = o.x + Math.cos(o.f) * fw - Math.sin(o.f) * off,
        ty = o.y + Math.sin(o.f) * fw + Math.cos(o.f) * off;
      if (cfg.PRO && o.mode === "i" && B.hold === o && !PREDICT) {
        // Dribble physics: the ball has momentum; the hand pulls it with a stiff, critically damped spring,
        // so crossovers and hard cuts swing it across the body instead of teleporting.
        const k = 900,
          c = 2 * Math.sqrt(k);
        B.dvx = (B.dvx || 0) + ((tx - B.x) * k - (B.dvx || 0) * c) * dt;
        B.dvy = (B.dvy || 0) + ((ty - B.y) * k - (B.dvy || 0) * c) * dt;
        B.x += B.dvx * dt;
        B.y += B.dvy * dt;
        if (Math.hypot(tx - B.x, ty - B.y) > 14 && T - (B.fr0 ?? -9) > 0.35) (B.x = tx), (B.y = ty); // (the first dribble out of the hands swings over, no snap)
      } else {
        B.x = tx;
        B.y = ty;
        B.dvx = o.vx;
        B.dvy = o.vy;
      }
      B.hold = o;
    }
    B.z =
      o.mode === "c"
        ? cfg.PRO && o.st === 1
          ? o.z + 38
          : o.z + 55
        : o.mode === "s"
          ? cfg.PRO && o.st === 1
            ? o.z + 38 + Math.min(1, o.t / 0.3) * 52
            : o.z + 55 + Math.min(1, o.t / 0.4) * 28
          : inb > 0 && o.mode === "i"
            ? o.z + o.ht * 11.6 // inbounder holds it overhead
            : heldBall(o)
              ? heldZ(o)
              : dz(o, dt);
    if (heldBall(o)) B.dho = null; // the dribble starts fresh from the hand when he puts it on the floor
    // gather and shot: the ball sits in the shooting hand's palm (the same FK the release uses), so the 2D view,
    // replays and guests see it in the hand too - not 1.7 ft away on a formula (the 3D view used to hide that)
    if ((o.mode === "c" || o.mode === "s") && cfg.hand && cfg.PRO && o.q && o.q.wR != null) {
      const h = handPos(o);
      if (h && h[2] > 10) (B.x = clamp(h[0], 6, CW - 6)), (B.y = clamp(h[1], 6, CH - 6)), (B.z = h[2]); // (a finish on the end line can reach past the wall)
    }
    // held in both hands (triple threat, pump fake, jab, FT routine, inbound): the formula spot is where the hands
    // are GOING (B.tg*, the pose's IK target); the ball itself sits between the drawn palms, so a catch at the chest
    // carries the ball down to the hip with the hands instead of teleporting there ahead of them
    if (o.mode === "i" && !o.postA && (heldBall(o) || inb > 0) && cfg.hand && cfg.PRO && o.q && o.q.wR != null) {
      B.tgx = B.x;
      B.tgy = B.y;
      B.tgz = B.z;
      B.tgo = o;
      skeleton(o, HSK);
      const z = (HSK[47] + HSK[59]) / 2;
      if (z > 8) (B.x = clamp((HSK[45] + HSK[57]) / 2, 6, CW - 6)), (B.y = clamp((HSK[46] + HSK[58]) / 2, 6, CH - 6)), (B.z = z);
    } else B.tgo = null;
    B.vx = B.vy = B.vz = 0;
    return;
  }
  B.age += dt;
  // Shots, loose balls AND passes fly through Rapier (passes bounce off the real floor; bodies ignore passes).
  const RA = useRap() && (B.mode === "air" || B.mode === "pass");
  if (!RA) {
    if (airV3()) {
      // (Physics v3: the same air step as launch's pre-sim - drag + Magnus, then gravity; the spin decays slowly)
      const W = B.wv || (B.wv = [0, 0, 0]),
        wd = 1 / (1 + dt * AIR_WD);
      AV[0] = B.vx;
      AV[1] = B.vy;
      AV[2] = B.vz;
      AV[3] = W[0];
      AV[4] = W[1];
      AV[5] = W[2];
      airAcc(dt);
      B.vx = AV[0];
      B.vy = AV[1];
      B.vz = AV[2] - g * dt;
      W[0] *= wd;
      W[1] *= wd;
      W[2] *= wd;
    } else {
      B.vz -= g * dt;
      B.vx *= 1 - 0.1 * dt;
      B.vy *= 1 - 0.1 * dt;
    }
  }
  // a pass that died (rolling slowly on the floor, or stopped against a wall) is a loose ball: anyone can get it.
  // Without this, only its target could catch it and a dead pass in a corner froze the game.
  if (B.mode === "pass" && !PREDICT && (B.age > 3 || (B.age > 0.5 && B.z < 12 && Math.hypot(B.vx, B.vy) < 45 && B.dfl !== 2))) { // (a deflected pass keeps homing in on its man until the 3 s fallback: a tip never hands the defense the ball)
    B.mode = "air";
    B.to = null;
    B.sh = 0;
  }
  if (B.mode === "pass" && B.to && B.age > 0.04) {
    const r = B.to,
      dx = r.x + r.vx * 0.12 - B.x,
      dy = r.y + r.vy * 0.12 - B.y,
      ds = Math.hypot(dx, dy) || 1,
      sp = Math.hypot(B.vx, B.vy);
    B.vx += ((dx / ds) * sp - B.vx) * Math.min(1, dt * 2.5);
    B.vy += ((dy / ds) * sp - B.vy) * Math.min(1, dt * 2.5);
  }
  if (cfg.PP && B.mode === "pass" && B.to && !PREDICT && !B.dfl && B.age > 0.08 && !ftq && inb <= 0) ppDeflect();
  greenGuide(dt);
  const pz = B.z;
  if (RA) rapStep(dt, B);
  else {
    B.x += B.vx * dt;
    B.y += B.vy * dt;
    B.z += B.vz * dt;
  }
  B.a += B.vx * dt * 0.1;
  for (const hx of HXs) {
    const rx = B.x - hx,
      ry = B.y - HY,
      d = Math.hypot(rx, ry),
      b = hx > 470 ? 1 : 0;
    if (d > 0 && !RA) {
      const cx = hx + (rx / d) * RR,
        cy = HY + (ry / d) * RR,
        vx = B.x - cx,
        vy = B.y - cy,
        vz = B.z - 100,
        dd = Math.hypot(vx, vy, vz),
        m = BR + 0.8;
      if (dd < m && dd > 0) {
        const nx = vx / dd,
          ny = vy / dd,
          nz = vz / dd;
        B.x = cx + nx * m;
        B.y = cy + ny * m;
        B.z = 100 + nz * m;
        const dot = B.vx * nx + B.vy * ny + B.vz * nz;
        if (dot < 0) {
          // the back quarter (on the bracket) is deader iron; a hard hit bends the rim and loses more of its bounce
          const back = (rx / d) * (b ? 1 : -1) > 0.82,
            e = cfg.PH3 ? ph3RimE(back, dot) : (back ? 0.4 : 0.55) * (1 - 0.3 * clamp((-dot - 250) / 700, 0, 1));
          B.vx -= (1 + e) * dot * nx;
          B.vy -= (1 + e) * dot * ny;
          B.vz -= (1 + e) * dot * nz;
          if (cfg.PH3) {
            // (Physics v3: the iron grips the ball - english, rattles and roll-arounds instead of a flat 7% loss)
            spinHit(nx, ny, nz, -(1 + e) * dot, back ? 0.45 : 0.4);
            ph3RimHit();
          } else {
            B.vx *= 0.93;
            B.vy *= 0.93;
          }
          snd(300, 0.06, "triangle");
        }
      }
    }
    const bx = b ? 900 : 40;
    if (!RA && (b ? B.x > bx - BR && B.x < bx + 6 : B.x < bx + BR && B.x > bx - 6) && Math.abs(B.y - HY) < 30 && B.z > 93 && B.z < 136) {
      B.x = b ? bx - BR : bx + BR;
      const vn = b ? B.vx : -B.vx;
      if (!cfg.PH3) B.vx = -B.vx * 0.6;
      else if (vn > 0) {
        // (Physics v3: the surface's board; backspin kicks it down off the glass)
        const e = SURF[surf()][5];
        B.vx = -B.vx * e;
        spinHit(b ? -1 : 1, 0, 0, (1 + e) * vn, 0.3);
      }
      snd(200, 0.05, "square");
    }
    if (B.sh && B.z >= 100 && d < RR + 2) B.abv = b; // was above this rim
    if (B.sh && d < 20) B.rim = Math.min(B.rim ?? 99, Math.hypot(d - RR, B.z - 100)); // closest approach to the iron
    if (B.sh && Math.abs(B.x - bx) < BR + 4 && Math.abs(B.y - HY) < 32 && B.z > 90 && B.z < 140) B.gl = T; // touched the glass (airball check)
    if (B.sh && !B.sc && B.vz < 0 && ((pz >= 100 && B.z < 100 && d < RR - 1.2) || (B.abv === b && B.z < 97 && B.z > 80 && d < RR - 0.6))) {
      B.sc = 1;
      const t = cfg.HALF && B.last ? B.last.tm : b ? 0 : 1,
        pts = B.ft ? 1 : cfg.HALF ? (B.three ? 2 : 1) : B.three && B.last.tm === t ? 3 : 2;
      sc[t] += pts;
      exc(1);
      runAdd(t, pts);
      if (!B.ft && B.last && !cfg.HALF) {
        // broadcast splits: points in the paint, fast-break points, second-chance points
        if ((B.d0 ?? 999) < 160 && !B.three) TS.xs.paint[t] += pts;
        if (B.fb) TS.xs.fb[t] += pts;
        if (B.sc2) TS.xs.sec[t] += pts;
      }
      if (!B.ft && B.last) {
        zoneRes(B.last, B.d0, true);
        const L = B.last;
        cm(B.dk ? (B.flBy ? "dunkAnd1" : "dunk") : pts === 3 ? (B.gn && (B.rim ?? 99) > BR + 1.1 ? "splash" : "three") : B.fl ? "and1" : "two", L.n, B.pp && B.pp.p !== L && B.pp.p.tm === L.tm && T - B.pp.t < 3.5 ? B.pp.p.n : undefined);
      }
      {
        const L = B.last;
        if (L && L.stt) {
          L.stt.pts += pts;
          if (!B.ft) {
            L.stt.fgm++;
            if (B.three) L.stt.tpm++;
          }
          if (B.pp && B.pp.p !== L && B.pp.p.tm === L.tm && T - B.pp.t < 3.5 && !B.ft) B.pp.p.stt.ast++;
        }
      }
      if (B.last) {
        B.last.heat = Math.min(3, (B.last.heat || 0) + 1);
        if (B.last.heat === 3) (txtW("ON FIRE!", B.last.x, B.last.y, 105, "#ff9a2e"), cm("fire", B.last.n));
      }
      txtW("+" + pts, hx > 470 ? hx - 50 : hx + 20, HY, 125, pts === 3 ? "#ffd23f" : "#fff");
      if (!B.ft && !B.dk && (B.rim ?? 99) > BR + 1.1) txtW(pts === 3 ? "SPLASH!" : "SWISH!", hx, HY, 140, "#9fe7ff");
      if (cfg.PH3) ph3MakeTxt(hx);
      if (!B.ft && B.clk != null && B.clk < 1.5 && clock <= 0.05) {
        const lead = sc[t] > sc[1 - t] && sc[t] - pts <= sc[1 - t];
        txt(B.q >= 4 && lead ? "GAME WINNER!" : "BUZZER BEATER!", 480, 170, "#ffd23f");
        fx({ k: "slow", v: 1.6 });
        fx({ k: "shake", v: 0.6 });
        RQ = 1;
        RPK = 1; // the replay gets the clutch camera sequence
        HLN = (B.q >= 4 && lead ? "Game winner — " : "Buzzer beater — ") + (B.last ? B.last.n : "");
      }
      if (!B.ft && B.last) {
        // signature celebration: clutch / on fire > dunk or and-one > three
        const L = B.last,
          clutch = (B.clk != null && B.clk < 1.5 && clock <= 0.05) || L.heat === 3;
        if (clutch) celebrate(L, 2);
        else if (B.dk || B.fl) celebrate(L, 1);
        else if (pts === 3 && (B.gn || Math.random() < 0.5)) celebrate(L, 0);
      }
      snd(900, 0.25, "sine", 0.1);
      if (ftq) {
        ftq.next = 1.3;
        // a made free throw: the shooter and the closest teammate dap it up (pose CEL 9)
        const sh = ftq.s;
        if (sh && !PREDICT) {
          let m: Player | null = null,
            md = 1e9;
          for (const o of P)
            if (o !== sh && o.tm === sh.tm) {
              const d = Math.hypot(o.x - sh.x, o.y - sh.y);
              if (d < md) (md = d), (m = o);
            }
          for (const o of [sh, m]) if (o) (o.cel = 9), (o.celT = CEL_T);
        }
      }
      else if (B.fl && !cfg.HALF) {
        txtW("AND ONE!", B.last.x, B.last.y, 110, "#ffd23f");
        {
          let m: Player | null = null,
            md = 1e9;
          for (const o of P)
            if (o !== B.last && o.tm === B.last.tm) {
              const dd = Math.hypot(o.x - B.last.x, o.y - B.last.y);
              if (dd < md) (md = dd), (m = o);
            }
          if (m && !PREDICT) (m.cel = 13), (m.celT = CEL_T);
        }
        STAT.andOnes++;
        if (B.flBy) {
          tf[B.flBy.tm]++;
          B.flBy.pf++;
        }
        exc(1);
        startFT(B.last, 1);
      }
      else {
        rs = 1.4;
        pend = cfg.HALF ? t : 1 - t; // street: make it, take it
        if (cfg.TO && sc[t] >= cfg.TO) {
          rs = 0;
          endGame();
        }
        if (cfg.replays && (B.dk || (B.gn && B.three && isH(B.last)))) {
          RQ = 1;
          HLN = (B.dk ? (B.oop ? "Alley-oop — " : "Slam — ") : "From deep — ") + (B.last ? B.last.n : "");
        }
        if (cfg.PH3 && B.dk && ph3Shatter(hx)) rs = Math.max(rs, SHAT_T); // (glass everywhere: a long stoppage)
      }
      B.sh = 0;
      fin = 0;
    }
    if (B.sc && B.z > 60 && B.z < 100 && d < RR + 3) {
      // the net grabs the ball: the sideways motion fades (netSim's strands do the rest: they push it back to the
      // middle and drag on the drop, so it falls out the bottom - a hard grab here left it resting on the mesh)
      B.vx *= 0.96;
      B.vy *= 0.96;
    }
  }
  if (!RA && B.z < BR) {
    B.z = BR;
    if (Math.abs(B.vz) > 60) snd(110, 0.05, "sine", 0.1);
    if (cfg.PH3) ph3Floor();
    else {
      B.vz *= -0.72;
      B.vx *= 0.9;
      B.vy *= 0.9;
      if (Math.abs(B.vz) < 25) B.vz = 0;
    }
  }
  if (!RA && cfg.PH3 && B.z <= BR + 0.5 && Math.abs(B.vz) < 30) ph3Roll(dt);
  else if (!RA && B.z <= BR + 0.5 && Math.abs(B.vz) < 30) {
    // rolling on the wood: rolling resistance (42 px/s^2), then it stops
    const vh = Math.sqrt(B.vx * B.vx + B.vy * B.vy),
      k = vh > 1.5 ? Math.max(0, vh - 42 * dt) / vh : 0;
    B.vx *= k;
    B.vy *= k;
  }
  // A ball balanced on the iron or wedged between the back iron and the glass (it happens): after a beat it rolls off,
  // away from the middle of the rim - but never toward the backboard (that just wedged it again)
  if (!B.owner && !B.sc && B.z > 94 && B.z < 112 && !inNet() && Math.hypot(B.vx, B.vy, B.vz) < 30) {
    B.stk = (B.stk || 0) + dt;
    if (B.stk > 1.2 && !PREDICT) {
      B.stk = 0;
      const hx = Math.abs(B.x - HXs[0]) < Math.abs(B.x - HXs[1]) ? HXs[0] : HXs[1],
        court = hx > 470 ? -1 : 1, // toward mid-court
        dy = B.y - HY,
        side = Math.abs(dy) > 1 ? Math.sign(dy) : Math.random() < 0.5 ? -1 : 1;
      let dx = B.x - hx;
      if (dx * court < -(RR + 1) && gameLike() && S === "play") {
        // wedged between the back iron and the glass: no nudge gets it over the iron - the ref blows it dead (a held
        // ball; the defense gets it, like a defensive rebound) - it froze a game once, ball and clock
        const L = B.last,
          tm = L ? L.tm : pos;
        if (L && B.sh) zoneRes(L, B.d0, false);
        fx({ k: "whistle", tm });
        ban("LODGED BALL", "HELD BALL · " + cl[1 - tm].toUpperCase() + " BALL", "#ffd23f");
        STAT.lodged = (STAT.lodged || 0) + 1;
        setup(1 - tm);
        return;
      }
      // (practice / contests: no possession to give - lift a wedged ball out in front of the rim)
      if (dx * court < -(RR + 1)) (B.x = hx + court * (RR + 6)), (B.z = Math.max(B.z, 106)), (dx = court * 4);
      if (dx * court < 0) dx = court * (2 + Math.random() * 4); // behind the rim: roll it out front
      const d = Math.hypot(dx, dy) || 1;
      B.vx = (dx / d) * 55;
      B.vy = (dy / d) * 55 + side * 12;
      B.vz = 40;
      B.x += court * 2; // off the glass
    }
  } else B.stk = 0;
  // Out of bounds: a loose ball (a long rebound, a deflection, a block, a dead pass) that reaches the lines is out -
  // the other team than the last one to touch it gets it (CPU-vs-CPU and human games alike; rules: VIOL)
  if (cfg.VIOL && !PREDICT && !B.owner && (B.mode === "air" || B.mode === "pass") && (B.x < 6 || B.x > CW - 6 || B.y < 6 || B.y > CH - 6) && !(B.mode === "pass" && B.age < 0.3) && B.last && !ftq && !JB && rs <= 0 && inb <= 0 && S === "play" && gameLike() && !B.sc) {
    STAT.oob = (STAT.oob || 0) + 1;
    const L = B.last;
    if (L.stt) L.stt.tov = (L.stt.tov || 0) + 1;
    violation(L.tm, "OUT OF BOUNDS", L);
    return;
  }
  // World bounds for both engines (a fast Rapier ball could tunnel past or fly over the thin arena walls).
  {
    if (B.x < 6 || B.x > CW - 6) {
      B.x = clamp(B.x, 6, CW - 6);
      B.vx *= -0.5;
    }
    if (B.y < 6 || B.y > CH - 6) {
      if (!B.owner && Math.hypot(B.vx, B.vy) > 160 && !PREDICT && T - (B.duckT || 0) > 1) (B.duckT = T), fx({ k: "duck", x: B.x, y: B.y }); // into the courtside seats
      B.y = clamp(B.y, 6, CH - 6);
      B.vy *= -0.5;
    }
  }
  if (B.sc) return;
  if (ftq) return;
  // a green on its way in (B.gd) is nobody's to touch: only launch's block roll could have stopped it (a rebounder
  // leaping at a heave 2 ft in front of the rim snatched ~1.5% of them)
  if (B.sh && B.gd && B.mode === "air" && B.z > 60) return;
  // Cylinder rule: nobody may touch a live shot in the imaginary cylinder above either rim (no goaltending / basket
  // interference), so a green that rattles or drops in can't be snatched out of the net by a jumping rebounder.
  if (B.sh && B.mode === "air" && B.z > 55 && (Math.hypot(B.x - HXs[0], B.y - HY) < 22 || Math.hypot(B.x - HXs[1], B.y - HY) < 22)) {
    // goaltending: a defender who swats it on the way down above the rim gives up the basket
    if (cfg.VIOL && !PREDICT && B.last && !B.ft && B.vz < 0 && B.z > 101 && !B.gt) {
      const hx = hoop(B.last.tm);
      for (const p of P)
        if (p.tm !== B.last.tm && p.z > 10 && Math.hypot(p.x - B.x, p.y - B.y) < 13 && B.z < p.z + 68 + p.j * 0.2 && Math.hypot(B.x - hx, B.y - HY) < 22 && ((isH(p) && T - (p.hJ ?? -9) < 1.6) || (!B.gtc && ((B.gtc = 1), Math.random() < 0.05)))) {
          B.gt = 1;
          const t = B.last.tm,
            pts = B.three ? 3 : 2;
          sc[t] += pts;
          B.last.stt.pts += pts;
          B.last.stt.fgm++;
          if (B.three) B.last.stt.tpm++;
          runAdd(t, pts);
          ban("GOALTENDING", p.n.toUpperCase() + " · BASKET COUNTS", "#ff6b4a");
          fx({ k: "whistle", tm: p.tm });
          cm("goaltend", p.n);
          B.sh = 0;
          B.sc = 1;
          B.vx *= -0.3;
          B.vy *= -0.3;
          rs = 1.4;
          pend = 1 - t;
          return;
        }
    }
    return;
  }
  // (Physics v3: a low pass / loose ball skidding into somebody's feet kicks off them)
  if (cfg.PH3 && !PREDICT && !ftq && inb <= 0 && B.z < 14 && B.age > 0.12 && (B.mode === "pass" || (B.mode === "air" && !B.sh))) ph3Legs();
  // Contest for the loose ball: jumpers and defenders first, with some randomness.
  SORTP.length = 0;
  for (const p of P) {
    SORTP.push(p);
    // (+ the defense has inside position on a missed shot, more so when it boxed out: NBA ORB% ~24)
    p._ks = p.j + p.d * 0.3 + (p.z > 5 ? 25 : 0) + Math.random() * 40 + (hasB(p, "GC") ? 18 : 0) + (B.sh && B.last && p.tm !== B.last.tm ? 9 + ((p.boxT || 0) > 0 ? 8 : 0) : 0) + (cfg.PP ? (p.ht - 6.5) * 10 : 0); // (Pro Play: size matters on the glass)
  }
  SORTP.sort((a, b) => b._ks - a._ks);
  for (const p of SORTP) {
    if ((p === B.last && B.age < 0.3) || p.mode === "s") continue;
    let d = Math.hypot(p.x - B.x, p.y - B.y);
    const rc = B.mode === "pass" && p === B.to;
    // a pass is caught in the HANDS: once the receiver's body is close, it sticks when it reaches either palm (his
    // last drawn skeleton), so the ball doesn't jump into his hands from two feet away
    if (rc && d < 26 && d > 12 && p.skelOk && p.skel && !PREDICT) {
      const k = p.skel,
        hd = Math.min(Math.hypot(k[45] - B.x, k[46] - B.y, k[47] - B.z), Math.hypot(k[57] - B.x, k[58] - B.y, k[59] - B.z));
      if (hd > 9 && B.age < 2.5 && d > 17) d = 99; // not in his hands yet: let it come (the pass homes in on him)
    }
    if (d < (rc ? 26 : 12) && B.z > p.z + (rc ? -8 : 2) && B.z < p.z + 68 + p.j * 0.2 + (rc && B.ptype === 2 ? 55 : 0) + (cfg.PP && !rc ? (p.ht - 6.5) * 10 : 0)) {
      if (B.mode === "pass" && p !== B.to) continue;
      if (B.mode === "air" && B.age < 0.5 && (B.vz > 0 || p.tm === B.last.tm)) continue;
      // (Physics v3: a loose ball on the floor with a rival in reach too is a scramble; a hard / fancy pass can be bobbled)
      if (cfg.PH3 && B.mode === "air" && !B.sh && !PREDICT && !ftq && B.z < 40 && (B.scm || 0) < 2 && ph3Scrum(p)) break;
      if (cfg.PH3 && B.mode === "pass" && p === B.to && !PREDICT && !ftq && inb <= 0 && B.age > 0.1 && ph3Bobble(p)) break;
      // a contested catch can be fumbled (accidental turnover - steals stay off)
      if (B.mode === "pass" && p === B.to && !PREDICT && !ftq && inb <= 0 && B.age > 0.15) {
        let near = 1e9;
        for (const q of P) if (q.tm !== p.tm) near = Math.min(near, Math.hypot(q.x - p.x, q.y - p.y));
        if (near < 16 && Math.random() < 0.05 * (1.3 - p.s / 120)) {
          B.mode = "air";
          B.to = null;
          B.vx = -B.vx * 0.3 + (Math.random() - 0.5) * 90;
          B.vy = -B.vy * 0.3 + (Math.random() - 0.5) * 90;
          B.vz = 70;
          B.last = p;
          B.age = 0;
          p.act = 5;
          p.actT = 0.5;
          txtW("FUMBLED!", p.x, p.y, 95, "#ff6b4a");
          break;
        }
      }
      const wasShot = B.sh && B.last && !B.sc,
        shooter = B.last;
      if (wasShot && p.z > 8 && !PREDICT && !ftq && cfg.NP > 1 && Math.hypot(hoop(shooter.tm) - p.x, HY - p.y) > 20) {
        const rival = P.find((q2) => q2.tm !== p.tm && q2.z > 6 && Math.hypot(q2.x - p.x, q2.y - p.y) < 18);
        if (rival && Math.random() < 0.4) {
          const hx2 = hoop(shooter.tm),
            mates = P.filter((m) => m.tm === p.tm && m !== p && !m.off).sort((a2, b2) => Math.hypot(hx2 - b2.x, HY - b2.y) - Math.hypot(hx2 - a2.x, HY - a2.y)),
            m = mates[0];
          if (m) {
            const fl = 0.6;
            B.mode = "pass";
            B.to = m;
            B.ptype = 0;
            B.sh = 0;
            B.last = p;
            B.age = 0;
            B.vx = (m.x - B.x) / fl;
            B.vy = (m.y - B.y) / fl;
            B.vz = (55 - B.z + 0.5 * g * fl * fl) / fl;
            p.stt.reb++;
            if (p.tm === shooter.tm) p.stt.orb++;
            txtW(p.tm === shooter.tm ? "TAPPED BACK OUT" : "TIPPED OUT", p.x, p.y, 110, "#9fe7ff");
            cm("tipout", p.n, m.n);
            break;
          }
        }
      }
      const oop = B.mode === "pass" && B.ptype === 2 && p === B.to && p.j >= 45 && Math.hypot(hoop(p.tm) - p.x, HY - p.y) < 110 && !ftq && inb <= 0;
      if (B.sh && B.last && !B.sc) {
        p.stt.reb++;
        if (p.tm === B.last.tm) (p.stt.orb++, (TS.orbP[p.tm] = 1));
        if (!B.ft) zoneRes(B.last, B.d0, false);
        if (!B.ft) cm(p.tm === B.last.tm ? "missO" : "miss", B.last.n, p.n);
        if (!B.ft && !PREDICT && B.last.tm != null) B.last.frT = 1.8; // the shooter's face drops
        if (!B.ft && (B.rim ?? 99) < BR + 2.5) fx({ k: "ooh" }); // in and out: the whole building groans
        else if (!B.ft && (B.rim ?? 99) > BR + 4 && !(B.gl != null && T - B.gl <= B.age)) fx({ k: "air", v: B.last.tm, tm: B.last.tm, n: B.last.n }); // AIR BALL (crowd chant)
        if (hasB(p, "GC") && Math.random() < 0.3) cm("board", p.n);
      }
      if (B.sh && B.last && !B.sc) B.last.heat = Math.max(-2, (B.last.heat || 0) - 1);
      // a rebound in traffic is chinned: both hands, ball under the chin, elbows out, until he lands and looks up
      if (B.sh && !B.ft && !PREDICT && p.mode === "i") p.chinT = p.z > 6 ? 0.45 + p.z / 200 : 0.35;
      if (B.mode === "pass" && B.kick && p === B.to && !PREDICT) (p.kickT = 2.5), (STAT.kick = (STAT.kick || 0) + 1);
      if (B.ctl != null && !PREDICT) (p.tm === B.ctl && (STAT.ctlKeep = (STAT.ctlKeep || 0) + 1)), (B.ctl = null);
      B.owner = p;
      B.scm = 0;
      B.mode = "held";
      B.sh = 0;
      B.to = null;
      if (p.tm !== pos) {
        pos = p.tm;
        shot = 24;
        PCNT[0] = PCNT[1] = 0;
        if (!cfg.HALF && !PREDICT) TS.trT[p.tm] = T; // a live-ball change of possession: a transition chance
        TS.orbP[0] = TS.orbP[1] = 0;
        // street: a change of possession has to be taken back and checked at the top
        if (cfg.HALF && !PREDICT && rs <= 0) {
          rs = 0.5;
          pend = p.tm;
          txtW("TAKE IT BACK", p.x, p.y, 100, "#9fe7ff");
        }
      }
      snd(180, 0.05, "square");
      if (wasShot && shooter && shooter !== p && shooter.cw != null && shooter.cw < 0.35 && Math.random() < 0.6 && !PREDICT) (shooter.cel = 11), (shooter.celT = CEL_T); // missed an open look
      if (B.mode === "held" && p.mode === "i" && p.z <= 0 && !oop) p.ttT = 1.3; // squares up in the triple threat
      // offensive rebound in the air at the rim: tip it in or throw down the putback
      if (wasShot && shooter && shooter.tm === p.tm && p.z > 8 && !oop && !ftq && Math.hypot(hoop(p.tm) - p.x, HY - p.y) < 45) {
        p.mode = "s";
        p.t = 0.27;
        p.sv = p.j >= 65 ? 11 : 16;
        p.rl = 0;
        p.hk = 1;
        txtW(p.sv === 11 ? "PUTBACK SLAM!" : "TIP-IN", p.x, p.y, 115, "#ffd23f");
      }
      if (cfg.PP && !oop && p.mode === "i") upPutback(p, wasShot, shooter);
      if (oop) {
        // ALLEY-OOP: catch it in the air and throw it down
        p.mode = "s";
        p.t = 0.27;
        p.sv = Math.random() < 0.5 ? 6 : 11;
        p.rl = 0;
        p.vz = Math.max(p.vz, 175);
        p.oop = 1;
        txtW("ALLEY-OOP!", p.x, p.y, 120, "#ffd23f");
        exc(1);
      }
      break;
    }
  }
}
const ZIN = (): Input => ({ dx: 0, dy: 0 });
const ZERO_IN: Input[] = [];
const zin = (k: number) => NOIN(ZERO_IN[k] || (ZERO_IN[k] = ZIN()));
export function upd(dt: number) {
  const NP = cfg.NP;
  T += dt;
  DT = dt;
  fc -= dt;
  if (RPL) {
    const rk = RSPD * (RPL.k || 1);
    rplStep(dt);
    netSim(dt * rk, 1); // the net moves in replays too (no pull on the replayed ball)
    return;
  }
  if (S !== "play") return;
  for (const c of CT) c.inp = cfg.input ? cfg.input(c) : ZIN();
  if (JB) {
    jbStep(dt);
    netSim(dt);
    recFrame();
    for (const p of P) pose3(p);
    return;
  }
  P.forEach((p, k) => {
    if (inb > 0 || (ftq && p !== ftq.s) || p.off) {
      p.in = zin(k);
      if (inb > 0 && INB.on && !p.off && !ctrlOf(k) && p !== B.owner) inbMove(p);
      return;
    }
    const c = ctrlOf(k);
    if (c) {
      p.in = rs > 0 ? zin(k) : c.inp;
      if (c.inp.sd) p.hJ = T; // the human's own jump press (goaltending only counts jumps he started)
    } else ai(p, dt);
  });
  // Rebound/loose-ball assist for idle humans.
  for (const c of CT) {
    const h = c.inp;
    if (rs <= 0 && !B.owner && !ftq && inb <= 0 && (B.mode !== "pass" || B.to === P[c.idx])) {
      const q = P[c.idx],
        // a live shot still up around either rim: the assist never jumps for the human (it walked him into
        // goaltending on every CPU shot); he jumps himself if he wants to
        noJ = B.sh && B.mode === "air" && B.z > 80 && (Math.hypot(B.x - HXs[0], B.y - HY) < 140 || Math.hypot(B.x - HXs[1], B.y - HY) < 140);
      if (!h.dx && !h.dy && !h.sd && q.mode === "i") {
        q.in = zin(c.idx);
        loose(q, q.tm);
        if (noJ) q.in.sd = 0;
      } else if (q.mode === "i" && B.mode === "air" && Math.hypot(B.x - q.x, B.y - q.y) < 150) {
        const a = { dx: 0, dy: 0 } as Input,
          sv = q.in;
        q.in = a;
        loose(q, q.tm);
        q.in = sv;
        // (only when he is heading the same way: a human running somewhere else - back on defense, out to the
        // arc - keeps his stick and is never jumped for)
        if (sv.dx * a.dx + sv.dy * a.dy > 0) {
          sv.dx = sv.dx * 0.4 + a.dx * 0.9;
          sv.dy = sv.dy * 0.4 + a.dy * 0.9;
          if (!noJ && (a.sd || (q.z <= 0 && B.z > 45 && Math.hypot(B.x - q.x, B.y - q.y) < 34))) sv.sd = 1;
        }
      }
    }
  }
  for (const c of CT) {
    const h = c.inp;
    if (h.to && !callTO(c.tm)) txt(TS.to[c.tm] > 0 ? "TIMEOUT: only with the ball or at a dead ball" : "NO TIMEOUTS LEFT", 480, 240, "#ff9966");
    if (h.ch && !challenge(c.tm)) txt(TS.chal[c.tm] <= 0 ? "CHALLENGE ALREADY USED" : "NOTHING TO CHALLENGE", 480, 240, "#ff9966");
    if (h.ds) {
      const off = pos === c.tm && !!B.owner;
      if (off) TS.pc[c.tm] = (TS.pc[c.tm] + 1) % PCN.length;
      else TS.ds[c.tm] = (TS.ds[c.tm] + 1) % DSN.length;
      if (off) PLAY[c.tm] = null;
      txt(off ? "PLAY CALL: " + PCN[TS.pc[c.tm]] : "DEFENSE: " + DSN[TS.ds[c.tm]], 480, 150, "#9fe7ff");
    }
  }
  ftIn(dt);
  if (inb > 0) {
    inb -= dt;
    if (inb <= 0 && B.owner && B.mode === "held") {
      const o = B.owner;
      if (NP > 1 && !cfg.HALF) {
        let b = null,
          bv = -1e9;
        for (const q of P)
          if (q.tm === o.tm && q !== o) {
            const nd = P[nearest(1 - o.tm, q.x, q.y)],
              v = Math.min(80, Math.hypot(nd.x - q.x, nd.y - q.y)) - Math.hypot(q.x - o.x, q.y - o.y) * 0.1;
            if (v > bv) {
              bv = v;
              b = q;
            }
          }
        pass(o, b, 0);
      }
    }
  }
  // Which player each human controls.
  for (const c of CT) {
    if (c.inp.sw && !c.fixed && !(B.owner && B.owner.tm === c.tm)) c.idx = nearestFree(c, B.x, B.y, c.idx);
    if (c.fixed) c.idx = c.tm * NP; // My Player is always slot 0 of his team (and shoots his own FTs)
    else if (B.owner && B.owner.tm === c.tm) {
      const k = c.tm * NP + B.owner.k;
      if (!CT.some((o) => o !== c && o.idx === k)) c.idx = k;
    } else if (B.owner) {
      if (B.owner !== c.lastO) c.idx = nearestFree(c, B.owner.x, B.owner.y);
    } else if (P[c.idx].mode !== "s") c.idx = nearestFree(c, B.x, B.y);
    c.lastO = B.owner;
  }
  if ((rs > 0 || inb > 0) && !PREDICT && cfg.PRO) deadBall(dt);
  if (HOOK.pre) HOOK.pre(dt);
  for (const p of P) if (!p.off) step(p, dt);
  if (cfg.PP) upTick(dt);
  // body english: the shooter leans and waves at a ball rolling around the rim
  if (B.sh && !B.sc && !B.owner && B.last && !B.last.off) {
    const L = B.last,
      hx = hoop(L.tm),
      d = Math.hypot(B.x - hx, B.y - HY);
    if (d < 15 && B.z > 88 && B.z < 118) {
      const ux = hx - L.x,
        uy = HY - L.y,
        ul = Math.hypot(ux, uy) || 1;
      L.engT = 0.25;
      L.eng = clamp((((B.x - hx) * -uy + (B.y - HY) * ux) / ul) / 6, -1, 1);
    }
  }
  collide();
  if (useRap() && cfg.playerBodies) rapSyncPlayers(P, B);
  bstep(dt / 2);
  bstep(dt / 2);
  ftTick(dt);
  netSim(dt);
  recFrame();
  lagRec();
  for (const p of P) pose3(p);
  if (HOOK.post && HOOK.post(dt)) return;
  if (rs > 0) {
    rs -= dt;
    if (TS.hud > 0) TS.hud = Math.max(0, TS.hud - dt); // (always: deadBall only runs with Pro Play on)
    if (rs <= 0) {
      if (RQ && recN > 80) {
        startReplay();
        return;
      }
      setup(pend);
    }
    return;
  }
  if (clock > 0 && !ftq && inb <= 0) clock = Math.max(0, clock - dt);
  if (q >= 4 && Math.abs(sc[0] - sc[1]) <= 6 && B.owner && Math.floor(T / 2.6) !== Math.floor((T - dt) / 2.6)) fx({ k: "chant", tm: 1 - pos });
  if (gameLike()) rulesTick(dt);
  if (S !== "play" || rs > 0) return; // a violation / timeout just stopped play
  if (B.owner && !ftq && inb <= 0 && cfg.SCLK) shot -= dt;
  if (shot <= 0 && !ftq) {
    txt("SHOT CLOCK!", 470, 200, "#ff6b4a");
    setup(1 - pos);
  }
  if (clock <= 0 && !ftq && !(B.sh && !B.owner)) {
    if (q >= 4 && sc[0] !== sc[1]) endGame();
    else {
      TS.qs.push([sc[0], sc[1]]);
      q++;
      tf = [0, 0];
      TS.l2[0] = TS.l2[1] = TS.bon[0] = TS.bon[1] = 0;
      if (q > 4 && gameLike()) TS.to[0] = TS.to[1] = 2; // two timeouts per overtime
      for (const p of P) p.en = Math.min(1, (p.en ?? 1) + 0.25); // quarter break
      if (q === 3 && !TS.half) {
        TS.half = 1;
        fx({ k: "half" });
      }
      clock = q > 4 ? (cfg.GM === "clutch" || cfg.GM === "daily" ? 30 : QTRLEN / 2) : QTRLEN; // scenario overtime: 30 real seconds
      setup(q % 2 ? 0 : 1);
      txt(q > 4 ? "OVERTIME" : "QUARTER " + q, 470, 200, "#ffd23f");
    }
  }
}
/** Dead balls: after a make everyone jogs back up the floor instead of standing frozen, teammates slap five, players
 *  tug their jerseys; a man on the floor gets helped up by the nearest teammate (also during inbounds). */
function deadBall(dt: number) {
  const NP = cfg.NP;
  for (const p of P) {
    if (p.off || (ftq && ftq.i >= 0)) continue;
    // help a teammate up
    if (!(p.actT > 0) && p.z <= 0 && p.mode === "i") {
      const f = P.find((o) => o.tm === p.tm && o !== p && o.act === 3 && o.actT > 0.25 && Math.hypot(o.x - p.x, o.y - p.y) < 130);
      if (f && P.filter((o) => o.tm === p.tm && o !== f).sort((a, b) => Math.hypot(a.x - f.x, a.y - f.y) - Math.hypot(b.x - f.x, b.y - f.y))[0] === p) {
        const d = Math.hypot(f.x - p.x, f.y - p.y);
        if (d > 13) {
          p.in.dx = ((f.x - p.x) / d) * 0.7;
          p.in.dy = ((f.y - p.y) / d) * 0.7;
        } else {
          p.in.dx = p.in.dy = 0;
          p.helpP = f;
          if (!(p.celT > 0)) (p.cel = 16), (p.celT = 0.9);
          f.actT = Math.min(f.actT, 0.45);
        }
        continue;
      }
    }
    if (rs <= 0) continue; // inbounds: everyone else holds his spot
    if ((TS.hud || 0) > 0 && !cfg.HALF) {
      // timeout huddle: a tight circle in front of the bench (far sideline), facing in; hands in at the end
      const tm = P.filter((o) => o.tm === p.tm && !o.off),
        j = tm.indexOf(p),
        cx = 470 + (p.tm ? 1 : -1) * 130,
        cy = 34,
        a = (j / tm.length) * Math.PI * 2 + 0.4,
        r = 15 + tm.length * 2,
        tx = cx + Math.cos(a) * r,
        ty = cy + Math.sin(a) * r,
        d = Math.hypot(tx - p.x, ty - p.y);
      p.hcx = cx;
      p.hcy = cy;
      if (d > 5) (p.in.dx = ((tx - p.x) / d) * Math.min(0.75, d / 40)), (p.in.dy = ((ty - p.y) / d) * Math.min(0.75, d / 40));
      else (p.in.dx = p.in.dy = 0), (p.f = Math.atan2(cy - p.y, cx - p.x));
      p.hudT = d < 12 && TS.hud < 0.75 ? 0.2 : 0; // hands in
      continue;
    }
    // jog back: the team inbounding toward its backcourt, the other team back on defense
    const off = p.tm === pend,
      tx = off ? hoop(1 - pend) + (hoop(1 - pend) > 470 ? -170 : 170) : hoop(pend) + (hoop(pend) > 470 ? -150 : 150),
      dx = tx - p.x;
    if (Math.abs(dx) > 30 && !(p.celT > 0 && p.cel !== 9)) {
      p.in.dx = Math.sign(dx) * 0.42;
      p.in.dy = (250 + (p.k - (NP - 1) / 2) * 80 - p.y) / 300;
    }
    if (!(p.celT > 0) && Math.random() < dt * 0.12) (p.cel = 15), (p.celT = 0.9); // tug the jersey
  }
  // a quick low five between the scorer's teammates right after the bucket
  if (rs > 1.36 && rs < 1.4 && B.last && Math.random() < 0.5) {
    const L = B.last,
      m = P.filter((o) => o.tm === L.tm && o !== L && !o.off).sort((a, b) => Math.hypot(a.x - L.x, a.y - L.y) - Math.hypot(b.x - L.x, b.y - L.y))[0];
    if (m && !(L.celT > 0) && Math.hypot(m.x - L.x, m.y - L.y) < 90) for (const o of [L, m]) (o.cel = 9), (o.celT = 1.1);
  }
}
/** After the final buzzer (S === "over"): everyone walks toward his opposite number and daps him up. */
export function postGame(dt: number) {
  if (S !== "over" || RPL) return;
  T += dt;
  DT = dt;
  const NP = cfg.NP;
  for (let k = 0; k < NP; k++) {
    const a = P[k],
      b = P[NP + k];
    if (!a || !b) continue;
    const mx = (a.x + b.x) / 2,
      my = (a.y + b.y) / 2;
    for (const [p, o] of [
      [a, b],
      [b, a],
    ] as [Player, Player][]) {
      const tx = mx + Math.sign(p.x - o.x || 1) * 7,
        dx = tx - p.x,
        dy = my - p.y,
        d = Math.hypot(dx, dy),
        v = d > 4 ? Math.min(110, d * 2) : 0;
      p.vx = d > 0 ? (dx / d) * v : 0;
      p.vy = d > 0 ? (dy / d) * v : 0;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z = 0;
      p.mode = "i";
      p.ph += ((v * dt) / stepLen(v)) * Math.PI;
      const tf = d > 6 ? Math.atan2(dy, dx) : Math.atan2(o.y - p.y, o.x - p.x);
      p.f += Math.atan2(Math.sin(tf - p.f), Math.cos(tf - p.f)) * Math.min(1, dt * 8);
      if (d < 6 && !(p.celT > 0) && !p.pgDap) (p.cel = 9), (p.celT = CEL_T), (p.pgDap = 1);
      if (p.celT > 0) p.celT = Math.max(0, p.celT - dt);
    }
  }
  if (B.owner) B.owner = null;
  for (const p of P) pose3(p);
}
export function endGame() {
  S = "over";
  fx({ k: "end", w: sc[0] > sc[1] ? 0 : 1 });
  if (HOOK.end) HOOK.end();
  snd(sc[0] > sc[1] ? 800 : 200, 0.5, "triangle");
}
export function foul(d: Player, o: Player, k: string, sh: number, th: any, flag = 0) {
  fx({ k: "whistle", tm: d.tm });
  tf[d.tm]++;
  d.pf++;
  STAT.fouls++;
  STAT["f_" + k] = (STAT["f_" + k] || 0) + 1;
  whistle(d, o, k === "SHOOTING" ? LASTP_FOUL : 0.6);
  if (!PREDICT && Math.random() < 0.55) (d.cel = 12), (d.celT = CEL_T); // palms up: "I got ball!"
  txtW(k + " FOUL", d.x, d.y, 95, "#ff6b4a");
  snd(120, 0.3, "sawtooth", 0.1);
  B.sh = 0;
  B.ft = 0;
  // the bonus: the 5th team foul of a quarter (4th in overtime), or the 2nd in the last two minutes of the period
  if (bcast() < 120) TS.l2[d.tm]++;
  const bon = tf[d.tm] >= (q > 4 ? 4 : 5) || TS.l2[d.tm] >= 2,
    n = cfg.HALF ? 0 : sh ? (th ? 3 : 2) : bon ? 2 : 0;
  if (bon && !TS.bon[d.tm] && !cfg.HALF) {
    TS.bon[d.tm] = 1;
    if (!sh && !flag) txt("BONUS", 480, 230, "#ffd23f"), cm("bonus", cl[1 - d.tm]);
  }
  if (n) {
    startFT(o, n, flag ? o.tm : 0, 0);
    if (flag) ftq.keep = 1;
  }
  else {
    B.owner = o;
    B.mode = "held";
    setupAt(o.tm, o.x, o.y); // (side out at the spot of the foul)
  }
}
function tech(d: Player, ret: number) {
  if (!cfg.FOULS) return;
  cm("tech", d.n);
  txtW("TECHNICAL FOUL", d.x, d.y, 95, "#ff3b3b");
  let b = null;
  for (const p of P) if (p.tm !== d.tm && (!b || p.c > b.c)) b = p;
  B.sh = 0;
  startFT(b, 1, ret, 1);
}
function startFT(s: Player, n: number, ret?: any, tech?: any) {
  STAT.fts += n;
  ftq = { s, n, i: -1, ret, tech, next: 0.9, w: 1.2, fired: 0 };
}
function ftLay() {
  const f = ftq,
    s = f.s,
    hx = hoop(s.tm),
    d = hx > 470 ? -1 : 1,
    fc0 = hx > 470 ? 0 : Math.PI;
  // NBA lane: on each side the defense has the low block, then the offense, then the defense (bigs first); everybody
  // else waits behind the arc (the shooter's team up top for the long rebound, the rest on the wings)
  P.forEach((p) => {
    p.vx = p.vy = p.z = p.vz = 0;
    p.mode = "i";
  });
  const byHt = (t: number) => P.filter((p) => p.tm === t && p !== s && !p.off).sort((a, b) => b.ht - a.ht),
    df = byHt(1 - s.tm),
    of = byHt(s.tm),
    lane: [Player[], number][] = [
      [df, 0],
      [df, 0],
      [of, 1],
      [of, 1],
      [df, 2],
      [df, 2],
    ];
  let side = 0;
  for (const [arr, k] of lane) {
    const p = arr.shift();
    if (!p) continue;
    p.x = hx + d * (70 + k * 28);
    p.y = 250 + (side++ & 1 ? 46 : -46);
    p.f = p.y < 250 ? Math.PI / 2 : -Math.PI / 2; // facing across the lane, at the rim side
    p.f += d * 0.35 * (p.y < 250 ? 1 : -1);
  }
  const rest = [...of, ...df],
    spots: [number, number][] = [
      [262, 0],
      [215, -165],
      [215, 165],
      [262, -60],
      [262, 60],
    ];
  rest.forEach((p, j) => {
    const sp = spots[j % spots.length];
    p.x = hx + d * sp[0];
    p.y = 250 + sp[1];
    p.f = fc0;
  });
  s.x = hx + d * 137;
  s.y = 250;
  s.f = fc0;
  s.ai = {};
  B.owner = s;
  B.mode = "held";
  B.sh = 0;
  B.sc = 0;
  B.ft = 1;
  pos = s.tm;
  shot = 24;
}
function ftTick(dt: number) {
  const f = ftq;
  if (!f) return;
  if (f.next > 0) {
    f.next -= dt;
    if (f.next <= 0) {
      f.fired = 0;
      f.w = 1.1;
      if (f.i + 1 < f.n) {
        f.i++;
        ftLay();
      } else {
        ftq = null;
        if (f.tech || f.keep) setup(f.ret);
      }
    }
    return;
  }
  // a missed free throw (not the last) is dead: line up for the next one - also when the miss caroms straight back into
  // somebody's hands (a shooter who caught his own miss held the sequence forever: the clock never ran again)
  if (f.fired && !B.sc && (B.age > 1.3 || (B.owner && B.age > 0.3))) f.next = 0.3;
}
function ftIn(dt: number) {
  const f = ftq;
  if (!f || f.i < 0) return;
  const s = f.s,
    a = s.ai,
    k = P.indexOf(s);
  // A human on the shooter's team shoots it (My Player only shoots his own).
  const c = CT.find((c) => c.tm === s.tm && (!c.fixed || s.my)) || null;
  if (c) {
    c.idx = k;
    const h = c.inp;
    s.in = { dx: 0, dy: 0, sd: h.sd, su: h.su, mt: h.mt, tp: h.tp };
  } else {
    s.in = { dx: 0, dy: 0 };
    f.w -= dt;
    if (f.w < 0 && s.mode === "i" && !f.fired) {
      s.in.sd = 1;
      a.rel = 0.6 + (Math.random() - 0.5) * 0.1;
    }
    if (s.mode === "c" && s.t >= (a.rel || 0.6)) s.in.su = 1;
  }
}
export const OFFS: (Player | null)[] = [null, null];
/** Game counters (tests / tuning): screens that connected, shooting fouls, and-ones. */
export const STAT: Record<string, number> = { screens: 0, shootFouls: 0, andOnes: 0, fouls: 0, fts: 0 };
/**
 * Half-court plays. One per possession window (~5.5 s), chosen from personnel:
 *  pnr   - big sets a ball screen on the handler's defender, plants, then rolls (or pops if he can shoot)
 *  pin   - best off-ball shooter starts on the block and curls up off a pindown at the elbow
 *  flare - screener sets a back-screen so a shooter drifts to the weak-side wing
 * Everyone else spaces to corners/wings and cuts backdoor when overplayed.
 * A screener in phase "set" is planted (no movement, setT > 0): defenders who run into him are stopped (collide()).
 */
export interface Play {
  kind: "pnr" | "pin" | "flare";
  t0: number;
  scr: Player; // screener
  use: Player; // player using the screen
  def: Player; // defender being screened
  ph: "go" | "set" | "out";
  sx: number;
  sy: number;
  setAt: number;
  rd?: number; // pick-and-roll read (CPU screeners): 0 set it, 1 slip it to the rim, 2 ghost it and pop to the arc
  // team play pack (v5.4): named sets on top of the three actions (see tpSet)
  v?: string; // "" | horns | spain (pnr) | stagger | zip | post (pin)
  s2?: Player | null; // second big (horns), back-screener (spain), second stagger screener (stagger)
  sd?: number; // the play's side (+-1), fixed when it is called
  st?: number; // stage (stagger: which screen he is running off; spain: back screen planted)
  stT?: number; // when the stage started
  pop?: number; // the screener popped (1) or rolled (0) - read by the second big in horns
  nm?: string; // set name (HUD / commentary)
  ato?: number; // after-timeout / end-of-quarter call
  fed?: number; // post entry delivered
  ic?: number; // ICE shown (counted once)
  bl?: number; // blitz trap sprung (counted once)
  cal?: number; // the featured man came open: the handler was told (once)
  fa?: number; // a base play called in the backcourt (re-called in the half court)
}
export const PLAY: (Play | null)[] = [null, null];
const manOf = (o: Player) => {
  const t = 1 - o.tm;
  for (const d of P) if (d.tm === t && d.manT > 0 && d.man === P.indexOf(o)) return d;
  const mu = TS.mu[t];
  if (mu) {
    const k = mu.indexOf(o.k);
    if (k >= 0) return P[t * cfg.NP + k];
  }
  return P[t * cfg.NP + o.k];
};
/** Isolation: called by the user, or the CPU clears out for its star late in the clock. */
const starOf = (t: number) => P.filter((q) => q.tm === t).sort((a, b) => ovr(b) - ovr(a))[0];
const isoNow = (t: number) => TS.pc[t] === 4 || (!CT.some((c) => c.tm === t) && shot < 8 && B.owner === starOf(t));
function newPlay(t: number): Play | null {
  const h = B.owner,
    ms = P.filter((q) => q.tm === t && q !== h);
  if (!h || ms.length < 2) return null;
  const pc = TS.pc[t];
  const big = [...ms].sort((a, b) => b.ht * b.bk + b.i / 60 - (a.ht * a.bk + a.i / 60))[0],
    sh = [...ms].sort((a, b) => b.c + 30 * ((b.sg && b.sg.off) || 0) - (a.c + 30 * ((a.sg && a.sg.off) || 0)))[0],
    r = Math.random();
  if (pc >= 5 && cfg.NP >= 3 && Math.hypot(hoop(t) - h.x, HY - h.y) > 330) return null; // (a called set starts in the half court)
  const tp = tpSet(t, h, ms, big, sh, pc); // (named sets: horns, Spain pick-and-roll, stagger, zipper, post entry, ATO)
  if (tp) return tp;
  // Curry-style shooters get pindowns/flares; otherwise pick-and-roll is the bread and butter
  const kind: Play["kind"] = pc === 1 || pc >= 5 ? "pnr" : pc === 2 ? "pin" : pc === 3 ? "flare" : sh.c >= 82 && sh !== big && r < 0.5 ? (r < 0.3 ? "pin" : "flare") : "pnr";
  const scr = kind === "pnr" ? big : ms.filter((q) => q !== sh).sort((a, b) => b.ht * b.bk - a.ht * a.bk)[0],
    use = kind === "pnr" ? h : sh;
  // (fa: called while the ball was still coming up the floor - re-called once it crosses into the half court, when the
  // coach's named sets can start)
  return { kind, t0: T, scr, use, def: manOf(use), ph: "go", sx: 0, sy: 0, setAt: 0, fa: cfg.TP && cfg.NP >= 3 && cpuIQ(t) >= 1 && Math.hypot(hoop(t) - h.x, HY - h.y) > 330 ? 1 : 0 };
}
function offBall(p: Player, t: number) {
  if (cfg.NP < 2) return false;
  const hx = hoop(t),
    dir = hx > 470 ? -1 : 1, // from the hoop toward half court
    h = B.owner;
  {
    // never camp in the lane (3 seconds): step out to the short corner / wing
    const k = P.indexOf(p);
    if (cfg.VIOL && TS.lane[k] > 2.1) {
      mv(p, hx + dir * 205, p.y < HY ? HY - 130 : HY + 130, 1.15);
      p.br = "lane";
      return true;
    }
  }
  const iso = isoNow(t);
  let pl = iso ? null : PLAY[t];
  if (!iso && (!pl || T - pl.t0 > (pl.v ? 6.5 : 5.5) || (pl.fa && pl.ph === "go" && h && Math.hypot(hx - h.x, HY - h.y) <= 330) || pl.use.tm !== t || (pl.kind === "pnr" && pl.use !== h) || pl.scr === h || (pl.s2 && (pl.s2 === h || pl.s2.tm !== t)))) pl = PLAY[t] = newPlay(t);
  if (iso) PLAY[t] = null;
  OFFS[t] = null;
  if (!pl && !iso) return false;
  // post entry delivered: he goes to work on the block
  if (pl && pl.v === "post" && h === pl.use && !pl.fed) (pl.fed = 1), (h.ai.post = 1), (h.ai.pw = 0), (STAT.postFed = (STAT.postFed || 0) + 1);
  const scr = pl ? pl.scr : null,
    use = pl ? pl.use : null,
    def = pl ? (pl.def = manOf(use)) : null,
    side = (use || p).y < HY ? -1 : 1;
  if (pl) {
  // screen spot: on the defender's hip, on the side the user will run past
  if (pl.ph !== "set") {
    if (pl.kind === "pnr") {
      const mid = HY - use.y > 0 ? 1 : -1; // screen toward the middle of the floor
      pl.sx = def.x + dir * 6;
      pl.sy = def.y + mid * 13;
    } else if (pl.v) tpSpot(pl, hx, dir);
    else if (pl.kind === "pin") {
      pl.sx = hx + dir * 120;
      pl.sy = HY + side * 70;
    } else {
      pl.sx = hx + dir * 175;
      pl.sy = HY - side * 40;
    }
  }
  if (p === scr) {
    p.br = "scr";
    if (pl.ph === "go") {
      if (T - pl.t0 < 0.05 && isH(h) && TS.pc[t]) txtW(PCN[TS.pc[t]], p.x, p.y, 95, "#9fe7ff");
      // read the coverage once: a hedge / trap jumps the handler - slip to the rim before contact; a switch-everything
      // defense just swaps - a shooting screener ghosts it (fakes the screen, pops to the arc before anybody switches)
      if (pl.kind === "pnr" && pl.rd == null) {
        const cov = TS.cov[1 - t],
          ds = TS.ds[1 - t],
          r = Math.random();
        pl.rd = (cov === 1 || cov === 3 || TS.dbl[1 - t] === P.indexOf(use)) && r < 0.45 ? 1 : ds === 3 && p.c >= 78 && r < 0.5 ? 2 : 0;
      }
      if (pl.rd && Math.hypot(p.x - pl.sx, p.y - pl.sy) < 26) {
        pl.ph = "out";
        pl.setAt = T;
        STAT[pl.rd === 1 ? "slip" : "ghost"] = (STAT[pl.rd === 1 ? "slip" : "ghost"] || 0) + 1;
        if (pl.rd === 1 && Math.random() < 0.35) cm("slip", p.n);
        return true;
      }
      mv(p, pl.sx, pl.sy, 1.2);
      if (Math.hypot(p.x - pl.sx, p.y - pl.sy) < 7 || T - pl.t0 > (pl.v ? 1.8 : 2.6)) {
        pl.ph = "set";
        pl.setAt = T;
      }
    } else if (pl.ph === "set") {
      p.in.dx = p.in.dy = 0; // planted
      p.vx *= 0.5;
      p.vy *= 0.5;
      p.setT = 0.25;
      if (T - pl.setAt > (pl.v ? tpSetLen(pl) : pl.kind === "pnr" ? 1.25 : 1.5)) pl.ph = "out"; // (named sets run quicker)
    } else {
      // (Spain: the screener always rolls - the back screen springs him)
      // roll hard to the rim, or pop to the arc if he can shoot (read the coverage: a big sitting back in drop leaves
      // the arc open for any decent shooter; a hedge leaves the rim open, so everybody dives; a ghost always pops)
      const cov = TS.cov[1 - t],
        pop = pl.rd === 2 || (pl.rd !== 1 && pl.v !== "spain" && (cov === 1 ? false : scr.c >= (cov === 0 && !CT.some((c) => c.tm === 1 - t) ? 74 : 80) && scr.i < 85)),
        g = pop ? [hx + dir * 225, HY + side * -60] : [hx + dir * 30, HY + side * 14];
      pl.pop = pop ? 1 : 0;
      mv(p, g[0], g[1], 1.2);
      if (!pop && Math.hypot(p.x - hx, p.y - HY) < 90 && Math.hypot(manOf(p).x - p.x, manOf(p).y - p.y) > 30) OFFS[t] = p;
      if (pop && Math.hypot(manOf(p).x - p.x, manOf(p).y - p.y) > 40) OFFS[t] = p;
    }
    return true;
  }
  if (pl.s2 && p === pl.s2) return tpS2(p, pl, t, hx, dir);
  if (p === use && pl.kind !== "pnr") {
    p.br = "use";
    if (pl.v) return tpUse(p, pl, t, hx, dir);
    if (pl.ph === "go") mv(p, hx + dir * 28, HY + side * 60, 1); // set up low
    else {
      // run tight off the screener's shoulder, then up to the wing/top
      const g = pl.kind === "pin" ? [hx + dir * 230, HY + side * 95] : [hx + dir * 220, HY - side * 150];
      const nearS = Math.hypot(p.x - scr.x, p.y - scr.y) > 22 && pl.ph === "set";
      mv(p, nearS ? scr.x + dir * 4 : g[0], nearS ? scr.y + side * 9 : g[1], 1.25);
      if (Math.hypot(def.x - p.x, def.y - p.y) > 34 && Math.hypot(p.x - hx, p.y - HY) > 180) OFFS[t] = p;
    }
    return true;
  }
  }
  // a post scorer with a small on him (after a switch): seal on the ball-side block and call for it
  if (p !== scr && p !== use && cfg.NP > 1 && !CT.some((c) => c.tm === t && P[c.idx] === p)) {
    const mm = manOf(p);
    // (a short window per possession, and only while the ball is out at the arc to feed him: no clogged lane)
    if (mm && !mm.off && p.i >= 76 && p.ht - mm.ht >= 0.4 && !(TS.lane[P.indexOf(p)] > 1.6) && (p.ai.sealT || 0) < 2.5 && Math.hypot(hx - h.x, HY - h.y) > 200 && Math.hypot(hx - h.x, HY - h.y) < 300) {
      p.ai.sealT = (p.ai.sealT || 0) + DT;
      p.br = "seal";
      const bs = h.y < HY ? -1 : 1;
      mv(p, hx + dir * 40, HY + bs * 48, 1.1);
      if (Math.hypot(p.x - (hx + dir * 40), p.y - (HY + bs * 48)) < 20) (p.callT = Math.max(p.callT || 0, 0.3)), (STAT.seal = (STAT.seal || 0) + 1);
      return true;
    }
  }
  // spacing + backdoor cuts for everyone else
  const s2 = pl ? pl.s2 : null,
    ms = P.filter((q) => q.tm === t && q !== h && q !== scr && q !== use && q !== s2),
    spots = [
      [hx + dir * 15, HY - 230],
      [hx + dir * 15, HY + 230],
      [hx + dir * 190, HY - 175],
      [hx + dir * 190, HY + 175],
      [hx + dir * 250, HY],
    ],
    k = ms.indexOf(p);
  if (k < 0) return false;
  const used = new Set<number>();
  // (and away from the teammates who are not spacing: the screener, the man using the screen, the handler)
  const nearBusy = (x: number, y: number) => {
    for (const o of [scr, use, h, s2]) if (o && o.tm === t && Math.hypot(o.x - x, o.y - y) < 80) return true;
    return false;
  };
  // the spacers' spots are assigned together, once per tick: the assignment with the least total travel (no one
  // running across the floor through a teammate to the spot nobody else wanted), a spot where the ball is or where
  // the driver is heading taken last, and a little stickiness so nobody flip-flops between two spots
  if (SPA.t !== t || SPA.at !== T) {
    SPA.t = t;
    SPA.at = T;
    SPA.m.clear();
    const bx = h ? h.x + h.vx * 0.5 : B.x,
      by = h ? h.y + h.vy * 0.5 : B.y,
      n = Math.min(ms.length, spots.length),
      cost = ms.slice(0, n).map((q) =>
        spots.map(
          (sp, j) =>
            Math.hypot(sp[0] - q.x, sp[1] - q.y) +
            (Math.hypot(sp[0] - B.x, sp[1] - B.y) < 90 || Math.hypot(sp[0] - bx, sp[1] - by) < 120 ? 400 : 0) +
            (nearBusy(sp[0], sp[1]) ? 300 : 0) +
            (q.ai.spj === j ? -45 : 0),
        ),
      );
    let best = 1e18;
    const cur: number[] = [],
      out: number[] = [];
    const rec = (k: number, acc: number) => {
      if (acc >= best) return;
      if (k === n) {
        best = acc;
        for (let j = 0; j < n; j++) out[j] = cur[j];
        return;
      }
      for (let j = 0; j < spots.length; j++)
        if (!used.has(j)) {
          used.add(j);
          cur[k] = j;
          rec(k + 1, acc + cost[k][j]);
          used.delete(j);
        }
    };
    rec(0, 0);
    for (let k = 0; k < n; k++) SPA.m.set(ms[k], out[k]), (ms[k].ai.spj = out[k]);
  }
  const spot = spots[SPA.m.get(p) ?? 0];
  const md = manOf(p),
    deny = Math.hypot(md.x - p.x, md.y - p.y) < 20 && Math.hypot(md.x - hx, md.y - HY) > Math.hypot(p.x - hx, p.y - HY) - 5;
  if (deny && !iso && Math.random() < 0.02) p.ai.cutT = T;
  p.br = p.ai.cutT && T - p.ai.cutT < 1.1 ? "cut" : "spot";
  if (p.ai.cutT && T - p.ai.cutT < 1.1) {
    mv(p, hx + dir * 25, HY + (p.y < HY ? -18 : 18), 1.25); // backdoor
    if (Math.hypot(md.x - p.x, md.y - p.y) > 26) OFFS[t] = p;
  } else if (cfg.PP && upVcut(p, spot[0], spot[1], hx, md)) {
  } else mv(p, spot[0] + Math.sin(T * 0.8 + p.k) * 10, spot[1], 0.95);
  return true;
}
const SPA = { t: -1, at: -1, m: new Map<Player, number>() };
function loose(p: Player, t: number) {
  const NP = cfg.NP,
    i = p.in,
    hx = B.last ? hoop(B.last.tm) : hoop(t),
    dir = hx > 470 ? -1 : 1,
    own: number[][] = [];
  for (let k = 0; k < NP; k++) {
    const q = P[p.tm * NP + k];
    own.push([Math.hypot(q.x - hx, q.y - HY), k]);
  }
  own.sort((a, b) => a[0] - b[0]);
  const rk = own.findIndex((v) => v[1] === p.k),
    K2 = NP > 2 ? 2 : 1,
    d = Math.hypot(B.x - p.x, B.y - p.y),
    sh = B.last && B.last.tm === p.tm,
    fly = B.sh && B.last && B.z > 45 && B.age < 1.3 && B.vz > -120 && Math.hypot(B.x - hx, B.y - HY) > 40;
  if (fly && !sh && NP > 1 && rk < 3) {
    // box out: get between your man and the rim, then hold him there
    const man = guardOf(p),
      md = Math.hypot(man.x - hx, man.y - HY);
    if (md < 160) {
      mv(p, man.x + (hx - man.x) * (12 / (md || 1)), man.y + (HY - man.y) * (12 / (md || 1)), 1.15);
      if (Math.hypot(man.x - p.x, man.y - p.y) < 18) p.boxT = 0.3;
      return;
    }
  }
  if (fly) {
    // (modern spacing: the shooting side sends its closest man and a big; the rest get back)
    if (rk < K2 && !(sh && rk > 0 && p.ht < 6.75 && NP > 2)) mv(p, hx + dir * (26 + rk * 22), HY + (rk ? 36 : -8) * (p.k % 2 ? 1 : -1), 1.1);
    else if (sh) mv(p, hx + dir * 190, HY + (p.k - 2) * 45, 0.7);
    else mv(p, hx + dir * 70, HY + (p.k - 2) * 50, 0.8);
  } else {
    const nr = [...Array(NP).keys()]
      .map((k) => [Math.hypot(P[p.tm * NP + k].x - B.x, P[p.tm * NP + k].y - B.y), k])
      .sort((a, b) => a[0] - b[0])
      .slice(0, K2)
      .some((v) => v[1] === p.k);
    if (nr || d < 90) {
      mv(p, B.x + B.vx * 0.25, B.y + B.vy * 0.25, 1.15);
      // dive on the floor for a loose ball when the other team is closing in on it
      if (!PREDICT && !B.sh && B.z < 14 && d > 12 && d < 36 && p.z <= 0 && !(p.actT > 0) && Math.random() < 0.12) {
        let rival = 1e9;
        for (const q of P) if (q.tm !== p.tm) rival = Math.min(rival, Math.hypot(q.x - B.x, q.y - B.y));
        if (rival < 45) {
          p.act = 4;
          p.actT = 0.75;
          p.stt.dv++;
          p.vx = ((B.x - p.x) / d) * 300;
          p.vy = ((B.y - p.y) / d) * 300;
          if (isH(p) || isH(B.last)) txtW("DIVE!", p.x, p.y, 70, "#ffd23f");
        }
      }
      if (B.z > 50 && d < 28 && p.z <= 0) i.sd = 1;
    } else if (sh) mv(p, hx + dir * 190, HY + (p.k - 2) * 45, 0.7);
    else mv(p, hx + dir * 80, HY + (p.k - 2) * 50, 0.8);
  }
}
function cut(p: Player, t: number) {
  const hx = hoop(t),
    dir = hx > 470 ? -1 : 1,
    ph = (T * 0.7 + p.k * 1.3) % 4;
  if (ph < 0.8) {
    mv(p, hx + dir * 40, HY + (p.k % 2 ? 30 : -30), 1.1);
    return true;
  }
  if (ph < 1.8) {
    mv(p, hx + dir * 215, HY + (p.k % 2 ? 1 : -1) * (80 + p.k * 20), 1);
    return true;
  }
  return false;
}
// ================= Team play pack (v5.4): named sets, ATO / end-of-quarter calls, ICE / blitz, box-and-one, coach IQ =================
// (C# twin: Core/Sim.TP.cs - same names, same order of random draws)
/** CPU basketball IQ 0..3 (Rookie .. Hall of Fame = cfg.DIFF) for a team with no human on it; a human's AI teammates
 *  play at All-Star level (2). It decides which sets and coverages a coach knows, how fast he adjusts, whether he
 *  draws up after-timeout plays, doubles the hot hand and rotates behind the help. */
export const cpuIQ = (t: number) => (CT.some((c) => c.tm === t) ? 2 : clamp(cfg.DIFF, 0, 3));
/** Box-and-one target for team t's defense: the one opponent on fire from outside (heat 3+, a shooter) who carries
 *  their offense (35%+ of their points, 12+ scored) while nobody else is hot; -1 = none. */
function boxTarget(t: number) {
  if (cfg.NP !== 5 || cfg.ASTAR || cfg.HALF || !cfg.TP) return -1;
  let bi = -1,
    n = 0;
  for (let j = 0; j < 5; j++) {
    const q = P[(1 - t) * 5 + j];
    if ((q.heat || 0) >= 3) {
      n++;
      if (q.c >= 78 && sc[1 - t] >= 12 && q.stt.pts >= 0.35 * sc[1 - t]) bi = (1 - t) * 5 + j;
    }
  }
  return n === 1 ? bi : -1;
}
/** The box-and-one chaser of team t: whoever guards the target (TS.box; their top scorer when a human called it). */
export function boxCh(t: number): Player | null {
  let s: Player | null = TS.box[t] >= 0 ? P[TS.box[t]] : null;
  if (!s || s.tm === t) {
    s = null;
    for (const q of P) if (q.tm !== t && !q.off && (!s || q.stt.pts > s.stt.pts)) s = q;
  }
  return s ? manOf(s) : null;
}
/** Named sets (3+ a side) on top of the three base actions, picked from personnel and the coach's IQ: Pro adds horns
 *  (two bigs at the elbows), the post entry (cross screen, seal, feed the block) and the zipper (a guard comes off a down
 *  screen to the top); All-Star+ the Spain pick-and-roll (a shooter back-screens the roller's man, then pops) and
 *  stagger screens (floppy) for a shooter, and end-of-quarter sets for the star. After a timeout a CPU coach (Pro+)
 *  draws up his best action for his star (ATO). Human play calls 5-7 run horns / Spain / post-up. Returns null = the
 *  base play (pnr / pindown / flare). */
function tpSet(t: number, h: Player, ms: Player[], big: Player, sh: Player, pc: number): Play | null {
  if (cfg.NP < 3 || pc === 4 || !cfg.TP) return null;
  const cpu = !CT.some((c) => c.tm === t),
    lv = cpuIQ(t);
  // personnel: a second big, a shooter to back-screen, a post scorer, the cross-screener (smallest), the star
  let b2: Player | null = null,
    s2: Player | null = null,
    pm: Player | null = null;
  for (const q of ms) {
    if (q !== big && q.ht >= 6.75 && (!b2 || q.ht * q.bk > b2.ht * b2.bk)) b2 = q;
    if (q !== big && q.c >= 76 && (!s2 || q.c > s2.c)) s2 = q;
    if (q.i >= 80 && q.ht >= 6.7 && (!pm || q.i > pm.i)) pm = q;
  }
  let cs: Player | null = null;
  for (const q of ms) if (q !== pm && (!cs || q.ht < cs.ht)) cs = q;
  const star = starOf(t),
    N = (q: Player) => q.n.toUpperCase();
  const mk = (kind: Play["kind"], v: string, scr: Player, use: Player, x2: Player | null, nm: string, ato = 0): Play => {
    STAT["set_" + v] = (STAT["set_" + v] || 0) + 1;
    if (ato === 1 || TS.setN[t]++ % 3 === 0) cm(ato === 1 ? "ato" : "set", cl[t], nm.toLowerCase());
    if (ato === 1) txtW(nm, use.x, use.y, 110, "#9fe7ff");
    // a CPU handler runs the play: a beat more patience before he looks for his own shot (Spain needs the longest)
    if (cpu && h.ai.r) (h.ai.w = Math.min(h.ai.w, v === "spain" ? -0.8 : -0.5)), (h.ai.pt = Math.max(h.ai.pt, v === "stagger" ? 1.2 : 0.7)); // (tpCall cuts the pass timer when the man comes open)
    return { kind, v, t0: T, scr, use, def: manOf(use), ph: "go", sx: 0, sy: 0, setAt: 0, s2: x2, sd: (v === "post" ? h.y : use.y) < HY ? -1 : 1, st: 0, stT: T, nm, ato };
  };
  // the human's play calls
  if (pc === 5) return b2 ? mk("pnr", "horns", big, h, b2, "HORNS") : null;
  if (pc === 6) return s2 ? mk("pnr", "spain", big, h, s2, "SPAIN PICK & ROLL") : null;
  if (pc === 7) return pm && cs ? mk("pin", "post", cs, pm, null, "POST UP " + N(pm)) : null;
  if ((!cpu && pc) || lv < 1 || Math.hypot(hoop(t) - h.x, HY - h.y) > 330) return null; // (sets start in the half court)
  // after a timeout: the coach's best action for his star
  if (cpu && TS.ato[t]) {
    TS.ato[t] = 0;
    STAT.ato = (STAT.ato || 0) + 1;
    if (star === h) {
      if (lv >= 2 && s2) return mk("pnr", "spain", big, h, s2, "ATO: SPAIN FOR " + N(star), 1);
      if (b2) return mk("pnr", "horns", big, h, b2, "ATO: HORNS FOR " + N(star), 1);
    } else if (star === pm && cs) return mk("pin", "post", cs, star, null, "ATO: POST UP " + N(star), 1);
    else if (star !== big && star.c >= 82 && b2 && star !== b2) return mk("pin", "stagger", big, star, b2, "ATO: FLOPPY FOR " + N(star), 1);
    else if (star !== big) return mk("pin", "zip", big, star, null, "ATO: ZIPPER FOR " + N(star), 1);
  }
  // end of the quarter (the game clock is under the shot clock): get the star the last look
  if (cpu && lv >= 2 && clock < shot && clock < 12 && clock > 3) {
    if (star === h && b2) return mk("pnr", "horns", big, h, b2, "LAST SHOT: HORNS FOR " + N(star), 2);
    if (star !== h && star !== big && star !== pm) return mk("pin", "zip", big, star, null, "LAST SHOT: ZIPPER FOR " + N(star), 2);
  }
  const r = Math.random(),
    stg = lv >= 2 && !!b2 && sh.c >= 80 && sh !== big && sh !== b2;
  // the coach's play family (gamePlan) -> one of its variants
  if (pc === 1) return r < 0.3 && b2 ? mk("pnr", "horns", big, h, b2, "HORNS") : r < 0.5 && lv >= 2 && s2 ? mk("pnr", "spain", big, h, s2, "SPAIN PICK & ROLL") : null;
  if (pc === 2) return r < 0.3 && pm && cs ? mk("pin", "post", cs, pm, null, "POST UP " + N(pm)) : r < 0.5 && stg ? mk("pin", "stagger", big, sh, b2, "STAGGER FOR " + N(sh)) : r < 0.65 && sh !== big ? mk("pin", "zip", big, sh, null, "ZIPPER FOR " + N(sh)) : null;
  if (pc === 3) return r < 0.35 && stg ? mk("pin", "stagger", big, sh, b2, "STAGGER FOR " + N(sh)) : null;
  // auto: personnel decides
  let w = 0;
  if (pm && cs && (w += 0.16) > r) return mk("pin", "post", cs, pm, null, "POST UP " + N(pm));
  if (b2 && (w += 0.14) > r) return mk("pnr", "horns", big, h, b2, "HORNS");
  if (lv >= 2 && s2 && (w += 0.1) > r) return mk("pnr", "spain", big, h, s2, "SPAIN PICK & ROLL");
  if (stg && sh.c >= 82 && (w += 0.08) > r) return mk("pin", "stagger", big, sh, b2, "STAGGER FOR " + N(sh));
  if (star !== h && star !== big && star.ht < 6.7 && (w += 0.08) > r) return mk("pin", "zip", big, star, null, "ZIPPER FOR " + N(star));
  return null;
}
/** How long the screener of a named set stays planted (the stagger holds its first screen while the shooter runs the
 *  second one). */
const tpSetLen = (pl: Play) => (pl.v === "stagger" ? 1.4 : pl.kind === "pnr" ? 0.9 : 1.0);
/** Screen spots of the pindown-family sets (stagger: the lower screen; zipper: a down screen at the elbow; post: a
 *  cross screen in the lane on the post man's defender). */
function tpSpot(pl: Play, hx: number, dir: number) {
  const sd = pl.sd || 1;
  if (pl.v === "stagger") (pl.sx = hx + dir * 85), (pl.sy = HY + sd * 105);
  else if (pl.v === "zip") (pl.sx = hx + dir * 150), (pl.sy = HY + sd * 45);
  else (pl.sx = hx + dir * 50), (pl.sy = HY - sd * 25);
}
/** The man the set is run for (pindown family). */
function tpUse(p: Player, pl: Play, t: number, hx: number, dir: number) {
  const sd = pl.sd || 1,
    scr = pl.scr,
    def = pl.def;
  if (pl.v === "post") {
    // from the weak side, across the lane off the cross screen to the ball-side block; seal and call for it
    if (pl.ph === "go") mv(p, hx + dir * 40, HY - sd * 85, 1);
    else {
      const bx = hx + dir * 42,
        by = HY + sd * 55,
        d = Math.hypot(p.x - bx, p.y - by);
      mv(p, bx, by, 1.2);
      if (d < 22) {
        p.callT = Math.max(p.callT || 0, 0.3);
        const m = manOf(p);
        // (open for the entry unless his man is fronting him: between him and the ball)
        if (m && Math.hypot(m.x - B.x, m.y - B.y) > Math.hypot(p.x - B.x, p.y - B.y) - 4) (OFFS[t] = p), tpCall(pl, t);
      }
    }
    return true;
  }
  if (pl.v === "zip") {
    // zipper: up from the block off the down screen to the top of the key, where the ball finds him
    if (pl.ph === "go") mv(p, hx + dir * 35, HY + sd * 85, 1);
    else {
      const nearS = Math.hypot(p.x - scr.x, p.y - scr.y) > 22 && pl.ph === "set";
      mv(p, nearS ? scr.x + dir * 4 : hx + dir * 255, nearS ? scr.y - sd * 9 : HY + sd * 20, 1.3);
      if (Math.hypot(def.x - p.x, def.y - p.y) > 30 && Math.hypot(p.x - hx, p.y - HY) > 200) (OFFS[t] = p), tpCall(pl, t);
    }
    return true;
  }
  // stagger (floppy): up from the baseline off the first screen, then the second, out to the wing (he starts as soon as
  // the first screener is nearly there)
  if (pl.ph === "go" && Math.hypot(scr.x - pl.sx, scr.y - pl.sy) > 30) {
    mv(p, hx + dir * 20, HY + sd * 85, 1);
    return true;
  }
  const s2 = pl.s2 as Player;
  if (pl.st === 0) {
    mv(p, scr.x + dir * 6, scr.y + sd * 10, 1.3);
    if (Math.hypot(p.x - scr.x - dir * 6, p.y - scr.y - sd * 10) < 22) (pl.st = 1), (pl.stT = T);
  } else if (pl.st === 1) {
    mv(p, s2.x + dir * 6, s2.y + sd * 10, 1.3);
    if (Math.hypot(p.x - s2.x - dir * 6, p.y - s2.y - sd * 10) < 22 || T - (pl.stT || 0) > 1.3) (pl.st = 2), (pl.stT = T), (STAT.stagger = (STAT.stagger || 0) + 1);
  } else {
    mv(p, hx + dir * 215, HY + sd * 185, 1.25);
    if (Math.hypot(def.x - p.x, def.y - p.y) > 34 && Math.hypot(p.x - hx, p.y - HY) > 180) (OFFS[t] = p), tpCall(pl, t);
  }
  return true;
}
/** The man the set was run for just came open: the CPU handler looks his way now, not on his next half-second read. */
function tpCall(pl: Play, t: number) {
  const h = B.owner;
  if (pl.cal || !h || h.tm !== t || isH(h)) return;
  pl.cal = 1;
  if ((h.ai.pt || 0) > 0.12) h.ai.pt = 0.12;
}
const plant = (p: Player) => {
  p.in.dx = p.in.dy = 0;
  p.vx *= 0.5;
  p.vy *= 0.5;
  p.setT = 0.25;
};
/** The set's second man: horns' other big, Spain's back-screener, the stagger's second (higher) screener. */
function tpS2(p: Player, pl: Play, t: number, hx: number, dir: number) {
  p.br = "s2";
  const sd = pl.sd || 1,
    scr = pl.scr;
  if (pl.v === "horns") {
    // at the other elbow; then high-low: the screener popped -> dive, he rolled -> lift to the top
    const m = manOf(p),
      md = m ? Math.hypot(m.x - p.x, m.y - p.y) : 99;
    if (pl.ph !== "out") mv(p, hx + dir * 175, HY - sd * 60, 1);
    else if (pl.pop) {
      mv(p, hx + dir * 35, HY - sd * 25, 1.2);
      if (Math.hypot(p.x - hx, p.y - HY) < 80 && md > 30) OFFS[t] = p;
    } else {
      mv(p, hx + dir * 245, HY - sd * 45, 1.05);
      if (md > 40) OFFS[t] = p;
    }
    return true;
  }
  if (pl.v === "spain") {
    if (pl.ph === "go") {
      mv(p, hx + dir * 235, HY + sd * 40, 1); // up top, behind the screen
      return true;
    }
    const r = manOf(scr);
    if (!pl.st && T - pl.setAt < 2.6 && r) {
      // back screen on the roller's man as the screen is set and he steps up to meet the roll
      const l = Math.hypot(hx - r.x, HY - r.y) || 1,
        bx = r.x + ((hx - r.x) / l) * 12,
        by = r.y + ((HY - r.y) / l) * 12;
      mv(p, bx, by, 1.25);
      p.in.sp = 1;
      if (Math.hypot(p.x - bx, p.y - by) < 18) (pl.st = 1), (pl.stT = T), (STAT.spain = (STAT.spain || 0) + 1);
      return true;
    }
    if (pl.st === 1 && T - (pl.stT || 0) < 0.5) {
      plant(p);
      return true;
    }
    // then pop to the top of the arc for the three
    const m = manOf(p);
    mv(p, hx + dir * 245, HY + sd * 20, 1.15);
    if (m && Math.hypot(m.x - p.x, m.y - p.y) > 40) OFFS[t] = p;
    return true;
  }
  // stagger: the second screen, held until the shooter is through it
  const sx = hx + dir * 150,
    sy = HY + sd * 150;
  if (pl.st !== 2 && T - pl.t0 < 4.5) {
    if (pl.ph === "go" || Math.hypot(p.x - sx, p.y - sy) > 8) mv(p, sx, sy, 1.1);
    else plant(p);
  } else mv(p, hx + dir * 250, HY - sd * 30, 0.95);
  return true;
}
/** Pick-and-roll coverage beyond drop / hedge, for the screener's man: ICE (sit low on the baseline side - the
 *  handler was sent away from the screen) and blitz (trap the handler with his man, then recover). */
function tpBig(p: Player, t: number, o: Player, hb: Player, opl: Play, dh: number) {
  const dir = dh > 470 ? -1 : 1;
  if (TS.cov[t] === 2) {
    mv(p, dh + dir * 50, HY + (hb.y < HY ? -62 : 62), 1.05);
    return;
  }
  if (opl.ph === "set" || T - opl.setAt < 1.1) {
    const sx = o.x - hb.x,
      sy = o.y - hb.y,
      l = Math.hypot(sx, sy) || 1;
    mv(p, hb.x + (sx / l) * 14 + (dh - hb.x) * 0.05, hb.y + (sy / l) * 14 + (HY - hb.y) * 0.05, 1.25);
    p.in.sp = 1;
    p.hdgT = 0.25; // (arms wide: the trap)
    if (!opl.bl) (opl.bl = 1), (STAT.blitz = (STAT.blitz || 0) + 1);
  } else mv(p, o.x + (dh - o.x) * 0.35, o.y + (HY - o.y) * 0.35, 1.15); // recover to the roller
}
/** Blitz rotation (once per tick per defending team): while two are on the ball, the defender nearest the rolling
 *  screener (not one of the trappers) tags him goal-side. */
const TPD = { t: -1, at: -1, tag: null as Player | null };
function tpTag(p: Player, t: number, opl: Play | null, dh: number) {
  if (TPD.t !== t || TPD.at !== T) {
    TPD.t = t;
    TPD.at = T;
    TPD.tag = null;
    if (TS.cov[t] === 3 && opl && opl.kind === "pnr" && opl.bl && opl.ph === "out" && T - opl.setAt < 1.3 && opl.use === B.owner && Math.hypot(dh - opl.scr.x, HY - opl.scr.y) < 200) {
      const rm = manOf(opl.scr),
        hm = manOf(opl.use);
      let bd = 1e9;
      for (const q of P)
        if (q.tm === t && !q.off && q !== rm && q !== hm && !isH(q)) {
          const d = Math.hypot(q.x - opl.scr.x, q.y - opl.scr.y);
          if (d < bd) (bd = d), (TPD.tag = q);
        }
      if (TPD.tag && opl.bl === 1) (opl.bl = 2), (STAT.tag = (STAT.tag || 0) + 1);
    }
  }
  if (TPD.tag !== p || !opl) return false;
  const r = opl.scr,
    l = Math.hypot(dh - r.x, HY - r.y) || 1;
  mv(p, r.x + ((dh - r.x) / l) * 16, r.y + ((HY - r.y) / l) * 16, 1.2);
  p.in.sp = 1;
  return true;
}
export function pickClip(p: Player, D: number, lay: boolean) {
  if (p.fsv != null) {
    const v = p.fsv;
    p.fsv = null;
    return v;
  }
  const c = contestOf(p)[0],
    dir = hoop(p.tm) > 470 ? 1 : -1,
    fw = p.vx * dir,
    sp = Math.hypot(p.vx, p.vy);
  if (lay) {
    // finish package: picked by leaping ability, speed, approach angle and traffic
    const hx = hoop(p.tm),
      base = Math.abs(p.y - HY) > 40 && Math.abs(p.x - hx) < 45, // driving along the baseline
      r = Math.random();
    if (D < 50 && p.j >= 55) {
      if (c > 0.4) return 11; // two-hand power through traffic
      if (base && r < 0.5) return 14; // reverse slam along the baseline
      if (sp > 190 && p.j >= 75) return r < 0.3 ? 15 : r < 0.65 ? 13 : 12; // 360 / windmill / tomahawk
      if (p.j >= 70 && r < 0.45) return 12;
      return r < 0.55 ? 6 : 11;
    }
    if (c > 0.35 && sp > 60) return 7; // euro step around the help
    if (base && r < 0.6) return 17; // reverse layup under the rim
    if (c < 0.2 && sp > 140) return 16; // finger roll in space
    return 5;
  }
  if (p.sg && p.sg.cl) return 9;
  if (p.sbw > 0) return 3;
  {
    // runners and leaners: shaped by how the shooter is moving
    const lat = Math.abs(-p.vx * Math.sin(p.f) + p.vy * Math.cos(p.f));
    if (fw > 150 && D > 90 && D < 230) return 21;
    if (lat > 130 && D > 150) return 20;
  }
  if (fw > 110 && D > 110) return 8;
  if (p.st === 4) return 4;
  if (p.st === 2 || (c > 0.5 && p.st !== 1)) return 2;
  if (p.st === 3) return 3;
  // standard jumpers use the motion-captured shot (players with a hand-tuned SIG form keep their classic clip)
  return p.st === 1 ? 1 : SIGK(p) ? 0 : 22;
}
/**
 * Shooting-foul contact model. A foul needs real contact: a hard closeout into the shooter's space, a defender flying
 * sideways through him (jumping straight up = verticality, rarely a foul), or bodies already touching. Good defenders
 * foul less; drives to the rim and strong finishers draw more. Returns the fouling defender or null.
 */
let FLAG = 0,
  LASTP_FOUL = 0.8; // how clear the last shooting foul was (challenge odds)
function shootingFoul(p: Player, lay: boolean): Player | null {
  FLAG = 0;
  if (!cfg.FOULS) return null;
  let best = null,
    bp = 0,
    fl = 0;
  for (const o of P) {
    if (o.tm === p.tm) continue;
    const dx = p.x - o.x,
      dy = p.y - o.y,
      d = Math.hypot(dx, dy) || 1;
    if (d > 28) continue;
    const close = (o.vx * dx + o.vy * dy) / d, // speed toward the shooter
      hs = Math.hypot(o.vx, o.vy);
    let c = 0;
    c += clamp((close - 50) / 220, 0, 1) * 0.32; // late, hard closeout
    if (o.z > 4) c += hs > 50 ? 0.3 : 0.03; // flying in vs. straight up
    if (d < 15) c += 0.14; // already chest to chest
    if (lay && d < 22) c += 0.1 + (p.i - 60) / 400 + (p.bk - 1) * 0.2 + (hasB(p, "PZ") ? 0.08 : 0);
    c *= (1.2 - o.d / 220) * (cfg.PP >= 2 ? 0.52 : 0.42); // (x.42: calibrated to NBA free-throw rate, ~0.22 FTA per possession; Pro Play v2: x.52 with fewer and-ones)
    if (c > bp) (bp = c), (best = o), (fl = lay && o.z > 4 && hs > 170 && close > 140 ? 1 : 0);
  }
  if (!best || Math.random() >= clamp(bp, 0, 0.6)) return null;
  STAT.shootFouls++;
  FLAG = fl && Math.random() < 0.08 ? 1 : 0;
  LASTP_FOUL = clamp(bp * 1.6, 0.35, 0.95);
  return best;
}
/** Raw contest (0..1.5) from the closest defender within 6 ft; airborne defenders count 1.5x. */
function contestRaw(p: Player): [number, Player | null] {
  const fr = lagFrame(p);
  let ct = 0,
    o2 = null;
  for (let k = 0; k < P.length; k++) {
    const o = P[k];
    if (o.tm === p.tm) continue;
    const ox = fr ? fr[k * 3] : o.x,
      oy = fr ? fr[k * 3 + 1] : o.y,
      oz = fr ? fr[k * 3 + 2] : o.z,
      d = Math.hypot(ox - p.x, oy - p.y);
    if (d < 60) {
      const c2 = (1 - d / 60) * (oz > 8 ? (cfg.PP && o.vz < -90 ? 1.15 : 1.5) : o.hupT > 0 ? 1.2 : 1) * (hasB(o, "LD") ? 1.15 : 1); // (Pro Play: coming down already = a weaker contest)
      if (c2 > ct) {
        ct = c2;
        o2 = o;
      }
    }
    if (d < 95 && d > 1) {
      // a hard closeout bothers the shot before he gets there (the shooter sees him coming, hurries it)
      const ap = (o.vx * (p.x - ox) + o.vy * (p.y - oy)) / d,
        c3 = clamp((ap - 90) / 160, 0, 1) * (1 - d / 95) * 0.8;
      if (c3 > ct) (ct = c3), (o2 = o);
    }
  }
  return [ct, o2];
}
export function contestOf(p: Player): [number, Player | null] {
  const [ct, o2] = contestRaw(p);
  // (Pro Play v2: a stick-picked fadeaway / leaner creates separation - here, so the meter shows it while charging)
  return [Math.min(1, ct * (p.sbw > 0 ? 0.25 : 1) * (cfg.PP >= 2 && p.fade && (p.mode === "c" || p.mode === "s") ? (p.fade === 1 ? 0.82 : 0.9) : 1)), o2];
}
function collide() {
  if (cfg.PH3 && !PREDICT) ph3Sweat(1 / 60); // (Physics v3: sweat spots)
  for (let a = 0; a < P.length; a++)
    for (let b = a + 1; b < P.length; b++) {
      const A = P[a],
        C = P[b];
      if (A.off || C.off) continue;
      const dx = A.x - C.x,
        dy = A.y - C.y,
        d = Math.hypot(dx, dy);
      // bodies are wider than deep: face to face they stop at 16 px (as always), shoulder to shoulder at up to ~28 (the rig's real shoulder width)
      // (so broad shoulders don't sink into each other) - how sideways each one stands to the other
      let dm = 16;
      if (cfg.PRO && d < 29 && d > 0) {
        const sA = Math.abs(Math.sin(Math.atan2(-dy, -dx) - A.f)),
          sC = Math.abs(Math.sin(Math.atan2(dy, dx) - C.f));
        dm = 16 + 5 * (sA * Math.min(1.2, A.bk) + sC * Math.min(1.2, C.bk));
      }
      if (d < dm && d > 0 && A.z < 8 && C.z < 8) {
        if (!cfg.PRO) {
          const s = (16 - d) / 2 / d;
          A.x += dx * s;
          A.y += dy * s;
          C.x -= dx * s;
          C.y -= dy * s;
          continue;
        }
        let nx = dx / d, // (let: Physics v3 box-outs make the boxer heavier)
          ny = dy / d,
          mA = A.bk * A.ht * (A.setT > 0 ? 3 : A.postA ? 1.7 : 1),
          mC = C.bk * C.ht * (C.setT > 0 ? 3 : C.postA ? 1.7 : 1),
          rv = (A.vx - C.vx) * nx + (A.vy - C.vy) * ny,
          ov = dm - d;
        // (Physics v3: the defender sealing his man on a shot / rebound plays heavy and moves him off the rim)
        const bxo = cfg.PH3 ? phBox(A, C) : 0;
        if (bxo === 1) mA *= PH_BOXM;
        else if (bxo === 2) mC *= PH_BOXM;
        for (const [sc0, df] of [
          [A, C],
          [C, A],
        ])
          if (sc0.setT > 0 && df.tm !== sc0.tm && df !== B.owner) {
            if (!(df.scr > 0)) {
              STAT.screens++;
              sc0.stt.sa++;
              df.scr = 0.55; // hits the screen: stopped dead for half a second
              df.hitT = 0.35;
              df.hitX = -nx * (df === A ? -1 : 1);
              df.hitY = -ny * (df === A ? -1 : 1);
              if (cfg.PH3) ph3Screen(sc0, df); // (Physics v3: the screen eats his run - or a big man runs through it)
              if (isH(B.owner) || isH(df)) txtW("SCREEN", sc0.x, sc0.y, 88, "#9ad");
              const pl = PLAY[sc0.tm];
              // the screener's defender switches onto the ball handler some of the time
              if (pl && pl.kind === "pnr" && Math.random() < (TS.ds[df.tm] === 3 ? 1 : 0.35)) {
                const sd = manOf(sc0),
                  NP = cfg.NP;
                sd.man = sc0.tm * NP + pl.use.k;
                sd.manT = 3;
                df.man = sc0.tm * NP + sc0.k;
                df.manT = 3;
                // "Switch!": both point at their new man and call it out
                if (!PREDICT) (sd.swT = 0.7), (df.swT = 0.7), (sd.callT = 0.5), (df.callT = 0.5);
                if (isH(B.owner) || isH(df) || isH(sd)) txtW("SWITCH!", sd.x, sd.y, 92, "#9fe7ff");
              }
            }
          }
        A.x += (nx * ov * mC) / (mA + mC);
        A.y += (ny * ov * mC) / (mA + mC);
        C.x -= (nx * ov * mA) / (mA + mC);
        C.y -= (ny * ov * mA) / (mA + mC);
        if (bxo === 1) phShove(A, C, -nx, -ny, mA, mC);
        else if (bxo === 2) phShove(C, A, nx, ny, mC, mA);
        if (rv < 0) {
          const j = (-1.05 * rv) / (1 / mA + 1 / mC),
            hit = -rv;
          A.vx += (j * nx) / mA;
          A.vy += (j * ny) / mA;
          C.vx -= (j * nx) / mC;
          C.vy -= (j * ny) / mC;
          if (hit > 150 && fc <= 0 && rs <= 0 && !ftq && inb <= 0 && cfg.FOULS) {
            const sx = A.setT > 0 ? A : C.setT > 0 ? C : null;
            if (sx) {
              const o = sx === A ? C : A;
              if (o.tm !== sx.tm && Math.hypot(sx.vx, sx.vy) > 110 && Math.random() < 0.35) {
                fc = 2;
                txtW("ILLEGAL SCREEN", sx.x, sx.y, 95, "#ff6b4a");
                tf[sx.tm]++;
                sx.pf++;
                whistle(sx, o, 0.6);
                setup(o.tm);
              }
            }
          }
          if (hit > 60) {
            // both bodies react to the bump, away from each other
            A.hitT = C.hitT = Math.min(0.35, hit / 500);
            A.hitX = nx;
            A.hitY = ny;
            C.hitX = -nx;
            C.hitY = -ny;
            for (const q of [A, C]) {
              if (hit > 120) q.slow = Math.max(q.slow, 0.12);
              if (q.mode === "c" || q.mode === "s") q.bmp = Math.min(1, (q.bmp || 0) + hit / 260);
            }
            if (cfg.PH3 && hit > 150) ph3Hit(A, C, j, mA, mC); // (Physics v3: stumbles, knockdowns by the jolt each one takes)
            const h = B.owner;
            if (hit > 170 && fc <= 0 && rs <= 0 && !ftq && inb <= 0 && h && (A === h || C === h) && cfg.FOULS) {
              const o = A === h ? C : A;
              fc = 2;
              if (o.tm !== h.tm) {
                const sh = h.mode === "c" || h.mode === "s";
                // (no charge in the restricted area under the rim; a help defender who got there and set his feet
                // draws it more often)
                const ra = Math.hypot(o.x - hoop(h.tm), o.y - HY) < 40;
                if (cfg.PP >= 2 ? pp2Charge(o, h, ra) : !ra && Math.hypot(o.vx, o.vy) < 70 && Math.hypot(h.vx, h.vy) > 170 && Math.random() < (o.helpT > 0 ? 0.62 : 0.5)) {
                  // (Pro Play v2: read from position - set feet, square in the chest)
                  txtW("CHARGE!", h.x, h.y, 95, "#ff6b4a");
                  o.act = 3; // took the charge: on the floor
                  o.actT = 1.2;
                  h.cel = 12; // arguing the call
                  h.celT = CEL_T;
                  tf[h.tm]++;
                  h.pf++;
                  o.stt.chg++;
                  fx({ k: "whistle", tm: h.tm });
                  cm("charge", o.n, h.n);
                  whistle(h, o, 0.55);
                  setup(o.tm);
                } else if (Math.random() < (sh ? 0.2 : 0.05) * (hit > 240 ? 1.6 : 1) * (cfg.PP >= 2 ? pp2BlkK(o) : 1)) foul(o, h, sh ? "SHOOTING" : "BLOCKING", sh ? 1 : 0, 0); // (blocking: calibrated to NBA personal-foul rates)
              }
            }
          }
        }
      }
    }
}
// ---- physics net: 16-strand diamond weave, 6 rings, verlet; the ball collides with strands, not just knots ----
const NS = 16,
  NR = [
    [7.5, 100],
    [6.9, 96.4],
    [6.25, 92.8],
    [5.6, 89.4],
    [5.05, 86.2],
    [4.65, 83.2], // (a little wider than the ball at the hem: it hugs a swish, never holds a ball)
  ];
const NET_DAMP = 0.984, // velocity kept per 1/60 s tick (nylon + air): a whipped net swings ~2 s before it hangs still
  NET_STR = 0.4, // strand stretch correction per solver pass: elastic nylon - a swish stretches the mesh, it recoils
  // (the same stiffness over the 3 passes of a quiet net: 1 - (1 - k)^(7/3), so it hangs exactly as low)
  NET_STR3 = 0.6963642404913704,
  NET_HEM3 = 0.8821109920435076,
  NET_TIE3 = 0.37064021485998855,
  NET_MAXS = 1.15, // stretch limit: past 15% the nylon is a rope again (fully stiff)
  NET_MU = 0.45, // ball-strand friction: the share of the ball's slide the touched knots follow (drags the mesh along)
  NET_RK = 1, // reaction on the ball per px the mesh still pushes back per tick
  NET_RUP = 0.25, // ... of which its vertical part counts this much
  NET_RF = 0.35, // ... and per px of mesh it drags along (the momentum it hands the nylon)
  NET_VCAP = 14, // most the nylon takes off the ball's drop per tick (px/s): a swish keeps ~70% of its speed
  NET_CK = 900, // centering spring (1/s^2) + damping (1/s) on a ball pressing into the side of the mesh
  NET_CC = 30,
  NET_BRZ = 18, // idle sway: arena air on the mesh (px/s^2 at the hem)
  RIM_W = 24, // rim flex spring (rad/s) + damping ratio: a dunk or a hard hit rings the iron and the net rides it
  RIM_Z = 0.19,
  // idle-sway oscillators: (cos, sin) rotated by 0.011 and 0.00625 rad per tick (plain arithmetic: TS == C#)
  BRC = 0.9999395006100392,
  BRS = 0.010999778168008754,
  BRC2 = 0.9999804688135782,
  BRS2 = 0.006249959309975306;
// net materials (Physics v3: street games hang chain nets): [damp per tick, strand stretch, its 3-pass twin, stretch
// limit, ball friction, reaction, drop cap, sway]
const NETMAT = [
  [NET_DAMP, NET_STR, NET_STR3, NET_MAXS, NET_MU, NET_RK, NET_VCAP, NET_BRZ], // nylon
  [0.993, 0.85, 0.9880450910966956, 1.02, 0.25, 1.4, 22, 3], // chain: heavy, no stretch, swings long, barely sways, clanks
];
let NM = NETMAT[0];
export const chainNet = () => !!cfg.PH3 && !!cfg.HALF;
const SEGR = BR + 0.45,
  NRX = [0, 0, 0];
export const NETS = HXs.map((hx) => {
  const p: any[] = [],
    c: any[] = [],
    gr: any[][] = [];
  for (let r = 0; r < NR.length; r++) {
    gr.push([]);
    for (let k = 0; k < NS; k++) {
      const a = (k / NS) * 6.283 + (r % 2 ? 3.1416 / NS : 0),
        q: any = { x: hx + Math.cos(a) * NR[r][0], y: HY + Math.sin(a) * NR[r][0], z: NR[r][1], f: r === 0 };
      q.px = q.x;
      q.py = q.y;
      q.pz = q.z;
      p.push(q);
      gr[r].push(q);
    }
  }
  // [a, b, rest length, stiffness, strand?] - strands are drawn; ring ties only hold the shape
  const L = (a: any, b: any, k: number, draw = 1) => {
    const dx = a.x - b.x,
      dy = a.y - b.y,
      dz = a.z - b.z;
    c.push([a, b, Math.sqrt(dx * dx + dy * dy + dz * dz), k, draw]);
  };
  for (let r = 1; r < NR.length; r++)
    for (let k = 0; k < NS; k++) {
      const o = r % 2 ? 0 : -1; // odd rings sit between the knots of the ring above
      L(gr[r][k], gr[r - 1][(k + o + NS) % NS], 1);
      L(gr[r][k], gr[r - 1][(k + o + 1) % NS], 1);
    }
  for (let k = 0; k < NS; k++) L(gr[NR.length - 1][k], gr[NR.length - 1][(k + 1) % NS], 0.6); // bottom hem
  for (let r = 1; r < NR.length - 1; r++) for (let k = 0; k < NS; k++) L(gr[r][k], gr[r][(k + 1) % NS], 0.18, 0); // soft hoop ties
  // fz/fv: rim flex (px, + = bent down) and its rate; dk: this dunk already yanked it; b*: the ball as the net last
  // saw it (position, velocity, bok 0 none / 1 position / 2 both); r*: the reaction it handed the ball; w*: sway
  // oscillators; hold: how long a ball has sat slow in the mesh (then the net lets go of it)
  const N: any = { p, c, hx, quiet: 0, ring: 0, fz: 0, fv: 0, dk: 0, bx: 0, by: 0, bz: 0, bvx: 0, bvy: 0, bvz: 0, bok: 0, rvx: 0, rvy: 0, rvz: 0, wx: 1, wy: 0, wx2: 0, wy2: 1, hold: 0, tx: 0, ty: 0, tvx: 0, tvy: 0, bs: 0, bsv: 0, shT: 0, chT: -9 };
  for (let i = 0; i < 240; i++) netTick(N, 1 / 60, 0, 0, 0, 0, 0, 0, 0, 1); // let it hang: the rest pose is its equilibrium
  for (const q of p) (q.px = q.x), (q.py = q.y), (q.pz = q.z);
  return N;
});
/** One net step: verlet knots (the rim ring pinned to the flexing iron), elastic strands, and (touch) the ball moving
 *  x0 -> x1 in sub-steps with push-out + friction. The mesh displacement the ball caused (its reaction) -> NRX. */
function netTick(N: any, dt: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, touch: number, settle: number) {
  const SUB = !touch ? 1 : Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0) + (z1 - z0) * (z1 - z0)) > 4 ? 4 : 2,
    h = dt / SUB,
    damp = SUB === 1 ? NM[0] : SUB === 2 ? Math.sqrt(NM[0]) : Math.sqrt(Math.sqrt(NM[0])),
    gz = g * h * h,
    fzz = 100 - N.fz,
    ax = settle ? 0 : NM[7] * (N.wx * 0.7 + N.wx2 * 0.3) * h * h,
    ay = settle ? 0 : NM[7] * (N.wy * 0.5 + N.wy2 * 0.5) * h * h,
    its = touch || N.quiet < 120 ? 7 : 3; // (a net nothing has touched for 2 s only sways: a cheaper solve)
  NRX[0] = NRX[1] = NRX[2] = 0;
  for (let sub = 0; sub < SUB; sub++) {
    const u1 = (sub + 1) / SUB,
      bx = x0 + (x1 - x0) * u1,
      by = y0 + (y1 - y0) * u1,
      bz = z0 + (z1 - z0) * u1,
      sx = (x1 - x0) / SUB, // the ball's slide this sub-step
      sy = (y1 - y0) / SUB,
      sz = (z1 - z0) / SUB;
    for (const q of N.p) {
      if (q.f) {
        q.pz = q.z; // the rim ring rides the iron (and its wobble: Physics v3)
        q.z = N.tx || N.ty ? fzz - (N.tx * (q.x - N.hx) + N.ty * (q.y - HY)) / RR : fzz;
        continue;
      }
      const vx = (q.x - q.px) * damp,
        vy = (q.y - q.py) * damp,
        vz = (q.z - q.pz) * damp,
        dep = (100 - q.z) * 0.06; // (the air moves the hem more than the loops at the rim)
      q.px = q.x;
      q.py = q.y;
      q.pz = q.z;
      q.x += vx + ax * dep;
      q.y += vy + ay * dep;
      q.z += vz - gz;
    }
    for (let it = 0; it < its; it++) {
      for (const c of N.c) {
        const a = c[0],
          b = c[1],
          dx = b.x - a.x,
          dy = b.y - a.y,
          dz = b.z - a.z,
          d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        let f: number;
        if (c[3] >= 1) {
          // nylon strand: slack in compression, elastic when stretched, a rope again past the stretch limit
          if (d <= c[2]) continue;
          const lim = c[2] * NM[3],
            st = its === 7 ? NM[1] : NM[2];
          f = d > lim ? ((d - lim + (lim - c[2]) * st) / d) * 0.5 : ((d - c[2]) / d) * 0.5 * st;
        } else f = ((d - c[2]) / d) * 0.5 * (its === 7 ? c[3] : c[3] > 0.5 ? NET_HEM3 : NET_TIE3);
        if (!a.f) {
          a.x += dx * f;
          a.y += dy * f;
          a.z += dz * f;
        }
        if (!b.f) {
          b.x -= dx * f;
          b.y -= dy * f;
          b.z -= dz * f;
        }
      }
      if (touch)
        for (const c of N.c) {
          if (!c[4]) continue;
          const a = c[0],
            b = c[1],
            ex = b.x - a.x,
            ey = b.y - a.y,
            ez = b.z - a.z,
            l2 = ex * ex + ey * ey + ez * ez || 1,
            t = clamp(((bx - a.x) * ex + (by - a.y) * ey + (bz - a.z) * ez) / l2, 0, 1),
            cx = a.x + ex * t - bx,
            cy = a.y + ey * t - by,
            cz = a.z + ez * t - bz,
            d = Math.sqrt(cx * cx + cy * cy + cz * cz);
          if (d < SEGR && d > 0) {
            const push = (SEGR - d) / d;
            // friction (first pass): the strand follows the ball's slide along it (not the part pressing into it) -
            // that drags the mesh down on a swish, and the stretched nylon whips it back up when the ball is through
            let fx = 0,
              fy = 0,
              fz = 0;
            if (it === 0) {
              const nx = cx / d,
                ny = cy / d,
                nz = cz / d,
                sn = sx * nx + sy * ny + sz * nz;
              fx = (sx - sn * nx) * NM[4];
              fy = (sy - sn * ny) * NM[4];
              fz = (sz - sn * nz) * NM[4];
            }
            for (let e = 0; e < 2; e++) {
              const q = e === 0 ? a : b,
                w = e === 0 ? 1 - t : t;
              if (q.f) continue;
              const mx = (cx * push + fx) * w,
                my = (cy * push + fy) * w,
                mz = (cz * push + fz) * w;
              q.x += mx;
              q.y += my;
              q.z += mz;
              // reaction: the drag (first pass) + what the mesh still pushes back at the end (last pass)
              // (the push holds the ball up or down only weakly: a ball leaning on the funnel of the mesh drops through
              // it - full support left a ball hovering in the net)
              if (bz < 99 && it === 0) (NRX[0] += fx * w * NET_RF), (NRX[1] += fy * w * NET_RF), (NRX[2] += fz * w * NET_RF);
              if (bz < 99 && it === 6) (NRX[0] += mx), (NRX[1] += my), (NRX[2] += mz * NET_RUP);
            }
          }
        }
    }
  }
}
/** Cloth net: verlet knots on elastic nylon strands (slack in compression, stiff past 15% stretch), real gravity, the
 *  rim ring riding the flexing iron, sub-stepped along the ball's real path while it is inside (no tunnelling).
 *  Two-way: strands the ball pushes or drags push back (the net grabs and slows a swish, then whips back up as the
 *  ball drops out); a ball ringing off the iron bends the rim and jerks the loops by the hit (a ripple runs down and
 *  round the mesh); a dunk yanks the rim down and a player hanging on it holds it there; a slight sway at rest.
 *  The ball's motion is read from its positions (not B.v*), so replays (rp: no reaction on the ball, dt scaled by
 *  the replay speed) and online guests drive the net the same way. */
export function netSim(dt: number, rp = 0) {
  if (!(dt > 0)) return;
  NM = NETMAT[chainNet() ? 1 : 0];
  for (const N of NETS) {
    // the ball's path this tick, from its positions (a teleport - setup, a replay cut - is no motion)
    const jx = B.x - N.bx,
      jy = B.y - N.by,
      jz = B.z - N.bz,
      cut = !N.bok || Math.sqrt(jx * jx + jy * jy + jz * jz) > 40,
      x0 = cut ? B.x : N.bx,
      y0 = cut ? B.y : N.by,
      z0 = cut ? B.z : N.bz,
      vx = cut ? 0 : jx / dt,
      vy = cut ? 0 : jy / dt,
      vz = cut ? 0 : jz / dt,
      two = !cut && N.bok > 1,
      // the hit the ball took this tick: its velocity change beyond gravity and the net's own pull on it
      dvx = two ? vx - N.bvx - N.rvx : 0,
      dvy = two ? vy - N.bvy - N.rvy : 0,
      dvz = two ? vz - N.bvz - N.rvz + g * dt : 0,
      J = Math.sqrt(dvx * dvx + dvy * dvy + dvz * dvz);
    N.bok = cut ? 1 : 2;
    N.bx = B.x;
    N.by = B.y;
    N.bz = B.z;
    N.bvx = vx;
    N.bvy = vy;
    N.bvz = vz;
    N.rvx = N.rvy = N.rvz = 0;
    const ox = B.x - N.hx,
      oy = B.y - HY,
      dxy = Math.sqrt(ox * ox + oy * oy),
      near = !cut && dxy < 20 && B.z > 66 && B.z < 114,
      free = !B.owner,
      rd = Math.sqrt((dxy - RR) * (dxy - RR) + (B.z - 100) * (B.z - 100));
    if (near && free && J > 45 && N.ring <= 0) {
      if (rd < BR + 2.5) {
        // rim hit: the iron bends (down when hit from above) and the loops by the hit jerk away from it
        N.ring = 0.1;
        N.fv += clamp(J * 0.05 * ((B.z - 100) / (rd || 1) + 0.25), -30, 60);
        const s0 = Math.min(2.4, J * 0.008) / J,
          ux = dxy > 0 ? ox / dxy : 1,
          uy = dxy > 0 ? oy / dxy : 0;
        for (let k = NS; k < NS * 3; k++) {
          const q = N.p[k],
            qx = q.x - N.hx,
            qy = q.y - HY,
            w = (1 + (qx * ux + qy * uy) / (Math.sqrt(qx * qx + qy * qy) || 1)) * 0.5,
            s = s0 * w * w * (k < NS * 2 ? 1 : 0.55);
          // (verlet velocity = x - px) the loops jump: away from the ball's kick sideways, and up (the nylon is slack
          // that way, so the hit shows) as the ring snaps
          q.px += dvx * s;
          q.py += dvy * s;
          q.pz -= J * s * 0.6;
        }
        if (cfg.PH3) {
          // (Physics v3: the hit tips the ring - the side it struck dips - and it wobbles)
          const k = clamp(J * 0.02 * ((B.z - 100) / (rd || 1) + 0.25), -10, 20);
          N.tvx += ux * k;
          N.tvy += uy * k;
        }
      } else if (Math.abs(B.x - (N.hx > 470 ? 900 : 40)) < BR + 2.5 && B.z > 93) {
        N.ring = 0.1;
        N.fv += Math.min(12, J * 0.012); // off the glass: the board shakes the iron a little
        if (cfg.PH3) N.bsv += Math.min(30, J * 0.03); // (Physics v3: and the board itself)
      }
    }
    if (N.ring > 0) N.ring -= dt;
    // a dunk yanks the iron down (once per dunk); a player hanging on it holds it bent
    if (B.dk && !N.dk && near && B.z < 106 && dxy < 10) {
      N.dk = 1;
      N.fv += 55;
      if (cfg.PH3) ph3Yank(N);
    }
    if (!B.dk) N.dk = 0;
    let hang = 0,
      hgx = 0,
      hgy = 0;
    for (const p of P)
      if (p.hangT > 0 && p.z > 15 && (p.x - N.hx) * (p.x - N.hx) + (p.y - HY) * (p.y - HY) < 26 * 26) {
        hang = 2.2;
        const hd = Math.sqrt((p.x - N.hx) * (p.x - N.hx) + (p.y - HY) * (p.y - HY)) || 1;
        hgx = ((p.x - N.hx) / hd) * 0.9; // (he hangs on the front of the ring: it tips toward him)
        hgy = ((p.y - HY) / hd) * 0.9;
      }
    if (cfg.PH3) ph3Wobble(N, dt, hgx, hgy);
    N.fv += (-RIM_W * RIM_W * (N.fz - hang) - 2 * RIM_Z * RIM_W * N.fv) * dt;
    N.fz += N.fv * dt;
    if (N.fz > 4) (N.fz = 4), (N.fv = Math.min(0, N.fv));
    if (N.fz < -1.5) (N.fz = -1.5), (N.fv = Math.max(0, N.fv));
    // idle sway oscillators (renormalised: no drift)
    {
      const a = N.wx * BRC - N.wy * BRS,
        b = N.wx * BRS + N.wy * BRC,
        l = Math.sqrt(a * a + b * b) || 1,
        a2 = N.wx2 * BRC2 - N.wy2 * BRS2,
        b2 = N.wx2 * BRS2 + N.wy2 * BRC2,
        l2 = Math.sqrt(a2 * a2 + b2 * b2) || 1;
      N.wx = a / l;
      N.wy = b / l;
      N.wx2 = a2 / l2;
      N.wy2 = b2 / l2;
    }
    N.quiet = near ? 0 : N.quiet + 1;
    // (Physics v3: a chain net clanks when the ball goes through or rattles it)
    if (NM !== NETMAT[0] && near && !rp && !PREDICT && B.z < 100 && T - N.chT > 0.35 && Math.sqrt(vx * vx + vy * vy + vz * vz) > 60) {
      N.chT = T;
      fx({ k: "chain", x: N.hx, y: HY, v: Math.min(1, Math.sqrt(vx * vx + vy * vy + vz * vz) / 400) });
    }
    netTick(N, dt, x0, y0, z0, B.x, B.y, B.z, near ? 1 : 0, 0);
    // reaction on the ball (below the rim only: rim rolls and makes are decided by the iron, not the nylon); a ball
    // that sits slow in the mesh for half a second is let go (nothing may hold a live ball forever)
    const slow = near && B.z < 99 && dxy < RR && Math.sqrt(vx * vx + vy * vy + vz * vz) < 25;
    N.hold = slow ? N.hold + dt : 0;
    if (near && free && !rp && B.z < 99 && N.hold < 0.5 && (NRX[0] || NRX[1] || NRX[2])) {
      const K = NM[5] / dt,
        cap = 45,
        ex = -clamp(NRX[0] * K, -cap, cap),
        ey = -clamp(NRX[1] * K, -cap, cap),
        ez = -clamp(NRX[2] * K, -NM[6], NM[6]); // (the nylon kills the sideways speed but only slows the drop)
      // the funnel of the mesh steers a ball pressing into it back to the middle (it falls out of the hem there)
      const ux = dxy > 0.3 ? ox / dxy : 0,
        uy = dxy > 0.3 ? oy / dxy : 0,
        vr = vx * ux + vy * uy,
        ac = clamp(-(NET_CK * dxy + NET_CC * vr) * dt, -40, 40);
      B.vx += ex + ux * ac;
      B.vy += ey + uy * ac;
      B.vz += ez;
      N.rvx = ex + ux * ac;
      N.rvy = ey + uy * ac;
      N.rvz = ez;
    }
  }
}
/** Is the ball inside a net right now (between rim and hem)? Used to slow a swish realistically. */
export const inNet = () => {
  for (const hx of HXs) if (Math.hypot(B.x - hx, B.y - HY) < RR - 0.5 && B.z < 100 && B.z > 82) return true;
  return false;
};

// ---- instant replays: allocation-free ring buffer of positions + poses ----
export const QK = ["tL", "tR", "kL", "kR", "aL", "aR", "eL", "eR", "sz", "cr", "ln", "rz", "ty", "wR", "wL", "zL", "hz", "cx", "cy", "nk", "hy", "hp", "fL", "fR", "gL", "gR", "hs", "oL", "oR", "hL", "hR"];
const RCAP = 331,
  PST = 4 + QK.length,
  FST = 4 + 10 * PST + 1;
const REC = new Float32Array(RCAP * FST);
let recS = 0;
export let recN = 0;
/** Replay kind: 0 normal director, 1 clutch (buzzer beater / game winner) multi-angle sequence. */
export let RPK = 0;
export const setRPK = (v: number) => (RPK = v);
export function recClear() {
  recS = recN = 0;
}
export const hlClear = () => (HL.length = 0);
export function recFrame() {
  if (!cfg.replays || RPL) return;
  if (recN >= RCAP) {
    recS = (recS + 1) % RCAP;
    recN--;
  }
  const o = ((recS + recN) % RCAP) * FST;
  REC[o] = B.x;
  REC[o + 1] = B.y;
  REC[o + 2] = B.z;
  REC[o + 3] = B.a;
  for (let k = 0; k < P.length; k++) {
    const p = P[k],
      b = o + 4 + k * PST;
    REC[b] = p.x;
    REC[b + 1] = p.y;
    REC[b + 2] = p.z;
    REC[b + 3] = p.f + (p.ry || 0); // (the drawn facing: hip turns and spins replay too - pose.ts fv)
    const qq = p.q;
    for (let j = 0; j < QK.length; j++) REC[b + 4 + j] = qq ? qq[QK[j]] : NaN;
  }
  recN++;
}
function recApply(n: number) {
  const o = ((recS + n) % RCAP) * FST;
  B.x = REC[o];
  B.y = REC[o + 1];
  B.z = REC[o + 2];
  B.a = REC[o + 3];
  for (let k = 0; k < P.length; k++) {
    const p = P[k],
      b = o + 4 + k * PST;
    p.x = REC[b];
    p.y = REC[b + 1];
    p.z = REC[b + 2];
    p.f = REC[b + 3];
    p.ry = 0; // (the recorded facing already carries it)
    if (!isNaN(REC[b + 4])) {
      p.q = p.q || {};
      for (let j = 0; j < QK.length; j++) p.q[QK[j]] = REC[b + 4 + j];
    }
  }
}
let LIVE: any = null;
/** Replay speed (slow motion by default; [ and ] change it). */
const RSP = [0.15, 0.25, 0.4, 0.7, 1];
export let RSPD = 0.4;
export const setRplSpeed = (d: number) => (RSPD = RSP[clamp(RSP.indexOf(RSPD) + d, 0, RSP.length - 1)]);
/** Game highlights (copies of the replay buffer) for the end-of-game reel and saved reels. */
export const HL: { s: string; n: number; buf: Float32Array; q?: number }[] = [];
export let HLN = ""; // label for the next highlight
export const setHLN = (s: string) => (HLN = s);
export const FSTN = () => FST;
function saveHL() {
  const n = Math.min(250, recN),
    buf = new Float32Array(n * FST);
  for (let k = 0; k < n; k++) {
    const o = ((recS + recN - n + k) % RCAP) * FST;
    buf.set(REC.subarray(o, o + FST), k * FST);
  }
  HL.push({ s: HLN || "Highlight", n, buf, q });
  HLN = "";
  if (HL.length > 8) HL.shift();
}
/** Load a saved clip into the replay buffer and play it (end-of-game reel / saved reel). */
export function playClip(c: { n: number; buf: Float32Array; k?: number }) {
  recS = 0;
  recN = Math.min(c.n, RCAP);
  REC.set(c.buf.subarray(0, recN * FST), 0);
  LIVE = { p: P.map((p) => [p.x, p.y, p.z, p.f, p.q ? { ...p.q } : null]), b: [B.x, B.y, B.z, B.a] };
  RPL = { i: 0, reel: 1, rs, k: c.k || 1 };
}
export function startReplay() {
  LIVE = { p: P.map((p) => [p.x, p.y, p.z, p.f, p.q ? { ...p.q } : null]), b: [B.x, B.y, B.z, B.a] };
  RPL = { i: Math.max(0, recN - 250) };
  if (cfg.replays && !PREDICT) saveHL();
}
export const skipReplay = () => {
  if (RPL) RPL.i = 1e9;
};
function rplStep(dt: number) {
  const r = RPL;
  r.i += dt * 60 * RSPD * (r.k || 1);
  const n = Math.floor(r.i);
  if (n >= recN - 1) {
    P.forEach((p, k) => {
      const l = LIVE.p[k];
      p.x = l[0];
      p.y = l[1];
      p.z = l[2];
      p.f = l[3];
      p.q = l[4];
    });
    [B.x, B.y, B.z, B.a] = LIVE.b;
    const reel = r.reel;
    RPL = null;
    RQ = 0;
    RPK = 0;
    recClear();
    rs = reel ? r.rs : 0.001; // a reel (halftime / final) must not trigger the next inbound
    return;
  }
  recApply(n);
}
/** Replay state for online guests: host says "replay at frame i". */
export const setRPL = (v: any) => (RPL = v);
