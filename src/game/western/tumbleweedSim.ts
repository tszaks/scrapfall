// Finite, world-owned brush: a broken weed and its branches persist until a new arena.
export const WEED_COUNT = 32,
  PIECES_PER_WEED = 8;
export type Point = { x: number; y: number; z: number };
export type Piece = Point & {
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  rz: number;
  rest: boolean;
};
export type Weed = Point & {
  id: number;
  s: number;
  vx: number;
  vz: number;
  roll: number;
  broken: boolean;
  pieces: Piece[];
};
const poseHistory = new Map<number, Point[]>();
let fragmentVertices: number[][] = [];
export function setWeedFragmentVertices(vertices: number[][]) {
  fragmentVertices = vertices;
}
/** Lowest rendered vertex after the exact XYZ rotation used by the renderer. */
export function pieceBottom(k: number, rx: number, ry: number, rz: number, scale: number) {
  const a = Math.cos(rx),
    b = Math.sin(rx),
    c = Math.cos(ry),
    d = Math.sin(ry),
    e = Math.cos(rz),
    f = Math.sin(rz);
  const nx = a * f + b * d * e,
    ny = a * e - b * d * f,
    nz = -b * c,
    points = fragmentVertices[k];
  if (!points?.length) return -0.36 * scale;
  let low = Infinity;
  for (let i = 0; i < points.length; i += 3)
    low = Math.min(low, (nx * points[i]! + ny * points[i + 1]! + nz * points[i + 2]!) * scale);
  return low;
}
export const weedWorld = { seed: 0, seq: 0, applied: -1, acc: 0, send: 0, weeds: [] as Weed[] };
/** Guests draw and hit-test the same interpolation between two authoritative snapshots. */
export const weedView = {
  previous: null as Weed[] | null,
  target: null as Weed[] | null,
  fromSeq: -1,
  targetSeq: -1,
  blend: 1,
};
const viewQueue: { seq: number; weeds: Weed[] }[] = [];
const bottomCache = new WeakMap<Piece, number>();
function viewNext() {
  const next = viewQueue.shift();
  if (!next) return false;
  weedView.previous = weedView.target;
  weedView.fromSeq = weedView.targetSeq;
  weedView.target = next.weeds;
  weedView.targetSeq = next.seq;
  weedView.blend = 0;
  return true;
}
export function stepWeedView(dt: number) {
  let time = Math.max(0, Math.min(dt, 0.25));
  for (let i = 0; i < 4; i++) {
    if (weedView.blend >= 1 && !viewNext()) break;
    const step = Math.min(time, (1 - weedView.blend) * 0.2);
    weedView.blend = Math.min(1, weedView.blend + step / 0.2);
    time -= step;
    if (time < 1e-8) break;
  }
}
export function weedPose(w: Weed) {
  const now = weedView.target?.[w.id] ?? w,
    p = weedView.previous?.[w.id],
    t = weedView.blend;
  return p && !p.broken && t < 1
    ? {
        x: p.x + (now.x - p.x) * t,
        y: p.y + (now.y - p.y) * t,
        z: p.z + (now.z - p.z) * t,
        roll: p.roll + (now.roll - p.roll) * t,
      }
    : now;
}
export function weedPiecePose(w: Weed, k: number) {
  const p = weedView.target?.[w.id]?.pieces[k] ?? w.pieces[k]!,
    old = weedView.previous?.[w.id]?.pieces[k],
    t = weedView.blend;
  if (!old || t >= 1) return p;
  const rx = old.rx + (p.rx - old.rx) * t,
    rz = old.rz + (p.rz - old.rz) * t;
  let y = old.y + (p.y - old.y) * t;
  if (old.rx !== p.rx || old.rz !== p.rz) {
    const low = (piece: Piece) => {
      let v = bottomCache.get(piece);
      if (v === undefined) {
        v = piece.y + pieceBottom(k, piece.rx, w.id * 0.7, piece.rz, w.s);
        bottomCache.set(piece, v);
      }
      return v;
    };
    const before = low(old),
      after = low(p);
    y = before + (after - before) * t - pieceBottom(k, rx, w.id * 0.7, rz, w.s);
  }
  return { x: old.x + (p.x - old.x) * t, y, z: old.z + (p.z - old.z) * t, rx, rz };
}
export type WeedGround = {
  floor: (x: number, z: number, previous: number) => number;
  body: (x: number, z: number, r: number, feet: number) => boolean;
  clear: (a: Point, b: Point) => boolean;
};
export function resetWeeds(seed: number, positions: Point[] = []) {
  poseHistory.clear();
  Object.assign(weedView, { previous: null, target: null, fromSeq: -1, targetSeq: -1, blend: 1 });
  viewQueue.length = 0;
  Object.assign(weedWorld, {
    seed,
    seq: 0,
    applied: -1,
    acc: 0,
    send: 0,
    weeds: positions.slice(0, WEED_COUNT).map((p, id) => ({
      ...p,
      id,
      s: 0.7 + (id % 4) * 0.15,
      vx: 0,
      vz: 0,
      roll: 0,
      broken: false,
      pieces: [],
    })),
  });
}
export function sphereContact(a: Point, b: Point, c: Point, r: number) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    dz = b.z - a.z,
    ox = a.x - c.x,
    oy = a.y - c.y,
    oz = a.z - c.z;
  const aa = dx * dx + dy * dy + dz * dz,
    cc = ox * ox + oy * oy + oz * oz - r * r;
  if (cc <= 0) return 0;
  if (aa < 1e-10) return null;
  const bb = ox * dx + oy * dy + oz * dz,
    disc = bb * bb - aa * cc;
  if (disc < 0) return null;
  const t = (-bb - Math.sqrt(disc)) / aa;
  return t >= 0 && t <= 1 ? t : null;
}
export function weedContacts(
  a: Point,
  b: Point,
  limit = 1,
  snapshot?: number,
  previousSnapshot?: number,
  blend = 1,
) {
  const poses = snapshot === undefined ? null : poseHistory.get(snapshot);
  if (snapshot !== undefined && !poses) return [];
  if (!Number.isFinite(blend) || blend < 0 || blend > 1) return [];
  const previous =
    snapshot !== undefined && blend < 1 ? poseHistory.get(previousSnapshot ?? -1) : null;
  if (snapshot !== undefined && blend < 1 && (!previous || previousSnapshot! >= snapshot))
    return [];
  const hits: { id: number; t: number }[] = [];
  for (const w of weedWorld.weeds)
    if (!w.broken) {
      const now = poses?.[w.id] ?? weedPose(w),
        before = previous?.[w.id];
      const p = before
        ? {
            x: before.x + (now.x - before.x) * blend,
            y: before.y + (now.y - before.y) * blend,
            z: before.z + (now.z - before.z) * blend,
          }
        : now;
      const t = sphereContact(a, b, { x: p.x, y: p.y + 0.516 * w.s, z: p.z }, 0.516 * w.s);
      if (t !== null && t < limit) hits.push({ id: w.id, t });
    }
  return hits.sort((a, b) => a.t - b.t);
}
export function breakWeed(id: number, direction: Point) {
  const w = weedWorld.weeds[id];
  if (!w || w.broken) return false;
  w.broken = true;
  const len = Math.hypot(direction.x, direction.y, direction.z) || 1;
  for (let k = 0; k < PIECES_PER_WEED; k++) {
    const sx = k & 1 ? 1 : -1,
      sy = k & 2 ? 1 : -1,
      sz = k & 4 ? 1 : -1;
    w.pieces.push({
      x: w.x + sx * 0.18 * w.s,
      y: w.y + (0.516 + sy * 0.18) * w.s,
      z: w.z + sz * 0.18 * w.s,
      vx: sx * (0.8 + (id % 3) * 0.2) + (direction.x / len) * 2,
      vy: 1.5 + (k % 3) * 0.35 + Math.max(0, direction.y / len),
      vz: sz * (0.8 + (id % 3) * 0.2) + (direction.z / len) * 2,
      rx: 0,
      rz: 0,
      rest: false,
    });
  }
  return true;
}
export function stepWeeds(
  dt: number,
  wx: number,
  wz: number,
  strength: number,
  players: Point[],
  world: WeedGround,
) {
  weedWorld.acc += Math.min(dt, 0.25);
  while (weedWorld.acc >= 1 / 60) {
    weedWorld.acc -= 1 / 60;
    const h = 1 / 60;
    for (const w of weedWorld.weeds) {
      if (w.broken) {
        for (const [k, p] of w.pieces.entries()) {
          if (p.rest) continue;
          const nx = p.x + p.vx * h,
            nz = p.z + p.vz * h;
          if (!world.body(nx, nz, 0.04, p.y)) {
            p.x = nx;
            p.z = nz;
          } else {
            p.vx *= -0.25;
            p.vz *= -0.25;
          }
          p.vy -= 9.8 * h;
          p.y += p.vy * h;
          p.rx += p.vx * h * 3;
          p.rz += p.vz * h * 3;
          const support = world.floor(p.x, p.z, p.y),
            floor = support - pieceBottom(k, p.rx, w.id * 0.7, p.rz, w.s) + 0.005;
          if (p.y <= floor) {
            p.y = floor;
            p.vy = 0;
            p.vx *= 0.72;
            p.vz *= 0.72;
            if (Math.hypot(p.vx, p.vz) < 0.09) {
              p.rest = true;
              p.rx = 0;
              p.rz = Math.PI / 2;
              p.y = support - pieceBottom(k, p.rx, w.id * 0.7, p.rz, w.s) + 0.005;
            }
          }
        }
        continue;
      }
      const radius = 0.516 * w.s;
      for (const p of players) {
        const dx = w.x - p.x,
          dz = w.z - p.z,
          d = Math.hypot(dx, dz),
          over = 0.34 + radius - d;
        if (
          over <= 0 ||
          p.y > w.y + radius * 2 ||
          p.y + 1.8 < w.y ||
          !world.clear({ x: p.x, y: w.y + radius, z: p.z }, { x: w.x, y: w.y + radius, z: w.z })
        )
          continue;
        const ux = d > 0.001 ? dx / d : 1,
          uz = d > 0.001 ? dz / d : 0;
        const nx = w.x + ux * over,
          nz = w.z + uz * over;
        if (!world.body(nx, nz, radius, w.y)) {
          w.x = nx;
          w.z = nz;
        }
        w.vx = ux * 4;
        w.vz = uz * 4;
      }
      const response = 1 - Math.exp(-h * 0.7),
        speed = 0.45 + strength * 5;
      w.vx += (wx * speed - w.vx) * response;
      w.vz += (wz * speed - w.vz) * response;
      const dx = w.vx * h,
        dz = w.vz * h;
      if (!world.body(w.x + dx, w.z, radius, w.y)) w.x += dx;
      else w.vx *= -0.5;
      if (!world.body(w.x, w.z + dz, radius, w.y)) w.z += dz;
      else w.vz *= -0.5;
      w.roll += Math.hypot(dx, dz) / radius;
      w.y = world.floor(w.x, w.z, w.y);
    }
  }
}
/** Every snapshot includes broken identities and settled fragments; late joiners converge. */
export function encodeWeeds() {
  const seq = ++weedWorld.seq;
  poseHistory.set(
    seq,
    weedWorld.weeds.map((w) => ({ x: w.x, y: w.y, z: w.z })),
  );
  for (const old of poseHistory.keys()) if (old < seq - 3) poseHistory.delete(old);
  return {
    seed: weedWorld.seed,
    seq,
    w: weedWorld.weeds.map((w) => [
      w.x,
      w.y,
      w.z,
      w.s,
      w.roll,
      w.broken ? 1 : 0,
      ...w.pieces.flatMap((p) => [p.x, p.y, p.z, p.rx, p.rz]),
    ]),
  };
}
export function applyWeeds(data: unknown) {
  if (!data || typeof data !== "object") return false;
  const d = data as { seed?: number; seq?: number; w?: unknown };
  if (
    d.seed !== weedWorld.seed ||
    !Number.isInteger(d.seq) ||
    d.seq! <= weedWorld.applied ||
    !Array.isArray(d.w) ||
    d.w.length > WEED_COUNT
  )
    return false;
  const next: Weed[] = [];
  for (const [id, row] of d.w.entries()) {
    if (
      !Array.isArray(row) ||
      (row.length !== 6 && row.length !== 46) ||
      !row.every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 1e7)
    )
      return false;
    const [x, y, z, s, roll, broken] = row as number[];
    if (s! < 0.5 || s! > 1.5 || !(broken === 0 || broken === 1) || row.length !== (broken ? 46 : 6))
      return false;
    const pieces: Piece[] = [];
    for (let k = 6; k < row.length; k += 5)
      pieces.push({
        x: row[k],
        y: row[k + 1],
        z: row[k + 2],
        rx: row[k + 3],
        rz: row[k + 4],
        vx: 0,
        vy: 0,
        vz: 0,
        rest: true,
      });
    next.push({
      id,
      x: x!,
      y: y!,
      z: z!,
      s: s!,
      roll: roll!,
      broken: !!broken,
      pieces,
      vx: 0,
      vz: 0,
    });
  }
  if (weedWorld.applied < 0 || d.seq! - weedView.targetSeq >= 3) {
    // First join or a stalled background tab: immediately recover current authority.
    Object.assign(weedView, {
      previous: null,
      target: next,
      fromSeq: -1,
      targetSeq: d.seq!,
      blend: 1,
    });
    viewQueue.length = 0;
  } else {
    viewQueue.push({ seq: d.seq!, weeds: next });
    if (viewQueue.length > 2) viewQueue.shift();
    if (weedView.blend >= 1) viewNext();
  }
  weedWorld.weeds = next;
  weedWorld.applied = d.seq!;
  return true;
}
