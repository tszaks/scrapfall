import * as THREE from "three";
import { Model, type V3, type Surf } from "../art/kit";
const COAT: Surf = [0.82, 0, 0, 1],
  CLOTH: Surf = [0.9, 0, 0, 1],
  LEATHER: Surf = [0.68, 0],
  IRON: Surf = [0.38, 0.8],
  SKIN: Surf = [0.85, 0];
const q = new THREE.Quaternion(),
  e = new THREE.Euler();
function beam(m: Model, a: V3, b: V3, w: number, d: number, c: string, s: Surf) {
  const v = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  e.setFromQuaternion(q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.clone().normalize()));
  m.box(w, v.length(), d, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], c, s, {
    rot: [e.x, e.y, e.z],
    bevel: Math.min(w, d) * 0.15,
  });
}
/** Separate instanced parts preserve the existing gait, driver seats and network poses. */
export function horseArt() {
  const body = new Model();
  // Smooth overlapping muscle volumes retain the saddle height and grounded hoof datum.
  body.sphere(1, [0, 1.34, -0.06], "#ffffff", COAT, { s: [0.32, 0.34, 0.73] });
  body.sphere(1, [0, 1.38, -0.55], "#eeebe6", COAT, { s: [0.355, 0.37, 0.36] });
  body.sphere(1, [0, 1.38, 0.5], "#f8f6f2", COAT, { s: [0.32, 0.38, 0.33] });
  body.sphere(1, [0, 1.72, 0.74], "#ffffff", COAT, { s: [0.225, 0.47, 0.25], rot: [0.5, 0, 0] });
  body.sphere(1, [0, 1.98, 1.02], "#ffffff", COAT, { s: [0.145, 0.25, 0.2], rot: [0.35, 0, 0] });
  body.sphere(1, [0, 1.96, 1.19], "#faf6ef", COAT, { s: [0.15, 0.195, 0.32], rot: [0.65, 0, 0] });
  body.sphere(1, [0, 1.76, 1.42], "#c7b8a6", COAT, { s: [0.145, 0.115, 0.18] });
  // A slim pale blaze and jaw mass make the face readable at normal player distance.
  body.sphere(1, [0, 2.037, 1.22], "#e9dfcc", COAT, { s: [0.033, 0.16, 0.11], rot: [0.65, 0, 0] });
  for (const s of [-1, 1]) {
    body.cone(0.063, 0.23, [s * 0.11, 2.16, 1.03], "#ffffff", COAT, {
      rot: [-0.18, 0, s * -0.12],
      seg: 6,
    });
    body.sphere(0.025, [s * 0.144, 2.035, 1.18], "#110e0c", SKIN, { low: true });
    body.sphere(0.018, [s * 0.158, 1.79, 1.605], "#2a221e", SKIN, { low: true });
    // Bridle, reins, saddle buckles and stirrups retain their own colours under coat tint.
    beam(body, [s * 0.19, 1.84, 1.39], [s * 0.19, 2.07, 1.03], 0.027, 0.025, "#493124", LEATHER);
    beam(body, [s * 0.18, 1.85, 1.4], [s * 0.19, 1.99, 0.34], 0.018, 0.018, "#39291f", LEATHER);
    beam(body, [s * 0.3, 1.6, 0.05], [s * 0.34, 1.23, 0.05], 0.035, 0.025, "#503325", LEATHER);
    body.torus(0.082, 0.015, [s * 0.34, 1.2, 0.06], "#a49b89", IRON, {
      rot: [0, Math.PI / 2, 0],
      seg: 8,
    });
    body.box(0.03, 0.1, 0.075, [s * 0.29, 1.53, 0.09], "#bea579", IRON, { bevel: 0.006 });
  }
  for (let i = 0; i < 7; i++) {
    const x = (i - 3) * 0.012;
    body.cable(
      [
        [x, 2.17, 0.98],
        [x, 2.02, 0.81],
        [x, 1.78, 0.56],
        [x + 0.055, 1.5, 0.43],
      ],
      0.025,
      "#30251e",
      LEATHER,
      { lod: 0, seg: 12 },
    );
  }
  for (let i = 0; i < 8; i++) {
    const x = (i - 3.5) * 0.013;
    body.cable(
      [
        [x, 1.52, -0.79],
        [x, 1.22, -0.91],
        [x * 1.5, 0.85, -1.03],
        [x * 1.7, 0.56, -0.99],
      ],
      0.024,
      "#33271e",
      LEATHER,
      { lod: 0, seg: 12 },
    );
  }
  body.box(0.7, 0.08, 0.66, [0, 1.62, -0.02], "#a44338", [0.9, 0], { bevel: 0.028 });
  for (const z of [-0.29, 0.26]) body.box(0.71, 0.015, 0.035, [0, 1.665, z], "#cbae74", LEATHER);
  body.box(0.47, 0.105, 0.49, [0, 1.71, 0.0], "#67432b", LEATHER, { bevel: 0.04 });
  body.box(0.48, 0.18, 0.08, [0, 1.79, -0.21], "#67432b", LEATHER, { bevel: 0.025 });
  body.cyl(0.05, 0.15, [0, 1.84, 0.2], "#8b603a", LEATHER, { seg: 8 });
  body.sphere(0.066, [0, 1.925, 0.2], "#8b603a", LEATHER, { s: [1, 0.55, 1], low: true });
  const limb = (rear: boolean) => {
    const m = new Model();
    const knee: V3 = [0, -0.43, rear ? -0.15 : -0.025];
    const ankle: V3 = [0, -0.88, 0.02];
    const muscle = (a: V3, b: V3, top: number, bottom: number) => {
      const v = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      e.setFromQuaternion(q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.clone().normalize()));
      m.cyl(
        bottom,
        v.length(),
        [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
        "#ffffff",
        COAT,
        { rb: top, seg: 10, rot: [e.x, e.y, e.z] },
      );
    };
    muscle([0, 0, 0], knee, rear ? 0.115 : 0.09, 0.063);
    m.sphere(0.071, knee, "#ece7df", COAT, { s: [0.95, 1.1, 1] });
    muscle(knee, ankle, 0.051, 0.033);
    m.sphere(0.045, ankle, "#ede7db", COAT);
    muscle(ankle, [0, -0.97, 0.05], 0.036, 0.048);
    m.sphere(1, [0, -0.993, 0.067], "#393128", LEATHER, { s: [0.07, 0.057, 0.093] });
    m.box(0.13, 0.014, 0.17, [0, -1.048, 0.063], "#6b655c", IRON, { bevel: 0.007 });
    return m.build();
  };
  const legs = new Model();
  for (const s of [-1, 1]) {
    beam(legs, [s * 0.14, 1.83, 0.02], [s * 0.29, 1.65, 0.24], 0.19, 0.21, "#384252", SKIN);
    beam(legs, [s * 0.29, 1.65, 0.24], [s * 0.33, 1.31, 0.08], 0.145, 0.15, "#384252", SKIN);
    legs.box(0.18, 0.23, 0.18, [s * 0.33, 1.25, 0.1], "#36271d", LEATHER, { bevel: 0.025 });
    legs.box(0.18, 0.12, 0.32, [s * 0.33, 1.15, 0.19], "#36271d", LEATHER, { bevel: 0.025 });
    legs.torus(0.035, 0.009, [s * 0.43, 1.21, 0.04], "#aa9572", IRON, {
      rot: [0, Math.PI / 2, 0],
      seg: 7,
    });
  }
  const torso = new Model();
  torso.box(0.4, 0.56, 0.28, [0, 2.1, 0], "#ffffff", CLOTH, { bevel: 0.065 });
  for (const s of [-1, 1]) {
    torso.box(0.125, 0.4, 0.035, [s * 0.125, 2.12, 0.155], "#624838", LEATHER, { bevel: 0.012 });
    beam(torso, [s * 0.21, 2.33, 0], [s * 0.26, 2.09, 0.16], 0.14, 0.15, "#ffffff", CLOTH);
    beam(torso, [s * 0.26, 2.09, 0.16], [s * 0.19, 1.99, 0.34], 0.12, 0.13, "#ffffff", CLOTH);
    torso.sphere(0.065, [s * 0.19, 1.99, 0.35], "#d3a27d", SKIN, { s: [1, 0.8, 1.1], low: true });
  }
  torso.box(0.39, 0.065, 0.3, [0, 1.85, 0.01], "#493525", LEATHER, { bevel: 0.018 });
  torso.box(0.065, 0.065, 0.018, [0, 1.85, 0.17], "#bc9e57", IRON, { bevel: 0.009 });
  torso.cyl(0.071, 0.11, [0, 2.43, 0.015], "#d3a27d", SKIN, { seg: 8 });
  torso.sphere(1, [0, 2.58, 0.025], "#d3a27d", SKIN, { s: [0.115, 0.16, 0.115], low: true });
  torso.box(0.047, 0.046, 0.05, [0, 2.58, 0.143], "#c18c66", SKIN, { bevel: 0.008 });
  for (const s of [-1, 1])
    torso.box(0.025, 0.017, 0.015, [s * 0.047, 2.62, 0.132], "#25201b", SKIN);
  torso.box(0.14, 0.034, 0.025, [0, 2.54, 0.133], "#4a3022", LEATHER, { bevel: 0.007 });
  const hat = new Model();
  hat.cyl(0.3, 0.045, [0, 2.7, 0.02], "#ffffff", CLOTH, { seg: 16 });
  hat.cyl(0.135, 0.17, [0, 2.8, 0.01], "#ffffff", CLOTH, { rb: 0.155, seg: 12 });
  hat.cyl(0.155, 0.039, [0, 2.74, 0.01], "#4c3628", LEATHER, { seg: 12 });
  hat.box(0.1, 0.017, 0.2, [0, 2.891, 0.01], "#d5c5ad", CLOTH, { bevel: 0.008 });
  return {
    body: body.build(),
    leg: limb(false),
    hind: limb(true),
    legs: legs.build(),
    torso: torso.build(),
    hat: hat.build(),
  };
}
