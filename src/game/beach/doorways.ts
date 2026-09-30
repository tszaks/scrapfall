import type { BBld, Rect } from "./beachLayout";

/** Reserve the storefront before room selection, so later doors inherit a clear approach. */
export function beachDoorApproach(b: Pick<BBld, keyof Rect | "front">): Rect {
  const alongX = b.front === 0 || b.front === 2;
  const cx = (b.x0 + b.x1) / 2,
    cz = (b.z0 + b.z1) / 2;
  const half = Math.min(2.4, (alongX ? b.x1 - b.x0 : b.z1 - b.z0) * 0.18) + 0.55;
  if (b.front === 0) return { x0: cx - half, x1: cx + half, z0: b.z0 - 4.5, z1: b.z0 + 0.5 };
  if (b.front === 1) return { x0: b.x1 - 0.5, x1: b.x1 + 4.5, z0: cz - half, z1: cz + half };
  if (b.front === 2) return { x0: cx - half, x1: cx + half, z0: b.z1 - 0.5, z1: b.z1 + 4.5 };
  return { x0: b.x0 - 4.5, x1: b.x0 + 0.5, z0: cz - half, z1: cz + half };
}

/** The canopy extends beyond the counter; reserve its visible footprint as well. */
export function beachStallBounds(b: Rect): Rect {
  const dx = (b.x1 - b.x0) * 0.1,
    dz = (b.z1 - b.z0) * 0.15;
  return { x0: b.x0 - dx, x1: b.x1 + dx, z0: b.z0 - dz, z1: b.z1 + dz };
}

// Both the float placement and rope mesh read this spacing; their joins cannot drift apart.
export const SWIM_LINE_SPACING = 4;
export function swimLineBuoys(half: number): number[] {
  const points: number[] = [];
  for (let z = -half + 8; z <= half - 8; z += SWIM_LINE_SPACING)
    if (Math.abs(z) >= 36) points.push(z);
  return points;
}
