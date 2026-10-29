// BVH -> the game's full joint model (31 channels, sim.ts QK) for shot motion matching (v5.6).
// Same conventions as scripts/mocap/retarget.ts (positions -> pelvis / chest / legs / upper arms; mirror = the capture's
// right side becomes our "R" shooting chain), plus what that retarget leaves out:
//   - humeral twist hL/hR: solved so the FOREARM points where the capture's forearm points (exact elbow plane),
//   - wrist flex wR/wL + forearm twist oR/oL: the capture's hand frame (joint rotation vs the frame-0 T-pose) expressed
//     in our forearm frame, decomposed as the rig's Ry(o) Rx(-w) (YXZ; the residual deviation is dropped),
//   - neck / head nk, hp, hy: head frame in our chest frame (pitch split 35% neck / 65% head).
// Everything is computed per frame from world positions + world joint rotations, so the capture skeleton's rest
// rotations do not matter. Used by scripts/mocap/shots.ts; src/core is not touched by this module.
import fs from "node:fs";
import * as THREE from "three";

export type Joint = { name: string; off: number[]; ch: string[]; kids: Joint[]; ci: number };
export function parse(txt: string) {
  const tok = txt.split(/\s+/).filter(Boolean);
  let i = 0,
    nch = 0;
  const joints: Joint[] = [];
  const node = (): Joint => {
    const name = tok[i++];
    const j: Joint = { name, off: [0, 0, 0], ch: [], kids: [], ci: 0 };
    joints.push(j);
    i++;
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
        i += 2;
        while (tok[i] !== "}") i++;
        i++;
      }
    }
    i++;
    return j;
  };
  if (tok[i++] !== "HIERARCHY") throw new Error("not BVH");
  i++;
  const root = node();
  if (tok[i++] !== "MOTION") throw new Error("no MOTION");
  i++;
  const nf = +tok[i++];
  i += 2;
  const dt = +tok[i++];
  const frames: Float32Array[] = [];
  for (let f = 0; f < nf; f++) {
    const a = new Float32Array(nch);
    for (let k = 0; k < nch; k++) a[k] = +tok[i++];
    frames.push(a);
  }
  return { root, joints, frames, dt };
}

export type Pose3 = { P: Record<string, THREE.Vector3>; R: Record<string, THREE.Matrix4> };
/** World positions and world rotations of every joint for one frame (Y up as in the cgspeed files). */
export function fk(root: Joint, fr: Float32Array): Pose3 {
  const P: Record<string, THREE.Vector3> = {},
    R: Record<string, THREE.Matrix4> = {};
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
    P[j.name] = new THREE.Vector3().setFromMatrixPosition(M);
    R[j.name] = new THREE.Matrix4().extractRotation(M);
    for (const k of j.kids) walk(k, M);
  };
  walk(root, new THREE.Matrix4());
  return { P, R };
}

/** The game's 31 pose channels (sim.ts QK order). gL/gR (finger curl) are not captured (written 0.35). */
export const QK = ["tL", "tR", "kL", "kR", "aL", "aR", "eL", "eR", "sz", "cr", "ln", "rz", "ty", "wR", "wL", "zL", "hz", "cx", "cy", "nk", "hy", "hp", "fL", "fR", "gL", "gR", "hs", "oL", "oR", "hL", "hR"] as const;
export type QPose = Record<(typeof QK)[number], number>;

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const basis = (x: THREE.Vector3, y: THREE.Vector3, z: THREE.Vector3) => new THREE.Matrix4().makeBasis(x, y, z);
/** Right-handed frame from a primary axis (y) and a secondary (z, orthogonalised). */
const frameYZ = (y0: THREE.Vector3, z0: THREE.Vector3) => {
  const y = y0.clone().normalize(),
    z = z0.clone().sub(y.clone().multiplyScalar(z0.dot(y))).normalize(),
    x = new THREE.Vector3().crossVectors(y, z);
  return basis(x, y, z);
};
const frameXY = (xd: THREE.Vector3, yd: THREE.Vector3) => {
  const x = xd.clone().normalize(),
    y = yd.clone().sub(x.clone().multiplyScalar(yd.dot(x))).normalize(),
    z = new THREE.Vector3().crossVectors(x, y);
  return basis(x, y, z);
};
const Rx = (a: number) => new THREE.Matrix4().makeRotationX(a),
  Ry = (a: number) => new THREE.Matrix4().makeRotationY(a),
  Rz = (a: number) => new THREE.Matrix4().makeRotationZ(a);
const mul = (...m: THREE.Matrix4[]) => m.reduce((a, b) => a.clone().multiply(b));
const tr = (m: THREE.Matrix4) => m.clone().transpose();

export type Clip31 = {
  id: string;
  dt: number;
  mirror: boolean;
  scale: number; // ft per capture unit (leg length -> 3.18 ft, the rig's thigh + shin at 6'4")
  q: QPose[]; // per frame (frame 0 = T pose is dropped)
  hip: THREE.Vector3[]; // pelvis position (ft, Y up, mirrored like the pose)
  head: THREE.Vector3[]; // heading (yaw only, unit)
  hand: { R: THREE.Vector3; L: THREE.Vector3 }[]; // our R / L wrist positions (ft)
  headTop: number[]; // head height (ft)
  foot: { L: number; R: number }[]; // lowest point of each foot (ft above the clip's floor)
};

/** Retarget a whole BVH onto the 31 channels. mirror: the capture's RIGHT side drives our R chain (right-handed shooter). */
export function retarget31(id: string, file: string, mirror: boolean): Clip31 {
  const b = parse(fs.readFileSync(file, "utf8"));
  const F = b.frames.map((fr) => fk(b.root, fr));
  const S = mirror ? -1 : 1;
  // world -> (mirrored) world: positions and directions flip x
  const mp = (v: THREE.Vector3) => V(v.x * S, v.y, v.z);
  const R0 = F[0].R;
  /** direction d0 (in the T-pose world frame) carried by joint j at frame f, mirrored */
  const dirOf = (f: Pose3, j: string, d0: THREE.Vector3) => {
    const Rr = f.R[j].clone().multiply(tr(R0[j]));
    return mp(d0.clone().applyMatrix4(Rr).normalize());
  };
  const T0 = F[0].P;
  // our R chain = the capture side at +x after mirroring
  const A = mirror ? "Right" : "Left",
    Bs = mirror ? "Left" : "Right";
  const Ath = mirror ? "R" : "L",
    Bth = mirror ? "L" : "R";
  void Ath, Bth;
  const legLen = T0.LeftUpLeg.distanceTo(T0.LeftLeg) + T0.LeftLeg.distanceTo(T0.LeftFoot),
    scale = 3.18 / legLen;
  const ang = (a: THREE.Vector3, b2: THREE.Vector3, c: THREE.Vector3) => b2.clone().sub(a).normalize().angleTo(c.clone().sub(b2).normalize());
  const rest = {
    hip: T0.Hips.y,
    knee: [ang(T0[Bs + "UpLeg"], T0[Bs + "Leg"], T0[Bs + "Foot"]), ang(T0[A + "UpLeg"], T0[A + "Leg"], T0[A + "Foot"])],
    ank: [ang(T0[Bs + "Leg"], T0[Bs + "Foot"], T0[Bs + "ToeBase"]), ang(T0[A + "Leg"], T0[A + "Foot"], T0[A + "ToeBase"])],
  };
  // T-pose hand frames (capture world): fingers along the arm, palm down; head forward +z, up +y
  // (the cgspeed Hand joint carries only the forearm twist - CMU "rwrist"; the flex lives in FingerBase - CMU "rhand")
  const finT = (side: string) => T0[side + "HandIndex1"].clone().sub(T0[side + "FingerBase"]).normalize();
  // pelvis facing (unmirrored capture: left hip at +x when facing +z), then mirrored like everything else
  const fwd = F.map((f) => {
    const x = f.P.LeftUpLeg.clone().sub(f.P.RightUpLeg),
      y = f.P.Spine1.clone().sub(f.P.Hips);
    return mp(new THREE.Vector3().crossVectors(x, y).setY(0).normalize());
  });
  const W = Math.round(0.2 / b.dt);
  const head = fwd.map((_, i) => {
    const s = new THREE.Vector3();
    for (let k = Math.max(1, i - W); k <= Math.min(F.length - 1, i + W); k++) s.add(fwd[k]);
    return s.normalize();
  });
  // floor: the lowest foot point over the clip (toe / ankle), so "airborne" is clip-relative
  let floor = 1e9;
  for (let i = 1; i < F.length; i++) for (const n of ["LeftFoot", "RightFoot", "LeftToeBase", "RightToeBase"]) floor = Math.min(floor, F[i].P[n].y);
  const out: Clip31 = { id, dt: b.dt, mirror, scale, q: [], hip: [], head: [], hand: [], headTop: [], foot: [] };
  let prevTw = [0, 0];
  for (let i = 1; i < F.length; i++) {
    const f = F[i],
      g = (n: string) => mp(f.P[n]);
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
    const hz = head[i].clone(),
      hy = V(0, 1, 0),
      hx = new THREE.Vector3().crossVectors(hy, hz),
      H = basis(hx, hy, hz),
      Hi = tr(H);
    const Pm = frameXY(hipR.clone().sub(hipL), sp1.clone().sub(hips)),
      Cm = frameXY(shR.clone().sub(shL), neck.clone().sub(sp1));
    const pe = new THREE.Euler().setFromRotationMatrix(mul(Hi, Pm), "YXZ"),
      ce = new THREE.Euler().setFromRotationMatrix(mul(tr(Pm), Cm), "YXZ");
    const ourC = mul(H, new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(pe.x, pe.y, pe.z, "YXZ")), new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(ce.x, ce.y, 0, "YXZ")));
    const ourCi = tr(ourC);
    const loc = (M: THREE.Matrix4, a: THREE.Vector3, b2: THREE.Vector3) => b2.clone().sub(a).normalize().applyMatrix4(M);
    const tR3 = loc(Hi, hipR, kneeR),
      tL3 = loc(Hi, hipL, kneeL);
    const asR = Math.asin(clamp(tR3.x, -1, 1)),
      asL = Math.asin(clamp(tL3.x, -1, 1));
    // ---- arms: upper arm (a, abduction), forearm (elbow, humeral twist), hand (wrist flex, forearm twist) ----
    const arm = (side: 1 | -1, sh: THREE.Vector3, el: THREE.Vector3, wr: THREE.Vector3, cap: string) => {
      const u = loc(ourCi, sh, el),
        fo = loc(ourCi, el, wr);
      const a = Math.atan2(u.z, -u.y),
        abd = Math.asin(clamp(u.x, -1, 1)), // R: sz ; L: -zL
        Rsh0 = mul(Rx(-a), Rz(abd)), // shoulder without the twist
        fl = fo.clone().applyMatrix4(tr(Rsh0)), // forearm in the twist-free upper-arm frame
        e = Math.acos(clamp(-fl.y, -1, 1));
      // twist about the upper arm: the elbow plane; undefined with a straight elbow -> fade to the last value
      let tw = Math.atan2(fl.x, fl.z);
      const si = side > 0 ? 1 : 0,
        conf = clamp((Math.sin(e) - 0.08) / 0.25, 0, 1);
      // keep the branch continuous
      while (tw - prevTw[si] > Math.PI) tw -= 2 * Math.PI;
      while (tw - prevTw[si] < -Math.PI) tw += 2 * Math.PI;
      tw = prevTw[si] + (tw - prevTw[si]) * conf;
      prevTw[si] = tw;
      const Rsh = mul(Rsh0, Ry(tw)),
        Ffore = mul(ourC, Rsh, Rx(-e)); // forearm frame (world)
      // captured hand: fingers along the T-pose arm, palm down in the T pose
      // (the rig's palm (+z, where the ball sits) maps to the T-pose's +y: calibrated so the captured release has the
      // palm under the ball like the classic clips' oR ~ 0)
      const fin = dirOf(f, cap + "FingerBase", finT(cap)),
        palm = dirOf(f, cap + "FingerBase", V(0, 1, 0));
      const Hc = frameYZ(fin.clone().negate(), palm), // our hand frame: -y fingers, +z palm
        M = mul(tr(Ffore), Hc),
        eu = new THREE.Euler().setFromRotationMatrix(M, "YXZ");
      // (with the palm calibrated to T-pose +y the decomposed flex comes out mirrored: cocked back = negative, as the rig)
      return { a, abd, e, tw, w: eu.x, o: eu.y };
    };
    const ar = arm(1, shR, elR, wrR, A),
      al = arm(-1, shL, elL, wrL, Bs);
    // ---- head: frame in our chest frame; pitch split neck / head ----
    const hf = dirOf(f, "Head", V(0, 0, 1)),
      hu = dirOf(f, "Head", V(0, 1, 0)),
      Mh = mul(ourCi, frameYZ(hu, hf)),
      he = new THREE.Euler().setFromRotationMatrix(Mh, "YXZ");
    const q: QPose = {
      tR: Math.atan2(tR3.z, -tR3.y),
      tL: Math.atan2(tL3.z, -tL3.y),
      kR: ang(hipR, kneeR, ankR) - rest.knee[1],
      kL: ang(hipL, kneeL, ankL) - rest.knee[0],
      fR: ang(kneeR, ankR, toeR) - rest.ank[1],
      fL: ang(kneeL, ankL, toeL) - rest.ank[0],
      hz: (asR - asL) / 2,
      hs: (asR + asL) / 2,
      ln: pe.x,
      ty: pe.y,
      rz: pe.z,
      cx: ce.x,
      cy: ce.y,
      aR: ar.a,
      sz: ar.abd,
      eR: ar.e,
      hR: -ar.tw,
      wR: ar.w,
      oR: ar.o,
      aL: al.a,
      zL: -al.abd,
      eL: al.e,
      hL: al.tw,
      wL: al.w,
      oL: al.o,
      nk: 0.35 * he.x,
      hp: 0.65 * he.x,
      hy: he.y,
      gL: 0.35,
      gR: 0.35,
      cr: ((rest.hip - hips.y) * scale) / 0.4,
    };
    out.q.push(q);
    out.hip.push(hips.clone().multiplyScalar(scale).setY((hips.y - floor) * scale));
    out.head.push(head[i].clone());
    out.hand.push({ R: wrR.clone().multiplyScalar(scale).setY((wrR.y - floor) * scale), L: wrL.clone().multiplyScalar(scale).setY((wrL.y - floor) * scale) });
    out.headTop.push((g("Head").y - floor) * scale);
    out.foot.push({
      L: (Math.min(ankL.y, toeL.y) - floor) * scale,
      R: (Math.min(ankR.y, toeR.y) - floor) * scale,
    });
  }
  return out;
}
