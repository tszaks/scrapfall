import { structureBase } from "./structures/world";
// Ground for maps with real elevation: the alpine slopes (a heightfield) and Pacific Pier's
// decks, stairs and skate bowls (an analytic ground). One API for every map; flat maps never
// install a terrain, so every lookup returns the defaults (y = 0, full speed, no wind, shots
// stop below y = 0) and costs nothing.

/**
 * A heightfield: an (n+1) x (n+1) grid of samples every `cell` metres covering [-half, half]
 * on both axes; lookups interpolate bilinearly, so a walking player follows the same surface
 * the terrain mesh draws (the alpine map).
 */
export type Terrain = {
  half: number;
  cell: number;
  /** samples per side minus one */
  n: number;
  /** heights, row-major by x: h[i * (n + 1) + j] at (x = -half + i * cell, z = -half + j * cell) */
  h: Float32Array;
  /** optional walking-speed multiplier (deep snow off the paths) */
  speed?: (x: number, z: number) => number;
  /** optional climbing limit (rise per metre walked): steeper steps, up or down, are walls
   * (a balcony edge, the belfry parapet) */
  maxSlope?: number;
  /** walkable decks above the ground (a bridge over a gully): these win over the heightfield */
  platforms?: { x0: number; z0: number; x1: number; z1: number; y: number }[];
  /** does a shot at (x, y, z) hit something solid standing there (below its top)? */
  shot?: (x: number, y: number, z: number) => boolean;
  /** Additional overhead geometry; false falls back to ordinary world collision. */
  extraShot?: (x: number, y: number, z: number) => boolean;
  /** where wall-passing "ghost" enemies may go: through walls, never onto ground no one can
   * walk (cliffs, another zone, past a blockade). Absent = anywhere. */
  ghost?: (x: number, z: number) => boolean;
};

/**
 * An analytic ground (Pacific Pier): height, speed, and what stops a projectile (decks,
 * railings, the sea surface). `strictNav` makes any solid 2 m cell close its whole 4 m nav
 * cell, so a railing between a deck and the sand below always cuts the route.
 */
export type Ground = {
  height: (x: number, z: number) => number;
  speed?: (x: number, z: number) => number;
  hits?: (x: number, y: number, z: number) => boolean;
  strictNav?: boolean;
  /** optional climbing limit (see Terrain.maxSlope) */
  maxSlope?: number;
  /** see Terrain.ghost */
  ghost?: (x: number, z: number) => boolean;
};

let G: Ground | null = null;
/** the installed heightfield (alpine), for the bare-terrain and shot lookups */
let HF: {
  height: (x: number, z: number) => number;
  shot?: Terrain["shot"];
  extraShot?: Terrain["extraShot"];
} | null = null;

/** Live weather push (metres per second) applied to walking players; the alpine blizzard drives it. */
export const wind = { x: 0, z: 0 };

/** Live world effects a map's renderer can react to (set by the game loop every frame). */
export const worldFx = { hazard: false };

function sampler(t: Terrain) {
  const n = t.n;
  const s = n + 1;
  const h = t.h;
  return (x: number, z: number) => {
    let fx = (x + t.half) / t.cell;
    let fz = (z + t.half) / t.cell;
    if (fx < 0) fx = 0;
    else if (fx > n - 1e-4) fx = n - 1e-4;
    if (fz < 0) fz = 0;
    else if (fz > n - 1e-4) fz = n - 1e-4;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const a = h[i * s + j]!;
    const b = h[(i + 1) * s + j]!;
    const c = h[i * s + j + 1]!;
    const d = h[(i + 1) * s + j + 1]!;
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

/** Install a map's ground (a heightfield or an analytic ground), or null for flat maps. */
export function setTerrain(t: Terrain | Ground | null) {
  HF = null;
  if (t && !("height" in t)) {
    const bare = sampler(t);
    const decks = t.platforms ?? [];
    HF = {
      height: bare,
      ...(t.shot ? { shot: t.shot } : {}),
      ...(t.extraShot ? { extraShot: t.extraShot } : {}),
    };
    const height = decks.length
      ? (x: number, z: number) => {
          for (const p of decks) if (x > p.x0 && x < p.x1 && z > p.z0 && z < p.z1) return p.y;
          return bare(x, z);
        }
      : bare;
    G = {
      height,
      ...(t.speed ? { speed: t.speed } : {}),
      ...(t.maxSlope !== undefined ? { maxSlope: t.maxSlope } : {}),
      ...(t.ghost ? { ghost: t.ghost } : {}),
    };
  } else G = t;
  wind.x = 0;
  wind.z = 0;
  worldFx.hazard = false;
}

export function hasTerrain() {
  return G !== null;
}

/** Flat maps can still have raised walkable floors: the building-access system answers with
 * the roof height for points on a walkable roof, `undefined` elsewhere. */
export const groundHook: { fn: ((x: number, z: number) => number | undefined) | null } = {
  fn: null,
};

/** Height of the ground at (x, z), in metres. */
export function groundY(x: number, z: number) {
  const room = structureBase(x, z);
  if (room !== undefined) return room;
  // a walkable roof (building access) wins over the ground under it
  const g = groundHook.fn;
  if (g) {
    const y = g(x, z);
    if (y !== undefined) return y;
  }
  return G ? G.height(x, z) : 0;
}

/** Walking-speed multiplier at (x, z): 1 on flat maps, lower in deep snow, sand or surf. */
export function groundSpeed(x: number, z: number) {
  return G?.speed ? G.speed(x, z) : 1;
}

/** Does a projectile at (x, y, z) hit the ground (or, where the map says so, a railing or the sea)? */
export function groundHits(x: number, y: number, z: number) {
  if (!G) return y < groundY(x, z); // 0, or a walkable roof's height
  return G.hits ? G.hits(x, y, z) : y < G.height(x, z);
}

/** True when the map's ground decides every projectile stop itself (ground, railings, sea). */
export function groundOwnsHits() {
  return !!G?.hits;
}

/** True when the map's ground asks for strict nav cells (see Ground.strictNav). */
export function strictNav() {
  return !!G?.strictNav;
}

/** The local player's jump (input/movement.ts): the absolute height of the feet while in the
 * air, -Infinity on foot. Set only around the player's own movement. */
export const jumpClimb = { feet: -Infinity, top: -Infinity };

/** Is (x, z) on ground too steep to stand on (a ledge's face)? Only climbing-limited grounds. */
export function steepAt(x: number, z: number) {
  const g = G;
  if (!g || g.maxSlope === undefined) return false;
  const e = 0.2;
  const gx = (g.height(x + e, z) - g.height(x - e, z)) / (2 * e);
  const gz = (g.height(x, z + e) - g.height(x, z - e)) / (2 * e);
  return Math.hypot(gx, gz) > g.maxSlope * 1.25;
}

/** the way down a slope at (x, z): unit vector, or null on flat ground */
export function downhill(x: number, z: number): [number, number] | null {
  const e = 0.2;
  const gx = (groundY(x + e, z) - groundY(x - e, z)) / (2 * e);
  const gz = (groundY(x, z + e) - groundY(x, z - e)) / (2 * e);
  const m = Math.hypot(gx, gz);
  return m < 1e-4 ? null : [-gx / m, -gz / m];
}
/** how far a jump may climb onto, or drop off, a flat ledge the walk rules refuse (m) */
const JUMP_LEDGE = 1.15;

/**
 * A jumping player may step onto (or off) a ledge the walk rules refuse (a porch deck, a
 * boardwalk): only when the feet are above it, it is within JUMP_LEDGE of the ground under
 * them (the feet never rise more than ~1.1 m over the take-off), and it is flat on top. A steep slope is never a ledge, so slopes stay walls.
 */
function ledgeOK(
  g: Ground,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  ux: number,
  uz: number,
) {
  const f = jumpClimb.feet;
  if (f === -Infinity || g.maxSlope === undefined) return false;
  const h0 = g.height(x0, z0);
  const px = x1 + ux * 0.25;
  const pz = z1 + uz * 0.25;
  const h1 = g.height(x1, z1);
  const hp = g.height(px, pz);
  const top = Math.max(h1, hp);
  if (f < top - 0.02) return false;
  // off raised ground (a balcony, the belfry: only reached by its stair) a jump may drop any
  // height (fall damage applies); everywhere else only ledges within JUMP_LEDGE, so nobody
  // drops into a gully they can't climb out of
  // (from raised ground, or already falling from it down its face)
  const fromRaised = h0 > 1.2 || jumpClimb.top > 2.4;
  const drop = fromRaised && Math.min(h1, hp) < h0 - 0.05 && top <= h0 + 0.02;
  if (!drop && (Math.abs(top - h0) > JUMP_LEDGE || Math.abs(Math.min(h1, hp) - h0) > JUMP_LEDGE))
    return false;
  // (a drop falls past the edge's face and lands wherever it lands: no flat-top test)
  if (drop) return true;
  const hq = g.height(px + ux * 0.3, pz + uz * 0.3);
  return Math.abs(hq - hp) <= 0.3 * g.maxSlope + 0.03;
}

/** Can a walker step from (x0, z0) to (x1, z1)? Only terrains with `maxSlope` refuse steep
 * steps: up a wall, or off a ledge (take the stairs down). A jump may clear low ledges. */
export function climbable(x0: number, z0: number, x1: number, z1: number) {
  const g = G;
  if (!g || g.maxSlope === undefined) return true;
  if (walkable(g, g.maxSlope, x0, z0, x1, z1)) return true;
  const d = Math.hypot(x1 - x0, z1 - z0);
  return d > 1e-6 && ledgeOK(g, x0, z0, x1, z1, (x1 - x0) / d, (z1 - z0) / d);
}

function walkable(g: Ground, maxSlope: number, x0: number, z0: number, x1: number, z1: number) {
  // judge the local slope over at least 0.25 m in the direction of travel: a crowd of tiny
  // nudges (each rising less than any threshold) must not walk a body up a wall
  let dx = x1 - x0;
  let dz = z1 - z0;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return true;
  const probe = Math.max(d, 0.25);
  dx = (dx / d) * probe;
  dz = (dz / d) * probe;
  const h0 = g.height(x0, z0);
  const rise = Math.abs(g.height(x0 + dx, z0 + dz) - h0);
  if (rise > 0.05 && rise > probe * maxSlope + 0.02) return false;
  // and never uphill onto ground steeper than the limit, whatever the angle: slanting across a
  // wall face (a crowd zig-zagging against the tower) would otherwise climb it by switchbacks
  const h1 = g.height(x1, z1);
  if (h1 > h0 + 0.001) {
    const e = 0.2;
    const gx = (g.height(x1 + e, z1) - g.height(x1 - e, z1)) / (2 * e);
    const gz = (g.height(x1, z1 + e) - g.height(x1, z1 - e)) / (2 * e);
    if (Math.hypot(gx, gz) > maxSlope * 1.25) return false;
  }
  return true;
}

/** The bare heightfield (what the terrain mesh draws), ignoring decks; groundY elsewhere. */
export function terrainY(x: number, z: number) {
  return HF ? HF.height(x, z) : groundY(x, z);
}

/**
 * Height-aware shot collision on heightfield maps: true when (x, y, z) is under the snow or
 * inside something solid. Returns null elsewhere so callers fall back to their own tests.
 */
export function shotHits(x: number, y: number, z: number): boolean | null {
  if (!HF) return null;
  if (HF.extraShot?.(x, y, z)) return true;
  if (!HF.shot) return null;
  return y < HF.height(x, z) || HF.shot(x, y, z);
}

/** May a wall-passing ghost enemy stand at (x, z)? (see Terrain.ghost) */
export function ghostOK(x: number, z: number) {
  if (raised(x, z)) return false;
  return G?.ghost ? G.ghost(x, z) : true;
}

/**
 * Raised walkable ground that is only reached by its stair (Dry Gulch's saloon balcony, the
 * church stair, landing and belfry): enemies never spawn, blink or route there. Only grounds
 * with a climbing limit have such places.
 */
export function raised(x: number, z: number) {
  return G?.maxSlope !== undefined && G.height(x, z) > 1.2;
}
