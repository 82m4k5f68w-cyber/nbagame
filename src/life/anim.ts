// LIFE character animation: drives rig v6 joint channels (p.q, the same 31 channels pose.ts writes) without the game
// sim - CMU mocap walk / run cycles (core/mocap.ts, decoded + smoothed here), idle breathing, sitting, waving,
// eating, lifting, a phone-in-hand pose. A "body" is a plain object rig3d.applyPose understands.
import { MC_RAW, MC_CH } from "../core/mocap";

const C = MC_CH.length;
type Clip = { n: number; v: Float32Array; speed: number; stride: number };
const CLIPS: Record<string, Clip> = {};
/** Decode int8 cycles (1/40 rad) and low-pass each channel to its first harmonics (seamless loops, no jitter);
 *  symmetric gaits average the left side with the right side half a cycle later. */
function decode(name: string): Clip {
  const c = MC_RAW[name],
    raw = typeof atob === "function" ? Uint8Array.from(atob(c.d), (ch) => ch.charCodeAt(0)) : new Uint8Array(Buffer.from(c.d, "base64")),
    n = c.n,
    v = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) v[i] = ((raw[i] << 24) >> 24) / 40;
  const w = Float64Array.from(v),
    W = (i: number, j: number) => w[(((i % n) + n) % n) * C + j],
    h = n / 2;
  const PR = [0, 1, 2, 3, 4, 5, 13, 14, 15, 16, 17, 18],
    OD = [7, 9, 10, 12],
    EV = [6, 8, 11, 19];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < PR.length; k += 2) {
      const L = PR[k],
        R = PR[k + 1];
      v[i * C + L] = (W(i, L) + W(i + h, R)) / 2;
      v[i * C + R] = (W(i, R) + W(i + h, L)) / 2;
    }
    for (const j of OD) v[i * C + j] = (W(i, j) - W(i + h, j)) / 2;
    for (const j of EV) v[i * C + j] = (W(i, j) + W(i + h, j)) / 2;
  }
  const tmp = new Float64Array(n);
  for (let j = 0; j < C; j++) {
    const H = 3;
    let m = 0;
    for (let i = 0; i < n; i++) m += v[i * C + j];
    m /= n;
    tmp.fill(m);
    for (let k = 1; k <= H; k++) {
      let re = 0,
        im = 0;
      for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI * k * i) / n;
        re += v[i * C + j] * Math.cos(a);
        im += v[i * C + j] * Math.sin(a);
      }
      for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI * k * i) / n;
        tmp[i] += ((2 * re) / n) * Math.cos(a) + ((2 * im) / n) * Math.sin(a);
      }
    }
    for (let i = 0; i < n; i++) v[i * C + j] = tmp[i];
  }
  return { n, v, speed: c.speed, stride: c.stride };
}
const clip = (k: string) => (CLIPS[k] = CLIPS[k] || decode(k));
const S1 = new Float32Array(C),
  S2 = new Float32Array(C);
function sample(k: string, ph: number, out: Float32Array) {
  const c = clip(k),
    u = ((((ph / (Math.PI * 2)) % 1) + 1) % 1) * c.n,
    i0 = Math.floor(u) % c.n,
    i1 = (i0 + 1) % c.n,
    f = u - Math.floor(u);
  for (let j = 0; j < C; j++) out[j] = c.v[i0 * C + j] + (c.v[i1 * C + j] - c.v[i0 * C + j]) * f;
}
export type Act = "" | "sit" | "wave" | "eat" | "lift" | "phone" | "shoot" | "cheer" | "lean" | "talk";
/** A drawable LIFE character (fields applyPose / clothStep / footIK read). */
export interface Body {
  n: string;
  x: number; // game units (px = 0.1 ft) in the rig's W3 frame; LIFE places the rig itself (see world.ts)
  y: number;
  z: number;
  f: number;
  ry: number;
  vx: number;
  vy: number;
  vz: number;
  ph: number;
  mode: string;
  q: Record<string, number>;
  act: Act;
  actT: number;
  sp: number; // ground speed ft/s
  seed: number;
  fc?: any;
}
export function mkBody(n: string, seed = 0): Body {
  return { n, x: 470, y: 250, z: 0, f: 0, ry: 0, vx: 0, vy: 0, vz: 0, ph: 0, mode: "i", q: {}, act: "", actT: 0, sp: 0, seed, fc: null };
}
const REST: Record<string, number> = { tL: 0.02, tR: 0.02, kL: 0.06, kR: 0.06, fL: -0.02, fR: -0.02, hz: 0.06, hs: 0, ln: 0.04, ty: 0, rz: 0, cx: 0, cy: 0, aL: 0.06, aR: 0.06, eL: 0.22, eR: 0.22, sz: 0.1, zL: 0.1, cr: 0, nk: 0, hp: 0, hy: 0, wL: 0, wR: 0, gL: 0.35, gR: 0.35, oL: 0, oR: 0, hL: 0, hR: 0 };
/** Advance a body's pose by dt seconds at ground speed sp (ft/s). Walk below ~9 ft/s, run above (blended). */
export function animate(b: Body, dt: number, t: number) {
  const sp = b.sp,
    q = b.q,
    run = Math.max(0, Math.min(1, (sp - 6) / 6)),
    mv = Math.min(1, sp / 1.2);
  // gait phase: one cycle = two strides (mocap stride in px = 0.1 ft)
  const cw = clip("walk"),
    cr = clip("run"),
    stride = ((cw.stride + (cr.stride - cw.stride) * run) / 10) * (0.75 + 0.25 * Math.min(1.6, sp / 5)); // ft
  b.ph += (sp / Math.max(0.5, 2 * stride)) * Math.PI * 2 * dt;
  sample("walk", b.ph, S1);
  if (run > 0) {
    sample("run", b.ph, S2);
    for (let j = 0; j < C; j++) S1[j] += (S2[j] - S1[j]) * run;
  }
  const br = Math.sin(t * 1.7 + b.seed) * 0.02; // breathing
  const tgt: Record<string, number> = { ...REST };
  for (let j = 0; j < C; j++) {
    const k = MC_CH[j];
    tgt[k] = (REST[k] ?? 0) + ((S1[j] as number) - (REST[k] ?? 0)) * mv;
  }
  tgt.cx = (tgt.cx || 0) + br;
  tgt.cr = (tgt.cr || 0) * mv;
  // activity overlays (upper body; sit = whole body)
  const a = b.act;
  b.actT += dt;
  if (a === "sit") {
    Object.assign(tgt, { tL: 1.5, tR: 1.5, kL: 1.45, kR: 1.45, fL: 0.1, fR: 0.1, ln: 0.05, aL: 0.35, aR: 0.35, eL: 0.9, eR: 0.9, sz: 0.12, zL: 0.12, cr: 0 });
  } else if (a === "wave") {
    tgt.aR = 2.6;
    tgt.eR = 0.6 + Math.sin(b.actT * 9) * 0.35;
    tgt.sz = 0.45;
  } else if (a === "cheer") {
    tgt.aR = tgt.aL = 2.8 + Math.sin(b.actT * 8) * 0.2;
    tgt.eR = tgt.eL = 0.3;
    tgt.sz = tgt.zL = 0.35;
  } else if (a === "phone") {
    tgt.aR = 0.55;
    tgt.eR = 1.9;
    tgt.oR = -0.9;
    tgt.aL = 0.45;
    tgt.eL = 1.7;
    tgt.hp = 0.45;
  } else if (a === "eat") {
    tgt.aR = 0.7;
    tgt.eR = 2.2 + Math.sin(b.actT * 3) * 0.25;
    tgt.hp = 0.15;
  } else if (a === "lift") {
    const u = (Math.sin(b.actT * 3) + 1) / 2;
    tgt.aR = tgt.aL = 0.4 + u * 2.4;
    tgt.eR = tgt.eL = 1.6 - u * 1.2;
    tgt.sz = tgt.zL = 0.5;
  } else if (a === "shoot") {
    const u = (b.actT % 1.6) / 1.6;
    tgt.aR = 1.2 + Math.min(1, u * 2) * 1.6;
    tgt.eR = 1.8 - Math.min(1, u * 2) * 1.6;
    tgt.wR = u > 0.5 ? 1.2 : -0.6;
    tgt.aL = 1.6;
    tgt.eL = 1.2;
    tgt.kL = tgt.kR = u < 0.3 ? 0.6 : 0.1;
    tgt.tL = tgt.tR = u < 0.3 ? 0.4 : 0.05;
  } else if (a === "lean") {
    tgt.ln = 0.12;
    tgt.aL = 0.25;
    tgt.eL = 1.4;
    tgt.tR = 0.2;
    tgt.kR = 0.3;
  } else if (a === "talk") {
    tgt.aR = 0.5 + Math.sin(b.actT * 2.2) * 0.25;
    tgt.eR = 1.2 + Math.sin(b.actT * 3.1) * 0.3;
    tgt.hy = Math.sin(b.actT * 0.9) * 0.15;
  }
  // smooth toward the target (fast enough that the gait's own motion survives)
  const k = Math.min(1, dt * 14);
  for (const key in tgt) {
    const cur = q[key];
    q[key] = cur == null || !isFinite(cur) ? tgt[key] : cur + (tgt[key] - cur) * (key in REST && mv > 0.2 && !a ? 1 : k);
  }
  // blink + soft smile
  const bl = (t * 0.7 + b.seed) % 4 < 0.12 ? 1 : 0;
  b.fc = { jw: 0, sm: a === "cheer" || a === "wave" ? 0.8 : 0.15, br: 0, an: 0, sq: 0, wd: 0, bl, ex: 0, ey: 0 };
}
