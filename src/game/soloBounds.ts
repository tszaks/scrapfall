// Solo play area for the big maps. Every big map always generates its full co-op layout
// (same seed, same map); solo play is fenced into a smaller square in the middle of it with
// in-world blockades. The rest of the map stays visible beyond them as backdrop.
//
// The square's edge runs along a "ring": one row of 2 m cells just outside the playable
// square on each side (corners included). Anything walkable on that ring is an opening
// (a road, path or open ground crossing it). findGaps() merges the openings into runs,
// sealGaps() turns every run into solid collision cells, so after sealing the ring is
// completely solid and nothing (players, enemies, flow fields) can get through. Each map
// dresses its gaps with themed barricade props.
import type { Block } from "./level";

/** An opening in the solo ring: centre, width in metres, and the axis the gap runs along
 * ("x" for the north and south sides, where the ring runs along x; "z" for east and west). */
export type Gap = { x: number; z: number; w: number; axis: "x" | "z" };

/** the solo square's grid (2 m cells, like every big map) */
const GRID = 2;
/** solo is the same map with the edges pulled in: 70% of the co-op half-size */
const SOLO_SCALE = 0.7;

/** Half-size of the solo square: 70% of the arena's half-size, snapped to the 2 m grid. */
export function soloHalf(arenaHalf: number): number {
  return Math.round((arenaHalf * SOLO_SCALE) / GRID) * GRID;
}

/** True when (x, z) lies inside the solo square of half-size `half`. */
export function inSolo(x: number, z: number, half: number): boolean {
  return Math.abs(x) < half && Math.abs(z) < half;
}

/**
 * Walk the boundary ring of the solo square over the walkable grid and return every
 * opening (a road, path or open ground crossing the ring) as merged gaps. The ring is the
 * row of `cell`-sized cells just outside the square (cell centres at +-(half + cell / 2)),
 * corners included. Callers place themed barricade props in each gap.
 */
export function findGaps(
  isWalkable: (x: number, z: number) => boolean,
  half: number,
  cell: number,
): Gap[] {
  const ring = half + cell / 2;
  const n = Math.round((ring * 2) / cell) + 1; // cells along one side, corner to corner
  const gaps: Gap[] = [];
  // side: [fixed coordinate, axis the ring runs along]
  const sides: [number, "x" | "z"][] = [
    [-ring, "x"], // north (z = -ring)
    [ring, "x"], // south
    [-ring, "z"], // west (x = -ring)
    [ring, "z"], // east
  ];
  for (const [fixed, axis] of sides) {
    let run0 = -1;
    const flush = (end: number) => {
      if (run0 < 0) return;
      const a = -ring + run0 * cell;
      const b = -ring + (end - 1) * cell;
      const mid = (a + b) / 2;
      const w = b - a + cell;
      gaps.push(axis === "x" ? { x: mid, z: fixed, w, axis } : { x: fixed, z: mid, w, axis });
      run0 = -1;
    };
    for (let k = 0; k < n; k++) {
      const t = -ring + k * cell;
      // corner cells belong to the north/south sides only, so no opening is counted twice
      if (axis === "z" && (k === 0 || k === n - 1)) {
        flush(k);
        continue;
      }
      const open = axis === "x" ? isWalkable(t, fixed) : isWalkable(fixed, t);
      if (open) {
        if (run0 < 0) run0 = k;
      } else flush(k);
    }
    flush(n);
  }
  return gaps;
}

/** Solid collision Blocks that seal every gap (so nothing can path through), 2 m cells. */
export function sealGaps(gaps: Gap[]): Block[] {
  const out: Block[] = [];
  for (const g of gaps) {
    const cells = Math.max(1, Math.round(g.w / GRID));
    const start = (g.axis === "x" ? g.x : g.z) - ((cells - 1) * GRID) / 2;
    for (let k = 0; k < cells; k++) {
      const t = start + k * GRID;
      out.push(
        g.axis === "x"
          ? { x: t, z: g.z, h: 3, tone: 0 }
          : { x: g.x, z: t, h: 3, tone: 0 },
      );
    }
  }
  return out;
}

/**
 * Convenience for callers that only have a Block list: the walkable test is "no block on
 * this 2 m cell". `half` is the arena's half-size (cells are centred on -half + 1 + 2i).
 */
export function walkableFromBlocks(blocks: Block[], arenaHalf: number) {
  const cells = Math.round((arenaHalf * 2) / GRID);
  const g = new Uint8Array(cells * cells);
  const at = (v: number) => Math.floor((v + arenaHalf) / GRID);
  for (const b of blocks) {
    const i = at(b.x);
    const j = at(b.z);
    if (i >= 0 && j >= 0 && i < cells && j < cells) g[i * cells + j] = 1;
  }
  return (x: number, z: number) => {
    const i = at(x);
    const j = at(z);
    if (i < 0 || j < 0 || i >= cells || j >= cells) return false;
    return !g[i * cells + j];
  };
}
