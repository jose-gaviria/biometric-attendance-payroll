import { defineConfig } from "vite";
export default defineConfig({
  root: "client",
  build: { outDir: "../dist/client", emptyOutDir: true },
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:8080" } },
});
