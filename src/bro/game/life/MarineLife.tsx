import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { artMaterial, artFrame } from "../art/kit";
import { trafficClock } from "../trafficCore";
import { marineModel } from "./models";
import { marinePose, MARINE_COUNTS, type MarineKind, type MarinePose } from "./marine";

const pose: MarinePose = { x: 0, y: 0, z: 0, yaw: 0, roll: 0, speed: 0 };
const matrix = new THREE.Matrix4(),
  p = new THREE.Vector3(),
  q = new THREE.Quaternion(),
  e = new THREE.Euler(),
  scale = new THREE.Vector3(1, 1, 1);
export function MarineLife() {
  const built = useMemo(() => {
    const material = artMaterial({ paint: true, wear: 0.16 });
    const entries = (Object.keys(MARINE_COUNTS) as MarineKind[]).map((kind) => {
      const mesh = new THREE.InstancedMesh(marineModel(kind), material, MARINE_COUNTS[kind]);
      mesh.name = `coastal-${kind}`;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      for (let i = 0; i < mesh.count; i++)
        mesh.setColorAt(i, new THREE.Color([0x397f99, 0xdf583b, 0xe4b841, 0x387767][i % 4]!));
      return { kind, mesh };
    });
    const foam = new THREE.PlaneGeometry(1, 1);
    foam.rotateX(-Math.PI / 2);
    const fm = new THREE.MeshBasicMaterial({
      color: 0xe5ece5,
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
    });
    const wakes = new THREE.InstancedMesh(foam, fm, 60);
    wakes.frustumCulled = false;
    return { material, entries, wakes };
  }, []);
  useEffect(
    () => () => {
      for (const a of built.entries) a.mesh.geometry.dispose();
      built.material.dispose();
      built.wakes.geometry.dispose();
      (built.wakes.material as THREE.Material).dispose();
    },
    [built],
  );
  useFrame(() => {
    artFrame();
    let n = 0;
    for (const { kind, mesh } of built.entries) {
      for (let i = 0; i < mesh.count; i++) {
        marinePose(kind, i, trafficClock.t, pose);
        p.set(pose.x, pose.y, pose.z);
        e.set(0, pose.yaw, pose.roll);
        q.setFromEuler(e);
        scale.set(1, 1, 1);
        matrix.compose(p, q, scale);
        mesh.setMatrixAt(i, matrix);
        for (let j = 0; j < 3; j++) {
          const back = (kind === "boat" ? 2.9 : kind === "jet" ? 1.7 : 1.2) + j * 0.9;
          p.set(
            pose.x - Math.sin(pose.yaw) * back,
            pose.y - 0.035 - j * 0.015,
            pose.z - Math.cos(pose.yaw) * back,
          );
          e.set(0, pose.yaw, 0);
          q.setFromEuler(e);
          scale.set((kind === "boat" ? 1.4 : 0.5) + j * 0.22, 1, 0.55);
          matrix.compose(p, q, scale);
          built.wakes.setMatrixAt(n++, matrix);
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
    built.wakes.count = n;
    built.wakes.instanceMatrix.needsUpdate = true;
  });
  return (
    <group>
      {built.entries.map(({ kind, mesh }) => (
        <primitive key={kind} object={mesh} />
      ))}
      <primitive object={built.wakes} />
    </group>
  );
}
