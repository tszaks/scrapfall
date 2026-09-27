// Other players' turrets and mines. Visual copies only: the owner's client fires them and
// the host applies the damage through the normal "hit" messages.
import { useFrame } from "@react-three/fiber";
import { groundY } from "./terrain";
import { useRef } from "react";
import type * as THREE from "three";

export type RemoteDeps = Map<string, { t: number[]; m: number[]; at: number }>;
const POOL = 18; // up to 3 teammates x 6 each

export function RemoteDeployables({
  deps,
  enemies,
}: {
  deps: React.MutableRefObject<RemoteDeps>;
  enemies: { x: number; z: number; alive: boolean }[];
}) {
  const turrets = useRef<(THREE.Group | null)[]>([]);
  const mines = useRef<(THREE.Group | null)[]>([]);
  useFrame(() => {
    let ti = 0;
    let mi = 0;
    const now = performance.now();
    deps.current.forEach((d, id) => {
      if (now - d.at > 5000) {
        deps.current.delete(id);
        return;
      }
      const age = (now - d.at) / 1000;
      for (let k = 0; k + 2 < d.t.length && ti < POOL; k += 3) {
        const g = turrets.current[ti++];
        if (!g) continue;
        const x = d.t[k]! / 100;
        const z = d.t[k + 1]! / 100;
        g.visible = d.t[k + 2]! / 10 - age > 0; // life counts down locally
        g.position.set(x, groundY(x, z), z);
        // track the nearest enemy, like the owner's turret does
        let bx = 0;
        let bz = 0;
        let bd = 5.5;
        for (const e of enemies) {
          if (!e.alive) continue;
          const dd = Math.hypot(e.x - x, e.z - z);
          if (dd < bd) {
            bd = dd;
            bx = e.x;
            bz = e.z;
          }
        }
        if (bd < 5.5) g.rotation.y = Math.atan2(bx - x, bz - z);
      }
      for (let k = 0; k + 1 < d.m.length && mi < POOL; k += 2) {
        const g = mines.current[mi++];
        if (!g) continue;
        g.visible = true;
        g.position.set(d.m[k]! / 100, groundY(d.m[k]! / 100, d.m[k + 1]! / 100) + 0.2, d.m[k + 1]! / 100);
      }
    });
    for (; ti < POOL; ti++) {
      const g = turrets.current[ti];
      if (g) g.visible = false;
    }
    for (; mi < POOL; mi++) {
      const g = mines.current[mi];
      if (g) g.visible = false;
    }
  });
  return (
    <>
      {Array.from({ length: POOL }, (_, i) => (
        <group
          key={`t${i}`}
          ref={(g) => {
            turrets.current[i] = g;
          }}
          visible={false}
        >
          <mesh position-y={0.35}>
            <cylinderGeometry args={[0.28, 0.36, 0.7, 8]} />
            <meshStandardMaterial color="#39424d" />
          </mesh>
          <mesh position-y={0.85}>
            <sphereGeometry args={[0.28, 10, 8]} />
            <meshStandardMaterial color="#1f2731" />
          </mesh>
          <mesh position={[0, 0.9, 0.45]} rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[0.07, 0.07, 0.8, 8]} />
            <meshBasicMaterial color="#4fe3ff" fog={false} />
          </mesh>
        </group>
      ))}
      {Array.from({ length: POOL }, (_, i) => (
        <group
          key={`m${i}`}
          ref={(g) => {
            mines.current[i] = g;
          }}
          visible={false}
        >
          <mesh rotation-x={-Math.PI / 2}>
            <cylinderGeometry args={[0.35, 0.35, 0.12, 10]} />
            <meshBasicMaterial color="#9fe8ff" fog={false} />
          </mesh>
          <mesh rotation-x={-Math.PI / 2}>
            <ringGeometry args={[0.5, 0.6, 18]} />
            <meshBasicMaterial color="#9fe8ff" fog={false} />
          </mesh>
        </group>
      ))}
    </>
  );
}
