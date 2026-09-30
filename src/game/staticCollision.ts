// Physical contacts use the map's rendered triangles. Navigation keeps its cheap cell grid.
// Collision stays installed when render LOD hides a mesh; decoration is explicitly excluded.
import { Box3, BufferGeometry, DoubleSide, Line3, Matrix3, Matrix4, Ray, Vector3 } from "three";
import { MeshBVH, ExtendedTriangle } from "three-mesh-bvh";
import { yieldControl } from "./slice";

type Flags = { body: boolean; shot: boolean; support: boolean };
type Shape = { tree: MeshBVH; box: Box3 };
type Surface = Shape & Flags & { matrix?: Matrix4; inverse?: Matrix4; normal?: Matrix3 };
const groups = new Map<string, Surface[]>();
const cache = new WeakMap<BufferGeometry, Shape>();
const buckets = new Map<string, Surface[]>();
const large: Surface[] = [];
const CELL = 16;
let shotExempt: ((x: number, y: number, z: number) => boolean) | null = null;
export function setStaticShotExemption(fn: typeof shotExempt) {
  shotExempt = fn;
}
export const staticCollisionStats = { groups: 0, meshes: 0, triangles: 0 };
export function resetStaticCollision() {
  groups.clear();
  rebuild();
}
function shape(g: BufferGeometry): Shape | null {
  if (!g.getAttribute("position")?.count) return null;
  let hit = cache.get(g);
  if (hit) return hit;
  const excluded = g.userData["nonSolid"] as [number, number][] | undefined;
  let collision = g;
  if (excluded?.length) {
    const count = g.getAttribute("position").count;
    const skip = new Uint8Array(count);
    for (const [start, length] of excluded) skip.fill(1, start, start + length);
    const indices: number[] = [];
    const n = g.index?.count ?? count;
    for (let i = 0; i < n; i += 3) {
      const a = g.index?.getX(i) ?? i;
      if (!skip[a]) indices.push(a, g.index?.getX(i + 1) ?? i + 1, g.index?.getX(i + 2) ?? i + 2);
    }
    if (!indices.length) return null;
    collision = new BufferGeometry().setAttribute("position", g.getAttribute("position"));
    collision.setIndex(indices);
  }
  const tree = new MeshBVH(collision, { maxLeafTris: 12 });
  hit = { tree, box: tree.getBoundingBox(new Box3()) };
  cache.set(g, hit);
  return hit;
}
function install(key: string, list: Surface[]) {
  groups.set(key, list);
  rebuild();
  return () => {
    if (groups.get(key) === list) {
      groups.delete(key);
      rebuild();
    }
  };
}
/** worldBuild.ts walks the freshly built chunk geometries through `shape()` across
 * tasks — the map scene's layout-effect registration then finds every BVH already in
 * the WeakMap cache and the mount commit stays light. */
export async function prepareStaticSurfaces(
  geometries: (BufferGeometry | null | undefined)[],
): Promise<void> {
  for (const g of geometries) {
    if (g) shape(g);
    await yieldControl();
  }
}
export function registerStaticGeometry(
  key: string,
  geometries: (BufferGeometry | null | undefined)[],
  flags: Partial<Flags> = {},
) {
  const list: Surface[] = [];
  for (const g of geometries) {
    if (!g) continue;
    const s = shape(g);
    if (s) list.push({ ...s, body: true, shot: true, support: true, ...flags });
  }
  return install(key, list);
}
/** Share one model BVH across every instance, with exact world-space narrow-phase contacts. */
export function registerStaticInstances(
  key: string,
  instances: { geometry: BufferGeometry; matrix: Matrix4 }[],
  flags: Partial<Flags> = {},
) {
  const list: Surface[] = [];
  for (const { geometry, matrix } of instances) {
    const s = shape(geometry);
    if (!s) continue;
    list.push({
      ...s,
      box: s.box.clone().applyMatrix4(matrix),
      matrix: matrix.clone(),
      inverse: matrix.clone().invert(),
      normal: new Matrix3().getNormalMatrix(matrix),
      body: true,
      shot: true,
      support: true,
      ...flags,
    });
  }
  return install(key, list);
}
function rebuild() {
  buckets.clear();
  large.length = 0;
  let meshes = 0,
    triangles = 0;
  for (const list of groups.values())
    for (const s of list) {
      meshes++;
      triangles +=
        (s.tree.geometry.index?.count ?? s.tree.geometry.getAttribute("position").count) / 3;
      if (s.box.max.x - s.box.min.x > 64 || s.box.max.z - s.box.min.z > 64) {
        large.push(s);
        continue;
      }
      for (let i = Math.floor(s.box.min.x / CELL); i <= Math.floor(s.box.max.x / CELL); i++)
        for (let j = Math.floor(s.box.min.z / CELL); j <= Math.floor(s.box.max.z / CELL); j++) {
          const k = `${i},${j}`;
          let bin = buckets.get(k);
          if (!bin) buckets.set(k, (bin = []));
          bin.push(s);
        }
    }
  Object.assign(staticCollisionStats, { groups: groups.size, meshes, triangles });
}
export function staticCollisionReady() {
  return groups.has("map");
}
function candidates(b: Box3) {
  const result = new Set<Surface>(large);
  for (let i = Math.floor(b.min.x / CELL); i <= Math.floor(b.max.x / CELL); i++)
    for (let j = Math.floor(b.min.z / CELL); j <= Math.floor(b.max.z / CELL); j++)
      for (const s of buckets.get(`${i},${j}`) ?? []) result.add(s);
  return result;
}
const segment = new Line3(),
  box = new Box3(),
  localBox = new Box3(),
  direction = new Vector3(),
  hit = new Vector3();
const ray = new Ray(),
  localRay = new Ray(),
  end = new Vector3(),
  normal = new Vector3(),
  worldTriangle = new ExtendedTriangle();
// The library's segment distance helper misses a segment piercing the face interior.
function touchesTriangle(t: ExtendedTriangle, radius: number, kind: "body" | "shot") {
  direction.subVectors(segment.end, segment.start);
  const length = direction.length();
  if (length > 1e-8) {
    ray.origin.copy(segment.start);
    ray.direction.copy(direction).multiplyScalar(1 / length);
    if (
      ray.intersectTriangle(t.a, t.b, t.c, false, hit) &&
      hit.distanceToSquared(segment.start) <= length * length + 1e-8
    )
      return kind !== "shot" || !shotExempt?.(hit.x, hit.y, hit.z);
  }
  return (
    t.closestPointToSegment(segment, hit) < radius &&
    (kind !== "shot" || !shotExempt?.(hit.x, hit.y, hit.z))
  );
}
function touches(radius: number, kind: "body" | "shot") {
  box.makeEmpty().expandByPoint(segment.start).expandByPoint(segment.end).expandByScalar(radius);
  for (const s of candidates(box)) {
    if (!s[kind] || !s.box.intersectsBox(box)) continue;
    localBox.copy(box);
    if (s.inverse) localBox.applyMatrix4(s.inverse);
    if (
      s.tree.shapecast({
        intersectsBounds: (b) => b.intersectsBox(localBox),
        intersectsTriangle: (t) => {
          if (!s.matrix) return touchesTriangle(t, radius, kind);
          worldTriangle.a.copy(t.a).applyMatrix4(s.matrix);
          worldTriangle.b.copy(t.b).applyMatrix4(s.matrix);
          worldTriangle.c.copy(t.c).applyMatrix4(s.matrix);
          worldTriangle.needsUpdate = true;
          return touchesTriangle(worldTriangle, radius, kind);
        },
      })
    )
      return true;
  }
  return false;
}
/** Conservative candidate only; the posed triangles decide actual contact. */
export function boundsMayTouchBody(
  b: Box3,
  x: number,
  z: number,
  r: number,
  feet: number,
  height: number,
) {
  return (
    x + r >= b.min.x &&
    x - r <= b.max.x &&
    z + r >= b.min.z &&
    z - r <= b.max.z &&
    feet + height >= b.min.y &&
    feet <= b.max.y
  );
}
export function geometryBounds(geometry: BufferGeometry, matrix: Matrix4, out: Box3) {
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  return out.copy(geometry.boundingBox!).applyMatrix4(matrix);
}
export function geometryRayContact(
  geometry: BufferGeometry,
  matrix: Matrix4,
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
) {
  const s = shape(geometry);
  if (!s) return undefined;
  modelInverse.copy(matrix).invert();
  localRay.origin.set(a.x, a.y, a.z).applyMatrix4(modelInverse);
  end.set(b.x, b.y, b.z).applyMatrix4(modelInverse);
  localRay.direction.subVectors(end, localRay.origin);
  const length = localRay.direction.length();
  if (length < 1e-9) return undefined;
  localRay.direction.multiplyScalar(1 / length);
  const h = s.tree.raycastFirst(localRay, DoubleSide, 0, length);
  return h ? h.distance / length : undefined;
}
/** Query a moving model without rebuilding the map's spatial index. */
const modelInverse = new Matrix4();
function touchesModel(geometry: BufferGeometry, matrix: Matrix4, radius: number) {
  const s = shape(geometry);
  if (!s) return false;
  box.makeEmpty().expandByPoint(segment.start).expandByPoint(segment.end).expandByScalar(radius);
  modelInverse.copy(matrix).invert();
  localBox.copy(box).applyMatrix4(modelInverse);
  if (!s.box.intersectsBox(localBox)) return false;
  return s.tree.shapecast({
    intersectsBounds: (b) => b.intersectsBox(localBox),
    intersectsTriangle: (t) => {
      worldTriangle.a.copy(t.a).applyMatrix4(matrix);
      worldTriangle.b.copy(t.b).applyMatrix4(matrix);
      worldTriangle.c.copy(t.c).applyMatrix4(matrix);
      worldTriangle.needsUpdate = true;
      return touchesTriangle(worldTriangle, radius, "body");
    },
  });
}
export function geometryBody(
  geometry: BufferGeometry,
  matrix: Matrix4,
  x: number,
  z: number,
  r: number,
  feet: number,
  height = 1.8,
) {
  const cap = Math.min(r, height / 2);
  segment.start.set(x, feet + cap, z);
  segment.end.set(x, feet + height - cap, z);
  return touchesModel(geometry, matrix, Math.max(0.005, cap - 0.004));
}
export function geometryPoint(
  geometry: BufferGeometry,
  matrix: Matrix4,
  x: number,
  y: number,
  z: number,
  r = 0.05,
) {
  segment.start.set(x, y, z);
  segment.end.copy(segment.start);
  return touchesModel(geometry, matrix, r);
}
/** Round standing body. Step clearance is allowed only on the ground, never mid-jump. */
export function staticBody(x: number, z: number, r: number, feet: number, height = 1.8, step = 0) {
  segment.start.set(x, feet + r + step, z);
  segment.end.set(x, Math.max(feet + r + step, feet + height - r), z);
  return touches(Math.max(0.005, r - 0.004), "body");
}
/** Swept bullet/camera segment: even thin planks cannot disappear between frames. */
export function staticSegment(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  r = 0.025,
) {
  segment.start.set(ax, ay, az);
  segment.end.set(bx, by, bz);
  return touches(r, "shot");
}
let pointsSuppressed = false;
export function withoutStaticPoints<T>(f: () => T): T {
  const old = pointsSuppressed;
  pointsSuppressed = true;
  try {
    return f();
  } finally {
    pointsSuppressed = old;
  }
}
export function staticPoint(x: number, y: number, z: number, r = 0.05) {
  return !pointsSuppressed && staticSegment(x, y, z, x, y, z, r);
}
/** First triangle crossed by a projectile, in one BVH traversal per nearby mesh. */
export function staticRayContact(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  outNormal?: Vector3,
) {
  const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  if (length < 1e-9) return undefined;
  box.min.set(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z));
  box.max.set(Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z));
  box.expandByScalar(0.001);
  let best = Infinity;
  for (const s of candidates(box)) {
    if (!s.shot || !s.box.intersectsBox(box)) continue;
    localRay.origin.set(a.x, a.y, a.z);
    end.set(b.x, b.y, b.z);
    if (s.inverse) {
      localRay.origin.applyMatrix4(s.inverse);
      end.applyMatrix4(s.inverse);
    }
    localRay.direction.subVectors(end, localRay.origin);
    const localLength = localRay.direction.length();
    localRay.direction.multiplyScalar(1 / localLength);
    let near = 0;
    for (let pass = 0; pass < 12; pass++) {
      const h = s.tree.raycastFirst(localRay, DoubleSide, near, localLength);
      if (!h) break;
      near = h.distance + 0.001;
      if (s.matrix) h.point.applyMatrix4(s.matrix);
      if (shotExempt?.(h.point.x, h.point.y, h.point.z)) continue;
      const distance = Math.hypot(h.point.x - a.x, h.point.y - a.y, h.point.z - a.z) / length;
      if (distance < best) {
        best = distance;
        if (outNormal && h.face) {
          outNormal.copy(h.face.normal);
          if (s.normal) outNormal.applyMatrix3(s.normal).normalize();
        }
      }
      break;
    }
  }
  return Number.isFinite(best) ? best : undefined;
}
function surfaceHeight(
  s: Surface,
  x: number,
  z: number,
  from: number,
  to: number,
  upward: boolean,
) {
  localRay.origin.set(x, from, z);
  end.set(x, to, z);
  if (s.inverse) {
    localRay.origin.applyMatrix4(s.inverse);
    end.applyMatrix4(s.inverse);
  }
  localRay.direction.subVectors(end, localRay.origin);
  const length = localRay.direction.length();
  if (length < 1e-8) return null;
  localRay.direction.multiplyScalar(1 / length);
  const h = s.tree.raycastFirst(localRay, DoubleSide, 0, length);
  if (!h?.face) return null;
  normal.copy(h.face.normal);
  if (s.normal) normal.applyMatrix3(s.normal).normalize();
  if (upward && normal.y < 0.45) return null;
  if (s.matrix) h.point.applyMatrix4(s.matrix);
  return h.point.y;
}
/** Support beneath the previous feet. Sampling the foot circle keeps small edge contacts stable. */
export function staticSupport(
  x: number,
  z: number,
  previousFeet: number,
  minimum: number,
  step = 0.2,
  r = 0.18,
) {
  let top = minimum;
  const from = previousFeet + step + 0.002;
  box.min.set(x - r, minimum - 0.01, z - r);
  box.max.set(x + r, from, z + r);
  for (const s of candidates(box)) {
    if (!s.support || !s.box.intersectsBox(box)) continue;
    for (const [dx, dz] of [
      [0, 0],
      [r, 0],
      [-r, 0],
      [0, r],
      [0, -r],
    ]) {
      const px = x + dx!,
        pz = z + dz!;
      if (px < s.box.min.x || px > s.box.max.x || pz < s.box.min.z || pz > s.box.max.z) continue;
      const y = surfaceHeight(s, px, pz, from, top - 0.01, true);
      if (y !== null && y > top) top = y;
    }
  }
  return top;
}
export function staticCeiling(x: number, z: number, head: number, nextHead: number, r = 0.2) {
  if (nextHead <= head) return null;
  let ceiling = Infinity;
  box.min.set(x - r, head, z - r);
  box.max.set(x + r, nextHead + 0.01, z + r);
  for (const s of candidates(box)) {
    if (!s.body || !s.box.intersectsBox(box)) continue;
    for (const [dx, dz] of [
      [0, 0],
      [r, 0],
      [-r, 0],
      [0, r],
      [0, -r],
    ]) {
      const y = surfaceHeight(s, x + dx!, z + dz!, head, nextHead + 0.01, false);
      if (y !== null) ceiling = Math.min(ceiling, y);
    }
  }
  return Number.isFinite(ceiling) ? ceiling : null;
}
