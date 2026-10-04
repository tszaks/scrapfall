import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.env.BASE ?? "http://127.0.0.1:5307";
const out = process.env.OUT ?? "output/vehicle-camera";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ["--use-angle=metal"] });
const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
const report = {
  kind: "Functional headless scripted fixture, not a performance benchmark or physical controller test",
  base,
  checks: [],
  errors: [],
};
page.on("pageerror", (e) => report.errors.push(e.message));
function assertFramed(s) {
  const b = s.view.hullBounds;
  assert.ok(
    b && b.minX > -0.98 && b.maxX < 0.98 && b.minY > -0.98 && b.maxY < 0.98,
    `rendered vehicle hull must fit: ${JSON.stringify(b)}`,
  );
}
async function snap(name) {
  const value = await page.evaluate(() => {
    const r = __rs,
      c = r.playtest.myVehicle(),
      v = window.__lastView;
    return {
      vehicle: c?.id,
      position: r.camera.position.toArray(),
      fov: r.camera.fov,
      view: v,
      shoulder: r.shoulderView.active,
      car: c && { x: c.x, z: c.z, half: c.half, width: c.width, height: c.height },
      rigs: (() => {
        let a = [];
        r.scene.traverse((o) => {
          if (o.name === "scavenger-player") a.push(o.visible);
        });
        return a;
      })(),
    };
  });
  report.checks.push({ name, ...value });
  return value;
}
try {
  await page.goto(`${base}/game/?map=vice&seed=11&debug=1&tour=1&quality=high`);
  await page.getByRole("button", { name: /^start$/i }).click({ timeout: 120000 });
  await page.getByRole("button", { name: /enter arena/i }).click({ timeout: 120000 });
  await page.waitForFunction(() => window.__rs?.playtest?.driveCars.size);
  await page.evaluate(() => {
    const r = __rs,
      original = r.gl.render;
    r.gl.render = function (scene, camera) {
      if (scene === r.scene) {
        const c = r.playtest.myVehicle();
        let hullBounds = null;
        if (c) {
          camera.updateMatrixWorld();
          const xs = [],
            ys = [];
          for (const along of [-c.half, c.half])
            for (const lateral of [-c.width, c.width])
              for (const height of [0, c.height]) {
                const p = r.camera.position
                  .clone()
                  .set(
                    c.x + Math.sin(c.yaw) * along + Math.cos(c.yaw) * lateral,
                    r.groundAt(c.x, c.z) + height,
                    c.z + Math.cos(c.yaw) * along - Math.sin(c.yaw) * lateral,
                  )
                  .project(camera);
                xs.push(p.x);
                ys.push(p.y);
              }
          hullBounds = {
            minX: Math.min(...xs),
            maxX: Math.max(...xs),
            minY: Math.min(...ys),
            maxY: Math.max(...ys),
          };
        }
        window.__lastView = {
          position: camera.position.toArray(),
          fov: camera.fov,
          logical: camera === r.camera,
          hullBounds,
        };
      }
      return original.call(this, scene, camera);
    };
    const c = [...r.playtest.driveCars.values()][0];
    Object.assign(c, { claimed: true, x: -19.44, z: -6, yaw: -Math.PI / 2, speed: 0 });
    __rsCars[0].driven = true;
    r.playtest.warp(c.x, r.groundAt(c.x, c.z), c.z - c.width - 1);
  });
  await page.waitForTimeout(300);
  const before = await snap("on-foot-before");
  await page.keyboard.press("e");
  await page.waitForTimeout(800);
  let s = await snap("entered-chase");
  assert.equal(s.vehicle, "city-0");
  assert.equal(s.view.logical, false);
  assert.ok(s.view.fov > s.fov);
  assert.equal(s.rigs[0], false);
  assert.ok(
    Math.hypot(s.view.position[0] - s.car.x, s.view.position[2] - s.car.z) > s.car.half + 2,
  );
  assertFramed(s);
  await page.screenshot({ path: `${out}/chase-sedan.png` });
  await page.keyboard.down("w");
  await page.waitForTimeout(600);
  await page.keyboard.up("w");
  s = await snap("forward");
  assert.ok(s.shoulder);
  await page.keyboard.press("e");
  await page.waitForTimeout(300);
  s = await snap("exit-restores");
  assert.equal(s.vehicle, undefined);
  assert.equal(s.view.logical, before.view.logical);
  assert.equal(s.view.fov, before.view.fov);
  await page.screenshot({ path: `${out}/on-foot-restored.png` });
  await page.keyboard.press("v");
  await page.keyboard.press("e");
  await page.waitForTimeout(300);
  s = await snap("saved-third-person-entry");
  assert.equal(s.vehicle, "city-0");
  assert.equal(s.rigs[0], false);
  await page.evaluate(() => __rs.playtest.releaseVehicle(__rs.playtest.driving.self));
  await page.waitForTimeout(300);
  s = await snap("ownership-loss-restores-third-person");
  assert.equal(s.vehicle, undefined);
  assert.ok(s.shoulder);
  assert.equal(s.view.fov, before.fov);
  await page.keyboard.press("v");
  await page.evaluate(() => {
    const r = __rs,
      t = r.playtest;
    const c = [...t.driveCars.values()].sort((a, b) => b.half - a.half)[0];
    t.releaseVehicle(t.driving.self);
    Object.assign(c, { claimed: true, x: -19.44, z: -6, yaw: -Math.PI / 2, speed: 0 });
    __rsCars[Number(c.id.split("-")[1])].driven = true;
    t.warp(c.x, r.groundAt(c.x, c.z), c.z - c.width - 1);
    r.look.current.yaw = c.yaw + Math.PI;
    r.look.current.pitch = 0;
    t.claimVehicle(c.id, t.driving.self, r.camera.position.x, r.camera.position.z);
  });
  await page.waitForTimeout(700);
  s = await snap("largest-vehicle-framing");
  assert.ok(s.car.half > 3, "fixture should include a large vehicle");
  assert.ok(
    Math.hypot(s.view.position[0] - s.car.x, s.view.position[2] - s.car.z) > s.car.half + 2,
  );
  const clearCamera = await page.evaluate(() => {
    const p = __lastView.position;
    return !__rs.playtest.staticBody(p[0], p[2], 0.2, p[1] - 0.2, 0.4, 0);
  });
  assert.ok(clearCamera, "camera body must be outside static geometry");
  assertFramed(s);
  await page.screenshot({ path: `${out}/chase-large.png` });
  await page.evaluate(() => {
    for (let i = 0; i < 40; i++) {
      __rs.invuln.current = 0;
      __rs.takeHit(100, "camera-test");
    }
  });
  await page.waitForTimeout(700);
  s = await snap("death-or-down-ejects-and-restores");
  assert.equal(s.vehicle, undefined);
  assert.equal(s.view.fov, before.fov);
  assert.deepEqual(report.errors, []);
} catch (e) {
  report.failure = e.stack;
  process.exitCode = 1;
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify(report));
