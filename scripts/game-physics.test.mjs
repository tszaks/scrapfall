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
  const speed = 600,
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
  assert.ok(height(300) < 1.0, "long range requires aiming higher");
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
  // the generator's map imports are dynamic; inline them so the whole graph lands in
  // one data:-URL module
  const { output } = await bundle.generate({
    format: "esm",
    codeSplitting: false,
  });
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
  // generateWestern is a coroutine now (it yields between chunks so the browser can
  // breathe); in a test just drain it synchronously
  const drain = (g) => {
    let r = g.next();
    while (!r.done) r = g.next();
    return r.value;
  };
  // both grid sizes: the town core is fixed-position but the collision cell grid
  // shifts with the arena, so a flush wall's block can graze a corridor on one
  // size and not the other
  for (const size of [400, 520])
  for (let seed = 1; seed <= 50; seed++) {
    const { layout, blocks } = drain(western.generateWestern(rng(seed), size, size));
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
    // nothing blocks a crossing: no clutter prop on a deck or within the 14 m end
    // aprons (the spec calls for 10 m clear), and no post stands in the walkable
    // lane between the rails. The bridge's own rails and mouth lamps (tag
    // "bridge") are furniture, not clutter.
    const inKeep = (x, z, d) =>
      (x > d.x0 - 0.4 && x < d.x1 + 0.4 && z > d.z0 - 0.4 && z < d.z1 + 0.4) ||
      (x > d.x0 - 2.4 && x < d.x1 + 2.4 && z > d.z0 - 14 && z < d.z0 + 0.6) ||
      (x > d.x0 - 2.4 && x < d.x1 + 2.4 && z > d.z1 - 0.6 && z < d.z1 + 14);
    for (const d of layout.decks.filter((d) => d.axis === "z")) {
      const clog = layout.props.find((p) => p.tag !== "bridge" && inKeep(p.x, p.z, d));
      assert.ok(!clog, `seed ${seed}: ${clog?.k} clutters the bridge approach at ${clog?.x},${clog?.z}`);
      const pole = layout.posts.find(
        (p) =>
          p.x > d.x0 + 0.75 &&
          p.x < d.x1 - 0.75 &&
          p.z > d.z0 - 14 &&
          p.z < d.z1 + 14 &&
          Math.abs(p.x - (d.x0 + 0.6)) > 0.15 &&
          Math.abs(p.x - (d.x1 - 0.6)) > 0.15,
      );
      assert.ok(!pole, `seed ${seed}: post at ${pole?.x},${pole?.z} blocks a bridge lane`);
    }
    // the strip between two buildings' facing backs is a shared alley lane: clutter
    // may hug a wall but must never pile up enough to seal it mid-block (seed 7's
    // store alley walled shut with crates)
    const strips = [];
    for (const a of layout.buildings) {
      if (a.front === 2)
        for (const b of layout.buildings) {
          if (b.front !== 0) continue;
          const gap = a.z0 - b.z1;
          // a gap under ~3 m is a dead crevice, not a lane — junk may fill it
          if (gap < 3 || gap > 8) continue;
          const x0 = Math.max(a.x0, b.x0),
            x1 = Math.min(a.x1, b.x1);
          if (x1 - x0 < 3) continue;
          strips.push({ x0: x0 + 0.15, z0: b.z1 + 0.1, x1: x1 - 0.15, z1: a.z0 - 0.1, ax: "z" });
        }
      if (a.front === 3)
        for (const b of layout.buildings) {
          if (b.front !== 1) continue;
          const gap = b.x0 - a.x1;
          if (gap < 3 || gap > 8) continue;
          const z0 = Math.max(a.z0, b.z0),
            z1 = Math.min(a.z1, b.z1);
          if (z1 - z0 < 3) continue;
          strips.push({ x0: a.x1 + 0.1, z0: z0 + 0.15, x1: b.x0 - 0.1, z1: z1 - 0.15, ax: "x" });
        }
    }
    // a lane may slalom around wall-hugging junk — the invariant is connectivity: an
    // open end must reach the other open end on ~0.3 m cells (player radius 0.45).
    // Overhead wire (clotheslines) and lanterns don't block walking.
    for (const s of strips) {
      const nb = layout.buildings.filter(
        (b) => b.x1 > s.x0 - 1 && b.x0 < s.x1 + 1 && b.z1 > s.z0 - 1 && b.z0 < s.z1 + 1,
      );
      const np = layout.props.filter(
        (p) =>
          p.k !== "clothesline" &&
          p.k !== "lantern" &&
          p.x > s.x0 - 2 && p.x < s.x1 + 2 && p.z > s.z0 - 2 && p.z < s.z1 + 2,
      );
      const ns = layout.posts.filter(
        (p) => p.r > 0.12 && p.x > s.x0 - 2 && p.x < s.x1 + 2 && p.z > s.z0 - 2 && p.z < s.z1 + 2,
      );
      const cellFree = (x, z) => {
        for (const b of nb)
          if (x > b.x0 - 0.2 && x < b.x1 + 0.2 && z > b.z0 - 0.2 && z < b.z1 + 0.2)
            return false;
        for (const p of np) if (Math.hypot(p.x - x, p.z - z) < 0.75) return false;
        for (const p of ns) if (Math.hypot(p.x - x, p.z - z) < p.r + 0.35) return false;
        return true;
      };
      const step = 0.3,
        nx = Math.floor((s.x1 - s.x0) / step),
        nz = Math.floor((s.z1 - s.z0) / step);
      if (nx < 2 || nz < 2) continue;
      const blocked = (ix, iz) =>
        !cellFree(s.x0 + (ix + 0.5) * step, s.z0 + (iz + 0.5) * step);
      const grid = Array.from({ length: nx }, (_, ix) =>
        Array.from({ length: nz }, (_, iz) => blocked(ix, iz)),
      );
      let built = 0;
      for (const col of grid) for (const c of col) if (c) built++;
      if (built / (nx * nz) > 0.4) continue; // an intruding wall crosses it — not a lane
      // lane runs along x for z-gap pairs, along z for x-gap pairs
      const ends =
        s.ax === "z"
          ? [
              grid[0].map((c, iz) => (c ? -1 : iz)).filter((i) => i >= 0),
              grid[nx - 1].map((c, iz) => (c ? -1 : iz)).filter((i) => i >= 0),
            ]
          : [
              grid.map((c, ix) => (c[0] ? -1 : ix)).filter((i) => i >= 0),
              grid.map((c, ix) => (c[nz - 1] ? -1 : ix)).filter((i) => i >= 0),
            ];
      if (!ends[0].length || !ends[1].length) continue; // blind seam, no through-lane
      const seen = new Set(),
        queue = [];
      for (const e of ends[0])
        queue.push(s.ax === "z" ? [0, e] : [e, 0]);
      let through = false;
      while (queue.length) {
        const [ix, iz] = queue.pop();
        const key = ix * 4096 + iz;
        if (seen.has(key) || ix < 0 || iz < 0 || ix >= nx || iz >= nz || grid[ix][iz])
          continue;
        seen.add(key);
        if (
          (s.ax === "z" && ix === nx - 1 && ends[1].includes(iz)) ||
          (s.ax === "x" && iz === nz - 1 && ends[1].includes(ix))
        ) {
          through = true;
          break;
        }
        queue.push([ix + 1, iz], [ix - 1, iz], [ix, iz + 1], [ix, iz - 1]);
      }
      assert.ok(
        through,
        `seed ${seed}: back lane sealed at ${s.x0.toFixed(1)},${s.z0.toFixed(1)}`,
      );
    }
    // nothing may sit across a walk-in's doorway — the corridors (front AND back)
    // are reserved on layout.doorZones. No building may intrude: the corridor's
    // owner legitimately overlaps a 0.2 m sliver at its own wall, so find it as
    // the building containing one of the zone's shallow edge midpoints.
    for (const z of layout.doorZones) {
      const cx = (z.x0 + z.x1) / 2,
        cz = (z.z0 + z.z1) / 2;
      const owner = layout.buildings.find((b) =>
        [
          [cx, z.z0 + 0.1],
          [cx, z.z1 - 0.1],
          [z.x0 + 0.1, cz],
          [z.x1 - 0.1, cz],
        ].some(([px, pz]) => px > b.x0 && px < b.x1 && pz > b.z0 && pz < b.z1),
      );
      assert.ok(
        owner,
        `seed ${seed} size ${size}: door corridor at ${z.x0.toFixed(1)},${z.z0.toFixed(1)} has no owner`,
      );
      const intruder = layout.buildings.find(
        (b) => b !== owner && b.x1 > z.x0 && b.x0 < z.x1 && b.z1 > z.z0 && b.z0 < z.z1,
      );
      assert.ok(
        !intruder,
        `seed ${seed} size ${size}: ${intruder?.t} (${intruder?.x0.toFixed(1)}..${intruder?.x1.toFixed(1)}, ${intruder?.z0.toFixed(1)}..${intruder?.z1.toFixed(1)}) sits in a door corridor`,
      );
      // and no collision cell may reach into it either (blocks are 2 m cells)
      const block = blocks.find(
        (b) => b.x + 1 > z.x0 && b.x - 1 < z.x1 && b.z + 1 > z.z0 && b.z - 1 < z.z1,
      );
      assert.ok(
        !block,
        `seed ${seed} size ${size}: collision block at ${block?.x},${block?.z} intrudes on a door corridor`,
      );
    }
    // check each prop's full footprint, not just its centre (the
    // half-extents mirror approachFoot in layout.ts)
    const HALF = {
      crate: [0.5, 0.5],
      crates: [1.1, 1.3],
      barrel: [0.5, 0.5],
      barrels: [0.9, 0.9],
      trough: [1.3, 0.5],
      streetlamp: [0.28, 0.28],
      bench: [1, 0.4],
      sacks: [0.7, 0.7],
      woodpile: [1.3, 0.8],
      outhouse: [0.9, 0.9],
      hay: [0.75, 0.5],
      brokencrate: [0.6, 0.6],
      brokenbarrel: [0.6, 0.5],
      anvil: [0.4, 0.45],
      wheel: [0.7, 0.2],
      wagon: [1.1, 2.6],
      covered: [1.1, 2.6],
      cart: [0.8, 1.7],
      horse: [0.6, 1.6],
    };
    for (const z of layout.doorZones) {
      const bad = layout.props.find((p) => {
        // lanterns/clotheslines hang overhead; straw is loose ground litter — none can
        // block a doorway
        if (p.k === "lantern" || p.k === "clothesline" || p.k === "straw") return false;
        const h = p.k === "hitch" ? [p.s / 2, 0.2] : (HALF[p.k] ?? [0.4, 0.4]);
        const cs = Math.abs(Math.cos(p.rot)),
          sn = Math.abs(Math.sin(p.rot));
        const hw = (h[0] * cs + h[1] * sn) * (p.k === "hitch" ? 1 : p.s),
          hd = (h[0] * sn + h[1] * cs) * (p.k === "hitch" ? 1 : p.s);
        return p.x + hw > z.x0 && p.x - hw < z.x1 && p.z + hd > z.z0 && p.z - hd < z.z1;
      });
      assert.ok(
        !bad,
        `seed ${seed}: ${bad?.k} at ${bad?.x.toFixed(1)},${bad?.z.toFixed(1)} blocks a walk-in door`,
      );
    }
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
