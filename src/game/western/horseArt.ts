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
  body.sphere(1, [0, 1.34, -0.06], "#ffffff", COAT, { s: [0.32, 0.34, 0.77], low: true });
  for (const z of [-0.59, 0.52])
    body.sphere(1, [0, 1.35, z], "#efefeb", COAT, { s: [0.34, 0.37, 0.34], low: true });
  beam(body, [0, 1.48, 0.59], [0, 1.99, 1.05], 0.4, 0.43, "#ffffff", COAT);
  body.sphere(1, [0, 1.94, 1.15], "#ffffff", COAT, {
    s: [0.19, 0.24, 0.38],
    rot: [0.48, 0, 0],
    low: true,
  });
  body.sphere(1, [0, 1.76, 1.47], "#b9ada3", COAT, { s: [0.19, 0.14, 0.19], low: true });
  for (const s of [-1, 1]) {
    body.cone(0.063, 0.23, [s * 0.11, 2.16, 1.03], "#ffffff", COAT, {
      rot: [-0.18, 0, s * -0.12],
      seg: 6,
    });
    body.sphere(0.033, [s * 0.177, 2.035, 1.18], "#110e0c", SKIN, { low: true });
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
  beam(body, [0, 1.64, 0.51], [0, 2.16, 1.01], 0.08, 0.12, "#31251e", LEATHER);
  for (let n = 0; n < 6; n++)
    beam(
      body,
      [0, 1.61 + n * 0.078, 0.53 + n * 0.076],
      [0, 1.5 + n * 0.075, 0.4 + n * 0.077],
      0.1,
      0.075,
      "#39291f",
      LEATHER,
    );
  beam(body, [0, 1.54, -0.75], [0, 1.13, -0.93], 0.14, 0.14, "#32251e", LEATHER);
  beam(body, [0, 1.13, -0.93], [0, 0.76, -1.08], 0.12, 0.15, "#32251e", LEATHER);
  body.box(0.7, 0.08, 0.66, [0, 1.62, -0.02], "#a44338", [0.9, 0], { bevel: 0.028 });
  for (const z of [-0.29, 0.26]) body.box(0.71, 0.015, 0.035, [0, 1.665, z], "#cbae74", LEATHER);
  body.box(0.47, 0.105, 0.49, [0, 1.71, 0.0], "#67432b", LEATHER, { bevel: 0.04 });
  body.box(0.48, 0.18, 0.08, [0, 1.79, -0.21], "#67432b", LEATHER, { bevel: 0.025 });
  body.cyl(0.05, 0.15, [0, 1.84, 0.2], "#8b603a", LEATHER, { seg: 8 });
  body.sphere(0.066, [0, 1.925, 0.2], "#8b603a", LEATHER, { s: [1, 0.55, 1], low: true });
  const leg = new Model();
  beam(leg, [0, 0, 0], [0, -0.42, -0.055], 0.145, 0.17, "#ffffff", COAT);
  leg.sphere(0.09, [0, -0.43, -0.04], "#f2eee7", COAT, { low: true });
  beam(leg, [0, -0.43, -0.04], [0, -0.88, 0.035], 0.095, 0.1, "#ffffff", COAT);
  leg.box(0.15, 0.13, 0.2, [0, -0.985, 0.065], "#28231f", LEATHER, { bevel: 0.025 });
  leg.box(0.15, 0.023, 0.2, [0, -1.048, 0.065], "#726b60", IRON, { bevel: 0.007 });
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
    leg: leg.build(),
    legs: legs.build(),
    torso: torso.build(),
    hat: hat.build(),
  };
}
