import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base: the built site works from any directory (GitHub Pages project sites).
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { outDir: "dist", target: "es2022" },
  server: { fs: { allow: ["../.."] } },
});
