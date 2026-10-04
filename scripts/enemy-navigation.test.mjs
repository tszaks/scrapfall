import test from "node:test";
import assert from "node:assert/strict";
import { rolldown } from "rolldown";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const build = await rolldown({
  input: "navigation-test",
  plugins: [
    {
      name: "entry",
      resolveId(id) {
        if (id === "navigation-test") return id;
      },
      load(id) {
        if (id === "navigation-test")
          return `export * from '${root}src/game/level.ts'; export * from '${root}src/game/navigation.ts'; export * from '${root}src/game/pursuitDetour.ts'; export * from '${root}src/game/pursuitSteering.ts'; export * from '${root}src/game/enemyAI.ts'; export * from '${root}src/game/enemyBody.ts'; export * from '${root}src/game/steerCache.ts'; export * from '${root}src/game/staticCollision.ts'; export {setTerrain} from '${root}src/game/terrain.ts'; export {BoxGeometry} from 'three';`;
      },
    },
  ],
});
const { output } = await build.generate({ format: "esm", codeSplitting: false });
const p = await import(
  `data:text/javascript;base64,${Buffer.from(output[0].code).toString("base64")}`
);
await build.close();
test.afterEach(() => {
  p.setPosts(null);
  p.setTerrain(null);
  p.resetStaticCollision();
});
test.after(() => {
  for (const h of process._getActiveHandles()) if (h.constructor.name === "MessagePort") h.unref();
});

function fixture() {
  p.setArenaSize(64, 2);
  p.setPosts(null);
  p.setTerrain(null);
  return Array.from({ length: 10 }, (_, i) => ({ x: 1, z: -9 + i * 2, h: 1.3, tone: 0 }));
}
function chase(blocks, corrected, moveTarget = false) {
  const nav = p.solidGrid(blocks);
  if (corrected) p.connectNavigation(nav, blocks);
  const e = { x: -12, z: 0 },
    target = { x: 12, z: 0 },
    out = { x: 0, z: 0 };
  let field,
    key,
    maxStill = 0,
    still = 0,
    distance = 0;
  const probe = {
    los: () => p.clearLine(blocks, e.x, e.z, target.x, target.z, 0.54),
    route: () => p.nextWaypoint(nav, field, e.x, e.z, out),
    ...(corrected
      ? { refine: (point) => p.pursuitSteering(e, target, point, clock, blocks, 0.6, 2) }
      : {}),
  };
  let clock = 0;
  const dt = 1 / 30,
    speed = 1.3;
  for (let frame = 0; frame < 30 * 90; frame++) {
    if (moveTarget && frame === 30 * 8) {
      target.x = -10;
      target.z = 16;
    }
    const [i, j] = p.navTarget(nav, target.x, target.z, blocks),
      k = i * nav.n + j;
    if (k !== key) {
      key = k;
      field = p.flowField(nav, i, j);
    }
    clock = frame * dt;
    const wp = p.steerTo(e, target, clock, probe);
    const dx = wp.x - e.x,
      dz = wp.z - e.z,
      d = Math.hypot(dx, dz);
    const step = Math.min(speed * dt, d);
    const nx = e.x + (dx / (d || 1)) * step,
      nz = e.z + (dz / (d || 1)) * step;
    const ox = e.x,
      oz = e.z;
    if (
      p.navigationLine(blocks, e.x, e.z, nx, e.z, 0.6) &&
      p.bodyStepFree(blocks, e.x, e.z, nx, e.z, 0.6, 2)
    )
      e.x = nx;
    if (
      p.navigationLine(blocks, e.x, e.z, e.x, nz, 0.6) &&
      p.bodyStepFree(blocks, e.x, e.z, e.x, nz, 0.6, 2)
    )
      e.z = nz;
    const moved = Math.hypot(e.x - ox, e.z - oz);
    distance += moved;
    still = moved < 1e-5 ? still + dt : 0;
    maxStill = Math.max(maxStill, still);
    assert.equal(
      p.blocked(blocks, e.x, e.z, 0.6),
      false,
      "every traversed body position remains clear",
    );
    if (Math.hypot(e.x - target.x, e.z - target.z) < 1)
      return { converged: true, seconds: (frame + 1) * dt, maxStill, distance };
  }
  return { converged: false, seconds: 90, maxStill, distance };
}

test("thin fence: validated links converge around the end instead of parking against it", () => {
  const blocks = fixture();
  const before = chase(blocks, false),
    after = chase(blocks, true);
  console.log(JSON.stringify({ case: "thin-fence", before, after }));
  assert.equal(before.converged, false, "fixture reproduces old route failure");
  assert.equal(after.converged, true);
  assert.ok(after.maxStill < 0.5);
});
test("pursuit replans after a target moves to the other fence end", () => {
  const blocks = fixture();
  const result = chase(blocks, true, true);
  console.log(JSON.stringify({ case: "moving-target", ...result }));
  assert.equal(result.converged, true);
  assert.ok(result.maxStill < 0.5);
});
test("thin collision posts cut coarse navigation links even with empty block cells", () => {
  fixture();
  p.setPosts(Array.from({ length: 49 }, (_, i) => ({ x: 0, z: -8 + i / 3, r: 0.18 })));
  const nav = p.connectNavigation(p.solidGrid([]), []);
  for (let i = 0; i < nav.n; i++)
    for (let j = 0; j < nav.n; j++) {
      const k = i * nav.n + j;
      p.NAV_DIRS.forEach(([di, dj], d) => {
        if (!(nav.links[k] & (1 << d))) return;
        const nk = (i + di) * nav.n + j + dj;
        assert.ok(p.navigationLine([], nav.px[k], nav.pz[k], nav.px[nk], nav.pz[nk], 0.6));
      });
    }
  const result = chase([], true);
  console.log(JSON.stringify({ case: "picket-fence", ...result }));
  assert.equal(result.converged, true);
  assert.ok(result.maxStill < 0.5);
});
test("an unreachable flow field does not fabricate a cell-centre waypoint", () => {
  fixture();
  const nav = p.connectNavigation(p.solidGrid([]), []),
    out = { x: 0, z: 0 };
  assert.equal(
    p.nextWaypoint(nav, new Float32Array(nav.n * nav.n).fill(Infinity), 3.2, 4.1, out),
    null,
  );
});

test("full bodies retain a detour around a mesh fence; elite clearance is respected", () => {
  fixture();
  p.registerStaticGeometry("map", [new p.BoxGeometry(0.15, 3, 12).translate(0, 1.5, 0)]);
  for (const radius of [0.6, 0.96, 1.5]) {
    const e = { x: -8, z: 0 },
      t = { x: 8, z: 0 };
    let arrived = false,
      maxStill = 0,
      still = 0;
    for (let frame = 0; frame < 30 * 50; frame++) {
      const before = { ...e },
        wp = p.pursuitSteering(e, t, t, frame / 30, [], radius, 2);
      const d = Math.hypot(wp.x - e.x, wp.z - e.z),
        step = Math.min(1.3 / 30, d);
      const x = e.x + ((wp.x - e.x) / (d || 1)) * step,
        z = e.z + ((wp.z - e.z) / (d || 1)) * step;
      assert.ok(
        p.bodyStepFree([], e.x, e.z, x, z, radius, 2),
        "the actual whole-body move is valid",
      );
      e.x = x;
      e.z = z;
      const moved = Math.hypot(e.x - before.x, e.z - before.z);
      still = moved < 1e-5 ? still + 1 / 30 : 0;
      maxStill = Math.max(maxStill, still);
      if (Math.hypot(t.x - e.x, t.z - e.z) < 1) {
        arrived = true;
        break;
      }
    }
    console.log(JSON.stringify({ case: "mesh-fence", radius, arrived, maxStill }));
    assert.ok(arrived);
    assert.ok(maxStill < 0.5);
  }
});
test("a ranged walker advances behind cover instead of holding an unusable firing distance", () => {
  const blocks = fixture().map((b) => ({ ...b, h: 3 })),
    nav = p.connectNavigation(p.solidGrid(blocks), blocks);
  const target = { id: "guest", x: 6, z: 0, y: 1.6, fx: 0, fz: 1 };
  const [i, j] = p.navTarget(nav, target.x, target.z, blocks),
    field = p.flowField(nav, i, j);
  const e = { kind: "gatling", x: -6, z: 0, hp: 10, alive: true, cooldown: 10, slow: 0, flash: 0 };
  const ctx = {
    delta: 1 / 30,
    time: 0,
    blocks,
    solid: nav,
    targets: [target],
    enemies: [e],
    rand: () => 0.5,
    fieldFor: () => field,
    hurtTarget: () => {},
    shoot: () => {},
    ords: [],
    hornetCd: { v: 0 },
    navOpen: () => true,
  };
  const start = { ...e };
  for (let frame = 0; frame < 30 * 3; frame++) {
    ctx.time = frame / 30;
    p.stepNewKind(e, 0, target, Math.hypot(target.x - e.x, target.z - e.z), ctx);
  }
  assert.ok(
    Math.hypot(e.x - start.x, e.z - start.z) > 1,
    "moves despite being inside the 8–15m holding band",
  );
});
test("steering follows a newly selected host or guest immediately after its position changes", () => {
  const e = { x: 0, z: 0 },
    host = { id: null, x: 10, z: 0 },
    guest = { id: "guest", x: -10, z: 0 };
  const probe = { los: () => true, route: () => null };
  assert.equal(p.steerTo(e, host, 1, probe).x, 10);
  assert.equal(p.steerTo(e, guest, 1.01, probe).x, -10);
  guest.z = 10;
  assert.equal(p.steerTo(e, guest, 1.02, probe).z, 10);
});

test("a sealed local goal exhausts a bounded search and backs off without moving the enemy", () => {
  const detours = new p.PursuitDetour(),
    actor = { x: 0, z: 0 },
    target = { x: 10, z: 0 };
  let probes = 0;
  const probe = {
    segmentClear: () => {
      probes++;
      return false;
    },
  };
  assert.deepEqual(detours.resolve(actor, target, target, 1, 0.6, probe), actor);
  assert.ok(probes <= 9);
  const before = probes;
  assert.deepEqual(detours.resolve(actor, target, target, 1.1, 0.6, probe), actor);
  assert.equal(probes, before + 1, "backoff checks only direct clearance");
});

test("ranged hold sees mesh-only cover and approaches around it", () => {
  fixture();
  p.registerStaticGeometry("map", [new p.BoxGeometry(0.15, 4, 12).translate(0, 2, 0)]);
  const nav = p.connectNavigation(p.solidGrid([]), []),
    target = { id: null, x: 6, z: 0, y: 1.6, fx: 0, fz: 1 };
  const [i, j] = p.navTarget(nav, target.x, target.z, []),
    field = p.flowField(nav, i, j);
  const e = { kind: "gatling", x: -6, z: 0, hp: 10, alive: true, cooldown: 10, slow: 0, flash: 0 };
  const ctx = {
    delta: 1 / 30,
    time: 0,
    blocks: [],
    solid: nav,
    targets: [target],
    enemies: [e],
    rand: () => 0.5,
    fieldFor: () => field,
    hurtTarget: () => {},
    shoot: () => {},
    ords: [],
    hornetCd: { v: 0 },
    navOpen: () => true,
  };
  assert.equal(p.pursuitHasShot(e, target, 0, []), false);
  for (let frame = 0; frame < 90; frame++) {
    ctx.time = frame / 30;
    p.stepNewKind(e, 0, target, Math.hypot(target.x - e.x, target.z - e.z), ctx);
  }
  assert.ok(Math.hypot(e.x + 6, e.z) > 1);
});

test("wall-adjacent player remains reachable without demanding an overlapping goal", () => {
  const detours = new p.PursuitDetour(),
    e = { x: -5, z: 0 },
    t = { x: 0.55, z: 0 };
  const probe = { segmentClear: (ax, az, bx, bz, r) => Math.max(ax, bx) <= 1 - r };
  for (let i = 0; i < 100; i++) {
    const wp = detours.resolve(e, t, t, i / 10, 0.6, probe),
      dx = wp.x - e.x,
      dz = wp.z - e.z,
      d = Math.hypot(dx, dz),
      s = Math.min(0.1, d);
    const x = e.x + (dx / (d || 1)) * s,
      z = e.z + (dz / (d || 1)) * s;
    assert.ok(probe.segmentClear(e.x, e.z, x, z, 0.6));
    e.x = x;
    e.z = z;
  }
  assert.ok(Math.hypot(e.x - t.x, e.z - t.z) <= 1.001);
});

test("a mesh occupying the next coarse centroid does not pin distant pursuit", () => {
  fixture();
  const nav = p.connectNavigation(p.solidGrid([]), []),
    target = { x: 26, z: 2 },
    e = { x: -10, z: 2 };
  const [i, j] = p.navTarget(nav, target.x, target.z, []),
    field = p.flowField(nav, i, j),
    out = { x: 0, z: 0 };
  p.registerStaticGeometry("map", [new p.BoxGeometry(0.3, 4, 2).translate(-6, 2, 2)]);
  assert.equal(p.bodyFree([], -6, 2, 0.6, 2), false, "mesh actually occupies the coarse goal");
  let arrived = false;
  for (let frame = 0; frame < 60 * 30; frame++) {
    const coarse = p.nextWaypoint(nav, field, e.x, e.z, out);
    const goal = coarse ? p.pursuitGoal(nav, field, e, coarse, [], 0.6, 2) : target;
    const point = p.pursuitSteering(e, target, goal ?? target, frame / 30, [], 0.6, 2),
      dx = point.x - e.x,
      dz = point.z - e.z,
      d = Math.hypot(dx, dz),
      step = Math.min(1.3 / 30, d);
    const x = e.x + (dx / (d || 1)) * step,
      z = e.z + (dz / (d || 1)) * step;
    assert.ok(p.bodyStepFree([], e.x, e.z, x, z, 0.6, 2));
    e.x = x;
    e.z = z;
    if (Math.hypot(e.x - target.x, e.z - target.z) < 1.3) {
      arrived = true;
      break;
    }
  }
  assert.ok(arrived);
});

test("occupied fine-grid waypoints retain a valid route on stacked-map navigation", () => {
  fixture();
  const nav = p.connectNavigation(p.solidGrid([]), []),
    target = { x: 25, z: 1 },
    e = { x: -9, z: 1 };
  const [i, j] = p.navTarget(nav, target.x, target.z, []),
    field = p.flowField(nav, i, j),
    fine = p.fineField([], target.x, target.z),
    out = { x: 0, z: 0 };
  const first = p.fineStep(fine, e.x, e.z, out);
  p.registerStaticGeometry("map", [new p.BoxGeometry(0.3, 4, 2).translate(first.x, 2, first.z)]);
  assert.equal(p.bodyFree([], first.x, first.z, 0.6, 2), false);
  let arrived = false;
  for (let frame = 0; frame < 60 * 30; frame++) {
    const next = p.fineStep(fine, e.x, e.z, out),
      goal = next ? p.pursuitGoal(nav, field, e, next, [], 0.6, 2, fine) : target;
    const point = p.pursuitSteering(e, target, goal ?? target, frame / 30, [], 0.6, 2),
      dx = point.x - e.x,
      dz = point.z - e.z,
      d = Math.hypot(dx, dz),
      step = Math.min(1.3 / 30, d);
    const x = e.x + (dx / (d || 1)) * step,
      z = e.z + (dz / (d || 1)) * step;
    assert.ok(p.bodyStepFree([], e.x, e.z, x, z, 0.6, 2));
    e.x = x;
    e.z = z;
    if (Math.hypot(e.x - target.x, e.z - target.z) < 1.3) {
      arrived = true;
      break;
    }
  }
  assert.ok(arrived);
});
