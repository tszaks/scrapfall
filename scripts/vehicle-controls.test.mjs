import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
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
test("brakes win over throttle, reach zero and never engage reverse", () => {
  let speed = 20;
  for (let i = 0; i < 300; i++) speed = v.vehicleSpeed(speed, 1, 1, 22, 1 / 60);
  assert.equal(speed, 0);
  assert.equal(v.vehicleSpeed(0, 0, 1, 22, 1), 0);
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
