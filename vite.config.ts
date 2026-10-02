import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// One self-contained HTML (three.js + Rapier wasm inlined, no CDN).
export default defineConfig({
  base: "./",
  plugins: [viteSingleFile({ removeViteModuleLoader: true })],
  build: {
    target: "es2020",
    outDir: "dist",
    emptyOutDir: false,
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 10_000,
    reportCompressedSize: false,
  },
});
