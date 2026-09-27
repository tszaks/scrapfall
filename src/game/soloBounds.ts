// Solo play on the big maps: the same full map is generated for solo and co-op, but solo
// seals a smaller playable square (70% of the arena) with in-world blockades. This module
// finds every place where walkable ground crosses that square's edge and turns each opening
// into solid 2 m collision cells; the map decides how to dress them (barriers, trucks, fences).
import type { Block } from "./level";

/** An opening in the ring: centre (x, z), width w in metres, running along `axis`. */
export type Gap = { x: number; z: number; w: number; axis: "x" | "z" };

const CELL = 2;

/** Half-size of the solo playable square: 70% of the arena's, snapped to the 2 m grid. */
export function soloHalf(arenaHalf: number): number {
  return Math.round((arenaHalf * 0.7) / CELL) * CELL;
}

/** True when (x, z) lies inside the solo square of half-size `half`. */
export function inSolo(x: number, z: number, half: number): boolean {
  return Math.abs(x) < half && Math.abs(z) < half;
}

/**
 * Every opening where walkable ground crosses the ring of half-size `half`, merged into runs.
 * The ring is sampled on the cells just outside the square (centres at +-(half + cell / 2)),
 * one sample per `cell` metres; consecutive walkable samples along one side form one gap.
 */
export function findGaps(
  isWalkable: (x: number, z: number) => boolean,
  half: number,
  cell: number,
): Gap[] {
  const gaps: Gap[] = [];
  const edge = half + cell / 2;
  // the four sides; each runs along one axis at a fixed perpendicular coordinate
  const sides: { axis: "x" | "z"; at: number }[] = [
    { axis: "x", at: -edge },
    { axis: "x", at: edge },
    { axis: "z", at: -edge },
    { axis: "z", at: edge },
  ];
  for (const s of sides) {
    let run: number[] = [];
    const flush = () => {
      if (!run.length) return;
      const a = run[0]!;
      const b = run[run.length - 1]!;
      const mid = (a + b) / 2;
      const w = b - a + cell;
      gaps.push(
        s.axis === "x" ? { x: mid, z: s.at, w, axis: "x" } : { x: s.at, z: mid, w, axis: "z" },
      );
      run = [];
    };
    // include the corner cells so diagonal leaks round the corners are sealed too
    for (let t = -edge; t <= edge + 1e-6; t += cell) {
      const x = s.axis === "x" ? t : s.at;
      const z = s.axis === "x" ? s.at : t;
      if (isWalkable(x, z)) run.push(t);
      else flush();
    }
    flush();
  }
  return gaps;
}

/** Solid 2 m collision blocks (cell-centred) filling every gap. */
export function sealGaps(gaps: Gap[]): Block[] {
  const out: Block[] = [];
  const seen = new Set<string>();
  for (const g of gaps) {
    const n = Math.max(1, Math.round(g.w / CELL));
    const start = (g.axis === "x" ? g.x : g.z) - ((n - 1) * CELL) / 2;
    for (let k = 0; k < n; k++) {
      const t = start + k * CELL;
      const x = g.axis === "x" ? t : g.x;
      const z = g.axis === "x" ? g.z : t;
      const key = `${x},${z}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ x, z, h: 2.4, tone: 0 });
    }
  }
  return out;
}
