// Physical rooms and stacked floors. Rendering, feet, cameras and shots consume this plan.
// Ground floors remain part of street combat; upper galleries are player-only lookouts.
export type Rect = { x0: number; x1: number; z0: number; z1: number };
export type Volume = Rect & {
  y0: number;
  y1: number;
  color: string;
  glass?: boolean;
  glow?: boolean;
};
export type Surface = Rect & { y: number; holes: Rect[]; level: number };
export type Flight = Rect & {
  axis: "x" | "z";
  reverse: boolean;
  y0: number;
  y1: number;
  level: number;
};
export type Structure = {
  id: string;
  bounds: Rect;
  base: number;
  top: number;
  floors: Surface[];
  stairs: Flight[];
  solids: Volume[];
  decor: Volume[];
  doors: { x: number; z: number; facing: 0 | 1 | 2 | 3 }[];
  kind: "arcade" | "shop" | "cafe" | "chalet" | "lodge" | "hotel" | "landmark" | "garage" | "frame";
};
export const contains = (r: Rect, x: number, z: number, margin = 0) =>
  x >= r.x0 - margin && x <= r.x1 + margin && z >= r.z0 - margin && z <= r.z1 + margin;
export const flightY = (s: Flight, x: number, z: number) => {
  let t = s.axis === "x" ? (x - s.x0) / (s.x1 - s.x0) : (z - s.z0) / (s.z1 - s.z0);
  t = Math.max(0, Math.min(1, t));
  return s.y0 + (s.y1 - s.y0) * (s.reverse ? 1 - t : t);
};
export function box(
  p: Structure,
  r: Rect,
  y0: number,
  y1: number,
  color: string,
  solid = true,
  glow = false,
) {
  const v: Volume = { ...r, y0, y1, color, ...(glow ? { glow: true } : {}) };
  (solid ? p.solids : p.decor).push(v);
  return v;
}
/** A slab split around a rectangular stair opening. No invisible floor over the flight. */
export function slab(p: Structure, r: Rect, y: number, level: number, hole?: Rect) {
  p.floors.push({ ...r, y, level, holes: hole ? [hole] : [] });
  const pieces = hole
    ? [
        { ...r, x1: hole.x0 },
        { ...r, x0: hole.x1 },
        { x0: hole.x0, x1: hole.x1, z0: r.z0, z1: hole.z0 },
        { x0: hole.x0, x1: hole.x1, z0: hole.z1, z1: r.z1 },
      ]
    : [r];
  for (const q of pieces)
    if (q.x1 > q.x0 + 0.001 && q.z1 > q.z0 + 0.001)
      box(p, q, y - 0.18, y, level ? "#bdad92" : "#b3a58e");
}
/** Front-facing local coordinates: u left-to-right; v inward. */
export function roomPlan(
  id: string,
  bounds: Rect,
  base: number,
  height: number,
  front: number,
  kind: Structure["kind"],
  levels = 2,
  grand = false,
): Structure {
  const p: Structure = {
    id,
    bounds,
    base,
    top: base + height,
    kind,
    floors: [],
    stairs: [],
    solids: [],
    decor: [],
    doors: [],
  };
  const alongX = front === 0 || front === 2;
  const w = alongX ? bounds.x1 - bounds.x0 : bounds.z1 - bounds.z0;
  const d = alongX ? bounds.z1 - bounds.z0 : bounds.x1 - bounds.x0;
  const point = (u: number, v: number) =>
    front === 0
      ? [bounds.x0 + u, bounds.z0 + v]
      : front === 1
        ? [bounds.x1 - v, bounds.z0 + u]
        : front === 2
          ? [bounds.x1 - u, bounds.z1 - v]
          : [bounds.x0 + v, bounds.z1 - u];
  const rect = (u0: number, v0: number, u1: number, v1: number): Rect => {
    const a = point(u0, v0),
      b = point(u1, v1);
    return {
      x0: Math.min(a[0]!, b[0]!),
      x1: Math.max(a[0]!, b[0]!),
      z0: Math.min(a[1]!, b[1]!),
      z1: Math.max(a[1]!, b[1]!),
    };
  };
  const B = (
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    y0: number,
    y1: number,
    c: string,
    solid = true,
    glow = false,
  ) => box(p, rect(u0, v0, u1, v1), base + y0, base + y1, c, solid, glow);
  const timber = kind === "chalet" || kind === "lodge" || kind === "hotel";
  const wall = timber ? "#ac8060" : "#e3d5be";
  const floorH = height / Math.max(1, levels),
    doorHalf = Math.min(2.4, w * 0.18);
  const door = point(w / 2, 0);
  p.doors.push({ x: door[0]!, z: door[1]!, facing: front as 0 | 1 | 2 | 3 });
  // Wide real storefront openings with transparent display windows on either side.
  for (let f = 0; f < levels; f++) {
    const y = f * floorH;
    B(0, d - 0.22, w, d, y, y + floorH, wall);
    B(0, 0.22, 0.22, d - 0.22, y, y + floorH, wall);
    B(w - 0.22, 0.22, w, d - 0.22, y, y + floorH, wall);
    const spans =
      f === 0
        ? [
            [0, w / 2 - doorHalf],
            [w / 2 + doorHalf, w],
          ]
        : [[0, w]];
    for (const [a, b] of spans) {
      const len = b! - a!,
        n = Math.max(1, Math.floor(len / 4));
      for (let j = 0; j < n; j++) {
        const x0 = a! + (j * len) / n,
          x1 = a! + ((j + 1) * len) / n;
        B(x0, 0, x0 + 0.22, 0.22, y, y + floorH, wall);
        B(x1 - 0.22, 0, x1, 0.22, y, y + floorH, wall);
        B(x0 + 0.22, 0, x1 - 0.22, 0.22, y, y + 0.72, wall);
        B(x0 + 0.22, 0, x1 - 0.22, 0.22, y + floorH - 0.45, y + floorH, wall);
        const glass = B(x0 + 0.22, 0.07, x1 - 0.22, 0.12, y + 0.72, y + floorH - 0.45, "#b1d0d4");
        glass.glass = true;
      }
    }
    if (f === 0) B(w / 2 - doorHalf, 0, w / 2 + doorHalf, 0.22, 2.75, floorH, wall);
  }
  slab(p, bounds, base, 0);
  // Straight interior flights at alternating sides. Upper landings lead into real rooms.
  for (let f = 1; f < levels; f++) {
    if (grand && f === 1) {
      // A broad lower flight divides at a half-height landing into two return flights.
      // The gallery has a real central void: from the street one sees the entire staircase.
      const mid = w / 2,
        half = floorH / 2;
      const flight = (
        u0: number,
        v0: number,
        u1: number,
        v1: number,
        width: number,
        y0: number,
        y1: number,
      ) => {
        const side = Math.abs(u1 - u0) > 0.01,
          a = point(u0, v0),
          b = point(u1, v1);
        const q = side
          ? rect(Math.min(u0, u1), v0 - width / 2, Math.max(u0, u1), v0 + width / 2)
          : rect(u0 - width / 2, Math.min(v0, v1), u0 + width / 2, Math.max(v0, v1));
        const axis: Flight["axis"] = Math.abs(a[0]! - b[0]!) > 0.01 ? "x" : "z";
        p.stairs.push({
          ...q,
          axis,
          reverse: axis === "x" ? b[0]! < a[0]! : b[1]! < a[1]!,
          y0: base + y0,
          y1: base + y1,
          level: 1,
        });
        // Brass handrails follow the actual rise; vertical posts leave a clear walking width.
        const n = Math.ceil(Math.hypot(u1 - u0, v1 - v0) / 0.55);
        for (let j = 0; j < n; j++)
          for (const sign of [-1, 1]) {
            const t = (j + 0.5) / n,
              u = u0 + (u1 - u0) * t + (side ? 0 : sign * (width / 2 + 0.07)),
              v = v0 + (v1 - v0) * t + (side ? sign * (width / 2 + 0.07) : 0),
              y = y0 + (y1 - y0) * t;
            B(u - 0.035, v - 0.035, u + 0.035, v + 0.035, y, y + 1.04, "#9a7548");
            B(
              u - (side ? Math.abs(u1 - u0) / n / 2 : 0.04),
              v - (side ? 0.04 : Math.abs(v1 - v0) / n / 2),
              u + (side ? Math.abs(u1 - u0) / n / 2 : 0.04),
              v + (side ? 0.04 : Math.abs(v1 - v0) / n / 2),
              y + 0.96,
              y + 1.04,
              "#ba975c",
            );
          }
      };
      flight(mid, 2.5, mid, 6.5, 3.4, 0, half);
      slab(p, rect(mid - 1.7, 6.5, mid + 1.7, 9.1), base + half, 1);
      flight(mid - 1.7, 7.8, 1.5, 7.8, 2.6, half, floorH);
      flight(mid + 1.7, 7.8, w - 1.5, 7.8, 2.6, half, floorH);
      slab(p, bounds, base + floorH, 1, rect(1.5, 2.3, w - 1.5, 9.1));
      const rail = (u0: number, v0: number, u1: number, v1: number, y: number) => {
        B(u0 - 0.035, v0 - 0.035, u1 + 0.035, v1 + 0.035, y + 1, y + 1.08, "#ba975c");
        const n = Math.ceil(Math.hypot(u1 - u0, v1 - v0) / 0.7);
        for (let j = 0; j <= n; j++) {
          const u = u0 + ((u1 - u0) * j) / n,
            v = v0 + ((v1 - v0) * j) / n;
          B(u - 0.035, v - 0.035, u + 0.035, v + 0.035, y, y + 1.02, "#9a7548");
        }
      };
      rail(1.5, 2.3, w - 1.5, 2.3, floorH);
      rail(1.5, 9.1, w - 1.5, 9.1, floorH);
      rail(1.5, 2.3, 1.5, 6.35, floorH);
      rail(w - 1.5, 2.3, w - 1.5, 6.35, floorH);
      rail(mid - 1.7, 9.1, mid + 1.7, 9.1, half);
      continue;
    }
    const width = 1.65,
      run = Math.min(d - 4, floorH * 1.9),
      side = f % 2 ? 0.45 : w - 0.45 - width;
    const local = rect(side, 2, side + width, 2 + run);
    const start = point(side + width / 2, 2),
      end = point(side + width / 2, 2 + run);
    const axis: Flight["axis"] = Math.abs(start[0]! - end[0]!) > 1 ? "x" : "z";
    const reverse = axis === "x" ? end[0]! < start[0]! : end[1]! < start[1]!;
    p.stairs.push({
      ...local,
      axis,
      reverse,
      y0: base + (f - 1) * floorH,
      y1: base + f * floorH,
      level: f,
    });
    // The void starts at the foot so the first steps never pass through the slab overhead.
    const hole = rect(side - 0.08, 1.85, side + width + 0.08, 2 + run);
    slab(p, bounds, base + f * floorH, f, hole);
    B(side - 0.08, 1.77, side + width + 0.08, 1.85, f * floorH, f * floorH + 1.08, "#634a3b");
    // Rail between room and stair void; leave the top landing open.
    const railSide = side === 0.45 ? side + width + 0.08 : side - 0.12;
    for (let v = 2; v < 2 + run - 0.2; v += 0.8)
      B(railSide, v, railSide + 0.06, v + 0.06, f * floorH, f * floorH + 1.05, "#634a3b");
    B(railSide, 2, railSide + 0.07, 2 + run - 0.2, f * floorH + 1.0, f * floorH + 1.08, "#634a3b");
  }
  // Opaque ceiling, including its underside; host roofs remain as the exterior cap.
  box(p, bounds, p.top - 0.12, p.top, "#c9bda7");
  const furnitureStart = p.solids.length,
    decorStart = p.decor.length;
  for (let f = 0; f < levels; f++) {
    const y = f * floorH;
    // Interior light strips and panels are emissive baked surfaces, no per-room shadow light.
    B(
      w * 0.35,
      d * 0.25,
      w * 0.65,
      d * 0.25 + 0.12,
      y + floorH - 0.25,
      y + floorH - 0.18,
      "#ffe2a5",
      false,
      true,
    );
    if (kind === "arcade") {
      for (let i = 0; i < Math.min(8, Math.floor((w - 6) / 1.6)); i++) {
        const u = 3 + i * 1.6;
        B(u, d - 1.65, u + 1.05, d - 0.5, y, y + 1.9, i % 2 ? "#30435f" : "#743b55");
        B(
          u + 0.1,
          d - 1.68,
          u + 0.95,
          d - 1.64,
          y + 0.85,
          y + 1.55,
          i % 2 ? "#63ddc4" : "#dba5ed",
          false,
          true,
        );
        B(u + 0.1, d - 1.92, u + 0.95, d - 1.65, y + 0.8, y + 0.91, "#20272d");
      }
      B(w * 0.42, d * 0.48, w * 0.68, d * 0.63, y, y + 0.83, "#82494a");
      B(
        w * 0.42 + 0.08,
        d * 0.48 - 0.02,
        w * 0.68 - 0.08,
        d * 0.63 + 0.02,
        y + 0.83,
        y + 0.88,
        "#f5d68a",
        false,
        true,
      );
    } else if (kind === "shop") {
      for (let v = 3; v < d - 3; v += 2.2) {
        B(w - 1.4, v, w - 0.4, v + 1.6, y, y + 1.9, "#aa7650");
        for (let h = 0.4; h < 1.9; h += 0.5)
          for (let j = 0; j < 3; j++)
            B(
              w - 1.43,
              v + 0.1 + j * 0.5,
              w - 1.39,
              v + 0.45 + j * 0.5,
              y + h,
              y + h + 0.25,
              ["#cb6952", "#628c98", "#dbbf72"][j]!,
              false,
            );
      }
      B(w * 0.45, d - 2, w * 0.75, d - 1.2, y, y + 1, "#ad7855");
    } else {
      for (const u of [w * 0.36, w * 0.65])
        for (const v of [d * 0.35, d * 0.65]) {
          B(u - 0.65, v - 0.55, u + 0.65, v + 0.55, y + 0.7, y + 0.8, "#ab7953");
          B(u - 0.12, v - 0.12, u + 0.12, v + 0.12, y, y + 0.7, "#644b37");
          for (const dz of [-1, 1])
            B(
              u - 0.42,
              v + dz * 0.95 - 0.25,
              u + 0.42,
              v + dz * 0.95 + 0.25,
              y,
              y + 0.48,
              "#775342",
            );
        }
      // A glowing, recessed hearth with solid masonry and a visible fire bed.
      B(w / 2 - 1.5, d - 1.1, w / 2 + 1.5, d - 0.23, y, y + 0.22, "#64584d");
      B(w / 2 - 1.5, d - 1.1, w / 2 - 1.12, d - 0.23, y + 0.22, y + 2.1, "#998573");
      B(w / 2 + 1.12, d - 1.1, w / 2 + 1.5, d - 0.23, y + 0.22, y + 2.1, "#998573");
      B(w / 2 - 1.5, d - 1.1, w / 2 + 1.5, d - 0.23, y + 1.75, y + 2.1, "#998573");
      B(w / 2 - 0.9, d - 0.75, w / 2 + 0.9, d - 0.4, y + 0.22, y + 0.56, "#ff953d", false, true);
    }
  }
  const clearStair = (v: Volume) =>
    !p.floors.some(
      (f) =>
        v.y0 >= f.y - 0.01 &&
        v.y0 < f.y + floorH - 0.3 &&
        f.holes.some((h) => v.x1 > h.x0 && v.x0 < h.x1 && v.z1 > h.z0 && v.z0 < h.z1),
    ) &&
    !p.stairs.some(
      (s) =>
        v.y0 < s.y1 + 1.9 &&
        v.y1 > s.y0 &&
        v.x1 > s.x0 - 0.55 &&
        v.x0 < s.x1 + 0.55 &&
        v.z1 > s.z0 - 0.55 &&
        v.z0 < s.z1 + 0.55,
    );
  const removedFurniture = p.solids.slice(furnitureStart).filter((v) => !clearStair(v));
  p.solids = p.solids
    .slice(0, furnitureStart)
    .concat(p.solids.slice(furnitureStart).filter(clearStair));
  // Screens and merchandise belong to their cabinet, even when their thin front panel
  // sits just outside the stair-clearance box that removed the cabinet itself.
  p.decor = p.decor
    .slice(0, decorStart)
    .concat(
      p.decor
        .slice(decorStart)
        .filter(
          (v) =>
            clearStair(v) &&
            !removedFurniture.some(
              (q) =>
                v.x1 >= q.x0 - 0.12 &&
                v.x0 <= q.x1 + 0.12 &&
                v.z1 >= q.z0 - 0.12 &&
                v.z0 <= q.z1 + 0.12 &&
                v.y1 >= q.y0 - 0.12 &&
                v.y0 <= q.y1 + 0.12,
            ),
        ),
    );

  return p;
}
