// Scrapfall vehicles: detailed car models and the instanced batch that draws them.
//
// SHARED VEHICLE-MODEL API (traffic, parked cars, and any other wheeled thing):
//
//   const batch = new CarBatch(vehicles);      // one slot per vehicle, fixed for its life
//   scene.add(batch.group);
//   batch.place(i, x, y, z, yaw, { lit, bar, roll });   // every frame for movers, once for parked
//   batch.commit(camera);                      // once per frame: cull, LOD buckets, upload
//   batch.dispose();
//
// Every vehicle type is a `VehicleModel` (see `vehicleModel()`): a near body (paint-masked
// vertex-PBR geometry: body colour comes from the per-car instance colour), an optional
// near glass shell (drawn transparent over a modelled interior), a lean far body, wheel
// spots and a lamp layout. Each model draws as one InstancedMesh per LOD (one draw call per
// type), wheels share one InstancedMesh and lamps one more, so a street of 60 cars costs a
// couple of dozen draw calls. To add a new kind of vehicle (e.g. the Dry Gulch stagecoach),
// build its geometry with the kit's `Model` (paint parts use CAR_PAINT) and call
// `registerVehicleModel("stagecoach", { near, far, glass, wheels, lamps, spec })`; a
// `Vehicle` whose `type` is that key then draws through the same batch.
//
// `bakeCar()` writes the lean model into a city chunk (`Geo`) for the few static cars that
// live in chunk geometry (parking decks, blockade cruisers, the lifeguard pickup).
//
// Car space: +z forward, y up, origin on the ground under the car's centre; the collision
// footprint is still the Vehicle's len x wid x vehicleHeight (vehicles.ts), unchanged.
import * as THREE from "three";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import type { Geo } from "../cityGeo";
import { EXTRA_LADDER, EXTRA_ROOF_RACK, EXTRA_SPOILER, SPECS, type Vehicle } from "../vehicles";
import { Model, SURF, artFrame, artMaterial, type Surf } from "./kit";

const PI = Math.PI;
const PAINT = "#ffffff"; // paint parts: white x the car's instance colour
/** glossy paint, only lightly metallic so the per-car colour stays saturated */
const CAR_PAINT: Surf = [0.3, 0.12, 0, 1];
const GLASS = "#2a3844";
const TRIM = "#1b1c1f";
const CHROME = "#c9ccd0";
const RUBBER = "#141414";
const SEAT = "#4a4038";
const DASH = "#1e1f22";
const HEAD_LENS = "#c8ccc8";
const TAIL_LENS = "#6a1410";

/** a lamp in car space (a unit box scaled to sx/sy/sz), for the lamp InstancedMesh */
export type LampKind = "head" | "tail" | "sign" | "barR" | "barB";
export type Lamp = {
  kind: LampKind;
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  color: number;
};
/** a wheel in car space: centre, radius, tyre width */
export type WheelSpot = { x: number; y: number; z: number; r: number; w: number };

export type VehicleModel = {
  /** near body: paint-masked, interior included */
  near: THREE.BufferGeometry;
  /** near glass shell (transparent); optional */
  glass?: THREE.BufferGeometry | undefined;
  /** far body: wheels and glass baked in, no interior */
  far: THREE.BufferGeometry;
  /** the length / width the geometry was built at (cars are scaled from these) */
  spec: { len: number; wid: number };
  wheels: (v: Vehicle) => WheelSpot[];
  lamps: (v: Vehicle) => Lamp[];
};

// ---------------------------------------------------------------- geometry helpers
type P2 = [number, number];
/** extrude a side profile (car z, y) across the car's width, with a soft bevel and creased normals */
function profile(
  m: Model,
  shape: THREE.Shape,
  width: number,
  color: string,
  surf: Surf,
  o: { bevel?: number; x?: number; seg?: number; lod?: 0 | 1 } = {},
) {
  const bevel = o.bevel ?? 0;
  const g0 = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(1e-3, width - bevel * 2),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel * 0.6,
    bevelSegments: 2,
    curveSegments: o.seg ?? 8,
  });
  g0.translate(0, 0, -width / 2 + bevel);
  g0.deleteAttribute("uv");
  const g = toCreasedNormals(g0, 0.7);
  g0.dispose();
  // shape x -> car z, extrusion (local z) -> car x
  m.push([o.x ?? 0, 0, 0], [0, -PI / 2, 0]);
  m.geo(g, [0, 0, 0], [1, 1, 1], color, surf, o.lod !== undefined ? { lod: o.lod } : {});
  m.pop();
}
/** a straight bar between two points in the car's side plane (z, y) at lateral x */
function beam(
  m: Model,
  a: P2,
  b: P2,
  x: number,
  wx: number,
  th: number,
  color: string,
  surf: Surf,
  lod: 0 | 1 = 1,
) {
  const dz = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dz, dy);
  m.box(wx, th, len, [x, (a[1] + b[1]) / 2, (a[0] + b[0]) / 2], color, surf, {
    rot: [-Math.atan2(dy, dz), 0, 0],
    lod,
  });
}
function shapeOf(fn: (s: THREE.Shape) => void) {
  const s = new THREE.Shape();
  fn(s);
  return s;
}

// ---------------------------------------------------------------- the car frame
/** every key height / station of a car body, derived from its spec (car space, metres) */
type Frame = {
  L: number;
  W: number;
  F: number;
  R: number;
  y0: number;
  yb: number;
  yr: number;
  r: number;
  ra: number;
  wz: number;
  /** windshield base, roof front, roof back, rear glass base */
  zWs: number;
  zRf: number;
  zRb: number;
  zRw: number;
  hf: number;
  tail: number;
  Wg: number;
  hatch: boolean;
};
type Look = {
  hood: number;
  tail: number;
  rakeF: number;
  rakeR: number;
  hatch: boolean;
  tumble: number;
};
const LOOKS = {
  sedan: { hood: 0.07, tail: 0.05, rakeF: 0.75, rakeR: 0.6, hatch: false, tumble: 0.86 },
  compact: { hood: 0.08, tail: 0.03, rakeF: 0.7, rakeR: 0.2, hatch: true, tumble: 0.86 },
  suv: { hood: 0.05, tail: 0.02, rakeF: 0.6, rakeR: 0.15, hatch: true, tumble: 0.9 },
  sports: { hood: 0.1, tail: 0.02, rakeF: 0.85, rakeR: 0.95, hatch: false, tumble: 0.8 },
  pickup: { hood: 0.04, tail: 0, rakeF: 0.55, rakeR: 0.1, hatch: false, tumble: 0.88 },
} satisfies Record<string, Look>;
function frameOf(type: keyof typeof SPECS, look: Look): Frame {
  const s = SPECS[type];
  const L = s.len;
  const W = s.wid;
  const F = L / 2;
  const R = -L / 2;
  const y0 = s.ride;
  const yb = s.ride + s.body;
  const yr = yb + s.cabH;
  const r = s.wheel;
  const cz = s.cabOff;
  const zRf = cz + s.cabLen / 2 - look.rakeF * 0.35;
  const zWs = Math.min(F - 0.65, zRf + look.rakeF);
  const zRb = look.hatch ? R + 0.42 : cz - s.cabLen / 2 + look.rakeR * 0.35;
  const zRw = look.hatch ? R + 0.14 : Math.max(R + 0.45, zRb - look.rakeR);
  return {
    L,
    W,
    F,
    R,
    y0,
    yb,
    yr,
    r,
    ra: r + 0.07,
    wz: L / 2 - r - (type === "bus" ? 1.1 : 0.45),
    zWs,
    zRf,
    zRb,
    zRw,
    hf: yb - look.hood,
    tail: look.tail,
    Wg: W * look.tumble,
    hatch: look.hatch,
  };
}

/** the lower body outline: bumpers, hood, beltline, trunk, with both wheel arches cut out */
function lowerShape(f: Frame, opts: { beltTo?: number } = {}) {
  const { F, R, y0, yb, r, ra, wz, hf } = f;
  const a = Math.asin(Math.max(-0.99, Math.min(0.99, (y0 - r) / ra)));
  const dx = ra * Math.cos(a);
  const tailTop = yb - f.tail;
  return shapeOf((s) => {
    s.moveTo(R + 0.1, y0);
    s.lineTo(-wz - dx, y0);
    s.absarc(-wz, r, ra, PI - a, a, true);
    s.lineTo(wz - dx, y0);
    s.absarc(wz, r, ra, PI - a, a, true);
    s.lineTo(F - 0.12, y0);
    s.quadraticCurveTo(F, y0, F, y0 + 0.12);
    s.lineTo(F, hf - 0.12);
    s.quadraticCurveTo(F, hf, F - 0.16, hf);
    s.lineTo(f.zWs, yb);
    const back = opts.beltTo ?? (f.hatch ? R + 0.16 : f.zRw);
    s.lineTo(back, yb);
    if (!f.hatch && opts.beltTo === undefined) s.lineTo(R + 0.22, tailTop);
    s.quadraticCurveTo(R, tailTop, R, tailTop - 0.14);
    s.lineTo(R, y0 + 0.12);
    s.quadraticCurveTo(R, y0, R + 0.1, y0);
  });
}
/** the greenhouse outline: windshield, roof, rear glass */
function cabinShape(f: Frame) {
  const { yb, yr, zWs, zRf, zRb, zRw } = f;
  return shapeOf((s) => {
    s.moveTo(zWs, yb - 0.02);
    s.lineTo(zRf, yr - 0.05);
    s.quadraticCurveTo(zRf - 0.05, yr, zRf - 0.16, yr);
    s.lineTo(zRb + 0.16, yr);
    s.quadraticCurveTo(zRb + 0.04, yr, zRb, yr - 0.06);
    s.lineTo(zRw, yb - 0.02);
    s.lineTo(zWs, yb - 0.02);
  });
}

// ---------------------------------------------------------------- shared dressing
function wheelWells(m: Model, f: Frame, far: boolean) {
  if (far) return; // the far wheels are solid blocks that fill the arches
  // dark liners inside the arches (so you never see daylight through the body)
  for (const z of [f.wz, -f.wz]) {
    const g = new THREE.CylinderGeometry(
      f.ra - 0.03,
      f.ra - 0.03,
      f.W - 0.1,
      far ? 6 : 12,
      1,
      true,
      PI / 2 - 1.3,
      2.6,
    );
    m.geo(g, [0, f.r, z], [1, 1, 1], "#0c0c0d", SURF.rubber, { rot: [0, 0, PI / 2] });
  }
  // underbody pan between the axles
  m.box(f.W - 0.2, 0.06, f.L - 0.6, [0, f.y0 + 0.04, 0], "#101012", SURF.rubber);
}
/** far LOD wheels: one dark block per axle side (12 triangles), enough at 45 m+ */
function simpleWheels(m: Model, f: Frame, w = 0.26) {
  for (const z of [f.wz, -f.wz])
    for (const sx of [1, -1])
      m.box(w, f.r * 1.8, f.r * 1.8, [sx * (f.W / 2 - 0.13), f.r, z], RUBBER, SURF.tyre);
}
/** headlight / taillight housings and lenses (the lamp boxes light up in front of them) */
function lenses(m: Model, f: Frame, headY: number, tailY: number, tailZ = f.R, far = false) {
  if (far) {
    // one lens strip across each end
    m.box(f.W - 0.3, 0.11, 0.04, [0, headY, f.F + 0.01], HEAD_LENS, SURF.lens);
    m.box(f.W - 0.3, 0.13, 0.04, [0, tailY, tailZ - 0.005], TAIL_LENS, [0.2, 0.3, 0.25]);
    return;
  }
  m.both(() => {
    m.box(0.36, 0.15, 0.06, [f.W / 2 - 0.28, headY, f.F - 0.01], CHROME, SURF.chrome, {
      bevel: 0.02,
    });
    m.box(0.32, 0.11, 0.04, [f.W / 2 - 0.28, headY, f.F + 0.015], HEAD_LENS, SURF.lens);
    m.box(0.34, 0.14, 0.05, [f.W / 2 - 0.26, tailY, tailZ + 0.005], TAIL_LENS, [0.2, 0.3, 0.25]);
  });
}
function bumpers(m: Model, f: Frame, y: number, tailZ = f.R) {
  m.box(f.W * 1.0, 0.16, 0.14, [0, y, f.F + 0.02], TRIM, SURF.trim, { bevel: 0.04 });
  m.box(f.W * 1.0, 0.16, 0.14, [0, y, tailZ - 0.02], TRIM, SURF.trim, { bevel: 0.04 });
  // plates
  m.box(0.42, 0.12, 0.02, [0, y + 0.02, f.F + 0.095], "#e8e6de", SURF.paint, { lod: 1 });
  m.box(0.42, 0.12, 0.02, [0, y + 0.14, tailZ - 0.03], "#e8e6de", SURF.paint, { lod: 1 });
}
function grille(m: Model, f: Frame, y: number, h: number) {
  m.box(f.W * 0.42, h, 0.04, [0, y, f.F + 0.01], "#0e0f10", SURF.darkSteel, { bevel: 0.015 });
  for (let k = 0; k < 3; k++)
    m.box(f.W * 0.4, 0.012, 0.02, [0, y - h / 3 + (k * h) / 3, f.F + 0.035], CHROME, SURF.chrome, {
      lod: 1,
    });
}
function mirrors(m: Model, f: Frame) {
  m.both(() => {
    m.box(0.05, 0.03, 0.08, [f.W / 2 + 0.02, f.yb + 0.05, f.zWs - 0.12], TRIM, SURF.trim, {
      lod: 1,
    });
    m.box(0.12, 0.1, 0.07, [f.W / 2 + 0.08, f.yb + 0.08, f.zWs - 0.14], PAINT, CAR_PAINT, {
      bevel: 0.02,
      lod: 1,
    });
  });
}
function doorSeams(m: Model, f: Frame, zs: number[], handles = true) {
  m.both(() => {
    for (const z of zs)
      m.box(
        0.006,
        f.yb - f.y0 - 0.14,
        0.012,
        [f.W / 2 + 0.02, (f.y0 + f.yb) / 2 + 0.02, z],
        "#0a0a0b",
        SURF.rubber,
        { lod: 1 },
      );
    if (handles)
      for (let i = 0; i + 1 < zs.length; i++)
        m.box(
          0.02,
          0.025,
          0.12,
          [f.W / 2 + 0.025, f.yb - 0.1, zs[i + 1]! + 0.12],
          CHROME,
          SURF.chrome,
          { lod: 1 },
        );
    // rubbing strip
    const run = 2 * (f.wz - f.ra) - 0.12;
    if (run > 0.3)
      m.box(0.02, 0.04, run, [f.W / 2 + 0.02, f.y0 + 0.2, 0], TRIM, SURF.trim, { lod: 1 });
  });
}
/** pillars, roof skin, belt chrome and a seen-through interior over a glass greenhouse */
function cabin(
  m: Model,
  f: Frame,
  far: boolean,
  opts: { bPillar?: number[] | undefined; rows?: number } = {},
) {
  const { yb, yr, zWs, zRf, zRb, zRw, Wg } = f;
  if (far) {
    profile(m, cabinShape(f), Wg, GLASS, SURF.glass, { seg: 1 });
    m.box(Wg + 0.02, 0.05, zRf - zRb - 0.2, [0, yr - 0.005, (zRf + zRb) / 2], PAINT, CAR_PAINT);
    return;
  }
  const x = Wg / 2 + 0.015;
  // roof skin (slightly proud of the glass), gutter lines
  m.box(Wg + 0.03, 0.06, zRf - zRb - 0.14, [0, yr - 0.01, (zRf + zRb) / 2], PAINT, CAR_PAINT, {
    bevel: 0.025,
    lod: 0,
  });
  m.both(() => {
    beam(m, [zWs, yb], [zRf, yr - 0.03], x, 0.06, 0.075, PAINT, CAR_PAINT, 0);
    beam(m, [zRw, yb], [zRb, yr - 0.03], x, 0.06, f.hatch ? 0.12 : 0.2, PAINT, CAR_PAINT, 0);
    for (const bz of opts.bPillar ?? [(zRf + zRb) / 2 + 0.05])
      m.box(0.06, yr - yb, 0.09, [x, (yb + yr) / 2, bz], TRIM, SURF.trim);
    // belt chrome
    m.box(
      0.02,
      0.025,
      zWs - zRw - 0.1,
      [x + 0.005, yb + 0.01, (zWs + zRw) / 2],
      CHROME,
      SURF.chrome,
      { lod: 1 },
    );
  });
  // windshield header + cowl
  m.box(Wg, 0.05, 0.1, [0, yb + 0.02, zWs - 0.02], TRIM, SURF.trim);
  // interior, seen through the glass: floor, dash, wheel, seats
  const inner = Wg - 0.12;
  m.box(inner, 0.02, zWs - zRw - 0.1, [0, yb + 0.005, (zWs + zRw) / 2], "#151515", SURF.rubber, {
    lod: 1,
  });
  m.box(inner, 0.14, 0.34, [0, yb + 0.12, zWs - 0.3], DASH, SURF.polymer, { bevel: 0.03, lod: 1 });
  m.torus(0.15, 0.022, [f.W * 0.2, yb + 0.26, zWs - 0.55], "#111", SURF.polymer, {
    rot: [-0.35, 0, 0],
    seg: 14,
    lod: 1,
  });
  const rows = opts.rows ?? 2;
  const front = zWs - 0.95;
  for (let k = 0; k < rows; k++) {
    const z = front - k * 0.85;
    if (z < zRw + 0.35) break;
    const pair = k === 0;
    for (const sx of pair ? [1, -1] : [0]) {
      const w = pair ? inner * 0.4 : inner * 0.9;
      m.box(w, 0.1, 0.42, [sx * inner * 0.24, yb + 0.07, z], SEAT, SURF.leather, {
        bevel: 0.03,
        lod: 1,
      });
      const bh = (yr - yb) * 0.5;
      m.box(w, bh, 0.1, [sx * inner * 0.24, yb + 0.09 + bh / 2, z - 0.22], SEAT, SURF.leather, {
        bevel: 0.03,
        rot: [-0.18, 0, 0],
        lod: 1,
      });
      if (pair)
        m.box(
          w * 0.55,
          0.1,
          0.08,
          [sx * inner * 0.24, yb + 0.09 + bh + 0.04, z - 0.27],
          SEAT,
          SURF.leather,
          { bevel: 0.02, lod: 1 },
        );
    }
  }
}

// ---------------------------------------------------------------- per-type bodies
type BodyKind =
  "sedan" | "compact" | "suv" | "sports" | "taxi" | "police" | "pickup" | "van" | "bus";

function carBody(
  type: "sedan" | "compact" | "suv" | "sports" | "taxi" | "police" | "pickup",
  far: boolean,
) {
  const look = LOOKS[type === "taxi" || type === "police" ? "sedan" : type];
  const f = frameOf(type, look);
  const m = new Model();
  const pickup = type === "pickup";
  profile(m, lowerShape(f, pickup ? { beltTo: f.R + 0.14 } : {}), f.W, PAINT, CAR_PAINT, {
    bevel: far ? 0 : 0.035,
    seg: far ? 2 : 8,
  });
  wheelWells(m, f, far);
  const headY = f.hf - 0.13;
  const tailY = f.yb - f.tail - 0.2;
  lenses(m, f, headY, tailY, f.R, far);
  bumpers(m, f, f.y0 + 0.1);
  if (!far) grille(m, f, headY - 0.02, type === "sports" ? 0.06 : 0.12);
  if (far) simpleWheels(m, f);
  cabin(m, f, far, {
    rows: type === "sports" ? 1 : 2,
    bPillar: type === "sports" ? [] : undefined,
  });
  if (!far) {
    mirrors(m, f);
    const doors =
      type === "sports"
        ? [f.zWs - 0.05, f.zRb + 0.1]
        : pickup
          ? [f.zWs - 0.05, f.zRb + 0.05]
          : [f.zWs - 0.05, (f.zRf + f.zRb) / 2 + 0.05, f.zRb - 0.05];
    doorSeams(m, f, doors);
    // hood crease + fuel cap + exhaust
    m.box(
      0.012,
      0.01,
      f.F - f.zWs - 0.3,
      [0, (f.hf + f.yb) / 2 + 0.01, (f.F + f.zWs) / 2],
      "#0a0a0b",
      SURF.rubber,
      { rot: [Math.atan2(f.yb - f.hf, f.F - f.zWs), 0, 0], lod: 1 },
    );
    m.tubeZ(0.035, 0.14, [f.W * 0.3, f.y0 + 0.06, f.R - 0.03], CHROME, SURF.chrome, {
      seg: 8,
      lod: 1,
    });
    if (type === "sports") {
      m.tubeZ(0.035, 0.14, [f.W * 0.22, f.y0 + 0.06, f.R - 0.03], CHROME, SURF.chrome, {
        seg: 8,
        lod: 1,
      });
      m.both(() =>
        m.box(
          0.03,
          0.12,
          0.5,
          [f.W / 2 + 0.005, f.y0 + 0.25, -f.wz + f.ra + 0.3],
          "#0c0c0d",
          SURF.darkSteel,
          { lod: 1 },
        ),
      );
    }
  }
  if (type === "suv") {
    // black cladding, roof rails, spare wheel on the tailgate
    m.both(() => m.box(0.04, 0.16, f.L - 0.4, [f.W / 2 + 0.01, f.y0 + 0.1, 0], TRIM, SURF.trim));
    m.both(() =>
      m.box(
        0.05,
        0.05,
        f.zRf - f.zRb - 0.2,
        [f.Wg / 2 - 0.08, f.yr + 0.06, (f.zRf + f.zRb) / 2],
        TRIM,
        SURF.trim,
        { lod: 1 },
      ),
    );
    if (far) m.box(f.r * 1.8, f.r * 1.8, 0.24, [0, f.yb - 0.15, f.R - 0.13], RUBBER, SURF.tyre);
    else {
      m.tubeZ(f.r * 0.95, 0.24, [0, f.yb - 0.15, f.R - 0.13], RUBBER, SURF.tyre, { seg: 16 });
      m.tubeZ(f.r * 0.55, 0.26, [0, f.yb - 0.15, f.R - 0.13], "#7c8086", SURF.brushed, { seg: 12 });
    }
  }
  if (pickup) {
    // bed: side rails, tailgate, dark liner
    const bedF = f.zRw - 0.06;
    const bedL = bedF - f.R;
    const bz = (bedF + f.R) / 2;
    m.both(() =>
      m.box(0.1, 0.38, bedL, [f.W / 2 - 0.05, f.yb + 0.17, bz], PAINT, CAR_PAINT, {
        bevel: far ? 0 : 0.03,
      }),
    );
    m.box(f.W, 0.38, 0.1, [0, f.yb + 0.17, f.R + 0.05], PAINT, CAR_PAINT, {
      bevel: far ? 0 : 0.03,
    });
    m.box(f.W - 0.2, 0.02, bedL - 0.15, [0, f.yb + 0.01, bz + 0.03], "#1a1a1b", SURF.rubber);
    if (!far)
      for (let k = 0; k < 5; k++)
        m.box(
          0.04,
          0.02,
          bedL - 0.2,
          [-f.W * 0.3 + (k * f.W * 0.6) / 4, f.yb + 0.025, bz],
          "#2a2a2b",
          SURF.rubber,
          { lod: 1 },
        );
    m.box(0.3, 0.03, 0.02, [0, f.yb + 0.22, f.R - 0.005], CHROME, SURF.chrome, { lod: 1 });
  }
  if (type === "taxi") {
    // roof sign housing + checker band
    m.box(0.72, 0.06, 0.32, [0, f.yr + 0.04, (f.zRf + f.zRb) / 2], TRIM, SURF.trim, {
      bevel: 0.015,
    });
    if (!far)
      m.both(() => {
        for (let k = 0; k < 14; k++)
          m.box(
            0.01,
            0.06,
            0.12,
            [f.W / 2 + 0.018, f.yb - 0.14 + (k % 2) * 0.06, f.zWs - 0.1 - k * 0.14],
            "#111",
            SURF.paint,
            { lod: 1 },
          );
      });
  }
  if (type === "police") {
    // white doors, push bar, lightbar base with dim lenses, antenna
    m.both(() =>
      m.box(
        0.012,
        f.yb - f.y0 - 0.2,
        f.zWs - f.zRb - 0.2,
        [f.W / 2 + 0.016, (f.y0 + f.yb) / 2 + 0.03, (f.zWs + f.zRb) / 2 - 0.05],
        "#f2f2f0",
        SURF.enamel,
      ),
    );
    m.box(0.9, 0.06, 0.28, [0, f.yr + 0.03, (f.zRf + f.zRb) / 2], TRIM, SURF.trim, {
      bevel: 0.015,
    });
    m.box(0.46, 0.1, 0.22, [-0.28, f.yr + 0.1, (f.zRf + f.zRb) / 2], "#5a1010", SURF.lens);
    m.box(0.46, 0.1, 0.22, [0.28, f.yr + 0.1, (f.zRf + f.zRb) / 2], "#10205a", SURF.lens);
    m.box(f.W * 0.5, 0.26, 0.05, [0, f.y0 + 0.28, f.F + 0.12], TRIM, SURF.trim, { lod: 1 });
    m.both(() =>
      m.box(0.04, 0.3, 0.14, [f.W * 0.22, f.y0 + 0.28, f.F + 0.06], TRIM, SURF.trim, { lod: 1 }),
    );
    m.cyl(0.006, 0.5, [-0.3, f.yr + 0.25, f.zRb + 0.1], TRIM, SURF.trim, { seg: 4, lod: 1 });
  }
  return { m, f, headY, tailY };
}

function glassShell(f: Frame) {
  const m = new Model();
  profile(m, cabinShape(f), f.Wg, GLASS, SURF.glass, { bevel: 0.02, seg: 6 });
  return m.build();
}

function vanBody(far: boolean) {
  const s = SPECS.van;
  const L = s.len;
  const W = s.wid;
  const F = L / 2;
  const R = -L / 2;
  const y0 = s.ride;
  const yb = y0 + s.body;
  const top = y0 + 2.35;
  const r = s.wheel;
  const f: Frame = {
    L,
    W,
    F,
    R,
    y0,
    yb,
    yr: top,
    r,
    ra: r + 0.07,
    wz: L / 2 - r - 0.45,
    zWs: F - 0.55,
    zRf: F - 1.2,
    zRb: R,
    zRw: R,
    hf: yb - 0.05,
    tail: 0,
    Wg: W * 0.94,
    hatch: true,
  };
  const split = F - L * 0.34;
  const cabTop = y0 + 2.05;
  const m = new Model();
  // cab: low hood, raked screen, roof
  const a = Math.asin((y0 - r) / f.ra);
  const dx = f.ra * Math.cos(a);
  const cab = shapeOf((sh) => {
    sh.moveTo(split, y0);
    sh.lineTo(f.wz - dx, y0);
    sh.absarc(f.wz, r, f.ra, PI - a, a, true);
    sh.lineTo(F - 0.12, y0);
    sh.quadraticCurveTo(F, y0, F, y0 + 0.12);
    sh.lineTo(F, f.hf - 0.12);
    sh.quadraticCurveTo(F, f.hf, F - 0.16, f.hf);
    sh.lineTo(F - 0.55, yb);
    sh.lineTo(split, yb);
  });
  profile(m, cab, W * 0.96, PAINT, CAR_PAINT, { bevel: far ? 0 : 0.035, seg: far ? 2 : 8 });
  const green = shapeOf((sh) => {
    sh.moveTo(F - 0.55, yb - 0.02);
    sh.lineTo(F - 1.15, cabTop - 0.05);
    sh.lineTo(split + 0.02, cabTop - 0.05);
    sh.lineTo(split + 0.02, yb - 0.02);
  });
  const Wg = W * 0.9;
  // cargo box: its own panel (not paint), a painted stripe, rear doors
  const box = shapeOf((sh) => {
    sh.moveTo(R + 0.08, y0 + 0.08);
    sh.lineTo(-f.wz - dx, y0 + 0.08);
    sh.absarc(
      -f.wz,
      r,
      f.ra,
      PI - Math.asin((y0 + 0.08 - r) / f.ra),
      Math.asin((y0 + 0.08 - r) / f.ra),
      true,
    );
    sh.lineTo(split + 0.02, y0 + 0.08);
    sh.lineTo(split + 0.02, top - 0.08);
    sh.quadraticCurveTo(split + 0.02, top, split - 0.08, top);
    sh.lineTo(R + 0.08, top);
    sh.quadraticCurveTo(R, top, R, top - 0.08);
    sh.lineTo(R, y0 + 0.16);
    sh.quadraticCurveTo(R, y0 + 0.08, R + 0.08, y0 + 0.08);
  });
  profile(m, box, W, "#ecebe6", SURF.enamel, { bevel: far ? 0 : 0.04, seg: far ? 2 : 6 });
  m.both(() =>
    m.box(0.02, 0.22, split - R - 0.2, [W / 2 + 0.01, y0 + 0.9, (split + R) / 2], PAINT, CAR_PAINT),
  );
  wheelWells(m, { ...f, W: W - 0.02 }, far);
  lenses(m, f, f.hf - 0.13, y0 + 0.55, R, far);
  bumpers(m, f, y0 + 0.1);
  if (!far) grille(m, f, f.hf - 0.15, 0.14);
  if (far) {
    profile(m, green, Wg, GLASS, SURF.glass, { seg: 2 });
    simpleWheels(m, f, 0.34);
  } else {
    m.box(
      Wg + 0.03,
      0.06,
      F - 1.15 - split + 0.05,
      [0, cabTop - 0.02, (F - 1.15 + split) / 2],
      PAINT,
      CAR_PAINT,
      { bevel: 0.02 },
    );
    m.both(() => {
      beam(
        m,
        [F - 0.55, yb],
        [F - 1.15, cabTop - 0.04],
        Wg / 2 + 0.015,
        0.06,
        0.08,
        PAINT,
        CAR_PAINT,
        0,
      );
      m.box(
        0.06,
        cabTop - yb,
        0.1,
        [Wg / 2 + 0.015, (yb + cabTop) / 2, split + 0.07],
        PAINT,
        CAR_PAINT,
      );
      // rear door seams, hinges and the cargo rub rail
      m.box(0.012, 1.9, 0.012, [W / 2 + 0.005, y0 + 1.2, split - 0.9], "#8a8a86", SURF.paint, {
        lod: 1,
      });
    });
    m.box(0.012, 2.1, 0.02, [0, y0 + 1.2, R - 0.005], "#8a8a86", SURF.paint, { lod: 1 });
    m.box(0.04, 0.3, 0.03, [0.12, y0 + 1.2, R - 0.01], CHROME, SURF.chrome, { lod: 1 });
    mirrors(m, { ...f, zWs: F - 0.6 });
    doorSeams(m, { ...f, yb: yb }, [F - 0.62, split + 0.15]);
    const inner = Wg - 0.12;
    m.box(inner, 0.14, 0.3, [0, yb + 0.12, F - 0.8], DASH, SURF.polymer, { bevel: 0.03, lod: 1 });
    m.both(() => {
      m.box(inner * 0.38, 0.1, 0.42, [inner * 0.25, yb + 0.07, split + 0.45], SEAT, SURF.leather, {
        bevel: 0.03,
        lod: 1,
      });
      m.box(inner * 0.38, 0.55, 0.1, [inner * 0.25, yb + 0.36, split + 0.22], SEAT, SURF.leather, {
        bevel: 0.03,
        lod: 1,
      });
    });
  }
  const glass = new Model();
  profile(glass, green, Wg, GLASS, SURF.glass, { bevel: 0.02, seg: 2 });
  return { m, f, glass: glass.build(), headY: f.hf - 0.13, tailY: y0 + 0.55, cabTop };
}

function busBody(far: boolean) {
  const s = SPECS.bus;
  const L = s.len;
  const W = s.wid;
  const F = L / 2;
  const R = -L / 2;
  const y0 = s.ride;
  const top = y0 + s.body;
  const r = s.wheel;
  const f: Frame = {
    L,
    W,
    F,
    R,
    y0,
    yb: y0 + 1.1,
    yr: top,
    r,
    ra: r + 0.08,
    wz: L / 2 - r - 1.1,
    zWs: F,
    zRf: F,
    zRb: R,
    zRw: R,
    hf: top,
    tail: 0,
    Wg: W,
    hatch: true,
  };
  const m = new Model();
  const a = Math.asin((y0 - r) / f.ra);
  const dx = f.ra * Math.cos(a);
  const winLo = y0 + 1.15;
  const winHi = y0 + 2.05;
  // the lower shell up to the window line (paint), and the roof cap (paint)
  const lower = shapeOf((sh) => {
    sh.moveTo(R + 0.1, y0);
    sh.lineTo(-f.wz - dx, y0);
    sh.absarc(-f.wz, r, f.ra, PI - a, a, true);
    sh.lineTo(f.wz - dx, y0);
    sh.absarc(f.wz, r, f.ra, PI - a, a, true);
    sh.lineTo(F - 0.1, y0);
    sh.quadraticCurveTo(F, y0, F, y0 + 0.1);
    sh.lineTo(F, winLo - 0.2);
    sh.lineTo(F - 0.05, winLo);
    sh.lineTo(R, winLo);
    sh.lineTo(R, y0 + 0.1);
    sh.quadraticCurveTo(R, y0, R + 0.1, y0);
  });
  profile(m, lower, W, PAINT, CAR_PAINT, { bevel: far ? 0 : 0.05, seg: far ? 2 : 8 });
  const cap = shapeOf((sh) => {
    sh.moveTo(R, winHi);
    sh.lineTo(F - 0.12, winHi);
    sh.quadraticCurveTo(F - 0.05, top - 0.05, F - 0.3, top);
    sh.lineTo(R + 0.2, top);
    sh.quadraticCurveTo(R, top, R, top - 0.15);
    sh.lineTo(R, winHi);
  });
  profile(m, cap, W, PAINT, CAR_PAINT, { bevel: far ? 0 : 0.06, seg: far ? 2 : 6 });
  // window band: glass (near: transparent shell over seats) with black mullions
  const band = shapeOf((sh) => {
    sh.moveTo(R + 0.02, winLo);
    sh.lineTo(F - 0.05, winLo);
    sh.lineTo(F - 0.1, winHi);
    sh.lineTo(R + 0.02, winHi);
  });
  const glass = new Model();
  profile(glass, band, W - 0.06, GLASS, SURF.glass, { seg: 2 });
  // livery stripe, bumpers, lenses, the route sign housing, roof AC pod
  m.both(() => m.box(0.02, 0.26, L * 0.94, [W / 2 + 0.01, y0 + 0.6, 0], "#d8d8d4", SURF.enamel));
  wheelWells(m, f, far);
  lenses(m, f, y0 + 0.45, y0 + 0.5, R, far);
  bumpers(m, f, y0 + 0.12);
  m.box(W * 0.72, 0.26, 0.06, [0, top - 0.25, F - 0.06], TRIM, SURF.trim, { bevel: 0.02 });
  m.box(W * 0.6, 0.26, 2.2, [0, top + 0.12, -0.5], "#cfd2d6", SURF.enamel, {
    bevel: far ? 0 : 0.06,
  });
  if (far) {
    profile(m, band, W - 0.06, GLASS, SURF.glass, { seg: 2 });
    // Keep separate panes readable when the transparent cabin switches to its distant LOD.
    m.both(() => {
      for (let k = 0; k <= 8; k++)
        m.box(
          0.045,
          winHi - winLo,
          0.09,
          [W / 2 - 0.015, (winLo + winHi) / 2, R + 0.1 + k * ((L - 0.4) / 8)],
          PAINT,
          CAR_PAINT,
        );
    });
    simpleWheels(m, f, 0.34);
  } else {
    m.both(() => {
      for (let k = 0; k <= 8; k++)
        m.box(
          0.04,
          winHi - winLo,
          0.08,
          [W / 2 - 0.02, (winLo + winHi) / 2, R + 0.1 + k * ((L - 0.4) / 8)],
          TRIM,
          SURF.trim,
        );
      m.box(0.04, 0.05, L - 0.1, [W / 2 - 0.02, winLo, 0], TRIM, SURF.trim);
    });
    // door on the kerb side (-x), a split glass door
    m.box(
      0.03,
      winLo - y0 - 0.2,
      1.1,
      [-W / 2 - 0.005, (y0 + winLo) / 2 + 0.05, F - 1.1],
      "#20282e",
      SURF.glass,
    );
    m.box(
      0.035,
      winLo - y0 - 0.2,
      0.03,
      [-W / 2 - 0.01, (y0 + winLo) / 2 + 0.05, F - 1.1],
      TRIM,
      SURF.trim,
    );
    for (let k = 0; k < 7; k++) {
      const z = F - 2.0 - k * 0.95;
      m.both(() => {
        m.box(0.8, 0.1, 0.42, [W * 0.25, winLo - 0.25, z], "#2a3a5a", SURF.leather, { lod: 1 });
        m.box(0.8, 0.5, 0.1, [W * 0.25, winLo, z - 0.2], "#2a3a5a", SURF.leather, { lod: 1 });
      });
    }
    m.box(W - 0.2, 0.3, 0.4, [0, winLo - 0.1, F - 0.4], DASH, SURF.polymer, { lod: 1 });
    mirrors(m, { ...f, yb: winLo + 0.2, zWs: F - 0.05 });
  }
  return { m, f, glass: glass.build(), headY: y0 + 0.45, tailY: y0 + 0.5 };
}

// ---------------------------------------------------------------- the detailed wheel
let WHEEL: THREE.BufferGeometry | null = null;
/** unit wheel: radius 1, width 1, axle along x; tyre, alloy dish and five spokes on both faces */
function wheelGeometry() {
  if (WHEEL) return WHEEL;
  const m = new Model();
  m.push([0, 0, 0], [0, 0, PI / 2]); // lathe around y -> axle along x
  m.lathe(
    [
      [0.66, -0.5],
      [0.92, -0.5],
      [1, -0.34],
      [1, 0.34],
      [0.92, 0.5],
      [0.66, 0.5],
    ],
    [0, 0, 0],
    RUBBER,
    SURF.tyre,
    { seg: 14 },
  );
  for (const sy of [1, -1]) {
    m.push([0, 0, 0], [0, 0, 0], [1, sy, 1]);
    m.lathe(
      [
        [0.66, 0.5],
        [0.3, 0.39],
        [0, 0.42],
      ],
      [0, 0, 0],
      "#a9adb2",
      SURF.brushed,
      { seg: 14 },
    );
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * PI * 2;
      m.push([0, 0.43, 0], [0, a, 0]);
      m.box(0.1, 0.05, 0.46, [0, 0, 0.36], "#c4c7cb", SURF.chrome);
      m.pop();
    }
    m.cyl(0.14, 0.08, [0, 0.46, 0], "#8a8d92", SURF.chrome, { seg: 6 });
    m.pop();
  }
  m.pop();
  WHEEL = m.build();
  return WHEEL;
}

// ---------------------------------------------------------------- extras
function extraGeometry(
  kind: "rack-suv" | "rack-compact" | "spoiler" | "ladder-pickup" | "ladder-van",
) {
  const m = new Model();
  if (kind === "rack-suv" || kind === "rack-compact") {
    const f = frameOf(
      kind === "rack-suv" ? "suv" : "compact",
      LOOKS[kind === "rack-suv" ? "suv" : "compact"],
    );
    const cz = (f.zRf + f.zRb) / 2;
    const len = f.zRf - f.zRb - 0.3;
    m.both(() => m.box(0.05, 0.06, len, [f.Wg * 0.36, f.yr + 0.08, cz], TRIM, SURF.trim));
    for (const dz of [-len * 0.35, len * 0.35])
      m.box(f.Wg * 0.78, 0.04, 0.05, [0, f.yr + 0.12, cz + dz], TRIM, SURF.trim);
    m.box(f.Wg * 0.62, 0.2, len * 0.55, [0, f.yr + 0.24, cz], "#333a44", SURF.polymer, {
      bevel: 0.05,
    });
  } else if (kind === "spoiler") {
    const f = frameOf("sports", LOOKS.sports);
    m.box(f.W * 0.92, 0.04, 0.3, [0, f.yb + 0.26, f.R + 0.22], TRIM, SURF.trim, {
      bevel: 0.015,
      rot: [-0.08, 0, 0],
    });
    m.both(() => m.box(0.05, 0.26, 0.1, [f.W * 0.32, f.yb + 0.12, f.R + 0.24], TRIM, SURF.trim));
    m.both(() => m.box(0.02, 0.1, 0.32, [f.W * 0.46, f.yb + 0.28, f.R + 0.22], TRIM, SURF.trim));
  } else if (kind === "ladder-pickup") {
    const f = frameOf("pickup", LOOKS.pickup);
    const bz = (f.zRw + f.R) / 2;
    const bedL = f.zRw - f.R;
    for (const z of [f.zRw - 0.1, f.R + 0.15]) {
      m.box(f.W * 0.9, 0.06, 0.06, [0, f.yr + 0.2, z], CHROME, SURF.brushed);
      m.both(() =>
        m.box(
          0.06,
          f.yr + 0.2 - f.yb,
          0.06,
          [f.W * 0.44, (f.yr + 0.2 + f.yb) / 2, z],
          CHROME,
          SURF.brushed,
        ),
      );
    }
    ladder(m, f.W * 0.25, f.yr + 0.26, bz, bedL * 1.15);
  } else {
    const s = SPECS.van;
    const top = s.ride + 2.35;
    const L = s.len;
    const split = L / 2 - L * 0.34;
    const cz = (split - L / 2) / 2;
    const len = split + L / 2 - 0.3;
    m.both(() => m.box(0.05, 0.08, len, [s.wid * 0.4, top + 0.06, cz], CHROME, SURF.brushed));
    for (let k = 0; k < 4; k++)
      m.box(
        s.wid * 0.82,
        0.04,
        0.05,
        [0, top + 0.1, cz - len / 2 + 0.2 + (k * (len - 0.4)) / 3],
        CHROME,
        SURF.brushed,
      );
    ladder(m, s.wid * 0.2, top + 0.16, cz, len * 0.95);
  }
  return m.build();
}
function ladder(m: Model, x: number, y: number, z: number, len: number) {
  for (const dx of [-0.2, 0.2]) m.box(0.05, 0.08, len, [x + dx, y, z], "#c8a040", SURF.paint);
  const n = Math.floor(len / 0.3);
  for (let k = 0; k < n; k++)
    m.box(0.4, 0.03, 0.03, [x, y + 0.02, z - len / 2 + 0.15 + k * 0.3], "#c8a040", SURF.paint);
}

// ---------------------------------------------------------------- the model registry
const models = new Map<string, VehicleModel>();

/** register (or replace) the model a Vehicle `type` draws with */
export function registerVehicleModel(type: string, model: VehicleModel) {
  models.set(type, model);
}

function stdWheels(f: Frame, w: number) {
  const spec = { len: f.L, wid: f.W };
  return (v: Vehicle): WheelSpot[] => {
    const kz = v.len / spec.len;
    const kx = v.wid / spec.wid;
    const r = Math.min(v.wheel, f.r + 0.03);
    const out: WheelSpot[] = [];
    for (const z of [f.wz * kz, -f.wz * kz])
      for (const sx of [1, -1]) out.push({ x: sx * (f.W / 2 - 0.13) * kx, y: r, z, r, w });
    return out;
  };
}
function stdLamps(
  f: Frame,
  headY: number,
  tailY: number,
  extra: (v: Vehicle, kz: number, kx: number) => Lamp[] = () => [],
) {
  return (v: Vehicle): Lamp[] => {
    const kz = v.len / f.L;
    const kx = v.wid / f.W;
    const F = (f.L / 2) * kz;
    const hx = (f.W / 2 - 0.28) * kx;
    const tx = (f.W / 2 - 0.26) * kx;
    return [
      { kind: "head", x: hx, y: headY, z: F + 0.04, sx: 0.3, sy: 0.1, sz: 0.03, color: 0xffffff },
      { kind: "head", x: -hx, y: headY, z: F + 0.04, sx: 0.3, sy: 0.1, sz: 0.03, color: 0xffffff },
      {
        kind: "tail",
        x: tx,
        y: tailY,
        z: -F - 0.02,
        sx: 0.32,
        sy: 0.12,
        sz: 0.03,
        color: 0xff2020,
      },
      {
        kind: "tail",
        x: -tx,
        y: tailY,
        z: -F - 0.02,
        sx: 0.32,
        sy: 0.12,
        sz: 0.03,
        color: 0xff2020,
      },
      ...extra(v, kz, kx),
    ];
  };
}

/** the model for a vehicle type (built once, on first use) */
export const vehicleModelKey = (v: Vehicle) => v.variant ?? v.type;
export function vehicleModel(type: string): VehicleModel {
  let md = models.get(type);
  if (md) return md;
  const t = type as BodyKind;
  if (t === "van") {
    const n = vanBody(false);
    const fr = vanBody(true);
    md = {
      near: n.m.build(),
      far: fr.m.build({ lod: 1 }),
      glass: n.glass,
      spec: { len: n.f.L, wid: n.f.W },
      wheels: stdWheels(n.f, 0.34),
      lamps: stdLamps(n.f, n.headY, n.tailY),
    };
  } else if (t === "bus") {
    const n = busBody(false);
    const fr = busBody(true);
    md = {
      near: n.m.build(),
      far: fr.m.build({ lod: 1 }),
      glass: n.glass,
      spec: { len: n.f.L, wid: n.f.W },
      wheels: stdWheels(n.f, 0.34),
      lamps: stdLamps(n.f, n.headY, n.tailY, (v, kz) => [
        {
          kind: "sign",
          x: 0,
          y: n.f.yr - 0.25,
          z: (n.f.L / 2) * kz + 0.02,
          sx: v.wid * 0.66,
          sy: 0.2,
          sz: 0.03,
          color: 0xffa21a,
        },
      ]),
    };
  } else {
    const service = type === "lifeguard" || type === "coastal-patrol";
    const body = service
      ? "pickup"
      : t === "taxi" ||
          t === "police" ||
          t === "sedan" ||
          t === "compact" ||
          t === "suv" ||
          t === "sports" ||
          t === "pickup"
        ? t
        : "sedan";
    const n = carBody(body, false);
    const fr = carBody(body, true);
    const f = n.f;
    if (service)
      for (const m of [n.m, fr.m]) {
        const patrol = type === "coastal-patrol",
          rz = (f.zRf + f.zRb) / 2;
        // Roof lightbar, contrasting door stripe, rescue board and tie-down rack.
        m.box(1.15, 0.1, 0.3, [0, f.yr + 0.06, rz], "#292b2d", SURF.polymer, { bevel: 0.025 });
        for (const x of [-0.3, 0.3])
          m.box(
            0.45,
            0.12,
            0.24,
            [x, f.yr + 0.14, rz],
            x < 0 ? "#d62624" : patrol ? "#2658c6" : "#e7a02b",
            SURF.lens,
            { bevel: 0.02 },
          );
        for (const x of [-f.W / 2 - 0.008, f.W / 2 + 0.008]) {
          m.box(
            0.025,
            0.24,
            1.6,
            [x, f.yb + 0.45, f.zRf - 0.65],
            patrol ? "#263e35" : "#f0e8d5",
            SURF.enamel,
          );
          // Rescue cross / patrol shield on each door, visible as geometry at player height.
          m.box(
            0.035,
            0.3,
            0.3,
            [x * 1.004, f.yb + 0.62, f.zRf - 0.6],
            patrol ? "#c3a35c" : "#eeeeeb",
            SURF.enamel,
            { bevel: 0.025 },
          );
        }
        if (!patrol) {
          for (const z of [-1.8, -0.8])
            m.box(1.75, 0.07, 0.08, [0, 1.45, z], "#4a4c4d", SURF.steel);
          m.box(0.56, 0.12, 2.25, [0.3, 1.55, -1.3], "#f3d149", SURF.enamel, { bevel: 0.055 });
          for (const z of [-1.85, -0.7])
            m.box(0.59, 0.02, 0.06, [0.3, 1.62, z], "#303337", SURF.rubber);
          m.box(0.55, 0.35, 0.55, [-0.45, 0.95, -1.65], "#e6e3d9", SURF.polymer, { bevel: 0.05 });
        }
      }
    const roofZ = (f.zRf + f.zRb) / 2;
    md = {
      near: n.m.build(),
      far: fr.m.build({ lod: 1 }),
      glass: glassShell(f),
      spec: { len: f.L, wid: f.W },
      wheels: stdWheels(f, 0.26),
      lamps: stdLamps(f, n.headY, n.tailY, (_v, kz) =>
        body === "taxi"
          ? [
              {
                kind: "sign",
                x: 0,
                y: f.yr + 0.17,
                z: roofZ * kz,
                sx: 0.66,
                sy: 0.2,
                sz: 0.28,
                color: 0xfff2a0,
              },
            ]
          : body === "police" || type === "coastal-patrol"
            ? [
                {
                  kind: "barR",
                  x: -0.28,
                  y: f.yr + 0.11,
                  z: roofZ * kz,
                  sx: 0.48,
                  sy: 0.12,
                  sz: 0.24,
                  color: 0xff2020,
                },
                {
                  kind: "barB",
                  x: 0.28,
                  y: f.yr + 0.11,
                  z: roofZ * kz,
                  sx: 0.48,
                  sy: 0.12,
                  sz: 0.24,
                  color: 0x2050ff,
                },
              ]
            : [],
      ),
    };
  }
  models.set(type, md);
  return md;
}

type ExtraKey = "rack-suv" | "rack-compact" | "spoiler" | "ladder-pickup" | "ladder-van";
function extraKeys(v: Vehicle): ExtraKey[] {
  const out: ExtraKey[] = [];
  if (v.extras & EXTRA_ROOF_RACK) out.push(v.type === "suv" ? "rack-suv" : "rack-compact");
  if (v.extras & EXTRA_SPOILER) out.push("spoiler");
  if (v.extras & EXTRA_LADDER) out.push(v.type === "van" ? "ladder-van" : "ladder-pickup");
  return out;
}
const extraGeo = new Map<ExtraKey, THREE.BufferGeometry>();
function extraOf(k: ExtraKey) {
  let g = extraGeo.get(k);
  if (!g) {
    g = extraGeometry(k);
    extraGeo.set(k, g);
  }
  return g;
}

// ---------------------------------------------------------------- materials (shared)
let MATS: {
  body: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  plain: THREE.MeshStandardMaterial;
  lamp: THREE.MeshBasicMaterial;
} | null = null;
function mats() {
  if (!MATS)
    MATS = {
      body: artMaterial({ paint: true, wear: 0.22, scale: 1.6 }),
      glass: artMaterial({ transparent: true, opacity: 0.78, wear: 0.05, scale: 1.6 }),
      plain: artMaterial({ wear: 0.3, scale: 2 }),
      lamp: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
    };
  return MATS;
}

// ---------------------------------------------------------------- the batch
/** distance (m) inside which a car draws its near model, wheels, glass and extras */
export const CAR_NEAR = 45;
/** beyond this a car is not drawn at all (the fog has it) */
export const CAR_FAR = 420;

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _x = new THREE.Vector3(1, 0, 0);
const _c = new THREE.Color();
const _frustum = new THREE.Frustum();
const _proj = new THREE.Matrix4();
const _sphere = new THREE.Sphere();

type Slot = {
  v: Vehicle;
  type: string;
  model: VehicleModel;
  /** car frame (no size scale) and body matrix (with the per-car size scale) */
  frame: THREE.Matrix4;
  body: THREE.Matrix4;
  x: number;
  y: number;
  z: number;
  spin: number;
  wheels: WheelSpot[];
  lamps: Lamp[];
  extras: ExtraKey[];
  placed: boolean;
  /** the type's meshes, and the paint colour (linear rgb) */
  group?: Group;
  rgb: [number, number, number];
  lit: boolean;
  bar: 0 | 1 | 2;
  /** bounding radius (m) for frustum culling */
  rad: number;
};
type Group = {
  near: THREE.InstancedMesh;
  far: THREE.InstancedMesh;
  glass: THREE.InstancedMesh | null;
};

/**
 * Draws a fixed set of vehicles: one InstancedMesh per type and LOD, a shared glass mesh
 * per type (near only), one wheel mesh, one lamp mesh and one mesh per extra.
 */
export class CarBatch {
  readonly group = new THREE.Group();
  private slots: Slot[] = [];
  private groups = new Map<string, Group>();
  private wheel: THREE.InstancedMesh;
  private lamp: THREE.InstancedMesh | null = null;
  private extras = new Map<ExtraKey, THREE.InstancedMesh>();
  private ln = 0;
  private wn = 0;
  /** slots below this index move every frame; the rest are static (culled per grid cell) */
  private dynamic: number;
  private cells: { x: number; y: number; z: number; r: number; slots: Slot[] }[] | null = null;

  /** `staticFrom`: index of the first vehicle that is placed once and never moves (parked) */
  constructor(vehicles: Vehicle[], staticFrom = vehicles.length) {
    this.dynamic = staticFrom;
    const M = mats();
    const counts = new Map<string, number>();
    const exCounts = new Map<ExtraKey, number>();
    let lamps = 0;
    for (const v of vehicles) {
      const model = vehicleModel(vehicleModelKey(v));
      const ls = model.lamps(v);
      const ex = extraKeys(v);
      this.slots.push({
        v,
        type: vehicleModelKey(v),
        model,
        frame: new THREE.Matrix4(),
        body: new THREE.Matrix4(),
        x: 0,
        y: 0,
        z: 0,
        spin: 0,
        wheels: model.wheels(v),
        lamps: ls,
        extras: ex,
        placed: false,
        lit: false,
        bar: 0,
        rad: Math.hypot(v.len, v.wid) / 2 + 0.6,
        rgb: _c.set(v.color).toArray() as [number, number, number],
      });
      lamps += ls.length;
      counts.set(vehicleModelKey(v), (counts.get(vehicleModelKey(v)) ?? 0) + 1);
      for (const k of ex) exCounts.set(k, (exCounts.get(k) ?? 0) + 1);
    }
    const inst = (g: THREE.BufferGeometry, m: THREE.Material, n: number, color: boolean) => {
      const im = new THREE.InstancedMesh(g, m, Math.max(1, n));
      im.frustumCulled = false;
      im.count = 0;
      if (color) im.setColorAt(0, _c.set(0xffffff)); // create instanceColor before the first compile
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(im);
      return im;
    };
    for (const [type, n] of counts) {
      const md = vehicleModel(type);
      const near = inst(md.near, M.body, n, true);
      near.receiveShadow = true;
      const far = inst(md.far, M.body, n, true);
      let glass: THREE.InstancedMesh | null = null;
      if (md.glass) {
        glass = new THREE.InstancedMesh(md.glass, M.glass, Math.max(1, n));
        glass.frustumCulled = false;
        glass.count = 0;
        glass.instanceMatrix = near.instanceMatrix; // same instances as the near bodies
        glass.renderOrder = 1;
        this.group.add(glass);
      }
      this.groups.set(type, { near, far, glass });
    }
    for (const sl of this.slots) {
      sl.group = this.groups.get(sl.type)!;
    }
    this.wheel = inst(wheelGeometry(), M.plain, vehicles.length * 4, false);
    for (const [k, n] of exCounts) this.extras.set(k, inst(extraOf(k), M.plain, n, false));
    if (lamps > 0) {
      const box = new THREE.BoxGeometry(1, 1, 1);
      this.lamp = new THREE.InstancedMesh(box, M.lamp, lamps);
      this.lamp.frustumCulled = false;
      this.lamp.count = 0;
      this.lamp.setColorAt(0, _c.set(0xffffff));
      this.lamp.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(this.lamp);
    }
  }

  get size() {
    return this.slots.length;
  }

  /**
   * Put vehicle `i` at (x, y, z) facing `yaw`. `lit`: headlights and tail lights on;
   * `bar`: police lightbar (0 off, 1 red, 2 blue); `roll`: metres rolled since the last
   * call (spins the wheels).
   */
  place(
    i: number,
    x: number,
    y: number,
    z: number,
    yaw: number,
    o: { lit?: boolean; bar?: 0 | 1 | 2; roll?: number } = {},
  ) {
    const sl = this.slots[i];
    if (!sl) return;
    sl.placed = true;
    if (i >= this.dynamic) this.cells = null; // a static vehicle moved: regrid
    sl.x = x;
    sl.y = y;
    sl.z = z;
    sl.frame.compose(_p.set(x, y, z), _q.setFromAxisAngle(_up, yaw), _s.set(1, 1, 1));
    const md = sl.model;
    sl.body
      .copy(sl.frame)
      .multiply(_m.makeScale(sl.v.wid / md.spec.wid, 1, sl.v.len / md.spec.len));
    if (o.roll) sl.spin += o.roll / Math.max(0.2, sl.wheels[0]?.r ?? 0.33);
    sl.lit = !!o.lit;
    sl.bar = o.bar ?? 0;
  }

  /**
   * Once per frame: cull every placed vehicle against `camera`'s frustum, bucket the rest
   * into near / far by distance, and upload.
   */
  commit(camera: THREE.Camera) {
    artFrame();
    const cam = camera.position;
    camera.updateMatrixWorld(); // this frame's pose, not last frame's
    _proj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_proj);
    const lamp = this.lamp;
    for (const g of this.groups.values()) {
      g.near.count = 0;
      g.far.count = 0;
    }
    for (const ex of this.extras.values()) ex.count = 0;
    const near2 = CAR_NEAR * CAR_NEAR;
    const far2 = CAR_FAR * CAR_FAR;
    this.ln = 0;
    this.wn = 0;
    const visit = (sl: Slot) => {
      if (!sl.placed) return;
      const d2 = (sl.x - cam.x) ** 2 + (sl.z - cam.z) ** 2;
      if (d2 > far2) return;
      _sphere.center.set(sl.x, sl.y + 1.2, sl.z);
      _sphere.radius = sl.rad;
      if (!_frustum.intersectsSphere(_sphere)) return;
      const g = sl.group!;
      if (lamp)
        for (const L of sl.lamps) {
          const on =
            L.kind === "sign" ||
            (L.kind === "barR" ? sl.bar === 1 : L.kind === "barB" ? sl.bar === 2 : sl.lit);
          if (!on) continue;
          _m.compose(_p.set(L.x, L.y, L.z), _q.identity(), _s.set(L.sx, L.sy, L.sz));
          lamp.setMatrixAt(this.ln, _m2.multiplyMatrices(sl.frame, _m));
          lamp.setColorAt(
            this.ln++,
            _c.set(
              L.kind === "head"
                ? 0xfff6d8
                : L.kind === "tail"
                  ? 0xff2a1a
                  : L.kind === "barR"
                    ? 0xff2020
                    : L.kind === "barB"
                      ? 0x3060ff
                      : L.color,
            ),
          );
        }
      if (d2 < near2) {
        put(g.near, sl);
        for (const w of sl.wheels) {
          _m.compose(
            _p.set(w.x, w.y, w.z),
            _q.setFromAxisAngle(_x, sl.spin),
            _s.set(w.w, w.r, w.r),
          );
          this.wheel.setMatrixAt(this.wn++, _m2.multiplyMatrices(sl.frame, _m));
        }
        for (const k of sl.extras) {
          const ex = this.extras.get(k)!;
          ex.setMatrixAt(ex.count++, sl.body);
        }
      } else {
        put(g.far, sl);
      }
    };
    for (let i = 0; i < this.dynamic; i++) visit(this.slots[i]!);
    // static vehicles (parked) are culled a grid cell at a time first
    for (const cell of this.staticCells()) {
      const d = Math.hypot(cell.x - cam.x, cell.z - cam.z) - cell.r;
      if (d > CAR_FAR) continue;
      _sphere.center.set(cell.x, cell.y + 1.2, cell.z);
      _sphere.radius = cell.r;
      if (!_frustum.intersectsSphere(_sphere)) continue;
      for (const sl of cell.slots) visit(sl);
    }
    const ln = this.ln;
    const wn = this.wn;
    this.wheel.count = wn;
    this.wheel.visible = wn > 0;
    this.wheel.instanceMatrix.needsUpdate = true;
    for (const g of this.groups.values()) {
      for (const im of [g.near, g.far]) {
        im.visible = im.count > 0;
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
      }
      if (g.glass) {
        g.glass.count = g.near.count;
        g.glass.visible = g.near.count > 0;
      }
    }
    for (const ex of this.extras.values()) {
      ex.visible = ex.count > 0;
      ex.instanceMatrix.needsUpdate = true;
    }
    if (this.lamp) {
      this.lamp.count = ln;
      this.lamp.visible = ln > 0;
      this.lamp.instanceMatrix.needsUpdate = true;
      if (this.lamp.instanceColor) this.lamp.instanceColor.needsUpdate = true;
    }
  }

  /** the static vehicles, grouped into 48 m grid cells with a bounding circle each */
  private staticCells() {
    if (this.cells) return this.cells;
    const map = new Map<string, Slot[]>();
    for (let i = this.dynamic; i < this.slots.length; i++) {
      const sl = this.slots[i]!;
      if (!sl.placed) continue;
      const k = `${Math.floor(sl.x / 48)},${Math.floor(sl.z / 48)}`;
      let list = map.get(k);
      if (!list) map.set(k, (list = []));
      list.push(sl);
    }
    this.cells = [...map.values()].map((slots) => {
      let x = 0;
      let y = 0;
      let z = 0;
      for (const sl of slots) {
        x += sl.x / slots.length;
        y += sl.y / slots.length;
        z += sl.z / slots.length;
      }
      let r = 0;
      for (const sl of slots) r = Math.max(r, Math.hypot(sl.x - x, sl.z - z) + sl.rad);
      return { x, y, z, r: r + 3, slots };
    });
    return this.cells;
  }

  /** the lamps of vehicle `i` in car space (police lightbar spots, sign positions) */
  lampsOf(i: number) {
    return this.slots[i]?.lamps ?? [];
  }

  dispose() {
    // geometries and materials are shared and cached; only the instance buffers go
    this.group.traverse((o) => {
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
    });
    this.group.clear();
  }
}

/** append a vehicle's body instance (matrix + paint) straight into an InstancedMesh's arrays */
function put(im: THREE.InstancedMesh, sl: Slot) {
  const i = im.count++;
  (im.instanceMatrix.array as Float32Array).set(sl.body.elements, i * 16);
  const c = im.instanceColor!.array as Float32Array;
  c[i * 3] = sl.rgb[0];
  c[i * 3 + 1] = sl.rgb[1];
  c[i * 3 + 2] = sl.rgb[2];
}

// ---------------------------------------------------------------- baked cars
/** the lamps of a vehicle in car space (for lights that live elsewhere, e.g. blockade flashers) */
export function vehicleLamps(v: Vehicle) {
  return vehicleModel(vehicleModelKey(v)).lamps(v);
}

/**
 * Bake a parked vehicle (lean model, lights off) into chunk geometry at (x, y, z), turned by
 * `rot` (same convention as rotation.y). Paint parts take the vehicle's colour.
 */
export function bakeCar(
  D: Geo,
  v: Vehicle,
  x: number,
  y: number,
  z: number,
  rot: number,
  layer = 0,
) {
  const md = vehicleModel(vehicleModelKey(v));
  const g = md.far;
  const pos = g.getAttribute("position");
  const nor = g.getAttribute("normal");
  const col = g.getAttribute("color");
  const surf = g.getAttribute("aSurf");
  const kx = v.wid / md.spec.wid;
  const kz = v.len / md.spec.len;
  const s = Math.sin(rot);
  const c = Math.cos(rot);
  const paint = _c.set(v.color);
  const pr = paint.r;
  const pg = paint.g;
  const pb = paint.b;
  D.mat(layer, 0.5, 0);
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i) * kx;
    const ly = pos.getY(i);
    const lz = pos.getZ(i) * kz;
    let nx = nor.getX(i) / kx;
    const ny = nor.getY(i);
    let nz = nor.getZ(i) / kz;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    nz /= nl;
    const p = surf.getW(i);
    const r = col.getX(i) * (p > 0.5 ? pr : 1);
    const gg = col.getY(i) * (p > 0.5 ? pg : 1);
    const b = col.getZ(i) * (p > 0.5 ? pb : 1);
    D.colLinear(r, gg, b);
    D.v(
      x + lx * c + lz * s,
      y + ly,
      z - lx * s + lz * c,
      nx * c + nz * s,
      ny / nl,
      -nx * s + nz * c,
    );
  }
}
