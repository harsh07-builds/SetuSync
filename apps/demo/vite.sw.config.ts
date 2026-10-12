import { defineConfig } from "vite";

// Second build step: bundles the Background Sync worker code into dist/bg-sync.js
// (a single classic script, so the service worker can importScripts() it).
export default defineConfig({
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: false,
    minify: true,
    lib: { entry: "src/sw-bg.ts", formats: ["iife"], name: "SetuSyncBackgroundSync", fileName: () => "bg-sync.js" },
  },
});
