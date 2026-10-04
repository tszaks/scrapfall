import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.env.BASE || "http://127.0.0.1:5287";
const out = process.env.OUT || "output/playwright";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [],
  report = { errors, transitions: [], stair: null };
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
try {
  await page.goto(`${base}/game/?map=vice&seed=7&weather=sunny&debug=1&tour=1&quality=high`);
  await page.getByRole("button", { name: /^start$/i }).click({ timeout: 90000 });
  for (const map of ["PACIFIC PIER", "WHITEOUT PASS", "DRY GULCH", "VICE HEIGHTS"]) {
    const start = Date.now();
    await page.getByRole("button", { name: new RegExp(map) }).click();
    await page.waitForFunction(
      () => window.__rs?.camera && !/PREPARING ARENA|ENTERING/.test(document.body.innerText),
      null,
      { timeout: 120000 },
    );
    await page.getByRole("button", { name: /enter arena/i }).waitFor({ state: "visible" });
    report.transitions.push({
      map,
      ms: Date.now() - start,
      ...(await page.evaluate(() => ({
        memory: { ...__rs.gl.info.memory },
        programs: __rs.gl.info.programs.length,
      }))),
    });
  }
  await page.getByRole("button", { name: /enter arena/i }).click();
  await page.waitForFunction(() => window.__rs?.camera);
  await page.waitForTimeout(3000);
  // Test actual keyboard controls through a full switchback storey and back down.
  const route = await page.evaluate(() => {
    const r = __rs,
      b = r.access.list().find((b) => b.stair && !b.stair.spiral),
      s = b.stair;
    const lane = (s.W / 2 + 0.1) / 2,
      south = s.v0 + s.Ls * 0.5,
      north = s.v0 + s.Ls + s.Lr + s.Ln * 0.5;
    const point = (a, d) => ({ x: b.ox + b.tx * a + b.ix * d, z: b.oz + b.tz * a + b.iz * d });
    const start = point(-lane, south);
    r.playtest.warp(start.x, b.groundY, start.z);
    Object.assign(r.access.player, {
      zone: 1,
      b: b.id,
      lap: 0,
      region: 0,
      level: 0,
      inCar: false,
      y: b.groundY,
    });
    r.look.current.pitch = 0;
    window.stairFrames = [];
    window.recordStairs = true;
    let lastY = r.camera.position.y;
    function sample() {
      if (!window.recordStairs) return;
      const y = r.camera.position.y;
      stairFrames.push({
        y,
        step: Math.abs(y - lastY),
        zone: r.access.player.zone,
        lap: r.access.player.lap,
      });
      lastY = y;
      requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
    return {
      building: b.spec.name,
      ground: b.groundY,
      height: s.h,
      points: [
        point(-lane, north),
        point(lane, north),
        point(lane, south),
        point(-lane, south),
        point(lane, south),
        point(lane, north),
        point(-lane, north),
        point(-lane, south),
      ],
    };
  });
  const legs = [];
  for (const [index, target] of route.points.entries()) {
    await page.keyboard.down("w");
    const result = await page.evaluate(async (target) => {
      const r = __rs,
        start = performance.now(),
        p0 = r.camera.position.clone();
      return await new Promise((resolve) => {
        function frame() {
          const p = r.camera.position,
            dx = target.x - p.x,
            dz = target.z - p.z,
            d = Math.hypot(dx, dz);
          r.look.current.yaw = Math.atan2(-dx, -dz);
          if (d < 0.18 || performance.now() - start > 15000)
            resolve({
              distance: d,
              travel: p.distanceTo(p0),
              ms: performance.now() - start,
              access: { ...r.access.player },
              position: p.toArray(),
            });
          else requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
      });
    }, target);
    await page.keyboard.up("w");
    legs.push({ index, ...result });
    await writeFile(
      `${out}/playtest-progress.json`,
      JSON.stringify({ route, legs, errors }, null, 2),
    );
    assert.ok(
      result.distance < 0.25,
      `stair route leg ${index} stuck ${result.distance}m from waypoint`,
    );
  }
  report.stair = {
    route,
    legs,
    ...(await page.evaluate(() => {
      window.recordStairs = false;
      return {
        maxFrameStep: Math.max(...stairFrames.map((f) => f.step)),
        maxLap: Math.max(...stairFrames.map((f) => f.lap)),
        minHeight: Math.min(...stairFrames.map((f) => f.y)),
        maxHeight: Math.max(...stairFrames.map((f) => f.y)),
        frames: stairFrames.length,
      };
    })),
  };
  assert.ok(report.stair.maxLap >= 1, "climbed full storey");
  assert.ok(report.stair.maxFrameStep < 0.4, "no stair snap");
  assert.equal(legs.at(-1).access.lap, 0, "returned to ground storey");
  await page.screenshot({ path: `${out}/stair-keyboard-playtest.png` });
  // Real keyboard movement and firing in the street after the stair traversal.
  await page.evaluate(() => {
    const r = __rs,
      p = r.city.spawn;
    r.playtest.warp(p.x, r.groundAt(p.x, p.z), p.z);
    r.look.current.yaw = Math.PI / 2;
    r.invuln.current = 1e6;
    r.giveAll();
    r.equip("smg");
  });
  const before = await page.evaluate(() => ({
    p: __rs.camera.position.toArray(),
    shots: __rs.aimStats.current.shot,
  }));
  await page.keyboard.down("w");
  await page.keyboard.down("Enter");
  await page.waitForTimeout(2500);
  await page.keyboard.up("Enter");
  await page.keyboard.up("w");
  report.controls = {
    before,
    after: await page.evaluate(() => ({
      p: __rs.camera.position.toArray(),
      shots: __rs.aimStats.current.shot,
    })),
  };
  assert.ok(report.controls.after.shots > before.shots, "keyboard fires weapon");
  assert.ok(
    Math.hypot(report.controls.after.p[0] - before.p[0], report.controls.after.p[2] - before.p[2]) >
      1,
    "keyboard moves player",
  );
  assert.deepEqual(errors, []);
} catch (e) {
  report.failure = e.stack;
  process.exitCode = 1;
} finally {
  await writeFile(`${out}/realism-playtest.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify(report, null, 2));
