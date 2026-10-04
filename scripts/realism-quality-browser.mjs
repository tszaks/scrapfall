import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.env.BASE || "http://127.0.0.1:5197";
const out = process.env.QA_DIR || "/tmp/scrapfall-review-quality";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
const report = [];
try {
  for (const map of ["vice", "pier", "whiteout", "gulch"]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.goto(
      `${base}/game/?map=${map}&seed=7&time=sunset&tour=1&debug=1&quality=high`,
    );
    await page.getByRole("button", { name: /^start$/i }).click({ timeout: 90000 });
    await page.getByRole("button", { name: /enter arena/i }).click();
    await page.waitForFunction(() => window.__rs?.camera, null, { timeout: 120000 });
    await page.waitForTimeout(1500);
    await page.evaluate(async () => {
      window.testQuality = await import("/game/src/game/quality.ts");
      window.testQuality.holdQuality(120000);
      window.savedWorld = {
        city: window.__rs.city,
        enemies: window.__rs.enemies,
        scene: window.__rs.scene,
      };
      window.savedGeometry = new Map();
      window.__rs.scene.traverse((o) => {
        if (o.geometry?.userData.detailCounts)
          window.savedGeometry.set(o.uuid, {
            geometry: o.geometry,
            color: o.instanceColor,
            matrix: o.instanceMatrix,
          });
      });
    });
    const rows = [];
    for (const [pref, tier] of [
      ["high", "high"],
      ["low", "low"],
      ["high", "high"],
      ["auto", "low"],
      ["auto", "high"],
    ]) {
      await page.evaluate(
        ([pref, tier]) => {
          window.testQuality.setQualityPref(pref);
          if (pref === "auto") window.testQuality.setAutoTier(tier);
        },
        [pref, tier],
      );
      await page.waitForTimeout(800);
      const row = await page.evaluate(() => {
        const r = window.__rs;
        let full = 0,
          submitted = 0,
          objects = 0,
          changed = 0,
          relief = [];
        r.scene.traverse((o) => {
          if (o.geometry?.userData.detailCounts) {
            const old = window.savedGeometry.get(o.uuid);
            objects++;
            full += o.geometry.userData.detailCounts.high;
            submitted += o.geometry.drawRange.count;
            if (
              !old ||
              old.geometry !== o.geometry ||
              old.color !== o.instanceColor ||
              old.matrix !== o.instanceMatrix
            )
              changed++;
          }
          for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
            const uniforms = r.gl.properties.get(m)?.uniforms;
            for (const key of ["uScanRelief", "uSurfaceRelief"])
              if (uniforms?.[key]) relief.push(uniforms[key].value);
          }
        });
        return {
          tier: window.testQuality.quality().tier,
          full,
          submitted,
          objects,
          changed,
          relief: [...new Set(relief)],
          sameWorld:
            window.savedWorld.scene === r.scene &&
            window.savedWorld.city === r.city &&
            window.savedWorld.enemies === r.enemies,
          memory: { ...r.gl.info.memory },
        };
      });
      assert.equal(row.tier, tier);
      assert.equal(row.changed, 0);
      assert.equal(row.sameWorld, true);
      assert.ok(
        row.relief.length === 1 && row.relief[0] === (tier !== "low"),
        `${map} relief ${JSON.stringify(row)}`,
      );
      if (map !== "gulch") {
        assert.ok(row.objects > 0);
        assert.ok(tier === "low" ? row.submitted < row.full : row.submitted === row.full);
      }
      rows.push({ pref, ...row });
    }
    await page.screenshot({ path: `${out}/${map}-high.png` });
    assert.deepEqual(errors, []);
    report.push({ map, rows, errors });
    console.log(
      `PASS ${map}: manual and AUTO high-low-high preserve scene, instances, materials and change detail`,
    );
    await page.close();
  }
  await writeFile(`${out}/quality-transitions.json`, JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
