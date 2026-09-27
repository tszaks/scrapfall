// Dry Gulch's own enemies: the DESPERADO (the map's special: poncho, sombrero, twin
// revolvers, a quick-draw telegraph and then a fast double shot) and THE IRON MARSHAL (the
// boss: a steam-powered robot sheriff with a Gatling arm and a lasso, who arrives by train).
// Models are dressed onto the game's shared enemy/boss bodies; the behaviour hooks are called
// from the game's enemy loop so every rule stays next to the others.
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type * as THREE from "three";

type Colors = { body: string; accent: string; glow: string };
type BossColors = { body: string; limb: string; eye: string; weapon: string; glow: string };

/** The Desperado: a gunslinger robot in a striped poncho and a wide sombrero. `drawing`
 * (the synced aux flag) raises both revolvers and flashes the glint before it fires. */
export function DesperadoModel({ sp, data }: { sp: Colors; data: { aux?: number } }) {
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const glint = useRef<THREE.Group>(null);
  const poncho = useRef<THREE.Group>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const drawing = (data.aux ?? 0) > 0;
    const target = drawing ? -1.45 : -0.15;
    for (const a of [armL.current, armR.current])
      if (a) a.rotation.x += (target - a.rotation.x) * 0.35;
    if (glint.current) {
      glint.current.visible = drawing && Math.floor(t * 14) % 2 === 0;
    }
    if (poncho.current) poncho.current.rotation.z = Math.sin(t * 3.1) * 0.04;
  });
  const B = <meshLambertMaterial color={sp.body} flatShading />;
  const A = <meshLambertMaterial color={sp.accent} flatShading />;
  const G = <meshBasicMaterial color={sp.glow} />;
  return (
    <group>
      {/* legs and boots */}
      {[-0.18, 0.18].map((x) => (
        <group key={x}>
          <mesh position={[x, 0.42, 0]} castShadow>
            <boxGeometry args={[0.2, 0.8, 0.22]} />
            <meshLambertMaterial color="#3a2e28" flatShading />
          </mesh>
          <mesh position={[x, 0.08, 0.05]}>
            <boxGeometry args={[0.24, 0.16, 0.36]} />
            <meshLambertMaterial color="#2a1e16" flatShading />
          </mesh>
        </group>
      ))}
      {/* the torso under a striped poncho */}
      <mesh position-y={1.2} castShadow>
        <boxGeometry args={[0.55, 0.7, 0.34]} />
        {A}
      </mesh>
      <group ref={poncho} position-y={1.25}>
        <mesh castShadow>
          <coneGeometry args={[0.72, 0.9, 4, 1, true]} />
          {B}
        </mesh>
        {[0.12, -0.08, -0.26].map((y, i) => (
          <mesh key={y} position-y={y}>
            <cylinderGeometry args={[0.47 + i * 0.1, 0.52 + i * 0.1, 0.07, 4, 1, true]} />
            <meshLambertMaterial color={i % 2 ? "#e8d8a8" : "#2a6a6a"} flatShading />
          </mesh>
        ))}
      </group>
      {/* head: a riveted drum with a glowing visor */}
      <mesh position-y={1.86} castShadow>
        <cylinderGeometry args={[0.2, 0.22, 0.34, 8]} />
        <meshLambertMaterial color="#6a6a70" flatShading />
      </mesh>
      <mesh position={[0, 1.88, 0.18]}>
        <boxGeometry args={[0.28, 0.06, 0.06]} />
        {G}
      </mesh>
      {/* sombrero */}
      <mesh position-y={2.05} castShadow>
        <cylinderGeometry args={[0.62, 0.62, 0.05, 16]} />
        {B}
      </mesh>
      <mesh position-y={2.2}>
        <cylinderGeometry args={[0.13, 0.22, 0.3, 12]} />
        {B}
      </mesh>
      <mesh position-y={2.08}>
        <torusGeometry args={[0.22, 0.03, 4, 16]} />
        <meshLambertMaterial color="#c8a040" />
      </mesh>
      {/* bandolier */}
      <mesh position={[0, 1.28, 0.2]} rotation-z={0.7}>
        <boxGeometry args={[0.1, 0.9, 0.04]} />
        <meshLambertMaterial color="#6a4a2a" />
      </mesh>
      {/* arms with a revolver in each hand */}
      {(
        [
          [-0.38, armL],
          [0.38, armR],
        ] as const
      ).map(([x, ref]) => (
        <group key={x} ref={ref} position={[x, 1.5, 0]}>
          <mesh position-y={-0.3}>
            <boxGeometry args={[0.14, 0.6, 0.14]} />
            {A}
          </mesh>
          <group position={[0, -0.6, 0.05]}>
            <mesh>
              <boxGeometry args={[0.06, 0.14, 0.12]} />
              <meshLambertMaterial color="#5a3a22" />
            </mesh>
            <mesh position={[0, -0.05, 0.16]}>
              <boxGeometry args={[0.05, 0.05, 0.3]} />
              <meshLambertMaterial color="#8a8a90" />
            </mesh>
          </group>
        </group>
      ))}
      {/* the quick-draw glint */}
      <group ref={glint} visible={false} position={[0, 1.4, 0.7]}>
        <mesh>
          <octahedronGeometry args={[0.12, 0]} />
          <meshBasicMaterial color="#fff6c0" />
        </mesh>
        <mesh position-x={0.4}>
          <octahedronGeometry args={[0.12, 0]} />
          <meshBasicMaterial color="#fff6c0" />
        </mesh>
      </group>
    </group>
  );
}

/** The Iron Marshal's dressing on the shared boss body: a cowboy hat, a smokestack, a gilded
 * star, the Gatling arm (right) and the lasso coil (left). */
export function IronMarshalParts({ b }: { b: BossColors }) {
  const gun = useRef<THREE.Group>(null);
  const smoke = useRef<THREE.Group>(null);
  useFrame((state, dt) => {
    if (gun.current) gun.current.rotation.z += dt * 14;
    if (smoke.current) {
      const t = state.clock.elapsedTime;
      smoke.current.children.forEach((c, i) => {
        const k = (t * 0.8 + i / 3) % 1;
        c.position.y = 3.9 + k * 1.6;
        c.scale.setScalar(0.25 + k * 0.6);
      });
    }
  });
  const iron = <meshLambertMaterial color={b.body} flatShading />;
  const dark = <meshLambertMaterial color={b.limb} flatShading />;
  const brass = <meshLambertMaterial color="#c8a040" flatShading />;
  return (
    <group>
      {/* the hat */}
      <mesh position={[0, 3.2, 0]} castShadow>
        <cylinderGeometry args={[1.05, 1.05, 0.1, 18]} />
        {dark}
      </mesh>
      <mesh position={[0, 3.5, 0]} castShadow>
        <cylinderGeometry args={[0.46, 0.56, 0.55, 12]} />
        {dark}
      </mesh>
      <mesh position={[0, 3.28, 0]}>
        <torusGeometry args={[0.56, 0.05, 4, 16]} />
        {brass}
      </mesh>
      {/* the smokestack on its back and a trail of steam */}
      <mesh position={[0.45, 3.1, -0.55]}>
        <cylinderGeometry args={[0.16, 0.16, 1.4, 8]} />
        {dark}
      </mesh>
      <mesh position={[0.45, 3.85, -0.55]}>
        <cylinderGeometry args={[0.28, 0.16, 0.3, 8]} />
        {dark}
      </mesh>
      <group ref={smoke} position={[0.45, 0, -0.55]}>
        {[0, 1, 2].map((i) => (
          <mesh key={i}>
            <sphereGeometry args={[1, 8, 6]} />
            <meshLambertMaterial color="#d8d0c8" transparent opacity={0.45} />
          </mesh>
        ))}
      </group>
      {/* gilded sheriff's star on the chest */}
      <mesh position={[0.35, 1.75, 0.62]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.32, 0.32, 0.06, 5]} />
        <meshBasicMaterial color={b.glow} />
      </mesh>
      {/* boiler bands and rivets */}
      {[0.7, 1.2, 1.9].map((y) => (
        <mesh key={y} position-y={y}>
          <boxGeometry args={[1.78, 0.08, 1.28]} />
          {brass}
        </mesh>
      ))}
      {/* the Gatling arm: a six-barrel cluster where the right hand should be */}
      <group position={[0.98, 1.2, 0.5]}>
        <mesh rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.3, 0.3, 0.5, 10]} />
          {iron}
        </mesh>
        <group ref={gun} position={[0, 0, 0.5]}>
          {Array.from({ length: 6 }, (_, i) => {
            const a = (i / 6) * Math.PI * 2;
            return (
              <mesh
                key={i}
                position={[Math.cos(a) * 0.17, Math.sin(a) * 0.17, 0.4]}
                rotation-x={Math.PI / 2}
              >
                <cylinderGeometry args={[0.05, 0.05, 1.1, 6]} />
                <meshLambertMaterial color={b.weapon} />
              </mesh>
            );
          })}
        </group>
        <mesh position={[0, 0, 1.05]}>
          <torusGeometry args={[0.24, 0.04, 4, 12]} />
          <meshBasicMaterial color={b.glow} />
        </mesh>
      </group>
      {/* the lasso coil on the left */}
      <mesh position={[-1.05, 0.55, 0.3]} rotation-y={Math.PI / 2}>
        <torusGeometry args={[0.36, 0.05, 5, 16]} />
        <meshLambertMaterial color="#c8a878" />
      </mesh>
      <mesh position={[-1.05, 0.55, 0.3]} rotation-y={Math.PI / 2}>
        <torusGeometry args={[0.27, 0.04, 5, 16]} />
        <meshLambertMaterial color="#b89868" />
      </mesh>
    </group>
  );
}
