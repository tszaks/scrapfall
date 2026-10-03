import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { groundY } from "./terrain";
import { staticBody } from "./staticCollision";
import { meleeGear } from "./travelExtras";
import { showToast } from "./squadState";
import { actionLabel } from "./input/labels";
/** Personal melee pickups stay available to every member of the squad. */
export function MeleeView({
  spawn,
  active,
}: {
  spawn: { x: number; z: number };
  active: React.MutableRefObject<boolean>;
}) {
  const hand = useRef<THREE.Group>(null),
    pickups = useRef<(THREE.Group | null)[]>([]);
  const gear = useMemo(() => {
    meleeGear.name = "WRENCH";
    meleeGear.damage = 3;
    meleeGear.swing = 0;
    return ["BASEBALL BAT", "SKATEBOARD"].map((name, index) => {
      let x = spawn.x,
        z = spawn.z;
      for (let n = 0; n < 48; n++) {
        const angle = ((n + index * 12) * Math.PI) / 12,
          r = 3 + Math.floor(n / 24) * 3;
        const px = spawn.x + Math.cos(angle) * r,
          pz = spawn.z + Math.sin(angle) * r;
        if (!staticBody(px, pz, 0.5, groundY(px, pz), 1.8, 0.2)) {
          x = px;
          z = pz;
          break;
        }
      }
      return { name, x, z, taken: false };
    });
  }, [spawn.x, spawn.z]);
  const offset = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, clock }, dt) => {
    meleeGear.swing = Math.max(0, meleeGear.swing - dt);
    if (hand.current) {
      hand.current.visible = active.current && meleeGear.swing > 0;
      hand.current.children.forEach((child, i) => {
        child.visible =
          i === (meleeGear.name === "BASEBALL BAT" ? 1 : meleeGear.name === "SKATEBOARD" ? 2 : 0);
      });
      offset.set(0.32, -0.35, -0.75).applyQuaternion(camera.quaternion).add(camera.position);
      hand.current.position.copy(offset);
      hand.current.quaternion.copy(camera.quaternion);
      hand.current.rotateX(-1.1 + meleeGear.swing * 5);
      hand.current.rotateZ(-0.6 + meleeGear.swing * 3);
    }
    for (let i = 0; i < gear.length; i++) {
      const g = gear[i]!,
        mesh = pickups.current[i];
      if (!mesh) continue;
      mesh.visible = !g.taken;
      if (g.taken) continue;
      mesh.position.set(g.x, groundY(g.x, g.z) + 0.65, g.z);
      mesh.rotation.y = clock.elapsedTime;
      if (
        active.current &&
        Math.hypot(camera.position.x - g.x, camera.position.z - g.z) < 1.4 &&
        Math.abs(camera.position.y - 1.6 - groundY(g.x, g.z)) < 1.5
      ) {
        g.taken = true;
        meleeGear.name = g.name;
        meleeGear.damage = i ? 5 : 4;
        showToast(`${g.name} · ${actionLabel("melee")} MELEE · UNLIMITED USE`);
      }
    }
  });
  return (
    <>
      <group ref={hand} visible={false}>
        <group>
          <mesh position={[0, 0.25, 0]}>
            <boxGeometry args={[0.07, 0.6, 0.05]} />
            <meshStandardMaterial color="#8c979b" />
          </mesh>
          <mesh position={[0, 0.58, 0]}>
            <torusGeometry args={[0.1, 0.035, 6, 8, Math.PI * 1.6]} />
            <meshStandardMaterial color="#8c979b" />
          </mesh>
        </group>
        <mesh position={[0, 0.35, 0]}>
          <cylinderGeometry args={[0.075, 0.035, 0.9, 8]} />
          <meshStandardMaterial color="#ba8951" />
        </mesh>
        <mesh position={[0, 0.3, 0]}>
          <boxGeometry args={[0.25, 0.75, 0.06]} />
          <meshStandardMaterial color="#d06036" />
        </mesh>
      </group>
      {gear.map((g, i) => (
        <group
          key={g.name}
          ref={(el) => {
            pickups.current[i] = el;
          }}
        >
          {i === 0 ? (
            <mesh>
              <cylinderGeometry args={[0.075, 0.035, 0.9, 8]} />
              <meshStandardMaterial color="#ba8951" />
            </mesh>
          ) : (
            <group>
              <mesh>
                <boxGeometry args={[0.22, 0.06, 0.7]} />
                <meshStandardMaterial color="#d06036" />
              </mesh>
              {[-0.23, 0.23].map((z) => (
                <mesh key={z} position={[0, -0.07, z]} rotation={[0, 0, Math.PI / 2]}>
                  <cylinderGeometry args={[0.045, 0.045, 0.3, 8]} />
                  <meshStandardMaterial color="#222" />
                </mesh>
              ))}
            </group>
          )}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.55, 0]}>
            <ringGeometry args={[0.4, 0.48, 16]} />
            <meshBasicMaterial color="#f5d167" />
          </mesh>
        </group>
      ))}
    </>
  );
}
