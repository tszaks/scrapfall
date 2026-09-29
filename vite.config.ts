// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [
      {
        // Dev only: the preview tags every JSX element with data-tsd-source. On 3D scene
        // elements React Three Fiber treats that as a nested property and crashes on unmount.
        name: "strip-tsd-source-3d",
        enforce: "pre",
        transform(code: string, id: string) {
          if (!/\/src\/(game|bro)\//.test(id) || !id.endsWith(".tsx")) return null;
          if (!code.includes("data-tsd-source")) return null;
          return { code: code.replace(/\s+data-tsd-source=(?:"[^"]*"|\{[^}]*\})/g, ""), map: null };
        },
      },
    ],
  },
});
