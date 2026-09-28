// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     VITE_* env injection, @ path alias, React/TanStack dedupe, error logger plugins, and
//     sandbox detection (port/host/strictPort).
//
// The game ships as a STATIC single-page app served under /game/ (tylerszakacs.com/game):
// no server runtime (nitro off), TanStack Start SPA mode prerenders one HTML shell.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export const BASE = "/game/";

export default defineConfig({
  nitro: false,
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    server: { entry: "server" },
    spa: {
      enabled: true,
      prerender: { outputPath: "/index.html", crawlLinks: false },
    },
  },
  vite: {
    base: BASE,
  },
});
