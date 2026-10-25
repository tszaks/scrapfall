// Per-enemy steering memo. Route picking (a clearLine() probe plus, when it fails, a
// fine-field or flow-field descent) used to run every frame for every enemy. Each
// clearLine() ray-marches a blocked() query every half metre, so a crowded wave cost
// thousands of grid lookups a frame. The choice changes slowly, so it is recomputed a
// few times a second — staggered by position, so a crowd does not all re-route on the
// same frame — and reused while neither endpoint has moved far. Movement itself still
// runs every frame (walk() keeps its live collision checks, so nothing clips).
//
// Deliberately deterministic (a position hash, not the shared rng): consuming rand()
// here would change every downstream world-gen and spawn draw.

/** fields the cache hangs on an enemy (see Bot in enemyAI.ts / Enemy in Game.tsx) */
export type SteerMem = {
  /** clock time the memo is valid until */
  svT?: number;
  /** the chosen waypoint */
  svX?: number;
  svZ?: number;
  /** target position when the route was picked */
  stX?: number;
  stZ?: number;
  /** own position when the route was picked (teleports/wedging bust the memo) */
  seX?: number;
  seZ?: number;
};

/** seconds between route picks */
const TTL = 0.14;
/** re-pick early if either endpoint moved this far since the pick */
const MOVED = 1.4;

const out = { x: 0, z: 0 };

/** The lazy probes steerTo runs (only on a memo miss): `los` is the LOS ray-march and
 * `route` the fallback field descent. Passed as one reusable object with mutable fields —
 * a pair of closures per enemy per frame was a measurable GC source in a crowd. */
export type SteerProbe = {
  los: () => boolean;
  route: () => { x: number; z: number } | null;
  /** Full-body local detour, evaluated only when the memo expires. */
  refine?: (point: { x: number; z: number }) => { x: number; z: number };
};

/**
 * Where to walk this frame: the target if the straight line is clear (`los`), else the
 * route the grid suggests (`route`). Returns a shared scratch object — read it
 * synchronously, don't keep it.
 */
export function steerTo<T extends { x: number; z: number }>(
  e: SteerMem & { x: number; z: number },
  t: T,
  time: number,
  probe: SteerProbe,
): { x: number; z: number } {
  if (
    e.svT !== undefined &&
    e.svT > time &&
    Math.abs(t.x - e.stX!) + Math.abs(t.z - e.stZ!) < MOVED &&
    Math.abs(e.x - e.seX!) + Math.abs(e.z - e.seZ!) < MOVED
  ) {
    out.x = e.svX!;
    out.z = e.svZ!;
    return out;
  }
  let p = probe.los() ? t : (probe.route() ?? t);
  if (probe.refine) p = probe.refine(p);
  const jit = Math.abs(Math.sin(e.x * 12.9898 + e.z * 78.233));
  e.svT = time + TTL * (0.6 + 0.8 * jit);
  e.svX = p.x;
  e.svZ = p.z;
  e.stX = t.x;
  e.stZ = t.z;
  e.seX = e.x;
  e.seZ = e.z;
  out.x = p.x;
  out.z = p.z;
  return out;
}
