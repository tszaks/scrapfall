import { assertHudLayout } from "./hud-layout-helpers.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
const base = process.env.BASE ?? "http://127.0.0.1:4188",
  out = process.env.OUT ?? "docs/evidence/hud-layout";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  args:
    process.platform === "darwin"
      ? ["--use-angle=metal"]
      : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, hasTouch: true });
const report = { checks: [], errors: [] };
page.on("pageerror", (e) => report.errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") report.errors.push(m.text());
});
const layout = async (name) => report.checks.push(await assertHudLayout(page, out, name));
try {
  await page.goto(`${base}/game/?map=vice&seed=11&debug=1&quality=low&tour=1`);
  await page
    .getByRole("button", { name: /^start$/i })
    .first()
    .click({ timeout: 120000 });
  await page.getByRole("button", { name: /enter arena/i }).click({ timeout: 120000 });
  await page.waitForFunction(() => window.__rs?.giveAll);
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    __rs.invuln.current = 1e6;
    __rs.giveAll();
    __rs.equip("sniper");
  });
  await page.waitForTimeout(200);
  await layout("desktop-full-inventory");
  for (const [width, height] of [
    [844, 390],
    [568, 320],
  ]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(150);
    await layout(`keyboard-${width}`);
  }
  await page.evaluate(() => {
    window.testPad = {
      id: "DualSense Wireless Controller",
      index: 0,
      connected: true,
      mapping: "standard",
      axes: [0, 0, 0.7, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    };
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => (window.testPad ? [window.testPad] : []),
    });
  });
  await page.waitForFunction(
    () => document.querySelector(".ammo-hud-hint")?.textContent === "□ · RELOAD",
  );
  await page.evaluate(() => (window.testPad.axes[2] = 0));
  await layout("controller-568");
  await page.evaluate(() => (window.testPad = null));
  for (const [width, height] of [
    [844, 390],
    [568, 320],
  ]) {
    await page.setViewportSize({ width, height });
    await page.dispatchEvent("canvas", "pointerdown", { pointerType: "touch", pointerId: 7 });
    await page.waitForFunction(
      () => document.querySelector("[data-combat-hud]")?.dataset.touch === "true",
    );
    await page.waitForTimeout(150);
    await layout(`touch-${width}`);
  }
  // Explicit layout stress fixtures; these do not claim a four-player networking run.
  await page.evaluate(() => {
    document.querySelector(".hud-match-heading b").textContent = "WHITEOUT PASS";
    document.querySelector(".hud-kit").textContent = "SELF REVIVE · EMPTY";
    document.querySelector(".hud-health-line b").textContent = "999 / 999";
    document.querySelector(".hud-room").textContent = "ABCD · 4P";
    const squad = document.createElement("div");
    squad.className = "hud-squad";
    for (let i = 1; i <= 3; i++) {
      const p = document.createElement("span");
      p.className = "hud-squad-member";
      p.textContent = `■ ${i === 1 ? "HOST" : `P${i}`} DOWN`;
      squad.append(p);
    }
    document.querySelector("[data-hud-vitals]").append(squad);
  });
  await layout("touch-568-stress-fixture");
  assert.deepEqual(report.errors, []);
} finally {
  fs.writeFileSync(`${out}/results.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(`${report.checks.length} HUD layouts passed; zero errors`);
