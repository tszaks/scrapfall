import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const source = await readFile(new URL("../src/game/themes.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
});
const { THEMES, offered, playableTheme } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);
const nuke = THEMES.findIndex((t) => t.name === "Nuketown");
test("public builds reject development maps through direct choice and room seed", () => {
  assert.ok(nuke >= 0);
  for (const seed of [nuke, THEMES.length * 73 + nuke]) {
    assert.equal(playableTheme(seed, true, null, false).name, "Vice Heights");
    assert.equal(playableTheme(seed, false, nuke, false).name, "Vice Heights");
  }
  assert.equal(THEMES.filter(offered).length, 4);
  assert.equal(offered(THEMES[nuke]), false);
});
test("development builds retain Nuketown without changing map indices", () => {
  assert.equal(playableTheme(nuke, true, null, true), THEMES[nuke]);
  assert.equal(playableTheme(7, false, nuke, true), THEMES[nuke]);
  for (let i = 0; i < THEMES.length; i++) {
    if (!THEMES[i].wip) assert.equal(playableTheme(i, true, null, false), THEMES[i]);
  }
});
