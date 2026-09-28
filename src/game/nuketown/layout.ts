import { box, slab, type Rect, type Structure } from "../structures/plan";
import type { MinimapSource } from "../Minimap";

export const NUKE_SIZE = 96;
/** Solo spawn: the yellow (south) backyard pocket, facing the house's rear door. */
export const NUKE_SPAWN = { x: 10.5, z: 24.5, yaw: 0 };
/** [north house, south house] */
export const HOUSE_COLORS = ["#62a89b", "#dfb95f"] as const;

// ---------------------------------------------------------------- shared spec
// The art builder (build.ts) and the collision plan below read from these rects so the
// render and the physics can never drift apart.

export type Side = "n" | "s";
export const SIDES: Side[] = ["n", "s"];
/** north -> south point mirror about the arena centre */
export const mirror = (r: Rect): Rect => ({ x0: -r.x1, x1: -r.x0, z0: -r.z1, z1: -r.z0 });
const pick = (side: Side, r: Rect): Rect => (side === "n" ? r : mirror(r));

export const NUKE = {
  /** asphalt strip, kerbs and the west cul-de-sac bulb */
  street: { x0: -22.5, x1: 26.5, z0: -3.5, z1: 3.5 },
  bulb: { x: -19.5, z: 0, r: 5.6 },
  kerb: 0.36,
  /** walkable lots (fence to fence) */
  lotN: { x0: -18, x1: -1, z0: -31, z1: -5.6 } as Rect,
  lotS: { x0: 1, x1: 18, z0: 5.6, z1: 31 } as Rect,
  /** lawns visible through the fences but outside the playable boundary */
  pocketNE: { x0: -1, x1: 30, z0: -31, z1: -5.6 } as Rect,
  pocketSW: { x0: -30, x1: 1, z0: 5.6, z1: 31 } as Rect,
  pocketNW: { x0: -30, x1: -18, z0: -31, z1: -5.6 } as Rect,
  pocketSE: { x0: 18, x1: 30, z0: 5.6, z1: 31 } as Rect,
  houseN: { x0: -13, x1: -4.2, z0: -17.4, z1: -9.6 } as Rect,
  garageN: { x0: -17.5, x1: -13.24, z0: -17, z1: -9.8 } as Rect,
  porchN: { x0: -10.5, x1: -5.2, z0: -9.6, z1: -7.9 } as Rect,
  shedN: { x0: -16.9, x1: -14.1, z0: -30, z1: -27.4 } as Rect,
  /** third, unreachable house across the cul-de-sac bulb (facade faces east) */
  houseW: { x0: -30.4, x1: -26.8, z0: -4.6, z1: 4.6 } as Rect,
  /** backdrop houses past the east roadblock and the far corner */
  backdropN: { x0: 8, x1: 17, z0: -16, z1: -8 } as Rect,
  wallT: 0.24,
  floorY: 0.2, // ground floor interior surface
  slabY: 3.32, // upstairs floor surface
  wallTop: 6.3, // upper wall plate
  ridgeY: 7.62, // main roof ridge height
  garageSlabY: 3.3,
  garageRidgeY: 4.5,
};
const F2 = NUKE.slabY;

/** vehicles parked in/around the street (world space, yaw = turn about y) */
export const NUKE_VEHICLES: {
  kind: "bus" | "truck" | "sedan" | "wagon" | "jeep";
  x: number;
  z: number;
  yaw: number;
  color: string;
}[] = [
  // nose is local +z; yaw is the world heading (pi/2 = facing east along the street)
  { kind: "bus", x: -5.4, z: -0.55, yaw: 1.29, color: "#d9a92e" },
  { kind: "truck", x: 6.9, z: 1.15, yaw: -1.35, color: "#cfd3cd" },
  { kind: "sedan", x: 14.6, z: -2.15, yaw: Math.PI / 2 + 0.05, color: "#cf8a8a" },
  { kind: "wagon", x: -21.6, z: 4.35, yaw: 1.78, color: "#7fa8a0" },
  { kind: "jeep", x: 24.6, z: 0.4, yaw: Math.PI / 2 - 0.22, color: "#77775a" },
  { kind: "sedan", x: 13.9, z: 7.7, yaw: Math.PI + 0.06, color: "#8fa7c4" },
];

/** mannequins: pose drives the art build, the nav block keeps enemies off them */
export const NUKE_MANNEQUINS: {
  x: number;
  z: number;
  y?: number;
  yaw: number;
  pose: "stand" | "sit" | "lounge" | "sitFloor";
  hat?: boolean;
}[] = [
  // north house: family at the dining table (seat tops ~0.7 -> base offset ~0.2)
  { x: -8.8, z: -14.4, y: 0.21, yaw: Math.PI, pose: "sit" },
  { x: -9.75, z: -15.2, y: 0.21, yaw: Math.PI / 2, pose: "sit" },
  { x: -7.85, z: -15.2, y: 0.21, yaw: -Math.PI / 2, pose: "sit" },
  { x: -6.0, z: -16.6, yaw: 2.6, pose: "stand" }, // kitchen counter
  { x: -12, z: -11.2, y: 0.31, yaw: Math.PI / 2, pose: "sit" }, // sofa
  { x: -11.2, z: -11.2, y: 0.31, yaw: Math.PI / 2, pose: "sit" }, // sofa
  { x: -8.5, z: -10.6, y: F2, yaw: Math.PI, pose: "stand" }, // THE window
  { x: -8.4, z: -16.7, y: F2, yaw: Math.PI, pose: "stand" }, // rear bedroom window
  { x: -8.1, z: -8.4, y: 0.21, yaw: 0.2, pose: "sit" }, // porch chair
  // south house
  { x: 8.8, z: 14.4, y: 0.21, yaw: 0, pose: "sit" },
  { x: 9.75, z: 15.2, y: 0.21, yaw: -Math.PI / 2, pose: "sit" },
  { x: 7.85, z: 15.2, y: 0.21, yaw: Math.PI / 2, pose: "sit" },
  { x: 6.0, z: 16.6, yaw: -2.6, pose: "stand" },
  { x: 12, z: 11.2, y: 0.31, yaw: -Math.PI / 2, pose: "sit" },
  { x: 11.2, z: 11.2, y: 0.31, yaw: -Math.PI / 2, pose: "sit" },
  { x: 8.5, z: 10.6, y: F2, yaw: 0, pose: "stand" }, // upstairs window
  { x: 15.6, z: 13.6, yaw: -1.2, pose: "stand" }, // garage mechanic at the bench
  // yards and street
  { x: -5.9, z: -24.5, yaw: 0.4, pose: "stand" }, // pushing the mower
  { x: -9, z: -23.3, y: 0.12, yaw: 0, pose: "sitFloor" }, // on the swing
  { x: 13.6, z: 22.6, yaw: -2.4, pose: "stand" }, // grill man
  { x: 5.4, z: 7.6, yaw: 1.9, pose: "lounge" }, // sunbathing on the lawn
  { x: -10.6, z: -4.15, yaw: 1.35, pose: "stand" }, // waiting by the mailbox
  { x: -3.2, z: -1.9, yaw: 1.35, pose: "stand" }, // boarding the bus
  { x: 24.2, z: -4.1, yaw: -1.4, pose: "stand" }, // leaning on the population sign
  { x: 13.9, z: 7.55, y: 0.37, yaw: -0.06, pose: "sit" }, // driver in the driveway sedan
];

// ---------------------------------------------------------------- structures

type Gap = { a: number; b: number; y0: number; y1: number };
/**
 * A wall run along x (front/back) or z (sides): emits collision solids that ARE the
 * visible wall, so openings show real thickness, plus proud trim round every opening.
 */
function wallRun(
  p: Structure,
  fixed: number,
  along: "x" | "z",
  from: number,
  to: number,
  y0: number,
  y1: number,
  color: string,
  gaps: Gap[] = [],
  t = NUKE.wallT,
  /** which face is outside (-1 = the fixed edge, +1 = fixed+t); emits clapboard strips */
  clad?: { dir: 1 | -1; color: string },
) {
  const lo = Math.min(from, to),
    hi = Math.max(from, to);
  const segs: { a: number; b: number; y0: number; y1: number }[] = [];
  let cur = lo;
  for (const g of [...gaps].sort((x, y) => x.a - y.a)) {
    if (g.a > cur) segs.push({ a: cur, b: g.a, y0, y1 });
    if (g.y0 > y0) segs.push({ a: g.a, b: g.b, y0, y1: g.y0 });
    if (g.y1 < y1) segs.push({ a: g.a, b: g.b, y0: g.y1, y1 });
    cur = g.b;
  }
  if (cur < hi) segs.push({ a: cur, b: hi, y0, y1 });
  for (const s of segs) {
    const r =
      along === "x"
        ? { x0: s.a, x1: s.b, z0: fixed, z1: fixed + t }
        : { x0: fixed, x1: fixed + t, z0: s.a, z1: s.b };
    box(p, r, s.y0, s.y1, color);
    if (clad)
      for (let y = s.y0 + 0.13; y < s.y1 - 0.05; y += 0.27) {
        const off = clad.dir > 0 ? 0 : -0.045;
        const cr =
          along === "x"
            ? { x0: s.a, x1: s.b, z0: fixed + (clad.dir > 0 ? t : 0) + off, z1: fixed + (clad.dir > 0 ? t : 0) + off + 0.045 }
            : { x0: fixed + (clad.dir > 0 ? t : 0) + off, x1: fixed + (clad.dir > 0 ? t : 0) + off + 0.045, z0: s.a, z1: s.b };
        box(p, cr, y, y + 0.05, clad.color, false);
      }
  }
  for (const g of gaps) {
    const trim = (a0: number, a1: number, ty0: number, ty1: number) => {
      const r =
        along === "x"
          ? { x0: a0, x1: a1, z0: fixed - 0.09, z1: fixed + t + 0.09 }
          : { x0: fixed - 0.09, x1: fixed + t + 0.09, z0: a0, z1: a1 };
      box(p, r, ty0, ty1, "#efe6cd", false);
    };
    trim(g.a - 0.1, g.a, g.y0, g.y1);
    trim(g.b, g.b + 0.1, g.y0, g.y1);
    trim(g.a - 0.1, g.b + 0.1, g.y1, g.y1 + 0.1);
    if (g.y0 > y0 + 0.05) trim(g.a - 0.16, g.b + 0.16, g.y0 - 0.07, g.y0);
  }
}

/** one model home; authored in north coordinates, mirrored for the south lot */
function housePlan(side: Side): Structure {
  const p: Structure = {
    id: `nuketown-house-${side}`,
    kind: "chalet",
    includeStatic: true,
    bounds: pick(side, { x0: -18, x1: -1, z0: -31, z1: -5.6 }),
    base: 0,
    top: 8.4,
    floors: [],
    stairs: [],
    solids: [],
    decor: [],
    doors: [],
    shelters: [
      { ...pick(side, { x0: -13.6, x1: -3.6, z0: -18, z1: -9 }), y: 7.9 },
      { ...pick(side, { x0: -17.6, x1: -12.9, z0: -17.4, z1: -9.4 }), y: 4.75 },
      { ...pick(side, { x0: -10.7, x1: -5, z0: -9.8, z1: -7.7 }), y: 3.05 },
      { ...pick(side, { x0: -17, x1: -14, z0: -30.2, z1: -27.2 }), y: 2.25 },
    ],
  };
  const pt = (x: number, z: number) => (side === "n" ? { x, z } : { x: -x, z: -z });
  const rect = (x0: number, z0: number, x1: number, z1: number): Rect => {
    const a = pt(x0, z0),
      b = pt(x1, z1);
    return {
      x0: Math.min(a.x, b.x),
      x1: Math.max(a.x, b.x),
      z0: Math.min(a.z, b.z),
      z1: Math.max(a.z, b.z),
    };
  };
  const B = (
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    y0: number,
    y1: number,
    c: string,
    solid = true,
    glow = false,
  ) => box(p, rect(x0, z0, x1, z1), y0, y1, c, solid, glow);
  const nav = (x0: number, z0: number, x1: number, z1: number) =>
    (p.navObstacles ??= []).push(rect(x0, z0, x1, z1));
  const door = (x: number, z: number, facing: 0 | 1 | 2 | 3) =>
    p.doors.push({ ...pt(x, z), facing });
  const wallC = HOUSE_COLORS[side === "n" ? 0 : 1]!;
  const inn = "#e6ddc8";
  const T = NUKE.wallT;
  const H = NUKE.houseN,
    G = NUKE.garageN,
    P = NUKE.porchN;
  /** wall run on north coordinates; for the south house everything mirrors about 0,0 */
  const wr = (
    fixed: number,
    along: "x" | "z",
    from: number,
    to: number,
    y0: number,
    y1: number,
    color: string,
    gaps: Gap[] = [],
    clad?: { dir: 1 | -1; color: string },
  ) => {
    if (side === "n") wallRun(p, fixed, along, from, to, y0, y1, color, gaps, T, clad);
    else
      wallRun(
        p,
        -fixed - T,
        along,
        -to,
        -from,
        y0,
        y1,
        color,
        gaps.map((g) => ({ a: -g.b, b: -g.a, y0: g.y0, y1: g.y1 })),
        T,
        clad && { dir: -clad.dir as 1 | -1, color: clad.color },
      );
  };

  // ---------------- ground storey (0..3.32)
  const g0 = 0,
    g1 = 3.32;
  const cl = { color: side === "n" ? "#56a093" : "#d2ae56" }; // clapboard strip tone
  // front wall (faces the street): front door + living-room windows
  wr(
    H.z1,
    "x",
    H.x0,
    H.x1,
    g0,
    g1,
    wallC,
    [
      { a: -7.65, b: -6.45, y0: g0, y1: 2.42 },
      { a: -11.9, b: -10.3, y0: 1.05, y1: 2.35 },
      { a: -5.85, b: -4.95, y0: 1.05, y1: 2.35 },
    ],
    { dir: 1, color: cl.color },
  );
  // rear wall: back door + kitchen window
  wr(
    H.z0 - T,
    "x",
    H.x0,
    H.x1,
    g0,
    g1,
    wallC,
    [
      { a: -11.7, b: -10.5, y0: g0, y1: 2.42 },
      { a: -8.9, b: -7.1, y0: 1.15, y1: 2.3 },
    ],
    { dir: -1, color: cl.color },
  );
  // east wall: kitchen nook window + a small high window over the stair run
  wr(
    H.x1,
    "z",
    H.z0,
    H.z1,
    g0,
    g1,
    wallC,
    [
      { a: -16.8, b: -15.6, y0: 1.05, y1: 2.3 },
      { a: -12.5, b: -11.5, y0: 1.9, y1: 2.7 },
    ],
    { dir: 1, color: cl.color },
  );
  // west wall (shared with the garage — its outer face is inside the garage, no siding)
  wr(H.x0 - T, "z", H.z0, H.z1, g0, g1, wallC, [{ a: -14.9, b: -13.7, y0: g0, y1: 2.3 }]);

  // partial divider between living room and kitchen; wide cased opening on the east half
  wr(-13.4, "x", H.x0, -8.6, g0, g1, inn, []);
  B(-8.6, -13.52, -8.48, -13.28, g0, 2.5, "#efe6cd", false);
  B(-8.62, -13.48, -5.55, -13.4, 2.42, 2.54, "#efe6cd", false);
  // stair enclosure on the stair's west edge + stepped mass beneath the run
  B(-5.62, -15.9, -5.5, -10.9, g0, 2.75, inn);
  B(-5.6, -15.9, -4.45, -14.4, g0, 2.02, inn);
  B(-5.6, -14.4, -4.45, -12.9, g0, 1.26, inn);
  // low kick under the first tread: must stay below feet+0.2 where the stair surface is shallow
  B(-5.6, -12.9, -4.45, -10.9, g0, 0.35, inn);
  B(-5.52, -14.3, -5.44, -12.9, 0.15, 1.8, "#d8cbb0", false); // closet door face
  // wainscot line + ceiling edge detail inside
  B(H.x0, H.z0, H.x1, H.z1, 0, 0.02, "#8a7a5e", false);

  // ---------------- upper storey (3.32..6.3)
  wr(
    H.z1,
    "x",
    H.x0,
    H.x1,
    F2,
    NUKE.wallTop,
    wallC,
    [
      { a: -9.6, b: -7.4, y0: 3.95, y1: 5.4 }, // the window — the long sightline
      { a: -12.4, b: -11.2, y0: 4.0, y1: 5.35 },
    ],
    { dir: 1, color: cl.color },
  );
  wr(
    H.z0 - T,
    "x",
    H.x0,
    H.x1,
    F2,
    NUKE.wallTop,
    wallC,
    [
      { a: -9.4, b: -7.5, y0: 3.95, y1: 5.4 },
      { a: -12.2, b: -11, y0: 4.0, y1: 5.35 },
    ],
    { dir: -1, color: cl.color },
  );
  wr(
    H.x1,
    "z",
    H.z0,
    H.z1,
    F2,
    NUKE.wallTop,
    wallC,
    [
      { a: -10.4, b: -9.9, y0: 4.1, y1: 5.2 },
      { a: -17.1, b: -16.3, y0: 4.1, y1: 5.2 },
    ],
    { dir: 1, color: cl.color },
  );
  wr(
    H.x0 - T,
    "z",
    H.z0,
    H.z1,
    F2,
    NUKE.wallTop,
    wallC,
    [
      { a: -11.4, b: -10.2, y0: 4.0, y1: 5.3 },
      { a: -16.9, b: -15.7, y0: 4.0, y1: 5.3 },
    ],
    { dir: -1, color: cl.color },
  );
  // bedroom divider with a door
  wr(-13.52, "x", H.x0, -5.66, F2, NUKE.wallTop, inn, [
    { a: -7.7, b: -6.5, y0: F2, y1: F2 + 2.1 },
  ]);

  // ---------------- floors and the stair
  p.floors.push({ ...rect(H.x0, H.z0, H.x1, H.z1), y: NUKE.floorY, level: 0, holes: [] });
  p.floors.push({ ...rect(G.x0, G.z0, G.x1, G.z1), y: 0.14, level: 0, holes: [] });
  p.floors.push({ ...rect(P.x0, P.z0, P.x1, P.z1), y: 0.16, level: 0, holes: [] });
  B(H.x0, H.z0, H.x1, H.z1, 0, NUKE.floorY, "#a08a68"); // ground slab (wood tone sides)
  B(G.x0, G.z0, G.x1, G.z1, 0, 0.14, "#9a958c");
  B(P.x0, P.z0, P.x1, P.z1, 0, 0.16, "#a49e92");
  const hole = { x0: -5.66, x1: -4.4, z0: -15.95, z1: -10.85 };
  slab(p, rect(H.x0, H.z0, H.x1, H.z1), F2, 1, side === "n" ? hole : mirror(hole));
  // opaque attic floor / upstairs ceiling
  B(H.x0 - T, H.z0 - T, H.x1 + T, H.z1 + T, NUKE.wallTop - 0.16, NUKE.wallTop + 0.02, "#cfc5ae");
  // the stair itself rises toward the rear wall
  p.stairs.push({
    ...rect(-5.55, -15.9, -4.45, -10.9),
    axis: "z",
    reverse: side === "n",
    y0: NUKE.floorY,
    y1: F2,
    level: 1,
  });
  // stairwell guards on the upper floor
  B(-5.68, -15.9, -5.6, -10.9, F2, F2 + 0.98, "#8a6f4d");
  B(-5.68, -10.95, -4.4, -10.87, F2, F2 + 0.98, "#8a6f4d");
  for (let z = -15.7; z < -11; z += 0.42) B(-5.66, z, -5.62, z + 0.05, F2, F2 + 0.9, "#efe6cd", false);
  // and a rail along the open side of the flight below
  for (let i = 0; i < 9; i++) {
    const z = -15.5 + i * 0.5,
      y = 0.6 + i * 0.3;
    B(-5.58, z - 0.02, -5.5, z + 0.02, y, y + 0.75, "#8a6f4d", false);
  }

  // ---------------- garage (attached, west side)
  const gw = "#a89d8a",
    gc = { dir: 1 as const, color: "#9b8f7a" };
  wr(
    G.z1,
    "x",
    G.x0,
    G.x1,
    g0,
    NUKE.garageSlabY,
    gw,
    [{ a: -16.7, b: -14.3, y0: 0, y1: 2.3 }], // vehicle door (raised)
    gc,
  );
  wr(
    G.z0 - T,
    "x",
    G.x0,
    G.x1,
    g0,
    NUKE.garageSlabY,
    gw,
    [{ a: -16.35, b: -15.25, y0: 0, y1: 2.28 }], // rear man door
    { dir: -1, color: gc.color },
  );
  wr(G.x0 - T, "z", G.z0, G.z1, g0, NUKE.garageSlabY, gw, [], { dir: -1, color: gc.color });
  B(G.x0, G.z0, G.x1 + T, G.z1 + T, NUKE.garageSlabY - 0.16, NUKE.garageSlabY, "#cfc5ae"); // ceiling

  // ---------------- backyard shed (walkable hut against the rear fence)
  const SD = NUKE.shedN; // door faces the lawn on the +z wall
  B(SD.x0, SD.z0, SD.x1, SD.z0 + 0.18, 0, 2.05, "#a8a08c");
  B(SD.x0, SD.z1 - 0.18, -16.35, SD.z1, 0, 2.05, "#a8a08c");
  B(-15.35, SD.z1 - 0.18, SD.x1, SD.z1, 0, 2.05, "#a8a08c");
  B(-16.35, SD.z1 - 0.18, -15.35, SD.z1, 1.85, 2.05, "#a8a08c"); // header over the gap
  B(SD.x0, SD.z0, SD.x0 + 0.18, SD.z1, 0, 2.05, "#a8a08c");
  B(SD.x1 - 0.18, SD.z0, SD.x1, SD.z1, 0, 2.05, "#a8a08c");
  B(SD.x0 - 0.15, SD.z0 - 0.15, SD.x1 + 0.15, SD.z1 + 0.15, 2.05, 2.22, "#8d8577");
  // rear-door stoop
  B(-12, H.z0 - 0.24, -10.2, H.z0 - 1.7, 0, 0.12, "#a49e92");
  p.floors.push({ ...rect(-12, H.z0 - 0.24, -10.2, H.z0 - 1.7), y: 0.12, level: 0, holes: [] });

  // ---------------- furniture: hidden colliders; build.ts draws the real pieces
  const furn = (x0: number, z0: number, x1: number, z1: number, y0: number, y1: number) => {
    box(p, rect(x0, z0, x1, z1), y0, y1, "#000000").hidden = true;
    // nav footprints only make sense for ground-floor props (enemies never climb stairs)
    if (y0 < 1) nav(x0 - 0.1, z0 - 0.1, x1 + 0.1, z1 + 0.1);
  };
  const fy = NUKE.floorY;
  // living room (front): sofa along the west wall, TV credenza opposite, coffee table
  furn(-12.76, -11.9, -11.4, -10.2, fy, fy + 0.78);
  furn(-6.55, -10.2, -4.85, -9.7, fy, fy + 0.62);
  furn(-10.2, -12.1, -8.4, -11.3, fy, fy + 0.45);
  furn(-6.85, -12.15, -6.35, -11.65, fy, fy + 0.55); // armchair
  // kitchen (rear): counters + fridge + range + the dining table the family sits at
  furn(-8.9, -17.16, -4.7, -16.5, fy, fy + 0.92);
  furn(-12.9, -17.16, -12.2, -16.45, fy, fy + 1.78);
  furn(-9.8, -15.75, -7.8, -14.6, fy, fy + 0.78);
  for (const [cx, cz] of [
    [-10.0, -14.4],
    [-10.0, -15.95],
    [-8.55, -15.2],
  ] as const)
    furn(cx - 0.24, cz - 0.24, cx + 0.24, cz + 0.24, fy, fy + 0.48);
  // upstairs: beds + dresser + desk (kept west of the stairwell hole)
  furn(-12.76, -10.0, -10.6, -12.1, F2, F2 + 0.58);
  furn(-6.3, -9.9, -4.5, -10.55, F2, F2 + 0.95);
  furn(-12.76, -15.6, -10.6, -17.15, F2, F2 + 0.58);
  furn(-6.6, -16.95, -5.7, -16.3, F2, F2 + 0.75);
  // garage: workbench along the west wall, shelves, crates (clear of the rear man-door lane)
  furn(-17.26, -15.8, -16.55, -13.6, 0.14, 1.06);
  furn(-14.6, -10.2, -13.6, -9.9, 0.14, 1.5);
  furn(-16.9, -12.3, -16.1, -11.3, 0.14, 0.62);
  // backyard cover: swing set A-frames, picnic table + grill, trash cans, clothesline, chair
  nav(-10.1, -24.8, -8.0, -23.6);
  nav(-15.2, -22.7, -13.6, -21.9);
  nav(-13.3, -22.1, -12.5, -21.2);
  nav(-14, -18.9, -12.6, -18.1);
  nav(-3.5, -26.6, -2.5, -26.2);
  nav(-2.4, -26.6, -1.5, -26.2);
  nav(-6.5, -21, -5.4, -20);

  door(-7.05, H.z1 + 0.1, side === "n" ? 0 : 2);
  door(-11.1, H.z0 - 0.1, side === "n" ? 2 : 0);
  door(-15.5, G.z1 + 0.1, side === "n" ? 0 : 2);
  door(-15.8, G.z0 - 0.1, side === "n" ? 2 : 0);
  return p;
}

/** fences round the whole S/Z-shaped playable area + street-furniture nav blocks */
function boundaryPlan(): Structure {
  const p: Structure = {
    id: "nuketown-boundary",
    kind: "colonnade",
    includeStatic: true,
    bounds: { x0: -48, x1: 48, z0: -48, z1: 48 },
    base: 0,
    top: 2.4,
    floors: [],
    stairs: [],
    solids: [],
    decor: [],
    doors: [],
  };
  const B = (x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, c: string) =>
    box(p, { x0, z0, x1, z1 }, y0, y1, c);
  const nav = (x0: number, z0: number, x1: number, z1: number) =>
    (p.navObstacles ??= []).push({ x0, z0, x1, z1 });
  // board fences are real solids; build.ts dresses them with posts, caps and seams
  const privacy = (x0: number, z0: number, x1: number, z1: number) =>
    B(x0, z0, x1, z1, 0, 1.95, "#b3a284");
  // picket fences: collision on two thin rails only — shots thread between pickets
  const picket = (x0: number, z0: number, x1: number, z1: number) => {
    B(x0, z0, x1, z1, 0.32, 0.4, "#000").hidden = true;
    B(x0, z0, x1, z1, 0.9, 0.98, "#000").hidden = true;
  };
  const run = (
    kind: "privacy" | "picket",
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    gaps: [number, number][] = [],
    /** hidden full-height board behind the pickets: keeps players out of dead pockets */
    backer = false,
  ) => {
    const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    const lo = alongX ? Math.min(x0, x1) : Math.min(z0, z1),
      hi = alongX ? Math.max(x0, x1) : Math.max(z0, z1);
    let cur = lo;
    const segs: [number, number][] = [];
    for (const [a, b] of [...gaps].sort((g, h) => g[0] - h[0])) {
      if (a > cur) segs.push([cur, a]);
      cur = b;
    }
    if (cur < hi) segs.push([cur, hi]);
    for (const [a, b] of segs) {
      const t = 0.07;
      const r = alongX
        ? { x0: a, x1: b, z0: Math.min(z0, z1) - t / 2, z1: Math.max(z0, z1) + t / 2 }
        : { x0: Math.min(x0, x1) - t / 2, x1: Math.max(x0, x1) + t / 2, z0: a, z1: b };
      (kind === "privacy" ? privacy : picket)(r.x0, r.z0, r.x1, r.z1);
      // the backer starts just above the picket's top rail so shots keep threading
      if (backer) B(r.x0, r.z0, r.x1, r.z1, 1.0, 1.7, "#000").hidden = true;
    }
  };

  const N = NUKE.lotN,
    S = NUKE.lotS;
  // north lot boundary (rear/east/west privacy; street frontage picket with gaps)
  run("privacy", N.x0, N.z0, N.x1, N.z0);
  run("privacy", N.x1, N.z0, N.x1, N.z1);
  run("privacy", N.x0, N.z0, N.x0, N.z1);
  run("picket", N.x0, N.z1, N.x1, N.z1, [
    [-16.9, -13.9], // driveway
    [-7.6, -6.5], // front walk
    [-2.7, -1.6], // side-path gate
  ]);
  // the slot between each garage's side wall and its fence is a dead pocket
  nav(-18.15, -17.3, -17.7, -9.7);
  nav(17.7, 9.7, 18.15, 17.3);
  // south lot (point-mirrored)
  run("privacy", S.x0, S.z1, S.x1, S.z1);
  run("privacy", S.x0, S.z0, S.x0, S.z1);
  run("privacy", S.x1, S.z0, S.x1, S.z1);
  run("picket", S.x0, S.z0, S.x1, S.z0, [
    [13.9, 16.9],
    [6.5, 7.6],
    [1.6, 2.7],
  ]);
  // street frontage east of the lots and the east cap behind the roadblock;
  // a chain-link gate covers the road exit itself
  run("picket", N.x1, N.z1, 30, N.z1, [], true);
  run("picket", S.x1, S.z0, 30, S.z0, [], true);
  run("privacy", 30, -5.6, 30, -3.7);
  run("privacy", 30, 3.7, 30, 5.6);
  B(29.94, -3.7, 30.06, 3.7, 0, 1.9, "#9aa2a6").hidden = true; // gate mesh panel
  // the unreachable neighbour yards: frontage pickets + privacy on the far edges
  run("picket", -30, N.z1, -18, N.z1, [], true); // pocketNW street edge
  run("picket", -30, S.z0, 1, S.z0, [], true); // pocketSW street edge
  run("privacy", -1, -31, 30, -31);
  run("privacy", 30, -31, 30, -5.6);
  run("privacy", -30, -31, -18, -31);
  run("privacy", -30, -31, -30, -5.6);
  run("privacy", -30, 31, 1, 31);
  run("privacy", -30, 5.6, -30, 31);
  run("privacy", 18, 31, 30, 31);
  run("privacy", 30, 5.6, 30, 31);
  // cul-de-sac arc: short chords round the west half of the bulb
  const bc = NUKE.bulb;
  let prev: [number, number] | null = null;
  for (let i = 0; i <= 10; i++) {
    const a = (-90 - (180 * i) / 10) * (Math.PI / 180);
    const q: [number, number] = [
      bc.x + Math.cos(a) * (bc.r + 0.35),
      bc.z + Math.sin(a) * (bc.r + 0.35),
    ];
    if (prev) {
      const [ax, az] = prev,
        [bx, bz] = q;
      // split the chord into two axis runs so the fence hugs the kerb
      const mx = (ax + bx) / 2;
      picket(Math.min(ax, mx), Math.min(az, bz) - 0.035, Math.max(ax, mx), Math.max(az, bz) + 0.035);
      picket(mx - 0.035, Math.min(az, bz), Math.max(mx, bx) + 0.035, Math.max(az, bz));
    }
    prev = q;
  }
  // house #3's picket fence across the bulb's west end (beyond the boundary arc);
  // the gate gap is closed by a hidden panel — the yard is not enterable
  run("picket", -26.6, -5.2, -26.6, 5.2, [[-1.4, 1.4]], true);
  B(-26.68, -1.4, -26.52, 1.4, 0, 1.7, "#000").hidden = true;

  // everything outside the fenced union is out of bounds for nav and spawning
  nav(-48, -48, 48, -31.3); // north desert, behind the rear fences
  nav(-48, 31.3, 48, 48); // south desert
  nav(-48, -48, -18.3, -5.4); // NW pocket (neighbour lawn + desert)
  nav(-48, -5.4, -25.6, 5.4); // house #3's yard, west of the cul-de-sac arc
  nav(-0.7, -48, 30.3, -5.4); // NE strip behind the street's north edge
  nav(-48, 5.4, 0.7, 48); // SW strip
  nav(18.3, 5.4, 30.3, 48); // SE pocket
  nav(30.3, -48, 48, 48); // beyond the east cap

  // nav blocks for street furniture, vehicles and every mannequin
  for (const v of NUKE_VEHICLES) {
    const hl = v.kind === "bus" ? 5.9 : v.kind === "truck" ? 4 : 2.5,
      hw = v.kind === "bus" ? 1.4 : 1.15;
    const c = Math.cos(v.yaw),
      s = Math.sin(v.yaw),
      ex = Math.abs(hl * s) + Math.abs(hw * c),
      ez = Math.abs(hl * c) + Math.abs(hw * s);
    nav(v.x - ex, v.z - ez, v.x + ex, v.z + ez);
  }
  for (const m of NUKE_MANNEQUINS) nav(m.x - 0.3, m.z - 0.3, m.x + 0.3, m.z + 0.3);
  for (const [x, z] of [
    [-13, -4.6], // street lamps
    [6.5, -4.6],
    [-11.5, 4.6],
    [18, 4.6],
    [-7.1, -4.35], // mailboxes
    [7.1, 4.35],
    [-0.3, -4.5], // hydrant
    [25.5, -4.8], // population sign
    [-15, -4.9], // Trinity Ave blade
    [27.5, -2], // roadblock barriers
    [27.5, 2],
    [24.6, -4.4],
  ] as const)
    nav(x - 0.35, z - 0.35, x + 0.35, z + 0.35);
  // trees, porch swings and yard props the grid must respect
  nav(-15.85, -23.85, -15.15, -23.15); // backyard tree (n)
  nav(-7.85, -20.85, -7.15, -20.15); // lawn sapling in the open yard (n)
  nav(15.15, 23.15, 15.85, 23.85);
  nav(7.15, 20.15, 7.85, 20.85);
  nav(-8.75, -8.9, -7.45, -8.2); // porch swing (n)
  nav(7.45, 8.2, 8.75, 8.9); // porch swing (s)
  nav(1.05, 24.4, 2.05, 25.5); // dog house in the back corner (s)
  nav(5.7, 7.0, 6.3, 7.6); // flag pole (s front lawn)
  nav(-6.5, -25.6, -5.3, -24.8); // mower (n)
  nav(-1.9, -23.8, -1.1, -18.2); // garden bed along the east fence (n)
  nav(1.1, 18.2, 1.9, 23.8); // garden bed (s)
  return p;
}

/** Two opposing test homes, their lots and the street boundary — one shared plan set. */
export function nuketownStructures(): Structure[] {
  return [housePlan("n"), housePlan("s"), boundaryPlan()];
}

export function nuketownMinimap(): MinimapSource {
  const base = document.createElement("canvas");
  base.width = base.height = 192;
  const c = base.getContext("2d")!;
  c.fillStyle = "#b3a582";
  c.fillRect(0, 0, 192, 192);
  c.translate(96, 96);
  c.scale(2, 2);
  const rr = (r: Rect, col: string) => {
    c.fillStyle = col;
    c.fillRect(r.x0, r.z0, r.x1 - r.x0, r.z1 - r.z0);
  };
  for (const r of [NUKE.lotN, NUKE.lotS, NUKE.pocketNE, NUKE.pocketSW, NUKE.pocketNW, NUKE.pocketSE])
    rr(r, "#8f9a66");
  rr({ x0: -23, x1: 30, z0: -3.5, z1: 3.5 }, "#5f6061");
  c.fillStyle = "#5f6061";
  c.beginPath();
  c.arc(NUKE.bulb.x, NUKE.bulb.z, NUKE.bulb.r, 0, Math.PI * 2);
  c.fill();
  rr(NUKE.houseN, HOUSE_COLORS[0]);
  rr(NUKE.garageN, "#9a9484");
  rr(mirror(NUKE.houseN), HOUSE_COLORS[1]);
  rr(mirror(NUKE.garageN), "#9a9484");
  rr(NUKE.houseW, "#c2b49a");
  rr(NUKE.backdropN, "#b8a488");
  rr(mirror(NUKE.backdropN), "#b8a488");
  rr(NUKE.shedN, "#8d8577");
  rr(mirror(NUKE.shedN), "#8d8577");
  for (const v of NUKE_VEHICLES) {
    c.save();
    c.translate(v.x, v.z);
    c.rotate(-v.yaw);
    const l = v.kind === "bus" ? 11.4 : v.kind === "truck" ? 7.8 : 4.7;
    c.fillStyle = v.color;
    c.fillRect(-l / 2, -1.15, l, 2.3);
    c.restore();
  }
  return { cells: 48, half: 48, base, land: "#b3a582", sea: null, landmark: { x: 0, z: 0 }, playHalf: 48 };
}
