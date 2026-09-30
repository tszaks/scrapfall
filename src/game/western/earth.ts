import type { Terrain } from "../terrain";
import type { WBld, WProp } from "./layout";
import { roadNet } from "./riderSim";

/** A graded valley floor. Roads, railway, structures and rock shelves share level pads;
 * the land between them rises into walkable foothills, not invisible collision walls. */
export function* valleyEarth(
  half: number,
  buildings: WBld[],
  props: WProp[],
  rock: Float32Array,
  cells: number,
  river: (x: number) => number,
  decks: readonly { x0: number; z0: number; x1: number; z1: number; y: number; axis: "x" | "z" }[] = [],
): Generator<void, Terrain, void> {
  const cell = 4,
    n = Math.round((half * 2) / cell),
    h = new Float32Array((n + 1) ** 2);
  const net = roadNet();
  const pads = buildings.map((b) => ({ x0: b.x0 - 5, x1: b.x1 + 5, z0: b.z0 - 5, z1: b.z1 + 5 }));
  // Rigid assemblies need a single support plane across their entire footprint.
  for (const p of props)
    if (
      [
        "fence",
        "picket",
        "hitch",
        "covered",
        "wagon",
        "horse",
        "stagecoach",
        "garden",
        "clothesline",
        "windmill",
        "tank",
        "watertower",
        "trough",
        "well",
        "bench",
        "woodpile",
        "campfire",
        "outhouse",
        "crate",
        "crates",
        "barrel",
        "barrels",
        "anvil",
        "cart",
        "orecart",
        "bench",
        "sacks",
      ].includes(p.k)
    ) {
      const r =
        p.k === "fence" || p.k === "picket"
          ? p.s + 2
          : [
                "windmill",
                "tank",
                "watertower",
                "covered",
                "stagecoach",
                "wagon",
                "garden",
                "clothesline",
                "trough",
              ].includes(p.k)
            ? 6
            : 4;
      pads.push({ x0: p.x - r, x1: p.x + r, z0: p.z - r, z1: p.z + r });
    }
  const rectDistance = (x: number, z: number, p: (typeof pads)[number]) =>
    Math.hypot(Math.max(p.x0 - x, 0, x - p.x1), Math.max(p.z0 - z, 0, z - p.z1));
  const segmentDistance = (
    x: number,
    z: number,
    ax: number,
    az: number,
    bx: number,
    bz: number,
  ) => {
    const dx = bx - ax,
      dz = bz - az,
      t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    return Math.hypot(x - ax - t * dx, z - az - t * dz);
  };
  // Continuous distance to rock: no finite search radius that suddenly releases a pad.
  const side = n + 1,
    rockDistance = new Float32Array(side * side).fill(half * 4);
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      const ix = i * 2,
        iz = j * 2;
      for (let a = -2; a <= 2; a++)
        for (let b = -2; b <= 2; b++) {
          const u = ix + a,
            v = iz + b;
          if (u >= 0 && v >= 0 && u < cells && v < cells && rock[u * cells + v]! > 0)
            rockDistance[i * side + j] = 0;
        }
    }
    yield;
  }
  for (const direction of [1, -1]) {
    for (let ii = 0; ii <= n; ii++) {
      for (let jj = 0; jj <= n; jj++) {
        const i = direction === 1 ? ii : n - ii,
          j = direction === 1 ? jj : n - jj,
          k = i * side + j;
        for (const [a, b] of [
          [-direction, 0],
          [0, -direction],
          [-direction, -direction],
          [-direction, direction],
        ]) {
          const u = i + a!,
            v = j + b!;
          if (u >= 0 && v >= 0 && u <= n && v <= n)
            rockDistance[k] = Math.min(
              rockDistance[k]!,
              rockDistance[u * side + v]! + cell * Math.hypot(a!, b!),
            );
        }
      }
      yield;
    }
  }
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      const x = -half + i * cell,
        z = -half + j * cell;
      let d = Math.min(
        half - Math.max(Math.abs(x), Math.abs(z)) - 12,
        Math.abs(x - 150) - 22,
        Math.abs(z - river(x)) - 24,
      );
      // Keep the church approach, Main Street and blockade passes graded.
      d = Math.min(d, Math.abs(z) - 18);
      for (const p of pads) d = Math.min(d, rectDistance(x, z, p));
      for (const e of net.edges) {
        const a = net.nodes[e.a]!,
          b = net.nodes[e.b]!;
        d = Math.min(d, segmentDistance(x, z, a.x, a.z, b.x, b.z) - 9);
      }
      d = Math.min(d, rockDistance[i * side + j]!);
      const hill = (cx: number, cz: number, r: number, y: number) =>
        y * Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (r * r));
      // the fringe dune field stays low: hills roll down to the river flats instead of
      // throwing a shoulder a player can never climb onto, and the west mesa's east
      // tail dies out before the south camp (a sheer-sided dune traps the camera in it)
      const mesaT = Math.min(1, Math.max(0, (-150 - x) / 50)),
        mesaFade = mesaT * mesaT * (3 - 2 * mesaT);
      const southT = Math.min(1, Math.max(0, (z - 168) / 26)),
        southFade = southT * southT * (3 - 2 * southT);
      const raw =
        hill(-175, -105, 85, 18) +
        hill(68, -118, 68, 16) +
        hill(-98, 113, 62, 12) * (1 - southFade) +
        hill(66, 122, 64, 10) * (1 - southFade) +
        hill(-210, 182, 100, 17) * mesaFade +
        hill(236, -76, 80, 20) +
        hill(230, 200, 72, 13);
      // Maximum rise .42 m per metre from each pad; all entrances remain at grade.
      h[i * (n + 1) + j] = Math.max(0, Math.min(raw, Math.max(0, d - 2) * 0.42));
    }
    yield;
  }
  // The bridge abutments are real dirt: the same ramps the collision heightfield carries,
  // written into the visible earth so the rendered bank, the walkable slope and
  // baseHeight (the step check) never disagree about where the approach climbs.
  const RAMP = 8,
    FLANK = 4;
  for (const dk of decks) {
    const ramp = (x: number, z: number) => {
      const along =
        dk.axis === "z"
          ? z < dk.z0
            ? dk.z0 - z
            : z > dk.z1
              ? z - dk.z1
              : 0
          : x < dk.x0
            ? dk.x0 - x
            : x > dk.x1
              ? x - dk.x1
              : 0;
      if (along > RAMP) return 0;
      const across =
        dk.axis === "z"
          ? Math.max(0, dk.x0 - x, x - dk.x1)
          : Math.max(0, dk.z0 - z, z - dk.z1);
      if (across > FLANK) return 0;
      return dk.y * (1 - along / RAMP) * (1 - across / FLANK);
    };
    const lo = dk.axis === "z" ? [dk.x0 - FLANK, dk.z0 - RAMP] : [dk.x0 - RAMP, dk.z0 - FLANK];
    const hi = dk.axis === "z" ? [dk.x1 + FLANK, dk.z1 + RAMP] : [dk.x1 + RAMP, dk.z1 + FLANK];
    for (let i = 0; i <= n; i++) {
      if (i % 16 === 0) yield;
      for (let j = 0; j <= n; j++) {
        const x = -half + i * cell,
          z = -half + j * cell;
        if (x < lo[0]! || x > hi[0]! || z < lo[1]! || z > hi[1]!) continue;
        const r = ramp(x, z);
        if (r > h[i * (n + 1) + j]!) h[i * (n + 1) + j] = r;
      }
    }
  }
  return { half, cell, n, h, triangular: true };
}
