// Photo mode (lazy; NOT wired into the game yet): path-traced still of a three.js scene with three-gpu-pathtracer
// (+ three-mesh-bvh for its BVH). ~230 KB of code, so the game must load it with `await import("./photomode")` only
// when the player opens photo mode (and in the single-HTML build that dynamic chunk is still inlined: wire it in only
// if the extra ~0.25 MB is worth it, or ship it in a lab page). WebGL2 only.
//   const png = await pathTrace(renderer, scene, camera, { samples: 64 });   // data URL
import * as THREE from "three";
import { WebGLPathTracer } from "three-gpu-pathtracer";

export async function pathTrace(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, o: { samples?: number; bounces?: number; onProgress?: (n: number) => void } = {}): Promise<string> {
  const pt = new WebGLPathTracer(renderer);
  pt.bounces = o.bounces ?? 4;
  pt.tiles.set(2, 2);
  pt.renderToCanvas = true;
  pt.minSamples = 0;
  pt.setScene(scene, camera);
  const N = o.samples ?? 64;
  while (pt.samples < N) {
    pt.renderSample();
    o.onProgress?.(pt.samples / N);
    await new Promise((r) => requestAnimationFrame(r));
  }
  const url = renderer.domElement.toDataURL("image/png");
  pt.dispose();
  return url;
}
