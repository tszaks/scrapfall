// The accuracy model, in one place: every gun has a hip cone and an aimed cone, and
// the live cone is hip→ads lerped by the aim blend plus a movement penalty (grown by
// speed, sprint and air time, eased back down by aiming) plus sustained-fire bloom
// that recovers once the trigger is released. Cones are half-angles in radians —
// the same `spread` number aimDir has always taken. Co-op stays deterministic: the
// effective spread is sent inside the fire message, so viewers replay the identical
// pellets instead of re-deriving a formula.
import { aimState } from "./input/aim";
import type { GunId } from "./art/guns";

export { aimState };

export type AccSpec = {
  /** half-cone (rad), standing still, hip fire */
  hip: number;
  /** half-cone (rad), standing still, fully aimed — the first aimed shot's error */
  ads: number;
  /** extra cone (rad) at full movement tilt (sprint pace or airborne) */
  move: number;
  /** cone added per shot */
  bloom: number;
  /** bloom cap (rad) */
  bloomMax: number;
  /** bloom decay (rad/s) once the trigger is released */
  recover: number;
  /** multi-pellet guns: the fan's aimed width multiplier (ADS tightens the pattern) */
  fanAds?: number;
};

export const ACC: Record<GunId, AccSpec> = {
  // sidearms: a modest hip/ads gap (spec: less of a gap for pistols)
  pistol: { hip: 0.014, ads: 0.005, move: 0.01, bloom: 0.004, bloomMax: 0.03, recover: 0.12 },
  revolver: { hip: 0.013, ads: 0.004, move: 0.01, bloom: 0.011, bloomMax: 0.04, recover: 0.2 },
  // automatics: hip ≈ 3-4× the aimed cone
  smg: { hip: 0.026, ads: 0.007, move: 0.014, bloom: 0.0035, bloomMax: 0.045, recover: 0.16 },
  minigun: { hip: 0.035, ads: 0.014, move: 0.015, bloom: 0.003, bloomMax: 0.05, recover: 0.12 },
  cryo: { hip: 0.024, ads: 0.008, move: 0.013, bloom: 0.005, bloomMax: 0.045, recover: 0.15 },
  tesla: { hip: 0.022, ads: 0.005, move: 0.012, bloom: 0.007, bloomMax: 0.045, recover: 0.16 },
  // precision singles: tight aimed cone, wide hip
  rail: { hip: 0.018, ads: 0.002, move: 0.012, bloom: 0.012, bloomMax: 0.04, recover: 0.2 },
  harpoon: { hip: 0.02, ads: 0.003, move: 0.012, bloom: 0.01, bloomMax: 0.04, recover: 0.2 },
  crossbow: { hip: 0.02, ads: 0.002, move: 0.012, bloom: 0.012, bloomMax: 0.04, recover: 0.2 },
  sniper: { hip: 0.05, ads: 0, move: 0.02, bloom: 0.02, bloomMax: 0.06, recover: 0.3 },
  // launchers: coarse both ways, a bit tighter aimed
  cannon: { hip: 0.03, ads: 0.011, move: 0.016, bloom: 0.02, bloomMax: 0.06, recover: 0.2 },
  flak: { hip: 0.03, ads: 0.011, move: 0.016, bloom: 0.018, bloomMax: 0.06, recover: 0.2 },
  rebound: { hip: 0.028, ads: 0.01, move: 0.015, bloom: 0.012, bloomMax: 0.05, recover: 0.18 },
  voidorb: { hip: 0.028, ads: 0.01, move: 0.015, bloom: 0.015, bloomMax: 0.05, recover: 0.18 },
  // pellet fans: `hip/ads` is the fuzz around the pattern, `fanAds` tightens the fan
  scatter: {
    hip: 0.02,
    ads: 0.008,
    move: 0.012,
    bloom: 0.008,
    bloomMax: 0.04,
    recover: 0.2,
    fanAds: 0.75,
  },
  plasma: {
    hip: 0.016,
    ads: 0.006,
    move: 0.012,
    bloom: 0.007,
    bloomMax: 0.045,
    recover: 0.18,
    fanAds: 0.7,
  },
  shatter: {
    hip: 0.02,
    ads: 0.008,
    move: 0.015,
    bloom: 0.014,
    bloomMax: 0.055,
    recover: 0.2,
    fanAds: 0.75,
  },
};

export const accState = {
  /** sustained-fire bloom (rad), current weapon */
  bloom: 0,
  /** eased 0..1 movement intensity (walk → sprint → airborne) */
  move: 0,
  /** the displayed cone (rad): what the hipfire crosshair gap shows */
  disp: 0,
  /** the camera fov the display cone was measured under */
  fov: 75,
};

/**
 * Normalised movement intensity for this frame: 0 standing, ~0.55 at walk pace,
 * more sprinting or airborne. `speed` is the player's horizontal speed in m/s.
 */
export function moveFactor(speed: number, sprinting: boolean, airborne: boolean) {
  return Math.min(1, speed / 7 + (sprinting ? 0.35 : 0) + (airborne ? 1 : 0));
}

export function stepAccuracy(dt: number, w: GunId, move: number) {
  const a = ACC[w];
  accState.move += (move - accState.move) * Math.min(1, dt * 9);
  accState.bloom = Math.max(0, accState.bloom - a.recover * dt);
  return accState;
}

/** call once per shot (after reading the cone, so the first shot is clean) */
export function accShot(w: GunId) {
  const a = ACC[w];
  accState.bloom = Math.min(a.bloomMax, accState.bloom + a.bloom);
}

/** weapon change / respawn: drop the borrowed bloom so the first shot is honest */
export function accReset() {
  accState.bloom = 0;
  accState.move = 0;
}

/** the live half-cone (rad) — lerped hip→ads, movement penalty, bloom */
export function shotCone(w: GunId, blend = aimState.blend) {
  const a = ACC[w];
  return (
    a.hip +
    (a.ads - a.hip) * blend +
    a.move * accState.move * (1 - 0.62 * blend) +
    accState.bloom * (1 - 0.45 * blend)
  );
}

/**
 * The `spread` number fed to aimDir for the next trigger pull: the cone for single
 * rounds, or the pellet fan (tightened while aimed) plus the cone for shotguns.
 */
export function effSpread(w: GunId, gun: { count: number; spread: number }) {
  const t = aimState.blend;
  if (gun.count > 1) return gun.spread * (1 - (1 - (ACC[w].fanAds ?? 0.75)) * t) + shotCone(w);
  return shotCone(w);
}

/**
 * What the hipfire crosshair gap should show: the cone for single-round guns, or the
 * outer edge of the pellet fan for multi-pellet ones.
 */
export function spreadGap(w: GunId, gun: { count: number; spread: number }) {
  const t = aimState.blend;
  const cone = shotCone(w);
  if (gun.count <= 1) return cone;
  return cone + ((gun.count - 1) / 2) * gun.spread * (1 - (1 - (ACC[w].fanAds ?? 0.75)) * t);
}
