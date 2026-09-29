/** One source of truth for the annular stair's floor and walkable footprint. */
export type Spiral = { inner: number; outer: number; centerD: number; gap: number };
export const TAU = Math.PI * 2;
export function spiralAngle(s: Spiral, a: number, d: number) {
  return (Math.atan2(-a, s.centerD - d) + TAU) % TAU;
}
export function spiralPoint(s: Spiral, angle: number, radius: number): [number, number] {
  return [-Math.sin(angle) * radius, s.centerD - Math.cos(angle) * radius];
}
export function spiralRegion(s: Spiral, a: number, d: number) {
  const t = spiralAngle(s, a, d);
  return d < s.centerD - s.outer * Math.cos(s.gap) || t < s.gap || t > TAU - s.gap ? 0 : t < Math.PI ? 1 : 3;
}
export function spiralRise(s: Spiral, a: number, d: number) {
  const t = spiralAngle(s, a, d);
  return spiralRegion(s, a, d) === 0 ? 0 : (t - s.gap) / (TAU - 2 * s.gap);
}
/** The floor is an annulus plus a front landing. End caps close the nonexistent basement
 * and the nonexistent flight above the last landing. Body clearance is sampled against the
 * union, so the overlap with the landing never creates a rectangular invisible wall. */
export function spiralContains(s: Spiral, a: number, d: number, r: number,
  front: { a0: number; a1: number; d0: number; d1: number }[], lap: number, laps: number, region: number) {
  const contains = (x: number, z: number) => {
    if (front.some(q => x >= q.a0 && x <= q.a1 && z >= q.d0 && z <= q.d1)) return true;
    const radius = Math.hypot(x, z - s.centerD);
    if (radius < s.inner || radius > s.outer) return false;
    const t = spiralAngle(s, x, z);
    if (region === 0 && lap === 0 && t > Math.PI && t <= TAU - s.gap) return false;
    if (region === 0 && lap >= laps && t < Math.PI && t >= s.gap) return false;
    return true;
  };
  if (!contains(a, d)) return false;
  for (let n = 0; n < 16; n++) {
    const t = n * TAU / 16;
    if (!contains(a + Math.cos(t) * r, d + Math.sin(t) * r)) return false;
  }
  return true;
}
