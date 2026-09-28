export type RockOverhang = {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y0: number;
  y1: number;
  tone: number;
  upper: [number, number][];
  lower: [number, number][];
};
/** Erosion leaves resistant shelves above the walkable foot of a cliff. All shelves have
 * visible undersides and matching bullet/camera solids; they never close the ground path. */
export function cliffShelves(rock: Float32Array, cells: number, half: number) {
  const boxes: RockOverhang[] = [];
  const h = (i: number, j: number) =>
    i < 0 || j < 0 || i >= cells || j >= cells ? 0 : rock[i * cells + j]!;
  for (let i = 2; i < cells - 2; i++)
    for (let j = 2; j < cells - 2; j++) {
      const top = h(i, j);
      if (top < 13) continue;
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        if (h(i + dx, j + dz) > 0 || h(i + dx * 2, j + dz * 2) > 0) continue;
        const hash = Math.sin(i * 17.13 + j * 43.71 + dx * 7.7 + dz * 9.4) * 43758.5453,
          r = hash - Math.floor(hash);
        if (r > 0.34) continue;
        const x = -half + 1 + i * 2,
          z = -half + 1 + j * 2,
          y = 4.1 + r * 3;
        for (let layer = 0; layer < 2; layer++) {
          const reach = layer === 0 ? 1.5 + r : 2.15 + r,
            inner = -1.5,
            wide = (2.2 + r * 3) * (layer ? 1.08 : 1);
          const ax = x + dx * inner - (dz ? wide : 0),
            az = z + dz * inner - (dx ? wide : 0),
            bx = x + dx * reach + (dz ? wide : 0),
            bz = z + dz * reach + (dx ? wide : 0);
          const x0 = Math.min(ax, bx),
            x1 = Math.max(ax, bx),
            z0 = Math.min(az, bz),
            z1 = Math.max(az, bz),
            cx = (x0 + x1) / 2,
            cz = (z0 + z1) / 2,
            bevel = Math.min(x1 - x0, z1 - z0) * (0.18 + r * 0.22);
          // Broken corners and a tapered underside read as a stratum, not a masonry box.
          const upper: [number, number][] = [
            [x0 + bevel, z0],
            [x1 - bevel * 0.8, z0],
            [x1, z0 + bevel * 0.8],
            [x1, z1 - bevel * 1.2],
            [x1 - bevel * 1.2, z1],
            [x0 + bevel * 0.7, z1],
            [x0, z1 - bevel * 0.7],
            [x0, z0 + bevel],
          ];
          const lower: [number, number][] = upper.map(([px, pz]) => [
            cx + (px - cx) * 0.87,
            cz + (pz - cz) * 0.87,
          ]);
          boxes.push({
            upper,
            lower,
            x0,
            x1,
            z0,
            z1,
            y0: y + layer * 0.48,
            y1: y + layer * 0.48 + 0.52,
            tone: 0.8 + r * 0.25,
          });
        }
      }
    }
  const buckets = new Map<number, RockOverhang[]>(),
    key = (x: number, z: number) => Math.floor(x / 16) * 65536 + Math.floor(z / 16);
  for (const b of boxes)
    for (let x = Math.floor(b.x0 / 16); x <= Math.floor(b.x1 / 16); x++)
      for (let z = Math.floor(b.z0 / 16); z <= Math.floor(b.z1 / 16); z++) {
        const k = x * 65536 + z,
          a = buckets.get(k) ?? [];
        a.push(b);
        buckets.set(k, a);
      }
  return {
    boxes,
    hits: (x: number, y: number, z: number) =>
      buckets.get(key(x, z))?.some((b) => overhangContains(b, x, y, z)) ?? false,
  };
}

/** Test the same tapered convex prism emitted by overhangTriangles. */
export function overhangContains(b: RockOverhang, x: number, y: number, z: number): boolean {
  if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1 || y < b.y0 || y > b.y1) return false;
  const t = (y - b.y0) / (b.y1 - b.y0);
  for (let i = 0; i < b.upper.length; i++) {
    const j = (i + 1) % b.upper.length,
      a = b.lower[i]!,
      A = b.upper[i]!,
      c = b.lower[j]!,
      C = b.upper[j]!;
    const ax = a[0] + (A[0] - a[0]) * t,
      az = a[1] + (A[1] - a[1]) * t,
      cx = c[0] + (C[0] - c[0]) * t,
      cz = c[1] + (C[1] - c[1]) * t;
    if ((cx - ax) * (z - az) - (cz - az) * (x - ax) < -1e-7) return false;
  }
  return true;
}
type Point = [number, number, number];
export function overhangTriangles(b: RockOverhang): [Point, Point, Point][] {
  const lo: Point[] = b.lower.map(([x, z]) => [x, b.y0, z]),
    hi: Point[] = b.upper.map(([x, z]) => [x, b.y1, z]),
    tris: [Point, Point, Point][] = [];
  for (let i = 0; i < lo.length; i++) {
    const j = (i + 1) % lo.length;
    tris.push([lo[i]!, hi[i]!, hi[j]!], [lo[i]!, hi[j]!, lo[j]!]);
    if (i > 0 && i < lo.length - 1) tris.push([lo[0]!, lo[i]!, lo[j]!], [hi[0]!, hi[j]!, hi[i]!]);
  }
  return tris;
}
