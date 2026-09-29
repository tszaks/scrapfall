// Physics, the carved mesh, and the ground cut share the same river profile.
type Wave = readonly [amplitude: number, wavelength: number, phase: number];
const bends: readonly Wave[] = [
  [24, 88, 0],
  [9, 37, 1.3],
  [3, 23, 0.7],
  [0.8, 8.3, 0],
];
const widths: readonly Wave[] = [
  [5, 61, 0.4],
  [2.1, 17, 1.8],
  [0.8, 7.1, 0],
];
const sample = (base: number, waves: readonly Wave[], x: number) =>
  waves.reduce((value, [a, w, p]) => value + a * Math.sin(x / w + p), base);
export const riverZ = (x: number) => sample(172, bends, x);
export const riverW = (x: number) => sample(21, widths, x);
const glsl = (base: number, waves: readonly Wave[]) =>
  `${base.toFixed(1)}${waves
    .map(([a, w, p]) => ` + ${a.toFixed(1)} * sin(x / ${w.toFixed(1)} + ${p.toFixed(1)})`)
    .join("")}`;
export const riverGLSL = `
float riverZ(float x) { return ${glsl(172, bends)}; }
float riverW(float x) { return ${glsl(21, widths)}; }
`;
