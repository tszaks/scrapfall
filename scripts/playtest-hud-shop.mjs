import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
const base = process.env.BASE ?? "http://127.0.0.1:4188";
const out = process.env.OUT ?? "/tmp/hud-shop";
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
    "Real intermission shop and purchase handlers; debug enemy kills fund the shopping fixture.",
};
page.on("pageerror", (e) => report.errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") report.errors.push(m.text());
});
async function clearWave() {
  await page.waitForFunction(() => window.__rs?.enemies.some((e) => e.alive));
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const r = __rs;
    r.invuln.current = 1e6;
    r.pending.current.fill(null);
    r.nextWaveTimer.current = 180;
    const i = r.enemies.findIndex((e) => e.alive);
    if (i < 0) throw new Error("No live enemy for shop fixture");
    const e = r.enemies[i];
    // Three explicit debug kills fund one purchase through the normal reward path.
    for (let n = 0; n < 3; n++) {
      e.alive = true;
      e.hp = 1;
      e.elite = 1;
      r.hurtEnemy(e, 1e6, i);
    }
    for (const enemy of r.enemies) enemy.alive = false;
  });
  await page.locator(".hud-shop").waitFor();
}
try {
  await page.goto(`${base}/game/?map=vice&seed=11&debug=1&quality=low`);
  await page
    .getByRole("button", { name: /^start$/i })
    .first()
    .click({ timeout: 120000 });
  await page.getByRole("button", { name: /enter arena/i }).click({ timeout: 120000 });
  await page.waitForFunction(() => window.__rs?.enemies.some((e) => e.alive));
  await page.dispatchEvent("canvas", "pointerdown", { pointerType: "touch", pointerId: 7 });
  await page.waitForTimeout(3200);
  await page.evaluate(() => {
    __rs.playtest.supply.loaded.pistol = 0;
  });
  await page.keyboard.press("KeyR");
  await page.waitForFunction(() =>
    document.querySelector(".ammo-hud-hint")?.textContent.includes("RELOADING"),
  );
  await page.dispatchEvent("canvas", "pointerdown", { pointerType: "touch", pointerId: 7 });
  await clearWave();
  assert.equal(
    await page.locator("[data-ammo-hud]").evaluate((el) => el.getClientRects().length),
    0,
  );
  assert.equal(
    await page.locator(".ammo-hud-track").evaluate((el) => el.getClientRects().length),
    0,
  );
  report.checks.push({ name: "opening-shop-mid-reload-hides-entire-ammo-box" });
  const shop = page.locator(".hud-shop");
  for (const [width, height] of [
    [568, 320],
    [667, 375],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    const box = await shop.boundingBox();
    assert.ok(box.width >= 180 && box.height >= 150, "Shop must have usable dimensions");
    const outside = await page.locator("button:visible").evaluateAll((buttons) =>
      buttons
        .filter((b) => !b.closest(".hud-shop"))
        .map((b) => {
          const r = b.getBoundingClientRect();
          return { text: b.textContent, x: r.x, y: r.y, w: r.width, h: r.height };
        }),
    );
    for (const b of outside)
      assert.ok(
        box.x + box.width <= b.x ||
          b.x + b.w <= box.x ||
          box.y + box.height <= b.y ||
          b.y + b.h <= box.y,
        `Shop overlaps ${b.text}`,
      );
    await shop.evaluate((el) => (el.scrollTop = 0));
    await page.screenshot({ path: `${out}/touch-${width}-shop.png` });
    report.checks.push({ name: `touch-${width}`, box });
  }
  await page.setViewportSize({ width: 568, height: 320 });
  const buttons = shop.locator("button");
  const reachable = [];
  for (let i = 0; i < (await buttons.count()); i++) {
    const button = buttons.nth(i);
    await button.scrollIntoViewIfNeeded();
    const entry = await button.evaluate((b) => {
      const r = b.getBoundingClientRect();
      return {
        text: b.textContent,
        reachable: b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
      };
    });
    assert.ok(entry.reachable, `${entry.text} must be reachable after scrolling`);
    reachable.push(entry);
  }
  await page.screenshot({ path: `${out}/touch-568-offers.png` });
  const offers = shop.locator(":scope > div:last-child > button");
  const count = await offers.count();
  // Actual touch drags must chain vertically from each horizontal row into the shop.
  const cdp = await page.context().newCDPSession(page);
  async function swipe(row, dx, dy) {
    await row.evaluate((el) => el.scrollIntoView({ block: "center", inline: "nearest" }));
    await page.waitForTimeout(100);
    const point = await row.evaluate((el) => {
      const r = el.getBoundingClientRect(),
        s = el.closest(".hud-shop").getBoundingClientRect();
      return {
        x: Math.min(r.right, s.right) - 24,
        y: (Math.max(r.top, s.top) + Math.min(r.bottom, s.bottom)) / 2,
      };
    });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    for (let i = 1; i <= 8; i++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: point.x + (dx * i) / 8, y: point.y + (dy * i) / 8 }],
      });
      await page.waitForTimeout(25);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(150);
  }
  for (const selector of ["[data-shop-actions]", "[data-shop-offers]"]) {
    const row = shop.locator(selector);
    await shop.evaluate((el) => (el.scrollTop = 0));
    await row.evaluate((el) => {
      el.scrollLeft = 0;
      el.scrollIntoView({ block: "center" });
    });
    const before = await shop.evaluate((el) => el.scrollTop);
    const max = await shop.evaluate((el) => el.scrollHeight - el.clientHeight);
    const dy = before > max / 2 ? 65 : -65;
    await swipe(row, 0, dy);
    const after = await shop.evaluate((el) => el.scrollTop);
    assert.ok(
      Math.abs(after - before) > 10,
      `${selector}: real vertical swipe must scroll outer shop`,
    );
    await row.evaluate((el) => (el.scrollLeft = 0));
    await swipe(row, -100, 0);
    assert.ok(
      (await row.evaluate((el) => el.scrollLeft)) > 20,
      `${selector}: real horizontal swipe must reveal more choices`,
    );
    report.checks.push({ name: `touch-scroll-${selector}`, before, after });
  }
  await cdp.send("Emulation.setSafeAreaInsetsOverride", {
    insets: { top: 0, left: 47, right: 47, bottom: 21 },
  });
  await page.waitForTimeout(100);
  const safeBox = await shop.boundingBox();
  assert.ok(
    safeBox.x >= 47 &&
      safeBox.x + safeBox.width <= 568 - 47 &&
      safeBox.y + safeBox.height <= 320 - 21,
  );
  for (const b of await page.locator("button:visible").evaluateAll((bs) =>
    bs
      .filter((b) => !b.closest(".hud-shop"))
      .map((b) => {
        const r = b.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height, text: b.textContent };
      }),
  ))
    assert.ok(
      safeBox.x + safeBox.width <= b.x ||
        b.x + b.w <= safeBox.x ||
        safeBox.y + safeBox.height <= b.y ||
        b.y + b.h <= safeBox.y,
      `Safe-area shop overlaps ${b.text}`,
    );
  await page.screenshot({ path: `${out}/touch-568-shop-safe-insets.png` });
  report.checks.push({ name: "emulated-safe-area-shop", box: safeBox });
  await cdp.send("Emulation.setSafeAreaInsetsOverride", {
    insets: { top: 0, left: 0, right: 0, bottom: 0 },
  });
  await cdp.detach();
  const before = Number(await page.getByLabel("Scrap balance").innerText());
  await offers.first().scrollIntoViewIfNeeded();
  await offers.first().tap();
  await page.waitForFunction(
    (n) => Number(document.querySelector('[aria-label="Scrap balance"]').textContent) < n,
    before,
  );
  assert.equal(await offers.count(), count - 1);
  report.checks.push({
    name: "all-actions-reachable-and-touch-purchase",
    reachable,
    before,
    after: Number(await page.getByLabel("Scrap balance").innerText()),
  });
  const initial = await shop.innerText();
  await page.waitForTimeout(1200);
  assert.notEqual(await shop.innerText(), initial, "Shop countdown keeps advancing");
  await page.evaluate(() => {
    __rs.nextWaveTimer.current = 0;
  });
  await shop.waitFor({ state: "detached" });
  await page.locator("[data-ammo-hud]").waitFor({ state: "visible" });
  report.checks.push({ name: "next-wave-restores-combat-hud" });
  // Open another real intermission and navigate the scrollable shop through the pad API.
  await clearWave();
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
      value: () => (window.testPad ? [window.testPad] : []),
    });
  });
  async function pressPad(index) {
    await page.evaluate(
      (i) => Object.assign(window.testPad.buttons[i], { pressed: true, touched: true, value: 1 }),
      index,
    );
    await page.waitForTimeout(100);
    await page.evaluate(
      (i) => Object.assign(window.testPad.buttons[i], { pressed: false, touched: false, value: 0 }),
      index,
    );
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(200);
  await pressPad(5);
  await page.waitForFunction(() => document.activeElement?.closest(".hud-shop"));
  const enabled = await shop.locator("button:enabled").count();
  const focused = [];
  for (let i = 0; i < enabled; i++) {
    const item = await page.evaluate(() => {
      const el = document.activeElement,
        r = el.getBoundingClientRect(),
        s = el.closest(".hud-shop").getBoundingClientRect();
      return {
        text: el.textContent,
        visible: r.top >= s.top - 0.5 && r.bottom <= s.bottom + 0.5,
        reachable: el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
      };
    });
    assert.ok(
      item.visible && item.reachable,
      "Controller-selected button must scroll fully into view: " + item.text,
    );
    focused.push(item);
    await pressPad(5);
  }
  assert.equal(new Set(focused.map((f) => f.text)).size, enabled);
  // The cycle returns to the ammunition button; the normal controller use action buys it.
  assert.match(await page.evaluate(() => document.activeElement.textContent), /AMMO/);
  const safePad = await page.context().newCDPSession(page);
  await safePad.send("Emulation.setSafeAreaInsetsOverride", {
    insets: { top: 0, left: 47, right: 47, bottom: 21 },
  });
  await offers.first().evaluate((button) => {
    const card = button.cloneNode(true);
    card.dataset.fixture = "long-controller-offer";
    const parts = card.querySelectorAll(":scope > div");
    parts[0].textContent = "PISTOL MOD · USES A SLOT";
    parts[1].textContent = "EXECUTIONER HAMMER";
    parts[2].textContent = "Pistol: double damage vs enemies under half max health";
    button.parentElement.append(card);
  });
  for (let i = 0; i <= enabled; i++) {
    await pressPad(5);
    if (
      await page.evaluate(() => document.activeElement?.dataset.fixture === "long-controller-offer")
    )
      break;
  }
  assert.equal(
    await page.evaluate(() => document.activeElement?.dataset.fixture),
    "long-controller-offer",
  );
  const longCard = await page.locator('[data-fixture="long-controller-offer"]').evaluate((el) => {
    const r = el.getBoundingClientRect(),
      s = el.closest(".hud-shop").getBoundingClientRect();
    return {
      text: el.textContent,
      visible:
        r.top >= s.top - 0.5 &&
        r.bottom <= s.bottom + 0.5 &&
        r.left >= s.left - 0.5 &&
        r.right <= s.right + 0.5,
      height: r.height,
      available: s.height,
    };
  });
  assert.ok(
    longCard.visible,
    "Longest offer must fit and scroll into view with emulated safe insets",
  );
  await page.screenshot({ path: `${out}/controller-568-long-offer-safe-insets.png` });
  report.checks.push({ name: "controller-long-offer-safe-insets-fixture", ...longCard });
  await page.locator('[data-fixture="long-controller-offer"]').evaluate((el) => el.remove());
  await safePad.send("Emulation.setSafeAreaInsetsOverride", {
    insets: { top: 0, left: 0, right: 0, bottom: 0 },
  });
  await safePad.detach();
  await pressPad(5);
  assert.match(await page.evaluate(() => document.activeElement.textContent), /AMMO/);
  const padBefore = Number(await page.getByLabel("Scrap balance").innerText());
  await pressPad(2);
  await page.waitForFunction(
    (n) => Number(document.querySelector('[aria-label="Scrap balance"]').textContent) < n,
    padBefore,
  );
  report.checks.push({
    name: "controller-focus-scroll-and-purchase",
    focused,
    before: padBefore,
    after: Number(await page.getByLabel("Scrap balance").innerText()),
  });
  await page.screenshot({ path: `${out}/controller-568-shop.png` });
  // Suppression must also remove all shop buttons from existing controller traversal.
  await page.evaluate(() => {
    const el = document.querySelector("[data-hud-toast]").cloneNode(true);
    el.dataset.fixture = "shop-feedback";
    el.dataset.active = "true";
    el.style.opacity = "1";
    el.style.display = "block";
    el.textContent = "EXIT BLOCKED · MOVE TO OPEN GROUND";
    document.body.append(el);
  });
  await shop.waitFor({ state: "hidden" });
  assert.equal(
    await shop
      .locator("button")
      .evaluateAll((bs) => bs.filter((b) => b.offsetParent !== null).length),
    0,
  );
  const hiddenBefore = Number(await page.getByLabel("Scrap balance").innerText());
  await pressPad(5);
  await pressPad(2);
  assert.equal(
    Number(await page.getByLabel("Scrap balance").innerText()),
    hiddenBefore,
    "Hidden shop must not purchase through retained controller focus",
  );
  await page.locator('[data-fixture="shop-feedback"]').evaluate((el) => el.remove());
  await shop.waitFor({ state: "visible" });
  await pressPad(5);
  await page.waitForFunction(() => document.activeElement?.closest(".hud-shop"));
  report.checks.push({ name: "actionable-feedback-hides-shop-without-hidden-purchases" });
  // Pause/resume preserves the actual offers and reopens an operable shop.
  const offerDescriptions = () =>
    offers.evaluateAll((bs) =>
      bs.map((b) =>
        [...b.children]
          .filter((el) => el.tagName === "DIV")
          .map((el) => el.textContent)
          .join("|"),
      ),
    );
  const savedOffers = await offerDescriptions();
  for (let i = 0; i < 2; i++) {
    await pressPad(9);
    await shop.waitFor({ state: "detached" });
    await page
      .getByRole("button", { name: /resume/i })
      .first()
      .click();
    await shop.waitFor({ state: "visible" });
    assert.deepEqual(await offerDescriptions(), savedOffers);
    await pressPad(5);
    await page.waitForFunction(() => document.activeElement?.closest(".hud-shop"));
  }
  report.checks.push({ name: "repeated-pause-resume-preserves-shop" });
  await page.evaluate(() => {
    window.testPad = null;
    __rs.nextWaveTimer.current = 0;
  });
  await shop.waitFor({ state: "detached" });
  await page.locator("[data-ammo-hud]").waitFor({ state: "visible" });
  report.checks.push({ name: "second-shop-close-restores-combat-hud" });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.keyboard.press("Shift");
  await page.waitForTimeout(400);
  await clearWave();
  const desktop = await shop.boundingBox();
  assert.ok(desktop.width > 500);
  await page.screenshot({ path: `${out}/desktop-shop.png` });
  report.checks.push({ name: "desktop-shop", box: desktop });
  assert.deepEqual(report.errors, []);
} finally {
  fs.writeFileSync(`${out}/results.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(`${report.checks.length} HUD shop scenarios passed; zero errors`);
