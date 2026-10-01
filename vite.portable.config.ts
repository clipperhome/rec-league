import { resolve } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

function offlineCsp(): Plugin {
  let building = false;
  return {
    configResolved(config) {
      building = config.command === "build";
    },
    name: "portable-offline-csp",
    transformIndexHtml(html) {
      if (!building) return html;
      return html.replace(
        "<head>",
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'none'; img-src data: blob:; media-src 'none'; font-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';">`,
      );
    },
  };
}

export default defineConfig({
  base: "./",
  build: {
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
    emptyOutDir: true,
    modulePreload: { polyfill: false },
    outDir: resolve(__dirname, "dist"),
    rollupOptions: {
      input: resolve(__dirname, "portable", "rec-league.html"),
    },
    sourcemap: false,
  },
  plugins: [react(), tailwindcss(), offlineCsp(), viteSingleFile()],
  publicDir: false,
  resolve: {
    alias: { "@": resolve(__dirname) },
  },
  root: resolve(__dirname, "portable"),
});
