// Functional coverage for preparation, map disposal, controls and renderer recovery.
import assert from "node:assert/strict";
import fs from "node:fs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}),
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const report = { maps: [], errors };
const out = process.env.OUT || "artifacts/performance";
fs.mkdirSync(out, { recursive: true });
const ready = () =>
  page.waitForFunction(
    () =>
      window.__rsWarm?.length > 0 &&
      !/PREPARING ARENA|ARENA COULD NOT LOAD/.test(document.body.innerText),
    null,
    { timeout: 45000 },
  );
try {
  await page.goto(
    `${process.env.BASE || "http://127.0.0.1:4173"}/game/?debug=1&map=vice&seed=11&quality=auto`,
  );
  await page.getByRole("button", { name: /^START$/ }).click();
  for (let cycle = 0; cycle < 2; cycle++)
    for (const map of ["VICE HEIGHTS", "PACIFIC PIER", "WHITEOUT PASS", "DRY GULCH", "NUKETOWN"]) {
      const switchStarted = Date.now();
      await page.getByRole("button", { name: map, exact: true }).click();
      await ready();
      assert.equal(
        await page.getByRole("button", { name: "ENTER ARENA", exact: true }).isEnabled(),
        true,
      );
      const r = await page.evaluate(() => ({
        warm: __rsWarm.at(-1),
        memory: { ...__rs.gl.info.memory },
        programs: __rs.gl.info.programs.length,
      }));
      report.maps.push({ cycle, map, switchToReadyMs: Date.now() - switchStarted, ...r });
    }
  await page.evaluate(() => {
    window.__compileBeforeFailure = __rs.gl.compileAsync;
    __rs.gl.compileAsync = () => Promise.reject(new Error("deliberate preparation failure"));
  });
  await page.getByRole("button", { name: "VICE HEIGHTS", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "ARENA COULD NOT LOAD" }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "ENTER ARENA", exact: true }).isDisabled(),
    true,
  );
  assert.ok(
    await page.evaluate(
      () =>
        __rs.gl.getRenderTarget() === null &&
        !__rs.scene.userData.scrapfallPrewarm &&
        !__rs.scene.getObjectByName("enemy-shader-gallery")?.visible,
    ),
    "failed preparation restores scene state",
  );
  await page.evaluate(() => {
    __rs.gl.compileAsync = window.__compileBeforeFailure;
  });
  await page.getByRole("button", { name: "NUKETOWN", exact: true }).click();
  await ready();
  report.preparationFailure = "blocked controls, restored state, next map recovered";
  await page.getByRole("button", { name: "ENTER ARENA", exact: true }).click();
  await page.waitForFunction(() => __rs.wave.current > 0);
  await page.evaluate(() => {
    __rs.invuln.current = 1e6;
  });
  const initial = await page.evaluate(() => __rs.aimStats.current.shot);
  await page.keyboard.down("Enter");
  await page.waitForTimeout(1500);
  await page.keyboard.up("Enter");
  assert.ok((await page.evaluate(() => __rs.aimStats.current.shot)) > initial, "keyboard fire");
  await page.keyboard.press("p");
  await page.getByRole("button", { name: "RESUME", exact: true }).waitFor();
  const paused = await page.evaluate(() => __rs.camera.position.toArray());
  await page.keyboard.down("w");
  await page.waitForTimeout(500);
  await page.keyboard.up("w");
  assert.deepEqual(
    await page.evaluate(() => __rs.camera.position.toArray()),
    paused,
    "pause blocks movement",
  );
  await page.getByRole("button", { name: "RESUME", exact: true }).click();
  const moved = await page.evaluate(async () => {
    const p = __rs.camera.position.clone();
    __rs.keys.current.add("KeyW");
    await new Promise((r) => setTimeout(r, 500));
    __rs.keys.current.clear();
    return p.distanceTo(__rs.camera.position);
  });
  assert.ok(moved > 0.1, "resume restores movement");
  const supported = await page.evaluate(() => {
    const ext = __rs.gl.getContext().getExtension("WEBGL_lose_context");
    if (!ext) return false;
    window.__restoreContext = () => ext.restoreContext();
    ext.loseContext();
    return true;
  });
  if (supported) {
    await page.getByRole("status").filter({ hasText: "ARENA COULD NOT LOAD" }).waitFor();
    await page.waitForTimeout(1000);
    await page.evaluate(() => window.__restoreContext());
    await ready();
    report.contextRestore = "passed";
  } else report.contextRestore = "unsupported";
  report.controls = "passed";
  assert.deepEqual(errors, []);
  await page.screenshot({ path: `${out}/candidate-flow.png` });
} catch (e) {
  report.failure = e.stack;
  process.exitCode = 1;
} finally {
  fs.writeFileSync(`${out}/flows.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await browser.close();
}
