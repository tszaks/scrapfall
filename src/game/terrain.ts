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
};

let G: Ground | null = null;

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
  G = !t
    ? null
    : "height" in t
      ? t
      : { height: sampler(t), ...(t.speed ? { speed: t.speed } : {}) };
  wind.x = 0;
  wind.z = 0;
  worldFx.hazard = false;
}

export function hasTerrain() {
  return G !== null;
}

/** Height of the ground at (x, z), in metres. */
export function groundY(x: number, z: number) {
  return G ? G.height(x, z) : 0;
}

/** Walking-speed multiplier at (x, z): 1 on flat maps, lower in deep snow, sand or surf. */
export function groundSpeed(x: number, z: number) {
  return G?.speed ? G.speed(x, z) : 1;
}

/** Does a projectile at (x, y, z) hit the ground (or, where the map says so, a railing or the sea)? */
export function groundHits(x: number, y: number, z: number) {
  if (!G) return y < 0;
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
