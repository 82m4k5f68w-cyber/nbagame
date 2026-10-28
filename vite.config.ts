import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { VitePWA } from "vite-plugin-pwa";

// One self-contained HTML (three.js + Rapier wasm inlined, no CDN).
// PWA (installable, offline): workbox writes dist/sw.js next to the page; public/ holds the manifest + procedural icons
// (scripts/assets/pwa-icons.mjs). Nothing is injected into the HTML: client/pwa.ts registers the worker and adds the
// manifest link at runtime, and only when served over http(s), top-level, outside claude.ai (artifact.html never does).
export default defineConfig({
  base: "./",
  plugins: [
    viteSingleFile({ removeViteModuleLoader: true }),
    VitePWA({
      injectRegister: false,
      manifest: false,
      strategies: "generateSW",
      workbox: {
        globPatterns: ["index.html", "manifest.webmanifest", "icons/*.png"],
        maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
        navigateFallback: null,
        cleanupOutdatedCaches: true,
        // every page (hub, modes/*.html written by postbuild) is cached on first visit and served offline after
        runtimeCaching: [{ urlPattern: ({ request }) => request.destination === "document", handler: "NetworkFirst", options: { cacheName: "h2k-pages", networkTimeoutSeconds: 4 } }],
      },
    }),
  ],
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
