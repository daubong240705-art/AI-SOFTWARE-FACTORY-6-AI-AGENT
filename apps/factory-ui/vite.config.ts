/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig, searchForWorkspaceRoot } from "vite";
import { fileURLToPath } from "node:url";

// Dev: the UI is served by Vite, the Host API by the Host; the proxy makes them look like one origin
// (the Host only accepts its own Host and Origin headers).
const hostPort = process.env.FACTORY_PORT ?? "8787";
const hostOrigin = `http://127.0.0.1:${hostPort}`;

export default defineConfig({
  plugins: [react()],
  server: {
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), fileURLToPath(new URL("../../design/factory-v2", import.meta.url))] },
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: hostOrigin,
        rewrite: (path) => path.replace(/^\/api/, ""),
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => proxyReq.setHeader("origin", hostOrigin));
        },
      },
    },
  },
  build: { outDir: "dist", sourcemap: false, target: "es2022" },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"],
    setupFiles: ["test/setup.ts"],
    restoreMocks: true,
  },
});
