import { myVehicle } from "./driving";
import { wheelWorld, wheelEye } from "./beach/wheelRide";
import { createPortal, useFrame } from "@react-three/fiber";
import { groundY } from "./terrain";
import { remoteFloorY } from "./access/world";
import { alpine } from "./alpine/weather";
import { riderEye } from "./alpine/ride";
import { useEffect, useMemo, useRef, useState } from "react";
import { remoteGunRoots } from "./art/muzzle";
import { newPlayerRig } from "./art/player";
import * as THREE from "three";

import type { RemoteState } from "./net";
import { REMOTE_SHOT } from "./projectiles";
import { DOWN, squad } from "./revive";

const MAX_REMOTE = 3;
const PIPS = 10;

/** Low-poly teammate avatars, driven imperatively from the shared map. */
export function RemotePlayers({
  remotes,
  renderGun,
}: {
  remotes: React.MutableRefObject<Map<string, RemoteState>>;
  renderGun: (weapon: string) => React.ReactNode;
}) {
  const groups = useRef<(THREE.Group | null)[]>([]);
  const visors = useRef<(THREE.Mesh | null)[]>([]);
  const rigs = useMemo(() => Array.from({ length: MAX_REMOTE }, newPlayerRig), []);
  const [weapons, setWeapons] = useState<string[]>(["pistol", "pistol", "pistol"]);
  const weaponRef = useRef(weapons);
  useEffect(
    () => () => {
      rigs.forEach((r) => r.dispose());
      remoteGunRoots.clear();
    },
    [rigs],
  );
  const pips = useRef<(THREE.Mesh | null)[][]>([]);

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    remoteGunRoots.clear();
    // a teammate we haven't heard from in 6 s is gone (the network drops them shortly)
    const now = performance.now();
    const list = [...remotes.current.values()]
      .filter((r) => now - r.last < 6000)
      .slice(0, MAX_REMOTE);
    for (let i = 0; i < MAX_REMOTE; i++) {
      const g = groups.current[i];
      if (!g) continue;
      const p = list[i];
      // a DOWN teammate lies on the ground waiting for a revive; a dead one is spectating
      // (invisible to everyone) until the next wave
      const down = !!p && p.hp <= 0 && squad.get(p.id)?.st === DOWN;
      const car = p ? myVehicle(p.id) : null;
      const driving = !!car;
      g.visible = !!p && (p.hp > 0 || down) && !driving;
      g.userData["playerId"] = p?.id;
      if (p && car) {
        p.rx = car.x;
        p.rz = car.z;
        p.ry = p.yaw;
        g.userData["driving"] = true;
        continue;
      }
      if (!p || (p.hp <= 0 && !down)) continue;
      if (g.userData["driving"]) {
        p.rx = p.x;
        p.rz = p.z;
        p.ry = p.yaw;
        g.userData["driving"] = false;
      }

      const k = Math.min(1, delta * 12);
      p.rx += (p.x - p.rx) * k;
      p.rz += (p.z - p.rz) * k;
      let dy = p.yaw - p.ry;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      p.ry += dy * k;
      // a teammate riding the chairlift sits on their chair (its position is the shared lift clock)
      const lift = alpine.active ? alpine.lift : null;
      if (wheelWorld.wheel && (p.wr ?? -1) >= 0 && !down) {
        const e = wheelEye(wheelWorld.wheel, p.wr!);
        p.rx = e.x;
        p.rz = e.z;
        g.position.set(e.x, e.y - 1.6, e.z);
      } else if (lift && (p.rc ?? -1) >= 0 && !down) {
        const e = riderEye(lift, p.rc!, p.rs);
        p.rx = e.x;
        p.rz = e.z;
        g.position.set(e.x, e.y - 1.6, e.z);
      } else {
        // on a roof, in a lobby or riding a car: the height they report (riders follow the car)
        const gy = groundY(p.rx, p.rz);
        // (+ their jump: feet above the ground, input/movement.ts)
        g.position.set(
          p.rx,
          (p.sy ?? (p.az ? remoteFloorY(p.az, p.ay, gy) : gy)) + (down ? 0.3 : (p.jy ?? 0)),
          p.rz,
        );
      }
      // camera yaw 0 looks down -Z, so spin the avatar to face the way they're looking
      g.rotation.order = "YXZ";
      g.rotation.set(
        down ? -Math.PI / 2 : 0,
        p.ry + Math.PI,
        down ? Math.sin(performance.now() / 400) * 0.08 : 0,
      );
      const since = (performance.now() - (REMOTE_SHOT.get(p.id) ?? -1e9)) / 1000;
      rigs[i]!.pose.seated = (p.rc ?? -1) >= 0;
      rigs[i]!.pose.airborne = (p.jy ?? 0) > 0.1;
      rigs[i]!.update(
        now / 1000,
        delta,
        p.rx,
        p.rz,
        Math.max(0, 1 - since / 0.12),
        -(p.pitch ?? 0),
        0,
      );
      if (weaponRef.current[i] !== p.weapon) {
        const next = [...weaponRef.current];
        next[i] = p.weapon;
        weaponRef.current = next;
        setWeapons(next);
      }
      remoteGunRoots.set(p.id, g);
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
        <group
          key={i}
          ref={(g) => {
            groups.current[i] = g;
          }}
          visible={false}
        >
          <primitive object={rigs[i]!.mesh} dispose={null} />
          {createPortal(
            <>
              <mesh
                ref={(m) => {
                  visors.current[i] = m;
                }}
                position={[0, 0.18, 0.178]}
              >
                <boxGeometry args={[0.26, 0.06, 0.012]} />
                <meshBasicMaterial color="#ffffff" fog={false} />
              </mesh>
            </>,
            rigs[i]!.byName["head"]!,
          )}
          {createPortal(
            <group rotation-y={Math.PI} scale={0.65}>
              {renderGun(weapons[i] ?? "pistol")}
            </group>,
            rigs[i]!.byName["hands"]!,
          )}
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
                <meshBasicMaterial
                  color="#000000"
                  fog={false}
                  transparent
                  side={THREE.DoubleSide}
                />
              </mesh>
            ))}
          </group>
        </group>
      ))}
    </>
  );
}
