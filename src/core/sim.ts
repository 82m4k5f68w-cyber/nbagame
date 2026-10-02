// Hoops 2K27 shared simulation core. DOM-free: runs in the browser (every mode) and in Node (tests, servers).
// Ported from the four near-identical mode copies; NP (players per team) and the physics backend are flags.
// Game coordinates: x 0..940, y 0..500 (10 px = 1 ft), z up (rim z=100). Team 0 attacks the RIGHT hoop.
import { TM, SP, SIG, OV, ov2, type Tuple } from "./data";
import { pose3, handPos } from "./pose";
import { RAP, rapStep, rapSyncPlayers } from "./physics";

export const CW = 940,
  CH = 500,
  g = 320,
  HXs = [52.5, 887.5],
  HY = 250,
  RR = 7.5,
  BR = 3.9;
export const hoop = (t: number) => (t ? HXs[0] : HXs[1]),
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
  physics: "rapier" as "rapier" | "legacy",
  hand: true, // release from the rig's real hand (3D) instead of a fixed height (2D legacy)
  replays: true,
  MYM: 0,
  playerBodies: true, // Rapier kinematic player capsules (ball can deflect off bodies)
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

// ---- setters for the shell (ES module bindings are read-only outside) ----
export const setInb = (v: number) => (inb = v);
export const setRs = (v: number) => (rs = v);
export const setClock = (v: number) => (clock = v);
export const setShot = (v: number) => (shot = v);
export const setT = (v: number) => (T = v);
export const setS = (v: string) => (S = v);
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
  cfg.NP > 1 ? [TM[i][1], TM[i][2], TM[i][0]] : [TM[ALL[i].t][1], [ALL[i].a], ALL[i].a[0]];
let SEL = 0;
function RS(ti: number, t: number): [string, Tuple[], string] {
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
  SEL = o.sel ?? i;
  let j = o.j;
  if (j == null)
    do j = (Math.random() * nChoices()) | 0;
    while (j === i);
  P = [];
  [i, j].forEach((ti, t) =>
    RS(ti, t)[1].forEach((a, k) =>
      P.push({
        n: a[0], c: a[1], i: a[2], s: a[3], d: a[4], j: a[5], st: a[6], tm: t, k,
        col: t && RS(ti, t)[0] === RS(i, 0)[0] ? "#b03a2e" : RS(ti, t)[0],
        skin: a[7], x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, f: 0, ph: 0, mode: "i", t: 0, cd: 0, rl: 0, mt: 0,
        ai: {}, in: { dx: 0, dy: 0 },
        stt: { pts: 0, reb: 0, ast: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, blk: 0 },
        my: a === MYP.t, sg: SIG[a[0]] || {}, slow: 0, sbw: 0, sv: 0, tp: null, pf: 0, bn: 1, bx: 0, by: 0,
        hr: a[8], bd: a[9], ht: a[10], bk: a[11], no: a[12],
      }),
    ),
  );
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
  B = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, owner: null, mode: "held", sh: 0, sc: 0, last: null, age: 0, to: null, three: 0, a: 0 };
  CT.forEach((c, k) => {
    c.fixed = !!cfg.MYM && k === 0 && c.tm === 0;
    c.idx = c.tm * NP;
    c.lastO = null;
  });
  setup(0);
  S = "play";
  snd(500, 0.2, "square");
  return j;
}
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
  pos = off;
  shot = 24;
  PCNT[0] = PCNT[1] = 0;
  for (const c of CT) {
    if (c.fixed) c.idx = c.tm * NP;
    else c.idx = off !== c.tm ? nearestFree(c, B.owner.x, B.owner.y) : c.tm * NP;
    c.lastO = null;
  }
  inb = 1.2;
  txt("INBOUND", 480, 230);
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
    if (ftq.i + 1 >= ftq.n && !ftq.tech) ftq = null;
  } else B.ft = 0;
  let b = D0 < 90 || p.hk ? (p.i / 100) * (p.hk ? 0.72 : 0.8) : D0 < 237 ? ((p.c * 0.5 + p.i * 0.5) / 100) * 0.58 : (p.c / 100) * 0.5;
  let ct = 0,
    blk = null;
  {
    const [c0, o0] = contestRaw(p);
    ct = c0;
    blk = o0;
  }
  b -= Math.min(1, ct * (p.sbw > 0 ? 0.25 : 1)) * 0.3;
  if (p.sbw > 0) b += 0.06;
  const cx = hum && p.cw != null ? p.cw : Math.min(1, ct * (p.sbw > 0 ? 0.25 : 1) + (p.bmp || 0) * 0.5),
    rat = shotRat(p, D0, isFT),
    win = (0.07 + (rat / 100) * 0.05) * (1 - 0.45 * cx) * (0.85 + 0.15 * (p.en == null ? 1 : p.en)),
    rT = lay ? 0.28 : p.st === 1 ? 0.3 : 0.4;
  let gr;
  if (hum && cx > 0.45 && !lay) txtW("CONTESTED", p.x, p.y, 108, "#ff6b6b");
  if (hum) {
    const wt = win * (TEMPO ? 1.2 : 1),
      wmt = (0.07 + (rat / 100) * 0.05) * (TEMPO ? 1.2 : 1),
      cen = (TEMPO ? rT : p.st === 1 ? 0.45 : 0.6) + (wmt - wt);
    {
      const tt = TEMPO ? (p.tp == null ? 9 : p.tp) : p.mt;
      gr = tt >= cen - wt && tt <= cen + wt + 0.03;
    }
    if (!gr && !lay)
      txtW(TEMPO && p.tp == null ? "NO TEMPO" : (TEMPO ? p.tp > cen : p.mt > cen) ? "LATE" : "EARLY", p.x, p.y, 95, "#ff9966");
  } else gr = Math.random() < clamp((rat / 100) * 0.75 + 0.1 - cx * 0.45 + (p.sbw > 0 ? 0.1 : 0), 0.05, 0.95);
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
  B.dk = 0;
  B.gn = 0;
  B.wv = [0, 0, 0];
  if (p.sv === 6 && Math.random() < 0.9) {
    B.dk = 1;
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
  if (blk && blk.z > 10 && Math.hypot(blk.x - p.x, blk.y - p.y) < 24 && Math.random() < 0.08 + (ct * 0.3 * blk.d) / 100) {
    B.vx = (p.x - blk.x) * 8 + (Math.random() - 0.5) * 80;
    B.vy = (Math.random() - 0.5) * 120;
    B.vz = 60;
    B.sh = 0;
    blk.stt.blk++;
    exc(0.9);
    txtW("BLOCKED!", blk.x, blk.y, 80, "#ff6b4a");
    snd(150, 0.15, "square");
    if (Math.random() < 0.12) tech(blk, p.tm);
    return;
  }
  const rap = useRap(),
    mk = lay ? Math.random() < clamp(b + (gr ? 0.15 : 0), 0.03, 0.97) : gr && Math.random() < 0.98 - cx * 0.25,
    a = Math.random() * 6.28,
    off = mk ? (rap ? 0.3 : 1.2) : 9 + Math.random() * 7,
    tx = hx + Math.cos(a) * off,
    ty = HY + Math.sin(a) * off,
    dx = tx - x0,
    dy = ty - y0,
    D = Math.hypot(dx, dy) || 1,
    dz = 100 - z0;
  const fd = !lay && !isFT && blk && Math.hypot(blk.x - p.x, blk.y - p.y) < 24 && blk.z > 3 && Math.random() < 0.1 ? blk : null;
  if (fd && !mk) {
    B.owner = p;
    B.mode = "held";
    B.sh = 0;
    foul(fd, p, "SHOOTING", 1, three);
    return;
  }
  if (fd) B.fl = 1;
  let th = D < 90 ? 1.15 : D < 200 ? 1.0 : D < 300 ? 0.92 : D < 400 ? 1.02 : 1.1;
  for (let k = 0; k < 8 && D * Math.tan(th) - dz < 8 && th < 1.45; k++) th += 0.08;
  let ge = g,
    v = Math.sqrt((ge * D * D) / (2 * Math.cos(th) ** 2 * Math.max(1, D * Math.tan(th) - dz)));
  if (rap) {
    ge = g - 0.0032 * 16 * v * Math.cos(th);
    v = Math.sqrt((ge * D * D) / (2 * Math.cos(th) ** 2 * Math.max(1, D * Math.tan(th) - dz)));
  }
  B.vz = v * Math.sin(th);
  const TF = (B.vz + Math.sqrt(B.vz * B.vz + 2 * ge * (z0 - 100))) / ge,
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
        T2 = 0;
      const W = B.wv;
      while (T2 < 4) {
        vx *= 1 - 0.0004;
        vy *= 1 - 0.0004;
        vz += (0.0032 * (W[0] * vy - W[1] * vx) - g) * 0.004;
        const qz = z;
        x += vx * 0.004;
        y += vy * 0.004;
        z += vz * 0.004;
        T2 += 0.004;
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
  {
    const sv2 = Math.hypot(p.vx, p.vy);
    p.en = Math.max(0, Math.min(1, (p.en == null ? 1 : p.en) - (i.sp && sv2 > 150 ? dt * 0.1 : -dt * 0.04)));
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
      if (i.mv === 1) {
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
      } else {
        p.mvk = 4;
        p.mvT = 0.4;
        p.mvE = 0;
        p.mvS = S;
        p.cd = 0.9;
        if (u) txtW("DROP STEP", p.x, p.y, 100, "#ffd23f");
      }
    } else {
      p.mvk = i.mv;
      p.mvT = 0.5;
      p.mvE = 0;
      p.mvS = S;
      p.cd = 0.9;
      if (u) txtW(["", "HESITATION", "SPIN MOVE", "BEHIND THE BACK"][i.mv], p.x, p.y, 100, "#ffd23f");
      if (!PREDICT && dist < 60 && Math.random() < 0.5 + (p.s - d.d) / 250) {
        d.slow = Math.max(d.slow, 0.7);
        d.scr = Math.max(d.scr || 0, 0.35);
        if (u) txtW("ANKLE BREAKER!", d.x, d.y, 95, "#ff6b6b");
      }
    }
  }

  if (p.mode === "i" && i.sb && has && pos === p.tm && p.cd <= 0 && D > 60) {
    p.mode = "b";
    p.t = 0;
    p.bn = p.st === 1 ? 2 : 1;
    p.cd = 1.6;
    p.bx = -ux / D;
    p.by = -uy / D;
    if (!PREDICT) P[nearest(1 - p.tm, p.x, p.y)].slow = 0.5 + 0.25 * p.bn;
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
      } else if (!has && p.z <= 0) p.vz = 126 + p.j * 0.9;
    }
    if (has && (i.pass || i.e || i.lob)) {
      const r = i.pass || pick(p, i);
      if (r && !PREDICT) pass(p, r, i.lob ? 2 : undefined);
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
      p.mode = "s";
      p.t = 0;
      p.rl = 0;
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
    if (!p.rl && has && !PREDICT && p.t >= (D < 90 ? 0.28 : p.st === 1 ? 0.3 : 0.4)) launch(p);
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
        ac = (brk ? 1100 : 620 + p.s * 3) * (p.mvT > 0 ? 2.6 : 1) * dt,
        mm = Math.min(dl, ac);
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
  p.ph += sv * dt * 0.09;
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
  if (p.z > 0 || p.vz > 0) {
    p.vz -= g * dt;
    p.z += p.vz * dt;
    if (p.z <= 0) {
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
    if (p.cd <= 0 && D0 > 150 && Math.hypot(dn.x - p.x, dn.y - p.y) < 38 && (p.st === 1 || p.st === 3) && Math.random() < dt * 2) i.sb = 1;
    if (p.sbw > 0 && D0 > 120) {
      i.sd = 1;
      a.rel = (p.st === 1 ? 0.45 : 0.6) + (Math.random() - 0.5) * 0.16;
      a.r = 0;
      return;
    }
    const D = Math.hypot(oh - p.x, HY - p.y);
    if (!a.r)
      ((a.r =
        p.c < 50
          ? 55 + Math.random() * 40
          : p.c >= 86 && Math.random() < 0.65
            ? 245
            : p.i >= 90 && Math.random() < 0.5
              ? 70 + Math.random() * 60
              : 100 + Math.random() * 130),
        (a.w = 0),
        (a.pt = 0.8));
    if (D > a.r) mv(p, oh, HY + Math.sin(T * 1.5 + p.k) * 90, 1);
    else {
      a.w += dt;
      i.sp = 0;
      if (a.w > 0.45 && (Math.hypot(dn.x - p.x, dn.y - p.y) > 30 || shot < 7 || a.w > 1.3)) {
        i.sd = 1;
        a.rel = (p.st === 1 ? 0.45 : 0.6) + (Math.random() - 0.5) * 0.16;
        a.r = 0;
      }
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
          return (Math.min(od, 80) / 80) * 0.6 + (ql(r, dd) / 100) * 0.5 + (dd < D ? 0.12 : 0) + (OFFS[t] === r ? 0.45 : 0) + (r.my || isH(r) ? 0.2 : 0);
        };
      const own = (Math.min(Math.hypot(dn.x - p.x, dn.y - p.y), 80) / 80) * 0.6 + (ql(p, D) / 100) * 0.5;
      let bo = null,
        bv = own + 0.12;
      for (const r of P)
        if (r.tm === t && r !== p) {
          const v = val(r);
          if (v > bv) {
            bv = v;
            bo = r;
          }
        }
      const prs = Math.hypot(dn.x - p.x, dn.y - p.y) < 40;
      if (
        bo &&
        PCNT[t] < 3 &&
        T - LASTP[t] > 1.1 &&
        Math.hypot(bo.x - p.x, bo.y - p.y) < 280 &&
        (Math.abs(hoop(t) - bo.x) < Math.abs(hoop(t) - p.x) + 40 || prs) &&
        Math.random() < (prs ? 0.8 : 0.5)
      )
        i.pass = bo;
    }
    if (p.cd <= 0 && p.s >= 72 && Math.hypot(dn.x - p.x, dn.y - p.y) < 55 && Math.random() < dt * 1.4) i.mv = 1 + ((Math.random() * 3) | 0);
  } else if (pos === t && B.mode !== "held" && B.to === p) mv(p, B.x + B.vx * 0.2, B.y + B.vy * 0.2, 1);
  else if (pos === t && B.owner) {
    if (offBall(p, t)) return;
    const s = SP[p.k],
      x = t ? 52.5 + s[0] : 887.5 - s[0];
    const nd = P[nearest(1 - t, p.x, p.y)];
    mv(p, x + (p.x - nd.x) * 0.35, s[1] + Math.sin(T + p.k * 2) * 18 + (p.y - nd.y) * 0.3, 0.95);
  } else if (B.owner) {
    const o = p.manT > 0 && p.man != null ? P[p.man] : P[(1 - t) * NP + p.k],
      ou = B.owner === o ? 22 : 26,
      l = Math.hypot(dh - o.x, HY - o.y) || 1;
    const hb = B.owner,
      hh = Math.hypot(dh - hb.x, HY - hb.y);
    if (hh < 140 && p.k !== hb.k && nearest(t, hb.x, hb.y, t * NP + hb.k) === t * NP + p.k)
      mv(p, hb.x + (dh - hb.x) * 0.35, hb.y + (HY - hb.y) * 0.35, 1.1);
    else {
      let tx = o.x + ((dh - o.x) / l) * ou,
        ty = o.y + ((HY - o.y) / l) * ou;
      if (dh > 470 ? B.x < 470 : B.x > 470) tx = dh > 470 ? Math.max(tx, 455) : Math.min(tx, 485);
      mv(p, tx, ty, 0.92);
    }
    if (Math.hypot(o.x - p.x, o.y - p.y) < 42 && (o.mode === "c" || o.mode === "s") && p.z <= 0 && !a.j) i.sd = a.j = 1;
    if (o.mode === "i") a.j = 0;
    if ((dh > 470 ? B.x >= 470 : B.x <= 470) && B.owner === o && Math.hypot(o.x - p.x, o.y - p.y) < 22 && Math.random() < dt * 0.7) i.e = 1;
  } else {
    loose(p, t);
  }
}

/** Live-ball height while dribbling: a real bounce between hand and floor. */
function dz(o: Player, dt: number) {
  if (B.dh == null) {
    B.dh = 30;
    B.dvv = 0;
  }
  const sp = Math.hypot(o.vx, o.vy);
  B.dvv -= g * dt;
  B.dh += B.dvv * dt;
  const top = o.z + 34 + Math.min(8, sp * 0.03);
  if (B.dh > top) {
    B.dh = top;
    B.dvv = -(150 + sp * 0.25);
  }
  if (B.dh < 4) {
    B.dh = 4;
    B.dvv = Math.abs(B.dvv) * 0.88;
  }
  return B.dh;
}
const SORTP: Player[] = [];
export function bstep(dt: number) {
  const o = B.owner;
  if (o) {
    {
      const off = o.mvT > 0 ? Math.sin((o.mvE || 0) * 14) * 7 : 0,
        tx = o.x + Math.cos(o.f) * 8 - Math.sin(o.f) * off,
        ty = o.y + Math.sin(o.f) * 5 + Math.cos(o.f) * off;
      if (cfg.PRO && o.mode === "i" && B.hold === o && !PREDICT) {
        // Dribble physics: the ball has momentum; the hand pulls it with a stiff, critically damped spring,
        // so crossovers and hard cuts swing it across the body instead of teleporting.
        const k = 900,
          c = 2 * Math.sqrt(k);
        B.dvx = (B.dvx || 0) + ((tx - B.x) * k - (B.dvx || 0) * c) * dt;
        B.dvy = (B.dvy || 0) + ((ty - B.y) * k - (B.dvy || 0) * c) * dt;
        B.x += B.dvx * dt;
        B.y += B.dvy * dt;
        if (Math.hypot(tx - B.x, ty - B.y) > 14) (B.x = tx), (B.y = ty);
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
          : cfg.PRO
            ? dz(o, dt)
            : 6 + Math.abs(Math.sin(T * 8 + o.k)) * 30;
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
    if (pz >= 100 && B.z < 100 && B.vz < 0 && d < RR - 1.2 && B.sh && !B.sc) {
      B.sc = 1;
      const t = b ? 0 : 1,
        pts = B.ft ? 1 : B.three && B.last.tm === t ? 3 : 2;
      sc[t] += pts;
      exc(1);
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
        if (B.last.heat === 3) txtW("ON FIRE!", B.last.x, B.last.y, 105, "#ff9a2e");
      }
      txtW("+" + pts, hx > 470 ? hx - 50 : hx + 20, HY, 125, pts === 3 ? "#ffd23f" : "#fff");
      snd(900, 0.25, "sine", 0.1);
      if (ftq) ftq.next = 1.3;
      else if (B.fl) startFT(B.last, 1);
      else {
        rs = 1.4;
        pend = 1 - t;
        if (cfg.replays && (B.dk || (B.gn && B.three && isH(B.last)))) RQ = 1;
      }
      B.sh = 0;
      fin = 0;
    }
    if (B.sc && B.z > 60 && B.z < 100 && d < RR + 3) {
      B.vx *= 0.9;
      B.vy *= 0.9;
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
  if (!RA) {
    if (B.x < 6 || B.x > CW - 6) {
      B.x = clamp(B.x, 6, CW - 6);
      B.vx *= -0.5;
    }
    if (B.y < 6 || B.y > CH - 6) {
      B.y = clamp(B.y, 6, CH - 6);
      B.vy *= -0.5;
    }
  }
  if (B.sc) return;
  if (ftq) return;
  if (B.sh && B.vz < 0 && B.z > 88 && B.z < 135 && (Math.hypot(B.x - HXs[0], B.y - HY) < 14 || Math.hypot(B.x - HXs[1], B.y - HY) < 14)) return;
  // Contest for the loose ball: jumpers and defenders first, with some randomness.
  SORTP.length = 0;
  for (const p of P) {
    SORTP.push(p);
    p._ks = p.j + p.d * 0.3 + (p.z > 5 ? 25 : 0) + Math.random() * 40;
  }
  SORTP.sort((a, b) => b._ks - a._ks);
  for (const p of SORTP) {
    if ((p === B.last && B.age < 0.3) || p.mode === "s") continue;
    const d = Math.hypot(p.x - B.x, p.y - B.y);
    const rc = B.mode === "pass" && p === B.to;
    if (d < (rc ? 26 : 12) && B.z > p.z + (rc ? -8 : 2) && B.z < p.z + 68 + p.j * 0.2 + (rc && B.ptype === 2 ? 55 : 0)) {
      if (B.mode === "pass" && p !== B.to) continue;
      if (B.mode === "air" && B.age < 0.5 && (B.vz > 0 || p.tm === B.last.tm)) continue;
      if (B.sh && B.last && !B.sc) p.stt.reb++;
      if (B.sh && B.last && !B.sc) B.last.heat = Math.max(-2, (B.last.heat || 0) - 1);
      B.owner = p;
      B.mode = "held";
      B.sh = 0;
      B.to = null;
      if (p.tm !== pos) {
        pos = p.tm;
        shot = 24;
        PCNT[0] = PCNT[1] = 0;
      }
      snd(180, 0.05, "square");
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
  P.forEach((p, k) => {
    if (inb > 0 || (ftq && p !== ftq.s)) {
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
  ftIn(dt);
  if (inb > 0) {
    inb -= dt;
    if (inb <= 0 && B.owner && B.mode === "held") {
      const o = B.owner;
      if (NP > 1) {
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
  P.forEach((p) => step(p, dt));
  collide();
  if (useRap() && cfg.playerBodies) rapSyncPlayers(P, B);
  bstep(dt / 2);
  bstep(dt / 2);
  ftTick(dt);
  netSim(dt);
  recFrame();
  lagRec();
  for (const p of P) pose3(p);
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
  if (B.owner && !ftq && inb <= 0) shot -= dt;
  if (shot <= 0 && !ftq) {
    txt("SHOT CLOCK!", 470, 200, "#ff6b4a");
    setup(1 - pos);
  }
  if (clock <= 0 && !ftq && !(B.sh && !B.owner)) {
    if (q >= 4 && sc[0] !== sc[1]) endGame();
    else {
      q++;
      tf = [0, 0];
      clock = q > 4 ? QTRLEN / 2 : QTRLEN;
      setup(q % 2 ? 0 : 1);
      txt(q > 4 ? "OVERTIME" : "QUARTER " + q, 470, 200, "#ffd23f");
    }
  }
}
export function endGame() {
  S = "over";
  fx({ k: "end", w: sc[0] > sc[1] ? 0 : 1 });
  snd(sc[0] > sc[1] ? 800 : 200, 0.5, "triangle");
}
export function foul(d: Player, o: Player, k: string, sh: number, th: any) {
  tf[d.tm]++;
  d.pf++;
  txtW(k + " FOUL", d.x, d.y, 95, "#ff6b4a");
  snd(120, 0.3, "sawtooth", 0.1);
  B.sh = 0;
  B.ft = 0;
  const n = sh ? (th ? 3 : 2) : tf[d.tm] >= 5 ? 2 : 0;
  if (n) startFT(o, n, 0, 0);
  else {
    B.owner = o;
    B.mode = "held";
    setup(o.tm);
  }
}
function tech(d: Player, ret: number) {
  txtW("TECHNICAL FOUL", d.x, d.y, 95, "#ff3b3b");
  let b = null;
  for (const p of P) if (p.tm !== d.tm && (!b || p.c > b.c)) b = p;
  B.sh = 0;
  startFT(b, 1, ret, 1);
}
function startFT(s: Player, n: number, ret?: any, tech?: any) {
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
        if (f.tech) setup(f.ret);
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
const ACT = [
  { c: -1, done: 0 },
  { c: -1, done: 0 },
];
function offBall(p: Player, t: number) {
  const NP = cfg.NP,
    hx = hoop(t),
    dir = hx > 470 ? -1 : 1,
    tt = T + t * 1.7,
    ph = tt % 3.6,
    cyc = Math.floor(tt / 3.6),
    side = cyc % 2 ? 1 : -1,
    h = B.owner,
    ms = P.filter((q) => q.tm === t && q !== h),
    S = ACT[t];
  OFFS[t] = null;
  if (ms.length < 2) return false;
  if (S.c !== cyc) {
    S.c = cyc;
    S.done = 0;
  }
  const big = (a: Player, b: Player) => b.ht * b.bk - a.ht * a.bk,
    sh = ms.reduce((a, q) => (!a || q.c + 30 * ((q.sg && q.sg.off) || 0) > a.c + 30 * ((a.sg && a.sg.off) || 0) ? q : a), null);
  if (cyc % 2 === 0) {
    if (sh.c < 70) return false;
    const scr = ms.filter((q) => q !== sh).sort(big)[0],
      df = P[(1 - t) * NP + sh.k],
      post = [hx + dir * 130, HY + side * 85];
    if (ph < 1.9 && Math.hypot(scr.x - df.x, scr.y - df.y) < 40) {
      df.scr = Math.max(df.scr || 0, 0.6);
      scr.setT = 0.5;
    }
    if (ph > 1.7 && Math.hypot(sh.x - df.x, sh.y - df.y) > 38) OFFS[t] = sh;
    if (p === sh) {
      const g = ph < 0.9 ? [hx + dir * 60, HY - side * 150] : ph < 1.9 ? [post[0] + dir * 8, post[1] - side * 14] : [hx + dir * 215, HY + side * 125];
      mv(p, g[0], g[1], ph < 1.9 ? 1.2 : 0.9);
      return true;
    }
    if (p === scr) {
      if (ph < 1.9) mv(p, post[0] * 0.6 + df.x * 0.4, post[1] * 0.6 + df.y * 0.4, 1.1);
      else mv(p, hx + dir * 38, HY + side * 22, 1);
      return true;
    }
    return cut(p, t);
  }
  const sc0 = ms.filter((q) => q !== sh || ms.length < 3).sort(big)[0],
    d1 = P[(1 - t) * NP + h.k],
    dd = P[(1 - t) * NP + sc0.k],
    spot = [d1.x + (hx - d1.x) * 0.1, d1.y + (HY - d1.y) * 0.1];
  if (ph > 2 && Math.hypot(sc0.x - dd.x, sc0.y - dd.y) > 38) OFFS[t] = sc0;
  if (p !== sc0) {
    if (p.sg && p.sg.off >= 0.9) {
      const a = T * 1.1 + p.k;
      mv(p, hx + dir * (195 + 25 * Math.sin(a * 1.3)), HY + Math.sin(a) * 185, 1.1);
      return true;
    }
    return cut(p, t);
  }
  if (ph < 1.5) {
    mv(p, spot[0], spot[1], 1.15);
    if (Math.hypot(p.x - d1.x, p.y - d1.y) < 26) {
      p.setT = 0.5;
      d1.scr = Math.max(d1.scr || 0, 0.6);
    }
    return true;
  }
  if (!S.done) {
    S.done = 1;
    if (Math.random() < 0.45) {
      d1.man = t * NP + sc0.k;
      d1.manT = 2.5;
      dd.man = t * NP + h.k;
      dd.manT = 2.5;
      txtW("SWITCH", dd.x, dd.y, 95, "#9ad");
    }
  }
  const roll = sc0.i >= 75 && sc0.c < 80,
    g = roll ? [hx + dir * 42, HY + side * 18] : [hx + dir * 215, HY + side * 105];
  mv(p, g[0], g[1], 1.05);
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
  if (fly) {
    if (rk < K2) mv(p, hx + dir * (26 + rk * 22), HY + (rk ? 36 : -8) * (p.k % 2 ? 1 : -1), 1.1);
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
    if (D < 50 && p.j >= 55) return 6;
    return c > 0.35 && sp > 60 ? 7 : 5;
  }
  if (p.sg && p.sg.cl) return 9;
  if (p.sbw > 0) return 3;
  if (fw > 110 && D > 110) return 8;
  if (p.st === 4) return 4;
  if (p.st === 2 || (c > 0.5 && p.st !== 1)) return 2;
  if (p.st === 3) return 3;
  return p.st === 1 ? 1 : 0;
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
      const c2 = (1 - d / 60) * (oz > 8 ? 1.5 : 1);
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
        C = P[b],
        dx = A.x - C.x,
        dy = A.y - C.y,
        d = Math.hypot(dx, dy);
      if (d < 16 && d > 0 && A.z < 8 && C.z < 8) {
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
          ov = 16 - d;
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
          if (hit > 150 && fc <= 0 && rs <= 0 && !ftq && inb <= 0) {
            const sx = A.setT > 0 ? A : C.setT > 0 ? C : null;
            if (sx) {
              const o = sx === A ? C : A;
              if (o.tm !== sx.tm && Math.hypot(sx.vx, sx.vy) > 110 && Math.random() < 0.35) {
                fc = 2;
                txtW("ILLEGAL SCREEN", sx.x, sx.y, 95, "#ff6b4a");
                tf[sx.tm]++;
                sx.pf++;
                setup(o.tm);
              }
            }
          }
          if (hit > 60) {
            for (const q of [A, C]) {
              if (hit > 120) q.slow = Math.max(q.slow, 0.12);
              if (q.mode === "c" || q.mode === "s") q.bmp = Math.min(1, (q.bmp || 0) + hit / 260);
            }
            const h = B.owner;
            if (hit > 170 && fc <= 0 && rs <= 0 && !ftq && inb <= 0 && h && (A === h || C === h)) {
              const o = A === h ? C : A;
              fc = 2;
              if (o.tm !== h.tm) {
                const sh = h.mode === "c" || h.mode === "s";
                if (Math.hypot(o.vx, o.vy) < 70 && Math.hypot(h.vx, h.vy) > 170 && Math.random() < 0.5) {
                  txtW("OFFENSIVE FOUL", h.x, h.y, 95, "#ff6b4a");
                  tf[h.tm]++;
                  h.pf++;
                  setup(o.tm);
                } else if (Math.random() < 0.3) foul(o, h, sh ? "SHOOTING" : "BLOCKING", sh ? 1 : 0, 0);
              }
            }
          }
        }
      }
    }
}
// ---- physics net (verlet mesh; the ball pushes points) ----
export const NETS = HXs.map((hx) => {
  const p: any[] = [],
    c: any[] = [],
    S = 12,
    R = [
      [7.5, 100],
      [6.4, 93],
      [5.4, 86],
      [4.6, 80],
    ],
    gr: any[][] = [];
  for (let r = 0; r < 4; r++) {
    gr.push([]);
    for (let k = 0; k < S; k++) {
      const a = (k / S) * 6.283 + (r % 2 ? 3.1416 / S : 0),
        q: any = { x: hx + Math.cos(a) * R[r][0], y: HY + Math.sin(a) * R[r][0], z: R[r][1], f: r === 0 };
      q.px = q.x;
      q.py = q.y;
      q.pz = q.z;
      p.push(q);
      gr[r].push(q);
    }
  }
  const L = (a: any, b: any) => c.push([a, b, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)]);
  for (let r = 1; r < 4; r++)
    for (let k = 0; k < S; k++) {
      L(gr[r][k], gr[r - 1][k]);
      L(gr[r][k], gr[r - 1][(k + 1) % S]);
      L(gr[r][k], gr[r][(k + 1) % S]);
    }
  return { p, c };
});
export function netSim(dt: number) {
  for (const N of NETS) {
    for (const q of N.p) {
      if (q.f) continue;
      const vx = (q.x - q.px) * 0.95,
        vy = (q.y - q.py) * 0.95,
        vz = (q.z - q.pz) * 0.95;
      q.px = q.x;
      q.py = q.y;
      q.pz = q.z;
      q.x += vx;
      q.y += vy;
      q.z += vz - g * dt * dt * 0.6;
    }
    for (let it = 0; it < 4; it++) {
      for (const c of N.c) {
        const a = c[0],
          b = c[1],
          dx = b.x - a.x,
          dy = b.y - a.y,
          dz = b.z - a.z,
          d = Math.hypot(dx, dy, dz) || 1,
          f = ((d - c[2]) / d) * 0.5;
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
      if (!B.owner)
        for (const q of N.p) {
          if (q.f) continue;
          const dx = q.x - B.x,
            dy = q.y - B.y,
            dz = q.z - B.z,
            d = Math.hypot(dx, dy, dz);
          if (d < BR + 1.2 && d > 0) {
            const s = (BR + 1.2 - d) / d;
            q.x += dx * s;
            q.y += dy * s;
            q.z += dz * s;
          }
        }
    }
  }
}

// ---- instant replays: allocation-free ring buffer of positions + poses ----
export const QK = ["tL", "tR", "kL", "kR", "aL", "aR", "eL", "eR", "sz", "cr", "ln", "rz", "ty", "wR", "wL", "zL", "hz"];
const RCAP = 331,
  PST = 4 + QK.length,
  FST = 4 + 10 * PST + 1;
const REC = new Float32Array(RCAP * FST);
let recS = 0;
export let recN = 0;
export function recClear() {
  recS = recN = 0;
}
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
export function startReplay() {
  LIVE = { p: P.map((p) => [p.x, p.y, p.z, p.f, p.q ? { ...p.q } : null]), b: [B.x, B.y, B.z, B.a] };
  RPL = { i: Math.max(0, recN - 250) };
}
export const skipReplay = () => {
  if (RPL) RPL.i = 1e9;
};
function rplStep(dt: number) {
  const r = RPL;
  r.i += dt * 60 * 0.4;
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
    RPL = null;
    RQ = 0;
    recClear();
    rs = 0.001;
    return;
  }
  recApply(n);
}
/** Replay state for online guests: host says "replay at frame i". */
export const setRPL = (v: any) => (RPL = v);
