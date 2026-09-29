import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { rolldown } from "rolldown";

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

test("Dry Gulch's reserved landmarks exist on every seed", async () => {
  // The western layout graph is pure data (no three.js): bundle it once with the
  // project's bundler, then build the co-op-size town for seeds 1-50.
  const bundle = await rolldown({
    input: fileURLToPath(new URL("../src/game/western/layout.ts", import.meta.url)),
  });
  const { output } = await bundle.generate({ format: "esm" });
  const western = await import(
    `data:text/javascript;base64,${Buffer.from(output[0].code).toString("base64")}`
  );
  const rng = (seed) => {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  // walk-ins by kind (the general store is the walk-in "store"); named landmarks by sign
  const W = western.W;
  const FIXED = ["HOTEL", "OPERA HOUSE"];
  for (let seed = 1; seed <= 50; seed++) {
    const { layout } = western.generateWestern(rng(seed), 400, 400);
    for (const t of ["store", "saloon", "bank", "sheriff", "stable"])
      assert.ok(
        layout.buildings.some((b) => b.t === t && b.walkIn),
        `seed ${seed}: walk-in ${t} missing`,
      );
    for (const name of FIXED)
      assert.ok(
        layout.buildings.some((b) => b.sign === W[name]),
        `seed ${seed}: ${name} missing`,
      );
    // the saloon's balcony stair must be wired, or the STAIRS marker leads nowhere
    const st = layout.saloonStairs;
    assert.ok(st, `seed ${seed}: saloon stairs missing`);
    // and its alley lane stays clear: no neighbor wall, prop or post stands in it
    // (the strip's inner edge kisses the saloon wall — the margin goes on the far side)
    const salB = layout.buildings.find((b) => b.t === "saloon");
    const lx0 = st.x0 - (salB && salB.x1 <= st.x0 ? 0.02 : 0.2),
      lx1 = st.x1 + (salB && salB.x0 >= st.x1 ? 0.02 : 0.2),
      lz0 = Math.min(st.zBottom, st.zEdge) - 0.6,
      lz1 = Math.max(st.zBottom, st.zEdge) + 0.6;
    const inLane = (x, z) => x > lx0 && x < lx1 && z > lz0 && z < lz1;
    for (const b of layout.buildings)
      assert.ok(
        b.x0 >= lx1 || b.x1 <= lx0 || b.z0 >= lz1 || b.z1 <= lz0,
        `seed ${seed}: ${b.t} (${b.x0}..${b.x1}, ${b.z0}..${b.z1}) blocks the stair lane`,
      );
    for (const q of layout.props)
      assert.ok(!inLane(q.x, q.z), `seed ${seed}: ${q.k} prop in the stair lane at ${q.x},${q.z}`);
    for (const q of layout.posts)
      assert.ok(
        !inLane(q.x, q.z) || q.r <= 0.08,
        `seed ${seed}: post in the stair lane at ${q.x},${q.z} r=${q.r}`,
      );
  }
});
