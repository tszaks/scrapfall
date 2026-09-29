// Low-poly vehicle catalogue shared by parked cars (level layout), moving traffic
// and the instanced car renderer. Every part is a unit box or wheel scaled per
// instance, so all cars of every type draw in three instanced meshes.

export type VehicleType =
  "compact" | "sedan" | "suv" | "pickup" | "sports" | "taxi" | "police" | "van" | "bus";

type Spec = {
  len: number;
  wid: number;
  /** lower body height */
  body: number;
  /** ground clearance */
  ride: number;
  cabLen: number;
  cabH: number;
  /** cabin centre offset along the length (+ = toward the front) */
  cabOff: number;
  wheel: number;
  /** how hard it bumps the player around */
  mass: number;
};

export const SPECS: Record<VehicleType, Spec> = {
  compact: {
    len: 3.6,
    wid: 1.65,
    body: 0.55,
    ride: 0.2,
    cabLen: 1.9,
    cabH: 0.6,
    cabOff: -0.15,
    wheel: 0.3,
    mass: 0.75,
  },
  sedan: {
    len: 4.5,
    wid: 1.8,
    body: 0.55,
    ride: 0.22,
    cabLen: 2.1,
    cabH: 0.55,
    cabOff: -0.2,
    wheel: 0.33,
    mass: 1,
  },
  suv: {
    len: 4.8,
    wid: 1.95,
    body: 0.8,
    ride: 0.32,
    cabLen: 2.7,
    cabH: 0.65,
    cabOff: -0.35,
    wheel: 0.4,
    mass: 1.35,
  },
  pickup: {
    len: 5.4,
    wid: 2.0,
    body: 0.75,
    ride: 0.34,
    cabLen: 1.6,
    cabH: 0.7,
    cabOff: 0.55,
    wheel: 0.42,
    mass: 1.4,
  },
  sports: {
    len: 4.4,
    wid: 1.95,
    body: 0.45,
    ride: 0.12,
    cabLen: 1.5,
    cabH: 0.42,
    cabOff: -0.3,
    wheel: 0.34,
    mass: 0.9,
  },
  taxi: {
    len: 4.6,
    wid: 1.82,
    body: 0.55,
    ride: 0.22,
    cabLen: 2.1,
    cabH: 0.56,
    cabOff: -0.2,
    wheel: 0.33,
    mass: 1,
  },
  police: {
    len: 4.7,
    wid: 1.85,
    body: 0.58,
    ride: 0.22,
    cabLen: 2.1,
    cabH: 0.55,
    cabOff: -0.2,
    wheel: 0.34,
    mass: 1.1,
  },
  van: {
    len: 6.2,
    wid: 2.2,
    body: 0.9,
    ride: 0.4,
    cabLen: 1.2,
    cabH: 0.8,
    cabOff: 2.2,
    wheel: 0.45,
    mass: 1.9,
  },
  bus: {
    len: 8.8,
    wid: 2.4,
    body: 2.4,
    ride: 0.35,
    cabLen: 7.4,
    cabH: 0.85,
    cabOff: 0,
    wheel: 0.5,
    mass: 3,
  },
};

/** Realistic street palette with a few loud Vice City pastels mixed in. */
export const PAINT = [
  0xf2f2ee,
  0xe6e4de,
  0xf6f6f6, // whites
  0xb8bcc2,
  0x9ea3aa,
  0x7c8088, // silvers / greys
  0x18191c,
  0x26282c, // blacks
  0xb3202a,
  0x8a1a1e, // reds
  0x1f3f8a,
  0x3a6ab8,
  0x16284a, // blues
  0x1f4a32,
  0x4a5a3a, // greens
  0xc8b48a,
  0x6a4a32, // beige / brown
  0x2ec4b6,
  0xff6fae,
  0xa8e04a,
  0x7a4ab0,
  0xff8a2a,
  0x9ee0c8, // pastels + loud
];

export const EXTRA_ROOF_RACK = 1;
export const EXTRA_SPOILER = 2;
export const EXTRA_LADDER = 4;

export type Vehicle = {
  type: VehicleType;
  variant?: "lifeguard" | "coastal-patrol" | undefined;
  len: number;
  wid: number;
  wheel: number;
  color: number;
  extras: number;
  mass: number;
};

const WEIGHTS: [VehicleType, number][] = [
  ["sedan", 22],
  ["compact", 14],
  ["suv", 14],
  ["pickup", 10],
  ["sports", 8],
  ["taxi", 10],
  ["van", 7],
  ["police", 5],
  ["bus", 4],
];

/** Pick a vehicle deterministically from a seeded rand. `maxLen` excludes long types. */
export function makeVehicle(
  rand: () => number,
  maxLen = Infinity,
  only?: VehicleType[],
): Vehicle | null {
  const pool = WEIGHTS.filter(
    ([t]) => SPECS[t].len * 0.92 <= maxLen && (!only || only.includes(t)),
  );
  if (pool.length === 0) return null;
  const total = pool.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  let type: VehicleType = pool[0]![0];
  for (const [t, w] of pool) {
    r -= w;
    if (r <= 0) {
      type = t;
      break;
    }
  }
  const s = SPECS[type];
  const fixedSize = type === "bus" || type === "police" || type === "taxi";
  let len = s.len * (fixedSize ? 1 : 0.92 + rand() * 0.16);
  const wid = s.wid * (fixedSize ? 1 : 0.94 + rand() * 0.12);
  len = Math.min(len, maxLen);
  const wheel = s.wheel * (0.9 + rand() * 0.2);
  const color =
    type === "taxi"
      ? 0xf2c21a
      : type === "police"
        ? 0x151518
        : type === "bus"
          ? rand() < 0.5
            ? 0xf0efe8
            : 0x2ec4b6
          : PAINT[Math.floor(rand() * PAINT.length)]!;
  let extras = 0;
  const roll = rand();
  if ((type === "suv" || type === "compact") && roll < 0.35) extras |= EXTRA_ROOF_RACK;
  if (type === "sports" && roll < 0.55) extras |= EXTRA_SPOILER;
  if ((type === "pickup" || type === "van") && roll < 0.4) extras |= EXTRA_LADDER;
  return { type, len, wid, wheel, color, extras, mass: s.mass * (len / s.len) };
}

export type PartKind = "paint" | "wheel" | "head" | "tail" | "sign" | "barR" | "barB";
/** A unit-box (or unit wheel) part in car-local space: +z is forward, y up. */
export type Part = {
  kind: PartKind;
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  color: number;
};

const GLASS = 0x1b2530;
const TRIM = 0x2a2b2e;
const CHROME = 0x9a9ea4;

/** Break a vehicle into scaled unit parts. */
export function vehicleParts(v: Vehicle): Part[] {
  const s = SPECS[v.type];
  const k = v.len / s.len; // length scale for this car
  const L = v.len;
  const W = v.wid;
  const out: Part[] = [];
  const box = (
    kind: PartKind,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    color: number,
  ) => out.push({ kind, x, y, z, sx, sy, sz, color });
  const baseY = s.ride;
  const topY = baseY + s.body;

  if (v.type === "bus") {
    box("paint", 0, baseY + s.body / 2, 0, W, s.body, L, v.color);
    // livery stripe + window band down both sides, big windscreen
    box(
      "paint",
      0,
      baseY + 0.55,
      0,
      W + 0.02,
      0.28,
      L * 0.98,
      v.color === 0xf0efe8 ? 0x1aa8a0 : 0xf2f2ee,
    );
    box("paint", 0, baseY + 1.62, -0.3, W + 0.03, 0.8, L * 0.8, GLASS);
    box("paint", 0, baseY + 1.35, L / 2 + 0.01, W * 0.9, 1.3, 0.04, GLASS);
    box("paint", 0, topY + 0.12, -0.5, W * 0.6, 0.24, 2.2, 0xcfd2d6); // roof AC pod
    box("sign", 0, topY - 0.25, L / 2 + 0.02, W * 0.7, 0.22, 0.03, 0xffa21a); // route sign
  } else if (v.type === "van") {
    const cargoLen = L * 0.66;
    const cabLen = L - cargoLen;
    // cab up front, tall box behind
    box("paint", 0, baseY + s.body / 2, L / 2 - cabLen / 2, W * 0.96, s.body, cabLen, v.color);
    box(
      "paint",
      0,
      topY + s.cabH / 2,
      L / 2 - cabLen / 2 - 0.1,
      W * 0.9,
      s.cabH,
      cabLen * 0.75,
      GLASS,
    );
    box(
      "paint",
      0,
      topY + s.cabH + 0.04,
      L / 2 - cabLen / 2 - 0.1,
      W * 0.92,
      0.08,
      cabLen * 0.8,
      v.color,
    );
    box(
      "paint",
      0,
      baseY + 1.25,
      -L / 2 + cargoLen / 2,
      W,
      2.3,
      cargoLen,
      v.color === 0x18191c ? 0xf2f2ee : 0xeceae4,
    );
    box("paint", 0, baseY + 0.9, -L / 2 + cargoLen / 2, W + 0.02, 0.22, cargoLen * 0.9, v.color);
    if (v.extras & EXTRA_LADDER) {
      box("paint", 0, baseY + 2.5, -L / 2 + cargoLen / 2, W * 0.8, 0.08, cargoLen * 0.9, CHROME);
      box("paint", 0.3, baseY + 2.6, -L / 2 + cargoLen / 2, 0.12, 0.1, cargoLen * 0.8, 0xc8a040);
    }
  } else {
    box("paint", 0, baseY + s.body / 2, 0, W, s.body, L, v.color);
    const cabL = s.cabLen * k;
    const cz = s.cabOff * k;
    box("paint", 0, topY + s.cabH / 2, cz, W * 0.86, s.cabH, cabL, GLASS);
    box("paint", 0, topY + s.cabH + 0.03, cz, W * 0.84, 0.06, cabL * 0.9, v.color);
    if (v.type === "pickup") {
      // open bed: side rails and tailgate behind the cab
      const bedL = L / 2 + cz - cabL / 2 - 0.1;
      const bz = -L / 2 + bedL / 2 + 0.05;
      box("paint", W / 2 - 0.08, topY + 0.2, bz, 0.12, 0.4, bedL, v.color);
      box("paint", -W / 2 + 0.08, topY + 0.2, bz, 0.12, 0.4, bedL, v.color);
      box("paint", 0, topY + 0.2, -L / 2 + 0.08, W, 0.4, 0.12, v.color);
      if (v.extras & EXTRA_LADDER) {
        box("paint", 0, topY + s.cabH + 0.35, bz, W * 0.9, 0.08, 0.08, CHROME);
        box("paint", 0, topY + s.cabH + 0.35, bz - bedL * 0.4, W * 0.9, 0.08, 0.08, CHROME);
        box(
          "paint",
          W * 0.3,
          topY + s.cabH + 0.42,
          bz - bedL * 0.1,
          0.1,
          0.08,
          bedL * 1.2,
          0xc8a040,
        );
      }
    }
    if (v.extras & EXTRA_ROOF_RACK) {
      box("paint", W * 0.33, topY + s.cabH + 0.12, cz, 0.06, 0.06, cabL * 0.85, TRIM);
      box("paint", -W * 0.33, topY + s.cabH + 0.12, cz, 0.06, 0.06, cabL * 0.85, TRIM);
      box("paint", 0, topY + s.cabH + 0.22, cz, W * 0.6, 0.18, cabL * 0.5, 0x333a44);
    }
    if (v.extras & EXTRA_SPOILER) {
      box("paint", 0, topY + 0.28, -L / 2 + 0.25, W * 0.9, 0.06, 0.35, TRIM);
      box("paint", W * 0.3, topY + 0.14, -L / 2 + 0.3, 0.06, 0.26, 0.12, TRIM);
      box("paint", -W * 0.3, topY + 0.14, -L / 2 + 0.3, 0.06, 0.26, 0.12, TRIM);
    }
    if (v.type === "taxi") box("sign", 0, topY + s.cabH + 0.17, cz, 0.7, 0.22, 0.3, 0xfff2a0);
    if (v.type === "police") {
      // white doors + red/blue lightbar
      box("paint", W / 2 + 0.01, baseY + s.body * 0.5, 0.1, 0.02, s.body * 0.8, 2.0, 0xf4f4f4);
      box("paint", -W / 2 - 0.01, baseY + s.body * 0.5, 0.1, 0.02, s.body * 0.8, 2.0, 0xf4f4f4);
      box("barR", -0.3, topY + s.cabH + 0.13, cz, 0.55, 0.16, 0.26, 0xff2020);
      box("barB", 0.3, topY + s.cabH + 0.13, cz, 0.55, 0.16, 0.26, 0x2050ff);
    }
  }
  // bumpers, lights and wheels are common to every body type
  box("paint", 0, baseY + 0.12, L / 2 + 0.04, W * 1.01, 0.18, 0.1, TRIM);
  box("paint", 0, baseY + 0.12, -L / 2 - 0.04, W * 1.01, 0.18, 0.1, TRIM);
  const lampY = v.type === "bus" ? baseY + 0.45 : baseY + s.body * 0.62;
  box("head", W / 2 - 0.3, lampY, L / 2 + 0.02, 0.34, 0.14, 0.05, 0xffffff);
  box("head", -W / 2 + 0.3, lampY, L / 2 + 0.02, 0.34, 0.14, 0.05, 0xffffff);
  box("tail", W / 2 - 0.26, lampY, -L / 2 - 0.02, 0.3, 0.14, 0.05, 0xff2020);
  box("tail", -W / 2 + 0.26, lampY, -L / 2 - 0.02, 0.3, 0.14, 0.05, 0xff2020);
  const r = v.wheel;
  const wz = L / 2 - r - (v.type === "bus" ? 1.1 : 0.45);
  for (const z of [wz, -wz]) {
    for (const x of [W / 2 - 0.12, -W / 2 + 0.12]) {
      out.push({
        kind: "wheel",
        x,
        y: r,
        z,
        sx: r * 2,
        sy: r * 2,
        sz: v.type === "bus" || v.type === "van" ? 0.34 : 0.26,
        color: 0x151515,
      });
    }
  }
  return out;
}

/** Total height, used for the collision block of a parked car. */
export function vehicleHeight(v: Vehicle) {
  const s = SPECS[v.variant ? "pickup" : v.type];
  if (v.type === "van") return s.ride + 2.4;
  if (v.type === "bus") return s.ride + s.body;
  return s.ride + s.body + s.cabH;
}
