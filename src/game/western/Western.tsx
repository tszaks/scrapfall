// Renders Dry Gulch from the merged chunk geometry built in mesh.ts. One facade material
// (the western texture array) draws every building, prop, rock face and rail; the ground is
// a single splat-blended plane; chunks cull by frustum and their prop layer by distance.
import { useFrame, useThree } from "@react-three/fiber";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import type { TimeOfDay } from "../lighting";
import { addSkyFogUniforms, skyFog } from "../skyFog";
import { WK, WORDS, type WesternLayout } from "./layout";
import { WESTERN_LOOK } from "./look";
import { facadeMaterial, westernBackground, westernEnv } from "./materials";
import { buildWesternMeshes, DETAIL_RANGE } from "./mesh";
import {
  SKY_DIR,
  TILE_M,
  WL,
  moonTexture,
  sunTexture,
  softGlow,
  westernArrays,
  westernSky,
  type WMode,
} from "./textures";

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

/** The ground: desert sand everywhere, blended with street dirt, riverbed mud, packed yards
 * and ballast from a per-cell splat map, with large-scale colour drift so it never tiles. */
function groundMaterial(L: WesternLayout) {
  const arr = westernArrays(WORDS);
  const n = L.cells;
  const raw = new Float32Array(n * n * 4);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const g = L.ground[i * n + j]!;
      const o = (j * n + i) * 4; // texture x = world x, texture y = world z
      if (g === WK.STREET) raw[o] = 1;
      else if (g === WK.TRAIL) raw[o] = 0.75;
      else if (g === WK.LOT || g === WK.BOARD) raw[o] = 0.8;
      else if (g === WK.RIVER) raw[o + 1] = 1;
      else if (g === WK.YARD || g === WK.PLATFORM) raw[o + 2] = 1;
      else if (g === WK.RAIL) raw[o + 3] = 1;
    }
  // soften the edges: two box-blur passes
  const data = new Uint8Array(n * n * 4);
  let src = raw;
  for (let pass = 0; pass < 2; pass++) {
    const dst = new Float32Array(n * n * 4);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++)
        for (let c = 0; c < 4; c++) {
          let s = 0;
          let k = 0;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx;
              const yy = y + dy;
              if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
              s += src[(yy * n + xx) * 4 + c]!;
              k++;
            }
          dst[(y * n + x) * 4 + c] = s / k;
        }
    src = dst;
  }
  for (let i = 0; i < src.length; i++) data[i] = Math.round(Math.min(1, src[i]!) * 255);
  const splat = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  splat.magFilter = THREE.LinearFilter;
  splat.minFilter = THREE.LinearFilter;
  splat.needsUpdate = true;

  const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  const tl = (l: number) => (TILE_M[l] ?? [8, 8])[0].toFixed(1);
  mat.onBeforeCompile = (sh) => {
    addSkyFogUniforms(sh);
    sh.uniforms["uArr"] = { value: arr.day };
    sh.uniforms["uSplat"] = { value: splat };
    sh.uniforms["uHalf"] = { value: L.half };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vGxz;")
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvGxz = (modelMatrix * vec4(transformed, 1.0)).xz;",
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
precision highp sampler2DArray;
uniform sampler2DArray uArr;
uniform sampler2D uSplat;
uniform float uHalf;
varying vec2 vGxz;
float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1, 0)), u.x), mix(gHash(i + vec2(0, 1)), gHash(i + vec2(1, 1)), u.x), u.y);
}`,
      )
      .replace(
        "#include <map_fragment>",
        `vec2 wp = vGxz;
float n1 = gNoise(wp * 0.02) * 0.6 + gNoise(wp * 0.09) * 0.4;
vec2 jitter = vec2(gNoise(wp * 0.35), gNoise(wp * 0.35 + 17.0)) - 0.5;
vec4 w = texture2D(uSplat, (wp + jitter * 2.2 + uHalf) / (2.0 * uHalf));
vec2 inMap = step(abs(wp), vec2(uHalf));
w *= inMap.x * inMap.y;
vec3 sand = texture(uArr, vec3(wp / ${tl(WL.SAND)}, ${WL.SAND}.0)).rgb;
vec3 sand2 = texture(uArr, vec3(wp / 23.0 + 0.37, ${WL.SAND}.0)).rgb;
sand = mix(sand, sand2, 0.35);
sand *= mix(vec3(0.86, 0.8, 0.76), vec3(1.06, 1.02, 0.98), n1);
vec3 dirt = texture(uArr, vec3(wp / ${tl(WL.DIRT)}, ${WL.DIRT}.0)).rgb;
vec3 mud = texture(uArr, vec3(wp / ${tl(WL.MUD)}, ${WL.MUD}.0)).rgb;
vec3 yard = texture(uArr, vec3(wp / ${tl(WL.YARD)}, ${WL.YARD}.0)).rgb;
vec3 bal = texture(uArr, vec3(wp / ${tl(WL.BALLAST)}, ${WL.BALLAST}.0)).rgb;
vec3 col = sand;
col = mix(col, dirt, smoothstep(0.15, 0.6, w.r + (n1 - 0.5) * 0.25));
col = mix(col, mud, smoothstep(0.2, 0.6, w.g + (n1 - 0.5) * 0.2));
col = mix(col, yard, smoothstep(0.2, 0.6, w.b));
col = mix(col, bal, smoothstep(0.3, 0.7, w.a));
diffuseColor.rgb *= col;`,
      );
  };
  mat.customProgramCacheKey = () => "western-ground-v1";
  return { mat, splat };
}

export const WesternScene = memo(function WesternScene({
  layout,
  time,
}: {
  layout: WesternLayout;
  time: TimeOfDay;
}) {
  const { gl, scene } = useThree();
  const mode: WMode = time;
  const look = WESTERN_LOOK[mode];
  const built = useMemo(() => {
    const t0 = performance.now();
    const m = buildWesternMeshes(layout);
    if (import.meta.env.DEV)
      console.info(
        `[western] built ${m.chunks.length} chunks, ${m.stats.verts} verts in ${Math.round(performance.now() - t0)} ms`,
      );
    return m;
  }, [layout]);

  const nightK = useMemo(() => ({ value: 0 }), []);
  const mats = useMemo(
    () => ({
      facade: facadeMaterial(nightK),
      glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
      pools: new THREE.MeshBasicMaterial({
        vertexColors: true,
        map: softGlow(),
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
      disc: new THREE.MeshBasicMaterial({
        map: sunTexture(),
        transparent: true,
        depthWrite: false,
        fog: false,
        toneMapped: false,
      }),
      moon: new THREE.MeshBasicMaterial({
        map: moonTexture(),
        transparent: true,
        depthWrite: false,
        fog: false,
        toneMapped: false,
      }),
      blades: new THREE.MeshLambertMaterial({ color: "#8a8a86", side: THREE.DoubleSide }),
      flame: new THREE.MeshBasicMaterial({ color: "#ffa040", toneMapped: false }),
    }),
    [nightK],
  );
  const ground = useMemo(() => groundMaterial(layout), [layout]);
  useEffect(
    () => () => {
      ground.mat.dispose();
      ground.splat.dispose();
    },
    [ground],
  );

  // reflection env maps: a small PMREM of each sky
  const env = useMemo(() => {
    const pm = new THREE.PMREMGenerator(gl);
    const sunset = pm.fromEquirectangular(westernBackground("sunset"));
    const nightRT = pm.fromEquirectangular(westernSky("night"));
    pm.dispose();
    return { sunset, night: nightRT };
  }, [gl]);
  useEffect(
    () => () => {
      env.sunset.dispose();
      env.night.dispose();
    },
    [env],
  );

  useEffect(() => {
    const e = mode === "night" ? env.night.texture : env.sunset.texture;
    mats.facade.envMap = e;
    mats.facade.envMapIntensity = look.env;
    westernEnv.map = e;
    westernEnv.intensity = look.env;
    mats.facade.needsUpdate = true;
    ground.mat.envMap = e;
    ground.mat.envMapIntensity = 0.35;
    ground.mat.needsUpdate = true;
    nightK.value = look.windows;
    mats.glow.color.setScalar(look.flames);
    mats.flame.color.set("#ffa040").multiplyScalar(look.flames);
    // the directional haze warms toward our sun, not the city's
    const d = SKY_DIR[mode];
    skyFog.fogSunDir.value.set(d[0], d[1], d[2]).normalize();
    const prev = scene.background;
    scene.background = westernBackground(mode);
    return () => {
      scene.background = prev;
    };
  }, [mode, env, mats, nightK, scene, look, ground]);

  useEffect(
    () => () => {
      for (const c of built.chunks)
        [c.main, c.detail, c.glow, c.pools].forEach((g) => g?.dispose());
      built.far.dispose();
    },
    [built],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  // ---- windmill wheels (animated) ----
  const blades = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    const n = 18;
    for (let i = 0; i < n; i++) {
      const b = new THREE.BoxGeometry(0.04, 1.35, 0.28);
      b.translate(0, 1.15, 0);
      b.rotateX(0.35); // blade pitch
      b.rotateZ((i / n) * Math.PI * 2);
      parts.push(b);
    }
    const ring = new THREE.TorusGeometry(1.5, 0.04, 4, 24);
    const ring2 = new THREE.TorusGeometry(0.75, 0.035, 4, 18);
    parts.push(ring, ring2);
    const hub = new THREE.CylinderGeometry(0.16, 0.16, 0.3, 8);
    hub.rotateX(Math.PI / 2);
    parts.push(hub);
    const merged = mergeGeos(parts);
    parts.forEach((p) => p.dispose());
    return merged;
  }, []);
  useEffect(() => () => blades.dispose(), [blades]);
  const bladeRef = useRef<THREE.InstancedMesh>(null);

  // ---- fire flames (flicker) ----
  const flameGeo = useMemo(
    () => new THREE.ConeGeometry(0.34, 1, 6, 1, true).translate(0, 0.5, 0),
    [],
  );
  useEffect(() => () => flameGeo.dispose(), [flameGeo]);
  const flameRef = useRef<THREE.InstancedMesh>(null);

  // ---- the sun / moon disc ----
  const discGeo = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  useEffect(() => () => discGeo.dispose(), [discGeo]);
  const discRef = useRef<THREE.Mesh>(null);

  // ---- LOD refs ----
  const detailRefs = useRef<(THREE.Mesh | null)[]>([]);
  const poolRefs = useRef<(THREE.Mesh | null)[]>([]);
  const lodTick = useRef(0);
  const poolsOn = useRef(look.pools);
  poolsOn.current = look.pools;
  useEffect(() => {
    lodTick.current = 0; // re-evaluate pools right away after a mode switch
  }, [mode]);

  useLayoutEffect(() => {
    const m = bladeRef.current;
    if (!m) return;
    m.count = built.windmills.length;
  }, [built]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const cam = state.camera;
    // the disc: always straight toward the sun/moon, far away, facing the camera
    const disc = discRef.current;
    if (disc) {
      const d = SKY_DIR[mode];
      const dist = 3000;
      disc.position.set(
        cam.position.x + d[0] * dist,
        cam.position.y + d[1] * dist,
        cam.position.z + d[2] * dist,
      );
      disc.quaternion.copy(cam.quaternion);
      disc.scale.setScalar(look.disc.size);
    }
    // windmills turn in the evening breeze
    const bm = bladeRef.current;
    if (bm) {
      built.windmills.forEach((w, i) => {
        _e.set(0, w.rot, 0);
        _q.setFromEuler(_e);
        const spin = new THREE.Quaternion().setFromAxisAngle(_v.set(0, 0, 1), t * 1.6 + i);
        _q.multiply(spin);
        _m4.compose(
          _v.set(w.x + Math.sin(w.rot) * 0.6 * w.s, w.y, w.z + Math.cos(w.rot) * 0.6 * w.s),
          _q,
          _s.set(w.s, w.s, w.s),
        );
        bm.setMatrixAt(i, _m4);
      });
      bm.instanceMatrix.needsUpdate = true;
    }
    const fm = flameRef.current;
    if (fm) {
      built.fires.forEach((f, i) => {
        const k = 0.8 + Math.sin(t * 11 + i * 3) * 0.12 + Math.sin(t * 23 + i) * 0.08;
        _m4.compose(
          _v.set(f.x, f.y - 0.3, f.z),
          _q.setFromEuler(_e.set(0, t * 2 + i, 0)),
          _s.set(f.s * k, f.s * (0.9 + k * 0.4), f.s * k),
        );
        fm.setMatrixAt(i, _m4);
      });
      fm.instanceMatrix.needsUpdate = true;
    }
    // distance LOD, a few times a second
    lodTick.current -= 1;
    if (lodTick.current <= 0) {
      lodTick.current = 6;
      built.chunks.forEach((c, i) => {
        const dx = Math.max(c.x0 - cam.position.x, 0, cam.position.x - c.x1);
        const dz = Math.max(c.z0 - cam.position.z, 0, cam.position.z - c.z1);
        const d = Math.hypot(dx, dz);
        const det = detailRefs.current[i];
        if (det) det.visible = d < DETAIL_RANGE;
        const pl = poolRefs.current[i];
        if (pl) pl.visible = poolsOn.current && d < 500;
      });
    }
  });

  const ext = layout.extent;
  return (
    <group>
      {/* the desert floor, out to the horizon */}
      <mesh rotation-x={-Math.PI / 2} position-y={0} material={ground.mat} receiveShadow>
        <planeGeometry args={[ext * 2, ext * 2]} />
      </mesh>
      <mesh geometry={built.far} material={mats.facade} receiveShadow />
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
          {c.pools && (
            <mesh
              ref={(m) => {
                poolRefs.current[i] = m;
              }}
              geometry={c.pools}
              material={mats.pools}
              visible={look.pools}
              renderOrder={2}
            />
          )}
        </group>
      ))}
      {built.windmills.length > 0 && (
        <instancedMesh
          ref={bladeRef}
          args={[blades, mats.blades, built.windmills.length]}
          castShadow
          frustumCulled={false}
        />
      )}
      {built.fires.length > 0 && (
        <instancedMesh
          ref={flameRef}
          args={[flameGeo, mats.flame, built.fires.length]}
          frustumCulled={false}
        />
      )}
      <mesh
        ref={discRef}
        geometry={discGeo}
        material={mode === "night" ? mats.moon : mats.disc}
        renderOrder={-1}
        frustumCulled={false}
      />
      <DiscTint mat={mode === "night" ? mats.moon : mats.disc} color={look.disc.color} />
    </group>
  );
});

function DiscTint({ mat, color }: { mat: THREE.MeshBasicMaterial; color: string }) {
  useEffect(() => {
    // unlit and past 1.0: the core burns brighter than the glowing sky around it
    mat.color.set(color).multiplyScalar(1.35);
  }, [mat, color]);
  return null;
}

/** merge plain (position + normal) geometries into one */
function mergeGeos(list: THREE.BufferGeometry[]) {
  let count = 0;
  const flat = list.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of flat) count += g.getAttribute("position").count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  let o = 0;
  for (const g of flat) {
    const p = g.getAttribute("position");
    const n = g.getAttribute("normal");
    for (let i = 0; i < p.count; i++) {
      pos[o * 3] = p.getX(i);
      pos[o * 3 + 1] = p.getY(i);
      pos[o * 3 + 2] = p.getZ(i);
      nor[o * 3] = n.getX(i);
      nor[o * 3 + 1] = n.getY(i);
      nor[o * 3 + 2] = n.getZ(i);
      o++;
    }
  }
  flat.forEach((g, i) => {
    if (g !== list[i]) g.dispose();
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  out.computeBoundingSphere();
  return out;
}

/** `?shadows=0` forces shadows off, `?shadows=1` keeps them on (no auto fallback). */
function shadowParam(): boolean | null {
  if (typeof window === "undefined") return null;
  const v = new URLSearchParams(window.location.search).get("shadows");
  return v === "0" ? false : v === "1" ? true : null;
}
const SUN_RANGE = 90;
const SUN_MAP = 2048;
const SUN_DIST = 900;

/**
 * Dry Gulch's sun (or moon): a directional light whose shadow frustum follows the player,
 * snapped to shadow texels so edges don't shimmer. The low sunset sun throws shadows the
 * length of a building lot down Main Street. Slow frames switch shadows off automatically.
 */
export function WesternSun({ time }: { time: TimeOfDay }) {
  const ref = useRef<THREE.DirectionalLight>(null);
  const mode = time;
  const look = WESTERN_LOOK[mode];
  const forced = useMemo(shadowParam, []);
  const [low, setLow] = useState(forced === false);
  const ema = useRef(1 / 60);
  const slowFor = useRef(0);
  const dir = SKY_DIR[mode];
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
        console.info(
          "[western] frames are slow: switching shadows off (use ?shadows=1 to keep them)",
        );
        setLow(true);
      }
    } else slowFor.current = 0;
  });
  return (
    <directionalLight
      ref={ref}
      color={look.sun.color}
      intensity={look.sun.intensity}
      castShadow={!low}
      shadow-mapSize-width={SUN_MAP}
      shadow-mapSize-height={SUN_MAP}
      shadow-camera-left={-SUN_RANGE}
      shadow-camera-right={SUN_RANGE}
      shadow-camera-top={SUN_RANGE}
      shadow-camera-bottom={-SUN_RANGE}
      shadow-camera-near={10}
      shadow-camera-far={SUN_DIST * 2}
      shadow-bias={-0.0004}
      shadow-normalBias={0.06}
    />
  );
}
