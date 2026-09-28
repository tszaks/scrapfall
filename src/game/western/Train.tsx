// The Dry Gulch freight on screen: a 4-4-0 American with a balloon stack, a tender, a string
// of boxcars, flats of lumber, tank cars, stock cars and gondolas, and a red caboose. Every
// car kind is one InstancedMesh (the western facade material), the wheels one more, the
// smoke a pool of sprites. Positions come from the shared clock (train.ts), so the host and
// every guest see the same train. The train blocks bullets, bumps players hard, flattens
// small enemies, whistles well before it arrives, and never stops for you (it stops once:
// to deliver the Iron Marshal).
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { Geo } from "../cityGeo";
import type { TimeOfDay } from "../lighting";
import { hitsTraffic, liveCars, type TrafficLink } from "../trafficCore";
import { RAIL_X, type WesternLayout } from "./layout";
import { WESTERN_LOOK } from "./look";
import { trainVoice, whistle } from "./sound";
import { TILE_M, WL, puffTexture, softGlow } from "./textures";
import {
  carCentres,
  frontOf,
  speedOf,
  trainClock,
  trainLine,
  trainsAt,
  whistles,
  type CarKind,
  type Run,
} from "./trainSim";
import { addUV } from "./mesh";
import { facadeMaterial, syncEnv } from "./materials";
import { riderSync } from "./Riders";

const KINDS: CarKind[] = [
  "loco",
  "tender",
  "box",
  "flat",
  "tank",
  "stock",
  "gondola",
  "caboose",
  "armored",
];
const MAX_PER_KIND = 14;
const MAX_WHEELS = 260;
const PUFFS = 72;
const q100 = (v: number) => Math.round(v * 100);

const _m = new THREE.Matrix4();
const _car = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _x = new THREE.Vector3(1, 0, 0);
const _y = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();

// ---------------------------------------------------------------------------------------
// car geometry (local: y = 0 on the rail head, +z = front, centred)

function box(
  G: Geo,
  layer: number,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
) {
  const [tu, tv] = TILE_M[layer] ?? [2, 2];
  G.mat(layer);
  const w = (ax: number, az: number, bx: number, bz: number) =>
    G.quad(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az, [
      0,
      y0 / tv,
      Math.hypot(bx - ax, bz - az) / tu,
      y1 / tv,
    ]);
  w(x1, z0, x0, z0);
  w(x1, z1, x1, z0);
  w(x0, z1, x1, z1);
  w(x0, z0, x0, z1);
  G.flat(x0, z0, x1, z1, y1, [x0 / tu, z0 / tu, x1 / tu, z1 / tu]);
  G.quad(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1, [0, 0, 1, 1]);
}
/** a cylinder lying along z */
function tubeZ(
  G: Geo,
  layer: number,
  y: number,
  x: number,
  r: number,
  z0: number,
  z1: number,
  seg = 14,
  caps = true,
) {
  const g = new THREE.CylinderGeometry(r, r, z1 - z0, seg, 1, !caps);
  g.rotateX(Math.PI / 2);
  G.mat(layer);
  G.add(g, new THREE.Matrix4().makeTranslation(x, y, (z0 + z1) / 2));
  g.dispose();
}
function cylY(
  G: Geo,
  layer: number,
  x: number,
  y0: number,
  z: number,
  r0: number,
  r1: number,
  h: number,
  seg = 12,
) {
  const g = new THREE.CylinderGeometry(r1, r0, h, seg);
  G.mat(layer);
  G.add(g, new THREE.Matrix4().makeTranslation(x, y0 + h / 2, z));
  g.dispose();
}
function frame(G: Geo, len: number) {
  G.col("#2a2624");
  box(G, WL.IRON, -1.1, 0.72, -len / 2, 1.1, 1.12, len / 2);
  // couplers
  box(G, WL.IRON, -0.18, 0.75, len / 2, 0.18, 1.0, len / 2 + 0.55);
  box(G, WL.IRON, -0.18, 0.75, -len / 2 - 0.55, 0.18, 1.0, -len / 2);
  // truck side frames
  for (const z of [-len / 2 + 1.7, len / 2 - 1.7]) {
    box(G, WL.IRON, -0.95, 0.3, z - 1.3, -0.8, 0.72, z + 1.3);
    box(G, WL.IRON, 0.8, 0.3, z - 1.3, 0.95, 0.72, z + 1.3);
  }
}
function ladder(G: Geo, x: number, z: number, y0: number, y1: number) {
  G.col("#2a2624");
  for (let y = y0 + 0.3; y < y1; y += 0.42)
    box(G, WL.IRON, x - 0.02, y, z - 0.25, x + 0.03, y + 0.04, z + 0.25);
}

function carGeo(kind: CarKind): { geo: THREE.BufferGeometry; wheels: [number, number][] } {
  const G = new Geo();
  G.mat(WL.PAINT, 0.5, 0);
  let wheels: [number, number][] = [];
  const truckWheels = (len: number): [number, number][] => {
    const out: [number, number][] = [];
    for (const z of [-len / 2 + 1.7, len / 2 - 1.7]) out.push([z - 0.85, 0.42], [z + 0.85, 0.42]);
    return out;
  };
  if (kind === "loco") {
    const len = 12.6;
    G.col("#2a2624");
    box(G, WL.IRON, -0.9, 0.7, -6.0, 0.9, 1.15, 5.1);
    // pilot (cowcatcher) bars and the buffer beam, in red
    G.col("#8a2a1c");
    box(G, WL.PAINT, -1.15, 0.8, 5.0, 1.15, 1.3, 5.35);
    for (let x = -0.9; x <= 0.91; x += 0.3) {
      const b = new THREE.BoxGeometry(0.09, 0.09, 1.5);
      const m = new THREE.Matrix4()
        .makeTranslation(x * 0.65, 0.6, 5.85)
        .multiply(new THREE.Matrix4().makeRotationX(0.62));
      G.mat(WL.PAINT);
      G.add(b, m);
      b.dispose();
    }
    // steam chests and cylinders
    G.col("#2e2a28");
    for (const s of [-1, 1])
      box(G, WL.IRON, s > 0 ? 0.85 : -1.3, 0.85, 3.1, s > 0 ? 1.3 : -0.85, 1.65, 4.6);
    // boiler with brass bands, the smokebox, the front door
    G.col("#1f2a24");
    tubeZ(G, WL.IRON, 2.35, 0, 0.8, -3.0, 4.2);
    G.col("#c8a040");
    for (const z of [-2.2, -0.6, 1.0, 2.6])
      tubeZ(G, WL.PAINT, 2.35, 0, 0.83, z, z + 0.14, 14, false);
    G.col("#1a1816");
    tubeZ(G, WL.IRON, 2.35, 0, 0.86, 4.2, 5.0);
    G.col("#c8a040");
    tubeZ(G, WL.PAINT, 2.35, 0, 0.5, 5.0, 5.08, 12);
    // the balloon stack
    G.col("#1a1816");
    cylY(G, WL.IRON, 0, 3.0, 4.4, 0.24, 0.24, 1.0);
    cylY(G, WL.IRON, 0, 4.0, 4.4, 0.24, 0.78, 1.0, 14);
    cylY(G, WL.IRON, 0, 5.0, 4.4, 0.78, 0.7, 0.32, 14);
    // headlamp on the smokebox
    G.col("#2a2420");
    box(G, WL.IRON, -0.36, 3.12, 4.55, 0.36, 3.95, 5.25);
    G.col("#c8a040");
    box(G, WL.PAINT, -0.4, 3.95, 4.5, 0.4, 4.05, 5.3);
    // domes and the bell
    G.col("#c8a040");
    cylY(G, WL.PAINT, 0, 3.0, 2.2, 0.42, 0.34, 0.6, 12);
    cylY(G, WL.PAINT, 0, 3.6, 2.2, 0.34, 0.05, 0.3, 12);
    cylY(G, WL.PAINT, 0, 3.0, 0.0, 0.46, 0.38, 0.7, 12);
    cylY(G, WL.PAINT, 0, 3.7, 0.0, 0.38, 0.05, 0.32, 12);
    cylY(G, WL.PAINT, 0, 3.1, 1.1, 0.24, 0.18, 0.32, 10);
    // running boards and handrails
    G.col("#2a2624");
    for (const s of [-1, 1]) {
      box(G, WL.IRON, s > 0 ? 0.85 : -1.4, 1.45, -3.0, s > 0 ? 1.4 : -0.85, 1.52, 4.6);
      box(G, WL.IRON, s * 0.95 - 0.02, 2.95, -3.0, s * 0.95 + 0.02, 2.99, 4.3);
    }
    // the cab, in red with dark windows and an arched roof
    G.col("#9a2a1c");
    box(G, WL.P_BOARD, -1.38, 1.15, -6.1, 1.38, 3.95, -3.1);
    G.col("#141210").mat(WL.PAINT);
    for (const s of [-1, 1]) {
      const x = s * 1.39;
      const zA = s > 0 ? -3.5 : -5.2;
      const zB = s > 0 ? -5.2 : -3.5;
      G.quad(x, 2.5, zA, x, 2.5, zB, x, 3.6, zB, x, 3.6, zA, [0, 0, 1, 1]);
    }
    G.quad(-1.1, 2.6, -3.09, -0.25, 2.6, -3.09, -0.25, 3.6, -3.09, -1.1, 3.6, -3.09, [0, 0, 1, 1]);
    G.quad(0.25, 2.6, -3.09, 1.1, 2.6, -3.09, 1.1, 3.6, -3.09, 0.25, 3.6, -3.09, [0, 0, 1, 1]);
    G.col("#2a2420");
    box(G, WL.IRON, -1.6, 3.95, -6.4, 1.6, 4.1, -2.8);
    box(G, WL.IRON, -1.3, 4.1, -6.2, 1.3, 4.22, -3.0);
    wheels = [
      [3.9, 0.42],
      [2.7, 0.42],
      [0.1, 0.86],
      [-2.2, 0.86],
    ];
    void len;
  } else if (kind === "tender") {
    const len = 7.2;
    frame(G, len);
    G.col("#1f2a24");
    box(G, WL.IRON, -1.38, 1.12, -3.5, 1.38, 2.75, 2.3);
    G.col("#c8a040");
    box(G, WL.PAINT, -1.4, 2.35, -3.5, 1.4, 2.45, 2.3);
    G.col("#1f2a24");
    box(G, WL.IRON, -1.38, 1.12, 2.3, 1.38, 1.9, 3.6);
    // the coal heap
    const ico = new THREE.IcosahedronGeometry(1, 1);
    G.col("#1a1816");
    addUV(
      G,
      ico,
      new THREE.Matrix4()
        .makeTranslation(0, 2.4, 1.6)
        .multiply(new THREE.Matrix4().makeScale(1.3, 0.75, 1.9)),
      WL.BALLAST,
    );
    ico.dispose();
    wheels = truckWheels(len);
  } else if (kind === "box" || kind === "stock") {
    const len = 11.2;
    frame(G, len);
    if (kind === "box") {
      G.col("#ffffff");
      box(G, WL.P_BOARD, -1.48, 1.12, -len / 2, 1.48, 3.95, len / 2);
    } else {
      G.col("#1a120c");
      box(G, WL.PAINT, -1.3, 1.12, -len / 2 + 0.2, 1.3, 3.8, len / 2 - 0.2);
      G.col("#ffffff");
      for (let y = 1.25; y < 3.9; y += 0.45)
        box(G, WL.P_BOARD, -1.48, y, -len / 2, 1.48, y + 0.26, len / 2);
      for (let z = -len / 2; z <= len / 2; z += 1.4)
        box(G, WL.P_BOARD, -1.5, 1.12, z - 0.08, 1.5, 3.95, z + 0.08);
    }
    // a shallow peaked roof with the running board on top
    G.col("#6a5a4e");
    G.mat(WL.P_BOARD);
    G.quad(
      1.58,
      3.95,
      len / 2,
      1.58,
      3.95,
      -len / 2,
      0,
      4.2,
      -len / 2,
      0,
      4.2,
      len / 2,
      [0, 0, 3, 0.4],
    );
    G.quad(
      -1.58,
      3.95,
      -len / 2,
      -1.58,
      3.95,
      len / 2,
      0,
      4.2,
      len / 2,
      0,
      4.2,
      -len / 2,
      [0, 0, 3, 0.4],
    );
    G.col("#8a7258");
    box(G, WL.TIMBER, -0.3, 4.2, -len / 2, 0.3, 4.27, len / 2);
    // sliding doors with bracing
    if (kind === "box") {
      for (const s of [-1, 1]) {
        G.col("#d8d0c8", 0.8);
        box(G, WL.P_BOARD, s > 0 ? 1.48 : -1.56, 1.2, -1.1, s > 0 ? 1.56 : -1.48, 3.8, 1.1);
        G.col("#2a2624");
        box(G, WL.IRON, s > 0 ? 1.56 : -1.6, 3.8, -1.6, s > 0 ? 1.6 : -1.56, 3.9, 1.6);
      }
    }
    ladder(G, 1.5, len / 2 - 0.4, 1.1, 4.1);
    ladder(G, -1.5, -len / 2 + 0.4, 1.1, 4.1);
    G.col("#2a2624");
    cylY(G, WL.IRON, 0, 4.2, len / 2 - 0.2, 0.03, 0.03, 0.5, 5);
    wheels = truckWheels(len);
  } else if (kind === "flat") {
    const len = 11.2;
    frame(G, len);
    G.col("#7a6450");
    box(G, WL.TIMBER, -1.45, 1.12, -len / 2, 1.45, 1.3, len / 2);
    // stacked lumber, banded
    G.col("#d8b888");
    box(G, WL.TIMBER, -1.3, 1.3, -5.2, 1.3, 2.7, -0.4);
    box(G, WL.TIMBER, -1.3, 1.3, 0.4, 1.3, 2.4, 5.2);
    G.col("#2a2624");
    for (const z of [-4.2, -1.5, 1.5, 4.2])
      box(G, WL.IRON, -1.34, 1.3, z - 0.05, 1.34, z < 0 ? 2.74 : 2.44, z + 0.05);
    for (let z = -5; z <= 5; z += 2.5)
      for (const s of [-1, 1])
        box(G, WL.TIMBER, s * 1.4 - 0.06, 1.3, z - 0.06, s * 1.4 + 0.06, 2.3, z + 0.06);
    wheels = truckWheels(len);
  } else if (kind === "tank") {
    const len = 10.4;
    frame(G, len);
    G.col("#ffffff");
    tubeZ(G, WL.IRON, 2.45, 0, 1.25, -4.7, 4.7, 16);
    cylY(G, WL.IRON, 0, 3.55, 0, 0.55, 0.55, 0.55, 12);
    G.col("#8a7258");
    box(G, WL.TIMBER, -1.5, 1.12, -len / 2, 1.5, 1.22, len / 2);
    G.col("#2a2624");
    for (const z of [-3.2, 0, 3.2]) tubeZ(G, WL.IRON, 2.45, 0, 1.28, z - 0.06, z + 0.06, 16, false);
    wheels = truckWheels(len);
  } else if (kind === "gondola") {
    const len = 10.6;
    frame(G, len);
    G.col("#ffffff");
    box(G, WL.P_BOARD, -1.45, 1.12, -len / 2, -1.3, 2.3, len / 2);
    box(G, WL.P_BOARD, 1.3, 1.12, -len / 2, 1.45, 2.3, len / 2);
    box(G, WL.P_BOARD, -1.45, 1.12, -len / 2, 1.45, 2.3, -len / 2 + 0.15);
    box(G, WL.P_BOARD, -1.45, 1.12, len / 2 - 0.15, 1.45, 2.3, len / 2);
    const ico = new THREE.IcosahedronGeometry(1, 1);
    G.col("#b89a88");
    for (const z of [-3, 0, 3])
      addUV(
        G,
        ico,
        new THREE.Matrix4()
          .makeTranslation(0, 2.05, z)
          .multiply(new THREE.Matrix4().makeScale(1.25, 0.5, 1.7)),
        WL.BALLAST,
      );
    ico.dispose();
    wheels = truckWheels(len);
  } else if (kind === "caboose") {
    const len = 9.4;
    frame(G, len);
    G.col("#ffffff");
    box(G, WL.P_BOARD, -1.45, 1.12, -3.6, 1.45, 3.6, 3.6);
    box(G, WL.P_BOARD, -1.0, 3.6, -1.1, 1.0, 4.6, 1.1);
    G.col("#3a3028");
    box(G, WL.SHINGLE, -1.6, 3.6, -3.9, 1.6, 3.72, 3.9);
    box(G, WL.SHINGLE, -1.15, 4.6, -1.25, 1.15, 4.7, 1.25);
    G.col("#141210").mat(WL.PAINT);
    for (const s of [-1, 1])
      for (const z of [-2.2, 0.2, 2.2]) {
        const x = s * 1.46;
        G.quad(
          x,
          2.1,
          z + s * 0.45,
          x,
          2.1,
          z - s * 0.45,
          x,
          3.0,
          z - s * 0.45,
          x,
          3.0,
          z + s * 0.45,
          [0, 0, 1, 1],
        );
      }
    // end platforms with railings
    G.col("#2a2624");
    for (const e of [-1, 1]) {
      box(G, WL.IRON, -1.3, 1.12, e > 0 ? 3.6 : -4.7, 1.3, 1.2, e > 0 ? 4.7 : -3.6);
      box(G, WL.IRON, -1.3, 2.1, e * 4.6 - 0.03, 1.3, 2.16, e * 4.6 + 0.03);
      for (const x of [-1.25, 1.25])
        box(G, WL.IRON, x - 0.03, 1.2, e * 4.6 - 0.03, x + 0.03, 2.1, e * 4.6 + 0.03);
    }
    wheels = truckWheels(len);
  } else {
    // the Iron Marshal's car: riveted iron plate, gun slits, a gilded star
    const len = 12;
    frame(G, len);
    G.col("#5a5c62");
    box(G, WL.IRON, -1.52, 1.12, -len / 2, 1.52, 4.1, len / 2);
    G.col("#3a3c42");
    box(G, WL.IRON, -1.6, 4.1, -len / 2 - 0.1, 1.6, 4.45, len / 2 + 0.1);
    G.col("#d8a830");
    for (const s of [-1, 1]) {
      const x = s * 1.54;
      for (let i = 0; i < 5; i++) {
        const a0 = Math.PI / 2 + (i / 5) * Math.PI * 2;
        const a1 = Math.PI / 2 + ((i + 0.5) / 5) * Math.PI * 2;
        const a2 = Math.PI / 2 + ((i + 1) / 5) * Math.PI * 2;
        const R = 0.9;
        const r = 0.38;
        const p = (a: number, rr: number) =>
          [2.6 + Math.sin(a) * rr, Math.cos(a) * rr * s] as const;
        const [y0, z0] = p(a0, R);
        const [y1, z1] = p(a1, r);
        const [y2, z2] = p(a2, R);
        G.v(x + s * 0.01, 2.6, 0, s, 0, 0);
        G.v(x + s * 0.01, y0, z0, s, 0, 0);
        G.v(x + s * 0.01, y1, z1, s, 0, 0);
        G.v(x + s * 0.01, 2.6, 0, s, 0, 0);
        G.v(x + s * 0.01, y1, z1, s, 0, 0);
        G.v(x + s * 0.01, y2, z2, s, 0, 0);
      }
    }
    wheels = truckWheels(len);
  }
  return { geo: G.build(), wheels };
}

// ---------------------------------------------------------------------------------------

const TINTS: Record<CarKind, string[]> = {
  loco: ["#ffffff"],
  tender: ["#ffffff"],
  box: ["#9a3c28", "#8a3424", "#b8883c", "#7a4a30", "#a0502e", "#6a5a4a"],
  flat: ["#ffffff"],
  tank: ["#2a2828", "#3a3a3a", "#c8c4bc", "#2a2828"],
  stock: ["#b8963c", "#9a3c28", "#8a8070"],
  gondola: ["#6a4a34", "#4a4440", "#7a3a28"],
  caboose: ["#a8321e", "#9a2a1a"],
  armored: ["#ffffff"],
};

function puffMaterial() {
  const mat = new THREE.MeshBasicMaterial({
    map: puffTexture(),
    transparent: true,
    depthWrite: false,
    color: "#ffffff",
  });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute float aAlpha;\nvarying float vAlpha;",
      )
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvAlpha = aAlpha;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vAlpha;")
      .replace("#include <map_fragment>", "#include <map_fragment>\ndiffuseColor.a *= vAlpha;");
  };
  mat.customProgramCacheKey = () => "western-puff-v1";
  return mat;
}

export function WesternTrain({
  layout,
  seed,
  time,
  link,
}: {
  layout: WesternLayout;
  seed: number;
  time: TimeOfDay;
  link: React.MutableRefObject<TrafficLink>;
}) {
  const { camera } = useThree();
  const look = WESTERN_LOOK[time];
  const timeRef = useRef(time);
  timeRef.current = time;

  // the line: where the portals are, where the boss train stops, the timetable seed
  useEffect(() => {
    trainLine.north = layout.portals.n;
    trainLine.south = layout.portals.s;
    trainLine.stop = -20;
    trainLine.seed = seed;
    trainClock.t = 0;
    trainClock.bossAt = -1;
    trainClock.bossFrom = -1;
  }, [layout, seed]);

  const geos = useMemo(() => {
    const out = {} as Record<CarKind, { geo: THREE.BufferGeometry; wheels: [number, number][] }>;
    for (const k of KINDS) out[k] = carGeo(k);
    return out;
  }, []);
  const wheelGeo = useMemo(() => {
    const g = new THREE.CylinderGeometry(1, 1, 1, 14);
    g.rotateZ(Math.PI / 2);
    return g;
  }, []);
  const nightK = useMemo(() => ({ value: 0 }), []);
  const mats = useMemo(
    () => ({
      car: facadeMaterial(nightK),
      wheel: new THREE.MeshLambertMaterial({ color: "#ffffff" }),
      puff: puffMaterial(),
      lamp: new THREE.MeshBasicMaterial({
        map: softGlow(),
        color: "#ffe0a0",
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
      beam: new THREE.MeshBasicMaterial({
        color: "#fff0c8",
        transparent: true,
        opacity: 0.07,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
      pool: new THREE.MeshBasicMaterial({
        map: softGlow(),
        color: "#ffe0a0",
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    }),
    [nightK],
  );
  const puffGeo = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1);
    g.setAttribute("aAlpha", new THREE.InstancedBufferAttribute(new Float32Array(PUFFS), 1));
    return g;
  }, []);
  const lampGeo = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const beamGeo = useMemo(() => {
    const g = new THREE.ConeGeometry(2.4, 26, 14, 1, true);
    g.translate(0, -13, 0);
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);
  const poolGeo = useMemo(() => {
    const g = new THREE.PlaneGeometry(4.5, 12);
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);
  useEffect(
    () => () => {
      Object.values(geos).forEach((g) => g.geo.dispose());
      [wheelGeo, puffGeo, lampGeo, beamGeo, poolGeo].forEach((g) => g.dispose());
      Object.values(mats).forEach((m) => m.dispose());
    },
    [geos, wheelGeo, puffGeo, lampGeo, beamGeo, poolGeo, mats],
  );
  useEffect(() => {
    nightK.value = look.windows * 0.6;
    mats.lamp.color.set("#ffe0a0").multiplyScalar(time === "night" ? 1.6 : 0.7);
  }, [nightK, look, mats, time]);

  const meshRefs = useRef<Record<string, THREE.InstancedMesh | null>>({});
  const wheelRef = useRef<THREE.InstancedMesh>(null);
  const puffRef = useRef<THREE.InstancedMesh>(null);
  const lampRefs = useRef<(THREE.Group | null)[]>([]);

  // puffs of smoke: world-space particles in a ring buffer
  const puffs = useRef(
    Array.from({ length: PUFFS }, () => ({
      x: 0,
      y: -99,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      age: 99,
      life: 1,
      s: 1,
    })),
  );
  const puffAt = useRef(0);
  const puffT = useRef(0);

  // guests follow the host's clock
  const hostClock = useRef<{ t: number; at: number } | null>(null);
  const acc = useRef(0);
  useEffect(() => {
    const L = link.current;
    // (the riders' state rides along after the train's three numbers, Riders.tsx)
    L.encode = () => [q100(trainClock.t), q100(trainClock.bossAt), q100(trainClock.bossFrom), ...(riderSync.encode?.() ?? [])];
    L.decode = (a) => {
      if (!Array.isArray(a) || a.length < 3) return;
      hostClock.current = { t: a[0]! / 100, at: performance.now() };
      trainClock.bossAt = a[1]! / 100;
      trainClock.bossFrom = a[2]! / 100;
      if (a.length > 3) riderSync.decode?.(a.slice(3));
    };
    return () => {
      L.encode = null;
      L.decode = null;
    };
  }, [link]);
  useEffect(
    () => () => {
      liveCars.length = 0;
    },
    [],
  );

  const voice = useRef<ReturnType<typeof trainVoice>>(null);
  useEffect(
    () => () => {
      voice.current?.stop();
      voice.current = null;
    },
    [],
  );
  const hitCd = useRef(0);
  const enemyHit = useRef(new Map<number, number>());
  const lastT = useRef(0);

  useEffect(() => {
    const debug =
      import.meta.env.DEV || new URLSearchParams(window.location.search).get("debug") === "1";
    if (debug)
      (window as unknown as { __rsTrain?: unknown }).__rsTrain = {
        trainClock,
        trainLine,
        trainsAt,
        frontOf,
        carCentres,
        hitsTraffic,
        log: debugLog,
      };
  }, []);

  useFrame((state, raw) => {
    const dt = Math.min(raw, 0.05);
    syncEnv(mats.car);
    const L = link.current;
    const guest = L.role === "guest";
    const now = performance.now();
    // ---- the clock: fixed steps on the host, the host's clock on guests ----
    if (guest) {
      if (hostClock.current)
        trainClock.t = hostClock.current.t + (now - hostClock.current.at) / 1000;
    } else {
      acc.current += dt;
      let steps = 0;
      while (acc.current >= 1 / 60 && steps < 8) {
        acc.current -= 1 / 60;
        trainClock.t += 1 / 60;
        steps++;
      }
      if (steps === 8) acc.current = 0;
    }
    const t = trainClock.t;
    const cam = camera.position;
    const runs = trainsAt(t);

    // ---- sounds: whistles as each run nears the portal, the rumble of the nearest train ----
    if (!voice.current) voice.current = trainVoice();
    const yawRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    let nearest = Infinity;
    let nearestLoco = Infinity;
    let nearSpeed = 0;
    let nearPan = 0;
    for (const run of runs) {
      const f = frontOf(run, t);
      for (const w of whistles(run)) {
        if (w > lastT.current && w <= t) {
          const dz = f - cam.z;
          const dx = RAIL_X - cam.x;
          const d = Math.hypot(dx, dz);
          whistle(d, (dx * yawRight.x + dz * yawRight.z) / Math.max(1, d), w !== whistles(run)[2]);
          if (debugLog.length < 200)
            debugLog.push({ t, kind: "whistle", d: Math.round(d), arrive: run.arrive, k: run.k });
        }
      }
      const tail = f - run.dir * run.length;
      const zc = Math.max(Math.min(cam.z, Math.max(f, tail)), Math.min(f, tail));
      const d = Math.hypot(RAIL_X - cam.x, zc - cam.z);
      if (d < nearest) {
        nearest = d;
        nearestLoco = Math.hypot(RAIL_X - cam.x, f - cam.z);
        nearSpeed = speedOf(run, t);
        nearPan = ((RAIL_X - cam.x) * yawRight.x + (zc - cam.z) * yawRight.z) / Math.max(1, d);
      }
    }
    lastT.current = t;
    voice.current?.update(nearest, nearestLoco, nearSpeed, nearPan);

    // ---- place every car ----
    const counts: Record<string, number> = {};
    for (const k of KINDS) counts[k] = 0;
    let wheelN = 0;
    liveCars.length = 0;
    const lamps: { x: number; y: number; z: number; dir: number }[] = [];
    const px = cam.x;
    const pz = cam.z;
    const half = layout.half + 40;
    hitCd.current -= dt;
    for (const run of runs) {
      const zs = carCentres(run, t);
      const f = frontOf(run, t);
      const sp = speedOf(run, t);
      const roll = (f - (run.dir > 0 ? trainLine.north : trainLine.south)) * run.dir;
      run.cars.forEach((car, ci) => {
        const zc = zs[ci]!;
        if (Math.abs(zc) > half) return;
        const mesh = meshRefs.current[car.kind];
        if (!mesh || counts[car.kind]! >= MAX_PER_KIND) return;
        const y0 = layout.railY(zc) + 0.45;
        const slope = (layout.railY(zc + 2) - layout.railY(zc - 2)) / 4;
        const pitch = -Math.atan(slope * run.dir);
        _q.setFromAxisAngle(_y, run.dir > 0 ? 0 : Math.PI);
        _q2.setFromAxisAngle(_x, pitch);
        _q.multiply(_q2);
        _car.compose(_p.set(RAIL_X, y0, zc), _q, _s.set(1, 1, 1));
        const i = counts[car.kind]!++;
        mesh.setMatrixAt(i, _car);
        const tints = TINTS[car.kind];
        mesh.setColorAt(i, _c.set(tints[Math.floor(car.tint * tints.length) % tints.length]!));
        // wheels
        const wm = wheelRef.current;
        if (wm) {
          for (const [wz, r] of geos[car.kind].wheels) {
            for (const s of [-1, 1]) {
              if (wheelN >= MAX_WHEELS) break;
              const spin = roll / r;
              _q2.setFromAxisAngle(_x, spin * run.dir);
              _m.compose(_p.set(s * 0.72, r, wz), _q2, _s.set(0.14, r, r));
              _m.premultiply(_car);
              wm.setMatrixAt(wheelN, _m);
              wm.setColorAt(wheelN, _c.set(car.kind === "loco" && r > 0.8 ? "#8a2a1c" : "#2a2624"));
              wheelN++;
            }
          }
        }
        // the loco: smoke, headlamp
        if (car.kind === "loco") {
          const lz = zc + run.dir * 4.4;
          if (sp > 0.2 || Math.random() < 0.3) {
            puffT.current -= dt * (sp > 1 ? 12 : 4);
            while (puffT.current < 0) {
              puffT.current += 1;
              const pf = puffs.current[puffAt.current++ % PUFFS]!;
              pf.x = RAIL_X + (Math.random() - 0.5) * 0.3;
              pf.y = y0 + 5.2;
              pf.z = lz;
              pf.vx = (Math.random() - 0.5) * 0.6;
              pf.vy = 2.4 + Math.random() * 1.2;
              pf.vz = -run.dir * sp * 0.15 + (Math.random() - 0.5) * 0.5;
              pf.age = 0;
              pf.life = 3.2 + Math.random() * 1.6;
              pf.s = 1.1 + Math.random() * 0.5;
            }
          }
          lamps.push({ x: RAIL_X, y: y0 + 3.55, z: zc + run.dir * 5.35, dir: run.dir });
        }
        // bullets stop on the cars (not up on the trestle, where they pass underneath)
        const onTrestle = y0 > 1.6;
        if (!onTrestle)
          liveCars.push({
            x: RAIL_X,
            z: zc,
            sin: 0,
            cos: run.dir,
            hl: car.len / 2,
            hw: car.w / 2,
            h: y0 + car.h,
          });
        if (onTrestle) return;
        if (sp < 0.05) {
          // standing still (the boss train at the platform): a wall, not a ghost
          if (L.active && hitCd.current <= 0 && Math.abs(pz - zc) < car.len / 2 + 0.45 && Math.abs(px - RAIL_X) < car.w / 2 + 0.45) {
            L.hitPlayer(0, (px >= RAIL_X ? 1 : -1) * 7, 0, 0);
            hitCd.current = 0.15;
          }
          return;
        }
        // ---- bumping the local player: hard, and it never stops ----
        const hl = car.len / 2 + 0.55;
        const hw = car.w / 2 + 0.5;
        if (
          L.active &&
          hitCd.current <= 0 &&
          Math.abs(pz - zc) < hl &&
          Math.abs(px - RAIL_X) < hw
        ) {
          const side = px >= RAIL_X ? 1 : -1;
          const k = Math.min(1, sp / TRAIN_SPEED_HINT);
          L.hitPlayer(
            sp > 3 ? 3 : 0,
            side * (12 + 16 * k),
            run.dir * (5 + 13 * k),
            Math.min(1, 0.3 + k),
          );
          hitCd.current = 0.8;
          if (debugLog.length < 200) debugLog.push({ t, kind: "bump", k: run.k });
        }
        // ---- small enemies are thrown clear and broken, big ones knocked aside (host) ----
        if (L.isHost && L.hurtEnemy) {
          L.enemies.forEach((e, idx) => {
            if (!e.alive) return;
            const r = L.radiusOf(e);
            if (Math.abs(e.z - zc) > car.len / 2 + r || Math.abs(e.x - RAIL_X) > car.w / 2 + r)
              return;
            const last = enemyHit.current.get(idx) ?? -9;
            if (t - last < 0.9) return;
            enemyHit.current.set(idx, t);
            const side = e.x >= RAIL_X ? 1 : -1;
            const big = L.isBig(e);
            L.hurtEnemy!(idx, big ? 6 : 60, side * 1.4, run.dir * 0.6);
          });
        }
      });
    }
    for (const k of KINDS) {
      const m = meshRefs.current[k];
      if (!m) continue;
      m.count = counts[k]!;
      m.visible = counts[k]! > 0;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    const wm = wheelRef.current;
    if (wm) {
      wm.count = wheelN;
      wm.visible = wheelN > 0;
      wm.instanceMatrix.needsUpdate = true;
      if (wm.instanceColor) wm.instanceColor.needsUpdate = true;
    }
    // ---- smoke ----
    const pm = puffRef.current;
    if (pm) {
      const alpha = puffGeo.getAttribute("aAlpha") as THREE.InstancedBufferAttribute;
      let alive = 0;
      const night = timeRef.current === "night";
      if (pm.material instanceof THREE.MeshBasicMaterial)
        pm.material.color.set(night ? "#5a5a66" : "#c8a890");
      for (let i = 0; i < PUFFS; i++) {
        const pf = puffs.current[i]!;
        pf.age += dt;
        if (pf.age > pf.life) {
          _m.makeScale(0, 0, 0);
          pm.setMatrixAt(i, _m);
          alpha.setX(i, 0);
          continue;
        }
        alive++;
        pf.x += pf.vx * dt;
        pf.y += pf.vy * dt;
        pf.z += pf.vz * dt;
        pf.vy *= 1 - dt * 0.35;
        const k = pf.age / pf.life;
        const size = pf.s * (1 + k * 2.4);
        _m.compose(_p.set(pf.x, pf.y, pf.z), camera.quaternion, _s.set(size, size, size));
        pm.setMatrixAt(i, _m);
        alpha.setX(i, 0.7 * (1 - k) * Math.min(1, pf.age * 6));
      }
      pm.visible = alive > 0;
      pm.instanceMatrix.needsUpdate = true;
      alpha.needsUpdate = true;
    }
    // ---- headlamps ----
    lampRefs.current.forEach((g, i) => {
      if (!g) return;
      const l = lamps[i];
      g.visible = !!l;
      if (!l) return;
      g.position.set(l.x, l.y, l.z);
      g.rotation.set(0, l.dir > 0 ? 0 : Math.PI, 0);
      const disc = g.children[0];
      if (disc) disc.quaternion.copy(camera.quaternion).premultiply(_q.copy(g.quaternion).invert());
      const nightOn = timeRef.current === "night";
      if (g.children[1]) g.children[1].visible = nightOn;
      if (g.children[2]) g.children[2].visible = nightOn;
    });
  });

  return (
    <group>
      {KINDS.map((k) => (
        <instancedMesh
          key={k}
          ref={(m) => {
            meshRefs.current[k] = m;
          }}
          args={[geos[k].geo, mats.car, MAX_PER_KIND]}
          castShadow
          receiveShadow
          frustumCulled={false}
          visible={false}
        />
      ))}
      <instancedMesh
        ref={wheelRef}
        args={[wheelGeo, mats.wheel, MAX_WHEELS]}
        frustumCulled={false}
        visible={false}
      />
      <instancedMesh
        ref={puffRef}
        args={[puffGeo, mats.puff, PUFFS]}
        frustumCulled={false}
        renderOrder={3}
      />
      {[0, 1].map((i) => (
        <group
          key={i}
          ref={(g) => {
            lampRefs.current[i] = g;
          }}
          visible={false}
        >
          <mesh geometry={lampGeo} material={mats.lamp} scale={1.8} renderOrder={4} />
          <mesh geometry={beamGeo} material={mats.beam} />
          <mesh geometry={poolGeo} material={mats.pool} position={[0, -3.5, 9]} renderOrder={2} />
        </group>
      ))}
    </group>
  );
}
const TRAIN_SPEED_HINT = 17;
/** test log (debug builds): whistles and bumps, with the train clock and distances */
const debugLog: { t: number; kind: string; d?: number; arrive?: number; k?: number }[] = [];
