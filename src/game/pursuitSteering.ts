import { bodyFree, bodyStepFree } from "./enemyBody";
import {
  blocked,
  nextWaypoint,
  fineStep,
  clearShot,
  type Block,
  type NavGrid,
  type FineField,
} from "./level";
import { groundY } from "./terrain";
import { navigationLine } from "./navigation";
import { PursuitDetour, type PursuitPoint } from "./pursuitDetour";

const detours = new PursuitDetour();
const probe = {
  blocks: [] as Block[],
  height: 2,
  segmentClear(ax: number, az: number, bx: number, bz: number, radius: number) {
    return (
      navigationLine(this.blocks, ax, az, bx, bz, Math.min(radius, 0.8)) &&
      bodyStepFree(this.blocks, ax, az, bx, bz, radius, this.height)
    );
  },
};

/** Run on steering memo misses, not per frame. Physical movement still checks every step. */
export function pursuitSteering(
  actor: PursuitPoint,
  target: PursuitPoint,
  desired: PursuitPoint,
  time: number,
  blocks: Block[],
  radius: number,
  height: number,
) {
  probe.blocks = blocks;
  probe.height = height;
  return detours.resolve(actor, target, desired, time, radius, probe);
}

// Ranged hold decisions share a short-lived visibility memo, including rendered
// cover. Distance alone cannot tell whether an enemy has a usable firing lane.
const shots = new WeakMap<
  object,
  { time: number; x: number; z: number; tx: number; tz: number; ty: number; clear: boolean }
>();
export function pursuitHasShot(
  actor: PursuitPoint,
  target: PursuitPoint & { y: number },
  time: number,
  blocks: Block[],
) {
  let memo = shots.get(actor);
  if (
    memo &&
    time < memo.time &&
    Math.abs(actor.x - memo.x) + Math.abs(actor.z - memo.z) < 0.8 &&
    Math.abs(target.x - memo.tx) + Math.abs(target.z - memo.tz) + Math.abs(target.y - memo.ty) < 0.8
  )
    return memo.clear;
  const clear = clearShot(
    blocks,
    actor.x,
    groundY(actor.x, actor.z) + 1.3,
    actor.z,
    target.x,
    target.y - 0.3,
    target.z,
  );
  if (!memo) {
    memo = { time: 0, x: 0, z: 0, tx: 0, tz: 0, ty: 0, clear };
    shots.set(actor, memo);
  }
  memo.time = time + 0.15 + Math.abs(Math.sin(actor.x * 13 + actor.z * 7)) * 0.1;
  memo.x = actor.x;
  memo.z = actor.z;
  memo.tx = target.x;
  memo.tz = target.z;
  memo.ty = target.y;
  memo.clear = clear;
  return clear;
}

const routePoint = { x: 0, z: 0 };
/** Mesh props may occupy a coarse centroid. Continue down the same field to a
 * reachable endpoint; the local planner must still sweep every intervening step. */
export function pursuitGoal(
  nav: NavGrid,
  field: Float32Array,
  actor: PursuitPoint,
  desired: PursuitPoint,
  blocks: Block[],
  radius: number,
  height: number,
  fine?: FineField,
) {
  routePoint.x = desired.x;
  routePoint.z = desired.z;
  for (let i = 0; i < 8; i++) {
    if (Math.hypot(routePoint.x - actor.x, routePoint.z - actor.z) > 24) return null;
    if (
      !blocked(blocks, routePoint.x, routePoint.z, Math.min(radius, 0.8)) &&
      bodyFree(blocks, routePoint.x, routePoint.z, radius, height)
    )
      return routePoint;
    const next = fine
      ? fineStep(fine, routePoint.x, routePoint.z, routePoint)
      : nextWaypoint(nav, field, routePoint.x, routePoint.z, routePoint);
    if (!next) return null;
  }
  return null;
}
