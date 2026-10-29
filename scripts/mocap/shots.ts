// Shot motion dataset (v5.6): CMU basketball shots + two-foot jumps retargeted onto the game's 31 channels
// (scripts/mocap/bvh31.ts), segmented into phases and time-warped onto the game's shot-clip phase k.
//   npx tsx scripts/mocap/shots.ts            -> assets/mocap/shots/dataset.json (derived curves only; the BVH cache
//                                               stays outside the repo in $MOCAP_DIR, default /home/user/tools/mocap/cmu)
// Data: CMU Graphics Lab Motion Capture Database (mocap.cs.cmu.edu, funded by NSF EIA-0196217; "free for research
// and commercial use"), cgspeed BVH conversion by B. Hahne (mirror github.com/una-dinosauria/cmu-mocap).
//
// Phases per sequence (times in s, found from the joint curves):
//   gather = lowest ball hand before the shot, dip = deepest crouch (cr max) before takeoff, takeoff = feet leave the
//   floor, release = wrist snap (peak wrist-flex velocity while the shooting elbow is nearly straight), apex = highest
//   pelvis, land = feet back on the floor. Jumps (no ball) use apex - 0.05 s as their "release" anchor (captured
//   jumpers release ~0.05 s before the apex).
// Canonical clip phase k (41 samples) (what pose.ts samples): dip -> 0, takeoff -> 0.2, release -> 0.7 (RELK), release + 60% of the
// way to the landing -> 1 (the game holds k = 1 until he lands).
import fs from "node:fs";
import path from "node:path";
import { retarget31, QK, type Clip31, type QPose } from "./bvh31";

const DIR = process.env.MOCAP_DIR || "/home/user/tools/mocap/cmu",
  OUT = path.resolve("assets/mocap/shots");
// curated basketball shots (searched over 620 CMU trials for an overhead shooting hand + elbow extension + wrist snap;
// 102_xx are drives / passes, 124_06 is a one-hand dunk-like jump)
const SHOTS: [string, number, number, string][] = [
  ["06_15", 2.2, 3.6, "dribble, pull-up jumper"],
  ["06_14", 1.6, 3.0, "set shot, small hop"],
  ["124_03", 3.3, 4.8, "shot with a small hop"],
  ["124_04", 3.6, 4.9, "free throw (hop)"],
  ["124_05", 2.6, 4.2, "jump shot"],
];
const JUMPS = [
  ...Array.from({ length: 29 }, (_, i) => "118_" + String(i + 1).padStart(2, "0")),
  "16_01", "16_02", "16_03", "16_04", "16_05", "16_06", "16_07", "16_09", "16_10",
  "13_11", "13_13", "49_02", "49_03", "02_04",
];
/** Channels the model learns (the shot clip's 18 + chest pitch + humeral twists). */
export const MC = ["aR", "eR", "aL", "eL", "tL", "tR", "kL", "kR", "ln", "sz", "cr", "rz", "ty", "wR", "wL", "zL", "oR", "oL", "cx", "hR", "hL"] as const;
export const UPPER = ["aR", "eR", "aL", "eL", "sz", "zL", "wR", "wL", "oR", "oL", "hR", "hL"];
const NK = 41; // canonical samples k = 0, 1/40 .. 1

type Seq = {
  id: string;
  kind: "shot" | "jump";
  note: string;
  mirror: boolean;
  ev: Record<string, number>; // event times (s, clip-relative)
  d: { H: number; FW: number; SD: number; LOAD: number; SET: number; TEMPO: number }; // descriptors
  k: number[][]; // NK x MC canonical samples
};

const lerpQ = (c: Clip31, t: number, ch: string) => {
  const u = t / c.dt,
    i = Math.max(0, Math.min(c.q.length - 2, Math.floor(u))),
    f = Math.max(0, Math.min(1, u - i));
  return (c.q[i] as any)[ch] * (1 - f) + (c.q[i + 1] as any)[ch] * f;
};
/** time-warp anchors -> canonical samples */
function canon(c: Clip31, ev: Record<string, number>, ty0: number) {
  const A = [
    [0, ev.dip],
    [0.2, ev.takeoff],
    [0.7, ev.release],
    [1, ev.release + 0.6 * (ev.land - ev.release)],
  ];
  const out: number[][] = [];
  for (let n = 0; n < NK; n++) {
    const k = n / (NK - 1);
    let s = 0;
    while (s < A.length - 2 && k > A[s + 1][0]) s++;
    const u = (k - A[s][0]) / (A[s + 1][0] - A[s][0]),
      t = A[s][1] + (A[s + 1][1] - A[s][1]) * u;
    out.push(MC.map((ch) => +(lerpQ(c, t, ch) - (ch === "ty" ? ty0 : 0)).toFixed(4)));
  }
  return out;
}
const footMin = (c: Clip31, i: number) => Math.min(c.foot[i].L, c.foot[i].R);
function standLevel(c: Clip31, a: number, b: number) {
  const v: number[] = [];
  for (let i = a; i < b; i++) v.push(footMin(c, i));
  v.sort((x, y) => x - y);
  return v[Math.floor(v.length * 0.2)];
}
function descriptors(c: Clip31, ev: Record<string, number>) {
  const i0 = Math.round(ev.takeoff / c.dt),
    i1 = Math.round(ev.land / c.dt),
    ia = Math.round(ev.apex / c.dt),
    ir = Math.round(ev.release / c.dt),
    id = Math.round(ev.dip / c.dt);
  const h = c.head[i0],
    v = c.hip[i1].clone().sub(c.hip[i0]).divideScalar(Math.max(c.dt, (i1 - i0) * c.dt));
  return {
    H: +(c.hip[ia].y - c.hip[i0].y).toFixed(3),
    FW: +(v.x * h.x + v.z * h.z).toFixed(3),
    SD: +(v.x * h.z - v.z * h.x).toFixed(3),
    LOAD: +c.q[id].cr.toFixed(3),
    SET: +c.q[ir].aR.toFixed(3),
    TEMPO: +(ev.release - ev.dip).toFixed(3),
  };
}

function shotSeq(id: string, a: number, b: number, note: string): Seq {
  // shooting hand: the side whose hand is higher at its highest point (mirror = the capture's right hand is ours)
  let best: Seq | null = null,
    bestH = -9;
  for (const mirror of [true, false]) {
    const c = retarget31(id, path.join(DIR, id + ".bvh"), mirror),
      ia = Math.round(a / c.dt),
      ib = Math.min(c.q.length - 2, Math.round(b / c.dt));
    let top = ia;
    for (let i = ia; i < ib; i++) if (c.hand[i].R.y > c.hand[top].R.y) top = i;
    const hTop = c.hand[top].R.y - c.headTop[top];
    // release: peak wrist-flex velocity in [top - .25 s, top + .05 s] with the elbow < 0.8 rad
    let rel = top,
      bv = -1e9;
    for (let i = Math.max(ia + 1, top - Math.round(0.25 / c.dt)); i <= Math.min(ib, top + Math.round(0.05 / c.dt)); i++) {
      const wv = (c.q[i + 1].wR - c.q[i - 1].wR) / (2 * c.dt);
      if (c.q[i].eR < 0.8 && wv > bv) (bv = wv), (rel = i);
    }
    // dip: deepest crouch in the 0.6 s before the release
    let dip = rel;
    for (let i = Math.max(ia, rel - Math.round(0.6 / c.dt)); i < rel; i++) if (c.q[i].cr > c.q[dip].cr) dip = i;
    // gather: lowest shooting hand in the 0.8 s before the release
    let gat = rel;
    for (let i = Math.max(ia, rel - Math.round(0.8 / c.dt)); i < rel; i++) if (c.hand[i].R.y < c.hand[gat].R.y) gat = i;
    const st = standLevel(c, ia, ib) + 0.05;
    let to = dip;
    while (to < rel && footMin(c, to) < st) to++;
    let apex = to;
    for (let i = to; i < ib; i++) if (c.hip[i].y > c.hip[apex].y) apex = i;
    let land = Math.max(apex, rel + 1);
    while (land < ib && footMin(c, land) > st) land++;
    if (land - rel < Math.round(0.08 / c.dt)) land = rel + Math.round(0.08 / c.dt); // (set shots: barely leave the floor)
    if (to >= rel) to = Math.round((dip + rel) / 2); // never a takeoff after the release
    const ev = { gather: gat * c.dt, dip: dip * c.dt, takeoff: to * c.dt, release: rel * c.dt, apex: apex * c.dt, land: land * c.dt };
    const s: Seq = { id, kind: "shot", note, mirror, ev, d: descriptors(c, ev), k: canon(c, ev, c.q[dip].ty) };
    if (hTop > bestH) (bestH = hTop), (best = s);
  }
  return best!;
}

function jumpSeqs(id: string): Seq[] {
  const out: Seq[] = [];
  for (const mirror of [true]) {
    // (legs are symmetric: the trainer adds the left/right mirror of every jump itself)
    const c = retarget31(id, path.join(DIR, id + ".bvh"), mirror),
      n = c.q.length,
      st = standLevel(c, 0, n) + 0.12;
    for (let i = 1; i < n; i++) {
      if (!(footMin(c, i) > st && footMin(c, i - 1) <= st)) continue;
      let j = i;
      while (j + 1 < n && footMin(c, j + 1) > st) j++;
      const to = i,
        land = j;
      i = j;
      if ((land - to) * c.dt < 0.18) continue;
      let apex = to;
      for (let k = to; k <= land; k++) if (c.hip[k].y > c.hip[apex].y) apex = k;
      if (c.hip[apex].y - c.hip[to].y < 0.25) continue;
      let dip = to;
      for (let k = Math.max(0, to - Math.round(0.5 / c.dt)); k < to; k++) if (c.q[k].cr > c.q[dip].cr) dip = k;
      if (to - dip < 2) dip = Math.max(0, to - Math.round(0.12 / c.dt));
      const rel = Math.max(to + 1, apex - Math.round(0.05 / c.dt));
      if (land + 2 >= n || dip < 1) continue;
      const ev = { gather: dip * c.dt, dip: dip * c.dt, takeoff: to * c.dt, release: rel * c.dt, apex: apex * c.dt, land: land * c.dt };
      const d = descriptors(c, ev);
      d.SET = NaN; // (no ball)
      out.push({ id: id + (mirror ? "" : "m") + "@" + (to * c.dt).toFixed(2), kind: "jump", note: "two-foot jump", mirror, ev, d, k: canon(c, ev, c.q[dip].ty) });
    }
  }
  return out;
}

const seqs: Seq[] = [];
for (const [id, a, b, note] of SHOTS) {
  const s = shotSeq(id, a, b, note);
  seqs.push(s);
  console.log("shot", id, s.mirror ? "right-handed" : "left-handed", JSON.stringify(s.ev, (_, v) => (typeof v === "number" ? +v.toFixed(3) : v)), JSON.stringify(s.d));
}
for (const id of JUMPS) {
  try {
    const js = jumpSeqs(id);
    seqs.push(...js);
    console.log("jump", id, js.length, js.map((s) => `H${s.d.H} FW${s.d.FW} L${s.d.LOAD}`).join(" "));
  } catch (e: any) {
    console.log("jump", id, "FAILED", e.message);
  }
}
fs.mkdirSync(OUT, { recursive: true });
const ds = {
  about: "CMU mocap (mocap.cs.cmu.edu, NSF EIA-0196217; free for research and commercial use), cgspeed BVH by B. Hahne. Retargeted by scripts/mocap/bvh31.ts + shots.ts. k: 61 samples on the shot-clip phase (dip 0, takeoff .2, release .7, follow-through 1).",
  ch: MC,
  nk: NK,
  enc: "k = base64 int16 (x1000 rad), NK rows x ch",
  seqs: seqs.map((s) => ({ ...s, k: Buffer.from(Int16Array.from(s.k.flat().map((v) => Math.round(v * 1000))).buffer).toString("base64"), ev: Object.fromEntries(Object.entries(s.ev).map(([k, v]) => [k, +v.toFixed(3)])), d: Object.fromEntries(Object.entries(s.d).map(([k, v]) => [k, Number.isFinite(v) ? v : null])) })),
};
fs.writeFileSync(path.join(OUT, "dataset.json"), JSON.stringify(ds));
console.log("wrote", seqs.length, "sequences (", seqs.filter((s) => s.kind === "shot").length, "shots ) ->", path.join(OUT, "dataset.json"), fs.statSync(path.join(OUT, "dataset.json")).size, "bytes");
void QK;
export type { QPose };
