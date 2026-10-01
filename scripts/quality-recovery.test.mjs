import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const source = await readFile(new URL("../src/game/qualityRecovery.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
});
const { QualityRecovery } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);
const before = { tier: "medium", dpr: 1.1 };
test("recovery retains sharper graphics when a 30 Hz cadence and CPU cost remain unchanged", () => {
  const r = new QualityRecovery();
  assert.equal(r.due(29), false);
  assert.equal(r.due(30), true);
  r.begin(30, before, 33.3, 4);
  assert.equal(r.sample(33, 33.4, 4), null);
  assert.equal(r.sample(34, 33.3, 4), null);
  assert.deepEqual(r.sample(35, 33.3, 4), { keep: true, before });
  assert.equal(r.due(64), false);
  assert.equal(r.due(65), true);
});
test("a quality increase that worsens frame time is rolled back", () => {
  const r = new QualityRecovery();
  r.begin(30, before, 33.3, 4);
  r.sample(33, 45, 4);
  r.sample(34, 45, 4);
  assert.deepEqual(r.sample(35, 45, 4), { keep: false, before });
});
test("a cadence-neutral increase that overloads CPU is rolled back", () => {
  const r = new QualityRecovery();
  r.begin(30, before, 33.3, 4);
  r.sample(33, 33, 17);
  r.sample(34, 33, 17);
  assert.equal(r.sample(35, 33, 17).keep, false);
});
test("visibility or loading reset discards a partial probe and delays the next one", () => {
  const r = new QualityRecovery();
  r.begin(30, before, 33, 4);
  r.sample(31, 33, 4);
  r.reset(32);
  assert.equal(r.active, false);
  assert.equal(r.sample(33, 33, 4), null);
  assert.equal(r.due(61), false);
  assert.equal(r.due(62), true);
});

test("recovery waits for three stable slow windows and rejects transient pressure", () => {
  const r = new QualityRecovery();
  assert.equal(r.stableSlow(false, 16.7, 4), false);
  assert.equal(r.stableSlow(true, 33.3, 4), false);
  assert.equal(r.stableSlow(true, 60, 4), false);
  assert.equal(r.stableSlow(true, 33.3, 4), false);
  assert.equal(r.stableSlow(true, 33.4, 4), false);
  assert.equal(r.stableSlow(true, 33.3, 4), true);
  assert.equal(r.stableSlow(true, 33.3, 28), false);
  assert.equal(r.stableSlow(true, 33.3, 4), false);
  r.reset(50);
  assert.equal(r.stableSlow(true, 33.3, 4), false);
});
