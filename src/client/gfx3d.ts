// Graphics v6 building blocks for render3d.ts (three.js; portable WebGL / WebGPU materials, no ShaderMaterial except
// the WebGL-only onBeforeCompile patches, which WebGPU simply ignores):
//  - arenaEnv / skyEnv: procedural HDR environment scenes for PMREM (the arena's catwalk light grid, dark bowl, LED
//    fascia, warm floor bounce; the street sky per weather) - the "baked" ambient + reflections on every surface
//  - bowl(): upper deck tiers + fascia, aisles + stairs, rails, roof trusses + catwalk, dark arena shell with a lit
//    suite ring and tunnel portals
//  - scorer's table, baseline photographers
//  - pyro + smoke (intros / final buzzer), kiss cam / dance cam painting for the jumbotron
//  - weather (street courts): day / sunset / night / rain / snow with sky dome, lamps, rain + snow particles, wet
//    asphalt with puddles (mirror reflections where the Reflector is on), snow cover
//  - detail(): multiply a tiled detail texture into a material's map (wood grain under the court paint)
import * as THREE from "three";

export const PI = Math.PI;
const vtxGrad = (g: THREE.BufferGeometry, f: (y: number, x: number, z: number) => THREE.Color) => {
  const p = g.attributes.position,
    c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const k = f(p.getY(i), p.getX(i), p.getZ(i));
    c[i * 3] = k.r;
    c[i * 3 + 1] = k.g;
    c[i * 3 + 2] = k.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(c, 3));
  return g;
};
const hdr = (hex: number, k: number) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k) });

// ---------------------------------------------------------------- environments (PMREM sources)
/** The arena as the floor / glass / skin "see" it: a dark bowl, the catwalk grid of light panels overhead, the LED
 *  fascia ring in the home colour, a warm bounce from the court. */
export function arenaEnv(home: string) {
  const s = new THREE.Scene();
  const shell = new THREE.Mesh(
    vtxGrad(new THREE.SphereGeometry(60, 24, 16), (y) => new THREE.Color(0x0a0c16).lerp(new THREE.Color(0x1a1610), Math.max(0, -y / 60))),
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })
  );
  s.add(shell);
  // catwalk light grid: 3 x 6 bright panels overhead + softer panels around them
  const hot = hdr(0xfff3e0, 6.5),
    soft = hdr(0xe8eeff, 3.5);
  for (let i = -2; i <= 2; i++)
    for (let j = -1; j <= 1; j++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(5, 3), Math.abs(i) < 2 ? hot : soft);
      m.position.set(i * 9, 40, j * 9);
      m.rotation.x = PI / 2;
      s.add(m);
    }
  // LED fascia ring (home colour) at the deck break
  const led = new THREE.Mesh(new THREE.CylinderGeometry(52, 52, 2.5, 48, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(home).multiplyScalar(1.6), side: THREE.BackSide }));
  led.position.y = 14;
  s.add(led);
  // warm court bounce
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(40, 22), hdr(0xd99a5a, 0.9));
  fl.rotation.x = -PI / 2;
  fl.position.y = -3;
  s.add(fl);
  return s;
}
export type Wx = "day" | "sunset" | "night" | "rain" | "snow";
/** Sky palettes: zenith, horizon, ground, sun colour, sun elevation (rad), sun intensity, hemi, exposure, fog far */
export const SKY: Record<Wx, { z: number; h: number; g: number; sun: number; el: number; az: number; si: number; hi: number; ex: number; fog: number; lamps: number }> = {
  day: { z: 0x3f78c8, h: 0xb9d4ee, g: 0x4a4a46, sun: 0xfff1dc, el: 0.95, az: 0.6, si: 1.3, hi: 0.55, ex: 0.85, fog: 260, lamps: 0 },
  sunset: { z: 0x2b2f6e, h: 0xff9a5c, g: 0x3a2a26, sun: 0xffa45e, el: 0.2, az: -0.4, si: 1.05, hi: 0.3, ex: 0.95, fog: 230, lamps: 0.35 },
  night: { z: 0x03050d, h: 0x1a2236, g: 0x0b0b0d, sun: 0x9fb4ff, el: 0.9, az: 1.2, si: 0.07, hi: 0.07, ex: 1.15, fog: 170, lamps: 1 },
  rain: { z: 0x4a525e, h: 0x8b939d, g: 0x2a2c30, sun: 0xd6dde6, el: 1.1, az: 0.3, si: 0.35, hi: 0.42, ex: 0.95, fog: 120, lamps: 0.6 },
  snow: { z: 0x8c97a6, h: 0xd5dbe2, g: 0x9aa0a8, sun: 0xf0f4ff, el: 0.8, az: 0.2, si: 0.55, hi: 0.6, ex: 0.85, fog: 110, lamps: 0.3 },
};
export function skyEnv(w: Wx) {
  const k = SKY[w],
    s = new THREE.Scene();
  const zc = new THREE.Color(k.z),
    hc = new THREE.Color(k.h),
    gc = new THREE.Color(k.g);
  s.add(new THREE.Mesh(vtxGrad(new THREE.SphereGeometry(60, 24, 16), (y) => (y >= 0 ? hc.clone().lerp(zc, Math.pow(y / 60, 0.6)) : hc.clone().lerp(gc, Math.min(1, -y / 12)))), new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const sun = new THREE.Mesh(new THREE.SphereGeometry(w === "night" ? 1.5 : 4, 12, 8), hdr(k.sun, w === "night" ? 6 : w === "day" ? 40 : 16));
  sun.position.set(Math.cos(k.el) * Math.cos(k.az) * 50, Math.sin(k.el) * 50, Math.cos(k.el) * Math.sin(k.az) * 50);
  s.add(sun);
  if (k.lamps > 0.3)
    for (const [x, z] of [
      [-30, -32],
      [30, -32],
      [-30, 32],
      [30, 32],
    ]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.6, 1.2), hdr(0xffd9a0, 12 * k.lamps));
      l.position.set(x * 0.6, 20, z * 0.6);
      s.add(l);
    }
  return s;
}

// ---------------------------------------------------------------- the bowl
export type Tier = [number, number, number, number, number]; // x, y, z, w, d (box centre / size)
/** Row geometry shared by the tiers and the crowd: lower bowl rows 0..11, a fascia break, upper deck 12..ROWS-1. */
export const ROWS = 20;
export const rowY = (r: number) => 0.6 + r * 1.15 + (r >= 12 ? 2.6 + (r - 12) * 0.35 : 0);
export const rowOff = (r: number) => 3.2 + r * 1.6 + (r >= 12 ? 2.2 + (r - 12) * 0.3 : 0);
/** Aisles: crowd x (sidelines) / z (baselines) positions that stay empty (stairs drawn there). */
export const AISLE_X = [-42, -14, 14, 42];
export const AISLE_Z = [-14, 14];
export const inAisle = (sd: number, v: number) => (sd < 2 ? AISLE_X : AISLE_Z).some((a) => Math.abs(v - a) < 1.6);

export function bowl(S: THREE.Scene, ARENA: THREE.Object3D[], led: THREE.Material, home: string) {
  const add = (o: THREE.Object3D) => (S.add(o), ARENA.push(o), o);
  const dm = new THREE.Object3D();
  // stairs in the aisles (lighter concrete, step lights on the front rows)
  const stG = new THREE.BoxGeometry(1, 1, 1),
    stM = new THREE.MeshStandardMaterial({ color: 0x3a3e4c, roughness: 0.9 }),
    st: number[][] = [];
  for (let r = 0; r < ROWS; r++) {
    const y = rowY(r),
      off = rowOff(r);
    for (const a of AISLE_X) for (const s of [-1, 1]) st.push([a, y / 2 + 0.02, s * (25 + off), 2.6, y, 1.62]);
    for (const a of AISLE_Z) for (const s of [-1, 1]) st.push([s * (47 + off), y / 2 + 0.02, a, 1.62, y, 2.6]);
  }
  const stI = new THREE.InstancedMesh(stG, stM, st.length);
  st.forEach((t, i) => {
    dm.position.set(t[0], t[1], t[2]);
    dm.scale.set(t[3], t[4], t[5]);
    dm.updateMatrix();
    stI.setMatrixAt(i, dm.matrix);
  });
  stI.receiveShadow = true;
  add(stI);
  // rails: front of the lower bowl, the deck break, and along every aisle
  const rM = new THREE.MeshStandardMaterial({ color: 0x9aa3b4, metalness: 0.85, roughness: 0.3 }),
    rails: number[][] = [];
  for (const r of [0, 12]) {
    const y = rowY(r) + (r ? 0.2 : 1.6),
      off = rowOff(r) - 0.9,
      w = 94 + 2 * off,
      d = 50 + 2 * off;
    rails.push([0, y, -(25 + off), w, 0.08, 0.08], [0, y, 25 + off, w, 0.08, 0.08], [-(47 + off), y, 0, 0.08, 0.08, d], [47 + off, y, 0, 0.08, 0.08, d]);
  }
  const rI = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), rM, rails.length);
  rails.forEach((t, i) => {
    dm.position.set(t[0], t[1], t[2]);
    dm.scale.set(t[3], t[4], t[5]);
    dm.updateMatrix();
    rI.setMatrixAt(i, dm.matrix);
  });
  add(rI);
  // fascia LED band at the deck break (replaces the floating ring) + a dark facing above/below it
  // on the front face of the first upper-deck step (its box starts half a step in front of the row line)
  const fy = rowY(12) - 1.6,
    fo = rowOff(12) - (rowOff(12) - rowOff(11) + 0.02) / 2 - 0.08;
  const fas: THREE.Mesh[] = [];
  for (const [x, z, ry, w] of [
    [0, -(25 + fo), 0, 94 + 2 * fo],
    [0, 25 + fo, PI, 94 + 2 * fo],
    [-(47 + fo), 0, PI / 2, 50 + 2 * fo],
    [47 + fo, 0, -PI / 2, 50 + 2 * fo],
  ] as const) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.5), led);
    m.position.set(x, fy, z);
    m.rotation.y = ry;
    add(m);
    fas.push(m);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(w, 3.4), new THREE.MeshStandardMaterial({ color: 0x0b0d16, roughness: 0.6 }));
    back.position.set(x - Math.sin(ry) * 0.05, fy - 0.2, z - Math.cos(ry) * 0.05);
    back.rotation.y = ry;
    add(back);
  }
  // arena shell: dark walls + roof (vertex gradient), so there is no black void above the crowd
  const shell = new THREE.Mesh(
    vtxGrad(new THREE.BoxGeometry(200, 64, 150, 1, 4, 1), (y) => new THREE.Color(0x1c2234).lerp(new THREE.Color(0x07080f), Math.min(1, Math.max(0, (y + 10) / 40)))),
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false })
  );
  shell.position.y = 30;
  add(shell);
  // suite ring: a band of warm lit windows behind the upper deck
  {
    const c = document.createElement("canvas");
    c.width = 1024;
    c.height = 32;
    const x = c.getContext("2d")!;
    x.fillStyle = "#06070c";
    x.fillRect(0, 0, 1024, 32);
    for (let i = 0; i < 64; i++) {
      const lit = (i * 37) % 7 !== 0;
      x.fillStyle = lit ? `hsl(${28 + ((i * 13) % 20)},${45 + ((i * 11) % 30)}%,${38 + ((i * 7) % 22)}%)` : "#141620";
      x.fillRect(i * 16 + 2, 6, 12, 20);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    const sm = new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(0.9, 0.85, 0.8) });
    const sy = rowY(ROWS - 1) + 3.5,
      so = rowOff(ROWS - 1) + 3;
    for (const [x2, z, ry, w] of [
      [0, -(25 + so), 0, 94 + 2 * so],
      [0, 25 + so, PI, 94 + 2 * so],
      [-(47 + so), 0, PI / 2, 50 + 2 * so],
      [47 + so, 0, -PI / 2, 50 + 2 * so],
    ] as const) {
      const tt = t.clone();
      tt.repeat.set(w / 40, 1);
      tt.needsUpdate = true;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 2.2), new THREE.MeshBasicMaterial({ map: tt, color: sm.color }));
      m.position.set(x2, sy, z);
      m.rotation.y = ry;
      add(m);
    }
  }
  // tunnel portals in the four corners (lit tunnel glow)
  const pM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x2a2418).multiplyScalar(1.4) });
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(7, 4.4), pM);
      m.position.set(sx * 52, 2.2, sz * 30.2);
      m.rotation.y = Math.atan2(-sx, -sz);
      add(m);
    }
  // roof trusses + catwalk (instanced beams)
  const beams: number[][] = [];
  for (let i = -5; i <= 5; i++) beams.push([i * 14, 46, 0, 0.6, 1.4, 130]);
  for (let j = -3; j <= 3; j++) beams.push([0, 47.2, j * 16, 180, 0.6, 0.6]);
  beams.push([0, 38.5, -14, 110, 0.25, 1.2], [0, 38.5, 14, 110, 0.25, 1.2]); // catwalks
  const bI = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x1c1f28, metalness: 0.6, roughness: 0.6 }), beams.length);
  beams.forEach((t, i) => {
    dm.position.set(t[0], t[1], t[2]);
    dm.scale.set(t[3], t[4], t[5]);
    dm.updateMatrix();
    bI.setMatrixAt(i, dm.matrix);
  });
  add(bI);
  void home;
  return { fascia: fas };
}

// ---------------------------------------------------------------- scorer's table + photographers
export function scorerTable(S: THREE.Scene, ARENA: THREE.Object3D[], led: THREE.Material) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(11, 2.4, 2), new THREE.MeshStandardMaterial({ color: 0x14161f, roughness: 0.4, metalness: 0.2 }));
  body.position.y = 1.2;
  body.castShadow = body.receiveShadow = true;
  const top = new THREE.Mesh(new THREE.BoxGeometry(11.4, 0.12, 2.4), new THREE.MeshStandardMaterial({ color: 0x2b2f3a, roughness: 0.25, metalness: 0.4 }));
  top.position.y = 2.46;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(10.6, 1.5), led);
  face.position.set(0, 1.25, 1.01);
  g.add(body, top, face);
  // three officials behind it
  const sk = [0x8d5524, 0xe0ac69, 0xc68642];
  for (let k = 0; k < 3; k++) {
    const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.6, 3, 8), new THREE.MeshStandardMaterial({ color: k === 1 ? 0x1b2340 : 0x22252e, roughness: 0.8 }));
    b.position.set(-3 + k * 3, 2.75, -0.95);
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 8), new THREE.MeshStandardMaterial({ color: sk[k], roughness: 0.6 }));
    h.position.set(-3 + k * 3, 3.55, -0.95);
    b.castShadow = true;
    g.add(b, h);
  }
  g.position.set(0, 0, -26.2);
  S.add(g);
  ARENA.push(g);
  return g;
}
/** Kneeling baseline photographers (2 per baseline) + a sideline camera operator on a dolly. */
export function photographers(S: THREE.Scene, ARENA: THREE.Object3D[]) {
  const spots: [number, number, number][] = [
    [-50.2, -9, 1],
    [-50.2, 11, 1],
    [50.2, -11, -1],
    [50.2, 9, -1],
  ];
  const n = spots.length + 1,
    dm = new THREE.Object3D(),
    body = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.34, 0.5, 3, 8), new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.85 }), n),
    head = new THREE.InstancedMesh(new THREE.SphereGeometry(0.24, 12, 8), new THREE.MeshStandardMaterial({ color: 0xc68642, roughness: 0.6 }), n),
    cam = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.42, 0.9), new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.35, metalness: 0.5 }), n),
    lens = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.18, 0.7, 12).rotateZ(PI / 2), new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.4, metalness: 0.3 }), n);
  const put = (i: number, x: number, z: number, f: number, y0: number) => {
    dm.rotation.set(0, f > 0 ? 0 : PI, 0);
    dm.position.set(x, y0 + 0.7, z);
    dm.updateMatrix();
    body.setMatrixAt(i, dm.matrix);
    dm.position.set(x + f * 0.1, y0 + 1.45, z);
    dm.updateMatrix();
    head.setMatrixAt(i, dm.matrix);
    dm.position.set(x + f * 0.45, y0 + 1.4, z + 0.25);
    dm.updateMatrix();
    cam.setMatrixAt(i, dm.matrix);
    dm.position.set(x + f * 0.95, y0 + 1.4, z + 0.25);
    dm.updateMatrix();
    lens.setMatrixAt(i, dm.matrix);
  };
  spots.forEach(([x, z, f], i) => put(i, x, z, f, 0));
  put(spots.length, 28, 28.6, -1, 0.8); // sideline dolly (beyond the courtside row)
  for (const m of [body, head, cam, lens]) {
    m.castShadow = true;
    S.add(m);
    ARENA.push(m);
  }
}

// ---------------------------------------------------------------- pyro + smoke
/** Fire jets + smoke from four baseline cannons: instanced camera-facing quads (additive), CPU-updated only while
 *  something is alive. fire() starts a burst; update(dt, cam). */
export function makePyro(S: THREE.Scene) {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d")!,
    g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(255,255,255,.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  const N = 360,
    mk = (op: number) => {
      const m = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: op, toneMapped: true }), N);
      m.frustumCulled = false;
      m.count = 0;
      m.renderOrder = 6;
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
      S.add(m);
      return m;
    };
  const fire = mk(1),
    smoke = mk(0.5);
  type Pt = { x: number; y: number; z: number; vx: number; vy: number; vz: number; t: number; L: number; s: number; k: 0 | 1 };
  const pts: Pt[] = [];
  const dm = new THREE.Object3D(),
    col = new THREE.Color();
  let jet = 0;
  const CAN = [
    [-46, -22],
    [-46, 22],
    [46, -22],
    [46, 22],
  ];
  return {
    get active() {
      return jet > 0 || pts.length > 0;
    },
    fire(sec = 1.6) {
      jet = Math.max(jet, sec);
    },
    update(dt: number, cam: THREE.Camera) {
      if (jet > 0) {
        jet -= dt;
        for (const [cx, cz] of CAN)
          for (let k = 0; k < 3 && pts.length < N - 8; k++) {
            pts.push({ x: cx + (Math.random() - 0.5) * 0.6, y: 0.5, z: cz + (Math.random() - 0.5) * 0.6, vx: (Math.random() - 0.5) * 2, vy: 22 + Math.random() * 10, vz: (Math.random() - 0.5) * 2, t: 0, L: 0.7 + Math.random() * 0.4, s: 1.6, k: 0 });
            if (Math.random() < 0.35) pts.push({ x: cx, y: 2 + Math.random() * 8, z: cz, vx: (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 2, vz: (Math.random() - 0.5) * 3, t: 0, L: 2.5 + Math.random() * 1.5, s: 3, k: 1 });
          }
      }
      let nf = 0,
        ns = 0;
      for (let i = pts.length - 1; i >= 0; i--) {
        const p = pts[i];
        p.t += dt;
        if (p.t > p.L) {
          pts.splice(i, 1);
          continue;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        p.vy *= p.k ? 0.99 : 0.96;
        const u = p.t / p.L;
        dm.position.set(p.x, p.y, p.z);
        dm.quaternion.copy(cam.quaternion);
        dm.scale.setScalar(p.s * (p.k ? 1 + u * 2.5 : 1 - u * 0.6));
        dm.updateMatrix();
        if (p.k) {
          col.setRGB(0.22, 0.22, 0.25).multiplyScalar(1 - u);
          smoke.setMatrixAt(ns, dm.matrix);
          smoke.setColorAt(ns++, col);
        } else {
          col.setRGB(4, 1.6 + (1 - u) * 1.8, 0.4 + (1 - u) * 0.9).multiplyScalar(1 - u * u); // HDR: blooms
          fire.setMatrixAt(nf, dm.matrix);
          fire.setColorAt(nf++, col);
        }
      }
      fire.count = nf;
      smoke.count = ns;
      for (const m of [fire, smoke]) {
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    },
    set visible(v: boolean) {
      fire.visible = smoke.visible = v;
    },
  };
}

// ---------------------------------------------------------------- jumbotron features
/** KISS CAM / DANCE CAM (fictional cartoon fans, procedural): paints the whole jumbotron face. */
export function drawFanCam(c: CanvasRenderingContext2D, kind: "kiss" | "dance", t: number, col: string) {
  const W = 1024,
    H = 512;
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#1a1030");
  g.addColorStop(1, "#05040a");
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  // blurred crowd behind
  for (let i = 0; i < 40; i++) {
    const x = ((i * 97) % 1100) - 40,
      y = 300 + ((i * 53) % 120);
    c.fillStyle = `hsla(${(i * 47) % 360},40%,${25 + (i % 5) * 6}%,.8)`;
    c.beginPath();
    c.arc(x, y, 34, 0, 6.3);
    c.fill();
    c.fillRect(x - 40, y + 20, 80, 200);
  }
  const fan = (x: number, y: number, skin: string, shirt: string, hair: string, lean: number, arms: number) => {
    c.save();
    c.translate(x, y);
    c.rotate(lean);
    c.fillStyle = shirt;
    c.beginPath();
    c.roundRect(-75, 40, 150, 220, 50);
    c.fill();
    // arms
    c.strokeStyle = skin;
    c.lineWidth = 26;
    c.lineCap = "round";
    for (const s of [-1, 1]) {
      c.beginPath();
      c.moveTo(s * 62, 70);
      c.lineTo(s * (90 + arms * 20), 70 - arms * 130);
      c.stroke();
    }
    c.fillStyle = skin;
    c.beginPath();
    c.arc(0, 0, 58, 0, 6.3);
    c.fill();
    c.fillStyle = hair;
    c.beginPath();
    c.arc(0, -14, 60, PI, 0);
    c.fill();
    c.fillStyle = "#111";
    c.beginPath();
    c.arc(-20, 2, 6, 0, 6.3);
    c.arc(20, 2, 6, 0, 6.3);
    c.fill();
    c.strokeStyle = "#5a1d1d";
    c.lineWidth = 5;
    c.beginPath();
    c.arc(0, 18, 18, 0.2, PI - 0.2);
    c.stroke();
    c.restore();
  };
  if (kind === "kiss") {
    const k = Math.min(1, Math.max(0, Math.sin(t * 0.8) * 1.4));
    fan(400 + k * 28, 230, "#c68642", col, "#2a1a10", 0.08 + k * 0.12, 0);
    fan(624 - k * 28, 236, "#f1c27d", "#e9e9ef", "#7a4a1a", -0.08 - k * 0.12, 0);
    // heart frame
    c.strokeStyle = "#ff4d8d";
    c.lineWidth = 14;
    c.beginPath();
    const hx = 512,
      hy = 250,
      r = 230 + Math.sin(t * 5) * 6;
    c.moveTo(hx, hy + r * 0.8);
    c.bezierCurveTo(hx - r * 1.6, hy - r * 0.1, hx - r * 0.7, hy - r * 1.1, hx, hy - r * 0.45);
    c.bezierCurveTo(hx + r * 0.7, hy - r * 1.1, hx + r * 1.6, hy - r * 0.1, hx, hy + r * 0.8);
    c.stroke();
  } else {
    const b = Math.sin(t * 7);
    fan(512, 240 + Math.abs(b) * 18, "#8d5524", col, "#111", b * 0.18, 0.5 + 0.5 * Math.sin(t * 7 + 1));
  }
  c.fillStyle = kind === "kiss" ? "#ff4d8d" : "#ffd23f";
  c.font = "italic 900 72px system-ui";
  c.textAlign = "center";
  c.fillText(kind === "kiss" ? "♥ KISS CAM ♥" : "DANCE CAM", 512, 80);
}

// ---------------------------------------------------------------- material helpers
/** Multiply a tiled detail texture (normalised by its own smallest mip = its average colour) into mat.map. */
export function detail(mat: THREE.MeshStandardMaterial, tex: THREE.Texture, rep: [number, number], k = 1) {
  const prev = mat.onBeforeCompile;
  const u = { h2kDet: { value: tex }, h2kRep: { value: new THREE.Vector2(rep[0], rep[1]) }, h2kK: { value: k } };
  mat.onBeforeCompile = (sh: any, r: any) => {
    prev && prev.call(mat, sh, r);
    Object.assign(sh.uniforms, u);
    sh.fragmentShader = "uniform sampler2D h2kDet; uniform vec2 h2kRep; uniform float h2kK;\n" + sh.fragmentShader.replace("#include <map_fragment>", "#include <map_fragment>\n#ifdef USE_MAP\n{ vec3 dd = texture2D( h2kDet, vMapUv * h2kRep ).rgb, da = textureLod( h2kDet, vec2( .5 ), 14.0 ).rgb;\n  diffuseColor.rgb *= mix( vec3( 1.0 ), clamp( dd / max( da, vec3( .02 ) ), 0.0, 2.5 ), h2kK ); }\n#endif");
  };
  mat.customProgramCacheKey = () => "h2k-detail";
  mat.needsUpdate = true;
  return u;
}

// ---------------------------------------------------------------- street weather
/** Particles for rain (streaks) and snow (flakes) around the court; one InstancedMesh each, CPU-updated. */
export function makePrecip(S: THREE.Scene) {
  const NR = 1600,
    NS = 1400;
  const rain = new THREE.InstancedMesh(new THREE.BoxGeometry(0.018, 1.1, 0.018), new THREE.MeshBasicMaterial({ color: 0xc8d2de, transparent: true, opacity: 0.38, depthWrite: false }), NR);
  const snow = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.07, 0), new THREE.MeshBasicMaterial({ color: 0xf4f7fb }), NS);
  for (const m of [rain, snow]) {
    m.frustumCulled = false;
    m.count = 0;
    m.visible = false;
    S.add(m);
  }
  const rp = new Float32Array(NR * 3),
    sp = new Float32Array(NS * 4);
  const BX = 70,
    BZ = 46,
    BY = 34;
  for (let i = 0; i < NR; i++) (rp[i * 3] = (Math.random() - 0.5) * BX), (rp[i * 3 + 1] = Math.random() * BY), (rp[i * 3 + 2] = (Math.random() - 0.5) * BZ);
  for (let i = 0; i < NS; i++) (sp[i * 4] = (Math.random() - 0.5) * BX), (sp[i * 4 + 1] = Math.random() * BY), (sp[i * 4 + 2] = (Math.random() - 0.5) * BZ), (sp[i * 4 + 3] = Math.random() * 6.28);
  const dm = new THREE.Object3D();
  let t = 0;
  return {
    rain,
    snow,
    update(dt: number, kind: string, n: number) {
      t += dt;
      rain.visible = kind === "rain";
      snow.visible = kind === "snow";
      if (rain.visible) {
        const c = Math.min(NR, n);
        dm.rotation.set(0, 0, 0.08);
        for (let i = 0; i < c; i++) {
          let y = rp[i * 3 + 1] - dt * 70;
          if (y < 0) y += BY;
          rp[i * 3 + 1] = y;
          dm.position.set(rp[i * 3] + y * 0.08, y, rp[i * 3 + 2]);
          dm.updateMatrix();
          rain.setMatrixAt(i, dm.matrix);
        }
        rain.count = c;
        rain.instanceMatrix.needsUpdate = true;
      }
      if (snow.visible) {
        const c = Math.min(NS, n);
        dm.rotation.set(0, 0, 0);
        for (let i = 0; i < c; i++) {
          let y = sp[i * 4 + 1] - dt * 3.2;
          if (y < 0) y += BY;
          sp[i * 4 + 1] = y;
          const ph = sp[i * 4 + 3];
          dm.position.set(sp[i * 4] + Math.sin(t * 0.7 + ph) * 1.2, y, sp[i * 4 + 2] + Math.cos(t * 0.5 + ph) * 0.9);
          dm.updateMatrix();
          snow.setMatrixAt(i, dm.matrix);
        }
        snow.count = c;
        snow.instanceMatrix.needsUpdate = true;
      }
    },
  };
}
/** Puddle mask for the wet street (alpha: 1 asphalt, 0 puddle shows the mirror; green: roughness). */
export function puddleMaps() {
  const W = 512,
    H = 272;
  const a = document.createElement("canvas"),
    r = document.createElement("canvas");
  a.width = r.width = W;
  a.height = r.height = H;
  const ax = a.getContext("2d")!,
    rx = r.getContext("2d")!;
  ax.fillStyle = "#fff";
  ax.fillRect(0, 0, W, H);
  rx.fillStyle = "rgb(0,96,0)"; // wet asphalt ~.38
  rx.fillRect(0, 0, W, H);
  let sd = 5;
  const rn = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 46; i++) {
    const x = rn() * W,
      y = rn() * H,
      rr = 8 + rn() * 34,
      sx = 1 + rn() * 1.6;
    for (const [c, v] of [
      [ax, "0,0,0"],
      [rx, "0,10,0"],
    ] as const) {
      const g = c.createRadialGradient(x, y, 0, x, y, rr);
      g.addColorStop(0, `rgba(${v},1)`);
      g.addColorStop(0.65, `rgba(${v},.85)`);
      g.addColorStop(1, `rgba(${v},0)`);
      c.save();
      c.translate(x, y);
      c.scale(sx, 1);
      c.translate(-x, -y);
      c.fillStyle = g;
      c.beginPath();
      c.arc(x, y, rr, 0, 6.3);
      c.fill();
      c.restore();
    }
  }
  const at = new THREE.CanvasTexture(a),
    rt = new THREE.CanvasTexture(r);
  at.colorSpace = rt.colorSpace = THREE.NoColorSpace;
  return { alpha: at, rough: rt };
}
/** "auto" weather: the player's local time of day, a rainy / snowy day now and then (stable for the day). */
export function autoWx(): Wx {
  const d = new Date(),
    h = d.getHours() + d.getMinutes() / 60,
    doy = Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 0).getTime()) / 864e5),
    r = (doy * 2654435761) % 97,
    m = d.getMonth();
  if ((m === 11 || m <= 1) && r < 22) return "snow";
  if (r < 14) return "rain";
  return h >= 6.5 && h < 17.5 ? "day" : h >= 17.5 && h < 20 ? "sunset" : "night";
}
