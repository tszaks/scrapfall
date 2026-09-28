// The four live maps' special enemies, rebuilt as detailed scrap-built machines:
//   ROOFTOP RUNNER (Vice Heights, "leaper"): a spring-legged parkour bot with flywheel hips.
//   RIDGE RAIDER (Whiteout Pass, "skier"): an armoured ski-patrol robot carving on skis.
//   TIDE CRAWLER (Pacific Pier, "crawler"): a six-legged crab mech with snapping claws.
//   DESPERADO (Dry Gulch, "desperado"): a poncho-and-sombrero gunslinger with twin revolvers.
// Colours come from theme.special (body / accent / glow), so each keeps its old read.
import * as THREE from "three";

import type { Theme } from "../../themes";
import { SURF, type Model } from "../kit";
import { defineRobot, idle, walkLegs, type RobotKind } from "../rig";

const S = SURF;
const PI = Math.PI;
const STEEL = "#8a8f96";
const DARK = "#23262b";

function shade(hex: string, k: number) {
  const c = new THREE.Color(hex);
  if (k < 1) c.multiplyScalar(k);
  else c.lerp(new THREE.Color(1, 1, 1), k - 1);
  return c;
}

type Sp = Theme["special"];
export type ArtSpecialType = "leaper" | "skier" | "crawler" | "desperado";
export const ART_SPECIALS = new Set<string>(["leaper", "skier", "crawler", "desperado"]);

// ---------------------------------------------------------------- ROOFTOP RUNNER
function leaper(sp: Sp): RobotKind {
  const body = sp.body;
  const acc = sp.accent;
  const glow = sp.glow;
  return defineRobot({
    name: "leaper",
    stride: 1.5,
    wear: 0.7,
    bones: [
      { name: "lift", at: [0, 0, 0] },
      { name: "hip", parent: "lift", at: [0, 0.95, 0] },
      { name: "torso", parent: "hip", at: [0, 1.05, 0] },
      { name: "head", parent: "torso", at: [0, 1.5, 0.08] },
      { name: "armL", parent: "torso", at: [0.46, 1.38, 0] },
      { name: "armR", parent: "torso", at: [-0.46, 1.38, 0] },
      { name: "legL", parent: "hip", at: [0.3, 0.95, 0] },
      { name: "shinL", parent: "legL", at: [0.32, 0.52, 0.16] },
      { name: "legR", parent: "hip", at: [-0.3, 0.95, 0] },
      { name: "shinR", parent: "legR", at: [-0.32, 0.52, 0.16] },
    ],
    build(m: Model, B) {
      // pelvis with the two big flywheel hubs (the old model's side discs)
      m.bone = B.hip;
      m.box(0.5, 0.26, 0.42, [0, 0.98, -0.02], DARK, S.darkSteel, { bevel: 0.04 });
      m.tubeX(0.08, 0.72, [0, 0.95, 0], STEEL, S.steel, { seg: 10 });
      m.both(() => {
        m.cyl(0.26, 0.06, [0.42, 0.95, 0], acc, S.enamel, { rot: [0, 0, PI / 2], seg: 16 });
        m.cyl(0.18, 0.08, [0.44, 0.95, 0], DARK, S.gunmetal, {
          rot: [0, 0, PI / 2],
          seg: 10,
          lod: 1,
        });
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * PI * 2;
          m.box(
            0.02,
            0.05,
            0.3,
            [0.475, 0.95 + Math.sin(a) * 0.06, Math.cos(a) * 0.06],
            STEEL,
            S.steel,
            { rot: [a, 0, 0], lod: 1 },
          );
        }
        m.cyl(0.05, 0.1, [0.47, 0.95, 0], glow, S.glowSoft, { rot: [0, 0, PI / 2], seg: 10 });
      });
      // torso: a compact armoured drum with pink panels and a spine of vents
      m.bone = B.torso;
      m.box(0.72, 0.56, 0.56, [0, 1.25, 0], body, S.paint, { bevel: 0.07 });
      m.box(0.56, 0.3, 0.1, [0, 1.3, 0.3], acc, S.enamel, { bevel: 0.03 });
      m.box(0.6, 0.12, 0.5, [0, 1.56, -0.02], shade(body, 1.25), S.paint, { bevel: 0.03 });
      m.box(0.3, 0.42, 0.14, [0, 1.22, -0.33], DARK, S.darkSteel, { bevel: 0.03 });
      for (let k = 0; k < 4; k++)
        m.box(0.22, 0.025, 0.03, [0, 1.08 + k * 0.08, -0.41], glow, S.glowSoft);
      m.bolts([-0.24, 1.44, 0.29], [0.24, 1.44, 0.29], 4, 0.016, STEEL);
      m.both(() =>
        m.cable(
          [
            [0.2, 1.4, -0.3],
            [0.36, 1.2, -0.25],
            [0.3, 1.0, -0.12],
          ],
          0.02,
          "#151515",
        ),
      );
      // head: a wide visor block with one cyan eye (the old model's eye)
      m.bone = B.head;
      m.box(0.46, 0.24, 0.36, [0, 1.62, 0.1], body, S.paint, { bevel: 0.05 });
      m.box(0.4, 0.1, 0.06, [0, 1.63, 0.29], DARK, S.darkSteel, { bevel: 0.015 });
      m.sphere(0.07, [0, 1.63, 0.31], glow, S.glow, { s: [1, 1, 0.5] });
      m.box(0.06, 0.1, 0.2, [0, 1.79, 0.05], acc, S.enamel, { bevel: 0.02 });
      m.cyl(0.012, 0.3, [0.16, 1.85, -0.02], STEEL, S.steel, {
        rot: [-0.3, 0, -0.15],
        seg: 5,
        lod: 1,
      });
      // arms: short piston arms with grabber hands
      for (const [arm, sx] of [
        ["armL", 1],
        ["armR", -1],
      ] as const) {
        m.bone = B[arm];
        m.push([sx * 0.46, 1.38, 0]);
        m.sphere(0.1, [0, 0, 0], DARK, S.gunmetal, { low: true, lod: 1 });
        m.box(0.12, 0.34, 0.12, [sx * 0.04, -0.18, 0.02], acc, S.enamel, { bevel: 0.025 });
        m.cyl(0.02, 0.3, [sx * 0.04, -0.2, 0.09], STEEL, S.chrome, { seg: 6, lod: 1 });
        m.box(0.1, 0.1, 0.16, [sx * 0.04, -0.42, 0.06], DARK, S.darkSteel, { bevel: 0.02 });
        m.pop();
      }
      // spring legs: thigh, a coil-sprung reverse shin, long flat feet
      for (const [leg, shin, sx] of [
        ["legL", "shinL", 1],
        ["legR", "shinR", -1],
      ] as const) {
        m.bone = B[leg];
        m.push([sx * 0.32, 0.95, 0]);
        m.box(0.14, 0.46, 0.16, [0, -0.22, 0.08], body, S.paint, {
          rot: [0.35, 0, 0],
          bevel: 0.03,
        });
        m.box(0.1, 0.3, 0.04, [0, -0.2, 0.17], acc, S.enamel, { rot: [0.35, 0, 0], bevel: 0.01 });
        m.pop();
        m.bone = B[shin];
        m.push([sx * 0.32, 0.52, 0.16]);
        m.sphere(0.08, [0, 0, 0], STEEL, S.steel, { low: true, lod: 1 });
        m.cyl(0.035, 0.42, [0, -0.2, -0.08], STEEL, S.chrome, { rot: [0.4, 0, 0], seg: 8 });
        for (let k = 0; k < 5; k++)
          m.torus(0.075, 0.014, [0, -0.08 - k * 0.07, -0.03 - k * 0.028], acc, S.brushed, {
            rot: [PI / 2 + 0.4, 0, 0],
            seg: 10,
            lod: k % 2 ? 1 : 0,
          });
        m.box(0.14, 0.06, 0.4, [0, -0.44, -0.08], DARK, S.darkSteel, { bevel: 0.02 });
        m.box(0.16, 0.03, 0.12, [0, -0.46, 0.12], acc, S.rubber);
        m.pop();
      }
    },
    animate(b, p) {
      const j = p.wind; // leap (smoothed synced aux)
      walkLegs(b, p, 0.6 * (1 - j));
      // idle: bouncing on its springs; airborne: tucked legs, arms thrown up
      b.lift.position.y =
        j * 1.4 + (1 - j) * Math.abs(Math.sin(p.t * 5 + p.seed * 3)) * 0.15 * (1 - p.move * 0.6);
      b.legL.rotation.x += -0.9 * j;
      b.legR.rotation.x += -0.9 * j;
      b.shinL.rotation.x += 1.5 * j;
      b.shinR.rotation.x += 1.5 * j;
      b.torso.rotation.x = 0.15 * p.move + 0.3 * j;
      b.armL.rotation.x = -Math.sin(p.phase) * 0.5 * p.move - 2.4 * j;
      b.armR.rotation.x = Math.sin(p.phase) * 0.5 * p.move - 2.4 * j;
      b.armL.rotation.z = 0.3 * j;
      b.armR.rotation.z = -0.3 * j;
      b.head.rotation.y = Math.sin(p.t * 1.4 + p.seed * 5) * 0.3 * (1 - p.move);
      idle(b.torso, p);
    },
  });
}

// ---------------------------------------------------------------- RIDGE RAIDER
function skier(sp: Sp): RobotKind {
  const white = sp.body;
  const blue = sp.accent;
  const glow = sp.glow;
  const dk = "#1e2430";
  return defineRobot({
    name: "skier",
    wear: 0.55,
    bones: [
      { name: "root", at: [0, 0, 0] },
      { name: "body", parent: "root", at: [0, 0.05, 0] },
      { name: "torso", parent: "body", at: [0, 0.8, 0.05] },
      { name: "head", parent: "torso", at: [0, 1.36, 0.18] },
      { name: "poles", parent: "torso", at: [0, 1.2, 0.18] },
    ],
    build(m, B) {
      // skis with upturned tips and bindings (stay flat on the snow)
      m.bone = B.root;
      m.both(() => {
        m.box(0.11, 0.035, 1.6, [0.17, 0.05, -0.05], blue, S.enamel, { bevel: 0.012 });
        m.box(0.11, 0.035, 0.22, [0.17, 0.1, 0.8], blue, S.enamel, {
          rot: [-0.55, 0, 0],
          bevel: 0.012,
        });
        m.box(0.012, 0.04, 1.5, [0.225, 0.05, -0.05], STEEL, S.chrome, { lod: 1 });
        m.box(0.13, 0.05, 0.26, [0.17, 0.09, 0], DARK, S.darkSteel, { bevel: 0.015 });
      });
      // crouched legs: armoured boots, forward-angled shins, knee joints, thighs
      m.bone = B.body;
      m.both(() => {
        m.box(0.17, 0.26, 0.32, [0.17, 0.22, 0.02], dk, S.polymer, { bevel: 0.04 });
        m.box(0.18, 0.06, 0.34, [0.17, 0.36, 0.02], blue, S.enamel, { bevel: 0.015 });
        m.box(0.15, 0.4, 0.17, [0.17, 0.52, 0.1], white, S.enamel, {
          rot: [0.5, 0, 0],
          bevel: 0.035,
        });
        m.sphere(0.085, [0.17, 0.68, 0.2], DARK, S.gunmetal, { low: true, lod: 1 });
        m.box(0.16, 0.36, 0.18, [0.17, 0.78, 0.07], white, S.enamel, {
          rot: [-0.9, 0, 0],
          bevel: 0.035,
        });
        m.cyl(0.02, 0.3, [0.26, 0.5, 0.06], STEEL, S.chrome, { rot: [0.5, 0, 0], seg: 6, lod: 1 });
      });
      m.box(0.4, 0.16, 0.26, [0, 0.86, -0.02], dk, S.darkSteel, { bevel: 0.03 });
      // torso: leaning forward, white camo armour with the blue stripe, a patrol backpack
      m.bone = B.torso;
      m.push([0, 1.05, 0.08], [0.35, 0, 0]);
      m.box(0.52, 0.62, 0.34, [0, 0, 0], white, S.enamel, { bevel: 0.06 });
      m.box(0.54, 0.09, 0.36, [0, -0.02, 0.005], blue, S.enamel, { bevel: 0.02 });
      m.box(0.36, 0.26, 0.06, [0, 0.14, 0.18], shade(white, 0.85), S.enamel, { bevel: 0.02 });
      m.box(0.36, 0.46, 0.18, [0, 0.02, -0.25], dk, S.polymer, { bevel: 0.04 });
      m.box(0.3, 0.1, 0.16, [0, 0.28, -0.25], blue, S.enamel, { bevel: 0.02 });
      m.cyl(0.04, 0.06, [0, 0.36, -0.28], glow, S.glow, { seg: 8 });
      m.bolts([-0.18, 0.22, 0.175], [0.18, 0.22, 0.175], 4, 0.013, STEEL);
      // ice picks strapped to the pack
      m.both(() => {
        m.cyl(0.015, 0.4, [0.12, 0.06, -0.36], "#6a4a2a", S.wood, {
          rot: [0.2, 0, 0.3],
          seg: 5,
          lod: 1,
        });
        m.box(0.14, 0.03, 0.03, [0.18, 0.24, -0.33], STEEL, S.steel, { rot: [0, 0, 0.3], lod: 1 });
      });
      m.both(() =>
        m.box(0.18, 0.14, 0.34, [0.3, 0.22, 0], white, S.enamel, {
          bevel: 0.04,
          rot: [0, 0, -0.2],
        }),
      );
      m.pop();
      // head: helmet dome, glowing goggles, chin guard
      m.bone = B.head;
      m.push([0, 1.5, 0.2]);
      m.sphere(0.2, [0, 0, 0], blue, S.enamel, { s: [1, 1.05, 1.1] });
      m.box(0.32, 0.12, 0.08, [0, 0, 0.17], DARK, S.darkSteel, { bevel: 0.02 });
      m.box(0.28, 0.07, 0.04, [0, 0, 0.21], glow, S.glow);
      m.box(0.22, 0.1, 0.12, [0, -0.15, 0.1], white, S.enamel, { bevel: 0.025 });
      m.box(0.04, 0.05, 0.24, [0, 0.19, -0.02], white, S.enamel, { bevel: 0.01 });
      m.pop();
      // arms and poles (they plant together)
      m.bone = B.poles;
      m.both(() => {
        m.push([0.34, 1.2, 0.18]);
        m.sphere(0.09, [0, 0, 0], white, S.enamel, { low: true, lod: 1 });
        m.box(0.11, 0.4, 0.11, [0, -0.15, 0.1], white, S.enamel, {
          rot: [0.6, 0, 0],
          bevel: 0.025,
        });
        m.box(0.12, 0.1, 0.13, [0, -0.32, 0.23], dk, S.polymer, { bevel: 0.02 });
        m.cyl(0.016, 1.25, [0, -0.55, 0.28], STEEL, S.brushed, { rot: [0.35, 0, 0], seg: 6 });
        m.torus(0.07, 0.013, [0, -1.1, 0.48], glow, S.glowSoft, { rot: [PI / 2, 0, 0], seg: 10 });
        m.pop();
      });
    },
    animate(b, p) {
      const t = p.t + p.seed * 10;
      b.body.rotation.z = Math.sin(t * 2.6) * 0.28;
      b.body.position.y += Math.abs(Math.sin(t * 2.6)) * 0.06;
      b.poles.rotation.x = -0.4 + Math.sin(t * 5.2) * 0.35 - p.wind * 0.8;
      b.torso.rotation.x = Math.sin(t * 5.2) * 0.05;
      b.head.rotation.z = -Math.sin(t * 2.6) * 0.15;
    },
  });
}

// ---------------------------------------------------------------- TIDE CRAWLER
function crawler(sp: Sp): RobotKind {
  const shell = sp.body;
  const acc = sp.accent;
  const glow = sp.glow;
  const legs = [
    ["l0", 1, 0.3],
    ["l1", 1, 0],
    ["l2", 1, -0.3],
    ["r0", -1, 0.3],
    ["r1", -1, 0],
    ["r2", -1, -0.3],
  ] as const;
  return defineRobot({
    name: "crawler",
    stride: 0.9,
    wear: 0.8,
    bones: [
      { name: "root", at: [0, 0, 0] },
      { name: "body", parent: "root", at: [0, 0.6, 0] },
      { name: "l0", parent: "body", at: [0.5, 0.55, 0.3] },
      { name: "l1", parent: "body", at: [0.55, 0.55, 0] },
      { name: "l2", parent: "body", at: [0.5, 0.55, -0.3] },
      { name: "r0", parent: "body", at: [-0.5, 0.55, 0.3] },
      { name: "r1", parent: "body", at: [-0.55, 0.55, 0] },
      { name: "r2", parent: "body", at: [-0.5, 0.55, -0.3] },
      { name: "clawL", parent: "body", at: [0.5, 0.6, 0.42] },
      { name: "clawR", parent: "body", at: [-0.5, 0.6, 0.42] },
      { name: "pinL", parent: "clawL", at: [0.58, 0.64, 0.9] },
      { name: "pinR", parent: "clawR", at: [-0.58, 0.64, 0.9] },
    ],
    build(m, B) {
      // the old model's ground ring, as a faint emissive hoop
      m.bone = B.root;
      m.torus(0.78, 0.018, [0, 0.05, 0], glow, S.glowSoft, { rot: [PI / 2, 0, 0], seg: 18 });
      // carapace: a riveted flattened dome with ridge plates and a skirt of armour scales
      m.bone = B.body;
      m.sphere(0.62, [0, 0.62, 0], shell, S.enamel, { s: [1.15, 0.42, 0.9] });
      m.sphere(0.55, [0, 0.56, 0], acc, S.darkSteel, { s: [1.1, 0.3, 0.85], low: true });
      for (const x of [-0.28, 0, 0.28])
        m.sphere(0.6, [x, 0.84, -0.05], shade(shell, 0.75), S.enamel, { s: [0.16, 0.08, 0.5] });
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * PI * 2;
        m.box(
          0.26,
          0.08,
          0.1,
          [Math.sin(a) * 0.66, 0.55, Math.cos(a) * 0.52],
          shade(shell, 0.85),
          S.enamel,
          { rot: [0.3 * Math.cos(a), a, 0], bevel: 0.02, lod: 1 },
        );
      }
      m.bolts([-0.4, 0.8, 0.2], [0.4, 0.8, 0.2], 5, 0.018, STEEL);
      // barnacle-crusted rust patches (scrap from the pier)
      m.sphere(0.07, [0.3, 0.8, -0.3], "#6a5a48", S.rust, { low: true, lod: 1 });
      m.sphere(0.05, [-0.36, 0.78, -0.22], "#6a5a48", S.rust, { low: true, lod: 1 });
      // face: a mouth grille that glows, eyestalks with lamp eyes
      m.box(0.44, 0.14, 0.12, [0, 0.5, 0.52], DARK, S.darkSteel, { bevel: 0.03 });
      for (let k = -2; k <= 2; k++)
        m.box(0.03, 0.08, 0.02, [k * 0.07, 0.5, 0.585], glow, S.glowSoft);
      m.both(() => {
        m.cyl(0.03, 0.26, [0.18, 0.99, 0.4], STEEL, S.steel, { seg: 6 });
        m.cyl(0.05, 0.06, [0.18, 1.1, 0.4], DARK, S.gunmetal, { seg: 10 });
        m.sphere(0.065, [0.18, 1.16, 0.41], glow, S.glow, { low: true });
      });
      // six legs: an upper strut rising out, a lower strut down to a pointed foot
      for (const [name, sd, z] of legs) {
        m.bone = B[name];
        m.push([sd * (z === 0 ? 0.55 : 0.5), 0.55, z], [0, sd * z * 0.9, 0]);
        m.sphere(0.07, [0, 0, 0], DARK, S.gunmetal, { low: true, lod: 1 });
        m.box(0.36, 0.07, 0.07, [sd * 0.16, 0.1, 0], acc, S.darkSteel, {
          rot: [0, 0, sd * 0.55],
          bevel: 0.015,
        });
        m.box(0.08, 0.48, 0.08, [sd * 0.36, -0.08, 0], shell, S.enamel, {
          rot: [0, 0, sd * 0.35],
          bevel: 0.02,
        });
        m.cone(0.04, 0.16, [sd * 0.44, -0.4, 0], STEEL, S.steel, {
          rot: [PI, 0, sd * -0.35],
          seg: 6,
        });
        m.pop();
      }
      // claws: an arm forward, the big pincer body and its fixed lower jaw
      for (const [claw, pin, sd] of [
        ["clawL", "pinL", 1],
        ["clawR", "pinR", -1],
      ] as const) {
        m.bone = B[claw];
        m.push([sd * 0.5, 0.6, 0.42], [0, sd * -0.5, 0]);
        m.sphere(0.09, [0, 0, 0], DARK, S.gunmetal, { low: true, lod: 1 });
        m.tubeZ(0.08, 0.36, [0, 0, 0.2], shell, S.enamel, { rb: 0.09, seg: 8 });
        m.sphere(0.2, [0, 0.02, 0.5], shell, S.enamel, { s: [0.9, 0.6, 1.2], low: true });
        m.box(0.1, 0.05, 0.26, [0, -0.06, 0.76], acc, S.darkSteel, {
          rot: [-0.35, 0, 0],
          bevel: 0.015,
        });
        m.pop();
        m.bone = B[pin];
        m.push([sd * 0.5, 0.6, 0.42], [0, sd * -0.5, 0]);
        m.box(0.1, 0.06, 0.3, [0, 0.1, 0.76], shell, S.enamel, { rot: [0.35, 0, 0], bevel: 0.02 });
        m.pop();
      }
    },
    animate(b, p) {
      // a jittery scuttle: tripod gait on the legs, the body buzzing on its springs
      const t = p.t + p.seed * 10;
      b.body.rotation.z = Math.sin(t * 16) * 0.07 * (0.3 + p.move * 0.7);
      b.body.position.y += Math.abs(Math.sin(t * 16)) * 0.05;
      const legNames = ["l0", "l1", "l2", "r0", "r1", "r2"] as const;
      legNames.forEach((n, i) => {
        const ph = p.phase * 2 + (i % 2 === (i < 3 ? 0 : 1) ? 0 : PI);
        const side = i < 3 ? 1 : -1;
        b[n].rotation.y = Math.sin(ph) * 0.4 * (0.25 + p.move);
        b[n].rotation.z = side * Math.max(0, Math.cos(ph)) * 0.35 * (0.2 + p.move);
      });
      const snap =
        p.wind > 0 ? Math.abs(Math.sin(t * 22)) : Math.abs(Math.sin(t * 2.5 + p.seed * 4));
      b.pinL.rotation.x = -snap * 0.45;
      b.pinR.rotation.x = -Math.abs(Math.sin(t * 2.1 + 1 + p.seed * 2)) * 0.45 - p.wind * 0.3;
      b.clawL.rotation.x = -0.1 + Math.sin(t * 1.3) * 0.08 - p.wind * 0.4;
      b.clawR.rotation.x = -0.1 + Math.sin(t * 1.1 + 2) * 0.08 - p.wind * 0.4;
    },
  });
}

// ---------------------------------------------------------------- DESPERADO
function desperado(sp: Sp): RobotKind {
  const poncho = sp.body;
  const acc = sp.accent;
  const glow = sp.glow;
  const iron = "#6a6a70";
  const pants = "#3a2e28";
  const boot = "#2a1e16";
  const gold = "#c8a040";
  return defineRobot({
    name: "desperado",
    stride: 1.3,
    wear: 0.8,
    bones: [
      { name: "hip", at: [0, 0.82, 0] },
      { name: "torso", parent: "hip", at: [0, 0.92, 0] },
      { name: "head", parent: "torso", at: [0, 1.66, 0] },
      { name: "poncho", parent: "torso", at: [0, 1.62, 0] },
      { name: "armL", parent: "torso", at: [0.38, 1.5, 0] },
      { name: "armR", parent: "torso", at: [-0.38, 1.5, 0] },
      { name: "legL", parent: "hip", at: [0.18, 0.82, 0] },
      { name: "shinL", parent: "legL", at: [0.18, 0.44, 0] },
      { name: "legR", parent: "hip", at: [-0.18, 0.82, 0] },
      { name: "shinR", parent: "legR", at: [-0.18, 0.44, 0] },
    ],
    build(m, B) {
      m.bone = B.hip;
      m.box(0.46, 0.2, 0.28, [0, 0.86, 0], pants, S.leather, { bevel: 0.03 });
      m.box(0.5, 0.06, 0.3, [0, 0.96, 0], "#5a3a22", S.leather, { bevel: 0.01 });
      m.box(0.1, 0.08, 0.04, [0, 0.96, 0.16], gold, S.brass, { bevel: 0.01 });
      // holsters (empty while the guns are drawn, still read as gear)
      m.both(() =>
        m.box(0.08, 0.2, 0.12, [0.28, 0.8, 0.02], "#5a3a22", S.leather, { bevel: 0.015 }),
      );
      // torso under the poncho
      m.bone = B.torso;
      m.box(0.5, 0.62, 0.32, [0, 1.22, 0], acc, S.darkSteel, { bevel: 0.05 });
      m.cyl(0.08, 0.14, [0, 1.58, 0], iron, S.steel, { seg: 10 });
      // bandolier with brass rounds
      m.box(0.09, 0.86, 0.04, [0, 1.28, 0.2], "#6a4a2a", S.leather, { rot: [0, 0, 0.7] });
      for (let k = -3; k <= 3; k++)
        m.cyl(0.014, 0.06, [k * 0.07 * 0.76, 1.28 + k * 0.07 * 0.64, 0.225], gold, S.brass, {
          rot: [0, 0, 0.7],
          seg: 5,
          lod: 1,
        });
      // head: a riveted drum with a glowing visor slit, under a wide sombrero
      m.bone = B.head;
      m.cyl(0.2, 0.34, [0, 1.86, 0], iron, S.steel, { rb: 0.22, seg: 12 });
      m.box(0.3, 0.07, 0.06, [0, 1.88, 0.19], DARK, S.darkSteel);
      m.box(0.26, 0.04, 0.03, [0, 1.88, 0.215], glow, S.glow);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * PI * 2;
        m.sphere(0.014, [Math.sin(a) * 0.215, 1.76, Math.cos(a) * 0.215], STEEL, S.steel, {
          low: true,
          lod: 1,
        });
      }
      m.box(0.12, 0.08, 0.06, [0, 1.74, 0.19], DARK, S.darkSteel, { bevel: 0.01 });
      m.cyl(0.62, 0.045, [0, 2.05, 0], poncho, S.leather, { seg: 16 });
      m.torus(0.6, 0.03, [0, 2.06, 0], shade(poncho, 0.7), S.leather, {
        rot: [PI / 2, 0, 0],
        seg: 22,
      });
      m.cyl(0.13, 0.32, [0, 2.22, 0], poncho, S.leather, { rb: 0.22, seg: 12 });
      m.torus(0.21, 0.028, [0, 2.1, 0], gold, S.brass, { rot: [PI / 2, 0, 0], seg: 16 });
      // arms: sleeves, iron hands, a long revolver in each (barrel along +z when raised)
      for (const [arm, sx] of [
        ["armL", 1],
        ["armR", -1],
      ] as const) {
        m.bone = B[arm];
        m.push([sx * 0.38, 1.5, 0]);
        m.sphere(0.09, [0, 0, 0], iron, S.steel, { low: true, lod: 1 });
        m.box(0.14, 0.5, 0.14, [0, -0.27, 0], acc, S.leather, { bevel: 0.03 });
        m.box(0.12, 0.1, 0.12, [0, -0.54, 0.02], iron, S.steel, { bevel: 0.02 });
        // the revolver hangs muzzle-down at rest and levels at you when the arm comes up
        m.push([0, -0.6, 0.04], [PI / 2, 0, 0]);
        m.box(0.05, 0.14, 0.09, [0, -0.02, -0.02], "#5a3a22", S.wood, {
          rot: [0.25, 0, 0],
          bevel: 0.01,
        });
        m.tubeZ(0.045, 0.1, [0, 0.03, 0.08], STEEL, S.gunmetal, { seg: 8 });
        m.tubeZ(0.02, 0.3, [0, 0.05, 0.26], STEEL, S.blued, { seg: 8 });
        m.box(0.012, 0.03, 0.02, [0, 0.08, 0.39], STEEL, S.steel, { lod: 1 });
        m.torus(0.035, 0.01, [0, -0.04, 0.06], STEEL, S.steel, {
          rot: [0, PI / 2, 0],
          seg: 8,
          lod: 1,
        });
        m.pop();
        m.pop();
      }
      // the striped poncho: a four-sided open cone with bands and a fringe
      m.bone = B.poncho;
      m.cyl(0.14, 0.9, [0, 1.25, 0], poncho, S.leather, { rb: 0.72, seg: 4, open: true });
      m.cyl(0.4, 0.07, [0, 1.37, 0], "#e8d8a8", S.leather, { rb: 0.44, seg: 4, open: true });
      m.cyl(0.52, 0.07, [0, 1.17, 0], "#2a6a6a", S.leather, { rb: 0.56, seg: 4, open: true });
      m.cyl(0.64, 0.07, [0, 0.99, 0], "#e8d8a8", S.leather, { rb: 0.68, seg: 4, open: true });
      // fringe along the hem (the cone's four sides run between its corners at +z, +x, -z, -x)
      const hem: [number, number][] = [
        [0, 0.74],
        [0.74, 0],
        [0, -0.74],
        [-0.74, 0],
      ];
      for (let e = 0; e < 4; e++) {
        const [ax, az] = hem[e]!;
        const [bx, bz] = hem[(e + 1) % 4]!;
        for (let k = 1; k < 5; k++) {
          const u = k / 5;
          m.box(
            0.03,
            0.1,
            0.01,
            [ax + (bx - ax) * u, 0.76, az + (bz - az) * u],
            "#e8d8a8",
            S.leather,
            { rot: [0, Math.atan2(bx - ax, bz - az) + PI / 2, 0], lod: 1 },
          );
        }
      }
      // legs and boots with spurs
      for (const [leg, shin, sx] of [
        ["legL", "shinL", 1],
        ["legR", "shinR", -1],
      ] as const) {
        m.bone = B[leg];
        m.box(0.2, 0.42, 0.22, [sx * 0.18, 0.62, 0], pants, S.leather, { bevel: 0.03 });
        m.bone = B[shin];
        m.box(0.18, 0.34, 0.2, [sx * 0.18, 0.28, 0], pants, S.leather, { bevel: 0.03 });
        m.box(0.14, 0.1, 0.06, [sx * 0.18, 0.44, 0.11], iron, S.steel, { bevel: 0.015 });
        m.box(0.24, 0.16, 0.36, [sx * 0.18, 0.08, 0.05], boot, S.leather, { bevel: 0.04 });
        m.box(0.26, 0.04, 0.4, [sx * 0.18, 0.02, 0.05], "#1a120c", S.rubber, { bevel: 0.01 });
        m.cyl(0.035, 0.012, [sx * 0.18, 0.1, -0.16], gold, S.brass, {
          rot: [PI / 2, 0, 0],
          seg: 6,
          lod: 1,
        });
      }
    },
    animate(b, p) {
      walkLegs(b, p, 0.5);
      const draw = p.wind; // smoothed quick-draw
      const s = Math.sin(p.phase) * 0.35 * p.move * (1 - draw);
      b.armL.rotation.x = -0.15 - 1.3 * draw - s;
      b.armR.rotation.x = -0.15 - 1.3 * draw + s;
      b.armL.rotation.z = -0.08 * draw;
      b.armR.rotation.z = 0.08 * draw;
      b.poncho.rotation.z = Math.sin(p.t * 3.1 + p.seed * 4) * 0.04;
      b.poncho.rotation.x = -0.05 * p.move;
      b.head.rotation.x = -0.08 * draw;
      b.torso.rotation.x = 0.04 * p.move;
      idle(b.torso, p, 0.6);
    },
  });
}

const cache = new Map<string, RobotKind>();
export function specialRobot(theme: Theme): RobotKind | null {
  const sp = theme.special;
  if (!ART_SPECIALS.has(sp.type)) return null;
  const key = `${sp.type}|${theme.name}`;
  let k = cache.get(key);
  if (!k) {
    k =
      sp.type === "leaper"
        ? leaper(sp)
        : sp.type === "skier"
          ? skier(sp)
          : sp.type === "crawler"
            ? crawler(sp)
            : desperado(sp);
    cache.set(key, k);
  }
  return k;
}
/** colours-only entry for callers that do not have the theme (the western DesperadoModel) */
export function specialRobotFor(
  type: ArtSpecialType,
  sp: { body: string; accent: string; glow: string },
): RobotKind {
  const key = `${type}|${sp.body}|${sp.accent}|${sp.glow}`;
  let k = cache.get(key);
  if (!k) {
    const s: Sp = { name: type, type, ...sp };
    k =
      type === "leaper"
        ? leaper(s)
        : type === "skier"
          ? skier(s)
          : type === "crawler"
            ? crawler(s)
            : desperado(s);
    cache.set(key, k);
  }
  return k;
}

/** does this map's special have a detailed art model? */
export const hasArtSpecial = (theme: Theme) => ART_SPECIALS.has(theme.special.type);
