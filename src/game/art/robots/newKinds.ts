// The ten newer robot types (enemyAI.ts), rebuilt as detailed scrap-built machines on
// skinned rigs. Each keeps its old silhouette, its accent colour and the model-space spots
// its telegraphs are drawn at (EnemyModels.tsx): the sniper's muzzle, the flanker's gun
// tips, the grenadier's throwing arm, the bulwark's shield, the charger's horns, the
// gatling's barrels, the rocketeer's launcher and the cloaker's blades.
import * as THREE from "three";

import {
  PH_ACT,
  PH_AFTER,
  PH_WIND,
  visExtra,
  visPhase,
  visProg,
  type NewKind,
} from "../../enemyKinds";
import { SURF, type Model } from "../kit";
import { defineRobot, idle, walkLegs, type Pose, type RobotKind } from "../rig";
import type { RobotInputs } from "../RobotModel";

const S = SURF;
const PI = Math.PI;
const STEEL = "#8a8f96";
const CABLE = "#1a1b1d";

export const NEW_ACCENT: Record<NewKind, string> = {
  sniper: "#ff2b2b",
  flanker: "#a6ff3a",
  grenadier: "#ff8c1a",
  bulwark: "#4fe0ff",
  charger: "#ffc21a",
  medic: "#34ff86",
  hornet: "#ff3020",
  gatling: "#b060ff",
  rocketeer: "#ff4fa3",
  cloaker: "#9fd8ff",
};

/** darken / lighten an sRGB hex */
function shade(hex: string, k: number) {
  const c = new THREE.Color(hex);
  if (k < 1) c.multiplyScalar(k);
  else c.lerp(new THREE.Color(1, 1, 1), k - 1);
  return c;
}

/** the telegraph state, decoded (RobotModel passes the raw `vis` as aux) */
function tel(p: Pose) {
  const v = p.aux;
  return { ph: visPhase(v), pr: visProg(v), ex: visExtra(v) };
}

/**
 * A walker's leg on bones `leg` (hip pivot) and `shin` (knee pivot): armoured thigh, a
 * knee joint, a piston-braced shin and a foot. `x` = side offset, `hy` = hip height.
 */
function leg(
  m: Model,
  legB: number,
  shinB: number,
  x: number,
  hy: number,
  ky: number,
  o: { col: string; dark: string; w?: number; foot?: number },
) {
  const w = o.w ?? 0.16;
  m.bone = legB;
  m.push([x, hy, 0]);
  m.cyl(w * 0.55, w * 0.9, [0, 0, 0], o.dark, S.gunmetal, { rot: [0, 0, PI / 2], seg: 10 });
  m.box(w, hy - ky - 0.05, w * 1.15, [0, -(hy - ky) / 2, 0.01], o.col, S.paint, {
    bevel: w * 0.18,
  });
  m.box(w * 0.7, (hy - ky) * 0.5, 0.03, [0, -(hy - ky) / 2, w * 0.6], o.dark, S.darkSteel, {
    lod: 1,
  });
  m.pop();
  m.bone = shinB;
  m.push([x, ky, 0]);
  m.sphere(w * 0.5, [0, 0, 0], o.dark, S.gunmetal, { low: true });
  m.box(w * 0.85, ky - 0.08, w, [0, -ky / 2 + 0.02, -0.02], o.dark, S.darkSteel, {
    bevel: w * 0.15,
  });
  m.cyl(w * 0.14, ky * 0.7, [0, -ky / 2, w * 0.62], STEEL, S.chrome, { seg: 6, lod: 1 });
  m.box(w * 1.2, 0.08, o.foot ?? 0.34, [0, -ky + 0.04, 0.05], o.col, S.darkSteel, { bevel: 0.025 });
  m.pop();
}

// ---------------------------------------------------------------- SNIPER
function sniper(A: string): RobotKind {
  const m0 = "#3b4048";
  const dk = "#22262b";
  const ol = "#34402f";
  return defineRobot({
    name: "sniper",
    stride: 1.5,
    bones: [
      { name: "hip", at: [0, 1.05, 0] },
      { name: "torso", parent: "hip", at: [0, 1.1, 0] },
      { name: "head", parent: "torso", at: [0, 1.82, 0] },
      { name: "legL", parent: "hip", at: [0.16, 1.05, 0] },
      { name: "shinL", parent: "legL", at: [0.16, 0.55, 0] },
      { name: "legR", parent: "hip", at: [-0.16, 1.05, 0] },
      { name: "shinR", parent: "legR", at: [-0.16, 0.55, 0] },
    ],
    build(m, B) {
      m.bone = B.hip;
      m.box(0.44, 0.2, 0.3, [0, 1.08, 0], dk, S.darkSteel, { bevel: 0.03 });
      leg(m, B.legL, B.shinL, 0.16, 1.05, 0.55, { col: m0, dark: dk, w: 0.13 });
      leg(m, B.legR, B.shinR, -0.16, 1.05, 0.55, { col: m0, dark: dk, w: 0.13 });
      // torso: a slim frame under a tattered tarp poncho
      m.bone = B.torso;
      m.box(0.42, 0.6, 0.3, [0, 1.45, 0], m0, S.paint, { bevel: 0.05 });
      m.cone(0.47, 0.95, [0, 1.42, -0.06], ol, S.leather, { seg: 9 });
      m.box(0.5, 0.08, 0.36, [0, 1.74, 0], shade(ol, 0.8), S.leather, { bevel: 0.02 });
      m.box(0.3, 0.34, 0.14, [0, 1.42, -0.27], dk, S.darkSteel, { bevel: 0.03 });
      m.cyl(0.012, 0.6, [0.08, 1.95, -0.3], STEEL, S.steel, { seg: 5, lod: 1, rot: [-0.2, 0, 0] });
      // the rifle: long barrel along +z, muzzle brake at the laser pivot (0.14, 1.62, 1.22)
      m.box(0.1, 0.16, 0.42, [0.14, 1.58, -0.12], m0, S.gunmetal, { bevel: 0.02 });
      m.box(0.08, 0.14, 0.3, [0.14, 1.56, -0.42], "#3a2a1a", S.wood, { bevel: 0.02 });
      m.tubeZ(0.035, 1.28, [0.14, 1.62, 0.52], dk, S.blued, { seg: 10 });
      m.tubeZ(0.05, 0.12, [0.14, 1.62, 1.14], dk, S.gunmetal, { seg: 8 });
      m.tubeZ(0.05, 0.36, [0.14, 1.72, 0.2], dk, S.gunmetal, { seg: 12 });
      m.cyl(0.035, 0.02, [0.14, 1.72, 0.385], A, S.lens, { rot: [PI / 2, 0, 0], seg: 12 });
      m.box(0.02, 0.2, 0.02, [0.18, 1.5, 0.75], STEEL, S.steel, { rot: [0.5, 0, 0.2], lod: 1 });
      m.box(0.02, 0.2, 0.02, [0.1, 1.5, 0.75], STEEL, S.steel, { rot: [0.5, 0, -0.2], lod: 1 });
      // arms reaching to the rifle
      m.box(0.09, 0.09, 0.5, [0.25, 1.55, 0.1], m0, S.paint, { bevel: 0.02 });
      m.box(0.09, 0.09, 0.56, [-0.04, 1.56, 0.3], m0, S.paint, { bevel: 0.02, rot: [0, 0.35, 0] });
      m.sphere(0.07, [0.25, 1.62, -0.14], dk, S.gunmetal, { low: true });
      m.sphere(0.07, [-0.2, 1.62, 0.02], dk, S.gunmetal, { low: true });
      // head: hooded sensor with one red lens
      m.bone = B.head;
      m.box(0.26, 0.24, 0.26, [0, 1.92, 0], dk, S.darkSteel, { bevel: 0.04 });
      m.cone(0.25, 0.32, [0, 2.1, -0.02], ol, S.leather, { seg: 8 });
      m.tubeZ(0.09, 0.08, [0, 1.92, 0.14], dk, S.gunmetal, { seg: 12 });
      m.cyl(0.075, 0.03, [0, 1.92, 0.18], A, S.glow, { rot: [PI / 2, 0, 0], seg: 12 });
    },
    animate(b, p) {
      walkLegs(b, p, 0.55);
      const { ph } = tel(p);
      // head tracks slightly while idle; freezes once it aims
      if (ph === 0) b.head.rotation.y = Math.sin(p.t * 0.9 + p.seed * 5) * 0.35;
      if (p.move < 0.2 && ph === 0) idle(b.head, p, 1);
    },
  });
}

// ---------------------------------------------------------------- FLANKER (four-legged crab)
const QUAD = ["fl", "fr", "bl", "br"] as const;
function flanker(A: string): RobotKind {
  const bd = "#2e3a2a";
  const md = "#4a5a3a";
  const dk = "#1c231a";
  return defineRobot({
    name: "flanker",
    stride: 1.0,
    bones: [
      { name: "body", at: [0, 0.8, 0] },
      { name: "fl", parent: "body", at: [0.32, 0.8, 0.32] },
      { name: "flS", parent: "fl", at: [0.6, 0.58, 0.32] },
      { name: "fr", parent: "body", at: [-0.32, 0.8, 0.32] },
      { name: "frS", parent: "fr", at: [-0.6, 0.58, 0.32] },
      { name: "bl", parent: "body", at: [0.32, 0.8, -0.32] },
      { name: "blS", parent: "bl", at: [0.6, 0.58, -0.32] },
      { name: "br", parent: "body", at: [-0.32, 0.8, -0.32] },
      { name: "brS", parent: "br", at: [-0.6, 0.58, -0.32] },
    ],
    build(m, B) {
      m.bone = B.body;
      m.push([0, 0.8, 0], [-0.12, 0, 0]);
      m.box(0.7, 0.3, 0.95, [0, 0, 0], bd, S.paint, { bevel: 0.07 });
      m.box(0.56, 0.12, 0.7, [0, 0.19, -0.05], md, S.paint, { bevel: 0.04 });
      m.box(0.06, 0.26, 0.6, [0, 0.3, -0.1], md, S.paint, { bevel: 0.02 });
      m.box(0.07, 0.18, 0.8, [0.3, 0.12, -0.15], A, S.glowSoft);
      m.bolts([-0.25, 0.16, 0.4], [0.25, 0.16, 0.4], 4, 0.016, STEEL);
      m.pop();
      // nose cone and sensor head
      m.cone(0.25, 0.5, [0, 0.76, 0.7], md, S.paint, { rot: [PI / 2, 0, 0], seg: 10 });
      m.box(0.3, 0.16, 0.24, [0, 0.97, 0.35], dk, S.darkSteel, { bevel: 0.03 });
      m.box(0.24, 0.05, 0.04, [0, 0.98, 0.48], A, S.glow);
      // twin guns: tips at (+-0.45, 0.8, 0.7)
      m.both(() => {
        m.box(0.12, 0.12, 0.3, [0.45, 0.8, 0.2], dk, S.gunmetal, { bevel: 0.02 });
        m.tubeZ(0.045, 0.5, [0.45, 0.8, 0.44], dk, S.blued, { seg: 10 });
        m.tubeZ(0.06, 0.08, [0.45, 0.8, 0.66], STEEL, S.steel, { seg: 8 });
        m.cable(
          [
            [0.3, 0.9, -0.1],
            [0.42, 0.9, 0.05],
            [0.45, 0.84, 0.12],
          ],
          0.015,
          CABLE,
        );
      });
      // legs splay out, thigh up, shin down to a spike
      for (const n of QUAD) {
        const sx = n === "fl" || n === "bl" ? 1 : -1;
        const sz = n === "fl" || n === "fr" ? 1 : -1;
        m.bone = B[n];
        m.push([sx * 0.32, 0.8, sz * 0.32]);
        m.sphere(0.08, [0, 0, 0], dk, S.gunmetal, { low: true });
        m.box(0.36, 0.08, 0.09, [sx * 0.15, -0.1, 0], md, S.paint, {
          rot: [0, 0, sx * -0.6],
          bevel: 0.02,
        });
        m.pop();
        m.bone = B[`${n}S` as "flS"];
        m.push([sx * 0.6, 0.58, sz * 0.32]);
        m.sphere(0.06, [0, 0, 0], dk, S.gunmetal, { low: true });
        m.box(0.07, 0.6, 0.07, [sx * 0.03, -0.28, 0], dk, S.darkSteel, {
          rot: [0, 0, sx * 0.12],
          bevel: 0.015,
        });
        m.cone(0.04, 0.12, [sx * 0.07, -0.6, 0], STEEL, S.steel, { rot: [PI, 0, 0], seg: 6 });
        m.pop();
      }
    },
    animate(b, p) {
      const a = p.move;
      for (const n of QUAD) {
        const sx = n === "fl" || n === "bl" ? 1 : -1;
        const off = n === "fl" || n === "br" ? 0 : PI;
        const s = Math.sin(p.phase * 1.4 + off);
        const lift = Math.max(0, Math.cos(p.phase * 1.4 + off));
        b[n].rotation.y = s * 0.45 * a;
        b[n].rotation.z = sx * lift * 0.35 * a;
      }
      b.body.position.y += Math.sin(p.phase * 2.8) * 0.025 * a;
      const { ph } = tel(p);
      b.body.rotation.x = ph === PH_WIND ? -0.06 : ph === PH_ACT ? 0.03 * Math.sin(p.t * 60) : 0;
    },
  });
}

// ---------------------------------------------------------------- GRENADIER
function grenadier(A: string): RobotKind {
  const k = "#6b5a40";
  const dk = "#3a3228";
  const o = "#e07818";
  return defineRobot({
    name: "grenadier",
    stride: 1.3,
    bones: [
      { name: "hip", at: [0, 0.62, 0] },
      { name: "torso", parent: "hip", at: [0, 0.75, 0] },
      { name: "head", parent: "torso", at: [0, 1.45, 0] },
      { name: "arm", parent: "torso", at: [0.55, 1.3, 0] },
      { name: "armL", parent: "torso", at: [-0.5, 1.3, 0] },
      { name: "legL", parent: "hip", at: [0.2, 0.62, 0] },
      { name: "shinL", parent: "legL", at: [0.2, 0.32, 0] },
      { name: "legR", parent: "hip", at: [-0.2, 0.62, 0] },
      { name: "shinR", parent: "legR", at: [-0.2, 0.32, 0] },
    ],
    build(m, B) {
      m.bone = B.hip;
      m.box(0.56, 0.18, 0.4, [0, 0.64, 0], dk, S.darkSteel, { bevel: 0.04 });
      leg(m, B.legL, B.shinL, 0.2, 0.62, 0.32, { col: k, dark: dk, w: 0.2, foot: 0.36 });
      leg(m, B.legR, B.shinR, -0.2, 0.62, 0.32, { col: k, dark: dk, w: 0.2, foot: 0.36 });
      // a round, riveted boiler of a body
      m.bone = B.torso;
      m.sphere(0.5, [0, 1.05, 0], k, S.paint, { s: [1, 0.9, 0.85] });
      m.torus(0.45, 0.035, [0, 1.05, 0], dk, S.darkSteel, { rot: [PI / 2, 0, 0], seg: 20 });
      m.bolts([-0.3, 1.33, 0.3], [0.3, 1.33, 0.3], 5, 0.018, STEEL);
      // chest plate with the bandolier of lit grenades
      m.box(0.6, 0.42, 0.1, [0, 0.96, 0.42], dk, S.darkSteel, { bevel: 0.03 });
      m.box(0.07, 0.95, 0.07, [0, 1.05, 0.48], "#3a2a1a", S.leather, { rot: [0, 0, 0.7] });
      for (const [x, y] of [
        [-0.18, 1.25],
        [0, 1.05],
        [0.18, 0.85],
      ] as const) {
        m.sphere(0.07, [x, y, 0.52], A, S.glow, { low: true });
        m.cyl(0.03, 0.04, [x, y + 0.08, 0.52], STEEL, S.steel, { seg: 6, lod: 1 });
      }
      // backpack rack of spare shells
      m.box(0.5, 0.5, 0.24, [0, 1.15, -0.45], dk, S.darkSteel, { bevel: 0.04 });
      for (const [x, y] of [
        [0.13, 1.02],
        [-0.13, 1.02],
        [0.13, 1.3],
        [-0.13, 1.3],
      ] as const)
        m.sphere(0.1, [x, y, -0.6], o, S.enamel);
      m.cable(
        [
          [-0.2, 1.4, -0.4],
          [-0.3, 1.5, -0.1],
          [-0.26, 1.38, 0.1],
        ],
        0.02,
        CABLE,
      );
      // head: a dome with a slit visor
      m.bone = B.head;
      m.sphere(0.3, [0, 1.6, 0], k, S.paint, { s: [1, 0.8, 1] });
      m.box(0.34, 0.1, 0.1, [0, 1.58, 0.25], dk, S.darkSteel, { bevel: 0.02 });
      m.box(0.3, 0.05, 0.04, [0, 1.58, 0.29], A, S.glow);
      m.cyl(0.015, 0.3, [0.12, 1.9, -0.1], STEEL, S.steel, { seg: 5, lod: 1 });
      // throwing arm (right): the grenade telegraph hangs at its hand, (0, -0.64, 0) below the pivot
      m.bone = B.arm;
      m.push([0.55, 1.3, 0]);
      m.sphere(0.12, [0, 0, 0], dk, S.gunmetal, { low: true });
      m.box(0.16, 0.36, 0.18, [0, -0.2, 0], k, S.paint, { bevel: 0.03 });
      m.cyl(0.02, 0.3, [0.07, -0.25, 0.08], STEEL, S.chrome, { seg: 6, lod: 1 });
      m.box(0.18, 0.18, 0.2, [0, -0.46, 0], dk, S.darkSteel, { bevel: 0.03 });
      m.both(() => m.box(0.03, 0.12, 0.04, [0.06, -0.58, 0.05], STEEL, S.steel, { lod: 1 }));
      m.pop();
      m.bone = B.armL;
      m.push([-0.5, 1.3, 0]);
      m.sphere(0.12, [0, 0, 0], dk, S.gunmetal, { low: true });
      m.box(0.16, 0.55, 0.18, [-0.05, -0.3, 0], k, S.paint, { rot: [0, 0, 0.2], bevel: 0.03 });
      m.box(0.18, 0.16, 0.2, [-0.12, -0.6, 0], dk, S.darkSteel, { bevel: 0.03 });
      m.pop();
    },
    animate(b, p) {
      walkLegs(b, p, 0.6);
      const { ph, pr } = tel(p);
      b.arm.rotation.x =
        ph === PH_WIND ? -2.6 * Math.min(1, pr * 1.6) : Math.sin(p.t * 3 + p.seed * 9) * 0.1;
      b.armL.rotation.x = -Math.sin(p.phase) * 0.3 * p.move;
      b.torso.rotation.y = ph === PH_WIND ? -0.25 * Math.min(1, pr * 1.6) : 0;
      idle(b.torso, p, 0.8);
    },
  });
}

// ---------------------------------------------------------------- BULWARK
function bulwark(A: string): RobotKind {
  const s = "#3a4a5a";
  const dk = "#242e38";
  return defineRobot({
    name: "bulwark",
    stride: 1.7,
    bones: [
      { name: "hip", at: [0, 0.7, 0] },
      { name: "torso", parent: "hip", at: [0, 0.85, 0] },
      { name: "head", parent: "torso", at: [0, 1.75, 0] },
      { name: "shield", parent: "hip", at: [0, 1.25, 0.6] },
      { name: "legL", parent: "hip", at: [0.28, 0.7, 0] },
      { name: "shinL", parent: "legL", at: [0.28, 0.36, 0] },
      { name: "legR", parent: "hip", at: [-0.28, 0.7, 0] },
      { name: "shinR", parent: "legR", at: [-0.28, 0.36, 0] },
    ],
    build(m, B) {
      m.bone = B.hip;
      m.box(0.7, 0.22, 0.5, [0, 0.72, 0], dk, S.darkSteel, { bevel: 0.04 });
      leg(m, B.legL, B.shinL, 0.28, 0.7, 0.36, { col: s, dark: dk, w: 0.3, foot: 0.46 });
      leg(m, B.legR, B.shinR, -0.28, 0.7, 0.36, { col: s, dark: dk, w: 0.3, foot: 0.46 });
      // blocky armoured body with shoulder pauldrons
      m.bone = B.torso;
      m.box(1.05, 0.95, 0.75, [0, 1.22, 0], s, S.paint, { bevel: 0.08 });
      m.box(0.8, 0.5, 0.1, [0, 1.32, 0.38], shade(s, 0.8), S.paint, { bevel: 0.03 });
      m.box(0.2, 0.2, 0.04, [0, 1.3, 0.44], A, S.glow);
      m.bolts([-0.35, 1.58, 0.43], [0.35, 1.58, 0.43], 5, 0.02, STEEL);
      m.both(() => {
        m.box(0.46, 0.34, 0.82, [0.68, 1.62, 0], dk, S.paint, { rot: [0, 0, -0.2], bevel: 0.06 });
        m.box(0.2, 0.62, 0.22, [0.62, 1.18, 0.1], s, S.paint, { bevel: 0.04 });
        m.cyl(0.08, 0.5, [0.28, 1.6, -0.45], dk, S.darkSteel, { seg: 8 });
        m.cyl(0.06, 0.04, [0.28, 1.86, -0.45], A, S.glowSoft, { seg: 8 });
      });
      // stub gun on the right arm
      m.box(0.2, 0.2, 0.55, [-0.3, 1.3, 0.55], s, S.gunmetal, { bevel: 0.03 });
      m.tubeZ(0.05, 0.2, [-0.3, 1.3, 0.9], dk, S.blued, { seg: 8 });
      m.bone = B.head;
      m.box(0.42, 0.34, 0.4, [0, 1.9, 0], dk, S.paint, { bevel: 0.05 });
      m.box(0.34, 0.07, 0.04, [0, 1.92, 0.21], A, S.glow);
      m.box(0.46, 0.06, 0.3, [0, 2.08, -0.02], s, S.paint, { bevel: 0.02 });
      // shield emitter frame on the left arm: the hex shield projects at (0, 1.25, 0.95)
      m.bone = B.shield;
      m.box(0.1, 2.0, 0.08, [0, 1.25, 0.86], dk, S.darkSteel, { bevel: 0.02 });
      m.box(1.75, 0.1, 0.08, [0, 1.25, 0.86], dk, S.darkSteel, { bevel: 0.02 });
      m.box(0.3, 0.3, 0.12, [0, 1.25, 0.84], s, S.gunmetal, { bevel: 0.03 });
      m.cyl(0.09, 0.03, [0, 1.25, 0.905], A, S.glow, { rot: [PI / 2, 0, 0], seg: 10 });
      for (const [x, y] of [
        [0, 2.22],
        [0, 0.28],
        [0.86, 1.25],
        [-0.86, 1.25],
      ] as const)
        m.sphere(0.05, [x, y, 0.88], A, S.glowSoft, { low: true });
      m.box(0.16, 0.16, 0.5, [0.32, 1.25, 0.6], s, S.paint, { bevel: 0.03 });
    },
    animate(b, p) {
      walkLegs(b, p, 0.4);
      idle(b.torso, p, 0.8);
      const { ph, pr } = tel(p);
      b.shield.position.z += ph === PH_WIND ? -0.35 * pr : 0; // shield pulls back before the bash
    },
  });
}

// ---------------------------------------------------------------- CHARGER (bull)
function charger(A: string): RobotKind {
  const r = "#6a2a22";
  const dk = "#3a1a16";
  const mt = "#8a7a70";
  return defineRobot({
    name: "charger",
    stride: 1.8,
    bones: [
      { name: "body", at: [0, 1.0, 0] },
      { name: "head", parent: "body", at: [0, 1.05, 0.7] },
      { name: "fl", parent: "body", at: [0.38, 0.62, 0.5] },
      { name: "fr", parent: "body", at: [-0.38, 0.62, 0.5] },
      { name: "bl", parent: "body", at: [0.38, 0.62, -0.5] },
      { name: "br", parent: "body", at: [-0.38, 0.62, -0.5] },
    ],
    build(m, B) {
      m.bone = B.body;
      m.box(1.0, 0.8, 1.45, [0, 1.02, 0], r, S.paint, { bevel: 0.1 });
      m.box(0.82, 0.42, 0.72, [0, 1.52, -0.1], r, S.paint, { bevel: 0.08 });
      m.box(0.9, 0.05, 1.15, [0, 1.44, 0.05], A, S.glowSoft);
      m.box(0.9, 0.3, 0.1, [0, 1.05, -0.74], dk, S.darkSteel, { bevel: 0.03 });
      m.both(() => {
        m.cyl(0.08, 0.42, [0.25, 1.72, -0.55], mt, S.brushed, { rb: 0.1, seg: 10 });
        m.cyl(0.06, 0.03, [0.25, 1.93, -0.55], A, S.glowSoft, { seg: 10 });
        for (let k = 0; k < 4; k++)
          m.box(0.03, 0.4, 0.06, [0.51, 1.02, -0.45 + k * 0.3], dk, S.darkSteel, { lod: 1 });
        m.cable(
          [
            [0.3, 1.5, -0.4],
            [0.45, 1.3, -0.2],
            [0.5, 1.1, 0.1],
          ],
          0.025,
          CABLE,
        );
      });
      m.bolts([-0.4, 1.3, 0.73], [0.4, 1.3, 0.73], 5, 0.02, STEEL);
      // head: armoured ram with the two eyes and the horns
      m.bone = B.head;
      m.box(0.6, 0.55, 0.55, [0, 0.95, 0.95], dk, S.darkSteel, { bevel: 0.07 });
      m.box(0.72, 0.36, 0.12, [0, 0.95, 1.24], mt, S.brushed, { bevel: 0.04 });
      for (let k = -2; k <= 2; k++)
        m.box(0.05, 0.3, 0.04, [k * 0.13, 0.95, 1.31], dk, S.darkSteel, { lod: 1 });
      m.both(() => {
        m.box(0.1, 0.06, 0.04, [0.18, 1.08, 1.23], A, S.glow);
        m.cone(0.08, 0.6, [0.32, 1.18, 1.38], "#e8dcc8", S.enamel, {
          rot: [PI / 2, 0, -0.35],
          seg: 8,
        });
        m.cyl(0.1, 0.1, [0.3, 1.18, 1.12], mt, S.brushed, { rot: [PI / 2, 0, 0], seg: 8 });
      });
      // pillar legs with hooves
      for (const n of QUAD) {
        const sx = n === "fl" || n === "bl" ? 1 : -1;
        const sz = n === "fl" || n === "fr" ? 1 : -1;
        m.bone = B[n];
        m.push([sx * 0.38, 0.62, sz * 0.5]);
        m.cyl(0.12, 0.3, [0, 0, 0], dk, S.gunmetal, { rot: [0, 0, PI / 2], seg: 10 });
        m.box(0.26, 0.5, 0.3, [0, -0.27, 0], dk, S.darkSteel, { bevel: 0.05 });
        m.cyl(0.025, 0.4, [sx * 0.14, -0.28, 0.1], STEEL, S.chrome, { seg: 6, lod: 1 });
        m.box(0.3, 0.12, 0.36, [0, -0.56, 0.02], mt, S.darkSteel, { bevel: 0.03 });
        m.pop();
      }
    },
    animate(b, p) {
      const a = p.move;
      for (const n of QUAD) {
        const off = n === "fl" || n === "br" ? 0 : PI;
        b[n].rotation.x = Math.sin(p.phase + off) * 0.55 * a;
      }
      b.body.position.y += Math.abs(Math.sin(p.phase)) * 0.06 * a;
      b.body.rotation.x = Math.sin(p.phase * 2) * 0.03 * a;
      const { ph } = tel(p);
      // head lowers into the charge, tosses while stunned
      b.head.rotation.x =
        ph === PH_WIND || ph === PH_ACT
          ? 0.22
          : ph === PH_AFTER
            ? Math.sin(p.t * 7) * 0.2
            : Math.sin(p.t * 1.5 + p.seed * 6) * 0.05;
      b.head.rotation.z = ph === PH_AFTER ? Math.sin(p.t * 5) * 0.2 : 0;
    },
  });
}

// ---------------------------------------------------------------- MEDIC drone
function medic(A: string): RobotKind {
  const w = "#e8ecef";
  const g = "#9aa4ad";
  return defineRobot({
    name: "medic",
    bones: [
      { name: "body", at: [0, 0, 0] },
      { name: "rotor", parent: "body", at: [0, 0, 0] },
      { name: "arm", parent: "body", at: [0.3, -0.12, 0] },
    ],
    build(m, B) {
      m.bone = B.body;
      m.cyl(0.47, 0.18, [0, 0, 0], w, S.enamel, { rb: 0.42, seg: 16 });
      m.torus(0.46, 0.03, [0, -0.02, 0], g, S.brushed, { rot: [PI / 2, 0, 0], seg: 20 });
      m.dome(0.3, [0, 0.09, 0], "#cfd8de", S.glass, { s: [1, 0.6, 1] });
      m.cyl(0.1, 0.03, [0, 0.27, 0], g, S.steel, { seg: 10 });
      m.box(0.3, 0.02, 0.09, [0, 0.29, 0], A, S.glow);
      m.box(0.09, 0.02, 0.3, [0, 0.29, 0], A, S.glow);
      // red-cross panel up front (in the accent green), sensor bar and vents
      m.box(0.34, 0.14, 0.06, [0, 0, 0.44], g, S.steel, { bevel: 0.015 });
      m.box(0.26, 0.07, 0.02, [0, 0, 0.475], A, S.glow);
      m.box(0.07, 0.26, 0.02, [0, 0, 0.475], A, S.glow);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * PI * 2 + PI / 6;
        m.box(
          0.08,
          0.05,
          0.03,
          [Math.sin(a) * 0.43, 0.05, Math.cos(a) * 0.43],
          "#3a4046",
          S.darkSteel,
          { rot: [0, a, 0], lod: 1 },
        );
      }
      // emitter underneath
      m.cone(0.16, 0.22, [0, -0.2, 0], g, S.steel, { rot: [PI, 0, 0], seg: 12 });
      m.sphere(0.07, [0, -0.36, 0], A, S.glow, { low: true });
      // landing struts
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * PI * 2;
        m.box(0.03, 0.26, 0.03, [Math.sin(a) * 0.3, -0.2, Math.cos(a) * 0.3], g, S.steel, {
          rot: [Math.cos(a) * 0.4, 0, -Math.sin(a) * 0.4],
        });
      }
      // rotor ring (spins)
      m.bone = B.rotor;
      m.torus(0.62, 0.03, [0, 0.02, 0], g, S.brushed, { rot: [PI / 2, 0, 0], seg: 24 });
      for (let i = 0; i < 3; i++) {
        const a = (i * PI * 2) / 3;
        m.box(
          0.08,
          0.015,
          0.6,
          [Math.sin(a) * 0.32, 0.03, Math.cos(a) * 0.32],
          "#c8d0d6",
          S.brushed,
          { rot: [0.12, a, 0] },
        );
      }
      // dangling tool arm
      m.bone = B.arm;
      m.push([0.3, -0.12, 0]);
      m.box(0.04, 0.26, 0.04, [0.04, -0.12, 0], g, S.steel, { rot: [0, 0, 0.4] });
      m.box(0.06, 0.06, 0.1, [0.1, -0.26, 0], "#3a4046", S.darkSteel);
      m.sphere(0.025, [0.1, -0.3, 0.04], A, S.glowSoft, { low: true, lod: 1 });
      m.pop();
    },
    animate(b, p) {
      b.rotor.rotation.y = p.t * 9;
      b.body.rotation.x = 0.2 * p.move;
      b.body.rotation.z = Math.sin(p.t * 1.3 + p.seed * 5) * 0.06;
      const { ph } = tel(p);
      b.arm.rotation.z =
        ph === PH_ACT ? -0.6 + Math.sin(p.t * 20) * 0.05 : Math.sin(p.t * 2 + p.seed) * 0.15;
    },
  });
}

// ---------------------------------------------------------------- HORNET drone
function hornet(A: string): RobotKind {
  const y = "#ffd21a";
  const k = "#1a1a1a";
  return defineRobot({
    name: "hornet",
    bones: [
      { name: "body", at: [0, 0, 0] },
      { name: "tail", parent: "body", at: [0, 0, -0.1] },
    ],
    build(m, B) {
      m.bone = B.body;
      m.sphere(0.14, [0, 0, 0.06], k, S.gunmetal, { s: [1, 0.9, 1.1] });
      m.box(0.14, 0.05, 0.16, [0, 0.12, 0.06], y, S.enamel, { bevel: 0.015 });
      m.sphere(0.1, [0, 0.01, 0.25], k, S.gunmetal);
      m.sphere(0.035, [0.05, 0.03, 0.33], A, S.glow, { low: true });
      m.sphere(0.035, [-0.05, 0.03, 0.33], A, S.glow, { low: true });
      m.both(() => {
        m.box(0.012, 0.012, 0.1, [0.03, -0.05, 0.36], STEEL, S.steel, { rot: [0.3, 0.2, 0] });
        // three little legs tucked under
        for (let i = 0; i < 3; i++)
          m.box(0.012, 0.12, 0.012, [0.09, -0.12, 0.12 - i * 0.07], k, S.darkSteel, {
            rot: [0.3, 0, 0.5],
            lod: 1,
          });
      });
      m.cyl(0.03, 0.05, [0, 0.13, 0.06], STEEL, S.steel, { seg: 8 });
      // abdomen: banded yellow and black, a steel stinger
      m.bone = B.tail;
      m.sphere(0.18, [0, -0.02, -0.26], y, S.enamel, { s: [1, 1, 1.5] });
      m.torus(0.172, 0.018, [0, -0.02, -0.2], k, S.darkSteel, { seg: 14 });
      m.torus(0.16, 0.018, [0, -0.02, -0.34], k, S.darkSteel, { seg: 14 });
      m.torus(0.12, 0.016, [0, -0.02, -0.46], k, S.darkSteel, { seg: 12 });
      m.cone(0.05, 0.22, [0, -0.02, -0.58], STEEL, S.chrome, { rot: [-PI / 2, 0, 0], seg: 8 });
    },
    animate(b, p) {
      const { ph, pr } = tel(p);
      // the abdomen curls under to aim the stinger through the buzz and the dive
      b.tail.rotation.x =
        ph === PH_WIND ? 0.6 * pr : ph === PH_ACT ? 0.7 : Math.sin(p.t * 4 + p.seed * 7) * 0.08;
      b.body.rotation.x = 0.25 * p.move;
    },
  });
}

// ---------------------------------------------------------------- GATLING
function gatling(A: string): RobotKind {
  const i = "#5a554f";
  const dk = "#34302b";
  return defineRobot({
    name: "gatling",
    stride: 1.8,
    wear: 0.85,
    bones: [
      { name: "hip", at: [0, 0.75, 0] },
      { name: "torso", parent: "hip", at: [0, 0.9, 0] },
      { name: "head", parent: "torso", at: [0, 1.75, 0.1] },
      { name: "barrels", parent: "torso", at: [0.72, 1.3, 0.55] },
      { name: "legL", parent: "hip", at: [0.35, 0.75, 0] },
      { name: "shinL", parent: "legL", at: [0.35, 0.4, 0] },
      { name: "legR", parent: "hip", at: [-0.35, 0.75, 0] },
      { name: "shinR", parent: "legR", at: [-0.35, 0.4, 0] },
    ],
    build(m, B) {
      m.bone = B.hip;
      m.box(0.9, 0.24, 0.55, [0, 0.77, 0], dk, S.darkSteel, { bevel: 0.04 });
      leg(m, B.legL, B.shinL, 0.35, 0.75, 0.4, { col: i, dark: dk, w: 0.32, foot: 0.5 });
      leg(m, B.legR, B.shinR, -0.35, 0.75, 0.4, { col: i, dark: dk, w: 0.32, foot: 0.5 });
      m.bone = B.torso;
      m.box(1.22, 0.95, 0.92, [0, 1.25, 0], i, S.paint, { bevel: 0.09 });
      m.box(0.9, 0.08, 0.08, [0, 1.5, 0.48], A, S.glowSoft);
      m.box(0.9, 0.3, 0.1, [0, 1.2, 0.47], shade(i, 0.8), S.paint, { bevel: 0.03 });
      m.bolts([-0.5, 1.68, 0.47], [0.5, 1.68, 0.47], 6, 0.02, STEEL);
      // ammo drum on the back, glowing seam, belt feeding the gun
      m.cyl(0.38, 0.88, [0, 1.35, -0.62], dk, S.darkSteel, { rot: [0, 0, PI / 2], seg: 14 });
      m.cyl(0.39, 0.06, [0, 1.35, -0.62], A, S.glowSoft, { rot: [0, 0, PI / 2], seg: 14 });
      m.both(() =>
        m.cyl(0.2, 0.04, [0.46, 1.35, -0.62], STEEL, S.steel, { rot: [0, 0, PI / 2], seg: 10 }),
      );
      m.cable(
        [
          [0.35, 1.55, -0.6],
          [0.7, 1.6, -0.2],
          [0.75, 1.42, 0.15],
        ],
        0.05,
        "#6a5a2a",
        S.brass,
      );
      // left arm (a claw), right shoulder mount
      m.box(0.25, 0.7, 0.28, [-0.75, 1.1, 0.1], i, S.paint, { bevel: 0.04 });
      m.box(0.3, 0.2, 0.34, [-0.75, 0.7, 0.14], dk, S.darkSteel, { bevel: 0.03 });
      m.box(0.35, 0.35, 0.5, [0.72, 1.3, 0.25], dk, S.gunmetal, { bevel: 0.05 });
      m.cyl(0.14, 0.12, [0.72, 1.3, 0.52], STEEL, S.steel, { rot: [PI / 2, 0, 0], seg: 12 });
      m.bone = B.head;
      m.box(0.45, 0.3, 0.45, [0, 1.9, 0.1], dk, S.paint, { bevel: 0.05 });
      m.box(0.36, 0.07, 0.04, [0, 1.9, 0.34], A, S.glow);
      m.cyl(0.02, 0.35, [-0.15, 2.15, 0], STEEL, S.steel, { seg: 5, lod: 1 });
      // the barrel cluster (spins about z)
      m.bone = B.barrels;
      m.push([0.72, 1.3, 0.55]);
      for (let k = 0; k < 6; k++) {
        const an = (k / 6) * PI * 2;
        m.tubeZ(0.045, 0.76, [Math.cos(an) * 0.12, Math.sin(an) * 0.12, 0.38], "#2e2b28", S.blued, {
          seg: 8,
        });
      }
      m.tubeZ(0.19, 0.06, [0, 0, 0.2], dk, S.gunmetal, { seg: 12 });
      m.torus(0.16, 0.025, [0, 0, 0.6], "#3a3632", S.gunmetal, { seg: 14 });
      m.tubeZ(0.04, 0.8, [0, 0, 0.4], STEEL, S.steel, { seg: 6 });
      m.pop();
    },
    animate(b, p) {
      walkLegs(b, p, 0.38);
      idle(b.torso, p, 0.6);
      const { ph } = tel(p);
      if (ph === PH_ACT) b.torso.position.z += Math.sin(p.t * 70) * 0.012; // firing judder
    },
  });
}

// ---------------------------------------------------------------- ROCKETEER
function rocketeer(A: string): RobotKind {
  const w = "#d8d4c8";
  const g = "#8a8680";
  const dk = "#3a3834";
  return defineRobot({
    name: "rocketeer",
    stride: 1.4,
    bones: [
      { name: "hip", at: [0, 0.7, 0] },
      { name: "torso", parent: "hip", at: [0, 0.8, 0] },
      { name: "head", parent: "torso", at: [0, 1.5, 0] },
      { name: "legL", parent: "hip", at: [0.18, 0.7, 0] },
      { name: "shinL", parent: "legL", at: [0.18, 0.36, 0] },
      { name: "legR", parent: "hip", at: [-0.18, 0.7, 0] },
      { name: "shinR", parent: "legR", at: [-0.18, 0.36, 0] },
    ],
    build(m, B) {
      m.bone = B.hip;
      m.box(0.46, 0.18, 0.3, [0, 0.72, 0], dk, S.darkSteel, { bevel: 0.03 });
      leg(m, B.legL, B.shinL, 0.18, 0.7, 0.36, { col: w, dark: dk, w: 0.17 });
      leg(m, B.legR, B.shinR, -0.18, 0.7, 0.36, { col: w, dark: dk, w: 0.17 });
      m.bone = B.torso;
      m.box(0.6, 0.68, 0.4, [0, 1.1, 0], w, S.enamel, { bevel: 0.06 });
      m.box(0.44, 0.26, 0.08, [0, 1.18, 0.21], g, S.paint, { bevel: 0.02 });
      m.box(0.44, 0.04, 0.02, [0, 1.02, 0.215], A, S.glowSoft);
      m.box(0.34, 0.44, 0.16, [0, 1.12, -0.27], dk, S.darkSteel, { bevel: 0.03 });
      // left shoulder: a four-tube rocket pod with lit tips
      m.box(0.5, 0.45, 0.5, [-0.5, 1.6, 0], g, S.paint, { bevel: 0.05 });
      for (const ox of [-0.11, 0.11])
        for (const oy of [-0.11, 0.11]) {
          m.tubeZ(0.08, 0.06, [-0.5 + ox, 1.6 + oy, 0.24], dk, S.darkSteel, { seg: 10 });
          m.cyl(0.065, 0.04, [-0.5 + ox, 1.6 + oy, 0.26], A, S.glow, {
            rot: [PI / 2, 0, 0],
            seg: 10,
          });
        }
      m.box(0.12, 0.25, 0.14, [-0.36, 1.3, 0], dk, S.darkSteel, { bevel: 0.02 });
      // right shoulder: the launcher tube, muzzle at (0.45, 1.62, 0.65)
      m.tubeZ(0.13, 1.1, [0.45, 1.62, 0.1], dk, S.gunmetal, { seg: 14 });
      m.tubeZ(0.15, 0.1, [0.45, 1.62, 0.6], g, S.steel, { seg: 14 });
      m.tubeZ(0.15, 0.08, [0.45, 1.62, -0.42], g, S.steel, { seg: 14 });
      m.box(0.08, 0.1, 0.2, [0.45, 1.8, 0.2], dk, S.darkSteel, { lod: 1 });
      m.cyl(0.03, 0.03, [0.45, 1.8, 0.31], A, S.lens, { rot: [PI / 2, 0, 0], seg: 8, lod: 1 });
      m.both(() => {
        m.box(0.12, 0.5, 0.14, [0.38, 1.05, 0.05], g, S.paint, { bevel: 0.03 });
        m.sphere(0.07, [0.38, 1.33, 0.05], dk, S.gunmetal, { low: true });
      });
      m.bone = B.head;
      m.box(0.3, 0.3, 0.3, [0, 1.62, 0], w, S.enamel, { bevel: 0.05 });
      m.box(0.24, 0.06, 0.04, [0, 1.64, 0.16], A, S.glow);
      m.box(0.26, 0.1, 0.04, [0, 1.64, 0.145], dk, S.darkSteel);
      m.cyl(0.012, 0.25, [0.1, 1.86, -0.08], g, S.steel, { seg: 5, lod: 1 });
    },
    animate(b, p) {
      walkLegs(b, p, 0.55);
      const { ph, pr } = tel(p);
      b.torso.rotation.x = ph === PH_WIND ? -0.08 * pr : 0; // braces back to aim
      if (ph === 0) idle(b.torso, p, 0.8);
      b.head.rotation.y = ph === 0 ? Math.sin(p.t * 1.1 + p.seed * 4) * 0.3 : 0;
    },
  });
}

// ---------------------------------------------------------------- CLOAKER
function cloaker(A: string): RobotKind {
  const k = "#15171c";
  const g = "#2a2e38";
  return defineRobot({
    name: "cloaker",
    stride: 1.3,
    bones: [
      { name: "hip", at: [0, 0.7, 0] },
      { name: "torso", parent: "hip", at: [0, 0.8, 0] },
      { name: "head", parent: "torso", at: [0, 1.4, 0.2] },
      { name: "armL", parent: "torso", at: [0.28, 1.3, 0.12] },
      { name: "armR", parent: "torso", at: [-0.28, 1.3, 0.12] },
      { name: "legL", parent: "hip", at: [0.15, 0.7, 0] },
      { name: "shinL", parent: "legL", at: [0.15, 0.36, 0] },
      { name: "legR", parent: "hip", at: [-0.15, 0.7, 0] },
      { name: "shinR", parent: "legR", at: [-0.15, 0.36, 0] },
    ],
    build(m, B) {
      m.bone = B.hip;
      m.box(0.36, 0.14, 0.24, [0, 0.72, 0], g, S.darkSteel, { bevel: 0.03 });
      leg(m, B.legL, B.shinL, 0.15, 0.7, 0.36, { col: k, dark: g, w: 0.11, foot: 0.26 });
      leg(m, B.legR, B.shinR, -0.15, 0.7, 0.36, { col: k, dark: g, w: 0.11, foot: 0.26 });
      // hunched, forward-leaning stalker frame
      m.bone = B.torso;
      m.push([0, 1.1, 0.05], [0.35, 0, 0]);
      m.box(0.4, 0.6, 0.26, [0, 0, 0], k, S.gunmetal, { bevel: 0.05 });
      m.box(0.3, 0.34, 0.06, [0, 0.05, 0.15], g, S.gunmetal, { bevel: 0.02 });
      m.box(0.04, 0.4, 0.02, [0, 0.05, 0.185], A, S.glowSoft);
      for (let i = 0; i < 4; i++)
        m.box(0.3 - i * 0.04, 0.04, 0.1, [0, -0.2 + i * 0.1, -0.16], g, S.darkSteel, { lod: 1 });
      m.pop();
      // cloak emitter fins on the back
      m.both(() =>
        m.box(0.03, 0.4, 0.2, [0.14, 1.3, -0.2], g, S.darkSteel, { rot: [0.4, 0, 0.3] }),
      );
      m.bone = B.head;
      m.box(0.22, 0.2, 0.3, [0, 1.5, 0.22], k, S.gunmetal, { bevel: 0.04 });
      m.box(0.05, 0.02, 0.03, [0.06, 1.52, 0.37], A, S.glow);
      m.box(0.05, 0.02, 0.03, [-0.06, 1.52, 0.37], A, S.glow);
      m.box(0.16, 0.04, 0.04, [0, 1.46, 0.36], g, S.darkSteel);
      // arms with long glowing blades: tips forward and low, (+-0.33, 0.78, 0.6)
      for (const [nm, sx] of [
        ["armL", 1],
        ["armR", -1],
      ] as const) {
        m.bone = B[nm];
        m.push([sx * 0.28, 1.3, 0.12]);
        m.sphere(0.06, [0, 0, 0], g, S.gunmetal, { low: true });
        m.box(0.08, 0.66, 0.08, [sx * 0.02, -0.3, 0.1], g, S.darkSteel, {
          rot: [-0.5, 0, 0],
          bevel: 0.015,
        });
        m.box(0.1, 0.1, 0.12, [sx * 0.04, -0.54, 0.28], k, S.gunmetal, { bevel: 0.02 });
        m.box(0.03, 0.06, 0.75, [sx * 0.05, -0.52, 0.48], A, S.glow, { rot: [0.25, 0, 0] });
        m.box(0.012, 0.08, 0.75, [sx * 0.05, -0.52, 0.48], STEEL, S.chrome, { rot: [0.25, 0, 0] });
        m.pop();
      }
    },
    animate(b, p) {
      walkLegs(b, p, 0.6);
      const { ph, pr } = tel(p);
      // the right blade rears back through the wind-up; the arms sway while it stalks
      b.armL.rotation.x = ph === PH_WIND ? -0.4 * pr : Math.sin(p.phase) * 0.2 * p.move;
      b.armR.rotation.x = -Math.sin(p.phase) * 0.2 * p.move;
      b.head.rotation.y = Math.sin(p.t * 0.8 + p.seed * 3) * 0.3 * (1 - p.move);
      idle(b.torso, p, 0.8);
    },
  });
}

const cache = new Map<NewKind, RobotKind>();
export function newRobot(kind: NewKind): RobotKind {
  let k = cache.get(kind);
  if (!k) {
    const A = NEW_ACCENT[kind];
    const make = {
      sniper,
      flanker,
      grenadier,
      bulwark,
      charger,
      medic,
      hornet,
      gatling,
      rocketeer,
      cloaker,
    }[kind];
    k = make(A);
    cache.set(kind, k);
  }
  return k;
}

/** feed the synced telegraph state (`vis`) to the animations */
export const visInputs: RobotInputs = (d) => {
  const v = d.vis ?? 0;
  const ph = visPhase(v);
  return { wind: ph === PH_WIND ? visProg(v) : ph === PH_ACT ? 1 : 0, aux: v };
};
