import type { BeachLayout } from "../beach/beachLayout";
import { roomPlan, type Structure } from "./plan";

export function beachRooms(city: BeachLayout, limit: number): Structure[] {
  const list: Structure[] = [];
  const candidates = city.beach.buildings
    .filter(
      (b) =>
        !b.backdrop &&
        ["arcade", "shop", "surf", "cafe"].includes(b.t) &&
        Math.max(Math.abs(b.x0), Math.abs(b.x1), Math.abs(b.z0), Math.abs(b.z1)) < limit - 12 &&
        Math.min(b.x1 - b.x0, b.z1 - b.z0) >= 10 &&
        b.h >= 5.5 &&
        b.floors <= 4,
    )
    .sort(
      (a, b) =>
        Number(b.t === "arcade") - Number(a.t === "arcade") || Math.abs(a.z0) - Math.abs(b.z0),
    );
  for (const b of candidates.slice(0, 7)) {
    const p = roomPlan(
      `pier-${b.t}-${b.x0}-${b.z0}`,
      b,
      b.y0,
      b.h,
      b.front,
      b.t === "arcade" ? "arcade" : b.t === "cafe" ? "cafe" : "shop",
      Math.max(1, Math.min(b.floors, Math.floor(b.h / 2.7))),
    );
    b.interior = p;
    list.push(p);
  }
  return list;
}

export function alpineRooms(
  city: import("../alpine/layout").AlpineLayout,
  limit: number,
  occupied: { spec: { footprint: import("./plan").Rect } }[],
): Structure[] {
  const out: Structure[] = [];
  const buildings = city.alpine.buildings
    .filter(
      (b) =>
        ["chalet", "cafe", "lodge"].includes(b.t) &&
        Math.max(Math.abs(b.x0), Math.abs(b.x1), Math.abs(b.z0), Math.abs(b.z1)) < limit - 12 &&
        Math.min(b.x1 - b.x0, b.z1 - b.z0) >= 8 &&
        !occupied.some(
          (a) =>
            a.spec.footprint.x0 < b.x1 &&
            a.spec.footprint.x1 > b.x0 &&
            a.spec.footprint.z0 < b.z1 &&
            a.spec.footprint.z1 > b.z0,
        ),
    )
    .sort(
      (a, b) =>
        Number(a.t === "chalet") - Number(b.t === "chalet") ||
        Math.hypot(a.x0, a.z0) - Math.hypot(b.x0, b.z0),
    );
  const chosen = [
    ...buildings.filter((b) => b.t === "cafe").slice(0, 2),
    ...buildings.filter((b) => b.t === "lodge").slice(0, 2),
    ...buildings.filter((b) => b.t === "chalet").slice(0, 3),
  ];
  for (const b of chosen) {
    const p = roomPlan(
      `alpine-${b.t}-${b.x0}-${b.z0}`,
      b,
      b.y,
      2.8,
      b.front,
      b.t as "chalet" | "cafe" | "lodge",
      1,
    );
    b.interior = p;
    out.push(p);
  }
  return out;
}
