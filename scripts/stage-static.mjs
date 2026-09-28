// After `vite build`, put the static client under dist/site/game/ so the deployment serves
// the game at <deployment>/game/ exactly as tylerszakacs.com/game will (every asset URL in
// the build already starts with /game/).
import { cpSync, existsSync, rmSync } from "node:fs";

const src = "dist/client";
const out = "dist/site";
if (!existsSync(`${src}/index.html`)) {
  console.error(`[stage-static] ${src}/index.html is missing: did vite build run?`);
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
cpSync(src, `${out}/game`, { recursive: true });
console.log(`[stage-static] ${src} -> ${out}/game`);
