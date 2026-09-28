import { Vector3 } from "three";
import { hitBand } from "./enemyKinds";
import { groundY } from "./terrain";
import { staticRayContact } from "./staticCollision";
type Point = { x: number; y: number; z: number };
export type Body = { x: number; z: number; alive: boolean; kind: string; generation?: number };
/** Segment/cylinder intersection clipped by the actual vertical body band. */
export function bodyContact(from: Point, to: Point, e: Body, radius: number) {
  const dx = to.x - from.x,
    dy = to.y - from.y,
    dz = to.z - from.z;
  const ox = from.x - e.x,
    oz = from.z - e.z,
    a = dx * dx + dz * dz,
    c = ox * ox + oz * oz - radius * radius;
  let lo = 0,
    hi = 1;
  if (a < 1e-12) {
    if (c > 0) return undefined;
  } else {
    const b = ox * dx + oz * dz,
      disc = b * b - a * c;
    if (disc < 0) return undefined;
    const q = Math.sqrt(disc);
    lo = Math.max(lo, (-b - q) / a);
    hi = Math.min(hi, (-b + q) / a);
  }
  const band = hitBand(e.kind),
    y = from.y - groundY(e.x, e.z);
  if (Math.abs(dy) < 1e-12) {
    if (y < band[0] || y > band[1]) return undefined;
  } else {
    let a = (band[0] - y) / dy,
      b = (band[1] - y) / dy;
    if (a > b) [a, b] = [b, a];
    lo = Math.max(lo, a);
    hi = Math.min(hi, b);
  }
  return lo <= hi && hi >= 0 && lo <= 1 ? Math.max(0, lo) : undefined;
}
export function bodyContacts<T extends Body>(
  from: Point,
  to: Point,
  enemies: readonly T[],
  radius: (kind: string) => number,
  seen: Map<Body, number>,
  limit = 1,
) {
  const hits: { e: T; i: number; t: number }[] = [];
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i]!;
    if (!e.alive || seen.get(e) === (e.generation ?? 0)) continue;
    const t = bodyContact(from, to, e, radius(e.kind) + 0.2);
    if (t !== undefined && t < limit) hits.push({ e, i, t });
  }
  return hits.sort((a, b) => a.t - b.t);
}
export type WorldContact = { point: Vector3; safe: Vector3; normal: Vector3 };
/** Keep the physics point clear of the face and preserve the actual face for impact art. */
export function worldContact(
  from: Point,
  to: Point,
  t: number,
  stop: (p: Point) => boolean,
): WorldContact {
  const a = new Vector3(from.x, from.y, from.z),
    b = new Vector3(to.x, to.y, to.z),
    d = b.clone().sub(a),
    len = d.length();
  const point = a.clone().lerp(b, t),
    safe = a.clone().lerp(b, Math.max(0, t - 0.003 / Math.max(0.001, len))),
    normal = new Vector3();
  const mesh = staticRayContact(a, b, normal);
  if (mesh === undefined || Math.abs(mesh - t) > 0.002 / Math.max(0.001, len)) {
    const probe = point.clone().addScaledVector(d, 0.003 / Math.max(0.001, len));
    // Axis probes resolve ground/ceiling as well as walls and moving traffic.
    if (stop({ x: probe.x, y: from.y, z: from.z })) normal.set(-Math.sign(d.x) || 1, 0, 0);
    else if (stop({ x: from.x, y: probe.y, z: from.z })) normal.set(0, -Math.sign(d.y) || 1, 0);
    else if (stop({ x: from.x, y: from.y, z: probe.z })) normal.set(0, 0, -Math.sign(d.z) || 1);
    else normal.copy(d).normalize().negate();
  }
  if (normal.dot(d) > 0) normal.negate();
  return { point, safe, normal };
}
