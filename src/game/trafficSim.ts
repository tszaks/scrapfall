// Pure traffic simulation (no three.js, no React), stepped at a FIXED timestep so the
// cars take exactly the same path at 30, 60 or 144 fps. The renderer interpolates
// between the previous and current step for smooth motion.
import { signal, GREEN, YELLOW } from "./trafficCore";
import type { Vehicle } from "./vehicles";

export const SIM_DT = 1 / 60;
/** Right-hand traffic: lane centre offset from the road centre line. */
export const laneOff = (axis: 0 | 1, dir: 1 | -1) => (axis === 0 ? dir : -dir);
export const HALF_ROAD = 2;
const STOP_GAP = 4.1; // road half width + crosswalk

export type Car = {
  v: Vehicle;
  h: number;
  axis: 0 | 1;
  dir: 1 | -1;
  /** index of the road we drive on (roadZ for axis 0, roadX for axis 1) */
  line: number;
  /** position along the axis of travel */
  s: number;
  speed: number;
  vmax: number;
  /** index of the next cross road ahead */
  next: number;
  /** -1 left, 0 straight, 1 right, null = not decided yet */
  turn: -1 | 0 | 1 | null;
  yawVis: number;
  honk: number;
  hitCd: number;
  /** world position at the previous / current fixed step (for render interpolation) */
  px: number;
  pz: number;
  x: number;
  z: number;
  /** guest-side smoothed render position (follows host snapshots) */
  gx?: number;
  gz?: number;
};

export type SimEnemy = { x: number; z: number; alive: boolean; r: number; big: boolean };
export type SimEnv = {
  roadX: number[];
  roadZ: number[];
  rand: () => number;
  /** players the cars brake for; index 0 is the local player (for the horn) */
  players: { x: number; z: number }[];
  enemies: SimEnemy[];
  /** a moving car touched an enemy; the host applies damage / knockback */
  onEnemyContact?: ((car: Car, idx: number, big: boolean) => void) | undefined;
};

export const posOf = (c: Car, roadX: number[], roadZ: number[]) => {
  const perp = (c.axis === 0 ? roadZ : roadX)[c.line]! + laneOff(c.axis, c.dir);
  return c.axis === 0 ? { x: c.s, z: perp } : { x: perp, z: c.s };
};
export const headingOf = (c: Car) => Math.atan2(c.axis === 0 ? c.dir : 0, c.axis === 1 ? c.dir : 0);

/**
 * Advance every car by exactly `dt` (call with SIM_DT). Returns the indices of cars
 * that are braking for the local player (so the caller can honk).
 */
export function stepCars(cars: Car[], env: SimEnv, dt: number, t: number) {
  const { roadX, roadZ, rand } = env;
  const brakingForLocal: number[] = [];
  for (let ci = 0; ci < cars.length; ci++) {
    const c = cars[ci]!;
    const cross = c.axis === 0 ? roadX : roadZ;
    const along = c.axis === 0 ? roadZ : roadX; // roads parallel to us, indexed by line
    const half = c.v.len / 2;
    c.px = c.x;
    c.pz = c.z;

    // decide what to do at the next intersection
    if (c.turn === null) {
      const opts: (-1 | 0 | 1)[] = [];
      const w: number[] = [];
      if (c.next + c.dir >= 0 && c.next + c.dir < cross.length) {
        opts.push(0);
        w.push(2);
      }
      for (const turn of [1, -1] as const) {
        // right of heading (dx, dz) is (-dz, dx)
        const dx = c.axis === 0 ? c.dir : 0;
        const dz = c.axis === 1 ? c.dir : 0;
        const nx = turn === 1 ? -dz : dz;
        const nz = turn === 1 ? dx : -dx;
        const ndir = (c.axis === 0 ? nz : nx) as 1 | -1;
        const nextIdx = c.line + ndir;
        if (nextIdx >= 0 && nextIdx < along.length) {
          opts.push(turn);
          w.push(1);
        }
      }
      let r = rand() * w.reduce((a, b) => a + b, 0);
      c.turn = opts[opts.length - 1] ?? 0;
      for (let k = 0; k < opts.length; k++) {
        r -= w[k]!;
        if (r <= 0) {
          c.turn = opts[k]!;
          break;
        }
      }
    }

    const cx = cross[c.next]!;
    const node = c.axis === 0 ? c.next * roadZ.length + c.line : c.line * roadZ.length + c.next;
    const stopCentre = cx - c.dir * (STOP_GAP + half);
    const committed = (c.s - stopCentre) * c.dir > 0.05;
    let room = Infinity;

    const light = signal(node, t, c.axis);
    if (!committed && light !== GREEN) {
      const dist = (stopCentre - c.s) * c.dir;
      const canStop = dist > (c.speed * c.speed) / (2 * 6);
      if (light !== YELLOW || canStop) room = Math.min(room, dist);
    }
    // don't enter the box while cross traffic is still in it, or if our exit lane is backed up
    if (!committed) {
      const ix = c.axis === 0 ? cx : along[c.line]!;
      const iz = c.axis === 0 ? along[c.line]! : cx;
      let exAxis: 0 | 1 = c.axis;
      let exDir: 1 | -1 = c.dir;
      let exLine = c.line;
      let exEntry = cx + c.dir * HALF_ROAD;
      if (c.turn !== 0 && c.turn !== null) {
        const dx = c.axis === 0 ? c.dir : 0;
        const dz = c.axis === 1 ? c.dir : 0;
        exAxis = (1 - c.axis) as 0 | 1;
        exDir = (exAxis === 0 ? (c.turn === 1 ? -dz : dz) : c.turn === 1 ? dx : -dx) as 1 | -1;
        exLine = c.next;
        exEntry = along[c.line]! + exDir * HALF_ROAD;
      }
      let busy = false;
      for (const o of cars) {
        if (o === c) continue;
        if (
          o.axis !== c.axis &&
          Math.abs(o.x - ix) < HALF_ROAD + 1 &&
          Math.abs(o.z - iz) < HALF_ROAD + 1
        ) {
          busy = true;
          break;
        }
        if (o.axis === exAxis && o.dir === exDir && o.line === exLine) {
          const past = (o.s - exEntry) * exDir; // how far into the exit lane it is
          // a queued car needs a full car length of room; a moving one just needs to be clear of the entry
          const need = o.speed < 2 ? o.v.len / 2 + c.v.len + 1.5 : o.v.len / 2 + c.v.len / 2 + 1.5;
          if (past > -o.v.len / 2 - 1 && past < need) {
            busy = true;
            break;
          }
        }
      }
      if (busy) room = Math.min(room, (stopCentre - c.s) * c.dir);
    }
    // keep distance to whoever is ahead in our lane
    for (const o of cars) {
      if (o === c || o.axis !== c.axis || o.dir !== c.dir || o.line !== c.line) continue;
      const ahead = (o.s - c.s) * c.dir;
      if (ahead <= 0) continue;
      room = Math.min(room, ahead - o.v.len / 2 - half - 2);
    }
    const fx = c.axis === 0 ? c.dir : 0;
    const fz = c.axis === 1 ? c.dir : 0;
    const rx = -fz; // right-hand vector of the heading
    const rz = fx;
    // brake for any player standing in the lane
    for (let pi = 0; pi < env.players.length; pi++) {
      const who = env.players[pi]!;
      const dx = who.x - c.x;
      const dz = who.z - c.z;
      const a = dx * fx + dz * fz;
      const lat = dx * rx + dz * rz;
      if (a > 0 && a < half + 11 && Math.abs(lat) < c.v.wid / 2 + 0.9) {
        room = Math.min(room, a - half - 1.4);
        if (pi === 0 && a < half + 8) brakingForLocal.push(ci);
      }
    }
    // big enemies (brutes, vanguards, elites, mini-boss, boss) are obstacles: brake for them
    for (const e of env.enemies) {
      if (!e.alive || !e.big) continue;
      const dx = e.x - c.x;
      const dz = e.z - c.z;
      const a = dx * fx + dz * fz;
      if (a > 0 && a < half + e.r + 9 && Math.abs(dx * rx + dz * rz) < c.v.wid / 2 + e.r + 0.3)
        room = Math.min(room, a - half - e.r - 0.8);
    }

    const target = Math.min(c.vmax, Math.sqrt(Math.max(0, 2 * 7 * room)));
    const v0 = c.speed;
    if (c.speed < target) c.speed = Math.min(target, c.speed + 3.5 * dt);
    else c.speed = Math.max(target, c.speed - 16 * dt);
    if (c.speed < 0) c.speed = 0;
    c.s += c.dir * ((v0 + c.speed) / 2) * dt;

    if (c.turn !== 0) {
      // turn exactly where our lane meets the target lane; overshoot carries into the new lane
      const dx = c.axis === 0 ? c.dir : 0;
      const dz = c.axis === 1 ? c.dir : 0;
      const nx = c.turn === 1 ? -dz : dz;
      const nz = c.turn === 1 ? dx : -dx;
      const naxis = (1 - c.axis) as 0 | 1;
      const ndir = (naxis === 0 ? nx : nz) as 1 | -1;
      const turnS = cx + laneOff(naxis, ndir);
      if ((c.s - turnS) * c.dir >= 0) {
        const over = (c.s - turnS) * c.dir;
        const perp = along[c.line]! + laneOff(c.axis, c.dir);
        const oldLine = c.line;
        c.axis = naxis;
        c.dir = ndir;
        c.line = c.next;
        c.s = perp + ndir * over;
        c.next = oldLine + ndir;
        c.turn = null;
      }
    } else if ((c.s - cx) * c.dir > HALF_ROAD + half) {
      c.next += c.dir;
      c.turn = null;
    }
    if (c.next < 0 || c.next >= (c.axis === 0 ? roadX : roadZ).length) {
      // should not happen (turns only pick roads that continue): turn around safely
      c.dir = -c.dir as 1 | -1;
      c.next = Math.max(0, Math.min((c.axis === 0 ? roadX : roadZ).length - 1, c.next - c.dir * 2));
      c.turn = null;
    }
    const p = posOf(c, roadX, roadZ);
    c.x = p.x;
    c.z = p.z;

    // contact with enemies (host only supplies the callback)
    if (env.onEnemyContact && c.speed > 0.5) {
      const sin = Math.sin(headingOf(c));
      const cos = Math.cos(headingOf(c));
      for (let ei = 0; ei < env.enemies.length; ei++) {
        const e = env.enemies[ei]!;
        if (!e.alive) continue;
        const ex = e.x - c.x;
        const ez = e.z - c.z;
        if (
          Math.abs(ex * sin + ez * cos) > half + e.r ||
          Math.abs(ex * cos - ez * sin) > c.v.wid / 2 + e.r
        )
          continue;
        if (e.big) {
          // hitting something that big stops the car dead
          c.speed = 0;
          env.onEnemyContact(c, ei, true);
        } else if (c.speed > 3) {
          env.onEnemyContact(c, ei, false);
          c.speed *= 0.7;
        }
      }
    }
  }
  return brakingForLocal;
}
