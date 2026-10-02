// Skinned player rig: one SkinnedMesh per player (one draw call) on a bone hierarchy that mirrors the
// sim's joint model exactly (so pose.ts handPos stays the true release point). Elbows/knees/shoulders are
// smooth-weighted across bones; feet plant on the floor with two-bone leg IK.
import * as THREE from "three";
import { mergeBufferGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { W3 } from "../core/sim";

const L1 = 1.58, // thigh (hip -> knee pivot)
  L2 = 1.6; // shin (knee -> ankle)

type Part = { g: THREE.BufferGeometry; col: string; bone: number; blend?: { to: number; axis: "y"; from: number; len: number; end: "start" | "end" } };

export interface Rig {
  G: THREE.Group;
  mesh: THREE.SkinnedMesh;
  bd: THREE.Bone;
  tl: THREE.Bone;
  tr: THREE.Bone;
  kl: THREE.Bone;
  kr: THREE.Bone;
  sL: THREE.Bone;
  sR: THREE.Bone;
  eL: THREE.Bone;
  eR: THREE.Bone;
  wL: THREE.Bone;
  wR: THREE.Bone;
  plant: { on: boolean; x: number; y: number; z: number; w: number }[];
  extra: THREE.Material[];
}

const MAT = new Map<string, THREE.MeshStandardMaterial>();
function skinMat() {
  let m = MAT.get("skin");
  if (!m) MAT.set("skin", (m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.02 })));
  return m;
}

/** Build a part in its bone's local frame, then move it to bind-pose model space. */
function put(parts: Part[], bonePos: THREE.Vector3[], g: THREE.BufferGeometry, col: string, bone: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, blend?: Part["blend"]) {
  g = g.clone();
  g.scale(sx, sy, sz);
  g.translate(x + bonePos[bone].x, y + bonePos[bone].y, z + bonePos[bone].z);
  if (g.index) g = g.toNonIndexed();
  parts.push({ g, col, bone, blend });
}

export function makeRig(p: any, tex: (c: HTMLCanvasElement) => THREE.Texture): Rig {
  const k = p.bk,
    sk = p.skin,
    hc = sk === "#e8b88f" ? "#3d2a18" : "#121212";
  // ---- bones (rest pose = all rotations zero, same offsets as the sim's FK) ----
  const B = (x: number, y: number, z: number) => {
    const b = new THREE.Bone();
    b.position.set(x, y, z);
    return b;
  };
  const hips = B(0, 0, 0),
    bd = B(0, 3.2, 0),
    tl = B(-0.32, 3.2, 0),
    tr = B(0.32, 3.2, 0),
    kl = B(0, -L1, 0),
    kr = B(0, -L1, 0),
    sL = B(-0.88 * k * 0.95, 1.9, 0),
    sR = B(0.88 * k * 0.95, 1.9, 0),
    eL = B(0, -1.02, 0),
    eR = B(0, -1.02, 0),
    wL = B(0, -1, 0),
    wR = B(0, -1, 0);
  hips.add(bd, tl, tr);
  tl.add(kl);
  tr.add(kr);
  bd.add(sL, sR);
  sL.add(eL);
  sR.add(eR);
  eL.add(wL);
  eR.add(wR);
  const bones = [hips, bd, tl, tr, kl, kr, sL, sR, eL, eR, wL, wR];
  const I = Object.fromEntries(["hips", "bd", "tl", "tr", "kl", "kr", "sL", "sR", "eL", "eR", "wL", "wR"].map((n, i) => [n, i])) as Record<string, number>;
  hips.updateMatrixWorld(true);
  const bp = bones.map((b) => new THREE.Vector3().setFromMatrixPosition(b.matrixWorld));
  // ---- smooth geometry ----
  const cap = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 6, 14);
  const sph = new THREE.SphereGeometry(1, 20, 14),
    box = (w: number, h: number, d: number) => roundBox(w, h, d),
    torso = new THREE.LatheGeometry(
      [
        [0.0, -0.45],
        [0.86, -0.42],
        [0.9, 0.2],
        [1.0, 0.85],
        [1.04, 1.25],
        [0.82, 1.55],
        [0.0, 1.62],
      ].map(([a, b]) => new THREE.Vector2(a, b)),
      20,
    );
  const parts: Part[] = [];
  for (const [t, kn] of [
    [I.tl, I.kl],
    [I.tr, I.kr],
  ]) {
    // thigh, smooth into the knee
    put(parts, bp, cap(0.22, 1.2), sk, t, 0, -0.8, 0, 1, 1, 1, { to: kn, axis: "y", from: -L1, len: 0.45, end: "end" });
    put(parts, bp, cap(0.31 * k, 0.4), p.col, t, 0, -0.32, 0); // shorts
    put(parts, bp, cap(0.17, 1.25), sk, kn, 0, -0.78, 0, 1, 1, 1, { to: t, axis: "y", from: 0, len: 0.4, end: "start" });
    put(parts, bp, cap(0.185, 0.2), "#f4f4f4", kn, 0, -1.33, 0); // sock
    put(parts, bp, box(0.38, 0.26, 0.8), "#fafafa", kn, 0, -1.6, 0.14); // shoe
    put(parts, bp, box(0.4, 0.07, 0.82), "#222222", kn, 0, -1.73, 0.14); // sole
  }
  put(parts, bp, torso, p.col, I.bd, 0, 0.3, 0, 0.62 * k, 1, 0.42 * k);
  put(parts, bp, cap(0.15, 0.25), sk, I.bd, 0, 2.2, 0); // neck
  put(parts, bp, sph, sk, I.bd, 0, 2.72, 0.02, 0.37, 0.45, 0.4); // head
  put(parts, bp, sph, sk, I.bd, 0.37, 2.72, 0, 0.07, 0.11, 0.07);
  put(parts, bp, sph, sk, I.bd, -0.37, 2.72, 0, 0.07, 0.11, 0.07);
  if (p.hr === 1) put(parts, bp, sph, hc, I.bd, 0, 2.88, -0.02, 0.39, 0.3, 0.42);
  if (p.hr === 2) {
    put(parts, bp, sph, hc, I.bd, 0, 2.86, -0.03, 0.41, 0.36, 0.44);
    put(parts, bp, box(0.5, 0.9, 0.22), hc, I.bd, 0, 2.5, -0.36);
  }
  if (p.hr === 3) put(parts, bp, sph, hc, I.bd, 0, 2.98, -0.04, 0.52, 0.5, 0.52);
  if (p.bd) put(parts, bp, sph, hc, I.bd, 0, 2.47, 0.28, 0.3, 0.2, 0.2);
  for (const [s, e, w] of [
    [I.sL, I.eL, I.wL],
    [I.sR, I.eR, I.wR],
  ]) {
    put(parts, bp, sph, p.col, s, 0, 0.02, 0, 0.27 * k, 0.26, 0.27 * k); // shoulder cap (jersey)
    put(parts, bp, cap(0.15 * k, 0.75), sk, s, 0, -0.5, 0, 1, 1, 1, { to: e, axis: "y", from: -1.02, len: 0.35, end: "end" });
    put(parts, bp, cap(0.125 * k, 0.78), sk, e, 0, -0.49, 0, 1, 1, 1, { to: s, axis: "y", from: 0, len: 0.3, end: "start" });
    put(parts, bp, box(0.17, 0.34, 0.11), sk, w, 0, -0.17, 0.02); // hand
  }
  // ---- skin attributes + merge (vertex colors, smooth joint weights) ----
  const c = new THREE.Color();
  const geos = parts.map((pt) => {
    const g = pt.g,
      n = g.attributes.position.count,
      col = new Float32Array(n * 3),
      si = new Uint16Array(n * 4),
      sw = new Float32Array(n * 4);
    c.set(pt.col).convertSRGBToLinear();
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < n; i++) {
      col.set([c.r, c.g, c.b], i * 3);
      let w2 = 0;
      if (pt.blend) {
        // Smooth skinning across the joint: up to 50% weight to the neighbouring bone, eased over b.len.
        const ly = pos.getY(i) - bp[pt.bone].y,
          b = pt.blend,
          u = Math.min(1, Math.max(0, b.end === "end" ? (b.from + b.len - ly) / b.len : (ly - (b.from - b.len)) / b.len));
        w2 = 0.5 * u * u * (3 - 2 * u);
      }
      si.set([pt.bone, pt.blend ? pt.blend.to : 0, 0, 0], i * 4);
      sw.set([1 - w2, w2, 0, 0], i * 4);
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setAttribute("skinIndex", new THREE.BufferAttribute(si, 4));
    g.setAttribute("skinWeight", new THREE.BufferAttribute(sw, 4));
    for (const k2 of Object.keys(g.attributes)) if (!["position", "normal", "color", "skinIndex", "skinWeight"].includes(k2)) g.deleteAttribute(k2);
    return g;
  });
  const geo = mergeBufferGeometries(geos)!;
  geos.forEach((g) => g.dispose());
  const mesh = new THREE.SkinnedMesh(geo, skinMat());
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  mesh.add(hips);
  mesh.bind(new THREE.Skeleton(bones));
  const G = new THREE.Group();
  G.add(mesh);
  // jersey number front/back + name (small textured planes riding the spine bone)
  const extra: THREE.Material[] = [];
  const cv = (w: number, h: number) => {
    const e = document.createElement("canvas");
    e.width = w;
    e.height = h;
    return [e, e.getContext("2d")!] as const;
  };
  const [nc, nx] = cv(128, 128);
  nx.fillStyle = "#fff";
  nx.font = "900 84px system-ui";
  nx.textAlign = "center";
  nx.fillText(String(p.no), 64, 96);
  const nm = new THREE.MeshBasicMaterial({ map: tex(nc), transparent: true });
  extra.push(nm);
  const nb = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), nm);
  nb.position.set(0, 1.35, -0.47 * k);
  nb.rotation.y = Math.PI;
  bd.add(nb);
  const nf = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.45), nm);
  nf.position.set(0, 1.5, 0.47 * k);
  bd.add(nf);
  const [n3c, n3] = cv(256, 64);
  n3.fillStyle = "#fff";
  n3.font = "800 40px system-ui";
  n3.textAlign = "center";
  n3.fillText(p.n.split(" ").pop().toUpperCase().slice(0, 11), 128, 46);
  const n3m = new THREE.MeshBasicMaterial({ map: tex(n3c), transparent: true });
  extra.push(n3m);
  const np3 = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.35), n3m);
  np3.position.set(0, 1.88, -0.46 * k);
  np3.rotation.y = Math.PI;
  bd.add(np3);
  G.scale.setScalar(p.ht / 6.4);
  const pl = () => ({ on: false, x: 0, y: 0, z: 0, w: 0 });
  return { G, mesh, bd, tl, tr, kl, kr, sL, sR, eL, eR, wL, wR, plant: [pl(), pl()], extra };
}

/** Joint angles (sim p.q) -> bone rotations. Same mapping as the original rig, so hand FK stays exact. */
export function applyPose(m: Rig, p: any) {
  const q = p.q;
  if (!q) return;
  const w = W3(p.x, p.y, p.z);
  m.G.position.set(w[0], w[1] - q.cr * 0.4, w[2]);
  m.G.rotation.y = Math.PI / 2 - p.f;
  m.tl.rotation.set(-q.tL, 0, -(q.hz || 0));
  m.tr.rotation.set(-q.tR, 0, q.hz || 0);
  m.kl.rotation.x = q.kL;
  m.kr.rotation.x = q.kR;
  m.sL.rotation.set(-q.aL, 0, -(q.zL == null ? q.sz : q.zL));
  m.sR.rotation.set(-q.aR, 0, q.sz);
  m.eL.rotation.x = -q.eL;
  m.eR.rotation.x = -q.eR;
  m.wL.rotation.x = -(q.wL || 0);
  m.wR.rotation.x = -(q.wR || 0);
  m.bd.rotation.set(q.ln, q.ty, q.rz, "YXZ");
}

const V1 = new THREE.Vector3(),
  V2 = new THREE.Vector3(),
  INV = new THREE.Matrix4();
/**
 * Foot planting: while a foot is in its stance phase (leg swinging back) it stays where it touched down;
 * a two-bone IK solve in the leg's sagittal plane bends hip and knee to reach it. Fades in/out so it never pops.
 */
export function footIK(m: Rig, p: any, dt: number, on: boolean) {
  const grounded = on && p.z < 1.5 && (p.mode === "i" || p.mode === "b") && !(p.postA > 0);
  const sp = Math.hypot(p.vx, p.vy);
  m.G.updateMatrixWorld(true);
  for (let s = 0; s < 2; s++) {
    const th = s ? m.tr : m.tl,
      kn = s ? m.kr : m.kl,
      pl = m.plant[s];
    // stance = the leg moving backward relative to the body (or standing still)
    const stance = grounded && (sp < 25 || (s ? Math.cos(p.ph) > 0.15 : Math.cos(p.ph) < -0.15));
    kn.localToWorld(V1.set(0, -L2, 0)); // FK ankle (world)
    if (stance && !pl.on) {
      pl.on = true;
      pl.x = V1.x;
      pl.y = Math.min(V1.y, 0.25);
      pl.z = V1.z;
    }
    if (!stance) pl.on = false;
    if (pl.on && Math.hypot(V1.x - pl.x, V1.z - pl.z) > 1.4) pl.on = false; // stride too long: lift
    pl.w += ((pl.on ? 1 : 0) - pl.w) * Math.min(1, dt * 14);
    if (pl.w < 0.02) continue;
    // target in the hip-joint parent frame (the rig root under G's scale)
    const par = th.parent!;
    INV.copy(par.matrixWorld).invert();
    V2.set(pl.x, pl.y, pl.z).applyMatrix4(INV).sub(th.position); // hip -> target, parent-local
    const dy = V2.y,
      dz = V2.z,
      d = Math.min(L1 + L2 - 0.01, Math.max(0.4, Math.hypot(dy, dz)));
    const a1 = Math.acos(Math.min(1, Math.max(-1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)))),
      tIK = Math.atan2(dz, -dy) + a1,
      kIK = Math.PI - Math.acos(Math.min(1, Math.max(-1, (L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2))));
    const w = pl.w,
      tFK = -th.rotation.x,
      kFK = kn.rotation.x;
    th.rotation.x = -(tFK + (tIK - tFK) * w);
    kn.rotation.x = kFK + (kIK - kFK) * w;
    th.updateMatrixWorld(true);
  }
}

/** Box with softened edges (a few chamfer segments) so shoes and hands read as shapes, not crates. */
function roundBox(w: number, h: number, d: number) {
  const g = new THREE.BoxGeometry(w, h, d, 2, 2, 2),
    a = g.attributes.position as THREE.BufferAttribute,
    r = Math.min(w, h, d) * 0.28;
  for (let i = 0; i < a.count; i++) {
    const x = a.getX(i),
      y = a.getY(i),
      z = a.getZ(i),
      cx = Math.max(-w / 2 + r, Math.min(w / 2 - r, x)),
      cy = Math.max(-h / 2 + r, Math.min(h / 2 - r, y)),
      cz = Math.max(-d / 2 + r, Math.min(d / 2 - r, z));
    V1.set(x - cx, y - cy, z - cz);
    if (V1.lengthSq() > 1e-9) V1.setLength(r);
    a.setXYZ(i, cx + V1.x, cy + V1.y, cz + V1.z);
  }
  g.computeVertexNormals();
  return g;
}
