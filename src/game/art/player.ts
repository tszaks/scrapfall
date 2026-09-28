// The scavenger uses the same one-draw skinned art kit as the robots, in player proportions.
import { SURF as S } from "./kit";
import { defineRobot, RobotRig, robotMaterial, walkLegs, idle } from "./rig";

const player = defineRobot({
  name: "scavenger",
  stride: 1.8,
  wear: 0.35,
  bones: [
    { name: "hip", at: [0, 0.88, 0] },
    { name: "body", parent: "hip", at: [0, 1.08, 0] },
    { name: "head", parent: "body", at: [0, 1.5, 0] },
    { name: "legL", parent: "hip", at: [-0.15, 0.86, 0] },
    { name: "legR", parent: "hip", at: [0.15, 0.86, 0] },
    { name: "shinL", parent: "legL", at: [-0.15, 0.45, 0] },
    { name: "shinR", parent: "legR", at: [0.15, 0.45, 0] },
    { name: "hands", parent: "body", at: [-0.24, 1.22, 0.28] },
  ],
  build(m, B) {
    const cloth = "#383f44",
      plate = "#b8a58b",
      edge = "#4c565b",
      boot = "#24292b";
    m.bone = B.hip;
    m.box(0.38, 0.2, 0.26, [0, 0.87, 0], cloth, S.leather, { bevel: 0.04 });
    m.box(0.42, 0.07, 0.29, [0, 0.97, 0], boot, S.leather, { bevel: 0.015 });
    m.box(0.08, 0.07, 0.03, [0, 0.97, 0.16], "#c6c0a9", S.brass, { bevel: 0.009 });
    for (const [side, leg, shin] of [
      [-1, B.legL, B.shinL],
      [1, B.legR, B.shinR],
    ] as const) {
      m.bone = leg;
      m.box(0.21, 0.4, 0.22, [side * 0.15, 0.67, 0], cloth, S.polymer, { bevel: 0.045 });
      m.box(0.18, 0.12, 0.05, [side * 0.15, 0.48, 0.12], plate, S.paint, { bevel: 0.022 });
      m.bone = shin;
      m.box(0.17, 0.34, 0.18, [side * 0.15, 0.28, -0.025], cloth, S.polymer, { bevel: 0.03 });
      m.box(0.2, 0.15, 0.32, [side * 0.15, 0.095, 0.05], boot, S.rubber, { bevel: 0.03 });
      m.box(0.21, 0.025, 0.34, [side * 0.15, 0.025, 0.055], edge, S.rubber, { bevel: 0.009 });
    }
    m.bone = B.body;
    m.box(0.46, 0.45, 0.28, [0, 1.24, 0], cloth, S.polymer, { bevel: 0.07 });
    m.box(0.39, 0.3, 0.06, [0, 1.26, 0.16], plate, S.paint, { bevel: 0.035 });
    m.box(0.29, 0.34, 0.16, [0, 1.24, -0.2], edge, S.leather, { bevel: 0.035 });
    m.box(0.22, 0.16, 0.035, [0, 1.2, -0.3], cloth, S.leather, { bevel: 0.02 });
    for (const x of [-0.16, 0, 0.16])
      m.box(0.11, 0.12, 0.09, [x, 1.04, 0.18], edge, S.leather, { bevel: 0.016 });
    for (const side of [-1, 1]) {
      m.box(0.18, 0.2, 0.24, [side * 0.29, 1.35, 0.015], plate, S.paint, { bevel: 0.04 });
      m.box(0.13, 0.25, 0.15, [side * 0.29, 1.17, 0.06], cloth, S.polymer, { bevel: 0.025 });
    }
    m.bone = B.head;
    m.cyl(0.075, 0.11, [0, 1.49, 0], cloth, S.polymer, { seg: 10 });
    m.sphere(0.19, [0, 1.66, 0], plate, S.paint, { s: [0.9, 1, 0.9] });
    m.box(0.3, 0.12, 0.06, [0, 1.68, 0.155], "#476c76", S.lens, { bevel: 0.025 });
    m.box(0.2, 0.1, 0.085, [0, 1.56, 0.15], boot, S.rubber, { bevel: 0.025 });
    for (const x of [-0.095, 0.095])
      m.tubeZ(0.035, 0.055, [x, 1.56, 0.21], edge, S.gunmetal, { seg: 8 });
    m.bone = B.hands;
    // Raised forearms and gloved hands follow aim and recoil together with the weapon.
    m.box(0.13, 0.14, 0.29, [-0.29, 1.13, 0.23], cloth, S.polymer, { bevel: 0.025 });
    m.box(0.13, 0.11, 0.14, [-0.25, 1.2, 0.32], boot, S.leather, { bevel: 0.02 });
    m.box(0.14, 0.13, 0.32, [0.1, 1.14, 0.23], cloth, S.polymer, {
      bevel: 0.025,
      rot: [0, 0.65, 0],
    });
    m.box(0.13, 0.1, 0.13, [-0.08, 1.2, 0.35], boot, S.leather, { bevel: 0.02 });
  },
  animate(b, p) {
    walkLegs(b, p, 0.55);
    idle(b.body, p, 0.45);
    b.hands.rotation.x = p.aux;
    b.hands.position.z -= p.wind * 0.065;
    b.head.rotation.x = p.aux * 0.4;
  },
});
export const newPlayerRig = () => {
  const rig = new RobotRig(player, robotMaterial("base", 0.35));
  rig.mesh.name = "scavenger-player";
  rig.mesh.castShadow = true;
  rig.mesh.receiveShadow = true;
  return rig;
};
