import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.env.BASE ?? "http://127.0.0.1:5292",
  out = process.env.OUT ?? "output/vehicle-coop";
await mkdir(out, { recursive: true });
const b = await chromium.launch({ args: ["--use-angle=metal"] }),
  ctx = await b.newContext({ viewport: { width: 1100, height: 720 } }),
  h = await ctx.newPage(),
  g = await ctx.newPage(),
  report = { errors: [], checks: [] };
for (const p of [h, g]) p.on("pageerror", (e) => report.errors.push(e.message));
const wait = (ms) => g.waitForTimeout(ms);
async function snapshot(name) {
  const pages = await Promise.all(
    [h, g]
      .filter((p) => !p.isClosed())
      .map((p) =>
        p.evaluate(() => {
          const r = __rs,
            rigs = [];
          r.scene.traverse((o) => {
            if (o.name === "scavenger-player")
              rigs.push({
                id: o.parent?.userData.playerId ?? "local",
                visible: o.visible && o.parent.visible,
              });
          });
          const c = r.playtest.driveCars.get("city-0");
          return {
            self: r.net.current.self,
            role: r.net.current.role,
            vehicle: r.playtest.myVehicle()?.id ?? null,
            car: { owner: c.owner, speed: c.speed, brake: c.brake, x: c.x, z: c.z, yaw: c.yaw },
            rigs,
          };
        }),
      ),
  );
  report.checks.push({ name, pages });
  return pages;
}
try {
  for (const p of [h, g])
    await p.goto(`${base}/game/?map=vice&seed=11&debug=1&padshim=ps&quality=low`);
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
        () => window.__rs?.net?.current?.peers().length && __rs.playtest.driveCars.size,
        null,
        { timeout: 120000 },
      ),
    ),
  );
  await wait(600);
  const guest = await g.evaluate(() => __rs.net.current.self);
  await h.evaluate(() => {
    const t = __rs.playtest,
      c = t.driveCars.get("city-0");
    Object.assign(c, { claimed: true, x: -19.44, z: -6, yaw: -Math.PI / 2, speed: 0 });
    __rsCars[0].driven = true;
    t.warp(-19.44, __rs.groundAt(-19.44, -12), -12);
    __rs.look.current.yaw = Math.PI;
  });
  await g.waitForFunction(() => __rs.playtest.driveCars.get("city-0").claimed);
  await g.evaluate(() => {
    const r = __rs,
      c = r.playtest.driveCars.get("city-0");
    r.playtest.warp(c.x, r.groundAt(c.x, c.z), c.z - c.width - 1);
  });
  await wait(300);
  await g.keyboard.press("v");
  await g.evaluate(() => __pad.down(2));
  await wait(900);
  await g.evaluate(() => __pad.up(2));
  await h.waitForFunction((id) => __rs.playtest.myVehicle(id)?.id === "city-0", guest);
  await wait(150);
  let s = await snapshot("guest-entered-hidden");
  assert.equal(s[1].vehicle, "city-0");
  assert.equal(s[0].rigs.find((r) => r.id === guest).visible, false);
  assert.equal(s[1].rigs.find((r) => r.id === "local").visible, false);
  await h.screenshot({ path: `out/remote-hidden.png`.replace("out/", `${out}/`) });
  await g.evaluate(() => {
    __pad.down(7, 0.5);
    __pad.axis(0, 1);
  });
  await wait(600);
  await g.evaluate(() => {
    __pad.up(7);
    __pad.axis(0, 0);
    __pad.down(6);
  });
  await wait(800);
  s = await snapshot("guest-brake-host-authoritative");
  assert.ok(s[0].car.speed < 0, "held L2 reverses after host brakes through zero");
  assert.equal(s[0].car.brake, 1);
  assert.ok(s[0].car.yaw < -Math.PI / 2);
  await g.evaluate(() => __pad.down(7));
  await wait(350);
  await g.evaluate(() => { __pad.up(7); __pad.up(6); });
  await wait(150);
  assert.equal((await snapshot("both-pedals-stop-before-hull-probe"))[0].car.speed, 0);
  const hullBefore = await h.evaluate(() => __rs.playtest.driveCars.get("city-0").hp);
  await h.evaluate(() => {
    const r = __rs,
      c = r.playtest.driveCars.get("city-0");
    const pos = r.camera.position.clone().set(c.x - 4, r.groundAt(c.x, c.z) + 0.6, c.z);
    r.enemyBullets.current.push({
      pos,
      vel: pos.clone().set(100, 0, 0),
      life: 1,
      active: true,
      damage: 10,
      color: "#f00",
      size: 0.1,
      gravity: 0,
      bounce: 0,
      pierce: 0,
      slow: 0,
      cluster: 0,
      chain: 0,
      burn: 0,
      knock: 0,
      mods: 0,
      blast: 0,
      blastMul: 0,
      src: "vehicle-fixture",
    });
  });
  await wait(250);
  report.enemyHullDamage = await h.evaluate(() => __rs.playtest.driveCars.get("city-0").hp);
  report.hullProbe = await h.evaluate(() => {const r=__rs,c=r.playtest.driveCars.get("city-0"),a={x:c.x-4,y:r.groundAt(c.x,c.z)+.6,z:c.z},b={...a,x:c.x+4};return {car:c.box?.bounds, ray:c.box?.rayContact?.(a,b), damaged:[...r.playtest.driveCars.values()].filter(c=>c.hp<c.maxHp).map(c=>({id:c.id,hp:c.hp})), bullets:r.enemyBullets.current.slice(-2).map(b=>({active:b.active,pos:b.pos.toArray(),life:b.life}))};});
  assert.equal(report.enemyHullDamage, hullBefore - 10, "enemy shot must damage covering hull");
  await g.evaluate(() => {
    __pad.up(6);
    __pad.tap(2, 120);
  });
  await wait(500);
  s = await snapshot("guest-exit-restores-body");
  assert.equal(s[0].car.owner, "");
  assert.equal(s[0].rigs.find((r) => r.id === guest).visible, true);
  await h.screenshot({ path: `${out}/remote-restored.png` });
  await g.evaluate(() => __pad.down(2));
  await wait(850);
  await g.evaluate(() => __pad.up(2));
  await wait(100);
  s = await snapshot("reentered-before-transfer");
  assert.equal(s[1].vehicle, "city-0");
  await h.close();
  await g.waitForFunction(() => __rs.net.current.role === "host", null, { timeout: 60000 });
  await wait(300);
  s = await snapshot("host-transfer-keeps-driver");
  assert.equal(s[0].vehicle, "city-0");
  assert.equal(s[0].car.owner, "host");
  assert.equal(s[0].rigs.find((r) => r.id === "local").visible, false);
  await g.evaluate(() => __pad.tap(2, 120));
  await wait(300);
  assert.equal((await snapshot("new-host-exit"))[0].vehicle, null);
  const r = await ctx.newPage();
  r.on("pageerror", (e) => report.errors.push(e.message));
  await r.goto(`${base}/game/?seed=11&debug=1&quality=low`);
  await r.getByRole("textbox", { name: "Room code" }).fill(code);
  await r.getByRole("button", { name: /^JOIN$/ }).click();
  await r.waitForFunction(() => window.__rs?.net?.current?.role === "guest", null, {
    timeout: 120000,
  });
  report.rejoin = await r.evaluate(() => ({
    role: __rs.net.current.role,
    vehicle: __rs.playtest.myVehicle()?.id ?? null,
  }));
  assert.equal(report.rejoin.vehicle, null);
  await g.evaluate(() => __pad.down(2));
  await wait(850);
  await g.evaluate(() => __pad.up(2));
  await wait(100);
  await g.evaluate(() => {
    const r = __rs,
      c = r.playtest.driveCars.get("city-0");
    c.hp = 1;
    const hit = r.playtest.damageVehicle(
      { x: c.x - 10, y: r.groundAt(c.x, c.z) + 0.6, z: c.z },
      { x: c.x + 10, y: r.groundAt(c.x, c.z) + 0.6, z: c.z },
      100,
    );
    if (!hit) throw Error("damage fixture missed car");
  });
  await wait(300);
  assert.equal((await snapshot("wreck-ejects"))[0].vehicle, null);
  assert.deepEqual(report.errors, []);
} catch (e) {
  report.failure = e.stack;
  process.exitCode = 1;
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await b.close();
}
console.log(JSON.stringify(report));
