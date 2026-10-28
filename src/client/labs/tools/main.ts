// Tools Lab: proofs for the lazy / opt-in libraries. tests/browser_tools.mjs reads window.__TOOLS.
import * as THREE from "three";
import * as Tone from "tone";
import { denoisePose } from "../../ml";
import { pathTrace } from "../../photomode";
import probe from "../../../../assets/ml/pose_mlp.probe.json";
import { loadKit, model } from "../../models";

const R: any = ((window as any).__TOOLS = { done: false, errors: [] as string[] });
const out = document.getElementById("out")!;
const step = async (k: string, f: () => Promise<any>) => {
  const t0 = performance.now();
  try {
    R[k] = { ...(await f()), ms: Math.round(performance.now() - t0) };
  } catch (e: any) {
    R[k] = { error: String(e?.message || e) };
    R.errors.push(k + ": " + R[k].error);
  }
  out.textContent = JSON.stringify(R, null, 1);
};
(async () => {
await step("onnx", async () => {
  const y = await denoisePose(probe.noisy);
  const d = Math.max(...y.map((v, i) => Math.abs(v - probe.torch[i]))),
    mse = (a: number[]) => a.reduce((s, v, i) => s + (v - probe.clean[i]) ** 2, 0) / a.length;
  return { maxDiffVsTorch: d, mseIn: mse(probe.noisy), mseOut: mse(y) };
});
await step("tone", async () => {
  const buf = await Tone.Offline(() => {
    const s = new Tone.PolySynth(Tone.Synth).toDestination();
    s.triggerAttackRelease(["C4", "E4", "G4"], 0.25); // organ-ish stab, the kind music.ts could move to Tone
  }, 0.5);
  const d = buf.getChannelData(0);
  let e = 0;
  for (const v of d) e += v * v;
  return { version: Tone.version, rms: Math.sqrt(e / d.length), sec: buf.duration };
});
await step("pathtracer", async () => {
  const cv = document.getElementById("c") as HTMLCanvasElement;
  const ren = new THREE.WebGLRenderer({ canvas: cv, preserveDrawingBuffer: true });
  ren.setSize(320, 180, false);
  const sc = new THREE.Scene();
  sc.background = new THREE.Color(0x202840);
  sc.environment = null;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: 0xc89a5a, roughness: 0.35 }));
  floor.rotation.x = -Math.PI / 2;
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.8, 48, 24), new THREE.MeshStandardMaterial({ color: 0xe8681c, roughness: 0.6 }));
  ball.position.set(0, 0.8, 0);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(1.5, 16, 8), new THREE.MeshStandardMaterial({ emissive: 0xffffff, emissiveIntensity: 12 }));
  lamp.position.set(3, 7, 3);
  sc.add(floor, ball, lamp);
  await loadKit("furniture");
  const bench = await model("furniture", "bench", { scale: 2 });
  bench.position.set(-2.5, 0, -1);
  sc.add(bench);
  const cam = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 100);
  cam.position.set(0, 3, 8);
  cam.lookAt(0, 0.8, 0);
  const url = await pathTrace(ren, sc, cam, { samples: 16, bounces: 3 });
  // fraction of lit pixels in the traced image (SwiftShader: noisy after 16 samples, but clearly lit)
  const img = new Image();
  img.src = url;
  await img.decode();
  const c2 = document.createElement("canvas");
  (c2.width = 160), (c2.height = 90);
  const x2 = c2.getContext("2d")!;
  x2.drawImage(img, 0, 0, 160, 90);
  const d = x2.getImageData(0, 0, 160, 90).data;
  let lit = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 90) lit++;
  return { samples: 16, litFrac: +(lit / (160 * 90)).toFixed(3), pngBytes: url.length };
});
R.done = true;
out.textContent = JSON.stringify(R, null, 1);
})();
