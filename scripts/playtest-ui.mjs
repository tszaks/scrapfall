// Focused regression checks against a built game, served with npm run serve:static.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import fs from "node:fs";
const base = process.env.BASE ?? "http://127.0.0.1:4173";
const out = process.env.OUT ?? "/tmp/scrapfall-playtest-checks";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  args:
    process.platform === "darwin"
      ? ["--use-angle=metal"]
      : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 720 } }),
  errors = [],
  results = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(`${base}/game/?map=whiteout&seed=7&debug=1&tour=1&quality=low`);
  await page
    .getByRole("button", { name: /^start$/i })
    .first()
    .click({ timeout: 120000 });
  await page.getByRole("button", { name: /enter arena/i }).click({ timeout: 120000 });
  await page.waitForFunction(() => window.__rs?.playtest, { timeout: 120000 });
  results.push(
    await page.evaluate(() => {
      const r = __rs,
        t = r.playtest,
        a = r.city.alpine;
      const gates = [a.rink.z0, a.rink.z1].map((z) => ({
        z,
        player: r.bodyAt(2, z + 1, r.groundAt(2, z + 1)),
        enemy: r.enemyBodyAt(2, z + 1, 0.6, 2),
      }));
      const b = r.access.list().find((b) => b.spec.name === "church-tower"),
        p = r.access.player,
        sp = b.stair.spiral;
      const point = (a, d) => ({ x: b.ox + b.tx * a + b.ix * d, z: b.oz + b.tz * a + b.iz * d });
      Object.assign(p, {
        zone: 1,
        b: b.id,
        lap: 0,
        region: 0,
        level: 0,
        inCar: false,
        y: b.groundY,
      });
      let previous = b.groundY,
        maxStep = 0,
        blocked = 0;
      for (let lap = 0; lap < b.stair.laps; lap++)
        for (let i = 0; i <= 360; i++) {
          const angle = (i * Math.PI) / 180,
            pt = point(-Math.sin(angle) * 1.1, sp.centerD - Math.cos(angle) * 1.1);
          const y = t.stepPlayer(pt, 0, 0, () => false, 1 / 60);
          maxStep = Math.max(maxStep, Math.abs(y - previous));
          previous = y;
          if (t.playerBlocked(pt.x, pt.z, 0.3, y)) blocked++;
        }
      const top = p.y,
        lap = p.lap;
      for (let turn = 0; turn < b.stair.laps; turn++)
        for (let i = 360; i >= 0; i--) {
          const angle = (i * Math.PI) / 180,
            pt = point(-Math.sin(angle) * 1.1, sp.centerD - Math.cos(angle) * 1.1);
          const y = t.stepPlayer(pt, 0, 0, () => false, 1 / 60);
          maxStep = Math.max(maxStep, Math.abs(y - previous));
          previous = y;
        }
      const bottom = p.y;
      Object.assign(p, { zone: 1, b: b.id, lap: 3, region: 1 });
      const displaced = point(9, 9);
      const before = { ...displaced };
      t.stepPlayer(displaced, 0, 0, () => false);
      const recovered = Math.hypot(displaced.x - before.x, displaced.z - before.z) > 1;
      t.warp(r.city.spawn.x, r.groundAt(r.city.spawn.x, r.city.spawn.z), r.city.spawn.z);
      return {
        test: "Whiteout collision",
        gates,
        tower: {
          top,
          expectedTop: b.top,
          bottom,
          expectedBottom: b.groundY,
          lap,
          maxStep,
          blocked,
          recovered,
        },
      };
    }),
  );
  const collision = results.at(-1);
  for (const g of collision.gates) {
    assert.equal(g.player, false);
    assert.equal(g.enemy, false);
  }
  assert.ok(Math.abs(collision.tower.top - collision.tower.expectedTop) < 0.1);
  assert.ok(Math.abs(collision.tower.bottom - collision.tower.expectedBottom) < 0.1);
  assert.ok(collision.tower.maxStep < 0.3);
  assert.ok(collision.tower.recovered);
  await page.evaluate(() => {
    const r = __rs;
    r.invuln.current = 1e6;
    r.giveAll();
    r.equip("smg");
    r.ammo.current.smg = 1;
    r.trigger.current = true;
  });
  await page.waitForFunction(() => __rs.ammo.current.smg === 0, { timeout: 15000 });
  const retained = await page.evaluate(() => {
    __rs.trigger.current = false;
    return __rs.weapon.current;
  });
  assert.equal(retained, "smg");
  await page.evaluate(() => __rs.spawnWave(2));
  assert.equal(await page.evaluate(() => __rs.ammo.current.smg), 42);
  results.push({ test: "retained weapon and wave refill", passed: true });
  await page.keyboard.press("KeyP");
  await page.getByRole("button", { name: "Return to safe spawn" }).click();
  await page.waitForFunction(() => __rs.access.player.zone === 0);
  results.push({ test: "safe return button", passed: true });
  results.push(
    await page.evaluate(() => {
      const r = __rs,
        t = r.playtest,
        a = r.city.alpine,
        runs = [];
      for (const name of ["blue", "red"]) {
        const start = a.paths.find((p) => p.name === name).pts[0];
        t.startSki(a, ...start);
        let frames = 0,
          blocked = 0;
        while (t.ski.active && frames++ < 3000) {
          t.stepSki(0.05, 1, frames % 300 < 150 ? 0.4 : -0.4);
          if (t.staticBody(t.ski.x, t.ski.z, 0.3, t.ski.y, 1.8, 0.15)) blocked++;
        }
        runs.push({ name, frames, blocked, ended: !t.ski.active });
        t.resetSki();
      }
      const cam = {
          position: {
            x: 0,
            y: 0,
            z: 0,
            set(x, y, z) {
              Object.assign(this, { x, y, z });
            },
          },
        },
        look = { yaw: 0, pitch: 0 };
      t.alpine.t = 0;
      const c = { ...t.chairAt(a.lift, 0) };
      cam.position.set(c.x, c.y, c.z);
      t.resetRide();
      t.stepRide(cam, a, 0.05, look, new Set(), 1);
      const first = { ...t.ride, x: cam.position.x };
      t.resetRide();
      cam.position.set(c.x, c.y, c.z);
      t.stepRide(cam, a, 0.05, look, new Set([0]), 2);
      const second = { ...t.ride, x: cam.position.x };
      t.resetRide();
      return { test: "ski routes and shared lift", runs, first, second };
    }),
  );
  for (const r of results.at(-1).runs) {
    assert.ok(r.ended);
    assert.equal(r.blocked, 0);
  }
  assert.equal(results.at(-1).first.chair, results.at(-1).second.chair);
  assert.notEqual(results.at(-1).first.x, results.at(-1).second.x);
  await page.screenshot({ path: `${out}/whiteout.png` });
  assert.deepEqual(errors, []);
  console.log("PASS Whiteout traversal, retained ammo, recovery, ski routes, and shared lift");
} finally {
  fs.writeFileSync(`${out}/results.json`, JSON.stringify({ errors, results }, null, 2));
  await browser.close();
}
