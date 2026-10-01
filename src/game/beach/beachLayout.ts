import { wheelGround, wheelPoint, type Wheel } from "./wheelRide";
import { beachDoorApproach, beachStallBounds, swimLineBuoys } from "./doorways";
import {
  BEACH_MAT_Z,
  beachPropBounds,
  overlaps,
  planBeachActivity,
  type BeachActivity,
} from "./beachActivity";
// Pacific Pier: a deterministic, real-scale Southern California beach town (1 unit = 1 m,
// 2 m collision cells). Pure data, no three.js, so every co-op client builds the identical
// map from the seed.
//
// The coast runs north-south; the Pacific is to the WEST (-x), so the sun sets at the end of
// the pier. West to east (x, metres):
//   -400..-104 deep ocean (not walkable)   -104..-68 surf (wading, slow)   -68..-36 wet sand
//   -36..96 dry sand (slow)                96..120 park strip (skate park, Muscle Beach, courts)
//   120..128 bike path                     128..148 promenade (vendors, palms)
//   148..192 shops, motels, taco stands    192..232 PCH (sidewalks + 4 lanes, centre x 214)
//   232..260 the bluff (a steep planted slope, 16 m high)   260+ clifftop park, Ocean Ave, houses
// The pier runs out along z = 0 from the promenade to x = -236, its deck 6.5 m up.
//
// The ground is 2.5D: every walkable cell has one height (see terrain.ts). Raised structures
// (pier decks, ramps, stairs) are regions; wherever a region's edge drops more than a step to
// its neighbour the higher cell becomes a railing (solid), so heights are continuous across
// every open edge by construction.
import type { Block } from "../level";
import {
  K_BOARD,
  K_LOT,
  K_OPEN,
  K_PARK,
  K_PARKLANE,
  K_PATH,
  K_ROAD,
  K_WALK,
  type CityLayout,
  type Road,
} from "../cityLayout";
import { findGaps, sealGaps, soloHalf, type Gap } from "../soloBounds";
import { makeVehicle, type Vehicle } from "../vehicles";

// ---- extra cell kinds (the city's K_* codes are reused for roads, walks, lots, decks) ----
export const K_SAND = 20;
export const K_WET = 21;
export const K_SURF = 22;
export const K_SEA = 23;
export const K_BIKE = 24;
export const K_PROM = 25;
export const K_SKATE = 26;
export const K_BLUFF = 27;
export const K_COURT = 28;
export const K_DECK = K_BOARD;

/** minimap colours per cell kind */
export const BEACH_PALETTE: Record<number, [number, number, number]> = {
  [K_ROAD]: [70, 72, 78],
  [K_PARKLANE]: [82, 84, 90],
  [K_WALK]: [196, 188, 172],
  [K_PARK]: [118, 160, 86],
  [K_PATH]: [210, 192, 150],
  [K_OPEN]: [96, 98, 104],
  [K_LOT]: [150, 140, 124],
  [K_BOARD]: [150, 104, 64],
  [K_SAND]: [236, 214, 160],
  [K_WET]: [196, 170, 124],
  [K_SURF]: [104, 170, 190],
  [K_SEA]: [79, 143, 176],
  [K_BIKE]: [96, 110, 120],
  [K_PROM]: [171, 139, 98],
  [K_SKATE]: [190, 190, 186],
  [K_BLUFF]: [128, 120, 84],
  [K_COURT]: [70, 120, 150],
};

// ---- the fixed cross-section ----
export const DECK = 6.5;
export const SEA = -1.0;
export const WADING_DEPTH = 0.9;
export const SURF_FLOOR = SEA - WADING_DEPTH;
export const OFFSHORE_X = -148;
export const OFFSHORE_FLOOR = -3;
export const BLUFF_H = 16;
export const X = {
  seal: -106,
  surf: -104,
  wet: -68,
  dry: -36,
  strip: 96,
  bike: 120,
  prom: 128,
  shops: 148,
  walkW: 192,
  road0: 204,
  road1: 224,
  walkE: 232,
  bluff: 232,
  top: 260,
  ave0: 300,
  ave1: 324,
} as const;
export const ROAD_C = 214;
/** z of the tunnel junctions where PCH traffic turns into the bluff */
export const TUNNEL_Z = [272, 388];

export type Rect = { x0: number; z0: number; x1: number; z1: number };
export type Region = Rect & { kind: "flat" | "rampX" | "rampZ"; h0: number; h1: number };
/** a ground dip (skate bowl) or bump (funbox); depth > 0 dips */
export type Mod =
  | { t: "ell"; x: number; z: number; rx: number; rz: number; depth: number }
  | { t: "cap"; ax: number; az: number; bx: number; bz: number; r: number; depth: number }
  | { t: "box"; x0: number; z0: number; x1: number; z1: number; h: number; ramp: number }
  /** a walkable quarter pipe: curves up from its open `face` side to a flat deck `h` high */
  | {
      t: "qp";
      x0: number;
      z0: number;
      x1: number;
      z1: number;
      face: 0 | 1 | 2 | 3;
      h: number;
      run: number;
    };

/** height of a quarter pipe's surface `d` metres in from its open edge */
export const qpHeight = (h: number, run: number, d: number) =>
  d <= 0 ? 0 : d >= run ? h : h * Math.pow(d / run, 1.7);
/** distance in from a quarter pipe's open edge (negative outside it) */
export function qpDepth(
  m: { x0: number; z0: number; x1: number; z1: number; face: number },
  x: number,
  z: number,
) {
  return m.face === 3 ? x - m.x0 : m.face === 1 ? m.x1 - x : m.face === 2 ? m.z1 - z : z - m.z0;
}

/** a flat pad the ground eases onto (parking, the skate park, buildings on the sand) */
export type Pad = Rect & { h: number; ramp: number };
export function applyPads(pads: Pad[], x: number, z: number, h: number) {
  for (const p of pads) {
    const e = Math.max(p.x0 - x, 0, x - p.x1, p.z0 - z, 0, z - p.z1);
    if (e >= p.ramp) continue;
    const t = Math.min(1, e / p.ramp);
    h += (p.h - h) * (1 - t * t * (3 - 2 * t));
  }
  return h;
}

export type BType =
  | "shop"
  | "surf"
  | "taco"
  | "cafe"
  | "arcade"
  | "motel"
  | "hotel"
  | "restroom"
  | "hq"
  | "house"
  | "restaurant"
  | "harbor"
  | "stall"
  | "station"
  | "camera";
export type BBld = Rect & {
  interior?: import("../structures/plan").Structure;
  t: BType;
  /** base height (deck buildings sit on the pier) */
  y0: number;
  h: number;
  floors: number;
  /** street side: 0 -z, 1 +x, 2 +z, 3 -x */
  front: 0 | 1 | 2 | 3;
  seed: number;
  tone: number;
  /** sign word index into the beach sign atlas (-1 = none) */
  sign: number;
  backdrop?: boolean;
  /** set by the building-access system (access/beachAccess.ts): the renderer leaves its roof
   * clear (no loose AC boxes) and skips the storefront dressing on the door side */
  access?: boolean;
};

export type PropKind =
  | "palm"
  | "palmS"
  | "lamp"
  | "globe"
  | "bench"
  | "trash"
  | "umbrella"
  | "towel"
  | "board"
  | "firering"
  | "net"
  | "tower"
  | "cart"
  | "table"
  | "rack"
  | "bars"
  | "rings"
  | "hoop"
  | "swing"
  | "rail"
  | "ledge"
  | "streetlight"
  | "busstop"
  | "flag"
  | "rod"
  | "scope"
  | "buoy"
  | "shower"
  | "mat"
  | "bike"
  | "cooler"
  | "bush"
  | "tree"
  | "hydrant"
  | "sign66"
  | "booth";
export type BProp = {
  k: PropKind;
  x: number;
  z: number;
  y: number;
  rot: number;
  s?: number;
  c?: number;
};
export type Parked = { x: number; z: number; y: number; rot: number; v: Vehicle };
/** blockade dressing pieces, placed along a sealed gap */
export type BlockKind =
  | "aframe"
  | "tape"
  | "truck"
  | "police"
  | "jersey"
  | "cone"
  | "fence"
  | "sandbag"
  | "buoyline"
  | "sign"
  | "arrowboard"
  | "boat";
export type Blockade = {
  k: BlockKind;
  x: number;
  z: number;
  y: number;
  rot: number;
  /** the side facing the playable area (0 -z, 1 +x, 2 +z, 3 -x) */
  face: 0 | 1 | 2 | 3;
  w?: number;
  label?: number;
};

export type BeachData = {
  regions: Region[];
  pads: Pad[];
  /** region index per cell (-1 = natural ground) */
  regionOf: Int16Array;
  mods: Mod[];
  /** per cell: solid obstacle vertical extent for projectiles (top < bot = nothing) */
  pBot: Float32Array;
  pTop: Float32Array;
  /** 1 where the cell is deep ocean (never walkable) */
  deep: Uint8Array;
  buildings: BBld[];
  props: BProp[];
  parked: Parked[];
  blockades: Blockade[];
  gaps: Gap[];
  /** the solo square's half-size (null in co-op) */
  soloHalf: number | null;
  /** rot: the disc's turn about y (its normal is (sin rot, 0, cos rot)) */
  wheel: { x: number; z: number; y: number; r: number; rot: number };
  coaster: { pts: [number, number, number][]; station: Rect };
  carousel: { x: number; z: number; r: number };
  drop: { x: number; z: number; h: number };
  /** stairs and ramps (for the renderer: treads + railings) */
  stairs: (Rect & { axis: "x" | "z"; h0: number; h1: number })[];
  /** lifeguard towers (x, z, facing) */
  towers: { x: number; z: number; rot: number; n: number }[];
  firesLit: { x: number; z: number }[];
  activity: BeachActivity;
  skate: Rect;
  /** quarter pipes: footprint + the side the ramp faces (0 -z, 1 +x, 2 +z, 3 -x) */
  qpipes: (Rect & { face: 0 | 1 | 2 | 3 })[];
  gym: Rect;
  courts: Rect;
  lot: Rect;
};

export type BeachLayout = CityLayout & {
  beach: BeachData;
  palette: Record<number, [number, number, number]>;
  /** everything west of this x is ocean (the minimap paints it) */
  seaX: number;
  soloHalf: number | null;
  spawnYaw: number;
};

export const isBeach = (c: CityLayout | null | undefined): c is BeachLayout => !!c && "beach" in c;

// ---------------------------------------------------------------------------------------

const STEP = 0.9; // tallest height change between open neighbours before a railing goes in

/** Natural ground (no structures, no bowls): the beach profile, the town level and the clifftop. */
export function baseProfile(x: number, z: number): number {
  if (x < OFFSHORE_X) return OFFSHORE_FLOOR;
  if (x < X.surf)
    return (
      OFFSHORE_FLOOR + ((x - OFFSHORE_X) / (X.surf - OFFSHORE_X)) * (SURF_FLOOR - OFFSHORE_FLOOR)
    );
  if (x < X.wet) return SURF_FLOOR + ((x - X.surf) / (X.wet - X.surf)) * (-0.95 - SURF_FLOOR);
  if (x < X.dry) return -0.95 + ((x - X.wet) / (X.dry - X.wet)) * 0.35; // -0.95 .. -0.6
  if (x < X.strip) {
    const t = (x - X.dry) / (X.strip - X.dry);
    // low dunes, fading out at both edges so the wet sand and the park strip meet cleanly
    const fade = Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
    const dune = 0.22 * Math.sin(x * 0.061 + z * 0.017) * Math.sin(z * 0.043 + 1.3) * fade;
    return -0.6 + t * 0.6 + dune;
  }
  if (x < X.bluff) return 0;
  if (x < X.top) return BLUFF_H * smooth((x - X.bluff) / (X.top - X.bluff));
  return BLUFF_H;
}
const smooth = (t: number) => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

export function modHeight(m: Mod, x: number, z: number): number {
  if (m.t === "ell") {
    const r = Math.hypot((x - m.x) / m.rx, (z - m.z) / m.rz);
    if (r >= 1) return 0;
    return -m.depth * (1 - smooth((r - 0.45) / 0.55));
  }
  if (m.t === "cap") {
    const dx = m.bx - m.ax;
    const dz = m.bz - m.az;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - m.ax) * dx + (z - m.az) * dz) / l2));
    const d = Math.hypot(x - (m.ax + dx * t), z - (m.az + dz * t)) / m.r;
    if (d >= 1) return 0;
    return -m.depth * (1 - smooth((d - 0.35) / 0.65));
  }
  // funbox: flat top with sloped sides of run `ramp`
  const ex = Math.max(m.x0 - x, 0, x - m.x1);
  const ez = Math.max(m.z0 - z, 0, z - m.z1);
  const e = Math.max(ex, ez);
  if (m.t === "qp") {
    if (x < m.x0 || x > m.x1 || z < m.z0 || z > m.z1) return 0;
    return qpHeight(m.h, m.run, qpDepth(m, x, z));
  }
  if (e >= m.ramp) return 0;
  return m.h * (1 - e / m.ramp);
}

export function regionHeight(r: Region, x: number, z: number) {
  if (r.kind === "flat") return r.h0;
  if (r.kind === "rampX") {
    const t = Math.max(0, Math.min(1, (x - r.x0) / (r.x1 - r.x0)));
    return r.h0 + (r.h1 - r.h0) * t;
  }
  const t = Math.max(0, Math.min(1, (z - r.z0) / (r.z1 - r.z0)));
  return r.h0 + (r.h1 - r.h0) * t;
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build Pacific Pier. `cells` x `cells` 2 m cells centred on the origin (`half` metres to each
 * edge). `solo` seals the 70% playable square with blockades; the map itself is identical.
 */
export function* generateBeach(
  rand: () => number,
  cells: number,
  half: number,
  solo: boolean,
): Generator<void, { layout: BeachLayout; blocks: Block[] }, void> {
  const n = cells;
  const N = n * n;
  const kind = new Uint8Array(N).fill(K_SAND);
  const solid = new Uint8Array(N);
  const regionOf = new Int16Array(N).fill(-1);
  const pBot = new Float32Array(N).fill(1);
  const pTop = new Float32Array(N).fill(0);
  const deep = new Uint8Array(N);
  const regions: Region[] = [];
  const mods: Mod[] = [];
  const pads: Pad[] = [];
  const buildings: BBld[] = [];
  const props: BProp[] = [];
  const parked: Parked[] = [];
  const stairs: BeachData["stairs"] = [];
  const towers: BeachData["towers"] = [];
  const firesLit: BeachData["firesLit"] = [];
  const r = mulberry(Math.floor(rand() * 1e9));

  const ci = (x: number) => Math.floor((x + half) / 2);
  const cx = (i: number) => -half + 1 + i * 2;
  const inside = (i: number, j: number) => i >= 0 && j >= 0 && i < n && j < n;
  /** cells whose centre lies in the rect */
  const each = (rc: Rect, f: (i: number, j: number, k: number) => void) => {
    const i0 = Math.max(0, Math.ceil((rc.x0 + half - 1) / 2 - 1e-6));
    const i1 = Math.min(n - 1, Math.floor((rc.x1 + half - 1) / 2 - 1e-6));
    const j0 = Math.max(0, Math.ceil((rc.z0 + half - 1) / 2 - 1e-6));
    const j1 = Math.min(n - 1, Math.floor((rc.z1 + half - 1) / 2 - 1e-6));
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) f(i, j, i * n + j);
  };
  const paint = (rc: Rect, k: number) => each(rc, (_i, _j, c) => (kind[c] = k));
  const solidify = (rc: Rect, bot: number, top: number) =>
    each(rc, (_i, _j, c) => {
      solid[c] = 1;
      pBot[c] = bot;
      pTop[c] = top;
    });
  const rect = (x0: number, z0: number, x1: number, z1: number): Rect => ({ x0, z0, x1, z1 });
  const addRegion = (rg: Region, k = K_DECK) => {
    const idx = regions.length;
    regions.push(rg);
    each(rg, (_i, _j, c) => {
      regionOf[c] = idx;
      kind[c] = k;
      deep[c] = 0;
    });
    return idx;
  };
  let wheel: Wheel | null = null;
  const heightAt = (x: number, z: number) => {
    const platform = wheel && wheelGround(wheel, x, z);
    if (platform !== null) return platform;
    const i = ci(x);
    const j = ci(z);
    const rg = inside(i, j) ? regionOf[i * n + j]! : -1;
    if (rg >= 0) return regionHeight(regions[rg]!, x, z);
    let h = baseProfile(x, z);
    h = applyPads(pads, x, z, h);
    for (const m of mods) h += modHeight(m, x, z);
    return h;
  };
  const prop = (k: PropKind, x: number, z: number, rot = 0, s?: number, c?: number) =>
    props.push({
      k,
      x,
      z,
      y: heightAt(x, z),
      rot,
      ...(s !== undefined ? { s } : {}),
      ...(c !== undefined ? { c } : {}),
    });
  const free = (x0: number, z0: number, x1: number, z1: number) => {
    let ok = true;
    each(rect(x0, z0, x1, z1), (_i, _j, c) => {
      if (solid[c] || regionOf[c]! >= 0) ok = false;
    });
    return ok;
  };

  // ---- 1. the cross-section bands ----
  for (let i = 0; i < n; i++) {
    const x = cx(i);
    let k: number = K_SAND;
    if (x < X.surf) k = K_SEA;
    else if (x < X.wet) k = K_SURF;
    else if (x < X.dry) k = K_WET;
    else if (x < X.strip) k = K_SAND;
    else if (x < X.bike) k = K_PARK;
    else if (x < X.prom) k = K_BIKE;
    else if (x < X.shops) k = K_PROM;
    else if (x < X.walkW) k = K_WALK;
    else if (x < X.road0) k = K_WALK;
    else if (x < X.road1) k = K_ROAD;
    else if (x < X.walkE) k = K_WALK;
    else if (x < X.top) k = K_BLUFF;
    else if (x < X.ave0) k = K_PARK;
    else if (x < X.ave1) k = K_ROAD;
    else k = K_PARK;
    for (let j = 0; j < n; j++) {
      const c = i * n + j;
      kind[c] = k;
      if (x < X.surf) deep[c] = 1;
    }
    yield;
  }
  // parking lanes along PCH
  paint(rect(X.road0, -half, X.road0 + 2, half), K_PARKLANE);
  paint(rect(X.road1 - 2, -half, X.road1, half), K_PARKLANE);
  // the bluff face: solid, projectiles hit its slope
  each(rect(X.bluff, -half, X.top, half), (i, _j, c) => {
    solid[c] = 1;
    pBot[c] = -5;
    pTop[c] = baseProfile(cx(i) + 1, 0);
  });

  // ---- 2. the pier ----
  const deck = (x0: number, z0: number, x1: number, z1: number) =>
    addRegion({ ...rect(x0, z0, x1, z1), kind: "flat", h0: DECK, h1: DECK });
  // entry ramp from the promenade (town level 0 at x = 128) up to the deck
  addRegion({ ...rect(92, -8, X.prom, 8), kind: "rampX", h0: DECK, h1: 0 });
  stairs.push({ ...rect(92, -8, X.prom, 8), axis: "x", h0: DECK, h1: 0 });
  deck(40, -16, 92, 16); // landward deck: the carousel pavilion
  deck(-20, -8, 40, 8); // the pier walk over the sand
  deck(-124, -32, -20, 32); // the amusement park
  deck(-196, -8, -124, 8); // fishing pier
  deck(-236, -20, -196, 20); // the end: restaurant, harbour office
  // side stairs down to the sand (landing + run), north and south of the pier walk
  for (const s of [-1, 1] as const) {
    const zin = s * 8;
    const zout = s * 20;
    const z0 = Math.min(zin, zout);
    const z1 = Math.max(zin, zout);
    addRegion({ ...rect(-4, z0, 4, z1), kind: "flat", h0: DECK, h1: DECK });
    const bot = baseProfile(36, s * 14);
    addRegion({ ...rect(4, z0, 36, z1), kind: "rampX", h0: DECK, h1: bot });
    stairs.push({ ...rect(4, z0, 36, z1), axis: "x", h0: DECK, h1: bot });
    // from the amusement deck's east edge
    const za = s * 22;
    const zb = s * 32;
    const bot2 = baseProfile(12, s * 27);
    addRegion({
      ...rect(-20, Math.min(za, zb), 12, Math.max(za, zb)),
      kind: "rampX",
      h0: DECK,
      h1: bot2,
    });
    stairs.push({
      ...rect(-20, Math.min(za, zb), 12, Math.max(za, zb)),
      axis: "x",
      h0: DECK,
      h1: bot2,
    });
  }

  // ---- 3. bluff stairs (carved into the slope, climbing along z) ----
  const bluffStairs = (s: number) => {
    // bottom landing at street level, open to the east sidewalk
    addRegion({ ...rect(X.walkE - 4, s - 8, 248, s), kind: "flat", h0: 0, h1: 0 }, K_WALK);
    addRegion({ ...rect(236, s, 248, s + 44), kind: "rampZ", h0: 0, h1: BLUFF_H }, K_WALK);
    stairs.push({ ...rect(236, s, 248, s + 44), axis: "z", h0: 0, h1: BLUFF_H });
    addRegion(
      { ...rect(236, s + 44, X.top, s + 56), kind: "flat", h0: BLUFF_H, h1: BLUFF_H },
      K_WALK,
    );
    each(rect(X.walkE - 4, s - 8, X.top, s + 56), (_i, _j, c) => {
      if (regionOf[c]! >= 0) {
        solid[c] = 0;
        pTop[c] = 0;
        pBot[c] = 1;
      }
    });
  };
  bluffStairs(-64);
  bluffStairs(148);
  bluffStairs(-340);
  bluffStairs(300);

  // ---- 4. skate park, Muscle Beach, courts, playground (the park strip) ----
  const skate = rect(56, 48, X.bike, 104);
  // the sand eases onto flat pads under the skate park, the beach lot and the buildings on it
  pads.push({ ...skate, h: 0, ramp: 6 });
  pads.push({ ...rect(60, 184, X.bike, 256), h: 0, ramp: 6 });
  pads.push({ ...rect(64, -168, 88, -148), h: 0, ramp: 5 });
  for (const z of [-204, 170]) pads.push({ ...rect(80, z, 92, z + 10), h: 0, ramp: 4 });
  paint(skate, K_SKATE);
  mods.push({ t: "ell", x: 82, z: 66, rx: 11, rz: 8, depth: 2.6 });
  mods.push({ t: "ell", x: 70, z: 88, rx: 6.5, rz: 6.5, depth: 2.1 });
  mods.push({ t: "cap", ax: 92, az: 94, bx: 110, bz: 82, r: 4.2, depth: 1.4 });
  mods.push({ t: "box", x0: 102, z0: 54, x1: 110, z1: 62, h: 1.0, ramp: 3 });
  mods.push({ t: "box", x0: 104, z0: 68, x1: 108, z1: 74, h: 0.7, ramp: 2.5 });
  // ledges and a stair set (low cover)
  solidify(rect(94, 52, 96, 60), -5, 0.55);
  solidify(rect(112, 64, 116, 66), -5, 0.55);
  // quarter pipes along two edges: you can run up the curve onto the deck (high ground over
  // the bowls); the back and the two cheeks are solid walls
  const qpipes: BeachData["qpipes"] = [
    { ...rect(112, 76, 120, 100), face: 3 },
    { ...rect(60, 48, 90, 56), face: 2 },
  ];
  for (const q of qpipes) {
    mods.push({ t: "qp", ...rect(q.x0, q.z0, q.x1, q.z1), face: q.face, h: 2.4, run: 4.6 });
    const back = q.face === 3 ? rect(q.x1 - 2, q.z0, q.x1, q.z1) : rect(q.x0, q.z0, q.x1, q.z0 + 2);
    solidify(back, -5, 3.4);
    const cheeks =
      q.face === 3
        ? [rect(q.x0, q.z0, q.x1, q.z0 + 2), rect(q.x0, q.z1 - 2, q.x1, q.z1)]
        : [rect(q.x0, q.z0, q.x0 + 2, q.z1), rect(q.x1 - 2, q.z0, q.x1, q.z1)];
    for (const c of cheeks) solidify(c, -5, 3.4);
  }
  props.push({ k: "rail", x: 96, z: 78, y: 0, rot: Math.PI / 2, s: 8 });
  props.push({ k: "rail", x: 104, z: 98, y: 0, rot: 0, s: 6 });
  props.push({ k: "rail", x: 66, z: 100, y: 0, rot: 0, s: 7 });
  props.push({ k: "ledge", x: 61, z: 72, y: 0, rot: 0, s: 10 });
  solidify(rect(60, 68, 62, 76), -5, 0.55);
  // spectators' benches along the park's sand side and the bike path
  for (const z of [62, 76, 90]) props.push({ k: "bench", x: 57.2, z, y: 0, rot: Math.PI / 2 });
  for (const x of [72, 84]) props.push({ k: "bench", x, z: 102.8, y: 0, rot: Math.PI });
  props.push({ k: "ledge", x: 95, z: 56, y: 0, rot: 0, s: 8 });
  props.push({ k: "ledge", x: 114, z: 65, y: 0, rot: Math.PI / 2, s: 4 });

  const gym = rect(96, -88, X.bike, -52);
  paint(gym, K_SKATE);
  // waist-high pen with gaps on every side
  for (const [a, b, c2, d] of [
    [96, -88, 98, -74],
    [96, -66, 98, -52],
    [118, -88, X.bike, -76],
    [118, -64, X.bike, -52],
    [96, -88, 104, -86],
    [112, -88, X.bike, -86],
    [96, -54, 104, -52],
    [112, -54, X.bike, -52],
  ] as const)
    solidify(rect(a, b, c2, d), -5, 1.15);
  for (let k = 0; k < 4; k++) {
    props.push({ k: "bars", x: 102 + (k % 2) * 10, z: -82 + Math.floor(k / 2) * 10, y: 0, rot: 0 });
  }
  props.push({ k: "rings", x: 108, z: -60, y: 0, rot: 0 });
  props.push({ k: "rings", x: 103, z: -60, y: 0, rot: 0 });
  props.push({ k: "rack", x: 112, z: -70, y: 0, rot: Math.PI / 2 });
  props.push({ k: "rack", x: 102, z: -70, y: 0, rot: Math.PI / 2 });
  props.push({ k: "bench", x: 107, z: -76, y: 0, rot: 0 });

  const courts = rect(96, 120, X.bike, 168);
  paint(courts, K_COURT);
  for (const [a, b, c2, d] of [
    [96, 120, 98, 136],
    [96, 150, 98, 168],
    [118, 120, X.bike, 138],
    [118, 150, X.bike, 168],
    [96, 120, 104, 122],
    [112, 120, X.bike, 122],
    [96, 166, 104, 168],
    [112, 166, X.bike, 168],
  ] as const)
    solidify(rect(a, b, c2, d), -5, 3.4);
  for (const z of [124, 142, 146, 164])
    props.push({ k: "hoop", x: 108, z, y: 0, rot: z < 144 ? 0 : Math.PI });

  // playground
  paint(rect(96, -128, X.bike, -100), K_PATH);
  solidify(rect(104, -118, 112, -110), -5, 3.2);
  props.push({ k: "swing", x: 100, z: -106, y: 0, rot: 0 });
  props.push({ k: "swing", x: 116, z: -122, y: 0, rot: Math.PI / 2 });

  // lifeguard headquarters (on the sand) and restrooms
  const bld = (b: Omit<BBld, "seed" | "tone"> & { seed?: number; tone?: number }) => {
    const full: BBld = { seed: r(), tone: r(), ...b };
    // Keep the whole doorway approach, not just its centre, clear of midway booths.
    // Consume the same random values even when a booth is omitted.
    if (
      b.t === "stall" &&
      buildings.some(
        (host) => host.t !== "stall" && overlaps(beachStallBounds(b), beachDoorApproach(host)),
      )
    )
      return full;
    buildings.push(full);
    if (!b.backdrop) {
      solidify(b, b.y0 - 6, b.y0 + b.h);
      each(b, (_i, _j, c) => {
        if (regionOf[c]! < 0) kind[c] = K_LOT;
      });
    }
    return full;
  };
  bld({ ...rect(64, -168, 88, -148), t: "hq", y0: 0, h: 8.5, floors: 2, front: 3, sign: 10 });
  for (const z of [-204, 170])
    bld({
      ...rect(80, z, 92, z + 10),
      t: "restroom",
      y0: 0,
      h: 3.6,
      floors: 1,
      front: 3,
      sign: -1,
    });

  // beach lot (south) with a driveway across the strip to PCH
  const lot = rect(60, 184, X.bike, 256);
  paint(lot, K_OPEN);

  // ---- 5. the promenade strip: shops, motels, taco stands, lots ----
  // segment kinds in z order; widths in metres (multiples of 4); passages between them
  type Seg = { t: BType | "lot" | "plaza" | "drive"; w: number };
  const segsFor = (z0: number, z1: number, flip: boolean) => {
    const out: { t: Seg["t"]; a: number; b: number }[] = [];
    const pool: Seg["t"][] = [
      "shop",
      "surf",
      "taco",
      "motel",
      "cafe",
      "shop",
      "arcade",
      "lot",
      "hotel",
      "shop",
      "taco",
      "surf",
      "motel",
      "cafe",
      "lot",
    ];
    let z = z0;
    let k = Math.floor(r() * pool.length);
    while (z < z1 - 12) {
      const t = pool[k++ % pool.length]!;
      const w =
        t === "motel"
          ? 44
          : t === "hotel"
            ? 36
            : t === "lot"
              ? 32
              : t === "taco"
                ? 16
                : t === "arcade"
                  ? 28
                  : 20 + Math.floor(r() * 3) * 4;
      if (z + w > z1) break;
      out.push({ t, a: z, b: z + w });
      z += w + 8; // 8 m passage
    }
    return flip ? out.map((s) => ({ t: s.t, a: -s.b, b: -s.a })) : out;
  };
  const strips = [...segsFor(16, half - 4, false), ...segsFor(16, half - 4, true)];
  // the south lot driveway (z 200..212) and PCH crosswalk plazas stay open
  const keepOpen = (a: number, b: number) =>
    (a < 216 && b > 196) || (a < -92 && b > -108) || (a < 108 && b > 92);
  const SIGNS: Partial<Record<BType, number[]>> = {
    shop: [3, 4, 5, 11, 12],
    surf: [1],
    taco: [0],
    cafe: [6, 7],
    arcade: [8],
    motel: [2],
    hotel: [9],
  };
  for (const s of strips) {
    yield;
    if (keepOpen(s.a, s.b)) continue;
    const signs = SIGNS[s.t as BType] ?? [-1];
    const sign = signs[Math.floor(r() * signs.length)]!;
    if (s.t === "lot") {
      paint(rect(X.shops, s.a, X.walkW, s.b), K_OPEN);
      for (let z = s.a + 3; z < s.b - 2; z += 3) {
        for (const x of [X.shops + 6, X.shops + 18, X.walkW - 14]) {
          if (r() < 0.25) continue;
          const v = makeVehicle(r, 5.2, ["sedan", "compact", "suv", "pickup", "sports", "van"]);
          if (!v) continue;
          parked.push({ x: x + 2.5, z, y: 0, rot: Math.PI / 2 + (r() < 0.5 ? 0 : Math.PI), v });
        }
      }
      props.push({
        k: "palm",
        x: X.shops + 12,
        z: (s.a + s.b) / 2,
        y: 0,
        rot: r() * 6,
        s: 22 + r() * 5,
      });
      continue;
    }
    if (s.t === "motel") {
      // L-shaped two-storey motel around a parking court that opens onto PCH
      bld({
        ...rect(X.shops + 2, s.a, X.shops + 16, s.b),
        t: "motel",
        y0: 0,
        h: 7,
        floors: 2,
        front: 1,
        sign,
      });
      bld({
        ...rect(X.shops + 16.4, s.a, X.walkW - 4, s.a + 12),
        t: "motel",
        y0: 0,
        h: 7,
        floors: 2,
        front: 2,
        sign: -1,
      });
      paint(rect(X.shops + 16, s.a + 12, X.walkW, s.b), K_OPEN);
      for (let z = s.a + 16; z < s.b - 3; z += 3.2) {
        if (r() < 0.35) continue;
        const v = makeVehicle(r, 5.2, ["sedan", "compact", "suv", "pickup", "sports"]);
        if (v) parked.push({ x: X.shops + 20, z, y: 0, rot: Math.PI / 2, v });
      }
      props.push({ k: "palm", x: X.walkW - 4, z: s.b - 3, y: 0, rot: 0, s: 24 });
      continue;
    }
    if (s.t === "hotel") {
      bld({
        ...rect(X.shops + 2, s.a, X.walkW - 6, s.b),
        t: "hotel",
        y0: 0,
        h: 22,
        floors: 6,
        front: 3,
        sign,
      });
      continue;
    }
    if (s.t === "taco") {
      bld({
        ...rect(X.shops + 10, s.a + 2, X.shops + 20, s.b - 2),
        t: "taco",
        y0: 0,
        h: 4.2,
        floors: 1,
        front: 3,
        sign,
      });
      paint(rect(X.shops, s.a, X.shops + 10, s.b), K_PROM);
      for (const z of [s.a + 4, s.b - 4])
        props.push({ k: "table", x: X.shops + 4, z, y: 0, rot: 0 });
      // a surf shack or bike rental faces the road behind the taco stand
      bld({
        ...rect(X.shops + 26, s.a, X.walkW - 6, s.b),
        t: "shop",
        y0: 0,
        h: 4.6,
        floors: 1,
        front: 1,
        sign: 12,
      });
      continue;
    }
    // promenade-facing shop row (1-3 storeys) + an alley + something facing the road
    const floors = s.t === "arcade" ? 2 : 1 + Math.floor(r() * 3);
    bld({
      ...rect(X.shops + 2, s.a, X.shops + 22, s.b),
      t: s.t as BType,
      y0: 0,
      h: 4.4 + (floors - 1) * 3.4,
      floors,
      front: 3,
      sign,
    });
    if (r() < 0.85)
      bld({
        ...rect(X.shops + 28, s.a + 2, X.walkW - 6, s.b - 2),
        t: "shop",
        y0: 0,
        h: 4.6 + Math.floor(r() * 2) * 3.4,
        floors: 1,
        front: 1,
        sign: SIGNS.shop![Math.floor(r() * 5)]!,
      });
    else paint(rect(X.shops + 24, s.a, X.walkW, s.b), K_OPEN);
  }

  // one beachfront condo tower (building access: 10 storeys, an elevator and a roof deck): the
  // hotel nearest the pier inside the solo square is built taller; failing that, a shop there
  {
    const sq = soloHalf(half) - 24;
    const inSq = (b: BBld) => Math.max(Math.abs(b.z0), Math.abs(b.z1)) < sq && b.y0 === 0;
    const byPier = (a: BBld, b: BBld) => Math.abs((a.z0 + a.z1) / 2) - Math.abs((b.z0 + b.z1) / 2);
    const pick =
      buildings.filter((b) => b.t === "hotel" && inSq(b)).sort(byPier)[0] ??
      buildings
        .filter((b) => b.t === "shop" && b.front === 3 && inSq(b) && b.z1 - b.z0 >= 20)
        .sort(byPier)[0];
    if (pick) {
      pick.t = "hotel";
      pick.floors = 10;
      pick.h = 4.2 + 9 * 3.3;
      solidify(pick, pick.y0 - 6, pick.y0 + pick.h);
    }
  }

  // ---- 6. amusement park and pier buildings ----
  // the wheel's disc is turned 45 degrees so it reads from the beach, the boardwalk and the pier
  wheel = { x: -96, z: -20, y: DECK + 21.6, r: 17, rot: Math.PI / 4 };
  // Only the four A-frame feet and ticket booth are solid; the platform and approach work.
  for (const u of [-9, 9])
    for (const n of [-4.4, 4.4]) {
      const p = wheelPoint(wheel, u, 0, n);
      solidify(rect(p.x - 1, p.z - 1, p.x + 1, p.z + 1), DECK, DECK + 3.5);
    }
  const booth = wheelPoint(wheel, -6.2, 0, 3.5);
  solidify(rect(booth.x - 1.3, booth.z - 1.3, booth.x + 1.3, booth.z + 1.3), DECK, DECK + 4.4);
  bld({ ...rect(-76, -30, -44, -14), t: "arcade", y0: DECK, h: 8.5, floors: 2, front: 2, sign: 8 });
  const drop = { x: -32, z: -24, h: 38 };
  solidify(rect(-36, -28, -28, -20), DECK - 8, DECK + drop.h);
  const station = rect(-60, 16, -44, 26);
  // midway stalls: 6 m booths, 6 m gaps, both sides (none in front of the coaster station)
  for (let x = -120; x < -26; x += 12) {
    const sn = 14 + (Math.abs(x / 12) % 3);
    bld({
      ...rect(x, -12, x + 6, -8),
      t: "stall",
      y0: DECK,
      h: 3.2,
      floors: 1,
      front: 2,
      sign: sn,
    });
    if (x < -64 || x > -40)
      bld({
        ...rect(x, 8, x + 6, 12),
        t: "stall",
        y0: DECK,
        h: 3.2,
        floors: 1,
        front: 0,
        sign: 14 + ((Math.abs(x / 12) + 1) % 3),
      });
  }
  // the coaster: a figure-eight over the south half of the deck, dipping through its station
  const coaster: [number, number, number][] = [];
  {
    const K = 96;
    for (let k = 0; k < K; k++) {
      const a = (k / K) * Math.PI * 2;
      const x = -86 + Math.sin(a) * 34;
      const z = 21 + Math.sin(a * 2) * 7;
      const hill = (1 - Math.cos(a - Math.PI / 2)) / 2;
      const y =
        DECK + 1.4 + hill * 9.5 * (0.8 + 0.2 * Math.sin(a * 3)) + Math.sin(a * 5) * 1.2 * hill;
      coaster.push([x, y, z]);
      // where the track runs low it is in the way: solid (cover) under it
      if (y < DECK + 3.2)
        solidify(
          rect(
            Math.floor(x / 2) * 2,
            Math.floor(z / 2) * 2,
            Math.floor(x / 2) * 2 + 2,
            Math.floor(z / 2) * 2 + 2,
          ),
          DECK - 1,
          y + 0.4,
        );
    }
  }
  const carousel = { x: 66, z: -8, r: 6.5 };
  solidify(rect(58, -14, 74, -2), DECK - 8, DECK + 5.5);
  bld({
    ...rect(-232, -18, -208, 4),
    t: "restaurant",
    y0: DECK,
    h: 8,
    floors: 2,
    front: 1,
    sign: 17,
  });
  bld({
    ...rect(-232, 10, -222, 18),
    t: "harbor",
    y0: DECK,
    h: 3.6,
    floors: 1,
    front: 1,
    sign: -1,
  });
  bld({ ...rect(-204, -16, -198, -10), t: "stall", y0: DECK, h: 3, floors: 1, front: 1, sign: 16 });

  // ---- 7. clifftop: park, Ocean Ave, houses ----
  bld({
    ...rect(272, -116, 280, -108),
    t: "camera",
    y0: BLUFF_H,
    h: 5,
    floors: 1,
    front: 3,
    sign: -1,
  });
  for (let z = -half + 8; z < half - 20; z += 28) {
    const w = 20 + Math.floor(r() * 2) * 4;
    if (r() < 0.12) continue;
    bld({
      ...rect(X.ave1 + 12, z, X.ave1 + 12 + w * 0.9, z + w - 6),
      t: "house",
      y0: BLUFF_H,
      h: 6.8,
      floors: 2,
      front: 3,
      sign: -1,
    });
    props.push({ k: "palm", x: X.ave1 + 6, z: z + 3, y: BLUFF_H, rot: r() * 6, s: 20 + r() * 8 });
  }
  for (let z = -half + 10; z < half - 10; z += 11) {
    if (r() < 0.45) continue;
    const v = makeVehicle(r, 5.2, ["sedan", "compact", "suv", "pickup", "sports", "van"]);
    if (v) {
      const side = r() < 0.5 ? X.ave0 + 3 : X.ave1 - 3;
      parked.push({ x: side, z, y: BLUFF_H, rot: side < 312 ? Math.PI : 0, v });
      solidify(rect(side - 1, z - 2, side + 1, z + 2), BLUFF_H - 1, BLUFF_H + 1.6);
    }
  }

  // ---- 8. lifeguard towers, volleyball, umbrellas, fire rings, trash ----
  let tn = 1;
  for (const z of [-340, -250, -160, -72, 72, 160, 250, 340]) {
    const x = -14 + (Math.abs(z) % 3) * 4;
    towers.push({ x, z, rot: -Math.PI / 2, n: tn++ });
    solidify(rect(x - 2, z - 2, x + 2, z + 2), 2.1, 5.4);
    // the stilts stop you walking through, the hut stops bullets only above the stilts
    each(rect(x - 2, z - 2, x + 2, z + 2), (_i, _j, c) => (pBot[c] = heightAt(x, z) + 2.1));
  }
  const planned = planBeachActivity({
    half,
    random: r,
    height: heightAt,
    free,
    buildings,
    regions,
    towers,
    existing: props,
    features: [skate, gym, courts, lot, rect(96, -128, X.bike, -100)],
  });
  props.push(...planned.props);
  firesLit.push(...planned.fires);
  const activity = planned.activity;
  // Four continuous 4 m mats meet dry shoreline and the cycle path. Full crossing widths
  // were reserved before any beach dressing; the park destinations avoid its solid features.
  for (const z of BEACH_MAT_Z)
    for (let x = -68.4; x < 120; x += 2.4)
      props.push({ k: "mat", x, z, y: heightAt(x, z), rot: 0 });
  for (const z of [-178, 182]) prop("shower", 94, z, 0);
  // The rope lies on the exact blocked cell edge, with no buoys below the amusement deck.
  for (const z of swimLineBuoys(half)) {
    props.push({ k: "buoy", x: X.surf, z, y: SEA, rot: 0 });
  }

  const inFeature = (x: number, z: number) =>
    [skate, gym, courts, lot, rect(96, -128, X.bike, -100)].some(
      (f) => x > f.x0 - 3 && x < f.x1 + 3 && z > f.z0 - 3 && z < f.z1 + 3,
    );
  // parked rows in the beach lot, light poles between them
  for (const x of [66, 84, 102]) {
    for (let z = lot.z0 + 4; z < lot.z1 - 3; z += 2.9) {
      if (r() < 0.3) continue;
      const v = makeVehicle(r, 5.2, ["sedan", "compact", "suv", "pickup", "sports", "van"]);
      if (!v) continue;
      const xx = x + (Math.floor((z - lot.z0) / 2.9) % 2 ? 0 : 0);
      parked.push({ x: xx, z, y: 0, rot: x === 84 ? -Math.PI / 2 : Math.PI / 2, v });
      solidify(rect(xx - 2, Math.floor(z / 2) * 2, xx + 2, Math.floor(z / 2) * 2 + 2), -1, 1.5);
    }
    props.push({ k: "streetlight", x: x + 8, z: lot.z0 + 20, y: 0, rot: 0 });
    props.push({ k: "streetlight", x: x + 8, z: lot.z1 - 20, y: 0, rot: Math.PI });
  }
  // ---- 9. palms, lamps, benches, vendors along the promenade and the bike path ----
  for (let z = -half + 6; z < half - 4; z += 12) {
    const crossing = (at: number) => BEACH_MAT_Z.some((m) => Math.abs(at - m) < 4);
    const nearPier = Math.abs(z) < 18;
    if (!nearPier && !crossing(z)) {
      props.push({ k: "palm", x: X.prom + 2, z, y: 0, rot: r() * 6, s: 22 + r() * 7 });
      if (!inFeature(X.bike - 2, z + 6) && !crossing(z + 6))
        props.push({ k: "palm", x: X.bike - 2, z: z + 6, y: 0, rot: r() * 6, s: 19 + r() * 8 });
    }
    if (!nearPier && !crossing(z + 3) && Math.round((z + half) / 12) % 2 === 0)
      props.push({ k: "lamp", x: X.shops - 3, z: z + 3, y: 0, rot: -Math.PI / 2 });
    if (!nearPier && !crossing(z + 4))
      props.push({ k: "bench", x: X.prom + 3, z: z + 4, y: 0.13, rot: -Math.PI / 2 });
    // PCH: palms and cobra-head lights on both sidewalks, a bus stop now and then
    props.push({ k: "palm", x: X.walkW + 4, z: z + 2, y: 0, rot: r() * 6, s: 24 + r() * 6 });
    if (Math.floor((z + half) / 12) % 3 === 0) {
      props.push({ k: "streetlight", x: X.road0 - 1, z: z + 8, y: 0, rot: Math.PI / 2 });
      props.push({ k: "streetlight", x: X.road1 + 1, z: z + 2, y: 0, rot: -Math.PI / 2 });
    }
    // clifftop park: a double row of very tall palms, benches facing the sea
    props.push({ k: "palm", x: X.top + 6, z: z + 4, y: BLUFF_H, rot: r() * 6, s: 25 + r() * 6 });
    if (r() < 0.6)
      props.push({
        k: "palm",
        x: X.top + 22 + r() * 10,
        z: z + r() * 10,
        y: BLUFF_H,
        rot: r() * 6,
        s: 22 + r() * 8,
      });
    if (r() < 0.5)
      props.push({
        k: "tree",
        x: X.top + 32 + r() * 6,
        z: z + r() * 10,
        y: BLUFF_H,
        rot: r() * 6,
        s: 1 + r() * 0.5,
      });
    props.push({ k: "bench", x: X.top + 3, z: z + 9, y: BLUFF_H, rot: -Math.PI / 2 });
  }
  // Compact vendor courts beside a continuous 4 m boardwalk lane. Shopfront approaches,
  // the pier, beach crossings, crosswalk plazas and the parking driveway all remain open.
  for (let z = -half + 20, k = 0; z < half - 16; z += 18, k++) {
    const rc = rect(139.4, z - 5, 144, z + 5);
    if (
      Math.abs(z) < 24 ||
      Math.abs(Math.abs(z) - 100) < 14 ||
      (z > 188 && z < 224) ||
      activity.lanes.some((p) => overlaps(rc, p)) ||
      buildings.some((b) => b.t !== "stall" && overlaps(rc, beachDoorApproach(b))) ||
      props.some((p) => overlaps(rc, beachPropBounds(p, 0.6)))
    )
      continue;
    props.push({ k: "cart", x: 142, z: z - 2.6, y: 0.15, rot: -Math.PI / 2, c: k % 6 });
    props.push({ k: "table", x: 142, z: z + 2.4, y: 0, rot: 0, c: k % 6 });
    activity.pockets.push({ ...rc, kind: "vendor" });
  }
  for (const z of [-236, -96, 44, 232])
    props.push({ k: "busstop", x: X.road1 + 3.5, z, y: 0, rot: -Math.PI / 2 });
  // palms in the parking lots and around the skate park / gym
  for (const [x, z] of [
    [58, 46],
    [58, 106],
    [122, 46],
    [94, -90],
    [94, -50],
    [122, -92],
    [94, 118],
    [94, 170],
    [64, 182],
    [64, 258],
    [100, 258],
  ] as const)
    props.push({ k: "palm", x, z, y: heightAt(x, z), rot: r() * 6, s: 20 + r() * 8 });

  // pier furniture: globe lamps along both railings, benches, rods at the end, scopes, flags
  const pierProps = (x0: number, x1: number, edge: number) => {
    const zr = edge - 1.8;
    for (let x = x0 + 4; x < x1 - 2; x += 12) {
      props.push({ k: "globe", x, z: -zr, y: heightAt(x, 0), rot: 0 });
      props.push({ k: "globe", x: x + 6, z: zr, y: heightAt(x + 6, 0), rot: 0 });
    }
  };
  pierProps(92, X.prom - 6, 8);
  pierProps(40, 92, 16);
  pierProps(-20, 40, 8);
  pierProps(-196, -124, 8);
  pierProps(-236, -196, 20);
  for (let x = -120; x < -22; x += 10) {
    props.push({ k: "globe", x, z: -30.2, y: DECK, rot: 0 });
    props.push({ k: "globe", x: x + 5, z: 30.2, y: DECK, rot: 0 });
  }
  for (let x = -192; x < -126; x += 7) {
    if (r() < 0.55)
      props.push({ k: "rod", x, z: -6.1, y: DECK, rot: Math.PI, c: Math.floor(r() * 4) });
    if (r() < 0.55)
      props.push({ k: "rod", x: x + 3, z: 6.1, y: DECK, rot: 0, c: Math.floor(r() * 4) });
    if (r() < 0.3)
      props.push({ k: "bench", x: x + 1, z: 0, y: DECK, rot: r() < 0.5 ? 0 : Math.PI });
  }
  for (const [x, z] of [
    [-234, -10],
    [-234, 10],
    [-222, 18],
    [-210, -18],
  ] as const)
    props.push({ k: "scope", x, z, y: DECK, rot: 0 });
  props.push({ k: "sign66", x: -202, z: -4, y: DECK, rot: -Math.PI / 2 });
  for (let x = 44; x < 90; x += 8) props.push({ k: "bench", x, z: 12, y: DECK, rot: Math.PI });
  for (let x = -116; x < -30; x += 18) {
    props.push({ k: "bench", x, z: -1.4, y: DECK, rot: 0 });
    props.push({ k: "bench", x, z: 1.4, y: DECK, rot: Math.PI });
    props.push({ k: "trash", x: x + 3, z: 0, y: DECK, rot: 0 });
  }
  for (const x of [-104, -68, -44])
    props.push({ k: "cart", x, z: 4.5, y: DECK, rot: Math.PI / 2, c: Math.abs(x) % 6 });
  for (let x = -18; x < 38; x += 14) props.push({ k: "trash", x, z: 5, y: DECK, rot: 0 });
  for (const [x, z] of [
    [-24, -6],
    [-24, 6],
    [-120, 30],
    [-120, -30],
    [36, -14],
    [36, 14],
  ] as const)
    props.push({ k: "flag", x, z, y: DECK, rot: 0, c: 0 });

  // Check all loose dressing too, before either navigation or visible geometry is built.
  const doorApproaches = buildings
    .filter((b) => !b.backdrop && b.t !== "stall")
    .map(beachDoorApproach);
  for (let i = props.length - 1; i >= 0; i--)
    if (doorApproaches.some((door) => overlaps(door, beachPropBounds(props[i]!, 0.25))))
      props.splice(i, 1);

  // ---- 9b. anything you would bump into in real life is solid (and it is cover) ----
  const foot = (
    x: number,
    z: number,
    hx: number,
    hz: number,
    rot: number,
    bot: number,
    top: number,
  ) => {
    const side = Math.abs(Math.sin(rot)) > 0.7;
    // every 2 m cell the footprint overlaps (cell centres within a cell half-size of it)
    const ax = (side ? hz : hx) + 0.95;
    const az = (side ? hx : hz) + 0.95;
    each(rect(x - ax, z - az, x + ax, z + az), (_i, _j, c) => {
      if (solid[c]) return;
      solid[c] = 1;
      pBot[c] = bot;
      pTop[c] = top;
    });
  };
  const PROP_FOOT: Partial<Record<PropKind, [number, number, number]>> = {
    cart: [1.1, 0.55, 2.4],
    bars: [1.6, 0.15, 2.4],
    rings: [1.3, 0.15, 3.2],
    rack: [1.2, 0.9, 1.8],
    hoop: [0.9, 1.3, 3.4],
    swing: [1.9, 0.3, 2.8],
    net: [4.7, 0.1, 2.5],
    shower: [0.7, 0.7, 2.6],
    busstop: [2.0, 0.8, 2.6],
    table: [1.1, 1.1, 0.8],
    sign66: [0.2, 1.2, 3.0],
    rail: [3, 0.1, 0.6],
  };
  for (const p of props) {
    const f = PROP_FOOT[p.k];
    if (!f) continue;
    const hx = p.k === "rail" ? (p.s ?? 6) / 2 : f[0];
    foot(p.x, p.z, hx, f[1], p.rot, p.y - 1, p.y + f[2]);
  }
  for (const pc of parked)
    foot(pc.x, pc.z, pc.v.len / 2, pc.v.wid / 2, pc.rot + Math.PI / 2, pc.y - 1, pc.y + 1.6);
  // coaster columns and the station canopy posts, the carousel pavilion's columns
  coaster.forEach((a, k) => {
    if (k % 4 === 0 && a[1] > DECK + 2) foot(a[0], a[2], 0.2, 0.2, 0, DECK - 1, a[1]);
  });
  for (const [x, z] of [
    [station.x0, station.z0],
    [station.x1, station.z0],
    [station.x0, station.z1],
    [station.x1, station.z1],
  ] as const)
    foot(x, z, 0.15, 0.15, 0, DECK - 1, DECK + 4.2);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    foot(
      carousel.x + Math.cos(a) * (carousel.r + 1.2),
      carousel.z + Math.sin(a) * (carousel.r + 1.2),
      0.18,
      0.18,
      0,
      DECK - 1,
      DECK + 5.2,
    );
  }

  // ---- 10. deep ocean is an authored height-independent boundary, including in a jump ----
  // Raised pier regions deliberately cleared deep[] when they were created.
  for (let c = 0; c < N; c++) if (deep[c]) solid[c] = 1;

  // ---- 11. railings: wherever a raised region drops more than a step to an open neighbour ----
  const hC = new Float32Array(N);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) hC[i * n + j] = heightAt(cx(i), cx(j));
    yield;
  }
  const rail: number[] = [];
  for (let i = 0; i < n; i++) {
    yield;
    for (let j = 0; j < n; j++) {
      const c = i * n + j;
      if (solid[c] || deep[c] || regionOf[c]! < 0) continue;
      if (wheel && wheelGround(wheel, cx(i), cx(j)) !== null) continue; // exact thin rails around the rotated loading platform
      for (let di = -1; di <= 1; di++)
        for (let dj = -1; dj <= 1; dj++) {
          if (!di && !dj) continue;
          const a = i + di;
          const b = j + dj;
          if (!inside(a, b)) continue;
          const k = a * n + b;
          if (hC[c]! - hC[k]! > STEP && (!solid[k] || deep[k])) {
            rail.push(c);
            di = 2;
            break;
          }
        }
    }
  }
  for (const c of rail) {
    solid[c] = 1;
    pBot[c] = hC[c]!;
    pTop[c] = hC[c]! + 1.1;
  }

  // ---- 12. traffic: PCH plus the tunnel connectors (the loop closes far behind the bluff) ----
  const tz = solo ? TUNNEL_Z.slice(0, 1) : TUNNEL_Z;
  const roadZ: Road[] = [
    ...tz.map((z) => ({ c: -z, cls: "side" as const })).reverse(),
    ...tz.map((z) => ({ c: z, cls: "side" as const })),
  ];
  const roadX: Road[] = [
    { c: ROAD_C, cls: "avenue" },
    { c: 1100, cls: "side" },
  ];
  // the connector stubs from PCH to the tunnel portals are road
  for (const z of TUNNEL_Z)
    for (const s of [-1, 1]) {
      paint(rect(X.road1, s * z - 6, X.bluff, s * z + 6), K_ROAD);
    }

  // ---- 13. solo blockades + the arena-edge blockades ----
  const soloH = solo ? soloHalf(half) : null;
  const walkable = (x: number, z: number) => {
    const i = ci(x);
    const j = ci(z);
    if (!inside(i, j)) return false;
    const c = i * n + j;
    return !solid[c] && !deep[c];
  };
  const edgeH = half - 4;
  const gaps: Gap[] = [];
  const allGaps: { g: Gap; solo: boolean }[] = [];
  for (const g of findGaps(walkable, edgeH, 2)) allGaps.push({ g, solo: false });
  if (soloH !== null) for (const g of findGaps(walkable, soloH, 2)) allGaps.push({ g, solo: true });
  for (const { g } of allGaps) {
    gaps.push(g);
    for (const b of sealGaps([g])) {
      const c = ci(b.x) * n + ci(b.z);
      if (c >= 0 && c < N) {
        solid[c] = 1;
        pBot[c] = hC[c]!;
        pTop[c] = hC[c]! + 2.2;
      }
    }
  }
  const blockades = dressGaps(
    allGaps.map((a) => a.g),
    heightAt,
    r,
  );

  // ---- 14. spawn, then flood fill: every open cell the spawn can't reach becomes solid ----
  // players start on the promenade at the pier entrance, facing the arch and the sunset
  const spawn = { x: X.prom + 14, z: 3 };
  const reach = new Uint8Array(N);
  {
    const s0 = ci(spawn.x) * n + ci(spawn.z);
    const q = [s0];
    reach[s0] = 1;
    for (let h = 0; h < q.length; h++) {
      const c = q[h]!;
      const i = Math.floor(c / n);
      const j = c - i * n;
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const a = i + di;
        const b = j + dj;
        if (!inside(a, b)) continue;
        const k = a * n + b;
        if (reach[k] || solid[k] || deep[k]) continue;
        // arena wall: the outermost ring of cells is never walkable
        if (a === 0 || b === 0 || a === n - 1 || b === n - 1) continue;
        reach[k] = 1;
        q.push(k);
      }
    }
  }
  // enemies route on 4 m nav cells (open only when all four 2 m cells are): any pocket the
  // nav grid can't reach (a sand corner boxed in by stairs, joined by a 2 m slot) is sealed too,
  // so nothing spawns where it could never walk out
  {
    const m = n >> 1;
    const navOpen = new Uint8Array(m * m);
    for (let a = 0; a < m; a++) {
      yield;
      for (let b = 0; b < m; b++) {
        const i = a * 2;
        const j = b * 2;
        navOpen[a * m + b] =
          reach[i * n + j] &&
          reach[(i + 1) * n + j] &&
          reach[i * n + j + 1] &&
          reach[(i + 1) * n + j + 1]
            ? 1
            : 0;
      }
    }
    const seen = new Uint8Array(m * m);
    const s0 = (ci(spawn.x) >> 1) * m + (ci(spawn.z) >> 1);
    const q = [s0];
    seen[s0] = 1;
    for (let h = 0; h < q.length; h++) {
      const c = q[h]!;
      const a = Math.floor(c / m);
      const b = c - a * m;
      for (let da = -1; da <= 1; da++)
        for (let db = -1; db <= 1; db++) {
          if (!da && !db) continue;
          const na = a + da;
          const nb = b + db;
          if (na < 0 || nb < 0 || na >= m || nb >= m) continue;
          const k = na * m + nb;
          if (seen[k] || !navOpen[k]) continue;
          if (da && db && (!navOpen[(a + da) * m + b] || !navOpen[a * m + b + db])) continue;
          seen[k] = 1;
          q.push(k);
        }
    }
    for (let k = 0; k < m * m; k++) {
      if (!navOpen[k] || seen[k]) continue;
      const i = Math.floor(k / m) * 2;
      const j = (k % m) * 2;
      for (const c of [i * n + j, (i + 1) * n + j, i * n + j + 1, (i + 1) * n + j + 1])
        reach[c] = 0;
    }
  }
  const blocks: Block[] = [];
  for (let i = 0; i < n; i++) {
    yield;
    for (let j = 0; j < n; j++) {
      const c = i * n + j;
      if (!reach[c]) {
        const real = solid[c] && pTop[c]! > pBot[c]!;
        blocks.push({
          x: cx(i),
          z: cx(j),
          h: real ? Math.max(0, pTop[c]! - Math.max(0, pBot[c]!)) : 0,
          boundary: !real,
          tone: 0,
        });
        solid[c] = 1;
      }
    }
  }

  const layout: BeachLayout = {
    cells: n,
    half,
    kind,
    solid,
    roadX,
    roadZ,
    bandsX: [],
    bandsZ: [],
    buildings: [],
    parked: [],
    props: [],
    park: null,
    waterZ: 1e6,
    extent: half + 2400,
    spawn,
    landmark: { x: wheel.x, z: wheel.z, h: wheel.y + wheel.r },
    beach: {
      regions,
      pads,
      regionOf,
      mods,
      pBot,
      pTop,
      deep,
      buildings,
      props,
      parked,
      blockades,
      gaps,
      soloHalf: soloH,
      wheel: wheel!,
      coaster: { pts: coaster, station },
      carousel,
      drop,
      stairs,
      towers,
      firesLit,
      activity,
      skate,
      qpipes,
      gym,
      courts,
      lot,
    },
    palette: BEACH_PALETTE,
    seaX: X.surf,
    soloHalf: soloH,
    spawnYaw: 1.6,
  };
  return { layout, blocks };
}

/**
 * Turn each sealed opening into believable, deliberate dressing: what goes there depends on
 * the ground it crosses (surf, sand, promenade, road, clifftop park).
 */
function dressGaps(
  gaps: Gap[],
  heightAt: (x: number, z: number) => number,
  r: () => number,
): Blockade[] {
  const out: Blockade[] = [];
  for (const g of gaps) {
    const along = g.axis;
    const a0 = (along === "x" ? g.x : g.z) - g.w / 2;
    const a1 = a0 + g.w;
    const rot = along === "x" ? 0 : Math.PI / 2;
    // toward the playable side; everything is placed on the sealed cells or beyond them
    const ix = along === "z" ? -Math.sign(g.x) : 0;
    const iz = along === "x" ? -Math.sign(g.z) : 0;
    const face: 0 | 1 | 2 | 3 = iz > 0 ? 2 : iz < 0 ? 0 : ix > 0 ? 1 : 3;
    const at = (t: number, off = 0) =>
      along === "x" ? { x: t, z: g.z + iz * off } : { x: g.x + ix * off, z: t };
    const zoneOf = (t: number) => {
      const x = at(t).x;
      if (x < X.wet) return "surf";
      if (x < X.strip) return "sand";
      if (x < X.walkW) return "walk";
      if (x < X.road1 + 1 && x >= X.road0 - 1) return "road";
      if (x < X.bluff) return "walk";
      return "park";
    };
    const place = (k: BlockKind, s: number, off = 0, extra: Partial<Blockade> = {}) => {
      const p = at(s, off);
      out.push({ k, x: p.x, z: p.z, y: heightAt(p.x, p.z), rot, face, ...extra });
    };
    const fenceRun = (t: number, t1: number, label: number, off = 0.2) => {
      let n = 0;
      for (let s = t + 1.2; s < t1 - 0.5; s += 2.4, n++)
        place("fence", s, off, n % 3 === 1 ? { label } : {});
    };
    // split the gap into runs of one zone
    let t = a0;
    while (t < a1 - 0.01) {
      const z0 = zoneOf(t + 1);
      let t1 = t + 2;
      while (t1 < a1 - 0.01 && zoneOf(t1 + 1) === z0) t1 += 2;
      const mid = (t + t1) / 2;
      const len = t1 - t;
      if (z0 === "surf") {
        place("buoyline", mid, 0, { w: len });
        if (len > 20) place("boat", mid + (r() - 0.5) * len * 0.4, -4);
      } else if (z0 === "sand") {
        // a lifeguard closure: tall fencing with banners, barricades in front, a truck behind
        fenceRun(t, t1, 0, -0.2);
        for (let s = t + 2; s < t1 - 1; s += 4.8) place("aframe", s, 0.75);
        place("tape", mid, 1.1, { w: len - 1 });
        if (len > 30) place("truck", mid + (r() - 0.5) * (len - 16), -4.5);
        for (let s = t + 12; s < t1 - 6; s += 30) place("sign", s, 0.9, { label: 0 });
      } else if (z0 === "road") {
        for (let s = t + 1.2; s < t1 - 0.8; s += 2.05) place("jersey", s, 0.5);
        fenceRun(t, t1, 1, -0.6);
        for (let s = t + 1; s < t1; s += 2.5) place("cone", s, 1.05);
        place("police", mid, -4.5);
        place("arrowboard", mid - 6, -3);
        place("sign", mid + 3, 0.9, { label: 1 });
      } else if (z0 === "walk") {
        fenceRun(t, t1, 2);
        if (len > 10) place("sandbag", mid, 0.9);
        if (len > 16) place("sign", mid + len / 4, 0.9, { label: 2 });
      } else {
        fenceRun(t, t1, 3);
      }
      t = t1;
    }
  }
  return out;
}
