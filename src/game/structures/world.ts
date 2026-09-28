import { circleTouches, contains, flightY, type Structure } from "./plan";

let plans: Structure[] = [];
const buckets = new Map<number, Structure[]>();
const empty: Structure[] = [];
const streetWalls = new Map<Structure, import("./plan").Rect[]>();
const cell = 24;
// queries arrive in spatially coherent runs (collision ray-marching walks half-metre
// steps through a 24 m bucket), so one memo slot absorbs most of the map lookups
let lastKey = Number.MIN_SAFE_INTEGER;
let lastList: Structure[] = empty;
const at = (x: number, z: number): Structure[] => {
  const k = Math.floor(x / cell) * 65536 + Math.floor(z / cell);
  if (k === lastKey) return lastList;
  const a = buckets.get(k) ?? empty;
  lastKey = k;
  lastList = a;
  return a;
};
export const structurePlayer = { id: "", floor: 0, y: 0 };
export const structureList = () => plans;
export function installStructures(next: Structure[]) {
  plans = next;
  buckets.clear();
  streetWalls.clear();
  lastKey = Number.MIN_SAFE_INTEGER;
  lastList = empty;
  Object.assign(structurePlayer, { id: "", floor: 0, y: 0 });
  for (const p of plans) {
    streetWalls.set(p, [
      ...p.solids.filter((v) => v.y1 > p.base + 0.2 && v.y0 < p.base + 1.8),
      ...p.stairs,
      ...(p.navObstacles ?? []),
    ]);
    for (
      let i = Math.floor((p.bounds.x0 - 4) / cell);
      i <= Math.floor((p.bounds.x1 + 4) / cell);
      i++
    )
      for (
        let j = Math.floor((p.bounds.z0 - 4) / cell);
        j <= Math.floor((p.bounds.z1 + 4) / cell);
        j++
      ) {
        const key = i * 65536 + j,
          a = buckets.get(key) ?? [];
        a.push(p);
        buckets.set(key, a);
      }
  }
}
export function structureBase(x: number, z: number) {
  if (!plans.length) return undefined;
  for (const p of at(x, z)) if (contains(p.bounds, x, z)) return p.base;
  return undefined;
}
/** Highest support reachable from the actor's previous feet, never an overlapping ceiling. */
export function structureFloor(x: number, z: number, feet: number, step = 0.55) {
  let best: { y: number; level: number; id: string } | undefined;
  if (!plans.length) return best;
  for (const p of at(x, z)) {
    if (!contains(p.bounds, x, z)) continue;
    for (const f of p.floors)
      if (
        contains(f, x, z) &&
        !f.holes.some((h) => contains(h, x, z)) &&
        f.y <= feet + step &&
        (!best || f.y > best.y)
      )
        best = { y: f.y, level: f.level, id: p.id };
    for (const s of p.stairs)
      if (contains(s, x, z)) {
        const y = flightY(s, x, z);
        if (y <= feet + step && (!best || y > best.y))
          best = { y, level: y > p.base + 0.7 ? s.level : 0, id: p.id };
      }
  }
  return best;
}
/** Exact solid boxes and the tread envelope; valid for any player's floor. */
export function structureShot(x: number, y: number, z: number): boolean | undefined {
  if (!plans.length) return undefined;
  let owns = false;
  for (const p of at(x, z)) {
    if (!contains(p.bounds, x, z, 0.02) || y > p.top + 0.02) continue;
    owns ||= !p.includeStatic;
    if (y < p.base) return true;
    for (const v of p.solids) if (y >= v.y0 && y <= v.y1 && contains(v, x, z)) return true;
    for (const s of p.stairs)
      if (contains(s, x, z)) {
        const fy = flightY(s, x, z);
        // Individual risers are at most 18 cm above the smooth walk surface.
        if (y >= fy - 0.2 && y <= fy + 0.18) return true;
      }
  }
  return owns ? false : undefined;
}
/** Body query at explicit feet height. The actor may pass below a higher floor. */
export function structureBody(
  x: number,
  z: number,
  r: number,
  feet: number,
  street = false,
): boolean | undefined {
  if (!plans.length) return undefined;
  let owns = false;
  for (const p of at(x, z)) {
    if (!contains(p.bounds, x, z, r + 0.05) || feet > p.top + 0.2) continue;
    owns ||= !p.includeStatic;
    for (const v of p.solids) {
      if (v.y1 <= feet + 0.2 || v.y0 >= feet + 1.8) continue;
      // A landing can meet the capsule rim before its centre reaches the last tread.
      // Treat that thin, reachable support as a step; torso-height slabs still block.
      if (
        !street &&
        v.y1 <= feet + 0.55 &&
        v.y1 - v.y0 <= 0.181 &&
        p.floors.some((f) => Math.abs(f.y - v.y1) < 0.001 && contains(f, x, z, r))
      )
        continue;
      if (circleTouches(v, x, z, r)) return true;
    }
    if (street && p.navObstacles?.some((v) => circleTouches(v, x, z, r))) return true;
    // Street enemies can enter furnished rooms, but have no navigation on player-only stairs.
    if (street && p.stairs.some((s) => contains(s, x, z, r))) return true;
    for (const s of p.stairs)
      if (contains(s, x, z, r)) {
        const fy = flightY(s, x, z);
        if (fy > feet + 0.65 && fy - 0.25 < feet + 1.8) return true;
      }
  }
  return owns ? false : undefined;
}
export function structureStreet(x: number, z: number, r: number) {
  if (!plans.length) return undefined;
  for (const p of at(x, z))
    if (contains(p.bounds, x, z, r + 0.05)) return structureBody(x, z, r, p.base, true);
  return undefined;
}

/** Nav links must clear thin walls between their open endpoint cells. */
export function structurePathClear(ax: number, az: number, bx: number, bz: number, r = 0.45) {
  if (!plans.length) return true;
  const dx = bx - ax,
    dz = bz - az;
  for (const p of at((ax + bx) / 2, (az + bz) / 2))
    for (const w of streetWalls.get(p)!) {
      let lo = 0,
        hi = 1;
      if (Math.abs(dx) < 1e-9) {
        if (ax < w.x0 - r || ax > w.x1 + r) continue;
      } else {
        const a = (w.x0 - r - ax) / dx,
          b = (w.x1 + r - ax) / dx;
        lo = Math.max(lo, Math.min(a, b));
        hi = Math.min(hi, Math.max(a, b));
      }
      if (Math.abs(dz) < 1e-9) {
        if (az < w.z0 - r || az > w.z1 + r) continue;
      } else {
        const a = (w.z0 - r - az) / dz,
          b = (w.z1 + r - az) / dz;
        lo = Math.max(lo, Math.min(a, b));
        hi = Math.min(hi, Math.max(a, b));
      }
      if (lo <= hi) return false;
    }
  return true;
}
