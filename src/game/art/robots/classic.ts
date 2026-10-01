// The seven original robot types, rebuilt as detailed scrap-built machines. Each keeps
// its old silhouette and the map's colours (theme.enemy), so a drifter still reads as a
// pink floating eye and a brute as a hulking maul-swinger, but now with plating, joints,
// pistons, cables, bolts and glowing vents.
import * as THREE from "three";

import type { Theme } from "../../themes";
import { SURF, type Model } from "../kit";
import { defineRobot, idle, walkLegs, type RobotKind } from "../rig";
import type { RobotInputs } from "../RobotModel";

type C = Theme["enemy"];
const cache = new Map<string, RobotKind>();
const S = SURF;
const PI = Math.PI;

/** darken / lighten an sRGB hex */
function shade(hex: string, k: number) {
  const c = new THREE.Color(hex);
  if (k < 1) c.multiplyScalar(k);
  else c.lerp(new THREE.Color(1, 1, 1), k - 1);
  return c;
}

// ---------------------------------------------------------------- DRIFTER
function drifter(c: C, glowCol: string): RobotKind {
  const body = c.drifter.body;
  const eye = c.drifter.eye;
  const steel = "#8d9299";
  const dark = "#2b2e33";
  return defineRobot({
    name: "drifter",
    bones: [
      { name: "root", at: [0, 0, 0] },
      { name: "body", parent: "root", at: [0, 0.9, 0] },
      { name: "ringA", parent: "body", at: [0, 0.9, 0] },
      { name: "ringB", parent: "body", at: [0, 0.9, 0] },
      { name: "pods", parent: "body", at: [0, 0.9, 0] },
    ],
    build(m: Model, B) {
      m.bone = B.body!;
      m.push([0, 0.9, 0]);
      // core: an armoured sphere, plated in six curved segments with dark seams
      m.sphere(0.5, [0, 0, 0], dark, S.darkSteel);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * PI * 2 + PI / 6;
        m.push([0, 0, 0], [0, a, 0]);
        m.box(0.44, 0.5, 0.12, [0, 0.05, 0.47], body, S.enamel, { bevel: 0.04, rot: [-0.1, 0, 0] });
        m.box(0.3, 0.16, 0.1, [0, -0.33, 0.4], shade(body, 0.7), S.enamel, {
          bevel: 0.03,
          rot: [0.55, 0, 0],
        });
        m.bolts([-0.17, 0.26, 0.53], [0.17, 0.26, 0.53], 3, 0.018, steel);
        m.pop();
      }
      m.dome(0.36, [0, 0.36, 0], body, S.enamel, { s: [1, 0.55, 1] });
      m.cyl(0.14, 0.08, [0, 0.52, 0], steel, S.steel, { seg: 10 });
      // big eye: a lens in a machined bezel with an iris ring
      m.tubeZ(0.22, 0.2, [0, 0.02, 0.5], dark, S.gunmetal, { seg: 16 });
      m.torus(0.2, 0.035, [0, 0.02, 0.6], steel, S.brushed, { seg: 20 });
      m.sphere(0.15, [0, 0.02, 0.58], eye, S.glow, { s: [1, 1, 0.55] });
      m.sphere(0.06, [0, 0.02, 0.655], "#ffffff", S.glow, { low: true });
      // brow / cheek plates around the eye
      m.box(0.5, 0.08, 0.16, [0, 0.25, 0.46], shade(body, 0.8), S.enamel, {
        bevel: 0.03,
        rot: [0.35, 0, 0],
      });
      // vents on the flanks
      m.both(() => {
        for (let k = 0; k < 3; k++)
          m.box(0.04, 0.03, 0.2, [0.51, -0.06 + k * 0.07, -0.05], glowCol, S.glowSoft);
        m.box(0.06, 0.28, 0.28, [0.49, 0, -0.05], dark, S.darkSteel, { bevel: 0.02 });
      });
      // thruster underneath
      m.cyl(0.2, 0.22, [0, -0.52, 0], dark, S.darkSteel, { rb: 0.26, seg: 14 });
      m.torus(0.23, 0.03, [0, -0.62, 0], steel, S.steel, { rot: [PI / 2, 0, 0] });
      m.cyl(0.16, 0.02, [0, -0.635, 0], eye, S.glow, { seg: 14 });
      // antennas
      m.cyl(0.012, 0.5, [0.14, 0.6, -0.2], steel, S.steel, {
        rot: [-0.35, 0, -0.2],
        seg: 5,
        lod: 1,
      });
      m.sphere(0.028, [0.2, 0.83, -0.29], eye, S.glow, { low: true, lod: 1 });
      m.cyl(0.01, 0.34, [-0.12, 0.55, -0.24], steel, S.steel, {
        rot: [-0.5, 0, 0.2],
        seg: 5,
        lod: 1,
      });
      m.pop();
      // gimbal rings (they spin)
      m.bone = B.ringA!;
      m.push([0, 0.9, 0]);
      m.torus(0.8, 0.045, [0, 0, 0], c.brute.clubHead, S.brushed, { rot: [PI / 2, 0, 0], seg: 28 });
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * PI * 2;
        m.box(0.12, 0.1, 0.16, [Math.sin(a) * 0.8, 0, Math.cos(a) * 0.8], dark, S.darkSteel, {
          rot: [0, a, 0],
          bevel: 0.02,
        });
      }
      m.pop();
      m.bone = B.ringB!;
      m.push([0, 0.9, 0]);
      m.torus(0.69, 0.035, [0, 0, 0], c.brute.club, S.gunmetal, { rot: [0, 0, PI / 2], seg: 26 });
      m.both(() => m.cyl(0.07, 0.1, [0.69, 0, 0], steel, S.steel, { rot: [0, 0, PI / 2], seg: 8 }));
      m.pop();
      // gun pods on stub arms
      m.bone = B.pods!;
      m.push([0, 0.9, 0]);
      m.both(() => {
        m.box(0.3, 0.08, 0.1, [0.62, -0.25, 0.05], dark, S.darkSteel, { bevel: 0.02 });
        m.cyl(0.08, 0.3, [0.78, -0.25, 0.12], body, S.enamel, { rot: [PI / 2, 0, 0], seg: 10 });
        m.tubeZ(0.028, 0.22, [0.78, -0.25, 0.36], dark, S.gunmetal, { seg: 8 });
        m.cable(
          [
            [0.5, -0.1, -0.1],
            [0.66, -0.2, -0.12],
            [0.78, -0.25, -0.05],
          ],
          0.018,
          "#1c1c1c",
        );
      });
      m.pop();
    },
    animate(b, p) {
      b.ringA!.rotation.y = p.t * 1.6 + p.seed * 6;
      b.ringB!.rotation.x = p.t * 2.4 + p.seed * 3;
      b.body!.rotation.x = 0.3 * p.move + p.wind * 0.35;
      b.pods!.rotation.x = -0.15 * p.move + Math.sin(p.t * 2 + p.seed * 5) * 0.05;
      idle(b.body, p, 1.5);
    },
  });
}

// ---------------------------------------------------------------- RUNNER
function runner(c: C): RobotKind {
  const body = c.drifter.body;
  const eye = c.drifter.eye;
  const steel = "#8a8f96";
  const dark = "#25282c";
  return defineRobot({
    name: "runner",
    stride: 1.1,
    bones: [
      { name: "hip", at: [0, 0.95, 0] },
      { name: "torso", parent: "hip", at: [0, 1.0, 0] },
      { name: "head", parent: "torso", at: [0, 1.45, 0.35] },
      { name: "tail", parent: "hip", at: [0, 1.0, -0.3] },
      { name: "legL", parent: "hip", at: [0.2, 0.95, 0] },
      { name: "shinL", parent: "legL", at: [0.22, 0.52, -0.12] },
      { name: "legR", parent: "hip", at: [-0.2, 0.95, 0] },
      { name: "shinR", parent: "legR", at: [-0.22, 0.52, -0.12] },
    ],
    build(m, B) {
      // pelvis
      m.bone = B.hip!;
      m.box(0.42, 0.22, 0.4, [0, 0.98, -0.02], dark, S.darkSteel, { bevel: 0.04 });
      m.tubeX(0.07, 0.56, [0, 0.95, 0], steel, S.steel, { seg: 10 });
      // torso: a forward-leaning wedge of plating over a spine
      m.bone = B.torso!;
      m.push([0, 1.2, 0.08], [0.55, 0, 0]);
      m.box(0.46, 0.5, 0.36, [0, 0.05, 0], body, S.enamel, { bevel: 0.06 });
      m.box(0.34, 0.3, 0.1, [0, 0.1, 0.2], shade(body, 0.75), S.enamel, { bevel: 0.03 });
      m.box(0.2, 0.36, 0.14, [0, 0.02, -0.22], dark, S.darkSteel, { bevel: 0.03 });
      m.both(() => {
        for (let k = 0; k < 3; k++)
          m.box(0.02, 0.04, 0.18, [0.235, -0.05 + k * 0.08, 0], eye, S.glowSoft);
      });
      m.bolts([-0.15, 0.3, 0.1], [0.15, 0.3, 0.1], 4, 0.016, steel);
      m.pop();
      // short arms folded back
      m.both(() => {
        m.box(0.08, 0.3, 0.08, [0.28, 1.28, 0.22], dark, S.darkSteel, {
          rot: [0.9, 0, -0.2],
          bevel: 0.02,
        });
        m.cone(0.05, 0.14, [0.3, 1.2, 0.4], steel, S.steel, { rot: [PI / 2 + 0.4, 0, 0], seg: 6 });
      });
      // head: a sensor snout with one bright eye
      m.bone = B.head!;
      m.push([0, 1.47, 0.4]);
      m.box(0.26, 0.2, 0.36, [0, 0, 0.05], body, S.enamel, { bevel: 0.05 });
      m.box(0.2, 0.08, 0.2, [0, -0.1, 0.15], dark, S.darkSteel, { bevel: 0.02 });
      m.tubeZ(0.07, 0.08, [0, 0.02, 0.24], dark, S.gunmetal, { seg: 12 });
      m.sphere(0.055, [0, 0.02, 0.28], eye, S.glow, { low: true });
      m.box(0.02, 0.2, 0.1, [0, 0.15, -0.05], eye, S.glowSoft, { rot: [-0.4, 0, 0] });
      m.pop();
      // tail stabiliser
      m.bone = B.tail!;
      m.box(0.08, 0.08, 0.5, [0, 1.05, -0.52], dark, S.darkSteel, {
        rot: [-0.25, 0, 0],
        bevel: 0.02,
      });
      m.box(0.3, 0.03, 0.14, [0, 1.12, -0.76], body, S.enamel, { rot: [-0.25, 0, 0], bevel: 0.01 });
      // digitigrade legs: thigh forward, shin back, a spring piston, a two-toed foot
      for (const [leg, shin, sx] of [
        ["legL", "shinL", 1],
        ["legR", "shinR", -1],
      ] as const) {
        m.bone = B[leg]!;
        m.push([sx * 0.22, 0.95, 0]);
        m.box(0.13, 0.46, 0.16, [0, -0.2, 0.02], body, S.enamel, {
          rot: [-0.3, 0, 0],
          bevel: 0.03,
        });
        m.cyl(0.08, 0.1, [0, 0, 0], steel, S.steel, { rot: [0, 0, PI / 2], seg: 10 });
        m.pop();
        m.bone = B[shin]!;
        m.push([sx * 0.22, 0.52, -0.12]);
        m.cyl(0.06, 0.08, [0, 0, 0], steel, S.steel, { rot: [0, 0, PI / 2], seg: 8 });
        m.box(0.08, 0.46, 0.08, [0, -0.2, -0.08], dark, S.darkSteel, {
          rot: [0.35, 0, 0],
          bevel: 0.02,
        });
        m.cyl(0.02, 0.36, [0, -0.2, 0.0], steel, S.chrome, { rot: [0.25, 0, 0], seg: 6, lod: 1 });
        m.box(0.1, 0.05, 0.3, [0, -0.46, 0.02], dark, S.darkSteel, { bevel: 0.02 });
        m.box(0.035, 0.04, 0.12, [0.03, -0.47, 0.19], steel, S.steel, { lod: 1 });
        m.box(0.035, 0.04, 0.12, [-0.03, -0.47, 0.19], steel, S.steel, { lod: 1 });
        m.pop();
      }
    },
    animate(b, p) {
      walkLegs(b, p, 0.85);
      b.torso!.rotation.x = 0.1 * p.move + p.wind * 0.2;
      b.head!.rotation.x = -0.2 * p.move + Math.sin(p.t * 3 + p.seed * 7) * 0.08;
      b.head!.rotation.y = Math.sin(p.t * 1.3 + p.seed * 4) * 0.25 * (1 - p.move);
      b.tail!.rotation.x = Math.sin(p.phase * 2) * 0.12 * p.move;
      b.tail!.rotation.y = Math.sin(p.phase) * 0.15 * p.move;
    },
  });
}

// ---------------------------------------------------------------- BRUTE
function brute(c: C): RobotKind {
  const body = c.brute.body;
  const head = c.brute.head;
  const eye = c.brute.eye;
  const club = c.brute.club;
  const clubHead = c.brute.clubHead;
  const steel = "#8a8e94";
  const dark = "#23252a";
  return defineRobot({
    name: "brute",
    stride: 1.9,
    wear: 0.85,
    bones: [
      { name: "hip", at: [0, 0.95, 0] },
      { name: "torso", parent: "hip", at: [0, 1.2, 0] },
      { name: "head", parent: "torso", at: [0, 2.2, 0.1] },
      { name: "armL", parent: "torso", at: [-0.85, 1.95, 0] },
      { name: "armR", parent: "torso", at: [0.85, 1.95, 0] },
      { name: "legL", parent: "hip", at: [-0.4, 0.95, 0] },
      { name: "shinL", parent: "legL", at: [-0.42, 0.5, 0.05] },
      { name: "legR", parent: "hip", at: [0.4, 0.95, 0] },
      { name: "shinR", parent: "legR", at: [0.42, 0.5, 0.05] },
    ],
    build(m, B) {
      m.bone = B.hip!;
      m.box(0.86, 0.36, 0.6, [0, 1.0, 0], head, S.darkSteel, { bevel: 0.06 });
      m.box(0.5, 0.2, 0.1, [0, 1.0, 0.32], steel, S.steel, { bevel: 0.02 });
      m.tubeX(0.1, 1.02, [0, 0.95, 0], dark, S.gunmetal, { seg: 12 });
      // torso: a barrel chest of layered plate on a piston-braced gut
      m.bone = B.torso!;
      m.box(0.84, 0.36, 0.64, [0, 1.3, 0], dark, S.darkSteel, { bevel: 0.05 });
      m.both(() => {
        m.cyl(0.035, 0.42, [0.3, 1.32, 0.3], steel, S.chrome, { seg: 8 });
        m.cyl(0.055, 0.14, [0.3, 1.13, 0.3], dark, S.gunmetal, { seg: 8 });
      });
      m.box(1.36, 0.92, 0.92, [0, 1.84, -0.02], body, S.paint, { bevel: 0.1 });
      m.box(1.06, 0.58, 0.14, [0, 1.9, 0.47], head, S.paint, { bevel: 0.05, rot: [-0.08, 0, 0] });
      m.box(0.86, 0.3, 0.12, [0, 1.5, 0.45], head, S.paint, { bevel: 0.04, rot: [0.12, 0, 0] });
      m.bolts([-0.45, 2.13, 0.54], [0.45, 2.13, 0.54], 6, 0.022, steel);
      m.bolts([-0.45, 1.66, 0.54], [0.45, 1.66, 0.54], 6, 0.022, steel);
      // reactor core glowing through a grille in the chest
      m.tubeZ(0.16, 0.08, [0, 1.9, 0.54], dark, S.darkSteel, { seg: 16 });
      m.cyl(0.12, 0.02, [0, 1.9, 0.585], eye, S.glow, { rot: [PI / 2, 0, 0], seg: 16 });
      for (let k = -1; k <= 1; k++)
        m.box(0.26, 0.018, 0.02, [0, 1.9 + k * 0.06, 0.6], dark, S.darkSteel);
      // back: exhaust stacks and cable runs
      m.both(() => {
        m.cyl(0.1, 0.62, [0.3, 2.2, -0.52], club, S.darkSteel, { rb: 0.13, seg: 10 });
        m.cyl(0.08, 0.04, [0.3, 2.52, -0.52], eye, S.glowSoft, { seg: 10 });
        m.cable(
          [
            [0.2, 1.5, -0.47],
            [0.34, 1.8, -0.56],
            [0.3, 1.95, -0.5],
          ],
          0.028,
          "#1a1a1a",
        );
      });
      m.box(0.6, 0.5, 0.2, [0, 1.8, -0.52], head, S.darkSteel, { bevel: 0.04 });
      // head: sunk low between the shoulders, a slit visor and two horns
      m.bone = B.head!;
      m.box(0.6, 0.46, 0.56, [0, 2.3, 0.1], head, S.paint, { bevel: 0.08 });
      m.box(0.66, 0.14, 0.4, [0, 2.5, 0.05], shade(head, 0.8), S.paint, { bevel: 0.04 });
      m.box(0.46, 0.08, 0.06, [0, 2.3, 0.39], eye, S.glow);
      m.box(0.52, 0.16, 0.08, [0, 2.3, 0.36], dark, S.darkSteel, { bevel: 0.02 });
      m.box(0.3, 0.14, 0.12, [0, 2.12, 0.34], steel, S.steel, { bevel: 0.03 });
      for (let k = -2; k <= 2; k++)
        m.box(0.025, 0.08, 0.02, [k * 0.05, 2.12, 0.405], dark, S.darkSteel, { lod: 1 });
      m.both(() =>
        m.cone(0.1, 0.42, [0.34, 2.62, 0], clubHead, S.brushed, { rot: [0, 0, -0.6], seg: 8 }),
      );
      // arms: huge pauldrons, piston elbows, slab forearms
      for (const [arm, sx] of [
        ["armL", -1],
        ["armR", 1],
      ] as const) {
        m.bone = B[arm]!;
        m.push([sx * 0.85, 1.95, 0]);
        m.box(0.56, 0.46, 0.9, [sx * 0.05, 0.08, 0], head, S.paint, {
          bevel: 0.08,
          rot: [0, 0, sx * -0.25],
        });
        m.box(0.5, 0.1, 0.8, [sx * 0.08, 0.3, 0], shade(head, 0.8), S.paint, {
          bevel: 0.03,
          rot: [0, 0, sx * -0.25],
        });
        m.bolts([sx * 0.2, 0.25, -0.3], [sx * 0.2, 0.25, 0.3], 4, 0.02, steel);
        m.sphere(0.2, [0, -0.1, 0], dark, S.gunmetal);
        m.cyl(0.13, 0.5, [sx * 0.04, -0.42, 0], dark, S.darkSteel, { seg: 10 });
        m.cyl(0.03, 0.42, [sx * 0.04, -0.4, 0.16], steel, S.chrome, { seg: 6, lod: 1 });
        m.sphere(0.15, [sx * 0.05, -0.72, 0], steel, S.steel);
        m.box(0.4, 0.6, 0.44, [sx * 0.06, -1.02, 0.02], body, S.paint, { bevel: 0.07 });
        m.box(0.42, 0.12, 0.46, [sx * 0.06, -0.86, 0.02], dark, S.darkSteel, { bevel: 0.03 });
        m.box(0.34, 0.26, 0.36, [sx * 0.06, -1.42, 0.06], dark, S.darkSteel, { bevel: 0.05 });
        m.pop();
      }
      // the power maul in the right fist: a long haft pointing forward, a glowing hammer head
      m.bone = B.armR!;
      m.push([0.91, 0.53, 0.06]);
      m.tubeZ(0.05, 1.3, [0, 0, 0.35], club, S.gunmetal, { seg: 10 });
      m.tubeZ(0.07, 0.3, [0, 0, -0.18], "#3a2a1a", S.leather, { seg: 10 });
      m.box(0.46, 0.46, 0.52, [0, 0, 1.1], clubHead, S.brushed, { bevel: 0.06 });
      m.box(0.5, 0.1, 0.56, [0, 0, 1.1], eye, S.glow);
      m.both(() =>
        m.cone(0.13, 0.26, [0.34, 0, 1.1], clubHead, S.brushed, { rot: [0, 0, -PI / 2], seg: 6 }),
      );
      m.bolts([-0.18, 0.24, 0.9], [0.18, 0.24, 0.9], 3, 0.02, steel);
      m.pop();
      // legs: thick armoured pistons on splayed feet
      for (const [leg, shin, sx] of [
        ["legL", "shinL", -1],
        ["legR", "shinR", 1],
      ] as const) {
        m.bone = B[leg]!;
        m.push([sx * 0.42, 0.95, 0]);
        m.box(0.36, 0.5, 0.42, [0, -0.2, 0], head, S.paint, { bevel: 0.06 });
        m.cyl(0.15, 0.2, [0, 0, 0], dark, S.gunmetal, { rot: [0, 0, PI / 2], seg: 12 });
        m.pop();
        m.bone = B[shin]!;
        m.push([sx * 0.42, 0.5, 0.05]);
        m.sphere(0.13, [0, 0, 0], dark, S.gunmetal, { low: true });
        m.box(0.32, 0.36, 0.36, [0, -0.2, 0], dark, S.darkSteel, { bevel: 0.05 });
        m.cyl(0.025, 0.3, [sx * 0.12, -0.18, 0.18], steel, S.chrome, { seg: 6, lod: 1 });
        m.box(0.42, 0.14, 0.62, [0, -0.43, 0.08], head, S.darkSteel, { bevel: 0.04 });
        m.pop();
      }
    },
    animate(b, p) {
      walkLegs(b, p, 0.45);
      idle(b.torso, p, 1.2);
      const s = Math.sin(p.phase);
      b.armL!.rotation.x = -s * 0.35 * p.move - 0.1;
      b.torso!.rotation.y = s * 0.08 * p.move;
      // maul: raised overhead through the wind-up, slammed down forward at the end
      const w = p.wind;
      const armX =
        w <= 0
          ? -0.25 - s * 0.2 * p.move
          : w < 0.6
            ? -0.25 - (w / 0.6) * 2.6
            : -2.85 + ((w - 0.6) / 0.4) * 1.9;
      b.armR!.rotation.x = armX;
      b.armR!.rotation.z = w > 0 ? -0.2 : 0;
      b.torso!.rotation.x = w > 0.6 ? 0.25 : w > 0 ? -0.12 * (w / 0.6) : 0.04;
      b.head!.rotation.x = -b.torso!.rotation.x * 0.5;
    },
  });
}

// ---------------------------------------------------------------- SHOOTER
function shooter(c: C): RobotKind {
  const body = c.shooter.body;
  const barrel = c.shooter.barrel;
  const eye = c.shooter.eye;
  const steel = "#8a8f96";
  const dark = "#26292e";
  const legs = [0, 1, 2].map((i) => (i / 3) * PI * 2 + PI / 3); // two forward-side legs, one behind
  return defineRobot({
    name: "shooter",
    stride: 1.3,
    bones: [
      { name: "hip", at: [0, 1.05, 0] },
      { name: "turret", parent: "hip", at: [0, 1.3, 0] },
      { name: "gun", parent: "turret", at: [0.36, 1.5, 0.05] },
      { name: "a0", parent: "hip", at: [Math.sin(legs[0]!) * 0.3, 1.0, Math.cos(legs[0]!) * 0.3] },
      { name: "a1", parent: "hip", at: [Math.sin(legs[1]!) * 0.3, 1.0, Math.cos(legs[1]!) * 0.3] },
      { name: "a2", parent: "hip", at: [Math.sin(legs[2]!) * 0.3, 1.0, Math.cos(legs[2]!) * 0.3] },
    ],
    build(m, B) {
      const legBones = [B.a0, B.a1, B.a2];
      // hip hub: the tripod's machined collar
      m.bone = B.hip;
      m.cyl(0.32, 0.26, [0, 1.02, 0], dark, S.darkSteel, { seg: 12 });
      m.torus(0.33, 0.035, [0, 1.12, 0], steel, S.brushed, { rot: [PI / 2, 0, 0], seg: 20 });
      m.cyl(0.2, 0.14, [0, 0.85, 0], dark, S.gunmetal, { rb: 0.12, seg: 10 });
      // legs: an angled thigh strut, a knee, a long shin down to a pad foot
      legs.forEach((a, i) => {
        m.bone = legBones[i]!;
        m.push([Math.sin(a) * 0.3, 1.0, Math.cos(a) * 0.3], [0, a, 0]);
        m.sphere(0.09, [0, 0, 0], steel, S.steel, { low: true });
        m.box(0.12, 0.14, 0.56, [0, 0.06, 0.26], body, S.enamel, {
          rot: [-0.5, 0, 0],
          bevel: 0.03,
        });
        m.cyl(0.07, 0.12, [0, 0.2, 0.52], dark, S.gunmetal, { rot: [0, 0, PI / 2], seg: 10 });
        m.box(0.08, 1.1, 0.09, [0, -0.3, 0.66], dark, S.darkSteel, {
          rot: [0.25, 0, 0],
          bevel: 0.02,
        });
        m.cyl(0.022, 0.8, [0.05, -0.25, 0.6], steel, S.chrome, {
          rot: [0.25, 0, 0],
          seg: 6,
          lod: 1,
        });
        m.cyl(0.12, 0.06, [0, -0.96, 0.8], dark, S.rubber, { seg: 10 });
        m.cyl(0.06, 0.08, [0, -0.9, 0.8], steel, S.steel, { seg: 8 });
        m.pop();
      });
      // turret: a white armoured pod with a sensor head and a visor band
      m.bone = B.turret;
      m.cyl(0.45, 0.72, [0, 1.52, 0], body, S.enamel, { rb: 0.4, seg: 14 });
      m.cyl(0.47, 0.06, [0, 1.25, 0], dark, S.darkSteel, { seg: 14 });
      m.cyl(0.47, 0.05, [0, 1.62, 0], dark, S.darkSteel, { seg: 14 });
      m.box(0.34, 0.3, 0.1, [0, 1.45, 0.42], shade(body, 0.85), S.enamel, { bevel: 0.03 });
      m.bolts([-0.12, 1.57, 0.47], [0.12, 1.57, 0.47], 3, 0.018, steel);
      m.box(0.5, 0.3, 0.24, [0, 1.5, -0.42], dark, S.darkSteel, { bevel: 0.04 });
      for (let k = 0; k < 3; k++)
        m.box(0.4, 0.03, 0.02, [0, 1.42 + k * 0.08, -0.55], eye, S.glowSoft, { lod: 1 });
      m.dome(0.34, [0, 1.88, 0], shade(body, 0.92), S.enamel, { s: [1, 0.8, 1] });
      m.box(0.44, 0.1, 0.2, [0, 1.98, 0.2], dark, S.darkSteel, { bevel: 0.03 });
      m.box(0.38, 0.05, 0.05, [0, 1.98, 0.3], eye, S.glow);
      m.tubeZ(0.06, 0.1, [0.12, 2.06, 0.26], dark, S.gunmetal, { seg: 10 });
      m.sphere(0.04, [0.12, 2.06, 0.31], eye, S.glow, { low: true });
      m.cyl(0.012, 0.42, [-0.18, 2.25, -0.1], steel, S.steel, { seg: 5, lod: 1 });
      m.sphere(0.025, [-0.18, 2.47, -0.1], eye, S.glow, { low: true, lod: 1 });
      // left: a counterweight ammo drum feeding the gun across the back
      m.cyl(0.18, 0.3, [-0.52, 1.45, -0.05], barrel, S.gunmetal, { rot: [0, 0, PI / 2], seg: 14 });
      m.cable(
        [
          [-0.4, 1.5, -0.2],
          [0, 1.62, -0.5],
          [0.36, 1.55, -0.18],
        ],
        0.035,
        "#6a5a3a",
        S.brass,
      );
      // the rifle on the right shoulder
      m.bone = B.gun;
      m.push([0.36, 1.5, 0.05]);
      m.box(0.16, 0.22, 0.6, [0, 0, 0.05], barrel, S.gunmetal, { bevel: 0.03 });
      m.box(0.12, 0.08, 0.3, [0, 0.14, 0.02], dark, S.darkSteel, { bevel: 0.015 });
      m.tubeZ(0.05, 0.75, [0, 0.02, 0.7], barrel, S.blued, { seg: 12 });
      m.tubeZ(0.075, 0.3, [0, 0.02, 0.45], dark, S.darkSteel, { seg: 10 });
      m.tubeZ(0.07, 0.14, [0, 0.02, 1.1], dark, S.darkSteel, { seg: 8 });
      m.torus(0.06, 0.018, [0, 0.02, 1.18], eye, S.glow, { seg: 14 });
      m.box(0.05, 0.05, 0.2, [0, 0.2, 0.25], eye, S.glowSoft, { lod: 1 });
      m.pop();
    },
    animate(b, p) {
      const L = [b.a0, b.a1, b.a2];
      legs.forEach((a, i) => {
        const ph = p.phase + i * ((PI * 2) / 3);
        const lift = Math.max(0, Math.sin(ph)) * 0.32 * p.move;
        const sw = Math.cos(ph) * 0.18 * p.move;
        // lift about the leg's own tangent axis, swing about the vertical
        L[i]!.quaternion.setFromAxisAngle(_ax.set(Math.cos(a), 0, -Math.sin(a)), -lift);
        L[i]!.rotateY(sw);
      });
      b.hip.position.y += Math.sin(p.phase * 3) * 0.02 * p.move;
      b.turret.rotation.y = Math.sin(p.t * 0.7 + p.seed * 5) * 0.2 * (1 - p.wind);
      b.turret.rotation.x = -p.wind * 0.12;
      // gun: aims up a touch while charging, kicks back when it fires (aux = cooldown)
      const kick = p.aux > 1.35 ? (p.aux - 1.35) * 1.6 : 0;
      b.gun.position.z -= Math.min(0.2, kick);
      b.gun.rotation.x = -p.wind * 0.1 - Math.min(0.2, kick) * 0.8;
    },
  });
}
const _ax = new THREE.Vector3();

// ---------------------------------------------------------------- SPECTER
function specter(c: C, accent: string): RobotKind {
  const eye = c.drifter.eye;
  const hi = c.shooter.eye;
  const metal = "#3a3d44";
  const dark = "#1c1d22";
  return defineRobot({
    name: "specter",
    wear: 0.6,
    bones: [
      { name: "body", at: [0, 1.5, 0] },
      { name: "head", parent: "body", at: [0, 2.05, 0.05] },
      { name: "armL", parent: "body", at: [-0.34, 1.85, 0.05] },
      { name: "armR", parent: "body", at: [0.34, 1.85, 0.05] },
      { name: "tail", parent: "body", at: [0, 1.3, 0] },
    ],
    build(m, B) {
      // a hooded skeletal frame: cowl plates over a ribbed spine
      m.bone = B.body;
      m.box(0.46, 0.34, 0.28, [0, 1.78, 0], metal, S.darkSteel, { bevel: 0.05 });
      for (let k = 0; k < 4; k++) {
        const y = 1.7 - k * 0.12;
        m.box(0.44 - k * 0.07, 0.04, 0.22 - k * 0.03, [0, y, 0.02], dark, S.gunmetal, {
          bevel: 0.015,
        });
      }
      m.cyl(0.05, 0.6, [0, 1.5, -0.04], dark, S.gunmetal, { seg: 8 });
      m.both(() =>
        m.box(0.3, 0.1, 0.34, [0.28, 1.95, 0], metal, S.darkSteel, {
          rot: [0, 0, -0.5],
          bevel: 0.03,
        }),
      );
      m.sphere(0.09, [0, 1.62, 0.13], eye, S.glow, { low: true });
      // hood
      m.push([0, 2.1, 0]);
      m.box(0.4, 0.34, 0.42, [0, 0.05, -0.05], dark, S.darkSteel, { bevel: 0.08 });
      m.box(0.44, 0.08, 0.46, [0, 0.21, -0.05], metal, S.darkSteel, {
        rot: [0.15, 0, 0],
        bevel: 0.03,
      });
      m.pop();
      // head: a narrow skull-like sensor deep in the hood
      m.bone = B.head;
      m.box(0.24, 0.2, 0.22, [0, 2.07, 0.06], metal, S.gunmetal, { bevel: 0.05 });
      m.both(() => m.sphere(0.035, [0.06, 2.09, 0.17], hi, S.glow, { low: true }));
      m.box(0.14, 0.03, 0.04, [0, 2.0, 0.17], eye, S.glowSoft);
      // arms: long jointed limbs ending in blades
      for (const [arm, sx] of [
        ["armL", -1],
        ["armR", 1],
      ] as const) {
        m.bone = B[arm];
        m.push([sx * 0.34, 1.85, 0.05]);
        m.sphere(0.07, [0, 0, 0], metal, S.gunmetal, { low: true });
        m.box(0.06, 0.5, 0.06, [sx * 0.05, -0.25, 0.04], metal, S.darkSteel, {
          rot: [0.2, 0, sx * 0.12],
          bevel: 0.015,
        });
        m.sphere(0.05, [sx * 0.08, -0.5, 0.1], dark, S.gunmetal, { low: true });
        m.box(0.05, 0.45, 0.05, [sx * 0.08, -0.72, 0.2], metal, S.darkSteel, {
          rot: [0.5, 0, 0],
          bevel: 0.015,
        });
        m.box(0.02, 0.5, 0.1, [sx * 0.08, -1.0, 0.4], hi, S.glowSoft, { rot: [0.9, 0, 0] });
        m.box(0.03, 0.46, 0.08, [sx * 0.08, -0.98, 0.37], "#c8ccd2", S.chrome, {
          rot: [0.9, 0, 0],
        });
        m.pop();
      }
      // tail: vertebrae trailing down into the emitter
      m.bone = B.tail;
      for (let k = 0; k < 5; k++)
        m.box(
          0.12 - k * 0.015,
          0.1,
          0.1 - k * 0.01,
          [0, 1.22 - k * 0.14, -0.04],
          k % 2 ? dark : metal,
          S.darkSteel,
          { bevel: 0.02 },
        );
      m.cyl(0.1, 0.08, [0, 0.52, -0.04], dark, S.darkSteel, { rb: 0.14, seg: 10 });
      m.cyl(0.09, 0.02, [0, 0.47, -0.04], accent, S.glow, { seg: 10 });
    },
    animate(b, p) {
      idle(b.body, p, 2.5);
      b.tail.rotation.x = Math.sin(p.t * 2.1 + p.seed * 4) * 0.2 + 0.15 * p.move;
      b.tail.rotation.z = Math.sin(p.t * 1.5 + p.seed * 7) * 0.15;
      b.head.rotation.y = Math.sin(p.t * 0.9 + p.seed * 3) * 0.3;
      const f = Math.sin(p.t * 2.6 + p.seed * 5) * 0.12;
      // slash (aux = cooldown, 1.4 right after a hit): both blades rake down and in
      const sl = p.aux > 1.0 ? Math.sin(((1.4 - p.aux) / 0.4) * PI) : 0;
      b.armL.rotation.x = -0.35 + f - sl * 1.4;
      b.armR.rotation.x = -0.35 - f - sl * 1.4;
      b.armL.rotation.z = -0.25 + sl * 0.5;
      b.armR.rotation.z = 0.25 - sl * 0.5;
      b.body.rotation.x += 0.25 * p.move;
    },
  });
}

// ---------------------------------------------------------------- BOMBER
function bomber(c: C, glowCol: string): RobotKind {
  const hull = c.brute.body;
  const band = c.brute.head;
  const tube = c.shooter.barrel;
  const steel = "#8a8e94";
  const dark = "#24262b";
  const legAt = [
    [0.5, 0.42],
    [-0.5, 0.42],
    [0.5, -0.42],
    [-0.5, -0.42],
  ] as const;
  return defineRobot({
    name: "bomber",
    stride: 1.0,
    wear: 0.85,
    bones: [
      { name: "hip", at: [0, 0.95, 0] },
      { name: "mortar", parent: "hip", at: [0, 1.5, -0.05] },
      { name: "l0", parent: "hip", at: [0.45, 0.8, 0.38] },
      { name: "l1", parent: "hip", at: [-0.45, 0.8, 0.38] },
      { name: "l2", parent: "hip", at: [0.45, 0.8, -0.38] },
      { name: "l3", parent: "hip", at: [-0.45, 0.8, -0.38] },
    ],
    build(m, B) {
      const LB = [B.l0, B.l1, B.l2, B.l3];
      m.bone = B.hip;
      // hull: a squat riveted pressure vessel with armour bands
      m.sphere(0.72, [0, 1.0, 0], hull, S.paint, { s: [1, 0.78, 1] });
      m.torus(0.73, 0.06, [0, 1.02, 0], band, S.darkSteel, { rot: [PI / 2, 0, 0], seg: 22 });
      m.torus(0.6, 0.045, [0, 1.3, 0], band, S.darkSteel, { rot: [PI / 2, 0, 0], seg: 20 });
      m.bolts([-0.5, 1.08, 0.52], [0.5, 1.08, 0.52], 6, 0.02, steel);
      m.cyl(0.5, 0.18, [0, 0.62, 0], dark, S.darkSteel, { rb: 0.4, seg: 14 });
      // face: a slot sensor and a glowing core port
      m.box(0.46, 0.14, 0.14, [0, 1.12, 0.64], dark, S.darkSteel, { bevel: 0.03 });
      m.box(0.34, 0.05, 0.03, [0, 1.12, 0.71], glowCol, S.glow);
      m.tubeZ(0.11, 0.1, [0, 0.86, 0.66], dark, S.gunmetal, { seg: 12 });
      m.cyl(0.08, 0.02, [0, 0.86, 0.72], glowCol, S.glow, { rot: [PI / 2, 0, 0], seg: 12 });
      // back: a rack of spare shells and an exhaust
      for (let k = 0; k < 3; k++) {
        m.cyl(0.07, 0.32, [-0.2 + k * 0.2, 1.05, -0.7], "#6a5a3a", S.brass, { seg: 8 });
        m.cone(0.07, 0.1, [-0.2 + k * 0.2, 1.26, -0.7], glowCol, S.glowSoft, { seg: 8, lod: 1 });
      }
      m.box(0.72, 0.1, 0.16, [0, 0.9, -0.7], dark, S.darkSteel, { bevel: 0.02 });
      m.cyl(0.06, 0.3, [0.42, 1.45, -0.4], dark, S.darkSteel, { seg: 8 });
      // shoulder armour over the leg sockets
      m.both(() =>
        m.box(0.26, 0.36, 0.4, [0.64, 0.95, 0], band, S.paint, { rot: [0, 0, -0.5], bevel: 0.05 }),
      );
      // stubby crab legs
      legAt.forEach(([x, z], i) => {
        m.bone = LB[i]!;
        const sx = Math.sign(x);
        m.push([x * 0.9, 0.8, z * 0.9]);
        m.sphere(0.1, [0, 0, 0], steel, S.steel, { low: true });
        m.box(0.36, 0.12, 0.14, [sx * 0.18, 0.05, 0], band, S.paint, {
          rot: [0, 0, sx * 0.35],
          bevel: 0.03,
        });
        m.cyl(0.07, 0.62, [sx * 0.36, -0.35, 0], dark, S.darkSteel, {
          rot: [0, 0, sx * -0.18],
          seg: 8,
        });
        m.cyl(0.022, 0.5, [sx * 0.3, -0.3, 0.09], steel, S.chrome, {
          rot: [0, 0, sx * -0.15],
          seg: 6,
          lod: 1,
        });
        m.cyl(0.14, 0.08, [sx * 0.42, -0.72, 0], dark, S.rubber, { rb: 0.17, seg: 10 });
        m.pop();
      });
      // the mortar: a fat tube raked back, glowing muzzle ring, recoil springs
      m.bone = B.mortar;
      m.push([0, 1.5, -0.05], [-0.6, 0, 0]);
      m.cyl(0.26, 0.24, [0, 0, 0], dark, S.darkSteel, { seg: 14 });
      m.cyl(0.2, 1.0, [0, 0.5, 0], tube, S.gunmetal, { rb: 0.24, seg: 14 });
      m.cyl(0.26, 0.1, [0, 0.35, 0], dark, S.darkSteel, { seg: 14 });
      m.cyl(0.24, 0.14, [0, 0.98, 0], dark, S.darkSteel, { seg: 14 });
      m.torus(0.21, 0.035, [0, 1.06, 0], glowCol, S.glow, { rot: [PI / 2, 0, 0], seg: 16 });
      m.cyl(0.17, 0.01, [0, 1.04, 0], "#0a0a0a", S.rubber, { seg: 14 });
      m.both(() => m.cyl(0.03, 0.5, [0.26, 0.3, 0], steel, S.chrome, { seg: 6, lod: 1 }));
      m.pop();
    },
    animate(b, p) {
      const L = [b.l0, b.l1, b.l2, b.l3];
      // diagonal pairs step together
      L.forEach((l, i) => {
        const ph = p.phase + (i === 0 || i === 3 ? 0 : PI);
        const sx = i % 2 === 0 ? 1 : -1;
        l.rotation.z = sx * Math.max(0, Math.sin(ph)) * 0.4 * p.move;
        l.rotation.x = Math.cos(ph) * 0.35 * p.move;
      });
      b.hip.position.y += Math.abs(Math.sin(p.phase)) * 0.04 * p.move;
      b.hip.rotation.z = Math.sin(p.phase) * 0.04 * p.move;
      // mortar: raised through the wind-up, punched down when it fires (aux = shot timer)
      const kick = p.aux > 2.85 ? Math.min(1, (p.aux - 2.85) * 4) : 0;
      b.mortar.rotation.x = -p.wind * 0.25 + kick * 0.3;
      b.mortar.position.y -= kick * 0.12;
      b.hip.position.y -= kick * 0.06 + p.wind * 0.05;
    },
  });
}

// ---------------------------------------------------------------- VANGUARD
function vanguard(c: C, glowCol: string): RobotKind {
  const body = c.shooter.body;
  const armour = c.brute.head;
  const shieldCol = c.brute.clubHead;
  const eye = c.brute.eye;
  const steel = "#8a8e94";
  const dark = "#23252a";
  return defineRobot({
    name: "vanguard",
    stride: 1.7,
    wear: 0.8,
    bones: [
      { name: "hip", at: [0, 1.0, 0] },
      { name: "torso", parent: "hip", at: [0, 1.25, 0] },
      { name: "head", parent: "torso", at: [0, 2.35, 0] },
      { name: "armL", parent: "torso", at: [-0.7, 2.0, 0] },
      { name: "armR", parent: "torso", at: [0.7, 2.0, 0] },
      { name: "shield", parent: "armL", at: [0, 1.3, 0.72] },
      { name: "legL", parent: "hip", at: [-0.36, 1.0, 0] },
      { name: "shinL", parent: "legL", at: [-0.38, 0.52, 0.04] },
      { name: "legR", parent: "hip", at: [0.36, 1.0, 0] },
      { name: "shinR", parent: "legR", at: [0.38, 0.52, 0.04] },
    ],
    build(m, B) {
      m.bone = B.hip;
      m.box(0.78, 0.34, 0.56, [0, 1.04, 0], dark, S.darkSteel, { bevel: 0.05 });
      m.tubeX(0.1, 0.9, [0, 1.0, 0], steel, S.steel, { seg: 12 });
      // torso: a tall armoured cab
      m.bone = B.torso;
      m.box(0.66, 0.3, 0.5, [0, 1.32, 0], dark, S.darkSteel, { bevel: 0.04 });
      m.box(1.1, 0.95, 0.78, [0, 1.9, 0], body, S.paint, { bevel: 0.09 });
      m.box(0.9, 0.7, 0.12, [0, 1.95, 0.42], armour, S.paint, { bevel: 0.04 });
      m.box(0.9, 0.16, 0.7, [0, 2.42, 0], armour, S.paint, { bevel: 0.04 });
      m.bolts([-0.38, 2.22, 0.49], [0.38, 2.22, 0.49], 5, 0.02, steel);
      m.box(0.7, 0.55, 0.3, [0, 1.95, -0.48], armour, S.darkSteel, { bevel: 0.05 });
      m.both(() => {
        m.cyl(0.07, 0.4, [0.22, 2.35, -0.6], dark, S.darkSteel, { seg: 8 });
        m.cyl(0.055, 0.03, [0.22, 2.56, -0.6], glowCol, S.glowSoft, { seg: 8, lod: 1 });
      });
      // head: a squat helm with a slit and a crest
      m.bone = B.head;
      m.box(0.62, 0.5, 0.62, [0, 2.62, 0], armour, S.paint, { bevel: 0.08 });
      m.box(0.46, 0.08, 0.06, [0, 2.64, 0.31], eye, S.glow);
      m.box(0.5, 0.16, 0.08, [0, 2.64, 0.29], dark, S.darkSteel, { bevel: 0.02 });
      m.box(0.12, 0.3, 0.5, [0, 2.95, -0.02], shieldCol, S.brushed, { bevel: 0.03 });
      // arms: pauldrons, pistoned elbows; the left carries the shield, the right a shock mace
      for (const [arm, sx] of [
        ["armL", -1],
        ["armR", 1],
      ] as const) {
        m.bone = B[arm];
        m.push([sx * 0.7, 2.0, 0]);
        m.box(0.44, 0.4, 0.8, [sx * 0.08, 0.08, 0], armour, S.paint, {
          rot: [0, 0, sx * -0.3],
          bevel: 0.07,
        });
        m.sphere(0.16, [sx * 0.06, -0.12, 0], dark, S.gunmetal, { low: true });
        m.cyl(0.11, 0.5, [sx * 0.08, -0.42, 0], dark, S.darkSteel, { seg: 10 });
        m.box(0.3, 0.46, 0.34, [sx * 0.08, -0.84, 0.08], body, S.paint, { bevel: 0.06 });
        m.pop();
      }
      m.bone = B.armR;
      m.push([0.78, 0.95, 0.18]);
      m.tubeZ(0.045, 0.8, [0, 0, 0.3], dark, S.gunmetal, { seg: 10 });
      m.cyl(0.13, 0.28, [0, 0, 0.78], shieldCol, S.brushed, { rot: [PI / 2, 0, 0], seg: 12 });
      for (let k = 0; k < 3; k++)
        m.torus(0.135, 0.02, [0, 0, 0.68 + k * 0.1], glowCol, S.glow, { seg: 14 });
      m.pop();
      // the shield: a riveted slab with a viewport and glowing chevrons
      m.bone = B.shield;
      m.push([0, 1.3, 0.72]);
      m.box(1.6, 2.0, 0.14, [0, 0, 0], shade(shieldCol, 0.62), S.steel, { bevel: 0.05 });
      m.box(1.7, 0.1, 0.18, [0, 1.0, 0], dark, S.darkSteel, { bevel: 0.03 });
      m.box(1.7, 0.1, 0.18, [0, -1.0, 0], dark, S.darkSteel, { bevel: 0.03 });
      m.both(() => {
        m.box(0.12, 1.9, 0.08, [0.58, 0, 0.09], body, S.paint, { bevel: 0.02 });
        m.bolts([0.72, -0.85, 0.08], [0.72, 0.85, 0.08], 7, 0.022, steel);
      });
      m.box(0.28, 0.9, 0.04, [0, 0.05, 0.08], glowCol, S.glow);
      for (const y of [-0.7, 0.72])
        m.box(0.2, 0.2, 0.04, [0, y, 0.08], glowCol, S.glow, { rot: [0, 0, PI / 4] });
      m.box(0.5, 0.1, 0.06, [0, 0.62, 0.08], dark, S.darkSteel);
      m.box(0.2, 0.3, 0.3, [0, 0, -0.2], dark, S.darkSteel, { bevel: 0.03 });
      m.pop();
      for (const [leg, shin, sx] of [
        ["legL", "shinL", -1],
        ["legR", "shinR", 1],
      ] as const) {
        m.bone = B[leg];
        m.push([sx * 0.38, 1.0, 0]);
        m.box(0.32, 0.52, 0.4, [0, -0.22, 0], armour, S.paint, { bevel: 0.06 });
        m.cyl(0.13, 0.2, [0, 0, 0], dark, S.gunmetal, { rot: [0, 0, PI / 2], seg: 12 });
        m.pop();
        m.bone = B[shin];
        m.push([sx * 0.38, 0.52, 0.04]);
        m.sphere(0.12, [0, 0, 0], dark, S.gunmetal, { low: true });
        m.box(0.28, 0.4, 0.34, [0, -0.22, 0], dark, S.darkSteel, { bevel: 0.05 });
        m.box(0.36, 0.14, 0.58, [0, -0.45, 0.08], armour, S.darkSteel, { bevel: 0.04 });
        m.pop();
      }
    },
    animate(b, p) {
      walkLegs(b, p, 0.4);
      idle(b.torso, p, 1);
      // shield held square in front; the bash drives it forward with the mace
      const w = p.wind;
      const bash = w > 0.5 ? Math.sin(((w - 0.5) / 0.5) * PI) : 0;
      b.armL.rotation.x = -0.05 * p.move + (w > 0 && w <= 0.5 ? (w / 0.5) * 0.15 : 0);
      b.shield.position.z += bash * 0.45 - (w > 0 && w <= 0.5 ? (w / 0.5) * 0.25 : 0);
      b.armR.rotation.x =
        w <= 0
          ? -0.2 - Math.sin(p.phase) * 0.2 * p.move
          : w < 0.5
            ? -0.2 - (w / 0.5) * 2.2
            : -2.4 + ((w - 0.5) / 0.5) * 1.8;
      b.torso.rotation.x = bash * 0.15;
    },
  });
}

/** attack wind-up for melee swingers: 0 idle, 0..1 through the 0.4 s swing */
/** shooter: wind-up in the last 0.5 s before the shot, aux = cooldown (for the recoil) */
export const shooterInputs: RobotInputs = (d, o) => {
  const cd = d.cooldown ?? 9;
  o.wind = cd > 0 && cd < 0.5 ? 1 - cd / 0.5 : 0;
  o.aux = cd;
};
/** bomber: wind-up in the last 0.8 s of the shot timer, aux = the timer (for the recoil) */
export const bomberInputs: RobotInputs = (d, o) => {
  const s = d.shot ?? 9;
  o.wind = s > 0 && s < 0.8 ? 1 - s / 0.8 : 0;
  o.aux = s;
};
/** specter: aux = cooldown (1.4 right after a slash) */
export const specterInputs: RobotInputs = (d, o) => {
  o.wind = 0;
  o.aux = d.cooldown ?? 0;
};

export const swingInputs: RobotInputs = (d, o) => {
  o.wind = (d.swing ?? 0) > 0 ? 1 - (d.swing ?? 0) / 0.4 : 0;
  o.aux = 0;
};

export type ClassicKind =
  "drifter" | "runner" | "brute" | "shooter" | "specter" | "bomber" | "vanguard";
export function classicRobot(kind: ClassicKind, theme: Theme): RobotKind {
  const key = `${kind}|${theme.name}`;
  let k = cache.get(key);
  if (!k) {
    const c = theme.enemy;
    const g = theme.enemyBullet;
    k =
      kind === "drifter"
        ? drifter(c, g)
        : kind === "runner"
          ? runner(c)
          : kind === "brute"
            ? brute(c)
            : kind === "shooter"
              ? shooter(c)
              : kind === "specter"
                ? specter(c, g)
                : kind === "bomber"
                  ? bomber(c, g)
                  : vanguard(c, g);
    cache.set(key, k);
  }
  return k;
}
