import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
const base = process.env.BASE ?? "http://127.0.0.1:4173",
  out = process.env.OUT ?? "/tmp/scrapfall-combat-checks";
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({
    args:
      process.platform === "darwin"
        ? ["--use-angle=metal"]
        : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  }),
  p = await b.newPage({ viewport: { width: 1100, height: 720 } }),
  errors = [],
  results = [];
p.on("pageerror", (e) => errors.push(e.message));
try {
  await p.goto(`${base}/game/?map=vice&seed=11&debug=1&quality=low`);
  await p
    .getByRole("button", { name: /^start$/i })
    .first()
    .click({ timeout: 120000 });
  await p.getByRole("button", { name: /enter arena/i }).click({ timeout: 120000 });
  await p.waitForFunction(() => __rs?.playtest?.driveCars.size, { timeout: 120000 });
  await p.evaluate(() => {
    const r = __rs;
    r.invuln.current = 1e6;
    r.giveAll();
    r.equip("smg");
    r.ammo.current.smg = 90;
    r.playtest.supply.loaded.smg = 0;
    r.playtest.addScrap(100);
  });
  await p.keyboard.press("KeyR");
  await p.waitForFunction(() => __rs.playtest.supply.loaded.smg === 30, { timeout: 10000 });
  results.push({ test: "reload input fills 30-round Buzzer magazine", passed: true });
  await p.evaluate(() => {
    __rs.ammo.current.smg = 0;
    __rs.playtest.supply.loaded.smg = 0;
  });
  await p.keyboard.press("KeyK");
  await p.waitForFunction(() => __rs.ammo.current.smg === 60, { timeout: 10000 });
  results.push({ test: "buy ammo during combat", passed: true });
  await p.evaluate(() => {
    __rs.stats.current.extmag = true;
    __rs.ammo.current.pistol = 200;
  });
  await p.keyboard.press("KeyK");
  await p.waitForFunction(() => __rs.ammo.current.pistol === 220, null, { timeout: 10000 });
  results.push({ test: "ammo purchase preserves extended pistol capacity", passed: true });
  await p.evaluate(() => {
    __rs.stats.current.extmag = false;
  });
  const travel = await p.evaluate(() => {
    const r = __rs,
      t = r.playtest,
      cs = [...t.driveCars.values()],
      station = r.city.props.find((s) => s.k === "subway"),
      destination = t.subwayExit(r.city, station.x, station.z, r.blocks);
    const speeds = [...new Set(cs.map((c) => c.topSpeed))];
    const car = cs.find((c) => c.topSpeed === 32) ?? cs[0];
    t.warp(
      car.x + Math.cos(car.yaw) * (car.width + 1),
      r.groundAt(car.x, car.z),
      car.z - Math.sin(car.yaw) * (car.width + 1),
    );
    t.emitControl("use", true, false);
    t.emitControl("use", false, false);
    return { speeds, station: { x: station.x, z: station.z }, destination };
  });
  assert.ok(travel.speeds.includes(32));
  assert.ok(travel.speeds.some((s) => s < 22));
  assert.ok(travel.destination);
  results.push({ test: "vehicle speeds and subway route", ...travel });
  await p.waitForFunction(() => __rs.playtest.myVehicle(), { timeout: 10000 });
  const before = await p.evaluate(() => {
    const c = __rs.playtest.myVehicle();
    return { x: c.x, z: c.z };
  });
  await p.keyboard.down("KeyW");
  await p.waitForTimeout(1200);
  await p.keyboard.up("KeyW");
  const moved = await p.evaluate((before) => {
    const c = __rs.playtest.myVehicle();
    return Math.hypot(c.x - before.x, c.z - before.z);
  }, before);
  assert.ok(moved > 0.5);
  results.push({ test: "city driving", moved });
  await p.keyboard.press("KeyE");
  await p.waitForFunction(() => !__rs.playtest.myVehicle(), { timeout: 10000 });
  const destroyed = await p.evaluate(() => {
    const r = __rs,
      t = r.playtest,
      c = [...t.driveCars.values()].find((c) => c.claimed);
    const from = {
        x: c.x - Math.sin(c.yaw) * 10,
        y: r.groundAt(c.x, c.z) + 0.6,
        z: c.z - Math.cos(c.yaw) * 10,
      },
      to = { x: c.x + Math.sin(c.yaw) * 10, y: from.y, z: c.z + Math.cos(c.yaw) * 10 };
    for (let i = 0; i < 20 && c.hp > 0; i++) t.damageVehicle(from, to, 20);
    return { hp: c.hp, owner: c.owner };
  });
  assert.equal(destroyed.hp, 0);
  assert.equal(destroyed.owner, "");
  results.push({ test: "car damage and destruction", ...destroyed });
  await p.evaluate(() => {
    const r = __rs,
      t = r.playtest;
    r.playtest.warp(r.city.spawn.x, r.groundAt(r.city.spawn.x, r.city.spawn.z), r.city.spawn.z);
    r.look.current.yaw = 0;
    r.look.current.pitch = 0;
    const e = r.enemies[0];
    Object.assign(e, {
      alive: true,
      kind: "drifter",
      hp: 20,
      max: 20,
      x: r.camera.position.x,
      z: r.camera.position.z - 1.8,
    });
    t.emitControl("melee", true, false);
    t.emitControl("melee", false, false);
  });
  await p.waitForFunction(() => __rs.enemies[0].hp < 20, { timeout: 10000 });
  results.push({
    test: "melee damages a nearby robot",
    hp: await p.evaluate(() => __rs.enemies[0].hp),
  });
  await p.evaluate(() => {
    const r = __rs;
    r.wave.current = 12;
    r.enemies.forEach((e) => (e.alive = false));
    r.pending.current.fill(null);
  });
  await p.getByRole("button", { name: /overtime/i }).click({ timeout: 20000 });
  await p.waitForFunction(() => __rs.wave.current >= 13, null, { timeout: 40000 });
  await p.waitForFunction(() => __rs.enemies.some((e) => e.alive), null, { timeout: 45000 });
  await p.evaluate(() => {
    const r = __rs;
    r.enemies.forEach((e) => (e.alive = false));
    r.pending.current.fill(null);
  });
  await p.getByText("SCRAP SHOP", { exact: true }).waitFor({ timeout: 15000 });
  results.push({
    test: "overtime wave and perk shop",
    wave: await p.evaluate(() => __rs.wave.current),
  });
  await p.screenshot({ path: `${out}/overtime-shop.png` });
  assert.deepEqual(errors, []);
  console.log(
    "PASS reload, ammo purchase, melee, city driving/destruction, subway route, and overtime shop",
  );
} finally {
  fs.writeFileSync(`${out}/results.json`, JSON.stringify({ errors, results }, null, 2));
  await b.close();
}
