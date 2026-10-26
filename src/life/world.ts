// LIFE open world (three.js): a small procedural town in feet - roads, sidewalks, buildings with lit windows, signs
// for the fictional businesses, the arena, campus, homes, The Cage street court, trees, street lamps, parked and
// moving cars, NPC pedestrians (rig v6, low LOD, mocap walk), the player's rig, a third-person camera that never
// goes through walls, day/night lighting from the life clock and an objective beacon. Own WebGLRenderer (the arena
// renderer is untouched); everything instanced/shared where it repeats so it stays Chromebook-friendly.
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { makeRig, applyPose, clothStep, type Rig } from "../client/rig3d";
import { PLACES, ROADS, WORLD, doorOf, blocked, type Place } from "./places";
import { mkBody, animate, type Body, type Act } from "./anim";
import { mkRng, hashStr, pick } from "./rng";

export interface Look {
  n: string;
  col: string;
  sk: string;
  hr: number;
  hs: number;
  bd: number;
  ht: number;
  bk: number;
  no: number;
}
export interface Stick {
  mx: number; // -1..1 right
  mz: number; // -1..1 forward
  sprint: boolean;
}
export interface Npc {
  b: Body;
  rig: Rig | null;
  look: any;
  path: number[]; // node indices (walkers) or [] (idlers)
  seg: number;
  x: number;
  z: number;
  f: number;
  spd: number;
  idle?: Act;
  talkT: number;
  fan: number; // recognises the player (fame)
}
const SKN = ["#f1c27d", "#c68642", "#8d5524", "#6b4226", "#e8b88f", "#e0ac69"];
const SHIRTS = ["#2e86de", "#e84393", "#10ac84", "#f368e0", "#ff9f43", "#576574", "#222f3e", "#c8d6e5", "#ee5253", "#5f27cd", "#01a3a4", "#feca57"];
const NPCN = "Ava Ben Cara Dev Eli Fay Gus Hana Ian Jo Kai Lia Max Nia Oto Pia Quin Ray Sia Tom Uma Vic Wes Xia Yan Zoe".split(" ");

/** Window texture tile (wall white = tinted by the material colour) + its night emissive twin. */
function windowTex(lit: boolean) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = lit ? "#000" : "#fff";
  g.fillRect(0, 0, 128, 128);
  const r = mkRng(lit ? 7 : 3);
  for (let row = 0; row < 2; row++)
    for (let col = 0; col < 2; col++) {
      const x = 14 + col * 64,
        y = 12 + row * 64;
      if (lit) {
        const on = r() < 0.55;
        g.fillStyle = on ? (r() < 0.5 ? "#ffd98a" : "#fff1c9") : "#000";
      } else {
        const gr = g.createLinearGradient(x, y, x + 36, y + 40);
        gr.addColorStop(0, "#3b4b5e");
        gr.addColorStop(1, "#7d93ab");
        g.fillStyle = gr;
      }
      g.fillRect(x, y, 36, 40);
      if (!lit) {
        g.fillStyle = "#d8d8d8";
        g.fillRect(x - 3, y + 40, 42, 4); // sill
      }
    }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
/** Scale a box's UVs to world units so one repeating texture tiles every building the same (16 ft x 14 ft). */
function boxUV(g: THREE.BufferGeometry, w: number, h: number, d: number) {
  const uv = g.attributes.uv as THREE.BufferAttribute,
    fw = [d, d, w, w, w, w],
    fh = [h, h, d, d, h, h];
  for (let f = 0; f < 6; f++)
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, (uv.getX(i) * fw[f]) / 16, (uv.getY(i) * fh[f]) / 14);
    }
  uv.needsUpdate = true;
}
function signTex(text: string, bg: string, fg: string) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect(4, 4, 504, 120, 18);
  g.fill();
  g.strokeStyle = fg;
  g.lineWidth = 5;
  g.stroke();
  g.fillStyle = fg;
  let fs = 74;
  g.font = `900 ${fs}px system-ui, sans-serif`;
  while (g.measureText(text).width > 470 && fs > 30) g.font = `900 ${(fs -= 4)}px system-ui, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 256, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function courtTex() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 280;
  const g = c.getContext("2d")!;
  g.fillStyle = "#2b5d8a";
  g.fillRect(0, 0, 256, 280);
  g.fillStyle = "#c0562a";
  g.fillRect(88, 0, 80, 110);
  g.strokeStyle = "#f4f4f4";
  g.lineWidth = 4;
  g.strokeRect(6, 6, 244, 268);
  g.strokeRect(88, 6, 80, 104);
  g.beginPath();
  g.arc(128, 110, 30, 0, Math.PI);
  g.stroke();
  g.beginPath();
  g.arc(128, 22, 112, 0.12, Math.PI - 0.12);
  g.stroke();
  g.beginPath();
  g.arc(128, 274, 34, Math.PI, 0);
  g.stroke();
  // wear
  const r = mkRng(5);
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(0,0,0,${r() * 0.08})`;
    g.fillRect(r() * 256, r() * 280, 2 + r() * 6, 2 + r() * 6);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function roadTex() {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#3a3d42";
  g.fillRect(0, 0, 64, 256);
  const r = mkRng(9);
  for (let i = 0; i < 500; i++) {
    g.fillStyle = `rgba(255,255,255,${r() * 0.05})`;
    g.fillRect(r() * 64, r() * 256, 1 + r() * 2, 1 + r() * 2);
  }
  g.fillStyle = "#e6c34a";
  g.fillRect(30, 0, 4, 120);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
function grassTex() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#5d8f3f";
  g.fillRect(0, 0, 128, 128);
  const r = mkRng(11);
  for (let i = 0; i < 1600; i++) {
    const v = r();
    g.fillStyle = v < 0.5 ? "rgba(40,80,25,.35)" : "rgba(140,190,90,.25)";
    g.fillRect(r() * 128, r() * 128, 1, 2 + r() * 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(70, 70);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
const lerpC = (a: THREE.Color, b: THREE.Color, t: number, o = new THREE.Color()) => o.copy(a).lerp(b, Math.max(0, Math.min(1, t)));

// ---- sidewalk graph for walkers (intersections of the sidewalk lines)
const XS = [-326, -24, 24, 326],
  ZS = [-24, 24, 146, 190];
const NODES: [number, number][] = [];
for (const z of ZS) for (const x of XS) NODES.push([x, z]);
NODES.push([-24, -326], [24, -326], [-24, 326], [24, 326]);
const EDGES: number[][] = NODES.map(() => []);
const link = (a: number, b: number) => (EDGES[a].push(b), EDGES[b].push(a));
for (let zi = 0; zi < ZS.length; zi++) for (let xi = 0; xi < XS.length - 1; xi++) link(zi * 4 + xi, zi * 4 + xi + 1);
for (let xi = 1; xi <= 2; xi++) for (let zi = 0; zi < ZS.length - 1; zi++) link(zi * 4 + xi, (zi + 1) * 4 + xi);
link(16, 1), link(17, 2), link(18, 13), link(19, 14);

export function createWorld(canvas: HTMLCanvasElement, opt: { ql: number; npc?: number }) {
  const QL = opt.ql;
  const R = new THREE.WebGLRenderer({ canvas, antialias: QL >= 1, powerPreference: "high-performance" });
  R.setPixelRatio(Math.min(devicePixelRatio || 1, [1, 1.25, 1.75][QL] || 1));
  R.outputColorSpace = THREE.SRGBColorSpace;
  R.toneMapping = THREE.ACESFilmicToneMapping;
  R.toneMappingExposure = 0.95;
  R.shadowMap.enabled = QL >= 1;
  R.shadowMap.type = THREE.PCFShadowMap;
  const S = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(R);
  S.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  pm.dispose();
  const cam = new THREE.PerspectiveCamera(58, 16 / 9, 0.4, 1600);
  S.fog = new THREE.Fog(0xbcd4ec, 260, 900);
  const TX = (c: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };

  // ---------------- sky dome (vertex gradient), sun, moon, stars
  const skyG = new THREE.SphereGeometry(1000, 24, 12);
  skyG.setAttribute("color", new THREE.BufferAttribute(new Float32Array(skyG.attributes.position.count * 3), 3));
  const sky = new THREE.Mesh(skyG, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -10;
  S.add(sky);
  const starG = new THREE.BufferGeometry(),
    sp: number[] = [];
  {
    const r = mkRng(77);
    for (let i = 0; i < 700; i++) {
      const a = r() * Math.PI * 2,
        e = 0.12 + r() * 1.4;
      sp.push(Math.cos(a) * Math.cos(e) * 950, Math.sin(e) * 950, Math.sin(a) * Math.cos(e) * 950);
    }
  }
  starG.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
  const starM = new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
  S.add(new THREE.Points(starG, starM));
  const disc = (col: string, glow: number) => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!,
      gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, col);
    gr.addColorStop(glow, col);
    gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TX(c), transparent: true, fog: false, depthWrite: false, blending: THREE.AdditiveBlending }));
    S.add(s);
    return s;
  };
  const sun = disc("#fff6d8", 0.25),
    moon = disc("#e8eefc", 0.35);
  sun.scale.setScalar(110);
  moon.scale.setScalar(60);

  // ---------------- lights
  const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x5a6b3c, 1.4);
  S.add(hemi);
  const key = new THREE.DirectionalLight(0xfff2dd, 2.6);
  key.castShadow = QL >= 1;
  key.shadow.mapSize.set(QL >= 2 ? 2048 : 1024, QL >= 2 ? 2048 : 1024);
  const sc = key.shadow.camera as THREE.OrthographicCamera;
  sc.left = sc.bottom = -70;
  sc.right = sc.top = 70;
  sc.near = 1;
  sc.far = 400;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.6;
  S.add(key, key.target);

  // ---------------- ground, roads, sidewalks
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1800, 1800), new THREE.MeshStandardMaterial({ map: grassTex(), roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  S.add(ground);
  const rt = roadTex(),
    walkM = new THREE.MeshStandardMaterial({ color: 0xb9b6ae, roughness: 0.9 });
  for (const r of ROADS) {
    const w = r.x1 - r.x0,
      d = r.z1 - r.z0,
      horiz = w > d,
      t = rt.clone();
    t.repeat.set(1, (horiz ? w : d) / 40);
    t.needsUpdate = true;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(horiz ? d : w, horiz ? w : d), new THREE.MeshStandardMaterial({ map: t, roughness: 0.85 }));
    m.rotation.x = -Math.PI / 2;
    if (horiz) m.rotation.z = Math.PI / 2;
    m.position.set((r.x0 + r.x1) / 2, 0.03, (r.z0 + r.z1) / 2);
    m.receiveShadow = true;
    S.add(m);
    // sidewalks both sides (curb height 0.5 ft)
    for (const s of [-1, 1]) {
      const sw = new THREE.Mesh(new THREE.BoxGeometry(horiz ? w : 9, 0.5, horiz ? 9 : d), walkM);
      sw.position.set(horiz ? (r.x0 + r.x1) / 2 : (s > 0 ? r.x1 : r.x0) + s * 4.5, 0.25, horiz ? (s > 0 ? r.z1 : r.z0) + s * 4.5 : (r.z0 + r.z1) / 2);
      sw.receiveShadow = true;
      S.add(sw);
    }
  }
  // campus quad paths + lawn tint, plaza in front of the arena, crosswalk stripes
  const pathM = new THREE.MeshStandardMaterial({ color: 0xcdbfa3, roughness: 0.95 });
  const flat = (x: number, z: number, w: number, d: number, m: THREE.Material, y = 0.06) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m);
    p.rotation.x = -Math.PI / 2;
    p.position.set(x, y, z);
    p.receiveShadow = true;
    S.add(p);
    return p;
  };
  flat(-150, -140, 12, 150, pathM);
  flat(-150, -140, 180, 12, pathM);
  flat(-150, -140, 34, 34, pathM, 0.065);
  flat(165, -60, 120, 70, new THREE.MeshStandardMaterial({ color: 0xa9a49a, roughness: 0.9 }));
  flat(165, -265, 200, 60, new THREE.MeshStandardMaterial({ color: 0x4a4d52, roughness: 0.9 }));
  const zebra = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.8 });
  for (const [cx, cz, horiz] of [
    [0, 30, 1],
    [0, -30, 1],
    [30, 0, 0],
    [-30, 0, 0],
    [0, 138, 1],
    [0, 198, 1],
  ] as [number, number, number][])
    for (let k = -3; k <= 3; k++) flat(cx + (horiz ? k * 4.5 : 0), cz + (horiz ? 0 : k * 4.5), horiz ? 2.2 : 10, horiz ? 10 : 2.2, zebra, 0.05);

  // ---------------- buildings
  const wallT = windowTex(false),
    litT = windowTex(true),
    roofM = new THREE.MeshStandardMaterial({ color: 0x3d4148, roughness: 0.9 }),
    wallMs: THREE.MeshStandardMaterial[] = [],
    signMs: THREE.MeshStandardMaterial[] = [],
    boxes: { x0: number; x1: number; z0: number; z1: number; y1: number }[] = [];
  const wallMat = (col: string) => {
    const m = new THREE.MeshStandardMaterial({ color: col, map: wallT, emissive: 0xffffff, emissiveMap: litT, emissiveIntensity: 0, roughness: 0.82 });
    wallMs.push(m);
    return m;
  };
  const signs: { p: Place; mesh: THREE.Mesh }[] = [];
  const signPlane = (p: Place, text: string, bg: string, fg: string, w: number, y: number) => {
    const t = signTex(text, bg, fg),
      m = new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.15, roughness: 0.5 });
    signMs.push(m);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), m);
    const dr = doorOf(p);
    mesh.position.set(dr.x - Math.cos(dr.f) * 3.6, y, dr.z - Math.sin(dr.f) * 3.6);
    mesh.rotation.y = Math.PI / 2 - dr.f + Math.PI;
    S.add(mesh);
    signs.push({ p, mesh });
    return mesh;
  };
  const awnM = new Map<string, THREE.MeshStandardMaterial>();
  for (const p of PLACES) {
    if (p.k === "court") continue;
    if (p.oval) {
      // arena: elliptical bowl with a light band, a shallow dome, an entrance canopy
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 64, 1, true), new THREE.MeshStandardMaterial({ color: p.col, roughness: 0.6, metalness: 0.2 }));
      wall.scale.set(p.w / 2, p.h, p.d / 2);
      wall.position.set(p.x, p.h / 2, p.z);
      wall.castShadow = wall.receiveShadow = true;
      S.add(wall);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(1.01, 1.01, 1, 64, 1, true), new THREE.MeshStandardMaterial({ color: 0x15171c, emissive: 0xff8a3d, emissiveIntensity: 0.2, roughness: 0.4 }));
      band.scale.set(p.w / 2, 5, p.d / 2);
      band.position.set(p.x, p.h - 9, p.z);
      S.add(band);
      signMs.push(band.material as THREE.MeshStandardMaterial);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xaab3bf, roughness: 0.5, metalness: 0.3 }));
      dome.scale.set(p.w / 2, 16, p.d / 2);
      dome.position.set(p.x, p.h, p.z);
      dome.castShadow = true;
      S.add(dome);
      const can = new THREE.Mesh(new THREE.BoxGeometry(46, 2, 14), new THREE.MeshStandardMaterial({ color: 0x23262d, roughness: 0.5 }));
      can.position.set(p.x, 16, p.z + p.d / 2 + 4);
      can.castShadow = true;
      S.add(can);
      for (const sx of [-21, 21]) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 16, 10), roofM);
        col.position.set(p.x + sx, 8, p.z + p.d / 2 + 9);
        S.add(col);
      }
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(40, 14), new THREE.MeshStandardMaterial({ color: 0x223344, emissive: 0xffd9a0, emissiveIntensity: 0.1, roughness: 0.1, metalness: 0.5 }));
      glass.position.set(p.x, 7, p.z + p.d / 2 + 0.6);
      S.add(glass);
      signMs.push(glass.material as THREE.MeshStandardMaterial);
      signPlane(p, "SUMMIT ARENA", "#e8541e", "#ffffff", 44, 26);
      boxes.push({ x0: p.x - p.w / 2 * 0.72, x1: p.x + p.w / 2 * 0.72, z0: p.z - p.d / 2 * 0.72, z1: p.z + p.d / 2 * 0.72, y1: p.h + 16 });
      continue;
    }
    const g = new THREE.BoxGeometry(p.w, p.h, p.d);
    boxUV(g, p.w, p.h, p.d);
    const wm = wallMat(p.col),
      mesh = new THREE.Mesh(g, [wm, wm, roofM, roofM, wm, wm]);
    mesh.position.set(p.x, p.h / 2, p.z);
    mesh.castShadow = mesh.receiveShadow = true;
    S.add(mesh);
    boxes.push({ x0: p.x - p.w / 2, x1: p.x + p.w / 2, z0: p.z - p.d / 2, z1: p.z + p.d / 2, y1: p.h });
    if (p.k === "home" || p.k === "house") {
      if (p.h < 40) {
        const roof = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 4), new THREE.MeshStandardMaterial({ color: p.k === "home" ? 0x6b3b2a : 0x4a4f57, roughness: 0.9 }));
        roof.rotation.y = Math.PI / 4;
        roof.scale.set(p.w * 0.74, 11, p.d * 0.74);
        roof.position.set(p.x, p.h + 5.5, p.z);
        roof.castShadow = true;
        S.add(roof);
      } else {
        // towers: a lit crown
        const cr = new THREE.Mesh(new THREE.BoxGeometry(p.w * 0.6, 6, p.d * 0.6), new THREE.MeshStandardMaterial({ color: 0x222831, emissive: 0x7fd3ff, emissiveIntensity: 0.3 }));
        cr.position.set(p.x, p.h + 3, p.z);
        S.add(cr);
        signMs.push(cr.material as THREE.MeshStandardMaterial);
      }
    }
    if (p.deco) continue;
    // door + frame, awning / storefront glass on the door side
    const dr = doorOf(p),
      nx = Math.cos(dr.f),
      nz = Math.sin(dr.f),
      door = new THREE.Mesh(new THREE.PlaneGeometry(6, 8.5), new THREE.MeshStandardMaterial({ color: 0x2a1f18, roughness: 0.6, emissive: 0xffc97a, emissiveIntensity: 0 }));
    door.position.set(dr.x - nx * 3.9, 4.25, dr.z - nz * 3.9);
    door.rotation.y = Math.PI / 2 - dr.f + Math.PI;
    S.add(door);
    signMs.push(door.material as THREE.MeshStandardMaterial);
    if (p.k === "food" || p.k === "shop" || p.k === "service" || p.k === "gym") {
      const sc2 = p.sign || "#ffffff";
      let am = awnM.get(sc2);
      if (!am) awnM.set(sc2, (am = new THREE.MeshStandardMaterial({ color: sc2 === "#ffffff" ? p.col : sc2, roughness: 0.8 })));
      const aw = new THREE.Mesh(new THREE.BoxGeometry(p.w * 0.9, 0.6, 5), am);
      aw.position.set(dr.x - nx * 1.6, 10.2, dr.z - nz * 1.6);
      aw.rotation.y = Math.PI / 2 - dr.f;
      aw.rotation.x = 0;
      aw.castShadow = true;
      S.add(aw);
      const gl = new THREE.Mesh(new THREE.PlaneGeometry(p.w * 0.8, 7), new THREE.MeshStandardMaterial({ color: 0x1d2b38, roughness: 0.08, metalness: 0.6, emissive: 0xffe2b0, emissiveIntensity: 0.05 }));
      gl.position.set(dr.x - nx * 3.85, 4.6, dr.z - nz * 3.85);
      gl.rotation.y = door.rotation.y;
      gl.position.y = 4.6;
      S.add(gl);
      signMs.push(gl.material as THREE.MeshStandardMaterial);
      door.position.x += nx * 0.05;
      door.position.z += nz * 0.05;
    }
    const sgn = p.k === "home" ? null : signPlane(p, p.n.toUpperCase(), p.k === "campus" || p.k === "dorm" ? "#3b2a20" : p.col, p.sign || "#ffffff", Math.min(p.w * 0.8, 30), Math.min(p.h - 4, 15));
    void sgn;
  }
  // ---------------- The Cage (street court): surface, fence posts + rails, one hoop
  const court = PLACES.find((p) => p.k === "court")!;
  {
    const surf = new THREE.Mesh(new THREE.PlaneGeometry(court.w, court.d), new THREE.MeshStandardMaterial({ map: courtTex(), roughness: 0.8 }));
    surf.rotation.x = -Math.PI / 2;
    surf.position.set(court.x, 0.07, court.z);
    surf.receiveShadow = true;
    S.add(surf);
    const postM = new THREE.MeshStandardMaterial({ color: 0x6d7378, roughness: 0.5, metalness: 0.6 }),
      fenceT = (() => {
        const c = document.createElement("canvas");
        c.width = c.height = 64;
        const g = c.getContext("2d")!;
        g.strokeStyle = "rgba(200,205,210,.9)";
        g.lineWidth = 2;
        for (let i = -64; i < 128; i += 12) {
          g.beginPath();
          g.moveTo(i, 0);
          g.lineTo(i + 64, 64);
          g.moveTo(i + 64, 0);
          g.lineTo(i, 64);
          g.stroke();
        }
        const t = new THREE.CanvasTexture(c);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        return t;
      })();
    const side = (x0: number, z0: number, x1: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0),
        t = fenceT.clone();
      t.repeat.set(len / 3, 3);
      t.needsUpdate = true;
      const f = new THREE.Mesh(new THREE.PlaneGeometry(len, 10), new THREE.MeshStandardMaterial({ map: t, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, color: 0xdfe4e8, metalness: 0.4, roughness: 0.5 }));
      f.position.set((x0 + x1) / 2, 5, (z0 + z1) / 2);
      f.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
      S.add(f);
      for (let k = 0; k <= Math.round(len / 12); k++) {
        const u = k / Math.round(len / 12),
          po = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 10.5, 6), postM);
        po.position.set(x0 + (x1 - x0) * u, 5.25, z0 + (z1 - z0) * u);
        S.add(po);
      }
    };
    const x0 = court.x - court.w / 2 - 2,
      x1 = court.x + court.w / 2 + 2,
      z0 = court.z - court.d / 2 - 2,
      z1 = court.z + court.d / 2 + 2;
    side(x0, z0, x1, z0);
    side(x0, z0, x0, z1);
    side(x1, z0, x1, z1);
    side(x0, z1, court.x - 6, z1); // gate in the south fence
    side(court.x + 6, z1, x1, z1);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 13, 10), postM);
    pole.position.set(court.x, 6.5, z0 + 1.2);
    pole.castShadow = true;
    S.add(pole);
    const bb = new THREE.Mesh(new THREE.BoxGeometry(6, 3.5, 0.2), new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.4 }));
    bb.position.set(court.x, 11.5, z0 + 4);
    bb.castShadow = true;
    S.add(bb);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 3), postM);
    arm.position.set(court.x, 11.5, z0 + 2.4);
    S.add(arm);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.06, 6, 20), new THREE.MeshStandardMaterial({ color: 0xe8541e, roughness: 0.4, metalness: 0.4 }));
    rim.rotation.x = Math.PI / 2;
    rim.position.set(court.x, 10, z0 + 4.85);
    S.add(rim);
    const net = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.45, 1.4, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.7 }));
    net.position.set(court.x, 9.3, z0 + 4.85);
    S.add(net);
  }
  // ---------------- trees (instanced), lamps (instanced + glow points), benches
  const treeP: [number, number, number][] = [];
  {
    const r = mkRng(31);
    const tryAt = (x: number, z: number, s = 1) => {
      if (blocked(x, z, 5)) return;
      if (ROADS.some((rd) => x > rd.x0 - 10 && x < rd.x1 + 10 && z > rd.z0 - 10 && z < rd.z1 + 10)) return;
      for (const p of PLACES)
        if (!p.deco) {
          const d = doorOf(p);
          if (Math.hypot(d.x - x, d.z - z) < 14) return;
        }
      if (Math.abs(x - court.x) < court.w / 2 + 6 && Math.abs(z - court.z) < court.d / 2 + 6) return;
      treeP.push([x, z, s]);
    };
    for (let x = -320; x <= 320; x += 34) for (const z of [-34, 34, 136, 200]) tryAt(x + (r() - 0.5) * 6, z + (r() - 0.5) * 3, 0.8 + r() * 0.5);
    for (let k = 0; k < 40; k++) tryAt(-150 + (r() - 0.5) * 170, -140 + (r() - 0.5) * 120, 0.9 + r() * 0.6); // quad
    for (let k = 0; k < 90; k++) tryAt((r() - 0.5) * 660, (r() - 0.5) * 660, 0.9 + r() * 0.8);
    for (let k = -320; k <= 320; k += 26) tryAt(k, -320, 1.2), tryAt(k, 322, 1.2), tryAt(-322, k, 1.2), tryAt(322, k, 1.2);
  }
  const trunkI = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.45, 0.65, 8, 6), new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 0.9 }), treeP.length),
    crownG = new THREE.IcosahedronGeometry(5.5, 1),
    crownI = new THREE.InstancedMesh(crownG, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true }), treeP.length * 2);
  {
    const M = new THREE.Matrix4(),
      Q = new THREE.Quaternion(),
      V = new THREE.Vector3(),
      SC = new THREE.Vector3(),
      cl = new THREE.Color(),
      r = mkRng(2);
    treeP.forEach(([x, z, s], i) => {
      M.compose(V.set(x, 4 * s, z), Q.identity(), SC.set(s, s, s));
      trunkI.setMatrixAt(i, M);
      for (let k = 0; k < 2; k++) {
        Q.setFromEuler(new THREE.Euler(r(), r() * 6, r()));
        M.compose(V.set(x + (k ? 1.6 : -0.8) * s, (9 + k * 3.2) * s, z + (k ? -0.6 : 0.9) * s), Q, SC.set(s * (1.1 - k * 0.25), s * (0.95 - k * 0.2), s * (1.1 - k * 0.25)));
        crownI.setMatrixAt(i * 2 + k, M);
        crownI.setColorAt(i * 2 + k, cl.setHSL(0.24 + r() * 0.08, 0.45 + r() * 0.2, 0.26 + r() * 0.12));
      }
    });
    trunkI.castShadow = crownI.castShadow = QL >= 1;
    crownI.receiveShadow = true;
    S.add(trunkI, crownI);
  }
  const lampP: [number, number][] = [];
  for (const r of ROADS) {
    const horiz = r.x1 - r.x0 > r.z1 - r.z0;
    for (let u = horiz ? r.x0 + 20 : r.z0 + 20; u < (horiz ? r.x1 : r.z1) - 10; u += 64)
      for (const s of [-1, 1]) {
        const x = horiz ? u : s > 0 ? r.x1 + 8 : r.x0 - 8,
          z = horiz ? (s > 0 ? r.z1 + 8 : r.z0 - 8) : u;
        if (Math.abs(x) < 26 && Math.abs(z) < 26) continue;
        lampP.push([x, z]);
      }
  }
  const poleI = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.25, 16, 6), new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.5, metalness: 0.6 }), lampP.length),
    bulbM = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffd28a, emissiveIntensity: 0 }),
    headI = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 0.5, 1.4), bulbM, lampP.length);
  {
    const M = new THREE.Matrix4();
    lampP.forEach(([x, z], i) => {
      poleI.setMatrixAt(i, M.makeTranslation(x, 8, z));
      headI.setMatrixAt(i, M.makeTranslation(x, 16, z));
    });
    S.add(poleI, headI);
  }
  const glowC = document.createElement("canvas");
  glowC.width = glowC.height = 64;
  {
    const g = glowC.getContext("2d")!,
      gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(255,220,150,1)");
    gr.addColorStop(0.3, "rgba(255,200,120,.45)");
    gr.addColorStop(1, "rgba(255,200,120,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
  }
  const glowG = new THREE.BufferGeometry();
  glowG.setAttribute("position", new THREE.Float32BufferAttribute(lampP.flatMap(([x, z]) => [x, 15.6, z]), 3));
  const glowM = new THREE.PointsMaterial({ map: TX(glowC), size: 18, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  S.add(new THREE.Points(glowG, glowM));
  // pools of light on the ground under lamps (cheap fake: additive discs)
  const poolM = new THREE.MeshBasicMaterial({ map: TX(glowC), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
    poolI = new THREE.InstancedMesh(new THREE.PlaneGeometry(26, 26), poolM, lampP.length);
  {
    const M = new THREE.Matrix4(),
      Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)),
      V = new THREE.Vector3(),
      SC = new THREE.Vector3(1, 1, 1);
    lampP.forEach(([x, z], i) => poolI.setMatrixAt(i, M.compose(V.set(x, 0.6, z), Q, SC)));
    S.add(poolI);
  }

  // ---------------- cars: parked (instanced) + moving
  const carCols = [0xc0392b, 0x2980b9, 0xecf0f1, 0x2c3e50, 0x7f8c8d, 0xf1c40f, 0x16a085, 0x8e44ad, 0x111111],
    carBodyG = new THREE.BoxGeometry(14, 3, 6.4),
    cabG = new THREE.BoxGeometry(7.5, 2.4, 5.8),
    wheelG = new THREE.CylinderGeometry(1.2, 1.2, 0.8, 10),
    glassM = new THREE.MeshStandardMaterial({ color: 0x1b2631, roughness: 0.1, metalness: 0.7 }),
    tireM = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.9 });
  {
    const spots: [number, number, number][] = [];
    for (let k = 0; k < 14; k++) spots.push([85 + k * 11.5, -255, Math.PI / 2], [85 + k * 11.5, -275, -Math.PI / 2]);
    const r = mkRng(4),
      use = spots.filter(() => r() < 0.65);
    const bI = new THREE.InstancedMesh(carBodyG, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.4 }), use.length),
      cI = new THREE.InstancedMesh(cabG, glassM, use.length),
      M = new THREE.Matrix4(),
      Q = new THREE.Quaternion(),
      V = new THREE.Vector3(),
      SC = new THREE.Vector3(1, 1, 1),
      cl = new THREE.Color();
    use.forEach(([x, z, a], i) => {
      Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
      bI.setMatrixAt(i, M.compose(V.set(x, 2.3, z), Q, SC));
      cI.setMatrixAt(i, M.compose(V.set(x, 4.9, z), Q, SC));
      bI.setColorAt(i, cl.setHex(pick(r, carCols)));
      boxes.push({ x0: x - 3.5, x1: x + 3.5, z0: z - 7, z1: z + 7, y1: 6 });
    });
    bI.castShadow = QL >= 1;
    S.add(bI, cI);
  }
  type Car = { g: THREE.Group; lane: number; u: number; v: number; vmax: number };
  const LANES: { x0: number; z0: number; x1: number; z1: number }[] = [
    { x0: -340, z0: 8, x1: 340, z1: 8 },
    { x0: 340, z0: -8, x1: -340, z1: -8 },
    { x0: -8, z0: -340, x1: -8, z1: 340 },
    { x0: 8, z0: 340, x1: 8, z1: -340 },
    { x0: -340, z0: 176, x1: 340, z1: 176 },
    { x0: 340, z0: 160, x1: -340, z1: 160 },
  ];
  const cars: Car[] = [];
  {
    const r = mkRng(8),
      n = [3, 6, 9][QL] || 6;
    for (let k = 0; k < n; k++) {
      const g = new THREE.Group(),
        b = new THREE.Mesh(carBodyG, new THREE.MeshStandardMaterial({ color: pick(r, carCols), roughness: 0.3, metalness: 0.5 })),
        c = new THREE.Mesh(cabG, glassM);
      b.position.y = 2.3;
      c.position.set(-0.6, 4.9, 0);
      b.castShadow = QL >= 1;
      g.add(b, c);
      for (const [wx, wz] of [
        [4.5, 3.2],
        [4.5, -3.2],
        [-4.5, 3.2],
        [-4.5, -3.2],
      ]) {
        const w = new THREE.Mesh(wheelG, tireM);
        w.rotation.x = Math.PI / 2;
        w.position.set(wx, 1.2, wz);
        g.add(w);
      }
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.6, 5), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2c0, emissiveIntensity: 0.2 }));
      hl.position.set(7.05, 2.6, 0);
      g.add(hl);
      signMs.push(hl.material as THREE.MeshStandardMaterial);
      S.add(g);
      cars.push({ g, lane: k % LANES.length, u: r(), v: 0, vmax: 28 + r() * 14 });
    }
  }

  // ---------------- people (player + NPCs) share the rig texture helper
  const rigOf = (lk: Look | any, lod: number) => makeRig({ n: lk.n, col: lk.col, skin: lk.sk || lk.skin, hr: lk.hr, bd: lk.bd, no: lk.no ?? "", ht: lk.ht, bk: lk.bk, tm: -1, sg: { gs: 0, ...(lk.hs >= 0 ? { hs: lk.hs } : {}) } }, TX, lod);
  const dropRig = (r: Rig | null) => {
    if (!r) return;
    S.remove(r.G);
    r.mesh.geometry.dispose();
    r.pmesh?.geometry.dispose();
    r.extra.forEach((m: any) => (m.map && m.map.dispose(), m.dispose()));
  };
  const me = mkBody("me", 1);
  let meRig: Rig | null = null,
    meLook = "";
  const P = { x: 0, z: 0, f: 0, vx: 0, vz: 0, sp: 0 };
  const shadowBlob = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!,
      gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(0,0,0,.45)");
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    return new THREE.MeshBasicMaterial({ map: TX(c), transparent: true, depthWrite: false });
  })();
  const blobG = new THREE.PlaneGeometry(3.4, 3.4);
  const blob = () => {
    const m = new THREE.Mesh(blobG, shadowBlob);
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.62;
    S.add(m);
    return m;
  };
  const meBlob = blob();
  function setLook(lk: Look) {
    const k = JSON.stringify(lk);
    if (k === meLook) return;
    meLook = k;
    dropRig(meRig);
    meRig = rigOf(lk, QL >= 2 ? 1 : 0);
    meRig.G.traverse((o: any) => o.isMesh && (o.castShadow = QL >= 1));
    S.add(meRig.G);
  }
  const npcs: Npc[] = [];
  const NPCN0 = opt.npc ?? ([6, 10, 14][QL] || 10);
  const npcR = mkRng(123);
  const IDLE: [number, number, Act][] = [
    [court.x - 6, court.z - 10, "shoot"],
    [court.x + 8, court.z + 4, "cheer"],
    [-150, -150, "phone"],
    [-142, -128, "talk"],
    [-158, -128, "talk"],
    [165, -82, "phone"],
    [100, 30, "lean"],
    [215, 30, "phone"],
  ];
  function addNpc() {
    const i = npcs.length,
      r = npcR,
      idl = i < IDLE.length && i % 2 === 1 ? IDLE[(i - 1) >> 1] : i >= NPCN0 - 3 && i - (NPCN0 - 3) + 4 < IDLE.length ? IDLE[i - (NPCN0 - 3) + 4] : null;
    const look = { n: pick(r, NPCN) + " " + i, col: pick(r, SHIRTS), sk: pick(r, SKN), hr: Math.floor(r() * 4), hs: -1, bd: r() < 0.25 ? 1 : 0, ht: 5.5 + r() * 1.1, bk: 0.92 + r() * 0.15, no: "" };
    const b = mkBody(look.n, i * 1.7);
    let x = 0,
      z = 0,
      path: number[] = [];
    if (idl) {
      x = idl[0];
      z = idl[1];
      b.act = idl[2];
    } else {
      let n0 = Math.floor(r() * NODES.length);
      path = [n0];
      for (let k = 0; k < 40; k++) {
        const nb = EDGES[n0].filter((v) => v !== path[path.length - 2]);
        n0 = pick(r, nb.length ? nb : EDGES[n0]);
        path.push(n0);
      }
      [x, z] = NODES[path[0]];
    }
    const n: Npc = { b, rig: null, look, path, seg: 0, x, z, f: r() * 6.28, spd: 4 + r() * 1.6, idle: idl ? idl[2] : undefined, talkT: 0, fan: r() };
    if (idl && idl[2] === "talk") n.f = i % 4 === 1 ? Math.PI / 2 : -Math.PI / 2;
    n.rig = rigOf(look, 0);
    S.add(n.rig.G);
    (n as any).blob = blob();
    npcs.push(n);
  }

  // ---------------- objective beacon
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 70, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  beacon.visible = false;
  S.add(beacon);
  const ring = new THREE.Mesh(new THREE.RingGeometry(3.2, 4, 32), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.8, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  S.add(ring);
  ring.visible = false;

  // ---------------- camera rig
  const camS = { yaw: 0, pitch: 0.3, dist: 18, manualT: 0, fov: 58 };
  const T = new THREE.Vector3(),
    CP = new THREE.Vector3(),
    TMP = new THREE.Vector3();
  function camHit(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, len: number) {
    let best = len;
    for (const b of boxes) {
      // slab test
      let t0 = 0,
        t1 = best;
      const ax = [
        [ox, dx, b.x0 - 0.8, b.x1 + 0.8],
        [oy, dy, -1, b.y1 + 0.8],
        [oz, dz, b.z0 - 0.8, b.z1 + 0.8],
      ];
      let hit = true;
      for (const [o, d, lo, hi] of ax) {
        if (Math.abs(d) < 1e-9) {
          if (o < lo || o > hi) {
            hit = false;
            break;
          }
          continue;
        }
        let a = (lo - o) / d,
          c = (hi - o) / d;
        if (a > c) [a, c] = [c, a];
        t0 = Math.max(t0, a);
        t1 = Math.min(t1, c);
        if (t0 > t1) {
          hit = false;
          break;
        }
      }
      if (hit && t0 > 0.3) best = Math.min(best, t0);
    }
    return best;
  }

  // ---------------- lighting by time of day
  const C_DAYTOP = new THREE.Color(0x3f7fd6),
    C_DAYHOR = new THREE.Color(0xbcd8f2),
    C_DUSKTOP = new THREE.Color(0x3b3f7a),
    C_DUSKHOR = new THREE.Color(0xff9a5c),
    C_NIGHTTOP = new THREE.Color(0x05070f),
    C_NIGHTHOR = new THREE.Color(0x1b2440),
    top = new THREE.Color(),
    hor = new THREE.Color(),
    tmpC = new THREE.Color();
  let night = 0,
    lastMin = -1;
  function light(min: number) {
    // sun elevation: rises 6:00, peaks 12:45, sets 19:30
    const u = (min - 360) / (19.5 * 60 - 360),
      el = Math.sin(Math.PI * Math.max(-0.25, Math.min(1.25, u))),
      day = Math.max(0, Math.min(1, el * 3 + 0.15)),
      dusk = Math.max(0, 1 - Math.abs(el) * 4) * (u > -0.2 && u < 1.2 ? 1 : 0);
    night = 1 - day;
    lerpC(C_NIGHTTOP, C_DAYTOP, day, top);
    lerpC(C_NIGHTHOR, C_DAYHOR, day, hor);
    top.lerp(C_DUSKTOP, dusk * 0.5);
    hor.lerp(C_DUSKHOR, dusk * 0.7);
    const pos = skyG.attributes.position as THREE.BufferAttribute,
      col = skyG.attributes.color as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 1000,
        k = Math.pow(Math.max(0, y), 0.55);
      tmpC.copy(hor).lerp(top, k);
      if (y < 0) tmpC.copy(hor).multiplyScalar(0.8);
      col.setXYZ(i, tmpC.r, tmpC.g, tmpC.b);
    }
    col.needsUpdate = true;
    (S.fog as THREE.Fog).color.copy(hor);
    const az = (u - 0.5) * Math.PI * 0.9;
    const sx = Math.sin(az) * 400,
      sy = Math.max(-200, el * 420),
      sz = -Math.cos(az) * 220;
    sun.position.set(sx, sy, sz).normalize().multiplyScalar(900);
    sun.visible = el > -0.1;
    moon.position.set(-sx, Math.max(120, -sy + 200), -sz).normalize().multiplyScalar(900);
    moon.visible = night > 0.5;
    key.color.setHSL(0.1, 0.6 * dusk + 0.2, 0.5 + 0.45 * day);
    key.intensity = night > 0.85 ? 0.35 : 0.3 + 2.4 * day;
    key.userData.dir = night > 0.85 ? new THREE.Vector3(-sx, 300, -sz).normalize() : new THREE.Vector3(sx, Math.max(60, sy), sz).normalize();
    if (night > 0.85) key.color.set(0x8ea6d8);
    hemi.intensity = 0.25 + 1.2 * day;
    hemi.color.copy(top).lerp(new THREE.Color(0xffffff), 0.5);
    S.environmentIntensity = 0.15 + 0.6 * day;
    starM.opacity = Math.max(0, night - 0.4) * 1.4;
    const wn = Math.max(0, night - 0.2) * 1.25;
    for (const m of wallMs) m.emissiveIntensity = wn * 1.6;
    for (const m of signMs) m.emissiveIntensity = 0.15 + wn * 1.8;
    bulbM.emissiveIntensity = wn * 6;
    glowM.opacity = wn * 0.9;
    poolM.opacity = wn * 0.35;
    R.toneMappingExposure = 0.95 + night * 0.25;
  }

  // ---------------- per-frame
  let tSec = 0,
    lastFrame = performance.now(),
    fps = 60;
  const W3x = (x: number) => 470 + x * 10,
    W3z = (z: number) => 250 + z * 10;
  function place(b: Body, rig: Rig, x: number, z: number, f: number, dt: number, sit = 0) {
    b.x = W3x(x);
    b.y = W3z(z);
    b.f = f;
    applyPose(rig, b);
    rig.G.position.y -= sit;
    clothStep(rig, b, dt);
  }
  /** Move the player with a camera-relative stick; returns metres moved. Collision vs footprints + trees. */
  function move(dt: number, st: Stick, speedK: number) {
    const fx = -Math.sin(camS.yaw),
      fz = -Math.cos(camS.yaw),
      rx = Math.cos(camS.yaw),
      rz = -Math.sin(camS.yaw);
    let dx = fx * st.mz + rx * st.mx,
      dz = fz * st.mz + rz * st.mx;
    const l = Math.hypot(dx, dz),
      m = Math.min(1, l);
    if (l > 0.01) (dx /= l), (dz /= l);
    const vmax = (st.sprint ? 16 : 6.5) * m * speedK,
      tvx = dx * vmax,
      tvz = dz * vmax,
      a = Math.min(1, dt * (m > 0.01 ? 8 : 12));
    P.vx += (tvx - P.vx) * a;
    P.vz += (tvz - P.vz) * a;
    const nx = P.x + P.vx * dt,
      nz = P.z + P.vz * dt,
      hitTree = (x: number, z: number) => treeP.some(([tx, tz, s]) => Math.abs(tx - x) < 1.6 * s && Math.abs(tz - z) < 1.6 * s && Math.hypot(tx - x, tz - z) < 1.3 * s + 0.9);
    if (!blocked(nx, P.z) && !hitTree(nx, P.z)) P.x = nx;
    else P.vx *= 0.2;
    if (!blocked(P.x, nz) && !hitTree(P.x, nz)) P.z = nz;
    else P.vz *= 0.2;
    P.sp = Math.hypot(P.vx, P.vz);
    if (P.sp > 0.6) {
      const tf = Math.atan2(P.vz, P.vx);
      let d = tf - P.f;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      P.f += d * Math.min(1, dt * 10);
    }
    return P.sp * dt;
  }
  function stepCars(dt: number) {
    for (const c of cars) {
      const L = LANES[c.lane],
        len = Math.hypot(L.x1 - L.x0, L.z1 - L.z0),
        dx = (L.x1 - L.x0) / len,
        dz = (L.z1 - L.z0) / len;
      const x = L.x0 + (L.x1 - L.x0) * c.u,
        z = L.z0 + (L.z1 - L.z0) * c.u;
      // brake for the player (or anybody) in front
      const ahead = (px: number, pz: number) => {
        const rx = px - x,
          rz = pz - z,
          along = rx * dx + rz * dz,
          side = Math.abs(-rx * dz + rz * dx);
        return along > 0 && along < 26 && side < 6;
      };
      let stop = ahead(P.x, P.z);
      for (const o of cars) if (o !== c && o.lane === c.lane && o.u > c.u && (o.u - c.u) * len < 22) stop = true;
      c.v += ((stop ? 0 : c.vmax) - c.v) * Math.min(1, dt * (stop ? 4 : 0.8));
      c.u += (c.v * dt) / len;
      if (c.u > 1) (c.u -= 1), (c.lane = (c.lane + 2) % LANES.length);
      c.g.position.set(x, 0, z);
      c.g.rotation.y = -Math.atan2(dz, dx);
    }
  }
  function stepNpcs(dt: number, fame: number) {
    if (npcs.length < NPCN0 && tSec > 0.4) addNpc();
    for (const n of npcs) {
      let sp = 0;
      const dP = Math.hypot(P.x - n.x, P.z - n.z);
      if (n.talkT > 0) {
        n.talkT -= dt;
        n.f = Math.atan2(P.z - n.z, P.x - n.x);
        n.b.act = n.talkT > 0 ? (n.fan < fame ? "wave" : "talk") : n.idle || "";
      } else if (n.path.length) {
        const tgt = NODES[n.path[(n.seg + 1) % n.path.length]],
          dx = tgt[0] - n.x,
          dz = tgt[1] - n.z,
          d = Math.hypot(dx, dz);
        // step around the player
        const avoid = dP < 3.5 ? 0.5 : 1;
        if (d < 1) n.seg = (n.seg + 1) % (n.path.length - 1);
        else {
          sp = n.spd * avoid;
          n.x += (dx / d) * sp * dt;
          n.z += (dz / d) * sp * dt;
          let df = Math.atan2(dz, dx) - n.f;
          df = Math.atan2(Math.sin(df), Math.cos(df));
          n.f += df * Math.min(1, dt * 6);
        }
        if (dP < 3) {
          // shove sideways
          const ax = n.x - P.x,
            az = n.z - P.z,
            l = Math.hypot(ax, az) || 1;
          n.x += (ax / l) * (3 - dP) * 0.5;
          n.z += (az / l) * (3 - dP) * 0.5;
        }
      }
      n.b.sp = sp;
      const near = dP < 90;
      if (!n.rig) continue;
      n.rig.G.visible = near || dP < 220;
      (n as any).blob.position.set(n.x, 0.62, n.z);
      if (!n.rig.G.visible) continue;
      if (near || (tSec * 10 + n.b.seed) % 3 < 1) {
        animate(n.b, dt, tSec);
        place(n.b, n.rig, n.x, n.z, n.f, dt);
      }
    }
  }
  let last = { min: 0 };
  return {
    R,
    S,
    cam,
    camS,
    P,
    me,
    npcs,
    setLook,
    nearestNpc(r = 6): Npc | null {
      let best: Npc | null = null,
        bd = r;
      for (const n of npcs) {
        const d = Math.hypot(n.x - P.x, n.z - P.z);
        if (d < bd) (bd = d), (best = n);
      }
      return best;
    },
    talk(n: Npc) {
      n.talkT = 3.2;
    },
    /** Teleport the player (spawn, leaving a building, fast travel): outside the door, facing away from it. */
    put(x: number, z: number, f: number) {
      P.x = x;
      P.z = z;
      P.f = f;
      P.vx = P.vz = 0;
      camS.yaw = Math.atan2(-Math.cos(f), -Math.sin(f));
    },
    orbit(dx: number, dy: number) {
      camS.yaw -= dx * 0.006;
      camS.pitch = Math.max(0.05, Math.min(1.2, camS.pitch + dy * 0.004));
      camS.manualT = 2.5;
    },
    zoom(d: number) {
      camS.dist = Math.max(7, Math.min(32, camS.dist * (1 + d * 0.001)));
    },
    beacon(x: number | null, z = 0) {
      beacon.visible = ring.visible = x != null;
      if (x != null) {
        beacon.position.set(x, 35, z);
        ring.position.set(x, 0.7, z);
      }
    },
    resize(w: number, h: number) {
      R.setSize(w, h, false);
      cam.aspect = w / Math.max(1, h);
      cam.updateProjectionMatrix();
    },
    /** One frame: move, animate, light, camera. st = stick; min = minute of day; act = the player's activity pose. */
    frame(dt: number, st: Stick, min: number, o: { speedK: number; act: Act; fame: number; frozen?: boolean }) {
      tSec += dt;
      const now = performance.now();
      fps += (1000 / Math.max(1, now - lastFrame) - fps) * 0.05;
      lastFrame = now;
      if (!o.frozen) move(dt, st, o.speedK);
      else (P.vx = P.vz = 0), (P.sp = 0);
      if (Math.abs(min - lastMin) >= 1) (lastMin = min), light(min);
      stepCars(dt);
      stepNpcs(dt, o.fame);
      if (meRig) {
        me.sp = P.sp;
        me.act = o.act;
        animate(me, dt, tSec);
        place(me, meRig, P.x, P.z, P.f, dt);
        meBlob.position.set(P.x, 0.62, P.z);
      }
      // camera: auto-follow behind the player when moving and not orbited recently
      camS.manualT -= dt;
      if (camS.manualT <= 0 && P.sp > 2) {
        const want = Math.atan2(-Math.cos(P.f), -Math.sin(P.f));
        let d = want - camS.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        camS.yaw += d * Math.min(1, dt * 1.2);
      }
      const D = camS.dist;
      T.set(P.x, 5.4, P.z);
      const dx = Math.sin(camS.yaw) * Math.cos(camS.pitch),
        dy = Math.sin(camS.pitch),
        dz = Math.cos(camS.yaw) * Math.cos(camS.pitch);
      const hit = camHit(T.x, T.y, T.z, dx, dy, dz, D);
      CP.set(T.x + dx * (hit - 0.6), Math.max(1.2, T.y + dy * (hit - 0.6)), T.z + dz * (hit - 0.6));
      cam.position.lerp(CP, Math.min(1, dt * 12));
      if (cam.position.distanceTo(CP) > 30) cam.position.copy(CP);
      cam.lookAt(T);
      // shadows follow the player
      const sd = key.userData.dir || TMP.set(0.4, 0.8, 0.3);
      key.position.set(P.x + sd.x * 200, sd.y * 200, P.z + sd.z * 200);
      key.target.position.set(P.x, 0, P.z);
      sky.position.copy(cam.position);
      if (beacon.visible) (beacon.material as THREE.MeshBasicMaterial).opacity = 0.16 + Math.sin(tSec * 3) * 0.06;
      last.min = min;
    },
    render() {
      R.render(S, cam);
    },
    fps: () => fps,
    night: () => night,
    project(x: number, y: number, z: number) {
      const v = TMP.set(x, y, z).project(cam);
      return [(v.x + 1) / 2, (1 - v.y) / 2, v.z];
    },
    dispose() {
      R.dispose();
      R.forceContextLoss();
    },
  };
}
export type World = ReturnType<typeof createWorld>;
