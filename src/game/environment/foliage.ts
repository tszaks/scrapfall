// Open crowns made of branches and folded leaves, merged into existing map chunks.
// No transparent leaf cards, new draw calls, or collision faces in the crown.
import * as THREE from "three";
import type { Geo } from "../cityGeo";

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
  const twig = new THREE.CylinderGeometry(0.014, 0.023, 1, 4, 1, true);
  const start = new THREE.Vector3(center[0], center[1] - radius[1] * 0.9, center[2]);
  const count = 24;
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
    g.col("#66594a");
    g.add(branch, matrix);
    for (let i = 0; i < count; i++) {
      const detailStart = g.n;
      const a = rand() * Math.PI * 2,
        u = rand() * 2 - 1;
      const ring = Math.sqrt(1 - u * u),
        r = Math.cbrt(rand());
      const x = tip.x + Math.cos(a) * ring * r * radius[0] * 0.38;
      const y = tip.y + u * r * radius[1] * 0.6;
      const z = tip.z + Math.sin(a) * ring * r * radius[2] * 0.38;
      if (i % 6 === 0) {
        const twigTip = new THREE.Vector3(x, y, z);
        const twigDelta = twigTip.clone().sub(tip);
        matrix.compose(
          tip.clone().add(twigTip).multiplyScalar(0.5),
          new THREE.Quaternion().setFromUnitVectors(axis, twigDelta.clone().normalize()),
          new THREE.Vector3(1, twigDelta.length(), 1),
        );
        g.col("#66594a");
        g.add(twig, matrix);
      }
      const length = 0.23 + rand() * 0.27,
        width = length * (0.35 + rand() * 0.2);
      const yaw = rand() * Math.PI * 2,
        tilt = (rand() - 0.5) * 1.6;
      const dir = new THREE.Vector3(Math.cos(yaw), tilt, Math.sin(yaw)).normalize();
      const side = new THREE.Vector3(-Math.sin(yaw), 0, Math.cos(yaw));
      const c = new THREE.Vector3(x, y, z);
      const tip1 = c.clone().addScaledVector(dir, length);
      const tip2 = c.clone().addScaledVector(dir, -length);
      const left = c.clone().addScaledVector(side, width);
      left.y -= length * 0.18;
      const right = c.clone().addScaledVector(side, -width);
      right.y -= length * 0.18;
      shade.copy(tint).multiplyScalar(0.62 + rand() * 0.5);
      g.col(shade);
      for (const vertices of [
        [tip1, left, tip2],
        [tip1, tip2, right],
      ]) {
        const n = vertices[1]!
          .clone()
          .sub(vertices[0]!)
          .cross(vertices[2]!.clone().sub(vertices[0]!))
          .normalize();
        for (const p of vertices) g.v(p.x, p.y, p.z, n.x, n.y, n.z);
        for (const p of [...vertices].reverse()) g.v(p.x, p.y, p.z, -n.x, -n.y, -n.z);
      }
      if (i >= 14) g.highDetailSince(detailStart);
    }
  }
  branch.dispose();
  twig.dispose();
}
