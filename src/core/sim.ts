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
  ONLINE: 0, // online game: fixed rosters (no subs) and rating-only shot windows (the guest's meter must match the host)
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

export function start(i: number, o: { j?: number; sel?: number } = {}) {
  const NP = cfg.NP;
  SEL = o.j ?? o.sel ?? i; // My Player 1v1 faces the chosen opponent, else the selected card
  let j = o.j;
  if (j == null)
    do j = (Math.random() * nChoices()) | 0;
    while (j === i);
  P = [];
  [i, j].forEach((ti, t) => {
    const col = t && RS(ti, t)[0] === RS(i, 0)[0] ? "#b03a2e" : RS(ti, t)[0];
    RS(ti, t)[1].forEach((a, k) => P.push(mkP(a, t, k, col)));
    // generated reserves (fictional), a few points below the starters, for fatigue subs and foul-outs
    BENCH[t] = NP >= 5 && !cfg.ASTAR ? reserves(RS(ti, t)[1], RS(ti, t)[2]).map((a, k) => mkP(a, t, k, col)) : [];
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
};
function scoutNew() {
  return { a: [0, 0, 0], m: [0, 0, 0], c: [0, 0, 0] };
}
export const GPN = ["BALANCED", "ATTACK THE PAINT", "MID-RANGE & POST", "LET IT FLY", "FEED THE HOT HAND"];
export const DSN = ["NORMAL", "SAG / PROTECT PAINT", "TIGHT / DENY", "SWITCH EVERYTHING", "2-3 ZONE"],
  PCN = ["AUTO", "PICK & ROLL", "PINDOWN", "FLARE", "ISOLATION"];
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
  if ((p.cold || 0) >= 3) add(0.9, "COLD");
  if (clutchTime() && hasB(p, "CL")) add(1.15, "CLUTCH");
  const mo = p.tm ? -TS.mom : TS.mom;
  if (mo > 0.5) add(1.05, "MOMENTUM");
  if (TS.clutch && p.tm === 0 && cfg.GM === "game") add(1.05, "HOME CROWD");
  return m;
}
/** Make/miss bookkeeping for hot zones and cold streaks. */
function zoneRes(p: Player, D0: number, made: boolean) {
  if (!p || !p.hzm || D0 == null) return;
  scout(p, D0, made, B.cx ?? 0);
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
  if (++TS.gpT[t] < 4) return;
  // defense reads the other side's sheet: they live at the rim -> sag; they're raining threes -> run them off the line
  const o = TS.sk[1 - t],
    rimHot = pps(o, 0) > 1.35 && o.a[0] >= 4,
    // they live at the rim and can't shoot it: pack the paint with a zone (5v5), or at least sag
    ds = pps(o, 2) > 1.2 && o.a[2] >= 4 ? 2 : rimHot ? (cfg.NP === 5 && pps(o, 2) < 1.0 ? 4 : 1) : TS.ds[t] === 3 ? 3 : 0;
  if (ds !== TS.ds[t]) {
    TS.ds[t] = ds;
    if (ds === 4) ban("2-3 ZONE", cl[t].toUpperCase() + " PACK THE PAINT", PC[t]), cm("zone", cl[t]);
    else if (ds) txt(cl[t].toUpperCase() + " DEFENSE: " + DSN[ds], 480, 170, "#9fe7ff");
  }
  // pick-and-roll coverage: hedge out on a handler who punishes a big sitting back (a pull-up shooter, or their pull-ups
  // are falling), otherwise drop and protect the rim
  {
    const st = starOf(1 - t),
      cov = (st && st.c >= 86) || (pps(o, 1) > 1.0 && o.a[1] >= 4) ? 1 : 0;
    if (cov !== TS.cov[t]) {
      TS.cov[t] = cov;
      txt(cl[t].toUpperCase() + (cov ? " HEDGE THE PICK-AND-ROLL" : " DROP ON THE PICK-AND-ROLL"), 480, 150, "#9fe7ff");
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
    if (cfg.NP < 3 || cfg.ASTAR) hi = -1;
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
  rs = 2;
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
/** Substitutions at dead balls (5v5): tired or fouled-out players go to the bench, rested ones come back. */
function subs() {
  if (!cfg.SUBS || cfg.NP < 2 || PREDICT || !BENCH[0] || cfg.ONLINE) return;
  for (let t = 0; t < 2; t++) {
    const bn = BENCH[t];
    if (!bn.length) continue;
    for (let k = 0; k < cfg.NP; k++) {
      const idx = t * cfg.NP + k,
        p = P[idx];
      if (p.my || CT.some((c) => c.fixed && c.idx === idx)) continue;
      const fresh = T - (p.inAt || 0) < 25; // nobody gets yanked right after checking in
      const tired = ((p.en ?? 1) < 0.5 && !fresh) || p.fo;
      if (!tired) {
        // a rested starter checks back in for his sub
        if (p.sub && !p.fo) {
          const s0 = bn.find((b) => b === p.sub && (b.en ?? 1) > 0.85 && !b.fo);
          if (s0 && (p.en ?? 1) < 0.8 && !fresh) swap(t, k, s0);
        }
        continue;
      }
      let best: Player | null = null;
      for (const b of bn) if (!b.fo && (b.en ?? 1) > 0.7 && (!best || Math.abs(b.ht - p.ht) < Math.abs(best.ht - p.ht))) best = b;
      if (best) swap(t, k, best);
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
  setup(1 - t);
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
const guardOf = (p: Player) => {
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
    win = (0.07 + (rat / 100) * 0.05) * (1 - 0.45 * cx) * (0.85 + 0.15 * (p.en == null ? 1 : p.en)) * wm0,
    rT = lay ? 0.28 : p.st === 1 ? 0.3 : 0.4;
  let gr;
  B.d0 = isFT ? null : D0;
  B.fb = !isFT && TS.tr[p.tm] ? 1 : 0; // (broadcast stats: a fast-break shot)
  B.sc2 = !isFT && TS.orbP[p.tm] ? 1 : 0; // (second-chance shot: this possession had an offensive rebound)
  B.cx = cx;
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
      p.tg = { off: Math.round(off * 1000), win: Math.round(wt * 1000), g, gr: !!gr, z: zoneOf(p, D0) };
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
    const base = three ? 0.39 + (0.16 * (rat - 60)) / 40 : 0.33 + (0.14 * (rat - 60)) / 40,
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
  B.gt = B.gtc = 0;
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
  if (!fd && blk && blk.z > 10 && Math.hypot(blk.x - p.x, blk.y - p.y) < 24 && Math.random() < 0.025 + (ct * 0.13 * blk.d) / 100) {
    B.vx = (p.x - blk.x) * 8 + (Math.random() - 0.5) * 80;
    B.vy = (Math.random() - 0.5) * 120;
    B.vz = 60;
    B.sh = 0;
    B.last = blk; // (he touched it last: swatted out of bounds, the shooting team keeps it)
    blk.stt.blk++;
    exc(0.9);
    txtW("BLOCKED!", blk.x, blk.y, 80, "#ff6b4a");
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
    mk = dunkMiss ? false : lay ? Math.random() < clamp(b + (gr ? 0.15 : 0), 0.03, 0.97) : gr && (p.perf || Math.random() < 0.98 - cx * 0.25),
    a = Math.random() * 6.28,
    off = mk ? (rap ? 0.3 : 1.2) : 9 + Math.random() * 7,
    tx = hx + Math.cos(a) * off,
    ty = HY + Math.sin(a) * off,
    dx = tx - x0,
    dy = ty - y0,
    D = Math.hypot(dx, dy) || 1,
    dz = 100 - z0;
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
  if (rap) {
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
  if (rap) {
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
    const rot = cfg.SUBS && cfg.NP > 1 && !PREDICT && cfg.GM === "game" && !cfg.ONLINE,
      use = i.sp && sv2 > 150 ? 0.1 : rot ? (sv2 > 60 ? sv2 * 0.00013 : -0.01) : -0.04;
    p.en = Math.max(0, Math.min(1, (p.en == null ? 1 : p.en) - dt * use));
  }
  if (has && p.mode === "i" && p.cd <= 0 && !(p.mvT > 0) && (i.dx || i.dy) && p.li && i.dx * p.li[0] + i.dy * p.li[1] < -0.3 && Math.hypot(p.vx, p.vy) > 110)
    i.mv = i.mv || 3;
  if (i.dx || i.dy) p.li = [i.dx, i.dy];
  p.postA = has && i.post && p.mode === "i" && D < 190 && !ftq && !(p.mvT > 0) ? 1 : 0;
  if (p.postA) {
    i.dx = (ux / D) * 0.3;
    i.dy = (uy / D) * 0.3;
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
    } else {
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
    } else {
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
      d.x += nx * 3 * f;
      d.y += ny * 3 * f;
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
    if (!PREDICT) {
      const d = P[nearest(1 - p.tm, p.x, p.y)];
      d.slow = 0.5 + 0.25 * p.bn;
      if (Math.hypot(d.x - p.x, d.y - p.y) < 30 && Math.random() < 0.12 + (p.s - d.d) / 400 + (hasB(p, "AB") ? 0.12 : 0)) {
        d.act = 3; // lost his footing on the step-back
        d.actT = 1.0;
        if (hum) txtW("SHOOK HIM!", d.x, d.y, 95, "#ff6b6b");
      }
    }
    if (hum) txtW(p.bn > 1 ? "DOUBLE STEP-BACK!" : "STEP-BACK!", p.x, p.y, 95, "#ffd23f");
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
    } else if (p.t >= (p.bn > 1 ? 0.4 : 0.2)) {
      p.mode = "i";
      p.sbw = 0.9;
      p.vx = p.vy = 0;
    }
  }
  if (p.mode === "i") {
    if (i.sd) {
      if (has && pos === p.tm) {
        p.mode = "c";
        p.t = 0;
        if (TEMPO) i.su = 1;
      } else if (!has && p.z <= 0) {
        p.vz = 126 + p.j * 0.9;
        // jumping at a shot that's already gone: he lands off balance
        if (B.sh && B.last && B.last.tm !== p.tm && B.age > 0.12 && Math.hypot(B.last.x - p.x, B.last.y - p.y) < 40) p.lateJ = 1;
      }
    }
    if (has && (i.pass || i.e || i.lob)) {
      const r = i.pass || pick(p, i);
      const lobIt = !i.lob && !isH(p) && r && r.j >= (cfg.ASTAR ? 45 : 55) && Math.hypot(hoop(r.tm) - r.x, HY - r.y) < (cfg.ASTAR ? 140 : 100) && Math.random() < (cfg.ASTAR ? 0.92 : 0.6);
      if (r && !PREDICT) pass(p, r, i.lob || lobIt ? 2 : undefined);
    } else if (i.e && p.cd <= 0) {
      p.cd = 0.8; // steals are OFF by design (user request): reach-ins do nothing
    }
  }
  if (p.mode === "c") {
    p.t += dt;
    p.vx *= 0.85;
    p.vy *= 0.85;
    if (!has) p.mode = "i";
    else if (i.su || p.t > 1.4) {
      p.mt = i.su && i.mt != null ? clamp(i.mt, p.t - 0.25, p.t + 0.05) : p.t;
      p.cw = Math.min(1, contestOf(p)[0] + (p.bmp || 0) * 0.5);
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
        k = p.st === 2 ? 70 : p.st === 3 ? 110 : 0;
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
      p.tp = null;
      p.vz = ftq ? 60 : ((lay ? 150 : 126) + p.j * 0.9) * (cfg.PRO && p.st === 1 && !lay ? 0.75 : 1);
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
    if (!p.rl && has && !PREDICT && p.t >= (D < 90 ? 0.28 : p.st === 1 ? 0.3 : 0.4) + (p.dcl || 0) - (p.react === 2 ? 0.05 : 0)) launch(p);
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
        (p.z > 0 ? 0.5 : 1),
      k = Math.min(1, dt * (p.z > 0 ? 1.5 : 9));
    if (cfg.PRO && p.z <= 0) {
      const dx = i.dx * sp - p.vx,
        dy = i.dy * sp - p.vy,
        dl = Math.hypot(dx, dy),
        cur = Math.hypot(p.vx, p.vy),
        brk = cur > 40 && dx * p.vx + dy * p.vy < 0,
        first = (p.fsT || 0) > 0,
        ac = (brk ? (p.plantT > 0 ? 1500 : 1100) : (620 + p.s * 3) * (first ? 1.55 : 1)) * (p.mvT > 0 ? 2.6 : 1) * dt,
        mm = Math.min(dl, ac);
      // a hard cut at speed: plant the outside foot (two-three steps to stop), and sometimes slip
      if (brk && cur > 170 && !(p.plantT > 0) && !(p.brk > 0.5)) {
        p.plantT = 0.2;
        if (!PREDICT && cur > 235 && Math.random() < 0.025 + (78 - p.s) / 1500) {
          p.hitT = 0.3;
          p.hitX = p.vx / cur;
          p.hitY = p.vy / cur;
          p.slow = Math.max(p.slow, 0.35);
          if (isH(p)) txtW("SLIPPED!", p.x, p.y, 90, "#ff9966");
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
    else if (has) tf = (p.vx * ux + p.vy * uy) / D < -0.3 * sv ? Math.atan2(uy, ux) : sv > 20 ? Math.atan2(p.vy, p.vx) : null;
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
      if (p.vz < -120) p.landT = Math.min(0.28, -p.vz / 900); // absorb the landing
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
    const dn = P[nearest(1 - t, p.x, p.y)],
      D0 = Math.hypot(oh - p.x, HY - p.y);
    // step-back: a weapon to create space once the possession has developed (or the clock is running out), not the
    // first thing off the bring-up - at arcade quarter lengths it comes sooner
    {
      const pf = clamp((QTRLEN - 30) / 150, 0, 1),
        el = 24 - shot;
      if (p.cd <= 0 && D0 > 150 && Math.hypot(dn.x - p.x, dn.y - p.y) < 38 && (el > 3 + 8 * pf || shot < 8) && Math.random() < dt * 4 * tendOf(p)[5]) i.sb = 1;
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
          if (slow || p.i > p.c + 4 || Math.random() < 0.4) (a.r = 40 + Math.random() * 40), (i.mv = Math.random() < 0.5 ? 1 : undefined);
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
            kick = D < 130 && dd >= 237 && od > 45 ? 0.25 : 0;
          return (Math.min(od, 80) / 80) * 0.6 + (ql(r, dd) / 100) * 0.5 + (dd < D ? 0.12 : 0) + (OFFS[t] === r ? 0.45 : 0) + (r.my || isH(r) ? 0.2 : 0) + star + kick;
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
    if (p.cd <= 0 && p.s >= 72 && Math.hypot(dn.x - p.x, dn.y - p.y) < 55 && Math.random() < dt * 1.4) i.mv = 1 + ((Math.random() * 3) | 0);
  } else if (pos === t && B.mode !== "held" && B.to === p) mv(p, B.x + B.vx * 0.2, B.y + B.vy * 0.2, 1);
  else if (pos === t && B.owner) {
    // the handoff man just gave it up: he is the screen - planted for a beat
    if ((p.ai.holdT || 0) > T) {
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
      return;
    }
    // transition: fill the lanes - the closest man runs to the rim, two wide to the corners, the last one trails
    if (TS.tr[t] && B.owner.tm === t && NP > 1 && !cfg.HALF) {
      const dir = oh > 470 ? -1 : 1;
      let rk = 0;
      for (const q of P) if (q.tm === t && q !== B.owner && q !== p && !q.off && Math.hypot(oh - q.x, HY - q.y) < Math.hypot(oh - p.x, HY - p.y)) rk++;
      const side = p.y < HY ? -1 : 1,
        lane = rk === 0 ? [oh + dir * 22, HY + side * 18] : rk < 3 ? [oh + dir * 55, HY + side * 195] : [oh + dir * 245, HY + side * 50];
      mv(p, lane[0], lane[1], 1.1);
      if (rk < 3) i.sp = 1;
      return;
    }
    if (offBall(p, t)) return;
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
    const zone = TS.ds[t] === 4 && NP === 5 && !cfg.HALF,
      zo = zone ? zoneMan(p, t, dh) : null,
      o = zo || (p.manT > 0 && p.man != null ? P[p.man] : guardOf(p)),
      ds = TS.ds[t],
      od = Math.hypot(dh - o.x, HY - o.y),
      cpu = !CT.some((c) => c.tm === t),
      hotO = (o.heat || 0) >= 2 || (o.hzm && o.hzm[zoneOf(o, od)] >= 2);
    let ou = (B.owner === o ? 22 : 26) * cpuK(p, [1.35, 1.12, 1, 0.86]) * (cfg.ASTAR ? 1.6 : 1); // tighter on-ball defense on harder levels (All-Star: nobody plays D)
    if (ds === 1) ou = B.owner === o ? ou + 8 : ou * 1.6; // sag: go under screens, wall off the paint
    else if (ds === 2) ou = B.owner === o ? ou * 0.82 : ou * 0.6; // tight: pressure and deny
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
      if (TS.cov[t] === 1 && (opl.ph === "set" || T - opl.setAt < 0.55)) {
        // hedge: jump out above the screen into the handler's path, then get back to the roller
        mv(p, hb.x + (dh - hb.x) * 0.12 + (hb.y - HY) * -0.05, hb.y + (HY - hb.y) * 0.12, 1.2);
        i.sp = 1;
        p.hdgT = 0.25; // (pose: big and wide, arms out to show the handler a wall)
      } else if (TS.cov[t] === 1) mv(p, o.x + (dh - o.x) * 0.35, o.y + (HY - o.y) * 0.35, 1.15); // recover
      else mv(p, dh + dir * 85, HY + (hb.y - HY) * 0.35, 1); // drop: sit at the free-throw line, wall off the drive and the roll
    } else if (hh < 140 && p.k !== hb.k && nearest(t, hb.x, hb.y, t * NP + hb.k) === t * NP + p.k)
      mv(p, hb.x + (dh - hb.x) * 0.35, hb.y + (HY - hb.y) * 0.35, 1.1);
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
  const r = ZR.indexOf(p.k),
    side = r === 0 || r === 2 ? -1 : 1,
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
  return o.z + o.ht * 5 - tight * 5 + Math.min(4, sp * 0.015);
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
    if (B.dhd <= 0) B.dvv = -(165 + sp * 0.4);
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
function dribHand(o: Player, dt: number): [number, number] {
  if (B.dho2 !== o) {
    B.dho2 = o;
    B.dhn = o.sg && o.sg.lh ? -1 : 1; // lefties start the dribble in the left hand
    B.dsw = 0;
    B.dcd = 0.4;
    B.dmv = 0;
    B.dsz = 0;
  }
  const base = () => -6 * B.dhn;
  const sw = (kind: number, dur: number) => {
    B.dswf = B.dsw > 0 ? B.dlat : base(); // start from wherever the ball is right now
    B.dhn = -B.dhn;
    B.dsw = dur;
    B.dswd = dur;
    B.dswk = kind;
    B.dcd = 0.75;
  };
  if (!PREDICT) {
    B.dcd = Math.max(0, (B.dcd || 0) - dt);
    // a new dribble move started this tick
    if (o.mvT > 0 && (B.dmv || 0) <= 0) {
      if (o.mvk === 3) sw(3, 0.26);
      else if (o.mvk === 2) sw(2, 0.34);
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
    else fwd = 6 - 1.5 * arc; // crossover: low and tight across the front
  }
  B.dlat = lat;
  return [lat, fwd];
}
const SORTP: Player[] = [];
export function bstep(dt: number) {
  const o = B.owner;
  if (o) {
    {
      // Dribbling: the ball sits out beside the dribbling hand, a little in front; crossovers, behind-the-backs and
      // spins carry it to the other hand along their own paths (see dribHand).
      const hold = heldBall(o),
        [lat, fwd] = hold ? HOLDP[hold] : o.mode === "i" && !o.postA ? dribHand(o, dt) : [0, 8],
        off = lat,
        fw = fwd,
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
    B.vz -= g * dt;
    B.vx *= 1 - 0.1 * dt;
    B.vy *= 1 - 0.1 * dt;
  }
  // a pass that died (rolling slowly on the floor, or stopped against a wall) is a loose ball: anyone can get it.
  // Without this, only its target could catch it and a dead pass in a corner froze the game.
  if (B.mode === "pass" && !PREDICT && (B.age > 3 || (B.age > 0.5 && B.z < 12 && Math.hypot(B.vx, B.vy) < 45))) {
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
          B.vx -= 1.55 * dot * nx;
          B.vy -= 1.55 * dot * ny;
          B.vz -= 1.55 * dot * nz;
          B.vx *= 0.93;
          B.vy *= 0.93;
          snd(300, 0.06, "triangle");
        }
      }
    }
    const bx = b ? 900 : 40;
    if (!RA && (b ? B.x > bx - BR && B.x < bx + 6 : B.x < bx + BR && B.x > bx - 6) && Math.abs(B.y - HY) < 30 && B.z > 93 && B.z < 136) {
      B.x = b ? bx - BR : bx + BR;
      B.vx = -B.vx * 0.6;
      snd(200, 0.05, "square");
    }
    if (B.sh && B.z >= 100 && d < RR + 2) B.abv = b; // was above this rim
    if (B.sh && d < 20) B.rim = Math.min(B.rim ?? 99, Math.hypot(d - RR, B.z - 100)); // closest approach to the iron
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
      }
      B.sh = 0;
      fin = 0;
    }
    if (B.sc && B.z > 60 && B.z < 100 && d < RR + 3) {
      // the net grabs the ball: horizontal motion dies, the drop slows, then it falls out the bottom
      B.vx *= 0.86;
      B.vy *= 0.86;
      if (B.z > 82) B.vz *= 0.975;
    }
  }
  if (!RA && B.z < BR) {
    B.z = BR;
    if (Math.abs(B.vz) > 60) snd(110, 0.05, "sine", 0.1);
    B.vz *= -0.72;
    B.vx *= 0.9;
    B.vy *= 0.9;
    if (Math.abs(B.vz) < 25) B.vz = 0;
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
  if (cfg.VIOL && !PREDICT && !B.owner && (B.mode === "air" || B.mode === "pass") && (B.x < 6 || B.x > CW - 6 || B.y < 6 || B.y > CH - 6) && B.last && !ftq && !JB && rs <= 0 && inb <= 0 && S === "play" && gameLike() && !B.sc) {
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
  // Cylinder rule: nobody may touch a live shot in the imaginary cylinder above either rim (no goaltending / basket
  // interference), so a green that rattles or drops in can't be snatched out of the net by a jumping rebounder.
  if (B.sh && B.mode === "air" && B.z > 55 && (Math.hypot(B.x - HXs[0], B.y - HY) < 22 || Math.hypot(B.x - HXs[1], B.y - HY) < 22)) {
    // goaltending: a defender who swats it on the way down above the rim gives up the basket
    if (cfg.VIOL && !PREDICT && B.last && !B.ft && B.vz < 0 && B.z > 101 && !B.gt) {
      const hx = hoop(B.last.tm);
      for (const p of P)
        if (p.tm !== B.last.tm && p.z > 10 && Math.hypot(p.x - B.x, p.y - B.y) < 13 && B.z < p.z + 68 + p.j * 0.2 && Math.hypot(B.x - hx, B.y - HY) < 22 && (isH(p) || (!B.gtc && ((B.gtc = 1), Math.random() < 0.05)))) {
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
  // Contest for the loose ball: jumpers and defenders first, with some randomness.
  SORTP.length = 0;
  for (const p of P) {
    SORTP.push(p);
    // (+ the defense has inside position on a missed shot, more so when it boxed out: NBA ORB% ~24)
    p._ks = p.j + p.d * 0.3 + (p.z > 5 ? 25 : 0) + Math.random() * 40 + (hasB(p, "GC") ? 18 : 0) + (B.sh && B.last && p.tm !== B.last.tm ? 9 + ((p.boxT || 0) > 0 ? 8 : 0) : 0);
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
    if (d < (rc ? 26 : 12) && B.z > p.z + (rc ? -8 : 2) && B.z < p.z + 68 + p.j * 0.2 + (rc && B.ptype === 2 ? 55 : 0)) {
      if (B.mode === "pass" && p !== B.to) continue;
      if (B.mode === "air" && B.age < 0.5 && (B.vz > 0 || p.tm === B.last.tm)) continue;
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
        if (hasB(p, "GC") && Math.random() < 0.3) cm("board", p.n);
      }
      if (B.sh && B.last && !B.sc) B.last.heat = Math.max(-2, (B.last.heat || 0) - 1);
      // a rebound in traffic is chinned: both hands, ball under the chin, elbows out, until he lands and looks up
      if (B.sh && !B.ft && !PREDICT && p.mode === "i") p.chinT = p.z > 6 ? 0.45 + p.z / 200 : 0.35;
      B.owner = p;
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
    rplStep(dt);
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
      return;
    }
    const c = ctrlOf(k);
    if (c) p.in = rs > 0 ? zin(k) : c.inp;
    else ai(p, dt);
  });
  // Rebound/loose-ball assist for idle humans.
  for (const c of CT) {
    const h = c.inp;
    if (rs <= 0 && !B.owner && !ftq && inb <= 0 && (B.mode !== "pass" || B.to === P[c.idx])) {
      const q = P[c.idx];
      if (!h.dx && !h.dy && !h.sd && q.mode === "i") {
        q.in = zin(c.idx);
        loose(q, q.tm);
      } else if (q.mode === "i" && B.mode === "air" && Math.hypot(B.x - q.x, B.y - q.y) < 150) {
        const a = { dx: 0, dy: 0 } as Input,
          sv = q.in;
        q.in = a;
        loose(q, q.tm);
        q.in = sv;
        sv.dx = sv.dx * 0.4 + a.dx * 0.9;
        sv.dy = sv.dy * 0.4 + a.dy * 0.9;
        if (a.sd || (q.z <= 0 && B.z > 45 && Math.hypot(B.x - q.x, B.y - q.y) < 34)) sv.sd = 1;
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
  const n = cfg.HALF ? 0 : sh ? (th ? 3 : 2) : tf[d.tm] >= 5 ? 2 : 0;
  if (n) {
    startFT(o, n, flag ? o.tm : 0, 0);
    if (flag) ftq.keep = 1;
    if (!flag && tf[d.tm] === 5 && !sh) txt("BONUS", 480, 230, "#ffd23f");
  }
  else {
    B.owner = o;
    B.mode = "held";
    setup(o.tm);
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
  let m = 0;
  P.forEach((p) => {
    p.vx = p.vy = p.z = p.vz = 0;
    p.mode = "i";
    if (p !== s) {
      p.x = hx + d * (70 + (m >> 1) * 28);
      p.y = 250 + (m & 1 ? 46 : -46);
      p.f = fc0;
      m++;
    }
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
  if (f.fired && !B.sc && B.age > 1.3 && !B.owner) f.next = 0.3;
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
  // Curry-style shooters get pindowns/flares; otherwise pick-and-roll is the bread and butter
  const kind: Play["kind"] = pc === 1 ? "pnr" : pc === 2 ? "pin" : pc === 3 ? "flare" : sh.c >= 82 && sh !== big && r < 0.5 ? (r < 0.3 ? "pin" : "flare") : "pnr";
  const scr = kind === "pnr" ? big : ms.filter((q) => q !== sh).sort((a, b) => b.ht * b.bk - a.ht * a.bk)[0],
    use = kind === "pnr" ? h : sh;
  return { kind, t0: T, scr, use, def: manOf(use), ph: "go", sx: 0, sy: 0, setAt: 0 };
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
      return true;
    }
  }
  const iso = isoNow(t);
  let pl = iso ? null : PLAY[t];
  if (!iso && (!pl || T - pl.t0 > 5.5 || pl.use.tm !== t || (pl.kind === "pnr" && pl.use !== h) || pl.scr === h)) pl = PLAY[t] = newPlay(t);
  if (iso) PLAY[t] = null;
  OFFS[t] = null;
  if (!pl && !iso) return false;
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
    } else if (pl.kind === "pin") {
      pl.sx = hx + dir * 120;
      pl.sy = HY + side * 70;
    } else {
      pl.sx = hx + dir * 175;
      pl.sy = HY - side * 40;
    }
  }
  if (p === scr) {
    if (pl.ph === "go") {
      if (T - pl.t0 < 0.05 && isH(h) && TS.pc[t]) txtW(PCN[TS.pc[t]], p.x, p.y, 95, "#9fe7ff");
      mv(p, pl.sx, pl.sy, 1.2);
      if (Math.hypot(p.x - pl.sx, p.y - pl.sy) < 7 || T - pl.t0 > 2.6) {
        pl.ph = "set";
        pl.setAt = T;
      }
    } else if (pl.ph === "set") {
      p.in.dx = p.in.dy = 0; // planted
      p.vx *= 0.5;
      p.vy *= 0.5;
      p.setT = 0.25;
      if (T - pl.setAt > (pl.kind === "pnr" ? 1.25 : 1.5)) pl.ph = "out";
    } else {
      // roll hard to the rim, or pop to the arc if he can shoot
      const pop = scr.c >= 80 && scr.i < 85,
        g = pop ? [hx + dir * 225, HY + side * -60] : [hx + dir * 30, HY + side * 14];
      mv(p, g[0], g[1], 1.2);
      if (!pop && Math.hypot(p.x - hx, p.y - HY) < 90 && Math.hypot(manOf(p).x - p.x, manOf(p).y - p.y) > 30) OFFS[t] = p;
      if (pop && Math.hypot(manOf(p).x - p.x, manOf(p).y - p.y) > 40) OFFS[t] = p;
    }
    return true;
  }
  if (p === use && pl.kind !== "pnr") {
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
  // spacing + backdoor cuts for everyone else
  const ms = P.filter((q) => q.tm === t && q !== h && q !== scr && q !== use),
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
  const pick = (q: Player) => {
    let b = 0,
      bd = 1e9;
    spots.forEach((sp, j) => {
      if (used.has(j)) return;
      // (stay out of the driver's way: a spot where the ball handler is heading is taken last - drift on the drive)
      const bx = h ? h.x + h.vx * 0.5 : B.x,
        by = h ? h.y + h.vy * 0.5 : B.y,
        d = Math.hypot(sp[0] - q.x, sp[1] - q.y) + (Math.hypot(sp[0] - B.x, sp[1] - B.y) < 90 || Math.hypot(sp[0] - bx, sp[1] - by) < 120 ? 400 : 0);
      if (d < bd) (bd = d), (b = j);
    });
    used.add(b);
    return spots[b];
  };
  let spot = spots[0];
  for (const q of ms) {
    const sp = pick(q);
    if (q === p) spot = sp;
  }
  const md = manOf(p),
    deny = Math.hypot(md.x - p.x, md.y - p.y) < 20 && Math.hypot(md.x - hx, md.y - HY) > Math.hypot(p.x - hx, p.y - HY) - 5;
  if (deny && !iso && Math.random() < 0.02) p.ai.cutT = T;
  if (p.ai.cutT && T - p.ai.cutT < 1.1) {
    mv(p, hx + dir * 25, HY + (p.y < HY ? -18 : 18), 1.25); // backdoor
    if (Math.hypot(md.x - p.x, md.y - p.y) > 26) OFFS[t] = p;
  } else mv(p, spot[0] + Math.sin(T * 0.8 + p.k) * 10, spot[1], 0.95);
  return true;
}
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
    c *= (1.2 - o.d / 220) * 0.42; // (x.42: calibrated to NBA free-throw rate, ~0.22 FTA per possession)
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
      const c2 = (1 - d / 60) * (oz > 8 ? 1.5 : o.hupT > 0 ? 1.2 : 1) * (hasB(o, "LD") ? 1.15 : 1);
      if (c2 > ct) {
        ct = c2;
        o2 = o;
      }
    }
  }
  return [ct, o2];
}
export function contestOf(p: Player): [number, Player | null] {
  const [ct, o2] = contestRaw(p);
  return [Math.min(1, ct * (p.sbw > 0 ? 0.25 : 1)), o2];
}
function collide() {
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
        const nx = dx / d,
          ny = dy / d,
          mA = A.bk * A.ht * (A.setT > 0 ? 3 : A.postA ? 1.7 : 1),
          mC = C.bk * C.ht * (C.setT > 0 ? 3 : C.postA ? 1.7 : 1),
          rv = (A.vx - C.vx) * nx + (A.vy - C.vy) * ny,
          ov = dm - d;
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
              }
            }
          }
        A.x += (nx * ov * mC) / (mA + mC);
        A.y += (ny * ov * mC) / (mA + mC);
        C.x -= (nx * ov * mA) / (mA + mC);
        C.y -= (ny * ov * mA) / (mA + mC);
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
            const h = B.owner;
            if (hit > 170 && fc <= 0 && rs <= 0 && !ftq && inb <= 0 && h && (A === h || C === h) && cfg.FOULS) {
              const o = A === h ? C : A;
              fc = 2;
              if (o.tm !== h.tm) {
                const sh = h.mode === "c" || h.mode === "s";
                if (Math.hypot(o.vx, o.vy) < 70 && Math.hypot(h.vx, h.vy) > 170 && Math.random() < 0.5) {
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
                } else if (Math.random() < (sh ? 0.2 : 0.05) * (hit > 240 ? 1.6 : 1)) foul(o, h, sh ? "SHOOTING" : "BLOCKING", sh ? 1 : 0, 0); // (blocking: calibrated to NBA personal-foul rates)
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
    [6.2, 92.8],
    [5.5, 89.4],
    [4.9, 86.2],
    [4.5, 83.2],
  ];
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
  const L = (a: any, b: any, k: number, draw = 1) => c.push([a, b, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z), k, draw]);
  for (let r = 1; r < NR.length; r++)
    for (let k = 0; k < NS; k++) {
      const o = r % 2 ? 0 : -1; // odd rings sit between the knots of the ring above
      L(gr[r][k], gr[r - 1][(k + o + NS) % NS], 1);
      L(gr[r][k], gr[r - 1][(k + o + 1) % NS], 1);
    }
  for (let k = 0; k < NS; k++) L(gr[NR.length - 1][k], gr[NR.length - 1][(k + 1) % NS], 0.6); // bottom hem
  for (let r = 1; r < NR.length - 1; r++) for (let k = 0; k < NS; k++) L(gr[r][k], gr[r][(k + 1) % NS], 0.18, 0); // soft hoop ties
  return { p, c, hx, quiet: 0, ring: 0 };
});
const SEGR = BR + 0.45;
/** Cloth net: verlet knots on nylon ropes (stretch-resistant, slack in compression), real gravity, sub-stepped while
 *  the ball is inside so a fast swish can't tunnel. Two-way: the strands the ball pushes push back (the net grabs and
 *  slows a swish, so it drops out the bottom), and a ball ringing off the iron shakes the whole mesh. */
export function netSim(dt: number) {
  for (const N of NETS) {
    const dxy = Math.hypot(B.x - N.hx, B.y - HY),
      near = dxy < 20 && B.z > 70 && B.z < 112 && !B.owner;
    if (!near && N.quiet > 90) continue; // fully settled and nothing touching it
    N.quiet = near ? 0 : N.quiet + 1;
    // rim hit: the iron vibrates and jerks the loops hanging off it
    const rd = Math.hypot(dxy - RR, B.z - 100),
      bs = Math.hypot(B.vx, B.vy, B.vz);
    if (near && rd < BR + 1.2 && bs > 60 && (N.ring || 0) <= 0) {
      N.ring = 0.12;
      const kick = Math.min(1.6, bs * 0.004);
      for (const q of N.p) if (!q.f && q.z > 93) (q.px -= (Math.random() - 0.5) * kick), (q.py -= (Math.random() - 0.5) * kick), (q.pz += kick * 0.6);
    }
    if (N.ring > 0) N.ring -= dt;
    const SUB = near && bs > 150 ? 2 : 1,
      h = dt / SUB;
    let rx = 0,
      ry = 0,
      rz = 0;
    for (let sub = 0; sub < SUB; sub++) {
      // ball position at this sub-step (it already moved this tick)
      const lag = (SUB - 1 - sub) * h,
        bx = B.x - B.vx * lag,
        by = B.y - B.vy * lag,
        bz = B.z - B.vz * lag;
      const damp = Math.pow(0.965, SUB === 1 ? 1 : 0.5);
      for (const q of N.p) {
        if (q.f) continue;
        const vx = (q.x - q.px) * damp,
          vy = (q.y - q.py) * damp,
          vz = (q.z - q.pz) * damp;
        q.px = q.x;
        q.py = q.y;
        q.pz = q.z;
        q.x += vx;
        q.y += vy;
        q.z += vz - g * h * h;
      }
      for (let it = 0; it < 7; it++) {
        for (const c of N.c) {
          const a = c[0],
            b = c[1],
            dx = b.x - a.x,
            dy = b.y - a.y,
            dz = b.z - a.z,
            d = Math.hypot(dx, dy, dz) || 1;
          // strings resist stretching fully but compress freely (rope, not rods)
          if (d < c[2] && c[3] >= 1) continue;
          const f = ((d - c[2]) / d) * 0.5 * c[3];
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
        if (near)
          for (const c of N.c) {
            if (!c[4]) continue;
            const a = c[0],
              b = c[1],
              sx = b.x - a.x,
              sy = b.y - a.y,
              sz = b.z - a.z,
              l2 = sx * sx + sy * sy + sz * sz || 1,
              t = clamp(((bx - a.x) * sx + (by - a.y) * sy + (bz - a.z) * sz) / l2, 0, 1),
              cx = a.x + sx * t - bx,
              cy = a.y + sy * t - by,
              cz = a.z + sz * t - bz,
              d = Math.hypot(cx, cy, cz);
            if (d < SEGR && d > 0) {
              const push = (SEGR - d) / d;
              for (const [q, w] of [
                [a, 1 - t],
                [b, t],
              ] as [any, number][]) {
                if (q.f) continue;
                const mx = cx * push * w,
                  my = cy * push * w,
                  mz = cz * push * w + (B.vz < 0 ? B.vz * h * 0.06 * w : 0); // drag the mesh down with a falling ball
                q.x += mx;
                q.y += my;
                q.z += mz;
                if (it === 6 && bz < 99) (rx += mx), (ry += my), (rz += mz);
              }
            }
          }
      }
    }
    // reaction on the ball (below the rim only: rim rolls and makes are decided by the iron, not the nylon)
    if (near && B.z < 99 && (rx || ry || rz)) {
      const K = 1.4 / dt,
        cap = 60;
      B.vx -= clamp(rx * K, -cap, cap);
      B.vy -= clamp(ry * K, -cap, cap);
      B.vz -= clamp(rz * K, -cap, cap);
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
    REC[b + 3] = p.f;
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
