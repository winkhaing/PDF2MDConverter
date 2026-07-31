import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  base: "./",
  publicDir: "public",
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "."),
    },
  },
  server: {
    port: 5174,
    strictPort: true,
  },
  build: {
    outDir: "desktop-dist",
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(import.meta.dirname, "index.html"),
    },
  },
});
