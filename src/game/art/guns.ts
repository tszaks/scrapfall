// First-person gun models for every weapon, built with the art kit.
//
// Gun space: the barrel points down -z, y is up, the origin sits just above the grip. Each
// gun owns its muzzle socket, including barrel attachments, so effects leave the bore
// through the same complete transform as the rendered model. Most shapes are side profiles (x = distance forward, y = up) extruded to a
// width, the way real receivers and slides are machined from plate.
import * as THREE from "three";

import { Model, SURF, type Surf, type V3 } from "./kit";

export type GunId =
  | "pistol"
  | "scatter"
  | "smg"
  | "rail"
  | "cannon"
  | "rebound"
  | "harpoon"
  | "cryo"
  | "flak"
  | "tesla"
  | "revolver"
  | "minigun"
  | "crossbow"
  | "plasma"
  | "voidorb"
  | "shatter";

export type PistolMods = Partial<
  Record<
    | "burst"
    | "incend"
    | "magnum"
    | "extmag"
    | "shred"
    | "laser"
    | "comp"
    | "suppr"
    | "exec"
    | "holster"
    | "bounty",
    boolean
  >
>;

/** a moving piece: its own geometry (authored in gun space) and the pivot it moves about */
export type GunPart = {
  name:
    | "slide"
    | "pump"
    | "drum"
    | "cyl"
    | "barrels"
    | "coil"
    | "disc"
    | "spear"
    | "bolt"
    | "ring"
    | "mag"
    | "bar";
  geo: THREE.BufferGeometry;
  pivot: V3;
  /** pulsing glow (gets its own material so its glow can throb) */
  pulse?: boolean;
};
export type GunBuild = {
  body: THREE.BufferGeometry;
  parts: GunPart[];
  /** the laser sight beam's start (pistol laser mod), if any */
  laser: V3 | null;
  verts: number;
  muzzle: V3;
};

/** Barrel outlets in model space; the rendered socket is the source of firing effects. */
const MUZZLES: Record<GunId, V3> = {
  pistol: [0, 0, -0.34],
  scatter: [0, 0, -0.62],
  smg: [0, 0, -0.56],
  rail: [0, 0, -0.72],
  cannon: [0, 0, -0.56],
  rebound: [0, 0.06, -0.44],
  harpoon: [0, 0.02, -0.72],
  cryo: [0, 0, -0.62],
  flak: [0, 0, -0.63],
  tesla: [0, 0, -0.48],
  revolver: [0, 0.02, -0.48],
  minigun: [0, 0, -0.6],
  crossbow: [0, 0, -0.5],
  plasma: [0, 0, -0.48],
  voidorb: [0, 0, -0.5],
  shatter: [0, 0, -0.56],
};
export function gunMuzzle(w: GunId, mods: PistolMods = {}): V3 {
  if (w !== "pistol") return MUZZLES[w];
  return [0, 0, -(mods.magnum ? 0.48 : 0.34) - (mods.suppr ? 0.2 : mods.comp ? 0.065 : 0)];
}

const PI = Math.PI;
const S = SURF;
// shared palette
const GM = "#3a3d43"; // gunmetal
const BLK = "#27282c"; // polymer
const STL = "#8d9299"; // bare steel
const DRK = "#3b3e44";
const WOOD = "#6e4526";
const WOOD2 = "#50301a";
const BRASS = "#b8903e";
const RUB = "#2a2a2c";

type Pt = readonly [number, number];
/** extrude a side profile (x = forward = -z, y = up) to `width` (centred on x = `xo`) */
function side(
  m: Model,
  outline: Pt[],
  width: number,
  color: THREE.ColorRepresentation,
  surf: Surf,
  o: { xo?: number; bevel?: number; holes?: Pt[][]; lod?: 0 | 1 } = {},
) {
  m.push([o.xo ?? 0, 0, 0], [0, PI / 2, 0]);
  m.extrude(outline, width, [0, 0, 0], color, surf, {
    bevel: o.bevel ?? 0.003,
    ...(o.holes ? { holes: o.holes } : {}),
    ...(o.lod !== undefined ? { lod: o.lod } : {}),
  });
  m.pop();
}
/** a barrel along z from zFront (more negative) to zBack */
function barrel(
  m: Model,
  r: number,
  zFront: number,
  zBack: number,
  y: number,
  color: THREE.ColorRepresentation,
  surf: Surf,
  o: { x?: number; seg?: number; rb?: number } = {},
) {
  m.tubeZ(r, zBack - zFront, [o.x ?? 0, y, (zFront + zBack) / 2], color, surf, {
    seg: o.seg ?? 16,
    ...(o.rb !== undefined ? { rb: o.rb } : {}),
  });
}
/** the dark bore at a muzzle face */
function bore(m: Model, r: number, z: number, y: number, x = 0) {
  m.tubeZ(r, 0.004, [x, y, z - 0.001], "#050506", S.rubber, { seg: 12 });
}
/** a row of rings along z (cooling fins, coil windings) */
function rings(
  m: Model,
  R: number,
  tube: number,
  z0: number,
  z1: number,
  n: number,
  y: number,
  color: THREE.ColorRepresentation,
  surf: Surf,
  x = 0,
) {
  for (let i = 0; i < n; i++) {
    const z = n === 1 ? z0 : z0 + ((z1 - z0) * i) / (n - 1);
    m.torus(R, tube, [x, y, z], color, surf, { seg: 14 });
  }
}
/** picatinny-style rail teeth along the top */
function rail(m: Model, z0: number, z1: number, y: number, w = 0.03) {
  m.box(w, 0.008, z1 - z0, [0, y, (z0 + z1) / 2], BLK, S.gunmetal);
  const n = Math.max(2, Math.round((z1 - z0) / 0.018));
  for (let i = 0; i < n; i++)
    m.box(
      w + 0.006,
      0.006,
      0.008,
      [0, y + 0.006, z0 + ((z1 - z0) * (i + 0.5)) / n],
      GM,
      S.gunmetal,
      { lod: 1 },
    );
}
/** a pistol grip hanging from (f, y) (f = forward distance), angled back */
function grip(
  m: Model,
  f: number,
  y: number,
  len: number,
  width: number,
  color: THREE.ColorRepresentation,
  surf: Surf,
  rake = 0.3,
) {
  const b = Math.tan(rake) * len;
  side(
    m,
    [
      [f + 0.035, y],
      [f - 0.035, y],
      [f - 0.045 - b, y - len],
      [f + 0.03 - b, y - len - 0.01],
      [f + 0.042 - b * 0.5, y - len * 0.5],
    ],
    width,
    color,
    surf,
    { bevel: 0.005 },
  );
  // stippled panels
  side(
    m,
    [
      [f + 0.025, y - 0.015],
      [f - 0.028, y - 0.015],
      [f - 0.036 - b * 0.9, y - len + 0.015],
      [f + 0.02 - b * 0.9, y - len + 0.012],
    ],
    width + 0.006,
    "#101113",
    S.rubber,
    { bevel: 0.001, lod: 1 },
  );
}
/** trigger guard + trigger below the receiver at forward distance f */
function trigger(
  m: Model,
  f: number,
  y: number,
  width = 0.018,
  color: THREE.ColorRepresentation = BLK,
  surf: Surf = S.polymer,
) {
  side(
    m,
    [
      [f + 0.06, y],
      [f + 0.06, y - 0.01],
      [f + 0.05, y - 0.055],
      [f - 0.01, y - 0.06],
      [f - 0.015, y - 0.05],
      [f - 0.005, y - 0.05],
      [f + 0.042, y - 0.046],
      [f + 0.05, y - 0.01],
      [f + 0.05, y],
    ],
    width,
    color,
    surf,
    { bevel: 0.002 },
  );
  side(
    m,
    [
      [f + 0.03, y],
      [f + 0.02, y],
      [f + 0.012, y - 0.03],
      [f + 0.02, y - 0.036],
    ],
    0.008,
    STL,
    S.steel,
    { bevel: 0.001 },
  );
}
function scope(m: Model, z0: number, z1: number, y: number, r: number, lens: string) {
  barrel(m, r, z0, z1, y, BLK, S.gunmetal, { seg: 14 });
  barrel(m, r * 1.3, z0 - 0.01, z0 + 0.03, y, BLK, S.gunmetal, { seg: 14 });
  barrel(m, r * 1.2, z1 - 0.025, z1 + 0.005, y, BLK, S.gunmetal, { seg: 14 });
  m.tubeZ(r * 1.12, 0.004, [0, y, z0 - 0.012], lens, S.lens, { seg: 14 });
  m.cyl(r * 0.45, r * 0.9, [0, y + r * 1.2, (z0 + z1) / 2], BLK, S.gunmetal, { seg: 10 });
  m.cyl(r * 0.45, r * 0.9, [r * 1.2, y, (z0 + z1) / 2], BLK, S.gunmetal, {
    seg: 10,
    rot: [0, 0, PI / 2],
  });
  for (const z of [z0 + 0.04, z1 - 0.05])
    m.box(r * 1.4, 0.03, 0.022, [0, y - r - 0.012, z], GM, S.gunmetal, { bevel: 0.003 });
}

type Build = (
  m: Model,
  add: (name: GunPart["name"], pivot: V3, fn: (p: Model) => void, pulse?: boolean) => void,
  col: string,
  body: string,
) => V3 | null | void;

// ---------------------------------------------------------------- PISTOL (+ mods)
function pistol(mods: PistolMods): Build {
  return (m, add, col) => {
    const L = mods.magnum ? 0.48 : 0.34;
    const slideCol = mods.magnum ? "#2f2c28" : GM;
    // frame: dust cover, rail, grip, trigger guard
    side(
      m,
      [
        [L - 0.035, -0.022],
        [0.06, -0.022],
        [0.06, -0.05],
        [L - 0.05, -0.05],
        [L - 0.035, -0.04],
      ],
      0.07,
      BLK,
      S.polymer,
      { bevel: 0.004 },
    );
    for (let i = 0; i < 3; i++)
      m.box(0.072, 0.006, 0.012, [0, -0.052, -(L - 0.08) + i * 0.022], "#111", S.polymer, {
        lod: 1,
      });
    side(
      m,
      [
        [0.07, -0.022],
        [-0.05, -0.022],
        [-0.06, -0.035],
        [-0.045, -0.05],
        [0.07, -0.05],
      ],
      0.072,
      BLK,
      S.polymer,
      { bevel: 0.004 },
    );
    if (mods.holster) {
      grip(m, 0.0, -0.045, 0.16, 0.064, BLK, S.polymer);
      for (const x of [-0.036, 0.036])
        side(
          m,
          [
            [0.03, -0.06],
            [-0.035, -0.06],
            [-0.075, -0.19],
            [-0.015, -0.195],
          ],
          0.006,
          "#3fae5a",
          S.enamel,
          {
            xo: x,
            holes: [
              [
                [0.012, -0.08],
                [-0.02, -0.08],
                [-0.045, -0.16],
                [-0.02, -0.165],
              ],
            ],
          },
        );
    } else grip(m, 0.0, -0.045, 0.16, 0.066, BLK, S.polymer);
    trigger(m, 0.1, -0.05);
    // magazine base plate (extended / burst / drum)
    const magY = -0.2;
    if (mods.extmag) {
      m.tubeX(0.045, 0.07, [0, magY - 0.03, 0.06], "#262626", S.darkSteel, { seg: 16 });
      m.tubeX(0.024, 0.074, [0, magY - 0.03, 0.06], STL, S.steel, { seg: 10 });
    } else if (mods.burst) {
      side(
        m,
        [
          [0.02, magY + 0.01],
          [-0.06, magY + 0.01],
          [-0.075, magY - 0.07],
          [0.005, magY - 0.075],
        ],
        0.05,
        "#1d2226",
        S.polymer,
      );
      side(
        m,
        [
          [0.01, magY - 0.01],
          [-0.05, magY - 0.01],
          [-0.06, magY - 0.05],
          [0.0, magY - 0.05],
        ],
        0.052,
        "#4fd6ff",
        S.glowSoft,
      );
    } else
      side(
        m,
        [
          [0.03, magY + 0.005],
          [-0.055, magY + 0.005],
          [-0.06, magY - 0.012],
          [0.028, magY - 0.012],
        ],
        0.07,
        GM,
        S.gunmetal,
      );
    // barrel (static; the slide rides over it)
    barrel(m, 0.013, -L, -L + 0.03, 0, STL, S.brushed);
    bore(m, 0.008, -L, 0);
    // rear hammer
    if (mods.exec) {
      m.box(0.022, 0.05, 0.03, [0, 0.03, 0.06], "#6a1010", S.enamel, {
        rot: [-0.5, 0, 0],
        bevel: 0.004,
      });
      m.box(0.036, 0.014, 0.014, [0, 0.052, 0.072], "#c8c8c8", S.chrome, { bevel: 0.003 });
      for (let i = 0; i < 4; i++)
        m.box(0.038, 0.004, 0.004, [0, 0.06, 0.066 + i * 0.005], "#c8c8c8", S.chrome, { lod: 1 });
    } else
      m.box(0.016, 0.03, 0.02, [0, 0.02, 0.05], GM, S.gunmetal, {
        rot: [-0.4, 0, 0],
        bevel: 0.003,
      });
    // muzzle devices (static, on the barrel)
    let tip = -L;
    if (mods.suppr) {
      barrel(m, 0.032, tip - 0.2, tip + 0.005, 0, "#141414", S.darkSteel, { seg: 20 });
      rings(m, 0.032, 0.003, tip - 0.19, tip - 0.01, 5, 0, "#222", S.gunmetal);
      bore(m, 0.009, tip - 0.2, 0);
      tip -= 0.2;
    } else if (mods.comp) {
      m.box(0.064, 0.056, 0.07, [0, 0.008, tip - 0.03], "#44464b", S.gunmetal, { bevel: 0.006 });
      for (let i = 0; i < 3; i++)
        m.box(0.03, 0.01, 0.01, [0, 0.036, tip - 0.012 - i * 0.02], "#0a0a0a", S.rubber);
      bore(m, 0.009, tip - 0.065, 0);
      tip -= 0.065;
    }
    if (mods.shred) {
      for (let k = 0; k < 3; k++) {
        m.push([0, 0, tip - 0.012 - k * 0.022], [0, 0, k * 0.5]);
        for (let t = 0; t < 6; t++)
          m.box(
            0.012,
            0.03,
            0.012,
            [Math.sin((t * PI) / 3) * 0.034, Math.cos((t * PI) / 3) * 0.034, 0],
            "#9a9a9a",
            S.steel,
            { rot: [0, 0, (-t * PI) / 3] },
          );
        m.torus(0.03, 0.006, [0, 0, 0], "#7a7a7a", S.steel);
        m.pop();
      }
    }
    if (mods.burst)
      for (const x of [-0.022, 0, 0.022])
        m.box(0.01, 0.01, 0.02, [x, -0.03, -L + 0.02], "#4fd6ff", S.glow);
    if (mods.incend) {
      barrel(m, 0.02, -L + 0.06, -0.08, -0.07, "#3a2a22", S.darkSteel, { seg: 12 });
      barrel(m, 0.016, -L + 0.08, -0.1, -0.07, "#ff5a1f", S.glow, { seg: 12 });
      for (const z of [-L + 0.07, -0.09]) m.torus(0.021, 0.004, [0, -0.07, z], STL, S.steel);
    }
    if (mods.bounty)
      m.box(0.036, 0.022, 0.05, [0, -0.1, -0.075], "#39c6ff", S.glow, { bevel: 0.004 });
    let laser: V3 | null = null;
    if (mods.laser) {
      m.box(0.034, 0.032, 0.1, [0.034, -0.066, -L + 0.08], "#222", S.polymer, { bevel: 0.005 });
      m.tubeZ(0.007, 0.004, [0.04, -0.066, -L + 0.028], "#ff2020", S.glow, { seg: 10 });
      laser = [0.04, -0.066, -L + 0.026];
    }
    if (mods.magnum) {
      m.box(0.018, 0.006, L - 0.1, [0, 0.041, -(L + 0.02) / 2], "#e8b93a", S.brass);
      for (const x of [-0.038, 0.038])
        m.box(0.003, 0.008, L - 0.12, [x, 0.01, -(L + 0.02) / 2], "#e8b93a", S.brass);
    }
    // the slide: machined steel with cocking serrations, ejection port and sights
    add("slide", [0, 0, 0], (p) => {
      side(
        p,
        [
          [L, -0.02],
          [-0.045, -0.02],
          [-0.045, 0.028],
          [-0.035, 0.038],
          [L - 0.012, 0.038],
          [L, 0.026],
        ],
        0.074,
        slideCol,
        S.gunmetal,
        { bevel: 0.004 },
      );
      for (let i = 0; i < 6; i++)
        p.box(0.08, 0.034, 0.004, [0, 0.012, 0.012 + i * 0.008], "#15161a", S.darkSteel, {
          lod: 1,
        });
      for (let i = 0; i < 3; i++)
        p.box(0.08, 0.03, 0.004, [0, 0.012, -L + 0.03 + i * 0.008], "#15161a", S.darkSteel, {
          lod: 1,
        });
      p.box(0.012, 0.022, 0.06, [0.034, 0.02, -0.09], "#0b0b0c", S.rubber);
      p.box(0.008, 0.016, 0.05, [0.036, 0.019, -0.09], BRASS, S.brass);
      // sights with tritium dots in the gun's accent colour
      p.box(0.036, 0.014, 0.016, [0, 0.046, 0.02], BLK, S.gunmetal, { bevel: 0.002 });
      for (const x of [-0.011, 0.011]) p.box(0.006, 0.006, 0.004, [x, 0.05, 0.029], col, S.glow);
      p.box(0.01, 0.012, 0.018, [0, 0.044, -L + 0.03], BLK, S.gunmetal);
      p.box(0.005, 0.005, 0.004, [0, 0.049, -L + 0.021], col, S.glow);
      p.bolts([-0.038, 0.0, -0.02], [-0.038, 0.0, -L + 0.05], 3, 0.004, STL);
    });
    return laser;
  };
}

// ---------------------------------------------------------------- SCATTER: pump shotgun
const scatter: Build = (m, add, col) => {
  // receiver
  side(
    m,
    [
      [0.06, -0.035],
      [-0.12, -0.035],
      [-0.12, 0.03],
      [-0.1, 0.04],
      [0.05, 0.04],
      [0.06, 0.03],
    ],
    0.06,
    "#35373c",
    S.blued,
    { bevel: 0.005 },
  );
  m.box(0.062, 0.018, 0.08, [0.0, 0.0, 0.03], "#101012", S.rubber); // ejection port side
  for (let i = 0; i < 4; i++)
    m.tubeX(0.01, 0.075, [0, -0.012, 0.03 - i * 0.022], "#b22a1c", S.polymer, { seg: 8 });
  m.box(0.064, 0.008, 0.07, [0, -0.012, -0.055], col, S.glowSoft);
  // barrel + magazine tube
  barrel(m, 0.021, -0.62, -0.06, 0, "#2a2c30", S.blued);
  bore(m, 0.016, -0.62, 0);
  m.torus(0.021, 0.004, [0, 0, -0.6], STL, S.steel);
  m.sphere(0.006, [0, 0.024, -0.605], BRASS, S.brass);
  m.box(0.01, 0.006, 0.5, [0, 0.023, -0.34], "#222", S.gunmetal); // vent rib
  barrel(m, 0.018, -0.56, -0.06, -0.045, "#2a2c30", S.blued);
  m.box(0.03, 0.02, 0.03, [0, -0.025, -0.56], "#2a2c30", S.blued, { bevel: 0.004 });
  trigger(m, -0.07, -0.035, 0.02, "#222", S.gunmetal);
  // wooden stock with a rubber butt pad, and a grip wrist
  side(
    m,
    [
      [-0.12, 0.025],
      [-0.12, -0.035],
      [-0.15, -0.07],
      [-0.18, -0.08],
      [-0.22, -0.088],
      [-0.23, -0.03],
      [-0.22, 0.02],
      [-0.15, 0.022],
    ],
    0.05,
    WOOD,
    S.wood,
    { bevel: 0.008 },
  );
  side(
    m,
    [
      [-0.23, 0.025],
      [-0.25, 0.025],
      [-0.25, -0.092],
      [-0.23, -0.092],
    ],
    0.054,
    RUB,
    S.rubber,
    { bevel: 0.004 },
  );
  m.bolts([0.028, 0.0, 0.14], [0.028, 0.0, 0.2], 2, 0.004, STL);
  // the pump forend (racks back after each shot)
  add("pump", [0, 0, 0], (p) => {
    side(
      p,
      [
        [0.46, -0.02],
        [0.24, -0.02],
        [0.23, -0.06],
        [0.25, -0.075],
        [0.45, -0.075],
        [0.47, -0.06],
      ],
      0.056,
      WOOD2,
      S.wood,
      { bevel: 0.008 },
    );
    for (let i = 0; i < 6; i++)
      p.box(0.058, 0.004, 0.006, [0, -0.07, -0.26 - i * 0.03], "#2a1a0e", S.wood, { lod: 1 });
    barrel(p, 0.021, -0.23, -0.2, -0.045, "#333", S.gunmetal);
  });
};

// ---------------------------------------------------------------- BUZZER: compact SMG
const smg: Build = (m, add, col, body) => {
  side(
    m,
    [
      [0.34, -0.03],
      [-0.08, -0.03],
      [-0.09, 0.03],
      [-0.07, 0.045],
      [0.32, 0.045],
      [0.34, 0.03],
    ],
    0.058,
    body,
    S.paint,
    { bevel: 0.005 },
  );
  side(
    m,
    [
      [0.34, -0.03],
      [0.16, -0.03],
      [0.16, -0.05],
      [0.34, -0.05],
    ],
    0.05,
    BLK,
    S.polymer,
    { bevel: 0.004 },
  );
  // vented barrel shroud and muzzle
  barrel(m, 0.024, -0.52, -0.33, 0, "#222428", S.gunmetal, { seg: 12 });
  for (let i = 0; i < 5; i++)
    for (const a of [0.5, 2.1, 3.7, 5.3])
      m.box(
        0.008,
        0.008,
        0.02,
        [Math.sin(a) * 0.024, Math.cos(a) * 0.024, -0.35 - i * 0.034],
        "#050505",
        S.rubber,
        { rot: [0, 0, -a], lod: 1 },
      );
  barrel(m, 0.014, -0.56, -0.5, 0, STL, S.brushed, { seg: 12 });
  bore(m, 0.008, -0.56, 0);
  for (let i = 0; i < 3; i++)
    m.box(0.032, 0.004, 0.01, [0, 0, -0.532 + i * 0.012], "#111", S.rubber, { lod: 1 });
  // magazine (slightly curved stack) and grip
  side(
    m,
    [
      [0.2, -0.03],
      [0.14, -0.03],
      [0.15, -0.2],
      [0.17, -0.26],
      [0.23, -0.25],
      [0.21, -0.19],
    ],
    0.034,
    "#1c1d20",
    S.polymer,
    { bevel: 0.004 },
  );
  m.box(0.036, 0.006, 0.06, [0, -0.25, -0.2], col, S.glowSoft, { rot: [0.25, 0, 0] });
  grip(m, 0.0, -0.03, 0.14, 0.05, BLK, S.polymer, 0.25);
  trigger(m, 0.1, -0.03);
  // top rail and a red-dot sight
  rail(m, -0.3, 0.05, 0.052);
  m.box(0.04, 0.04, 0.07, [0, 0.082, -0.06], BLK, S.gunmetal, { bevel: 0.006 });
  m.box(0.034, 0.03, 0.004, [0, 0.086, -0.096], col, S.lens);
  m.box(0.03, 0.026, 0.004, [0, 0.086, -0.024], "#0a1a20", S.glass);
  // side glow strips + folding wire stock
  for (const x of [-0.03, 0.03]) m.box(0.004, 0.008, 0.26, [x, 0.02, -0.16], col, S.glow);
  for (const x of [-0.022, 0.022])
    m.box(0.01, 0.01, 0.14, [x, -0.01, 0.14], STL, S.steel, { bevel: 0.002 });
  m.box(0.056, 0.07, 0.012, [0, -0.03, 0.21], STL, S.steel, { bevel: 0.003 });
  m.box(0.05, 0.085, 0.02, [0, -0.03, 0.225], RUB, S.rubber, { bevel: 0.004 });
  // charging handle (kicks back with each shot)
  add("bolt", [0, 0, 0], (p) => {
    p.box(0.02, 0.012, 0.02, [0.038, 0.03, -0.2], STL, S.steel, { bevel: 0.003 });
    p.box(0.008, 0.012, 0.1, [0.03, 0.03, -0.16], "#15161a", S.darkSteel);
  });
};

// ---------------------------------------------------------------- LANCE: rail rifle
const rail_: Build = (m, add, col, body) => {
  // chassis: pale enamel over dark alloy
  side(
    m,
    [
      [0.2, -0.045],
      [-0.2, -0.045],
      [-0.22, 0.02],
      [-0.18, 0.05],
      [0.18, 0.05],
      [0.22, 0.02],
    ],
    0.07,
    body,
    S.enamel,
    { bevel: 0.008 },
  );
  side(
    m,
    [
      [0.22, -0.01],
      [-0.18, -0.01],
      [-0.18, -0.03],
      [0.22, -0.03],
    ],
    0.076,
    "#2a2c33",
    S.gunmetal,
    { bevel: 0.003 },
  );
  // twin rails (above and below the bore) with a spine
  for (const y of [0.028, -0.028])
    m.box(0.05, 0.012, 0.54, [0, y, -0.45], "#3a3d44", S.brushed, { bevel: 0.003 });
  for (const y of [0.028, -0.028])
    m.box(0.018, 0.006, 0.52, [0, y - Math.sign(y) * 0.009, -0.45], "#c8b8ff", S.chrome);
  for (let i = 0; i < 4; i++)
    m.box(0.054, 0.08, 0.012, [0, 0, -0.24 - i * 0.14], "#2a2c33", S.gunmetal, { bevel: 0.002 });
  m.box(0.056, 0.074, 0.02, [0, 0, -0.71], "#2a2c33", S.gunmetal, { bevel: 0.004 });
  bore(m, 0.012, -0.72, 0);
  // capacitor cells on the flanks
  for (const x of [-0.042, 0.042]) {
    barrel(m, 0.016, -0.2, 0.08, 0.0, "#1c1c22", S.darkSteel, { x, seg: 12 });
    for (let i = 0; i < 4; i++)
      m.tubeZ(0.017, 0.012, [x, 0, -0.16 + i * 0.07], col, S.glowSoft, { seg: 12 });
  }
  // scope, grip, stock
  scope(m, -0.18, 0.06, 0.09, 0.02, col);
  grip(m, -0.06, -0.045, 0.14, 0.05, "#2a2c33", S.polymer, 0.25);
  trigger(m, 0.04, -0.045);
  side(
    m,
    [
      [-0.2, 0.03],
      [-0.2, -0.04],
      [-0.26, -0.065],
      [-0.32, -0.075],
      [-0.33, 0.03],
    ],
    0.05,
    body,
    S.enamel,
    {
      bevel: 0.006,
      holes: [
        [
          [-0.23, 0.0],
          [-0.23, -0.035],
          [-0.29, -0.048],
          [-0.29, 0.0],
        ],
      ],
    },
  );
  m.box(0.056, 0.11, 0.02, [0, -0.022, 0.34], RUB, S.rubber, { bevel: 0.004 });
  // accelerator coils between the rails (throb when firing)
  add(
    "coil",
    [0, 0, 0],
    (p) => {
      for (let i = 0; i < 6; i++)
        p.torus(0.036, 0.007, [0, 0, -0.26 - i * 0.075], col, S.glow, { seg: 16 });
    },
    true,
  );
};

// ---------------------------------------------------------------- BOOMER: grenade launcher
const cannon: Build = (m, add, col, body) => {
  barrel(m, 0.07, -0.56, -0.12, 0, body, S.darkSteel, { seg: 20 });
  barrel(m, 0.078, -0.56, -0.52, 0, "#3a3a3a", S.steel, { seg: 20 });
  bore(m, 0.056, -0.56, 0);
  rings(m, 0.071, 0.005, -0.46, -0.2, 4, 0, "#454545", S.steel);
  m.box(0.02, 0.012, 0.3, [0, 0.074, -0.3], "#222", S.gunmetal);
  // frame, grips
  side(
    m,
    [
      [0.14, -0.06],
      [-0.06, -0.06],
      [-0.08, -0.03],
      [-0.08, 0.05],
      [0.14, 0.05],
    ],
    0.07,
    "#2a2a2a",
    S.gunmetal,
    { bevel: 0.006 },
  );
  grip(m, -0.02, -0.06, 0.13, 0.05, BLK, S.polymer, 0.2);
  trigger(m, 0.08, -0.06);
  side(
    m,
    [
      [0.34, -0.07],
      [0.3, -0.07],
      [0.3, -0.18],
      [0.34, -0.18],
    ],
    0.04,
    BLK,
    S.polymer,
    { bevel: 0.006 },
  ); // foregrip
  // stock (skeletal) + butt pad
  side(
    m,
    [
      [-0.08, 0.03],
      [-0.08, -0.04],
      [-0.24, -0.055],
      [-0.24, 0.03],
    ],
    0.04,
    "#2a2a2a",
    S.gunmetal,
    {
      bevel: 0.004,
      holes: [
        [
          [-0.11, 0.015],
          [-0.11, -0.025],
          [-0.21, -0.037],
          [-0.21, 0.015],
        ],
      ],
    },
  );
  m.box(0.05, 0.1, 0.025, [0, -0.012, 0.252], RUB, S.rubber, { bevel: 0.005 });
  // flip-up ladder sight
  for (const x of [-0.02, 0.02])
    m.box(0.005, 0.07, 0.006, [x, 0.1, -0.2], STL, S.steel, { rot: [0.35, 0, 0] });
  for (let i = 0; i < 4; i++)
    m.box(
      0.045,
      0.004,
      0.006,
      [0, 0.075 + i * 0.016, -0.2 - i * 0.006],
      col,
      i === 3 ? S.glow : S.steel,
    );
  // the revolving shell drum
  add("drum", [0, 0, 0], (p) => {
    barrel(p, 0.105, -0.12, 0.02, 0, "#303030", S.darkSteel, { seg: 20 });
    for (let k = 0; k < 6; k++) {
      const a = (k * PI) / 3;
      p.tubeZ(0.03, 0.005, [Math.sin(a) * 0.066, Math.cos(a) * 0.066, -0.123], col, S.glowSoft, {
        seg: 10,
      });
      p.box(
        0.022,
        0.012,
        0.13,
        [Math.sin(a + PI / 6) * 0.104, Math.cos(a + PI / 6) * 0.104, -0.05],
        "#1a1a1a",
        S.darkSteel,
        { rot: [0, 0, -(a + PI / 6)] },
      );
    }
    p.tubeZ(0.02, 0.16, [0, 0, -0.05], STL, S.steel, { seg: 10 });
  });
};

// ---------------------------------------------------------------- REBOUNDER: disc launcher
const rebound: Build = (m, add, col, body) => {
  const y = 0.06;
  side(
    m,
    [
      [0.2, -0.04],
      [-0.1, -0.04],
      [-0.12, 0.02],
      [-0.08, 0.045],
      [0.2, 0.045],
    ],
    0.07,
    body,
    S.paint,
    { bevel: 0.008 },
  );
  // flat launch slot (two jaws) ending at the muzzle
  for (const dy of [-0.022, 0.022])
    m.box(0.15, 0.014, 0.34, [0, y + dy, -0.27], "#23282a", S.gunmetal, { bevel: 0.004 });
  for (const x of [-0.07, 0.07])
    m.box(0.012, 0.058, 0.3, [x, y, -0.27], "#1a1d1e", S.darkSteel, { bevel: 0.003 });
  m.box(0.16, 0.06, 0.018, [0, y, -0.432], "#1a1d1e", S.darkSteel, { bevel: 0.004 });
  m.box(0.13, 0.03, 0.02, [0, y, -0.431], "#050505", S.rubber);
  for (const x of [-0.06, 0.06]) m.box(0.008, 0.008, 0.26, [x, y + 0.031, -0.27], col, S.glow);
  // magazine of stacked discs behind the slot
  barrel(m, 0.058, -0.02, 0.1, y + 0.03, "#2d3a2a", S.paint, { seg: 18 });
  for (let i = 0; i < 4; i++)
    m.tubeZ(0.052, 0.012, [0, y + 0.03, 0.0 + i * 0.022], col, i % 2 ? S.glowSoft : S.enamel, {
      seg: 18,
    });
  grip(m, 0.0, -0.04, 0.14, 0.05, BLK, S.polymer, 0.25);
  trigger(m, 0.1, -0.04);
  // the disc in the slot, spinning up
  add("disc", [0, y, -0.25], (p) => {
    p.cyl(0.06, 0.012, [0, y, -0.25], col, S.glow, { seg: 20 });
    p.cyl(0.066, 0.008, [0, y, -0.25], "#2a3a22", S.steel, { seg: 20 });
    for (let k = 0; k < 6; k++)
      p.box(
        0.014,
        0.014,
        0.03,
        [Math.sin((k * PI) / 3) * 0.05, y, -0.25 + Math.cos((k * PI) / 3) * 0.05],
        "#e8ffe0",
        S.chrome,
        { rot: [0, (k * PI) / 3, 0] },
      );
  });
};

// ---------------------------------------------------------------- HARPOON: spear gun
const harpoon: Build = (m, add, col, body) => {
  const y = 0.02;
  // long alloy track and a wooden stock
  side(
    m,
    [
      [0.62, -0.005],
      [-0.05, -0.005],
      [-0.05, 0.012],
      [0.62, 0.012],
    ],
    0.03,
    "#5a5e64",
    S.brushed,
    { bevel: 0.002 },
  );
  side(
    m,
    [
      [0.05, 0.012],
      [-0.18, 0.012],
      [-0.22, -0.04],
      [-0.1, -0.05],
      [0.05, -0.04],
    ],
    0.05,
    body,
    S.wood,
    { bevel: 0.008 },
  );
  grip(m, 0.05, -0.03, 0.14, 0.045, BLK, S.rubber, 0.35);
  trigger(m, 0.14, -0.02);
  // muzzle yoke with the rubber bands stretched back to the notch
  m.box(0.09, 0.03, 0.03, [0, y - 0.008, -0.62], "#3a3a3a", S.darkSteel, { bevel: 0.005 });
  for (const x of [-0.045, 0.045]) {
    m.cable(
      [
        [x, y, -0.62],
        [x * 0.8, y + 0.012, -0.4],
        [x * 0.25, y + 0.016, -0.12],
      ],
      0.006,
      "#8c7f66",
      S.rubber,
      { seg: 14, lod: 0 },
    );
  }
  m.box(0.02, 0.01, 0.03, [0, y + 0.016, -0.12], STL, S.steel);
  // line reel under the track
  m.tubeX(0.035, 0.03, [0, -0.04, -0.3], "#2a2a2a", S.darkSteel, { seg: 16 });
  m.tubeX(0.028, 0.032, [0, -0.04, -0.3], "#d8ccb0", S.cable, { seg: 16 });
  // the spear: steel shaft, barbed tip on the muzzle
  add("spear", [0, 0, 0], (p) => {
    p.tubeZ(0.005, 0.62, [0, y, -0.39], "#c8ccd0", S.chrome, { seg: 8 });
    p.cone(0.012, 0.05, [0, y, -0.695], col, S.chrome, { rot: [-PI / 2, 0, 0], seg: 8 });
    for (const a of [0, PI])
      p.box(0.004, 0.022, 0.004, [Math.sin(a) * 0.012, y, -0.67], "#e8e0d0", S.chrome, {
        rot: [0.6, a, 0],
      });
  });
};

// ---------------------------------------------------------------- GLACIER: cryo gun
const cryo: Build = (m, add, col, body) => {
  side(
    m,
    [
      [0.26, -0.035],
      [-0.12, -0.035],
      [-0.14, 0.02],
      [-0.1, 0.045],
      [0.24, 0.045],
      [0.26, 0.02],
    ],
    0.068,
    body,
    S.enamel,
    { bevel: 0.008 },
  );
  // cooling fins down the barrel to a flared nozzle
  barrel(m, 0.022, -0.56, -0.26, 0, "#2a3438", S.gunmetal, { seg: 14 });
  for (let i = 0; i < 7; i++)
    m.tubeZ(0.036, 0.006, [0, 0, -0.29 - i * 0.035], "#9ab6c0", S.brushed, { seg: 14 });
  barrel(m, 0.03, -0.62, -0.56, 0, "#d8eef4", S.chrome, { rb: 0.022, seg: 16 });
  m.tubeZ(0.022, 0.004, [0, 0, -0.621], col, S.glow, { seg: 14 });
  // the cryo canister on top: frosted glass window, steel end caps
  barrel(m, 0.034, -0.24, 0.04, 0.085, col, S.glowSoft, { seg: 16 });
  for (const z of [-0.25, 0.05])
    barrel(m, 0.04, z - 0.015, z + 0.015, 0.085, "#cfd6da", S.chrome, { seg: 16 });
  for (let i = 0; i < 4; i++)
    m.box(0.074, 0.006, 0.006, [0, 0.085, -0.19 + i * 0.07], "#e8f6fa", S.steel, {
      rot: [0, 0, 0],
      lod: 1,
    });
  for (const x of [-0.03, 0.03]) m.box(0.008, 0.05, 0.02, [x, 0.052, -0.1], "#cfd6da", S.chrome);
  m.cable(
    [
      [0.02, 0.085, 0.06],
      [0.05, 0.06, 0.1],
      [0.04, 0.0, 0.05],
      [0.03, -0.01, -0.1],
    ],
    0.006,
    "#2a4a5a",
  );
  // frost crust on the fore end
  for (let i = 0; i < 6; i++)
    m.sphere(
      0.012 + (i % 3) * 0.004,
      [((i * 37) % 7) / 100 - 0.03, -0.03 + ((i * 13) % 5) / 200, -0.2 - i * 0.012],
      "#eaffff",
      S.enamel,
      { low: true, lod: 1 },
    );
  grip(m, 0.0, -0.035, 0.14, 0.05, BLK, S.polymer, 0.25);
  trigger(m, 0.1, -0.035);
  m.box(0.06, 0.08, 0.02, [0, -0.01, 0.13], "#1c2a30", S.polymer, { bevel: 0.006 });
};

// ---------------------------------------------------------------- FLAK: stubby launcher
const flak: Build = (m, add, col, body) => {
  side(
    m,
    [
      [0.2, -0.05],
      [-0.12, -0.05],
      [-0.14, 0.02],
      [-0.1, 0.06],
      [0.2, 0.06],
    ],
    0.08,
    body,
    S.paint,
    { bevel: 0.008 },
  );
  // perforated barrel shroud, flared muzzle
  barrel(m, 0.07, -0.55, -0.18, 0, "#4a4632", S.paint, { seg: 18 });
  for (let i = 0; i < 4; i++)
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * PI * 2;
      m.cyl(
        0.009,
        0.004,
        [Math.sin(a) * 0.07, Math.cos(a) * 0.07, -0.24 - i * 0.075],
        "#0a0a0a",
        S.rubber,
        { rot: [0, 0, -a], seg: 8, lod: 1 },
      );
    }
  barrel(m, 0.095, -0.63, -0.55, 0, "#3a3a30", S.darkSteel, { rb: 0.07, seg: 18 });
  bore(m, 0.07, -0.63, 0);
  m.torus(0.094, 0.006, [0, 0, -0.63], col, S.glowSoft, { seg: 20 });
  // carry handle, grip
  side(
    m,
    [
      [0.22, 0.06],
      [0.2, 0.12],
      [-0.02, 0.12],
      [-0.04, 0.06],
      [-0.01, 0.06],
      [0.01, 0.1],
      [0.17, 0.1],
      [0.19, 0.06],
    ],
    0.024,
    "#2a2a22",
    S.gunmetal,
    { bevel: 0.004 },
  );
  grip(m, 0.0, -0.05, 0.14, 0.055, BLK, S.polymer, 0.25);
  trigger(m, 0.1, -0.05);
  // shell drum on the left side
  add("drum", [-0.09, -0.02, -0.02], (p) => {
    p.tubeX(0.085, 0.06, [-0.09, -0.02, -0.02], "#35332a", S.darkSteel, { seg: 20 });
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * PI * 2;
      p.tubeX(
        0.016,
        0.062,
        [-0.09, -0.02 + Math.sin(a) * 0.058, -0.02 + Math.cos(a) * 0.058],
        k % 2 ? BRASS : col,
        k % 2 ? S.brass : S.glowSoft,
        { seg: 10 },
      );
    }
    p.tubeX(0.022, 0.07, [-0.09, -0.02, -0.02], STL, S.steel, { seg: 10 });
  });
};

// ---------------------------------------------------------------- TESLA: coil gun
const tesla: Build = (m, add, col, body) => {
  side(
    m,
    [
      [0.24, -0.04],
      [-0.12, -0.04],
      [-0.14, 0.02],
      [-0.1, 0.05],
      [0.22, 0.05],
      [0.24, 0.02],
    ],
    0.07,
    body,
    S.enamel,
    { bevel: 0.008 },
  );
  // ceramic insulator stack down the barrel
  barrel(m, 0.014, -0.45, -0.24, 0, "#c8b89a", S.enamel, { seg: 12 });
  for (let i = 0; i < 6; i++)
    m.tubeZ(0.026, 0.01, [0, 0, -0.26 - i * 0.03], "#e8e0d0", S.enamel, { seg: 14 });
  // spark gap: two electrode prongs with balls at the muzzle
  for (const x of [-0.03, 0.03]) {
    m.box(0.008, 0.008, 0.1, [x, 0, -0.42], "#b87333", S.copper);
    m.sphere(0.014, [x * 0.55, 0, -0.475], "#d8a070", S.copper);
  }
  // Tesla tower on top with a glowing crown
  m.cyl(0.02, 0.1, [0, 0.1, -0.1], "#2a2a2a", S.darkSteel, { seg: 12 });
  for (let i = 0; i < 5; i++)
    m.torus(0.024, 0.005, [0, 0.07 + i * 0.016, -0.1], "#b87333", S.copper, {
      rot: [PI / 2, 0, 0],
    });
  m.torus(0.04, 0.012, [0, 0.16, -0.1], "#b8bcc2", S.chrome, { rot: [PI / 2, 0, 0], seg: 18 });
  grip(m, 0.0, -0.04, 0.14, 0.05, BLK, S.polymer, 0.25);
  trigger(m, 0.1, -0.04);
  m.cable(
    [
      [0.03, 0.02, 0.05],
      [0.05, 0.06, -0.02],
      [0.02, 0.1, -0.08],
    ],
    0.005,
    "#1a1a1a",
  );
  // the copper coils (glow throbs as it fires)
  add(
    "coil",
    [0, 0, 0],
    (p) => {
      for (let i = 0; i < 9; i++)
        p.torus(
          0.04,
          0.006,
          [0, 0.0, -0.26 - i * 0.02],
          i % 3 === 1 ? col : "#b87333",
          i % 3 === 1 ? S.glow : S.copper,
          { seg: 16 },
        );
      p.sphere(0.03, [0, 0.16, -0.1], col, S.glow);
      p.sphere(0.012, [0, 0, -0.482], "#ffffff", S.glow, { low: true });
    },
    true,
  );
};

// ---------------------------------------------------------------- HAND CANNON: revolver
const revolver: Build = (m, add, col, body) => {
  const y = 0.02;
  // barrel with a vent rib and a full underlug
  barrel(m, 0.022, -0.48, -0.1, y, "#3a3530", S.blued, { seg: 16 });
  bore(m, 0.013, -0.48, y);
  m.box(0.018, 0.016, 0.38, [0, y + 0.024, -0.29], "#3a3530", S.blued, { bevel: 0.003 });
  m.box(0.036, 0.034, 0.34, [0, y - 0.026, -0.29], "#3a3530", S.blued, { bevel: 0.006 });
  m.box(0.004, 0.02, 0.3, [0.019, y - 0.026, -0.29], col, S.brass, { lod: 1 }); // gold inlay
  m.box(0.004, 0.02, 0.3, [-0.019, y - 0.026, -0.29], col, S.brass, { lod: 1 });
  m.box(0.008, 0.018, 0.012, [0, y + 0.038, -0.46], "#222", S.gunmetal);
  // frame + top strap + hammer
  side(
    m,
    [
      [0.1, -0.04],
      [-0.07, -0.04],
      [-0.08, 0.02],
      [-0.06, 0.06],
      [0.1, 0.06],
    ],
    0.05,
    body,
    S.blued,
    {
      bevel: 0.005,
      holes: [
        [
          [0.085, -0.03],
          [-0.055, -0.03],
          [-0.055, 0.05],
          [0.085, 0.05],
        ],
      ],
    },
  );
  m.box(0.03, 0.02, 0.2, [0, 0.07, -0.01], body, S.blued, { bevel: 0.004 });
  m.box(0.016, 0.04, 0.02, [0, 0.07, 0.08], "#2a2a2a", S.gunmetal, {
    rot: [-0.5, 0, 0],
    bevel: 0.003,
  });
  trigger(m, 0.03, -0.04, 0.016, body, S.blued);
  // wooden grip with brass escutcheons
  side(
    m,
    [
      [-0.05, -0.02],
      [-0.09, 0.0],
      [-0.14, -0.13],
      [-0.1, -0.16],
      [-0.04, -0.14],
      [-0.03, -0.05],
    ],
    0.05,
    "#5a3a22",
    S.wood,
    { bevel: 0.008 },
  );
  for (const x of [-0.027, 0.027])
    m.cyl(0.008, 0.003, [x, -0.08, 0.1], BRASS, S.brass, { rot: [0, 0, PI / 2], seg: 10 });
  // cylinder: fluted, turns a sixth per shot
  add("cyl", [0, y - 0.005, 0], (p) => {
    barrel(p, 0.056, -0.09, 0.01, y - 0.005, "#4a4540", S.blued, { seg: 18 });
    for (let k = 0; k < 6; k++) {
      const a = (k * PI) / 3 + PI / 6;
      p.box(
        0.012,
        0.012,
        0.085,
        [Math.sin(a) * 0.055, y - 0.005 + Math.cos(a) * 0.055, -0.04],
        "#1e1c1a",
        S.darkSteel,
        { rot: [0, 0, -a] },
      );
      p.tubeZ(
        0.011,
        0.004,
        [Math.sin(a - PI / 6) * 0.034, y - 0.005 + Math.cos(a - PI / 6) * 0.034, 0.012],
        BRASS,
        S.brass,
        { seg: 10 },
      );
    }
  });
};

// ---------------------------------------------------------------- SHREDDER: minigun
const minigun: Build = (m, add, col, body) => {
  // motor housing, carry handle, feed chute
  side(
    m,
    [
      [0.18, -0.07],
      [-0.1, -0.07],
      [-0.12, 0.05],
      [-0.08, 0.075],
      [0.16, 0.075],
      [0.18, 0.05],
    ],
    0.12,
    body,
    S.darkSteel,
    { bevel: 0.01 },
  );
  for (let i = 0; i < 5; i++)
    m.box(0.124, 0.006, 0.012, [0, 0.03, -0.0 + i * 0.03], col, i % 2 ? S.glowSoft : S.darkSteel, {
      lod: 1,
    });
  side(
    m,
    [
      [0.15, 0.075],
      [0.13, 0.14],
      [-0.03, 0.14],
      [-0.05, 0.075],
      [-0.02, 0.075],
      [0.0, 0.12],
      [0.11, 0.12],
      [0.13, 0.075],
    ],
    0.026,
    "#222",
    S.gunmetal,
    { bevel: 0.004 },
  );
  m.box(0.07, 0.1, 0.1, [0.1, -0.06, 0.05], "#2a2a22", S.paint, { bevel: 0.008 });
  for (let i = 0; i < 6; i++)
    m.box(0.03, 0.012, 0.018, [0.15, -0.08 + i * 0.008, 0.02 + i * 0.012], BRASS, S.brass, {
      rot: [0, 0, 0.4],
      lod: 1,
    });
  grip(m, -0.04, -0.07, 0.13, 0.05, BLK, S.rubber, 0.2);
  trigger(m, 0.06, -0.07);
  m.tubeZ(0.03, 0.06, [0, 0, -0.18], "#333", S.steel, { seg: 16 });
  // the six-barrel cluster (spins while firing)
  add("barrels", [0, 0, 0], (p) => {
    for (let k = 0; k < 6; k++) {
      const a = (k * PI) / 3;
      const x = Math.sin(a) * 0.036;
      const yy = Math.cos(a) * 0.036;
      barrel(p, 0.011, -0.6, -0.2, yy, "#2a2a2a", S.blued, { x, seg: 10 });
      bore(p, 0.007, -0.6, yy, x);
    }
    for (const z of [-0.26, -0.44, -0.58])
      p.tubeZ(0.052, 0.018, [0, 0, z], "#3a3a3a", S.steel, { seg: 16 });
    p.tubeZ(0.012, 0.42, [0, 0, -0.39], STL, S.steel, { seg: 8 });
  });
};

// ---------------------------------------------------------------- CROSSBOW
const crossbow: Build = (m, add, col, body) => {
  side(
    m,
    [
      [0.47, -0.01],
      [0.0, -0.01],
      [-0.08, -0.03],
      [-0.24, -0.06],
      [-0.25, 0.02],
      [-0.1, 0.02],
      [0.47, 0.012],
    ],
    0.04,
    body,
    S.wood,
    { bevel: 0.006 },
  );
  m.box(0.02, 0.006, 0.5, [0, 0.015, -0.24], "#3a3a3a", S.brushed); // flight track
  grip(m, 0.05, -0.02, 0.12, 0.04, "#3a2a1a", S.wood, 0.3);
  trigger(m, 0.14, -0.015, 0.016, "#333", S.gunmetal);
  // recurve limbs across the front, riser, stirrup
  m.box(0.06, 0.04, 0.05, [0, 0, -0.44], "#2a2a2a", S.darkSteel, { bevel: 0.006 });
  for (const s of [-1, 1]) {
    m.push([0, 0, -0.43], [0, 0, 0]);
    m.box(0.16, 0.012, 0.03, [s * 0.1, 0.0, 0.02], "#1c1c1c", S.polymer, {
      rot: [0, s * -0.25, 0],
      bevel: 0.004,
    });
    m.box(0.1, 0.01, 0.024, [s * 0.215, 0.0, 0.075], "#1c1c1c", S.polymer, {
      rot: [0, s * 0.3, 0],
      bevel: 0.003,
    });
    m.cyl(0.008, 0.02, [s * 0.26, 0.0, 0.055], STL, S.steel, { seg: 8 });
    m.pop();
  }
  m.torus(0.035, 0.005, [0, -0.02, -0.5], "#3a3a3a", S.steel, {
    rot: [0, PI / 2, 0],
    arc: PI,
    seg: 10,
  });
  scope(m, -0.24, -0.04, 0.06, 0.016, col);
  // string + bolt (drawn again after each shot)
  add("bolt", [0, 0, 0], (p) => {
    p.cable(
      [
        [0.26, 0.004, -0.375],
        [0.0, 0.01, -0.14],
        [-0.26, 0.004, -0.375],
      ],
      0.0025,
      "#d8d0b8",
      S.cable,
      { seg: 10, lod: 0 },
    );
    p.tubeZ(0.004, 0.38, [0, 0.02, -0.3], "#6a5a3a", S.wood, { seg: 6 });
    p.cone(0.008, 0.03, [0, 0.02, -0.495], col, S.glow, { rot: [-PI / 2, 0, 0], seg: 8 });
    for (const a of [0, 2.1, 4.2])
      p.box(
        0.002,
        0.014,
        0.03,
        [Math.sin(a) * 0.006, 0.02 + Math.cos(a) * 0.006, -0.125],
        col,
        S.enamel,
        { rot: [0, 0, -a] },
      );
  });
};

// ---------------------------------------------------------------- PLASMA FAN
const plasma: Build = (m, add, col, body) => {
  side(
    m,
    [
      [0.26, -0.04],
      [-0.12, -0.04],
      [-0.14, 0.02],
      [-0.1, 0.05],
      [0.24, 0.05],
      [0.26, 0.02],
    ],
    0.08,
    body,
    S.enamel,
    { bevel: 0.008 },
  );
  // three splayed emitter barrels
  for (const x of [-0.05, 0, 0.05]) {
    m.push([x * 0.4, 0, -0.26], [0, -x * 1.2, 0]);
    barrel(m, 0.017, -0.22, 0, 0.0, "#2a1e30", S.gunmetal, { seg: 12 });
    m.tubeZ(0.022, 0.03, [0, 0, -0.2], "#b8b0c0", S.chrome, { seg: 12 });
    m.tubeZ(0.012, 0.004, [0, 0, -0.221], col, S.glow, { seg: 10 });
    m.pop();
  }
  // heat sink fins
  for (let i = 0; i < 6; i++)
    m.box(0.1, 0.03, 0.006, [0, 0.0, -0.1 + i * 0.03], "#3a3040", S.brushed, {
      bevel: 0.002,
      lod: 1,
    });
  grip(m, 0.0, -0.04, 0.14, 0.05, BLK, S.polymer, 0.25);
  trigger(m, 0.1, -0.04);
  // plasma chamber (segmented glass tube) on top, pulsing
  for (const z of [-0.2, 0.06])
    m.box(0.05, 0.05, 0.02, [0, 0.07, z], "#2a1e30", S.gunmetal, { bevel: 0.005 });
  add(
    "coil",
    [0, 0, 0],
    (p) => {
      barrel(p, 0.018, -0.19, 0.05, 0.07, col, S.glow, { seg: 12 });
      for (let i = 0; i < 5; i++)
        p.tubeZ(0.022, 0.006, [0, 0.07, -0.16 + i * 0.05], "#d8d0e0", S.chrome, { seg: 12 });
    },
    true,
  );
};

// ---------------------------------------------------------------- VOID ORB
const voidorb: Build = (m, add, col, body) => {
  side(
    m,
    [
      [0.26, -0.04],
      [-0.12, -0.04],
      [-0.14, 0.02],
      [-0.1, 0.05],
      [0.24, 0.05],
      [0.26, 0.02],
    ],
    0.08,
    body,
    S.enamel,
    { bevel: 0.008 },
  );
  m.tubeZ(0.03, 0.08, [0, 0, -0.3], "#2a2a32", S.darkSteel, { seg: 14 });
  // three prongs cradling the orb
  for (let k = 0; k < 3; k++) {
    const a = (k * PI * 2) / 3;
    m.push([0, 0, -0.33], [0, 0, a]);
    m.box(0.012, 0.012, 0.16, [0, 0.06, -0.08], "#4a4452", S.brushed, {
      rot: [0.35, 0, 0],
      bevel: 0.003,
    });
    m.box(0.014, 0.03, 0.014, [0, 0.085, -0.155], "#4a4452", S.brushed, {
      rot: [-0.3, 0, 0],
      bevel: 0.003,
    });
    m.pop();
  }
  m.sphere(0.05, [0, 0, -0.42], "#1a0a2a", S.glass);
  m.sphere(0.034, [0, 0, -0.42], col, S.glow);
  m.sphere(0.012, [0, 0, -0.5 + 0.012], "#f0e0ff", S.glow, { low: true });
  grip(m, 0.0, -0.04, 0.14, 0.05, BLK, S.polymer, 0.25);
  trigger(m, 0.1, -0.04);
  for (let i = 0; i < 3; i++)
    m.box(0.082, 0.01, 0.02, [0, 0.02, -0.02 + i * 0.05], col, S.glowSoft, { lod: 1 });
  // containment ring (spins round the orb)
  add("ring", [0, 0, -0.42], (p) => {
    p.torus(0.075, 0.006, [0, 0, -0.42], "#555060", S.chrome, { seg: 24 });
    for (let k = 0; k < 4; k++)
      p.box(
        0.016,
        0.016,
        0.016,
        [Math.sin((k * PI) / 2) * 0.075, Math.cos((k * PI) / 2) * 0.075, -0.42],
        col,
        S.glow,
      );
  });
};

// ---------------------------------------------------------------- SHATTERGUN
const shatter: Build = (m, add, col, body) => {
  side(
    m,
    [
      [0.24, -0.045],
      [-0.12, -0.045],
      [-0.14, 0.02],
      [-0.1, 0.05],
      [0.22, 0.05],
      [0.24, 0.02],
    ],
    0.076,
    body,
    S.enamel,
    { bevel: 0.008 },
  );
  // hexagonal tapering barrel with a crystal choke
  m.cyl(0.05, 0.3, [0, 0, -0.39], "#2a3a44", S.gunmetal, {
    rb: 0.065,
    seg: 6,
    rot: [PI / 2, 0, 0],
  });
  m.cyl(0.046, 0.02, [0, 0, -0.55], "#8ab0c0", S.brushed, { seg: 6, rot: [PI / 2, 0, 0] });
  bore(m, 0.03, -0.56, 0);
  for (let i = 0; i < 6; i++) {
    const a = (i * PI) / 3 + PI / 6;
    m.cone(0.014, 0.06, [Math.sin(a) * 0.05, Math.cos(a) * 0.05, -0.55], col, S.glowSoft, {
      rot: [-PI / 2, 0, 0],
      seg: 5,
    });
  }
  // ice crystals growing out of the top
  const shard = (p: V3, s: number, r: V3) =>
    m.geo(new THREE.OctahedronGeometry(1, 0), p, [s * 0.5, s * 1.6, s * 0.5], col, S.glass, {
      rot: r,
    });
  shard([0, 0.08, -0.2], 0.03, [0.3, 0, 0.2]);
  shard([0.02, 0.07, -0.26], 0.02, [-0.3, 0, -0.5]);
  shard([-0.02, 0.07, -0.15], 0.018, [0.2, 0, 0.6]);
  m.geo(new THREE.OctahedronGeometry(1, 0), [0, 0.07, -0.2], [0.02, 0.04, 0.02], "#e0faff", S.glow);
  grip(m, 0.0, -0.045, 0.14, 0.05, BLK, S.polymer, 0.25);
  trigger(m, 0.1, -0.045);
  m.box(0.06, 0.08, 0.02, [0, -0.01, 0.13], "#1c2a30", S.polymer, { bevel: 0.006 });
};

const BUILDS: Record<Exclude<GunId, "pistol">, Build> = {
  scatter,
  smg,
  rail: rail_,
  cannon,
  rebound,
  harpoon,
  cryo,
  flak,
  tesla,
  revolver,
  minigun,
  crossbow,
  plasma,
  voidorb,
  shatter,
};

const MOD_KEYS = [
  "burst",
  "incend",
  "magnum",
  "extmag",
  "shred",
  "laser",
  "comp",
  "suppr",
  "exec",
  "holster",
  "bounty",
] as const;
/** a cache key for the pistol's installed mods */
export function modKey(mods?: PistolMods) {
  if (!mods) return "";
  return MOD_KEYS.filter((k) => mods[k]).join(",");
}

const cache = new Map<string, GunBuild>();
/** build (once) the model for gun `w` (pistol: with these mods) */
export function gunBuild(w: GunId, key: string, color: string, body: string): GunBuild {
  const ck = `${w}|${key}`;
  let g = cache.get(ck);
  if (g) return g;
  const mods: PistolMods = {};
  if (w === "pistol") for (const k of key.split(",")) if (k) mods[k as keyof PistolMods] = true;
  const m = new Model();
  const parts: GunPart[] = [];
  const add = (name: GunPart["name"], pivot: V3, fn: (p: Model) => void, pulse?: boolean) => {
    const pm = new Model();
    fn(pm);
    parts.push({ name, geo: pm.build(), pivot, ...(pulse ? { pulse } : {}) });
  };
  const fn = w === "pistol" ? pistol(mods) : BUILDS[w];
  const laser = fn(m, add, color, body) ?? null;
  const bodyGeo = m.build();
  const verts =
    bodyGeo.getAttribute("position").count +
    parts.reduce((s, p) => s + p.geo.getAttribute("position").count, 0);
  g = { body: bodyGeo, parts, laser, verts, muzzle: gunMuzzle(w, mods) };
  cache.set(ck, g);
  return g;
}
