import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Flask serves the built bundle from web/static/app under /static/app/ and
// answers every other path with index.html (see web/app.py:_register_spa).
// In dev the app is served from "/" so Vite's SPA fallback handles deep links;
// /api and /group-bookings are proxied to the Flask API.
const API_TARGET = process.env.VITE_API_TARGET ?? "http://127.0.0.1:5106";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/static/app/" : "/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  build: {
    outDir: "../web/static/app",
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: false },
      "/group-bookings": { target: API_TARGET, changeOrigin: false },
    },
  },
}));
