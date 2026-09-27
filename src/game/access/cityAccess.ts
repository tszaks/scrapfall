// Vice Heights adapter: picks which buildings players can go up and describes each one to the
// access system. Rule of thumb (agreed with Tyler): 4 storeys or fewer get a stairwell,
// 5 or more get an elevator. A handful of towers (the landmark first) get elevators, several
// low-rise shops / walk-ups / a parking garage get stairwells, spread across the map.
// Deterministic: it only reads the generated layout, so every co-op client picks the same.
import { K_OPEN, K_PARK, K_PATH, K_WALK, type Bld, type CityLayout, type Part } from "../cityLayout";
import { layoutAccess, type AccessBuilding } from "./layout";
import type { AccessKind, AccessSpec, Facing, Rect } from "./types";

const RIM = 0.35; // the city's parapet thickness (cityMesh roof())
const PARAPET = 1.15;

/** storeys, from the generator's massing rules */
function floorsOf(b: Bld): number {
  switch (b.t) {
    case "low":
    case "corner":
      return 1 + Math.round((b.h - 4.5) / b.fh);
    case "garage":
      return Math.round(b.h / 3.1);
    case "warehouse":
      return Math.max(1, Math.round(b.h / 5));
    default:
      return Math.max(1, Math.round(b.h / b.fh));
  }
}

const topPart = (b: Bld) =>
  b.parts
    .filter((p) => p.role !== "bridge" && p.role !== "canopy")
    .reduce((a, p) => (p.y0 + p.h > a.y0 + a.h ? p : a), b.parts[0]!);

/** the walkable roof rectangle of the top part (inside the parapet) */
function roofRect(b: Bld, p: Part): Rect | null {
  const shape = p.shape ?? "box";
  let { x0, z0, x1, z1 } = p;
  if (shape === "taper") {
    // cityMesh massPart: the top section is the base scaled about its centre
    const k = b.t === "super" ? 0.46 : 0.6;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    x0 = cx + (x0 - cx) * k;
    x1 = cx + (x1 - cx) * k;
    z0 = cz + (z0 - cz) * k;
    z1 = cz + (z1 - cz) * k;
  } else if (shape !== "box") return null;
  return { x0: x0 + RIM, z0: z0 + RIM, x1: x1 - RIM, z1: z1 - RIM };
}

/**
 * `playHalf`: solo plays inside a sealed square of this half-size (the rest of the 800 m city
 * stays on screen behind blockades); only buildings wholly inside it get access. null = co-op.
 */
export function cityAccess(city: CityLayout, playHalf: number | null = null): AccessBuilding[] {
  const { cells, half, kind, solid } = city;
  const coop = playHalf === null;
  const lim = playHalf ?? half;
  const cellAt = (x: number, z: number) => {
    const i = Math.floor((x + half) / 2);
    const j = Math.floor((z + half) / 2);
    return i >= 0 && j >= 0 && i < cells && j < cells ? i * cells + j : -1;
  };
  const walkable = (x: number, z: number) => {
    const c = cellAt(x, z);
    if (c < 0 || solid[c]) return false;
    const k = kind[c]!;
    return k === K_WALK || k === K_OPEN || k === K_PATH || k === K_PARK;
  };
  const onGrid = (v: number) => Math.abs((v + half) / 2 - Math.round((v + half) / 2)) < 1e-6;
  // (a margin inside the sealed edge: no entrance right against a blockade)
  const inArena = (x: number, z: number) => Math.abs(x) < lim - 16 && Math.abs(z) < lim - 16;
  const bInside = (b: Bld) =>
    Math.max(Math.abs(b.x0), Math.abs(b.x1), Math.abs(b.z0), Math.abs(b.z1)) < lim - 4;

  type Cand = { b: Bld; a: AccessBuilding; score: number };
  const elevs: Cand[] = [];
  const stairs: Cand[] = [];
  city.buildings.forEach((b, bi) => {
    if (b.backdrop || b.access || !bInside(b)) return;
    const okType =
      b.t === "tower" || b.t === "super" || b.t === "mid" || b.t === "slab" || b.t === "mall" ||
      b.t === "low" || b.t === "corner" || b.t === "warehouse" || b.t === "garage";
    if (!okType) return;
    const floors = floorsOf(b);
    const k: AccessKind = floors <= 4 ? "stairs" : "elevator";
    // stairs only on single-volume buildings (no roofs part-way up the stairwell)
    if (k === "stairs" && b.parts.length !== 1) return;
    const tp = topPart(b);
    const roof = roofRect(b, tp);
    if (!roof) return;
    // the ground part holding the entrance: the biggest volume standing on the street
    const ground = b.parts
      .filter((p) => p.y0 < 0.1 && (p.shape ?? "box") === "box")
      .sort((p, q) => (q.x1 - q.x0) * (q.z1 - q.z0) - (p.x1 - p.x0) * (p.z1 - p.z0))[0];
    if (!ground) return;
    // an arcade (cantilevered upper block over a recessed ground floor) hides the facade
    if (b.parts.some((p) => p !== ground && p.y0 > 0.1 && p.role !== "tower" && p.role !== "body")) return;
    if (b.parts.some((p) => p !== ground && p.y0 > 0.1 && (p.x0 < ground.x0 || p.x1 > ground.x1 || p.z0 < ground.z0 || p.z1 > ground.z1))) return;
    const facing = b.front as Facing;
    const plane = facing === 0 ? ground.z0 : facing === 1 ? ground.x1 : facing === 2 ? ground.z1 : ground.x0;
    if (!onGrid(plane)) return;
    const alongX = facing === 0 || facing === 2;
    const nx = facing === 1 ? 1 : facing === 3 ? -1 : 0;
    const nz = facing === 2 ? 1 : facing === 0 ? -1 : 0;
    const roofMid = alongX ? (roof.x0 + roof.x1) / 2 : (roof.z0 + roof.z1) / 2;
    // stairs sit off-centre so their roof door has a walkway beside it
    // (a garage keeps its ramp and P sign in the middle of the front: the stairs go to one side)
    const offs =
      k === "elevator"
        ? [0, -1, 1, -2, 2, -3, 3]
        : b.t === "garage"
          ? [-6, 6, -7, 7, -8, 8, -9, 9, -10, 10]
          : [-2, 2, -3, 3, -1, 1, -4, 4, 0, -5, 5, -6, 6];
    const spec0 = {
      kind: k,
      footprint: { x0: ground.x0, z0: ground.z0, x1: ground.x1, z1: ground.z1 },
      roof,
      roofY: tp.y0 + tp.h,
      groundY: 0,
      floors,
      floorHeight: b.fh,
      parapet: PARAPET,
      helipad: k === "elevator" && (b.crown === "helipad" || b.h > 150),
      spire: b.t === "super" ? 70 : undefined,
      name: `${b.t}-${bi}`,
      seed: b.seed,
    };
    for (const o of offs) {
      const t = roofMid + o;
      // the doorway's sign in the tangent direction: local +a is (iz, -ix) in world
      const dx = alongX ? t : plane;
      const dz = alongX ? plane : t;
      if (!inArena(dx, dz)) continue;
      // a clear sidewalk in front of the doorway: 1 and 3 m out, across the opening
      const tx = alongX ? 1 : 0;
      const tz = alongX ? 0 : 1;
      let clear = true;
      for (const out of [1, 3])
        for (const lat of [-1, 0, 1])
          if (!walkable(dx + nx * out + tx * lat, dz + nz * out + tz * lat)) clear = false;
      if (!clear) continue;
      const spec: AccessSpec = { ...spec0, door: { x: dx, z: dz, facing } };
      const a = layoutAccess(spec, 0);
      if (!a) continue;
      const score = k === "elevator" ? (b.t === "super" ? 1e6 : b.h) : b.t === "garage" ? 1e5 : b.h + 10 * floors;
      (k === "elevator" ? elevs : stairs).push({ b, a, score });
      break;
    }
  });
  // spread them out: greedy by score with a minimum spacing
  const pick = (list: Cand[], n: number, gap: number, avoid: Cand[], gapAvoid: number) => {
    const out: Cand[] = [];
    for (const c of list.sort((p, q) => q.score - p.score)) {
      if (out.length >= n) break;
      const cx = (c.b.x0 + c.b.x1) / 2;
      const cz = (c.b.z0 + c.b.z1) / 2;
      const near = (o: Cand, g: number) => Math.hypot((o.b.x0 + o.b.x1) / 2 - cx, (o.b.z0 + o.b.z1) / 2 - cz) < g;
      if (out.some((o) => near(o, gap)) || avoid.some((o) => near(o, gapAvoid))) continue;
      out.push(c);
    }
    return out;
  };
  const E = pick(elevs, coop ? 12 : 6, coop ? 95 : 80, [], 0);
  const S = pick(stairs, coop ? 7 : 5, coop ? 70 : 60, E, 45);
  const chosen = [...E, ...S];
  return chosen.map((c, id) => {
    const a = layoutAccess(c.a.spec, id)!;
    const p0 = a.portals[0];
    c.b.access = {
      kind: a.kind,
      hole: a.hole,
      door: {
        x: a.spec.door.x,
        z: a.spec.door.z,
        facing: a.spec.door.facing,
        w: p0.half * 2 + 0.3,
        h: a.kind === "elevator" ? 2.9 : 2.45,
      },
      parapet: a.spec.parapet,
    };
    return a;
  });
}
