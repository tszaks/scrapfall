// Renders the "city" map from the merged chunk geometry built in cityMesh.ts.
// One facade material (a texture array with every facade style) draws every building,
// prop and road; glass reflects a small PMREM env map of the generated sky (night or sunset).
// Chunks cull by frustum (three.js) and their detail layers cull by distance (the LOD).
import { useFrame, useThree } from "@react-three/fiber";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import type { CityLayout } from "./cityLayout";
import { buildCityMeshes, DETAIL_RANGE } from "./cityMesh";
import { TILE_COLS, TILE_ROWS, facadeArrays, glowTexture, signTexture } from "./cityTextures";
import type { TimeOfDay } from "./lighting";
import { CityPalms } from "./Palms";
import { prewarmSunset, skyEnvSource, skyTexture } from "./sky";
import { addSkyFogUniforms } from "./skyFog";
import { signal, trafficClock, GREEN, YELLOW } from "./trafficCore";
import { liveCity, liveLook, tod, todFrame } from "./timeOfDay";
import { SkyDome } from "./TimeScene";
import { POWER_GLSL, power, powerAt, powerUniforms, setPowerArea } from "./events/power";

const _col = new THREE.Color();
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

/** Reflections cross-fade between the sunset and night env maps (both PMREMs are the same
 * size, so one set of cube-UV defines serves both): `envMap` is the sunset, `envMap2` the
 * night, `uEnvMix` = k. No recompiles and no PMREM regeneration as the time moves. */
type EnvMix = { envMap2: { value: THREE.Texture | null }; uEnvMix: { value: number } };
function envMixOf(mat: THREE.Material): EnvMix {
  const u = mat.userData as { envMix?: EnvMix };
  return (u.envMix ??= { envMap2: { value: null }, uEnvMix: { value: 0 } });
}
/** point a city-style material's night env map and the sunset/night mix (0 = sunset) */
// eslint-disable-next-line react-refresh/only-export-components -- shared with the beach map
export function setEnvMix(mat: THREE.Material, night: THREE.Texture | null, k: number) {
  const e = envMixOf(mat);
  e.envMap2.value = night;
  e.uEnvMix.value = night ? k : 0;
}
function addEnvMix(sh: THREE.WebGLProgramParametersWithUniforms, mat: THREE.Material) {
  const envMix = envMixOf(mat);
  sh.uniforms["envMap2"] = envMix.envMap2;
  sh.uniforms["uEnvMix"] = envMix.uEnvMix;
  sh.fragmentShader = sh.fragmentShader.replace(
    "#include <envmap_physical_pars_fragment>",
    `#ifdef USE_ENVMAP
uniform sampler2D envMap2;
uniform float uEnvMix;
vec4 textureCubeUVMix( vec3 d, float r ) {
  // only the two ends of the day need a single map; the dusk in between blends both
  if ( uEnvMix <= 0.001 ) return textureCubeUV( envMap, d, r );
  if ( uEnvMix >= 0.999 ) return textureCubeUV( envMap2, d, r );
  return mix( textureCubeUV( envMap, d, r ), textureCubeUV( envMap2, d, r ), uEnvMix );
}
#endif
` + THREE.ShaderChunk.envmap_physical_pars_fragment.replaceAll("textureCubeUV( envMap,", "textureCubeUVMix("),
  );
}

/** give an existing standard material (own onBeforeCompile) the sunset/night env cross-fade */
// eslint-disable-next-line react-refresh/only-export-components -- shared with the beach map
export function withEnvMix<M extends THREE.MeshStandardMaterial>(mat: M): M {
  const prev = mat.onBeforeCompile.bind(mat);
  const key = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (sh, r) => {
    prev(sh, r);
    addEnvMix(sh, mat);
  };
  mat.customProgramCacheKey = () => key() + "-envmix";
  return mat;
}

/** Street lights, neon, bulbs and signs go dark with their district's power (blackout). */
function poweredBasic(mat: THREE.MeshBasicMaterial, key: string) {
  mat.onBeforeCompile = (sh) => {
    addSkyFogUniforms(sh);
    Object.assign(sh.uniforms, powerUniforms);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vPwXz;")
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvPwXz = (modelMatrix * vec4(transformed, 1.0)).xz;",
      );
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vPwXz;\n" + POWER_GLSL)
      .replace(
        "#include <opaque_fragment>",
        "outgoingLight *= gridPower(vPwXz);\n#include <opaque_fragment>",
      );
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

/** Facade material: MeshStandardMaterial + texture-array facades, per-floor night lighting,
 * glass reflectivity from the texture's alpha, and ground-level darkening on buildings. */
// eslint-disable-next-line react-refresh/only-export-components -- shared with the beach map
export function facadeMaterial(
  nightK: { value: number },
  darkK: { value: number },
  /** dusk: windows above this height (m) are still dark (default: all floors lit) */
  lightH: { value: number } = { value: 1e5 },
) {
  const arr = facadeArrays();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0,
    envMapIntensity: 1,
  });
  mat.onBeforeCompile = (sh) => {
    addSkyFogUniforms(sh);
    sh.uniforms["uDay"] = { value: arr.day };
    sh.uniforms["uNight"] = { value: arr.night };
    sh.uniforms["uNightK"] = nightK;
    sh.uniforms["uDarkK"] = darkK;
    sh.uniforms["uLightH"] = lightH;
    Object.assign(sh.uniforms, powerUniforms);
    addEnvMix(sh, mat);
    sh.vertexShader = sh.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute vec2 aUv2;\nattribute vec3 aFac;\nvarying vec2 vFuv;\nvarying vec3 vFac;\nvarying float vWy;\nvarying vec2 vWxz;",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvFuv = aUv2;\nvFac = aFac;\nvec4 cityWp = modelMatrix * vec4(transformed, 1.0);\nvWy = cityWp.y;\nvWxz = cityWp.xz;",
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
precision highp sampler2DArray;
uniform sampler2DArray uDay;
uniform sampler2DArray uNight;
uniform float uNightK;
uniform float uDarkK;
uniform float uLightH;
varying vec2 vFuv;
varying vec3 vFac;
varying float vWy;
varying vec2 vWxz;
${POWER_GLSL}
float cityHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}`,
      )
      .replace(
        "#include <map_fragment>",
        `vec2 tileUv = vFuv / vec2(${TILE_COLS.toFixed(1)}, ${TILE_ROWS.toFixed(1)});
vec4 facT = texture(uDay, vec3(tileUv, vFac.x));
diffuseColor.rgb *= facT.rgb;
float glassK = facT.a;
float aoK = step(0.5, vFac.z);
diffuseColor.rgb *= mix(1.0, mix(0.55, 1.0, smoothstep(0.0, 16.0, vWy)), aoK);`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        "float roughnessFactor = mix(roughness, 0.06, glassK);",
      )
      .replace(
        "#include <metalnessmap_fragment>",
        "float metalnessFactor = mix(metalness, 0.72, glassK);",
      )
      .replace(
        "#include <emissivemap_fragment>",
        `if (uNightK > 0.0) {
  vec4 nt = texture(uNight, vec3(tileUv, vFac.x));
  float hf = cityHash(vec2(floor(vFuv.y) + 0.5, vFac.y * 971.0 + floor(vFuv.x / 8.0) * 0.37));
  float darkF = step(hf, uDarkK);
  float fullF = step(0.9, hf);
  vec3 em = mix(nt.rgb, vec3(0.95, 0.8, 0.56) * nt.a, fullF) * (1.0 - darkF);
  // dusk: the lights come on floor by floor from the street up (each column at its own pace)
  float litF = step(vWy, uLightH + cityHash(vec2(hf * 17.3, vFac.y + 3.1)) * 36.0);
  totalEmissiveRadiance += em * uNightK * litF * gridPower(vWxz);
}`,
      );
  };
  mat.customProgramCacheKey = () => "city-facade-v4";
  return mat;
}

/** a tileable ripple normal map (value-noise height field, several octaves) */
let rippleTex: THREE.DataTexture | null = null;
// eslint-disable-next-line react-refresh/only-export-components -- shared with the beach map
export function rippleNormals() {
  if (rippleTex) return rippleTex;
  const N = 256;
  const h = new Float32Array(N * N);
  const hash = (x: number, y: number) => {
    let v = Math.imul(x, 374761393) + Math.imul(y, 668265263);
    v = Math.imul(v ^ (v >>> 13), 1274126177);
    return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
  };
  for (let o = 0, cell = 64, amp = 1; o < 5; o++, cell /= 2, amp *= 0.55) {
    const cells = N / cell;
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const gx = x / cell;
        const gy = y / cell;
        const x0 = Math.floor(gx);
        const y0 = Math.floor(gy);
        let fx = gx - x0;
        let fy = gy - y0;
        fx = fx * fx * (3 - 2 * fx);
        fy = fy * fy * (3 - 2 * fy);
        const H = (i: number, j: number) =>
          hash(((i % cells) + cells) % cells, (((j % cells) + cells) % cells) + o * 977);
        const a = H(x0, y0);
        const b = H(x0 + 1, y0);
        const c = H(x0, y0 + 1);
        const d = H(x0 + 1, y0 + 1);
        h[y * N + x]! += (a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy) * amp;
      }
  }
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const dx = h[y * N + ((x + 1) % N)]! - h[y * N + ((x + N - 1) % N)]!;
      const dy = h[((y + 1) % N) * N + x]! - h[((y + N - 1) % N) * N + x]!;
      const n = new THREE.Vector3(-dx * 6, -dy * 6, 1).normalize();
      const o = (y * N + x) * 4;
      data[o] = Math.round((n.x * 0.5 + 0.5) * 255);
      data[o + 1] = Math.round((n.y * 0.5 + 0.5) * 255);
      data[o + 2] = Math.round((n.z * 0.5 + 0.5) * 255);
      data[o + 3] = 255;
    }
  const t = new THREE.DataTexture(data, N, N);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  rippleTex = t;
  return t;
}

/** The sea: a PBR mirror of the sky broken up by two drifting layers of ripples (a normal
 * map, mipmapped so it calms down with distance instead of shimmering), with roughness
 * rising far out so the sun spreads into a glitter path. Lighter fog so it keeps its colour. */
function waterMaterial(time: { value: number }) {
  const mat = new THREE.MeshStandardMaterial({
    color: "#174560",
    roughness: 0.16,
    metalness: 0.15,
  });
  mat.onBeforeCompile = (sh) => {
    addSkyFogUniforms(sh);
    addEnvMix(sh, mat);
    sh.uniforms["uTime"] = time;
    sh.uniforms["uRipple"] = { value: rippleNormals() };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWPos;")
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\n#define WATER_FOG\nuniform float uTime;\nuniform sampler2D uRipple;\nvarying vec3 vWPos;",
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
float wDist = length(vWPos - cameraPosition);
roughnessFactor = mix(roughnessFactor, 0.34, smoothstep(40.0, 700.0, wDist));`,
      )
      .replace(
        "#include <normal_fragment_begin>",
        `#include <normal_fragment_begin>
{
  vec2 p = vWPos.xz;
  vec3 a = texture2D(uRipple, p / 31.0 + uTime * vec2(0.011, 0.004)).xyz * 2.0 - 1.0;
  vec3 b = texture2D(uRipple, p / 11.0 + uTime * vec2(-0.017, 0.013)).xyz * 2.0 - 1.0;
  vec2 g = (a.xy + b.xy * 0.6) * 0.55;
  vec3 wn = normalize(vec3(g.x, 1.0, g.y));
  normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
}`,
      );
  };
  mat.customProgramCacheKey = () => "city-water-v3";
  return mat;
}

export const CityScene = memo(function CityScene({
  city,
}: {
  city: CityLayout;
  /** legacy: the time of day now comes from timeOfDay.ts */
  time?: TimeOfDay;
}) {
  const { gl } = useThree();
  const built = useMemo(() => {
    const t0 = performance.now();
    const m = buildCityMeshes(city);
    if (import.meta.env.DEV)
      console.info(
        `[city] built ${m.chunks.length} chunks, ${m.stats.verts} verts in ${Math.round(performance.now() - t0)} ms`,
      );
    return m;
  }, [city]);

  const nightK = useMemo(() => ({ value: 0 }), []);
  const darkK = useMemo(() => ({ value: 0.2 }), []);
  const lightH = useMemo(() => ({ value: 1e4 }), []);
  const waterTime = useMemo(() => ({ value: 0 }), []);
  const mats = useMemo(
    () => ({
      facade: facadeMaterial(nightK, darkK, lightH),
      glow: poweredBasic(
        new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
        "city-glow-pw",
      ),
      signs: poweredBasic(
        new THREE.MeshBasicMaterial({
          vertexColors: true,
          map: signTexture(),
          toneMapped: false,
        }),
        "city-signs-pw",
      ),
      pools: poweredBasic(
        new THREE.MeshBasicMaterial({
          vertexColors: true,
          map: glowTexture(),
          transparent: true,
          opacity: 0.9,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
        }),
        "city-pools-pw",
      ),
      water: waterMaterial(waterTime),
      land: new THREE.MeshLambertMaterial({ color: "#8f8c84" }),
      beacon: new THREE.MeshBasicMaterial({ color: "#ff2a1a", toneMapped: false }),
      lamp: new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false }),
    }),
    [nightK, darkK, lightH, waterTime],
  );

  // reflection env maps: a small PMREM of each generated sky. Both are made up front (the
  // match runs from sunset into night) and cross-faded in the shader.
  const envs = useMemo(() => new Map<TimeOfDay, THREE.WebGLRenderTarget>(), []);
  useEffect(
    () => () => {
      envs.forEach((rt) => rt.dispose());
      envs.clear();
    },
    [envs],
  );

  const envFor = useMemo(
    () => (t: TimeOfDay) => {
      let rt = envs.get(t);
      if (!rt) {
        const pm = new THREE.PMREMGenerator(gl);
        rt = pm.fromEquirectangular(skyEnvSource(t));
        pm.dispose();
        envs.set(t, rt);
      }
      return rt;
    },
    [gl, envs],
  );
  // anything of the sunset still unpainted gets painted in idle moments
  useEffect(() => {
    prewarmSunset();
  }, []);
  // the two skies behind the dome (painted on first use; the menu opens on the sunset)
  const skies = useMemo(() => ({ sunset: skyTexture("sunset"), night: skyTexture("night") }), []);

  useEffect(() => {
    const sun = envFor("sunset");
    const night = envFor("night");
    mats.facade.envMap = sun.texture;
    mats.water.envMap = sun.texture;
    envTex.current = night.texture;
    mats.facade.needsUpdate = true;
    mats.water.needsUpdate = true;
    setPowerArea(city.half + 40);
    power.nodePos.clear();
    for (const l of built.lamps) if (!power.nodePos.has(l.node)) power.nodePos.set(l.node, [l.x, l.z]);
    seenTod.current = -1;
  }, [envFor, mats, city, built]);

  // the time of day, only on frames it moved: uniforms and colours, never a recompile
  const seenTod = useRef(-1);
  const envTex = useRef<THREE.Texture | null>(null);
  const waterA = useMemo(() => new THREE.Color("#241c3c"), []);
  const waterB = useMemo(() => new THREE.Color("#174560"), []);
  useFrame(() => {
    if (seenTod.current === todFrame.version) return;
    seenTod.current = todFrame.version;
    const k = tod.v;
    const L = liveCity;
    setEnvMix(mats.facade, envTex.current, k);
    setEnvMix(mats.water, envTex.current, k);
    mats.facade.envMapIntensity = L.env;
    // at dusk the sea is a mirror of the sky; at night it turns deep blue
    mats.water.color.lerpColors(waterA, waterB, k);
    mats.water.roughness = 0.2 + (0.16 - 0.2) * k;
    mats.water.metalness = 0.9 + (0.15 - 0.9) * k;
    nightK.value = L.windows;
    darkK.value = L.dark;
    lightH.value = L.lightH;
    mats.glow.color.setScalar(L.glow);
    mats.signs.color.setScalar(L.signs);
    mats.pools.opacity = L.pools;
  });

  useEffect(
    () => () => {
      for (const c of built.chunks)
        [c.main, c.detail, c.glow, c.signs, c.pools].forEach((g) => g?.dispose());
    },
    [built],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  // chunk refs for the distance LOD
  const detailRefs = useRef<(THREE.Mesh | null)[]>([]);
  const signRefs = useRef<(THREE.Mesh | null)[]>([]);
  const poolRefs = useRef<(THREE.Mesh | null)[]>([]);

  const beaconGeo = useMemo(() => new THREE.SphereGeometry(0.45, 6, 4), []);
  const lampGeo = useMemo(() => new THREE.BoxGeometry(0.24, 0.24, 0.06), []);
  const beaconRef = useRef<THREE.InstancedMesh>(null);
  const lampRef = useRef<THREE.InstancedMesh>(null);
  useEffect(
    () => () => {
      beaconGeo.dispose();
      lampGeo.dispose();
    },
    [beaconGeo, lampGeo],
  );
  useLayoutEffect(() => {
    const m = beaconRef.current;
    if (m) {
      built.beacons.forEach((p, i) => m.setMatrixAt(i, _m4.makeTranslation(p[0], p[1], p[2])));
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
    }
    const l = lampRef.current;
    if (l) {
      built.lamps.forEach((lp, i) => {
        _e.set(0, lp.rot, 0);
        _m4.compose(_v.set(lp.x, lp.y, lp.z), _q.setFromEuler(_e), _s.set(1, 1, 1));
        l.setMatrixAt(i, _m4);
        l.setColorAt(i, _col.set("#333"));
      });
      l.instanceMatrix.needsUpdate = true;
      l.computeBoundingSphere();
    }
    lastPhase.current = "";
  }, [built]);

  const lastPhase = useRef("");
  const lodTick = useRef(0);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    waterTime.value = t;
    const cam = state.camera.position;
    // aviation lights blink in unison
    mats.beacon.color.setScalar(Math.sin(t * 3.2) > 0.2 ? 1 : 0.12).multiply(_col.set("#ff2a1a"));
    // distance LOD, a few times a second is plenty
    lodTick.current -= 1;
    if (lodTick.current <= 0) {
      lodTick.current = 6;
      built.chunks.forEach((c, i) => {
        const dx = Math.max(c.x0 - cam.x, 0, cam.x - c.x1);
        const dz = Math.max(c.z0 - cam.z, 0, cam.z - c.z1);
        const d = Math.hypot(dx, dz);
        const det = detailRefs.current[i];
        if (det) det.visible = d < DETAIL_RANGE;
        const sg = signRefs.current[i];
        if (sg) sg.visible = d < DETAIL_RANGE * 1.4;
        const pl = poolRefs.current[i];
        if (pl) pl.visible = d < 900;
      });
    }
    // traffic lights follow the shared traffic clock
    const lm = lampRef.current;
    if (!lm) return;
    const tt = trafficClock.t;
    let key = `${power.version}:`;
    const states = built.lamps.map((l) => signal(l.node, tt, l.axis));
    for (let i = 0; i < states.length; i += 3) key += states[i];
    if (key === lastPhase.current) return;
    lastPhase.current = key;
    built.lamps.forEach((l, i) => {
      const s = states[i]!;
      const on =
        (l.which === 0 && s === 2) ||
        (l.which === 1 && s === YELLOW) ||
        (l.which === 2 && s === GREEN);
      _col.set(l.which === 0 ? "#ff2a1a" : l.which === 1 ? "#ffb81a" : "#2aff6a");
      if (!on) _col.multiplyScalar(0.1);
      // blackout: dead signals
      if (power.out) _col.multiplyScalar(Math.max(0.02, powerAt(l.x, l.z)));
      lm.setColorAt(i, _col);
    });
    if (lm.instanceColor) lm.instanceColor.needsUpdate = true;
  });

  const ext = city.extent + 2600;
  return (
    <group>
      <SkyDome sunset={skies.sunset} night={skies.night} />
      {/* land beyond the backdrop, and the sea to the south */}
      <mesh
        rotation-x={-Math.PI / 2}
        position={[0, -0.06, -ext / 2 + city.waterZ / 2]}
        material={mats.land}
      >
        <planeGeometry args={[ext * 2.4, ext + city.waterZ + 1]} />
      </mesh>
      <mesh
        rotation-x={-Math.PI / 2}
        position={[0, -1.2, city.waterZ + ext / 2]}
        material={mats.water}
        receiveShadow
      >
        <planeGeometry args={[ext * 2.4, ext]} />
      </mesh>
      {built.chunks.map((c, i) => (
        <group key={i}>
          {c.main && <mesh geometry={c.main} material={mats.facade} castShadow receiveShadow />}
          {c.detail && (
            <mesh
              ref={(m) => {
                detailRefs.current[i] = m;
              }}
              geometry={c.detail}
              material={mats.facade}
              castShadow
              receiveShadow
            />
          )}
          {c.glow && <mesh geometry={c.glow} material={mats.glow} />}
          {c.signs && (
            <mesh
              ref={(m) => {
                signRefs.current[i] = m;
              }}
              geometry={c.signs}
              material={mats.signs}
            />
          )}
          {c.pools && (
            <mesh
              ref={(m) => {
                poolRefs.current[i] = m;
              }}
              geometry={c.pools}
              material={mats.pools}
              renderOrder={2}
            />
          )}
        </group>
      ))}
      <CityPalms city={city} />
      {built.beacons.length > 0 && (
        <instancedMesh ref={beaconRef} args={[beaconGeo, mats.beacon, built.beacons.length]} />
      )}
      {built.lamps.length > 0 && (
        <instancedMesh ref={lampRef} args={[lampGeo, mats.lamp, built.lamps.length]} />
      )}
    </group>
  );
});

/** `?shadows=0` forces city shadows off, `?shadows=1` keeps them on (no auto fallback). */
function shadowParam(): boolean | null {
  if (typeof window === "undefined") return null;
  const v = new URLSearchParams(window.location.search).get("shadows");
  return v === "0" ? false : v === "1" ? true : null;
}

const SUN_RANGE = 80; // shadow frustum half-size around the player, metres
const SUN_MAP = 2048;
const SUN_DIST = 900;

/**
 * The city's sun: a low, warm light whose shadow frustum follows the player (snapped to
 * shadow texels so edges don't shimmer). The frustum is long enough that towers well away
 * from the player still throw their shadows across the street. If frames stay slow for a
 * few seconds, shadows switch off automatically (weak GPUs / laptops on battery).
 */
export function CitySun(_props: {
  time?: TimeOfDay;
  color?: string;
  intensity?: number;
  /** legacy: the direction now comes from the blended look (timeOfDay.ts) */
  dir?: [number, number, number];
}) {
  const ref = useRef<THREE.DirectionalLight>(null);
  const forced = useMemo(shadowParam, []);
  const [low, setLow] = useState(forced === false);
  const ema = useRef(1 / 60);
  const slowFor = useRef(0);
  useFrame((state, raw) => {
    const l = ref.current;
    if (!l) return;
    // the blended sun (sinking at dusk) or moon for the current time of day
    const dir = liveLook.sunDir;
    l.color.copy(liveLook.sunColor);
    l.intensity = liveLook.sunI;
    const texel = (SUN_RANGE * 2) / SUN_MAP;
    const cx = Math.round(state.camera.position.x / texel) * texel;
    const cz = Math.round(state.camera.position.z / texel) * texel;
    l.target.position.set(cx, 0, cz);
    l.target.updateMatrixWorld();
    l.position.set(cx + dir.x * SUN_DIST, dir.y * SUN_DIST, cz + dir.z * SUN_DIST);
    if (forced !== null || low) return;
    ema.current += (Math.min(raw, 0.25) - ema.current) * 0.05;
    if (ema.current > 0.04) {
      slowFor.current += raw;
      if (slowFor.current > 3) {
        console.info("[city] frames are slow: switching shadows off (use ?shadows=1 to keep them)");
        setLow(true);
      }
    } else slowFor.current = 0;
  });
  return (
    <directionalLight
      ref={ref}
      castShadow={!low}
      shadow-mapSize-width={SUN_MAP}
      shadow-mapSize-height={SUN_MAP}
      shadow-camera-left={-SUN_RANGE}
      shadow-camera-right={SUN_RANGE}
      shadow-camera-top={SUN_RANGE}
      shadow-camera-bottom={-SUN_RANGE}
      shadow-camera-near={10}
      shadow-camera-far={SUN_DIST * 2}
      shadow-bias={-0.0003}
      shadow-normalBias={0.05}
    />
  );
}
