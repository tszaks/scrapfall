// Branched crowns with small leaf sprays in the existing facade atlas and draw batch.
import * as THREE from "three";
import { Geo, L } from "../cityGeo";
import { TILE_COLS, TILE_ROWS } from "../cityTextures";

export function broadleafCrown(
  g: Geo,
  center: [number, number, number],
  radius: [number, number, number],
  color: string | number,
  seed = 31,
) {
  let state = seed;
  const rand = () => ((state = Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
  const tint = new THREE.Color(color);
  const shade = new THREE.Color();
  const matrix = new THREE.Matrix4();
  const axis = new THREE.Vector3(0, 1, 0);
  const branch = new THREE.CylinderGeometry(0.025, 0.065, 1, 6);
  const start = new THREE.Vector3(center[0], center[1] - radius[1] * 0.9, center[2]);
  for (let arm = 0; arm < 12; arm++) {
    const angle = arm * 2.39996;
    const spread = arm < 9 ? 0.57 : 0.26;
    const tip = new THREE.Vector3(
      center[0] + Math.cos(angle) * radius[0] * spread,
      center[1] + (arm < 9 ? (rand() - 0.5) * radius[1] * 0.65 : radius[1] * 0.48),
      center[2] + Math.sin(angle) * radius[2] * spread,
    );
    const delta = tip.clone().sub(start);
    matrix.compose(
      start.clone().add(tip).multiplyScalar(0.5),
      new THREE.Quaternion().setFromUnitVectors(axis, delta.clone().normalize()),
      new THREE.Vector3(1, delta.length(), 1),
    );
    g.mat(L.plain).col("#66594a");
    g.add(branch, matrix);
    for (let i = 0; i < 12; i++) {
      const detailStart = g.n;
      const a = rand() * Math.PI * 2,
        u = rand() * 2 - 1;
      const ring = Math.sqrt(1 - u * u),
        r = Math.cbrt(rand());
      const c = new THREE.Vector3(
        tip.x + Math.cos(a) * ring * r * radius[0] * 0.36,
        tip.y + u * r * radius[1] * 0.5,
        tip.z + Math.sin(a) * ring * r * radius[2] * 0.36,
      );
      const yaw = rand() * Math.PI * 2;
      const length = 0.48 + rand() * 0.22;
      const dir = new THREE.Vector3(Math.cos(yaw), (rand() - 0.5) * 2.6, Math.sin(yaw)).normalize();
      const side = new THREE.Vector3(-Math.sin(yaw), 0, Math.cos(yaw));
      const points = [
        c
          .clone()
          .addScaledVector(dir, -length)
          .addScaledVector(side, -length * 0.63),
        c
          .clone()
          .addScaledVector(dir, -length)
          .addScaledVector(side, length * 0.63),
        c
          .clone()
          .addScaledVector(dir, length)
          .addScaledVector(side, length * 0.63),
        c
          .clone()
          .addScaledVector(dir, length)
          .addScaledVector(side, -length * 0.63),
      ];
      const normal = side.clone().cross(dir).normalize();
      shade.copy(tint).multiplyScalar(0.82 + rand() * 0.42);
      g.mat(L.foliage, 0, 0).col(shade);
      const uv = [
        [0, 0],
        [TILE_COLS, 0],
        [TILE_COLS, TILE_ROWS],
        [0, TILE_ROWS],
      ];
      for (const order of [
        [0, 1, 2, 0, 2, 3],
        [2, 1, 0, 3, 2, 0],
      ]) {
        const sign = order[0] === 0 ? 1 : -1;
        for (const j of order) {
          const p = points[j]!;
          g.v(
            p.x,
            p.y,
            p.z,
            normal.x * sign,
            normal.y * sign,
            normal.z * sign,
            uv[j]![0],
            uv[j]![1],
          );
        }
      }
      if (i >= 7) g.highDetailSince(detailStart);
    }
  }
  g.mat(L.plain);
  branch.dispose();
}
