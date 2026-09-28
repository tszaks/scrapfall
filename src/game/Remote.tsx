import { useFrame } from "@react-three/fiber";
import { groundY } from "./terrain";
import { remoteFloorY } from "./access/world";
import { alpine } from "./alpine/weather";
import { riderEye } from "./alpine/ride";
import { useRef } from "react";
import * as THREE from "three";

import type { RemoteState } from "./net";
import { REMOTE_SHOT } from "./projectiles";
import { DOWN, squad } from "./revive";

const MAX_REMOTE = 3;
const PIPS = 10;

/** Low-poly teammate avatars, driven imperatively from the shared map. */
export function RemotePlayers({ remotes }: { remotes: React.MutableRefObject<Map<string, RemoteState>> }) {
  const groups = useRef<(THREE.Group | null)[]>([]);
  const visors = useRef<(THREE.Mesh | null)[]>([]);
  const pips = useRef<(THREE.Mesh | null)[][]>([]);
  const guns = useRef<(THREE.Mesh | null)[]>([]);

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    // a teammate we haven't heard from in 6 s is gone (the network drops them shortly)
    const now = performance.now();
    const list = [...remotes.current.values()].filter((r) => now - r.last < 6000).slice(0, MAX_REMOTE);
    for (let i = 0; i < MAX_REMOTE; i++) {
      const g = groups.current[i];
      if (!g) continue;
      const p = list[i];
      // a DOWN teammate lies on the ground waiting for a revive; a dead one is spectating
      // (invisible to everyone) until the next wave
      const down = !!p && p.hp <= 0 && squad.get(p.id)?.st === DOWN;
      g.visible = !!p && (p.hp > 0 || down);
      if (!p || (p.hp <= 0 && !down)) continue;

      const k = Math.min(1, delta * 12);
      p.rx += (p.x - p.rx) * k;
      p.rz += (p.z - p.rz) * k;
      let dy = p.yaw - p.ry;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      p.ry += dy * k;
      // a teammate riding the chairlift sits on their chair (its position is the shared lift clock)
      const lift = alpine.active ? alpine.lift : null;
      if (lift && (p.rc ?? -1) >= 0 && !down) {
        const e = riderEye(lift, p.rc!);
        p.rx = e.x;
        p.rz = e.z;
        g.position.set(e.x, e.y - 1.25, e.z);
      } else {
        // on a roof, in a lobby or riding a car: the height they report (riders follow the car)
        const gy = groundY(p.rx, p.rz);
        // (+ their jump: feet above the ground, input/movement.ts)
        g.position.set(p.rx, (p.az ? remoteFloorY(p.az, p.ay, gy) : gy) + (down ? 0.3 : (p.jy ?? 0)), p.rz);
      }
      // camera yaw 0 looks down -Z, so spin the avatar to face the way they're looking
      g.rotation.order = "YXZ";
      g.rotation.set(down ? -Math.PI / 2 : 0, p.ry + Math.PI, down ? Math.sin(performance.now() / 400) * 0.08 : 0);
      // their gun kicks back when they fire (projectiles.tsx replays the shot itself)
      const gun = guns.current[i];
      if (gun) {
        const since = (performance.now() - (REMOTE_SHOT.get(p.id) ?? -1e9)) / 1000;
        gun.position.z = 0.3 - Math.max(0, 1 - since / 0.12) * 0.12;
      }
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
            <meshBasicMaterial color="#ffffff" fog={false} />
          </mesh>
          <mesh position={[0.3, 0.3, 0]} castShadow>
            <boxGeometry args={[0.22, 0.9, 0.22]} />
            <meshLambertMaterial color="#454a55" flatShading />
          </mesh>
          <mesh position={[-0.3, 0.3, 0]} castShadow>
            <boxGeometry args={[0.22, 0.9, 0.22]} />
            <meshLambertMaterial color="#454a55" flatShading />
          </mesh>
          <mesh ref={(m) => { guns.current[i] = m; }} position={[0.45, 1.1, 0.3]} rotation-x={Math.PI / 2}>
            <boxGeometry args={[0.14, 0.6, 0.14]} />
            <meshLambertMaterial color="#2f2f33" flatShading />
          </mesh>
          {/* black diamond health pips floating over the head */}
          <group position-y={2.45}>
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
