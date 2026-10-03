// Skinned player rig: one SkinnedMesh per player (one draw call) on a bone hierarchy that mirrors the
// sim's joint model exactly (so pose.ts handPos stays the true release point). Elbows/knees/shoulders are
// smooth-weighted across bones; feet plant on the floor with two-bone leg IK.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { W3, cl } from "../core/sim";
import { RIG, hipAb } from "../core/pose";

const L1 = RIG.L1, // thigh (hip -> knee pivot)
  L2 = RIG.L2; // shin (knee -> ankle)

type Blend = { to: number; axis: "y"; from: number; len: number; end: "start" | "end"; max?: number };
type Part = { g: THREE.BufferGeometry; col: string; bone: number; blend?: Blend; blend2?: Blend; mesh?: number };

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
  ch: THREE.Bone;
  nk: THREE.Bone;
  hd: THREE.Bone;
  al: THREE.Bone;
  ar: THREE.Bone;
  gL: THREE.Bone;
  gR: THREE.Bone;
  tf: THREE.Bone[]; // toe bones
  hem: THREE.Bone;
  hs: { x: number; vx: number; z: number; vz: number; px: number; pz: number };
  fl: THREE.Bone[]; // shorts-hem flap bones (one per leg, spring-lagged copies of the thigh)
  cloth: { x: number; vx: number; z: number; vz: number }[];
  plant: { on: boolean; x: number; y: number; z: number; w: number }[];
  extra: THREE.Material[];
}

const MAT = new Map<string, THREE.MeshStandardMaterial>();
/** Jersey mesh: a tiling bump map of little ventilation holes. Parts that are not jersey fabric sample one flat texel
 *  (uv 0,0 = between holes), so only the jersey shows the knit. */
function meshTex() {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d")!;
  x.fillStyle = "#fff";
  x.fillRect(0, 0, 64, 64);
  x.fillStyle = "#6a6a6a";
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      x.beginPath();
      x.ellipse(8 + i * 16 + (j % 2) * 8, 8 + j * 16, 3.2, 2.6, 0, 0, 6.3);
      x.fill();
    }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function skinMat() {
  let m = MAT.get("skin");
  if (!m) {
    const bt = meshTex();
    MAT.set("skin", (m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.02, bumpMap: bt, bumpScale: bt ? 0.6 : 0 })));
  }
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
    bd = B(0, RIG.hip, 0),
    ch = B(0, RIG.chest, 0),
    nk = B(0, RIG.neck, 0),
    hd = B(0, RIG.head, 0),
    tl = B(-RIG.hipX, RIG.hip, 0),
    tr = B(RIG.hipX, RIG.hip, 0),
    kl = B(0, -L1, 0),
    kr = B(0, -L1, 0),
    al = B(0, -L2, 0),
    ar = B(0, -L2, 0),
    sL = B(-RIG.shX * k, RIG.sh, 0),
    sR = B(RIG.shX * k, RIG.sh, 0),
    eL = B(0, -RIG.ua, 0),
    eR = B(0, -RIG.ua, 0),
    wL = B(0, -RIG.fa, 0),
    wR = B(0, -RIG.fa, 0),
    gL = B(0, -RIG.fing, 0),
    gR = B(0, -RIG.fing, 0),
    hem = B(0, -0.05, 0), // jersey hem spring bone (child of the pelvis)
    tfL = B(0, -0.16, 0.36), // toe joints (ball of the foot), children of the ankles
    tfR = B(0, -0.16, 0.36),
    flL = B(-RIG.hipX, RIG.hip, 0),
    flR = B(RIG.hipX, RIG.hip, 0);
  hips.add(bd, tl, tr, flL, flR);
  bd.add(ch, hem);
  ch.add(nk, sL, sR);
  nk.add(hd);
  tl.add(kl);
  tr.add(kr);
  kl.add(al);
  kr.add(ar);
  al.add(tfL);
  ar.add(tfR);
  sL.add(eL);
  sR.add(eR);
  eL.add(wL);
  eR.add(wR);
  wL.add(gL);
  wR.add(gR);
  const names = ["hips", "bd", "tl", "tr", "kl", "kr", "sL", "sR", "eL", "eR", "wL", "wR", "ch", "nk", "hd", "al", "ar", "gL", "gR", "flL", "flR", "tfL", "tfR", "hem"],
    bones = [hips, bd, tl, tr, kl, kr, sL, sR, eL, eR, wL, wR, ch, nk, hd, al, ar, gL, gR, flL, flR, tfL, tfR, hem];
  const I = Object.fromEntries(names.map((n, i) => [n, i])) as Record<string, number>;
  hips.updateMatrixWorld(true);
  const bp = bones.map((b) => new THREE.Vector3().setFromMatrixPosition(b.matrixWorld));
  // place a part by its position relative to the PELVIS bone (the old single-torso frame), skinned to `bone`
  const by = (bone: number) => bp[bone].y - bp[I.bd].y;
  const putT = (g: THREE.BufferGeometry, col: string, bone: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, blend?: Part["blend"]) =>
    put(parts, bp, g, col, bone, x - bp[bone].x, y - by(bone), z - bp[bone].z, sx, sy, sz, blend);
  // ---- smooth geometry ----
  const sph = new THREE.SphereGeometry(1, 24, 16),
    box = (w: number, h: number, d: number) => roundBox(w, h, d),
    // limb along -y from the joint: profile of [radius, y] pairs, lathed (muscle shape, not tubes)
    limb = (pr: number[][], seg = 16) => new THREE.LatheGeometry(pr.map(([r2, y]) => new THREE.Vector2(r2, y)), seg),
    torso = limb(
      [
        [0.0, -0.5],
        [0.86, -0.47],
        [0.92, 0.1],
        [0.97, 0.7],
        [1.06, 1.15],
        [1.0, 1.42],
        [0.66, 1.6],
        [0.0, 1.64],
      ],
      24,
    ),
    ring = (r2: number, t: number) => new THREE.TorusGeometry(r2, t, 6, 24).rotateX(Math.PI / 2);
  // personal style (deterministic per player): accessories and shoe colorway
  let h = 0;
  for (const ch of String(p.n)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const trim = isDark(p.col) ? "#f2f2f2" : "#16161c",
    shoeKind = h % 4, // 0 white, 1 team-color upper, 2 black, 3 white with team-color panels
    shoe = shoeKind === 1 ? p.col : shoeKind === 2 ? "#141414" : "#f6f6f6",
    sole = shoeKind === 2 ? "#202020" : "#f4f4f4",
    accent = h % 2 ? p.col : "#e8541e",
    sock = h % 5 === 0 ? "#141414" : "#f4f4f4",
    headband = h % 7 === 0,
    sleeve = h % 4 === 1 ? (h % 8 < 4 ? "#141414" : "#f2f2f2") : null;
  const parts: Part[] = [];
  for (const [t, kn, sd] of [
    [I.tl, I.kl, -1],
    [I.tr, I.kr, 1],
  ]) {
    // thigh: thick at the hip, quad bulge, tapering into the knee
    put(parts, bp, limb([[0.0, 0.05], [0.25, 0.0], [0.27, -0.4], [0.25, -0.9], [0.19, -1.45], [0.17, -1.62], [0.0, -1.66]]), sk, t, 0, 0, 0, 1, 1, 1, { to: kn, axis: "y", from: -L1, len: 0.45, end: "end" });
    // shorts: long and loose, flared hem, side stripe; the lower half rides the spring-lagged flap bone (cloth swing)
    const fb = t === I.tl ? I.flL : I.flR,
      flap = { to: fb, axis: "y" as const, from: -0.86, len: 0.62, end: "end" as const, max: 0.85 };
    put(parts, bp, limb([[0.0, 0.12], [0.34 * k, 0.1], [0.37 * k, -0.4], [0.39 * k, -0.86], [0.0, -0.88]], 18), p.col, t, 0, 0, 0, 1, 1, 1, flap);
    put(parts, bp, box(0.05, 0.8, 0.16), trim, t, sd * 0.37 * k, -0.42, 0, 1, 1, 1, flap);
    // calf: knee, calf muscle high and behind, slim ankle
    put(parts, bp, limb([[0.0, 0.08], [0.16, 0.05], [0.17, -0.25], [0.19, -0.5], [0.15, -0.95], [0.11, -1.35], [0.0, -1.42]]), sk, kn, 0, 0, -0.02, 1, 1, 1, { to: t, axis: "y", from: 0, len: 0.4, end: "start" });
    put(parts, bp, limb([[0.13, -1.12], [0.135, -1.48], [0.0, -1.5]], 12), sock, kn, 0, 0, 0);
    const an = kn === I.kl ? I.al : I.ar;
    // sneaker (on the ankle bone: rolls through the step): upper, midsole, outsole, toe cap, panels, heel tab, laces
    put(parts, bp, box(0.39, 0.27, 0.82), shoe, an, 0, 0, 0.14);
    put(parts, bp, box(0.41, 0.07, 0.85), sole, an, 0, -0.13, 0.14);
    put(parts, bp, box(0.4, 0.035, 0.86), shade(sole, 0.55), an, 0, -0.18, 0.14);
    const tfb = kn === I.kl ? I.tfL : I.tfR;
    put(parts, bp, box(0.36, 0.1, 0.24), shoeKind === 3 ? p.col : shade(shoe, 0.88), tfb, 0, 0.12, 0.11); // toe box bends at the ball of the foot
    put(parts, bp, box(0.06, 0.13, 0.46), shoeKind === 3 ? p.col : accent, an, sd * 0.2, 0.02, 0.12);
    put(parts, bp, box(0.22, 0.16, 0.07), accent, an, 0, 0.08, -0.27);
    for (let li = 0; li < 3; li++) put(parts, bp, box(0.2, 0.025, 0.035), "#f8f8f8", an, 0, 0.14 - li * 0.012, 0.26 + li * 0.09);
  }
  // torso: pelvis below the waist, chest above, blended through the middle so twists and breathing bend smoothly
  put(parts, bp, torso, p.col, I.bd, 0, 0.3, 0, 0.62 * k, 1, 0.42 * k, { to: I.ch, axis: "y", from: 1.25, len: 0.6, end: "start", max: 1 });
  // jersey fabric: the knit texture, and the hem (below the waistband) sways on a spring-lagged bone
  parts[parts.length - 1].mesh = 1;
  parts[parts.length - 1].blend2 = { to: I.hem, axis: "y", from: 0.05, len: 0.35, end: "end", max: 0.7 };
  putT(ring(0.3, 0.05), trim, I.ch, 0, 1.9, 0.03, 1, 1, 0.9); // collar trim
  // jersey side panels (pelvis -> chest, blended like the torso) and the shorts' waistband
  for (const sd of [-1, 1])
    put(parts, bp, box(0.05, 1.55, 0.3 * k), trim, I.bd, sd * 0.6 * k, 0.75, 0, 1, 1, 1, { to: I.ch, axis: "y", from: 1.25, len: 0.6, end: "start", max: 1 });
  put(parts, bp, new THREE.TorusGeometry(0.56 * k, 0.06, 6, 28).rotateX(Math.PI / 2), trim, I.bd, 0, -0.12, 0, 1, 1, 0.72);
  for (const sd of [-1, 1]) putT(new THREE.TorusGeometry(0.29 * k, 0.045, 6, 20).rotateY(Math.PI / 2), trim, I.ch, sd * 0.86 * k * 0.95, 1.78, 0); // armholes
  putT(limb([[0.0, 0.0], [0.16, -0.02], [0.15, 0.35], [0.0, 0.38]]), sk, I.nk, 0, 2.02, 0); // neck
  // head: skull, jaw, ears, face (on the head bone: it looks around)
  const H = I.hd;
  // Every player gets his own face from his name (deterministic, same online): skull width, jaw, nose, brows, eyes,
  // ears and lips vary, so nobody is a clone. Stylised - no real photos or likenesses are used.
  let fh = h ^ 0x9e3779b9;
  const fr = () => ((fh = Math.imul(fh ^ (fh >>> 15), 2246822507) >>> 0) % 1000) / 1000,
    F = {
      w: 0.92 + fr() * 0.16, // skull width
      jw: 0.9 + fr() * 0.25, // jaw width
      jl: 0.9 + fr() * 0.25, // jaw length
      nw: 0.85 + fr() * 0.45, // nose width
      nl: 0.85 + fr() * 0.35, // nose length
      eg: 0.12 + fr() * 0.03, // eye spacing
      br: 0.03 + fr() * 0.03, // brow thickness
      ba: (fr() - 0.5) * 0.25, // brow angle
      ea: 0.85 + fr() * 0.35, // ear size
      lp: 0.8 + fr() * 0.5, // lip fullness
      ...((p.sg && p.sg.face) || {}),
    };
  putT(sph, sk, H, 0, 2.74, 0.0, 0.36 * F.w, 0.43, 0.39);
  putT(sph, sk, H, 0, 2.55 - (F.jl - 1) * 0.05, 0.08, 0.27 * F.jw, 0.22 * F.jl, 0.3); // jaw
  for (const sd of [-1, 1]) {
    putT(sph, sk, H, sd * 0.36 * F.w, 2.72, 0, 0.07 * F.ea, 0.11 * F.ea, 0.07); // ear
    putT(sph, "#f8f8f8", H, sd * F.eg, 2.8, 0.33, 0.065, 0.05, 0.03); // eye white
    putT(sph, "#1a1410", H, sd * F.eg, 2.8, 0.355, 0.035, 0.035, 0.02); // iris
    const bw = box(0.15, F.br, 0.05).rotateZ(-sd * F.ba);
    putT(bw, hc, H, sd * F.eg, 2.9, 0.34); // brow
  }
  putT(sph, shade(sk, 0.9), H, 0, 2.7, 0.38, 0.06 * F.nw, 0.09 * F.nl, 0.07); // nose
  putT(box(0.15, 0.03, 0.03), shade(sk, 0.55), H, 0, 2.565, 0.365); // mouth
  putT(box(0.13, 0.025 * F.lp, 0.03), shade(sk, 0.75), H, 0, 2.54, 0.36); // lower lip
  for (const sd of [-1, 1]) {
    putT(box(0.13, 0.025, 0.03), shade(sk, 0.78), H, sd * F.eg, 2.835, 0.335); // upper eyelid
    putT(sph, shade(sk, 1.05), H, sd * 0.2 * F.w, 2.68, 0.27, 0.09, 0.07, 0.07); // cheekbone
  }
  putT(sph, shade(sk, 0.96), H, 0, 2.43 - (F.jl - 1) * 0.06, 0.2, 0.13 * F.jw, 0.09, 0.12); // chin
  // hair: the cap sits high and back so the hairline frames the forehead (never over the eyes)
  const sub = (p.sg && p.sg.hs) ?? (h >> 3) % 3;
  if (p.hr === 1) {
    putT(sph, hc, H, 0, 2.95, -0.08, 0.385 * F.w, 0.3, 0.415);
    if (sub === 0) putT(sph, shade(hc, 1.35), H, 0, 2.78, -0.1, 0.37 * F.w, 0.17, 0.37); // faded sides
    if (sub === 1) for (let w = 0; w < 3; w++) putT(ring(0.2 + w * 0.06, 0.012), shade(hc, 1.6), H, 0, 3.2 - w * 0.03, -0.06 + w * 0.01); // waves
    if (sub === 2) putT(box(0.02, 0.03, 0.3), shade(sk, 0.85), H, 0.14, 3.22, 0.0); // part line
  }
  if (p.hr === 2) {
    // medium hair swept back (volume on top and behind); sub-style 1 = locks
    putT(sph, hc, H, 0, 2.98, -0.08, 0.41 * F.w, 0.34, 0.44);
    putT(sph, hc, H, 0, 2.82, -0.2, 0.4 * F.w, 0.32, 0.3); // back volume
    putT(box(0.5, 0.08, 0.1), hc, H, 0, 3.08, 0.22); // swept fringe line
    if (p.sg && p.sg.hs === 1)
      for (let d = 0; d < 9; d++) {
        const a = Math.PI * (0.25 + (d / 8) * 1.5);
        putT(new THREE.CylinderGeometry(0.05, 0.035, 0.85, 6), hc, H, Math.cos(a) * 0.36, 2.5, -Math.abs(Math.sin(a)) * 0.34 - 0.04);
      }
  }
  if (p.hr === 3) {
    putT(sph, hc, H, 0, 3.02, -0.06, 0.52 * F.w, 0.48, 0.52);
    putT(sph, shade(hc, 1.15), H, 0, 3.16, -0.04, 0.42, 0.3, 0.42); // texture on the crown
  }
  if (p.bd) {
    // jawline beard: follows the jaw and chin, mouth stays visible
    putT(sph, hc, H, 0, 2.46 - (F.jl - 1) * 0.05, 0.16, 0.29 * F.jw, 0.15 * F.jl, 0.2);
    for (const sd of [-1, 1]) putT(sph, hc, H, sd * 0.25 * F.jw, 2.6, 0.14, 0.07, 0.14, 0.14); // sideburn to jaw
    putT(box(0.22, 0.045, 0.05), hc, H, 0, 2.61, 0.37); // mustache
  }
  if (headband) putT(ring(0.375, 0.05), accent, H, 0, 2.94, 0, 1, 1, 1.05);
  for (const [s2, e, w, sd, fg] of [
    [I.sL, I.eL, I.wL, -1, I.gL],
    [I.sR, I.eR, I.wR, 1, I.gR],
  ]) {
    put(parts, bp, sph, sk, s2, 0, -0.02, 0, 0.25 * k, 0.27, 0.25 * k); // deltoid
    put(parts, bp, limb([[0.0, 0.0], [0.16 * k, -0.05], [0.17 * k, -0.4], [0.13 * k, -0.85], [0.12 * k, -1.04], [0.0, -1.08]]), sleeve && sd < 0 ? sleeve : sk, s2, 0, 0, 0, 1, 1, 1, { to: e, axis: "y", from: -1.02, len: 0.35, end: "end" });
    put(parts, bp, limb([[0.0, 0.04], [0.13 * k, 0.0], [0.14 * k, -0.3], [0.1 * k, -0.9], [0.0, -0.98]]), sleeve && sd < 0 ? sleeve : sk, e, 0, 0, 0, 1, 1, 1, { to: s2, axis: "y", from: 0, len: 0.3, end: "start" });
    put(parts, bp, box(0.18, 0.2, 0.1), sk, w, 0, -0.12, 0.02); // palm
    put(parts, bp, box(0.17, 0.16, 0.07), shade(sk, 0.94), fg, 0, -0.08, 0.035); // fingers (curl: open hand .. ball grip .. fist)
    put(parts, bp, box(0.06, 0.14, 0.06), sk, w, -sd * 0.1, -0.12, 0.07); // thumb
  }
  // ---- skin attributes + merge (vertex colors, smooth joint weights) ----
  const c = new THREE.Color();
  const geos = parts.map((pt) => {
    const g = pt.g,
      n = g.attributes.position.count,
      col = new Float32Array(n * 3),
      si = new Uint16Array(n * 4),
      sw = new Float32Array(n * 4);
    // Color.set already linearizes the hex; the extra sRGB->linear step deepens the palette (richer skin and jersey
    // tones under the bright arena rig) - the game's look since v2, kept on purpose across the three.js upgrade.
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
        w2 = (b.max ?? 0.5) * u * u * (3 - 2 * u);
      }
      let w3 = 0;
      if (pt.blend2) {
        const ly = pos.getY(i) - bp[pt.bone].y,
          b = pt.blend2,
          u = Math.min(1, Math.max(0, (b.from + b.len - ly) / b.len));
        w3 = (b.max ?? 0.5) * u * u * (3 - 2 * u) * (1 - w2);
      }
      si.set([pt.bone, pt.blend ? pt.blend.to : 0, pt.blend2 ? pt.blend2.to : 0, 0], i * 4);
      sw.set([1 - w2 - w3, w2, w3, 0], i * 4);
    }
    // uv: jersey fabric tiles the knit (around x40, along x26); everything else samples the flat texel
    const uvA = new Float32Array(n * 2),
      ouv = g.attributes.uv as THREE.BufferAttribute | undefined;
    if (pt.mesh && ouv) for (let i = 0; i < n; i++) uvA.set([ouv.getX(i) * 40, ouv.getY(i) * 26], i * 2);
    g.setAttribute("uv", new THREE.BufferAttribute(uvA, 2));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setAttribute("skinIndex", new THREE.BufferAttribute(si, 4));
    g.setAttribute("skinWeight", new THREE.BufferAttribute(sw, 4));
    for (const k2 of Object.keys(g.attributes)) if (!["position", "normal", "color", "skinIndex", "skinWeight", "uv"].includes(k2)) g.deleteAttribute(k2);
    return g;
  });
  const geo = mergeGeometries(geos)!;
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
  G.scale.setScalar(p.ht / 6.4);
  const pl = () => ({ on: false, x: 0, y: 0, z: 0, w: 0 });
  const cs = () => ({ x: 0, vx: 0, z: 0, vz: 0 });
  const rig: Rig = { G, mesh, bd, tl, tr, kl, kr, sL, sR, eL, eR, wL, wR, ch, nk, hd, al, ar, gL, gR, tf: [tfL, tfR], hem, hs: { x: 0, vx: 0, z: 0, vz: 0, px: 0, pz: 0 }, fl: [flL, flR], cloth: [cs(), cs()], plant: [pl(), pl()], extra };
  if (typeof document === "undefined") return rig; // Node (FK parity test): bones + mesh only
  const cy = -RIG.chest; // chest-local offsets for the jersey prints
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
  nb.position.set(0, 1.35 + cy, -0.47 * k);
  nb.rotation.y = Math.PI;
  ch.add(nb);
  // team wordmark across the chest
  const [wc, wx] = cv(256, 64);
  wx.fillStyle = "#fff";
  wx.font = "italic 900 44px system-ui";
  wx.textAlign = "center";
  wx.fillText(String((cl && cl[p.tm]) || "").toUpperCase().slice(0, 10), 128, 48);
  const wm = new THREE.MeshBasicMaterial({ map: tex(wc), transparent: true });
  extra.push(wm);
  const wp = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.24), wm);
  wp.position.set(0, 1.72 + cy, 0.465 * k);
  ch.add(wp);
  const nf = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.45), nm);
  nf.position.set(0, 1.4 + cy, 0.47 * k);
  ch.add(nf);
  const [n3c, n3] = cv(256, 64);
  n3.fillStyle = "#fff";
  n3.font = "800 40px system-ui";
  n3.textAlign = "center";
  n3.fillText(p.n.split(" ").pop().toUpperCase().slice(0, 11), 128, 46);
  const n3m = new THREE.MeshBasicMaterial({ map: tex(n3c), transparent: true });
  extra.push(n3m);
  const np3 = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.35), n3m);
  np3.position.set(0, 1.88 + cy, -0.46 * k);
  np3.rotation.y = Math.PI;
  ch.add(np3);
  return rig;
}

/** Joint angles (sim p.q) -> bone rotations. Same mapping as the original rig, so hand FK stays exact. */
export function applyPose(m: Rig, p: any) {
  const q = p.q;
  if (!q) return;
  const w = W3(p.x, p.y, p.z);
  m.G.position.set(w[0], w[1] - q.cr * 0.4, w[2]);
  m.G.rotation.y = Math.PI / 2 - p.f;
  m.tl.rotation.set(-q.tL, 0, hipAb(q, -1));
  m.tr.rotation.set(-q.tR, 0, hipAb(q, 1));
  m.kl.rotation.x = q.kL;
  m.kr.rotation.x = q.kR;
  m.al.rotation.x = q.fL || 0;
  m.ar.rotation.x = q.fR || 0;
  // toes stay on the floor while the heel rises (toe-off), flat otherwise
  m.tf[0].rotation.x = -Math.max(0, (q.fL || 0) - 0.15) * 0.8;
  m.tf[1].rotation.x = -Math.max(0, (q.fR || 0) - 0.15) * 0.8;
  m.ch.rotation.set(q.cx || 0, q.cy || 0, 0, "YXZ");
  m.nk.rotation.x = q.nk || 0;
  m.hd.rotation.set(q.hp || 0, q.hy || 0, 0, "YXZ");
  m.gL.rotation.x = -(q.gL ?? 0.25) * 1.4;
  m.gR.rotation.x = -(q.gR ?? 0.25) * 1.4;
  m.sL.rotation.set(-q.aL, 0, -(q.zL == null ? q.sz : q.zL));
  m.sR.rotation.set(-q.aR, 0, q.sz);
  m.eL.rotation.x = -q.eL;
  m.eR.rotation.x = -q.eR;
  m.wL.rotation.set(-(q.wL || 0), q.oL || 0, 0, "YXZ"); // forearm twist then wrist flex (matches pose.ts FK)
  m.wR.rotation.set(-(q.wR || 0), q.oR || 0, 0, "YXZ");
  m.bd.rotation.set(q.ln, q.ty, q.rz, "YXZ");
}

/** Cloth: each shorts-hem flap bone chases its thigh's rotation through an underdamped spring, so the hem trails the
 *  leg swing, overshoots when the leg stops, and lifts while falling from a jump. Purely visual (client side). */
export function clothStep(m: Rig, p: any, dt: number) {
  const h = Math.min(dt, 1 / 30);
  for (let s = 0; s < 2; s++) {
    const th = s ? m.tr : m.tl,
      c = m.cloth[s],
      tx = th.rotation.x + (p.z > 2 ? Math.max(-0.25, Math.min(0.25, -(p.vz || 0) * 0.0012)) : 0),
      tz = th.rotation.z;
    for (let it = 0; it < 2; it++) {
      c.vx += ((tx - c.x) * 220 - c.vx * 13) * (h / 2);
      c.vz += ((tz - c.z) * 220 - c.vz * 13) * (h / 2);
      c.x += c.vx * (h / 2);
      c.z += c.vz * (h / 2);
    }
    if (Math.abs(c.x - tx) > 1.2) (c.x = tx), (c.vx = 0); // teleports (inbounds, replays)
    m.fl[s].rotation.set(c.x, 0, c.z);
  }
  // jersey hem: lags the pelvis (spring driven by the pelvis' own rotation changes) and lifts while falling
  const hs = m.hs,
    bx = m.bd.rotation.x,
    bz = m.bd.rotation.z;
  hs.vx += (-(bx - hs.px) / h) * 0.35 + ((p.z > 2 ? Math.max(-0.3, Math.min(0.3, -(p.vz || 0) * 0.002)) : 0) - hs.x) * 180 * h - hs.vx * 11 * h;
  hs.vz += (-(bz - hs.pz) / h) * 0.35 + -hs.z * 180 * h - hs.vz * 11 * h;
  hs.px = bx;
  hs.pz = bz;
  hs.x = Math.max(-0.5, Math.min(0.5, hs.x + hs.vx * h));
  hs.z = Math.max(-0.5, Math.min(0.5, hs.z + hs.vz * h));
  m.hem.rotation.set(hs.x, 0, hs.z);
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
    // planted foot stays flat on the floor whatever the IK did to hip and knee
    const an = s ? m.ar : m.al,
      flat = -(th.rotation.x + kn.rotation.x);
    an.rotation.x += (flat - an.rotation.x) * w;
    th.updateMatrixWorld(true);
  }
}

function isDark(hex: string) {
  const c = new THREE.Color(hex);
  return c.r * 0.3 + c.g * 0.59 + c.b * 0.11 < 0.45;
}
function shade(hex: string, k: number) {
  const c = new THREE.Color(hex).multiplyScalar(k);
  return "#" + c.getHexString();
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
