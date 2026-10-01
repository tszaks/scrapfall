import { HAZARD_WARNING_SCALE } from "../input/movement";
// WHITEOUT PASS AVALANCHE: a telegraphed hazard. A rumble and a banner, the threatened
// ski run flashes red for a few seconds, then a wall of snow sweeps down the mountain face
// and spills out into the village below it. Anyone caught in the front is knocked flat and
// hurt (enemies too, on the host); it leaves snow mounds across the run-out that block the
// way until they settle and clear.
//
// Zones: the face above the village can't be walked and the summit island (lift only) is
// its own zone, so the danger and the mounds only ever land on walkable village ground.
import { alpineZone, type AlpineLayout, type APath, type P2 } from "../alpine/layout";
import { groundY } from "../terrain";
import type { EventCtx, MapEventDef } from "./mapEvents";

// Preserve the old escape distance during the warning at the new walking speed.
export const AV_WARN = 5 * HAZARD_WARNING_SCALE;
export const AV_SPEED = 19; // m/s down the run
export const AV_CLEAR = 8; // seconds the mounds take to settle away
export const AV_LEN = 34 + (AV_WARN - 5);

export type AvPlan = {
  run: APath;
  /** arc length where the walkable village ground begins (the danger band starts there) */
  walkFrom: number;
  pts: P2[];
  /** cumulative arc length at each point */
  acc: number[];
  total: number;
  /** half-width of the danger band */
  half: number;
  mounds: { x: number; z: number; r: number }[];
  name: string;
};

const hash = (a: number, b: number) => {
  let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** point and direction at arc length s along the run */
export function runAt(p: AvPlan, s: number) {
  const { pts, acc } = p;
  let k = 0;
  while (k + 2 < pts.length && acc[k + 1]! < s) k++;
  const a = pts[k]!;
  const b = pts[k + 1]!;
  const len = acc[k + 1]! - acc[k]! || 1;
  const t = Math.max(0, Math.min(1, (s - acc[k]!) / len));
  const dx = (b[0] - a[0]) / len;
  const dz = (b[1] - a[1]) / len;
  return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, dx, dz };
}
/** arc length and signed lateral offset of a point from the run */
export function runLocal(p: AvPlan, x: number, z: number) {
  let best = Infinity;
  let bs = 0;
  let lat = 0;
  for (let k = 0; k + 1 < p.pts.length; k++) {
    const a = p.pts[k]!;
    const b = p.pts[k + 1]!;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
    const px = a[0] + dx * t - x;
    const pz = a[1] + dz * t - z;
    const d = Math.hypot(px, pz);
    if (d < best) {
      best = d;
      bs = p.acc[k]! + t * Math.sqrt(l2);
      lat = (dx * (z - a[1]) - dz * (x - a[0])) / Math.sqrt(l2);
    }
  }
  return { s: bs, lat, d: best };
}

const RUNOUT = 44; // metres the snow runs on past the foot of the piste
function solidAt(layout: AlpineLayout, x: number, z: number) {
  const n = layout.cells;
  const i = Math.floor((x + layout.half) / 2);
  const j = Math.floor((z + layout.half) / 2);
  return i < 0 || j < 0 || i >= n || j >= n || layout.solid[i * n + j] === 1;
}

let planCache: { key: string; p: AvPlan | null } | null = null;
export function avalanchePlan(layout: AlpineLayout, seed: number): AvPlan | null {
  const key = `${seed}|${layout.alpine.soloHalf}`;
  if (planCache?.key === key) return planCache.p;
  const lim = layout.alpine.soloHalf ?? 1e9;
  const runs = layout.alpine.paths.filter(
    (r) => r.kind === "piste" && (layout.alpine.soloHalf === null || !r.coop),
  );
  let p: AvPlan | null = null;
  if (runs.length) {
    const run = runs[Math.floor(hash(seed, 5) * runs.length)]!;
    // keep the part of the run inside the playable square, top (highest) first
    let pts = run.pts.filter(([x, z]) => Math.abs(x) < lim - 6 && Math.abs(z) < lim - 6);
    if (pts.length >= 2) {
      if (
        groundY(pts[0]![0], pts[0]![1]) < groundY(pts[pts.length - 1]![0], pts[pts.length - 1]![1])
      )
        pts = [...pts].reverse();
      // the snow keeps going past the foot of the run and spills into the village
      const a = pts[pts.length - 2]!;
      const b = pts[pts.length - 1]!;
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const out: P2 = [b[0] + ((b[0] - a[0]) / L) * RUNOUT, b[1] + ((b[1] - a[1]) / L) * RUNOUT];
      pts = [...pts, out];
      const acc = [0];
      for (let k = 1; k < pts.length; k++)
        acc.push(
          acc[k - 1]! + Math.hypot(pts[k]![0] - pts[k - 1]![0], pts[k]![1] - pts[k - 1]![1]),
        );
      const total = acc[acc.length - 1]!;
      const half = run.w / 2 + 6;
      const base: AvPlan = {
        run,
        walkFrom: 0,
        pts,
        acc,
        total,
        half,
        mounds: [],
        name: (run.name ?? "the run").toUpperCase(),
      };
      // where the walkable village ground starts along the run
      const walk = (x: number, z: number) => alpineZone(x, z) === 0 && !solidAt(layout, x, z);
      let wf = total;
      for (let s = total; s >= 0; s -= 2) {
        const q = runAt(base, s);
        if (!walk(q.x, q.z)) break;
        wf = s;
      }
      base.walkFrom = wf;
      // snow piles up across the run-out: a wall of mounds with a gap or two, all on
      // walkable ground (never inside the face, a building or the summit island)
      for (let m = 0, tries = 0; base.mounds.length < 9 && tries < 60; m++, tries++) {
        const s = Math.max(wf + 2, total - 4 - hash(seed, 40 + m) * Math.min(34, total - wf));
        const q = runAt(base, s);
        const lat = ((m % 9) / 8 - 0.5) * run.w * 1.05 + (hash(seed, 60 + m) - 0.5) * 3;
        const x = q.x - q.dz * lat;
        const z = q.z + q.dx * lat;
        if (!walk(x, z)) continue;
        base.mounds.push({ x, z, r: 3.2 + hash(seed, 80 + m) * 2.2 });
      }
      p = base;
    }
  }
  planCache = { key, p };
  return p;
}

/** state for the visuals (AvalancheFx reads it) */
export const avState = {
  plan: null as AvPlan | null,
  t: 0,
  /** front position down the run (m), or -1 before it breaks */
  front: -1,
  /** 0..1 how big the mounds still are */
  mounds: 0,
};

const hitPlayer = { done: false };
const hitEnemies = new Set<number>();

function step(ctx: EventCtx) {
  const layout = ctx.city && "alpine" in ctx.city ? (ctx.city as AlpineLayout) : null;
  const p = layout ? avalanchePlan(layout, ctx.seed) : null;
  avState.plan = p;
  avState.t = ctx.t;
  if (!p) return;
  const t = ctx.t;
  const front = t < AV_WARN ? -1 : Math.min(p.total + 12, (t - AV_WARN) * AV_SPEED);
  avState.front = front;
  const passedAt = AV_WARN + p.total / AV_SPEED;
  avState.mounds =
    t < passedAt - 1 ? 0 : t < AV_LEN - AV_CLEAR ? 1 : Math.max(0, (AV_LEN - t) / AV_CLEAR);
  // the front: knock down and hurt whoever it catches (each once)
  if (front >= 0 && front <= p.total + 10) {
    const me = ctx.player;
    if (me.alive && !hitPlayer.done && alpineZone(me.x, me.z) === 0) {
      const L = runLocal(p, me.x, me.z);
      if (L.s >= p.walkFrom - 4 && Math.abs(L.lat) < p.half && Math.abs(L.s - front) < 7) {
        hitPlayer.done = true;
        const q = runAt(p, L.s);
        ctx.hurtPlayer(3, q.dx * 22, q.dz * 22, 1.2);
        ctx.banner("BURIED", "SHAKE IT OFF · GET CLEAR", "#5a6f95");
      }
    }
    if (ctx.host) {
      ctx.enemies.forEach((e, i) => {
        if (!e.alive || hitEnemies.has(i) || alpineZone(e.x, e.z) !== 0) return;
        const L = runLocal(p, e.x, e.z);
        if (L.s >= p.walkFrom - 4 && Math.abs(L.lat) < p.half && Math.abs(L.s - front) < 6) {
          hitEnemies.add(i);
          const q = runAt(p, L.s);
          ctx.hurtEnemy(i, 8, q.dx, q.dz);
        }
      });
    }
  }
  // the snow mounds block the way until they settle
  if (avState.mounds > 0.05) {
    const k = avState.mounds;
    const me = ctx.player;
    for (const m of p.mounds) {
      const r = m.r * (0.4 + 0.6 * k) + 0.45;
      const dx = me.x - m.x;
      const dz = me.z - m.z;
      const d = Math.hypot(dx, dz);
      if (d < r) {
        const n = d > 1e-3 ? 1 / d : 0;
        ctx.movePlayer(dx * n * (r - d), dz * n * (r - d) + (d <= 1e-3 ? r : 0));
      }
      if (ctx.host) {
        for (const e of ctx.enemies) {
          if (!e.alive) continue;
          const ex = e.x - m.x;
          const ez = e.z - m.z;
          const ed = Math.hypot(ex, ez);
          if (ed < r && ed > 1e-3) {
            e.x = m.x + (ex / ed) * r;
            e.z = m.z + (ez / ed) * r;
          }
        }
      }
    }
  }
}

export const AVALANCHE_EVENT: MapEventDef = {
  id: "avalanche",
  title: "AVALANCHE",
  sub: "GET OFF THE RUN",
  color: "#5a6f95",
  applies: (theme, city) => theme.layout === "alpine" && !!city && "alpine" in city,
  waves: [3, 11],
  chance: 0.4,
  cooldown: 4,
  guarantee: 7,
  delay: [6, 18],
  duration: AV_LEN,
  sound: "rumble",
  start: (ctx) => {
    hitPlayer.done = false;
    hitEnemies.clear();
    const layout = ctx.city && "alpine" in ctx.city ? (ctx.city as AlpineLayout) : null;
    const p = layout ? avalanchePlan(layout, ctx.seed) : null;
    if (p) ctx.banner("AVALANCHE", `GET OFF THE ${p.name} RUN`, "#5a6f95");
  },
  step,
  end: () => {
    avState.plan = null;
    avState.front = -1;
    avState.mounds = 0;
  },
};
