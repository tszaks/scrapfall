import * as THREE from "three";

import { playImpact, type ImpactSound } from "./audio";
import { spec, type DecalPool, type MeshPool, type RingPool, type SegPool } from "./fxCore";

/**
 * Shared combat-effects state plus the impact library: what a round does when it meets
 * a robot, a wall, the ground, a car or the sea. Pure functions over pooled buffers;
 * `projectiles.tsx` owns the pools and the per-weapon flight visuals.
 */

/** projectile look, one per weapon plus the extra shooters */
export const VK = {
  PISTOL: 0, SCATTER: 1, SMG: 2, RAIL: 3, CANNON: 4, REBOUND: 5, HARPOON: 6, CRYO: 7, FLAK: 8, TESLA: 9,
  TURRET: 10, FRAG: 11, MORTAR: 12,
} as const;
export type VisKind = (typeof VK)[keyof typeof VK];
/** per-shot look modifiers */
export const VF = { MAGNUM: 1, INCEND: 2, CRIT: 4, TRACER: 8 } as const;

export type FxEnemy = { x: number; z: number; alive: boolean; kind: string };
export type FxEnv = {
  solid: (x: number, z: number) => boolean;
  car: (x: number, y: number, z: number) => boolean;
  half: () => number;
  /** z of the city's waterfront (the sea lies beyond it), or null when the map has no water */
  waterZ: number | null;
  enemies: FxEnemy[];
  radius: (kind: string) => number;
  height: (kind: string) => number;
  /** colour of the dust knocked out of walls and the ground */
  dust: number;
};

export const FX = {
  add: null as SegPool | null,
  alpha: null as SegPool | null,
  decals: null as DecalPool | null,
  rings: null as RingPool | null,
  stuck: null as MeshPool | null,
  env: null as FxEnv | null,
  /** listener position for distance-scaled sound */
  ear: new THREE.Vector3(),
  /** camera kick applied on top of the look angles (radians) */
  kick: { pitch: 0, yaw: 0, shake: 0 },
};

const rnd = (a = 1) => (Math.random() * 2 - 1) * a;
export const sound = (k: ImpactSound, x: number, y: number, z: number) =>
  playImpact(k, Math.hypot(x - FX.ear.x, y - FX.ear.y, z - FX.ear.z));

// ---------------------------------------------------------------- primitives

/** additive glow disc */
export function glow(x: number, y: number, z: number, w: number, col: number, life: number, a = 1, grow = 1) {
  const pool = FX.add;
  if (!pool) return;
  const s = spec();
  s.x = x; s.y = y; s.z = z; s.w0 = w; s.w1 = w * grow; s.c0 = col; s.life = life; s.a = a; s.fpow = 1.4;
  s.once = life <= 0; // life 0: just this frame (heads, halos)
  pool.emit(s);
}

/** a spray of streaking sparks, biased along (nx, ny, nz) */
export function sparks(
  x: number, y: number, z: number, n: number, col: number, speed: number,
  nx = 0, ny = 1, nz = 0, spread = 1, grav = -14, life = 0.35, w = 0.06, hot = 0xffffff,
) {
  const pool = FX.add;
  if (!pool) return;
  for (let i = 0; i < n; i++) {
    const s = spec();
    const v = speed * (0.45 + Math.random() * 0.8);
    let dx = nx + rnd(spread), dy = ny + rnd(spread), dz = nz + rnd(spread);
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    s.x = x; s.y = y; s.z = z; s.vx = dx * v; s.vy = dy * v; s.vz = dz * v;
    s.grav = grav; s.drag = 1.5; s.stretch = 0.035; s.w0 = w; s.w1 = w * 0.5;
    s.c0 = hot; s.c1 = col; s.life = life * (0.5 + Math.random() * 0.8); s.fpow = 1.2;
    pool.emit(s);
  }
}

/** soft (alpha-blended) puffs: smoke, dust, mist */
export function puffs(
  x: number, y: number, z: number, n: number, col: number, size: number, life: number,
  a = 0.5, spread = 0.6, rise = 0.4, nx = 0, ny = 0, nz = 0, grow = 3, col2 = -1,
) {
  const pool = FX.alpha;
  if (!pool) return;
  for (let i = 0; i < n; i++) {
    const s = spec();
    s.x = x + rnd(size * 0.4); s.y = y + rnd(size * 0.3); s.z = z + rnd(size * 0.4);
    s.vx = nx + rnd(spread); s.vy = ny + rise + rnd(spread * 0.5); s.vz = nz + rnd(spread);
    s.drag = 2.2; s.w0 = size * (0.7 + Math.random() * 0.5); s.w1 = s.w0 * grow;
    s.c0 = col; s.c1 = col2; s.a = a; s.life = life * (0.7 + Math.random() * 0.6); s.fin = 0.08; s.fpow = 1.3;
    pool.emit(s);
  }
}

/** dark chips / debris that tumble and fall */
export function chips(x: number, y: number, z: number, n: number, col: number, speed: number, nx: number, ny: number, nz: number, w = 0.05) {
  const pool = FX.alpha;
  if (!pool) return;
  for (let i = 0; i < n; i++) {
    const s = spec();
    const v = speed * (0.5 + Math.random() * 0.7);
    s.x = x; s.y = y; s.z = z;
    s.vx = (nx + rnd(0.8)) * v; s.vy = (ny + 0.5 + Math.random() * 0.6) * v; s.vz = (nz + rnd(0.8)) * v;
    s.grav = -16; s.drag = 0.6; s.stretch = 0.02; s.w0 = w; s.w1 = w;
    s.c0 = col; s.a = 0.95; s.life = 0.5 + Math.random() * 0.4; s.fpow = 0.4;
    pool.emit(s);
  }
}

const P = new THREE.Vector3();
const D = new THREE.Vector3();
const Q = new THREE.Vector3();
/** a jagged lightning bolt between two points, drawn for this frame only (redraw every frame to crackle) */
export function bolt(ax: number, ay: number, az: number, bx: number, by: number, bz: number, core: number, col: number, jitter = 0.35, forks = 1) {
  const pool = FX.add;
  if (!pool) return;
  D.set(bx - ax, by - ay, bz - az);
  const len = D.length();
  if (len < 0.01) return;
  D.divideScalar(len);
  const n = Math.max(4, Math.min(14, Math.round(len / 0.55)));
  let px = ax, py = ay, pz = az;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    let qx = ax + (bx - ax) * t, qy = ay + (by - ay) * t, qz = az + (bz - az) * t;
    if (i < n) {
      Q.set(rnd(), rnd(), rnd());
      Q.addScaledVector(D, -Q.dot(D));
      const j = jitter * Math.sin(Math.PI * t) * (0.5 + Math.random());
      qx += Q.x * j; qy += Q.y * j; qz += Q.z * j;
    }
    seg(px, py, pz, qx, qy, qz, core, 0xffffff, 1);
    seg(px, py, pz, qx, qy, qz, core * 5, col, 0.45);
    if (forks > 0 && i < n - 1 && Math.random() < forks / n) {
      // a short branch peeling off
      P.set(rnd(), rnd() * 0.6 - 0.3, rnd()).addScaledVector(D, 0.8).normalize();
      const fl = len * (0.12 + Math.random() * 0.15);
      bolt(qx, qy, qz, qx + P.x * fl, qy + P.y * fl, qz + P.z * fl, core * 0.6, col, jitter * 0.5, 0);
    }
    px = qx; py = qy; pz = qz;
  }
}

/** one fixed segment drawn this frame only */
export function seg(ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number, col: number, a: number, pool: SegPool | null = FX.add) {
  if (!pool) return;
  const s = spec();
  s.x = ax; s.y = ay; s.z = az; s.ox = bx - ax; s.oy = by - ay; s.oz = bz - az;
  if (!s.ox && !s.oy && !s.oz) s.ox = 1e-4;
  s.w0 = s.w1 = w; s.c0 = col; s.a = a; s.once = true;
  pool.emit(s);
}

/** a fixed segment that fades out over `life` (beams, ion trails) */
export function beam(ax: number, ay: number, az: number, bx: number, by: number, bz: number, w0: number, w1: number, col: number, a: number, life: number, vx = 0, vy = 0, vz = 0) {
  const pool = FX.add;
  if (!pool) return;
  const s = spec();
  s.x = ax; s.y = ay; s.z = az; s.ox = bx - ax; s.oy = by - ay; s.oz = bz - az;
  if (!s.ox && !s.oy && !s.oz) s.ox = 1e-4;
  s.vx = vx; s.vy = vy; s.vz = vz; s.drag = 2;
  s.w0 = w0; s.w1 = w1; s.c0 = col; s.a = a; s.life = life; s.fpow = 1.6;
  pool.emit(s);
}

// ---------------------------------------------------------------- surfaces

export type Surface = "robot" | "wall" | "ground" | "car" | "water" | "air";
export type Contact = { p: THREE.Vector3; n: THREE.Vector3 };

/**
 * Where did a round that just stopped actually stop? `prev` is where it was last frame
 * (always in the open), `pos` where it ended up. Fills `out` with the contact point and
 * surface normal.
 */
export function classify(prev: THREE.Vector3, pos: THREE.Vector3, vel: THREE.Vector3, out: Contact): Surface {
  const env = FX.env;
  out.p.copy(pos);
  out.n.set(0, 1, 0);
  if (!env) return "air";
  if (pos.y < 0) {
    const t = prev.y > 0 ? prev.y / (prev.y - pos.y) : 1;
    out.p.lerpVectors(prev, pos, t);
    out.p.y = 0;
    return "ground";
  }
  const h = env.half();
  if (Math.abs(pos.x) > h || Math.abs(pos.z) > h) {
    if (env.waterZ !== null && pos.z > env.waterZ - 0.5 && vel.z > 0) {
      // it sailed off the boardwalk: splash it where the straight line meets the sea
      const sea = -1.1;
      if (vel.y < -0.01) {
        const t = (pos.y - sea) / -vel.y;
        if (t < 2.5) {
          out.p.set(pos.x + vel.x * t, sea, pos.z + vel.z * t);
          return "water";
        }
      }
      return "air";
    }
    if (Math.abs(pos.x) > h) out.n.set(-Math.sign(pos.x), 0, 0);
    else out.n.set(0, 0, -Math.sign(pos.z));
    return "wall";
  }
  if (env.car(pos.x, pos.y, pos.z)) {
    out.n.set(-vel.x, 0, -vel.z).normalize();
    return "car";
  }
  if (env.solid(pos.x, pos.z)) {
    // walk back to the face it crossed
    let lo = 0, hi = 1;
    for (let k = 0; k < 7; k++) {
      const m = (lo + hi) / 2;
      P.lerpVectors(prev, pos, m);
      if (env.solid(P.x, P.z)) hi = m; else lo = m;
    }
    out.p.lerpVectors(prev, pos, lo);
    P.lerpVectors(prev, pos, hi);
    if (env.solid(P.x, out.p.z)) out.n.set(-Math.sign(vel.x) || 1, 0, 0);
    else out.n.set(0, 0, -Math.sign(vel.z) || 1);
    return "wall";
  }
  return "air";
}

/** the nearest living robot to a point, within its body radius (+ slack) */
export function robotAt(p: THREE.Vector3, slack = 0.35): FxEnemy | null {
  const env = FX.env;
  if (!env) return null;
  let best: FxEnemy | null = null;
  let bd = Infinity;
  for (const e of env.enemies) {
    if (!e.alive) continue;
    const d = Math.hypot(p.x - e.x, p.z - e.z);
    if (d < env.radius(e.kind) + slack && p.y < env.height(e.kind) && d < bd) { bd = d; best = e; }
  }
  return best;
}

/**
 * The generic "round meets surface" effect. `power` ~1 for a pistol round, bigger for
 * heavy hitters; `col` is the round's own colour (used for the hit flash).
 */
export function impact(surface: Surface, c: Contact, vel: THREE.Vector3, power: number, col: number, hole = true) {
  const { p, n } = c;
  const env = FX.env;
  const sp = Math.hypot(vel.x, vel.y, vel.z) || 1;
  // back toward the shooter, used for sparks off a robot
  const bx = -vel.x / sp, by = -vel.y / sp, bz = -vel.z / sp;
  const k = Math.min(3, power);
  if (surface === "robot") {
    glow(p.x, p.y, p.z, 0.8 + 0.3 * k, col, 0.12);
    glow(p.x, p.y, p.z, 0.35, 0xffffff, 0.07);
    sparks(p.x, p.y, p.z, Math.round(7 + 5 * k), 0xffb040, 5 + 2 * k, bx, by + 0.3, bz, 0.9, -14, 0.45);
    sound("metal", p.x, p.y, p.z);
  } else if (surface === "car") {
    glow(p.x, p.y, p.z, 0.7, 0xfff0c0, 0.09);
    sparks(p.x, p.y, p.z, Math.round(10 + 4 * k), 0xffc060, 6, n.x, n.y + 0.4, n.z, 0.8, -14, 0.45);
    sound("metal", p.x, p.y, p.z);
  } else if (surface === "wall" || surface === "ground") {
    const dust = env?.dust ?? 0x9a9080;
    puffs(p.x + n.x * 0.1, p.y + n.y * 0.1, p.z + n.z * 0.1, 2 + Math.round(k), dust, 0.18 + 0.08 * k, 0.7, 0.45,
      0.35, 0.25, n.x * 1.2, n.y * 1.2, n.z * 1.2, 3.2);
    chips(p.x, p.y, p.z, 4 + Math.round(k * 1.5), 0x2a2622, 3 + k, n.x, n.y, n.z, 0.06);
    glow(p.x + n.x * 0.05, p.y + n.y * 0.05, p.z + n.z * 0.05, 0.45, 0xffc080, 0.07, 0.8);
    sparks(p.x, p.y, p.z, 3 + Math.round(k), 0xffa040, 4, n.x, n.y, n.z, 1.1, -14, 0.25, 0.045);
    if (hole && FX.decals) FX.decals.add(p.x, p.y, p.z, n.x, n.y, n.z, 0.16 + 0.05 * k, 0, 7, 0.9);
    sound("wall", p.x, p.y, p.z);
  } else if (surface === "water") {
    splash(p.x, p.y, p.z, k);
  }
}

export function splash(x: number, y: number, z: number, k = 1) {
  const pool = FX.alpha;
  if (pool) {
    for (let i = 0; i < 10 + 4 * k; i++) {
      const s = spec();
      s.x = x + rnd(0.2); s.y = y; s.z = z + rnd(0.2);
      s.vx = rnd(1.6); s.vy = 3.5 + Math.random() * 3 * Math.min(2, k); s.vz = rnd(1.6);
      s.grav = -14; s.stretch = 0.03; s.w0 = 0.06; s.w1 = 0.03; s.c0 = 0xdff4ff; s.a = 0.85; s.life = 0.7; s.fpow = 0.6;
      pool.emit(s);
    }
  }
  puffs(x, y + 0.1, z, 3, 0xe8f6ff, 0.3, 0.6, 0.35, 0.4, 0.5);
  FX.rings?.add(x, y + 0.03, z, 0.15, 1.1 + 0.4 * k, 0.6, 0x9fd8ff, true);
  sound("splash", x, y, z);
}

/** BOOMER shell: fireball, light flash, ground shockwave, debris, smoke, scorch */
export function explosion(x: number, y: number, z: number, scale = 1) {
  const pool = FX.add;
  if (pool) {
    // the fake light: a huge soft flash that is gone in a blink
    glow(x, y, z, 9 * scale, 0xffb060, 0.13, 0.55);
    glow(x, y, z, 3.2 * scale, 0xffffff, 0.08, 0.9);
    for (let i = 0; i < 12; i++) {
      const s = spec();
      s.x = x + rnd(0.4); s.y = y + rnd(0.3) + 0.2; s.z = z + rnd(0.4);
      s.vx = rnd(3.2) * scale; s.vy = (1 + Math.random() * 2.5) * scale; s.vz = rnd(3.2) * scale;
      s.drag = 3.5; s.w0 = (0.7 + Math.random() * 0.6) * scale; s.w1 = s.w0 * 2.6;
      s.c0 = 0xffe070; s.c1 = 0xc0200a; s.a = 0.95; s.life = 0.35 + Math.random() * 0.3; s.fpow = 1.2;
      pool.emit(s);
    }
  }
  sparks(x, y + 0.2, z, 26, 0xff8020, 12 * scale, 0, 0.8, 0, 1.1, -12, 0.8, 0.05);
  chips(x, y + 0.2, z, 14, 0x1d1a18, 8 * scale, 0, 0.6, 0, 0.09);
  puffs(x, y + 0.4, z, 8, 0x3a3634, 0.9 * scale, 1.9, 0.55, 1.3, 1.2, 0, 0, 0, 3.2, 0x1a1816);
  const gy = Math.max(0.05, y < 2.2 ? 0.06 : y);
  FX.rings?.add(x, y < 2.2 ? gy : y, z, 0.4, 6 * scale, 0.5, 0xffa050, y < 2.2);
  if (y < 2.2) FX.decals?.add(x, 0.01, z, 0, 1, 0, 3.2 * scale, 1, 10, 1);
  sound("boom", x, y, z);
  const d = Math.hypot(x - FX.ear.x, z - FX.ear.z);
  if (d < 22) FX.kick.shake = Math.max(FX.kick.shake, (1 - d / 22) * 0.9 * scale);
}

/** FLAK: mid-air burst, dark smoke cloud, flash and a ring */
export function airBurst(x: number, y: number, z: number) {
  glow(x, y, z, 4.5, 0xffc070, 0.1, 0.8);
  glow(x, y, z, 1.4, 0xffffff, 0.06);
  sparks(x, y, z, 18, 0xff9a30, 9, 0, 0.2, 0, 1.2, -9, 0.45, 0.04);
  puffs(x, y, z, 7, 0x3b3530, 0.7, 1.4, 0.6, 1.2, 0.25, 0, 0, 0, 3, 0x24201c);
  FX.rings?.add(x, y, z, 0.2, 2.6, 0.28, 0x8a4418, false);
  sound("burst", x, y, z);
  const d = Math.hypot(x - FX.ear.x, z - FX.ear.z);
  if (d < 12) FX.kick.shake = Math.max(FX.kick.shake, (1 - d / 12) * 0.35);
}

/** GLACIER: the crystal shatters into shards and leaves frost behind */
export function shatter(c: Contact, surface: Surface) {
  const { p, n } = c;
  glow(p.x, p.y, p.z, 0.9, 0x9fe8ff, 0.12, 0.8);
  sparks(p.x, p.y, p.z, 14, 0x9fe8ff, 6, n.x, n.y + 0.3, n.z, 1, -16, 0.5, 0.045, 0xf4fdff);
  puffs(p.x, p.y, p.z, 4, 0xd8f4ff, 0.3, 0.9, 0.4, 0.5, 0.1, 0, 0, 0, 3, 0xa8dcf0);
  if (FX.decals) {
    if (surface === "wall" || surface === "ground") FX.decals.add(p.x, p.y, p.z, n.x, n.y, n.z, 1.1, 2, 5);
    else if (p.y < 3) FX.decals.add(p.x, 0.02, p.z, 0, 1, 0, 1.3, 2, 5);
  }
  sound("shatter", p.x, p.y, p.z);
}

/** a round punching clean through a robot and out the far side */
export function punchThrough(p: THREE.Vector3, vel: THREE.Vector3, col: number) {
  const sp = Math.hypot(vel.x, vel.y, vel.z) || 1;
  const dx = vel.x / sp, dy = vel.y / sp, dz = vel.z / sp;
  glow(p.x, p.y, p.z, 0.9, col, 0.1);
  glow(p.x, p.y, p.z, 0.35, 0xffffff, 0.06);
  sparks(p.x, p.y, p.z, 10, col, 10, dx, dy, dz, 0.45, -8, 0.3, 0.04);
  sparks(p.x, p.y, p.z, 5, 0xffb040, 4, -dx, 0.4, -dz, 1);
  sound("crack", p.x, p.y, p.z);
}
