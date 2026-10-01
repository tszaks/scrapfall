// Policy integration under synthetic CPU pressure; not a hardware FPS benchmark.
import fs from "node:fs";
import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const b = await chromium.launch({
  headless: true,
  // This is a synthetic policy check; remove display cadence as a confounding input.
  args: ["--disable-frame-rate-limit", "--disable-gpu-vsync"],
  ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}),
});
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 }),
  p = await ctx.newPage();
const out = process.env.OUT || "artifacts/performance";
fs.mkdirSync(out, { recursive: true });
const report = {
  method:
    "Synthetic CPU policy check with uncapped headless Chromium; not a hardware FPS benchmark",
  errors: [],
  samples: [],
};
p.on("pageerror", (e) => report.errors.push(e.message));
const sample = async (label) => {
  const s = await p.evaluate(() => JSON.parse(JSON.stringify(__rsQuality)));
  report.samples.push({ label, ...s });
  console.log(label, JSON.stringify(s));
  return s;
};
try {
  await p.goto(
    `${process.env.BASE || "http://127.0.0.1:4173"}/game/?debug=1&map=nuketown&seed=11&quality=auto`,
  );
  await p.getByRole("button", { name: /^START$/i }).click();
  await p.getByRole("button", { name: /^ENTER ARENA$/i }).click();
  await p.waitForFunction(() => window.__rs?.camera);
  await p.evaluate(() => {
    __rs.invuln.current = 1e6;
    __rs.nextWaveTimer.current = 9999;
    __rs.enemies.forEach((e) => (e.alive = false));
  });
  await p.waitForTimeout(12000);
  const initial = await sample("initial");
  await p.evaluate(() => {
    window.__renderBeforePressure = __rs.gl.render;
    window.__pressure = 28;
    __rs.gl.render = function (...a) {
      if (this.getRenderTarget() === null) {
        const end = performance.now() + window.__pressure;
        while (performance.now() < end) {}
      }
      return window.__renderBeforePressure.apply(this, a);
    };
  });
  await p.waitForTimeout(14000);
  const pressured = await sample("CPU pressure");
  assert.ok(pressured.tier !== "high", "CPU pressure should reduce expensive detail");
  await p.evaluate(() => (window.__pressure = 0));
  for (let i = 0; i < 12; i++) {
    await p.waitForTimeout(10000);
    const recovered = await sample(`recovery ${10 * (i + 1)}s`);
    if (recovered.tier === "high" && recovered.dpr >= initial.dpr - 0.01) break;
  }
  const final = report.samples.at(-1);
  assert.equal(final.tier, "high", "detail recovers after pressure");
  assert.ok(final.dpr >= initial.dpr - 0.1, "resolution recovers");
  await p.evaluate(() => {
    __rs.gl.render = window.__renderBeforePressure;
  });
  // Paused/manual selection remains the user choice under the same synthetic pressure.
  await p.keyboard.press("p");
  await p.getByRole("button", { name: /^SETTINGS$/i }).click();
  await p.getByRole("button", { name: "HIGH", exact: true }).click();
  await p.evaluate(() => {
    window.__pressure = 28;
    window.__renderManual = __rs.gl.render;
    __rs.gl.render = function (...a) {
      if (this.getRenderTarget() === null) {
        const end = performance.now() + window.__pressure;
        while (performance.now() < end) {}
      }
      return window.__renderManual.apply(this, a);
    };
  });
  await p.waitForTimeout(6000);
  const manual = await sample("manual HIGH under pressure");
  assert.equal(manual.tier, "high");
  assert.equal(manual.dpr, 2);
  assert.deepEqual(report.errors, []);
} catch (e) {
  report.failure = e.stack;
  process.exitCode = 1;
} finally {
  fs.writeFileSync(`${out}/adaptation.json`, JSON.stringify(report, null, 2));
  await b.close();
}
