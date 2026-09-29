import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import * as THREE from "three";
import type { CityLayout } from "./cityLayout";

/** Batched streams, pooled spray and expanding ripples above a recessed masonry basin. */
function Fountain({ x, z, radius }: { x: number; z: number; radius: number }) {
  const drops = useRef<THREE.InstancedMesh>(null),
    ripples = useRef<THREE.InstancedMesh>(null);
  const water = useMemo(() => {
    const paths = Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * Math.PI * 2;
      return new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(Math.cos(a) * radius * 0.23, 2.03, Math.sin(a) * radius * 0.23),
        new THREE.Vector3(Math.cos(a) * radius * 0.48, 2.1, Math.sin(a) * radius * 0.48),
        new THREE.Vector3(Math.cos(a) * radius * 0.58, 0.501, Math.sin(a) * radius * 0.58),
      );
    });
    const tubes = paths.map((p) => new THREE.TubeGeometry(p, 18, 0.026, 5, false));
    const streams = mergeGeometries(tubes)!;
    tubes.forEach((g) => g.dispose());
    const time = { value: 0 };
    const material = new THREE.MeshStandardMaterial({
      color: "#699fa6",
      roughness: 0.2,
      metalness: 0.32,
      transparent: true,
      opacity: 0.84,
    });
    material.onBeforeCompile = (shader) => {
      shader.uniforms["uFountainTime"] = time;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec2 vWaterPlane;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWaterPlane = position.xy;");
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nuniform float uFountainTime;\nvarying vec2 vWaterPlane;",
        )
        .replace(
          "#include <normal_fragment_maps>",
          `#include <normal_fragment_maps>
        float waveA=sin(vWaterPlane.x*12.0+vWaterPlane.y*8.0-uFountainTime*2.2);
        float waveB=cos(length(vWaterPlane)*18.0-uFountainTime*3.4);
        normal=normalize(normal+vec3(waveA*.035,waveB*.035,0.0));
        diffuseColor.rgb *= .96+.04*waveB;
      `,
        );
    };
    material.customProgramCacheKey = () => "fountain-ripples-v1";
    return { paths, streams, material, time };
  }, [radius]);
  const m = useMemo(() => new THREE.Matrix4(), []),
    p = useMemo(() => new THREE.Vector3(), []),
    q = useMemo(() => new THREE.Quaternion(), []),
    s = useMemo(() => new THREE.Vector3(), []);
  const flat = useMemo(
    () => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2),
    [],
  );
  useEffect(
    () => () => {
      water.streams.dispose();
      water.material.dispose();
    },
    [water],
  );
  useFrame(({ clock, camera }) => {
    if (Math.hypot(camera.position.x - x, camera.position.z - z) > 140) return;
    const t = clock.elapsedTime;
    water.time.value = t;
    if (drops.current) {
      for (let i = 0; i < 96; i++) {
        const f = (t * 0.9 + Math.floor(i / 12) / 8) % 1;
        water.paths[i % 12]!.getPoint(f, p);
        p.x += Math.sin(i * 9 + t * 3) * 0.023;
        p.z += Math.cos(i * 7 + t * 3) * 0.023;
        s.setScalar(0.018 + f * 0.025);
        drops.current.setMatrixAt(i, m.compose(p, q, s));
      }
      drops.current.instanceMatrix.needsUpdate = true;
    }
    if (ripples.current) {
      for (let i = 0; i < 24; i++) {
        water.paths[i % 12]!.getPoint(1, p);
        p.y = 0.503;
        const phase = (t * 0.7 + Math.floor(i / 12) * 0.5 + i * 0.073) % 1,
          scale = 0.3 + phase * 2.8;
        s.set(scale, scale, 1);
        ripples.current.setMatrixAt(i, m.compose(p, flat, s));
      }
      ripples.current.instanceMatrix.needsUpdate = true;
    }
  });
  return (
    <group position={[x, 0, z]} name="fountain-water">
      <mesh rotation-x={-Math.PI / 2} position-y={0.49} material={water.material}>
        <circleGeometry args={[radius - 0.43, 64]} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={2.02} material={water.material}>
        <circleGeometry args={[radius * 0.24 - 0.13, 40]} />
      </mesh>
      <mesh geometry={water.streams}>
        <meshStandardMaterial
          color="#b4e5e8"
          transparent
          opacity={0.62}
          roughness={0.15}
          depthWrite={false}
        />
      </mesh>
      <mesh position-y={2.19}>
        <cylinderGeometry args={[0.05, 0.105, 0.3, 12]} />
        <meshStandardMaterial color="#c7eff1" transparent opacity={0.72} roughness={0.16} />
      </mesh>
      <instancedMesh ref={drops} args={[undefined, undefined, 96]} frustumCulled={false}>
        <sphereGeometry args={[1, 6, 4]} />
        <meshStandardMaterial
          color="#daf4f2"
          roughness={0.2}
          transparent
          opacity={0.8}
          depthWrite={false}
        />
      </instancedMesh>
      <instancedMesh ref={ripples} args={[undefined, undefined, 24]} frustumCulled={false}>
        <ringGeometry args={[0.16, 0.178, 24]} />
        <meshBasicMaterial color="#b6dfe1" transparent opacity={0.24} depthWrite={false} />
      </instancedMesh>
    </group>
  );
}
export function Fountains({ city }: { city: CityLayout }) {
  return (
    <>
      {city.props
        .filter((p) => p.k === "fountain")
        .map((p, i) => (
          <Fountain key={i} x={p.x} z={p.z} radius={p.s ?? 5} />
        ))}
    </>
  );
}
