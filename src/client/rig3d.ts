// Skinned player rig: one SkinnedMesh per player (one draw call) on a bone hierarchy that mirrors the
// sim's joint model exactly (so pose.ts handPos stays the true release point). The body is lofted from anatomical
// cross-sections (egg-shaped rings: front/back asymmetry for pecs, lats, biceps/triceps, quads/hamstrings, calves),
// each limb ONE continuous surface skinned across its joint (no separate tubes meeting at the knee/elbow), uniforms
// and accessories are painted per face (crisp neckline/armhole piping, stripes, sleeves, tape, socks), and every
// part carries a material class (skin / knit / cloth / leather / rubber / hair / gloss) read through one shared
// data texture (R = jersey-knit bump, G = roughness), so a player is still one draw call (+1 for the jersey prints).
// Unity mirrors this builder in unity/Assets/Scripts/Game/Rig.cs.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { W3, cl } from "../core/sim";
import { RIG, hipAb, fv } from "../core/pose";
import { lookOf, faceOf, lum } from "./look";

const L1 = RIG.L1, // thigh (hip -> knee pivot)
  L2 = RIG.L2; // shin (knee -> ankle)

/** Two-bone weight ramp: weight to `to` eases in over `len` ending at `from` (end) / starting there (start). */
type Blend = { to: number; axis?: "y" | "z"; from: number; len: number; end: "start" | "end"; max?: number };
/** cf: per-face colour key from the face centroid (part-local coords, v = loft level fraction); null drops the face. */
type CF = (x: number, y: number, z: number, v: number) => string | null;
type Part = { g: THREE.BufferGeometry; key: string; bone: number; blend?: Blend; blend2?: Blend; cf?: CF; print?: boolean };
/** cf on a part tagged with VTX paints per vertex (soft hairlines / beard edges) and never drops faces. */
const VTX = new WeakSet<CF>();

export interface Rig {
  G: THREE.Group;
  mesh: THREE.SkinnedMesh;
  pmesh: THREE.SkinnedMesh | null; // jersey prints (number, wordmark, name): own atlas, same skeleton
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
  tris: number;
  // face bones (children of the head): jaw, mouth interior/line/corners, brows, lids, irises; fr = their rest positions
  fb: { jw: THREE.Bone; mi: THREE.Bone; mo: THREE.Bone; c: THREE.Bone[]; b: THREE.Bone[]; l: THREE.Bone[]; y: THREE.Bone[]; fr: THREE.Vector3[] };
}

// ---------------------------------------------------------------- material classes + the shared data texture
/** Material classes: 0 cloth, 1 jersey knit (tiled), 2 skin, 3 hair, 4 leather (shoes), 5 gloss (eyes, teeth), 6 rubber,
 *  7 lips (skin and hair are neighbours: a per-vertex skin/hair blend only crosses those two swatches) */
const ROUGH = "0.82 0.8 0.52 0.86 0.4 0.16 0.9 0.4";
const TXN = 128;
/** R = bump (knit holes, flat elsewhere), G = roughness. Knit holes repeat every 32 px; rows 1..8 hold no holes, so
 *  the per-class swatches live there (16 px wide each) and a constant-UV part samples one flat swatch texel. */
function dataTex() {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = TXN;
  const x = c.getContext("2d")!,
    im = x.createImageData(TXN, TXN),
    d = im.data,
    rg = ROUGH.split(" ").map(Number);
  for (let j = 0; j < TXN; j++)
    for (let i = 0; i < TXN; i++) {
      let hv = 1;
      for (let b = 0; b < 4; b++)
        for (let a = 0; a < 5; a++) {
          const cx = 16 + a * 32 - (b % 2) * 16,
            cy = 16 + b * 32,
            dx = (i + 0.5 - cx) / 6.4,
            dy = (j + 0.5 - cy) / 5.2,
            dd = Math.sqrt(dx * dx + dy * dy);
          hv = Math.min(hv, 0.42 + 0.58 * Math.min(1, Math.max(0, (dd - 0.8) / 0.4)));
        }
      const k = (j * TXN + i) * 4,
        sw = j >= 1 && j <= 8 ? Math.min(7, i >> 4) : -1;
      d[k] = sw >= 0 ? 255 : Math.round(hv * 255);
      d[k + 1] = Math.round((sw >= 0 ? rg[sw] : 0.78 + (1 - hv) * 0.15) * 255);
      d[k + 2] = 0;
      d[k + 3] = 255;
    }
  x.putImageData(im, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}
const MAT = new Map<string, THREE.MeshStandardMaterial>();
function bodyMat() {
  let m = MAT.get("body");
  if (!m) {
    const t = dataTex();
    m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, roughnessMap: t, bumpMap: t, bumpScale: t ? 0.55 : 0, envMapIntensity: 0.85 });
    MAT.set("body", m);
  }
  return m;
}
const swU = (m: number) => (m * 16 + 8) / TXN,
  swV = 1 - 5 / TXN;

// ---------------------------------------------------------------- geometry primitives (shared caches)
const V1 = new THREE.Vector3(),
  V2 = new THREE.Vector3(),
  INV = new THREE.Matrix4();
/** Average the normals of coincident vertices (seams, poles), so lofts and warped boxes shade without creases. */
function weld(g: THREE.BufferGeometry) {
  g.computeVertexNormals();
  const p = g.attributes.position as THREE.BufferAttribute,
    n = g.attributes.normal as THREE.BufferAttribute,
    m = new Map<string, number[]>();
  for (let i = 0; i < p.count; i++) {
    const k = Math.round(p.getX(i) * 1e4) + "," + Math.round(p.getY(i) * 1e4) + "," + Math.round(p.getZ(i) * 1e4);
    let a = m.get(k);
    if (!a) m.set(k, (a = []));
    a.push(i);
  }
  for (const a of m.values()) {
    if (a.length < 2) continue;
    V1.set(0, 0, 0);
    for (const i of a) V1.x += n.getX(i), V1.y += n.getY(i), V1.z += n.getZ(i);
    V1.normalize();
    for (const i of a) n.setXYZ(i, V1.x, V1.y, V1.z);
  }
  return g;
}
/** Loft along +y through levels [y, rx, zf, zb, zc] (flat array): each ring is an egg - half-width rx, front (+z)
 *  depth zf, back depth zb, centred at z = zc; e < 1 squares the section (superellipse). rx = 0 makes a pole. */
function loft(L: number[], seg: number, e = 1) {
  const n = L.length / 5,
    pos: number[] = [],
    uv: number[] = [],
    idx: number[] = [];
  const pw = (t: number) => Math.sign(t) * Math.pow(Math.abs(t), e);
  for (let j = 0; j < n; j++)
    for (let i = 0; i <= seg; i++) {
      const th = (i / seg) * Math.PI * 2,
        s = pw(Math.sin(th)),
        c = pw(Math.cos(th)),
        o = j * 5;
      pos.push(L[o + 1] * s, L[o], L[o + 4] + (c > 0 ? L[o + 2] : L[o + 3]) * c);
      uv.push(i / seg, j / (n - 1));
    }
  const W = seg + 1;
  let up = true;
  for (let j = 0; j < n - 1; j++)
    if (L[(j + 1) * 5] !== L[j * 5]) {
      up = L[(j + 1) * 5] > L[j * 5];
      break;
    }
  for (let j = 0; j < n - 1; j++)
    for (let i = 0; i < seg; i++) {
      const a = j * W + i,
        b = a + 1,
        c = a + W,
        d = c + 1;
      // the first step's direction sets the winding for the whole surface (a profile that folds back inside - shorts
      // lining, shoe collar - keeps a continuous orientation, so the lining faces inward)
      if (up) idx.push(a, b, d, a, d, c);
      else idx.push(a, d, b, a, c, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.userData.quad = 1; // triangles come in quad pairs: painting decides per quad (clean stepped edges, no sawtooth)
  return weld(g);
}
/** Insert n-1 linearly interpolated levels between neighbours (finer rings for crisp painted edges). */
function refine(L: number[], n: number, from = -1e9) {
  const o: number[] = [];
  for (let j = 0; j < L.length / 5 - 1; j++)
    for (let s = 0; s < (L[j * 5 + 5] > from ? n : 1); s++) for (let k = 0; k < 5; k++) o.push(L[j * 5 + k] + ((L[j * 5 + 5 + k] - L[j * 5 + k]) * s) / n);
  for (let k = 0; k < 5; k++) o.push(L[L.length - 5 + k]);
  return o;
}
/** Scale a level table about a centre (shells: hair, beards, linings). */
function shell(L: number[], s: number, cy: number, sy = s) {
  const o = L.slice();
  for (let j = 0; j < o.length; j += 5) (o[j] = cy + (o[j] - cy) * sy), (o[j + 1] *= s), (o[j + 2] *= s), (o[j + 3] *= s);
  return o;
}
/** Linear lookup of a level table at height y: [rx, zf, zb, zc]. */
function levelAt(L: number[], y: number, out: number[]) {
  const n = L.length / 5;
  for (let j = 0; j < n - 1; j++) {
    const y0 = L[j * 5],
      y1 = L[j * 5 + 5];
    if ((y >= y0 && y <= y1) || (y <= y0 && y >= y1) || j === n - 2) {
      const u = y1 === y0 ? 0 : Math.min(1, Math.max(0, (y - y0) / (y1 - y0)));
      for (let k = 0; k < 4; k++) out[k] = L[j * 5 + 1 + k] + (L[j * 5 + 6 + k] - L[j * 5 + 1 + k]) * u;
      return out;
    }
  }
  return out;
}
const SPH = new Map<number, THREE.BufferGeometry>();
function sphere(ws: number, hs: number) {
  let g = SPH.get(ws * 100 + hs);
  if (!g) SPH.set(ws * 100 + hs, (g = new THREE.SphereGeometry(1, ws, hs)));
  return g;
}
/** Per-vertex warp (bend, taper, bumps), then smooth normals. */
function warp(g: THREE.BufferGeometry, f: (v: THREE.Vector3) => void) {
  g = g.clone();
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    V2.set(p.getX(i), p.getY(i), p.getZ(i));
    f(V2);
    p.setXYZ(i, V2.x, V2.y, V2.z);
  }
  return weld(g);
}
/** Smooth value noise (sum of sines): skin tone variation, hair bumps. */
const sn = (x: number, y: number, z: number) => Math.sin(x * 7.1 + y * 3.3) * Math.sin(y * 5.7 - z * 6.1 + 1.3) * Math.sin(z * 4.3 + x * 2.9 + 0.7);

function mixHex(a: string, b: string, t: number) {
  const c = new THREE.Color(a).lerp(new THREE.Color(b), t);
  return "#" + c.getHexString();
}

/** Build a part in its bone's local frame, then move it to bind-pose model space (faces painted / dropped by cf). */
function put(parts: Part[], bonePos: THREE.Vector3[], g: THREE.BufferGeometry, key: string, bone: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, blend?: Blend, blend2?: Blend, cf?: CF) {
  const quad = !!g.userData.quad;
  g = g.clone();
  g.scale(sx, sy, sz);
  if (g.index) g = g.toNonIndexed();
  let keys: string[] | null = null;
  if (cf && VTX.has(cf)) {
    const p = g.attributes.position as THREE.BufferAttribute,
      uv = g.attributes.uv as THREE.BufferAttribute | undefined;
    keys = [];
    for (let i = 0; i < p.count; i++) keys.push(cf(p.getX(i), p.getY(i), p.getZ(i), uv ? uv.getY(i) : 0) ?? key);
  } else if (cf) {
    // paint per face at its centroid (part-local, before placement); a null key drops the face
    const p = g.attributes.position as THREE.BufferAttribute,
      uv = g.attributes.uv as THREE.BufferAttribute | undefined,
      keep: number[] = [];
    keys = [];
    let kk: string | null = null;
    for (let f = 0; f < p.count / 3; f++) {
      if (!quad || f % 2 === 0) {
        let cx = 0,
          cy = 0,
          cz = 0,
          cv = 0;
        const nv = quad ? 6 : 3;
        for (let k = 0; k < nv; k++) (cx += p.getX(f * 3 + k)), (cy += p.getY(f * 3 + k)), (cz += p.getZ(f * 3 + k)), (cv += uv ? uv.getY(f * 3 + k) : 0);
        kk = cf(cx / nv, cy / nv, cz / nv, cv / nv);
      }
      if (kk === null) continue;
      keep.push(f);
      keys.push(kk);
    }
    if (keep.length * 3 < p.count) {
      const o = new THREE.BufferGeometry();
      for (const name of Object.keys(g.attributes)) {
        const a = g.attributes[name] as THREE.BufferAttribute,
          is = a.itemSize,
          arr = new Float32Array(keep.length * 3 * is);
        keep.forEach((f, n) => arr.set((a.array as Float32Array).subarray(f * 3 * is, f * 3 * is + 3 * is), n * 3 * is));
        o.setAttribute(name, new THREE.BufferAttribute(arr, is));
      }
      g = o;
    }
    if (!keep.length) return;
  }
  g.translate(x + bonePos[bone].x, y + bonePos[bone].y, z + bonePos[bone].z);
  const pt: Part = { g, key, bone, blend, blend2 };
  (pt as any).keys = keys;
  parts.push(pt);
}

/** Colour table of one player: key -> [hex, material class]. */
type Pal = Record<string, [string, number]>;

export function makeRig(p: any, tex: (c: HTMLCanvasElement) => THREE.Texture, lod = 1): Rig {
  const k = p.bk,
    sk = p.skin,
    LK = lookOf(p),
    F = faceOf(LK.h, p.sg),
    hi = lod > 0;
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
  // face bones, placed in the same pelvis-relative frame the head parts use (head offsets are pure translations)
  const HB = RIG.chest + RIG.neck + RIG.head,
    FB = (x: number, y: number, z: number) => B(x, y - HB, z),
    jw = FB(0, 2.64, 0.02), // jaw hinge (in front of the ears)
    mi = FB(0, 2.556, 0.31), // mouth interior: scaled open with the jaw
    mo = FB(0, 2.565, 0.365), // mouth line (width)
    cL = FB(-0.08, 2.562, 0.36), // mouth corners (smile / frown)
    cR = FB(0.08, 2.562, 0.36);
  const F0 = 0.12; // rough eye spacing for the bone pivots (parts use the per-face spacing)
  const brL = FB(-F0 - 0.01, 2.9, 0.34),
    brR = FB(F0 + 0.01, 2.9, 0.34),
    lL = FB(-F0 - 0.01, 2.852, 0.33), // closing lids hang from the top of the eye
    lR = FB(F0 + 0.01, 2.852, 0.33),
    yL = FB(-F0 - 0.01, 2.8, 0.355),
    yR = FB(F0 + 0.01, 2.8, 0.355);
  hd.add(jw, mi, mo, cL, cR, brL, brR, lL, lR, yL, yR);
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
  const names = ["hips", "bd", "tl", "tr", "kl", "kr", "sL", "sR", "eL", "eR", "wL", "wR", "ch", "nk", "hd", "al", "ar", "gL", "gR", "flL", "flR", "tfL", "tfR", "hem", "jw", "mi", "mo", "cL", "cR", "brL", "brR", "lL", "lR", "yL", "yR"],
    bones = [hips, bd, tl, tr, kl, kr, sL, sR, eL, eR, wL, wR, ch, nk, hd, al, ar, gL, gR, flL, flR, tfL, tfR, hem, jw, mi, mo, cL, cR, brL, brR, lL, lR, yL, yR];
  const I = Object.fromEntries(names.map((n, i) => [n, i])) as Record<string, number>;
  hips.updateMatrixWorld(true);
  const bp = bones.map((b) => new THREE.Vector3().setFromMatrixPosition(b.matrixWorld));
  const parts: Part[] = [];
  // place a part by its position relative to the PELVIS bone (the old single-torso frame), skinned to `bone`
  const by = (bone: number) => bp[bone].y - bp[I.bd].y;
  const putT = (g: THREE.BufferGeometry, key: string, bone: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, b1?: Blend, b2?: Blend, cf?: CF) =>
    put(parts, bp, g, key, bone, x - bp[bone].x, y - by(bone), z - bp[bone].z, sx, sy, sz, b1, b2, cf);
  const P = (g: THREE.BufferGeometry, key: string, bone: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, b1?: Blend, b2?: Blend, cf?: CF) =>
    put(parts, bp, g, key, bone, x, y, z, sx, sy, sz, b1, b2, cf);
  const bl = (to: number, from: number, len: number, end: "start" | "end", max = 0.5, axis: "y" | "z" = "y"): Blend => ({ to, from, len, end, max, axis });
  // detail: Low tier gets about half the rings
  const S3 = hi ? sphere(28, 20) : sphere(16, 12), // skull-sized
    S2 = hi ? sphere(14, 10) : sphere(10, 7), // eyes, deltoids, nose
    S1 = hi ? sphere(9, 6) : sphere(7, 5), // tiny features
    SG = (n: number) => (hi ? n : Math.max(6, Math.round(n * 0.6))),
    RF = (L: number[], n: number) => (hi ? refine(L, n) : L),
    box = (w: number, h: number, d: number, s = 2) => roundBox(w, h, d, s);

  // ---- colours (key -> hex, material class) ----
  const warm = mixHex(sk, "#b4473a", 0.16),
    lip = mixHex(shade(sk, 0.78), "#7a3530", 0.25),
    hcol = LK.hc,
    sec = LK.sec,
    C: Pal = {
      skin: [sk, 2],
      warm: [warm, 2],
      dark: [shade(sk, 0.8), 2],
      crease: [shade(sk, 0.6), 2],
      lip: [lip, 7],
      lipD: [shade(lip, 0.55), 7],
      jer: [p.col, 1],
      sht: [p.col, 0],
      shtD: [shade(p.col, 0.5), 0],
      sec: [sec, 0],
      secK: [sec, 1],
      hair: [hcol, 3],
      h1: [mixHex(hcol, sk, 0.3), 3],
      h2: [mixHex(hcol, sk, 0.55), 3],
      h3: [mixHex(hcol, sk, 0.78), 2],
      hw: [shade(hcol, 1.9), 3],
      stub: [mixHex(sk, hcol, 0.42), 2],
      white: [mixHex("#f4f1ea", sk, 0.08), 5],
      iris: [LK.eye, 5],
      pupil: ["#060606", 5],
      glint: ["#ffffff", 5],
      teeth: ["#efeadf", 5],
      mouth: ["#3a1416", 7],
      lash: [mixHex("#141010", hcol, 0.3), 3],
      sleeve: [LK.sleeveC, 0],
      wrist: [LK.wristC, 0],
      knee: [LK.kneeC, 0],
      tights: [LK.tightsC, 0],
      sock: [LK.sock, 0],
      band: [LK.bandC, 0],
      tape: ["#f2f0ea", 0],
      su: [LK.shoe[0], 4],
      sa: [LK.shoe[1], 4],
      sm: [LK.shoe[2], 6],
      so: [LK.shoe[3], 6],
      sl: [LK.shoe[4], 0],
      sin: ["#1e1e22", 0],
    };
  // proportions: build k widens the frame and adds muscle; tall players are leaner for their size (the whole rig is
  // scaled by height, so without this a 7-footer is just a blown-up guard)
  const mu = Math.min(1, Math.max(0, (k - 0.85) / 0.45)),
    lean = 1 - Math.min(0.08, Math.max(-0.04, (p.ht - 6.5) * 0.09)),
    ga = (0.95 + 0.18 * k) * lean, // arm girth
    gl = (0.96 + 0.15 * k) * lean, // leg girth
    kz = 0.86 + 0.14 * k; // chest depth

  // ---------------- torso: pelvis -> chest -> trapezius -> neck base (one surface, painted jersey/skin/piping)
  const TL0 = [
    -0.25, 0, 0, 0, 0,
    -0.22, 0.4, 0.3, 0.32, 0,
    -0.05, 0.53, 0.33, 0.39, -0.02,
    0.2, 0.545, 0.33, 0.38, -0.02,
    0.45, 0.52, 0.32, 0.33, 0,
    0.7, 0.51, 0.33, 0.31, 0,
    0.95, 0.55, 0.36 + 0.02 * mu, 0.32, 0,
    1.15, 0.61, 0.39 + 0.03 * mu, 0.34, 0,
    1.35, 0.67 + 0.02 * mu, 0.42 + 0.04 * mu, 0.36, 0,
    1.52, 0.71 + 0.03 * mu, 0.42 + 0.03 * mu, 0.37, 0,
    1.66, 0.73 + 0.02 * mu, 0.37, 0.37, 0,
    1.78, 0.7, 0.31, 0.34, 0,
    1.88, 0.58 + 0.03 * mu, 0.25, 0.3, -0.01,
    1.96, 0.38 + 0.03 * mu, 0.2, 0.24, -0.02,
    2.02, 0.2, 0.16, 0.17, -0.01,
    2.06, 0, 0, 0, -0.01,
  ];
  const TL = TL0.slice();
  for (let j = 0; j < TL.length; j += 5) (TL[j + 1] *= k), (TL[j + 2] *= kz), (TL[j + 3] *= kz), (TL[j + 4] *= kz);
  const TLr = hi ? refine(refine(TL, 2), 2, 1.1) : refine(TL, 2, 1.1);
  const tAt: number[] = [0, 0, 0, 0];
  const neckY = (ax: number, z: number) => (z > 0 ? 1.68 + 1.1 * ax : 1.9 + 0.45 * ax);
  const jersey: CF = (x, y, z) => {
    if (y < 0.24) return "sht"; // shorts (below the waistband)
    const ax = Math.abs(x),
      ny = neckY(ax, z);
    if (ax < 0.32 * k && y > ny) return "skin";
    if (ax < 0.34 * k && y > ny - 0.05) return "sec"; // collar piping
    const dx = (ax - 0.82 * k) / (0.37 * k),
      dy = (y - 1.97) / 0.56,
      d = dx * dx + dy * dy;
    if (d < 1) return "skin";
    if (d < 1.2) return "sec"; // armhole piping
    const a = Math.atan2(ax, z);
    if (Math.abs(a - Math.PI / 2) < 0.14 && y < 1.4) return "secK"; // side panel
    return "jer";
  };
  P(loft(TLr, SG(48), 0.86), "jer", I.bd, 0, 0, 0, 1, 1, 1, bl(I.ch, 1.25, 0.6, "start", 1), { to: I.hem, from: 0.05, len: 0.35, end: "end", max: 0.7 }, jersey);
  // waistband
  P(new THREE.TorusGeometry(0.555 * k, 0.05, 6, SG(36)).rotateX(Math.PI / 2), "sec", I.bd, 0, 0.24, -0.015 * kz, 1, 1, 0.7 * kz);
  // neck with the trapezius flowing into it (bottom rides the chest, top the head)
  P(loft([-0.16, 0.21, 0.18, 0.21, 0, -0.06, 0.165, 0.15, 0.17, 0.01, 0.1, 0.145, 0.135, 0.15, 0.02, 0.26, 0.135, 0.125, 0.14, 0.01, 0.38, 0.13, 0.12, 0.135, 0, 0.44, 0, 0, 0, 0], SG(22)), "skin", I.nk, 0, 0, 0, 1.12 + 0.1 * mu, 1, 1.1 + 0.08 * mu, bl(I.ch, -0.16, 0.2, "end", 0.6), bl(I.hd, 0.4, 0.15, "start", 0.5));

  // ---------------- legs: one continuous surface hip -> ankle, skinned across the knee
  const K = -L1,
    A = -L1 - L2,
    LEG = [
      0.1, 0, 0, 0, 0,
      0.07, 0.235, 0.24, 0.25, 0,
      -0.05, 0.27, 0.28, 0.29, 0,
      -0.35, 0.275, 0.29 + 0.01 * mu, 0.27, 0.01,
      -0.65, 0.26, 0.29 + 0.015 * mu, 0.25, 0.02,
      -0.95, 0.235, 0.265 + 0.01 * mu, 0.22, 0.02,
      K + 0.38, 0.205, 0.225, 0.19, 0.015,
      K + 0.2, 0.185, 0.2, 0.175, 0.01,
      K + 0.08, 0.178, 0.205, 0.165, 0.01,
      K, 0.172, 0.19, 0.165, 0.005,
      K - 0.1, 0.168, 0.17, 0.17, 0,
      K - 0.28, 0.178 + 0.01 * mu, 0.15, 0.215 + 0.015 * mu, -0.02,
      K - 0.5, 0.172 + 0.01 * mu, 0.145, 0.205 + 0.01 * mu, -0.02,
      K - 0.75, 0.15, 0.135, 0.16, -0.01,
      K - 1.0, 0.125, 0.12, 0.12, 0,
      K - 1.25, 0.106, 0.11, 0.1, 0,
      A + 0.15, 0.1, 0.1, 0.095, 0,
      A, 0.1, 0.1, 0.1, 0,
      A - 0.05, 0, 0, 0, 0,
    ];
  for (let j = 0; j < LEG.length; j += 5) for (let q = 1; q < 4; q++) LEG[j + q] *= gl;
  const sockTop = A + LK.sockH + 0.12;
  for (const [t, kn, sd, an, tfb, fb] of [
    [I.tl, I.kl, -1, I.al, I.tfL, I.flL],
    [I.tr, I.kr, 1, I.ar, I.tfR, I.flR],
  ]) {
    const side = sd < 0 ? 1 : 2;
    const legC: CF = (x, y) => {
      if (y < sockTop) return "sock";
      if (LK.knee & side && y < K + 0.3 && y > K - 0.38) return "knee";
      if (LK.tights && y > (LK.tights === 2 ? K - 0.45 : K + 0.42)) return "tights";
      return "skin";
    };
    P(loft(RF(LEG, 2), SG(22), 0.95), "skin", t, 0, 0, 0, 1, 1, 1, bl(kn, K - 0.2, 0.4, "end", 1), bl(I.bd, 0.07, 0.3, "start", 0.3), legC);
    // shorts: long and loose with a side stripe, hem band and an inner lining; lower half rides the cloth flap bone
    const sh = [0.16, 0, 0, 0, -0.02, 0.12, 0.33, 0.34, 0.37, -0.02, -0.2, 0.36, 0.36, 0.39, -0.02, -0.5, 0.37, 0.36, 0.38, -0.01, -0.8, 0.385, 0.37, 0.37, 0, -0.9, 0.39, 0.375, 0.375, 0, -0.9, 0.36, 0.35, 0.35, 0, -0.6, 0.3, 0.3, 0.3, 0, -0.5, 0, 0, 0, 0];
    for (let j = 0; j < sh.length; j += 5) for (let q = 1; q < 4; q++) sh[j + q] *= k;
    const shortsC: CF = (x, y, z, v) => {
      if (v > 0.66) return "shtD"; // inner lining
      if (y < -0.8) return "sec"; // hem band
      const a = Math.atan2(x * sd, z);
      if (Math.abs(a - Math.PI / 2) < 0.16) return "sec"; // side stripe
      return "sht";
    };
    P(loft(RF(sh, 2), SG(26)), "sht", t, 0, 0, 0, 1, 1, 1, { to: fb, from: -0.86, len: 0.62, end: "end", max: 0.85 }, undefined, shortsC);
    // sneaker on the ankle bone (forefoot bends with the toe bone): lofted heel -> toe, painted by zone
    const cut = LK.shoeCut,
      SHO = [
        -0.3, 0, 0.02, 0.15, 0,
        -0.28, 0.12, 0.1, 0.2, 0,
        -0.22, 0.165, 0.17 + cut * 0.03, 0.205, 0,
        -0.1, 0.185, 0.18 + cut * 0.04, 0.205, 0,
        0.05, 0.195, 0.14 + cut * 0.02, 0.205, 0,
        0.18, 0.205, 0.1, 0.205, 0,
        0.3, 0.21, 0.065, 0.205, 0,
        0.42, 0.195, 0.03, 0.2, 0,
        0.5, 0.16, 0, 0.19, 0,
        0.55, 0.1, -0.04, 0.17, 0,
        0.57, 0, -0.06, 0.15, 0,
      ];
    // levels as [z, half width, top, bottom] -> loft rings [y, rx, zf(down), zb(up), zc] then rotate y -> z
    const SL: number[] = [];
    for (let j = 0; j < SHO.length; j += 5) {
      const top = SHO[j + 2],
        bot = -SHO[j + 3],
        c = (top + bot) / 2;
      SL.push(SHO[j], SHO[j + 1] * (0.95 + 0.05 * k), c - bot, top - c, -c);
    }
    const topAt = (z: number) => {
      for (let j = 0; j < SHO.length - 5; j += 5) if (z <= SHO[j + 5]) return SHO[j + 2] + ((SHO[j + 7] - SHO[j + 2]) * (z - SHO[j])) / Math.max(1e-6, SHO[j + 5] - SHO[j]);
      return 0;
    };
    const shoeC: CF = (x, y, z) => {
      if (y < -0.172) return "so";
      if (y < -0.122) return "sm";
      const tp = topAt(z);
      if (y > tp - 0.03 && z < -0.04) return "sin"; // collar lining
      if (Math.abs(x) < 0.075 && z > -0.02 && z < 0.36 && y > tp - 0.035) return "sl"; // laces
      if (z > 0.43) return "sa"; // toe cap
      if (z < -0.19) return "sa"; // heel counter
      if (Math.abs(x) > 0.11 && Math.abs(y - (-0.07 + 0.22 * (z - 0.05))) < 0.026 && z > -0.16 && z < 0.36) return "sa"; // side stripe
      return "su";
    };
    P(loft(RF(SL, 2), SG(22), 0.6).rotateX(Math.PI / 2), "su", an, 0, 0, 0.0, 1, 1, 1, bl(tfb, 0.44, 0.16, "start", 1, "z"), undefined, shoeC);
    if (cut === 2) P(loft([-0.02, 0.17, 0.17, 0.18, -0.01, 0.3, 0.165, 0.16, 0.17, -0.01, 0.34, 0.15, 0.145, 0.155, -0.01, 0.3, 0.13, 0.125, 0.14, -0.01, 0.0, 0.12, 0.11, 0.12, -0.01], SG(18)), "su", an, 0, 0, 0, 1, 1, 1, undefined, undefined, (x, y, z, v) => (v > 0.45 ? "sin" : y > 0.27 ? "sa" : "su"));
  }

  // ---------------- arms: deltoid cap + one surface shoulder -> wrist skinned across the elbow, hands with fingers
  const UA = RIG.ua,
    FA = RIG.fa,
    W = -UA - FA,
    ARM = [
      0.12, 0, 0, 0, 0,
      0.06, 0.15, 0.15, 0.15, 0,
      -0.12, 0.165, 0.16, 0.16, 0,
      -0.35, 0.158, 0.175 + 0.02 * mu, 0.155 + 0.01 * mu, 0.01,
      -0.55, 0.152, 0.18 + 0.03 * mu, 0.158 + 0.01 * mu, 0.015,
      -0.75, 0.137, 0.15 + 0.01 * mu, 0.147, 0.005,
      -0.9, 0.122, 0.125, 0.13, 0,
      -UA, 0.12, 0.114, 0.124, -0.005,
      -UA - 0.1, 0.126, 0.12, 0.12, 0,
      -UA - 0.24, 0.138 + 0.01 * mu, 0.127, 0.121, 0.005,
      -UA - 0.44, 0.127, 0.111, 0.106, 0,
      -UA - 0.68, 0.102, 0.082, 0.081, 0,
      W + 0.1, 0.087, 0.062, 0.066, 0,
      W, 0.086, 0.06, 0.065, 0,
      W - 0.05, 0, 0, 0, 0,
    ];
  for (let j = 0; j < ARM.length; j += 5) for (let q = 1; q < 4; q++) ARM[j + q] *= ga;
  for (const [s2, e, w, sd, fg] of [
    [I.sL, I.eL, I.wL, -1, I.gL],
    [I.sR, I.eR, I.wR, 1, I.gR],
  ]) {
    const side = sd < 0 ? 1 : 2,
      slv = LK.sleeve & side;
    const armC: CF = (x, y, z) => {
      if (LK.wrist & side && y < W + 0.2) return "wrist";
      if (slv && y < 0.05 && y > W + 0.06) return "sleeve";
      if (y < -UA + 0.07 && y > -UA - 0.07 && z < -0.05) return "dark"; // elbow point
      return "skin";
    };
    P(sphere(hi ? 14 : 10, hi ? 10 : 8), slv ? "sleeve" : "skin", s2, sd * 0.012, -0.13, 0, 0.19 * ga * (1 + 0.08 * mu), 0.3, 0.21 * ga * (1 + 0.06 * mu), bl(I.ch, 0.08, 0.22, "start", 0.25)); // deltoid
    P(loft(RF(ARM, 2), SG(20)), "skin", s2, 0, 0, 0, 1, 1, 1, bl(e, -UA - 0.12, 0.24, "end", 1), bl(I.ch, 0.06, 0.24, "start", 0.3), armC);
    if (LK.wrist & side) P(loft([W + 0.03, 0.093 * ga, 0.07 * ga, 0.075 * ga, 0, W + 0.2, 0.098 * ga, 0.075 * ga, 0.08 * ga, 0, W + 0.2, 0.08 * ga, 0.06 * ga, 0.06 * ga, 0, W + 0.03, 0.08 * ga, 0.06 * ga, 0.06 * ga, 0], SG(16)), "wrist", e, 0, UA, 0); // wristband (thickness)
    // hand: palm + back of hand, four fingers on the finger bone (curl together), thumb off the wrist
    P(warp(box(0.165, 0.2, 0.075), (v) => (v.z += v.z > 0 ? 0 : -0.012 * (1 - (v.x / 0.09) ** 2))), "skin", w, 0, -0.11, 0.012);
    const fl = [0.148, 0.165, 0.155, 0.125];
    for (let f = 0; f < 4; f++) {
      const L = fl[f],
        r = (0.024 - f * 0.0012) * (0.95 + 0.05 * k),
        fx = -sd * (0.058 - f * 0.039),
        tp = LK.tape && ((sd > 0 && ((f === 0 && LK.tape & 1) || (f === 2 && LK.tape & 2))) || (sd < 0 && f === 0 && LK.tape & 4));
      P(loft([0.04, 0, 0, 0, 0, 0.03, r, r * 0.9, r * 0.95, 0, -L * 0.42, r * 0.96, r * 0.86, r * 0.92, 0, -L * 0.48, r * 1.02, r * 0.9, r * 0.98, 0, -L + r, r * 0.82, r * 0.78, r * 0.8, 0, -L, 0, 0, 0, 0], SG(8)), tp ? "tape" : "skin", fg, fx, 0, 0.014, 1, 1, 1, undefined, undefined, (x2, y2) => (tp ? "tape" : y2 > -0.005 ? "warm" : "skin"));
    }
    P(loft([0.03, 0, 0, 0, 0, 0.02, 0.032, 0.03, 0.03, 0, -0.07, 0.03, 0.027, 0.028, 0, -0.13, 0.024, 0.022, 0.022, 0, -0.155, 0, 0, 0, 0], SG(8)).rotateX(-0.35).rotateZ(-sd * 0.5), "skin", w, -sd * 0.075, -0.07, 0.045);
  }

  // ---------------- head (pelvis-relative levels: skull, jaw on its hinge, features, hair, facial hair)
  const H = I.hd,
    fw = F.w;
  const SK0 = [
    2.32, 0, 0, 0, -0.04,
    2.36, 0.2, 0.16, 0.24, -0.04,
    2.46, 0.26, 0.24, 0.3, -0.04,
    2.58, 0.3, 0.355, 0.34, -0.04,
    2.68, 0.335, 0.37 + 0.01 * F.ck, 0.37, -0.04,
    2.8, 0.35, 0.375, 0.4, -0.04,
    2.92, 0.355, 0.4, 0.41, -0.04,
    3.02 + 0.02 * F.fh, 0.345, 0.37, 0.41, -0.04,
    3.11 + 0.01 * F.fh, 0.3, 0.3, 0.37, -0.04,
    3.18, 0.21, 0.2, 0.27, -0.04,
    3.215, 0.1, 0.09, 0.13, -0.04,
    3.228, 0, 0, 0, -0.04,
  ];
  for (let j = 0; j < SK0.length; j += 5) SK0[j + 1] *= fw;
  const SKL = hi ? refine(SK0, 2) : SK0;
  // jaw (opens on its hinge): wide at the angle, tapering to the chin; F.jl stretches it down, F.jw widens it
  const jy = (y: number) => 2.64 - (2.64 - y) * F.jl,
    JL0 = [2.64, 0.25, 0.2, 0.16, 0.1, 2.57, 0.27, 0.26, 0.2, 0.09, 2.5, 0.25, 0.275, 0.19, 0.09, 2.43, 0.2, 0.26, 0.15, 0.1, 2.375, 0.13, 0.215 * F.ch, 0.1, 0.12, 2.335, 0.065, 0.14 * F.ch, 0.05, 0.15, 2.318, 0, 0, 0, 0.16];
  for (let j = 0; j < JL0.length; j += 5) (JL0[j] = jy(JL0[j])), (JL0[j + 1] *= F.jw);
  const JLr = hi ? refine(JL0, 3) : refine(JL0, 2);
  let jawC: CF | undefined;
  putT(S1, "mouth", I.mi, 0, 2.5, 0.315, 0.072, 0.056, 0.05); // mouth interior (scaled open with the jaw)
  putT(box(0.11, 0.022, 0.02), "teeth", I.mi, 0, 2.548, 0.352); // upper teeth
  putT(box(0.1, 0.02, 0.02), "teeth", I.mi, 0, 2.452, 0.345); // lower teeth
  const es = F.es;
  for (const sd of [-1, 1]) {
    const ex = sd * F.eg;
    // ear: outer shell angled back + darker concha + lobe
    putT(S2, "warm", H, sd * 0.338 * fw, 2.72, -0.03, 0.05, 0.105 * F.ea, 0.078);
    putT(S1, "crease", H, sd * (0.338 * fw + 0.03), 2.72, -0.025, 0.022, 0.06 * F.ea, 0.042);
    putT(S1, "warm", H, sd * (0.338 * fw + 0.005), 2.63 - 0.02 * F.ea, -0.015, 0.035, 0.035, 0.035);
    // eye: white, iris + pupil + glint (look around on the eye bones), lid folds, lash line, lower lid
    putT(S2, "white", H, ex, 2.8, 0.322, 0.066 * es, 0.046 * es, 0.034);
    const yb = sd < 0 ? I.yL : I.yR;
    putT(S1, "iris", yb, ex, 2.8, 0.349, 0.03 * es, 0.03 * es, 0.009);
    putT(S1, "pupil", yb, ex, 2.8, 0.356, 0.013 * es, 0.013 * es, 0.005);
    putT(S1, "glint", yb, ex + 0.011, 2.811, 0.361, 0.006, 0.006, 0.003);
    putT(sphere(12, 8), "skin", H, ex, 2.846, 0.326, 0.074 * es, 0.024, 0.036); // upper lid fold
    putT(warp(box(0.13 * es, 0.012, 0.016, 4), (v) => (v.y -= 6 * v.x * v.x)), "lash", H, ex, 2.834, 0.352);
    putT(S1, "skin", H, ex, 2.762, 0.33, 0.066 * es, 0.013, 0.03); // lower lid
    putT(S2, "dark", sd < 0 ? I.lL : I.lR, ex, 2.8, 0.338, 0.072, 0.056, 0.038); // closing lid (blinks, squints)
    // brow: arched, thick at the inner end, tapering outward (raises / knits on its bone)
    const brow = warp(box(0.16, F.br, 0.045, 6), (v) => {
      const u = (v.x * sd) / 0.08; // -1 inner .. 1 outer
      v.y = v.y * (1 - 0.35 * Math.max(0, u)) - 2.2 * v.x * v.x;
    }).rotateZ(-sd * F.ba);
    putT(brow, "lash", sd < 0 ? I.brL : I.brR, ex, 2.9, 0.352);
  }
  // nose: bridge, tip, wings, nostrils
  const nw = F.nw,
    nl = F.nl;
  putT(S2, "skin", H, 0, 2.755, 0.355 + 0.02 * F.nb, 0.034 * nw, 0.085 * nl, 0.04);
  putT(S2, "skin", H, 0, 2.66 - 0.03 * (nl - 1), 0.405 + 0.012 * nl, 0.048 * nw, 0.044, 0.045);
  for (const sd of [-1, 1]) {
    putT(S1, "skin", H, sd * 0.042 * nw, 2.648 - 0.02 * (nl - 1), 0.38, 0.03 * nw, 0.03, 0.035);
    putT(S1, "crease", H, sd * 0.022 * nw, 2.63 - 0.025 * (nl - 1), 0.4, 0.013, 0.007, 0.01);
  }
  // lips: upper on the head, lower rides the jaw, mouth line + corners on their bones
  putT(S2, "lip", H, 0, 2.582, 0.356, 0.078, 0.019 * F.lp, 0.03);
  putT(S2, "lip", I.jw, 0, 2.547, 0.354, 0.07, 0.022 * F.lp, 0.032);
  putT(box(0.13, 0.012, 0.02), "lipD", I.mo, 0, 2.565, 0.37);
  for (const sd of [-1, 1]) putT(box(0.05, 0.016, 0.02), "lipD", sd < 0 ? I.cL : I.cR, sd * 0.082, 2.563, 0.36);

  // hair: painted onto the skull above a hairline (front / temples / nape), plus volume shells whose thickness eases
  // to zero at the hairline (no helmet lip); style decides colour bands, volume and texture
  const hair = LK.hair,
    beard = LK.beard,
    hcy = 2.78;
  // margin above the hairline (> 0 = hair); sideburns run down in front of the ears
  const hm = (x: number, y: number, z: number, lo = 0) => {
    const ax = Math.abs(x),
      f = Math.min(1, Math.max(0, z / 0.3)),
      b = Math.min(1, Math.max(0, -z / 0.25)),
      yl = 2.85 + f * (0.16 - 0.08 * Math.min(1, ax / 0.3)) - b * 0.3 - lo;
    let m = y - yl;
    if (ax > 0.29 && z > -0.04 && z < 0.1) m = Math.max(m, Math.min(y - 2.66, 0.02));
    return m;
  };
  const fadeKey = (y: number) => (y > 2.97 ? "hair" : y > 2.9 ? "h1" : y > 2.82 ? "h2" : "h3");
  const scalp = (x: number, y: number, z: number): string | null => {
    if (!hair) return null;
    const m = hm(x, y, z);
    if (m < 0) return null;
    if (hair === 1) return m < 0.02 ? "h2" : "h1";
    if (hair === 2 || hair === 5 || hair === 6) return fadeKey(y);
    if (hair === 3) return Math.sin(Math.hypot(x, z + 0.06, (y - 3.25) * 0.8) * 60) > 0.35 ? "hw" : m < 0.02 ? "h1" : "hair";
    if (hair === 10) return Math.sin(x * 70) > 0.1 || y < 2.88 ? "hair" : "h2";
    return m < 0.015 ? "h1" : "hair";
  };
  const skullC: CF = (x, y, z) => {
    const s = scalp(x, y, z);
    if (s) return s;
    const ax = Math.abs(x);
    if (beard === 1 && ax > 0.24 * fw && y < 2.72 && y > 2.5 && z > -0.03 && z < 0.2) return "hair"; // beard up the cheeks
    if (beard === 4 && ax > 0.24 * fw && y < 2.66 && z > -0.03 && z < 0.2) return "stub";
    return "skin";
  };
  VTX.add(skullC);
  putT(loft(SKL, SG(32), 0.92), "skin", H, 0, 0, 0, 1, 1, 1, undefined, undefined, skullC);
  // volume shell: radial scale s (sy vertically) about the skull centre, eased in over `soft` above the hairline
  const vol = (s: number, sy: number, lo: number, soft: number, cf: CF, bump = 0) =>
    putT(
      warp(loft(SKL, SG(32), 0.92), (v) => {
        const t0 = Math.min(1, Math.max(0, hm(v.x, v.y, v.z, lo) / soft)),
          t = t0 * t0 * (3 - 2 * t0);
        let k1 = 1 + (s - 1) * t,
          k2 = 1 + (sy - 1) * t;
        if (bump) {
          const n = sn(v.x * 3.1, v.y * 3.3, v.z * 3.2) + 0.5 * sn(v.x * 7.7 + 1, v.y * 8.1, v.z * 7.3);
          (k1 += n * bump * t), (k2 += n * bump * t);
        }
        v.x *= k1;
        v.z = (v.z + 0.04) * k1 - 0.04;
        v.y = hcy + (v.y - hcy) * k2;
      }),
      "hair",
      H,
      0,
      0,
      0,
      1,
      1,
      1,
      undefined,
      undefined,
      cf,
    );
  const inHair = (lo: number, key: string | ((y: number) => string)): CF => (x, y, z) => {
    return hm(x, y, z, lo) > -0.004 ? (typeof key === "string" ? key : key(y)) : null;
  };
  if (hair === 2 || hair === 5) vol(1.035, 1.05, -0.12, 0.05, inHair(-0.12, "hair"));
  if (hair === 4) vol(1.07, 1.1, 0, 0.09, (x, y, z) => (hm(x, y, z) > -0.004 ? (Math.abs(x - 0.13 * fw) < 0.012 && z > -0.05 && y > 3.0 ? "h2" : "hair") : null));
  if (hair === 5) putT(loft([2.98, 0.29 * fw, 0.3, 0.32, -0.05, 3.2, 0.31 * fw, 0.31, 0.33, -0.06, 3.42, 0.3 * fw, 0.3, 0.32, -0.06, 3.47, 0.22 * fw, 0.22, 0.24, -0.06, 3.48, 0, 0, 0, -0.06], SG(28), 0.75), "hair", H, 0, 0, 0);
  if (hair === 6) vol(1.1, 1.14, -0.12, 0.07, inHair(-0.12, "hair"), 0.03);
  if (hair === 7 || hair === 8) vol(1.09, 1.14, 0.02, 0.12, inHair(0.02, "hair"));
  if (hair === 9) vol(1.32, 1.36, 0.02, 0.16, inHair(0.02, "hair"), 0.04);
  if (hair === 8)
    for (let d = 0; d < 12; d++) {
      const a = Math.PI * (0.22 + (d / 11) * 1.56),
        len = 0.7 + ((LK.h >> d) & 3) * 0.06;
      putT(loft([0.0, 0, 0, 0, 0, -0.02, 0.045, 0.045, 0.045, 0, -len, 0.035, 0.035, 0.035, 0, -len - 0.02, 0, 0, 0, 0], 6).rotateZ(Math.cos(a) * 0.15), "hair", H, Math.cos(a) * 0.36 * fw, 2.98, -Math.abs(Math.sin(a)) * 0.37 - 0.04);
    }
  // facial hair: painted onto the jaw (opens with it); a full beard also gets a little volume
  if (beard) {
    const lipZone = (ax: number, y: number, z: number) => ax < 0.11 && y > 2.47 && z > 0.17;
    const bk = (x: number, y: number, z: number): string | null => {
      const ax = Math.abs(x);
      if (z < -0.02) return null;
      if (beard === 1) return lipZone(ax, y, z) ? null : "hair";
      if (beard === 4) return lipZone(ax, y, z) ? null : "stub";
      if (beard === 3) return (ax > 0.17 || y < 2.4) && !lipZone(ax, y, z) ? "hair" : null;
      return ax < 0.1 && y < 2.48 && z > 0.12 ? "hair" : null; // goatee
    };
    jawC = (x, y, z) => bk(x, y, z) ?? "skin";
    VTX.add(jawC);
    if (beard === 1) putT(loft(shell(JLr, 1.03, 2.6), SG(28), 0.9), "hair", I.jw, 0, 0, 0, 1, 1, 1, undefined, undefined, (x, y, z) => (y < 2.61 && bk(x, y, z) ? "hair" : null));
    if (beard === 1 || beard === 2 || beard === 5) putT(warp(box(0.2, 0.032, 0.04, 6), (v) => (v.y -= 2.5 * v.x * v.x)), "hair", H, 0, 2.598, 0.36);
  }
  putT(loft(JLr, SG(28), 0.9), "skin", I.jw, 0, 0, 0, 1, 1, 1, undefined, undefined, jawC);
  if (LK.band) putT(new THREE.TorusGeometry(0.352 * fw, 0.036, 8, SG(36)).rotateX(Math.PI / 2 - 0.12), "band", H, 0, 3.0, -0.035, 1, 1, 1.13);

  // ---------------- jersey prints (second skinned mesh, rides the torso weights): curved onto the chest/back
  const prints: Part[] = [];
  const PW = 512;
  const prt = (cx: number, cy: number, w: number, h: number, back: boolean, u0: number, v0: number, u1: number, v1: number) => {
    const nx = 10,
      ny = 3,
      pos: number[] = [],
      uvs: number[] = [],
      idx: number[] = [];
    for (let j = 0; j <= ny; j++)
      for (let i = 0; i <= nx; i++) {
        const lx = (i / nx - 0.5) * w,
          y = cy + (j / ny - 0.5) * h,
          x = cx + (back ? -lx : lx);
        levelAt(TL, y, tAt);
        const s = Math.min(1, Math.abs(x) / Math.max(0.05, tAt[0])),
          // invert the superellipse x = rx * s^e for the ring angle, then sit just outside the surface
          sa = Math.pow(s, 1 / 0.86),
          c = Math.pow(Math.max(0, 1 - sa * sa), 0.5 * 0.86);
        pos.push(x, y, back ? tAt[3] - tAt[2] * c - 0.009 : tAt[3] + tAt[1] * c + 0.009);
        uvs.push(u0 + (i / nx) * (u1 - u0), v0 + (j / ny) * (v1 - v0));
      }
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i;
        if (back) idx.push(a, a + nx + 2, a + 1, a, a + nx + 1, a + nx + 2);
        else idx.push(a, a + 1, a + nx + 2, a, a + nx + 2, a + nx + 1);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    put(prints, bp, g, "jer", I.bd, 0, 0, 0, 1, 1, 1, bl(I.ch, 1.25, 0.6, "start", 1));
    (prints[prints.length - 1] as any).print = true;
  };
  // atlas (512 x 512): number top-left 256 x 256, wordmark row 256..384, name row 384..512 (canvas rows; v = 1 - row/512)
  prt(0, 1.22, 0.42 * k, 0.42, false, 0, 0.5, 0.5, 1); // front number
  prt(0, 1.53, 0.9 * k, 0.225, false, 0, 0.25, 1, 0.5); // wordmark
  prt(0, 1.24, 0.74 * k, 0.74, true, 0, 0.5, 0.5, 1); // back number
  prt(0, 1.7, 1.15 * k, 0.29, true, 0, 0, 1, 0.25); // name

  // ---- merge: vertex colours (per face where painted), material class via uv, smooth joint weights ----
  const c = new THREE.Color();
  const skinKeys = new Set(["skin", "warm", "dark", "crease", "stub", "h3"]);
  const build = (list: Part[], printUV: boolean) => {
    const geos = list.map((pt) => {
      const g = pt.g,
        n = g.attributes.position.count,
        col = new Float32Array(n * 3),
        si = new Uint16Array(n * 4),
        sw = new Float32Array(n * 4),
        uvA = new Float32Array(n * 2),
        ouv = g.attributes.uv as THREE.BufferAttribute | undefined,
        keys = (pt as any).keys as string[] | null;
      const pos = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < n; i++) {
        const kk = keys ? keys[keys.length === n ? i : (i / 3) | 0] : pt.key,
          e = C[kk] || C.skin;
        // Color.set already linearizes the hex; the extra sRGB->linear step deepens the palette (richer skin and
        // jersey tones under the bright arena rig) - the game's look since v2, kept on purpose.
        c.set(e[0]).convertSRGBToLinear();
        if (skinKeys.has(kk)) {
          // living skin: slow tone variation, a touch warmer/redder low on the face and at the extremities
          const x = pos.getX(i),
            y = pos.getY(i),
            z = pos.getZ(i),
            nn = 1 + 0.045 * sn(x * 2.3, y * 2.1, z * 2.4);
          c.multiplyScalar(nn);
        }
        col[i * 3] = c.r;
        col[i * 3 + 1] = c.g;
        col[i * 3 + 2] = c.b;
        if (printUV) (uvA[i * 2] = ouv!.getX(i)), (uvA[i * 2 + 1] = ouv!.getY(i));
        else if (e[1] === 1 && ouv) (uvA[i * 2] = ouv.getX(i) * 20), (uvA[i * 2 + 1] = ouv.getY(i) * 13);
        else (uvA[i * 2] = swU(e[1])), (uvA[i * 2 + 1] = swV);
        let w2 = 0,
          w3 = 0;
        const ramp = (b: Blend) => {
          const ly = b.axis === "z" ? pos.getZ(i) - bp[pt.bone].z : pos.getY(i) - bp[pt.bone].y,
            u = Math.min(1, Math.max(0, b.end === "end" ? (b.from + b.len - ly) / b.len : (ly - (b.from - b.len)) / b.len));
          return (b.max ?? 0.5) * u * u * (3 - 2 * u);
        };
        if (pt.blend) w2 = ramp(pt.blend);
        if (pt.blend2) w3 = ramp(pt.blend2) * (1 - w2);
        si[i * 4] = pt.bone;
        si[i * 4 + 1] = pt.blend ? pt.blend.to : 0;
        si[i * 4 + 2] = pt.blend2 ? pt.blend2.to : 0;
        sw[i * 4] = 1 - w2 - w3;
        sw[i * 4 + 1] = w2;
        sw[i * 4 + 2] = w3;
      }
      g.setAttribute("uv", new THREE.BufferAttribute(uvA, 2));
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      g.setAttribute("skinIndex", new THREE.BufferAttribute(si, 4));
      g.setAttribute("skinWeight", new THREE.BufferAttribute(sw, 4));
      for (const k2 of Object.keys(g.attributes)) if (!["position", "normal", "color", "skinIndex", "skinWeight", "uv"].includes(k2)) g.deleteAttribute(k2);
      return g;
    });
    const geo = mergeGeometries(geos)!;
    geos.forEach((g) => g.dispose());
    return geo;
  };
  if (typeof process !== "undefined" && process.env && process.env.RIGDBG) for (const pt of parts) console.log("part", names[pt.bone], pt.key, pt.g.attributes.position.count / 3);
  const geo = build(parts, false);
  const mesh = new THREE.SkinnedMesh(geo, bodyMat());
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  mesh.add(hips);
  const skel = new THREE.Skeleton(bones);
  mesh.bind(skel);
  const G = new THREE.Group();
  G.add(mesh);
  const extra: THREE.Material[] = [];
  G.scale.setScalar(p.ht / 6.4);
  const pl = () => ({ on: false, x: 0, y: 0, z: 0, w: 0 });
  const cs = () => ({ x: 0, vx: 0, z: 0, vz: 0 });
  const rig: Rig = { G, mesh, pmesh: null, bd, tl, tr, kl, kr, sL, sR, eL, eR, wL, wR, ch, nk, hd, al, ar, gL, gR, tf: [tfL, tfR], hem, hs: { x: 0, vx: 0, z: 0, vz: 0, px: 0, pz: 0 }, fl: [flL, flR], cloth: [cs(), cs()], plant: [pl(), pl()], extra, tris: geo.attributes.position.count / 3, fb: { jw, mi, mo, c: [cL, cR], b: [brL, brR], l: [lL, lR], y: [yL, yR], fr: [] } };
  for (const b of [cL, cR, brL, brR, lL, lR, yL, yR]) rig.fb.fr.push(b.position.clone());
  faceRest(rig);
  if (typeof document === "undefined") return rig; // Node (FK parity test): bones + mesh only
  // jersey prints: one atlas per player (crisp: 512 px, mipmapped, anisotropic via tex()), drawn by a second skinned
  // mesh that shares the skeleton, so the lettering bends with the torso
  const pc = document.createElement("canvas");
  pc.width = pc.height = hi ? PW : PW / 2;
  const x = pc.getContext("2d")!,
    sc = pc.width / PW,
    fill = LK.trim,
    out = Math.abs(lum(fill) - lum(sec)) < 0.25 ? (lum(fill) > 0.5 ? "#16161c" : "#ffffff") : sec;
  x.scale(sc, sc);
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.lineJoin = "round";
  const txt = (s: string, cx: number, cy: number, font: string, maxW: number, lw: number, sxk = 1) => {
    x.save();
    x.font = font;
    const m = x.measureText(s).width * sxk,
      f = m > maxW ? maxW / m : 1;
    x.translate(cx, cy);
    x.scale(f * sxk, 1);
    x.strokeStyle = out;
    x.lineWidth = lw;
    x.strokeText(s, 0, 0);
    x.fillStyle = fill;
    x.fillText(s, 0, 0);
    x.restore();
  };
  const NF = "'Arial Black','Helvetica Neue',Arial,system-ui";
  txt(String(p.no ?? ""), 128, 136, `900 196px ${NF}`, 236, 16, 0.86);
  txt(String((cl && cl[p.tm]) || "").toUpperCase().slice(0, 10), 256, 322, `italic 900 84px ${NF}`, 488, 10);
  txt(String(p.n).split(" ").pop()!.toUpperCase().slice(0, 12), 256, 448, `800 72px ${NF}`, 488, 8);
  const pm = new THREE.MeshStandardMaterial({ map: tex(pc), transparent: true, alphaTest: 0.04, roughness: 0.62, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false });
  extra.push(pm);
  const pg = build(prints, true),
    pmesh = new THREE.SkinnedMesh(pg, pm);
  pmesh.frustumCulled = false;
  pmesh.renderOrder = 1;
  G.add(pmesh);
  pmesh.bind(skel, mesh.bindMatrix);
  rig.pmesh = pmesh;
  return rig;
}

/** Joint angles (sim p.q) -> bone rotations. Same mapping as the original rig, so hand FK stays exact. */
export function applyPose(m: Rig, p: any) {
  const q = p.q;
  if (!q) return;
  const w = W3(p.x, p.y, p.z);
  m.G.position.set(w[0], w[1] - q.cr * 0.4, w[2]);
  m.G.rotation.y = Math.PI / 2 - fv(p);
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
  // shoulders: XZY so the humeral twist (hL/hR, + = internal rotation) turns about the upper-arm bone itself
  m.sL.rotation.set(-q.aL, q.hL || 0, -(q.zL == null ? q.sz : q.zL), "XZY");
  m.sR.rotation.set(-q.aR, -(q.hR || 0), q.sz, "XZY");
  m.eL.rotation.x = -q.eL;
  m.eR.rotation.x = -q.eR;
  m.wL.rotation.set(-(q.wL || 0), q.oL || 0, 0, "YXZ"); // forearm twist then wrist flex (matches pose.ts FK)
  m.wR.rotation.set(-(q.wR || 0), q.oR || 0, 0, "YXZ");
  m.bd.rotation.set(q.ln, q.ty, q.rz, "YXZ");
  if (m.fb) applyFace(m, p);
}

/** Face at rest: mouth closed, lids open (the closing lids are folded up into the upper eyelid line). */
function faceRest(m: Rig) {
  const f = m.fb;
  f.mi.scale.set(1, 0.001, 1);
  for (const l of f.l) l.scale.set(1, 0.02, 1);
}
/** Expressions (p.fc from pose.ts face(): jaw jw, smile sm (-1 frown .. 1), brow raise br, anger an, squint sq,
 *  blink bl, mouth width wd, eye look ex/ey) -> face bones. Client only; the sim never reads the face. */
function applyFace(m: Rig, p: any) {
  const c = p.fc,
    f = m.fb;
  if (!c) return faceRest(m);
  const smp = Math.max(0, c.sm);
  f.jw.rotation.x = c.jw * 0.3 + smp * 0.05;
  // a grin parts the lips over the upper teeth; a frown purses them (corners down, line narrower)
  f.mi.scale.set(1 + c.wd * 0.25 + smp * 0.2, Math.max(0.001, c.jw * 0.95, smp * 0.32), 1);
  f.mo.scale.x = 1 + c.wd * 0.3 + smp * 0.25 + Math.min(0, c.sm) * 0.15;
  for (let s = 0; s < 2; s++) {
    const sd = s ? 1 : -1,
      cr = f.c[s],
      r0 = f.fr[s];
    cr.position.set(r0.x + sd * (c.wd * 0.025 + smp * 0.035), r0.y + c.sm * (c.sm > 0 ? 0.014 : 0.034), r0.z + smp * 0.006);
    cr.rotation.z = sd * c.sm * 0.7;
    const br = f.b[s],
      r1 = f.fr[2 + s];
    br.position.y = r1.y + c.br * 0.035 - c.an * 0.02;
    br.rotation.z = sd * (c.an * 0.38 - c.br * 0.22);
    const lid = Math.max(c.bl, c.sq * 0.5, Math.max(0, c.sm) * 0.22);
    f.l[s].scale.set(1, Math.max(0.02, lid), 1);
    const ey = f.y[s],
      r3 = f.fr[6 + s];
    ey.position.set(r3.x + c.ex * 0.035, r3.y - c.ey * 0.03, r3.z);
  }
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
    // the core already places the feet in locomotion (pose.ts stepSolve): this pass only covers what it doesn't
    const w = pl.w * (1 - (p.stp ? p.stp.w : 0)),
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
function roundBox(w: number, h: number, d: number, sx = 2) {
  const g = new THREE.BoxGeometry(w, h, d, sx, 2, 2),
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
