import { matchEnvironment, rainyMatch } from "../matchEnvironment";
import { registerStaticGeometry } from "../staticCollision";
import { MarineLife } from "../life/MarineLife";
import { wheelAngle, wheelCabin, CABINS } from "./wheelRide";
import { trafficClock } from "../trafficCore";
// Renders Pacific Pier: the merged chunk geometry from beachMesh.ts (facade atlas, one shared
// sign atlas, per-chunk frustum culling and a distance LOD on the clutter), the sea with a
// moving waterline and breaking-wave foam, instanced palms, and the moving set pieces: the
// Ferris wheel (one transform + 20 instanced gondolas + colour-cycling LEDs in a shader), the
// coaster train, the drop tower, the carousel and the beach bonfires.
import { useFrame, useThree } from "@react-three/fiber";
import { memo, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import * as THREE from "three";

import { CitySun, facadeMaterial, rippleNormals, setEnvMix, withEnvMix } from "../City";
import { blendTable } from "../lookBlend";
import { tod, useTodK } from "../timeOfDay";
import { SkyDome } from "../TimeScene";
import { TILE_COLS, TILE_ROWS, facadeArrays, glowTexture } from "../cityTextures";
import { worldFx } from "../terrain";
import type { Look, TimeOfDay } from "../lighting";
import { PalmTrees, type PalmInst, type PalmSpecies } from "../Palms";
import { paletteSkyTextures, prewarmPalette, skyEnvSource, skyTexture } from "../sky";
import { addSkyFogUniforms, skyFog } from "../skyFog";
import { CityTraffic } from "../Traffic";
import type { TrafficLink } from "../trafficCore";
import {
  BLUFF_H,
  DECK,
  SEA,
  SURF_FLOOR,
  OFFSHORE_X,
  OFFSHORE_FLOOR,
  X,
  type BeachLayout,
} from "./beachLayout";
import { BEACH_SKY_KEY, BEACH_SUNSET, beachLook, type BeachLook } from "./beachLook";
import { DETAIL_RANGE, beachMeshes } from "./beachMesh";
import { beachSignTexture } from "./beachTextures";
import { provideEventHooks } from "../events/mapHooks";
import { SurgeFx } from "./SurgeFx";
import { waveSurge } from "./waveSurge";
import { BeachSports } from "./BeachSports";

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();

/** the look part-way from sunset (0) to night (1): the waves carry the match into night */
const blended = new Map<number, BeachLook>();
const dayLooks = new Map<string, BeachLook>();
function beachLookAt(k: number): BeachLook {
  const kind = matchEnvironment.kind;
  if (kind === "sunny" || kind === "rain") {
    let l = dayLooks.get(kind);
    if (!l) {
      const rain = kind === "rain",
        s = beachLook("sunset");
      l = {
        ...s,
        look: {
          ...s.look,
          fog: [80, rain ? 850 : 2100],
          fogColor: rain ? "#929fa7" : "#bddae3",
          fogSun: { color: "#c9dce4", k: 0.04 },
        },
        sunDir: [-0.5, 0.82, 0.28],
        lightDir: [-0.5, 0.82, 0.28],
        water: {
          color: rain ? "#406779" : "#207c97",
          roughness: rain ? 0.36 : 0.23,
          metalness: 0.12,
          foam: "#e7f7fa",
          env: 0.22,
        },
        hazardCol: "#abb8bd",
        hazardFog: [20, 360],
        windows: rain ? 0.5 : 0.05,
        dark: 0.65,
        pools: rain ? 0.18 : 0.03,
        env: 0.18,
      };
      dayLooks.set(kind, l);
    }
    return l;
  }
  if (k <= 0) return beachLook("sunset");
  if (k >= 1) return beachLook("night");
  const key = Math.round(k * 256);
  let l = blended.get(key);
  if (!l) {
    if (blended.size > 300) blended.clear();
    l = blendTable(beachLook("sunset"), beachLook("night"), key / 256);
    blended.set(key, l);
  }
  return l;
}

/** terrain: facade-atlas grain, vertex colours, per-vertex roughness (wet sand shines) */
function groundMaterial() {
  const arr = facadeArrays();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0.9,
  });
  mat.onBeforeCompile = (sh) => {
    addSkyFogUniforms(sh);
    sh.uniforms["uDay"] = { value: arr.day };
    sh.vertexShader = sh.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute vec2 aUv2;\nattribute vec3 aFac;\nvarying vec2 vFuv;\nvarying vec3 vFac;",
      )
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFuv = aUv2;\nvFac = aFac;");
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nprecision highp sampler2DArray;\nuniform sampler2DArray uDay;\nvarying vec2 vFuv;\nvarying vec3 vFac;",
      )
      .replace(
        "#include <map_fragment>",
        `vec4 grT = texture(uDay, vec3(vFuv / vec2(${TILE_COLS.toFixed(1)}, ${TILE_ROWS.toFixed(1)}), vFac.x));
diffuseColor.rgb *= mix(vec3(1.0), grT.rgb, 0.85);`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        "float roughnessFactor = clamp(vFac.y, 0.05, 1.0);",
      );
  };
  mat.customProgramCacheKey = () => "beach-ground-v1";
  return mat;
}

/**
 * The Pacific: a mirror of the sky broken up by drifting ripples (the city's approach), plus
 * a waterline that washes up and down the wet sand, lines of breaking foam rolling in
 * through the surf zone and a soft foam edge. The shore strip is subdivided for the wash.
 */
function seaMaterial(
  time: { value: number },
  foam: { value: THREE.Color },
  moon: { value: THREE.Vector4 },
) {
  const mat = new THREE.MeshStandardMaterial({ color: "#241c3c", roughness: 0.18, metalness: 0.9 });
  mat.onBeforeCompile = (sh) => {
    addSkyFogUniforms(sh);
    sh.uniforms["uTime"] = time;
    sh.uniforms["uFoam"] = foam;
    sh.uniforms["uRipple"] = { value: rippleNormals() };
    sh.uniforms["uMoon"] = moon;
    const common = `
uniform float uTime;
varying vec3 vWPos;
// the sand under the water (same profile as the layout): surf floor, then the wet sand
float floorAt(float x) {
  if (x < ${OFFSHORE_X.toFixed(1)}) return ${OFFSHORE_FLOOR.toFixed(2)};
  if (x < ${X.surf.toFixed(1)}) return ${OFFSHORE_FLOOR.toFixed(2)} + (x - (${OFFSHORE_X.toFixed(1)})) / ${(X.surf - OFFSHORE_X).toFixed(1)} * ${(SURF_FLOOR - OFFSHORE_FLOOR).toFixed(2)};
  if (x < ${X.wet.toFixed(1)}) return ${SURF_FLOOR.toFixed(2)} + (x - (${X.surf.toFixed(1)})) / ${(X.wet - X.surf).toFixed(1)} * ${(-0.95 - SURF_FLOOR).toFixed(2)};
  return -0.95 + (x - (${X.wet.toFixed(1)})) / ${(X.dry - X.wet).toFixed(1)} * 0.35;
}
// the wash: a slow swell that runs the waterline up and back down the beach
float washAt(vec2 p) {
  float t = uTime;
  float s = sin(t * 0.55 + p.y * 0.012) * 0.6 + sin(t * 0.31 - p.y * 0.021 + 1.3) * 0.4;
  return s * 0.075;
}`;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>" + common)
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vec4 wp0 = modelMatrix * vec4(transformed, 1.0);
float shore = smoothstep(${(X.surf - 30).toFixed(1)}, ${(X.wet - 6).toFixed(1)}, wp0.x);
transformed.y += washAt(wp0.xz) * shore;
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\n#define WATER_FOG\nuniform sampler2D uRipple;\nuniform vec3 uFoam;\nuniform vec4 uMoon;" +
          common,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
float depth = vWPos.y - floorAt(vWPos.x);
// breaking waves: foam lines rolling in toward the beach, strongest where it shoals
float ph = (vWPos.x - ${X.surf.toFixed(1)}) / 11.0 - uTime * 0.16 + sin(vWPos.z * 0.013) * 0.35 + sin(vWPos.z * 0.041 + 1.7) * 0.18;
float band = pow(max(0.0, sin(ph * 6.2831)), 14.0);
// each wave breaks in sections, not one ruler-straight line
band *= smoothstep(0.35, 0.75, sin(vWPos.z * 0.05 + floor(ph) * 2.3) * 0.5 + 0.5 + sin(vWPos.z * 0.11 - floor(ph) * 1.1) * 0.25);
float surfZone = smoothstep(${(X.surf - 40).toFixed(1)}, ${(X.surf + 6).toFixed(1)}, vWPos.x);
vec2 fp = vWPos.xz;
float breakup = texture2D(uRipple, fp / 7.0 + vec2(uTime * 0.03, 0.0)).x;
float foamK = band * surfZone * smoothstep(0.35, 0.6, breakup + 0.2) * (1.0 - smoothstep(150.0, 600.0, length(vWPos.xz - cameraPosition.xz)) * 0.7);
// the soft white edge where the water runs out on the sand
foamK = max(foamK, smoothstep(0.16, 0.0, depth) * smoothstep(0.3, 0.6, breakup + 0.25));
// shallow water shows a little sand-green through it
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.32, 0.3), smoothstep(1.2, 0.1, depth) * 0.45);
diffuseColor.rgb = mix(diffuseColor.rgb, uFoam, clamp(foamK, 0.0, 1.0));`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
if (uMoon.w > 0.0) {
  // the moon's path on the water (the night sky texture isn't bright enough to reflect it)
  vec3 vd = normalize(vWPos - cameraPosition);
  vec3 wn2 = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
  float m = max(dot(reflect(vd, wn2), uMoon.xyz), 0.0);
  totalEmissiveRadiance += vec3(0.85, 0.9, 1.0) * (pow(m, 900.0) * 6.0 + pow(m, 60.0) * 0.12) * uMoon.w * (1.0 - clamp(foamK, 0.0, 1.0));
}`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
float wDist = length(vWPos - cameraPosition);
roughnessFactor = mix(roughnessFactor, 0.34, smoothstep(40.0, 900.0, wDist));
roughnessFactor = mix(roughnessFactor, 1.0, clamp(foamK, 0.0, 1.0));`,
      )
      .replace(
        "#include <metalnessmap_fragment>",
        `#include <metalnessmap_fragment>
metalnessFactor = mix(metalnessFactor, 0.0, clamp(foamK, 0.0, 1.0));`,
      )
      .replace(
        "#include <normal_fragment_begin>",
        `#include <normal_fragment_begin>
{
  vec2 p = vWPos.xz;
  vec3 a = texture2D(uRipple, p / 31.0 + uTime * vec2(0.011, 0.004)).xyz * 2.0 - 1.0;
  vec3 b = texture2D(uRipple, p / 11.0 + uTime * vec2(-0.017, 0.013)).xyz * 2.0 - 1.0;
  // long swell rolling toward the shore
  float sw = cos(((vWPos.x - ${X.surf.toFixed(1)}) / 11.0 - uTime * 0.16) * 6.2831) * 0.25 * surfZone;
  vec2 g = (a.xy + b.xy * 0.6) * 0.55 + vec2(sw * 0.4, 0.0);
  vec3 wn = normalize(vec3(g.x, 1.0, g.y));
  normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
}`,
      );
  };
  mat.customProgramCacheKey = () => "beach-sea-v1";
  return mat;
}

/** LEDs: unlit, colour-cycling patterns keyed by a per-vertex parameter (0..1 round the wheel) */
function ledMaterial(time: { value: number }, k: { value: number }, halo = false) {
  const mat = halo
    ? new THREE.MeshBasicMaterial({
        vertexColors: true,
        toneMapped: false,
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      })
    : new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false });
  mat.onBeforeCompile = (sh) => {
    addSkyFogUniforms(sh);
    sh.uniforms["uTime"] = time;
    sh.uniforms["uK"] = k;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aLed;\nvarying float vLed;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLed = aLed;");
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float uTime;
uniform float uK;
varying float vLed;
vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
float mode = mod(floor(uTime / 9.0), 4.0);
vec3 led;
if (mode < 0.5) led = hue(fract(vLed * 2.0 - uTime * 0.12));
else if (mode < 1.5) led = mix(vec3(1.0, 0.25, 0.6), vec3(0.3, 0.9, 1.0), step(0.5, fract(vLed * 12.0 + floor(uTime * 2.0) * 0.5)));
else if (mode < 2.5) led = vec3(1.0, 0.85, 0.5) * (0.35 + 0.65 * pow(0.5 + 0.5 * sin(vLed * 40.0 - uTime * 5.0), 6.0));
else led = hue(fract(uTime * 0.07)) * (0.6 + 0.4 * sin(vLed * 6.2831 * 3.0 + uTime * 3.0));
diffuseColor.rgb = led * diffuseColor.rgb * uK;`,
      );
  };
  mat.customProgramCacheKey = () => (halo ? "beach-led-halo-v1" : "beach-led-v1");
  return mat;
}

// ---------------------------------------------------------------------------------------

export const BeachWorld = memo(function BeachWorld({
  city,
  seed,
  time,
  link,
  look,
}: {
  city: BeachLayout;
  seed: number;
  time: TimeOfDay;
  link: MutableRefObject<TrafficLink>;
  look: Look;
}) {
  const L = beachLook(time);
  // the WAVE SURGE map event's set piece belongs to this map while it is up
  useEffect(() => {
    provideEventHooks("wave-surge", waveSurge);
    return () => provideEventHooks("wave-surge", null);
  }, []);
  return (
    <>
      <SurgeFx city={city} />
      <MarineLife />
      <BeachSports city={city} />
      <CitySun time={time} color={look.sun.color} intensity={look.sun.intensity} dir={L.lightDir} />
      <BeachScene city={city} time={time} />
      <BeachPalms city={city} />
      <SetPieces city={city} time={time} />
      <CityTraffic city={city} seed={seed} time={time} link={link} cars={44} coastal />
      <Mountains time={time} />
    </>
  );
});

function BeachPalms({ city }: { city: BeachLayout }) {
  const groups = useMemo(() => {
    const out: Record<PalmSpecies, PalmInst[]> = { washingtonia: [], royal: [], coconut: [] };
    for (const p of city.beach.props) {
      if (p.k !== "palm") continue;
      const h1 = Math.abs(Math.sin(p.x * 12.9898 + p.z * 78.233) * 43758.5453) % 1;
      const h2 = Math.abs(Math.sin(p.x * 39.346 + p.z * 11.135) * 24634.6345) % 1;
      const H = p.s ?? 22;
      // Washingtonia fan palms everywhere they line a walk (the SoCal skyline); royals in the
      // park strip and the lots; a few coconuts leaning over the skate park and the gym
      const strip = p.x > X.strip - 4 && p.x < X.prom - 1;
      const sp: PalmSpecies = strip
        ? h1 < 0.3
          ? "coconut"
          : "royal"
        : p.x > 55 && p.x < X.strip
          ? "coconut"
          : "washingtonia";
      const s = sp === "washingtonia" ? H / 20 : sp === "royal" ? 0.9 + h2 * 0.35 : 0.9 + h2 * 0.5;
      const rot = sp === "coconut" ? -Math.PI / 2 + (h1 - 0.5) * 1.4 : p.rot;
      const lean =
        sp === "coconut" ? 0.12 + h2 * 0.2 : sp === "washingtonia" ? h2 * 0.05 : h2 * 0.02;
      out[sp].push({ x: p.x, y: p.y + 0.1, z: p.z, rot, s, lean, tint: 0.85 + h1 * 0.3 });
    }
    return out;
  }, [city]);
  return <PalmTrees groups={groups} />;
}

const BeachScene = memo(function BeachScene({
  city,
}: {
  city: BeachLayout;
  /** legacy: the time of day now comes from timeOfDay.ts */
  time?: TimeOfDay;
}) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  // geometry is prepared across tasks during the world build; this memo is a cache hit
  const built = useMemo(() => beachMeshes(city), [city]);
  useLayoutEffect(
    () =>
      registerStaticGeometry(
        "map",
        built.chunks.filter((c) => !c.far).flatMap((c) => [c.main, c.detail]),
      ),
    [built],
  );

  const nightK = useMemo(() => ({ value: 0 }), []);
  const darkK = useMemo(() => ({ value: 0.2 }), []);
  const seaTime = useMemo(() => ({ value: 0 }), []);
  const foamCol = useMemo(() => ({ value: new THREE.Color("#ffe6d6") }), []);
  const moon = useMemo(() => ({ value: new THREE.Vector4(0, 1, 0, 0) }), []);
  const mats = useMemo(
    () => ({
      facade: facadeMaterial(nightK, darkK),
      ground: withEnvMix(groundMaterial()),
      glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
      signs: new THREE.MeshBasicMaterial({
        vertexColors: true,
        map: beachSignTexture(),
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
      sea: withEnvMix(seaMaterial(seaTime, foamCol, moon)),
      lights: new THREE.PointsMaterial({
        color: "#ffd8a0",
        size: 2.4,
        sizeAttenuation: false,
        fog: false,
        toneMapped: false,
        transparent: true,
      }),
      mist: new THREE.MeshBasicMaterial({
        color: "#d8aaa6",
        transparent: true,
        opacity: 0,
        side: THREE.BackSide,
        fog: false,
        depthWrite: false,
      }),
    }),
    [nightK, darkK, seaTime, foamCol, moon],
  );

  // reflection env maps (PMREM of the sky), made the first time they're needed
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
        rt = pm.fromEquirectangular(
          t === "night"
            ? skyEnvSource("night")
            : paletteSkyTextures(BEACH_SKY_KEY, BEACH_SUNSET).env,
        );
        pm.dispose();
        envs.set(t, rt);
      }
      return rt;
    },
    [gl, envs],
  );
  // paint the sunset in idle moments so the first press of N doesn't hitch
  useEffect(() => {
    let live = true;
    prewarmPalette(BEACH_SKY_KEY, BEACH_SUNSET, () => {
      if (!live) return;
      envFor("sunset");
      gl.initTexture(paletteSkyTextures(BEACH_SKY_KEY, BEACH_SUNSET).background);
    });
    return () => {
      live = false;
    };
  }, [gl, envFor]);

  // both env maps up front (the match runs from sunset into night), cross-faded in the shader
  const envNight = useRef<THREE.Texture | null>(null);
  useEffect(() => {
    const sun = envFor("sunset");
    envNight.current = envFor("night").texture;
    for (const m of [mats.facade, mats.ground, mats.sea]) {
      m.envMap = sun.texture;
      m.needsUpdate = true;
    }
  }, [envFor, mats]);
  // the time of day (1/64 steps): uniforms and colours only
  const nk = useTodK();
  useEffect(() => {
    const B = beachLookAt(nk);
    for (const m of [mats.facade, mats.ground, mats.sea]) setEnvMix(m, envNight.current, nk);
    mats.facade.envMapIntensity = B.env;
    mats.sea.color.set(B.water.color);
    mats.sea.roughness = B.water.roughness;
    mats.sea.metalness = B.water.metalness;
    mats.sea.envMapIntensity = B.water.env;
    foamCol.value.set(B.water.foam);
    moon.value.set(B.sunDir[0], B.sunDir[1], B.sunDir[2], nk);
    nightK.value = B.windows;
    darkK.value = B.dark;
    mats.glow.color.setScalar(B.glow);
    mats.signs.color.setScalar(B.signs);
    mats.pools.opacity = B.pools;
    mats.lights.opacity = 0.35 + 0.65 * nk;
    mats.mist.color.set(B.hazardCol);
  }, [nk, mats, nightK, darkK, foamCol, moon]);
  const skies = useMemo(
    () => ({
      sunset: paletteSkyTextures(BEACH_SKY_KEY, BEACH_SUNSET).background,
      night: skyTexture("night"),
    }),
    [],
  );

  useEffect(
    () => () => {
      for (const c of built.chunks)
        [c.ground, c.main, c.detail, c.glow, c.signs, c.pools].forEach((g) => g?.dispose());
    },
    [built],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  // the sea: a big far plane, and a finely subdivided strip along the shore for the wash
  const seaGeo = useMemo(() => {
    const far = new THREE.PlaneGeometry(9000, 9000, 1, 1);
    far.rotateX(-Math.PI / 2);
    far.translate(X.surf - 40 - 4500, SEA, 0);
    const strip = new THREE.PlaneGeometry(X.dry + 4 - (X.surf - 40), 2 * city.half + 3000, 60, 120);
    strip.rotateX(-Math.PI / 2);
    strip.translate((X.dry + 4 + X.surf - 40) / 2, SEA, 0);
    return { far, strip };
  }, [city.half]);
  useEffect(
    () => () => {
      seaGeo.far.dispose();
      seaGeo.strip.dispose();
    },
    [seaGeo],
  );
  const lightsGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(built.hillLights.flat(), 3));
    return g;
  }, [built]);
  useEffect(() => () => lightsGeo.dispose(), [lightsGeo]);

  // chunk refs for the distance LOD
  const detailRefs = useRef<(THREE.Mesh | null)[]>([]);
  const signRefs = useRef<(THREE.Mesh | null)[]>([]);
  const poolRefs = useRef<(THREE.Mesh | null)[]>([]);
  const mistRef = useRef<THREE.Mesh>(null);
  const lodTick = useRef(0);
  const haze = useRef(0);
  const fogCol = useMemo(() => new THREE.Color(), []);
  const hazeCol = useMemo(() => new THREE.Color(), []);
  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    seaTime.value = t;
    const cam = state.camera.position;
    const B = beachLookAt(tod.v);
    // directional haze points at our own sun (the shared Atmosphere assumes the city's)
    skyFog.fogSunDir.value.set(B.sunDir[0], B.sunDir[1], B.sunDir[2]);
    // MARINE LAYER: in the boss round the fog rolls in off the sea
    haze.current += ((rainyMatch() ? 1 : 0) - haze.current) * Math.min(1, dt * 0.35);
    const fog = scene.fog as THREE.Fog | null;
    if (fog) {
      const h = haze.current;
      fog.near = B.look.fog[0] + (B.hazardFog[0] - B.look.fog[0]) * h;
      fog.far = B.look.fog[1] + (B.hazardFog[1] - B.look.fog[1]) * h;
      fogCol.set(B.look.fogColor);
      hazeCol.set(B.hazardCol).convertSRGBToLinear();
      fog.color.copy(fogCol).lerp(hazeCol, Math.min(1, h * 1.2));
      skyFog.fogSunK.value = B.look.fogSun.k * (1 - h * 0.8);
    }
    const mist = mistRef.current;
    if (mist) {
      mist.visible = haze.current > 0.01;
      mist.position.copy(cam);
      mats.mist.opacity = Math.min(0.92, haze.current * 0.95);
    }
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
        if (sg) sg.visible = d < DETAIL_RANGE * 1.6;
        const pl = poolRefs.current[i];
        if (pl) pl.visible = d < 700;
      });
    }
  });

  return (
    <group>
      <mesh geometry={seaGeo.far} material={mats.sea} />
      <mesh geometry={seaGeo.strip} material={mats.sea} receiveShadow />
      <SkyDome sunset={skies.sunset} night={skies.night} />
      <points geometry={lightsGeo} material={mats.lights} />
      {/* the marine layer: a fog shell round the camera, drawn after the sky and the stars
          (anything nearer than its radius stays in front; the scene fog hazes that) */}
      <mesh
        ref={mistRef}
        material={mats.mist}
        visible={false}
        renderOrder={10}
        frustumCulled={false}
      >
        <sphereGeometry args={[420, 16, 10]} />
      </mesh>
      {built.chunks.map((c, i) => (
        <group key={i}>
          {c.ground && <mesh geometry={c.ground} material={mats.ground} receiveShadow />}
          {c.main && (
            <mesh geometry={c.main} material={mats.facade} castShadow={!c.far} receiveShadow />
          )}
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
    </group>
  );
});

function debugOn() {
  return (
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("debug") === "1"
  );
}

// ---------------------------------------------------------------------------------------
// moving set pieces

function SetPieces({ city }: { city: BeachLayout; time?: TimeOfDay }) {
  const nk = useTodK();
  const B = beachLookAt(nk);
  const ledTime = useMemo(() => ({ value: 0 }), []);
  const ledK = useMemo(() => ({ value: 1 }), []);
  useEffect(() => {
    ledK.value = B.wheel;
  }, [B.wheel, ledK]);
  const mats = useMemo(() => {
    const nk = { value: 0 };
    const dk = { value: 0.5 };
    return {
      led: ledMaterial(ledTime, ledK),
      halo: ledMaterial(ledTime, ledK, true),
      frame: facadeMaterial(nk, dk),
      lambert: new THREE.MeshLambertMaterial({ vertexColors: true }),
      flame: new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
      emb: new THREE.MeshBasicMaterial({
        color: "#ff7a2a",
        map: glowTexture(),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    };
  }, [ledTime, ledK]);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  // the wheel's LEDs glow through the marine layer (unfogged, a little dimmed by it), so the
  // landmark stays lit in the night boss round instead of vanishing into the haze
  const haze = useRef(0);
  useFrame((state, dt) => {
    ledTime.value = state.clock.elapsedTime;
    haze.current += ((rainyMatch() ? 1 : 0) - haze.current) * Math.min(1, dt * 0.35);
    ledK.value = B.wheel * (1 - 0.35 * haze.current);
  });
  return (
    <>
      <FerrisWheel city={city} mats={mats} />
      <Coaster city={city} mats={mats} />
      <DropTower city={city} mats={mats} />
      <Carousel city={city} mats={mats} />
      <Bonfires city={city} mats={mats} nk={nk} />
    </>
  );
}
type SetMats = {
  led: THREE.Material;
  halo: THREE.Material;
  frame: THREE.Material;
  lambert: THREE.Material;
  flame: THREE.MeshBasicMaterial;
  emb: THREE.MeshBasicMaterial;
};

/** simple vertex-coloured geometry accumulator (plain attributes, optional LED parameter) */
class Acc {
  pos: number[] = [];
  nrm: number[] = [];
  col: number[] = [];
  led: number[] = [];
  private c = new THREE.Color();
  private l = 0;
  color(hex: string, led = 0) {
    this.c.set(hex);
    this.l = led;
    return this;
  }
  add(g: THREE.BufferGeometry, m: THREE.Matrix4) {
    const src = g.index ? g.toNonIndexed() : g;
    const p = src.getAttribute("position");
    const n = src.getAttribute("normal");
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i).applyMatrix4(m);
      this.pos.push(_v.x, _v.y, _v.z);
      _v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      this.nrm.push(_v.x, _v.y, _v.z);
      this.col.push(this.c.r, this.c.g, this.c.b);
      this.led.push(this.l);
    }
    if (src !== g) src.dispose();
  }
  /** a box from a to b (square section r) */
  bar(a: THREE.Vector3, b: THREE.Vector3, r: number) {
    const d = _v.subVectors(b, a);
    const len = d.length();
    const box = new THREE.BoxGeometry(r * 2, len, r * 2);
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      d.clone().normalize(),
    );
    const m = new THREE.Matrix4().compose(
      a.clone().add(b).multiplyScalar(0.5),
      q,
      new THREE.Vector3(1, 1, 1),
    );
    this.add(box, m);
    box.dispose();
  }
  build(withLed = false) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    if (withLed) g.setAttribute("aLed", new THREE.Float32BufferAttribute(this.led, 1));
    g.computeBoundingSphere();
    return g;
  }
}

const GONDOLAS = CABINS;
function FerrisWheel({ city, mats }: { city: BeachLayout; mats: SetMats }) {
  const w = city.beach.wheel;
  const geo = useMemo(() => {
    // wheel in its own frame: the disc in the x-y plane, axle along z
    const frame = new Acc();
    const leds = new Acc();
    const halos = new Acc();
    const R = w.r;
    const rings = [-2.4, 2.4];
    const N = 40;
    for (const z of rings) {
      frame.color("#f4f2ea");
      for (let k = 0; k < N; k++) {
        const a0 = (k / N) * Math.PI * 2;
        const a1 = ((k + 1) / N) * Math.PI * 2;
        frame.bar(
          new THREE.Vector3(Math.cos(a0) * R, Math.sin(a0) * R, z),
          new THREE.Vector3(Math.cos(a1) * R, Math.sin(a1) * R, z),
          0.18,
        );
        frame.bar(
          new THREE.Vector3(Math.cos(a0) * R * 0.86, Math.sin(a0) * R * 0.86, z),
          new THREE.Vector3(Math.cos(a1) * R * 0.86, Math.sin(a1) * R * 0.86, z),
          0.1,
        );
        leds.color("#ffffff", k / N);
        halos.color("#ffffff", k / N);
        const bulb = new THREE.BoxGeometry(0.42, 0.42, 0.42);
        const glow = new THREE.BoxGeometry(1.6, 1.6, 1.6);
        for (const [x, y] of [
          [Math.cos(a0) * (R + 0.25), Math.sin(a0) * (R + 0.25)],
          [Math.cos(a0 + Math.PI / N) * R * 0.86, Math.sin(a0 + Math.PI / N) * R * 0.86],
        ] as const) {
          leds.add(bulb, new THREE.Matrix4().makeTranslation(x, y, z));
          halos.add(glow, new THREE.Matrix4().makeTranslation(x, y, z));
        }
        bulb.dispose();
        glow.dispose();
      }
      // spokes, with LEDs strung along them
      for (let k = 0; k < GONDOLAS; k++) {
        const a = (k / GONDOLAS) * Math.PI * 2;
        frame.color("#e8e4dc");
        frame.bar(
          new THREE.Vector3(0, 0, z * 0.3),
          new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * R, z),
          0.09,
        );
        for (let s = 1; s < 8; s++) {
          const rr = (s / 8) * R;
          leds.color("#ffffff", k / GONDOLAS + s * 0.002);
          const bulb = new THREE.BoxGeometry(0.3, 0.3, 0.3);
          leds.add(
            bulb,
            new THREE.Matrix4().makeTranslation(
              Math.cos(a) * rr,
              Math.sin(a) * rr,
              z * (0.3 + 0.7 * (s / 8)),
            ),
          );
          bulb.dispose();
        }
      }
    }
    // cross braces between the two rims
    frame.color("#d8d4cc");
    for (let k = 0; k < GONDOLAS; k++) {
      const a = (k / GONDOLAS) * Math.PI * 2;
      frame.bar(
        new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * R, rings[0]!),
        new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * R, rings[1]!),
        0.07,
      );
    }
    const hub = new THREE.CylinderGeometry(1.4, 1.4, 2.4, 14);
    hub.rotateX(Math.PI / 2);
    frame.color("#c8ccd2");
    frame.add(hub, new THREE.Matrix4());
    hub.dispose();
    // gondola: an open cabin with a roof, hanging from its pivot at the origin
    const gon = new Acc();
    const box = (
      x: number,
      y: number,
      z: number,
      sx: number,
      sy: number,
      sz: number,
      col: string,
    ) => {
      const b = new THREE.BoxGeometry(sx, sy, sz);
      gon.color(col).add(b, new THREE.Matrix4().makeTranslation(x, y, z));
      b.dispose();
    };
    for (const x of [-0.85, 0.85]) box(x, -0.45, 0, 0.12, 1, 0.12, "#d8d8d8");
    // Hollow cabin: usable floor, waist-high panels and real headroom.
    for (const x of [-0.95, 0.95]) box(x, -2.32, 0, 0.1, 1, 1.6, "#ffffff");
    box(0, -2.32, -0.75, 1.9, 1, 0.1, "#ffffff");
    for (const x of [-0.95, 0.95])
      for (const z of [-0.75, 0.75]) box(x, -1.7, z, 0.08, 2.1, 0.08, "#d8d8d8");
    box(0, -0.67, 0, 2.3, 0.14, 1.9, "#ffffff");
    box(0, -2.85, 0, 1.9, 0.12, 1.5, "#2a2a2a");
    return {
      frame: frame.build(),
      leds: leds.build(true),
      halos: halos.build(true),
      gon: gon.build(),
    };
  }, [w.r]);
  useEffect(
    () => () => {
      geo.frame.dispose();
      geo.leds.dispose();
      geo.halos.dispose();
      geo.gon.dispose();
    },
    [geo],
  );
  const wheelRef = useRef<THREE.Group>(null);
  const gonRef = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = gonRef.current;
    if (!m) return;
    const cols = [
      "#e8433a",
      "#f2c21f",
      "#1f8ad8",
      "#3ab88a",
      "#e85a9a",
      "#ff8a2a",
      "#6a4ad8",
      "#3ad0d8",
    ];
    for (let i = 0; i < GONDOLAS; i++) m.setColorAt(i, _c.set(cols[i % cols.length]!));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [geo]);
  useFrame((state) => {
    // one full turn every ~70 s
    const a = wheelAngle();
    const g = wheelRef.current;
    if (g) g.rotation.z = a;
    const m = gonRef.current;
    if (!m) return;
    for (let i = 0; i < GONDOLAS; i++) {
      const p = wheelCabin(w, i);
      const sway = Math.sin(trafficClock.t * 0.9 + i) * 0.012;
      _e.set(0, w.rot, sway);
      _m4.compose(_v.set(p.x, p.y, p.z), _q.setFromEuler(_e), _s.set(1, 1, 1));
      m.setMatrixAt(i, _m4);
    }
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <group>
      <group ref={wheelRef} position={[w.x, w.y, w.z]} rotation={[0, w.rot, 0, "YXZ"]}>
        <mesh geometry={geo.frame} material={mats.lambert} castShadow />
        <mesh geometry={geo.leds} material={mats.led} />
        <mesh geometry={geo.halos} material={mats.halo} renderOrder={11} />
      </group>
      <instancedMesh
        ref={gonRef}
        args={[geo.gon, mats.lambert, GONDOLAS]}
        frustumCulled={false}
        castShadow
      />
    </group>
  );
}

const CARS = 4;
function Coaster({ city, mats }: { city: BeachLayout; mats: SetMats }) {
  const pts = city.beach.coaster.pts;
  const path = useMemo(() => {
    const P = pts.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    const cum = [0];
    for (let k = 1; k <= P.length; k++)
      cum.push(cum[k - 1]! + P[k - 1]!.distanceTo(P[k % P.length]!));
    const top = Math.max(...P.map((p) => p.y));
    return { P, cum, len: cum[cum.length - 1]!, top };
  }, [pts]);
  const geo = useMemo(() => {
    const a = new Acc();
    const b = new THREE.BoxGeometry(1.5, 0.7, 2.2);
    a.color("#f2c21f").add(b, new THREE.Matrix4().makeTranslation(0, 0.55, 0));
    const s = new THREE.BoxGeometry(1.3, 0.5, 0.4);
    a.color("#2a2a2a").add(s, new THREE.Matrix4().makeTranslation(0, 1.0, -0.5));
    a.add(s, new THREE.Matrix4().makeTranslation(0, 1.0, 0.4));
    b.dispose();
    s.dispose();
    return a.build();
  }, []);
  useEffect(() => () => geo.dispose(), [geo]);
  const ref = useRef<THREE.InstancedMesh>(null);
  const sPos = useRef(0);
  const at = (s: number, out: THREE.Vector3, dir: THREE.Vector3) => {
    const { P, cum, len } = path;
    s = ((s % len) + len) % len;
    let k = 0;
    while (k < P.length - 1 && cum[k + 1]! < s) k++;
    const a = P[k]!;
    const b = P[(k + 1) % P.length]!;
    const t = (s - cum[k]!) / Math.max(1e-4, cum[k + 1]! - cum[k]!);
    out.lerpVectors(a, b, t);
    dir.subVectors(b, a).normalize();
  };
  const dirV = useMemo(() => new THREE.Vector3(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const look = useMemo(() => new THREE.Matrix4(), []);
  useFrame((_, dt) => {
    const m = ref.current;
    if (!m) return;
    const p = new THREE.Vector3();
    at(sPos.current, p, dirV);
    // gravity: slow over the crests, fast through the dips
    const v = 3 + Math.sqrt(Math.max(0, 2 * 9.8 * (path.top - p.y))) * 0.85;
    sPos.current += v * Math.min(dt, 0.05);
    for (let i = 0; i < CARS; i++) {
      at(sPos.current - i * 2.5, p, dirV);
      look.lookAt(_v.set(0, 0, 0), dirV.clone().negate(), up);
      _q.setFromRotationMatrix(look);
      _m4.compose(p, _q, _s.set(1, 1, 1));
      m.setMatrixAt(i, _m4);
    }
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[geo, mats.lambert, CARS]} frustumCulled={false} castShadow />
  );
}

function DropTower({ city, mats }: { city: BeachLayout; mats: SetMats }) {
  const d = city.beach.drop;
  const geo = useMemo(() => {
    const a = new Acc();
    const ring = new THREE.CylinderGeometry(3.0, 3.0, 1.2, 12, 1, true);
    a.color("#e8433a").add(ring, new THREE.Matrix4());
    const seats = new THREE.CylinderGeometry(3.3, 3.3, 0.3, 12);
    a.color("#f2c21f").add(seats, new THREE.Matrix4().makeTranslation(0, -0.6, 0));
    ring.dispose();
    seats.dispose();
    return a.build();
  }, []);
  useEffect(() => () => geo.dispose(), [geo]);
  const ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    const m = ref.current;
    if (!m) return;
    // 22 s cycle: a slow climb, a pause at the top, a 1.8 s drop, braking, a wait at the bottom
    const t = state.clock.elapsedTime % 22;
    const top = DECK + d.h - 3;
    const bot = DECK + 2.2;
    let y = bot;
    if (t < 12) y = bot + (top - bot) * (t / 12);
    else if (t < 15) y = top;
    else if (t < 16.8) y = top - (top - bot) * Math.pow((t - 15) / 1.8, 2);
    else y = bot;
    m.position.set(d.x, y, d.z);
  });
  return <mesh ref={ref} geometry={geo} material={mats.lambert} castShadow />;
}

const HORSES = 16;
function Carousel({ city, mats }: { city: BeachLayout; mats: SetMats }) {
  const c = city.beach.carousel;
  const geo = useMemo(() => {
    const a = new Acc();
    const disc = new THREE.CylinderGeometry(c.r, c.r, 0.5, 20);
    a.color("#c83a4a").add(disc, new THREE.Matrix4().makeTranslation(0, DECK + 0.3, 0));
    const core = new THREE.CylinderGeometry(1.8, 1.8, 4.4, 12);
    a.color("#f2c24a").add(core, new THREE.Matrix4().makeTranslation(0, DECK + 2.7, 0));
    const top = new THREE.CylinderGeometry(c.r, c.r, 0.6, 20);
    a.color("#f4f0e6").add(top, new THREE.Matrix4().makeTranslation(0, DECK + 4.8, 0));
    disc.dispose();
    core.dispose();
    top.dispose();
    const horse = new Acc();
    const b = (
      x: number,
      y: number,
      z: number,
      sx: number,
      sy: number,
      sz: number,
      col: string,
    ) => {
      const g = new THREE.BoxGeometry(sx, sy, sz);
      horse.color(col).add(g, new THREE.Matrix4().makeTranslation(x, y, z));
      g.dispose();
    };
    b(0, 0, 0, 0.5, 0.55, 1.4, "#ffffff");
    b(0, 0.45, 0.72, 0.36, 0.7, 0.36, "#ffffff");
    b(0, 0.8, 0.95, 0.3, 0.3, 0.6, "#ffffff");
    for (const [x, z] of [
      [-0.18, -0.5],
      [0.18, -0.5],
      [-0.18, 0.5],
      [0.18, 0.5],
    ] as const)
      b(x, -0.6, z, 0.12, 0.7, 0.12, "#ffffff");
    b(0, 0.8, 0, 0.06, 3.2, 0.06, "#f2c24a");
    return { base: a.build(), horse: horse.build() };
  }, [c.r]);
  useEffect(
    () => () => {
      geo.base.dispose();
      geo.horse.dispose();
    },
    [geo],
  );
  const baseRef = useRef<THREE.Mesh>(null);
  const horseRef = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = horseRef.current;
    if (!m) return;
    const cols = ["#f4f0e6", "#e8c890", "#c8a078", "#f0d8e8", "#d0e0f0", "#2a2a2a"];
    for (let i = 0; i < HORSES; i++) m.setColorAt(i, _c.set(cols[i % cols.length]!));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [geo]);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const a = t * 0.45;
    const b = baseRef.current;
    if (b) b.rotation.y = a;
    const m = horseRef.current;
    if (!m) return;
    for (let i = 0; i < HORSES; i++) {
      const ring = i % 2 ? c.r - 1.3 : c.r - 3.0;
      const th = a + (i / HORSES) * Math.PI * 2;
      const y = DECK + 1.5 + Math.sin(t * 2.2 + i * 1.3) * 0.35;
      _e.set(0, -th, 0);
      _m4.compose(
        _v.set(c.x + Math.cos(th) * ring, y, c.z + Math.sin(th) * ring),
        _q.setFromEuler(_e),
        _s.set(1, 1, 1),
      );
      m.setMatrixAt(i, _m4);
    }
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <group>
      <mesh
        ref={baseRef}
        position={[c.x, 0, c.z]}
        geometry={geo.base}
        material={mats.lambert}
        castShadow
      />
      <instancedMesh
        ref={horseRef}
        args={[geo.horse, mats.lambert, HORSES]}
        frustumCulled={false}
      />
    </group>
  );
}

function Bonfires({ city, mats, nk }: { city: BeachLayout; mats: SetMats; nk: number }) {
  const fires = useMemo(() => {
    const out: { x: number; y: number; z: number }[] = [];
    for (const f of city.beach.firesLit) {
      let h = -0.6;
      for (const p of city.beach.props)
        if (p.k === "firering" && Math.abs(p.x - f.x) < 0.01 && Math.abs(p.z - f.z) < 0.01) h = p.y;
      out.push({ x: f.x, y: h + 0.2, z: f.z });
    }
    return out;
  }, [city]);
  const flameGeo = useMemo(() => {
    // three tongues of flame: a red-orange outer, an orange middle and a yellow core
    const a = new Acc();
    const tongue = (r: number, h: number, x: number, z: number, col: string) => {
      const c = new THREE.ConeGeometry(r, h, 6, 1, true);
      c.translate(x, h / 2, z);
      a.color(col).add(c, new THREE.Matrix4());
      c.dispose();
    };
    tongue(0.5, 1.0, 0, 0, "#c8401a");
    tongue(0.28, 1.25, 0.12, 0.05, "#ff8a1a");
    tongue(0.25, 0.9, -0.15, -0.1, "#ff8a1a");
    tongue(0.16, 0.8, 0, 0, "#ffe07a");
    return a.build();
  }, []);
  const poolGeo = useMemo(() => new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2), []);
  useEffect(
    () => () => {
      flameGeo.dispose();
      poolGeo.dispose();
    },
    [flameGeo, poolGeo],
  );
  const flames = useRef<THREE.InstancedMesh>(null);
  const pools = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const p = pools.current;
    if (!p) return;
    fires.forEach((f, i) => p.setMatrixAt(i, _m4.makeTranslation(f.x, f.y + 0.05, f.z)));
    p.instanceMatrix.needsUpdate = true;
    p.computeBoundingSphere();
  }, [fires]);
  useFrame((state) => {
    const m = flames.current;
    if (!m) return;
    const t = state.clock.elapsedTime;
    fires.forEach((f, i) => {
      const k = 0.8 + Math.sin(t * 11 + i * 3.1) * 0.12 + Math.sin(t * 17 + i) * 0.08;
      _e.set(0, t * 0.7 + i, 0);
      _m4.compose(_v.set(f.x, f.y, f.z), _q.setFromEuler(_e), _s.set(1, k, 1));
      m.setMatrixAt(i, _m4);
    });
    m.instanceMatrix.needsUpdate = true;
    mats.emb.opacity = (0.25 + 0.45 * nk) * (0.85 + Math.sin(t * 9) * 0.08);
    mats.flame.opacity = 0.55 + 0.4 * nk;
  });
  if (!fires.length) return null;
  return (
    <group>
      <instancedMesh
        ref={flames}
        args={[flameGeo, mats.flame, fires.length]}
        frustumCulled={false}
      />
      <instancedMesh ref={pools} args={[poolGeo, mats.emb, fires.length]} renderOrder={2} />
    </group>
  );
}

/**
 * Mountains ringing the bay, far past the fog: the Santa Monica Mountains running out to sea
 * in the north-west, the Palos Verdes hills in the south-west, the San Gabriels inland.
 * Unfogged silhouettes in the haze colour of the time of day, darker toward the ridgeline.
 */
function Mountains(_props: { time?: TimeOfDay }) {
  const nk = useTodK();
  const geo = useMemo(() => {
    const pos: number[] = [];
    const tone: number[] = [];
    const hash = (k: number) => {
      const v = Math.sin(k * 127.1 + 311.7) * 43758.5453;
      return v - Math.floor(v);
    };
    const noise = (x: number) => {
      const i = Math.floor(x);
      const f = x - i;
      const u = f * f * (3 - 2 * f);
      return hash(i) * (1 - u) + hash(i + 1) * u;
    };
    const ridge = (t: number, seed: number) =>
      noise(t * 6 + seed) * 0.55 + noise(t * 17 + seed * 3) * 0.3 + noise(t * 43 + seed * 7) * 0.15;
    const range = (
      a0: number,
      a1: number,
      R: number,
      hMax: number,
      seed: number,
      taper: (t: number) => number,
    ) => {
      const N = 90;
      for (let k = 0; k < N; k++) {
        const t0 = k / N;
        const t1 = (k + 1) / N;
        const az0 = ((a0 + (a1 - a0) * t0) * Math.PI) / 180;
        const az1 = ((a0 + (a1 - a0) * t1) * Math.PI) / 180;
        const h0 = hMax * ridge(t0, seed) * taper(t0);
        const h1 = hMax * ridge(t1, seed) * taper(t1);
        const p0 = [Math.sin(az0) * R, Math.cos(az0) * R];
        const p1 = [Math.sin(az1) * R, Math.cos(az1) * R];
        // both windings so it reads from anywhere inside the ring
        for (const [a, b] of [
          [p0, p1],
          [p1, p0],
        ] as const) {
          const ha = a === p0 ? h0 : h1;
          const hb = b === p0 ? h0 : h1;
          pos.push(a[0]!, -20, a[1]!, b[0]!, -20, b[1]!, b[0]!, hb, b[1]!);
          pos.push(a[0]!, -20, a[1]!, b[0]!, hb, b[1]!, a[0]!, ha, a[1]!);
          tone.push(0, 0, 1, 0, 1, 1);
        }
      }
    };
    // azimuth = atan2(x, z) in degrees: -90 is due west (the sea)
    range(-170, -112, 3150, 320, 1, (t) => Math.min(1, t * 3) * (1 - Math.pow(t, 3) * 0.75));
    range(-68, -22, 2950, 140, 5, (t) => Math.sin(Math.PI * t));
    range(25, 160, 3300, 420, 9, (t) => 0.5 + 0.5 * Math.sin(Math.PI * t));
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aTone", new THREE.Float32BufferAttribute(tone, 1));
    return g;
  }, []);
  useEffect(() => () => geo.dispose(), [geo]);
  const mat = useMemo(() => {
    const m = new THREE.ShaderMaterial({
      uniforms: { uBase: { value: new THREE.Color() }, uTop: { value: new THREE.Color() } },
      vertexShader: `attribute float aTone; varying float vT; void main() { vT = aTone; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 uBase;
uniform vec3 uTop;
varying float vT;
void main() {
  gl_FragColor = vec4(mix(uBase, uTop, vT), 1.0);
  #include <colorspace_fragment>
}`,
      depthWrite: true,
    });
    return m;
  }, []);
  useEffect(() => () => mat.dispose(), [mat]);
  useEffect(() => {
    (mat.uniforms["uBase"]!.value as THREE.Color).set("#c490a6").lerp(_c.set("#1a1e30"), nk);
    (mat.uniforms["uTop"]!.value as THREE.Color).set("#8a6a96").lerp(_c.set("#0c0f1c"), nk);
  }, [nk, mat]);
  return <mesh geometry={geo} material={mat} frustumCulled={false} renderOrder={-2} />;
}
