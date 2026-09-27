// Renders the "city" map from the merged chunk geometry built in cityMesh.ts.
// One facade material (a texture array with every facade style) draws every building,
// prop and road; glass reflects a small PMREM env map of the generated sky (night or sunset).
// Chunks cull by frustum (three.js) and their detail layers cull by distance (the LOD).
import { useFrame, useThree } from "@react-three/fiber";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import type { CityLayout } from "./cityLayout";
import { buildCityMeshes, DETAIL_RANGE, groundHeights } from "./cityMesh";
import {
  FACADE_LAYERS,
  L,
  ROOM_CAT,
  ROOM_SPAN,
  TILE_COLS,
  TILE_ROWS,
  facadeArrays,
  glowTexture,
  signTexture,
} from "./cityTextures";
import { INTERIOR_GLSL, ROOM, addInteriorUniforms, interiorUniforms } from "./interiors";
import { WET_GLSL, addWetUniforms, wetUniforms } from "./cityWeather";
import type { TimeOfDay } from "./lighting";
import { CityPalms } from "./Palms";
import { CityRain } from "./CityRain";
import { SUN_DIR, prewarmSunset, skyEnvSource, skyTexture } from "./sky";
import { addSkyFogUniforms } from "./skyFog";
import { signal, trafficClock, GREEN, YELLOW } from "./trafficCore";

const _col = new THREE.Color();
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

/** Facade material: MeshStandardMaterial + texture-array facades, per-floor night lighting,
 * glass reflectivity from the texture's alpha, ground-level darkening on buildings, rooms
 * behind the windows (interior mapping, see interiors.ts) and wet streets in the rain. */
function facadeMaterial(nightK: { value: number }, darkK: { value: number }) {
  const arr = facadeArrays();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0,
    envMapIntensity: 1,
  });
  mat.onBeforeCompile = (sh) => {
    addSkyFogUniforms(sh);
    addInteriorUniforms(sh);
    addWetUniforms(sh);
    sh.uniforms["uDay"] = { value: arr.day };
    sh.uniforms["uNight"] = { value: arr.night };
    sh.uniforms["uNightK"] = nightK;
    sh.uniforms["uDarkK"] = darkK;
    sh.vertexShader = sh.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute vec2 aUv2;\nattribute vec3 aFac;\nvarying vec2 vFuv;\nvarying vec3 vFac;\nvarying vec3 vWPos;",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvFuv = aUv2;\nvFac = aFac;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;",
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
varying vec2 vFuv;
varying vec3 vFac;
varying vec3 vWPos;
#define vWy vWPos.y
float cityHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// per facade layer: room category (-1 none, 0 offices, 1 homes, 2 shops), modules per room
const float ROOM_CAT[${FACADE_LAYERS}] = float[${FACADE_LAYERS}](${ROOM_CAT});
const float ROOM_SPAN[${FACADE_LAYERS}] = float[${FACADE_LAYERS}](${ROOM_SPAN});
${INTERIOR_GLSL}`,
      )
      .replace("#include <color_pars_fragment>", `#include <color_pars_fragment>\n${WET_GLSL}`)
      .replace(
        "#include <map_fragment>",
        `vec2 tileUv = vFuv / vec2(${TILE_COLS.toFixed(1)}, ${TILE_ROWS.toFixed(1)});
vec4 facT = texture(uDay, vec3(tileUv, vFac.x));
diffuseColor.rgb *= facT.rgb;
float glassK = facT.a;
float aoK = step(0.5, vFac.z);
diffuseColor.rgb *= mix(1.0, mix(0.55, 1.0, smoothstep(0.0, 16.0, vWy)), aoK);
// derivatives for the rooms, taken here in uniform control flow
vec3 irP = -vViewPosition;
vec3 irDp1 = dFdx(irP);
vec3 irDp2 = dFdy(irP);
vec2 irDu1 = dFdx(vFuv);
vec2 irDu2 = dFdy(vFuv);`,
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
  vec3 em = mix(nt.rgb, vec3(0.95, 0.8, 0.56) * nt.a, fullF) * (1.0 - darkF) * uNightK;
  int layer = int(vFac.x + 0.5);
  float cat = ROOM_CAT[layer];
  float span = ROOM_SPAN[layer];
  // rooms fade in once a room is several pixels across; further out the baked windows stay
  float pxU = span / max(length(vec2(irDu1.x, irDu2.x)), 1e-6);
  float pxV = 1.0 / max(length(vec2(irDu1.y, irDu2.y)), 1e-6);
  float roomK = smoothstep(4.0, 9.0, min(pxU, pxV)) * step(0.0, cat) * uRoomOn;
  float winM = nt.a;
  if (roomK > 0.0 && winM > 0.01) {
    vec2 ruv = vec2(vFuv.x / span, vFuv.y);
    vec2 cell = floor(ruv);
    vec2 f = ruv - cell;
    float bseed = vFac.y * 113.0;
    vec4 rnd = irHash4(cell + bseed);
    float rt = irHash(cell * 1.71 + bseed + 5.3);
    // lit or not follows the baked window pattern, so near and far agree
    vec2 sUv = vec2(cell.x * span + 0.5, cell.y + 0.35) / vec2(${TILE_COLS.toFixed(1)}, ${TILE_ROWS.toFixed(1)});
    vec3 ns = textureLod(uNight, vec3(sUv, vFac.x), 0.0).rgb;
    float nmax = max(ns.r, max(ns.g, ns.b));
    float lit = max(step(0.03, nmax), fullF) * (1.0 - darkF);
    vec3 lamp = fullF > 0.5 ? vec3(1.0, 0.82, 0.55) : ns / max(nmax, 1e-3);
    lamp = max(mix(vec3(dot(lamp, vec3(0.333))), lamp, 1.25), 0.0) * (0.8 + 0.4 * rnd.w);
    float type;
    float depth;
    float kind = 0.0;
    float r2 = fract(rt * 7.13);
    if (cat < 0.5) {
      type = rt < 0.5 ? ${ROOM.office}.0 : rt < 0.8 ? ${ROOM.meeting}.0 : ${ROOM.empty}.0;
      depth = 4.0 + rnd.z * 5.0;
      kind = r2 < 0.3 ? 1.0 : 0.0;
    } else if (cat < 1.5) {
      type = rt < 0.36 ? ${ROOM.living}.0 : rt < 0.62 ? ${ROOM.bedroom}.0 : rt < 0.86 ? ${ROOM.kitchen}.0 : ${ROOM.empty}.0;
      depth = 3.2 + rnd.z * 2.6;
      kind = r2 < 0.3 ? 3.0 : r2 < 0.45 ? 2.0 : 0.0;
    } else {
      type = rt < 0.82 ? ${ROOM.shop}.0 : ${ROOM.meeting}.0;
      depth = 5.0 + rnd.z * 4.0;
    }
    // a stairwell runs up a whole column of some buildings, lit all night
    if (cat < 1.5 && irHash(vec2(cell.x, bseed + 3.7)) < 0.045) {
      type = ${ROOM.stairs}.0;
      depth = 3.0;
      kind = 0.0;
      lit = 1.0;
      lamp = vec3(0.6, 0.68, 0.72);
    }
    vec3 d = irRayD(irP, irDp1, irDp2, irDu1 / vec2(span, 1.0), irDu2 / vec2(span, 1.0), normal, depth);
    vec2 gx = irDu1 / vec2(span, 1.0);
    vec2 gy = irDu2 / vec2(span, 1.0);
    vec3 room = irTrace(f, d, type, rnd, lit, lamp, gx, gy);
    vec4 dr = irDressing(f, kind, 0.2 + 0.6 * fract(rt * 3.7), fract(rt * 11.3), lit, lamp, length(gx) + length(gy));
    room = mix(room, dr.rgb, dr.a);
    // glass on top: reflective at grazing angles, clear looking straight in
    float tower = step(abs(vFac.x - ${L.glass}.0), 0.1) + step(abs(vFac.x - ${L.dark}.0), 0.1);
    float ndv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
    float f0 = mix(0.04, 0.16, tower);
    float fr = f0 + (1.0 - f0) * pow(1.0 - ndv, 5.0);
    room *= (1.0 - fr) * mix(0.95, 0.8, tower);
    float k = roomK * winM;
    em = mix(em, room * winM, roomK);
    // clear glass: little diffuse, a dielectric-ish reflection instead of the painted pane
    diffuseColor.rgb *= 1.0 - 0.65 * k;
    metalnessFactor = mix(metalnessFactor, mix(0.25, 0.55, tower), k);
    roughnessFactor = mix(roughnessFactor, 0.04, k);
  }
  totalEmissiveRadiance += em;
}
if (uWet > 0.0) cityWet(diffuseColor, roughnessFactor, totalEmissiveRadiance, normal);`,
      );
  };
  mat.customProgramCacheKey = () => "city-facade-v4";
  return mat;
}

/** a tileable ripple normal map (value-noise height field, several octaves) */
let rippleTex: THREE.DataTexture | null = null;
function rippleNormals() {
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
  mat.customProgramCacheKey = () => "city-water-v2";
  return mat;
}

/** per time of day: how much of the lit-window texture shows, the share of dark windows,
 * glass reflection strength, neon / bulb / sign brightness, and street light pools */
const CITY_LIGHTS: Record<
  TimeOfDay,
  { windows: number; dark: number; env: number; glow: number; signs: number; pools: number }
> = {
  night: { windows: 0.95, dark: 0.2, env: 0.9, glow: 1.35, signs: 1.25, pools: 0.9 },
  // dusk: the first windows and street lights coming on, a few neon signs already lit
  sunset: { windows: 0.55, dark: 0.62, env: 1.15, glow: 1.1, signs: 1.0, pools: 0.32 },
};

/** rooms behind the windows per time of day: unlit-room sky glow (linear) and lamp strength */
const ROOM_LIGHT: Record<TimeOfDay, { amb: [number, number, number]; lit: number }> = {
  night: { amb: [0.008, 0.01, 0.018], lit: 1 },
  sunset: { amb: [0.1, 0.075, 0.08], lit: 1.15 },
};

export const CityScene = memo(function CityScene({
  city,
  time,
  isHost = true,
}: {
  city: CityLayout;
  time: TimeOfDay;
  /** co-op: the host rolls the weather and ships it to the guests */
  isHost?: boolean;
}) {
  const { gl, scene } = useThree();
  const built = useMemo(() => {
    const t0 = performance.now();
    const m = buildCityMeshes(city);
    if (import.meta.env.DEV)
      console.info(
        `[city] built ${m.chunks.length} chunks, ${m.stats.verts} verts in ${Math.round(performance.now() - t0)} ms`,
      );
    return m;
  }, [city]);
  const heights = useMemo(() => groundHeights(city), [city]);

  const nightK = useMemo(() => ({ value: 0 }), []);
  const darkK = useMemo(() => ({ value: 0.2 }), []);
  const waterTime = useMemo(() => ({ value: 0 }), []);
  const mats = useMemo(
    () => ({
      facade: facadeMaterial(nightK, darkK),
      glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
      signs: new THREE.MeshBasicMaterial({
        vertexColors: true,
        map: signTexture(),
        toneMapped: false,
      }),
      pools: new THREE.MeshBasicMaterial({
        vertexColors: true,
        map: glowTexture(),
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
      water: waterMaterial(waterTime),
      land: new THREE.MeshLambertMaterial({ color: "#8f8c84" }),
      beacon: new THREE.MeshBasicMaterial({ color: "#ff2a1a", toneMapped: false }),
      lamp: new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false }),
    }),
    [nightK, darkK, waterTime],
  );

  // reflection env maps: a small PMREM of each generated sky, made the first time it's needed
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
  // paint the sunset sky in idle moments and upload it, ready for the first press of N
  useEffect(() => {
    let live = true;
    prewarmSunset(() => {
      if (!live) return;
      envFor("sunset");
      gl.initTexture(skyTexture("sunset"));
    });
    return () => {
      live = false;
    };
  }, [gl, envFor]);

  useEffect(() => {
    const rt = envFor(time);
    const L = CITY_LIGHTS[time];
    mats.facade.envMap = rt.texture;
    mats.facade.envMapIntensity = L.env;
    mats.facade.needsUpdate = true;
    mats.water.envMap = rt.texture;
    // at dusk the sea turns into a mirror of the sky
    mats.water.color.set(time === "night" ? "#174560" : "#241c3c");
    mats.water.roughness = time === "night" ? 0.16 : 0.2;
    mats.water.metalness = time === "night" ? 0.15 : 0.9;
    mats.water.needsUpdate = true;
    nightK.value = L.windows;
    darkK.value = L.dark;
    const R = ROOM_LIGHT[time];
    interiorUniforms.uRoomAmb.value.setRGB(...R.amb);
    interiorUniforms.uRoomLit.value = R.lit;
    mats.glow.color.setScalar(L.glow);
    mats.signs.color.setScalar(L.signs);
    mats.pools.opacity = L.pools;
    const prev = scene.background;
    scene.background = skyTexture(time);
    return () => {
      scene.background = prev;
    };
  }, [time, envFor, mats, nightK, darkK, scene]);

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
    // wet streets mirror the lamps instead of scattering them: the fake light pools dim
    mats.pools.opacity = CITY_LIGHTS[time].pools * (1 - 0.5 * wetUniforms.uWet.value);
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
    let key = "";
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
      lm.setColorAt(i, _col);
    });
    if (lm.instanceColor) lm.instanceColor.needsUpdate = true;
  });

  const ext = city.extent + 2600;
  return (
    <group>
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
      <CityRain city={city} time={time} isHost={isHost} drips={built.drips} heights={heights} />
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
export function CitySun({
  time,
  color,
  intensity,
}: {
  time: TimeOfDay;
  color: string;
  intensity: number;
}) {
  const ref = useRef<THREE.DirectionalLight>(null);
  const forced = useMemo(shadowParam, []);
  const [low, setLow] = useState(forced === false);
  const ema = useRef(1 / 60);
  const slowFor = useRef(0);
  const dir = SUN_DIR[time];
  useFrame((state, raw) => {
    const l = ref.current;
    if (!l) return;
    const texel = (SUN_RANGE * 2) / SUN_MAP;
    const cx = Math.round(state.camera.position.x / texel) * texel;
    const cz = Math.round(state.camera.position.z / texel) * texel;
    l.target.position.set(cx, 0, cz);
    l.target.updateMatrixWorld();
    l.position.set(cx + dir[0] * SUN_DIST, dir[1] * SUN_DIST, cz + dir[2] * SUN_DIST);
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
      color={color}
      intensity={intensity}
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
