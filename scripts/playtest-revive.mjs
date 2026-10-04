import assert from "node:assert/strict";
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const base = process.env.BASE ?? "http://127.0.0.1:4173";
const browser = await chromium.launch({
  args:
    process.platform === "darwin"
      ? ["--use-angle=metal"]
      : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const watchdog = setTimeout(() => browser.close(), 175000);
const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
const h = await ctx.newPage(),
  g = await ctx.newPage(),
  errors = [],
  results = [];
for (const p of [h, g]) p.on("pageerror", (e) => errors.push(e.message));
const pose = (p) =>
  p.evaluate(() => ({
    x: __rs.camera.position.x,
    z: __rs.camera.position.z,
    y: __rs.moveState.feet,
    eye: __rs.camera.position.y,
    hp: __rs.healthRef.current,
    down: __rs.downedRef.current,
  }));
try {
  for (const p of [h, g]) await p.goto(`${base}/game/?map=vice&seed=11&debug=1&quality=low`);
  await h.getByRole("button", { name: "HOST A ROOM" }).click({ timeout: 60000 });
  const code = (await h.getByRole("button", { name: /TAP TO COPY/ }).innerText({ timeout: 30000 }))
    .trim()
    .slice(0, 4);
  await g.getByRole("textbox", { name: "Room code" }).fill(code);
  await g.getByRole("button", { name: /^JOIN$/ }).click();
  await g.getByRole("button", { name: /READY UP/ }).click({ timeout: 30000 });
  await h.getByRole("button", { name: /^Start$/ }).click();
  await h.getByRole("button", { name: /ENTER ARENA/i }).click({ timeout: 45000 });
  for (const p of [h, g])
    await p.waitForFunction(() => window.__rs?.wave.current >= 1, null, { timeout: 45000 });
  console.log("both in room");
  for (const p of [h, g])
    await p.evaluate(() => {
      __rs.invuln.current = 1e6;
    });
  const roof = await h.evaluate(() => {
    for (const b of __rs.access.list()) {
      for (const a of b.spots) {
        for (const c of b.spots) {
          if (
            Math.hypot(a.x - c.x, a.z - c.z) > 1 &&
            Math.hypot(a.x - c.x, a.z - c.z) < 2.4 &&
            !__rs.bodyAt(a.x, a.z, b.top) &&
            !__rs.bodyAt(c.x, c.z, b.top)
          )
            return { a: { ...a, y: b.top }, b: { ...c, y: b.top } };
        }
      }
    }
    return null;
  });
  assert.ok(roof, "usable rooftop pair");
  for (const [target, helper, name] of [
    [g, h, "guest"],
    [h, g, "host"],
    [g, h, "guest repeated"],
  ]) {
    for (const [p, pos] of [
      [target, roof.a],
      [helper, roof.b],
    ])
      await p.evaluate((pos) => __rs.playtest.warp(pos.x, pos.y, pos.z), pos);
    await target.waitForTimeout(400);
    await target.evaluate(() => {
      __rs.invuln.current = 0;
      for (let i = 0; i < 25; i++) __rs.takeHit(100, "revive regression");
      __rs.invuln.current = 1e6;
    });
    await target.waitForFunction(() => __rs.downedRef.current, null, { timeout: 10000 });
    const before = await pose(target);
    await helper.evaluate(() => __rs.playtest.emitControl("revive", true, false));
    await target.waitForFunction(() => __rs.healthRef.current > 0, null, { timeout: 10000 });
    await helper.evaluate(() => __rs.playtest.emitControl("revive", false, false));
    await target.waitForTimeout(600);
    const after = await pose(target);
    assert.ok(Math.hypot(after.x - before.x, after.z - before.z) < 0.1, `${name} position`);
    assert.ok(Math.abs(after.y - before.y) < 0.1, `${name} floor`);
    assert.ok(after.eye - after.y > 1.4, `${name} stands up`);
    results.push({ name, before, after });
    console.log("PASS", name);
    await target.waitForTimeout(1600);
  }

  const spawn = await g.evaluate(() => ({ ...__rs.city.spawn }));
  await g.evaluate(() => {
    __rs.invuln.current = 0;
    for (let i = 0; i < 25; i++) __rs.takeHit(100, "bleed regression");
    __rs.invuln.current = 1e6;
  });
  await g.waitForFunction(() => __rs.downedRef.current, null, { timeout: 10000 });
  await h.waitForFunction(() => [...__rs.squad.values()].some((s) => s.st === 1), null, {
    timeout: 10000,
  });
  await h.evaluate(() => {
    for (const s of __rs.squad.values()) if (s.st === 1) s.bleed = 0.01;
  });
  await g.waitForFunction(() => !__rs.downedRef.current && __rs.healthRef.current === 0, null, {
    timeout: 10000,
  });
  const dead = await pose(g);
  await g.waitForTimeout(500);
  assert.equal((await pose(g)).hp, 0, "bleed-out stays dead before next wave");
  await h.evaluate(() => {
    __rs.enemies.forEach((e) => (e.alive = false));
    __rs.pending.current.fill(null);
    __rs.nextWaveTimer.current = 0.01;
  });
  await g.waitForFunction(() => __rs.healthRef.current > 0, null, { timeout: 15000 });
  await g.waitForTimeout(500);
  const respawn = await pose(g);
  assert.ok(
    Math.hypot(respawn.x - spawn.x, respawn.z - spawn.z) < 7,
    "fully dead guest returns to spawn next wave",
  );
  assert.ok(Math.hypot(respawn.x - dead.x, respawn.z - dead.z) > 10, "respawn leaves rooftop");
  results.push({ name: "full death next-wave spawn", dead, respawn });
  console.log("PASS full death next-wave spawn");
  assert.deepEqual(errors, []);
} finally {
  clearTimeout(watchdog);
  writeFileSync(
    process.env.OUT ?? "/tmp/scrapfall-revive-result.json",
    JSON.stringify({ results, errors }, null, 2),
  );
  await browser.close();
}
