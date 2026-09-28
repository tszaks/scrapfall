// A finite run resource. A replacement is useful only after the carried kit is spent.
export const SELF_REVIVE_COST = 12;
export const SELF_REVIVE_SECONDS = 3;
export const SELF_BLEED_SECONDS = 20;
export type KitDrop = { x: number; y: number; z: number };
export type SoloReviveState = {
  kit: number;
  bleed: number;
  progress: number;
  down: boolean;
  expired: boolean;
  grace: number;
  drop: KitDrop | null;
  finds: number;
  lastFindWave: number;
};
const fresh = (): SoloReviveState => ({
  kit: 1,
  bleed: SELF_BLEED_SECONDS,
  progress: 0,
  down: false,
  expired: false,
  grace: 0,
  drop: null,
  finds: 0,
  lastFindWave: 0,
});
export let soloRevive = fresh();
let version = 0;
const listeners = new Set<() => void>();
export const subscribeSoloRevive = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export const soloReviveVersion = () => version;
export function notifySoloRevive() {
  version++;
  listeners.forEach((fn) => fn());
}
export function resetSoloRevive() {
  soloRevive = fresh();
  notifySoloRevive();
}
export function replaceSoloKit() {
  if (soloRevive.kit || soloRevive.down || soloRevive.expired) return false;
  soloRevive.kit = 1;
  notifySoloRevive();
  return true;
}
/** Deterministic given the random draw; capped at two finds, at least three waves apart. */
export function rollSoloKit(wave: number, draw: number, at: KitDrop) {
  const s = soloRevive;
  if (
    s.kit ||
    s.drop ||
    s.down ||
    s.expired ||
    s.finds >= 2 ||
    wave < 3 ||
    wave - s.lastFindWave < 3 ||
    draw >= 0.006
  )
    return false;
  s.drop = { ...at };
  s.finds++;
  s.lastFindWave = wave;
  notifySoloRevive();
  return true;
}
export function takeSoloKit() {
  if (!soloRevive.drop || !replaceSoloKit()) return false;
  soloRevive.drop = null;
  notifySoloRevive();
  return true;
}
/** Called only while the match is running. Pausing freezes both timers. */
export function stepSoloRevive(
  dt: number,
  hp: number,
  holding: boolean,
): "revived" | "expired" | null {
  const s = soloRevive;
  s.grace = Math.max(0, s.grace - dt);
  if (hp > 0) {
    s.down = false;
    s.progress = 0;
    return null;
  }
  if (s.expired || !s.kit) return null;
  if (!s.down) {
    s.down = true;
    s.bleed = SELF_BLEED_SECONDS;
    s.progress = 0;
  }
  s.bleed = Math.max(0, s.bleed - dt);
  s.progress = holding ? s.progress + dt : 0;
  if (s.progress >= SELF_REVIVE_SECONDS && s.bleed > 0) {
    s.kit = 0;
    s.down = false;
    s.progress = 0;
    s.grace = 3;
    notifySoloRevive();
    return "revived";
  }
  if (s.bleed <= 0) {
    s.expired = true;
    s.down = false;
    s.progress = 0;
    notifySoloRevive();
    return "expired";
  }
  return null;
}
