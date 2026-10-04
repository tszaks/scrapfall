// Physical collision for ground enemies — the same world bodies a player gets.
// Robots used to walk straight through queues of cars because the enemy step only
// ever asked the nav grid. Movement keeps its blocked() call (the 2 m cells, the
// posts, blockHook and structureStreet it already runs) and layers this on top:
//
//   boundaryBlocked — the blockade ring and the play-square edge
//   trafficDepth    — liveCars: city cars, the Dry Gulch train, riders and alpine
//                     vehicles; the same published boxes bullets already stop on
//   wheelSolid      — the Ferris wheel's moving frame (cheap; early-outs off-map)
//   staticBody      — the rendered map via three-mesh-bvh: walls, props, parked
//                     cars and lift towers — whatever the coarse grid under-reads
//
// Per-kind rules — the exception list a reviewer signs off on, in one place:
//   walk  every ground kind: the grid plus all of the above (player parity)
//   fly   hornet and medic drones hover over traffic and low props: the grid,
//         posts and the boundary ring only (trafficSim already gives them -99)
//   ghost the SPECTER drifts through walls and cars by design — callers keep it
//         on ghostOK() terrain checks; only its blink landing spot is filtered
//
// Deliberately not solid (parity, not oversight): hazard props — drums, kegs and
// condensers are shootable set dressing for players too; interior stairs stay
// enemy-blocked (structureStreet) because there is no multi-level navigation;
// water edges and steep slopes remain climbable()'s job for both sides.
import { blocked, boundaryBlocked, type Block } from "./level";
import { groundY } from "./terrain";
import { trafficDepth } from "./trafficCore";
export { trafficDepth } from "./trafficCore";
import { staticBody, staticCollisionReady, staticNear } from "./staticCollision";
import { wheelSolid } from "./beach/wheelRide";
import { FLYERS } from "./enemyKinds";

/** the collision rule for a kind — every exception is decided by this one lookup */
export type BodyRule = "walk" | "fly" | "ghost";
export const bodyRule = (kind: string): BodyRule =>
  kind === "specter" ? "ghost" : FLYERS.has(kind) ? "fly" : "walk";

/**
 * The escape budget for a body already overlapped by a car (a bad spawn, a
 * knock-in, a car that drove into it): the deepest overlap the next step may
 * keep. A small, frame-independent margin means every legal step is
 * strictly shallower — a car can never pin, and a rim skim can't linger.
 */
export function trafficTol(x: number, z: number, r: number, feet: number, height: number): number {
  return Math.max(0, trafficDepth(x, z, r, feet, height) - 1e-6);
}

// wheelSolid only reads fields — one scratch keeps the check allocation-free
const W = { x: 0, y: 0, z: 0 };
function wheelHits(x: number, z: number, feet: number, height: number) {
  W.x = x;
  W.z = z;
  W.y = feet + 0.7;
  if (wheelSolid(W)) return true;
  if (height > 1.4) {
    W.y = feet + height - 0.7;
    return wheelSolid(W);
  }
  return false;
}

/**
 * Is this spot already inside the rendered geometry? Movement passes the answer
 * for the body's CURRENT position as `sFree` so an enemy that spawned before the
 * BVH finished (or was shoved in) can still step back out — static must never
 * become a pin either.
 */
export function insideStatic(x: number, z: number, r: number, height: number) {
  if (!staticCollisionReady()) return false;
  const feet = groundY(x, z);
  return staticNear(x, z, r, feet, height) && staticBody(x, z, r, feet, height, 0.2);
}

/**
 * Everything solid to a standing body beyond what blocked() sees. `tMax` is the
 * traffic overlap still tolerated: an enemy already inside a car (a bad spawn,
 * a knockback) passes its current depth so steps toward shallower overlap stay
 * legal — a car box must never become a pin. `sFree` is the same valve for the
 * static mesh: true while the body's current spot is inside it.
 */
export function bodyFree(
  blocks: Block[],
  x: number,
  z: number,
  r: number,
  height: number,
  tMax = 0,
  sFree = false,
): boolean {
  const feet = groundY(x, z);
  if (boundaryBlocked(blocks, x, z, r)) return false;
  if (trafficDepth(x, z, r, feet, height) > tMax) return false;
  if (wheelHits(x, z, feet, height)) return false;
  return (
    sFree ||
    !staticCollisionReady() ||
    !staticNear(x, z, r, feet, height) ||
    !staticBody(x, z, r, feet, height, 0.2)
  );
}

/** Which layer stops a ground body at a spot — the debug handle and audits. */
export function enemyBlock(blocks: Block[], x: number, z: number, r = 0.6, height = 2) {
  if (blocked(blocks, x, z, r)) return "grid" as const;
  if (boundaryBlocked(blocks, x, z, r)) return "boundary" as const;
  const feet = groundY(x, z);
  if (trafficDepth(x, z, r, feet, height) > 0) return "traffic" as const;
  if (wheelHits(x, z, feet, height)) return "wheel" as const;
  if (
    staticCollisionReady() &&
    staticNear(x, z, r, feet, height) &&
    staticBody(x, z, r, feet, height, 0.2)
  )
    return "mesh" as const;
  return false;
}

/** Sweep a whole body move. Fast charges and knockback cannot skip thin geometry.
 * An existing overlap may shrink, but a newly reached clear point stays clear. */
export function bodyStepFree(
  blocks: Block[],
  fromX: number,
  fromZ: number,
  x: number,
  z: number,
  r: number,
  height: number,
): boolean {
  const dx = x - fromX,
    dz = z - fromZ;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / Math.min(0.2, r * 0.5)));
  let depth = trafficDepth(fromX, fromZ, r, groundY(fromX, fromZ), height);
  let inside = insideStatic(fromX, fromZ, r, height);
  for (let i = 1; i <= steps; i++) {
    const px = fromX + (dx * i) / steps,
      pz = fromZ + (dz * i) / steps;
    const next = trafficDepth(px, pz, r, groundY(px, pz), height);
    if (depth > 0 ? next >= depth - 1e-8 : next > 0) return false;
    if (!bodyFree(blocks, px, pz, r, height, next, inside)) return false;
    depth = next;
    if (inside && !insideStatic(px, pz, r, height)) inside = false;
  }
  return true;
}
