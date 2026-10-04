// A single merged, seated upper body for nearby ambient traffic. Legs stay below
// the window line; car seats and the body shell conceal them.
import * as THREE from "three";
import { Model, type Surf } from "./kit";

const CLOTH: Surf = [0.88, 0, 0, 1];
const SKIN: Surf = [0.82, 0];
const HAIR: Surf = [0.95, 0];
let driver: THREE.BufferGeometry | null = null;

/** Authored in a 0.8m-high seated frame, +z facing the steering wheel. */
export function driverGeometry() {
  if (driver) return driver;
  const m = new Model();
  m.box(0.39, 0.39, 0.2, [0, 0.235, 0], "#ffffff", CLOTH, { bevel: 0.04 });
  m.cyl(0.055, 0.08, [0, 0.46, 0.01], "#b68d70", SKIN, { seg: 6 });
  m.sphere(0.14, [0, 0.63, 0.015], "#b68d70", SKIN, { low: true, s: [0.82, 1.12, 0.85] });
  // A flattened cap gives a readable hairline without a texture or separate mesh.
  m.sphere(0.14, [0, 0.697, -0.007], "#302a25", HAIR, { low: true, s: [0.85, 0.57, 0.9] });
  for (const side of [-1, 1]) {
    m.cyl(0.067, 0.24, [side * 0.225, 0.31, 0.05], "#ffffff", CLOTH, {
      seg: 6,
      rot: [-0.55, 0, side * 0.12],
    });
    m.cyl(0.05, 0.28, [side * 0.2, 0.23, 0.24], "#b68d70", SKIN, {
      seg: 6,
      rot: [1.25, 0, side * 0.15],
    });
    m.box(0.085, 0.075, 0.1, [side * 0.18, 0.275, 0.375], "#b68d70", SKIN);
  }
  driver = m.build();
  driver.name = "ambient-driver";
  return driver;
}
