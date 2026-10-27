// Renderer textures (graphics v6): the CC0 ambientCG sets the arena + street actually draw, imported one by one
// (NOT through tex/manifest.gen.ts, which would inline all nine sets, ~2.5 MB). KTX2 (Basis) via three's inlined
// transcoder; when KTX2 can't be transcoded, nothing is applied and the procedural canvas maps stay (no WebP needed).
//   woodMaple: arena floor detail (colour multiplied into the painted court + normal + roughness)
//   asphalt:   street court surface (colour + normal + roughness)
// Loaded lazily on Medium+ (Low never pays the transcode). WebGPU: same textures (KTX2Loader.detectSupport(renderer)).
import * as THREE from "three";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import transcoderJs from "three/examples/jsm/libs/basis/basis_transcoder.js?raw";
import transcoderWasm from "three/examples/jsm/libs/basis/basis_transcoder.wasm?inline";
import woodC from "../../assets/textures/woodMaple_c.ktx2?inline";
import woodN from "../../assets/textures/woodMaple_n.ktx2?inline";
import woodR from "../../assets/textures/woodMaple_r.ktx2?inline";
import asphC from "../../assets/textures/asphalt_c.ktx2?inline";
import asphN from "../../assets/textures/asphalt_n.ktx2?inline";
import asphR from "../../assets/textures/asphalt_r.ktx2?inline";

export type GfxSet = { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture };
const SETS = { wood: [woodC, woodN, woodR], asphalt: [asphC, asphN, asphR] } as const;
export type GfxName = keyof typeof SETS;

let ktx: Promise<KTX2Loader | null> | null = null;
function loader(renderer: any) {
  return (ktx ||= (async () => {
    try {
      const jsUrl = URL.createObjectURL(new Blob([transcoderJs], { type: "text/javascript" }));
      const mgr = new THREE.LoadingManager();
      mgr.setURLModifier((u) => (/basis_transcoder\.js$/.test(u) ? jsUrl : /basis_transcoder\.wasm$/.test(u) ? transcoderWasm : u));
      const k = new KTX2Loader(mgr).setTranscoderPath("inline/").setWorkerLimit(1);
      if (renderer?.isWebGPURenderer && renderer.init) await renderer.init();
      k.detectSupport(renderer);
      return k;
    } catch (e) {
      return null;
    }
  })());
}
const cache = new Map<GfxName, Promise<GfxSet | null>>();
/** One set (cached, shared Texture objects: clone() before changing repeat). Resolves null when KTX2 is unavailable. */
export function gfxTex(renderer: any, name: GfxName): Promise<GfxSet | null> {
  let p = cache.get(name);
  if (!p) {
    p = (async () => {
      const k = await loader(renderer);
      if (!k) return null;
      try {
        const one = async (u: string) => {
          const buf = await (await fetch(u)).arrayBuffer();
          return new Promise<THREE.Texture>((res, rej) => k.parse(buf, res as any, rej));
        };
        const [map, normalMap, roughnessMap] = await Promise.all(SETS[name].map(one));
        map.colorSpace = THREE.SRGBColorSpace;
        normalMap.colorSpace = roughnessMap.colorSpace = THREE.NoColorSpace;
        for (const t of [map, normalMap, roughnessMap]) t.wrapS = t.wrapT = THREE.RepeatWrapping;
        return { map, normalMap, roughnessMap };
      } catch (e) {
        console.warn("gfxtex: " + name + " unavailable", e);
        return null;
      }
    })();
    cache.set(name, p);
  }
  return p;
}
