// Whiteout Pass's map-exclusive enemies.
//   RIDGE RAIDER (special): a rogue ski patroller in white camo who carves in on skis,
//     fans thrown ice picks at mid range and jabs with a pole up close.
//   THE AVALANCHE ENGINE (boss): a tracked snow-plough war machine with a V blade, a
//     snow-blower chute, amber beacons and a glowing cab; it ploughs straight at you.
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type * as THREE from "three";

import type { Theme } from "../themes";

export function SkierModel({
  theme,
  data,
}: {
  theme: Theme;
  data: { x: number; z: number; aux?: number };
}) {
  const sp = theme.special;
  const body = useRef<THREE.Group>(null);
  const poles = useRef<THREE.Group>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime + data.x * 0.1;
    // a carving crouch: lean into the turn, poles planting
    if (body.current) {
      body.current.rotation.z = Math.sin(t * 2.6) * 0.28;
      body.current.position.y = 0.05 + Math.abs(Math.sin(t * 2.6)) * 0.06;
    }
    if (poles.current) poles.current.rotation.x = -0.4 + Math.sin(t * 5.2) * 0.35;
  });
  const B = <meshLambertMaterial color={sp.body} flatShading />;
  const A = <meshLambertMaterial color={sp.accent} flatShading />;
  const G = <meshBasicMaterial color={sp.glow} />;
  const dark = <meshLambertMaterial color="#1e2430" flatShading />;
  return (
    <group>
      {/* skis */}
      {[-0.17, 0.17].map((x) => (
        <group key={x} position={[x, 0.05, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.11, 0.04, 1.75]} />
            {A}
          </mesh>
          <mesh position={[0, 0.06, 0.86]} rotation-x={-0.6}>
            <boxGeometry args={[0.11, 0.04, 0.18]} />
            {A}
          </mesh>
        </group>
      ))}
      <group ref={body}>
        {/* boots and crouched legs */}
        {[-0.17, 0.17].map((x) => (
          <group key={`l${x}`}>
            <mesh position={[x, 0.2, 0]}>
              <boxGeometry args={[0.16, 0.26, 0.3]} />
              {dark}
            </mesh>
            <mesh position={[x, 0.52, 0.08]} rotation-x={0.5}>
              <boxGeometry args={[0.17, 0.46, 0.2]} />
              {B}
            </mesh>
          </group>
        ))}
        {/* torso leaning forward, white camo jacket with a blue stripe */}
        <mesh position={[0, 1.02, 0.08]} rotation-x={0.35} castShadow>
          <boxGeometry args={[0.52, 0.66, 0.34]} />
          {B}
        </mesh>
        <mesh position={[0, 1.0, 0.27]} rotation-x={0.35}>
          <boxGeometry args={[0.54, 0.1, 0.05]} />
          {A}
        </mesh>
        <mesh position={[0, 1.02, -0.14]} rotation-x={0.35}>
          <boxGeometry args={[0.34, 0.44, 0.16]} />
          {dark}
        </mesh>
        {/* helmet and glowing goggles */}
        <mesh position={[0, 1.5, 0.2]}>
          <sphereGeometry args={[0.2, 8, 6]} />
          {A}
        </mesh>
        <mesh position={[0, 1.5, 0.37]}>
          <boxGeometry args={[0.3, 0.1, 0.06]} />
          {G}
        </mesh>
        {/* arms and poles */}
        <group ref={poles} position={[0, 1.2, 0.18]}>
          {[-0.34, 0.34].map((x) => (
            <group key={`p${x}`} position={[x, 0, 0]}>
              <mesh position={[0, -0.15, 0.1]} rotation-x={0.6}>
                <boxGeometry args={[0.12, 0.42, 0.12]} />
                {B}
              </mesh>
              <mesh position={[0, -0.55, 0.28]} rotation-x={0.35}>
                <cylinderGeometry args={[0.018, 0.018, 1.25, 4]} />
                {dark}
              </mesh>
              <mesh position={[0, -1.1, 0.48]} rotation-x={Math.PI / 2}>
                <torusGeometry args={[0.07, 0.015, 3, 8]} />
                {G}
              </mesh>
            </group>
          ))}
        </group>
      </group>
    </group>
  );
}

export function PloughBody({ theme }: { theme: Theme }) {
  const b = theme.boss;
  const beacons = useRef<THREE.Group>(null);
  const auger = useRef<THREE.Group>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (beacons.current) beacons.current.rotation.y = t * 6;
    if (auger.current) auger.current.rotation.x = t * 9;
  });
  const skin = <meshLambertMaterial color={b.body} flatShading />;
  const limb = <meshLambertMaterial color={b.limb} flatShading />;
  const steel = <meshLambertMaterial color={b.weapon} flatShading />;
  const glow = <meshBasicMaterial color={b.glow} fog={false} />;
  const eye = <meshBasicMaterial color={b.eye} fog={false} />;
  return (
    <group>
      {/* tracks */}
      {[-1.05, 1.05].map((x) => (
        <group key={x} position={[x, 0.45, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.7, 0.9, 3.2]} />
            {limb}
          </mesh>
          {[-1.2, -0.4, 0.4, 1.2].map((z) => (
            <mesh key={z} position={[x > 0 ? 0.36 : -0.36, 0, z]} rotation-z={Math.PI / 2}>
              <cylinderGeometry args={[0.3, 0.3, 0.05, 8]} />
              {steel}
            </mesh>
          ))}
        </group>
      ))}
      {/* hull and engine deck */}
      <mesh position={[0, 1.3, -0.1]} castShadow>
        <boxGeometry args={[2.1, 1.0, 3.0]} />
        {skin}
      </mesh>
      <mesh position={[0, 1.95, -0.9]} castShadow>
        <boxGeometry args={[1.8, 0.5, 1.3]} />
        {limb}
      </mesh>
      {/* armoured cab with a glowing visor (the "face") */}
      <mesh position={[0, 2.35, 0.45]} castShadow>
        <boxGeometry args={[1.5, 1.1, 1.2]} />
        {skin}
      </mesh>
      <mesh position={[0, 2.45, 1.06]}>
        <boxGeometry args={[1.25, 0.34, 0.06]} />
        {eye}
      </mesh>
      {/* V plough blade across the front */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.72, 0.75, 1.95]} rotation-y={-s * 0.5} castShadow>
          <boxGeometry args={[1.7, 1.4, 0.18]} />
          {steel}
        </mesh>
      ))}
      <mesh position={[0, 0.2, 2.05]}>
        <boxGeometry args={[2.9, 0.14, 0.5]} />
        {glow}
      </mesh>
      {/* snow-blower auger and its chute */}
      <group ref={auger} position={[0, 0.7, 2.25]}>
        <mesh rotation-z={Math.PI / 2}>
          <cylinderGeometry args={[0.28, 0.28, 2.2, 6]} />
          {limb}
        </mesh>
      </group>
      <mesh position={[0.7, 2.6, 1.2]} rotation-x={-0.5}>
        <cylinderGeometry args={[0.2, 0.26, 1.6, 7]} />
        {steel}
      </mesh>
      {/* exhaust stacks */}
      {[-0.6, 0.6].map((x) => (
        <mesh key={`e${x}`} position={[x, 2.6, -1.3]}>
          <cylinderGeometry args={[0.1, 0.12, 0.9, 6]} />
          {limb}
        </mesh>
      ))}
      {/* spinning amber beacons */}
      <group ref={beacons} position={[0, 3.05, 0.45]}>
        {[-0.55, 0.55].map((x) => (
          <mesh key={`b${x}`} position={[x, 0, 0]}>
            <boxGeometry args={[0.22, 0.2, 0.22]} />
            {glow}
          </mesh>
        ))}
      </group>
      {/* hazard stripes on the hull sides */}
      {[-1.07, 1.07].map((x) => (
        <mesh key={`h${x}`} position={[x, 1.3, 0.8]}>
          <boxGeometry args={[0.04, 0.3, 1.2]} />
          {limb}
        </mesh>
      ))}
    </group>
  );
}
