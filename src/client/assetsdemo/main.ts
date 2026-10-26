// Asset Lab: texture sets on spheres + tiles, the Kenney kits in rows, voice bank buttons. Built by
// `npx vite build --config scripts/assets/demo.vite.ts` (dist/assets-demo/index.html); tests/browser_assets.mjs reads window.__ASSETS.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { texLib, TEXSETS, type TexName } from "../tex";
import { loadKit, model, KITS, type KitName } from "../models";
import { voiceReady, aiSay, paIntro, paEvent, voiceInfo } from "../voice";
import { gpuTierDetect } from "../gpudetect";

const A: any = ((window as any).__ASSETS = { tex: {}, models: {}, voice: null, gpu: null, errors: [] as string[], done: false, vi: () => voiceInfo() });
const cv = document.getElementById("c") as HTMLCanvasElement,
  info = document.getElementById("info")!;
const R = new THREE.WebGLRenderer({ canvas: cv, antialias: true });
R.setPixelRatio(Math.min(2, devicePixelRatio));
const S = new THREE.Scene();
S.background = new THREE.Color(0x0b0e1c);
const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
cam.position.set(0, 14, 30);
const ctl = new OrbitControls(cam, cv);
ctl.target.set(0, 2, 0);
S.add(new THREE.HemisphereLight(0xdde6ff, 0x30281c, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.position.set(8, 16, 10);
S.add(sun);
function size() {
  const w = cv.clientWidth,
    h = cv.clientHeight;
  R.setSize(w, h, false);
  cam.aspect = w / h;
  cam.updateProjectionMatrix();
}
addEventListener("resize", size);
size();
R.setAnimationLoop(() => (ctl.update(), R.render(S, cam)));

async function run() {
  const lib = await texLib(R);
  A.tex.ktx2 = lib.ktx2;
  const names = Object.keys(TEXSETS) as TexName[];
  await Promise.all(
    names.map(async (n, i) => {
      try {
        const x = (i - (names.length - 1) / 2) * 3.2;
        const ball = new THREE.Mesh(new THREE.SphereGeometry(1.2, 48, 24), new THREE.MeshStandardMaterial());
        const tile = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshStandardMaterial());
        const m = await lib.apply(ball.material as THREE.MeshStandardMaterial, n, { repeat: [2, 1] });
        await lib.apply(tile.material as THREE.MeshStandardMaterial, n);
        ball.position.set(x, 1.4, 6);
        tile.rotation.x = -Math.PI / 2;
        tile.position.set(x, 0.01, 9.5);
        S.add(ball, tile);
        A.tex[n] = { ktx2: m.ktx2, w: (m.map.image as any)?.width || 0, normal: !!m.normalMap };
      } catch (e: any) {
        A.errors.push("tex " + n + ": " + e.message);
      }
    }),
  );
  let row = 0;
  for (const k of Object.keys(KITS) as KitName[]) {
    try {
      const kit = await loadKit(k);
      A.models[k] = kit.names.length;
      let x = -kit.names.length * 0.9;
      for (const n of kit.names) {
        const o = await model(k, n);
        const b = new THREE.Box3().setFromObject(o),
          s = 1.6 / Math.max(0.01, b.getSize(new THREE.Vector3()).length());
        o.scale.setScalar(s);
        o.position.set(x, 0, -row * 3);
        x += 1.8;
        S.add(o);
      }
    } catch (e: any) {
      A.errors.push("model " + k + ": " + e.message);
    }
    row++;
  }
  A.voice = (await voiceReady()) ? voiceInfo() : { failed: true };
  try {
    A.gpu = await gpuTierDetect();
  } catch (e: any) {
    A.errors.push("gpu: " + e.message);
  }
  A.done = true;
  info.textContent = JSON.stringify({ tex: A.tex, models: A.models, voice: A.voice, gpu: A.gpu && { tier: A.gpu.tier, gpu: A.gpu.gpu, type: A.gpu.type }, errors: A.errors }, null, 1);
}
const line = document.getElementById("line") as HTMLInputElement;
document.getElementById("say")!.onclick = () => {
  if (!aiSay(line.value, true, 0.5)) info.textContent = "no full match in the bank for: " + line.value + " (the game would use browser speech)";
};
document.getElementById("intro")!.onclick = () => paIntro(30, "Curry", false);
document.getElementById("three")!.onclick = () => paEvent("three");
run().catch((e) => (A.errors.push(String(e)), (A.done = true), (info.textContent = String(e))));
