// Smoke test: serve the static build, enter every offered map in headless Chromium,
// and fail on any page error or console error. Usage: npm run build && npm run smoke
// Needs Playwright's Chromium: npx playwright install chromium
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { readdir, readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const development = process.argv.includes("--development");
const assets = await readdir("dist/site/game/assets");
assert.equal(
  assets.some((name) => name.startsWith("NuketownMap-")),
  development,
  "Nuketown scene must ship only in the development build",
);

const code = (
  await Promise.all(
    assets
      .filter((name) => name.endsWith(".js"))
      .map((name) => readFile(`dist/site/game/assets/${name}`, "utf8")),
  )
).join("\n");
for (const [prefix, expected] of [
  ["scrapfall-dev-arena-v18-", development],
  ["scrapfall-ts-arena-v18-", !development],
]) {
  assert.equal(code.includes(prefix), expected, `room namespace ${prefix}`);
}
const PORT = Number(process.env.PORT ?? 4173);
// Numeric URLs are part of the public API; Nuketown retains index 14 for room seeds.
const MAPS = development
  ? [
      ["nuketown", "Nuketown"],
      ["14", "Nuketown"],
    ]
  : [
      ["vice", "Vice Heights"],
      ["gulch", "Dry Gulch"],
      ["pier", "Pacific Pier"],
      ["whiteout", "Whiteout Pass"],
      ["nuketown", "Vice Heights"],
      ["14", "Vice Heights"],
    ];
// SMOKE_TIMES=night,sunset (default); CI runs night only to stay quick on software WebGL
const TIMES = (process.env.SMOKE_TIMES ?? "night,sunset").split(",");
const server = spawn(process.execPath, ["scripts/serve-static.mjs"], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: "ignore",
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
try {
  await sleep(1000);
  for (const [map, expectedTheme] of MAPS) {
    for (const time of TIMES) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(`console: ${m.text()}`);
      });
      const url = `http://localhost:${PORT}/game/?map=${map}&time=${time}&seed=7&debug=1`;
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
        await page
          .locator("button:visible", { hasText: /^start$/i })
          .first()
          .click({ timeout: 90_000 });
        await page
          .locator("button:visible", { hasText: /enter arena/i })
          .first()
          .click({ timeout: 30_000 });
        await page.waitForFunction(() => window.__rs && window.__rs.camera, null, {
          timeout: 120_000,
        });
        assert.equal(
          await page.evaluate(() => window.__rs.theme.name),
          expectedTheme,
          `?map=${map} selected the wrong arena`,
        );
        await sleep(5000); // let the first wave spawn and a few hundred frames run
      } catch (e) {
        errors.push(`could not enter the arena: ${e.message.split("\n")[0]}`);
      }
      const ok = errors.length === 0;
      if (!ok) failed++;
      console.log(`${ok ? "PASS" : "FAIL"} ${map} ${time}`);
      for (const e of errors.slice(0, 10)) console.log(`     ${e.slice(0, 300)}`);
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.kill();
}
if (failed) {
  console.log(`\n${failed} map run(s) failed`);
  process.exit(1);
}
console.log("\nall maps entered with 0 errors");
