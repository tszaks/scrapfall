import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const source = await readFile(new URL("../src/game/trafficCore.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
});
const { liveCars, trafficStepFree, trafficDepth } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);
const trafficBodyBlocked = (x, z, r, feet, height = 1.8) => trafficDepth(x, z, r, feet, height) > 0;
function car(yaw = 0, x = 0) {
  const sin = Math.sin(yaw),
    cos = Math.cos(yaw);
  const c = {
    driveId: "fixture",
    x,
    z: 0,
    sin,
    cos,
    hl: 2,
    hw: 1,
    h: 1.5,
    contact: () => false, // A hollow rendered shell still has a solid movement hull.
  };
  liveCars.length = 0;
  liveCars.push(c);
  return c;
}
test("stopped car blocks entry from both sides and both ends at rotated headings", () => {
  for (const yaw of [0, Math.PI / 2, 0.7]) {
    const c = car(yaw);
    for (const side of [-1, 1]) {
      assert.equal(
        trafficStepFree(
          c.cos * 1.5 * side,
          -c.sin * 1.5 * side,
          c.cos * 1.3 * side,
          -c.sin * 1.3 * side,
          0.4,
          0,
        ),
        false,
      );
      assert.equal(
        trafficStepFree(
          c.sin * 2.5 * side,
          c.cos * 2.5 * side,
          c.sin * 2.3 * side,
          c.cos * 2.3 * side,
          0.4,
          0,
        ),
        false,
      );
    }
    assert.equal(trafficBodyBlocked(0, 0, 0.4, 0), true);
  }
});
test("walk slides along outside, and jumping above a roof is clear", () => {
  car();
  assert.equal(trafficStepFree(1.5, 0, 1.5, 0.2, 0.4, 0), true);
  assert.equal(trafficStepFree(1.5, 0, 1, 0, 0.4, 1.5), true);
  assert.equal(trafficBodyBlocked(0, 0, 0.4, 1.5), false);
});
test("car arriving around a player allows outward escape but not deeper penetration", () => {
  car();
  assert.equal(trafficStepFree(0.5, 0, 0.7, 0, 0.4, 0), true);
  assert.equal(trafficStepFree(0.5, 0, 0.3, 0, 0.4, 0), false);
  assert.equal(trafficStepFree(0, 0, 0.1, 0, 0.4, 0), true);
  assert.equal(trafficStepFree(0, 0, 0, 0, 0.4, 0), false);
  assert.equal(trafficStepFree(-5, 0, 5, 0, 0.4, 0), false, "long step cannot tunnel");
});
test("live car position moves the obstacle and exit query sees adjacent vehicles", () => {
  const c = car();
  c.x = 10;
  assert.equal(trafficBodyBlocked(0, 0, 0.4, 0), false);
  assert.equal(trafficBodyBlocked(10, 0, 0.4, 0), true);
  assert.equal(trafficStepFree(8.5, 0, 8.7, 0, 0.4, 0), false);
});
