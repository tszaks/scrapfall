// Builds Dry Gulch's merged, chunked geometry from the layout (layout.ts). Every building,
// prop, rock face and rail tie goes through one vertex format (cityGeo.ts's Geo) and one
// facade material (a texture array, textures.ts), so a whole 200 m chunk of town draws in
// a handful of calls:
//   main    buildings, rock, rail, signs          (always drawn when in the frustum)
//   detail  props: barrels, wagons, cactus, fences (hidden beyond DETAIL_RANGE: the LOD)
//   glow    lantern flames, forge coals            (unlit, brighter at night)
//   pools   soft light pools on the ground         (night only, additive)
// Buildings are built in a local frame (front facing +z, origin at the front centre) and
// stamped into their chunk, rotated to face the street.
import * as THREE from "three";

import { Geo, type Tmpl } from "../cityGeo";
import {
  BOARD_D,
  DECK_Y,
  RAIL_X,
  STOREY,
  TRESTLE_Y,
  WK,
  fbm,
  type WBld,
  type WesternLayout,
  type WProp,
} from "./layout";
import { FAC_COLS, FAC_ROWS, MODULE_W, TILE_M, WL, signUV } from "./textures";

export const CHUNK = 200;
export const DETAIL_RANGE = 280;

/** aFac.z flags: +1 windows light up at night (random), +2 always lit (saloon), +10 ground AO */
const LIT = 1;
const BRIGHT = 2;
const AO = 10;

type ChunkGeo = {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  main: Geo;
  detail: Geo;
  glow: Geo;
  pools: Geo;
};
export type WChunk = {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  main: THREE.BufferGeometry | null;
  detail: THREE.BufferGeometry | null;
  glow: THREE.BufferGeometry | null;
  pools: THREE.BufferGeometry | null;
};
export type WesternMeshes = {
  chunks: WChunk[];
  /** rolling backdrop terrain beyond the rim and the distant buttes (one geometry) */
  far: THREE.BufferGeometry;
  /** windmill wheels: animated separately */
  windmills: { x: number; y: number; z: number; rot: number; s: number }[];
  /** flickering fires (campfires, the forge) */
  fires: { x: number; y: number; z: number; s: number }[];
  stats: { verts: number };
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

// ---- palette: sun-faded frontier paint ----
const PAINTS = [
  "#efe6d2",
  "#e8dcc0",
  "#d9b77a",
  "#b8563f",
  "#9aa88e",
  "#8a9cab",
  "#cfa452",
  "#d7a088",
  "#c4bcae",
  "#e6d4a6",
];
const TRIMS = ["#f4efe4", "#5a3a26", "#3a3028", "#efe6d2", "#7a2a1e", "#2e3a2e"];
const WOOD = "#a88660";
const DARK_WOOD = "#6a4a30";

// ---------------------------------------------------------------------------------------
// geometry helpers (local frame; Geo.quad takes a, b, c, d counter-clockwise from the front)

/** wall quad from (ax, az) to (bx, bz): the face points to the left of a -> b seen from above
 * rotated... concretely: going +x the face points +z. uv = [u0, v0, u1, v1]. */
function wallq(G: Geo, ax: number, az: number, bx: number, bz: number, y0: number, y1: number, uv: readonly number[]) {
  G.quad(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az, uv);
}
/** plain-layer wall: UVs in metres */
function wallP(G: Geo, layer: number, ax: number, az: number, bx: number, bz: number, y0: number, y1: number, u0 = 0) {
  const [tu, tv] = TILE_M[layer] ?? [4, 4];
  const len = Math.hypot(bx - ax, bz - az);
  G.mat(layer);
  wallq(G, ax, az, bx, bz, y0, y1, [u0 / tu, y0 / tv, (u0 + len) / tu, y1 / tv]);
}
/** facade wall: whole modules across, storeys up */
function wallF(G: Geo, layer: number, ax: number, az: number, bx: number, bz: number, y0: number, y1: number, uOff: number) {
  const len = Math.hypot(bx - ax, bz - az);
  const mods = Math.max(1, Math.round(len / (MODULE_W[layer] ?? 3)));
  G.mat(layer);
  wallq(G, ax, az, bx, bz, y0, y1, [uOff / FAC_COLS, y0 / STOREY / FAC_ROWS, (uOff + mods) / FAC_COLS, y1 / STOREY / FAC_ROWS]);
}
/** axis-aligned box with metre UVs on every face (top optional) */
function boxP(G: Geo, layer: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, top = true, bottom = false) {
  wallP(G, layer, x1, z0, x0, z0, y0, y1);
  wallP(G, layer, x1, z1, x1, z0, y0, y1);
  wallP(G, layer, x0, z1, x1, z1, y0, y1);
  wallP(G, layer, x0, z0, x0, z1, y0, y1);
  const [tu, tv] = TILE_M[layer] ?? [4, 4];
  if (top) G.flat(x0, z0, x1, z1, y1, [x0 / tu, -z1 / tv, x1 / tu, -z0 / tv]);
  if (bottom) G.quad(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1, [0, 0, 1, 1]);
}
/** centred box helper */
function boxC(G: Geo, layer: number, x: number, y0: number, z: number, w: number, h: number, d: number, top = true) {
  boxP(G, layer, x - w / 2, y0, z - d / 2, x + w / 2, y0 + h, z + d / 2, top);
}
/** a box rotated about y, metre UVs */
function oboxP(G: Geo, layer: number, x: number, y0: number, z: number, w: number, h: number, d: number, rot: number, top = true) {
  const s = Math.sin(rot);
  const c = Math.cos(rot);
  const pt = (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c];
  const p = [pt(-w / 2, -d / 2), pt(w / 2, -d / 2), pt(w / 2, d / 2), pt(-w / 2, d / 2)] as const;
  // outline counter-clockwise seen from +y in local space: (-,-) (+,-) (+,+) (-,+); walls b -> a
  wallP(G, layer, p[1][0], p[1][1], p[0][0], p[0][1], y0, y0 + h);
  wallP(G, layer, p[2][0], p[2][1], p[1][0], p[1][1], y0, y0 + h);
  wallP(G, layer, p[3][0], p[3][1], p[2][0], p[2][1], y0, y0 + h);
  wallP(G, layer, p[0][0], p[0][1], p[3][0], p[3][1], y0, y0 + h);
  if (top) {
    const y = y0 + h;
    G.quad(p[3][0], y, p[3][1], p[2][0], y, p[2][1], p[1][0], y, p[1][1], p[0][0], y, p[0][1], [0, 0, w / 2, d / 2]);
  }
}
/** a beam between two points (square section), timber by default */
function beam(G: Geo, ax: number, ay: number, az: number, bx: number, by: number, bz: number, t: number, layer: number = WL.TIMBER) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) return;
  // orthonormal frame round the beam axis
  const f = new THREE.Vector3(dx / len, dy / len, dz / len);
  const up = Math.abs(f.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(f, up).normalize().multiplyScalar(t / 2);
  const v = new THREE.Vector3().crossVectors(u, f).normalize().multiplyScalar(t / 2);
  const corners = [
    [u.x + v.x, u.y + v.y, u.z + v.z],
    [-u.x + v.x, -u.y + v.y, -u.z + v.z],
    [-u.x - v.x, -u.y - v.y, -u.z - v.z],
    [u.x - v.x, u.y - v.y, u.z - v.z],
  ] as const;
  G.mat(layer);
  const tl = len / (TILE_M[layer]?.[0] ?? 2);
  for (let i = 0; i < 4; i++) {
    const p = corners[i]!;
    const q = corners[(i + 1) % 4]!;
    G.quad(ax + q[0], ay + q[1], az + q[2], ax + p[0], ay + p[1], az + p[2], bx + p[0], by + p[1], bz + p[2], bx + q[0], by + q[1], bz + q[2], [0, 0, 0.1, tl]);
  }
}
/** vertical cylinder with metre UVs around (for cactus, posts, barrels) */
function cylP(G: Geo, layer: number, x: number, y0: number, z: number, r0: number, h: number, seg: number, r1 = r0, top = true) {
  G.mat(layer);
  const [tu, tv] = TILE_M[layer] ?? [1, 1];
  const circ = Math.PI * 2 * Math.max(r0, 0.05);
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    const u0 = (i / seg) * circ / tu;
    const u1 = ((i + 1) / seg) * circ / tu;
    G.quad(
      x + Math.cos(a1) * r0, y0, z + Math.sin(a1) * r0,
      x + Math.cos(a0) * r0, y0, z + Math.sin(a0) * r0,
      x + Math.cos(a0) * r1, y0 + h, z + Math.sin(a0) * r1,
      x + Math.cos(a1) * r1, y0 + h, z + Math.sin(a1) * r1,
      [u1, y0 / tv, u0, (y0 + h) / tv],
    );
  }
  if (top && r1 > 0.01) {
    const poly: [number, number][] = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      poly.push([x + Math.cos(a) * r1, z + Math.sin(a) * r1]);
    }
    G.cap(poly, y0 + h);
  }
}
/** a sloped roof plane: ridge edge (r0 -> r1) at height yr, eave edge offset by (ex, ez) at ye */
function slope(G: Geo, layer: number, r0x: number, r0z: number, r1x: number, r1z: number, yr: number, ex: number, ez: number, ye: number) {
  const [tu, tv] = TILE_M[layer] ?? [4, 4];
  const len = Math.hypot(r1x - r0x, r1z - r0z);
  const run = Math.hypot(ex, ez, yr - ye);
  G.mat(layer);
  // a = eave start, b = eave end, c = ridge end, d = ridge start
  G.quad(r0x + ex, ye, r0z + ez, r1x + ex, ye, r1z + ez, r1x, yr, r1z, r0x, yr, r0z, [0, 0, len / tu, run / tv]);
}
/** vertical triangle (gable end) facing the direction of travel's left, see wallq */
function gable(G: Geo, layer: number, ax: number, az: number, bx: number, bz: number, y0: number, apex: number) {
  const [tu, tv] = TILE_M[layer] ?? [4, 4];
  const len = Math.hypot(bx - ax, bz - az);
  G.mat(layer);
  const mx = (ax + bx) / 2;
  const mz = (az + bz) / 2;
  // three vertices with uvs
  const ux = bx - ax;
  const uz = bz - az;
  const nx = -uz / len;
  const nz = ux / len;
  G.v(ax, y0, az, nx, 0, nz, 0, y0 / tv);
  G.v(bx, y0, bz, nx, 0, nz, len / tu, y0 / tv);
  G.v(mx, apex, mz, nx, 0, nz, len / 2 / tu, apex / tv);
}

/** append a three.js geometry through a matrix, with planar UVs (metres / tile) from the
 * transformed position, so rocks and boulders pick up the layer's texture detail */
export function addUV(G: Geo, g: THREE.BufferGeometry, m: THREE.Matrix4, layer: number) {
  const [tu, tv] = TILE_M[layer] ?? [4, 4];
  const src = g.index ? g.toNonIndexed() : g;
  const pos = src.getAttribute("position");
  const nor = src.getAttribute("normal");
  const nm = new THREE.Matrix3().getNormalMatrix(m);
  const p = new THREE.Vector3();
  const q = new THREE.Vector3();
  G.mat(layer);
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(m);
    q.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
    const flat = Math.abs(q.y) > 0.8;
    G.v(p.x, p.y, p.z, q.x, q.y, q.z, flat ? p.x / tu : (p.x + p.z) / tu, flat ? p.z / tu : p.y / tv);
  }
  if (src !== g) src.dispose();
}

// ---------------------------------------------------------------------------------------
// buildings

type BGeo = { main: Geo; detail: Geo; glow: Geo; pools: Geo };
type BOut = { x: number; z: number; rot: number };

const FACADE_OF: Record<WBld["mat"], number> = {
  clap: WL.F_CLAP,
  board: WL.F_BOARD,
  adobe: WL.F_ADOBE,
  brick: WL.F_BRICK,
  stone: WL.F_STONE,
  white: WL.F_CHURCH,
  barn: WL.F_BARN,
  log: WL.F_LOG,
};
const PLAIN_OF: Record<WBld["mat"], number> = {
  clap: WL.P_CLAP,
  board: WL.P_BOARD,
  adobe: WL.P_ADOBE,
  brick: WL.P_BRICK,
  stone: WL.P_STONE,
  white: WL.P_CLAP,
  barn: WL.P_BOARD,
  log: WL.P_LOG,
};

/** lot -> local frame: width along the front, depth back from it, and the world transform */
function frameOf(b: WBld) {
  const W = b.front === 0 || b.front === 2 ? b.x1 - b.x0 : b.z1 - b.z0;
  const D = b.front === 0 || b.front === 2 ? b.z1 - b.z0 : b.x1 - b.x0;
  const cx = (b.x0 + b.x1) / 2;
  const cz = (b.z0 + b.z1) / 2;
  const out: BOut =
    b.front === 2
      ? { x: cx, z: b.z1, rot: 0 }
      : b.front === 0
        ? { x: cx, z: b.z0, rot: Math.PI }
        : b.front === 1
          ? { x: b.x1, z: cz, rot: Math.PI / 2 }
          : { x: b.x0, z: cz, rot: -Math.PI / 2 };
  return { W, D, out };
}

/** a lantern: small glowing box plus a pool of light below (night) */
function lantern(B: BGeo, x: number, y: number, z: number, pool = 5.5) {
  B.detail.col("#2a2420", 1).mat(WL.IRON, 0, 0);
  boxC(B.detail, WL.IRON, x, y - 0.02, z, 0.24, 0.05, 0.24);
  boxC(B.detail, WL.IRON, x, y + 0.36, z, 0.2, 0.06, 0.2);
  B.glow.col("#ffb050");
  B.glow.box(x, y + 0.03, z, 0.17, 0.32, 0.17);
  B.pools.col("#ffb060").mat(0, 0, 0);
  B.pools.flat(x - pool / 2, z - pool / 2, x + pool / 2, z + pool / 2, 0.06);
}

/** sign board with a painted word, facing +z at z, centred at x, bottom at y */
function signBoard(G: Geo, word: number, x: number, y: number, z: number, w: number, h: number, frame = true) {
  if (word < 0) return;
  G.col("#ffffff").mat(WL.SIGNS, 0, 0);
  const uv = signUV(word);
  G.quad(x - w / 2, y, z + 0.06, x + w / 2, y, z + 0.06, x + w / 2, y + h, z + 0.06, x - w / 2, y + h, z + 0.06, uv);
  if (frame) {
    G.col(DARK_WOOD);
    boxP(G, WL.TIMBER, x - w / 2 - 0.08, y - 0.08, z - 0.02, x + w / 2 + 0.08, y + h + 0.08, z + 0.05);
  }
}

/** the false-front parapet: the front wall carried up past the roof, with a cornice */
function falseFront(B: BGeo, b: WBld, W: number, yTop: number, ffTop: number, facL: number, plainL: number, paint: string, trimC: string, r: () => number) {
  const G = B.main;
  const t = 0.22;
  G.col(paint, 1).mat(plainL, b.seed / 1e9, 0);
  const x0 = -W / 2;
  const x1 = W / 2;
  const style = b.ff;
  // outline of the parapet top as a polyline across the width
  const pts: [number, number][] = [];
  if (style === 2) {
    // stepped: three steps up to the middle
    const s = (ffTop - yTop) * 0.28;
    pts.push([x0, ffTop - s * 2], [x0 + W * 0.2, ffTop - s * 2], [x0 + W * 0.2, ffTop - s], [x0 + W * 0.36, ffTop - s], [x0 + W * 0.36, ffTop], [x1 - W * 0.36, ffTop], [x1 - W * 0.36, ffTop - s], [x1 - W * 0.2, ffTop - s], [x1 - W * 0.2, ffTop - s * 2], [x1, ffTop - s * 2]);
  } else if (style === 3) {
    // arched pediment in the middle
    const base = ffTop - (ffTop - yTop) * 0.25;
    pts.push([x0, base]);
    for (let i = 0; i <= 10; i++) {
      const a = (i / 10) * Math.PI;
      const xm = -Math.cos(a) * W * 0.3;
      pts.push([xm, base + Math.sin(a) * (ffTop - base)]);
    }
    pts.push([x1, base]);
  } else pts.push([x0, ffTop], [x1, ffTop]);
  // front face and back face, column strips down to yTop (so any outline works)
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i]!;
    const [bx, by] = pts[i + 1]!;
    if (Math.abs(bx - ax) < 1e-3) {
      // vertical step: a small side face
      const lo = Math.min(ay, by);
      const hi = Math.max(ay, by);
      // the exposed face looks away from the higher side
      if (by > ay) wallP(G, plainL, ax, -t, ax, 0, lo, hi);
      else wallP(G, plainL, ax, 0, ax, -t, lo, hi);
      continue;
    }
    // front (+z), a trapezoid from yTop up to the outline
    const [tu, tv] = TILE_M[plainL] ?? [4, 4];
    G.mat(plainL);
    G.quad(ax, yTop, 0, bx, yTop, 0, bx, by, 0, ax, ay, 0, [ax / tu, yTop / tv, bx / tu, Math.max(ay, by) / tv]);
    G.col("#8a7a66", 1);
    G.mat(WL.P_BOARD);
    G.quad(bx, yTop, -t, ax, yTop, -t, ax, ay, -t, bx, by, -t, [bx / 4, yTop / 4, ax / 4, Math.max(ay, by) / 4]);
    G.col(paint, 1);
    // cap
    G.col(trimC);
    G.mat(WL.TIMBER);
    G.quad(ax, ay, 0.12, bx, by, 0.12, bx, by, -t, ax, ay, -t, [0, 0, 1, 0.1]);
    G.col(paint, 1);
  }
  // side edges of the slab
  wallP(G, plainL, x0, -t, x0, 0, yTop, pts[0]![1]);
  wallP(G, plainL, x1, 0, x1, -t, yTop, pts[pts.length - 1]![1]);
  // cornice: a projecting moulding and brackets under it
  G.col(trimC);
  const cy = style === 1 ? ffTop - 0.35 : Math.min(...pts.map((p) => p[1])) - 0.3;
  boxP(G, WL.TIMBER, x0 - 0.15, cy, -0.05, x1 + 0.15, cy + 0.3, 0.32);
  for (let x = x0 + 0.4; x < x1; x += Math.max(1.1, W / 9)) boxP(G, WL.TIMBER, x - 0.07, cy - 0.35, 0, x + 0.07, cy, 0.26);
  // back bracing struts (seen from behind)
  B.detail.col(DARK_WOOD);
  for (let x = x0 + 1; x < x1 - 0.5; x += 3) beam(B.detail, x, yTop - 0.2, -t - 1.6, x, ffTop - 0.4, -t, 0.1);
  // the sign across the false front
  if (b.sign >= 0) {
    const sw = Math.min(W * 0.82, 9.5);
    const sh = Math.min(1.35, (ffTop - yTop) * 0.55 + 0.4);
    const sy = yTop + (Math.min(...pts.map((p) => p[1])) - yTop - sh) / 2 + 0.05;
    signBoard(G, b.sign, 0, Math.max(yTop - 0.9, sy), 0.02, sw, sh);
  }
  void facL;
  void r;
}

function building(b: WBld, r: () => number): BGeo {
  const B: BGeo = { main: new Geo(), detail: new Geo(), glow: new Geo(), pools: new Geo() };
  const { W, D } = frameOf(b);
  const G = B.main;
  const seed = (b.seed % 1000) / 1000;
  const facL = FACADE_OF[b.mat];
  const plainL = PLAIN_OF[b.mat];
  const paint =
    b.mat === "clap" ? PAINTS[Math.floor(b.tone * PAINTS.length)]! : b.mat === "white" ? "#f6f2ea" : "#ffffff";
  const trimC = b.mat === "clap" ? pick(TRIMS, r) : b.mat === "brick" ? "#d8ccb4" : b.mat === "adobe" ? "#6a4a30" : "#5a4030";
  const lit = b.t === "saloon" || b.t === "opera" ? BRIGHT : b.t === "ruin" || b.t === "tipple" || b.t === "shed" ? 0 : LIT;
  const H = b.storeys * STOREY;
  const uOff = Math.floor(r() * FAC_COLS);
  const x0 = -W / 2;
  const x1 = W / 2;
  const z0 = -D;

  if (b.t === "tent") return tent(B, W, D, r);
  if (b.t === "ruin") return ruin(B, b, W, D, r);
  if (b.t === "church") return church(B, b, W, D, r);
  if (b.t === "smithy") return smithy(B, b, W, D, r);
  if (b.t === "tipple") return tipple(B, b, W, D, r);

  // ---- the walls ----
  G.col(paint, 1).mat(facL, seed, lit + AO);
  wallF(G, facL, x0, 0, x1, 0, 0, H, uOff); // front
  G.mat(plainL, seed, AO);
  wallP(G, plainL, x1, 0, x1, z0, 0, H); // right side
  wallP(G, plainL, x1, z0, x0, z0, 0, H); // back
  wallP(G, plainL, x0, z0, x0, 0, 0, H); // left side
  // windows on the side and back walls, one per bay and storey, cut from the facade tile's
  // upper-storey row (so they match the front)
  {
    const winCol = (k: number) => (b.mat === "barn" ? (k % 2 ? 3 : 0) : (k + uOff) % FAC_COLS);
    const wallWindows = (ax: number, az: number, bx: number, bz: number) => {
      const len = Math.hypot(bx - ax, bz - az);
      const nWin = Math.floor((len - 1.2) / 3.6);
      if (nWin < 1) return;
      const ux = (bx - ax) / len;
      const uz = (bz - az) / len;
      const nx = -uz * 0.03;
      const nz = ux * 0.03;
      G.col(paint, 1).mat(facL, seed, lit + AO);
      for (let st = 0; st < b.storeys; st++) {
        const y0 = st * STOREY + 0.8;
        const y1 = y0 + 2.0;
        for (let k = 0; k < nWin; k++) {
          const tc = ((k + 0.5) / nWin) * len;
          const c = winCol(k + st);
          const uv = [c * 0.25 + 0.05, 0.295, c * 0.25 + 0.2, 0.465] as const;
          const pa = [ax + ux * (tc - 0.75) + nx, az + uz * (tc - 0.75) + nz] as const;
          const pb = [ax + ux * (tc + 0.75) + nx, az + uz * (tc + 0.75) + nz] as const;
          wallq(G, pa[0], pa[1], pb[0], pb[1], y0, y1, uv);
        }
      }
    };
    wallWindows(x1, 0, x1, z0);
    wallWindows(x1, z0, x0, z0);
    wallWindows(x0, z0, x0, 0);
    // a painted advertisement on one tall side wall of the bigger stores
    if (b.storeys >= 2 && D >= 14 && b.sign >= 0 && b.mat !== "adobe") {
      const onRight = (b.seed & 1) === 0;
      const xw = onRight ? x1 + 0.05 : x0 - 0.05;
      const za = onRight ? -1.2 : -D + 1.2;
      const zb = onRight ? -D + 1.2 : -1.2;
      G.col("#ffffff", 0.92).mat(WL.SIGNS, 0, 0);
      wallq(G, xw, za, xw, zb, H - 2.3, H - 0.5, signUV(b.sign));
    }
  }
  // corner boards and a sill plate
  if (b.mat === "clap" || b.mat === "white") {
    G.col(trimC).mat(WL.PAINT, 0, 0);
    for (const [cx, cz] of [
      [x0, 0],
      [x1, 0],
      [x0, z0],
      [x1, z0],
    ] as const)
      boxC(G, WL.PAINT, cx, 0, cz, 0.24, H, 0.24, false);
  }
  if (b.mat === "brick" || b.mat === "stone") {
    G.col(b.mat === "brick" ? "#d8ccb4" : "#b8ac94");
    for (const cx of [x0 + 0.25, x1 - 0.25]) boxP(G, WL.P_STONE, cx - 0.35, 0, -0.1, cx + 0.35, H, 0.22); // pilasters
    boxP(G, WL.P_STONE, x0 - 0.1, 0, -0.1, x1 + 0.1, 0.5, 0.18); // plinth
  }

  // ---- the roof ----
  const eave = 0.45;
  const roofL = b.mat === "adobe" ? WL.P_ADOBE : r() < 0.55 ? WL.TIN : WL.SHINGLE;
  let ridgeY = H;
  if (b.roof === "gable") {
    // ridge runs front to back (the gable faces the street, hidden by the false front)
    const pitch = b.t === "barn" || b.t === "stable" ? 0.75 : 0.5;
    ridgeY = H + (W / 2) * pitch;
    G.col(roofL === WL.TIN ? "#c8c2b8" : "#ffffff", 1);
    slope(G, roofL, 0, 0.3, 0, z0 - eave, ridgeY, x1 + eave, 0, H - eave * pitch); // right slope (ridge from front to back)
    slope(G, roofL, 0, z0 - eave, 0, 0.3, ridgeY, x0 - eave, 0, H - eave * pitch); // left slope
    G.col(paint, 1).mat(plainL, seed, AO);
    gable(G, plainL, x1, z0, x0, z0, H, ridgeY); // back gable
    if (!b.ff) gable(G, plainL, x0, 0, x1, 0, H, ridgeY); // front gable when there is no false front
    // fascia boards on the gable ends (the front one hides behind a false front)
    G.col(DARK_WOOD);
    for (const fz of b.ff ? [z0 - eave] : [0.3, z0 - eave]) {
      beam(G, x1 + eave, H - eave * pitch, fz, 0, ridgeY + 0.05, fz, 0.16);
      beam(G, x0 - eave, H - eave * pitch, fz, 0, ridgeY + 0.05, fz, 0.16);
    }
  } else if (b.roof === "shed") {
    ridgeY = H + 0.9;
    G.col(roofL === WL.TIN ? "#c8c2b8" : "#ffffff", 1);
    slope(G, roofL, x1 + eave, 0.2, x0 - eave, 0.2, ridgeY, 0, z0 - eave - 0.2, H - 0.2);
    G.col(paint, 1).mat(plainL, seed, AO);
    // side triangles
    G.mat(plainL);
    G.v(x1, H, 0, 1, 0, 0, D / 4, H / 4);
    G.v(x1, H, z0, 1, 0, 0, 0, H / 4);
    G.v(x1, ridgeY, 0, 1, 0, 0, D / 4, ridgeY / 4);
    G.v(x0, H, z0, -1, 0, 0, D / 4, H / 4);
    G.v(x0, H, 0, -1, 0, 0, 0, H / 4);
    G.v(x0, ridgeY, 0, -1, 0, 0, 0, ridgeY / 4);
    G.mat(plainL);
    wallq(G, x0, 0, x1, 0, H, ridgeY, [0, H / 4, W / 4, ridgeY / 4]);
  } else if (b.roof === "hip") {
    ridgeY = H + Math.min(W, D) * 0.32;
    const e = b.t === "station" ? 2.6 : 0.6;
    const ey = H - 0.25;
    const ri = Math.min(W, D) / 2;
    G.col("#8a6a58", 1);
    const rx0 = x0 + ri;
    const rx1 = x1 - ri;
    const rz = -D / 2;
    // four slopes: front, back (trapezoids), sides (triangles)
    G.mat(WL.SHINGLE);
    G.quad(x0 - e, ey, e, x1 + e, ey, e, rx1, ridgeY, rz, rx0, ridgeY, rz, [0, 0, (W + 2 * e) / 4, 2]);
    G.quad(x1 + e, ey, z0 - e, x0 - e, ey, z0 - e, rx0, ridgeY, rz, rx1, ridgeY, rz, [0, 0, (W + 2 * e) / 4, 2]);
    G.v(x1 + e, ey, e, 1, 1, 0, 0, 0);
    G.v(x1 + e, ey, z0 - e, 1, 1, 0, (D + 2 * e) / 4, 0);
    G.v(rx1, ridgeY, rz, 1, 1, 0, D / 8, 2);
    G.v(x0 - e, ey, z0 - e, -1, 1, 0, 0, 0);
    G.v(x0 - e, ey, e, -1, 1, 0, (D + 2 * e) / 4, 0);
    G.v(rx0, ridgeY, rz, -1, 1, 0, D / 8, 2);
    // eave soffit (seen from below on the platform)
    G.col("#cfc2a8").mat(WL.P_CLAP);
    G.quad(x0 - e, ey, e, x0 - e, ey, z0 - e, x1 + e, ey, z0 - e, x1 + e, ey, e, [0, 0, W / 4, D / 4]);
    if (b.t === "station") {
      // brackets under the deep eaves, and the name boards on the eaves
      B.detail.col(DARK_WOOD);
      for (let x = x0 + 1; x < x1; x += 3) {
        beam(B.detail, x, 2.2, 0.05, x, ey, e * 0.8, 0.14);
        beam(B.detail, x, 2.2, z0 - 0.05, x, ey, z0 - e * 0.8, 0.14);
      }
      signBoard(G, b.sign, 0, ey - 0.95, e + 0.02, Math.min(W * 0.7, 9), 0.9);
      // bay window (telegraph office) toward the track
      G.col(paint).mat(facL, seed, lit + AO);
      wallF(G, facL, -1.6, 1.1, 1.6, 1.1, 0, 2.9, 1);
      wallP(G, plainL, -1.6, 0, -1.6, 1.1, 0, 2.9);
      wallP(G, plainL, 1.6, 1.1, 1.6, 0, 0, 2.9);
      G.col("#8a6a58");
      boxP(G, WL.SHINGLE, -1.8, 2.9, -0.1, 1.8, 3.05, 1.3);
    }
  } else {
    // flat roof with a parapet (adobe): vigas poke out under the roofline
    ridgeY = H + 0.6;
    G.col(paint, 1).mat(plainL, seed, 0);
    boxP(G, plainL, x0, H, z0, x1, H + 0.6, 0, false);
    G.col("#b8966e");
    G.flat(x0 + 0.3, z0 + 0.3, x1 - 0.3, -0.3, H + 0.35, [0, 0, W / 5, D / 5]);
    B.detail.col("#6a4a30");
    for (let x = x0 + 0.8; x < x1 - 0.5; x += 1.3) cylP(B.detail, WL.TIMBER, x, H - 0.35, 0.3, 0.12, 0.01, 6, 0.12, false);
    for (let x = x0 + 0.8; x < x1 - 0.5; x += 1.3) beam(B.detail, x, H - 0.3, -0.2, x, H - 0.3, 0.55, 0.22);
  }

  // ---- the false front ----
  if (b.ff) {
    const ffTop = Math.max(ridgeY + 0.6, H + 1.8 + (b.storeys === 1 ? 0.6 : 0));
    falseFront(B, b, W, H, ffTop, facL, plainL, paint, trimC, r);
  } else if (b.sign >= 0) {
    // signboard on the wall above the door
    signBoard(G, b.sign, 0, Math.min(H - 1.2, STOREY + 0.1), 0.02, Math.min(W * 0.7, 7), 0.95);
  }

  // ---- porch / balcony over the boardwalk ----
  if (b.porch > 0) {
    const pz = BOARD_D - 0.15;
    const py = STOREY - 0.2;
    const postC = r() < 0.5 ? "#efe6d2" : WOOD;
    const D2 = B.detail;
    D2.col(postC);
    const n = Math.max(2, Math.round(W / 3.2));
    for (let i = 0; i <= n; i++) {
      const x = x0 + 0.15 + ((W - 0.3) * i) / n;
      boxP(D2, WL.TIMBER, x - 0.09, DECK_Y, pz - 0.09, x + 0.09, py, pz + 0.09);
      // curved brackets
      beam(D2, x, py - 0.55, pz, x + (i === n ? -0.4 : 0.4), py - 0.02, pz, 0.07);
    }
    G.col(DARK_WOOD);
    boxP(G, WL.TIMBER, x0, py - 0.25, pz - 0.1, x1, py, pz + 0.1); // beam
    if (b.porch === 1) {
      const roofL2 = r() < 0.6 ? WL.TIN : WL.SHINGLE;
      G.col(roofL2 === WL.TIN ? "#bdb6aa" : "#ffffff");
      slope(G, roofL2, x0 - 0.1, 0, x1 + 0.1, 0, py + 0.55, 0, pz + 0.35, py);
      G.col("#ffffff", 0.55).mat(WL.DECK);
      G.quad(x1 + 0.1, py - 0.02, pz + 0.35, x0 - 0.1, py - 0.02, pz + 0.35, x0 - 0.1, py + 0.53, 0, x1 + 0.1, py + 0.53, 0, [0, 0, W / 4, 1]); // underside
      lantern(B, x0 + W * 0.3, py - 0.6, pz - 0.35);
      if (W > 10) lantern(B, x1 - W * 0.3, py - 0.6, pz - 0.35);
    } else {
      // balcony: a floor on the porch beams with a railing
      G.col("#ffffff", 0.9);
      boxP(G, WL.DECK, x0 - 0.1, py, -0.1, x1 + 0.1, py + 0.18, pz + 0.3);
      const ry = py + 0.18;
      D2.col(postC);
      boxP(D2, WL.TIMBER, x0 - 0.1, ry + 0.95, pz + 0.12, x1 + 0.1, ry + 1.05, pz + 0.26);
      boxP(D2, WL.TIMBER, x0 - 0.1, ry + 0.1, pz + 0.14, x1 + 0.1, ry + 0.16, pz + 0.24);
      for (let x = x0; x <= x1; x += 0.42) boxP(D2, WL.TIMBER, x - 0.03, ry, pz + 0.16, x + 0.03, ry + 0.96, pz + 0.22, false);
      for (const sx of [x0, x1])
        for (let z = 0.3; z < pz; z += 0.42) boxP(D2, WL.TIMBER, sx - 0.03, ry, z - 0.03, sx + 0.03, ry + 0.96, z + 0.03, false);
      boxP(D2, WL.TIMBER, x0 - 0.1, ry + 0.95, 0, x0 + 0.04, ry + 1.05, pz + 0.26);
      boxP(D2, WL.TIMBER, x1 - 0.04, ry + 0.95, 0, x1 + 0.1, ry + 1.05, pz + 0.26);
      lantern(B, x0 + W * 0.25, py - 0.6, pz - 0.3);
      lantern(B, x1 - W * 0.25, py - 0.6, pz - 0.3);
      lantern(B, 0, ry + 1.6, 0.35, 3);
      // hanging shingle sign under the balcony
      if (b.t !== "saloon" && b.sign >= 0) {
        signBoard(B.detail, b.sign, x1 - 1.6, py - 1.05, pz - 1.2, 2.4, 0.5, false);
      }
    }
  }
  // ---- the boardwalk deck in front ----
  if (b.t !== "house" && b.t !== "shack" && b.t !== "adobe" && b.t !== "ranch" && b.t !== "barn" && b.t !== "shed") {
    const dx0 = x0 - 1;
    const dx1 = x1 + 1;
    G.col("#ffffff", 0.95);
    G.mat(WL.DECK);
    G.quad(dx0, DECK_Y, BOARD_D, dx1, DECK_Y, BOARD_D, dx1, DECK_Y, 0, dx0, DECK_Y, 0, [0, 0, (dx1 - dx0) / 4, BOARD_D / 4]);
    G.col(DARK_WOOD);
    boxP(G, WL.TIMBER, dx0, 0, BOARD_D - 0.12, dx1, DECK_Y, BOARD_D, false); // edge beam
    boxP(G, WL.TIMBER, dx0, 0, 0, dx0 + 0.1, DECK_Y, BOARD_D, false);
  } else if (b.porch > 0) {
    // houses: a small porch on posts
    G.col("#ffffff", 0.9);
    G.mat(WL.DECK);
    G.quad(x0 + 0.5, 0.35, 2.2, x1 - 0.5, 0.35, 2.2, x1 - 0.5, 0.35, 0, x0 + 0.5, 0.35, 0, [0, 0, (W - 1) / 4, 0.55]);
    G.col(DARK_WOOD);
    boxP(G, WL.TIMBER, x0 + 0.5, 0, 2.05, x1 - 0.5, 0.35, 2.2, false);
    const D2 = B.detail;
    D2.col("#e8dcc0");
    for (const x of [x0 + 0.6, 0, x1 - 0.6]) boxP(D2, WL.TIMBER, x - 0.07, 0.35, 2.0, x + 0.07, 2.7, 2.14);
    G.col("#bdb6aa");
    slope(G, WL.TIN, x0 + 0.3, 0, x1 - 0.3, 0, 3.0, 0, 2.4, 2.65);
    lantern(B, 0.8, 2.2, 1.9, 4);
  }

  // ---- chimneys and stove pipes ----
  if (b.t === "house" || b.t === "ranch" || b.t === "shack") {
    if (b.t === "ranch" || r() < 0.4) {
      G.col("#a89a86");
      boxP(G, WL.P_STONE, x1 - 1.4, 0, z0 - 0.9, x1 - 0.2, ridgeY + 1, z0 + 0.3);
    } else {
      B.detail.col("#3a3634");
      cylP(B.detail, WL.IRON, x0 + W * 0.3, ridgeY - 0.8, z0 * 0.6, 0.12, 1.8, 6);
    }
  }
  // ---- per-type extras ----
  if (b.t === "saloon") {
    // batwing doors in the middle bay, a big lit glow spilling out at night
    B.detail.col("#7a3a22");
    boxP(B.detail, WL.TIMBER, -0.75, 0.9, 0.06, -0.04, 2.0, 0.12);
    boxP(B.detail, WL.TIMBER, 0.04, 0.9, 0.06, 0.75, 2.0, 0.12);
    G.col("#1c140e").mat(WL.PAINT, 0, 0);
    G.quad(-0.85, DECK_Y, 0.03, 0.85, DECK_Y, 0.03, 0.85, 2.5, 0.03, -0.85, 2.5, 0.03, [0, 0, 0.1, 0.1]);
    B.glow.col("#ff9a40", 0.55);
    B.glow.quad(-0.8, DECK_Y, 0.035, 0.8, DECK_Y, 0.035, 0.8, 2.45, 0.035, -0.8, 2.45, 0.035);
    B.pools.col("#ffa050").mat(0, 0, 0);
    B.pools.flat(-4, 0.2, 4, 9, 0.07);
  }
  if (b.t === "bank") {
    // a heavy cornice with dentils, stone steps, gilt lettering plaque
    G.col("#d8ccb4");
    boxP(G, WL.P_STONE, x0 - 0.3, H - 0.1, -0.35, x1 + 0.3, H + 0.45, 0.35);
    for (let x = x0; x < x1; x += 0.5) boxP(G, WL.P_STONE, x, H - 0.3, 0, x + 0.25, H - 0.1, 0.25);
    boxP(G, WL.P_STONE, -2.2, 0, 0, 2.2, 0.18, 0.9);
    boxP(G, WL.P_STONE, -2.2, 0, 0, 2.2, 0.36, 0.5);
  }
  if (b.t === "sheriff") {
    // the JAIL plaque on the side, a star over the door
    G.col("#ffffff");
    const uv = signUV(21);
    G.mat(WL.SIGNS);
    G.quad(x1 + 0.05, 1.6, -D * 0.25, x1 + 0.05, 1.6, -D * 0.25 - 3.2, x1 + 0.05, 2.4, -D * 0.25 - 3.2, x1 + 0.05, 2.4, -D * 0.25, uv);
    B.detail.col("#d8b040").mat(WL.PAINT, 0, 0);
    B.detail.cone(0, 2.75, 0.1, 0.35, 0.02, 5);
    oboxP(B.detail, WL.PAINT, 0, 2.55, 0.08, 0.5, 0.5, 0.04, 0);
  }
  if (b.t === "stable" || b.t === "barn") {
    // hay hood over the loft door
    G.col("#8a2a1c");
    boxP(G, WL.P_BOARD, -1.4, H + 0.9, 0, 1.4, H + 1.05, 1.2);
    B.detail.col(WOOD);
    beam(B.detail, 0, H + 1.05, 1.2, 0, H + 1.6, 0, 0.18);
    if (b.sign >= 0) signBoard(G, b.sign, 0, H - 0.8, 0.03, Math.min(6, W * 0.4), 0.8);
  }
  if (b.t === "opera") {
    // round window in the pediment
    B.glow.col("#ffc070", 0.4);
    B.glow.cyl(0, H + 0.2, 0.05, 0.01, 0.01, 8);
  }
  return B;
}

function tent(B: BGeo, W: number, D: number, r: () => number): BGeo {
  const G = B.main;
  const h = 2.6 + r() * 0.6;
  const x0 = -W / 2;
  const x1 = W / 2;
  const z0 = -D;
  G.col("#ffffff", 0.95 - r() * 0.1).mat(WL.CANVAS, r(), 0);
  // the two slopes (ridge along the depth), flaps out at the front
  slope(G, WL.CANVAS, 0, 0.2, 0, z0 - 0.2, h, x1 + 0.2, 0, 0.35);
  slope(G, WL.CANVAS, 0, z0 - 0.2, 0, 0.2, h, x0 - 0.2, 0, 0.35);
  gable(G, WL.CANVAS, x1 + 0.1, z0, x0 - 0.1, z0, 0, h);
  // front: two triangles with a dark opening
  G.mat(WL.CANVAS);
  G.v(x0 - 0.1, 0, 0, 0, 0, 1, 0, 0);
  G.v(-0.5, 0, 0, 0, 0, 1, 0.3, 0);
  G.v(0, h, 0, 0, 0, 1, 0.5, 1);
  G.v(0.5, 0, 0, 0, 0, 1, 0.6, 0);
  G.v(x1 + 0.1, 0, 0, 0, 0, 1, 1, 0);
  G.v(0, h, 0, 0, 0, 1, 0.5, 1);
  G.col("#1a120c").mat(WL.PAINT);
  G.v(-0.5, 0, 0, 0, 0, 1, 0, 0);
  G.v(0.5, 0, 0, 0, 0, 1, 0, 0);
  G.v(0, h - 0.4, 0, 0, 0, 1, 0, 0);
  B.detail.col(DARK_WOOD);
  beam(B.detail, 0, 0, 0.1, 0, h + 0.2, 0.1, 0.07);
  beam(B.detail, 0, h, 0.1, 0, h, z0 - 0.1, 0.06);
  beam(B.detail, x1 + 0.2, 0.35, 0.15, x1 + 0.9, 0, 0.6, 0.03);
  beam(B.detail, x0 - 0.2, 0.35, 0.15, x0 - 0.9, 0, 0.6, 0.03);
  if (r() < 0.6) {
    B.detail.col("#3a3634");
    cylP(B.detail, WL.IRON, x1 * 0.5, h * 0.5, z0 * 0.5, 0.07, 1.8, 6);
  }
  // a lamp glowing through the canvas at night
  B.glow.col("#ffb060", 0.25);
  B.glow.quad(-0.45, 0.02, 0.01, 0.45, 0.02, 0.01, 0, h - 0.45, 0.01, 0, h - 0.45, 0.01);
  return B;
}

function ruin(B: BGeo, b: WBld, W: number, D: number, r: () => number): BGeo {
  const G = B.main;
  G.col("#ffffff", 0.95).mat(WL.P_ADOBE, 0.3, 0);
  const walls: [number, number, number, number][] = [
    [-W / 2, 0, W / 2, 0],
    [W / 2, 0, W / 2, -D],
    [W / 2, -D, -W / 2, -D],
    [-W / 2, -D, -W / 2, 0],
  ];
  for (const [ax, az, bx, bz] of walls) {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.ceil(len / 1.5);
    for (let i = 0; i < n; i++) {
      if (r() < 0.18) continue; // collapsed
      const t0 = i / n;
      const t1 = (i + 1) / n;
      const h = 0.6 + r() * 2.6;
      const px0 = ax + (bx - ax) * t0;
      const pz0 = az + (bz - az) * t0;
      const px1 = ax + (bx - ax) * t1;
      const pz1 = az + (bz - az) * t1;
      const nx = -(bz - az) / len;
      const nz = (bx - ax) / len;
      const th = 0.45;
      wallP(G, WL.P_ADOBE, px0, pz0, px1, pz1, 0, h);
      wallP(G, WL.P_ADOBE, px1 - nx * th, pz1 - nz * th, px0 - nx * th, pz0 - nz * th, 0, h);
      G.quad(px0, h, pz0, px1, h, pz1, px1 - nx * th, h, pz1 - nz * th, px0 - nx * th, h, pz0 - nz * th, [0, 0, 0.3, 0.1]);
    }
  }
  void b;
  return B;
}

function church(B: BGeo, b: WBld, W: number, D: number, r: () => number): BGeo {
  // local: nave W wide (12), D deep (20), front at z = 0; the bell tower stands in front
  const G = B.main;
  const seed = 0.77;
  const H = 5.6;
  const x0 = -W / 2;
  const x1 = W / 2;
  const z0 = -D;
  G.col("#f6f2ea").mat(WL.F_CHURCH, seed, LIT + AO);
  wallF(G, WL.F_CHURCH, x1, 0, x1, z0, 0, H, 0);
  wallF(G, WL.F_CHURCH, x0, z0, x0, 0, 0, H, 0);
  G.mat(WL.P_CLAP, seed, AO);
  wallP(G, WL.P_CLAP, x1, z0, x0, z0, 0, H);
  wallP(G, WL.P_CLAP, x0, 0, x1, 0, 0, H);
  const ridge = H + (W / 2) * 1.0;
  G.col("#6a5a4e");
  slope(G, WL.SHINGLE, 0, 0.4, 0, z0 - 0.4, ridge, x1 + 0.4, 0, H - 0.4);
  slope(G, WL.SHINGLE, 0, z0 - 0.4, 0, 0.4, ridge, x0 - 0.4, 0, H - 0.4);
  G.col("#f6f2ea").mat(WL.P_CLAP, seed, AO);
  gable(G, WL.P_CLAP, x0, 0, x1, 0, H, ridge);
  gable(G, WL.P_CLAP, x1, z0, x0, z0, H, ridge);
  // the bell tower: square shaft, open belfry with the bell, a tall spire and a cross
  const tw = 4.6;
  const tz0 = -0.6;
  const tz1 = tz0 + tw;
  const tx0 = -tw / 2;
  const tx1 = tw / 2;
  const shaft = 14.5;
  G.col("#f6f2ea").mat(WL.P_CLAP, seed, AO);
  wallP(G, WL.P_CLAP, tx0, tz1, tx1, tz1, 0, shaft);
  wallP(G, WL.P_CLAP, tx1, tz1, tx1, tz0, 0, shaft);
  wallP(G, WL.P_CLAP, tx0, tz0, tx0, tz1, 0, shaft);
  // the door and a round window
  G.col("#5a2e1c").mat(WL.PAINT, 0, 0);
  G.quad(-0.85, 0, tz1 + 0.02, 0.85, 0, tz1 + 0.02, 0.85, 2.9, tz1 + 0.02, -0.85, 2.9, tz1 + 0.02, [0, 0, 1, 1]);
  G.col("#f4efe4");
  boxP(G, WL.PAINT, -1.1, 2.9, tz1, 1.1, 3.2, tz1 + 0.12);
  G.col("#ffffff").mat(WL.F_CHURCH, seed, LIT);
  G.quad(-0.8, 6.2, tz1 + 0.02, 0.8, 6.2, tz1 + 0.02, 0.8, 9.6, tz1 + 0.02, -0.8, 9.6, tz1 + 0.02, [0.33 / 4 + 0.0, 0.3 / 4, 0.67 / 4, 1.7 / 4]);
  // steps
  G.col("#b8ac94");
  boxP(G, WL.P_STONE, -1.6, 0, tz1, 1.6, 0.16, tz1 + 1.2);
  boxP(G, WL.P_STONE, -1.6, 0, tz1, 1.6, 0.32, tz1 + 0.6);
  // belfry: corner posts, rail, open arches, the bell
  const by0 = shaft;
  const by1 = shaft + 3.6;
  G.col("#f6f2ea");
  boxP(G, WL.P_CLAP, tx0 - 0.2, by0 - 0.3, tz0 - 0.2, tx1 + 0.2, by0 + 0.1, tz1 + 0.2);
  for (const [cx, cz] of [
    [tx0 + 0.25, tz0 + 0.25],
    [tx1 - 0.25, tz0 + 0.25],
    [tx0 + 0.25, tz1 - 0.25],
    [tx1 - 0.25, tz1 - 0.25],
  ] as const)
    boxC(G, WL.P_CLAP, cx, by0, cz, 0.5, by1 - by0, 0.5);
  for (const side of [0, 1, 2, 3]) {
    const along = side % 2 === 0;
    const zz = side === 0 ? tz0 + 0.1 : tz1 - 0.1;
    const xx = side === 1 ? tx1 - 0.1 : tx0 + 0.1;
    if (along) boxP(G, WL.P_CLAP, tx0, by0 + 0.1, zz - 0.08, tx1, by0 + 1.0, zz + 0.08);
    else boxP(G, WL.P_CLAP, xx - 0.08, by0 + 0.1, tz0, xx + 0.08, by0 + 1.0, tz1);
  }
  boxP(G, WL.P_CLAP, tx0 - 0.25, by1, tz0 - 0.25, tx1 + 0.25, by1 + 0.5, tz1 + 0.25);
  B.detail.col("#8a6a2a").mat(WL.IRON, 0, 0);
  cylP(B.detail, WL.IRON, 0, by0 + 1.3, (tz0 + tz1) / 2, 0.75, 1.3, 10, 0.35);
  beam(B.detail, -1.6, by0 + 2.75, (tz0 + tz1) / 2, 1.6, by0 + 2.75, (tz0 + tz1) / 2, 0.2);
  // spire
  G.col("#5e5048").mat(WL.SHINGLE, 0, 0);
  const sy = by1 + 0.5;
  const spireH = 7.2;
  const cx = 0;
  const cz = (tz0 + tz1) / 2;
  const rr = tw / 2 + 0.1;
  for (let i = 0; i < 4; i++) {
    const a0 = Math.PI / 4 + (i / 4) * Math.PI * 2;
    const a1 = Math.PI / 4 + ((i + 1) / 4) * Math.PI * 2;
    const R = rr * Math.SQRT2;
    const p0x = cx + Math.cos(a0) * R;
    const p0z = cz + Math.sin(a0) * R;
    const p1x = cx + Math.cos(a1) * R;
    const p1z = cz + Math.sin(a1) * R;
    G.v(p1x, sy, p1z, 0, 0.3, 0, 0, 0);
    G.v(p0x, sy, p0z, 0, 0.3, 0, 1, 0);
    G.v(cx, sy + spireH, cz, 0, 0.3, 0, 0.5, 2);
  }
  G.col("#2a2420").mat(WL.IRON);
  boxC(G, WL.IRON, cx, sy + spireH - 0.1, cz, 0.12, 1.6, 0.12);
  boxC(G, WL.IRON, cx, sy + spireH + 0.85, cz, 0.8, 0.12, 0.12);
  // the churchyard: a few graves behind, a lantern at the door
  lantern(B, 1.3, 2.4, tz1 + 0.25, 5);
  lantern(B, -1.3, 2.4, tz1 + 0.25, 5);
  void b;
  void r;
  return B;
}

function smithy(B: BGeo, b: WBld, W: number, D: number, r: () => number): BGeo {
  const G = B.main;
  const x0 = -W / 2;
  const x1 = W / 2;
  const z0 = -D;
  const H = 3.6;
  // three closed walls, an open front on posts
  G.col("#ffffff").mat(WL.P_BOARD, 0.4, AO);
  wallP(G, WL.P_BOARD, x1, 0, x1, z0, 0, H);
  wallP(G, WL.P_BOARD, x1, z0, x0, z0, 0, H);
  wallP(G, WL.P_BOARD, x0, z0, x0, 0, 0, H);
  wallP(G, WL.P_BOARD, x0, -0.2, x0, z0, 0, H); // inner faces
  wallP(G, WL.P_BOARD, x0, z0 + 0.2, x1, z0 + 0.2, 0, H);
  wallP(G, WL.P_BOARD, x1, z0, x1, -0.2, 0, H);
  G.col("#6a5a4a").mat(WL.YARD);
  G.flat(x0, z0, x1, 0, 0.03, [0, 0, W / 8, D / 8]);
  const ridge = H + 1.8;
  G.col("#b0a89a");
  slope(G, WL.TIN, 0, 0.8, 0, z0 - 0.4, ridge, x1 + 0.4, 0, H - 0.2);
  slope(G, WL.TIN, 0, z0 - 0.4, 0, 0.8, ridge, x0 - 0.4, 0, H - 0.2);
  G.col("#ffffff").mat(WL.P_BOARD);
  gable(G, WL.P_BOARD, x1, z0, x0, z0, H, ridge);
  gable(G, WL.P_BOARD, x0, 0, x1, 0, H, ridge);
  G.col("#8a6a4a");
  for (const x of [x0 + 0.2, x0 + W / 3, x1 - W / 3, x1 - 0.2]) boxP(G, WL.TIMBER, x - 0.12, 0, -0.12, x + 0.12, H, 0.12);
  boxP(G, WL.TIMBER, x0, H - 0.35, -0.15, x1, H, 0.15);
  signBoard(G, b.sign, 0, H + 0.2, 0.18, Math.min(W * 0.7, 6), 0.8);
  // the forge: a brick hearth with glowing coals, a chimney through the roof
  const fz = z0 + 2.2;
  G.col("#ffffff");
  boxP(G, WL.P_BRICK, -1.6, 0, fz - 1.2, 1.6, 0.95, fz + 1.2);
  boxP(G, WL.P_BRICK, -0.7, 0.95, fz - 1.1, 0.7, ridge + 1.4, fz - 0.1);
  B.glow.col("#ff6a1a");
  B.glow.box(0, 0.95, fz + 0.3, 2.2, 0.08, 1.4);
  B.pools.col("#ff7a30").mat(0, 0, 0);
  B.pools.flat(-4, z0 + 0.5, 4, 3, 0.06);
  // tools on the wall, a quench trough
  B.detail.col("#3a3634");
  for (let i = 0; i < 6; i++) beam(B.detail, x0 + 0.1, 1.6 + r() * 0.8, z0 + 1 + i * 0.5, x0 + 0.1, 1.0 + r() * 0.4, z0 + 1 + i * 0.5, 0.05, WL.IRON);
  B.detail.col(WOOD);
  boxP(B.detail, WL.TIMBER, 2.2, 0, fz - 0.4, 3.8, 0.7, fz + 0.4);
  return B;
}

function tipple(B: BGeo, b: WBld, W: number, D: number, r: () => number): BGeo {
  // a timber ore bin on stilts with a chute
  const G = B.main;
  const x0 = -W / 2;
  const x1 = W / 2;
  const z0 = -D;
  const y0 = 3.2;
  const y1 = y0 + 3.4;
  G.col("#ffffff").mat(WL.P_BOARD, 0.3, 0);
  boxP(G, WL.P_BOARD, x0, y0, z0, x1, y1, 0, false);
  G.col("#b0a89a");
  slope(G, WL.TIN, x1 + 0.3, 0.3, x0 - 0.3, 0.3, y1 + 1.2, 0, z0 - 0.6, y1);
  G.col("#ffffff").mat(WL.P_BOARD);
  G.v(x1, y1, 0, 1, 0, 0, 1, 0);
  G.v(x1, y1, z0, 1, 0, 0, 0, 0);
  G.v(x1, y1 + 1.2, 0.3, 1, 0, 0, 1, 0.3);
  G.v(x0, y1, z0, -1, 0, 0, 1, 0);
  G.v(x0, y1, 0, -1, 0, 0, 0, 0);
  G.v(x0, y1 + 1.2, 0.3, -1, 0, 0, 0, 0.3);
  const D2 = B.detail;
  D2.col(DARK_WOOD);
  for (const [px, pz] of [
    [x0 + 0.3, -0.3],
    [x1 - 0.3, -0.3],
    [x0 + 0.3, z0 + 0.3],
    [x1 - 0.3, z0 + 0.3],
    [0, -0.3],
    [0, z0 + 0.3],
  ] as const)
    boxP(D2, WL.TIMBER, px - 0.15, 0, pz - 0.15, px + 0.15, y0, pz + 0.15);
  beam(D2, x0 + 0.3, 0.3, -0.3, x1 - 0.3, y0 - 0.2, -0.3, 0.12);
  beam(D2, x1 - 0.3, 0.3, z0 + 0.3, x0 + 0.3, y0 - 0.2, z0 + 0.3, 0.12);
  // chute toward the track
  G.col("#ffffff");
  G.mat(WL.P_BOARD);
  G.quad(0.8, y0 + 0.2, 0.2, -0.8, y0 + 0.2, 0.2, -0.8, y0 - 1.4, 2.6, 0.8, y0 - 1.4, 2.6, [0, 0, 0.4, 0.7]);
  signBoard(G, b.sign, 0, y1 - 1.3, 0.02, Math.min(W * 0.8, 5), 0.8);
  void r;
  return B;
}

// ---------------------------------------------------------------------------------------
// prop templates (local space, origin at the base centre, +z = front)

type PKey = WProp["k"] | "wheelL";
let TM: Partial<Record<PKey, { d: Tmpl; g?: Tmpl; p?: Tmpl }>> | null = null;

function templates() {
  if (TM) return TM;
  const T: Partial<Record<PKey, { d: Tmpl; g?: Tmpl; p?: Tmpl }>> = {};
  const r = mulberry(99);
  const make = (k: PKey, f: (d: Geo, g: Geo, p: Geo) => void) => {
    const d = new Geo();
    const g = new Geo();
    const p = new Geo();
    d.mat(WL.TIMBER, 0.5, 0);
    f(d, g, p);
    T[k] = { d: d.freeze(), ...(g.n ? { g: g.freeze() } : {}), ...(p.n ? { p: p.freeze() } : {}) };
  };
  const barrel = (d: Geo, x: number, y: number, z: number) => {
    d.col("#9a6a3e");
    cylP(d, WL.TIMBER, x, y, z, 0.28, 0.45, 10, 0.32, false);
    cylP(d, WL.TIMBER, x, y + 0.45, z, 0.32, 0.45, 10, 0.28);
    d.col("#3a3634");
    cylP(d, WL.IRON, x, y + 0.12, z, 0.3, 0.06, 10, 0.31, false);
    cylP(d, WL.IRON, x, y + 0.75, z, 0.31, 0.06, 10, 0.3, false);
  };
  const crate = (d: Geo, x: number, y: number, z: number, s: number, rot: number) => {
    d.col(pick(["#b89468", "#a8845a", "#c4a070"], r));
    oboxP(d, WL.TIMBER, x, y, z, s, s, s, rot);
    d.col("#7a5a3a");
    oboxP(d, WL.TIMBER, x, y + s * 0.45, z, s + 0.02, s * 0.1, s + 0.02, rot, false);
  };
  const wheel = (d: Geo, x: number, y: number, z: number, rad: number, axisX: boolean) => {
    // rim ring + spokes, standing up, the axle along x (or z)
    d.col("#5a3e28");
    const seg = 14;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      const p0 = [Math.cos(a0) * rad, Math.sin(a0) * rad];
      const p1 = [Math.cos(a1) * rad, Math.sin(a1) * rad];
      if (axisX) beam(d, x, y + p0[1]!, z + p0[0]!, x, y + p1[1]!, z + p1[0]!, 0.08);
      else beam(d, x + p0[0]!, y + p0[1]!, z, x + p1[0]!, y + p1[1]!, z, 0.08);
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI;
      const c = Math.cos(a) * rad;
      const s = Math.sin(a) * rad;
      if (axisX) beam(d, x, y - s, z - c, x, y + s, z + c, 0.04);
      else beam(d, x - c, y - s, z, x + c, y + s, z, 0.04);
    }
    d.col("#2a2420");
    if (axisX) beam(d, x - 0.12, y, z, x + 0.12, y, z, 0.16, WL.IRON);
    else beam(d, x, y, z - 0.12, x, y, z + 0.12, 0.16, WL.IRON);
  };
  const wagonBed = (d: Geo) => {
    // bed along local z (length 4), wheels on both sides
    d.col("#8a6a48");
    boxP(d, WL.TIMBER, -0.75, 0.8, -1.9, 0.75, 0.95, 1.9);
    d.col("#9a7a52");
    boxP(d, WL.TIMBER, -0.78, 0.95, -1.9, -0.72, 1.45, 1.9);
    boxP(d, WL.TIMBER, 0.72, 0.95, -1.9, 0.78, 1.45, 1.9);
    boxP(d, WL.TIMBER, -0.78, 0.95, -1.95, 0.78, 1.45, -1.89);
    boxP(d, WL.TIMBER, -0.78, 0.95, 1.89, 0.78, 1.45, 1.95);
    d.col("#6a4a30");
    boxP(d, WL.TIMBER, -0.6, 1.45, 1.2, 0.6, 1.55, 1.7); // seat
    wheel(d, -0.9, 0.6, -1.3, 0.6, true);
    wheel(d, 0.9, 0.6, -1.3, 0.6, true);
    wheel(d, -0.9, 0.45, 1.3, 0.45, true);
    wheel(d, 0.9, 0.45, 1.3, 0.45, true);
    d.col("#6a4a30");
    beam(d, 0, 0.55, 1.9, 0, 0.35, 3.6, 0.1); // tongue
  };
  make("barrel", (d) => barrel(d, 0, 0, 0));
  make("barrels", (d) => {
    barrel(d, -0.35, 0, 0);
    barrel(d, 0.35, 0, 0.1);
    barrel(d, 0, 0, -0.55);
    barrel(d, 0, 0.9, -0.2);
  });
  make("crate", (d) => crate(d, 0, 0, 0, 0.8, 0));
  make("crates", (d) => {
    crate(d, -0.45, 0, 0, 0.8, 0.1);
    crate(d, 0.45, 0, 0.1, 0.75, -0.1);
    crate(d, 0, 0.8, 0.05, 0.7, 0.3);
    crate(d, 0.1, 0, -0.8, 0.6, 0.5);
  });
  make("wagon", (d) => wagonBed(d));
  make("covered", (d) => {
    wagonBed(d);
    // canvas bonnet: arched hoops with a cloth skin
    d.col("#ffffff", 0.96);
    const seg = 8;
    const R = 1.05;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI;
      const a1 = ((i + 1) / seg) * Math.PI;
      const y0 = 1.3 + Math.sin(a0) * R * 1.05;
      const y1 = 1.3 + Math.sin(a1) * R * 1.05;
      const x0 = Math.cos(a0) * R * 0.85;
      const x1 = Math.cos(a1) * R * 0.85;
      d.mat(WL.CANVAS);
      d.quad(x1, y1, -1.75, x0, y0, -1.75, x0, y0, 1.6, x1, y1, 1.6, [a1, 0, a0, 1.1]);
      d.quad(x0, y0, -1.75, x1, y1, -1.75, x1, y1, 1.6, x0, y0, 1.6, [a0, 0, a1, 1.1]);
    }
  });
  make("trough", (d) => {
    d.col("#8a6a48");
    boxP(d, WL.TIMBER, -1.2, 0.2, -0.4, 1.2, 0.75, 0.4);
    d.col("#5a7a80");
    d.mat(WL.PAINT);
    d.flat(-1.1, -0.3, 1.1, 0.3, 0.68, [0, 0, 1, 1]);
    d.col("#6a4a30");
    boxP(d, WL.TIMBER, -1.1, 0, -0.35, -0.9, 0.2, 0.35);
    boxP(d, WL.TIMBER, 0.9, 0, -0.35, 1.1, 0.2, 0.35);
  });
  make("hitch", (d) => {
    d.col("#7a5a3a");
    boxP(d, WL.TIMBER, -0.5, 0, -0.07, -0.36, 1.05, 0.07);
    boxP(d, WL.TIMBER, 0.36, 0, -0.07, 0.5, 1.05, 0.07);
    beam(d, -0.55, 1.0, 0, 0.55, 1.0, 0, 0.1);
  });
  make("saguaro", (d) => {
    d.col("#ffffff");
    const h = 6;
    cylP(d, WL.CACTUS, 0, 0, 0, 0.32, h - 0.3, 10, 0.3, false);
    d.mat(WL.CACTUS);
    d.cone(0, h - 0.3, 0, 0.3, 0.4, 10, 0);
    // arms: out, then up
    const arms: [number, number, number][] = [
      [0.6, 2.6, 1.6],
      [3.6, 3.3, 1.2],
      [2.0, 2.2, 1.9],
    ];
    for (const [a, y, len] of arms) {
      const ox = Math.cos(a);
      const oz = Math.sin(a);
      cylP(d, WL.CACTUS, ox * 0.35, y, oz * 0.35, 0.2, 0.01, 8, 0.2, false);
      beam(d, ox * 0.2, y, oz * 0.2, ox * 0.9, y + 0.3, oz * 0.9, 0.36, WL.CACTUS);
      cylP(d, WL.CACTUS, ox * 0.9, y + 0.25, oz * 0.9, 0.2, len, 8, 0.19, false);
      d.mat(WL.CACTUS);
      d.cone(ox * 0.9, y + 0.25 + len, oz * 0.9, 0.19, 0.25, 8, 0);
    }
  });
  make("pear", (d) => {
    // prickly pear: flat oval pads stacked in a clump
    const pads: [number, number, number, number][] = [];
    for (let i = 0; i < 9; i++) pads.push([(r() - 0.5) * 1.1, 0.2 + r() * 0.8, (r() - 0.5) * 1.1, r() * 3]);
    for (const [x, y, z, a] of pads) {
      d.col(pick(["#6f8f4a", "#7f9a52", "#5f7f3e"], r));
      oboxP(d, WL.CACTUS, x, y, z, 0.48, 0.55, 0.1, a);
      if (r() < 0.4) {
        d.col("#d84a6a");
        boxC(d, WL.PAINT, x, y + 0.55, z, 0.09, 0.08, 0.09);
      }
    }
  });
  make("barrelcactus", (d) => {
    d.col("#ffffff");
    cylP(d, WL.CACTUS, 0, 0, 0, 0.3, 0.45, 10, 0.34, false);
    cylP(d, WL.CACTUS, 0, 0.45, 0, 0.34, 0.2, 10, 0.2);
    d.col("#f0c040");
    boxC(d, WL.PAINT, 0, 0.65, 0, 0.18, 0.06, 0.18);
  });
  make("bush", (d) => {
    // sagebrush / creosote: a clump of grey-green blobs
    for (let i = 0; i < 5; i++) {
      d.col(pick(["#8a8a62", "#7a8058", "#9a9468", "#6e7650"], r));
      const x = (r() - 0.5) * 0.9;
      const z = (r() - 0.5) * 0.9;
      const rad = 0.25 + r() * 0.3;
      const ico = new THREE.IcosahedronGeometry(rad, 0);
      d.mat(WL.PAINT);
      d.add(ico, new THREE.Matrix4().makeTranslation(x, rad * 0.8, z).multiply(new THREE.Matrix4().makeScale(1, 0.75, 1)));
      ico.dispose();
    }
  });
  make("boulder", (d) => {
    const ico = new THREE.IcosahedronGeometry(1, 1);
    const pos = ico.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const k = 0.75 + fbm(x * 2 + 3, z * 2 + y, 5) * 0.55;
      pos.setXYZ(i, x * k * 1.05, Math.max(-0.2, y) * k * 0.8, z * k);
    }
    ico.computeVertexNormals();
    d.col("#e0b090");
    addUV(d, ico, new THREE.Matrix4().makeTranslation(0, 0.25, 0), WL.ROCK);
    ico.dispose();
  });
  make("deadtree", (d) => {
    d.col("#7a6a5a");
    const limb = (x: number, y: number, z: number, a: number, e: number, len: number, t: number, depth: number) => {
      const ex = x + Math.cos(a) * Math.cos(e) * len;
      const ey = y + Math.sin(e) * len;
      const ez = z + Math.sin(a) * Math.cos(e) * len;
      beam(d, x, y, z, ex, ey, ez, t);
      if (depth > 0)
        for (let k = 0; k < 2; k++) limb(ex, ey, ez, a + (r() - 0.5) * 1.8, e - 0.1 + (r() - 0.5) * 0.6, len * 0.65, t * 0.62, depth - 1);
    };
    limb(0, 0, 0, 0, Math.PI / 2 - 0.08, 2.4, 0.3, 3);
  });
  make("fence", (d) => {
    // split rail: a post and three rails, 2.5 m long along x
    d.col("#8a7258");
    boxP(d, WL.TIMBER, -0.08, 0, -0.08, 0.08, 1.35, 0.08);
    d.col("#9a8266");
    for (const y of [0.4, 0.8, 1.2]) beam(d, -1.25, y, 0, 1.25, y + (r() - 0.5) * 0.06, 0, 0.1);
  });
  make("grave", (d) => {
    d.col("#a8a090");
    boxP(d, WL.P_STONE, -0.3, 0, -0.08, 0.3, 0.75, 0.08);
    d.col("#8a6a4a").mat(WL.YARD);
    d.flat(-0.4, 0.1, 0.4, 1.9, 0.12, [0, 0, 0.2, 0.3]);
  });
  make("cross", (d) => {
    d.col("#b8a88c");
    boxP(d, WL.TIMBER, -0.05, 0, -0.04, 0.05, 1.1, 0.04);
    boxP(d, WL.TIMBER, -0.3, 0.72, -0.04, 0.3, 0.82, 0.04);
    d.col("#8a6a4a").mat(WL.YARD);
    d.flat(-0.4, 0.1, 0.4, 1.9, 0.12, [0, 0, 0.2, 0.3]);
  });
  make("pole", (d) => {
    d.col("#6a5a4a");
    cylP(d, WL.TIMBER, 0, 0, 0, 0.13, 7.5, 6, 0.1);
    boxP(d, WL.TIMBER, -0.1, 6.9, -0.9, 0.1, 7.05, 0.9);
    d.col("#6a8a9a");
    for (const z of [-0.75, -0.3, 0.3, 0.75]) boxC(d, WL.PAINT, 0, 7.05, z, 0.07, 0.14, 0.07);
  });
  make("lantern", (d, g, p) => {
    // hung under a porch roof: the height comes from the prop's `a`
    d.col("#2a2420");
    boxC(d, WL.IRON, 0, -0.02, 0, 0.24, 0.05, 0.24);
    boxC(d, WL.IRON, 0, 0.36, 0, 0.2, 0.06, 0.2);
    g.col("#ffb050");
    g.box(0, 0.03, 0, 0.17, 0.32, 0.17);
    p.col("#ffb060").mat(0, 0, 0);
    void p;
  });
  make("streetlamp", (d, g) => {
    d.col("#3a3430");
    cylP(d, WL.IRON, 0, 0, 0, 0.09, 3.3, 6, 0.06);
    boxC(d, WL.IRON, 0, 3.3, 0, 0.36, 0.06, 0.36);
    d.cone(0, 3.8, 0, 0.3, 0.3, 4);
    g.col("#ffb050");
    g.box(0, 3.36, 0, 0.26, 0.44, 0.26);
  });
  make("hay", (d) => {
    d.col("#d8b868");
    boxP(d, WL.YARD, -0.6, 0, -0.4, 0.6, 0.5, 0.4);
    boxP(d, WL.YARD, -0.5, 0.5, -0.35, 0.6, 1.0, 0.4);
  });
  make("cart", (d) => {
    d.col("#6a5a4a");
    boxP(d, WL.TIMBER, -0.6, 0.55, -1.2, 0.6, 0.65, 1.2);
    wheel(d, -0.7, 0.4, 0, 0.4, true);
    wheel(d, 0.7, 0.4, 0, 0.4, true);
    crate(d, 0, 0.65, -0.5, 0.6, 0.2);
    crate(d, 0.05, 0.65, 0.35, 0.55, -0.1);
  });
  make("anvil", (d) => {
    d.col("#6a4a30");
    cylP(d, WL.TIMBER, 0, 0, 0, 0.3, 0.55, 8);
    d.col("#2a2826");
    boxP(d, WL.IRON, -0.12, 0.55, -0.15, 0.12, 0.75, 0.15);
    boxP(d, WL.IRON, -0.18, 0.75, -0.35, 0.18, 0.92, 0.3);
    d.cone(0, 0.83, -0.35, 0.1, 0.01, 4);
  });
  make("well", (d) => {
    d.col("#b0a48e");
    cylP(d, WL.P_STONE, 0, 0, 0, 1.0, 0.85, 10, 1.0, false);
    d.col("#1a1410").mat(WL.PAINT);
    d.flat(-0.8, -0.8, 0.8, 0.8, 0.8, [0, 0, 1, 1]);
    d.col("#7a5a3a");
    boxP(d, WL.TIMBER, -1.0, 0, -0.08, -0.84, 2.3, 0.08);
    boxP(d, WL.TIMBER, 0.84, 0, -0.08, 1.0, 2.3, 0.08);
    beam(d, -1.0, 2.1, 0, 1.0, 2.1, 0, 0.12);
    d.col("#9a8a6a");
    slope(d, WL.SHINGLE, -1.3, 0, 1.3, 0, 2.8, 0, 1.1, 2.2);
    slope(d, WL.SHINGLE, 1.3, 0, -1.3, 0, 2.8, 0, -1.1, 2.2);
    d.col("#6a4a30");
    cylP(d, WL.TIMBER, 0.2, 1.3, 0.1, 0.18, 0.3, 8);
  });
  make("campfire", (d, g, p) => {
    d.col("#8a8074");
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      boxC(d, WL.P_STONE, Math.cos(a) * 0.65, 0, Math.sin(a) * 0.65, 0.28, 0.2, 0.28);
    }
    d.col("#4a3020");
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      beam(d, Math.cos(a) * 0.5, 0.08, Math.sin(a) * 0.5, 0, 0.45, 0, 0.12);
    }
    g.col("#ff8a2a");
    g.cone(0, 0.08, 0, 0.35, 0.8, 5, 0);
    g.col("#ffd060");
    g.cone(0, 0.08, 0, 0.18, 0.5, 5, 0.6);
    p.col("#ff8a3a").mat(0, 0, 0);
    p.flat(-5, -5, 5, 5, 0.05);
  });
  make("wheel", (d) => {
    wheel(d, 0, 0.62, 0, 0.6, false);
  });
  make("bench", (d) => {
    d.col("#8a6a48");
    boxP(d, WL.TIMBER, -0.8, 0.42, -0.2, 0.8, 0.48, 0.2);
    boxP(d, WL.TIMBER, -0.8, 0.5, -0.24, 0.8, 0.9, -0.2);
    for (const x of [-0.7, 0.7]) boxP(d, WL.TIMBER, x - 0.05, 0, -0.2, x + 0.05, 0.42, 0.2);
  });
  make("tumble", (d) => {
    d.col("#a8905e");
    const ico = new THREE.IcosahedronGeometry(0.45, 1);
    d.mat(WL.PAINT);
    d.add(ico, new THREE.Matrix4().makeTranslation(0, 0.42, 0));
    ico.dispose();
    d.col("#8a7448");
    for (let i = 0; i < 8; i++) {
      const a = r() * 6.28;
      const e = (r() - 0.5) * 2;
      beam(d, 0, 0.42, 0, Math.cos(a) * 0.55, 0.42 + e * 0.3, Math.sin(a) * 0.55, 0.03);
    }
  });
  make("bones", (d) => {
    d.col("#ece4d2").mat(WL.PAINT);
    boxP(d, WL.PAINT, -0.18, 0, -0.25, 0.18, 0.2, 0.2);
    beam(d, -0.15, 0.15, -0.2, -0.55, 0.35, -0.3, 0.06);
    beam(d, 0.15, 0.15, -0.2, 0.55, 0.35, -0.3, 0.06);
    for (let i = 0; i < 5; i++) beam(d, -0.3, 0.05, 0.5 + i * 0.18, 0.3, 0.15, 0.5 + i * 0.18, 0.04);
  });
  make("tank", (d) => {
    d.col("#7a7a78");
    cylP(d, WL.IRON, 0, 0, 0, 2.2, 0.9, 16, 2.2, false);
    d.col("#4a6a70").mat(WL.PAINT);
    d.flat(-1.5, -1.5, 1.5, 1.5, 0.8, [0, 0, 1, 1]);
  });
  make("crossbuck", (d) => {
    d.col("#e8e2d4");
    cylP(d, WL.PAINT, 0, 0, 0, 0.08, 3.6, 6);
    d.col("#f2ece0");
    oboxP(d, WL.PAINT, 0, 2.9, 0.1, 2.2, 0.28, 0.05, 0);
    d.col("#2a2420");
    beam(d, -0.8, 2.65, 0.13, 0.8, 3.35, 0.13, 0.26, WL.PAINT);
    beam(d, -0.8, 3.35, 0.13, 0.8, 2.65, 0.13, 0.26, WL.PAINT);
  });
  make("orecart", (d) => {
    d.col("#4a4440");
    boxP(d, WL.IRON, -0.6, 0.35, -0.9, 0.6, 1.2, 0.9);
    d.col("#6a5a50").mat(WL.ROCK);
    d.flat(-0.55, -0.85, 0.55, 0.85, 1.12, [0, 0, 0.1, 0.1]);
    d.col("#2a2420");
    for (const [x, z] of [
      [-0.6, -0.55],
      [0.6, -0.55],
      [-0.6, 0.55],
      [0.6, 0.55],
    ] as const)
      beam(d, x - 0.06, 0.22, z, x + 0.06, 0.22, z, 0.44, WL.IRON);
  });
  make("woodpile", (d) => {
    d.col("#9a7a52");
    for (let row = 0; row < 4; row++)
      for (let i = 0; i < 7 - row; i++) {
        const x = -1.05 + i * 0.32 + row * 0.16;
        cylP(d, WL.TIMBER, x, 0, 0, 0.001, 0.001, 3, 0.001, false);
        beam(d, x, 0.15 + row * 0.27, -0.5, x, 0.15 + row * 0.27, 0.5, 0.28);
      }
  });
  make("outhouse", (d) => {
    d.col("#ffffff").mat(WL.P_BOARD);
    boxP(d, WL.P_BOARD, -0.7, 0, -0.7, 0.7, 2.2, 0.7, false);
    d.col("#b0a89a");
    slope(d, WL.TIN, 0.9, 0.9, -0.9, 0.9, 2.5, 0, -1.8, 2.1);
    d.col("#1a120c").mat(WL.PAINT);
    d.quad(-0.08, 1.7, 0.72, 0.08, 1.7, 0.72, 0.08, 1.9, 0.72, -0.08, 1.9, 0.72, [0, 0, 1, 1]); // the moon
  });
  make("windmill", (d) => {
    // steel lattice tower, a platform; the wheel is animated separately
    d.col("#6a6a68");
    const H = 11;
    const legs: [number, number][] = [
      [-1.4, -1.4],
      [1.4, -1.4],
      [1.4, 1.4],
      [-1.4, 1.4],
    ];
    for (const [x, z] of legs) beam(d, x, 0, z, x * 0.18, H, z * 0.18, 0.1, WL.IRON);
    for (let y = 1.5; y < H; y += 2.2) {
      const k0 = 1 - (y / H) * 0.82;
      const k1 = 1 - ((y + 2.2) / H) * 0.82;
      for (let i = 0; i < 4; i++) {
        const [ax, az] = legs[i]!;
        const [bx, bz] = legs[(i + 1) % 4]!;
        beam(d, ax * k0, y, az * k0, bx * k1, Math.min(H, y + 2.2), bz * k1, 0.05, WL.IRON);
        beam(d, ax * k0, y, az * k0, bx * k0, y, bz * k0, 0.05, WL.IRON);
      }
    }
    d.col("#7a5a3a");
    boxP(d, WL.TIMBER, -0.6, H - 0.2, -0.6, 0.6, H, 0.6);
    d.col("#7a7a78");
    boxP(d, WL.IRON, -0.2, H, -0.5, 0.2, H + 0.5, 0.5);
    // tail vane
    d.col("#b0a89a");
    beam(d, 0, H + 0.25, -0.4, 0, H + 0.4, -2.6, 0.08, WL.IRON);
    oboxP(d, WL.TIN, 0, H - 0.1, -2.8, 0.04, 1.1, 1.4, 0);
  });
  make("watertower", (d) => {
    // timber trestle legs, a staved tank with iron hoops, a conical roof and the spout
    const legH = 9.5;
    const R = 3.1;
    d.col("#7a5e44");
    for (const [x, z] of [
      [-2.4, -2.4],
      [2.4, -2.4],
      [2.4, 2.4],
      [-2.4, 2.4],
    ] as const) {
      beam(d, x * 1.15, 0, z * 1.15, x * 0.9, legH, z * 0.9, 0.34);
    }
    for (let y = 2; y < legH; y += 3.2) {
      beam(d, -2.7, y, -2.7, 2.7, y + 3, -2.7, 0.12);
      beam(d, 2.7, y, -2.7, -2.7, y + 3, -2.7, 0.12);
      beam(d, -2.7, y, 2.7, 2.7, y + 3, 2.7, 0.12);
      beam(d, 2.7, y, 2.7, -2.7, y + 3, 2.7, 0.12);
      beam(d, -2.7, y, -2.7, -2.7, y + 3, 2.7, 0.12);
      beam(d, 2.7, y, -2.7, 2.7, y + 3, 2.7, 0.12);
    }
    d.col("#8a6a4a");
    boxP(d, WL.TIMBER, -3.4, legH, -3.4, 3.4, legH + 0.3, 3.4);
    d.col("#9a7650");
    cylP(d, WL.P_BOARD, 0, legH + 0.3, 0, R, 4.6, 18, R, false);
    d.col("#2a2826");
    for (const y of [0.6, 1.8, 3.0, 4.2]) cylP(d, WL.IRON, 0, legH + 0.3 + y, 0, R + 0.04, 0.12, 18, R + 0.04, false);
    d.col("#6a5a4a");
    d.mat(WL.SHINGLE);
    d.cone(0, legH + 4.9, 0, R + 0.3, 1.6, 18, 0);
    d.col("#6a5a4a");
    boxP(d, WL.SHINGLE, -R - 0.3, legH + 4.85, -R - 0.3, R + 0.3, legH + 4.95, R + 0.3, false);
    // the spout swings out toward the track (+x)
    d.col("#3a3634");
    beam(d, R - 0.2, legH + 1.2, 0, R + 3.2, legH - 0.9, 0, 0.36, WL.IRON);
    beam(d, R + 3.2, legH - 0.9, 0, R + 3.2, legH - 2.2, 0, 0.3, WL.IRON);
    // ladder
    d.col("#6a5a4a");
    beam(d, -2.5, 0, 2.9, -2.2, legH, 2.6, 0.08);
    beam(d, -1.9, 0, 2.9, -1.7, legH, 2.6, 0.08);
  });
  make("arch", (d) => {
    // a natural sandstone arch: two legs and a curved span
    const ico = new THREE.IcosahedronGeometry(1, 1);
    d.col("#f0b890");
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * Math.PI;
      const x = Math.cos(a) * 9;
      const y = Math.sin(a) * 11;
      const s = i === 0 || i === 12 ? 3.2 : 2.2 - Math.sin(a) * 0.6;
      addUV(d, ico, new THREE.Matrix4().makeTranslation(x, y + 1, 0).multiply(new THREE.Matrix4().makeScale(s, s * 0.9, s * 1.1)), WL.ROCK);
    }
    ico.dispose();
  });
  make("sign", (d) => {
    d.col("#7a5a3a");
    boxP(d, WL.TIMBER, -0.08, 0, -0.08, 0.08, 2.2, 0.08);
  });
  TM = T;
  return T;
}

// ---------------------------------------------------------------------------------------
// rock: a heightfield on the 2 m cell corners (min of the four cells, so rock never
// spills onto walkable cells), terraced into sandstone ledges

function rockMesh(L: WesternLayout, chunkAt: (x: number, z: number) => ChunkGeo) {
  const { cells, half, rock } = L;
  const n = cells + 1;
  const hv = new Float32Array(n * n);
  const cellH = (i: number, j: number) => {
    const ci = Math.max(0, Math.min(cells - 1, i));
    const cj = Math.max(0, Math.min(cells - 1, j));
    return rock[ci * cells + cj]!;
  };
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      hv[i * n + j] = Math.min(cellH(i - 1, j - 1), cellH(i, j - 1), cellH(i - 1, j), cellH(i, j));
  // crumbly faces: noise on the steep parts only, so mesa tops and ledges stay flat
  const raw = hv.slice();
  const R = (i: number, j: number) => raw[Math.max(0, Math.min(n - 1, i)) * n + Math.max(0, Math.min(n - 1, j))]!;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const h = raw[i * n + j]!;
      if (h <= 0) continue;
      const steep = Math.max(Math.abs(R(i + 1, j) - h), Math.abs(R(i - 1, j) - h), Math.abs(R(i, j + 1) - h), Math.abs(R(i, j - 1) - h));
      const k = Math.min(1, steep / 5);
      const x = -half + i * 2;
      const z = -half + j * 2;
      hv[i * n + j] = h + (fbm(x * 0.21, z * 0.21, 91) - 0.5) * Math.min(3.5, h * 0.25) * k;
    }
  const H = (i: number, j: number) => hv[Math.max(0, Math.min(n - 1, i)) * n + Math.max(0, Math.min(n - 1, j))]!;
  const _n = new THREE.Vector3();
  const norm = (i: number, j: number) => {
    _n.set(H(i - 1, j) - H(i + 1, j), 4, H(i, j - 1) - H(i, j + 1)).normalize();
    return _n;
  };
  const [tu, tv] = TILE_M[WL.ROCK]!;
  for (let i = 0; i < cells; i++)
    for (let j = 0; j < cells; j++) {
      const h00 = H(i, j);
      const h10 = H(i + 1, j);
      const h01 = H(i, j + 1);
      const h11 = H(i + 1, j + 1);
      if (h00 + h10 + h01 + h11 <= 0) continue;
      const x0 = -half + i * 2;
      const z0 = -half + j * 2;
      const G = chunkAt(x0 + 1, z0 + 1).main;
      G.mat(WL.ROCK, 0.5, 0);
      const vtx = (ii: number, jj: number, h: number, top: boolean) => {
        const x = -half + ii * 2;
        const z = -half + jj * 2;
        const nn = norm(ii, jj);
        if (top) {
          // flat mesa tops and ledges: red-brown grit, not strata
          const k = 0.55 + Math.min(0.2, h / 90);
          G.colLinear(k * 1.05, k * 0.62, k * 0.46);
          G.v(x, h, z, nn.x, nn.y, nn.z, x / 9, z / 9);
          return;
        }
        // darker at the foot and in the clefts, sun-bleached higher up
        const k = 0.72 + Math.min(0.32, h / 60) + nn.y * 0.1;
        G.colLinear(k * 1.0, k * 0.93, k * 0.88);
        G.v(x, h, z, nn.x, nn.y, nn.z, (x + z * 0.7) / tu, h / tv);
      };
      const tri = (a: [number, number, number], b: [number, number, number], c: [number, number, number]) => {
        // face normal decides the material for the whole triangle (layers can't blend)
        const ux = (b[0] - a[0]) * 2;
        const uy = b[2] - a[2];
        const uz = (b[1] - a[1]) * 2;
        const wx = (c[0] - a[0]) * 2;
        const wy = c[2] - a[2];
        const wz = (c[1] - a[1]) * 2;
        const ny = uz * wx - ux * wz;
        const nl = Math.hypot(uy * wz - uz * wy, ny, ux * wy - uy * wx) || 1;
        const top = Math.abs(ny) / nl > 0.72 && Math.min(a[2], b[2], c[2]) > 1.2;
        G.mat(top ? WL.SAND : WL.ROCK, 0.5, 0);
        vtx(a[0], a[1], a[2], top);
        vtx(b[0], b[1], b[2], top);
        vtx(c[0], c[1], c[2], top);
      };
      // split along the flatter diagonal
      if (Math.abs(h00 - h11) < Math.abs(h10 - h01)) {
        tri([i, j, h00], [i, j + 1, h01], [i + 1, j + 1, h11]);
        tri([i, j, h00], [i + 1, j + 1, h11], [i + 1, j, h10]);
      } else {
        tri([i, j, h00], [i, j + 1, h01], [i + 1, j, h10]);
        tri([i + 1, j, h10], [i, j + 1, h01], [i + 1, j + 1, h11]);
      }
    }
  return hv;
}

/** the land beyond the rim (rolling desert and mesas), plus distant buttes on the horizon */
function farTerrain(L: WesternLayout, hv: Float32Array) {
  const G = new Geo();
  const { half, cells } = L;
  const n = cells + 1;
  const edgeH = (x: number, z: number) => {
    const i = Math.round((Math.max(-half, Math.min(half, x)) + half) / 2);
    const j = Math.round((Math.max(-half, Math.min(half, z)) + half) / 2);
    return hv[Math.max(0, Math.min(n - 1, i)) * n + Math.max(0, Math.min(n - 1, j))]!;
  };
  const S = 16;
  const R = 1400;
  const hAt = (x: number, z: number) => {
    const e = Math.max(Math.abs(x), Math.abs(z));
    if (e <= half) return edgeH(x, z);
    const t = (e - half) / 520;
    const base = edgeH(x, z);
    const mesa = fbm(x * 0.004, z * 0.004, 311, 4);
    const tall = mesa > 0.56 ? 40 + (mesa - 0.56) * 260 : 0;
    const roll = fbm(x * 0.012, z * 0.012, 312) * 10;
    const m = Math.max(0, 1 - t);
    return base * m * m + Math.max(roll * (1 - m), Math.min(90, tall) * (1 - m * m));
  };
  const [tu, tv] = TILE_M[WL.ROCK]!;
  const nG = Math.round((R * 2) / S);
  const hs = new Float32Array((nG + 1) * (nG + 1));
  for (let a = 0; a <= nG; a++) for (let b = 0; b <= nG; b++) hs[a * (nG + 1) + b] = hAt(-R + a * S, -R + b * S);
  const Hs = (a: number, b: number) => hs[Math.max(0, Math.min(nG, a)) * (nG + 1) + Math.max(0, Math.min(nG, b))]!;
  const _n = new THREE.Vector3();
  for (let a = 0; a < nG; a++)
    for (let b = 0; b < nG; b++) {
      const x0 = -R + a * S;
      const z0 = -R + b * S;
      if (x0 >= -half && x0 + S <= half && z0 >= -half && z0 + S <= half) continue;
      const rockTri = Math.max(Hs(a, b), Hs(a + 1, b), Hs(a, b + 1), Hs(a + 1, b + 1)) > 6;
      G.mat(rockTri ? WL.ROCK : WL.SAND, 0.3, 0);
      const v = (aa: number, bb: number) => {
        const x = -R + aa * S;
        const z = -R + bb * S;
        const h = Hs(aa, bb);
        _n.set(Hs(aa - 1, bb) - Hs(aa + 1, bb), S * 2, Hs(aa, bb - 1) - Hs(aa, bb + 1)).normalize();
        const k = rockTri ? 0.85 + Math.min(0.2, h / 200) : 0.95;
        if (rockTri) G.colLinear(k, k * 0.92, k * 0.86);
        else G.colLinear(k, k * 0.97, k * 0.94);
        G.v(x, h, z, _n.x, _n.y, _n.z, rockTri ? (x + z * 0.7) / tu : x / 9, rockTri ? h / tv : z / 9);
      };
      v(a, b);
      v(a, b + 1);
      v(a + 1, b + 1);
      v(a, b);
      v(a + 1, b + 1);
      v(a + 1, b);
    }
  // Monument Valley buttes on the horizon: sheer-sided towers on talus skirts
  const r = mulberry(4242);
  const buttes: [number, number, number, number][] = [];
  for (let k = 0; k < 34; k++) {
    const a = r() * Math.PI * 2;
    // the sunset side (west) and the moon side (east) get the most
    const bias = r() < 0.6 ? (r() < 0.5 ? Math.PI : 0) + (r() - 0.5) * 1.4 : a;
    const d = 1500 + r() * 2300;
    buttes.push([Math.cos(bias) * d, Math.sin(bias) * d, 50 + r() * 110, 60 + r() * 170]);
  }
  for (const [bx, bz, h, rad] of buttes) {
    const seg = 14;
    const skirt = h * 0.35;
    const pts: [number, number, number][] = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const rr = rad * (0.65 + fbm(Math.cos(a) * 2 + bx, Math.sin(a) * 2, 77) * 0.7);
      pts.push([Math.cos(a) * rr, Math.sin(a) * rr, rr]);
    }
    G.mat(WL.ROCK, 0.2, 0);
    for (let i = 0; i < seg; i++) {
      const p = pts[i]!;
      const q = pts[(i + 1) % seg]!;
      const sp = 1.6;
      // talus skirt
      G.colLinear(0.8, 0.72, 0.66);
      G.quad(bx + q[0] * sp, 0, bz + q[1] * sp, bx + p[0] * sp, 0, bz + p[1] * sp, bx + p[0], skirt, bz + p[1], bx + q[0], skirt, bz + q[1], [0, 0, 4, 1]);
      // sheer walls
      G.colLinear(0.95, 0.86, 0.8);
      G.quad(bx + q[0], skirt, bz + q[1], bx + p[0], skirt, bz + p[1], bx + p[0] * 0.97, h, bz + p[1] * 0.97, bx + q[0] * 0.97, h, bz + q[1] * 0.97, [0, skirt / tv, 3, h / tv]);
    }
    G.colLinear(0.9, 0.8, 0.72);
    G.cap(
      pts.map((p) => [bx + p[0] * 0.97, bz + p[1] * 0.97] as [number, number]),
      h,
    );
  }
  return G.build();
}

// ---------------------------------------------------------------------------------------
// the railroad: ties, rails, the trestle, embankments and tunnel portals

function railroad(L: WesternLayout, chunkAt: (x: number, z: number) => ChunkGeo) {
  const { half, rock, cells } = L;
  const rockAt = (z: number) => {
    const i = Math.floor((RAIL_X + half) / 2);
    const j = Math.floor((z + half) / 2);
    return j >= 0 && j < cells ? rock[i * cells + j]! : 99;
  };
  const inTunnel = (z: number) => rockAt(z) > 0 && rockAt(z - 3) > 0 && rockAt(z + 3) > 0;
  const y = L.railY;
  const gauge = 1.435;
  const { z0: tz0, z1: tz1 } = L.trestle;
  // ties and rails, every visible metre of the line
  for (let z = -half; z < half; z += 0.62) {
    if (inTunnel(z)) continue;
    const ch = chunkAt(RAIL_X, z);
    const G = ch.detail;
    const yy = y(z);
    G.col(pick(["#6a5646", "#5a4a3c", "#7a6450"], mulberry(Math.floor(z * 100))));
    boxP(G, WL.TIMBER, RAIL_X - 1.3, yy + 0.18, z - 0.11, RAIL_X + 1.3, yy + 0.32, z + 0.11);
  }
  for (let z = -half; z < half; z += 8) {
    const ze = Math.min(half, z + 8);
    if (inTunnel(z) && inTunnel(ze)) continue;
    const G = chunkAt(RAIL_X, z + 4).main;
    G.col("#8a8078");
    for (const sd of [-1, 1]) {
      const x = RAIL_X + (sd * gauge) / 2;
      // four segments per 8 m so the rail follows the ramp
      for (let k = 0; k < 4; k++) {
        const za = z + k * 2;
        const zb = za + 2;
        beam(G, x, y(za) + 0.39, za, x, y(zb) + 0.39, zb, 0.12, WL.IRON);
      }
    }
    // ballast shoulders (where the bed is at grade)
    if (y(z) < 0.1 && y(ze) < 0.1 && !inTunnel(z)) {
      G.col("#9a8a78").mat(WL.BALLAST);
      G.quad(RAIL_X - 2.1, 0.2, ze, RAIL_X - 1.4, 0.2, ze, RAIL_X - 1.4, 0.2, z, RAIL_X - 2.1, 0.2, z, [0, 0, 0.3, 3]);
      G.quad(RAIL_X - 3, 0.01, ze, RAIL_X - 2.1, 0.2, ze, RAIL_X - 2.1, 0.2, z, RAIL_X - 3, 0.01, z, [0, 0, 0.3, 3]);
      G.quad(RAIL_X + 1.4, 0.2, ze, RAIL_X + 2.1, 0.2, ze, RAIL_X + 2.1, 0.2, z, RAIL_X + 1.4, 0.2, z, [0, 0, 0.3, 3]);
      G.quad(RAIL_X + 2.1, 0.2, ze, RAIL_X + 3, 0.01, ze, RAIL_X + 3, 0.01, z, RAIL_X + 2.1, 0.2, z, [0, 0, 0.3, 3]);
      G.quad(RAIL_X - 1.4, 0.2, ze, RAIL_X + 1.4, 0.2, ze, RAIL_X + 1.4, 0.2, z, RAIL_X - 1.4, 0.2, z, [0, 0, 1, 3]);
    }
  }
  // embankments: a trapezoid of fill under the ramps
  for (let z = tz0 - 46; z < tz1 + 46; z += 2) {
    if (z + 2 > tz0 && z < tz1) continue;
    const ya = y(z);
    const yb = y(z + 2);
    if (ya < 0.05 && yb < 0.05) continue;
    const G = chunkAt(RAIL_X, z + 1).main;
    G.col("#b89a78").mat(WL.BALLAST);
    const w = 2.2;
    const f = 1.4; // side slope run per metre of height
    G.quad(RAIL_X - w, ya + 0.2, z, RAIL_X - w, yb + 0.2, z + 2, RAIL_X + w, yb + 0.2, z + 2, RAIL_X + w, ya + 0.2, z, [0, 0, 1, 1]);
    G.col("#b08e6a").mat(WL.SAND);
    G.quad(RAIL_X + w, ya + 0.2, z, RAIL_X + w, yb + 0.2, z + 2, RAIL_X + w + yb * f, 0, z + 2, RAIL_X + w + ya * f, 0, z, [0, 0, 1, 1]);
    G.quad(RAIL_X - w - ya * f, 0, z, RAIL_X - w - yb * f, 0, z + 2, RAIL_X - w, yb + 0.2, z + 2, RAIL_X - w, ya + 0.2, z, [0, 0, 1, 1]);
  }
  // abutment walls at the trestle ends
  for (const zz of [tz0, tz1]) {
    const G = chunkAt(RAIL_X, zz).main;
    G.col("#a89a86");
    boxP(G, WL.P_STONE, RAIL_X - 3, 0, zz - 1, RAIL_X + 3, TRESTLE_Y + 0.2, zz + 1);
  }
  // the trestle: timber bents every 6 m (four battered posts, X bracing, a cap), stringers
  for (let z = tz0 + 4; z < tz1 - 2; z += 6) {
    const G = chunkAt(RAIL_X, z).detail;
    G.col("#6e5a48");
    const top = TRESTLE_Y;
    for (const [bx, tx] of [
      [-3.0, -1.2],
      [-1.2, -0.5],
      [1.2, 0.5],
      [3.0, 1.2],
    ] as const)
      beam(G, RAIL_X + bx, 0, z, RAIL_X + tx, top, z, 0.3);
    beam(G, RAIL_X - 2.9, 0.4, z, RAIL_X + 1.4, top - 0.4, z, 0.14);
    beam(G, RAIL_X + 2.9, 0.4, z, RAIL_X - 1.4, top - 0.4, z, 0.14);
    beam(G, RAIL_X - 2.4, top * 0.5, z, RAIL_X + 2.4, top * 0.5, z, 0.14);
    boxP(G, WL.TIMBER, RAIL_X - 1.8, top - 0.3, z - 0.25, RAIL_X + 1.8, top, z + 0.25);
    // sway bracing between bents
    beam(G, RAIL_X - 1.4, top - 0.4, z, RAIL_X - 2.4, 0.6, z + 6, 0.1);
    beam(G, RAIL_X + 1.4, top - 0.4, z, RAIL_X + 2.4, 0.6, z + 6, 0.1);
  }
  {
    const G = chunkAt(RAIL_X, (tz0 + tz1) / 2).main;
    G.col("#6e5a48");
    for (const x of [-1.0, -0.4, 0.4, 1.0]) boxP(G, WL.TIMBER, RAIL_X + x - 0.15, TRESTLE_Y - 0.05, tz0, RAIL_X + x + 0.15, TRESTLE_Y + 0.2, tz1);
    // walkway rails
    G.col("#7a6450");
    for (const s of [-1, 1]) {
      boxP(G, WL.TIMBER, RAIL_X + s * 1.8 - 0.05, TRESTLE_Y + 1.0, tz0, RAIL_X + s * 1.8 + 0.05, TRESTLE_Y + 1.1, tz1);
      for (let z = tz0; z < tz1; z += 2) boxP(G, WL.TIMBER, RAIL_X + s * 1.8 - 0.05, TRESTLE_Y + 0.2, z, RAIL_X + s * 1.8 + 0.05, TRESTLE_Y + 1.05, z + 0.1);
    }
  }
  // tunnel portals wherever the line runs into a long stretch of rock
  const cellZ = (j: number) => -half + j * 2;
  const iRail = Math.floor((RAIL_X + half) / 2);
  const solidRun = (j: number, dir: 1 | -1) => {
    let k = 0;
    while (k < 8 && j + dir * k >= 0 && j + dir * k < cells && rock[iRail * cells + j + dir * k]! > 0) k++;
    return k >= 6;
  };
  for (let j = 1; j < cells; j++) {
    const a = rock[iRail * cells + j - 1]! > 0;
    const bb = rock[iRail * cells + j]! > 0;
    if (a === bb) continue;
    // entering rock going +z (the open side is -z), or leaving it (open side +z)
    const dir: 1 | -1 = bb ? -1 : 1;
    if (!solidRun(bb ? j : j - 1, bb ? 1 : -1)) continue;
    const face = cellZ(j) + (bb ? 1.2 : -1.2);
    const G = chunkAt(RAIL_X, face).main;
    const w = 6.4;
    const h = 7.2;
    const deep = face - dir * 14;
    // dark mouth and the dark inside (two-sided), so the train vanishes into it
    G.col("#050403").mat(WL.PAINT, 0, 0);
    for (const [ax, az, bx, bz] of [
      [RAIL_X + w / 2, face, RAIL_X - w / 2, face],
      [RAIL_X - w / 2, face, RAIL_X - w / 2, deep],
      [RAIL_X + w / 2, deep, RAIL_X + w / 2, face],
    ] as const) {
      G.quad(ax, 0, az, bx, 0, bz, bx, h, bz, ax, h, az, [0, 0, 1, 1]);
      G.quad(bx, 0, bz, ax, 0, az, ax, h, az, bx, h, bz, [0, 0, 1, 1]);
    }
    G.quad(RAIL_X - w / 2, h, face, RAIL_X + w / 2, h, face, RAIL_X + w / 2, h, deep, RAIL_X - w / 2, h, deep, [0, 0, 1, 1]);
    G.quad(RAIL_X + w / 2, h, face, RAIL_X - w / 2, h, face, RAIL_X - w / 2, h, deep, RAIL_X + w / 2, h, deep, [0, 0, 1, 1]);
    // cut-stone portal: jambs, a lintel and a parapet, with timber sets inside
    const o = dir * 0.7;
    G.col("#a89682");
    boxP(G, WL.P_STONE, RAIL_X - w / 2 - 1.8, 0, face + o - 0.7, RAIL_X - w / 2, h + 1.4, face + o + 0.7);
    boxP(G, WL.P_STONE, RAIL_X + w / 2, 0, face + o - 0.7, RAIL_X + w / 2 + 1.8, h + 1.4, face + o + 0.7);
    boxP(G, WL.P_STONE, RAIL_X - w / 2 - 1.8, h, face + o - 0.7, RAIL_X + w / 2 + 1.8, h + 2.6, face + o + 0.7);
    G.col("#8a7a66");
    boxP(G, WL.P_STONE, RAIL_X - w / 2 - 2.2, h + 2.6, face + o - 0.9, RAIL_X + w / 2 + 2.2, h + 3.1, face + o + 0.9);
    G.col("#5a4636");
    const tz = face + dir * 1.6;
    boxP(G, WL.TIMBER, RAIL_X - w / 2 - 0.1, 0, tz - 0.2, RAIL_X - w / 2 + 0.35, h, tz + 0.2);
    boxP(G, WL.TIMBER, RAIL_X + w / 2 - 0.35, 0, tz - 0.2, RAIL_X + w / 2 + 0.1, h, tz + 0.2);
    boxP(G, WL.TIMBER, RAIL_X - w / 2 - 0.3, h - 0.45, tz - 0.25, RAIL_X + w / 2 + 0.3, h, tz + 0.25);
  }
}

/** the mine portal: timber sets in the canyon face, a black adit, ore-cart rails */
function minePortal(L: WesternLayout, chunkAt: (x: number, z: number) => ChunkGeo) {
  const { x, z } = L.mine;
  const ch = chunkAt(x, z);
  const G = ch.main;
  const w = 3.6;
  const h = 3.8;
  G.col("#050403").mat(WL.PAINT, 0, 0);
  G.quad(x - w / 2, 0, z + 0.3, x + w / 2, 0, z + 0.3, x + w / 2, h, z + 0.3, x - w / 2, h, z + 0.3, [0, 0, 1, 1]);
  G.col("#5a4636");
  for (const sx of [-1, 1]) boxP(G, WL.TIMBER, x + sx * (w / 2) - 0.25, 0, z + 0.2, x + sx * (w / 2) + 0.25, h, z + 0.7);
  boxP(G, WL.TIMBER, x - w / 2 - 0.5, h, z + 0.15, x + w / 2 + 0.5, h + 0.55, z + 0.75);
  boxP(G, WL.TIMBER, x - w / 2 - 0.3, h + 0.55, z - 0.4, x + w / 2 + 0.3, h + 1.2, z + 0.4);
  signBoard(G, 22, x, h + 1.3, z + 0.45, 3.2, 0.7);
  // ore-cart rails down to the tipple
  const D = ch.detail;
  D.col("#5a4a3c");
  for (let t = 0; t < 26; t += 0.7) boxP(D, WL.TIMBER, x - 0.7, 0.02, z + 0.5 + t - 0.08, x + 0.7, 0.12, z + 0.5 + t + 0.08);
  D.col("#6a6058");
  for (const s of [-0.45, 0.45]) boxP(D, WL.IRON, x + s - 0.03, 0.12, z + 0.5, x + s + 0.03, 0.2, z + 26.5);
}

// ---------------------------------------------------------------------------------------

/** helpers the blockade builder shares */
export const geoKit = { boxP, boxC, oboxP, beam, cylP, slope, signBoard };
/** a prop template (local space, base centre at the origin, +z front) */
export function propTemplate(k: PKey) {
  return templates()[k] ?? null;
}

export function buildWesternMeshes(L: WesternLayout): WesternMeshes {
  const { half } = L;
  const E = half;
  const n = Math.ceil((E * 2) / CHUNK);
  const list: ChunkGeo[] = [];
  for (let a = 0; a < n; a++)
    for (let b = 0; b < n; b++)
      list.push({
        x0: -E + a * CHUNK,
        z0: -E + b * CHUNK,
        x1: -E + (a + 1) * CHUNK,
        z1: -E + (b + 1) * CHUNK,
        main: new Geo(),
        detail: new Geo(),
        glow: new Geo(),
        pools: new Geo(),
      });
  const chunkAt = (x: number, z: number) => {
    const a = Math.max(0, Math.min(n - 1, Math.floor((x + E) / CHUNK)));
    const b = Math.max(0, Math.min(n - 1, Math.floor((z + E) / CHUNK)));
    return list[a * n + b]!;
  };
  const r = mulberry(1234);
  const windmills: WesternMeshes["windmills"] = [];
  const fires: WesternMeshes["fires"] = [];

  // ---- buildings ----
  for (const b of L.buildings) {
    const B = building(b, mulberry(b.seed));
    const { out } = frameOf(b);
    const ch = chunkAt(out.x, out.z);
    if (B.main.n) ch.main.stamp(B.main.freeze(), out.x, 0, out.z, out.rot);
    if (B.detail.n) ch.detail.stamp(B.detail.freeze(), out.x, 0, out.z, out.rot);
    if (B.glow.n) ch.glow.stamp(B.glow.freeze(), out.x, 0, out.z, out.rot);
    if (B.pools.n) ch.pools.stamp(B.pools.freeze(), out.x, 0, out.z, out.rot);
    if (b.t === "smithy") {
      const s = Math.sin(out.rot);
      const c = Math.cos(out.rot);
      const lz = -(b.front === 0 || b.front === 2 ? b.z1 - b.z0 : b.x1 - b.x0) + 2.5;
      fires.push({ x: out.x + lz * s, y: 1, z: out.z + lz * c, s: 0.7 });
    }
  }

  // ---- props ----
  const T = templates();
  const tint = new THREE.Color();
  for (const p of L.props) {
    const t = T[p.k];
    if (!t) continue;
    const ch = chunkAt(p.x, p.z);
    const y = p.k === "lantern" ? (p.a ?? 2.8) : 0;
    // a light per-instance tint so repeated props don't read as clones
    const k = 0.9 + ((Math.sin(p.x * 12.9898 + p.z * 78.233) * 43758.5453) % 1 + 1) % 1 * 0.2;
    tint.setRGB(k, k, k);
    const big = p.k === "watertower" || p.k === "windmill" || p.k === "arch" || p.k === "covered" || p.k === "wagon" || p.k === "well" || p.k === "tank" || p.k === "pole" || p.k === "saguaro" || p.k === "outhouse";
    const target = big ? ch.main : ch.detail;
    // fences and hitching rails stretch along their length; everything else scales evenly
    const stretch = p.k === "fence" ? 2.5 : p.k === "hitch" ? 1.1 : 0;
    const sx = stretch ? p.s / stretch : p.s;
    const sy = stretch ? 1 : p.s;
    target.stamp(t.d, p.x, y, p.z, p.rot, sx, sy, sy, tint);
    if (t.g) ch.glow.stamp(t.g, p.x, y, p.z, p.rot, p.s, p.s, p.s);
    if (p.k === "lantern" || p.k === "streetlamp") {
      ch.pools.col("#ffb060").mat(0, 0, 0);
      const s = p.k === "streetlamp" ? 7 : 5;
      ch.pools.flat(p.x - s / 2, p.z - s / 2, p.x + s / 2, p.z + s / 2, 0.06);
    }
    if (t.p) ch.pools.stamp(t.p, p.x, 0, p.z, p.rot, p.s, p.s, p.s);
    if (p.k === "windmill") windmills.push({ x: p.x, y: 11.2 * p.s, z: p.z, rot: p.rot, s: p.s });
    if (p.k === "campfire") fires.push({ x: p.x, y: 0.4, z: p.z, s: p.s });
  }

  // ---- rock, the railroad, the mine ----
  const hv = rockMesh(L, chunkAt);
  railroad(L, chunkAt);
  minePortal(L, chunkAt);

  // ---- the station platform and the level-crossing planks ----
  {
    const G = chunkAt(142, -40).main;
    G.col("#ffffff", 0.9).mat(WL.DECK);
    G.quad(138, 0.34, -14, 146, 0.34, -14, 146, 0.34, -84, 138, 0.34, -84, [0, 0, 2, 17.5]);
    G.col(DARK_WOOD);
    boxP(G, WL.TIMBER, 145.85, 0, -84, 146, 0.34, -14, false);
    // the station name board on two posts
    G.col("#5a4636");
    boxP(G, WL.TIMBER, 143.2, 0.34, -60.1, 143.4, 3.4, -59.9);
    boxP(G, WL.TIMBER, 143.2, 0.34, -66.1, 143.4, 3.4, -65.9);
    G.col("#ffffff").mat(WL.SIGNS);
    const uv = signUV(12);
    G.quad(143.45, 2.2, -59.8, 143.45, 2.2, -66.2, 143.45, 3.3, -66.2, 143.45, 3.3, -59.8, uv);
    G.quad(143.15, 2.2, -66.2, 143.15, 2.2, -59.8, 143.15, 3.3, -59.8, 143.15, 3.3, -66.2, uv);
    const C = chunkAt(150, 0).main;
    C.col("#8a7258").mat(WL.DECK);
    for (const x of [RAIL_X - 1.7, RAIL_X - 0.2, RAIL_X + 1.3])
      C.quad(x, 0.33, 12, x + 0.5, 0.33, 12, x + 0.5, 0.33, -12, x, 0.33, -12, [0, 0, 0.1, 6]);
  }

  // ---- telegraph wires between the poles (thin dark strips) ----
  {
    const poles = L.props.filter((p) => p.k === "pole").sort((a, b) => a.z - b.z);
    for (let i = 0; i + 1 < poles.length; i++) {
      const a = poles[i]!;
      const b = poles[i + 1]!;
      const G = chunkAt(a.x, (a.z + b.z) / 2).detail;
      G.col("#1a1816").mat(WL.IRON);
      for (const off of [-0.75, 0.75]) {
        const segs = 6;
        for (let s = 0; s < segs; s++) {
          const t0 = s / segs;
          const t1 = (s + 1) / segs;
          const sag = (t: number) => 7.1 - Math.sin(t * Math.PI) * 0.6;
          const za = a.z + (b.z - a.z) * t0;
          const zb = a.z + (b.z - a.z) * t1;
          G.quad(a.x + off, sag(t0), za, a.x + off, sag(t1), zb, a.x + off, sag(t1) + 0.025, zb, a.x + off, sag(t0) + 0.025, za, [0, 0, 1, 1]);
          G.quad(a.x + off, sag(t1), zb, a.x + off, sag(t0), za, a.x + off, sag(t0) + 0.025, za, a.x + off, sag(t1) + 0.025, zb, [0, 0, 1, 1]);
        }
      }
    }
  }
  void r;
  void WK;

  const far = farTerrain(L, hv);
  let verts = far.getAttribute("position").count;
  const chunks: WChunk[] = list.map((c) => {
    const main = c.main.n ? c.main.build() : null;
    const detail = c.detail.n ? c.detail.build() : null;
    const glow = c.glow.n ? c.glow.build() : null;
    const pools = c.pools.n ? c.pools.build("uv") : null;
    for (const g of [main, detail, glow, pools]) if (g) verts += g.getAttribute("position").count;
    return { x0: c.x0, z0: c.z0, x1: c.x1, z1: c.z1, main, detail, glow, pools };
  });
  return { chunks, far, windmills, fires, stats: { verts } };
}
