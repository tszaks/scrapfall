// The four live maps' bosses, rebuilt as detailed scrap-built war machines:
//   THE KINGPIN (Vice Heights, "mech"): a gold-plated crime-boss mech with a sledge arm.
//   THE AVALANCHE ENGINE (Whiteout Pass, "plough"): a tracked snow-plough with a V blade.
//   THE KRAKEN RIG (Pacific Pier, "kraken"): a rusted pressure hull on six steel tentacles.
//   THE IRON MARSHAL (Dry Gulch, "marshal"): a steam-boiler sheriff with a Gatling and a lasso.
// The boss group is drawn 1.6x by EnemyMesh; sizes here are in the model's own units.
// Every attack (data.swing, 0.4 s) reads as a wind-up then a strike; the Marshal's lasso
// wind-up (data.aux) swings the rope overhead.
import * as THREE from "three";

import type { Theme } from "../../themes";
import { SURF, type Model } from "../kit";
import { defineRobot, idle, walkLegs, type Pose, type RobotKind } from "../rig";

const S = SURF;
const PI = Math.PI;
const STEEL = "#8a8f96";
const DARK = "#222428";
const BRASS = "#c8a040";

type Bc = Theme["boss"];
export const ART_BOSSES = new Set<string>(["mech", "plough", "kraken", "marshal"]);

function shade(hex: string, k: number) {
  const c = new THREE.Color(hex);
  if (k < 1) c.multiplyScalar(k);
  else c.lerp(new THREE.Color(1, 1, 1), k - 1);
  return c;
}

/**
 * Overhead sledge swing for an arm authored hanging straight down: back and up through
 * the first 60% of the wind-up, then over the top and down in front at the strike.
 */
function overhead(w: number, rest: number) {
  if (w <= 0) return rest;
  if (w < 0.6) {
    const k = w / 0.6;
    return rest + (2.9 - rest) * (k * k * (3 - 2 * k));
  }
  const k = (w - 0.6) / 0.4;
  return 2.9 + k * k * 2.05;
}

// ---------------------------------------------------------------- THE KINGPIN
function kingpin(b: Bc): RobotKind {
  const gold = b.body;
  const limb = b.limb;
  const eye = b.eye;
  const wpn = b.weapon;
  const glow = b.glow;
  return defineRobot({
    name: "kingpin",
    stride: 2.2,
    wear: 0.5,
    bones: [
      { name: "hip", at: [0, 0.95, 0] },
      { name: "torso", parent: "hip", at: [0, 1.1, 0] },
      { name: "head", parent: "torso", at: [0, 2.4, 0] },
      { name: "cannons", parent: "torso", at: [0, 2.9, -0.4] },
      { name: "armL", parent: "torso", at: [-1.05, 2.05, 0] },
      { name: "armR", parent: "torso", at: [1.05, 2.05, 0] },
      { name: "legL", parent: "hip", at: [-0.45, 0.95, 0] },
      { name: "shinL", parent: "legL", at: [-0.47, 0.5, 0.05] },
      { name: "legR", parent: "hip", at: [0.45, 0.95, 0] },
      { name: "shinR", parent: "legR", at: [0.47, 0.5, 0.05] },
    ],
    build(m: Model, B) {
      // pelvis
      m.bone = B.hip;
      m.box(1.1, 0.4, 0.8, [0, 1.0, 0], limb, S.darkSteel, { bevel: 0.07 });
      m.box(0.6, 0.26, 0.12, [0, 1.0, 0.43], gold, S.brass, { bevel: 0.04 });
      m.tubeX(0.12, 1.22, [0, 0.95, 0], DARK, S.gunmetal, { seg: 12 });
      // torso: a gold-plated barrel chest over a dark armoured core, trimmed in chrome
      m.bone = B.torso;
      m.box(1.2, 0.5, 0.9, [0, 1.35, 0], limb, S.darkSteel, { bevel: 0.07 });
      m.both(() => {
        m.cyl(0.045, 0.5, [0.42, 1.36, 0.42], STEEL, S.chrome, { seg: 8 });
        m.cyl(0.07, 0.16, [0.42, 1.14, 0.42], DARK, S.gunmetal, { seg: 8 });
      });
      m.box(1.72, 1.1, 1.2, [0, 2.0, 0], gold, S.brass, { bevel: 0.14 });
      m.box(1.4, 0.7, 0.16, [0, 2.1, 0.62], shade(gold, 0.82), S.brass, { bevel: 0.06 });
      m.box(1.76, 0.08, 1.24, [0, 1.62, 0], STEEL, S.chrome, { bevel: 0.03 });
      m.box(1.76, 0.08, 1.24, [0, 2.42, 0], STEEL, S.chrome, { bevel: 0.03 });
      // the reactor ring on the chest (the old model's glowing torus)
      m.tubeZ(0.4, 0.1, [0, 2.05, 0.68], DARK, S.darkSteel, { seg: 20 });
      m.torus(0.33, 0.07, [0, 2.05, 0.73], glow, S.glow, { seg: 20 });
      m.sphere(0.18, [0, 2.05, 0.7], shade(glow, 1.3), S.glow, { s: [1, 1, 0.5] });
      m.bolts([-0.6, 2.42, 0.64], [0.6, 2.42, 0.64], 7, 0.026, STEEL);
      m.bolts([-0.6, 1.66, 0.64], [0.6, 1.66, 0.64], 7, 0.026, STEEL);
      // back: a power pack with cooling fins and cable runs to the cannons
      m.box(1.1, 0.9, 0.36, [0, 2.0, -0.72], limb, S.darkSteel, { bevel: 0.06 });
      for (let k = -3; k <= 3; k++)
        m.box(0.05, 0.7, 0.2, [k * 0.14, 2.0, -0.92], STEEL, S.steel, { lod: 1 });
      m.both(() =>
        m.cable(
          [
            [0.4, 1.7, -0.8],
            [0.6, 2.3, -0.9],
            [0.5, 2.8, -0.55],
          ],
          0.04,
          "#151515",
        ),
      );
      // pauldrons
      m.both(() => {
        m.box(0.62, 0.42, 1.0, [1.0, 2.46, 0], gold, S.brass, { bevel: 0.1, rot: [0, 0, -0.22] });
        m.box(0.5, 0.1, 0.9, [1.02, 2.7, 0], limb, S.darkSteel, {
          bevel: 0.03,
          rot: [0, 0, -0.22],
        });
      });
      // head: a heavy helm with the pink visor eyes and a chrome jaw grille
      m.bone = B.head;
      m.box(1.0, 0.72, 0.86, [0, 2.78, 0.02], gold, S.brass, { bevel: 0.12 });
      m.box(0.84, 0.18, 0.12, [0, 2.84, 0.44], DARK, S.darkSteel, { bevel: 0.03 });
      m.both(() => m.box(0.24, 0.12, 0.05, [0.22, 2.84, 0.5], eye, S.glow));
      m.box(0.56, 0.2, 0.12, [0, 2.56, 0.43], STEEL, S.chrome, { bevel: 0.03 });
      for (let k = -3; k <= 3; k++)
        m.box(0.03, 0.14, 0.02, [k * 0.07, 2.56, 0.5], DARK, S.darkSteel, { lod: 1 });
      m.box(0.2, 0.1, 0.7, [0, 3.18, -0.02], limb, S.darkSteel, { bevel: 0.03 });
      // twin shoulder cannons (the old model's back barrels)
      m.bone = B.cannons;
      m.both(() => {
        m.push([0.55, 2.95, -0.4], [0.35, 0, 0]);
        m.box(0.3, 0.3, 0.5, [0, 0, -0.1], limb, S.darkSteel, { bevel: 0.05 });
        m.cyl(0.13, 0.9, [0, 0.4, 0], wpn, S.gunmetal, { rb: 0.16, seg: 12 });
        m.cyl(0.16, 0.1, [0, 0.82, 0], STEEL, S.steel, { seg: 12 });
        m.cyl(0.09, 0.02, [0, 0.88, 0], glow, S.glowSoft, { seg: 10 });
        m.pop();
      });
      // left arm: pauldron joint, piston forearm, a gold-knuckled fist
      m.bone = B.armL;
      m.push([-1.05, 2.05, 0]);
      m.sphere(0.24, [0, 0, 0], DARK, S.gunmetal);
      m.cyl(0.16, 0.6, [-0.05, -0.4, 0], limb, S.darkSteel, { seg: 12 });
      m.cyl(0.035, 0.5, [-0.05, -0.4, 0.2], STEEL, S.chrome, { seg: 6, lod: 1 });
      m.sphere(0.18, [-0.06, -0.76, 0], STEEL, S.steel);
      m.box(0.44, 0.66, 0.48, [-0.07, -1.1, 0.02], gold, S.brass, { bevel: 0.08 });
      m.box(0.4, 0.32, 0.42, [-0.07, -1.56, 0.06], limb, S.darkSteel, { bevel: 0.06 });
      m.box(0.42, 0.1, 0.1, [-0.07, -1.58, 0.29], gold, S.brass, { bevel: 0.03 });
      m.pop();
      // right arm: the sledge (hangs down; the head is the old model's glowing block + spike)
      m.bone = B.armR;
      m.push([1.05, 2.05, 0]);
      m.sphere(0.24, [0, 0, 0], DARK, S.gunmetal);
      m.box(0.5, 0.5, 0.56, [0.02, -0.5, 0], gold, S.brass, { bevel: 0.07 });
      m.cyl(0.08, 0.9, [0.02, -1.05, 0], wpn, S.gunmetal, { seg: 10 });
      m.cyl(0.11, 0.26, [0.02, -0.82, 0], "#3a2a1a", S.leather, { seg: 10 });
      m.box(0.62, 0.62, 0.62, [0.02, -1.6, 0], wpn, S.darkSteel, { bevel: 0.08 });
      m.box(0.68, 0.12, 0.68, [0.02, -1.6, 0], glow, S.glow);
      m.cone(0.22, 0.4, [0.02, -2.1, 0], STEEL, S.brushed, { rot: [PI, 0, 0], seg: 8 });
      m.both(() => m.box(0.12, 0.28, 0.28, [0.34, -1.6, 0], STEEL, S.steel, { bevel: 0.03 }));
      m.bolts([-0.22, -1.34, 0.32], [0.26, -1.34, 0.32], 4, 0.025, STEEL);
      m.pop();
      // legs: armoured thighs, piston shins, wide feet
      for (const [leg, shin, sx] of [
        ["legL", "shinL", -1],
        ["legR", "shinR", 1],
      ] as const) {
        m.bone = B[leg];
        m.push([sx * 0.47, 0.95, 0]);
        m.cyl(0.18, 0.24, [0, 0, 0], DARK, S.gunmetal, { rot: [0, 0, PI / 2], seg: 12 });
        m.box(0.42, 0.5, 0.48, [0, -0.22, 0], gold, S.brass, { bevel: 0.07 });
        m.pop();
        m.bone = B[shin];
        m.push([sx * 0.47, 0.5, 0.05]);
        m.sphere(0.15, [0, 0, 0], DARK, S.gunmetal, { low: true });
        m.box(0.36, 0.34, 0.4, [0, -0.2, 0], limb, S.darkSteel, { bevel: 0.05 });
        m.cyl(0.03, 0.3, [sx * 0.14, -0.18, 0.2], STEEL, S.chrome, { seg: 6, lod: 1 });
        m.box(0.5, 0.16, 0.74, [0, -0.42, 0.1], limb, S.darkSteel, { bevel: 0.05 });
        m.box(0.52, 0.06, 0.2, [0, -0.36, 0.44], gold, S.brass, { bevel: 0.02 });
        m.pop();
      }
    },
    animate(bn, p) {
      walkLegs(bn, p, 0.4);
      idle(bn.torso, p, 1.2);
      const s = Math.sin(p.phase);
      bn.armL.rotation.x = -s * 0.3 * p.move - 0.08;
      bn.armR.rotation.x = overhead(p.wind, -0.5 + s * 0.15 * p.move);
      bn.armR.rotation.z = p.wind > 0 ? 0.12 : 0;
      bn.torso.rotation.x = p.wind > 0.6 ? 0.22 : p.wind > 0 ? -0.1 * (p.wind / 0.6) : 0.03;
      bn.torso.rotation.y =
        s * 0.06 * p.move + (p.wind > 0 && p.wind < 0.6 ? 0.2 * (p.wind / 0.6) : 0);
      bn.cannons.rotation.x = Math.sin(p.t * 0.7 + p.seed * 5) * 0.08;
      bn.head.rotation.y = Math.sin(p.t * 0.5 + p.seed * 3) * 0.2 * (1 - p.move);
    },
  });
}

// ---------------------------------------------------------------- THE AVALANCHE ENGINE
function plough(b: Bc): RobotKind {
  const hull = b.body;
  const limb = b.limb;
  const blade = b.weapon;
  const glow = b.glow;
  const eye = b.eye;
  return defineRobot({
    name: "plough",
    wear: 0.75,
    bones: [
      { name: "root", at: [0, 0, 0] },
      { name: "hull", parent: "root", at: [0, 0.9, 0] },
      { name: "blade", parent: "hull", at: [0, 1.5, 1.5] },
      { name: "auger", parent: "blade", at: [0, 0.7, 2.2] },
      { name: "beacons", parent: "hull", at: [0, 3.05, 0.45] },
      { name: "chute", parent: "hull", at: [0.7, 2.3, 1.0] },
      { name: "sprFL", parent: "root", at: [1.05, 0.45, 1.3] },
      { name: "sprFR", parent: "root", at: [-1.05, 0.45, 1.3] },
      { name: "sprBL", parent: "root", at: [1.05, 0.45, -1.3] },
      { name: "sprBR", parent: "root", at: [-1.05, 0.45, -1.3] },
    ],
    build(m, B) {
      // tracks: a long belt with cleats, skirt armour over the road wheels
      m.bone = B.root;
      m.both(() => {
        m.box(0.62, 0.7, 2.7, [1.05, 0.45, 0], DARK, S.rubber, { bevel: 0.08 });
        for (let k = 0; k < 12; k++)
          m.box(0.64, 0.05, 0.1, [1.05, 0.81, -1.3 + k * 0.236], "#2e3035", S.darkSteel, {
            lod: 1,
          });
        for (let k = 0; k < 12; k++)
          m.box(0.64, 0.05, 0.1, [1.05, 0.09, -1.3 + k * 0.236], "#2e3035", S.darkSteel, {
            lod: 1,
          });
        m.box(0.08, 0.5, 2.3, [1.39, 0.52, 0], hull, S.paint, { bevel: 0.03 });
        for (let k = 0; k < 4; k++)
          m.box(0.06, 0.14, 0.44, [1.44, 0.4, -0.9 + k * 0.6], limb, S.paint, {
            bevel: 0.02,
            rot: [0, 0, 0],
            lod: 1,
          });
        m.bolts([1.44, 0.72, -1.05], [1.44, 0.72, 1.05], 6, 0.025, STEEL);
      });
      // sprocket wheels at the track ends (they turn with the ground speed)
      for (const [bone, x, z] of [
        ["sprFL", 1.05, 1.3],
        ["sprFR", -1.05, 1.3],
        ["sprBL", 1.05, -1.3],
        ["sprBR", -1.05, -1.3],
      ] as const) {
        m.bone = B[bone];
        m.cyl(0.36, 0.66, [x, 0.45, z], "#34373c", S.darkSteel, { rot: [0, 0, PI / 2], seg: 12 });
        m.cyl(0.2, 0.7, [x, 0.45, z], blade, S.steel, { rot: [0, 0, PI / 2], seg: 8 });
        for (let k = 0; k < 4; k++)
          m.box(0.7, 0.06, 0.62, [x, 0.45, z], "#3c3f44", S.steel, {
            rot: [(k / 4) * PI, 0, 0],
            lod: 1,
          });
      }
      // hull, engine deck and cab
      m.bone = B.hull;
      m.box(2.1, 1.0, 3.0, [0, 1.3, -0.1], hull, S.paint, { bevel: 0.12 });
      m.box(2.14, 0.12, 3.04, [0, 1.02, -0.1], limb, S.darkSteel, { bevel: 0.03 });
      // hazard chevrons along the flanks
      m.both(() => {
        for (let k = 0; k < 5; k++)
          m.box(0.03, 0.26, 0.14, [1.07, 1.35, 0.3 + k * 0.24], k % 2 ? limb : "#f2f2ee", S.paint, {
            rot: [0.6, 0, 0],
            lod: 1,
          });
      });
      m.box(1.8, 0.5, 1.3, [0, 1.95, -0.9], limb, S.darkSteel, { bevel: 0.07 });
      for (let k = -4; k <= 4; k++)
        m.box(0.1, 0.06, 1.1, [k * 0.18, 2.23, -0.9], "#3a3d44", S.steel, { lod: 1 });
      m.box(1.5, 1.1, 1.2, [0, 2.35, 0.45], hull, S.paint, { bevel: 0.1 });
      m.box(1.3, 0.42, 0.1, [0, 2.45, 1.04], DARK, S.darkSteel, { bevel: 0.03 });
      m.box(1.2, 0.3, 0.05, [0, 2.45, 1.08], eye, S.glow);
      for (let k = -2; k <= 2; k++)
        m.box(0.03, 0.34, 0.03, [k * 0.26, 2.45, 1.11], DARK, S.darkSteel, { lod: 1 });
      m.box(1.56, 0.1, 1.26, [0, 2.93, 0.45], limb, S.darkSteel, { bevel: 0.03 });
      // exhaust stacks with a hot glow
      m.both(() => {
        m.cyl(0.1, 0.9, [0.6, 2.6, -1.3], limb, S.darkSteel, { rb: 0.12, seg: 10 });
        m.cyl(0.13, 0.08, [0.6, 3.06, -1.3], STEEL, S.steel, { seg: 10 });
        m.cyl(0.08, 0.02, [0.6, 3.1, -1.3], glow, S.glowSoft, { seg: 8 });
      });
      // floodlights on the cab roof
      m.both(() => {
        m.box(0.22, 0.16, 0.14, [0.55, 3.05, 0.95], DARK, S.darkSteel, { bevel: 0.02 });
        m.box(0.18, 0.12, 0.02, [0.55, 3.05, 1.03], "#fff6d8", S.glow);
      });
      m.bolts([-0.9, 1.75, 1.36], [0.9, 1.75, 1.36], 7, 0.03, STEEL);
      // the V blade on its lift arms, with the glowing cutting edge
      m.bone = B.blade;
      m.both(() => {
        m.box(0.14, 0.14, 1.0, [0.8, 1.2, 1.55], limb, S.darkSteel, {
          rot: [0.45, 0, 0],
          bevel: 0.03,
        });
        m.cyl(0.07, 0.6, [0.8, 1.0, 1.4], STEEL, S.chrome, { rot: [0.9, 0, 0], seg: 8 });
        m.box(1.7, 1.4, 0.16, [0.72, 0.75, 1.95], blade, S.brushed, {
          rot: [0, -0.5, 0],
          bevel: 0.05,
        });
        m.box(1.66, 0.12, 0.2, [0.72, 1.42, 1.93], hull, S.paint, {
          rot: [0, -0.5, 0],
          bevel: 0.03,
        });
        for (let k = 0; k < 3; k++)
          m.box(0.08, 1.2, 0.08, [0.3 + k * 0.45, 0.75, 1.76 - k * 0.22], limb, S.darkSteel, {
            rot: [0, -0.5, 0],
            lod: 1,
          });
      });
      m.box(2.9, 0.14, 0.5, [0, 0.2, 2.05], glow, S.glow);
      // snow-blower chute
      m.bone = B.chute;
      m.cyl(0.2, 1.6, [0.7, 2.6, 1.2], blade, S.steel, { rb: 0.26, seg: 10, rot: [-0.5, 0, 0] });
      m.cyl(0.24, 0.3, [0.7, 3.3, 1.58], hull, S.paint, { rb: 0.2, seg: 10, rot: [-1.1, 0, 0] });
      // the auger (spins in front of the blade)
      m.bone = B.auger;
      m.cyl(0.12, 2.3, [0, 0.7, 2.25], STEEL, S.steel, { rot: [0, 0, PI / 2], seg: 8 });
      for (let k = 0; k < 10; k++)
        m.box(0.06, 0.52, 0.12, [-1.0 + k * 0.22, 0.7, 2.25], limb, S.darkSteel, {
          rot: [k * 0.7, 0, 0],
          bevel: 0.015,
        });
      // spinning amber beacons
      m.bone = B.beacons;
      m.both(() => {
        m.cyl(0.1, 0.08, [0.55, 2.98, 0.45], DARK, S.darkSteel, { seg: 8 });
        m.box(0.22, 0.2, 0.22, [0.55, 3.12, 0.45], glow, S.glow);
      });
    },
    animate(bn, p) {
      // track sprockets roll with the ground speed; the hull hums and rocks a little
      const roll = p.phase * 1.4;
      for (const s of [bn.sprFL, bn.sprFR, bn.sprBL, bn.sprBR]) s.rotation.x = roll;
      bn.hull.position.y += Math.sin(p.t * 20) * 0.012 * (0.4 + p.move);
      bn.hull.rotation.x = Math.sin(p.t * 1.3) * 0.015 - p.move * 0.03;
      bn.beacons.rotation.y = p.t * 6;
      bn.auger.rotation.x = p.t * 9;
      bn.chute.rotation.y = Math.sin(p.t * 0.6 + p.seed * 4) * 0.5;
      // attack: the blade heaves up, then slams down
      const w = p.wind;
      bn.blade.rotation.x =
        w <= 0 ? 0 : w < 0.6 ? -0.55 * (w / 0.6) : -0.55 + ((w - 0.6) / 0.4) * 0.7;
      bn.hull.rotation.x += w > 0.6 ? 0.06 : w > 0 ? -0.04 : 0;
    },
  });
}

// ---------------------------------------------------------------- THE KRAKEN RIG
const TENTACLES = 6;
const tBone = (i: number, k: number) => `t${i}${k}` as const;
type TName = `t${0 | 1 | 2 | 3 | 4 | 5}${0 | 1 | 2}`;
/** the curled rest shape of one tentacle (from the old model), in its radial plane */
function tentacleSegs(i: number) {
  const segs: { y: number; r: number; th: number; L: number; y0: number; r0: number }[] = [];
  let py = 0.3;
  let pr = 1.35;
  for (let k = 0; k < 6; k++) {
    const th = 0.35 + k * 0.38 + (i % 2) * 0.08;
    const L = 0.55 - k * 0.04;
    segs.push({
      y: py + (Math.sin(th) * L) / 2,
      r: pr + (Math.cos(th) * L) / 2,
      th,
      L,
      y0: py,
      r0: pr,
    });
    py += Math.sin(th) * L;
    pr += Math.cos(th) * L;
  }
  return { segs, tipY: py, tipR: pr };
}

function kraken(b: Bc): RobotKind {
  const hull = b.body;
  const steel = b.limb;
  const brass = b.weapon;
  const glow = b.glow;
  const eye = b.eye;
  const bones: { name: string; parent?: string; at: [number, number, number] }[] = [
    { name: "root", at: [0, 0, 0] },
    { name: "hull", parent: "root", at: [0, 0.3, 0] },
    { name: "eye", parent: "hull", at: [0, 2.1, 1.0] },
    { name: "derrick", parent: "hull", at: [0, 3.6, 0] },
  ];
  for (let i = 0; i < TENTACLES; i++) {
    const a = (i / TENTACLES) * PI * 2 + 0.3;
    const { segs } = tentacleSegs(i);
    for (let k = 0; k < 3; k++) {
      const sg = segs[k * 2]!;
      bones.push({
        name: tBone(i, k),
        parent: k === 0 ? "root" : tBone(i, k - 1),
        at: [Math.sin(a) * sg.r0, sg.y0, Math.cos(a) * sg.r0],
      });
    }
  }
  return defineRobot({
    name: "kraken",
    wear: 0.95,
    bones: bones as {
      name: "root" | "hull" | "eye" | "derrick" | TName;
      parent?: "root" | "hull" | "eye" | "derrick" | TName;
      at: [number, number, number];
    }[],
    build(m, B) {
      // pressure hull: riveted, rust-streaked, bound in brass hoops
      m.bone = B.hull;
      m.cyl(1.2, 2.8, [0, 1.7, 0], hull, S.rust, { rb: 1.5, seg: 18 });
      m.dome(1.2, [0, 3.1, 0], hull, S.rust, { s: [1, 0.8, 1] });
      for (const y of [0.9, 1.9, 2.8])
        m.torus(1.36 - y * 0.05 + 0.02, 0.08, [0, y, 0], brass, S.brass, {
          rot: [PI / 2, 0, 0],
          seg: 22,
        });
      for (const y of [1.4, 2.35])
        for (let k = 0; k < 14; k++) {
          const a = (k / 14) * PI * 2;
          const r = 1.5 - (y - 0.3) * 0.107 + 0.01;
          m.cyl(0.035, 0.03, [Math.sin(a) * r, y, Math.cos(a) * r], STEEL, S.steel, {
            seg: 5,
            lod: 1,
          });
        }
      // portholes glowing from inside
      for (const a of [-0.75, 0.75, PI - 0.6, PI + 0.6]) {
        m.push([Math.sin(a) * 1.33, 1.25, Math.cos(a) * 1.33], [0, a, 0]);
        m.tubeZ(0.2, 0.12, [0, 0, 0], brass, S.brass, { seg: 14 });
        m.cyl(0.15, 0.02, [0, 0, 0.065], glow, S.glow, { rot: [PI / 2, 0, 0], seg: 14 });
        m.pop();
      }
      // hatch and valves on the dome, pipes down the side
      m.cyl(0.35, 0.14, [0, 3.95, 0], brass, S.brass, { seg: 14 });
      m.both(() => {
        m.cable(
          [
            [0.9, 3.2, -0.6],
            [1.35, 2.4, -0.7],
            [1.52, 1.2, -0.55],
            [1.45, 0.5, -0.4],
          ],
          0.06,
          steel,
          S.steel,
        );
        m.cyl(0.1, 0.25, [0.7, 3.5, -0.4], steel, S.steel, { seg: 8, lod: 1 });
        m.torus(0.12, 0.025, [0.7, 3.64, -0.4], "#b02a1a", S.paint, {
          rot: [PI / 2, 0, 0],
          seg: 10,
          lod: 1,
        });
      });
      // the eye: a huge lens in a brass bezel (it tracks a little)
      m.bone = B.eye;
      m.torus(0.52, 0.1, [0, 2.1, 1.12], brass, S.brass, { seg: 22 });
      m.tubeZ(0.46, 0.18, [0, 2.1, 1.08], DARK, S.darkSteel, { seg: 20 });
      m.sphere(0.4, [0, 2.1, 1.16], eye, S.glow, { s: [1, 1, 0.55] });
      m.sphere(0.14, [0, 2.1, 1.37], "#ffe0c0", S.glow, { low: true });
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * PI * 2;
        m.cyl(0.03, 0.03, [Math.sin(a) * 0.52, 2.1 + Math.cos(a) * 0.52, 1.22], STEEL, S.steel, {
          seg: 5,
          lod: 1,
        });
      }
      // the drilling derrick on top, with its beacon
      m.bone = B.derrick;
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * PI * 2 + PI / 4;
        m.box(0.1, 2.6, 0.1, [Math.sin(a) * 0.45, 4.7, Math.cos(a) * 0.45], steel, S.steel, {
          rot: [Math.cos(a) * -0.18, 0, Math.sin(a) * 0.18],
        });
      }
      for (const y of [4.1, 4.9, 5.6]) {
        const w = 1.1 - (y - 4.1) * 0.45;
        m.box(w, 0.07, w, [0, y, 0], steel, S.steel);
        m.box(w * 1.3, 0.04, 0.04, [0, y + 0.35, 0], steel, S.steel, {
          rot: [0, PI / 4, 0.5],
          lod: 1,
        });
      }
      m.cyl(0.05, 2.2, [0, 4.8, 0], STEEL, S.chrome, { seg: 6 });
      m.sphere(0.2, [0, 6.05, 0], glow, S.glow);
      // six jointed tentacles, alternating steel and brass segments, glowing suckers at the tips
      for (let i = 0; i < TENTACLES; i++) {
        const a = (i / TENTACLES) * PI * 2 + 0.3;
        const { segs, tipY, tipR } = tentacleSegs(i);
        m.push([0, 0, 0], [0, a, 0]);
        segs.forEach((sg, k) => {
          m.bone = B[tBone(i, Math.floor(k / 2)) as TName];
          m.cyl(
            0.2 - k * 0.025,
            0.74,
            [0, sg.y, sg.r],
            k % 2 ? brass : steel,
            k % 2 ? S.brass : S.steel,
            {
              rb: 0.27 - k * 0.025,
              seg: 8,
              rot: [PI / 2 - sg.th, 0, 0],
            },
          );
          m.torus(0.21 - k * 0.025, 0.035, [0, sg.y0, sg.r0], DARK, S.darkSteel, {
            rot: [PI / 2 - sg.th, 0, 0],
            seg: 8,
            lod: 1,
          });
          if (k < 5)
            m.cyl(
              0.05,
              0.03,
              [0, sg.y - Math.cos(sg.th) * 0.2, sg.r + Math.sin(sg.th) * 0.2],
              glow,
              S.glowSoft,
              {
                seg: 6,
                lod: 1,
                rot: [-sg.th, 0, 0],
              },
            );
        });
        m.bone = B[tBone(i, 2) as TName];
        m.sphere(0.13, [0, tipY, tipR], glow, S.glow, { low: true });
        m.pop();
      }
    },
    animate(bn, p) {
      const B = bn as unknown as Record<string, THREE.Bone>;
      bn.eye.rotation.y = Math.sin(p.t * 0.6 + p.seed * 4) * 0.12;
      bn.eye.rotation.x = Math.sin(p.t * 0.9) * 0.05;
      bn.hull.position.y += Math.sin(p.t * 1.1) * 0.05;
      bn.hull.rotation.z = Math.sin(p.t * 0.7) * 0.02;
      bn.derrick.rotation.y = Math.sin(p.t * 0.4) * 0.04;
      for (let i = 0; i < TENTACLES; i++) {
        const a = (i / TENTACLES) * PI * 2 + 0.3;
        const axis = _axis.set(Math.cos(a), 0, -Math.sin(a));
        // the two front tentacles (facing +z) do the strike
        const front = Math.cos(a) > 0.4;
        for (let k = 0; k < 3; k++) {
          let ang =
            Math.sin(p.t * 1.6 + i * 1.3 - k * 0.8) * (0.1 + k * 0.05) +
            Math.sin(p.phase + i) * 0.08 * p.move;
          if (front && p.wind > 0) ang += strike(p) * (k === 0 ? 0.6 : 0.45);
          B[tBone(i, k)]!.quaternion.setFromAxisAngle(axis, ang);
        }
      }
    },
  });
}
const _axis = new THREE.Vector3();
/** tentacle strike: lift (negative = up) through the wind-up, slam past rest at the end */
function strike(p: Pose) {
  const w = p.wind;
  return w < 0.6 ? -0.9 * (w / 0.6) : -0.9 + ((w - 0.6) / 0.4) * 1.5;
}

// ---------------------------------------------------------------- THE IRON MARSHAL
function marshal(b: Bc): RobotKind {
  const iron = b.body;
  const dark = b.limb;
  const eye = b.eye;
  const gun = b.weapon;
  const glow = b.glow;
  const rope = "#c8a878";
  return defineRobot({
    name: "marshal",
    stride: 2.1,
    wear: 0.9,
    bones: [
      { name: "hip", at: [0, 0.95, 0] },
      { name: "torso", parent: "hip", at: [0, 1.1, 0] },
      { name: "head", parent: "torso", at: [0, 2.45, 0] },
      { name: "armL", parent: "torso", at: [-1.0, 2.1, 0] },
      { name: "lasso", parent: "armL", at: [-1.05, 0.55, 0.3] },
      { name: "armR", parent: "torso", at: [1.0, 2.1, 0] },
      { name: "barrels", parent: "armR", at: [0.98, 1.2, 1.0] },
      { name: "legL", parent: "hip", at: [-0.45, 0.95, 0] },
      { name: "shinL", parent: "legL", at: [-0.47, 0.5, 0.05] },
      { name: "legR", parent: "hip", at: [0.45, 0.95, 0] },
      { name: "shinR", parent: "legR", at: [0.47, 0.5, 0.05] },
    ],
    build(m, B) {
      m.bone = B.hip;
      m.box(1.1, 0.4, 0.8, [0, 1.0, 0], dark, S.darkSteel, { bevel: 0.07 });
      m.box(1.16, 0.1, 0.86, [0, 1.14, 0], "#5a3a22", S.leather, { bevel: 0.02 });
      m.box(0.34, 0.24, 0.08, [0, 1.12, 0.44], BRASS, S.brass, { bevel: 0.03 });
      m.tubeX(0.12, 1.22, [0, 0.95, 0], DARK, S.gunmetal, { seg: 12 });
      // torso: a riveted steam boiler with brass bands, gauges and a glowing firebox
      m.bone = B.torso;
      m.cyl(0.86, 1.9, [0, 1.9, 0], iron, S.darkSteel, { rb: 0.8, seg: 18 });
      m.dome(0.86, [0, 2.85, 0], iron, S.darkSteel, { s: [1, 0.35, 1] });
      for (const y of [1.2, 1.9, 2.6])
        m.torus(0.87 - (y - 1.2) * 0.02, 0.05, [0, y, 0], BRASS, S.brass, {
          rot: [PI / 2, 0, 0],
          seg: 22,
        });
      for (const y of [1.55, 2.25])
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * PI * 2;
          m.cyl(0.028, 0.03, [Math.sin(a) * 0.86, y, Math.cos(a) * 0.86], STEEL, S.steel, {
            seg: 5,
            lod: 1,
          });
        }
      // firebox grate in the belly
      m.box(0.6, 0.36, 0.1, [0, 1.35, 0.8], DARK, S.darkSteel, { bevel: 0.03 });
      m.box(0.5, 0.26, 0.04, [0, 1.35, 0.84], "#ff7a1a", S.glow);
      for (let k = -2; k <= 2; k++)
        m.box(0.035, 0.3, 0.04, [k * 0.1, 1.35, 0.87], DARK, S.darkSteel);
      // pressure gauges and a valve wheel
      m.both(() => {
        m.tubeZ(0.1, 0.06, [0.38, 2.25, 0.84], BRASS, S.brass, { seg: 12 });
        m.cyl(0.08, 0.01, [0.38, 2.25, 0.875], "#f2ead6", S.enamel, {
          rot: [PI / 2, 0, 0],
          seg: 12,
          lod: 1,
        });
      });
      m.torus(0.13, 0.02, [-0.5, 1.7, 0.74], "#b02a1a", S.paint, { seg: 12, lod: 1 });
      // the gilded sheriff's star
      const star: [number, number][] = [];
      for (let k = 0; k < 10; k++) {
        const r = k % 2 ? 0.14 : 0.32;
        const a = (k / 10) * PI * 2;
        star.push([Math.sin(a) * r, Math.cos(a) * r]);
      }
      m.extrude(star, 0.06, [0.36, 1.85, 0.84], glow, S.glow, { bevel: 0.01, rot: [0, 0.35, 0] });
      // the smokestack on its back
      m.cyl(0.16, 1.4, [0.45, 3.1, -0.55], dark, S.darkSteel, { seg: 12 });
      m.cyl(0.28, 0.3, [0.45, 3.85, -0.55], dark, S.darkSteel, { rb: 0.16, seg: 12 });
      m.torus(0.28, 0.03, [0.45, 4.0, -0.55], BRASS, S.brass, { rot: [PI / 2, 0, 0], seg: 14 });
      m.cable(
        [
          [0.2, 2.6, -0.7],
          [0.4, 2.3, -0.9],
          [0.45, 2.45, -0.62],
        ],
        0.05,
        dark,
        S.steel,
      );
      // shoulders
      m.both(() => {
        m.sphere(0.34, [0.9, 2.45, 0], dark, S.darkSteel, { s: [1, 0.8, 1] });
        m.torus(0.3, 0.04, [0.9, 2.4, 0], BRASS, S.brass, {
          rot: [0, 0, PI / 2 - 0.3],
          seg: 14,
          lod: 1,
        });
      });
      // head: an iron box with glowing eyes and a moustache grille, under the hat
      m.bone = B.head;
      m.box(0.9, 0.7, 0.8, [0, 2.78, 0.02], iron, S.darkSteel, { bevel: 0.1 });
      m.both(() => m.box(0.18, 0.1, 0.05, [0.2, 2.86, 0.43], eye, S.glow));
      m.box(0.66, 0.1, 0.08, [0, 2.66, 0.44], BRASS, S.brass, { bevel: 0.02, rot: [0, 0, 0] });
      m.both(() =>
        m.box(0.28, 0.06, 0.06, [0.24, 2.62, 0.45], BRASS, S.brass, {
          rot: [0, 0, -0.35],
          bevel: 0.015,
        }),
      );
      m.cyl(1.05, 0.1, [0, 3.2, 0], dark, S.leather, { seg: 22 });
      m.both(() =>
        m.box(0.6, 0.08, 1.4, [0.82, 3.3, 0], dark, S.leather, { rot: [0, 0, 0.4], bevel: 0.02 }),
      );
      m.cyl(0.46, 0.55, [0, 3.5, 0], dark, S.leather, { rb: 0.56, seg: 14 });
      m.box(0.9, 0.08, 0.2, [0, 3.76, 0], shade(dark, 0.7), S.leather, { bevel: 0.03 });
      m.torus(0.56, 0.05, [0, 3.28, 0], BRASS, S.brass, { rot: [PI / 2, 0, 0], seg: 18 });
      // right arm: the Gatling (forearm drum, six spinning barrels, a glowing muzzle ring)
      m.bone = B.armR;
      m.push([1.0, 2.1, 0]);
      m.sphere(0.22, [0, 0, 0], DARK, S.gunmetal, { low: true });
      m.cyl(0.15, 0.7, [0, -0.4, 0], dark, S.darkSteel, { seg: 10 });
      m.pop();
      m.tubeZ(0.3, 0.6, [0.98, 1.2, 0.45], iron, S.darkSteel, { seg: 14 });
      m.torus(0.3, 0.04, [0.98, 1.2, 0.76], BRASS, S.brass, { seg: 16 });
      m.box(0.2, 0.2, 0.3, [0.98, 1.5, 0.3], dark, S.darkSteel, { bevel: 0.03 });
      m.cable(
        [
          [0.98, 1.55, 0.2],
          [1.2, 1.9, 0.0],
          [1.05, 2.05, -0.1],
        ],
        0.04,
        "#1a1a1a",
      );
      m.bone = B.barrels;
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * PI * 2;
        m.tubeZ(
          0.05,
          1.1,
          [0.98 + Math.cos(a) * 0.17, 1.2 + Math.sin(a) * 0.17, 1.3],
          gun,
          S.blued,
          { seg: 8 },
        );
      }
      m.tubeZ(0.08, 1.1, [0.98, 1.2, 1.3], DARK, S.gunmetal, { seg: 8 });
      m.cyl(0.26, 0.06, [0.98, 1.2, 1.2], BRASS, S.brass, { rot: [PI / 2, 0, 0], seg: 14 });
      m.torus(0.24, 0.04, [0.98, 1.2, 1.85], glow, S.glow, { seg: 16 });
      // left arm with the lasso coil in the fist
      m.bone = B.armL;
      m.push([-1.0, 2.1, 0]);
      m.sphere(0.22, [0, 0, 0], DARK, S.gunmetal, { low: true });
      m.cyl(0.15, 0.7, [0, -0.42, 0], dark, S.darkSteel, { seg: 10 });
      m.cyl(0.03, 0.6, [0, -0.42, 0.18], STEEL, S.chrome, { seg: 6, lod: 1 });
      m.sphere(0.16, [0, -0.82, 0], STEEL, S.steel, { low: true });
      m.box(0.4, 0.5, 0.42, [0, -1.12, 0.05], iron, S.darkSteel, { bevel: 0.07 });
      m.box(0.34, 0.26, 0.36, [0, -1.46, 0.14], dark, S.darkSteel, { bevel: 0.05 });
      m.pop();
      m.bone = B.lasso;
      m.torus(0.36, 0.05, [-1.05, 0.55, 0.3], rope, S.leather, { rot: [0, PI / 2, 0], seg: 18 });
      m.torus(0.27, 0.04, [-1.05, 0.55, 0.3], shade(rope, 0.9), S.leather, {
        rot: [0, PI / 2, 0],
        seg: 16,
        lod: 1,
      });
      // legs: piston legs, iron boots with spurs
      for (const [leg, shin, sx] of [
        ["legL", "shinL", -1],
        ["legR", "shinR", 1],
      ] as const) {
        m.bone = B[leg];
        m.push([sx * 0.47, 0.95, 0]);
        m.cyl(0.18, 0.24, [0, 0, 0], DARK, S.gunmetal, { rot: [0, 0, PI / 2], seg: 12 });
        m.box(0.4, 0.5, 0.46, [0, -0.22, 0], iron, S.darkSteel, { bevel: 0.07 });
        m.pop();
        m.bone = B[shin];
        m.push([sx * 0.47, 0.5, 0.05]);
        m.sphere(0.15, [0, 0, 0], DARK, S.gunmetal, { low: true });
        m.box(0.36, 0.34, 0.4, [0, -0.2, 0], dark, S.leather, { bevel: 0.05 });
        m.box(0.48, 0.16, 0.72, [0, -0.42, 0.1], dark, S.leather, { bevel: 0.05 });
        m.cyl(0.08, 0.03, [0, -0.36, -0.3], BRASS, S.brass, {
          rot: [PI / 2, 0, 0],
          seg: 8,
          lod: 1,
        });
        m.pop();
      }
    },
    animate(bn, p) {
      walkLegs(bn, p, 0.38);
      idle(bn.torso, p, 1.1);
      const s = Math.sin(p.phase);
      bn.barrels.rotation.z = p.t * 14;
      // the Gatling arm pivots at the shoulder: aimed forward, clubbing down on a melee swing
      const w = p.wind;
      bn.armR.rotation.x =
        w <= 0 ? s * 0.12 * p.move : w < 0.6 ? -1.1 * (w / 0.6) : -1.1 + ((w - 0.6) / 0.4) * 1.4;
      // the lasso: arm up, the loop opens wide and whirls overhead while aux runs
      const lasso = p.aux;
      bn.armL.rotation.x = -s * 0.3 * p.move * (1 - lasso) - 2.9 * lasso;
      bn.armL.rotation.z = -0.3 * lasso;
      // (the coil hangs in the fist; while the lasso winds up it opens into a big wobbling loop)
      bn.lasso.rotation.set(Math.sin(p.t * 12) * 0.35 * lasso, 0, (PI / 2) * lasso);
      bn.lasso.scale.setScalar(1 + lasso * 1.6);
      bn.torso.rotation.y = s * 0.06 * p.move;
      bn.head.rotation.y = Math.sin(p.t * 0.5 + p.seed * 3) * 0.2 * (1 - p.move);
    },
  });
}

const cache = new Map<string, RobotKind>();
export function bossRobot(theme: Theme): RobotKind | null {
  const b = theme.boss;
  if (!ART_BOSSES.has(b.shape)) return null;
  const key = `${b.shape}|${theme.name}`;
  let k = cache.get(key);
  if (!k) {
    k =
      b.shape === "mech"
        ? kingpin(b)
        : b.shape === "plough"
          ? plough(b)
          : b.shape === "kraken"
            ? kraken(b)
            : marshal(b);
    cache.set(key, k);
  }
  return k;
}

/** does this map's boss have a detailed art model? */
export const hasArtBoss = (theme: Theme) => ART_BOSSES.has(theme.boss.shape);
