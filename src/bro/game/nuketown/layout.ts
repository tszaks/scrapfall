import { box, slab, type Rect, type Structure } from "../structures/plan";
import type { MinimapSource } from "../Minimap";
export const NUKE_SIZE = 96;
export const HOUSE_COLORS = ["#e3bf60", "#68aaa1"] as const;
export const NUKE_SPAWN = { x: 0, z: 39 };
/** These prop dimensions drive both the art and ground-level enemy clearance. */
export const YARD_BOXES: {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  c: string;
}[] = [];
export const YARD_TREES: { x: number; z: number }[] = [];
for (const side of [-1, 1]) {
  const B = (u: number, y: number, v: number, w: number, h: number, d: number, c: string) =>
    YARD_BOXES.push({ x: u * side, y, z: (14 + v) * side, w, h, d, c });
  B(-2.8, 0, -2.5, 0.09, 1, 0.09, "#6d7774");
  B(-2.8, 0.95, -2.5, 0.36, 0.25, 0.55, "#e7e1ce");
  B(5.1, 0, 20, 0.09, 0.77, 0.09, "#82725b");
  B(5.1, 0.77, 20, 2.2, 0.12, 1.35, "#c4b090");
  for (const v of [18.9, 21.1]) B(5.1, 0, v, 1.9, 0.46, 0.45, "#b3a381");
  B(12.1, 0, 17.5, 0.8, 0.9, 0.65, "#5b5b50");
  for (const [u, v] of [
    [-2, 20],
    [11, 13.2],
  ] as const)
    B(u, 0, v, 0.32, 0.13, 0.32, "#d0b596");
  for (const [u, v] of [
    [-18, 20],
    [26, 19],
  ] as const)
    YARD_TREES.push({ x: u * side, z: (14 + v) * side });
}

/** Two opposing test houses, garages, rear gardens, two centre vehicles and side lanes.
 * All openings, floors and stairs below are shared by rendering and physical queries. */
export function nuketownStructures(): Structure[] {
  const plans: Structure[] = [];
  for (const [index, side] of [-1, 1].entries()) {
    const point = (u: number, v: number) => ({ x: u * side, z: (14 + v) * side });
    const rect = (u0: number, v0: number, u1: number, v1: number): Rect => {
      const a = point(u0, v0),
        b = point(u1, v1);
      return {
        x0: Math.min(a.x, b.x),
        x1: Math.max(a.x, b.x),
        z0: Math.min(a.z, b.z),
        z1: Math.max(a.z, b.z),
      };
    };
    const p: Structure = {
      id: `nuketown-house-${index}`,
      kind: "chalet",
      includeStatic: true,
      shelters: [
        { ...rect(-7.5, -0.6, 7.5, 13.6), y: 6.7 },
        { ...rect(7, -0.5, 15.4, 11.5), y: 3.4 },
        { ...rect(-7, 13, 7, 16), y: 3.35 },
      ],
      bounds: rect(-8, -0.4, 15.2, 23.5),
      base: 0,
      top: 8,
      floors: [],
      stairs: [],
      solids: [],
      decor: [],
      doors: [],
      rails: [],
    };
    const wall = HOUSE_COLORS[index]!,
      trim = "#f3e8cc",
      floor = 3.35;
    const B = (
      u0: number,
      v0: number,
      u1: number,
      v1: number,
      y0: number,
      y1: number,
      color: string = wall,
      solid = true,
    ) => box(p, rect(u0, v0, u1, v1), y0, y1, color, solid);
    const door = (u: number, v: number, facing: 0 | 1 | 2 | 3) => {
      const q = point(u, v);
      p.doors.push({ ...q, facing });
    };
    // Front and rear walls with genuine ground-floor doors and open upstairs windows.
    const facade = (v: number, back: boolean) => {
      for (let level = 0; level < 2; level++) {
        const y = level * floor;
        const gaps =
          level === 0
            ? [
                { a: 1, b: 3.6, bottom: y, top: y + 2.7 },
                ...(!back ? [{ a: -5.8, b: -1.5, bottom: y + 0.85, top: y + 2.65 }] : []),
              ]
            : back
              ? [{ a: 1, b: 3.6, bottom: y, top: y + 2.7 }]
              : [
                  { a: -5.4, b: -1.5, bottom: y + 0.8, top: y + 2.65 },
                  { a: 1, b: 4.8, bottom: y + 0.8, top: y + 2.65 },
                ];
        let cursor = -7;
        for (const gap of gaps.sort((a, b) => a.a - b.a)) {
          if (gap.a > cursor) B(cursor, v, gap.a, v + 0.2, y, y + floor);
          if (gap.bottom > y) B(gap.a, v, gap.b, v + 0.2, y, gap.bottom);
          B(gap.a, v, gap.b, v + 0.2, gap.top, y + floor);
          // Frames have depth and sit on the actual aperture edges.
          B(
            gap.a - 0.08,
            v - 0.07,
            gap.a + 0.045,
            v + 0.26,
            gap.bottom,
            gap.top + 0.1,
            trim,
            false,
          );
          B(
            gap.b - 0.045,
            v - 0.07,
            gap.b + 0.08,
            v + 0.26,
            gap.bottom,
            gap.top + 0.1,
            trim,
            false,
          );
          B(gap.a - 0.13, v - 0.1, gap.b + 0.13, v + 0.3, gap.top, gap.top + 0.14, trim, false);
          if (gap.bottom > y) {
            B(
              gap.a - 0.13,
              v - 0.14,
              gap.b + 0.13,
              v + 0.34,
              gap.bottom - 0.06,
              gap.bottom + 0.06,
              trim,
              false,
            );
            // Ground-floor glass is real glass; upstairs firing windows are open.
            if (!level) {
              const g = B(
                gap.a + 0.05,
                v + 0.09,
                gap.b - 0.05,
                v + 0.11,
                gap.bottom + 0.07,
                gap.top - 0.04,
                "#96b4b7",
              );
              g.glass = true;
            }
          }
          cursor = gap.b;
        }
        if (cursor < 7) B(cursor, v, 7, v + 0.2, y, y + floor);
      }
    };
    facade(0, false);
    facade(12.8, true);
    B(-7, 0, -6.8, 13, 0, 6.7);
    B(6.8, 0, 7, 13, 0, 6.7);
    // A wide internal doorway connects the open garage with the kitchen.
    p.solids = p.solids.flatMap((v) => {
      const a = point(6.9, 3.4),
        b = point(6.9, 6.3);
      const sideWall = Math.abs((v.x0 + v.x1) / 2 - a.x) < 0.03 && v.y0 === 0 && v.y1 === 6.7;
      if (!sideWall) return [v];
      const lo = Math.min(a.z, b.z),
        hi = Math.max(a.z, b.z);
      return [
        { ...v, z1: lo },
        { ...v, z0: hi },
        { ...v, z0: lo, z1: hi, y0: 2.7 },
      ];
    });
    slab(p, rect(-7, 0, 7, 13), 0, 0);
    const hole = rect(-6.6, 2.4, -4.7, 9.1);
    slab(p, rect(-7, 0, 7, 13), floor, 1, hole);
    p.stairs.push({
      ...rect(-6.45, 2.6, -4.85, 9.1),
      axis: "z",
      reverse: side < 0,
      y0: 0,
      y1: floor,
      level: 1,
    });
    // Continuous gallery guard; top landing stays open to the bedroom.
    B(-4.67, 2.3, -4.6, 8.95, floor + 0.93, floor + 1.02, "#795d42");
    for (let v = 2.5; v < 9; v += 0.75) B(-4.67, v, -4.6, v + 0.055, floor, floor + 1, "#c2b38e");
    B(-6.6, 2.25, -4.6, 2.33, floor, floor + 1.05, "#c2b38e");
    B(-7, 0, 7, 13, 6.6, 6.72, trim);
    // Garage with two open portals and an actual raised roller door overhead.
    B(14.75, 0, 15, 11, 0, 3.1);
    B(7, 0, 15, 0.2, 2.7, 3.12, trim);
    B(7, 10.8, 15, 11, 2.7, 3.12, trim);
    B(7, 0, 15, 11, 3.12, 3.3, trim);
    slab(p, rect(7, 0, 15, 11), 0, 0);
    for (let j = 0; j < 6; j++)
      B(7.3, 0.05, 14.7, 0.13, 2.73 + j * 0.055, 2.77 + j * 0.055, "#8baba4", false);
    // Back balcony and exterior garden staircase, a second route to the upper room.
    slab(p, rect(-7, 13, 7, 16), floor, 1);
    for (const u of [-6.8, 6.8]) B(u - 0.065, 13, u + 0.065, 16, floor + 0.96, floor + 1.04, trim);
    B(-4.5, 15.9, 7, 16.04, floor + 0.96, floor + 1.04, trim);
    for (let u = -4.4; u < 7; u += 0.72) B(u, 15.91, u + 0.06, 16.02, floor, floor + 1, trim);
    for (const u of [-6.7, 6.7]) B(u - 0.09, 13, u + 0.09, 15.8, 0, 0.2, "#81735f", false);
    // Four posts actually carry the balcony.
    for (const u of [-6.8, 6.8])
      for (const v of [13.4, 15.8]) B(u - 0.08, v - 0.08, u + 0.08, v + 0.08, 0, floor, trim);
    p.stairs.push({
      ...rect(-6.7, 16, -4.9, 23),
      axis: "z",
      reverse: side > 0,
      y0: 0,
      y1: floor,
      level: 1,
    });
    for (const u of [-6.8, -4.8]) {
      const a = point(u, 16),
        b = point(u, 23);
      p.rails!.push({ a: [a.x, floor + 1, a.z], b: [b.x, 1, b.z], color: trim });
      for (let j = 0; j <= 10; j++) {
        const v = 16 + j * 0.7,
          y = floor * (1 - j / 10);
        B(u - 0.025, v - 0.025, u + 0.025, v + 0.025, y, y + 1, trim);
      }
    }
    // Period furnishings are grounded, with clear lanes from every entrance to each stair.
    const table = (u: number, v: number, y: number, w: number, d: number) => {
      B(u - w / 2, v - d / 2, u + w / 2, v + d / 2, y + 0.71, y + 0.79, "#aa7850");
      for (const dx of [-1, 1])
        for (const dz of [-1, 1])
          B(
            u + dx * (w / 2 - 0.1) - 0.035,
            v + dz * (d / 2 - 0.1) - 0.035,
            u + dx * (w / 2 - 0.1) + 0.035,
            v + dz * (d / 2 - 0.1) + 0.035,
            y,
            y + 0.71,
            "#594939",
          );
    };
    B(-2.8, 5.3, -1.6, 8, 0, 0.2, "#684832");
    B(-2.8, 5.3, -1.6, 8, 0.2, 0.65, "#9d675b");
    B(-2.9, 5.3, -2.62, 8, 0.4, 1.13, "#875146");
    table(0.2, 6.7, 0, 1.4, 1.3);
    B(4.5, 9.2, 6.65, 12.5, 0, 0.9, "#dbd1b1");
    B(4.4, 9.1, 6.7, 12.6, 0.9, 0.96, "#535955");
    B(-1.5, 8.3, 1.5, 11.5, floor + 0.13, floor + 0.42, "#77523c");
    B(-1.5, 8.3, 1.5, 11.5, floor + 0.42, floor + 0.7, "#d9c5b7");
    for (const u of [-1.4, 1.4])
      for (const v of [8.4, 11.4])
        B(u - 0.06, v - 0.06, u + 0.06, v + 0.06, floor, floor + 0.15, "#584936");
    B(-1.5, 11.4, 1.5, 11.58, floor, floor + 1.2, "#77523c");
    table(4.8, 4.5, floor, 2.2, 0.8);
    B(12.9, 7.8, 14.6, 10.6, 0, 0.85, "#8c7758");
    B(12.85, 7.75, 14.65, 10.65, 0.85, 0.95, "#555e59");
    // Doors are data, so navigation, weather and future interaction share their location.
    door(2.3, 0, side > 0 ? 0 : 2);
    door(2.3, 13, side > 0 ? 2 : 0);
    door(11, 0, side > 0 ? 0 : 2);
    door(11, 11, side > 0 ? 2 : 0);
    plans.push(p);
  }
  // Boundary fencing and small waist-high covers leave both side lanes connected.
  const p: Structure = {
    id: "nuketown-gardens",
    kind: "colonnade",
    includeStatic: true,
    bounds: { x0: -34.2, x1: 34.2, z0: -44.2, z1: 44.2 },
    base: 0,
    top: 3.2,
    floors: [],
    stairs: [],
    solids: [],
    decor: [],
    doors: [],
  };
  const B = (x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, c: string) =>
    box(p, { x0, z0, x1, z1 }, y0, y1, c);
  for (const x of [-34, 34]) B(x - 0.08, -44, x + 0.08, 44, 0, 2.75, "#bba98a");
  for (const z of [-44, 44]) B(-34, z - 0.08, 34, z + 0.08, 0, 2.75, "#bba98a");
  for (const side of [-1, 1]) {
    for (const x of [-27, 24])
      for (let i = 0; i < 5; i++)
        B(
          x - 0.055,
          side * 34 + i * 0.16 - 0.055,
          x + 0.055,
          side * 34 + i * 0.16 + 0.055,
          0,
          1.08,
          "#f2e8cf",
        );
    for (const x of [-25, 23])
      B(x - 1.5, side * 25 - 0.45, x + 1.5, side * 25 + 0.45, 0, 0.9, "#838574");
    // Garden shed and dog kennel, each with supported sloped roofs in the art batch.
    B(-26, side > 0 ? 34 : -38, -21, side > 0 ? 38 : -34, 0, 2.5, "#b2b2a0");
  }
  p.shelters = [
    { x0: 3, x1: 11, z0: 1.6, z1: 4.4, y: 3.67 },
    { x0: -26, x1: -21, z0: 34, z1: 38, y: 2.5 },
    { x0: -26, x1: -21, z0: -38, z1: -34, y: 2.5 },
  ];
  p.navObstacles = [
    ...YARD_BOXES.filter((b) => b.y + b.h > 0.2).map((b) => ({
      x0: b.x - b.w / 2,
      x1: b.x + b.w / 2,
      z0: b.z - b.d / 2,
      z1: b.z + b.d / 2,
    })),
    ...YARD_TREES.map((b) => ({ x0: b.x - 0.29, x1: b.x + 0.29, z0: b.z - 0.29, z1: b.z + 0.29 })),
  ];
  plans.push(p);
  return plans;
}
export function nuketownMinimap(): MinimapSource {
  const base = document.createElement("canvas");
  base.width = base.height = 192;
  const c = base.getContext("2d")!;
  c.fillStyle = "#baa884";
  c.fillRect(0, 0, 192, 192);
  c.translate(96, 96);
  c.scale(2, 2);
  c.fillStyle = "#909b69";
  c.fillRect(-34, -44, 68, 88);
  c.fillStyle = "#696867";
  c.fillRect(-34, -9, 68, 18);
  for (const side of [-1, 1]) {
    c.fillStyle = side < 0 ? HOUSE_COLORS[0] : HOUSE_COLORS[1];
    c.fillRect(-7, side < 0 ? -27 : 14, 14, 13);
    c.fillStyle = "#b7b1a0";
    c.fillRect(side < 0 ? -15 : 7, side < 0 ? -25 : 14, 8, 11);
  }
  c.fillStyle = "#d4a84d";
  c.fillRect(-12, -4, 11, 2.8);
  c.fillStyle = "#a9c6c2";
  c.fillRect(2, 1, 12, 3);
  return {
    cells: 48,
    half: 48,
    base,
    land: "#baa884",
    sea: null,
    landmark: { x: 0, z: 0 },
    playHalf: 48,
  };
}
