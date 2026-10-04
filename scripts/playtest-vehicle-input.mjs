import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.env.BASE ?? "http://127.0.0.1:5292",
  out = process.env.OUT ?? "output/vehicle-input";
await mkdir(out, { recursive: true });
const b = await chromium.launch({ args: ["--use-angle=metal"] }),
  p = await b.newPage({ viewport: { width: 1280, height: 800 } }),
  report = {
    simulatedController: "DualSense via built-in padshim; not physical hardware",
    errors: [],
    checks: [],
  };
p.on("pageerror", (e) => report.errors.push(e.message));
async function snap(name) {
  const v = await p.evaluate(() => {
    const r = __rs,
      t = r.playtest,
      c = [...t.driveCars.values()][0],
      rigs = [];
    r.scene.traverse((o) => {
      if (o.name === "scavenger-player")
        rigs.push({
          id: o.parent?.userData.playerId ?? "local",
          visible: o.visible && o.parent.visible,
        });
    });
    return {
      vehicle: t.myVehicle()?.id ?? null,
      car: { x: c.x, z: c.z, yaw: c.yaw, speed: c.speed, gas: c.gas, brake: c.brake },
      shots: r.aimStats.current.shot,
      aim: r.aimState.on,
      rigs,
      hint: document.querySelector('[data-testid="travel-hint"]')?.innerText ?? "",
      ammo: document.querySelector('[data-ammo-hud]')?.innerText ?? "",
    };
  });
  report.checks.push({ name, ...v });
  return v;
}
async function fixture() {
  await p.evaluate(() => {
    __pad.reset();
    const r = __rs,
      t = r.playtest,
      c = [...t.driveCars.values()][0];
    t.releaseVehicle(t.driving.self);
    Object.assign(c, { claimed: true, x: -19.44, z: -6, yaw: -Math.PI / 2, speed: 0 });
    __rsCars[0].driven = true;
    t.warp(c.x, cameraGround(), c.z - c.width - 1);
    function cameraGround() {
      return r.groundAt(c.x, c.z);
    }
  });
  await p.waitForTimeout(250);
}
const down = (i) => p.evaluate((i) => __pad.down(i), i),
  up = (i) => p.evaluate((i) => __pad.up(i), i),
  wait = (ms) => p.waitForTimeout(ms);
try {
  await p.goto(`${base}/game/?map=vice&seed=11&debug=1&padshim=ps&tour=1`);
  await p.getByRole("button", { name: /^start$/i }).click({ timeout: 120000 });
  await p.getByRole("button", { name: /enter arena/i }).click({ timeout: 120000 });
  await p.waitForFunction(() => window.__rs?.playtest?.driveCars.size && window.__pad);
  await wait(700);
  await fixture();
  await down(2);
  await wait(240);
  let s = await snap("partial-hold");
  assert.equal(s.vehicle, null);
  assert.match(s.hint, /HOLD □ TO ENTER · \d+%/);
  await p.screenshot({ path: `${out}/hold-progress.png` });
  await up(2);
  await wait(750);
  assert.equal((await snap("release-cancel")).vehicle, null);
  await down(2);
  await wait(200);
  await p.evaluate(() => __rs.playtest.warp(-57, __rs.groundAt(-57, -28), -28));
  await wait(800);
  assert.equal((await snap("range-cancel")).vehicle, null);
  await up(2);
  await fixture();
  await down(2);
  await wait(200);
  await p.keyboard.press("p");
  await p.getByRole("button", { name: /^resume$/i }).waitFor();
  await p.getByRole("button", { name: /^resume$/i }).click();
  await wait(850);
  assert.equal((await snap("pause-cancel")).vehicle, null);
  await up(2);
  await wait(100);
  await down(2);
  await wait(200);
  await p.evaluate(() => __pad.unplug());
  await wait(200);
  await p.evaluate(() => __pad.plug());
  await wait(850);
  assert.equal((await snap("disconnect-cancel")).vehicle, null);
  await up(2);
  await wait(250);
  await down(2);
  await wait(750);
  assert.equal((await snap("entered")).vehicle, "city-0");
  await wait(650);
  assert.equal((await snap("hold-does-not-exit")).vehicle, "city-0");
  await up(2);
  await wait(150);
  const shots = (await snap("before-driving")).shots;
  await p.evaluate(() => __pad.axis(1, -1));
  await wait(700);
  assert.equal((await snap("stick-no-throttle")).car.speed, 0);
  await p.evaluate(() => __pad.axis(1, 0));
  await p.evaluate(() => __pad.down(7, 0.5));
  await wait(1000);
  const half = await snap("half-trigger");
  assert.ok(half.car.speed > 2 && half.car.speed < 4);
  await down(7);
  await wait(1000);
  const full = await snap("full-trigger");
  assert.ok(full.car.speed > half.car.speed + 4);
  await up(7);
  await wait(500);
  const coast = await snap("coast");
  assert.ok(coast.car.speed < full.car.speed && coast.car.speed > full.car.speed - 2);
  await down(6);
  await p.waitForFunction(() => __rs.playtest.myVehicle().speed <= 0, null, { polling: "raf" });
  const stopped = await snap("brake-through-zero");
  assert.ok(stopped.car.speed > -0.3);
  await wait(700);
  const reversed = await snap("held-brake-reverses");
  assert.ok(reversed.car.speed < -1 && reversed.car.speed > -4);
  await up(6);
  await down(7);
  await p.waitForFunction(() => __rs.playtest.myVehicle().speed >= 0, null, { polling: "raf" });
  await wait(500);
  assert.ok((await snap("forward-after-reverse")).car.speed > 1);
  await up(7);
  assert.equal((await snap("no-driving-shots")).shots, shots);
  await up(6);
  await p.keyboard.press("v");
  await wait(300);
  s = await snap("local-body-hidden");
  assert.equal(s.rigs.find((r) => r.id === "local").visible, false);
  await p.screenshot({ path: `${out}/local-driver.png` });
  await down(2);
  await wait(150);
  await up(2);
  await wait(250);
  assert.equal((await snap("exit")).vehicle, null);
  await fixture();
  await p.keyboard.press("e");
  await wait(150);
  assert.equal((await snap("keyboard-entry")).vehicle, "city-0");
  for (const reverse of [false, true])
    for (const right of [false, true]) {
      await p.evaluate(() => {
        const c = __rs.playtest.myVehicle();
        Object.assign(c, { x: -19.44, z: -6, yaw: -Math.PI / 2, speed: 0 });
      });
      const gas = reverse ? "s" : "w",
        steer = right ? "d" : "a";
      await p.keyboard.down(gas);
      await p.keyboard.down(steer);
      await wait(450);
      await p.keyboard.up(gas);
      await p.keyboard.up(steer);
      const v = await snap(
        `keyboard-${reverse ? "reverse" : "forward"}-${right ? "right" : "left"}`,
      );
      assert.equal(Math.sign(v.car.yaw + Math.PI / 2), (right ? -1 : 1) * (reverse ? -1 : 1));
    }
  await fixture();
  await p.keyboard.press("e");
  await wait(150);
  await down(7);
  await p.evaluate(() => __pad.axis(0, 1));
  await wait(450);
  await up(7);
  await p.evaluate(() => __pad.axis(0, 0));
  assert.ok((await snap("pad-forward-right")).car.yaw < -Math.PI / 2);
  await fixture();
  await down(6);
  await wait(120);
  await up(6);
  await wait(120);
  assert.equal((await snap("toggle-aim-on")).aim, true);
  await down(2);
  await wait(700);
  await up(2);
  await wait(120);
  assert.equal((await snap("entry-clears-toggle-aim")).aim, false);
  await fixture();
  await down(7);
  await wait(100);
  await down(2);
  await wait(550);
  const before = await snap("trigger-before-entry");
  await wait(250);
  const after = await snap("held-trigger-entry");
  assert.equal(after.vehicle, "city-0");
  assert.equal(after.shots, before.shots);
  assert.equal(after.car.gas, 0);
  await up(2);
  await wait(100);
  await down(2);
  await wait(120);
  await up(2);
  await wait(300);
  const exitShot = await snap("held-trigger-exit");
  await wait(350);
  assert.equal((await snap("exit-requires-trigger-release")).shots, exitShot.shots);
  await up(7);
  await fixture();
  await p.evaluate(() => __rs.playtest.warp(-57, __rs.groundAt(-57, -28), -28));
  await wait(300);
  await p.evaluate(() => {
    __rs.playtest.supply.loaded.pistol = 1;
  });
  await down(2);
  await wait(200);
  s = await snap("square-reloads-away-from-car");
  assert.match(s.ammo, /RELOADING/);
  await up(2);
  await wait(2500);
  assert.deepEqual(report.errors, []);
} catch (e) {
  report.failure = e.stack;
  process.exitCode = 1;
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await b.close();
}
console.log(
  JSON.stringify({
    checks: report.checks.map((c) => c.name),
    errors: report.errors,
    failure: report.failure,
  }),
);
