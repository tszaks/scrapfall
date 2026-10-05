import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import { assertHudLayout } from "./hud-layout-helpers.mjs";
const base = process.env.BASE ?? "http://127.0.0.1:4188",
  out = process.env.OUT ?? "docs/evidence/hud-layout/coop";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  args:
    process.platform === "darwin"
      ? ["--use-angle=metal"]
      : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true }),
  h = await ctx.newPage(),
  g = await ctx.newPage();
const report = {
  method:
    "Real host/guest room and network boss/status messages; longest boss name and three downed teammates are explicit DOM layout fixtures.",
  checks: [],
  errors: [],
};
for (const p of [h, g]) {
  p.on("pageerror", (e) => report.errors.push(e.message));
  p.on("console", (m) => {
    if (m.type() === "error") report.errors.push(m.text());
  });
}
try {
  await Promise.all(
    [h, g].map((p) => p.goto(`${base}/game/?map=vice&seed=11&debug=1&quality=low`)),
  );
  await h.getByRole("button", { name: "HOST A ROOM" }).click({ timeout: 120000 });
  await h.getByRole("button", { name: /TAP TO COPY/ }).waitFor({ timeout: 45000 });
  const code = (await h.getByRole("button", { name: /TAP TO COPY/ }).innerText())
    .trim()
    .slice(0, 4);
  await g.getByRole("textbox", { name: "Room code" }).fill(code);
  await g.getByRole("button", { name: /^JOIN$/ }).click();
  await g.getByRole("button", { name: /READY UP/ }).click({ timeout: 45000 });
  await h.getByRole("button", { name: /^Start$/ }).click();
  await h.getByRole("button", { name: /ENTER ARENA/i }).click({ timeout: 120000 });
  await Promise.all(
    [h, g].map((p) =>
      p.waitForFunction(
        () => window.__rs?.net?.current?.peers().length && __rs.remotes.current.size,
        null,
        { timeout: 120000 },
      ),
    ),
  );
  await Promise.all(
    [h, g].map((p) =>
      p.evaluate(() => {
        __rs.invuln.current = 1e6;
        for (const e of __rs.enemies) if (e.alive) e.frozen = 1e6;
      }),
    ),
  );
  await g.locator(".hud-squad-member").waitFor();
  assert.equal(await g.locator(".hud-squad-member").count(), 1);
  await g.waitForFunction(
    () => getComputedStyle(document.querySelector("[data-veil]")).visibility === "hidden",
  );
  // Let the existing spawn pickup toast expire before measuring persistent HUD regions.
  await g.waitForTimeout(3000);
  report.checks.push(await assertHudLayout(g, out, "real-guest-844"));
  await g.setViewportSize({ width: 568, height: 320 });
  await g.dispatchEvent("canvas", "pointerdown", { pointerType: "touch", pointerId: 7 });
  await g.waitForFunction(
    () => document.querySelector("[data-combat-hud]")?.dataset.touch === "true",
  );
  await g.waitForTimeout(150);
  await h.evaluate(() => {
    // Use a real host boss state so regular snapshots keep the guest HUD stable.
    // Enemy placement is a debug fixture; this test validates UI/network delivery.
    __rs.spawnWave(12);
    __rs.wave.current = 12;
    const boss = __rs.enemies.find((e) => e.kind === "boss");
    if (!boss) throw new Error("Boss fixture unavailable");
    __rs.pending.current.fill(null);
    for (const e of __rs.enemies) e.alive = e === boss;
    Object.assign(boss, {
      hp: 99,
      max: 100,
      frozen: 1e6,
      x: __rs.camera.position.x + 24,
      z: __rs.camera.position.z,
    });
    __rs.net.current.broadcast({ type: "status", w: 12, rem: 1, won: false, banner: true });
    __rs.net.current.broadcast({ type: "boss", hp: 99, max: 100 });
  });
  await g.locator(".hud-boss").waitFor();
  await g.locator(".hud-wave-banner").waitFor({ state: "attached" });
  await g.evaluate(() => {
    document.querySelector(".hud-boss-title").textContent = "THE AVALANCHE ENGINE";
    document.querySelector(".hud-room").textContent = "ABCD · 4P";
    const squad = document.querySelector(".hud-squad");
    squad.replaceChildren();
    for (const i of [1, 3, 4]) {
      const p = document.createElement("span");
      p.className = "hud-squad-member";
      p.textContent = `■ ${i === 1 ? "HOST" : `P${i}`} DOWN`;
      squad.append(p);
    }
  });
  assert.equal(
    await g.locator(".hud-wave-banner").isVisible(),
    false,
    "Boss status takes priority over duplicate wave announcement",
  );
  report.checks.push(await assertHudLayout(g, out, "coop-touch-568-boss-fixture"));
  // Preserve the existing toast's layout and pointer behavior while making its
  // expired spawn message visible for a deterministic touch-interception check.
  await g.evaluate(() => {
    const toast = [...document.querySelectorAll("div")].find(
      (el) => !el.children.length && el.textContent.includes("UNLIMITED USE"),
    );
    if (!toast) throw new Error("Spawn toast fixture unavailable");
    toast.dataset.hudToastFixture = "true";
    const style = document.createElement("style");
    style.id = "toast-fixture-style";
    style.textContent =
      "[data-hud-toast-fixture] { display: block !important; opacity: 1 !important; }";
    document.head.append(style);
  });
  const hitTargets = await g.locator("button:visible").evaluateAll((buttons) =>
    buttons.map((button) => {
      const r = button.getBoundingClientRect();
      return {
        label: button.textContent || button.getAttribute("aria-label"),
        reachable: button.contains(
          document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
        ),
      };
    }),
  );
  assert.ok(
    hitTargets.every((target) => target.reachable),
    "Toast must not intercept touch buttons",
  );
  const aim = await g.getByRole("button", { name: "AIM", exact: true }).boundingBox();
  const input = await ctx.newCDPSession(g);
  await input.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: aim.x + aim.width / 2, y: aim.y + aim.height / 2 }],
  });
  await g.waitForFunction(() => __rs.aimState.on);
  await g.screenshot({ path: `${out}/toast-touch-input.png` });
  await input.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  // Respect toggle aim as well as hold aim; a second touch releases toggle mode.
  if (await g.evaluate(() => __rs.aimState.on)) {
    await input.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: aim.x + aim.width / 2, y: aim.y + aim.height / 2 }],
    });
    await input.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
  await g.waitForFunction(() => !__rs.aimState.on);
  report.toastInput = {
    hitTargets,
    aimActivatedAndClearedViaTouch: true,
    fixture: "Existing toast forced visible with CSS",
  };
  await input.detach();
  await g.evaluate(() => document.getElementById("toast-fixture-style").remove());
  await g.evaluate(() => {
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
      value: () => [window.testPad],
    });
  });
  await g.waitForFunction(
    () => document.querySelector("[data-combat-hud]")?.dataset.touch === "false",
  );
  await g.evaluate(() => (window.testPad.axes[2] = 0));
  await g.waitForTimeout(150);
  report.checks.push(await assertHudLayout(g, out, "coop-controller-568-boss-fixture"));
  assert.deepEqual(report.errors, []);
} finally {
  fs.writeFileSync(`${out}/results.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(`${report.checks.length} co-op HUD scenarios passed; zero errors`);
