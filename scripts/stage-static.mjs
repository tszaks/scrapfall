// After `vite build`, put the static client under dist/site/gta/ so the deployment serves
// the game at <deployment>/gta/ exactly as tylerszakacs.com/gta will (every asset URL in
// the build already starts with /gta/).
import { cpSync, existsSync, rmSync } from "node:fs";

const src = "dist/client";
const out = "dist/site";
if (!existsSync(`${src}/index.html`)) {
  console.error(`[stage-static] ${src}/index.html is missing: did vite build run?`);
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
cpSync(src, `${out}/gta`, { recursive: true });
console.log(`[stage-static] ${src} -> ${out}/gta`);
