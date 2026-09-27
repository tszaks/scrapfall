// Dry Gulch: a deterministic, real-scale 1880s railroad boomtown (1 unit = 1 m, 2 m cells).
// Pure data - no three.js - so every co-op client builds the identical town from the seed.
//
// The map is always the full co-op size (800 x 800 m). The town sits in a basin ringed by
// red-rock ridges that run along the solo square (see soloBounds.ts): in co-op the ridge
// is crossed by passes (roads, the dry riverbed, trails) that lead out to the outer desert;
// in solo those same passes are barricaded, so the ridges are the natural edge of the map.
//
//   x ->  east        z ->  south        the sun sets in the west, straight down Main Street
//
//   Main Street runs east-west through the middle: the church closes its west end (the sun
//   sets behind the bell tower), the railroad station its east end. The railroad runs
//   north-south past the station, out of a tunnel in the north canyon wall (next to the
//   mine), over a trestle across the dry riverbed, and into a tunnel in the south ridge.
import type { Block } from "../level";
import { soloHalf } from "../soloBounds";

// ---- cell kinds (minimap, ground splat, collision) ----
export const WK = {
  DESERT: 0,
  STREET: 1,
  BOARD: 2,
  LOT: 3,
  ROCK: 4,
  RAIL: 5,
  RIVER: 6,
  TRAIL: 7,
  YARD: 8,
  PLATFORM: 9,
} as const;

export const RAIL_X = 150;
/** Main Street: dirt carriageway z in [-12, 12], boardwalks 3 m deep either side */
export const STREET_HALF = 12;
export const BOARD_D = 3;
export const DECK_Y = 0.28; // boardwalk deck height
export const STOREY = 3.5;
export const TRESTLE_Y = 6.5;

export type WMat = "clap" | "board" | "adobe" | "brick" | "stone" | "white" | "barn" | "log";
export type WType =
  | "store"
  | "saloon"
  | "hotel"
  | "bank"
  | "sheriff"
  | "church"
  | "stable"
  | "smithy"
  | "station"
  | "opera"
  | "house"
  | "shack"
  | "adobe"
  | "barn"
  | "ranch"
  | "outhouse"
  | "shed"
  | "tent"
  | "ruin"
  | "tipple";

export type WBld = {
  t: WType;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** which side faces the street: 0 -z, 1 +x, 2 +z, 3 -x */
  front: 0 | 1 | 2 | 3;
  storeys: number;
  mat: WMat;
  /** paint / weathering pick 0..1 */
  tone: number;
  seed: number;
  /** sign word index (WORDS), -1 none */
  sign: number;
  /** 0 none, 1 covered porch over the boardwalk, 2 porch with a balcony on top */
  porch: 0 | 1 | 2;
  /** false-front parapet: 0 none, 1 flat, 2 stepped, 3 arched pediment */
  ff: 0 | 1 | 2 | 3;
  roof: "gable" | "shed" | "flat" | "hip";
  /** exists only outside the solo square (co-op only content) */
  coop?: boolean;
};

export type WPropKind =
  | "barrel"
  | "outhouse"
  | "barrels"
  | "crate"
  | "crates"
  | "wagon"
  | "covered"
  | "trough"
  | "hitch"
  | "saguaro"
  | "pear"
  | "barrelcactus"
  | "bush"
  | "boulder"
  | "deadtree"
  | "fence"
  | "grave"
  | "cross"
  | "pole"
  | "lantern"
  | "streetlamp"
  | "hay"
  | "cart"
  | "anvil"
  | "well"
  | "campfire"
  | "wheel"
  | "bench"
  | "tumble"
  | "bones"
  | "windmill"
  | "watertower"
  | "tank"
  | "crossbuck"
  | "orecart"
  | "woodpile"
  | "outcrop"
  | "arch"
  | "sign";
export type WProp = { k: WPropKind; x: number; z: number; rot: number; s: number; a?: number };

export type WesternLayout = {
  kind: "western";
  cells: number;
  half: number;
  /** half-size of the solo square (the ring of ridges) */
  soloHalf: number;
  /** ground kind per cell */
  ground: Uint8Array;
  /** 1 where a collision block sits */
  solid: Uint8Array;
  /** rock height per cell (0 = none): ridges, canyon walls, mesas */
  rock: Float32Array;
  buildings: WBld[];
  props: WProp[];
  /** z of the two tunnel portals (north canyon face, south ridge face) */
  portals: { n: number; s: number };
  /** the trestle over the dry riverbed */
  trestle: { z0: number; z1: number };
  /** the train track's height profile (ramps up to the trestle) */
  railY: (z: number) => number;
  /** dry riverbed centre line and width */
  river: { z: (x: number) => number; w: (x: number) => number };
  mine: { x: number; z: number };
  station: { x: number; z: number };
  church: { x: number; z: number; h: number };
  spawn: { x: number; z: number };
  spawnYaw: number;
  /** where the ranch campfire burns (night) */
  campfire: { x: number; z: number };
  extent: number;
};

/** Painted sign words, in the order of the sign atlas (see westernTextures.ts). */
export const WORDS = [
  "SALOON",
  "HOTEL",
  "BANK",
  "SHERIFF",
  "GENERAL STORE",
  "LIVERY",
  "BLACKSMITH",
  "ASSAY OFFICE",
  "BARBER",
  "DRY GOODS",
  "UNDERTAKER",
  "TELEGRAPH",
  "DRY GULCH",
  "OPERA HOUSE",
  "GUNSMITH",
  "EATS",
  "LAND OFFICE",
  "DOCTOR",
  "GAZETTE",
  "BATHS",
  "FEED & SEED",
  "JAIL",
  "MINE CO.",
  "POST OFFICE",
  "ROAD CLOSED",
  "BRIDGE OUT",
  "WANTED",
  "KEEP OUT",
] as const;
export const W = Object.fromEntries(WORDS.map((w, i) => [w, i])) as Record<
  (typeof WORDS)[number],
  number
>;

// ---------- noise ----------
function hash2(x: number, z: number, s: number) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263) + Math.imul(s, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, z: number, s: number) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fz = z - zi;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(xi, zi, s);
  const b = hash2(xi + 1, zi, s);
  const c = hash2(xi, zi + 1, s);
  const d = hash2(xi + 1, zi + 1, s);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
/** fractal value noise, 0..1 */
export function fbm(x: number, z: number, s: number, oct = 4) {
  let v = 0;
  let amp = 0.5;
  let f = 1;
  let tot = 0;
  for (let o = 0; o < oct; o++) {
    v += vnoise(x * f, z * f, s + o * 17) * amp;
    tot += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return v / tot;
}
const smooth = (a: number, b: number, v: number) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** stretch value noise (which hugs 0.5) out toward the full 0..1 range */
const spread = (v: number) => Math.max(0, Math.min(1, (v - 0.5) * 2.7 + 0.5));
/** sandstone benches: heights settle onto strata ledges */
const terrace = (h: number, step: number) => {
  const k = h / step;
  const f = k - Math.floor(k);
  return (Math.floor(k) + smooth(0.72, 0.97, f)) * step;
};

/** The dry riverbed: meanders west to east south of town. */
export const riverZ = (x: number) => 172 + 24 * Math.sin(x / 88) + 9 * Math.sin(x / 37 + 1.3);
export const riverW = (x: number) => 21 + 5 * Math.sin(x / 61 + 0.4);

export function generateWestern(rand: () => number, cells: number, half: number) {
  const N = cells * cells;
  const ground = new Uint8Array(N);
  const solid = new Uint8Array(N);
  const rock = new Float32Array(N);
  const blocks: Block[] = [];
  const buildings: WBld[] = [];
  const props: WProp[] = [];
  const S = soloHalf(half);
  const RING = S + 1; // centre of the ring cells
  const seedN = Math.floor(rand() * 1e6);

  const cc = (i: number) => -half + 1 + i * 2; // cell centre
  const toI = (v: number) => Math.floor((v + half) / 2);
  const idx = (i: number, j: number) => i * cells + j;
  const inside = (i: number, j: number) => i >= 0 && j >= 0 && i < cells && j < cells;
  const at = (x: number, z: number) => {
    const i = toI(x);
    const j = toI(z);
    return inside(i, j) ? idx(i, j) : -1;
  };
  const markSolid = (x0: number, z0: number, x1: number, z1: number, h: number) => {
    // collision always covers the visual footprint: round outward to whole cells
    const i0 = Math.max(0, Math.floor((x0 + half) / 2 + 1e-6));
    const j0 = Math.max(0, Math.floor((z0 + half) / 2 + 1e-6));
    const i1 = Math.min(cells, Math.ceil((x1 + half) / 2 - 1e-6));
    const j1 = Math.min(cells, Math.ceil((z1 + half) / 2 - 1e-6));
    for (let i = i0; i < i1; i++)
      for (let j = j0; j < j1; j++) {
        const k = idx(i, j);
        if (solid[k]) continue;
        solid[k] = 1;
        blocks.push({ x: cc(i), z: cc(j), h, tone: 0 });
      }
  };
  const setGround = (x0: number, z0: number, x1: number, z1: number, k: number) => {
    const i0 = Math.max(0, toI(x0 + 0.01));
    const j0 = Math.max(0, toI(z0 + 0.01));
    const i1 = Math.min(cells - 1, toI(x1 - 0.01));
    const j1 = Math.min(cells - 1, toI(z1 - 0.01));
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) ground[idx(i, j)] = k;
  };
  const isFree = (x0: number, z0: number, x1: number, z1: number) => {
    for (let x = x0 + 1; x < x1; x += 2)
      for (let z = z0 + 1; z < z1; z += 2) {
        const k = at(x, z);
        if (k < 0 || solid[k] || rock[k]! > 0) return false;
        if (ground[k] !== WK.DESERT) return false;
      }
    return true;
  };

  // ======================================================================
  // 1. keep-out zones: where rock must never grow
  // ======================================================================
  type Zone = { x0: number; z0: number; x1: number; z1: number };
  const clear: Zone[] = [
    { x0: -210, z0: -118, x1: 162, z1: 128 }, // the town
    { x0: -250, z0: 40, x1: -150, z1: 150 }, // the ranch
    { x0: RAIL_X - 10, z0: -195, x1: RAIL_X + 10, z1: 268 }, // the rail line between the portals
    { x0: 150, z0: -12, x1: RING + 30, z1: 16 }, // the east road
    { x0: -RING - 30, z0: -32, x1: -150, z1: 4 }, // the west road
    { x0: -72, z0: 110, x1: -48, z1: RING + 30 }, // the south trail
    { x0: -128, z0: -RING - 30, x1: -114, z1: -110 }, // the slot canyon trail north
  ];
  const inClear = (x: number, z: number, pad = 0) =>
    clear.some((c) => x > c.x0 - pad && x < c.x1 + pad && z > c.z0 - pad && z < c.z1 + pad);
  const inRiver = (x: number, z: number, pad = 0) =>
    Math.abs(z - riverZ(x)) < riverW(x) / 2 + pad;

  // ======================================================================
  // 2. rock: the outer rim, the ring ridge, the north canyon, mesas and buttes
  // ======================================================================
  type Blob = { x: number; z: number; r: number; h: number; ex: number; rot: number };
  const blobs: Blob[] = [
    { x: -242, z: -172, r: 34, h: 36, ex: 1.5, rot: 0.4 }, // "Table Rock" mesa, NW of town
    { x: 238, z: 118, r: 17, h: 46, ex: 1.2, rot: 0.2 }, // "Needle Butte", SE
    { x: 232, z: -118, r: 22, h: 20, ex: 1.8, rot: -0.5 }, // rock fin NE
    { x: -68, z: -166, r: 12, h: 14, ex: 2.6, rot: 0.1 }, // low fin north of town
    { x: 40, z: 234, r: 14, h: 22, ex: 1.3, rot: 0.8 }, // hoodoo rock south of the riverbed
    { x: -210, z: 225, r: 20, h: 26, ex: 1.6, rot: -0.3 }, // SW mesa
    { x: 205, z: 238, r: 10, h: 18, ex: 1.2, rot: 0 }, // small butte near the south portal
    // co-op outer band
    { x: 334, z: -190, r: 22, h: 40, ex: 1.4, rot: 0.3 },
    { x: -336, z: 175, r: 24, h: 34, ex: 1.5, rot: -0.6 },
    { x: 330, z: 60, r: 14, h: 48, ex: 1, rot: 0 },
    { x: -330, z: -240, r: 16, h: 30, ex: 1.2, rot: 0.9 },
    { x: 120, z: 336, r: 18, h: 28, ex: 1.8, rot: 0.2 },
    { x: -150, z: -334, r: 20, h: 36, ex: 1.6, rot: -0.2 },
  ];
  // buttresses and spurs along the ring ridge, so it never reads as a wall
  {
    const hr = (n: number) => hash2(n, 77, seedN);
    const per = RING * 8;
    for (let n = 0; n < 18; n++) {
      const p = hr(n) * per;
      const side = Math.floor(p / (RING * 2));
      const along = (p % (RING * 2)) - RING;
      const off = (hr(n + 100) - 0.45) * 50; // mostly inward
      const bx = side === 0 ? along : side === 1 ? RING - off : side === 2 ? -along : -RING + off;
      const bz = side === 0 ? -RING + off : side === 1 ? along : side === 2 ? RING - off : -along;
      blobs.push({ x: bx, z: bz, r: 10 + hr(n + 200) * 16, h: 14 + hr(n + 300) * 30, ex: 1 + hr(n + 400) * 1.4, rot: hr(n + 500) * 3 });
    }
  }
  const openings: { side: 0 | 1 | 2 | 3; c: number; hw: number }[] = [
    { side: 3, c: -14, hw: 9 }, // west road
    { side: 1, c: 2, hw: 8 }, // east road
    { side: 3, c: riverZ(-RING), hw: riverW(-RING) / 2 + 1 }, // riverbed, west
    { side: 1, c: riverZ(RING), hw: riverW(RING) / 2 + 1 }, // riverbed, east
    { side: 2, c: -60, hw: 7 }, // south trail
    { side: 0, c: -121, hw: 5 }, // slot canyon, north
  ];
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      const x = cc(i);
      const z = cc(j);
      const k = idx(i, j);
      let h = 0;
      const e = Math.max(Math.abs(x), Math.abs(z));
      // outer rim: the hard edge of the co-op map, mesas you can't climb
      const rimStart = half - 16 - 52 * spread(fbm(x * 0.011, z * 0.011, seedN + 1));
      if (e > rimStart) {
        const t = smooth(rimStart, rimStart + 12, e);
        h = Math.max(h, t * (24 + 50 * spread(fbm(x * 0.01, z * 0.01, seedN + 2))));
      }
      // the ring ridge along the solo square: ragged, bulging, broken into buttresses. The
      // ring line itself (|d| < 3) always stays rock, except where the passes are cut.
      const d = e - RING;
      const dw = d + (fbm(x * 0.07, z * 0.07, seedN + 10) - 0.5) * 12;
      const lo = -4 - 30 * spread(fbm(x * 0.011, z * 0.011, seedN + 3));
      const hi = 5 + 42 * spread(fbm(x * 0.009, z * 0.009, seedN + 4));
      if ((dw > lo && dw < hi) || Math.abs(d) < 3) {
        const t = Math.max(Math.min(dw - lo, hi - dw), Math.abs(d) < 3 ? 6 : 0);
        const peak = 8 + 42 * spread(fbm(x * 0.013, z * 0.013, seedN + 5, 3));
        h = Math.max(h, peak * smooth(0, 5, t));
      }
      // the north canyon: tall cliffs behind town, the mine and the rail tunnel in its face
      const face =
        -208 + 44 * (spread(fbm(x * 0.012, 0.5, seedN + 6)) - 0.5) + 9 * Math.sin(x / 31) + 5 * Math.sin(x / 13 + 2);
      if (z < face && Math.abs(x) < RING + 30) {
        const t = smooth(0, 10, face - z);
        h = Math.max(h, t * (24 + 36 * spread(fbm(x * 0.015, z * 0.015, seedN + 7, 5))));
      }
      for (const b of blobs) {
        const dx = x - b.x;
        const dz = z - b.z;
        const reach = b.r * b.ex * 1.3 + 8;
        if (dx > reach || dx < -reach || dz > reach || dz < -reach) continue;
        const c = Math.cos(b.rot);
        const s = Math.sin(b.rot);
        const u = (dx * c - dz * s) / b.ex;
        const w = dx * s + dz * c;
        const dist = Math.hypot(u, w);
        const ang = Math.atan2(w, u);
        const rr = b.r * (0.8 + 0.4 * fbm(Math.cos(ang) * 1.6 + b.x, Math.sin(ang) * 1.6, seedN + 8));
        if (dist < rr) h = Math.max(h, b.h * smooth(0, 6, rr - dist) * (0.85 + 0.3 * fbm(x * 0.05, z * 0.05, seedN + 9)));
      }
      if (h <= 0) continue;
      // carve the passes through the ring ridge
      for (const o of openings) {
        const along = o.side === 0 || o.side === 2 ? x : z;
        const across = o.side === 0 ? -z : o.side === 2 ? z : o.side === 1 ? x : -x;
        if (Math.abs(along - o.c) < o.hw && across > RING - 40 && across < half - 20) h = 0;
      }
      if (inClear(x, z) || (inRiver(x, z, 1) && e < half - 44)) h = 0;
      if (h < 1.2) continue;
      rock[k] = terrace(h, 8);
    }
  }
  // the rail runs through the rock in tunnels: find the portal faces on the line
  const railRock = (z: number) => rock[at(RAIL_X, z)] ?? 0;
  let portalN = -200;
  for (let z = -120; z > -RING - 40; z -= 2)
    if (railRock(z) > 0) {
      portalN = z + 1;
      break;
    }
  let portalS = 270;
  for (let z = 120; z < RING + 40; z += 2)
    if (railRock(z) > 0) {
      portalS = z - 1;
      break;
    }
  // tunnel mouths: make sure the rock right above each portal is tall enough to swallow the train
  for (const [pz, dir] of [
    [portalN, -1],
    [portalS, 1],
  ] as const)
    for (let dz = 1; dz < 24; dz += 2)
      for (let dx = -13; dx <= 13; dx += 2) {
        const k = at(RAIL_X + dx, pz + dir * dz);
        if (k >= 0) rock[k] = Math.max(rock[k]!, 11 + Math.min(dz, 10) - Math.abs(dx) * 0.2);
      }

  for (let k = 0; k < N; k++) if (rock[k]! > 0) ground[k] = WK.ROCK;

  // ======================================================================
  // 3. ground: street, boardwalks, rail, riverbed, trails
  // ======================================================================
  for (let i = 0; i < cells; i++)
    for (let j = 0; j < cells; j++) {
      const x = cc(i);
      const z = cc(j);
      const k = idx(i, j);
      if (rock[k]! > 0) continue;
      if (inRiver(x, z)) ground[k] = WK.RIVER;
    }
  const trail = (pts: [number, number][], w: number) => {
    for (let p = 0; p + 1 < pts.length; p++) {
      const [ax, az] = pts[p]!;
      const [bx, bz] = pts[p + 1]!;
      const len = Math.hypot(bx - ax, bz - az);
      for (let s = 0; s <= len; s += 1) {
        const t = s / len;
        const x = ax + (bx - ax) * t;
        const z = az + (bz - az) * t;
        const ww = w * (0.85 + 0.3 * fbm(x * 0.05, z * 0.05, seedN + 11));
        for (let o = -ww / 2; o <= ww / 2; o += 1) {
          const nx = -(bz - az) / len;
          const nz = (bx - ax) / len;
          const kk = at(x + nx * o, z + nz * o);
          if (kk >= 0 && rock[kk] === 0 && ground[kk] === WK.DESERT) ground[kk] = WK.TRAIL;
        }
      }
    }
  };
  // the stage road west (around the church), the road east, the south trail, the ranch lane,
  // the mine road and the slot-canyon path
  trail(
    [
      [-128, -14],
      [-162, -24],
      [-205, -18],
      [-250, -14],
      [-half, -14],
    ],
    9,
  );
  trail(
    [
      [154, 3],
      [210, 1],
      [270, 3],
      [half, 2],
    ],
    8,
  );
  trail(
    [
      [-22, 118],
      [-40, 150],
      [-60, 200],
      [-60, half],
    ],
    7,
  );
  trail(
    [
      [-128, 14],
      [-165, 40],
      [-200, 78],
    ],
    6,
  );
  trail(
    [
      [120, -40],
      [112, -110],
      [98, -170],
    ],
    6,
  );
  trail(
    [
      [-40, -110],
      [-90, -130],
      [-121, -170],
      [-121, -half],
    ],
    5,
  );

  // Main Street and the cross street
  setGround(-128, -STREET_HALF, 146, STREET_HALF, WK.STREET);
  setGround(-30, -112, -14, 122, WK.STREET);
  // the rail bed (ballast), full length
  for (let z = -half; z < half; z += 2)
    for (let x = RAIL_X - 4; x < RAIL_X + 4; x += 2) {
      const k = at(x + 1, z + 1);
      if (k >= 0 && rock[k] === 0) ground[k] = WK.RAIL;
    }
  // the level crossing keeps the street surface
  setGround(146, -STREET_HALF, RAIL_X + 4, STREET_HALF, WK.STREET);

  // ======================================================================
  // 4. the town
  // ======================================================================
  const bld = (b: Omit<WBld, "seed" | "tone"> & { tone?: number }) => {
    const full: WBld = { ...b, seed: Math.floor(rand() * 1e9), tone: b.tone ?? rand() };
    buildings.push(full);
    markSolid(b.x0, b.z0, b.x1, b.z1, b.storeys * STOREY + 2);
    setGround(b.x0, b.z0, b.x1, b.z1, WK.LOT);
    return full;
  };
  const prop = (k: WPropKind, x: number, z: number, rot = 0, s = 1, a?: number) => {
    props.push(a === undefined ? { k, x, z, rot, s } : { k, x, z, rot, s, a });
  };
  /** a prop that also blocks: collision rectangle centred on it */
  const solidProp = (
    k: WPropKind,
    x: number,
    z: number,
    rot: number,
    w: number,
    d: number,
    h: number,
    s = 1,
  ) => {
    prop(k, x, z, rot, s);
    const c = Math.abs(Math.cos(rot));
    const sn = Math.abs(Math.sin(rot));
    const hw = (w * c + d * sn) / 2;
    const hd = (w * sn + d * c) / 2;
    markSolid(x - hw, z - hd, x + hw, z + hd, h);
  };

  const PAINT_FILLER = [
    W["GUNSMITH"],
    W["DOCTOR"],
    W["GAZETTE"],
    W["BATHS"],
    W["FEED & SEED"],
    W["LAND OFFICE"],
    W["EATS"],
    W["TELEGRAPH"],
    W["DRY GOODS"],
    W["BARBER"],
    W["POST OFFICE"],
    W["ASSAY OFFICE"],
  ];
  let fillerAt = Math.floor(rand() * PAINT_FILLER.length);
  const nextFiller = () => PAINT_FILLER[fillerAt++ % PAINT_FILLER.length]!;
  const pickMat = (): WMat => {
    const r = rand();
    return r < 0.52 ? "clap" : r < 0.82 ? "board" : r < 0.93 ? "adobe" : "brick";
  };

  /** one row of false-front buildings along Main Street; `north` = the row on the -z side */
  type Plan = { w: number; t: WType; sign: number; storeys: number; mat?: WMat; porch?: 0 | 1 | 2; ff?: 0 | 1 | 2 | 3; d?: number };
  const row = (north: boolean, x0: number, x1: number, fixed: Plan[]) => {
    const zf = north ? -STREET_HALF - BOARD_D : STREET_HALF + BOARD_D; // building front line
    const front = north ? 2 : 0;
    let x = x0;
    const plans = [...fixed];
    // fill the rest of the frontage with ordinary shops
    let used = plans.reduce((s, p) => s + p.w + 2, 0);
    while (used < x1 - x0 - 10) {
      const w = 8 + Math.floor(rand() * 4) * 2;
      if (used + w > x1 - x0) break;
      const storeys = rand() < 0.45 ? 2 : 1;
      plans.push({ w, t: "store", sign: nextFiller(), storeys });
      used += w + 2;
    }
    // interleave the landmarks with the fillers deterministically
    const fillers = plans.slice(fixed.length);
    const order: Plan[] = [];
    const every = Math.max(1, Math.round(fillers.length / (fixed.length + 1)));
    let fi = 0;
    for (let li = 0; li < fixed.length; li++) {
      for (let n = 0; n < every && fi < fillers.length; n++) order.push(fillers[fi++]!);
      order.push(fixed[li]!);
    }
    while (fi < fillers.length) order.push(fillers[fi++]!);
    for (const p of order) {
      const gap = rand() < 0.35 ? 4 : 2; // alleys between buildings (flanking routes)
      if (x + p.w > x1) break;
      const d = p.d ?? 14 + Math.floor(rand() * 4) * 2;
      const bz0 = north ? zf - d : zf;
      const bz1 = north ? zf : zf + d;
      const mat = p.mat ?? pickMat();
      const porch = p.porch ?? (p.storeys > 1 && rand() < 0.5 ? 2 : rand() < 0.8 ? 1 : 0);
      bld({
        t: p.t,
        x0: x,
        z0: bz0,
        x1: x + p.w,
        z1: bz1,
        front,
        storeys: p.storeys,
        mat,
        sign: p.sign,
        porch,
        ff: p.ff ?? (mat === "adobe" ? 0 : ((1 + Math.floor(rand() * 3)) as 1 | 2 | 3)),
        roof: mat === "adobe" ? "flat" : rand() < 0.7 ? "gable" : "shed",
      });
      // boardwalk in front (walkable deck), hitching rail + trough on the street edge
      setGround(x - (gap > 2 ? 0 : 1), north ? zf : zf - BOARD_D, x + p.w + 1, north ? zf + BOARD_D : zf, WK.BOARD);
      const edge = north ? -STREET_HALF + 0.6 : STREET_HALF - 0.6;
      if (p.t !== "smithy" && rand() < 0.75) {
        const hx = x + p.w * (0.3 + rand() * 0.4);
        prop("hitch", hx, edge, 0, Math.min(4, p.w * 0.4));
        if (rand() < 0.45) solidProp("trough", hx + 3.2, edge - (north ? -0.1 : 0.1), 0, 2.4, 0.8, 0.8);
      }
      if (rand() < 0.5)
        prop(rand() < 0.5 ? "barrels" : "crates", x + 1 + rand() * (p.w - 2), north ? zf + 0.8 : zf - 0.8, rand() * 6.28, 0.8 + rand() * 0.4);
      if (rand() < 0.55) prop("bench", x + p.w / 2 + (rand() - 0.5) * 3, north ? zf + 0.6 : zf - 0.6, north ? 0 : Math.PI);
      // porch lanterns
      if (porch > 0) prop("lantern", x + p.w / 2, north ? zf + BOARD_D - 0.2 : zf - BOARD_D + 0.2, 0, 1, 2.9);
      // back lot clutter
      const back = north ? bz0 - 3 : bz1 + 3;
      if (rand() < 0.35) solidProp("outhouse", x + 2 + rand() * (p.w - 4), back - (north ? 4 : -4), 0, 1.6, 1.6, 2.4);
      else if (rand() < 0.4) prop("woodpile", x + p.w / 2, back, rand() * 0.3, 1);
      else if (rand() < 0.3) prop("barrels", x + p.w / 2, back, rand(), 1);
      x += p.w + gap;
    }
  };

  // north row, west block and east block
  row(true, -124, -32, [
    { w: 18, t: "hotel", sign: W["HOTEL"], storeys: 3, mat: "clap", porch: 2, ff: 1, d: 18 },
    { w: 14, t: "store", sign: W["GENERAL STORE"], storeys: 2, mat: "board", porch: 1, ff: 2 },
    { w: 8, t: "store", sign: W["BARBER"], storeys: 1, porch: 1 },
  ]);
  row(true, -12, 120, [
    { w: 22, t: "saloon", sign: W["SALOON"], storeys: 2, mat: "clap", porch: 2, ff: 3, d: 20 },
    { w: 16, t: "opera", sign: W["OPERA HOUSE"], storeys: 2, mat: "brick", porch: 0, ff: 3, d: 20 },
    { w: 10, t: "store", sign: W["TELEGRAPH"], storeys: 1, porch: 1 },
    { w: 10, t: "store", sign: W["UNDERTAKER"], storeys: 1, mat: "board", porch: 1 },
  ]);
  row(false, -124, -32, [
    { w: 14, t: "store", sign: W["DRY GOODS"], storeys: 2, porch: 1 },
    { w: 10, t: "store", sign: W["ASSAY OFFICE"], storeys: 1, mat: "board", porch: 1 },
    { w: 16, t: "bank", sign: W["BANK"], storeys: 2, mat: "brick", porch: 0, ff: 1, d: 16 },
  ]);
  row(false, -12, 118, [
    { w: 16, t: "sheriff", sign: W["SHERIFF"], storeys: 1, mat: "stone", porch: 1, ff: 1 },
    { w: 12, t: "smithy", sign: W["BLACKSMITH"], storeys: 1, mat: "board", porch: 0, ff: 0 },
    { w: 24, t: "stable", sign: W["LIVERY"], storeys: 2, mat: "barn", porch: 0, ff: 0, d: 20 },
  ]);

  // the church closes the west end of Main Street; the sun sets behind its bell tower
  const church = { x: -131, z: 0, h: 26 };
  bld({
    t: "church",
    x0: -152,
    z0: -6,
    x1: -132,
    z1: 6,
    front: 1,
    storeys: 2,
    mat: "white",
    sign: -1,
    porch: 0,
    ff: 0,
    roof: "gable",
    tone: 0.5,
  });
  markSolid(-132, -3, -127, 3, 26); // the bell tower on the front
  setGround(-162, -20, -128, 20, WK.YARD);
  for (let z = -20; z <= 20; z += 2.5) {
    if (Math.abs(z) < 5) continue; // the gate
    prop("fence", -126.5, z, Math.PI / 2, 2.5, 1);
  }
  // Boot Hill
  for (let n = 0; n < 26; n++) {
    const gx = -200 + (n % 7) * 5 + (rand() - 0.5) * 1.5;
    const gz = -58 + Math.floor(n / 7) * 6 + (rand() - 0.5) * 1.5;
    prop(rand() < 0.6 ? "cross" : "grave", gx, gz, (rand() - 0.5) * 0.3, 0.9 + rand() * 0.3);
  }
  prop("deadtree", -168, -52, 0.4, 1.3);

  // the station at the east end of Main Street
  const station = { x: 143, z: -40 };
  bld({
    t: "station",
    x0: 124,
    z0: -38,
    x1: 138,
    z1: -16,
    front: 1,
    storeys: 1,
    mat: "clap",
    sign: W["DRY GULCH"],
    porch: 0,
    ff: 0,
    roof: "hip",
    tone: 0.3,
  });
  setGround(138, -84, 146, -14, WK.PLATFORM);
  setGround(124, -84, 138, -38, WK.YARD);
  solidProp("watertower", 142, -96, 0, 7, 7, 16);
  prop("cart", 141.5, -30, 0, 1);
  prop("crates", 141.5, -46, 0.2, 1);
  prop("barrels", 140.8, -22, 0, 1);
  prop("bench", 139.2, -27, -Math.PI / 2);
  prop("lantern", 139, -18, 0, 1, 3);
  prop("lantern", 139, -36, 0, 1, 3);
  prop("crossbuck", 145, 14, 0, 1);
  prop("crossbuck", 155, -14, Math.PI, 1);
  // freight yard and stock pens south of the crossing
  bld({
    t: "shed",
    x0: 124,
    z0: 18,
    x1: 142,
    z1: 30,
    front: 1,
    storeys: 1,
    mat: "barn",
    sign: -1,
    porch: 0,
    ff: 0,
    roof: "gable",
  });
  setGround(158, 18, 196, 50, WK.YARD);
  for (let x = 158; x <= 196; x += 2.5) {
    prop("fence", x, 18, 0, 2.5, 1);
    prop("fence", x, 50, 0, 2.5, 1);
  }
  for (let z = 18; z <= 50; z += 2.5) {
    if (z > 26 && z < 34) continue;
    prop("fence", 158, z, Math.PI / 2, 2.5, 1);
    prop("fence", 196, z, Math.PI / 2, 2.5, 1);
  }
  markSolid(158, 17, 196, 19, 1.3);
  markSolid(158, 49, 196, 51, 1.3);
  markSolid(157, 17, 159, 26, 1.3);
  markSolid(157, 34, 159, 51, 1.3);
  markSolid(195, 17, 197, 51, 1.3);
  solidProp("trough", 176, 36, 0, 3, 1, 0.8);
  prop("hay", 188, 26, 0.3, 1);
  prop("hay", 166, 44, 1.1, 1);
  // telegraph poles along the line
  for (let z = -190; z < 262; z += 34) prop("pole", RAIL_X + 7, z, 0, 1);

  // the livery corral behind the stable
  const stable = buildings.find((b) => b.t === "stable")!;
  {
    const cx0 = stable.x0 - 4;
    const cx1 = stable.x1 + 8;
    const cz0 = stable.z1 + 2;
    const cz1 = stable.z1 + 30;
    setGround(cx0, cz0, cx1, cz1, WK.YARD);
    for (let x = cx0; x <= cx1; x += 2.5) {
      prop("fence", x, cz1, 0, 2.5, 1);
      if (x < stable.x0 + 2 || x > stable.x1 - 2) prop("fence", x, cz0, 0, 2.5, 1);
    }
    for (let z = cz0; z <= cz1; z += 2.5) {
      prop("fence", cx0, z, Math.PI / 2, 2.5, 1);
      if (z < cz1 - 10) prop("fence", cx1, z, Math.PI / 2, 2.5, 1);
    }
    markSolid(cx0, cz1 - 1, cx1, cz1 + 1, 1.3);
    markSolid(cx0 - 1, cz0, cx0 + 1, cz1, 1.3);
    markSolid(cx1 - 1, cz0, cx1 + 1, cz1 - 10, 1.3);
    solidProp("trough", (cx0 + cx1) / 2, cz0 + 12, 0, 3, 1, 0.8);
    prop("hay", cx0 + 4, cz0 + 20, 0.2, 1);
    prop("hay", cx0 + 7, cz0 + 21, 1.4, 1);
  }
  // the blacksmith's yard: anvil, wagon wheels, a quench barrel
  const smithy = buildings.find((b) => b.t === "smithy")!;
  prop("anvil", (smithy.x0 + smithy.x1) / 2, smithy.z0 - 2.2, 0.3, 1);
  prop("wheel", smithy.x0 + 1.2, smithy.z0 - 1.2, 0, 1);
  prop("wheel", smithy.x1 - 1.4, smithy.z0 - 1.1, 0.3, 1);

  // wagons and clutter out on Main Street (cover down the middle)
  const wagonSpots: [number, number, number][] = [
    [-92, -5, 0.08],
    [-58, 6, -0.12],
    [18, -6, 0.1],
    [46, 5.5, 3.2],
    [84, -4.5, 0.05],
    [108, 6, -0.2],
  ];
  wagonSpots.forEach(([x, z, r], n) =>
    solidProp(n % 2 === 0 ? "covered" : "wagon", x, z, r + Math.PI / 2, 2.2, 5.2, 2.6),
  );
  solidProp("well", -22, 0, 0, 2.6, 2.6, 1.2);
  solidProp("barrels", -40, -9.5, 0.3, 1.4, 1.4, 1.1);
  solidProp("crates", 64, 9.4, 0.4, 1.6, 1.6, 1.4);
  solidProp("barrels", 96, 9.6, 1.2, 1.4, 1.4, 1.1);
  solidProp("crates", -74, -9.2, 0.1, 1.6, 1.6, 1.4);
  for (let x = -110; x < 125; x += 36) {
    prop("streetlamp", x, -STREET_HALF + 0.4, 0, 1);
    prop("streetlamp", x + 18, STREET_HALF - 0.4, Math.PI, 1);
  }

  // houses, shacks and adobes in the back lots; a tent town by the tracks
  const scatterBld = (
    t: WType,
    mat: WMat,
    n: number,
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    wMin: number,
    wMax: number,
  ) => {
    for (let tries = 0, made = 0; made < n && tries < n * 30; tries++) {
      const w = wMin + Math.floor(rand() * ((wMax - wMin) / 2 + 1)) * 2;
      const d = wMin + Math.floor(rand() * ((wMax - wMin) / 2 + 1)) * 2;
      const x = Math.round((x0 + rand() * (x1 - x0 - w)) / 2) * 2;
      const z = Math.round((z0 + rand() * (z1 - z0 - d)) / 2) * 2;
      if (!isFree(x - 4, z - 4, x + w + 4, z + d + 4)) continue;
      const fronts = [0, 1, 2, 3] as const;
      bld({
        t,
        x0: x,
        z0: z,
        x1: x + w,
        z1: z + d,
        front: fronts[Math.floor(rand() * 4)]!,
        storeys: 1,
        mat,
        sign: -1,
        porch: t === "house" && rand() < 0.6 ? 1 : 0,
        ff: 0,
        roof: mat === "adobe" ? "flat" : t === "tent" ? "gable" : rand() < 0.6 ? "gable" : "shed",
      });
      made++;
    }
  };
  scatterBld("house", "clap", 7, -120, -86, -36, -40, 6, 10);
  scatterBld("shack", "board", 6, -8, -92, 110, -42, 4, 8);
  scatterBld("tent", "board", 9, 60, -110, 118, -50, 4, 6);
  scatterBld("adobe", "adobe", 8, -124, 44, -40, 104, 6, 10);
  scatterBld("house", "clap", 5, -8, 44, 100, 100, 6, 10);
  scatterBld("shack", "board", 4, 20, 60, 118, 110, 4, 6);

  // the windmill ranch, south-west of town (the night campfire burns here)
  bld({
    t: "ranch",
    x0: -216,
    z0: 52,
    x1: -198,
    z1: 64,
    front: 1,
    storeys: 1,
    mat: "log",
    sign: -1,
    porch: 1,
    ff: 0,
    roof: "gable",
  });
  bld({
    t: "barn",
    x0: -240,
    z0: 82,
    x1: -222,
    z1: 104,
    front: 1,
    storeys: 2,
    mat: "barn",
    sign: -1,
    porch: 0,
    ff: 0,
    roof: "gable",
  });
  setGround(-246, 46, -168, 140, WK.YARD);
  solidProp("windmill", -186, 92, 0.6, 3, 3, 13);
  solidProp("tank", -180, 100, 0, 5, 5, 1.1);
  const campfire = { x: -192, z: 70 };
  prop("campfire", campfire.x, campfire.z, 0, 1);
  prop("bench", campfire.x - 2.6, campfire.z, Math.PI / 2, 1);
  prop("bench", campfire.x + 2.6, campfire.z, -Math.PI / 2, 1);
  solidProp("covered", -176, 64, 0.5, 2.2, 5.2, 2.6);
  // corral
  {
    const x0 = -220;
    const x1 = -176;
    const z0 = 110;
    const z1 = 138;
    for (let x = x0; x <= x1; x += 2.5) {
      prop("fence", x, z1, 0, 2.5, 1);
      if (x < -205 || x > -195) prop("fence", x, z0, 0, 2.5, 1);
    }
    for (let z = z0; z <= z1; z += 2.5) {
      prop("fence", x0, z, Math.PI / 2, 2.5, 1);
      prop("fence", x1, z, Math.PI / 2, 2.5, 1);
    }
    markSolid(x0, z1 - 1, x1, z1 + 1, 1.3);
    markSolid(x0, z0 - 1, -205, z0 + 1, 1.3);
    markSolid(-195, z0 - 1, x1, z0 + 1, 1.3);
    markSolid(x0 - 1, z0, x0 + 1, z1, 1.3);
    markSolid(x1 - 1, z0, x1 + 1, z1, 1.3);
    prop("hay", -210, 124, 0.3, 1);
    solidProp("trough", -190, 126, 0, 3, 1, 0.8);
  }

  // the mine: a timbered portal in the north canyon face, ore-cart rails down to a tipple
  let mineZ = -200;
  const mineX = 96;
  for (let z = -110; z > -RING; z -= 2)
    if ((rock[at(mineX, z)] ?? 0) > 0) {
      mineZ = z + 1;
      break;
    }
  // the rock right around the portal is sheer and tall
  for (let dz = 1; dz < 20; dz += 2)
    for (let dx = -9; dx <= 9; dx += 2) {
      const k = at(mineX + dx, mineZ - dz);
      if (k >= 0) {
        rock[k] = Math.max(rock[k]!, 12 + dz * 0.6);
        ground[k] = WK.ROCK;
      }
    }
  const mine = { x: mineX, z: mineZ };
  setGround(mineX - 14, mineZ, mineX + 18, mineZ + 34, WK.YARD);
  bld({
    t: "tipple",
    x0: mineX + 8,
    z0: mineZ + 18,
    x1: mineX + 16,
    z1: mineZ + 28,
    front: 3,
    storeys: 2,
    mat: "board",
    sign: W["MINE CO."],
    porch: 0,
    ff: 0,
    roof: "shed",
  });
  solidProp("orecart", mineX + 0.2, mineZ + 6, 0, 1.4, 2.2, 1.4);
  prop("orecart", mineX + 3, mineZ + 13, 0.25, 1);
  prop("lantern", mineX - 2.4, mineZ + 0.4, 0, 1, 3.4);
  prop("lantern", mineX + 2.4, mineZ + 0.4, 0, 1, 3.4);
  prop("crates", mineX - 6, mineZ + 5, 0.3, 1);
  prop("barrels", mineX - 7, mineZ + 9, 0.8, 1);
  prop("woodpile", mineX + 7, mineZ + 5, 0.1, 1.2);
  // tailings heap beside the portal
  for (let dz = 2; dz < 14; dz += 2)
    for (let dx = -18; dx < -10; dx += 2) {
      const k = at(mineX + dx, mineZ + dz);
      if (k >= 0 && !solid[k]) {
        const r = Math.hypot(dx + 14, dz - 7) / 7;
        if (r < 1) {
          rock[k] = Math.max(rock[k]!, 3 * (1 - r * r) + 1.3);
          ground[k] = WK.ROCK;
        }
      }
    }

  // ======================================================================
  // 5. the railroad: embankments up to the trestle over the riverbed
  // ======================================================================
  const rz = riverZ(RAIL_X);
  const rw = riverW(RAIL_X);
  const trestle = { z0: rz - rw / 2 - 8, z1: rz + rw / 2 + 8 };
  const RAMP = 44;
  const railY = (z: number) => {
    if (z < trestle.z0 - RAMP || z > trestle.z1 + RAMP) return 0;
    if (z < trestle.z0) return TRESTLE_Y * smooth(trestle.z0 - RAMP, trestle.z0, z);
    if (z > trestle.z1) return TRESTLE_Y * smooth(trestle.z1 + RAMP, trestle.z1, z);
    return TRESTLE_Y;
  };
  for (let z = trestle.z0 - RAMP; z < trestle.z1 + RAMP; z += 2) {
    const y = railY(z + 1);
    if (z + 1 > trestle.z0 && z + 1 < trestle.z1) continue;
    // fill embankment: walls you can't climb once it is more than knee high
    if (y > 0.7) markSolid(RAIL_X - 5, z, RAIL_X + 5, z + 2, y + 0.4);
  }
  // trestle bents: timber towers every 6 m you can walk between
  for (let z = trestle.z0 + 4; z < trestle.z1 - 2; z += 6) markSolid(RAIL_X - 3, z - 0.5, RAIL_X + 3, z + 0.5, TRESTLE_Y);

  // ======================================================================
  // 6. co-op outer band: a second homestead, a prospector camp, a stage-relay ruin
  // ======================================================================
  const coopBld = (b: Omit<WBld, "seed" | "tone" | "coop">) => {
    if (!isFree(b.x0 - 2, b.z0 - 2, b.x1 + 2, b.z1 + 2)) return;
    bld({ ...b, coop: true });
  };
  coopBld({ t: "house", x0: -344, z0: 90, x1: -332, z1: 100, front: 1, storeys: 1, mat: "log", sign: -1, porch: 1, ff: 0, roof: "gable" });
  coopBld({ t: "barn", x0: -350, z0: 110, x1: -336, z1: 126, front: 1, storeys: 1, mat: "barn", sign: -1, porch: 0, ff: 0, roof: "gable" });
  coopBld({ t: "tent", x0: 318, z0: 318, x1: 324, z1: 324, front: 3, storeys: 1, mat: "board", sign: -1, porch: 0, ff: 0, roof: "gable" });
  coopBld({ t: "tent", x0: 330, z0: 312, x1: 335, z1: 318, front: 3, storeys: 1, mat: "board", sign: -1, porch: 0, ff: 0, roof: "gable" });
  coopBld({ t: "shack", x0: 340, z0: 326, x1: 346, z1: 332, front: 3, storeys: 1, mat: "board", sign: -1, porch: 0, ff: 0, roof: "shed" });
  coopBld({ t: "ruin", x0: -330, z0: -318, x1: -314, z1: -306, front: 0, storeys: 1, mat: "adobe", sign: -1, porch: 0, ff: 0, roof: "flat" });
  coopBld({ t: "ruin", x0: -306, z0: -322, x1: -298, z1: -314, front: 0, storeys: 1, mat: "adobe", sign: -1, porch: 0, ff: 0, roof: "flat" });
  prop("windmill", -326, 104, 0.2, 0.9);
  prop("campfire", 328, 326, 0, 0.8);
  prop("covered", 312, 330, 1.2, 1);
  prop("arch", 318, -318, 0.6, 1);

  // ======================================================================
  // 7. the desert: saguaro, prickly pear, brush, boulders, bleached bones
  // ======================================================================
  const desertCell = (x: number, z: number, pad: number) => {
    for (let dx = -pad; dx <= pad; dx += 2)
      for (let dz = -pad; dz <= pad; dz += 2) {
        const k = at(x + dx, z + dz);
        if (k < 0 || solid[k] || rock[k]! > 0) return false;
        const g = ground[k]!;
        if (g === WK.STREET || g === WK.BOARD || g === WK.RAIL || g === WK.PLATFORM || g === WK.LOT) return false;
      }
    return true;
  };
  const townish = (x: number, z: number) => x > -165 && x < 160 && z > -100 && z < 110;
  const core = (x: number, z: number) => x > -132 && x < 126 && z > -48 && z < 48;
  for (let n = 0; n < 5200; n++) {
    const x = (rand() - 0.5) * (half * 2 - 20);
    const z = (rand() - 0.5) * (half * 2 - 20);
    const dens = fbm(x * 0.008, z * 0.008, seedN + 20);
    const r = rand();
    if (core(x, z) || (townish(x, z) && r < 0.8)) continue;
    const k = at(x, z);
    if (k < 0) continue;
    const g = ground[k]!;
    if (g === WK.RIVER) {
      if (r < 0.2 && desertCell(x, z, 0)) prop(r < 0.1 ? "boulder" : "bush", x, z, rand() * 6.28, 0.5 + rand() * 0.7);
      continue;
    }
    if (g === WK.TRAIL || g === WK.YARD) continue;
    if (r < 0.1 + dens * 0.18) {
      if (desertCell(x, z, 2)) prop("saguaro", x, z, rand() * 6.28, 0.7 + rand() * 0.75);
    } else if (r < 0.38) {
      if (desertCell(x, z, 0)) prop("pear", x, z, rand() * 6.28, 0.6 + rand() * 0.8);
    } else if (r < 0.46) {
      if (desertCell(x, z, 0)) prop("barrelcactus", x, z, rand() * 6.28, 0.7 + rand() * 0.6);
    } else if (r < 0.82) {
      if (desertCell(x, z, 0)) prop("bush", x, z, rand() * 6.28, 0.6 + rand() * 0.9);
    } else if (r < 0.9) {
      if (desertCell(x, z, 0)) prop("tumble", x, z, rand() * 6.28, 0.6 + rand() * 0.5);
    } else if (r < 0.905) {
      if (desertCell(x, z, 0)) prop("bones", x, z, rand() * 6.28, 1);
    } else if (r < 0.915) {
      if (desertCell(x, z, 2)) prop("deadtree", x, z, rand() * 6.28, 0.8 + rand() * 0.6);
    }
  }
  // boulders: real cover out in the open (solid)
  let boulders = 0;
  for (let n = 0; n < 900 && boulders < 260; n++) {
    const x = Math.round(((rand() - 0.5) * (half * 2 - 30)) / 2) * 2;
    const z = Math.round(((rand() - 0.5) * (half * 2 - 30)) / 2) * 2;
    if (townish(x, z)) continue;
    // boulders gather at the foot of the rock
    let nearRock = false;
    for (let dx = -8; dx <= 8 && !nearRock; dx += 4)
      for (let dz = -8; dz <= 8; dz += 4) if ((rock[at(x + dx, z + dz)] ?? 0) > 0) nearRock = true;
    if (!nearRock && rand() < 0.6) continue;
    const big = rand() < 0.45;
    const w = big ? 4 : 2;
    if (!desertCell(x, z, big ? 4 : 2)) continue;
    const g = ground[at(x, z)]!;
    if (g === WK.TRAIL) continue;
    solidProp("boulder", x, z, rand() * 6.28, w, w, big ? 2.4 : 1.4, big ? 1.9 + rand() * 0.6 : 1 + rand() * 0.3);
    boulders++;
  }

  // ======================================================================
  // 8. collision for the rock, then connectivity from the spawn
  // ======================================================================
  for (let i = 0; i < cells; i++)
    for (let j = 0; j < cells; j++) {
      const k = idx(i, j);
      if (rock[k]! > 0 && !solid[k]) {
        solid[k] = 1;
        blocks.push({ x: cc(i), z: cc(j), h: rock[k]!, tone: 0 });
      }
    }
  const spawn = { x: 2, z: -2 };
  const si = toI(spawn.x);
  const sj = toI(spawn.z);
  const seen = new Uint8Array(N);
  const q = new Int32Array(N);
  let tail = 0;
  q[tail++] = idx(si, sj);
  seen[idx(si, sj)] = 1;
  for (let h = 0; h < tail; h++) {
    const c = q[h]!;
    const ci = Math.floor(c / cells);
    const cj = c - ci * cells;
    const nb = [c - cells, c + cells, c - 1, c + 1];
    const ok = [ci > 1, ci < cells - 2, cj > 1, cj < cells - 2];
    for (let k = 0; k < 4; k++) {
      if (!ok[k]) continue;
      const nn = nb[k]!;
      if (seen[nn] || solid[nn]) continue;
      seen[nn] = 1;
      q[tail++] = nn;
    }
  }
  let sealed = 0;
  for (let i = 0; i < cells; i++)
    for (let j = 0; j < cells; j++) {
      const c = idx(i, j);
      if (seen[c] || solid[c]) continue;
      sealed++;
      solid[c] = 1;
      blocks.push({ x: cc(i), z: cc(j), h: 1, tone: 0 });
    }

  const layout: WesternLayout = {
    kind: "western",
    cells,
    half,
    soloHalf: S,
    ground,
    solid,
    rock,
    buildings,
    props,
    portals: { n: portalN, s: portalS },
    trestle,
    railY,
    river: { z: riverZ, w: riverW },
    mine,
    station,
    church,
    spawn,
    spawnYaw: Math.PI / 2, // looking west, down Main Street at the church and the sunset
    campfire,
    extent: half + 3000,
  };
  return { blocks, layout, sealed };
}
