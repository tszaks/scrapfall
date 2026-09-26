// Vice Heights: a deterministic, real-scale downtown (1 unit = 1 metre, 2 m grid cells).
// Pure data - no three.js - so every co-op client builds the identical city from the seed.
//
// Streets run on a grid of "bands" per axis. Cross-sections (cells of 2 m):
//   side    (20 m): sidewalk 4 | parking 2 | 2 lanes x 4 | parking 2 | sidewalk 4   (curb 12 m)
//   avenue  (32 m): sidewalk 6 | parking 2 | 4 lanes x 4 | parking 2 | sidewalk 6   (curb 20 m)
//   main    (36 m): sidewalk 6 | parking 2 | 2 lanes | 4 m palm median | 2 lanes | parking 2 | sidewalk 6
// Blocks are ~80 x 110 m with a 6 m service alley down the middle and lots along the
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

export type StreetClass = "side" | "avenue" | "main";
export const CLASS_W: Record<StreetClass, number> = { side: 10, avenue: 16, main: 18 };
/** lane centre offsets from the road centre line, inner to outer, metres */
export const LANES: Record<StreetClass, number[]> = { side: [2], avenue: [2, 6], main: [4, 8] };
/** half the curb-to-curb width, metres */
export const CURB: Record<StreetClass, number> = { side: 6, avenue: 10, main: 12 };

export type Road = { c: number; cls: StreetClass };
export type Mat = "glass" | "office" | "resid" | "brick" | "stucco" | "stone" | "steel" | "concrete";
export type BType =
  | "low"
  | "corner"
  | "mid"
  | "slab"
  | "court"
  | "tower"
  | "pencil"
  | "twin"
  | "super"
  | "warehouse"
  | "garage"
  | "gas"
  | "construction"
  | "church"
  | "civic"
  | "hotel"
  | "diner"
  | "parking"
  | "empty"
  | "convention";

/** A massing block from the ground (or from `y0`), in world metres. */
export type Part = {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y0: number;
  h: number;
  role: "body" | "podium" | "tower" | "canopy" | "kiosk" | "frame" | "nave" | "steeple";
  shape?: "box" | "cyl" | "oct" | "taper" | "deco";
};
export type Bld = {
  t: BType;
  /** lot rectangle, world metres */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** tallest point of the main massing (excluding spires) */
  h: number;
  mat: Mat;
  tone: number;
  seed: number;
  /** which side faces the street: 0 -z, 1 +x, 2 +z, 3 -x */
  front: 0 | 1 | 2 | 3;
  corner: boolean;
  parts: Part[];
  crown?: "flat" | "spire" | "pyramid" | "slant" | "ring" | "mech";
  backdrop?: boolean;
};
export type Spot = { x: number; z: number; rot: number };
export type ParkedCar = Spot & { v: Vehicle };
export type Prop = Spot & { k: PropKind; s?: number; c?: number };
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
  | "signal"
  | "bollard"
  | "railing"
  | "trash";

export type CityLayout = {
  cells: number;
  half: number;
  kind: Uint8Array;
  /** N-S roads (fixed x) and E-W roads (fixed z) that carry traffic, in order */
  roadX: Road[];
  roadZ: Road[];
  /** every street band centre (including dead-end stubs and backdrop), for markings */
  bandsX: { a: number; b: number; cls?: StreetClass; kind: string }[];
  bandsZ: { a: number; b: number; cls?: StreetClass; kind: string }[];
  buildings: Bld[];
  parked: ParkedCar[];
  props: Prop[];
  park: { x0: number; z0: number; x1: number; z1: number } | null;
  /** z of the waterfront railing (south edge) */
  waterZ: number;
  /** how far the backdrop reaches from the centre */
  extent: number;
  /** spawn plaza centre */
  spawn: { x: number; z: number };
  /** landmark supertall (for the minimap / navigation) */
  landmark: { x: number; z: number; h: number } | null;
};

type Band = { a: number; b: number; kind: "street" | "block" | "board"; cls?: StreetClass };

/** Lay out one axis: centre street, then blocks and streets outward to both edges. */
function axisBands(cells: number, centreCls: StreetClass, blockTarget: number, waterfrontPlus: boolean, beyond: number) {
  const w0 = CLASS_W[centreCls];
  const c0 = Math.floor(cells / 2) - Math.floor(w0 / 2);
  const bands: Band[] = [{ a: c0, b: c0 + w0, kind: "street", cls: centreCls }];
  const side = (dir: 1 | -1, start: number, end: number, board: boolean) => {
    // fill [start, end) (dir=+1) or (end, start] (dir=-1) with block/street pairs
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
    }
    // backdrop continuation (outside the arena): same rhythm
    if (!board) {
      let k = n;
      while (Math.abs(pos - start) < Math.abs(end - start) + beyond) {
        const cls: StreetClass = k % 2 === 0 ? "avenue" : "side";
        push(CLASS_W[cls], "street", cls);
        push(blockTarget, "block");
        k++;
      }
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

export function generateCity(rand: () => number, cells: number, half: number) {
  const cc = (i: number) => -half + 1 + i * 2; // cell centre
  const ce = (i: number) => -half + i * 2; // cell lower edge
  const BEYOND = 150; // backdrop cells beyond the arena (300 m)
  const bx = axisBands(cells, "main", 40, false, BEYOND);
  const bz = axisBands(cells, "avenue", 55, true, BEYOND);
  const inArena = (b: Band) => b.b > 0 && b.a < cells;

  const N = cells * cells;
  const kind = new Uint8Array(N).fill(K_LOT);
  const solid = new Uint8Array(N);
  const idx = (i: number, j: number) => i * cells + j;

  // cross-section role at offset o within a street band of class cls
  const role = (cls: StreetClass, o: number, w: number) => {
    const sw = cls === "side" ? 2 : 3;
    if (o < sw || o >= w - sw) return K_WALK;
    if (o === sw || o === w - sw - 1) return K_PARKLANE;
    if (cls === "main" && (o === 8 || o === 9)) return K_MEDIAN;
    return K_ROAD;
  };
  const bandAt = (bands: Band[], i: number) => bands.find((b) => i >= b.a && i < b.b);
  const axX: (Band | undefined)[] = [];
  const axZ: (Band | undefined)[] = [];
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
      if (b.kind === "board") k = a.kind === "street" && sa !== K_WALK ? K_WALK : K_BOARD;
      else if (sa >= 0 && sb >= 0) {
        // intersection: roadway unless both are sidewalk (corner)
        k = sa === K_WALK && sb === K_WALK ? K_WALK : sa === K_WALK || sb === K_WALK ? K_ROAD : K_ROAD;
        if (sa === K_WALK && sb !== K_WALK) k = K_ROAD;
        if (sb === K_WALK && sa !== K_WALK) k = K_ROAD;
      } else if (sa >= 0) k = sa;
      else if (sb >= 0) k = sb;
      kind[idx(i, j)] = k;
    }
  }
  // N-S streets that end at the waterfront road: the boardwalk crossing stays walkway (done above)

  // ---- roads carrying traffic ----
  const roadX: Road[] = bx.filter((b) => b.kind === "street" && b.a >= 1 && b.b <= cells - 1).map((b) => ({ c: ce(b.a) + (b.b - b.a), cls: b.cls! }));
  const roadZ: Road[] = bz.filter((b) => b.kind === "street" && b.a >= 1 && b.b <= cells - 1).map((b) => ({ c: ce(b.a) + (b.b - b.a), cls: b.cls! }));

  // ---- land value: tower core just north of the spawn, falling off to the edges ----
  const coreX = 0;
  const coreZ = -70;
  const value = (x: number, z: number) => {
    const d = Math.hypot((x - coreX) / 240, (z - coreZ) / 205);
    return Math.exp(-d * d * 1.3);
  };
  const waterZ = ce(cells) - 0.5;

  // ---- blocks ----
  const blocks = [];
  for (const a of bx) for (const b of bz) if (a.kind === "block" && b.kind === "block") blocks.push({ a, b });
  const arenaBlocks = blocks.filter((q) => inArena(q.a) && inArena(q.b));
  const buildings: Bld[] = [];
  const props: Prop[] = [];
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
  // collision always covers the visual footprint: round outward to whole cells
  const partCells = (p: Part) =>
    [
      Math.floor((p.x0 + half) / 2 + 1e-6),
      Math.floor((p.z0 + half) / 2 + 1e-6),
      Math.ceil((p.x1 + half) / 2 - 1e-6),
      Math.ceil((p.z1 + half) / 2 - 1e-6),
    ] as const;

  // spawn plaza is the centre intersection; the park is the block just north-east of it
  const cxBand = bx.find((b) => b.kind === "street" && b.cls === "main")!;
  const czBand = bz.find((b) => b.kind === "street" && b.a <= cells / 2 && b.b >= cells / 2)!;
  const spawn = { x: ce(cxBand.a) + (cxBand.b - cxBand.a), z: ce(czBand.a) + (czBand.b - czBand.a) };
  const parkBlock = arenaBlocks.find((q) => q.a.a === cxBand.b && q.b.b === czBand.a) ?? null;
  // the landmark supertall: the core block west of the park
  const superBlock = arenaBlocks.find((q) => q.a.b === cxBand.a && q.b.b === czBand.a) ?? null;
  const conventionBlock = arenaBlocks
    .filter((q) => q !== parkBlock && q !== superBlock && q.a.b <= cells - 1 && q.a.a >= 1)
    .sort((p, q) => value(W(q.a.a), W(q.b.a)) - value(W(p.a.a), W(p.b.a)))
    .find((q) => value(W((q.a.a + q.a.b) / 2), W((q.b.a + q.b.b) / 2)) < 0.25) ?? null;

  let construction = 0;
  let gas = 0;
  let church = 0;
  let civic = 0;
  let garage = 0;
  let hotel = 0;
  let diner = 0;
  let landmark: CityLayout["landmark"] = null;

  const lotBuilding = (lx0: number, lz0: number, lx1: number, lz1: number, front: Bld["front"], corner: boolean, backdrop: boolean, r: () => number): Bld => {
    const x0 = W(lx0);
    const z0 = W(lz0);
    const x1 = W(lx1);
    const z1 = W(lz1);
    const wx = x1 - x0;
    const wz = z1 - z0;
    const minS = Math.min(wx, wz);
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const v = value(cx, cz);
    const nearWater = waterZ - cz < 70;
    const seed = Math.floor(r() * 1e9);
    const tone = r();
    const base = { x0, z0, x1, z1, tone, seed, front, corner, backdrop } as const;
    const box = (px0: number, pz0: number, px1: number, pz1: number, h: number, rl: Part["role"] = "body", y0 = 0, shape?: Part["shape"]): Part =>
      shape ? { x0: px0, z0: pz0, x1: px1, z1: pz1, y0, h, role: rl, shape } : { x0: px0, z0: pz0, x1: px1, z1: pz1, y0, h, role: rl };
    const full = (h: number, rl: Part["role"] = "body") => box(x0, z0, x1, z1, h, rl);
    const roll = r();
    // special one-offs first
    if (!backdrop) {
      if (construction < (cells > 350 ? 2 : 1) && v > 0.45 && minS >= 30 && roll < 0.2) {
        construction++;
        const fh = 40 + r() * 50;
        const inset = 6;
        return { ...base, t: "construction", h: fh, mat: "concrete", parts: [box(x0 + inset, z0 + inset, x1 - inset, z1 - inset, fh, "frame")] };
      }
      if (gas < (cells > 350 ? 2 : 1) && corner && v < 0.35 && v > 0.08 && minS >= 26 && roll < 0.35) {
        gas++;
        const kx0 = front === 1 || front === 3 ? (front === 1 ? x0 + 2 : x1 - 12) : x0 + 2;
        return {
          ...base,
          t: "gas",
          h: 6,
          mat: "concrete",
          parts: [box(kx0, z0 + 2, kx0 + 10, z0 + 10, 4.2, "kiosk"), box(cx - 9, cz - 5, cx + 9, cz + 7, 1.2, "canopy", 5)],
        };
      }
      if (church < 1 && v > 0.15 && v < 0.5 && minS >= 22 && roll < 0.12) {
        church++;
        const nh = 14 + r() * 4;
        return {
          ...base,
          t: "church",
          h: nh,
          mat: "stone",
          parts: [box(x0 + 2, z0 + 4, x1 - 2, z1 - 2, nh, "nave"), box(cx - 4, z0, cx + 4, z0 + 8, 34 + r() * 12, "steeple")],
        };
      }
      if (civic < 1 && v > 0.3 && minS >= 30 && roll < 0.1) {
        civic++;
        return { ...base, t: "civic", h: 20, mat: "stone", parts: [box(x0 + 4, z0 + 4, x1 - 4, z1 - 4, 20)] };
      }
      if (garage < (cells > 350 ? 3 : 2) && v > 0.2 && v < 0.7 && minS >= 26 && roll < 0.14) {
        garage++;
        const levels = 4 + Math.floor(r() * 3);
        return { ...base, t: "garage", h: levels * 3.1, mat: "concrete", parts: [full(levels * 3.1)] };
      }
      if (hotel < (cells > 350 ? 3 : 2) && (nearWater || v > 0.5) && minS >= 24 && roll < 0.3) {
        hotel++;
        const h = 60 + r() * 90;
        const pod = 9;
        return {
          ...base,
          t: "hotel",
          h,
          mat: r() < 0.5 ? "stucco" : "glass",
          crown: "ring",
          parts: [full(pod, "podium"), box(x0 + 4, z0 + 4, x1 - 4, z1 - 4, h - pod, "tower", pod, "box")],
        };
      }
      if (diner < 2 && v < 0.3 && corner && minS >= 16 && minS < 30 && roll < 0.35) {
        diner++;
        return { ...base, t: "diner", h: 5, mat: "steel", parts: [box(x0 + 2, z0 + 2, x0 + Math.min(wx - 2, 22), z0 + 11, 5)] };
      }
      if (v < 0.22 && roll > 0.93) return { ...base, t: minS >= 24 ? "parking" : "empty", h: 0, mat: "concrete", parts: [] };
    }
    // ---- general stock: pick a height class from land value ----
    const q = r();
    const pTower = minS >= 22 ? Math.min(0.85, 0.05 + 1.35 * v * v) : minS >= 14 && v > 0.35 ? 0.35 * v : 0;
    const pMid = 0.17 + 0.45 * v;
    if (q < pTower) {
      const podH = 12 + Math.floor(r() * 4) * 4;
      const h = 120 + r() * (60 + 170 * v);
      const variant = r();
      if (minS < 26) {
        // pencil tower: tiny footprint, very tall
        const ph = 150 + r() * 150;
        return { ...base, t: "pencil", h: ph, mat: r() < 0.6 ? "glass" : "steel", crown: r() < 0.5 ? "spire" : "slant", parts: [box(x0 + 1, z0 + 1, x1 - 1, z1 - 1, ph, "tower", 0, "box")] };
      }
      if (variant < 0.12 && Math.max(wx, wz) > 50) {
        // twin towers with a sky bridge
        const alongX = wx > wz;
        const tw = Math.min(minS - 8, 26);
        const p1 = alongX ? box(x0 + 4, cz - tw / 2, x0 + 4 + tw, cz + tw / 2, h - podH, "tower", podH, "box") : box(cx - tw / 2, z0 + 4, cx + tw / 2, z0 + 4 + tw, h - podH, "tower", podH, "box");
        const p2 = alongX ? box(x1 - 4 - tw, cz - tw / 2, x1 - 4, cz + tw / 2, h - podH, "tower", podH, "box") : box(cx - tw / 2, z1 - 4 - tw, cx + tw / 2, z1 - 4, h - podH, "tower", podH, "box");
        return { ...base, t: "twin", h, mat: "glass", crown: "flat", parts: [full(podH, "podium"), p1, p2] };
      }
      const shape: Part["shape"] = variant < 0.3 ? "cyl" : variant < 0.45 ? "oct" : variant < 0.62 ? "deco" : variant < 0.75 ? "taper" : "box";
      const inset = Math.max(3, minS * (0.14 + r() * 0.12));
      const mat: Mat = shape === "deco" ? (r() < 0.5 ? "stone" : "stucco") : r() < 0.72 ? "glass" : r() < 0.5 ? "steel" : "office";
      const crowns: Bld["crown"][] = ["flat", "spire", "pyramid", "slant", "ring", "mech"];
      return {
        ...base,
        t: "tower",
        h,
        mat,
        crown: shape === "deco" ? "spire" : crowns[Math.floor(r() * crowns.length)],
        parts: [full(podH, "podium"), box(x0 + inset, z0 + inset, x1 - inset, z1 - inset, h - podH, "tower", podH, shape)],
      };
    }
    if (q < pTower + pMid) {
      const resid = r() < 0.5;
      const fh = resid ? 3 : 4;
      const floors = 9 + Math.floor(r() * (8 + 14 * v));
      const h = floors * fh + 4.5;
      const m: Mat = resid ? (r() < 0.4 ? "brick" : r() < 0.6 ? "stucco" : "resid") : r() < 0.5 ? "office" : r() < 0.6 ? "concrete" : "glass";
      if (resid && wx > 30 && wz > 30 && r() < 0.5) {
        // L or U shaped courtyard block, open toward the street it fronts
        const d = 12;
        const legs: Part[] = [];
        const opts = [box(x0, z0, x1, z0 + d, h), box(x0, z0, x0 + d, z1, h), box(x1 - d, z0, x1, z1, h), box(x0, z1 - d, x1, z1, h)];
        // back leg (opposite the front) + two side legs = U; drop one side for an L
        const backIdx = front === 0 ? 3 : front === 2 ? 0 : front === 1 ? 1 : 2;
        legs.push(opts[backIdx]!);
        const sides = front === 0 || front === 2 ? [1, 2] : [0, 3];
        legs.push(opts[sides[0]!]!);
        if (r() < 0.6) legs.push(opts[sides[1]!]!);
        return { ...base, t: "court", h, mat: m, parts: legs };
      }
      if (resid && Math.max(wx, wz) / minS > 2.2) return { ...base, t: "slab", h, mat: m, parts: [full(h)] };
      return { ...base, t: "mid", h, mat: m, crown: r() < 0.4 ? "mech" : "flat", parts: [full(h)] };
    }
    // low-rise: shops, walk-ups, warehouses on big outer lots
    if (minS >= 34 && v < 0.25 && r() < 0.5) {
      const h = 9 + r() * 6;
      return { ...base, t: "warehouse", h, mat: r() < 0.5 ? "concrete" : "brick", parts: [full(h)] };
    }
    const floors = 2 + Math.floor(r() * 5);
    const h = 4.5 + (floors - 1) * 3.2;
    const m: Mat = r() < 0.45 ? "brick" : r() < 0.7 ? "stucco" : "concrete";
    // small shops often only build the front of the lot: yard / loading at the back
    const deep = front === 1 || front === 3 ? wx : wz;
    if (!corner && deep > 24 && r() < 0.5) {
      const d = 10 + Math.floor(r() * 5) * 2;
      const p =
        front === 1 ? box(x1 - d, z0, x1, z1, h) : front === 3 ? box(x0, z0, x0 + d, z1, h) : front === 0 ? box(x0, z0, x1, z0 + d, h) : box(x0, z1 - d, x1, z1, h);
      return { ...base, t: "low", h, mat: m, parts: [p] };
    }
    return { ...base, t: corner && minS < 22 ? "corner" : "low", h, mat: m, parts: [full(h)] };
  };

  const blockBuild = (q: (typeof blocks)[number], backdrop: boolean) => {
    const r = mulberry((q.a.a * 7919) ^ (q.b.a * 104729) ^ Math.floor(rand() * 1e9));
    const [i0, i1, j0, j1] = [q.a.a, q.a.b, q.b.a, q.b.b];
    if (!backdrop && q === parkBlock) return;
    if (!backdrop && q === superBlock) {
      // the landmark: a 470-500 m supertall on a podium, with a plaza in front
      const x0 = W(i0);
      const z0 = W(j0);
      const x1 = W(i1);
      const z1 = W(j1);
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2 - 8;
      const h = 470 + rand() * 30;
      const b: Bld = {
        t: "super",
        x0,
        z0,
        x1,
        z1,
        h,
        mat: "glass",
        tone: 0.3,
        seed: 777,
        front: 2,
        corner: true,
        crown: "spire",
        parts: [
          { x0: cx - 30, z0: cz - 30, x1: cx + 30, z1: cz + 30, y0: 0, h: 24, role: "podium" },
          { x0: cx - 22, z0: cz - 22, x1: cx + 22, z1: cz + 22, y0: 24, h: h - 24, role: "tower", shape: "taper" },
        ],
      };
      buildings.push(b);
      landmark = { x: cx, z: cz, h };
      const [a0, b0, a1, b1] = partCells(b.parts[0]!);
      markSolid(a0, b0, a1, b1, 24);
      // plaza around it
      for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) if (!solid[idx(i, j)]) kind[idx(i, j)] = K_OPEN;
      return;
    }
    if (!backdrop && q === conventionBlock) {
      const x0 = W(i0) + 6;
      const z0 = W(j0) + 6;
      const x1 = W(i1) - 6;
      const z1 = W(j1) - 6;
      buildings.push({
        t: "convention",
        x0,
        z0,
        x1,
        z1,
        h: 22,
        mat: "glass",
        tone: 0.5,
        seed: 4242,
        front: 2,
        corner: true,
        parts: [{ x0, z0, x1, z1, y0: 0, h: 22, role: "body" }],
      });
      markSolid(i0 + 3, j0 + 3, i1 - 3, j1 - 3, 22);
      for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) if (!solid[idx(i, j)] && i >= 0 && j >= 0 && i < cells && j < cells) kind[idx(i, j)] = K_OPEN;
      return;
    }
    const wx = i1 - i0;
    // service alley down the middle of the block (along z)
    const hasAlley = wx >= 30;
    const am = i0 + Math.floor(wx / 2) - 1;
    const halves: [number, number, 3 | 1][] = hasAlley ? [[i0, am, 3], [am + 3, i1, 1]] : [[i0, i1, 3]];
    // sometimes a big corner lot spans the full width at one end (alley becomes a dead end)
    let endLot: { j0: number; j1: number } | null = null;
    const v = value(W((i0 + i1) / 2), W((j0 + j1) / 2));
    if (hasAlley && r() < 0.25 + 0.5 * v) {
      const d = 14 + Math.floor(r() * 10);
      endLot = r() < 0.5 ? { j0, j1: j0 + d } : { j0: j1 - d, j1 };
      const b = lotBuilding(i0, endLot.j0, i1, endLot.j1, endLot.j0 === j0 ? 0 : 2, true, backdrop, r);
      addBuilding(b);
    }
    if (hasAlley) {
      for (let i = am; i < am + 3; i++)
        for (let j = j0; j < j1; j++) {
          if (endLot && j >= endLot.j0 && j < endLot.j1) continue;
          if (i >= 0 && j >= 0 && i < cells && j < cells) kind[idx(i, j)] = K_ALLEY;
          // dumpsters against the walls, now and then
          if (!backdrop && i === am && (j - j0) % 9 === 4 && r() < 0.5) props.push({ x: cc(i), z: cc(j), rot: 0, k: "dumpster" });
        }
    }
    for (const [h0, h1, face] of halves) {
      let j = endLot && endLot.j0 === j0 ? endLot.j1 : j0;
      const jEnd = endLot && endLot.j1 === j1 ? endLot.j0 : j1;
      while (j < jEnd) {
        const vv = value(W((h0 + h1) / 2), W(j));
        const maxW = vv > 0.5 ? 26 : 18;
        let w = 4 + Math.floor(r() * (maxW - 3));
        if (jEnd - (j + w) < 5) w = jEnd - j;
        const corner = j === j0 || j + w === j1;
        const front: Bld["front"] = corner && r() < 0.5 ? (j === j0 ? 0 : 2) : face;
        addBuilding(lotBuilding(h0, j, h1, j + w, front, corner, backdrop, r));
        j += w;
      }
    }
  };
  const addBuilding = (b: Bld) => {
    buildings.push(b);
    if (b.backdrop) return;
    if (b.t === "parking" || b.t === "empty") {
      const [a0, b0, a1, b1] = [Math.round((b.x0 + half) / 2), Math.round((b.z0 + half) / 2), Math.round((b.x1 + half) / 2), Math.round((b.z1 + half) / 2)];
      for (let i = a0; i < a1; i++) for (let j = b0; j < b1; j++) if (i >= 0 && j >= 0 && i < cells && j < cells) kind[idx(i, j)] = K_OPEN;
      if (b.t === "parking") {
        // rows of parked cars with drive aisles
        for (let i = a0 + 1; i < a1 - 1; i += 4) {
          for (let j = b0 + 1; j + 2 < b1; j += 3) {
            if (rand() < 0.35) continue;
            const v2 = makeVehicle(rand, 5.2);
            if (!v2) continue;
            parked.push({ x: cc(i), z: cc(j) + 1, rot: rand() < 0.5 ? 0 : Math.PI, v: v2 });
            markSolid(i, j, i + 1, j + 2, vehicleHeight(v2));
          }
        }
      }
      return;
    }
    for (const p of b.parts) {
      if (p.role === "canopy" || p.y0 > 0) continue;
      const [a0, b0, a1, b1] = partCells(p);
      markSolid(a0, b0, a1, b1, p.h);
    }
    // any lot ground the massing leaves free (courtyards, forecourts) is open paving;
    // the reachability pass below seals the parts nobody can get to
    {
      const [l0, m0, l1, m1] = [Math.round((b.x0 + half) / 2), Math.round((b.z0 + half) / 2), Math.round((b.x1 + half) / 2), Math.round((b.z1 + half) / 2)];
      for (let i = l0; i < l1; i++) for (let j = m0; j < m1; j++) if (i >= 0 && j >= 0 && i < cells && j < cells && !solid[idx(i, j)]) kind[idx(i, j)] = K_OPEN;
    }
    if (b.t === "gas") {
      const [a0, b0, a1, b1] = partCells(b.parts[1]!);
      // canopy columns + pump islands
      markSolid(a0 + 1, b0 + 1, a0 + 2, b0 + 2, 5);
      markSolid(a1 - 2, b0 + 1, a1 - 1, b0 + 2, 5);
      markSolid(a0 + 3, Math.floor((b0 + b1) / 2), a1 - 3, Math.floor((b0 + b1) / 2) + 1, 1.2);
      const [l0, m0, l1, m1] = [Math.round((b.x0 + half) / 2), Math.round((b.z0 + half) / 2), Math.round((b.x1 + half) / 2), Math.round((b.z1 + half) / 2)];
      for (let i = l0; i < l1; i++) for (let j = m0; j < m1; j++) if (!solid[idx(i, j)]) kind[idx(i, j)] = K_OPEN;
    }
    if (b.t === "construction") {
      // hoarding around the site with a gate on the street side, frame in the middle
      const [l0, m0, l1, m1] = [Math.round((b.x0 + half) / 2), Math.round((b.z0 + half) / 2), Math.round((b.x1 + half) / 2), Math.round((b.z1 + half) / 2)];
      for (let i = l0; i < l1; i++)
        for (let j = m0; j < m1; j++) {
          if (!solid[idx(i, j)]) kind[idx(i, j)] = K_OPEN;
          const edge = i === l0 || j === m0 || i === l1 - 1 || j === m1 - 1;
          const gate = Math.abs(i - (l0 + l1) / 2) < 2.5 && (j === m1 - 1 || j === m0);
          if (edge && !gate) markSolid(i, j, i + 1, j + 1, 2.4);
        }
    }
    if (b.t === "diner" || b.t === "church" || b.t === "civic") {
      const [l0, m0, l1, m1] = [Math.round((b.x0 + half) / 2), Math.round((b.z0 + half) / 2), Math.round((b.x1 + half) / 2), Math.round((b.z1 + half) / 2)];
      for (let i = l0; i < l1; i++) for (let j = m0; j < m1; j++) if (!solid[idx(i, j)]) kind[idx(i, j)] = K_OPEN;
    }
  };
  const parked: ParkedCar[] = [];
  for (const q of blocks) blockBuild(q, !(inArena(q.a) && inArena(q.b)) || q.a.a < 0 || q.b.a < 0 || q.a.b > cells || q.b.b > cells);
  // backdrop blocks that straddle the arena edge are handled as arena blocks above; drop
  // backdrop buildings over the water
  for (let k = buildings.length - 1; k >= 0; k--) if (buildings[k]!.backdrop && buildings[k]!.z1 > waterZ) buildings.splice(k, 1);
  // clip arena buildings that poke outside the arena (blocks at the edge)
  for (const b of buildings) {
    if (b.backdrop) continue;
    b.x0 = Math.max(b.x0, -half);
    b.z0 = Math.max(b.z0, -half);
    b.x1 = Math.min(b.x1, half);
    b.z1 = Math.min(b.z1, half);
  }

  // ---- the park: lawn, paths, trees, a fountain ----
  let park: CityLayout["park"] = null;
  if (parkBlock) {
    const [i0, i1, j0, j1] = [parkBlock.a.a, parkBlock.a.b, parkBlock.b.a, parkBlock.b.b];
    park = { x0: W(i0), z0: W(j0), x1: W(i1), z1: W(j1) };
    for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) kind[idx(i, j)] = K_PARK;
    const pcx = Math.floor((i0 + i1) / 2);
    const pcz = Math.floor((j0 + j1) / 2);
    markSolid(pcx - 2, pcz - 2, pcx + 2, pcz + 2, 1.2); // fountain basin
    for (let i = i0 + 2; i < i1 - 2; i += 3)
      for (let j = j0 + 2; j < j1 - 2; j += 3) {
        const onPath = Math.abs(i - pcx) < 3 || Math.abs(j - pcz) < 3 || Math.abs(i - pcx - (j - pcz)) < 2;
        if (onPath || Math.abs(i - pcx) < 5 && Math.abs(j - pcz) < 5) continue;
        if (rand() < 0.45) props.push({ x: cc(i) + rand() - 0.5, z: cc(j) + rand() - 0.5, rot: rand() * 6.28, k: "tree", s: 0.8 + rand() * 0.6 });
      }
    for (const [dx, dz] of [[6, 0], [-6, 0], [0, 6], [0, -6]] as const)
      props.push({ x: cc(pcx) + dx * 2, z: cc(pcz) + dz * 2, rot: Math.atan2(-dx, -dz), k: "bench" });
  }

  // ---- street furniture along the kerbs, parked cars in the parking lanes ----
  const isK = (i: number, j: number, k: number) => i >= 0 && j >= 0 && i < cells && j < cells && kind[idx(i, j)] === k;
  const streetX = axX.map((b) => b?.kind === "street");
  const streetZ = axZ.map((b) => b?.kind === "street");
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
        // which way does the lane run?
        const alongZ = isK(i, j - 1, K_PARKLANE) || isK(i, j + 1, K_PARKLANE);
        const t = alongZ ? j : i;
        if (nearIntersection(i, j) || solid[idx(i, j)]) continue;
        if (t % 3 === 0) {
          const run = alongZ ? [idx(i, j), idx(i, j + 1)] : [idx(i, j), idx(i + 1, j)];
          const ok = run.every((c) => kind[c] === K_PARKLANE && !solid[c]);
          if (ok && rand() < 0.62) {
            const v2 = makeVehicle(rand, 4.7);
            if (v2) {
              const x = alongZ ? cc(i) : cc(i) + 1;
              const z = alongZ ? cc(j) + 1 : cc(j);
              parked.push({ x, z, rot: (alongZ ? 0 : Math.PI / 2) + (rand() < 0.5 ? Math.PI : 0), v: v2 });
              for (const c of run) {
                const ci = Math.floor(c / cells);
                const cj = c % cells;
                markSolid(ci, cj, ci + 1, cj + 1, vehicleHeight(v2));
              }
            }
          } else if (t % 6 === 0 && rand() < 0.4) {
            // parking meter on the kerb next to an empty bay
            const dx = isK(i + 1, j, K_WALK) ? 0.8 : isK(i - 1, j, K_WALK) ? -0.8 : 0;
            const dz = isK(i, j + 1, K_WALK) ? 0.8 : isK(i, j - 1, K_WALK) ? -0.8 : 0;
            props.push({ x: cc(i) + dx * 1.4, z: cc(j) + dz * 1.4, rot: 0, k: "meter" });
          }
        }
        continue;
      }
      if (k === K_ROAD && (i * 7 + j * 13) % 97 === 0) props.push({ x: cc(i), z: cc(j), rot: 0, k: "manhole" });
      if (k !== K_WALK) continue;
      // kerb-side sidewalk cells: next to a parking lane
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
      const kerb = dirs.find(([di, dj]) => isK(i + di, j + dj, K_PARKLANE) || isK(i + di, j + dj, K_ROAD));
      if (!kerb) continue;
      const [di, dj] = kerb;
      const rot = Math.atan2(di, dj);
      const along = di === 0 ? i : j;
      const cls = streetClassAt(i, j);
      const x = cc(i) + di * 0.7;
      const z = cc(j) + dj * 0.7;
      if (nearIntersection(i, j)) {
        if ((i + j) % 5 === 0) props.push({ x: cc(i) - di * 0.6, z: cc(j) - dj * 0.6, rot, k: "news" });
        if ((i * 3 + j) % 11 === 0) props.push({ x: cc(i) + di * 0.9, z: cc(j) + dj * 0.9, rot, k: "drain" });
        continue;
      }
      if (along % 12 === 0) props.push({ x, z, rot, k: cls === "side" ? "light" : "lightLED" });
      else if (along % 6 === 3 && cls !== "side") props.push({ x, z, rot, k: "tree", s: 0.9 + rand() * 0.3 });
      else if (along % 9 === 5 && cls === "side" && rand() < 0.5) props.push({ x, z, rot, k: "tree", s: 0.8 + rand() * 0.3 });
      else if (along % 40 === 20 && cls !== "side") props.push({ x: cc(i), z: cc(j), rot: rot + Math.PI, k: "busstop" });
      else if (along % 17 === 8 && rand() < 0.4) props.push({ x, z, rot, k: "hydrant" });
      else if (along % 13 === 7 && rand() < 0.25) props.push({ x: cc(i) - di * 0.5, z: cc(j) - dj * 0.5, rot: rot + Math.PI, k: "bench" });
      else if (along % 23 === 11 && rand() < 0.4) props.push({ x, z, rot, k: "trash" });
    }
  }
  // palms down the boulevard median and along the boardwalk
  for (let i = 1; i < cells - 1; i++)
    for (let j = 1; j < cells - 1; j++) {
      const k = kind[idx(i, j)]!;
      if (k === K_MEDIAN && (j % 6 === 0) && isK(i + 1, j, K_MEDIAN) && !nearIntersection(i, j)) props.push({ x: cc(i) + 1, z: cc(j), rot: rand() * 6.28, k: "palm", s: 9 + rand() * 5 });
      if (k === K_BOARD) {
        const nextRow = !isK(i, j + 1, K_BOARD);
        if (nextRow && i % 2 === 0) props.push({ x: cc(i), z: cc(j) + 0.8, rot: 0, k: "railing" });
        if (j === cells - 4 && i % 7 === 0) props.push({ x: cc(i), z: cc(j), rot: rand() * 6.28, k: "palm", s: 8 + rand() * 6 });
        if (j === cells - 7 && i % 11 === 5) props.push({ x: cc(i), z: cc(j), rot: Math.PI, k: "bench" });
        if (j === cells - 7 && i % 22 === 16) props.push({ x: cc(i), z: cc(j), rot: 0, k: "lightLED" });
      }
    }
  // subway entrances on the busiest corners near the spawn
  const subwaySpots = [
    [spawn.x - 16, spawn.z - 13],
    [spawn.x + 20, spawn.z + 30],
    [spawn.x - 120, spawn.z - 13],
  ];
  for (const [x, z] of subwaySpots) {
    const i = Math.floor((x! + half) / 2);
    const j = Math.floor((z! + half) / 2);
    if (isK(i, j, K_WALK) && isK(i + 1, j, K_WALK)) {
      props.push({ x: cc(i) + 1, z: cc(j), rot: 0, k: "subway" });
      markSolid(i, j, i + 2, j + 1, 1.1);
    }
  }
  // traffic signals: one mast per corner of every intersection on the network
  for (const rx of roadX)
    for (const rz of roadZ) {
      const cxh = CURB[rx.cls];
      const czh = CURB[rz.cls];
      const corners: [number, number, number][] = [
        [-1, 1, Math.PI],
        [1, -1, 0],
        [-1, -1, Math.PI / 2],
        [1, 1, -Math.PI / 2],
      ];
      for (const [sx, sz, rot] of corners) props.push({ x: rx.c + sx * (cxh + 1.2), z: rz.c + sz * (czh + 1.2), rot, k: "signal", c: (sx === -1 && sz === 1) || (sx === 1 && sz === -1) ? CURB[rz.cls] : CURB[rx.cls] });
    }

  // ---- connectivity: anything walkable that can't be reached from the spawn becomes solid ----
  const ring = (i: number, j: number) => i === 0 || j === 0 || i === cells - 1 || j === cells - 1;
  const si = Math.floor((spawn.x + half) / 2);
  const sj = Math.floor((spawn.z + half) / 2);
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
      markSolid(i, j, i + 1, j + 1, kind[c] === K_LOT ? 3 : 1);
      if (kind[c] !== K_LOT) sealed++;
    }

  const layout: CityLayout = {
    cells,
    half,
    kind,
    roadX,
    roadZ,
    bandsX: bx.map((b) => ({ a: b.a, b: b.b, kind: b.kind, ...(b.cls ? { cls: b.cls } : {}) })),
    bandsZ: bz.map((b) => ({ a: b.a, b: b.b, kind: b.kind, ...(b.cls ? { cls: b.cls } : {}) })),
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
