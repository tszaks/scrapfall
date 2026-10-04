import { matchEnvironment } from "../matchEnvironment";
import { registerStaticGeometry } from "../staticCollision";
// Renders Dry Gulch from the merged chunk geometry built in mesh.ts. One facade material
// (the western texture array) draws every building, prop, rock face and rail; the ground is
// a single splat-blended plane; chunks cull by frustum and their prop layer by distance.
import { useFrame, useThree } from "@react-three/fiber";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { drain, runSliced, yieldControl } from "../slice";
import { useSunShadow } from "../quality";
import * as THREE from "three";

import type { TimeOfDay } from "../lighting";
import { blendTable } from "../lookBlend";
import { liveLook, todSmooth, useTodK } from "../timeOfDay";
import { SkyDome } from "../TimeScene";
import { provideEventHooks } from "../events/mapHooks";
import { trainRobbery } from "./robbery";
import { riverGLSL } from "./river";
import { addSkyFogUniforms, skyFog } from "../skyFog";
import {
  RIVER_EDGE,
  RIVER_END,
  WK,
  WORDS,
  riverW,
  riverZ,
  sampleTerrain,
  type WesternLayout,
} from "./layout";
import { WESTERN_LOOK, type WesternLook } from "./look";
import { facadeMaterial, facadeTime, westernBackground, westernEnv } from "./materials";
import { WESTERN_SUNSET } from "./look";
import { westernMeshes, DETAIL_RANGE } from "./mesh";
import { useGeometryDetail } from "../environment/detailQuality";
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
// the ground-class splat (street / trail / river / rail per cell, blurred): one texture
// shared by both ground material variants — prepared off the render path via
// prepareWesternExtras (worldBuild.ts), so this stays a WeakMap hit at mount
function* groundSplat(L: WesternLayout): Generator<void, THREE.DataTexture, void> {
  const n = L.cells;
  const raw = new Float32Array(n * n * 4);
  for (let i = 0; i < n; i++) {
    yield;
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
  }
  // soften the edges: two box-blur passes
  const data = new Uint8Array(n * n * 4);
  let src = raw;
  for (let pass = 0; pass < 2; pass++) {
    const dst = new Float32Array(n * n * 4);
    for (let y = 0; y < n; y++) {
      yield;
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
    }
    src = dst;
  }
  for (let i = 0; i < src.length; i++) data[i] = Math.round(Math.min(1, src[i]!) * 255);
  const splat = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  splat.magFilter = THREE.LinearFilter;
  splat.minFilter = THREE.LinearFilter;
  splat.needsUpdate = true;
  return splat;
}

function groundMaterial(L: WesternLayout, cutRiver: boolean, splat: THREE.DataTexture) {
  const arr = westernArrays(WORDS);
  const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  const tl = (l: number) => (TILE_M[l] ?? [8, 8])[0].toFixed(1);
  mat.onBeforeCompile = (sh) => {
    addSkyFogUniforms(sh);
    sh.uniforms["uArr"] = { value: arr.day };
    sh.uniforms["uSplat"] = { value: splat };
    sh.uniforms["uHalf"] = { value: L.half };
    // wet ground: troughs and wells (x, z, radius), up to 16, nearest the town first
    const wet = L.props
      .filter((p) => p.k === "trough" || p.k === "well")
      .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))
      .slice(0, 16)
      .map((p) => new THREE.Vector3(p.x, p.z, p.k === "well" ? 2.6 : 2.0));
    while (wet.length < 16) wet.push(new THREE.Vector3(0, 0, 0));
    sh.uniforms["uWet"] = { value: wet };
    sh.vertexShader = sh.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec2 vGxz;\nvarying float vGNy;\nvarying float vGy;",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvGxz = (modelMatrix * vec4(transformed, 1.0)).xz;\nvGy = (modelMatrix * vec4(transformed, 1.0)).y;\nvGNy = normal.y;",
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
precision highp sampler2DArray;
uniform sampler2DArray uArr;
uniform sampler2D uSplat;
uniform float uHalf;
uniform vec3 uWet[16];
varying vec2 vGxz;
varying float vGNy;
varying float vGy;
${riverGLSL}
float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1, 0)), u.x), mix(gHash(i + vec2(0, 1)), gHash(i + vec2(1, 1)), u.x), u.y);
}`,
      )
      .replace(
        "#include <map_fragment>",
        `vec2 wp = vGxz;
${
  cutRiver
    ? `// the riverbed corridor is drawn by its own carved mesh
if (abs(wp.x) < uHalf - ${RIVER_END.toFixed(1)}) {
  float rz = riverZ(wp.x);
  float rw = riverW(wp.x);
  if (abs(wp.y - rz) < rw * 0.5 + ${(RIVER_EDGE - 0.3).toFixed(2)}) discard;
}`
    : ""
}
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
// wind ripples: parallel sand ridges ~40 cm apart, patchy (they live on the open flats,
// die out where the ground is worked) so bare desert stops reading as smooth clay
{
  float field = smoothstep(0.35, 0.75, gNoise(wp * 0.045 + 31.0));
  float worked = smoothstep(0.15, 0.5, w.r + w.g + w.b + w.a);
  float ridge = sin(dot(wp, vec2(0.86, 0.51)) * 14.0 + gNoise(wp * 0.12) * 5.0);
  col *= 1.0 + ridge * 0.045 * field * (1.0 - worked);
}
col = mix(col, dirt, smoothstep(0.15, 0.6, w.r + (n1 - 0.5) * 0.25));
col = mix(col, mud, smoothstep(0.2, 0.6, w.g + (n1 - 0.5) * 0.2));
col = mix(col, yard, smoothstep(0.2, 0.6, w.b));
// the big packed yards are worked ground, not a slab: churn of dirt and gravel through
// them, drifting stains, and a tone that breathes with the noise
{
  float inYard = smoothstep(0.25, 0.6, w.b);
  float churn = gNoise(wp * 0.09 + 11.0) * 0.6 + gNoise(wp * 0.23 + 43.0) * 0.4;
  col = mix(col, dirt, inYard * smoothstep(0.42, 0.72, churn) * 0.7);
  col = mix(col, bal, inYard * smoothstep(0.5, 0.78, gNoise(wp * 0.14 + 23.0)) * 0.55);
  col *= 1.0 - inYard * (0.1 + 0.16 * (gNoise(wp * 0.3 + 57.0) - 0.5));
  // wheel ruts and hoof-churn wandering across the working yards
  float track = abs(sin(wp.x * 0.9 + gNoise(wp * 0.05) * 9.0 + wp.y * 0.35));
  col *= 1.0 - inYard * smoothstep(0.94, 0.99, track) * 0.16;
}
// cut faces (rail berms, banks, gully sides): the XZ-splatted texture smears down them,
// so steep ground reads as darker rubble-and-stone instead of smeared sand
{
  float steep = smoothstep(0.86, 0.62, vGNy);
  vec3 rubble = col * vec3(0.62, 0.55, 0.5) + vec3(0.05, 0.04, 0.035);
  col = mix(col, rubble * (0.85 + 0.3 * gNoise(wp * 0.6)), steep);
  // sedimentary strata: an exposed berm face shows the bands it was cut through —
  // pale caliche lines alternating with the darker packed dirt between them
  float band = sin(vGy * 2.6 + gNoise(wp * 0.11) * 1.4);
  float stratum = smoothstep(0.55, 0.9, band) * steep;
  col = mix(col, col * vec3(1.3, 1.26, 1.16) + vec3(0.1, 0.095, 0.08), stratum * 0.5);
  float darkBand = smoothstep(0.75, 0.97, -band) * steep;
  col *= 1.0 - darkBand * 0.22;
}
col = mix(col, bal, smoothstep(0.3, 0.7, w.a));
// ---- a street people use: wheel ruts down each lane, hoof-churned dirt between them ----
{
  float street = smoothstep(0.35, 0.8, w.r);
  if (street > 0.0) {
    // which way the traffic runs here: Main Street and the back streets east-west, the cross
    // street north-south
    bool ns = wp.x > -31.0 && wp.x < -13.0 && abs(wp.y) > 13.0;
    float along = ns ? wp.y : wp.x;
    float across = ns ? wp.x + 22.0 : (abs(wp.y) < 14.0 ? wp.y : (wp.y < 0.0 ? wp.y + 64.0 : wp.y - 78.0));
    float wob = gNoise(vec2(along * 0.03, 3.0)) * 0.9 + gNoise(vec2(along * 0.11, 7.0)) * 0.25;
    float rut = 0.0;
    // two lanes each way on Main Street, one lane each way on the side streets
    for (int k = 0; k < 4; k++) {
      float lane = abs(wp.y) < 14.0 && !ns ? (k < 2 ? -2.6 : 2.6) + (k == 1 || k == 3 ? 0.0 : 0.0) : (k < 2 ? -1.6 : 1.6);
      float wheel = (k % 2 == 0 ? -0.78 : 0.78);
      float d = abs(across - lane - wheel - wob);
      rut = max(rut, 1.0 - smoothstep(0.08, 0.26, d));
    }
    // hoofprints: small dark crescents scattered down the middle of the lanes
    vec2 hc = floor(wp * 2.2);
    vec2 hf = fract(wp * 2.2) - vec2(gHash(hc), gHash(hc + 7.0));
    float hoof = (1.0 - smoothstep(0.06, 0.14, length(hf * vec2(1.0, 1.4)))) * step(0.55, gHash(hc + 3.0));
    float laneMid = 1.0 - smoothstep(0.6, 1.4, min(abs(abs(across) - 2.6), abs(abs(across) - 1.6)) );
    col *= 1.0 - street * (rut * 0.2 + hoof * laneMid * 0.22);
    // compacted crowns between the ruts read a touch lighter
    col *= 1.0 + street * 0.05 * (1.0 - rut) * laneMid;
  }
}
// ---- wet mud round the troughs and the town well ----
for (int i = 0; i < 16; i++) {
  vec3 tq = uWet[i];
  if (tq.z <= 0.0) continue;
  float d = length(wp - tq.xy);
  float edge = tq.z * (0.8 + 0.4 * gNoise(wp * 1.3 + float(i)));
  float wet = 1.0 - smoothstep(edge * 0.5, edge, d);
  col = mix(col, col * vec3(0.52, 0.46, 0.42), wet * 0.85);
}
diffuseColor.rgb *= col;`,
      );
  };
  mat.customProgramCacheKey = () => (cutRiver ? "western-ground-cut-v3" : "western-ground-v3");
  return { mat, splat };
}

/** Indexed terrain and collision sample the identical fixed diagonal in every cell. */
function* earthMesh(L: WesternLayout): Generator<void, THREE.BufferGeometry, void> {
  const t = L.earth,
    side = t.n + 1,
    p = new Float32Array(side * side * 3),
    uv = new Float32Array(side * side * 2),
    indices: number[] = [];
  for (let i = 0; i <= t.n; i++) {
    yield;
    for (let j = 0; j <= t.n; j++) {
      const k = i * side + j,
        x = -t.half + i * t.cell,
        z = -t.half + j * t.cell;
      p.set([x, t.h[k]!, z], k * 3);
      uv.set([i / t.n, j / t.n], k * 2);
      if (i < t.n && j < t.n) {
        const a = k,
          b = k + side,
          c = k + 1,
          d = k + side + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(p, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/** the dry riverbed: a strip of ground carved below grade along the wash, following the
 * layout's terrain (so you walk exactly on what you see); its edge tucks just under the plain */
function* riverbedMesh(L: WesternLayout): Generator<void, THREE.BufferGeometry, void> {
  const pos: number[] = [];
  const nor: number[] = [];
  const x0 = -L.half + RIVER_END;
  const x1 = L.half - RIVER_END;
  const cols: [number, number, number][][] = [];
  const Y = (x: number, z: number) => sampleTerrain(L.terrain, x, z);
  for (let x = x0; x <= x1 + 1e-6; x += 2) {
    yield;
    const rz = riverZ(x);
    const hw = riverW(x) / 2 + RIVER_EDGE;
    const col: [number, number, number][] = [];
    // A shared cross-section count joins the changing widths without triangular gaps.
    const steps = 48;
    for (let k = 0; k <= steps; k++) {
      const z = rz - hw + (hw * 2 * k) / steps;
      const edge = k === 0 || k === steps;
      col.push([x, edge ? -0.03 : Math.min(Y(x, z), -0.01), z]);
    }
    cols.push(col);
  }
  const nrm = (x: number, z: number) => {
    const dx = Y(x - 0.5, z) - Y(x + 0.5, z);
    const dz = Y(x, z - 0.5) - Y(x, z + 0.5);
    const l = Math.hypot(dx, 1, dz);
    return [dx / l, 1 / l, dz / l];
  };
  for (let c = 0; c + 1 < cols.length; c++) {
    const a = cols[c]!;
    const b = cols[c + 1]!;
    const n = Math.min(a.length, b.length);
    for (let k = 0; k + 1 < n; k++) {
      const q = [a[k]!, a[k + 1]!, b[k + 1]!, a[k]!, b[k + 1]!, b[k]!];
      for (const v of q) {
        pos.push(v[0], v[1], v[2]);
        nor.push(...nrm(v[0], v[2]));
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.computeBoundingSphere();
  return g;
}

// the earth/river geometry and the shared ground splat: heavy vertex/texture work that
// used to sit in the scene's useMemos. worldBuild.ts runs it across tasks; the scene's
// memos below are WeakMap lookups.
type WesternExtras = {
  splat: THREE.DataTexture;
  earth: THREE.BufferGeometry;
  river: THREE.BufferGeometry;
};
const extrasCache = new WeakMap<WesternLayout, WesternExtras>();
export async function prepareWesternExtras(L: WesternLayout): Promise<void> {
  if (extrasCache.has(L)) return;
  // the texture-array bake and the painted skies are module-cached: run them here, one
  // task each, so the mount commit doesn't pay them all at once
  const t = await import("./textures");
  const m = await import("./materials");
  const s = await import("../sky");
  await t.prepareWesternArrays(WORDS);
  await t.prepareWesternSky("sunset");
  await t.prepareWesternSky("night");
  // the sunset background bakes a 1536x768 sky; prepareSunsetBackground slices it
  await s.prepareSunsetBackground("western-sunset", WESTERN_SUNSET, 1536, 768);
  m.westernBackground("night");
  await yieldControl();
  const splat = await runSliced(groundSplat(L));
  const earth = await runSliced(earthMesh(L));
  const river = await runSliced(riverbedMesh(L));
  extrasCache.set(L, { splat, earth, river });
}
function westernExtras(L: WesternLayout): WesternExtras {
  return (
    extrasCache.get(L) ?? {
      splat: drain(groundSplat(L)),
      earth: drain(earthMesh(L)),
      river: drain(riverbedMesh(L)),
    }
  );
}

/** the look part-way from sunset (0) to night (1): the waves carry the match into night */
const blended = new Map<number, WesternLook>();
function westernLookAt(k: number): WesternLook {
  if (k <= 0) return WESTERN_LOOK.sunset;
  if (k >= 1) return WESTERN_LOOK.night;
  const key = Math.round(k * 256);
  let l = blended.get(key);
  if (!l) {
    if (blended.size > 300) blended.clear();
    l = blendTable(WESTERN_LOOK.sunset, WESTERN_LOOK.night, key / 256);
    blended.set(key, l);
  }
  return l;
}
/** a smaller copy of a sky canvas, so both reflection maps come out the same PMREM size */
function resized(src: THREE.Texture, w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d")!.drawImage(src.image as CanvasImageSource, 0, 0, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = src.colorSpace;
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}

export const WesternScene = memo(function WesternScene({
  layout,
}: {
  layout: WesternLayout;
  /** legacy: the time of day now comes from timeOfDay.ts */
  time?: TimeOfDay;
}) {
  const gl = useThree((s) => s.gl);
  // the time of day in 1/64 steps; the reflections and the sky disc swap at the midpoint
  const nk = useTodK();
  const mode: WMode = nk >= 0.5 ? "night" : "sunset";
  // the train is the TRAIN ROBBERY map event's set piece while this map is up
  useEffect(() => {
    provideEventHooks("train-robbery", trainRobbery);
    return () => provideEventHooks("train-robbery", null);
  }, []);
  const look = westernLookAt(nk);
  // geometry was built across tasks while the world assembled (mesh.ts prepares it);
  // this useMemo is a cache lookup, not the multi-second vertex pass it used to be
  const built = useMemo(() => westernMeshes(layout), [layout]);
  useGeometryDetail(built.details.map((d) => d.geometry));
  useLayoutEffect(
    () =>
      registerStaticGeometry(
        "map",
        built.chunks.flatMap((c) => [c.main]).concat(built.details.map((d) => d.geometry)),
      ),
    [built],
  );

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
  // detail cells fade out over a band instead of snapping: a sign's trim popping in at
  // the far side of a 120 m sightline reads as a blink, so each cell gets its own
  // material (same factory — the night/time uniforms are shared objects)
  const detailMats = useMemo(
    () =>
      built.details.map(() => {
        const m = facadeMaterial(nightK);
        m.transparent = true;
        return m;
      }),
    [built, nightK],
  );
  // splat + earth + riverbed were baked across tasks in the world build (extras cache)
  const extras = useMemo(() => westernExtras(layout), [layout]);
  const earthGeo = extras.earth;
  const riverGeo = extras.river;
  const ground = useMemo(() => groundMaterial(layout, true, extras.splat), [layout, extras]);
  const riverMat = useMemo(() => groundMaterial(layout, false, extras.splat), [layout, extras]);
  useEffect(
    () => () => {
      ground.mat.dispose();
      ground.splat.dispose();
      riverMat.mat.dispose();
      riverGeo.dispose();
      earthGeo.dispose();
    },
    [ground, riverMat, riverGeo, earthGeo],
  );

  // reflection env maps: a small PMREM of each sky
  // PMREM renders are synchronous GL work: keep them out of the mount commit — they run
  // as their own task a frame later (materials render without an envmap until it lands,
  // behind the loading veil)
  const [env, setEnv] = useState<{
    sunset: THREE.WebGLRenderTarget;
    night: THREE.WebGLRenderTarget;
  } | null>(null);
  useEffect(() => {
    let dead = false;
    void (async () => {
      await yieldControl();
      if (dead) return;
      const pm = new THREE.PMREMGenerator(gl);
      const sunsetSrc = westernBackground("sunset");
      const sunset = pm.fromEquirectangular(sunsetSrc);
      await yieldControl();
      if (dead) {
        sunset.dispose();
        pm.dispose();
        return;
      }
      // same width as the sunset so both PMREMs share one size (no shader change at the swap)
      const nightSrc = resized(
        westernSky("night"),
        (sunsetSrc.image as { width: number }).width,
        (sunsetSrc.image as { height: number }).height,
      );
      const nightRT = pm.fromEquirectangular(nightSrc);
      nightSrc.dispose();
      pm.dispose();
      if (dead) {
        sunset.dispose();
        nightRT.dispose();
        return;
      }
      setEnv({ sunset, night: nightRT });
    })();
    return () => {
      dead = true;
    };
  }, [gl]);
  useEffect(
    () => () => {
      env?.sunset.dispose();
      env?.night.dispose();
    },
    [env],
  );

  // reflections: the sunset or the night map, swapped at the midpoint while they are faded
  // right down (so the swap never shows)
  useEffect(() => {
    if (!env) return;
    const e = mode === "night" ? env.night.texture : env.sunset.texture;
    mats.facade.envMap = e;
    westernEnv.map = e;
    mats.facade.needsUpdate = true;
    ground.mat.envMap = e;
    ground.mat.needsUpdate = true;
  }, [mode, env, mats, ground]);
  useEffect(() => {
    const dip = Math.min(1, Math.abs(nk - 0.5) / 0.12);
    mats.facade.envMapIntensity = look.env * dip;
    westernEnv.intensity = look.env * dip;
    ground.mat.envMapIntensity = 0.35 * dip;
    nightK.value = look.windows;
    mats.glow.color.setScalar(look.flames);
    mats.flame.color.set("#ffa040").multiplyScalar(look.flames);
    // lantern light pools fade in with the dark
    mats.pools.opacity = 0.85 * todSmooth(0.3, 0.8, nk);
    // the sun sinks and fades, then the moon rises
    const disc = mode === "night" ? mats.moon : mats.disc;
    disc.opacity = mode === "night" ? todSmooth(0.5, 0.75, nk) : 1 - todSmooth(0.25, 0.5, nk);
  }, [nk, mode, mats, nightK, look, ground]);
  const skies = useMemo(
    () => ({ sunset: westernBackground("sunset"), night: westernBackground("night") }),
    [],
  );

  useEffect(
    () => () => {
      for (const c of built.chunks) [c.main, c.glow, c.pools].forEach((g) => g?.dispose());
      for (const d of built.details) d.geometry.dispose();
      built.far.dispose();
    },
    [built],
  );
  useEffect(() => () => detailMats.forEach((m) => m.dispose()), [detailMats]);
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
  const poolsOn = useRef(nk > 0.3);
  poolsOn.current = nk > 0.3;
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
    facadeTime.value = t;
    const cam = state.camera;
    // the disc: always straight toward the sun/moon, far away, facing the camera
    const disc = discRef.current;
    if (disc) {
      const daylight = matchEnvironment.kind === "sunny" || matchEnvironment.kind === "rain";
      const d = SKY_DIR[mode];
      disc.visible = matchEnvironment.kind !== "rain";
      const dist = 3000;
      disc.position.set(
        cam.position.x + (daylight ? liveLook.sunDir.x : d[0]) * dist,
        cam.position.y + (daylight ? liveLook.sunDir.y : d[1]) * dist,
        cam.position.z + (daylight ? liveLook.sunDir.z : d[2]) * dist,
      );
      disc.quaternion.copy(cam.quaternion);
      disc.scale.setScalar(daylight ? 280 : look.disc.size);
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
        const pl = poolRefs.current[i];
        if (pl) pl.visible = poolsOn.current && d < 500;
      });
      built.details.forEach((d, i) => {
        const dx = Math.max(d.x0 - cam.position.x, 0, cam.position.x - d.x1);
        const dz = Math.max(d.z0 - cam.position.z, 0, cam.position.z - d.z1);
        const det = detailRefs.current[i],
          dm = detailMats[i];
        if (!det || !dm) return;
        // fade over the last 15 m of range rather than popping at the cutoff
        const o = Math.min(1, Math.max(0, (DETAIL_RANGE + 15 - Math.hypot(dx, dz)) / 15));
        det.visible = o > 0;
        if (o !== dm.opacity) dm.opacity = o;
        if (dm.envMap !== mats.facade.envMap) {
          dm.envMap = mats.facade.envMap;
          dm.needsUpdate = true;
        }
        dm.envMapIntensity = mats.facade.envMapIntensity;
      });
    }
  });

  const ext = layout.extent;
  return (
    <group>
      <SkyDome sunset={skies.sunset} night={skies.night} />
      <InteriorLights lamps={layout.lamps} />
      {/* the desert floor, out to the horizon */}
      <mesh geometry={earthGeo} material={ground.mat} receiveShadow />
      {/* Four horizon strips leave the playable terrain unobscured, including its wash. */}
      {[-1, 1].map((s) => (
        <group key={s}>
          <mesh
            rotation-x={-Math.PI / 2}
            position={[(s * (ext + layout.half)) / 2, -0.04, 0]}
            material={ground.mat}
            receiveShadow
          >
            <planeGeometry args={[ext - layout.half, ext * 2]} />
          </mesh>
          <mesh
            rotation-x={-Math.PI / 2}
            position={[0, -0.04, (s * (ext + layout.half)) / 2]}
            material={ground.mat}
            receiveShadow
          >
            <planeGeometry args={[layout.half * 2, ext - layout.half]} />
          </mesh>
        </group>
      ))}
      <mesh geometry={riverGeo} material={riverMat.mat} receiveShadow />
      <mesh geometry={built.far} material={mats.facade} receiveShadow />
      {built.chunks.map((c, i) => (
        <group key={i}>
          {c.main && <mesh geometry={c.main} material={mats.facade} castShadow receiveShadow />}
          {c.glow && <mesh geometry={c.glow} material={mats.glow} />}
          {c.pools && (
            <mesh
              ref={(m) => {
                poolRefs.current[i] = m;
              }}
              geometry={c.pools}
              material={mats.pools}
              visible={nk > 0.3}
              renderOrder={2}
            />
          )}
        </group>
      ))}
      {built.details.map((d, i) => (
        <mesh
          key={i}
          ref={(m) => {
            detailRefs.current[i] = m;
          }}
          geometry={d.geometry}
          material={detailMats[i]!}
          castShadow
          receiveShadow
        />
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

/** Lamplight inside the walk-in buildings: a few warm point lights that follow the camera
 * to the nearest interior lamps (a fixed count, so no shader ever recompiles). */
function InteriorLights({ lamps }: { lamps: { x: number; y: number; z: number }[] }) {
  const refs = useRef<(THREE.PointLight | null)[]>([]);
  const near = useMemo(() => lamps.map((l, i) => ({ ...l, i, d: 0 })), [lamps]);
  useFrame(({ camera }) => {
    const c = camera.position;
    for (const l of near) l.d = Math.hypot(l.x - c.x, l.z - c.z);
    near.sort((a, b) => a.d - b.d);
    refs.current.forEach((pl, k) => {
      if (!pl) return;
      const l = near[k];
      if (!l || l.d > 45) {
        pl.intensity = 0;
        return;
      }
      pl.position.set(l.x, l.y - 0.3, l.z);
      pl.intensity = 9 * (1 - Math.max(0, (l.d - 28) / 17));
    });
  });
  return (
    <>
      {[0, 1, 2].map((k) => (
        <pointLight
          key={k}
          ref={(p) => {
            refs.current[k] = p;
          }}
          color="#ffb070"
          distance={11}
          decay={1.4}
          intensity={0}
        />
      ))}
    </>
  );
}

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

const SUN_RANGE = 90;
const SUN_MAP = 2048;
const SUN_DIST = 900;

/**
 * Dry Gulch's sun (or moon): a directional light whose shadow frustum follows the player,
 * snapped to shadow texels so edges don't shimmer. The low sunset sun throws shadows the
 * length of a building lot down Main Street. The shadow follows the graphics quality tier.
 */
export function WesternSun(_props: { time?: TimeOfDay }) {
  const ref = useRef<THREE.DirectionalLight>(null);
  const shadow = useSunShadow(ref, SUN_MAP);
  useFrame((state, raw) => {
    const l = ref.current;
    if (!l) return;
    // the blended sun (sinking at dusk) or moon for the current time of day
    const d = liveLook.sunDir;
    const dir = [d.x, d.y, d.z] as const;
    l.color.copy(liveLook.sunColor);
    l.intensity = liveLook.sunI;
    const texel = (SUN_RANGE * 2) / shadow.size;
    const cx = Math.round(state.camera.position.x / texel) * texel;
    const cz = Math.round(state.camera.position.z / texel) * texel;
    l.target.position.set(cx, 0, cz);
    l.target.updateMatrixWorld();
    l.position.set(cx + dir[0] * SUN_DIST, dir[1] * SUN_DIST, cz + dir[2] * SUN_DIST);
  });
  return (
    <directionalLight
      ref={ref}
      castShadow={shadow.cast}
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
