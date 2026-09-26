// Renders the "city" map from the merged chunk geometry built in cityMesh.ts.
// One facade material (a texture array with every facade style) draws every building,
// prop and road; glass reflects a small PMREM env map of the generated sky (day or night).
// Chunks cull by frustum (three.js) and their detail layers cull by distance (the LOD).
import { useFrame, useThree } from "@react-three/fiber";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import type { CityLayout } from "./cityLayout";
import { buildCityMeshes, DETAIL_RANGE } from "./cityMesh";
import {
  SUN_DIR,
  TILE_COLS,
  TILE_ROWS,
  facadeArrays,
  glowTexture,
  signTexture,
  skyTexture,
} from "./cityTextures";
import { signal, trafficClock, GREEN, YELLOW } from "./trafficCore";

const _col = new THREE.Color();
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

/** Facade material: MeshStandardMaterial + texture-array facades, per-floor night lighting,
 * glass reflectivity from the texture's alpha, and ground-level darkening on buildings. */
function facadeMaterial(nightK: { value: number }) {
  const arr = facadeArrays();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0,
    envMapIntensity: 1,
  });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms["uDay"] = { value: arr.day };
    sh.uniforms["uNight"] = { value: arr.night };
    sh.uniforms["uNightK"] = nightK;
    sh.vertexShader = sh.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute vec2 aUv2;\nattribute vec3 aFac;\nvarying vec2 vFuv;\nvarying vec3 vFac;\nvarying float vWy;",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvFuv = aUv2;\nvFac = aFac;\nvWy = (modelMatrix * vec4(transformed, 1.0)).y;",
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
precision highp sampler2DArray;
uniform sampler2DArray uDay;
uniform sampler2DArray uNight;
uniform float uNightK;
varying vec2 vFuv;
varying vec3 vFac;
varying float vWy;
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
  float darkF = step(hf, 0.2);
  float fullF = step(0.9, hf);
  vec3 em = mix(nt.rgb, vec3(0.95, 0.8, 0.56) * nt.a, fullF) * (1.0 - darkF);
  totalEmissiveRadiance += em * uNightK;
}`,
      );
  };
  mat.customProgramCacheKey = () => "city-facade-v2";
  return mat;
}

export const CityScene = memo(function CityScene({
  city,
  night,
}: {
  city: CityLayout;
  night: boolean;
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

  const nightK = useMemo(() => ({ value: 0 }), []);
  const mats = useMemo(
    () => ({
      facade: facadeMaterial(nightK),
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
      water: new THREE.MeshStandardMaterial({ color: "#174560", roughness: 0.16, metalness: 0.15 }),
      land: new THREE.MeshLambertMaterial({ color: "#8f8c84" }),
      beacon: new THREE.MeshBasicMaterial({ color: "#ff2a1a", toneMapped: false }),
      lamp: new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false }),
    }),
    [nightK],
  );

  // reflection env maps: a small PMREM of each generated sky
  const env = useMemo(() => {
    const pm = new THREE.PMREMGenerator(gl);
    const day = pm.fromEquirectangular(skyTexture(false));
    const nightRT = pm.fromEquirectangular(skyTexture(true));
    pm.dispose();
    return { day, night: nightRT };
  }, [gl]);
  useEffect(
    () => () => {
      env.day.dispose();
      env.night.dispose();
    },
    [env],
  );

  useEffect(() => {
    const e = night ? env.night.texture : env.day.texture;
    mats.facade.envMap = e;
    mats.facade.envMapIntensity = night ? 0.9 : 1.0;
    mats.facade.needsUpdate = true;
    mats.water.envMap = e;
    mats.water.needsUpdate = true;
    nightK.value = night ? 0.95 : 0;
    mats.glow.color.setScalar(night ? 1.35 : 0.75);
    mats.signs.color.setScalar(night ? 1.25 : 0.8);
    const prev = scene.background;
    scene.background = skyTexture(night);
    return () => {
      scene.background = prev;
    };
  }, [night, env, mats, nightK, scene]);

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
  const nightRef = useRef(night);
  nightRef.current = night;

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
        if (pl) pl.visible = nightRef.current && d < 900;
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
              visible={night}
              renderOrder={2}
            />
          )}
        </group>
      ))}
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
  night,
  color,
  intensity,
}: {
  night: boolean;
  color: string;
  intensity: number;
}) {
  const ref = useRef<THREE.DirectionalLight>(null);
  const forced = useMemo(shadowParam, []);
  const [low, setLow] = useState(forced === false);
  const ema = useRef(1 / 60);
  const slowFor = useRef(0);
  const dir = SUN_DIR[night ? "night" : "day"];
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
