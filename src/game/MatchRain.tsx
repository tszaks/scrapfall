import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { RAIN_VERT, STREAK_FRAG } from "./CityRain";
import { rainyMatch } from "./matchEnvironment";
import { shelterUniforms } from "./structures/weather";
import { setAmbienceRain } from "./ambience";
import { groundY } from "./terrain";
import { quality } from "./quality";
import type { WesternLayout } from "./western/layout";

/** Shared precipitation for outdoor maps without Vice's street-reflection renderer.
 * A camera-local surface map clips drops at terrain, roofs and covered porches. */
export function MatchRain({ western }: { western?: WesternLayout }) {
  const ref = useRef<THREE.Mesh>(null);
  const field = useMemo(() => {
    const count = 6000,
      data = new Float32Array(64 * 64);
    const roofs = (western?.buildings ?? []).flatMap((b) => [
      { x0: b.x0 - 0.4, x1: b.x1 + 0.4, z0: b.z0 - 0.4, z1: b.z1 + 0.4, y: b.storeys * 3.5 + 0.28 },
      ...(b.porch
        ? [
            {
              x0: b.x0 - (b.front === 3 ? 4 : 0),
              x1: b.x1 + (b.front === 1 ? 4 : 0),
              z0: b.z0 - (b.front === 0 ? 4 : 0),
              z1: b.z1 + (b.front === 2 ? 4 : 0),
              y: 3.1,
            },
          ]
        : []),
    ]);
    const floor = new THREE.DataTexture(data, 64, 64, THREE.RedFormat, THREE.FloatType);
    floor.minFilter = floor.magFilter = THREE.NearestFilter;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3),
    );
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const seeds = new Float32Array(count * 4);
    let state = 0x71af99;
    for (let i = 0; i < seeds.length; i++) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      seeds[i] = (state >>> 0) / 4294967296;
    }
    g.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 4));
    g.instanceCount = count;
    const m = new THREE.ShaderMaterial({
      vertexShader: RAIN_VERT.replace(
        "attribute vec4 aSeed;",
        "attribute vec4 aSeed;\nuniform sampler2D uFloor;\nuniform vec2 uFloorOrigin;",
      ).replace("step(0.0, p.y)", "step(texture2D(uFloor,(p.xz-uFloorOrigin)/64.0).r, p.y)"),
      fragmentShader: STREAK_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        ...shelterUniforms(),
        uFloor: { value: floor },
        uFloorOrigin: { value: new THREE.Vector2() },
        uTime: { value: 0 },
        uRain: { value: 1 },
        uBox: { value: new THREE.Vector3(38, 26, 38) },
        uCenter: { value: new THREE.Vector3() },
        uWind: { value: new THREE.Vector2(0.9, 0.4) },
        uPixK: { value: 0.001 },
        uColor: { value: new THREE.Color(0.7, 0.75, 0.82) },
      },
    });
    return { g, m, floor, data, roofs, x: Infinity, z: Infinity };
  }, [western]);
  useEffect(
    () => () => {
      field.g.dispose();
      field.m.dispose();
      field.floor.dispose();
      setAmbienceRain(0);
    },
    [field],
  );
  useFrame(({ camera, clock, gl }) => {
    const rain = rainyMatch();
    if (ref.current) ref.current.visible = rain;
    setAmbienceRain(rain ? 1 : 0);
    if (!rain) return;
    const c = camera.position,
      u = field.m.uniforms;
    if (Math.hypot(c.x - field.x - 32, c.z - field.z - 32) > 8) {
      field.x = Math.floor(c.x) - 32;
      field.z = Math.floor(c.z) - 32;
      u["uFloorOrigin"]!.value.set(field.x, field.z);
      const nearby = field.roofs.filter(
        (b) => b.x1 > field.x && b.x0 < field.x + 64 && b.z1 > field.z && b.z0 < field.z + 64,
      );
      for (let j = 0; j < 64; j++)
        for (let i = 0; i < 64; i++) {
          const x = field.x + i + 0.5,
            z = field.z + j + 0.5;
          let h = groundY(x, z);
          for (const b of nearby)
            if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) h = Math.max(h, b.y);
          field.data[j * 64 + i] = h;
        }
      field.floor.needsUpdate = true;
    }
    // Rebuild only after leaving the middle of the local coverage square.
    u["uCenter"]!.value.set(c.x, c.y + 5, c.z);
    u["uTime"]!.value = clock.elapsedTime;
    u["uPixK"]!.value =
      (2 * Math.tan(THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov / 2))) /
      Math.max(1, gl.domElement.height);
    field.g.instanceCount = Math.round(6000 * quality().spec.rain);
  });
  return (
    <mesh ref={ref} geometry={field.g} material={field.m} frustumCulled={false} renderOrder={20} />
  );
}
