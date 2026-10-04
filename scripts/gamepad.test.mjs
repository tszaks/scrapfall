import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { rolldown } from "rolldown";

// The first three tests use synthetic API contracts; the final test uses the
// separately identified player capture and its confirmed label correction.
const bundle = await rolldown({
  input: fileURLToPath(new URL("../src/game/input/gamepad.ts", import.meta.url)),
});
const { output } = await bundle.generate({ format: "esm", codeSplitting: false });
await bundle.close();
const { pollPad } = await import(
  `data:text/javascript;base64,${Buffer.from(output[0].code).toString("base64")}`
);
let time = 100,
  connected = [];
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { getGamepads: () => connected },
});
Object.defineProperty(globalThis, "performance", {
  configurable: true,
  value: { now: () => time },
});
const read = () => {
  time += 10;
  return pollPad();
};
const pad = (id) => ({
  id,
  index: 0,
  connected: true,
  mapping: "standard",
  axes: [0, 0, 0, 0],
  buttons: Array.from({ length: 17 }, () => ({ value: 0, pressed: false })),
});
test("standard analog trigger travel survives the browser pressed threshold for every family", () => {
  for (const id of [
    "DualSense Wireless Controller",
    "Xbox Wireless Controller",
    "Pro Controller",
    "Generic Gamepad",
  ]) {
    const p = pad(id);
    connected = [p];
    read();
    for (const value of [0.01, 0.2, 0.36, 0.5, 0.75, 1, 0.3, 0]) {
      p.buttons[6] = { value, pressed: value > 0.1 };
      p.buttons[7] = { value, pressed: value > 0.1 };
      const f = read();
      assert.equal(f.lt, value, `${id} L2/LT ${value}`);
      assert.equal(f.rt, value, `${id} R2/RT ${value}`);
      assert.equal(f.down[6], value > 0.35);
      assert.equal(f.down[7], value > 0.35);
    }
  }
});
test("standard face, shoulder, stick, d-pad and Options indices are preserved with press/release edges", () => {
  const p = pad("DualSense Wireless Controller");
  connected = [p];
  read();
  for (const i of [0, 1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13, 14, 15, 16]) {
    p.buttons[i] = { value: 1, pressed: true };
    const f = read();
    assert.equal(f.pressed[i], true);
    assert.equal(f.down.filter(Boolean).length, 1);
    assert.equal(read().pressed[i], false);
    p.buttons[i] = { value: 0, pressed: false };
    assert.equal(read().released[i], true);
  }
  p.axes = [0.4, -0.7, -0.2, 0.8];
  const f = read();
  assert.deepEqual([f.lx, f.ly, f.rx, f.ry], p.axes);
});
test("invalid button values cannot poison throttle and disconnect clears held state", () => {
  const p = pad("DualSense");
  connected = [p];
  read();
  for (const [value, expected] of [
    [NaN, 0],
    [Infinity, 0],
    [-1, 0],
    [2, 1],
  ]) {
    p.buttons[7] = { value, pressed: true };
    assert.equal(read().rt, expected);
  }
  connected = [];
  const f = read();
  assert.equal(f.connected, false);
  assert.equal(f.rt, 0);
  assert.equal(f.down.some(Boolean), false);
  assert.equal(f.released[7], true);
});

test("captured Safari DualSense Edge values preserve the standard browser indices", async () => {
  const fixture = JSON.parse(
    await readFile(
      new URL("./fixtures/dualsense-edge-safari26.5-bluetooth.json", import.meta.url),
      "utf8",
    ),
  );
  const p = pad(fixture.id);
  p.mapping = fixture.mapping;
  connected = [p];
  for (const sample of fixture.samples) {
    p.buttons = sample.buttons.map((value, i) => ({ value, pressed: sample.pressed[i] }));
    p.axes = sample.axes;
    const f = read();
    assert.equal(f.type, "ps");
    assert.equal(f.standard, true);
    assert.deepEqual(
      f.down,
      sample.buttons.map((value, i) => value > (i === 6 || i === 7 ? 0.35 : 0.5)),
      sample.label,
    );
    assert.deepEqual([f.lx, f.ly, f.rx, f.ry], sample.axes, sample.label);
    assert.equal(f.lt, sample.buttons[6]);
    assert.equal(f.rt, sample.buttons[7]);
  }
  // The player confirmed these two guided steps were mixed up in the original
  // report; the fixture retains reportedLabel alongside the corrected label.
  assert.equal(fixture.samples.find((s) => s.label === "Options").buttons[9], 1);
  assert.equal(fixture.samples.find((s) => s.label === "Create").buttons[8], 1);
});
