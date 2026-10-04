// Matched player-eye vehicle views. Debug freezes preserve poses; driving tests are separate.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const out = process.env.OUT || "output/playwright/drivers";
const tag = process.env.TAG || "after";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
});
const report = { errors: [], views: [] };
page.on("pageerror", (e) => report.errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") report.errors.push(m.text());
});
try {
  await page.goto(
    `${process.env.BASE || "http://127.0.0.1:5294"}/game/?map=vice&seed=11&time=${process.env.TIME || "sunset"}&weather=${process.env.WEATHER || "sunny"}&debug=1&quality=high`,
  );
  await page.getByRole("button", { name: /^start$/i }).click({ timeout: 90000 });
  await page.getByRole("button", { name: /enter arena/i }).click();
  await page.waitForFunction(() => window.__rsCarBatch && window.__rs?.camera, null, {
    timeout: 120000,
  });
  await page.waitForTimeout(1500);
  // Art-only diagnostic before the gameplay-owned Traffic hookup lands. Never use
  // this override for performance or entry/exit acceptance.
  if (process.env.DIAGNOSTIC_DRIVERS === "1")
    await page.evaluate(() => {
      for (let i = 0; i < __rsCars.length; i++) {
        const sl = __rsCarBatch.slots[i],
          car = __rsCars[i];
        Object.defineProperty(sl, "driver", {
          configurable: true,
          get: () => !sl.wrecked && !car.park,
          set: () => {},
        });
      }
    });
  report.diagnosticDriverOverride = process.env.DIAGNOSTIC_DRIVERS === "1";
  const candidates = await page.evaluate(() => {
    const chosen = [],
      seen = new Set();
    for (let i = 0; i < __rsCars.length; i++) {
      const c = __rsCars[i];
      c.driven = true;
      if (c.park || seen.has(c.v.type)) continue;
      seen.add(c.v.type);
      chosen.push({ i, type: c.v.type, x: c.x, z: c.z, yaw: c.yawVis, len: c.v.len, wid: c.v.wid });
    }
    return chosen;
  });
  const poses =
    tag === "before" ? candidates : JSON.parse(await readFile(`${out}/poses.json`, "utf8"));
  if (tag === "before") await writeFile(`${out}/poses.json`, JSON.stringify(poses, null, 2));
  await page.evaluate((poses) => {
    for (const p of poses) {
      const c = __rsCars[p.i];
      Object.assign(c, {
        x: p.x,
        px: p.x,
        z: p.z,
        pz: p.z,
        yaw: p.yaw,
        pyaw: p.yaw,
        yawVis: p.yaw,
        driven: true,
        park: false,
        speed: 0,
      });
    }
  }, poses);
  for (const pose of poses)
    for (const side of [false, true]) {
      const result = await page.evaluate(
        ({ p, side }) => {
          const r = __rs,
            dist = side ? p.wid / 2 + 2.2 : p.len / 2 + 2.5;
          const a = p.yaw + (side ? Math.PI / 2 : 0),
            x = p.x + Math.sin(a) * dist,
            z = p.z + Math.cos(a) * dist,
            y = r.groundAt(x, z);
          r.playtest.warp(x, y, z);
          r.look.current.yaw = a;
          r.look.current.pitch = Math.atan2(1.15 - (y + 1.6), dist);
          return { type: p.type, side, x, y, z, yaw: a, walkable: !r.bodyAt(x, z, y) };
        },
        { p: pose, side },
      );
      await page.waitForTimeout(250);
      const state = await page.evaluate(() => {
        const m = __rsCarBatch.group.getObjectByName("ambient-drivers");
        return {
          camera: __rs.camera.position.toArray(),
          driverCount: m?.count ?? 0,
          driverVisible: m?.visible ?? false,
        };
      });
      const file = `${tag}-${pose.type}-${side ? "side" : "front"}.png`;
      await page.screenshot({ path: `${out}/${file}` });
      report.views.push({ ...result, ...state, file });
    }
  assert.deepEqual(report.errors, []);
  if (tag !== "before")
    assert.ok(
      report.views.some((v) => v.driverCount > 0),
      "real traffic caller enables occupants",
    );
} finally {
  await writeFile(`${out}/${tag}.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify(report, null, 2));
