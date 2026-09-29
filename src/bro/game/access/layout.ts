// Derives everything physical about one access building from its AccessSpec: the local frame
// (a along the entrance facade, d depth into the building), the lobby / car / vestibule or the
// stairwell, the doorways, the rooftop penthouse and the rooftop props. Pure data, no three.js,
// so every co-op client derives the identical building from the shared layout.
import type { Spiral } from "./spiral";
import { furnishAccess, furnishingBlocked, type FurnishingBox } from "./roomFurnishings";
import type { AccessSpec, Facing, LRect, Portal, Rect, RoofProp } from "./types";

/** player body radius used by the movement code */
export const BODY_R = 0.4;

// ---- elevator dimensions (metres) ----
export const CAR_W = 2.2; // car interior, across the doors
export const CAR_D = 1.9; // car interior, front to back
export const CAR_H = 2.6;
export const CAR_DOOR = 1.4; // clear door opening
const CAR_GAP = 0.1; // landing sill to car sill
const LOBBY_HALF = 2.3;
const LOBBY_H = 3.8;
const VEST_HALF = 1.9;
const VEST_D = 2.6;
const VEST_H = 3.0;
const WALL = 0.2;
const STRIP = 2.4; // roof walkway in front of the penthouse door
const STREET_DOOR = 1.8;
const ROOF_DOOR = 1.4;

// ---- stair dimensions ----
const FLIGHT_W = 1.3;
const WELL = 0.2; // the divider between the two flights
export const STAIR_W = FLIGHT_W * 2 + WELL;
const LAND_S = 1.8; // the landing at each storey (the roof door opens off the top one)
const LAND_N = 1.5; // the half landing
const HALL = 1.25; // entry hall between the street door and the first landing
const RISER_MAX = 0.18;
const TREAD = 0.27;
const BULK_H = 2.9;

export const LOBBY_CEIL = LOBBY_H;
export const VEST_CEIL = VEST_H;
export const BULKHEAD_H = BULK_H;

export type StairInfo = {
  spiral?: Spiral | undefined;
  /** width, landing depths, flight run (metres) */
  W: number;
  Ls: number;
  Ln: number;
  Lr: number;
  /** d where the first landing starts (behind the entry hall) */
  v0: number;
  /** storey height and steps per flight */
  h: number;
  steps: number;
  laps: number;
  /** d of the roof door centre (on the +a side wall of the top landing) */
  doorD: number;
};

export type LadderInfo = {
  /** the climb: from the ground at d = base (in front of the wall) up `rise` metres, then
   * forward along d to `land` on the deck */
  base: number;
  rise: number;
  land: number;
};

export type ElevInfo = {
  /** the car opens straight into a lookout room (no vestibule / penthouse) */
  direct: boolean;
  coreFront: number;
  car: LRect;
  lobby: LRect;
  vest: LRect;
  shaft: LRect;
  /** floor indicator: storeys shown (1 .. floors) */
  floors: number;
  /** seconds for a full lobby to roof run */
  ride: number;
};

export type AccessBuilding = {
  id: number;
  spec: AccessSpec;
  kind: AccessSpec["kind"];
  // local frame: world = o + t * a + i * d
  ox: number;
  oz: number;
  ix: number;
  iz: number;
  tx: number;
  tz: number;
  groundY: number;
  /** roof walking surface (the city draws the roof cap 2 cm over the part top) */
  top: number;
  roofL: LRect;
  footL: LRect;
  elev?: ElevInfo | undefined;
  stair?: StairInfo | undefined;
  ladder?: LadderInfo | undefined;
  /** enclosed lookout room instead of an open roof */
  room: boolean;
  /** the room's own rectangle (local; the roof zone can add a terrace) */
  roomL: LRect;
  /** clear height above the roof surface that counts as the roof zone (bullets) */
  roomH: number;
  /** [0] the street door, [1] the roof door */
  portals: [Portal, Portal];
  /** penthouse over the core (vestibule + machine room, or the stair bulkhead), local */
  pent: LRect;
  pentH: number;
  /** rooftop props (world) */
  props: RoofProp[];
  /** Opt-in closed fixture parts, shared by geometry and collision. */
  furnishings: FurnishingBox[];
  /** Structural roof obstacles and outdoor props; fixtures use their exact parts above. */
  obstacles: Rect[];
  /** world AABB of all interior spaces (lobby, car, stairwell) for culling and bullets */
  interior: Rect;
  /** the roof cap opening over the shaft / stairwell (world) */
  hole: Rect;
  /** helipad centre / radius, world (0 radius = none) */
  pad: { x: number; z: number; r: number };
  /** free roof cells for spawning (world points), precomputed */
  spots: { x: number; z: number }[];
  /** roof zone capacity (enemies at once) */
  cap: number;
};

const INWARD: Record<Facing, [number, number]> = { 0: [0, 1], 1: [-1, 0], 2: [0, -1], 3: [1, 0] };

export function frameOf(door: AccessSpec["door"]) {
  const [ix, iz] = INWARD[door.facing];
  return { ox: door.x, oz: door.z, ix, iz, tx: iz, tz: -ix };
}

type Frame = { ox: number; oz: number; ix: number; iz: number; tx: number; tz: number };

export const toWorld = (f: Frame, a: number, d: number): [number, number] => [
  f.ox + f.tx * a + f.ix * d,
  f.oz + f.tz * a + f.iz * d,
];
export const toLocal = (f: Frame, x: number, z: number): [number, number] => {
  const dx = x - f.ox;
  const dz = z - f.oz;
  return [dx * f.tx + dz * f.tz, dx * f.ix + dz * f.iz];
};
export function worldRect(f: Frame, r: LRect): Rect {
  const [x0, z0] = toWorld(f, r.a0, r.d0);
  const [x1, z1] = toWorld(f, r.a1, r.d1);
  return { x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1) };
}
export function localRect(f: Frame, r: Rect): LRect {
  const [a0, d0] = toLocal(f, r.x0, r.z0);
  const [a1, d1] = toLocal(f, r.x1, r.z1);
  return { a0: Math.min(a0, a1), a1: Math.max(a0, a1), d0: Math.min(d0, d1), d1: Math.max(d0, d1) };
}
const inside = (r: LRect, outer: LRect, m = 0, front = m) =>
  r.a0 >= outer.a0 + m && r.a1 <= outer.a1 - m && r.d0 >= outer.d0 + front && r.d1 <= outer.d1 - m;

/** seconds for a lobby-to-roof run: normal speed on short buildings, an express on towers
 * (a trapezoid profile: 1.2 s of acceleration at each end) */
export function rideTime(rise: number) {
  const v = Math.max(3, rise / 9.2);
  return rise / v + 1.2;
}
/** car floor height t seconds into a run of `total` seconds from y0 to y1 */
export function rideY(y0: number, y1: number, t: number, total: number) {
  const ta = Math.min(1.2, total / 3);
  const T = Math.max(total, 1e-3);
  const vc = 1 / (T - ta); // unit distance at cruise speed
  const tt = Math.max(0, Math.min(T, t));
  let s: number;
  if (tt < ta) s = (0.5 * vc * tt * tt) / ta;
  else if (tt > T - ta) {
    const r = T - tt;
    s = 1 - (0.5 * vc * r * r) / ta;
  } else s = 0.5 * vc * ta + vc * (tt - ta);
  return y0 + (y1 - y0) * Math.max(0, Math.min(1, s));
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Lay one building out. Returns null when the entrance, core or penthouse don't fit. */
export function layoutAccess(spec: AccessSpec, id: number): AccessBuilding | null {
  const f = frameOf(spec.door);
  const roofL = localRect(f, spec.roof);
  const footL = localRect(f, spec.footprint);
  // the door must sit on the footprint's front edge
  if (Math.abs(footL.d0) > 0.05) return null;
  const top = spec.roofY + 0.02;
  const rise = top - spec.groundY;
  if (rise < (spec.kind === "ladder" ? 1.2 : 3)) return null;
  let elev: ElevInfo | undefined;
  let stair: StairInfo | undefined;
  let pent: LRect;
  let pentH: number;
  let portals: [Portal, Portal];
  let interiorL: LRect;
  let holeL: LRect;
  const room = spec.roofKind === "room";
  // (a room with a terrace: the stairwell / shaft has to fit in the room itself)
  const fitL = room && spec.roomRect ? localRect(f, spec.roomRect) : roofL;
  let ladder: LadderInfo | undefined;
  if (spec.kind === "elevator" && room) {
    // the car opens straight into the room: the shaft stands in the room, its landing doors
    // face the front; the lobby runs in from the street door to the same shaft
    const coreFront = Math.max(fitL.d0 + 1.8, 6);
    const car: LRect = { a0: -CAR_W / 2, a1: CAR_W / 2, d0: coreFront + CAR_GAP, d1: coreFront + CAR_GAP + CAR_D };
    const shaft: LRect = { a0: car.a0 - 0.15, a1: car.a1 + 0.15, d0: coreFront, d1: car.d1 + 0.15 };
    const wide = coreFront > 12 && footL.a0 < -4.2 && footL.a1 > 4.2 ? 3.6 : LOBBY_HALF;
    const lobby: LRect = { a0: -wide, a1: wide, d0: WALL + 0.05, d1: coreFront };
    const vest: LRect = { a0: -0.7, a1: 0.7, d0: coreFront, d1: coreFront };
    pent = { a0: shaft.a0 - WALL, a1: shaft.a1 + WALL, d0: coreFront, d1: shaft.d1 + WALL };
    pentH = 0;
    const lobbyOuter: LRect = { a0: lobby.a0 - WALL, a1: lobby.a1 + WALL, d0: 0, d1: shaft.d1 + WALL };
    if (!inside(lobbyOuter, footL, 0.3, -0.01)) return null;
    if (!inside(pent, fitL, 0.2)) return null;
    if (coreFront - fitL.d0 < 1.6) return null;
    elev = { direct: true, coreFront, car, lobby, vest, shaft, floors: Math.max(2, spec.floors), ride: rideTime(rise) };
    portals = [
      { level: 0, a: 0, d: 0, na: 0, nd: -1, half: STREET_DOOR / 2, wall: WALL + 0.05 },
      { level: 1, a: 0, d: coreFront, na: 0, nd: -1, half: 0.7, wall: 0, inn: 0, open: true },
    ];
    interiorL = { a0: lobbyOuter.a0, a1: lobbyOuter.a1, d0: 0, d1: lobbyOuter.d1 };
    holeL = { a0: shaft.a0 - 0.05, a1: shaft.a1 + 0.05, d0: shaft.d0 - 0.05, d1: shaft.d1 + 0.05 };
  } else if (spec.kind === "ladder") {
    // climb the wall face at a = 0 from the ground to the deck edge, step forward onto it
    const land = roofL.d0 + 0.25;
    if (roofL.a0 > -0.6 || roofL.a1 < 0.6 || roofL.d1 < land + 1.2) return null;
    ladder = { base: -0.45, rise, land };
    pent = { a0: 0, a1: 0, d0: land, d1: land };
    pentH = 0;
    portals = [
      { level: 0, a: 0, d: 0, na: 0, nd: -1, half: 0.4, wall: 0, open: true },
      { level: 1, a: 0, d: land, na: 0, nd: 1, half: 0.45, wall: 0, open: true },
    ];
    interiorL = { a0: -0.6, a1: 0.6, d0: -0.9, d1: land + 0.4 };
    holeL = { a0: 0, a1: 0, d0: 0, d1: 0 };
  } else if (spec.kind === "elevator") {
    const coreFront = Math.max(roofL.d0 + STRIP + VEST_D + WALL, 6);
    const car: LRect = {
      a0: -CAR_W / 2,
      a1: CAR_W / 2,
      d0: coreFront + CAR_GAP,
      d1: coreFront + CAR_GAP + CAR_D,
    };
    const shaft: LRect = { a0: car.a0 - 0.15, a1: car.a1 + 0.15, d0: coreFront, d1: car.d1 + 0.15 };
    // a long run in from the street (a podium tower) gets a grand lobby, if the podium is wide
    const wide = coreFront > 12 && footL.a0 < -4.2 && footL.a1 > 4.2 ? 3.6 : LOBBY_HALF;
    const lobby: LRect = { a0: -wide, a1: wide, d0: WALL + 0.05, d1: coreFront };
    const vest: LRect = { a0: -VEST_HALF, a1: VEST_HALF, d0: coreFront - VEST_D, d1: coreFront };
    pent = { a0: -VEST_HALF - WALL, a1: VEST_HALF + WALL, d0: vest.d0 - WALL, d1: shaft.d1 + WALL };
    pentH = CAR_H + 1.6;
    // the ground floor has to hold the lobby and the shaft, the roof the penthouse
    const lobbyOuter: LRect = { a0: lobby.a0 - WALL, a1: lobby.a1 + WALL, d0: 0, d1: shaft.d1 + WALL };
    if (!inside(lobbyOuter, footL, 0.3, -0.01)) return null;
    if (!inside(pent, roofL, 0)) return null;
    // a walkway all the way round the penthouse (the roof is one loop, not two dead ends)
    if (pent.a0 - roofL.a0 < 1.8 || roofL.a1 - pent.a1 < 1.8 || roofL.d1 - pent.d1 < 1.6) return null;
    const floors = Math.max(2, spec.floors);
    elev = { direct: false, coreFront, car, lobby, vest, shaft, floors, ride: rideTime(rise) };
    portals = [
      { level: 0, a: 0, d: 0, na: 0, nd: -1, half: STREET_DOOR / 2, wall: WALL + 0.05 },
      { level: 1, a: 0, d: vest.d0 - WALL, na: 0, nd: -1, half: ROOF_DOOR / 2, wall: WALL },
    ];
    interiorL = { a0: lobbyOuter.a0, a1: lobbyOuter.a1, d0: 0, d1: lobbyOuter.d1 };
    holeL = { a0: shaft.a0 - 0.05, a1: shaft.a1 + 0.05, d0: vest.d0 - 0.05, d1: shaft.d1 + 0.05 };
  } else {
    // stairs (ladders use the same stairwell core today; see the report)
    const laps = Math.max(1, spec.floors);
    const h = rise / laps;
    const isSpiral = spec.stairStyle === "spiral";
    const steps = Math.ceil(h / (isSpiral ? 1 : 2) / RISER_MAX);
    const radius = 1.9;
    const gap = 0.65;
    const Lr = isSpiral ? radius * (1 + Math.cos(gap)) : steps * TREAD;
    const v0 = isSpiral ? Math.max(HALL + WALL + 0.05, fitL.d0 + WALL + .05) : HALL + WALL + 0.05;
    const W = isSpiral ? radius * 2 : STAIR_W;
    const Ln = isSpiral ? 0 : LAND_N;
    const depth = v0 + LAND_S + Lr + Ln;
    stair = { W, Ls: LAND_S, Ln, Lr, v0, h, steps, laps, doorD: v0 + LAND_S / 2,
      spiral: isSpiral ? { inner: 0.3, outer: radius, centerD: v0 + LAND_S + radius * Math.cos(gap), gap } : undefined };
    pent = { a0: -W / 2 - WALL, a1: W / 2 + WALL, d0: v0 - WALL, d1: depth + WALL };
    pentH = room ? 0 : BULK_H + 0.25;
    const outer: LRect = { a0: -W / 2 - WALL, a1: W / 2 + WALL, d0: 0, d1: depth + WALL };
    if (!inside(outer, footL, 0.3, -0.01)) return null;
    if (!inside(pent, fitL, 0)) return null;
    // the roof door opens on the +a side: it needs a walkway there
    if (fitL.a1 - pent.a1 < (room ? 1.3 : 2.4) || pent.a0 - fitL.a0 < 0) return null;
    // no squeeze gaps: the far side is either flush with the parapet or a real walkway
    const far = pent.a0 - roofL.a0;
    if (!room && far > 0.05 && far < 1.6) return null;
    if (!room && roofL.d1 - pent.d1 < 1.6) return null;
    portals = [
      { level: 0, a: 0, d: 0, na: 0, nd: -1, half: 0.75, wall: WALL + 0.05 },
      room
        ? // in a lookout room the top landing simply opens onto the floor (a railed stairwell)
          { level: 1, a: W / 2, d: stair.doorD, na: 1, nd: 0, half: 0.8, wall: 0, open: true }
        : { level: 1, a: W / 2 + WALL, d: stair.doorD, na: 1, nd: 0, half: 0.65, wall: WALL },
    ];
    interiorL = outer;
    holeL = { a0: -W / 2 - 0.05, a1: W / 2 + 0.05, d0: v0 - 0.05, d1: depth + 0.05 };
  }
  const b: AccessBuilding = {
    id,
    spec,
    kind: spec.kind,
    ...f,
    groundY: spec.groundY,
    top,
    roofL,
    footL,
    elev,
    stair,
    ladder,
    room,
    roomL: spec.roomRect ? localRect(f, spec.roomRect) : roofL,
    roomH: room ? (spec.roomH ?? 3) : 8,
    portals,
    pent,
    pentH,
    props: [],
    furnishings: [],
    obstacles: [...(pent.a1 > pent.a0 ? [worldRect(f, pent)] : []), ...(spec.hostObstacles ?? []), ...terraceWall(spec)],
    interior: worldRect(f, interiorL),
    hole: worldRect(f, holeL),
    pad: { x: 0, z: 0, r: 0 },
    spots: [],
    cap: 4,
  };
  b.furnishings = furnishAccess(b);
  if (spec.dressing ?? (!room && spec.kind !== "ladder")) dressRoof(b);
  else findSpots(b);
  return b;
}

/** the room wall between a room and its terrace, as solid pieces either side of the door */
function terraceWall(spec: AccessSpec): Rect[] {
  const t = spec.terrace;
  if (!t) return [];
  const w = t.wall;
  const alongX = w.x1 - w.x0 > w.z1 - w.z0;
  const [d0, d1] = t.door;
  return alongX
    ? [
        { x0: w.x0, z0: w.z0, x1: d0, z1: w.z1 },
        { x0: d1, z0: w.z0, x1: w.x1, z1: w.z1 },
      ]
    : [
        { x0: w.x0, z0: w.z0, x1: w.x1, z1: d0 },
        { x0: w.x0, z0: d1, x1: w.x1, z1: w.z1 },
      ];
}

/** spawn spots on an undressed roof / room (free points with body clearance) */
function findSpots(b: AccessBuilding) {
  const R = b.spec.roof;
  for (let x = R.x0 + 0.8; x < R.x1 - 0.8; x += 1)
    for (let z = R.z0 + 0.8; z < R.z1 - 0.8; z += 1) {
      if (b.obstacles.some((o) => x > o.x0 - 0.9 && x < o.x1 + 0.9 && z > o.z0 - 0.9 && z < o.z1 + 0.9)) continue;
      const [a, d] = toLocal(b, x, z);
      if (furnishingBlocked(b, 1, a, d, 0.9, b.top, b.top + 1.8)) continue;
      b.spots.push({ x, z });
    }
  // small decks and rooms hold a few (a lifeguard deck none: nobody spawns on top of you)
  b.cap = Math.min(8, Math.floor(b.spots.length / 10));
}

/**
 * Rooftop props: AC units, water tanks, masts, vents, a helipad on big tower roofs, parked
 * cars on a garage deck. They keep a 1.2 m walkway round the parapet and never cut the roof
 * in two (each one is checked against a flood fill from the penthouse door).
 */
function dressRoof(b: AccessBuilding) {
  const s = b.spec;
  const r = mulberry(s.seed ^ 0x5eed);
  const R = s.roof;
  const G = 0.5; // occupancy grid
  const nx = Math.max(1, Math.floor((R.x1 - R.x0) / G));
  const nz = Math.max(1, Math.floor((R.z1 - R.z0) / G));
  const occ = new Uint8Array(nx * nz); // 1 = prop / penthouse, 2 = keep clear
  const cellOf = (x: number, z: number) => [Math.floor((x - R.x0) / G), Math.floor((z - R.z0) / G)] as const;
  const mark = (q: Rect, v: number) => {
    const [i0, j0] = cellOf(q.x0, q.z0);
    const [i1, j1] = cellOf(q.x1 - 1e-6, q.z1 - 1e-6);
    for (let i = Math.max(0, i0); i <= Math.min(nx - 1, i1); i++)
      for (let j = Math.max(0, j0); j <= Math.min(nz - 1, j1); j++)
        if (v === 1 || !occ[i * nz + j]) occ[i * nz + j] = v;
  };
  const free = (q: Rect) => {
    const [i0, j0] = cellOf(q.x0, q.z0);
    const [i1, j1] = cellOf(q.x1 - 1e-6, q.z1 - 1e-6);
    if (i0 < 0 || j0 < 0 || i1 >= nx || j1 >= nz) return false;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) if (occ[i * nz + j]) return false;
    return true;
  };
  // the penthouse (with a walkable margin round it), a clear apron in front of its roof door,
  // a walkway round the parapet
  const pw = worldRect(b, b.pent);
  mark({ x0: pw.x0 - 1.1, z0: pw.z0 - 1.1, x1: pw.x1 + 1.1, z1: pw.z1 + 1.1 }, 2);
  mark(pw, 1);
  const p1 = b.portals[1];
  const apron: LRect =
    p1.na !== 0
      ? { a0: p1.a, a1: p1.a + 2.6, d0: p1.d - 1.6, d1: p1.d + 1.6 }
      : { a0: p1.a - 1.6, a1: p1.a + 1.6, d0: p1.d - 2.6, d1: p1.d };
  mark(worldRect(b, apron), 2);
  const walk = 1.6;
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++) {
      const x = R.x0 + (i + 0.5) * G;
      const z = R.z0 + (j + 0.5) * G;
      if (x - R.x0 < walk || R.x1 - x < walk || z - R.z0 < walk || R.z1 - z < walk)
        if (!occ[i * nz + j]) occ[i * nz + j] = 2;
    }
  // helipad: the biggest free disc near the roof centre
  const rw = R.x1 - R.x0;
  const rd = R.z1 - R.z0;
  if (s.helipad && Math.min(rw, rd) >= 20) {
    const rad = Math.min(8.5, Math.min(rw, rd) * 0.3);
    for (let k = 0; k < 40; k++) {
      const cx = R.x0 + rad + 1.4 + r() * Math.max(0, rw - 2 * rad - 2.8);
      const cz = R.z0 + rad + 1.4 + r() * Math.max(0, rd - 2 * rad - 2.8);
      const q = { x0: cx - rad, z0: cz - rad, x1: cx + rad, z1: cz + rad };
      if (!free({ x0: q.x0 + 1.2, z0: q.z0 + 1.2, x1: q.x1 - 1.2, z1: q.z1 - 1.2 })) continue;
      b.pad = { x: cx, z: cz, r: rad };
      mark(q, 2);
      break;
    }
  }
  const [dx, dz] = toWorld(b, p1.a + p1.na * 1.4, p1.d + p1.nd * 1.4);
  const connected = () => {
    const [si, sj] = cellOf(dx, dz);
    if (si < 0 || sj < 0 || si >= nx || sj >= nz) return false;
    // walkable = no prop within a body radius (one cell each way)
    const ok = (i: number, j: number) => {
      for (let a = -1; a <= 1; a++)
        for (let c = -1; c <= 1; c++) {
          const ii = i + a;
          const jj = j + c;
          if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) return false;
          if (occ[ii * nz + jj] === 1) return false;
        }
      return true;
    };
    const seen = new Uint8Array(nx * nz);
    const q = [si * nz + sj];
    seen[q[0]!] = 1;
    let n = 0;
    for (let h = 0; h < q.length; h++) {
      const c = q[h]!;
      n++;
      const i = Math.floor(c / nz);
      const j = c - i * nz;
      for (const [a, cc] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const ii = i + a;
        const jj = j + cc;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
        const k = ii * nz + jj;
        if (seen[k] || !ok(ii, jj)) continue;
        seen[k] = 1;
        q.push(k);
      }
    }
    let total = 0;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) if (ok(i, j)) total++;
    return n >= total - 1;
  };
  const place = (p: RoofProp) => {
    const q = { x0: p.x - p.w / 2, z0: p.z - p.d / 2, x1: p.x + p.w / 2, z1: p.z + p.d / 2 };
    if (!free(q)) return false;
    const snap = occ.slice();
    // a halo keeps props a body-width-and-more apart (no squeeze gaps between them)
    mark({ x0: q.x0 - 0.6, z0: q.z0 - 0.6, x1: q.x1 + 0.6, z1: q.z1 + 0.6 }, 2);
    mark(q, 1);
    if (!connected()) {
      occ.set(snap);
      return false;
    }
    b.props.push(p);
    if (p.solid) b.obstacles.push(q);
    return true;
  };
  const area = rw * rd;
  const tall = s.roofY > 60;
  const garage = s.name?.startsWith("garage");
  if (garage) {
    // deck lights down the middle
    const alongX0 = rw >= rd;
    for (const f of [0.25, 0.75]) {
      const x = alongX0 ? R.x0 + rw * f : (R.x0 + R.x1) / 2;
      const z = alongX0 ? (R.z0 + R.z1) / 2 : R.z0 + rd * f;
      place({ kind: "lamp", x, z, w: 0.5, d: 0.5, h: 6, solid: true });
    }
    // parked cars along the deck, nose to the parapet: cover for a rooftop fight
    for (let k = 0; k < 14; k++) {
      const alongX = rw >= rd;
      const w = alongX ? 1.9 : 4.5;
      const d = alongX ? 4.5 : 1.9;
      const x = R.x0 + walk + 0.2 + w / 2 + r() * Math.max(0, rw - 2 * walk - w - 0.4);
      const z = R.z0 + walk + 0.2 + d / 2 + r() * Math.max(0, rd - 2 * walk - d - 0.4);
      place({ kind: "car", x, z, w, d, h: 1.45, rot: alongX ? 0 : 1, solid: true });
    }
  }
  const nAc = Math.min(7, 2 + Math.floor(area / 160 + r() * 2));
  for (let k = 0, tries = 0; k < nAc && tries < 60; tries++) {
    const w = 1.4 + r() * 1.4;
    const d = 1.0 + r() * 0.9;
    const x = R.x0 + w / 2 + r() * (rw - w);
    const z = R.z0 + d / 2 + r() * (rd - d);
    if (place({ kind: "ac", x, z, w, d, h: 1.25 + r() * 0.6, rot: r() < 0.5 ? 1 : 0, solid: true })) k++;
  }
  if ((!tall || r() < 0.4) && area > 120) {
    for (let tries = 0; tries < 20; tries++) {
      const x = R.x0 + 2 + r() * (rw - 4);
      const z = R.z0 + 2 + r() * (rd - 4);
      if (place({ kind: "tank", x, z, w: 3.4, d: 3.4, h: 6.2, solid: true })) break;
    }
  }
  const nVent = Math.min(6, 1 + Math.floor(area / 120));
  for (let k = 0, tries = 0; k < nVent && tries < 30; tries++) {
    const x = R.x0 + 0.5 + r() * (rw - 1);
    const z = R.z0 + 0.5 + r() * (rd - 1);
    if (place({ kind: r() < 0.5 ? "vent" : "skylight", x, z, w: 0.9, d: 0.9, h: 0.9, solid: true })) k++;
  }
  if (tall) {
    for (let k = 0, tries = 0; k < 2 && tries < 20; tries++) {
      const x = R.x0 + 0.5 + r() * (rw - 1);
      const z = R.z0 + 0.5 + r() * (rd - 1);
      if (place({ kind: "mast", x, z, w: 0.7, d: 0.7, h: 8 + r() * 14, solid: true })) k++;
    }
  }
  // a couple of crates by the penthouse, as waist-high cover
  for (let k = 0, tries = 0; k < 2 && tries < 20; tries++) {
    const x = R.x0 + 0.6 + r() * (rw - 1.2);
    const z = R.z0 + 0.6 + r() * (rd - 1.2);
    if (place({ kind: "crate", x, z, w: 1.2, d: 1.2, h: 1.1, solid: true })) k++;
  }
  // spawn spots: free roof points with body clearance, 1 m apart
  for (let x = R.x0 + 0.8; x < R.x1 - 0.8; x += 1) {
    for (let z = R.z0 + 0.8; z < R.z1 - 0.8; z += 1) {
      if (b.obstacles.some((o) => x > o.x0 - 0.9 && x < o.x1 + 0.9 && z > o.z0 - 0.9 && z < o.z1 + 0.9)) continue;
      b.spots.push({ x, z });
    }
  }
  b.cap = Math.min(Math.floor(b.spots.length / 6), Math.max(3, Math.min(12, Math.floor(b.spots.length / 14))));
}

// ---- thin props (level.ts posts: lamp posts, sign poles, benches) and access doors ----

type PostLike = { x: number; z: number; r: number };
const OUT: Record<Facing, [number, number]> = { 0: [0, -1], 1: [1, 0], 2: [0, 1], 3: [-1, 0] };

/** is the walk up to a door at (x, z) facing `f` free of thin props? (1.3 m either side of
 * the door's centre line, from the wall out to 3.5 m) */
export function doorwayClear(posts: readonly PostLike[], x: number, z: number, f: Facing) {
  const [nx, nz] = OUT[f];
  for (const p of posts) {
    const out = (p.x - x) * nx + (p.z - z) * nz;
    const lat = Math.abs((p.x - x) * nz - (p.z - z) * nx);
    if (out > -0.5 - p.r && out < 3.5 + p.r && lat < 1.3 + p.r) return false;
  }
  return true;
}
