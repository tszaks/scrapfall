// Turns the pure city layout into merged geometry, one set of meshes per 150 m chunk:
//   main   - building massing, crowns, rooftops, ground (always drawn; casts shadows)
//   detail - street furniture, parked cars, balconies, fire escapes, awnings, markings
//            (only drawn near the player: the LOD step)
//   glow   - unlit bulbs, neon, crown lights
//   signs  - shop signs and billboards (sign atlas)
//   pools  - fake light pools on the ground at night
import * as THREE from "three";

import {
  CURB,
  K_ALLEY,
  K_BOARD,
  K_LOT,
  K_MEDIAN,
  K_OPEN,
  K_PARK,
  K_PARKLANE,
  K_PATH,
  K_ROAD,
  K_WALK,
  LANES,
  type Bld,
  type CityLayout,
  type Crown,
  type Part,
  type Prop,
  type Road,
} from "./cityLayout";
import {
  Geo,
  L,
  facadeUV,
  insetPoly,
  rectPoly,
  scalePoly,
  sideOf,
  type P2,
  type Tmpl,
} from "./cityGeo";
import { MODULE_W, SIGN_WORDS, W_DINER, W_GAS, W_HOTEL, adUV, wordUV } from "./cityTextures";
import { vehicleParts, type Vehicle } from "./vehicles";

export const CHUNK = 150;
/** the skyline filler outside the arena merges into much bigger chunks (massing only) */
export const FAR_CHUNK = 480;
/** detail layers (props, cars, markings) are drawn within this distance of the camera */
export const DETAIL_RANGE = 330;

type ChunkGeo = {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  main: Geo;
  detail: Geo;
  glow: Geo;
  signs: Geo;
  pools: Geo;
};
export type ChunkMesh = {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  main: THREE.BufferGeometry | null;
  detail: THREE.BufferGeometry | null;
  glow: THREE.BufferGeometry | null;
  signs: THREE.BufferGeometry | null;
  pools: THREE.BufferGeometry | null;
};
export type Lamp = {
  x: number;
  y: number;
  z: number;
  rot: number;
  node: number;
  axis: 0 | 1;
  which: 0 | 1 | 2;
};
export type CityMeshes = {
  chunks: ChunkMesh[];
  beacons: [number, number, number][];
  lamps: Lamp[];
  /** awning front edges (x0, z0, x1, z1) at the valance bottom (2.85 m): rain drips off them */
  drips: [number, number, number, number][];
  stats: { verts: number; buildings: number };
};

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(a: readonly T[], r: () => number) => a[Math.floor(r() * a.length) % a.length]!;

// ---------------------------------------------------------------------------------------
// palettes (sRGB)
const GLASS_T = [
  "#7fa2c8",
  "#86b3a6",
  "#b89a72",
  "#b8c4cc",
  "#79b4bf",
  "#5f83b0",
  "#9fb2a8",
  "#c9b48a",
  "#8fa8b8",
];
const RIBBON_T = ["#e8e4dc", "#d8dcdf", "#cfc9bc", "#f0ede6", "#b9bfc4"];
const CONC_T = [
  "#dcd6c8",
  "#c8c2b4",
  "#e6e0d2",
  "#b4b0a6",
  "#d2c6b0",
  "#a9adb0",
  "#cdbd9e",
  "#e2dccf",
];
const RESID_T = ["#f2ece0", "#e8dcc8", "#f4efe6", "#e2d6c2", "#d9cfc0", "#efe6d8", "#e6e2da"];
const BRICK_T = [
  "#a4543c",
  "#8e5a44",
  "#b8704a",
  "#7a4032",
  "#c08a6a",
  "#9a6a50",
  "#6e3a2c",
  "#b06048",
];
const PASTEL_T = [
  "#f4b8c4",
  "#a9e2cf",
  "#f9e2a8",
  "#a9d4ee",
  "#f7c7a0",
  "#dcc6f0",
  "#fbf6ee",
  "#f2d0a0",
  "#bfe3f0",
];
const STONE_T = ["#e0d6c0", "#cfc3a6", "#e8e0cc", "#c8b89a", "#d8ccb4"];
const STEEL_T = ["#8a8580", "#6a7078", "#7a7470", "#8c8478"];
const ROOF_T = ["#6f6d68", "#4f4f51", "#8a8780", "#5c5a55", "#9a978f", "#7a7870"];
const AWNING = [
  "#c8403a",
  "#2e7a5a",
  "#2a5aa8",
  "#e0a02a",
  "#f0f0ea",
  "#e65a9a",
  "#1f2f4a",
  "#8a3a6a",
];
const NEON = ["#ff4fa0", "#3affd8", "#ffe14a", "#9a6aff", "#ff7a3a", "#4fd0ff"];
const TREE_T = ["#4f7a34", "#5a8a3a", "#3f6a2c", "#6a9044", "#48763a", "#5f7f30"];

const _tint = new THREE.Color();
const hex = (c: string, k = 1) => _tint.set(c).multiplyScalar(k).getHex();

type Style = {
  layer: number;
  tint: number;
  fh: number;
  uOff: number;
  vOff: number;
  seed: number;
  store: boolean;
  balcony: boolean;
  fire: boolean;
  roof: string;
  neon: string;
  r: () => number;
};

function styleOf(b: Bld): Style {
  const r = mulberry(b.seed ^ 0x9e3779b9);
  const k = 0.9 + r() * 0.16; // weathering / per-building brightness
  let layer: number = L.office;
  let tint = "#ffffff";
  const tall = b.h > 60;
  switch (b.mat) {
    case "glass": {
      const q = r();
      layer = q < 0.6 ? L.glass : q < 0.85 ? L.ribbon : L.dark;
      tint =
        layer === L.ribbon
          ? pick(RIBBON_T, r)
          : layer === L.dark
            ? pick(STEEL_T, r)
            : pick(GLASS_T, r);
      break;
    }
    case "office": {
      const q = r();
      layer = q < 0.55 ? L.office : q < 0.82 ? L.ribbon : L.panel;
      tint = pick(CONC_T, r);
      break;
    }
    case "resid":
      layer = L.resid;
      tint = pick(RESID_T, r);
      break;
    case "brick":
      layer = L.brick;
      tint = pick(BRICK_T, r);
      break;
    case "stucco":
      layer = tall && r() < 0.4 ? L.deco : L.resid;
      tint = pick(PASTEL_T, r);
      break;
    case "stone":
      layer = tall ? L.deco : L.stone;
      tint = pick(STONE_T, r);
      break;
    case "steel":
      layer = L.dark;
      tint = pick(STEEL_T, r);
      break;
    case "concrete":
      layer =
        b.t === "garage"
          ? L.garage
          : b.t === "warehouse" || b.t === "bigbox"
            ? L.warehouse
            : r() < 0.5
              ? L.panel
              : L.office;
      tint = pick(CONC_T, r);
      break;
  }
  const storeTypes = new Set([
    "low",
    "corner",
    "mid",
    "court",
    "slab",
    "terrace",
    "mall",
    "tower",
    "hotel",
    "twin",
    "pencil",
  ]);
  return {
    layer,
    tint: hex(tint, k),
    fh: b.fh,
    uOff: Math.floor(r() * 8),
    vOff: Math.floor(r() * 16),
    seed: r(),
    store: storeTypes.has(b.t) && (b.t === "low" || b.t === "corner" || r() < 0.75),
    balcony: (b.mat === "resid" || b.mat === "stucco") && r() < 0.75,
    fire: b.mat === "brick" && b.h < 40 && r() < 0.65,
    roof: pick(ROOF_T, r),
    neon: pick(NEON, r),
    r,
  };
}

// ---------------------------------------------------------------------------------------
// outlines

function bbox(poly: P2[]) {
  let x0 = Infinity,
    z0 = Infinity,
    x1 = -Infinity,
    z1 = -Infinity;
  for (const [x, z] of poly) {
    x0 = Math.min(x0, x);
    z0 = Math.min(z0, z);
    x1 = Math.max(x1, x);
    z1 = Math.max(z1, z);
  }
  return { x0, z0, x1, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0 };
}

function outline(p: Part): P2[] {
  const { x0, z0, x1, z1 } = p;
  const w = x1 - x0;
  const d = z1 - z0;
  const ms = Math.min(w, d);
  switch (p.shape) {
    case "cyl": {
      const seg = 24;
      const out: P2[] = [];
      for (let i = 0; i < seg; i++) {
        const t = (i / seg) * Math.PI * 2;
        out.push([(x0 + x1) / 2 + (Math.cos(t) * w) / 2, (z0 + z1) / 2 + (Math.sin(t) * d) / 2]);
      }
      return out;
    }
    case "oct": {
      const c = ms * 0.24;
      return [
        [x0 + c, z0],
        [x1 - c, z0],
        [x1, z0 + c],
        [x1, z1 - c],
        [x1 - c, z1],
        [x0 + c, z1],
        [x0, z1 - c],
        [x0, z0 + c],
      ];
    }
    case "chamfer": {
      const c = Math.min(10, ms * 0.3);
      const k = p.cham ?? 0;
      const corners = rectPoly(x0, z0, x1, z1);
      const out: P2[] = [];
      for (let i = 0; i < 4; i++) {
        const cn = corners[i]!;
        if (i !== k) {
          out.push(cn);
          continue;
        }
        const pv = corners[(i + 3) % 4]!;
        const nx = corners[(i + 1) % 4]!;
        const toward = (o: P2): P2 => {
          const dx = o[0] - cn[0];
          const dz = o[1] - cn[1];
          const l = Math.hypot(dx, dz) || 1;
          return [cn[0] + (dx / l) * c, cn[1] + (dz / l) * c];
        };
        out.push(toward(pv), toward(nx));
      }
      return out;
    }
    default:
      return rectPoly(x0, z0, x1, z1);
  }
}

// ---------------------------------------------------------------------------------------
// building pieces

type Ctx = {
  main: Geo;
  detail: Geo;
  glow: Geo;
  signs: Geo;
  beacons: [number, number, number][];
  drips: [number, number, number, number][];
  /** a night light pool over a rectangle (gas station canopy) */
  pools: (p: { x0: number; z0: number; x1: number; z1: number }) => void;
};

/** triangle wound so that it faces (nx, nz) */
function triFacing(
  G: Geo,
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
  nx: number,
  nz: number,
) {
  const ux = b[0] - a[0],
    uy = b[1] - a[1],
    uz = b[2] - a[2];
  const wx = c[0] - a[0],
    wy = c[1] - a[1],
    wz = c[2] - a[2];
  const cx = uy * wz - uz * wy;
  const cz = ux * wy - uy * wx;
  if (cx * nx + cz * nz >= 0) G.tri(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  else G.tri(b[0], b[1], b[2], a[0], a[1], a[2], c[0], c[1], c[2]);
}

const isStreetEdge = (p: P2, q: P2, mask: number) => {
  const s = sideOf(p, q);
  return s >= 0 ? ((mask >> s) & 1) === 1 : mask !== 0;
};

/** a building part's volume, when it is a plain box (its outline is its bounding rectangle) */
type Vol = { x0: number; z0: number; x1: number; z1: number; y0: number; y1: number } | null;
const volsOf = (b: Bld): Vol[] =>
  b.parts.map((p) =>
    (p.shape ?? "box") === "box" && p.role !== "bridge"
      ? { x0: p.x0, z0: p.z0, x1: p.x1, z1: p.z1, y0: p.y0, y1: p.y0 + p.h }
      : null,
  );

/** is (x, y, z) inside one of the building's other parts (strictly, so their faces don't count) */
function inSibling(vols: Vol[], self: number, x: number, y: number, z: number, e = 0.02) {
  return vols.some(
    (v, j) =>
      j !== self &&
      v !== null &&
      x > v.x0 + e &&
      x < v.x1 - e &&
      z > v.z0 + e &&
      z < v.z1 - e &&
      y > v.y0 + e &&
      y < v.y1 - e,
  );
}

/** stretches [t0, t1] (metres from p) of the edge p -> q that no other part of the building
 * buries or covers anywhere between ya and yb (a roof parapet under a flush upper storey) */
function openSpans(vols: Vol[], self: number, p: P2, q: P2, ya: number, yb: number) {
  const fw = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const alongX = Math.abs(q[1] - p[1]) < 1e-6;
  const alongZ = Math.abs(q[0] - p[0]) < 1e-6;
  let spans: [number, number][] = [[0, fw]];
  if (!alongX && !alongZ) return spans;
  const e = 1e-3;
  vols.forEach((v, j) => {
    if (j === self || !v || v.y0 > ya + e || v.y1 < yb - e) return;
    // the edge line must lie within (or on the boundary of) the other part's footprint
    const [c, lo, hi, a0, a1] = alongX
      ? [p[1], v.z0, v.z1, v.x0, v.x1]
      : [p[0], v.x0, v.x1, v.z0, v.z1];
    if (c < lo - e || c > hi + e) return;
    const s0 = alongX ? p[0] : p[1];
    const dir = Math.sign(alongX ? q[0] - p[0] : q[1] - p[1]);
    const ta = (a0 - s0) * dir;
    const tb = (a1 - s0) * dir;
    const c0 = Math.min(ta, tb);
    const c1 = Math.max(ta, tb);
    const next: [number, number][] = [];
    for (const [s, t] of spans) {
      if (c1 <= s || c0 >= t) next.push([s, t]);
      else {
        if (c0 > s) next.push([s, c0]);
        if (c1 < t) next.push([c1, t]);
      }
    }
    spans = next;
  });
  return spans.filter(([s, t]) => t - s > 0.05);
}

/** facade walls of an outline between y0 and y1 (optionally a storefront band at street level) */
function walls(
  G: Geo,
  poly: P2[],
  y0: number,
  y1: number,
  st: Style,
  mask: number,
  store: boolean,
  layer = st.layer,
  tint = st.tint,
  fh = st.fh,
  cut?: DoorCut,
) {
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const fw = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (fw < 0.05) continue;
    if (store && y0 < 0.1 && y1 > 6 && fw > 3 && isStreetEdge(p, q, mask)) {
      G.mat(L.store, st.seed, 1).col(hex("#f4f2ee"));
      cutWall(G, p, q, 0, 4.5, facadeUV(L.store, fw, 0, 4.5, 4.5, st.uOff, 0), cut);
      G.mat(layer, st.seed, 1).col(tint);
      const mods = Math.max(1, Math.round(fw / (MODULE_W[layer] ?? 3)));
      cutWall(G, p, q, 4.5, y1, [st.uOff, st.vOff, st.uOff + mods, st.vOff + (y1 - 4.5) / fh], cut);
    } else {
      G.mat(layer, st.seed, 1).col(tint);
      cutWall(G, p, q, y0, y1, facadeUV(layer, fw, y0, y1, fh, st.uOff, st.vOff), cut);
    }
  }
}

/** a building-access doorway to leave open in a facade (access/cityAccess.ts) */
type DoorCut = { x: number; z: number; facing: number; w: number; h: number };
/**
 * G.wall(p, q, ...) with a rectangular doorway left open where `cut` sits on this edge. The
 * pieces keep the whole wall's texture mapping (u runs q -> p across the full edge), so the
 * facade pattern doesn't shift around the opening.
 */
function cutWall(G: Geo, p: P2, q: P2, y0: number, y1: number, uv: readonly number[], cut?: DoorCut) {
  if (!cut || cut.h <= y0 || sideOf(p, q) !== cut.facing) return G.wall(p, q, y0, y1, uv);
  const fw = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const ux = (q[0] - p[0]) / fw;
  const uz = (q[1] - p[1]) / fw;
  // the doorway centre must lie on this edge
  const off = Math.abs((cut.x - p[0]) * uz - (cut.z - p[1]) * ux);
  const t = (cut.x - p[0]) * ux + (cut.z - p[1]) * uz;
  if (off > 0.05 || t - cut.w / 2 < 0.01 || t + cut.w / 2 > fw - 0.01) return G.wall(p, q, y0, y1, uv);
  const [u0, v0, u1, v1] = uv as [number, number, number, number];
  const U = (s: number) => u1 + (u0 - u1) * (s / fw); // u at distance s from p
  const V = (y: number) => v0 + ((v1 - v0) * (y - y0)) / (y1 - y0);
  const at = (s: number): P2 => [p[0] + ux * s, p[1] + uz * s];
  const s0 = t - cut.w / 2;
  const s1 = t + cut.w / 2;
  G.wall(p, at(s0), y0, y1, [U(s0), v0, U(0), v1]);
  G.wall(at(s1), q, y0, y1, [U(fw), v0, U(s1), v1]);
  if (cut.h < y1) G.wall(at(s0), at(s1), cut.h, y1, [U(s1), V(cut.h), U(s0), v1]);
}

/** sloped facade between two outlines (tapering towers) */
function slopedWalls(
  G: Geo,
  lo: P2[],
  hi: P2[],
  y0: number,
  y1: number,
  st: Style,
  layer = st.layer,
) {
  G.mat(layer, st.seed, 1).col(st.tint);
  for (let i = 0; i < lo.length; i++) {
    const j = (i + 1) % lo.length;
    const p = lo[i]!,
      q = lo[j]!,
      pt = hi[i]!,
      qt = hi[j]!;
    const fw = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const uv = facadeUV(layer, fw, y0, y1, st.fh, st.uOff, st.vOff);
    G.quad(q[0], y0, q[1], p[0], y0, p[1], pt[0], y1, pt[1], qt[0], y1, qt[1], uv);
  }
}

/** flat ring between an outer and an inner outline, facing up */
function ring(G: Geo, outer: P2[], inner: P2[], y: number) {
  for (let i = 0; i < outer.length; i++) {
    const j = (i + 1) % outer.length;
    const a = inner[i]!,
      b = inner[j]!,
      c = outer[j]!,
      d = outer[i]!;
    G.quad(a[0], y, a[1], b[0], y, b[1], c[0], y, c[1], d[0], y, d[1]);
  }
}

/** roof: parapet wall + cap; returns the inner outline */
function roof(
  G: Geo,
  poly: P2[],
  y: number,
  st: Style,
  para = 1.0,
  rim = 0.35,
  roofCol = st.roof,
  open?: (p: P2, q: P2, ya: number, yb: number) => [number, number][],
  hole?: { x0: number; z0: number; x1: number; z1: number },
) {
  const inner = insetPoly(poly, rim);
  G.mat(L.plain, st.seed, 1).col(st.tint, 0.9);
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    if (!open) {
      G.wall(p, q, y, y + para);
      continue;
    }
    // skip the stretches where a flush upper part stands on this edge: the parapet would
    // sit in the plane of that part's facade and z-fight with it
    const fw = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    const ux = (q[0] - p[0]) / fw;
    const uz = (q[1] - p[1]) / fw;
    for (const [t0, t1] of open(p, q, y, y + para))
      G.wall([p[0] + ux * t0, p[1] + uz * t0], [p[0] + ux * t1, p[1] + uz * t1], y, y + para);
  }
  G.col(st.tint, 0.72);
  for (let i = 0; i < inner.length; i++)
    G.wall(inner[(i + 1) % inner.length]!, inner[i]!, y, y + para);
  G.col(st.tint, 0.95);
  ring(G, poly, inner, y + para);
  G.mat(L.plain, st.seed, 0).col(roofCol);
  if (hole) {
    // an access building's shaft / stairwell comes up through the roof: cap round it
    const b = bbox(inner);
    const hx0 = Math.max(b.x0, hole.x0);
    const hx1 = Math.min(b.x1, hole.x1);
    const hz0 = Math.max(b.z0, hole.z0);
    const hz1 = Math.min(b.z1, hole.z1);
    if (hz0 > b.z0) G.flat(b.x0, b.z0, b.x1, hz0, y + 0.02);
    if (hz1 < b.z1) G.flat(b.x0, hz1, b.x1, b.z1, y + 0.02);
    if (hx0 > b.x0) G.flat(b.x0, hz0, hx0, hz1, y + 0.02);
    if (hx1 < b.x1) G.flat(hx1, hz0, b.x1, hz1, y + 0.02);
  } else G.cap(inner, y + 0.02);
  return inner;
}

/** mechanical boxes, AC units, sometimes a dish or a water tower */
function rooftop(G: Geo, inner: P2[], y: number, st: Style, amount: number, waterTower = false) {
  const bb = bbox(inner);
  if (bb.w < 4 || bb.d < 4) return;
  const r = st.r;
  G.mat(L.plain, st.seed, 0);
  const n = Math.min(6, Math.round(amount * (1 + r() * 2)));
  for (let k = 0; k < n; k++) {
    const w = Math.min(bb.w * 0.4, 1.5 + r() * 5);
    const d = Math.min(bb.d * 0.4, 1.5 + r() * 4);
    const x = bb.cx + (r() - 0.5) * (bb.w * 0.55 - w);
    const z = bb.cz + (r() - 0.5) * (bb.d * 0.55 - d);
    G.col(r() < 0.5 ? "#c9cccf" : "#a9adb1");
    G.box(x, y, z, w, 0.9 + r() * 2.2, d);
    if (r() < 0.5) {
      G.col("#6a6e72");
      G.cyl(x, y + 1, z, 0.35, 0.8 + r(), 6);
    }
  }
  if (r() < 0.25) {
    // satellite dish on a stub
    const x = bb.x0 + 1.2 + r() * (bb.w - 2.4);
    const z = bb.z0 + 1.2 + r() * (bb.d - 2.4);
    G.col("#d8dadc");
    G.cyl(x, y, z, 0.08, 1.1, 5);
    G.cyl(x, y + 1.1, z, 0.9, 0.18, 10, true, 0.4);
  }
  if (waterTower && bb.w > 7 && bb.d > 7) {
    const x = bb.x0 + 3 + r() * (bb.w - 6);
    const z = bb.z0 + 3 + r() * (bb.d - 6);
    G.col("#3a3430");
    for (const [dx, dz] of [
      [1.1, 1.1],
      [1.1, -1.1],
      [-1.1, 1.1],
      [-1.1, -1.1],
    ] as const)
      G.box(x + dx, y, z + dz, 0.18, 3, 0.18);
    G.col("#7a5a3a");
    G.cyl(x, y + 3, z, 1.8, 3.6, 10);
    G.col("#5a4030");
    G.cone(x, y + 6.6, z, 1.95, 1.4, 10, 0);
  }
}

function beacon(C: Ctx, x: number, y: number, z: number) {
  C.beacons.push([x, y, z]);
}

/** crowns: what sits on top of the highest part */
function crown(C: Ctx, poly: P2[], y: number, st: Style, b: Bld, kind: Crown) {
  const G = C.main;
  const bb = bbox(poly);
  const ms = Math.min(bb.w, bb.d);
  const r = st.r;
  switch (kind) {
    case "flat": {
      const inner = roof(G, poly, y, st);
      rooftop(
        G,
        inner,
        y,
        st,
        2,
        b.h < 45 && (b.mat === "brick" || b.mat === "resid") && r() < 0.4,
      );
      if (b.h > 90 && r() < 0.6) {
        G.mat(L.plain, st.seed, 0).col("#b0b4b8");
        const ah = 8 + r() * 18;
        G.cyl(bb.cx + bb.w * 0.15, y, bb.cz, 0.25, ah, 5);
        beacon(C, bb.cx + bb.w * 0.15, y + ah + 0.3, bb.cz);
      } else if (b.h > 90) beacon(C, bb.cx, y + 1.4, bb.cz);
      break;
    }
    case "mech": {
      const inner = roof(G, poly, y, st);
      const ph = insetPoly(inner, Math.min(ms * 0.2, 6));
      walls(G, ph, y, y + st.fh * 1.6, st, 0, false, L.panel, hex("#c9c7c0"), st.fh);
      G.mat(L.plain, st.seed, 0).col("#8a8882");
      G.cap(ph, y + st.fh * 1.6);
      rooftop(G, ph, y + st.fh * 1.6, st, 1);
      if (b.h > 90) beacon(C, bb.cx, y + st.fh * 1.6 + 1.5, bb.cz);
      break;
    }
    case "spire": {
      roof(G, poly, y, st);
      let top = y;
      if (b.h > 60) {
        const cap = insetPoly(poly, ms * 0.22);
        walls(G, cap, y, y + st.fh * 2, st, 0, false);
        G.mat(L.plain, st.seed, 0).col(st.tint, 0.85);
        G.cap(cap, y + st.fh * 2);
        top = y + st.fh * 2;
      }
      const sh = Math.min(b.t === "super" ? 70 : 55, Math.max(8, b.h * 0.16));
      G.mat(L.plain, st.seed, 0).col("#d8dde2");
      G.cone(bb.cx, top, bb.cz, Math.max(0.8, ms * 0.1), sh, 6, 0);
      C.glow.col(st.neon, 0.9).mat(0);
      C.glow.cyl(bb.cx, top + 0.2, bb.cz, Math.max(0.9, ms * 0.1) + 0.05, 0.6, 6, false);
      beacon(C, bb.cx, top + sh + 0.4, bb.cz);
      break;
    }
    case "pyramid": {
      const ph = Math.max(6, ms * 0.45);
      G.mat(st.layer === L.brick || st.layer === L.resid ? L.plain : L.glass, st.seed, 1).col(
        st.layer === L.brick ? "#5f8f7f" : st.tint,
      );
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i]!;
        const q = poly[(i + 1) % poly.length]!;
        G.tri(q[0], y, q[1], p[0], y, p[1], bb.cx, y + ph, bb.cz);
      }
      C.glow.col(st.neon).mat(0);
      for (let i = 0; i < poly.length; i++)
        C.glow.wall(poly[i]!, poly[(i + 1) % poly.length]!, y - 0.6, y);
      beacon(C, bb.cx, y + ph + 0.4, bb.cz);
      break;
    }
    case "slant": {
      if (poly.length !== 4) return crown(C, poly, y, st, b, "pyramid");
      const along = bb.w >= bb.d;
      const rise = Math.max(5, (along ? bb.w : bb.d) * 0.45);
      const { x0, z0, x1, z1 } = bb;
      // the roof slopes up towards +x (or +z): a wedge
      const yA = y;
      const yB = y + rise;
      G.mat(st.layer, st.seed, 1).col(st.tint);
      if (along) {
        G.quad(x0, yA, z1, x1, yB, z1, x1, yB, z0, x0, yA, z0, [0, 0, 4, 4]); // slope
        G.quad(
          x1,
          y,
          z1,
          x1,
          y,
          z0,
          x1,
          yB,
          z0,
          x1,
          yB,
          z1,
          facadeUV(st.layer, bb.d, 0, rise, st.fh, st.uOff, st.vOff),
        ); // back wall
        G.tri(x1, y, z0, x0, y, z0, x1, yB, z0);
        G.tri(x0, y, z1, x1, y, z1, x1, yB, z1);
      } else {
        G.quad(x0, yB, z1, x1, yB, z1, x1, yA, z0, x0, yA, z0, [0, 0, 4, 4]);
        G.quad(
          x0,
          y,
          z1,
          x1,
          y,
          z1,
          x1,
          yB,
          z1,
          x0,
          yB,
          z1,
          facadeUV(st.layer, bb.w, 0, rise, st.fh, st.uOff, st.vOff),
        );
        G.tri(x1, y, z1, x1, y, z0, x1, yB, z1);
        G.tri(x0, y, z0, x0, y, z1, x0, yB, z1);
      }
      C.glow.col(st.neon).mat(0);
      if (along) C.glow.box(x1 - 0.2, yB - 0.1, (z0 + z1) / 2, 0.5, 0.5, bb.d + 0.2);
      else C.glow.box((x0 + x1) / 2, yB - 0.1, z1 - 0.2, bb.w + 0.2, 0.5, 0.5);
      beacon(C, along ? x1 : bb.cx, yB + 0.8, along ? bb.cz : z1);
      break;
    }
    case "ring": {
      const inner = roof(G, poly, y, st, 3.5, 0.5);
      const band = insetPoly(poly, -0.25);
      C.glow.col(st.neon).mat(0);
      for (let i = 0; i < band.length; i++)
        C.glow.wall(band[i]!, band[(i + 1) % band.length]!, y + 1.6, y + 2.6);
      rooftop(G, inner, y, st, 1);
      if (b.h > 90) beacon(C, bb.cx, y + 4, bb.cz);
      break;
    }
    case "helipad": {
      const inner = roof(G, poly, y, st, 1.1);
      const rad = Math.min(bbox(inner).w, bbox(inner).d) * 0.42;
      if (rad < 5) return;
      G.mat(L.plain, st.seed, 0).col("#2a2d33");
      G.cyl(bb.cx, y, bb.cz, rad, 0.25, 16);
      G.col("#f2c21a");
      G.cyl(bb.cx, y + 0.25, bb.cz, rad * 0.8, 0.02, 20, true);
      G.col("#2a2d33");
      G.cyl(bb.cx, y + 0.27, bb.cz, rad * 0.72, 0.02, 20, true);
      G.col("#f4f4f4");
      const hs = rad * 0.4;
      G.box(bb.cx - hs * 0.45, y + 0.3, bb.cz, hs * 0.2, 0.03, hs * 1.1);
      G.box(bb.cx + hs * 0.45, y + 0.3, bb.cz, hs * 0.2, 0.03, hs * 1.1);
      G.box(bb.cx, y + 0.3, bb.cz, hs * 0.9, 0.03, hs * 0.2);
      for (const [dx, dz] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ] as const)
        beacon(C, bb.cx + dx * rad * 0.7, y + 0.6, bb.cz + dz * rad * 0.7);
      break;
    }
  }
}

/** storefront dressing along the street faces of a ground-floor outline */
function shopfronts(C: Ctx, poly: P2[], st: Style, b: Bld, vols: Vol[], self: number) {
  const r = st.r;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    if (!isStreetEdge(p, q, b.street)) continue;
    const dx = q[0] - p[0];
    const dz = q[1] - p[1];
    const fw = Math.hypot(dx, dz);
    if (fw < 5) continue;
    const nx = dz / fw;
    const nz = -dx / fw;
    // a street-side face buried behind another part of the building (a terrace's back tiers)
    if (inSibling(vols, self, (p[0] + q[0]) / 2 + nx, 2, (p[1] + q[1]) / 2 + nz)) continue;
    const ux = dx / fw;
    const uz = dz / fw;
    const rot = Math.atan2(nx, nz);
    const mx = (p[0] + q[0]) / 2;
    const mz = (p[1] + q[1]) / 2;
    // awning
    if (r() < 0.5) {
      const w = Math.min(fw - 1, 4 + r() * 10);
      const off = (r() - 0.5) * (fw - w - 1);
      const ax = mx + ux * off;
      const az = mz + uz * off;
      const col = pick(AWNING, r);
      const D = C.detail;
      D.mat(L.plain, st.seed, 0).col(col);
      const hw = w / 2;
      const p0x = ax - ux * hw,
        p0z = az - uz * hw;
      const p1x = ax + ux * hw,
        p1z = az + uz * hw;
      const out = 1.6;
      C.drips.push([p0x + nx * out, p0z + nz * out, p1x + nx * out, p1z + nz * out]);
      // sloped top (wall edge at 3.9 m, outer edge at 3.2 m), front valance, two ends
      D.quad(
        p0x + nx * out,
        3.2,
        p0z + nz * out,
        p1x + nx * out,
        3.2,
        p1z + nz * out,
        p1x,
        3.9,
        p1z,
        p0x,
        3.9,
        p0z,
      );
      D.col(col, 0.8);
      D.quad(
        p1x + nx * out,
        2.85,
        p1z + nz * out,
        p0x + nx * out,
        2.85,
        p0z + nz * out,
        p0x + nx * out,
        3.2,
        p0z + nz * out,
        p1x + nx * out,
        3.2,
        p1z + nz * out,
      );
      D.quad(
        p0x + nx * out,
        2.85,
        p0z + nz * out,
        p1x + nx * out,
        2.85,
        p1z + nz * out,
        p1x + nx * out,
        3.2,
        p1z + nz * out,
        p0x + nx * out,
        3.2,
        p0z + nz * out,
      );
    }
    // sign on the fascia
    if (r() < 0.7) {
      const w = Math.min(fw * 0.6, 3 + r() * 4);
      const h = w * 0.3;
      const off = (r() - 0.5) * (fw - w - 1);
      const sx = mx + ux * off + nx * 0.07;
      const sz = mz + uz * off + nz * 0.07;
      const word = Math.floor(r() * SIGN_WORDS.length);
      const y0 = 3.95;
      C.signs.col("#ffffff").mat(0);
      C.signs.quad(
        sx + ux * (w / 2),
        y0,
        sz + uz * (w / 2),
        sx - ux * (w / 2),
        y0,
        sz - uz * (w / 2),
        sx - ux * (w / 2),
        y0 + h,
        sz - uz * (w / 2),
        sx + ux * (w / 2),
        y0 + h,
        sz + uz * (w / 2),
        wordUV(word),
      );
    }
    if (r() < 0.22) {
      C.glow.col(pick(NEON, r)).mat(0);
      C.glow.obox(mx + nx * 0.1, 4.45, mz + nz * 0.1, fw * 0.9, 0.1, 0.08, rot);
    }
  }
}

/** balconies on the street faces of a residential outline (rectangles only) */
function balconies(
  C: Ctx,
  poly: P2[],
  y0: number,
  y1: number,
  st: Style,
  b: Bld,
  store: boolean,
  vols: Vol[],
  self: number,
) {
  const D = C.detail;
  const glassRail = st.r() < 0.5;
  // module grid and storey lines exactly as walls() tiles this facade, so every slab
  // lands under a balcony door of the texture
  const modW = MODULE_W[st.layer] ?? 3;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const street = isStreetEdge(p, q, b.street);
    if (!street && st.r() < 0.6) continue;
    const dx = q[0] - p[0];
    const dz = q[1] - p[1];
    const fw = Math.hypot(dx, dz);
    if (fw < 6) continue;
    const mods = Math.max(1, Math.round(fw / modW));
    const mw = fw / mods;
    const nx = dz / fw;
    const nz = -dx / fw;
    const rot = Math.atan2(nx, nz);
    const base = store && y0 < 0.1 && y1 > 6 && fw > 3 && street ? 4.5 : y0;
    const floors = Math.floor((y1 - base) / st.fh);
    for (let f = 1; f < floors; f++) {
      const y = base + f * st.fh;
      for (let m = 0; m < mods; m++) {
        // balcony doors sit on the even columns of the facade texture (counted from the far end)
        if ((st.uOff + (mods - 1 - m)) % 2 !== 0) continue;
        const t = (m + 0.5) * mw;
        // not on a face buried against another part of the building
        const hw = mw * 0.41;
        const ex = (dx / fw) * hw;
        const ez = (dz / fw) * hw;
        const ox = p[0] + (dx / fw) * t + nx * 0.65;
        const oz = p[1] + (dz / fw) * t + nz * 0.65;
        if (
          inSibling(vols, self, ox - ex, y, oz - ez, -0.3) ||
          inSibling(vols, self, ox + ex, y, oz + ez, -0.3) ||
          inSibling(vols, self, ox - ex, y + 1, oz - ez, -0.3) ||
          inSibling(vols, self, ox + ex, y + 1, oz + ez, -0.3)
        )
          continue;
        const cx = ox;
        const cz = oz;
        D.mat(L.plain, st.seed, 0).col("#d8d4cc");
        D.obox(cx, y - 0.1, cz, mw * 0.82, 0.16, 1.3, rot);
        D.col(glassRail ? "#9fb4c0" : "#3a3c40");
        D.obox(cx + nx * 0.62, y + 0.06, cz + nz * 0.62, mw * 0.82, 0.95, 0.05, rot, false);
      }
    }
  }
}

/** iron fire escape zig-zagging up the front of a brick walk-up */
function fireEscape(C: Ctx, poly: P2[], y1: number, st: Style, b: Bld, vols: Vol[], self: number) {
  if (poly.length !== 4) return;
  const D = C.detail;
  // the front face (or the first street face)
  let e = -1;
  for (let i = 0; i < 4; i++) if (sideOf(poly[i]!, poly[(i + 1) % 4]!) === b.front) e = i;
  if (e < 0) return;
  const p = poly[e]!;
  const q = poly[(e + 1) % 4]!;
  const dx = q[0] - p[0];
  const dz = q[1] - p[1];
  const fw = Math.hypot(dx, dz);
  if (fw < 8) return;
  const ux = dx / fw,
    uz = dz / fw;
  const nx = dz / fw,
    nz = -dx / fw;
  if (inSibling(vols, self, (p[0] + q[0]) / 2 + nx, 2, (p[1] + q[1]) / 2 + nz)) return;
  const rot = Math.atan2(nx, nz);
  const t = fw * (0.3 + st.r() * 0.4);
  const cx = p[0] + ux * t;
  const cz = p[1] + uz * t;
  const w = 4.4;
  D.mat(L.plain, st.seed, 0).col("#2a2a2c");
  for (let y = 4.5 + st.fh; y < y1 - 1; y += st.fh) {
    D.obox(cx + nx * 0.6, y - 0.08, cz + nz * 0.6, w, 0.08, 1.2, rot);
    D.obox(cx + nx * 1.18, y, cz + nz * 1.18, w, 0.9, 0.04, rot, false);
    D.obox(cx + nx * 1.18 + ux * (w / 2), y, cz + nz * 1.18 + uz * (w / 2), 0.05, 0.95, 0.05, rot);
    D.obox(cx + nx * 1.18 - ux * (w / 2), y, cz + nz * 1.18 - uz * (w / 2), 0.05, 0.95, 0.05, rot);
    // stair flight to the next landing
    if (y + st.fh < y1 - 1) {
      const a0 = -w / 2 + 0.3;
      const a1 = w / 2 - 0.3;
      const ya = y;
      const yb = y + st.fh;
      const px0 = cx + ux * a0,
        pz0 = cz + uz * a0;
      const px1 = cx + ux * a1,
        pz1 = cz + uz * a1;
      D.quad(
        px0 + nx * 0.25,
        ya,
        pz0 + nz * 0.25,
        px0 + nx * 0.85,
        ya,
        pz0 + nz * 0.85,
        px1 + nx * 0.85,
        yb,
        pz1 + nz * 0.85,
        px1 + nx * 0.25,
        yb,
        pz1 + nz * 0.25,
      );
      D.quad(
        px1 + nx * 0.25,
        yb,
        pz1 + nz * 0.25,
        px1 + nx * 0.85,
        yb,
        pz1 + nz * 0.85,
        px0 + nx * 0.85,
        ya,
        pz0 + nz * 0.85,
        px0 + nx * 0.25,
        ya,
        pz0 + nz * 0.25,
      );
    }
  }
}

/** a whole tower-type massing part (box / cyl / oct / chamfer / taper / deco); returns its top outline + y */
function massPart(C: Ctx, p: Part, st: Style, b: Bld, store: boolean): { poly: P2[]; y: number } {
  const G = C.main;
  const base = outline(p);
  const y0 = p.y0;
  const y1 = p.y0 + p.h;
  if (p.shape === "taper") {
    // three tapering sections with small ledges: the landmark shape
    const kTop = b.t === "super" ? 0.46 : 0.6;
    const fr = [0, 0.44, 0.72, 0.9, 1];
    let lo = base;
    for (let k = 0; k < 4; k++) {
      const ya = y0 + p.h * fr[k]!;
      const yb = y0 + p.h * fr[k + 1]!;
      const s1 = 1 - (1 - kTop) * fr[k + 1]!;
      const hi = scalePoly(base, s1);
      slopedWalls(G, lo, hi, ya, yb, st);
      if (k < 3) {
        const next = scalePoly(base, s1 * 0.95);
        G.mat(L.plain, st.seed, 1).col(st.tint, 1.05);
        ring(G, hi, next, yb);
        C.glow.col(st.neon, 0.8).mat(0);
        for (let i = 0; i < hi.length; i++)
          C.glow.wall(hi[i]!, hi[(i + 1) % hi.length]!, yb - 0.5, yb);
        lo = next;
      } else lo = hi;
    }
    return { poly: lo, y: y1 };
  }
  if (p.shape === "deco") {
    // wedding cake: setbacks at ~52 / 72 / 86 % of the height
    const fr = [0, 0.52, 0.72, 0.86, 1];
    const ms = Math.min(p.x1 - p.x0, p.z1 - p.z0);
    let poly = base;
    for (let k = 0; k < 4; k++) {
      const ya = y0 + p.h * fr[k]!;
      const yb = y0 + p.h * fr[k + 1]!;
      walls(G, poly, ya, yb, st, b.street, store && k === 0 && y0 < 0.1);
      const next = insetPoly(poly, ms * 0.1);
      if (k < 3) {
        G.mat(L.plain, st.seed, 1).col(st.tint, 1.08);
        ring(G, poly, next, yb);
        // a pale ledge band and a vertical fin on the setback
        const band = insetPoly(poly, -0.2);
        for (let i = 0; i < band.length; i++)
          G.wall(band[i]!, band[(i + 1) % band.length]!, yb - 0.6, yb);
        poly = next;
      }
    }
    return { poly, y: y1 };
  }
  const cut = b.access && y0 < 0.1 ? b.access.door : undefined;
  walls(G, base, y0, y1, st, b.street, store && y0 < 0.1, st.layer, st.tint, st.fh, cut);
  if (y0 > 0.1 && p.role !== "tower") {
    // overhanging upper block (cantilever): close its underside
    G.mat(L.plain, st.seed, 0).col(st.tint, 0.6);
    G.cap(base, y0, true);
  }
  return { poly: base, y: y1 };
}

function building(b: Bld, C: Ctx) {
  const st = styleOf(b);
  const G = C.main;
  if (b.backdrop) {
    // skyline filler: massing and a plain roof only
    for (const p of b.parts) {
      const poly = outline(p);
      walls(G, poly, p.y0, p.y0 + p.h, st, 0, false);
      G.mat(L.plain, st.seed, 0).col(st.roof);
      G.cap(poly, p.y0 + p.h);
    }
    const top = b.parts.reduce((a, p) => (p.y0 + p.h > a.y0 + a.h ? p : a), b.parts[0]!);
    if (top && top.y0 + top.h > 100)
      beacon(C, (top.x0 + top.x1) / 2, top.y0 + top.h + 1, (top.z0 + top.z1) / 2);
    return;
  }
  switch (b.t) {
    case "parking":
    case "empty":
      return;
    case "gas":
      return gasStation(b, st, C);
    case "construction":
      return construction(b, st, C);
    case "church":
      return church(b, st, C);
    case "civic":
      return civic(b, st, C);
    case "diner":
      return diner(b, st, C);
    case "garage":
      return garage(b, st, C);
  }
  const tops: { poly: P2[]; y: number; p: Part; i: number }[] = [];
  const vols = volsOf(b);
  for (const [pi, p] of b.parts.entries()) {
    if (p.role === "bridge") {
      // glass sky bridge between the twins
      const poly = rectPoly(p.x0, p.z0, p.x1, p.z1);
      walls(G, poly, p.y0, p.y0 + p.h, st, 0, false, L.ribbon, hex("#dfe4e8"), 4);
      G.mat(L.plain, st.seed, 0).col("#c8ccd0");
      G.cap(poly, p.y0 + p.h);
      G.cap(poly, p.y0, true);
      continue;
    }
    const store =
      st.store &&
      p.y0 < 0.1 &&
      (p.role === "podium" || p.role === "body" || b.t === "pencil" || b.t === "tower");
    const layerOverride =
      p.role === "podium" && b.t !== "super"
        ? st.layer === L.glass || st.layer === L.dark
          ? L.ribbon
          : st.layer
        : null;
    const pst =
      layerOverride !== null
        ? {
            ...st,
            layer: layerOverride,
            tint:
              layerOverride === L.ribbon && st.layer !== L.ribbon
                ? hex(pick(RIBBON_T, st.r))
                : st.tint,
          }
        : st;
    const top = massPart(C, p, pst, b, store);
    tops.push({ ...top, p, i: pi });
    if (store && p.shape !== "cyl" && !b.access) shopfronts(C, outline(p), st, b, vols, pi);
    if (b.access) continue; // the access system dresses the entrance and the roof
    if (
      st.balcony &&
      st.layer === L.resid &&
      p.h > 9 &&
      (p.shape ?? "box") === "box" &&
      b.t !== "tower"
    )
      balconies(C, outline(p), p.y0, p.y0 + p.h, st, b, store, vols, pi);
    if (st.fire && p.y0 < 0.1 && (p.shape ?? "box") === "box")
      fireEscape(C, outline(p), p.y0 + p.h, st, b, vols, pi);
  }
  // roofs on everything but the tallest part, the crown on the tallest
  let hi = 0;
  for (let k = 1; k < tops.length; k++) if (tops[k]!.y > tops[hi]!.y) hi = k;
  tops.forEach((t, k) => {
    if (k === hi) return;
    const inner = roof(G, t.poly, t.y + k * 0.03, st, 0.9, 0.35, st.roof, (p, q, ya, yb) =>
      openSpans(vols, t.i, p, q, ya, yb),
    );
    if (t.p.role === "podium" && st.r() < 0.35) {
      // podium roof garden
      G.mat(L.plain, st.seed, 0).col("#6a8f45");
      G.cap(insetPoly(inner, 1.5), t.y + 0.25);
    } else rooftop(G, inner, t.y, st, 1);
  });
  const T = tops[hi];
  if (!T) return;
  if (b.access) {
    // a walkable roof: parapet and a cap with the shaft opening; the access system adds the
    // penthouse, the rooftop props and (on the landmark) the spire
    roof(G, T.poly, T.y, st, b.access.parapet, 0.35, st.roof, undefined, b.access.hole);
    return;
  }
  const kind: Crown = b.crown ?? "flat";
  crown(C, T.poly, T.y, st, b, kind);
  if (b.t === "hotel") hotelExtras(b, st, C, T);
  if (b.t === "convention") {
    // big flat roof overhang on slim columns
    const p = b.parts[0]!;
    G.mat(L.plain, st.seed, 0).col("#eceae4");
    const o = 5;
    G.box((p.x0 + p.x1) / 2, p.h, (p.z0 + p.z1) / 2, p.x1 - p.x0 + o * 2, 1.2, p.z1 - p.z0 + o * 2);
    G.cap(rectPoly(p.x0 - o, p.z0 - o, p.x1 + o, p.z1 + o), p.h, true);
    G.col("#d8d6d0");
    for (let x = p.x0 - o + 1; x <= p.x1 + o - 1; x += 12) {
      G.cyl(x, 0, p.z1 + o - 1, 0.45, p.h, 8, false);
      G.cyl(x, 0, p.z0 - o + 1, 0.45, p.h, 8, false);
    }
  }
  if (b.t === "bigbox") {
    const p = b.parts[0]!;
    // entrance glass + a big sign facing the parking lot (south)
    const cx = (p.x0 + p.x1) / 2;
    G.mat(L.store, st.seed, 1).col("#f4f2ee");
    G.wall(
      [cx + 12, p.z1 + 0.06],
      [cx - 12, p.z1 + 0.06],
      0,
      4.5,
      facadeUV(L.store, 24, 0, 4.5, 4.5, 0, 0),
    );
    const word = 3 + Math.floor(st.r() * 3);
    C.signs.col("#ffffff").mat(0);
    C.signs.quad(
      cx + 9,
      5.8,
      p.z1 + 0.1,
      cx - 9,
      5.8,
      p.z1 + 0.1,
      cx - 9,
      8.3,
      p.z1 + 0.1,
      cx + 9,
      8.3,
      p.z1 + 0.1,
      wordUV(word),
    );
  }
  if (b.t === "warehouse") {
    // roll-up loading doors on the street side
    const p = b.parts[0]!;
    const poly = rectPoly(p.x0, p.z0, p.x1, p.z1);
    for (let i = 0; i < 4; i++) {
      const a = poly[i]!;
      const q = poly[(i + 1) % 4]!;
      if (sideOf(a, q) !== b.front) continue;
      const dx = q[0] - a[0];
      const dz = q[1] - a[1];
      const fw = Math.hypot(dx, dz);
      const nx = dz / fw,
        nz = -dx / fw;
      const n = Math.floor(fw / 8);
      C.detail.mat(L.plain, st.seed, 0).col("#5a5e62");
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) * (fw / n);
        C.detail.obox(
          a[0] + (dx / fw) * t + nx * 0.05,
          0,
          a[1] + (dz / fw) * t + nz * 0.05,
          4,
          4.4,
          0.12,
          Math.atan2(nx, nz),
        );
      }
    }
  }
  // rooftop billboard on some low and mid-rise roofs
  if (
    b.h < 36 &&
    b.h > 7 &&
    (b.t === "low" || b.t === "mid" || b.t === "corner") &&
    st.r() < 0.14
  ) {
    const inner = insetPoly(T.poly, 1.5);
    const bb = bbox(inner);
    if (bb.w > 8 && bb.d > 6) {
      const alongX = b.front === 0 || b.front === 2;
      const w = Math.min(alongX ? bb.w : bb.d, 12);
      const h = w * 0.45;
      const y = T.y + 2;
      const fs = b.front === 0 || b.front === 3 ? -1 : 1;
      G.mat(L.plain, st.seed, 0).col("#3a3c40");
      for (const s of [-0.35, 0.35])
        G.box(bb.cx + (alongX ? s * w : 0), T.y, bb.cz + (alongX ? 0 : s * w), 0.25, 2 + h, 0.25);
      G.box(bb.cx, y, bb.cz, alongX ? w + 0.3 : 0.3, h + 0.3, alongX ? 0.3 : w + 0.3);
      const uv = adUV(Math.floor(st.r() * 4));
      C.signs.col("#ffffff").mat(0);
      if (alongX) {
        const z = bb.cz + fs * 0.18;
        if (fs > 0)
          C.signs.quad(
            bb.cx - w / 2,
            y + 0.15,
            z,
            bb.cx + w / 2,
            y + 0.15,
            z,
            bb.cx + w / 2,
            y + 0.15 + h,
            z,
            bb.cx - w / 2,
            y + 0.15 + h,
            z,
            uv,
          );
        else
          C.signs.quad(
            bb.cx + w / 2,
            y + 0.15,
            z,
            bb.cx - w / 2,
            y + 0.15,
            z,
            bb.cx - w / 2,
            y + 0.15 + h,
            z,
            bb.cx + w / 2,
            y + 0.15 + h,
            z,
            uv,
          );
      } else {
        const x = bb.cx + fs * 0.18;
        if (fs > 0)
          C.signs.quad(
            x,
            y + 0.15,
            bb.cz + w / 2,
            x,
            y + 0.15,
            bb.cz - w / 2,
            x,
            y + 0.15 + h,
            bb.cz - w / 2,
            x,
            y + 0.15 + h,
            bb.cz + w / 2,
            uv,
          );
        else
          C.signs.quad(
            x,
            y + 0.15,
            bb.cz - w / 2,
            x,
            y + 0.15,
            bb.cz + w / 2,
            x,
            y + 0.15 + h,
            bb.cz + w / 2,
            x,
            y + 0.15 + h,
            bb.cz - w / 2,
            uv,
          );
      }
    }
  }
}

function hotelExtras(b: Bld, st: Style, C: Ctx, T: { poly: P2[]; y: number }) {
  // entrance canopy over the sidewalk + a tall HOTEL sign on the crown
  const pod = b.parts[0]!;
  const f = b.front;
  const cx = (pod.x0 + pod.x1) / 2;
  const cz = (pod.z0 + pod.z1) / 2;
  const nx = f === 1 ? 1 : f === 3 ? -1 : 0;
  const nz = f === 2 ? 1 : f === 0 ? -1 : 0;
  const ex = nx !== 0 ? (nx > 0 ? pod.x1 : pod.x0) : cx;
  const ez = nz !== 0 ? (nz > 0 ? pod.z1 : pod.z0) : cz;
  const rot = Math.atan2(nx, nz);
  const G = C.detail;
  G.mat(L.plain, st.seed, 0).col("#f4efe6");
  G.obox(ex + nx * 2.5, 4, ez + nz * 2.5, 12, 0.5, 5, rot);
  G.col("#c8a24a");
  for (const s of [-5, 5])
    G.obox(
      ex + nx * 4.7 + (nz !== 0 ? s : 0),
      0,
      ez + nz * 4.7 + (nx !== 0 ? s : 0),
      0.25,
      4,
      0.25,
      rot,
    );
  C.glow.col("#ffe8b0").mat(0);
  C.glow.obox(ex + nx * 2.5, 3.95, ez + nz * 2.5, 11.6, 0.06, 4.6, rot, false);
  const bb = bbox(T.poly);
  const w = Math.min(bb.w, bb.d) * 0.8;
  const y = T.y + 4;
  const uv = wordUV(W_HOTEL);
  C.signs.col("#ffffff").mat(0);
  if (nz !== 0) {
    const z = nz > 0 ? bb.z1 + 0.3 : bb.z0 - 0.3;
    const s = nz > 0 ? 1 : -1;
    C.signs.quad(
      bb.cx - (s * w) / 2,
      y,
      z,
      bb.cx + (s * w) / 2,
      y,
      z,
      bb.cx + (s * w) / 2,
      y + w * 0.3,
      z,
      bb.cx - (s * w) / 2,
      y + w * 0.3,
      z,
      uv,
    );
  } else {
    const x = nx > 0 ? bb.x1 + 0.3 : bb.x0 - 0.3;
    const s = nx > 0 ? 1 : -1;
    C.signs.quad(
      x,
      y,
      bb.cz + (s * w) / 2,
      x,
      y,
      bb.cz - (s * w) / 2,
      x,
      y + w * 0.3,
      bb.cz - (s * w) / 2,
      x,
      y + w * 0.3,
      bb.cz + (s * w) / 2,
      uv,
    );
  }
}

function gasStation(b: Bld, st: Style, C: Ctx) {
  const G = C.main;
  const kiosk = b.parts[0]!;
  const canopy = b.parts[1]!;
  const kp = rectPoly(kiosk.x0, kiosk.z0, kiosk.x1, kiosk.z1);
  walls(G, kp, 0, kiosk.h, st, 15, false, L.store, hex("#f4f2ee"), 4.5);
  roof(G, kp, kiosk.h, st, 0.6, 0.3, "#8a8780");
  // canopy slab with a red band, four columns, pump islands
  const cp = rectPoly(canopy.x0, canopy.z0, canopy.x1, canopy.z1);
  G.mat(L.plain, st.seed, 0).col("#f4f4f2");
  G.box(
    (canopy.x0 + canopy.x1) / 2,
    canopy.y0,
    (canopy.z0 + canopy.z1) / 2,
    canopy.x1 - canopy.x0,
    canopy.h,
    canopy.z1 - canopy.z0,
  );
  G.cap(cp, canopy.y0, true);
  C.glow.col("#e8322a").mat(0);
  for (let i = 0; i < 4; i++)
    C.glow.wall(
      insetPoly(cp, -0.05)[i]!,
      insetPoly(cp, -0.05)[(i + 1) % 4]!,
      canopy.y0 + 0.35,
      canopy.y0 + 0.85,
    );
  C.pools(canopy);
  const D = C.detail;
  D.mat(L.plain, st.seed, 0).col("#d8d8d4");
  for (const [x, z] of [
    [canopy.x0 + 3, canopy.z0 + 3],
    [canopy.x1 - 3, canopy.z0 + 3],
    [canopy.x0 + 3, canopy.z1 - 3],
    [canopy.x1 - 3, canopy.z1 - 3],
  ] as const)
    D.box(x, 0, z, 0.6, canopy.y0, 0.6);
  const midz = (canopy.z0 + canopy.z1) / 2;
  for (let x = canopy.x0 + 5; x < canopy.x1 - 4; x += 5) {
    D.col("#cfcac0");
    D.box(x, 0, midz, 1.2, 0.2, 3.2);
    D.col("#e8e6e0");
    D.box(x, 0.2, midz - 0.7, 0.7, 1.7, 0.5);
    D.box(x, 0.2, midz + 0.7, 0.7, 1.7, 0.5);
    D.col("#c8302a");
    D.box(x, 1.5, midz - 0.7, 0.72, 0.3, 0.52);
    D.box(x, 1.5, midz + 0.7, 0.72, 0.3, 0.52);
  }
  // price pylon at the street corner
  const px = b.street & 2 ? b.x1 - 2 : b.x0 + 2;
  const pz = b.street & 4 ? b.z1 - 2 : b.z0 + 2;
  D.col("#3a3c40");
  D.box(px, 0, pz, 0.4, 6, 0.4);
  const uv = wordUV(W_GAS);
  C.signs.col("#ffffff").mat(0);
  for (const s of [1, -1])
    C.signs.quad(
      px - 1.6 * s,
      6,
      pz + 0.22 * s,
      px + 1.6 * s,
      6,
      pz + 0.22 * s,
      px + 1.6 * s,
      7.6,
      pz + 0.22 * s,
      px - 1.6 * s,
      7.6,
      pz + 0.22 * s,
      uv,
    );
}

function construction(b: Bld, st: Style, C: Ctx) {
  const G = C.main;
  const f = b.parts[0]!;
  const built = Math.floor((f.h / 4) * 0.72);
  const top = f.h;
  const cols: number[] = [];
  const rows: number[] = [];
  for (
    let x = f.x0 + 0.5;
    x <= f.x1 - 0.4;
    x += (f.x1 - f.x0 - 1) / Math.max(1, Math.round((f.x1 - f.x0) / 8))
  )
    cols.push(x);
  for (
    let z = f.z0 + 0.5;
    z <= f.z1 - 0.4;
    z += (f.z1 - f.z0 - 1) / Math.max(1, Math.round((f.z1 - f.z0) / 8))
  )
    rows.push(z);
  G.mat(L.plain, st.seed, 1).col("#b8b4ac");
  for (const x of cols) for (const z of rows) G.box(x, 0, z, 0.7, top, 0.7);
  // floor slabs up to the built height, a concrete core to the top
  G.col("#c8c4bc");
  for (let k = 1; k <= built; k++) {
    G.box((f.x0 + f.x1) / 2, k * 4 - 0.35, (f.z0 + f.z1) / 2, f.x1 - f.x0, 0.35, f.z1 - f.z0);
    G.cap(rectPoly(f.x0, f.z0, f.x1, f.z1), k * 4 - 0.35, true);
  }
  G.col("#a8a49c");
  const cw = Math.min(10, (f.x1 - f.x0) * 0.3);
  G.box((f.x0 + f.x1) / 2, 0, (f.z0 + f.z1) / 2, cw, top + 4, cw);
  // orange safety netting on the top built floors
  G.col("#e8742a");
  const np = rectPoly(f.x0 - 0.3, f.z0 - 0.3, f.x1 + 0.3, f.z1 + 0.3);
  for (let i = 0; i < 4; i++) G.wall(np[i]!, np[(i + 1) % 4]!, built * 4 - 5, built * 4 - 3.6);
  // tower crane beside the frame
  const mx = f.x1 + 3.5 > b.x1 - 1 ? f.x0 - 3 : f.x1 + 3;
  const mz = (f.z0 + f.z1) / 2;
  const mh = top + 22;
  G.col("#e8b020");
  for (const [dx, dz] of [
    [0.9, 0.9],
    [0.9, -0.9],
    [-0.9, 0.9],
    [-0.9, -0.9],
  ] as const)
    G.box(mx + dx, 0, mz + dz, 0.25, mh, 0.25);
  for (let y = 3; y < mh; y += 4) {
    G.box(mx, y, mz + 0.9, 1.8, 0.18, 0.18);
    G.box(mx, y, mz - 0.9, 1.8, 0.18, 0.18);
    G.box(mx + 0.9, y, mz, 0.18, 0.18, 1.8);
    G.box(mx - 0.9, y, mz, 0.18, 0.18, 1.8);
  }
  const jl = 55;
  const dir = mx > f.x1 ? -1 : 1;
  G.box(mx + (dir * jl) / 2, mh, mz, jl, 1.2, 1.4);
  G.box(mx - dir * 9, mh, mz, 18, 1.2, 2);
  G.col("#8a8a86");
  G.box(mx - dir * 16, mh - 2.4, mz, 3, 2.4, 2.4);
  G.col("#e8b020");
  G.box(mx, mh + 1.2, mz, 1.6, 6, 1.6);
  G.cone(mx, mh + 7.2, mz, 1.2, 3, 4);
  G.col("#f2f2ee");
  G.box(mx + dir * 1.8, mh - 3, mz + 1.4, 2, 2.4, 2);
  // hook and a load of steel hanging from the trolley
  const hx = mx + dir * jl * 0.6;
  G.col("#2a2a2a");
  G.box(hx, built * 4 + 6, mz, 0.06, mh - built * 4 - 6, 0.06);
  G.col("#8a5a3a");
  G.box(hx, built * 4 + 4.8, mz, 6, 0.6, 1.2);
  beacon(C, mx + dir * jl, mh + 1.6, mz);
  // hoarding round the site
  const D = C.detail;
  D.mat(L.plain, st.seed, 0).col("#2a6ab0");
  const lot = rectPoly(b.x0 + 0.2, b.z0 + 0.2, b.x1 - 0.2, b.z1 - 0.2);
  for (let i = 0; i < 4; i++) {
    const p = lot[i]!;
    const q = lot[(i + 1) % 4]!;
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const gate0 = len / 2 - 5;
    const gate1 = len / 2 + 5;
    const at = (t: number): P2 => [
      p[0] + ((q[0] - p[0]) * t) / len,
      p[1] + ((q[1] - p[1]) * t) / len,
    ];
    D.wall(p, at(gate0), 0, 2.4);
    D.wall(at(gate1), q, 0, 2.4);
    D.col("#23599a");
    D.wall(at(gate0), p, 0, 2.4);
    D.wall(q, at(gate1), 0, 2.4);
    D.col("#2a6ab0");
  }
}

function church(b: Bld, st: Style, C: Ctx) {
  const G = C.main;
  const nave = b.parts[0]!;
  const tower = b.parts[1]!;
  const np = rectPoly(nave.x0, nave.z0, nave.x1, nave.z1);
  walls(G, np, 0, nave.h, st, 0, false, L.stone, st.tint, 6);
  // pitched slate roof along the long axis
  const along = nave.z1 - nave.z0 > nave.x1 - nave.x0;
  const rh = (along ? nave.x1 - nave.x0 : nave.z1 - nave.z0) * 0.45;
  const y = nave.h;
  G.mat(L.plain, st.seed, 1).col("#4a4f58");
  const { x0, z0, x1, z1 } = nave;
  if (along) {
    const mx = (x0 + x1) / 2;
    G.quad(x0 - 0.4, y, z1, mx, y + rh, z1, mx, y + rh, z0, x0 - 0.4, y, z0);
    G.quad(mx, y + rh, z1, x1 + 0.4, y, z1, x1 + 0.4, y, z0, mx, y + rh, z0);
    G.mat(L.stone, st.seed, 1).col(st.tint);
    G.tri(x0, y, z1, x1, y, z1, mx, y + rh, z1);
    G.tri(x1, y, z0, x0, y, z0, mx, y + rh, z0);
  } else {
    const mz = (z0 + z1) / 2;
    G.quad(x1, y, z0 - 0.4, x0, y, z0 - 0.4, x0, y + rh, mz, x1, y + rh, mz);
    G.quad(x0, y, z1 + 0.4, x1, y, z1 + 0.4, x1, y + rh, mz, x0, y + rh, mz);
    G.mat(L.stone, st.seed, 1).col(st.tint);
    G.tri(x1, y, z1, x1, y, z0, x1, y + rh, mz);
    G.tri(x0, y, z0, x0, y, z1, x0, y + rh, mz);
  }
  // steeple: square tower, belfry openings, copper spire, a cross
  const tp = rectPoly(tower.x0, tower.z0, tower.x1, tower.z1);
  walls(G, tp, 0, tower.h, st, 0, false, L.stone, st.tint, 6);
  const tcx = (tower.x0 + tower.x1) / 2;
  const tcz = (tower.z0 + tower.z1) / 2;
  const tw = tower.x1 - tower.x0;
  G.mat(L.plain, st.seed, 1).col("#1e2024");
  for (let i = 0; i < 4; i++) {
    const p = tp[i]!;
    const q = tp[(i + 1) % 4]!;
    const mx = (p[0] + q[0]) / 2;
    const mz = (p[1] + q[1]) / 2;
    const dx = (q[0] - p[0]) * 0.18;
    const dz = (q[1] - p[1]) * 0.18;
    const ox = ((q[1] - p[1]) / tw) * 0.03;
    const oz = (-(q[0] - p[0]) / tw) * 0.03;
    G.wall([mx - dx + ox, mz - dz + oz], [mx + dx + ox, mz + dz + oz], tower.h - 7, tower.h - 2);
  }
  G.col(st.tint, 1.05);
  G.box(tcx, tower.h, tcz, tw + 0.8, 0.8, tw + 0.8);
  G.col("#5f8f7f");
  const sh = tower.h * 0.55;
  G.cone(tcx, tower.h + 0.8, tcz, tw * 0.62, sh, 8, Math.PI / 8);
  G.col("#c8a24a");
  G.box(tcx, tower.h + 0.8 + sh, tcz, 0.25, 3, 0.25);
  G.box(tcx, tower.h + 0.8 + sh + 1.8, tcz, 1.6, 0.25, 0.25);
  C.glow.col("#ffd9a0").mat(0);
  C.glow.box(tcx, tower.h - 6.6, tcz, tw * 0.3, 0.2, tw * 0.3);
}

function civic(b: Bld, st: Style, C: Ctx) {
  const G = C.main;
  const p = b.parts[0]!;
  const poly = rectPoly(p.x0, p.z0, p.x1, p.z1);
  walls(G, poly, 0, p.h, st, 0, false, L.stone, st.tint, 7);
  // cornice + roof + a green copper dome on a drum
  G.mat(L.plain, st.seed, 1).col(st.tint, 1.06);
  G.box(
    (p.x0 + p.x1) / 2,
    p.h - 0.8,
    (p.z0 + p.z1) / 2,
    p.x1 - p.x0 + 1.2,
    1.2,
    p.z1 - p.z0 + 1.2,
    false,
  );
  // cornice top as a rim round the roof (a full top would sit in the roof's plane)
  ring(G, rectPoly(p.x0 - 0.6, p.z0 - 0.6, p.x1 + 0.6, p.z1 + 0.6), poly, p.h + 0.4);
  G.mat(L.plain, st.seed, 0).col("#8a8780");
  G.cap(poly, p.h + 0.4);
  const cx = (p.x0 + p.x1) / 2;
  const cz = (p.z0 + p.z1) / 2;
  const dr = Math.min(p.x1 - p.x0, p.z1 - p.z0) * 0.22;
  G.mat(L.stone, st.seed, 1).col(st.tint);
  const drum: P2[] = [];
  for (let i = 0; i < 16; i++) {
    const t = (i / 16) * Math.PI * 2;
    drum.push([cx + Math.cos(t) * dr, cz + Math.sin(t) * dr]);
  }
  walls(G, drum, p.h, p.h + 7, st, 0, false, L.stone, st.tint, 7);
  G.mat(L.plain, st.seed, 1).col("#6f9f8a");
  const dome = new THREE.SphereGeometry(dr, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  G.add(dome, new THREE.Matrix4().makeTranslation(cx, p.h + 7, cz));
  dome.dispose();
  G.col("#c8a24a");
  G.cyl(cx, p.h + 7 + dr, cz, 0.3, 4, 6);
  // front portico: steps, columns, entablature, pediment
  const f = b.front;
  const nx = f === 1 ? 1 : f === 3 ? -1 : 0;
  const nz = f === 2 ? 1 : f === 0 ? -1 : 0;
  const fx = nx > 0 ? p.x1 : nx < 0 ? p.x0 : cx;
  const fz = nz > 0 ? p.z1 : nz < 0 ? p.z0 : cz;
  const span = (nz !== 0 ? p.x1 - p.x0 : p.z1 - p.z0) * 0.6;
  const rot = Math.atan2(nx, nz);
  G.mat(L.plain, st.seed, 1).col(st.tint, 1.04);
  for (let s = 0; s < 3; s++)
    G.obox(fx + nx * (4 - s * 0.6), s * 0.3, fz + nz * (4 - s * 0.6), span + 2, 0.3, 1.2, rot);
  const n = 6;
  for (let k = 0; k < n; k++) {
    const t = -span / 2 + (k / (n - 1)) * span;
    G.cyl(
      fx + nx * 3.6 + (nz !== 0 ? t : 0),
      0.9,
      fz + nz * 3.6 + (nx !== 0 ? t : 0),
      0.55,
      12.5,
      10,
      false,
    );
  }
  G.obox(fx + nx * 2.2, 13.4, fz + nz * 2.2, span + 1.6, 1.6, 4.8, rot);
  const pex = fx + nx * 4.6;
  const pez = fz + nz * 4.6;
  const ux = nz !== 0 ? 1 : 0;
  const uz = nx !== 0 ? 1 : 0;
  const hw = span / 2 + 0.8;
  triFacing(
    G,
    [pex - ux * hw, 15, pez - uz * hw],
    [pex + ux * hw, 15, pez + uz * hw],
    [pex, 19, pez],
    nx,
    nz,
  );
}

function diner(b: Bld, st: Style, C: Ctx) {
  const G = C.main;
  const p = b.parts[0]!;
  const poly = rectPoly(p.x0, p.z0, p.x1, p.z1);
  G.mat(L.plain, st.seed, 1).col("#d8dde2");
  for (let i = 0; i < 4; i++) G.wall(poly[i]!, poly[(i + 1) % 4]!, 0, 1.1);
  walls(G, poly, 1.1, 3.6, st, 0, false, L.store, hex("#f4f2ee"), 3.6);
  G.mat(L.plain, st.seed, 1).col("#c8ccd0");
  for (let i = 0; i < 4; i++) G.wall(poly[i]!, poly[(i + 1) % 4]!, 3.6, p.h);
  G.col("#b8bcc0");
  G.cap(poly, p.h);
  C.glow.col("#ff3a6a").mat(0);
  const band = insetPoly(poly, -0.05);
  for (let i = 0; i < 4; i++) C.glow.wall(band[i]!, band[(i + 1) % 4]!, 3.7, 3.95);
  // rooftop DINER sign facing the street
  const cx = (p.x0 + p.x1) / 2;
  const cz = (p.z0 + p.z1) / 2;
  const uv = wordUV(W_DINER);
  C.main.mat(L.plain, st.seed, 0).col("#3a3c40");
  C.main.box(cx - 2.5, p.h, cz, 0.2, 1.2, 0.2);
  C.main.box(cx + 2.5, p.h, cz, 0.2, 1.2, 0.2);
  C.signs.col("#ffffff").mat(0);
  for (const s of [1, -1])
    C.signs.quad(
      cx - 3.5 * s,
      p.h + 1.2,
      cz + 0.1 * s,
      cx + 3.5 * s,
      p.h + 1.2,
      cz + 0.1 * s,
      cx + 3.5 * s,
      p.h + 3.3,
      cz + 0.1 * s,
      cx - 3.5 * s,
      p.h + 3.3,
      cz + 0.1 * s,
      uv,
    );
}

function garage(b: Bld, st: Style, C: Ctx) {
  const G = C.main;
  const p = b.parts[0]!;
  const poly = rectPoly(p.x0, p.z0, p.x1, p.z1);
  walls(G, poly, 0, p.h, st, 0, false, L.garage, st.tint, 3.1, b.access?.door);
  roof(G, poly, p.h, st, b.access ? b.access.parapet : 1.1, b.access ? 0.35 : 0.3, "#8e8c86", undefined, b.access?.hole);
  // parked cars and light poles on the top deck, a blue P sign, an entry ramp opening
  const r = st.r;
  const D = C.detail;
  // (a walkable deck gets its parked cars from the access system, with collision)
  for (let k = 0; k < (b.access ? 0 : 10); k++) {
    if (r() < 0.4) continue;
    const x = p.x0 + 4 + ((k % 5) / 4) * (p.x1 - p.x0 - 8);
    const z = k < 5 ? p.z0 + 5 : p.z1 - 5;
    const v: Vehicle = {
      type: "sedan",
      len: 4.4,
      wid: 1.8,
      wheel: 0.33,
      color: [0xf2f2ee, 0x18191c, 0xb3202a, 0x9ea3aa, 0x1f3f8a][k % 5]!,
      extras: 0,
      mass: 1,
    };
    car(D, v, x, p.h + 0.02, z, 0);
  }
  G.mat(L.plain, st.seed, 0).col("#4a4f55");
  for (const [x, z] of b.access
    ? []
    : ([
        [p.x0 + 3, (p.z0 + p.z1) / 2],
        [p.x1 - 3, (p.z0 + p.z1) / 2],
      ] as const)) {
    G.cyl(x, p.h, z, 0.12, 6, 6);
    C.glow.col("#ffd9a0").mat(0);
    C.glow.box(x, p.h + 5.9, z, 0.8, 0.12, 0.4);
  }
  const f = b.front;
  const nx = f === 1 ? 1 : f === 3 ? -1 : 0;
  const nz = f === 2 ? 1 : f === 0 ? -1 : 0;
  const ex = nx > 0 ? p.x1 : nx < 0 ? p.x0 : (p.x0 + p.x1) / 2;
  const ez = nz > 0 ? p.z1 : nz < 0 ? p.z0 : (p.z0 + p.z1) / 2;
  C.glow.col("#2a6ae8").mat(0);
  C.glow.obox(ex + nx * 0.3, 4.2, ez + nz * 0.3, 1.6, 1.6, 0.15, Math.atan2(nx, nz));
  C.glow.col("#ffffff");
  C.glow.obox(ex + nx * 0.4, 4.6, ez + nz * 0.4, 0.3, 0.9, 0.05, Math.atan2(nx, nz));
  G.mat(L.plain, st.seed, 0).col("#141516");
  G.obox(ex + nx * 0.04, 0, ez + nz * 0.04, 6, 2.6, 0.05, Math.atan2(nx, nz));
}

/** parked car from its unit parts (lights off) */
function car(D: Geo, v: Vehicle, x: number, y: number, z: number, rot: number) {
  const s = Math.sin(rot);
  const c = Math.cos(rot);
  D.mat(L.plain, 0.5, 0);
  for (const p of vehicleParts(v)) {
    const wx = x + p.x * c + p.z * s;
    const wz = z - p.x * s + p.z * c;
    const color =
      p.kind === "head"
        ? 0xb8b8b0
        : p.kind === "tail"
          ? 0x6a1612
          : p.kind === "barR"
            ? 0x5a1010
            : p.kind === "barB"
              ? 0x10205a
              : p.color;
    D.col(color);
    if (p.kind === "wheel") D.obox(wx, y + p.y - p.sy / 2, wz, p.sz, p.sy, p.sx, rot);
    else D.obox(wx, y + p.y - p.sy / 2, wz, p.sx, p.sy, p.sz, rot);
  }
}

// ---------------------------------------------------------------------------------------
// street furniture templates (local space, +z = towards the road)

type TKey =
  | "light"
  | "trunk"
  | "canopy"
  | "bench"
  | "hydrant"
  | "news"
  | "meter"
  | "trash"
  | "bollard"
  | "dumpster"
  | "busstop"
  | "railing"
  | "barrier"
  | "subway";
type Tmpls = Record<TKey, Tmpl>;
let TM: Tmpls | null = null;
function templates(): Tmpls {
  if (TM) return TM;
  const t = (f: (g: Geo) => void) => {
    const g = new Geo();
    g.mat(L.plain, 0.5, 0);
    f(g);
    return g.freeze();
  };
  TM = {
    light: t((g) => {
      g.col("#4a4f55");
      g.cyl(0, 0, 0, 0.2, 0.6, 8);
      g.cyl(0, 0, 0, 0.1, 9, 6, true, 0.075);
      g.obox(0, 8.72, 1.2, 0.1, 0.1, 2.5, 0);
      g.col("#3a3e44");
      g.obox(0, 8.62, 2.5, 0.42, 0.2, 0.9, 0);
    }),
    trunk: t((g) => {
      g.col("#5a4632");
      g.cyl(0, 0, 0, 0.17, 3.4, 6, false, 0.12);
    }),
    canopy: t((g) => {
      const ico = new THREE.IcosahedronGeometry(1, 0);
      g.col("#ffffff");
      g.add(
        ico,
        new THREE.Matrix4().compose(
          new THREE.Vector3(0, 5, 0),
          new THREE.Quaternion(),
          new THREE.Vector3(2.3, 1.9, 2.3),
        ),
      );
      g.col("#e8e8e8");
      g.add(
        ico,
        new THREE.Matrix4().compose(
          new THREE.Vector3(0.9, 4.2, 0.5),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 0.7, 0)),
          new THREE.Vector3(1.6, 1.4, 1.6),
        ),
      );
      g.col("#d8d8d8");
      g.add(
        ico,
        new THREE.Matrix4().compose(
          new THREE.Vector3(-0.8, 4.4, -0.6),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 1.7, 0.3)),
          new THREE.Vector3(1.7, 1.5, 1.7),
        ),
      );
      ico.dispose();
    }),
    bench: t((g) => {
      g.col("#7a5234");
      g.box(0, 0.42, 0, 1.7, 0.07, 0.45);
      g.obox(0, 0.52, -0.22, 1.7, 0.42, 0.06, 0);
      g.col("#2a2c30");
      g.box(-0.7, 0, 0, 0.07, 0.42, 0.4);
      g.box(0.7, 0, 0, 0.07, 0.42, 0.4);
    }),
    hydrant: t((g) => {
      g.col("#c8302a");
      g.cyl(0, 0, 0, 0.16, 0.66, 8);
      g.col("#e0e0dc");
      g.cyl(0, 0.66, 0, 0.12, 0.14, 8);
      g.col("#c8302a");
      g.box(0, 0.36, 0, 0.5, 0.12, 0.12);
    }),
    news: t((g) => {
      g.box(0, 0.35, 0, 0.5, 0.75, 0.45);
      g.col("#1e2024");
      g.box(0, 0, 0, 0.08, 0.35, 0.08);
    }),
    meter: t((g) => {
      g.col("#5a5e62");
      g.cyl(0, 0, 0, 0.04, 1.15, 5);
      g.col("#8a9096");
      g.box(0, 1.15, 0, 0.22, 0.34, 0.16);
    }),
    trash: t((g) => {
      g.col("#2e4a36");
      g.cyl(0, 0, 0, 0.3, 0.95, 8);
    }),
    bollard: t((g) => {
      g.col("#26282c");
      g.cyl(0, 0, 0, 0.12, 0.9, 6);
    }),
    dumpster: t((g) => {
      g.box(0, 0.2, 0, 1.2, 1.05, 1.9);
      g.col("#26282c");
      g.box(0, 0, 0.8, 1.1, 0.2, 0.15);
      g.box(0, 0, -0.8, 1.1, 0.2, 0.15);
      g.col("#1e2a24");
      g.obox(-0.05, 1.25, 0, 1.25, 0.08, 1.95, 0);
    }),
    busstop: t((g) => {
      g.col("#3a3e44");
      for (const [x, z] of [
        [-1.8, -0.6],
        [1.8, -0.6],
        [-1.8, 0.6],
        [1.8, 0.6],
      ] as const)
        g.box(x, 0, z, 0.08, 2.5, 0.08);
      g.col("#c9d4da");
      g.box(0, 2.5, 0, 3.9, 0.1, 1.6);
      g.col("#9fb4c0");
      g.box(0, 0.3, -0.62, 3.6, 2.0, 0.04);
      g.col("#7a5234");
      g.box(0, 0.45, -0.35, 2.6, 0.06, 0.4);
    }),
    railing: t((g) => {
      g.col("#f2f2ee");
      g.box(0, 0, 0, 0.1, 1.05, 0.1);
      g.box(1, 1.0, 0, 2, 0.08, 0.1);
      g.box(1, 0.55, 0, 2, 0.06, 0.06);
    }),
    barrier: t((g) => {
      g.box(0, 0, 0, 1.95, 0.3, 0.62);
      g.box(0, 0.3, 0, 1.95, 0.52, 0.3);
      g.col("#9aa0a4");
      g.box(0, 0, 0.9, 0.06, 2.2, 0.06);
      g.box(0, 0.82, 0.9, 1.95, 1.3, 0.03);
    }),
    subway: t((g) => {
      g.col("#141516");
      g.flat(-1.9, -0.95, 1.9, 0.95, 0.17);
      g.col("#2e5a3e");
      g.box(0, 0, -1.0, 4.0, 1.0, 0.08);
      g.box(-1.98, 0, 0, 0.08, 1.0, 2.0);
      g.box(1.98, 0, 0, 0.08, 1.0, 2.0);
      g.box(-1.98, 0, 1.0, 0.1, 2.6, 0.1);
      g.box(1.98, 0, 1.0, 0.1, 2.6, 0.1);
    }),
  };
  return TM;
}

// ---------------------------------------------------------------------------------------
// ground

const G_ASPHALT = 1,
  G_LANE = 2,
  G_WALK = 3,
  G_MEDIAN = 4,
  G_ALLEY = 5,
  G_GRASS = 6,
  G_PATH = 7,
  G_BOARD = 8;
const G_PAVERS = 9,
  G_LOTASPH = 10,
  G_DIRT = 11,
  G_APRON = 12,
  G_GARDEN = 13,
  G_YARD = 14,
  G_UNDER = 15;
/** per ground style: height, colour, and paving (slab texture) vs asphalt noise */
const GROUND: Record<number, { h: number; c: string; pave?: number; paveX?: number }> = {
  [G_ASPHALT]: { h: 0, c: "#3c3e43" },
  [G_LANE]: { h: 0, c: "#434549" },
  [G_WALK]: { h: 0.15, c: "#b8b1a4", pave: 1.5 },
  [G_MEDIAN]: { h: 0.2, c: "#5d7f3c" },
  [G_ALLEY]: { h: 0.02, c: "#333539" },
  [G_GRASS]: { h: 0.12, c: "#5b8a3a" },
  [G_PATH]: { h: 0.13, c: "#c6b28e" },
  [G_BOARD]: { h: 0.35, c: "#9a7650", pave: 0.5, paveX: 4 },
  [G_PAVERS]: { h: 0.15, c: "#cdbfa8", pave: 1 },
  [G_LOTASPH]: { h: 0.03, c: "#46484c" },
  [G_DIRT]: { h: 0.04, c: "#86755c" },
  [G_APRON]: { h: 0.1, c: "#bdbab2", pave: 4 },
  [G_GARDEN]: { h: 0.14, c: "#648a42" },
  [G_YARD]: { h: 0.08, c: "#9c9890" },
  [G_UNDER]: { h: 0.15, c: "#a8a296", pave: 1.5 },
};

function openStyleOf(t: Bld["t"]) {
  switch (t) {
    case "parking":
    case "bigbox":
      return G_LOTASPH;
    case "construction":
    case "empty":
      return G_DIRT;
    case "gas":
      return G_APRON;
    case "court":
      return G_GARDEN;
    case "super":
    case "convention":
    case "civic":
    case "church":
    case "tower":
    case "hotel":
    case "mall":
    case "twin":
    case "pencil":
      return G_PAVERS;
    default:
      return G_YARD;
  }
}

/** street-level height of every 2 m ground cell (roads 0, kerbs and paving 0.15 ...) */
export function groundHeights(city: CityLayout) {
  const g = groundGrid(city);
  const h = new Float32Array(g.length);
  for (let c = 0; c < g.length; c++) h[c] = GROUND[g[c]!]?.h ?? 0;
  return h;
}

function groundGrid(city: CityLayout) {
  const { cells, kind, half } = city;
  const g = new Uint8Array(cells * cells);
  const open = new Uint8Array(cells * cells);
  const toI = (x: number) => Math.round((x + half) / 2);
  for (const b of city.buildings) {
    if (b.backdrop) continue;
    const st = openStyleOf(b.t);
    for (
      let i = Math.max(0, toI(b.x0) - (b.t === "super" || b.t === "convention" ? 20 : 0));
      i < Math.min(cells, toI(b.x1) + (b.t === "super" || b.t === "convention" ? 20 : 0));
      i++
    )
      for (
        let j = Math.max(0, toI(b.z0) - (b.t === "super" ? 40 : b.t === "convention" ? 20 : 0));
        j < Math.min(cells, toI(b.z1) + (b.t === "super" ? 40 : b.t === "convention" ? 20 : 0));
        j++
      )
        if (!open[i * cells + j] || b.t === "super" || b.t === "convention")
          open[i * cells + j] = st;
  }
  for (let c = 0; c < cells * cells; c++) {
    const k = kind[c]!;
    g[c] =
      k === K_ROAD
        ? G_ASPHALT
        : k === K_PARKLANE
          ? G_LANE
          : k === K_WALK
            ? G_WALK
            : k === K_MEDIAN
              ? G_MEDIAN
              : k === K_ALLEY
                ? G_ALLEY
                : k === K_PARK
                  ? G_GRASS
                  : k === K_PATH
                    ? G_PATH
                    : k === K_BOARD
                      ? G_BOARD
                      : k === K_OPEN
                        ? open[c] || G_PAVERS
                        : k === K_LOT
                          ? G_UNDER
                          : G_WALK;
  }
  return g;
}

// ---------------------------------------------------------------------------------------

export function buildCityMeshes(city: CityLayout): CityMeshes {
  const { half, cells } = city;
  const makeGrid = (reach: number, size: number) => {
    const E = Math.ceil(reach / size) * size;
    const n = (E * 2) / size;
    const list: ChunkGeo[] = [];
    for (let a = 0; a < n; a++)
      for (let b = 0; b < n; b++)
        list.push({
          x0: -E + a * size,
          z0: -E + b * size,
          x1: -E + (a + 1) * size,
          z1: -E + (b + 1) * size,
          main: new Geo(),
          detail: new Geo(),
          glow: new Geo(),
          signs: new Geo(),
          pools: new Geo(),
        });
    const at = (x: number, z: number) => {
      const a = Math.max(0, Math.min(n - 1, Math.floor((x + E) / size)));
      const b = Math.max(0, Math.min(n - 1, Math.floor((z + E) / size)));
      return list[a * n + b]!;
    };
    return { list, at };
  };
  const near = makeGrid(half + 40, CHUNK);
  const far = makeGrid(city.extent + 60, FAR_CHUNK);
  const chunks = [...near.list, ...far.list];
  const chunkAt = near.at;
  const beacons: [number, number, number][] = [];
  const drips: [number, number, number, number][] = [];
  const ctxAt = (x: number, z: number, backdrop = false): Ctx => {
    const ch = backdrop ? far.at(x, z) : chunkAt(x, z);
    return {
      main: ch.main,
      detail: ch.detail,
      glow: ch.glow,
      signs: ch.signs,
      beacons,
      drips,
      pools: (p) => {
        ch.pools.col("#fff4e0").mat(0);
        ch.pools.flat(p.x0 - 3, p.z0 - 3, p.x1 + 3, p.z1 + 3, 0.2);
      },
    };
  };

  // ---- buildings ----
  for (const b of city.buildings)
    building(b, ctxAt((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, !!b.backdrop));

  // ---- ground (arena): merged runs along z, curbs where heights step ----
  const grid = groundGrid(city);
  const cc0 = (i: number) => -half + i * 2;
  const H = (c: number) => GROUND[grid[c]!]!.h;
  for (let i = 0; i < cells; i++) {
    let j = 0;
    while (j < cells) {
      const s = grid[i * cells + j]!;
      let j1 = j + 1;
      const chx = chunkAt(cc0(i) + 1, cc0(j) + 1);
      while (j1 < cells && grid[i * cells + j1] === s && chunkAt(cc0(i) + 1, cc0(j1) + 1) === chx)
        j1++;
      const spec = GROUND[s]!;
      const G = chx.main;
      const k = spec.pave ?? 3;
      G.mat(spec.pave ? L.paving : L.ground, 0, 0).col(spec.c);
      const x0 = cc0(i),
        x1 = cc0(i + 1),
        z0 = cc0(j),
        z1 = cc0(j1);
      const kx = spec.paveX ?? k;
      G.flat(x0, z0, x1, z1, spec.h, [x0 / kx, -z1 / k, x1 / kx, -z0 / k]);
      j = j1;
    }
  }
  for (let i = 0; i < cells; i++)
    for (let j = 0; j < cells; j++) {
      const c = i * cells + j;
      const h = H(c);
      const G = chunkAt(cc0(i) + 1, cc0(j) + 1).main;
      if (i + 1 < cells) {
        const h2 = H(c + cells);
        if (Math.abs(h2 - h) > 0.01) {
          G.mat(L.ground, 0, 0).col("#c9c4b8");
          const x = cc0(i + 1);
          if (h > h2) G.wall([x, cc0(j)], [x, cc0(j + 1)], h2, h, [0, 0, 0.6, 0.05]);
          else G.wall([x, cc0(j + 1)], [x, cc0(j)], h, h2, [0, 0, 0.6, 0.05]);
        }
      }
      if (j + 1 < cells) {
        const h2 = H(c + 1);
        if (Math.abs(h2 - h) > 0.01) {
          G.mat(L.ground, 0, 0).col("#c9c4b8");
          const z = cc0(j + 1);
          if (h > h2) G.wall([cc0(i + 1), z], [cc0(i), z], h2, h, [0, 0, 0.6, 0.05]);
          else G.wall([cc0(i), z], [cc0(i + 1), z], h, h2, [0, 0, 0.6, 0.05]);
        }
      }
    }
  // seawall below the boardwalk
  for (let x = -half; x < half; x += CHUNK / 3) {
    const G = chunkAt(x + 1, half - 1).main;
    G.mat(L.panel, 0.3, 0).col("#a8a49a");
    G.wall([Math.min(half, x + CHUNK / 3), half], [x, half], -3, 0.35, [0, 0, CHUNK / 3 / 3, 1]);
  }

  // ---- backdrop ground: street bands as asphalt, blocks as raised pads ----
  const wx = (i: number) => -half + i * 2;
  for (const A of city.bandsX)
    for (const B of city.bandsZ) {
      const inA = A.a >= 0 && A.b <= cells;
      const inB = B.a >= 0 && B.b <= cells;
      if (inA && inB) continue;
      const x0 = wx(A.a),
        x1 = wx(A.b),
        z0 = wx(B.a),
        z1 = wx(B.b);
      if (z0 >= city.waterZ) continue;
      const G = far.at((x0 + x1) / 2, (z0 + z1) / 2).main;
      if (B.kind === "board") {
        // the boardwalk becomes a sand beach either side of the arena
        G.mat(L.ground, 0, 0).col("#d9c9a0");
        G.flat(x0, z0, x1, Math.min(z1, city.waterZ), 0.1, [x0 / 3, -z1 / 3, x1 / 3, -z0 / 3]);
        continue;
      }
      const block = A.kind === "block" && B.kind === "block";
      G.mat(L.ground, 0, 0).col(block ? GROUND[G_WALK]!.c : GROUND[G_ASPHALT]!.c);
      G.flat(x0, z0, x1, Math.min(z1, city.waterZ), block ? 0.15 : 0, [
        x0 / 3,
        -z1 / 3,
        x1 / 3,
        -z0 / 3,
      ]);
      if (block) {
        G.col("#c9c4b8");
        const p = rectPoly(x0, z0, x1, z1);
        for (let k = 0; k < 4; k++) G.wall(p[k]!, p[(k + 1) % 4]!, 0, 0.15, [0, 0, 1, 0.05]);
      }
    }

  // ---- road markings (detail) ----
  markings(city, chunkAt);

  // ---- props ----
  const T = templates();
  const tint = new THREE.Color();
  for (const p of city.props) {
    const ch = chunkAt(p.x, p.z);
    prop(p, ch, T, tint);
  }
  // ---- parked cars ----
  for (const pc of city.parked) car(chunkAt(pc.x, pc.z).detail, pc.v, pc.x, 0, pc.z, pc.rot);

  // ---- traffic signals: mast arms + heads (static), lamps (instanced, driven by the sim) ----
  const lamps = signals(city, chunkAt);

  let verts = 0;
  const out: ChunkMesh[] = chunks.map((c) => {
    verts += c.main.n + c.detail.n + c.glow.n + c.signs.n + c.pools.n;
    return {
      x0: c.x0,
      z0: c.z0,
      x1: c.x1,
      z1: c.z1,
      main: c.main.n ? c.main.build() : null,
      detail: c.detail.n ? c.detail.build() : null,
      glow: c.glow.n ? c.glow.build() : null,
      signs: c.signs.n ? c.signs.build("uv") : null,
      pools: c.pools.n ? c.pools.build("uv") : null,
    };
  });
  return {
    chunks: out.filter((c) => c.main || c.detail || c.glow || c.signs || c.pools),
    beacons,
    lamps,
    drips,
    stats: { verts, buildings: city.buildings.length },
  };
}

function prop(p: Prop, ch: ChunkGeo, T: Tmpls, tint: THREE.Color) {
  const D = ch.detail;
  const y = 0.15;
  switch (p.k) {
    case "light":
    case "lightLED": {
      D.stamp(T.light, p.x, y, p.z, p.rot);
      const s = Math.sin(p.rot);
      const c = Math.cos(p.rot);
      const hx = p.x + s * 2.5;
      const hz = p.z + c * 2.5;
      const sodium = p.k === "light";
      ch.glow.col(sodium ? "#ffb04a" : "#eef4ff").mat(0);
      ch.glow.obox(hx, y + 8.5, hz, 0.3, 0.05, 0.6, p.rot);
      ch.pools.col(sodium ? "#ff8a2a" : "#b8c8f0").mat(0);
      const px = p.x + s * 3.2;
      const pz = p.z + c * 3.2;
      const r = 9;
      ch.pools.flat(px - r, pz - r, px + r, pz + r, 0.2, [0, 0, 1, 1]);
      break;
    }
    case "tree": {
      const s = p.s ?? 1;
      D.mat(L.plain, 0.5, 0).col("#2a2622");
      D.flat(p.x - 0.7, p.z - 0.7, p.x + 0.7, p.z + 0.7, y + 0.03);
      D.stamp(T.trunk, p.x, y, p.z, p.rot, s, s, s);
      tint.set(TREE_T[Math.floor(Math.abs(p.x * 7 + p.z * 13)) % TREE_T.length]!);
      D.stamp(T.canopy, p.x, y, p.z, p.rot, s, s, s, tint);
      break;
    }
    case "palm":
      break; // instanced by species in Palms.tsx
    case "bench":
      D.stamp(T.bench, p.x, y, p.z, p.rot);
      break;
    case "hydrant":
      D.stamp(T.hydrant, p.x, y, p.z, p.rot);
      break;
    case "news":
      tint.set(
        ["#c8302a", "#2a5aa8", "#e8c02a", "#2e7a5a", "#e8e6e0"][
          Math.floor(Math.abs(p.x * 3 + p.z)) % 5
        ]!,
      );
      D.stamp(T.news, p.x, y, p.z, p.rot, 1, 1, 1, tint);
      break;
    case "meter":
      D.stamp(T.meter, p.x, y, p.z, p.rot);
      break;
    case "trash":
      D.stamp(T.trash, p.x, y, p.z, p.rot);
      break;
    case "bollard":
      D.stamp(T.bollard, p.x, y, p.z, p.rot);
      break;
    case "dumpster":
      tint.set(Math.abs(p.z) % 2 < 1 ? "#2e6a4a" : "#2a4a8a");
      D.stamp(T.dumpster, p.x, 0.02, p.z, 0, 1, 1, 1, tint);
      break;
    case "busstop":
      D.stamp(T.busstop, p.x, y, p.z, p.rot);
      break;
    case "railing":
      D.stamp(T.railing, p.x, 0.35, p.z, Math.PI / 2);
      break;
    case "barrier":
      tint.set(Math.floor((p.x + p.z) / 2) % 2 ? "#e8e6e0" : "#d8602a");
      D.stamp(T.barrier, p.x, 0.02, p.z, p.rot, 1, 1, 1, tint);
      break;
    case "subway": {
      D.stamp(T.subway, p.x, 0, p.z, p.rot);
      ch.glow.col("#3aff8a").mat(0);
      ch.glow.box(p.x - 1.98, 2.6, p.z + 1, 0.35, 0.35, 0.35);
      ch.glow.box(p.x + 1.98, 2.6, p.z + 1, 0.35, 0.35, 0.35);
      break;
    }
    case "fountain": {
      const s = p.s ?? 5;
      D.mat(L.plain, 0.5, 0).col("#cfc8b8");
      D.cyl(p.x, 0, p.z, s, 0.7, 24);
      D.col("#6fb4d8");
      D.cyl(p.x, 0.55, p.z, s - 0.35, 0.02, 24);
      D.col("#cfc8b8");
      D.cyl(p.x, 0, p.z, 0.5, 1.8, 10);
      D.cyl(p.x, 1.8, p.z, s * 0.3, 0.3, 16);
      D.col("#8fd0f0");
      D.cyl(p.x, 2.1, p.z, 0.12, 1.2, 6, true, 0.02);
      break;
    }
    case "manhole":
      D.mat(L.plain, 0.5, 0).col("#2a2b2e");
      D.cyl(p.x, 0.005, p.z, 0.4, 0.012, 10);
      break;
    case "drain":
      D.mat(L.plain, 0.5, 0).col("#1e1f22");
      D.flat(p.x - 0.35, p.z - 0.35, p.x + 0.35, p.z + 0.35, 0.012);
      break;
  }
}

function markings(city: CityLayout, chunkAt: (x: number, z: number) => ChunkGeo) {
  const { half } = city;
  const Y = 0.015;
  const strip = (x0: number, z0: number, x1: number, z1: number, col: string) => {
    const G = chunkAt((x0 + x1) / 2, (z0 + z1) / 2).detail;
    G.mat(L.plain, 0.5, 0).col(col);
    G.flat(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), Y);
  };
  const WHITE = "#e6e4dc";
  const YELLOW = "#e0b83a";
  const southEnd = (() => {
    const last = city.roadZ[city.roadZ.length - 1];
    return last ? last.c + CURB[last.cls] : half;
  })();
  // along a road: `along` = 1 for N-S (varying z), 0 for E-W (varying x)
  const road = (R: Road, cross: Road[], alongZ: boolean, lo: number, hi: number) => {
    const cw = CURB[R.cls];
    // map (lateral offset, along position) to world rect
    const rectL = (l0: number, l1: number, a0: number, a1: number, col: string) =>
      alongZ ? strip(R.c + l0, a0, R.c + l1, a1, col) : strip(a0, R.c + l0, a1, R.c + l1, col);
    const stops: number[] = [lo];
    const ends: number[] = [];
    for (const C of cross) {
      ends.push(C.c - CURB[C.cls]);
      stops.push(C.c + CURB[C.cls]);
    }
    ends.push(hi);
    for (let k = 0; k < stops.length; k++) {
      const a = stops[k]!;
      const b = ends[k]!;
      if (b - a < 6) continue;
      const openA = k === 0; // segment starts at the arena wall (no crossing there)
      const openB = k === stops.length - 1;
      const a1 = a + (openA ? 0 : 3.6);
      const b1 = b - (openB ? 0 : 3.6);
      if (R.cls !== "main") {
        rectL(-0.2, -0.08, a1, b1, YELLOW);
        rectL(0.08, 0.2, a1, b1, YELLOW);
      }
      const edge = cw - 2;
      rectL(-edge - 0.06, -edge + 0.06, a1, b1, WHITE);
      rectL(edge - 0.06, edge + 0.06, a1, b1, WHITE);
      const lanes = LANES[R.cls];
      if (lanes.length > 1) {
        const mid = (lanes[0]! + lanes[1]!) / 2;
        for (let s = a1 + 2; s + 3 < b1; s += 9) {
          rectL(-mid - 0.07, -mid + 0.07, s, s + 3, WHITE);
          rectL(mid - 0.07, mid + 0.07, s, s + 3, WHITE);
        }
      }
      // zebra crossings + stop lines at the intersections
      const inner = R.cls === "main" ? 2 : 0;
      if (!openA) {
        for (let l = -cw + 0.6; l < cw - 0.6; l += 1.1) rectL(l, l + 0.55, a + 0.3, a + 3.3, WHITE);
        // traffic heading back towards `a` drives on the side with the negative lateral offset
        // for N-S roads (x = c - off) and positive for E-W roads (z = c + off)
        const side = alongZ ? 1 : -1;
        rectL(side > 0 ? inner : -edge, side > 0 ? edge : -inner, a + 3.5, a + 3.9, WHITE);
      }
      if (!openB) {
        for (let l = -cw + 0.6; l < cw - 0.6; l += 1.1) rectL(l, l + 0.55, b - 3.3, b - 0.3, WHITE);
        const side = alongZ ? -1 : 1;
        rectL(side > 0 ? inner : -edge, side > 0 ? edge : -inner, b - 3.9, b - 3.5, WHITE);
      }
    }
  };
  for (const R of city.roadX) road(R, city.roadZ, true, -half, southEnd);
  for (const R of city.roadZ) road(R, city.roadX, false, -half, half);
}

function signals(city: CityLayout, chunkAt: (x: number, z: number) => ChunkGeo) {
  const lamps: Lamp[] = [];
  const nZ = city.roadZ.length;
  city.roadX.forEach((rx, a) =>
    city.roadZ.forEach((rz, b) => {
      const node = a * nZ + b;
      for (const axis of [0, 1] as const)
        for (const dir of [1, -1] as const) {
          const own = axis === 0 ? rz : rx; // the road we travel along
          const crossR = axis === 0 ? rx : rz;
          const fx = axis === 0 ? dir : 0;
          const fz = axis === 1 ? dir : 0;
          const rX = -fz; // right-hand side of the heading
          const rZ = fx;
          const cx = rx.c;
          const cz = rz.c;
          const ahead = CURB[crossR.cls] + 1.4;
          const px = cx + fx * ahead + rX * (CURB[own.cls] + 1.2);
          const pz = cz + fz * ahead + rZ * (CURB[own.cls] + 1.2);
          const D = chunkAt(px, pz).detail;
          D.mat(L.plain, 0.5, 0).col("#2e3236");
          D.cyl(px, 0.15, pz, 0.15, 7.2, 8);
          const armLen = CURB[own.cls] + 0.6;
          const armRot = Math.atan2(-rX, -rZ);
          D.obox(px - rX * (armLen / 2), 7.0, pz - rZ * (armLen / 2), 0.16, 0.16, armLen, armRot);
          const faceRot = Math.atan2(-fx, -fz);
          for (const off of LANES[own.cls]) {
            const hx = cx + fx * ahead + rX * off;
            const hz = cz + fz * ahead + rZ * off;
            D.col("#1c1e21");
            D.obox(hx, 5.7, hz, 0.42, 1.2, 0.34, faceRot);
            D.box(hx, 6.9, hz, 0.06, 0.2, 0.06);
            ([6.62, 6.3, 5.98] as const).forEach((y, which) =>
              lamps.push({
                x: hx - fx * 0.19,
                y,
                z: hz - fz * 0.19,
                rot: faceRot,
                node,
                axis,
                which: which as 0 | 1 | 2,
              }),
            );
          }
        }
    }),
  );
  return lamps;
}
