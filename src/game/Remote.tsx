import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";

import type { RemoteState } from "./net";

const MAX_REMOTE = 3;

/** Low-poly teammate avatars, driven imperatively from the shared map. */
export function RemotePlayers({ remotes }: { remotes: React.MutableRefObject<Map<string, RemoteState>> }) {
  const groups = useRef<(THREE.Group | null)[]>([]);
  const visors = useRef<(THREE.Mesh | null)[]>([]);
  const bars = useRef<(THREE.Mesh | null)[]>([]);

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const list = [...remotes.current.values()].slice(0, MAX_REMOTE);
    for (let i = 0; i < MAX_REMOTE; i++) {
      const g = groups.current[i];
      if (!g) continue;
      const p = list[i];
      g.visible = !!p;
      if (!p) continue;
      const k = Math.min(1, delta * 12);
      p.rx += (p.x - p.rx) * k;
      p.rz += (p.z - p.rz) * k;
      let dy = p.yaw - p.ry;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      p.ry += dy * k;
      g.position.set(p.rx, p.hp > 0 ? 0 : -0.6, p.rz);
      g.rotation.set(p.hp > 0 ? 0 : 1.3, p.ry, 0);
      const visor = visors.current[i];
      if (visor) (visor.material as THREE.MeshBasicMaterial).color.set(p.color);
      const bar = bars.current[i];
      if (bar) {
        const frac = Math.max(0, Math.min(1, p.hp / 10));
        bar.scale.x = Math.max(0.001, frac);
        bar.position.x = -(1 - frac) * 0.5;
        (bar.material as THREE.MeshBasicMaterial).color.set(frac > 0.3 ? p.color : "#b3261e");
      }
    }
  });

  return (
    <>
      {Array.from({ length: MAX_REMOTE }, (_, i) => (
        <group key={i} ref={(g) => { groups.current[i] = g; }} visible={false}>
          <mesh position-y={0.95} castShadow>
            <boxGeometry args={[0.8, 1.2, 0.5]} />
            <meshLambertMaterial color="#5c6270" flatShading />
          </mesh>
          <mesh position-y={1.85} castShadow>
            <boxGeometry args={[0.6, 0.55, 0.55]} />
            <meshLambertMaterial color="#8a919e" flatShading />
          </mesh>
          <mesh ref={(m) => { visors.current[i] = m; }} position={[0, 1.88, 0.29]}>
            <boxGeometry args={[0.44, 0.16, 0.04]} />
            <meshBasicMaterial color="#4fe3ff" fog={false} />
          </mesh>
          <mesh position={[0.3, 0.3, 0]} castShadow>
            <boxGeometry args={[0.22, 0.9, 0.22]} />
            <meshLambertMaterial color="#454a55" flatShading />
          </mesh>
          <mesh position={[-0.3, 0.3, 0]} castShadow>
            <boxGeometry args={[0.22, 0.9, 0.22]} />
            <meshLambertMaterial color="#454a55" flatShading />
          </mesh>
          <mesh position={[0.45, 1.1, 0.3]} rotation-x={Math.PI / 2}>
            <boxGeometry args={[0.14, 0.6, 0.14]} />
            <meshLambertMaterial color="#2f2f33" flatShading />
          </mesh>
          <group position-y={2.45}>
            <mesh>
              <planeGeometry args={[1, 0.12]} />
              <meshBasicMaterial color="#2b2118" fog={false} side={THREE.DoubleSide} />
            </mesh>
            <mesh ref={(m) => { bars.current[i] = m; }} position-z={0.01}>
              <planeGeometry args={[1, 0.1]} />
              <meshBasicMaterial color="#4fe3ff" fog={false} side={THREE.DoubleSide} />
            </mesh>
          </group>
        </group>
      ))}
    </>
  );
}
