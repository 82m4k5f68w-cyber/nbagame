// Retarget CMU motion capture (BVH, mocap.cs.cmu.edu via the cgspeed BVH conversion; "free for use in research and
// commercial projects") onto the Pro Play joint model, and write src/core/mocap.ts with compact looping curves.
//   npx tsx scripts/mocap/retarget.ts            (downloads the clips into scripts/mocap/.cache, git-ignored)
// Everything is computed from joint POSITIONS (forward kinematics of the BVH), so the mapping does not depend on the
// capture skeleton's rest rotations, and mirroring (a right-handed shooter) is just x -> -x with sides swapped.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import * as THREE from "three";

const CACHE = path.resolve("scripts/mocap/.cache"),
  SRC = "https://raw.githubusercontent.com/una-dinosauria/cmu-mocap/master/data";

type Joint = { name: string; off: number[]; ch: string[]; kids: Joint[]; ci: number };
function parse(txt: string) {
  const tok = txt.split(/\s+/).filter(Boolean);
  let i = 0,
    nch = 0;
  const joints: Joint[] = [];
  const node = (): Joint => {
    const name = tok[i++];
    const j: Joint = { name, off: [0, 0, 0], ch: [], kids: [], ci: 0 };
    joints.push(j);
    i++; // {
    while (tok[i] !== "}") {
      const t = tok[i++];
      if (t === "OFFSET") j.off = [+tok[i++], +tok[i++], +tok[i++]];
      else if (t === "CHANNELS") {
        const n = +tok[i++];
        j.ci = nch;
        for (let k = 0; k < n; k++) j.ch.push(tok[i++]);
        nch += n;
      } else if (t === "JOINT") j.kids.push(node());
      else if (t === "End") {
        i++; // Site
        i++; // {
        while (tok[i] !== "}") i++;
        i++;
      }
    }
    i++; // }
    return j;
  };
  if (tok[i++] !== "HIERARCHY") throw new Error("not BVH");
  i++; // ROOT
  const root = node();
  if (tok[i++] !== "MOTION") throw new Error("no MOTION");
  i++; // Frames:
  const nf = +tok[i++];
  i += 2; // Frame Time:
  const dt = +tok[i++];
  const frames: Float32Array[] = [];
  for (let f = 0; f < nf; f++) {
    const a = new Float32Array(nch);
    for (let k = 0; k < nch; k++) a[k] = +tok[i++];
    frames.push(a);
  }
  return { root, joints, frames, dt };
}

/** World positions of every joint for one frame. */
function fk(root: Joint, fr: Float32Array) {
  const out: Record<string, THREE.Vector3> = {};
  const D = Math.PI / 180,
    m = new THREE.Matrix4(),
    r = new THREE.Matrix4();
  const walk = (j: Joint, parent: THREE.Matrix4) => {
    const M = parent.clone().multiply(m.makeTranslation(j.off[0], j.off[1], j.off[2]));
    for (let k = 0; k < j.ch.length; k++) {
      const c = j.ch[k],
        v = fr[j.ci + k];
      if (c === "Xposition") M.multiply(m.makeTranslation(v, 0, 0));
      else if (c === "Yposition") M.multiply(m.makeTranslation(0, v, 0));
      else if (c === "Zposition") M.multiply(m.makeTranslation(0, 0, v));
      else if (c === "Xrotation") M.multiply(r.makeRotationX(v * D));
      else if (c === "Yrotation") M.multiply(r.makeRotationY(v * D));
      else if (c === "Zrotation") M.multiply(r.makeRotationZ(v * D));
    }
    out[j.name] = new THREE.Vector3().setFromMatrixPosition(M);
    for (const k of j.kids) walk(k, M);
  };
  walk(root, new THREE.Matrix4());
  return out;
}

const CH = ["tL", "tR", "kL", "kR", "fL", "fR", "hz", "hs", "ln", "ty", "rz", "cx", "cy", "aL", "aR", "eL", "eR", "sz", "zL", "cr"] as const;
type Pose = Record<(typeof CH)[number], number>;

/** One frame -> our joint values. `mirror`: the capture's right side becomes our "R" (shooting) chain. */
function retarget(P: Record<string, THREE.Vector3>, heading: THREE.Vector3, rest: { hip: number; knee: [number, number]; ank: [number, number]; leg: number }, mirror: boolean): Pose {
  const g = (n: string) => {
    const v = P[n].clone();
    if (mirror) v.x = -v.x;
    return v;
  };
  // our R chain = the capture side that sits at +x (left un-mirrored, right when mirrored)
  const A = mirror ? "Right" : "Left",
    Bs = mirror ? "Left" : "Right";
  const hipR = g(A + "UpLeg"),
    hipL = g(Bs + "UpLeg"),
    kneeR = g(A + "Leg"),
    kneeL = g(Bs + "Leg"),
    ankR = g(A + "Foot"),
    ankL = g(Bs + "Foot"),
    toeR = g(A + "ToeBase"),
    toeL = g(Bs + "ToeBase"),
    hips = g("Hips"),
    sp1 = g("Spine1"),
    neck = g("Neck"),
    shR = g(A + "Arm"),
    shL = g(Bs + "Arm"),
    elR = g(A + "ForeArm"),
    elL = g(Bs + "ForeArm"),
    wrR = g(A + "Hand"),
    wrL = g(Bs + "Hand");
  // heading frame H (yaw only), pelvis frame, chest frame - all right-handed with z forward, y up, x = our R side
  const hz = heading.clone();
  if (mirror) hz.x = -hz.x;
  hz.y = 0;
  hz.normalize();
  const hy = new THREE.Vector3(0, 1, 0),
    hx = new THREE.Vector3().crossVectors(hy, hz),
    H = new THREE.Matrix4().makeBasis(hx, hy, hz);
  const frame = (xd: THREE.Vector3, yd: THREE.Vector3) => {
    const x = xd.clone().normalize(),
      y = yd.clone().sub(x.clone().multiplyScalar(yd.dot(x))).normalize(),
      z = new THREE.Vector3().crossVectors(x, y);
    return new THREE.Matrix4().makeBasis(x, y, z);
  };
  const Pm = frame(hipR.clone().sub(hipL), sp1.clone().sub(hips)),
    Cm = frame(shR.clone().sub(shL), neck.clone().sub(sp1));
  const Hi = H.clone().invert();
  const pe = new THREE.Euler().setFromRotationMatrix(Hi.clone().multiply(Pm), "YXZ"),
    ce = new THREE.Euler().setFromRotationMatrix(Pm.clone().invert().multiply(Cm), "YXZ");
  // our chest as the rig will build it (no z twist on the chest)
  const ourC = H.clone()
    .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(pe.x, pe.y, pe.z, "YXZ")))
    .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(ce.x, ce.y, 0, "YXZ")));
  const ourCi = ourC.clone().invert();
  const loc = (M: THREE.Matrix4, a: THREE.Vector3, b: THREE.Vector3) => b.clone().sub(a).normalize().applyMatrix4(new THREE.Matrix4().extractRotation(M));
  const tR3 = loc(Hi, hipR, kneeR),
    tL3 = loc(Hi, hipL, kneeL),
    angle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => b.clone().sub(a).normalize().angleTo(c.clone().sub(b).normalize());
  const uR = loc(ourCi, shR, elR),
    uL = loc(ourCi, shL, elL);
  const asR = Math.asin(THREE.MathUtils.clamp(tR3.x, -1, 1)),
    asL = Math.asin(THREE.MathUtils.clamp(tL3.x, -1, 1));
  return {
    tR: Math.atan2(tR3.z, -tR3.y),
    tL: Math.atan2(tL3.z, -tL3.y),
    kR: angle(hipR, kneeR, ankR) - rest.knee[1],
    kL: angle(hipL, kneeL, ankL) - rest.knee[0],
    fR: angle(kneeR, ankR, toeR) - rest.ank[1],
    fL: angle(kneeL, ankL, toeL) - rest.ank[0],
    hz: (asR - asL) / 2,
    hs: (asR + asL) / 2,
    ln: pe.x,
    ty: pe.y,
    rz: pe.z,
    cx: ce.x,
    cy: ce.y,
    aR: Math.atan2(uR.z, -uR.y),
    aL: Math.atan2(uL.z, -uL.y),
    sz: Math.asin(THREE.MathUtils.clamp(uR.x, -1, 1)),
    zL: -Math.asin(THREE.MathUtils.clamp(uL.x, -1, 1)),
    eR: angle(shR, elR, wrR),
    eL: angle(shL, elL, wrL),
    cr: ((rest.hip - hips.y) * (3.18 / rest.leg)) / 0.4,
  };
}

function load(id: string) {
  const f = path.join(CACHE, id + ".bvh");
  if (!fs.existsSync(f)) {
    fs.mkdirSync(CACHE, { recursive: true });
    execSync(`curl -sSf --max-time 120 -o ${f} ${SRC}/0${id.slice(0, 2)}/${id}.bvh`);
  }
  return parse(fs.readFileSync(f, "utf8"));
}

function analyse(id: string, mirror = false) {
  const b = load(id);
  const F = b.frames.map((fr) => fk(b.root, fr));
  const r0 = F[0]; // frame 1 = T pose
  const side = (s: string) => (mirror ? (s === "L" ? "Right" : "Left") : s === "L" ? "Right" : "Left"); // our L side
  void side;
  const legLen = r0.LeftUpLeg.distanceTo(r0.LeftLeg) + r0.LeftLeg.distanceTo(r0.LeftFoot);
  const ang = (a: THREE.Vector3, b2: THREE.Vector3, c: THREE.Vector3) => b2.clone().sub(a).normalize().angleTo(c.clone().sub(b2).normalize());
  const L = mirror ? "Left" : "Right",
    R = mirror ? "Right" : "Left";
  const rest = {
    hip: r0.Hips.y,
    leg: legLen,
    knee: [ang(r0[L + "UpLeg"], r0[L + "Leg"], r0[L + "Foot"]), ang(r0[R + "UpLeg"], r0[R + "Leg"], r0[R + "Foot"])] as [number, number],
    ank: [ang(r0[L + "Leg"], r0[L + "Foot"], r0[L + "ToeBase"]), ang(r0[R + "Leg"], r0[R + "Foot"], r0[R + "ToeBase"])] as [number, number],
  };
  // pelvis facing per frame, smoothed over ~0.4 s (heading frame)
  const fwd = F.map((P) => {
    const x = P.LeftUpLeg.clone().sub(P.RightUpLeg),
      y = P.Spine1.clone().sub(P.Hips);
    return new THREE.Vector3().crossVectors(x, y).setY(0).normalize();
  });
  const W = Math.round(0.2 / b.dt);
  const head = fwd.map((_, i) => {
    const s = new THREE.Vector3();
    for (let k = Math.max(1, i - W); k <= Math.min(F.length - 1, i + W); k++) s.add(fwd[k]);
    return s.normalize();
  });
  const poses = F.map((P, i) => retarget(P, head[i], rest, mirror));
  return { b, F, poses, head, legLen, dt: b.dt };
}

/** Average looping cycle from [from, to) frames: cycles delimited by peaks of `sig`, each resampled to N. */
function cycle(a: ReturnType<typeof analyse>, from: number, to: number, sig: (i: number) => number, N = 40) {
  const peaks: number[] = [];
  const S = (i: number) => sig(i);
  const minGap = Math.round(0.35 / a.dt);
  for (let i = from + 2; i < to - 2; i++) if (S(i) > S(i - 1) && S(i) >= S(i + 1) && S(i) > S(i - 2) && S(i) >= S(i + 2) && (!peaks.length || i - peaks[peaks.length - 1] > minGap)) peaks.push(i);
  const cyc: Pose[][] = [];
  let disp = 0,
    dur = 0;
  for (let c = 0; c + 1 < peaks.length; c++) {
    const p0 = peaks[c],
      p1 = peaks[c + 1],
      out: Pose[] = [];
    for (let n = 0; n < N; n++) {
      const t = p0 + ((p1 - p0) * n) / N,
        i0 = Math.floor(t),
        u = t - i0,
        A = a.poses[i0],
        Bp = a.poses[Math.min(a.poses.length - 1, i0 + 1)],
        o: any = {};
      for (const k of CH) o[k] = A[k] + (Bp[k] - A[k]) * u;
      out.push(o);
    }
    cyc.push(out);
    const h0 = a.F[p0].Hips,
      h1 = a.F[p1].Hips;
    disp += Math.hypot(h1.x - h0.x, h1.z - h0.z);
    dur += (p1 - p0) * a.dt;
  }
  if (!cyc.length) throw new Error("no cycles");
  const avg: Pose[] = [];
  for (let n = 0; n < N; n++) {
    const o: any = {};
    for (const k of CH) o[k] = cyc.reduce((s, c2) => s + c2[n][k], 0) / cyc.length;
    avg.push(o);
  }
  // remove the static yaw offset (the smoothed heading lags turns) and make the loop seamless
  const ftPerUnit = 3.18 / a.legLen;
  return { avg, cycles: cyc.length, speedPx: (disp / dur) * ftPerUnit * 10, strideHalfPx: (disp / cyc.length / 2) * ftPerUnit * 10 };
}

// ---- clip catalogue ----
const out: any = {};
// signal: our-L ankle ahead of our-R ankle along the travel axis (z forward, x sideways) in the heading frame
const lead = (a: ReturnType<typeof analyse>, axis: "z" | "x", mirror = false) => (i: number) => {
  const P = a.F[i],
    h = a.head[i],
    x = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), h),
    L = P[mirror ? "LeftFoot" : "RightFoot"],
    R = P[mirror ? "RightFoot" : "LeftFoot"],
    d = L.clone().sub(R);
  return axis === "z" ? d.dot(h) : d.dot(x);
};
function addCycle(name: string, id: string, axis: "z" | "x", f0: number, f1: number) {
  const a = analyse(id);
  const c = cycle(a, Math.round(f0 * a.poses.length), Math.round(f1 * a.poses.length), lead(a, axis));
  // phase convention: our tL is max at gait phase pi/2 -> rotate so sample 0 = phase 0
  let mx = 0;
  c.avg.forEach((p, i) => p.tL > c.avg[mx].tL && (mx = i));
  const N = c.avg.length,
    sh = (mx - N / 4 + N) % N,
    rot = c.avg.map((_, i) => c.avg[(i + sh) % N]);
  // yaw is re-centred (the heading filter lags); torso roll/lean keep their mean (posture)
  const mean = (k: string) => rot.reduce((s, p: any) => s + p[k], 0) / N;
  const my = mean("ty"),
    mcy = mean("cy");
  for (const p of rot) (p.ty -= my), (p.cy -= mcy);
  // travel direction in the heading frame (+x = our R side, +z forward), for mirroring sideways clips
  let dx = 0,
    dz = 0;
  for (let i = Math.round(f0 * a.F.length) + 1; i < Math.round(f1 * a.F.length); i++) {
    const h = a.head[i],
      xh = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), h),
      d = a.F[i].Hips.clone().sub(a.F[i - 1].Hips);
    dx += d.dot(xh);
    dz += d.dot(h);
  }
  out[name] = { speedPx: +c.speedPx.toFixed(1), stridePx: +c.strideHalfPx.toFixed(1), cycles: c.cycles, frames: rot, dir: Math.abs(dx) > Math.abs(dz) ? Math.sign(dx) * 2 : Math.sign(dz) };
  console.log(name, id, "cycles", c.cycles, "speed px/s", c.speedPx.toFixed(0), "half-stride px", c.strideHalfPx.toFixed(1));
}
addCycle("walk", "07_01", "z", 0.15, 0.85);
addCycle("run", "09_01", "z", 0.05, 0.98);
addCycle("drib", "06_02", "z", 0.15, 0.85);
addCycle("back", "06_06", "z", 0.15, 0.85);
addCycle("side", "06_08", "x", 0.15, 0.85);
addCycle("low", "06_13", "z", 0.2, 0.5);

// ---- jump shot from "dribble, shoot" (mirrored so the capture's right hand is our shooting chain) ----
function shot(id: string) {
  const a = analyse(id, true);
  // release = highest shooting-hand point; gather = lowest hand point in the 0.9 s before it
  let rel = 0;
  a.F.forEach((P, i) => P.RightHand.y > a.F[rel].RightHand.y && (rel = i));
  let g0 = rel;
  for (let i = rel; i > Math.max(0, rel - Math.round(0.9 / a.dt)); i--) if (a.F[i].RightHand.y < a.F[g0].RightHand.y) g0 = i;
  const end = Math.min(a.F.length - 1, rel + Math.round(((rel - g0) * 0.3) / 0.7));
  const keys: Record<string, number[]> = {};
  const K = 14;
  for (const ch of ["aR", "eR", "aL", "eL", "sz", "zL", "tL", "tR", "kL", "kR", "ln", "rz", "ty"] as const) {
    const arr: number[] = [];
    for (let n = 0; n <= K; n++) {
      const k = n / K,
        i = Math.round(g0 + (end - g0) * k);
      arr.push(+k.toFixed(3), +a.poses[i][ch].toFixed(3));
    }
    keys[ch] = arr;
  }
  // yaw relative to the gather, legs relative to standing straight
  const t0 = keys.ty[1];
  for (let n = 1; n < keys.ty.length; n += 2) keys.ty[n] = +(keys.ty[n] - t0).toFixed(3);
  console.log("shot", id, "gather->release", ((rel - g0) * a.dt).toFixed(2), "s");
  return keys;
}
out.shot = shot("06_15");

// ---- write src/core/mocap.ts: curves quantized to 0.01 rad, base64 int8 per channel ----
const q = (v: number) => Math.max(-127, Math.min(127, Math.round(v * 40))); // 1/40 rad steps (+-3.17 rad)
const enc = (fr: Pose[]) => {
  const bytes = new Int8Array(fr.length * CH.length);
  fr.forEach((p, i) => CH.forEach((k, j) => (bytes[i * CH.length + j] = q(p[k]))));
  return Buffer.from(bytes.buffer).toString("base64");
};
const cyc = Object.entries(out)
  .filter(([k]) => k !== "shot")
  .map(([k, v]: any) => `  ${k}: { speed: ${v.speedPx}, stride: ${v.stridePx}, dir: ${v.dir}, n: ${v.frames.length}, d: "${enc(v.frames)}" },`)
  .join("\n");
const ts = `// GENERATED by scripts/mocap/retarget.ts - do not edit by hand.
// Motion capture: CMU Graphics Lab Motion Capture Database (mocap.cs.cmu.edu), BVH conversion by B. Hahne (cgspeed).
// "The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding from
// NSF EIA-0196217." Free for research and commercial use; retargeted onto the Pro Play joint model.
export const MC_CH = ${JSON.stringify(CH)} as const;
/** Looping gait cycles (sample 0 = gait phase 0), int8 per channel at 1/40 rad; speed px/s, stride = half cycle px. */
// dir: travel direction in the capture (1 forward, -1 backward, +-2 sideways toward our R / L side)
export const MC_RAW: Record<string, { speed: number; stride: number; dir: number; n: number; d: string }> = {
${cyc}
};
/** Jump shot captured from "dribble, shoot" (gather 0 .. release 0.7 .. follow-through 1), clip keyframes. */
export const MC_SHOT: Record<string, number[]> = ${JSON.stringify(out.shot)};
`;
fs.writeFileSync("src/core/mocap.ts", ts);
console.log("wrote src/core/mocap.ts", ts.length, "bytes");
