/** Acceleration in game metres/s². Energy weapons remain straight; metal rounds arc.
 * Both damage simulation and remote visuals call this exact integration. */
const GRAVITY: Record<number, number> = {
  19: 4.8,
  0: 0.65,
  1: 1.1,
  2: 0.75,
  3: 0.12,
  4: 1.8,
  6: 2.4,
  7: 0.5,
  8: 2.2,
  11: 3,
  13: 0.8,
  14: 0.9,
  15: 3.8,
  18: 1.2,
};
export const bulletGravity = (kind: number) => GRAVITY[kind] ?? 0;
export function advanceBallistic(
  p: { x: number; y: number; z: number },
  v: { x: number; y: number; z: number },
  gravity: number,
  dt: number,
) {
  p.x += v.x * dt;
  p.y += v.y * dt - 0.5 * gravity * dt * dt;
  p.z += v.z * dt;
  v.y -= gravity * dt;
}

/** Fixed-speed low arc through a sight zero. Unreachable points retain the direct bearing. */
export function ballisticDirection<T extends { x: number; y: number; z: number }>(
  out: T,
  from: T,
  target: T,
  speed: number,
  gravity: number,
): T {
  const x = target.x - from.x,
    y = target.y - from.y,
    z = target.z - from.z,
    d2 = x * x + y * y + z * z;
  let aimY = y;
  if (gravity > 0 && speed > 0) {
    const a = speed * speed - gravity * y,
      disc = a * a - gravity * gravity * d2;
    if (a > 0 && disc >= 0) {
      const t2 = (2 * d2) / (a + Math.sqrt(disc));
      aimY += 0.5 * gravity * t2;
    }
  }
  const len = Math.hypot(x, aimY, z) || 1;
  out.x = x / len;
  out.y = aimY / len;
  out.z = z / len;
  return out;
}
