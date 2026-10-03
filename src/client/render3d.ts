// three.js arena for the 3D modes: image-lit hardwood court, tiered stands with an instanced crowd, LED ribbons,
// jumbotron, glass backboards with shot clocks, tube nets driven by the net sim, skinned player rigs, cameras,
// post-processing, and an adaptive quality ladder that sheds effects before it ever lowers resolution.
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { P, B, T, pos, PC, sc, clock, shot, cl, q as qtrN, RPL, HXs, HY, W3, hoop, NETS } from "../core/sim";
import { gar, CP } from "./canvas";
import { V, fmt } from "./view";
import { makeRig, applyPose, footIK } from "./rig3d";
import { makeFx } from "./fx3d";

const DPR = [1, 1.5, 2]; // device pixel ratio cap per quality level

export function glInit(C: HTMLCanvasElement) {
  try {
    (THREE as any).ColorManagement && ((THREE as any).ColorManagement.legacyMode = false);
    const R = new THREE.WebGLRenderer({ canvas: C, antialias: true, powerPreference: "high-performance" });
    if (!R.getContext()) throw 0;
    const mob = matchMedia("(pointer:coarse)").matches;
    R.setPixelRatio(Math.min(devicePixelRatio || 1, DPR[V.QL]));
    R.setSize(960, 540, false);
    R.shadowMap.enabled = true;
    R.shadowMap.type = THREE.PCFSoftShadowMap;
    R.outputEncoding = THREE.sRGBEncoding;
    R.toneMapping = THREE.ACESFilmicToneMapping;
    R.toneMappingExposure = 0.92;
    const S = new THREE.Scene();
    S.background = new THREE.Color(0x06070d);
    S.fog = new THREE.Fog(0x06070d, 110, 230);
    // Image-based lighting: soft studio reflections on the floor, ball, glass and skin.
    const pm = new THREE.PMREMGenerator(R);
    S.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
    const cam = new THREE.PerspectiveCamera(38, 960 / 540, 0.5, 420);
    S.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a1d10, 0.3));
    // Broadcast arena lighting: an almost-overhead key (crisp contact shadows under the players, like the real
    // catwalk rig), warm spotlights pooling on the floor, a cool rim, light shafts in the haze, then a color grade.
    const sun = new THREE.DirectionalLight(0xfff3e2, 1.05);
    sun.position.set(4, 80, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(mob ? 1024 : 2048, mob ? 1024 : 2048);
    Object.assign(sun.shadow.camera, { left: -54, right: 54, top: 32, bottom: -32, near: 5, far: 150 });
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.025;
    S.add(sun);
    // Catwalk spotlights (no shadows: cheap): warm pools over each half court + cool rims from the corners.
    const SPOTS: [number, number, number, number, number, number][] = [
      [-30, -16, -22, 0, 0xfff0d8, 1.1],
      [30, 16, 22, 0, 0xfff0d8, 1.1],
      [-62, 34, -34, 4, 0xa8c8ff, 0.7],
      [62, -34, 34, -4, 0xa8c8ff, 0.7],
    ];
    for (const [x, z, tx, tz, c, i] of SPOTS) {
      const l = new THREE.SpotLight(c, i, 0, 0.55, 0.75, 1);
      l.position.set(x, 40, z);
      l.target.position.set(tx, 0, tz);
      S.add(l, l.target);
    }
    // Light shafts: faint additive cones from the catwalks, brighter where you look through more haze.
    const shaftM = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { k: { value: 0.05 } },
      vertexShader:
        "varying float vY; varying vec3 vN; varying vec3 vV; void main(){ vY = uv.y; vec4 mv = modelViewMatrix * vec4(position,1.); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }",
      fragmentShader:
        "uniform float k; varying float vY; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 1.5); float a = k * (0.25 + 0.75 * f) * smoothstep(0.0, 0.35, vY) * (0.35 + 0.65 * vY); gl_FragColor = vec4(vec3(1.0, 0.95, 0.86) * a, 1.0); }",
    });
    const shafts: THREE.Mesh[] = [];
    for (const [x, z, tx, tz] of SPOTS.slice(0, 2).concat([
      [-8, -20, -14, 6, 0, 0],
      [8, 20, 14, -6, 0, 0],
    ])) {
      const from = new THREE.Vector3(x, 40, z),
        to = new THREE.Vector3(tx, 0, tz),
        len = from.distanceTo(to),
        g = new THREE.CylinderGeometry(0.8, 9, len, 24, 1, true);
      g.translate(0, -len / 2, 0);
      const m = new THREE.Mesh(g, shaftM);
      m.position.copy(from);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), to.clone().sub(from).normalize());
      m.renderOrder = 5;
      S.add(m);
      shafts.push(m);
    }
    const MC = new Map<string, THREE.MeshStandardMaterial>(),
      M = (c: any, o: any = {}) => {
        const k = c + JSON.stringify(o);
        if (o.map) return new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, ...o });
        let m = MC.get(k);
        if (!m) MC.set(k, (m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, ...o })));
        return m;
      },
      ad = (g: THREE.BufferGeometry, m: THREE.Material | THREE.Material[], x: number, y: number, z: number, sh = true) => {
        const k = new THREE.Mesh(g, m as any);
        k.position.set(x, y, z);
        k.castShadow = k.receiveShadow = sh;
        S.add(k);
        return k;
      },
      cv = (w: number, h: number) => {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        return [c, c.getContext("2d")!] as const;
      },
      TX2 = (c: HTMLCanvasElement) => {
        const t = new THREE.CanvasTexture(c);
        t.encoding = THREE.sRGBEncoding;
        t.anisotropy = R.capabilities.getMaxAnisotropy();
        return t;
      };

    // ---------------- court: individual maple boards, team paint, crisp lines ----------------
    const TW = mob ? 2048 : 4096,
      TH = TW / 2;
    const [ct, c2] = cv(TW, TH),
      tex = TX2(ct);
    let pcK = "";
    function court() {
      const c = c2,
        sx = TW / 940,
        sy = TH / 500;
      c.setTransform(1, 0, 0, 1, 0, 0);
      // boards run the length of the court: 2.25" strips (~1.9 game px), random lengths, staggered joints
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const bh = Math.max(4, Math.round(1.9 * sy));
      for (let y = 0; y < TH; y += bh) {
        let x = -rnd() * 300;
        while (x < TW) {
          const L = 260 + rnd() * 520,
            t = rnd();
          c.fillStyle = `hsl(${28 + t * 7},${58 + t * 12}%,${50 + t * 9}%)`;
          c.fillRect(x, y, L, bh);
          c.fillStyle = "rgba(90,52,18,.18)";
          c.fillRect(x, y, 1.5, bh); // butt joint
          for (let k = 0; k < 3; k++) {
            c.fillStyle = `rgba(110,64,24,${0.04 + rnd() * 0.05})`;
            c.fillRect(x + rnd() * L, y + rnd() * bh, 20 + rnd() * 90, 1); // grain
          }
          x += L;
        }
        c.fillStyle = "rgba(70,40,12,.16)";
        c.fillRect(0, y, TW, 1); // seam
      }
      // varnish sheen toward center court
      const gl = c.createRadialGradient(TW / 2, TH / 2, 0, TW / 2, TH / 2, TW * 0.6);
      gl.addColorStop(0, "rgba(255,225,180,.05)");
      gl.addColorStop(1, "rgba(80,40,10,.10)");
      c.fillStyle = gl;
      c.fillRect(0, 0, TW, TH);
      c.setTransform(sx, 0, 0, sy, 0, 0);
      for (const b of [0, 1]) {
        const col = PC[b] || (b ? "#1d428a" : "#7b3fb5"),
          x0 = b ? 750 : 0;
        const g = c.createLinearGradient(x0, 0, x0 + 190, 0);
        g.addColorStop(b ? 1 : 0, col);
        g.addColorStop(b ? 0 : 1, shade(col, 0.82));
        c.globalAlpha = 0.86;
        c.fillStyle = g;
        c.fillRect(x0, 170, 190, 160);
        c.globalAlpha = 0.18;
        c.fillStyle = col;
        c.fillRect(b ? 900 : 0, 0, 40, 500); // baseline band
      }
      // center circle with both teams
      c.globalAlpha = 0.85;
      c.fillStyle = PC[0] || "#7b3fb5";
      c.beginPath();
      c.arc(470, 250, 60, Math.PI / 2, (3 * Math.PI) / 2);
      c.fill();
      c.fillStyle = PC[1] || "#1d428a";
      c.beginPath();
      c.arc(470, 250, 60, -Math.PI / 2, Math.PI / 2);
      c.fill();
      c.globalAlpha = 1;
      c.strokeStyle = "#fbfbf6";
      c.lineWidth = 2.2;
      c.lineJoin = c.lineCap = "round";
      const st = (a: number[][]) => {
        c.beginPath();
        a.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
        c.stroke();
      };
      c.strokeRect(1.5, 1.5, 937, 497);
      st([
        [470, 0],
        [470, 500],
      ]);
      st(gar(470, 250, 60, 0, 6.3));
      st(gar(470, 250, 20, 0, 6.3));
      for (const b of [0, 1]) {
        const hx = HXs[b],
          e = b ? 940 : 0,
          sg = b ? -1 : 1;
        c.strokeRect(b ? 750 : 0, 170, 190, 160);
        st(gar(e + sg * 190, 250, 60, b ? 1.57 : -1.57, b ? 4.71 : 1.57));
        c.setLineDash([9, 7]);
        st(gar(e + sg * 190, 250, 60, b ? -1.57 : 1.57, b ? 1.57 : 4.71));
        c.setLineDash([]);
        st(gar(hx, 250, 237, b ? Math.PI - 1.19 : -1.19, b ? Math.PI + 1.19 : 1.19));
        st([
          [e, 30],
          [hx + sg * 88, 30],
        ]);
        st([
          [e, 470],
          [hx + sg * 88, 470],
        ]);
        st(gar(hx, 250, 40, b ? 1.57 : -1.57, b ? 4.71 : 1.57)); // restricted area
        for (const yy of [170, 330]) for (const dx of [70, 80, 110, 140]) st([[e + sg * dx, yy], [e + sg * dx, yy + (yy < 250 ? -6 : 6)]]); // lane hash marks
      }
      c.font = "italic 900 58px system-ui";
      c.textAlign = "center";
      c.fillStyle = "rgba(255,255,255,.9)";
      c.fillText("2K27", 470, 270);
      c.font = "900 30px system-ui";
      c.fillStyle = "rgba(255,255,255,.22)";
      c.save();
      for (const b of [0, 1]) {
        c.setTransform(sx, 0, 0, sy, 0, 0);
        c.translate(b ? 920 : 20, 250);
        c.rotate(b ? Math.PI / 2 : -Math.PI / 2);
        c.fillText(((cl && cl[b]) || "").toUpperCase(), 0, 10);
      }
      c.restore();
      tex.needsUpdate = true;
    }
    const floorMat = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.42, clearcoat: 0.3, clearcoatRoughness: 0.32, envMapIntensity: 0.3 });
    const fl = ad(new THREE.PlaneGeometry(94, 50), floorMat, 0, 0, 0);
    fl.rotation.x = -Math.PI / 2;
    fl.castShadow = false;
    const mirror = new Reflector(new THREE.PlaneGeometry(94, 50), { textureWidth: 1024, textureHeight: 576, color: 0x777777, clipBias: 0.003 });
    mirror.rotation.x = -Math.PI / 2;
    mirror.position.y = -0.02;
    mirror.visible = false;
    S.add(mirror);
    const setMirror = (on: boolean) => {
      if (mirror.visible === on) return;
      mirror.visible = on;
      floorMat.transparent = on;
      floorMat.opacity = on ? 0.88 : 1;
      floorMat.needsUpdate = true;
    };
    const apron = ad(new THREE.PlaneGeometry(150, 100), M(0x12152a, { roughness: 0.7 }), 0, -0.03, 0);
    apron.rotation.x = -Math.PI / 2;
    apron.castShadow = false;

    // ---------------- stands: tiers + instanced fans (body + head) ----------------
    const tierM = M(0x161a2e, { roughness: 0.85 }),
      tierG = new THREE.BoxGeometry(1, 1, 1);
    const tiers: [number, number, number, number, number][] = []; // x, y, z, w, d per step box
    for (let r = 0; r < 12; r++) {
      const y = 0.6 + r * 1.15,
        off = 3.2 + r * 1.6;
      tiers.push([0, y, -(25 + off), 120 + r * 3.2, 1.6], [0, y, 25 + off, 120 + r * 3.2, 1.6], [-(47 + off), y, 0, 1.6, 50 + r * 3.2 * 2], [47 + off, y, 0, 1.6, 50 + r * 3.2 * 2]);
    }
    const tierI = new THREE.InstancedMesh(tierG, tierM, tiers.length),
      dm = new THREE.Object3D();
    tiers.forEach((t, i) => {
      dm.position.set(t[0], t[1] / 2, t[2]);
      dm.scale.set(t[3], t[1], t[4]);
      dm.rotation.set(0, 0, 0);
      dm.updateMatrix();
      tierI.setMatrixAt(i, dm.matrix);
    });
    tierI.receiveShadow = true;
    S.add(tierI);
    const CN = 2600,
      cpos: number[][] = [],
      cc = new THREE.Color(),
      bodyI = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.3, 0.55, 3, 8), M(0xffffff, { roughness: 0.85 }), CN),
      headI = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 10, 8), M(0xffffff, { roughness: 0.7 }), CN);
    const SKN = ["#f1c27d", "#c68642", "#8d5524", "#e0ac69", "#6b4226", "#ffdbac"];
    for (let i = 0; i < CN; i++) {
      const sd = i % 4,
        r = Math.floor(i / 4) % 12,
        y = 0.6 + r * 1.15 + 0.55,
        off = 3.2 + r * 1.6;
      let x, z, ry;
      if (sd < 2) {
        x = (Math.random() - 0.5) * (116 + r * 3);
        z = (sd ? 1 : -1) * (25 + off);
        ry = sd ? Math.PI : 0;
      } else {
        z = (Math.random() - 0.5) * (46 + r * 6);
        x = (sd === 2 ? -1 : 1) * (47 + off);
        ry = sd === 2 ? Math.PI / 2 : -Math.PI / 2;
      }
      cpos.push([x, y, z, ry, Math.random() * 6.28]);
      // fans wear their team's color more often than not
      const team = Math.random();
      if (team < 0.32) cc.set(PC[0] || "#7b3fb5");
      else if (team < 0.6) cc.set(PC[1] || "#1d428a");
      else cc.setHSL(Math.random(), 0.35, 0.25 + Math.random() * 0.4);
      bodyI.setColorAt(i, cc);
      headI.setColorAt(i, cc.set(SKN[i % SKN.length]));
    }
    for (const m of [bodyI, headI]) {
      m.instanceColor!.needsUpdate = true;
      m.frustumCulled = false;
      S.add(m);
    }
    let exc = 0.3;
    function crowdUpd(n: number) {
      for (let i = 0; i < n; i++) {
        const c = cpos[i],
          hop = Math.max(0, Math.sin(T * (3 + exc * 5) + c[4])) * 0.35 * exc;
        dm.scale.set(1, 1, 1);
        dm.rotation.set(0, c[3], 0);
        dm.position.set(c[0], c[1] + hop, c[2]);
        dm.updateMatrix();
        bodyI.setMatrixAt(i, dm.matrix);
        dm.position.y += 0.75;
        dm.updateMatrix();
        headI.setMatrixAt(i, dm.matrix);
      }
      bodyI.count = headI.count = n;
      bodyI.instanceMatrix.needsUpdate = headI.instanceMatrix.needsUpdate = true;
    }

    // ---------------- LED ribbons (courtside + upper ring), emissive so bloom catches them ----------------
    const [lc, l] = cv(2048, 64);
    function ledDraw() {
      l.fillStyle = "#04050b";
      l.fillRect(0, 0, 2048, 64);
      l.font = "italic 900 40px system-ui";
      for (let i = 0; i < 6; i++) {
        l.fillStyle = i % 2 ? PC[0] || "#ffd23f" : "#ffd23f";
        l.fillText(i % 3 === 2 ? "★ HOOPS 2K27 ★" : ((cl && cl[i % 2]) || "HOOPS").toUpperCase(), i * 341 + 14, 46);
      }
    }
    ledDraw();
    const led = TX2(lc);
    led.wrapS = THREE.RepeatWrapping;
    led.repeat.set(2, 1);
    const ledM = new THREE.MeshBasicMaterial({ map: led, toneMapped: false }),
      darkM = M(0x0b0c14);
    for (const [x, z, ry, w] of [
      [0, -27.6, 0, 96],
      [0, 27.6, Math.PI, 96],
    ] as const) {
      const brd = new THREE.Mesh(new THREE.BoxGeometry(w, 1.3, 0.35), [darkM, darkM, darkM, darkM, ledM, darkM]);
      brd.position.set(x, 0.65, z);
      brd.rotation.y = ry;
      S.add(brd);
    }
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(80, 80, 2.2, 64, 1, true), ledM);
    ring.position.y = 16.5;
    ring.scale.set(1, 1, 0.62);
    (ring.material as any).side = THREE.DoubleSide;
    S.add(ring);

    // ---------------- hoops: padded stanchion, arm, glass, shot clock, rim, tube net ----------------
    const shotClocks: { ctx: CanvasRenderingContext2D; tex: THREE.Texture; k: string }[] = [];
    for (const b of [0, 1]) {
      const hx = (HXs[b] - 470) * 0.1,
        sg = b ? 1 : -1,
        mt = M(0x262a35, { metalness: 0.7, roughness: 0.35 }),
        pad = M(PC[b] || "#1d428a", { roughness: 0.85 });
      ad(new THREE.BoxGeometry(2.6, 3.4, 3.6), pad, sg * 49.4, 1.7, 0); // padded base
      ad(new THREE.CylinderGeometry(0.42, 0.55, 12, 20), mt, sg * 49.4, 9, 0);
      const arm = ad(new THREE.BoxGeometry(6.2, 0.4, 0.5), mt, sg * 46.3, 12.6, 0);
      arm.rotation.z = sg * -0.32;
      ad(new THREE.BoxGeometry(0.25, 1.2, 1.2), mt, sg * 43.3, 11.5, 0);
      const glass = new THREE.MeshPhysicalMaterial({ color: 0xe8f4ff, transparent: true, opacity: 0.22, roughness: 0.04, metalness: 0, envMapIntensity: 1.2, clearcoat: 1 });
      const bb = ad(new THREE.BoxGeometry(0.12, 3.5, 6), glass, sg * 43, 11.45, 0);
      bb.castShadow = false;
      const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.13, 3.5, 6)), new THREE.LineBasicMaterial({ color: 0xffffff }));
      frame.position.copy(bb.position);
      S.add(frame);
      const sq = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(2, 1.5)), new THREE.LineBasicMaterial({ color: 0xffffff }));
      sq.position.set(sg * 42.92, 10.6, 0);
      sq.rotation.y = Math.PI / 2;
      S.add(sq);
      ad(new THREE.BoxGeometry(0.2, 0.2, 6.1), M(0xd23b1a, { roughness: 0.5 }), sg * 43, 9.68, 0); // bottom pad
      const rim = ad(new THREE.TorusGeometry(0.75, 0.07, 14, 48), M(0xff4d1a, { metalness: 0.55, roughness: 0.3 }), hx, 10, 0);
      rim.rotation.x = Math.PI / 2;
      ad(new THREE.BoxGeometry(0.6, 0.14, 0.42), M(0xff4d1a, { metalness: 0.5, roughness: 0.35 }), sg * 42.6, 10, 0);
      // shot clock box on top of the backboard, facing the court
      const [sc2, sx2] = cv(128, 64),
        stx = TX2(sc2);
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1, 2.4), [darkM, darkM, darkM, darkM, darkM, darkM]);
      box.position.set(sg * 43, 13.8, 0);
      S.add(box);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.9), new THREE.MeshBasicMaterial({ map: stx, toneMapped: false }));
      face.position.set(sg * 42.74, 13.8, 0);
      face.rotation.y = -sg * (Math.PI / 2);
      S.add(face);
      shotClocks.push({ ctx: sx2, tex: stx, k: "" });
    }
    function shotClockDraw() {
      for (const s of shotClocks) {
        const v = String(Math.max(0, Math.ceil(shot)));
        if (s.k === v) continue;
        s.k = v;
        s.ctx.fillStyle = "#050505";
        s.ctx.fillRect(0, 0, 128, 64);
        s.ctx.fillStyle = shot < 5 ? "#ff3b30" : "#ffb020";
        s.ctx.font = "900 52px ui-monospace,monospace";
        s.ctx.textAlign = "center";
        s.ctx.fillText(v, 64, 52);
        s.tex.needsUpdate = true;
      }
    }
    // Net strands as instanced thin cylinders, re-posed from the verlet sim every frame.
    const NC = NETS.reduce((a, N) => a + N.c.length, 0),
      netI = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.022, 0.022, 1, 5, 1, true), M(0xf4f4f4, { roughness: 0.9 }), NC);
    netI.frustumCulled = false;
    netI.castShadow = true;
    S.add(netI);
    const UP = new THREE.Vector3(0, 1, 0),
      NA = new THREE.Vector3(),
      NB = new THREE.Vector3(),
      ND = new THREE.Vector3(),
      NQ = new THREE.Quaternion();
    // Ball orientation integrates a real angular velocity: the host's Rapier spin for shots/passes (backspin about
    // the axis across the flight), rolling on the floor, a forward roll in the dribble. Guests derive it from velocity.
    const BQ = new THREE.Quaternion(),
      BW = new THREE.Vector3();
    function ballSpin(dt: number) {
      if (RPL) return;
      const sp = Math.hypot(B.vx || 0, B.vy || 0),
        o = B.owner;
      let wx = 0,
        wy = 0,
        wz = 0;
      if (o) {
        const v = Math.hypot(o.vx, o.vy),
          dv = B.dvv || 0;
        // forward topspin from the push + roll with the carrier's run
        if (v > 1) (wx = (-o.vy / v) * (v / 39 + Math.abs(dv) * 0.02)), (wy = (o.vx / v) * (v / 39 + Math.abs(dv) * 0.02));
      } else if (B.wv && (B.mode === "air" || B.mode === "pass")) [wx, wy, wz] = B.wv;
      else if (sp > 1) {
        const air = B.z > 4.5;
        const k = air ? -16 / sp : 1 / 3.9; // backspin in flight, pure roll on the floor
        wx = -B.vy * k;
        wy = B.vx * k;
      }
      // game (x,y,z) -> three (x,z,y) is a reflection, so the axial vector flips sign
      BW.set(-wx, -wz, -wy);
      const w = BW.length();
      if (w > 1e-4) {
        BQ.setFromAxisAngle(BW.multiplyScalar(1 / w), w * dt);
        ball.quaternion.premultiply(BQ);
      }
    }
    function netUpd() {
      let i = 0;
      for (const N of NETS)
        for (const c of N.c) {
          const a = W3(c[0].x, c[0].y, c[0].z),
            b = W3(c[1].x, c[1].y, c[1].z);
          NA.set(a[0], a[1], a[2]);
          NB.set(b[0], b[1], b[2]);
          ND.subVectors(NB, NA);
          const len = ND.length() || 0.001;
          NQ.setFromUnitVectors(UP, ND.multiplyScalar(1 / len));
          dm.position.copy(NA).add(NB).multiplyScalar(0.5);
          dm.quaternion.copy(NQ);
          dm.scale.set(1, len, 1);
          dm.updateMatrix();
          netI.setMatrixAt(i++, dm.matrix);
        }
      netI.instanceMatrix.needsUpdate = true;
      dm.quaternion.identity();
    }

    // ---------------- ball: pebbled leather with deep channels ----------------
    const [bc, b2] = cv(1024, 512);
    b2.fillStyle = "#d4621c";
    b2.fillRect(0, 0, 1024, 512);
    for (let i = 0; i < 26000; i++) {
      b2.fillStyle = Math.random() < 0.5 ? "rgba(0,0,0,.10)" : "rgba(255,190,140,.08)";
      b2.beginPath();
      b2.arc(Math.random() * 1024, Math.random() * 512, 1.6, 0, 6.3);
      b2.fill();
    }
    b2.strokeStyle = "#1a0b03";
    b2.lineWidth = 9;
    b2.beginPath();
    b2.moveTo(0, 256);
    b2.lineTo(1024, 256);
    b2.moveTo(256, 0);
    b2.lineTo(256, 512);
    b2.moveTo(768, 0);
    b2.lineTo(768, 512);
    b2.stroke();
    b2.beginPath();
    b2.ellipse(512, 256, 150, 256, 0, 0, 6.3);
    b2.stroke();
    const ball = ad(new THREE.SphereGeometry(0.39, 48, 32), new THREE.MeshStandardMaterial({ map: TX2(bc), roughness: 0.62, envMapIntensity: 0.6 }), 0, -5, 0);
    // on-fire trail: additive sprites behind the ball when the last shooter is hot
    const [fc, f2] = cv(64, 64),
      fg = f2.createRadialGradient(32, 32, 0, 32, 32, 32);
    fg.addColorStop(0, "rgba(255,240,180,1)");
    fg.addColorStop(0.35, "rgba(255,140,30,.8)");
    fg.addColorStop(1, "rgba(255,60,0,0)");
    f2.fillStyle = fg;
    f2.fillRect(0, 0, 64, 64);
    const fireM = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(fc), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false });
    const trail: THREE.Sprite[] = [];
    for (let i = 0; i < 14; i++) {
      const s = new THREE.Sprite(fireM);
      s.visible = false;
      S.add(s);
      trail.push(s);
    }
    let trailK = 0;

    // ---------------- jumbotron ----------------
    const [jc, j2] = cv(1024, 512),
      jt = TX2(jc),
      js2 = new THREE.MeshBasicMaterial({ map: jt, toneMapped: false }),
      jum = new THREE.Mesh(new THREE.BoxGeometry(15, 7.5, 15), [js2, js2, darkM, darkM, js2, js2]);
    jum.position.set(0, 27, 0);
    S.add(jum);
    let jk = "";
    function jumbo() {
      const k = sc[0] + "-" + sc[1] + "-" + fmt(clock) + "-" + Math.ceil(shot) + "-" + qtrN + PC.join();
      if (k === jk) return;
      jk = k;
      const c = j2;
      c.fillStyle = "#03050c";
      c.fillRect(0, 0, 1024, 512);
      for (const b of [0, 1]) {
        c.fillStyle = PC[b] || "#333";
        c.fillRect(b ? 520 : 24, 110, 480, 230);
      }
      c.fillStyle = "#ffd23f";
      c.font = "italic 900 58px system-ui";
      c.textAlign = "center";
      c.fillText("HOOPS 2K27", 512, 76);
      c.fillStyle = "#fff";
      c.font = "800 44px system-ui";
      c.fillText(((cl && cl[0]) || "").toUpperCase().slice(0, 12), 264, 170);
      c.fillText(((cl && cl[1]) || "").toUpperCase().slice(0, 12), 760, 170);
      c.font = "900 150px system-ui";
      c.fillText(String(sc[0]), 264, 320);
      c.fillText(String(sc[1]), 760, 320);
      c.fillStyle = "#ffd23f";
      c.font = "800 64px ui-monospace,monospace";
      c.fillText((qtrN > 4 ? "OT" : "Q" + qtrN) + "  " + fmt(clock), 512, 440);
      jt.needsUpdate = true;
    }
    // ceiling light panels (bloom picks them up)
    const panelM = new THREE.MeshBasicMaterial({ color: 0xfff6e8, toneMapped: false });
    for (let i = 0; i < 8; i++) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.2), panelM);
      p.position.set(-42 + i * 12, 40, (i % 2 ? 1 : -1) * 14);
      p.rotation.x = Math.PI / 2;
      S.add(p);
    }

    // ---------------- effects + quality ----------------
    const fx = makeFx(R, S, cam, 960, 540);
    let lvl = 6,
      lastQ = -1,
      lastFX: any = null;
    // Ladder (top -> bottom): everything; -SSAO; -reflection; -bloom/blur; -shadows; 85% res; 75% res.
    const fxLevel = () => {
      const ql = V.QL,
        on = V.FX && ql > 0;
      R.setPixelRatio(Math.min(devicePixelRatio || 1, DPR[ql]) * (lvl >= 2 ? 1 : lvl === 1 ? 0.85 : 0.75));
      R.setSize(960, 540, false);
      fx.setLevel(on && lvl >= 4 ? ql : on ? 0 : 0, on && lvl >= 4, 960, 540, on && lvl >= 6 && ql >= 2);
      setMirror(on && ql >= 2 && lvl >= 5);
      const wantShadow = ql > 0 && lvl >= 3;
      if (R.shadowMap.enabled !== wantShadow) {
        R.shadowMap.enabled = wantShadow;
        S.traverse((o: any) => o.material && [].concat(o.material).forEach((mm: any) => (mm.needsUpdate = true)));
      }
      sun.shadow.mapSize.setScalar(ql > 1 && !mob ? 4096 : ql > 0 ? 2048 : 1024);
      for (const m of shafts) m.visible = ql >= 1 && lvl >= 3;
      fx.setGrade(on && ql >= 1 && lvl >= 4);
      if (sun.shadow.map) {
        sun.shadow.map.dispose();
        (sun.shadow as any).map = null;
      }
    };
    V.onResize = fxLevel;
    const cl2 = new THREE.Vector3(0, 0, 3),
      TV = new THREE.Vector3(),
      PV = new THREE.Vector3();
    let pset: any = null,
      lastR = 0,
      ema = 16,
      nf = 0,
      lastTot = 0,
      lastF = performance.now(),
      shake = 0;
    V.shake = (a: number) => (shake = Math.max(shake, a));
    V.GL = {
      proj(x: number, y: number, z: number) {
        const v = PV.set(x, y, z).project(cam);
        return [(v.x + 1) * 480, (1 - v.y) * 270];
      },
      render() {
        const QL = V.QL,
          now = performance.now(),
          fdt = Math.min(0.1, (now - lastF) / 1000);
        lastF = now;
        if (QL !== lastQ || V.FX !== lastFX) {
          lastQ = QL;
          lastFX = V.FX;
          lvl = 6;
          fxLevel();
        }
        const tot = sc[0] + sc[1];
        if (tot !== lastTot) {
          lastTot = tot;
          exc = 1;
        }
        exc = Math.max(0.3, exc - 0.004);
        const crowdN = QL === 0 ? 0 : QL === 1 || lvl < 3 ? 1300 : CN;
        if ((nf & 1) === 0 || bodyI.count !== crowdN) crowdUpd(crowdN);
        jumbo();
        shotClockDraw();
        if (lastR && now - lastR < 250) {
          ema = ema * 0.95 + (now - lastR) * 0.05;
          if (++nf > 90) {
            nf = 0;
            const old = lvl;
            if (ema > 22 && lvl > 0) lvl--;
            else if (ema < 13 && lvl < 6) lvl++;
            if (lvl !== old) fxLevel();
            V.perf = { fps: Math.round(1000 / ema), lvl, scale: R.getPixelRatio() };
          }
        }
        lastR = now;
        if (PC.join() + cl.join() !== pcK) {
          pcK = PC.join() + cl.join();
          // per-arena grade: a whisper of the home team's color in the light
          const hc = new THREE.Color(PC[0] || "#ffffff"),
            mx = Math.max(hc.r, hc.g, hc.b, 0.01);
          fx.setGrade(V.FX && V.QL >= 1, new THREE.Color(1, 1, 1).lerp(hc.multiplyScalar(1 / mx), 0.07));
          court();
          ledDraw();
          led.needsUpdate = true;
          for (let i = 0; i < CN; i++) {
            const t = Math.random();
            if (t < 0.32) cc.set(PC[0]);
            else if (t < 0.6) cc.set(PC[1]);
            else cc.setHSL(Math.random(), 0.35, 0.25 + Math.random() * 0.4);
            bodyI.setColorAt(i, cc);
          }
          bodyI.instanceColor!.needsUpdate = true;
        }
        if (P !== pset) {
          if (pset)
            pset.forEach((p: any) => {
              if (!p.gl) return;
              S.remove(p.gl.G);
              p.gl.mesh.geometry.dispose();
              p.gl.extra.forEach((m: any) => (m.map && m.map.dispose(), m.dispose()));
            });
          P.forEach((p) => {
            p.gl = makeRig(p, TX2);
            S.add(p.gl.G);
          });
          pset = P;
        }
        if (P.length) {
          for (const p of P)
            if (p.gl) {
              applyPose(p.gl, p);
              footIK(p.gl, p, fdt, QL > 0 && !RPL);
            }
          const w = W3(B.x, B.y, B.z);
          ball.position.set(w[0], w[1], w[2]);
          ballSpin(fdt);
          const o = B.owner;
          if (!RPL && o && o.gl && (o.mode === "c" || o.mode === "s")) {
            o.gl.G.updateMatrixWorld(true);
            ball.position.copy(o.gl.wR.localToWorld(TV.set(0, -0.62, 0.1)));
          }
          // fire trail
          const hot = !B.owner && B.last && (B.last.heat || 0) >= 3;
          if (hot && QL > 0) {
            const s = trail[trailK++ % trail.length];
            s.visible = true;
            s.position.copy(ball.position);
            s.scale.setScalar(1.4);
          }
          for (const s of trail)
            if (s.visible) {
              s.scale.multiplyScalar(0.9);
              if (s.scale.x < 0.15) s.visible = false;
            }
        }
        netUpd();
        led.offset.x = (T * 0.04) % 1;
        // ---------------- cameras ----------------
        const cm = RPL ? 1 : V.CAMM,
          p0 = P.length ? V.focusP() : null,
          hx = (hoop(pos) - 470) * 0.1;
        let tp = [CP[0], 20, 34],
          tl = [CP[0], 0, 2.5];
        if (cm === 1 && p0) {
          const pw = W3(p0.x, p0.y, 0),
            bx = W3(B.x, B.y, 0),
            mx = pw[0] * 0.5 + bx[0] * 0.5;
          tp = [mx, 11.5, 24];
          tl = [mx, 2.8, 2];
        } else if (cm === 2) {
          const sg = hx > 0 ? 1 : -1;
          tp = [sg * 60, 12, 0];
          tl = [sg * 22, 3.5, 0];
        } else if (cm === 3 && p0) {
          const pw = W3(p0.x, p0.y, 0),
            dr = hoop(p0.tm) > 470 ? 1 : -1;
          tp = [pw[0] - dr * 13, 8.5, pw[2] + (pw[2] > 0 ? -4 : 4) + 10];
          tl = [pw[0] + dr * 9, 3, pw[2] * 0.6];
        }
        const SO = (V as any).studio as { a: number; d: number } | null;
        if (SO && p0) {
          // Animation Studio: close orbit around the player
          const pw = W3(p0.x, p0.y, 0);
          const up = p0.z * 0.1; // follow jumps
          tp = [pw[0] + Math.cos(SO.a) * SO.d, 5 + up, pw[2] + Math.sin(SO.a) * SO.d];
          tl = [pw[0], 3.3 + up, pw[2]];
        }
        cam.position.lerp(TV.set(tp[0], tp[1], tp[2]), SO ? 1 : 0.1);
        cl2.lerp(TV.set(tl[0], tl[1], tl[2]), SO ? 1 : 0.14);
        cam.lookAt(cl2);
        if (shake > 0.001) {
          cam.position.x += (Math.random() - 0.5) * shake;
          cam.position.y += (Math.random() - 0.5) * shake;
          shake *= 0.86;
        }
        cam.updateMatrixWorld();
        // Motion blur only for the big moments (dunks, dribble moves of the followed player), never on camera pans.
        const fast = p0 && ((p0.mvT > 0 && p0 === B.owner) || (B.dk && B.age < 0.4)) ? 1 : 0;
        fx.setMotion(fast && p0 ? Math.cos(Math.PI / 2 - p0.f) * 0.006 : 0, 0, fast && V.FX && QL >= 2 && lvl >= 5 ? 1 : 0);
        fx.render(fdt);
      },
    };
  } catch (e) {
    V.GL = null;
    console.error("WebGL off", e);
  }
}
function shade(hex: string, k: number) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return "#" + c.getHexString();
}
void HY;
