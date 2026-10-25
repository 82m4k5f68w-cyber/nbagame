// Asset Lab page (textures / models / voice bank demo): npx vite build --config scripts/assets/demo.vite.ts
// -> dist/assets-demo/index.html (one self-contained file). Dev: npx vite --config scripts/assets/demo.vite.ts
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import path from "node:path";
const R = path.resolve(__dirname, "../..");
export default defineConfig({
  root: path.join(R, "src/client/assetsdemo"),
  base: "./",
  server: { fs: { allow: [R] } },
  plugins: [viteSingleFile({ removeViteModuleLoader: true })],
  assetsInclude: ["**/*.glb", "**/*.ktx2", "**/*.bin"], // asset pipeline outputs (scripts/assets), imported with ?inline
  build: { target: "es2020", outDir: path.join(R, "dist/assets-demo"), emptyOutDir: true, assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 20_000, reportCompressedSize: false },
});
