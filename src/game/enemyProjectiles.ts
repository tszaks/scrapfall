/** Enemy projectiles are simulated and resolved once by the host. Guest snapshots are visual. */
export type ShotTarget = { id: string | null; x: number; y: number; z: number };
type Point = { x: number; y: number; z: number };

/** Earliest player touched by a swept projectile, including frames that cross a whole body. */
export function firstShotTarget(
  from: Point,
  to: Point,
  targets: readonly ShotTarget[],
  radius = 0.6,
) {
  const dx = to.x - from.x,
    dy = to.y - from.y,
    dz = to.z - from.z;
  const length2 = dx * dx + dy * dy + dz * dz;
  let first: ShotTarget | null = null;
  let firstT = Infinity;
  for (const target of targets) {
    const ox = from.x - target.x,
      oy = from.y - target.y,
      oz = from.z - target.z;
    const c = ox * ox + oy * oy + oz * oz - radius * radius;
    let t = 0;
    if (c > 0) {
      if (length2 === 0) continue;
      const b = ox * dx + oy * dy + oz * dz;
      const disc = b * b - length2 * c;
      if (disc < 0) continue;
      t = (-b - Math.sqrt(disc)) / length2;
      if (t < 0 || t > 1) continue;
    }
    if (t < firstT) {
      first = target;
      firstT = t;
    }
  }
  return first;
}
