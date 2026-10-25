import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// One self-contained HTML (three.js + Rapier wasm inlined, no CDN).
export default defineConfig({
  base: "./",
  plugins: [viteSingleFile({ removeViteModuleLoader: true })],
  assetsInclude: ["**/*.glb", "**/*.ktx2", "**/*.bin", "**/basis_transcoder.wasm"], // asset pipeline outputs (scripts/assets), imported with ?inline
  build: {
    target: "es2020",
    outDir: "dist",
    emptyOutDir: false,
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 10_000,
    reportCompressedSize: false,
  },
});
