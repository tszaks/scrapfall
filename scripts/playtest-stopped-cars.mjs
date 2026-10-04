import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const base = process.env.BASE ?? "http://127.0.0.1:5295";
const out = process.env.OUT ?? "output/stopped-cars";
await mkdir(out, { recursive: true });
const replay = process.env.FIXTURE
  ? JSON.parse(await readFile(process.env.FIXTURE, "utf8")).fixture
  : null;
const browser = await chromium.launch({ args: ["--use-angle=metal"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const report = { base, head: process.env.HEAD, browser: browser.version(), errors: [], sides: [] };
page.on("pageerror", (e) => report.errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") report.errors.push(m.text());
});
try {
  await page.goto(`${base}/game/?map=vice&seed=11&debug=1`);
  await page.getByRole("button", { name: /^start$/i }).click({ timeout: 120000 });
  await page.getByRole("button", { name: /enter arena/i }).click({ timeout: 120000 });
  await page.waitForFunction(() => window.__rs?.playtest?.driveCars.size && window.__rsCars);
  await page.waitForTimeout(2500);
  report.initial = await page.evaluate(() => {
    const r = __rs,
      p = r.camera.position;
    return {
      position: p.toArray(),
      enemies: r.enemies
        .filter((e) => e.alive)
        .map((e) => ({ x: e.x, z: e.z, d: Math.hypot(e.x - p.x, e.z - p.z) })),
      pending: r.pending.current,
    };
  });
  // Deliberate zero-speed fixture: pause one unclaimed ambient car on an open road.
  // No change to the game's collision hooks or player movement; keyboard W supplies all test movement.
  report.fixture = await page.evaluate((replay) => {
    const r = __rs,
      t = r.playtest;
    const c = replay
      ? t.driveCars.get(replay.id)
      : [...t.driveCars.values()].find(
          (c) =>
            Math.abs(c.x) < 150 &&
            Math.abs(c.z) < 150 &&
            c.width < 1.1 &&
            c.half < 2.7 &&
            !r.blockedAt(c.x, c.z, 3),
        );
    if (!c) throw Error("No clear-road car fixture");
    const sim = __rsCars[Number(c.id.split("-")[1])];
    if (replay) {
      sim.x = replay.x;
      sim.z = replay.z;
      sim.yaw = replay.yaw;
    }
    sim.driven = true;
    c.claimed = false;
    sim.speed = 0;
    sim.px = sim.x;
    sim.pz = sim.z;
    sim.pyaw = sim.yaw;
    c.x = sim.x;
    c.z = sim.z;
    c.yaw = sim.yaw;
    c.owner = "";
    c.speed = 0;
    window.fixtureCar = c;
    return { id: c.id, x: c.x, z: c.z, yaw: c.yaw, half: c.half, width: c.width };
  }, replay);
  for (const side of [-1, 1]) {
    await page.evaluate((side) => {
      const r = __rs,
        t = r.playtest,
        c = fixtureCar;
      const x = c.x + Math.cos(c.yaw) * (c.width + 2) * side,
        z = c.z - Math.sin(c.yaw) * (c.width + 2) * side;
      t.warp(x, r.groundAt(x, z), z);
      r.look.current.yaw = Math.atan2(x - c.x, z - c.z);
      r.look.current.pitch = 0;
    }, side);
    await page.waitForTimeout(300);
    if (side === -1) await page.screenshot({ path: `${out}/approach.png` });
    await page.keyboard.down("w");
    await page.waitForTimeout(2500);
    await page.keyboard.up("w");
    const state = await page.evaluate((side) => {
      const p = __rs.camera.position,
        c = fixtureCar,
        dx = p.x - c.x,
        dz = p.z - c.z;
      return {
        side,
        position: p.toArray(),
        lateral: dx * Math.cos(c.yaw) - dz * Math.sin(c.yaw),
        along: dx * Math.sin(c.yaw) + dz * Math.cos(c.yaw),
        width: c.width,
      };
    }, side);
    report.sides.push(state);
    await page.screenshot({ path: `${out}/side-${side}.png` });
    assert.ok(
      state.lateral * side >= state.width + 0.25,
      `cannot cross stopped car from side ${side}`,
    );
  }
  await page.keyboard.press("e");
  await page.waitForTimeout(300);
  report.entered = await page.evaluate(() => __rs.playtest.myVehicle()?.id ?? null);
  assert.equal(report.entered, report.fixture.id, "keyboard entry still works against solid car");
  await page.keyboard.press("e");
  await page.waitForTimeout(300);
  report.exited = await page.evaluate(() => ({
    vehicle: __rs.playtest.myVehicle()?.id ?? null,
    position: __rs.camera.position.toArray(),
  }));
  assert.equal(report.exited.vehicle, null, "can exit");
  await page.keyboard.down("s");
  await page.waitForTimeout(700);
  await page.keyboard.up("s");
  report.walkAfterExit = await page.evaluate(() => __rs.camera.position.toArray());
  assert.ok(
    Math.hypot(
      report.walkAfterExit[0] - report.exited.position[0],
      report.walkAfterExit[2] - report.exited.position[2],
    ) > 0.5,
    "not trapped after exit",
  );
  assert.equal(report.errors.length, 0);
} catch (e) {
  report.failure = e.stack;
  process.exitCode = 1;
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify(report));
