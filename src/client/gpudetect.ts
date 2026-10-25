// GPU tier via @pmndrs/detect-gpu with its benchmark tables bundled from node_modules (no runtime CDN fetch: the
// default loader would pull them from unpkg). Optional companion to view.ts gpuTier() - not wired in yet.
//   const t = await gpuTierDetect();   // { tier 0..3, gpu, fps, isMobile, type }
import { getGPUTier, type TierResult } from "@pmndrs/detect-gpu";

// lazy: each table becomes its own (inlined) chunk and is only parsed when that GPU family is looked up
const TABLES = import.meta.glob("/node_modules/@pmndrs/detect-gpu/dist/benchmarks/*.json", { import: "default" });

export function gpuTierDetect(gl?: WebGLRenderingContext | WebGL2RenderingContext): Promise<TierResult> {
  return getGPUTier({
    glContext: gl,
    override: {
      loadBenchmarks: async (file: string) => {
        const k = Object.keys(TABLES).find((p) => p.endsWith("/" + file));
        if (!k) throw new Error("detect-gpu: no bundled table " + file);
        return (await TABLES[k]()) as any;
      },
    },
  });
}
