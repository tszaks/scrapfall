// Fails if a folder under src/ is missing from docs/REPO_MAP.md, so the map can't silently go stale.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const map = readFileSync("docs/REPO_MAP.md", "utf8");
const missing = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const path = join(dir, e.name);
    if (path === "src/components/ui") continue; // generated shadcn primitives, listed as one line
    if (!map.includes(`${path}/`)) missing.push(`${path}/`);
    walk(path);
  }
})("src");
if (missing.length) {
  console.error(`docs/REPO_MAP.md is missing these folders:\n  ${missing.join("\n  ")}\nAdd a line for each.`);
  process.exit(1);
}
console.log("docs/REPO_MAP.md covers every folder under src/");
