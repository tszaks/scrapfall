// Geometry for the access buildings.
//   exterior  - entrance surrounds, signs, penthouses, rooftop props (world space, merged,
//               lit by the scene like the city)
//   interior  - lobby, vestibule, stairwell, car (local space per building, baked lighting,
//               only drawn near the player)
// Rules from the quality bar: every decal / frame / sign sits proud of the surface behind it
// (1.5 cm or more), nothing is coplanar with the city's facades (the hole cut in the facade is
// lined by reveals, frames sit on the face with their back faces omitted), verticals vertical.
import * as THREE from "three";

import {
  BULKHEAD_H,
  CAR_D,
  CAR_H,
  CAR_W,
  LOBBY_CEIL,
  VEST_CEIL,
  toWorld,
  type AccessBuilding,
} from "./layout";
import { IGeo, IDENTITY, type BakeLight } from "./geo";
import { SIGN, signUV } from "./textures";

const FLOOR_Y = 0.17; // lobby floors sit just over the city's lot paving (0.15)
export const STREET_DOOR_H = { elevator: 2.9, stairs: 2.45 } as const;

export type Interior = {
  /** baked, local frame */
  base: THREE.BufferGeometry;
  glow: THREE.BufferGeometry;
  sign: THREE.BufferGeometry;
  steel: THREE.BufferGeometry;
  wood: THREE.BufferGeometry;
  conc: THREE.BufferGeometry;
};
export type CarGeo = Interior;
export type DisplaySpot = { a: number; y: number; d: number; w: number; h: number; face: 1 | -1; level: 0 | 1 | 2 | 3 };

export type BuiltBuilding = {
  /** ground floor (lobby / whole stairwell) */
  low: Interior;
  /** roof vestibule (elevators) */
  high: Interior | null;
  car: CarGeo | null;
  displays: DisplaySpot[];
  theta: number;
};

export type BuiltAccess = {
  ext: THREE.BufferGeometry;
  glow: THREE.BufferGeometry;
  sign: THREE.BufferGeometry;
  pools: THREE.BufferGeometry;
  beacons: [number, number, number][];
  per: BuiltBuilding[];
};

/** one geometry per interior material: vertex-colour only, brushed steel, wood veneer,
 * concrete (the textured ones use planar world-scale uvs), lamps, signs */
type Set4 = { base: IGeo; glow: IGeo; sign: IGeo; steel: IGeo; wood: IGeo; conc: IGeo };
const set4 = (): Set4 => {
  const g = () => new IGeo();
  const steel = g();
  steel.worldUV = 1.2;
  const wood = g();
  wood.worldUV = 1.2;
  const conc = g();
  conc.worldUV = 2;
  return { base: g(), glow: g(), sign: g(), steel, wood, conc };
};
const built = (s: Set4): Interior => ({
  base: s.base.build(),
  glow: s.glow.build(),
  sign: s.sign.build(),
  steel: s.steel.build(),
  wood: s.wood.build(),
  conc: s.conc.build(),
});
/** thin square tube along a (fixed d), for handrails across a wall */
function railA(G: IGeo, d: number, y: number, a0: number, a1: number, r = 0.025) {
  G.box(a0, a1, y - r, y + r, d - r, d + r, "-a+a");
}

/** a sign quad in the plane d (facing +d or -d), centred on a */
function signD(G: IGeo, row: number, a: number, y0: number, y1: number, d: number, w: number, face: 1 | -1, cell = 0, n = 1) {
  const uv = signUV(row, cell, n);
  if (face > 0) G.quad([a - w / 2, y0, d], [a + w / 2, y0, d], [a + w / 2, y1, d], [a - w / 2, y1, d], 1, 1, uv);
  else G.quad([a + w / 2, y0, d], [a - w / 2, y0, d], [a - w / 2, y1, d], [a + w / 2, y1, d], 1, 1, uv);
}
/** a sign quad in the plane a (facing +a or -a), centred on d */
function signA(G: IGeo, row: number, d: number, y0: number, y1: number, a: number, w: number, face: 1 | -1, cell = 0, n = 1) {
  const uv = signUV(row, cell, n);
  if (face > 0) G.quad([a, y0, d + w / 2], [a, y0, d - w / 2], [a, y1, d - w / 2], [a, y1, d + w / 2], 1, 1, uv);
  else G.quad([a, y0, d - w / 2], [a, y0, d + w / 2], [a, y1, d + w / 2], [a, y1, d - w / 2], 1, 1, uv);
}

/** a wall in the plane d with a rectangular hole [ha0, ha1] x [y0, hy1] */
function wallDHole(G: IGeo, a0: number, a1: number, y0: number, y1: number, d: number, face: boolean, ha0: number, ha1: number, hy1: number, tile = 0) {
  if (ha0 > a0) G.wallD(a0, ha0, y0, y1, d, face, tile);
  if (ha1 < a1) G.wallD(ha1, a1, y0, y1, d, face, tile);
  if (hy1 < y1) G.wallD(ha0, ha1, hy1, y1, d, face, tile);
}
function wallAHole(G: IGeo, d0: number, d1: number, y0: number, y1: number, a: number, face: boolean, hd0: number, hd1: number, hy0: number, hy1: number, tile = 0) {
  if (hd0 > d0) G.wallA(d0, hd0, y0, y1, a, face, tile);
  if (hd1 < d1) G.wallA(hd1, d1, y0, y1, a, face, tile);
  if (hy1 < y1) G.wallA(hd0, hd1, hy1, y1, a, face, tile);
  if (hy0 > y0) G.wallA(hd0, hd1, y0, hy0, a, face, tile);
}
/** thin square tube from p to q (local), for handrails */
function rail(G: IGeo, a: number, y0: number, d0: number, y1: number, d1: number, r = 0.025) {
  const P = (dy: number, da: number, t: number) => [a + da, (t ? y1 : y0) + dy, t ? d1 : d0];
  // four long faces
  G.quad(P(r, -r, 0), P(r, r, 0), P(r, r, 1), P(r, -r, 1)); // top
  G.quad(P(-r, r, 0), P(-r, -r, 0), P(-r, -r, 1), P(-r, r, 1)); // bottom
  G.quad(P(-r, r, 0), P(-r, r, 1), P(r, r, 1), P(r, r, 0)); // +a
  G.quad(P(-r, -r, 1), P(-r, -r, 0), P(r, -r, 0), P(r, -r, 1)); // -a
}

// ------------------------------------------------------------------ exterior

function entrance(E: IGeo, GL: IGeo, SG: IGeo, PL: IGeo, b: AccessBuilding) {
  const elev = b.kind === "elevator";
  const q = b.portals[0];
  const hw = q.half + 0.15;
  const hh = elev ? STREET_DOOR_H.elevator : STREET_DOOR_H.stairs;
  const wall = q.wall;
  const y0 = b.groundY;
  E.frame(b);
  GL.frame(b);
  SG.frame(b);
  PL.frame(b);
  // reveals lining the hole cut in the facade (city walls are zero-thickness at d = 0)
  E.color(elev ? "#3a3634" : "#4a4f55");
  E.wallA(0, wall, y0, y0 + hh, -hw, true);
  E.wallA(0, wall, y0, y0 + hh, hw, false);
  E.flat(-hw, hw, 0, wall, y0 + hh, false);
  // stone threshold
  E.color("#8d877c");
  E.box(-hw, hw, y0, y0 + FLOOR_Y + 0.015, -0.3, wall, "b");
  // pilasters and a head, proud of the facade (back faces omitted: never coplanar)
  const pw = elev ? 0.38 : 0.2;
  const pd = elev ? 0.16 : 0.1;
  E.color(elev ? "#26272b" : "#39414a");
  E.box(-hw - pw, -hw, y0, y0 + hh + (elev ? 0.55 : 0.28), -pd, 0, "b+d");
  E.box(hw, hw + pw, y0, y0 + hh + (elev ? 0.55 : 0.28), -pd, 0, "b+d");
  E.box(-hw, hw, y0 + hh, y0 + hh + (elev ? 0.55 : 0.28), -pd, 0, "b+d");
  // LED strips down the inner edges of the pilasters
  GL.color(elev ? "#ffe2b0" : "#c8ffd8");
  GL.box(-hw - 0.07, -hw - 0.03, y0 + 0.25, y0 + hh, -pd - 0.018, -pd, "b+d");
  GL.box(hw + 0.03, hw + 0.07, y0 + 0.25, y0 + hh, -pd - 0.018, -pd, "b+d");
  if (elev) {
    // a canopy over the door, lit from below, carrying the ELEVATOR sign
    const cw = hw + pw + 0.5;
    const cy0 = y0 + hh + 0.55;
    const cd = 1.25;
    E.color("#1d1e22");
    E.box(-cw, cw, cy0, cy0 + 0.42, -cd, -pd, "+d");
    GL.color("#fff0d0");
    for (const a of [-cw + 0.35, cw - 0.35]) GL.box(a - 0.12, a + 0.12, cy0 - 0.012, cy0, -cd + 0.25, -cd + 0.5, "t");
    GL.box(-cw + 0.15, cw - 0.15, cy0 - 0.012, cy0, -cd + 0.06, -cd + 0.12, "t");
    SG.color("#ffffff");
    signD(SG, SIGN.ELEVATOR, 0, cy0 + 0.05, cy0 + 0.37, -cd - 0.018, Math.min(2 * cw - 0.2, 2.6), -1);
    // and on the canopy's ends
    SG.color("#ffffff");
    // a light pool on the sidewalk under the canopy
    PL.color("#ffc98a", 0.9);
    PL.quad([-2.6, y0 + 0.166, -0.1], [2.6, y0 + 0.166, -0.1], [2.6, y0 + 0.166, -3.6], [-2.6, y0 + 0.166, -3.6], 1, 1, [0, 0, 1, 1]);
  } else {
    // stairs: a small hood and a backlit STAIRS sign on a backing plate
    const cy0 = y0 + hh + 0.28;
    E.color("#2b3036");
    E.box(-hw - 0.45, hw + 0.45, cy0, cy0 + 0.14, -0.6, -pd, "+d");
    GL.color("#e6fff0");
    GL.box(-hw, hw, cy0 - 0.02, cy0, -0.45, -0.3, "t");
    E.color("#16241c");
    E.box(-1.15, 1.15, cy0 + 0.2, cy0 + 0.62, -0.05, 0, "b+d");
    SG.color("#ffffff");
    signD(SG, SIGN.STAIRS, 0, cy0 + 0.23, cy0 + 0.59, -0.068, 2.2, -1);
    PL.color("#c8ffe0", 0.55);
    PL.quad([-1.8, y0 + 0.166, -0.1], [1.8, y0 + 0.166, -0.1], [1.8, y0 + 0.166, -2.6], [-1.8, y0 + 0.166, -2.6], 1, 1, [0, 0, 1, 1]);
  }
}

function penthouse(E: IGeo, GL: IGeo, SG: IGeo, PL: IGeo, b: AccessBuilding, beacons: [number, number, number][]) {
  const P = b.pent;
  const y0 = b.top;
  const y1 = y0 + b.pentH;
  const q = b.portals[1];
  const dh = 2.25; // roof door height
  E.frame(b);
  GL.frame(b);
  SG.frame(b);
  PL.frame(b);
  E.color(b.kind === "elevator" ? "#b8b3aa" : "#a9a59c");
  const t = 1.0;
  if (q.nd !== 0) {
    // door on the front (-d) face
    wallDHole(E, P.a0, P.a1, y0, y1, P.d0, false, q.a - q.half, q.a + q.half, y0 + dh, t);
    E.wallD(P.a0, P.a1, y0, y1, P.d1, true, t);
    E.wallA(P.d0, P.d1, y0, y1, P.a0, false, t);
    E.wallA(P.d0, P.d1, y0, y1, P.a1, true, t);
    // reveals
    E.color("#8c8880");
    E.wallA(P.d0, P.d0 + q.wall, y0, y0 + dh, q.a - q.half, true);
    E.wallA(P.d0, P.d0 + q.wall, y0, y0 + dh, q.a + q.half, false);
    E.flat(q.a - q.half, q.a + q.half, P.d0, P.d0 + q.wall, y0 + dh, false);
    // frame, proud
    E.color("#3b3f45");
    E.box(q.a - q.half - 0.12, q.a - q.half, y0, y0 + dh + 0.12, P.d0 - 0.07, P.d0, "b+d");
    E.box(q.a + q.half, q.a + q.half + 0.12, y0, y0 + dh + 0.12, P.d0 - 0.07, P.d0, "b+d");
    E.box(q.a - q.half, q.a + q.half, y0 + dh, y0 + dh + 0.12, P.d0 - 0.07, P.d0, "b+d");
    // sign on a plate and a wall lamp
    E.color("#1a1a1c");
    E.box(q.a - 0.95, q.a + 0.95, y0 + dh + 0.3, y0 + dh + 0.72, P.d0 - 0.05, P.d0, "b+d");
    SG.color("#ffffff");
    signD(SG, b.kind === "elevator" ? SIGN.ELEVATOR : SIGN.ROOF, q.a, y0 + dh + 0.33, y0 + dh + 0.69, P.d0 - 0.066, 1.8, -1);
    GL.color("#ffe7c0");
    GL.box(q.a + q.half + 0.35, q.a + q.half + 0.6, y0 + dh + 0.05, y0 + dh + 0.25, P.d0 - 0.16, P.d0, "+d");
    PL.color("#ffcf96", 0.8);
    PL.quad([q.a - 2.2, y0 + 0.03, P.d0 - 0.05], [q.a + 2.2, y0 + 0.03, P.d0 - 0.05], [q.a + 2.2, y0 + 0.03, P.d0 - 3.2], [q.a - 2.2, y0 + 0.03, P.d0 - 3.2]);
  } else {
    // stair bulkhead: door on the +a face
    E.wallD(P.a0, P.a1, y0, y1, P.d0, false, t);
    E.wallD(P.a0, P.a1, y0, y1, P.d1, true, t);
    E.wallA(P.d0, P.d1, y0, y1, P.a0, false, t);
    wallAHole(E, P.d0, P.d1, y0, y1, P.a1, true, q.d - q.half, q.d + q.half, y0, y0 + dh, t);
    E.color("#8c8880");
    E.wallD(P.a1 - q.wall, P.a1, y0, y0 + dh, q.d - q.half, true);
    E.wallD(P.a1 - q.wall, P.a1, y0, y0 + dh, q.d + q.half, false);
    E.flat(P.a1 - q.wall, P.a1, q.d - q.half, q.d + q.half, y0 + dh, false);
    E.color("#3b3f45");
    E.box(P.a1, P.a1 + 0.07, y0, y0 + dh + 0.12, q.d - q.half - 0.12, q.d - q.half, "b-a");
    E.box(P.a1, P.a1 + 0.07, y0, y0 + dh + 0.12, q.d + q.half, q.d + q.half + 0.12, "b-a");
    E.box(P.a1, P.a1 + 0.07, y0 + dh, y0 + dh + 0.12, q.d - q.half, q.d + q.half, "b-a");
    E.color("#1a1a1c");
    E.box(P.a1, P.a1 + 0.05, y0 + dh + 0.24, y0 + dh + 0.56, q.d - 0.7, q.d + 0.7, "b-a");
    SG.color("#ffffff");
    signA(SG, SIGN.ROOF, q.d, y0 + dh + 0.26, y0 + dh + 0.54, P.a1 + 0.066, 1.3, 1);
    GL.color("#ffe7c0");
    GL.box(P.a1, P.a1 + 0.16, y0 + dh - 0.2, y0 + dh, q.d + q.half + 0.3, q.d + q.half + 0.55, "-a");
    PL.color("#ffcf96", 0.8);
    PL.quad([P.a1 + 0.05, y0 + 0.03, q.d - 2], [P.a1 + 0.05, y0 + 0.03, q.d + 2], [P.a1 + 3, y0 + 0.03, q.d + 2], [P.a1 + 3, y0 + 0.03, q.d - 2]);
  }
  // cornice and roof
  E.color("#8e8a82");
  E.box(P.a0 - 0.08, P.a1 + 0.08, y1, y1 + 0.16, P.d0 - 0.08, P.d1 + 0.08);
  // louvred vents on the back
  E.color("#6d6f72");
  const vw = Math.min(1.6, (P.a1 - P.a0) * 0.4);
  for (let k = 0; k < 5; k++) {
    const yy = y0 + 1.2 + k * 0.16;
    E.box(-vw / 2, vw / 2, yy, yy + 0.06, P.d1, P.d1 + 0.05, "-d");
  }
  if (b.top > 60) {
    const [bx, bz] = toWorld(b, P.a1 - 0.2, P.d1 - 0.2);
    beacons.push([bx, y1 + 0.5, bz]);
  }
  if (b.spec.spire) {
    // the landmark keeps its spire, now standing on the penthouse
    const [cx, cz] = toWorld(b, (P.a0 + P.a1) / 2, (P.d0 + P.d1) / 2);
    E.frame(IDENTITY).color("#d8dde2");
    E.box(cx - 1.4, cx + 1.4, y1 + 0.16, y1 + 2.2, cz - 1.4, cz + 1.4);
    E.cone(cx, cz, y1 + 2.2, b.spec.spire, 1.2, 6);
    GL.frame(IDENTITY).color("#9fd0ff");
    GL.cyl(cx, cz, y1 + 2.3, 0.5, 1.3, 6, false);
    beacons.push([cx, y1 + 2.2 + b.spec.spire + 0.4, cz]);
  }
}

function roofProps(E: IGeo, GL: IGeo, b: AccessBuilding, beacons: [number, number, number][]) {
  const y = b.top;
  E.frame(IDENTITY);
  GL.frame(IDENTITY);
  const rnd = (() => {
    let s = (b.spec.seed ^ 0x9e3779b9) >>> 0;
    return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  })();
  for (const p of b.props) {
    const hx = p.w / 2;
    const hz = p.d / 2;
    const x0 = p.x - hx,
      x1 = p.x + hx,
      z0 = p.z - hz,
      z1 = p.z + hz;
    switch (p.kind) {
      case "ac": {
        E.color("#c9cccf");
        E.box(x0, x1, y, y + p.h, z0, z1);
        // fan on top, grille bands on the long sides
        E.color("#2c2f33");
        const r = Math.min(hx, hz) * 0.7;
        E.cyl(p.x, p.z, y + p.h, 0.03, r, 12);
        E.color("#8f9398");
        if (p.w > p.d)
          for (let k = 0; k < 3; k++) {
            const yy = y + 0.25 + k * 0.28;
            E.box(x0 + 0.1, x1 - 0.1, yy, yy + 0.08, z0 - 0.025, z0, "b+d");
            E.box(x0 + 0.1, x1 - 0.1, yy, yy + 0.08, z1, z1 + 0.025, "b-d");
          }
        else
          for (let k = 0; k < 3; k++) {
            const yy = y + 0.25 + k * 0.28;
            E.box(x0 - 0.025, x0, yy, yy + 0.08, z0 + 0.1, z1 - 0.1, "b+a");
            E.box(x1, x1 + 0.025, yy, yy + 0.08, z0 + 0.1, z1 - 0.1, "b-a");
          }
        break;
      }
      case "tank": {
        E.color("#3a3430");
        for (const [dx, dz] of [
          [1.05, 1.05],
          [1.05, -1.05],
          [-1.05, 1.05],
          [-1.05, -1.05],
        ] as const)
          E.box(p.x + dx - 0.09, p.x + dx + 0.09, y, y + 2.6, p.z + dz - 0.09, p.z + dz + 0.09);
        E.color("#6e5238");
        E.box(p.x - 1.55, p.x + 1.55, y + 2.6, y + 2.75, p.z - 1.55, p.z + 1.55);
        E.color("#7a5a3a");
        E.cyl(p.x, p.z, y + 2.75, 2.9, 1.6, 14, false);
        E.color("#8a6a48");
        for (let k = 0; k < 3; k++) E.cyl(p.x, p.z, y + 3.1 + k * 0.9, 0.08, 1.66, 14, false);
        E.color("#5a4030");
        E.cone(p.x, p.z, y + 5.65, 0.8, 1.72, 14);
        break;
      }
      case "mast": {
        E.color("#b0b4b8");
        E.box(p.x - 0.35, p.x + 0.35, y, y + 0.3, p.z - 0.35, p.z + 0.35);
        E.cyl(p.x, p.z, y + 0.3, p.h, 0.12, 6);
        E.box(p.x - 0.9, p.x + 0.9, y + p.h * 0.7, y + p.h * 0.7 + 0.08, p.z - 0.04, p.z + 0.04);
        E.box(p.x - 0.04, p.x + 0.04, y + p.h * 0.85, y + p.h * 0.85 + 0.08, p.z - 0.7, p.z + 0.7);
        beacons.push([p.x, y + p.h + 0.55, p.z]);
        break;
      }
      case "lamp": {
        E.color("#4a4f55");
        E.box(p.x - 0.25, p.x + 0.25, y, y + 0.35, p.z - 0.25, p.z + 0.25);
        E.cyl(p.x, p.z, y + 0.35, p.h - 0.35, 0.1, 6);
        E.box(p.x - 0.5, p.x + 0.5, y + p.h - 0.12, y + p.h, p.z - 0.2, p.z + 0.2);
        GL.color("#ffd9a0");
        GL.box(p.x - 0.42, p.x + 0.42, y + p.h - 0.14, y + p.h - 0.12, p.z - 0.15, p.z + 0.15, "t");
        break;
      }
      case "vent": {
        E.color("#9a9ea3");
        E.cyl(p.x, p.z, y, 0.7, 0.22, 8);
        E.color("#7c8085");
        E.cyl(p.x, p.z, y + 0.7, 0.08, 0.38, 8);
        break;
      }
      case "skylight": {
        E.color("#8a8c90");
        E.box(x0, x1, y, y + 0.45, z0, z1);
        E.color("#27344a");
        E.box(x0 + 0.06, x1 - 0.06, y + 0.45, y + 0.5, z0 + 0.06, z1 - 0.06, "b");
        break;
      }
      case "crate": {
        E.color("#8a6a45");
        E.box(x0, x1, y, y + p.h, z0, z1);
        E.color("#6e5234");
        E.box(x0 - 0.02, x1 + 0.02, y + p.h * 0.45, y + p.h * 0.55, z0 - 0.02, z1 + 0.02, "b");
        break;
      }
      case "car": {
        const cols = ["#f2f2ee", "#18191c", "#b3202a", "#9ea3aa", "#1f3f8a", "#2f5f3a"];
        E.color(cols[Math.floor(rnd() * cols.length)]!);
        const alongX = p.w > p.d;
        const L = alongX ? p.w : p.d;
        const Wd = alongX ? p.d : p.w;
        const bx = (u: number, v: number) => (alongX ? [p.x + u, p.z + v] : [p.x + v, p.z + u]) as [number, number];
        const [ax0, az0] = bx(-L / 2, -Wd / 2);
        const [ax1, az1] = bx(L / 2, Wd / 2);
        E.box(Math.min(ax0, ax1), Math.max(ax0, ax1), y + 0.28, y + 0.85, Math.min(az0, az1), Math.max(az0, az1));
        const [cx0, cz0] = bx(-L * 0.28, -Wd / 2 + 0.12);
        const [cx1, cz1] = bx(L * 0.18, Wd / 2 - 0.12);
        E.color("#1d2530");
        E.box(Math.min(cx0, cx1), Math.max(cx0, cx1), y + 0.85, y + 1.42, Math.min(cz0, cz1), Math.max(cz0, cz1));
        E.color("#141414");
        for (const u of [-L * 0.32, L * 0.32])
          for (const v of [-Wd / 2 + 0.05, Wd / 2 - 0.05]) {
            const [wx, wz] = bx(u, v);
            E.box(wx - 0.3, wx + 0.3, y, y + 0.6, wz - 0.3, wz + 0.3);
          }
        break;
      }
    }
  }
  if (b.pad.r > 0) {
    const { x, z, r } = b.pad;
    E.color("#2a2d33");
    E.cyl(x, z, y, 0.06, r, 24);
    E.color("#f2c21a");
    E.cyl(x, z, y + 0.06, 0.015, r * 0.86, 28);
    E.color("#2a2d33");
    E.cyl(x, z, y + 0.075, 0.015, r * 0.78, 28);
    E.color("#f4f4f4");
    const hs = r * 0.42;
    E.box(x - hs * 0.55, x - hs * 0.3, y + 0.09, y + 0.105, z - hs, z + hs, "b");
    E.box(x + hs * 0.3, x + hs * 0.55, y + 0.09, y + 0.105, z - hs, z + hs, "b");
    E.box(x - hs * 0.3, x + hs * 0.3, y + 0.09, y + 0.105, z - hs * 0.13, z + hs * 0.13, "b");
    GL.color("#7dff9a");
    for (let k = 0; k < 12; k++) {
      const t = (k / 12) * Math.PI * 2;
      GL.box(x + Math.cos(t) * r - 0.1, x + Math.cos(t) * r + 0.1, y + 0.06, y + 0.16, z + Math.sin(t) * r - 0.1, z + Math.sin(t) * r + 0.1, "b");
    }
  }
}

// ------------------------------------------------------------------ elevator interiors

function landingDoorFrame(S: Set4, coreFront: number, y0: number, withCall: boolean) {
  const G = S.base;
  const o = 0.7; // half the opening
  const h = 2.3;
  // steel frame, proud of the core wall (back faces omitted)
  S.steel.color("#d6d9dd");
  S.steel.box(-o - 0.14, -o, y0, y0 + h + 0.14, coreFront - 0.05, coreFront, "b+d");
  S.steel.box(o, o + 0.14, y0, y0 + h + 0.14, coreFront - 0.05, coreFront, "b+d");
  S.steel.box(-o, o, y0 + h, y0 + h + 0.14, coreFront - 0.05, coreFront, "b+d");
  // reveal into the shaft
  G.color("#9da1a6");
  G.wallA(coreFront, coreFront + 0.045, y0, y0 + h, -o, true);
  G.wallA(coreFront, coreFront + 0.045, y0, y0 + h, o, false);
  G.flat(-o, o, coreFront, coreFront + 0.045, y0 + h, false);
  // sill
  S.steel.color("#b9bdc2");
  S.steel.box(-o, o, y0 - 0.02, y0 + 0.025, coreFront - 0.05, coreFront + 0.045, "b");
  if (withCall) {
    // call button plate
    S.steel.color("#cfd2d6");
    S.steel.box(o + 0.45, o + 0.63, y0 + 1.0, y0 + 1.36, coreFront - 0.03, coreFront, "b+d");
  }
}

function buildLobby(b: AccessBuilding, S: Set4, displays: DisplaySpot[]) {
  const E = b.elev!;
  const G = S.base;
  const y0 = b.groundY + FLOOR_Y;
  const yc = b.groundY + LOBBY_CEIL;
  const L = E.lobby;
  const cf = E.coreFront;
  const q = b.portals[0];
  const hw = q.half + 0.15;
  const hh = STREET_DOOR_H.elevator;
  const first = G.count;
  // floor: 0.6 m stone tiles with a dark border
  for (let a = L.a0; a < L.a1 - 1e-6; a += 0.6) {
    for (let d = L.d0; d < cf - 1e-6; d += 0.6) {
      const a1 = Math.min(L.a1, a + 0.6);
      const d1 = Math.min(cf, d + 0.6);
      const border = a < L.a0 + 0.3 || a1 > L.a1 - 0.3;
      const k = (Math.round((a - L.a0) / 0.6) + Math.round((d - L.d0) / 0.6)) % 2;
      G.color(border ? "#3a3532" : k ? "#dcd6cb" : "#c5bdaf");
      G.flat(a, a1, d, d1, y0, true);
    }
  }
  // side walls: walnut wainscot, warm stone above, dark stone pilasters with sconces between
  const wain = y0 + 0.95;
  const lights: BakeLight[] = [];
  const bays = Math.max(1, Math.round((cf - L.d0) / 3.2));
  const bay = (cf - L.d0) / bays;
  for (const [a, face] of [
    [L.a0, true],
    [L.a1, false],
  ] as const) {
    G.color("#5a3b26");
    G.wallA(L.d0, cf, y0, wain, a, face, 0.6);
    G.color("#d3c7b1");
    G.wallA(L.d0, cf, wain, yc, a, face, 0.6);
    G.color("#6b4a30");
    G.box(face ? a : a - 0.03, face ? a + 0.03 : a, wain - 0.04, wain + 0.03, L.d0, cf, face ? "-a" : "+a");
    const s = face ? 1 : -1;
    for (let k = 1; k < bays; k++) {
      const d = L.d0 + k * bay;
      G.color("#2f2c2b");
      G.box(Math.min(a, a + s * 0.14), Math.max(a, a + s * 0.14), y0, yc, d - 0.28, d + 0.28, face ? "-a" : "+a", 0.6);
    }
    for (let k = 0; k < bays; k++) {
      const d = L.d0 + (k + 0.5) * bay;
      S.glow.color("#ffd9a0");
      S.glow.box(Math.min(a, a + s * 0.1), Math.max(a, a + s * 0.1), y0 + 2.25, y0 + 2.55, d - 0.12, d + 0.12, face ? "-a" : "+a");
      lights.push({ a: a + s * 0.35, y: y0 + 2.4, d, r: 1.4, k: 0.35, col: "#ffd9a8" });
    }
  }
  // a runner down the middle
  G.color("#5c1f1c");
  G.box(-0.8, 0.8, y0, y0 + 0.02, L.d0 + 0.8, cf - 1.1, "b");
  G.color("#b08d57");
  G.box(-0.85, -0.8, y0, y0 + 0.022, L.d0 + 0.8, cf - 1.1, "b");
  G.box(0.8, 0.85, y0, y0 + 0.022, L.d0 + 0.8, cf - 1.1, "b");
  // front wall with the doorway
  G.color("#e6dfd2");
  wallDHole(G, L.a0, L.a1, y0, yc, L.d0, true, -hw, hw, y0 - FLOOR_Y + hh, 0.6);
  // the core wall: dark granite with the landing doors
  G.color("#2c2b2e");
  wallDHole(G, L.a0, L.a1, y0, yc, cf, false, -0.7, 0.7, y0 + 2.3, 0.6);
  landingDoorFrame(S, cf, y0, true);
  S.glow.color("#ffd27a");
  S.glow.box(0.7 + 0.5, 0.7 + 0.58, y0 + 1.22, y0 + 1.3, cf - 0.045, cf - 0.03, "b+d");
  S.glow.box(0.7 + 0.5, 0.7 + 0.58, y0 + 1.06, y0 + 1.14, cf - 0.045, cf - 0.03, "b+d");
  displays.push({ a: 0, y: y0 + 2.62, d: cf - 0.035, w: 0.62, h: 0.3, face: -1, level: 0 });
  S.steel.color("#1b1b1d");
  S.steel.box(-0.36, 0.36, y0 + 2.58, y0 + 2.96, cf - 0.03, cf, "b+d");
  // ceiling with round downlights
  G.color("#ddd5c8");
  G.flat(L.a0, L.a1, L.d0, cf, yc, false, 0.6);
  S.glow.color("#fff3de");
  for (let k = 0; k < bays; k++) {
    const d = L.d0 + (k + 0.5) * bay;
    S.glow.box(-0.26, 0.26, yc - 0.02, yc, d - 0.26, d + 0.26, "t");
    lights.push({ a: 0, y: yc - 0.4, d, r: 2.2, k: 0.55 });
  }
  lights.push({ a: 0, y: y0 + 2.8, d: cf - 0.8, r: 1.8, k: 0.5, col: "#ffe4b8" });
  // wall plaques, centred in the bay nearest the core (clear of the pilasters)
  const pd = L.d0 + (bays - 0.5) * bay;
  const pw = Math.min(2.4, bay - 0.9);
  const ph = pw * 0.146;
  S.sign.color("#ffffff");
  signA(S.sign, SIGN.UP, pd, y0 + 1.75, y0 + 1.75 + ph, L.a0 + 0.035, pw, 1);
  G.color("#23201d");
  G.box(L.a0, L.a0 + 0.015, y0 + 1.72, y0 + 1.78 + ph, pd - pw / 2 - 0.04, pd + pw / 2 + 0.04, "-a");
  signA(S.sign, SIGN.LOBBY, pd, y0 + 1.75, y0 + 1.75 + ph, L.a1 - 0.035, pw, -1);
  G.color("#2b2622");
  G.box(L.a1 - 0.015, L.a1, y0 + 1.72, y0 + 1.78 + ph, pd - pw / 2 - 0.04, pd + pw / 2 + 0.04, "+a");
  // planters in the front corners
  for (const a of [L.a0 + 0.45, L.a1 - 0.45]) {
    G.color("#3d3a37");
    G.cyl(a, L.d0 + 0.5, y0, 0.55, 0.3, 10);
    G.color("#3f6a2c");
    G.cone(a, L.d0 + 0.5, y0 + 0.5, 1.1, 0.42, 7);
  }
  G.bake(lights, 0.3, first);
  S.steel.bake(lights, 0.36);
}

function buildCar(b: AccessBuilding, S: Set4, displays: DisplaySpot[]) {
  // car-local: floor at y = 0, same a / d as the building frame
  const E = b.elev!;
  const C = E.car;
  const G = S.base;
  const ST = S.steel;
  const WD = S.wood;
  const H = CAR_H;
  const o = 0.7;
  const dh = 2.25;
  const wain = 0.95;
  // floor: dark granite with a lighter inlaid border, a steel sill at the door
  G.color("#231f1d");
  G.flat(C.a0 + 0.12, C.a1 - 0.12, C.d0 + 0.12, C.d1 - 0.12, 0.03, true, 0.35);
  G.color("#5a4e45");
  G.flat(C.a0, C.a1, C.d0, C.d0 + 0.12, 0.03, true, 0.35);
  G.flat(C.a0, C.a1, C.d1 - 0.12, C.d1, 0.03, true, 0.35);
  G.flat(C.a0, C.a0 + 0.12, C.d0 + 0.12, C.d1 - 0.12, 0.03, true, 0.35);
  G.flat(C.a1 - 0.12, C.a1, C.d0 + 0.12, C.d1 - 0.12, 0.03, true, 0.35);
  ST.color("#c9ccd0");
  ST.box(-o, o, 0, 0.05, C.d0 - 0.05, C.d0 + 0.08, "b");
  // side and back walls: walnut wainscot with a cap, brushed-steel panels above set in dark
  // reveals, a steel frieze under the ceiling; the back wall carries a bronze mirror panel
  const panels = (face: "-a" | "+a" | "-d") => {
    const n = 3;
    if (face !== "-d") {
      const a = face === "-a" ? C.a0 : C.a1;
      const s0 = face === "-a" ? 1 : -1;
      const facing = face === "-a";
      WD.color("#8a5634");
      WD.wallA(C.d0, C.d1, 0.03, wain, a, facing, 0.25);
      WD.color("#5e3a22");
      WD.box(Math.min(a, a + s0 * 0.035), Math.max(a, a + s0 * 0.035), wain, wain + 0.05, C.d0, C.d1, facing ? "-a" : "+a");
      G.color("#17181b");
      G.wallA(C.d0, C.d1, wain + 0.05, H, a, facing, 0.3);
      const L = (C.d1 - C.d0 - 0.024 * (n + 1)) / n;
      for (let k = 0; k < n; k++) {
        const d0 = C.d0 + 0.024 + k * (L + 0.024);
        ST.color("#959aa0");
        ST.box(Math.min(a, a + s0 * 0.014), Math.max(a, a + s0 * 0.014), wain + 0.08, 2.34, d0, d0 + L, facing ? "-a" : "+a", 0.3);
      }
      ST.color("#7c8086");
      ST.box(Math.min(a, a + s0 * 0.014), Math.max(a, a + s0 * 0.014), 2.37, H, C.d0, C.d1, facing ? "-a" : "+a");
    } else {
      WD.color("#8a5634");
      WD.wallD(C.a0, C.a1, 0.03, wain, C.d1, false, 0.25);
      WD.color("#5e3a22");
      WD.box(C.a0, C.a1, wain, wain + 0.05, C.d1 - 0.035, C.d1, "+d");
      G.color("#17181b");
      G.wallD(C.a0, C.a1, wain + 0.05, H, C.d1, false, 0.3);
      ST.color("#8a9096");
      ST.box(C.a0 + 0.05, C.a1 - 0.05, wain + 0.08, 2.34, C.d1 - 0.014, C.d1, "+d", 0.3);
      ST.color("#84705a");
      ST.box(C.a0 + 0.16, C.a1 - 0.16, wain + 0.18, 2.24, C.d1 - 0.036, C.d1 - 0.014, "+d", 0.3);
      ST.color("#7c8086");
      ST.box(C.a0, C.a1, 2.37, H, C.d1 - 0.014, C.d1, "+d");
    }
  };
  panels("-a");
  panels("+a");
  panels("-d");
  // front returns and transom round the door (steel), and the door reveal
  ST.color("#959aa0");
  wallDHole(ST, C.a0, C.a1, 0, H, C.d0, true, -o, o, dh, 0.3);
  ST.color("#c3c7cb");
  ST.wallA(C.d0 - 0.05, C.d0, 0, dh, -o, true);
  ST.wallA(C.d0 - 0.05, C.d0, 0, dh, o, false);
  ST.flat(-o, o, C.d0 - 0.05, C.d0, dh, false);
  // brass handrail on three walls, on stand-off brackets
  G.color("#caa45c");
  rail(G, C.a0 + 0.075, 0.92, C.d0 + 0.3, 0.92, C.d1 - 0.075, 0.022);
  rail(G, C.a1 - 0.075, 0.92, C.d0 + 0.3, 0.92, C.d1 - 0.075, 0.022);
  railA(G, C.d1 - 0.075, 0.92, C.a0 + 0.053, C.a1 - 0.053, 0.022);
  G.color("#a88444");
  for (const [a, d] of [
    [C.a0 + 0.04, C.d0 + 0.4],
    [C.a0 + 0.04, C.d1 - 0.35],
    [C.a1 - 0.04, C.d0 + 0.4],
    [C.a1 - 0.04, C.d1 - 0.35],
  ] as const)
    G.box(a - 0.03, a + 0.03, 0.9, 0.94, d - 0.012, d + 0.012);
  for (const a of [C.a0 + 0.5, C.a1 - 0.5]) G.box(a - 0.012, a + 0.012, 0.9, 0.94, C.d1 - 0.075, C.d1);
  // ceiling: a dark frame holding six lit diffuser tiles
  G.color("#2b2d31");
  G.flat(C.a0, C.a1, C.d0, C.d1, H, false, 0.4);
  S.glow.color("#fff4e2");
  const ta = (C.a1 - C.a0 - 0.5) / 3;
  const td = (C.d1 - C.d0 - 0.4) / 2;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 2; j++) {
      const a0 = C.a0 + 0.25 + i * ta + 0.025;
      const d0 = C.d0 + 0.2 + j * td + 0.025;
      S.glow.box(a0, a0 + ta - 0.05, H - 0.03, H - 0.015, d0, d0 + td - 0.05, "t");
    }
  // the indicator over the door
  ST.color("#141416");
  ST.box(-0.34, 0.34, dh + 0.06, dh + 0.3, C.d0, C.d0 + 0.02, "b-d");
  displays.push({ a: 0, y: dh + 0.18, d: C.d0 + 0.028, w: 0.56, h: 0.2, face: 1, level: 2 });
  // the button panel on the right-hand return (its face is a live texture: level 3)
  ST.color("#d9dce0");
  ST.box(o + 0.07, o + 0.35, 0.82, 1.78, C.d0, C.d0 + 0.02, "b-d");
  displays.push({ a: o + 0.21, y: 1.3, d: C.d0 + 0.026, w: 0.24, h: 0.6, face: 1, level: 3 });
  const lights: BakeLight[] = [
    { a: 0, y: H - 0.05, d: (C.d0 + C.d1) / 2, r: 1.05, k: 1.25, col: "#fff0dc" },
    { a: C.a0 + 0.5, y: H - 0.1, d: C.d1 - 0.4, r: 0.6, k: 0.35, col: "#ffe2bc" },
    { a: C.a1 - 0.5, y: H - 0.1, d: C.d1 - 0.4, r: 0.6, k: 0.35, col: "#ffe2bc" },
  ];
  G.bake(lights, 0.16);
  ST.bake(lights, 0.2);
  WD.bake(lights, 0.2);
}

function buildVestibule(b: AccessBuilding, S: Set4, displays: DisplaySpot[]) {
  const E = b.elev!;
  const V = E.vest;
  const G = S.base;
  const y0 = b.top + 0.03;
  const yc = b.top + VEST_CEIL;
  const cf = E.coreFront;
  const q = b.portals[1];
  const dh = 2.25;
  // concrete floor, painted walls
  G.color("#6f6c68");
  G.flat(V.a0, V.a1, V.d0, V.d1, y0, true, 0.6);
  G.color("#b3aca0");
  G.wallA(V.d0, V.d1, y0, yc, V.a0, true, 0.6);
  G.wallA(V.d0, V.d1, y0, yc, V.a1, false, 0.6);
  wallDHole(G, V.a0, V.a1, y0, yc, V.d0, true, q.a - q.half, q.a + q.half, b.top + dh, 0.6);
  G.color("#8f8a82");
  wallDHole(G, V.a0, V.a1, y0, yc, cf, false, -0.7, 0.7, y0 + 2.3, 0.6);
  // door reveal (inner side of the penthouse door)
  G.color("#8c8880");
  G.flat(q.a - q.half, q.a + q.half, V.d0 - q.wall, V.d0, y0, true);
  landingDoorFrame(S, cf, y0, true);
  S.glow.color("#ffd27a");
  S.glow.box(0.7 + 0.5, 0.7 + 0.58, y0 + 1.06, y0 + 1.14, cf - 0.045, cf - 0.03, "b+d");
  displays.push({ a: 0, y: y0 + 2.6, d: cf - 0.035, w: 0.62, h: 0.3, face: -1, level: 1 });
  S.steel.color("#1b1b1d");
  S.steel.box(-0.36, 0.36, y0 + 2.56, y0 + 2.9, cf - 0.03, cf, "b+d");
  // ceiling, caged light, EXIT sign over the roof door
  G.color("#a9a39a");
  G.flat(V.a0, V.a1, V.d0, V.d1, yc, false, 0.6);
  S.glow.color("#fff0d8");
  S.glow.box(-0.25, 0.25, yc - 0.12, yc - 0.02, (V.d0 + V.d1) / 2 - 0.12, (V.d0 + V.d1) / 2 + 0.12, "t");
  S.sign.color("#ffffff");
  G.color("#0a6b35");
  G.box(q.a - 0.34, q.a + 0.34, b.top + dh + 0.16, b.top + dh + 0.44, V.d0, V.d0 + 0.04, "b-d");
  signD(S.sign, SIGN.EXIT, q.a, b.top + dh + 0.18, b.top + dh + 0.42, V.d0 + 0.06, 0.62, 1);
  const lights: BakeLight[] = [
    { a: 0, y: yc - 0.2, d: (V.d0 + V.d1) / 2, r: 2.2, k: 1.0 },
    { a: 0, y: y0 + 2.7, d: cf - 0.5, r: 1.6, k: 0.5, col: "#ffe0b0" },
  ];
  G.bake(lights, 0.32);
  S.steel.bake(lights, 0.4);
}

// ------------------------------------------------------------------ stairwell

function buildStairs(b: AccessBuilding, S: Set4) {
  const s = b.stair!;
  const G = S.conc; // concrete: walls, slabs, steps
  const P = S.base; // paint and metal: stripes, doors, rails, sign plates, the extinguisher
  const W2 = s.W / 2;
  const g = 0.1; // half the spine wall
  const gy = b.groundY;
  const y0 = gy + FLOOR_Y;
  const topY = b.top;
  const ceil = topY + BULKHEAD_H;
  const dS1 = s.v0 + s.Ls; // end of the storey landing / start of the flights
  const dN0 = dS1 + s.Lr; // start of the half landing
  const dEnd = dN0 + s.Ln;
  const rise = s.h / 2 / s.steps;
  const hallH = gy + Math.min(3.0, s.h - 0.25);
  const q0 = b.portals[0];
  const q1 = b.portals[1];
  const hw = q0.half + 0.15;
  const hh = STREET_DOOR_H.stairs;
  const lights: BakeLight[] = [];
  const wallC = "#bdb9b1";
  const bandC = "#3f7f5a";
  // uneven light: every lamp its own strength and tint (tired fluorescents among the warm
  // bulkheads), and now and then a dead one
  const rng = (() => {
    let x = (b.spec.seed ^ 0x51a1) >>> 0;
    return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296);
  })();
  const lamp = (box: [number, number, number, number, number, number], face: string, at: BakeLight) => {
    const r = rng();
    if (r < 0.12) {
      P.color("#4a4843");
      P.box(...box, face);
      return;
    }
    const cool = r > 0.66;
    const col = cool ? "#e4edff" : "#ffdcb4";
    S.glow.color(cool ? "#eef4ff" : "#ffe2b4", 0.8 + rng() * 0.25);
    S.glow.box(...box, face);
    lights.push({ ...at, k: at.k * (0.6 + rng() * 0.6), col });
  };
  // ---- outer walls, full height, with a green band per storey ----
  const sideWall = (a: number, face: boolean) => {
    G.color(wallC);
    // +a wall has the roof door at the top
    if (a > 0) wallAHole(G, 0.25, dEnd, y0, ceil, a, face, q1.d - q1.half, q1.d + q1.half, topY, topY + 2.25, 0.8);
    else G.wallA(0.25, dEnd, y0, ceil, a, face, 0.8);
  };
  sideWall(-W2, true);
  sideWall(W2, false);
  G.color(wallC);
  G.wallD(-W2, W2, y0, ceil, dEnd, false, 0.8);
  // hall: front wall with the street door, low ceiling; above it the stair's own front wall
  wallDHole(G, -W2, W2, y0, hallH, 0.25, true, -hw, hw, gy + hh, 0.7);
  G.flat(-W2, W2, 0.25, s.v0, hallH, false, 0.7);
  G.wallD(-W2, W2, hallH, ceil, s.v0, true, 0.8);
  G.color("#4a4f55");
  G.wallA(q0.wall, 0.25, y0, gy + hh, -hw, true);
  G.wallA(q0.wall, 0.25, y0, gy + hh, hw, false);
  G.flat(-hw, hw, q0.wall, 0.25, gy + hh, false);
  G.color("#7c776e");
  G.flat(-hw, hw, q0.wall, 0.25, y0, true);
  // bands (proud of the walls by 1.5 cm)
  for (let n = 0; n <= s.laps; n++) {
    const yb = gy + n * s.h + 1.0;
    if (yb + 0.2 > ceil) break;
    const cutA = n === s.laps;
    for (const [c, ya, yz] of [
      [bandC, yb, yb + 0.16],
      ["#d8b02a", yb - 0.09, yb - 0.05],
    ] as const) {
      P.color(c);
      P.box(-W2, -W2 + 0.015, ya, yz, n === 0 ? 0.25 : s.v0, dEnd, "-a+d-d");
      if (cutA) {
        P.box(W2 - 0.015, W2, ya, yz, n === 0 ? 0.25 : s.v0, q1.d - q1.half, "+a+d-d");
        P.box(W2 - 0.015, W2, ya, yz, q1.d + q1.half, dEnd, "+a+d-d");
      } else P.box(W2 - 0.015, W2, ya, yz, n === 0 ? 0.25 : s.v0, dEnd, "+a+d-d");
    }
  }
  // ---- spine wall between the flights ----
  G.color("#b5b1a9");
  G.box(-g, g, y0, topY + 1.05, dS1, dN0, "b", 0.8);
  // ---- landings ----
  const slab = 0.2;
  for (let n = 0; n <= s.laps; n++) {
    const yl = gy + n * s.h;
    const d0 = n === 0 ? 0.25 : s.v0;
    G.color("#a3a09a");
    G.flat(-W2, W2, d0, dS1 - (n > 0 ? 0.06 : 0), n === 0 ? y0 : yl + 0.03, true, 0.7);
    if (n > 0) {
      G.color("#9a968f");
      G.flat(-W2, W2, s.v0, dS1, yl - slab, false, 0.7);
      G.wallD(-W2, W2, yl - slab, yl + 0.03, dS1, true);
      // yellow nosing strip on the landing edge
      G.color("#d8b02a");
      G.flat(-W2, W2, dS1 - 0.06, dS1, yl + 0.03, true);
    }
    // the half landing
    if (n < s.laps) {
      const yh = yl + s.h / 2;
      G.color("#a3a09a");
      G.flat(-W2, W2, dN0, dEnd, yh + 0.03, true, 0.7);
      G.color("#9a968f");
      G.flat(-W2, W2, dN0, dEnd, yh - slab, false, 0.7);
      G.wallD(-W2, W2, yh - slab, yh + 0.03, dN0, false);
      // lamps
      lamp([-0.3, 0.3, yh + 2.2, yh + 2.32, dEnd - 0.06, dEnd], "+d", { a: 0, y: yh + 2.1, d: dEnd - 0.4, r: 1.8, k: 1.0 });
    }
    // storey landing lamp, floor number, a door onto the floor
    const ly = (n === 0 ? gy : yl) + 2.35;
    if (ly < ceil - 0.15)
      lamp([-W2, -W2 + 0.07, ly, ly + 0.14, s.v0 + 0.5, s.v0 + 1.1], "-a", { a: -W2 + 0.5, y: ly, d: s.v0 + 0.8, r: 1.8, k: 1.05 });
    // a fire extinguisher on its bracket, and its sign, on the landing's +a wall
    if (n < s.laps) {
      const ex = (n === 0 ? gy : yl) + 0.03;
      const ed = s.v0 + 0.5;
      P.color("#3a3a3c");
      P.box(W2 - 0.05, W2, ex + 0.62, ex + 0.66, ed - 0.06, ed + 0.06, "+a");
      P.color("#c4161c");
      P.cyl(W2 - 0.14, ed, ex + 0.1, 0.52, 0.085, 10);
      P.color("#1d1d1f");
      P.cyl(W2 - 0.14, ed, ex + 0.62, 0.07, 0.035, 8);
      P.box(W2 - 0.2, W2 - 0.12, ex + 0.66, ex + 0.69, ed - 0.015, ed + 0.015);
      P.color("#b3161b");
      P.box(W2 - 0.03, W2, ex + 1.42, ex + 1.62, ed - 0.37, ed + 0.37, "+a");
      signA(S.sign, SIGN.FIRE, ed, ex + 1.44, ex + 1.6, W2 - 0.05, 0.7, -1);
    }
    const fy = (n === 0 ? gy : yl) + 1.45;
    S.sign.color("#ffffff");
    if (n < s.laps) {
      P.color("#f2c230");
      P.box(-W2, -W2 + 0.035, fy, fy + 0.46, s.v0 + 1.25, s.v0 + 1.63, "-a");
      signA(S.sign, SIGN.FLOOR, s.v0 + 1.44, fy + 0.02, fy + 0.44, -W2 + 0.055, 0.36, 1, Math.min(8, n), 10);
    } else {
      P.color("#f2c230");
      P.box(-W2, -W2 + 0.035, fy, fy + 0.4, s.v0 + 0.15, s.v0 + 1.65, "-a");
      signA(S.sign, SIGN.STAIRUP, s.v0 + 0.9, fy + 0.02, fy + 0.38, -W2 + 0.055, 1.46, 1);
    }
    if (n > 0 && n < s.laps) {
      // a (locked) steel door onto the floor, in the landing's front wall
      P.color("#7a2e28");
      P.box(-0.5, 0.5, yl + 0.03, yl + 2.13, s.v0, s.v0 + 0.035, "b-d");
      P.color("#1c242c");
      P.box(-0.14, 0.14, yl + 1.35, yl + 1.75, s.v0 + 0.035, s.v0 + 0.055, "b-d");
      P.color("#c8ccd0");
      P.box(0.32, 0.42, yl + 1.02, yl + 1.06, s.v0 + 0.035, s.v0 + 0.09, "b-d");
      // EXIT (down the stairs) over the floor door
      P.color("#0a6b35");
      P.box(-0.34, 0.34, yl + 2.25, yl + 2.5, s.v0, s.v0 + 0.035, "b-d");
      signD(S.sign, SIGN.EXITARROW, 0, yl + 2.27, yl + 2.48, s.v0 + 0.05, 0.64, 1);
    }
  }
  // ---- flights ----
  for (let n = 0; n < s.laps; n++) {
    const base = gy + n * s.h;
    for (let k = 0; k < s.steps; k++) {
      // flight up (lane A): d grows
      const ya = base + (k + 1) * rise;
      const a0 = -W2,
        a1 = -g;
      const dA0 = dS1 + k * (s.Lr / s.steps);
      const dA1 = dS1 + (k + 1) * (s.Lr / s.steps);
      G.color("#aaa69e");
      G.flat(a0, a1, dA0 + 0.05, dA1, ya, true);
      G.color("#d8b02a");
      G.flat(a0, a1, dA0, dA0 + 0.05, ya, true);
      G.color("#9d9991");
      G.wallD(a0, a1, ya - rise - 0.14, ya, dA0, false);
      G.color("#9a968f");
      G.flat(a0, a1, dA0, dA1, ya - rise - 0.14, false);
      G.wallD(a0, a1, ya - rise - 0.14, ya - rise, dA1, true);
      // flight down side (lane B): d shrinks as it climbs
      const yb = base + s.h / 2 + (k + 1) * rise;
      const b0 = g,
        b1 = W2;
      const dB1 = dN0 - k * (s.Lr / s.steps);
      const dB0 = dN0 - (k + 1) * (s.Lr / s.steps);
      G.color("#aaa69e");
      G.flat(b0, b1, dB0, dB1 - 0.05, yb, true);
      G.color("#d8b02a");
      G.flat(b0, b1, dB1 - 0.05, dB1, yb, true);
      G.color("#9d9991");
      G.wallD(b0, b1, yb - rise - 0.14, yb, dB1, true);
      G.color("#9a968f");
      G.flat(b0, b1, dB0, dB1, yb - rise - 0.14, false);
      G.wallD(b0, b1, yb - rise - 0.14, yb - rise, dB0, false);
    }
    // handrails on the outer walls and both faces of the spine
    P.color("#c23a2a");
    rail(P, -W2 + 0.06, base + 0.9, dS1, base + s.h / 2 + 0.9, dN0);
    rail(P, -g - 0.05, base + 0.9, dS1, base + s.h / 2 + 0.9, dN0);
    rail(P, W2 - 0.06, base + s.h / 2 + 0.9, dN0, base + s.h + 0.9, dS1);
    rail(P, g + 0.05, base + s.h / 2 + 0.9, dN0, base + s.h + 0.9, dS1);
  }
  // under the first flight down: closed off (no basement)
  G.color(wallC);
  G.wallD(g, W2, y0, gy + s.h - rise - 0.14, dS1, false);
  // top: guard rail across the pit of the last flight up, bulkhead ceiling and lamp
  P.color("#c23a2a");
  P.quad([-W2, topY + 1.02, dS1 + 0.03], [-g, topY + 1.02, dS1 + 0.03], [-g, topY + 1.08, dS1 + 0.03], [-W2, topY + 1.08, dS1 + 0.03]);
  for (const a of [-W2 + 0.1, (-W2 - g) / 2, -g - 0.05]) P.box(a - 0.02, a + 0.02, topY + 0.03, topY + 1.05, dS1, dS1 + 0.06);
  G.color("#c2bdb3");
  G.flat(-W2, W2, s.v0, dEnd, ceil, false, 0.8);
  S.glow.color("#ffe6c0");
  S.glow.box(-0.3, 0.3, ceil - 0.1, ceil - 0.02, (s.v0 + dEnd) / 2 - 0.3, (s.v0 + dEnd) / 2 + 0.3, "t");
  lights.push({ a: 0, y: ceil - 0.3, d: (s.v0 + dEnd) / 2, r: 2.2, k: 1.0, col: "#ffd9a8" });
  // EXIT over the roof door (inside)
  P.color("#0a6b35");
  P.box(W2 - 0.04, W2, topY + 2.4, topY + 2.68, q1.d - 0.34, q1.d + 0.34, "b+a");
  signA(S.sign, SIGN.EXIT, q1.d, topY + 2.42, topY + 2.66, W2 - 0.06, 0.62, -1);
  // roof door reveal floor
  G.color("#7c776e");
  G.flat(W2, W2 + q1.wall, q1.d - q1.half, q1.d + q1.half, topY + 0.03, true);
  // hall lamp
  S.glow.color("#ffe2b4");
  S.glow.box(-0.3, 0.3, hallH - 0.06, hallH, (0.25 + s.v0) / 2 - 0.2, (0.25 + s.v0) / 2 + 0.2, "t");
  lights.push({ a: 0, y: hallH - 0.3, d: (0.25 + s.v0) / 2 + 0.3, r: 1.8, k: 0.9, col: "#ffd29a" });
  // EXIT over the street door, inside
  if (hallH - (gy + hh) > 0.34) {
    P.color("#0a6b35");
    P.box(-0.34, 0.34, gy + hh + 0.05, gy + hh + 0.29, 0.25, 0.285, "b-d");
    signD(S.sign, SIGN.EXIT, 0, gy + hh + 0.07, gy + hh + 0.27, 0.3, 0.64, 1);
  }
  G.bake(lights, 0.13);
  P.bake(lights, 0.16);
}

// ------------------------------------------------------------------ everything

export function buildAccess(list: AccessBuilding[]): BuiltAccess {
  const E = new IGeo();
  const GL = new IGeo();
  const SG = new IGeo();
  const PL = new IGeo();
  const beacons: [number, number, number][] = [];
  const per: BuiltBuilding[] = [];
  for (const b of list) {
    entrance(E, GL, SG, PL, b);
    penthouse(E, GL, SG, PL, b, beacons);
    roofProps(E, GL, b, beacons);
    const displays: DisplaySpot[] = [];
    const low = set4();
    let high: Interior | null = null;
    let car: CarGeo | null = null;
    if (b.elev) {
      buildLobby(b, low, displays);
      const hs = set4();
      buildVestibule(b, hs, displays);
      high = built(hs);
      const cs = set4();
      buildCar(b, cs, displays);
      car = built(cs);
    } else buildStairs(b, low);
    per.push({ low: built(low), high, car, displays, theta: Math.atan2(b.ix, b.tx) });
  }
  return { ext: E.build(), glow: GL.build(), sign: SG.build(), pools: PL.build(), beacons, per };
}

export { CAR_W, CAR_D };
