import { westernBelfry } from "./belfry";
import { overhangTriangles } from "./cliffs";
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
  LEAN_D,
  BALCONY_Y,
  SALOON_BALCONY,
  BELFRY_Y,
  BOARD_D,
  DECK_Y,
  RAIL_X,
  STOREY,
  TRESTLE_Y,
  WK,
  fbm,
  sampleTerrain,
  type WBld,
  type WesternLayout,
  type WProp,
} from "./layout";
import { FAC_COLS, FAC_ROWS, MODULE_W, TILE_M, WL, signUV } from "./textures";
import { tumbleweedGeometry } from "./tumbleweed";
import { roomPlan, saloonBalcony, type RoomItem, type RoomPlan } from "./rooms";

export const CHUNK = 200;
export const DETAIL_RANGE = 280;

/** aFac.z flags: +1 windows light up at night (random), +2 always lit (saloon), +10 ground AO */
const LIT = 1;
/** always softly lit (the church's stained glass by candlelight) */
const CANDLE = 3;
/** inside a walk-in building: warm lamplight fill (materials.ts) */
const INT = 4;
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
/** horse coats: bay, chestnut, black, grey, palomino, buckskin */
const COATS = ["#6a3a22", "#8a4a26", "#2a2220", "#a8a098", "#c8a060", "#b08a58"];
const DARK_WOOD = "#6a4a30";

// ---------------------------------------------------------------------------------------
// geometry helpers (local frame; Geo.quad takes a, b, c, d counter-clockwise from the front)

/** wall quad from (ax, az) to (bx, bz): the face points to the left of a -> b seen from above
 * rotated... concretely: going +x the face points +z. uv = [u0, v0, u1, v1]. */
function wallq(
  G: Geo,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  y0: number,
  y1: number,
  uv: readonly number[],
) {
  G.quad(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az, uv);
}
/** plain-layer wall: UVs in metres */
function wallP(
  G: Geo,
  layer: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  y0: number,
  y1: number,
  u0 = 0,
) {
  const [tu, tv] = TILE_M[layer] ?? [4, 4];
  const len = Math.hypot(bx - ax, bz - az);
  G.mat(layer);
  wallq(G, ax, az, bx, bz, y0, y1, [u0 / tu, y0 / tv, (u0 + len) / tu, y1 / tv]);
}
/** facade wall: whole modules across, storeys up */
function wallF(
  G: Geo,
  layer: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  y0: number,
  y1: number,
  uOff: number,
) {
  const len = Math.hypot(bx - ax, bz - az);
  const mods = Math.max(1, Math.round(len / (MODULE_W[layer] ?? 3)));
  G.mat(layer);
  wallq(G, ax, az, bx, bz, y0, y1, [
    uOff / FAC_COLS,
    y0 / STOREY / FAC_ROWS,
    (uOff + mods) / FAC_COLS,
    y1 / STOREY / FAC_ROWS,
  ]);
}
/** axis-aligned box with metre UVs on every face (top optional) */
function boxP(
  G: Geo,
  layer: number,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  top = true,
  // (anything off the ground gets a bottom: cornices, lintels, rails and caps are seen from below)
  bottom = y0 > 1.0,
) {
  wallP(G, layer, x1, z0, x0, z0, y0, y1);
  wallP(G, layer, x1, z1, x1, z0, y0, y1);
  wallP(G, layer, x0, z1, x1, z1, y0, y1);
  wallP(G, layer, x0, z0, x0, z1, y0, y1);
  const [tu, tv] = TILE_M[layer] ?? [4, 4];
  if (top) G.flat(x0, z0, x1, z1, y1, [x0 / tu, -z1 / tv, x1 / tu, -z0 / tv]);
  if (bottom) G.quad(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1, [0, 0, 1, 1]);
}
/** centred box helper */
function boxC(
  G: Geo,
  layer: number,
  x: number,
  y0: number,
  z: number,
  w: number,
  h: number,
  d: number,
  top = true,
) {
  boxP(G, layer, x - w / 2, y0, z - d / 2, x + w / 2, y0 + h, z + d / 2, top);
}
/** a box rotated about y, metre UVs */
function oboxP(
  G: Geo,
  layer: number,
  x: number,
  y0: number,
  z: number,
  w: number,
  h: number,
  d: number,
  rot: number,
  top = true,
) {
  const s = Math.sin(rot);
  const c = Math.cos(rot);
  const pt = (lx: number, lz: number): [number, number] => [
    x + lx * c + lz * s,
    z - lx * s + lz * c,
  ];
  const p = [pt(-w / 2, -d / 2), pt(w / 2, -d / 2), pt(w / 2, d / 2), pt(-w / 2, d / 2)] as const;
  // outline counter-clockwise seen from +y in local space: (-,-) (+,-) (+,+) (-,+); walls b -> a
  wallP(G, layer, p[1][0], p[1][1], p[0][0], p[0][1], y0, y0 + h);
  wallP(G, layer, p[2][0], p[2][1], p[1][0], p[1][1], y0, y0 + h);
  wallP(G, layer, p[3][0], p[3][1], p[2][0], p[2][1], y0, y0 + h);
  wallP(G, layer, p[0][0], p[0][1], p[3][0], p[3][1], y0, y0 + h);
  if (top) {
    const y = y0 + h;
    G.quad(p[3][0], y, p[3][1], p[2][0], y, p[2][1], p[1][0], y, p[1][1], p[0][0], y, p[0][1], [
      0,
      0,
      w / 2,
      d / 2,
    ]);
  }
}
/** a beam between two points (square section), timber by default */
function beam(
  G: Geo,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  t: number,
  layer: number = WL.TIMBER,
) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) return;
  // orthonormal frame round the beam axis
  const f = new THREE.Vector3(dx / len, dy / len, dz / len);
  const up = Math.abs(f.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3()
    .crossVectors(f, up)
    .normalize()
    .multiplyScalar(t / 2);
  const v = new THREE.Vector3()
    .crossVectors(u, f)
    .normalize()
    .multiplyScalar(t / 2);
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
    G.quad(
      ax + q[0],
      ay + q[1],
      az + q[2],
      ax + p[0],
      ay + p[1],
      az + p[2],
      bx + p[0],
      by + p[1],
      bz + p[2],
      bx + q[0],
      by + q[1],
      bz + q[2],
      [0, 0, 0.1, tl],
    );
  }
}
/** vertical cylinder with metre UVs around (for cactus, posts, barrels) */
function cylP(
  G: Geo,
  layer: number,
  x: number,
  y0: number,
  z: number,
  r0: number,
  h: number,
  seg: number,
  r1 = r0,
  top = true,
) {
  G.mat(layer);
  const [tu, tv] = TILE_M[layer] ?? [1, 1];
  const circ = Math.PI * 2 * Math.max(r0, 0.05);
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    const u0 = ((i / seg) * circ) / tu;
    const u1 = (((i + 1) / seg) * circ) / tu;
    G.quad(
      x + Math.cos(a1) * r0,
      y0,
      z + Math.sin(a1) * r0,
      x + Math.cos(a0) * r0,
      y0,
      z + Math.sin(a0) * r0,
      x + Math.cos(a0) * r1,
      y0 + h,
      z + Math.sin(a0) * r1,
      x + Math.cos(a1) * r1,
      y0 + h,
      z + Math.sin(a1) * r1,
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
function slope(
  G: Geo,
  layer: number,
  r0x: number,
  r0z: number,
  r1x: number,
  r1z: number,
  yr: number,
  ex: number,
  ez: number,
  ye: number,
  under = true,
) {
  const [tu, tv] = TILE_M[layer] ?? [4, 4];
  const len = Math.hypot(r1x - r0x, r1z - r0z);
  const run = Math.hypot(ex, ez, yr - ye);
  G.mat(layer);
  // a = eave start, b = eave end, c = ridge end, d = ridge start
  G.quad(r0x + ex, ye, r0z + ez, r1x + ex, ye, r1z + ez, r1x, yr, r1z, r0x, yr, r0z, [
    0,
    0,
    len / tu,
    run / tv,
  ]);
  // the underside (the same quad wound the other way): eaves, porch roofs and awnings are
  // seen from below, and a one-sided roof would vanish from under it
  if (under)
    G.quad(r0x, yr, r0z, r1x, yr, r1z, r1x + ex, ye, r1z + ez, r0x + ex, ye, r0z + ez, [
      0,
      run / tv,
      len / tu,
      0,
    ]);
}
/** vertical triangle (gable end) facing the direction of travel's left, see wallq */
function gable(
  G: Geo,
  layer: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  y0: number,
  apex: number,
) {
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
    G.v(
      p.x,
      p.y,
      p.z,
      q.x,
      q.y,
      q.z,
      flat ? p.x / tu : (p.x + p.z) / tu,
      flat ? p.z / tu : p.y / tv,
    );
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
function signBoard(
  G: Geo,
  word: number,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  frame = true,
) {
  if (word < 0) return;
  G.col("#ffffff").mat(WL.SIGNS, 0, 0);
  const uv = signUV(word);
  G.quad(
    x - w / 2,
    y,
    z + 0.06,
    x + w / 2,
    y,
    z + 0.06,
    x + w / 2,
    y + h,
    z + 0.06,
    x - w / 2,
    y + h,
    z + 0.06,
    uv,
  );
  if (frame) {
    G.col(DARK_WOOD);
    boxP(
      G,
      WL.TIMBER,
      x - w / 2 - 0.08,
      y - 0.08,
      z - 0.02,
      x + w / 2 + 0.08,
      y + h + 0.08,
      z + 0.02, // 4 cm behind the painted face, so the two never fight
    );
  }
}

/** the false-front parapet: the front wall carried up past the roof, with a cornice */
function falseFront(
  B: BGeo,
  b: WBld,
  W: number,
  yTop: number,
  ffTop: number,
  facL: number,
  plainL: number,
  paint: string,
  trimC: string,
  r: () => number,
) {
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
    pts.push(
      [x0, ffTop - s * 2],
      [x0 + W * 0.2, ffTop - s * 2],
      [x0 + W * 0.2, ffTop - s],
      [x0 + W * 0.36, ffTop - s],
      [x0 + W * 0.36, ffTop],
      [x1 - W * 0.36, ffTop],
      [x1 - W * 0.36, ffTop - s],
      [x1 - W * 0.2, ffTop - s],
      [x1 - W * 0.2, ffTop - s * 2],
      [x1, ffTop - s * 2],
    );
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
    G.quad(ax, yTop, 0, bx, yTop, 0, bx, by, 0, ax, ay, 0, [
      ax / tu,
      yTop / tv,
      bx / tu,
      Math.max(ay, by) / tv,
    ]);
    G.col("#8a7a66", 1);
    G.mat(WL.P_BOARD);
    G.quad(bx, yTop, -t, ax, yTop, -t, ax, ay, -t, bx, by, -t, [
      bx / 4,
      yTop / 4,
      ax / 4,
      Math.max(ay, by) / 4,
    ]);
    G.col(paint, 1);
    // cap
    G.col(trimC);
    G.mat(WL.TIMBER);
    G.quad(ax, ay, 0.12, bx, by, 0.12, bx, by, -t, ax, ay, -t, [0, 0, 1, 0.1]);
    // (the lip it overhangs the face by, seen from the street below)
    G.quad(
      ax,
      ay - 0.001,
      0,
      bx,
      by - 0.001,
      0,
      bx,
      by - 0.001,
      0.12,
      ax,
      ay - 0.001,
      0.12,
      [0, 0, 1, 0.1],
    );
    G.col(paint, 1);
  }
  // side edges of the slab
  wallP(G, plainL, x0, -t, x0, 0, yTop, pts[0]![1]);
  wallP(G, plainL, x1, 0, x1, -t, yTop, pts[pts.length - 1]![1]);
  // cornice: a projecting moulding and brackets under it
  G.col(trimC);
  const cy = style === 1 ? ffTop - 0.35 : Math.min(...pts.map((p) => p[1])) - 0.38; // below the cap, not flush with it
  boxP(G, WL.TIMBER, x0 + 0.02, cy, -0.05, x1 - 0.02, cy + 0.3, 0.32);
  for (let x = x0 + 0.4; x < x1; x += Math.max(1.1, W / 9))
    boxP(G, WL.TIMBER, x - 0.07, cy - 0.35, 0, x + 0.07, cy, 0.26);
  // back bracing struts (seen from behind)
  B.detail.col(DARK_WOOD);
  for (let x = x0 + 1; x < x1 - 0.5; x += 3)
    beam(B.detail, x, yTop - 0.2, -t - 1.6, x, ffTop - 0.4, -t, 0.1);
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

// ---------------------------------------------------------------------------------------
// walk-in interiors (rooms.ts holds the plans; this draws them)

const _tint = new THREE.Color();

/** ground-floor window columns in each facade tile (the other columns hold doors) */
const WIN_COLS: Record<WBld["mat"], number[]> = {
  clap: [1, 2],
  board: [0, 2],
  brick: [0, 2, 3],
  stone: [1, 2, 3],
  barn: [0, 3],
  adobe: [1, 3],
  white: [1, 2],
  log: [1, 2],
};

type Hole = { u0: number; u1: number; y0: number; y1: number };
/** Reserve the complete sill/head trim, not just the glass, beside a real door. */
function windowOverlapsDoor(center: number, doors: { u0: number; u1: number }[]) {
  return doors.some((d) => center + 0.95 > d.u0 && center - 0.95 < d.u1);
}
/** Trim follows the same apertures as its wall, including low threshold openings. */
function solidSpans(start: number, end: number, holes: { u0: number; u1: number }[]) {
  const out: [number, number][] = [];
  let at = start;
  for (const h of [...holes].sort((a, b) => a.u0 - b.u0)) {
    if (h.u1 <= start || h.u0 >= end) continue;
    if (h.u0 > at) out.push([at, Math.min(end, h.u0)]);
    at = Math.max(at, h.u1);
  }
  if (at < end) out.push([at, end]);
  return out;
}

/** a wall quad from a to b (face to the left of a -> b, see wallq) with rectangular holes
 * cut out; u runs from a (m), holes may overlap the ends */
function holedWall(
  G: Geo,
  layer: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  y0: number,
  y1: number,
  holes: Hole[],
  uvOf: (ua: number, ub: number, ya: number, yb: number) => readonly number[],
) {
  const len = Math.hypot(bx - ax, bz - az);
  const ux = (bx - ax) / len;
  const uz = (bz - az) / len;
  const hs = holes
    .map((h) => ({
      ...h,
      u0: Math.max(0, h.u0),
      u1: Math.min(len, h.u1),
      y0: Math.max(y0, h.y0),
      y1: Math.min(y1, h.y1),
    }))
    .filter((h) => h.u1 > h.u0 && h.y1 > h.y0)
    .sort((a, b) => a.u0 - b.u0);
  const piece = (ua: number, ub: number, ya: number, yb: number) => {
    if (ub - ua < 1e-3 || yb - ya < 1e-3) return;
    G.mat(layer);
    wallq(G, ax + ux * ua, az + uz * ua, ax + ux * ub, az + uz * ub, ya, yb, uvOf(ua, ub, ya, yb));
  };
  let u = 0;
  for (const h of hs) {
    piece(u, h.u0, y0, y1);
    piece(h.u0, h.u1, y0, h.y0);
    piece(h.u0, h.u1, h.y1, y1);
    u = Math.max(u, h.u1);
  }
  piece(u, len, y0, y1);
}

/** the interior of a walk-in building, and its real doorways in the outer walls */
function walkIn(
  B: BGeo,
  b: WBld,
  plan: RoomPlan,
  W: number,
  D: number,
  H: number,
  facL: number,
  plainL: number,
  uOff: number,
  paint: string,
  lit: number,
  seed: number,
  r: () => number,
) {
  const G = B.main;
  const D2 = B.detail;
  const x0 = -W / 2;
  const x1 = W / 2;
  const z0 = -D;
  const T = 0.12; // wall thickness
  const fl = plan.floor;
  const ceil = plan.ceil;
  const mods = Math.max(1, Math.round(W / (MODULE_W[facL] ?? 3)));
  const mw = W / mods;
  const facUV = (ua: number, ub: number, ya: number, yb: number) =>
    [
      (uOff + ua / mw) / FAC_COLS,
      ya / STOREY / FAC_ROWS,
      (uOff + ub / mw) / FAC_COLS,
      yb / STOREY / FAC_ROWS,
    ] as const;
  const [ptu, ptv] = TILE_M[plainL] ?? [4, 4];
  const plainUV = (ua: number, ub: number, ya: number, yb: number) =>
    [ua / ptu, ya / ptv, ub / ptu, yb / ptv] as const;
  const front = plan.doors.filter((d) => d.wall === "front");
  const back = plan.doors.filter((d) => d.wall === "back");
  const ud = plan.upperDoor;

  // ---- the outer front wall: upper storeys from the facade tile, the ground storey module
  // by module (display windows, and the doorway cut through for real) ----
  G.col(paint, 1).mat(facL, seed, lit + AO);
  if (H > STOREY) {
    const holes: Hole[] = ud ? [{ u0: ud.a - x0, u1: ud.b - x0, y0: ud.y, y1: ud.y + 2.3 }] : [];
    holedWall(G, facL, x0, 0, x1, 0, STOREY, H, holes, facUV);
  }
  const cols = WIN_COLS[b.mat];
  let wk = 0;
  for (let m = 0; m < mods; m++) {
    const xa = x0 + m * mw;
    const xb = xa + mw;
    const door = front.find((d) => d.b > xa && d.a < xb);
    if (!door) {
      const c = cols[wk++ % cols.length]!;
      G.col(paint, 1).mat(facL, seed, lit + AO);
      wallq(G, xa, 0, xb, 0, 0, STOREY, [c / FAC_COLS, 0, (c + 1) / FAC_COLS, 1 / FAC_ROWS]);
      continue;
    }
    // the doorway's module: plain wall round the opening (the facade's own base colour)
    G.col(paint, 1).mat(plainL, seed, AO);
    holedWall(
      G,
      plainL,
      xa,
      0,
      xb,
      0,
      0,
      STOREY,
      front.map((d) => ({ u0: d.a - xa, u1: d.b - xa, y0: 0, y1: d.h })),
      (ua, ub, ya, yb) => plainUV(ua + (xa - x0), ub + (xa - x0), ya, yb),
    );
  }
  // ---- the outer back wall, with its doorway ----
  G.col(paint, 1).mat(plainL, seed, AO);
  holedWall(
    G,
    plainL,
    x1,
    z0,
    x0,
    z0,
    0,
    H,
    back.map((d) => ({ u0: x1 - d.b, u1: x1 - d.a, y0: 0, y1: d.h })),
    plainUV,
  );

  // ---- door frames, reveals and leaves ----
  const reveal = (a: number, bb: number, h: number, zf: number, dir: 1 | -1) => {
    // zf = the outer face, dir = into the building (-1 for the front wall, +1 for the back)
    const zi = zf + dir * T;
    G.col("#6a5038").mat(WL.TIMBER);
    // jambs and head, inside and out
    for (const [zz, s2] of [
      [zf, -dir],
      [zi, dir],
    ] as const) {
      const za = zz;
      const zb = zz + s2 * 0.07;
      boxP(G, WL.TIMBER, a - 0.13, 0, Math.min(za, zb), a, h + 0.14, Math.max(za, zb));
      boxP(G, WL.TIMBER, bb, 0, Math.min(za, zb), bb + 0.13, h + 0.14, Math.max(za, zb));
      boxP(G, WL.TIMBER, a - 0.13, h, Math.min(za, zb), bb + 0.13, h + 0.14, Math.max(za, zb));
    }
    // the reveal (the wall's thickness) round the opening
    G.col("#8a7258").mat(WL.P_BOARD);
    const lo = Math.min(zf, zi);
    const hi = Math.max(zf, zi);
    G.quad(a, 0, lo, a, 0, hi, a, h, hi, a, h, lo, [0, 0, 0.1, 1]);
    G.quad(bb, 0, hi, bb, 0, lo, bb, h, lo, bb, h, hi, [0, 0, 0.1, 1]);
    G.quad(a, h, lo, a, h, hi, bb, h, hi, bb, h, lo, [0, 0, 1, 0.1]);
    // threshold
    G.col("#5a4636").mat(WL.DECK);
    boxP(G, WL.DECK, a, 0, lo, bb, fl + 0.02, hi);
  };
  for (const d of front) {
    reveal(d.a, d.b, d.h, 0, -1);
    if (d.kind === "batwing") {
      // the batwing doors, held wide on their hinges with a clear passage
      D2.col("#7a3a22");
      const w = (d.b - d.a) / 2;
      oboxP(
        D2,
        WL.TIMBER,
        d.a + 0.1 + Math.cos(1.34) * w * 0.5,
        0.9,
        -0.08 - Math.sin(1.34) * w * 0.5,
        w,
        1.1,
        0.05,
        -1.34,
      );
      oboxP(
        D2,
        WL.TIMBER,
        d.b - 0.1 - Math.cos(1.34) * w * 0.5,
        0.9,
        -0.08 - Math.sin(1.34) * w * 0.5,
        w,
        1.1,
        0.05,
        1.34,
      );
    } else if (d.kind === "barn") {
      // the big doors, slid open along the outside of the wall
      G.col("#8a2a1c").mat(WL.P_BOARD);
      const w = (d.b - d.a) / 2;
      boxP(G, WL.P_BOARD, d.a - w - 0.1, 0, 0.08, d.a - 0.1, d.h, 0.16);
      boxP(G, WL.P_BOARD, d.b + 0.1, 0, 0.08, d.b + w + 0.1, d.h, 0.16);
      G.col("#eee6d6");
      for (const [pa, pb] of [
        [d.a - w - 0.1, d.a - 0.1],
        [d.b + 0.1, d.b + w + 0.1],
      ] as const) {
        beam(G, pa + 0.1, 0.1, 0.17, pb - 0.1, d.h - 0.1, 0.17, 0.12, WL.PAINT);
        beam(G, pb - 0.1, 0.1, 0.17, pa + 0.1, d.h - 0.1, 0.17, 0.12, WL.PAINT);
      }
      G.col("#3a3634");
      boxP(G, WL.IRON, d.a - w - 0.3, d.h + 0.05, 0.06, d.b + w + 0.3, d.h + 0.15, 0.18);
    } else {
      // a panelled door standing open, back against the inside wall
      D2.col(pick(["#5a2e1c", "#3a4a3a", "#4a3a2a"], r)).mat(WL.P_BOARD, 0, 0);
      boxP(
        D2,
        WL.P_BOARD,
        d.a - 0.07,
        fl,
        -T - (d.b - d.a) + 0.02,
        d.a - 0.02,
        d.h - 0.02,
        -T - 0.02,
      );
    }
  }
  for (const d of back) {
    reveal(d.a, d.b, d.h, z0, 1);
    if (d.kind === "barn") {
      G.col("#8a2a1c").mat(WL.P_BOARD);
      const w = (d.b - d.a) / 2;
      boxP(G, WL.P_BOARD, d.a - w - 0.1, 0, z0 - 0.16, d.a - 0.1, d.h, z0 - 0.08);
      boxP(G, WL.P_BOARD, d.b + 0.1, 0, z0 - 0.16, d.b + w + 0.1, d.h, z0 - 0.08);
    } else {
      D2.col("#5a4636").mat(WL.P_BOARD, 0, 0);
      boxP(
        D2,
        WL.P_BOARD,
        d.b + 0.02,
        fl,
        z0 + T + 0.02,
        d.b + 0.07,
        d.h - 0.02,
        z0 + T + (d.b - d.a) - 0.02,
      );
    }
  }
  if (ud) {
    // the balcony door: a frame, and the door itself standing open onto the landing
    G.col("#6a5038").mat(WL.TIMBER);
    boxP(G, WL.TIMBER, ud.a - 0.13, ud.y, -T - 0.05, ud.a, ud.y + 2.44, 0.07);
    boxP(G, WL.TIMBER, ud.b, ud.y, -T - 0.05, ud.b + 0.13, ud.y + 2.44, 0.07);
    boxP(G, WL.TIMBER, ud.a - 0.13, ud.y + 2.3, -T - 0.05, ud.b + 0.13, ud.y + 2.44, 0.07);
    D2.col("#5a2e1c").mat(WL.P_BOARD, 0, 0);
    boxP(
      D2,
      WL.P_BOARD,
      ud.b + 0.02,
      ud.y + 0.02,
      -T - (ud.b - ud.a),
      ud.b + 0.07,
      ud.y + 2.26,
      -T - 0.02,
    );
  }

  // ---- inside: the walls' inner faces, with the windows seen from within ----
  // (everything in here takes the interior's lamplight fill)
  G.mat(WL.PAINT, 0, INT);
  D2.mat(WL.TIMBER, 0.5, INT);
  const finishLayer =
    plan.finish === "stone" ? WL.P_STONE : plan.finish === "boards" ? WL.P_BOARD : WL.PAINT;
  const [ftu, ftv] = TILE_M[finishLayer] ?? [2, 2];
  const finUV = (ua: number, ub: number, ya: number, yb: number) =>
    [ua / ftu, ya / ftv, ub / ftu, yb / ftv] as const;
  const winHoles = (len: number, doors: { u0: number; u1: number }[] = []): Hole[] => {
    const nWin = Math.floor((len - 1.2) / 3.6);
    const out: Hole[] = [];
    for (let k = 0; k < nWin; k++) {
      const tc = ((k + 0.5) / nWin) * len;
      if (windowOverlapsDoor(tc, doors)) continue;
      out.push({ u0: tc - 0.75, u1: tc + 0.75, y0: 0.8, y1: 2.8 });
    }
    return out;
  };
  const yb = fl;
  const yt = ceil;
  // (inner faces run T inside the outer ones; a -> b so the faces point into the room)
  type IW = { ax: number; az: number; bx: number; bz: number; holes: Hole[]; win: Hole[] };
  const iw: IW[] = [];
  // front: from the right corner to the left (u from x1)
  {
    const holes: Hole[] = front.map((d) => ({
      u0: x1 - T - d.b,
      u1: x1 - T - d.a,
      y0: 0,
      y1: d.h,
    }));
    const win: Hole[] = [];
    for (let m = 0; m < mods; m++) {
      const xa = x0 + m * mw;
      const xb = xa + mw;
      if (front.some((d) => d.b > xa && d.a < xb)) continue;
      const c = (xa + xb) / 2;
      win.push({ u0: x1 - T - c - 0.7, u1: x1 - T - c + 0.7, y0: 0.9, y1: 2.6 });
    }
    iw.push({ ax: x1 - T, az: -T, bx: x0 + T, bz: -T, holes: [...holes, ...win], win });
  }
  // back: from the left corner to the right (u from x0)
  {
    const holes: Hole[] = back.map((d) => ({ u0: d.a - x0 - T, u1: d.b - x0 - T, y0: 0, y1: d.h }));
    // the outer back wall's windows run from x1 to x0: mirror them
    const lenB = W;
    const win = winHoles(
      lenB,
      back.map((d) => ({ u0: x1 - d.b, u1: x1 - d.a })),
    ).map((h) => ({
      ...h,
      u0: lenB - h.u1 - T,
      u1: lenB - h.u0 - T,
    }));
    iw.push({ ax: x0 + T, az: z0 + T, bx: x1 - T, bz: z0 + T, holes: [...holes, ...win], win });
  }
  // the sides (outer windows run from the front corner back along x1, and from the back along x0)
  {
    // (both side walls' outer windows sit at D - tc from the inner walls' start)
    const win = winHoles(D).map((h) => ({ ...h, u0: D - h.u1 - T, u1: D - h.u0 - T }));
    iw.push({ ax: x0 + T, az: -T, bx: x0 + T, bz: z0 + T, holes: win, win });
    iw.push({ ax: x1 - T, az: z0 + T, bx: x1 - T, bz: -T, holes: win, win });
  }
  for (const w of iw) {
    if (plan.finish === "paper" || plan.finish === "plaster") {
      // a board wainscot to the dado, paper or plaster above
      G.col("#4a3020").mat(WL.P_BOARD, 0, INT);
      holedWall(
        G,
        WL.P_BOARD,
        w.ax,
        w.az,
        w.bx,
        w.bz,
        yb,
        yb + 1.05,
        w.holes,
        (ua, ub, ya, ybb) => [ua / 4, ya / 4, ub / 4, ybb / 4],
      );
      G.col(plan.wallColor, 1).mat(finishLayer, 0, INT);
      holedWall(G, finishLayer, w.ax, w.az, w.bx, w.bz, yb + 1.05, yt, w.holes, finUV);
      // Never span a real doorway or window with an otherwise decorative rail.
      const len = Math.hypot(w.bx - w.ax, w.bz - w.az),
        ux = (w.bx - w.ax) / len,
        uz = (w.bz - w.az) / len;
      const nx = -uz,
        nz = ux;
      D2.col("#3a2418");
      for (const [a, b] of solidSpans(
        0,
        len,
        w.holes.filter((h) => h.y0 < yb + 1.11 && h.y1 > yb + 1.05),
      ))
        beam(
          D2,
          w.ax + ux * a + nx * 0.03,
          yb + 1.08,
          w.az + uz * a + nz * 0.03,
          w.ax + ux * b + nx * 0.03,
          yb + 1.08,
          w.az + uz * b + nz * 0.03,
          0.06,
        );
    } else {
      G.col(plan.wallColor, 1).mat(finishLayer, 0, INT);
      holedWall(G, finishLayer, w.ax, w.az, w.bx, w.bz, yb, yt, w.holes, finUV);
    }
    // windows from inside: a frame, glazing bars and the glass (daylight through it)
    const len = Math.hypot(w.bx - w.ax, w.bz - w.az);
    const ux = (w.bx - w.ax) / len;
    const uz = (w.bz - w.az) / len;
    const nx = -uz;
    const nz = ux;
    for (const h of w.win) {
      const pa = [w.ax + ux * h.u0, w.az + uz * h.u0] as const;
      const pb = [w.ax + ux * h.u1, w.az + uz * h.u1] as const;
      const ya = Math.max(yb + 0.3, h.y0);
      // the glass sits in the middle of the wall's thickness
      // (the view through old wavy glass: the dusty street low, pale sky above the far roofs)
      const ym = ya + (h.y1 - ya) * 0.42;
      G.col("#a08466").mat(WL.PAINT, 0, INT);
      wallq(
        G,
        pa[0] - nx * 0.06,
        pa[1] - nz * 0.06,
        pb[0] - nx * 0.06,
        pb[1] - nz * 0.06,
        ya,
        ym,
        [0, 0, 1, 0.42],
      );
      G.col("#98aab4");
      wallq(
        G,
        pa[0] - nx * 0.06,
        pa[1] - nz * 0.06,
        pb[0] - nx * 0.06,
        pb[1] - nz * 0.06,
        ym,
        h.y1,
        [0, 0.42, 1, 1],
      );
      // reveals
      G.col("#8a7258").mat(WL.P_BOARD);
      G.quad(
        pa[0],
        ya,
        pa[1],
        pa[0] - nx * 0.06,
        ya,
        pa[1] - nz * 0.06,
        pa[0] - nx * 0.06,
        h.y1,
        pa[1] - nz * 0.06,
        pa[0],
        h.y1,
        pa[1],
        [0, 0, 0.1, 1],
      );
      G.quad(
        pb[0] - nx * 0.06,
        ya,
        pb[1] - nz * 0.06,
        pb[0],
        ya,
        pb[1],
        pb[0],
        h.y1,
        pb[1],
        pb[0] - nx * 0.06,
        h.y1,
        pb[1] - nz * 0.06,
        [0, 0, 0.1, 1],
      );
      // frame, sill and bars
      D2.col("#e8dcc0");
      const mid = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2] as const;
      beam(
        D2,
        pa[0] + nx * 0.02,
        ya,
        pa[1] + nz * 0.02,
        pb[0] + nx * 0.02,
        ya,
        pb[1] + nz * 0.02,
        0.08,
      );
      beam(
        D2,
        pa[0] + nx * 0.02,
        h.y1,
        pa[1] + nz * 0.02,
        pb[0] + nx * 0.02,
        h.y1,
        pb[1] + nz * 0.02,
        0.08,
      );
      beam(
        D2,
        mid[0] - nx * 0.04,
        ya,
        mid[1] - nz * 0.04,
        mid[0] - nx * 0.04,
        h.y1,
        mid[1] - nz * 0.04,
        0.04,
      );
      beam(
        D2,
        pa[0] - nx * 0.04,
        (ya + h.y1) / 2,
        pa[1] - nz * 0.04,
        pb[0] - nx * 0.04,
        (ya + h.y1) / 2,
        pb[1] - nz * 0.04,
        0.04,
      );
    }
  }

  // ---- floor and ceiling ----
  const stair = plan.items.find((it) => it.k === "stair") as
    Extract<RoomItem, { k: "stair" }> | undefined;
  const landing = plan.items.find((it) => it.k === "landing") as
    Extract<RoomItem, { k: "landing" }> | undefined;
  if (b.t === "stable") {
    G.col("#8a6a44").mat(WL.YARD);
    G.flat(x0 + T, z0 + T, x1 - T, -T, fl + 0.01, [0, 0, W / 8, D / 8]);
  } else {
    G.col(plan.finish === "stone" ? "#9a8e7a" : "#b8966e").mat(
      plan.finish === "stone" ? WL.P_STONE : WL.DECK,
    );
    G.flat(x0 + T, z0 + T, x1 - T, -T, fl + 0.01, [0, 0, W / 4, D / 4]);
  }
  // the ceiling: boards on joists; the stair well is open above the saloon's stair (which
  // climbs the left wall to a landing in the front-left corner)
  const hole =
    stair && landing
      ? { x0: x0 + T, x1: Math.max(stair.x1, landing.r.x1), z0: stair.zLow, z1: -T }
      : null;
  const cy = ceil - 0.02;
  const ceilRect = (ax: number, az: number, bx: number, bz: number) => {
    if (bx - ax < 1e-3 || bz - az < 1e-3) return;
    G.col("#6a5038").mat(WL.DECK);
    G.quad(ax, cy, az, bx, cy, az, bx, cy, bz, ax, cy, bz, [az / 4, ax / 4, bz / 4, bx / 4]);
  };
  if (hole) {
    ceilRect(x0 + T, z0 + T, x1 - T, hole.z0);
    ceilRect(hole.x1, hole.z0, x1 - T, -T);
  } else ceilRect(x0 + T, z0 + T, x1 - T, -T);
  D2.col("#5a4030");
  for (let x = x0 + 1; x < x1 - 0.5; x += 1.4) {
    const inWell = hole && x < hole.x1 + 0.1;
    boxP(
      D2,
      WL.TIMBER,
      x - 0.08,
      cy - 0.22,
      z0 + T,
      x + 0.08,
      cy,
      inWell ? hole!.z0 : -T,
      false,
      true,
    );
  }
  if (hole && stair && landing) {
    // the stair hall above: the landing's floor, partitions round the well, a ceiling
    const up = landing.y;
    const top = Math.min(H - 0.1, up + 3.1);
    const lx1 = landing.r.x1;
    G.col("#b89a78").mat(WL.DECK);
    boxP(G, WL.DECK, x0 + T, up - 0.2, landing.r.z0, lx1, up, 0.02, true, true);
    G.col(plan.wallColor, 1).mat(WL.PAINT, 0, INT);
    // (walls facing into the hall, which lies to their west: a -> b with the hall on the left)
    wallP(G, WL.PAINT, lx1, landing.r.z0, lx1, -T, up, top); // the landing's east side
    wallP(G, WL.PAINT, stair.x1, landing.r.z0, lx1, landing.r.z0, up, top); // behind the landing, beside the well
    wallP(G, WL.PAINT, stair.x1, stair.zLow, stair.x1, landing.r.z0, cy, top); // the well's east side
    wallP(G, WL.PAINT, x0 + T, stair.zLow, stair.x1, stair.zLow, cy, top); // the well's back end
    // the partitions' far faces (toward the rest of the upper floor, never reached but closed)
    wallP(G, WL.PAINT, lx1 + 0.1, -T, lx1 + 0.1, landing.r.z0, up, top);
    wallP(G, WL.PAINT, stair.x1 + 0.1, landing.r.z0, stair.x1 + 0.1, stair.zLow, cy, top);
    // the outer walls' inner faces up the hall (the balcony door in the front one)
    wallP(G, WL.PAINT, x0 + T, -T, x0 + T, stair.zLow, up, top);
    holedWall(
      G,
      WL.PAINT,
      lx1,
      -T,
      x0 + T,
      -T,
      up,
      top,
      ud ? [{ u0: lx1 - ud.b, u1: lx1 - ud.a, y0: up, y1: up + 2.3 }] : [],
      finUV,
    );
    G.col("#8a6a4a").mat(WL.P_BOARD);
    G.quad(
      x0 + T,
      top,
      stair.zLow,
      lx1,
      top,
      stair.zLow,
      lx1,
      top,
      -T,
      x0 + T,
      top,
      -T,
      [0, 0, 1, 2],
    );
    lantern(B, lx1 - 0.3, up + 2.2, landing.r.z0 + 0.6, 3);
    // the landing's rail along the well
    D2.col("#6a4a30");
    boxP(
      D2,
      WL.TIMBER,
      stair.x1,
      up + 0.95,
      landing.r.z0 - 0.04,
      lx1,
      up + 1.02,
      landing.r.z0 + 0.04,
    );
  }

  // ---- the furniture ----
  const lampAt = (x: number, y: number, z: number, hang: boolean) => {
    if (hang) {
      D2.col("#2a2420");
      beam(D2, x, y + 0.4, z, x, ceil - 0.02, z, 0.025, WL.IRON);
    }
    lantern(B, x, fl + y - 0.2, z, 0);
    B.pools.col("#ffb060").mat(0, 0, INT);
    B.pools.flat(x - 2.4, z - 2.4, x + 2.4, z + 2.4, fl + 0.03);
  };
  for (const it of plan.items) roomItem(B, it, fl, ceil, r, lampAt);
  // (back to the outside's flags for whatever the building draws next)
  G.mat(plainL, seed, AO);
  D2.mat(WL.TIMBER, 0.5, 0);
  void yb;
}

/** one piece of furniture (local frame, floor height fl) */
function roomItem(
  B: BGeo,
  it: RoomItem,
  fl: number,
  ceil: number,
  r: () => number,
  lampAt: (x: number, y: number, z: number, hang: boolean) => void,
) {
  const G = B.main;
  const D2 = B.detail;
  G.mat(WL.P_BOARD, 0, INT);
  D2.mat(WL.TIMBER, 0.5, INT);
  switch (it.k) {
    case "bar": {
      // a long mahogany counter with a brass foot rail and a zinc top
      const R2 = it.r;
      G.col("#4a2416").mat(WL.P_BOARD);
      boxP(G, WL.P_BOARD, R2.x0, fl, R2.z0, R2.x1, fl + 1.05, R2.z1);
      G.col("#6a3a22").mat(WL.TIMBER);
      boxP(
        G,
        WL.TIMBER,
        R2.x0 - 0.08,
        fl + 1.05,
        R2.z0 - 0.08,
        R2.x1 + 0.1,
        fl + 1.12,
        R2.z1 + 0.08,
      );
      // panels on the customer side
      D2.col("#3a1c10");
      for (let z = R2.z0 + 0.3; z < R2.z1 - 0.2; z += 0.8)
        boxP(D2, WL.TIMBER, R2.x1, fl + 0.2, z, R2.x1 + 0.03, fl + 0.85, z + 0.6);
      D2.col("#c8a040");
      beam(D2, R2.x1 + 0.25, fl + 0.2, R2.z0, R2.x1 + 0.25, fl + 0.2, R2.z1, 0.05, WL.PAINT);
      // spittoons, glasses and a bottle on the bar
      for (let z = R2.z0 + 1; z < R2.z1 - 0.5; z += 1.6 + r()) {
        D2.col("#b8c8c8");
        cylP(D2, WL.PAINT, R2.x0 + 0.35 + r() * 0.2, fl + 1.12, z, 0.04, 0.1, 6);
        if (r() < 0.5) {
          D2.col(pick(["#3a5a2a", "#6a3a1a", "#2a2a3a"], r));
          cylP(D2, WL.PAINT, R2.x0 + 0.5, fl + 1.12, z + 0.3, 0.05, 0.28, 6, 0.03);
        }
      }
      D2.col("#8a7a4a");
      cylP(D2, WL.IRON, R2.x1 + 0.5, fl, R2.z0 + 1.5, 0.16, 0.22, 8, 0.12, false);
      break;
    }
    case "backbar": {
      // shelves of bottles either side of a tall mirror
      const R2 = it.r;
      G.col("#3a1c10").mat(WL.P_BOARD);
      boxP(G, WL.P_BOARD, R2.x0, fl, R2.z0, R2.x1, fl + 0.95, R2.z1);
      boxP(G, WL.P_BOARD, R2.x0, fl + 0.95, R2.z0, R2.x0 + 0.25, fl + 2.9, R2.z1);
      G.col("#5a2e1a");
      boxP(G, WL.TIMBER, R2.x0, fl + 2.9, R2.z0 - 0.1, R2.x1 + 0.05, fl + 3.05, R2.z1 + 0.1);
      const mz0 = (R2.z0 + R2.z1) / 2 - 1.6;
      const mz1 = mz0 + 3.2;
      // the mirror: pale silver catching the room's light
      G.col("#c8ccd0").mat(WL.PAINT, 0, INT);
      G.quad(
        R2.x0 + 0.26,
        fl + 1.2,
        mz1,
        R2.x0 + 0.26,
        fl + 1.2,
        mz0,
        R2.x0 + 0.26,
        fl + 2.7,
        mz0,
        R2.x0 + 0.26,
        fl + 2.7,
        mz1,
        [0, 0, 1, 1],
      );
      D2.col("#c8a040");
      boxP(D2, WL.TIMBER, R2.x0 + 0.25, fl + 1.15, mz0 - 0.08, R2.x0 + 0.32, fl + 2.75, mz0);
      boxP(D2, WL.TIMBER, R2.x0 + 0.25, fl + 1.15, mz1, R2.x0 + 0.32, fl + 2.75, mz1 + 0.08);
      boxP(D2, WL.TIMBER, R2.x0 + 0.25, fl + 2.7, mz0, R2.x0 + 0.32, fl + 2.78, mz1);
      // shelves with bottles either side
      for (const [za, zb] of [
        [R2.z0 + 0.1, mz0 - 0.15],
        [mz1 + 0.15, R2.z1 - 0.1],
      ] as const) {
        for (const y of [1.35, 1.85, 2.35]) {
          D2.col("#5a2e1a");
          boxP(D2, WL.TIMBER, R2.x0 + 0.25, fl + y - 0.04, za, R2.x0 + 0.55, fl + y, zb);
          for (let z = za + 0.1; z < zb - 0.05; z += 0.12 + r() * 0.08) {
            D2.col(pick(["#2a4a2a", "#6a3a14", "#3a2a1a", "#8a6a2a", "#2a2a4a", "#9a3a2a"], r));
            const h = 0.22 + r() * 0.12;
            cylP(D2, WL.PAINT, R2.x0 + 0.4, fl + y, z, 0.035, h, 5, 0.02);
          }
        }
      }
      break;
    }
    case "table": {
      // a round card table, its chairs pulled up; cards and chips on some
      D2.col("#5a3a22");
      cylP(D2, WL.TIMBER, it.x, fl + 0.72, it.z, 0.55, 0.05, 12);
      cylP(D2, WL.TIMBER, it.x, fl, it.z, 0.06, 0.72, 6);
      cylP(D2, WL.TIMBER, it.x, fl, it.z, 0.3, 0.05, 8, 0.25);
      if (it.cards) {
        D2.col("#2a5a2a").mat(WL.PAINT, 0, INT);
        D2.flat(it.x - 0.35, it.z - 0.35, it.x + 0.35, it.z + 0.35, fl + 0.775, [0, 0, 1, 1]);
        for (let i = 0; i < 6; i++) {
          D2.col(pick(["#f2eee4", "#c83a2a", "#2a4a8a"], r));
          cylP(
            D2,
            WL.PAINT,
            it.x + (r() - 0.5) * 0.5,
            fl + 0.77,
            it.z + (r() - 0.5) * 0.5,
            0.025,
            0.02 + r() * 0.05,
            6,
          );
        }
      }
      for (let c = 0; c < it.chairs; c++) {
        const a = (c / it.chairs) * Math.PI * 2 + r() * 0.5;
        const cx = it.x + Math.cos(a) * 0.95;
        const cz = it.z + Math.sin(a) * 0.95;
        D2.col("#6a4428");
        oboxP(D2, WL.TIMBER, cx, fl + 0.44, cz, 0.42, 0.05, 0.42, -a);
        for (const [lx, lz] of [
          [-0.17, -0.17],
          [0.17, -0.17],
          [-0.17, 0.17],
          [0.17, 0.17],
        ] as const) {
          const px = cx + lx * Math.cos(a) - lz * Math.sin(a);
          const pz = cz + lx * Math.sin(a) + lz * Math.cos(a);
          boxC(D2, WL.TIMBER, px, fl, pz, 0.04, 0.44, 0.04);
        }
        const bx = cx + Math.cos(a) * 0.2;
        const bz = cz + Math.sin(a) * 0.2;
        oboxP(D2, WL.TIMBER, bx, fl + 0.46, bz, 0.04, 0.5, 0.4, -a);
      }
      break;
    }
    case "piano": {
      // an upright piano against the wall, lid open, a stool before it
      G.col("#2a1810").mat(WL.P_BOARD);
      boxP(G, WL.P_BOARD, it.x - 0.8, fl, it.z - 0.35, it.x + 0.8, fl + 1.3, it.z + 0.1);
      boxP(G, WL.P_BOARD, it.x - 0.8, fl + 0.7, it.z + 0.1, it.x + 0.8, fl + 0.78, it.z + 0.35);
      D2.col("#f2eee4").mat(WL.PAINT, 0, INT);
      D2.flat(it.x - 0.72, it.z + 0.12, it.x + 0.72, it.z + 0.3, fl + 0.785, [0, 0, 1, 1]);
      D2.col("#1a1210");
      for (let x = it.x - 0.7; x < it.x + 0.7; x += 0.055)
        if (Math.floor((x - it.x) / 0.055 + 100) % 7 !== 2)
          boxP(D2, WL.PAINT, x, fl + 0.785, it.z + 0.12, x + 0.025, fl + 0.81, it.z + 0.22);
      D2.col("#e8dcc0");
      D2.quad(
        it.x - 0.5,
        fl + 0.85,
        it.z + 0.11,
        it.x + 0.5,
        fl + 0.85,
        it.z + 0.11,
        it.x + 0.5,
        fl + 1.2,
        it.z + 0.02,
        it.x - 0.5,
        fl + 1.2,
        it.z + 0.02,
        [0, 0, 1, 1],
      );
      D2.col("#3a2418");
      cylP(D2, WL.TIMBER, it.x, fl, it.z + 0.85, 0.2, 0.5, 8);
      break;
    }
    case "stair": {
      // treads and risers, a boarded side toward the room, a newel post and a banister
      const n = Math.max(8, Math.round((it.y - fl) / 0.19));
      const run = it.zHigh - it.zLow;
      for (let i = 0; i < n; i++) {
        const za = it.zLow + (run * i) / n;
        const zb = it.zLow + (run * (i + 1)) / n;
        const h = fl + ((it.y - fl) * (i + 1)) / n;
        G.col("#8a6a48").mat(WL.DECK);
        boxP(G, WL.DECK, it.x0, h - 0.05, za, it.x1, h, zb + 0.03, true, false);
        G.col("#5a4030");
        wallq(G, it.x1, za, it.x0, za, h - (it.y - fl) / n, h - 0.05, [0, 0, 1, 0.2]);
      }
      // the closed side toward the room: a sloped stringer and boards under it, to the floor
      const side = it.x0 < 0 ? it.x1 : it.x0; // (the room side: away from the wall it climbs)
      const sn = it.x0 < 0 ? 1 : -1;
      G.col("#5a3a24").mat(WL.P_BOARD);
      if (sn > 0) {
        G.v(side, fl, it.zHigh, 1, 0, 0, run / 4, 0);
        G.v(side, fl, it.zLow, 1, 0, 0, 0, INT);
        G.v(side, it.y, it.zHigh, 1, 0, 0, run / 4, (it.y - fl) / 4);
      } else {
        G.v(side, fl, it.zLow, -1, 0, 0, 0, INT);
        G.v(side, fl, it.zHigh, -1, 0, 0, run / 4, 0);
        G.v(side, it.y, it.zHigh, -1, 0, 0, run / 4, (it.y - fl) / 4);
      }
      // the banister
      D2.col("#3a2418");
      boxP(D2, WL.TIMBER, side - 0.06, fl, it.zLow - 0.06, side + 0.06, fl + 1.2, it.zLow + 0.06);
      beam(D2, side, fl + 1.1, it.zLow, side, it.y + 0.95, it.zHigh, 0.07);
      for (let i = 1; i < n; i += 2) {
        const z = it.zLow + (run * i) / n;
        const h = fl + ((it.y - fl) * i) / n;
        boxP(D2, WL.TIMBER, side - 0.02, h, z - 0.02, side + 0.02, h + 0.95, z + 0.02);
      }
      break;
    }
    case "cells": {
      // the jail: cells along the back wall behind iron bars, each with a cot and a bucket
      const R2 = it.r;
      const cw = (R2.x1 - R2.x0) / it.n;
      D2.col("#2a2826");
      for (let x = R2.x0; x <= R2.x1 + 1e-3; x += 0.2)
        boxP(D2, WL.IRON, x - 0.02, fl, R2.z1 - 0.02, x + 0.02, ceil - 0.05, R2.z1 + 0.02);
      for (const y of [0.15, 1.2, 2.2])
        boxP(D2, WL.IRON, R2.x0, fl + y, R2.z1 - 0.04, R2.x1, fl + y + 0.06, R2.z1 + 0.04);
      for (let c = 1; c < it.n; c++) {
        const x = R2.x0 + c * cw;
        G.col("#9a8e7a").mat(WL.P_STONE);
        boxP(G, WL.P_STONE, x - 0.1, fl, R2.z0, x + 0.1, ceil - 0.02, R2.z1 - 0.03);
      }
      for (let c = 0; c < it.n; c++) {
        const cx = R2.x0 + (c + 0.5) * cw;
        // the cell door's hinge band and lock box
        D2.col("#3a3432");
        boxP(D2, WL.IRON, cx + 0.3, fl + 0.9, R2.z1 - 0.06, cx + 0.5, fl + 1.2, R2.z1 + 0.06);
        // a cot against the back wall, a grey blanket, a bucket
        D2.col("#5a4430");
        boxP(
          D2,
          WL.TIMBER,
          cx - cw / 2 + 0.3,
          fl + 0.35,
          R2.z0 + 0.1,
          cx + 0.5,
          fl + 0.45,
          R2.z0 + 0.9,
        );
        for (const x of [cx - cw / 2 + 0.35, cx + 0.45])
          boxP(D2, WL.TIMBER, x - 0.03, fl, R2.z0 + 0.12, x + 0.03, fl + 0.35, R2.z0 + 0.88);
        D2.col("#7a7468").mat(WL.CANVAS);
        boxP(
          D2,
          WL.CANVAS,
          cx - cw / 2 + 0.35,
          fl + 0.45,
          R2.z0 + 0.15,
          cx + 0.3,
          fl + 0.52,
          R2.z0 + 0.85,
        );
        D2.col("#6a6460");
        cylP(D2, WL.IRON, cx + cw / 2 - 0.45, fl, R2.z0 + 0.5, 0.14, 0.3, 8, 0.16);
      }
      break;
    }
    case "desk": {
      // a rolltop desk with a chair, papers and a lamp
      const c = Math.cos(it.rot);
      const s = Math.sin(it.rot);
      G.col("#5a3a22").mat(WL.P_BOARD);
      oboxP(G, WL.P_BOARD, it.x, fl, it.z, 1.5, 0.78, 0.7, it.rot);
      oboxP(G, WL.P_BOARD, it.x - s * 0.25, fl + 0.78, it.z - c * 0.25, 1.5, 0.45, 0.25, it.rot);
      D2.col("#f2eadc").mat(WL.PAINT, 0, INT);
      oboxP(
        D2,
        WL.PAINT,
        it.x + s * 0.05,
        fl + 0.78,
        it.z + c * 0.05,
        0.3,
        0.01,
        0.22,
        it.rot + 0.3,
      );
      D2.col("#6a4428");
      oboxP(D2, WL.TIMBER, it.x + s * 0.75, fl + 0.44, it.z + c * 0.75, 0.45, 0.05, 0.45, it.rot);
      oboxP(D2, WL.TIMBER, it.x + s * 0.95, fl + 0.46, it.z + c * 0.95, 0.45, 0.5, 0.05, it.rot);
      for (const lx of [-0.17, 0.17])
        for (const lz of [-0.17, 0.17]) {
          const cx = it.x + s * 0.75 + c * lx + s * lz;
          const cz = it.z + c * 0.75 - s * lx + c * lz;
          oboxP(D2, WL.TIMBER, cx, fl, cz, 0.055, 0.46, 0.055, it.rot);
        }
      lampAt(it.x + c * 0.5, 1.0, it.z - s * 0.5, false);
      break;
    }
    case "stove": {
      // a pot-bellied stove on a tin sheet, its pipe up through the ceiling
      D2.col("#2a2624");
      cylP(D2, WL.IRON, it.x, fl + 0.12, it.z, 0.22, 0.2, 10, 0.32, false);
      cylP(D2, WL.IRON, it.x, fl + 0.32, it.z, 0.32, 0.4, 10, 0.24, false);
      cylP(D2, WL.IRON, it.x, fl + 0.72, it.z, 0.24, 0.12, 10, 0.2);
      cylP(D2, WL.IRON, it.x, fl + 0.84, it.z, 0.07, ceil - fl - 0.86, 6);
      for (const [dx, dz] of [
        [-0.2, -0.2],
        [0.2, -0.2],
        [-0.2, 0.2],
        [0.2, 0.2],
      ] as const)
        boxC(D2, WL.IRON, it.x + dx, fl, it.z + dz, 0.05, 0.12, 0.05);
      D2.col("#8a8a86").mat(WL.IRON);
      D2.flat(it.x - 0.6, it.z - 0.6, it.x + 0.6, it.z + 0.6, fl + 0.035, [0, 0, 1, 1]);
      B.glow.col("#ff7a2a");
      B.glow.box(it.x, fl + 0.42, it.z + 0.3, 0.16, 0.1, 0.02);
      break;
    }
    case "rack": {
      // a gun rack on the wall: three rifles standing in it
      const c = Math.cos(it.rot);
      const s = Math.sin(it.rot);
      D2.col("#5a3a22");
      oboxP(D2, WL.TIMBER, it.x + s * 0.05, fl + 0.3, it.z + c * 0.05, 1.2, 0.08, 0.12, it.rot);
      oboxP(D2, WL.TIMBER, it.x + s * 0.05, fl + 1.5, it.z + c * 0.05, 1.2, 0.08, 0.12, it.rot);
      for (let i = -1; i <= 1; i++) {
        const px = it.x + c * i * 0.35 + s * 0.08;
        const pz = it.z - s * i * 0.35 + c * 0.08;
        D2.col("#4a2c18");
        beam(D2, px, fl + 0.3, pz, px, fl + 0.9, pz, 0.08);
        D2.col("#2a2826");
        beam(D2, px, fl + 0.9, pz, px, fl + 1.7, pz, 0.035, WL.IRON);
      }
      break;
    }
    case "board": {
      // a notice board: WANTED posters pinned up
      const c = Math.cos(it.rot);
      const s = Math.sin(it.rot);
      D2.col("#6a4a30");
      oboxP(D2, WL.TIMBER, it.x + s * 0.03, fl + 1.1, it.z + c * 0.03, 1.4, 1.0, 0.05, it.rot);
      for (let i = 0; i < 4; i++) {
        const lx = -0.45 + (i % 2) * 0.62 + (r() - 0.5) * 0.08;
        const ly = 1.35 + Math.floor(i / 2) * 0.45;
        const px = it.x + c * lx + s * 0.07;
        const pz = it.z - s * lx + c * 0.07;
        D2.col("#ffffff", 0.9).mat(WL.SIGNS, 0, INT);
        const uv = signUV(26);
        const hw = 0.24;
        D2.quad(
          px - c * hw,
          fl + ly - 0.18,
          pz + s * hw,
          px + c * hw,
          fl + ly - 0.18,
          pz - s * hw,
          px + c * hw,
          fl + ly + 0.18,
          pz - s * hw,
          px - c * hw,
          fl + ly + 0.18,
          pz + s * hw,
          uv,
        );
      }
      break;
    }
    case "counter": {
      const R2 = it.r;
      G.col("#6a4a2a").mat(WL.P_BOARD);
      boxP(G, WL.P_BOARD, R2.x0, fl, R2.z0, R2.x1, fl + 1.0, R2.z1);
      G.col("#8a6a44").mat(WL.TIMBER);
      boxP(
        G,
        WL.TIMBER,
        R2.x0 - 0.05,
        fl + 1.0,
        R2.z0 - 0.05,
        R2.x1 + 0.05,
        fl + 1.06,
        R2.z1 + 0.05,
      );
      const mx = (R2.x0 + R2.x1) / 2;
      const mz = (R2.z0 + R2.z1) / 2;
      if (it.top === "till") {
        // a brass cash register
        D2.col("#b8903a");
        boxP(D2, WL.PAINT, mx - 0.22, fl + 1.06, mz - 0.2, mx + 0.22, fl + 1.36, mz + 0.2);
        boxP(D2, WL.PAINT, mx - 0.2, fl + 1.36, mz - 0.15, mx + 0.2, fl + 1.5, mz + 0.05);
      } else if (it.top === "scale") {
        // a balance scale and big glass candy jars
        D2.col("#8a8a86");
        boxP(D2, WL.IRON, mx - 0.18, fl + 1.06, mz - 0.12, mx + 0.18, fl + 1.12, mz + 0.12);
        beam(D2, mx, fl + 1.12, mz, mx, fl + 1.42, mz, 0.03, WL.IRON);
        beam(D2, mx - 0.25, fl + 1.42, mz, mx + 0.25, fl + 1.42, mz, 0.02, WL.IRON);
        for (const dx of [-0.25, 0.25]) cylP(D2, WL.IRON, mx + dx, fl + 1.3, mz, 0.1, 0.03, 8);
      }
      for (let k = 0; k < 3; k++) {
        const jz = R2.z0 + 0.4 + k * 0.45;
        D2.col("#c8d8d8", 0.6);
        cylP(D2, WL.PAINT, R2.x0 + 0.35, fl + 1.06, jz, 0.1, 0.28, 8);
        D2.col(pick(["#c83a2a", "#e8c83a", "#3a8a3a"], r));
        cylP(D2, WL.PAINT, R2.x0 + 0.35, fl + 1.07, jz, 0.08, 0.18, 8);
      }
      break;
    }
    case "cage": {
      // the teller cage: brass bars from the counter top to above head height, two windows
      const R2 = it.r;
      const zf = R2.z1;
      D2.col("#b89040");
      for (let x = R2.x0; x <= R2.x1 + 1e-3; x += 0.12) {
        const win =
          Math.abs(x - (R2.x0 + (R2.x1 - R2.x0) * 0.3)) < 0.35 ||
          Math.abs(x - (R2.x0 + (R2.x1 - R2.x0) * 0.7)) < 0.35;
        boxP(
          D2,
          WL.PAINT,
          x - 0.012,
          fl + (win ? 1.55 : 1.06),
          zf - 0.01,
          x + 0.012,
          fl + 2.4,
          zf + 0.01,
        );
      }
      boxP(D2, WL.PAINT, R2.x0, fl + 2.4, zf - 0.03, R2.x1, fl + 2.46, zf + 0.03);
      boxP(D2, WL.PAINT, R2.x0, fl + 1.55, zf - 0.02, R2.x1, fl + 1.58, zf + 0.02);
      break;
    }
    case "vault": {
      // the vault: a great iron door set in the back wall, with its dial and handle
      G.col("#3a3a3c").mat(WL.IRON);
      boxP(
        G,
        WL.IRON,
        it.x - it.w / 2 - 0.25,
        fl,
        it.z,
        it.x + it.w / 2 + 0.25,
        fl + 2.7,
        it.z + 0.12,
      );
      G.col("#5a5a5e");
      boxP(
        G,
        WL.IRON,
        it.x - it.w / 2,
        fl + 0.1,
        it.z + 0.12,
        it.x + it.w / 2,
        fl + 2.45,
        it.z + 0.22,
      );
      D2.col("#c8a040");
      boxC(D2, WL.PAINT, it.x, fl + 1.2, it.z + 0.26, 0.34, 0.34, 0.06);
      beam(D2, it.x + 0.5, fl + 1.0, it.z + 0.3, it.x + 0.9, fl + 1.0, it.z + 0.3, 0.06, WL.PAINT);
      for (const y of [0.5, 2.0])
        boxP(
          D2,
          WL.IRON,
          it.x - it.w / 2 - 0.1,
          fl + y,
          it.z + 0.2,
          it.x - it.w / 2 + 0.25,
          fl + y + 0.25,
          it.z + 0.28,
        );
      break;
    }
    case "shelves": {
      // floor-to-ceiling shelves of goods: tins, bolts of cloth, crocks, boxes
      const R2 = it.r;
      const fx = it.face > 0 ? R2.x1 : R2.x0;
      const bx = it.face > 0 ? R2.x0 : R2.x1;
      G.col("#6a4a2a").mat(WL.P_BOARD);
      boxP(G, WL.P_BOARD, Math.min(fx, bx), fl, R2.z0, Math.max(fx, bx), fl + 2.8, R2.z0 + 0.06);
      boxP(G, WL.P_BOARD, Math.min(fx, bx), fl, R2.z1 - 0.06, Math.max(fx, bx), fl + 2.8, R2.z1);
      for (const y of [0.05, 0.6, 1.15, 1.7, 2.25, 2.75]) {
        G.col("#7a5a36");
        boxP(G, WL.TIMBER, Math.min(fx, bx), fl + y, R2.z0, Math.max(fx, bx), fl + y + 0.04, R2.z1);
        if (y > 2.6) continue;
        for (let z = R2.z0 + 0.1; z < R2.z1 - 0.15;) {
          const w = 0.12 + r() * 0.3;
          const h = 0.15 + r() * 0.3;
          const kind = r();
          const col =
            kind < 0.3
              ? pick(["#c83a2a", "#3a6a9a", "#e8c83a", "#4a8a4a"], r)
              : kind < 0.55
                ? pick(["#8a3a5a", "#3a4a7a", "#c8b88a", "#6a8a6a"], r)
                : pick(["#c8b898", "#a88a5a", "#e8e0cc"], r);
          D2.col(col);
          const x = (fx + bx) / 2;
          if (kind < 0.3) {
            for (let k = 0; k < 3; k++)
              cylP(D2, WL.PAINT, x + (k - 1) * 0.12, fl + y + 0.04, z + w / 2, 0.045, 0.12, 6);
          } else boxP(D2, WL.PAINT, x - 0.2, fl + y + 0.04, z, x + 0.2, fl + y + 0.04 + h, z + w);
          z += w + 0.04;
        }
      }
      break;
    }
    case "goods": {
      if (it.kind === "barrel") {
        D2.col("#8a5a32");
        cylP(D2, WL.TIMBER, it.x, fl, it.z, 0.3, 0.45, 10, 0.34, false);
        cylP(D2, WL.TIMBER, it.x, fl + 0.45, it.z, 0.34, 0.45, 10, 0.3);
        D2.col("#e8dcc0");
        cylP(D2, WL.PAINT, it.x, fl + 0.9, it.z, 0.27, 0.06, 10);
      } else if (it.kind === "sacks") {
        for (let k = 0; k < 4; k++) {
          D2.col(pick(["#d8ccb0", "#c8b898", "#e2d8c0"], r)).mat(WL.CANVAS);
          oboxP(
            D2,
            WL.CANVAS,
            it.x + (k % 2) * 0.5 - 0.25,
            fl + Math.floor(k / 2) * 0.3,
            it.z + (r() - 0.5) * 0.2,
            0.45,
            0.3,
            0.7,
            r() * 0.4,
          );
        }
      } else {
        for (let k = 0; k < 4; k++) {
          D2.col(pick(["#b89468", "#a8845a", "#c4a070"], r));
          oboxP(
            D2,
            WL.TIMBER,
            it.x + (k % 2) * 0.62 - 0.31,
            fl + Math.floor(k / 2) * 0.55,
            it.z,
            0.55,
            0.55,
            0.55,
            r() * 0.3,
          );
        }
      }
      break;
    }
    case "stall": {
      // a horse stall: board sides chest high, a manger, straw, a horse in some
      const R2 = it.r;
      const back = it.open > 0 ? R2.x0 : R2.x1;
      G.col("#7a5a3a").mat(WL.P_BOARD);
      boxP(G, WL.P_BOARD, R2.x0, fl, R2.z0 - 0.04, R2.x1, fl + 1.5, R2.z0 + 0.04);
      D2.col("#5a4030");
      boxP(D2, WL.TIMBER, R2.x0, fl + 1.5, R2.z0 - 0.06, R2.x1, fl + 1.58, R2.z0 + 0.06);
      const post = it.open > 0 ? R2.x1 : R2.x0;
      boxP(D2, WL.TIMBER, post - 0.08, fl, R2.z0 - 0.08, post + 0.08, ceil - 0.02, R2.z0 + 0.08);
      // manger at the back
      D2.col("#6a4a2e");
      const mx = back + (it.open > 0 ? 0.35 : -0.35);
      boxP(D2, WL.TIMBER, mx - 0.3, fl + 0.7, R2.z0 + 0.5, mx + 0.3, fl + 1.1, R2.z1 - 0.5);
      D2.col("#c8a85a").mat(WL.CANVAS);
      boxP(D2, WL.CANVAS, mx - 0.25, fl + 1.0, R2.z0 + 0.55, mx + 0.25, fl + 1.2, R2.z1 - 0.55);
      // straw on the floor
      G.col("#c8a860").mat(WL.CANVAS);
      G.flat(
        Math.min(R2.x0, R2.x1) + 0.1,
        R2.z0 + 0.1,
        Math.max(R2.x0, R2.x1) - 0.1,
        R2.z1 - 0.1,
        fl + 0.025,
        [0, 0, 2, 2],
      );
      // Riders.tsx draws the stable's horse with the same shared art kit as street teams.
      if (it.horse) r(); // preserve the surrounding furnishing's deterministic random sequence
      break;
    }
    case "bench": {
      const c = Math.cos(it.rot);
      const s = Math.sin(it.rot);
      D2.col("#6a4a2e");
      oboxP(D2, WL.TIMBER, it.x, fl + 0.42, it.z, 1.4, 0.05, 0.38, it.rot);
      for (const lx of [-0.6, 0.6])
        oboxP(D2, WL.TIMBER, it.x + c * lx, fl, it.z - s * lx, 0.06, 0.42, 0.3, it.rot);
      break;
    }
    case "lamp":
      lampAt(it.x, it.y, it.z, it.hang);
      break;
    default:
      break;
  }
}

/** a round roof ventilator (freight shed, livery) */
function D2vent(B: BGeo, x: number, y: number, z: number) {
  B.detail.col("#6a6460");
  cylP(B.detail, WL.IRON, x, y - 0.3, z, 0.35, 0.7, 10, 0.35, false);
  cylP(B.detail, WL.IRON, x, y + 0.4, z, 0.55, 0.25, 10, 0.05);
}

/** Main Street kinds: false-front businesses with a back lot */
const STREET_KINDS = new Set(["store", "hotel", "saloon", "opera", "bank", "sheriff"]);
/**
 * The parts a building's back and base need to look built rather than extruded: a stone
 * or timber sill round the foot of frame walls, a framed back door with a stoop, a stove pipe
 * through the roof, and on some Main Street buildings a lean-to on the back wall.
 */
function backWorks(
  B: BGeo,
  b: WBld,
  W: number,
  D: number,
  H: number,
  paint: string,
  plainL: number,
  seed: number,
  r: () => number,
) {
  const G = B.main;
  const x0 = -W / 2;
  const x1 = W / 2;
  const z0 = -D;
  const frame =
    b.mat === "clap" ||
    b.mat === "board" ||
    b.mat === "barn" ||
    b.mat === "log" ||
    b.mat === "white";
  // footing: fieldstone under the sill on three sides (the boardwalk or porch covers the front)
  if (frame) {
    G.col(b.mat === "log" ? "#8a8272" : "#9a9080");
    // (0.1 m proud: clear of the corner boards, which stand 0.06 off the wall)
    const backDoors =
      roomPlan(b, b.deck ?? DECK_Y, STOREY)
        ?.doors.filter((d) => d.wall === "back")
        .map((d) => ({ u0: d.a, u1: d.b })) ?? [];
    for (const [a, b] of solidSpans(x0 - 0.1, x1 + 0.1, backDoors))
      boxP(G, WL.P_STONE, a, 0, z0 - 0.1, b, 0.32, z0 + 0.12, false);
    boxP(G, WL.P_STONE, x0 - 0.1, 0, z0 + 0.12, x0 + 0.05, 0.32, -0.02, false);
    boxP(G, WL.P_STONE, x1 - 0.05, 0, z0 + 0.12, x1 + 0.1, 0.32, -0.02, false);
    G.col("#6a5038");
    for (const [a, b] of solidSpans(x0 - 0.04, x1 + 0.04, backDoors))
      boxP(G, WL.TIMBER, a, 0.32, z0 - 0.04, b, 0.44, z0 + 0.1, true, false);
  }
  const street = STREET_KINDS.has(b.t);
  const home = b.t === "house" || b.t === "shack" || b.t === "ranch";
  if (!street && !home) return;
  // (a walk-in building's back door is a real doorway, drawn with its interior; a bank or a
  // jail has none)
  if (b.walkIn) {
    if (b.t === "saloon" || b.t === "store") {
      G.col("#8a6a4a");
      boxP(G, WL.DECK, x0 + 1.25 - 0.8, 0, z0 - 0.9, x0 + 1.25 + 0.8, 0.2, z0);
    }
    return;
  }
  // the back door, near the left corner of the back wall, framed, with a plank stoop
  const dxc = x0 + 1.25;
  const dw = 0.95;
  const dh = 2.1;
  G.col("#5a4030");
  boxP(G, WL.TIMBER, dxc - dw / 2 - 0.12, 0, z0 - 0.08, dxc - dw / 2, dh + 0.12, z0);
  boxP(G, WL.TIMBER, dxc + dw / 2, 0, z0 - 0.08, dxc + dw / 2 + 0.12, dh + 0.12, z0);
  boxP(G, WL.TIMBER, dxc - dw / 2 - 0.12, dh, z0 - 0.08, dxc + dw / 2 + 0.12, dh + 0.14, z0);
  G.col(pick(["#6a3a2a", "#3a4a3a", "#5a5048", "#7a5a3a"], r)).mat(WL.P_BOARD, 0, 0);
  G.quad(
    dxc + dw / 2,
    0.05,
    z0 - 0.03,
    dxc - dw / 2,
    0.05,
    z0 - 0.03,
    dxc - dw / 2,
    dh,
    z0 - 0.03,
    dxc + dw / 2,
    dh,
    z0 - 0.03,
    [0, 0, 0.5, 1],
  );
  G.col("#2a2420");
  boxP(G, WL.IRON, dxc + dw / 2 - 0.16, 1.0, z0 - 0.07, dxc + dw / 2 - 0.1, 1.08, z0 - 0.03);
  G.col("#8a6a4a");
  boxP(G, WL.DECK, dxc - 0.8, 0, z0 - 0.9, dxc + 0.8, 0.2, z0);
  // a stove pipe up the back of the roof, with its rain cap
  if (street || r() < 0.5) {
    const px = x0 + W * (0.55 + r() * 0.3);
    const pz = z0 + 1.2;
    B.detail.col("#34302c");
    cylP(B.detail, WL.IRON, px, H - 0.5, pz, 0.11, 2.4 + (b.roof === "gable" ? W * 0.25 : 1), 7);
    const top = H - 0.5 + 2.4 + (b.roof === "gable" ? W * 0.25 : 1);
    cylP(B.detail, WL.IRON, px, top, pz, 0.24, 0.06, 7, 0.02);
  }
  // a lean-to on the back wall (a kitchen or store room): board walls, a shed roof, a window
  // and a door of its own
  if (b.lean) {
    const s = b.front === 2 ? 1 : -1;
    const lc = ((b.leanAt ?? 0.5) - 0.5) * W * s;
    const la = Math.max(x0 + 0.3, lc - b.lean / 2);
    const lb = Math.min(x1 - 0.3, lc + b.lean / 2);
    const lz = z0 - LEAN_D;
    const hi = Math.min(H - 0.3, 3.0);
    const lo = 2.2;
    G.col("#a08a6c").mat(WL.P_BOARD, seed, AO);
    wallP(G, WL.P_BOARD, lb, lz, la, lz, 0, lo);
    G.quad(la, 0, lz, la, 0, z0, la, hi, z0, la, lo, lz, [0, 0, LEAN_D / 2, hi / 2]);
    G.quad(lb, 0, z0, lb, 0, lz, lb, lo, lz, lb, hi, z0, [0, 0, LEAN_D / 2, hi / 2]);
    G.col("#b8b0a4");
    slope(G, WL.TIN, lb + 0.2, z0, la - 0.2, z0, hi + 0.08, 0, -LEAN_D - 0.3, lo - 0.08);
    // its window (a small four-pane sash) and a plank door
    const wx = (la + lb) / 2 + 0.8;
    G.col("#3a2a1c");
    boxP(G, WL.TIMBER, wx - 0.5, 0.9, lz - 0.06, wx + 0.5, 1.75, lz);
    G.col("#6a8090").mat(WL.PAINT, 0, 0);
    G.quad(
      wx + 0.42,
      0.97,
      lz - 0.07,
      wx - 0.42,
      0.97,
      lz - 0.07,
      wx - 0.42,
      1.68,
      lz - 0.07,
      wx + 0.42,
      1.68,
      lz - 0.07,
      [0, 0, 1, 1],
    );
    G.col("#3a2a1c");
    boxP(G, WL.TIMBER, wx - 0.02, 0.97, lz - 0.09, wx + 0.02, 1.68, lz - 0.07);
    boxP(G, WL.TIMBER, wx - 0.42, 1.31, lz - 0.09, wx + 0.42, 1.35, lz - 0.07);
    const ldx = la + 0.9;
    G.col("#5a4636").mat(WL.P_BOARD, 0, 0);
    G.quad(
      ldx + 0.45,
      0.05,
      lz - 0.03,
      ldx - 0.45,
      0.05,
      lz - 0.03,
      ldx - 0.45,
      1.95,
      lz - 0.03,
      ldx + 0.45,
      1.95,
      lz - 0.03,
      [0, 0, 0.5, 1],
    );
  }
  void paint;
  void plainL;
}

function building(b: WBld, r: () => number): BGeo {
  const B: BGeo = { main: new Geo(), detail: new Geo(), glow: new Geo(), pools: new Geo() };
  const { W, D } = frameOf(b);
  const G = B.main;
  const seed = (b.seed % 1000) / 1000;
  const facL = FACADE_OF[b.mat];
  const plainL = PLAIN_OF[b.mat];
  const paint =
    b.mat === "clap"
      ? PAINTS[Math.floor(b.tone * PAINTS.length)]!
      : b.mat === "white"
        ? "#f6f2ea"
        : "#ffffff";
  const trimC =
    b.mat === "clap"
      ? pick(TRIMS, r)
      : b.mat === "brick"
        ? "#d8ccb4"
        : b.mat === "adobe"
          ? "#6a4a30"
          : "#5a4030";
  const lit =
    b.t === "saloon" || b.t === "opera"
      ? BRIGHT
      : b.t === "ruin" || b.t === "tipple" || b.t === "shed"
        ? 0
        : LIT;
  const H = b.storeys * STOREY;
  // this building's own boardwalk height (they step up and down along the street)
  const DY = b.deck ?? DECK_Y;
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
  const plan = roomPlan(b, DY, STOREY);
  G.col(paint, 1).mat(facL, seed, lit + AO);
  if (!plan) wallF(G, facL, x0, 0, x1, 0, 0, H, uOff); // front
  G.mat(plainL, seed, AO);
  wallP(G, plainL, x1, 0, x1, z0, 0, H); // right side
  if (!plan) wallP(G, plainL, x1, z0, x0, z0, 0, H); // back
  wallP(G, plainL, x0, z0, x0, 0, 0, H); // left side
  // walk-in: the front and back with real doorways, and the rooms inside
  if (plan) walkIn(B, b, plan, W, D, H, facL, plainL, uOff, paint, lit, seed, r);
  // windows on the side and back walls, one per bay and storey, cut from the facade tile's
  // upper-storey row (so they match the front)
  {
    const winCol = (k: number) => (b.mat === "barn" ? (k % 2 ? 3 : 0) : (k + uOff) % FAC_COLS);
    const wallWindows = (
      ax: number,
      az: number,
      bx: number,
      bz: number,
      skipLast = false,
      doors: { u0: number; u1: number }[] = [],
    ) => {
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
          // (the ground-floor bay by the back door has the door instead)
          if (skipLast && st === 0 && k === nWin - 1) continue;
          const tc = ((k + 0.5) / nWin) * len;
          if (st === 0 && windowOverlapsDoor(tc, doors)) continue;
          const c = winCol(k + st);
          const uv = [c * 0.25 + 0.05, 0.295, c * 0.25 + 0.2, 0.465] as const;
          const pa = [ax + ux * (tc - 0.75) + nx, az + uz * (tc - 0.75) + nz] as const;
          const pb = [ax + ux * (tc + 0.75) + nx, az + uz * (tc + 0.75) + nz] as const;
          wallq(G, pa[0], pa[1], pb[0], pb[1], y0, y1, uv);
          const trim = B.detail;
          trim.col(trimC);
          const beamAt = (ta: number, ya: number, tb: number, yb: number, width: number) =>
            beam(
              trim,
              ax + ux * ta + nx * 2,
              ya,
              az + uz * ta + nz * 2,
              ax + ux * tb + nx * 2,
              yb,
              az + uz * tb + nz * 2,
              width,
              WL.PAINT,
            );
          beamAt(tc - 0.79, y0 - 0.04, tc - 0.79, y1 + 0.07, 0.11);
          beamAt(tc + 0.79, y0 - 0.04, tc + 0.79, y1 + 0.07, 0.11);
          beamAt(tc - 0.86, y0 - 0.04, tc + 0.86, y0 - 0.04, 0.15);
          beamAt(tc - 0.87, y1 + 0.06, tc + 0.87, y1 + 0.06, 0.16);
          // Slatted shutters distinguish homes and the upper hotel rooms.
          if ((b.t === "house" || b.t === "hotel" || b.t === "ranch") && (k + b.seed) % 3 !== 0) {
            trim.col(b.t === "hotel" ? "#526659" : "#735743");
            for (const sign of [-1, 1])
              for (let j = 0; j < 12; j++)
                beamAt(
                  tc + sign * 0.87,
                  y0 + (j / 12) * 2,
                  tc + sign * 1.29,
                  y0 + (j / 12) * 2,
                  0.085,
                );
          }
          G.col(paint, 1).mat(facL, seed, lit + AO);
        }
      }
    };
    wallWindows(x1, 0, x1, z0);
    wallWindows(
      x1,
      z0,
      x0,
      z0,
      !plan && (STREET_KINDS.has(b.t) || b.t === "house" || b.t === "shack" || b.t === "ranch"),
      plan?.doors.filter((d) => d.wall === "back").map((d) => ({ u0: x1 - d.b, u1: x1 - d.a })),
    );
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
    const cb = (H > 5 ? 0.27 : 0.21) + ((b.seed >> 2) & 1) * 0.02;
    // how far the boards stand proud of the walls: varied per building so neighbours differ
    const dz = 0.1 + (b.seed % 7) * 0.007;
    for (const [cx, cz] of [
      [x0, 0],
      [x1, 0],
      [x0, z0],
      [x1, z0],
    ] as const)
      // sized by height and seed so the boards of two buildings that share a wall never
      // land on exactly the same faces (identical boxes flicker against each other)
      // each board stays on its own side of the corner, so two buildings sharing a wall never
      // put boards in the same place
      boxP(
        G,
        WL.PAINT,
        cx === x0 ? x0 - 0.03 : x1 - cb,
        0,
        cz - dz,
        cx === x0 ? x0 + cb : x1 + 0.03,
        H,
        cz + dz,
        false,
      );
  }
  if (b.mat === "brick" || b.mat === "stone") {
    G.col(b.mat === "brick" ? "#d8ccb4" : "#b8ac94");
    for (const cx of [x0 + 0.25, x1 - 0.25])
      boxP(G, WL.P_STONE, cx - 0.35, 0, -0.1, cx + 0.35, H, 0.22); // pilasters
    // Foundation trim stops at the portal, leaving the actual floor threshold walkable.
    const openings =
      plan?.doors.filter((d) => d.wall === "front").map((d) => ({ u0: d.a, u1: d.b })) ?? [];
    for (const [a, b] of solidSpans(x0 - 0.13, x1 + 0.13, openings))
      boxP(G, WL.P_STONE, a, 0, -0.13, b, 0.5, 0.25);
  }

  // Layered joinery gives every street facade a real silhouette and shadow line.
  const detail = B.detail;
  detail.col(trimC);
  for (const [y, depth, thick] of [
    [H - 0.24, 0.23, 0.14],
    [H - 0.06, 0.34, 0.12],
    [H + 0.08, 0.43, 0.1],
  ] as const)
    boxP(detail, WL.PAINT, x0 - 0.18, y, -0.1, x1 + 0.18, y + thick, depth);
  for (let st = 1; st < b.storeys; st++) {
    const y = st * STOREY;
    detail.col(trimC);
    boxP(detail, WL.PAINT, x0, y - 0.16, -0.08, x1, y - 0.05, 0.18);
    // Console brackets carry the projecting course; heavier on civic masonry.
    for (let x = x0 + 0.55; x < x1 - 0.3; x += 1.4) {
      detail.col(b.mat === "brick" ? "#ab9372" : trimC);
      boxP(detail, WL.PAINT, x - 0.08, y - 0.43, 0.03, x + 0.08, y - 0.12, 0.2);
    }
  }
  if (b.porch) {
    const n0 = Math.max(2, Math.round(W / 3.5)),
      n = n0 % 2 === 0 ? n0 + 1 : n0;
    for (let i = 0; i <= n; i++) {
      const x = x0 + (i * W) / n;
      detail.col(trimC);
      for (const sign of [-1, 1])
        if (x + sign * 0.55 > x0 && x + sign * 0.55 < x1)
          beam(detail, x, DY + 2.2, 3.45, x + sign * 0.55, DY + 2.8, 3.45, 0.075, WL.PAINT);
    }
  }

  // ---- the lived-in back and the footings ----
  backWorks(B, b, W, D, H, paint, plainL, seed, r);

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
    // lifted a little per building: two shed roofs side by side would otherwise lie in one
    // plane and their overhanging eaves would flicker against each other
    const lift = ((b.seed >> 4) % 5) * 0.05;
    ridgeY = H + 0.9 + lift;
    G.col(roofL === WL.TIN ? "#c8c2b8" : "#ffffff", 1);
    slope(G, roofL, x1 + eave, 0.2, x0 - eave, 0.2, ridgeY, 0, z0 - eave - 0.2, H - 0.2 + lift);
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
    if (!b.ff) wallq(G, x0, 0, x1, 0, H, ridgeY, [0, H / 4, W / 4, ridgeY / 4]);
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
    G.quad(x0 - e, ey, e, x1 + e, ey, e, rx1, ridgeY, rz, rx0, ridgeY, rz, [
      0,
      0,
      (W + 2 * e) / 4,
      2,
    ]);
    G.quad(x1 + e, ey, z0 - e, x0 - e, ey, z0 - e, rx0, ridgeY, rz, rx1, ridgeY, rz, [
      0,
      0,
      (W + 2 * e) / 4,
      2,
    ]);
    G.v(x1 + e, ey, e, 1, 1, 0, 0, 0);
    G.v(x1 + e, ey, z0 - e, 1, 1, 0, (D + 2 * e) / 4, 0);
    G.v(rx1, ridgeY, rz, 1, 1, 0, D / 8, 2);
    G.v(x0 - e, ey, z0 - e, -1, 1, 0, 0, 0);
    G.v(x0 - e, ey, e, -1, 1, 0, (D + 2 * e) / 4, 0);
    G.v(rx0, ridgeY, rz, -1, 1, 0, D / 8, 2);
    // eave soffit (seen from below on the platform)
    G.col("#cfc2a8").mat(WL.P_CLAP);
    G.quad(x0 - e, ey, e, x0 - e, ey, z0 - e, x1 + e, ey, z0 - e, x1 + e, ey, e, [
      0,
      0,
      W / 4,
      D / 4,
    ]);
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
    boxP(G, plainL, x0, H, z0, x1, H + 0.6, 0, true);
    // the parapet's inner faces round the roof (seen from anywhere higher)
    wallP(G, plainL, x0 + 0.3, -0.3, x1 - 0.3, -0.3, H + 0.35, H + 0.6);
    wallP(G, plainL, x1 - 0.3, z0 + 0.3, x0 + 0.3, z0 + 0.3, H + 0.35, H + 0.6);
    wallP(G, plainL, x1 - 0.3, -0.3, x1 - 0.3, z0 + 0.3, H + 0.35, H + 0.6);
    wallP(G, plainL, x0 + 0.3, z0 + 0.3, x0 + 0.3, -0.3, H + 0.35, H + 0.6);
    G.col("#b8966e");
    G.flat(x0 + 0.3, z0 + 0.3, x1 - 0.3, -0.3, H + 0.35, [0, 0, W / 5, D / 5]);
    // canales: wooden spouts through the parapet that throw the rain off the roof
    B.detail.col("#5a3e28");
    for (const f of [0.3, 0.7]) {
      const zc = z0 * f;
      beam(B.detail, x1 - 0.4, H + 0.42, zc, x1 + 0.7, H + 0.36, zc, 0.16);
      beam(B.detail, x0 + 0.4, H + 0.42, zc * 0.9 - 0.4, x0 - 0.7, H + 0.36, zc * 0.9 - 0.4, 0.16);
    }
    B.detail.col("#6a4a30");
    for (let x = x0 + 0.8; x < x1 - 0.5; x += 1.3)
      cylP(B.detail, WL.TIMBER, x, H - 0.35, 0.3, 0.12, 0.01, 6, 0.12, false);
    for (let x = x0 + 0.8; x < x1 - 0.5; x += 1.3)
      beam(B.detail, x, H - 0.3, -0.2, x, H - 0.3, 0.55, 0.22);
  }

  // ---- the false front ----
  if (b.ff) {
    const ffTop = Math.max(ridgeY + 0.6, H + 1.8 + (b.storeys === 1 ? 0.6 : 0));
    falseFront(B, b, W, H, ffTop, facL, plainL, paint, trimC, r);
  } else if (b.sign >= 0 && b.t !== "stable" && b.t !== "barn") {
    // signboard on the wall above the door (a stable's board goes under its hay hood instead)
    signBoard(G, b.sign, 0, Math.min(H - 1.2, STOREY + 0.1), 0.02, Math.min(W * 0.7, 7), 0.95);
  }

  // ---- porch / balcony over the boardwalk ----
  if (b.porch > 0) {
    const pz = BOARD_D - 0.15;
    const py = STOREY - 0.2;
    const postC = r() < 0.5 ? "#efe6d2" : WOOD;
    const D2 = B.detail;
    D2.col(postC);
    const n0 = Math.max(2, Math.round(W / 3.2));
    // (a walk-in's doorway is in the middle: no post right in front of it)
    const n = n0 % 2 === 0 ? n0 + 1 : n0;
    for (let i = 0; i <= n; i++) {
      const x = x0 + 0.15 + ((W - 0.3) * i) / n;
      boxP(D2, WL.TIMBER, x - 0.09, DY, pz - 0.09, x + 0.09, py, pz + 0.09);
      // curved brackets
      beam(D2, x, py - 0.55, pz, x + (i === n ? -0.4 : 0.4), py - 0.02, pz, 0.07);
    }
    G.col(DARK_WOOD);
    boxP(G, WL.TIMBER, x0, py - 0.25, pz - 0.1, x1, py, pz + 0.1); // beam
    if (b.porch === 1) {
      const roofL2 = r() < 0.6 ? WL.TIN : WL.SHINGLE;
      // the awning sags a little between its posts (years of sun and snow), top and underside
      const nSpan = Math.max(2, Math.round(W / 3.2));
      const sagAmt = 0.04 + r() * 0.05;
      const sagAt = (x: number) =>
        sagAmt * Math.abs(Math.sin((Math.PI * (x - x0 - 0.15)) / ((W - 0.3) / nSpan)));
      const [tu, tv] = TILE_M[roofL2] ?? [4, 4];
      const run = Math.hypot(pz + 0.35, 0.55);
      const steps = nSpan * 4;
      for (let i = 0; i < steps; i++) {
        const xa = x0 + 0.01 + ((W - 0.02) * i) / steps;
        const xb = x0 + 0.01 + ((W - 0.02) * (i + 1)) / steps;
        const ya = py - sagAt(xa);
        const yb = py - sagAt(xb);
        G.col(roofL2 === WL.TIN ? "#bdb6aa" : "#ffffff").mat(roofL2);
        G.quad(xa, ya, pz + 0.35, xb, yb, pz + 0.35, xb, py + 0.55, 0, xa, py + 0.55, 0, [
          xa / tu,
          0,
          xb / tu,
          run / tv,
        ]);
        G.col("#ffffff", 0.55).mat(WL.DECK);
        G.quad(
          xb,
          yb - 0.02,
          pz + 0.35,
          xa,
          ya - 0.02,
          pz + 0.35,
          xa,
          py + 0.53,
          0,
          xb,
          py + 0.53,
          0,
          [xb / 4, 0, xa / 4, 1],
        );
      }
      lantern(B, x0 + W * 0.3, py - 0.6, pz - 0.35);
      if (W > 10) lantern(B, x1 - W * 0.3, py - 0.6, pz - 0.35);
    } else {
      // balcony: a floor on the porch beams with a railing (floored underneath too, so it reads
      // from the boardwalk below)
      D2.col(postC);
      const ry = py + 0.18;
      const rail = (xa: number, xb: number, z: number) => {
        boxP(
          D2,
          WL.TIMBER,
          xa - 0.1,
          ry + 0.95,
          z - 0.07,
          xb + 0.1,
          ry + 1.05,
          z + 0.07,
          true,
          true,
        );
        boxP(
          D2,
          WL.TIMBER,
          xa - 0.1,
          ry + 0.1,
          z - 0.05,
          xb + 0.1,
          ry + 0.16,
          z + 0.05,
          true,
          true,
        );
        for (let x = xa; x <= xb; x += 0.42)
          boxP(D2, WL.TIMBER, x - 0.03, ry, z - 0.03, x + 0.03, ry + 0.96, z + 0.03, false);
      };
      const endRail = (sx: number, z0: number, z1: number) => {
        for (let z = z0; z < z1; z += 0.42)
          boxP(D2, WL.TIMBER, sx - 0.03, ry, z - 0.03, sx + 0.03, ry + 0.96, z + 0.03, false);
        boxP(
          D2,
          WL.TIMBER,
          sx - 0.07,
          ry + 0.95,
          z0 - 0.1,
          sx + 0.07,
          ry + 1.05,
          z1 + 0.1,
          true,
          true,
        );
      };
      if (b.t === "saloon") {
        // the saloon: a balcony over the left part of its front, on its own posts, railed on
        // its three open sides (the balcony door opens onto it from the stair hall inside);
        // the batwing doors open under a plain porch roof on the right
        const bd = SALOON_BALCONY;
        const bal = saloonBalcony(W);
        const ba = bal.a;
        const bb = bal.b;
        G.col("#ffffff", 0.9);
        boxP(G, WL.DECK, ba + 0.01, py, -0.1, bb, py + 0.18, bd, true, true);
        rail(ba, bb, bd - 0.07);
        endRail(ba + 0.07, 0.2, bd - 0.07);
        endRail(bb - 0.07, 0.2, bd - 0.07);
        const nb = Math.max(2, Math.round((bb - ba) / 3.2));
        for (let i = 0; i <= nb; i++) {
          const x = ba + 0.15 + ((bb - ba - 0.3) * i) / nb;
          boxP(D2, WL.TIMBER, x - 0.09, DY, bd - 0.2, x + 0.09, py, bd - 0.02);
        }
        // the ground rail between them (under the balcony is the saloon's front, not a walk)
        for (const y of [0.75, 1.15])
          boxP(D2, WL.TIMBER, ba, DY + y, bd - 0.15, bb, DY + y + 0.08, bd - 0.07, true, true);
        for (let x = ba + 0.4; x < bb; x += 0.5)
          boxP(D2, WL.TIMBER, x - 0.03, DY, bd - 0.14, x + 0.03, DY + 1.2, bd - 0.08, false);
        // the porch roof over the rest of the front (and in front of the balcony)
        G.col("#ffffff");
        slope(
          G,
          WL.SHINGLE,
          ba + 0.01,
          bd + 0.02,
          bb,
          bd + 0.02,
          py - 0.02,
          0,
          pz + 0.35 - (bd + 0.02),
          py - 0.35,
        );
        G.col("#bdb6aa");
        slope(G, WL.TIN, bb, 0, x1 - 0.01, 0, py + 0.55, 0, pz + 0.35, py);
        lantern(B, (bb + x1) / 2, py - 0.6, pz - 0.35);
      } else {
        G.col("#ffffff", 0.9);
        boxP(G, WL.DECK, x0 + 0.01, py, -0.1, x1 - 0.01, py + 0.18, pz + 0.3, true, true);
        rail(x0, x1, pz + 0.19);
        endRail(x0 + 0.04, 0.3, pz);
        endRail(x1 - 0.04, 0.3, pz);
      }
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
  if (
    b.t !== "house" &&
    b.t !== "shack" &&
    b.t !== "adobe" &&
    b.t !== "ranch" &&
    b.t !== "barn" &&
    b.t !== "shed" &&
    b.t !== "station"
  ) {
    // exactly the lot's frontage: neighbours' decks meet edge to edge, never overlap
    const dx0 = x0;
    const dx1 = x1;
    G.col("#ffffff", 0.95);
    G.mat(WL.DECK);
    G.quad(dx0, DY, BOARD_D, dx1, DY, BOARD_D, dx1, DY, 0, dx0, DY, 0, [
      0,
      0,
      (dx1 - dx0) / 4,
      BOARD_D / 4,
    ]);
    G.col(DARK_WOOD);
    boxP(G, WL.TIMBER, dx0, 0, BOARD_D - 0.12, dx1, DY, BOARD_D, false); // edge beam
    boxP(G, WL.TIMBER, dx0, 0, 0, dx0 + 0.1, DY, BOARD_D, false);
    boxP(G, WL.TIMBER, dx1 - 0.1, 0, 0, dx1, DY, BOARD_D, false);
    // Each real entrance gets a visible stair, including the offset saloon doorway.
    // Every rise stays below the capsule's 20 cm walking clearance.
    if (DY > 0.19) {
      const entries = plan?.doors.filter((d) => d.wall === "front") ?? [{ a: -1.1, b: 1.1 }];
      const count = Math.ceil(DY / 0.18);
      G.col("#8a6a4a");
      for (const entry of entries)
        for (let step = 1; step < count; step++)
          boxP(
            G,
            WL.DECK,
            entry.a - 0.25,
            0,
            BOARD_D,
            entry.b + 0.25,
            (DY * step) / count,
            BOARD_D + (count - step) * 0.42,
          );
    }
  } else if (b.porch > 0 && b.t === "adobe") {
    // an adobe's ramada: peeled pole posts, round vigas across, a roof of laid sticks
    // (latillas) under packed brush
    const D2 = B.detail;
    const pd = 2.4;
    D2.col("#8a6a48");
    for (const x of [x0 + 0.4, x1 - 0.4]) cylP(D2, WL.TIMBER, x, 0, pd, 0.1, 2.5, 6, 0.09);
    beam(D2, x0 + 0.2, 2.5, pd, x1 - 0.2, 2.5, pd, 0.18);
    for (let x = x0 + 0.5; x < x1 - 0.3; x += 0.9) beam(D2, x, 2.62, -0.1, x, 2.62, pd + 0.3, 0.12);
    G.col("#9a7a52");
    for (let z = 0.1; z < pd + 0.2; z += 0.12)
      boxP(G, WL.TIMBER, x0 + 0.2, 2.68, z, x1 - 0.2, 2.72, z + 0.08, true, true);
    G.col("#a88a5a").mat(WL.SAND);
    G.flat(x0 + 0.25, 0.05, x1 - 0.25, pd + 0.25, 2.76, [0, 0, W / 3, 1]);
  } else if (b.porch > 0) {
    // houses: a small porch on posts
    G.col("#ffffff", 0.9);
    G.mat(WL.DECK);
    G.quad(x0 + 0.5, 0.35, 2.2, x1 - 0.5, 0.35, 2.2, x1 - 0.5, 0.35, 0, x0 + 0.5, 0.35, 0, [
      0,
      0,
      (W - 1) / 4,
      0.55,
    ]);
    G.col(DARK_WOOD);
    boxP(G, WL.TIMBER, x0 + 0.5, 0, 2.05, x1 - 0.5, 0.35, 2.2, false);
    G.col("#8a6a4a");
    boxP(G, WL.DECK, -1.1, 0, 2.2, 1.1, 0.175, 2.62);
    const D2 = B.detail;
    D2.col("#e8dcc0");
    for (const x of [x0 + 0.6, x1 - 0.6])
      boxP(D2, WL.TIMBER, x - 0.07, 0.35, 2.0, x + 0.07, 2.7, 2.14);
    G.col("#bdb6aa");
    slope(G, WL.TIN, x0 + 0.3, 0, x1 - 0.3, 0, 3.0, 0, 2.4, 2.65);
    lantern(B, 0.8, 2.2, 1.9, 4);
  }

  // Rear exits must meet the same walking rise as front entrances.
  if (plan && DY > 0.19) {
    const count = Math.ceil(DY / 0.18);
    for (const door of plan.doors.filter((d) => d.wall === "back"))
      for (let step = 1; step < count; step++) {
        G.col("#8a6a4a");
        boxP(
          G,
          WL.DECK,
          door.a - 0.25,
          0,
          -D - (count - step) * 0.42,
          door.b + 0.25,
          (DY * step) / count,
          -D,
        );
      }
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
  if (b.t === "shed") {
    // the freight shed: a plank loading dock along its track side at wagon-bed height, big
    // sliding doors, freight waiting on the dock, a roof ventilator
    G.col("#8a6a48").mat(WL.DECK);
    boxP(G, WL.DECK, x0 + 0.3, 0, 0, x1 - 0.3, 1.05, 2.5, true, false);
    G.col("#5a4030");
    for (let x = x0 + 0.5; x < x1 - 0.3; x += 1.8)
      boxP(G, WL.TIMBER, x - 0.1, 0, 2.3, x + 0.1, 1.0, 2.5, false);
    boxP(G, WL.TIMBER, x0 + 0.3, 0.83, 2.44, x1 - 0.3, 1.03, 2.56); // edge beam, just under the planks' top
    // wooden steps down at one end
    for (let k = 0; k < 4; k++)
      boxP(G, WL.DECK, x1 - 1.6, 0, 2.56 + k * 0.3, x1 - 0.4, 1.02 - k * 0.26, 2.86 + k * 0.3);
    // the doors: plank leaves on an iron rail, one slid half open
    G.col("#7a5a3e").mat(WL.P_BOARD);
    for (const [xa, xb] of [
      [-W * 0.3 - 1.6, -W * 0.3 + 1.6],
      [W * 0.3 - 1.6 + 1.2, W * 0.3 + 1.6 + 1.2],
    ] as const)
      boxP(G, WL.P_BOARD, xa, 1.05, 0.04, xb, 3.2, 0.14);
    G.col("#1a1410").mat(WL.PAINT, 0, 0);
    G.quad(
      W * 0.3 - 1.6,
      1.05,
      0.03,
      W * 0.3 - 0.4,
      1.05,
      0.03,
      W * 0.3 - 0.4,
      3.15,
      0.03,
      W * 0.3 - 1.6,
      3.15,
      0.03,
      [0, 0, 1, 1],
    );
    G.col("#2a2826");
    boxP(G, WL.IRON, x0 + 0.5, 3.25, 0.04, x1 - 0.5, 3.35, 0.18);
    // freight on the dock
    const T2 = templates();
    for (let i = 0; i < 4; i++) {
      const k = ["crates", "barrels", "sacks", "crate"][i]! as
        "crates" | "barrels" | "sacks" | "crate";
      const t = T2[k];
      if (t)
        B.detail.stamp(
          t.d,
          x0 + 2 + (i * (W - 4)) / 3.2,
          1.05,
          1.3 + (r() - 0.5) * 0.6,
          r() * 3,
          0.9,
          0.9,
          0.9,
          _tint.setRGB(1, 1, 1),
        );
    }
    // ventilator on the ridge
    D2vent(B, 0, H + W * 0.25 + 0.2, D * -0.5);
  }
  if (b.t === "adobe") {
    // by the door: a string of red chiles drying and clay ollas
    const D2 = B.detail;
    const rx = 1.0 + r() * 0.3;
    for (let i = 0; i < 9; i++) {
      D2.col(pick(["#a8281c", "#c0301e", "#8a2016"], r)).mat(WL.PAINT, 0, 0);
      oboxP(
        D2,
        WL.PAINT,
        rx + (r() - 0.5) * 0.05,
        2.2 - i * 0.13,
        0.12,
        0.12,
        0.12,
        0.12,
        r() * 3,
        true,
      );
    }
    D2.col("#5a4a30");
    beam(D2, rx, 2.35, 0.12, rx, 1.05, 0.12, 0.02, WL.PAINT);
    D2.col("#a8643a");
    cylP(D2, WL.P_ADOBE, -1.4, 0, 0.45, 0.2, 0.28, 8, 0.28, false);
    cylP(D2, WL.P_ADOBE, -1.4, 0.28, 0.45, 0.28, 0.24, 8, 0.12);
  }
  if (b.t === "saloon" && !b.walkIn) {
    // batwing doors in the middle bay, a big lit glow spilling out at night
    B.detail.col("#7a3a22");
    boxP(B.detail, WL.TIMBER, -0.75, 0.9, 0.06, -0.04, 2.0, 0.12);
    boxP(B.detail, WL.TIMBER, 0.04, 0.9, 0.06, 0.75, 2.0, 0.12);
    G.col("#1c140e").mat(WL.PAINT, 0, 0);
    G.quad(-0.85, DY, 0.03, 0.85, DY, 0.03, 0.85, 2.5, 0.03, -0.85, 2.5, 0.03, [0, 0, 0.1, 0.1]);
    B.glow.col("#ff9a40", 0.55);
    B.glow.quad(-0.8, DY, 0.08, 0.8, DY, 0.08, 0.8, 2.45, 0.08, -0.8, 2.45, 0.08);
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
    G.quad(
      x1 + 0.05,
      1.6,
      -D * 0.25,
      x1 + 0.05,
      1.6,
      -D * 0.25 - 3.2,
      x1 + 0.05,
      2.4,
      -D * 0.25 - 3.2,
      x1 + 0.05,
      2.4,
      -D * 0.25,
      uv,
    );
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
  B.glow.quad(-0.45, 0.02, 0.05, 0.45, 0.02, 0.05, 0, h - 0.45, 0.05, 0, h - 0.45, 0.05);
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
      G.quad(
        px0,
        h,
        pz0,
        px1,
        h,
        pz1,
        px1 - nx * th,
        h,
        pz1 - nz * th,
        px0 - nx * th,
        h,
        pz0 - nz * th,
        [0, 0, 0.3, 0.1],
      );
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
  G.col("#f6f2ea").mat(WL.F_CHURCH, seed, CANDLE + AO);
  wallF(G, WL.F_CHURCH, x1, 0, x1, z0, 0, H, 0);
  wallF(G, WL.F_CHURCH, x0, z0, x0, 0, 0, H, 0);
  G.mat(WL.P_CLAP, seed, AO);
  wallP(G, WL.P_CLAP, x1, z0, x0, z0, 0, H);
  wallP(G, WL.P_CLAP, x0, 0, x1, 0, 0, H);
  const ridge = H + (W / 2) * 1.0;
  G.col("#6a5a4e");
  slope(G, WL.SHINGLE, 0, -2, 0, z0 - 0.4, ridge, x1 + 0.4, 0, H - 0.4);
  slope(G, WL.SHINGLE, 0, z0 - 0.4, 0, -2, ridge, x0 - 0.4, 0, H - 0.4);
  // The wider tower occupies the nave roof's front centre; retain only the side eaves.
  slope(G, WL.SHINGLE, 4, 0.4, 4, -2, ridge - 4, x1 + 0.4 - 4, 0, H - 0.4);
  slope(G, WL.SHINGLE, -4, -2, -4, 0.4, ridge - 4, x0 - 0.4 + 4, 0, H - 0.4);
  G.col("#f6f2ea").mat(WL.P_CLAP, seed, AO);
  G.quad(x0, H, 0, -4, H, 0, -4, ridge - 4, 0, x0, H, 0);
  G.quad(4, H, 0, x1, H, 0, x1, H, 0, 4, ridge - 4, 0);
  gable(G, WL.P_CLAP, x1, z0, x0, z0, H, ridge);
  // the back (the side players reach from the yard): two tall windows, a rose window in the
  // gable, a vestry door, corner boards and a stone sill, so it is not a blank slab
  G.col("#ffffff").mat(WL.F_CHURCH, seed, CANDLE);
  const win = (cx: number, y0: number, y1: number, hw: number) =>
    G.quad(
      cx + hw,
      y0,
      z0 - 0.03,
      cx - hw,
      y0,
      z0 - 0.03,
      cx - hw,
      y1,
      z0 - 0.03,
      cx + hw,
      y1,
      z0 - 0.03,
      [0.33 / 4, 0.3 / 4, 0.67 / 4, 1.7 / 4],
    );
  win(-3.2, 1.4, 4.6, 0.7);
  win(3.2, 1.4, 4.6, 0.7);
  win(0, H + 1.2, H + 3.4, 0.9);
  G.col("#f4efe4");
  for (const cx of [-3.2, 3.2]) boxP(G, WL.PAINT, cx - 0.95, 1.2, z0 - 0.14, cx + 0.95, 1.4, z0);
  boxP(G, WL.PAINT, -1.15, H + 1.0, z0 - 0.14, 1.15, H + 1.2, z0);
  G.col("#5a2e1c").mat(WL.PAINT, 0, 0);
  G.quad(
    0.7,
    0,
    z0 - 0.03,
    -0.7,
    0,
    z0 - 0.03,
    -0.7,
    2.4,
    z0 - 0.03,
    0.7,
    2.4,
    z0 - 0.03,
    [0, 0, 1, 1],
  );
  G.col("#f4efe4");
  boxP(G, WL.PAINT, -0.95, 2.4, z0 - 0.14, 0.95, 2.62, z0);
  for (const [cx, cz] of [
    [x0, 0],
    [x1, 0],
    [x0, z0],
    [x1, z0],
  ] as const)
    boxC(G, WL.PAINT, cx, 0, cz, 0.3, H, 0.3, false);
  G.col("#b8ac94");
  boxP(G, WL.P_STONE, x0 - 0.2, 0, z0 - 0.2, x1 + 0.2, 0.45, z0 + 0.1);
  boxP(G, WL.P_STONE, x0 - 0.2, 0, z0 + 0.1, x0 + 0.1, 0.45, 0);
  boxP(G, WL.P_STONE, x1 - 0.1, 0, z0 + 0.1, x1 + 0.2, 0.45, 0);
  // the bell tower: square shaft, open belfry with the bell, a tall spire and a cross
  const tw = 8;
  const tz0 = -2;
  const tz1 = 8;
  const tx0 = -tw / 2;
  const tx1 = tw / 2;
  const shaft = BELFRY_Y;
  G.col("#f6f2ea").mat(WL.P_CLAP, seed, AO);
  // A real door aligned with the spiral's street portal (world z=-.7).
  wallP(G, WL.P_CLAP, tx0, tz1, -0.2, tz1, 0, shaft);
  wallP(G, WL.P_CLAP, 1.6, tz1, tx1, tz1, 0, shaft);
  wallP(G, WL.P_CLAP, -0.2, tz1, 1.6, tz1, 2.9, shaft);
  wallP(G, WL.P_CLAP, tx1, tz1, tx1, tz0, 0, shaft);
  wallP(G, WL.P_CLAP, tx0, tz0, tx0, tz1, 0, shaft);
  G.col("#f4efe4");
  boxP(G, WL.PAINT, -0.4, 2.9, tz1, 1.8, 3.2, tz1 + 0.12);
  G.col("#ffffff").mat(WL.F_CHURCH, seed, CANDLE);
  G.quad(-0.8, 6.2, tz1 + 0.02, 0.8, 6.2, tz1 + 0.02, 0.8, 9.6, tz1 + 0.02, -0.8, 9.6, tz1 + 0.02, [
    0.33 / 4 + 0.0,
    0.3 / 4,
    0.67 / 4,
    1.7 / 4,
  ]);
  // Flush stone threshold: the access lobby's floor is at street grade.
  G.col("#b8ac94");
  boxP(G, WL.P_STONE, -0.9, -0.08, tz1, 2.3, 0, tz1 + 1.2);
  // belfry: corner posts, rail, open arches, the bell
  const by0 = shaft;
  const by1 = shaft + 3.6;
  G.col("#f6f2ea");
  const belfry = westernBelfry()[0]!;
  const hole = belfry.hole;
  const h = { u0: -hole.z1, u1: -hole.z0, v0: hole.x0 + 132, v1: hole.x1 + 132 };
  for (const [u0, v0, u1, v1] of [
    [tx0 - 0.2, tz0 - 0.2, h.u0, tz1 + 0.2],
    [h.u1, tz0 - 0.2, tx1 + 0.2, tz1 + 0.2],
    [h.u0, tz0 - 0.2, h.u1, h.v0],
    [h.u0, h.v1, h.u1, tz1 + 0.2],
  ])
    boxP(G, WL.P_CLAP, u0!, by0 - 0.3, v0!, u1!, by0, v1!, true, true);
  for (const [cx, cz] of [
    [tx0 + 0.25, tz0 + 0.25],
    [tx1 - 0.25, tz0 + 0.25],
    [tx0 + 0.25, tz1 - 0.25],
    [tx1 - 0.25, tz1 - 0.25],
  ] as const)
    boxC(G, WL.P_CLAP, cx, by0, cz, 0.5, by1 - by0, 0.5);
  // All sides have guards now that the outside staircase has been removed.
  for (const side of [0, 1, 2, 3]) {
    const along = side % 2 === 0;
    const zz = side === 0 ? tz0 + 0.1 : tz1 - 0.1;
    const xx = side === 1 ? tx1 - 0.1 : tx0 + 0.1;
    if (along) boxP(G, WL.P_CLAP, tx0, by0 + 0.1, zz - 0.08, tx1, by0 + 1.0, zz + 0.08);
    else boxP(G, WL.P_CLAP, xx - 0.08, by0 + 0.1, tz0, xx + 0.08, by0 + 1.0, tz1);
  }
  boxP(G, WL.P_CLAP, tx0 - 0.25, by1, tz0 - 0.25, tx1 + 0.25, by1 + 0.5, tz1 + 0.25, true, false);
  // The shared room supplies the ceiling, beams and bell. Draw only the outside eave's
  // underside here, so two coplanar ceilings cannot flicker through one another.
  const rr0 = belfry.spec.roof;
  const roof = { u0: -rr0.z1, u1: -rr0.z0, v0: rr0.x0 + 132, v1: rr0.x1 + 132 };
  for (const [u0, v0, u1, v1] of [
    [tx0 - 0.25, tz0 - 0.25, roof.u0, tz1 + 0.25],
    [roof.u1, tz0 - 0.25, tx1 + 0.25, tz1 + 0.25],
    [roof.u0, tz0 - 0.25, roof.u1, roof.v0],
    [roof.u0, roof.v1, roof.u1, tz1 + 0.25],
  ])
    G.quad(u0!, by1, v0!, u1!, by1, v0!, u1!, by1, v1!, u0!, by1, v1!, [0, 0, 1, 1]);
  // spire
  G.col("#5e5048").mat(WL.SHINGLE, 0, 0);
  const sy = by1 + 0.5;
  const spireH = 9;
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
  // Flank the new door centered at u=.7, leaving its opening and trim unobstructed.
  lantern(B, 2.3, 2.4, tz1 + 0.25, 5);
  lantern(B, -0.9, 2.4, tz1 + 0.25, 5);
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
  // inner faces, a board's thickness inside (a neighbour's wall may share the outer plane)
  wallP(G, WL.P_BOARD, x0 + 0.2, -0.2, x0 + 0.2, z0 + 0.2, 0, H);
  wallP(G, WL.P_BOARD, x0 + 0.2, z0 + 0.2, x1 - 0.2, z0 + 0.2, 0, H);
  wallP(G, WL.P_BOARD, x1 - 0.2, z0 + 0.2, x1 - 0.2, -0.2, 0, H);
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
  for (const x of [x0 + 0.2, x0 + W / 3, x1 - W / 3, x1 - 0.2])
    boxP(G, WL.TIMBER, x - 0.12, 0, -0.12, x + 0.12, H, 0.12);
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
  for (let i = 0; i < 6; i++)
    beam(
      B.detail,
      x0 + 0.1,
      1.6 + r() * 0.8,
      z0 + 1 + i * 0.5,
      x0 + 0.1,
      1.0 + r() * 0.4,
      z0 + 1 + i * 0.5,
      0.05,
      WL.IRON,
    );
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
  G.quad(
    0.8,
    y0 + 0.2,
    0.2,
    -0.8,
    y0 + 0.2,
    0.2,
    -0.8,
    y0 - 1.4,
    2.6,
    0.8,
    y0 - 1.4,
    2.6,
    [0, 0, 0.4, 0.7],
  );
  signBoard(G, b.sign, 0, y1 - 1.3, 0.02, Math.min(W * 0.8, 5), 0.8);
  void r;
  return B;
}

// ---------------------------------------------------------------------------------------
// prop templates (local space, origin at the base centre, +z = front)

type PKey =
  | WProp["k"]
  | "wheelL"
  | "pebble"
  | "horsebody"
  | "horseleg"
  | "riderTorso"
  | "riderHat"
  | "riderLegs";
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
    if (["bush", "grass", "straw", "tumble", "garden"].includes(k)) d.excludeSince(0);
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
    // The parked wagon's pole folds up, with a support pin through its axle hinge.
    beam(d, 0, 0.5, 1.3, 0, 0.62, 2.05, 0.13);
    beam(d, 0, 0.62, 2.05, 0, 2.45, 2.1, 0.1);
    beam(d, -0.94, 0.45, 1.3, 0.94, 0.45, 1.3, 0.13, WL.IRON);
    beam(d, -0.94, 0.6, -1.3, 0.94, 0.6, -1.3, 0.13, WL.IRON);
    beam(d, -0.55, 0.58, -1.3, -0.55, 0.8, 1.3, 0.1, WL.IRON);
    beam(d, 0.55, 0.58, -1.3, 0.55, 0.8, 1.3, 0.1, WL.IRON);
    // Spoke-wheel hubs and iron tyres read as a connected undercarriage.
    for (const z of [-1.3, 1.3])
      for (const x of [-0.9, 0.9])
        beam(d, x - 0.13, z < 0 ? 0.6 : 0.45, z, x + 0.13, z < 0 ? 0.6 : 0.45, z, 0.2, WL.IRON);
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
    const seg = 24;
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
    // Closely spaced steam-bent hoops support the canvas, tied to the wagon rails.
    for (const z of [-1.72, -0.9, 0, 0.9, 1.58]) {
      d.col("#8d704c");
      for (let j = 0; j < 24; j++) {
        const a = (j / 24) * Math.PI,
          b = ((j + 1) / 24) * Math.PI;
        beam(
          d,
          Math.cos(a) * 0.878,
          1.3 + Math.sin(a) * 1.088,
          z,
          Math.cos(b) * 0.878,
          1.3 + Math.sin(b) * 1.088,
          z,
          0.04,
        );
      }
      for (const side of [-1, 1])
        beam(d, side * 0.89, 1.35, z, side * 0.77, 1.1, z, 0.017, WL.TIMBER);
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
    for (let i = 0; i < 9; i++)
      pads.push([(r() - 0.5) * 1.1, 0.2 + r() * 0.8, (r() - 0.5) * 1.1, r() * 3]);
    for (const [x, y, z, a] of pads) {
      d.col(pick(["#86a45a", "#94ad62", "#7a9850"], r));
      oboxP(d, WL.PAINT, x, y, z, 0.48, 0.55, 0.1, a);
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
      d.add(
        ico,
        new THREE.Matrix4()
          .makeTranslation(x, rad * 0.8, z)
          .multiply(new THREE.Matrix4().makeScale(1, 0.75, 1)),
      );
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
    d.col("#c8a080");
    addUV(d, ico, new THREE.Matrix4().makeTranslation(0, 0.25, 0), WL.SAND);
    ico.dispose();
  });
  make("pebble", (d) => {
    // a cheap stone (20 faces) for the scree at the cliffs' feet
    const ico = new THREE.IcosahedronGeometry(1, 0);
    const pos = ico.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const k = 0.8 + fbm(x * 2 + 1, z * 2 + y, 3) * 0.4;
      pos.setXYZ(i, x * k, Math.max(-0.3, y) * k, z * k);
    }
    ico.computeVertexNormals();
    d.col("#c8a080");
    addUV(d, ico, new THREE.Matrix4().makeTranslation(0, 0.3, 0), WL.SAND);
    ico.dispose();
  });
  make("deadtree", (d) => {
    d.col("#7a6a5a");
    const limb = (
      x: number,
      y: number,
      z: number,
      a: number,
      e: number,
      len: number,
      t: number,
      depth: number,
    ) => {
      const ex = x + Math.cos(a) * Math.cos(e) * len;
      const ey = y + Math.sin(e) * len;
      const ez = z + Math.sin(a) * Math.cos(e) * len;
      beam(d, x, y, z, ex, ey, ez, t);
      if (depth > 0)
        for (let k = 0; k < 2; k++)
          limb(
            ex,
            ey,
            ez,
            a + (r() - 0.5) * 1.8,
            e - 0.1 + (r() - 0.5) * 0.6,
            len * 0.65,
            t * 0.62,
            depth - 1,
          );
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
  make("straw", (d) => {
    // loose straw kicked about on the ground: a scatter of thin pale stalks and a few tufts
    for (let i = 0; i < 70; i++) {
      const a = r() * 6.28;
      const rr = Math.sqrt(r()) * 1.4;
      const x = Math.cos(a) * rr;
      const z = Math.sin(a) * rr;
      const ang = r() * 3.14;
      const len = 0.15 + r() * 0.25;
      d.col(pick(["#d8c07a", "#c8a860", "#e2cc88", "#b89a56"], r)).mat(WL.CANVAS);
      oboxP(d, WL.CANVAS, x, 0.01 + r() * 0.02, z, len, 0.012, 0.02, ang, true);
    }
    for (let i = 0; i < 4; i++) {
      d.col("#c8aa62").mat(WL.CANVAS);
      oboxP(d, WL.CANVAS, (r() - 0.5) * 1.6, 0, (r() - 0.5) * 1.6, 0.35, 0.08, 0.25, r() * 3, true);
    }
  });
  make("brokencrate", (d) => {
    // a smashed crate: one side still standing, the rest of its boards scattered
    d.col("#a8845a");
    boxP(d, WL.TIMBER, -0.4, 0, -0.4, 0.4, 0.55, -0.34);
    boxP(d, WL.TIMBER, -0.4, 0, -0.4, -0.34, 0.45, 0.2);
    for (let i = 0; i < 6; i++) {
      d.col(pick(["#b89468", "#9a7a4e", "#c4a070"], r));
      oboxP(
        d,
        WL.TIMBER,
        (r() - 0.3) * 1.2,
        0.02 + i * 0.012,
        (r() - 0.3) * 1.2,
        0.75,
        0.025,
        0.12,
        r() * 3,
        true,
      );
    }
  });
  make("brokenbarrel", (d) => {
    // a stove-in barrel on its side, staves sprung, hoops rusting
    d.col("#8a5a32");
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      if (i === 3 || i === 4) continue;
      const y = 0.32 + Math.sin(a) * 0.3;
      const z = Math.cos(a) * 0.3;
      oboxP(d, WL.TIMBER, 0, y, z, 0.85, 0.035, 0.18, 0, true);
    }
    d.col("#5a3a2a");
    for (let i = 0; i < 3; i++)
      oboxP(d, WL.TIMBER, 0.6 + r() * 0.5, 0.02, (r() - 0.5) * 0.8, 0.8, 0.03, 0.14, r() * 3, true);
    d.col("#4a3a30");
    for (const x of [-0.3, 0.3]) {
      for (let i = 0; i < 10; i++) {
        const a0 = (i / 10) * Math.PI * 2;
        const a1 = ((i + 1) / 10) * Math.PI * 2;
        if (i === 3) continue;
        beam(
          d,
          x,
          0.32 + Math.sin(a0) * 0.32,
          Math.cos(a0) * 0.32,
          x,
          0.32 + Math.sin(a1) * 0.32,
          Math.cos(a1) * 0.32,
          0.03,
          WL.IRON,
        );
      }
    }
  });
  make("picket", (d) => {
    // a picket fence section, 2 m along x: two posts, two rails, pointed pickets; whitewash
    // gone grey and patchy
    d.col("#aaa290");
    // (the right-hand post is a touch stouter and lower: where sections meet it encloses the
    // next section's left post instead of sharing its faces)
    boxP(d, WL.TIMBER, -1.05, 0, -0.05, -0.95, 1.05, 0.05);
    boxP(d, WL.TIMBER, 0.935, 0, -0.065, 1.065, 1.0, 0.065);
    d.col("#a49c8a");
    for (const y of [0.25, 0.75]) boxP(d, WL.PAINT, -1, y, 0.05, 1, y + 0.07, 0.09);
    for (let x = -0.93; x < 0.95; x += 0.13) {
      const h = 0.92 + (r() - 0.5) * 0.04;
      d.col(r() < 0.25 ? "#8e8676" : r() < 0.5 ? "#b8b0a0" : "#c8c2b2");
      boxP(d, WL.TIMBER, x - 0.035, 0.05, 0.09, x + 0.035, h, 0.12, false);
      // the point
      d.v(x - 0.035, h, 0.12, 0, 0.3, 1, 0, 0);
      d.v(x + 0.035, h, 0.12, 0, 0.3, 1, 1, 0);
      d.v(x, h + 0.07, 0.12, 0, 0.3, 1, 0.5, 1);
      d.v(x + 0.035, h, 0.09, 0, 0.3, -1, 0, 0);
      d.v(x - 0.035, h, 0.09, 0, 0.3, -1, 1, 0);
      d.v(x, h + 0.07, 0.09, 0, 0.3, -1, 0.5, 1);
    }
  });
  make("clothesline", (d) => {
    // two T-posts 4.8 m apart, a sagging line, washing pegged out on it
    d.col("#8a7258");
    for (const x of [-2.4, 2.4]) {
      boxP(d, WL.TIMBER, x - 0.05, 0, -0.05, x + 0.05, 2.1, 0.05);
      boxP(d, WL.TIMBER, x - 0.04, 1.95, -0.35, x + 0.04, 2.03, 0.35);
    }
    d.col("#d8d0c0");
    for (const z of [-0.28, 0.28]) {
      for (let i = 0; i < 8; i++) {
        const xa = -2.4 + (4.8 * i) / 8;
        const xb = -2.4 + (4.8 * (i + 1)) / 8;
        const sag = (x: number) => 1.98 - (1 - (x / 2.4) ** 2) * 0.12;
        beam(d, xa, sag(xa), z, xb, sag(xb), z, 0.015, WL.PAINT);
      }
    }
    const cloths = ["#e8e2d4", "#b84a3a", "#4a6a8a", "#d8c89a", "#f2eee4", "#7a8a5a"];
    for (let i = 0; i < 5; i++) {
      const x = -1.9 + i * 0.95 + (r() - 0.5) * 0.3;
      const w = 0.45 + r() * 0.35;
      const h = 0.5 + r() * 0.5;
      const z = r() < 0.5 ? -0.28 : 0.28;
      d.col(cloths[Math.floor(r() * cloths.length)]!).mat(WL.CANVAS);
      const top = 1.98 - (1 - (x / 2.4) ** 2) * 0.12;
      d.quad(
        x - w / 2,
        top - h,
        z,
        x + w / 2,
        top - h,
        z,
        x + w / 2,
        top,
        z,
        x - w / 2,
        top,
        z,
        [0, 0, 1, 1],
      );
      d.quad(
        x + w / 2,
        top - h,
        z,
        x - w / 2,
        top - h,
        z,
        x - w / 2,
        top,
        z,
        x + w / 2,
        top,
        z,
        [0, 0, 1, 1],
      );
    }
  });
  make("garden", (d) => {
    // a vegetable patch: a board edge round furrowed earth and rows of greens and bean poles
    d.col("#6a4a30").mat(WL.MUD);
    d.flat(-1.6, -2, 1.6, 2, 0.04, [0, 0, 0.8, 1]);
    d.col("#7a5a3a");
    boxP(d, WL.TIMBER, -1.7, 0, -2.1, 1.7, 0.14, -1.95, false);
    boxP(d, WL.TIMBER, -1.7, 0, 1.95, 1.7, 0.14, 2.1, false);
    boxP(d, WL.TIMBER, -1.7, 0, -2.1, -1.55, 0.14, 2.1, false);
    boxP(d, WL.TIMBER, 1.55, 0, -2.1, 1.7, 0.14, 2.1, false);
    const leaf = new THREE.IcosahedronGeometry(1, 0);
    for (let row = 0; row < 4; row++) {
      const x = -1.15 + row * 0.77;
      // a hilled furrow of darker soil under each row
      d.col("#5a3e28");
      boxP(d, WL.MUD, x - 0.2, 0.04, -1.85, x + 0.2, 0.1, 1.5, false);
      for (let z = -1.7; z < 1.4; z += 0.36) {
        const s = 0.13 + r() * 0.09;
        // a leafy clump: a squashed, lumpy ball of bright greens (not a cube)
        d.col(pick(["#7aa048", "#8ab050", "#6a9440", "#a0b858"], r));
        addUV(
          d,
          leaf,
          new THREE.Matrix4()
            .makeTranslation(x + (r() - 0.5) * 0.08, 0.1 + s * 0.45, z)
            .multiply(new THREE.Matrix4().makeRotationY(r() * 3))
            .multiply(new THREE.Matrix4().makeScale(s * 1.3, s * 0.75, s * 1.3)),
          WL.CANVAS,
        );
      }
    }
    // bean poles at one end, with vines twining up them
    for (const x of [-1.15, -0.38, 0.39, 1.16]) {
      d.col("#8a7258");
      beam(d, x - 0.1, 0, 1.85, x, 1.5, 1.7, 0.03);
      d.col(pick(["#5a8a3a", "#6a9a44"], r));
      for (let k = 0; k < 5; k++) {
        const t = 0.15 + k * 0.18;
        addUV(
          d,
          leaf,
          new THREE.Matrix4()
            .makeTranslation(x - 0.1 + 0.1 * t, t * 1.5, 1.85 - 0.15 * t)
            .multiply(new THREE.Matrix4().makeScale(0.11, 0.13, 0.11)),
          WL.CANVAS,
        );
      }
    }
    leaf.dispose();
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
    boxP(d, WL.TIMBER, -0.8, 0.47, -0.24, 0.8, 0.9, -0.2);
    for (const x of [-0.7, 0.7]) boxP(d, WL.TIMBER, x - 0.05, 0, -0.2, x + 0.05, 0.42, 0.2);
  });
  make("tumble", (d) => {
    // a dry tumbleweed fetched up against something: a loose ball of curling twigs
    d.col("#b49c68").mat(WL.PAINT);
    const tw = tumbleweedGeometry(0.45, 40, 3, 5);
    d.add(tw, new THREE.Matrix4().makeTranslation(0, 0.4, 0));
    tw.dispose();
  });
  make("bones", (d) => {
    d.col("#ece4d2").mat(WL.PAINT);
    boxP(d, WL.PAINT, -0.18, 0, -0.25, 0.18, 0.2, 0.2);
    beam(d, -0.15, 0.15, -0.2, -0.55, 0.35, -0.3, 0.06);
    beam(d, 0.15, 0.15, -0.2, 0.55, 0.35, -0.3, 0.06);
    for (let i = 0; i < 5; i++)
      beam(d, -0.3, 0.05, 0.5 + i * 0.18, 0.3, 0.15, 0.5 + i * 0.18, 0.04);
  });
  make("tank", (d) => {
    // a galvanised stock tank: pale corrugated steel with rolled rims, water to the brim
    d.col("#b4b8b8");
    cylP(d, WL.PAINT, 0, 0, 0, 2.2, 0.9, 20, 2.2, false);
    d.col("#8e9494");
    for (const y of [0.05, 0.3, 0.55]) cylP(d, WL.PAINT, 0, y, 0, 2.23, 0.07, 20, 2.23, false);
    d.col("#d0d4d2");
    cylP(d, WL.PAINT, 0, 0.86, 0, 2.26, 0.08, 20, 2.26, false);
    d.col("#6a98a2");
    cylP(d, WL.PAINT, 0, 0.72, 0, 2.18, 0.04, 20, 2.18, true);
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
    // a plank ore car with iron corner straps, heaped with ore
    d.col("#8a6644");
    boxP(d, WL.TIMBER, -0.6, 0.35, -0.9, 0.6, 1.2, 0.9);
    d.col("#5a5652");
    for (const z of [-0.9, 0.9])
      for (const x of [-0.6, 0.6])
        boxP(d, WL.IRON, x - 0.05, 0.35, z - 0.05, x + 0.05, 1.22, z + 0.05);
    boxP(d, WL.IRON, -0.62, 1.12, -0.92, 0.62, 1.22, 0.92, false);
    d.col("#9a8270").mat(WL.ROCK);
    d.flat(-0.55, -0.85, 0.55, 0.85, 1.12, [0, 0, 0.1, 0.1]);
    d.col("#8a7462");
    boxP(d, WL.ROCK, -0.4, 1.12, -0.6, 0.4, 1.34, 0.6);
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
    // split firewood stacked between two end posts: round-ish logs with pale cut ends
    const log = (x: number, y: number, rad: number, len: number) => {
      const seg = 12;
      const ends: [number, number][] = [];
      for (let i = 0; i < seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        ends.push([x + Math.cos(a) * rad, y + Math.sin(a) * rad]);
      }
      const bark = pick(["#6a5038", "#7a5a3e", "#5a4430"], r);
      for (let i = 0; i < seg; i++) {
        const [ax, ay] = ends[i]!;
        const [bx, by] = ends[(i + 1) % seg]!;
        d.col(bark).mat(WL.TIMBER);
        d.quad(bx, by, -len / 2, ax, ay, -len / 2, ax, ay, len / 2, bx, by, len / 2, [
          0,
          0,
          0.3,
          len,
        ]);
      }
      // the sawn ends: pale wood
      d.col(pick(["#c8a878", "#d8b888", "#b89868"], r)).mat(WL.PAINT);
      for (const [z, sgn] of [
        [len / 2, 1],
        [-len / 2, -1],
      ] as const) {
        for (let i = 0; i < seg; i++) {
          const [ax, ay] = ends[i]!;
          const [bx, by] = ends[(i + 1) % seg]!;
          if (sgn > 0) {
            d.v(x, y, z, 0, 0, 1, 0.5, 0.5);
            d.v(ax, ay, z, 0, 0, 1, 0, 0);
            d.v(bx, by, z, 0, 0, 1, 1, 0);
          } else {
            d.v(x, y, z, 0, 0, -1, 0.5, 0.5);
            d.v(bx, by, z, 0, 0, -1, 1, 0);
            d.v(ax, ay, z, 0, 0, -1, 0, 0);
          }
        }
      }
    };
    for (let row = 0; row < 5; row++)
      for (let i = 0; i < 8 - (row > 2 ? 1 : 0); i++) {
        const x = -0.98 + i * 0.27 + (row % 2) * 0.13 + (r() - 0.5) * 0.03;
        log(x, 0.12 + row * 0.22, 0.1 + r() * 0.03, 0.9 + r() * 0.12);
      }
    d.col("#6a5038");
    for (const x of [-1.18, 1.1]) boxP(d, WL.TIMBER, x - 0.05, 0, -0.05, x + 0.05, 1.3, 0.05);
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
    for (const y of [0.6, 1.8, 3.0, 4.2])
      cylP(d, WL.IRON, 0, legH + 0.3 + y, 0, R + 0.04, 0.12, 18, R + 0.04, false);
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
      addUV(
        d,
        ico,
        new THREE.Matrix4()
          .makeTranslation(x, y + 1, 0)
          .multiply(new THREE.Matrix4().makeScale(s, s * 0.9, s * 1.1)),
        WL.ROCK,
      );
    }
    ico.dispose();
  });
  make("horse", (d) => {
    // a saddled horse standing square, nose toward +z (the coat colour is the stamp tint)
    const coat = "#ffffff";
    const dark = "#3a2a20";
    d.col(coat);
    boxP(d, WL.PAINT, -0.3, 0.98, -0.72, 0.3, 1.66, 0.7);
    boxP(d, WL.PAINT, -0.26, 1.08, -0.82, 0.26, 1.58, -0.7); // rump
    boxP(d, WL.PAINT, -0.25, 1.08, 0.7, 0.25, 1.62, 0.82); // chest
    beam(d, 0, 1.45, 0.72, 0, 2.02, 1.12, 0.3, WL.PAINT); // neck
    beam(d, 0, 2.02, 1.05, 0, 1.72, 1.6, 0.24, WL.PAINT); // head
    d.col(dark);
    beam(d, 0, 1.6, 0.66, 0, 2.18, 1.08, 0.08, WL.PAINT); // mane
    beam(d, 0, 1.55, -0.82, 0, 0.8, -1.05, 0.11, WL.PAINT); // tail
    d.cone(-0.08, 2.1, 1.05, 0.05, 0.16, 4);
    d.cone(0.08, 2.1, 1.05, 0.05, 0.16, 4);
    d.col(coat);
    for (const [x, z] of [
      [-0.19, 0.55],
      [0.19, 0.55],
      [-0.19, -0.6],
      [0.19, -0.6],
    ] as const)
      beam(d, x, 1.05, z, x, 0.12, z + 0.03, 0.13, WL.PAINT);
    d.col("#1a1410");
    for (const [x, z] of [
      [-0.19, 0.58],
      [0.19, 0.58],
      [-0.19, -0.57],
      [0.19, -0.57],
    ] as const)
      boxC(d, WL.PAINT, x, 0, z, 0.15, 0.12, 0.17);
    // saddle, blanket, stirrups
    d.col("#9a3a2a");
    boxP(d, WL.CANVAS, -0.34, 1.52, -0.25, 0.34, 1.64, 0.3);
    d.col("#5a3420");
    boxP(d, WL.TIMBER, -0.24, 1.64, -0.2, 0.24, 1.78, 0.22);
    boxP(d, WL.TIMBER, -0.1, 1.74, 0.16, 0.1, 1.92, 0.24); // horn
    d.col("#2a2420");
    for (const x of [-0.33, 0.33]) beam(d, x, 1.6, 0.02, x, 1.2, 0.02, 0.03, WL.IRON);
  });
  make("steer", (d) => {
    // a range longhorn in the pens: heavy slab body, drooped head, the wide horn span
    const hide = pick(["#6a4a34", "#4a332a", "#7a5a42", "#3a2c24", "#8a6a4c"], r);
    const dark = "#241a14";
    d.col(hide);
    boxP(d, WL.PAINT, -0.36, 0.9, -0.85, 0.36, 1.62, 0.82);
    boxP(d, WL.PAINT, -0.3, 0.96, 0.8, 0.3, 1.7, 1.0); // hump of the shoulders
    beam(d, 0, 1.5, 0.9, 0, 1.1, 1.45, 0.26, WL.PAINT); // neck, carried low
    d.col(hide);
    boxP(d, WL.PAINT, -0.16, 0.92, 1.4, 0.16, 1.34, 1.85); // head
    d.col("#d8cdb8");
    // the span: a long upward-curved horn each side
    beam(d, -0.14, 1.3, 1.5, -0.85, 1.62, 1.3, 0.07, WL.PAINT);
    beam(d, 0.14, 1.3, 1.5, 0.85, 1.62, 1.3, 0.07, WL.PAINT);
    beam(d, -0.85, 1.62, 1.3, -0.95, 1.8, 1.24, 0.05, WL.PAINT);
    beam(d, 0.85, 1.62, 1.3, 0.95, 1.8, 1.24, 0.05, WL.PAINT);
    d.col(dark);
    beam(d, 0, 1.45, -0.85, 0, 0.55, -1.06, 0.09, WL.PAINT); // tail
    d.col(hide);
    for (const [x, z] of [
      [-0.2, 0.6],
      [0.2, 0.6],
      [-0.2, -0.66],
      [0.2, -0.66],
    ] as const)
      beam(d, x, 0.95, z, x, 0.1, z + 0.02, 0.14, WL.PAINT);
    d.col("#1a1410");
    for (const [x, z] of [
      [-0.2, 0.62],
      [0.2, 0.62],
      [-0.2, -0.64],
      [0.2, -0.64],
    ] as const)
      boxC(d, WL.PAINT, x, 0, z, 0.16, 0.11, 0.18);
  });
  // ---- the moving riders' parts (Riders.tsx animates the legs; tints come per instance) ----
  make("horsebody", (d) => {
    // a saddled horse without its legs (they swing), nose toward +z
    const coat = "#ffffff";
    const dark = "#3a2a20";
    d.col(coat);
    boxP(d, WL.PAINT, -0.3, 0.98, -0.72, 0.3, 1.66, 0.7);
    boxP(d, WL.PAINT, -0.26, 1.08, -0.82, 0.26, 1.58, -0.7);
    boxP(d, WL.PAINT, -0.25, 1.08, 0.7, 0.25, 1.62, 0.82);
    beam(d, 0, 1.45, 0.72, 0, 2.02, 1.12, 0.3, WL.PAINT);
    beam(d, 0, 2.02, 1.05, 0, 1.72, 1.6, 0.24, WL.PAINT);
    d.col(dark);
    beam(d, 0, 1.6, 0.66, 0, 2.18, 1.08, 0.08, WL.PAINT);
    beam(d, 0, 1.55, -0.82, 0, 0.8, -1.05, 0.11, WL.PAINT);
    d.cone(-0.08, 2.1, 1.05, 0.05, 0.16, 4);
    d.cone(0.08, 2.1, 1.05, 0.05, 0.16, 4);
    d.col("#9a3a2a");
    boxP(d, WL.CANVAS, -0.34, 1.52, -0.25, 0.34, 1.64, 0.3);
    d.col("#5a3420");
    boxP(d, WL.TIMBER, -0.24, 1.64, -0.2, 0.24, 1.78, 0.22);
    boxP(d, WL.TIMBER, -0.1, 1.74, 0.16, 0.1, 1.92, 0.24);
    d.col("#2a2420");
    beam(d, -0.12, 1.85, 1.35, -0.25, 1.8, 0.2, 0.02, WL.IRON); // reins
    beam(d, 0.12, 1.85, 1.35, 0.25, 1.8, 0.2, 0.02, WL.IRON);
  });
  make("horseleg", (d) => {
    // one leg, hanging from its hip at the origin (swung by the instance matrix)
    d.col("#ffffff");
    beam(d, 0, 0.02, 0, 0, -0.93, 0.03, 0.13, WL.PAINT);
    d.col("#1a1410");
    boxC(d, WL.PAINT, 0, -1.05, 0.03, 0.15, 0.12, 0.17);
  });
  make("riderLegs", (d) => {
    // trousers astride the saddle and boots in the stirrups (saddle seat at y 1.78)
    d.col("#3a3430");
    for (const s of [-1, 1]) {
      beam(d, s * 0.14, 1.82, 0.02, s * 0.3, 1.66, 0.22, 0.17, WL.CANVAS);
      beam(d, s * 0.3, 1.66, 0.22, s * 0.33, 1.25, 0.08, 0.14, WL.CANVAS);
    }
    d.col("#1e1612");
    for (const s of [-1, 1])
      boxP(d, WL.TIMBER, s * 0.33 - 0.07, 1.12, 0.02, s * 0.33 + 0.07, 1.27, 0.26);
  });
  make("riderTorso", (d) => {
    // shirt and vest, arms forward to the reins, the head; tinted per rider
    d.col("#ffffff");
    boxP(d, WL.CANVAS, -0.2, 1.8, -0.12, 0.2, 2.42, 0.13);
    beam(d, -0.22, 2.36, 0, -0.2, 2.02, 0.32, 0.1, WL.CANVAS);
    beam(d, 0.22, 2.36, 0, 0.2, 2.02, 0.32, 0.1, WL.CANVAS);
    d.col("#c8946a");
    boxP(d, WL.PAINT, -0.11, 2.42, -0.1, 0.11, 2.7, 0.12);
    boxC(d, WL.PAINT, -0.19, 1.99, 0.34, 0.07, 0.07, 0.08);
    boxC(d, WL.PAINT, 0.19, 1.99, 0.34, 0.07, 0.07, 0.08);
    d.col("#5a4a3a");
    boxP(d, WL.CANVAS, -0.21, 1.95, -0.13, 0.21, 2.3, -0.1); // vest back
  });
  make("riderHat", (d) => {
    // a wide-brimmed hat (tinted per rider: white for the posse, black for the outlaw)
    d.col("#ffffff");
    cylP(d, WL.CANVAS, 0, 2.68, 0.01, 0.3, 0.03, 12, 0.3);
    cylP(d, WL.CANVAS, 0, 2.7, 0.01, 0.13, 0.17, 10, 0.12);
    d.col("#2a2420");
    cylP(d, WL.CANVAS, 0, 2.71, 0.01, 0.135, 0.04, 10, 0.135, false);
  });
  make("stagecoach", (d) => {
    // a Concord stagecoach: a curved body slung between big wheels, the driver's box up front
    d.col("#7a2a22");
    boxP(d, WL.PAINT, -0.8, 1.1, -1.7, 0.8, 2.6, 1.6);
    d.col("#c8a040");
    boxP(d, WL.PAINT, -0.82, 1.08, -1.72, 0.82, 1.22, 1.62);
    boxP(d, WL.PAINT, -0.82, 2.5, -1.72, 0.82, 2.64, 1.62);
    d.col("#141210").mat(WL.PAINT);
    for (const s of [-1, 1]) {
      const x = s * 0.81;
      d.quad(
        x,
        1.7,
        s > 0 ? 0.8 : -0.9,
        x,
        1.7,
        s > 0 ? -0.9 : 0.8,
        x,
        2.35,
        s > 0 ? -0.9 : 0.8,
        x,
        2.35,
        s > 0 ? 0.8 : -0.9,
        [0, 0, 1, 1],
      );
    }
    d.col("#3a2a20");
    boxP(d, WL.TIMBER, -0.9, 2.62, -1.5, 0.9, 2.72, 1.4); // roof rack
    for (const x of [-0.85, 0.85]) boxP(d, WL.TIMBER, x - 0.04, 2.72, -1.5, x + 0.04, 2.95, 1.4);
    d.col("#b89468");
    boxP(d, WL.CANVAS, -0.6, 2.72, -1.2, 0.5, 3.1, 0.4); // luggage under canvas
    d.col("#6a2a22");
    boxP(d, WL.PAINT, -0.75, 2.3, 1.6, 0.75, 2.4, 2.5); // driver's footboard
    boxP(d, WL.PAINT, -0.75, 2.4, 1.6, 0.75, 2.9, 1.8); // seat back
    d.col("#2a2420");
    boxP(d, WL.IRON, -0.1, 0.55, -2.2, 0.1, 0.75, 2.8); // perch
    beam(d, 0, 0.7, 2.6, 0, 0.45, 4.6, 0.1); // tongue
    wheel(d, -0.95, 0.85, -1.2, 0.85, true);
    wheel(d, 0.95, 0.85, -1.2, 0.85, true);
    wheel(d, -0.95, 0.62, 1.5, 0.62, true);
    wheel(d, 0.95, 0.62, 1.5, 0.62, true);
  });
  make("sacks", (d) => {
    const ico = new THREE.IcosahedronGeometry(0.32, 1);
    for (const [x, y, z] of [
      [-0.3, 0.26, 0],
      [0.32, 0.26, 0.05],
      [0, 0.26, -0.45],
      [0.02, 0.62, -0.12],
    ] as const) {
      d.col(pick(["#d8c8a0", "#c8b488", "#e0d4b0"], r));
      addUV(
        d,
        ico,
        new THREE.Matrix4()
          .makeTranslation(x, y, z)
          .multiply(new THREE.Matrix4().makeScale(1, 0.85, 1.25)),
        WL.CANVAS,
      );
    }
    ico.dispose();
  });
  make("sign", (d) => {
    d.col("#7a5a3a");
    boxP(d, WL.TIMBER, -0.08, 0, -0.08, 0.08, 2.2, 0.08);
  });
  // rolling stock: freight cars on the yard sidings (rolled along +z, like wagonBed)
  const car = (k: "boxcar" | "stockcar" | "flatcar", paint: string) =>
    make(k, (d, g) => {
      const LW = 1.5; // half-width
      const L0 = -6.4;
      const L1 = 6.4;
      // trucks (bogies at either end, wheel blocks hanging at the rails)
      d.col("#3a3430").mat(WL.IRON);
      for (const tz of [-4.2, 4.2]) {
        boxP(d, WL.IRON, -1.1, 0.35, tz - 1.0, 1.1, 0.95, tz + 1.0);
        for (const wz of [tz - 0.6, tz + 0.6])
          for (const wx of [-0.85, 0.85]) boxP(d, WL.IRON, wx - 0.1, 0.02, wz - 0.34, wx + 0.1, 0.72, wz + 0.34);
      }
      // underframe and end beams
      boxP(d, WL.TIMBER, -LW + 0.2, 0.85, L0, LW - 0.2, 1.25, L1);
      d.col("#4a3a2e");
      boxP(d, WL.TIMBER, -LW, 1.15, L0, LW, 1.3, L0 + 0.4);
      boxP(d, WL.TIMBER, -LW, 1.15, L1 - 0.4, LW, 1.3, L1);
      d.col(paint);
      if (k === "flatcar") {
        // deck with stake pockets and a few crates aboard
        boxP(d, WL.P_BOARD, -LW, 1.3, L0, LW, 1.5, L1);
        d.col("#6a5240");
        for (let z = L0 + 0.5; z < L1 - 0.4; z += 1.1) {
          boxP(d, WL.TIMBER, -LW - 0.04, 1.5, z, -LW + 0.14, 2.0, z + 0.14);
          boxP(d, WL.TIMBER, LW - 0.14, 1.5, z, LW + 0.04, 2.0, z + 0.14);
        }
      } else if (k === "stockcar") {
        // slatted sides so the stock breathes
        for (let z = L0 + 0.4; z < L1 - 0.3; z += 0.62) {
          boxP(d, WL.P_BOARD, -LW, 1.3, z, -LW + 0.12, 3.5, z + 0.3);
          boxP(d, WL.P_BOARD, LW - 0.12, 1.3, z, LW, 3.5, z + 0.3);
        }
        boxP(d, WL.P_BOARD, -LW, 1.3, L0, LW, 3.5, L0 + 0.4);
        boxP(d, WL.P_BOARD, -LW, 1.3, L1 - 0.4, LW, 3.5, L1);
        d.col("#7a6a56");
        // shallow arched tin roof: ridge down the centreline, eaves over each side
        slope(d, WL.TIN, 0, L0 - 0.2, 0, L1 + 0.2, 3.9, -LW - 0.2, 0, 3.5);
        slope(d, WL.TIN, 0, L0 - 0.2, 0, L1 + 0.2, 3.9, LW + 0.2, 0, 3.5);
      } else {
        // boxcar: boarded body, sliding door, tin roof
        boxP(d, WL.P_BOARD, -LW, 1.3, L0, LW, 3.6, L1, false);
        d.col("#54402e");
        boxP(d, WL.P_BOARD, -LW - 0.03, 1.5, -1.3, LW + 0.03, 3.4, 1.3);
        d.col("#7a6a56");
        slope(d, WL.TIN, 0, L0 - 0.2, 0, L1 + 0.2, 4.0, -LW - 0.2, 0, 3.6);
        slope(d, WL.TIN, 0, L0 - 0.2, 0, L1 + 0.2, 4.0, LW + 0.2, 0, 3.6);
      }
      // couplers and a brake wheel on the B end
      d.col("#3a3430").mat(WL.IRON);
      boxP(d, WL.IRON, -0.15, 0.9, L0 - 0.9, 0.15, 1.1, L0 + 0.2);
      boxP(d, WL.IRON, -0.15, 0.9, L1 - 0.2, 0.15, 1.1, L1 + 0.9);
      cylP(d, WL.IRON, LW - 0.3, 3.0, L1 - 0.2, 0.25, 0.25, 0.08);
      void g;
    });
  car("boxcar", "#8a4a34");
  car("stockcar", "#6a5138");
  car("flatcar", "#7a6248");
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
  const R = (i: number, j: number) =>
    raw[Math.max(0, Math.min(n - 1, i)) * n + Math.max(0, Math.min(n - 1, j))]!;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const h = raw[i * n + j]!;
      if (h <= 0) continue;
      const steep = Math.max(
        Math.abs(R(i + 1, j) - h),
        Math.abs(R(i - 1, j) - h),
        Math.abs(R(i, j + 1) - h),
        Math.abs(R(i, j - 1) - h),
      );
      const k = Math.min(1, steep / 5);
      const x = -half + i * 2;
      const z = -half + j * 2;
      hv[i * n + j] = h + (fbm(x * 0.21, z * 0.21, 91) - 0.5) * Math.min(3.5, h * 0.25) * k;
    }
  const H = (i: number, j: number) =>
    hv[Math.max(0, Math.min(n - 1, i)) * n + Math.max(0, Math.min(n - 1, j))]!;
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
      const tri = (
        a: [number, number, number],
        b: [number, number, number],
        c: [number, number, number],
      ) => {
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

const terraceH = (h: number, step: number) => Math.round(h / step) * step;

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
    // beyond the rim the tableland carries on: a high plateau at about the rim's height near
    // the map, breaking up into mesas and buttes with desert floor between further out
    const d = e - half;
    const plateau = terraceH(30 + 22 * fbm(x * 0.004, z * 0.004, 313), 7);
    const mask = fbm(x * 0.0032, z * 0.0032, 311, 4) + 0.55 - d / 1100;
    const top = mask > 0.5 ? plateau : 0;
    const floor = fbm(x * 0.012, z * 0.012, 312) * 6;
    // blend from the rim's own edge height over the first 40 m
    const k = Math.min(1, d / 40);
    const h = Math.max(floor, top);
    return edgeH(x, z) * (1 - k) + h * k;
  };
  const [tu, tv] = TILE_M[WL.ROCK]!;
  const nG = Math.round((R * 2) / S);
  const hs = new Float32Array((nG + 1) * (nG + 1));
  for (let a = 0; a <= nG; a++)
    for (let b = 0; b <= nG; b++) hs[a * (nG + 1) + b] = hAt(-R + a * S, -R + b * S);
  const Hs = (a: number, b: number) =>
    hs[Math.max(0, Math.min(nG, a)) * (nG + 1) + Math.max(0, Math.min(nG, b))]!;
  const _n = new THREE.Vector3();
  for (let a = 0; a < nG; a++)
    for (let b = 0; b < nG; b++) {
      const x0 = -R + a * S;
      const z0 = -R + b * S;
      if (x0 >= -half && x0 + S <= half && z0 >= -half && z0 + S <= half) continue;
      const hmax = Math.max(Hs(a, b), Hs(a + 1, b), Hs(a, b + 1), Hs(a + 1, b + 1));
      const hmin = Math.min(Hs(a, b), Hs(a + 1, b), Hs(a, b + 1), Hs(a + 1, b + 1));
      // only real cliffs get the strata; mesa tops and gentle slopes are red-brown grit
      const rockTri = hmax > 6 && hmax - hmin > S * 0.55;
      G.mat(rockTri ? WL.ROCK : WL.SAND, 0.3, 0);
      const v = (aa: number, bb: number) => {
        const x = -R + aa * S;
        const z = -R + bb * S;
        const h = Hs(aa, bb);
        _n.set(Hs(aa - 1, bb) - Hs(aa + 1, bb), S * 2, Hs(aa, bb - 1) - Hs(aa, bb + 1)).normalize();
        const k = rockTri ? 0.85 + Math.min(0.2, h / 200) : 0.95;
        if (rockTri) G.colLinear(k, k * 0.92, k * 0.86);
        else if (h > 6) G.colLinear(k * 0.9, k * 0.6, k * 0.45);
        else G.colLinear(k, k * 0.97, k * 0.94);
        G.v(
          x,
          h,
          z,
          _n.x,
          _n.y,
          _n.z,
          rockTri ? (x + z * 0.7) / tu : x / 9,
          rockTri ? h / tv : z / 9,
        );
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
      G.quad(
        bx + q[0] * sp,
        0,
        bz + q[1] * sp,
        bx + p[0] * sp,
        0,
        bz + p[1] * sp,
        bx + p[0],
        skirt,
        bz + p[1],
        bx + q[0],
        skirt,
        bz + q[1],
        [0, 0, 4, 1],
      );
      // sheer walls
      G.colLinear(0.95, 0.86, 0.8);
      G.quad(
        bx + q[0],
        skirt,
        bz + q[1],
        bx + p[0],
        skirt,
        bz + p[1],
        bx + p[0] * 0.97,
        h,
        bz + p[1] * 0.97,
        bx + q[0] * 0.97,
        h,
        bz + q[1] * 0.97,
        [0, skirt / tv, 3, h / tv],
      );
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
      G.quad(
        RAIL_X - 2.1,
        0.2,
        ze,
        RAIL_X - 1.4,
        0.2,
        ze,
        RAIL_X - 1.4,
        0.2,
        z,
        RAIL_X - 2.1,
        0.2,
        z,
        [0, 0, 0.3, 3],
      );
      G.quad(
        RAIL_X - 3,
        0.01,
        ze,
        RAIL_X - 2.1,
        0.2,
        ze,
        RAIL_X - 2.1,
        0.2,
        z,
        RAIL_X - 3,
        0.01,
        z,
        [0, 0, 0.3, 3],
      );
      G.quad(
        RAIL_X + 1.4,
        0.2,
        ze,
        RAIL_X + 2.1,
        0.2,
        ze,
        RAIL_X + 2.1,
        0.2,
        z,
        RAIL_X + 1.4,
        0.2,
        z,
        [0, 0, 0.3, 3],
      );
      G.quad(
        RAIL_X + 2.1,
        0.2,
        ze,
        RAIL_X + 3,
        0.01,
        ze,
        RAIL_X + 3,
        0.01,
        z,
        RAIL_X + 2.1,
        0.2,
        z,
        [0, 0, 0.3, 3],
      );
      G.quad(
        RAIL_X - 1.4,
        0.2,
        ze,
        RAIL_X + 1.4,
        0.2,
        ze,
        RAIL_X + 1.4,
        0.2,
        z,
        RAIL_X - 1.4,
        0.2,
        z,
        [0, 0, 1, 3],
      );
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
    G.quad(
      RAIL_X - w,
      ya + 0.2,
      z,
      RAIL_X - w,
      yb + 0.2,
      z + 2,
      RAIL_X + w,
      yb + 0.2,
      z + 2,
      RAIL_X + w,
      ya + 0.2,
      z,
      [0, 0, 1, 1],
    );
    G.col("#b08e6a").mat(WL.SAND);
    G.quad(
      RAIL_X + w,
      ya + 0.2,
      z,
      RAIL_X + w,
      yb + 0.2,
      z + 2,
      RAIL_X + w + yb * f,
      0,
      z + 2,
      RAIL_X + w + ya * f,
      0,
      z,
      [0, 0, 1, 1],
    );
    G.quad(
      RAIL_X - w - ya * f,
      0,
      z,
      RAIL_X - w - yb * f,
      0,
      z + 2,
      RAIL_X - w,
      yb + 0.2,
      z + 2,
      RAIL_X - w,
      ya + 0.2,
      z,
      [0, 0, 1, 1],
    );
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
    // the bents stand on the riverbed floor (carved below grade)
    const gy = (x: number) => sampleTerrain(L.terrain, x, z) - 0.2;
    for (const [bx, tx] of [
      [-3.0, -1.2],
      [-1.2, -0.5],
      [1.2, 0.5],
      [3.0, 1.2],
    ] as const)
      beam(G, RAIL_X + bx, gy(RAIL_X + bx), z, RAIL_X + tx, top, z, 0.3);
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
    for (const x of [-1.0, -0.4, 0.4, 1.0])
      boxP(
        G,
        WL.TIMBER,
        RAIL_X + x - 0.15,
        TRESTLE_Y - 0.05,
        tz0,
        RAIL_X + x + 0.15,
        TRESTLE_Y + 0.2,
        tz1,
      );
    // walkway rails
    G.col("#7a6450");
    for (const s of [-1, 1]) {
      boxP(
        G,
        WL.TIMBER,
        RAIL_X + s * 1.8 - 0.05,
        TRESTLE_Y + 1.0,
        tz0,
        RAIL_X + s * 1.8 + 0.05,
        TRESTLE_Y + 1.1,
        tz1,
      );
      for (let z = tz0; z < tz1; z += 2)
        boxP(
          G,
          WL.TIMBER,
          RAIL_X + s * 1.8 - 0.05,
          TRESTLE_Y + 0.2,
          z,
          RAIL_X + s * 1.8 + 0.05,
          TRESTLE_Y + 1.05,
          z + 0.1,
        );
    }
  }
  // tunnel portals wherever the line runs into a long stretch of rock
  const cellZ = (j: number) => -half + j * 2;
  const iRail = Math.floor((RAIL_X + half) / 2);
  const solidRun = (j: number, dir: 1 | -1) => {
    let k = 0;
    while (
      k < 8 &&
      j + dir * k >= 0 &&
      j + dir * k < cells &&
      rock[iRail * cells + j + dir * k]! > 0
    )
      k++;
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
    G.quad(
      RAIL_X - w / 2,
      h,
      face,
      RAIL_X + w / 2,
      h,
      face,
      RAIL_X + w / 2,
      h,
      deep,
      RAIL_X - w / 2,
      h,
      deep,
      [0, 0, 1, 1],
    );
    G.quad(
      RAIL_X + w / 2,
      h,
      face,
      RAIL_X - w / 2,
      h,
      face,
      RAIL_X - w / 2,
      h,
      deep,
      RAIL_X + w / 2,
      h,
      deep,
      [0, 0, 1, 1],
    );
    // cut-stone portal: jambs, a lintel and a parapet, with timber sets inside
    const o = dir * 0.7;
    G.col("#a89682");
    boxP(G, WL.P_STONE, RAIL_X - w / 2 - 1.8, 0, face + o - 0.7, RAIL_X - w / 2, h, face + o + 0.7);
    boxP(G, WL.P_STONE, RAIL_X + w / 2, 0, face + o - 0.7, RAIL_X + w / 2 + 1.8, h, face + o + 0.7);
    boxP(
      G,
      WL.P_STONE,
      RAIL_X - w / 2 - 1.8,
      h,
      face + o - 0.7,
      RAIL_X + w / 2 + 1.8,
      h + 2.6,
      face + o + 0.7,
    );
    G.col("#8a7a66");
    boxP(
      G,
      WL.P_STONE,
      RAIL_X - w / 2 - 2.2,
      h + 2.6,
      face + o - 0.9,
      RAIL_X + w / 2 + 2.2,
      h + 3.1,
      face + o + 0.9,
    );
    G.col("#5a4636");
    const tz = face + dir * 1.6;
    boxP(G, WL.TIMBER, RAIL_X - w / 2 - 0.1, 0, tz - 0.2, RAIL_X - w / 2 + 0.35, h, tz + 0.2);
    boxP(G, WL.TIMBER, RAIL_X + w / 2 - 0.35, 0, tz - 0.2, RAIL_X + w / 2 + 0.1, h, tz + 0.2);
    boxP(
      G,
      WL.TIMBER,
      RAIL_X - w / 2 - 0.3,
      h - 0.45,
      tz - 0.25,
      RAIL_X + w / 2 + 0.3,
      h,
      tz + 0.25,
    );
  }
  // ---- the freight-yard siding: a second track at x = 162, laid at grade, with a
  // turnout off the main at its north end and the parked cars left to props ----
  {
    const SX = 162;
    for (let z = -120; z < 118; z += 0.62) {
      const G = chunkAt(SX, z).detail;
      G.col(pick(["#6a5646", "#5a4a3c", "#7a6450"], mulberry(Math.floor(z * 100 + 7))));
      boxP(G, WL.TIMBER, SX - 1.3, 0.16, z - 0.11, SX + 1.3, 0.3, z + 0.11);
    }
    for (let z = -120; z < 118; z += 8) {
      const G = chunkAt(SX, z + 4).main;
      G.col("#8a8078");
      for (const sd of [-1, 1]) {
        const x = SX + (sd * gauge) / 2;
        beam(G, x, 0.37, z, x, 0.37, Math.min(118, z + 8), 0.12, WL.IRON);
      }
      G.col("#9a8a78").mat(WL.BALLAST);
      const ze = Math.min(118, z + 8);
      G.quad(SX - 1.4, 0.2, ze, SX + 1.4, 0.2, ze, SX + 1.4, 0.2, z, SX - 1.4, 0.2, z, [
        0, 0, 1, 3,
      ]);
    }
    // the turnout: a switch panel and a short diverging lead tying into the main
    const G = chunkAt(156, -60).detail;
    G.col("#8a8078");
    beam(G, RAIL_X + gauge / 2, y(-68) + 0.39, -68, SX - gauge / 2, 0.37, -50, 0.12, WL.IRON);
    beam(G, RAIL_X + gauge / 2 + 1.2, y(-68) + 0.39, -68, SX - gauge / 2 + 1.2, 0.37, -50, 0.1, WL.IRON);
    G.col("#5a4636");
    boxP(G, WL.TIMBER, 158.6, 0.3, -56.8, 159.2, 0.42, -55.6);
    G.col("#c8b8a0");
    boxP(G, WL.TIMBER, 158.7, 0.42, -56.4, 159.1, 1.15, -56.2); // switch stand
    G.col("#a83020");
    boxP(G, WL.PAINT, 158.55, 1.15, -56.55, 159.25, 1.45, -56.05); // target
  }
}

/** the crib-walled causeways (the river crossings and the stock chute's bank): plank
 * tops, timber retaining faces on the downhill sides, and the rail fences town.ts posted */
function decks(L: WesternLayout, chunkAt: (x: number, z: number) => ChunkGeo) {
  for (const dk of L.decks) {
    const G = chunkAt((dk.x0 + dk.x1) / 2, (dk.z0 + dk.z1) / 2).main;
    // plank running surface: alternating board tones so the deck never reads as a flat
    // plane (it used to turn into one dark slab at night)
    {
      const long = dk.axis === "x" ? "z" : "x"; // boards lie across the direction of travel
      const tones = ["#a88968", "#988058", "#b09860"];
      if (long === "z") {
        let s = dk.z0, i = 0;
        while (s < dk.z1 - 0.01) {
          const e = Math.min(dk.z1, s + 0.42 + ((i * 7) % 5) * 0.09);
          G.col(tones[i % 3]!).mat(WL.DECK);
          G.quad(dk.x0, dk.y + 0.06, e, dk.x1, dk.y + 0.06, e, dk.x1, dk.y + 0.06, s,
            dk.x0, dk.y + 0.06, s, [0, 0, (dk.x1 - dk.x0) / 3, 0.3]);
          s = e;
          i++;
        }
      } else {
        let s = dk.x0, i = 0;
        while (s < dk.x1 - 0.01) {
          const e = Math.min(dk.x1, s + 0.42 + ((i * 7) % 5) * 0.09);
          G.col(tones[i % 3]!).mat(WL.DECK);
          G.quad(s, dk.y + 0.06, dk.z1, e, dk.y + 0.06, dk.z1, e, dk.y + 0.06, dk.z0,
            s, dk.y + 0.06, dk.z0, [0, 0, 0.3, (dk.z1 - dk.z0) / 3]);
          s = e;
          i++;
        }
      }
    }
    G.col("#3a2d22").mat(WL.P_BOARD, 0.5, 0);
    G.quad(dk.x0, dk.y + 0.05, dk.z0, dk.x1, dk.y + 0.05, dk.z0, dk.x1, dk.y + 0.05, dk.z1,
      dk.x0, dk.y + 0.05, dk.z1, [0, 0, 1, 1]); // dark underside (visible from the gully)
    G.col("#4a3a2c").mat(WL.P_BOARD, 0.5, 0);
    // the timber deck edge: a fascia board round the rim
    const fx = 0.16;
    boxP(G, WL.TIMBER, dk.x0 - fx, dk.y - 0.3, dk.z0 - fx, dk.x0, dk.y + 0.1, dk.z1 + fx);
    boxP(G, WL.TIMBER, dk.x1, dk.y - 0.3, dk.z0 - fx, dk.x1 + fx, dk.y + 0.1, dk.z1 + fx);
    boxP(G, WL.TIMBER, dk.x0 - fx, dk.y - 0.3, dk.z0 - fx, dk.x1 + fx, dk.y + 0.1, dk.z0);
    boxP(G, WL.TIMBER, dk.x0 - fx, dk.y - 0.3, dk.z1, dk.x1 + fx, dk.y + 0.1, dk.z1 + fx);
    // the crib walls: vertical plank faces where the berm meets the carved bed, on
    // posts down into the channel
    const sideX: number[] = dk.axis === "z" ? [dk.x0, dk.x1] : [];
    const sideZ: number[] = dk.axis === "x" ? [dk.z0, dk.z1] : [];
    for (const sx of sideX) {
      const e = sx === dk.x0 ? -0.15 : 0.15;
      boxP(G, WL.P_BOARD, sx - 0.15, dk.y - 1.7, dk.z0, sx + e, dk.y, dk.z1);
      for (let z = dk.z0 + 1; z <= dk.z1 - 1; z += 4)
        boxP(G, WL.TIMBER, sx - 0.22, dk.y - 1.9, z - 0.18, sx + e + 0.08, dk.y + 0.02, z + 0.18);
    }
    for (const sz of sideZ) {
      const e = sz === dk.z0 ? -0.15 : 0.15;
      boxP(G, WL.P_BOARD, dk.x0, dk.y - 1.7, sz - 0.15, dk.x1, dk.y, sz + e);
      for (let x = dk.x0 + 1; x <= dk.x1 - 1; x += 4)
        boxP(G, WL.TIMBER, x - 0.18, dk.y - 1.9, sz - 0.22, x + 0.18, dk.y + 0.02, sz + e + 0.08);
    }
  }
}

/** The saloon's alley stair to its balcony matches the layout terrain. The church uses
 * the shared spiral access mesh, with its real floor opening cut into the tower above. */
function stairs(L: WesternLayout, chunkAt: (x: number, z: number) => ChunkGeo) {
  const st = L.saloonStairs;
  if (st) {
    const G = chunkAt((st.x0 + st.x1) / 2, st.zTop).main;
    const dir = Math.sign(st.zTop - st.zBottom); // toward the street
    const run = Math.abs(st.zTop - st.zBottom);
    const n = Math.round(run);
    const xa = st.x0 + 0.25;
    const xb = st.x1 - 0.3;
    for (let i = 0; i < n; i++) {
      const za = st.zBottom + dir * i;
      const h = (BALCONY_Y * (i + 1)) / n;
      G.col("#a88660");
      boxP(
        G,
        WL.DECK,
        xa,
        h - 0.08,
        Math.min(za, za + dir),
        xb,
        h,
        Math.max(za, za + dir),
        true,
        true,
      );
      // risers
      G.col("#7a5e44");
      boxP(
        G,
        WL.TIMBER,
        xa,
        0,
        Math.min(za, za + dir * 0.06),
        xb,
        h - 0.08,
        Math.max(za, za + dir * 0.06),
        false,
      );
    }
    // the boarded side toward the open half of the alley, and a handrail
    G.col("#8a7258");
    for (let i = 0; i < n; i++) {
      const za = st.zBottom + dir * i;
      const h = (BALCONY_Y * (i + 1)) / n;
      boxP(G, WL.P_BOARD, xb, 0, Math.min(za, za + dir), xb + 0.1, h, Math.max(za, za + dir));
    }
    G.col("#6a4a30");
    beam(G, xb + 0.05, 1.0, st.zBottom, xb + 0.05, BALCONY_Y + 1.0, st.zTop, 0.08);
    for (let i = 0; i <= n; i += 2) {
      const z = st.zBottom + dir * i;
      const h = (BALCONY_Y * i) / n;
      boxP(G, WL.TIMBER, xb, h, z - 0.05, xb + 0.1, h + 1.0, z + 0.05);
    }
    // the landing: a deck at balcony height on posts, railed on its open sides
    const edge = st.zTop + dir * SALOON_BALCONY; // (as deep as the balcony it joins)
    const zl0 = Math.min(st.zTop, edge);
    const zl1 = Math.max(st.zTop, edge);
    G.col("#b89a78");
    boxP(G, WL.DECK, st.x0 - 0.1, BALCONY_Y - 0.18, zl0, xb + 0.1, BALCONY_Y, zl1, true, true);
    G.col("#6a4a30");
    boxP(G, WL.TIMBER, xb - 0.1, 0, edge - 0.1, xb + 0.1, BALCONY_Y, edge + 0.1);
    G.col("#e8dcc0");
    boxP(
      G,
      WL.TIMBER,
      st.x0 - 0.1,
      BALCONY_Y + 0.95,
      edge - 0.06,
      xb + 0.1,
      BALCONY_Y + 1.05,
      edge + 0.06,
    );
    boxP(G, WL.TIMBER, xb, BALCONY_Y + 0.95, zl0, xb + 0.1, BALCONY_Y + 1.05, zl1);
    for (let x = st.x0; x <= xb; x += 0.42)
      boxP(
        G,
        WL.TIMBER,
        x - 0.03,
        BALCONY_Y,
        edge - 0.03,
        x + 0.03,
        BALCONY_Y + 0.96,
        edge + 0.03,
        false,
      );
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
  G.quad(
    x - w / 2,
    0,
    z + 0.3,
    x + w / 2,
    0,
    z + 0.3,
    x + w / 2,
    h,
    z + 0.3,
    x - w / 2,
    h,
    z + 0.3,
    [0, 0, 1, 1],
  );
  G.col("#5a4636");
  for (const sx of [-1, 1])
    boxP(G, WL.TIMBER, x + sx * (w / 2) - 0.25, 0, z + 0.2, x + sx * (w / 2) + 0.25, h, z + 0.7);
  boxP(G, WL.TIMBER, x - w / 2 - 0.5, h, z + 0.15, x + w / 2 + 0.5, h + 0.55, z + 0.75);
  boxP(G, WL.TIMBER, x - w / 2 - 0.3, h + 0.55, z - 0.4, x + w / 2 + 0.3, h + 1.2, z + 0.4);
  signBoard(G, 22, x, h + 1.3, z + 0.45, 3.2, 0.7);
  // ore-cart rails down to the tipple
  const D = ch.detail;
  D.col("#5a4a3c");
  for (let t = 0; t < 26; t += 0.7)
    boxP(D, WL.TIMBER, x - 0.7, 0.02, z + 0.5 + t - 0.08, x + 0.7, 0.12, z + 0.5 + t + 0.08);
  D.col("#6a6058");
  for (const s of [-0.45, 0.45])
    boxP(D, WL.IRON, x + s - 0.03, 0.12, z + 0.5, x + s + 0.03, 0.2, z + 26.5);
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

  // ---- the climbable high ground: the saloon's outside stair, the church stair and landing ----
  stairs(L, chunkAt);

  // ---- props ----
  const T = templates();
  const tint = new THREE.Color();
  for (const p of L.props) {
    const t = T[p.k];
    if (!t) continue;
    const ch = chunkAt(p.x, p.z);
    // props stand on the walkable surface (boardwalk decks, the carved riverbed)
    const y =
      p.k === "lantern"
        ? (p.a ?? 2.8) + sampleTerrain(L.earth, p.x, p.z)
        : sampleTerrain(L.terrain, p.x, p.z);
    // (the parked stagecoach and buckboards draw through the vehicle batch: Riders.tsx)
    if (p.k === "stagecoach" || p.k === "wagon" || p.k === "horse") continue;
    // a light per-instance tint so repeated props don't read as clones
    const k = 0.9 + ((((Math.sin(p.x * 12.9898 + p.z * 78.233) * 43758.5453) % 1) + 1) % 1) * 0.2;
    tint.setRGB(k, k, k);
    const big =
      p.k === "watertower" ||
      p.k === "windmill" ||
      p.k === "arch" ||
      p.k === "covered" ||
      p.k === "well" ||
      p.k === "tank" ||
      p.k === "pole" ||
      p.k === "saguaro" ||
      p.k === "outhouse";
    const target = big ? ch.main : ch.detail;
    // fences and hitching rails stretch along their length; everything else scales evenly
    const stretch = p.k === "fence" ? 2.5 : p.k === "hitch" ? 1.1 : p.k === "picket" ? 2 : 0;
    const sx = stretch ? p.s / stretch : p.s;
    const sy = stretch ? 1 : p.s;
    target.stamp(t.d, p.x, y, p.z, p.rot, sx, sy, sy, tint);
    if (t.g) ch.glow.stamp(t.g, p.x, y, p.z, p.rot, p.s, p.s, p.s);
    if (p.k === "lantern" || p.k === "streetlamp") {
      ch.pools.col("#ffb060").mat(0, 0, 0);
      const s = p.k === "streetlamp" ? 7 : 5;
      ch.pools.flat(
        p.x - s / 2,
        p.z - s / 2,
        p.x + s / 2,
        p.z + s / 2,
        sampleTerrain(L.earth, p.x, p.z) + 0.06,
      );
    }
    if (t.p) ch.pools.stamp(t.p, p.x, sampleTerrain(L.earth, p.x, p.z), p.z, p.rot, p.s, p.s, p.s);
    if (p.k === "windmill")
      windmills.push({ x: p.x, y: y + 11.2 * p.s, z: p.z, rot: p.rot, s: p.s });
    if (p.k === "campfire") fires.push({ x: p.x, y: y + 0.4, z: p.z, s: p.s });
  }

  // ---- rock, the railroad, the mine ----
  const hv = rockMesh(L, chunkAt);
  for (const b of L.overhangs) {
    const G = chunkAt((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2).main;
    const [tu, tv] = TILE_M[WL.ROCK]!;
    for (const [a, c, d] of overhangTriangles(b)) {
      const u = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]),
        v = new THREE.Vector3(d[0] - a[0], d[1] - a[1], d[2] - a[2]),
        normal = u.cross(v).normalize();
      const cap = Math.abs(normal.y) > 0.8;
      G.mat(cap ? WL.SAND : WL.ROCK, 0.5, 0);
      if (cap) {
        const k = normal.y > 0 ? 0.6 : 0.5;
        G.colLinear(k * 1.05, k * 0.62, k * 0.46);
      } else G.colLinear(b.tone, b.tone * 0.93, b.tone * 0.88);
      for (const [x, y, z] of [a, c, d])
        G.v(
          x,
          y,
          z,
          normal.x,
          normal.y,
          normal.z,
          Math.abs(normal.y) > 0.8 ? x / tu : (x + z * 0.7) / tu,
          Math.abs(normal.y) > 0.8 ? z / tv : y / tv,
        );
    }
  }

  // talus at the cliff feet: fallen blocks and rubble heaped where the walls meet the desert.
  // They sit inside the rock's own collision cells (poking out less than a player's radius),
  // so the ground you walk on is unchanged.
  {
    const { cells, half, rock } = L;
    const hash = (a: number, b: number) => {
      const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
      return v - Math.floor(v);
    };
    const rk = (i: number, j: number) =>
      i < 0 || j < 0 || i >= cells || j >= cells ? 1 : rock[i * cells + j]!;
    const rubble = new THREE.Color();
    for (let i = 1; i < cells - 1; i++)
      for (let j = 1; j < cells - 1; j++) {
        const h = rock[i * cells + j]!;
        if (h < 3) continue;
        for (const [di, dj] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          if (rk(i + di, j + dj) > 0) continue;
          const r = hash(i * 4 + di + 2, j * 4 + dj + 2);
          // a scatter of pebbles fanning out onto the ground at most foot edges (ankle-high,
          // so they don't need collision), and the heavier talus at a third of them
          const pr = hash(i * 4 + di + 7, j * 4 + dj + 3);
          if (pr < 0.62) {
            const n = 1 + Math.floor(pr * 4.5);
            for (let q = 0; q < n; q++) {
              const u = hash(i * 13 + q, j * 7 + di * 3 + dj);
              const w = hash(j * 11 + q, i * 5 + dj * 3 + di);
              const out = 0.9 + u * 1.1; // metres out from the rock cell's centre
              const along = (w - 0.5) * 1.8;
              const px = -half + 1 + i * 2 + di * out + (di === 0 ? along : 0);
              const pz = -half + 1 + j * 2 + dj * out + (dj === 0 ? along : 0);
              const sc = (0.18 + w * 0.22) * (1.3 - u * 0.5);
              const kk = 0.78 + u * 0.25;
              rubble.setRGB(kk * 1.05, kk * 0.72, kk * 0.6);
              chunkAt(px, pz).detail.stamp(
                T.pebble!.d,
                px,
                -0.08,
                pz,
                (u + w) * 20,
                sc * 1.2,
                sc * 0.45,
                sc,
                rubble,
              );
            }
          }
          if (r > 0.34) continue;
          const cx =
            -half + 1 + i * 2 + di * 0.35 + (hash(i, j + 9) - 0.5) * 0.8 * (1 - Math.abs(di));
          const cz =
            -half + 1 + j * 2 + dj * 0.35 + (hash(i + 9, j) - 0.5) * 0.8 * (1 - Math.abs(dj));
          const ch = chunkAt(cx, cz);
          const k = 0.8 + hash(i + 3, j + 5) * 0.25;
          rubble.setRGB(k * 1.05, k * 0.72, k * 0.6);
          const big = r < 0.09;
          const sc = big ? 0.95 + hash(i, j) * 0.35 : 0.45 + hash(j, i) * 0.35;
          // a big fallen block, or a low heap of scree
          ch.detail.stamp(
            T.boulder!.d,
            cx,
            -0.1,
            cz,
            r * 40,
            sc,
            big ? sc * 0.9 : sc * 0.45,
            sc * 1.2,
            rubble,
          );
          if (!big && r < 0.2) {
            // a second, smaller stone beside it
            const ox = dj !== 0 ? 0.7 : 0;
            const oz = di !== 0 ? 0.7 : 0;
            ch.detail.stamp(
              T.boulder!.d,
              cx + ox,
              -0.1,
              cz + oz,
              r * 70,
              sc * 0.55,
              sc * 0.4,
              sc * 0.6,
              rubble,
            );
          }
        }
      }
  }
  railroad(L, chunkAt);
  minePortal(L, chunkAt);
  decks(L, chunkAt);

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
          G.quad(
            a.x + off,
            sag(t0),
            za,
            a.x + off,
            sag(t1),
            zb,
            a.x + off,
            sag(t1) + 0.025,
            zb,
            a.x + off,
            sag(t0) + 0.025,
            za,
            [0, 0, 1, 1],
          );
          G.quad(
            a.x + off,
            sag(t1),
            zb,
            a.x + off,
            sag(t0),
            za,
            a.x + off,
            sag(t0) + 0.025,
            za,
            a.x + off,
            sag(t1) + 0.025,
            zb,
            [0, 0, 1, 1],
          );
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
