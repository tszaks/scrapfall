// Riding the chairlift. The chairs' positions come from the shared lift clock (alpine.t),
// so every client agrees where chair i is; a rider is just "sitting on chair i". Walk onto
// the painted line at a terminal's loading platform and the next chair scoops you up; you
// can look around and shoot on the way; at the far terminal you step off onto the platform.
import { cableY } from "./build";
import type { AlpineData, Lift } from "./layout";
import { alpine } from "./weather";

export const LIFT_SPEED = 2.3;
const CHAIR_GAP = 15;
/** eye height above the chair's grip when seated */
const SEAT_EYE = -1.72;

export function liftPath(lift: Lift) {
  const s0 = lift.supports[0]!;
  const s1 = lift.supports[lift.supports.length - 1]!;
  const run = Math.abs(s0.z - s1.z);
  const bull = Math.PI * lift.gauge;
  const total = run * 2 + bull * 2;
  const yAtZ = (z: number) => {
    for (let i = 0; i + 1 < lift.supports.length; i++) {
      const p = lift.supports[i]!;
      const q = lift.supports[i + 1]!;
      if (z <= p.z && z >= q.z) return cableY(p, q, (p.z - z) / (p.z - q.z));
    }
    return z > s0.z ? s0.y : s1.y;
  };
  const out = { x: 0, y: 0, z: 0, yaw: 0 };
  const at = (s: number) => {
    s = ((s % total) + total) % total;
    if (s < run) {
      out.x = lift.x - lift.gauge;
      out.z = s0.z - s;
      out.yaw = 0;
    } else if (s < run + bull) {
      const a = ((s - run) / bull) * Math.PI;
      out.x = lift.x - Math.cos(a) * lift.gauge;
      out.z = s1.z - Math.sin(a) * lift.gauge;
      out.yaw = -a;
    } else if (s < run * 2 + bull) {
      out.x = lift.x + lift.gauge;
      out.z = s1.z + (s - run - bull);
      out.yaw = Math.PI;
    } else {
      const a = ((s - run * 2 - bull) / bull) * Math.PI;
      out.x = lift.x + Math.cos(a) * lift.gauge;
      out.z = s0.z + Math.sin(a) * lift.gauge;
      out.yaw = Math.PI - a;
    }
    out.y = yAtZ(Math.max(Math.min(out.z, s0.z), s1.z));
    return out;
  };
  return { total, run, bull, at };
}

const paths = new WeakMap<Lift, ReturnType<typeof liftPath>>();
export function pathOf(lift: Lift) {
  let p = paths.get(lift);
  if (!p) {
    p = liftPath(lift);
    paths.set(lift, p);
  }
  return p;
}
export const chairCount = (lift: Lift) => Math.floor(pathOf(lift).total / CHAIR_GAP);
/** where along the loop chair i is right now */
export function chairS(lift: Lift, i: number) {
  const p = pathOf(lift);
  const s = alpine.t * LIFT_SPEED + (i * p.total) / chairCount(lift);
  return ((s % p.total) + p.total) % p.total;
}
export function chairAt(lift: Lift, i: number) {
  return pathOf(lift).at(chairS(lift, i));
}
/** eye position of someone sitting on chair i (used for teammates too) */
export function riderEye(lift: Lift, i: number) {
  const p = chairAt(lift, i);
  return { x: p.x + Math.sin(p.yaw) * 0.12, y: p.y + SEAT_EYE, z: p.z + Math.cos(p.yaw) * 0.12, yaw: p.yaw };
}

/** this client's ride: chair index (-1 on foot) and direction (1 up, -1 down) */
export const ride = { chair: -1, dir: 0, t: 0 };
export const riding = () => ride.chair >= 0;
export function resetRide() {
  ride.chair = -1;
  ride.dir = 0;
  ride.t = 0;
}

/**
 * One frame for the local player. Returns true while seated (the camera has been placed on
 * the chair; skip walking). Boarding: stand on a terminal's loading line as a chair comes
 * round the bullwheel. Dismounting at the far end puts you on that terminal's platform.
 */
export function stepRide(
  cam: { position: { x: number; y: number; z: number; set: (x: number, y: number, z: number) => unknown } },
  a: AlpineData,
  delta: number,
  look: { yaw: number; pitch: number },
): boolean {
  const lift = a.lift;
  const p = pathOf(lift);
  const n = chairCount(lift);
  if (ride.chair < 0) {
    const [ux, uz] = a.ride.boardUp;
    const [dx, dz] = a.ride.boardDown;
    const du = Math.hypot(cam.position.x - ux, cam.position.z - uz);
    const dd = Math.hypot(cam.position.x - dx, cam.position.z - dz);
    if (du > 2.2 && dd > 2.2) return false;
    for (let i = 0; i < n; i++) {
      const s = chairS(lift, i);
      const c = p.at(s);
      if (Math.hypot(c.x - cam.position.x, c.z - cam.position.z) > 1.6) continue;
      // only a chair heading away from this terminal: up from the base, down from the top
      if (du <= 2.2 && s < 8) {
        ride.chair = i;
        ride.dir = 1;
        break;
      }
      if (dd <= 2.2 && s > p.run + p.bull && s < p.run + p.bull + 8) {
        ride.chair = i;
        ride.dir = -1;
        break;
      }
    }
    if (ride.chair < 0) return false;
    ride.t = 0;
  }
  ride.t += delta;
  const s = chairS(lift, ride.chair);
  const arriving =
    (ride.dir === 1 && s > p.run - 3 && s < p.run + p.bull) ||
    (ride.dir === -1 && s > p.run * 2 + p.bull - 4);
  if (arriving && ride.t > 2) {
    const [ox, oz, oyaw] = ride.dir === 1 ? a.ride.offTop : a.ride.offBase;
    cam.position.x = ox;
    cam.position.z = oz;
    look.yaw = oyaw;
    resetRide();
    return false;
  }
  const e = riderEye(lift, ride.chair);
  // a gentle sway on the hanger
  const sway = Math.sin(alpine.t * 1.3 + ride.chair) * 0.05;
  cam.position.set(e.x + Math.cos(e.yaw) * sway, e.y + Math.abs(sway) * 0.2, e.z - Math.sin(e.yaw) * sway);
  return true;
}
