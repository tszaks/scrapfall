import { facadePieces } from "../structures/facade";
// Builds Whiteout Pass's chalets, set pieces and props into merged chunk geometry.
// Everything is stamped into the city's Geo accumulator (cityGeo.ts) with the alpine
// texture-array layers from textures.ts, so a 200 m chunk draws in a handful of calls:
//   main   - massing, roofs and their snow, big props (casts shadows)
//   detail - shutters, flower boxes, railings, icicles, drifts, small props (near only)
//   glow   - lamp bulbs, lit signs, Christmas lights (unlit, bright at night)
//   signs  - shop and warning signs (sign atlas)
//   lights - ground light pools (baked into a light map the terrain and snowfall read)
import * as THREE from "three";

import { Geo } from "../cityGeo";
import { mulberry } from "./noise";
import { T, signUV } from "./textures";
import {
  W_AVALANCHE,
  W_CLOSED,
  W_PASS,
  W_LIFT,
  W_LODGE,
  W_BERGBAHN,
  W_ROAD,
  type ABld,
  type AlpineData,
  type AProp,
  type Blockade,
  type Lift,
} from "./layout";

export type Kit = {
  main: Geo;
  detail: Geo;
  glow: Geo;
  signs: Geo;
  pools: Geo;
  /** ground light pools: x, z, radius, colour */
  lights: [number, number, number, string][];
  /** chimney tops (smoke) */
  smoke: [number, number, number][];
  /** lamp heads (halo sprites) and their colour kind (0 warm lamp, 1 cold flood, 2 xmas) */
  lamps: [number, number, number, number][];
};

const FH = 2.8; // storey height
const SNOW = "#f3f6fb";
const SNOW_SHADE = "#e3eaf4";
type V3 = [number, number, number];

// ---------------------------------------------------------------------------------------
// primitive helpers (all write into a Geo)

/** vertical face from A (left) to B (right) as seen from the side it faces */
function face(
  g: Geo,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  y0: number,
  y1: number,
  uv?: readonly number[],
) {
  g.quad(
    ax,
    y0,
    az,
    bx,
    y0,
    bz,
    bx,
    y1,
    bz,
    ax,
    y1,
    az,
    uv ?? [0, y0 / 2, Math.hypot(bx - ax, bz - az) / 2, y1 / 2],
  );
}
/** quad A B C D (A=u0v0, B=u1v0, C=u1v1, D=u0v1), flipped if needed so it faces `out` */
function q4(g: Geo, A: V3, B: V3, C: V3, D: V3, out: V3, uv: readonly number[] = [0, 0, 1, 1]) {
  const ux = B[0] - A[0];
  const uy = B[1] - A[1];
  const uz = B[2] - A[2];
  const wx = D[0] - A[0];
  const wy = D[1] - A[1];
  const wz = D[2] - A[2];
  const nx = uy * wz - uz * wy;
  const ny = uz * wx - ux * wz;
  const nz = ux * wy - uy * wx;
  if (nx * out[0] + ny * out[1] + nz * out[2] >= 0) g.quad(...A, ...B, ...C, ...D, uv);
  else g.quad(...B, ...A, ...D, ...C, uv);
}
function t3(g: Geo, A: V3, B: V3, C: V3, out: V3) {
  const ux = B[0] - A[0];
  const uy = B[1] - A[1];
  const uz = B[2] - A[2];
  const wx = C[0] - A[0];
  const wy = C[1] - A[1];
  const wz = C[2] - A[2];
  const nx = uy * wz - uz * wy;
  const ny = uz * wx - ux * wz;
  const nz = ux * wy - uy * wx;
  if (nx * out[0] + ny * out[1] + nz * out[2] >= 0) g.tri(...A, ...B, ...C);
  else g.tri(...A, ...C, ...B);
}
/** textured box: each side gets world-scaled uvs (tile = 2 m) */
function tbox(
  g: Geo,
  x: number,
  y0: number,
  z: number,
  w: number,
  h: number,
  d: number,
  rot = 0,
  top = true,
  bottom = false,
) {
  const s = Math.sin(rot);
  const c = Math.cos(rot);
  const P = (lx: number, lz: number): [number, number] => [
    x + lx * c + lz * s,
    z - lx * s + lz * c,
  ];
  const a = P(-w / 2, -d / 2);
  const b = P(w / 2, -d / 2);
  const cc = P(w / 2, d / 2);
  const dd = P(-w / 2, d / 2);
  const y1 = y0 + h;
  const v0 = y0 / 2;
  const v1 = y1 / 2;
  face(g, b[0], b[1], a[0], a[1], y0, y1, [0, v0, w / 2, v1]);
  face(g, cc[0], cc[1], b[0], b[1], y0, y1, [0, v0, d / 2, v1]);
  face(g, dd[0], dd[1], cc[0], cc[1], y0, y1, [0, v0, w / 2, v1]);
  face(g, a[0], a[1], dd[0], dd[1], y0, y1, [0, v0, d / 2, v1]);
  if (top)
    g.quad(dd[0], y1, dd[1], cc[0], y1, cc[1], b[0], y1, b[1], a[0], y1, a[1], [
      0,
      0,
      w / 2,
      d / 2,
    ]);
  if (bottom)
    g.quad(a[0], y0, a[1], b[0], y0, b[1], cc[0], y0, cc[1], dd[0], y0, dd[1], [
      0,
      0,
      w / 2,
      d / 2,
    ]);
}
/** a cylinder along an arbitrary axis from p to q */
function tube(g: Geo, p: V3, q: V3, r: number, seg = 6, r1 = r) {
  const dir = new THREE.Vector3(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
  const len = dir.length();
  if (len < 1e-4) return;
  dir.divideScalar(len);
  const up = Math.abs(dir.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const a = new THREE.Vector3().crossVectors(dir, up).normalize();
  const b = new THREE.Vector3().crossVectors(dir, a).normalize();
  for (let i = 0; i < seg; i++) {
    const t0 = (i / seg) * Math.PI * 2;
    const t1 = ((i + 1) / seg) * Math.PI * 2;
    const o0 = a.clone().multiplyScalar(Math.cos(t0)).addScaledVector(b, Math.sin(t0));
    const o1 = a.clone().multiplyScalar(Math.cos(t1)).addScaledVector(b, Math.sin(t1));
    const A: V3 = [p[0] + o0.x * r, p[1] + o0.y * r, p[2] + o0.z * r];
    const B: V3 = [p[0] + o1.x * r, p[1] + o1.y * r, p[2] + o1.z * r];
    const C: V3 = [q[0] + o1.x * r1, q[1] + o1.y * r1, q[2] + o1.z * r1];
    const D: V3 = [q[0] + o0.x * r1, q[1] + o0.y * r1, q[2] + o0.z * r1];
    const mid = o0.clone().add(o1);
    q4(g, A, B, C, D, [mid.x, mid.y, mid.z], [0, 0, (r * 6.28) / seg / 2, len / 2]);
  }
}
/** lumpy low-poly blob (snow heaps, boulders): a squashed, jittered octahedron-ish dome */
function blob(
  g: Geo,
  x: number,
  y: number,
  z: number,
  rx: number,
  ry: number,
  rz: number,
  r: () => number,
  seg = 7,
  rot = 0,
) {
  const ring: V3[] = [];
  const mid: V3[] = [];
  const s = Math.sin(rot);
  const c = Math.cos(rot);
  for (let i = 0; i < seg; i++) {
    const t = (i / seg) * Math.PI * 2;
    const j = 0.8 + r() * 0.4;
    const lx = Math.cos(t) * rx * j;
    const lz = Math.sin(t) * rz * j;
    ring.push([x + lx * c + lz * s, y - ry * 0.25, z - lx * s + lz * c]);
    const k = 0.6 + r() * 0.2;
    mid.push([
      x + lx * c * k + lz * s * k,
      y + ry * (0.45 + r() * 0.25),
      z - lx * s * k + lz * c * k,
    ]);
  }
  const top: V3 = [x + (r() - 0.5) * rx * 0.3, y + ry, z + (r() - 0.5) * rz * 0.3];
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    const o: V3 = [ring[i]![0] + ring[j]![0] - 2 * x, 0.3, ring[i]![2] + ring[j]![2] - 2 * z];
    q4(g, ring[i]!, ring[j]!, mid[j]!, mid[i]!, o);
    t3(g, mid[i]!, mid[j]!, top, [o[0], 1.5, o[2]]);
  }
}

/** smooth elongated snow mound (soft normals, tapered ends), `rot` turns its long axis */
function mound(
  g: Geo,
  x: number,
  y: number,
  z: number,
  len: number,
  h: number,
  w: number,
  rot: number,
) {
  const NL = 6;
  const NA = 6;
  const s = Math.sin(rot);
  const c = Math.cos(rot);
  const P = (u: number, t: number) => {
    const taper = Math.pow(Math.sin(Math.PI * u), 0.55);
    const lx = (u - 0.5) * len;
    const ly = Math.sin(t) * h * taper;
    const lz = Math.cos(t) * (w / 2) * (0.3 + 0.7 * taper);
    // ellipsoid-ish normal
    let nx = (lx / ((len / 2) * (len / 2))) * 0.6;
    let ny = ly / (h * h + 1e-3);
    let nz = lz / ((w / 2) * (w / 2));
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const wx = x + lx * c + lz * s;
    const wz = z - lx * s + lz * c;
    return [
      wx,
      y + ly - 0.15,
      wz,
      nx * c + nz * s,
      ny,
      -nx * s + nz * c,
      wx / 2,
      wz / 2 + ly / 2,
    ] as const;
  };
  for (let i = 0; i < NL; i++)
    for (let j = 0; j < NA; j++) {
      const a = P(i / NL, (j / NA) * Math.PI);
      const b = P((i + 1) / NL, (j / NA) * Math.PI);
      const cc = P((i + 1) / NL, ((j + 1) / NA) * Math.PI);
      const d = P(i / NL, ((j + 1) / NA) * Math.PI);
      g.v(...a);
      g.v(...b);
      g.v(...cc);
      g.v(...a);
      g.v(...cc);
      g.v(...d);
    }
}

// ---------------------------------------------------------------------------------------
// local frames: a building's street-facing side decides its local axes. lx runs along the
// front (left to right seen from the street), lz runs from the front face into the house.

type Frame = {
  W: number;
  D: number;
  P: (lx: number, lz: number) => [number, number];
  out: (ox: number, oz: number) => V3;
};
function frameOf(b: {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  front: 0 | 1 | 2 | 3;
}): Frame {
  const { x0, z0, x1, z1 } = b;
  switch (b.front) {
    case 2:
      return {
        W: x1 - x0,
        D: z1 - z0,
        P: (lx, lz) => [x0 + lx, z1 - lz],
        out: (ox, oz) => [ox, 0, -oz],
      };
    case 0:
      return {
        W: x1 - x0,
        D: z1 - z0,
        P: (lx, lz) => [x1 - lx, z0 + lz],
        out: (ox, oz) => [-ox, 0, oz],
      };
    case 1:
      return {
        W: z1 - z0,
        D: x1 - x0,
        P: (lx, lz) => [x1 - lz, z1 - lx],
        out: (ox, oz) => [-oz, 0, -ox],
      };
    default:
      return {
        W: z1 - z0,
        D: x1 - x0,
        P: (lx, lz) => [x0 + lz, z0 + lx],
        out: (ox, oz) => [oz, 0, ox],
      };
  }
}
const L3 = (F: Frame, lx: number, y: number, lz: number): V3 => {
  const [x, z] = F.P(lx, lz);
  return [x, y, z];
};
/** local vertical face from (lxA,lzA) to (lxB,lzB) */
function lface(
  g: Geo,
  F: Frame,
  lxA: number,
  lzA: number,
  lxB: number,
  lzB: number,
  y0: number,
  y1: number,
  uv?: readonly number[],
) {
  const [ax, az] = F.P(lxA, lzA);
  const [bx, bz] = F.P(lxB, lzB);
  const len = Math.hypot(bx - ax, bz - az);
  face(g, ax, az, bx, bz, y0, y1, uv ?? [0, y0 / 2, len / 2, y1 / 2]);
}
/** local box */
function lbox(
  g: Geo,
  F: Frame,
  lx: number,
  lz: number,
  y0: number,
  w: number,
  h: number,
  d: number,
  top = true,
) {
  const [x, z] = F.P(lx, lz);
  // the local frame is a rotation (plus a mirror); boxes are symmetric so only the yaw matters
  const [ax, az] = F.P(lx + 1, lz);
  const rot = Math.atan2(-(az - z), ax - x);
  tbox(g, x, y0, z, w, h, d, rot, top);
}

// ---------------------------------------------------------------------------------------
// palettes

const LOG_T = ["#ffffff", "#f2e0c8", "#e0c6a4", "#c8a888", "#fff0dc"];
const PLASTER_T = ["#ffffff", "#f6efe0", "#efe4d0", "#f4e9dc", "#e8e4dc"];
const SHUTTER_T = ["#2f6a3a", "#9a2a22", "#3a2a1a", "#3e5a78", "#6a2a3a", "#2a4a3a"];
const FLOWER_T = ["#d8322a", "#e8424a", "#c81e3a", "#f05a3a"];
const ROOF_T = ["#5a3a26", "#3a2a22", "#4a4a4e", "#6a4a2e"];

// ---------------------------------------------------------------------------------------
// windows, shutters, doors

function windowAt(
  k: Kit,
  F: Frame,
  lx: number,
  lz: number,
  faceDir: 0 | 1 | 2 | 3,
  y: number,
  w: number,
  h: number,
  r: () => number,
  flowers: boolean,
  shutter: string,
) {
  // faceDir: 0 front (lz=0, facing -lz), 1 right (lx=W), 2 back (lz=D), 3 left (lx=0)
  // every decal-like part stands clear of the outermost wall skin (the stone plinth sits
  // 8 cm proud of the storeys): windows 13 cm, shutters 18, sills 22, flower boxes 34
  const o = 0.13;
  const g = k.main;
  g.mat(T.window, r(), 0).col("#ffffff");
  const along = (d: number): [number, number, number, number] => {
    // returns local A/B endpoints for a span centred at the window, offset outwards
    if (faceDir === 0) return [lx - d, lz - o, lx + d, lz - o];
    if (faceDir === 2) return [lx + d, lz + o, lx - d, lz + o];
    if (faceDir === 1) return [lx + o, lz - d, lx + o, lz + d];
    return [lx - o, lz + d, lx - o, lz - d];
  };
  const [ax, az, bx, bz] = along(w / 2);
  lface(g, F, ax, az, bx, bz, y, y + h, [0, 0, 1, 1]);
  // shutters, a flower box and a snowy sill (detail)
  const dg = k.detail;
  dg.mat(T.plain, 0, 0).col(shutter);
  for (const side of [-1, 1]) {
    const c = side * (w / 2 + 0.26);
    const [sx, sz] =
      faceDir === 0
        ? [lx + c, lz - 0.18]
        : faceDir === 2
          ? [lx - c, lz + 0.18]
          : faceDir === 1
            ? [lx + 0.18, lz + c]
            : [lx - 0.18, lz - c];
    const along2 = faceDir === 0 || faceDir === 2;
    lbox(dg, F, sx, sz, y - 0.02, along2 ? 0.5 : 0.06, h + 0.04, along2 ? 0.06 : 0.5);
  }
  dg.mat(T.plain, 0, 0).col(SNOW);
  const [cx, cz] =
    faceDir === 0
      ? [lx, lz - 0.24]
      : faceDir === 2
        ? [lx, lz + 0.24]
        : faceDir === 1
          ? [lx + 0.24, lz]
          : [lx - 0.24, lz];
  const along3 = faceDir === 0 || faceDir === 2;
  lbox(dg, F, cx, cz, y - 0.12, along3 ? w + 0.2 : 0.38, 0.12, along3 ? 0.38 : w + 0.2);
  if (flowers) {
    const [fx, fz] =
      faceDir === 0
        ? [lx, lz - 0.38]
        : faceDir === 2
          ? [lx, lz + 0.38]
          : faceDir === 1
            ? [lx + 0.38, lz]
            : [lx - 0.38, lz];
    dg.mat(T.board, 0, 0).col("#8a5a32");
    lbox(dg, F, fx, fz, y - 0.42, along3 ? w + 0.1 : 0.3, 0.28, along3 ? 0.3 : w + 0.1);
    dg.mat(T.plain, 0, 0).col(FLOWER_T[Math.floor(r() * FLOWER_T.length)]!);
    lbox(dg, F, fx, fz, y - 0.14, along3 ? w : 0.26, 0.16, along3 ? 0.26 : w);
    dg.col("#2f5a2a");
    lbox(dg, F, fx, fz, y - 0.16, along3 ? w + 0.04 : 0.3, 0.06, along3 ? 0.3 : w + 0.04);
  }
}

// ---------------------------------------------------------------------------------------
// the chalet: stone plinth, timber or plaster storeys, gable to the street, steep roof
// under a thick blanket of snow, balcony with flower boxes, shutters, icicles, a chimney

type ChaletOpts = {
  floors: number;
  style: number;
  pitch: number;
  balconies: number[];
  cafe: boolean;
  shop: boolean;
  barn: boolean;
  sign: number;
  chimneys: number;
  door: boolean;
};

function gableHouse(
  k: Kit,
  b: {
    x0: number;
    z0: number;
    x1: number;
    z1: number;
    y: number;
    ymin: number;
    interior?: import("../structures/plan").Structure;
    front: 0 | 1 | 2 | 3;
    seed: number;
  },
  o: ChaletOpts,
) {
  const r = mulberry(Math.floor(b.seed * 4294967295));
  const F = frameOf(b);
  const { W, D } = F;
  const y = b.y;
  const g = k.main;
  const style = o.style % 4;
  const logT = LOG_T[Math.floor(r() * LOG_T.length)]!;
  const plT = PLASTER_T[Math.floor(r() * PLASTER_T.length)]!;
  const shutter = SHUTTER_T[Math.floor(r() * SHUTTER_T.length)]!;
  const wallTop = y + o.floors * FH;
  const stoneTop = style === 0 && !o.barn ? y + FH : y + 0.6;

  // plinth (down to the lowest ground under the house) and stone ground floor
  g.mat(T.stone, 0, 1).col(o.barn ? "#c8c0b4" : "#ffffff");
  for (const [ax, az, bx, bz] of [
    [-0.08, -0.08, W + 0.08, -0.08],
    [W + 0.08, -0.08, W + 0.08, D + 0.08],
    [W + 0.08, D + 0.08, -0.08, D + 0.08],
    [-0.08, D + 0.08, -0.08, -0.08],
  ] as const)
    lface(g, F, ax, az, bx, bz, b.ymin, b.interior ? y : stoneTop);
  // storeys
  for (let f = 0; f < o.floors; f++) {
    const y0 = Math.max(stoneTop, y + f * FH, b.interior?.top ?? -Infinity);
    const y1 = y + (f + 1) * FH;
    if (y1 <= y0) continue;
    const plaster = (style === 1 && f === 0) || style === 3;
    if (o.barn) g.mat(T.board, 0, 1).col("#b89878");
    else if (plaster) g.mat(T.plaster, 0, 1).col(plT);
    else g.mat(T.log, 0, 1).col(logT);
    lface(g, F, 0, 0, W, 0, y0, y1);
    lface(g, F, W, 0, W, D, y0, y1);
    lface(g, F, W, D, 0, D, y0, y1);
    lface(g, F, 0, D, 0, 0, y0, y1);
  }
  // corner posts / log ends
  if (!o.barn && style !== 3) {
    g.mat(T.bark, 0, 0).col("#8a6a4a");
    for (const [cx, cz] of [
      [0, 0],
      [W, 0],
      [W, D],
      [0, D],
    ] as const)
      lbox(g, F, cx, cz, stoneTop, 0.34, wallTop - stoneTop, 0.34, false);
  }

  // roof geometry
  const tanP = Math.tan(o.pitch);
  const ovS = o.barn ? 0.7 : 0.95;
  const ovF = o.barn ? 0.8 : 1.35;
  const rise = (W / 2) * tanP;
  const ridge = wallTop + rise;
  const eave = wallTop - ovS * tanP;
  const th = 0.24;
  // gable triangles
  if (o.barn) g.mat(T.board, 0, 1).col("#a88868");
  else if (style === 3) g.mat(T.board, 0, 1).col("#d0b090");
  else g.mat(T.log, 0, 1).col(logT);
  t3(g, L3(F, 0, wallTop, 0), L3(F, W, wallTop, 0), L3(F, W / 2, ridge, 0), F.out(0, -1));
  t3(g, L3(F, 0, wallTop, D), L3(F, W, wallTop, D), L3(F, W / 2, ridge, D), F.out(0, 1));
  // roof slabs: top (dark shingles, mostly under snow), soffit and fascia
  const roofCol = ROOF_T[Math.floor(r() * ROOF_T.length)]!;
  for (const side of [-1, 1]) {
    const ex = side < 0 ? -ovS : W + ovS;
    const out: V3 = F.out(side, 0);
    const up: V3 = [out[0] * tanP, 1, out[2] * tanP];
    g.mat(T.shingle, 0, 0).col(roofCol);
    const A = L3(F, ex, eave, -ovF);
    const B = L3(F, ex, eave, D + ovF);
    const C = L3(F, W / 2, ridge, D + ovF);
    const Dd = L3(F, W / 2, ridge, -ovF);
    const slope = Math.hypot(W / 2 + ovS, rise + ovS * tanP);
    q4(g, A, B, C, Dd, up, [0, 0, (D + 2 * ovF) / 2, slope / 2]);
    // soffit (underside), boards
    g.mat(T.board, 0, 0).col("#7a5434");
    const dn = (p: V3): V3 => [p[0], p[1] - th, p[2]];
    q4(g, dn(A), dn(B), dn(C), dn(Dd), [-up[0], -1, -up[2]], [0, 0, (D + 2 * ovF) / 2, slope / 2]);
    // fascia along the eave
    g.mat(T.board, 0, 0).col("#5a3a22");
    q4(g, dn(A), dn(B), B, A, out);
    // verge boards along the gable ends
    q4(g, dn(A), dn(Dd), Dd, A, F.out(0, -1));
    q4(g, dn(B), dn(C), C, B, F.out(0, 1));
    // the snow blanket: thick, slightly overhanging the eave, with a rounded lip
    const sn = 0.5;
    const lift = (p: V3, h: number, spill = 0): V3 => [
      p[0] + out[0] * spill,
      p[1] + h,
      p[2] + out[2] * spill,
    ];
    g.mat(T.snow, 0, 0).col(SNOW);
    const sA = lift(A, sn, 0.22);
    const sB = lift(B, sn, 0.22);
    const sC = lift(C, sn + 0.06);
    const sD = lift(Dd, sn + 0.06);
    q4(g, sA, sB, sC, sD, up, [0, 0, (D + 2 * ovF) / 2, slope / 2]);
    // eave lip (a soft cornice) and gable-end edges
    g.col(SNOW_SHADE);
    const lipA = lift(A, -0.08, 0.3);
    const lipB = lift(B, -0.08, 0.3);
    q4(g, lipA, lipB, sB, sA, [out[0], 0.4, out[2]]);
    q4(g, lipA, lipB, B, A, [out[0], -0.6, out[2]]);
    q4(g, A, sA, sD, Dd, F.out(0, -1));
    q4(g, B, sB, sC, C, F.out(0, 1));
    // icicles hanging from the eave (detail)
    const dg = k.detail;
    dg.mat(T.plain, 0, 0).col("#dcecff");
    for (let t = -ovF + 0.2; t < D + ovF - 0.2; t += 0.32 + r() * 0.3) {
      if (r() < 0.35) continue;
      const p = L3(F, ex + side * 0.12, eave - th, t);
      const len = 0.15 + r() * 0.7;
      dg.tri(p[0] - 0.05, p[1], p[2], p[0] + 0.05, p[1], p[2], p[0], p[1] - len, p[2]);
      dg.tri(p[0], p[1], p[2] - 0.05, p[0], p[1], p[2] + 0.05, p[0], p[1] - len, p[2]);
      dg.tri(p[0] + 0.05, p[1], p[2], p[0] - 0.05, p[1], p[2], p[0], p[1] - len, p[2]);
    }
  }
  // snowy ridge cap
  g.mat(T.snow, 0, 0).col(SNOW);
  tube(g, L3(F, W / 2, ridge + 0.4, -ovF), L3(F, W / 2, ridge + 0.4, D + ovF), 0.22, 5);

  // chimneys
  for (let c = 0; c < o.chimneys; c++) {
    const lx = W * (c === 0 ? 0.72 : 0.28);
    const lz = D * (0.35 + r() * 0.3);
    const roofY = wallTop + (W / 2 - Math.abs(lx - W / 2)) * tanP;
    const top = ridge + 0.9 + r() * 0.5;
    g.mat(T.stone, 0, 0).col("#d8d0c4");
    lbox(g, F, lx, lz, roofY - 0.4, 0.95, top - roofY + 0.4, 0.95, false);
    g.mat(T.plain, 0, 0).col("#4a4440");
    lbox(g, F, lx, lz, top, 1.15, 0.14, 1.15);
    g.mat(T.snow, 0, 0).col(SNOW);
    lbox(g, F, lx, lz, top + 0.14, 1.1, 0.18, 1.1);
    const p = L3(F, lx, top + 0.4, lz);
    k.smoke.push(p);
  }

  // windows on every storey; gable windows up in the attic
  const doorAt = W / 2 + (!b.interior && W > 13 ? (r() < 0.5 ? -1 : 1) * W * 0.22 : 0);
  const wy = (f: number) => y + f * FH + 0.95;
  const place = (len: number, f: number, fn: (c: number) => void, skip?: number) => {
    const n = Math.max(1, Math.floor((len - 1.6) / 2.7));
    for (let i = 0; i < n; i++) {
      const c = (len * (i + 0.5)) / n;
      if (skip !== undefined && Math.abs(c - skip) < 1.4) continue;
      fn(c);
    }
  };
  const bigFront = o.cafe || o.shop;
  for (let f = 0; f < o.floors; f++) {
    if(b.interior && f===0) continue;
    const fl = f >= 1 && !o.barn;
    if (!(f === 0 && bigFront) && !(o.barn && f === 0))
      place(
        W,
        f,
        (c) => windowAt(k, F, c, 0, 0, wy(f), 1.05, 1.3, r, fl, shutter),
        f === 0 ? doorAt : undefined,
      );
    if (!o.barn || f > 0) {
      place(D, f, (c) => windowAt(k, F, W, c, 1, wy(f), 1.05, 1.3, r, false, shutter));
      place(D, f, (c) => windowAt(k, F, 0, c, 3, wy(f), 1.05, 1.3, r, false, shutter));
      place(W, f, (c) => windowAt(k, F, c, D, 2, wy(f), 1.05, 1.3, r, false, shutter));
    }
  }
  // attic: one or two windows in each gable
  const attic = wallTop + 0.5;
  if (rise > 2.4) {
    const n = W > 12 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const c = n === 1 ? W / 2 : W / 2 + (i ? 1.1 : -1.1);
      windowAt(k, F, c, 0, 0, attic, 0.9, 1.1, r, false, shutter);
      windowAt(k, F, c, D, 2, attic, 0.9, 1.1, r, false, shutter);
    }
  }
  // café / shop ground floor: big glazing, an awning and a sign
  if (bigFront && !b.interior) {
    g.mat(T.glasswall, r(), 0).col("#ffffff");
    const gw = W - 3.2;
    const x0 = doorAt > W / 2 ? 0.8 : 2.4;
    // the glazing stops short of the door (no two faces ever share a plane)
    const gx1 = doorAt > W / 2 ? Math.min(x0 + gw - 1.6, doorAt - 0.9) : x0 + gw - 1.6;
    const gx0 = doorAt > W / 2 ? x0 : Math.max(x0, doorAt + 0.9);
    if (gx1 - gx0 > 1)
      lface(g, F, gx0, -0.12, gx1, -0.12, y + 0.35, y + 2.45, [
        0,
        0,
        Math.max(1, Math.round((gx1 - gx0) / 1.6)),
        1,
      ]);
    if (o.cafe) {
      g.mat(T.stripes, 0, 0).col("#ffffff");
      const A = L3(F, x0 - 0.3, y + 2.95, -0.05);
      const B = L3(F, x0 + gw - 1.3, y + 2.95, -0.05);
      const C = L3(F, x0 + gw - 1.3, y + 2.35, -1.6);
      const Dd = L3(F, x0 - 0.3, y + 2.35, -1.6);
      q4(g, A, B, C, Dd, [F.out(0, -1)[0], 1, F.out(0, -1)[2]], [0, 0, gw / 1.5, 1]);
      q4(g, A, B, C, Dd, [-F.out(0, -1)[0], -1, -F.out(0, -1)[2]], [0, 0, gw / 1.5, 1]);
      g.mat(T.snow, 0, 0).col(SNOW);
      q4(
        g,
        [A[0], A[1] + 0.12, A[2]],
        [B[0], B[1] + 0.12, B[2]],
        [C[0], C[1] + 0.12, C[2]],
        [Dd[0], Dd[1] + 0.12, Dd[2]],
        [0, 1, 0],
      );
    }
  }
  if (o.sign >= 0) {
    const sw = Math.min(W - 2, 7);
    const sy = bigFront ? y + 3.05 : y + FH - 0.6;
    k.signs.mat(0, 0, 0).col("#ffffff");
    const [ax, az] = F.P(W / 2 - sw / 2, -0.22);
    const [bx, bz] = F.P(W / 2 + sw / 2, -0.22);
    face(k.signs, ax, az, bx, bz, sy, sy + 0.62, signUV(o.sign));
    // a lamp over the sign
    const [lx, lz] = F.P(W / 2, -0.5);
    k.glow.col("#ffd9a0");
    k.glow.box(lx, sy + 0.72, lz, 0.5, 0.08, 0.12);
  }
  // front door with a little snowy canopy
  if (o.door) {
    g.mat(T.door, r(), 0).col("#ffffff");
    if(!b.interior) lface(g, F, doorAt - 0.65, -0.15, doorAt + 0.65, -0.15, y, y + 2.25, [0, 0, 1, 1]);
    const dg = k.detail;
    dg.mat(T.board, 0, 0).col("#6a4424");
    const A = L3(F, doorAt - 1.1, y + 2.75, 0);
    const B = L3(F, doorAt + 1.1, y + 2.75, 0);
    const C = L3(F, doorAt + 1.1, y + 2.45, -1.2);
    const Dd = L3(F, doorAt - 1.1, y + 2.45, -1.2);
    q4(dg, A, B, C, Dd, [0, 1, 0]);
    q4(dg, A, B, C, Dd, [0, -1, 0]);
    dg.mat(T.snow, 0, 0).col(SNOW);
    q4(
      dg,
      [A[0], A[1] + 0.16, A[2]],
      [B[0], B[1] + 0.16, B[2]],
      [C[0], C[1] + 0.16, C[2]],
      [Dd[0], Dd[1] + 0.16, Dd[2]],
      [0, 1, 0],
    );
    // steps up to the floor when the ground falls away
    // a step only where the ground in front of the door really sits below the floor
    const dp = L3(F, doorAt, 0, -0.9);
    const dg0 = groundFn(dp[0], dp[2]);
    if (y - dg0 > 0.45) {
      g.mat(T.stone, 0, 0).col("#d8d4cc");
      const n = Math.min(4, Math.ceil((y - dg0) / 0.2));
      for (let st = 0; st < n; st++)
        lbox(
          g,
          F,
          doorAt,
          -0.35 - (n - st) * 0.3,
          dg0 - 0.3,
          1.5,
          0.3 + ((st + 1) * (y - dg0)) / n,
          0.32,
        );
    }
    // warm light over the door
    const lp = L3(F, doorAt + 0.9, y + 2.1, -0.15);
    k.glow.col("#ffd49a").box(lp[0], lp[1], lp[2], 0.16, 0.22, 0.16);
    k.lamps.push([lp[0], lp[1], lp[2], 0]);
    const fp = L3(F, doorAt, 0, -2);
    k.lights.push([fp[0], fp[2], 4, "#ffc98a"]);
  }

  // balconies: slab, heart-cut railing, flower boxes, snow on the rail
  for (const bf of o.balconies) {
    if (bf >= o.floors) continue;
    const by = y + bf * FH;
    const dp = 1.35;
    const g2 = k.main;
    g2.mat(T.board, 0, 0).col("#8a5a32");
    const s0 = L3(F, 0.2, by, -dp);
    const s1 = L3(F, W - 0.2, by, -dp);
    const s2 = L3(F, W - 0.2, by, 0);
    const s3 = L3(F, 0.2, by, 0);
    q4(g2, s0, s1, s2, s3, [0, 1, 0]);
    const lo = (p: V3): V3 => [p[0], p[1] - 0.2, p[2]];
    q4(g2, lo(s0), lo(s1), lo(s2), lo(s3), [0, -1, 0]);
    q4(g2, lo(s0), lo(s1), s1, s0, F.out(0, -1));
    g2.mat(T.rail, 0, 0).col("#ffffff");
    const rl = W - 0.4;
    lface(g2, F, 0.2, -dp, W - 0.2, -dp, by, by + 1.05, [0, 0, rl / 1.6, 1]);
    lface(g2, F, W - 0.2, -dp + 0.05, 0.2, -dp + 0.05, by, by + 1.05, [0, 0, rl / 1.6, 1]);
    lface(g2, F, 0.2, 0, 0.2, -dp, by, by + 1.05, [0, 0, dp / 1.6, 1]);
    lface(g2, F, W - 0.2, -dp, W - 0.2, 0, by, by + 1.05, [0, 0, dp / 1.6, 1]);
    const dg = k.detail;
    dg.mat(T.snow, 0, 0).col(SNOW);
    lbox(dg, F, W / 2, -dp + 0.02, by + 1.05, rl, 0.12, 0.16);
    // flower boxes along the rail
    for (let x = 1; x < W - 1; x += 2.2) {
      dg.mat(T.board, 0, 0).col("#6a4424");
      lbox(dg, F, x + 0.8, -dp - 0.18, by + 0.8, 1.6, 0.26, 0.3);
      dg.mat(T.plain, 0, 0).col(FLOWER_T[Math.floor(r() * FLOWER_T.length)]!);
      lbox(dg, F, x + 0.8, -dp - 0.18, by + 1.06, 1.5, 0.16, 0.26);
    }
    // brackets
    dg.mat(T.board, 0, 0).col("#5a3a1e");
    for (const x of [0.8, W / 2, W - 0.8]) lbox(dg, F, x, -dp / 2, by - 0.9, 0.18, 0.7, dp - 0.2);
  }
}

// ---------------------------------------------------------------------------------------
// big set pieces

function hotel(k: Kit, b: ABld) {
  const r = mulberry(Math.floor(b.seed * 4294967295));
  const F = frameOf(b);
  const { W, D } = F;
  const y = b.y;
  const g = k.main;
  const floors = b.floors;
  const top = y + floors * 3.2;
  const hostFace=(g:Geo,F:Frame,ax:number,az:number,bx:number,bz:number,ya:number,yb:number,uv:readonly number[]=[0,ya/2,Math.hypot(bx-ax,bz-az)/2,yb/2])=>{
    const a=F.P(ax,az),q=F.P(bx,bz);
    for(const cut of facadePieces(a[0],a[1],q[0],q[1],ya,yb,b.grandWing?[b.grandWing]:[])) {
      const u0=uv[0]!+(uv[2]!-uv[0]!)*cut.t0,u1=uv[0]!+(uv[2]!-uv[0]!)*cut.t1;
      const v0=uv[1]!+(uv[3]!-uv[1]!)*(cut.y0-ya)/(yb-ya),v1=uv[1]!+(uv[3]!-uv[1]!)*(cut.y1-ya)/(yb-ya);
      lface(g,F,ax+(bx-ax)*cut.t0,az+(bz-az)*cut.t0,ax+(bx-ax)*cut.t1,az+(bz-az)*cut.t1,cut.y0,cut.y1,[u0,v0,u1,v1]);
    }
  };
  const hostWindow=(k:Kit,F:Frame,lx:number,lz:number,faceDir:0|1|2|3,wy:number,ww:number,hh:number,r:()=>number,flowers:boolean,shutter:string)=>{
    const q=F.P(lx,lz),p=b.grandWing;
    if(p&&q[0]>=p.bounds.x0-.25&&q[0]<=p.bounds.x1+.25&&q[1]>=p.bounds.z0-.25&&q[1]<=p.bounds.z1+.25&&wy<p.top&&wy+hh>p.base)return;
    windowAt(k,F,lx,lz,faceDir,wy,ww,hh,r,flowers,shutter);
  };
  // rusticated stone ground floor, cream plaster above
  g.mat(T.stone, 0, 1).col("#f0e8dc");
  for (const [ax, az, bx, bz] of [
    [0, 0, W, 0],
    [W, 0, W, D],
    [W, D, 0, D],
    [0, D, 0, 0],
  ] as const)
    hostFace(g, F, ax, az, bx, bz, b.ymin, y + 3.4);
  g.mat(T.plaster, 0, 1).col("#f4e6cc");
  for (const [ax, az, bx, bz] of [
    [0, 0, W, 0],
    [W, 0, W, D],
    [W, D, 0, D],
    [0, D, 0, 0],
  ] as const)
    hostFace(g, F, ax, az, bx, bz, y + 3.4, top);
  // cornice bands
  g.mat(T.plain, 0, 0).col("#d8c8a8");
  lbox(g, F, W / 2, D / 2, y + 3.3, W + 0.4, 0.3, D + 0.4, false);
  lbox(g, F, W / 2, D / 2, top - 0.1, W + 0.8, 0.45, D + 0.8);
  // window grid with green shutters; every other bay gets a wrought-iron balcony
  const bays = Math.floor(W / 3.2);
  const dbays = Math.floor(D / 3.2);
  for (let f = 1; f < floors; f++) {
    const wy = y + f * 3.2 + 0.9;
    for (let i = 0; i < bays; i++) {
      const c = (W * (i + 0.5)) / bays;
      hostWindow(k, F, c, 0, 0, wy, 1.2, 1.7, r, false, "#2a5a3a");
      hostWindow(k, F, c, D, 2, wy, 1.2, 1.7, r, false, "#2a5a3a");
      if (f >= 2 && i % 2 === 1 && f < floors - 1) {
        k.detail.mat(T.plain, 0, 0).col("#2a2a2e");
        lbox(k.detail, F, c, -0.55, wy - 0.95, 2.2, 0.12, 1.1);
        lbox(k.detail, F, c, -1.08, wy - 0.83, 2.2, 0.9, 0.05, false);
        k.detail.mat(T.snow, 0, 0).col(SNOW);
        lbox(k.detail, F, c, -1.08, wy + 0.07, 2.24, 0.08, 0.14);
      }
    }
    for (let i = 0; i < dbays; i++) {
      const c = (D * (i + 0.5)) / dbays;
      hostWindow(k, F, W, c, 1, wy, 1.2, 1.7, r, false, "#2a5a3a");
      hostWindow(k, F, 0, c, 3, wy, 1.2, 1.7, r, false, "#2a5a3a");
    }
  }
  // ground floor: tall arched-feel windows and a grand entrance with a portico
  for (let i = 0; i < bays; i++) {
    const c = (W * (i + 0.5)) / bays;
    if (Math.abs(c - W / 2) < 3) continue;
    g.mat(T.glasswall, r(), 0).col("#ffffff");
    hostFace(g, F, c - 0.8, -0.06, c + 0.8, -0.06, y + 0.6, y + 2.9, [0, 0, 1, 1]);
  }
  g.mat(T.door, r(), 0).col("#ffffff");
  hostFace(g, F, W / 2 - 1.2, -0.06, W / 2 + 1.2, -0.06, y, y + 2.8, [0, 0, 1, 1]);
  g.mat(T.plain, 0, 0).col("#e8dcc4");
  for (const s of [-1, 1]) {
    lbox(g, F, W / 2 + s * 2.6, -3.2, y, 0.5, 3.6, 0.5, false);
    lbox(g, F, W / 2 + s * 2.6, -0.4, y, 0.5, 3.6, 0.5, false);
  }
  g.mat(T.copper, 0, 0).col("#ffffff");
  lbox(g, F, W / 2, -1.8, y + 3.6, 6.6, 0.45, 3.8);
  g.mat(T.snow, 0, 0).col(SNOW);
  lbox(g, F, W / 2, -1.8, y + 4.05, 6.5, 0.3, 3.7);
  // mansard roof: steep lower slope with dormers, gentle hip above, all under snow
  const ins = 2.6;
  const r1 = top + 4.4;
  const r2 = r1 + 2.2;
  const ring = (d: number, yy: number): V3[] => [
    L3(F, -d, yy, -d),
    L3(F, W + d, yy, -d),
    L3(F, W + d, yy, D + d),
    L3(F, -d, yy, D + d),
  ];
  const lo = ring(0.4, top + 0.3);
  const hi = ring(-ins, r1);
  const sides: V3[] = [F.out(0, -1), F.out(1, 0), F.out(0, 1), F.out(-1, 0)];
  for (let s = 0; s < 4; s++) {
    const a = lo[s]!;
    const bb = lo[(s + 1) % 4]!;
    const c = hi[(s + 1) % 4]!;
    const d = hi[s]!;
    const o: V3 = [sides[s]![0], 0.5, sides[s]![2]];
    g.mat(T.shingle, 0, 0).col("#4a4448");
    q4(g, a, bb, c, d, o, [0, 0, W / 2, 2.4]);
  }
  const cap: V3 = [0, 0, 0];
  for (const p of hi) {
    cap[0] += p[0] / 4;
    cap[2] += p[2] / 4;
  }
  const rl = L3(F, W * 0.3, r2, D / 2);
  const rr = L3(F, W * 0.7, r2, D / 2);
  g.mat(T.snow, 0, 0).col(SNOW);
  const hs = hi.map((p): V3 => [p[0], p[1] + 0.12, p[2]]);
  q4(g, hs[0]!, hs[1]!, rr, rl, [sides[0]![0], 1, sides[0]![2]]);
  q4(g, hs[2]!, hs[3]!, rl, rr, [sides[2]![0], 1, sides[2]![2]]);
  t3(g, hs[1]!, hs[2]!, rr, [sides[1]![0], 1, sides[1]![2]]);
  t3(g, hs[3]!, hs[0]!, rl, [sides[3]![0], 1, sides[3]![2]]);
  // snow resting on the steep slopes' lower edge
  for (let s = 0; s < 4; s++) {
    const a = lo[s]!;
    const bb = lo[(s + 1) % 4]!;
    const mid = (p: V3, q: V3, t: number): V3 => [
      p[0] + (q[0] - p[0]) * t,
      p[1] + (q[1] - p[1]) * t,
      p[2] + (q[2] - p[2]) * t,
    ];
    const c = mid(bb, hi[(s + 1) % 4]!, 0.25);
    const d = mid(a, hi[s]!, 0.25);
    q4(
      g,
      [a[0], a[1] + 0.1, a[2]],
      [bb[0], bb[1] + 0.1, bb[2]],
      [c[0], c[1] + 0.1, c[2]],
      [d[0], d[1] + 0.1, d[2]],
      [sides[s]![0], 1, sides[s]![2]],
    );
  }
  // dormers on the front and back slopes
  for (let i = 0; i < bays; i += 2) {
    const c = (W * (i + 0.5)) / bays;
    for (const back of [false, true]) {
      const lz = back ? D + 0.2 - 1.2 : -0.2 + 1.2;
      const dir = back ? 2 : 0;
      g.mat(T.plaster, 0, 0).col("#f4e6cc");
      lbox(g, F, c, lz, top + 0.9, 1.8, 2.2, 1.6, false);
      windowAt(
        k,
        F,
        c,
        back ? lz + 0.8 : lz - 0.8,
        dir as 0 | 2,
        top + 1.2,
        0.9,
        1.2,
        r,
        false,
        "#2a5a3a",
      );
      g.mat(T.snow, 0, 0).col(SNOW);
      lbox(g, F, c, lz, top + 3.1, 2.2, 0.35, 2.0);
    }
  }
  // central tower with a copper cupola and a flag
  const tw = 6.5;
  g.mat(T.plaster, 0, 1).col("#f4e6cc");
  lbox(g, F, W / 2, 3.4, top, tw, 7.5, tw, false);
  for (let s = 0; s < 4; s++) {
    const faces: [number, number, 0 | 1 | 2 | 3][] = [
      [W / 2, 3.4 - tw / 2, 0],
      [W / 2 + tw / 2, 3.4, 1],
      [W / 2, 3.4 + tw / 2, 2],
      [W / 2 - tw / 2, 3.4, 3],
    ];
    const [fx, fz, dd] = faces[s]!;
    windowAt(k, F, fx, fz, dd, top + 3, 1.3, 2, r, false, "#2a5a3a");
  }
  g.mat(T.copper, 0, 0).col("#ffffff");
  const tc = L3(F, W / 2, top + 7.5, 3.4);
  g.cone(tc[0], tc[1], tc[2], tw * 0.78, 6.5, 4, Math.PI / 4);
  g.mat(T.snow, 0, 0).col(SNOW);
  g.cone(tc[0], tc[1] + 0.1, tc[2], tw * 0.8, 2.2, 4, Math.PI / 4);
  g.mat(T.plain, 0, 0).col("#d8b040");
  tube(g, [tc[0], tc[1] + 6.4, tc[2]], [tc[0], tc[1] + 10.5, tc[2]], 0.06, 4);
  k.detail.mat(T.plain, 0, 0).col("#d8261e");
  k.detail.box(tc[0] + 0.9, tc[1] + 9.2, tc[2], 1.7, 1.1, 0.05);
  // the name across the front, lit at night
  k.signs.mat(0, 0, 0).col("#ffffff");
  const [ax, az] = F.P(W / 2 - 7, -0.32);
  const [bx, bz] = F.P(W / 2 + 7, -0.32);
  face(k.signs, ax, az, bx, bz, top - 1.8, top - 0.5, signUV(b.sign));
  for (const s of [-1, 1]) {
    const lp = L3(F, W / 2 + s * 2.6, y + 2.6, -3.4);
    k.glow.col("#ffd49a").box(lp[0], lp[1], lp[2], 0.3, 0.4, 0.3);
    k.lamps.push([lp[0], lp[1], lp[2], 0]);
  }
  k.smoke.push(L3(F, W * 0.2, r2 + 2.5, D * 0.5), L3(F, W * 0.8, r2 + 2.5, D * 0.5));
  g.mat(T.stone, 0, 0).col("#d8d0c4");
  for (const lx of [W * 0.2, W * 0.8]) lbox(g, F, lx, D * 0.5, r1 - 1, 1.1, 3.6, 1.1);
}

function church(k: Kit, b: ABld) {
  const r = mulberry(Math.floor(b.seed * 4294967295));
  const F = frameOf(b);
  const { W, D } = F;
  const y = b.y;
  const g = k.main;
  if (b.style === 9) {
    // bell tower: plaster shaft with stone quoins, clock faces, belfry, an octagonal spire
    const h = 26;
    g.mat(T.stone, 0, 1).col("#ffffff");
    lbox(g, F, W / 2, D / 2, b.ymin, W + 0.3, y - b.ymin + 1.2, D + 0.3, false);
    g.mat(T.plaster, 0, 1).col("#fbf6ec");
    lbox(g, F, W / 2, D / 2, y + 1.2, W, h - 1.2, D, false);
    g.mat(T.stone, 0, 0).col("#e6ddd0");
    for (const [cx, cz] of [
      [0, 0],
      [W, 0],
      [W, D],
      [0, D],
    ] as const)
      lbox(g, F, cx, cz, y + 1.2, 0.6, h - 1.2, 0.6, false);
    lbox(g, F, W / 2, D / 2, y + h - 0.2, W + 0.7, 0.5, D + 0.7);
    // belfry openings and clock faces on all four sides
    const sides: [number, number, number, number][] = [
      [0.9, -0.06, W - 0.9, -0.06],
      [W + 0.06, 0.9, W + 0.06, D - 0.9],
      [W - 0.9, D + 0.06, 0.9, D + 0.06],
      [-0.06, D - 0.9, -0.06, 0.9],
    ];
    for (const [ax, az, bx, bz] of sides) {
      g.mat(T.arched, 0.99, 0).col("#5a5e6a");
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      const ux = (bx - ax) / Math.hypot(bx - ax, bz - az);
      const uz = (bz - az) / Math.hypot(bx - ax, bz - az);
      lface(
        g,
        F,
        mx - ux * 1.3,
        mz - uz * 1.3,
        mx + ux * 1.3,
        mz + uz * 1.3,
        y + h - 5.4,
        y + h - 1.2,
        [0, 0, 1, 1],
      );
      g.mat(T.clock, 0, 0).col("#ffffff");
      lface(
        g,
        F,
        mx - ux * 1.4,
        mz - uz * 1.4,
        mx + ux * 1.4,
        mz + uz * 1.4,
        y + h - 9.6,
        y + h - 6.8,
        [0, 0, 1, 1],
      );
    }
    // entrance door (faces the street)
    g.mat(T.door, r(), 0).col("#ffffff");
    lface(g, F, W / 2 - 1, -0.08, W / 2 + 1, -0.08, y, y + 3.2, [0, 0, 1, 1]);
    // spire
    const c = L3(F, W / 2, y + h + 0.3, D / 2);
    g.mat(T.shingle, 0, 0).col("#6a6e78");
    g.cone(c[0], c[1], c[2], W * 0.62, 15, 8, Math.PI / 8);
    g.mat(T.snow, 0, 0).col(SNOW);
    // snow clinging to the lower spire
    g.cyl(c[0], c[1], c[2], W * 0.64, 2.4, 8, false, W * 0.5);
    g.mat(T.plain, 0, 0).col("#d8b040");
    tube(g, [c[0], c[1] + 14.5, c[2]], [c[0], c[1] + 17.5, c[2]], 0.07, 4);
    g.box(c[0], c[1] + 16.6, c[2], 1.1, 0.12, 0.12);
    k.glow.col("#ffcf7a").box(c[0], c[1] + 15.2, c[2], 0.35, 0.35, 0.35);
    return;
  }
  // nave: white plaster, tall arched windows, a steep roof under snow
  const wallH = 8.5;
  g.mat(T.stone, 0, 1).col("#ffffff");
  for (const [ax, az, bx, bz] of [
    [0, 0, W, 0],
    [W, 0, W, D],
    [W, D, 0, D],
    [0, D, 0, 0],
  ] as const)
    lface(g, F, ax, az, bx, bz, b.ymin, y + 1);
  g.mat(T.plaster, 0, 1).col("#fbf6ec");
  for (const [ax, az, bx, bz] of [
    [0, 0, W, 0],
    [W, 0, W, D],
    [W, D, 0, D],
    [0, D, 0, 0],
  ] as const)
    lface(g, F, ax, az, bx, bz, y + 1, y + wallH);
  for (let z = 3; z < D - 2; z += 4.2) {
    for (const [lx, dir] of [
      [-0.06, 3],
      [W + 0.06, 1],
    ] as const) {
      g.mat(T.arched, r(), 0).col("#ffffff");
      const a = dir === 3 ? z + 0.8 : z - 0.8;
      const bb = dir === 3 ? z - 0.8 : z + 0.8;
      lface(g, F, lx, a, lx, bb, y + 2.4, y + 6.8, [0, 0, 1, 1]);
    }
  }
  const tanP = Math.tan(0.9);
  const wallTop = y + wallH;
  const ridge = wallTop + (W / 2) * tanP;
  g.mat(T.plaster, 0, 1).col("#fbf6ec");
  t3(g, L3(F, 0, wallTop, D), L3(F, W, wallTop, D), L3(F, W / 2, ridge, D), F.out(0, 1));
  t3(g, L3(F, 0, wallTop, 0), L3(F, W, wallTop, 0), L3(F, W / 2, ridge, 0), F.out(0, -1));
  g.mat(T.arched, r(), 0).col("#ffffff");
  lface(
    g,
    F,
    W / 2 + 1.1,
    D + 0.06,
    W / 2 - 1.1,
    D + 0.06,
    wallTop + 0.8,
    wallTop + 4.2,
    [0, 0, 1, 1],
  );
  for (const side of [-1, 1]) {
    const ex = side < 0 ? -0.8 : W + 0.8;
    const out = F.out(side, 0);
    const up: V3 = [out[0] * tanP, 1, out[2] * tanP];
    const A = L3(F, ex, wallTop - 0.8 * tanP, -0.6);
    const B = L3(F, ex, wallTop - 0.8 * tanP, D + 0.6);
    const C = L3(F, W / 2, ridge, D + 0.6);
    const Dd = L3(F, W / 2, ridge, -0.6);
    g.mat(T.shingle, 0, 0).col("#5a5e66");
    q4(g, A, B, C, Dd, up, [0, 0, D / 2, 6]);
    g.mat(T.board, 0, 0).col("#6a5a4a");
    q4(
      g,
      [A[0], A[1] - 0.2, A[2]],
      [B[0], B[1] - 0.2, B[2]],
      [C[0], C[1] - 0.2, C[2]],
      [Dd[0], Dd[1] - 0.2, Dd[2]],
      [-up[0], -1, -up[2]],
    );
    g.mat(T.snow, 0, 0).col(SNOW);
    const L = (p: V3, h: number): V3 => [p[0] + out[0] * 0.1, p[1] + h, p[2] + out[2] * 0.1];
    q4(g, L(A, 0.4), L(B, 0.4), L(C, 0.45), L(Dd, 0.45), up, [0, 0, D / 2, 6]);
    q4(g, A, B, L(B, 0.4), L(A, 0.4), [out[0], 0.2, out[2]]);
  }
  g.mat(T.snow, 0, 0).col(SNOW);
  tube(g, L3(F, W / 2, ridge + 0.4, -0.6), L3(F, W / 2, ridge + 0.4, D + 0.6), 0.25, 5);
}

/**
 * A chairlift terminal: a steel canopy on four posts over a boarded loading platform, the
 * bullwheel and its drive housing under the roof, turnstile lanes on the approach, a
 * hanging LIFT sign and warm lights. The platform itself is walkable (the boarding zone).
 */
function terminal(k: Kit, a: AlpineData, t: AlpineData["terminals"][number]) {
  const lf = a.lift;
  const sp = t.kind === "base" ? lf.supports[0]! : lf.supports[lf.supports.length - 1]!;
  const g = k.main;
  const y = t.y;
  const cx = (t.x0 + t.x1) / 2;
  const cz = (t.z0 + t.z1) / 2;
  const roofY = sp.y + 2.6;
  // platform boards with a painted loading line
  g.mat(T.board, 0, 0).col("#9a7a56");
  g.flat(t.x0, t.z0, t.x1, t.z1, y + 0.06, [0, 0, (t.x1 - t.x0) / 2, (t.z1 - t.z0) / 2]);
  g.mat(T.plain, 0, 0).col("#f2c418");
  const [bx, bz] = t.kind === "base" ? a.ride.boardUp : a.ride.boardDown;
  g.flat(bx - 1.2, bz - 0.12, bx + 1.2, bz + 0.12, y + 0.08);
  // posts, roof, fascia and a thick snow load
  g.mat(T.metal, 0, 0).col("#d8dade");
  for (const px of [t.x0 + 1, t.x1 - 1])
    for (const pz of [t.z0 + 1, t.z1 - 1]) tube(g, [px, y - 0.5, pz], [px, roofY, pz], 0.3, 8);
  g.mat(T.metal, 0, 0).col("#c8262a");
  tbox(g, cx, roofY, cz, t.x1 - t.x0 + 2, 0.6, t.z1 - t.z0 + 2);
  g.mat(T.metal, 0, 0).col("#5a5e66");
  tbox(g, cx, roofY - 0.05, cz, t.x1 - t.x0 + 1.6, 0.05, t.z1 - t.z0 + 1.6, 0, false, true);
  g.mat(T.snow, 0, 0).col(SNOW);
  tbox(g, cx, roofY + 0.6, cz, t.x1 - t.x0 + 2.2, 0.5, t.z1 - t.z0 + 2.2);
  // bullwheel and drive housing
  g.mat(T.metal, 0, 0).col("#9aa0a8");
  g.cyl(lf.x, sp.y + 0.05, sp.z, lf.gauge + 0.35, 0.3, 20, true);
  g.mat(T.plain, 0, 0).col("#2a2c30");
  g.cyl(lf.x, sp.y + 0.35, sp.z, 0.5, roofY - sp.y - 0.35, 8, false);
  g.mat(T.metal, 0, 0).col("#e8eaec");
  tbox(g, lf.x, roofY - 1.6, sp.z, 3.4, 1.6, 3.4);
  // turnstile lanes on the approach
  if (t.kind === "base") {
    g.mat(T.metal, 0, 0).col("#b8bcc4");
    for (const lx of [bx - 3, bx - 1, bx + 1, bx + 3]) {
      tube(g, [lx, y, t.z1 + 0.5], [lx, y + 1.0, t.z1 + 0.5], 0.05, 5);
      tube(g, [lx, y + 1.0, t.z1 + 0.5], [lx, y + 1.0, t.z1 + 5], 0.04, 4);
      tube(g, [lx, y, t.z1 + 5], [lx, y + 1.0, t.z1 + 5], 0.05, 5);
    }
    g.mat(T.plain, 0, 0).col("#3a3e44");
    for (const lx of [bx - 2, bx, bx + 2]) tbox(g, lx, y, t.z1 + 0.5, 0.3, 1.0, 0.3);
  }
  // the LIFT sign hangs from the roof edge towards the approach
  const fz = t.kind === "base" ? t.z1 + 1 : t.z1 + 1;
  k.signs.mat(0, 0, 0).col("#ffffff");
  face(
    k.signs,
    cx - 3,
    fz + 0.02,
    cx + 3,
    fz + 0.02,
    roofY - 1.1,
    roofY - 0.1,
    signUV(t.kind === "base" ? W_LIFT : W_BERGBAHN),
  );
  g.mat(T.plain, 0, 0).col("#2a2c30");
  face(g, cx + 3, fz - 0.02, cx - 3, fz - 0.02, roofY - 1.1, roofY - 0.1, [0, 0, 1, 1]);
  // warm lights under the canopy
  for (const lx of [t.x0 + 4, cx, t.x1 - 4]) {
    k.glow.col("#ffe2b0").box(lx, roofY - 0.2, cz, 1.2, 0.08, 0.3);
    k.lamps.push([lx, roofY - 0.5, cz, 0]);
  }
  // warm fixture light over the whole platform and its approach (it's where you board)
  for (let lx = t.x0 + 2; lx <= t.x1 - 2; lx += 4)
    for (let lz = t.z0 + 2; lz <= t.z1 + 4; lz += 4) k.lights.push([lx, lz, 7, "#ffd49a"]);
  // strip lights along both sides of the canopy
  for (const lz of [t.z0 + 1.5, t.z1 - 1.5]) {
    k.glow.col("#ffe8c0").box(cx, roofY - 0.18, lz, t.x1 - t.x0 - 3, 0.08, 0.25);
    k.lamps.push([t.x0 + 3, roofY - 0.4, lz, 0], [t.x1 - 3, roofY - 0.4, lz, 0]);
  }
}

/** the summit lodge: a big timber A-frame with a glass gable to the valley, a stone base,
 * a chimney, and its deck (tables, umbrellas, railing) running onto the lift platform */
function summitLodge(k: Kit, b: ABld, a: AlpineData) {
  const r = mulberry(Math.floor(b.seed * 4294967295));
  const F = frameOf(b);
  const { W, D } = F;
  const y = b.y;
  const g = k.main;
  const tanP = Math.tan(0.98);
  const eave = y + 1.6;
  const ridge = eave + (W / 2 + 1) * tanP;
  // stone base all round
  g.mat(T.stone, 0, 1).col("#ffffff");
  for (const [ax, az, bx, bz] of [
    [0, 0, W, 0],
    [W, 0, W, D],
    [W, D, 0, D],
    [0, D, 0, 0],
  ] as const)
    lface(g, F, ax, az, bx, bz, b.ymin, eave);
  // the front gable: a wall of glass in a heavy timber frame; the back gable in logs
  g.mat(T.glasswall, r(), 0).col("#ffffff");
  t3(
    g,
    L3(F, 0.6, eave, -0.05),
    L3(F, W - 0.6, eave, -0.05),
    L3(F, W / 2, ridge - 1.4, -0.05),
    F.out(0, -1),
  );
  // the triangle is drawn as quads so the panes tile: horizontal bands
  for (let bnd = 0; bnd < 4; bnd++) {
    const y0 = eave + ((ridge - 1.4 - eave) * bnd) / 4;
    const y1 = eave + ((ridge - 1.4 - eave) * (bnd + 1)) / 4;
    const w0 = (W / 2 - 0.6) * (1 - bnd / 4);
    const w1 = (W / 2 - 0.6) * (1 - (bnd + 1) / 4);
    q4(
      g,
      L3(F, W / 2 - w0, y0, -0.07),
      L3(F, W / 2 + w0, y0, -0.07),
      L3(F, W / 2 + w1, y1, -0.07),
      L3(F, W / 2 - w1, y1, -0.07),
      F.out(0, -1),
      [0, 0, Math.max(1, Math.round(w0 / 1.2)), 1],
    );
  }
  g.mat(T.board, 0, 0).col("#5a3a22");
  for (let bnd = 1; bnd < 4; bnd++) {
    const yb = eave + ((ridge - 1.4 - eave) * bnd) / 4;
    const wb = (W / 2 - 0.6) * (1 - bnd / 4);
    lbox(g, F, W / 2, -0.12, yb - 0.1, wb * 2, 0.2, 0.14);
  }
  lbox(g, F, W / 2, -0.12, eave, 0.25, ridge - 1.4 - eave, 0.16, false);
  g.mat(T.log, 0, 1).col("#e0c098");
  t3(g, L3(F, 0, eave, D), L3(F, W, eave, D), L3(F, W / 2, ridge - 1, D), F.out(0, 1));
  // the great roof, sweeping nearly to the ground, under deep snow
  for (const side of [-1, 1]) {
    const ex = side < 0 ? -1 : W + 1;
    const out = F.out(side, 0);
    const up: V3 = [out[0] * tanP, 1, out[2] * tanP];
    const A = L3(F, ex, eave - tanP * 1, -1.6);
    const B = L3(F, ex, eave - tanP * 1, D + 1.2);
    const C = L3(F, W / 2, ridge, D + 1.2);
    const Dd = L3(F, W / 2, ridge, -1.6);
    g.mat(T.shingle, 0, 0).col("#4a3426");
    q4(g, A, B, C, Dd, up, [0, 0, D / 2, 9]);
    g.mat(T.board, 0, 0).col("#7a5434");
    const dn = (p: V3): V3 => [p[0], p[1] - 0.3, p[2]];
    q4(g, dn(A), dn(B), dn(C), dn(Dd), [-up[0], -1, -up[2]], [0, 0, D / 2, 9]);
    g.mat(T.snow, 0, 0).col(SNOW);
    const L = (p: V3, h: number): V3 => [p[0] + out[0] * 0.2, p[1] + h, p[2] + out[2] * 0.2];
    q4(g, L(A, 0.55), L(B, 0.55), L(C, 0.6), L(Dd, 0.6), up, [0, 0, D / 2, 9]);
    q4(g, dn(A), dn(B), L(B, 0.55), L(A, 0.55), [out[0], 0.3, out[2]]);
    q4(g, dn(A), L(A, 0.55), L(Dd, 0.6), dn(Dd), F.out(0, -1));
  }
  // chimney with smoke
  g.mat(T.stone, 0, 0).col("#d8d0c4");
  const chy = ridge - 3;
  lbox(g, F, W * 0.72, D * 0.6, eave, 1.3, chy + 3.2 - eave, 1.3, false);
  g.mat(T.snow, 0, 0).col(SNOW);
  lbox(g, F, W * 0.72, D * 0.6, chy + 3.2, 1.5, 0.3, 1.5);
  k.smoke.push(L3(F, W * 0.72, chy + 3.8, D * 0.6));
  // sign over the glass
  k.signs.mat(0, 0, 0).col("#ffffff");
  const [sx0, sz0] = F.P(W / 2 - 4, -0.3);
  const [sx1, sz1] = F.P(W / 2 + 4, -0.3);
  face(k.signs, sx0, sz0, sx1, sz1, eave + 0.05, eave + 0.95, signUV(W_LODGE));
  // the deck: boards, a heart-cut railing on the drop sides, lanterns
  const dk = a.lodgeDeck;
  const dy = dk.y + 0.06;
  g.mat(T.board, 0, 0).col("#f0d8b0");
  g.flat(dk.x0 - 1.8, dk.z0, dk.x1, dk.z1 + 1.9, dy, [
    0,
    0,
    (dk.x1 - dk.x0) / 2,
    (dk.z1 - dk.z0) / 2,
  ]);
  g.mat(T.rail, 0, 0).col("#ffffff");
  const rail = (ax: number, az: number, bx: number, bz: number) => {
    const len = Math.hypot(bx - ax, bz - az);
    face(g, ax, az, bx, bz, dy, dy + 1.05, [0, 0, len / 1.6, 1]);
    face(g, bx, bz, ax, az, dy, dy + 1.05, [0, 0, len / 1.6, 1]);
  };
  rail(dk.x0 - 1.9, dk.z1 + 1.9, dk.x1, dk.z1 + 1.9);
  rail(dk.x0 - 1.9, dk.z0, dk.x0 - 1.9, dk.z1 + 1.9);
  k.detail.mat(T.snow, 0, 0).col(SNOW);
  tbox(k.detail, (dk.x0 + dk.x1) / 2 - 1, dy + 1.05, dk.z1 + 1.9, dk.x1 - dk.x0 + 2, 0.12, 0.2);
  for (const lx of [dk.x0 + 2, dk.x0 + 12, dk.x1 - 2]) {
    g.mat(T.plain, 0, 0).col("#1e2024");
    tube(g, [lx, dy, dk.z1 + 1.6], [lx, dy + 2.3, dk.z1 + 1.6], 0.05, 4);
    k.glow.col("#ffcf88").box(lx, dy + 2.4, dk.z1 + 1.6, 0.25, 0.35, 0.25);
    k.lamps.push([lx, dy + 2.4, dk.z1 + 1.6, 0]);
    k.lights.push([lx, dk.z1, 6, "#ffc98a"]);
  }
}

/** stone retaining wall along a pad's uphill edge, from the pad up to the cut slope */
function retaining(k: Kit, ax: number, bx: number, z: number, base: number, face_: 1 | -1) {
  const g = k.main;
  for (let x = ax; x < bx; x += 2) {
    const top = Math.max(groundFn(x + 1, z + face_ * -2.5), base) + 0.4;
    if (top - base < 0.8) continue;
    g.mat(T.stone, 0, 0).col("#e6e0d6");
    tbox(g, x + 1, base - 0.6, z, 2.02, top - base + 0.6, 1.2);
    g.mat(T.snow, 0, 0).col(SNOW);
    tbox(g, x + 1, top, z, 2.1, 0.22, 1.35);
  }
}

/** post-and-rail timber fence (the summit island's edges) */
function fence(k: Kit, ax: number, az: number, bx: number, bz: number) {
  const g = k.main;
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.round(len / 2.4));
  for (let i = 0; i <= n; i++) {
    const x = ax + ((bx - ax) * i) / n;
    const z = az + ((bz - az) * i) / n;
    const y = groundFn(x, z);
    g.mat(T.bark, 0, 0).col("#c8a888");
    tube(g, [x, y - 0.3, z], [x, y + 1.25, z], 0.09, 5);
    g.mat(T.snow, 0, 0).col(SNOW);
    g.cyl(x, y + 1.25, z, 0.12, 0.12, 5, true, 0.05);
    if (i < n) {
      const x2 = ax + ((bx - ax) * (i + 1)) / n;
      const z2 = az + ((bz - az) * (i + 1)) / n;
      const y2 = groundFn(x2, z2);
      g.mat(T.bark, 0, 0).col("#b89878");
      for (const h of [0.55, 1.05]) tube(g, [x, y + h, z], [x2, y2 + h, z2], 0.06, 4);
      g.mat(T.snow, 0, 0).col(SNOW);
      tube(g, [x, y + 1.13, z], [x2, y2 + 1.13, z2], 0.05, 4);
    }
  }
}

function coveredBridge(k: Kit, a: AlpineData) {
  const br = a.bridge;
  const g = k.main;
  const y = br.y + 0.1;
  const z0 = br.z - br.w / 2;
  const z1 = br.z + br.w / 2;
  const len = br.x1 - br.x0;
  // the deck (a thick timber floor on beams), clear above the gully
  g.mat(T.board, 0, 0).col("#c8a078");
  g.flat(br.x0, z0, br.x1, z1, y, [0, 0, len / 2, br.w / 2]);
  g.mat(T.board, 0, 0).col("#5a3e28");
  tbox(g, (br.x0 + br.x1) / 2, y - 0.6, br.z, len, 0.6, br.w + 0.2, 0, false, true);
  for (const zz of [z0 + 0.4, br.z, z1 - 0.4])
    tbox(g, (br.x0 + br.x1) / 2, y - 1.1, zz, len + 1, 0.5, 0.4, 0, true, true);
  // stone abutments, down to the gully floor at each bank
  g.mat(T.stone, 0, 0).col("#ffffff");
  for (const x of [br.x0 + 0.5, br.x1 - 0.5]) {
    const fy = Math.min(groundFn(x, br.z), y - 1) - 1;
    tbox(g, x, fy, br.z, 3, y - fy - 0.05, br.w + 1.6);
  }
  // side walls: solid lower boards, an open lattice, a top beam
  for (const [zA, out] of [
    [z0, -1],
    [z1, 1],
  ] as const) {
    g.mat(T.board, 0, 0).col("#c06a40");
    if (out < 0) face(g, br.x1, zA, br.x0, zA, y, y + 1.3);
    else face(g, br.x0, zA, br.x1, zA, y, y + 1.3);
    if (out < 0) face(g, br.x0, zA + 0.08, br.x1, zA + 0.08, y, y + 1.3);
    else face(g, br.x1, zA - 0.08, br.x0, zA - 0.08, y, y + 1.3);
    g.mat(T.board, 0, 0).col("#9a5030");
    tbox(g, (br.x0 + br.x1) / 2, y + 3.2, zA, len, 0.35, 0.3);
    for (let x = br.x0; x < br.x1 - 0.1; x += 2.2) {
      tube(g, [x, y + 1.3, zA], [x + 2.2, y + 3.2, zA], 0.09, 4);
      tube(g, [x + 2.2, y + 1.3, zA], [x, y + 3.2, zA], 0.09, 4);
      tbox(g, x, y, zA, 0.25, 3.4, 0.3);
    }
  }
  // roof
  const eave = y + 3.4;
  const ridge = eave + 2.4;
  for (const side of [-1, 1]) {
    const ez = side < 0 ? z0 - 0.9 : z1 + 0.9;
    const A: V3 = [br.x0 - 1, eave - 0.3, ez];
    const B: V3 = [br.x1 + 1, eave - 0.3, ez];
    const C: V3 = [br.x1 + 1, ridge, br.z];
    const D: V3 = [br.x0 - 1, ridge, br.z];
    g.mat(T.shingle, 0, 0).col("#5a3a26");
    q4(g, A, B, C, D, [0, -1, 0]);
    g.mat(T.snow, 0, 0).col(SNOW);
    const u = (p: V3): V3 => [p[0], p[1] + 0.4, p[2]];
    q4(g, u(A), u(B), u(C), u(D), [0, 1, side]);
    q4(g, A, B, u(B), u(A), [0, 0, side]);
  }
  // gable portals with a name board
  for (const x of [br.x0 - 0.2, br.x1 + 0.2]) {
    g.mat(T.board, 0, 0).col("#c06a40");
    t3(
      g,
      [x, eave, z0 - 0.4],
      [x, eave, z1 + 0.4],
      [x, ridge - 0.1, br.z],
      [x < br.x0 ? -1 : 1, 0, 0],
    );
    g.mat(T.board, 0, 0).col("#9a5030");
    tbox(g, x, eave - 0.4, br.z, 0.3, 0.5, br.w + 0.6);
  }
  k.signs.mat(0, 0, 0).col("#ffffff");
  face(
    k.signs,
    br.x0 - 0.4,
    br.z - 2.2,
    br.x0 - 0.4,
    br.z + 2.2,
    eave + 0.1,
    eave + 0.7,
    signUV(W_PASS),
  );
  // lanterns hanging inside the covered span
  for (let x = br.x0 + 2.5; x < br.x1 - 1.5; x += 4) {
    k.glow.col("#ffcf8a").box(x, y + 2.9, br.z, 0.3, 0.4, 0.3);
    k.lamps.push([x, y + 2.9, br.z, 0]);
    k.lights.push([x, br.z, 6.5, "#ffd49a"]);
  }
  // lanterns at both portals
  for (const x of [br.x0 - 0.5, br.x1 + 0.5])
    for (const z of [z0 - 0.3, z1 + 0.3]) {
      k.glow.col("#ffcf8a").box(x, y + 2.6, z, 0.25, 0.35, 0.25);
      k.lamps.push([x, y + 2.6, z, 0]);
      k.lights.push([x, z, 5, "#ffc98a"]);
    }
}

function rink(k: Kit, a: AlpineData) {
  const rk = a.rink;
  const g = k.main;
  const y = rk.y + 0.04;
  g.mat(T.ice, 0, 0).col("#ffffff");
  g.flat(rk.x0, rk.z0, rk.x1, rk.z1, y, [0, 0, (rk.x1 - rk.x0) / 6, (rk.z1 - rk.z0) / 6]);
  // boards: white with a red cap, open gates at the ends
  const cx = (rk.x0 + rk.x1) / 2;
  const seg = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const rot = Math.atan2(-(z1 - z0), x1 - x0);
    g.mat(T.plain, 0, 0).col("#f4f6f8");
    tbox(g, (x0 + x1) / 2, y, (z0 + z1) / 2, len, 1.05, 0.14, rot);
    g.col("#c8262a");
    tbox(g, (x0 + x1) / 2, y + 1.05, (z0 + z1) / 2, len, 0.1, 0.22, rot);
  };
  for (const z of [rk.z0 - 0.8, rk.z1 + 0.8]) {
    seg(rk.x0 - 0.8, z, cx - 2.6, z);
    seg(cx + 2.6, z, rk.x1 + 0.8, z);
  }
  seg(rk.x0 - 0.8, rk.z0 - 0.8, rk.x0 - 0.8, rk.z1 + 0.8);
  seg(rk.x1 + 0.8, rk.z0 - 0.8, rk.x1 + 0.8, rk.z1 + 0.8);
  // light poles with strings of bulbs across the ice
  const poles: V3[] = [
    [rk.x0 - 1.4, y, rk.z0 - 1.4],
    [rk.x1 + 1.4, y, rk.z0 - 1.4],
    [rk.x1 + 1.4, y, rk.z1 + 1.4],
    [rk.x0 - 1.4, y, rk.z1 + 1.4],
  ];
  g.mat(T.metal, 0, 0).col("#3a3e44");
  for (const p of poles) tube(g, p, [p[0], p[1] + 6.5, p[2]], 0.1, 5);
  const bulbs = ["#ffd27a", "#ff6a5a", "#7ad0ff", "#9aff7a", "#ffffff"];
  for (let s = 0; s < 4; s++) {
    const p = poles[s]!;
    const q = poles[(s + 2) % 4]!;
    if (s >= 2) continue;
    for (let t = 0; t <= 1.001; t += 0.04) {
      const x = p[0] + (q[0] - p[0]) * t;
      const z = p[2] + (q[2] - p[2]) * t;
      const yy = p[1] + 6.3 - Math.sin(t * Math.PI) * 1.4;
      k.glow.col(bulbs[Math.floor(t * 25) % bulbs.length]!).box(x, yy, z, 0.14, 0.14, 0.14);
    }
  }
  k.lamps.push([cx, y + 5, (rk.z0 + rk.z1) / 2, 2]);
  k.lights.push([cx, (rk.z0 + rk.z1) / 2, 18, "#ffd8a0"]);
}

function skiJump(k: Kit, a: AlpineData) {
  const j = a.jump;
  const g = k.main;
  const n = 10;
  const w = 3.6;
  const pts: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const z = j.z0 + (j.z1 - j.z0) * t;
    // concave in-run: steep at the top, flattening to the take-off table
    const y = j.lip + (j.top - j.lip) * Math.pow(1 - t, 1.6);
    pts.push([j.x, y, z]);
  }
  for (let i = 0; i < n; i++) {
    const p = pts[i]!;
    const q = pts[i + 1]!;
    g.mat(T.snow, 0, 0).col("#f4f8ff");
    q4(
      g,
      [p[0] - w / 2, p[1], p[2]],
      [p[0] + w / 2, p[1], p[2]],
      [q[0] + w / 2, q[1], q[2]],
      [q[0] - w / 2, q[1], q[2]],
      [0, 1, 0],
    );
    g.mat(T.board, 0, 0).col("#8a6a4a");
    q4(
      g,
      [p[0] - w / 2, p[1] - 0.5, p[2]],
      [p[0] + w / 2, p[1] - 0.5, p[2]],
      [q[0] + w / 2, q[1] - 0.5, q[2]],
      [q[0] - w / 2, q[1] - 0.5, q[2]],
      [0, -1, 0],
    );
    for (const s of [-1, 1]) {
      const x = p[0] + (s * w) / 2;
      g.mat(T.board, 0, 0).col("#a0784a");
      q4(
        g,
        [x, p[1] - 0.5, p[2]],
        [x, q[1] - 0.5, q[2]],
        [x, q[1] + 0.9, q[2]],
        [x, p[1] + 0.9, p[2]],
        [s, 0, 0],
      );
    }
    // trestle legs
    const gy = Math.min(a.jump.y0, a.jump.y1) - 30;
    void gy;
    g.mat(T.metal, 0, 0).col("#b8bcc4");
    for (const s of [-1, 1])
      tube(
        g,
        [p[0] + s * (w / 2 + 0.3), p[1] - 0.5, p[2]],
        [p[0] + s * (w / 2 + 1.2), groundUnder(a, p[0], p[2]) - 0.3, p[2]],
        0.18,
        5,
      );
    if (i % 2 === 0) {
      const lamp: V3 = [p[0] + w / 2 + 0.2, p[1] + 1.1, p[2]];
      k.glow.col("#eaf2ff").box(lamp[0], lamp[1], lamp[2], 0.2, 0.2, 0.2);
    }
  }
  // start hut at the top
  const t0 = pts[0]!;
  g.mat(T.board, 0, 0).col("#c8262a");
  tbox(g, t0[0], t0[1], t0[2] - 2.2, 5, 3.2, 4.4);
  g.mat(T.snow, 0, 0).col(SNOW);
  tbox(g, t0[0], t0[1] + 3.2, t0[2] - 2.2, 5.6, 0.45, 5);
  k.signs.mat(0, 0, 0).col("#ffffff");
  face(
    k.signs,
    t0[0] - 2.4,
    t0[2] - 0.2 + 0.05,
    t0[0] + 2.4,
    t0[2] - 0.2 + 0.05,
    t0[1] + 2.2,
    t0[1] + 2.8,
    signUV(W_PASS),
  );
  k.lamps.push([t0[0], t0[1] + 3, t0[2], 1]);
}

let groundFn: (x: number, z: number) => number = () => 0;
function groundUnder(_a: AlpineData, x: number, z: number) {
  return groundFn(x, z);
}

function deck(k: Kit, a: AlpineData) {
  const d = a.deck;
  const g = k.main;
  const y = d.y + 0.05;
  const base = a.plateau;
  // the railing sits right at the edge of the walkable boards so you can lean over it
  const ez = d.z1 + 0.5;
  const ex = d.x1 + 0.5;
  g.mat(T.board, 0, 0).col("#f0d8b0");
  g.flat(d.x0, d.z0, ex, ez, y, [0, 0, (ex - d.x0) / 2, (ez - d.z0) / 2]);
  g.mat(T.board, 0, 0).col("#6a4a2e");
  face(g, ex, d.z0, d.x0, d.z0, base - 0.5, y);
  face(g, d.x0, d.z0 + 6, d.x0, ez, base - 0.5, y);
  face(g, d.x0, ez, ex, ez, d.y - 9, y);
  face(g, ex, ez, ex, d.z0, d.y - 9, y);
  // stairs up from the plateau
  g.mat(T.board, 0, 0).col("#a07a50");
  for (let st = 0; st < 6; st++)
    tbox(g, d.x0 - 4 + st * 0.67 + 0.33, base - 0.3, d.z0 + 3, 0.67, 0.3 + (st + 1) * 0.4, 6);
  // stilts and cross braces down the drop
  g.mat(T.board, 0, 0).col("#5a3a22");
  for (let x = d.x0 + 1; x <= ex; x += 4) {
    tube(g, [x, y, ez - 0.2], [x, groundFn(x, ez + 3) - 1, ez + 3], 0.2, 5);
    tube(g, [x, y - 1, ez - 0.2], [x + 4, groundFn(x + 4, ez + 2) + 1, ez + 2], 0.08, 4);
  }
  // railing along the drop, snow on the rail
  g.mat(T.rail, 0, 0).col("#ffffff");
  const railA = (ax: number, az: number, bx: number, bz: number) => {
    const len = Math.hypot(bx - ax, bz - az);
    face(g, ax, az, bx, bz, y, y + 1.05, [0, 0, len / 1.6, 1]);
    face(g, bx, bz, ax, az, y, y + 1.05, [0, 0, len / 1.6, 1]);
  };
  railA(d.x0, ez - 0.1, ex - 0.1, ez - 0.1);
  railA(ex - 0.1, ez - 0.1, ex - 0.1, d.z0);
  // the plateau sides: along the north edge and down the west edge to the stairs
  railA(ex - 0.1, d.z0 + 0.1, d.x0 + 0.1, d.z0 + 0.1);
  railA(d.x0 + 0.1, ez - 0.1, d.x0 + 0.1, d.z0 + 6);
  k.detail.mat(T.snow, 0, 0).col(SNOW);
  tbox(k.detail, (d.x0 + ex) / 2, y + 1.05, ez - 0.1, ex - d.x0 + 0.2, 0.12, 0.2);
  tbox(k.detail, ex - 0.1, y + 1.05, (d.z0 + ez) / 2, 0.2, 0.12, ez - d.z0 + 0.2);
  // coin binoculars looking out over the valley
  for (const x of [d.x0 + 6, d.x0 + 16]) {
    g.mat(T.metal, 0, 0).col("#2a5a8a");
    tube(g, [x, y, ez - 1.0], [x, y + 1.1, ez - 1.0], 0.08, 5);
    tbox(g, x, y + 1.1, ez - 1.0, 0.5, 0.35, 0.7, 0.3);
  }
  k.lamps.push([d.x0 + 2, y + 2.4, d.z0 + 2, 0]);
  k.lights.push([d.x0 + 2, d.z0 + 2, 6, "#ffc98a"]);
  k.glow.col("#ffcf88").box(d.x0 + 2, y + 2.4, d.z0 + 2, 0.3, 0.4, 0.3);
  g.mat(T.plain, 0, 0).col("#1e2024");
  tube(g, [d.x0 + 2, y, d.z0 + 2], [d.x0 + 2, y + 2.2, d.z0 + 2], 0.06, 4);
}

// ---------------------------------------------------------------------------------------
// chairlift towers and cables

export function liftGeo(k: Kit, a: AlpineData) {
  const lf = a.lift;
  const g = k.main;
  for (const s of lf.supports) {
    if (s.kind === "hold") {
      // hold-down sheaves on a portal frame: the cable runs level into / out of the station
      g.mat(T.metal, 0, 0).col("#d8dade");
      for (const sd of [-4, 4]) {
        tube(g, [lf.x + sd, s.ground - 0.5, s.z], [lf.x + sd, s.y + 0.9, s.z], 0.22, 6);
        g.mat(T.plain, 0, 0).col("#9a9ea6");
        g.cyl(lf.x + sd, s.ground - 0.2, s.z, 0.6, 0.4, 8, true);
        g.mat(T.metal, 0, 0).col("#d8dade");
      }
      g.mat(T.metal, 0, 0).col("#c8262a");
      tbox(g, lf.x, s.y + 0.6, s.z, 8.8, 0.45, 0.5);
      g.mat(T.metal, 0, 0).col("#40444c");
      for (const sd of [-1, 1]) tbox(g, lf.x + sd * lf.gauge, s.y + 0.15, s.z, 0.3, 0.3, 2.4);
      k.glow.col("#fff4e0").box(lf.x, s.y + 0.95, s.z, 0.3, 0.2, 0.3);
      continue;
    }
    if (s.kind !== "tower") continue;
    const top = s.y - 0.9;
    g.mat(T.metal, 0, 0).col("#d8dade");
    tube(g, [lf.x, s.ground - 1, s.z], [lf.x, top, s.z], 0.42, 8, 0.32);
    g.mat(T.plain, 0, 0).col("#9a9ea6");
    g.cyl(lf.x, s.ground - 0.2, s.z, 0.9, 0.5, 8, true);
    // crossarm and sheave trains
    g.mat(T.metal, 0, 0).col("#c8262a");
    tbox(g, lf.x, top, s.z, lf.gauge * 2 + 1.6, 0.55, 0.6);
    g.mat(T.metal, 0, 0).col("#40444c");
    for (const sd of [-1, 1]) tbox(g, lf.x + sd * lf.gauge, s.y - 0.35, s.z, 0.3, 0.3, 3.2);
    // service ladder and a light on top (the lit lift at night)
    g.mat(T.plain, 0, 0).col("#8a8e96");
    tube(g, [lf.x + 0.45, s.ground, s.z + 0.3], [lf.x + 0.45, top, s.z + 0.3], 0.03, 3);
    k.glow.col("#fff4e0").box(lf.x, top + 0.9, s.z, 0.35, 0.25, 0.35);
    k.lamps.push([lf.x, top + 0.9, s.z, 1]);
    k.lights.push([lf.x, s.z, 10, "#dfe8ff"]);
    k.glow.col("#ff3a2a").box(lf.x, top + 1.25, s.z, 0.16, 0.16, 0.16);
  }
  // two cables following a gentle catenary between supports
  g.mat(T.plain, 0, 0).col("#2a2c30");
  for (const sd of [-1, 1]) {
    const x = lf.x + sd * lf.gauge;
    for (let i = 0; i + 1 < lf.supports.length; i++) {
      const p = lf.supports[i]!;
      const q = lf.supports[i + 1]!;
      const n = 10;
      for (let t = 0; t < n; t++) {
        const a0 = t / n;
        const a1 = (t + 1) / n;
        const y0 = cableY(p, q, a0);
        const y1 = cableY(p, q, a1);
        tube(g, [x, y0, p.z + (q.z - p.z) * a0], [x, y1, p.z + (q.z - p.z) * a1], 0.05, 3);
      }
    }
  }
}
export function cableY(p: { z: number; y: number }, q: { z: number; y: number }, t: number) {
  const span = Math.abs(q.z - p.z);
  return p.y + (q.y - p.y) * t - span * 0.018 * 4 * t * (1 - t);
}

// ---------------------------------------------------------------------------------------
// props

const SLED_T = ["#c8262a", "#2a6fd6", "#f2c418", "#2a8a4a"];
function propGeo(k: Kit, p: AProp, r: () => number) {
  const { x, y, z, rot, s } = p;
  const g = k.main;
  const dg = k.detail;
  const S = Math.sin(rot);
  const C = Math.cos(rot);
  const W = (lx: number, lz: number): [number, number] => [
    x + lx * C + lz * S,
    z - lx * S + lz * C,
  ];
  switch (p.k) {
    case "lamp": {
      g.mat(T.plain, 0, 0).col("#1e2024");
      g.cyl(x, y - 0.2, z, 0.14, 0.7, 6, false, 0.09);
      g.cyl(x, y + 0.5, z, 0.07, 3.2, 5, false);
      const [ax, az] = W(0.55, 0);
      tube(g, [x, y + 3.5, z], [ax, y + 3.6, az], 0.04, 3);
      g.box(ax, y + 3.05, az, 0.34, 0.08, 0.34);
      g.cone(ax, y + 3.55, az, 0.3, 0.3, 4);
      k.glow.col("#ffcf88").box(ax, y + 3.12, az, 0.26, 0.42, 0.26);
      dg.mat(T.snow, 0, 0).col(SNOW);
      dg.cone(ax, y + 3.62, az, 0.22, 0.14, 4);
      k.lamps.push([ax, y + 3.3, az, 0]);
      k.lights.push([ax, az, 7, "#ffc98a"]);
      break;
    }
    case "flood": {
      g.mat(T.metal, 0, 0).col("#8a8e96");
      tube(g, [x, y - 0.5, z], [x, y + 10, z], 0.14, 5);
      g.mat(T.plain, 0, 0).col("#2a2c30");
      const [ax, az] = W(0, 0.6);
      g.box(ax, y + 9.6, az, 1.4, 0.5, 0.4);
      k.glow.col("#f4f8ff").box(ax, y + 9.55, az + 0.0, 1.2, 0.35, 0.44);
      k.lamps.push([ax, y + 9.5, az, 1]);
      const [px, pz] = W(0, 9);
      k.lights.push([px, pz, 15, "#cfdcff"]);
      break;
    }
    case "bench": {
      dg.mat(T.board, 0, 0).col("#8a5a32");
      tbox(dg, x, y + 0.42, z, 1.8, 0.08, 0.45, rot);
      const [bx, bz] = W(0, 0.22);
      tbox(dg, bx, y + 0.5, bz, 1.8, 0.45, 0.06, rot);
      dg.mat(T.plain, 0, 0).col("#1e2024");
      for (const sd of [-0.75, 0.75]) {
        const [lx, lz] = W(sd, 0);
        tbox(dg, lx, y, lz, 0.08, 0.42, 0.45, rot);
      }
      dg.mat(T.snow, 0, 0).col(SNOW);
      tbox(dg, x, y + 0.5, z, 1.76, 0.1, 0.42, rot);
      break;
    }
    case "snowbank": {
      g.mat(T.snow, 0, 0).col(r() < 0.5 ? SNOW : SNOW_SHADE);
      mound(g, x, y, z, 3.4 * s, 0.75 * s, 1.5 * s, rot + Math.PI / 2);
      break;
    }
    case "woodpile": {
      // split logs stacked end-out under a little roof board, snow resting on the board
      g.mat(T.log, 0, 0).col("#f0d4ac");
      tbox(g, x, y - 0.1, z, 2.4, 1.45, 0.8, rot);
      g.mat(T.board, 0, 0).col("#8a6a4a");
      tbox(g, x, y + 1.35, z, 2.7, 0.08, 1.1, rot);
      g.mat(T.snow, 0, 0).col(SNOW);
      tbox(g, x, y + 1.43, z, 2.66, 0.18, 1.06, rot);
      break;
    }
    case "skirack": {
      dg.mat(T.board, 0, 0).col("#6a4424");
      tbox(dg, x, y + 1.1, z, 3.2, 0.1, 0.12, rot);
      for (const sd of [-1.5, 1.5]) {
        const [lx, lz] = W(sd, 0);
        tbox(dg, lx, y, lz, 0.1, 1.2, 0.5, rot);
      }
      for (let i = 0; i < 7; i++) {
        const [sx, sz] = W(-1.3 + i * 0.42, 0.12);
        dg.mat(T.plain, 0, 0).col(SLED_T[i % 4]!);
        tbox(dg, sx, y, sz, 0.08, 1.7, 0.04, rot - 0.1);
      }
      break;
    }
    case "snowmobile": {
      const col = ["#c8262a", "#f2c418", "#2a6fd6", "#1e2024"][(p.v ?? 0) % 4]!;
      g.mat(T.plain, 0, 0).col(col);
      tbox(g, x, y + 0.35, z, 0.95, 0.55, 2.4, rot);
      const [fx, fz] = W(0, -0.9);
      tbox(g, fx, y + 0.3, fz, 0.9, 0.5, 0.9, rot);
      g.col("#1e2024");
      const [sx, sz] = W(0, 0.45);
      tbox(g, sx, y + 0.9, sz, 0.6, 0.18, 1.1, rot);
      g.mat(T.glasswall, 0.5, 0).col("#ffffff");
      const [wx, wz] = W(0, -0.5);
      tbox(g, wx, y + 0.9, wz, 0.8, 0.35, 0.06, rot + 0.0);
      dg.mat(T.plain, 0, 0).col("#2a2c30");
      for (const sd of [-0.45, 0.45]) {
        const [kx, kz] = W(sd, -0.9);
        tbox(dg, kx, y, kz, 0.12, 0.06, 1.6, rot);
      }
      tbox(dg, x, y, z + 0, 0.7, 0.35, 1.8, rot);
      g.mat(T.snow, 0, 0).col(SNOW);
      tbox(g, sx, y + 1.08, sz, 0.55, 0.06, 0.9, rot);
      break;
    }
    case "snowcat": {
      // a piste groomer: red body, glazed cab, rubber tracks, front blade, beacons
      g.mat(T.plain, 0, 0).col("#1e2024");
      for (const sd of [-1.45, 1.45]) {
        const [tx, tz] = W(sd, 0);
        tbox(g, tx, y, tz, 1.1, 1.15, 5.6, rot);
      }
      g.mat(T.plain, 0, 0).col(p.v === 1 ? "#f2a818" : "#d8261e");
      tbox(g, x, y + 1.1, z, 3.2, 1.0, 5.2, rot);
      const [cx, cz] = W(0, -0.6);
      g.mat(T.glasswall, 0.3, 0).col("#ffffff");
      tbox(g, cx, y + 2.1, cz, 2.6, 1.3, 2.4, rot);
      g.mat(T.plain, 0, 0).col(p.v === 1 ? "#f2a818" : "#d8261e");
      tbox(g, cx, y + 3.4, cz, 2.8, 0.2, 2.6, rot);
      g.mat(T.snow, 0, 0).col(SNOW);
      tbox(g, cx, y + 3.6, cz, 2.7, 0.22, 2.5, rot);
      const [bx, bz] = W(0, -3.4);
      g.mat(T.metal, 0, 0).col("#b8bcc4");
      tbox(g, bx, y + 0.1, bz, 4.4, 1.2, 0.3, rot);
      const [tx2, tz2] = W(0, 3.3);
      g.mat(T.plain, 0, 0).col("#3a3e44");
      tbox(g, tx2, y + 0.2, tz2, 3.6, 0.7, 1.2, rot);
      for (const sd of [-0.9, 0.9]) {
        const [lx, lz] = W(sd, -0.6);
        k.glow.col("#ffae2a").box(lx, y + 3.75, lz, 0.25, 0.2, 0.25);
      }
      const [hx, hz] = W(0, -1.9);
      k.glow.col("#fff4d8").box(hx, y + 2.9, hz, 2.0, 0.14, 0.1);
      break;
    }
    case "fountain": {
      g.mat(T.stone, 0, 0).col("#ffffff");
      g.cyl(x, y - 0.3, z, 2.2, 1.0, 8, false);
      g.mat(T.ice, 0, 0).col("#ffffff");
      g.cyl(x, y + 0.5, z, 2.0, 0.05, 8, true);
      g.mat(T.stone, 0, 0).col("#e0d8cc");
      g.cyl(x, y + 0.5, z, 0.35, 2.2, 8, false, 0.25);
      g.cyl(x, y + 2.7, z, 0.9, 0.2, 8, true);
      g.mat(T.snow, 0, 0).col(SNOW);
      g.cyl(x, y + 2.9, z, 0.85, 0.25, 8, true, 0.5);
      g.cyl(x, y + 0.7, z, 2.25, 0.18, 8, true, 2.0);
      break;
    }
    case "xmas": {
      g.mat(T.bark, 0, 0).col("#ffffff");
      g.cyl(x, y, z, 0.35, 2, 6, false);
      g.mat(T.needles, 0, 0).col("#ffffff");
      const tiers = 6;
      for (let i = 0; i < tiers; i++) {
        const t = i / tiers;
        g.cone(x, y + 1.2 + t * 8.5, z, 3.4 * (1 - t) + 0.5, 3.2, 9, 0);
      }
      g.mat(T.snow, 0, 0).col(SNOW);
      for (let i = 0; i < tiers; i++) {
        const t = i / tiers;
        g.cone(x, y + 2.6 + t * 8.5, z, (3.4 * (1 - t) + 0.5) * 0.55, 1.4, 9, 0.2);
      }
      const bulbs = ["#ffd27a", "#ff4a3a", "#fff6e0", "#ffae3a"];
      for (let i = 0; i < 80; i++) {
        const t = i / 80;
        const a = t * Math.PI * 14;
        const rr = (3.4 * (1 - t) + 0.5) * 0.85;
        k.glow
          .col(bulbs[i % 4]!)
          .box(x + Math.cos(a) * rr, y + 1.6 + t * 9, z + Math.sin(a) * rr, 0.16, 0.16, 0.16);
      }
      k.glow.col("#ffe27a");
      k.glow.cone(x, y + 11.6, z, 0.5, 0.8, 5);
      k.lamps.push([x, y + 6, z, 2]);
      k.lights.push([x, z, 11, "#ffb870"]);
      break;
    }
    case "marker": {
      const col = ["#2a5ad6", "#d8261e", "#1e2024"][p.v ?? 0]!;
      dg.mat(T.plain, 0, 0).col("#ff8a1a");
      dg.cyl(x, y - 0.2, z, 0.05, 1.4, 4, false);
      dg.col(col);
      dg.cyl(x, y + 1.2, z, 0.06, 0.6, 4, true);
      break;
    }
    case "trash": {
      dg.mat(T.metal, 0, 0).col("#2a5a3a");
      dg.cyl(x, y, z, 0.3, 0.9, 6, true);
      dg.mat(T.snow, 0, 0).col(SNOW);
      dg.cyl(x, y + 0.9, z, 0.32, 0.12, 6, true, 0.2);
      break;
    }
    case "heater": {
      dg.mat(T.metal, 0, 0).col("#8a8e96");
      dg.cyl(x, y, z, 0.25, 0.3, 6, true);
      dg.cyl(x, y + 0.3, z, 0.05, 2, 4, false);
      dg.cyl(x, y + 2.3, z, 0.7, 0.1, 8, true, 0.2);
      k.glow.col("#ff7a2a").box(x, y + 2.05, z, 0.24, 0.3, 0.24);
      k.lamps.push([x, y + 2.05, z, 2]);
      k.lights.push([x, z, 3.5, "#ff9040"]);
      break;
    }
    case "table": {
      dg.mat(T.plain, 0, 0).col("#1e2024");
      dg.cyl(x, y, z, 0.05, 0.75, 4, false);
      dg.mat(T.board, 0, 0).col("#8a5a32");
      dg.cyl(x, y + 0.75, z, 0.45, 0.05, 8, true);
      dg.mat(T.snow, 0, 0).col(SNOW);
      dg.cyl(x, y + 0.8, z, 0.44, 0.08, 8, true, 0.35);
      break;
    }
    case "sled": {
      dg.mat(T.board, 0, 0).col(SLED_T[Math.floor(r() * 4)]!);
      tbox(dg, x, y + 0.25, z, 0.45, 0.06, 1.1, rot);
      dg.mat(T.plain, 0, 0).col("#2a2c30");
      for (const sd of [-0.2, 0.2]) {
        const [lx, lz] = W(sd, 0);
        tbox(dg, lx, y, lz, 0.04, 0.25, 1.1, rot);
      }
      break;
    }
    case "boulder": {
      g.mat(T.rock, 0, 0).col(["#ffffff", "#e8e4dc", "#d8dce4", "#f0ece4"][p.v ?? 0]!);
      blob(g, x, y - s * 0.2, z, s, s * 0.9, s * 0.85, r, 7, rot);
      g.mat(T.snow, 0, 0).col(SNOW);
      blob(g, x + s * 0.05, y + s * 0.45, z, s * 0.62, s * 0.3, s * 0.55, r, 6, rot);
      break;
    }
    case "snowman": {
      g.mat(T.snow, 0, 0).col(SNOW);
      blob(g, x, y + 0.3, z, 0.7, 0.8, 0.7, r, 8);
      blob(g, x, y + 1.05, z, 0.5, 0.55, 0.5, r, 8);
      blob(g, x, y + 1.55, z, 0.34, 0.38, 0.34, r, 8);
      dg.mat(T.plain, 0, 0).col("#ff7a1a");
      const [nx, nz] = W(0, -0.32);
      tube(dg, [x, y + 1.75, z], [nx, y + 1.73, nz], 0.05, 4, 0.01);
      dg.col("#1e2024");
      dg.cyl(x, y + 1.95, z, 0.28, 0.35, 6, true);
      dg.cyl(x, y + 1.93, z, 0.42, 0.04, 6, true);
      break;
    }
    case "flag": {
      g.mat(T.metal, 0, 0).col("#e8eaec");
      tube(g, [x, y - 0.3, z], [x, y + 8 * s, z], 0.07, 4, 0.05);
      dg.mat(T.plain, 0, 0).col("#d8261e");
      dg.box(x + 0.8, y + 8 * s - 1.1, z, 1.6, 1.2, 0.04);
      dg.col("#ffffff");
      dg.box(x + 0.8, y + 8 * s - 1.1, z, 0.9, 0.26, 0.06);
      dg.box(x + 0.8, y + 8 * s - 1.1, z, 0.26, 0.9, 0.06);
      break;
    }
    case "signpost": {
      dg.mat(T.metal, 0, 0).col("#8a8e96");
      dg.cyl(x, y - 0.2, z, 0.06, 2.8, 5, true);
      dg.mat(T.plain, 0, 0).col("#f2c418");
      for (let i = 0; i < 3; i++) {
        const a = rot + i * 1.9;
        const [ax, az] = [x + Math.cos(a) * 0.55, z - Math.sin(a) * 0.55];
        tbox(dg, ax, y + 1.8 + i * 0.32, az, 1.1, 0.24, 0.05, a);
      }
      break;
    }
    case "umbrella": {
      // café parasol over a deck table, closed-up canvas with snow on top
      const col = ["#b8252a", "#f4efe6", "#2a5a3a", "#1c4aa0"][(p.v ?? 0) % 4]!;
      dg.mat(T.plain, 0, 0).col("#3a2e24");
      tube(dg, [x, y, z], [x, y + 2.5, z], 0.04, 4);
      dg.mat(T.plain, 0, 0).col(col);
      dg.cone(x, y + 2.0, z, 1.5, 0.7, 8, 0);
      dg.mat(T.snow, 0, 0).col(SNOW);
      dg.cone(x, y + 2.25, z, 1.0, 0.5, 8, 0);
      break;
    }
    case "barrel": {
      dg.mat(T.board, 0, 0).col("#8a5a32");
      dg.cyl(x, y, z, 0.35, 0.9, 7, true, 0.33);
      dg.mat(T.snow, 0, 0).col(SNOW);
      dg.cyl(x, y + 0.9, z, 0.34, 0.1, 7, true, 0.2);
      break;
    }
    default:
      break;
  }
}

// ---------------------------------------------------------------------------------------
// solo blockades: themed barriers that seal the playable square

function blockadeGeo(k: Kit, bl: Blockade, r: () => number) {
  const g = k.main;
  const alongX = bl.axis === "x";
  const n = Math.max(2, Math.round(bl.w / 3));
  const at = (t: number): [number, number] =>
    alongX ? [bl.x - bl.w / 2 + t * bl.w, bl.z] : [bl.x, bl.z - bl.w / 2 + t * bl.w];
  const out = alongX ? [0, Math.sign(bl.z)] : [Math.sign(bl.x), 0]; // outward from the square
  const rot = alongX ? 0 : Math.PI / 2;
  const gy = (x: number, z: number) => groundFn(x, z);
  switch (bl.style) {
    case "debris": {
      // avalanche debris: a ridge of piled snow with broken blocks and snapped trunks in it
      for (let t = 0; t <= 1.001; t += 3.5 / bl.w) {
        const [x, z] = at(Math.min(1, t));
        const o = 0.6 + r() * 1.4; // outward of the sealed line, so nobody stands inside it
        const px = x + out[0]! * o;
        const pz = z + out[1]! * o;
        g.mat(T.snow, 0, 0).col(r() < 0.5 ? SNOW : SNOW_SHADE);
        mound(
          g,
          px,
          gy(px, pz),
          pz,
          7 + r() * 3,
          2.4 + r() * 1.2,
          5 + r() * 2,
          rot + (r() - 0.5) * 0.6,
        );
      }
      g.mat(T.bark, 0, 0).col("#ffffff");
      for (let i = 0; i < 3; i++) {
        const [x, z] = at(0.15 + r() * 0.7);
        const a = r() * 6.28;
        const L = 3 + r() * 4;
        tube(
          g,
          [x, gy(x, z) + 1.2, z],
          [x + Math.cos(a) * L, gy(x, z) + 2.2 + r() * 2.2, z + Math.sin(a) * L],
          0.22,
          5,
          0.12,
        );
      }
      const [sx, sz] = at(0.5);
      signBoard(
        k,
        sx - out[0]! * 4.6,
        gy(sx - out[0]! * 4.6, sz - out[1]! * 4.6),
        sz - out[1]! * 4.6,
        rot,
        W_AVALANCHE,
        out,
      );
      break;
    }
    case "closed": {
      // PISTE CLOSED: orange safety mesh on poles, warning signs, a snow wall behind
      const posts = Math.max(2, Math.round(bl.w / 2.5));
      for (let i = 0; i < posts; i++) {
        const [x0, z0] = at(i / posts);
        const [x1, z1] = at((i + 1) / posts);
        g.mat(T.plain, 0, 0).col("#1e2024");
        tube(g, [x0, gy(x0, z0) - 0.3, z0], [x0, gy(x0, z0) + 1.9, z0], 0.04, 4);
        g.mat(T.mesh, 0, 0).col("#ffffff");
        const ya = gy(x0, z0);
        const yb = gy(x1, z1);
        q4(
          g,
          [x0, ya + 0.15, z0],
          [x1, yb + 0.15, z1],
          [x1, yb + 1.7, z1],
          [x0, ya + 1.7, z0],
          [-out[0]!, 0, -out[1]!],
          [0, 0, 1.25, 0.8],
        );
        q4(
          g,
          [x0, ya + 0.15, z0],
          [x1, yb + 0.15, z1],
          [x1, yb + 1.7, z1],
          [x0, ya + 1.7, z0],
          [out[0]!, 0, out[1]!],
          [0, 0, 1.25, 0.8],
        );
      }
      for (let t = 0; t <= 1.001; t += 4 / bl.w) {
        const [x, z] = at(Math.min(1, t));
        const px = x + out[0]! * 2.6;
        const pz = z + out[1]! * 2.6;
        g.mat(T.snow, 0, 0).col(SNOW);
        mound(g, px, gy(px, pz), pz, 7, 2.6, 4, rot);
      }
      const [sx, sz] = at(0.5);
      signBoard(
        k,
        sx - out[0]! * 4.6,
        gy(sx - out[0]! * 4.6, sz - out[1]! * 4.6),
        sz - out[1]! * 4.6,
        rot,
        W_CLOSED,
        out,
      );
      if (bl.w > 10) {
        const [ax, az] = at(0.2);
        signBoard(
          k,
          ax - out[0]! * 4.6,
          gy(ax - out[0]! * 4.6, az - out[1]! * 4.6),
          az - out[1]! * 4.6,
          rot,
          W_AVALANCHE,
          out,
        );
      }
      // a groomer parked across the wider runs
      if (bl.w > 16) {
        const [cx, cz] = at(0.72);
        propGeo(
          k,
          {
            k: "snowcat",
            x: cx + out[0]! * 1.2,
            z: cz + out[1]! * 1.2,
            y: gy(cx, cz),
            rot: rot + Math.PI / 2,
            s: 1,
            v: 1,
          },
          r,
        );
      }
      break;
    }
    case "gate": {
      // ROAD CLOSED: a red and white barrier arm, a plough ridge heaped behind it
      const [x0, z0] = at(0);
      const [x1, z1] = at(1);
      g.mat(T.plain, 0, 0).col("#f4f6f8");
      for (const [x, z] of [
        [x0, z0],
        [x1, z1],
      ] as const)
        tube(g, [x, gy(x, z) - 0.3, z], [x, gy(x, z) + 1.3, z], 0.12, 5);
      g.mat(T.hazard, 0, 0).col("#ffffff");
      const ya = gy(x0, z0) + 1.0;
      const yb = gy(x1, z1) + 1.0;
      q4(
        g,
        [x0, ya, z0],
        [x1, yb, z1],
        [x1, yb + 0.3, z1],
        [x0, ya + 0.3, z0],
        [-out[0]!, 0, -out[1]!],
        [0, 0, bl.w / 2, 0.15],
      );
      q4(
        g,
        [x0, ya, z0],
        [x1, yb, z1],
        [x1, yb + 0.3, z1],
        [x0, ya + 0.3, z0],
        [out[0]!, 0, out[1]!],
        [0, 0, bl.w / 2, 0.15],
      );
      // the plough ridge: the road's snow bulldozed into a wall behind the gate
      for (let t = 0; t <= 1.001; t += 3.5 / bl.w) {
        const [x, z] = at(Math.min(1, t));
        const px = x + out[0]! * 2.8;
        const pz = z + out[1]! * 2.8;
        g.mat(T.snow, 0, 0).col(r() < 0.5 ? SNOW : SNOW_SHADE);
        mound(g, px, gy(px, pz), pz, 7.5, 3 + r() * 0.5, 4.5, rot + (r() - 0.5) * 0.2);
      }
      const [sx, sz] = at(0.5);
      signBoard(
        k,
        sx - out[0]! * 4.6,
        gy(sx - out[0]! * 4.6, sz - out[1]! * 4.6),
        sz - out[1]! * 4.6,
        rot,
        W_ROAD,
        out,
      );
      // flashing lamps on the posts
      for (const [x, z] of [
        [x0, z0],
        [x1, z1],
      ] as const) {
        k.glow.col("#ffae2a").box(x, gy(x, z) + 1.45, z, 0.22, 0.22, 0.22);
        k.lamps.push([x, gy(x, z) + 1.45, z, 2]);
      }
      break;
    }
    case "rockfall": {
      for (let i = 0; i <= n; i++) {
        const [x, z] = at(i / n);
        const s = 1.4 + r() * 1.3;
        g.mat(T.rock, 0, 0).col("#ffffff");
        blob(g, x, gy(x, z) + s * 0.3, z, s, s, s, r, 7, r() * 6);
        g.mat(T.snow, 0, 0).col(SNOW);
        blob(g, x, gy(x, z) + s * 1.05, z, s * 0.6, s * 0.3, s * 0.55, r, 6);
      }
      break;
    }
    default: {
      // deadfall: fallen spruce trunks piled across the gap, snow on top, thicket behind
      for (let i = 0; i < Math.max(3, n); i++) {
        const [xa, za] = at(r() * 0.4);
        const [xb, zb] = at(0.6 + r() * 0.4);
        // trunks lie on the snow or on each other (never hovering)
        const h0 = 0.28 + (i % 3) * 0.42;
        const h1 = 0.28 + ((i + 1) % 3) * 0.42;
        const oa = (r() - 0.5) * 1.6;
        const ob = (r() - 0.5) * 1.6;
        const A: V3 = [xa + out[0]! * oa, gy(xa, za) + h0, za + out[1]! * oa];
        const B: V3 = [xb + out[0]! * ob, gy(xb, zb) + h1, zb + out[1]! * ob];
        g.mat(T.bark, 0, 0).col("#ffffff");
        tube(g, A, B, 0.28 + r() * 0.12, 6, 0.16);
        g.mat(T.snow, 0, 0).col(SNOW);
        tube(g, [A[0], A[1] + 0.26, A[2]], [B[0], B[1] + 0.2, B[2]], 0.16, 4, 0.1);
        // dead branches
        g.mat(T.needles, 0, 0).col("#8a8a7a");
        for (let bI = 0; bI < 3; bI++) {
          const t = r();
          const p: V3 = [
            A[0] + (B[0] - A[0]) * t,
            A[1] + (B[1] - A[1]) * t,
            A[2] + (B[2] - A[2]) * t,
          ];
          tube(
            g,
            p,
            [p[0] + (r() - 0.5) * 2, p[1] + 0.6 + r(), p[2] + (r() - 0.5) * 2],
            0.06,
            3,
            0.02,
          );
        }
      }
      for (let i = 0; i <= n; i++) {
        const [x, z] = at(i / n);
        g.mat(T.snow, 0, 0).col(SNOW_SHADE);
        mound(
          g,
          x + out[0]! * 0.8,
          gy(x, z),
          z + out[1]! * 0.8,
          4.5,
          1.1,
          3,
          rot + (r() - 0.5) * 0.5,
        );
      }
      break;
    }
  }
}

function signBoard(
  k: Kit,
  x: number,
  y: number,
  z: number,
  rot: number,
  word: number,
  out: number[],
) {
  const g = k.main;
  const alongX = Math.abs(Math.cos(rot)) > 0.5;
  g.mat(T.metal, 0, 0).col("#8a8e96");
  const dx = alongX ? 1.3 : 0;
  const dz = alongX ? 0 : 1.3;
  tube(g, [x - dx, y - 0.2, z - dz], [x - dx, y + 2.9, z - dz], 0.06, 4);
  tube(g, [x + dx, y - 0.2, z + dz], [x + dx, y + 2.9, z + dz], 0.06, 4);
  // the sign faces into the square (towards the player)
  const fx = -out[0]!;
  const fz = -out[1]!;
  k.signs.mat(0, 0, 0).col("#ffffff");
  // A (left) and B (right) as seen by a viewer on the inside
  // the viewer looks along -f; their right-hand side is (fz, -fx)
  const rx = fz;
  const rz = -fx;
  const hw = 1.6;
  face(
    k.signs,
    x - rx * hw + fx * 0.05,
    z - rz * hw + fz * 0.05,
    x + rx * hw + fx * 0.05,
    z + rz * hw + fz * 0.05,
    y + 2.0,
    y + 2.75,
    signUV(word),
  );
  g.mat(T.board, 0, 0).col("#b08a60");
  face(g, x + rx * hw, z + rz * hw, x - rx * hw, z - rz * hw, y + 2.0, y + 2.75, [0, 0, 1, 1]);
}

// ---------------------------------------------------------------------------------------

export function buildInto(
  kitAt: (x: number, z: number) => Kit,
  a: AlpineData,
  ground: (x: number, z: number) => number,
) {
  groundFn = ground;
  for (const b of a.buildings) {
    const k = kitAt((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2);
    const r = mulberry(Math.floor(b.seed * 1e9) + 7);
    const pitch = 0.62 + r() * 0.2;
    switch (b.t) {
      case "hotel":
        hotel(k, b);
        break;
      case "church":
        church(k, b);
        break;
      case "station":
        gableHouse(k, b, {
          floors: 1,
          style: 1,
          pitch: 0.55,
          balconies: [],
          cafe: false,
          shop: true,
          barn: false,
          sign: b.sign,
          chimneys: 1,
          door: true,
        });
        break;
      case "topstation":
        gableHouse(k, b, {
          floors: 1,
          style: 0,
          pitch: 0.6,
          balconies: [],
          cafe: false,
          shop: false,
          barn: false,
          sign: b.sign,
          chimneys: 0,
          door: false,
        });
        break;
      case "summit":
        summitLodge(k, b, a);
        break;
      case "barn":
        gableHouse(k, b, {
          floors: 2,
          style: 2,
          pitch: 0.55,
          balconies: [],
          cafe: false,
          shop: false,
          barn: true,
          sign: -1,
          chimneys: 0,
          door: true,
        });
        break;
      case "hut":
        gableHouse(k, b, {
          floors: 1,
          style: 2,
          pitch: 0.7,
          balconies: [],
          cafe: false,
          shop: false,
          barn: false,
          sign: -1,
          chimneys: 1,
          door: true,
        });
        break;
      case "ticket":
        gableHouse(k, b, {
          floors: 1,
          style: 1,
          pitch: 0.7,
          balconies: [],
          cafe: false,
          shop: true,
          barn: false,
          sign: -1,
          chimneys: 0,
          door: false,
        });
        break;
      case "boathouse":
        gableHouse(k, b, {
          floors: 1,
          style: 2,
          pitch: 0.6,
          balconies: [],
          cafe: false,
          shop: false,
          barn: true,
          sign: -1,
          chimneys: 0,
          door: true,
        });
        break;
      case "lodge":
        gableHouse(k, b, {
          floors: b.floors,
          style: b.style === 3 ? 1 : b.style,
          pitch: pitch - 0.05,
          balconies: [1, 2],
          cafe: false,
          shop: b.sign >= 0,
          barn: false,
          sign: b.sign,
          chimneys: 2,
          door: true,
        });
        break;
      case "rental":
        gableHouse(k, b, {
          floors: 2,
          style: 1,
          pitch,
          balconies: [1],
          cafe: false,
          shop: true,
          barn: false,
          sign: b.sign,
          chimneys: 1,
          door: true,
        });
        break;
      case "cafe":
        gableHouse(k, b, {
          floors: b.floors,
          style: b.style,
          pitch,
          balconies: [1],
          cafe: true,
          shop: false,
          barn: false,
          sign: b.sign,
          chimneys: 1,
          door: true,
        });
        break;
      case "shop":
        gableHouse(k, b, {
          floors: b.floors,
          style: b.style,
          pitch,
          balconies: [1],
          cafe: false,
          shop: true,
          barn: false,
          sign: b.sign,
          chimneys: 1,
          door: true,
        });
        break;
      default:
        gableHouse(k, b, {
          floors: b.floors,
          style: b.style,
          pitch,
          balconies: b.floors >= 2 ? [1] : [],
          cafe: false,
          shop: false,
          barn: false,
          sign: -1,
          chimneys: 1,
          door: true,
        });
    }
  }
  const r = mulberry(99173);
  coveredBridge(kitAt(a.bridge.x0, a.bridge.z), a);
  for (const t of a.terminals) terminal(kitAt((t.x0 + t.x1) / 2, (t.z0 + t.z1) / 2), a, t);
  // retaining walls where the pads cut into the mountain
  const bt = a.terminals[0]!;
  retaining(kitAt(40, bt.z0), 6, 84, bt.z0 - 2.6, bt.y, 1);
  const isl = a.island;
  retaining(kitAt(40, isl.z0), isl.x0 - 2, isl.x1 + 2, isl.z0 - 2.6, a.plateau, 1);
  // the summit island's fence (the lodge deck and the observation deck have railings)
  const kIsl = kitAt(40, isl.z0);
  fence(kIsl, isl.x0 - 1, isl.z0 - 1, isl.x0 - 1, a.lodgeDeck.z0);
  fence(kIsl, isl.x1 + 1, isl.z0 - 1, isl.x1 + 1, a.deck.z0);
  fence(kIsl, a.lodgeDeck.x1 + 2, isl.z1 + 1, a.deck.x0 - 1, isl.z1 + 1);
  rink(kitAt(a.rink.x0, a.rink.z0), a);
  skiJump(kitAt(a.jump.x, a.jump.z1), a);
  deck(kitAt(a.deck.x0, a.deck.z0), a);
  liftGeo(
    kitAt(a.lift.x, (a.lift.supports[0]!.z + a.lift.supports[a.lift.supports.length - 1]!.z) / 2),
    a,
  );
  for (const p of a.props) {
    if (p.k === "tower") continue;
    propGeo(kitAt(p.x, p.z), p, r);
  }
  for (const bl of a.blockades) blockadeGeo(kitAt(bl.x, bl.z), bl, r);
}
