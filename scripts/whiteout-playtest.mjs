import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const out = process.env.OUT || "output/playwright/whiteout-kit";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const report = { errors: [], controls: [], quality: [] };
page.on("pageerror", (e) => report.errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") report.errors.push(m.text());
});
try {
  await page.goto(
    `${process.env.BASE || "http://127.0.0.1:5294"}/game/?map=whiteout&seed=7&weather=sunset&tour=1&debug=1&quality=high`,
  );
  await page.getByRole("button", { name: /^start$/i }).click({ timeout: 90000 });
  await page.getByRole("button", { name: /enter arena/i }).click();
  await page.waitForFunction(() => window.__rs?.camera, null, { timeout: 120000 });
  await page.waitForTimeout(2000);
  report.renderer = await page.evaluate(() => {
    const gl = __rs.gl.getContext();
    return gl.getParameter(gl.getExtension("WEBGL_debug_renderer_info").UNMASKED_RENDERER_WEBGL);
  });
  for (const key of ["w", "a", "s", "d"]) {
    const before = await page.evaluate(() => ({
      p: __rs.camera.position.toArray(),
      shots: __rs.aimStats.current.shot,
    }));
    await page.keyboard.down(key);
    await page.keyboard.down("Enter");
    await page.waitForTimeout(2000);
    await page.keyboard.up(key);
    await page.keyboard.up("Enter");
    const after = await page.evaluate(() => ({
      p: __rs.camera.position.toArray(),
      shots: __rs.aimStats.current.shot,
    }));
    report.controls.push({
      key,
      before,
      after,
      travel: Math.hypot(after.p[0] - before.p[0], after.p[2] - before.p[2]),
    });
  }
  assert.ok(
    report.controls.every((x) => x.travel > 1),
    "all four keyboard directions move",
  );
  assert.ok(report.controls.at(-1).after.shots > report.controls[0].before.shots, "Enter fires");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /settings/i }).click();
  await page.evaluate(() => {
    window.whiteoutScene = __rs.scene;
    window.whiteoutGeos = new Map();
    __rs.scene.traverse((o) => {
      if (o.geometry?.userData.detailCounts) whiteoutGeos.set(o.uuid, o.geometry);
    });
  });
  for (const tier of ["LOW", "HIGH", "LOW", "HIGH"]) {
    await page.getByRole("button", { name: tier, exact: true }).click();
    await page.waitForTimeout(400);
    const row = await page.evaluate((tier) => {
      let n = 0,
        full = 0,
        drawn = 0,
        changed = 0,
        wrongRange = 0;
      __rs.scene.traverse((o) => {
        if (o.geometry?.userData.detailCounts) {
          n++;
          if (
            o.geometry.drawRange.count !==
            o.geometry.userData.detailCounts[tier === "LOW" ? "low" : "high"]
          )
            wrongRange++;
          full += o.geometry.userData.detailCounts.high;
          drawn += o.geometry.drawRange.count;
          if (whiteoutGeos.get(o.uuid) !== o.geometry) changed++;
        }
      });
      return {
        quality: window.__rsQuality,
        n,
        full,
        drawn,
        changed,
        wrongRange,
        sameScene: __rs.scene === whiteoutScene,
      };
    }, tier);
    assert.ok(row.n > 1, "spruce and chalet batches inspected");
    assert.equal(row.wrongRange, 0, "every detail geometry uses the selected tier");
    assert.equal(row.changed, 0);
    assert.equal(row.sameScene, true);
    assert.ok(tier === "LOW" ? row.drawn < row.full : row.drawn === row.full);
    report.quality.push({ tier, ...row });
  }
  await page.screenshot({ path: `${out}/quality-settings.png` });
  assert.deepEqual(report.errors, []);
} catch (e) {
  report.failure = e.stack;
  process.exitCode = 1;
} finally {
  await writeFile(`${out}/keyboard-quality.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify(report, null, 2));
