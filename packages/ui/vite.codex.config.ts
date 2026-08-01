import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(packageDir, "..", "..");
const pluginDist = path.join(repositoryRoot, "clients", "codex-plugin", "dist");

function copyCanvasHtml(): Plugin {
  return {
    name: "mindart-copy-canvas-html",
    async closeBundle() {
      const uiDir = path.join(pluginDist, "ui");
      await mkdir(uiDir, { recursive: true });
      await copyFile(
        path.join(packageDir, "dist", "mcp-app.html"),
        path.join(uiDir, "mcp-app.html"),
      );
    },
  };
}

export default defineConfig({
  plugins: [copyCanvasHtml()],
  build: {
    ssr: path.join(repositoryRoot, "packages", "server", "src", "index.ts"),
    target: "node20",
    outDir: pluginDist,
    emptyOutDir: true,
    copyPublicDir: false,
    minify: false,
    rollupOptions: {
      external: [/^node:/],
      output: {
        entryFileNames: "server.mjs",
        format: "es",
      },
    },
  },
  ssr: {
    noExternal: true,
  },
});
