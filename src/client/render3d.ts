// three.js arena for the 3D modes: image-lit hardwood court, tiered stands with an instanced crowd, LED ribbons,
// jumbotron, glass backboards with shot clocks, tube nets driven by the net sim, skinned player rigs, cameras,
// post-processing, and an adaptive quality ladder that sheds effects before it ever lowers resolution.
import * as THREE from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { P, B, T, pos, PC, sc, clock, shot, cl, q as qtrN, RPL, RPK, HXs, HY, W3, hoop, NETS, S as GS, ROST, TS, cfg as SCFG, gameLike, stepLen, RR as SRR, chainNet, QTRLEN } from "../core/sim";
import { gar, CP } from "./canvas";
import { V, fmt, HSRS, targetMs, hsrMode, aoLevel, GRADES, QLN } from "./view";
import { makeDynRes } from "./hsr";
import { makeRig, applyPose, footIK, clothStep, RIM } from "./rig3d";
import { makeFx, mipBias, type Fx } from "./fx3d";
import { arenaEnv, skyEnv, SKY, bowl, scorerTable, photographers, makePyro, drawFanCam, detail, makePrecip, puddleMaps, autoWx, ROWS, rowY, rowOff, inAisle, type Wx } from "./gfx3d";
import { gfxTex } from "./gfxtex";

const DPR = [1, 1.5, 2, 2]; // device pixel ratio cap per quality level (Low / Medium / High / Ultra)
const MAXR = [1.4, 2.2, 4, 4]; // max drawing-buffer scale over 960x540 per quality level (1344 / 2112 / 3840 px wide)

/** Start the 3D view. WebGL by default; the WebGPU renderer (Display -> Renderer, or ?webgpu) drives the same scene
 *  and falls back to its WebGL2 backend where the browser has no WebGPU. If WebGPU fails to load, WebGL is used. */
export function glInit(C: HTMLCanvasElement) {
  let failed = false;
  try {
    failed = sessionStorage.getItem("h2k_nogpu") === "1";
  } catch (e) {}
  const wantGPU = (V.GPU || /[?&]webgpu\b/.test(location.search)) && !failed;
  if (failed && V.GPU) V.backend = "WebGL (WebGPU failed on this browser)";
  if (!wantGPU) return build(C, null, null);
  Promise.all([import("three/webgpu"), import("./fxgpu")])
    .then(([GPU, F]) => build(C, GPU, F.makeFxGPU))
    .catch((e) => {
      console.warn("WebGPU unavailable, using WebGL", e);
      V.GPU = 0;
      build(C, null, null);
    });
}
/** WebGPU could not start or crashed while drawing: reload once on WebGL for the rest of this browser session. */
function gpuFail(e: any) {
  console.warn("WebGPU failed, falling back to WebGL", e);
  try {
    sessionStorage.setItem("h2k_nogpu", "1");
  } catch (e2) {}
  location.reload();
}
function build(C: HTMLCanvasElement, GPU: any, makeFxGPU: any) {
  if (GPU && typeof (window as any).GPUTexture !== "undefined") {
    // Chromium < ~142 types GPUTextureViewDescriptor.swizzle differently and rejects three's default "rgba";
    // the default is a no-op, so drop it before it reaches the browser.
    const proto = (window as any).GPUTexture.prototype,
      cv0 = proto.createView;
    if (!proto.__h2k) {
      proto.__h2k = 1;
      proto.createView = function (d?: any) {
        if (d && d.swizzle === "rgba") {
          const { swizzle, ...rest } = d;
          void swizzle;
          return cv0.call(this, rest);
        }
        return cv0.call(this, d);
      };
    }
  }
  try {
    THREE.ColorManagement.enabled = true;
    const R: any = GPU ? new GPU.WebGPURenderer({ canvas: C, antialias: true, powerPreference: "high-performance" }) : new THREE.WebGLRenderer({ canvas: C, antialias: true, powerPreference: "high-performance" });
    if (!GPU && !R.getContext()) throw 0;
    let ready = !GPU;
    const maxAniso = () => {
      try {
        return GPU ? R.getMaxAnisotropy?.() || 8 : R.capabilities.getMaxAnisotropy() || 4; // (was a self-call: WebGL always fell back to 4x)
      } catch (e) {
        return 4;
      }
    };
    const mob = matchMedia("(pointer:coarse)").matches;
    R.setPixelRatio(Math.min(devicePixelRatio || 1, DPR[V.QL]));
    R.setSize(960, 540, false);
    R.shadowMap.enabled = true;
    R.shadowMap.type = THREE.PCFShadowMap; // r18x: PCF with a radius replaces PCFSoft
    R.outputColorSpace = THREE.SRGBColorSpace;
    R.toneMapping = THREE.ACESFilmicToneMapping;
    R.toneMappingExposure = 0.9;
    const S = new THREE.Scene();
    /** Indoor-arena dressing (stands, crowd, signs, boards, jumbotron, ceiling): hidden for street games. */
    const ARENA: THREE.Object3D[] = [];
    S.background = new THREE.Color(0x06070d);
    S.fog = new THREE.Fog(0x06070d, 110, 230);
    // Image-based lighting (graphics v6): a procedural HDR arena (catwalk light grid, dark bowl, LED fascia in the home
    // colour, warm court bounce) prefiltered by PMREM = the "baked" ambient + reflections on floor, glass, ball, skin.
    // Street courts get a sky per weather (skyEnv). Regenerated only when the home colour / weather changes.
    let PMG: any = null,
      envK = "",
      envT: THREE.Texture | null = null;
    const envSet = (k: string, scene: () => THREE.Scene) => {
      if (k === envK || !PMG) return;
      envK = k;
      const old = envT,
        sc = scene();
      envT = PMG.fromScene(sc, 0.03).texture;
      S.environment = envT;
      sc.traverse((o: any) => (o.geometry && o.geometry.dispose(), o.material && o.material.dispose()));
      if (old) old.dispose();
    };
    const envInit = () => {
      PMG = GPU ? new GPU.PMREMGenerator(R) : new THREE.PMREMGenerator(R);
      envSet("arena:" + (PC[0] || ""), () => arenaEnv(PC[0] || "#7b3fb5"));
    };
    if (GPU)
      R.init()
        .then(() => {
          envInit();
          ready = true;
          V.backend = R.backend && R.backend.isWebGPUBackend ? "WebGPU" : "WebGPU (WebGL2 fallback)";
        })
        .catch(gpuFail);
    else {
      envInit();
      V.backend = "WebGL";
    }
    const cam = new THREE.PerspectiveCamera(38, 960 / 540, 0.5, 420);
    // three r155+ physical light units: legacy intensities x PI keep the same exposure
    const PI = Math.PI;
    // house lights down: the bowl is dim, the court is lit (the env map carries most of the ambient now)
    const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x2a1d10, 0.16 * PI);
    S.add(hemi);
    // Broadcast arena lighting: an almost-overhead key (crisp contact shadows under the players, like the real
    // catwalk rig), warm spotlights pooling on the floor, a cool rim, light shafts in the haze, then a color grade.
    const sun = new THREE.DirectionalLight(0xfff3e2, 1.05 * PI);
    sun.position.set(4, 80, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(mob ? 1024 : 2048, mob ? 1024 : 2048);
    Object.assign(sun.shadow.camera, { left: -54, right: 54, top: 32, bottom: -32, near: 5, far: 150 });
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.025;
    sun.shadow.radius = 2.5; // soft edges
    S.add(sun, sun.target);
    // Broadcast back light (behind the far sideline, low and cool: rims every player's head and shoulders for the
    // main camera) + a soft warm fill from the camera side. No shadows (cheap on every tier).
    // (kept high and moderate: a low back light threw a blown-out specular streak across the glossy floor)
    const back = new THREE.DirectionalLight(0xcfe0ff, 0.38 * PI);
    back.position.set(6, 48, -50);
    const fill = new THREE.DirectionalLight(0xffe6cc, 0.18 * PI);
    fill.position.set(-10, 14, 60);
    S.add(back, fill);
    // Catwalk spotlights (no shadows: cheap): warm pools over each half court + cool rims from the corners.
    const SPOTS: [number, number, number, number, number, number][] = [
      [-30, -16, -22, 0, 0xfff0d8, 1.1],
      [30, 16, 22, 0, 0xfff0d8, 1.1],
      [-62, 34, -34, 4, 0xa8c8ff, 0.7],
      [62, -34, 34, -4, 0xa8c8ff, 0.7],
    ];
    for (const [x, z, tx, tz, c, i] of SPOTS) {
      const l = new THREE.SpotLight(c, i * PI * 26, 0, 0.55, 0.75, 1); // candela, 1/d falloff (~26 ft keeps the old pools)
      l.position.set(x, 40, z);
      l.target.position.set(tx, 0, tz);
      S.add(l, l.target);
    }
    // Light shafts: faint additive cones from the catwalks, brighter where you look through more haze.
    // (an alpha gradient texture instead of a custom shader, so the same material runs on WebGL and WebGPU)
    const shc0 = document.createElement("canvas");
    shc0.width = 4;
    shc0.height = 128;
    const shx0 = shc0.getContext("2d")!;
    {
      const gg = shx0.createLinearGradient(0, 0, 0, 128);
      gg.addColorStop(0, "rgba(255,255,255,1)"); // top (catwalk)
      gg.addColorStop(0.75, "rgba(255,255,255,.35)");
      gg.addColorStop(1, "rgba(255,255,255,0)"); // fades out before the floor
      shx0.fillStyle = gg;
      shx0.fillRect(0, 0, 4, 128);
    }
    const shaftM = new THREE.MeshBasicMaterial({
      color: new THREE.Color(1, 0.95, 0.86).multiplyScalar(0.018), // faint: a haze, not a beam
      alphaMap: new THREE.CanvasTexture(shc0),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
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
      S.add(m); ARENA.push(m);
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
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = maxAniso();
        return t;
      };

    // ---------------- court: individual maple boards, team paint, crisp lines ----------------
    const TW = mob ? 2048 : 4096,
      TH = TW / 2;
    const [ct, c2] = cv(TW, TH),
      tex = TX2(ct);
    let pcK = "",
      woodOn = false; // the ambientCG maple set is on the floor: the canvas holds a flat varnish base + paint + lines
    const DECAL = "HOOPS"; // fictional centre-court logo wordmark
    function court() {
      const c = c2,
        sx = TW / 940,
        sy = TH / 500;
      c.setTransform(1, 0, 0, 1, 0, 0);
      // boards run the length of the court: 2.25" strips (~1.9 game px), random lengths, staggered joints
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const bh = Math.max(4, Math.round(1.9 * sy));
      if (woodOn) {
        // flat varnish tone; the wood texture (multiplied in by detail()) brings the planks, grain and colour variation
        const vg = c.createLinearGradient(0, 0, TW, 0);
        vg.addColorStop(0, "#c8955f");
        vg.addColorStop(0.5, "#d3a26c");
        vg.addColorStop(1, "#c8955f");
        c.fillStyle = vg;
        c.fillRect(0, 0, TW, TH);
      } else
      for (let y = 0; y < TH; y += bh) {
        let x = -rnd() * 300;
        while (x < TW) {
          const L = 260 + rnd() * 520,
            t = rnd();
          c.fillStyle = `hsl(${28 + t * 7},${56 + t * 12}%,${44 + t * 8}%)`;
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
      // scuff marks: shoe rubber where the action is (paint, top of the key, center circle)
      {
        const hot = [
          [100, 250, 90],
          [840, 250, 90],
          [230, 250, 60],
          [710, 250, 60],
          [470, 250, 70],
        ];
        c.lineCap = "round";
        for (let n = 0; n < 220; n++) {
          const h = hot[n % hot.length],
            a = rnd() * 6.283,
            r = rnd() * h[2],
            x = (h[0] + Math.cos(a) * r) * sx,
            y = (h[1] + Math.sin(a) * r * 1.4) * sy;
          c.strokeStyle = `rgba(35,22,12,${0.035 + rnd() * 0.06})`;
          c.lineWidth = 2 + rnd() * 4;
          c.beginPath();
          c.arc(x, y, 14 + rnd() * 40, rnd() * 6.3, rnd() * 6.3 + 0.5 + rnd());
          c.stroke();
        }
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
      // centre-court crest (fictional): a stylised ball in a ring with the league wordmark, projected like a decal
      {
        c.save();
        c.translate(470, 250);
        c.globalAlpha = 0.92;
        c.fillStyle = "rgba(10,12,22,.55)";
        c.beginPath();
        c.arc(0, 0, 40, 0, 6.3);
        c.fill();
        c.strokeStyle = "#ffd23f";
        c.lineWidth = 2.4;
        c.beginPath();
        c.arc(0, 0, 40, 0, 6.3);
        c.stroke();
        const bg = c.createRadialGradient(-8, -8, 2, 0, 0, 26);
        bg.addColorStop(0, "#f39a4a");
        bg.addColorStop(1, "#b9541a");
        c.fillStyle = bg;
        c.beginPath();
        c.arc(0, -3, 24, 0, 6.3);
        c.fill();
        c.strokeStyle = "#2a1206";
        c.lineWidth = 1.6;
        c.beginPath();
        c.moveTo(-24, -3);
        c.lineTo(24, -3);
        c.moveTo(0, -27);
        c.lineTo(0, 21);
        c.moveTo(-15, -22);
        c.quadraticCurveTo(-4, -3, -15, 16);
        c.moveTo(15, -22);
        c.quadraticCurveTo(4, -3, 15, 16);
        c.stroke();
        c.font = "italic 900 17px system-ui";
        c.textAlign = "center";
        c.lineWidth = 3;
        c.strokeStyle = "rgba(10,12,22,.9)";
        c.strokeText(DECAL + " 2K27", 0, 33);
        c.fillStyle = "#fff";
        c.fillText(DECAL + " 2K27", 0, 33);
        c.restore();
      }
      // wordmark decals in front of each bench area (along the near sideline)
      c.font = "italic 900 16px system-ui";
      c.textAlign = "center";
      c.fillStyle = "rgba(255,255,255,.16)";
      for (const x of [300, 640]) c.fillText("2K27", x, 488);
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
    // Surface maps: per-board varnish roughness + grain (the light catches some boards more than others), seams as bump.
    const [rc, r2] = cv(mob ? 1024 : 2048, mob ? 512 : 1024),
      [bc2, b2c] = cv(mob ? 1024 : 2048, mob ? 512 : 1024);
    {
      const W = rc.width,
        H = rc.height,
        bh = Math.max(2, Math.round((1.9 * H) / 500));
      let sd = 11;
      const rn = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
      b2c.fillStyle = "#808080";
      b2c.fillRect(0, 0, W, H);
      for (let y = 0; y < H; y += bh) {
        let x = -rn() * 150;
        while (x < W) {
          const L = 130 + rn() * 260,
            g = 95 + rn() * 55; // roughness ~0.37..0.59
          r2.fillStyle = `rgb(0,${g | 0},0)`;
          r2.fillRect(x, y, L, bh);
          for (let k = 0; k < 4; k++) {
            r2.fillStyle = `rgba(0,${(g + 30) | 0},0,.5)`;
            r2.fillRect(x + rn() * L, y + rn() * bh, 10 + rn() * 60, 1);
          }
          b2c.fillStyle = "#5a5a5a";
          b2c.fillRect(x, y, 1, bh); // butt joint
          x += L;
        }
        b2c.fillStyle = "#606060";
        b2c.fillRect(0, y, W, 1); // seam between boards
      }
    }
    const rTex = new THREE.CanvasTexture(rc),
      bTex = new THREE.CanvasTexture(bc2);
    rTex.anisotropy = bTex.anisotropy = maxAniso();
    const floorMat = new THREE.MeshPhysicalMaterial({
      map: tex,
      roughness: 1,
      roughnessMap: rTex,
      bumpMap: bTex,
      bumpScale: 0.6,
      clearcoat: 0.35,
      clearcoatRoughness: 0.22,
      envMapIntensity: 0.35,
    });
    mipBias(floorMat);
    const fl = ad(new THREE.PlaneGeometry(94, 50), floorMat, 0, 0, 0);
    fl.rotation.x = -Math.PI / 2;
    fl.castShadow = false;
    // CC0 ambientCG maple (KTX2, gfxtex.ts) on Medium+: real plank grain + normal + roughness. WebGL multiplies the
    // wood colour under the painted court (detail(); the canvas then drops its own boards); WebGPU keeps the canvas
    // boards and takes the normal / roughness maps only.
    let texReq = false;
    const texLoad = () => {
      if (texReq || V.QL < 1) return;
      texReq = true;
      const own = (t: THREE.Texture, rx: number, ry: number) => {
        const c = t.clone();
        c.repeat.set(rx, ry);
        c.anisotropy = maxAniso();
        c.needsUpdate = true;
        return c;
      };
      gfxTex(R, "wood").then((w) => {
        if (!w) return;
        const rx = 15,
          ry = 8;
        floorMat.normalMap = own(w.normalMap, rx, ry);
        floorMat.normalScale.set(0.45, 0.45);
        floorMat.roughnessMap = own(w.roughnessMap, rx, ry);
        floorMat.roughness = 0.7;
        floorMat.bumpMap = null;
        if (!GPU) {
          detail(floorMat, w.map, [rx, ry], 0.9);
          woodOn = true;
          pcK = ""; // redraw the court canvas without its own boards
        }
        floorMat.needsUpdate = true;
      });
      gfxTex(R, "asphalt").then((a) => {
        if (!a) return;
        stM.normalMap = own(a.normalMap, 10, 5.5);
        stM.normalScale.set(0.8, 0.8);
        dryRough = own(a.roughnessMap, 10, 5.5);
        if (!GPU) detail(stM, a.map, [10, 5.5], 0.75);
        wxK = ""; // re-apply the weather (roughness map: dry asphalt vs puddles)
        stM.needsUpdate = true;
      });
    };
    // ---- street court (Street 21 / King of the Court): asphalt, painted lines, a chain-link fence, streetlights ----
    const STREET: THREE.Object3D[] = [];
    const stM = new THREE.MeshStandardMaterial({ roughness: 0.96, metalness: 0 }),
      apM = new THREE.MeshStandardMaterial({ color: 0x2b2c30, roughness: 1 }),
      lampM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd9a0).multiplyScalar(4) }),
      lampL: THREE.SpotLight[] = [];
    let dryRough: THREE.Texture | null = null,
      wxK = "";
    {
      const c = document.createElement("canvas");
      c.width = 2048;
      c.height = 1090;
      const x = c.getContext("2d")!,
        sx = 2048 / 94,
        sy = 1090 / 50,
        P2 = (fx: number, fz: number): [number, number] => [(fx + 47) * sx, (fz + 25) * sy];
      x.fillStyle = "#3b3d42";
      x.fillRect(0, 0, 2048, 1090);
      for (let i = 0; i < 26000; i++) {
        const g = 40 + Math.random() * 40;
        x.fillStyle = `rgba(${g},${g},${g + 4},${0.35 + Math.random() * 0.4})`;
        x.fillRect(Math.random() * 2048, Math.random() * 1090, 2 + Math.random() * 3, 2 + Math.random() * 3);
      }
      for (let i = 0; i < 14; i++) {
        // cracks and old patches
        x.strokeStyle = "rgba(20,20,22,.55)";
        x.lineWidth = 2;
        x.beginPath();
        let px = Math.random() * 2048,
          py = Math.random() * 1090;
        x.moveTo(px, py);
        for (let j = 0; j < 8; j++) x.lineTo((px += (Math.random() - 0.5) * 90), (py += (Math.random() - 0.5) * 90));
        x.stroke();
      }
      x.strokeStyle = "rgba(240,240,236,.85)";
      x.lineWidth = 6;
      const ln = (a: number, b: number, c2: number, d: number) => {
        x.beginPath();
        x.moveTo(...P2(a, b));
        x.lineTo(...P2(c2, d));
        x.stroke();
      };
      x.strokeRect(...P2(-47, -25), 94 * sx, 50 * sy);
      ln(0, -25, 0, 25);
      x.beginPath();
      x.ellipse(...P2(0, 0), 6 * sx, 6 * sy, 0, 0, 6.3);
      x.stroke();
      for (const s of [-1, 1]) {
        const hx = s * 41.75;
        x.strokeRect(...P2(s < 0 ? -47 : 47 - 19, -8), 19 * sx, 16 * sy);
        x.beginPath();
        x.ellipse(...P2(s * (47 - 19), 0), 6 * sx, 6 * sy, 0, 0, 6.3);
        x.stroke();
        ln(s * 47, -22, s * (47 - 14), -22);
        ln(s * 47, 22, s * (47 - 14), 22);
        x.beginPath();
        x.ellipse(...P2(hx, 0), 23.75 * sx, 23.75 * sy, 0, s < 0 ? -1.19 : Math.PI - 1.19, s < 0 ? 1.19 : Math.PI + 1.19);
        x.stroke();
      }
      const st = new THREE.Mesh(new THREE.PlaneGeometry(94, 50), stM);
      stM.map = TX2(c);
      mipBias(stM);
      st.rotation.x = -Math.PI / 2;
      st.position.y = 0.012;
      st.receiveShadow = true;
      S.add(st);
      STREET.push(st);
      // apron beyond the lines
      const ap = new THREE.Mesh(new THREE.PlaneGeometry(130, 80), apM);
      ap.rotation.x = -Math.PI / 2;
      ap.position.y = 0.006;
      ap.receiveShadow = true;
      S.add(ap);
      STREET.push(ap);
      // chain-link fence: a diamond-mesh alpha texture on four panels
      const fc = document.createElement("canvas");
      fc.width = fc.height = 64;
      const fx2 = fc.getContext("2d")!;
      fx2.strokeStyle = "#c7ccd2";
      fx2.lineWidth = 3;
      fx2.beginPath();
      fx2.moveTo(0, 32);
      fx2.lineTo(32, 0);
      fx2.lineTo(64, 32);
      fx2.lineTo(32, 64);
      fx2.closePath();
      fx2.stroke();
      const ft = TX2(fc);
      ft.wrapS = ft.wrapT = THREE.RepeatWrapping;
      for (const [w, px, pz, ry] of [
        [120, 0, -34, 0],
        [120, 0, 34, 0],
        [68, -60, 0, Math.PI / 2],
        [68, 60, 0, Math.PI / 2],
      ] as const) {
        const t2 = ft.clone();
        t2.repeat.set(w / 1.2, 12 / 1.2);
        t2.needsUpdate = true;
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 12), new THREE.MeshStandardMaterial({ map: t2, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.4 }));
        m.position.set(px, 6, pz);
        m.rotation.y = ry;
        S.add(m);
        STREET.push(m);
      }
      // streetlight poles with warm lamps
      for (const [px, pz] of [
        [-30, -32],
        [30, -32],
        [-30, 32],
        [30, 32],
      ]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 26, 10), new THREE.MeshStandardMaterial({ color: 0x3a3d44, metalness: 0.7, roughness: 0.5 }));
        pole.position.set(px, 13, pz);
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.5, 1.2), lampM);
        lamp.position.set(px, 26, pz * 0.92);
        // the lamp's light (night / rain / dusk only: visibility follows the weather)
        const sl = new THREE.SpotLight(0xffd9a0, 0, 0, 0.75, 0.6, 1);
        sl.position.set(px, 25.6, pz * 0.92);
        sl.target.position.set(px * 0.4, 0, pz * 0.3);
        lampL.push(sl);
        S.add(pole, lamp, sl, sl.target);
        STREET.push(pole, lamp, sl);
      }
      for (const o of STREET) o.visible = false;
    }
    let streetOn = false,
      wxNow: Wx = "day";
    // ---- street weather / time of day (graphics v6): sky dome + stars, sun / moon, lamps, rain + snow, wet asphalt
    const domeG = new THREE.SphereGeometry(320, 32, 16),
      dome = new THREE.Mesh(domeG, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    domeG.setAttribute("color", new THREE.BufferAttribute(new Float32Array(domeG.attributes.position.count * 3), 3));
    dome.renderOrder = -1;
    dome.visible = false;
    S.add(dome);
    STREET.push(dome);
    const starG = new THREE.BufferGeometry(),
      sp0: number[] = [];
    for (let i = 0; i < 500; i++) {
      const a = Math.random() * 6.283,
        e = 0.12 + Math.pow(Math.random(), 0.7) * 1.4;
      sp0.push(Math.cos(e) * Math.cos(a) * 300, Math.sin(e) * 300, Math.cos(e) * Math.sin(a) * 300);
    }
    starG.setAttribute("position", new THREE.Float32BufferAttribute(sp0, 3));
    const stars = new THREE.Points(starG, new THREE.PointsMaterial({ color: 0xdfe8ff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 }));
    stars.visible = false;
    S.add(stars);
    const precip = makePrecip(S),
      pud = puddleMaps();
    let snowAmt = 0;
    function applyWx(w: Wx) {
      const k = SKY[w],
        zc = new THREE.Color(k.z),
        hc = new THREE.Color(k.h),
        gc = new THREE.Color(k.g),
        pa = domeG.attributes.position,
        ca = domeG.attributes.color as THREE.BufferAttribute,
        t = new THREE.Color();
      for (let i = 0; i < pa.count; i++) {
        const y = pa.getY(i) / 320;
        if (y >= 0) t.copy(hc).lerp(zc, Math.pow(y, 0.55));
        else t.copy(hc).lerp(gc, Math.min(1, -y * 6));
        if (w === "sunset") {
          // the glow around the setting sun
          const ang = Math.atan2(pa.getZ(i), pa.getX(i)) - k.az,
            g = Math.max(0, Math.cos(ang)) * Math.max(0, 1 - Math.abs(y) * 2.5);
          t.lerp(new THREE.Color(0xffb070), g * 0.6);
        }
        ca.setXYZ(i, t.r, t.g, t.b);
      }
      ca.needsUpdate = true;
      stars.visible = w === "night";
      (S.background as THREE.Color).set(k.h);
      const f = S.fog as THREE.Fog;
      f.color.set(k.h);
      f.near = k.fog * 0.3;
      f.far = k.fog;
      sun.color.set(k.sun);
      sun.intensity = k.si * PI;
      sun.position.set(Math.cos(k.el) * Math.cos(k.az) * 80, Math.max(12, Math.sin(k.el) * 80), Math.cos(k.el) * Math.sin(k.az) * 80);
      Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 5, far: 220 });
      sun.shadow.camera.updateProjectionMatrix();
      hemi.color.copy(zc).lerp(new THREE.Color(1, 1, 1), 0.45);
      hemi.groundColor.set(k.g);
      hemi.intensity = k.hi * PI;
      back.intensity = 0.25 * k.si * PI;
      fill.intensity = 0.1 * k.si * PI;
      R.toneMappingExposure = k.ex;
      RIM.value.setRGB(...((w === "sunset" ? [1, 0.6, 0.36] : w === "night" ? [0.22, 0.27, 0.4] : [0.48, 0.52, 0.58]) as [number, number, number]));
      for (const l of lampL) (l.intensity = k.lamps * 34 * PI), (l.visible = k.lamps > 0.05);
      lampM.color.set(0xffd9a0).multiplyScalar(0.5 + 5 * k.lamps);
      envSet("sky:" + w, () => skyEnv(w));
      // surface: wet (rain: dark, glossy, puddles that mirror where the Reflector is on), snow cover, dry
      const wet = w === "rain";
      snowAmt = w === "snow" ? 1 : 0;
      stM.roughnessMap = wet ? pud.rough : dryRough;
      stM.roughness = wet ? 1 : dryRough ? 1 : 0.96;
      stM.color.set(wet ? 0x8c8c90 : w === "snow" ? 0xe4e8ee : 0xffffff);
      stM.envMapIntensity = wet ? 1.4 : 1;
      apM.color.set(w === "snow" ? 0xd4d9e0 : wet ? 0x1d1e21 : 0x2b2c30);
      apM.roughness = wet ? 0.35 : w === "snow" ? 0.85 : 1;
      stM.needsUpdate = apM.needsUpdate = true;
    }
    /** puddles show the planar reflection (High+ in the rain): the asphalt goes see-through where the mask is dark */
    const puddleMirror = (on: boolean) => {
      const want = on ? pud.alpha : null;
      if (stM.alphaMap === want) return;
      stM.alphaMap = want;
      stM.transparent = on;
      stM.needsUpdate = true;
    };
    const arenaLights = () => {
      (S.background as THREE.Color).set(0x06070d);
      const f = S.fog as THREE.Fog;
      f.color.set(0x06070d);
      f.near = 110;
      f.far = 230;
      sun.color.set(0xfff3e2);
      sun.intensity = 0.95 * PI;
      sun.position.set(4, 80, 7);
      Object.assign(sun.shadow.camera, { left: -54, right: 54, top: 32, bottom: -32, near: 5, far: 150 });
      sun.shadow.camera.updateProjectionMatrix();
      hemi.color.set(0xdfe8ff);
      hemi.groundColor.set(0x2a1d10);
      hemi.intensity = 0.16 * PI;
      back.intensity = 0.38 * PI;
      fill.intensity = 0.18 * PI;
      R.toneMappingExposure = 0.9;
      RIM.value.setRGB(0.55, 0.62, 0.75);
      envSet("arena:" + (PC[0] || ""), () => arenaEnv(PC[0] || "#7b3fb5"));
      stars.visible = false;
    };
    let wxAuto: Wx = "day";
    function setStreet(on: boolean) {
      streetOn = on;
      if (on) wxAuto = autoWx();
      for (const o of STREET) o.visible = on;
      for (const o of ARENA) o.visible = !on;
      for (const o of hiOnly) o.visible = !on && V.QL >= 2;
      fl.visible = !on;
      for (const b of bench) b.gl.G.visible = !on;
      if (mirror) mirror.position.y = on ? 0.009 : -0.02; // street: between the apron and the asphalt (puddles)
      wxK = "";
      if (!on) arenaLights();
    }
    arenaLights();
    // planar reflection (WebGL renderer only; on WebGPU the glossy floor keeps its environment reflections)
    const mirror: any = GPU ? null : new Reflector(new THREE.PlaneGeometry(94, 50), { textureWidth: mob ? 1024 : 2048, textureHeight: mob ? 576 : 1152, color: 0x777777, clipBias: 0.003 });
    if (mirror) {
      mirror.rotation.x = -Math.PI / 2;
      mirror.position.y = -0.02;
      mirror.visible = false;
      S.add(mirror);
    }
    const setMirror = (on: boolean) => {
      if (!mirror || mirror.visible === on) return;
      mirror.visible = on;
      floorMat.transparent = on;
      floorMat.opacity = on ? 0.88 : 1;
      floorMat.needsUpdate = true;
    };
    // Contact shadows: soft dark blobs under every player and the ball (always on, even without the shadow map).
    const [shc, shx] = cv(128, 128);
    {
      const gg = shx.createRadialGradient(64, 64, 4, 64, 64, 62);
      gg.addColorStop(0, "rgba(0,0,0,.62)");
      gg.addColorStop(0.55, "rgba(0,0,0,.28)");
      gg.addColorStop(1, "rgba(0,0,0,0)");
      shx.fillStyle = gg;
      shx.fillRect(0, 0, 128, 128);
    }
    const blobM = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shc), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
      blobs = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), blobM, 11);
    blobs.frustumCulled = false;
    blobs.renderOrder = 2;
    S.add(blobs);
    const BM = new THREE.Object3D();
    function blobUpd() {
      let n = 0;
      const put2 = (x: number, y: number, z: number, sz: number) => {
        const w = W3(x, y, 0),
          k = Math.max(0.15, 1 - z / 70);
        BM.position.set(w[0], 0.012, w[2]);
        BM.scale.set(sz * k, 1, sz * k);
        BM.updateMatrix();
        blobs.setMatrixAt(n++, BM.matrix);
      };
      for (const p of P) if (n < 10 && !p.off) put2(p.x, p.y, p.z, 2.6 * p.bk);
      put2(B.x, B.y, B.z, 1.1);
      blobs.count = n;
      blobs.instanceMatrix.needsUpdate = true;
    }
    const apron = ad(new THREE.PlaneGeometry(150, 100), M(0x12152a, { roughness: 0.7 }), 0, -0.03, 0);
    apron.rotation.x = -Math.PI / 2;
    apron.castShadow = false;

    // ---------------- stands: tiers + instanced fans (body + head) ----------------
    const tierM = M(0x161a2e, { roughness: 0.85 }),
      tierG = new THREE.BoxGeometry(1, 1, 1);
    const tiers: [number, number, number, number, number][] = []; // x, y, z, w, d per step box
    // graphics v6: lower bowl (rows 0-11) + upper deck (12-19) above an LED fascia, aisles with stairs (gfx3d bowl())
    for (let r = 0; r < ROWS; r++) {
      const y = rowY(r),
        off = rowOff(r),
        d = (r >= 12 ? rowOff(r) - rowOff(r - 1) : 1.6) + 0.02;
      tiers.push([0, y, -(25 + off), 100 + off * 2, d], [0, y, 25 + off, 100 + off * 2, d], [-(47 + off), y, 0, d, 50 + off * 2], [47 + off, y, 0, d, 50 + off * 2]);
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
    S.add(tierI); ARENA.push(tierI);
    const CN = 3600,
      cpos: number[][] = [],
      cc = new THREE.Color(),
      bodyI = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.3, 0.55, 3, 8), M(0xffffff, { roughness: 0.85 }), CN),
      headI = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 10, 8), M(0xffffff, { roughness: 0.7 }), CN);
    const SKN = ["#f1c27d", "#c68642", "#8d5524", "#e0ac69", "#6b4226", "#ffdbac"];
    for (let i = 0; i < CN; i++) {
      const sd = i % 4,
        r = Math.floor(i / 4) % ROWS,
        y = rowY(r) + 0.55,
        off = rowOff(r);
      let x = 0,
        z = 0,
        ry;
      if (sd < 2) {
        for (let k = 0; k < 6 && (k === 0 || inAisle(sd, x)); k++) x = (Math.random() - 0.5) * (94 + off * 2 + 4);
        z = (sd ? 1 : -1) * (25 + off);
        ry = sd ? Math.PI : 0;
      } else {
        for (let k = 0; k < 6 && (k === 0 || inAisle(sd, z)); k++) z = (Math.random() - 0.5) * (50 + off * 2 - 4);
        x = (sd === 2 ? -1 : 1) * (47 + off);
        ry = sd === 2 ? Math.PI / 2 : -Math.PI / 2;
      }
      // .., seed, row, arena angle, body size, house-light dimming (the upper deck sits in the dark)
      cpos.push([x, y, z, ry, Math.random() * 6.28, Math.random(), r, Math.atan2(z, x), 0.86 + Math.random() * 0.3, r >= 12 ? 0.42 : 0.72 - r * 0.012]);
      // fans wear their team's color more often than not
      const team = Math.random();
      if (team < 0.32) cc.set(PC[0] || "#7b3fb5");
      else if (team < 0.6) cc.set(PC[1] || "#1d428a");
      else cc.setHSL(Math.random(), 0.35, 0.25 + Math.random() * 0.4);
      bodyI.setColorAt(i, cc.multiplyScalar(cpos[i][9]));
      headI.setColorAt(i, cc.set(SKN[i % SKN.length]).multiplyScalar(cpos[i][9]));
    }
    for (const m of [bodyI, headI]) {
      m.instanceColor!.needsUpdate = true;
      m.frustumCulled = false;
      S.add(m); ARENA.push(m);
    }
    // Front rows get arms; some fans twirl towels; a few hold signs. Everyone sits until the moment lifts them.
    const AN = CN,
      armI = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.08, 0.55, 2, 6), M(0xffffff, { roughness: 0.75 }), AN * 2),
      towI = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.55, 0.4), new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.9 }), 400);
    for (let i = 0; i < AN; i++) {
      armI.setColorAt(i * 2, cc.set(SKN[i % SKN.length]));
      armI.setColorAt(i * 2 + 1, cc);
    }
    const towelFans: number[] = [];
    for (let i = 0; i < CN && towelFans.length < 400; i++) if (cpos[i][5] < 0.16 && cpos[i][6] < 7) towelFans.push(i);
    towelFans.forEach((fi, k) => towI.setColorAt(k, cc.set(k % 3 === 0 ? PC[0] || "#ffd23f" : "#f4f4f4")));
    for (const m of [armI, towI]) {
      m.instanceColor!.needsUpdate = true;
      m.frustumCulled = false;
      S.add(m); ARENA.push(m);
    }
    // signs (canvas text) held by front-row fans
    const SIGNS = ["DEFENSE!", "MVP", "LET'S GO!", "SPLASH", "#77", "AND ONE", "POSTERIZED", "BUCKETS", "D-FENSE", "WE BELIEVE", "CLUTCH", "2K27"];
    const signs: { m: THREE.Mesh; i: number }[] = [];
    for (let k = 0, i = 0; k < 24 && i < CN; i++) {
      if (cpos[i][6] > 2 || cpos[i][5] < 0.5 || cpos[i][5] > 0.58) continue;
      const [sc2, sx2] = cv(256, 128);
      sx2.fillStyle = k % 2 ? "#fdfdfd" : "#ffe14d";
      sx2.fillRect(0, 0, 256, 128);
      sx2.fillStyle = k % 3 === 0 ? "#c8102e" : "#14182c";
      sx2.font = "900 46px system-ui";
      sx2.textAlign = "center";
      sx2.fillText(SIGNS[k % SIGNS.length], 128, 82);
      const sm = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.75), new THREE.MeshStandardMaterial({ map: TX2(sc2), roughness: 0.8, side: THREE.DoubleSide }));
      S.add(sm); ARENA.push(sm);
      signs.push({ m: sm, i });
      k++;
    }
    let exc = 0.3,
      waveT = 0,
      waveA = 0;
    const AX = new THREE.Vector3(),
      HQ = new THREE.Quaternion();
    function crowdUpd(n: number) {
      if (waveT > 0) waveT -= 1 / 30;
      let ai = 0,
        ti = 0;
      const wf = waveA + (6 - waveT) * 1.6; // wave front angle sweeping around the bowl
      for (let i = 0; i < n; i++) {
        const c = cpos[i],
          seed = c[5],
          // stand: when the noise beats this fan's threshold, or the wave passes
          wv = waveT > 0 ? Math.max(0, 1 - Math.abs(Math.atan2(Math.sin(c[7] - wf), Math.cos(c[7] - wf))) / 0.35) : 0,
          st2 = Math.max(exc > 0.45 + seed * 0.5 ? 1 : 0, wv),
          hop = Math.max(0, Math.sin(T * (3 + exc * 5) + c[4])) * 0.3 * exc * st2;
        dm.rotation.set(0, c[3], 0);
        dm.scale.set(c[8], (0.72 + 0.28 * st2) * c[8], c[8]);
        dm.position.set(c[0], c[1] - 0.28 * (1 - st2) + hop, c[2]);
        dm.updateMatrix();
        bodyI.setMatrixAt(i, dm.matrix);
        dm.scale.set(1, 1, 1);
        dm.position.y += 0.62 + 0.13 * st2;
        dm.updateMatrix();
        headI.setMatrixAt(i, dm.matrix);
        const hy = dm.position.y;
        // arms (front rows): up and pumping when standing, else hidden at the sides
        if (c[6] < 5 && ai < AN * 2 - 1) {
          const up = st2 * (wv > 0.3 ? 1 : 0.6 + 0.4 * Math.sin(T * 6 + c[4])),
            sinA = Math.sin(c[3]),
            cosA = Math.cos(c[3]);
          for (const sd of [-1, 1]) {
            const ox = cosA * 0.36 * sd,
              oz = -sinA * 0.36 * sd;
            dm.position.set(c[0] + ox, hy - 0.45 + up * 0.75, c[2] + oz);
            AX.set(cosA, 0, -sinA);
            HQ.setFromAxisAngle(AX, sd * (0.15 + 0.25 * (1 - up)));
            dm.quaternion.copy(HQ);
            dm.scale.setScalar(up > 0.05 ? 1 : 0.001);
            dm.updateMatrix();
            armI.setMatrixAt(ai++, dm.matrix);
          }
          dm.quaternion.identity();
        }
        // towel twirl overhead
        if (ti < towelFans.length && towelFans[ti] === i) {
          const tw = st2 > 0.5 ? 1 : 0;
          dm.position.set(c[0], hy + 0.9 * tw, c[2]);
          dm.rotation.set(0, T * 9 + c[4], 0.4);
          dm.scale.setScalar(tw ? 1 : 0.001);
          dm.updateMatrix();
          towI.setMatrixAt(ti++, dm.matrix);
        }
      }
      for (const sg of signs) {
        const c = cpos[sg.i],
          up = exc > 0.5 || waveT > 0 ? 1 : 0;
        sg.m.visible = sg.i < n;
        sg.m.position.set(c[0] + Math.sin(c[3]) * 0.5, c[1] + 0.55 + up * 0.85 + Math.sin(T * 4 + c[4]) * 0.08 * up, c[2] + Math.cos(c[3]) * 0.5);
        sg.m.rotation.set(0, c[3], Math.sin(T * 3 + c[4]) * 0.08 * up);
      }
      bodyI.count = headI.count = n;
      armI.count = ai;
      towI.count = ti;
      bodyI.instanceMatrix.needsUpdate = headI.instanceMatrix.needsUpdate = armI.instanceMatrix.needsUpdate = towI.instanceMatrix.needsUpdate = true;
    }
    // courtside row: detailed fans on chairs along the sideline (the ones the camera sees up close); they react
    const CS: any = { pos: [] as number[][], react: null as any };
    {
      const N = 44,
        chairI = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 1.1, 0.8), M(0x1c1f30, { roughness: 0.6 }), N),
        cbI = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.32, 0.6, 4, 12), M(0xffffff, { roughness: 0.8 }), N),
        chI = new THREE.InstancedMesh(new THREE.SphereGeometry(0.24, 16, 12), M(0xffffff, { roughness: 0.6 }), N);
      for (let k = 0; k < N; k++) {
        const side = k % 2 ? 1 : -1,
          x = -36 + (Math.floor(k / 2) / (N / 2 - 1)) * 72 + (Math.random() - 0.5),
          z = side * 27.6;
        if (Math.abs(x) < 6) {
          // scorer's table gap: park this seat out of sight (instances default to the origin = center court)
          dm.position.set(0, -50, 0);
          dm.scale.setScalar(0.001);
          dm.updateMatrix();
          for (const m of [chairI, cbI, chI]) m.setMatrixAt(k, dm.matrix);
          continue;
        }
        dm.rotation.set(0, side > 0 ? Math.PI : 0, 0);
        dm.scale.set(1, 1, 1);
        dm.position.set(x, 0.55, z + side * 0.3);
        dm.updateMatrix();
        chairI.setMatrixAt(k, dm.matrix);
        dm.position.set(x, 1.45, z);
        dm.updateMatrix();
        cbI.setMatrixAt(k, dm.matrix);
        cbI.setColorAt(k, cc.setHSL(Math.random(), 0.3, 0.2 + Math.random() * 0.45));
        dm.position.set(x, 2.25, z);
        dm.updateMatrix();
        chI.setMatrixAt(k, dm.matrix);
        chI.setColorAt(k, cc.set(SKN[k % SKN.length]));
        CS.pos[k] = [x, z, side];
      }
      for (const m of [chairI, cbI, chI]) {
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
        m.castShadow = true;
        S.add(m); ARENA.push(m);
      }
      // arms (two per fan) so they can throw their hands up, hold their heads on a near miss and duck a flying ball
      const armI2 = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.07, 0.5, 3, 8), M(0xffffff, { roughness: 0.7 }), N * 2);
      for (let k = 0; k < N * 2; k++) armI2.setColorAt(k, cc.set(SKN[(k >> 1) % SKN.length]));
      armI2.instanceColor!.needsUpdate = true;
      armI2.frustumCulled = false;
      S.add(armI2);
      ARENA.push(armI2);
      Object.assign(CS, { N, cbI, chI, armI2 });
    }
    const UPV = new THREE.Vector3(0, 1, 0),
      AV = new THREE.Vector3(),
      AQ = new THREE.Quaternion();
    /** Courtside reactions: "ooh" (hands on heads) after a near miss, "duck" when a ball flies into the seats near x,
     *  arms up when the building is loud. Called every frame (44 fans). */
    function courtside(dt: number, loud: number) {
      const { N, cbI, chI, armI2 } = CS,
        r = CS.react;
      if (r) r.t -= dt;
      if (r && r.t <= 0) CS.react = null;
      for (let k = 0; k < N; k++) {
        const ps = CS.pos[k];
        if (!ps) {
          dm.position.set(0, -50, 0);
          dm.scale.setScalar(0.001);
          dm.updateMatrix();
          armI2.setMatrixAt(k * 2, dm.matrix);
          armI2.setMatrixAt(k * 2 + 1, dm.matrix);
          continue;
        }
        const [x, z, side] = ps,
          rr = CS.react,
          near = rr && (rr.kind === "ooh" || (Math.abs(x - rr.x) < 9 && Math.sign(rr.z) === side)),
          kind = near ? rr.kind : loud > 0.85 && (k * 7) % 10 < 7 ? "up" : "sit",
          stand = kind === "up" ? 0.4 : 0,
          duck = kind === "duck" ? 0.35 : 0;
        dm.rotation.set(duck * side * -0.8, side > 0 ? Math.PI : 0, 0);
        dm.scale.set(1, 1, 1);
        dm.position.set(x, 1.45 + stand - duck, z);
        dm.updateMatrix();
        cbI.setMatrixAt(k, dm.matrix);
        const hy = 2.25 + stand - duck * 1.4,
          hz = z + side * duck * 0.4;
        dm.position.set(x, hy, hz);
        dm.updateMatrix();
        chI.setMatrixAt(k, dm.matrix);
        for (const s of [-1, 1]) {
          // shoulder -> hand direction for this reaction
          const sx = x + s * 0.36,
            sy = 1.85 + stand - duck,
            wave = Math.sin(T * 8 + k) * 0.25;
          let dx = 0,
            dy = -0.6,
            dz = -side * 0.5;
          if (kind === "up") (dx = s * 0.2 + wave * s), (dy = 1), (dz = 0);
          else if (kind === "ooh") (dx = -s * 0.25), (dy = 0.75), (dz = -side * 0.15);
          else if (kind === "duck") (dx = -s * 0.35), (dy = 0.55), (dz = -side * 0.45);
          AV.set(dx, dy, dz).normalize();
          AQ.setFromUnitVectors(UPV, AV);
          dm.quaternion.copy(AQ);
          dm.position.set(sx + AV.x * 0.32, sy + AV.y * 0.32, z + AV.z * 0.32);
          dm.scale.set(1, 1, 1);
          dm.updateMatrix();
          dm.quaternion.identity();
          armI2.setMatrixAt(k * 2 + (s > 0 ? 1 : 0), dm.matrix);
        }
      }
      cbI.instanceMatrix.needsUpdate = chI.instanceMatrix.needsUpdate = armI2.instanceMatrix.needsUpdate = true;
    }
    (V as any).crowdReact = (kind: string, gx: number, gy: number) => {
      CS.react = { kind, t: kind === "ooh" ? 1.6 : 1.1, x: (gx - 470) * 0.1, z: (gy - 250) * 0.1 };
    };

    // ---------------- LED ribbons (courtside + upper ring), emissive so bloom catches them ----------------
    const [lc, l] = cv(2048, 64);
    /** LED takeover after a bucket (graphics v6): the scoring team's colour strobes behind the call ("3 POINTS!",
     *  "SLAM!", "AND ONE!"), chevrons race around the bowl; redrawn ~15x/s while it runs (ledFx). */
    const ledFx = { t: 0, txt: "", col: "#ffd23f" };
    function ledDraw() {
      if (ledFx.t > 0) {
        const ph = Math.floor(ledFx.t * 8) % 2;
        l.fillStyle = ph ? ledFx.col : "#06070d";
        l.fillRect(0, 0, 2048, 64);
        l.font = "italic 900 44px system-ui";
        for (let i = 0; i < 4; i++) {
          const x0 = i * 512;
          l.fillStyle = ph ? "#ffffff" : ledFx.col;
          l.fillText(ledFx.txt, x0 + 30, 48);
          l.fillStyle = ph ? "#06070d" : "#ffd23f";
          for (let k = 0; k < 3; k++) {
            const cx = x0 + 400 + k * 26 + ((ledFx.t * 120) % 26);
            l.beginPath();
            l.moveTo(cx, 12);
            l.lineTo(cx + 14, 32);
            l.lineTo(cx, 52);
            l.lineTo(cx + 8, 52);
            l.lineTo(cx + 22, 32);
            l.lineTo(cx + 8, 12);
            l.fill();
          }
        }
        return;
      }
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
      S.add(brd); ARENA.push(brd);
    }
    // the bowl (upper deck fascia LED band, stairs, rails, shell, suites, tunnels, roof trusses), scorer's table,
    // baseline photographers (gfx3d.ts)
    bowl(S, ARENA, ledM, PC[0] || "#7b3fb5");
    scorerTable(S, ARENA, ledM);
    // High+ only (Medium / Chromebook must not pay draw calls for the photographers)
    const hiOnly: THREE.Object3D[] = photographers(S, ARENA);

    // ---------------- hoops: padded stanchion, arm, glass, shot clock, rim, tube net ----------------
    const shotClocks: { ctx: CanvasRenderingContext2D; tex: THREE.Texture; k: string }[] = [];
    // per hoop: the parts that shake on a dunk (rim, glass, frame, square, pad, bracket) with their rest heights
    const hoopParts: { o: THREE.Object3D; y: number; k: number; x: number }[][] = [[], []];
    // Physics v3: the rim tilts with the sim's wobble (NETS[b].tx/ty), the board parts shake (NETS[b].bs), the glass
    // vanishes into shards while a shattered board is replaced (NETS[b].shT)
    const rimQ: { o: THREE.Object3D; q0: THREE.Quaternion }[] = [],
      glassO: THREE.Object3D[] = [];
    const glints: THREE.Sprite[] = [];
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
      const bpad = ad(new THREE.BoxGeometry(0.2, 0.2, 6.1), M(0xd23b1a, { roughness: 0.5 }), sg * 43, 9.68, 0); // bottom pad
      const rim = ad(new THREE.TorusGeometry(0.75, 0.07, 14, 48), M(0xff4d1a, { metalness: 0.7, roughness: 0.22 }), hx, 10, 0);
      rim.rotation.x = Math.PI / 2;
      rimQ.push({ o: rim, q0: rim.quaternion.clone() });
      glassO.push(bb);
      const brk = ad(new THREE.BoxGeometry(0.6, 0.14, 0.42), M(0xff4d1a, { metalness: 0.5, roughness: 0.35 }), sg * 42.6, 10, 0);
      for (const [o, k] of [
        [rim, 1],
        [brk, 0.8],
        [bb, 0.35],
        [frame, 0.35],
        [sq, 0.35],
        [bpad, 0.35],
      ] as [THREE.Object3D, number][])
        hoopParts[b].push({ o, y: o.position.y, k, x: o.position.x });
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
    // glints: little star sprites that flash on the rim and the glass edges now and then (bloom makes them sparkle)
    {
      const [gc, gx] = cv(64, 64);
      const gg = gx.createRadialGradient(32, 32, 0, 32, 32, 30);
      gg.addColorStop(0, "rgba(255,255,255,1)");
      gg.addColorStop(0.15, "rgba(255,250,235,.6)");
      gg.addColorStop(1, "rgba(255,255,255,0)");
      gx.fillStyle = gg;
      gx.fillRect(0, 0, 64, 64);
      gx.fillStyle = "rgba(255,255,255,.85)";
      gx.fillRect(31, 2, 2, 60);
      gx.fillRect(2, 31, 60, 2);
      const gm2 = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(gc), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: new THREE.Color(4, 4, 4) });
      for (const b of [0, 1]) {
        const hx = (HXs[b] - 470) * 0.1,
          sg = b ? 1 : -1;
        for (const [x, y, z] of [
          [hx - sg * 0.7, 10.05, 0.2],
          [hx + 0.3, 10.05, -0.65],
          [sg * 42.93, 13.2, 2.9],
          [sg * 42.93, 9.72, -2.9],
        ]) {
          const g = new THREE.Sprite(gm2.clone());
          g.position.set(x, y, z);
          g.scale.setScalar(0.001);
          S.add(g);
          glints.push(g);
        }
      }
    }
    // confetti for the final buzzer (winner's colors + gold), instanced paper squares
    const CFN = 700,
      cfI = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.36, 0.24), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.6, metalness: 0.2 }), CFN),
      cfs: number[][] = [];
    cfI.frustumCulled = false;
    cfI.count = 0;
    S.add(cfI);
    let cfOn = 0,
      wasDk = 0;
    const hoopShake = [0, 0];
    // shattered glass: shards burst off the board toward the court, fall and lie on the floor until the new board is up
    const SHN = 160,
      shI = new THREE.InstancedMesh(new THREE.TetrahedronGeometry(0.16), new THREE.MeshPhysicalMaterial({ color: 0xe8f6ff, transparent: true, opacity: 0.6, roughness: 0.05, metalness: 0.1, clearcoat: 1 }), SHN),
      shS: number[][] = [],
      shWas = [0, 0],
      TE = new THREE.Euler(),
      TQ = new THREE.Quaternion();
    shI.frustumCulled = false;
    shI.count = 0;
    S.add(shI);
    function ph3Hoops(dt: number) {
      for (const b of [0, 1]) {
        const N = NETS[b],
          r = rimQ[b];
        if (r) {
          TE.set((N.ty || 0) / SRR, 0, -(N.tx || 0) / SRR);
          r.o.quaternion.copy(TQ.setFromEuler(TE)).multiply(r.q0);
        }
        for (const h of hoopParts[b]) if (h.k < 0.5) h.o.position.x = h.x + (N.bs || 0) * 0.06;
        const sh = (N.shT || 0) > 0;
        if (glassO[b]) glassO[b].visible = !sh;
        if (sh && !shWas[b]) {
          const sg = b ? 1 : -1;
          for (let k = 0; k < SHN / 2; k++) {
            const y = 9.8 + Math.random() * 3.4,
              z = (Math.random() - 0.5) * 5.8;
            shS.push([sg * 42.9, y, z, -sg * (1.5 + Math.random() * 6), 1 + Math.random() * 5, z * 0.8 + (Math.random() - 0.5) * 3, Math.random() * 6, Math.random() * 6]);
          }
          while (shS.length > SHN) shS.shift();
        }
        shWas[b] = sh ? 1 : 0;
      }
      if (!shWas[0] && !shWas[1]) shS.length = 0;
      shI.count = shS.length;
      for (let k = 0; k < shS.length; k++) {
        const s = shS[k];
        if (s[1] > 0.03) {
          s[4] -= 32 * dt;
          s[0] += s[3] * dt;
          s[1] = Math.max(0.03, s[1] + s[4] * dt);
          s[2] += s[5] * dt;
          s[6] += dt * 9;
          if (s[1] <= 0.03) (s[3] *= 0.2), (s[5] *= 0.2);
        }
        dm.position.set(s[0], s[1], s[2]);
        dm.rotation.set(s[6], s[7], 0);
        dm.scale.setScalar(0.6 + (k % 5) * 0.2);
        dm.updateMatrix();
        shI.setMatrixAt(k, dm.matrix);
      }
      dm.rotation.set(0, 0, 0);
      dm.scale.setScalar(1);
      if (shS.length) shI.instanceMatrix.needsUpdate = true;
    }
    function polish(dt: number) {
      ph3Hoops(dt);
      // rim shake: the sim's rim flex (NETS[b].fz, px down: a dunk yanks it, a hard hit rings it, a player hanging on
      // it holds it bent) - the net's top ring rides the same iron, so rim and net move together
      wasDk = B.dk ? 1 : 0;
      for (const b of [0, 1]) {
        const off = -(NETS[b].fz || 0) * 0.1;
        if (Math.abs(off) < 1e-4 && hoopShake[b] === 0) continue;
        hoopShake[b] = Math.abs(off) < 1e-4 ? 0 : 1;
        for (const h of hoopParts[b]) h.o.position.y = h.y + off * h.k;
      }
      // glints
      glints.forEach((g, k) => {
        const f = Math.pow(Math.max(0, Math.sin(T * 0.9 + k * 2.3)), 24);
        g.scale.setScalar(V.QL >= 1 ? 0.15 + f * 1.4 : 0.001);
        (g.material as THREE.SpriteMaterial).opacity = f;
      });
      // confetti
      if (GS === "over" && !cfOn) {
        cfOn = 1;
        if (!streetOn) pyro.fire(2.2);
        const w = sc[0] >= sc[1] ? 0 : 1,
          cols = [PC[w] || "#ffd23f", "#ffd23f", "#ffffff", PC[w] || "#7b3fb5"];
        cfs.length = 0;
        for (let i = 0; i < CFN; i++) {
          cfs.push([(Math.random() - 0.5) * 80, 6 + Math.random() * 26, (Math.random() - 0.5) * 44, Math.random() * 6.28, 0.6 + Math.random() * 1.6, Math.random() * 6.28]);
          cfI.setColorAt(i, new THREE.Color(cols[i % cols.length]));
        }
        cfI.instanceColor!.needsUpdate = true;
        cfI.count = CFN;
      }
      if (GS !== "over" && cfOn) (cfOn = 0), (cfI.count = 0);
      if (cfOn) {
        for (let i = 0; i < CFN; i++) {
          const c = cfs[i];
          c[1] -= dt * (3.2 + Math.sin(T * c[4] + c[5]) * 1.0);
          c[0] += Math.sin(T * 1.3 + c[5]) * dt * 1.2;
          if (c[1] < 0.05) c[1] = 0.05; // settles on the floor
          dm.position.set(c[0], c[1], c[2]);
          dm.rotation.set(T * c[4] + c[3], T * c[4] * 0.7, c[5]);
          dm.scale.set(1, 1, 1);
          dm.updateMatrix();
          cfI.setMatrixAt(i, dm.matrix);
        }
        cfI.instanceMatrix.needsUpdate = true;
        dm.rotation.set(0, 0, 0);
      }
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
    // Net strands as instanced thin cylinders, re-posed from the verlet sim every frame (only the cords: the soft
    // ring ties that hold the mesh's shape are not nylon, drawing them caged the net in stiff hoops).
    const NC = NETS.reduce((a, N) => a + N.c.filter((c: any) => c[4]).length, 0),
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
    let netChain = 0;
    function netUpd() {
      let i = 0;
      // Physics v3: street games hang chain nets (heavier, metal links)
      const ch = chainNet() ? 1 : 0;
      if (ch !== netChain) {
        netChain = ch;
        const m = netI.material as THREE.MeshStandardMaterial;
        m.color.set(ch ? 0xa7adb5 : 0xf4f4f4);
        m.metalness = ch ? 0.9 : 0;
        m.roughness = ch ? 0.35 : 0.9;
      }
      for (const N of NETS)
        for (const c of N.c) {
          if (!c[4]) continue;
          const a = W3(c[0].x, c[0].y, c[0].z),
            b = W3(c[1].x, c[1].y, c[1].z);
          NA.set(a[0], a[1], a[2]);
          NB.set(b[0], b[1], b[2]);
          ND.subVectors(NB, NA);
          const len = ND.length() || 0.001;
          NQ.setFromUnitVectors(UP, ND.multiplyScalar(1 / len));
          dm.position.copy(NA).add(NB).multiplyScalar(0.5);
          dm.quaternion.copy(NQ);
          dm.scale.set(netChain ? 1.9 : 1, len, netChain ? 1.9 : 1);
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
    S.add(jum); ARENA.push(jum);
    let jk = "",
      jumboN = 0,
      liveOn = false;
    // Ultra: a live camera feed on the jumbotron (tight sideline shot of the ball, rendered every 2nd frame at 512x288
    // into the top of each face; the score bar stays below it)
    const liveRT = GPU ? null : new THREE.WebGLRenderTarget(512, 288, { samples: 0, type: THREE.HalfFloatType }), // linear HDR, tone-mapped with the frame
      liveCam = new THREE.PerspectiveCamera(24, 512 / 288, 0.5, 300),
      liveScr: THREE.Mesh[] = [];
    if (liveRT) {
      const lm = new THREE.MeshBasicMaterial({ map: liveRT.texture, toneMapped: false });
      for (const [x, z, ry] of [
        [0, 7.52, 0],
        [0, -7.52, Math.PI],
        [7.52, 0, Math.PI / 2],
        [-7.52, 0, -Math.PI / 2],
      ] as const) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(13.4, 4.6), lm);
        m.position.set(x, 28.3, z);
        m.rotation.y = ry;
        m.visible = false;
        S.add(m);
        ARENA.push(m);
        liveScr.push(m);
      }
    }
    const LT = new THREE.Vector3();
    function liveFeed(on: boolean) {
      if (liveOn !== on) {
        liveOn = on;
        jk = "";
        for (const m of liveScr) m.visible = on;
      }
      if (!on || !liveRT || jumboN & 1) return;
      // the feed: low sideline camera leading the ball
      const bw = W3(B.x, B.y, Math.max(30, B.z));
      LT.set(bw[0], bw[1] * 0.6 + 1.5, bw[2]);
      liveCam.position.lerp(TV.set(bw[0] * 0.85, 5.5, 34), 0.2);
      liveCam.lookAt(LT);
      const au = R.shadowMap.autoUpdate,
        mv = mirror ? mirror.visible : false,
        rt0 = R.getRenderTarget();
      R.shadowMap.autoUpdate = false; // reuse this frame's shadow maps
      if (mirror) mirror.visible = false;
      for (const m of liveScr) m.visible = false;
      R.setRenderTarget(liveRT);
      R.render(S, liveCam);
      R.setRenderTarget(rt0);
      for (const m of liveScr) m.visible = true;
      if (mirror) mirror.visible = mv;
      R.shadowMap.autoUpdate = au;
    }
    /** Live team stats that rotate on the jumbotron's lower panel (every ~6 s). */
    function jStat(): [string, string, string] {
      const R2 = (t: number) => (ROST[t] && ROST[t].length ? ROST[t] : P.filter((p: any) => p.tm === t)),
        sum = (t: number, k: string) => R2(t).reduce((a: number, p: any) => a + (p.stt[k] || 0), 0),
        pct = (t: number) => (sum(t, "fga") ? Math.round((100 * sum(t, "fgm")) / sum(t, "fga")) + "%" : "—"),
        top = (t: number) => R2(t).slice().sort((a: any, b: any) => b.stt.pts - a.stt.pts)[0];
      if (!gameLike()) return ["", "", ""];
      if (TS.run[1] >= 8) return [TS.run[0] ? "" : TS.run[1] + "-0", "RUN", TS.run[0] ? TS.run[1] + "-0" : ""];
      switch (Math.floor(T / 6) % 7) {
        case 5:
          return [String(TS.xs.paint[0]), "POINTS IN THE PAINT", String(TS.xs.paint[1])];
        case 6:
          return [String(TS.xs.fb[0]), "FAST BREAK POINTS", String(TS.xs.fb[1])];
        case 0:
          return [pct(0), "FIELD GOAL %", pct(1)];
        case 1:
          return [sum(0, "tpm") + "/" + sum(0, "tpa"), "3-POINTERS", sum(1, "tpm") + "/" + sum(1, "tpa")];
        case 2:
          return [String(sum(0, "reb")), "REBOUNDS", String(sum(1, "reb"))];
        case 3: {
          const a = top(0),
            b = top(1);
          return [a ? a.n.split(" ").pop()!.toUpperCase().slice(0, 10) + " " + a.stt.pts : "", "TOP SCORERS", b ? b.n.split(" ").pop()!.toUpperCase().slice(0, 10) + " " + b.stt.pts : ""];
        }
        default:
          return [String(sum(0, "ast")), "ASSISTS", String(sum(1, "ast"))];
      }
    }
    function jumbo() {
      jumboN++;
      // timeouts: KISS CAM / DANCE CAM (fictional cartoon fans, procedural), ~20 fps
      const fan = (TS.hud || 0) > 0 && !SCFG.HALF ? ((TS.to[0] + TS.to[1]) % 2 ? "kiss" : "dance") : "";
      if (fan) {
        if ((jumboN & 3) === 0) {
          drawFanCam(j2, fan, T, PC[0] || "#7b3fb5");
          jt.needsUpdate = true;
          jk = "";
        }
        return;
      }
      const st = jStat(),
        k = sc[0] + "-" + sc[1] + "-" + fmt(clock) + "-" + Math.ceil(shot) + "-" + qtrN + PC.join() + st.join() + liveOn;
      if (k === jk) return;
      jk = k;
      const c = j2;
      if (liveOn) {
        // live feed on top (its own plane): a compact score bar underneath
        c.fillStyle = "#03050c";
        c.fillRect(0, 0, 1024, 512);
        c.fillStyle = "#e0262e";
        c.fillRect(24, 22, 92, 30);
        c.fillStyle = "#fff";
        c.font = "800 22px system-ui";
        c.textAlign = "center";
        c.fillText("LIVE", 70, 45);
        for (const b of [0, 1]) {
          c.fillStyle = PC[b] || "#333";
          c.fillRect(b ? 560 : 24, 352, 440, 96);
          c.fillStyle = "#fff";
          c.font = "800 34px system-ui";
          c.textAlign = "left";
          c.fillText(((cl && cl[b]) || "").toUpperCase().slice(0, 10), (b ? 560 : 24) + 22, 412);
          c.font = "900 64px system-ui";
          c.textAlign = "right";
          c.fillText(String(sc[b]), (b ? 560 : 24) + 420, 424);
        }
        c.fillStyle = "#ffd23f";
        c.font = "800 40px ui-monospace,monospace";
        c.textAlign = "center";
        c.fillText((qtrN > 4 ? "OT" : "Q" + qtrN) + "  " + fmt(clock) + "   " + Math.ceil(shot), 512, 492);
        jt.needsUpdate = true;
        return;
      }
      c.fillStyle = "#03050c";
      c.fillRect(0, 0, 1024, 512);
      for (const b of [0, 1]) {
        c.fillStyle = PC[b] || "#333";
        c.fillRect(b ? 520 : 24, 92, 480, 190);
      }
      c.fillStyle = "#ffd23f";
      c.font = "italic 900 50px system-ui";
      c.textAlign = "center";
      c.fillText("HOOPS 2K27", 512, 66);
      c.fillStyle = "#fff";
      c.font = "800 40px system-ui";
      c.fillText(((cl && cl[0]) || "").toUpperCase().slice(0, 12), 264, 142);
      c.fillText(((cl && cl[1]) || "").toUpperCase().slice(0, 12), 760, 142);
      c.font = "900 120px system-ui";
      c.fillText(String(sc[0]), 264, 266);
      c.fillText(String(sc[1]), 760, 266);
      c.fillStyle = "#ffd23f";
      c.font = "800 54px ui-monospace,monospace";
      c.fillText((qtrN > 4 ? "OT" : "Q" + qtrN) + "  " + fmt(clock), 512, 350);
      if (st[1]) {
        // live stats panel
        c.fillStyle = st[1] === "RUN" ? "#5a0d0d" : "#0d1430";
        c.fillRect(24, 382, 976, 110);
        c.fillStyle = "#fff";
        c.font = "900 52px system-ui";
        c.fillText(st[0], 230, 455);
        c.fillText(st[2], 794, 455);
        c.fillStyle = st[1] === "RUN" ? "#ff6b4a" : "#9fe7ff";
        c.font = "800 34px system-ui";
        c.fillText(st[1], 512, 450);
      }
      jt.needsUpdate = true;
    }
    // ceiling light panels (bloom picks them up)
    const panelM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff6e8).multiplyScalar(5) }); // HDR: blooms
    for (let i = 0; i < 8; i++) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.2), panelM);
      p.position.set(-42 + i * 12, 40, (i % 2 ? 1 : -1) * 14);
      p.rotation.x = Math.PI / 2;
      S.add(p); ARENA.push(p);
    }

    // ---------------- effects + quality ----------------
    const fx: Fx = GPU ? makeFxGPU(R, S, cam) : makeFx(R, S, cam, 960, 540);
    let lvl = 6,
      settle = 0,
      settleN = 0,
      paused = false,
      good = 0,
      bad = 0,
      lastQ = -1,
      lastFX: any = null;
    // Ladder (top -> bottom): everything; -SSAO; -reflection; -bloom/blur; -shadows; 85% res; 75% res.
    // With HSR Auto the internal resolution is the first lever (dynamic resolution, below); the ladder only moves
    // once that sits at its floor, and its 85% / 75% rungs scale the internal resolution, never the output.
    const dres = makeDynRes();
    dres.set(V.QL >= 2 ? 0.8 : 0.67);
    let hsrK = "",
      pinned = false;
    const fxLevel = () => {
      const ql = V.QL,
        on = V.FX && ql > 0,
        hm = hsrMode(),
        lk = lvl >= 2 ? 1 : lvl === 1 ? 0.85 : 0.75;
      // the drawing buffer follows the canvas's real size on screen (it was a fixed 960x540 x DPR stretched to the
      // window: blurry on a 1080p laptop); capped per tier, then the frame-rate ladder's 85% / 75% rungs
      const scr = Math.max(1, (C.clientWidth || 960) / 960);
      R.setPixelRatio(Math.min(scr * Math.min(devicePixelRatio || 1, DPR[ql]), MAXR[ql]) * (hm ? 1 : lk));
      R.setSize(960, 540, false);
      const hs = hm ? Math.max(0.25, (V.HSR === 1 ? dres.scale : HSRS[V.HSR]) * lk) : 1;
      hsrK = hm + ":" + V.HSR;
      fx.setHSR(hm, hs);
      // AO (N8AO): Balanced = half res on Medium, High/Ultra full res; the ladder's top rung only
      fx.setLevel(on && lvl >= 4 ? ql : on ? 0 : 0, on && lvl >= 4, 960, 540, on && lvl >= 6 ? aoLevel() : 0);
      const gl = GRADES[V.GRADE] || GRADES[0];
      fx.setLook(gl[1], gl[2], gl[3], gl[4], V.GRAIN ? (ql >= 2 ? 0.014 : 0.01) : 0);
      // planar reflection: the arena floor (High+), or the street's puddles in the rain
      setMirror(on && ql >= 2 && lvl >= 5 && (!streetOn || wxNow === "rain"));
      puddleMirror(!!mirror && mirror.visible && streetOn);
      if (mirror && !GPU) {
        // the reflection renders at (a fraction of) the INTERNAL resolution: no 2K mirror under a 50% HSR frame
        const k = ql >= 3 ? 1 : 0.75,
          rw = Math.max(256, Math.min(2560, Math.floor((fx.hsr.w || 1280) * k))),
          rh = Math.max(144, Math.min(1440, Math.floor((fx.hsr.h || 720) * k))),
          mrt = mirror.getRenderTarget();
        if (mrt.width !== rw || mrt.height !== rh) mrt.setSize(rw, rh);
      }
      fill.visible = ql >= 2; // (one directional light fewer per fragment on Medium / Chromebook)
      for (const o of hiOnly) o.visible = ql >= 2 && !streetOn;
      sun.shadow.radius = ql >= 3 ? 5 : ql >= 2 ? 3.5 : 2.5;
      (sun.shadow as any).blurSamples = ql >= 3 ? 16 : 8;
      const wantShadow = ql > 0 && lvl >= 3;
      if (R.shadowMap.enabled !== wantShadow) {
        R.shadowMap.enabled = wantShadow;
        S.traverse((o: any) => o.material && [].concat(o.material).forEach((mm: any) => (mm.needsUpdate = true)));
      }
      sun.shadow.mapSize.setScalar(ql >= 3 || (ql > 1 && !mob) ? 4096 : ql > 0 ? 2048 : 1024);
      for (const m of shafts) m.visible = ql >= 1 && lvl >= 3 && !streetOn; // (fxLevel runs on street courts too: weather changes)
      fx.setGrade(on && ql >= 1 && lvl >= 4);
      if (sun.shadow.map) {
        sun.shadow.map.dispose();
        (sun.shadow as any).map = null;
      }
    };
    V.onResize = fxLevel;
    let rsT: any = 0;
    if (typeof window !== "undefined") window.addEventListener("resize", () => (clearTimeout(rsT), (rsT = setTimeout(() => ((settle = performance.now() + 500), fxLevel()), 200))));
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => (paused = true));
    const cl2 = new THREE.Vector3(0, 0, 3),
      TV = new THREE.Vector3(),
      PV = new THREE.Vector3();
    // ---- the benches and the two head coaches (far sideline): sit, stand and cheer on big plays; coaches pace ----
    type BP = { gl: any; q: any; x: number; z: number; tm: number; coach: boolean; ph: number; tx: number; f: number };
    let bench: BP[] = [],
      lastScore = [0, 0],
      cheerT = [0, 0];
    // ---- referees: a lead on the baseline and a trail on the far sideline; whistle arm up on every call ----
    type RF = { gl: any; x: number; y: number; f: number; ph: number; whT: number };
    let refs: RF[] = [],
      whistle = 0,
      coachG = [0, 0], // coach gesture timers per team
      coachK = [0, 0], // 1 play call signal, 2 timeout "T", 3 yelling at the refs
      lastTO = [4, 4],
      lastDS = "";
    (V as any).refCall = (tm: number) => {
      whistle = 1.3;
      if (tm === 0 || tm === 1) (coachG[tm] = 1.6), (coachK[tm] = 3);
    };
    function benchBuild() {
      for (const b of [...bench, ...refs]) {
        S.remove(b.gl.G);
        b.gl.mesh.geometry.dispose();
        b.gl.pmesh?.geometry.dispose();
        b.gl.extra.forEach((m: any) => (m.map && m.map.dispose(), m.dispose()));
      }
      bench = [];
      refs = [];
      for (let k = 0; k < 2; k++) {
        const gl = makeRig({ n: "Ref " + k, col: "#b9bec6", skin: ["#c68642", "#e8b88f"][k], hr: 1, bd: k, no: "", ht: 6.2, bk: 1, tm: -1, sg: { gs: 0 } }, TX2, 0);
        S.add(gl.G);
        refs.push({ gl, x: 470, y: k ? -4 : 120, f: 0, ph: 0, whT: 0 });
      }
      const SKN2 = ["#e8b88f", "#c68642", "#8d5524", "#6b4226", "#b9825a"];
      for (const tm of [0, 1]) {
        const sg = tm ? 1 : -1,
          n = 4;
        for (let k = 0; k <= n; k++) {
          const coach = k === n,
            fake: any = {
              n: coach ? "Coach " + tm : "Bench " + tm + k,
              col: coach ? "#23252e" : PC[tm] || "#555",
              skin: SKN2[(k * 3 + tm) % SKN2.length],
              hr: coach ? 1 : 1 + ((k + tm) % 3),
              bd: coach ? 1 : (k + tm) % 2,
              no: coach ? 0 : 10 + k * 7 + tm * 3,
              ht: coach ? 6.1 : 6.4 + (k % 3) * 0.2,
              bk: coach ? 1.15 : 1,
              tm,
              sg: { gs: 0 },
            };
          const gl = makeRig(fake, TX2, 0);
          S.add(gl.G);
          const x = sg * (9 + k * 2.6),
            z = -25.6;
          bench.push({ gl, q: { cr: 0 }, x: coach ? sg * 13 : x, z: coach ? -24.2 : z, tm, coach, ph: Math.random() * 6, tx: sg * 13, f: 0 });
        }
      }
      lastScore = [sc[0], sc[1]];
    }
    function benchUpd(dt: number) {
      for (const t of [0, 1])
        if (sc[t] > lastScore[t]) {
          if (sc[t] - lastScore[t] >= 3 || Math.random() < 0.5) cheerT[t] = 2.2;
          lastScore[t] = sc[t];
        }
      cheerT[0] = Math.max(0, cheerT[0] - dt);
      cheerT[1] = Math.max(0, cheerT[1] - dt);
      for (const t of [0, 1]) {
        if (TS.to[t] < lastTO[t]) (coachG[t] = 1.6), (coachK[t] = 2); // timeout: hands make the T
        lastTO[t] = TS.to[t];
        if (TS.run[0] === t && TS.run[1] >= 8) cheerT[t] = Math.max(cheerT[t], 0.3); // the bench is up for the run
        coachG[t] = Math.max(0, coachG[t] - dt);
      }
      const dsk = TS.ds.join() + TS.pc.join() + pos;
      if (dsk !== lastDS) {
        // new possession or a new call: the coach signals the play
        lastDS = dsk;
        const t = pos;
        if (!coachG[t]) (coachG[t] = 1.2), (coachK[t] = 1);
      }
      for (const b of bench) {
        const q = b.q,
          up = cheerT[b.tm] > 0 ? 1 : 0;
        if (b.coach) {
          // pace along the sideline in front of his bench; arms folded, arms out when his team scores
          if (Math.abs(b.tx - b.x) < 0.2) b.tx = (b.tm ? 1 : -1) * (9 + Math.random() * 10);
          const dir = Math.sign(b.tx - b.x),
            v = 2.2;
          b.x += dir * v * dt;
          b.ph += v * dt * 2.4;
          const s = Math.sin(b.ph);
          Object.assign(q, { tL: s * 0.35, tR: -s * 0.35, kL: Math.max(0, -s) * 0.5, kR: Math.max(0, s) * 0.5, cr: 0, ln: 0.04, ty: 0, rz: 0, cx: 0, cy: 0 });
          b.f += (Math.atan2(0, dir) - b.f) * Math.min(1, dt * 6);
          const g2 = coachG[b.tm] > 0 ? coachK[b.tm] : 0,
            hud = (TS.hud || 0) > 0 && (TS.hud || 0) < 2.6; // (the T signal first, then into the huddle)
          if (hud) {
            // timeout: he walks to the back of his team's huddle and draws up the play
            b.tx = (b.tm ? 1 : -1) * 13;
            if (Math.abs(b.tx - b.x) < 0.3) {
              b.x = b.tx;
              const d = Math.sin(T * 5) * 0.25;
              Object.assign(q, { tL: 0, tR: 0, kL: 0, kR: 0, ln: 0.25, aL: 0.95, eL: 1.7, zL: -0.1, aR: 1.15 + d, eR: 1.35 - d, sz: 0.05 });
              b.f = Math.PI / 2;
            }
          } else if (g2) {
            b.tx = b.x; // stop and coach
            if (g2 === 1) Object.assign(q, { aR: 2.7, eR: 0.2, sz: 0.2, aL: 1.0, eL: 1.9, zL: -0.3 }); // play call: arm up, fingers
            else if (g2 === 2) Object.assign(q, { aR: 1.55, eR: 0.05, sz: 0.0, aL: 2.9, eL: 0.05, zL: 0.4 }); // T for timeout
            else {
              const sh = Math.sin(T * 7) * 0.2;
              Object.assign(q, { aL: 1.0 + sh, aR: 1.0 - sh, eL: 0.8, eR: 0.8, sz: 0.6, zL: 0.6, ln: -0.1 }); // what was that?!
            }
            b.f = Math.PI / 2;
          } else if (up) Object.assign(q, { aL: 0.9, aR: 0.9, eL: 0.6, eR: 0.6, sz: 0.9, zL: 0.9 });
          else Object.assign(q, { aL: 1.05, aR: 1.05, eL: 2.2, eR: 2.2, sz: -0.35, zL: -0.35 });
        } else {
          // seated: thighs level, shins down; standing and waving arms when his team scores
          // (each bench player cheers his own way - waving, a towel-style circle overhead, clapping, bouncing with a fist
          // pump - and gets up a beat after the one next to him; seated, some lean on their knees, some sit back)
          const w = Math.sin(T * 9 + b.x) * 0.3,
            sty = Math.floor(Math.abs(b.x * 7.3)) % 4,
            late = (Math.abs(b.x * 3.1) % 1) * 0.35;
          if (up && cheerT[b.tm] < 2.2 - late) {
            const stand = { tL: 0, tR: 0, kL: 0.05, kR: 0.05, cr: 0, ln: -0.05 };
            if (sty === 1) Object.assign(q, stand, { aL: 0.5, eL: 0.6, zL: 0.2, aR: 2.85, eR: 0.35, sz: 0.25 + Math.sin(T * 11 + b.x) * 0.45 }); // towel circling
            else if (sty === 2) {
              const cl = Math.abs(Math.sin(T * 8 + b.x));
              Object.assign(q, stand, { aL: 1.35, aR: 1.35, eL: 0.95, eR: 0.95, sz: -0.12 + 0.5 * cl, zL: -0.12 + 0.5 * cl }); // clapping
            } else if (sty === 3) {
              const bo = Math.max(0, Math.sin(T * 10 + b.x));
              Object.assign(q, stand, { kL: 0.05 + 0.4 * bo, kR: 0.05 + 0.4 * bo, tL: 0.2 * bo, tR: 0.2 * bo, cr: 0.5 * bo, aR: 2.0 + 0.6 * bo, eR: 1.9 - 0.6 * bo, sz: 0.3, aL: 0.6, eL: 1.2, zL: 0.3 }); // bounce + fist pump
            } else Object.assign(q, stand, { aL: 2.7 + w, aR: 2.7 - w, eL: 0.3, eR: 0.3, sz: 0.4, zL: 0.4 });
          } else if (sty === 1 || sty === 3) Object.assign(q, { tL: 1.5, tR: 1.45, kL: 1.5, kR: 1.5, cr: 4.1, ln: 0.45, aL: 0.15, aR: 0.2, eL: 1.6, eR: 1.6, sz: 0.35, zL: 0.35 }); // elbows on the knees
          else Object.assign(q, { tL: 1.5, tR: 1.45, kL: 1.5, kR: 1.5, cr: 4.1, ln: sty === 2 ? -0.08 : 0.12, aL: 0.6, aR: 0.55, eL: 1.3, eR: 1.3, sz: 0.2, zL: 0.2 });
          b.f = Math.PI / 2; // facing the court
        }
        // place the rig directly (bench people are not sim players): game coords from world feet
        const fake: any = { x: b.x * 10 + 470, y: b.z * 10 + 250, z: 0, f: b.f, q: { hz: 0, hs: 0, fL: 0, fR: 0, gL: 0.3, gR: 0.3, nk: 0, hp: 0, hy: 0, wL: 0, wR: 0, oL: 0, oR: 0, ...q } };
        applyPose(b.gl, fake);
        b.gl.G.visible = !streetOn;
      }
      refsUpd(dt);
    }
    function refsUpd(dt: number) {
      whistle = Math.max(0, whistle - dt);
      const dir = hoop(pos) > 470 ? 1 : -1,
        hx = hoop(pos);
      refs.forEach((r, k) => {
        r.gl.G.visible = !streetOn && !SCFG.HALF;
        // lead: baseline on the far side of the ball; trail: far sideline, a step behind the play
        const tx = k === 0 ? hx + dir * 46 : Math.max(60, Math.min(880, B.x - dir * 110)),
          ty = k === 0 ? (B.y < 250 ? 380 : 120) : -4,
          dx = tx - r.x,
          dy = ty - r.y,
          d = Math.hypot(dx, dy),
          calling = whistle > 0 && k === (Math.abs(B.x - refs[0].x) < Math.abs(B.x - refs[1].x) ? 0 : 1),
          v = calling ? 0 : Math.min(150, d * 2);
        if (d > 3) {
          r.x += (dx / d) * v * dt;
          r.y += (dy / d) * v * dt;
        }
        r.ph += ((v * dt) / stepLen(v)) * Math.PI;
        const tf = Math.atan2(B.y - r.y, B.x - r.x);
        r.f += Math.atan2(Math.sin(tf - r.f), Math.cos(tf - r.f)) * Math.min(1, dt * 5);
        const s = Math.sin(r.ph),
          walk = Math.min(1, v / 60),
          q: any = { tL: s * 0.4 * walk, tR: -s * 0.4 * walk, kL: Math.max(0, -s) * 0.55 * walk, kR: Math.max(0, s) * 0.55 * walk, cr: 0, ln: 0.03, ty: 0, rz: 0, cx: 0, cy: 0, aL: 0.15 + s * 0.3 * walk, aR: 0.15 - s * 0.3 * walk, eL: 0.4, eR: 0.4, sz: 0.1, zL: 0.1 };
        if (calling) Object.assign(q, { aR: 2.95, eR: 0.05, sz: 0.15, gR: 0.9, aL: 0.9, eL: 1.2, zL: 0.4 }); // whistle: fist straight up
        const fake: any = { x: r.x, y: r.y, z: 0, f: r.f, q: { hz: 0, hs: 0, fL: 0, fR: 0, gL: 0.3, gR: 0.3, nk: 0, hp: 0, hy: 0, wL: 0, wR: 0, oL: 0, oR: 0, ...q } };
        applyPose(r.gl, fake);
      });
    }
    let rpA = 0,
      rpT = 0,
      lastSc = [0, 0],
      introA = -1;
    /** 0 at the tip .. 1 at the final buzzer (sweat builds over the game) */
    const gameDepth = () => (gameLike() ? Math.min(1, ((qtrN - 1) + (1 - clock / Math.max(1, QTRLEN))) / 4) : 0);
    const pyro = makePyro(S);
    let pset: any = null,
      pslot: any[] | null = null,
      lastR = 0,
      ema = 16,
      nf = 0,
      lastTot = 0,
      lastF = performance.now(),
      shake = 0;
    V.shake = (a: number) => (shake = Math.max(shake, a));
    V.GL = {
      netM: () => netI.instanceMatrix.array, // the drawn net strands (tests: they must move)
      // tests / FPS counter: HSR state (mode, scale, internal + output size), last frame's draw calls, the ladder rung
      stats: () => ({ hsr: { ...fx.hsr, core: undefined, st: fx.hsr.core ? fx.hsr.core.stats : null }, calls: R.info.render.calls, tris: R.info.render.triangles, lvl, pr: R.getPixelRatio(), dyn: fx.dyn.length }),
      hsrReset: () => fx.hsr.core && fx.hsr.core.reset(),
      hsrProbe: (u: number, v: number) => (fx.hsr.core ? fx.hsr.core.probe(u, v) : null),
      /** tests: pin the frame-rate ladder at a rung (equal-scene comparisons on a slow software GPU); -1 = release */
      pin: (l: number) => ((pinned = l >= 0), pinned && (lvl = l), fxLevel()),
      dbg: () => ({ refs: refs.map((r) => [Math.round(r.x), Math.round(r.y), r.gl.G.visible]), street: streetOn, cs: !!CS.react }),
      proj(x: number, y: number, z: number) {
        const v = PV.set(x, y, z).project(cam);
        return [(v.x + 1) * 480, (1 - v.y) * 270];
      },
      render() {
        if (!ready) return; // WebGPU device still initializing
        if (GPU)
          try {
            return this.draw();
          } catch (e) {
            ready = false;
            gpuFail(e);
            return;
          }
        return this.draw();
      },
      draw() {
        if (R.info) (R.info.autoReset = false), R.info.reset(); // per-frame totals (stats(): all passes of a frame)
        const QL = V.QL,
          now = performance.now(),
          fdt = Math.min(0.1, (now - lastF) / 1000);
        lastF = now;
        if (QL !== lastQ || V.FX !== lastFX) {
          lastQ = QL;
          lastFX = V.FX;
          lvl = 6;
          fxLevel();
          settle = now + 700; // shader compiles after a change: don't judge these frames
        } else if (hsrK !== hsrMode() + ":" + V.HSR) {
          fxLevel(); // HSR mode / upscaler changed in the settings
          settle = now + 500;
        }
        texLoad();
        const tot = sc[0] + sc[1];
        if (tot !== lastTot) {
          // LED takeover in the scoring team's colour
          const tm = sc[0] !== lastSc[0] ? 0 : 1,
            pts = sc[tm] - lastSc[tm];
          if (pts > 0 && pts <= 4 && lastTot >= 0 && !streetOn) Object.assign(ledFx, { t: 2.4, col: PC[tm] || "#ffd23f", txt: pts >= 3 ? "3 POINTS!" : B.dk ? "SLAM!" : B.fl ? "AND ONE!" : pts === 1 ? "FREE THROW" : "BUCKET!" });
          lastSc[0] = sc[0];
          lastSc[1] = sc[1];
          lastTot = tot;
          exc = 1;
          if (Math.random() < 0.3 && waveT <= 0) (waveT = 6), (waveA = Math.random() * 6.283); // the wave
        }
        exc = Math.max(0.3, exc - 0.004);
        const crowdN = QL === 0 ? 0 : QL === 1 || lvl < 3 ? 1300 : QL === 2 ? 2600 : CN;
        if (ledFx.t > 0) {
          ledFx.t -= fdt;
          if ((nf & 3) === 0 || ledFx.t <= 0) ledDraw(), (led.needsUpdate = true);
        }
        if ((nf & 1) === 0 || bodyI.count !== crowdN) crowdUpd(crowdN);
        jumbo();
        shotClockDraw();
        // Frame-rate guard: judged every 30 frames (~.5 s); very slow frames drop two rungs; at the bottom of the
        // ladder the graphics level itself steps down (this session only, toast). Climbs back slowly (2 s of fast frames).
        if (now < settle || settleN > 0) settleN--, (ema = 16.7);
        else if (lastR && !paused && !pinned) {
          // (frames around a hidden tab / pause menu are skipped via settle); a crawling machine is judged every 5 frames
          ema = ema * 0.9 + Math.min(1000, now - lastR) * 0.1;
          // HSR Auto: dynamic resolution holds the target frame time first (every 12 frames)
          const dynOn = V.HSR === 1 && hsrMode() > 0,
            lo = 0.45;
          if (dynOn && dres.update(ema, targetMs(), lo, 1, now)) (fxLevel(), (settle = now + 120), (settleN = 1));
          if (++nf > (ema > 60 ? 5 : 30)) {
            nf = 0;
            const old = lvl;
            if (ema > 21 && dynOn && dres.scale > lo + 0.001) good = 0; // still room to lower the resolution
            else if (ema > 21) {
              good = 0;
              if (lvl > 0) lvl = Math.max(0, lvl - (ema > 34 ? 2 : 1));
              else if (QL > 0 && ++bad >= 2) {
                bad = 0;
                V.QL = QL - 1;
                V.QAUTO = "Graphics lowered to " + QLN[V.QL] + " for a smoother game";
              }
            } else if (ema < 13 && lvl < 6 && ++good >= 4) (good = 0), lvl++;
            if (lvl !== old) (fxLevel(), (settle = now + 350), (settleN = 2));
            const h = fx.hsr;
            V.perf = { fps: Math.round(1000 / ema), ms: Math.round(ema * 10) / 10, lvl, scale: R.getPixelRatio(), hsr: h.mode, hs: h.scale, iw: h.w, ih: h.h, ow: h.ow, oh: h.oh };
          }
        }
        lastR = paused ? 0 : now;
        paused = false;
        if (PC.join() + cl.join() !== pcK) {
          pcK = PC.join() + cl.join();
          // per-arena grade: a whisper of the home team's color in the light
          const hc = new THREE.Color(PC[0] || "#ffffff"),
            mx = Math.max(hc.r, hc.g, hc.b, 0.01);
          fx.setGrade(V.FX && V.QL >= 1, new THREE.Color(1, 1, 1).lerp(hc.multiplyScalar(1 / mx), 0.07));
          court();
          ledDraw();
          led.needsUpdate = true;
          if (!streetOn) envSet("arena:" + (PC[0] || ""), () => arenaEnv(PC[0] || "#7b3fb5"));
          for (let i = 0; i < CN; i++) {
            const t = Math.random();
            if (t < 0.32) cc.set(PC[0]);
            else if (t < 0.6) cc.set(PC[1]);
            else cc.setHSL(Math.random(), 0.35, 0.25 + Math.random() * 0.4);
            bodyI.setColorAt(i, cc.multiplyScalar(cpos[i][9]));
          }
          bodyI.instanceColor!.needsUpdate = true;
        }
        if (P !== pset && QL > 0) benchBuild();
        const drop = (p: any) => {
          if (!p.gl) return;
          S.remove(p.gl.G);
          p.gl.mesh.geometry.dispose();
          p.gl.pmesh?.geometry.dispose();
          p.gl.extra.forEach((m: any) => (m.map && m.map.dispose(), m.dispose()));
          p.gl = null;
        };
        if (P !== pset) {
          if (pset) pset.forEach(drop);
          if (pslot) pslot.forEach(drop);
          P.forEach((p) => {
            p.gl = makeRig(p, TX2, V.QL >= 2 ? 1 : 0);
            S.add(p.gl.G);
          });
          pset = P;
          pslot = P.slice();
          // warm-up: compile every scene material now (KHR_parallel_shader_compile where available), so the first
          // look at the far basket / the bench / a replay angle doesn't stall on a shader compile mid-play
          try {
            const w = R.compileAsync ? R.compileAsync(S, cam) : null;
            if (w && w.catch) w.catch(() => {});
          } catch (e) {}
        } else if (pslot)
          for (let k = 0; k < P.length; k++)
            if (P[k] !== pslot[k]) {
              // substitution: the man checking out leaves the floor, the sub gets his own rig
              drop(pslot[k]);
              const p: any = P[k];
              if (!p.gl) {
                p.gl = makeRig(p, TX2, V.QL >= 2 ? 1 : 0);
                S.add(p.gl.G);
              }
              pslot[k] = p;
            }
        if (bench.length && QL > 0) benchUpd(fdt);
        if (!!SCFG.HALF !== streetOn) setStreet(!!SCFG.HALF);
        if (streetOn) {
          const w = (V.WX === "auto" || !(V.WX in SKY) ? wxAuto : V.WX) as Wx,
            k = w + ":" + QL;
          if (k !== wxK) {
            wxK = k;
            wxNow = w;
            applyWx(w);
            fxLevel();
            settle = now + 500;
          }
          precip.update(fdt, wxNow, QL === 0 ? 300 : QL === 1 ? 900 : 1600);
        } else if (precip.rain.visible || precip.snow.visible) precip.update(0, "", 0);
        if (QL > 0 && !streetOn) courtside(fdt, exc);
        if (P.length) {
          for (const p of P)
            if (p.gl) {
              p.gl.G.visible = !p.off; // parked by a game mode
              if (p.off) continue;
              applyPose(p.gl, p);
              // sweat: fatigue now + how deep into the game we are (skin sheen, damp jersey)
              p.gl.mesh.userData.sweat = Math.min(1, Math.max(0, (1 - (p.en ?? 1)) * 1.6) * 0.6 + gameDepth() * 0.55);
              footIK(p.gl, p, fdt, QL > 0 && !RPL);
              clothStep(p.gl, p, fdt);
            }
          const w = W3(B.x, B.y, B.z);
          ball.position.set(w[0], w[1], w[2]);
          ballSpin(fdt);
          const o = B.owner;
          if (!RPL && o && o.gl && (o.mode === "c" || o.mode === "s")) {
            o.gl.G.updateMatrixWorld(true);
            ball.position.copy((o.q && o.q.mir ? o.gl.wL : o.gl.wR).localToWorld(TV.set(0, -0.62, 0.1))); // lefties: the left hand
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
        blobUpd();
        polish(fdt);
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
        if (!RPL && (TS.hud || 0) > 0 && TS.hud < 2.5 && p0 && !SCFG.HALF) {
          // timeout: the broadcast cuts to your team's huddle in front of its bench
          const hx2 = (p0.tm ? 1 : -1) * 13;
          tp = [hx2 + 4, 8, -8];
          tl = [hx2, 3.2, -21.6];
        }
        // Replay director: a tracking close-up on the player nearest the ball (low and looking up when the play is at
        // the rim: dunks, layups), slowly orbiting, with depth of field focused on him.
        let dofF = 0;
        if (RPL) rpT += fdt;
        else rpT = 0;
        if (RPL && P.length && RPK && B.last) {
          // Clutch replay, three shots: low behind the shooter at the release, wide high following the ball's flight,
          // then a tight look up at the rim as it drops through the net.
          const s0 = B.last,
            sw = W3(s0.x, s0.y, 0),
            hx3 = (hoop(s0.tm) - 470) * 0.1,
            bw = W3(B.x, B.y, B.z),
            dirx = Math.sign(hx3 - sw[0]) || 1;
          if (rpT < 1.6) {
            tp = [sw[0] - dirx * 7, 4.2, sw[2] + 3.5];
            tl = [sw[0] + dirx * 4, 6.5, sw[2]];
            dofF = 8;
          } else if (rpT < 3.4) {
            tp = [(sw[0] + hx3) / 2, 19, sw[2] + 26];
            tl = [bw[0], bw[1], bw[2]];
          } else {
            tp = [hx3 - dirx * 6, 6.5, 5];
            tl = [hx3, 9.8, 0];
            dofF = Math.hypot(6, 3.3, 5);
          }
        } else if (RPL && P.length) {
          let sub = P[0],
            sd2 = 1e9;
          for (const q of P) {
            const d = Math.hypot(q.x - B.x, q.y - B.y);
            if (d < sd2) (sd2 = d), (sub = q);
          }
          const sw = W3(sub.x, sub.y, sub.z),
            rim = Math.min(Math.abs(B.x - HXs[0]), Math.abs(B.x - HXs[1])) < 110 && (B.z > 45 || sub.z > 10),
            a = rpA + T * 0.22,
            dist = rim ? 11 : 14;
          tp = [sw[0] + Math.cos(a) * dist, rim ? 2.6 : 6, sw[2] + Math.sin(a) * dist];
          tl = [sw[0], sw[1] + (rim ? 6.5 : 3.6), sw[2]];
          dofF = Math.hypot(tp[0] - sw[0], tp[1] - tl[1], tp[2] - sw[2]);
        } else rpA = Math.random() * 6.283; // pick a fresh angle for the next replay
        fx.setDof(V.FX && QL >= 1 ? dofF : 0);
        const SO = (V as any).studio as { a: number; d: number } | null,
          NCM = (V as any).netCam as { b: number; a: number; d: number; h?: number } | null;
        if (NCM) {
          // debug / screenshots: a close look at one hoop's net from angle a (rad), distance d (ft)
          const hx4 = (HXs[NCM.b] - 470) * 0.1;
          tp = [hx4 + Math.cos(NCM.a) * NCM.d, NCM.h ?? 8.6, Math.sin(NCM.a) * NCM.d];
          tl = [hx4, 8.9, 0];
        } else if (SO && p0) {
          // Animation Studio: close orbit around the player
          const pw = W3(p0.x, p0.y, 0);
          const up = p0.z * 0.1; // follow jumps
          const ah = (SO as any).h ?? 3.3; // aim height (ft)
          const fz = (SO as any).h != null; // face close-up: h already includes the jump
          tp = [pw[0] + Math.cos(SO.a) * SO.d, ah + ((SO as any).dy ?? 1.7) + (fz ? 0 : up), pw[2] + Math.sin(SO.a) * SO.d];
          tl = [pw[0], ah + (fz ? 0 : up), pw[2]];
        }
        let lerpK = SO || NCM ? 1 : RPL && RPK ? 0.35 : 0.1;
        // Pregame flyover (S "intro"): a slow crane move around the bowl, down toward the broadcast angle, with pyro
        // bursts from the baseline cannons and a cutscene depth of field; one more burst at the tip.
        if (GS === "intro" && !SO && !NCM && !streetOn) {
          if (introA < 0) (introA = 0), pyro.fire(1.8), cam.position.set(-70, 40, 50);
          const a0 = introA;
          introA += fdt;
          if (Math.floor(introA / 3.5) !== Math.floor(a0 / 3.5)) pyro.fire(1.1);
          const a = 2.4 + introA * 0.14,
            rr = Math.max(40, 74 - introA * 2.2);
          tp = [Math.cos(a) * rr, Math.max(13, 36 - introA * 1.6), Math.sin(a) * rr * 0.7];
          tl = [0, 3.5, 0];
          lerpK = 0.06;
          fx.setDof(V.FX && QL >= 2 ? Math.hypot(cam.position.x, cam.position.y - 3.5, cam.position.z) : 0);
        } else if (introA >= 0 && GS !== "intro") {
          introA = -1;
          if (GS === "play" && !streetOn) pyro.fire(1.2);
        }
        if (!SO && !RPL && GS === "over" && sc[0] !== sc[1]) {
          // final buzzer: the camera drifts in to the winners' top scorer (face close-up: the grin, the roar)
          const wt = sc[0] > sc[1] ? 0 : 1;
          let st: any = null;
          for (const q of P) if (q.tm === wt && !q.off && (!st || (q.stt?.pts || 0) > (st.stt?.pts || 0))) st = q;
          if (st) {
            const hw = W3(st.x, st.y, st.z),
              hh = (st.ht / 6.4) * 5.9 + st.z * 0.1,
              a = Math.PI / 2 - st.f - Math.PI / 2 + Math.sin(T * 0.25) * 0.5; // in front of him, slow sway
            tp = [hw[0] + Math.sin(a + Math.PI / 2) * 6.5, hh + 0.6, hw[2] + Math.cos(a + Math.PI / 2) * 6.5];
            tl = [hw[0], hh - 0.5, hw[2]];
            lerpK = 0.03;
          }
        }
        cam.position.lerp(TV.set(tp[0], tp[1], tp[2]), lerpK);
        cl2.lerp(TV.set(tl[0], tl[1], tl[2]), SO || NCM ? 1 : lerpK === 0.03 ? 0.05 : 0.14);
        cam.lookAt(cl2);
        if (shake > 0.001) {
          cam.position.x += (Math.random() - 0.5) * shake;
          cam.position.y += (Math.random() - 0.5) * shake;
          shake *= 0.86;
        }
        cam.updateMatrixWorld();
        // HSR velocity pass: the objects that move on their own (rigs + ball); the static world reprojects from depth
        const dl = fx.dyn;
        dl.length = 0;
        dl.push(ball);
        for (const p of P) if ((p as any).gl) dl.push((p as any).gl.G);
        for (const r of refs) dl.push(r.gl.G);
        // Motion blur only for the big moments (dunks, dribble moves of the followed player), never on camera pans.
        const fast = p0 && ((p0.mvT > 0 && p0 === B.owner) || (B.dk && B.age < 0.4)) ? 1 : 0;
        fx.setMotion(fast && p0 ? Math.cos(Math.PI / 2 - p0.f) * 0.006 : 0, 0, fast && V.FX && QL >= 2 && lvl >= 5 ? 1 : 0);
        if (pyro.active) pyro.update(fdt, cam);
        if (liveRT) liveFeed(QL >= 3 && !streetOn && !RPL && !SO && !NCM && GS === "play" && lvl >= 5);
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
