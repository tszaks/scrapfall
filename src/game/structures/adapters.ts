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
  const hotel = city.alpine.buildings.find(
    (b) =>
      b.t === "hotel" &&
      Math.max(Math.abs(b.x0), Math.abs(b.x1), Math.abs(b.z0), Math.abs(b.z1)) < limit - 12,
  );
  if (hotel && hotel.front === 2 && hotel.x1 - hotel.x0 >= 42) {
    const wing = { x0: hotel.x0, x1: hotel.x0 + 14, z0: hotel.z0, z1: hotel.z1 };
    const p = roomPlan("alpine-grand-west-lobby", wing, hotel.y, 6.4, 2, "hotel", 2, true);
    hotel.grandWing = p;
    out.push(p);
  }
  return out;
}

/** A podium wing beside the existing elevator, leaving its entire approach and roof intact. */
export function cityRooms(city: import("../cityLayout").CityLayout, limit: number): Structure[] {
  const b = city.buildings.find((b) => b.t === "super" && !b.backdrop);
  const podium = b?.parts.find((p) => p.role === "podium");
  if (!b || !podium) return [];
  const cx = (podium.x0 + podium.x1) / 2,
    cz = (podium.z0 + podium.z1) / 2;
  const r = { x0: cx - 30, x1: cx - 12, z0: cz, z1: cz + 30 };
  if (Math.max(Math.abs(r.x0), Math.abs(r.x1), Math.abs(r.z0), Math.abs(r.z1)) >= limit - 4)
    return [];
  const p = roomPlan("vice-grand-west-lobby", r, 0, 8, 2, "landmark", 2, true);
  b.grandWing = p;
  return [p];
}
