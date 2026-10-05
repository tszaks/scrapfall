import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import { assertHudLayout } from "./hud-layout-helpers.mjs";
const base = process.env.BASE ?? "http://127.0.0.1:4188";
const out = process.env.OUT ?? "/tmp/hud-context";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  args:
    process.platform === "darwin"
      ? ["--use-angle=metal"]
      : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 568, height: 320 }, hasTouch: true });
const report = {
  checks: [],
  errors: [],
  method:
    "Real weapon pickup; cloned existing toast/travel DOM nodes for deterministic presentation priority and longest-message fixtures.",
};
page.on("pageerror", (e) => report.errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") report.errors.push(m.text());
});
try {
  await page.goto(`${base}/game/?map=vice&seed=11&debug=1&quality=low&tour=1`);
  await page
    .getByRole("button", { name: /^start$/i })
    .first()
    .click({ timeout: 120000 });
  await page.getByRole("button", { name: /enter arena/i }).click({ timeout: 120000 });
  await page.waitForFunction(() => window.__rs?.pickup);
  await page.evaluate(() => {
    __rs.invuln.current = 1e6;
  });
  await page.dispatchEvent("canvas", "pointerdown", { pointerType: "touch", pointerId: 7 });
  await page.waitForTimeout(3200);
  await page.evaluate(() => {
    const r = __rs;
    r.ammo.current.sniper = 0;
    Object.assign(r.pickup.current, {
      active: true,
      gun: "sniper",
      x: r.camera.position.x,
      z: r.camera.position.z,
    });
  });
  await page.locator('[data-hud-notice="pickup"]').waitFor();
  assert.match(
    await page.locator('[data-hud-notice="pickup"]').innerText(),
    /TAP WEAPON TO SELECT/,
  );
  report.checks.push(await assertHudLayout(page, out, "touch-568-real-pickup"));
  await page.evaluate(() => {
    for (const attr of ["data-hud-toast", "data-hud-travel"]) {
      const src = document.querySelector(`[${attr}]`);
      const fixture = src.cloneNode(true);
      fixture.dataset.fixture = attr;
      fixture.dataset.active = "true";
      fixture.style.display = "block";
      fixture.style.opacity = "1";
      fixture.textContent =
        attr === "data-hud-toast"
          ? "EXIT BLOCKED · MOVE TO OPEN GROUND"
          : "RT ACCELERATE · LT BRAKE · LEFT STICK STEER · □ EXIT";
      src.parentElement.append(fixture);
    }
  });
  const toast = page.locator('[data-fixture="data-hud-toast"]');
  const travel = page.locator('[data-fixture="data-hud-travel"]');
  assert.equal(await toast.isVisible(), true);
  assert.equal(await travel.isVisible(), false);
  assert.equal(await page.locator('[data-hud-notice="pickup"]').isVisible(), false);
  report.checks.push(await assertHudLayout(page, out, "touch-568-feedback-priority"));
  await travel.evaluate((el) => {
    el.dataset.mode = "hold";
    el.textContent = "HOLD □ TO ENTER · 75%";
  });
  assert.equal(await toast.isVisible(), false);
  assert.equal(await travel.isVisible(), true);
  report.checks.push(await assertHudLayout(page, out, "touch-568-hold-priority"));
  await travel.evaluate((el) => {
    el.dataset.mode = "help";
    el.dataset.active = "false";
    el.style.display = "none";
  });
  for (const [width, height] of [
    [568, 320],
    [667, 375],
    [844, 390],
    [1280, 720],
  ]) {
    await page.setViewportSize({ width, height });
    await toast.evaluate((el) => {
      el.textContent = "RETURNED TO SAFE SPAWN · HEALTH AND GEAR KEPT";
    });
    await page.waitForTimeout(100);
    report.checks.push(await assertHudLayout(page, out, `touch-${width}-recovery`));
  }
  await page.setViewportSize({ width: 568, height: 320 });
  const emulation = await page.context().newCDPSession(page);
  await emulation.send("Emulation.setSafeAreaInsetsOverride", {
    insets: { top: 0, left: 47, right: 47, bottom: 21 },
  });
  await page.waitForTimeout(100);
  report.checks.push(await assertHudLayout(page, out, "touch-568-emulated-safe-insets"));
  await emulation.send("Emulation.setSafeAreaInsetsOverride", {
    insets: { top: 0, left: 0, right: 0, bottom: 0 },
  });
  await emulation.detach();
  await page.keyboard.press("Shift");
  await page.waitForFunction(
    () => document.querySelector("[data-combat-hud]").dataset.touch === "false",
  );
  report.checks.push(await assertHudLayout(page, out, "keyboard-568-recovery"));
  // Exercise real controller hold progress while actionable feedback occupies the lane.
  await page.evaluate(() => {
    window.testPad = {
      id: "DualSense Wireless Controller",
      index: 0,
      connected: true,
      mapping: "standard",
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    };
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => [window.testPad],
    });
    const r = __rs,
      t = r.playtest,
      c = [...t.driveCars.values()][0];
    t.releaseVehicle(t.driving.self);
    Object.assign(c, { claimed: true, x: -19.44, z: -6, yaw: -Math.PI / 2, speed: 0 });
    __rsCars[0].driven = true;
    t.warp(c.x, r.groundAt(c.x, c.z), c.z - c.width - 1);
  });
  await page.waitForTimeout(350);
  await page.evaluate(() =>
    Object.assign(window.testPad.buttons[2], { pressed: true, touched: true, value: 1 }),
  );
  await page.waitForFunction(
    () => document.querySelector("[data-hud-travel]:not([data-fixture])")?.dataset.mode === "hold",
  );
  await page.waitForTimeout(100);
  const realHold = await page
    .locator("[data-hud-travel]:not([data-fixture])")
    .evaluate((el) => ({
      text: el.textContent,
      gradient: el.style.backgroundImage,
      visible: getComputedStyle(el).visibility,
      mode: el.dataset.mode,
    }));
  assert.match(realHold.text, /HOLD □ TO ENTER · \d+%/);
  assert.match(realHold.gradient, /linear-gradient/);
  assert.equal(realHold.visible, "visible");
  assert.equal(await toast.isVisible(), false);
  await page.screenshot({ path: `${out}/controller-568-real-hold.png` });
  await page.evaluate(() =>
    Object.assign(window.testPad.buttons[2], { pressed: false, touched: false, value: 0 }),
  );
  await page.waitForFunction(
    () => document.querySelector("[data-hud-travel]:not([data-fixture])")?.dataset.mode === "help",
  );
  assert.equal(await toast.isVisible(), true);
  report.checks.push({ name: "real-controller-hold-over-feedback-and-release", ...realHold });
  assert.deepEqual(report.errors, []);
} finally {
  fs.writeFileSync(`${out}/results.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(`${report.checks.length} HUD context scenarios passed; zero errors`);
