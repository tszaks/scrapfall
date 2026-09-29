import { wheelRails, wheelGround } from "./wheelRide";
// Turns the Pacific Pier layout into merged geometry, one set of meshes per 200 m chunk:
//   ground - the terrain: beach, bowls, bluff, streets (its own material: wet sand shines)
//   main   - buildings, the pier structure, railings, palms (always drawn; casts shadows)
//   detail - beach clutter, street furniture, parked cars, blockades (drawn near the player)
//   glow   - unlit bulbs and neon            signs - sign atlas quads
//   pools  - fake light pools on the ground at night
// Moving set pieces (Ferris wheel, coaster train, carousel, drop tower) live in Beach.tsx.
import * as THREE from "three";

import { Geo, L, STRIDE, facadeUV, rectPoly, type P2, type Tmpl } from "../cityGeo";
import { bakeCar } from "../art/cars";
import type { Vehicle } from "../vehicles";
import {
  BLUFF_H,
  DECK,
  K_BIKE,
  K_BLUFF,
  K_COURT,
  K_PROM,
  K_SKATE,
  ROAD_C,
  SEA,
  TUNNEL_Z,
  X,
  applyPads,
  baseProfile,
  modHeight,
  qpHeight,
  type BBld,
  type BeachLayout,
  type Blockade,
  type BProp,
  type Rect,
} from "./beachLayout";
import { CLOSED_WORD, W, beachWordUV } from "./beachTextures";
import { K_OPEN, K_PARK, K_PARKLANE, K_PATH, K_ROAD, K_WALK, K_LOT } from "../cityLayout";

export const CHUNK = 200;
export const FAR_CHUNK = 800;
export const DETAIL_RANGE = 360;

type ChunkGeo = {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  ground: Geo;
  main: Geo;
  detail: Geo;
  glow: Geo;
  signs: Geo;
  pools: Geo;
};
export type BeachChunk = {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  ground: THREE.BufferGeometry | null;
  main: THREE.BufferGeometry | null;
  detail: THREE.BufferGeometry | null;
  glow: THREE.BufferGeometry | null;
  signs: THREE.BufferGeometry | null;
  pools: THREE.BufferGeometry | null;
  far: boolean;
};
export type BeachMeshes = {
  chunks: BeachChunk[];
  /** static parts of the moving set pieces (wheel frame etc.) are in the chunks */
  fires: { x: number; y: number; z: number }[];
  /** night-only scatter of hillside lights (positions) */
  hillLights: [number, number, number][];
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
const _c = new THREE.Color();
const PASTEL = [
  "#f6d8c0",
  "#f2c4c8",
  "#bfe4dc",
  "#f8e8b0",
  "#cfe0f4",
  "#f4f0e6",
  "#e8d0f0",
  "#fbd6a8",
  "#c8ecd0",
];
const AWN: [string, string][] = [
  ["#e8433a", "#f4f0e6"],
  ["#1f8a9a", "#f4f0e6"],
  ["#f2a61f", "#f4f0e6"],
  ["#2f5fb8", "#f4f0e6"],
  ["#e85a9a", "#fff6e0"],
  ["#3aa860", "#f4f0e6"],
];
const NEON = ["#ff4fa0", "#3affd8", "#ffe14a", "#9a6aff", "#ff7a3a", "#4fd0ff"];
const UMB = [
  "#e8433a",
  "#f2c21f",
  "#1f8ad8",
  "#f4f0e6",
  "#e85a9a",
  "#3ab88a",
  "#ff8a2a",
  "#6a4ad8",
];
const pick = <T>(a: readonly T[], r: () => number) => a[Math.floor(r() * a.length) % a.length]!;

/** ground height used for drawing (natural ground, bowls included; the pier deck is separate) */
function groundVis(city: BeachLayout, x: number, z: number) {
  let h = applyPads(city.beach.pads, x, z, baseProfile(x, z));
  for (const m of city.beach.mods) h += modHeight(m, x, z);
  return h;
}

// ---------------------------------------------------------------------------------------
// templates (local space, built once)

type TKey =
  | "trunk0"
  | "trunk1"
  | "trunk2"
  | "crown"
  | "skirt"
  | "bench"
  | "trash"
  | "umbrella"
  | "towel"
  | "board"
  | "firering"
  | "net"
  | "cart"
  | "table"
  | "rack"
  | "bars"
  | "rings"
  | "hoop"
  | "swing"
  | "streetlight"
  | "lamp"
  | "globe"
  | "busstop"
  | "flag"
  | "rod"
  | "scope"
  | "buoy"
  | "shower"
  | "mat"
  | "bike"
  | "cooler"
  | "tree"
  | "shrub"
  | "rock"
  | "aframe"
  | "jersey"
  | "cone"
  | "fence"
  | "sandbag"
  | "float"
  | "boat"
  | "arrowboard"
  | "signpost";
type Tmpls = Record<TKey, Tmpl>;
let TM: Tmpls | null = null;

function fan(
  g: Geo,
  cx: number,
  cy: number,
  cz: number,
  yaw: number,
  pitch: number,
  r: number,
  seg: number,
  spread: number,
) {
  // a pleated fan leaf: centre (cx, cy, cz), pointing along yaw, tilted by pitch, drawn both sides
  const dir = (a: number, rad: number, lift: number): [number, number, number] => {
    const ca = yaw + a;
    const hx = Math.sin(ca) * Math.cos(pitch) * rad;
    const hz = Math.cos(ca) * Math.cos(pitch) * rad;
    const hy = Math.sin(pitch) * rad + lift;
    return [cx + hx, cy + hy, cz + hz];
  };
  for (let k = 0; k < seg; k++) {
    const a0 = -spread / 2 + (k / seg) * spread;
    const a1 = -spread / 2 + ((k + 1) / seg) * spread;
    const p = dir(a0, r, k % 2 ? 0.12 : -0.08);
    const q = dir(a1, r, (k + 1) % 2 ? 0.12 : -0.08);
    g.tri(cx, cy, cz, p[0], p[1], p[2], q[0], q[1], q[2]);
    g.tri(cx, cy, cz, q[0], q[1], q[2], p[0], p[1], p[2]);
  }
}

function templates(): Tmpls {
  if (TM) return TM;
  const t = (f: (g: Geo) => void) => {
    const g = new Geo();
    g.mat(L.plain, 0.5, 0);
    f(g);
    return g.freeze();
  };
  // Washingtonia trunk: unit height (scaled in y per palm), gently curving by `lean` metres
  const trunk = (lean: number) =>
    t((g) => {
      const SEG = 9;
      for (let k = 0; k < SEG; k++) {
        const a = k / SEG;
        const b = (k + 1) / SEG;
        const off = (u: number) => lean * u * u;
        const r0 = 0.34 - a * 0.13 + (k === 0 ? 0.1 : 0);
        const r1 = 0.34 - b * 0.13;
        g.col(k % 2 ? "#8e8272" : "#83786a");
        // a tapered prism between two offset rings
        const n = 6;
        for (let i = 0; i < n; i++) {
          const t0 = (i / n) * Math.PI * 2;
          const t1 = ((i + 1) / n) * Math.PI * 2;
          const P = (tt: number, r: number, y: number, o: number): [number, number, number] => [
            Math.cos(tt) * r,
            y,
            Math.sin(tt) * r + o,
          ];
          const A = P(t0, r0, a, off(a));
          const B = P(t1, r0, a, off(a));
          const C = P(t1, r1, b, off(b));
          const D = P(t0, r1, b, off(b));
          g.quad(B[0], B[1], B[2], A[0], A[1], A[2], D[0], D[1], D[2], C[0], C[1], C[2]);
        }
      }
    });
  TM = {
    trunk0: trunk(0.4),
    trunk1: trunk(1.2),
    trunk2: trunk(2.2),
    skirt: t((g) => {
      // the shaggy skirt of dead fronds under the crown
      g.col("#7a5e3e");
      g.cyl(0, -2.6, 0, 0.42, 2.7, 7, false, 0.95);
      g.col("#8a6a44");
      g.cyl(0, -3.1, 0, 0.36, 0.6, 7, false, 0.44);
    }),
    crown: t((g) => {
      const R = mulberry(9);
      for (let k = 0; k < 17; k++) {
        const yaw = (k / 17) * Math.PI * 2 + R() * 0.3;
        const tier = k % 3;
        const pitch = tier === 0 ? 0.75 : tier === 1 ? 0.2 : -0.35;
        g.col(tier === 2 ? "#6a8a3a" : k % 2 ? "#3f7434" : "#4c843c");
        const px = Math.sin(yaw) * Math.cos(pitch) * 0.9;
        const pz = Math.cos(yaw) * Math.cos(pitch) * 0.9;
        const py = Math.sin(pitch) * 0.9;
        // petiole
        g.tri(0, 0.05, 0, px, py, pz, px * 0.95, py + 0.07, pz * 0.95);
        fan(g, px, py, pz, yaw, pitch - 0.25, 1.35, 6, 2.6);
      }
      g.col("#5a4a30");
      g.cyl(0, -0.25, 0, 0.36, 0.45, 6);
    }),
    bench: t((g) => {
      g.col("#6a4a30");
      g.box(0, 0.42, 0, 1.8, 0.06, 0.45);
      g.obox(0, 0.47, -0.22, 1.8, 0.4, 0.05, 0);
      g.col("#2e3034");
      g.box(-0.75, 0, 0, 0.08, 0.42, 0.42);
      g.box(0.75, 0, 0, 0.08, 0.42, 0.42);
    }),
    trash: t((g) => {
      g.col("#4a6a8a");
      g.cyl(0, 0, 0, 0.32, 0.95, 8);
      g.col("#2a3a4a");
      g.cyl(0, 0.95, 0, 0.34, 0.06, 8);
    }),
    umbrella: t((g) => {
      g.col("#e8e4dc");
      g.cyl(0, 0, 0, 0.03, 2.3, 4);
      g.col("#ffffff");
      g.cone(0, 1.95, 0, 1.3, 0.5, 8, 0);
      g.col("#f0f0f0");
      // underside
      for (let i = 0; i < 8; i++) {
        const a0 = (i / 8) * Math.PI * 2;
        const a1 = ((i + 1) / 8) * Math.PI * 2;
        g.tri(
          0,
          2.45,
          0,
          Math.cos(a0) * 1.3,
          1.95,
          Math.sin(a0) * 1.3,
          Math.cos(a1) * 1.3,
          1.95,
          Math.sin(a1) * 1.3,
        );
      }
    }),
    towel: t((g) => {
      g.col("#ffffff");
      g.box(0, 0.01, 0, 0.9, 0.02, 1.8);
    }),
    board: t((g) => {
      // surfboard standing in the sand
      g.col("#ffffff");
      g.obox(0, -0.3, 0, 0.55, 2.3, 0.07, 0.2);
      g.col("#3a3a3a");
      g.obox(0, 1.3, 0, 0.1, 0.7, 0.08, 0.2);
    }),
    firering: t((g) => {
      g.col("#9a948a");
      g.cyl(0, -0.1, 0, 0.9, 0.55, 12, false);
      g.col("#6a645a");
      g.cyl(0, -0.1, 0, 0.78, 0.5, 12, false);
      g.col("#2a2420");
      g.cyl(0, 0.2, 0, 0.75, 0.02, 10);
      g.col("#4a3424");
      g.obox(0, 0.22, 0, 0.18, 0.16, 1.2, 0.5);
      g.obox(0, 0.3, 0, 0.18, 0.16, 1.2, -0.6);
    }),
    net: t((g) => {
      g.col("#e8e4dc");
      g.box(-4.6, 0, 0, 0.08, 2.5, 0.08);
      g.box(4.6, 0, 0, 0.08, 2.5, 0.08);
      // the net: a grid of cords under a white top band
      g.col("#2a2a2c");
      for (let k = 0; k < 4; k++) g.box(0, 1.55 + k * 0.28, 0, 9.2, 0.02, 0.02);
      for (let x = -4.5; x <= 4.5; x += 0.3) g.box(x, 1.55, 0, 0.015, 0.87, 0.015);
      g.col("#f4f2ea");
      g.box(0, 2.42, 0, 9.2, 0.07, 0.03);
    }),
    cart: t((g) => {
      g.col("#d8d4cc");
      g.box(0, 0.35, 0, 1.8, 0.75, 0.9);
      // Upright wheels share an axle under the body; the tire bottoms sit on the ground.
      const tire = new THREE.CylinderGeometry(0.25, 0.25, 0.1, 10);
      const hub = new THREE.CylinderGeometry(0.09, 0.09, 0.112, 10);
      const wheel = new THREE.Matrix4().makeRotationX(Math.PI / 2);
      for (const x of [-0.7, 0.7]) {
        g.col("#727570");
        g.box(x, 0.21, 0, 0.08, 0.08, 1.02);
        for (const z of [-0.49, 0.49]) {
          wheel.setPosition(x, 0.25, z);
          g.col("#2a2a2a");
          g.add(tire, wheel);
          g.col("#b8b4ac");
          g.add(hub, wheel);
          g.box(x, 0.25, z * 0.75, 0.08, 0.16, 0.08);
        }
      }
      tire.dispose();
      hub.dispose();
      g.col("#b8b4ac");
      g.box(-0.85, 1.1, 0, 0.05, 1.3, 0.05);
      g.box(0.85, 1.1, 0, 0.05, 1.3, 0.05);
      g.col("#ffffff");
      g.box(0, 2.35, 0, 2.2, 0.08, 1.4);
    }),
    table: t((g) => {
      g.col("#e8e4dc");
      g.cyl(0, 0, 0, 0.5, 0.74, 8);
      g.cyl(0, 0, 0, 0.03, 2.4, 4);
      g.col("#1f8a9a");
      g.cone(0, 2.0, 0, 1.4, 0.45, 8, 0);
      g.col("#d8d4cc");
      for (const [x, z] of [
        [0.8, 0],
        [-0.8, 0],
        [0, 0.8],
        [0, -0.8],
      ] as const)
        g.box(x, 0, z, 0.35, 0.45, 0.35);
    }),
    rack: t((g) => {
      g.col("#2a2c30");
      g.box(-0.9, 0, 0, 0.08, 1.8, 0.08);
      g.box(0.9, 0, 0, 0.08, 1.8, 0.08);
      g.col("#9aa0a6");
      g.box(0, 1.4, 0, 2.2, 0.05, 0.05);
      g.col("#1a1a1a");
      g.cyl(-1.05, 1.2, 0, 0.25, 0.1, 10);
      g.cyl(1.0, 1.2, 0, 0.25, 0.1, 10);
      g.col("#6a4a30");
      g.box(0, 0.4, 0.9, 0.35, 0.06, 1.3);
    }),
    bars: t((g) => {
      g.col("#3a3e44");
      for (const x of [-1.5, 0, 1.5]) g.box(x, 0, 0, 0.1, 2.4, 0.1);
      g.col("#9aa0a6");
      g.box(0, 2.3, 0, 3.1, 0.05, 0.05);
      g.box(0, 1.5, 0.6, 1.8, 0.05, 0.05);
    }),
    rings: t((g) => {
      g.col("#3a3e44");
      g.box(-1.2, 0, 0, 0.12, 3.2, 0.12);
      g.box(1.2, 0, 0, 0.12, 3.2, 0.12);
      g.box(0, 3.15, 0, 2.5, 0.1, 0.1);
      g.col("#c8c4bc");
      g.box(-0.3, 2.0, 0, 0.02, 1.15, 0.02);
      g.box(0.3, 2.0, 0, 0.02, 1.15, 0.02);
      g.cyl(-0.3, 1.85, 0, 0.1, 0.03, 8);
      g.cyl(0.3, 1.85, 0, 0.1, 0.03, 8);
    }),
    hoop: t((g) => {
      g.col("#3a3e44");
      g.cyl(0, 0, -1.2, 0.08, 3.4, 6);
      g.obox(0, 3.1, -0.6, 0.08, 0.08, 1.3, 0);
      g.col("#f4f2ea");
      g.box(0, 2.9, 0, 1.8, 1.05, 0.05);
      g.col("#e8602a");
      g.cyl(0, 3.05, 0.3, 0.23, 0.03, 10, false);
    }),
    swing: t((g) => {
      g.col("#e8a02a");
      g.obox(-1.8, 0, 0, 0.1, 2.8, 0.1, 0);
      g.obox(1.8, 0, 0, 0.1, 2.8, 0.1, 0);
      g.box(0, 2.7, 0, 3.8, 0.12, 0.12);
      g.col("#2a2a2a");
      for (const x of [-0.8, 0.8]) {
        g.box(x - 0.2, 1.0, 0, 0.02, 1.7, 0.02);
        g.box(x + 0.2, 1.0, 0, 0.02, 1.7, 0.02);
        g.box(x, 0.95, 0, 0.5, 0.05, 0.2);
      }
    }),
    streetlight: t((g) => {
      g.col("#6a6e72");
      g.cyl(0, 0, 0, 0.14, 9.5, 6, true, 0.08);
      g.obox(0, 9.3, 1.4, 0.1, 0.1, 2.8, 0);
      g.col("#4a4e52");
      g.obox(0, 9.15, 2.8, 0.4, 0.2, 0.8, 0);
    }),
    lamp: t((g) => {
      // promenade lamp: dark green post with a lantern
      g.col("#2e4a3e");
      g.cyl(0, 0, 0, 0.12, 0.6, 8);
      g.cyl(0, 0.6, 0, 0.07, 3.6, 6, true, 0.05);
      g.box(0, 4.15, 0, 0.36, 0.08, 0.36);
      g.box(0, 4.75, 0, 0.3, 0.08, 0.3);
    }),
    globe: t((g) => {
      // pier lamp post (the globe itself glows, in the glow layer)
      g.col("#f2f0ea");
      g.cyl(0, 0, 0, 0.09, 3.4, 6, true, 0.06);
      g.box(0, 3.3, 0, 0.9, 0.06, 0.06);
    }),
    busstop: t((g) => {
      g.col("#3a3e44");
      for (const [x, z] of [
        [-1.8, -0.6],
        [1.8, -0.6],
      ] as const)
        g.box(x, 0, z, 0.08, 2.5, 0.08);
      g.col("#c9d4da");
      g.box(0, 2.5, 0, 3.9, 0.1, 1.6);
      g.col("#9fb4c0");
      g.box(0, 0.3, -0.62, 3.6, 2.0, 0.04);
      g.col("#7a5234");
      g.box(0, 0.45, -0.35, 2.6, 0.06, 0.4);
    }),
    flag: t((g) => {
      g.col("#e8e4dc");
      g.cyl(0, 0, 0, 0.05, 7, 5, true, 0.03);
    }),
    rod: t((g) => {
      g.col("#2a2a2a");
      g.obox(0, 0.4, 0.1, 0.03, 0.03, 2.8, 0);
      g.col("#6a6a6a");
      g.box(0, 0, 0, 0.35, 0.3, 0.25);
    }),
    scope: t((g) => {
      g.col("#3a5a7a");
      g.cyl(0, 0, 0, 0.08, 1.1, 6);
      g.box(0, 1.1, 0, 0.3, 0.25, 0.5);
      g.cyl(0, 1.05, 0, 0.12, 0.08, 8);
    }),
    buoy: t((g) => {
      g.col("#f2702a");
      g.cyl(0, -0.2, 0, 0.35, 0.55, 8);
      g.col("#f4f2ea");
      g.cyl(0, 0.35, 0, 0.06, 0.6, 4);
    }),
    shower: t((g) => {
      g.col("#9aa0a6");
      g.cyl(0, 0, 0, 0.08, 2.6, 6);
      g.obox(0, 2.5, 0.3, 0.06, 0.06, 0.6, 0);
      g.col("#c8c4bc");
      g.box(0, 0, 0, 1.4, 0.08, 1.4);
    }),
    mat: t((g) => {
      g.col("#8a6a48");
      g.box(0, 0, 0, 2.3, 0.05, 2.2);
    }),
    bike: t((g) => {
      g.col("#2a2a2a");
      g.cyl(-0.55, 0.0, 0, 0.34, 0.04, 10);
      g.cyl(0.55, 0.0, 0, 0.34, 0.04, 10);
      g.col("#e8433a");
      g.box(0, 0.4, 0, 1.1, 0.05, 0.05);
      g.box(-0.2, 0.4, 0, 0.05, 0.5, 0.05);
      g.box(0.45, 0.4, 0, 0.05, 0.6, 0.05);
    }),
    cooler: t((g) => {
      g.col("#ffffff");
      g.box(0, 0, 0, 0.6, 0.4, 0.4);
      g.col("#f4f2ea");
      g.box(0, 0.4, 0, 0.62, 0.05, 0.42);
    }),
    tree: t((g) => {
      g.col("#5a4632");
      g.cyl(0, 0, 0, 0.2, 3.2, 6, false, 0.14);
      const softStart = g.n;
      const ico = new THREE.IcosahedronGeometry(1, 0);
      g.col("#4f7a34");
      g.add(
        ico,
        new THREE.Matrix4().compose(
          new THREE.Vector3(0, 4.6, 0),
          new THREE.Quaternion(),
          new THREE.Vector3(2.6, 2, 2.6),
        ),
      );
      g.col("#5a8a3a");
      g.add(
        ico,
        new THREE.Matrix4().compose(
          new THREE.Vector3(1, 4, 0.6),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 0.7, 0)),
          new THREE.Vector3(1.7, 1.5, 1.7),
        ),
      );
      ico.dispose();
      g.excludeSince(softStart);
    }),
    shrub: t((g) => {
      const ico = new THREE.IcosahedronGeometry(1, 0);
      g.col("#3f5a2c");
      g.add(
        ico,
        new THREE.Matrix4().compose(
          new THREE.Vector3(0, 0.5, 0),
          new THREE.Quaternion(),
          new THREE.Vector3(1.3, 0.8, 1.2),
        ),
      );
      g.col("#4c6a34");
      g.add(
        ico,
        new THREE.Matrix4().compose(
          new THREE.Vector3(0.8, 0.35, 0.4),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 0.9, 0)),
          new THREE.Vector3(0.9, 0.6, 0.9),
        ),
      );
      ico.dispose();
      g.excludeSince(0);
    }),
    rock: t((g) => {
      const ico = new THREE.IcosahedronGeometry(1, 0);
      g.col("#9a8a70");
      g.add(
        ico,
        new THREE.Matrix4().compose(
          new THREE.Vector3(0, 0.2, 0),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 0.2, 0.7)),
          new THREE.Vector3(1.2, 0.7, 0.9),
        ),
      );
      ico.dispose();
    }),
    aframe: t((g) => {
      // lifeguard / police A-frame barricade, striped board on top
      g.col("#f4f2ea");
      g.obox(-0.9, 0, 0.3, 0.08, 1.25, 0.08, 0);
      g.obox(0.9, 0, 0.3, 0.08, 1.25, 0.08, 0);
      g.obox(-0.9, 0, -0.3, 0.08, 1.25, 0.08, 0);
      g.obox(0.9, 0, -0.3, 0.08, 1.25, 0.08, 0);
      g.col("#e8602a");
      g.box(0, 0.95, 0.3, 2.0, 0.3, 0.05);
      g.col("#f4f2ea");
      g.box(0, 0.55, 0.3, 2.0, 0.22, 0.05);
      g.col("#e8602a");
      g.box(0, 0.95, -0.3, 2.0, 0.3, 0.05);
    }),
    jersey: t((g) => {
      g.col("#d0ccc4");
      g.box(0, 0, 0, 2.0, 0.3, 0.62);
      g.box(0, 0.3, 0, 2.0, 0.55, 0.3);
      g.col("#e8602a");
      g.box(0, 0.62, 0, 2.02, 0.12, 0.32);
    }),
    cone: t((g) => {
      g.col("#f25a1a");
      g.cyl(0, 0, 0, 0.2, 0.75, 8, true, 0.03);
      g.col("#f4f2ea");
      g.cyl(0, 0.35, 0, 0.13, 0.12, 8, false, 0.11);
      g.col("#1a1a1a");
      g.box(0, 0, 0, 0.5, 0.04, 0.5);
    }),
    fence: t((g) => {
      // construction fence panel: two posts on feet and a green windscreen, 2.2 m tall
      // one post and foot per panel (the next panel's post closes the run: nothing doubles up)
      g.col("#8a9096");
      g.box(-1.17, 0, 0, 0.06, 2.3, 0.06);
      g.col("#3a3e44");
      g.box(-1.17, 0, 0, 0.25, 0.12, 0.6);
      g.col("#1e4a34");
      g.box(0.015, 0.25, 0, 2.33, 1.95, 0.03);
      g.col("#8a9096");
      g.box(0.015, 2.22, 0, 2.33, 0.05, 0.05);
    }),
    sandbag: t((g) => {
      for (let row = 0; row < 3; row++)
        for (let k = 0; k < 4 - row; k++) {
          g.col(row % 2 ? "#b8a67a" : "#a8966a");
          g.box(-1.1 + k * 0.72 + row * 0.36, row * 0.26, 0, 0.7, 0.28, 0.45);
        }
    }),
    float: t((g) => {
      g.col("#f2c21f");
      g.cyl(0, -0.15, 0, 0.22, 0.3, 8);
      g.col("#e8e4dc");
      g.box(0.9, 0.05, 0, 1.8, 0.03, 0.03);
    }),
    boat: t((g) => {
      // inflatable rescue boat
      g.col("#f2702a");
      g.obox(0, 0, 1.1, 0.5, 0.5, 2.4, 0);
      g.obox(1.3, 0, 1.1, 0.5, 0.5, 2.4, 0);
      g.box(0.65, 0, -0.3, 1.8, 0.5, 0.5);
      g.col("#2a2a2a");
      g.box(0.65, 0.05, 1.1, 0.9, 0.2, 2.2);
      g.box(0.65, 0.3, 2.4, 0.4, 0.8, 0.35);
    }),
    arrowboard: t((g) => {
      g.col("#f2c21f");
      g.box(0, 0, 0, 1.6, 0.8, 2.2);
      g.col("#2a2a2a");
      g.cyl(-0.8, 0, 0, 0.3, 0.2, 8);
      g.cyl(0.8, 0, 0, 0.3, 0.2, 8);
      g.col("#3a3e44");
      g.box(0, 0.8, 0, 0.12, 1.8, 0.12);
      g.col("#1a1a1a");
      g.box(0, 2.3, 0, 2.4, 1.2, 0.1);
    }),
    signpost: t((g) => {
      g.col("#8a9096");
      g.box(-0.9, 0, 0, 0.08, 2.2, 0.08);
      g.box(0.9, 0, 0, 0.08, 2.2, 0.08);
      g.col("#f4f2ea");
      g.box(0, 1.3, 0, 2.0, 1.0, 0.05);
    }),
  };
  return TM;
}

// ---------------------------------------------------------------------------------------

type Ctx = {
  main: Geo;
  detail: Geo;
  glow: Geo;
  signs: Geo;
  pools: Geo;
};

/** a sign quad facing `front` on a wall line, centre (x, y, z), w x h */
function signQuad(
  G: Geo,
  word: number,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  front: number,
  col = "#ffffff",
) {
  const uv = beachWordUV(word);
  G.col(col).mat(0);
  const hw = w / 2;
  const hh = h / 2;
  // outward normal per front: 0 -z, 1 +x, 2 +z, 3 -x
  if (front === 0)
    G.quad(x + hw, y - hh, z, x - hw, y - hh, z, x - hw, y + hh, z, x + hw, y + hh, z, uv);
  else if (front === 2)
    G.quad(x - hw, y - hh, z, x + hw, y - hh, z, x + hw, y + hh, z, x - hw, y + hh, z, uv);
  else if (front === 1)
    G.quad(x, y - hh, z + hw, x, y - hh, z - hw, x, y + hh, z - hw, x, y + hh, z + hw, uv);
  else G.quad(x, y - hh, z - hw, x, y - hh, z + hw, x, y + hh, z + hw, x, y + hh, z - hw, uv);
}

/** point just outside the middle of a rect's `front` side, plus the along-axis half length */
function frontLine(b: Rect, front: number, out: number) {
  const cx = (b.x0 + b.x1) / 2;
  const cz = (b.z0 + b.z1) / 2;
  if (front === 0) return { x: cx, z: b.z0 - out, half: (b.x1 - b.x0) / 2 };
  if (front === 2) return { x: cx, z: b.z1 + out, half: (b.x1 - b.x0) / 2 };
  if (front === 1) return { x: b.x1 + out, z: cz, half: (b.z1 - b.z0) / 2 };
  return { x: b.x0 - out, z: cz, half: (b.z1 - b.z0) / 2 };
}

/** striped awning along the front of a rect: slopes down and out from `y` */
function awning(G: Geo, b: Rect, front: number, y: number, depth: number, cols: [string, string]) {
  const f = frontLine(b, front, 0);
  const n = Math.max(2, Math.round((f.half * 2) / 0.9));
  const along = front === 0 || front === 2;
  const sgn = front === 0 || front === 3 ? -1 : 1;
  for (let k = 0; k < n; k++) {
    const a = -f.half + (k / n) * f.half * 2;
    const c = a + (f.half * 2) / n;
    G.col(cols[k % 2]!);
    if (along) {
      const zi = f.z;
      const zo = f.z + sgn * depth;
      const x0 = f.x + a;
      const x1 = f.x + c;
      if (sgn < 0) G.quad(x1, y, zi, x0, y, zi, x0, y - 0.7, zo, x1, y - 0.7, zo);
      else G.quad(x0, y, zi, x1, y, zi, x1, y - 0.7, zo, x0, y - 0.7, zo);
      if (sgn < 0) G.quad(x0, y, zi, x1, y, zi, x1, y - 0.7, zo, x0, y - 0.7, zo);
      else G.quad(x1, y, zi, x0, y, zi, x0, y - 0.7, zo, x1, y - 0.7, zo);
      // valance
      if (sgn < 0) G.quad(x1, y - 0.7, zo, x0, y - 0.7, zo, x0, y - 1.0, zo, x1, y - 1.0, zo);
      else G.quad(x0, y - 0.7, zo, x1, y - 0.7, zo, x1, y - 1.0, zo, x0, y - 1.0, zo);
    } else {
      const xi = f.x;
      const xo = f.x + sgn * depth;
      const z0 = f.z + a;
      const z1 = f.z + c;
      if (sgn > 0) G.quad(xi, y, z1, xi, y, z0, xo, y - 0.7, z0, xo, y - 0.7, z1);
      else G.quad(xi, y, z0, xi, y, z1, xo, y - 0.7, z1, xo, y - 0.7, z0);
      if (sgn > 0) G.quad(xi, y, z0, xi, y, z1, xo, y - 0.7, z1, xo, y - 0.7, z0);
      else G.quad(xi, y, z1, xi, y, z0, xo, y - 0.7, z0, xo, y - 0.7, z1);
      if (sgn > 0) G.quad(xo, y - 0.7, z1, xo, y - 0.7, z0, xo, y - 1.0, z0, xo, y - 1.0, z1);
      else G.quad(xo, y - 0.7, z0, xo, y - 0.7, z1, xo, y - 1.0, z1, xo, y - 1.0, z0);
    }
  }
}

function building(b: BBld, C: Ctx) {
  const r = mulberry(Math.floor(b.seed * 1e9));
  const G = C.main;
  const poly = rectPoly(b.x0, b.z0, b.x1, b.z1);
  const y0 = b.y0;
  const tone = pick(PASTEL, r);
  const wallCol =
    b.t === "restroom"
      ? "#cfc8bc"
      : b.t === "hq"
        ? "#e8ecee"
        : b.t === "house"
          ? pick(["#f4ead8", "#efe2cc", "#f6f0e4", "#e8d8c0"], r)
          : tone;
  const groundH = Math.min(b.h, b.t === "house" ? 3.2 : 4.2);
  const fh = 3.3;
  const storeFront =
    b.t !== "house" &&
    b.t !== "restroom" &&
    b.t !== "harbor" &&
    b.t !== "camera" &&
    b.t !== "stall";
  const top = y0 + b.h;

  if (b.t === "stall") {
    // carnival booth: counter, striped pyramid canopy, sign over the front
    G.mat(L.plain, b.seed, 0).col("#f4f0e6");
    G.box((b.x0 + b.x1) / 2, y0, (b.z0 + b.z1) / 2, b.x1 - b.x0 - 0.4, 1.1, b.z1 - b.z0 - 0.4);
    const cx = (b.x0 + b.x1) / 2;
    const cz = (b.z0 + b.z1) / 2;
    G.col("#8a6a4a");
    for (const [dx, dz] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const)
      G.box(
        cx + dx * ((b.x1 - b.x0) / 2 - 0.3),
        y0 + 1.1,
        cz + dz * ((b.z1 - b.z0) / 2 - 0.3),
        0.12,
        1.8,
        0.12,
      );
    const cols = pick(AWN, r);
    const hw = (b.x1 - b.x0) / 2;
    const hd = (b.z1 - b.z0) / 2;
    for (let k = 0; k < 8; k++) {
      const a0 = (k / 8) * Math.PI * 2 + Math.PI / 8;
      const a1 = ((k + 1) / 8) * Math.PI * 2 + Math.PI / 8;
      G.col(cols[k % 2]!);
      G.tri(
        cx + Math.cos(a1) * hw * 1.2,
        y0 + 2.9,
        cz + Math.sin(a1) * hd * 1.3,
        cx + Math.cos(a0) * hw * 1.2,
        y0 + 2.9,
        cz + Math.sin(a0) * hd * 1.3,
        cx,
        y0 + 4.1,
        cz,
      );
    }
    // prizes on the counter
    for (let k = 0; k < 5; k++) {
      G.col(pick(UMB, r));
      G.box(b.x0 + 0.8 + k * ((b.x1 - b.x0 - 1.6) / 4), y0 + 1.1, cz, 0.35, 0.4 + r() * 0.3, 0.35);
    }
    const f = frontLine(b, b.front, 0.05);
    if (b.sign >= 0)
      signQuad(C.signs, b.sign, f.x, y0 + 2.5, f.z, Math.min(3.6, f.half * 1.6), 1.0, b.front);
    C.glow.col(pick(NEON, r)).mat(0);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      C.glow.box(
        cx + Math.cos(a) * hw * 1.15,
        y0 + 2.8,
        cz + Math.sin(a) * hd * 1.2,
        0.14,
        0.14,
        0.14,
      );
    }
    return;
  }

  // a plinth down into the ground, so a building never floats over sand or a slope
  if (y0 < 3) {
    G.mat(L.plain, b.seed, 0).col(wallCol, 0.8);
    for (let i = 0; i < 4; i++) G.wall(poly[i]!, poly[(i + 1) % 4]!, y0 - 1.5, y0 + 0.01);
  }
  // ---- walls ----
  for (let i = 0; i < 4; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % 4]!;
    const faceW = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const isFront = i === b.front;
    if (b.interior) continue; // shared plan draws the real room walls and openings
    if (storeFront && (isFront || b.t === "restaurant" || b.t === "hotel")) {
      G.mat(L.store, b.seed, 1).col(wallCol);
      G.wall(p, q, y0, y0 + groundH, facadeUV(L.store, faceW, 0, 1, 1, Math.floor(r() * 8), 0));
    } else {
      if (b.t === "restroom") {
        // painted cinder block (a slab texture at block scale), not a flat grey box
        G.mat(L.paving, b.seed, 1).col(wallCol);
        G.wall(p, q, y0, y0 + groundH, [0, 0, faceW / 0.8, groundH / 0.4]);
      } else {
        G.mat(L.resid, b.seed, 1).col(wallCol);
        G.wall(p, q, y0, y0 + groundH, facadeUV(L.resid, faceW, 0, groundH, fh, 0, 0));
      }
    }
    if (b.h > groundH + 0.5) {
      const layer =
        b.t === "restaurant"
          ? L.glass
          : b.t === "hotel"
            ? b.seed < 0.5
              ? L.resid
              : L.office
            : L.resid;
      G.mat(layer, b.seed, 1).col(wallCol);
      G.wall(
        p,
        q,
        y0 + groundH,
        top,
        facadeUV(layer, faceW, groundH, b.h, fh, Math.floor(r() * 8), 2),
      );
    }
  }
  // ---- roof ----
  if (b.t === "house") {
    // red tile hip roof
    G.mat(L.plain, b.seed, 0).col("#b8583a");
    const cx = (b.x0 + b.x1) / 2;
    const cz = (b.z0 + b.z1) / 2;
    const o = 0.5;
    const rp: P2[] = [
      [b.x0 - o, b.z0 - o],
      [b.x1 + o, b.z0 - o],
      [b.x1 + o, b.z1 + o],
      [b.x0 - o, b.z1 + o],
    ];
    const rh = 2.6;
    const rx = Math.max(0, (b.x1 - b.x0) / 2 - (b.z1 - b.z0) / 2);
    const ridge: [number, number][] = [
      [cx - rx, cz],
      [cx + rx, cz],
    ];
    G.quad(
      rp[1]![0],
      top,
      rp[1]![1],
      rp[0]![0],
      top,
      rp[0]![1],
      ridge[0]![0],
      top + rh,
      ridge[0]![1],
      ridge[1]![0],
      top + rh,
      ridge[1]![1],
    );
    G.quad(
      rp[3]![0],
      top,
      rp[3]![1],
      rp[2]![0],
      top,
      rp[2]![1],
      ridge[1]![0],
      top + rh,
      ridge[1]![1],
      ridge[0]![0],
      top + rh,
      ridge[0]![1],
    );
    G.col("#a84c32");
    G.tri(
      rp[0]![0],
      top,
      rp[0]![1],
      rp[3]![0],
      top,
      rp[3]![1],
      ridge[0]![0],
      top + rh,
      ridge[0]![1],
    );
    G.tri(
      rp[2]![0],
      top,
      rp[2]![1],
      rp[1]![0],
      top,
      rp[1]![1],
      ridge[1]![0],
      top + rh,
      ridge[1]![1],
    );
    return;
  }
  G.mat(L.plain, b.seed, 0).col(b.t === "restaurant" ? "#2f5f8a" : "#d8d2c6");
  G.flat(b.x0, b.z0, b.x1, b.z1, top);
  // parapet
  G.col(wallCol);
  for (let i = 0; i < 4; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % 4]!;
    G.wall(p, q, top, top + 0.6);
    G.wall(q, p, top, top + 0.6);
  }
  G.col(b.t === "restaurant" ? "#f4f0e6" : "#f4f0e6", 0.95);
  for (let i = 0; i < 4; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % 4]!;
    const dx = q[0] - p[0];
    const dz = q[1] - p[1];
    // caps along x run past the corners, caps along z stop short: no overlapping lids
    G.obox(
      (p[0] + q[0]) / 2,
      top + 0.6,
      (p[1] + q[1]) / 2,
      Math.hypot(dx, dz) + (Math.abs(dx) > Math.abs(dz) ? 0.3 : -0.3),
      0.12,
      0.3,
      Math.atan2(dx, dz) + Math.PI / 2,
    );
  }
  // rooftop clutter: AC units (an access roof gets its own, with collision)
  if (b.t !== "restroom" && b.t !== "harbor" && b.t !== "camera" && !b.access) {
    G.col("#b8b4ac");
    const n = 1 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++)
      G.box(
        b.x0 + 2 + r() * Math.max(0.1, b.x1 - b.x0 - 4),
        top,
        b.z0 + 2 + r() * Math.max(0.1, b.z1 - b.z0 - 4),
        1.4,
        1.0,
        1.1,
      );
  }

  const f = frontLine(b, b.front, 0.06);
  // ---- storefront dressing: awning, sign board, neon trim ----
  if (storeFront && b.t !== "hotel" && b.t !== "restaurant" && b.t !== "motel") {
    awning(C.detail, b, b.front, y0 + 3.3, 1.8, pick(AWN, r));
    if (b.sign >= 0) {
      const w = Math.min(f.half * 1.5, 9);
      signQuad(C.signs, b.sign, f.x, y0 + 3.85, f.z, w, w / 2.2 > 1.4 ? 1.4 : w / 2.2, b.front);
      // neon underline
      C.glow.col(pick(NEON, r)).mat(0);
      if (b.front === 0 || b.front === 2) C.glow.box(f.x, y0 + 3.1, f.z, w, 0.07, 0.07);
      else C.glow.box(f.x, y0 + 3.1, f.z, 0.07, 0.07, w);
    }
    // a big rooftop sign on some two-storey shops and the arcades
    if ((b.floors >= 2 || b.t === "arcade") && b.sign >= 0) {
      const w = Math.min(f.half * 1.8, 12);
      G.col("#3a3a3c");
      signQuad(
        C.signs,
        b.sign,
        f.x,
        top + 2.2,
        f.z - (b.front === 0 ? -0.6 : b.front === 2 ? 0.6 : 0),
        w,
        w / 2,
        b.front,
      );
      if (b.front === 0 || b.front === 2) {
        G.box(f.x - w / 3, top, f.z + (b.front === 0 ? 0.8 : -0.8), 0.12, 2.2, 0.12);
        G.box(f.x + w / 3, top, f.z + (b.front === 0 ? 0.8 : -0.8), 0.12, 2.2, 0.12);
      } else {
        G.box(f.x + (b.front === 3 ? 0.8 : -0.8), top, f.z - w / 3, 0.12, 2.2, 0.12);
        G.box(f.x + (b.front === 3 ? 0.8 : -0.8), top, f.z + w / 3, 0.12, 2.2, 0.12);
      }
    }
  }
  if (b.t === "motel") {
    // second-floor walkway, railing and posts along the front, a tall pole sign
    const D = C.detail;
    D.mat(L.plain, b.seed, 0).col("#e8e4dc");
    const out = 1.8;
    const fr = frontLine(b, b.front, out / 2);
    const along = b.front === 0 || b.front === 2;
    const len = fr.half * 2;
    // the second wing's walkway sits a hair higher, so the two never share a lid at the corner
    const wy = y0 + 3.3 + (along ? 0.03 : 0);
    if (along) D.box(fr.x, wy, fr.z, len, 0.18, out);
    else D.box(fr.x, wy, fr.z, out, 0.18, len);
    D.col("#2a6a8a");
    const rl = frontLine(b, b.front, out - 0.05);
    if (along) D.box(rl.x, y0 + 3.5, rl.z, len, 0.9, 0.05);
    else D.box(rl.x, y0 + 3.5, rl.z, 0.05, 0.9, len);
    D.col("#e8e4dc");
    for (let k = 0; k <= Math.floor(len / 4); k++) {
      const a = -fr.half + k * 4;
      if (along) D.box(rl.x + a, y0, rl.z, 0.18, 3.3, 0.18);
      else D.box(rl.x, y0, rl.z + a, 0.18, 3.3, 0.18);
    }
    if (b.sign >= 0) {
      // the pole sign by the road with VACANCY neon underneath
      const px = b.x1 + 6;
      const pz = b.z0 + 4;
      G.col("#e8e4dc");
      G.cyl(px, 0, pz, 0.25, 9, 8);
      G.col("#1f5f8a");
      G.box(px, 9, pz, 1.0, 3.6, 5.2);
      signQuad(C.signs, W.MOTEL, px - 0.52, 10.8, pz, 4.6, 2.2, 3);
      signQuad(C.signs, W.MOTEL, px + 0.52, 10.8, pz, 4.6, 2.2, 1);
      signQuad(C.signs, W.VACANCY, px - 0.52, 9.4, pz, 3.8, 0.9, 3);
      signQuad(C.signs, W.VACANCY, px + 0.52, 9.4, pz, 3.8, 0.9, 1);
      C.glow.col("#ff4fa0").mat(0);
      C.glow.box(px, 12.7, pz, 1.1, 0.12, 5.4);
      C.glow.box(px, 8.95, pz, 1.1, 0.12, 5.4);
    }
  }
  if (b.t === "hotel") {
    // balconies on every floor above the lobby, and a rooftop name
    const D = C.detail;
    D.mat(L.plain, b.seed, 0).col("#f4f0e6");
    for (let y = y0 + groundH + fh - 0.2; y < top - 1; y += fh) {
      const fr = frontLine(b, b.front, 0.7);
      if (b.front === 1 || b.front === 3) D.box(fr.x, y, fr.z, 1.4, 0.15, fr.half * 2 - 1);
      D.col("#9ac8d8");
      if (b.front === 1 || b.front === 3)
        D.box(fr.x + (b.front === 3 ? -0.65 : 0.65), y + 0.15, fr.z, 0.05, 1.0, fr.half * 2 - 1);
      D.col("#f4f0e6");
    }
    if (b.sign >= 0) {
      signQuad(C.signs, b.sign, f.x, top + 2.6, f.z, 12, 5, b.front);
      C.glow.col("#3affd8").mat(0);
      C.glow.box(
        f.x,
        top + 0.1,
        f.z,
        b.front === 1 || b.front === 3 ? 0.1 : 12,
        0.1,
        b.front === 1 || b.front === 3 ? 12 : 0.1,
      );
    }
  }
  if (b.t === "restroom") {
    // two doors on the beach side, a painted band and a little roof overhang
    const D = C.detail;
    const fr = frontLine(b, b.front, 0.04);
    D.mat(L.plain, b.seed, 0).col("#2a6a7a");
    for (const off of [-fr.half * 0.45, fr.half * 0.45]) {
      if (b.front === 1 || b.front === 3) D.box(fr.x, y0, fr.z + off, 0.08, 2.1, 1.0);
      else D.box(fr.x + off, y0, fr.z, 1.0, 2.1, 0.08);
    }
    D.col("#2a6a7a");
    const band = frontLine(b, b.front, 0.02);
    if (b.front === 1 || b.front === 3) D.box(band.x, y0 + 2.6, band.z, 0.05, 0.25, band.half * 2);
    else D.box(band.x, y0 + 2.6, band.z, band.half * 2, 0.25, 0.05);
    G.mat(L.plain, b.seed, 0).col("#b8583a");
    G.box((b.x0 + b.x1) / 2, top, (b.z0 + b.z1) / 2, b.x1 - b.x0 + 1.2, 0.25, b.z1 - b.z0 + 1.2);
  }
  if (b.t === "hq") {
    // glass lookout on the roof
    G.mat(L.glass, b.seed, 1).col("#cfe4ee");
    const cx = (b.x0 + b.x1) / 2;
    const cz = (b.z0 + b.z1) / 2;
    G.box(cx - 4, top, cz, 6, 3, 6);
    G.mat(L.plain, b.seed, 0).col("#2f5f8a");
    G.box(cx - 4, top + 3, cz, 7, 0.3, 7);
    signQuad(C.signs, W.LIFEGUARD, f.x, y0 + 5.5, f.z, 8, 2, b.front);
    G.col("#e8e4dc");
    G.cyl(cx + 4, top, cz, 0.08, 6, 5);
  }
  if (b.t === "restaurant") {
    signQuad(C.signs, W.SEAFOOD, f.x, top + 1.6, f.z, 10, 3.2, b.front);
    C.glow.col("#ffe14a").mat(0);
    for (let k = 0; k < 10; k++) {
      const z = b.z0 + 1 + k * ((b.z1 - b.z0 - 2) / 9);
      C.glow.box(b.x1 + 0.3, y0 + 4.2, z, 0.12, 0.12, 0.12);
    }
    awning(C.detail, b, b.front, y0 + 3.6, 2.4, ["#2f5f8a", "#f4f0e6"]);
  }
  if (b.t === "taco") {
    // a giant taco on the roof
    G.mat(L.plain, b.seed, 0).col("#f2c24a");
    const cx = (b.x0 + b.x1) / 2;
    const cz = (b.z0 + b.z1) / 2;
    G.cyl(cx, top + 0.6, cz, 1.6, 0.6, 12, true, 1.8);
    G.col("#5aa840");
    G.cyl(cx, top + 1.2, cz, 1.4, 0.25, 12);
  }
  if (b.t === "surf") {
    // surfboards racked along the front wall
    const D = C.detail;
    const fr = frontLine(b, b.front, 0.3);
    for (let k = 0; k < 7; k++) {
      D.mat(L.plain, b.seed, 0).col(pick(UMB, r));
      const a = -fr.half + 1.5 + k * ((fr.half * 2 - 3) / 6);
      if (b.front === 3 || b.front === 1) D.obox(fr.x, y0, fr.z + a, 0.08, 2.4, 0.55, 0);
      else D.obox(fr.x + a, y0, fr.z, 0.55, 2.4, 0.08, 0);
    }
  }
}

// ---------------------------------------------------------------------------------------

export function buildBeachMeshes(city: BeachLayout): BeachMeshes {
  const { half, cells: n, kind, beach } = city;
  const T = templates();
  const makeGrid = (reach: number, size: number) => {
    const E = Math.ceil(reach / size) * size;
    const m = (E * 2) / size;
    const list: ChunkGeo[] = [];
    for (let a = 0; a < m; a++)
      for (let b = 0; b < m; b++)
        list.push({
          x0: -E + a * size,
          z0: -E + b * size,
          x1: -E + (a + 1) * size,
          z1: -E + (b + 1) * size,
          ground: new Geo(),
          main: new Geo(),
          detail: new Geo(),
          glow: new Geo(),
          signs: new Geo(),
          pools: new Geo(),
        });
    const at = (x: number, z: number) => {
      const a = Math.max(0, Math.min(m - 1, Math.floor((x + E) / size)));
      const b = Math.max(0, Math.min(m - 1, Math.floor((z + E) / size)));
      return list[a * m + b]!;
    };
    return { list, at };
  };
  const near = makeGrid(half, CHUNK);
  const far = makeGrid(3200, FAR_CHUNK);
  const chunkAt = near.at;
  const ctx = (x: number, z: number): Ctx => {
    const ch = Math.abs(x) <= half && Math.abs(z) <= half ? chunkAt(x, z) : far.at(x, z);
    return ch;
  };
  const cx = (i: number) => -half + 1 + i * 2;
  const gv = (x: number, z: number) => groundVis(city, x, z);
  const fires: BeachMeshes["fires"] = [];
  const hillLights: [number, number, number][] = [];

  // ---- ground: the beach and the bluff as height grids, the town as flat runs ----
  const sandCol = new THREE.Color();
  const tmpA = new THREE.Color();
  const beachColor = (x: number, z: number, h: number) => {
    // dry sand -> damp -> wet (shiny) -> sea floor; a little noise so it never looks flat
    const nse = Math.sin(x * 0.37 + z * 0.11) * 0.5 + Math.sin(x * 0.05 - z * 0.23) * 0.5;
    const dry = new THREE.Color("#f4d690").offsetHSL(0, 0, nse * 0.025);
    const damp = tmpA.set("#d2b284");
    const wet = new THREE.Color("#9e8462");
    const floor = new THREE.Color("#7a6a52");
    let rough = 1;
    if (x > X.dry + 8) sandCol.copy(dry);
    else if (x > X.dry - 4) {
      const t = (x - (X.dry - 4)) / 12;
      sandCol.copy(damp).lerp(dry, t);
      rough = 0.9;
    } else if (x > X.wet) {
      const t = (x - X.wet) / (X.dry - 4 - X.wet);
      sandCol.copy(wet).lerp(damp, t * t);
      rough = 0.18 + t * 0.6;
    } else {
      sandCol.copy(floor);
      rough = 0.3;
    }
    void h;
    return rough;
  };
  const gridCell = (
    G: Geo,
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    colorAt: (x: number, z: number, h: number) => [THREE.Color, number],
  ) => {
    const pts: [number, number][] = [
      [x0, z1],
      [x1, z1],
      [x1, z0],
      [x0, z0],
    ];
    const hs = pts.map(([x, z]) => gv(x, z));
    const cs = pts.map(([x, z], k) => colorAt(x, z, hs[k]!));
    // two triangles, per-vertex colour and roughness (in aFac.y)
    const put = (k: number) => {
      const [x, z] = pts[k]!;
      const [c, rough] = cs[k]!;
      G.colLinear(c.r, c.g, c.b);
      G.mat(L.ground, rough, 0);
      // normal from the neighbouring heights
      const e = 1;
      const nx = gv(x - e, z) - gv(x + e, z);
      const nz = gv(x, z - e) - gv(x, z + e);
      const l = Math.hypot(nx, 2 * e, nz);
      G.v(x, hs[k]!, z, nx / l, (2 * e) / l, nz / l, x / 3, -z / 3);
    };
    put(0);
    put(1);
    put(2);
    put(0);
    put(2);
    put(3);
  };
  const beachAt = (x: number, z: number, h: number): [THREE.Color, number] => {
    const rough = beachColor(x, z, h);
    return [sandCol.clone(), rough];
  };
  const bluffAt = (x: number, z: number, h: number): [THREE.Color, number] => {
    const nse = Math.sin(x * 0.7 + z * 0.13) * Math.sin(z * 0.31 + x * 0.05);
    const t = (h / BLUFF_H) * 0.6 + nse * 0.3;
    const c = new THREE.Color("#6f7a3e").lerp(
      new THREE.Color("#a08a62"),
      Math.max(0, Math.min(1, 0.4 + t * 0.6)),
    );
    if (nse > 0.55) c.lerp(new THREE.Color("#c8506a"), 0.35); // ice plant in flower
    return [c, 1];
  };
  const skate = beach.skate;
  const lot = beach.lot;
  const lotAt = (x: number, z: number): [THREE.Color, number] => {
    void x;
    void z;
    return [new THREE.Color("#4a4c50"), 0.9];
  };
  const skateAt = (x: number, z: number, h: number): [THREE.Color, number] => {
    // poured concrete: slab-to-slab tone, darker and smoother down in the bowls
    const slab = ((Math.floor(x / 4) * 7 + Math.floor(z / 4) * 13) % 5) * 0.012;
    const c = new THREE.Color(h < -0.05 ? "#a9a7a2" : "#c7c5be").offsetHSL(
      0,
      0,
      slab - 0.02 + Math.max(-0.08, h * 0.02),
    );
    return [c, h < -0.05 ? 0.45 : 0.75];
  };
  for (let i = 0; i < n; i++) {
    const x = cx(i) - 1;
    for (let j = 0; j < n; j++) {
      const z = cx(j) - 1;
      const G = chunkAt(x + 1, z + 1).ground;
      if (x >= skate.x0 && x < skate.x1 && z >= skate.z0 && z < skate.z1)
        gridCell(G, x, z, x + 2, z + 2, skateAt);
      else if (x >= lot.x0 && x < lot.x1 && z >= lot.z0 && z < lot.z1)
        gridCell(G, x, z, x + 2, z + 2, lotAt);
      else if (x < X.strip) gridCell(G, x, z, x + 2, z + 2, beachAt);
      else if (x >= X.bluff && x < X.top) gridCell(G, x, z, x + 2, z + 2, bluffAt);
    }
  }
  // flat town ground in runs along z
  const TOWN: Record<
    number,
    { h: number; c: string; layer: number; pave?: number; paveX?: number; rough: number }
  > = {
    [K_ROAD]: { h: 0, c: "#3e4045", layer: L.ground, rough: 0.9 },
    [K_PARKLANE]: { h: 0.02, c: "#46484c", layer: L.ground, rough: 0.9 },
    [K_WALK]: { h: 0.15, c: "#c8c0b0", layer: L.paving, pave: 1.5, rough: 0.9 },
    [K_PROM]: { h: 0.15, c: "#ac8a60", layer: L.paving, pave: 0.3, paveX: 4, rough: 0.9 },
    [K_PARK]: { h: 0.12, c: "#62923e", layer: L.ground, rough: 1 },
    [K_PATH]: { h: 0.13, c: "#c6b28e", layer: L.ground, rough: 1 },
    [K_OPEN]: { h: 0.05, c: "#4a4c50", layer: L.ground, rough: 0.9 },
    [K_BIKE]: { h: 0.08, c: "#5c6268", layer: L.ground, rough: 0.9 },
    [K_SKATE]: { h: 0.1, c: "#c9c7c0", layer: L.ground, rough: 0.7 },
    [K_COURT]: { h: 0.1, c: "#3a7898", layer: L.ground, rough: 0.8 },
    [K_LOT]: { h: 0.15, c: "#bcb4a4", layer: L.paving, pave: 1.5, rough: 0.9 },
  };
  const townKind = (c: number, x: number) => {
    const k = kind[c]!;
    if (TOWN[k]) return k;
    if (x >= X.top) return K_PARK;
    if (x >= X.prom && x < X.shops) return K_PROM;
    if (x >= X.bike && x < X.prom) return K_BIKE;
    if (x >= X.strip && x < X.bike) return K_PARK;
    return K_WALK;
  };
  for (let i = 0; i < n; i++) {
    const x0 = cx(i) - 1;
    if (x0 < X.strip || (x0 >= X.bluff && x0 < X.top)) continue;
    let j = 0;
    while (j < n) {
      const z0c = cx(j) - 1;
      if (x0 >= skate.x0 && x0 < skate.x1 && z0c >= skate.z0 && z0c < skate.z1) {
        j++;
        continue;
      }
      const k = townKind(i * n + j, x0);
      const ch = chunkAt(x0 + 1, z0c + 1);
      let j1 = j + 1;
      while (j1 < n) {
        const zz = cx(j1) - 1;
        if (x0 >= skate.x0 && x0 < skate.x1 && zz >= skate.z0 && zz < skate.z1) break;
        if (townKind(i * n + j1, x0) !== k || chunkAt(x0 + 1, zz + 1) !== ch) break;
        j1++;
      }
      const s = TOWN[k]!;
      const baseY = x0 >= X.top ? BLUFF_H : 0;
      const z1 = cx(j1) - 1;
      const kz = s.pave ?? 3;
      const kx = s.paveX ?? kz;
      ch.ground.mat(s.layer, s.rough, 0).col(s.c);
      ch.ground.flat(x0, z0c, x0 + 2, z1, baseY + s.h, [
        x0 / kx,
        -z1 / kz,
        (x0 + 2) / kx,
        -z0c / kz,
      ]);
      j = j1;
    }
  }
  // Boardwalk plank seams are merged into the ground batch: no extra objects or draw calls.
  // Short staggered joints and a wider edge board distinguish the promenade from shop paving.
  for (let z = -half; z < half; z += 0.6) {
    const G = chunkAt(138, z + 0.3).ground;
    G.mat(L.plain, 0.9, 0).col("#71583c");
    G.flat(X.prom, z, X.shops, z + 0.025, 0.156);
    const offset = (Math.round((z + half) / 0.6) % 2) * 2;
    for (let x = X.prom + offset; x < X.shops; x += 4)
      G.flat(x, z + 0.025, x + 0.025, z + 0.6, 0.157);
  }
  // curbs along the sidewalks and the promenade edge
  for (let z = -half; z < half; z += CHUNK / 4) {
    for (const x of [X.road0, X.road1]) {
      const G = chunkAt(x, z + 1).main;
      G.mat(L.ground, 0, 0).col("#b8b2a6");
      G.wall([x, z], [x, z + CHUNK / 4], 0, 0.15);
      G.wall([x, z + CHUNK / 4], [x, z], 0, 0.15);
    }
  }

  // ---- road markings (detail) ----
  for (let z = -half; z < half; z += 6) {
    const D = chunkAt(ROAD_C, z + 1).detail;
    D.mat(L.plain, 0.5, 0).col("#f2c21f");
    D.flat(ROAD_C - 0.25, z, ROAD_C - 0.1, z + 6, 0.045);
    D.flat(ROAD_C + 0.1, z, ROAD_C + 0.25, z + 6, 0.045);
    D.col("#e8e6e0");
    for (const x of [ROAD_C - 4, ROAD_C + 4]) D.flat(x - 0.08, z, x + 0.08, z + 3, 0.045);
    // bike path centre stripe
    D.col("#f2c21f");
    D.flat(X.bike + 3.95, z, X.bike + 4.05, z + 3, 0.12);
  }
  // crosswalks by the pier plaza
  for (const zc of [0, -100, 100]) {
    const D = chunkAt(ROAD_C, zc).detail;
    D.col("#f4f2ea");
    for (let x = X.road0 + 0.5; x < X.road1; x += 1.2)
      D.flat(x, zc - 2.5, x + 0.6, zc + 2.5, 0.012);
  }
  // basketball court lines, skate park coping
  {
    const D = chunkAt(108, 144).detail;
    D.col("#f4f2ea");
    const c = beach.courts;
    for (const [z0, z1] of [
      [c.z0 + 2, c.z0 + 22],
      [c.z1 - 22, c.z1 - 2],
    ] as const) {
      D.flat(c.x0 + 3, z0, c.x1 - 3, z0 + 0.1, 0.14);
      D.flat(c.x0 + 3, z1 - 0.1, c.x1 - 3, z1, 0.14);
      D.flat(c.x0 + 3, z0, c.x0 + 3.1, z1, 0.14);
      D.flat(c.x1 - 3.1, z0, c.x1 - 3, z1, 0.14);
    }
  }

  // ---- the pier: decks, fascia, piles, bracing ----
  const pierMain = (x: number, z: number) => ctx(x, z).main;
  for (const rg of beach.regions) {
    const onBluff = rg.x0 >= X.walkE - 4 && rg.x1 <= X.top;
    const G = pierMain((rg.x0 + rg.x1) / 2, (rg.z0 + rg.z1) / 2);
    if (onBluff) {
      if (rg.kind === "rampZ") {
        // concrete steps climbing along z, with side walls
        const steps = Math.round((rg.h1 - rg.h0) / 0.2);
        const run = (rg.z1 - rg.z0) / steps;
        G.mat(L.ground, 0.4, 0).col("#cdc6b8");
        for (let k = 0; k < steps; k++) {
          const y = rg.h0 + ((k + 1) * (rg.h1 - rg.h0)) / steps;
          G.box(
            (rg.x0 + rg.x1) / 2,
            y - 0.2 - 0.6,
            rg.z0 + (k + 0.5) * run,
            rg.x1 - rg.x0,
            0.8,
            run + 0.01,
          );
        }
        G.col("#b8b0a2");
        // one sloped cheek wall per side (inner face, outer face, a coping on top)
        for (const [xa, xb] of [
          [rg.x0, rg.x0 + 0.5],
          [rg.x1 - 0.5, rg.x1],
        ] as const) {
          const b0 = rg.h0 - 1.5,
            b1 = rg.h1 - 1.5,
            t0 = rg.h0 + 0.9,
            t1 = rg.h1 + 0.9;
          G.quad(xb, b0, rg.z0, xb, b1, rg.z1, xb, t1, rg.z1, xb, t0, rg.z0);
          G.quad(xa, b1, rg.z1, xa, b0, rg.z0, xa, t0, rg.z0, xa, t1, rg.z1);
          G.quad(xa, t0, rg.z0, xb, t0, rg.z0, xb, t1, rg.z1, xa, t1, rg.z1);
        }
        // wall lamps up both sides of the flight, with warm pools on the steps
        const Cb = ctx((rg.x0 + rg.x1) / 2, (rg.z0 + rg.z1) / 2);
        for (let z = rg.z0 + 4; z < rg.z1; z += 8) {
          const y = rg.h0 + ((z - rg.z0) / (rg.z1 - rg.z0)) * (rg.h1 - rg.h0);
          for (const x of [rg.x0 + 0.15, rg.x1 - 0.15]) {
            Cb.glow.col("#ffd49a").mat(0);
            Cb.glow.box(x, y + 1.6, z, 0.12, 0.3, 0.3);
          }
          Cb.pools.col("#c07a40").mat(0);
          Cb.pools.flat(rg.x0, z - 5, rg.x1, z + 5, y + 0.3, [0, 0, 1, 1]);
        }
        // handrails
        G.col("#3a3e44");
        for (const x of [rg.x0 + 0.6, rg.x1 - 0.6]) {
          const a = [x, rg.h0 + 1, rg.z0] as const;
          const b = [x, rg.h1 + 1, rg.z1] as const;
          G.quad(
            a[0] - 0.04,
            a[1],
            a[2],
            a[0] + 0.04,
            a[1],
            a[2],
            b[0] + 0.04,
            b[1],
            b[2],
            b[0] - 0.04,
            b[1],
            b[2],
          );
          G.quad(
            a[0] + 0.04,
            a[1] - 0.06,
            a[2],
            a[0] - 0.04,
            a[1] - 0.06,
            a[2],
            b[0] - 0.04,
            b[1] - 0.06,
            b[2],
            b[0] + 0.04,
            b[1] - 0.06,
            b[2],
          );
        }
      } else {
        G.mat(L.paving, 0.8, 0).col("#cdc6b8");
        G.flat(rg.x0, rg.z0, rg.x1, rg.z1, rg.h0 + 0.02, [
          rg.x0 / 1.5,
          -rg.z1 / 1.5,
          rg.x1 / 1.5,
          -rg.z0 / 1.5,
        ]);
        G.col("#b8b0a2");
        const p = rectPoly(rg.x0, rg.z0, rg.x1, rg.z1);
        for (let k = 0; k < 4; k++) G.wall(p[k]!, p[(k + 1) % 4]!, rg.h0 - 3, rg.h0 + 0.02);
      }
      continue;
    }
    // wooden pier deck (boards across the pier)
    G.mat(L.paving, 0.9, 0).col("#a07a52");
    const y00 = rg.h0 + 0.02;
    const uv = [rg.x0 / 0.35, -rg.z1 / 4, rg.x1 / 0.35, -rg.z0 / 4];
    if (rg.kind === "flat") G.flat(rg.x0, rg.z0, rg.x1, rg.z1, y00, uv);
    else if (rg.kind === "rampX")
      G.quad(
        rg.x0,
        rg.h0 + 0.02,
        rg.z1,
        rg.x1,
        rg.h1 + 0.02,
        rg.z1,
        rg.x1,
        rg.h1 + 0.02,
        rg.z0,
        rg.x0,
        rg.h0 + 0.02,
        rg.z0,
        uv,
      );
    // a string of warm bulbs along the deck edge (the pier's night silhouette over the water)
    if (rg.kind === "flat" && rg.h0 > 3) {
      const Gl = ctx((rg.x0 + rg.x1) / 2, (rg.z0 + rg.z1) / 2).glow;
      Gl.col("#ffd49a").mat(0);
      for (let x = rg.x0 + 1.5; x < rg.x1; x += 3) {
        Gl.box(x, rg.h0 - 0.3, rg.z0 - 0.08, 0.16, 0.16, 0.08);
        Gl.box(x, rg.h0 - 0.3, rg.z1 + 0.08, 0.16, 0.16, 0.08);
      }
    }
    // fascia (the deck edge band) and the beam under it
    G.mat(L.plain, 0.5, 0).col("#7a5a3c");
    const hAt = (x: number) =>
      rg.kind === "rampX" ? rg.h0 + ((rg.h1 - rg.h0) * (x - rg.x0)) / (rg.x1 - rg.x0) : rg.h0;
    const yb = (x: number) => hAt(x) - 0.75;
    G.quad(
      rg.x0,
      yb(rg.x0),
      rg.z1,
      rg.x1,
      yb(rg.x1),
      rg.z1,
      rg.x1,
      hAt(rg.x1) + 0.02,
      rg.z1,
      rg.x0,
      hAt(rg.x0) + 0.02,
      rg.z1,
    );
    G.quad(
      rg.x1,
      yb(rg.x1),
      rg.z0,
      rg.x0,
      yb(rg.x0),
      rg.z0,
      rg.x0,
      hAt(rg.x0) + 0.02,
      rg.z0,
      rg.x1,
      hAt(rg.x1) + 0.02,
      rg.z0,
    );
    G.quad(
      rg.x1,
      yb(rg.x1),
      rg.z1,
      rg.x1,
      yb(rg.x1),
      rg.z0,
      rg.x1,
      hAt(rg.x1) + 0.02,
      rg.z0,
      rg.x1,
      hAt(rg.x1) + 0.02,
      rg.z1,
    );
    G.quad(
      rg.x0,
      yb(rg.x0),
      rg.z0,
      rg.x0,
      yb(rg.x0),
      rg.z1,
      rg.x0,
      hAt(rg.x0) + 0.02,
      rg.z1,
      rg.x0,
      hAt(rg.x0) + 0.02,
      rg.z0,
    );
    // underside
    G.col("#4a3a2a");
    if (rg.kind === "flat")
      G.quad(
        rg.x0,
        yb(rg.x0),
        rg.z0,
        rg.x1,
        yb(rg.x1),
        rg.z0,
        rg.x1,
        yb(rg.x1),
        rg.z1,
        rg.x0,
        yb(rg.x0),
        rg.z1,
      );
    else
      G.quad(
        rg.x0,
        yb(rg.x0),
        rg.z0,
        rg.x1,
        yb(rg.x1),
        rg.z0,
        rg.x1,
        yb(rg.x1),
        rg.z1,
        rg.x0,
        yb(rg.x0),
        rg.z1,
      );
    // piles: rows every 6 m along x, every ~4 m across, cross beams and X bracing between rows
    for (let x = rg.x0 + 1.5; x < rg.x1; x += 6) {
      const top = yb(x);
      if (top < 1.2) continue;
      const P = pierMain(x, (rg.z0 + rg.z1) / 2);
      const across = Math.max(2, Math.round((rg.z1 - rg.z0) / 4));
      let prevZ: number | null = null;
      for (let k = 0; k <= across; k++) {
        const z = rg.z0 + 0.6 + (k / across) * (rg.z1 - rg.z0 - 1.2);
        const base = Math.min(gv(x, z), SEA) - 1.5;
        P.mat(L.plain, 0.5, 0).col("#5a4a3a");
        P.cyl(x, base, z, 0.28, top - base, 6, false);
        if (prevZ !== null && top - Math.max(gv(x, z), SEA) > 2.5) {
          // X bracing between neighbouring piles
          P.col("#4a3c2e");
          const y0 = Math.max(gv(x, z), SEA) + 0.4;
          const zz0 = prevZ;
          P.quad(
            x - 0.05,
            y0,
            zz0,
            x - 0.05,
            y0,
            z,
            x - 0.05,
            top - 0.3,
            z + 0.001,
            x - 0.05,
            top - 0.1,
            zz0,
          );
          P.quad(
            x + 0.05,
            top - 0.3,
            zz0,
            x + 0.05,
            top - 0.1,
            z,
            x + 0.05,
            y0,
            z,
            x + 0.05,
            y0 + 0.2,
            zz0,
          );
        }
        prevZ = z;
      }
      P.col("#5a4a3a");
      P.box(x, top - 0.35, (rg.z0 + rg.z1) / 2, 0.45, 0.35, rg.z1 - rg.z0 - 0.4);
    }
  }

  // ---- a lattice skirt wherever a raised deck or ramp meets open sand or grass: the ground
  // under the pier isn't walkable, so show it (boards between the piles, not an invisible wall)
  {
    const regionOf = beach.regionOf;
    for (let i = 1; i < n - 1; i++)
      for (let j = 1; j < n - 1; j++) {
        const c = i * n + j;
        if (regionOf[c]! < 0) continue;
        const x = cx(i);
        const z = cx(j);
        if (x > X.bluff - 6) continue; // the bluff stairs have their own cheek walls
        for (const [di, dj] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const k = (i + di) * n + (j + dj);
          if (regionOf[k]! >= 0 || beach.deep[k]) continue;
          const ex = x + di;
          const ez = z + dj;
          const top = heightOfRegion(beach, c, ex, ez) - 0.8;
          const bot = gv(ex + di * 0.3, ez + dj * 0.3) - 0.25;
          if (top - bot < 0.6 || bot < SEA - 0.3) continue;
          const C2 = ctx(ex, ez);
          const along = di === 0; // the edge runs along x
          C2.main.mat(L.plain, 0.5, 0).col("#4e3c2c");
          // two rails and five uprights per 2 m cell edge
          for (const yy of [bot + 0.35, top - 0.15]) {
            if (along) C2.main.box(ex, yy, ez, 2.0, 0.12, 0.08);
            else C2.main.box(ex, yy, ez, 0.08, 0.12, 2.0);
          }
          C2.main.col("#6a5038");
          for (let s = -0.8; s <= 0.81; s += 0.4) {
            if (along) C2.main.box(ex + s, bot, ez, 0.12, top - bot, 0.05);
            else C2.main.box(ex, bot, ez + s, 0.05, top - bot, 0.12);
          }
        }
      }
  }

  // ---- railings: a white rail along every railing cell's side that faces open deck ----
  {
    const solid = city.solid;
    const regionOf = beach.regionOf;
    const isRail = (c: number) =>
      solid[c] &&
      regionOf[c]! >= 0 &&
      beach.pTop[c]! - beach.pBot[c]! < 1.2 &&
      beach.pTop[c]! - beach.pBot[c]! > 1.0;
    for (let i = 1; i < n - 1; i++)
      for (let j = 1; j < n - 1; j++) {
        const c = i * n + j;
        if (!isRail(c)) continue;
        const h = beach.pBot[c]!;
        const x = cx(i);
        const z = cx(j);
        const G = ctx(x, z).main;
        G.mat(L.plain, 0.5, 0);
        for (const [di, dj] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const k = (i + di) * n + (j + dj);
          if (solid[k]) continue;
          // the rail sits 0.8 m in from the shared edge (inside the railing cell)
          const ex = x + di * 0.8;
          const ez = z + dj * 0.8;
          const along = di === 0; // rail runs along x when the open neighbour is in z
          const hh = regionOf[k]! >= 0 ? Math.min(h, heightOfRegion(beach, k, ex, ez)) : h;
          const y = Math.max(hh, h) + 0.02;
          if (h > 3 && (i + j) % 2 === 0) {
            const Gl = ctx(x, z).glow;
            Gl.col("#ffe2a8").mat(0);
            Gl.box(ex, y + 1.12, ez, 0.14, 0.14, 0.14);
          }
          G.col("#f4f0e6");
          if (along) {
            G.box(ex, y + 1.02, ez, 2.02, 0.1, 0.14);
            G.box(ex, y + 0.55, ez, 2.02, 0.06, 0.06);
            G.col("#e8e2d6");
            G.box(ex - 0.95, y, ez, 0.12, 1.08, 0.12);
          } else {
            G.box(ex, y + 1.02, ez, 0.14, 0.1, 2.02);
            G.box(ex, y + 0.55, ez, 0.06, 0.06, 2.02);
            G.col("#e8e2d6");
            G.box(ex, y, ez - 0.95, 0.12, 1.08, 0.12);
          }
        }
      }
  }

  // ---- the pier arch over the ramp foot: a beam on two posts and a big lit board on top ----
  {
    const C0 = chunkAt(126, 0);
    const x = X.prom - 1.5;
    C0.main.mat(L.plain, 0.5, 0).col("#12418a");
    C0.main.box(x, 0, -7.2, 0.9, 8.4, 0.9);
    C0.main.box(x, 0, 7.2, 0.9, 8.4, 0.9);
    C0.main.box(x, 7.4, 0, 1.0, 1.0, 16.2);
    C0.main.box(x, 8.3, 0, 0.8, 4.4, 9.2);
    signQuad(C0.signs, W["PACIFIC PIER"], x + 0.42, 10.5, 0, 8.6, 4.3, 1);
    signQuad(C0.signs, W["PACIFIC PIER"], x - 0.42, 10.5, 0, 8.6, 4.3, 3);
    C0.glow.col("#ffd878").mat(0);
    for (let k = 0; k < 16; k++) {
      const z = -4.4 + (k / 15) * 8.8;
      C0.glow.box(x, 12.75, z, 0.9, 0.12, 0.12);
      C0.glow.box(x, 8.25, z, 0.9, 0.12, 0.12);
    }
    for (let k = 0; k < 20; k++) {
      const z = -7.8 + (k / 19) * 15.6;
      C0.glow.box(x, 7.35, z, 1.08, 0.1, 0.1);
    }
  }

  // ---- skate park: coping round the bowls, quarter pipes, lights, a sign ----
  {
    const D = chunkAt(90, 76).main;
    D.mat(L.plain, 0.5, 0).col("#8a9096");
    for (const m of beach.mods) {
      const rim: [number, number][] = [];
      if (m.t === "ell")
        for (let k = 0; k <= 48; k++)
          rim.push([
            m.x + Math.cos((k / 48) * Math.PI * 2) * m.rx,
            m.z + Math.sin((k / 48) * Math.PI * 2) * m.rz,
          ]);
      else if (m.t === "cap") {
        const dx = m.bx - m.ax;
        const dz = m.bz - m.az;
        const l = Math.hypot(dx, dz);
        const nx = -dz / l;
        const nz = dx / l;
        const base = Math.atan2(nz, nx);
        for (let k = 0; k <= 16; k++) {
          const a = base + (k / 16) * Math.PI;
          rim.push([m.ax + Math.cos(a) * m.r, m.az + Math.sin(a) * m.r]);
        }
        for (let k = 0; k <= 16; k++) {
          const a = base + Math.PI + (k / 16) * Math.PI;
          rim.push([m.bx + Math.cos(a) * m.r, m.bz + Math.sin(a) * m.r]);
        }
        rim.push(rim[0]!);
      } else continue;
      for (let k = 0; k + 1 < rim.length; k++) {
        const [ax, az] = rim[k]!;
        const [bx, bz] = rim[k + 1]!;
        D.col("#c8ccd2");
        railBar(D, [ax, gv(ax, az) + 0.06, az], [bx, gv(bx, bz) + 0.06, bz], 0.09);
        // a band of blue pool tile just under the lip
        const cxm = m.t === "ell" ? m.x : (m.ax + m.bx) / 2;
        const czm = m.t === "ell" ? m.z : (m.az + m.bz) / 2;
        const inA = 0.45 / (Math.hypot(cxm - ax, czm - az) || 1);
        const inB = 0.45 / (Math.hypot(cxm - bx, czm - bz) || 1);
        const iax = ax + (cxm - ax) * inA;
        const iaz = az + (czm - az) * inA;
        const ibx = bx + (cxm - bx) * inB;
        const ibz = bz + (czm - bz) * inB;
        D.col("#2f6fa0");
        const ya = gv(ax, az) + 0.03;
        const yb2 = gv(bx, bz) + 0.03;
        const yia = gv(iax, iaz) + 0.03;
        const yib = gv(ibx, ibz) + 0.03;
        D.quad(ax, ya, az, bx, yb2, bz, ibx, yib, ibz, iax, yia, iaz);
        D.quad(bx, yb2, bz, ax, ya, az, iax, yia, iaz, ibx, yib, ibz);
      }
    }
    for (const m of beach.mods) {
      if (m.t !== "qp") continue;
      quarterPipe(D, { x0: m.x0, z0: m.z0, x1: m.x1, z1: m.z1, face: m.face }, m.h, m.run);
    }
    const Cs = chunkAt(90, 76);
    for (const [x, z, rot] of [
      [58, 50, 0],
      [118, 50, Math.PI],
      [58, 102, 0],
      [118, 102, Math.PI],
    ] as const)
      prop({ k: "streetlight", x, z, y: 0, rot }, Cs, T, gv);
    Cs.main.col("#3a3e44");
    Cs.main.box(X.bike - 1, 0, 103, 0.2, 4.2, 0.2);
    Cs.main.box(X.bike - 1, 0, 109, 0.2, 4.2, 0.2);
    Cs.main.col("#15121a");
    Cs.main.box(X.bike - 1, 3.2, 106, 0.3, 1.6, 6.4);
    signQuad(Cs.signs, W["SKATE PARK"], X.bike - 0.84, 4.0, 106, 6, 1.5, 1);
    signQuad(Cs.signs, W["SKATE PARK"], X.bike - 1.16, 4.0, 106, 6, 1.5, 3);
    // graffiti on the ledges and pipe backs
    const R = mulberry(31);
    for (let k = 0; k < 26; k++) {
      Cs.detail
        .mat(L.plain, 0.5, 0)
        .col(
          pick(["#ff4fa0", "#3affd8", "#ffe14a", "#9a6aff", "#ff7a3a", "#4fd0ff", "#7cff6a"], R),
        );
      const q = beach.qpipes[k % 2]!;
      if (q.face === 3)
        Cs.detail.box(
          q.x1 + 0.03,
          0.3 + R() * 1.6,
          q.z0 + 1 + R() * (q.z1 - q.z0 - 3),
          0.02,
          0.4 + R() * 0.8,
          0.8 + R() * 2,
        );
      else
        Cs.detail.box(
          q.x0 + 1 + R() * (q.x1 - q.x0 - 3),
          0.3 + R() * 1.6,
          q.z0 - 0.03,
          0.8 + R() * 2,
          0.4 + R() * 0.8,
          0.02,
        );
    }
    // Muscle Beach arch
    const g = beach.gym;
    const Cg = chunkAt(108, -70);
    Cg.main.mat(L.plain, 0.5, 0).col("#2a2c30");
    Cg.main.box(X.bike - 1, 0, -74, 0.25, 4.6, 0.25);
    Cg.main.box(X.bike - 1, 0, -66, 0.25, 4.6, 0.25);
    Cg.main.box(X.bike - 1, 4.2, -70, 0.3, 1.5, 8.4);
    signQuad(Cg.signs, W["MUSCLE BEACH"], X.bike - 0.84, 4.95, -70, 8, 1.4, 1);
    signQuad(Cg.signs, W["MUSCLE BEACH"], X.bike - 1.16, 4.95, -70, 8, 1.4, 3);
    // the pen: low green rails on every solid fence cell
    Cg.main.col("#2f5a3e");
    for (let x = g.x0; x < g.x1; x += 2)
      for (let z = g.z0; z < g.z1; z += 2) {
        const c = Math.floor((x + 1 + half) / 2) * n + Math.floor((z + 1 + half) / 2);
        if (!city.solid[c] || beach.pTop[c]! > 1.3) continue;
        Cg.main.box(x + 1, 0.1, z + 1, 1.9, 0.06, 1.9);
        Cg.main.box(x + 1, 1.05, z + 1, 1.9, 0.08, 1.9);
        Cg.main.box(x + 1, 0.1, z + 1, 0.1, 1.0, 0.1);
      }
    // court fences: tall chain link (a dark mesh panel on posts)
    const ct = beach.courts;
    const Cc = chunkAt(108, 144);
    for (let x = ct.x0; x < ct.x1; x += 2)
      for (let z = ct.z0; z < ct.z1; z += 2) {
        const c = Math.floor((x + 1 + half) / 2) * n + Math.floor((z + 1 + half) / 2);
        if (!city.solid[c]) continue;
        // the fence runs along whichever edge of the court this cell is on
        const alongX = z === ct.z0 || z + 2 >= ct.z1;
        Cc.main.col("#5a6068");
        Cc.main.box(x + 1, 0.1, z + 1, 0.08, 3.4, 0.08);
        Cc.main.box(x + 1, 3.4, z + 1, alongX ? 2 : 0.06, 0.06, alongX ? 0.06 : 2);
        Cc.detail.mat(L.plain, 0.5, 0).col("#2e5a44");
        Cc.detail.box(x + 1, 0.15, z + 1, alongX ? 2 : 0.03, 1.7, alongX ? 0.03 : 2);
      }
  }

  // ---- festoon lights: zig-zag strings across the promenade and over the midway ----
  {
    const festoon = (
      a: [number, number, number],
      b: [number, number, number],
      sag: number,
      bulbs: number,
    ) => {
      const C = ctx((a[0] + b[0]) / 2, (a[2] + b[2]) / 2);
      let prev: [number, number, number] | null = null;
      for (let k = 0; k <= bulbs; k++) {
        const t = k / bulbs;
        const p: [number, number, number] = [
          a[0] + (b[0] - a[0]) * t,
          a[1] + (b[1] - a[1]) * t - Math.sin(Math.PI * t) * sag,
          a[2] + (b[2] - a[2]) * t,
        ];
        if (prev) {
          C.detail.mat(L.plain, 0.5, 0).col("#2a2622");
          railBar(C.detail, prev, p, 0.012);
        }
        if (k > 0 && k < bulbs) {
          C.glow.col(k % 3 === 0 ? "#ffb45a" : "#ffe6b0").mat(0);
          C.glow.box(p[0], p[1] - 0.12, p[2], 0.13, 0.16, 0.13);
        }
        prev = p;
      }
      // a soft warm pool on the ground under the middle of the string
      const mx = (a[0] + b[0]) / 2;
      const mz = (a[2] + b[2]) / 2;
      const gy = Math.min(a[1], b[1]) - sag - 3.6;
      C.pools.col("#b8703a").mat(0);
      C.pools.flat(mx - 6, mz - 6, mx + 6, mz + 6, Math.max(gy, 0.2), [0, 0, 1, 1]);
    };
    for (let z = -half + 18; z < half - 18; z += 12) {
      if (Math.abs(z) < 20) continue;
      festoon([X.prom + 2.4, 5.6, z], [X.shops - 0.4, 4.9, z + 6], 0.7, 11);
      festoon([X.shops - 0.4, 4.9, z + 6], [X.prom + 2.4, 5.6, z + 12], 0.7, 11);
    }
    for (let x = -118; x < -26; x += 12)
      festoon([x + 3, DECK + 3.6, -9], [x + 3, DECK + 3.6, 9], 1.1, 12);
    for (let x = 44; x < 90; x += 10)
      festoon([x, DECK + 4.2, -14], [x + 5, DECK + 4.2, 14], 1.3, 14);
  }

  // ---- the clifftop railing along the bluff edge (gaps at the stair landings) ----
  for (let z = -half + 1; z < half - 1; z += 2.5) {
    const c = Math.floor((X.top + 1 + half) / 2) * n + Math.floor((z + half) / 2);
    const cl = Math.floor((X.top - 1 + half) / 2) * n + Math.floor((z + half) / 2);
    if (beach.regionOf[cl]! >= 0 || beach.regionOf[c]! >= 0) continue;
    const G = chunkAt(X.top, z).main;
    G.mat(L.plain, 0.5, 0).col("#e8e2d6");
    G.box(X.top + 0.6, BLUFF_H, z, 0.12, 1.1, 0.12);
    G.box(X.top + 0.6, BLUFF_H + 1.02, z + 1.25, 0.1, 0.08, 2.5);
    G.box(X.top + 0.6, BLUFF_H + 0.5, z + 1.25, 0.06, 0.06, 2.5);
  }

  // ---- buildings ----
  for (const b of beach.buildings) building(b, ctx((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2));

  // ---- set-piece statics: wheel frame, drop tower, coaster track, carousel pavilion ----
  {
    const w = beach.wheel;
    const G = ctx(w.x, w.z).main;
    // the wheel's own frame: u along the disc, n its normal (the axle)
    const wc = Math.cos(w.rot);
    const ws = Math.sin(w.rot);
    const WP = (u: number, y: number, v: number): [number, number, number] => [
      w.x + u * wc + v * ws,
      y,
      w.z - u * ws + v * wc,
    ];
    G.mat(L.plain, 0.5, 0).col("#e8e4dc");
    // two A-frames (one each side of the wheel), legs from the deck to the axle
    for (const s of [-1, 1]) {
      for (const du of [-9, 9]) legQuad(G, WP(du, DECK, s * 4.4), WP(0, w.y, s * 3.2), 0.55);
      const hub = WP(0, w.y - 0.8, s * 3.2);
      G.cyl(hub[0], hub[1], hub[2], 0.9, 1.6, 10);
    }
    G.col("#c8c4bc");
    G.obox(w.x, DECK, w.z, 20, 1.8, 9, w.rot);
    // The rendered treads use the same rise/run as wheelGround.
    for (let i = 0; i < 10; i++) {
      const p = WP(0, DECK, 9.3 - (i + 0.5) * 0.48);
      G.obox(p[0], DECK, p[2], 4, (i + 1) * 0.18, 0.48, w.rot);
    }
    G.col("#d8d5cb");
    for (const [u0, n0, u1, n1] of wheelRails()) {
      const a = WP(u0, 0, n0),
        b = WP(u1, 0, n1);
      a[1] = (wheelGround(w, a[0], a[2]) ?? DECK) + 1.05;
      b[1] = (wheelGround(w, b[0], b[2]) ?? DECK) + 1.05;
      legQuad(G, a, b, 0.065);
      const count = Math.ceil(Math.hypot(u1 - u0, n1 - n0) / 1.5);
      for (let i = 0; i <= count; i++) {
        const p = WP(u0 + ((u1 - u0) * i) / count, 0, n0 + ((n1 - n0) * i) / count);
        const y = wheelGround(w, p[0], p[2]) ?? DECK;
        G.cyl(p[0], y, p[2], 0.045, 1.05, 6);
      }
    }
    // Loading line directly beside the next cabin, clear of the ticket booth.
    const line = WP(0, DECK + 1.81, 2.1);
    G.col("#e4c159").obox(line[0], line[1], line[2], 2.4, 0.025, 0.18, w.rot);
    G.col("#2f5f8a");
    const booth = WP(-6.2, DECK + 1.8, 3.5);
    G.obox(booth[0], booth[1], booth[2], 3.4, 2.6, 1.6, w.rot);
    // axle
    G.col("#8a8e94");
    G.obox(w.x, w.y - 0.35, w.z, 0.7, 0.7, 7.2, w.rot);

    const d = beach.drop;
    const D = ctx(d.x, d.z).main;
    D.mat(L.plain, 0.5, 0).col("#2a3a5a");
    D.box(d.x, DECK, d.z, 2.2, d.h, 2.2);
    D.col("#e8e4dc");
    D.box(d.x, DECK, d.z, 6.5, 1.4, 6.5);
    D.box(d.x, DECK + d.h, d.z, 3.4, 1.2, 3.4);
    ctx(d.x, d.z).glow.col("#ff3a2a").mat(0);
    ctx(d.x, d.z).glow.box(d.x, DECK + d.h + 1.2, d.z, 0.5, 0.5, 0.5);
    const Gl = ctx(d.x, d.z).glow;
    Gl.col("#3affd8");
    for (let y = DECK + 3; y < DECK + d.h; y += 2.5) {
      Gl.box(d.x + 1.12, y, d.z, 0.06, 0.8, 0.9);
      Gl.box(d.x - 1.12, y, d.z, 0.06, 0.8, 0.9);
    }

    // coaster: two rails, ties, columns (steel blue), lights along the rails
    const pts = beach.coaster.pts;
    const C2 = ctx(-86, 22);
    C2.main.mat(L.plain, 0.5, 0);
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k]!;
      const b = pts[(k + 1) % pts.length]!;
      const dx = b[0] - a[0];
      const dz = b[2] - a[2];
      const l = Math.hypot(dx, dz) || 1;
      const px = (-dz / l) * 0.55;
      const pz = (dx / l) * 0.55;
      C2.main.col("#e8433a");
      for (const s of [-1, 1]) {
        railBar(
          C2.main,
          [a[0] + px * s, a[1], a[2] + pz * s],
          [b[0] + px * s, b[1], b[2] + pz * s],
          0.09,
        );
      }
      C2.main.col("#3a3e44");
      C2.main.obox(a[0], a[1] - 0.12, a[2], 1.4, 0.1, 0.2, Math.atan2(dx, dz) + Math.PI / 2);
      if (k % 4 === 0 && a[1] > DECK + 2) {
        C2.main.col("#2f5f8a");
        C2.main.cyl(a[0], DECK, a[2], 0.2, a[1] - DECK - 0.15, 6, false);
      }
      if (k % 2 === 0) {
        C2.glow.col(k % 4 ? "#ffe14a" : "#ff4fa0").mat(0);
        C2.glow.box(a[0] + px * 1.3, a[1] - 0.05, a[2] + pz * 1.3, 0.22, 0.22, 0.22);
      }
    }
    // station canopy over the low stretch
    const st = beach.coaster.station;
    C2.main.col("#f4f0e6");
    for (const [x, z] of [
      [st.x0, st.z0],
      [st.x1, st.z0],
      [st.x0, st.z1],
      [st.x1, st.z1],
    ] as const)
      C2.main.box(x, DECK, z, 0.3, 4.2, 0.3);
    C2.main.col("#e8433a");
    C2.main.box(
      (st.x0 + st.x1) / 2,
      DECK + 4.2,
      (st.z0 + st.z1) / 2,
      st.x1 - st.x0 + 1,
      0.3,
      st.z1 - st.z0 + 1,
    );
    signQuad(C2.signs, W["WEST COASTER"], (st.x0 + st.x1) / 2, DECK + 5.3, st.z0 - 0.4, 8, 2, 0);

    // carousel pavilion (the carousel itself turns in Beach.tsx)
    const cr = beach.carousel;
    const P = ctx(cr.x, cr.z);
    P.main.mat(L.plain, 0.5, 0).col("#f4f0e6");
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      P.main.cyl(
        cr.x + Math.cos(a) * (cr.r + 1.2),
        DECK,
        cr.z + Math.sin(a) * (cr.r + 1.2),
        0.18,
        5.2,
        6,
      );
    }
    P.main.col("#e85a6a");
    P.main.cone(cr.x, DECK + 5.2, cr.z, cr.r + 2.2, 3.4, 12, 0);
    P.main.col("#f4f0e6");
    P.main.cyl(cr.x, DECK + 5.0, cr.z, cr.r + 2.3, 0.45, 12, false);
    P.main.cyl(cr.x, DECK + 8.6, cr.z, 0.3, 1.6, 6);
    P.glow.col("#fff0c0").mat(0);
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      P.glow.box(
        cr.x + Math.cos(a) * (cr.r + 2.35),
        DECK + 5.2,
        cr.z + Math.sin(a) * (cr.r + 2.35),
        0.16,
        0.16,
        0.16,
      );
    }
  }

  // ---- lifeguard towers ----
  for (const t of beach.towers) {
    const y = gv(t.x, t.z);
    const Cx = ctx(t.x, t.z);
    const G = Cx.main;
    const col = [
      "#7ec8e0",
      "#f2c24a",
      "#f29ab0",
      "#9ae0b0",
      "#f4f0e6",
      "#b8a0e8",
      "#ff9a6a",
      "#8ad8d0",
    ][t.n % 8]!;
    G.mat(L.plain, 0.5, 0).col("#e8e4dc");
    for (const [dx, dz] of [
      [-1.5, -1.5],
      [1.5, -1.5],
      [1.5, 1.5],
      [-1.5, 1.5],
    ] as const)
      G.box(t.x + dx, y - 0.5, t.z + dz, 0.22, 2.9, 0.22);
    G.col("#d8d2c6");
    G.box(t.x, y + 2.3, t.z, 4.4, 0.2, 4.4);
    // hut (pastel, rounded-ish with a big window facing the sea)
    // (the hut sits to the sea side, leaving a deck walkway behind it and along its sides for
    // whoever climbs the ladder: building access, access/beachAccess.ts)
    G.col(col);
    G.box(t.x - 0.6, y + 2.5, t.z, 2.0, 2.3, 2.0);
    // clapboard: slightly proud, darker boards all the way round
    G.col(col, 0.86);
    for (let yy = y + 2.62; yy < y + 4.75; yy += 0.27)
      G.box(t.x - 0.6, yy, t.z, 2.04, 0.04, 2.04, false);
    // the back door (what a climber sees at the top of the ladder), with a porthole and a number
    G.col("#2f5f8a");
    G.box(t.x + 0.43, y + 2.5, t.z, 0.06, 1.95, 0.9);
    G.col("#cfe4ee");
    G.box(t.x + 0.47, y + 3.75, t.z, 0.03, 0.34, 0.34);
    G.col("#f4f0e6");
    G.box(t.x + 0.43, y + 4.5, t.z, 0.05, 0.28, 1.5);
    G.col("#1e2a34");
    G.box(t.x - 1.62, y + 3.2, t.z, 0.05, 1.0, 1.6);
    G.col("#f4f0e6");
    G.box(t.x - 0.6, y + 4.8, t.z, 2.5, 0.18, 2.5);
    // a steel ladder up the back (the tower is cover, not a perch)
    G.col("#b8bcc0");
    G.box(t.x + 2.25, y, t.z - 0.35, 0.06, 2.4, 0.06);
    G.box(t.x + 2.25, y, t.z + 0.35, 0.06, 2.4, 0.06);
    for (let k = 1; k < 8; k++) G.box(t.x + 2.25, y + k * 0.3, t.z, 0.05, 0.04, 0.7);
    G.col("#e8e4dc");
    G.cyl(t.x - 1.8, y + 2.4, t.z + 1.8, 0.04, 3.2, 4);
    Cx.glow.col("#e8322a").mat(0);
    Cx.glow.box(t.x - 1.8, y + 5.2, t.z + 2.2, 0.03, 0.5, 0.8);
  }

  // ---- scrub and rocks on the bluff face ----
  {
    const R = mulberry(77);
    for (let z = -half + 2; z < half - 2; z += 3.2) {
      for (let x = X.bluff + 2; x < X.top - 1; x += 4.5) {
        const px = x + (R() - 0.5) * 3;
        const pz = z + (R() - 0.5) * 3;
        const c = Math.floor((px + half) / 2) * n + Math.floor((pz + half) / 2);
        if (beach.regionOf[c]! >= 0 || R() < 0.35) continue;
        const G = chunkAt(px, pz).main;
        const k = R();
        if (k < 0.12) G.stamp(T.rock, px, gv(px, pz) - 0.3, pz, R() * 6, 1 + R(), 1 + R(), 1 + R());
        else
          G.stamp(
            T.shrub,
            px,
            gv(px, pz) - 0.4,
            pz,
            R() * 6,
            0.7 + R() * 0.9,
            0.7 + R() * 0.7,
            0.7 + R() * 0.9,
          );
      }
    }
  }

  // Court boundary tapes lie on the same sand profile as the feet and net posts.
  for (const court of beach.activity.courts) {
    const D = ctx(court.x, court.z).detail;
    D.mat(L.plain, 0.8, 0).col("#f4e7bb");
    const strip = (x0: number, z0: number, x1: number, z1: number) =>
      D.quad(
        x0,
        gv(x0, z1) + 0.025,
        z1,
        x1,
        gv(x1, z1) + 0.025,
        z1,
        x1,
        gv(x1, z0) + 0.025,
        z0,
        x0,
        gv(x0, z0) + 0.025,
        z0,
      );
    strip(court.x - 4, court.z - 8, court.x - 3.9, court.z + 8);
    strip(court.x + 3.9, court.z - 8, court.x + 4, court.z + 8);
    strip(court.x - 4, court.z - 8, court.x + 4, court.z - 7.9);
    strip(court.x - 4, court.z + 7.9, court.x + 4, court.z + 8);
  }
  // A continuous rope joins the visible buoys at the movement boundary. End sections leave
  // the pier itself clear; the existing deck railings carry the boundary through that gap.
  for (let z = -half + 8; z < half - 8; z += 8) {
    if (z < 40 && z + 8 > -40) continue;
    const D = ctx(X.surf, z + 4).detail;
    D.mat(L.plain, 0.6, 0).col("#e8d8aa");
    railBar(D, [X.surf, SEA + 0.16, z], [X.surf, SEA + 0.08, z + 4], 0.028);
    railBar(D, [X.surf, SEA + 0.08, z + 4], [X.surf, SEA + 0.16, z + 8], 0.028);
  }

  for (const side of [-1, 1]) {
    const D = ctx(X.surf, side * 38).detail;
    D.mat(L.plain, 0.6, 0).col("#e8d8aa");
    railBar(D, [X.surf, SEA + 0.16, side * 36], [X.surf, SEA + 0.16, side * 40], 0.028);
  }

  // ---- props ----
  for (const p of beach.props) prop(p, ctx(p.x, p.z), T, gv);
  for (const f of beach.firesLit) fires.push({ x: f.x, y: gv(f.x, f.z) + 0.2, z: f.z });

  // ---- parked cars: drawn instanced with the traffic (Traffic.tsx / art/cars.ts) ----

  // ---- blockades ----
  for (const b of beach.blockades) blockade(b, ctx(b.x, b.z), T);

  // ---- tunnel portals in the bluff where traffic leaves ----
  for (const z of TUNNEL_Z)
    for (const s of [-1, 1]) {
      const zc = s * z;
      const G = ctx(X.bluff, zc).main;
      G.mat(L.panel, 0.3, 0).col("#b8b0a0");
      G.box(X.bluff + 0.6, 0, zc, 1.2, 8.5, 16);
      G.col("#15161a");
      G.box(X.bluff + 0.05, 0.02, zc, 0.2, 6.2, 11);
      G.col("#d0c8b8");
      G.box(X.bluff + 0.3, 6.2, zc, 0.8, 0.5, 12);
      ctx(X.bluff, zc).glow.col("#ffb04a").mat(0);
      for (let k = -2; k <= 2; k++)
        ctx(X.bluff, zc).glow.box(X.bluff - 0.1, 5.9, zc + k * 2.2, 0.1, 0.12, 0.6);
    }

  // ---- backdrop: the coast carrying on north and south, the hills and their lights ----
  backdrop(city, far.at, chunkAt, hillLights);

  let verts = 0;
  const list = [
    ...near.list.map((c) => ({ c, far: false })),
    ...far.list.map((c) => ({ c, far: true })),
  ];
  const out: BeachChunk[] = list.map(({ c, far: isFar }) => {
    // the bulbs and neon share the sign atlas material: their uvs point at its white corner,
    // so glow + signs are one draw call per chunk
    if (c.glow.n) {
      const t = c.glow.freeze();
      for (let k = 0; k < t.count; k++) {
        t.data[k * STRIDE + 9] = 0.004;
        t.data[k * STRIDE + 10] = 0.004;
      }
      c.signs.stamp(t, 0, 0, 0);
      c.glow.n = 0;
    }
    verts += c.ground.n + c.main.n + c.detail.n + c.signs.n + c.pools.n;
    return {
      x0: c.x0,
      z0: c.z0,
      x1: c.x1,
      z1: c.z1,
      ground: c.ground.n ? c.ground.build() : null,
      main: c.main.n ? c.main.build() : null,
      detail: c.detail.n ? c.detail.build() : null,
      glow: c.glow.n ? c.glow.build() : null,
      signs: c.signs.n ? c.signs.build("uv") : null,
      pools: c.pools.n ? c.pools.build("uv") : null,
      far: isFar,
    };
  });
  return {
    chunks: out.filter((c) => c.ground || c.main || c.detail || c.glow || c.signs || c.pools),
    fires,
    hillLights,
    stats: { verts },
  };
}

/** a skate quarter pipe: a curved ramp rising to a deck with coping, facing `face` */
function quarterPipe(G: Geo, q: Rect & { face: number }, h: number, run: number) {
  // the walkable curve (the same profile the ground uses: beachLayout qpHeight), a flat deck,
  // the back wall with a parapet, two cheek walls and steel coping along the lip
  const along = q.face === 0 || q.face === 2; // the lip runs along x
  const a0 = (along ? q.x0 : q.z0) + 2; // between the cheeks
  const a1 = (along ? q.x1 : q.z1) - 2;
  const open = q.face === 3 ? q.x0 : q.face === 1 ? q.x1 : q.face === 2 ? q.z1 : q.z0;
  const back = q.face === 3 ? q.x1 : q.face === 1 ? q.x0 : q.face === 2 ? q.z0 : q.z1;
  const dir = Math.sign(back - open);
  const depth = Math.abs(back - open);
  const P = (a: number, d: number, y: number): [number, number, number] =>
    along ? [a, y, open + dir * d] : [open + dir * d, y, a];
  const N = 12;
  const quad = (A: number[], B: number[], C: number[], D: number[]) => {
    G.quad(A[0]!, A[1]!, A[2]!, B[0]!, B[1]!, B[2]!, C[0]!, C[1]!, C[2]!, D[0]!, D[1]!, D[2]!);
    G.quad(B[0]!, B[1]!, B[2]!, A[0]!, A[1]!, A[2]!, D[0]!, D[1]!, D[2]!, C[0]!, C[1]!, C[2]!);
  };
  G.mat(L.ground, 0.5, 0).col("#c3c0b8");
  for (let k = 0; k < N; k++) {
    const d0 = (k / N) * run;
    const d1 = ((k + 1) / N) * run;
    const y0 = qpHeight(h, run, d0) + 0.06;
    const y1 = qpHeight(h, run, d1) + 0.06;
    quad(P(a0, d0, y0), P(a1, d0, y0), P(a1, d1, y1), P(a0, d1, y1));
  }
  G.col("#b8b5ad");
  quad(
    P(a0, run, h + 0.06),
    P(a1, run, h + 0.06),
    P(a1, depth - 2, h + 0.06),
    P(a0, depth - 2, h + 0.06),
  );
  // back wall + parapet, cheeks (solid walls either side)
  G.col("#aaa79f");
  const box = (A0: number, A1: number, D0: number, D1: number, y1: number) => {
    const p0 = P(A0, D0, 0);
    const p1 = P(A1, D1, 0);
    G.box(
      (p0[0] + p1[0]) / 2,
      -0.3,
      (p0[2] + p1[2]) / 2,
      Math.abs(p1[0] - p0[0]),
      y1 + 0.3,
      Math.abs(p1[2] - p0[2]),
    );
  };
  box(a0 - 2, a1 + 2, depth - 2, depth, h + 1.0);
  box(a0 - 2, a0, 0, depth - 2, h + 0.35);
  box(a1, a1 + 2, 0, depth - 2, h + 0.35);
  G.col("#c8ccd2");
  railBar(G, P(a0, run, h + 0.1), P(a1, run, h + 0.1), 0.08);
}

/** the lower half of a globe (an inverted cone) */
function globeBottom(G: Geo, x: number, y: number, z: number, r: number) {
  for (let i = 0; i < 6; i++) {
    const t0 = (i / 6) * Math.PI * 2;
    const t1 = ((i + 1) / 6) * Math.PI * 2;
    G.tri(
      x + Math.cos(t0) * r,
      y,
      z + Math.sin(t0) * r,
      x + Math.cos(t1) * r,
      y,
      z + Math.sin(t1) * r,
      x,
      y - r,
      z,
    );
  }
}

function heightOfRegion(beach: BeachLayout["beach"], c: number, x: number, z: number) {
  const rg = beach.regions[beach.regionOf[c]!]!;
  if (rg.kind === "flat") return rg.h0;
  if (rg.kind === "rampX") return rg.h0 + ((rg.h1 - rg.h0) * (x - rg.x0)) / (rg.x1 - rg.x0);
  return rg.h0 + ((rg.h1 - rg.h0) * (z - rg.z0)) / (rg.z1 - rg.z0);
}

/** a square-section strut from a to b */
function legQuad(G: Geo, a: [number, number, number], b: [number, number, number], w: number) {
  railBar(G, a, b, w / 2);
}
function railBar(G: Geo, a: [number, number, number], b: [number, number, number], r: number) {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = d.length();
  if (len < 1e-4) return;
  d.normalize();
  const up = Math.abs(d.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const s = new THREE.Vector3().crossVectors(d, up).normalize().multiplyScalar(r);
  const t = new THREE.Vector3().crossVectors(s, d).normalize().multiplyScalar(r);
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const corners = [
    s.clone().add(t),
    s.clone().negate().add(t),
    s.clone().negate().sub(t),
    s.clone().sub(t),
  ];
  for (let k = 0; k < 4; k++) {
    const c0 = corners[k]!;
    const c1 = corners[(k + 1) % 4]!;
    const p0 = A.clone().add(c0);
    const p1 = A.clone().add(c1);
    const q1 = B.clone().add(c1);
    const q0 = B.clone().add(c0);
    G.quad(p1.x, p1.y, p1.z, p0.x, p0.y, p0.z, q0.x, q0.y, q0.z, q1.x, q1.y, q1.z);
  }
}

/** a static car baked into the chunk (lean model, lights off; see art/cars.ts) */
function car(D: Geo, v: Vehicle, x: number, y: number, z: number, rot: number) {
  bakeCar(D, v, x, y, z, rot, L.plain);
}

function prop(p: BProp, C: Ctx, T: Tmpls, gv: (x: number, z: number) => number) {
  const D = C.detail;
  const y = p.y;
  const tint = new THREE.Color();
  switch (p.k) {
    case "palm":
      // planted as instanced palms in Beach.tsx (Palms.tsx)
      break;
    case "lamp": {
      D.stamp(T.lamp, p.x, y + 0.15, p.z, p.rot);
      C.glow.col("#ffd9a0").mat(0);
      C.glow.box(p.x, y + 4.3, p.z, 0.26, 0.45, 0.26);
      C.pools.col("#ff9a4a").mat(0);
      C.pools.flat(p.x - 7, p.z - 7, p.x + 7, p.z + 7, y + 0.35, [0, 0, 1, 1]);
      break;
    }
    case "globe": {
      C.main.stamp(T.globe, p.x, y, p.z, 0);
      C.glow.col("#fff2d0").mat(0);
      for (const [dx, dy, r0] of [
        [-0.45, 3.5, 0.17],
        [0.45, 3.5, 0.17],
        [0, 3.72, 0.2],
      ] as const) {
        C.glow.cone(p.x + dx, y + dy, p.z, r0, r0, 6, 0);
        C.glow.cyl(p.x + dx, y + dy - 0.001, p.z, r0, 0.001, 6, false);
        globeBottom(C.glow, p.x + dx, y + dy, p.z, r0);
      }
      C.pools.col("#ffc080").mat(0);
      C.pools.flat(p.x - 6, p.z - 6, p.x + 6, p.z + 6, y + 0.06, [0, 0, 1, 1]);
      break;
    }
    case "streetlight": {
      C.main.stamp(T.streetlight, p.x, y + 0.15, p.z, p.rot);
      const s = Math.sin(p.rot);
      const c = Math.cos(p.rot);
      C.glow.col("#ffb86a").mat(0);
      C.glow.obox(p.x + s * 2.8, y + 9.1, p.z + c * 2.8, 0.3, 0.05, 0.6, p.rot);
      C.pools.col("#ff9a3a").mat(0);
      C.pools.flat(
        p.x + s * 3.4 - 9,
        p.z + c * 3.4 - 9,
        p.x + s * 3.4 + 9,
        p.z + c * 3.4 + 9,
        y + 0.2,
        [0, 0, 1, 1],
      );
      break;
    }
    case "bench":
      D.stamp(T.bench, p.x, y + 0.02, p.z, p.rot);
      break;
    case "trash":
      D.stamp(T.trash, p.x, y, p.z, 0);
      break;
    case "umbrella":
      tint.set(UMB[(p.c ?? 0) % UMB.length]!);
      D.stamp(T.umbrella, p.x, y, p.z, p.rot, 1, 1, 1, tint);
      break;
    case "towel":
      tint.set(UMB[((p.c ?? 0) + 3) % UMB.length]!);
      // a per-towel lift of up to 3 cm so overlapping towels never z-fight
      D.stamp(
        T.towel,
        p.x,
        gv(p.x, p.z) + 0.01 + (Math.abs(Math.sin(p.x * 12.9 + p.z * 7.3)) % 1) * 0.03,
        p.z,
        p.rot,
        1,
        1,
        1,
        tint,
      );
      break;
    case "board":
      tint.set(UMB[((p.c ?? 0) + 5) % UMB.length]!);
      D.stamp(T.board, p.x, y, p.z, p.rot, 1, 1, 1, tint);
      break;
    case "cooler":
      tint.set(["#1f8ad8", "#e8433a", "#3ab88a"][(p.c ?? 0) % 3]!);
      D.stamp(T.cooler, p.x, y, p.z, p.rot, 1, 1, 1, tint);
      break;
    case "firering":
      C.main.stamp(T.firering, p.x, y, p.z, 0);
      break;
    case "net":
      D.stamp(T.net, p.x, y, p.z, p.rot);
      break;
    case "cart": {
      tint.set(AWN[(p.c ?? 0) % AWN.length]![0]);
      D.stamp(T.cart, p.x, y, p.z, p.rot, 1, 1, 1, tint);
      C.glow.col(NEON[(p.c ?? 0) % NEON.length]!).mat(0);
      C.glow.obox(
        p.x + Math.sin(p.rot) * 0.7,
        y + 2.37,
        p.z + Math.cos(p.rot) * 0.7,
        2.2,
        0.045,
        0.035,
        p.rot,
      );
      break;
    }
    case "table":
      D.stamp(T.table, p.x, y + (p.x >= X.strip ? 0.15 : 0), p.z, p.rot);
      break;
    case "rack":
      D.stamp(T.rack, p.x, y + 0.1, p.z, p.rot);
      break;
    case "bars":
      D.stamp(T.bars, p.x, y + 0.1, p.z, p.rot);
      break;
    case "rings":
      D.stamp(T.rings, p.x, y + 0.1, p.z, p.rot);
      break;
    case "hoop":
      D.stamp(T.hoop, p.x, y + 0.1, p.z, p.rot);
      break;
    case "swing":
      D.stamp(T.swing, p.x, y + 0.13, p.z, p.rot);
      break;
    case "rail": {
      const L2 = p.s ?? 6;
      D.mat(L.plain, 0.5, 0).col("#9aa0a6");
      if (p.rot === 0) {
        D.box(p.x, y + 0.5, p.z, L2, 0.06, 0.06);
        D.box(p.x - L2 / 2 + 0.2, y, p.z, 0.06, 0.5, 0.06);
        D.box(p.x + L2 / 2 - 0.2, y, p.z, 0.06, 0.5, 0.06);
      } else {
        D.box(p.x, y + 0.5, p.z, 0.06, 0.06, L2);
        D.box(p.x, y, p.z - L2 / 2 + 0.2, 0.06, 0.5, 0.06);
        D.box(p.x, y, p.z + L2 / 2 - 0.2, 0.06, 0.5, 0.06);
      }
      break;
    }
    case "ledge": {
      const L2 = p.s ?? 6;
      C.main.mat(L.ground, 0.5, 0).col("#b8b4ac");
      if (p.rot === 0) C.main.box(p.x, y + 0.1, p.z, 2, 0.45, L2);
      else C.main.box(p.x, y + 0.1, p.z, L2, 0.45, 2);
      break;
    }
    case "busstop":
      D.stamp(T.busstop, p.x, y + 0.15, p.z, p.rot);
      break;
    case "flag": {
      D.stamp(T.flag, p.x, y, p.z, 0);
      D.mat(L.plain, 0.5, 0).col(p.c === 1 ? "#e8322a" : "#2f5fb8");
      D.box(p.x + 0.9, y + 5.6, p.z, 1.8, 1.1, 0.03);
      break;
    }
    case "rod":
      D.stamp(T.rod, p.x, y, p.z, p.rot);
      break;
    case "scope":
      D.stamp(T.scope, p.x, y, p.z, p.rot);
      break;
    case "buoy":
      D.stamp(T.buoy, p.x, SEA, p.z, 0);
      break;
    case "shower":
      D.stamp(T.shower, p.x, y, p.z, 0);
      break;
    case "mat": {
      // Flush 4 m-wide access slats follow the dunes; rigid boxes floated or sank at slopes.
      // The rendered park strip sits 12 cm above natural ground. Ease onto that surface
      // over the last 2 m of sand, so the connection to the bike path stays visible.
      const matY = (x: number, z: number) =>
        gv(x, z) + 0.035 + 0.12 * Math.max(0, Math.min(1, (x - (X.strip - 2)) / 2));
      D.mat(L.plain, 0.9, 0).col("#a4865d");
      for (let k = 0; k < 8; k++) {
        const a = p.x - 1.2 + k * 0.3,
          b = a + 0.285;
        const z0 = p.z - 2,
          z1 = p.z + 2;
        D.quad(a, matY(a, z1), z1, b, matY(b, z1), z1, b, matY(b, z0), z0, a, matY(a, z0), z0);
      }
      break;
    }
    case "bike":
      D.stamp(T.bike, p.x, y + 0.34, p.z, p.rot);
      break;
    case "tree":
      C.main.stamp(T.tree, p.x, y, p.z, p.rot, p.s ?? 1, p.s ?? 1, p.s ?? 1);
      break;
    case "sign66": {
      D.mat(L.plain, 0.5, 0).col("#8a9096");
      D.box(p.x, y, p.z - 1, 0.1, 3, 0.1);
      D.box(p.x, y, p.z + 1, 0.1, 3, 0.1);
      D.col("#f4f2ea");
      D.box(p.x, y + 2.2, p.z, 0.08, 1.3, 2.4);
      signQuad(C.signs, W["END OF THE TRAIL"], p.x - 0.08, y + 2.85, p.z, 2.3, 1.15, 3);
      signQuad(C.signs, W["END OF THE TRAIL"], p.x + 0.08, y + 2.85, p.z, 2.3, 1.15, 1);
      break;
    }
    default:
      break;
  }
}

function blockade(b: Blockade, C: Ctx, T: Tmpls) {
  const D = C.detail;
  const G = C.main;
  const along = b.rot === 0; // the closure line runs along x
  // unit vector toward the playable side, and its heading (for things that face the player)
  const ix = b.face === 1 ? 1 : b.face === 3 ? -1 : 0;
  const iz = b.face === 2 ? 1 : b.face === 0 ? -1 : 0;
  switch (b.k) {
    case "aframe":
      G.stamp(T.aframe, b.x, b.y, b.z, b.rot);
      break;
    case "jersey":
      G.stamp(T.jersey, b.x, b.y, b.z, b.rot);
      break;
    case "cone":
      D.stamp(T.cone, b.x, b.y, b.z, 0);
      break;
    case "fence": {
      G.stamp(T.fence, b.x, b.y, b.z, b.rot);
      if (b.label !== undefined) {
        // a closure banner zip-tied to the panel, facing the player
        const word = CLOSED_WORD[b.label] ?? W["KEEP OUT"];
        signQuad(C.signs, word, b.x + ix * 0.04, b.y + 1.25, b.z + iz * 0.04, 2.0, 1.0, b.face);
      }
      break;
    }
    case "sandbag":
      D.stamp(T.sandbag, b.x, b.y, b.z, b.rot);
      break;
    case "tape": {
      const w = b.w ?? 10;
      D.mat(L.plain, 0.5, 0);
      for (let s = -w / 2; s <= w / 2; s += 2.5) {
        D.col("#f4f2ea");
        D.box(b.x + (along ? s : 0), b.y - 0.2, b.z + (along ? 0 : s), 0.06, 1.3, 0.06);
      }
      D.col("#e8322a");
      if (along) D.box(b.x, b.y + 0.95, b.z, w, 0.08, 0.02);
      else D.box(b.x, b.y + 0.95, b.z, 0.02, 0.08, w);
      break;
    }
    case "truck": {
      // the lifeguard pickup parked along the closure, light bar lit
      const v: Vehicle = {
        type: "pickup",
        len: 5.4,
        wid: 2.0,
        wheel: 0.42,
        color: 0xf2f0ea,
        extras: 0,
        mass: 1.5,
      };
      const rot = along ? Math.PI / 2 : 0;
      car(G, v, b.x, b.y + 0.02, b.z, rot);
      signQuad(
        C.signs,
        W.LIFEGUARD,
        b.x + ix * 1.03,
        b.y + 1.05,
        b.z + iz * 1.03,
        2.6,
        0.55,
        b.face,
        "#3a6ab8",
      );
      C.glow.col("#ff3a2a").mat(0);
      C.glow.box(b.x - (along ? 0.4 : 0), b.y + 2.02, b.z - (along ? 0 : 0.4), 0.3, 0.14, 0.3);
      C.glow.col("#3a6aff");
      C.glow.box(b.x + (along ? 0.4 : 0), b.y + 2.02, b.z + (along ? 0 : 0.4), 0.3, 0.14, 0.3);
      break;
    }
    case "police": {
      const v: Vehicle = {
        type: "police",
        len: 4.9,
        wid: 1.9,
        wheel: 0.34,
        color: 0x151518,
        extras: 0,
        mass: 1.2,
      };
      car(G, v, b.x, b.y + 0.02, b.z, (along ? Math.PI / 2 : 0) + 0.25);
      C.glow.col("#ff2020").mat(0);
      C.glow.box(b.x - (along ? 0.3 : 0), b.y + 1.6, b.z - (along ? 0 : 0.3), 0.3, 0.12, 0.3);
      C.glow.col("#2050ff");
      C.glow.box(b.x + (along ? 0.3 : 0), b.y + 1.6, b.z + (along ? 0 : 0.3), 0.3, 0.12, 0.3);
      break;
    }
    case "arrowboard": {
      G.stamp(T.arrowboard, b.x, b.y, b.z, along ? 0 : Math.PI / 2);
      C.glow.col("#ffb01a").mat(0);
      for (let k = -3; k <= 3; k++) {
        const y = b.y + 2.9 - Math.abs(k) * 0.06;
        if (along) C.glow.box(b.x + k * 0.28, y, b.z + iz * 0.07, 0.16, 0.16, 0.04);
        else C.glow.box(b.x + ix * 0.07, y, b.z + k * 0.28, 0.04, 0.16, 0.16);
      }
      break;
    }
    case "sign": {
      D.stamp(T.signpost, b.x, b.y, b.z, b.rot);
      const word = CLOSED_WORD[b.label ?? 0] ?? W["KEEP OUT"];
      signQuad(C.signs, word, b.x + ix * 0.04, b.y + 1.8, b.z + iz * 0.04, 1.95, 0.97, b.face);
      break;
    }
    case "buoyline": {
      const w = b.w ?? 20;
      for (let s = -w / 2; s < w / 2; s += 1.8)
        G.stamp(
          T.float,
          b.x + (along ? s : 0),
          -1.0,
          b.z + (along ? 0 : s),
          along ? 0 : Math.PI / 2,
        );
      // a net hanging under the float line, and a red flag post every 10 m
      G.mat(L.plain, 0.5, 0).col("#26302a");
      if (along) G.box(b.x, -2.2, b.z, w, 1.3, 0.03);
      else G.box(b.x, -2.2, b.z, 0.03, 1.3, w);
      for (let s = -w / 2 + 2; s < w / 2; s += 10) {
        G.col("#e8e4dc");
        G.box(b.x + (along ? s : 0), -1.2, b.z + (along ? 0 : s), 0.08, 3.2, 0.08);
        G.col("#e8322a");
        G.box(
          b.x + (along ? s + 0.5 : 0),
          1.3,
          b.z + (along ? 0 : s + 0.5),
          along ? 1 : 0.03,
          0.6,
          along ? 0.03 : 1,
        );
      }
      break;
    }
    case "boat":
      G.stamp(T.boat, b.x, -1.0, b.z, b.rot);
      break;
    default:
      break;
  }
}

/** the coast beyond the arena: beach, sea wall, bluff, rooftops and hills, lit at night */
function backdrop(
  city: BeachLayout,
  farAt: (x: number, z: number) => ChunkGeo,
  nearAt: (x: number, z: number) => ChunkGeo,
  lights: [number, number, number][],
) {
  const half = city.half;
  const r = mulberry(4242);
  void nearAt;
  // ground strips north and south of the arena, curving gently seaward with distance
  const curve = (z: number) => {
    const d = Math.max(0, Math.abs(z) - half);
    return -0.00018 * d * d;
  };
  const step = 40;
  for (const s of [-1, 1]) {
    for (let d = 0; d < 2600; d += step) {
      const z0 = s * (half + d);
      const z1 = s * (half + d + step);
      const za = Math.min(z0, z1);
      const zb = Math.max(z0, z1);
      const zm = (za + zb) / 2;
      const off = curve(zm);
      const G = farAt(0, zm).ground;
      const band = (x0: number, x1: number, h0: number, h1: number, col: string, rough: number) => {
        G.mat(L.ground, rough, 0).col(col);
        const oa = curve(za);
        const ob = curve(zb);
        G.quad(x0 + ob, h0, zb, x1 + ob, h1, zb, x1 + oa, h1, za, x0 + oa, h0, za, [
          x0 / 3,
          -zb / 3,
          x1 / 3,
          -za / 3,
        ]);
        if (s > 0) {
          // winding: keep the faces pointing up on both sides
        }
      };
      // sand (wet -> dry), the strip, the promenade, the road, the bluff, the clifftop
      band(-110, -68, -2, -0.95, "#7a6a52", 0.3);
      band(-68, -36, -0.95, -0.6, "#a88c68", 0.25);
      band(-36, 96, -0.6, 0, "#e2cc9e", 1);
      band(96, 148, 0.12, 0.12, "#62923e", 1);
      band(148, 204, 0.1, 0.1, "#bcb4a4", 1);
      band(204, 224, 0, 0, "#3e4045", 0.9);
      band(224, 232, 0.15, 0.15, "#c8c0b0", 1);
      band(232, 260, 0.15, BLUFF_H, "#7a7a48", 1);
      band(260, 700, BLUFF_H, BLUFF_H + 30, "#6a7a44", 1);
      band(700, 2400, BLUFF_H + 30, 180 + Math.sin(zm * 0.002) * 60, "#5a6a48", 1);
      // shop / motel boxes along the strip, houses on the clifftop, all with night windows
      const M = farAt(170, zm).main;
      if (r() < 0.8) {
        const h = 4 + Math.floor(r() * 3) * 3.4;
        M.mat(L.resid, r(), 1).col(pick(PASTEL, r));
        M.box(170 + off, 0, zm, 36, h, step * 0.7);
      }
      for (let k = 0; k < 3; k++) {
        if (r() < 0.45) continue;
        const hx = 290 + k * 70 + r() * 50;
        const hy = BLUFF_H + ((hx - 260) / 440) * 30;
        M.mat(L.resid, r(), 1).col(pick(["#f4ead8", "#efe2cc", "#f6f0e4", "#e8d8c0"], r));
        M.box(hx + off, hy - 1, zm + (r() - 0.5) * 20, 14, 7.5, 12);
        M.mat(L.plain, 0.5, 0).col("#b8583a");
        M.box(hx + off, hy + 6.5, zm, 15, 1.2, 13);
        const tr = farAt(hx, zm).main;
        tr.stamp(
          templates().tree,
          hx + off - 12,
          hy - 0.5,
          zm + (r() - 0.5) * 16,
          r() * 6,
          1.4,
          1.4,
          1.4,
        );
      }
      // palms along the promenade continue into the distance
      for (let k = 0; k < 2; k++) {
        const pz = zm + (k - 0.5) * 20;
        const px = X.prom + 2 + curve(pz);
        const H = 22 + r() * 6;
        const G2 = farAt(px, pz).main;
        G2.stamp(templates().trunk1, px, 0, pz, r() * 6, 1, H, 1);
        G2.stamp(templates().skirt, px, H, pz + 1.2, 0);
        G2.stamp(templates().crown, px, H + 0.3, pz + 1.2, r() * 6);
      }
      // lights on the hills
      for (let k = 0; k < 6; k++) {
        const lx = 300 + r() * 1900;
        const ly =
          lx < 700
            ? BLUFF_H + ((lx - 260) / 440) * 30
            : BLUFF_H + 30 + ((lx - 700) / 1700) * (150 + Math.sin(zm * 0.002) * 60);
        lights.push([lx + off, ly + 2, zm + (r() - 0.5) * step]);
      }
    }
  }
  // hillside neighbourhoods: streets of stucco houses with red roofs and trees, climbing east
  {
    const hillY = (x: number, z: number) =>
      x < 700
        ? BLUFF_H + ((x - 260) / 440) * 30
        : BLUFF_H + 30 + ((x - 700) / 1700) * (150 + Math.sin(z * 0.002) * 60);
    const R = mulberry(8080);
    for (let z = -1300; z < 1300; z += 30) {
      const off = curve(z);
      for (let x = 420; x < 1250; x += 34) {
        if (Math.abs(z) < half && x < half + 10) continue;
        if (R() < 0.42) continue;
        const hx = x + (R() - 0.5) * 14 + off;
        const hz = z + (R() - 0.5) * 12;
        const hy = hillY(x, z);
        const M = farAt(hx, hz).main;
        M.mat(L.resid, R(), 1).col(
          pick(["#f4ead8", "#efe2cc", "#f6f0e4", "#e8d8c0", "#f0dcc8"], R),
        );
        const w = 10 + R() * 6;
        const d = 9 + R() * 4;
        M.box(hx, hy - 1.2, hz, w, 7.4, d);
        M.mat(L.plain, 0.5, 0).col(R() < 0.8 ? "#b8583a" : "#8a6a5a");
        M.box(hx, hy + 6.2, hz, w + 1, 1.3, d + 1);
        const T2 = templates().tree;
        for (let k = 0; k < 2; k++) {
          const tx = hx + (R() - 0.5) * 22;
          const tz = hz + (R() - 0.5) * 18;
          const sc = 1.2 + R() * 0.8;
          M.stamp(T2, tx, hillY(tx - off, tz) - 0.6, tz, R() * 6, sc, sc, sc);
        }
        if (R() < 0.35) lights.push([hx + (R() - 0.5) * 8, hy + 3 + R() * 2, hz + (R() - 0.5) * 8]);
      }
    }
  }

  // the hills behind the arena (east), with houses and lights
  for (let z = -half; z < half; z += 40) {
    const G = farAt(1000, z).ground;
    G.mat(L.ground, 1, 0).col("#6a7a44");
    G.quad(
      half,
      BLUFF_H,
      z + 40,
      700,
      BLUFF_H + 30,
      z + 40,
      700,
      BLUFF_H + 30,
      z,
      half,
      BLUFF_H,
      z,
    );
    G.col("#5a6a48");
    G.quad(
      700,
      BLUFF_H + 30,
      z + 40,
      2400,
      180 + Math.sin((z + 40) * 0.002) * 60,
      z + 40,
      2400,
      180 + Math.sin(z * 0.002) * 60,
      z,
      700,
      BLUFF_H + 30,
      z,
    );
    for (let k = 0; k < 8; k++) {
      const lx = half + r() * 1900;
      if (k >= 3 && k < 6 && lx < 1100) {
        const tr = farAt(lx, z).main;
        tr.stamp(
          templates().tree,
          lx,
          (lx < 700 ? BLUFF_H + ((lx - half) / (700 - half)) * 30 : BLUFF_H + 30) - 0.5,
          z + r() * 40,
          r() * 6,
          1.6,
          1.6,
          1.6,
        );
      }
      const ly =
        lx < 700
          ? BLUFF_H + ((lx - half) / (700 - half)) * 30
          : BLUFF_H + 30 + ((lx - 700) / 1700) * (150 + Math.sin(z * 0.002) * 60);
      lights.push([lx, ly + 2, z + r() * 40]);
      if (k < 3 && lx < 1200) {
        const M = farAt(lx, z).main;
        M.mat(L.resid, r(), 1).col(pick(["#f4ead8", "#efe2cc", "#f6f0e4", "#e8d8c0"], r));
        M.box(lx, ly - 1, z + r() * 40, 14, 7, 12);
        M.mat(L.plain, 0.5, 0).col("#b8583a");
        M.box(lx, ly + 6, z + r() * 40, 15, 1.2, 13);
      }
    }
  }
  void kindUnused;
}
const kindUnused = [K_BLUFF, K_WALK, K_PATH];
