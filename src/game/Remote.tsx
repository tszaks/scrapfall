import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { newPlayerRig } from "@/bro/game/art/player";
import * as THREE from "three";

import type { RemoteState } from "./net";

const MAX_REMOTE = 3;
const PIPS = 10;

/** Low-poly teammate avatars, driven imperatively from the shared map. */
export function RemotePlayers({ remotes }: { remotes: React.MutableRefObject<Map<string, RemoteState>> }) {
  const groups = useRef<(THREE.Group | null)[]>([]);
  const visors = useRef<(THREE.Mesh | null)[]>([]);
  const pips = useRef<(THREE.Mesh | null)[][]>([]);
  // his scavenger character: skinned, with walk, idle, airborne and aim animations
  const rigs = useMemo(() => Array.from({ length: MAX_REMOTE }, newPlayerRig), []);
  useEffect(() => () => rigs.forEach((r) => r.dispose()), [rigs]);

  useFrame((state, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const list = [...remotes.current.values()].slice(0, MAX_REMOTE);
    for (let i = 0; i < MAX_REMOTE; i++) {
      const g = groups.current[i];
      if (!g) continue;
      const p = list[i];
      // downed teammates are spectating: invisible to everyone
      g.visible = !!p && p.hp > 0;
      if (!p || p.hp <= 0) continue;

      const k = Math.min(1, delta * 12);
      p.rx += (p.x - p.rx) * k;
      p.rz += (p.z - p.rz) * k;
      let dy = p.yaw - p.ry;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      p.ry += dy * k;
      g.position.set(p.rx, g.position.y, p.rz);
      // camera yaw 0 looks down -Z, so spin the avatar to face the way they're looking
      g.rotation.set(0, p.ry + Math.PI, 0);
      const rig = rigs[i]!;
      p.ry2 = (p.ry2 ?? 0) + ((p.y ?? 0) - (p.ry2 ?? 0)) * k;
      g.position.y = p.ry2;
      rig.pose.airborne = !!p.air;
      rig.pose.seated = !!p.seat;
      rig.update(state.clock.elapsedTime, delta, p.rx, p.rz, p.kick ?? 0, p.pitch ?? 0, 0);
      const visor = visors.current[i];
      if (visor) (visor.material as THREE.MeshBasicMaterial).color.set(p.color);
      const row = pips.current[i];
      if (row) {
        for (let j = 0; j < PIPS; j++) {
          const m = row[j];
          if (!m) continue;
          const on = j < Math.round(Math.max(0, Math.min(PIPS, p.hp)));
          const mat = m.material as THREE.MeshBasicMaterial;
          mat.opacity = on ? 1 : 0.18;
          mat.transparent = true;
        }
      }
    }
  });

  return (
    <>
      {Array.from({ length: MAX_REMOTE }, (_, i) => (
        <group key={i} ref={(g) => { groups.current[i] = g; }} visible={false}>
          <primitive object={rigs[i]!.mesh} dispose={null} />
          {/* teammate colour tag above the head */}
          <mesh ref={(m) => { visors.current[i] = m; }} position={[0, 2.25, 0]} rotation-z={Math.PI / 4}>
            <planeGeometry args={[0.12, 0.12]} />
            <meshBasicMaterial color="#ffffff" fog={false} side={THREE.DoubleSide} />
          </mesh>
          {/* black diamond health pips floating over the head */}
          <group position-y={2.05}>
            {Array.from({ length: PIPS }, (_, j) => (
              <mesh
                key={j}
                ref={(m) => {
                  if (!pips.current[i]) pips.current[i] = [];
                  pips.current[i]![j] = m;
                }}
                position={[(j - (PIPS - 1) / 2) * 0.13, 0, 0]}
                rotation-z={Math.PI / 4}
              >
                <planeGeometry args={[0.085, 0.085]} />
                <meshBasicMaterial color="#000000" fog={false} transparent side={THREE.DoubleSide} />
              </mesh>
            ))}
          </group>
        </group>
      ))}
    </>
  );
}
