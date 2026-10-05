import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { rolldown } from "rolldown";
const { outputText } = ts.transpileModule(
  await readFile(new URL("../src/game/vehicleControls.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } },
);
const v = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const release = () => v.stepVehicleEntry(0.016, "", false, false);
const hold = (target, seconds) => {
  let fired = 0;
  for (let t = 0; t < seconds; t += 0.01)
    if (v.stepVehicleEntry(0.01, target, true, t === 0)) fired++;
  return fired;
};
test.beforeEach(() => {
  v.resetVehicleEntry();
  release();
});
test("partial entry cancels on release; full hold fires once until released", () => {
  assert.equal(hold("one", 0.3), 0);
  assert.ok(v.vehicleEntry.progress > 0);
  release();
  assert.equal(v.vehicleEntry.progress, 0);
  assert.equal(hold("one", 2), 1);
  assert.equal(v.vehicleEntry.requested, "one");
  release();
  assert.equal(hold("one", 0.7), 1);
});
test("target loss/change and pause reset require release and a new hold", () => {
  for (const next of ["", "two"]) {
    release();
    hold("one", 0.3);
    assert.equal(v.stepVehicleEntry(0.1, next, true, false), false);
    assert.equal(v.vehicleEntry.progress, 0);
    assert.equal(hold("two", 1), 0);
  }
  release();
  hold("one", 0.3);
  v.resetVehicleEntry();
  assert.equal(hold("one", 1), 0);
  release();
  assert.equal(hold("one", 0.7), 1);
});
test("button held before approaching cannot automatically enter a car", () => {
  assert.equal(v.stepVehicleEntry(0.1, "", true, true), false);
  for (let i = 0; i < 20; i++) assert.equal(v.stepVehicleEntry(0.1, "one", true, false), false);
  assert.equal(v.vehicleEntry.progress, 0);
});
test("analog throttle accelerates smoothly; coasting slows gradually", () => {
  let half = 0,
    full = 0;
  for (let i = 0; i < 120; i++) {
    half = v.vehicleSpeed(half, 0.5, 0, 22, 1 / 60);
    full = v.vehicleSpeed(full, 1, 0, 22, 1 / 60);
  }
  assert.ok(half > 5 && half < 7);
  assert.ok(full > 11 && full < 13);
  const coast = v.vehicleSpeed(full, 0, 0, 22, 1);
  assert.ok(coast < full && coast > full - 3);
});
test("both pedals brake; holding L2 alone eases into reverse", () => {
  let speed = 20;
  for (let i = 0; i < 300; i++) speed = v.vehicleSpeed(speed, 1, 1, 22, 1 / 60);
  assert.equal(speed, 0);
  assert.equal(v.vehicleSpeed(0, 0, 1, 22, 1 / 60), -3.5 / 60);
  assert.ok(v.vehicleSpeed(0, -1, 0, 22, 1) < 0, "keyboard reverse remains explicit");
});
test("invalid network values cannot poison vehicle motion", () =>
  assert.equal(v.vehicleSpeed(0, NaN, Infinity, 22, 0.1), 0));

test("right steering follows the vehicle frame in forward and reverse, at every heading", () => {
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    for (const speed of [6, -6]) {
      for (const steer of [-1, 1]) {
        const next = v.vehicleTurn(yaw, steer, speed, 0.1);
        const dx = Math.sin(next) * speed,
          dz = Math.cos(next) * speed;
        const driverRight = dx * -Math.cos(yaw) + dz * Math.sin(yaw);
        assert.equal(Math.sign(driverRight), steer);
        assert.equal(Math.sign(next - yaw), -steer * Math.sign(speed));
      }
    }
  }
  assert.equal(v.vehicleTurn(1, 1, 0, 1), 1, "stationary car does not pivot");
});

for (const hz of [30, 60, 120]) {
  test(`held L2/S and R2/W stop before changing direction at ${hz} Hz`, () => {
    let trigger = 12,
      keyboard = 12,
      sawZero = false;
    for (let i = 0; i < hz * 5; i++) {
      const before = trigger;
      trigger = v.vehicleSpeed(trigger, 0, 0.7, 22, 1 / hz);
      keyboard = v.vehicleSpeed(keyboard, -0.7, 0, 22, 1 / hz);
      assert.equal(trigger, keyboard);
      if (trigger === 0) sawZero = true;
      if (before > 0) assert.ok(trigger >= 0, "braking frame cannot cross zero");
    }
    assert.ok(sawZero && trigger < -4 && trigger >= -8);
    sawZero = false;
    for (let i = 0; i < hz * 3; i++) {
      const before = trigger;
      trigger = v.vehicleSpeed(trigger, 0.6, 0, 22, 1 / hz);
      if (trigger === 0) sawZero = true;
      if (before < 0) assert.ok(trigger <= 0);
    }
    assert.ok(sawZero && trigger > 0);
  });
}
test("reverse pressure stays analog and stale inputs only brake", () => {
  let half = 0,
    full = 0;
  for (let i = 0; i < 120; i++) {
    half = v.vehicleSpeed(half, 0, 0.5, 22, 1 / 60);
    full = v.vehicleSpeed(full, 0, 1, 22, 1 / 60);
  }
  assert.ok(full < half && Math.abs(full - half * 2) < 1e-8);
  for (const start of [-10, 0, 10]) {
    let speed = start;
    for (let i = 0; i < 300; i++) speed = v.vehicleSpeed(speed, 0, 1, 22, 1 / 60, true);
    assert.equal(speed, 0);
  }
});

test("pause invalidates fresh guest pedals without changing velocity or ownership", async () => {
  const mocks = {
    "./level": "export const boundaryBlocked=()=>false;",
    "./staticCollision": "export const staticBody=()=>false;",
    "./terrain": "export const baseGroundY=()=>0, terrainStep=()=>true;",
    "./trafficCore": "export const liveCars=[], trafficDepth=()=>0;",
  };
  const bundle = await rolldown({
    input: new URL("../src/game/driving.ts", import.meta.url).pathname,
    platform: "node",
    plugins: [{
      name: "empty-road",
      resolveId(id) { if (id in mocks) return "\0" + id; },
      load(id) { return mocks[id.slice(1)]; },
    }],
  });
  const { output } = await bundle.generate({ format: "esm" });
  await bundle.close();
  const d = await import(`data:text/javascript;base64,${Buffer.from(output[0].code).toString("base64")}`);
  const car = d.registerDriveCar("guest-car", 2, 1, 1.5);
  car.claimed = true;
  car.owner = "guest";
  for (const speed of [0, -6, 6]) {
    car.speed = speed;
    d.driveInput("guest", 0, 0.5, 0.25);
    assert.ok(performance.now() - car.inputAt < 500);
    d.clearDriveInputs();
    assert.equal(car.owner, "guest");
    assert.equal(car.speed, speed);
    assert.equal(car.gas, 0);
    assert.equal(car.brake, 0);
    assert.equal(car.steer, 0);
    d.stepDriving(1 / 60, []);
    assert.ok(Math.abs(car.speed) <= Math.abs(speed));
    if (speed === 0) assert.equal(car.speed, 0, "short pause cannot reuse held L2 to reverse");
    else assert.equal(Math.sign(car.speed), Math.sign(speed));
  }
  car.speed = 0;
  d.driveInput("guest", 0, 0, 0.25);
  d.stepDriving(1 / 60, []);
  assert.equal(car.speed, -3.5 * 0.25 / 60, "fresh rearmed input retains analog pressure");
});
