// Solo play on the big maps: the full co-op map is generated and drawn, but a solo player
// is kept inside a square ~70% of its size by in-world blockades. This module finds every
// place where walkable ground crosses that square's edge and turns each opening into solid
// collision blocks; each map dresses the openings in its own theme.
import { BLOCK, type Block } from "./level";

export type Gap = { x: number; z: number; w: number; axis: "x" | "z" };

/** Half-size of the solo square: 70% of the arena, snapped to the 2 m grid. */
export function soloHalf(arenaHalf: number): number {
  return Math.round((arenaHalf * 0.7) / BLOCK) * BLOCK;
}

export function inSolo(x: number, z: number, half: number): boolean {
  return Math.abs(x) < half && Math.abs(z) < half;
}

/**
 * Every opening where walkable ground crosses the solo ring, merged into runs. The ring is
 * the line of cells just inside the square's edge; a gap is a run of walkable cells along
 * one side. `axis` is the direction the gap runs along ("x" for the north and south sides),
 * (x, z) its centre and `w` its length in metres.
 */
export function findGaps(
  isWalkable: (x: number, z: number) => boolean,
  half: number,
  cell: number,
): Gap[] {
  const gaps: Gap[] = [];
  const edge = half - cell / 2; // centre line of the ring cells
  const n = Math.round((half * 2) / cell);
  const sides: { axis: "x" | "z"; at: (t: number) => [number, number] }[] = [
    { axis: "x", at: (t) => [t, -edge] },
    { axis: "x", at: (t) => [t, edge] },
    { axis: "z", at: (t) => [-edge, t] },
    { axis: "z", at: (t) => [edge, t] },
  ];
  for (const s of sides) {
    let start = -1;
    for (let k = 0; k <= n; k++) {
      const t = -half + cell / 2 + k * cell;
      const open = k < n && isWalkable(...s.at(t));
      if (open && start < 0) start = k;
      if (!open && start >= 0) {
        const t0 = -half + cell / 2 + start * cell;
        const t1 = -half + cell / 2 + (k - 1) * cell;
        const mid = (t0 + t1) / 2;
        const [x, z] = s.at(mid);
        gaps.push({ x, z, w: t1 - t0 + cell, axis: s.axis });
        start = -1;
      }
    }
  }
  return gaps;
}

/** Solid 2 m collision blocks that seal each gap (two cells deep so nothing squeezes past). */
export function sealGaps(gaps: Gap[]): Block[] {
  const out: Block[] = [];
  for (const g of gaps) {
    const cells = Math.round(g.w / BLOCK);
    for (let k = 0; k < cells; k++) {
      const t = -g.w / 2 + BLOCK / 2 + k * BLOCK;
      for (const depth of [0, 1]) {
        // the second row sits one cell further out, past the ring
        const out1 = depth * BLOCK;
        if (g.axis === "x") {
          const dz = Math.sign(g.z) * out1;
          out.push({ x: g.x + t, z: g.z + dz, h: 3, tone: 0 });
        } else {
          const dx = Math.sign(g.x) * out1;
          out.push({ x: g.x + dx, z: g.z + t, h: 3, tone: 0 });
        }
      }
    }
  }
  return out;
}

/**
 * Convenience for callers that only have a Block list: the walkable test is "no block on
 * this 2 m cell". `arenaHalf` is the arena's half-size (cells are centred on -half + 1 + 2i).
 */
export function walkableFromBlocks(blocks: Block[], arenaHalf: number) {
  const cells = Math.round((arenaHalf * 2) / BLOCK);
  const g = new Uint8Array(cells * cells);
  const at = (v: number) => Math.floor((v + arenaHalf) / BLOCK);
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
