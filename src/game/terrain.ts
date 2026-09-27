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
let HF: { height: (x: number, z: number) => number; shot?: Terrain["shot"] } | null = null;

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
    HF = { height: bare, ...(t.shot ? { shot: t.shot } : {}) };
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
export const groundHook: { fn: ((x: number, z: number) => number | undefined) | null } = { fn: null };

/** Height of the ground at (x, z), in metres. */
export function groundY(x: number, z: number) {
  if (G) return G.height(x, z);
  const g = groundHook.fn;
  if (g) {
    const y = g(x, z);
    if (y !== undefined) return y;
  }
  return 0;
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

/** Can a walker step from (x0, z0) to (x1, z1)? Only terrains with `maxSlope` refuse steep
 * steps: up a wall, or off a ledge (take the stairs down). */
export function climbable(x0: number, z0: number, x1: number, z1: number) {
  const g = G;
  if (!g || g.maxSlope === undefined) return true;
  const rise = Math.abs(g.height(x1, z1) - g.height(x0, z0));
  if (rise <= 0.05) return true;
  return rise <= Math.hypot(x1 - x0, z1 - z0) * g.maxSlope + 0.02;
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
  if (!HF || !HF.shot) return null;
  return y < HF.height(x, z) || HF.shot(x, y, z);
}

/** May a wall-passing ghost enemy stand at (x, z)? (see Terrain.ghost) */
export function ghostOK(x: number, z: number) {
  return G?.ghost ? G.ghost(x, z) : true;
}
