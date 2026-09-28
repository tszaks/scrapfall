import { trafficRayContact } from "./trafficCore";
import { staticCollisionReady, staticRayContact, withoutStaticPoints } from "./staticCollision";
/** Enemy projectiles are simulated and resolved once by the host. Guest snapshots are visual. */
export type ShotTarget = { id: string | null; x: number; y: number; z: number };
type Point = { x: number; y: number; z: number };

/** Earliest player touched by a swept projectile, including frames that cross a whole body. */
export function firstShotContact(
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
  return first ? { target: first, t: firstT } : null;
}

export function firstShotTarget(
  from: Point,
  to: Point,
  targets: readonly ShotTarget[],
  radius = 0.6,
) {
  return firstShotContact(from, to, targets, radius)?.target ?? null;
}

const probe: Point = { x: 0, y: 0, z: 0 };
/** First sampled world contact along a round's whole movement, not only its endpoint. */
export function firstWorldHit(from: Point, to: Point, stop: (p: Point) => boolean) {
  const nearest = Math.min(
    staticCollisionReady() ? (staticRayContact(from, to) ?? Infinity) : Infinity,
    trafficRayContact(from, to) ?? Infinity,
  );
  const mesh = Number.isFinite(nearest) ? nearest : undefined;
  return withoutStaticPoints(() => {
    const dx = to.x - from.x,
      dy = to.y - from.y,
      dz = to.z - from.z;
    const limit = mesh ?? 1,
      n = Math.max(1, Math.ceil((Math.hypot(dx, dy, dz) * limit) / 0.1));
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * limit;
      probe.x = from.x + dx * t;
      probe.y = from.y + dy * t;
      probe.z = from.z + dz * t;
      if (!stop(probe)) continue;
      let lo = Math.max(0, ((i - 1) / n) * limit),
        hi = t;
      for (let j = 0; j < 7; j++) {
        const m = (lo + hi) / 2;
        probe.x = from.x + dx * m;
        probe.y = from.y + dy * m;
        probe.z = from.z + dz * m;
        if (stop(probe)) hi = m;
        else lo = m;
      }
      return hi;
    }
    return mesh;
  });
}
/** Ordered player contact and sampled world sweep. `null` is cover, `undefined` is clear.
 * Only test the prefix before the earliest player, so a wall behind them cannot erase a hit.
 * World geometry exposes point queries; 10 cm probes prevent ordinary thin-wall tunneling. */
export function firstShotImpact(
  from: Point,
  to: Point,
  targets: readonly ShotTarget[],
  stop: (p: Point) => boolean,
) {
  const hit = firstShotContact(from, to, targets);
  const limit = hit?.t ?? 1;
  const end = {
    x: from.x + (to.x - from.x) * limit,
    y: from.y + (to.y - from.y) * limit,
    z: from.z + (to.z - from.z) * limit,
  };
  if (firstWorldHit(from, end, stop) !== undefined) return null;
  return hit?.target;
}
