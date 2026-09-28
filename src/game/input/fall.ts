// Jumping off roofs and fall damage.
//
// A walkable roof (the building-access system: Vice Heights' elevator and stair roofs, the pier
// rooftops, chalet balconies) keeps its parapet as a wall to walk into, but a player in the
// middle of a jump goes over it and falls: they land on the street below, or on a lower
// walkable roof. The street / other roof beside the edge must be open (a roof whose edge sits
// over more of the building, e.g. a tower over its podium, stays walled: nobody falls into a
// wall). Solo blockades, map edges, fences and railings are grid walls: never crossed.
//
// Damage by the drop, in floors of FLOOR_H metres, as a share of the class's max HP:
// FALL_TABLE below (straight lines between rows). FALL_DOWN_FLOORS and up: instantly DOWN
// (co-op: bleeding out, revivable; solo: dead, unless SOLO_FALL_DOWN_KILLS is switched off).
import { blocked, type Block } from "../level";
import { downhill, groundY, steepAt } from "../terrain";
import { accessList, player as accPlayer, roofAt } from "../access/world";
import { moveState, startFall } from "./movement";

/** one storey (m) */
export const FLOOR_H = 3.5;
/** [floors dropped, share of max HP lost] */
export const FALL_TABLE: [number, number][] = [
  [0, 0],
  [1, 0.02],
  [2, 0.1], // 1-2 floors: hardly anything
  [3, 0.25],
  [4, 0.45],
  [5, 0.55], // ~half at 4-5 floors
  [6, 0.7],
  [7, 0.85],
];
/** this many floors or more: instantly down */
export const FALL_DOWN_FLOORS = 7;
/** solo has no teammate to revive you: a downing fall kills (false: you keep 1 HP instead,
 * the hook for a future self-revive) */
export const SOLO_FALL_DOWN_KILLS = true;
/** drops under this never hurt (a jump off a porch, a normal jump) */
const SAFE_DROP = 2.5;

/** share of max HP a drop of `drop` metres costs; `down` for a downing fall */
export function fallShare(drop: number): { share: number; down: boolean } {
  if (drop < SAFE_DROP) return { share: 0, down: false };
  const floors = drop / FLOOR_H;
  if (floors >= FALL_DOWN_FLOORS) return { share: 1, down: true };
  for (let i = 1; i < FALL_TABLE.length; i++) {
    const [f1, s1] = FALL_TABLE[i]!;
    const [f0, s0] = FALL_TABLE[i - 1]!;
    if (floors <= f1) return { share: s0 + ((s1 - s0) * (floors - f0)) / (f1 - f0), down: false };
  }
  return { share: FALL_TABLE[FALL_TABLE.length - 1]![1], down: false };
}

/** HP a drop costs a player with `maxHp` / `hp` now (down: all of it) */
export function fallDamage(drop: number, maxHp: number, hp: number, solo: boolean) {
  const { share, down } = fallShare(drop);
  if (down) return solo && !SOLO_FALL_DOWN_KILLS ? Math.max(0, hp - 1) : hp;
  return Math.round(share * maxHp);
}

const BODY = 0.4;

/**
 * On a roof, pushing into its edge mid-jump: go over. Returns true when the player left the
 * roof (`pos` moved just past the building's collision, the fall started, the access zone is
 * the street's or the lower roof's).
 */
export function tryRoofExit(
  pos: { x: number; z: number },
  mx: number,
  mz: number,
  blocks: Block[],
) {
  if (accPlayer.zone !== 2 || accPlayer.b < 0) return false;
  // mid-jump, clear of the parapet's top half (apex ~1.1 m, parapets ~1.05-1.15 m)
  if (!moveState.airborne || moveState.lift < 0.45) return false;
  const b = accessList()[accPlayer.b];
  if (!b) return false;
  const R = b.spec.roof;
  // the edge being pushed into: outward normal of the nearest side, and the push must face it
  const gaps = [pos.x - R.x0, R.x1 - pos.x, pos.z - R.z0, R.z1 - pos.z];
  const side = gaps.indexOf(Math.min(...gaps));
  if (gaps[side]! > BODY + 0.35) return false;
  const [nx, nz] = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ][side]!;
  if (mx * nx! + mz * nz! < 0.3) return false;
  // first open spot past the edge (the building's grid cells round outward up to ~2 m)
  const x0 = side === 0 ? R.x0 : side === 1 ? R.x1 : pos.x;
  const z0 = side === 2 ? R.z0 : side === 3 ? R.z1 : pos.z;
  for (let t = BODY + 0.1; t <= 3.6; t += 0.2) {
    const x = x0 + nx! * t;
    const z = z0 + nz! * t;
    const k = roofAt(x, z);
    if (k === accPlayer.b) continue;
    if (blocked(blocks, x, z, BODY)) continue;
    // only ever down: never onto something higher than the feet
    if (groundY(x, z) > moveState.feet) return false;
    pos.x = x;
    pos.z = z;
    Object.assign(accPlayer, {
      zone: 0,
      b: -1,
      level: 0,
      inCar: false,
      lap: 0,
      region: 0,
      climb: 0,
      y: groundY(x, z),
    });
    startFall();
    return true;
  }
  return false;
}

/** landed (after a fall): the access zone is the roof under the feet, or the street */
export function landZone(x: number, z: number, y = moveState.feet) {
  if (accPlayer.zone === 1) return; // inside a building: its own system
  const k = roofAt(x, z);
  if (k >= 0 && Math.abs(accessList()[k]!.top - y) < 0.25)
    Object.assign(accPlayer, {
      zone: 2,
      b: k,
      level: 1,
      inCar: false,
      lap: 0,
      region: 0,
      climb: 0,
    });
  else if (accPlayer.zone === 2) Object.assign(accPlayer, { zone: 0, b: -1 });
}

/**
 * Landed on the face of a ledge (a fall past a balcony edge that ran out of forward speed):
 * slide straight down the slope to the first spot you can stand on, so nobody is stranded
 * on ground too steep to walk off.
 */
export function slideOffFace(pos: { x: number; z: number }, blocks: Block[]) {
  if (!steepAt(pos.x, pos.z)) return false;
  let x = pos.x;
  let z = pos.z;
  for (let k = 0; k < 30; k++) {
    const d = downhill(x, z);
    if (!d) break;
    const nx = x + d[0] * 0.1;
    const nz = z + d[1] * 0.1;
    if (blocked(blocks, nx, nz, BODY)) break;
    x = nx;
    z = nz;
    if (!steepAt(x, z)) {
      pos.x = x;
      pos.z = z;
      return true;
    }
  }
  return false;
}
