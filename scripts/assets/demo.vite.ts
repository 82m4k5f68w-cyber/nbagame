// Lab pages (each ONE self-contained HTML, never part of the game build):
//   npx vite build --config scripts/assets/demo.vite.ts            -> dist/assets-demo/index.html (textures, models, voice bank)
//   LAB=tools  npx vite build --config scripts/assets/demo.vite.ts -> dist/labs/tools/index.html (ONNX, Tone.js, path tracer)
//   LAB=motion npx vite build --config scripts/assets/demo.vite.ts -> dist/labs/motion/index.html (MediaPipe Motion Studio)
// Dev: same with `npx vite --config ...`.
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import path from "node:path";
import { gzInline } from "./vite-gz";
const R = path.resolve(__dirname, "../.."),
  LAB = process.env.LAB || "";
export default defineConfig({
  root: LAB ? path.join(R, "src/client/labs", LAB) : path.join(R, "src/client/assetsdemo"),
  base: "./",
  server: { fs: { allow: [R] } },
  // ort's default bundle has `new URL("ort-wasm-simd-threaded.wasm", import.meta.url)`, which Vite would inline twice
  // (2 x 19 MB): use the extern-wasm build; ml.ts hands it the gzip-inlined wasm + glue as blob URLs.
  resolve: { alias: [{ find: /^onnxruntime-web\/wasm$/, replacement: path.join(R, "node_modules/onnxruntime-web/dist/ort.wasm.min.mjs") }] },
  plugins: [gzInline(R), viteSingleFile({ removeViteModuleLoader: true })],
  assetsInclude: ["**/*.glb", "**/*.ktx2", "**/*.bin", "**/basis_transcoder.wasm", "**/*.onnx", "**/*.task"], // asset pipeline outputs (scripts/assets), imported with ?inline
  build: { target: "es2020", outDir: LAB ? path.join(R, "dist/labs", LAB) : path.join(R, "dist/assets-demo"), emptyOutDir: true, assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 20_000, reportCompressedSize: false },
});
