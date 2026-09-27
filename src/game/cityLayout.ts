// Vice Heights: a deterministic, real-scale downtown (1 unit = 1 metre, 2 m grid cells).
// Pure data - no three.js - so every co-op client builds the identical city from the seed.
//
// Streets run on a grid of "bands" per axis. Cross-sections (cells of 2 m):
//   side    (20 m): sidewalk 4 | parking 2 | 2 lanes x 4 | parking 2 | sidewalk 4   (curb 12 m)
//   avenue  (32 m): sidewalk 6 | parking 2 | 4 lanes x 4 | parking 2 | sidewalk 6   (curb 20 m)
//   main    (36 m): sidewalk 6 | parking 2 | 2 lanes | 4 m palm median | 2 lanes | parking 2 | sidewalk 6
// Blocks are ~80 x 120 m with a 6 m service alley down the middle and lots along the
// street frontage. Height follows land value: a tower core, mid-rise rings, low-rise edges.
import type { Block } from "./level";
import { makeVehicle, vehicleHeight, type Vehicle } from "./vehicles";

// ---- cell kinds (minimap + collision + rendering) ----
export const K_ROAD = 0;
export const K_WALK = 1;
export const K_LOT = 2; // building footprint (solid)
export const K_PARKLANE = 3;
export const K_MEDIAN = 4;
export const K_ALLEY = 5;
export const K_PARK = 6;
export const K_BOARD = 7;
export const K_OPEN = 8; // open lot ground: surface parking, gas station apron, plaza, construction yard
export const K_PATH = 9; // park footpath

export type StreetClass = "side" | "avenue" | "main";
/** band width in 2 m cells */
export const CLASS_W: Record<StreetClass, number> = { side: 10, avenue: 16, main: 18 };
/** lane centre offsets from the road centre line, inner to outer, metres */
export const LANES: Record<StreetClass, number[]> = { side: [2], avenue: [2, 6], main: [4, 8] };
/** half the curb-to-curb width (parking lanes included), metres */
export const CURB: Record<StreetClass, number> = { side: 6, avenue: 10, main: 12 };

export type Road = { c: number; cls: StreetClass };
export type Mat =
  "glass" | "office" | "resid" | "brick" | "stucco" | "stone" | "steel" | "concrete";
export type BType =
  | "low"
  | "corner"
  | "terrace"
  | "mid"
  | "slab"
  | "court"
  | "tower"
  | "pencil"
  | "twin"
  | "super"
  | "warehouse"
  | "bigbox"
  | "garage"
  | "gas"
  | "construction"
  | "church"
  | "civic"
  | "hotel"
  | "diner"
  | "parking"
  | "empty"
  | "convention"
  | "mall";
export type Shape = "box" | "cyl" | "oct" | "taper" | "deco" | "chamfer";
export type Crown = "flat" | "spire" | "pyramid" | "slant" | "ring" | "mech" | "helipad";
export type Role =
  | "body"
  | "podium"
  | "tower"
  | "canopy"
  | "kiosk"
  | "frame"
  | "nave"
  | "steeple"
  | "bridge"
  | "deck";

/** A massing block from `y0` up, in world metres. */
export type Part = {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y0: number;
  h: number;
  role: Role;
  shape?: Shape;
  /** chamfered corner for shape "chamfer": 0 (x0,z0) 1 (x1,z0) 2 (x1,z1) 3 (x0,z1) */
  cham?: number;
};
export type Bld = {
  t: BType;
  /** lot rectangle, world metres */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** tallest point of the main massing (excluding spires and crowns) */
  h: number;
  /** storey height in metres (drives the window texture) */
  fh: number;
  mat: Mat;
  tone: number;
  seed: number;
  /** which side faces the street: 0 -z, 1 +x, 2 +z, 3 -x */
  front: 0 | 1 | 2 | 3;
  /** street-facing sides as a bit mask (1 << side) */
  street: number;
  corner: boolean;
  parts: Part[];
  crown?: Crown;
  backdrop?: boolean;
};
export type Spot = { x: number; z: number; rot: number };
export type ParkedCar = Spot & { v: Vehicle };
export type PropKind =
  | "light"
  | "lightLED"
  | "tree"
  | "palm"
  | "bench"
  | "hydrant"
  | "busstop"
  | "news"
  | "meter"
  | "manhole"
  | "drain"
  | "dumpster"
  | "subway"
  | "bollard"
  | "railing"
  | "trash"
  | "fountain"
  | "barrier";
export type Prop = Spot & { k: PropKind; s?: number };

export type Band = { a: number; b: number; kind: "street" | "block" | "board"; cls?: StreetClass };

export type CityLayout = {
  cells: number;
  half: number;
  kind: Uint8Array;
  /** 1 where a collision block sits (buildings, parked cars, fences) */
  solid: Uint8Array;
  /** N-S roads (fixed x) and E-W roads (fixed z) that carry traffic, in order */
  roadX: Road[];
  roadZ: Road[];
  /** every band per axis (arena and backdrop), in cells relative to the arena's cell 0 */
  bandsX: Band[];
  bandsZ: Band[];
  buildings: Bld[];
  parked: ParkedCar[];
  props: Prop[];
  park: { x0: number; z0: number; x1: number; z1: number } | null;
  /** z of the waterfront railing (the south edge of the arena) */
  waterZ: number;
  /** how far the backdrop reaches from the centre */
  extent: number;
  /** where players start (the landmark's plaza) */
  spawn: { x: number; z: number };
  /** landmark supertall (for the minimap / skyline) */
  landmark: { x: number; z: number; h: number } | null;
};

/** Lay out one axis: centre street, then blocks and streets outward to both edges. */
function axisBands(
  cells: number,
  centreCls: StreetClass,
  blockTarget: number,
  waterfrontPlus: boolean,
  beyond: number,
) {
  const w0 = CLASS_W[centreCls];
  const c0 = Math.floor(cells / 2) - Math.floor(w0 / 2);
  const bands: Band[] = [{ a: c0, b: c0 + w0, kind: "street", cls: centreCls }];
  const side = (dir: 1 | -1, start: number, end: number, board: boolean) => {
    const reserve = board ? CLASS_W.side + 12 : 0;
    const avail = Math.abs(end - start) - reserve;
    const sw = CLASS_W.side;
    const n = Math.max(1, Math.round((avail + sw) / (blockTarget + sw)));
    const streets: StreetClass[] = [];
    for (let k = 1; k < n; k++) streets.push(k % 2 === 0 ? "avenue" : "side");
    const streetTotal = streets.reduce((s, c) => s + CLASS_W[c], 0);
    const blockW = Math.floor((avail - streetTotal) / n);
    let rem = avail - streetTotal - blockW * n;
    let pos = start;
    const push = (w: number, kind: Band["kind"], cls?: StreetClass) => {
      const a = dir > 0 ? pos : pos - w;
      const b = dir > 0 ? pos + w : pos;
      bands.push(cls ? { a, b, kind, cls } : { a, b, kind });
      pos += dir * w;
    };
    for (let k = 0; k < n; k++) {
      const extra = rem > 0 ? 1 : 0;
      rem -= extra;
      push(blockW + extra, "block");
      if (k < n - 1) push(CLASS_W[streets[k]!], "street", streets[k]);
    }
    if (board) {
      push(CLASS_W.side, "street", "side");
      push(12, "board");
      return;
    }
    // backdrop continuation (outside the arena): same rhythm
    let k = n;
    while (Math.abs(pos - start) < Math.abs(end - start) + beyond) {
      const cls: StreetClass = k % 2 === 0 ? "avenue" : "side";
      push(CLASS_W[cls], "street", cls);
      push(blockTarget, "block");
      k++;
    }
  };
  side(1, c0 + w0, cells, waterfrontPlus);
  side(-1, c0, 0, false);
  bands.sort((p, q) => p.a - q.a);
  return bands;
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

/** snap a height to whole storeys */
const storeys = (h: number, fh: number) => Math.max(1, Math.round(h / fh)) * fh;

type Blk = { a: Band; b: Band };
type LotInfo = {
  front: Bld["front"];
  street: number;
  corner: boolean;
  /** chamfer corner index toward the street corner (corner lots) */
  cham: number;
};

export function generateCity(rand: () => number, cells: number, half: number) {
  const cc = (i: number) => -half + 1 + i * 2; // cell centre
  const ce = (i: number) => -half + i * 2; // cell lower edge
  const BEYOND = 330; // backdrop cells beyond the arena (660 m of skyline filler)
  const bx = axisBands(cells, "main", 40, false, BEYOND);
  const bz = axisBands(cells, "avenue", 55, true, BEYOND);
  const inArena = (b: Band) => b.a >= 0 && b.b <= cells;

  const N = cells * cells;
  const kind = new Uint8Array(N).fill(K_LOT);
  const solid = new Uint8Array(N);
  const idx = (i: number, j: number) => i * cells + j;
  const inside = (i: number, j: number) => i >= 0 && j >= 0 && i < cells && j < cells;

  // cross-section role at offset o within a street band of class cls
  const role = (cls: StreetClass, o: number, w: number) => {
    const sw = cls === "side" ? 2 : 3;
    if (o < sw || o >= w - sw) return K_WALK;
    if (o === sw || o === w - sw - 1) return K_PARKLANE;
    if (cls === "main" && (o === 8 || o === 9)) return K_MEDIAN;
    return K_ROAD;
  };
  const bandAt = (bands: Band[], i: number) => bands.find((b) => i >= b.a && i < b.b)!;
  const axX: Band[] = [];
  const axZ: Band[] = [];
  for (let i = 0; i < cells; i++) {
    axX.push(bandAt(bx, i));
    axZ.push(bandAt(bz, i));
  }
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      const a = axX[i]!;
      const b = axZ[j]!;
      let k: number = K_LOT;
      const sa = a.kind === "street" ? role(a.cls!, i - a.a, a.b - a.a) : -1;
      const sb = b.kind === "street" ? role(b.cls!, j - b.a, b.b - b.a) : -1;
      if (b.kind === "board") k = K_BOARD;
      else if (sa >= 0 && sb >= 0) {
        // intersection: roadway (crosswalks) unless both are sidewalk (the corner)
        k = sa === K_WALK && sb === K_WALK ? K_WALK : K_ROAD;
      } else if (sa >= 0) k = sa;
      else if (sb >= 0) k = sb;
      kind[idx(i, j)] = k;
    }
  }

  // ---- roads carrying traffic ----
  const roadOf = (b: Band): Road => ({ c: ce(b.a) + (b.b - b.a), cls: b.cls! });
  const roadX = bx.filter((b) => b.kind === "street" && b.a >= 1 && b.b <= cells - 1).map(roadOf);
  const roadZ = bz.filter((b) => b.kind === "street" && b.a >= 1 && b.b <= cells - 1).map(roadOf);

  // ---- land value: tower core just north of the spawn, falling off to the edges ----
  const sc = half / 300;
  const coreX = 0;
  const coreZ = -70 * sc;
  const value = (x: number, z: number) => {
    const d = Math.hypot((x - coreX) / (250 * sc), (z - coreZ) / (215 * sc));
    return Math.exp(-d * d * 1.25);
  };
  const waterZ = half;

  // ---- blocks ----
  const blocks: Blk[] = [];
  for (const a of bx)
    for (const b of bz) if (a.kind === "block" && b.kind === "block") blocks.push({ a, b });
  const arenaBlocks = blocks.filter((q) => inArena(q.a) && inArena(q.b));
  const buildings: Bld[] = [];
  const props: Prop[] = [];
  const parked: ParkedCar[] = [];
  const blocksOut: Block[] = [];
  const markSolid = (i0: number, j0: number, i1: number, j1: number, h: number) => {
    for (let i = Math.max(0, i0); i < Math.min(cells, i1); i++)
      for (let j = Math.max(0, j0); j < Math.min(cells, j1); j++) {
        if (solid[idx(i, j)]) continue;
        solid[idx(i, j)] = 1;
        blocksOut.push({ x: cc(i), z: cc(j), h, tone: 0 });
      }
  };
  const W = (i: number) => ce(i); // world edge of cell index
  const toI = (x: number) => (x + half) / 2;
  // collision always covers the visual footprint: round outward to whole cells
  const partCells = (p: { x0: number; z0: number; x1: number; z1: number }) =>
    [
      Math.floor(toI(p.x0) + 1e-6),
      Math.floor(toI(p.z0) + 1e-6),
      Math.ceil(toI(p.x1) - 1e-6),
      Math.ceil(toI(p.z1) - 1e-6),
    ] as const;
  const lotCells = (b: { x0: number; z0: number; x1: number; z1: number }) =>
    [
      Math.round(toI(b.x0)),
      Math.round(toI(b.z0)),
      Math.round(toI(b.x1)),
      Math.round(toI(b.z1)),
    ] as const;
  const setKind = (i0: number, j0: number, i1: number, j1: number, k: number, onlyFree = true) => {
    for (let i = i0; i < i1; i++)
      for (let j = j0; j < j1; j++)
        if (inside(i, j) && (!onlyFree || !solid[idx(i, j)])) kind[idx(i, j)] = k;
  };

  // the park is the block just north-east of the centre crossing, the landmark north-west
  const cxBand = bx.find((b) => b.kind === "street" && b.cls === "main")!;
  const czBand = bz.find((b) => b.kind === "street" && b.a <= cells / 2 && b.b >= cells / 2)!;
  const parkBlock = arenaBlocks.find((q) => q.a.a === cxBand.b && q.b.b === czBand.a) ?? null;
  const superBlock = arenaBlocks.find((q) => q.a.b === cxBand.a && q.b.b === czBand.a) ?? null;
  const blockValue = (q: Blk) => value(W((q.a.a + q.a.b) / 2), W((q.b.a + q.b.b) / 2));
  const conventionBlock =
    arenaBlocks
      .filter((q) => q !== parkBlock && q !== superBlock)
      .filter((q) => blockValue(q) > 0.2 && blockValue(q) < 0.45)
      .sort((p, q) => blockValue(q) - blockValue(p))[0] ?? null;

  const big = cells > 350;
  const quota = {
    construction: big ? 2 : 1,
    gas: big ? 2 : 1,
    church: 1,
    civic: 1,
    garage: big ? 3 : 2,
    hotel: big ? 3 : 2,
    diner: 2,
  };
  const used = { construction: 0, gas: 0, church: 0, civic: 0, garage: 0, hotel: 0, diner: 0 };
  // (held in an object: TypeScript does not track assignments made inside closures)
  const lm: { v: CityLayout["landmark"]; spawnZ: number } = { v: null, spawnZ: 0 };

  const lotBuilding = (
    lx0: number,
    lz0: number,
    lx1: number,
    lz1: number,
    info: LotInfo,
    backdrop: boolean,
    r: () => number,
  ): Bld => {
    const x0 = W(lx0);
    const z0 = W(lz0);
    const x1 = W(lx1);
    const z1 = W(lz1);
    const wx = x1 - x0;
    const wz = z1 - z0;
    const minS = Math.min(wx, wz);
    const maxS = Math.max(wx, wz);
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const v = value(cx, cz);
    const nearWater = waterZ - cz < 90;
    const seed = Math.floor(r() * 1e9);
    const tone = r();
    const { front, corner, street } = info;
    const base = { x0, z0, x1, z1, tone, seed, front, corner, street, backdrop } as const;
    const box = (
      px0: number,
      pz0: number,
      px1: number,
      pz1: number,
      h: number,
      rl: Role = "body",
      y0 = 0,
      shape?: Shape,
    ): Part =>
      shape
        ? { x0: px0, z0: pz0, x1: px1, z1: pz1, y0, h, role: rl, shape }
        : { x0: px0, z0: pz0, x1: px1, z1: pz1, y0, h, role: rl };
    const full = (h: number, rl: Role = "body", y0 = 0) => box(x0, z0, x1, z1, h, rl, y0);
    /** inset the lot on every side except... none: plain inset */
    const inset = (d: number, h: number, rl: Role, y0: number, shape?: Shape) =>
      box(x0 + d, z0 + d, x1 - d, z1 - d, h, rl, y0, shape);
    /** a rectangle d metres deep along the front side */
    const frontStrip = (d: number, h: number, y0 = 0, rl: Role = "body") =>
      front === 0
        ? box(x0, z0, x1, z0 + d, h, rl, y0)
        : front === 2
          ? box(x0, z1 - d, x1, z1, h, rl, y0)
          : front === 1
            ? box(x1 - d, z0, x1, z1, h, rl, y0)
            : box(x0, z0, x0 + d, z1, h, rl, y0);
    const roll = r();

    // ---- one-off land uses ----
    if (!backdrop) {
      if (used.construction < quota.construction && v > 0.35 && minS >= 30 && roll < 0.2) {
        used.construction++;
        const floors = 8 + Math.floor(r() * 12);
        const d = 6;
        return {
          ...base,
          t: "construction",
          h: floors * 4,
          fh: 4,
          mat: "concrete",
          parts: [box(x0 + d, z0 + d, x1 - d, z1 - d, floors * 4, "frame")],
        };
      }
      if (used.gas < quota.gas && corner && v < 0.4 && v > 0.05 && minS >= 26 && roll < 0.4) {
        used.gas++;
        const kx0 = front === 1 ? x1 - 14 : x0 + 2;
        const kz0 = info.street & 1 ? z1 - 12 : z0 + 2;
        return {
          ...base,
          t: "gas",
          h: 6.5,
          fh: 4.2,
          mat: "concrete",
          parts: [
            box(kx0, kz0, kx0 + 12, kz0 + 10, 4.2, "kiosk"),
            box(cx - 10, cz - 6, cx + 10, cz + 6, 1.1, "canopy", 5.4),
          ],
        };
      }
      if (
        used.church < quota.church &&
        v > 0.12 &&
        v < 0.55 &&
        minS >= 22 &&
        maxS >= 34 &&
        roll < 0.14
      ) {
        used.church++;
        const nh = 15 + r() * 4;
        const along = wz > wx;
        const nave = along
          ? box(cx - 9, z0 + 10, cx + 9, z1 - 3, nh, "nave")
          : box(x0 + 10, cz - 9, x1 - 3, cz + 9, nh, "nave");
        const st = along
          ? box(cx - 4.5, z0 + 1, cx + 4.5, z0 + 10, 38 + r() * 14, "steeple")
          : box(x0 + 1, cz - 4.5, x0 + 10, cz + 4.5, 38 + r() * 14, "steeple");
        return { ...base, t: "church", h: nh, fh: 6, mat: "stone", parts: [nave, st] };
      }
      if (used.civic < quota.civic && v > 0.25 && minS >= 30 && roll < 0.12) {
        used.civic++;
        return {
          ...base,
          t: "civic",
          h: 21,
          fh: 7,
          mat: "stone",
          crown: "flat",
          parts: [box(x0 + 5, z0 + 5, x1 - 5, z1 - 5, 21)],
        };
      }
      if (used.garage < quota.garage && v > 0.15 && v < 0.75 && minS >= 26 && roll < 0.16) {
        used.garage++;
        const levels = 4 + Math.floor(r() * 4);
        return {
          ...base,
          t: "garage",
          h: levels * 3.1,
          fh: 3.1,
          mat: "concrete",
          parts: [full(levels * 3.1, "deck")],
        };
      }
      if (used.hotel < quota.hotel && (nearWater || v > 0.5) && minS >= 24 && roll < 0.32) {
        used.hotel++;
        const pod = 10;
        const h = storeys(55 + r() * 95, 3.2) + pod;
        const shape: Shape = r() < 0.35 ? "cyl" : "box";
        return {
          ...base,
          t: "hotel",
          h,
          fh: 3.2,
          mat: r() < 0.55 ? "stucco" : "glass",
          crown: r() < 0.5 ? "ring" : "helipad",
          parts: [
            full(pod, "podium"),
            inset(Math.max(4, minS * 0.18), h - pod, "tower", pod, shape),
          ],
        };
      }
      if (
        used.diner < quota.diner &&
        v < 0.35 &&
        corner &&
        minS >= 16 &&
        minS < 34 &&
        roll < 0.35
      ) {
        used.diner++;
        const dx0 = front === 1 ? x1 - Math.min(wx - 2, 20) - 2 : x0 + 2;
        const dz0 = info.street & 1 ? z0 + 2 : z1 - 11;
        return {
          ...base,
          t: "diner",
          h: 5,
          fh: 5,
          mat: "steel",
          parts: [box(dx0, dz0, dx0 + Math.min(wx - 4, 20), dz0 + 9, 5)],
        };
      }
      if (v < 0.3 && roll > 0.93)
        return {
          ...base,
          t: minS >= 24 ? "parking" : "empty",
          h: 0,
          fh: 3,
          mat: "concrete",
          parts: [],
        };
    }

    // ---- general stock: pick a height class from land value ----
    const q = r();
    const tall = backdrop ? 0.5 : 1;
    const pTower =
      (minS >= 26 ? Math.min(0.88, 0.05 + 1.9 * v * v) : minS >= 14 && v > 0.25 ? 0.55 * v : 0) *
      tall;
    const pMid = Math.min(0.75, 0.14 + 0.55 * v) * (minS >= 12 ? 1 : 0.3);
    if (q < pTower) {
      // downtown tower: 120-350 m
      const fh = 4;
      const h = storeys(120 + r() * (50 + 200 * v), fh);
      const podH = storeys(12 + r() * 12, 4);
      const variant = r();
      if (minS < 26) {
        // pencil tower: tiny footprint, very tall
        const ph = storeys(150 + r() * 150 * Math.max(0.4, v), fh);
        return {
          ...base,
          t: "pencil",
          h: ph,
          fh,
          mat: r() < 0.55 ? "glass" : r() < 0.5 ? "steel" : "stone",
          crown: r() < 0.5 ? "spire" : "slant",
          parts: [box(x0 + 1, z0 + 1, x1 - 1, z1 - 1, ph, "tower", 0, "box")],
        };
      }
      if (variant < 0.1 && maxS > 50) {
        // twin towers with a sky bridge
        const alongX = wx > wz;
        const tw = Math.min(minS - 8, 26);
        const hh = h - podH;
        const p1 = alongX
          ? box(x0 + 4, cz - tw / 2, x0 + 4 + tw, cz + tw / 2, hh, "tower", podH, "box")
          : box(cx - tw / 2, z0 + 4, cx + tw / 2, z0 + 4 + tw, hh, "tower", podH, "box");
        const p2 = alongX
          ? box(x1 - 4 - tw, cz - tw / 2, x1 - 4, cz + tw / 2, hh, "tower", podH, "box")
          : box(cx - tw / 2, z1 - 4 - tw, cx + tw / 2, z1 - 4, hh, "tower", podH, "box");
        const by = podH + hh * 0.55;
        const bridge = alongX
          ? box(x0 + 4 + tw, cz - 3, x1 - 4 - tw, cz + 3, 8, "bridge", by)
          : box(cx - 3, z0 + 4 + tw, cx + 3, z1 - 4 - tw, 8, "bridge", by);
        return {
          ...base,
          t: "twin",
          h,
          fh,
          mat: r() < 0.6 ? "glass" : "steel",
          crown: r() < 0.5 ? "spire" : "pyramid",
          parts: [full(podH, "podium"), p1, p2, bridge],
        };
      }
      const shape: Shape =
        variant < 0.26
          ? "cyl"
          : variant < 0.38
            ? "oct"
            : variant < 0.55
              ? "deco"
              : variant < 0.66
                ? "taper"
                : variant < 0.74 && corner
                  ? "chamfer"
                  : "box";
      const ins = Math.max(3, minS * (0.1 + r() * 0.14));
      const mat: Mat =
        shape === "deco"
          ? r() < 0.5
            ? "stone"
            : "stucco"
          : shape === "cyl"
            ? "glass"
            : r() < 0.6
              ? "glass"
              : r() < 0.5
                ? "steel"
                : "office";
      const crowns: Crown[] = ["flat", "spire", "pyramid", "slant", "ring", "mech", "helipad"];
      const crown: Crown =
        shape === "deco"
          ? "spire"
          : shape === "cyl"
            ? r() < 0.5
              ? "ring"
              : "flat"
            : crowns[Math.floor(r() * crowns.length)]!;
      const tower = box(x0 + ins, z0 + ins, x1 - ins, z1 - ins, h - podH, "tower", podH, shape);
      if (shape === "chamfer") tower.cham = info.cham;
      // some towers skip the podium and rise straight from the sidewalk
      const parts =
        r() < 0.25 && shape !== "cyl"
          ? [{ ...tower, y0: 0, h, x0: x0 + 2, z0: z0 + 2, x1: x1 - 2, z1: z1 - 2 }]
          : [full(podH, "podium"), tower];
      return { ...base, t: "tower", h, fh, mat, crown, parts };
    }
    if (q < pTower + pMid) {
      // mid-rise: 30-120 m
      const resid = r() < 0.45;
      const fh = resid ? 3 : 4;
      const floors = resid
        ? 10 + Math.floor(r() * (6 + 14 * v))
        : 8 + Math.floor(r() * (4 + 11 * v));
      const h = floors * fh + (resid ? 1.5 : 0);
      const m: Mat = resid
        ? r() < 0.35
          ? "brick"
          : r() < 0.6
            ? "stucco"
            : "resid"
        : r() < 0.4
          ? "office"
          : r() < 0.45
            ? "concrete"
            : r() < 0.5
              ? "glass"
              : "stone";
      const kindRoll = r();
      if (resid && wx > 34 && wz > 34 && kindRoll < 0.45) {
        // L or U shaped courtyard block, open toward the back. The side legs start behind
        // the front leg: overlapping legs would put two differently-tiled facades (and two
        // sets of balconies) in the same plane, which z-fights.
        const d = 12;
        const fz0 = front === 0 ? z0 + d : z0;
        const fz1 = front === 2 ? z1 - d : z1;
        const fx0 = front === 3 ? x0 + d : x0;
        const fx1 = front === 1 ? x1 - d : x1;
        const opts = [
          box(fx0, z0, fx1, z0 + d, h),
          box(x0, fz0, x0 + d, fz1, h),
          box(x1 - d, fz0, x1, fz1, h),
          box(fx0, z1 - d, fx1, z1, h),
        ];
        const frontIdx = front === 0 ? 0 : front === 2 ? 3 : front === 1 ? 2 : 1;
        const sides = front === 0 || front === 2 ? [1, 2] : [0, 3];
        const legs: Part[] = [opts[frontIdx]!, opts[sides[0]!]!];
        if (r() < 0.6) legs.push(opts[sides[1]!]!);
        return { ...base, t: "court", h, fh, mat: m, parts: legs };
      }
      if (resid && maxS / minS > 2 && kindRoll < 0.7)
        return { ...base, t: "slab", h, fh, mat: m, crown: "mech", parts: [full(h)] };
      if (!resid && maxS >= 40 && minS >= 30 && kindRoll < 0.3) {
        // podium mall with an office slab on top
        const pod = 14;
        return {
          ...base,
          t: "mall",
          h: h + pod,
          fh,
          mat: m === "stone" ? "glass" : m,
          crown: "mech",
          parts: [full(pod, "podium"), frontStrip(Math.min(minS - 8, 18), h, pod, "tower")],
        };
      }
      if (corner && !resid && kindRoll < 0.5) {
        const p = full(h);
        p.shape = "chamfer";
        p.cham = info.cham;
        return { ...base, t: "mid", h, fh, mat: m, crown: "flat", parts: [p] };
      }
      if (!resid && kindRoll < 0.62 && minS >= 18) {
        // cantilever: a recessed arcade at street level, the offices above overhang it
        const low = storeys(h * 0.3, fh);
        const arcade = full(low);
        if (front === 0) arcade.z0 += 5;
        else if (front === 2) arcade.z1 -= 5;
        else if (front === 1) arcade.x1 -= 5;
        else arcade.x0 += 5;
        return {
          ...base,
          t: "mid",
          h,
          fh,
          mat: m,
          crown: "mech",
          parts: [arcade, full(h - low, "body", low)],
        };
      }
      if (kindRoll < 0.8 && h > 45) {
        // one setback above the street wall
        const sb = storeys(h * (0.55 + r() * 0.2), fh);
        return {
          ...base,
          t: "mid",
          h,
          fh,
          mat: m,
          crown: r() < 0.5 ? "mech" : "flat",
          parts: [full(sb), inset(Math.min(4, minS * 0.15), h - sb, "body", sb)],
        };
      }
      return {
        ...base,
        t: "mid",
        h,
        fh,
        mat: m,
        crown: r() < 0.4 ? "mech" : "flat",
        parts: [full(h)],
      };
    }
    // ---- low-rise: 8-25 m ----
    if (minS >= 34 && v < 0.28 && r() < 0.5) {
      const h = 9 + Math.floor(r() * 5);
      return {
        ...base,
        t: "warehouse",
        h,
        fh: 5,
        mat: r() < 0.5 ? "concrete" : "brick",
        parts: [full(h)],
      };
    }
    const floors = 2 + Math.floor(r() * 5);
    const fh = 3;
    const h = 4.5 + (floors - 1) * fh;
    const m: Mat = r() < 0.45 ? "brick" : r() < 0.65 ? "stucco" : r() < 0.5 ? "resid" : "concrete";
    const deep = front === 1 || front === 3 ? wx : wz;
    const lr = r();
    if (!corner && floors >= 4 && deep > 26 && lr < 0.2) {
      // stepped terrace: low along the street, each tier higher and further back. The tiers
      // are side-by-side bands (not nested boxes) so no two facades share a plane.
      const t1 = 4.5 + fh * 2;
      /** the band between a and b metres back from the front */
      const band = (a: number, b: number, hh: number): Part =>
        front === 0
          ? box(x0, z0 + a, x1, z0 + b, hh)
          : front === 2
            ? box(x0, z1 - b, x1, z1 - a, hh)
            : front === 1
              ? box(x1 - b, z0, x1 - a, z1, hh)
              : box(x0 + a, z0, x0 + b, z1, hh);
      const parts = [band(0, 6, t1), band(6, 12, t1 + fh * 2), band(12, deep, t1 + fh * 4)];
      return {
        ...base,
        t: "terrace",
        h: t1 + fh * 4,
        fh,
        mat: m === "concrete" ? "stucco" : m,
        parts,
      };
    }
    // small shops often only build the front of the lot: yard / loading at the back
    if (!corner && deep > 24 && lr < 0.55) {
      const d = 12 + Math.floor(r() * 5) * 2;
      return { ...base, t: "low", h, fh, mat: m, parts: [frontStrip(d, h)] };
    }
    return {
      ...base,
      t: corner && minS < 24 ? "corner" : "low",
      h,
      fh,
      mat: m,
      crown: r() < 0.3 ? "mech" : "flat",
      parts: [full(h)],
    };
  };

  const addBuilding = (b: Bld) => {
    buildings.push(b);
    if (b.backdrop) return;
    const [l0, m0, l1, m1] = lotCells(b);
    if (b.t === "parking" || b.t === "empty" || b.t === "bigbox") {
      setKind(l0, m0, l1, m1, K_OPEN);
      if (b.t === "parking" || b.t === "bigbox") {
        // rows of parked cars with drive aisles (bigbox: only the lot in front of the store)
        const store = b.parts[0];
        for (let i = l0 + 1; i < l1 - 1; i += 4) {
          for (let j = m0 + 1; j + 2 < m1 - 1; j += 3) {
            if (
              store &&
              i + 1 > toI(store.x0) - 3 &&
              i < toI(store.x1) + 3 &&
              j + 2 > toI(store.z0) - 3 &&
              j < toI(store.z1) + 3
            )
              continue;
            if (rand() < 0.35) continue;
            const v2 = makeVehicle(rand, 5.2);
            if (!v2) continue;
            parked.push({ x: cc(i), z: cc(j) + 1, rot: rand() < 0.5 ? 0 : Math.PI, v: v2 });
            markSolid(i, j, i + 1, j + 2, vehicleHeight(v2));
          }
        }
      }
      if (b.t !== "bigbox") return;
    }
    for (const p of b.parts) {
      if (p.role === "canopy" || p.role === "bridge" || p.y0 > 0) continue;
      const [a0, b0, a1, b1] = partCells(p);
      markSolid(a0, b0, a1, b1, p.h);
    }
    // any lot ground the massing leaves free (courtyards, forecourts, yards) is open paving;
    // the reachability pass below seals the parts nobody can get to
    setKind(l0, m0, l1, m1, K_OPEN);
    if (b.t === "gas") {
      const cp = b.parts[1]!;
      const [a0, b0, a1, b1] = partCells(cp);
      // canopy columns + pump islands
      markSolid(a0 + 1, b0 + 1, a0 + 2, b0 + 2, 5.4);
      markSolid(a1 - 2, b0 + 1, a1 - 1, b0 + 2, 5.4);
      markSolid(a0 + 1, b1 - 2, a0 + 2, b1 - 1, 5.4);
      markSolid(a1 - 2, b1 - 2, a1 - 1, b1 - 1, 5.4);
      const mid = Math.floor((b0 + b1) / 2);
      markSolid(a0 + 3, mid, a1 - 3, mid + 1, 1.2);
    }
    if (b.t === "construction") {
      // hoarding around the site with a gate on the street side
      for (let i = l0; i < l1; i++)
        for (let j = m0; j < m1; j++) {
          const edge = i === l0 || j === m0 || i === l1 - 1 || j === m1 - 1;
          const gate =
            Math.abs(i + 0.5 - (l0 + l1) / 2) < 2.5 || Math.abs(j + 0.5 - (m0 + m1) / 2) < 2.5;
          if (edge && !gate) markSolid(i, j, i + 1, j + 1, 2.4);
        }
    }
  };

  const blockBuild = (q: Blk, backdrop: boolean) => {
    const r = mulberry((q.a.a * 7919) ^ (q.b.a * 104729) ^ Math.floor(rand() * 1e9));
    const [i0, i1, j0, j1] = [q.a.a, q.a.b, q.b.a, q.b.b];
    if (!backdrop && q === parkBlock) return;
    const bxw0 = W(i0);
    const bzw0 = W(j0);
    const bxw1 = W(i1);
    const bzw1 = W(j1);
    const baseB = { tone: 0.5, front: 2 as const, corner: true, street: 15 };
    if (!backdrop && q === superBlock) {
      // the landmark: a ~480 m supertall on a podium, with a big plaza in front
      const cx = (bxw0 + bxw1) / 2;
      const cz = bzw0 + 38;
      const h = 468 + Math.floor(rand() * 8) * 4;
      buildings.push({
        ...baseB,
        t: "super",
        x0: cx - 30,
        z0: cz - 30,
        x1: cx + 30,
        z1: cz + 30,
        h,
        fh: 4,
        mat: "glass",
        seed: 777,
        crown: "spire",
        parts: [
          { x0: cx - 30, z0: cz - 30, x1: cx + 30, z1: cz + 30, y0: 0, h: 24, role: "podium" },
          {
            x0: cx - 22,
            z0: cz - 22,
            x1: cx + 22,
            z1: cz + 22,
            y0: 24,
            h: h - 24,
            role: "tower",
            shape: "taper",
          },
        ],
      });
      lm.v = { x: cx, z: cz, h };
      // players start at the south end of the plaza, looking up at the tower
      lm.spawnZ = Math.min(cz + 80, bzw1 - 12);
      const [a0, b0, a1, b1] = partCells({ x0: cx - 30, z0: cz - 30, x1: cx + 30, z1: cz + 30 });
      markSolid(a0, b0, a1, b1, 24);
      setKind(i0, j0, i1, j1, K_OPEN);
      // plaza trees in rows, a fountain between the tower and the spawn point
      const fz = (cz + 30 + lm.spawnZ) / 2;
      for (let x = bxw0 + 8; x < bxw1 - 6; x += 12) {
        props.push({ x, z: cz + 35, rot: 0, k: "tree", s: 1 });
        props.push({ x, z: bzw1 - 5, rot: 0, k: "tree", s: 1 });
      }
      props.push({ x: cx, z: fz, rot: 0, k: "fountain", s: 5 });
      const fc = partCells({ x0: cx - 5, z0: fz - 5, x1: cx + 5, z1: fz + 5 });
      markSolid(fc[0], fc[1], fc[2], fc[3], 1);
      return;
    }
    if (!backdrop && q === conventionBlock) {
      const x0 = bxw0 + 6;
      const z0 = bzw0 + 6;
      const x1 = bxw1 - 6;
      const z1 = bzw1 - 6;
      buildings.push({
        ...baseB,
        t: "convention",
        x0,
        z0,
        x1,
        z1,
        h: 22,
        fh: 5.5,
        mat: "glass",
        seed: 4242,
        crown: "flat",
        parts: [{ x0, z0, x1, z1, y0: 0, h: 22, role: "body" }],
      });
      markSolid(i0 + 3, j0 + 3, i1 - 3, j1 - 3, 22);
      setKind(i0, j0, i1, j1, K_OPEN);
      return;
    }
    const v = blockValue(q);
    const broll = r();
    if (!backdrop && v > 0.05 && v < 0.32 && broll < 0.14) {
      // big-box store at the back of the block, surface parking in front
      const depth = Math.round((j1 - j0) * 0.45);
      const store = {
        x0: bxw0 + 4,
        z0: W(j0 + 2),
        x1: bxw1 - 4,
        z1: W(j0 + 2 + depth),
        y0: 0,
        h: 9,
        role: "body" as const,
      };
      addBuilding({
        ...baseB,
        t: "bigbox",
        x0: bxw0,
        z0: bzw0,
        x1: bxw1,
        z1: bzw1,
        h: 9,
        fh: 9,
        mat: "concrete",
        seed: Math.floor(r() * 1e9),
        tone: r(),
        front: 2,
        street: 15,
        parts: [store],
      });
      return;
    }
    const wx = i1 - i0;
    // service alley down the middle of the block (along z)
    const hasAlley = wx >= 30;
    const am = i0 + Math.floor(wx / 2) - 1;
    const halves: [number, number, 3 | 1][] = hasAlley
      ? [
          [i0, am, 3],
          [am + 3, i1, 1],
        ]
      : [[i0, i1, 3]];
    // sometimes a big corner lot spans the full width at one end (the alley becomes a dead end)
    let endLot: { j0: number; j1: number } | null = null;
    if (hasAlley && r() < 0.25 + 0.5 * v) {
      const d = 14 + Math.floor(r() * 10);
      endLot = r() < 0.5 ? { j0, j1: j0 + d } : { j0: j1 - d, j1 };
      const atStart = endLot.j0 === j0;
      addBuilding(
        lotBuilding(
          i0,
          endLot.j0,
          i1,
          endLot.j1,
          {
            front: atStart ? 0 : 2,
            street: (1 << 1) | (1 << 3) | (atStart ? 1 : 4),
            corner: true,
            cham: atStart ? 0 : 3,
          },
          backdrop,
          r,
        ),
      );
    }
    if (hasAlley) {
      for (let i = am; i < am + 3; i++)
        for (let j = j0; j < j1; j++) {
          if (endLot && j >= endLot.j0 && j < endLot.j1) continue;
          if (inside(i, j)) kind[idx(i, j)] = K_ALLEY;
          // dumpsters against the walls, now and then
          if (!backdrop && i === am && (j - j0) % 9 === 4 && r() < 0.55)
            props.push({ x: cc(i) - 0.2, z: cc(j), rot: 0, k: "dumpster" });
        }
    }
    for (const [h0, h1, face] of halves) {
      let j = endLot && endLot.j0 === j0 ? endLot.j1 : j0;
      const jEnd = endLot && endLot.j1 === j1 ? endLot.j0 : j1;
      while (j < jEnd) {
        const vv = value(W((h0 + h1) / 2), W(j));
        const maxW = vv > 0.45 ? 24 : vv > 0.2 ? 18 : 14;
        let w = 5 + Math.floor(r() * (maxW - 4));
        if (jEnd - (j + w) < 5) w = jEnd - j;
        const atStart = j === j0;
        const atEnd = j + w === j1;
        const corner = atStart || atEnd;
        const front: Bld["front"] = corner && r() < 0.35 ? (atStart ? 0 : 2) : face;
        const street = (1 << face) | (atStart ? 1 : 0) | (atEnd ? 4 : 0);
        const cham = face === 3 ? (atStart ? 0 : 3) : atStart ? 1 : 2;
        addBuilding(lotBuilding(h0, j, h1, j + w, { front, street, corner, cham }, backdrop, r));
        j += w;
      }
    }
  };
  for (const q of blocks) blockBuild(q, !(inArena(q.a) && inArena(q.b)));
  // drop backdrop buildings over the sea
  for (let k = buildings.length - 1; k >= 0; k--)
    if (buildings[k]!.backdrop && buildings[k]!.z1 > waterZ) buildings.splice(k, 1);

  // ---- the park: lawn, crossing paths, trees, a fountain ----
  let park: CityLayout["park"] = null;
  if (parkBlock) {
    const [i0, i1, j0, j1] = [parkBlock.a.a, parkBlock.a.b, parkBlock.b.a, parkBlock.b.b];
    park = { x0: W(i0), z0: W(j0), x1: W(i1), z1: W(j1) };
    setKind(i0, j0, i1, j1, K_PARK, false);
    const pcx = Math.floor((i0 + i1) / 2);
    const pcz = Math.floor((j0 + j1) / 2);
    const onPath = (i: number, j: number) =>
      Math.abs(i - pcx) < 2 ||
      Math.abs(j - pcz) < 2 ||
      Math.abs((i - pcx) * (j1 - j0) - (j - pcz) * (i1 - i0)) < (i1 - i0 + j1 - j0) * 0.9 ||
      Math.abs((i - pcx) * (j1 - j0) + (j - pcz) * (i1 - i0)) < (i1 - i0 + j1 - j0) * 0.9 ||
      i === i0 + 2 ||
      i === i1 - 3 ||
      j === j0 + 2 ||
      j === j1 - 3;
    for (let i = i0 + 1; i < i1 - 1; i++)
      for (let j = j0 + 1; j < j1 - 1; j++) if (onPath(i, j)) kind[idx(i, j)] = K_PATH;
    markSolid(pcx - 3, pcz - 3, pcx + 3, pcz + 3, 1.2); // fountain basin
    props.push({ x: cc(pcx), z: cc(pcz), rot: 0, k: "fountain", s: 6 });
    for (let i = i0 + 3; i < i1 - 3; i += 3)
      for (let j = j0 + 3; j < j1 - 3; j += 3) {
        if (onPath(i, j) || onPath(i + 1, j) || onPath(i, j + 1)) continue;
        if (Math.abs(i - pcx) < 6 && Math.abs(j - pcz) < 6) continue;
        if (rand() < 0.5)
          props.push({
            x: cc(i) + rand() - 0.5,
            z: cc(j) + rand() - 0.5,
            rot: rand() * 6.28,
            k: "tree",
            s: 0.8 + rand() * 0.7,
          });
      }
    for (const [dx, dz] of [
      [8, 0],
      [-8, 0],
      [0, 8],
      [0, -8],
    ] as const)
      props.push({
        x: cc(pcx) + dx * 2,
        z: cc(pcz) + dz * 2,
        rot: Math.atan2(-dx, -dz),
        k: "bench",
      });
  }

  // ---- street furniture along the kerbs, parked cars in the parking lanes ----
  const isK = (i: number, j: number, k: number) => inside(i, j) && kind[idx(i, j)] === k;
  const streetX = axX.map((b) => b.kind === "street");
  const streetZ = axZ.map((b) => b.kind === "street");
  // within ~8 m of a crossing street (keeps kerbs clear around intersections)
  const nearIntersection = (i: number, j: number) => {
    for (let d = -4; d <= 4; d++) {
      if (streetX[i] && streetZ[j + d]) return true;
      if (streetZ[j] && streetX[i + d]) return true;
    }
    return false;
  };
  const streetClassAt = (i: number, j: number) => {
    const a = axX[i]!;
    const b = axZ[j]!;
    return a.kind === "street" ? a.cls! : b.kind === "street" ? b.cls! : "side";
  };
  for (let i = 1; i < cells - 1; i++) {
    for (let j = 1; j < cells - 1; j++) {
      const k = kind[idx(i, j)]!;
      if (k === K_PARKLANE) {
        const alongZ = isK(i, j - 1, K_PARKLANE) || isK(i, j + 1, K_PARKLANE);
        const t = alongZ ? j : i;
        if (nearIntersection(i, j) || solid[idx(i, j)]) continue;
        if (t % 3 === 0) {
          const run = alongZ ? [idx(i, j), idx(i, j + 1)] : [idx(i, j), idx(i + 1, j)];
          const ok = run.every((c) => kind[c] === K_PARKLANE && !solid[c]);
          if (ok && rand() < 0.6) {
            const v2 = makeVehicle(rand, 4.9);
            if (v2) {
              const x = alongZ ? cc(i) : cc(i) + 1;
              const z = alongZ ? cc(j) + 1 : cc(j);
              parked.push({
                x,
                z,
                rot: (alongZ ? 0 : Math.PI / 2) + (rand() < 0.5 ? Math.PI : 0),
                v: v2,
              });
              for (const c of run) {
                const ci = Math.floor(c / cells);
                const cj = c % cells;
                markSolid(ci, cj, ci + 1, cj + 1, vehicleHeight(v2));
              }
            }
          }
        }
        continue;
      }
      if (k === K_ROAD && (i * 7 + j * 13) % 97 === 0)
        props.push({ x: cc(i), z: cc(j), rot: 0, k: "manhole" });
      if (k !== K_WALK) continue;
      // kerb-side sidewalk cells: next to a parking lane or roadway
      const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const;
      const kerb = dirs.find(
        ([di, dj]) => isK(i + di, j + dj, K_PARKLANE) || isK(i + di, j + dj, K_ROAD),
      );
      if (!kerb) continue;
      const [di, dj] = kerb;
      const rot = Math.atan2(di, dj);
      const along = di === 0 ? i : j;
      const cls = streetClassAt(i, j);
      const x = cc(i) + di * 0.6;
      const z = cc(j) + dj * 0.6;
      if (nearIntersection(i, j)) {
        if ((i + j) % 5 === 0)
          props.push({ x: cc(i) - di * 0.6, z: cc(j) - dj * 0.6, rot: rot + Math.PI, k: "news" });
        if ((i * 3 + j) % 11 === 0)
          props.push({ x: cc(i) + di * 0.9, z: cc(j) + dj * 0.9, rot, k: "drain" });
        if ((i * 5 + j * 3) % 7 === 0)
          props.push({ x: cc(i) + di * 0.75, z: cc(j) + dj * 0.75, rot, k: "bollard" });
        continue;
      }
      if (along % 14 === 0) props.push({ x, z, rot, k: cls === "side" ? "light" : "lightLED" });
      else if (along % 7 === 3 && cls !== "side")
        props.push({
          x,
          z,
          rot,
          k: cls === "main" ? "palm" : "tree",
          s: cls === "main" ? 8 + rand() * 4 : 0.9 + rand() * 0.3,
        });
      else if (along % 9 === 5 && cls === "side" && rand() < 0.55)
        props.push({ x, z, rot, k: "tree", s: 0.8 + rand() * 0.3 });
      else if (along % 41 === 20 && cls !== "side")
        props.push({ x: cc(i) - di * 0.3, z: cc(j) - dj * 0.3, rot: rot + Math.PI, k: "busstop" });
      else if (along % 17 === 8 && rand() < 0.5) props.push({ x, z, rot, k: "hydrant" });
      else if (along % 13 === 7 && rand() < 0.3)
        props.push({ x: cc(i) - di * 0.5, z: cc(j) - dj * 0.5, rot: rot + Math.PI, k: "bench" });
      else if (along % 11 === 2 && rand() < 0.45) props.push({ x, z, rot, k: "meter" });
      else if (along % 23 === 11 && rand() < 0.5) props.push({ x, z, rot, k: "trash" });
    }
  }
  // palms down the boulevard median and along the boardwalk
  for (let i = 1; i < cells - 1; i++)
    for (let j = 1; j < cells - 1; j++) {
      const k = kind[idx(i, j)]!;
      if (k === K_MEDIAN && j % 5 === 0 && isK(i + 1, j, K_MEDIAN) && !nearIntersection(i, j))
        props.push({ x: cc(i) + 1, z: cc(j), rot: rand() * 6.28, k: "palm", s: 9 + rand() * 5 });
      if (k === K_BOARD) {
        if (j === cells - 1 && i % 2 === 0)
          props.push({ x: cc(i) + 1, z: waterZ - 0.3, rot: 0, k: "railing" });
        if (j === cells - 4 && i % 6 === 0)
          props.push({ x: cc(i), z: cc(j), rot: rand() * 6.28, k: "palm", s: 8 + rand() * 6 });
        if (j === cells - 8 && i % 11 === 5) props.push({ x: cc(i), z: cc(j), rot: 0, k: "bench" });
        if (j === cells - 8 && i % 12 === 0)
          props.push({ x: cc(i), z: cc(j), rot: 0, k: "lightLED" });
      }
    }
  // the boardwalk railing is solid (you can't walk into the sea)
  for (let i = 0; i < cells; i++)
    if (isK(i, cells - 1, K_BOARD)) markSolid(i, cells - 1, i + 1, cells, 1.1);

  // subway entrances on busy corners near the centre
  const spawnGuess = {
    x: ce(cxBand.a) + (cxBand.b - cxBand.a),
    z: ce(czBand.a) + (czBand.b - czBand.a),
  };
  for (const [x, z] of [
    [spawnGuess.x - 26, spawnGuess.z - 21],
    [spawnGuess.x + 30, spawnGuess.z + 22],
    [spawnGuess.x - 140, spawnGuess.z + 22],
  ] as const) {
    const i = Math.floor(toI(x));
    const j = Math.floor(toI(z));
    for (let d = 0; d < 6; d++) {
      const ii = i + d;
      if (
        isK(ii, j, K_WALK) &&
        isK(ii + 1, j, K_WALK) &&
        !solid[idx(ii, j)] &&
        !solid[idx(ii + 1, j)]
      ) {
        props.push({ x: cc(ii) + 1, z: cc(j), rot: 0, k: "subway" });
        markSolid(ii, j, ii + 2, j + 1, 1.1);
        break;
      }
    }
  }
  // perimeter: jersey barriers where a street or path runs into the arena wall
  for (let i = 0; i < cells; i++) {
    for (const [ci, cj, rot] of [
      [i, 0, 0],
      [0, i, Math.PI / 2],
      [cells - 1, i, Math.PI / 2],
    ] as const) {
      const k = kind[idx(ci, cj)]!;
      if (k === K_LOT || k === K_BOARD || solid[idx(ci, cj)]) continue;
      props.push({ x: cc(ci), z: cc(cj), rot, k: "barrier" });
    }
  }

  // spawn: the landmark's plaza, facing the tower
  const landmark = lm.v;
  const spawn = landmark ? { x: landmark.x, z: lm.spawnZ } : spawnGuess;

  // ---- connectivity: anything walkable that can't be reached from the spawn becomes solid ----
  const ring = (i: number, j: number) => i === 0 || j === 0 || i === cells - 1 || j === cells - 1;
  const si = Math.floor(toI(spawn.x));
  const sj = Math.floor(toI(spawn.z));
  const seen = new Uint8Array(N);
  const q2 = new Int32Array(N);
  let tail = 0;
  q2[tail++] = idx(si, sj);
  seen[idx(si, sj)] = 1;
  for (let h = 0; h < tail; h++) {
    const c = q2[h]!;
    const ci = Math.floor(c / cells);
    const cj = c - ci * cells;
    const nb = [c - cells, c + cells, c - 1, c + 1];
    const ok = [ci > 0, ci < cells - 1, cj > 0, cj < cells - 1];
    for (let k = 0; k < 4; k++) {
      if (!ok[k]) continue;
      const nn = nb[k]!;
      if (seen[nn] || solid[nn] || kind[nn] === K_LOT) continue;
      const ni = Math.floor(nn / cells);
      if (ring(ni, nn - ni * cells)) continue;
      seen[nn] = 1;
      q2[tail++] = nn;
    }
  }
  let sealed = 0;
  for (let i = 1; i < cells - 1; i++)
    for (let j = 1; j < cells - 1; j++) {
      const c = idx(i, j);
      if (seen[c] || solid[c]) continue;
      // unbuilt lot cells and enclosed courtyards: fill silently
      if (kind[c] !== K_LOT) sealed++;
      markSolid(i, j, i + 1, j + 1, kind[c] === K_LOT ? 3 : 1);
    }

  const layout: CityLayout = {
    cells,
    half,
    kind,
    solid,
    roadX,
    roadZ,
    bandsX: bx,
    bandsZ: bz,
    buildings,
    parked,
    props,
    park,
    waterZ,
    extent: half + BEYOND * 2,
    spawn,
    landmark,
  };
  return { blocks: blocksOut, layout, sealed };
}
