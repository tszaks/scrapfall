// Dry Gulch's horse-drawn vehicles on the shared vehicle API (art/cars.ts): a Concord
// stagecoach and a buckboard wagon, built with the art kit's Model and registered as vehicle
// models, so they draw through a CarBatch like the city's cars (one InstancedMesh per type
// and LOD). Their wooden wheels are a separate spinning InstancedMesh (Riders.tsx), since
// the batch's shared wheel is a car tyre.
//
// Car space: +z forward (the tongue points at the team), y up, origin on the ground under
// the body's centre.
import * as THREE from "three";

import { SURF, Model, artMaterial, type Surf } from "../art/kit";
import { registerVehicleModel, type WheelSpot } from "../art/cars";
import type { Vehicle, VehicleType } from "../vehicles";

const PI = Math.PI;
const PAINT: Surf = [0.5, 0.05, 0, 1]; // coach enamel, tinted per vehicle
const GEAR = "#c89a3a"; // the running gear's yellow
const IRON = "#26221e";
const LEATHER = "#3a2418";
const WOOD = "#7a5a3a";
const TRIM = "#d8b050";

export type HorseKind = "stagecoach" | "buckboard";

/** wheel spots (car space) per kind: x, y (= r), z, r, width */
export const COACH_WHEELS: Record<HorseKind, WheelSpot[]> = {
  stagecoach: [
    { x: 0.92, y: 0.62, z: 1.35, r: 0.62, w: 0.1 },
    { x: -0.92, y: 0.62, z: 1.35, r: 0.62, w: 0.1 },
    { x: 0.92, y: 0.85, z: -1.25, r: 0.85, w: 0.1 },
    { x: -0.92, y: 0.85, z: -1.25, r: 0.85, w: 0.1 },
  ],
  buckboard: [
    { x: 0.78, y: 0.52, z: 1.05, r: 0.52, w: 0.08 },
    { x: -0.78, y: 0.52, z: 1.05, r: 0.52, w: 0.08 },
    { x: 0.78, y: 0.6, z: -1.05, r: 0.6, w: 0.08 },
    { x: -0.78, y: 0.6, z: -1.05, r: 0.6, w: 0.08 },
  ],
};
/** body length / width the geometry is built at */
const SPEC: Record<HorseKind, { len: number; wid: number }> = {
  stagecoach: { len: 3.9, wid: 1.9 },
  buckboard: { len: 3.1, wid: 1.65 },
};

/** a side profile (z, y) extruded across x (width w), centred on x */
function side(m: Model, pts: [number, number][], w: number, color: THREE.ColorRepresentation, surf: Surf, bevel = 0.03) {
  // extrude runs along local z; turn it so it runs along car x and the outline's x is car z
  m.extrude(pts, w, [0, 0, 0], color, surf, { rot: [0, -PI / 2, 0], bevel, curve: 8 });
}

/** a wooden wheel as seen from far (a flat disc with a dark hub), for the far LOD */
function farWheels(m: Model, k: HorseKind) {
  for (const w of COACH_WHEELS[k]) {
    m.tubeX(w.r, w.w, [w.x, w.y, w.z], WOOD, SURF.wood, { seg: 10 });
  }
}

function stagecoach(far: boolean) {
  const m = new Model();
  // the egg-shaped Concord body: a rounded belly, flared at the ends
  const body: [number, number][] = [
    [-1.2, 1.42],
    [-1.12, 1.16],
    [-0.8, 1.02],
    [0, 0.98],
    [0.8, 1.02],
    [1.08, 1.16],
    [1.14, 1.42],
    [1.06, 2.38],
    [-1.12, 2.38],
  ];
  side(m, body, 1.5, "#ffffff", PAINT);
  // gold striping round the belt and the belly
  for (const [y, zz] of [
    [1.66, 1.1],
    [1.22, 1.08],
  ] as const)
    m.both((s) => m.box(0.02, 0.035, zz * 2 - 0.05, [s * 0.76, y, -0.03], TRIM, SURF.brass));
  // windows: dark openings with leather curtains rolled at the top; a door with its window
  m.both((s) => {
    for (const z of [-0.72, 0.62]) {
      m.box(0.02, 0.5, 0.52, [s * 0.755, 2.0, z], "#141210", SURF.polymer);
      m.tubeZ(0.045, 0.54, [s * 0.77, 2.27, z], LEATHER, SURF.leather, { seg: 6 });
    }
    m.box(0.025, 0.95, 0.66, [s * 0.76, 1.78, -0.05], "#ffffff", PAINT, { bevel: 0.015 });
    m.box(0.02, 0.4, 0.44, [s * 0.775, 2.04, -0.05], "#141210", SURF.polymer);
    m.box(0.03, 0.03, 0.12, [s * 0.79, 1.72, 0.18], TRIM, SURF.brass, { lod: 1 }); // handle
  });
  // front and back panels' window
  m.box(1.0, 0.36, 0.02, [0, 2.05, 1.11], "#141210", SURF.polymer);
  // roof: a slight crown, the rail and the luggage
  m.box(1.62, 0.07, 2.4, [0, 2.42, -0.03], "#2e2622", SURF.leather, { bevel: 0.02 });
  m.both((s) => {
    m.box(0.035, 0.035, 2.2, [s * 0.76, 2.66, -0.05], IRON, SURF.darkSteel);
    if (!far) for (const z of [-1.0, -0.35, 0.3, 0.95]) m.box(0.025, 0.22, 0.025, [s * 0.76, 2.55, z], IRON, SURF.darkSteel, { lod: 1 });
  });
  m.box(0.6, 0.34, 0.45, [-0.3, 2.62, -0.55], "#5a3a22", SURF.leather, { bevel: 0.03 }); // trunk
  m.box(0.5, 0.26, 0.4, [0.3, 2.58, -0.7], "#6a4a2a", SURF.wood, { bevel: 0.03 });
  m.box(1.1, 0.24, 0.7, [0, 2.57, 0.3], "#b8a078", SURF.leather, { bevel: 0.08 }); // canvas bundle
  // the rear leather boot
  side(
    m,
    [
      [-1.18, 1.3],
      [-1.62, 1.22],
      [-1.72, 1.95],
      [-1.14, 2.1],
    ],
    1.3,
    LEATHER,
    SURF.leather,
    0.02,
  );
  // the driver's box: seat, back rail, the sloping footboard and a dash
  m.box(1.3, 0.14, 0.5, [0, 2.45, 1.38], LEATHER, SURF.leather, { bevel: 0.04 });
  m.box(1.3, 0.34, 0.06, [0, 2.7, 1.12], "#ffffff", PAINT, { bevel: 0.02 });
  m.box(1.2, 0.05, 0.7, [0, 2.1, 1.86], WOOD, SURF.wood, { rot: [0.5, 0, 0] });
  m.box(1.2, 0.32, 0.04, [0, 2.2, 2.2], "#ffffff", PAINT, { bevel: 0.01 });
  m.both((s) => {
    m.box(0.05, 0.6, 0.05, [s * 0.6, 2.05, 1.62], IRON, SURF.darkSteel);
    // coach lamps beside the box
    m.box(0.13, 0.2, 0.13, [s * 0.74, 2.3, 1.2], "#1a1612", SURF.darkSteel, { bevel: 0.01 });
    m.box(0.09, 0.12, 0.02, [s * 0.74, 2.3, 1.27], "#f0d890", SURF.lens);
    m.cone(0.08, 0.08, [s * 0.74, 2.44, 1.2], "#1a1612", SURF.darkSteel, { seg: 6 });
  });
  // running gear: the thoroughbraces (leather straps the body swings on), perch, axles
  m.both((s) => {
    if (!far)
      m.cable(
        [
          [s * 0.62, 1.2, -1.28],
          [s * 0.62, 0.98, -0.6],
          [s * 0.62, 0.95, 0.4],
          [s * 0.62, 1.2, 1.12],
        ],
        0.045,
        LEATHER,
        SURF.leather,
      );
    m.box(0.08, 0.36, 0.08, [s * 0.62, 1.05, -1.28], GEAR, SURF.paint);
    m.box(0.08, 0.3, 0.08, [s * 0.62, 1.0, 1.12], GEAR, SURF.paint);
  });
  m.box(0.14, 0.12, 2.9, [0, 0.8, 0.05], GEAR, SURF.paint, { bevel: 0.02 }); // perch
  m.tubeX(0.05, 1.84, [0, 0.62, 1.35], IRON, SURF.darkSteel, { seg: 6 });
  m.tubeX(0.05, 1.84, [0, 0.85, -1.25], IRON, SURF.darkSteel, { seg: 6 });
  m.box(1.5, 0.12, 0.16, [0, 0.92, -1.25], GEAR, SURF.paint, { bevel: 0.02 }); // rear bolster
  m.box(1.3, 0.12, 0.16, [0, 0.78, 1.35], GEAR, SURF.paint, { bevel: 0.02 });
  // the tongue out to the team, and its doubletree
  m.box(0.1, 0.1, 3.2, [0, 0.68, 3.1], WOOD, SURF.wood, { rot: [0.04, 0, 0] });
  m.box(1.4, 0.07, 0.07, [0, 0.66, 2.1], WOOD, SURF.wood);
  if (far) farWheels(m, "stagecoach");
  return m;
}

function buckboard(far: boolean) {
  const m = new Model();
  // the bed: floor boards, painted sides with a darker rub rail
  m.box(1.3, 0.06, 2.6, [0, 0.98, 0], WOOD, SURF.wood);
  m.both((s) => {
    m.box(0.05, 0.3, 2.6, [s * 0.66, 1.15, 0], "#ffffff", PAINT, { bevel: 0.01 });
    m.box(0.06, 0.05, 2.62, [s * 0.67, 1.3, 0], "#3a2a1e", SURF.wood);
    if (!far) for (const z of [-1.0, -0.2, 0.6]) m.box(0.07, 0.3, 0.05, [s * 0.68, 1.15, z], IRON, SURF.darkSteel, { lod: 1 });
  });
  m.box(1.3, 0.3, 0.05, [0, 1.15, -1.3], "#ffffff", PAINT, { bevel: 0.01 }); // tailgate
  m.box(1.3, 0.4, 0.05, [0, 1.2, 1.3], "#ffffff", PAINT, { bevel: 0.01 }); // front board
  // the spring seat up front, where the driver sits (seat top at 1.43)
  m.box(1.2, 0.1, 0.44, [0, 1.38, 1.1], LEATHER, SURF.leather, { bevel: 0.03 });
  m.box(1.2, 0.3, 0.05, [0, 1.6, 0.87], WOOD, SURF.wood, { bevel: 0.01 });
  m.both((s) => {
    m.box(0.05, 0.3, 0.05, [s * 0.5, 1.18, 1.1], IRON, SURF.darkSteel);
    m.box(0.04, 0.2, 0.36, [s * 0.6, 1.5, 1.07], IRON, SURF.darkSteel); // armrest
  });
  // a load: sacks, a crate and a barrel
  m.box(0.55, 0.45, 0.55, [-0.28, 1.24, -0.7], "#8a6a44", SURF.wood, { bevel: 0.02 });
  m.cyl(0.24, 0.62, [0.33, 1.32, -0.75], "#6a4a2a", SURF.wood, { rb: 0.22, seg: 10 });
  m.sphere(0.26, [0.2, 1.16, 0.05], "#d8c8a0", SURF.leather, { s: [1.2, 0.6, 0.9], low: true });
  m.sphere(0.25, [-0.25, 1.15, 0.15], "#c8b488", SURF.leather, { s: [1.1, 0.6, 1], low: true });
  // running gear
  m.box(0.1, 0.1, 2.4, [0, 0.82, 0], GEAR, SURF.paint);
  m.tubeX(0.045, 1.56, [0, 0.52, 1.05], IRON, SURF.darkSteel, { seg: 6 });
  m.tubeX(0.045, 1.56, [0, 0.6, -1.05], IRON, SURF.darkSteel, { seg: 6 });
  m.box(1.2, 0.12, 0.14, [0, 0.9, -1.05], GEAR, SURF.paint);
  m.box(1.1, 0.12, 0.14, [0, 0.72, 1.05], GEAR, SURF.paint);
  m.box(0.09, 0.09, 2.6, [0, 0.62, 2.5], WOOD, SURF.wood, { rot: [0.05, 0, 0] });
  m.box(1.2, 0.06, 0.06, [0, 0.62, 1.7], WOOD, SURF.wood);
  if (far) farWheels(m, "buckboard");
  return m;
}

/**
 * A wooden wheel of radius 1 and width 1, axle along x (scaled per wheel: x by width, y/z by
 * radius): hub, twelve spokes, the felloe and its iron tyre.
 */
export function woodWheelGeometry() {
  const m = new Model();
  m.tubeX(0.16, 1.6, [0, 0, 0], "#3a2a1e", SURF.wood, { seg: 10 });
  m.tubeX(0.2, 0.9, [0, 0, 0], IRON, SURF.darkSteel, { seg: 10 });
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * PI * 2;
    m.box(0.45, 0.06, 0.8, [0, Math.sin(a) * 0.52, Math.cos(a) * 0.52], WOOD, SURF.wood, { rot: [-a, 0, 0] });
  }
  m.torus(0.9, 0.08, [0, 0, 0], WOOD, SURF.wood, { rot: [0, PI / 2, 0], seg: 20 });
  m.torus(0.985, 0.03, [0, 0, 0], IRON, SURF.darkSteel, { rot: [0, PI / 2, 0], seg: 20 });
  return m.build();
}

let done = false;
/** register both models (once) */
export function registerCoaches() {
  if (done) return;
  done = true;
  const kinds: [HorseKind, (far: boolean) => Model][] = [
    ["stagecoach", stagecoach],
    ["buckboard", buckboard],
  ];
  for (const [k, fn] of kinds) {
    registerVehicleModel(k, {
      near: fn(false).build(),
      far: fn(true).build({ lod: 1 }),
      spec: SPEC[k],
      wheels: () => [], // drawn by Riders.tsx's spinning wooden wheels
      lamps: () =>
        k === "stagecoach"
          ? [1, -1].map((s) => ({ kind: "head" as const, x: s * 0.74, y: 2.3, z: 1.29, sx: 0.08, sy: 0.1, sz: 0.02, color: 0xffd890 }))
          : [],
    });
  }
}

/** a Vehicle for the batch (type cast: the batch only needs the registry key) */
export function horseVehicle(k: HorseKind, color: number): Vehicle {
  return { type: k as unknown as VehicleType, len: SPEC[k].len, wid: SPEC[k].wid, wheel: 0.6, color, extras: 0, mass: 900 };
}

/** the material the spinning wheels use (plain art material, no paint) */
export const wheelMaterial = () => artMaterial({ wear: 0.3, scale: 2 });
