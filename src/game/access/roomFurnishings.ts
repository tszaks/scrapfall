// Opt-in interior fixtures. These closed boxes are the single source for batched geometry,
// body contact, height-aware shots and roof spawn clearance. Coordinates use the access
// building's local frame; heights are absolute world heights after placement.
import type { AccessBuilding } from "./layout";
import type { LRect } from "./types";

export type FurnishingBox = LRect & {
  fixture: string;
  level: 0 | 1;
  y0: number;
  y1: number;
  color: string;
  material: "base" | "wood" | "steel" | "conc";
};

type Box = (
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
  color: string,
  material?: FurnishingBox["material"],
) => void;

const WOOD = "#795037";
const DARK = "#48382e";
const LINEN = "#d1c1a0";
const BRASS = "#ac8950";
const overlaps = (a: LRect, b: LRect, gap = 0) =>
  a.a1 > b.a0 - gap && a.a0 < b.a1 + gap && a.d1 > b.d0 - gap && a.d0 < b.d1 + gap;

/** Closed, supported furniture parts. A turn rotates the whole assembly, including legs. */
function legs(box: Box, w: number, d: number, height: number) {
  for (const x of [-w / 2 + 0.1, w / 2 - 0.1])
    for (const z of [-d / 2 + 0.1, d / 2 - 0.1])
      box(x - 0.045, x + 0.045, 0, height, z - 0.045, z + 0.045, DARK, "wood");
}
function table(box: Box, w = 1.35, d = 0.75, h = 0.48) {
  legs(box, w, d, h - 0.08);
  box(-w / 2, w / 2, h - 0.08, h, -d / 2, d / 2, WOOD, "wood");
  // Two closed books resting on the tabletop, rather than loose floating decoration.
  box(-0.25, 0.08, h, h + 0.045, -0.14, 0.11, "#526c65");
  box(-0.21, 0.03, h + 0.045, h + 0.08, -0.1, 0.08, LINEN);
}
function seat(box: Box, w: number, color: string, arms = true) {
  const d = 0.78;
  legs(box, w, d, 0.25);
  box(-w / 2, w / 2, 0.23, 0.43, -d / 2, d / 2, DARK, "wood");
  box(-w / 2 + 0.07, w / 2 - 0.07, 0.43, 0.57, -d / 2 + 0.035, d / 2 - 0.13, color);
  box(-w / 2, w / 2, 0.43, 0.94, d / 2 - 0.14, d / 2, color);
  if (arms) {
    box(-w / 2, -w / 2 + 0.12, 0.43, 0.71, -d / 2, d / 2, color);
    box(w / 2 - 0.12, w / 2, 0.43, 0.71, -d / 2, d / 2, color);
  }
}
function cabinet(box: Box, w: number, h = 0.75, d = 0.48) {
  box(-w / 2 + 0.06, w / 2 - 0.06, 0, 0.1, -d / 2 + 0.04, d / 2 - 0.04, DARK, "wood");
  box(-w / 2, w / 2, 0.1, h - 0.06, -d / 2, d / 2, WOOD, "wood");
  box(-w / 2 - 0.02, w / 2 + 0.02, h - 0.06, h, -d / 2 - 0.02, d / 2 + 0.02, "#9b7250", "wood");
  for (const x of [-w / 4, w / 4]) {
    box(
      x - w / 4 + 0.035,
      x + w / 4 - 0.035,
      0.14,
      h - 0.1,
      -d / 2 - 0.025,
      -d / 2,
      "#946545",
      "wood",
    );
    box(x - 0.045, x + 0.045, h / 2, h / 2 + 0.035, -d / 2 - 0.06, -d / 2 - 0.025, BRASS, "steel");
  }
}
function lamp(box: Box, base: number) {
  box(-0.14, 0.14, base, base + 0.035, -0.14, 0.14, BRASS, "steel");
  box(-0.022, 0.022, base + 0.035, base + 0.4, -0.022, 0.022, BRASS, "steel");
  box(-0.19, 0.19, base + 0.3, base + 0.55, -0.17, 0.17, "#e3c895");
}
function bed(box: Box) {
  legs(box, 1.85, 2.3, 0.24);
  box(-0.925, 0.925, 0.2, 0.39, -1.15, 1.15, WOOD, "wood");
  box(-0.9, 0.9, 0.39, 0.65, -1.12, 1.1, LINEN);
  box(-0.92, 0.92, 0.65, 0.69, -1.13, 0.33, "#596955");
  box(-0.94, 0.94, 0, 1.05, 1.08, 1.2, DARK, "wood");
  for (const x of [-0.44, 0.44]) box(x - 0.33, x + 0.33, 0.65, 0.79, 0.54, 0.94, "#e2d7bf");
}
function desk(box: Box, coastal: boolean) {
  cabinet(box, 1.65, 0.96, 0.62);
  box(-0.87, 0.87, 0.96, 1.04, -0.36, 0.36, coastal ? "#c6d0c3" : "#3b3835", "conc");
  // Guest register and a small desk bell, both supported by the stone counter.
  box(-0.37, 0.13, 1.04, 1.07, -0.17, 0.19, "#ded0aa");
  box(0.43, 0.57, 1.04, 1.07, -0.09, 0.05, BRASS, "steel");
  box(0.47, 0.53, 1.07, 1.14, -0.05, 0.01, BRASS, "steel");
}

export function furnishAccess(b: AccessBuilding): FurnishingBox[] {
  const themes = b.spec.furnishings;
  if (!themes) return [];
  const out: FurnishingBox[] = [];
  const room = b.roomL;
  const reserved: LRect[] = [];
  const q = b.portals[1];
  // All fixtures retain a generous approach to the top landing / elevator threshold.
  reserved.push(
    q.na
      ? { a0: q.a - 0.3, a1: q.a + 1.8, d0: q.d - 1.1, d1: q.d + 1.1 }
      : { a0: q.a - 1.9, a1: q.a + 1.9, d0: q.d - 2.0, d1: q.d + 0.2 },
  );
  if (b.spec.terrace) {
    const t = b.spec.terrace;
    const alongX = t.wall.x1 - t.wall.x0 > t.wall.z1 - t.wall.z0;
    const x = alongX ? (t.door[0] + t.door[1]) / 2 : (t.wall.x0 + t.wall.x1) / 2;
    const z = alongX ? (t.wall.z0 + t.wall.z1) / 2 : (t.door[0] + t.door[1]) / 2;
    const a = (x - b.ox) * b.tx + (z - b.oz) * b.tz;
    const d = (x - b.ox) * b.ix + (z - b.oz) * b.iz;
    // Full cross-room aisle at the terrace door, not merely a gap in its wall.
    reserved.push(
      Math.abs(a - room.a0) < 0.8 || Math.abs(a - room.a1) < 0.8
        ? { a0: room.a0, a1: room.a1, d0: d - 1.1, d1: d + 1.1 }
        : { a0: a - 1.1, a1: a + 1.1, d0: room.d0, d1: room.d1 },
    );
  }
  const place = (
    name: string,
    level: 0 | 1,
    a: number,
    d: number,
    turn: number,
    make: (box: Box) => void,
  ) => {
    const floor = level ? b.top + 0.03 : b.groundY + 0.17;
    const parts: FurnishingBox[] = [];
    const rotate = (x: number, z: number) =>
      turn === 1 ? [-z, x] : turn === 2 ? [-x, -z] : turn === 3 ? [z, -x] : [x, z];
    make((x0, x1, y0, y1, z0, z1, color, material = "base") => {
      const [a0, d0] = rotate(x0, z0),
        [a1, d1] = rotate(x1, z1);
      parts.push({
        fixture: name,
        level,
        a0: a + Math.min(a0!, a1!),
        a1: a + Math.max(a0!, a1!),
        d0: d + Math.min(d0!, d1!),
        d1: d + Math.max(d0!, d1!),
        y0: floor + y0,
        y1: floor + y1,
        color,
        material,
      });
    });
    const bounds = {
      a0: Math.min(...parts.map((p) => p.a0)),
      a1: Math.max(...parts.map((p) => p.a1)),
      d0: Math.min(...parts.map((p) => p.d0)),
      d1: Math.max(...parts.map((p) => p.d1)),
    };
    const R = level ? room : b.elev!.lobby;
    if (
      bounds.a0 < R.a0 + 0.16 ||
      bounds.a1 > R.a1 - 0.16 ||
      bounds.d0 < R.d0 + 0.16 ||
      bounds.d1 > R.d1 - 0.16
    )
      return;
    if (level && (overlaps(bounds, b.pent, 0.85) || reserved.some((r) => overlaps(bounds, r))))
      return;
    if (out.some((p) => p.level === level && overlaps(bounds, p, 0.35))) return;
    out.push(...parts);
  };
  if (themes.lobby && b.elev) {
    const coastal = themes.lobby === "pier-reception";
    // Both compact lobbies keep the complete central runner and rear call-button bay open.
    place("reception-desk", 0, b.elev.lobby.a0 + 0.58, 2.45, 1, (box) => desk(box, coastal));
    place("waiting-bench", 0, b.elev.lobby.a1 - 0.6, 2.6, 3, (box) =>
      seat(box, 1.7, coastal ? "#618b8a" : "#735647", false),
    );
  }
  if (themes.room === "hotel-lounge") {
    // Two legible seating areas flank a broad central elevator approach.
    const left = room.a0 + 2.25,
      right = room.a1 - 2.0;
    place("lounge-sofa", 1, left, room.d0 + 2.0, 2, (box) => seat(box, 2.35, "#6b796d"));
    place("lounge-coffee-table", 1, left, room.d0 + 3.7, 0, (box) => table(box));
    place("lounge-armchair", 1, left, room.d0 + 5.3, 0, (box) => seat(box, 0.92, "#a28058"));
    place("reading-chair", 1, right, room.d0 + 2.2, 2, (box) => seat(box, 1.05, "#8d6352"));
    place("reading-table", 1, right + 0.1, room.d0 + 3.9, 0, (box) => table(box, 1.1, 0.7, 0.64));
    place("reading-sideboard", 1, right, room.d1 - 1.0, 0, (box) => {
      cabinet(box, 2.0);
      lamp(box, 0.75);
    });
    place("lounge-bookcase", 1, left, room.d1 - 0.65, 0, (box) => {
      cabinet(box, 1.8, 0.74);
      // Low reading cabinet keeps the front facade windows clear.
      for (let i = 0; i < 8; i++)
        box(
          -0.68 + i * 0.16,
          -0.57 + i * 0.16,
          0.74,
          0.96 + (i % 3) * 0.06,
          -0.14,
          0.17,
          ["#748275", "#a27650", "#975b4e"][i % 3]!,
        );
    });
  } else if (themes.room === "chalet-loft") {
    // Sleeping and reading areas occupy the rear half beyond the stair and balcony aisle.
    const rear = room.d1;
    place("chalet-bed", 1, room.a0 + 1.6, rear - 1.4, 0, bed);
    place("bedside-table", 1, room.a0 + 3.3, rear - 0.75, 0, (box) => {
      cabinet(box, 0.62, 0.56);
      lamp(box, 0.56);
    });
    place("reading-sofa", 1, room.a1 - 1.55, rear - 1.0, 0, (box) => seat(box, 1.9, "#795e52"));
    place("chalet-coffee-table", 1, room.a1 - 1.55, rear - 2.65, 0, (box) => table(box, 1.2, 0.7));
    place("blanket-chest", 1, room.a0 + 0.6, room.d0 + 2.3, 1, (box) =>
      cabinet(box, 1.3, 0.65, 0.48),
    );
  } else if (themes.room === "belfry") {
    // The bell already hangs from a ceiling beam. A shallow service cabinet and tool chest
    // occupy stone corners, below the arch edges; the narrow viewing circuit stays open.
    place("bell-maintenance-cabinet", 1, room.a0 + 0.4, room.d0 + 1.1, 1, (box) =>
      cabinet(box, 0.82, 0.78, 0.3),
    );
    place("bell-tool-chest", 1, room.a1 - 0.4, room.d1 - 1.0, 3, (box) =>
      cabinet(box, 0.75, 0.48, 0.3),
    );
  }
  return out;
}

/** Radius-expanded boxes, with a vertical interval: bodies and shots use the same parts. */
export function furnishingBlocked(
  b: AccessBuilding,
  level: 0 | 1,
  a: number,
  d: number,
  radius: number,
  y0: number,
  y1: number,
) {
  return b.furnishings.some(
    (p) =>
      p.level === level &&
      p.y1 > y0 &&
      p.y0 < y1 &&
      a > p.a0 - radius &&
      a < p.a1 + radius &&
      d > p.d0 - radius &&
      d < p.d1 + radius,
  );
}
