import { SEA } from "../beach/beachLayout";
export type MarineKind = "boat" | "jet" | "surf";
export type MarinePose = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  roll: number;
  speed: number;
};
export const MARINE_COUNTS = { boat: 4, jet: 6, surf: 10 };
/** Routes stay clear of the pier and its supports; all clients sample the shared traffic clock. */
export function marinePose(kind: MarineKind, i: number, time: number, out: MarinePose) {
  const side = i % 2 ? 1 : -1,
    phase = time * (kind === "boat" ? 0.055 : kind === "jet" ? 0.12 : 0.085) + i * 2.399;
  const cx = kind === "boat" ? -235 : kind === "jet" ? -175 : -101;
  const rx = kind === "boat" ? 25 : kind === "jet" ? 23 : 8;
  const rz = kind === "boat" ? 50 : kind === "jet" ? 43 : 24;
  const cz =
    side * (kind === "boat" ? 190 : kind === "jet" ? 170 : 150) +
    ((Math.floor(i / 2) % 3) - 1) * 12;
  out.x = cx + Math.cos(phase) * rx;
  out.z = cz + Math.sin(phase) * rz;
  out.y = SEA + 0.1 + Math.sin(time * 1.7 + i) * 0.12;
  out.yaw = Math.atan2(-Math.sin(phase) * rx, Math.cos(phase) * rz);
  out.roll = Math.sin(phase) * (kind === "surf" ? 0.16 : 0.055);
  out.speed = kind === "boat" ? 3 : kind === "jet" ? 6 : 2;
  return out;
}
