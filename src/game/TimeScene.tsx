// The scene side of the continuous time of day (timeOfDay.ts holds the state and the
// blending): the per-frame driver, the lights and fog, a sky dome that cross-fades the
// sunset and night skies, and stars that fade in with the dark.
//
// Nothing here recompiles a shader or rebuilds an env map as the time moves: everything
// is uniforms and light colours, touched only on frames where k actually changed.
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { power } from "./events/power";
import { skyFog } from "./skyFog";
import type { Theme } from "./themes";
import {
  blendLook,
  cityChannels,
  liveCity,
  liveLook,
  stepTod,
  tod,
  todFrame,
  todSmooth,
} from "./timeOfDay";

/** advances the time and refreshes the shared blended look. Mount before anything reading it. */
export function TimeDriver({ theme, arena }: { theme: Theme; arena: number }) {
  const key = `${theme.name}|${arena}`;
  const lastKey = useRef("");
  useFrame((_, raw) => {
    stepTod(Math.min(raw, 0.1));
    if (tod.v !== todFrame.lastK || key !== lastKey.current) {
      todFrame.lastK = tod.v;
      lastKey.current = key;
      todFrame.version++;
      blendLook(theme, arena, tod.v, liveLook);
      cityChannels(tod.v, liveCity);
    }
  });
  return null;
}

/**
 * Fog, hemisphere, ambient fill and the directional haze for the current k. The small
 * arena maps also get their sun here (the city and the alpine map aim their own shadowed
 * suns at liveLook.sunDir).
 */
export function TimeLights({ ownSun, ownFog }: { ownSun: boolean; ownFog: boolean }) {
  const { scene } = useThree();
  const fog = useMemo(() => new THREE.Fog("#000000", 10, 100), []);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const amb = useRef<THREE.AmbientLight>(null);
  const sun = useRef<THREE.DirectionalLight>(null);
  const seen = useRef(-1);
  useEffect(() => {
    const prev = scene.fog;
    scene.fog = fog;
    seen.current = -1;
    return () => {
      scene.fog = prev;
    };
  }, [scene, fog]);
  useFrame(() => {
    // re-apply when the time moved or the city's power changed (a blackout dims the sky glow)
    const v = todFrame.version + power.version * 1e6;
    if (seen.current === v) return;
    seen.current = v;
    const L = liveLook;
    const dim = 1 - 0.4 * power.darkness;
    if (!ownFog) {
      fog.color.copy(L.fogColor);
      fog.near = L.fogNear;
      fog.far = L.fogFar;
    }
    const h = hemi.current;
    if (h) {
      h.color.copy(L.hemiSky);
      h.groundColor.copy(L.hemiGround);
      h.intensity = L.hemiI * dim;
    }
    const a = amb.current;
    if (a) {
      a.color.copy(L.ambientColor);
      a.intensity = L.ambient * dim;
    }
    const s = sun.current;
    if (s) {
      s.position.copy(L.sunDir).multiplyScalar(30);
      s.color.copy(L.sunColor);
      s.intensity = L.sunI;
    }
    skyFog.fogSunDir.value.copy(L.sunDir);
    skyFog.fogSunColor.value.copy(L.hazeColor);
    skyFog.fogSunK.value = L.hazeK;
  });
  return (
    <>
      <hemisphereLight ref={hemi} />
      <ambientLight ref={amb} intensity={0} />
      {!ownSun && (
        <directionalLight
          ref={sun}
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
        />
      )}
    </>
  );
}

const DOME_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = p.xyww;
}`;
const DOME_FRAG = /* glsl */ `
#include <common>
uniform sampler2D uA;
uniform sampler2D uB;
uniform vec3 uColA;
uniform vec3 uColB;
uniform float uUseA;
uniform float uUseB;
uniform float uMix;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  vec2 uv = vec2(atan(d.z, d.x) * RECIPROCAL_PI2 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * RECIPROCAL_PI + 0.5);
  vec3 col;
  if (uMix <= 0.001) col = uUseA > 0.5 ? texture2D(uA, uv).rgb : uColA;
  else if (uMix >= 0.999) col = uUseB > 0.5 ? texture2D(uB, uv).rgb : uColB;
  else {
    vec3 a = uUseA > 0.5 ? texture2D(uA, uv).rgb : uColA;
    vec3 b = uUseB > 0.5 ? texture2D(uB, uv).rgb : uColB;
    // mix in (roughly) display space so the sky darkens the way the eye expects
    vec3 m = mix(sqrt(max(a, 0.0)), sqrt(max(b, 0.0)), uMix);
    col = m * m;
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

/**
 * The background for maps that paint a sky (the city) or use a flat night colour and a
 * painted sunset (the arenas): a far-plane box that samples both equirect skies and mixes
 * them by k. Drawn first, under everything, like scene.background.
 */
export function SkyDome({
  sunset,
  night,
}: {
  sunset: THREE.Texture | THREE.Color;
  night: THREE.Texture | THREE.Color;
}) {
  const { scene } = useThree();
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uA: { value: null },
          uB: { value: null },
          uColA: { value: new THREE.Color() },
          uColB: { value: new THREE.Color() },
          uUseA: { value: 0 },
          uUseB: { value: 0 },
          uMix: { value: 0 },
        },
        vertexShader: DOME_VERT,
        fragmentShader: DOME_FRAG,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
        fog: false,
      }),
    [],
  );
  const geo = useMemo(() => new THREE.BoxGeometry(2, 2, 2), []);
  useEffect(() => {
    const U = mat.uniforms;
    const set = (v: THREE.Texture | THREE.Color, tex: string, c: string, use: string) => {
      if (v instanceof THREE.Color) {
        (U[c]!.value as THREE.Color).copy(v);
        U[use]!.value = 0;
        U[tex]!.value = null;
      } else {
        U[tex]!.value = v;
        U[use]!.value = 1;
      }
    };
    set(sunset, "uA", "uColA", "uUseA");
    set(night, "uB", "uColB", "uUseB");
  }, [mat, sunset, night]);
  useEffect(() => {
    // the dome is the background now; a clear colour behind it is never seen
    const prev = scene.background;
    scene.background = null;
    return () => {
      scene.background = prev;
    };
  }, [scene]);
  useEffect(
    () => () => {
      mat.dispose();
      geo.dispose();
    },
    [mat, geo],
  );
  useFrame(() => {
    mat.uniforms["uMix"]!.value = tod.v;
  });
  return <mesh geometry={geo} material={mat} renderOrder={-1000} frustumCulled={false} />;
}

const STAR_VERT = /* glsl */ `
uniform float uTime;
attribute float size;
varying vec3 vColor;
void main() {
  vColor = color;
  vec4 mv = modelViewMatrix * vec4(position, 0.5);
  gl_PointSize = size * (30.0 / -mv.z) * (3.0 + sin(uTime + 100.0));
  gl_Position = projectionMatrix * mv;
}`;
const STAR_FRAG = /* glsl */ `
uniform float uOpacity;
varying vec3 vColor;
void main() {
  float d = distance(gl_PointCoord, vec2(0.5));
  float a = 1.0 / (1.0 + exp(16.0 * (d - 0.25)));
  gl_FragColor = vec4(vColor * uOpacity, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** a star field (same look as drei's Stars) that fades in as night falls */
export function NightStars({
  radius,
  depth,
  count,
  factor,
}: {
  radius: number;
  depth: number;
  count: number;
  factor: number;
}) {
  const geo = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const colr = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const c = new THREE.Color();
    const v = new THREE.Vector3();
    let r = radius + depth;
    const inc = depth / count;
    for (let i = 0; i < count; i++) {
      r -= inc * Math.random();
      v.setFromSpherical(new THREE.Spherical(r, Math.acos(1 - Math.random() * 2), Math.random() * Math.PI * 2));
      pos.set([v.x, v.y, v.z], i * 3);
      c.setHSL(i / count, 0, 0.9);
      colr.set([c.r, c.g, c.b], i * 3);
      size[i] = (0.5 + 0.5 * Math.random()) * factor;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(colr, 3));
    g.setAttribute("size", new THREE.BufferAttribute(size, 1));
    return g;
  }, [radius, depth, count, factor]);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 } },
        vertexShader: STAR_VERT,
        fragmentShader: STAR_FRAG,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        vertexColors: true,
      }),
    [],
  );
  const pts = useRef<THREE.Points>(null);
  useEffect(() => () => geo.dispose(), [geo]);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame((state) => {
    const o = todSmooth(0.5, 0.95, tod.v);
    mat.uniforms["uOpacity"]!.value = o;
    mat.uniforms["uTime"]!.value = state.clock.elapsedTime * 0.3;
    if (pts.current) pts.current.visible = o > 0.01;
  });
  return <points ref={pts} geometry={geo} material={mat} />;
}
