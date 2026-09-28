// One edge profile for the water sheet and its raised foam bore.
const WAVES = [
  [0.07, 0.8, 1.6],
  [0.23, 1.3, 0.6],
] as const;
export const surgeEdge = (front: number, z: number, time: number) =>
  front +
  WAVES.reduce((v, [space, speed, height]) => v + Math.sin(z * space + time * speed) * height, 0);
export const SURGE_EDGE_GLSL = `float surgeEdge(float front, float z, float time) {
  return front + ${WAVES.map(([space, speed, height]) => `sin(z * ${space} + time * ${speed}) * ${height}`).join(" + ")};
}`;
