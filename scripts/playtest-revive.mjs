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
  let syncRequest = 0;
  if (process.env.RECOVERY_SYNC)
    await h.evaluate(() => {
      const net = __rs.net.current,
        send = net.sendTo;
      net.sendTo = (id, message) => {
        send(id, message);
        if (message.type === "status" && window.__syncReceipt) {
          send(id, { type: "event", name: window.__syncReceipt });
          window.__syncReceipt = "";
        }
      };
    });
  const requestRecoverySync = async (target) => {
    const receipt = `RECOVERY SYNC ${++syncRequest}`;
    await h.evaluate((receipt) => {
      window.__syncReceipt = receipt;
    }, receipt);
    await target.evaluate(() => __rs.net.current.broadcast({ type: "world-ready" }));
    await target.getByText(receipt, { exact: true }).waitFor({ timeout: 10000 });
  };

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
  const ground = await h.evaluate(() => {
    const spawn = __rs.city.spawn;
    for (let dx = 12; dx < 40; dx += 2)
      for (let dz = -20; dz < 20; dz += 2) {
        const x = spawn.x + dx,
          z = spawn.z + dz,
          y = __rs.groundAt(x, z);
        if (!__rs.bodyAt(x, z, y) && !__rs.bodyAt(x + 1.3, z, y))
          return { a: { x, z, y }, b: { x: x + 1.3, z, y } };
      }
  });
  const stairs = await h.evaluate(() => {
    const b = __rs.access.list().find((b) => b.stair && !b.stair.spiral && b.stair.laps > 1);
    if (!b) return null;
    const st = b.stair;
    const point = (d) => ({
      x: b.ox + b.tx * (-st.W / 4) + b.ix * d,
      z: b.oz + b.tz * (-st.W / 4) + b.iz * d,
      y: b.groundY + st.h + (((d - st.v0 - st.Ls) / st.Lr) * st.h) / 2,
      access: { zone: 1, b: b.id, lap: 1, region: 1, level: 0, inCar: false },
    });
    return { a: point(st.v0 + st.Ls + st.Lr / 2), b: point(st.v0 + st.Ls + st.Lr / 2 + 0.9) };
  });
  assert.ok(ground, "usable ground pair");
  assert.ok(stairs, "usable stair pair");
  for (const [target, helper, name, location] of [
    [g, h, "guest roof", roof],
    [h, g, "host roof", roof],
    [g, h, "guest repeated", roof],
    [g, h, "guest ground", ground],
    [h, g, "host stairs", stairs],
  ]) {
    for (const [p, pos] of [
      [target, location.a],
      [helper, location.b],
    ])
      await p.evaluate((pos) => {
        __rs.playtest.warp(pos.x, pos.y, pos.z);
        if (pos.access) Object.assign(__rs.access.player, pos.access, { y: pos.y });
      }, pos);
    await target.waitForTimeout(400);
    await target.evaluate(() => {
      __rs.invuln.current = 0;
      for (let i = 0; i < 25; i++) __rs.takeHit(100, "revive regression");
      __rs.invuln.current = 1e6;
    });
    await target.waitForFunction(() => __rs.downedRef.current, null, { timeout: 10000 });
    const before = await pose(target);
    if (process.env.RECOVERY_SYNC && name === "guest roof") {
      await requestRecoverySync(target);
      const synced = await pose(target);
      assert.equal(synced.hp, 0, "same-wave reconnect must not revive a downed guest");
      assert.equal(synced.down, true);
      results.push({ name: "downed same-wave recovery sync", synced });
    }
    assert.ok(
      Math.hypot(before.x - location.a.x, before.z - location.a.z) < 0.1,
      `${name} downed position`,
    );
    assert.ok(
      Math.abs(before.y - location.a.y) < (location === ground ? 1 : 0.15),
      `${name} downed floor ${before.y} vs ${location.a.y}`,
    );
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

  await g.evaluate((pos) => __rs.playtest.warp(pos.x, pos.y, pos.z), roof.a);
  await g.waitForTimeout(400);
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
  if (process.env.RECOVERY_SYNC) {
    await requestRecoverySync(g);
    const synced = await pose(g);
    assert.equal(synced.hp, 0, "same-wave reconnect must not respawn a dead guest");
    assert.equal(synced.down, false);
    results.push({ name: "dead same-wave recovery sync", synced });
  }
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
