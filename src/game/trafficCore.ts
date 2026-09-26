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

/**
 * Shared traffic time. The host (or solo player) advances it; guests follow the host's
 * value from snapshots, so traffic lights show the same phase on every screen.
 */
export const trafficClock = { t: 0 };

/** Moving cars publish their boxes here each frame so bullets can stop on them. */
export type CarBox = {
  x: number;
  z: number;
  sin: number;
  cos: number;
  hl: number;
  hw: number;
  h: number;
};
export const liveCars: CarBox[] = [];

export function hitsTraffic(x: number, y: number, z: number) {
  for (const c of liveCars) {
    if (y > c.h) continue;
    const dx = x - c.x;
    const dz = z - c.z;
    const along = dx * c.sin + dz * c.cos;
    const lat = dx * c.cos - dz * c.sin;
    if (Math.abs(along) < c.hl && Math.abs(lat) < c.hw) return true;
  }
  return false;
}

/** What the traffic sim needs from the game world (filled in by World every frame). */
export type TrafficLink = {
  /** hits only count while actually playing */
  active: boolean;
  px: number;
  pz: number;
  isHost: boolean;
  /** solo and host simulate traffic; guests only follow the host's snapshots */
  role: "solo" | "host" | "guest";
  /** other players (host only) the cars must also brake for */
  others: { x: number; z: number }[];
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
