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
import type { Terrain } from "../terrain";
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
export const BOARD_D = 4;
export const DECK_Y = 0.28; // boardwalk deck height
export const STOREY = 3.5;
export const TRESTLE_Y = 6.5;
/** the saloon balcony floor and the church belfry floor: high ground you can climb to */
export const BALCONY_Y = 3.5;
/** where the saloon's walkable gallery starts, out from its facade: the gallery runs along the
 * porch's street edge, and the walkway under the rest of the porch stays open at deck height */
export const SALOON_GALLERY = 2.1;
export const BELFRY_Y = 9.5;
/** the dry riverbed is carved this far below grade, its banks sloping out over RIVER_BANK m */
export const RIVER_D = 1.3;
export const RIVER_BANK = 3.5;
/** half-width of the carved corridor beyond the riverbed's own half-width */
export const RIVER_EDGE = 2.5;
/** the carved riverbed ends this far inside the map edge (the rim) */
export const RIVER_END = 44;

/** Height of a layout terrain at (x, z): bilinear, exactly like the game's groundY(). */
export function sampleTerrain(t: Terrain, x: number, z: number) {
  const n = t.n;
  let fx = (x + t.half) / t.cell;
  let fz = (z + t.half) / t.cell;
  fx = Math.max(0, Math.min(n - 1e-4, fx));
  fz = Math.max(0, Math.min(n - 1e-4, fz));
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const u = fx - i;
  const v = fz - j;
  const s = n + 1;
  const a = t.h[i * s + j]!;
  const b = t.h[(i + 1) * s + j]!;
  const c = t.h[i * s + j + 1]!;
  const d = t.h[(i + 1) * s + j + 1]!;
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

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
  | "horse"
  | "stagecoach"
  | "sacks"
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
  /** walkable height (boardwalks, the saloon balcony and its stairs, the church stairs and
   * belfry): installed as the game's terrain, climb-limited so walls stay walls */
  terrain: Terrain;
  /** the saloon's outside staircase: the alley strip it climbs, bottom to top */
  saloonStairs: { x0: number; x1: number; zBottom: number; zTop: number; zEdge: number } | null;
  /** thin collision circles for small props and porch posts (see level.ts setPosts) */
  posts: { x: number; z: number; r: number; shot?: boolean }[];
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
  let h =
    (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263) + Math.imul(s, 2147483647)) | 0;
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
  /** thin collision circles (porch posts, cactus, barrels...), installed through level.ts setPosts */
  const posts: { x: number; z: number; r: number; shot?: boolean }[] = [];
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
  const inRiver = (x: number, z: number, pad = 0) => Math.abs(z - riverZ(x)) < riverW(x) / 2 + pad;

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
      blobs.push({
        x: bx,
        z: bz,
        r: 10 + hr(n + 200) * 16,
        h: 14 + hr(n + 300) * 30,
        ex: 1 + hr(n + 400) * 1.4,
        rot: hr(n + 500) * 3,
      });
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
        -208 +
        44 * (spread(fbm(x * 0.012, 0.5, seedN + 6)) - 0.5) +
        9 * Math.sin(x / 31) +
        5 * Math.sin(x / 13 + 2);
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
        const rr =
          b.r * (0.8 + 0.4 * fbm(Math.cos(ang) * 1.6 + b.x, Math.sin(ang) * 1.6, seedN + 8));
        if (dist < rr)
          h = Math.max(
            h,
            b.h * smooth(0, 6, rr - dist) * (0.85 + 0.3 * fbm(x * 0.05, z * 0.05, seedN + 9)),
          );
      }
      if (h <= 0) continue;
      // carve the passes through the ring ridge
      for (const o of openings) {
        const along = o.side === 0 || o.side === 2 ? x : z;
        const across = o.side === 0 ? -z : o.side === 2 ? z : o.side === 1 ? x : -x;
        if (Math.abs(along - o.c) < o.hw && across > RING - 40 && across < half - 20) h = 0;
      }
      if (inClear(x, z) || (inRiver(x, z, 1) && e < half - 44)) h = 0;
      // co-op: a wagon trail loops round the outer desert between the ridges and the rim, so
      // every part of it connects (the north side stays solid canyon)
      const loopE = RING + (half - RING) * 0.5;
      if (Math.abs(e - loopE) < 5 && !(z < -RING && Math.abs(x) < RING - 30)) h = 0;
      if (h < 1.2) continue;
      rock[k] = terrace(h, 8);
    }
  }
  // no slot canyons: open ground squeezed between rock less than 6 m apart is filled in
  // (a 2-4 m crack reads as a path, but it is a trap for the player and no enemy can follow)
  for (let pass = 0; pass < 3; pass++) {
    const fill: [number, number][] = [];
    const rk = (i: number, j: number) => (inside(i, j) ? rock[idx(i, j)]! : 0);
    for (let i = 2; i < cells - 2; i++)
      for (let j = 2; j < cells - 2; j++) {
        if (rock[idx(i, j)]! > 0) continue;
        const x = cc(i);
        const z = cc(j);
        if (inClear(x, z) || inRiver(x, z, 1)) continue;
        const ax = Math.max(rk(i - 1, j), rk(i - 2, j));
        const bx = Math.max(rk(i + 1, j), rk(i + 2, j));
        const az = Math.max(rk(i, j - 1), rk(i, j - 2));
        const bz = Math.max(rk(i, j + 1), rk(i, j + 2));
        if (ax > 0 && bx > 0) fill.push([idx(i, j), Math.min(ax, bx)]);
        else if (az > 0 && bz > 0) fill.push([idx(i, j), Math.min(az, bz)]);
      }
    if (!fill.length) break;
    for (const [k, h] of fill) rock[k] = h;
  }
  // the rail is either in a real tunnel or in the open: a rock stretch shorter than 12 m
  // along the line would get no portal (the train would ghost through a lump of cliff), so
  // it is cut away; and in the open, no rock may reach into the 10 m wide cutting the train
  // runs through (a spur clipping the cars)
  {
    const railCell = (z: number) => at(RAIL_X, z);
    const onRock = (z: number) => (rock[railCell(z)] ?? 0) > 0;
    for (let z = -half + 1; z < half; ) {
      if (!onRock(z)) {
        z += 2;
        continue;
      }
      let e = z;
      while (e < half && onRock(e)) e += 2;
      if (e - z < 12) for (let zz = z; zz < e; zz += 2) rock[railCell(zz)] = 0;
      z = e;
    }
    for (let z = -half + 1; z < half; z += 2) {
      if (onRock(z)) {
        // inside a tunnel the rock covers the whole cutting, so no car shows through a side
        const h = rock[railCell(z)]!;
        for (let dx = -5; dx <= 5; dx += 2) {
          const k = at(RAIL_X + dx, z);
          if (k >= 0) rock[k] = Math.max(rock[k]!, h);
        }
        continue;
      }
      for (let dx = -5; dx <= 5; dx += 2) {
        const k = at(RAIL_X + dx, z);
        if (k >= 0) rock[k] = 0;
      }
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
    // a house's front porch (deck, posts, a little roof) blocks too
    if (b.porch > 0 && (b.t === "house" || b.t === "ranch")) {
      const d = 2.2;
      if (b.front === 0) markSolid(b.x0 + 0.5, b.z0 - d, b.x1 - 0.5, b.z0, 3);
      else if (b.front === 2) markSolid(b.x0 + 0.5, b.z1, b.x1 - 0.5, b.z1 + d, 3);
      else if (b.front === 1) markSolid(b.x1, b.z0 + 0.5, b.x1 + d, b.z1 - 0.5, 3);
      else markSolid(b.x0 - d, b.z0 + 0.5, b.x0, b.z1 - 0.5, 3);
    }
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
    W["POST OFFICE"],
  ]; // (not the landmark shops' names: a second BARBER next door read as a copy)
  let fillerAt = Math.floor(rand() * PAINT_FILLER.length);
  const nextFiller = () => PAINT_FILLER[fillerAt++ % PAINT_FILLER.length]!;
  const pickMat = (): WMat => {
    const r = rand();
    return r < 0.52 ? "clap" : r < 0.82 ? "board" : r < 0.93 ? "adobe" : "brick";
  };

  /** one row of false-front buildings along Main Street; `north` = the row on the -z side */
  type Plan = {
    w: number;
    t: WType;
    sign: number;
    storeys: number;
    mat?: WMat;
    porch?: 0 | 1 | 2;
    ff?: 0 | 1 | 2 | 3;
    d?: number;
  };
  // (held in an object: TypeScript does not track assignments made inside closures)
  const sal: {
    stairs: WesternLayout["saloonStairs"];
    lot: { x0: number; x1: number; zf: number; north: boolean } | null;
  } = { stairs: null, lot: null };
  const row = (north: boolean, x0: number, x1: number, fixed: Plan[], abut?: number) => {
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
    let order: Plan[] = [];
    const every = Math.max(1, Math.round(fillers.length / (fixed.length + 1)));
    let fi = 0;
    for (let li = 0; li < fixed.length; li++) {
      for (let n = 0; n < every && fi < fillers.length; n++) order.push(fillers[fi++]!);
      order.push(fixed[li]!);
    }
    while (fi < fillers.length) order.push(fillers[fi++]!);
    // alleys between buildings (flanking routes); drop fillers until everything fits, so
    // every landmark is always built
    // buildings stand shoulder to shoulder, broken by real alleys (6 m: room to fight in);
    // the saloon always has one, for its outside stair
    const gaps = order.map((p) => (p.t === "saloon" ? 6 : rand() < 0.3 ? 6 : 0));
    const need = () => order.reduce((sum, p, i) => sum + p.w + gaps[i]!, 0) - 2;
    while (need() > x1 - x0) {
      const k = order.map((p) => fixed.includes(p)).lastIndexOf(false);
      if (k < 0) break;
      order = order.filter((_, i) => i !== k);
      gaps.splice(k, 1);
    }
    // a row that ends just short of a neighbour (the station) would leave a 2-4 m slot:
    // the last shop is widened to stand shoulder to shoulder with it instead
    if (abut !== undefined && order.length) {
      const end = x0 + order.reduce((sum, p, i) => sum + p.w + gaps[i]!, 0) - gaps[gaps.length - 1]!;
      const slack = abut - end;
      const last = order[order.length - 1]!;
      if (slack > 0 && slack < 6 && !fixed.includes(last))
        order[order.length - 1] = { ...last, w: last.w + slack };
    }
    for (let oi = 0; oi < order.length; oi++) {
      const p = order[oi]!;
      const gap = gaps[oi]!;
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
      setGround(
        x,
        north ? zf : zf - BOARD_D,
        x + p.w,
        north ? zf + BOARD_D : zf,
        WK.BOARD,
      );
      const edge = north ? -STREET_HALF + 0.6 : STREET_HALF - 0.6;
      // the porch row (between the street and the walkway along the shopfronts): posts and
      // clutter stand here, so the walkway behind them stays clear
      const postZ = north ? zf + BOARD_D - 0.15 : zf - BOARD_D + 0.15;
      const clutterZ = north ? zf + BOARD_D - 1 : zf - BOARD_D + 1;
      if (porch > 0) {
        const n = Math.max(2, Math.round(p.w / 3.2));
        for (let i = 0; i <= n; i++) {
          const px = x + 0.15 + ((p.w - 0.3) * i) / n;
          posts.push({ x: px, z: postZ, r: 0.14 });
        }
      }
      if (p.t === "saloon") {
        sal.stairs = {
          x0: x + p.w,
          x1: x + p.w + 2,
          zBottom: north ? zf - 14 : zf + 14,
          zTop: zf,
          zEdge: north ? zf + BOARD_D : zf - BOARD_D,
        };
        sal.lot = { x0: x, x1: x + p.w, zf, north };
      }
      if (p.t !== "smithy" && rand() < 0.75) {
        const hx = x + p.w * (0.3 + rand() * 0.4);
        prop("hitch", hx, edge, 0, Math.min(4, p.w * 0.4));
        // horses tied up at the rail, noses to it, one or two
        if (rand() < 0.62) {
          const nh = rand() < 0.4 ? 2 : 1;
          for (let hi = 0; hi < nh; hi++)
            prop(
              "horse",
              hx + (hi - (nh - 1) / 2) * 1.5 + (rand() - 0.5) * 0.3,
              edge + (north ? 1.5 : -1.5),
              north ? Math.PI + (rand() - 0.5) * 0.25 : (rand() - 0.5) * 0.25,
              0.95 + rand() * 0.1,
              Math.floor(rand() * 6),
            );
        }
        if (rand() < 0.45)
          solidProp("trough", hx + 3.2, edge - (north ? -0.1 : 0.1), 0, 2.4, 0.8, 0.8);
      }
      // porch-row clutter: each piece takes its own stretch of the row (nothing stacked
      // inside anything else)
      const taken: [number, number][] = [];
      const place = (k: WPropKind, w: number, want: number, rot: number, s = 1) => {
        for (let t = 0; t < 6; t++) {
          const cx = t === 0 ? want : x + w / 2 + 0.3 + rand() * (p.w - w - 0.6);
          if (cx - w / 2 < x + 0.3 || cx + w / 2 > x + p.w - 0.3) continue;
          if (taken.some(([a, b]) => cx + w / 2 + 0.3 > a && cx - w / 2 - 0.3 < b)) continue;
          taken.push([cx - w / 2, cx + w / 2]);
          prop(k, cx, clutterZ, rot, s);
          return;
        }
      };
      // (none on the saloon's porch: its gallery runs overhead there, and collision is flat)
      const clutter = p.t !== "saloon";
      if (clutter && rand() < 0.55) place("bench", 1.8, x + p.w / 2 + (rand() - 0.5) * 3, north ? Math.PI : 0);
      if (clutter && rand() < 0.5) {
        const sc = 0.8 + rand() * 0.4;
        place(rand() < 0.5 ? "barrels" : "crates", 1.6 * sc, x + 1 + rand() * (p.w - 2), rand() * 6.28, sc);
      }
      if (clutter && rand() < 0.3) place("sacks", 1.2, x + 1 + rand() * (p.w - 2), rand() * 6.28);
      // porch lanterns
      if (porch > 0)
        prop("lantern", x + p.w / 2, north ? zf + BOARD_D - 0.2 : zf - BOARD_D + 0.2, 0, 1, 2.9);
      // back lot clutter
      const back = north ? bz0 - 3 : bz1 + 3;
      if (rand() < 0.35)
        solidProp(
          "outhouse",
          x + 2 + rand() * (p.w - 4),
          back - (north ? 4 : -4),
          0,
          1.6,
          1.6,
          2.4,
        );
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
  ], 124);
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
  // the bell tower is climbable: an outside stair runs up the nave's north side to a landing
  // and into the belfry (heights in the terrain below); a boarded wall keeps you on the stair
  markSolid(-150, -10, -134, -8, 4); // the stair's outer wall
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
  prop("crates", 139.4, -58, 0.2, 1); // (clear of the spot where the Iron Marshal steps off)
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
  // the stagecoach waits outside the hotel
  const hotel = buildings.find((b) => b.t === "hotel");
  if (hotel)
    solidProp(
      "stagecoach",
      (hotel.x0 + hotel.x1) / 2,
      -STREET_HALF + 3.6,
      Math.PI / 2,
      2.2,
      7.5,
      2.8,
    );
  // horses in the livery corral
  // (each keeps 2.5 m from the hay, the trough and the other horses)
  for (let n = 0, placed = 0; n < 30 && placed < 5; n++) {
    const hx = stable.x0 + 2 + rand() * (stable.x1 - stable.x0 + 4);
    const hz = stable.z1 + 8 + rand() * 18;
    const rot = rand() * 6.28;
    const s = 0.95 + rand() * 0.1;
    const coat = Math.floor(rand() * 6);
    if (props.some((q) => (q.k === "hay" || q.k === "horse" || q.k === "trough") && Math.hypot(q.x - hx, q.z - hz) < 2.5))
      continue;
    prop("horse", hx, hz, rot, s, coat);
    placed++;
  }
  // the blacksmith's yard: anvil, wagon wheels, a quench barrel
  const smithy = buildings.find((b) => b.t === "smithy")!;
  {
    // the smith's yard owns this stretch of the porch row: clear any bench or barrels first
    const ax = (smithy.x0 + smithy.x1) / 2;
    const az = smithy.z0 - BOARD_D + 1;
    for (let i = props.length - 1; i >= 0; i--) {
      const q = props[i]!;
      if (q.x > smithy.x0 - 0.5 && q.x < smithy.x1 + 0.5 && Math.abs(q.z - az) < 1.5)
        if (q.k === "bench" || q.k === "barrels" || q.k === "crates" || q.k === "sacks")
          props.splice(i, 1);
    }
    prop("anvil", ax, az, 0.3, 1);
  }
  prop("wheel", smithy.x0 + 1.2, smithy.z0 - BOARD_D + 1, 0, 1);
  prop("wheel", smithy.x1 - 1.4, smithy.z0 - BOARD_D + 1.1, 0.3, 1);

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
  // (a horse tied at the rail right there is led away first)
  for (const [cx, cz] of [
    [-40, -9.5],
    [64, 9.4],
  ] as const)
    for (let i = props.length - 1; i >= 0; i--)
      if (props[i]!.k === "horse" && Math.hypot(props[i]!.x - cx, props[i]!.z - cz) < 2.2) props.splice(i, 1);
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
    for (let n = 0; n < 4; n++) {
      const hx = x0 + 5 + rand() * (x1 - x0 - 10);
      const hz = z0 + 4 + rand() * (z1 - z0 - 8);
      const rot = rand() * 6.28;
      const coat = Math.floor(rand() * 6);
      if (props.some((q) => (q.k === "hay" || q.k === "horse" || q.k === "trough") && Math.hypot(q.x - hx, q.z - hz) < 2.5))
        continue;
      prop("horse", hx, hz, rot, 1, coat);
    }
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
  for (let z = trestle.z0 + 4; z < trestle.z1 - 2; z += 6)
    markSolid(RAIL_X - 3, z - 0.5, RAIL_X + 3, z + 0.5, TRESTLE_Y);

  // ======================================================================
  // 6. co-op outer band: a second homestead, a prospector camp, a stage-relay ruin
  // ======================================================================
  const coopBld = (b: Omit<WBld, "seed" | "tone" | "coop">) => {
    if (!isFree(b.x0 - 2, b.z0 - 2, b.x1 + 2, b.z1 + 2)) return;
    bld({ ...b, coop: true });
  };
  coopBld({
    t: "house",
    x0: -344,
    z0: 90,
    x1: -332,
    z1: 100,
    front: 1,
    storeys: 1,
    mat: "log",
    sign: -1,
    porch: 1,
    ff: 0,
    roof: "gable",
  });
  coopBld({
    t: "barn",
    x0: -350,
    z0: 110,
    x1: -336,
    z1: 126,
    front: 1,
    storeys: 1,
    mat: "barn",
    sign: -1,
    porch: 0,
    ff: 0,
    roof: "gable",
  });
  coopBld({
    t: "tent",
    x0: 318,
    z0: 318,
    x1: 324,
    z1: 324,
    front: 3,
    storeys: 1,
    mat: "board",
    sign: -1,
    porch: 0,
    ff: 0,
    roof: "gable",
  });
  coopBld({
    t: "tent",
    x0: 330,
    z0: 312,
    x1: 335,
    z1: 318,
    front: 3,
    storeys: 1,
    mat: "board",
    sign: -1,
    porch: 0,
    ff: 0,
    roof: "gable",
  });
  coopBld({
    t: "shack",
    x0: 340,
    z0: 326,
    x1: 346,
    z1: 332,
    front: 3,
    storeys: 1,
    mat: "board",
    sign: -1,
    porch: 0,
    ff: 0,
    roof: "shed",
  });
  coopBld({
    t: "ruin",
    x0: -330,
    z0: -318,
    x1: -314,
    z1: -306,
    front: 0,
    storeys: 1,
    mat: "adobe",
    sign: -1,
    porch: 0,
    ff: 0,
    roof: "flat",
  });
  coopBld({
    t: "ruin",
    x0: -306,
    z0: -322,
    x1: -298,
    z1: -314,
    front: 0,
    storeys: 1,
    mat: "adobe",
    sign: -1,
    porch: 0,
    ff: 0,
    roof: "flat",
  });
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
        if (g === WK.STREET || g === WK.BOARD || g === WK.RAIL || g === WK.PLATFORM || g === WK.LOT)
          return false;
      }
    return true;
  };
  const townish = (x: number, z: number) => x > -165 && x < 160 && z > -100 && z < 110;
  const core = (x: number, z: number) => x > -132 && x < 126 && z > -48 && z < 48;
  // scatter props don't block until the end, so remember where each plant went (one per
  // 2 m cell, and a saguaro or dead tree keeps its neighbours clear too)
  const taken = new Uint8Array(N);
  const free = (x: number, z: number, pad: number) => {
    for (let dx = -pad; dx <= pad; dx += 2)
      for (let dz = -pad; dz <= pad; dz += 2) if (taken[at(x + dx, z + dz)]) return false;
    return true;
  };
  // no solid prop in a narrow lane: along each axis at least one side must stay open for
  // 6 m (a cactus against a cliff is fine, a cactus in the middle of a 8 m gap is a choke)
  const hardAt = (x: number, z: number) => {
    const k = at(x, z);
    return k < 0 || solid[k] === 1 || rock[k]! > 0 || taken[k] === 1;
  };
  const pinched = (x: number, z: number, r: number) => {
    const open = (dx: number, dz: number) => {
      for (let d = r + 1; d <= r + 6; d += 1) if (hardAt(x + dx * d, z + dz * d)) return false;
      return true;
    };
    return (!open(1, 0) && !open(-1, 0)) || (!open(0, 1) && !open(0, -1));
  };
  const plant = (k: WPropKind, x: number, z: number, s: number, pad: number) => {
    if (!free(x, z, pad)) return;
    if (k !== "bush" && pinched(x, z, 1)) return;
    taken[at(x, z)] = 1;
    prop(k, x, z, rand() * 6.28, s);
  };
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
      if (r < 0.2 && desertCell(x, z, 0))
        plant(r < 0.1 ? "boulder" : "bush", x, z, 0.5 + rand() * 0.7, 0);
      continue;
    }
    if (g === WK.TRAIL || g === WK.YARD) continue;
    if (r < 0.1 + dens * 0.18) {
      if (desertCell(x, z, 2)) plant("saguaro", x, z, 0.7 + rand() * 0.75, 2);
    } else if (r < 0.38) {
      if (desertCell(x, z, 0)) plant("pear", x, z, 0.6 + rand() * 0.8, 0);
    } else if (r < 0.46) {
      if (desertCell(x, z, 0)) plant("barrelcactus", x, z, 0.7 + rand() * 0.6, 0);
    } else if (r < 0.82) {
      if (desertCell(x, z, 0)) prop("bush", x, z, rand() * 6.28, 0.6 + rand() * 0.9);
    } else if (r < 0.9) {
      if (desertCell(x, z, 0)) prop("tumble", x, z, rand() * 6.28, 0.6 + rand() * 0.5);
    } else if (r < 0.905) {
      if (desertCell(x, z, 0)) prop("bones", x, z, rand() * 6.28, 1);
    } else if (r < 0.915) {
      if (desertCell(x, z, 2)) plant("deadtree", x, z, 0.8 + rand() * 0.6, 2);
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
    if (pinched(x, z, w / 2) || !free(x, z, big ? 4 : 2)) continue;
    solidProp(
      "boulder",
      x,
      z,
      rand() * 6.28,
      w,
      w,
      big ? 2.4 : 1.4,
      big ? 1.9 + rand() * 0.6 : 1 + rand() * 0.3,
    );
    boulders++;
  }

  // ======================================================================
  // 7b. every prop that looks solid is solid: cactus, posts, horses, benches, barrels...
  //     (footprints in metres, width across x and depth along z before rotation)
  // ======================================================================
  const FOOT: Partial<Record<WPropKind, [number, number]>> = {
    saguaro: [0.8, 0.8],
    pear: [1.2, 1.2],
    barrelcactus: [0.7, 0.7],
    deadtree: [0.7, 0.7],
    pole: [0.3, 0.3],
    streetlamp: [0.3, 0.3],
    crossbuck: [0.3, 0.3],
    horse: [0.7, 2.3],
    bench: [1.7, 0.5],
    barrels: [1.3, 1.3],
    crates: [1.5, 1.5],
    sacks: [1.1, 1.1],
    woodpile: [2.2, 1.1],
    hay: [1.2, 0.8],
    cart: [1.3, 2.5],
    anvil: [0.6, 0.7],
    wheel: [1.3, 0.3],
    campfire: [1.6, 1.6],
    grave: [0.6, 0.3],
    cross: [0.6, 0.2],
    orecart: [1.3, 2.0],
    trough: [2.4, 0.8],
  };
  // loose boulders (the riverbed's) block like the big ones; those already blocked are unchanged
  FOOT.boulder = [1.4, 1.4];
  // Small props are thin collision circles (level.ts setPosts), not whole 2 m cells: a cell
  // per barrel or porch post left invisible walls metres wide. Bigger ones keep their cells.
  const THIN = new Set<WPropKind>([
    "saguaro", "pear", "barrelcactus", "deadtree", "pole", "streetlamp", "crossbuck", "horse",
    "bench", "barrels", "crates", "sacks", "hay", "anvil", "wheel", "grave", "cross",
  ]);
  /** a rectangle w x d (local x at yaw rot) as a row of circles */
  const SHOT_STOP = new Set<WPropKind>(["horse", "hay", "barrels", "crates", "sacks"]);
  const thin = (x: number, z: number, rot: number, w: number, d: number, shot = false) => {
    const long = Math.max(w, d);
    const short = Math.min(w, d);
    const r = short / 2;
    const ax = w >= d ? Math.cos(rot) : Math.sin(rot);
    const az = w >= d ? -Math.sin(rot) : Math.cos(rot);
    const span = long - short;
    const n = Math.max(1, Math.ceil(span / Math.max(0.3, r * 1.2)) + 1);
    for (let k = 0; k < n; k++) {
      const t = n === 1 ? 0 : -span / 2 + (span * k) / (n - 1);
      posts.push(shot ? { x: x + ax * t, z: z + az * t, r, shot } : { x: x + ax * t, z: z + az * t, r });
    }
  };
  for (const pr of props) {
    if (pr.k === "hitch") {
      thin(pr.x, pr.z, 0, pr.s, 0.24);
      continue;
    }
    if (pr.k === "sign") {
      posts.push({ x: pr.x, z: pr.z, r: 0.22 });
      continue;
    }
    if (THIN.has(pr.k) && FOOT[pr.k]) {
      const [fw, fd] = FOOT[pr.k]!;
      thin(pr.x, pr.z, pr.rot, fw * pr.s, fd * pr.s, SHOT_STOP.has(pr.k));
      continue;
    }
    if (pr.k === "fence") {
      markSolid(pr.x - (Math.abs(Math.cos(pr.rot)) * pr.s) / 2 - 0.1, pr.z - (Math.abs(Math.sin(pr.rot)) * pr.s) / 2 - 0.1, pr.x + (Math.abs(Math.cos(pr.rot)) * pr.s) / 2 + 0.1, pr.z + (Math.abs(Math.sin(pr.rot)) * pr.s) / 2 + 0.1, 1.3);
      continue;
    }
    if (pr.k === "arch") {
      for (const lx of [-9, 9]) {
        const ax = pr.x + Math.cos(pr.rot) * lx * pr.s;
        const az = pr.z - Math.sin(pr.rot) * lx * pr.s;
        markSolid(ax - 3, az - 3, ax + 3, az + 3, 6);
      }
      continue;
    }
    const f = FOOT[pr.k];
    if (!f) continue;
    const w = f[0] * pr.s;
    const d = f[1] * pr.s;
    const c = Math.abs(Math.cos(pr.rot));
    const sn = Math.abs(Math.sin(pr.rot));
    const hw = (w * c + d * sn) / 2;
    const hd = (w * sn + d * c) / 2;
    markSolid(pr.x - hw, pr.z - hd, pr.x + hw, pr.z + hd, 1.5);
  }
  // the station's bay window pokes out onto the platform
  markSolid(138, -29, 139.2, -25, 3);

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

  // ======================================================================
  // 9. walkable height: boardwalks, the platform, the saloon balcony and its stair, the
  //    church stair, landing and belfry. 1 m samples; climbs steeper than 1:1 are walls.
  // ======================================================================
  const tn = half * 2;
  const th = new Float32Array((tn + 1) * (tn + 1));
  const tset = (x: number, z: number, h: number) => {
    const i = Math.round(x + half);
    const j = Math.round(z + half);
    if (i >= 0 && j >= 0 && i <= tn && j <= tn) th[i * (tn + 1) + j] = Math.max(th[i * (tn + 1) + j]!, h);
  };
  for (let i = 0; i <= tn; i++)
    for (let j = 0; j <= tn; j++) {
      const x = -half + i;
      const z = -half + j;
      const k = at(x + 0.01, z + 0.01);
      if (k < 0) continue;
      const g = ground[k]!;
      if (g === WK.BOARD) th[i * (tn + 1) + j] = DECK_Y;
      else if (g === WK.PLATFORM) th[i * (tn + 1) + j] = 0.34;
      else if (rock[k]! === 0 && Math.abs(x) < half - RIVER_END) {
        // the dry wash, carved below grade with gentle banks you can walk down
        const hw = riverW(x) / 2;
        const d = Math.abs(z - riverZ(x));
        if (d < hw + RIVER_BANK - 2) th[i * (tn + 1) + j] = -RIVER_D * smooth(hw + RIVER_BANK - 2, hw - 2, d);
      }
    }
  const platforms: { x0: number; z0: number; x1: number; z1: number; y: number }[] = [];
  const tbox = (x0: number, z0: number, x1: number, z1: number, h: (x: number, z: number) => number) => {
    for (let x = Math.ceil(x0); x <= Math.floor(x1); x++)
      for (let z = Math.ceil(z0); z <= Math.floor(z1); z++) tset(x, z, h(x, z));
  };
  if (sal.stairs && sal.lot) {
    const st = sal.stairs;
    const sl = sal.lot;
    const dir = sl.north ? 1 : -1; // toward the street
    // the gallery along the porch's street edge (exact edges: a deck, not heightfield samples,
    // so the walkway under it along the facade stays open) and the stair's landing in the alley
    const zg = sl.zf + dir * SALOON_GALLERY;
    const ze = sl.zf + dir * (BOARD_D - 0.1);
    platforms.push({ x0: sl.x0, x1: st.x0, z0: Math.min(zg, ze), z1: Math.max(zg, ze), y: BALCONY_Y });
    // the stair's boarded side and handrail: thin posts, so nobody stands outside the rail
    for (let z = Math.min(st.zBottom, st.zTop); z <= Math.max(st.zBottom, st.zTop); z += 0.35)
      posts.push({ x: st.x1 - 0.25, z, r: 0.08 });
    platforms.push({
      x0: st.x0,
      x1: st.x1,
      z0: Math.min(sl.zf - dir * 0.4, ze),
      z1: Math.max(sl.zf - dir * 0.4, ze),
      y: BALCONY_Y,
    });
    tbox(st.x0, Math.min(st.zBottom, st.zTop), st.x1, Math.max(st.zBottom, st.zTop), (_x, z) =>
      BALCONY_Y * Math.min(1, Math.max(0, (z - st.zBottom) / (st.zTop - st.zBottom))),
    );
  }
  // church: stair (west end at the bottom), landing beside the tower, the belfry floor
  // (the treads run z -7.95..-6.1 against the nave wall at z -6, so the samples at z -6 carry
  // the stair height too; without them the wall-side half sank toward the ground)
  tbox(-151, -8, -134, -6, (x) => BELFRY_Y * Math.min(1, Math.max(0, (x + 151) / 17)));
  tbox(-134, -8, -128.5, -2, () => BELFRY_Y);
  tbox(-132.5, -2, -128.5, 2, () => BELFRY_Y);
  const terrain: Terrain = { half, cell: 1, n: tn, h: th, maxSlope: 1.0, platforms };

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
    terrain,
    saloonStairs: sal.stairs,
    posts,
    extent: half + 3000,
  };
  return { blocks, layout, sealed };
}
