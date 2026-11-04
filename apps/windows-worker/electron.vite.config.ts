import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve(__dirname, "electron/main.ts") } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: resolve(__dirname, "electron/preload.ts") },
    },
  },
  renderer: {
    root: resolve(__dirname, "src"),
    plugins: [
      react(),
      {
        name: "development-react-refresh-csp",
        apply: "serve",
        // Vite's React refresh preamble is inline in development only.
        // The built application's script policy remains self-only.
        transformIndexHtml: {
          order: "post",
          handler: (html: string) =>
            html.replace(
              "script-src 'self';",
              "script-src 'self' 'unsafe-inline';",
            ),
        },
      } satisfies Plugin,
    ],
    build: { rollupOptions: { input: resolve(__dirname, "src/index.html") } },
  },
});
