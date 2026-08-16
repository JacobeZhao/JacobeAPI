import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  publicDir: false,
  plugins: [
    react(),
    {
      name: "desktop-brand-assets",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "icons/brand-mark.svg",
          source: readFileSync(resolve(import.meta.dirname, "src/desktop/assets/brand-mark.svg")),
        });
      },
    },
  ],
  build: {
    outDir: "dist-desktop",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        manager: resolve(import.meta.dirname, "desktop-manager.html"),
        quick: resolve(import.meta.dirname, "desktop-quick.html"),
        orb: resolve(import.meta.dirname, "desktop-orb.html"),
      },
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
