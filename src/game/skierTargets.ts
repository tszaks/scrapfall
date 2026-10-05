import { simulationNow } from "./simulationPause";
/** Sporting NPC targets share stable indices; only the host decides a hit. */
export const skierTargets: {
  x: number;
  y: number;
  z: number;
  active: boolean;
  downUntil: number;
}[] = [];
export function hitSkier(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  limit = 1,
) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    dz = b.z - a.z,
    len = dx * dx + dy * dy + dz * dz;
  if (len < 1e-9) return -1;
  let best = limit,
    index = -1;
  for (let i = 0; i < skierTargets.length; i++) {
    const s = skierTargets[i]!;
    if (!s.active || s.downUntil > simulationNow()) continue;
    const t = Math.max(
      0,
      Math.min(limit, ((s.x - a.x) * dx + (s.y + 0.9 - a.y) * dy + (s.z - a.z) * dz) / len),
    );
    if (t > best) continue;
    const x = a.x + dx * t,
      y = a.y + dy * t,
      z = a.z + dz * t;
    if (Math.hypot(x - s.x, z - s.z) < 0.65 && y > s.y && y < s.y + 1.8) {
      best = t;
      index = i;
    }
  }
  return index;
}
export function downSkier(i: number) {
  const s = skierTargets[i];
  if (s) s.downUntil = simulationNow() + 20000;
}
export function encodeSkiers() {
  return skierTargets.map((s) => Math.max(0, s.downUntil - simulationNow()));
}
export function decodeSkiers(a: number[]) {
  a.forEach((t, i) => {
    const s = skierTargets[i];
    if (s && Number.isFinite(t)) s.downUntil = simulationNow() + Math.max(0, Math.min(20000, t));
  });
}
