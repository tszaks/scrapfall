import test from "node:test";
import assert from "node:assert/strict";
import { rolldown } from "rolldown";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const build = await rolldown({
  input: "body-test",
  plugins: [
    {
      name: "entry",
      resolveId(id) {
        if (id === "body-test") return id;
      },
      load(id) {
        if (id === "body-test")
          return `export * from '${root}src/game/enemyBody.ts'; export * from '${root}src/game/staticCollision.ts'; export {liveCars} from '${root}src/game/trafficCore.ts'; export {BoxGeometry} from 'three';`;
      },
    },
  ],
});
const { output } = await build.generate({ format: "esm", codeSplitting: false });
const p = await import(
  `data:text/javascript;base64,${Buffer.from(output[0].code).toString("base64")}`
);
await build.close();
const blocks = [];
const car = (a = 0) => ({ x: 0, z: 0, sin: Math.sin(a), cos: Math.cos(a), hl: 2.4, hw: 1, h: 1.8 });
test.afterEach(() => {
  p.liveCars.length = 0;
  p.resetStaticCollision();
});
test.after(() => {
  for (const h of process._getActiveHandles()) if (h.constructor.name === "MessagePort") h.unref();
});
test("all ground kinds use physical collision, flying and spectral exceptions remain explicit", () => {
  for (const k of [
    "drifter",
    "brute",
    "boss",
    "gatling",
    "charger",
    "flanker",
    "cloaker",
    "vanguard",
  ])
    assert.equal(p.bodyRule(k), "walk");
  assert.equal(p.bodyRule("hornet"), "fly");
  assert.equal(p.bodyRule("medic"), "fly");
  assert.equal(p.bodyRule("specter"), "ghost");
});
test("a walker cannot enter a stationary or rotated car, including a hollow mesh", () => {
  for (const angle of [0, Math.PI / 4, Math.PI / 2]) {
    p.liveCars[0] = { ...car(angle), contact: () => false };
    assert.equal(p.bodyFree(blocks, 0, 0, 0.6, 2), false);
    assert.equal(p.bodyStepFree(blocks, -5, 0, 5, 0, 0.6, 2), false, "charge cannot tunnel");
    assert.equal(p.bodyFree(blocks, 10, 10, 0.6, 2), true);
  }
});
test("an overlapped enemy can escape a car with small steps at any frame rate", () => {
  p.liveCars[0] = car();
  for (const hz of [30, 60, 120]) {
    let x = 0.4;
    for (let i = 0; i < hz * 3; i++) {
      const next = x + 0.85 / hz;
      assert.equal(
        p.bodyStepFree(blocks, x, 0, next, 0, 0.8, 2),
        true,
        `escape at ${hz}fps, x=${x}`,
      );
      x = next;
    }
    assert.equal(p.trafficDepth(x, 0, 0.8, 0, 2), 0);
  }
  assert.equal(p.bodyStepFree(blocks, 0.4, 0, 0.39, 0, 0.8, 2), false, "cannot go deeper");
});
test("body sweep catches a thin prop on a long charge and allows a clear route around it", () => {
  const wall = new p.BoxGeometry(0.03, 4, 4).translate(2, 2, 0);
  p.registerStaticGeometry("map", [wall]);
  assert.equal(p.bodyStepFree(blocks, 0, 0, 4, 0, 0.6, 2), false);
  assert.equal(p.bodyStepFree(blocks, 0, 4, 4, 4, 0.6, 2), true);
  wall.dispose();
});
