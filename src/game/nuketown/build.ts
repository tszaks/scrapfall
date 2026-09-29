// Nuketown art pass: every shaped or rotated thing the axis-aligned structure volumes
// can't express — gable roofs, vehicles, mannequins, pickets, furniture, lamps, signs,
// the desert backdrop. Walls, slabs and fence panels render from the structures batch,
// so the picture and the collision can never drift apart.
import { Model, SURF } from "../art/kit";
import { NUKE, NUKE_MANNEQUINS, NUKE_VEHICLES, HOUSE_COLORS, SIDES } from "./layout";

const WOOD = "#7a6248",
  WOOD_D = "#5d4a38",
  WHITE = "#efe8d4",
  CONCRETE = "#a49e92",
  ASPHALT = "#54555a",
  KERB = "#99948a",
  SAND = "#b3a582",
  GRASS = "#87935f",
  SHINGLE = "#7e7466",
  SOIL = "#8a7a5c",
  MANNE = "#d9cbb2",
  MANNE_D = "#b8a88e",
  BRICK = "#a06950",
  CHROME = "#c9ccd0",
  GLASS_C = "#33414d",
  INK = "#e8e2d2";

// ---------------------------------------------------------------- small pieces

/** white picket run between two points: pickets + two rails + posts */
function pickets(m: Model, x0: number, z0: number, x1: number, z1: number) {
  const dx = x1 - x0,
    dz = z1 - z0,
    len = Math.hypot(dx, dz);
  if (len < 0.15) return;
  const yaw = -Math.atan2(dz, dx),
    cx = x0 + dx / 2,
    cz = z0 + dz / 2;
  m.push([cx, 0, cz], [0, yaw, 0]);
  for (const y of [0.36, 0.9]) m.box(len, 0.08, 0.045, [0, y, 0], WHITE, SURF.wood);
  const n = Math.floor(len / 0.26);
  for (let i = 0; i <= n; i++) {
    const x = Math.min(len / 2, -len / 2 + i * 0.26);
    m.box(0.11, 0.96, 0.022, [x, 0.48, 0], WHITE, SURF.wood);
    m.box(0.11, 0.07, 0.022, [x, 0.99, 0], WHITE, SURF.wood, { rot: [0, 0, Math.PI / 4] });
  }
  const np = Math.max(1, Math.round(len / 2.3));
  for (let i = 0; i <= np; i++) {
    const x = -len / 2 + (i / np) * len;
    m.box(0.09, 1.12, 0.09, [x, 0.56, 0], "#e2dac4", SURF.wood);
    m.box(0.11, 0.05, 0.11, [x, 1.14, 0], WHITE, SURF.wood);
  }
  m.pop();
}

/** board fence dressing on the yard side: rails, posts, cap, outer board seams */
function privacyDress(m: Model, x0: number, z0: number, x1: number, z1: number, inner: 1 | -1) {
  const dx = x1 - x0,
    dz = z1 - z0,
    len = Math.hypot(dx, dz);
  const yaw = -Math.atan2(dz, dx);
  m.push([x0 + dx / 2, 0, z0 + dz / 2], [0, yaw, 0]);
  const face = -0.045 * inner; // yard side of the panel centre line
  for (const y of [0.42, 1.62]) m.box(len, 0.09, 0.05, [0, y, face], WOOD_D, SURF.wood);
  m.box(len + 0.06, 0.09, 0.13, [0, 1.98, 0], WOOD, SURF.wood);
  const np = Math.max(1, Math.round(len / 2.6));
  for (let i = 0; i <= np; i++) {
    const x = -len / 2 + (i / np) * len;
    m.box(0.13, 2.0, 0.13, [x, 1.0, face * 1.6], WOOD, SURF.wood);
    m.box(0.16, 0.07, 0.16, [x, 2.02, face * 1.6], WOOD_D, SURF.wood);
  }
  const nb = Math.floor(len / 0.62);
  for (let i = 0; i <= nb; i++) {
    const x = -len / 2 + (i + 0.5) * 0.62;
    if (x > len / 2) break;
    m.box(0.05, 1.9, 0.05, [x, 0.95, -face], "#9d8d6e", SURF.wood);
  }
  m.pop();
}

// ---------------------------------------------------------------- vehicles
// local space: nose +z, left -x

function wheelSet(m: Model, z: number, r: number, w: number, half: number, hub = CHROME) {
  for (const sx of [-1, 1]) {
    m.cyl(r, w, [sx * half, r, z], "#151517", SURF.tyre, { rot: [0, 0, Math.PI / 2], seg: 12 });
    m.cyl(r * 0.45, w + 0.02, [sx * half, r, z], hub, SURF.steel, {
      rot: [0, 0, Math.PI / 2],
      seg: 8,
    });
  }
}

/** yellow school bus */
function bus(m: Model, c: string) {
  const L = 11.4,
    W = 2.55;
  m.box(W, 1.7, L, [0, 1.15, 0], c, SURF.carPaintMatte);
  m.box(W - 0.12, 0.95, L - 0.3, [0, 2.45, 0], c, SURF.carPaintMatte);
  m.box(W - 0.4, 0.18, L - 0.8, [0, 2.98, 0], c, SURF.carPaintMatte, { bevel: 0.1 });
  for (const y of [0.72, 1.12]) m.box(W + 0.04, 0.09, L, [0, y, 0], "#1d1c1a", SURF.paint);
  m.box(W - 0.06, 0.62, L - 1.15, [0, 2.5, -0.3], GLASS_C, SURF.glass);
  for (let z = -L / 2 + 0.8; z < L / 2 - 1.4; z += 0.95)
    for (const sx of [-1, 1]) m.box(0.06, 0.78, 0.1, [sx * (W / 2 - 0.05), 2.5, z], c, SURF.carPaintMatte);
  m.box(W - 0.5, 0.74, 0.08, [0, 2.45, L / 2 + 0.01], GLASS_C, SURF.glass);
  // door leaf folded open + stairwell steps down to the kerb
  m.box(0.9, 1.75, 0.07, [W / 2 - 0.42, 1.55, L / 2 - 0.5], c, SURF.carPaintMatte);
  for (let i = 0; i < 3; i++)
    m.box(0.7, 0.06, 0.26, [W / 2 - 0.5, 0.3 + i * 0.3, L / 2 - 0.55 - i * 0.24], "#3a3a38", SURF.steel);
  m.box(W - 0.5, 0.85, 1.5, [0, 0.95, L / 2 - 0.2], c, SURF.carPaintMatte, { bevel: 0.08 });
  m.box(W + 0.15, 0.28, 0.3, [0, 0.45, L / 2 + 0.12], CHROME, SURF.chrome);
  m.box(W + 0.15, 0.28, 0.3, [0, 0.45, -L / 2 - 0.12], CHROME, SURF.chrome);
  for (const sx of [-1, 1]) {
    m.cyl(0.13, 0.07, [sx * (W / 2 - 0.35), 1.02, L / 2 + 0.04], "#f4f2dc", SURF.lens, {
      rot: [Math.PI / 2, 0, 0],
      seg: 10,
    });
    m.cyl(0.09, 0.07, [sx * (W / 2 - 0.3), 1.3, -L / 2 - 0.04], "#a02020", SURF.lens, {
      rot: [Math.PI / 2, 0, 0],
      seg: 8,
    });
  }
  m.box(0.52, 0.52, 0.04, [-W / 2 - 0.14, 1.7, 0.4], "#b02828", SURF.paint);
  m.box(1.2, 0.3, 0.06, [0, 3.02, L / 2 - 0.02], "#1d1c1a", SURF.paint);
  wheelSet(m, L / 2 - 1.6, 0.46, 0.3, W / 2 - 0.28);
  wheelSet(m, -L / 2 + 1.6, 0.46, 0.3, W / 2 - 0.28);
  // district lettering on both flanks, under the window band
  for (const sx of [-1, 1]) {
    m.push([sx * (W / 2 + 0.05), 0, 0], [0, sx * (Math.PI / 2), 0]);
    letterRow(m, "SCRAPFALL UNIFIED", -4.6, 1.52, 0, 0.3, "#1d1c1a");
    letterRow(m, "SCHOOL DISTRICT", -3.9, 1.12, 0, 0.3, "#1d1c1a");
    m.pop();
  }
  for (const sx of [-1, 1])
    m.box(0.05, 0.05, 0.5, [sx * (W / 2 + 0.12), 2.45, L / 2 - 0.3], "#1d1c1a", SURF.steel);
  m.cyl(0.05, 1.7, [W / 2 - 0.4, 0.32, -L / 2 + 0.5], "#3a3a38", SURF.steel, {
    rot: [Math.PI / 2, 0, 0],
    open: true,
    seg: 6,
  });
}

/** box truck / moving van */
function truck(m: Model, c: string) {
  const L = 7.9,
    W = 2.5;
  m.box(W, 2.7, 4.9, [0, 1.75, -L / 2 + 2.55], "#d8d3c5", SURF.carPaintMatte, { bevel: 0.05 });
  m.box(W + 0.02, 0.1, 4.9, [0, 3.14, -L / 2 + 2.55], "#b8b3a5", SURF.paint);
  for (const sx of [-1, 1])
    m.box(0.07, 2.6, 0.07, [sx * (W / 2 - 0.05), 1.75, -L / 2 + 0.12], "#b8b3a5", SURF.paint);
  // roll door + step bumper at the rear
  m.box(W - 0.3, 1.7, 0.07, [0, 1.9, -L / 2 + 0.16], "#8f8a80", SURF.paint);
  for (let y = 1.2; y < 2.7; y += 0.34) m.box(W - 0.34, 0.05, 0.08, [0, y, -L / 2 + 0.12], "#a5a094", SURF.paint);
  m.box(W, 0.3, 0.4, [0, 0.5, -L / 2 + 0.1], "#6f6a5f", SURF.steel);
  m.box(W - 0.25, 0.95, 2.6, [0, 0.95, L / 2 - 1.45], c, SURF.carPaintMatte);
  m.box(W - 0.35, 0.72, 1.7, [0, 1.75, L / 2 - 1.15], c, SURF.carPaintMatte);
  m.box(W - 0.5, 0.5, 0.08, [0, 1.78, L / 2 - 0.29], GLASS_C, SURF.glass);
  for (const sx of [-1, 1]) {
    m.box(0.06, 0.5, 1.55, [sx * (W / 2 - 0.16), 1.7, L / 2 - 1.1], GLASS_C, SURF.glass);
    m.box(0.12, 0.5, 0.8, [sx * (W / 2 - 0.02), 0.4, L / 2 - 0.5], "#3a3a38", SURF.steel);
  }
  m.box(W + 0.1, 0.3, 0.25, [0, 0.5, L / 2 + 0.08], CHROME, SURF.chrome);
  m.box(2.1, 0.55, 0.06, [0, 2.55, -L / 2 + 0.02], "#6a8a5f", SURF.paint); // mover's name board
  // own gag: the grille reads "SMC" (Scrapfall Moving Co.), the tail board the firm
  letterRow(m, "SMC", -0.36, 0.66, L / 2 + 0.13, 0.16, "#efe6cd");
  m.push([0, 2.55, -L / 2 - 0.05], [0, Math.PI, 0]);
  letterRow(m, "SCRAPFALL MOVING CO", -0.98, -0.09, 0, 0.09, "#e8e2d2");
  m.pop();
  wheelSet(m, L / 2 - 1.1, 0.42, 0.28, W / 2 - 0.24);
  wheelSet(m, -L / 2 + 1.2, 0.42, 0.28, W / 2 - 0.24);
  for (const sx of [-1, 1])
    m.cyl(0.1, 0.06, [sx * (W / 2 - 0.3), 0.95, L / 2 + 0.04], "#f4f2dc", SURF.lens, {
      rot: [Math.PI / 2, 0, 0],
      seg: 8,
    });
}

/** 50s sedan / wagon: rounded body, fins, chrome */
function sedan(m: Model, c: string, wagon = false) {
  const L = 4.8,
    W = 1.86;
  m.box(W, 0.62, L, [0, 0.62, 0], c, SURF.carPaintMatte, { bevel: 0.14 });
  const cabL = wagon ? 3.1 : 2.2,
    cabZ = wagon ? -0.5 : -0.3;
  m.box(W - 0.3, 0.55, cabL, [0, 1.2, cabZ], c, SURF.carPaintMatte, { bevel: 0.12 });
  m.box(W - 0.26, 0.4, cabL - 0.4, [0, 1.24, cabZ], GLASS_C, SURF.glass);
  for (const z of wagon ? [cabZ - 1.15, cabZ - 0.35, cabZ + 0.45, cabZ + 1.3] : [cabZ - 0.85, cabZ + 0.8])
    for (const sx of [-1, 1]) m.box(0.07, 0.46, 0.1, [sx * (W / 2 - 0.15), 1.24, z], c, SURF.carPaintMatte);
  for (const sx of [-1, 1])
    m.box(0.07, 0.3, 1.5, [sx * (W / 2 - 0.08), 0.92, -L / 2 + 0.85], c, SURF.carPaintMatte, {
      rot: [-0.1, 0, 0],
    });
  m.box(W + 0.08, 0.24, 0.3, [0, 0.4, L / 2 + 0.08], CHROME, SURF.chrome);
  m.box(W + 0.08, 0.24, 0.3, [0, 0.4, -L / 2 - 0.08], CHROME, SURF.chrome);
  m.box(W - 0.5, 0.24, 0.06, [0, 0.7, L / 2 + 0.02], CHROME, SURF.chrome);
  for (const sx of [-1, 1]) {
    m.box(0.03, 0.1, L - 0.7, [sx * (W / 2 + 0.01), 0.85, 0], CHROME, SURF.chrome);
    m.cyl(0.11, 0.07, [sx * (W / 2 - 0.32), 0.8, L / 2 + 0.04], "#f4f2dc", SURF.lens, {
      rot: [Math.PI / 2, 0, 0],
      seg: 8,
    });
    m.cyl(0.07, 0.06, [sx * (W / 2 - 0.25), 0.82, -L / 2 - 0.03], "#a02020", SURF.lens, {
      rot: [Math.PI / 2, 0, 0],
      seg: 8,
    });
  }
  // whitewalls
  for (const z of [L / 2 - 0.95, -L / 2 + 0.95])
    for (const sx of [-1, 1]) {
      m.cyl(0.34, 0.24, [sx * (W / 2 - 0.16), 0.34, z], "#e8e6da", SURF.tyre, {
        rot: [0, 0, Math.PI / 2],
        seg: 12,
      });
      m.cyl(0.34, 0.2, [sx * (W / 2 - 0.15), 0.34, z], "#151517", SURF.tyre, {
        rot: [0, 0, Math.PI / 2],
        seg: 12,
      });
      m.cyl(0.15, 0.26, [sx * (W / 2 - 0.16), 0.34, z], CHROME, SURF.chrome, {
        rot: [0, 0, Math.PI / 2],
        seg: 8,
      });
    }
}

/** army jeep at the roadblock */
function jeep(m: Model, c: string) {
  const L = 3.4,
    W = 1.6;
  m.box(W, 0.62, L, [0, 0.62, 0], c, SURF.carPaintMatte, { bevel: 0.05 });
  m.box(W, 0.3, 0.9, [0, 0.95, -L / 2 + 0.6], c, SURF.carPaintMatte);
  m.box(W - 0.15, 0.5, 0.09, [0, 1.35, L / 2 - 0.5], GLASS_C, SURF.glass);
  m.box(W - 0.08, 0.07, 0.12, [0, 1.63, L / 2 - 0.5], c, SURF.carPaintMatte);
  for (const sx of [-1, 1])
    m.box(0.07, 0.5, 0.09, [sx * (W / 2 - 0.35), 1.37, L / 2 - 0.5], c, SURF.carPaintMatte);
  for (const sx of [-1, 1]) m.box(0.5, 0.16, 0.5, [sx * (W / 2 - 0.3), 0.82, -0.45], "#3a352c", SURF.leather);
  m.box(0.5, 0.16, 0.5, [-W / 2 + 0.3, 0.82, 0.45], "#3a352c", SURF.leather);
  m.cyl(0.34, 0.2, [0, 0.9, -L / 2 - 0.12], "#151517", SURF.tyre, { rot: [0, 0, Math.PI / 2], seg: 10 });
  m.box(W + 0.05, 0.18, 0.22, [0, 0.42, L / 2 + 0.06], "#55554a", SURF.steel);
  m.box(0.9, 0.4, 0.05, [-0.2, 0.75, L / 2 + 0.02], "#6f6f5a", SURF.paint);
  for (const sx of [-1, 1])
    m.cyl(0.09, 0.06, [sx * (W / 2 - 0.35), 0.88, L / 2 + 0.04], "#f4f2dc", SURF.lens, {
      rot: [Math.PI / 2, 0, 0],
      seg: 8,
    });
  wheelSet(m, L / 2 - 0.55, 0.36, 0.22, W / 2 - 0.1, "#5a5a4a");
  wheelSet(m, -L / 2 + 0.55, 0.36, 0.22, W / 2 - 0.1, "#5a5a4a");
}

// ---------------------------------------------------------------- mannequins

function mannequin(m: Model, pose: string, hat = false) {
  const skin = MANNE,
    seam = MANNE_D;
  if (pose === "lounge") {
    // sunbather: flat on the lawn, hands behind the head
    m.box(0.44, 0.24, 0.8, [0, 0.32, 0], skin, SURF.polymer, { rot: [0.1, 0, 0] });
    m.sphere(0.16, [0, 0.52, -0.46], skin, SURF.polymer, { s: [0.88, 1, 1.05] });
    m.box(0.42, 0.2, 0.55, [0, 0.24, 0.52], skin, SURF.polymer);
    for (const sx of [-1, 1]) {
      m.box(0.14, 0.16, 0.8, [sx * 0.12, 0.2, 1.05], skin, SURF.polymer);
      m.box(0.16, 0.1, 0.26, [sx * 0.12, 0.18, 1.5], seam, SURF.polymer);
      m.box(0.09, 0.09, 0.5, [sx * 0.33, 0.4, -0.28], skin, SURF.polymer, { rot: [0.95, 0, sx * 0.35] });
    }
    return;
  }
  const seated = pose === "sit" || pose === "sitFloor";
  const hipY = pose === "sitFloor" ? 0.26 : 0.48;
  m.box(0.44, 0.6, 0.26, [0, hipY + 0.38, 0], skin, SURF.polymer); // torso
  m.box(0.46, 0.2, 0.3, [0, hipY + 0.02, 0], skin, SURF.polymer); // hips
  m.box(0.47, 0.03, 0.31, [0, hipY + 0.12, 0], seam, SURF.polymer); // waist seam
  m.cyl(0.06, 0.1, [0, hipY + 0.72, 0], skin, SURF.polymer, { seg: 8 });
  m.sphere(0.17, [0, hipY + 0.94, 0], skin, SURF.polymer, { s: [0.88, 1.05, 0.95] });
  m.box(0.1, 0.04, 0.02, [0, hipY + 0.95, 0.16], seam, SURF.polymer); // face notch
  if (hat) {
    m.cyl(0.21, 0.02, [0, hipY + 1.08, 0], "#5c5140", SURF.wood, { seg: 10 });
    m.cyl(0.13, 0.12, [0, hipY + 1.14, 0], "#5c5140", SURF.wood, { seg: 8 });
  }
  for (const sx of [-1, 1]) {
    if (pose === "sit") {
      m.box(0.15, 0.16, 0.5, [sx * 0.12, hipY - 0.04, 0.2], skin, SURF.polymer); // thigh
      m.box(0.14, 0.5, 0.15, [sx * 0.12, hipY - 0.32, 0.42], skin, SURF.polymer); // shin
      m.box(0.16, 0.07, 0.3, [sx * 0.12, hipY - 0.55, 0.5], seam, SURF.polymer); // foot
      m.box(0.09, 0.4, 0.1, [sx * 0.31, hipY + 0.4, 0.04], skin, SURF.polymer, { rot: [-0.5, 0, sx * 0.12] });
      m.box(0.08, 0.4, 0.09, [sx * 0.3, hipY + 0.28, 0.26], skin, SURF.polymer, { rot: [-1.35, 0, 0] });
    } else if (pose === "sitFloor") {
      m.box(0.15, 0.14, 0.55, [sx * 0.16, 0.12, 0.3], skin, SURF.polymer, { rot: [0.1, sx * 0.55, 0] });
      m.box(0.09, 0.4, 0.1, [sx * 0.31, hipY + 0.4, 0.02], skin, SURF.polymer, { rot: [0, 0, sx * 0.2] });
      m.box(0.08, 0.36, 0.09, [sx * 0.34, hipY + 0.05, 0.06], skin, SURF.polymer, { rot: [-0.3, 0, 0] });
    } else {
      m.box(0.16, 0.8, 0.17, [sx * 0.12, hipY - 0.6, 0], skin, SURF.polymer); // leg
      m.box(0.2, 0.08, 0.32, [sx * 0.12, hipY - 0.96, 0.05], seam, SURF.polymer); // foot
      m.box(0.1, 0.52, 0.11, [sx * 0.31, hipY + 0.4, 0], skin, SURF.polymer, { rot: [0, 0, sx * 0.12] });
      m.box(0.09, 0.44, 0.1, [sx * 0.36, hipY - 0.04, 0.02], skin, SURF.polymer, { rot: [0.05, 0, sx * 0.05] });
    }
  }
}

// ---------------------------------------------------------------- block text

const GLYPHS: Record<string, string[]> = {
  N: ["101", "111", "111", "101", "101"],
  U: ["101", "101", "101", "101", "111"],
  K: ["101", "110", "100", "110", "101"],
  E: ["111", "100", "111", "100", "111"],
  T: ["111", "010", "010", "010", "010"],
  O: ["111", "101", "101", "101", "111"],
  W: ["101", "101", "101", "111", "101"],
  R: ["110", "101", "110", "101", "101"],
  I: ["111", "010", "010", "010", "111"],
  Y: ["101", "101", "010", "010", "010"],
  A: ["010", "101", "111", "101", "101"],
  V: ["101", "101", "101", "101", "010"],
  L: ["100", "100", "100", "100", "111"],
  S: ["011", "100", "010", "001", "110"],
  D: ["110", "101", "101", "101", "110"],
  C: ["011", "100", "100", "100", "011"],
  P: ["110", "101", "110", "100", "100"],
  M: ["101", "111", "111", "101", "101"],
  G: ["011", "100", "101", "101", "011"],
  "5": ["111", "100", "110", "001", "110"],
  "1": ["010", "110", "010", "010", "111"],
  "0": ["111", "101", "101", "101", "111"],
  ".": ["000", "000", "000", "000", "010"],
  " ": ["000", "000", "000", "000", "000"],
};
/** paint `text` on the local +z plane, starting at (x, y) up-right, letters `size` tall-ish */
function letterRow(D: Model, text: string, x: number, y: number, z: number, size: number, color: string) {
  let cx = x;
  const u = size / 5.5;
  for (const ch of text) {
    const g = GLYPHS[ch] ?? GLYPHS[" "]!;
    for (let r = 0; r < 5; r++)
      for (let c = 0; c < 3; c++)
        if (g[r]![c] === "1")
          D.box(u * 2.6, u * 1.9, 0.02, [cx + c * u * 3.2, y + (4 - r) * u * 1.55, z], color, SURF.paint);
    cx += u * 3.2 * 4;
  }
  return cx;
}

// ---------------------------------------------------------------- house art

function houseArt(S: Model, D: Model, Gl: Model, side: "n" | "s") {
  const H = NUKE.houseN,
    G = NUKE.garageN,
    P = NUKE.porchN;
  const wallC = HOUSE_COLORS[side === "n" ? 0 : 1]!,
    roofC = "#7a6f5e",
    T = NUKE.wallT,
    ridgeX = (H.x0 + H.x1) / 2,
    F2 = NUKE.slabY,
    fy = NUKE.floorY;

  // ---- foundation + garage pad lip
  S.box(H.x1 - H.x0 + 2 * T + 0.12, 0.26, H.z1 - H.z0 + 2 * T + 0.12, [ridgeX, 0.09, (H.z0 + H.z1) / 2], "#8f8a80", SURF.paint);
  S.box(G.x1 - G.x0 + T + 0.12, 0.2, G.z1 - G.z0 + 2 * T + 0.12, [(G.x0 + G.x1) / 2, 0.06, (G.z0 + G.z1) / 2], "#8f8a80", SURF.paint);

  // ---- gable roof over the house: two planes, shingles, fascia, ridge cap
  const half = (H.x1 - H.x0) / 2 + T + 0.42,
    rise = NUKE.ridgeY - NUKE.wallTop,
    slope = Math.atan2(rise, half),
    planeLen = Math.hypot(half, rise),
    zMid = (H.z0 + H.z1) / 2,
    zLen = H.z1 - H.z0 + 2 * T + 1.15;
  for (const sx of [-1, 1]) {
    S.box(planeLen, 0.1, zLen, [ridgeX + (sx * half) / 2, NUKE.wallTop + rise / 2 + 0.03, zMid], roofC, SURF.wood, {
      rot: [0, 0, -sx * slope],
    });
    for (let k = 1; k < 9; k++) {
      const t = k / 9;
      D.box(planeLen / 9 + 0.12, 0.03, zLen, [ridgeX + sx * half * (1 - t) + sx * 0.06 * Math.cos(slope), NUKE.wallTop + rise * t + 0.09, zMid], k % 2 ? "#847a69" : "#736a5a", SURF.wood, {
        rot: [0, 0, -sx * slope],
      });
    }
    // fascia at the eave
    D.box(0.07, 0.24, zLen, [ridgeX + sx * half + sx * 0.04, NUKE.wallTop + 0.14, zMid], WHITE, SURF.wood, {
      rot: [0, 0, -sx * 0.12],
    });
  }
  S.cyl(0.1, zLen, [ridgeX, NUKE.ridgeY + 0.04, zMid], "#6b6255", SURF.wood, {
    rot: [Math.PI / 2, 0, 0],
    seg: 8,
  });
  // gable ends (triangles fill the wall above the plate line)
  for (const zz of [H.z0 - T / 2, H.z1 + T / 2])
    S.extrude(
      [
        [H.x0 - T - ridgeX, 0],
        [0, rise],
        [H.x1 + T - ridgeX, 0],
      ],
      T + 0.06,
      [ridgeX, NUKE.wallTop, zz],
      wallC,
      SURF.wood,
    );
  // rake trim along the sloped gable edges
  for (const zz of [H.z0 - T - 0.02, H.z1 + T + 0.02])
    for (const sx of [-1, 1])
      D.box(planeLen + 0.1, 0.09, 0.07, [ridgeX + (sx * half) / 2, NUKE.wallTop + rise / 2 + 0.02, zz], WHITE, SURF.wood, {
        rot: [0, 0, -sx * slope],
      });
  // chimney + TV antenna
  S.box(0.62, 1.5, 0.46, [ridgeX - half * 0.5, NUKE.wallTop + rise * 0.45 + 0.45, H.z0 + 1.8], BRICK, SURF.wood);
  S.box(0.72, 0.08, 0.56, [ridgeX - half * 0.5, NUKE.wallTop + rise * 0.45 + 1.22, H.z0 + 1.8], "#6f4a38", SURF.wood);
  D.cyl(0.02, 2.4, [ridgeX - half * 0.2, NUKE.wallTop + rise * 0.7 + 1.1, H.z0 + 3.4], "#8a9296", SURF.steel, { seg: 5 });
  D.box(1.1, 0.03, 0.03, [ridgeX - half * 0.2, NUKE.wallTop + rise * 0.7 + 2.2, H.z0 + 3.4], "#8a9296", SURF.steel);
  D.box(0.7, 0.03, 0.03, [ridgeX - half * 0.2, NUKE.wallTop + rise * 0.7 + 1.95, H.z0 + 3.4], "#8a9296", SURF.steel);
  D.box(0.4, 0.03, 0.03, [ridgeX - half * 0.2, NUKE.wallTop + rise * 0.7 + 1.7, H.z0 + 3.4], "#8a9296", SURF.steel);

  // ---- garage roof (shallower gable, ridge along z)
  const ghalf = (G.x1 - G.x0) / 2 + T + 0.3,
    grise = NUKE.garageRidgeY - NUKE.garageSlabY,
    gslope = Math.atan2(grise, ghalf),
    glen = Math.hypot(ghalf, grise),
    gx = (G.x0 + G.x1) / 2,
    gz = (G.z0 + G.z1) / 2;
  for (const sx of [-1, 1])
    S.box(glen + 0.06, 0.09, G.z1 - G.z0 + 2 * T + 0.7, [gx + (sx * ghalf) / 2, NUKE.garageSlabY + grise / 2 + 0.02, gz], roofC, SURF.wood, {
      rot: [0, 0, -sx * gslope],
    });
  for (const zz of [G.z0 - T / 2, G.z1 + T / 2])
    S.extrude(
      [
        [G.x0 - T - gx, 0],
        [0, grise],
        [G.x1 + T - gx, 0],
      ],
      T + 0.05,
      [gx, NUKE.garageSlabY, zz],
      "#a89d8a",
      SURF.wood,
    );
  // raised sectional door parked overhead, on its rails
  D.box(G.x1 - G.x0 - 0.7, 0.05, 2.2, [gx, 2.4, G.z0 + 1.5], "#b9b09c", SURF.paint);
  for (let k = 0; k < 4; k++)
    D.box(G.x1 - G.x0 - 0.7, 0.025, 0.04, [gx, 2.44, G.z0 + 0.65 + k * 0.55], "#9a917e", SURF.paint);
  for (const sx of [-1, 1])
    D.box(0.05, 0.05, 2.8, [gx + sx * (G.x1 - G.x0) / 2.7, 2.5, G.z0 + 1.8], "#6f6a5f", SURF.steel);
  // door frame around the vehicle opening
  D.box(0.12, 2.42, 0.14, [-16.75, 1.15, G.z1 + T], WHITE, SURF.wood);
  D.box(0.12, 2.42, 0.14, [-14.25, 1.15, G.z1 + T], WHITE, SURF.wood);
  D.box(2.7, 0.14, 0.14, [-15.5, 2.42, G.z1 + T], WHITE, SURF.wood);

  // ---- porch: posts, rail, shed roof, swing, step
  const poZ = P.z1;
  for (const px of [P.x0 + 0.3, P.x1 - 0.3]) {
    S.box(0.14, 2.5, 0.14, [px, 0.16 + 1.25, poZ - 0.24], WHITE, SURF.wood);
    S.box(0.22, 0.1, 0.22, [px, 0.2, poZ - 0.24], CONCRETE, SURF.paint);
  }
  S.box(P.x1 - P.x0 + 0.8, 0.09, 2.4, [(P.x0 + P.x1) / 2, 2.8, (P.z0 + P.z1) / 2 + 0.1], roofC, SURF.wood, {
    rot: [-0.08, 0, 0],
  });
  D.box(P.x1 - P.x0 + 0.8, 0.18, 0.07, [(P.x0 + P.x1) / 2, 2.66, poZ + 0.28], WHITE, SURF.wood);
  // rail between the posts along the outer edge, plus balusters
  const railY = 0.16;
  D.box(P.x1 - P.x0 - 0.7, 0.07, 0.05, [(P.x0 + P.x1) / 2, railY + 0.85, poZ - 0.26], WHITE, SURF.wood);
  D.box(P.x1 - P.x0 - 0.7, 0.05, 0.04, [(P.x0 + P.x1) / 2, railY + 0.45, poZ - 0.26], WHITE, SURF.wood);
  for (let x = P.x0 + 0.5; x < P.x1 - 0.4; x += 0.3)
    D.box(0.05, 0.42, 0.04, [x, railY + 0.64, poZ - 0.26], WHITE, SURF.wood);
  // porch swing (a mannequin sits on it): chains run from the seat up to the roof
  D.box(1.1, 0.07, 0.5, [-8.1, 0.62, poZ - 0.55], "#7f9a8d", SURF.wood);
  D.box(1.1, 0.5, 0.07, [-8.1, 0.94, poZ - 0.8], "#7f9a8d", SURF.wood);
  for (const sx of [-1, 1]) {
    D.cyl(0.013, 2.1, [-8.1 + sx * 0.52, 1.68, poZ - 0.57], "#8a9296", SURF.steel, { seg: 4 });
    D.cyl(0.013, 2.0, [-8.1 + sx * 0.52, 1.7, poZ - 0.79], "#8a9296", SURF.steel, { seg: 4 });
  }
  S.box(1.4, 0.1, 0.55, [-7.05, 0.06, poZ + 0.3], CONCRETE, SURF.paint); // step at the front walk

  // ---- open door leaves (collision stays out of the swing path)
  D.box(0.92, 2.3, 0.05, [-7.4, 1.35, H.z1 + T + 0.4], "#7a5c40", SURF.wood, { rot: [0, 0.65, 0] });
  D.box(0.92, 2.28, 0.05, [-11.45, 1.32, H.z0 - T - 0.55], "#7a5c40", SURF.wood, { rot: [0, -0.6, 0] });
  D.box(0.85, 2.2, 0.05, [-15.2, 1.28, G.z0 - T - 0.5], "#7a5c40", SURF.wood, { rot: [0, -0.75, 0] });
  // deck door upstairs, swung out onto the deck boards
  D.box(0.92, 2.28, 0.05, [-8.55, F2 + 1.12, H.z0 - T - 0.5], "#7a5c40", SURF.wood, { rot: [0, -0.6, 0] });

  // ---- rear deck + garden stair (collision lives in the plan)
  for (const px of [-12.2, -10.0, -7.8])
    S.box(0.14, F2 - 0.18, 0.14, [px, (F2 - 0.18) / 2, -18.8], "#7a6248", SURF.wood);
  const stAng = Math.atan2(F2, 4.92),
    stLen = Math.hypot(4.92, F2);
  for (const xx of [-8.63, -7.57]) {
    S.box(0.07, 0.3, stLen, [xx, F2 / 2 + 0.05, -21.44], "#7a6248", SURF.wood, { rot: [-stAng, 0, 0] });
    D.box(0.05, 0.07, stLen * 0.95, [xx, F2 / 2 + 0.82, -21.44], "#8a6f4d", SURF.wood, { rot: [-stAng, 0, 0] });
  }
  // rail caps over the deck parapets + plank lines on the deck floor
  D.box(0.2, 0.05, 1.4, [-12.385, F2 + 0.99, -18.3], "#efe6cd", SURF.wood);
  D.box(0.2, 0.05, 1.4, [-7.615, F2 + 0.99, -18.3], "#efe6cd", SURF.wood);
  D.box(3.78, 0.05, 0.2, [-10.47, F2 + 0.99, -18.94], "#efe6cd", SURF.wood);
  for (let k = 0; k < 5; k++) D.box(4.75, 0.02, 0.03, [-10.0, F2 + 0.01, -18.85 + k * 0.26], "#8d7f68", SURF.wood);
  // mantle crates on the lawn at the house's front-east corner — a staircase
  // of movers' boxes up to the porch-roof edge (two crates + a wardrobe carton)
  D.box(0.85, 0.69, 0.8, [-3.87, 0.505, -8.2], "#a8906a", SURF.wood);
  D.box(0.7, 1.19, 0.7, [-4.5, 0.755, -8.2], "#96805e", SURF.wood, { rot: [0, 0.28, 0] });
  D.box(0.75, 2.19, 0.79, [-4.53, 1.255, -8.95], "#b09a70", SURF.wood, { rot: [0, -0.06, 0] });
  D.box(0.87, 0.05, 0.82, [-3.87, 0.87, -8.2], "#8d7a58", SURF.wood);
  D.box(0.72, 0.05, 0.72, [-4.5, 1.37, -8.2], "#8d7a58", SURF.wood, { rot: [0, 0.28, 0] });

  // ---- windows: sill, mullion, mid rail, glass downstairs only
  const win = (a: number, b: number, y0: number, y1: number, c0: number, along: "x" | "z") => {
    const w = b - a,
      mid = (a + b) / 2,
      cx = along === "x" ? mid : c0,
      cz = along === "x" ? c0 : mid;
    D.box(along === "x" ? w + 0.18 : 0.12, 0.07, along === "x" ? 0.12 : w + 0.18, [cx, y0 - 0.01, cz], WHITE, SURF.wood);
    D.box(along === "x" ? 0.05 : 0.07, y1 - y0 - 0.12, along === "x" ? 0.07 : 0.05, [cx, (y0 + y1) / 2, cz], WHITE, SURF.wood);
    D.box(along === "x" ? w - 0.1 : 0.07, 0.06, along === "x" ? 0.07 : w - 0.1, [cx, y0 + (y1 - y0) * 0.62, cz], WHITE, SURF.wood);
  };
  const glass = (a: number, b: number, y0: number, y1: number, c0: number, along: "x" | "z") => {
    const mid = (a + b) / 2,
      cx = along === "x" ? mid : c0,
      cz = along === "x" ? c0 : mid;
    Gl.box(
      along === "x" ? b - a - 0.1 : 0.04,
      y1 - y0 - 0.08,
      along === "x" ? 0.04 : b - a - 0.1,
      [cx, (y0 + y1) / 2, cz],
      "#9fb8bd",
      SURF.glass,
    );
  };
  // ground floor, glazed
  for (const [a, b, y0, y1, c0, ax] of [
    [-11.9, -10.3, 1.05, 2.35, H.z1 + T / 2, "x"],
    [-5.85, -4.95, 1.05, 2.35, H.z1 + T / 2, "x"],
    [-8.9, -7.1, 1.15, 2.3, H.z0 - T / 2, "x"],
    [-16.8, -15.6, 1.05, 2.3, H.x1 + T / 2, "z"],
    [-12.5, -11.5, 1.9, 2.7, H.x1 + T / 2, "z"],
  ] as const) {
    win(a, b, y0, y1, c0, ax);
    glass(a, b, y0, y1, c0, ax);
  }
  // upstairs, open slots (the firing line)
  for (const [a, b, y0, y1, c0, ax] of [
    [-9.6, -7.4, 3.35, 5.5, H.z1 + T / 2, "x"],
    [-12.4, -11.2, 4.0, 5.35, H.z1 + T / 2, "x"],
    [-12.2, -11, 4.0, 5.35, H.z0 - T / 2, "x"],
    [-10.4, -9.9, 4.1, 5.2, H.x1 + T / 2, "z"],
    [-17.1, -16.3, 4.1, 5.2, H.x1 + T / 2, "z"],
    [-11.4, -10.2, 4.0, 5.3, H.x0 - T / 2, "z"],
    [-16.9, -15.7, 4.0, 5.3, H.x0 - T / 2, "z"],
  ] as const)
    win(a, b, y0, y1, c0, ax);
  // shutters flanking the street windows
  const shutterC = side === "n" ? "#3d6b62" : "#9a7b3a";
  for (const [a, b, y] of [
    [-11.9, -10.3, 1.7],
    [-5.85, -4.95, 1.7],
    [-9.6, -7.4, 4.45],
  ] as const)
    for (const px of [a - 0.22, b + 0.22]) D.box(0.3, 1.42, 0.05, [px, y, H.z1 + T + 0.03], shutterC, SURF.wood);
  // corner boards + water table cap over the foundation
  for (const [cx, cz] of [
    [H.x0 - T, H.z0 - T],
    [H.x1 + T, H.z0 - T],
    [H.x0 - T, H.z1 + T],
    [H.x1 + T, H.z1 + T],
  ] as const)
    D.box(0.13, NUKE.wallTop - 0.1, 0.13, [cx, NUKE.wallTop / 2, cz], WHITE, SURF.wood);
  for (const [x0, z0, x1, z1] of [
    [H.x0 - T - 0.03, H.z0 - T - 0.03, H.x1 + T + 0.03, H.z0 - T + 0.04],
    [H.x0 - T - 0.03, H.z1 + T - 0.04, H.x1 + T + 0.03, H.z1 + T + 0.03],
    [H.x1 + T - 0.04, H.z0 - T, H.x1 + T + 0.03, H.z1 + T],
    [H.x0 - T - 0.03, H.z0 - T, H.x0 - T + 0.04, H.z1 + T],
  ] as const)
    D.box(x1 - x0, 0.1, z1 - z0, [(x0 + x1) / 2, 0.28, (z0 + z1) / 2], WHITE, SURF.wood);

  // ---- interior + garage dressing
  furnitureArt(D);
}

function furnitureArt(D: Model) {
  const fy = NUKE.floorY,
    F2 = NUKE.slabY;
  // living room: sofa + credenza + TV + coffee table + rug
  D.box(1.36, 0.42, 1.7, [-12.08, fy + 0.21, -11.05], "#a4574a", SURF.leather);
  D.box(0.3, 0.62, 1.7, [-12.58, fy + 0.72, -11.05], "#a4574a", SURF.leather);
  for (let i = 0; i < 3; i++) D.box(0.8, 0.16, 0.52, [-11.98, fy + 0.5, -11.7 + i * 0.62], "#b96a5c", SURF.leather);
  D.box(0.26, 0.52, 0.5, [-12.5, fy + 0.78, -11.5], "#b96a5c", SURF.leather, { rot: [0, 0.25, 0] });
  D.box(1.7, 0.55, 0.4, [-5.6, fy + 0.3, -9.95], "#6f5138", SURF.wood);
  D.box(0.72, 0.55, 0.42, [-5.6, fy + 0.85, -9.95], "#3a3532", SURF.paint);
  D.box(0.56, 0.4, 0.06, [-5.7, fy + 0.86, -9.74], "#7fa39a", SURF.glow);
  D.box(1.8, 0.4, 0.8, [-9.3, fy + 0.2, -11.7], "#8a6a4a", SURF.wood);
  D.box(2.6, 0.02, 1.9, [-10.3, fy + 0.02, -11.5], "#7d5a58", SURF.wood);
  D.box(0.5, 0.55, 0.5, [-6.6, fy + 0.3, -11.9], "#8fae9a", SURF.leather); // armchair
  // kitchen: counter run + uppers + fridge + range + sink
  D.box(4.2, 0.06, 0.66, [-6.8, fy + 0.93, -16.83], "#d8cfba", SURF.paint);
  for (let i = 0; i < 5; i++) D.box(0.8, 0.78, 0.6, [-8.55 + i * 0.86, fy + 0.55, -16.85], "#8fa3a8", SURF.paint);
  D.box(2.4, 0.75, 0.34, [-7.4, fy + 2.15, -17.05], "#8fa3a8", SURF.paint);
  D.box(0.72, 1.75, 0.72, [-12.55, fy + 0.92, -16.8], "#d8d2c2", SURF.paint, { bevel: 0.04 });
  D.box(0.85, 0.08, 0.62, [-6.2, fy + 0.95, -16.82], "#4a4a48", SURF.paint);
  for (let i = 0; i < 4; i++)
    D.cyl(0.09, 0.02, [-6.45 + (i % 2) * 0.5, fy + 1.0, -16.95 + Math.floor(i / 2) * 0.3], "#1c1c1c", SURF.paint, { seg: 8 });
  D.box(0.58, 0.12, 0.44, [-8.3, fy + 0.95, -16.85], "#c9c4b8", SURF.steel);
  D.cyl(0.02, 0.3, [-8.3, fy + 1.1, -16.9], "#8a9296", SURF.steel, { seg: 5 });
  // dining table + chairs (the mannequin family)
  D.box(2.0, 0.07, 1.15, [-8.8, fy + 0.74, -15.2], "#96684a", SURF.wood);
  for (const [dx, dz] of [
    [-0.9, -0.45],
    [0.9, -0.45],
    [-0.9, 0.45],
    [0.9, 0.45],
  ] as const)
    D.box(0.09, 0.72, 0.09, [-8.8 + dx, fy + 0.37, -15.2 + dz], "#6f4f38", SURF.wood);
  for (const [cx, cz, facing] of [
    [-8.8, -14.35, 0],
    [-9.75, -15.2, Math.PI / 2],
    [-7.85, -15.2, -Math.PI / 2],
  ] as const) {
    D.push([cx, 0, cz], [0, facing, 0]);
    D.box(0.46, 0.06, 0.46, [0, fy + 0.44, 0], "#96684a", SURF.wood);
    D.box(0.46, 0.55, 0.06, [0, fy + 0.72, -0.22], "#96684a", SURF.wood);
    for (const sx of [-1, 1]) D.box(0.06, 0.44, 0.06, [sx * 0.18, fy + 0.22, 0.16], "#6f4f38", SURF.wood);
    for (const sx of [-1, 1]) D.box(0.06, 0.72, 0.06, [sx * 0.18, fy + 0.36, -0.2], "#6f4f38", SURF.wood);
    D.pop();
  }
  for (const [px, pz] of [
    [-8.8, -14.85],
    [-9.25, -15.3],
    [-8.3, -15.3],
  ] as const)
    D.cyl(0.11, 0.02, [px, fy + 0.79, pz], "#e8e2d2", SURF.paint, { seg: 10 });
  D.sphere(0.15, [-8.8, fy + 0.87, -15.2], "#8a5a48", SURF.leather, { s: [1.4, 0.65, 0.9] });
  // upstairs: two beds, dresser, desk, books
  const bed = (x: number, z: number, cover: string) => {
    D.box(2.05, 0.3, 1.2, [x, F2 + 0.28, z], "#7a5c40", SURF.wood);
    D.box(2.0, 0.2, 1.05, [x, F2 + 0.5, z], cover, SURF.leather);
    D.box(0.55, 0.13, 0.62, [x - 0.7, F2 + 0.62, z], "#efe8d4", SURF.wood);
    D.box(0.09, 0.85, 1.2, [x - 1.02, F2 + 0.42, z], "#7a5c40", SURF.wood);
    D.box(0.09, 0.55, 1.2, [x + 1.02, F2 + 0.28, z], "#7a5c40", SURF.wood);
  };
  bed(-11.65, -11.05, "#7d94a8");
  bed(-11.65, -16.35, "#a87d7d");
  D.box(1.7, 0.9, 0.5, [-5.45, F2 + 0.45, -10.25], "#7a5c40", SURF.wood);
  for (let i = 0; i < 3; i++) D.box(0.44, 0.2, 0.05, [-5.45 + (i - 1) * 0.55, F2 + 0.45, -10.0], "#8f6a4a", SURF.wood);
  D.box(0.6, 0.06, 1.4, [-12.6, F2 + 0.75, -12.85], "#7a5c40", SURF.wood); // desk on the front room's west wall
  D.box(0.5, 0.5, 0.42, [-11.95, F2 + 0.25, -12.85], "#96684a", SURF.wood); // its chair
  D.box(0.04, 0.55, 0.42, [-12.94, F2 + 1.45, -12.85], "#6a5236", SURF.wood); // framed portrait above it
  D.box(0.2, 0.5, 0.2, [-9.9, F2 + 0.25, -10.3], "#8a6a4a", SURF.wood);
  D.cyl(0.09, 0.05, [-9.9, F2 + 0.52, -10.3], "#c8b45e", SURF.paint, { seg: 8 }); // lamp
  D.box(0.14, 0.3, 0.06, [-9.9, F2 + 0.65, -10.3], "#e8d8a8", SURF.glow);
  D.box(1.6, 0.02, 2.2, [-8.4, F2 + 0.015, -11.4], "#7d8a94", SURF.wood); // rug
  for (let i = 0; i < 4; i++) D.box(0.3, 0.05, 0.22, [-12.3, F2 + 1.0 + i * 0.16, -13.9], ["#a5453c", "#4a6a8a", "#8a8a4a", "#5a5a5a"][i]!, SURF.paint);
  // ceiling lights
  D.box(0.42, 0.06, 0.42, [-8.6, 3.04, -11.6], "#ffe2a5", SURF.glow);
  D.box(0.42, 0.06, 0.42, [-8.6, 3.04, -15.4], "#ffe2a5", SURF.glow);
  D.box(0.42, 0.06, 0.42, [-8.5, F2 + 2.78, -11.5], "#ffe2a5", SURF.glow);
  D.box(0.42, 0.06, 0.42, [-8.5, F2 + 2.78, -15.8], "#ffe2a5", SURF.glow);
  // curtains on the street windows
  for (const [wx, wy] of [
    [-11.1, 1.7],
    [-8.5, 4.68],
  ] as const) {
    D.box(0.28, 1.5, 0.06, [wx - 1.0, wy, -9.82], "#c8b89a", SURF.leather);
    D.box(0.28, 1.5, 0.06, [wx + 1.0, wy, -9.82], "#c8b89a", SURF.leather);
  }
  // garage: bench along the west wall, tools, shelf, crates, a bike leaning on it
  const gy = 0.14;
  D.box(0.68, 0.08, 2.2, [-16.9, gy + 0.92, -14.7], "#8a6a4a", SURF.wood);
  for (const dz of [-0.95, 0.95]) D.box(0.62, 0.9, 0.09, [-16.9, gy + 0.45, -14.7 + dz], "#6f4f38", SURF.wood);
  D.box(0.06, 0.75, 2.0, [-17.22, gy + 1.7, -14.7], "#a08a5e", SURF.wood); // pegboard
  for (let i = 0; i < 4; i++) D.box(0.18, 0.1, 0.3, [-16.88, gy + 1.02, -15.4 + i * 0.45], ["#a5453c", "#4a6a8a", "#8a8a4a", "#5a5a5a"][i]!, SURF.paint);
  D.box(0.9, 1.4, 0.4, [-14.0, gy + 0.7, -10.1], "#7a6248", SURF.wood);
  for (let i = 0; i < 3; i++) D.box(0.3, 0.04, 0.2, [-14.0, gy + 0.5 + i * 0.4, -10.3], "#d8cfba", SURF.paint);
  for (let i = 0; i < 6; i++)
    D.box(0.36, 0.34, 0.36, [-16.5 + (i % 2) * 0.6, gy + 0.3 + Math.floor(i / 2) * 0.36, -11.8], i % 2 ? "#a08a5e" : "#8a7a55", SURF.wood);
  // bike against the bench's south end
  D.cyl(0.34, 0.05, [-17.05, gy + 0.34, -12.9], "#1d1c1a", SURF.tyre, { rot: [0, 0, Math.PI / 2], seg: 10 });
  D.cyl(0.34, 0.05, [-17.05, gy + 0.34, -12.0], "#1d1c1a", SURF.tyre, { rot: [0, 0, Math.PI / 2], seg: 10 });
  D.box(0.06, 0.06, 0.85, [-17.05, gy + 0.55, -12.45], "#a5453c", SURF.paint);
  D.box(0.5, 0.06, 0.06, [-17.05, gy + 0.72, -12.0], "#8a9296", SURF.steel);
  // utility meter + vent outside
  D.box(0.3, 0.42, 0.16, [-4.14, 0.9, -14.5], "#9aa0a4", SURF.steel);
  D.cyl(0.05, 0.35, [-4.08, 0.5, -15.6], "#7a7a72", SURF.steel, { rot: [0, 0, Math.PI / 2], seg: 6 });
}

// ---------------------------------------------------------------- street props

function streetArt(S: Model, D: Model) {
  const BC = NUKE.bulb;
  // mailboxes
  for (const [x, z] of [
    [-7.1, -4.35],
    [7.1, 4.35],
  ] as const) {
    S.box(0.09, 1.05, 0.09, [x, 0.5, z], WOOD_D, SURF.wood);
    S.box(0.24, 0.24, 0.5, [x, 1.05, z + 0.14 * Math.sign(z)], "#4a4f55", SURF.steel);
    D.cyl(0.12, 0.24, [x, 1.17, z + 0.14 * Math.sign(z)], "#4a4f55", SURF.steel, { rot: [0, 0, Math.PI / 2], seg: 8 });
    D.box(0.04, 0.16, 0.04, [x + 0.14, 1.3, z + 0.26 * Math.sign(z)], "#b03030", SURF.paint);
  }
  // hydrant
  S.cyl(0.17, 0.72, [-0.3, 0.36, -4.5], "#b3402e", SURF.paint, { seg: 10 });
  S.sphere(0.18, [-0.3, 0.78, -4.5], "#b3402e", SURF.paint);
  for (const a of [0, 2.1, 4.2])
    S.cyl(0.07, 0.16, [-0.3 + Math.cos(a) * 0.19, 0.52, -4.5 + Math.sin(a) * 0.19], "#a03828", SURF.paint, {
      rot: [Math.PI / 2, 0, a],
      seg: 6,
    });
  S.box(0.36, 0.1, 0.36, [-0.3, 0.05, -4.5], "#8a3324", SURF.paint);
  // population sign, facing west down the street
  for (const sz of [-1, 1]) S.box(0.1, 2.4, 0.1, [25.5, 1.2, -4.8 + sz * 1.35], "#5c5546", SURF.wood);
  S.box(0.08, 1.2, 3.1, [25.5, 2.0, -4.8], "#2e4a38", SURF.paint);
  D.push([25.44, 1.95, -4.8], [0, -Math.PI / 2, 0]);
  letterRow(D, "NUKETOWN", -1.3, 0.16, 0.06, 0.42, INK);
  letterRow(D, "POP. 51", -0.72, -0.38, 0.06, 0.3, "#c8b45e");
  D.pop();
  // Trinity Ave blade + stop sign at the bulb mouth
  S.cyl(0.05, 2.6, [-15, 1.3, -4.9], "#6a6f66", SURF.steel, { seg: 8 });
  S.box(0.05, 0.26, 1.5, [-15, 2.45, -4.9], "#2e4a38", SURF.paint);
  D.push([-15, 2.45, -4.83], [0, 0, 0]);
  letterRow(D, "TRINITY AV", -0.62, -0.09, 0.05, 0.2, INK);
  D.pop();
  S.box(0.64, 0.64, 0.05, [-15, 1.9, -4.82], "#a8302a", SURF.paint, { rot: [0, 0, Math.PI / 4] });
  // lamp posts with globe lights
  for (const [x, z] of [
    [-13, -4.6],
    [6.5, -4.6],
    [-11.5, 4.6],
    [18, 4.6],
  ] as const) {
    S.cyl(0.07, 3.4, [x, 1.7, z], "#3f4438", SURF.steel, { seg: 8 });
    S.cyl(0.12, 0.14, [x, 3.42, z], "#3f4438", SURF.steel, { seg: 8 });
    D.sphere(0.16, [x, 3.62, z], "#fff2cf", SURF.glow);
  }
  // roadblock: jersey barriers + sawhorses + CLOSED
  for (const z of [-2, 2]) {
    S.box(0.36, 0.55, 1.9, [27.4, 0.6, z], "#c8c2b4", SURF.paint, { bevel: 0.03 });
    S.box(0.3, 0.2, 1.9, [27.4, 0.14, z], "#a8a294", SURF.paint);
  }
  for (const z of [-0.2, 4.4]) {
    for (const sx of [-0.7, 0.7]) {
      S.box(0.07, 0.8, 0.07, [26.3 + sx, 0.4, z - 0.15], "#8a6a3a", SURF.wood, { rot: [0.2, 0, sx * 0.3] });
      S.box(0.07, 0.8, 0.07, [26.3 + sx, 0.4, z + 0.15], "#8a6a3a", SURF.wood, { rot: [-0.2, 0, sx * 0.3] });
    }
    S.box(0.06, 0.3, 1.7, [26.3, 0.78, z], "#d8d2c2", SURF.paint);
    for (let k = 0; k < 4; k++)
      D.box(0.065, 0.3, 0.26, [26.3, 0.78, z - 0.62 + k * 0.4], k % 2 ? "#b3402e" : "#d8d2c2", SURF.paint);
  }
  S.box(0.05, 0.6, 1.4, [26.3, 1.35, -0.2], "#d8d2c2", SURF.paint);
  D.push([26.26, 1.35, -0.2], [0, -Math.PI / 2, 0]);
  letterRow(D, "CLOSED", -0.55, -0.14, 0.05, 0.22, "#b3402e");
  D.pop();
  // telephone poles heading east through the desert, sagging wire between them
  const poleXs = [32, 40, 48];
  for (const x of poleXs) {
    S.cyl(0.09, 6.5, [x, 3.25, -4.2], "#5d4a38", SURF.wood, { seg: 7 });
    S.box(1.6, 0.08, 0.08, [x, 6.0, -4.2], "#5d4a38", SURF.wood);
    S.box(1.2, 0.08, 0.08, [x, 5.45, -4.2], "#5d4a38", SURF.wood);
  }
  for (let i = 0; i + 1 < poleXs.length; i++)
    for (const [dz, yy] of [
      [-0.7, 5.95],
      [0.7, 5.95],
    ] as const)
      D.cable(
        [
          [poleXs[i]!, yy, -4.2 + dz],
          [(poleXs[i]! + poleXs[i + 1]!) / 2, yy - 0.5, -4.2 + dz],
          [poleXs[i + 1]!, yy, -4.2 + dz],
        ],
        0.015,
        "#2c2c2a",
      );
  // flag pole on the south lawn
  S.cyl(0.05, 4.6, [6, 2.3, 7.3], "#8a9296", SURF.steel, { seg: 7 });
  D.box(0.9, 0.55, 0.03, [6.48, 4.3, 7.3], "#b04038", SURF.leather);
  D.box(0.4, 0.28, 0.035, [6.24, 4.42, 7.3], "#30405c", SURF.paint);
  for (let i = 0; i < 3; i++) D.box(0.85, 0.04, 0.032, [6.48, 4.12 + i * 0.14, 7.3], INK, SURF.paint);
  // newspaper on the driveway + a tricycle by the kerb
  D.cyl(0.06, 0.4, [14.3, 0.06, 6.6], "#d8d2c2", SURF.paint, { rot: [0, 0.4, Math.PI / 2], seg: 6 });
  for (const s of [1, -1] as const) yardArt(S, D, s);
}

/** one lot's yard dressing; s=1 is the north lot, s=-1 mirrors it */
function yardArt(S: Model, D: Model, s: 1 | -1) {
  const Z = (z: number) => z * s,
    X = (x: number) => x * s;
  // swing set: two A-frames (legs splay in z), a bar, two swings — yellow yard only
  if (s === -1) {
    for (const e of [-1, 1])
      for (const q of [-1, 1])
        S.box(0.07, 2.25, 0.07, [X(-9) + e * 1.05, 1.05, Z(-24.2) + q * 0.45], WOOD_D, SURF.wood, {
          rot: [q * 0.22 * s, 0, 0],
        });
    S.box(2.35, 0.08, 0.08, [X(-9), 2.14, Z(-24.2)], WOOD_D, SURF.wood);
    for (const dx of [-0.55, 0.55]) {
      for (const sx of [-1, 1])
        D.cyl(0.013, 1.45, [X(-9) + dx + sx * 0.14, 1.4, Z(-24.2)], "#8a9296", SURF.steel, { seg: 4 });
      D.box(0.44, 0.05, 0.2, [X(-9) + dx, 0.62, Z(-24.2)], "#b04a40", SURF.paint);
    }
  }
  // green yard instead gets the fallout-shelter hatch: concrete collar flush with
  // the lawn, bolted steel lid, air vent, stencil marking
  if (s === 1) {
    S.box(2.0, 0.2, 1.5, [-9, 0.1, -24.4], CONCRETE, SURF.paint);
    S.box(1.7, 0.07, 1.2, [-9, 0.24, -24.4], "#6f7a70", SURF.steel);
    for (const ex of [-0.72, 0.72]) S.box(0.16, 0.1, 0.32, [-9 + ex, 0.3, -24.4], "#57504a", SURF.steel);
    D.cyl(0.05, 0.5, [-8.6, 0.48, -24.4], "#8a9296", SURF.steel, { rot: [0, 0, 0.7], seg: 6 });
    D.cyl(0.09, 1.15, [-9.8, 0.57, -25.05], "#8a9296", SURF.steel, { seg: 7 });
    D.cyl(0.17, 0.07, [-9.8, 1.16, -25.05], "#9aa2a6", SURF.steel, { seg: 8 });
    D.push([-9, 0.29, -24.4], [-Math.PI / 2, 0, 0]);
    letterRow(D, "SHELTER", -0.64, -0.09, 0, 0.08, "#e8e2d2");
    D.pop();
  }
  // the pet/RC gap under each rear fence: bare dirt humped on both faces
  for (const zz of [-30.55, -31.45])
    D.sphere(0.55, [X(-1.95), 0.09, Z(zz)], SOIL, SURF.wood, { s: [1.5, 0.35, 0.85] });
  // picnic table + benches + kettle grill
  const px = X(-14.4),
    pz = Z(-22.3);
  S.box(1.7, 0.07, 0.9, [px, 0.72, pz], "#7a6248", SURF.wood);
  for (const e of [-1, 1]) {
    S.box(1.7, 0.05, 0.3, [px, 0.44, pz + e * 0.64], "#7a6248", SURF.wood);
    for (const q of [-0.62, 0.62])
      S.box(0.09, 0.7, 0.09, [px + q, 0.35, pz + e * 0.44], WOOD_D, SURF.wood, { rot: [e * 0.35 * s, 0, 0] });
  }
  S.cyl(0.28, 0.55, [px + 1.5, 0.55, pz + 0.7], "#2c2c2e", SURF.paint, { seg: 10 });
  S.sphere(0.29, [px + 1.5, 0.86, pz + 0.7], "#2c2c2e", SURF.paint);
  for (let i = 0; i < 3; i++)
    S.cyl(0.025, 0.5, [px + 1.5 + Math.cos((i / 3) * Math.PI * 2) * 0.2, 0.25, pz + 0.7 + Math.sin((i / 3) * Math.PI * 2) * 0.2], "#6a6f66", SURF.steel, { seg: 5 });
  // trash cans by the garage rear corner
  for (const dx of [0, 0.55]) {
    S.cyl(0.26, 0.75, [X(-13.5) + dx, 0.38, Z(-18.5)], "#8a8f8a", SURF.steel, { seg: 10 });
    S.cyl(0.29, 0.07, [X(-13.5) + dx, 0.79, Z(-18.5)], "#9aa09a", SURF.steel, { seg: 10 });
  }
  // clothesline: two T-posts, two sheets
  for (const cx of [X(-3), X(-1.9)]) {
    S.cyl(0.05, 2.15, [cx, 1.07, Z(-26.4)], "#7a7568", SURF.steel, { seg: 7 });
    S.box(0.85, 0.05, 0.05, [cx, 2.12, Z(-26.4)], "#7a7568", SURF.steel);
  }
  for (const [mx, w, c] of [
    [(X(-3) + X(-1.9)) / 2 - 0.25, 0.8, "#e8e2d2"],
    [(X(-3) + X(-1.9)) / 2 + 0.4, 0.7, "#c8d4d8"],
  ] as const)
    D.box(w, 1.15, 0.03, [mx, 1.5, Z(-26.4)], c, SURF.leather);
  // lawn chair + flamingo pair + garden bed
  S.box(0.5, 0.05, 0.55, [X(-6), 0.3, Z(-20.5)], "#c47a4a", SURF.paint, { rot: [0, 0.4 * s, 0] });
  S.box(0.5, 0.45, 0.05, [X(-6) - 0.16 * s, 0.6, Z(-20.5) - 0.2 * s], "#c47a4a", SURF.paint, { rot: [-0.35 * s, 0.4 * s, 0] });
  for (const fx of [-6.6, -6.15]) {
    D.cyl(0.015, 0.5, [X(fx), 0.25, Z(-7.3)], "#c46a8a", SURF.steel, { seg: 4 });
    D.sphere(0.11, [X(fx), 0.56, Z(-7.3)], "#d47a9a", SURF.paint, { s: [1.4, 0.9, 0.9] });
    D.box(0.05, 0.2, 0.05, [X(fx) + 0.14, 0.62, Z(-7.3)], "#d47a9a", SURF.paint);
  }
  S.box(0.75, 0.24, 5.5, [X(-1.55), 0.12, Z(-21)], SOIL, SURF.wood);
  for (let i = 0; i < 5; i++) D.sphere(0.16, [X(-1.55), 0.32, Z(-23.2) + i * 1.1], "#6a7a52", SURF.rubber);
  for (let i = 0; i < 6; i++) D.sphere(0.3, [X(-12.6) + i * 0.92, 0.26, Z(-9.9)], "#5f7050", SURF.rubber, { s: [1, 0.72, 1] });
  // trees
  for (const [tx, tz, sc] of [
    [-15.5, -23.5, 1.0],
    [-7.5, -20.5, 0.65],
  ] as const) {
    S.cyl(0.16 * sc, 2.2 * sc, [X(tx), 1.1 * sc, Z(tz)], "#5d4a38", SURF.wood, { seg: 7, rb: 0.22 * sc });
    // canopy is foliage: detail bag — it must not wall off the path or eat bullets
    for (const [ox, oy, oz, r] of [
      [0, 2.6, 0, 1.5],
      [0.85, 2.2, 0.45, 1.0],
      [-0.7, 2.3, -0.4, 1.0],
    ] as const)
      D.sphere(r * sc, [X(tx) + ox * sc, oy * sc, Z(tz) + oz * sc], "#64784f", SURF.rubber, { s: [1, 0.85, 1] });
  }
  // the mower mid-lawn + dog house (south yard only)
  if (s === 1) {
    S.box(0.44, 0.2, 0.6, [-5.9, 0.14, -25.1], "#a5453c", SURF.paint);
    S.cyl(0.09, 0.4, [-6.0, 0.09, -25.05], "#151517", SURF.tyre, { rot: [0, 0, Math.PI / 2], seg: 8 });
    S.cyl(0.09, 0.4, [-5.8, 0.09, -25.05], "#151517", SURF.tyre, { rot: [0, 0, Math.PI / 2], seg: 8 });
    D.box(0.05, 0.8, 0.05, [-5.9, 0.5, -25.4], "#6a6f66", SURF.steel, { rot: [-0.5, 0, 0] });
  } else {
    S.box(0.95, 0.72, 1.05, [1.55, 0.36, 24.95], "#a08a68", SURF.wood);
    S.box(1.1, 0.09, 1.2, [1.55, 0.8, 24.95], "#7a6f5e", SURF.wood, { rot: [0, 0, 0.26] });
    D.box(0.42, 0.46, 0.07, [1.55, 0.32, 24.4], "#3a3228", SURF.wood);
  }
}

// ---------------------------------------------------------------- desert backdrop

function backdrop(S: Model, D: Model) {
  // house #3 across the cul-de-sac: facade faces east into the bulb
  const H3 = NUKE.houseW,
    h3c = "#c9a2b0";
  S.box(H3.x1 - H3.x0, 5.9, H3.z1 - H3.z0, [(H3.x0 + H3.x1) / 2, 2.95, 0], h3c, SURF.wood);
  // shallow gable roof, ridge along z; gable triangles on the north/south faces
  const h3x = (H3.x0 + H3.x1) / 2,
    h3half = (H3.x1 - H3.x0) / 2 + 0.4,
    h3rise = 1.3,
    h3len = Math.hypot(h3half, h3rise);
  for (const sx of [-1, 1])
    S.box(h3len + 0.1, 0.1, H3.z1 - H3.z0 + 0.9, [h3x + (sx * h3half) / 2, 5.9 + h3rise / 2, 0], "#7a6f5e", SURF.wood, {
      rot: [0, 0, -sx * Math.atan2(h3rise, h3half)],
    });
  for (const zz of [H3.z0 + 0.12, H3.z1 - 0.12])
    S.extrude(
      [
        [H3.x0 - h3x, 0],
        [0, h3rise],
        [H3.x1 - h3x, 0],
      ],
      0.2,
      [h3x, 5.9, zz],
      h3c,
      SURF.wood,
    );
  S.cyl(0.09, H3.z1 - H3.z0 + 0.8, [h3x, 5.9 + h3rise + 0.04, 0], "#6b6255", SURF.wood, {
    rot: [Math.PI / 2, 0, 0],
    seg: 6,
  });
  // porch + door + windows on the east face
  S.box(0.6, 0.14, 4.2, [H3.x1 + 0.45, 0.1, 0], CONCRETE, SURF.paint);
  for (const zz of [-1.7, 1.7]) S.box(0.13, 2.2, 0.13, [H3.x1 + 0.8, 1.15, zz], WHITE, SURF.wood);
  S.box(0.5, 0.08, 4.4, [H3.x1 + 0.55, 2.32, 0], "#7a6f5e", SURF.wood);
  S.box(0.1, 2.0, 0.9, [H3.x1 + 0.08, 1.1, 0], "#7a5c40", SURF.wood);
  for (const zz of [-2.7, -1.5, 1.5, 2.7]) D.box(0.05, 1.15, 0.85, [H3.x1 + 0.07, 1.75, zz], GLASS_C, SURF.glass);
  for (const zz of [-2.6, 0, 2.6]) D.box(0.05, 1.1, 1.0, [H3.x1 + 0.07, 4.85, zz], GLASS_C, SURF.glass);
  // driveway meets the bulb kerb; trike left on the walk
  S.box(3.6, 0.07, 2.6, [-25.3, 0.035, 0], CONCRETE, SURF.paint);
  D.box(0.4, 0.24, 0.65, [-25.0, 0.22, 2.4], "#b04038", SURF.paint, { rot: [0, 0.7, 0] });
  D.cyl(0.13, 0.05, [-24.8, 0.13, 2.7], "#1d1c1a", SURF.tyre, { rot: [0, 0, Math.PI / 2], seg: 8 });

  // backdrop ranches NE + SW behind the fences
  for (const r of [NUKE.backdropN, { x0: -NUKE.backdropN.x1, x1: -NUKE.backdropN.x0, z0: -NUKE.backdropN.z1, z1: -NUKE.backdropN.z0 }]) {
    const cx = (r.x0 + r.x1) / 2,
      cz = (r.z0 + r.z1) / 2;
    S.box(r.x1 - r.x0, 3.4, r.z1 - r.z0, [cx, 1.7, cz], "#bcae94", SURF.wood);
    S.box(r.x1 - r.x0 + 0.9, 0.16, r.z1 - r.z0 + 0.9, [cx, 3.45, cz], "#857b6c", SURF.wood);
    S.box(r.x1 - r.x0 + 0.9, 0.5, 0.3, [cx, 3.6, cz + (cz < 0 ? -4.4 : 4.4) * 0], "#857b6c", SURF.wood);
    for (let i = 0; i < 4; i++)
      D.box(0.95, 1.0, 0.08, [r.x0 + 1.3 + i * 2.1, 1.6, cz + (cz < 0 ? 4.06 : -4.06)], GLASS_C, SURF.glass);
    S.box(1.1, 2.0, 0.55, [r.x0 + 1.2, 4.3, cz + 1.2], BRICK, SURF.wood);
    for (let i = 0; i < 3; i++) D.sphere(0.4, [r.x0 - 1.5 + i * 0.8, 0.35, cz + (cz < 0 ? 5.5 : -5.5)], "#5f7050", SURF.rubber, { s: [1, 0.7, 1] });
  }
  // farther silhouettes + the test-site water tower east
  for (const [x, z, w] of [
    [-34, -16, 7],
    [-38, 10, 9],
    [36, 15, 8],
    [40, -20, 10],
    [14, -37, 9],
    [-8, 38, 8],
  ] as const) {
    S.box(w, 2.6, 6, [x, 1.3, z], "#a89878", SURF.wood);
    S.box(w + 0.6, 0.3, 6.6, [x, 2.75, z], "#8d8270", SURF.wood);
  }
  // steel lattice test mast (the bomb tower)
  const tx = 36,
    tz = -32;
  for (const [ox, oz] of [
    [-0.9, -0.9],
    [0.9, -0.9],
    [-0.9, 0.9],
    [0.9, 0.9],
  ] as const)
    S.box(0.15, 21, 0.15, [tx + ox * 0.7, 10.5, tz + oz * 0.7], "#4a4640", SURF.steel, { rot: [oz * 0.02, 0, ox * -0.02] });
  for (let y = 3; y < 20; y += 3.4) {
    S.box(1.6, 0.1, 0.1, [tx, y, tz - 0.63], "#4a4640", SURF.steel);
    S.box(1.6, 0.1, 0.1, [tx, y, tz + 0.63], "#4a4640", SURF.steel);
    S.box(0.1, 0.1, 1.6, [tx - 0.63, y, tz], "#4a4640", SURF.steel);
    S.box(0.1, 0.1, 1.6, [tx + 0.63, y, tz], "#4a4640", SURF.steel);
  }
  S.box(3.4, 2.5, 3.4, [tx, 21.8, tz], "#6a6258", SURF.steel);
  S.box(3.8, 0.16, 3.8, [tx, 23.1, tz], "#57504a", SURF.steel);
  // desert scrub, rocks, yucca — only outside the fences
  let seed = 12345;
  const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 110; i++) {
    const x = (rng() - 0.5) * 92,
      z = (rng() - 0.5) * 92;
    if (Math.abs(x) < 31 && Math.abs(z) < 32) continue;
    if (x > -16 && x < 15 && Math.abs(z) < 7) continue;
    const sc = 0.3 + rng() * 0.7;
    if (rng() < 0.55) S.sphere(0.3 * sc, [x, 0.1 * sc, z], "#7a8455", SURF.rubber, { s: [1.4, 0.55, 1.2], low: true });
    else S.box(0.5 * sc, 0.3 * sc, 0.4 * sc, [x, 0.12, z], "#8d8468", SURF.wood, { rot: [0, rng() * 3, 0] });
  }
  for (const [x, z] of [
    [-34, 12],
    [34, -10],
    [-30, -26],
    [37, 23],
  ] as const) {
    S.cyl(0.07, 2.6, [x, 1.3, z], "#6a7a52", SURF.wood, { seg: 6 });
    S.cyl(0.05, 1.4, [x + 0.5, 2.05, z], "#6a7a52", SURF.wood, { rot: [0, 0, 0.6], seg: 5 });
    S.cyl(0.05, 1.1, [x - 0.4, 1.75, z + 0.2], "#6a7a52", SURF.wood, { rot: [0.3, 0, -0.5], seg: 5 });
  }
  // dirt road running east past the gate, then the mesa ring and far peaks
  S.box(22, 0.03, 5.5, [41, 0.015, 0], "#9a8a68", SURF.wood);
  const mesa = (x: number, z: number, w: number, h: number, d: number, c: string) => {
    S.box(w, h, d, [x, h / 2 - 0.01, z], c, SURF.wood);
    S.box(w * 0.7, h * 0.45, d * 0.8, [x, h + h * 0.22, z], c, SURF.wood);
  };
  mesa(-44, -22, 26, 7, 12, "#a08a68");
  mesa(-40, 24, 20, 5, 10, "#9a8a6c");
  mesa(44, -8, 24, 8, 12, "#a3906e");
  mesa(38, 30, 18, 6, 10, "#9a8a6c");
  mesa(0, -44, 30, 6, 10, "#a3906e");
  mesa(-16, 44, 24, 7, 10, "#a08a68");
  mesa(30, 44, 20, 5, 9, "#9a8a6c");
  mesa(-46, 4, 14, 9, 10, "#a3906e");
  for (const [x, z, h] of [
    [-58, -42, 16],
    [50, -46, 20],
    [58, 32, 15],
    [-52, 44, 18],
    [8, -58, 14],
    [58, 6, 12],
  ] as const)
    S.cone(h * 0.95, h, [x, 0, z], "#968a76", SURF.wood, { seg: 5 });
}

// ---------------------------------------------------------------- the build

export function buildNuketown() {
  const bags = { solid: new Model(), detail: new Model(), glass: new Model() };
  const S = bags.solid,
    D = bags.detail;

  // terrain: desert base, lot lawns, street + bulb asphalt, kerbs, walks, driveways
  S.box(200, 0.3, 200, [0, -0.32, 0], SAND, SURF.wood);
  for (const r of [NUKE.lotN, NUKE.lotS, NUKE.pocketNE, NUKE.pocketSW, NUKE.pocketNW, NUKE.pocketSE])
    S.box(r.x1 - r.x0, 0.06, r.z1 - r.z0, [(r.x0 + r.x1) / 2, 0.01, (r.z0 + r.z1) / 2], GRASS, SURF.wood);
  S.box(NUKE.street.x1 - NUKE.street.x0, 0.05, NUKE.street.z1 - NUKE.street.z0, [(NUKE.street.x0 + NUKE.street.x1) / 2, 0.025, 0], ASPHALT, SURF.paint);
  S.cyl(NUKE.bulb.r, 0.05, [NUKE.bulb.x, 0.025, NUKE.bulb.z], ASPHALT, SURF.paint, { seg: 26 });
  for (let x = -15; x < 24; x += 3.4) D.box(1.7, 0.012, 0.14, [x, 0.053, 0], "#c8b45e", SURF.paint);
  for (const zs of [-3.5, 3.5])
    S.box(NUKE.street.x1 - NUKE.street.x0, 0.15, NUKE.kerb, [(NUKE.street.x0 + NUKE.street.x1) / 2, 0.05, zs + (zs > 0 ? 0.18 : -0.18)], KERB, SURF.paint);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    S.box(3.2, 0.15, NUKE.kerb, [NUKE.bulb.x + Math.cos(a) * (NUKE.bulb.r + 0.16), 0.05, NUKE.bulb.z + Math.sin(a) * (NUKE.bulb.r + 0.16)], KERB, SURF.paint, {
      rot: [0, -a - Math.PI / 2, 0],
    });
  }
  // concrete: sidewalk bands along the frontages, driveways, front walks
  S.box(48.5, 0.09, 0.95, [3.0, 0.045, -4.4], CONCRETE, SURF.paint);
  S.box(29.5, 0.09, 0.95, [11.5, 0.045, 4.4], CONCRETE, SURF.paint);
  for (const s of [1, -1] as const) {
    S.box(3.7, 0.07, 6.4, [s * -15.4, 0.035, s * -6.85], CONCRETE, SURF.paint); // driveway
    S.box(1.2, 0.07, 4.1, [s * -7.05, 0.035, s * -6.0], CONCRETE, SURF.paint); // front walk
    S.box(1.4, 0.07, 1.6, [s * -2.15, 0.035, s * -5.45], CONCRETE, SURF.paint); // side-path gate apron
  }

  // houses (north authored once, south mirrored through a pi rotation)
  for (const side of SIDES) {
    const rot = side === "n" ? 0 : Math.PI;
    S.push([0, 0, 0], [0, rot, 0]);
    D.push([0, 0, 0], [0, rot, 0]);
    bags.glass.push([0, 0, 0], [0, rot, 0]);
    houseArt(S, D, bags.glass, side);
    bags.glass.pop();
    D.pop();
    S.pop();
  }

  // fences: pickets everywhere the plan hid its rails
  const PICKET_RUNS: [number, number, number, number, [number, number][]?][] = [
    [-18, -5.6, -1, -5.6, [[-16.9, -13.9], [-7.6, -6.5], [-2.7, -1.6]]],
    [1, 5.6, 18, 5.6, [[13.9, 16.9], [6.5, 7.6], [1.6, 2.7]]],
    [-1, -5.6, 30, -5.6],
    [18, 5.6, 30, 5.6],
    [-30, -5.6, -18, -5.6],
    [-30, 5.6, 1, 5.6],
    [-26.6, -5.2, -26.6, 5.2, [[-1.4, 1.4]]],
  ];
  for (const [x0, z0, x1, z1, gaps] of PICKET_RUNS) {
    const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    const lo = alongX ? Math.min(x0, x1) : Math.min(z0, z1),
      hi = alongX ? Math.max(x0, x1) : Math.max(z0, z1);
    let cur = lo;
    const segs: [number, number][] = [];
    for (const [a, b] of [...(gaps ?? [])].sort((g, h) => g[0] - h[0])) {
      if (a > cur) segs.push([cur, a]);
      cur = b;
    }
    if (cur < hi) segs.push([cur, hi]);
    for (const [a, b] of segs)
      if (alongX) pickets(D, a, z0, b, z1);
      else pickets(D, x0, a, x1, b);
  }
  // bulb arc pickets follow the same chord pattern as the collision rails
  for (let i = 0; i < 10; i++) {
    const a0 = (-90 - (180 * i) / 10) * (Math.PI / 180),
      a1 = (-90 - (180 * (i + 1)) / 10) * (Math.PI / 180);
    pickets(
      D,
      NUKE.bulb.x + Math.cos(a0) * (NUKE.bulb.r + 0.35),
      NUKE.bulb.z + Math.sin(a0) * (NUKE.bulb.r + 0.35),
      NUKE.bulb.x + Math.cos(a1) * (NUKE.bulb.r + 0.35),
      NUKE.bulb.z + Math.sin(a1) * (NUKE.bulb.r + 0.35),
    );
  }
  // board fence dressing on the yard side of each panel
  const PRIV_RUNS: [number, number, number, number, 1 | -1][] = [
    [-18, -31, -2.4, -31, -1],
    [-1.5, -31, -1, -31, -1],
    [-1, -31, -1, -5.6, -1],
    [-18, -31, -18, -5.6, 1],
    [1, 31, 1.5, 31, 1],
    [2.4, 31, 18, 31, 1],
    [1, 5.6, 1, 31, 1],
    [18, 5.6, 18, 31, -1],
    [30, -5.6, 30, -3.7, -1],
    [30, 3.7, 30, 5.6, -1],
    // pocket perimeters (dressing faces the enclosed lawn)
    [-1, -31, 30, -31, 1],
    [30, -31, 30, -5.6, -1],
    [-30, -31, -18, -31, 1],
    [-30, -31, -30, -5.6, 1],
    [-30, 31, 1, 31, -1],
    [-30, 5.6, -30, 31, 1],
    [18, 31, 30, 31, -1],
    [30, 5.6, 30, 31, -1],
  ];
  for (const [x0, z0, x1, z1, inn] of PRIV_RUNS) privacyDress(D, x0, z0, x1, z1, inn);
  // chain-link gate across the east exit (collision solid lives in the plan)
  S.box(0.14, 1.95, 0.14, [30, 0.97, -3.7], "#8a9296", SURF.steel);
  S.box(0.14, 1.95, 0.14, [30, 0.97, 3.7], "#8a9296", SURF.steel);
  S.box(0.06, 0.09, 7.3, [30, 1.85, 0], "#8a9296", SURF.steel);
  S.box(0.06, 0.09, 7.3, [30, 0.1, 0], "#8a9296", SURF.steel);
  for (let z = -3.5; z < 3.6; z += 0.44)
    for (const dd of [-0.09, 0.09])
      D.box(0.016, 1.85, 0.016, [30 + dd, 0.93, z], "#9aa2a6", SURF.steel, { rot: [dd > 0 ? 0.42 : -0.42, 0, 0] });

  streetArt(S, D);

  for (const v of NUKE_VEHICLES) {
    S.push([v.x, 0, v.z], [0, v.yaw, 0]);
    if (v.kind === "bus") bus(S, v.color);
    else if (v.kind === "truck") truck(S, v.color);
    else if (v.kind === "jeep") jeep(S, v.color);
    else sedan(S, v.color, v.kind === "wagon");
    S.pop();
  }
  for (const q of NUKE_MANNEQUINS) {
    S.push([q.x, q.y ?? 0, q.z], [0, q.yaw, 0]);
    mannequin(S, q.pose, q.hat);
    S.pop();
  }

  backdrop(S, D);

  return { solid: S.build(), detail: D.build(), glass: bags.glass.build() };
}
