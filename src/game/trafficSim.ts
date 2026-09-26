// Pure traffic simulation (no three.js, no React), stepped at a FIXED timestep so the
// cars take exactly the same path at 30, 60 or 144 fps. The renderer interpolates
// between the previous and current step for smooth motion.
//
// Roads come from the city layout: each has a centre line and a class that sets its
// lanes (1 per direction on side streets, 2 on avenues and the boulevard) and its
// curb-to-curb width. Right-hand traffic; right turns go to the outer lane, left turns
// to the inner one.
import { CURB, LANES, type Road } from "./cityLayout";
import { signal, GREEN, YELLOW } from "./trafficCore";
import type { Vehicle } from "./vehicles";

export const SIM_DT = 1 / 60;
/** Right-hand traffic: which side of the centre line a direction drives on (+1 / -1). */
export const laneSign = (axis: 0 | 1, dir: 1 | -1) => (axis === 0 ? dir : -dir);
const CROSSWALK = 3.8; // stop line distance past the curb line

export type Car = {
  v: Vehicle;
  h: number;
  axis: 0 | 1;
  dir: 1 | -1;
  /** index of the road we drive on (roadZ for axis 0, roadX for axis 1) */
  line: number;
  /** lane index on that road, 0 = inner */
  lane: number;
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
  /** far from every player: stepped at a quarter of the rate */
  far?: boolean;
  /** guest-side smoothed render position (follows host snapshots) */
  gx?: number;
  gz?: number;
};

export type SimEnemy = { x: number; z: number; alive: boolean; r: number; big: boolean };
export type SimEnv = {
  roadX: Road[];
  roadZ: Road[];
  rand: () => number;
  /** players the cars brake for; index 0 is the local player (for the horn) */
  players: { x: number; z: number }[];
  enemies: SimEnemy[];
  /** a moving car touched an enemy; the host applies damage / knockback */
  onEnemyContact?: ((car: Car, idx: number, big: boolean) => void) | undefined;
};

/** lateral offset of a lane from the road centre line */
export const laneOffset = (road: Road, axis: 0 | 1, dir: 1 | -1, lane: number) => {
  const ls = LANES[road.cls];
  return laneSign(axis, dir) * ls[Math.max(0, Math.min(ls.length - 1, lane))]!;
};

export const posOf = (c: Car, roadX: Road[], roadZ: Road[]) => {
  const road = (c.axis === 0 ? roadZ : roadX)[c.line]!;
  const perp = road.c + laneOffset(road, c.axis, c.dir, c.lane);
  return c.axis === 0 ? { x: c.s, z: perp } : { x: perp, z: c.s };
};
export const headingOf = (c: Car) => Math.atan2(c.axis === 0 ? c.dir : 0, c.axis === 1 ? c.dir : 0);

/** new heading after turning (1 right / -1 left) from (axis, dir) */
function turned(axis: 0 | 1, dir: 1 | -1, turn: 1 | -1) {
  const dx = axis === 0 ? dir : 0;
  const dz = axis === 1 ? dir : 0;
  // right of heading (dx, dz) is (-dz, dx)
  const nx = turn === 1 ? -dz : dz;
  const nz = turn === 1 ? dx : -dx;
  const naxis = (1 - axis) as 0 | 1;
  const ndir = (naxis === 0 ? nx : nz) as 1 | -1;
  return { naxis, ndir };
}

/**
 * Advance cars by exactly `dt`. `only` limits the step to near (false) or far (true) cars,
 * so far cars can run at a lower rate with a larger dt. Returns the indices of cars that
 * are braking for the local player (so the caller can honk).
 */
export function stepCars(
  cars: Car[],
  env: SimEnv,
  dt: number,
  t: number,
  only: boolean | null = null,
) {
  const { roadX, roadZ, rand } = env;
  const brakingForLocal: number[] = [];
  for (let ci = 0; ci < cars.length; ci++) {
    const c = cars[ci]!;
    if (only !== null && !!c.far !== only) continue;
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
        w.push(2.2);
      }
      for (const turn of [1, -1] as const) {
        const { ndir } = turned(c.axis, c.dir, turn);
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

    const crossRoad = cross[c.next]!;
    const cx = crossRoad.c;
    const crossHalf = CURB[crossRoad.cls];
    const ownRoad = along[c.line]!;
    const node = c.axis === 0 ? c.next * roadZ.length + c.line : c.line * roadZ.length + c.next;
    const stopCentre = cx - c.dir * (crossHalf + CROSSWALK + half);
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
      const ix = c.axis === 0 ? cx : ownRoad.c;
      const iz = c.axis === 0 ? ownRoad.c : cx;
      const boxX = c.axis === 0 ? crossHalf : CURB[ownRoad.cls];
      const boxZ = c.axis === 0 ? CURB[ownRoad.cls] : crossHalf;
      let exAxis: 0 | 1 = c.axis;
      let exDir: 1 | -1 = c.dir;
      let exLine = c.line;
      let exLane = c.lane;
      let exEntry = cx + c.dir * crossHalf;
      if (c.turn !== 0 && c.turn !== null) {
        const { naxis, ndir } = turned(c.axis, c.dir, c.turn);
        exAxis = naxis;
        exDir = ndir;
        exLine = c.next;
        exLane = c.turn === 1 ? LANES[crossRoad.cls].length - 1 : 0;
        exEntry = ownRoad.c + exDir * CURB[ownRoad.cls];
      }
      let busy = false;
      for (const o of cars) {
        if (o === c) continue;
        if (o.axis !== c.axis && Math.abs(o.x - ix) < boxX && Math.abs(o.z - iz) < boxZ) {
          busy = true;
          break;
        }
        if (o.axis === exAxis && o.dir === exDir && o.line === exLine && o.lane === exLane) {
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
      if (o === c || o.axis !== c.axis || o.dir !== c.dir || o.line !== c.line || o.lane !== c.lane)
        continue;
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
      if (a > 0 && a < half + 12 && Math.abs(lat) < c.v.wid / 2 + 0.9) {
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
    let move = c.dir * ((v0 + c.speed) / 2) * dt;
    // a coarse far step must not jump past a red light
    if (c.far && !committed && room < Infinity)
      move = c.dir * Math.min(Math.abs(move), Math.max(0, room));
    c.s += move;

    if (c.turn !== 0) {
      // turn where our lane meets the target lane; overshoot carries into the new lane
      const { naxis, ndir } = turned(c.axis, c.dir, c.turn);
      const nlane = c.turn === 1 ? LANES[crossRoad.cls].length - 1 : 0;
      const turnS = cx + laneOffset(crossRoad, naxis, ndir, nlane);
      if ((c.s - turnS) * c.dir >= 0) {
        const over = (c.s - turnS) * c.dir;
        const perp = ownRoad.c + laneOffset(ownRoad, c.axis, c.dir, c.lane);
        const oldLine = c.line;
        c.axis = naxis;
        c.dir = ndir;
        c.line = c.next;
        c.lane = nlane;
        c.s = perp + ndir * over;
        c.next = oldLine + ndir;
        c.turn = null;
      }
    } else if ((c.s - cx) * c.dir > crossHalf + half) {
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
