import { Model, SURF as S } from "../art/kit";

/** Small, batched sporting figures. Explicit activities, no ambient street pedestrians. */
export function sportingPerson(m: Model, pose: "surf" | "ski" | "seat", patrol = false) {
  const coat = patrol ? "#d42c29" : "#eeeeee",
    cloth = patrol ? S.enamel : S.carPaintMatte;
  const seat = pose === "seat",
    hip = seat ? 0.64 : 0.86;
  m.box(0.34, 0.2, 0.24, [0, hip, 0], "#242b33", S.polymer, { bevel: 0.04 });
  for (const x of [-0.15, 0.15]) {
    m.box(
      0.19,
      seat ? 0.22 : 0.43,
      seat ? 0.45 : 0.19,
      [x, seat ? 0.58 : 0.63, seat ? 0.15 : 0],
      "#283240",
      S.polymer,
      { bevel: 0.025, rot: [seat ? -0.3 : pose === "ski" ? -0.2 : 0.15, 0, 0] },
    );
    m.box(0.15, 0.35, 0.17, [x, seat ? 0.29 : 0.29, seat ? 0.35 : 0.07], "#283240", S.polymer, {
      bevel: 0.025,
    });
    m.box(0.19, 0.15, 0.32, [x, 0.085, seat ? 0.37 : 0.1], "#151b21", S.rubber, { bevel: 0.02 });
  }
  m.box(0.44, 0.48, 0.29, [0, hip + 0.32, 0.04], coat, cloth, {
    bevel: 0.07,
    rot: [pose === "ski" ? 0.18 : 0, 0, 0],
  });
  m.sphere(0.17, [0, hip + 0.75, 0.08], "#d1a17b", S.polymer, { s: [0.9, 1, 0.9] });
  if (pose !== "surf") {
    m.sphere(0.18, [0, hip + 0.8, 0.06], patrol ? "#eeeeea" : "#30353b", S.polymer, {
      s: [1, 0.65, 1],
    });
    m.box(0.26, 0.09, 0.08, [0, hip + 0.76, 0.235], "#567685", S.lens, { bevel: 0.02 });
  }
  for (const side of [-1, 1]) {
    if (pose === "surf")
      m.box(0.47, 0.13, 0.14, [side * 0.4, hip + 0.4, 0.04], coat, cloth, {
        rot: [0, 0, side * 0.2],
        bevel: 0.025,
      });
    else {
      m.box(0.14, 0.32, 0.16, [side * 0.27, hip + 0.31, 0.14], coat, cloth, {
        rot: [-0.7, 0, 0],
        bevel: 0.025,
      });
      m.box(0.13, 0.13, 0.34, [side * 0.27, hip + 0.18, 0.34], coat, cloth, { bevel: 0.025 });
      m.sphere(0.075, [side * 0.27, hip + 0.18, 0.48], "#232b32", S.leather);
    }
  }
  if (patrol) {
    m.box(0.21, 0.075, 0.015, [0, hip + 0.35, 0.19], "#ffffff", S.enamel);
    m.box(0.075, 0.21, 0.015, [0, hip + 0.35, 0.2], "#ffffff", S.enamel);
  }
}
export function marineModel(kind: "boat" | "jet" | "surf") {
  const m = new Model();
  if (kind === "boat") {
    // Bevelled V hull, gunwales, cockpit, windscreen and outboard; +z is the bow.
    m.extrude(
      [
        [-1.05, 0],
        [-0.75, -0.55],
        [0.75, -0.55],
        [1.05, 0],
      ],
      4.8,
      [0, 0, 0],
      "#e5e7e3",
      S.enamel,
      { bevel: 0.1 },
    );
    m.box(1.9, 0.12, 4.5, [0, 0.06, 0], "#aeb7b2", S.polymer, { bevel: 0.04 });
    for (const x of [-1, 1])
      m.box(0.12, 0.35, 4.55, [x, 0.27, 0], "#f1f0e7", S.enamel, { bevel: 0.04 });
    m.box(1.95, 0.35, 0.13, [0, 0.27, -2.22], "#eeeeea", S.enamel);
    m.box(1.92, 0.3, 1.1, [0, 0.21, 1.65], "#ecebe3", S.enamel, { bevel: 0.12 });
    m.box(1.55, 0.48, 0.55, [0, 0.35, -0.4], "#36464e", S.polymer, { bevel: 0.08 });
    m.box(1.55, 0.55, 0.12, [0, 0.8, 0.8], "#497180", S.glass, {
      rot: [-0.25, 0, 0],
      bevel: 0.015,
    });
    for (const x of [-0.85, 0.85])
      m.box(0.04, 0.65, 0.04, [x, 0.72, 0.75], "#c4c8c7", S.chrome, { rot: [-0.25, 0, 0] });
    m.box(0.48, 0.7, 0.6, [0, -0.04, -2.6], "#333b43", S.polymer, { bevel: 0.12 });
    m.box(0.13, 0.8, 0.13, [0, -0.55, -2.6], "#30333b", S.steel);
    m.push([-0.4, 0.12, -0.3], [0, 0, 0], 0.83);
    sportingPerson(m, "seat");
    m.pop();
    for (const [x, col] of [
      [-1, "#d83128"],
      [1, "#3bae5f"],
    ] as const)
      m.box(0.08, 0.06, 0.2, [x, 0.46, 1.4], col, S.glow);
  } else if (kind === "jet") {
    m.box(0.94, 0.32, 2.7, [0, 0.06, 0], "#eeeeee", S.carPaint, { bevel: 0.15 });
    m.box(0.76, 0.4, 1.15, [0, 0.32, 0.55], "#eeeeee", S.carPaint, {
      bevel: 0.16,
      rot: [0.12, 0, 0],
    });
    m.box(0.38, 0.2, 1.5, [0, 0.4, -0.45], "#282f35", S.rubber, { bevel: 0.08 });
    m.box(0.8, 0.065, 0.1, [0, 0.9, 0.4], "#42464a", S.steel);
    m.push([0, 0.35, -0.2], [0, 0, 0], 0.9);
    sportingPerson(m, "seat");
    m.pop();
  } else {
    m.box(0.57, 0.1, 2.25, [0, 0.03, 0], "#f4cf63", S.enamel, { bevel: 0.049 });
    m.box(0.055, 0.015, 1.6, [0, 0.09, 0], "#eaeeee", S.enamel);
    m.push([0, 0.09, 0], [0, Math.PI / 2, 0], 0.95);
    sportingPerson(m, "surf");
    m.pop();
  }
  return m.build();
}
export function skiModel() {
  const m = new Model();
  sportingPerson(m, "ski");
  for (const x of [-0.19, 0.19]) {
    m.box(0.13, 0.065, 1.9, [x, 0.015, 0.13], "#ead53e", S.enamel, { bevel: 0.025 });
    m.box(0.06, 0.06, 0.33, [x, 0.08, 0.98], "#ead53e", S.enamel, { rot: [-0.2, 0, 0] });
    m.cyl(0.013, 1.28, [x * 2, 0.65, -0.1], "#a6adb1", S.brushed, { rot: [0.28, 0, 0], seg: 6 });
  }
  return m.build();
}

export function snowVehicle(kind: "cat" | "mobile" | "patrol") {
  const m = new Model(),
    cat = kind === "cat",
    patrol = kind === "patrol";
  if (cat) {
    for (const x of [-1.05, 1.05]) {
      m.box(0.7, 0.65, 4.2, [x, 0.45, 0], "#272d31", S.rubber, { bevel: 0.25 });
      for (let z = -1.7; z <= 1.7; z += 0.34)
        m.box(0.74, 0.06, 0.09, [x, 0.79, z], "#8b949a", S.steel);
      for (let z = -1.6; z <= 1.6; z += 0.8)
        m.tubeX(0.27, 0.72, [x, 0.43, z], "#525b61", S.steel, { seg: 10 });
    }
    m.box(1.9, 0.65, 3.7, [0, 0.9, 0], "#e14a24", S.enamel, { bevel: 0.12 });
    m.box(1.85, 1.3, 1.8, [0, 1.83, 0.5], "#dc4926", S.enamel, { bevel: 0.1 });
    m.box(1.62, 0.75, 0.05, [0, 1.97, 1.425], "#476979", S.glass, { rot: [-0.12, 0, 0] });
    for (const x of [-0.94, 0.94])
      m.box(0.04, 0.7, 1.35, [x, 1.98, 0.5], "#426571", S.glass, { bevel: 0.025 });
    m.box(2.05, 0.12, 1.95, [0, 2.53, 0.5], "#e9512a", S.enamel, { bevel: 0.04 });
    for (const x of [-0.8, 0.8]) m.box(0.28, 0.2, 0.13, [x, 1.2, 1.94], "#fff0bd", S.glowSoft);
    m.box(3.6, 0.8, 0.28, [0, 0.42, 2.55], "#acb4b8", S.brushed, { bevel: 0.1, rot: [-0.2, 0, 0] });
    for (const x of [-0.65, 0.65]) m.box(0.15, 0.16, 1.4, [x, 0.35, 1.9], "#666e76", S.steel);
    m.cyl(0.1, 0.24, [0, 2.72, 0.5], "#f2a732", S.glowSoft, { seg: 10 });
  } else {
    m.box(0.65, 0.37, 2.1, [0, 0.27, -0.2], "#242b31", S.rubber, { bevel: 0.15 });
    for (let z = -1.15; z < 0.7; z += 0.2) m.box(0.7, 0.05, 0.08, [0, 0.48, z], "#899195", S.steel);
    m.box(0.95, 0.45, 2.35, [0, 0.65, 0], patrol ? "#ecece4" : "#da572d", S.enamel, {
      bevel: 0.18,
    });
    m.box(0.4, 0.2, 1.3, [0, 0.93, -0.5], "#293138", S.rubber, { bevel: 0.07 });
    m.box(0.68, 0.52, 0.12, [0, 1.2, 0.6], "#547684", S.glass, { rot: [-0.4, 0, 0], bevel: 0.025 });
    for (const x of [-0.57, 0.57]) {
      m.box(0.17, 0.07, 1.4, [x, 0.08, 1], "#292f35", S.rubber, { bevel: 0.025 });
      m.box(0.07, 0.55, 0.07, [x, 0.35, 0.6], "#acb2b5", S.steel, { rot: [-0.3, 0, 0] });
    }
    m.box(0.55, 0.16, 0.08, [0, 0.86, 1.22], "#fff0c8", S.glowSoft);
    m.box(0.8, 0.06, 0.08, [0, 1.24, 0.35], "#373f45", S.steel);
    m.push([0, 0.77, -0.45], [0, 0, 0], 0.85);
    sportingPerson(m, "seat", patrol);
    m.pop();
    if (patrol) {
      m.box(0.18, 0.12, 0.16, [-0.4, 1.11, 0.75], "#dc3332", S.lens);
      m.box(0.18, 0.12, 0.16, [0.4, 1.11, 0.75], "#397ed3", S.lens);
    }
  }
  return m.build();
}
