import { defineConfig, type Plugin } from "vite";
import { vi } from "./src/i18n/vi.ts";

const PORT = 4664;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function lookup(path: string): string {
  let node: unknown = vi;
  for (const key of path.split(".")) {
    node = typeof node === "object" && node !== null ? (node as Record<string, unknown>)[key] : undefined;
  }
  if (typeof node !== "string") throw new Error(`index.html: no string at vi.${path}`);
  return node;
}

// Facebook/Zalo reject a relative og:image, so the canonical domain is the default (a build without SITE_URL shipped `/og.jpg`).
const SITE_URL = (process.env.SITE_URL || "https://santinh.com").replace(/\/$/, "");

// The boot screen is static HTML (shown before JS runs) but its copy must still live in vi.ts.
function viHtml(): Plugin {
  return {
    name: "santinh-vi-html",
    transformIndexHtml: {
      order: "pre",
      handler: (html) =>
        html
          .replace(/\{\{site\}\}/g, escapeHtml(SITE_URL))
          .replace(/\{\{vi\.([\w.]+)\}\}/g, (_, path: string) => escapeHtml(lookup(path))),
    },
  };
}

export default defineConfig({
  plugins: [viHtml()],
  server: {
    port: PORT,
    strictPort: true,
    // Dev: the realtime server runs on 4663 (npm run dev).
    proxy: { "/ws": { target: "http://localhost:4663", ws: true }, "/api": "http://localhost:4663" },
  },
  preview: { port: PORT, strictPort: true },
  // three.js alone is ~550 kB minified; it loads lazily behind the boot screen like the source site's game.js.
  build: { chunkSizeWarningLimit: 800 },
});
