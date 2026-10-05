// Pro Play pose solver: joint angles per player (p.q), shot clips, and analytic hand forward kinematics.
// Runs inside the fixed-step sim (so the release point is the same on every machine and on the server).
import { CL, CK, isLaySv, isDunkSv } from "./data";
import { MC_RAW, MC_CH, MC_JUMP } from "./mocap";

// ---- motion capture base layer (CMU mocap retargeted by scripts/mocap/retarget.ts) ----
const MCC: Record<string, { n: number; v: Float32Array; mean: Float32Array; speed: number; stride: number; dir: number }> = {};
for (const [k, c] of Object.entries(MC_RAW)) {
  const raw = typeof atob === "function" ? Uint8Array.from(atob(c.d), (ch) => ch.charCodeAt(0)) : new Uint8Array(Buffer.from(c.d, "base64")),
    C = MC_CH.length,
    v = new Float32Array(raw.length),
    mean = new Float32Array(C);
  for (let i = 0; i < raw.length; i++) v[i] = ((raw[i] << 24) >> 24) / 40; // int8 -> rad
  for (let j = 0; j < C; j++) {
    let s = 0;
    for (let i = 0; i < c.n; i++) s += v[i * C + j];
    mean[j] = s / c.n;
  }
  MCC[k] = { n: c.n, v, mean, speed: c.speed, stride: c.stride, dir: c.dir };
}
const MI: Record<string, number> = Object.fromEntries(MC_CH.map((k, i) => [k, i]));
const MO = new Float32Array(MC_CH.length),
  MT = new Float32Array(MC_CH.length);
/** Sample clip `name` at gait phase ph (rad) into out; amp scales the swing of thighs/knees/arms around the mean;
 *  mirror swaps left/right (sideways clips used in the other direction). */
function mcSample(name: string, ph: number, amp: number, mirror: boolean, out: Float32Array) {
  const c = MCC[name],
    C = MC_CH.length,
    u = ((((ph / (Math.PI * 2)) % 1) + 1) % 1) * c.n,
    i0 = Math.floor(u) % c.n,
    i1 = (i0 + 1) % c.n,
    f = u - Math.floor(u);
  for (let j = 0; j < C; j++) {
    const a = c.v[i0 * C + j] + (c.v[i1 * C + j] - c.v[i0 * C + j]) * f;
    const swing = j <= 3 || (j >= 13 && j <= 16);
    out[j] = swing ? c.mean[j] + (a - c.mean[j]) * amp : a;
  }
  if (mirror) {
    const sw = (a: string, b: string) => {
      const t = out[MI[a]];
      out[MI[a]] = out[MI[b]];
      out[MI[b]] = t;
    };
    sw("tL", "tR");
    sw("kL", "kR");
    sw("fL", "fR");
    sw("aL", "aR");
    sw("eL", "eR");
    sw("sz", "zL");
    for (const k of ["hs", "ty", "rz", "cy"]) out[MI[k]] = -out[MI[k]];
  }
}
/** Blend two clips (b weighted u) for the current gait phase into MO. */
function mcBlend(a: string, b: string | null, u: number, ph: number, amp: number, mirror: boolean) {
  mcSample(a, ph, amp, mirror, MO);
  if (b && u > 0) {
    mcSample(b, ph, amp, mirror, MT);
    for (let j = 0; j < MO.length; j++) MO[j] += (MT[j] - MO[j]) * u;
  }
}
import { P, B, pos, T, DT, cfg, W3, clamp, CEL_T, QK, stepLen, ftq, rs, inb, hoop, HY, JB, heldBall, S, sc, guardOf, g as GRAV, type Player } from "./sim";

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
const CLIPK = ["aR", "eR", "aL", "eL", "tL", "tR", "kL", "kR", "ln", "sz", "cr", "rz", "ty", "wR", "wL", "zL", "oR", "oL"];
const CO: Record<string, number> = {};
/** Sample the player's shot clip at phase k (0..1), with signature tweaks. Returns a shared object. */
export function clip(p: Player, k: number) {
  const c = CL[CK[p.sv]] || CL.jump,
    o = CO;
  for (const n of CLIPK) {
    const v = smp(c[n], k);
    o[n] = v == null ? (smp(CL.jump[n], k) ?? 0) : v;
  }
  const g = p.sg || {},
    up = Math.min(1, k / 0.7);
  o.aR += (g.a || 0) * up;
  o.sz += (g.f || 0) * up;
  o.ln += (g.l || 0) * Math.sin(Math.min(1, k) * 3.14);
  o.tL += (g.k || 0) * (k > 0.5 ? 1 : 0);
  o.aL -= (g.g || 0) * 0.4 * (k > 0.7 ? (k - 0.7) / 0.3 : 0);
  o.wR *= 1 + (g.w || 0);
  // personal touches
  const rel = k > 0.72 ? Math.min(1, (k - 0.72) / 0.28) : 0;
  o.aR += (g.ft || 0) * 0.25 * rel; // holds the follow-through up high
  o.wR += (g.ft || 0) * 0.35 * rel;
  o.tR += (g.lk || 0) * (k > 0.6 ? 1 : 0); // leg kick
  o.kR += (g.lk || 0) * 0.9 * (k > 0.6 ? 1 : 0);
  o.ty += (g.tw || 0) * Math.sin(Math.min(1, k) * 3.14);
  o.aL += (g.gh || 0) * 0.35 * up;
  o.zL += (g.gh || 0) * 0.25 * up;
  if (k < 0.3) o.aR -= (g.dp || 0) * Math.sin((k / 0.3) * 3.14) * 0.6; // dip before the rise
  if (CK[p.sv] === "curry" && p.sbw > 0) {
    o.ln -= 0.22;
    o.tR -= 0.2;
  }
  return o;
}

/** Drawn facing: the sim's facing plus the root yaw of a spin move (p.ry, 0 otherwise). Every FK / IK / renderer
 *  that places the body uses this, so they all agree. */
export const fv = (p: Player) => p.f + (p.ry || 0);
/** Write this tick's joint angles into p.q (in place, smoothed when Pro Play is on). */
export function pose3(p: Player) {
  if (!(p.mvT > 0 && p.mvk === 2)) p.ry = 0;
  const PRO = cfg.PRO,
    has = B.owner === p,
    air = p.z > 2,
    sp = Math.hypot(p.vx, p.vy),
    spd = Math.min(1, sp / 200),
    s = Math.sin(p.ph),
    c = Math.cos(p.ph),
    md = p.mode,
    // stride-matched gait: thigh swing sized so the planted foot travels exactly one step (see sim stepLen)
    legF = (3.18 * p.ht) / 6.4,
    A = Math.asin(Math.min(0.9, (stepLen(sp) / 10 / (2 * legF)) * 0.92)) * Math.min(1, sp / 30),
    ksw = 0.45 + 0.95 * spd; // swing-knee flex: heel kick grows with speed
  let hL = 0, // humeral twist (+ = internal rotation), applied about the upper-arm bone
    hR = 0;
  let tL = s * A,
    tR = -s * A,
    kL = 0.07 + Math.pow(Math.max(0, c), 1.5) * ksw * Math.min(1, sp / 30),
    kR = 0.07 + Math.pow(Math.max(0, -c), 1.5) * ksw * Math.min(1, sp / 30),
    aL = -s * (0.2 + 0.65 * spd),
    aR = s * (0.2 + 0.65 * spd),
    eL = 0.45 + spd * 1.0,
    eR = 0.45 + spd * 1.0,
    sz = 0.1,
    cr = 0.07 * spd * (1 - Math.abs(s)), // the body is lowest at mid-stance
    ln = 0.07 * spd - (p.brk || 0) * 0.3,
    rz = 0,
    ty = s * 0.18 * spd, // pelvis turns with the forward leg...
    wR = 0,
    wL = 0,
    zL: number | null = null,
    // new joints (animation engine v2)
    cx = 0.07 * spd, // chest pitch on top of the pelvis lean
    cy = -s * 0.3 * spd, // ...and the chest counter-rotates (real running)
    gL = 0.25, // finger curl 0 open .. 1 fist
    gR = 0.25,
    hs = 0, // asymmetric hip abduction (defensive shuffle)
    toe = 0, // extra plantar flex (toe-off / pointed in the air), both feet
    oL = 0, // forearm twist (+ = palm turns inward/up for the right arm)
    oR = 0,
    st = ST.idle;
  if (sp > 30) st = ST.run;
  if (air && md !== "s" && md !== "c") {
    tL = 0.6;
    tR = 0.1;
    kL = 1;
    kR = 0.7;
    toe = 0.45;
    st = ST.air;
    if (PRO && sp < 160) {
      // vertical jump (rebound, block, contest): captured legs and trunk (CMU 16_03), timed by where he is in his
      // flight - takeoff extension, the tuck at the top, legs reaching for the floor before touchdown
      const vz0 = Math.sqrt(Math.max(1, (p.vz || 0) * (p.vz || 0) + 2 * GRAV * p.z)),
        u = clamp((1 - (p.vz || 0) / vz0) / 2, 0, 1),
        w = Math.min(1, (160 - sp) / 80);
      tL += (smp(MC_JUMP.tL, u)! - tL) * w;
      tR += (smp(MC_JUMP.tR, u)! - tR) * w;
      kL += (smp(MC_JUMP.kL, u)! - kL) * w;
      kR += (smp(MC_JUMP.kR, u)! - kR) * w;
      ln += (smp(MC_JUMP.ln, u)! - ln) * w;
      cx += (smp(MC_JUMP.cx, u)! - cx) * w;
      toe = 0.45 * (1 - w) + 0.6 * w * Math.min(1, u * 6, (1 - u) * 3); // pointed off the floor, flexing to land
    }
  }
  if (md === "c" || md === "s") {
    st = ST.shot;
    gR = 0.55;
    gL = 0.45;
    cy = 0;
    if (p.z > 2) toe = 0.5;
  }
  if (md === "c") {
    wR = -0.5;
    wL = -0.2;
    zL = -0.08;
    aL = aR = 1;
    eL = eR = 1.7;
    cr = 0.5;
    if (PRO && p.sg) {
      // personal load: ball height at the gather and elbow flare
      aR -= (p.sg.dp || 0) * 0.5;
      aL -= (p.sg.dp || 0) * 0.4;
      sz += p.sg.f || 0;
      cr += (p.sg.k || 0) * 0.6;
    }
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
    if (PRO && Math.hypot(hoop(p.tm) - p.x, HY - p.y) < 95) {
      // gather step into a layup / dunk: long last stride, ball ripped to the chest with both hands, lead knee rising
      const g2 = Math.min(1, p.t / 0.15);
      tL = 0.25 + 0.55 * g2;
      kL = 0.5 + 0.5 * g2;
      tR = -0.45;
      kR = 0.55;
      ln = 0.22;
      cr = 0.25;
      aL = aR = 1.15;
      eL = eR = 1.75;
      sz = zL = -0.05;
      wR = wL = -0.3;
    } else if (PRO) {
      // catch-and-dip: the ball drops toward the hip and comes back up into the shot pocket as the knees load
      const dk = Math.sin(Math.min(1, p.t / 0.2) * Math.PI);
      aR -= 0.45 * dk;
      aL -= 0.4 * dk;
      eR += 0.2 * dk;
      cr += 0.15 * dk;
      kL += 0.2 * dk;
      kR += 0.2 * dk;
    }
  } else if (md === "s" && PRO) {
    // Clip time is scaled so each clip's wrist-snap keyframe lands exactly on the sim's release (launch) moment:
    // the ball leaves the fingertips as the wrist flicks, not after the follow-through.
    const kind0 = CK[p.sv],
      rT = isLaySv(p.sv) || kind0 === "hook" ? 0.28 : p.st === 1 ? 0.3 : 0.4,
      k = Math.min(1, (p.t / rT) * (RELK[kind0] ?? 0.7)),
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
    oR = o.oR;
    oL = o.oL;
    const kind = CK[p.sv];
    if (kind !== "hang" && p.z > 0) {
      // momentum shapes every jumper: drifting sideways tilts the body, fading falls back, attacking leans in
      const cf2 = Math.cos(p.f),
        sf2 = Math.sin(p.f),
        fwv = p.vx * cf2 + p.vy * sf2,
        sdv = -p.vx * sf2 + p.vy * cf2;
      ln += clamp(fwv / 650, -0.3, 0.25);
      rz += clamp(sdv / 700, -0.3, 0.3);
    }
    if (kind === "fade" && p.z > 2 && (p.olf || (p.ht >= 6.75 && p.c >= 80))) {
      // signature one-legged fadeaway (tall mid-range scorers): the off knee drives up and kicks out for space
      const w = clamp(p.z / 12, 0, 1);
      tL += 0.75 * w;
      kL += 0.95 * w;
      rz -= 0.08 * w;
    }
    if (kind === "hang") {
      // swinging under the rim, gripping the iron
      const sw = Math.sin(T * 5.5 + p.k);
      tL += sw * 0.18;
      tR += sw * 0.18;
      ln += sw * 0.06;
      gL = gR = 0.85;
    } else if ((kind === "lay" || kind === "roll" || kind === "contact") && k > 0.4 && k < 0.92) {
      // layup hand extends toward the rim around the release
      const w = Math.sin(((k - 0.4) / 0.52) * Math.PI) * 0.75,
        r1 = armIK(p, cr, hoop(p.tm), HY, 104, 1, 0.5);
      aR += (r1.a - aR) * w;
      eR += (r1.e - eR) * w;
      sz += (r1.ab - sz) * w;
    }
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
    st = ST.drib;
    gR = 0.1;
    gL = 0.3;
    cy *= 0.3; // keep the dribbling shoulder square so the hand IK lands on the ball
    {
      const u = clamp((B.z - 6) / 30, 0, 1);
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
    gL = gR = 0.1;
  } else if (pos !== p.tm) {
    st = ST.def;
    gL = gR = 0.05; // active hands
    cy = 0;
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
        if (fw < -0.3) (ln -= 0.12), (cx -= 0.06); // backpedal: sit back, short steps
      }
      hz = Math.abs(sd2) * (0.16 + 0.14 * Math.abs(s)) * spd + (def ? 0.12 : 0);
      // lateral shuffle: the lead leg opens, the trail leg closes (never crossing) - defenders and side steps
      hs = s * Math.abs(sd2) * (def ? 0.24 : 0.14) * spd * Math.sign(sd2 || 1);
      cr += Math.abs(sd2) * 0.15 * spd;
      if (def) (tL *= 0.35), (tR *= 0.35); // slides stay low and wide instead of running
      if (PRO && !(p.mvT > 0) && !p.postA && !(p.setT > 0)) {
        // Motion-captured locomotion (legs, pelvis, and the arm swing when the hands are free), chosen by what the
        // player is doing and blended by speed. The thigh swing is scaled so a step covers the sim's step length.
        let a = "walk",
          b: string | null = null,
          u = 0,
          mir = false,
          dribbling = has && md === "i";
        let near = 1e9;
        if (dribbling) for (const q of P) if (q.tm !== p.tm) near = Math.min(near, Math.hypot(q.x - p.x, q.y - p.y));
        if ((def || dribbling) && Math.abs(sd2) > 0.6 && Math.abs(fw) < 0.6) {
          a = "side";
          mir = Math.sign(sd2) > 0; // capture slides toward our R side; sd2 > 0 moves toward our L
        } else if (fw < -0.4) a = "back";
        else if (dribbling) {
          a = near < 40 && sv < 130 ? "low" : "drib";
          if (sv > 170) (b = "run"), (u = Math.min(1, (sv - 170) / 70));
        } else if (sv > 60) (b = "run"), (u = Math.min(1, (sv - 60) / 90));
        const c0 = MCC[a],
          strideC = (c0.stride + (b ? (MCC[b].stride - c0.stride) * u : 0)) * (p.ht / 6.4),
          amp = clamp(stepLen(sv) / (strideC * 1.5), 0.75, 1.45),
          w = Math.min(1, (sv - 25) / 35);
        mcBlend(a, b, u, p.ph, amp, mir);
        const m = (cur: number, k: string) => cur + (MO[MI[k]] - cur) * w;
        tL = m(tL, "tL");
        tR = m(tR, "tR");
        kL = m(kL, "kL");
        kR = m(kR, "kR");
        hz = m(hz, "hz");
        hs = m(hs, "hs");
        ln = m(ln, "ln");
        ty = m(ty, "ty");
        rz = m(rz, "rz");
        MCF = w;
        MFL = MO[MI.fL];
        MFR = MO[MI.fR];
        if (!has && !def && st === ST.run) {
          aL = m(aL, "aL");
          aR = m(aR, "aR");
          eL = m(eL, "eL");
          eR = m(eR, "eR");
          sz = m(sz, "sz");
          zL = m(zL ?? sz, "zL");
        }
        // pelvis height from the legs: the stance leg (the longer one) stands on the floor
        const ext = (t: number, k: number) => RIG.L1 * Math.cos(t) + RIG.L2 * Math.cos(t - k),
          crG = (RIG.L1 + RIG.L2 - Math.max(ext(tL, kL), ext(tR, kR))) / 0.4;
        cr += (crG - cr) * w;
      }
    } else if (def && !air) hz = 0.14;
    if (PRO && has && md === "i" && !p.postA) {
      // Dribble hand IK with EITHER hand: whichever side of the body the ball is on (works on guests too: it only
      // needs the ball position). The free arm relaxes, or becomes an arm-bar toward a close defender.
      const k2 = armIK(p, cr, B.x, B.y, Math.max(B.z, (B.dtop ?? p.z + p.ht * 5) - 8), 0, 0.6), // hand waits at the hip
        right = k2.right,
        a2 = k2.a,
        e2 = k2.e,
        ab = k2.ab;
      // closest defender: arm-bar with the free arm
      let dd = 1e9;
      for (const q of P) if (q.tm !== p.tm) dd = Math.min(dd, Math.hypot(q.x - p.x, q.y - p.y));
      const bar = dd < 45 && !(p.mvT > 0),
        fa = bar ? 0.62 : 0.4 + spd * 0.3, // arm-bar: upper arm out front, forearm across the chest at belly height
        fe = bar ? 1.35 : 1,
        fz = bar ? 0.22 : 0.12;
      if (right) {
        aR = a2;
        eR = e2;
        sz = ab;
        aL = fa;
        eL = fe;
        zL = fz;
        hL = bar ? 0.75 : 0; // (the arm-bar's forearm turns in across the body)
        gR = 0.1;
        gL = bar ? 0.15 : 0.3;
      } else {
        aL = a2;
        eL = e2;
        zL = ab;
        aR = fa;
        eR = fe;
        sz = fz;
        hR = bar ? 0.75 : 0;
        gL = 0.1;
        gR = bar ? 0.15 : 0.3;
        wL = wR;
        wR = 0;
      }
    }
    if (def && !air && (B.owner.mode === "c" || B.owner.mode === "s") && Math.hypot(B.owner.x - p.x, B.owner.y - p.y) < 70) {
      aR = 2.9;
      eR = 0.15;
      aL = 1.3;
      eL = 0.6;
    }
    if (p.pT > 0) {
      // pass follow-through by type (B.ptype: 0 chest, 1 bounce, 2 lob): arms extend from the chest, thumbs turn down
      const u = clamp(1 - p.pT / 0.25, 0, 1),
        ty2 = B.ptype | 0;
      if (ty2 === 2) {
        aL = aR = 2.0 + 0.7 * u;
        eL = eR = 1.3 - 1.0 * u;
        wR = wL = 0.9 * u;
      } else if (ty2 === 1) {
        aL = aR = 1.05 - 0.2 * u;
        eL = eR = 1.5 - 1.35 * u;
        ln += 0.18;
        cr = Math.max(cr, 0.15);
      } else {
        aL = aR = 1.25 + 0.3 * u;
        eL = eR = 1.6 - 1.45 * u;
        ln += 0.1;
      }
      oR = -1.1 * u;
      oL = 1.1 * u;
      sz = zL = 0.12;
      gL = gR = 0.1;
    }
    if (B.mode === "pass" && B.to === p && !air) {
      aL = aR = 1.35;
      eL = eR = 0.5;
      zL = 0.15;
      gL = gR = 0.2; // target hands
      st = ST.cat;
    }
  }
  if (p.mvT > 0) {
    st = ST.move;
    const e = p.mvE || 0,
      sd = p.mvS || 1;
    if (p.mvk === 2) {
      // spin: the whole body turns (root yaw p.ry, drawn by every renderer and solved by the stepping: the planted
      // foot is the pivot, the free leg swings round); eased - it winds up, whips through, settles
      const u = clamp(e / 0.45, 0, 1);
      p.ry = u * u * (3 - 2 * u) * 6.283 * sd;
      ln = 0.25;
      cr = 0.2;
    } else if (p.mvk === 1) {
      cr = e < 0.22 ? 0.55 : 0.1;
      ln = e < 0.22 ? -0.12 : 0.35;
    } else if (p.mvk === 3) {
      ty += Math.sin(e * 10) * 0.9 * sd;
      ln = 0.2;
      cr = Math.max(cr, 0.25); // sit into the between-the-legs; the hand IK carries the ball
    } else {
      ln = 0.3;
      cr = 0.2;
    }
  }
  // ---- smarter running: plant-and-cut lean, drive steps out of a standstill, braking stops ----
  {
    const hd = Math.atan2(p.vy, p.vx);
    if (sp > 60 && p.hd0 != null) {
      const dh = Math.atan2(Math.sin(hd - p.hd0), Math.cos(hd - p.hd0));
      p.trn = (p.trn || 0) * 0.75 + (dh / DT) * 0.25;
    } else p.trn = (p.trn || 0) * 0.8;
    p.hd0 = hd;
    if (md === "i" && !air && !p.postA && !(p.setT > 0) && (st === ST.run || st === ST.drib)) {
      const tr = clamp(p.trn, -9, 9),
        g = Math.abs(tr) * sp;
      rz += clamp((tr * sp) / 1400, -0.38, 0.38); // bank into the cut
      cr += Math.min(0.22, g / 5000);
      hs += Math.sign(tr) * Math.min(0.18, g / 6000); // the outside foot plants wide and pushes
      const acc = p.acc || 0;
      if (acc > 900 && sp < 150) {
        // first steps: low, long, arms pumping
        const k = Math.min(1, (acc - 900) / 1500);
        ln += 0.14 * k;
        cx += 0.06 * k;
        aL *= 1 + 0.6 * k;
        aR *= 1 + 0.6 * k;
      }
      if ((p.brk || 0) > 0.3 && sp > 40) {
        // stride stop: lead leg out in front, weight back, arms forward for balance
        const lead = s >= 0;
        tL = lead ? 0.55 : -0.12;
        kL = lead ? 0.15 : 0.75;
        tR = lead ? -0.12 : 0.55;
        kR = lead ? 0.75 : 0.15;
        cr += 0.18;
        cx -= 0.08;
        if (st === ST.run) (aL = aR = 0.55), (eL = eR = 0.7);
      }
    }
  }
  // ---- held ball (triple threat, pump fake, jab, FT routine) - body first, the hands go on the ball below ----
  const hold = has && md === "i" ? heldBall(p) : 0;
  if (PRO && hold) {
    st = ST.cat;
    if (hold === 1) {
      // triple threat: low, ball at the hip, eyes up
      cr = Math.max(cr, 0.32);
      kL = Math.max(kL, 0.6);
      kR = Math.max(kR, 0.6);
      tL = Math.max(tL, 0.35);
      tR = Math.max(tR, 0.35);
      ln = Math.max(ln, 0.22);
      hz = Math.max(hz, 0.12);
    } else if (hold === 2 && p.act === 1) {
      // pump fake: ball snaps up toward the forehead, legs straighten, then back down
      const u = Math.sin(clamp(1 - p.actT / 0.42, 0, 1) * Math.PI);
      cr = 0.3 * (1 - u);
      kL = kR = 0.6 - 0.45 * u;
      tL = tR = 0.35 - 0.25 * u;
      ln = 0.2 - 0.25 * u;
      HEADX -= 0.3 * u;
    } else if (hold === 2 && p.act === 2) {
      // jab step: the lead foot stabs out toward the jab, weight shifts onto it, ball ripped to the far hip
      const u = Math.sin(clamp(1 - p.actT / 0.38, 0, 1) * Math.PI);
      tL = 0.35 + 0.55 * u;
      kL = 0.6 + 0.3 * u;
      tR = 0.2;
      kR = 0.7;
      ln = 0.25 + 0.2 * u;
      cr = 0.35;
      ty += 0.25 * u;
    } else if (hold === 4) {
      // chinned rebound: sits down into the landing, leans over the ball, eyes up the floor
      cr = Math.max(cr, 0.3);
      ln = Math.max(ln, 0.28);
      hz = Math.max(hz, 0.16);
      cx += 0.1;
    } else if (hold === 3) {
      // free-throw routine: square to the rim, ball spun in the fingertips at the chest
      cr = 0.1;
      kL = kR = 0.25;
      tL = tR = 0.1;
      ln = 0.05;
    }
  }
  // ---- both hands on the ball: inbounds overhead, and every held-ball state ----
  if (PRO && has && md === "i" && (inb > 0 || hold)) {
    for (const sd of [1, -1]) {
      // each hand on its own side of the ball (the right side is (sin f, -cos f))
      // (aim for where the ball is going - B.tg*, set by the host's bstep - not the ball, which rides in these hands)
      const own = B.tgo === p,
        bx = own ? B.tgx : B.x,
        by = own ? B.tgy : B.y,
        bz = own ? B.tgz : B.z,
        k5 = armIK(p, cr, bx + Math.sin(fv(p)) * 3 * sd, by - Math.cos(fv(p)) * 3 * sd, bz, sd, 0.9);
      if (sd > 0) (aR = k5.a), (eR = k5.e), (sz = k5.ab);
      else (aL = k5.a), (eL = k5.e), (zL = k5.ab);
    }
    gL = gR = 0.4;
  }
  // ---- jump ball: the centers reach for the toss ----
  if (PRO && JB && air && (JB.c[0] === p || JB.c[1] === p)) {
    const kj = armIK(p, cr, B.x, B.y, B.z, 1, 0.6);
    aR = kj.a;
    eR = kj.e;
    sz = kj.ab;
    aL = 1.2;
    eL = 0.8;
  }
  // ---- one-shot actions (sim p.act / p.actT; synced online) ----
  if (PRO && p.actT > 0) {
    const a = p.act,
      T0 = a === 3 ? 1.2 : a === 4 ? 0.75 : a === 5 ? 0.5 : a === 6 ? 0.45 : 0.4,
      e = T0 - p.actT, // elapsed
      out = Math.min(1, p.actT / 0.3); // blend out at the end
    if (a === 3) {
      // fall: knocked back onto the floor (charge taken, crossed up), sits, then gets up
      st = ST.post;
      // seated on the floor, leaning back on both hands
      const fall = Math.min(1, e / 0.3) * out;
      ln = ln + (-0.55 - ln) * fall;
      cr = cr + (4.6 - cr) * fall;
      tL += (1.45 - tL) * fall;
      tR += (1.35 - tR) * fall;
      kL += (0.25 - kL) * fall;
      kR += (0.6 - kR) * fall;
      aL += (-0.75 - aL) * fall;
      aR += (-0.75 - aR) * fall;
      sz = zL = 0.35 * fall;
      eL = eR = 0.15;
      gL = gR = 0;
    } else if (a === 4) {
      // dive: horizontal, both arms stretched for the ball
      st = ST.air;
      const d = Math.min(1, e / 0.15) * out;
      ln += (1.35 - ln) * d;
      cr += (5 - cr) * d;
      aL += (2.8 - aL) * d;
      aR += (2.8 - aR) * d;
      eL = eR = 0.15;
      tL += (-0.35 - tL) * d;
      tR += (-0.2 - tR) * d;
      kL = kR = 0.3;
      gL = gR = 0.1;
    } else if (a === 5) {
      // fumble: the ball pops off his hands
      aL = aR = 1.7;
      eL = eR = 0.25;
      wL = wR = 0.6;
      ln -= 0.15;
      gL = gR = 0;
    } else if (a === 6) {
      // blocked: the shooting arm is knocked back over his head
      aR = 3.3;
      eR = 0.25;
      rz += 0.25 * out;
      ln -= 0.2 * out;
    } else if (a === 8) {
      // shoulder fake in the post: shoulders dip and turn one way
      const u = Math.sin(clamp(e / 0.4, 0, 1) * Math.PI);
      ty += 0.55 * u;
      rz += 0.2 * u;
      cr += 0.1 * u;
    }
  }
  // ---- shot block attempt: the leaper's hand goes for the ball ----
  if (PRO && air && !has && md !== "c" && md !== "s" && B.owner && B.owner.tm !== p.tm && (B.owner.mode === "c" || B.owner.mode === "s") && Math.hypot(B.x - p.x, B.y - p.y) < 40) {
    // (aimed a little in front of him and never past straight up: a ball right overhead used to flip the arm over the
    // top and back as it wobbled in front of / behind the shoulder)
    const k6 = armIK(p, cr, B.x + Math.cos(fv(p)) * 8, B.y + Math.sin(fv(p)) * 8, B.z + 4, 1, 0.8);
    aR = Math.min(armN(k6.a), 3.25);
    eR = k6.e;
    sz = k6.ab;
    aL = 2.6;
    eL = 0.3;
    gR = 0.05;
  }
  // ---- full-body reaching ----
  if (PRO && !p.postA && !(p.setT > 0) && md !== "c" && md !== "s") {
    const bd = Math.hypot(B.x - p.x, B.y - p.y);
    if (st === ST.def && B.owner && B.owner.mode === "i" && bd < 70 && !air) {
      // active hands: the ball-side hand mirrors the dribble (never touches it - steals are off)
      const w = clamp((70 - bd) / 30, 0, 1),
        tx = p.x + (B.x - p.x) * 0.7,
        ty = p.y + (B.y - p.y) * 0.7,
        k3 = armIK(p, cr, tx, ty, Math.max(18, B.z + 6), 0, 0.9);
      if (k3.right) (aR += (k3.a - aR) * w), (eR += (k3.e - eR) * w), (sz += (k3.ab - sz) * w);
      else (aL += (k3.a - aL) * w), (eL += (k3.e - eL) * w), (zL = (zL ?? sz) + (k3.ab - (zL ?? sz)) * w);
    } else if (!has && !B.owner && (B.mode === "air" || B.mode === "pass") && bd < 45 && B.z > p.z + 30 && B.z < p.z + 150 && (air || B.to === p) && !(B.sh && B.age < 0.5)) {
      // (not a shot that just left the hand: it flies by too fast to track - the swat was the block layer's job)
      // rebounds, tips and catches: both hands go to where the ball actually is (not behind him: a ball that went
      // past his back is let go, the arms don't swing backwards after it)
      const fw = (Math.cos(fv(p)) * (B.x - p.x) + Math.sin(fv(p)) * (B.y - p.y)) / (bd || 1),
        w = clamp((45 - bd) / 20, 0, 1) * clamp((fw + 0.35) / 0.5, 0, 1);
      const r1 = armIK(p, cr, B.x, B.y, B.z, 1, 1.0);
      (aR += (r1.a - aR) * w), (eR += (r1.e - eR) * w), (sz += (r1.ab - sz) * w);
      const r2 = armIK(p, cr, B.x, B.y, B.z, -1, 1.0);
      (aL += (r2.a - aL) * w), (eL += (r2.e - eL) * w), (zL = (zL ?? sz) + (r2.ab - (zL ?? sz)) * w);
      gL = gR = 0.2;
    }
  }
  // ---- hedge: the screener's defender jumps out wide, arms spread, to stop the handler turning the corner ----
  if (PRO && (p.hdgT || 0) > 0 && !has && !air && md === "i") {
    const w = Math.min(1, p.hdgT * 6);
    aL += (0.85 - aL) * w;
    aR += (0.85 - aR) * w;
    sz += (1.15 - sz) * w;
    zL = (zL ?? sz) + (1.15 - (zL ?? sz)) * w;
    eL += (0.35 - eL) * w;
    eR += (0.35 - eR) * w;
    cr = Math.max(cr, 0.28 * w);
    gL = gR = 0.05;
  }
  // ---- "Switch!": the defenders point at the man they just picked up ----
  if (PRO && (p.swT || 0) > 0 && !has && !air && md === "i" && p.man != null && P[p.man]) {
    const m = P[p.man],
      w = Math.min(1, p.swT * 4) * Math.min(1, (0.7 - p.swT) * 8 + 0.2),
      f = fv(p),
      sd = Math.sin(f) * (m.x - p.x) - Math.cos(f) * (m.y - p.y) > 0 ? 1 : -1,
      k = armIK(p, cr, m.x, m.y, p.z + p.ht * 7.4, sd, 0.9),
      a = Math.min(k.a, 1.7);
    if (sd > 0) (aR += (a - aR) * w), (eR += (0.1 - eR) * w), (sz += (k.ab - sz) * w), (gR = 0.6);
    else (aL += (a - aL) * w), (eL += (0.1 - eL) * w), (zL = (zL ?? sz) + (k.ab - (zL ?? sz)) * w), (gL = 0.6);
  }
  // ---- timeout huddle: hands in the middle ("1-2-3 ...!") ----
  if (PRO && (p.hudT || 0) > 0 && !has && !air && p.hcx != null) {
    const zc = p.z + p.ht * 7.6;
    for (const sd of [1, -1]) {
      const k = armIK(p, cr, p.hcx + Math.sin(fv(p)) * 2 * sd, p.hcy - Math.cos(fv(p)) * 2 * sd, zc, sd, 0.6);
      if (sd > 0) (aR = k.a), (eR = k.e), (sz = k.ab);
      else (aL = k.a), (eL = k.e), (zL = k.ab);
    }
    gL = gR = 0.1;
    ln += 0.12;
  }
  // ---- help defender meeting the drive: brace for the charge (forearms across the chest), or go straight up with
  //      both arms (verticality) once the driver leaves his feet ----
  if (PRO && (p.helpT || 0) > 0 && !has && md === "i" && B.owner && B.owner.tm !== p.tm) {
    const dv = B.owner,
      d = Math.hypot(dv.x - p.x, dv.y - p.y),
      w = clamp((60 - d) / 25, 0, 1) * Math.min(1, p.helpT * 5);
    if (w > 0) {
      if (dv.mode === "c" || dv.mode === "s") {
        aL += (2.95 - aL) * w;
        aR += (2.95 - aR) * w;
        eL += (0.15 - eL) * w;
        eR += (0.15 - eR) * w;
        sz += (0.12 - sz) * w;
        zL = (zL ?? sz) + (0.12 - (zL ?? sz)) * w;
        gL = gR = 0.05;
      } else if (!air) {
        aL += (0.55 - aL) * w;
        aR += (0.55 - aR) * w;
        eL += (2.0 - eL) * w;
        eR += (2.0 - eR) * w;
        hL += (0.95 - hL) * w;
        hR += (0.95 - hR) * w;
        sz += (0.25 - sz) * w;
        zL = (zL ?? sz) + (0.25 - (zL ?? sz)) * w;
        ln += 0.08 * w;
        cr = Math.max(cr, 0.25 * w);
        gL = gR = 0.7;
      }
    }
  }
  // ---- chop steps: a handler sizing up a close defender keeps his feet alive ----
  if (PRO && has && md === "i" && !hold && sp < 45 && !(p.mvT > 0) && !p.postA && !air) {
    let near = 1e9;
    for (const q of P) if (q.tm !== p.tm) near = Math.min(near, Math.hypot(q.x - p.x, q.y - p.y));
    if (near < 50) {
      const c2 = Math.sin(T * 22 + p.k),
        w = Math.min(1, (50 - near) / 20) * (1 - sp / 45);
      tL += (0.25 + c2 * 0.1 - tL) * w;
      tR += (0.25 - c2 * 0.1 - tR) * w;
      kL += (0.55 + Math.max(0, c2) * 0.25 - kL) * w;
      kR += (0.55 + Math.max(0, -c2) * 0.25 - kR) * w;
      cr = Math.max(cr, 0.28 * w);
    }
  }
  // ---- defenders: hand-check a driver, squeeze over screens, point at their man ----
  if (PRO && pos !== p.tm && B.owner && md === "i" && !air) {
    const o = B.owner,
      dd = Math.hypot(o.x - p.x, o.y - p.y);
    if (dd < 24 && Math.hypot(o.vx, o.vy) > 140) {
      // hand on the driver's hip
      const k8 = armIK(p, cr, o.x, o.y, o.z + o.ht * 5, -1, 0.9);
      aL = k8.a;
      eL = k8.e;
      zL = k8.ab;
      gL = 0.1;
    }
    if (p.scr > 0) {
      // fighting over a screen: turn the shoulders sideways, arms tucked
      ty += 1.0;
      aL = aR = 0.5;
      eL = eR = 1.7;
      sz = -0.2;
      zL = -0.2;
    } else if (!(p.helpT > 0) && !(p.rotT > 0) && !(p.hdgT > 0) && Math.hypot(o.vx, o.vy) < 260) {
      // help side "pistols": away from the ball, one hand points at the ball, the other at his man (eased in with the
      // distance, so it never switches on with a pop)
      const bd = Math.hypot(B.x - p.x, B.y - p.y),
        mk = p.manT > 0 && p.man != null ? P[p.man] : guardOf(p),
        w = clamp((bd - 150) / 70, 0, 1);
      if (mk && mk !== o && w > 0) {
        const f = fv(p),
          bs = Math.sin(f) * (B.x - p.x) - Math.cos(f) * (B.y - p.y) > 0 ? 1 : -1, // ball on his right?
          zc = p.z + p.ht * 5.2, // (pointing low and soft, not a scarecrow)
          // aim 40 px out along a direction between his facing and the target
          pt = (tx: number, ty: number) => {
            const dx = tx - p.x,
              dy = ty - p.y,
              l = Math.hypot(dx, dy) || 1,
              ux = (dx / l) * 0.55 + Math.cos(f) * 0.45,
              uy = (dy / l) * 0.55 + Math.sin(f) * 0.45,
              m = Math.hypot(ux, uy) || 1;
            return [p.x + (ux / m) * 40, p.y + (uy / m) * 40];
          },
          b2 = pt(B.x, B.y),
          m2 = pt(mk.x, mk.y),
          kb = armIK(p, cr, b2[0], b2[1], zc, bs, 0.7),
          km = armIK(p, cr, m2[0], m2[1], zc, -bs, 0.7),
          ab = Math.min(kb.a, 1.3),
          am = Math.min(km.a, 1.2);
        if (bs > 0) {
          (aR += (ab - aR) * w), (eR += (0.35 - eR) * w), (sz += (kb.ab - sz) * w);
          (aL += (am - aL) * w), (eL += (0.45 - eL) * w), (zL = (zL ?? sz) + (km.ab - (zL ?? sz)) * w);
        } else {
          (aL += (ab - aL) * w), (eL += (0.35 - eL) * w), (zL = (zL ?? sz) + (kb.ab - (zL ?? sz)) * w);
          (aR += (am - aR) * w), (eR += (0.45 - eR) * w), (sz += (km.ab - sz) * w);
        }
        gL = gR = 0.55; // index finger out
      }
      // one pass away: deny - the ball-side hand goes into the passing lane between the ball and his man
      const wd = clamp((150 - bd) / 40, 0, 1) * clamp((bd - 60) / 30, 0, 1);
      if (mk && mk !== o && wd > 0 && Math.hypot(mk.x - p.x, mk.y - p.y) < 60) {
        const lx = mk.x + (B.x - mk.x) * 0.3,
          ly = mk.y + (B.y - mk.y) * 0.3,
          f = fv(p),
          bs = Math.sin(f) * (lx - p.x) - Math.cos(f) * (ly - p.y) > 0 ? 1 : -1,
          kd = armIK(p, cr, lx, ly, p.z + p.ht * 6.2, bs, 0.9),
          ad = Math.min(kd.a, 1.6);
        if (bs > 0) (aR += (ad - aR) * wd), (eR += (0.25 - eR) * wd), (sz += (kd.ab - sz) * wd), (gR = 0.1);
        else (aL += (ad - aL) * wd), (eL += (0.25 - eL) * wd), (zL = (zL ?? sz) + (kd.ab - (zL ?? sz)) * wd), (gL = 0.1);
        cr = Math.max(cr, 0.3 * wd); // down in a stance
      }
    }
  }
  // ---- offense off the ball: open teammates call for it ----
  if (PRO && pos === p.tm && !has && B.owner && B.owner.tm === p.tm && md === "i" && !air && !(p.setT > 0)) {
    let open = 1e9;
    for (const q of P) if (q.tm !== p.tm) open = Math.min(open, Math.hypot(q.x - p.x, q.y - p.y));
    if (open > 50 && Math.hypot(B.owner.vx, B.owner.vy) < 120 && Math.sin(T * 1.3 + p.k * 2.1) > 0.4) {
      aR = 2.6;
      eR = 0.25;
      sz = 0.25;
      gR = 0.05;
      LOOK.x = B.owner.x;
      LOOK.y = B.owner.y;
      LOOK.z = B.owner.z + 60;
      LOOK.on = 1;
    }
  }
  // ---- Pro Play v3 ----
  if (PRO) {
    // closeout: a defender flying at the ball handler gets a hand up on the way, then breaks down with short choppy
    // steps (butt low, weight back) so he can't be blown by; the high hand takes the shot side, the low hand the drive
    const o = B.owner;
    if (o && o.tm !== p.tm && !air && md === "i" && !(p.hupT > 0) && !(p.celT > 0)) {
      const dx = o.x - p.x,
        dy = o.y - p.y,
        d = Math.hypot(dx, dy) || 1,
        ap = (p.vx * dx + p.vy * dy) / d;
      if (d < 140 && d > 14 && ap > 50) {
        const w = clamp((ap - 50) / 110, 0, 1) * clamp((140 - d) / 50, 0, 1),
          brk = clamp((85 - d) / 40, 0, 1) * w, // breaking down: chop steps
          shoot = o.mode === "c" || o.mode === "s" ? 1 : 0.65,
          ch = Math.sin(T * 27 + p.k * 1.3);
        aR += (2.2 + 0.7 * shoot - aR) * w;
        eR += (0.5 - 0.35 * shoot - eR) * w;
        sz += (0.2 - sz) * w;
        aL += (0.75 - aL) * w;
        eL += (0.7 - eL) * w;
        gR = 0.05;
        tL += (0.42 + ch * 0.12 - tL) * brk;
        tR += (0.42 - ch * 0.12 - tR) * brk;
        kL += (0.95 + Math.max(0, ch) * 0.2 - kL) * brk;
        kR += (0.95 + Math.max(0, -ch) * 0.2 - kR) * brk;
        ln += (0.24 - ln) * brk;
        cr = Math.max(cr, 0.5 * brk);
        toe += 0.15 * brk; // up on the balls of the feet
      }
    }
    // calling for the ball: an open shooter (nobody within 90 px) on the perimeter raises a hand and shouts for it,
    // in short bursts so the floor looks alive rather than everyone waving at once
    if (o && o.tm === p.tm && o !== p && !air && md === "i" && !(p.celT > 0) && !(p.setT > 0) && !p.postA && inb <= 0 && !ftq) {
      const dh = Math.hypot(o.x - p.x, o.y - p.y);
      let nd = 1e9;
      for (const q of P) if (q.tm !== p.tm) nd = Math.min(nd, Math.hypot(q.x - p.x, q.y - p.y));
      const cyc = (T * 0.45 + p.k * 0.37) % 1;
      if (nd > 90 && dh > 140 && dh < 420 && cyc < 0.3) {
        const w = Math.min(1, cyc / 0.06, (0.3 - cyc) / 0.06);
        aR += (2.75 - aR) * w;
        eR += (0.35 - eR) * w;
        sz += (0.35 - sz) * w;
        gR = 0.0; // open palm
        p.callT = 0.1; // the face shouts (face())
      }
    }
    // on-ball defense up close: the trail hand rides the driver's hip (feeling him), the other hand stays active
    if (o && o.tm !== p.tm && !air && md === "i" && !(p.hupT > 0) && !(p.celT > 0)) {
      const d = Math.hypot(o.x - p.x, o.y - p.y);
      if (d < 34 && d > 10 && Math.sin(T * 1.7 + p.k) > -0.3) {
        const r = armIK(p, cr, o.x - Math.cos(o.f) * 3, o.y - Math.sin(o.f) * 3, o.z + o.ht * 4.4, 0, 0.9),
          w = clamp((34 - d) / 10, 0, 1) * (r.over < 0.4 ? 1 : 0);
        if (r.right) (aR += (r.a - aR) * w), (eR += (r.e - eR) * w), (sz += (r.ab - sz) * w), (gR = 0.1);
        else (aL += (r.a - aL) * w), (eL += (r.e - eL) * w), (zL = (zL ?? sz) + (r.ab - (zL ?? sz)) * w), (gL = 0.1);
      }
    }
    // contest with a hand up, feet on the floor (vs a pump faker)
    if ((p.hupT || 0) > 0 && !air && !has) {
      const w = Math.min(1, p.hupT * 4);
      aR += (2.95 - aR) * w;
      eR += (0.05 - eR) * w;
      sz += (0.12 - sz) * w;
      aL += (1.3 - aL) * w;
      eL += (0.6 - eL) * w;
      gR = 0.05;
    }
    // pass styles: behind the back (throwing arm swings behind the hip), no-look (head away from the target)
    if (p.pT > 0 && p.pk) {
      const u = clamp(1 - p.pT / 0.25, 0, 1);
      if (p.pk === 2) {
        aR = -0.55 - 0.35 * u;
        eR = 1.2 - 0.6 * u;
        sz = 0.35;
        oR = -0.9 * u;
        aL = 0.4;
        eL = 0.5;
        ty -= 0.25;
      } else if (p.pk === 1) {
        LOOK.x = p.x + Math.cos(p.f) * 200;
        LOOK.y = p.y + Math.sin(p.f) * 200;
        LOOK.z = 70;
        LOOK.on = 1;
      } else if (p.pk === 3) {
        // wraparound: one arm sweeps around the defender's hip
        aR = 0.9 + 0.3 * u;
        eR = 0.4;
        sz = 0.9 - 0.7 * u;
        aL = 0.5;
        ln += 0.2;
        cr = Math.max(cr, 0.25);
      }
    }
    // one-hand catch on the run
    if (B.mode === "pass" && B.to === p && !air && sp > 150) {
      aL = 0.35;
      eL = 0.5;
      zL = 0.1;
    }
    // double clutch: the ball comes down under the contest, then back up to the release
    if (md === "s" && (p.dcl || 0) >= 0.09 && !p.rl) {
      const w = clamp(Math.sin(((p.t - 0.14) / 0.3) * Math.PI), 0, 1);
      aR -= 0.95 * w;
      eR += 0.55 * w;
      aL -= 0.8 * w;
      eL += 0.45 * w;
      ln += 0.18 * w;
      cr += 0.05 * w;
    }
    // planting the outside foot on a hard cut: sit down and lean back against the momentum
    if ((p.plantT || 0) > 0 && !air && md === "i") {
      const w = Math.min(1, p.plantT * 6);
      cr += 0.28 * w;
      ln -= 0.3 * w;
      hs += 0.12 * w;
    }
    // body english: lean with the ball on the rim, arms out like you can steer it
    if ((p.engT || 0) > 0 && !has) {
      const w = Math.min(1, p.engT * 5),
        s2 = p.eng || 0;
      rz += -0.35 * s2 * w;
      ty += 0.2 * s2 * w;
      aL += (1.0 - aL) * w;
      aR += (1.0 - aR) * w;
      eL += (0.45 - eL) * w;
      eR += (0.45 - eR) * w;
      sz += (0.65 - sz) * w;
      zL = (zL ?? sz) + (0.65 - (zL ?? sz)) * w;
    }
  }
  // ---- free throws: players along the lane lean in, ready to box out ----
  if (PRO && ftq && ftq.s !== p && md === "i" && Math.abs(hoop(ftq.s.tm) - p.x) < 150 && Math.abs(p.y - HY) < 70) {
    cr = 0.32;
    ln = 0.3;
    tL = tR = 0.35;
    kL = kR = 0.7;
    hz = 0.22;
    aL = aR = 0.75;
    eL = eR = 1.1;
    sz = zL = 0.35;
  }
  // ---- fatigue body language: shoulders slump, head forward, shorter arm swing ----
  {
    const tired = clamp((0.6 - (p.en ?? 1)) / 0.4, 0, 1);
    if (tired > 0 && md === "i" && !air) {
      cx += 0.14 * tired;
      ln += 0.06 * tired;
      HEADX += 0.18 * tired;
      if (!has) (aL *= 1 - 0.4 * tired), (aR *= 1 - 0.4 * tired);
    }
  }
  // Planted screener: wide base, knees bent, arms folded across the chest.
  if (p.setT > 0 && md === "i" && !air && !has) {
    st = ST.scr;
    gL = gR = 0.9;
    hs = 0;
    hz = 0.32;
    cr = 0.3;
    kL = kR = 0.55;
    tL = tR = 0.25;
    // (forearms folded across the stomach: the upper arms turn in about the bone, elbows tucked)
    aL = aR = 0.4;
    eL = eR = 1.85;
    hL = hR = 1.15;
    sz = zL = 0.08;
    ln = 0.08;
  }
  // Pro Play contact + weight: bumps rock the torso away from the hit, landings sink into the knees,
  // and players lean into acceleration.
  if (PRO) {
    if (p.landT > 0 && md !== "s") {
      const k = p.landT / 0.28;
      // landing: feet split (one lands first) and the drift carries the stance sideways
      tL += 0.22 * k;
      tR -= 0.12 * k;
      hs += clamp((-p.vx * Math.sin(p.f) + p.vy * Math.cos(p.f)) / 600, -0.25, 0.25) * k;
      cr += 0.4 * k;
      kL += 0.55 * k;
      kR += 0.55 * k;
      tL += 0.3 * k;
      tR += 0.3 * k;
      ln += 0.12 * k;
    }
    if (md === "i" && !air) ln += clamp((p.acc || 0) / 2600, -0.14, sp < 150 ? 0.28 : 0.2);
  }
  if (p.postA) {
    st = ST.post;
    cr = 0.45;
    ln = 0.25;
    sz = 0.8;
    aL = 1.2;
  }
  // Signature celebration (CEL): arms and torso blend into the move while the legs keep running.
  // Hands on knees: catching a breath at dead balls (free throws, after makes) when tired or lined up.
  const onLane = !!ftq && ftq.s !== p && Math.abs(hoop(ftq.s.tm) - p.x) < 150 && Math.abs(p.y - HY) < 70;
  if (md === "i" && !has && !air && sp < 15 && !(p.celT > 0) && !(p.setT > 0) && onLane) {
    // lined up on the lane: knees bent, weight forward, hands out ready to box out on the miss
    cr = Math.max(cr, 0.3);
    tL = tR = 0.35;
    kL = kR = 0.45;
    ln = 0.18;
    aL = aR = 0.75;
    eL = eR = 1.15;
    sz = zL = 0.55;
    gL = gR = 0.15;
  } else if (md === "i" && !has && !air && sp < 15 && !(p.celT > 0) && !(p.setT > 0) && ftq && ftq.s !== p && p.k % 2 === 1) {
    // behind the arc at a free throw: hands on the hips (the others rest on their knees)
    aL = aR = -0.15;
    sz = zL = 0.62;
    eL = eR = 1.55;
    hL = hR = 1.25;
    cx = -0.05 + Math.sin(T * 2 + p.k) * 0.04;
    gL = gR = 0.35;
  } else if (md === "i" && !has && !air && sp < 15 && !(p.celT > 0) && !(p.setT > 0) && (ftq ? ftq.s !== p && !onLane : rs > 0.3 && (p.en ?? 1) < 0.75)) {
    st = ST.rest;
    ln = 0.55;
    cx = 0.22;
    cr = 0.32;
    tL = tR = 0.55;
    kL = kR = 0.62;
    aL = aR = 0.62;
    eL = eR = 0.35;
    sz = 0.22;
    zL = 0.22;
    hz = 0.14;
    gL = gR = 0.35;
  } else if (md === "i" && !has && !air && sp >= 15 && sp < 110 && (p.en ?? 1) < 0.6 && (rs > 0.3 || ftq) && !(p.celT > 0) && !(p.setT > 0)) {
    // gassed, walking at a dead ball: arms hang heavy, shoulders slump, a big breath (arms and chest only - the legs
    // keep walking)
    const br = Math.sin(T * 2.4 + p.k) * 0.06;
    // hands on the hips: elbows out, forearms turned in to the hip bones, chest heaving
    aL = aR = -0.15;
    sz = zL = 0.62;
    eL = eR = 1.55;
    hL = hR = 1.25;
    cx = -0.05 + br;
    gL = gR = 0.35;
  }
  if (p.celT > 0 && p.cel && md === "i" && !has && !air && !p.postA && !(p.setT > 0)) {
    st = ST.cel;
    const e = CEL_T - p.celT,
      k = Math.min(1, e / 0.2, p.celT / 0.35),
      m = (a: number, b: number) => a + (b - a) * k,
      zl = zL == null ? sz : zL;
    switch (p.cel) {
      case 1: // shimmy: elbows tucked, shoulders shake (the chest shakes over still hips)
        cy += Math.sin(e * 50) * 0.25 * k;
        gL = gR = m(gR, 0.6);
        aL = m(aL, 0.45);
        aR = m(aR, 0.45);
        eL = m(eL, 1.75);
        eR = m(eR, 1.75);
        sz = m(sz, 0.3);
        zL = m(zl, 0.3);
        ty += Math.sin(e * 50) * 0.08 * k;
        rz += Math.sin(e * 50) * 0.07 * k;
        ln = m(ln, -0.05);
        break;
      case 2: // night night: hands together beside the cheek, head tilted onto them
        HEADX = 0.35 * k;
        aR = m(aR, 2.45);
        eR = m(eR, 2.5);
        aL = m(aL, 2.25);
        eL = m(eL, 2.45);
        sz = m(sz, -0.15);
        zL = m(zl, -0.6);
        rz = m(rz, 0.24);
        ty = m(ty, 0.2);
        break;
      case 3: // front double-bicep flex with a pump: upper arms out level, forearms turned up (external rotation)
        gL = gR = m(gR, 1);
        aL = aR = m((aL + aR) / 2, 0.15);
        eL = eR = m((eL + eR) / 2, 1.75 + Math.sin(e * 12) * 0.18);
        hL = m(hL, -1.45);
        hR = m(hR, -1.45);
        sz = m(sz, 1.45);
        zL = m(zl, 1.45);
        ln = m(ln, -0.14);
        cr = m(cr, 0.15);
        break;
      case 4: // both arms up, three fingers to the crowd, pumping
        gL = gR = m(gR, 0.4);
        HEADX = -0.35 * k;
        aL = m(aL, 2.7 + Math.sin(e * 10) * 0.15);
        aR = m(aR, 2.7 + Math.sin(e * 10 + 1) * 0.15);
        eL = m(eL, 0.35);
        eR = m(eR, 0.35);
        sz = m(sz, 0.35);
        zL = m(zl, 0.35);
        ln = m(ln, -0.16);
        break;
      case 5: // chest thump, chin up
        gR = m(gR, 1);
        aR = m(aR, 1.25);
        eR = m(eR, 2.25 + Math.max(0, Math.sin(e * 15)) * 0.35);
        sz = m(sz, -0.45);
        aL = m(aL, 0.35);
        zL = m(zl, 0.6);
        ln = m(ln, -0.16);
        break;
      case 6: // power roar: crouched, arms flexed down and out
        gL = gR = m(gR, 1);
        aL = m(aL, 0.45);
        aR = m(aR, 0.45);
        eL = m(eL, 1.0);
        eR = m(eR, 1.0);
        sz = m(sz, 0.95);
        zL = m(zl, 0.95);
        ln = m(ln, 0.28);
        cr = m(cr, 0.35);
        break;
      case 7: // shh: finger to the lips, looking around the arena
        aR = m(aR, 2.2);
        eR = m(eR, 2.55);
        sz = m(sz, -0.3);
        aL = m(aL, 0.2);
        eL = m(eL, 0.35);
        ty += Math.sin(e * 2.2) * 0.35 * k;
        break;
      case 11: // missed an open look: hands on the head
        aL = m(aL, 2.55);
        aR = m(aR, 2.55);
        eL = m(eL, 2.2);
        eR = m(eR, 2.2);
        sz = m(sz, 0.75);
        zL = m(zl, 0.75);
        HEADX = -0.25 * k;
        break;
      case 12: {
        // arguing the call: arms out, palms up, shrug
        const sh = Math.sin(e * 7) * 0.15;
        aL = m(aL, 0.9 + sh);
        aR = m(aR, 0.9 - sh);
        eL = m(eL, 0.9);
        eR = m(eR, 0.9);
        sz = m(sz, 0.55);
        zL = m(zl, 0.55);
        oL = m(oL, 1.3);
        oR = m(oR, -1.3);
        gL = gR = m(gR, 0.05);
        break;
      }
      case 13: {
        // hyping a teammate: clapping in front of the chest
        const cl = Math.abs(Math.sin(e * 9));
        aL = m(aL, 1.35);
        aR = m(aR, 1.35);
        eL = m(eL, 0.9);
        eR = m(eR, 0.9);
        sz = m(sz, -0.15 + 0.5 * cl);
        zL = m(zl, -0.15 + 0.5 * cl);
        break;
      }
      case 15:
        // dead-ball fidget: left hand tugs the jersey at the chest, eyes down
        aL = m(aL, 0.55);
        eL = m(eL, 1.95);
        zL = m(zl, -0.45);
        gL = m(gL, 0.8);
        HEADX = 0.2 * k;
        break;
      case 16: {
        // helping a teammate up: reach down and pull
        const f2 = p.helpP;
        if (f2) {
          const pull = e > 0.45 ? (e - 0.45) * 0.6 : 0,
            k16 = armIK(p, cr, f2.x, f2.y, 18 + pull * 40, 1, 0.95);
          aR = m(aR, k16.a);
          eR = m(eR, k16.e);
          sz = m(sz, k16.ab);
          gR = m(gR, 0.7);
          ln = m(ln, 0.45 - pull);
          cr = m(cr, 0.35);
          LOOK.x = f2.x;
          LOOK.y = f2.y;
          LOOK.z = 10;
          LOOK.on = 1;
        }
        break;
      }
      case 14:
        // swat hold: the blocking arm stays up, staring him down
        aR = m(aR, 2.85);
        eR = m(eR, 0.2);
        wR = m(wR, -0.5);
        gR = m(gR, 0.05);
        ln = m(ln, -0.12);
        break;
      case 10: {
        // held follow-through (gooseneck) after a green, released after ~1 s
        const h = e < 1.3 ? 1 : Math.max(0, 1 - (e - 1.3) / 0.3);
        aR = m(aR, aR + (2.75 - aR) * h);
        eR = m(eR, eR + (0.15 - eR) * h);
        wR = 1.15 * h;
        gR = m(gR, 0.2);
        break;
      }
      case 9: {
        // dap / low five with the nearest teammate (after a made free throw)
        let mate: Player | null = null,
          bd2 = 1e9;
        for (const o of P)
          if (o !== p && o.tm === p.tm) {
            const d = Math.hypot(o.x - p.x, o.y - p.y);
            if (d < bd2) (bd2 = d), (mate = o);
          }
        const reach = e < 0.7 ? Math.sin((e / 0.7) * Math.PI) : 0;
        aR = m(aR, 0.5 + reach * 0.9);
        eR = m(eR, 0.9 - reach * 0.6);
        sz = m(sz, -0.15);
        gR = m(gR, 0.1);
        if (mate) LOOK.x = mate.x, LOOK.y = mate.y, LOOK.z = mate.z + mate.ht * 9, LOOK.on = 1;
        break;
      }
      case 8: // point to the sky
        aR = m(aR, 2.95);
        eR = m(eR, 0.12);
        aL = m(aL, e > 0.6 ? 2.7 : 0.3);
        eL = m(eL, e > 0.6 ? 0.2 : 0.8);
        sz = m(sz, 0.15);
        zL = m(zl, 0.15);
        ln = m(ln, -0.22);
        gL = gR = m(gR, 0.8);
        HEADX = -0.5 * k; // eyes to the sky
        break;
    }
  }
  // ---- box-outs and post battles: bodies lean into each other ----
  if (md === "i" && !air && !has && !(p.setT > 0) && !(p.celT > 0)) {
    let o: Player | null = null,
      od = 1e9;
    for (const q of P)
      if (q.tm !== p.tm) {
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < od) (od = d), (o = q);
      }
    const shotUp = !B.owner && (B.mode === "air" || B.sh) && B.z > 20;
    if (o && od < 22 && shotUp && Math.hypot(hoop(1 - p.tm) - p.x, HY - p.y) < 130) {
      // box-out (defense of that basket): sit low and wide, arms out to feel the man behind
      st = ST.post;
      cr = Math.max(cr, 0.38);
      hz = Math.max(hz, 0.3);
      aL = aR = 0.85;
      eL = eR = 1.05;
      sz = 0.9;
      zL = 0.9;
      ln = 0.12;
      gL = gR = 0.1;
    } else if (o && od < 22 && o.postA && B.owner === o) {
      // fronting the post: forearm in his back, leaning into him
      st = ST.post;
      ln += 0.22;
      cr = Math.max(cr, 0.3);
      aL = 1.0;
      eL = 1.45;
      zL = 0.1;
    }
  }
  // ---- secondary motion (light ragdoll): a damped spring on the torso. Contact impulses (sized by the hit, so the
  // momentum of the collision carries into the reaction) and the body's own inertia when speeding up, stopping or
  // cutting drive it; it overshoots and settles. Big hits make the arms flail for balance and force a recovery step.
  if (PRO) {
    const cf = Math.cos(p.f),
      sf = Math.sin(p.f),
      ax = (p.vx - (p.svx ?? p.vx)) / DT,
      ay = (p.vy - (p.svy ?? p.vy)) / DT;
    p.svx = p.vx;
    p.svy = p.vy;
    const afw = clamp(ax * cf + ay * sf, -6000, 6000),
      asd = clamp(-ax * sf + ay * cf, -6000, 6000);
    if ((p.hitT || 0) > (p.hit0 || 0) + 0.01) {
      const hfw = (p.hitX || 0) * cf + (p.hitY || 0) * sf,
        hsd = -(p.hitX || 0) * sf + (p.hitY || 0) * cf;
      p.sfv = (p.sfv || 0) + hfw * p.hitT * 13;
      p.ssv = (p.ssv || 0) + hsd * p.hitT * 13;
    }
    p.hit0 = p.hitT || 0;
    const air2 = p.z > 2 ? 0.4 : 1; // no footing in the air: softer
    p.sfv = (p.sfv || 0) + (-110 * (p.sf || 0) - 12 * (p.sfv || 0) - (md === "i" ? afw * 0.007 * air2 : 0)) * DT;
    p.ssv = (p.ssv || 0) + (-110 * (p.ss || 0) - 12 * (p.ssv || 0) - (md === "i" ? asd * 0.007 * air2 : 0)) * DT;
    p.sf = clamp((p.sf || 0) + p.sfv * DT, -0.55, 0.55);
    p.ss = clamp((p.ss || 0) + p.ssv * DT, -0.55, 0.55);
    ln += p.sf;
    rz += p.ss * 0.9;
    cx += p.sf * 0.4;
    // the head and loose arms trail the torso (they lag its spring velocity)
    HEADX -= p.sf * 0.55;
    if (md === "i" && !has) {
      aL -= clamp(p.sfv * 0.06, -0.3, 0.3);
      aR -= clamp(p.sfv * 0.06, -0.3, 0.3);
    }
    const wob = Math.hypot(p.sf, p.ss);
    if (wob > 0.12 && md === "i" && !has) {
      // balance: arms out, a quick step to catch the fall
      const k = Math.min(1, (wob - 0.12) / 0.25);
      sz += 0.7 * k;
      zL = (zL ?? sz) + 0.7 * k;
      aL += 0.4 * k;
      aR += 0.4 * k;
      hs += clamp(-p.ss * 0.9, -0.3, 0.3);
      tL += p.sf * 0.5;
      tR += p.sf * 0.5;
    }
  }
  // ---- additive layer: breathing (deeper when tired) ----
  {
    const tired = 1 - (p.en ?? 1);
    cx += Math.sin(T * (2.1 + tired * 3) + p.k * 1.7) * (0.012 + tired * 0.05);
  }
  // ---- feet: flat on the floor through stance, toe-off behind the body, pointed in the air ----
  let fL = tL - kL + toe + (st === ST.run || st === ST.drib ? Math.max(0, -tL - 0.12) * 0.9 * spd : 0),
    fR = tR - kR + toe + (st === ST.run || st === ST.drib ? Math.max(0, -tR - 0.12) * 0.9 * spd : 0);
  if (MCF > 0 && !air) (fL += (MFL - fL) * MCF), (fR += (MFR - fR) * MCF); // captured ankles (heel-strike, toe-off)
  MCF = 0;
  // ---- head tracking: everyone follows the ball; the handler and shooters read the rim ----
  let hy = 0,
    hp = 0,
    hyT = 0,
    hpT = 0;
  const nk = -(ln + cx) * 0.35;
  {
    // idle glance: off the ball and standing at a dead ball, eyes wander (bench, crowd, a teammate) now and then
    const gl0 = Math.sin(T * 0.37 + p.k * 2.1);
    if (!LOOK.on && !has && sp < 20 && (rs > 0 || ftq || inb > 0) && gl0 > 0.55) {
      const o = P[(p.k * 3 + Math.floor(T * 0.37 / 3)) % P.length];
      if (o && o !== p) (LOOK.x = o.x), (LOOK.y = o.y), (LOOK.z = o.z + o.ht * 9), (LOOK.on = 1);
      else (LOOK.x = p.x), (LOOK.y = p.y < 250 ? -60 : 560), (LOOK.z = 60), (LOOK.on = 1); // the crowd
    }
    if (!LOOK.on) {
      if ((has && (md === "c" || md === "s")) || (has && md === "i" && !p.postA)) {
        const hx = hoop(p.tm);
        (LOOK.x = hx), (LOOK.y = HY), (LOOK.z = 100);
        if (B.mode === "pass" && B.to) (LOOK.x = B.to.x), (LOOK.y = B.to.y), (LOOK.z = 60);
      } else (LOOK.x = B.x), (LOOK.y = B.y), (LOOK.z = B.z);
    }
    const dx = LOOK.x - p.x,
      dy = LOOK.y - p.y,
      dist = Math.hypot(dx, dy);
    if (dist > 6) {
      const d = Math.atan2(Math.sin(Math.atan2(dy, dx) - p.f), Math.cos(Math.atan2(dy, dx) - p.f)),
        hz2 = p.z + p.ht * 9.3;
      hyT = -d - ty - cy;
      hpT = Math.atan2(hz2 - LOOK.z, dist) - (ln + cx) * 0.9 - nk;
      hy = clamp(hyT, -1.25, 1.25);
      hp = clamp(hpT, -0.75, 0.8);
      hy *= 1 - 0.6 * clamp((Math.abs(hyT) - 1.8) / 0.6, 0, 1); // target behind: don't owl-turn (eases in, no snap)
    }
    hp += HEADX;
    LOOK.on = 0;
    HEADX = 0;
  }
  // ---- guide hand: on the side of the ball from the gather until the release, then it peels away ----
  if (PRO && has && (md === "c" || md === "s") && !p.postA && (!isLaySv(p.sv || 0) || p.sv === 11 || p.sv === 14 || p.sv === 15 || md === "c")) {
    const ball = palmAt(p, aR, eR, sz, wR, ln, ty, rz, cx, cy, cr);
    if (ball) {
      const lx = -Math.sin(p.f),
        ly = Math.cos(p.f),
        r2 = armIK(p, cr, ball[0] + lx * 4.2, ball[1] + ly * 4.2, ball[2] + 0.5, -1, 0.9);
      if (r2.over < 0.6) {
        const w = md === "c" ? Math.min(1, p.t / 0.12) : 1;
        // guide-hand style: 0 classic, 1 thumb flick at the release, 2 drops away early, 3 elbow flared out wide,
        // 4 rides high with the ball after the release, 5 old-school two-hand push (both wrists snap)
        const gs = (p.sg && p.sg.gs) || 0,
          k7 = md === "s" ? p.t / 0.4 : 0,
          off = gs === 2 && k7 > 0.6 ? Math.min(1, (k7 - 0.6) / 0.15) : 0;
        aL += (r2.a - aL) * w * (1 - off);
        eL += (r2.e - eL) * w * (1 - off);
        zL = (zL ?? sz) + (r2.ab - (zL ?? sz)) * w * (1 - off);
        wL = -0.35 * w;
        if (gs === 1 && k7 > 0.68) (wL = 0.7), (oL = 0.6); // thumb flick
        if (gs === 3) (zL = (zL ?? sz) + 0.28 * w), (oL = -0.35 * w); // elbow out, palm faces the ball's side
        if (gs === 4 && k7 > 0.7) {
          const u = Math.min(1, (k7 - 0.7) / 0.2); // the guide arm keeps rising beside the shooting arm
          (aL += (aR - 0.15 - aL) * u), (eL += (0.35 - eL) * u), (wL = -0.1);
        }
        if (gs === 5 && k7 > 0.66) (wL = 0.85), (aL += 0.15), (eL = Math.max(0, eL - 0.3)); // pushes through with both
        gL = 0.15;
      }
    }
  }
  // ---- left-handed shooters: the whole shot is mirrored across the body (shooting arm, guide hand, legs, twist).
  // Everything above was solved for a right-hander (guide-hand IK included); mirroring is exact, and handPos follows
  // the left hand while q.mir is set, so the release point and the 3D ball stay in the shooting hand.
  const mir = !!(p.sg && p.sg.lh) && (md === "s" || (md === "c" && has));
  if (mir) {
    let t = aL;
    (aL = aR), (aR = t), (t = eL), (eL = eR), (eR = t);
    t = zL == null ? sz : zL;
    (zL = sz), (sz = t);
    (t = wL), (wL = wR), (wR = t), (t = oL), (oL = -oR), (oR = -t), (t = gL), (gL = gR), (gR = t), (t = hL), (hL = hR), (hR = t);
    (t = tL), (tL = tR), (tR = t), (t = kL), (kL = kR), (kR = t), (t = fL), (fL = fR), (fR = t);
    (hs = -hs), (ty = -ty), (rz = -rz), (cy = -cy), (hy = -hy), (hyT = -hyT);
  }
  // ---- blend: inertialization. On a state change the old pose's offset from the new target (and its velocity)
  // decays to zero along a quintic over that state's blend time (snappy into a shot, slow into a rest), so the new
  // animation plays with no lag while the transition stays smooth (C2, no overshoot). Inside a state only a light
  // 50 ms filter smooths the targets (IK and clip switches).
  const q = p.q,
    sm = PRO && q && q.wR != null,
    INZ = cfg.INZ !== 0,
    f = sm ? 1 - Math.exp((-DT * 3) / (INZ ? Math.min(0.05, BLEND[st]) : BLEND[st])) : 1,
    o = q || (p.q = {});
  VALS[0] = tL;
  VALS[1] = tR;
  VALS[2] = kL;
  VALS[3] = kR;
  VALS[4] = aL;
  VALS[5] = aR;
  VALS[6] = clamp(eL, -0.05, 2.75); // (elbows never bend backwards)
  VALS[7] = clamp(eR, -0.05, 2.75);
  VALS[8] = sz;
  VALS[9] = cr;
  VALS[10] = ln;
  VALS[11] = rz;
  VALS[12] = ty;
  VALS[13] = wR;
  VALS[14] = wL;
  VALS[15] = zL == null ? sz : zL;
  VALS[16] = hz;
  VALS[17] = cx;
  VALS[18] = cy;
  VALS[19] = nk;
  VALS[20] = hy;
  VALS[21] = clamp(hp, -0.85, 0.8); // (the neck has limits: looking far down at a low ball is the chest's job too)
  VALS[22] = fL;
  VALS[23] = fR;
  VALS[24] = gL;
  VALS[25] = gR;
  VALS[26] = hs;
  VALS[27] = oL;
  VALS[28] = oR;
  VALS[29] = hL;
  VALS[30] = hR;
  // per joint: x/v = offset and its velocity at the last restart, t/tf = time since and blend length, b = filtered
  // target, pt/pv = last target and its velocity (to spot a target that jumps), last/lv = last output and velocity
  const I =
    p.inz ||
    (p.inz = { b: new Float64Array(NQ), x: new Float64Array(NQ), v: new Float64Array(NQ), t: new Float64Array(NQ).fill(9), tf: new Float64Array(NQ).fill(0.1), pt: new Float64Array(NQ), pv: new Float64Array(NQ), last: new Float64Array(NQ), lv: new Float64Array(NQ), ok: 0 });
  const trans = st !== p.anS && sm && I.ok,
    fromReach = p.anS === ST.cat || p.anS === ST.air; // (hands out for a catch / up for a rebound, then straight into a shot)
  if (!sm || !I.ok) for (let j = 0; j < NQ; j++) (I.b[j] = VALS[j]), (I.pt[j] = VALS[j]), (I.pv[j] = 0), (I.x[j] = 0), (I.v[j] = 0), (I.t[j] = 9);
  p.anS = st;
  I.ok = 1;
  for (let j = 0; j < NQ; j++) {
    const k = QK[j],
      v = VALS[j],
      hd = j === 20 || j === 21;
    // wR is never smoothed (the wrist flick at release must be crisp); the head turns a bit quicker than the body
    if (j === 13 || !sm) {
      o[k] = v;
      I.b[j] = v;
    } else if (!INZ) {
      I.b[j] += (v - I.b[j]) * (hd ? Math.min(1, f * 1.6) : f);
      o[k] = I.b[j];
      I.pt[j] = v;
    } else {
      // restart this joint's blend on a state change, or when its target jumps (a clip/IK/look-target switch that
      // would pop): the body carries on from where it is and eases into the new target
      // (arms move fast on purpose - dribble pushes, shot rises - so they need a bigger break; a joint that is still
      // blending only restarts for a big one, so quick legit motion never trails behind a chain of restarts)
      const W = j === 9 ? (a: number) => a : wrapPi, // cr (crouch) is a distance, every other channel an angle
        dev = Math.abs(W(v - (I.pt[j] + I.pv[j] * DT))),
        jump = dev > (hd ? 0.08 : j >= 4 && j <= 8 ? 0.25 : 0.12) * (I.t[j] < I.tf[j] ? 3 : 1);
      if (trans || jump) {
        // (from the blender's own last output: o[k] also carries the foot-placement IK, which must not leak in)
        const cur = I.has ? I.last[j] : o[k] ?? v;
        I.x[j] = W(cur - v); // joint angles are circular: 2 pi apart is the same pose (spins, IK across +-pi)
        I.v[j] = clamp(I.lv[j] - (jump ? I.pv[j] : 0), -40, 40);
        I.t[j] = 0;
        // big switches blend longer, so the catch-up never whips
        // (a state change uses that state's own blend time - snappy into a shot; inside a state, big jumps blend
        // longer so the catch-up never whips, except during shots and moves where timing is everything)
        const quick = (st === ST.shot || st === ST.move) && !hd, // (the head never snaps: a tip-in's look from the ball to the rim)
          big = Math.min(quick ? 0.1 : 0.32, 0.08 + Math.abs(I.x[j]) * (hd ? 0.12 : 0.1));
        // (into a shot: crisp, but the arms coming down from a catch / rebound reach still get a few ticks, never 2)
        I.tf[j] = trans ? Math.max(BLEND[st] * (hd ? 0.4 : 0.65), quick ? (fromReach ? Math.min(0.1, 0.02 + Math.abs(I.x[j]) * 0.05) : 0) : big * 0.75) : big;
        I.b[j] = v;
      }
      I.pv[j] = jump ? 0 : W(v - I.pt[j]) / DT; // a jump is not a velocity: predict from the new target next tick
      I.pt[j] = v;
      if (j !== 9 && Math.abs(v - I.b[j]) > Math.PI) I.b[j] = v; // the filter never runs the long way round (angles)
      I.b[j] += (v - I.b[j]) * (hd ? Math.min(1, f * 1.6) : f);
      I.t[j] += DT;
      o[k] = I.b[j] + inert(I.x[j], I.v[j], I.tf[j], I.t[j]);
    }
    I.lv[j] = (j === 9 ? o[k] - I.last[j] : wrapPi(o[k] - I.last[j])) / DT;
    I.last[j] = o[k];
    I.has = 1;
  }
  if (mir) o.wL = wL; // the (now left) shooting wrist snaps crisp, like wR does
  o.mir = mir ? 1 : 0;
  // contact (post-blend, so it holds even while the arms are still blending out of another pose):
  // - the dribble hand meets the ball at the top of every bounce,
  // - a receiver's two hands meet an incoming pass (either side of the ball) as it arrives.
  // Each arm solves for its own side; its weight eases in and out over ~60 ms and it fades out from its last solution
  // when contact ends (a pass, a shot), so the correction itself never pops; an IK branch flip is ignored.
  {
    const K = p.ctK || (p.ctK = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), // per arm: a, e, ab of the last solution + target x, y, z
      drib = PRO && has && md === "i" && !p.postA && !hold && inb <= 0 && B.mode === "held" && B.dtop != null && !(p.pT > 0) && !(p.mvT > 0 && (p.mvk === 2 || p.mvk === 3)), // (spins and behind-the-backs carry the ball on their own hand paths)
      bd = Math.hypot(B.x - p.x, B.y - p.y),
      cl = (B.vx * (p.x - B.x) + B.vy * (p.y - B.y)) / (bd || 1), // closing speed of the pass
      tta = cl > 30 ? (bd - 24) / cl : 9, // seconds until it reaches the hands
      cat = PRO && !has && B.mode === "pass" && B.to === p && tta < 0.3 && B.z < p.z + 125 && md !== "s";
    // contest: a defender close to a shooter in his gather/shot gets the ball-side hand up at the ball (late, fast)
    const sh = B.owner || (B.sh && B.age < 0.3 && !B.ft ? B.last : null), // (and just after the release: the hand stays up)
      con = PRO && !has && !air && !p.postA && sh && sh.tm !== p.tm && (sh.mode === "c" || sh.mode === "s" || !B.owner) && Math.hypot(sh.x - p.x, sh.y - p.y) < 48 && md !== "s" && md !== "c";
    let wR = 0,
      wL = 0;
    if (!con) p.ctPo = 0;
    if (con) {
      // (aim at the shooter's ball while he has it; after the release the hand stays where the ball left - same spot,
      // same arm - not chasing it)
      const P0 = p.ctP || (p.ctP = [0, 0, 0, 1]);
      if (B.owner || !p.ctPo) {
        (P0[0] = B.x), (P0[1] = B.y), (P0[2] = Math.max(B.z + 10, p.z + p.ht * 10.6));
        P0[3] = armIK(p, o.cr, P0[0], P0[1], P0[2], 0, 0.6).right ? 1 : 0;
      }
      p.ctPo = 1;
      const w = clamp((48 - Math.hypot(sh.x - p.x, sh.y - p.y)) / 14, 0, 1);
      if (P0[3]) (wR = w), (K[6] = P0[0]), (K[7] = P0[1]), (K[8] = P0[2]);
      else (wL = w), (K[9] = P0[0]), (K[10] = P0[1]), (K[11] = P0[2]);
    } else if (drib) {
      const bz = Math.max(B.z, B.dtop - 8),
        // (around the top of the bounce only: a ball still up at the chest after a catch is the other pose's business)
        wt = clamp((B.z - (B.dtop - 16)) / 8, 0, 1) * clamp((B.dtop + 12 - B.z) / 6, 0, 1);
      if (armIK(p, o.cr, B.x, B.y, bz, 0, 0.6).right) (wR = wt), (K[6] = B.x), (K[7] = B.y), (K[8] = bz);
      else (wL = wt), (K[9] = B.x), (K[10] = B.y), (K[11] = bz);
    } else if (cat) {
      // both hands go out to where the ball will be caught (a quarter second ahead), one on each side of it; a bounce
      // pass is taken at the knees, not off the floor
      const t2 = clamp(tta, 0, 0.3),
        fx = B.x + B.vx * t2,
        fy = B.y + B.vy * t2,
        fz = clamp(B.z + B.vz * t2, p.z + 24, p.z + 110),
        ux = (fx - p.x) / (Math.hypot(fx - p.x, fy - p.y) || 1),
        uy = (fy - p.y) / (Math.hypot(fx - p.x, fy - p.y) || 1),
        wt = clamp(1 - tta / 0.3, 0, 1);
      wR = wL = wt;
      (K[6] = fx + uy * 3.5), (K[7] = fy - ux * 3.5), (K[8] = fz);
      (K[9] = fx - uy * 3.5), (K[10] = fy + ux * 3.5), (K[11] = fz);
    }
    const r = Math.min(1, DT * (cat || con ? 24 : 16)),
      mode = con ? 3 : drib ? 1 : cat ? 2 : 0;
    // a switch of contact kind (the catch becomes a dribble) eases the solution over instead of jumping to it
    if (mode && mode !== p.ctM) p.ctB = T;
    p.ctM = mode;
    const ks = T - (p.ctB ?? -9) < 0.18 ? 0.25 : 1;
    // contact starting from nothing: the stored solution starts at the drawn arm (a stale one from long ago would be
    // eased through - the arm swung via an old pose while the weight rose)
    if (wR > 0 && (p.ctR || 0) < 0.01) (K[0] = o.aR), (K[1] = o.eR), (K[2] = o.sz);
    if (wL > 0 && (p.ctL || 0) < 0.01) (K[3] = o.aL), (K[4] = o.eL), (K[5] = o.zL ?? o.sz);
    // (weights ride a critically damped spring: they start and stop with zero velocity, so contact never pops)
    {
      // (a spin / behind-the-back carries the ball on its own hand path: a leftover catch or dribble fade dies off faster)
      const om = cat || con ? 22 : p.mvT > 0 && (p.mvk === 2 || p.mvk === 3) ? 30 : 18;
      p.ctRv = (p.ctRv || 0) + (om * om * (wR - (p.ctR || 0)) - 2 * om * (p.ctRv || 0)) * DT;
      p.ctLv = (p.ctLv || 0) + (om * om * (wL - (p.ctL || 0)) - 2 * om * (p.ctLv || 0)) * DT;
      p.ctR = clamp((p.ctR || 0) + p.ctRv * DT, 0, 1);
      p.ctL = clamp((p.ctL || 0) + p.ctLv * DT, 0, 1);
    }
    if (p.ctR > 0.01) {
      if (wR > 0) {
        const k = armIK(p, o.cr, K[6], K[7], K[8], 1, cat ? 1 : 0.6);
        if (con) (o.wR = -0.2), (o.gR = 0.05); // fingers spread, wrist back
        (K[0] = armN(K[0] + wrapPi(k.a - K[0]) * ks)), (K[1] += (k.e - K[1]) * ks), (K[2] += (k.ab - K[2]) * ks);
      }
      // (contests: the plain difference; fades: wrapped, with an immediate guard below that lets go well before +-pi -
      // a stored catch solution that crossed the wrap made the plain difference swing the arm the long way round)
      if (con) p.ctPl = 1;
      else if (drib || cat) p.ctPl = 0;
      const fade = !drib && !cat && !con && !p.ctPl, // (a contest's fade keeps the contest's plain difference)
        da = drib || cat || fade ? wrapPi(K[0] - o.aR) : K[0] - o.aR;
      // (an IK branch flip is not a correction; a fade keeps the last live guard, so a solution that was never shown
      // does not appear while fading out)
      // (eased, never switched: a guard flickering between 0 and 1 tick to tick was a pop of its own)
      const gR = drib || cat ? clamp(1 - (Math.abs(da) - 0.8) / 0.6, 0, 1) : con ? 1 : p.ctRg ?? 1;
      p.ctRg = (p.ctRg ?? gR) + (gR - (p.ctRg ?? gR)) * Math.min(1, DT * 14);
      const w = p.ctR * (fade ? Math.min(p.ctRg ?? 1, clamp(1 - (Math.abs(da) - 0.8) / 0.6, 0, 1)) : p.ctRg ?? 1);
      (o.aR += da * w), (o.eR += (K[1] - o.eR) * w), (o.sz += (K[2] - o.sz) * w);
    }
    if (p.ctL > 0.01) {
      if (wL > 0) {
        const k = armIK(p, o.cr, K[9], K[10], K[11], -1, cat ? 1 : 0.6);
        if (con) o.gL = 0.05;
        (K[3] = armN(K[3] + wrapPi(k.a - K[3]) * ks)), (K[4] += (k.e - K[4]) * ks), (K[5] += (k.ab - K[5]) * ks);
      }
      const z0 = o.zL ?? o.sz,
        fadeL = !drib && !cat && !con && !p.ctPl,
        da = drib || cat || fadeL ? wrapPi(K[3] - o.aL) : K[3] - o.aL;
      const gL2 = drib || cat ? clamp(1 - (Math.abs(da) - 0.8) / 0.6, 0, 1) : con ? 1 : p.ctLg ?? 1;
      p.ctLg = (p.ctLg ?? gL2) + (gL2 - (p.ctLg ?? gL2)) * Math.min(1, DT * 14);
      const w = p.ctL * (fadeL ? Math.min(p.ctLg ?? 1, clamp(1 - (Math.abs(da) - 0.8) / 0.6, 0, 1)) : p.ctLg ?? 1);
      (o.aL += da * w), (o.eL += (K[4] - o.eL) * w), (o.zL = z0 + (K[5] - z0) * w);
    }
  }
  if (PRO && cfg.PLANT !== 0) plantFeet(p, o, sp);
  if (PRO && cfg.AVOID !== 0) avoidBodies(p, o);
  face(p, st, hyT, hpT);
}
/** Body avoidance: an elbow, hand or shoulder that ends up inside a nearby player's torso (capsule pelvis -> neck,
 *  from his last skeleton) is moved out by the pose, not by the physics: a sideways hit tucks the arm in (less
 *  abduction), a hit in front bends the elbow and drops the arm, a shoulder hit twists the chest to slip past.
 *  Visual only (no gameplay effect); intended contact (hand on the hip, box-outs) ends at the surface. */
const AV = new Float32Array(60),
  SEG = { d: 0, nx: 0, ny: 0 },
  // arm parts tested against other torsos: skeleton joint, radius (px at 6.4 ft), left arm?, kind (0 shoulder 1 elbow 2 hand)
  AVJ = Int8Array.from([13, 17, 15, 19, 12, 16]),
  AVR = Float32Array.from([1.7, 1.7, 1.3, 1.3, 2.6, 2.6]),
  AVK = Int8Array.from([1, 1, 2, 2, 0, 0]);
/** Distance from a point to the segment between skeleton joints a and b, and the push-out direction (xy) into SEG. */
function segDist(px: number, py: number, pz: number, s: Float32Array, a: number, b: number) {
  const ax = s[a * 3], ay = s[a * 3 + 1], az = s[a * 3 + 2], bx = s[b * 3], by = s[b * 3 + 1], bz = s[b * 3 + 2];
  const vx = bx - ax, vy = by - ay, vz = bz - az, L2 = vx * vx + vy * vy + vz * vz || 1;
  const u = clamp(((px - ax) * vx + (py - ay) * vy + (pz - az) * vz) / L2, 0, 1);
  const qx = ax + vx * u - px, qy = ay + vy * u - py, qz = az + vz * u - pz;
  SEG.d = Math.hypot(qx, qy, qz);
  SEG.nx = -qx;
  SEG.ny = -qy;
}
function avoidBodies(p: Player, o: any) {
  const sk = p.skel || (p.skel = new Float32Array(60));
  skeleton(p, AV);
  const s = p.ht / 6.4,
    cf = Math.cos(fv(p)),
    sf = Math.sin(fv(p)),
    ua = RIG.ua * s * 10,
    sw = RIG.shX * p.bk * s * 10;
  let dsz = 0,
    dzL = 0,
    daR = 0,
    daL = 0,
    deR = 0,
    deL = 0,
    dcy = 0;
  for (const q of P) {
    if (q === p || q.off || !q.skelOk || Math.hypot(q.x - p.x, q.y - p.y) > 32) continue;
    const R0 = 4.8 * (q.ht / 6.4) * Math.min(1.15, q.bk);
    // joints: 12/16 shoulders, 13/17 elbows, 15/19 hands; torso capsule = pelvis (0) .. neck (2)
    for (let n = 0; n < 6; n++) {
      const j = AVJ[n],
        part = AVK[n];
      segDist(AV[j * 3], AV[j * 3 + 1], AV[j * 3 + 2], q.skel, 0, 2);
      const nx = SEG.nx,
        ny = SEG.ny,
        pen = R0 + AVR[n] * s - SEG.d;
      if (pen <= 0) continue;
      const nn = Math.hypot(nx, ny) || 1,
        fw = (nx * cf + ny * sf) / nn, // + = push the part forward (the other body is behind it)
        lat = (nx * sf - ny * cf) / nn, // + = push toward the body's right
        left = (n & 1) === 0; // joints 13/15/12 are the LEFT arm (skeleton order: left first)
      if (part === 0) {
        dcy += -fw * (pen / sw) * (left ? -1 : 1) * 0.8; // twist the chest so that shoulder slips past
        continue;
      }
      const k = Math.min(0.6, (pen / ua) * 3);
      // sideways: tuck the arm in (a push toward the body's centre line reduces abduction)
      const inward = Math.max(0, left ? lat : -lat); // + = the push points inward for this arm
      left ? (dzL -= k * 1.6 * inward) : (dsz -= k * 1.6 * inward);
      // in front of him: bend the elbow, drop the arm a little; behind: raise it forward
      const bk = Math.max(0, -fw),
        fr = Math.max(0, fw);
      left ? ((deL += k * 1.8 * bk), (daL += k * 0.8 * (fr - bk))) : ((deR += k * 1.8 * bk), (daR += k * 0.8 * (fr - bk)));
    }
  }
  // (proportional to the penetration, which grows and shrinks continuously: contact starts and ends smoothly)
  if (dsz || dzL || daR || daL || deR || deL || dcy) {
    const z0 = o.zL ?? o.sz;
    o.sz += clamp(dsz, -0.7, 0);
    o.zL = z0 + clamp(dzL, -0.7, 0);
    o.aR += clamp(daR, -0.6, 0.6);
    o.aL += clamp(daL, -0.6, 0.6);
    o.eR = Math.min(2.6, o.eR + clamp(deR, 0, 1));
    o.eL = Math.min(2.6, o.eL + clamp(deL, 0, 1));
    o.cy = (o.cy || 0) + clamp(dcy, -0.5, 0.5);
    skeleton(p, AV);
  }
  sk.set(AV);
  p.skelOk = 1;
}
/** Foot placement in the core (so the 2D view, replays, the server skeleton and the 3D rig all agree). Runs after
 *  blending, on the drawn pose; the 3D client's footIK then only refines what is left. */
function plantFeet(p: Player, o: any, sp: number) {
  stepSolve(p, o, sp);
}
/** Procedural stepping: in locomotion the feet are placed in WORLD space and the legs are solved to reach them, so a
 *  foot on the floor cannot slide by construction. The sim's gait phase p.ph (stride-matched: pi = one step of
 *  stepLen) schedules each leg: stance (pinned where it landed) for a speed-dependent duty factor (walk ~60%, double
 *  support; sprint ~35%, flight), then a swing arc from the lift-off spot to the landing spot predicted from the body's
 *  velocity (half a stance ahead of the hip, so the body passes over it mid-stance; works for backpedals and slides).
 *  Standing still, the feet stay put and take a shuffle step only when the body has turned or drifted too far.
 *  Hips, torso, arms and the animated foot spread (style) still come from the animation; the pelvis dips when a long
 *  stride needs it; legs use soft IK near full extension. Blended in/out with the locomotion states. */
const PSK = new Float32Array(60),
  LYJ = [3, 5, 6, 7, 9, 10, 11, 13, 15, 17, 19]; // head, knees, ankles, toes, elbows, hands
type FootS = { st: number; x: number; y: number; z: number; sx: number; sy: number; sz: number; u: number; dur: number; tx: number; ty: number };
export let SWA = 0.6;
export const setSWA = (v: number) => (SWA = v);
function stepSolve(p: Player, o: any, sp: number) {
  const md = p.mode,
    st = p.anS,
    // (+ the gather of a jumper: the feet stay planted - or take the hop into the clip's stance - while the hips dip)
    gat = md === "c" && st === ST.shot && !p.hk && !isLaySv(p.sv || 0) && !isDunkSv(p.sv || 0),
    ok = p.z < 1 && (md === "i" || gat) && !(p.actT > 0 && (p.act === 3 || p.act === 4 || p.act === 5)) && (st === ST.idle || st === ST.run || st === ST.def || st === ST.drib || st === ST.scr || st === ST.cat || st === ST.rest || st === ST.post || st === ST.move || gat || (st === ST.air && md === "i") || (st === ST.cel && sp > 25));
  const S = p.stp || (p.stp = { w: 0, f: [] as FootS[], drop: 0, last: -1 });
  S.w += ((ok ? 1 : 0) - S.w) * Math.min(1, DT * (ok ? 8 : 14));
  skeleton(p, PSK);
  const s = p.ht / 6.4,
    L1 = RIG.L1 * s * 10,
    L2 = RIG.L2 * s * 10,
    Lm = L1 + L2,
    cf = Math.cos(fv(p)),
    sf = Math.sin(fv(p));
  // lying on the floor (a dive, knocked down): nothing may sink through it - lift the whole body by the deepest point
  if (p.actT > 0 && (p.act === 3 || p.act === 4) && p.z < 2) {
    let m = 0;
    for (const j of LYJ) m = Math.min(m, PSK[j * 3 + 2]);
    if (m < 0) o.cr += m / 4; // (cr lowers the root by 4 px per unit)
  }
  if (S.w < 0.01) {
    S.f.length = 0; // re-seeded from the animated feet next time
    return;
  }
  // treadmill (Animation Studio: the body stays put while "moving"): the floor slides back under the feet
  if (p.tread) for (const F of S.f) if (F) (F.x -= p.vx * DT), (F.y -= p.vy * DT), (F.sx -= p.vx * DT), (F.sy -= p.vy * DT), (F.tx -= p.vx * DT), (F.ty -= p.vy * DT);
  // teleported (inbound setup, substitution): re-seed the feet from the animation
  if (S.px != null && Math.hypot(p.x - S.px, p.y - S.py) > 30) S.f.length = 0;
  S.px = p.x;
  S.py = p.y;
  const v = sp,
    spd = Math.min(1, v / 250);
  const side = v > 1 ? Math.abs((p.vx / v) * sf - (p.vy / v) * cf) : 0; // 1 = moving straight sideways (a slide)
  // duty factor (slides never leave the floor), eased: a sudden stop or turn must not re-classify a swinging foot
  // (its swing progress would jump back)
  // (... but a planted foot must stay within the leg's reach while the body travels over it: a fast slide gets a short
  // hop - both feet briefly off the floor - instead of a stance that stretches the leg 30% past its length)
  const reachH = Math.sqrt(Math.max(1, (Lm * 0.95) ** 2 - (PSK[14] - 4 * s) ** 2)),
    dT = Math.min(0.75, 0.62 - 0.27 * spd + 0.22 * side, (1.7 * reachH) / (2 * stepLen(v)));
  S.duty = S.duty == null ? dT : S.duty + (dT - S.duty) * Math.min(1, DT * 4);
  const reg = S.reg === 1 ? (v > 18 ? 1 : 0) : v > 30 ? 1 : 0; // moving / standing, with hysteresis (no flip-flop)
  const duty = reg ? S.duty : 1,
    stepL = stepLen(v),
    ux = v > 1 ? p.vx / v : cf,
    uy = v > 1 ? p.vy / v : sf;
  let drop = 0;
  // regime change (moving <-> standing): a foot that is mid-air finishes its step from where it is now
  if (reg !== S.reg) {
    for (const F of S.f) if (F && !F.st) (F.sx = F.x), (F.sy = F.y), (F.sz = F.z), (F.u = 0), (F.dur = 0.15);
    S.reg = reg;
  }
  // standing: which foot steps? the one that is farthest from where it belongs (a turn in place pivots on the other)
  let need = -1;
  if (!reg && S.f[0] && S.f[1] && S.f[0].st && S.f[1].st) {
    let best = 7 * s;
    for (let k = 0; k < 2; k++) {
      const P0 = k ? 8 : 4,
        hx = PSK[P0 * 3],
        hy = PSK[P0 * 3 + 1],
        lat = ((PSK[(P0 + 2) * 3] - hx) * sf - (PSK[(P0 + 2) * 3 + 1] - hy) * cf) * (st === ST.post ? 1.6 : 1) + (st === ST.post ? (k ? 2 : -2) * s : 0),
        e = gat ? Math.hypot(S.f[k].x - PSK[(P0 + 2) * 3], S.f[k].y - PSK[(P0 + 2) * 3 + 1]) : Math.hypot(S.f[k].x - (hx + sf * lat), S.f[k].y - (hy - cf * lat));
      if (e > best && S.last !== k) (best = e), (need = k);
    }
  }
  for (let k = 0; k < 2; k++) {
    const P0 = k ? 8 : 4,
      hx = PSK[P0 * 3],
      hy = PSK[P0 * 3 + 1],
      hz = PSK[P0 * 3 + 2],
      ax = PSK[(P0 + 2) * 3],
      ay = PSK[(P0 + 2) * 3 + 1];
    let F = S.f[k];
    if (!F) F = S.f[k] = { st: 1, x: ax, y: ay, z: 0, sx: ax, sy: ay, sz: 0, u: 0, dur: 0.2, tx: ax, ty: ay };
    // the animated foot's spread from the hip (stance width, slides) = where this foot naturally lands sideways
    // (posting up: a wide, low base to lean into the defender)
    const lat = ((ax - hx) * sf - (ay - hy) * cf) * (st === ST.post ? 1.6 : 1) + (st === ST.post ? (k ? 2 : -2) * s : 0);
    // (a jumper's gather keeps the clip's stagger too: the shooting foot a little ahead)
    const restX = gat ? ax : hx + sf * lat,
      restY = gat ? ay : hy - cf * lat;
    if (reg) {
      // gait schedule: leg phase 0 = touchdown (L lands at ph = pi/2, R at 3pi/2, where the clips swing them forward)
      const ph = (((p.ph - (k ? 1.5 : 0.5) * Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI),
        stance = ph < duty * 2 * Math.PI;
      if (stance && !F.st) {
        // touchdown, where the foot is (normally its target: the swing ends there)
        F.st = 1;
        F.zo = F.z; // (an early touchdown - the duty factor eased under it - settles the last bit instead of snapping)
        F.z = 0;
      } else if (!stance && F.st) {
        // lift-off: swing to where the body will be half a stance from now ... plus that half stance ahead
        F.st = 0;
        (F.sx = F.x), (F.sy = F.y), (F.sz = F.z);
        const s0 = (ph - duty * 2 * Math.PI) / ((1 - duty) * 2 * Math.PI);
        F.sw0 = s0 > 0.1 ? s0 : 0; // a swing started mid-phase (from standing) counts from here; a normal toe-off from 0
        F.fr = 1; // aim the landing spot from the first swing tick (a sprint is already ~8% into the swing by then)
      }
      if (!F.st) {
        const sw0 = (ph - duty * 2 * Math.PI) / ((1 - duty) * 2 * Math.PI),
          sw = clamp((sw0 - (F.sw0 || 0)) / Math.max(0.05, 1 - (F.sw0 || 0)), 0, 1), // 0..1 through the swing
          tLeft = ((1 - sw) * (1 - duty) * 2 * stepL) / Math.max(v, 1), // seconds until touchdown
          ahead = duty * stepL * (1 - 0.35 * side); // touch down this far ahead of the hip (the hip passes over it mid-stance); slides take shorter steps
        // (the landing spot is eased: a sudden cut moves it, it doesn't teleport the swinging foot)
        const tr = p.tread ? 0 : tLeft; // on the studio treadmill the body doesn't travel - the floor does
        let nx = restX + p.vx * tr + ux * ahead,
          ny = restY + p.vy * tr + uy * ahead;
        {
          // keep the whole stance within the leg's reach: from touchdown (along = al) to lift-off (al - travel) the
          // foot stays inside the reach circle around its hip, so a wide slide narrows instead of over-stretching
          const hX = hx + p.vx * tr,
            hY = hy + p.vy * tr,
            R = reachH * 0.92,
            trv = duty * 2 * stepL;
          let al = (nx - hX) * ux + (ny - hY) * uy,
            lt = -(nx - hX) * uy + (ny - hY) * ux;
          al = Math.min(al, R);
          if (al - trv < -R) al = trv - R;
          const am = Math.max(Math.abs(al), Math.abs(al - trv)),
            lm = Math.sqrt(Math.max(0, R * R - am * am));
          lt = clamp(lt, -lm, lm);
          // (a step never lands across the body's midline: the legs don't cross in slides and cuts)
          const mid = RIG.hipX * s * 10;
          lt = k ? Math.max(lt, -mid + 1) : Math.min(lt, mid - 1);
          nx = hX + ux * al - uy * lt;
          ny = hY + uy * al + ux * lt;
        }
        const ke = F.fr ? 1 : Math.min(1, DT * 18);
        F.fr = 0;
        F.tx += (nx - F.tx) * ke;
        F.ty += (ny - F.ty) * ke;
        // swing profile: leaves with some speed (doesn't trail out of the leg's reach behind the body), lands at zero
        // speed relative to the floor (no stop-dead at touchdown): e(0)=0, e'(0)=a, e(1)=1, e'(1)=0
        const a = SWA,
          e = sw * (a + sw * (3 - 2 * a + sw * (a - 2)));
        F.x = F.sx + (F.tx - F.sx) * e;
        F.y = F.sy + (F.ty - F.sy) * e;
        // arc with no vertical kick at lift-off / touchdown; sideways steps (slides) stay low - a shuffle, not a kick
        F.z = F.sz * (1 - e) + (2.5 + 9 * spd) * (1 - 0.7 * side) * s * 16 * sw * sw * (1 - sw) * (1 - sw);
      }
    } else {
      // standing: feet stay planted; a shuffle step when the body turned or drifted away from this foot (one at a time)
      if (F.st && need === k) {
        // a longer step takes a little longer (a pivot's quarter turn ~.2 s, a reset after a big drift ~.3 s)
        const dd = Math.hypot(F.x - restX, F.y - restY);
        (F.st = 0), (F.u = 0), (F.dur = clamp(0.14 + dd / (s * 160), 0.16, 0.3)), (F.sx = F.x), (F.sy = F.y), (F.sz = F.z), (S.last = k);
      }
      if (!F.st) {
        F.u = Math.min(1, F.u + DT / F.dur);
        const e = F.u * F.u * (3 - 2 * F.u);
        F.x = F.sx + (restX - F.sx) * e;
        F.y = F.sy + (restY - F.sy) * e;
        F.z = F.sz * (1 - e) + 3 * s * 16 * F.u * F.u * (1 - F.u) * (1 - F.u);
        F.tx = restX;
        F.ty = restY;
        if (F.u >= 1) (F.st = 1), (F.z = 0), (S.last = -1);
      }
    }
    if (F.st && F.zo) F.zo = F.zo < 0.05 ? 0 : F.zo * Math.exp(-DT / 0.035);
    // pelvis dip so a planted foot stays within reach
    const fw = (F.x - hx) * cf + (F.y - hy) * sf;
    if (F.st) drop = Math.max(drop, hz - F.z - Math.sqrt(Math.max(0, (Lm * 0.965) ** 2 - fw * fw)));
  }
  // the dip rides a critically damped spring (it would step whenever a foot lands or lifts)
  {
    const w = 22;
    // (+ a defender sits in his stance: now that his feet are really on the floor the knees only bend if the hips drop)
    const sit = st === ST.def ? 3 * s : st === ST.post ? 5 * s : 0;
    S.dv = (S.dv || 0) + (w * w * (clamp(drop + sit, 0, 5 + sit) - S.drop) - 2 * w * (S.dv || 0)) * DT;
    S.drop = Math.max(0, S.drop + S.dv * DT);
  }
  const W = S.w * S.w * (3 - 2 * S.w);
  o.cr += (S.drop / 4) * W;
  // solve both legs from the (lowered) hips
  let abL = 0,
    abR = 0;
  for (let k = 0; k < 2; k++) {
    const F = S.f[k],
      P0 = k ? 8 : 4,
      hx = PSK[P0 * 3],
      hy = PSK[P0 * 3 + 1],
      hz = PSK[P0 * 3 + 2] - S.drop * W,
      fw = (F.x - hx) * cf + (F.y - hy) * sf,
      lt = (F.x - hx) * sf - (F.y - hy) * cf, // + = the body's right
      dz = F.z + (F.st ? F.zo || 0 : 0) - hz,
      vert = Math.hypot(dz, lt),
      ds = Lm * 0.88, // (soft IK from 88% of reach: the knee angle near full extension changes too fast otherwise - lift-off pops)
      d0 = Math.max(0.35 * Lm, Math.hypot(fw, vert)),
      d = d0 > ds ? ds + (Lm - ds) * (1 - Math.exp(-(d0 - ds) / (Lm - ds))) : d0,
      a1 = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1)),
      tI = Math.atan2(fw, vert) + a1,
      kI = Math.PI - Math.acos(clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1)),
      ab = Math.atan2(lt, Math.max(5, -dz)),
      tk = k ? "tR" : "tL",
      kk = k ? "kR" : "kL",
      fk = k ? "fR" : "fL";
    o[tk] += (tI - o[tk]) * W;
    o[kk] += (kI - o[kk]) * W;
    // feet: flat through stance (rolling onto the toes at the end), toes down in the swing
    // (continuous: the toe-off roll at the end of stance carries into the swing and fades out before touchdown)
    let fz = tI - kI;
    if (reg) {
      const ph = (((p.ph - (k ? 1.5 : 0.5) * Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI),
        roll = (0.55 * spd + 0.1) * (1 - 0.8 * side); // slides keep the feet flat
      if (F.st) {
        const u = ph / (duty * 2 * Math.PI);
        fz += Math.max(0, (u - 0.7) / 0.3) ** 2 * roll;
      } else {
        const sw0 = (ph - duty * 2 * Math.PI) / ((1 - duty) * 2 * Math.PI),
          sw = clamp((sw0 - (F.sw0 || 0)) / Math.max(0.05, 1 - (F.sw0 || 0)), 0, 1),
          r0 = F.sw0 ? 0 : 1; // a swing that started from standing has no toe-off roll to carry
        fz += r0 * roll * (1 - sw) * (1 - sw) * (1 + 2 * sw); // smooth fade (zero slope at touchdown)
      }
    } else if (!F.st) fz += 0.2 * Math.sin(Math.PI * F.u);
    {
      // the toe roll / swing pitch are continuous by design, except where a contact flips early: carry the gap and fade it
      let add = fz - (tI - kI);
      if (F.pst != null && F.pst !== F.st) F.pd = (F.pa || 0) - add;
      else F.pd = Math.abs(F.pd || 0) < 1e-3 ? 0 : F.pd * Math.exp(-DT / 0.06);
      add += F.pd;
      F.pa = add;
      F.pst = F.st;
      fz = tI - kI + add;
    }
    // (an ankle only dorsiflexes so far: past it the heel comes up and he is on the ball of the foot)
    o[fk] += (Math.max(fz, -0.6) - o[fk]) * W;
    if (k) abR = ab;
    else abL = ab;
  }
  // per-leg abduction (rig: abd L = hs - hz, abd R = hs + hz)
  o.hz += ((abR - abL) / 2 - o.hz) * W;
  o.hs += ((abR + abL) / 2 - o.hs) * W;
}
/** Facial expression (p.fc, drawn by the 3D rig's face bones): what the player feels this tick, eased.
 *  jw jaw open, sm smile (-1 frown .. 1 grin), br brows raised (worried / surprised), an anger (brows knit, lowered),
 *  sq squint, wd mouth stretched wide (yell, grimace), bl blink, ex/ey where the eyes look beyond the head turn.
 *  Driven by celebrations (synced), contact (hitT, synced), misses (frT), dunks in the air, effort, defense, fatigue
 *  and the final score. Deterministic (blinks from T and the player's slot), no side effects. */
const FT = { jw: 0, sm: 0, br: 0, an: 0, sq: 0, wd: 0 };
function face(p: Player, st: number, hyT: number, hpT: number) {
  const c = p.fc || (p.fc = { jw: 0, sm: 0, br: 0, an: 0, sq: 0, wd: 0, bl: 0, ex: 0, ey: 0 }),
    t = FT,
    md = p.mode,
    cel = p.celT > 0 ? p.cel : 0,
    e = CEL_T - (p.celT || 0);
  t.jw = t.sm = t.br = t.an = t.sq = t.wd = 0;
  if (p.callT > 0) p.callT -= DT;
  switch (cel) {
    case 1: // shimmy, three-up, point up, dap, help up, hyping a teammate: grin
    case 4:
    case 8:
    case 9:
    case 16:
      (t.sm = 1), (t.jw = 0.14), (t.br = 0.25);
      break;
    case 13:
      (t.sm = 1), (t.jw = 0.2 + 0.35 * Math.abs(Math.sin(e * 9))), (t.br = 0.3); // "let's go!"
      break;
    case 2: // night-night, shh: a smirk
    case 7:
      (t.sm = 0.55), (t.sq = 0.35), (t.br = -0.1);
      break;
    case 3: // flex, chest thump, roar, the block stare-down, jersey tug: yell
    case 5:
    case 6:
    case 14:
      (t.jw = 0.95), (t.an = 0.85), (t.sq = 0.55), (t.wd = 0.8), (t.sm = -0.1);
      break;
    case 15:
      (t.jw = 0.45 + 0.25 * Math.abs(Math.sin(e * 7))), (t.an = 0.5), (t.sq = 0.4), (t.wd = 0.5);
      break;
    case 11: // missed an open look: wince
      (t.jw = 0.3), (t.br = 0.9), (t.sq = 0.6), (t.sm = -0.7), (t.wd = 0.3);
      break;
    case 12: // arguing a call: talking, brows knit
      (t.jw = 0.12 + 0.4 * Math.abs(Math.sin(e * 11) * Math.sin(e * 4.3))), (t.an = 0.75), (t.br = 0.2), (t.sm = -0.4);
      break;
    case 10: // held follow-through on a green: cool, confident
      (t.sm = 0.35), (t.sq = 0.2);
      break;
    default:
      if ((p.hitT || 0) > 0.04) (t.an = 0.7), (t.sq = 1), (t.wd = 1), (t.jw = 0.12), (t.sm = -0.35); // contact: gritted teeth
      else if (md === "s" && p.z > 6 && isDunkSv(p.sv || 0)) (t.jw = 0.75), (t.an = 0.7), (t.wd = 0.7), (t.sq = 0.35); // throwing it down
      else if ((p.callT || 0) > 0) (t.jw = 0.35 + 0.3 * Math.abs(Math.sin(T * 9))), (t.br = 0.5), (t.wd = 0.3); // "Ball! Ball!"
      else if ((p.frT || 0) > 0) (t.sm = -0.85), (t.br = 0.75), (t.jw = 0.18 + (p.frT > 1.2 ? 0.25 : 0)), (t.sq = 0.3); // frustration after a miss
      else if (md === "s" || md === "c") (t.an = 0.3), (t.sq = 0.3), (t.sm = -0.12); // focus: lips pressed
      else if (S === "over") {
        const won = sc[p.tm] > sc[1 - p.tm];
        if (won) (t.sm = 1), (t.jw = 0.18), (t.br = 0.3);
        else (t.sm = -0.75), (t.br = 0.6), (t.sq = 0.2);
      } else if (st === ST.def) (t.an = 0.4), (t.sq = 0.25), (t.sm = -0.1);
      else if ((p.en ?? 1) < 0.6) t.jw = 0.22 + 0.12 * Math.sin(T * 4.5 + p.k); // gassed: breathing through the mouth
  }
  const kf = Math.min(1, DT * 10),
    kj = Math.min(1, DT * 16);
  c.jw += (t.jw - c.jw) * kj;
  c.sm += (t.sm - c.sm) * kf;
  c.br += (t.br - c.br) * kf;
  c.an += (t.an - c.an) * kf;
  c.sq += (t.sq - c.sq) * kf;
  c.wd += (t.wd - c.wd) * kj;
  // blinks: every 2.6-4.6 s per player (slot-seeded), a quick 0.15 s close; a flinch blink on contact
  const per = 2.6 + ((p.k * 7) % 5) * 0.5,
    ph = (T + p.k * 1.37) % per;
  c.bl = ph < 0.15 ? Math.sin((ph / 0.15) * Math.PI) : 0;
  if ((p.hitT || 0) > 0.3) c.bl = 1;
  // eyes take what the head turn did not (clamped to the eye's travel), and lead it a little
  const q = p.q;
  c.ex += (clamp((hyT - (q.hy || 0)) * 0.8, -0.55, 0.55) - c.ex) * Math.min(1, DT * 20);
  c.ey += (clamp((hpT - (q.hp || 0)) * 0.8, -0.45, 0.45) - c.ey) * Math.min(1, DT * 20);
}
const wrapPi = (a: number) => a - Math.round(a / (2 * Math.PI)) * 2 * Math.PI;
/** Inertialization offset at time t (Bollo): starts at x0 with velocity v0, reaches 0 with zero velocity and
 *  acceleration at tf; velocity pointing away from zero is dropped and tf shortened so it never overshoots. */
function inert(x0: number, v0: number, tf: number, t: number) {
  if (x0 === 0 && v0 === 0) return 0;
  if (x0 * v0 > 0) v0 = 0;
  if (v0 !== 0) tf = Math.min(tf, Math.max(1e-3, (-5 * x0) / v0));
  if (t >= tf) return 0;
  const tf2 = tf * tf;
  let a0 = (-8 * v0 * tf - 20 * x0) / tf2;
  if (a0 * x0 < 0) a0 = 0; // must accelerate toward zero, never away
  const A = -(a0 * tf2 + 6 * v0 * tf + 12 * x0) / (2 * tf2 * tf2 * tf),
    Bq = (3 * a0 * tf2 + 16 * v0 * tf + 30 * x0) / (2 * tf2 * tf2),
    C = -(3 * a0 * tf2 + 12 * v0 * tf + 20 * x0) / (2 * tf2 * tf);
  return (((A * t + Bq) * t + C) * t + a0 / 2) * t * t + v0 * t + x0;
}
/** Two-bone arm IK toward a game-space point (px). side: +1 right arm, -1 left, 0 = the arm on the target's side.
 *  Returns shoulder raise a, elbow e, abduction ab (for zL/sz), and how far the target is beyond reach (dist).
 *  Approximates the chest as square to the pelvis (used for the dribble hand, defenders' hands, rebounds). */
const IK = { right: true, a: 0, e: 0, ab: 0, over: 0 };
export function armIK(p: Player, cr: number, x: number, y: number, z: number, side: number, abMax: number) {
  const S2 = p.ht / 6.4,
    w = W3(p.x, p.y, p.z),
    b = W3(x, y, z),
    th = Math.PI / 2 - fv(p),
    X1 = b[0] - w[0],
    Y1 = b[1] - (w[1] - cr * 0.4),
    Z1 = b[2] - w[2],
    lx = (X1 * Math.cos(th) - Z1 * Math.sin(th)) / S2,
    lz = (X1 * Math.sin(th) + Z1 * Math.cos(th)) / S2,
    right = side ? side > 0 : lx >= 0,
    tx = right ? lx - RIG.shX * p.bk : lx + RIG.shX * p.bk,
    ty2 = Y1 / S2 - (RIG.hip + RIG.chest + RIG.sh),
    tz = lz,
    L1 = 1.02,
    L2 = 1.15,
    raw = Math.hypot(tx, ty2, tz),
    d = Math.min(L1 + L2 - 0.02, Math.max(0.3, raw)),
    ph2 = Math.atan2(tz, -ty2),
    al = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
  IK.right = right;
  IK.a = ph2 - al;
  // keep the shoulder in its real range: a target straight overhead and a hair behind wraps atan2 from +pi to -pi,
  // which would swing the arm backwards (rim right above on a layup). Over the top up to ~150 deg past vertical; the
  // unavoidable seam sits far behind-and-high where no arm can reach (and blending smooths it)
  if (IK.a < -2.6) IK.a += 2 * Math.PI;
  IK.e = Math.PI - Math.acos(clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
  IK.ab = clamp(Math.atan2(right ? tx : -tx, Math.max(0.2, Math.abs(ty2))), -0.4, abMax);
  IK.over = raw - (L1 + L2);
  return IK;
}
/** A shoulder angle in armIK's range (-2.6 .. 2 pi - 2.6): over the top stays over the top, never drifts by 2 pi. */
const armN = (a: number) => (a < -2.6 ? a + 2 * Math.PI : a > 2 * Math.PI - 2.6 ? a - 2 * Math.PI : a);
/** Clip phase (0..1) at which each shot clip's wrist snaps = the ball's release. */
const RELK: Record<string, number> = { jump: 0.7, mshot: 0.7, upunder: 0.7, quick: 0.46, fade: 0.7, step: 0.7, float: 0.6, hop: 0.58, curry: 0.78, hook: 0.95, lay: 0.7, euro: 0.7, roll: 0.72, revlay: 0.6, contact: 0.6, leaner: 0.68, runner: 0.66, dunk: 0.7, dunk2: 0.72, tomahawk: 0.76, windmill: 0.76, reverse: 0.78, d360: 0.68, hang: 1 };
const NQ = 31,
  VALS = new Float64Array(NQ),
  LOOK = { x: 0, y: 0, z: 0, on: 0 };
let HEADX = 0,
  MCF = 0, // weight of the mocap layer this tick (feet use it after the upper-body layers)
  MFL = 0,
  MFR = 0;
/** Animation states (blend times in seconds when entering / tracking each one). */
const ST = { idle: 0, run: 1, def: 2, drib: 3, shot: 4, air: 5, move: 6, post: 7, scr: 8, cel: 9, rest: 10, cat: 11 },
  BLEND = [0.16, 0.12, 0.15, 0.1, 0.05, 0.08, 0.07, 0.2, 0.22, 0.18, 0.4, 0.09];

// ---- forward kinematics (mirrors the three.js rig hierarchy exactly; rig3d builds its bones from RIG) ----
// G: pos(w0, w1 - cr*0.4, w2), rotY(PI/2 - f), scale ht/6.4 -> pelvis bd: pos(0,3.2,0) Euler(ln,ty,rz,'YXZ')
// -> chest: pos(0,1,0) Euler(cx,cy,0,'YXZ') -> R shoulder: pos(0.88*0.95*bk, 0.9, 0) Euler(-aR, -hR, sz,'XZY')
// -> elbow: pos(0,-1.02,0) rotX(-eR) -> wrist: pos(0,-1,0) rotX(-wR) -> palm point (0,-0.62,0.1).
// chest -> neck pos(0,1.02,0) rotX(nk) -> head pos(0,0.28,0) Euler(hp,hy,0,'YXZ'). hips pos(+-0.32,3.2,0)
// Euler(-t,0,+-(hz+-hs)) -> knee pos(0,-1.58,0) rotX(k) -> ankle pos(0,-1.6,0) rotX(f). wrist -> fingers pos(0,-0.22,0) rotX(-g*1.4).
export const RIG = { hip: 3.2, hipX: 0.32, chest: 1.0, sh: 0.9, shX: 0.88 * 0.95, neck: 1.02, head: 0.28, L1: 1.58, L2: 1.6, ua: 1.02, fa: 1.0, fing: 0.22 };
/** Left/right hip abduction (wide stance hz plus the shuffle asymmetry hs). */
export const hipAb = (q: any, sd: number) => sd * ((q.hz || 0) + sd * (q.hs || 0));
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
/** Right palm (ball center while holding) for candidate joint values this tick (handPos chain, before p.q is written). */
const QT: any = {};
function palmAt(p: Player, aR: number, eR: number, sz: number, wR: number, ln: number, ty: number, rz: number, cx: number, cy: number, cr: number) {
  QT.aR = aR;
  QT.eR = eR;
  QT.sz = sz;
  QT.wR = wR;
  QT.ln = ln;
  QT.ty = ty;
  QT.rz = rz;
  QT.cx = cx;
  QT.cy = cy;
  QT.cr = cr;
  const q0 = p.q;
  p.q = QT;
  const h = handPos(p);
  p.q = q0;
  return h;
}
/** World position (game coords) of a point in the shooting wrist frame (the right one; the left one while a lefty's
 *  shot is mirrored, q.mir); default = palm. */
export function handPos(p: Player, pt: V = [0, -0.62, 0.1]): number[] | null {
  const q = p.q;
  if (!q) return null;
  const L = !!q.mir;
  let v: V = ry(rx(pt, -((L ? q.wL : q.wR) || 0)), (L ? q.oL : q.oR) || 0); // wrist flex, then forearm twist (pronation/supination)
  v = add(v, [0, -RIG.fa, 0]);
  v = rx(v, -(L ? q.eL : q.eR));
  v = add(v, [0, -RIG.ua, 0]);
  // shoulder XZY Euler: R = Rx * Rz * Ry (applied right-to-left: the humeral twist about the bone first)
  v = L ? rx(rz(ry(v, q.hL || 0), -(q.zL ?? q.sz)), -q.aL) : rx(rz(ry(v, -(q.hR || 0)), q.sz), -q.aR);
  v = add(v, [(L ? -1 : 1) * RIG.shX * p.bk, RIG.sh, 0]);
  // YXZ Euler: R = Ry * Rx * Rz
  v = ry(rx(v, q.cx || 0), q.cy || 0);
  v = add(v, [0, RIG.chest, 0]);
  v = ry(rx(rz(v, q.rz), q.ln), q.ty);
  v = add(v, [0, RIG.hip, 0]);
  const s = p.ht / 6.4;
  v = [v[0] * s, v[1] * s, v[2] * s];
  v = ry(v, Math.PI / 2 - fv(p));
  const w = W3(p.x, p.y, p.z);
  v = add(v, [w[0], w[1] - q.cr * 0.4, w[2]]);
  return [v[0] * 10 + 470, v[2] * 10 + 250, v[1] * 10];
}

// ---- full-body forward kinematics (2D renderer, effects): 20 joints in game coordinates ----
// 0 pelvis 1 chest 2 neck 3 head | 4-7 L hip/knee/ankle/toe | 8-11 R hip/knee/ankle/toe
// 12-15 L shoulder/elbow/wrist/hand | 16-19 R shoulder/elbow/wrist/hand
type M3 = Float64Array; // row-major 3x3
const mm = (a: M3, b: M3, o: M3) => {
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
};
const rot = (ax: 0 | 1 | 2, t: number, o: M3) => {
  const c = Math.cos(t),
    s = Math.sin(t);
  if (ax === 0) (o[0] = 1), (o[1] = 0), (o[2] = 0), (o[3] = 0), (o[4] = c), (o[5] = -s), (o[6] = 0), (o[7] = s), (o[8] = c);
  else if (ax === 1) (o[0] = c), (o[1] = 0), (o[2] = s), (o[3] = 0), (o[4] = 1), (o[5] = 0), (o[6] = -s), (o[7] = 0), (o[8] = c);
  else (o[0] = c), (o[1] = -s), (o[2] = 0), (o[3] = s), (o[4] = c), (o[5] = 0), (o[6] = 0), (o[7] = 0), (o[8] = 1);
  return o;
};
// (allocation-free: skeleton() runs several times per player per tick - stepping, avoidance, held ball, catches -
// so its matrices and frames come from pools that are rewound at the start of every call)
const MPN = 160,
  MP = Array.from({ length: MPN }, () => new Float64Array(9));
let mpi = 0;
const M = () => MP[mpi++ % MPN];
const euler = (x: number, y: number, z: number, order: "XYZ" | "YXZ" | "XZY", o: M3) => {
  const A = rot(0, x, M()),
    Bm = rot(1, y, M()),
    Cm = rot(2, z, M()),
    t = M();
  return order === "XYZ" ? mm(mm(A, Bm, t), Cm, o) : order === "XZY" ? mm(mm(A, Cm, t), Bm, o) : mm(mm(Bm, A, t), Cm, o);
};
interface Fr {
  R: M3;
  t: number[];
}
const FPN = 48,
  FP: Fr[] = Array.from({ length: FPN }, () => ({ R: new Float64Array(9), t: [0, 0, 0] }));
let fpi = 0;
const child = (f: Fr, ox: number, oy: number, oz: number, R: M3 | null): Fr => {
  const o = FP[fpi++ % FPN],
    fr = f.R;
  for (let r = 0; r < 3; r++) o.t[r] = fr[r * 3] * ox + fr[r * 3 + 1] * oy + fr[r * 3 + 2] * oz + f.t[r];
  if (R) mm(fr, R, o.R);
  else o.R.set(fr);
  return o;
};
const pt = (f: Fr, ox: number, oy: number, oz: number) => child(f, ox, oy, oz, null).t;
const SKF: Fr = { R: new Float64Array(9), t: [0, 0, 0] };
/** Joint positions in game coords (x, y, z up), written into out[0..59]. */
export function skeleton(p: Player, out: Float32Array) {
  mpi = fpi = 0;
  const q = p.q || {},
    s = p.ht / 6.4,
    k = p.bk,
    w = W3(p.x, p.y, p.z);
  const RG = rot(1, Math.PI / 2 - fv(p), SKF.R);
  for (let i = 0; i < 9; i++) RG[i] *= s;
  const G = SKF;
  (G.t[0] = w[0]), (G.t[1] = w[1] - (q.cr || 0) * 0.4), (G.t[2] = w[2]);
  const put = (i: number, v: number[]) => {
    out[i * 3] = v[0] * 10 + 470;
    out[i * 3 + 1] = v[2] * 10 + 250;
    out[i * 3 + 2] = v[1] * 10;
  };
  const bd = child(G, 0, RIG.hip, 0, euler(q.ln || 0, q.ty || 0, q.rz || 0, "YXZ", M())),
    ch = child(bd, 0, RIG.chest, 0, euler(q.cx || 0, q.cy || 0, 0, "YXZ", M())),
    nk = child(ch, 0, RIG.neck, 0, rot(0, q.nk || 0, M())),
    hd = child(nk, 0, RIG.head, 0, euler(q.hp || 0, q.hy || 0, 0, "YXZ", M()));
  put(0, pt(bd, 0, 0, 0));
  put(1, pt(ch, 0, 0.5, 0));
  put(2, nk.t);
  put(3, pt(hd, 0, 0.44, 0));
  for (let si = 0; si < 2; si++) {
    const sd = si ? 1 : -1,
      tq = sd < 0 ? q.tL || 0 : q.tR || 0,
      kq = sd < 0 ? q.kL || 0 : q.kR || 0,
      fq = sd < 0 ? q.fL || 0 : q.fR || 0,
      th = child(G, sd * RIG.hipX, RIG.hip, 0, euler(-tq, 0, hipAb(q, sd), "XYZ", M())),
      kn = child(th, 0, -RIG.L1, 0, rot(0, kq, M())),
      an = child(kn, 0, -RIG.L2, 0, rot(0, fq, M())),
      j = 4 + si * 4;
    put(j, th.t);
    put(j + 1, kn.t);
    put(j + 2, an.t);
    put(j + 3, pt(an, 0, -0.06, 0.52));
  }
  for (let si = 0; si < 2; si++) {
    const sd = si ? 1 : -1,
      a = sd < 0 ? q.aL || 0 : q.aR || 0,
      e = sd < 0 ? q.eL || 0 : q.eR || 0,
      wq = sd < 0 ? q.wL || 0 : q.wR || 0,
      oq = sd < 0 ? q.oL || 0 : q.oR || 0,
      zz = sd < 0 ? -(q.zL == null ? q.sz || 0 : q.zL) : q.sz || 0,
      tw = sd < 0 ? q.hL || 0 : -(q.hR || 0), // humeral twist about the upper-arm bone, applied first (XZY)
      sh = child(ch, sd * RIG.shX * k, RIG.sh, 0, euler(-a, tw, zz, "XZY", M())),
      el = child(sh, 0, -RIG.ua, 0, rot(0, -e, M())),
      wr = child(el, 0, -RIG.fa, 0, mm(rot(1, oq, M()), rot(0, -wq, M()), M())),
      j = 12 + si * 4;
    put(j, sh.t);
    put(j + 1, el.t);
    put(j + 2, wr.t);
    put(j + 3, pt(wr, 0, -0.32, 0.05));
  }
  return out;
}
