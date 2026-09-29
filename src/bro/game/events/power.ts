// City power grid: a coarse map of districts, each 0 (dark) .. 1 (powered). Map events
// (the Vice Heights blackout) write it; the city's windows, street lights, neon, signs and
// traffic lights read it (a tiny texture sampled at each fragment's world position, and
// a CPU lookup for the traffic lights and the cars).
import * as THREE from "three";

export const GRID = 8;

const data = new Uint8Array(GRID * GRID * 4).fill(255);
const tex = new THREE.DataTexture(data, GRID, GRID, THREE.RGBAFormat);
tex.magFilter = THREE.LinearFilter;
tex.minFilter = THREE.LinearFilter;
tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
tex.needsUpdate = true;

export const power = {
  /** per district, [i * GRID + j] with i along x and j along z */
  values: new Float32Array(GRID * GRID).fill(1),
  /** half-size of the square the grid covers (the city sets it) */
  half: 300,
  /** true while any district is below full power */
  out: false,
  /** 0 = lights normal .. 1 = the whole grid dark (drives the flashlight and the eye glow) */
  darkness: 0,
  /** traffic light nodes and where they are (the city registers them) */
  nodePos: new Map<number, [number, number]>(),
  /** bumps when the values change (the city re-colours its traffic lights) */
  version: 0,
};

/** shared uniforms: add these to any material that should go dark with the grid */
export const powerUniforms = {
  uPower: { value: tex },
  uPowerHalf: { value: 300 },
};

export function setPowerArea(half: number) {
  power.half = half;
  powerUniforms.uPowerHalf.value = half;
}

/** district index for a world position */
export function districtOf(x: number, z: number) {
  const i = Math.max(0, Math.min(GRID - 1, Math.floor(((x / power.half) * 0.5 + 0.5) * GRID)));
  const j = Math.max(0, Math.min(GRID - 1, Math.floor(((z / power.half) * 0.5 + 0.5) * GRID)));
  return i * GRID + j;
}
/** district centre in world metres */
export function districtCentre(d: number): [number, number] {
  const i = Math.floor(d / GRID);
  const j = d % GRID;
  return [((i + 0.5) / GRID - 0.5) * 2 * power.half, ((j + 0.5) / GRID - 0.5) * 2 * power.half];
}

/** power at a world position (nearest district) */
export function powerAt(x: number, z: number) {
  if (!power.out) return 1;
  return power.values[districtOf(x, z)]!;
}

/** traffic signal at `node` has no power: the lights are dark and cars treat it as a stop */
export function nodeDark(node: number) {
  if (!power.out) return false;
  const p = power.nodePos.get(node);
  return !!p && powerAt(p[0], p[1]) < 0.5;
}

/** push the values to the texture (call after writing `power.values`) */
export function commitPower() {
  let changed = false;
  let out = false;
  let sum = 0;
  for (let d = 0; d < GRID * GRID; d++) {
    const v = Math.max(0, Math.min(1, power.values[d]!));
    sum += v;
    if (v < 0.999) out = true;
    // texture layout: row = z (j), column = x (i); uv = (x, z)
    const i = Math.floor(d / GRID);
    const j = d % GRID;
    const o = (j * GRID + i) * 4;
    const b = Math.round(v * 255);
    if (data[o] !== b) {
      data[o] = data[o + 1] = data[o + 2] = b;
      changed = true;
    }
  }
  power.out = out;
  power.darkness = 1 - sum / (GRID * GRID);
  if (changed) {
    tex.needsUpdate = true;
    power.version++;
  }
}

export function restorePower() {
  power.values.fill(1);
  commitPower();
}

/** GLSL: `float gridPower(vec2 worldXZ)` (needs powerUniforms) */
export const POWER_GLSL = /* glsl */ `
uniform sampler2D uPower;
uniform float uPowerHalf;
float gridPower(vec2 wxz) {
  return texture2D(uPower, wxz / (2.0 * uPowerHalf) + 0.5).r;
}`;
