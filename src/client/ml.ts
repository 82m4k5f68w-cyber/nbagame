// In-browser ML proof (lazy; NOT imported by the game): ONNX Runtime Web (wasm, single thread, SIMD) running a tiny
// inlined model (assets/ml/pose_mlp.onnx: 31-channel pose denoiser, scripts/assets/ml_tiny.py). The ort wasm is
// gzip-inlined via scripts/assets/vite-gz.ts (with its .mjs glue; pages alias onnxruntime-web/wasm to the
// extern-wasm build, see scripts/assets/demo.vite.ts) (14.8 MB raw -> ~3.4 MB gz -> ~4.5 MB base64) and decompressed with
// DecompressionStream on first use: no CDN fetch. A page that imports this module grows by ~4.6 MB, so only
// import it dynamically (`await import("./ml")`) from an opt-in feature.
import * as ort from "onnxruntime-web/wasm";
import wasmGz from "virtual:gz:onnxruntime-web/dist/ort-wasm-simd-threaded.wasm";
import glueJs from "virtual:gz:onnxruntime-web/dist/ort-wasm-simd-threaded.mjs";
import modelUrl from "../../assets/ml/pose_mlp.onnx?inline";

let ready: Promise<ort.InferenceSession> | null = null;
async function gunzip(b64: string): Promise<ArrayBuffer> {
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const s = new Blob([bin]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(s).arrayBuffer();
}
/** Load the runtime + model once. */
export function mlSession(): Promise<ort.InferenceSession> {
  return (ready ||= (async () => {
    const wasm = await gunzip(wasmGz);
    ort.env.wasm.numThreads = 1; // no SharedArrayBuffer / COOP-COEP needed
    ort.env.wasm.proxy = false;
    const glue = await gunzip(glueJs);
    ort.env.wasm.wasmPaths = {
      wasm: URL.createObjectURL(new Blob([wasm], { type: "application/wasm" })),
      mjs: URL.createObjectURL(new Blob([glue], { type: "text/javascript" })),
    } as any;
    const model = new Uint8Array(await (await fetch(modelUrl)).arrayBuffer());
    return ort.InferenceSession.create(model, { executionProviders: ["wasm"] });
  })());
}
/** Run the pose denoiser on one 31-float pose vector. */
export async function denoisePose(pose: number[]): Promise<number[]> {
  const s = await mlSession();
  const out = await s.run({ pose: new ort.Tensor("float32", Float32Array.from(pose), [1, 31]) });
  return Array.from(out.clean.data as Float32Array);
}
