// Controlled cold navigation: 50 Mbps throughput, 40 ms added latency, empty cache.
import fs from "node:fs";
import { performance } from "node:perf_hooks";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}),
});
const report = { network: { mbps: 50, latencyMs: 40, cache: "disabled" }, cases: [] };
const out = process.env.OUT || "artifacts/performance";
fs.mkdirSync(out, { recursive: true });
try {
  for (let repeat = 0; repeat < 3; repeat++) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    const row = { repeat, errors: [] };
    report.cases.push(row);
    page.on("pageerror", (e) => row.errors.push(e.message));
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 40,
      downloadThroughput: 50e6 / 8,
      uploadThroughput: 50e6 / 8,
    });
    const start = performance.now();
    await page.goto(
      `${process.env.BASE || "http://127.0.0.1:4173"}/game/?debug=1&map=vice&seed=11&quality=auto`,
    );
    await page.getByRole("button", { name: /^START$/i }).click();
    await page.getByRole("button", { name: /^ENTER ARENA$/i }).click();
    await page.keyboard.down("Enter");
    await page.waitForFunction(() => window.__rs?.aimStats.current.shot > 0);
    row.navigationToFirstShotMs = performance.now() - start;
    await page.keyboard.up("Enter");
    row.resources = await page.evaluate(() => ({
      preparation: __rsWarm.at(-1),
      transferBytes: performance
        .getEntriesByType("resource")
        .reduce((n, r) => n + r.transferSize, 0),
    }));
    console.log(JSON.stringify(row));
    await context.close();
  }
} catch (e) {
  report.failure = e.stack;
  process.exitCode = 1;
} finally {
  fs.writeFileSync(`${out}/loading.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
if (report.cases.some((r) => r.errors.length)) process.exitCode = 1;
