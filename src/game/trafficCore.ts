// Traffic signal timing, shared by the rendered traffic lights and the cars.
// Pure function of time so every consumer agrees without passing state around.

export const SIGNAL_CYCLE = 20;
export const GREEN = 0;
export const YELLOW = 1;
export const RED = 2;

/**
 * State of the light facing traffic that travels along `axis` (0 = along x, 1 = along z)
 * at intersection `node`. Each axis gets 7s green, 2s yellow, then 1s all-red clearance.
 */
export function signal(node: number, t: number, axis: 0 | 1): 0 | 1 | 2 {
  const p = (((t + node * 3.7) % SIGNAL_CYCLE) + SIGNAL_CYCLE) % SIGNAL_CYCLE;
  const local = axis === 0 ? p : (p + SIGNAL_CYCLE / 2) % SIGNAL_CYCLE;
  return local < 7 ? GREEN : local < 9 ? YELLOW : RED;
}

/** Seconds until the light facing `axis` at `node` turns red (0 if it already is). */
export function untilRed(node: number, t: number, axis: 0 | 1) {
  const p = (((t + node * 3.7) % SIGNAL_CYCLE) + SIGNAL_CYCLE) % SIGNAL_CYCLE;
  const local = axis === 0 ? p : (p + SIGNAL_CYCLE / 2) % SIGNAL_CYCLE;
  return Math.max(0, 9 - local);
}

/**
 * Shared traffic time. The host (or solo player) advances it; guests follow the host's
 * value from snapshots, so traffic lights show the same phase on every screen.
 */
export const trafficClock = { t: 0 };

/** Moving cars publish their boxes here each frame so bullets can stop on them. */
export type CarBox = {
  driveId?: string;
  x: number;
  z: number;
  sin: number;
  cos: number;
  hl: number;
  hw: number;
  h: number;
  base?: number;
  /** Rendered shape narrow phase; the box is only a cheap candidate filter. */
  bounds?: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
  rayContact?: (
    a: { x: number; y: number; z: number },
    b: { x: number; y: number; z: number },
  ) => number | undefined;
  contact?: (x: number, y: number, z: number) => boolean;
};
export const liveCars: CarBox[] = [];
/**
 * Pursuit cars this frame, for the minimap (kind 1 = cruiser with its siren on,
 * 2 = the suspect). Filled by the traffic renderer on host and guests alike.
 */
export const pursuitDots: { x: number; z: number; kind: 1 | 2; i: number }[] = [];

export function hitsTraffic(x: number, y: number, z: number) {
  for (const c of liveCars) {
    if (c.bounds) {
      const { min, max } = c.bounds;
      if (
        x >= min.x - 0.05 &&
        x <= max.x + 0.05 &&
        y >= min.y - 0.05 &&
        y <= max.y + 0.05 &&
        z >= min.z - 0.05 &&
        z <= max.z + 0.05 &&
        c.contact?.(x, y, z)
      )
        return true;
      continue;
    }
    const pad = c.contact ? 0.5 : 0;
    if (y > c.h + pad || y < (c.base ?? 0) - pad) continue;
    const dx = x - c.x;
    const dz = z - c.z;
    const along = dx * c.sin + dz * c.cos;
    const lat = dx * c.cos - dz * c.sin;
    if (
      Math.abs(along) < c.hl + pad &&
      Math.abs(lat) < c.hw + pad &&
      (!c.contact || c.contact(x, y, z))
    )
      return true;
  }
  return false;
}

/** Earliest swept contact with a moving rendered model. */
export function trafficRayContact(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
) {
  let first = Infinity;
  for (const c of liveCars) {
    if (!c.rayContact) continue;
    const bounds = c.bounds;
    if (
      bounds &&
      (Math.max(a.x, b.x) < bounds.min.x ||
        Math.min(a.x, b.x) > bounds.max.x ||
        Math.max(a.y, b.y) < bounds.min.y ||
        Math.min(a.y, b.y) > bounds.max.y ||
        Math.max(a.z, b.z) < bounds.min.z ||
        Math.min(a.z, b.z) > bounds.max.z)
    )
      continue;
    const t = c.rayContact(a, b);
    if (t !== undefined) first = Math.min(first, t);
  }
  return Number.isFinite(first) ? first : undefined;
}
/** What the traffic sim needs from the game world (filled in by World every frame). */
export type TrafficLink = {
  /** hits only count while actually playing */
  active: boolean;
  px: number;
  pz: number;
  py?: number;
  /** Explicit body pose: camera height changes when downed or riding. */
  feet?: number;
  bodyHeight?: number;
  isHost: boolean;
  /** solo and host simulate traffic; guests only follow the host's snapshots */
  role: "solo" | "host" | "guest";
  /** other players (host only) the cars must also brake for */
  others: { x: number; z: number; y?: number }[];
  /** host: compact car state for the snapshot (set by the traffic component) */
  encode: (() => number[]) | null;
  /** guest: apply car state from a host snapshot (set by the traffic component) */
  decode: ((a: number[]) => void) | null;
  /** knock the local player: velocity (kx, kz), light damage, camera shake strength 0..1 */
  hitPlayer: (dmg: number, kx: number, kz: number, shake: number) => void;
  enemies: { x: number; z: number; alive: boolean; kind: string; elite?: number }[];
  /** real body radius of an enemy (elites are drawn 1.6x bigger) */
  radiusOf: (e: { kind: string; elite?: number }) => number;
  /** big enemies stop cars instead of being thrown around */
  isBig: (e: { kind: string; elite?: number }) => boolean;
  hurtEnemy: ((idx: number, dmg: number, kx: number, kz: number) => void) | null;
};

/**
 * Deepest penetration of a standing capsule into any liveCar's box; 0 when clear.
 * The published oriented box decides — the rendered-mesh `contact` narrow phase
 * is for bullets: it only reports surface hits, so a body inside the hollow
 * shell or standing in rim air (wheel wells, bumper gaps) reads "free" and the
 * old walk-through comes straight back. A car's box IS its body for movement.
 */
export function trafficDepth(
  x: number,
  z: number,
  r: number,
  feet: number,
  height: number,
): number {
  let worst = 0;
  for (const c of liveCars) worst = Math.max(worst, carDepth(c, x, z, r, feet, height));
  return worst;
}
function carDepth(c: CarBox, x: number, z: number, r: number, feet: number, height: number) {
  const base = c.base ?? 0;
  if (feet >= c.h || feet + height <= base) return 0;
  const dx = x - c.x,
    dz = z - c.z;
  // Rotation can project a corner beyond the unrotated half-length.
  const extentX = Math.abs(c.sin) * c.hl + Math.abs(c.cos) * c.hw;
  const extentZ = Math.abs(c.cos) * c.hl + Math.abs(c.sin) * c.hw;
  if (Math.abs(dx) > extentX + r || Math.abs(dz) > extentZ + r) return 0;
  const along = dx * c.sin + dz * c.cos;
  const lat = dx * c.cos - dz * c.sin;
  const inL = c.hl - Math.abs(along),
    inW = c.hw - Math.abs(lat);
  let d: number;
  if (inL >= 0 && inW >= 0) d = r + Math.min(inL, inW);
  else {
    const gap = Math.hypot(Math.max(-inL, 0), Math.max(-inW, 0));
    if (gap >= r) return 0;
    d = r - gap;
  }
  const b = c.bounds;
  if (
    b &&
    (x + r <= b.min.x ||
      x - r >= b.max.x ||
      z + r <= b.min.z ||
      z - r >= b.max.z ||
      feet >= b.max.y ||
      feet + height <= b.min.y)
  )
    return 0;
  return d;
}

/** A car arriving around a player must let them walk out, never trap them inside.
 * Sweep long movement too, so frame hitches cannot skip a stopped car. */
export function trafficStepFree(
  fromX: number,
  fromZ: number,
  x: number,
  z: number,
  radius: number,
  feet: number,
  height = 1.8,
) {
  const dx = x - fromX,
    dz = z - fromZ;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / Math.min(0.2, radius * 0.5)));
  for (const car of liveCars) {
    let depth = carDepth(car, fromX, fromZ, radius, feet, height);
    for (let i = 1; i <= steps; i++) {
      const next = carDepth(
        car,
        fromX + (dx * i) / steps,
        fromZ + (dz * i) / steps,
        radius,
        feet,
        height,
      );
      // Existing overlaps may slide tangentially along a hull toward an open end.
      // Check each hull separately: escape from one cannot enter another.
      if (depth > 0 ? next > depth + 1e-8 : next > 0) return false;
      depth = next;
    }
  }
  return true;
}
