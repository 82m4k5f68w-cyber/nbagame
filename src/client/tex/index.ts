// CC0 PBR texture library (ambientCG via scripts/assets/textures.ts): KTX2 (Basis) colour / normal / roughness maps,
// inlined as base64 together with three's Basis transcoder (js + wasm), so it works inside the single HTML (no CDN).
// NOT wired into render3d yet - see docs/ASSETS.md. Importing this module adds ~3.1 MB to the build.
//   const lib = await texLib(renderer);            // WebGL or WebGPU renderer
//   await lib.apply(mat, "woodMaple", { repeat: [12, 6] });
// If KTX2 cannot be transcoded (old browser, transcoder error) every set degrades to its 256 px WebP colour map.
import * as THREE from "three";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import transcoderJs from "three/examples/jsm/libs/basis/basis_transcoder.js?raw";
import transcoderWasm from "three/examples/jsm/libs/basis/basis_transcoder.wasm?inline";
import { TEXSETS, type TexName } from "./manifest.gen";
export { TEXSETS, type TexName };

const b64buf = async (dataUrl: string) => (await fetch(dataUrl)).arrayBuffer();
export type TexMaps = { map: THREE.Texture; normalMap: THREE.Texture | null; roughnessMap: THREE.Texture | null; ktx2: boolean };
export type ApplyOpts = { repeat?: [number, number]; normalScale?: number; anisotropy?: number; roughness?: number };

let shared: Promise<TexLib> | null = null;
/** One library per page (one transcoder worker pool). */
export function texLib(renderer: any): Promise<TexLib> {
  return (shared ||= TexLib.create(renderer));
}
export class TexLib {
  private ktx: KTX2Loader | null = null;
  private cache = new Map<string, Promise<TexMaps>>();
  static async create(renderer: any) {
    const L = new TexLib();
    try {
      const jsUrl = URL.createObjectURL(new Blob([transcoderJs], { type: "text/javascript" }));
      const mgr = new THREE.LoadingManager();
      mgr.setURLModifier((u) => (/basis_transcoder\.js$/.test(u) ? jsUrl : /basis_transcoder\.wasm$/.test(u) ? transcoderWasm : u));
      const k = new KTX2Loader(mgr).setTranscoderPath("inline/").setWorkerLimit(2);
      if (renderer?.isWebGPURenderer && renderer.init) await renderer.init();
      k.detectSupport(renderer);
      L.ktx = k;
    } catch (e) {
      L.ktx = null; // fallback textures only
    }
    return L;
  }
  /** KTX2 transcoding available (false = WebP fallbacks). */
  get ktx2() {
    return !!this.ktx;
  }
  private async ktxTex(dataUrl: string): Promise<THREE.Texture> {
    const buf = await b64buf(dataUrl);
    return new Promise((res, rej) => this.ktx!.parse(buf, res as any, rej));
  }
  private async fallback(name: TexName): Promise<THREE.Texture> {
    const blob = await (await fetch(TEXSETS[name].fb)).blob();
    const img = await createImageBitmap(blob, { imageOrientation: "flipY" } as any).catch(() => createImageBitmap(blob));
    const t = new THREE.Texture(img as any);
    t.generateMipmaps = true;
    t.needsUpdate = true;
    return t;
  }
  /** The maps of one set (cached; the same Texture objects are shared - clone() before changing repeat per material). */
  load(name: TexName): Promise<TexMaps> {
    let p = this.cache.get(name);
    if (!p) {
      const s = TEXSETS[name];
      p = (async () => {
        if (this.ktx)
          try {
            const [map, normalMap, roughnessMap] = await Promise.all([this.ktxTex(s.c), this.ktxTex(s.n), this.ktxTex(s.r)]);
            map.colorSpace = THREE.SRGBColorSpace;
            normalMap.colorSpace = roughnessMap.colorSpace = THREE.NoColorSpace;
            for (const t of [map, normalMap, roughnessMap]) t.wrapS = t.wrapT = THREE.RepeatWrapping;
            return { map, normalMap, roughnessMap, ktx2: true };
          } catch (e) {
            /* fall through to WebP */
          }
        const map = await this.fallback(name);
        map.colorSpace = THREE.SRGBColorSpace;
        map.wrapS = map.wrapT = THREE.RepeatWrapping;
        return { map, normalMap: null, roughnessMap: null, ktx2: false };
      })();
      this.cache.set(name, p);
    }
    return p;
  }
  /** Put a set on a MeshStandardMaterial / MeshPhysicalMaterial (keeps its colour as a tint). */
  async apply(mat: THREE.MeshStandardMaterial, name: TexName, o: ApplyOpts = {}) {
    const m = await this.load(name),
      rep = o.repeat || [1, 1],
      own = (t: THREE.Texture | null) => {
        if (!t) return null;
        const c = t.clone();
        c.repeat.set(rep[0], rep[1]);
        if (o.anisotropy) c.anisotropy = o.anisotropy;
        c.needsUpdate = true;
        return c;
      };
    mat.map = own(m.map);
    mat.normalMap = own(m.normalMap);
    mat.roughnessMap = own(m.roughnessMap);
    if (mat.normalMap) mat.normalScale.setScalar(o.normalScale ?? 1);
    if (o.roughness != null) mat.roughness = o.roughness;
    else if (mat.roughnessMap) mat.roughness = 1; // the map holds the real values
    mat.metalness = TEXSETS[name].metal;
    mat.needsUpdate = true;
    return m;
  }
  dispose() {
    this.ktx?.dispose();
    this.cache.clear();
    shared = null;
  }
}
