// @ts-nocheck -- renderer ported verbatim from the legacy modes
// three.js renderer for the 3D modes: arena, crowd, jumbotron, hoops + physics net, player rigs, cameras, quality levels.
import * as THREE from "three";
import { P, B, T, pos, PC, sc, clock, shot, cl, q as qtrN, RPL, HXs, W3, hoop, NETS } from "../core/sim";
import { gar, CP } from "./canvas";
import { V, fmt } from "./view";
import { makeRig, applyPose, footIK } from "./rig3d";
import { makeFx } from "./fx3d";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
const qtr = () => qtrN;
export function glInit(C: HTMLCanvasElement) {
  try {
    if (THREE.ColorManagement) THREE.ColorManagement.legacyMode = false;
    const R = new THREE.WebGLRenderer({
      canvas: C,
      antialias: true,
      powerPreference: "high-performance",
    });
    if (!R.getContext()) throw 0;
    const mob = matchMedia("(pointer:coarse)").matches;
    R.setPixelRatio(Math.min(devicePixelRatio || 1, mob ? 1.25 : 1.75));
    R.setSize(960, 540, false);
    R.shadowMap.enabled = true;
    R.shadowMap.type = mob ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    R.outputEncoding = THREE.sRGBEncoding;
    R.toneMapping = THREE.ACESFilmicToneMapping;
    R.toneMappingExposure = 1.1;
    const S = new THREE.Scene();
    S.background = new THREE.Color(0x05060d);
    S.fog = new THREE.Fog(0x05060d, 85, 200);
    const cam = new THREE.PerspectiveCamera(40, 960 / 540, 0.5, 400);
    S.add(new THREE.HemisphereLight(0xe8eeff, 0x3b2a18, 0.55));
    const sun = new THREE.DirectionalLight(0xfff4e6, 1.15);
    sun.position.set(12, 55, 24);
    sun.castShadow = true;
    const sm = mob ? 1024 : 2048;
    sun.shadow.mapSize.set(sm, sm);
    Object.assign(sun.shadow.camera, {
      left: -52,
      right: 52,
      top: 30,
      bottom: -30,
      near: 5,
      far: 140,
    });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    S.add(sun);
    for (const x of [-32, 0, 32]) {
      const s = new THREE.PointLight(0xfff0d8, 0.35, 90);
      s.position.set(x, 30, 0);
      S.add(s);
    }
    const MC = new Map(),
      M = (c, o = {}) => {
        const k = c + JSON.stringify(o);
        if (o.map) return new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.6 }, o));
        let m = MC.get(k);
        if (!m) MC.set(k, (m = new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.6 }, o))));
        return m;
      },
      ad = (g, m, x, y, z) => {
        const k = new THREE.Mesh(g, m);
        k.position.set(x, y, z);
        k.castShadow = k.receiveShadow = true;
        S.add(k);
        return k;
      },
      cv = (w, h) => {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        return [c, c.getContext("2d")];
      },
      TX2 = (c) => {
        const t = new THREE.CanvasTexture(c);
        t.encoding = THREE.sRGBEncoding;
        return t;
      };
    const [ct, c2] = cv(2048, 1024),
      tex = TX2(ct);
    tex.anisotropy = R.capabilities.getMaxAnisotropy();
    let pcK = "";
    function court() {
      const c = c2;
      c.setTransform(2048 / 940, 0, 0, 1024 / 500, 0, 0);
      const g = c.createLinearGradient(0, 0, 940, 0);
      g.addColorStop(0, "#c48a4a");
      g.addColorStop(0.5, "#dcaa6a");
      g.addColorStop(1, "#c48a4a");
      c.fillStyle = g;
      c.fillRect(0, 0, 940, 500);
      for (let y = 0; y < 500; y += 6) {
        c.fillStyle = y % 12 ? "rgba(90,50,15,.07)" : "rgba(255,230,190,.05)";
        c.fillRect(0, y, 940, 3);
      }
      for (let i = 0; i < 600; i++) {
        c.fillStyle = "rgba(70,40,10,.06)";
        c.fillRect(
          Math.random() * 940,
          Math.floor(Math.random() * 83) * 6,
          30 + Math.random() * 90,
          1,
        );
      }
      c.globalAlpha = 0.8;
      c.fillStyle = PC[0] || "#7b3fb5";
      c.fillRect(0, 170, 190, 160);
      c.fillStyle = PC[1] || "#1d428a";
      c.fillRect(750, 170, 190, 160);
      c.globalAlpha = 0.2;
      c.beginPath();
      c.arc(470, 250, 60, 0, 6.3);
      c.fill();
      c.globalAlpha = 1;
      c.strokeStyle = "#fff";
      c.lineWidth = 2.6;
      const st = (a) => {
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
        st(
          gar(
            hx,
            250,
            237,
            b ? Math.PI - 1.19 : -1.19,
            b ? Math.PI + 1.19 : 1.19,
          ),
        );
        st([
          [e, 30],
          [hx + sg * 88, 30],
        ]);
        st([
          [e, 470],
          [hx + sg * 88, 470],
        ]);
        st(gar(hx, 250, 40, b ? 1.57 : -1.57, b ? 4.71 : 1.57));
      }
      c.font = "900 64px system-ui";
      c.textAlign = "center";
      c.fillStyle = "rgba(255,255,255,.16)";
      c.fillText("HOOPS 2K27", 470, 272);
      tex.needsUpdate = true;
    }
    const fl = ad(
      new THREE.PlaneGeometry(94, 50),
      M(0xffffff, { map: tex, roughness: 0.28, metalness: 0.08 }),
      0,
      0,
      0,
    );
    fl.rotation.x = -Math.PI / 2;
    const mirror = new Reflector(new THREE.PlaneGeometry(94, 50), { textureWidth: 960, textureHeight: 540, color: 0x8a8a8a, clipBias: 0.003 });
    mirror.rotation.x = -Math.PI / 2;
    mirror.position.y = -0.02;
    mirror.visible = false;
    S.add(mirror);
    const setMirror = (on) => {
      mirror.visible = on;
      fl.material.transparent = on;
      fl.material.opacity = on ? 0.84 : 1;
      fl.material.needsUpdate = true;
    };
    const ap2 = ad(
      new THREE.PlaneGeometry(140, 90),
      M(0x15182c, { roughness: 0.85 }),
      0,
      -0.03,
      0,
    );
    ap2.rotation.x = -Math.PI / 2;
    const [cw, q] = cv(1024, 256);
    q.fillStyle = "#14172a";
    q.fillRect(0, 0, 1024, 256);
    for (let i = 0; i < 2600; i++) {
      q.fillStyle = [
        "#6a4c93",
        "#c9184a",
        "#f4a261",
        "#2a9d8f",
        "#e9c46a",
        "#4361ee",
        "#ddd",
        "#333",
      ][i % 8];
      q.beginPath();
      q.arc(
        ((i * 37) % 1024) + Math.random() * 4,
        ((Math.floor(i / 28) * 9) % 256) + 4,
        3,
        0,
        6.3,
      );
      q.fill();
    }
    const crowd = TX2(cw);
    crowd.wrapS = THREE.RepeatWrapping;
    crowd.repeat.set(3, 1);
    for (const [x, z, ry, w] of [
      [0, -66, 0, 170],
      [0, 66, Math.PI, 170],
      [-92, 0, Math.PI / 2, 110],
      [92, 0, -Math.PI / 2, 110],
    ]) {
      const st = new THREE.Mesh(
        new THREE.PlaneGeometry(w, 34),
        M(0xffffff, { map: crowd, roughness: 0.95, emissive: 0x1a1a28 }),
      );
      st.position.set(x, 13, z);
      st.rotation.y = ry;
      st.rotateX(-0.55);
      S.add(st);
    }
    const [lc, l] = cv(1024, 64);
    l.fillStyle = "#000";
    l.fillRect(0, 0, 1024, 64);
    l.font = "900 40px system-ui";
    l.fillStyle = "#ffd23f";
    for (let i = 0; i < 3; i++) l.fillText("HOOPS 2K27 ★", i * 341 + 12, 46);
    const led = TX2(lc);
    led.wrapS = THREE.RepeatWrapping;
    led.repeat.set(3, 1);
    const brd = new THREE.Mesh(
      new THREE.BoxGeometry(96, 1.4, 0.3),
      [0, 1, 2, 3, 4, 5].map((i) =>
        i === 4 ? new THREE.MeshBasicMaterial({ map: led }) : M(0x111111),
      ),
    );
    brd.position.set(0, 0.7, -27.5);
    S.add(brd);
    for (const b of [0, 1]) {
      const hx = (HXs[b] - 470) * 0.1,
        sg = b ? 1 : -1,
        mt = M(0x2a2d36, { metalness: 0.6, roughness: 0.4 });
      ad(new THREE.CylinderGeometry(0.35, 0.45, 13, 16), mt, sg * 48.6, 6.5, 0);
      ad(new THREE.BoxGeometry(5.6, 0.35, 0.35), mt, sg * 45.8, 11.4, 0);
      ad(
        new THREE.BoxGeometry(1.4, 2.4, 2.4),
        M(0x1d428a, { roughness: 0.8 }),
        sg * 48.6,
        1.2,
        0,
      );
      const bb = ad(
        new THREE.BoxGeometry(0.12, 3.5, 6),
        new THREE.MeshPhysicalMaterial({
          color: 0xddeeff,
          transparent: true,
          opacity: 0.3,
          roughness: 0.05,
        }),
        sg * 43,
        11.45,
        0,
      );
      bb.castShadow = false;
      const fr = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(0.13, 3.5, 6)),
        new THREE.LineBasicMaterial({ color: 0xffffff }),
      );
      fr.position.copy(bb.position);
      S.add(fr);
      const sq = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(2, 1.5)),
        new THREE.LineBasicMaterial({ color: 0xffffff }),
      );
      sq.position.set(sg * 42.92, 10.6, 0);
      sq.rotation.y = Math.PI / 2;
      S.add(sq);
      const rim = ad(
        new THREE.TorusGeometry(0.75, 0.055, 10, 32),
        M(0xff4d1a, { metalness: 0.5, roughness: 0.35 }),
        hx,
        10,
        0,
      );
      rim.rotation.x = Math.PI / 2;
      ad(new THREE.BoxGeometry(0.6, 0.12, 0.4), M(0xff4d1a), sg * 42.6, 10, 0);
    }
    const nc = NETS.reduce((a, N) => a + N.c.length, 0),
      np = new Float32Array(nc * 6),
      ng = new THREE.BufferGeometry();
    ng.setAttribute("position", new THREE.BufferAttribute(np, 3));
    const net = new THREE.LineSegments(
      ng,
      new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.85,
      }),
    );
    net.frustumCulled = false;
    S.add(net);
    const [bc, b2] = cv(256, 128);
    b2.fillStyle = "#d9661f";
    b2.fillRect(0, 0, 256, 128);
    for (let i = 0; i < 1500; i++) {
      b2.fillStyle = "rgba(0,0,0,.08)";
      b2.fillRect(Math.random() * 256, Math.random() * 128, 1.5, 1.5);
    }
    b2.strokeStyle = "#1c0d04";
    b2.lineWidth = 3;
    b2.beginPath();
    b2.moveTo(0, 64);
    b2.lineTo(256, 64);
    b2.moveTo(64, 0);
    b2.lineTo(64, 128);
    b2.moveTo(192, 0);
    b2.lineTo(192, 128);
    b2.stroke();
    b2.beginPath();
    b2.ellipse(128, 64, 40, 64, 0, 0, 6.3);
    b2.stroke();
    const ball = ad(
      new THREE.SphereGeometry(0.39, 32, 20),
      M(0xffffff, { map: TX2(bc), roughness: 0.75 }),
      0,
      -5,
      0,
    );
    const CN = 1800,
      cpos = [],
      cc = new THREE.Color(),
      dm = new THREE.Object3D(),
      crowdI = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.55, 0.95, 0.4),
        M(0xffffff, { roughness: 0.9 }),
        CN,
      );
    for (let i = 0; i < CN; i++) {
      const sd = i % 4,
        row = Math.floor(i / 4) % 9;
      let x,
        y = 2.4 + row * 1.25,
        z,
        ry;
      if (sd < 2) {
        x = (Math.random() - 0.5) * 118;
        z = (sd ? 1 : -1) * (31 + row * 1.55);
        ry = sd ? Math.PI : 0;
      } else {
        z = (Math.random() - 0.5) * 62;
        x = (sd === 2 ? -1 : 1) * (54 + row * 1.55);
        ry = sd === 2 ? Math.PI / 2 : -Math.PI / 2;
      }
      cpos.push([x, y, z, ry, Math.random() * 6.28]);
      cc.setHSL(Math.random(), 0.45, 0.3 + Math.random() * 0.3);
      crowdI.setColorAt(i, cc);
    }
    crowdI.instanceColor.needsUpdate = true;
    crowdI.frustumCulled = false;
    S.add(crowdI);
    let exc = 0.3;
    function crowdUpd() {
      for (let i = 0; i < crowdI.count; i++) {
        const c = cpos[i];
        dm.position.set(
          c[0],
          c[1] + Math.max(0, Math.sin(T * (3 + exc * 5) + c[4])) * 0.28 * exc,
          c[2],
        );
        dm.rotation.set(0, c[3], 0);
        dm.updateMatrix();
        crowdI.setMatrixAt(i, dm.matrix);
      }
      crowdI.instanceMatrix.needsUpdate = true;
    }
    const [jc, j2] = cv(512, 256),
      jt = TX2(jc),
      js2 = new THREE.MeshBasicMaterial({ map: jt }),
      jum = new THREE.Mesh(new THREE.BoxGeometry(14, 7, 14), [
        js2,
        js2,
        M(0x0a0a10),
        M(0x0a0a10),
        js2,
        js2,
      ]);
    jum.position.set(0, 26, 0);
    S.add(jum);
    let jk = "";
    function jumbo() {
      const k =
        sc[0] +
        "-" +
        sc[1] +
        "-" +
        fmt(clock) +
        "-" +
        Math.ceil(shot) +
        "-" +
        qtr();
      if (k === jk) return;
      jk = k;
      j2.fillStyle = "#05070f";
      j2.fillRect(0, 0, 512, 256);
      j2.fillStyle = "#ffd23f";
      j2.font = "900 30px system-ui";
      j2.textAlign = "center";
      j2.fillText("HOOPS 2K27", 256, 36);
      j2.fillStyle = "#fff";
      j2.font = "800 24px system-ui";
      j2.fillText(((cl && cl[0]) || "").toUpperCase().slice(0, 12), 128, 86);
      j2.fillText(((cl && cl[1]) || "").toUpperCase().slice(0, 12), 384, 86);
      j2.font = "900 84px system-ui";
      j2.fillText(sc[0], 128, 176);
      j2.fillText(sc[1], 384, 176);
      j2.fillStyle = "#ffd23f";
      j2.font = "800 34px system-ui";
      j2.fillText(
        (qtr() > 4 ? "OT" : "Q" + qtr()) + "  " + fmt(clock),
        256,
        226,
      );
      jt.needsUpdate = true;
    }
    const [gcv, g2] = cv(128, 128),
      gr0 = g2.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr0.addColorStop(0, "rgba(255,245,220,1)");
    gr0.addColorStop(0.25, "rgba(255,235,200,.45)");
    gr0.addColorStop(1, "rgba(255,230,190,0)");
    g2.fillStyle = gr0;
    g2.fillRect(0, 0, 128, 128);
    const glow = [];
    for (let i = 0; i < 10; i++) {
      const sp = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: new THREE.CanvasTexture(gcv),
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          transparent: true,
          opacity: 0.75,
          fog: false,
        }),
      );
      sp.scale.set(9, 9, 1);
      sp.position.set(-45 + i * 10, 36, (i % 2 ? 1 : -1) * 12);
      S.add(sp);
      glow.push(sp);
    }
    const fx = makeFx(R, S, cam, 960, 540),
      vpPrev = new THREE.Matrix4(),
      vpNow = new THREE.Matrix4(),
      MV = new THREE.Vector3(),
      MV2 = new THREE.Vector3();
    let lastF = performance.now();
    const fxLevel = () => {
      fx.setLevel(V.QL, V.FX, 960, 540);
      setMirror(V.FX && V.QL >= 2 && lvl >= 4);
    };
    V.onResize = fxLevel;
    const cl2 = new THREE.Vector3(0, 0, 3),
      TV = new THREE.Vector3(),
      PV = new THREE.Vector3();
    let pset = null,
      lastR = 0,
      ema = 16,
      nf = 0,
      lvl = 6,
      lastTot = 0,
      lastQ = -1,
      lastFX = null;
    V.GL = {
      hand(p) {
        const m = p.gl;
        if (!m) return null;
        m.G.updateMatrixWorld(true);
        const v = m.wR.localToWorld(new THREE.Vector3(0, -0.62, 0.1));
        return [v.x * 10 + 470, v.z * 10 + 250, v.y * 10];
      },
      proj(x, y, z) {
        const v = PV.set(x, y, z).project(cam);
        return [(v.x + 1) * 480, (1 - v.y) * 270];
      },
      render() {
        const QL = V.QL;
        if (QL !== lastQ) {
          lastQ = QL;
          lvl = 6;
          R.shadowMap.enabled = QL > 0;
          const ss = QL > 1 ? 2048 : 1024;
          sun.shadow.mapSize.set(ss, ss);
          if (sun.shadow.map) {
            sun.shadow.map.dispose();
            sun.shadow.map = null;
          }
          R.setPixelRatio(Math.min(devicePixelRatio || 1, [1, 1.25, 1.75][QL]));
          R.setSize(960, 540, false);
          crowdI.count = [0, 700, 1800][QL];
          glow.forEach((s) => (s.visible = QL > 0));
          S.traverse((o) => {
            if (o.material)
              [].concat(o.material).forEach((mm) => (mm.needsUpdate = true));
          });
          fxLevel();
        }
        if (V.FX !== lastFX) {
          lastFX = V.FX;
          fxLevel();
        }
        const tot = sc[0] + sc[1];
        if (tot !== lastTot) {
          lastTot = tot;
          exc = 1;
        }
        exc = Math.max(0.3, exc - 0.004);
        if (QL > 0 && (nf & 1) === 0) crowdUpd();
        jumbo();
        const now = performance.now();
        // Adaptive quality: scale resolution first, then shadows, then crowd; recover when frames are fast.
        if (lastR && now - lastR < 250) {
          ema = ema * 0.95 + (now - lastR) * 0.05;
          if (++nf > 90) {
            nf = 0;
            const base = Math.min(devicePixelRatio || 1, [1, 1.25, 1.75][V.QL]);
            if (ema > 24 && lvl > 0) lvl--;
            else if (ema < 14 && lvl < 6) lvl++;
            const scale = [0.55, 0.65, 0.75, 0.85, 1, 1, 1][lvl],
              wantShadow = V.QL > 0 && lvl >= 2,
              crowdN = lvl >= 1 ? [0, 700, 1800][V.QL] : Math.min(400, [0, 700, 1800][V.QL]);
            if (Math.abs(R.getPixelRatio() - base * scale) > 0.01) R.setPixelRatio(base * scale), R.setSize(960, 540, false), V.onResize && V.onResize();
            if (R.shadowMap.enabled !== wantShadow) {
              R.shadowMap.enabled = wantShadow;
              S.traverse((o) => {
                if (o.material) [].concat(o.material).forEach((mm) => (mm.needsUpdate = true));
              });
            }
            crowdI.count = crowdN;
            fxLevel();
            V.perf = { fps: Math.round(1000 / ema), lvl, scale };
          }
        }
        lastR = now;
        if (PC.join() !== pcK) {
          pcK = PC.join();
          court();
        }
        if (P !== pset) {
          if (pset)
            pset.forEach((p) => {
              if (!p.gl) return;
              S.remove(p.gl.G);
              p.gl.mesh.geometry.dispose();
              p.gl.extra.forEach((m) => (m.map && m.map.dispose(), m.dispose()));
            });
          P.forEach((p) => {
            p.gl = makeRig(p, TX2);
            S.add(p.gl.G);
          });
          pset = P;
        }
        if (P.length) {
          const fdt = Math.min(0.1, (performance.now() - lastF) / 1000);
          for (const p of P)
            if (p.gl) {
              applyPose(p.gl, p);
              footIK(p.gl, p, fdt, V.QL > 0 && !RPL);
            }
          const w = W3(B.x, B.y, B.z);
          ball.position.set(w[0], w[1], w[2]);
          ball.rotation.set(B.a * 0.7, 0, B.a);
          {
            const o = B.owner;
            if (!RPL && o && o.gl && (o.mode === "c" || o.mode === "s")) {
              o.gl.G.updateMatrixWorld(true);
              ball.position.copy(o.gl.wR.localToWorld(TV.set(0, -0.62, 0.1)));
            }
          }
        }
        let i = 0;
        for (const N of NETS)
          for (const c of N.c)
            for (const v of [c[0], c[1]]) {
              const w = W3(v.x, v.y, v.z);
              np[i++] = w[0];
              np[i++] = w[1];
              np[i++] = w[2];
            }
        ng.attributes.position.needsUpdate = true;
        led.offset.x = (T * 0.05) % 1;
        {
          const cm = RPL ? 1 : V.CAMM,
            p0 = P.length ? V.focusP() : null,
            hx = (hoop(pos) - 470) * 0.1;
          let tp = [CP[0], 22, 36],
            tl = [CP[0], 0, 3];
          if (cm === 1 && p0) {
            const w = W3(p0.x, p0.y, 0),
              bx = W3(B.x, B.y, 0),
              fx = w[0] * 0.5 + bx[0] * 0.5;
            tp = [fx, 12.5, 26];
            tl = [fx, 2.5, 2];
          } else if (cm === 2) {
            const sg = hx > 0 ? 1 : -1;
            tp = [sg * 58, 13, 0];
            tl = [sg * 20, 3, 0];
          } else if (cm === 3 && p0) {
            const w = W3(p0.x, p0.y, 0),
              dr = hoop(p0.tm) > 470 ? 1 : -1;
            tp = [w[0] - dr * 13, 8.5, w[2] + (w[2] > 0 ? -4 : 4) + 10];
            tl = [w[0] + dr * 9, 3, w[2] * 0.6];
          }
          cam.position.lerp(TV.set(tp[0], tp[1], tp[2]), 0.1);
          cl2.lerp(TV.set(tl[0], tl[1], tl[2]), 0.14);
          cam.lookAt(cl2);
          cam.updateMatrixWorld();
          // Motion blur from how far the scene moved on screen this frame (camera pans, fast cuts),
          // boosted during dribble moves and dunks of the followed player.
          vpNow.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
          MV.copy(cl2).applyMatrix4(vpNow);
          MV2.copy(cl2).applyMatrix4(vpPrev);
          vpPrev.copy(vpNow);
          const fdt2 = Math.min(0.1, (performance.now() - lastF) / 1000);
          lastF = performance.now();
          const fast = p0 && (p0.mvT > 0 || p0.sv === 6) ? 1 : 0,
            shutter = fdt2 > 0 ? Math.min(1, 1 / 60 / fdt2) : 0, // fixed 1/60 s exposure, independent of frame rate
            mvx = (MV.x - MV2.x) * 0.5 * shutter,
            mvy = (MV.y - MV2.y) * 0.5 * shutter,
            ml = Math.hypot(mvx, mvy);
          fx.setMotion(ml > 0.05 ? 0 : mvx, ml > 0.05 ? 0 : mvy, V.FX && V.QL >= 2 && fdt2 > 0 ? Math.min(1.5, 0.6 + fast * 0.9) : 0);
          fx.render(fdt2);
        }
      },
    };
  } catch (e) {
    V.GL = null;
    console.error("WebGL off", e);
  }
}
