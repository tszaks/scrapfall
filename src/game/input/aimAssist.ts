// Light controller aim assist: the look slows down while the crosshair is on or near an
// enemy, and a gentle pull (magnetism) drags it toward them while you are steering. Only the
// controller gets it (never the mouse); strength 0 turns it off.

export type AimTarget = { x: number; y: number; z: number };

const MAX_RANGE = 60;

const wrap = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

/**
 * For a camera at `cam` looking along (yaw, pitch) (three.js YXZ order: yaw 0 looks down -Z,
 * pitch up is positive), find the enemy nearest the crosshair inside its assist cone.
 * `visible` is only asked about the best candidate (a line-of-sight test is not cheap).
 */
export function aimAssist(
  cam: { x: number; y: number; z: number },
  yaw: number,
  pitch: number,
  targets: Iterable<AimTarget>,
  strength: number,
  visible?: (t: AimTarget) => boolean,
): { slow: number; dYaw: number; dPitch: number; on: boolean } {
  const none = { slow: 1, dYaw: 0, dPitch: 0, on: false };
  if (strength <= 0) return none;
  // (targets may reuse one object while iterating: keep a copy of the best)
  const best: AimTarget = { x: 0, y: 0, z: 0 };
  let found = false;
  let bestRatio = 1;
  let by = 0;
  let bp = 0;
  const cp = Math.cos(pitch);
  for (const t of targets) {
    const dx = t.x - cam.x;
    const dy = t.y - cam.y;
    const dz = t.z - cam.z;
    const flat = Math.hypot(dx, dz);
    const dist = Math.hypot(flat, dy);
    if (dist < 1 || dist > MAX_RANGE) continue;
    const ty = wrap(Math.atan2(-dx, -dz) - yaw);
    const tp = Math.atan2(dy, flat) - pitch;
    const ang = Math.hypot(ty * cp, tp);
    // about two body widths either side of the robot, never under ~2.5 degrees
    const cone = Math.max(0.045, Math.atan(1.1 / dist) * 2.2);
    const ratio = ang / cone;
    if (ratio < bestRatio) {
      bestRatio = ratio;
      found = true;
      best.x = t.x;
      best.y = t.y;
      best.z = t.z;
      by = ty;
      bp = tp;
    }
  }
  if (!found || (visible && !visible(best))) return none;
  // slowdown: strongest dead on, fading out at the cone's edge
  const slow = 1 - 0.55 * strength * (1 - bestRatio * 0.6);
  return { slow, dYaw: by, dPitch: bp, on: true };
}
