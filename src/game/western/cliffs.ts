export type RockOverhang = {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y0: number;
  y1: number;
  tone: number;
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
            wide = 0.8 + r * 0.6;
          const ax = x + dx * inner - (dz ? wide : 0),
            az = z + dz * inner - (dx ? wide : 0),
            bx = x + dx * reach + (dz ? wide : 0),
            bz = z + dz * reach + (dx ? wide : 0);
          boxes.push({
            x0: Math.min(ax, bx),
            x1: Math.max(ax, bx),
            z0: Math.min(az, bz),
            z1: Math.max(az, bz),
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
      buckets
        .get(key(x, z))
        ?.some((b) => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && y >= b.y0 && y <= b.y1) ??
      false,
  };
}
