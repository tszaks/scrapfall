// Ground height for maps with real elevation (the alpine map). Flat maps never install a
// terrain, so every lookup returns the defaults (y = 0, full speed, no wind) and cost nothing.
//
// The heightfield is a (n+1) x (n+1) grid of samples every `cell` metres covering
// [-half, half] on both axes; lookups interpolate bilinearly, so a walking player follows
// the same surface the terrain mesh draws.

export type Terrain = {
  half: number;
  cell: number;
  /** samples per side minus one */
  n: number;
  /** heights, row-major by x: h[i * (n + 1) + j] at (x = -half + i * cell, z = -half + j * cell) */
  h: Float32Array;
  /** optional walking-speed multiplier per 2 m cell (deep snow off the paths), same layout as h */
  speed?: (x: number, z: number) => number;
  /** walkable decks above the ground (a bridge over a gully): these win over the heightfield */
  platforms?: { x0: number; z0: number; x1: number; z1: number; y: number }[];
  /** does a shot at (x, y, z) hit something solid (below the top of what stands there)? */
  shot?: (x: number, y: number, z: number) => boolean;
};

let T: Terrain | null = null;

/** Live weather push (metres per second) applied to walking players; the alpine blizzard drives it. */
export const wind = { x: 0, z: 0 };

export function setTerrain(t: Terrain | null) {
  T = t;
  wind.x = 0;
  wind.z = 0;
}

export function hasTerrain() {
  return T !== null;
}

/** Height of the ground at (x, z), in metres. */
export function groundY(x: number, z: number) {
  const t = T;
  if (!t) return 0;
  if (t.platforms)
    for (const p of t.platforms) if (x > p.x0 && x < p.x1 && z > p.z0 && z < p.z1) return p.y;
  return terrainY(x, z);
}

/** the bare heightfield (what the terrain mesh draws), ignoring decks */
export function terrainY(x: number, z: number) {
  const t = T;
  if (!t) return 0;
  const n = t.n;
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
  const s = n + 1;
  const h = t.h;
  const a = h[i * s + j]!;
  const b = h[(i + 1) * s + j]!;
  const c = h[i * s + j + 1]!;
  const d = h[(i + 1) * s + j + 1]!;
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Walking-speed multiplier at (x, z): 1 on flat maps and on paths, lower in deep snow. */
export function groundSpeed(x: number, z: number) {
  return T?.speed ? T.speed(x, z) : 1;
}

/**
 * Height-aware shot collision on maps with terrain: true when (x, y, z) is inside something
 * solid. Returns null on flat maps so callers fall back to their 2D block test.
 */
export function shotHits(x: number, y: number, z: number): boolean | null {
  if (!T || !T.shot) return null;
  return y < terrainY(x, z) || T.shot(x, y, z);
}
