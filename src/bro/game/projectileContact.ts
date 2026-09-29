import { Vector3 } from "three";
import { hitBandInto } from "./enemyKinds";
import { groundY } from "./terrain";
import { staticRayContact } from "./staticCollision";
type Point = { x: number; y: number; z: number };
export type Body = { x: number; z: number; alive: boolean; kind: string; generation?: number };

const _band: [number, number] = [0, 0];

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
  const band = hitBandInto(e.kind, _band),
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

export type BodyHit<T extends Body = Body> = { e: T; i: number; t: number };
const hitPool: BodyHit[] = [];

/**
 * Ordered body hits along a segment. The returned array and its entries are borrowed
 * scratch: they are overwritten by the next call (callers consume them immediately).
 */
export function bodyContacts<T extends Body>(
  from: Point,
  to: Point,
  enemies: readonly T[],
  radius: (kind: string) => number,
  seen: Map<Body, number>,
  limit = 1,
  out: BodyHit<T>[] = [],
) {
  out.length = 0;
  let n = 0;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i]!;
    if (!e.alive || seen.get(e) === (e.generation ?? 0)) continue;
    const t = bodyContact(from, to, e, radius(e.kind) + 0.2);
    if (t === undefined || t >= limit) continue;
    const h = (hitPool[n] ??= { e: e as Body, i: 0, t: 0 });
    h.e = e;
    h.i = i;
    h.t = t;
    out[n++] = h as BodyHit<T>;
  }
  out.length = n;
  return out.sort((a, b) => a.t - b.t);
}

export type WorldContact = { point: Vector3; safe: Vector3; normal: Vector3 };

const _wcA = new Vector3();
const _wcB = new Vector3();
const _wcD = new Vector3();
const _wcProbe = new Vector3();
const _wcPt = { x: 0, y: 0, z: 0 };
const _wc: WorldContact = { point: new Vector3(), safe: new Vector3(), normal: new Vector3() };

/**
 * Keep the physics point clear of the face and preserve the actual face for impact art.
 * The returned contact is borrowed scratch: overwritten by the next call (callers copy
 * what they need before contacting anything else).
 */
export function worldContact(
  from: Point,
  to: Point,
  t: number,
  stop: (p: Point) => boolean,
): WorldContact {
  const a = _wcA.set(from.x, from.y, from.z),
    b = _wcB.set(to.x, to.y, to.z),
    d = _wcD.subVectors(b, a),
    len = d.length();
  const { point, safe, normal } = _wc;
  point.lerpVectors(a, b, t);
  safe.lerpVectors(a, b, Math.max(0, t - 0.003 / Math.max(0.001, len)));
  const mesh = staticRayContact(a, b, normal);
  if (mesh === undefined || Math.abs(mesh - t) > 0.002 / Math.max(0.001, len)) {
    const probe = _wcProbe.copy(point).addScaledVector(d, 0.003 / Math.max(0.001, len));
    const P = _wcPt;
    // Axis probes resolve ground/ceiling as well as walls and moving traffic.
    P.x = probe.x;
    P.y = from.y;
    P.z = from.z;
    if (stop(P)) normal.set(-Math.sign(d.x) || 1, 0, 0);
    else {
      P.x = from.x;
      P.y = probe.y;
      if (stop(P)) normal.set(0, -Math.sign(d.y) || 1, 0);
      else {
        P.y = from.y;
        P.z = probe.z;
        if (stop(P)) normal.set(0, 0, -Math.sign(d.z) || 1);
        else normal.copy(d).normalize().negate();
      }
    }
  }
  if (normal.dot(d) > 0) normal.negate();
  return _wc;
}
