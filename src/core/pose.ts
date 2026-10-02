// Pro Play pose solver: joint angles per player (p.q), shot clips, and analytic hand forward kinematics.
// Runs inside the fixed-step sim (so the release point is the same on every machine and on the server).
import { CL, CK } from "./data";
import { P, B, pos, T, DT, cfg, W3, clamp, type Player } from "./sim";

function smp(a: number[] | undefined, k: number) {
  if (!a) return null;
  if (k <= a[0]) return a[1];
  for (let i = 2; i < a.length; i += 2)
    if (k <= a[i]) {
      const u = (k - a[i - 2]) / (a[i] - a[i - 2]),
        s = u * u * (3 - 2 * u);
      return a[i - 1] + (a[i + 1] - a[i - 1]) * s;
    }
  return a[a.length - 1];
}
const CLIPK = ["aR", "eR", "aL", "eL", "tL", "tR", "kL", "kR", "ln", "sz", "cr", "rz", "ty", "wR", "wL", "zL"];
const CO: Record<string, number> = {};
/** Sample the player's shot clip at phase k (0..1), with signature tweaks. Returns a shared object. */
export function clip(p: Player, k: number) {
  const c = CL[CK[p.sv]] || CL.jump,
    o = CO;
  for (const n of CLIPK) {
    const v = smp(c[n], k);
    o[n] = v == null ? (smp(CL.jump[n], k) as number) : v;
  }
  const g = p.sg || {},
    up = Math.min(1, k / 0.7);
  o.aR += (g.a || 0) * up;
  o.sz += (g.f || 0) * up;
  o.ln += (g.l || 0) * Math.sin(Math.min(1, k) * 3.14);
  o.tL += (g.k || 0) * (k > 0.5 ? 1 : 0);
  o.aL -= (g.g || 0) * 0.4 * (k > 0.7 ? (k - 0.7) / 0.3 : 0);
  o.wR *= 1 + (g.w || 0);
  if (CK[p.sv] === "curry" && p.sbw > 0) {
    o.ln -= 0.22;
    o.tR -= 0.2;
  }
  return o;
}

/** Write this tick's joint angles into p.q (in place, smoothed when Pro Play is on). */
export function pose3(p: Player) {
  const PRO = cfg.PRO,
    has = B.owner === p,
    air = p.z > 2,
    sp = Math.hypot(p.vx, p.vy),
    spd = Math.min(1, sp / 200),
    s = Math.sin(p.ph),
    md = p.mode;
  let tL = s * 0.95 * spd,
    tR = -s * 0.95 * spd,
    kL = Math.max(0, -s) * 1.2 * spd + 0.05,
    kR = Math.max(0, s) * 1.2 * spd + 0.05,
    aL = -s * 0.8 * spd,
    aR = s * 0.8 * spd,
    eL = 0.5 + spd * 0.8,
    eR = 0.5 + spd * 0.8,
    sz = 0.1,
    cr = 0,
    ln = 0.12 * spd - (p.brk || 0) * 0.3,
    rz = 0,
    ty = s * 0.25 * spd,
    wR = 0,
    wL = 0,
    zL: number | null = null;
  if (air && md !== "s" && md !== "c") {
    tL = 0.6;
    tR = 0.1;
    kL = 1;
    kR = 0.7;
  }
  if (md === "c") {
    wR = -0.5;
    wL = -0.2;
    zL = -0.08;
    aL = aR = 1;
    eL = eR = 1.7;
    cr = 0.5;
    if (PRO && p.sg && p.sg.cl) {
      aR = 0.6;
      eR = 1.3;
      aL = 0.7;
      eL = 1.4;
      cr = 0.3;
    }
    tL = 0.3;
    tR = -0.2;
    kL = kR = 0.8;
    sz = 0.05;
    ty = 0;
  } else if (md === "s" && PRO) {
    const k = Math.min(1, p.t / 0.4),
      o = clip(p, k);
    aR = o.aR;
    eR = o.eR;
    aL = o.aL;
    eL = o.eL;
    tL = o.tL;
    tR = o.tR;
    kL = o.kL;
    kR = o.kR;
    ln = o.ln;
    sz = o.sz;
    cr = p.z < 2 ? o.cr : 0;
    rz = o.rz;
    ty = o.ty;
    wR = o.wR;
    wL = o.wL;
    zL = o.zL;
  } else if (md === "s") {
    const k = Math.min(1, p.t / 0.4),
      v = p.sv,
      e = Math.min(1, k / 0.55),
      se = e * e * (3 - 2 * e),
      rel = k < 0.6 ? 0 : Math.min(1, (k - 0.6) / 0.15),
      fo = k < 0.7 ? 0 : (k - 0.7) / 0.3;
    aR = k < 0.55 ? 1 + se * 1.25 : k < 0.7 ? 2.25 + ((k - 0.55) / 0.15) * 0.7 : 2.95 - fo * 0.35;
    eR = k < 0.55 ? 1.7 - se * 0.45 : k < 0.7 ? 1.25 - ((k - 0.55) / 0.15) * 1.1 : 0.15 + fo * 0.35;
    aL = k < 0.55 ? 1 + se * 0.95 : Math.max(1.1, 1.95 - rel * 0.8);
    eL = k < 0.55 ? 1.5 : 1.3;
    sz = 0.03 + rel * 0.1;
    ln = -0.05;
    tL = 0.5 - rel * 0.3;
    tR = -0.1;
    kL = 0.9 - rel * 0.7;
    kR = 0.6 - rel * 0.5;
    ty = 0;
    cr = p.z < 2 && k > 0.7 ? 0.5 * Math.min(1, (k - 0.7) / 0.15) : 0;
    if (v === 1) {
      aR = k < 0.4 ? 1 + (k / 0.4) * 1.9 : 2.9 - fo * 0.3;
      eR = k < 0.4 ? 1.7 - (k / 0.4) * 1.5 : 0.2;
      kL = 0.4;
      tL = 0.25;
    }
    if (v === 2) {
      ln = -0.5 * Math.sin(Math.min(1, k * 1.1) * 3.14);
      tL = 1.1;
      kL = 0.2;
      tR = -0.4;
      kR = 0.5;
    }
    if (v === 3) {
      ln = -0.35;
      tL = 0.2;
      tR = -0.5;
      kR = 0.9;
      kL = 0.6;
    }
    if (v === 4) {
      aR = 2.7;
      eR = 0.3;
      aL = 0.5;
      eL = 1;
      ln = 0.15;
      rz = 0.25;
      tL = 0.3;
    }
    if (v === 5) {
      aR = 3;
      eR = 0.2;
      aL = 0.5;
      eL = 1.3;
      ln = 0.3;
      tL = 1.5;
      kL = 1.5;
      tR = -0.4;
      kR = 0.3;
    }
    if (v === 6) {
      aR = aL = k < 0.7 ? 3 : 1.7;
      eR = eL = 0.2;
      ln = 0.1;
      tL = 0.7;
      tR = 0.2;
      kL = kR = 0.8;
      sz = 0.2;
    }
  } else if (md === "b") {
    ln = -0.38;
    tL = Math.sin(p.t * 28) * 0.7;
    tR = -tL;
    kL = Math.max(0, -tL) + 0.4;
    kR = Math.max(0, tL) + 0.4;
    aR = 0.7 + Math.sin(p.t * 22) * 0.5;
    eR = 1.2;
    aL = 0.5;
    eL = 1;
    cr = 0.3;
    ty = Math.sin(p.t * 22) * 0.3;
  } else if (has) {
    {
      const u = PRO ? clamp((B.z - 6) / 30, 0, 1) : Math.abs(Math.sin(T * 8 + p.k));
      aR = PRO ? 0.5 + u * 0.45 : 0.55 + u * 0.8;
      eR = PRO ? 0.25 + u * 1.1 : 0.9;
      if (PRO) wR = 0.8 - u * 1.2;
    }
    aL = 0.4 + spd * 0.3;
    eL = 1;
    cr = 0.2;
    ln = 0.08 + spd * 0.2;
    ty = 0;
  } else if (air) {
    aL = aR = 3;
    eL = eR = 0.1;
    sz = 0.12;
  } else if (pos !== p.tm) {
    aL = aR = 0.6;
    eL = eR = 0.9;
    sz = 1.1 + Math.sin(T * 8 + p.k) * 0.1;
    cr = 0.4;
    tL = s * 0.5 * spd + 0.35;
    tR = -s * 0.5 * spd + 0.35;
    kL = kR = 0.8;
    ln = 0.18;
  }
  let hz = 0;
  {
    const sv = Math.hypot(p.vx, p.vy),
      def = pos !== p.tm && B.owner;
    if (md === "i" && !air && sv > 25) {
      const cf = Math.cos(p.f),
        sf = Math.sin(p.f),
        fw = (p.vx * cf + p.vy * sf) / sv,
        sd2 = (-p.vx * sf + p.vy * cf) / sv;
      if (!def && !(p.mvT > 0)) {
        tL *= fw;
        tR *= fw;
        kL = Math.max(0.05, kL * Math.abs(fw));
        kR = Math.max(0.05, kR * Math.abs(fw));
        if (fw < -0.3) ln -= 0.12;
      }
      hz = Math.abs(sd2) * (0.16 + 0.14 * Math.abs(s)) * spd + (def ? 0.12 : 0);
      cr += Math.abs(sd2) * 0.15 * spd;
    } else if (def && !air) hz = 0.14;
    if (PRO && has && md === "i" && !(p.mvT > 0) && !p.postA) {
      // Dribble hand IK: reach the real ball position.
      const S2 = p.ht / 6.4,
        w = W3(p.x, p.y, p.z),
        b = W3(B.x, B.y, B.z),
        th = Math.PI / 2 - p.f,
        X1 = b[0] - w[0],
        Y1 = b[1] - (w[1] - cr * 0.4),
        Z1 = b[2] - w[2],
        lx = (X1 * Math.cos(th) - Z1 * Math.sin(th)) / S2,
        lz = (X1 * Math.sin(th) + Z1 * Math.cos(th)) / S2,
        tx = lx - 0.82 * p.bk,
        ty2 = Y1 / S2 - 5.1,
        tz = lz,
        L1 = 1.02,
        L2 = 1.15,
        d = Math.min(L1 + L2 - 0.02, Math.max(0.3, Math.hypot(tx, ty2, tz))),
        ph2 = Math.atan2(tz, -ty2),
        al = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
      aR = ph2 - al;
      eR = Math.PI - Math.acos(clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
      sz = clamp(Math.atan2(tx, Math.max(0.2, -ty2)), -0.4, 0.6);
    }
    if (def && !air && (B.owner.mode === "c" || B.owner.mode === "s") && Math.hypot(B.owner.x - p.x, B.owner.y - p.y) < 70) {
      aR = 2.9;
      eR = 0.15;
      aL = 1.3;
      eL = 0.6;
    }
    if (p.pT > 0) {
      aL = aR = 1.5;
      eL = eR = 0.25;
      ln += 0.1;
    }
    if (B.mode === "pass" && B.to === p && !air) {
      aL = aR = 1.35;
      eL = eR = 0.5;
      zL = 0.15;
    }
  }
  if (p.mvT > 0) {
    const e = p.mvE || 0,
      sd = p.mvS || 1;
    if (p.mvk === 2) {
      ty += (e / 0.45) * 6.283 * sd;
      ln = 0.25;
      cr = 0.2;
    } else if (p.mvk === 1) {
      cr = e < 0.22 ? 0.55 : 0.1;
      ln = e < 0.22 ? -0.12 : 0.35;
    } else if (p.mvk === 3) {
      ty += Math.sin(e * 10) * 0.9 * sd;
      ln = 0.2;
      aR = 0.3;
      eR = 0.4;
    } else {
      ln = 0.3;
      cr = 0.2;
    }
  }
  if (p.postA) {
    cr = 0.45;
    ln = 0.25;
    sz = 0.8;
    aL = 1.2;
  }
  const q = p.q,
    sm = PRO && q && q.wR != null,
    f = sm ? Math.min(1, DT * 20) : 1,
    o = q || (p.q = {}),
    put = (k: string, v: number, raw = false) => (o[k] = sm && !raw && o[k] != null ? o[k] + (v - o[k]) * f : v);
  put("tL", tL);
  put("tR", tR);
  put("kL", kL);
  put("kR", kR);
  put("aL", aL);
  put("aR", aR);
  put("eL", eL);
  put("eR", eR);
  put("sz", sz);
  put("cr", cr);
  put("ln", ln);
  put("rz", rz);
  put("ty", ty);
  put("wR", wR, true);
  put("wL", wL);
  put("zL", zL == null ? sz : zL);
  put("hz", hz);
}

// ---- forward kinematics (mirrors the three.js rig hierarchy exactly) ----
// G: pos(w0, w1 - cr*0.4, w2), rotY(PI/2 - f), scale ht/6.4 -> body: pos(0,3.2,0) Euler(ln,ty,rz,'YXZ')
// -> R shoulder: pos(0.88*0.95*bk, 1.9, 0) Euler(-aR, 0, sz,'XYZ') -> elbow: pos(0,-1.02,0) rotX(-eR)
// -> wrist: pos(0,-1,0) rotX(-wR) -> palm point (0,-0.62,0.1).
type V = [number, number, number];
const rx = (v: V, a: number): V => {
  const c = Math.cos(a),
    s = Math.sin(a);
  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
};
const ry = (v: V, a: number): V => {
  const c = Math.cos(a),
    s = Math.sin(a);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
};
const rz = (v: V, a: number): V => {
  const c = Math.cos(a),
    s = Math.sin(a);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
};
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
/** World position (game coords) of a point in the right wrist frame; default = palm. */
export function handPos(p: Player, pt: V = [0, -0.62, 0.1]): number[] | null {
  const q = p.q;
  if (!q) return null;
  let v: V = rx(pt, -(q.wR || 0));
  v = add(v, [0, -1, 0]);
  v = rx(v, -q.eR);
  v = add(v, [0, -1.02, 0]);
  // XYZ Euler: R = Rx * Ry * Rz (applied to the vector right-to-left)
  v = rx(rz(v, q.sz), -q.aR);
  v = add(v, [0.88 * 0.95 * p.bk, 1.9, 0]);
  // YXZ Euler: R = Ry * Rx * Rz
  v = ry(rx(rz(v, q.rz), q.ln), q.ty);
  v = add(v, [0, 3.2, 0]);
  const s = p.ht / 6.4;
  v = [v[0] * s, v[1] * s, v[2] * s];
  v = ry(v, Math.PI / 2 - p.f);
  const w = W3(p.x, p.y, p.z);
  v = add(v, [w[0], w[1] - q.cr * 0.4, w[2]]);
  return [v[0] * 10 + 470, v[2] * 10 + 250, v[1] * 10];
}
