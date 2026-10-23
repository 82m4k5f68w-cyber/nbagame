// Kenney CC0 model kits (scripts/assets/models.ts -> assets/models/*.glb, meshopt-compressed, inlined as base64).
// NOT wired into any mode yet: importing this module adds ~1.1 MB to the build. See docs/ASSETS.md for the model list.
//   const car = await model("cars", "taxi");          // a fresh clone (THREE.Object3D), shares geometry / materials
//   const kit = await loadKit("furniture");           // { scene, names }
// Kenney units: 1 unit = 1 m-ish grid cell; game 3D world is in feet (scale ~3.28 for real-size props).
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import city from "../../assets/models/city.glb?inline";
import roads from "../../assets/models/roads.glb?inline";
import cars from "../../assets/models/cars.glb?inline";
import furniture from "../../assets/models/furniture.glb?inline";

export const KITS = { city, roads, cars, furniture };
export type KitName = keyof typeof KITS;
type Kit = { scene: THREE.Group; names: string[]; byName: Map<string, THREE.Object3D> };
const cache = new Map<KitName, Promise<Kit>>();
let loader: GLTFLoader | null = null;

/** Parse one kit GLB (cached). Each model is a root child of the scene, named like the Kenney file. */
export function loadKit(kit: KitName): Promise<Kit> {
  let p = cache.get(kit);
  if (!p) {
    p = (async () => {
      if (!loader) (loader = new GLTFLoader()), loader.setMeshoptDecoder(MeshoptDecoder);
      await (MeshoptDecoder as any).ready;
      const buf = await (await fetch(KITS[kit])).arrayBuffer();
      const g = await loader.parseAsync(buf, "");
      const byName = new Map<string, THREE.Object3D>();
      for (const c of g.scene.children) byName.set(c.name, c);
      return { scene: g.scene, names: [...byName.keys()], byName };
    })();
    cache.set(kit, p);
  }
  return p;
}
/** A positioned-at-origin clone of one model (throws on an unknown name). opts.shadows: cast + receive. */
export async function model(kit: KitName, name: string, opts: { scale?: number; shadows?: boolean } = {}): Promise<THREE.Object3D> {
  const k = await loadKit(kit),
    src = k.byName.get(name);
  if (!src) throw new Error(`models: ${kit}/${name} not found (have: ${k.names.join(", ")})`);
  const o = src.clone(true);
  o.position.set(0, 0, 0);
  if (opts.scale) o.scale.setScalar(opts.scale);
  if (opts.shadows)
    o.traverse((m: any) => {
      if (m.isMesh) m.castShadow = m.receiveShadow = true;
    });
  return o;
}
/** Names available in a kit (after loading). */
export const kitNames = async (kit: KitName) => (await loadKit(kit)).names;
