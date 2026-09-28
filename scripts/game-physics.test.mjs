import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// These pure modules have no runtime imports. Transpile with the project's existing
// compiler so the regression checks also run on the supported Node 20 runtime.
async function pureModule(path) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}
const physics = await pureModule("../src/game/ballistics.ts");
const weather = await pureModule("../src/game/matchEnvironment.ts");
const close = (actual, expected, label) =>
  assert.ok(Math.abs(actual - expected) < 1e-8, `${label}: ${actual} vs ${expected}`);

test("gravity integration preserves the same trajectory across frame rates", () => {
  for (const hz of [20, 30, 60, 120]) {
    const p = { x: 3, y: 12, z: -5 },
      v = { x: 17, y: 4, z: -8 };
    for (let i = 0; i < hz * 2; i++) physics.advanceBallistic(p, v, 4.8, 1 / hz);
    close(p.x, 37, "horizontal travel");
    close(p.z, -21, "depth travel");
    close(p.y, 10.4, "analytic drop");
    close(v.y, -5.6, "vertical velocity");
  }
});

test("sight zero is reached at fixed speed for level, uphill and downhill shots", () => {
  for (const speed of [24, 40, 120])
    for (const gravity of [0, 0.65, 3, 4.8]) {
      for (const pitch of [-1.2, 0, 1.2]) {
        const from = { x: 0.3, y: 1.32, z: -0.75 };
        const target = { x: 0, y: 1.6 + Math.sin(pitch) * 30, z: -Math.cos(pitch) * 30 };
        const dir = physics.ballisticDirection({ x: 0, y: 0, z: 0 }, from, target, speed, gravity);
        close(Math.hypot(dir.x, dir.y, dir.z), 1, "unit launch direction");
        const flight = (target.z - from.z) / (dir.z * speed);
        assert.ok(flight > 0, "forward flight");
        close(from.x + dir.x * speed * flight, target.x, "zero x");
        close(from.y + dir.y * speed * flight - 0.5 * gravity * flight ** 2, target.y, "zero y");
      }
    }
});

test("Longshot has a 50m zero and drops below that sight line farther away", () => {
  const speed = 120,
    gravity = physics.bulletGravity(19);
  assert.ok(gravity > 0);
  const from = { x: 0, y: 1.6, z: 0 },
    target = { x: 0, y: 1.6, z: -50 };
  const dir = physics.ballisticDirection({ x: 0, y: 0, z: 0 }, from, target, speed, gravity);
  const height = (distance) => {
    const t = -distance / (dir.z * speed);
    return from.y + dir.y * speed * t - 0.5 * gravity * t * t;
  };
  close(height(50), 1.6, "sniper zero");
  assert.ok(height(150) < 1.4, "long range requires aiming higher");
});

test("unreachable and degenerate sight inputs remain finite", () => {
  const origin = { x: 0, y: 0, z: 0 };
  for (const target of [{ x: 5000, y: 5000, z: 0 }, { x: 0, y: 5000, z: 0 }, origin]) {
    for (const speed of [0, 10]) {
      const d = physics.ballisticDirection({ x: 0, y: 0, z: 0 }, origin, target, speed, 4.8);
      assert.ok(Object.values(d).every(Number.isFinite));
    }
  }
});

test("shared seed deterministically selects all four weather conditions", () => {
  const counts = Object.fromEntries(weather.ENVIRONMENTS.map((k) => [k, 0]));
  for (let seed = 0; seed < 10000; seed++) {
    weather.configureEnvironment(seed);
    const first = weather.matchEnvironment.kind;
    weather.configureEnvironment(seed);
    assert.equal(weather.matchEnvironment.kind, first);
    counts[first]++;
  }
  for (const n of Object.values(counts)) assert.ok(n > 2000 && n < 3000);
});

test("co-op ignores local URL overrides while solo diagnostics may select weather", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  try {
    weather.configureEnvironment(42);
    const shared = weather.matchEnvironment.kind;
    for (const kind of weather.ENVIRONMENTS) {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: { location: { search: `?weather=${kind}&time=night` } },
      });
      weather.configureEnvironment(42, false);
      assert.equal(weather.matchEnvironment.kind, shared);
      weather.configureEnvironment(42, true);
      assert.equal(weather.matchEnvironment.kind, kind);
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else delete globalThis.window;
  }
});
