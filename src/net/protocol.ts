// Wire format: quantized integer snapshots of the authoritative sim, delta-compressed against a baseline the
// receivers already hold; absolute input state with edge counters; event ring for texts/sounds.
import * as G from "../core/sim";
import { P, B } from "../core/sim";
import { QK } from "../core/sim";

const MODE = ["i", "c", "s", "b"],
  BMODE = ["held", "air", "pass"],
  SMODE = ["menu", "play", "over"];
const r = Math.round;
const wrapA = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const TAU100 = 628.3185;

export const HDR = 34; // header ints
export const PST = 24; // per-player ints (without pose)
export const QN = QK.length;

/** Full snapshot of the sim as an int array. withPose adds joint angles (used during replays). */
export function encodeSnap(k: number): number[] {
  const f = G.ftq,
    idx = (p: any) => (p ? P.indexOf(p) : -1),
    rp = !!G.RPL,
    a: number[] = [
      k,
      SMODE.indexOf(G.S),
      G.q,
      r(G.clock * 10),
      r(G.shot * 10),
      G.sc[0],
      G.sc[1],
      G.pos,
      r(Math.max(0, G.inb) * 100),
      r(Math.max(0, G.rs) * 100),
      f ? idx(f.s) : -1,
      f ? f.i : 0,
      f ? f.n : 0,
      f ? (f.tech ? 1 : 0) : 0,
      G.tf[0],
      G.tf[1],
      r(G.T * 100),
      rp ? 1 : 0,
      idx(G.OFFS[0]),
      idx(G.OFFS[1]),
      idx(B.owner),
      Math.max(0, BMODE.indexOf(B.mode)),
      r(B.x * 10),
      r(B.y * 10),
      r(B.z * 10),
      r(B.vx || 0),
      r(B.vy || 0),
      r(B.vz || 0),
      r(((((B.a || 0) * 100) % TAU100) + TAU100) % TAU100),
      idx(B.to),
      B.sh ? 1 : 0,
      B.sc ? 1 : 0,
      B.ptype | 0,
      r((B.dh || 0) * 10),
    ];
  for (const p of P)
    a.push(
      r(p.x * 10),
      r(p.y * 10),
      r(p.z * 10),
      r(p.vx),
      r(p.vy),
      r(p.vz),
      r(wrapA(p.f) * 100),
      Math.max(0, MODE.indexOf(p.mode)),
      r(Math.min(p.t, 9) * 100),
      r((((p.ph * 100) % TAU100) + TAU100) % TAU100),
      p.sv | 0,
      r(Math.max(-1, p.mvT || 0) * 100),
      r(Math.min(9, p.mvE || 0) * 100),
      p.mvk | 0,
      p.mvS | 0,
      r((p.brk || 0) * 100),
      p.postA ? 1 : 0,
      r(Math.max(-1, p.pT || 0) * 100),
      r(Math.max(-1, p.sbw || 0) * 100),
      r((p.en == null ? 1 : p.en) * 100),
      p.hk ? 1 : 0,
      r(Math.max(-1, p.slow || 0) * 100),
      p.cw == null ? -1 : r(p.cw * 100),
      p.heat | 0,
    );
  if (rp) for (const p of P) for (const k2 of QK) a.push(r(((p.q && p.q[k2]) || 0) * 1000));
  return a;
}
export const snapTick = (a: number[]) => a[0];

/** Apply a decoded snapshot (or an interpolation of two) onto the local sim objects. */
export function applySnap(a: number[], b: number[] | null, u: number, skip?: number) {
  const L = (i: number) => (b ? a[i] + (b[i] - a[i]) * u : a[i]);
  const LA = (i: number, s: number) => {
    // interpolate angles the short way round
    if (!b) return a[i] / s;
    let d = (b[i] - a[i]) / s;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    return a[i] / s + d * u;
  };
  const at = (j: number) => (j >= 0 ? P[j] : null);
  const fi = a[10];
  G.setScalars({
    S: SMODE[a[1]] || "play",
    q: a[2],
    clock: L(3) / 10,
    shot: L(4) / 10,
    sc: [a[5], a[6]],
    pos: a[7],
    inb: a[8] / 100,
    rs: a[9] / 100,
    ftq: fi >= 0 ? { s: P[fi], i: a[11], n: a[12], tech: a[13], next: 0, w: 0, fired: 0 } : null,
    tf: [a[14], a[15]],
    T: L(16) / 100,
  });
  G.setRPL(a[17] ? { i: 0, net: 1 } : null);
  G.OFFS[0] = at(a[18]);
  G.OFFS[1] = at(a[19]);
  B.owner = at(a[20]);
  B.mode = BMODE[a[21]];
  B.x = L(22) / 10;
  B.y = L(23) / 10;
  B.z = L(24) / 10;
  B.vx = a[25];
  B.vy = a[26];
  B.vz = a[27];
  B.a = LA(28, 100);
  B.to = at(a[29]);
  B.sh = a[30];
  B.sc = a[31];
  B.ptype = a[32];
  for (let k = 0; k < P.length; k++) {
    if (k === skip) continue;
    const p = P[k],
      o = HDR + k * PST;
    p.x = L(o) / 10;
    p.y = L(o + 1) / 10;
    p.z = L(o + 2) / 10;
    p.vx = L(o + 3);
    p.vy = L(o + 4);
    p.vz = L(o + 5);
    p.f = LA(o + 6, 100);
    applyDiscrete(p, a, o);
    p.t = L(o + 8) / 100;
    p.ph = LA(o + 9, 100);
    p.mvE = L(o + 12) / 100;
    p.brk = L(o + 15) / 100;
    p.en = L(o + 19) / 100;
  }
  if (a[17] && a.length >= HDR + P.length * (PST + QN)) {
    const qo = HDR + P.length * PST;
    for (let k = 0; k < P.length; k++) {
      const p = P[k];
      p.q = p.q || {};
      QK.forEach((n, j) => (p.q[n] = L(qo + k * QN + j) / 1000));
    }
  }
}
/** Discrete per-player fields (never interpolated). */
export function applyDiscrete(p: any, a: number[], o: number) {
  p.mode = MODE[a[o + 7]] || "i";
  p.sv = a[o + 10];
  p.mvT = a[o + 11] / 100;
  p.mvk = a[o + 13];
  p.mvS = a[o + 14];
  p.postA = a[o + 16];
  p.pT = a[o + 17] / 100;
  p.sbw = a[o + 18] / 100;
  p.hk = a[o + 20];
  p.slow = a[o + 21] / 100;
  p.cw = a[o + 22] < 0 ? null : a[o + 22] / 100;
  p.heat = a[o + 23];
}
/** Restore one player's full predicted-relevant state from a snapshot (used for reconciliation). */
export function applyPlayer(p: any, a: number[], k: number) {
  const o = HDR + k * PST;
  p.x = a[o] / 10;
  p.y = a[o + 1] / 10;
  p.z = a[o + 2] / 10;
  p.vx = a[o + 3];
  p.vy = a[o + 4];
  p.vz = a[o + 5];
  p.f = a[o + 6] / 100;
  applyDiscrete(p, a, o);
  p.t = a[o + 8] / 100;
  p.ph = a[o + 9] / 100;
  p.mvE = a[o + 12] / 100;
  p.brk = a[o + 15] / 100;
  p.en = a[o + 19] / 100;
}

// ---- delta compression: [gap, diff] pairs against a baseline array of the same layout ----
export function deltaEnc(cur: number[], base: number[]): number[] | null {
  if (cur.length !== base.length) return null;
  const out: number[] = [];
  let last = 0;
  for (let i = 1; i < cur.length; i++)
    if (cur[i] !== base[i]) {
      out.push(i - last, cur[i] - base[i]);
      last = i;
    }
  return out;
}
export function deltaDec(d: number[], base: number[], k: number): number[] {
  const a = base.slice();
  a[0] = k;
  let i = 0;
  for (let j = 0; j < d.length; j += 2) {
    i += d[j];
    a[i] = base[i] + d[j + 1];
  }
  return a;
}

// ---- inputs: absolute stick + held buttons + monotonically increasing edge counters ----
export const EDGES = ["sd", "su", "e", "sb", "mv1", "mv2", "mv3", "lob", "sw", "skip"] as const;
export interface WireInput {
  n: number; // guest input tick
  dx: number;
  dy: number;
  sp: number;
  post: number;
  c: number[]; // counters per EDGES
  mt: number; // meter time of the last release (ms, shooter's own clock)
  tp: number; // tempo tap time (ms), -1 none
}
export const packInput = (w: WireInput) => [w.n, r(w.dx * 100), r(w.dy * 100), (w.sp ? 1 : 0) | (w.post ? 2 : 0), ...w.c, r(w.mt), r(w.tp)];
export const unpackInput = (a: number[]): WireInput => ({
  n: a[0],
  dx: a[1] / 100,
  dy: a[2] / 100,
  sp: a[3] & 1,
  post: (a[3] >> 1) & 1,
  c: a.slice(4, 4 + EDGES.length),
  mt: a[4 + EDGES.length],
  tp: a[5 + EDGES.length],
});

// ---- box score + events ----
export const encodeBox = () => P.map((p) => [p.stt.pts, p.stt.reb, p.stt.ast, p.stt.fgm, p.stt.fga, p.stt.tpm, p.stt.tpa, p.stt.blk]);
export function applyBox(x: number[][]) {
  if (!x) return;
  x.forEach((s, k) => {
    const p = P[k];
    if (p) [p.stt.pts, p.stt.reb, p.stt.ast, p.stt.fgm, p.stt.fga, p.stt.tpm, p.stt.tpa, p.stt.blk] = s;
  });
}
/** Recent FX for guests: texts (world/screen), sounds, crowd excitement, game end. Compact tuples. */
export function encodeFx(max: number): any[] {
  const out: any[] = [];
  for (let i = G.FX.length - 1; i >= 0 && out.length < max; i--) {
    const f = G.FX[i];
    if (f.k === "t") out.push(f.x != null ? [f.id, "t", f.s, r(f.x), r(f.y), r(f.z), f.c] : [f.id, "T", f.s, r(f.sx), r(f.sy), f.c]);
    else if (f.k === "s") out.push([f.id, "s", f.f, f.d, f.ty, f.v]);
    else if (f.k === "x") out.push([f.id, "x", f.v]);
    else if (f.k === "end") out.push([f.id, "e", f.w]);
    else if (f.k === "shake" || f.k === "slow" || f.k === "chant") out.push([f.id, "g", f.k, f.v || 0]);
  }
  return out.reverse();
}
export function decodeFx(e: any[]): any {
  switch (e[1]) {
    case "t":
      return { id: e[0], k: "t", s: e[2], x: e[3], y: e[4], z: e[5], c: e[6] };
    case "T":
      return { id: e[0], k: "t", s: e[2], sx: e[3], sy: e[4], c: e[5] };
    case "s":
      return { id: e[0], k: "s", f: e[2], d: e[3], ty: e[4], v: e[5] };
    case "x":
      return { id: e[0], k: "x", v: e[2] };
    case "e":
      return { id: e[0], k: "end", w: e[2] };
    case "g":
      return { id: e[0], k: e[2], v: e[3] };
  }
  return null;
}
