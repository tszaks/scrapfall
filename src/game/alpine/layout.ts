// Whiteout Pass: a deterministic, real-scale alpine ski village (1 unit = 1 metre, 2 m
// cells). Pure data - no three.js - so every co-op client builds the identical map from
// the seed. The set pieces sit at fixed places inside the solo square (so solo keeps every
// one of them); the seed varies the chalets, the forest, the rocks and the props.
//
//            N (-z)          co-op only: the upper bowl, summit trail, mountain hut,
//   top station + deck        black run top, east run, far forest, the east hamlet
//      |  chairlift (x = 40)
//   blue run | red run
//   ski jump      lift base plaza + rental
//   ---------- main street (z = 30) -- square: church, rink, cafes -- grand hotel
//   covered bridge over the creek
//   frozen lake (west)        south lanes, hillside chalets
//            S (+z)
import type { Block } from "../level";
import type { CityLayout } from "../cityLayout";
import type { Terrain } from "../terrain";
import { findGaps, sealGaps, soloHalf, type Gap } from "../soloBounds";
import { clamp, fbm, mulberry, naturalHeight, smooth, valleyCentre } from "./noise";

export const ALPINE_SIZE = 800;
const HALF = ALPINE_SIZE / 2;
const CELL = 2;
const N = ALPINE_SIZE / CELL; // cells per side
const NV = N + 1; // height samples per side

// ---- surface kinds (minimap, walking speed, terrain shading) ----
export const S_SNOW = 0;
export const S_PATH = 1;
export const S_PISTE = 2;
export const S_ICE = 3;
export const S_ROCK = 4;
export const S_FOREST = 5;
export const S_PLAZA = 6;
export const S_BLD = 7;
export const S_DECK = 8;
export const S_BLOCKADE = 9;
export const S_ROAD = 10;

export type P2 = [number, number];
export type PathKind = "street" | "lane" | "trail" | "road" | "piste" | "creek";
export type APath = { pts: P2[]; w: number; kind: PathKind; name?: string; coop?: boolean };

export type BldType =
  | "chalet"
  | "lodge"
  | "cafe"
  | "shop"
  | "hotel"
  | "church"
  | "rental"
  | "station"
  | "topstation"
  | "panorama"
  | "barn"
  | "hut"
  | "boathouse"
  | "ticket"
  | "summit";
export type ABld = {
  t: BldType;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** floor level (top of the stone plinth) */
  y: number;
  /** lowest ground under the footprint (the plinth goes down to here) */
  ymin: number;
  floors: number;
  /** street side: 0 -z, 1 +x, 2 +z, 3 -x */
  front: 0 | 1 | 2 | 3;
  seed: number;
  /** style variant 0..n */
  style: number;
  /** word on the shop sign (index into SIGN_WORDS), -1 for none */
  sign: number;
  coop?: boolean;
};

export type TreeKind = 0 | 1 | 2; // 0 spruce, 1 tall fir, 2 young spruce (thicket)
export type ATree = {
  x: number;
  z: number;
  y: number;
  h: number;
  w: number;
  rot: number;
  k: TreeKind;
};

export type PropKind =
  | "lamp"
  | "flood"
  | "bench"
  | "snowbank"
  | "woodpile"
  | "skirack"
  | "snowmobile"
  | "snowcat"
  | "fountain"
  | "xmas"
  | "marker"
  | "fence"
  | "trash"
  | "heater"
  | "table"
  | "sled"
  | "boulder"
  | "snowman"
  | "flag"
  | "signpost"
  | "barrel"
  | "umbrella"
  | "tower"
  // blockade dressing (solo only)
  | "debris"
  | "closed"
  | "gate"
  | "deadfall"
  | "rockfall";
export type AProp = {
  k: PropKind;
  x: number;
  z: number;
  y: number;
  rot: number;
  s: number;
  v?: number;
};

export type LiftSupport = { z: number; y: number; ground: number; kind: "base" | "tower" | "top" };
export type Lift = {
  x: number;
  /** half the distance between the up and down cables */
  gauge: number;
  supports: LiftSupport[];
};

export type Blockade = { x: number; z: number; w: number; axis: "x" | "z"; style: PropKind };

export type AlpineData = {
  terrain: Terrain;
  /** surface kind per 2 m cell, [i * N + j] */
  surf: Uint8Array;
  buildings: ABld[];
  trees: ATree[];
  props: AProp[];
  paths: APath[];
  lift: Lift;
  lake: { x: number; z: number; rx: number; rz: number; y: number };
  rink: { x0: number; z0: number; x1: number; z1: number; y: number };
  bridge: { x0: number; x1: number; z: number; w: number; y: number };
  jump: { x: number; z0: number; z1: number; top: number; lip: number; y0: number; y1: number };
  deck: { x0: number; z0: number; x1: number; z1: number; y: number };
  plateau: number;
  blockades: Blockade[];
  /** solo square half-size, or null in co-op */
  soloHalf: number | null;
  /** facing (camera yaw) at the spawn */
  spawnYaw: number;
  /** the summit zone: its own walkable island, reached only by the chairlift */
  island: { x0: number; z0: number; x1: number; z1: number };
  /** lift terminals (walkable loading platforms under a canopy) */
  terminals: { kind: "base" | "top"; x0: number; z0: number; x1: number; z1: number; y: number }[];
  /** the summit lodge's big deck */
  lodgeDeck: { x0: number; z0: number; x1: number; z1: number; y: number };
  /** where riders board and step off: [x, z, yaw] */
  ride: { boardUp: P2; boardDown: P2; offTop: [number, number, number]; offBase: [number, number, number] };
  /** top of whatever solid thing stands in each 2 m cell (shots fly over walk-only cells) */
  tops: Float32Array;
};

/** 0 in the village, 1 on the summit island */
export const SUMMIT = { x0: 4, z0: -276, x1: 82, z1: -248 };
export function alpineZone(x: number, z: number) {
  return x > SUMMIT.x0 - 2 && x < SUMMIT.x1 + 2 && z > SUMMIT.z0 - 2 && z < SUMMIT.z1 + 2 ? 1 : 0;
}

export type AlpineLayout = CityLayout & { alpine: AlpineData };

// ---------------------------------------------------------------------------------------
// geometry helpers

function segDist(px: number, pz: number, a: P2, b: P2) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz || 1;
  const t = clamp(((px - a[0]) * dx + (pz - a[1]) * dz) / l2, 0, 1);
  return { d: Math.hypot(px - a[0] - dx * t, pz - a[1] - dz * t), t };
}
/** distance to a polyline, and the arc length at the closest point */
function polyDist(px: number, pz: number, pts: P2[]) {
  let best = Infinity;
  let s = 0;
  let acc = 0;
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k]!;
    const b = pts[k + 1]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const r = segDist(px, pz, a, b);
    if (r.d < best) {
      best = r.d;
      s = acc + r.t * len;
    }
    acc += len;
  }
  return { d: best, s, len: acc };
}
function polyAt(pts: P2[], s: number): P2 {
  let acc = 0;
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k]!;
    const b = pts[k + 1]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (acc + len >= s || k + 2 === pts.length) {
      const t = len ? clamp((s - acc) / len, 0, 1) : 0;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    acc += len;
  }
  return pts[pts.length - 1]!;
}

const vi = (x: number) => Math.round((x + HALF) / CELL); // nearest height sample
const ci = (x: number) => clamp(Math.floor((x + HALF) / CELL), 0, N - 1); // cell index
const cc = (i: number) => -HALF + CELL / 2 + i * CELL; // cell centre
const vx = (i: number) => -HALF + i * CELL; // sample position

// ---------------------------------------------------------------------------------------
// the fixed plan (world metres)

const STREET_Z = 30;
const LIFT_X = 40;
const LIFT_Z0 = -70; // base station's uphill face
const LIFT_Z1 = -264; // top station's downhill face
const LAKE = { x: -205, z: 95, rx: 55, rz: 38 };
const BRIDGE = { x0: -125, x1: -103, z: STREET_Z, w: 7 };
const PLATEAU = { x0: 2, z0: -278, x1: 82, z1: -246 };
const DECK = { x0: 56, z0: -262, x1: 80, z1: -247 };
const RINK = { x0: -12, z0: 50, x1: 16, z1: 70 };
const SQUARE = { x0: -40, z0: 36, x1: 40, z1: 84 };
const PLAZA = { x0: 6, z0: -50, x1: 82, z1: -22 };
const JUMP = { x: -205, z0: -180, z1: -126 };
// the solo start: flat ground on the village square, looking at the church, rink and peaks
export const SPAWN = { x: 10, z: 79 };
const SPAWN_YAW = 0.55;
const LODGE_DECK = { x0: 4, z0: -262, x1: 30, z1: -250 };
const BASE_TERM = { x0: 28, z0: -74, x1: 50, z1: -58 };
const TOP_TERM = { x0: 30, z0: -268, x1: 50, z1: -258 };

const PATHS: APath[] = [
  {
    pts: [
      [-162, STREET_Z],
      [152, STREET_Z],
    ],
    w: 12,
    kind: "street",
    name: "Dorfstrasse",
  },
  {
    pts: [
      [LIFT_X, 24],
      [LIFT_X, -24],
    ],
    w: 10,
    kind: "street",
  },
  {
    pts: [
      [-102, -22],
      [8, -22],
    ],
    w: 6,
    kind: "lane",
  },
  {
    pts: [
      [80, -22],
      [146, -22],
    ],
    w: 6,
    kind: "lane",
  },
  {
    pts: [
      [-60, 24],
      [-60, -22],
    ],
    w: 5,
    kind: "lane",
  },
  {
    pts: [
      [104, 24],
      [104, -22],
    ],
    w: 5,
    kind: "lane",
  },
  {
    pts: [
      [-104, 99],
      [-42, 99],
    ],
    w: 5,
    kind: "lane",
  },
  {
    pts: [
      [42, 99],
      [146, 99],
    ],
    w: 5,
    kind: "lane",
  },
  {
    pts: [
      [-70, 36],
      [-70, 99],
    ],
    w: 5,
    kind: "lane",
  },
  {
    pts: [
      [90, 36],
      [90, 99],
    ],
    w: 5,
    kind: "lane",
  },
  {
    pts: [
      [0, 84],
      [0, 99],
      [42, 99],
    ],
    w: 5,
    kind: "lane",
  },
  {
    pts: [
      [0, 99],
      [-42, 99],
    ],
    w: 5,
    kind: "lane",
  },
  {
    pts: [
      [90, 99],
      [98, 150],
      [118, 190],
    ],
    w: 4,
    kind: "trail",
  },
  {
    pts: [
      [-40, 99],
      [-30, 140],
      [-10, 180],
    ],
    w: 4,
    kind: "trail",
  },
  // lakeside promenade and the road out west / east (the roads leave the map in co-op)
  {
    pts: [
      [-162, STREET_Z],
      [-150, 52],
      [-146, 96],
      [-160, 140],
      [-205, 150],
    ],
    w: 5,
    kind: "trail",
  },
  {
    pts: [
      [-162, STREET_Z],
      [-230, 22],
      [-320, 12],
      [-396, 6],
    ],
    w: 8,
    kind: "road",
  },
  {
    pts: [
      [152, STREET_Z],
      [220, 36],
      [300, 46],
      [396, 52],
    ],
    w: 8,
    kind: "road",
  },
  // pistes
  {
    pts: [
      [20, -250],
      [-10, -215],
      [-45, -180],
      [-55, -140],
      [-35, -100],
      [-5, -72],
      [14, -52],
    ],
    w: 30,
    kind: "piste",
    name: "blue",
  },
  {
    pts: [
      [66, -246],
      [64, -210],
      [68, -170],
      [76, -130],
      [80, -95],
      [70, -52],
    ],
    w: 26,
    kind: "piste",
    name: "red",
  },
  {
    pts: [
      [-118, -396],
      [-130, -300],
      [-152, -220],
      [-146, -150],
      [-120, -95],
      [-80, -60],
    ],
    w: 26,
    kind: "piste",
    name: "black",
  },
  {
    pts: [
      [330, -396],
      [300, -300],
      [320, -200],
      [300, -110],
      [262, -64],
      [200, -40],
    ],
    w: 28,
    kind: "piste",
    name: "east",
    coop: true,
  },
  // the creek from the glacier down to the lake (frozen)
  {
    pts: [
      [-70, -396],
      [-78, -300],
      [-92, -210],
      [-102, -130],
      [-108, -60],
      [-112, 0],
      [-114, STREET_Z],
      [-120, 52],
      [-140, 72],
      [-160, 86],
    ],
    w: 7,
    kind: "creek",
  },
];

// shop signs (index into the sign atlas in textures.ts)
export const SIGN_WORDS = [
  "GRAND HOTEL ALPINA",
  "SKI RENTAL",
  "CAFE",
  "BÄCKEREI",
  "APOTHEKE",
  "STÜBLI",
  "SPORT",
  "FONDUE",
  "PISTE CLOSED",
  "AVALANCHE DANGER",
  "ROAD CLOSED",
  "WHITEOUT PASS",
  "SEEHOF",
  "PANORAMA",
  "KONDITOREI",
  "BERGBAHN",
  "LIFT",
  "SUMMIT LODGE",
] as const;
export const W_HOTEL = 0;
export const W_RENTAL = 1;
export const W_CAFE = 2;
export const W_CLOSED = 8;
export const W_AVALANCHE = 9;
export const W_ROAD = 10;
export const W_PASS = 11;
export const W_SEEHOF = 12;
export const W_PANORAMA = 13;
export const W_BERGBAHN = 15;
export const W_LIFT = 16;
export const W_LODGE = 17;
const SHOP_WORDS = [2, 3, 4, 5, 6, 7, 14];

// ---------------------------------------------------------------------------------------

export function generateAlpine(seed: number, solo: boolean) {
  const rand = mulberry(seed ^ 0x51a7e);
  const H = new Float32Array(NV * NV);
  const surf = new Uint8Array(N * N);
  const solid = new Uint8Array(N * N);
  const clear = new Uint8Array(N * N); // no trees here
  // top of the solid thing in each cell (walk-only cells stay at -inf: shots fly over them)
  const tops = new Float32Array(N * N).fill(-1e9);
  const buildings: ABld[] = [];
  const trees: ATree[] = [];
  const props: AProp[] = [];
  const sHalf = solo ? soloHalf(HALF) : null;

  // ---- 1. the natural landform ----
  for (let i = 0; i < NV; i++)
    for (let j = 0; j < NV; j++) H[i * NV + j] = naturalHeight(vx(i), vx(j));
  const hv = (i: number, j: number) => H[clamp(i, 0, N) * NV + clamp(j, 0, N)]!;
  const hAt = (x: number, z: number) => {
    const fx = clamp((x + HALF) / CELL, 0, N - 1e-4);
    const fz = clamp((z + HALF) / CELL, 0, N - 1e-4);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const a = hv(i, j);
    const b = hv(i + 1, j);
    const c = hv(i, j + 1);
    const d = hv(i + 1, j + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  /** blend every sample within `r + blend` of (fn distance) toward a target height */
  const shape = (
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    fn: (x: number, z: number, h: number) => number,
  ) => {
    const i0 = clamp(vi(x0), 0, N);
    const i1 = clamp(vi(x1), 0, N);
    const j0 = clamp(vi(z0), 0, N);
    const j1 = clamp(vi(z1), 0, N);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const k = i * NV + j;
        H[k] = fn(vx(i), vx(j), H[k]!);
      }
  };
  const rectDist = (x: number, z: number, r: { x0: number; z0: number; x1: number; z1: number }) =>
    Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));

  // ---- 2. sculpt: the valley floor, lake, plateaus, streets and the creek ----
  // the village sits on a smooth, nearly level floor
  const floorAt = (x: number, z: number) => 0.4 + 0.006 * x - 0.004 * (z - STREET_Z);
  const village = { x0: -165, z0: -30, x1: 155, z1: 125 };
  shape(village.x0 - 40, village.z0 - 30, village.x1 + 40, village.z1 + 40, (x, z, h) => {
    const d = rectDist(x, z, village);
    const k = 1 - smooth(0, 36, d);
    return h + (floorAt(x, z) + (h - floorAt(x, z)) * 0.15 - h) * k;
  });
  // the lake: flat ice with a soft shore
  const lakeY = -0.9;
  shape(
    LAKE.x - LAKE.rx * 1.5,
    LAKE.z - LAKE.rz * 1.5,
    LAKE.x + LAKE.rx * 1.5,
    LAKE.z + LAKE.rz * 1.5,
    (x, z, h) => {
      const e = Math.hypot((x - LAKE.x) / LAKE.rx, (z - LAKE.z) / LAKE.rz);
      if (e < 1) return lakeY;
      const k = smooth(1, 1.35, e);
      return lakeY + (Math.max(h, lakeY + 0.3) - lakeY) * k;
    },
  );
  // streets, lanes, trails and roads: a smoothed profile along each, blended into the banks
  const profile = (p: APath) => {
    const len = polyDist(p.pts[0]![0], p.pts[0]![1], p.pts).len;
    const n = Math.max(2, Math.ceil(len / 2));
    const raw: number[] = [];
    for (let k = 0; k <= n; k++) {
      const q = polyAt(p.pts, (k / n) * len);
      raw.push(hAt(q[0], q[1]));
    }
    const win = p.kind === "trail" ? 3 : 8;
    const out = raw.map((_, k) => {
      let s = 0;
      let c = 0;
      for (let o = -win; o <= win; o++) {
        const v = raw[clamp(k + o, 0, n)]!;
        s += v;
        c++;
      }
      return s / c;
    });
    return (s: number) => {
      const f = clamp((s / len) * n, 0, n);
      const a = Math.floor(f);
      const b = Math.min(n, a + 1);
      return out[a]! + (out[b]! - out[a]!) * (f - a);
    };
  };
  const bbox = (pts: P2[], pad: number) => {
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (const [x, z] of pts) {
      x0 = Math.min(x0, x);
      z0 = Math.min(z0, z);
      x1 = Math.max(x1, x);
      z1 = Math.max(z1, z);
    }
    return { x0: x0 - pad, z0: z0 - pad, x1: x1 + pad, z1: z1 + pad };
  };
  for (const p of PATHS) {
    if (p.kind === "piste" || p.kind === "creek") continue;
    const prof = profile(p);
    const blend = p.kind === "trail" ? 6 : 10;
    const b = bbox(p.pts, p.w / 2 + blend);
    shape(b.x0, b.z0, b.x1, b.z1, (x, z, h) => {
      const r = polyDist(x, z, p.pts);
      const k = 1 - smooth(p.w / 2, p.w / 2 + blend, r.d);
      return k > 0 ? h + (prof(r.s) - h) * k : h;
    });
  }
  // pistes: groomed, so the small bumps are smoothed away (the big shape stays)
  for (const p of PATHS) {
    if (p.kind !== "piste") continue;
    const prof = profile(p);
    const b = bbox(p.pts, p.w / 2 + 8);
    shape(b.x0, b.z0, b.x1, b.z1, (x, z, h) => {
      const r = polyDist(x, z, p.pts);
      const k = (1 - smooth(p.w / 2 - 4, p.w / 2 + 8, r.d)) * 0.55;
      return k > 0 ? h + (prof(r.s) - h) * k : h;
    });
  }
  // the lift-top plateau (cut into the slope) and the base plaza
  const plateauY = Math.round(hAt((PLATEAU.x0 + PLATEAU.x1) / 2, (PLATEAU.z0 + PLATEAU.z1) / 2));
  shape(PLATEAU.x0 - 40, PLATEAU.z0 - 40, PLATEAU.x1 + 40, PLATEAU.z1 + 30, (x, z, h) => {
    const d = rectDist(x, z, PLATEAU);
    // the valley side drops away more steeply below the deck: a sharp edge to look out from
    const k = 1 - smooth(0, z > PLATEAU.z1 ? 22 : 45, d);
    return h + (plateauY - h) * k;
  });
  const deckY = plateauY + 2.4;
  shape(DECK.x0 - 4, DECK.z0 - 2, DECK.x1 + 2, DECK.z1 + 2, (x, z, h) => {
    if (x >= DECK.x0 && x <= DECK.x1 + 1 && z >= DECK.z0 && z <= DECK.z1 + 1) return deckY;
    // the stair ramp on the plateau side
    if (x < DECK.x0 && x >= DECK.x0 - 4 && z >= DECK.z0 && z <= DECK.z0 + 6)
      return plateauY + ((x - (DECK.x0 - 4)) / 4) * 2.4;
    return h;
  });
  const plazaY = hAt((PLAZA.x0 + PLAZA.x1) / 2, (PLAZA.z0 + PLAZA.z1) / 2);
  const basePad = { x0: PLAZA.x0, z0: BASE_TERM.z0 - 2, x1: PLAZA.x1, z1: PLAZA.z1 };
  shape(basePad.x0 - 30, basePad.z0 - 30, basePad.x1 + 30, basePad.z1 + 20, (x, z, h) => {
    const k = 1 - smooth(0, z < basePad.z0 ? 10 : 40, rectDist(x, z, basePad));
    return h + (plazaY - h) * k;
  });
  // the creek: a real gully ~3 m deep with snowy banks. Its ice floor is level along each
  // reach and only ever steps down towards the lake; it runs on under the covered bridge
  // (whose deck is a walkable platform at street level, see terrain.platforms)
  const creek = PATHS.find((p) => p.kind === "creek")!;
  const lakeY0 = -0.9;
  let creekFloor: (s: number) => number;
  {
    const len = polyDist(creek.pts[0]![0], creek.pts[0]![1], creek.pts).len;
    const n = Math.ceil(len / 2);
    const floor: number[] = [];
    let lo = Infinity;
    for (let k = 0; k <= n; k++) {
      const q = polyAt(creek.pts, (k / n) * len);
      // lowest ground across the channel here, 3 m down, never higher than upstream
      let g = Infinity;
      for (let o = -4; o <= 4; o += 2) g = Math.min(g, hAt(q[0] + o, q[1]), hAt(q[0], q[1] + o));
      lo = Math.min(lo, g - 3);
      floor.push(Math.max(lo, lakeY0 - 0.05));
    }
    // level reaches: quantise into steps (small frozen falls between them)
    for (let k = 0; k <= n; k++) floor[k] = Math.max(lakeY0 - 0.05, Math.floor(floor[k]! / 1.5) * 1.5);
    for (let k = 1; k <= n; k++) floor[k] = Math.min(floor[k]!, floor[k - 1]!);
    creekFloor = (sv: number) => floor[clamp(Math.round((sv / len) * n), 0, n)]!;
    const b = bbox(creek.pts, creek.w / 2 + 10);
    shape(b.x0, b.z0, b.x1, b.z1, (x, z, h) => {
      const r = polyDist(x, z, creek.pts);
      const half = creek.w / 2;
      if (r.d > half + 8) return h;
      const bed = creekFloor(r.s);
      if (r.d < half) return Math.min(h, bed);
      // banks: steep near the ice, easing out onto the snow
      const k = Math.pow(smooth(half, half + 8, r.d), 0.7);
      return Math.min(h, bed + (h - bed) * k);
    });
  }
  // the village square, rink and plaza stay level
  const squareY = hAt(0, 60);
  shape(SQUARE.x0 - 8, SQUARE.z0 - 4, SQUARE.x1 + 8, SQUARE.z1 + 8, (x, z, h) => {
    const k = 1 - smooth(0, 8, rectDist(x, z, SQUARE));
    return h + (squareY - h) * k;
  });
  // the ski jump's in-run sits on a steepened ramp of snow
  const jumpTopG = hAt(JUMP.x, JUMP.z0);
  const jumpLipG = hAt(JUMP.x, JUMP.z1);

  // ---- 3. surfaces ----
  const S = (i: number, j: number) => i * N + j;
  const paint = (
    r: { x0: number; z0: number; x1: number; z1: number },
    fn: (x: number, z: number, k: number) => void,
  ) => {
    for (let i = ci(r.x0); i <= ci(r.x1); i++)
      for (let j = ci(r.z0); j <= ci(r.z1); j++) fn(cc(i), cc(j), S(i, j));
  };
  for (const p of PATHS) {
    const pad = p.kind === "piste" ? p.w / 2 + 2 : p.w / 2 + 3;
    const b = bbox(p.pts, pad);
    const kind =
      p.kind === "piste"
        ? S_PISTE
        : p.kind === "creek"
          ? S_ICE
          : p.kind === "road"
            ? S_ROAD
            : S_PATH;
    paint(b, (x, z, k) => {
      const d = polyDist(x, z, p.pts).d;
      if (d < p.w / 2) {
        if (kind !== S_PISTE || surf[k] === S_SNOW) surf[k] = kind;
      }
      if (d < pad) clear[k] = 1;
    });
  }
  paint(SQUARE, (_x, _z, k) => {
    surf[k] = S_PLAZA;
    clear[k] = 1;
  });
  paint(PLAZA, (_x, _z, k) => {
    surf[k] = S_PLAZA;
    clear[k] = 1;
  });
  paint(PLATEAU, (_x, _z, k) => {
    surf[k] = S_PLAZA;
    clear[k] = 1;
  });
  paint(RINK, (_x, _z, k) => {
    surf[k] = S_ICE;
  });
  paint(
    {
      x0: LAKE.x - LAKE.rx - 6,
      z0: LAKE.z - LAKE.rz - 6,
      x1: LAKE.x + LAKE.rx + 6,
      z1: LAKE.z + LAKE.rz + 6,
    },
    (x, z, k) => {
      const e = Math.hypot((x - LAKE.x) / LAKE.rx, (z - LAKE.z) / LAKE.rz);
      if (e < 1) surf[k] = S_ICE;
      if (e < 1.12) clear[k] = 1;
    },
  );
  // the lift line is cut through the forest
  paint({ x0: LIFT_X - 10, z0: LIFT_Z1 - 4, x1: LIFT_X + 10, z1: LIFT_Z0 + 4 }, (_x, _z, k) => {
    clear[k] = 1;
  });
  paint({ x0: JUMP.x - 10, z0: JUMP.z0 - 6, x1: JUMP.x + 10, z1: -30 }, (_x, _z, k) => {
    clear[k] = 1;
    if (surf[k] === S_SNOW) surf[k] = S_PISTE;
  });
  paint(DECK, (_x, _z, k) => {
    surf[k] = S_DECK;
  });
  // keep the view from the deck open: no trees on the drop straight below it
  paint({ x0: DECK.x0 - 10, z0: DECK.z1, x1: DECK.x1 + 30, z1: DECK.z1 + 60 }, (_x, _z, k) => {
    clear[k] = 1;
  });

  // ---- 4. buildings ----
  const block = (x0: number, z0: number, x1: number, z1: number, kind = S_BLD, top = 1e9) => {
    for (let i = ci(x0 + 0.01); i <= ci(x1 - 0.01); i++)
      for (let j = ci(z0 + 0.01); j <= ci(z1 - 0.01); j++) {
        solid[S(i, j)] = 1;
        if (kind >= 0) surf[S(i, j)] = kind;
        tops[S(i, j)] = Math.max(tops[S(i, j)]!, top === 1e9 ? hAt(cc(i), cc(j)) + 2 : top);
      }
  };
  const clearRect = (x0: number, z0: number, x1: number, z1: number, pad: number) => {
    for (let i = ci(x0 - pad); i <= ci(x1 + pad); i++)
      for (let j = ci(z0 - pad); j <= ci(z1 + pad); j++) clear[S(i, j)] = 1;
  };
  const footprintY = (x0: number, z0: number, x1: number, z1: number) => {
    let sum = 0;
    let c = 0;
    let lo = Infinity;
    for (let x = x0; x <= x1 + 0.01; x += 2)
      for (let z = z0; z <= z1 + 0.01; z += 2) {
        const h = hAt(x, z);
        sum += h;
        c++;
        lo = Math.min(lo, h);
      }
    return { y: sum / c, lo };
  };
  const overlaps = (x0: number, z0: number, x1: number, z1: number, pad: number) =>
    buildings.some((b) => x0 < b.x1 + pad && x1 > b.x0 - pad && z0 < b.z1 + pad && z1 > b.z0 - pad);
  const addB = (
    t: BldType,
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    front: ABld["front"],
    floors: number,
    sign = -1,
    style = Math.floor(rand() * 4),
  ) => {
    // snap to the 2 m grid so collision matches the walls
    x0 = Math.round(x0 / 2) * 2;
    x1 = Math.round(x1 / 2) * 2;
    z0 = Math.round(z0 / 2) * 2;
    z1 = Math.round(z1 / 2) * 2;
    const f0 = footprintY(x0, z0, x1, z1);
    // level a pad under and around the house (flat, walkable ground at the door), easing
    // back into the natural slope over ~14 m so there are no steep banks against the walls
    const pad = Math.max(f0.y, f0.lo + 0.3);
    const pr = { x0, z0, x1, z1 };
    shape(x0 - 18, z0 - 18, x1 + 18, z1 + 18, (x, z, h) => {
      const k = 1 - smooth(2.5, 16, rectDist(x, z, pr));
      return h + (pad - h) * k;
    });
    const f = footprintY(x0, z0, x1, z1);
    const y = Math.max(f.y, f.lo + 0.2) + 0.25;
    const b: ABld = {
      t,
      x0,
      z0,
      x1,
      z1,
      y,
      ymin: f.lo - 0.6,
      floors,
      front,
      seed: rand(),
      style,
      sign,
    };
    buildings.push(b);
    block(x0, z0, x1, z1, S_BLD, y + floors * 2.8 + 10);
    clearRect(x0, z0, x1, z1, 4);
    return b;
  };

  // set pieces
  // the nave runs north-south with its arched windows to the square; the clock tower
  // stands at its north end, its door on the main street
  addB("church", -36, 44, -20, 70, 0, 2, -1, 0);
  addB("church", -32, 36, -24, 44, 0, 7, -1, 9);
  addB("hotel", 108, -8, 152, 22, 2, 5, W_HOTEL, 0);
  // base terminal: the ticket hall beside the open loading platform (see terminals)
  addB("station", 52, -64, 64, -48, 3, 1, W_LIFT, 0);
  addB("rental", 10, -48, 26, -32, 1, 2, W_RENTAL, 0);
  addB("ticket", 56, -34, 62, -28, 3, 1, -1, 0);
  // top terminal: the bullwheel house behind the unloading platform; the summit lodge
  // beside it, its deck running straight onto the platform
  addB("topstation", 30, -278, 50, -268, 2, 1, W_BERGBAHN, 0);
  addB("summit", 6, -278, 28, -262, 2, 2, W_LODGE, 0);
  addB("cafe", 22, 40, 38, 56, 3, 2, W_CAFE, 1);
  addB("lodge", -152, 6, -130, 24, 2, 3, W_SEEHOF, 1);
  addB("boathouse", -150, 64, -138, 78, 3, 1, -1, 0);

  // main street frontage, both sides, in seeded plots
  const frontage = (xa: number, xb: number, side: 0 | 2, depth: [number, number]) => {
    let x = xa;
    while (x < xb - 10) {
      const w = Math.min(xb - x, 12 + Math.floor(rand() * 5) * 2);
      if (xb - x - w < 10 && xb - x - w > 0) {
        // absorb a sliver at the end
      }
      const d = depth[0] + Math.floor(rand() * ((depth[1] - depth[0]) / 2 + 1)) * 2;
      const big = w >= 18 && rand() < 0.5;
      const t: BldType = big
        ? "lodge"
        : rand() < 0.28
          ? rand() < 0.5
            ? "cafe"
            : "shop"
          : "chalet";
      const sign =
        t === "cafe"
          ? W_CAFE
          : t === "shop"
            ? SHOP_WORDS[Math.floor(rand() * SHOP_WORDS.length)]!
            : -1;
      const floors = big ? 4 : 2 + Math.floor(rand() * 2);
      if (side === 2) addB(t, x, STREET_Z - 6 - 1 - d, x + w, STREET_Z - 6 - 1, 2, floors, sign);
      else addB(t, x, STREET_Z + 6 + 1, x + w, STREET_Z + 6 + 1 + d, 0, floors, sign);
      x += w + 6 + Math.floor(rand() * 2) * 2;
    }
  };
  frontage(-102, -64, 2, [12, 16]);
  frontage(-56, 34, 2, [12, 16]);
  frontage(46, 102, 2, [12, 16]);
  frontage(-102, -74, 0, [12, 16]);
  frontage(-66, -40, 0, [12, 16]);
  frontage(42, 88, 0, [12, 16]);
  frontage(92, 150, 0, [12, 16]);
  // second rows: behind the north frontage (facing the back lane) and along the south lanes
  const row = (xa: number, xb: number, z0: number, z1: number, front: ABld["front"]) => {
    let x = xa;
    while (x < xb - 10) {
      const w = 10 + Math.floor(rand() * 4) * 2;
      const d = Math.min(z1 - z0, 10 + Math.floor(rand() * 3) * 2);
      const zz0 = front === 0 ? z0 : z1 - d;
      if (x + w <= xb && !overlaps(x, zz0, x + w, zz0 + d, 6) && rand() < 0.85)
        addB(
          rand() < 0.15 ? "barn" : "chalet",
          x,
          zz0,
          x + w,
          zz0 + d,
          front,
          2 + (rand() < 0.4 ? 1 : 0),
        );
      x += w + 6 + Math.floor(rand() * 3) * 2;
    }
  };
  row(-100, -64, -16, 4, 0);
  row(-56, 6, -16, 4, 0);
  row(84, 104, -16, -8, 0);
  row(-102, -74, 60, 94, 2);
  row(-66, -44, 60, 94, 2);
  row(44, 86, 62, 94, 2);
  row(94, 146, 62, 94, 2);
  row(-102, -44, 104, 124, 0);
  row(44, 146, 104, 124, 0);
  // hillside chalets on the lower slope and the south hill, away from the pistes
  const scatter = (
    n: number,
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    t: BldType,
    coop: boolean,
  ) => {
    for (let tries = 0; tries < n * 30 && n > 0; tries++) {
      const w = 10 + Math.floor(rand() * 4) * 2;
      const d = 10 + Math.floor(rand() * 3) * 2;
      const x = x0 + rand() * (x1 - x0 - w);
      const z = z0 + rand() * (z1 - z0 - d);
      let ok = !overlaps(x, z, x + w, z + d, 10);
      for (let i = ci(x - 3); ok && i <= ci(x + w + 3); i++)
        for (let j = ci(z - 3); ok && j <= ci(z + d + 3); j++) if (clear[S(i, j)]) ok = false;
      if (!ok) continue;
      const b = addB(t, x, z, x + w, z + d, z < 0 ? 2 : 0, 2 + (rand() < 0.5 ? 1 : 0));
      if (coop) b.coop = true;
      n--;
    }
  };
  scatter(8, -160, -140, 150, -58, "chalet", false);
  scatter(7, -120, 128, 170, 200, "chalet", false);
  scatter(4, -260, -60, -160, 20, "chalet", false);
  scatter(3, 170, -40, 260, 120, "chalet", false);
  scatter(3, -270, 150, -120, 240, "barn", false);
  // co-op only: the east hamlet, the mountain hut and outlying barns
  scatter(6, 290, 0, 390, 120, "chalet", true);
  scatter(2, -80, -370, 20, -300, "hut", true);
  scatter(4, -390, -250, -290, 250, "barn", true);
  scatter(3, 290, 150, 390, 360, "chalet", true);

  // ---- 4b. snow that piles up: drifts banked against walls (wind-sculpted ramps that
  // merge into the ground), and ploughed ridges along the street and lane edges ----
  for (const b of buildings) {
    if (b.t === "station" || b.t === "topstation") continue;
    const br = mulberry(Math.floor(b.seed * 7e8));
    const amp = 0.55 + br() * 0.5;
    shape(b.x0 - 5, b.z0 - 5, b.x1 + 5, b.z1 + 5, (x, z, h) => {
      const dx = Math.max(b.x0 - x, 0, x - b.x1);
      const dz = Math.max(b.z0 - z, 0, z - b.z1);
      const d = Math.hypot(dx, dz);
      if (d <= 0 || d > 4.5) return h;
      // the street front stays clear (doors, shopfronts)
      const onFront =
        (b.front === 0 && z < b.z0 && dx === 0) ||
        (b.front === 2 && z > b.z1 && dx === 0) ||
        (b.front === 1 && x > b.x1 && dz === 0) ||
        (b.front === 3 && x < b.x0 && dz === 0);
      if (onFront) return h;
      const wob = 0.6 + 0.8 * fbm(x / 6, z / 6, 2, 131);
      return h + amp * wob * Math.pow(1 - d / 4.5, 1.6);
    });
  }
  for (const p of PATHS) {
    if (p.kind !== "street" && p.kind !== "lane" && p.kind !== "road") continue;
    const bx = bbox(p.pts, p.w / 2 + 5);
    shape(bx.x0, bx.z0, bx.x1, bx.z1, (x, z, h) => {
      const r = polyDist(x, z, p.pts);
      const e = r.d - p.w / 2; // metres beyond the kerb
      if (e < -0.6 || e > 4) return h;
      // gaps where the plough lifted the blade (doorways, lanes), irregular height
      const gate = smooth(0.42, 0.52, fbm(r.s / 9, p.w, 2, 71));
      if (gate <= 0) return h;
      const hgt = (0.6 + 0.5 * fbm(x / 5, z / 5, 2, 93)) * gate;
      // steep cut face on the road side, a flat-ish crest, a long back slope
      const prof = e < 0.6 ? smooth(-0.6, 0.6, e) : 1 - smooth(1.4, 4, e);
      return h + hgt * prof;
    });
  }

  // ---- 5. set-piece structures ----
  // covered bridge: the deck is a platform at street level (terrain.platforms), the creek
  // gully runs on beneath it; its side walls and abutments are solid
  const bridgeY = Math.max(hAt(BRIDGE.x0 - 3, BRIDGE.z), hAt(BRIDGE.x1 + 3, BRIDGE.z));
  for (const zz of [BRIDGE.z - BRIDGE.w / 2 - 1, BRIDGE.z + BRIDGE.w / 2 + 1])
    block(BRIDGE.x0 - 2, zz - 1, BRIDGE.x1 + 2, zz + 1, -1, bridgeY + 6);
  // rink: boards around the ice, open at the north and south
  const rinkY = hAt((RINK.x0 + RINK.x1) / 2, (RINK.z0 + RINK.z1) / 2);
  for (let x = RINK.x0; x < RINK.x1; x += 2) {
    const gate = Math.abs(x + 1 - (RINK.x0 + RINK.x1) / 2) < 3;
    if (!gate) {
      block(x, RINK.z0 - 2, x + 2, RINK.z0, -1);
      block(x, RINK.z1, x + 2, RINK.z1 + 2, -1);
    }
  }
  for (let z = RINK.z0; z < RINK.z1; z += 2) {
    block(RINK.x0 - 2, z, RINK.x0, z + 2, -1);
    block(RINK.x1, z, RINK.x1 + 2, z + 2, -1);
  }
  // ski jump: timber in-run on trestles
  block(JUMP.x - 3, JUMP.z0 - 2, JUMP.x + 3, JUMP.z1, S_BLD, jumpTopG + 25);
  // deck railing (front and east edges)
  for (let x = DECK.x0; x < DECK.x1; x += 2) block(x, DECK.z1, x + 2, DECK.z1 + 2, -1, deckY + 1.3);
  for (let z = DECK.z0; z < DECK.z1 + 2; z += 2) block(DECK.x1, z, DECK.x1 + 2, z + 2, -1, deckY + 1.3);
  // summit lodge deck: railing along its downhill (south) and west edges
  for (let x = LODGE_DECK.x0; x < LODGE_DECK.x1; x += 2) block(x, LODGE_DECK.z1, x + 2, LODGE_DECK.z1 + 2, -1, plateauY + 1.3);
  for (let z = LODGE_DECK.z0; z < LODGE_DECK.z1 + 2; z += 2) block(LODGE_DECK.x0 - 2, z, LODGE_DECK.x0, z + 2, -1, plateauY + 1.3);
  // terminal canopy posts
  for (const t of [BASE_TERM, TOP_TERM]) {
    const gy = hAt((t.x0 + t.x1) / 2, (t.z0 + t.z1) / 2);
    for (const px of [t.x0, t.x1 - 2]) for (const pz of [t.z0, t.z1 - 2]) block(px, pz, px + 2, pz + 2, -1, gy + 6);
  }

  // chairlift supports: the two stations (seat ~0.6 m above each loading platform) and a
  // tower every ~35 m, each tall enough that a hanging chair clears the snow by 3.5 m+
  const supports: LiftSupport[] = [];
  const baseZ = LIFT_Z0 + 2;
  const topZ = LIFT_Z1 - 2;
  supports.push({ z: baseZ, y: plazaY + 3.2, ground: plazaY, kind: "base" });
  const tz: number[] = [baseZ - 12];
  const nT = Math.max(2, Math.round((baseZ - 12 - (topZ + 12)) / 35));
  for (let k = 1; k <= nT; k++) tz.push(baseZ - 12 - ((baseZ - 12 - (topZ + 12)) * k) / nT);
  for (const z of tz) {
    const g = hAt(LIFT_X, z);
    supports.push({ z, y: g + 10, ground: g, kind: "tower" });
  }
  supports.push({ z: topZ, y: plateauY + 3.2, ground: plateauY, kind: "top" });
  // raise towers until every span clears: chair hangs 3.1 m, then 3.6 m of air (the first
  // and last 7 m by each station are the loading ramps)
  const CLEAR = 3.1 + 3.6;
  for (let it = 0; it < 40; it++) {
    let worst = 0;
    for (let i = 0; i + 1 < supports.length; i++) {
      const p0 = supports[i]!;
      const p1 = supports[i + 1]!;
      const span = Math.abs(p1.z - p0.z);
      for (let t = 0.02; t < 1; t += 0.02) {
        const z = p0.z + (p1.z - p0.z) * t;
        if (Math.abs(z - baseZ) < 7 || Math.abs(z - topZ) < 7) continue;
        const cy = p0.y + (p1.y - p0.y) * t - span * 0.018 * 4 * t * (1 - t);
        const need = Math.max(hAt(LIFT_X - 2.6, z), hAt(LIFT_X + 2.6, z)) + CLEAR - cy;
        if (need > 0.01) {
          worst = Math.max(worst, need);
          if (p0.kind === "tower") p0.y += need * (1 - t) * 1.2 + 0.05;
          if (p1.kind === "tower") p1.y += need * t * 1.2 + 0.05;
        }
      }
    }
    if (worst < 0.01) break;
  }
  for (const sp of supports) {
    if (sp.kind !== "tower") continue;
    block(LIFT_X - 1, sp.z - 1, LIFT_X + 1, sp.z + 1, -1, sp.y + 1);
    props.push({ k: "tower", x: LIFT_X, z: sp.z, y: sp.ground, rot: 0, s: sp.y - sp.ground });
  }
  const lift: Lift = { x: LIFT_X, gauge: 2.6, supports };

  // ---- 6. props ----
  const prop = (k: PropKind, x: number, z: number, rot = 0, s = 1, v?: number) => {
    const p: AProp = { k, x, z, y: hAt(x, z), rot, s };
    if (v !== undefined) p.v = v;
    props.push(p);
    return p;
  };
  const solidAt = (x: number, z: number) => solid[S(ci(x), ci(z))] === 1;
  // lamps along the streets and lanes, alternating sides
  for (const p of PATHS) {
    if (p.kind === "piste" || p.kind === "creek" || p.coop) continue;
    const len = polyDist(p.pts[0]![0], p.pts[0]![1], p.pts).len;
    const step = p.kind === "street" ? 16 : p.kind === "road" ? 30 : 22;
    let side = 1;
    for (let s = 6; s < len - 2; s += step) {
      const a = polyAt(p.pts, s);
      const b = polyAt(p.pts, s + 1);
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const l = Math.hypot(dx, dz) || 1;
      const off = p.w / 2 + 0.8;
      const x = a[0] + (-dz / l) * off * side;
      const z = a[1] + (dx / l) * off * side;
      if (!solidAt(x, z) && Math.abs(x) < HALF - 4 && Math.abs(z) < HALF - 4)
        prop("lamp", x, z, Math.atan2(dz, dx) + (side > 0 ? 0 : Math.PI));
      side = -side;
    }
  }
  // the square: fountain, a big lit Christmas tree, benches and café tables
  prop("xmas", 2, 43.5, 0, 1);
  block(0, 42, 4, 46, -1);
  prop("fountain", -8, 78, 0, 1);
  block(-10, 76, -6, 80, -1);
  for (let k = 0; k < 6; k++) {
    prop("bench", -38 + k * 13.5, 83, Math.PI, 1);
    block(-38 + k * 13.5 - 1, 82, -38 + k * 13.5 + 1, 84, -1);
  }
  for (let k = 0; k < 4; k++) {
    prop("table", 20 + (k % 2) * 4, 60 + Math.floor(k / 2) * 4, rand() * 3, 1);
    prop("heater", 22 + (k % 2) * 4, 62 + Math.floor(k / 2) * 4, 0, 1);
  }
  prop("snowman", 30, 76, 2.4, 1);
  block(29, 75, 31, 77, -1);
  prop("flag", -18, 38, 0, 1);
  // lift base plaza: snowcats, snowmobiles, ski racks, a signpost
  prop("snowcat", 18, -27, Math.PI / 2, 1, 0);
  block(12, -30, 24, -24, -1, plazaY + 4.5);
  prop("snowcat", 74, -44, 0.2, 1, 1);
  block(70, -50, 78, -38, -1, plazaY + 4.5);
  for (let k = 0; k < 4; k++) prop("snowmobile", 62 + k * 3.2, -24.5, 0, 1, k);
  block(60, -26, 74, -22, -1);
  for (let k = 0; k < 3; k++) prop("skirack", 30 + k * 3.6, -52.8, 0, 1);
  block(28, -54, 40, -52, -1);
  for (let k = 0; k < 3; k++) prop("skirack", 8.2, -30 + k * 3.6, Math.PI / 2, 1);
  block(7, -32, 10, -22, -1);
  prop("signpost", 34, -30, 0.4, 1);
  prop("bench", 66, -40, Math.PI / 2, 1);
  block(65, -42, 67, -38, -1);
  // groomer parked on the blue run, one on the east run (co-op)
  prop("snowcat", -40, -150, 0.9, 1, 2);
  block(-46, -156, -34, -144, -1);
  // summit: benches on the observation deck, the flag, café tables and umbrellas on the
  // lodge deck
  prop("flag", 54, -252, 0, 1.3);
  for (let k = 0; k < 3; k++) {
    prop("bench", 60 + k * 6, -252, Math.PI, 1);
    block(59 + k * 6, -253, 61 + k * 6, -251, -1);
  }
  for (let k = 0; k < 4; k++) {
    const tx = 9 + k * 5.5;
    prop("table", tx, -255, rand() * 3, 1);
    prop("umbrella", tx, -255, 0, 1, k);
    block(tx - 1, -256, tx + 1, -254, -1);
  }
  // piste markers and floodlights along the runs
  for (const p of PATHS) {
    if (p.kind !== "piste") continue;
    const len = polyDist(p.pts[0]![0], p.pts[0]![1], p.pts).len;
    const col = p.name === "blue" ? 0 : p.name === "black" ? 2 : 1;
    for (let s = 4; s < len; s += 18) {
      const a = polyAt(p.pts, s);
      const b = polyAt(p.pts, s + 1);
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const l = Math.hypot(dx, dz) || 1;
      for (const side of [-1, 1]) {
        const x = a[0] + (-dz / l) * (p.w / 2 + 0.5) * side;
        const z = a[1] + (dx / l) * (p.w / 2 + 0.5) * side;
        if (Math.abs(x) > HALF - 3 || Math.abs(z) > HALF - 3 || solidAt(x, z)) continue;
        prop("marker", x, z, 0, 1, col);
      }
      if (Math.round(s / 18) % 3 === 0) {
        const x = a[0] + (-dz / l) * (p.w / 2 + 2);
        const z = a[1] + (dx / l) * (p.w / 2 + 2);
        if (Math.abs(x) < HALF - 3 && Math.abs(z) < HALF - 3 && !solidAt(x, z)) {
          prop("flood", x, z, Math.atan2(dz, dx) + Math.PI / 2, 1);
          block(x - 1, z - 1, x + 1, z + 1, -1);
        }
      }
    }
  }
  // garden dressing against the back wall of chalets (never in a passage between houses),
  // only where there is room, and solid
  for (const b of buildings) {
    if (b.t !== "chalet" && b.t !== "barn" && b.t !== "lodge") continue;
    const r = mulberry(Math.floor(b.seed * 1e9));
    const back = ((b.front + 2) % 4) as 0 | 1 | 2 | 3;
    const t = 0.25 + r() * 0.5;
    const x = back === 1 ? b.x1 + 1 : back === 3 ? b.x0 - 1 : b.x0 + (b.x1 - b.x0) * t;
    const z = back === 2 ? b.z1 + 1 : back === 0 ? b.z0 - 1 : b.z0 + (b.z1 - b.z0) * t;
    // at least 5 m of open ground beyond it
    const ox = back === 1 ? 1 : back === 3 ? -1 : 0;
    const oz = back === 2 ? 1 : back === 0 ? -1 : 0;
    let room = true;
    for (let d = 1; d <= 6 && room; d += 1)
      if (solid[S(ci(x + ox * d * 1.0), ci(z + oz * d * 1.0))] || surf[S(ci(x + ox * d), ci(z + oz * d))] === S_PATH) room = false;
    if (!room) continue;
    const kinds: PropKind[] = ["woodpile", "woodpile", "sled", "barrel", "woodpile"];
    prop(kinds[Math.floor(r() * kinds.length)]!, x, z, back * (Math.PI / 2), 1);
    block(x - 1, z - 1, x + 1, z + 1, -1);
  }

  // ---- 7. forest and rocks ----
  const lakeE = (x: number, z: number) =>
    Math.hypot((x - LAKE.x) / LAKE.rx, (z - LAKE.z) / LAKE.rz);
  const density = (x: number, z: number, h: number) => {
    const zc = STREET_Z + 10;
    const north = Math.max(0, zc - 90 - z);
    const south = Math.max(0, z - zc - 80);
    let d = 0.9 * smooth(0, 35, north) * (1 - smooth(150, 205, h));
    d = Math.max(d, 0.8 * smooth(0, 30, south));
    // clumps in the valley meadows
    const clump = fbm(x / 70, z / 70, 3, 51 + (seed & 255));
    d = Math.max(d, smooth(0.6, 0.72, clump) * 0.75);
    d *= 0.55 + 0.8 * fbm(x / 90, z / 90, 3, 77 + (seed & 511));
    if (lakeE(x, z) < 1.25) d *= 0.3;
    return clamp(d, 0, 1);
  };
  const G = 6.2;
  for (let gx = -HALF + 3; gx < HALF - 3; gx += G)
    for (let gz = -HALF + 3; gz < HALF - 3; gz += G) {
      const x = gx + (rand() - 0.5) * G * 0.9;
      const z = gz + (rand() - 0.5) * G * 0.9;
      if (Math.abs(x) > HALF - 3 || Math.abs(z) > HALF - 3) continue;
      const k = S(ci(x), ci(z));
      if (clear[k] || solid[k]) continue;
      const y = hAt(x, z);
      const d = density(x, z, y);
      if (rand() > d) continue;
      const tall = rand() < 0.22;
      // stunted near the tree line, tallest down in the valley
      const alt = 1 - 0.45 * smooth(50, 150, y);
      const h = (tall ? 15 + rand() * 6 : 7 + rand() * 8) * alt;
      trees.push({
        x,
        z,
        y,
        h,
        w: 0.26 + rand() * 0.1,
        rot: rand() * Math.PI * 2,
        k: tall ? 1 : 0,
      });
      // block around the trunk out to about half the canopy, so nobody walks in under the
      // lowest branches (from beneath they are just dark undersides)
      const wk = ((0.26 + 0.05) / 0.3) * (tall ? 0.72 : 1);
      const br = 0.18 * h * wk + 0.3;
      for (let i = ci(x - br); i <= ci(x + br); i++)
        for (let j = ci(z - br); j <= ci(z + br); j++)
          if (Math.hypot(cc(i) - x, cc(j) - z) < br && !clear[S(i, j)]) {
            solid[S(i, j)] = 1;
            tops[S(i, j)] = Math.max(tops[S(i, j)]!, y + h * (Math.hypot(cc(i) - x, cc(j) - z) < 1.2 ? 1 : 0.5));
          }
      solid[k] = 1;
      tops[k] = Math.max(tops[k]!, y + h);
      if (d > 0.35 && surf[k] === S_SNOW) surf[k] = S_FOREST;
    }
  // forest floor tint around the trees (minimap + terrain shading)
  for (const t of trees) {
    for (let di = -1; di <= 1; di++)
      for (let dj = -1; dj <= 1; dj++) {
        const k = S(ci(t.x + di * 2), ci(t.z + dj * 2));
        if (surf[k] === S_SNOW) surf[k] = S_FOREST;
      }
  }
  // rock outcrops and boulder fields on the slopes; cliffs where the ground is too steep
  for (let tries = 0; tries < 900; tries++) {
    const x = (rand() - 0.5) * (ALPINE_SIZE - 20);
    const z = (rand() - 0.5) * (ALPINE_SIZE - 20);
    const y = hAt(x, z);
    const slope = Math.abs(hAt(x + 3, z) - hAt(x - 3, z)) + Math.abs(hAt(x, z + 3) - hAt(x, z - 3));
    if (slope < 1.2 && rand() < 0.8) continue;
    const k = S(ci(x), ci(z));
    if (clear[k] || solid[k]) continue;
    const s = 1 + rand() * 2.2;
    let near = false;
    for (let i = ci(x - s - 3); !near && i <= ci(x + s + 3); i++)
      for (let j = ci(z - s - 3); !near && j <= ci(z + s + 3); j++) if (clear[S(i, j)]) near = true;
    if (near) continue;
    props.push({ k: "boulder", x, z, y, rot: rand() * 6.28, s, v: Math.floor(rand() * 4) });
    for (let i = ci(x - s * 0.8); i <= ci(x + s * 0.8); i++)
      for (let j = ci(z - s * 0.8); j <= ci(z + s * 0.8); j++) {
        solid[S(i, j)] = 1;
        surf[S(i, j)] = S_ROCK;
        tops[S(i, j)] = Math.max(tops[S(i, j)]!, y + s * 1.6);
      }
  }
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      const a = hv(i, j);
      const b = hv(i + 1, j);
      const c = hv(i, j + 1);
      const d = hv(i + 1, j + 1);
      // gradient across the cell; tan(32 deg) = 0.62
      const grad = Math.hypot((b - a + d - c) / 2, (c - a + d - b) / 2) / CELL;
      const k = S(i, j);
      const onBridge = cc(i) > BRIDGE.x0 - 1 && cc(i) < BRIDGE.x1 + 1 && Math.abs(cc(j) - BRIDGE.z) < BRIDGE.w / 2 + 1;
      if (grad > 0.62 && surf[k] !== S_DECK && !onBridge) {
        solid[k] = 1;
        if (surf[k] !== S_BLD) surf[k] = S_ROCK;
      }
    }

  // ---- 7b. zones: the mountain face above the village can't be walked (up or down); the
  // summit island around the lodge and the top terminal is reached only by the lift ----
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      const x = cc(i);
      const z = cc(j);
      const north = valleyCentre(x) - 90 - z;
      const k = S(i, j);
      const onIsland = x > SUMMIT.x0 && x < SUMMIT.x1 && z > SUMMIT.z0 && z < SUMMIT.z1;
      if (north > 30 && !onIsland) solid[k] = 1;
      // the creek gully floor is off limits except under the bridge deck
      const onBridge = x > BRIDGE.x0 - 1 && x < BRIDGE.x1 + 1 && Math.abs(z - BRIDGE.z) < BRIDGE.w / 2 + 1;
      if (surf[k] === S_ICE && !onBridge && lakeE(x, z) > 1.02 && !(x > RINK.x0 - 1 && x < RINK.x1 + 1 && z > RINK.z0 - 1 && z < RINK.z1 + 1)) solid[k] = 1;
    }
  // the island's own edge: a solid ring (railings, fences) so nobody steps off
  for (let x = SUMMIT.x0 - 2; x <= SUMMIT.x1; x += 2) {
    block(x, SUMMIT.z0 - 2, x + 2, SUMMIT.z0, -1, plateauY + 1.3);
    block(x, SUMMIT.z1, x + 2, SUMMIT.z1 + 2, -1, plateauY + 1.3);
  }
  for (let z = SUMMIT.z0 - 2; z <= SUMMIT.z1; z += 2) {
    block(SUMMIT.x0 - 2, z, SUMMIT.x0, z + 2, -1, plateauY + 1.3);
    block(SUMMIT.x1, z, SUMMIT.x1 + 2, z + 2, -1, plateauY + 1.3);
  }
  // ... but the loading platform under the top terminal's canopy stays open
  for (let i = ci(TOP_TERM.x0 + 2); i <= ci(TOP_TERM.x1 - 2.01); i++)
    for (let j = ci(TOP_TERM.z0 + 0.01); j <= ci(TOP_TERM.z1 - 0.01); j++) solid[S(i, j)] = 0;
  for (let i = ci(BASE_TERM.x0 + 2); i <= ci(BASE_TERM.x1 - 2.01); i++)
    for (let j = ci(BASE_TERM.z0 + 2); j <= ci(BASE_TERM.z1 - 0.01); j++) solid[S(i, j)] = 0;

  // ---- 8. solo: seal the square with themed blockades ----
  const blockades: Blockade[] = [];
  if (sHalf !== null) {
    const walk = (x: number, z: number) => !solidAt(x, z);
    const gaps: Gap[] = findGaps(walk, sHalf, CELL);
    for (const g of gaps) {
      for (const b of sealGaps([g])) {
        const k = S(ci(b.x), ci(b.z));
        solid[k] = 1;
        surf[k] = S_BLOCKADE;
        tops[k] = hAt(b.x, b.z) + 4;
      }
      // split long gaps into dressed segments that suit the ground they cross
      const segs = Math.max(1, Math.round(g.w / 14));
      for (let s = 0; s < segs; s++) {
        const w = g.w / segs;
        const t = -g.w / 2 + w / 2 + s * w;
        const x = g.axis === "x" ? g.x + t : g.x;
        const z = g.axis === "z" ? g.z + t : g.z;
        const kind =
          surf[
            S(
              ci(x - Math.sign(x) * 4 * (g.axis === "z" ? 1 : 0)),
              ci(z - Math.sign(z) * 4 * (g.axis === "x" ? 1 : 0)),
            )
          ];
        let style: PropKind = "deadfall";
        if (kind === S_ROAD || kind === S_PATH) style = "gate";
        else if (kind === S_PISTE) style = "closed";
        else if (kind === S_ROCK) style = "rockfall";
        else if (kind === S_SNOW && rand() < 0.6) style = "debris";
        blockades.push({ x, z, w, axis: g.axis, style });
      }
    }
    // keep trees off the blockade line itself so the dressing reads
    for (let k = trees.length - 1; k >= 0; k--) {
      const t = trees[k]!;
      if (Math.abs(Math.max(Math.abs(t.x), Math.abs(t.z)) - sHalf) < 2.2) trees.splice(k, 1);
    }
    // a thicket of young spruce just behind the deadfall and debris
    for (const bl of blockades) {
      if (bl.style !== "deadfall" && bl.style !== "debris") continue;
      const n = Math.round(bl.w / 3);
      for (let k = 0; k < n; k++) {
        const t = (k + rand()) / n - 0.5;
        const o = 3 + rand() * 4;
        const x = bl.axis === "x" ? bl.x + t * bl.w : bl.x + Math.sign(bl.x) * o;
        const z = bl.axis === "z" ? bl.z + t * bl.w : bl.z + Math.sign(bl.z) * o;
        trees.push({
          x,
          z,
          y: 0,
          h: 3.5 + rand() * 3.5,
          w: 0.3 + rand() * 0.08,
          rot: rand() * 6.28,
          k: 2,
        });
      }
    }
  }

  // ---- 9. every open cell must be reachable: flood the nav grid and the fine grid ----
  const spawnI = ci(SPAWN.x);
  const spawnJ = ci(SPAWN.z);
  for (let i = spawnI - 2; i <= spawnI + 2; i++)
    for (let j = spawnJ - 2; j <= spawnJ + 2; j++) solid[S(i, j)] = 0;
  // the outermost cells sit against the arena wall
  for (let i = 0; i < N; i++) {
    solid[S(i, 0)] = solid[S(i, N - 1)] = solid[S(0, i)] = solid[S(N - 1, i)] = 1;
  }
  // nav grid: 4 m cells, solid unless at least 2 of its 4 fine cells are open (as level.ts)
  const NN = N / 2;
  const nav = new Uint8Array(NN * NN);
  for (let a = 0; a < NN; a++)
    for (let b = 0; b < NN; b++) {
      let open = 0;
      for (let da = 0; da < 2; da++)
        for (let db = 0; db < 2; db++) if (!solid[S(a * 2 + da, b * 2 + db)]) open++;
      nav[a * NN + b] = open < 2 || a === 0 || b === 0 || a === NN - 1 || b === NN - 1 ? 1 : 0;
    }
  const seenN = new Uint8Array(NN * NN);
  // two zones: the village (from the spawn) and the summit island (from its platform)
  const sumI = ci(40);
  const sumJ = ci(-254);
  const q: number[] = [(spawnI >> 1) * NN + (spawnJ >> 1), (sumI >> 1) * NN + (sumJ >> 1)];
  seenN[q[0]!] = 1;
  seenN[q[1]!] = 1;
  for (let h = 0; h < q.length; h++) {
    const c = q[h]!;
    const a = Math.floor(c / NN);
    const b = c - a * NN;
    for (let da = -1; da <= 1; da++)
      for (let db = -1; db <= 1; db++) {
        if (!da && !db) continue;
        const na = a + da;
        const nb = b + db;
        if (na < 0 || nb < 0 || na >= NN || nb >= NN) continue;
        const k = na * NN + nb;
        if (nav[k] || seenN[k]) continue;
        if (da && db && (nav[(a + da) * NN + b] || nav[a * NN + b + db])) continue;
        seenN[k] = 1;
        q.push(k);
      }
  }
  for (let a = 0; a < NN; a++)
    for (let b = 0; b < NN; b++) {
      const k = a * NN + b;
      if (nav[k] || seenN[k]) continue;
      for (let da = 0; da < 2; da++)
        for (let db = 0; db < 2; db++) solid[S(a * 2 + da, b * 2 + db)] = 1;
    }
  const seen = new Uint8Array(N * N);
  const fq: number[] = [S(spawnI, spawnJ), S(sumI, sumJ)];
  seen[fq[0]!] = 1;
  seen[fq[1]!] = 1;
  for (let h = 0; h < fq.length; h++) {
    const c = fq[h]!;
    const i = Math.floor(c / N);
    const j = c - i * N;
    const nb = [
      [i + 1, j],
      [i - 1, j],
      [i, j + 1],
      [i, j - 1],
    ];
    for (const [a, b] of nb) {
      if (a! < 0 || b! < 0 || a! >= N || b! >= N) continue;
      const k = S(a!, b!);
      if (solid[k] || seen[k]) continue;
      seen[k] = 1;
      fq.push(k);
    }
  }
  const blocks: Block[] = [];
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      const k = S(i, j);
      if (!solid[k] && !seen[k]) solid[k] = 1;
      if (solid[k])
        blocks.push({ x: cc(i), z: cc(j), h: surf[k] === S_BLD ? 8 : 2, tone: surf[k]! / 16 });
    }

  // ---- 10. walking speed: deep snow off the paths slows you down ----
  const speedOf = new Float32Array(16).fill(1);
  speedOf[S_SNOW] = 0.78;
  speedOf[S_FOREST] = 0.8;
  speedOf[S_ROCK] = 0.85;
  speedOf[S_PISTE] = 0.95;
  const terrain: Terrain = {
    half: HALF,
    cell: CELL,
    n: N,
    h: H,
    platforms: [
      { x0: BRIDGE.x0 - 1, z0: BRIDGE.z - BRIDGE.w / 2 - 0.5, x1: BRIDGE.x1 + 1, z1: BRIDGE.z + BRIDGE.w / 2 + 0.5, y: bridgeY + 0.1 },
    ],
    shot: (x: number, y: number, z: number) => {
      const i = Math.floor((x + HALF) / CELL);
      const j = Math.floor((z + HALF) / CELL);
      if (i < 0 || j < 0 || i >= N || j >= N) return true;
      return y < tops[i * N + j]!;
    },
    speed: (x: number, z: number) => {
      const i = Math.floor((x + HALF) / CELL);
      const j = Math.floor((z + HALF) / CELL);
      if (i < 0 || j < 0 || i >= N || j >= N) return 1;
      return speedOf[surf[i * N + j]!]!;
    },
  };

  // snap every prop and tree to the final ground
  for (const p of props) if (p.k !== "tower") p.y = hAt(p.x, p.z);
  for (const t of trees) t.y = hAt(t.x, t.z);

  const church = buildings.find((b) => b.t === "church" && b.style === 9)!;
  const alpine: AlpineData = {
    terrain,
    surf,
    buildings,
    trees,
    props,
    paths: PATHS,
    lift,
    lake: { ...LAKE, y: lakeY },
    rink: { ...RINK, y: rinkY },
    bridge: { ...BRIDGE, y: bridgeY },
    jump: {
      x: JUMP.x,
      z0: JUMP.z0,
      z1: JUMP.z1,
      top: jumpTopG + 20,
      lip: jumpLipG + 3,
      y0: jumpTopG,
      y1: jumpLipG,
    },
    deck: { ...DECK, y: deckY },
    plateau: plateauY,
    blockades,
    soloHalf: sHalf,
    spawnYaw: SPAWN_YAW,
    island: { ...SUMMIT },
    terminals: [
      { kind: "base", ...BASE_TERM, y: plazaY },
      { kind: "top", ...TOP_TERM, y: plateauY },
    ],
    lodgeDeck: { ...LODGE_DECK, y: plateauY },
    ride: {
      boardUp: [LIFT_X - 2.6, LIFT_Z0 + 3],
      boardDown: [LIFT_X + 2.6, LIFT_Z1 + 2],
      offTop: [LIFT_X - 6, LIFT_Z1 + 4, Math.PI * 0.75],
      offBase: [LIFT_X + 6, LIFT_Z0 + 8, Math.PI],
    },
    tops,
  };
  const layout: AlpineLayout = {
    cells: N,
    half: HALF,
    kind: surf,
    solid,
    roadX: [],
    roadZ: [],
    bandsX: [],
    bandsZ: [],
    buildings: [],
    parked: [],
    props: [],
    park: null,
    waterZ: 1e6,
    extent: HALF,
    spawn: { ...SPAWN },
    landmark: { x: (church.x0 + church.x1) / 2, z: (church.z0 + church.z1) / 2, h: 34 },
    alpine,
  };
  return { blocks, layout };
}
