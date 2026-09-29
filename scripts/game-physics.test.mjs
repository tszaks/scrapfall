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
const { connectionTimedOut } = await pureModule("../src/game/netHeartbeat.ts");
const close = (actual, expected, label) =>
  assert.ok(Math.abs(actual - expected) < 1e-8, `${label}: ${actual} vs ${expected}`);

test("joining survives world construction but an absent peer still times out", () => {
  // The recorded join blocked its event loop for4.6s; slightly slower devices
  // cross the old5s limit before they can send their first heartbeat.
  assert.equal(connectionTimedOut(6_000, 0, 0, 5_000), false);
  assert.equal(connectionTimedOut(12_000, 0, 0, 8_000), false);
  assert.equal(connectionTimedOut(15_000, 0, 0, 5_000), true);
  assert.equal(connectionTimedOut(15_000, 14_000, 0, 5_000), false);
});

test("established connections retain host and guest silence limits", () => {
  assert.equal(connectionTimedOut(30_000, 25_000, 0, 5_000), false);
  assert.equal(connectionTimedOut(30_001, 25_000, 0, 5_000), true);
  assert.equal(connectionTimedOut(33_000, 25_000, 0, 8_000), false);
  assert.equal(connectionTimedOut(33_001, 25_000, 0, 8_000), true);
  // A late join gets its own grace window, independent of the host's age.
  assert.equal(connectionTimedOut(106_000, 100_000, 100_000, 5_000), false);
});

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

const pierDoors = await pureModule("../src/game/beach/doorways.ts");
const intersects = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;
test("Pier arcade reserves the entire exit including a stall canopy", () => {
  const door = pierDoors.beachDoorApproach({ x0: -76, x1: -44, z0: -30, z1: -14, front: 2 });
  assert.ok(intersects(door, pierDoors.beachStallBounds({ x0: -60, x1: -54, z0: -12, z1: -8 })));
  assert.ok(door.x0 <= -62.8 && door.x1 >= -57.2, "room opening plus player shoulders");
  assert.ok(door.z1 >= -10, "approach extends beyond the blocked production exit");
});
test("Pier doorway reservations follow all four facade orientations", () => {
  const box = { x0: 10, x1: 30, z0: 40, z1: 60 };
  for (const [front, x, z] of [
    [0, 20, 37],
    [1, 33, 50],
    [2, 20, 63],
    [3, 7, 50],
  ]) {
    const door = pierDoors.beachDoorApproach({ ...box, front });
    assert.ok(x > door.x0 && x < door.x1 && z > door.z0 && z < door.z1);
    assert.equal(
      intersects(door, { x0: 19, x1: 21, z0: 49, z1: 51 }),
      false,
      "centre remains available for furnishing",
    );
  }
});
test("Pier swim boundary has a continuous four-metre float rhythm outside the deck", () => {
  for (const half of [280, 400]) {
    const points = pierDoors.swimLineBuoys(half);
    assert.ok(points.includes(-36) && points.includes(36), "line reaches both pier shoulders");
    assert.equal(new Set(points).size, points.length);
    for (let i = 1; i < points.length; i++)
      assert.ok(points[i] - points[i - 1] <= 4 || (points[i - 1] === -36 && points[i] === 36));
  }
});
