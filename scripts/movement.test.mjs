import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const src = await readFile(new URL("../src/game/input/movement.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(src, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
});
const m = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
test("middle movement pace preserves sprint ratios and jump height", () => {
  assert.equal(m.SPEED.run, 4.6);
  assert.ok(Math.abs(m.TACTICAL_MPS - 8.74) < 1e-9);
  assert.ok(Math.abs(m.SPRINT_MPS / m.SPEED.run - 1.5) < 1e-9);
  assert.ok(Math.abs(m.MOVE.jumpV ** 2 / (2 * m.SPEED.gravity) - 1.45) < 1e-9);
  for (const old of [1.4, 2.6, 4.3, 5])
    assert.ok(Math.abs(m.chase(old) - Math.round(((old * 3.7) / 7) * 100) / 100) < 1e-9);
});
test("existing warnings keep at least the prior escape distance", () => {
  assert.equal(m.HAZARD_WARNING_SCALE, 7 / 3.7);
  for (const warning of [5, 11])
    assert.ok(warning * m.HAZARD_WARNING_SCALE * m.SPRINT_MPS >= warning * 10.5);
});
