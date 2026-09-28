// Host-side brains for the ten newer enemy types, plus their ordnance (grenades, homing
// rockets, blasts). Every attack goes through a visible wind-up first; the wind-up state is
// written to `e.vis` so co-op guests draw exactly the same telegraph (see enemyKinds.ts).

import { HALF, NAV_SCALE, blocked, clearLine, toNav, type Block, type NavGrid } from "./level";
import { climbable, groundY } from "./terrain";
import {
  NEW_STATS, FLYERS, PH_ACT, PH_AFTER, PH_IDLE, PH_WIND, packVis, type NewKind,
} from "./enemyKinds";

export type Bot = {
  kind: string;
  x: number;
  z: number;
  hp: number;
  max?: number;
  alive: boolean;
  cooldown: number;
  slow: number;
  flash: number;
  yaw?: number;
  elite?: number;
  /** synced visual state (telegraphs), see enemyKinds.ts */
  vis?: number;
  /** AI state machine step and its timer */
  st?: number;
  t1?: number;
  /** a remembered point or direction (flank goal, sniper lock, charge lane) */
  ax?: number | undefined;
  az?: number | undefined;
  side?: number | undefined;
  plan?: number;
  shots?: number;
  /** flanker: seconds without headway toward its flank point, and the last distance to it */
  stuck?: number;
  gd0?: number;
  detour?: number;
  /** bulwark shield: absorbs frontal hits until it overloads */
  shield?: number;
  shieldMax?: number;
  shieldT?: number;
  blockT?: number;
  /** seconds since it was last hurt (cloakers decloak) */
  hitT?: number;
  /** medic heal target (enemy index) */
  tgt?: number;
};

/** `air`: riding the chairlift, so only ranged fire can reach them */
export type Target = { id: string | null; x: number; z: number; y: number; fx: number; fz: number; air?: boolean };

export const ORD_GRENADE = 0;
export const ORD_ROCKET = 1;
export const ORD_BLAST = 2;
export const MAX_ORD = 28;
export type Ord = {
  on: boolean;
  tp: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** elapsed seconds */
  t: number;
  /** flight time (grenade) / lifetime (rocket, blast) */
  T: number;
  /** landing point (grenade) */
  lx: number;
  lz: number;
  yaw: number;
  /** blast radius */
  r: number;
  tgt: string | null;
};
export const newOrd = (): Ord => ({ on: false, tp: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0, T: 1, lx: 0, lz: 0, yaw: 0, r: 0, tgt: null });

export const GRENADE_FUSE = 0.85;
export const GRENADE_RADIUS = 2.8;
const GRAVITY = 16;
const ROCKET_SPEED = 8;
const ROCKET_TURN = 1.15;
const ROCKET_LIFE = 6;
const ROCKET_RADIUS = 2.2;

export type AICtx = {
  delta: number;
  time: number;
  blocks: Block[];
  solid: NavGrid;
  targets: Target[];
  enemies: Bot[];
  rand: () => number;
  fieldFor: (t: Target) => Float32Array | undefined;
  hurtTarget: (t: Target, dmg: number, kx?: number, kz?: number) => void;
  shoot: (x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, dmg: number, size: number) => void;
  ords: Ord[];
  /** hornets share one sting cooldown, so a pack cannot land five hits in one frame */
  hornetCd: { v: number };
  navOpen: (x: number, z: number) => boolean;
};

const rad = (e: Bot) => Math.min(NEW_STATS[e.kind as NewKind].radius, 0.8);
const speedOf = (e: Bot) => NEW_STATS[e.kind as NewKind].speed * (e.slow > 0 ? 0.5 : 1);
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

/** Turn toward `want` at no more than `rate` rad/s. */
function turn(e: Bot, want: number, rate: number, dt: number) {
  const cur = e.yaw ?? want;
  const diff = angDiff(want, cur);
  const step = rate * dt;
  e.yaw = Math.abs(diff) <= step ? want : cur + Math.sign(diff) * step;
}

/** Walk `dist` metres toward (tx, tz), sliding along walls. Returns false if fully blocked. */
/** melee can only land on a target standing near this enemy's own ground (not a player on
 * a chairlift overhead, a deck above the sand, or a rooftop) */
export const MELEE_DY = 1.6;
const eyeOf = (t: Target) => t.y - 1.6;
export const meleeOK = (t: Target, x: number, z: number, dy = MELEE_DY) => !t.air && Math.abs(eyeOf(t) - groundY(x, z)) < dy;

function walk(e: Bot, tx: number, tz: number, dist: number, ctx: AICtx) {
  const mx = tx - e.x;
  const mz = tz - e.z;
  const md = Math.hypot(mx, mz);
  if (md < 1e-4 || dist === 0) return true;
  const s = Math.min(Math.abs(dist), md) * Math.sign(dist);
  const nx = e.x + (mx / md) * s;
  const nz = e.z + (mz / md) * s;
  const r = rad(e);
  let moved = false;
  // (only steps it could walk: never up a balcony edge or the church tower's face)
  if (!blocked(ctx.blocks, nx, e.z, r) && climbable(e.x, e.z, nx, e.z)) { e.x = nx; moved = true; }
  if (!blocked(ctx.blocks, e.x, nz, r) && climbable(e.x, e.z, e.x, nz)) { e.z = nz; moved = true; }
  return moved;
}

/** Next point on the way to the target: straight if the line is clear, else the flow field. */
function waypoint(e: Bot, t: Target, ctx: AICtx) {
  if (clearLine(ctx.blocks, e.x, e.z, t.x, t.z, rad(e) * 0.9)) return { x: t.x, z: t.z };
  const dist = ctx.fieldFor(t);
  if (!dist) return { x: t.x, z: t.z };
  return descend(ctx.solid, dist, e.x, e.z, null) ?? { x: t.x, z: t.z };
}

/**
 * Greedy step down the target's distance field. With `bias` set, cells in front of the
 * target (along its facing) cost extra, so the walker prefers side streets and comes in
 * round the block instead of up the street the player is watching.
 */
function descend(
  nav: NavGrid, dist: Float32Array, x: number, z: number,
  bias: { px: number; pz: number; fx: number; fz: number; w: number } | null,
) {
  const { g: solid, n } = nav;
  const ci = toNav(x);
  const cj = toNav(z);
  const cost = (k: number) => {
    let c = dist[k]!;
    if (bias && c < Infinity) {
      const ox = nav.px[k]! - bias.px;
      const oz = nav.pz[k]! - bias.pz;
      const od = Math.hypot(ox, oz) || 1;
      const front = (ox * bias.fx + oz * bias.fz) / od; // 1 = dead ahead of the player
      const near = Math.max(0, 1 - od / 34);
      c += bias.w * Math.max(0, front + 0.35) * near;
    }
    return c;
  };
  let best = cost(ci * n + cj);
  let bi = ci;
  let bj = cj;
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      if (!di && !dj) continue;
      const ni = ci + di;
      const nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
      const k = ni * n + nj;
      if (solid[k]) continue;
      if (di && dj && (solid[(ci + di) * n + cj] || solid[ci * n + cj + dj])) continue;
      const c = cost(k);
      if (c < best) { best = c; bi = ni; bj = nj; }
    }
  }
  const k = bi * n + bj;
  if (bi === ci && bj === cj && bias) return null;
  return { x: nav.px[k]!, z: nav.pz[k]! };
}

/** approach (1), hold (0) or back off (-1) along the route to the target */
function approach(e: Bot, t: Target, dir: number, speed: number, ctx: AICtx) {
  if (dir === 0) return;
  const wp = waypoint(e, t, ctx);
  if (dir > 0) walk(e, wp.x, wp.z, speed * ctx.delta, ctx);
  else walk(e, e.x - (wp.x - e.x), e.z - (wp.z - e.z), speed * ctx.delta, ctx);
}

const los = (ctx: AICtx, ax: number, az: number, bx: number, bz: number) => clearLine(ctx.blocks, ax, az, bx, bz, 0.1);

function spawnOrd(ctx: AICtx): Ord | null {
  for (const o of ctx.ords) if (!o.on) return o;
  return null;
}

export function blast(ords: Ord[], x: number, z: number, r: number, y = groundY(x, z) + 0.6) {
  const o = ords.find((q) => !q.on);
  if (!o) return;
  Object.assign(o, { on: true, tp: ORD_BLAST, x, y, z, vx: 0, vy: 0, vz: 0, t: 0, T: 0.4, lx: x, lz: z, r, tgt: null });
}

/** one host tick for a newer-type enemy: movement, telegraphs and attacks */
export function stepNewKind(e: Bot, idx: number, target: Target, d: number, ctx: AICtx) {
  const dt = ctx.delta;
  const dx = target.x - e.x;
  const dz = target.z - e.z;
  const face = Math.atan2(dx, dz);
  const g = groundY(e.x, e.z); // 0 on flat maps; shots and ordnance start from the enemy's ground
  const spd = speedOf(e);
  const st = e.st ?? 0;
  e.t1 = (e.t1 ?? 0) - dt;
  if ((e.hitT ?? 0) > 0) e.hitT = e.hitT! - dt;
  if ((e.blockT ?? 0) > 0) e.blockT = e.blockT! - dt;
  const stats = NEW_STATS[e.kind as NewKind];

  switch (e.kind as NewKind) {
    // ------------------------------------------------------------------ HORNET
    case "hornet": {
      e.yaw = face;
      if (st === 0) {
        if (d < 3.2 && e.cooldown > 0) {
          // recharging: buzz round you at arm's length instead of sitting in your face
          walk(e, e.x - (dz / d) * (idx % 2 ? 1 : -1) - (dx / d) * 0.6, e.z + (dx / d) * (idx % 2 ? 1 : -1) - (dz / d) * 0.6, spd * 0.6 * dt, ctx);
        } else {
          const wp = waypoint(e, target, ctx);
          walk(e, wp.x, wp.z, spd * dt, ctx);
        }
        // erratic weave, so a pack reads as a swarm and is hard to track
        const w = Math.sin(ctx.time * 6 + idx * 1.7) * 2.2 * dt;
        walk(e, e.x - dz / d, e.z + dx / d, w, ctx);
        if (d < 3.6 && e.cooldown <= 0) { e.st = 1; e.t1 = 0.35 + ctx.rand() * 0.3; e.plan = e.t1; }
      } else if (st === 1) {
        if (e.t1 <= 0) { e.st = 2; e.t1 = 0.45; e.ax = dx / d; e.az = dz / d; }
      } else if (st === 2) {
        const moved = walk(e, e.x + e.ax! * 5, e.z + e.az! * 5, 11 * (e.slow > 0 ? 0.5 : 1) * dt, ctx);
        let hit = false;
        for (const t of ctx.targets) {
          if (Math.hypot(t.x - e.x, t.z - e.z) < 1.0 && meleeOK(t, e.x, e.z, 2.4)) {
            if (ctx.hornetCd.v <= 0) { ctx.hurtTarget(t, stats.dmg); ctx.hornetCd.v = 0.25; }
            hit = true;
            break;
          }
        }
        if (hit || !moved || e.t1 <= 0) { e.st = 3; e.t1 = 0.6; e.cooldown = 1.6; }
      } else {
        walk(e, e.x - dx, e.z - dz, spd * 0.8 * dt, ctx);
        if (e.t1 <= 0) e.st = 0;
      }
      e.vis = packVis(e.st === 1 ? PH_WIND : e.st === 2 ? PH_ACT : PH_IDLE, e.st === 1 ? 1 - e.t1 / (e.plan || 0.4) : 0);
      break;
    }

    // ----------------------------------------------------------------- FLANKER
    case "flanker": {
      e.yaw = face;
      const fx = target.fx;
      const fz = target.fz;
      const rx = e.x - target.x;
      const rz = e.z - target.z;
      const inFront = (rx * fx + rz * fz) / d > 0.34; // within ~70 degrees of where the player looks
      if (st === 0) {
        e.shots = (e.shots ?? 0) + (d < 26 ? dt : 0); // patience: eventually it just attacks
        if (d > 26) {
          approach(e, target, 1, spd, ctx);
        } else {
          e.plan = (e.plan ?? 0) - dt;
          if (e.plan <= 0 || e.ax === undefined) {
            e.plan = 0.4;
            // orbit: step round the player in 45 degree hops at 8-11 m, out of its cone of
            // view, then close to 7 m once it is 115 degrees off the player's facing
            const px = fz;
            const pz = -fx; // +90 degrees from the facing
            const cur = Math.atan2(rx * px + rz * pz, rx * fx + rz * fz);
            if (e.side === undefined) e.side = Math.sign(cur) || (ctx.rand() < 0.5 ? 1 : -1);
            const goal = e.side * 2.0;
            const gap = goal - cur;
            const next = cur + Math.max(-0.8, Math.min(0.8, gap));
            const r = Math.abs(gap) > 0.35 ? Math.max(8, Math.min(d, 11)) : 7;
            // the exact point may sit in cover: take the nearest open spot around it, and only
            // switch to the other side when this side is walled off (or it has stalled for 3 s)
            const find = (ang: number) => {
              for (const dr of [0, -1.5, 1.5, -3]) {
                for (const da of [0, 0.25, -0.25, 0.5]) {
                  const a = ang + da * Math.sign(ang || 1);
                  const x = target.x + (fx * Math.cos(a) + px * Math.sin(a)) * (r + dr);
                  const z = target.z + (fz * Math.cos(a) + pz * Math.sin(a)) * (r + dr);
                  if (ctx.navOpen(x, z) && !blocked(ctx.blocks, x, z, 0.6)) return { x, z };
                }
              }
              return null;
            };
            let g = (e.stuck ?? 0) < 3 ? find(next) : null;
            if (!g) {
              e.side = -e.side;
              e.stuck = 0;
              g = find(cur + Math.max(-0.8, Math.min(0.8, e.side * 2.0 - cur)));
            }
            e.ax = g ? g.x : target.x;
            e.az = g ? g.z : target.z;
          }
          const gd = Math.hypot(e.ax! - e.x, e.az! - e.z);
          // progress check every plan tick: no headway toward the flank point means boxed in
          if (e.plan >= 0.39) {
            e.stuck = (e.gd0 ?? 99) - gd < 0.3 ? (e.stuck ?? 0) + 0.4 : 0;
            e.gd0 = gd;
          }
          if (gd > 1.5) {
            if (clearLine(ctx.blocks, e.x, e.z, e.ax!, e.az!, rad(e) * 0.9)) walk(e, e.ax!, e.az!, spd * dt, ctx);
            else {
              const dist = ctx.fieldFor(target);
              // round the block: the target's distance field, with the street it is watching made
              // expensive; if that dead-ends, head in along the normal route while side-stepping
              // (the city's streets; the small arenas are open enough to just arc round)
              if ((e.stuck ?? 0) >= 0.8) e.detour = 2;
              e.detour = (e.detour ?? 0) - dt;
              const wp = dist && NAV_SCALE > 1 && e.detour <= 0 ? descend(ctx.solid, dist, e.x, e.z, { px: target.x, pz: target.z, fx, fz, w: 14 }) : null;
              if (wp) walk(e, wp.x, wp.z, spd * dt, ctx);
              else {
                const w2 = waypoint(e, target, ctx);
                const wx = w2.x - e.x;
                const wz = w2.z - e.z;
                const wl = Math.hypot(wx, wz) || 1;
                const sd = e.side ?? 1;
                const tw = d < 15 ? 1.3 : 0.6; // close in: mostly circle
                walk(e, e.x + (wx / wl) * (d < 15 ? 0.6 : 1) - (dz / d) * sd * tw, e.z + (wz / wl) * (d < 15 ? 0.6 : 1) + (dx / d) * sd * tw, spd * dt, ctx);
              }
            }
          } else {
            // on station: circle round the player on its side
            walk(e, e.x - (dz / d) * (e.side ?? 1), e.z + (dx / d) * (e.side ?? 1), spd * 0.5 * dt, ctx);
          }
          const canShoot = d < 12 && (!inFront || (e.shots ?? 0) > 10) && los(ctx, e.x, e.z, target.x, target.z);
          if (canShoot && e.cooldown <= 0) { e.st = 1; e.t1 = 0.5; }
        }
      } else if (st === 1) {
        if (e.t1 <= 0) { e.st = 2; e.t1 = 0; e.shots = 3; }
      } else {
        walk(e, e.x - (dz / d) * (e.side ?? 1), e.z + (dx / d) * (e.side ?? 1), spd * 0.4 * dt, ctx);
        if (e.t1 <= 0 && (e.shots ?? 0) > 0 && e.shots! <= 3) {
          e.t1 = 0.12;
          e.shots = e.shots! - 1;
          const a = face + (ctx.rand() - 0.5) * 0.08;
          const vy = (target.y - 0.2 - 1.1 - g) / d;
          const len = Math.hypot(1, vy);
          ctx.shoot(e.x + Math.sin(a) * 0.7, g + 1.1, e.z + Math.cos(a) * 0.7, (Math.sin(a) / len) * 15, (vy / len) * 15, (Math.cos(a) / len) * 15, 1.4, stats.dmg, 0.13);
        }
        if ((e.shots ?? 0) <= 0) {
          e.st = 0;
          e.shots = 0;
          e.cooldown = 2.4 + ctx.rand() * 0.6;
          e.plan = 0;
        }
      }
      e.vis = packVis(e.st === 1 ? PH_WIND : e.st === 2 ? PH_ACT : PH_IDLE, e.st === 1 ? 1 - e.t1 / 0.5 : 0);
      break;
    }

    // --------------------------------------------------------------- GRENADIER
    case "grenadier": {
      e.yaw = face;
      if (st === 0) {
        approach(e, target, d > 17 ? 1 : d < 10 ? -1 : 0, spd, ctx);
        if (e.cooldown <= 0 && d < 21) { e.st = 1; e.t1 = 0.6; }
      } else if (e.t1 <= 0) {
        const o = spawnOrd(ctx);
        if (o) {
          const a = ctx.rand() * Math.PI * 2;
          const off = ctx.rand() * 1.2;
          let lx = target.x + Math.sin(a) * off;
          let lz = target.z + Math.cos(a) * off;
          if (Math.abs(lx) > HALF - 1 || Math.abs(lz) > HALF - 1) { lx = target.x; lz = target.z; }
          const sx = e.x + Math.sin(face) * 0.5;
          const sz = e.z + Math.cos(face) * 0.5;
          const y0 = g + 2.1;
          const T = Math.max(0.8, Math.min(1.7, Math.hypot(lx - sx, lz - sz) / 11));
          Object.assign(o, {
            on: true, tp: ORD_GRENADE, x: sx, y: y0, z: sz,
            vx: (lx - sx) / T, vz: (lz - sz) / T, vy: (groundY(lx, lz) + 0.25 - y0) / T + 0.5 * GRAVITY * T,
            t: 0, T, lx, lz, r: GRENADE_RADIUS, tgt: null,
          });
        }
        e.st = 0;
        e.cooldown = 3.6 + ctx.rand() * 1.2;
      }
      e.vis = packVis(e.st === 1 ? PH_WIND : PH_IDLE, e.st === 1 ? 1 - e.t1 / 0.6 : 0);
      break;
    }

    // ------------------------------------------------------------------ SNIPER
    case "sniper": {
      const sees = los(ctx, e.x, e.z, target.x, target.z);
      let laser = 0;
      if (st === 0) {
        e.yaw = face;
        e.plan = (e.plan ?? 0) - dt;
        if (e.plan > 0 && e.ax !== undefined) {
          // relocating after a shot: dash to the chosen spot
          if (Math.hypot(e.ax - e.x, e.az! - e.z) < 0.6 || !walk(e, e.ax, e.az!, spd * 1.3 * dt, ctx)) e.plan = 0;
        } else if (sees && d >= 12 && d <= 46) {
          if (e.cooldown <= 0) { e.st = 1; e.t1 = 1.5; e.shots = 0; }
        } else {
          approach(e, target, d < 12 ? -1 : 1, spd, ctx);
        }
      } else if (st === 1) {
        e.yaw = face;
        laser = d;
        if (!sees) e.shots = (e.shots ?? 0) + dt;
        if ((e.shots ?? 0) > 0.25) { e.st = 0; e.cooldown = 0.6; }
        else if (e.t1 <= 0) {
          // lock: the aim freezes here, so a sidestep now makes it miss
          e.st = 2;
          e.t1 = 0.45;
          e.ax = target.x;
          e.az = target.z;
          e.yaw = face;
        }
      } else if (st === 2) {
        laser = Math.hypot(e.ax! - e.x, e.az! - e.z);
        if (e.t1 <= 0) {
          const ux = Math.sin(e.yaw ?? face);
          const uz = Math.cos(e.yaw ?? face);
          let best: Target | null = null;
          let bs = Infinity;
          for (const t of ctx.targets) {
            const s = (t.x - e.x) * ux + (t.z - e.z) * uz;
            if (s <= 0 || s > 60) continue;
            const perp = Math.abs((t.x - e.x) * uz - (t.z - e.z) * ux);
            if (perp < 0.8 && s < bs && los(ctx, e.x, e.z, t.x, t.z)) { best = t; bs = s; }
          }
          // tracer runs to whoever it hit, or to the first wall
          let len = bs;
          if (!best) {
            len = 60;
            for (let s = 1; s < 60; s += 0.5) {
              if (blocked(ctx.blocks, e.x + ux * s, e.z + uz * s, 0.05)) { len = s; break; }
            }
          } else ctx.hurtTarget(best, stats.dmg);
          e.ax = len;
          e.st = 3;
          e.t1 = 0.22;
        }
      } else {
        laser = e.ax ?? 0;
        if (e.t1 <= 0) {
          e.st = 0;
          e.cooldown = 3.2;
          // relocate: a nearby reachable spot, preferably out of the target's sight
          let pick: { x: number; z: number } | null = null;
          for (let i = 0; i < 12; i++) {
            const a = ctx.rand() * Math.PI * 2;
            const r = 4 + ctx.rand() * 5;
            const x = e.x + Math.sin(a) * r;
            const z = e.z + Math.cos(a) * r;
            if (blocked(ctx.blocks, x, z, 0.7) || !ctx.navOpen(x, z)) continue;
            if (!clearLine(ctx.blocks, e.x, e.z, x, z, 0.5)) continue;
            pick = { x, z };
            if (!los(ctx, x, z, target.x, target.z)) break;
          }
          if (pick) { e.ax = pick.x; e.az = pick.z; e.plan = 2.5; } else { e.ax = undefined; e.plan = 0; }
        }
      }
      const ph = e.st ?? 0;
      e.vis = packVis(ph, ph === 1 ? 1 - e.t1 / 1.5 : ph === 2 ? 1 : 0, Math.min(1023, Math.round(laser)));
      break;
    }

    // ----------------------------------------------------------------- BULWARK
    case "bulwark": {
      if ((e.shieldT ?? 0) > 0) {
        e.shieldT = e.shieldT! - dt;
        if (e.shieldT <= 0) e.shield = e.shieldMax ?? 8;
      }
      // the shield arm is heavy: it turns slowly, which is how you get round it
      turn(e, face, 1.1, dt);
      if (st === 0) {
        approach(e, target, d > 1.9 ? 1 : 0, spd, ctx);
        if (d < 2.3 && e.cooldown <= 0) { e.st = 1; e.t1 = 0.5; }
      } else if (e.t1 <= 0) {
        const fx = Math.sin(e.yaw ?? face);
        const fz = Math.cos(e.yaw ?? face);
        if (d < 2.6 && (dx * fx + dz * fz) / d > 0.3) ctx.hurtTarget(target, stats.dmg, fx * 7, fz * 7);
        e.st = 0;
        e.cooldown = 1.8;
      }
      const up = (e.shield ?? 0) > 0 && (e.shieldT ?? 0) <= 0;
      e.vis = packVis(e.st === 1 ? PH_WIND : PH_IDLE, e.st === 1 ? 1 - e.t1 / 0.5 : 0, (up ? 1 : 0) | ((e.blockT ?? 0) > 0 ? 2 : 0));
      break;
    }

    // ----------------------------------------------------------------- CHARGER
    case "charger": {
      if (st === 0) {
        e.yaw = face;
        approach(e, target, d > 2.2 ? 1 : 0, spd, ctx);
        if (d < 17 && e.cooldown <= 0 && clearLine(ctx.blocks, e.x, e.z, target.x, target.z, 0.7)) { e.st = 1; e.t1 = 1.0; }
      } else if (st === 1) {
        // tracks you for most of the wind-up, then the lane locks for the last 0.3 s
        if (e.t1 > 0.3) { e.yaw = face; }
        if (e.t1 <= 0) { e.st = 2; e.t1 = 1.5; e.shots = 0; }
      } else if (st === 2) {
        const ux = Math.sin(e.yaw ?? face);
        const uz = Math.cos(e.yaw ?? face);
        const total = 15 * (e.slow > 0 ? 0.5 : 1) * dt;
        const reach = rad(e) * (e.elite ? 1.6 : 1) + 0.4 + 0.45;
        let wall = false;
        for (let s = 0; s < total; s += 0.35) {
          const step = Math.min(0.35, total - s);
          const nx = e.x + ux * step;
          const nz = e.z + uz * step;
          if (blocked(ctx.blocks, nx, nz, rad(e)) || !climbable(e.x, e.z, nx, nz)) { wall = true; break; }
          e.x = nx;
          e.z = nz;
          const hitT = ctx.targets.find((t) => Math.hypot(t.x - e.x, t.z - e.z) < reach && meleeOK(t, e.x, e.z));
          if (hitT) {
            ctx.hurtTarget(hitT, stats.dmg, ux * 14, uz * 14);
            e.st = 4;
            e.t1 = 0.8;
            break;
          }
        }
        if (wall) { e.st = 3; e.t1 = 2.2; }
        else if (e.st === 2 && e.t1 <= 0) { e.st = 4; e.t1 = 0.7; }
      } else if (st === 3) {
        if (e.t1 <= 0) { e.st = 4; e.t1 = 0.3; }
      } else {
        if (e.t1 <= 0) { e.st = 0; e.cooldown = 2.5; }
      }
      const s2 = e.st ?? 0;
      e.vis = packVis(s2 === 1 ? PH_WIND : s2 === 2 ? PH_ACT : s2 === 3 ? PH_AFTER : PH_IDLE, s2 === 1 ? 1 - e.t1 / 1.0 : 0);
      break;
    }

    // ------------------------------------------------------------------- MEDIC
    case "medic": {
      e.yaw = face;
      e.plan = (e.plan ?? 0) - dt;
      if (e.plan <= 0) {
        e.plan = 0.5;
        let best = -1;
        let worst = 1;
        for (let i = 0; i < ctx.enemies.length; i++) {
          const o = ctx.enemies[i]!;
          if (!o.alive || o === e || o.kind === "medic" || o.kind === "boss") continue;
          if (Math.hypot(o.x - e.x, o.z - e.z) > 16) continue;
          const f = o.hp / (o.max ?? o.hp);
          if (f < worst) { worst = f; best = i; }
        }
        e.tgt = best;
      }
      const pat = (e.tgt ?? -1) >= 0 ? ctx.enemies[e.tgt!] : undefined;
      let ally: Bot | undefined = pat?.alive ? pat : undefined;
      if (!ally) {
        let bd = 25;
        for (const o of ctx.enemies) {
          if (!o.alive || o === e || o.kind === "medic" || FLYERS.has(o.kind)) continue;
          const dd = Math.hypot(o.x - e.x, o.z - e.z);
          if (dd < bd) { bd = dd; ally = o; }
        }
      }
      if (d < 8) {
        walk(e, e.x - dx, e.z - dz, spd * dt, ctx); // too close to a player: back off
      } else if (ally) {
        // hover behind the ally, on the far side from the player
        const ax = ally.x - target.x;
        const az = ally.z - target.z;
        const ad = Math.hypot(ax, az) || 1;
        const gx = ally.x + (ax / ad) * 3;
        const gz = ally.z + (az / ad) * 3;
        if (Math.hypot(gx - e.x, gz - e.z) > 1) {
          if (clearLine(ctx.blocks, e.x, e.z, gx, gz, 0.4)) walk(e, gx, gz, spd * dt, ctx);
          else approach(e, target, d > 14 ? 1 : 0, spd, ctx);
        }
      } else {
        approach(e, target, d > 16 ? 1 : d < 11 ? -1 : 0, spd, ctx);
      }
      let beam = 0;
      if (e.st === 2) {
        beam = (e.tgt ?? -1) + 1;
        if (e.t1 <= 0 || !pat?.alive) e.st = 0;
      } else if (e.cooldown <= 0 && pat?.alive && Math.hypot(pat.x - e.x, pat.z - e.z) < 8) {
        pat.hp = Math.min(pat.max ?? pat.hp, pat.hp + (pat.elite ? 6 : 2));
        e.st = 2;
        e.t1 = 0.7;
        e.cooldown = 2.2;
        beam = e.tgt! + 1;
      } else if (e.cooldown <= 0 && !ally && d < 16 && los(ctx, e.x, e.z, target.x, target.z)) {
        // alone: a slow, easy-to-dodge zap orb
        e.cooldown = 2.8;
        const vy = (target.y - 2.6 - g) / d;
        const len = Math.hypot(1, vy);
        ctx.shoot(e.x, g + 2.6, e.z, (dx / d / len) * 9, (vy / len) * 9, (dz / d / len) * 9, 2.5, 1, 0.22);
      }
      e.vis = packVis(e.st === 2 ? PH_ACT : PH_IDLE, 0, beam);
      break;
    }

    // ----------------------------------------------------------------- GATLING
    case "gatling": {
      if (st === 0) {
        turn(e, face, 2.2, dt);
        approach(e, target, d > 15 ? 1 : d < 8 ? -1 : 0, spd, ctx);
        if (e.cooldown <= 0 && d < 19 && los(ctx, e.x, e.z, target.x, target.z)) { e.st = 1; e.t1 = 1.1; }
      } else if (st === 1) {
        turn(e, face, 0.65, dt);
        if (e.t1 <= 0) { e.st = 2; e.t1 = 1.5; e.shots = 0; }
      } else if (st === 2) {
        // it tracks slowly: strafing round it at close range outpaces the barrels
        turn(e, face, 0.65, dt);
        e.shots = (e.shots ?? 0) - dt;
        if (e.shots <= 0) {
          e.shots += 1 / 5;
          // the barrels sit off to the right; the stream converges on where the body faces,
          // at the target's range, so it only lands when the slow turret has caught up
          const y0 = e.yaw ?? face;
          const mx = e.x + Math.sin(y0) * 1.1 + Math.cos(y0) * 0.45;
          const mz = e.z + Math.cos(y0) * 1.1 - Math.sin(y0) * 0.45;
          const a = Math.atan2(e.x + Math.sin(y0) * d - mx, e.z + Math.cos(y0) * d - mz) + (Math.random() - 0.5) * 0.2;
          const vy = (target.y - 0.2 - 1.3 - g) / Math.max(2, d);
          const len = Math.hypot(1, vy);
          ctx.shoot(mx, g + 1.3, mz, (Math.sin(a) / len) * 14, (vy / len) * 14, (Math.cos(a) / len) * 14, 1.6, stats.dmg, 0.12);
        }
        if (e.t1 <= 0) { e.st = 3; e.t1 = 1.2; }
      } else {
        turn(e, face, 1.2, dt);
        if (e.t1 <= 0) { e.st = 0; e.cooldown = 2.2; }
      }
      const s2 = e.st ?? 0;
      e.vis = packVis(s2, s2 === 1 ? 1 - e.t1 / 1.1 : s2 === 3 ? e.t1 / 1.2 : s2 === 2 ? 1 : 0);
      break;
    }

    // --------------------------------------------------------------- ROCKETEER
    case "rocketeer": {
      e.yaw = face;
      if (st === 0) {
        approach(e, target, d > 24 ? 1 : d < 13 ? -1 : 0, spd, ctx);
        if (e.cooldown <= 0 && d < 28 && los(ctx, e.x, e.z, target.x, target.z)) { e.st = 1; e.t1 = 0.9; }
      } else if (e.t1 <= 0) {
        const o = spawnOrd(ctx);
        if (o) {
          const sx = e.x + Math.cos(face) * 0.45 + Math.sin(face) * 0.6;
          const sz = e.z - Math.sin(face) * 0.45 + Math.cos(face) * 0.6;
          Object.assign(o, { on: true, tp: ORD_ROCKET, x: sx, y: g + 2.2, z: sz, vx: 0, vy: 0, vz: 0, t: 0, T: ROCKET_LIFE, lx: 0, lz: 0, yaw: face, r: ROCKET_RADIUS, tgt: target.id });
        }
        e.st = 0;
        e.cooldown = 5 + ctx.rand() * 1.5;
      }
      e.vis = packVis(e.st === 1 ? PH_WIND : PH_IDLE, e.st === 1 ? 1 - e.t1 / 0.9 : 0);
      break;
    }

    // ----------------------------------------------------------------- CLOAKER
    case "cloaker": {
      e.yaw = face;
      const revealed = (e.hitT ?? 0) > 0;
      if (st === 0) {
        approach(e, target, 1, spd, ctx);
        if (d <= 6) { e.st = 1; e.t1 = 0.6; }
      } else if (st === 1) {
        approach(e, target, d > 1.7 ? 1 : 0, spd, ctx);
        if (d > 8) e.st = 0; // you ran: it slips back into cloak
        else if (e.t1 <= 0 && d < 1.9 && e.cooldown <= 0) { e.st = 2; e.t1 = 0.35; }
      } else if (st === 2) {
        if (e.t1 <= 0) {
          if (d < 2.3) ctx.hurtTarget(target, stats.dmg);
          e.st = 3;
          e.t1 = 1.6;
          e.cooldown = 1.5;
        }
      } else {
        walk(e, e.x - dx, e.z - dz, spd * dt, ctx); // hit and run
        if (e.t1 <= 0) e.st = 0;
      }
      const s2 = e.st ?? 0;
      const cloaked = s2 === 0 && d > 6 && !revealed;
      const shimmer = s2 === 1 && e.t1 > 0 && !revealed;
      e.vis = packVis(s2 === 2 ? PH_WIND : PH_IDLE, s2 === 2 ? 1 - e.t1 / 0.35 : 0, cloaked ? 1 : shimmer ? 2 : 0);
      break;
    }
  }
}

/** bulwark shield: true if a shot travelling (vx, vz) hits the raised shield face */
export function shieldBlocks(e: { kind: string; yaw?: number; vis?: number }, vx: number, vz: number, up: boolean) {
  if (e.kind !== "bulwark" || !up) return false;
  const vl = Math.hypot(vx, vz);
  if (vl < 1e-4) return false;
  const fx = Math.sin(e.yaw ?? 0);
  const fz = Math.cos(e.yaw ?? 0);
  return -(vx * fx + vz * fz) / vl > 0.34; // within ~70 degrees of head-on
}

/** a shot absorbed by the shield drains it; overloaded shields drop for 4 s */
export function drainShield(e: Bot, dmg: number) {
  e.blockT = 0.12;
  e.shield = (e.shield ?? 0) - dmg;
  if (e.shield <= 0) { e.shield = 0; e.shieldT = 4; }
}

/** charger stunned against a wall takes extra damage */
export const damageMul = (e: Bot) => (e.kind === "charger" && e.st === 3 ? 1.5 : 1);

/** host: fly grenades and rockets, detonate them on players */
export function stepOrds(ctx: AICtx) {
  const dt = ctx.delta;
  for (const o of ctx.ords) {
    if (!o.on) continue;
    o.t += dt;
    if (o.tp === ORD_BLAST) {
      if (o.t >= o.T) o.on = false;
      continue;
    }
    if (o.tp === ORD_GRENADE) {
      if (o.t < o.T) {
        o.x += o.vx * dt;
        o.z += o.vz * dt;
        o.vy -= GRAVITY * dt;
        o.y = Math.max(groundY(o.x, o.z) + 0.25, o.y + o.vy * dt);
      } else {
        o.x = o.lx;
        o.z = o.lz;
        o.y = groundY(o.x, o.z) + 0.25;
      }
      if (o.t >= o.T + GRENADE_FUSE) {
        o.on = false;
        for (const t of ctx.targets) {
          const dd = Math.hypot(t.x - o.x, t.z - o.z);
          if (dd < o.r && Math.abs(eyeOf(t) - o.y) < o.r + 1.5) ctx.hurtTarget(t, 2, ((t.x - o.x) / (dd || 1)) * 6, ((t.z - o.z) / (dd || 1)) * 6);
        }
        blast(ctx.ords, o.x, o.z, o.r);
      }
      continue;
    }
    // rocket: homes on its target, turning slowly, so a late sidestep beats it
    let t = ctx.targets.find((q) => q.id === o.tgt);
    if (!t) {
      let bd = Infinity;
      for (const q of ctx.targets) {
        const dd = Math.hypot(q.x - o.x, q.z - o.z);
        if (dd < bd) { bd = dd; t = q; }
      }
    }
    if (t) turnOrd(o, Math.atan2(t.x - o.x, t.z - o.z), dt);
    o.x += Math.sin(o.yaw) * ROCKET_SPEED * dt;
    o.z += Math.cos(o.yaw) * ROCKET_SPEED * dt;
    o.y += Math.max(-1, Math.min(1, groundY(o.x, o.z) + 1.35 - o.y)) * dt;
    let boom = o.t >= o.T || blocked(ctx.blocks, o.x, o.z, 0.1);
    for (const q of ctx.targets) if (Math.hypot(q.x - o.x, q.z - o.z) < 1.0) boom = true;
    if (boom) {
      o.on = false;
      for (const q of ctx.targets) {
        const dd = Math.hypot(q.x - o.x, q.z - o.z);
        if (dd < o.r && Math.abs(eyeOf(q) - o.y) < o.r + 1.5) ctx.hurtTarget(q, 3, ((q.x - o.x) / (dd || 1)) * 8, ((q.z - o.z) / (dd || 1)) * 8);
      }
      blast(ctx.ords, o.x, o.z, o.r, o.y);
    }
  }
}

function turnOrd(o: Ord, want: number, dt: number) {
  const diff = angDiff(want, o.yaw);
  const step = ROCKET_TURN * dt;
  o.yaw = Math.abs(diff) <= step ? want : o.yaw + Math.sign(diff) * step;
}

/** a player bullet at (x, y, z) shoots down a rocket within reach; returns its slot or -1 */
export function rocketAt(ords: Ord[], x: number, y: number, z: number) {
  for (let i = 0; i < ords.length; i++) {
    const o = ords[i]!;
    if (o.on && o.tp === ORD_ROCKET && Math.hypot(o.x - x, o.z - z) < 0.65 && Math.abs(o.y - y) < 0.7) return i;
  }
  return -1;
}

// ---- co-op: ordnance rides the snapshot as 7 integers each ----
// [slot, type | progress7 << 2, x*100, y*100, z*100, a, b]; grenade a,b = landing point,
// rocket a = heading * 1000, blast a = radius * 100
export function packOrds(ords: Ord[]) {
  const out: number[] = [];
  ords.forEach((o, i) => {
    if (!o.on) return;
    const total = o.tp === ORD_GRENADE ? o.T + GRENADE_FUSE : o.T;
    const prog = Math.max(0, Math.min(127, Math.round((o.t / total) * 127)));
    const a = o.tp === ORD_GRENADE ? Math.round(o.lx * 100) : o.tp === ORD_ROCKET ? Math.round(o.yaw * 1000) : Math.round(o.r * 100);
    const b = o.tp === ORD_GRENADE ? Math.round(o.lz * 100) : 0;
    out.push(i, o.tp | (prog << 2), Math.round(o.x * 100), Math.round(o.y * 100), Math.round(o.z * 100), a, b);
  });
  return out;
}

/** guest: mirror the host's ordnance; positions ease toward the latest snapshot */
export function unpackOrds(ords: Ord[], a: number[], tx: Float32Array) {
  const seen = new Set<number>();
  for (let j = 0; j + 6 < a.length; j += 7) {
    const i = a[j]!;
    const o = ords[i];
    if (!o) continue;
    seen.add(i);
    const tp = a[j + 1]! & 3;
    const prog = (a[j + 1]! >> 2) / 127;
    const x = a[j + 2]! / 100;
    const y = a[j + 3]! / 100;
    const z = a[j + 4]! / 100;
    const fresh = !o.on || o.tp !== tp;
    o.on = true;
    o.tp = tp;
    if (fresh) { o.x = x; o.y = y; o.z = z; }
    tx[i * 3] = x;
    tx[i * 3 + 1] = y;
    tx[i * 3 + 2] = z;
    if (tp === ORD_GRENADE) {
      o.lx = a[j + 5]! / 100;
      o.lz = a[j + 6]! / 100;
      o.T = 1;
      o.t = prog * (1 + GRENADE_FUSE);
      o.r = GRENADE_RADIUS;
    } else if (tp === ORD_ROCKET) {
      o.yaw = a[j + 5]! / 1000;
      o.T = ROCKET_LIFE;
      o.t = prog * ROCKET_LIFE;
    } else {
      o.r = a[j + 5]! / 100;
      o.T = 0.4;
      o.t = prog * 0.4;
    }
  }
  ords.forEach((o, i) => { if (!seen.has(i)) o.on = false; });
}
