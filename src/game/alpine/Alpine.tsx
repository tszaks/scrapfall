import { shelterUniforms, SHELTER_GLSL } from "../structures/weather";
// Renders Whiteout Pass: the heightfield terrain and the endless land beyond, merged
// chunks of chalets and props (one texture-array material), the instanced spruce forest,
// the running chairlift, a painted sky with alpenglow / stars / aurora, falling snow,
// chimney smoke and lamp halos, and the blizzard that closes it all down to ~20 m.
import { useFrame, useThree } from "@react-three/fiber";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSunShadow } from "../quality";
import * as THREE from "three";

import { Geo } from "../cityGeo";
import { terrainY } from "../terrain";
import { buildInto, type Kit } from "./build";
import { chairAt, chairCount, ride } from "./ride";
import { farSpruceGeo, spruceGeo } from "./forest";
import type { AlpineLayout } from "./layout";
import type { TimeOfDay } from "../lighting";
import { alpineLookAt, type AlpineLook } from "./look";
import { liveLook, useTodK } from "../timeOfDay";
import { mulberry } from "./noise";
import { alpineArray, glowTexture, signTexture, T, WHITE_UV } from "./textures";
import {
  FOREST_EXTENT,
  farTrees,
  forestTexture,
  outerTerrain,
  aoTexture,
  playTerrain,
  surfTexture,
} from "./terrainMesh";
import { alpine, tickAlpine } from "./weather";

const CHUNK = 200;
const DETAIL_RANGE = 280;
const TREE_NEAR = 105;
const MAX_NEAR = 2200;

// ---------------------------------------------------------------------------------------
// shared uniforms: every alpine material reads the same atmosphere

const U = {
  uHaze: { value: new THREE.Color("#c9a3b4") },
  uHazeDist: { value: 7000 },
  uHazeMax: { value: 0.82 },
  uMistCol: { value: new THREE.Color("#c9a3b4") },
  uMist: { value: new THREE.Vector2(400, 2600) },
  uFogCol: { value: new THREE.Color("#b9bfd4") },
  uHazeOut: { value: new THREE.Color() },
  uMistOut: { value: new THREE.Color() },
  uFogOut: { value: new THREE.Color() },
  uFogNear: { value: 1e5 },
  uFogFar: { value: 2e5 },
  uSunDir: { value: new THREE.Vector3(-0.8, 0.2, -0.5).normalize() },
  uPeakLit: { value: new THREE.Color("#ff9e84") },
  uAlpen: { value: 1 },
  uWin: { value: 0.6 },
  uTime: { value: 0 },
  /** baked ground light from lamps (rgb), and how strongly it shows (night 1, sunset low) */
  uLightMap: { value: null as THREE.Texture | null },
  uLampK: { value: 1 },
  /** light bounced off the snow onto walls */
  uBounce: { value: new THREE.Color("#33416a") },
  /** the heightfield (so lamp light can fall off with height above the snow) */
  uGround: { value: null as THREE.Texture | null },
};

/** the heightfield with walkable decks (the bridge) written in, for lamp-light falloff */
function withPlatforms(a: AlpineLayout["alpine"]) {
  const t = a.terrain;
  const h = t.h.slice();
  const s = t.n + 1;
  for (const p of t.platforms ?? [])
    for (let i = 0; i <= t.n; i++)
      for (let j = 0; j <= t.n; j++) {
        const x = -t.half + i * t.cell;
        const z = -t.half + j * t.cell;
        if (x > p.x0 - 2 && x < p.x1 + 2 && z > p.z0 - 2 && z < p.z1 + 2) h[i * s + j] = p.y;
      }
  return h;
}

function groundTexture(h: Float32Array, n: number) {
  const t = new THREE.DataTexture(h, n, n, THREE.RedFormat, THREE.FloatType);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

/** paint every lamp's pool of light into one texture over the play area */
function lightMap(lights: [number, number, number, string][], half: number) {
  const n = 1024;
  const c = document.createElement("canvas");
  c.width = n;
  c.height = n;
  const g = c.getContext("2d")!;
  g.fillStyle = "#000";
  g.fillRect(0, 0, n, n);
  g.globalCompositeOperation = "lighter";
  const k = n / (half * 2);
  for (const [x, z, r, col] of lights) {
    const px = (x + half) * k;
    const pz = (z + half) * k;
    const pr = r * k;
    const gr = g.createRadialGradient(px, pz, 0, px, pz, pr);
    const cc = new THREE.Color(col);
    const rgb = (a: number) =>
      `rgba(${Math.round(cc.r * 255)},${Math.round(cc.g * 255)},${Math.round(cc.b * 255)},${a})`;
    gr.addColorStop(0, rgb(0.8));
    gr.addColorStop(0.45, rgb(0.45));
    gr.addColorStop(1, rgb(0));
    g.fillStyle = gr;
    g.fillRect(px - pr, pz - pr, pr * 2, pr * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

/** a linear colour as it lands on screen: ACES filmic tone mapping, then sRGB encoding */
function toScreen(c: THREE.Color, out: THREE.Color, exposure = 1) {
  const k = exposure / 0.6;
  const r = c.r * k;
  const g = c.g * k;
  const b = c.b * k;
  // ACES input matrix
  let x = 0.59719 * r + 0.35458 * g + 0.04823 * b;
  let y = 0.076 * r + 0.90834 * g + 0.01566 * b;
  let z = 0.0284 * r + 0.13383 * g + 0.83777 * b;
  const fit = (v: number) =>
    (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
  x = fit(x);
  y = fit(y);
  z = fit(z);
  const cl = (v: number) => Math.min(1, Math.max(0, v));
  const R = cl(1.60475 * x - 0.53108 * y - 0.07367 * z);
  const G = cl(-0.10208 * x + 1.10813 * y - 0.00605 * z);
  const B = cl(-0.00327 * x - 0.07276 * y + 1.07602 * z);
  const enc = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  return out.setRGB(enc(R), enc(G), enc(B), THREE.LinearSRGBColorSpace);
}

const FOG_VERT_HEAD = /* glsl */ `
varying vec3 vAWorld;
`;
const FOG_VERT_BODY = /* glsl */ `
{
  vec4 aw = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  aw = instanceMatrix * aw;
  #endif
  vAWorld = (modelMatrix * aw).xyz;
}
`;
const FOG_FRAG_HEAD = /* glsl */ `
varying vec3 vAWorld;
uniform vec3 uHaze;
uniform float uHazeDist;
uniform float uHazeMax;
uniform vec3 uMistCol;
uniform vec2 uMist;
uniform vec3 uFogCol;
uniform vec3 uHazeOut;
uniform vec3 uMistOut;
uniform vec3 uFogOut;
uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uSunDir;
uniform vec3 uPeakLit;
uniform float uAlpen;
uniform float uWin;
uniform float uTime;
uniform sampler2D uLightMap;
uniform sampler2D uGround;
uniform float uLampK;
uniform vec3 uBounce;
vec3 aLamp(vec3 wp) {
  if (abs(wp.x) > 399.0 || abs(wp.z) > 399.0) return vec3(0.0);
  // heightfield rows run along x (h[i * (n + 1) + j]), so x is the texture's v axis
  float gy = texture2D(uGround, vec2((wp.z + 400.0) / 800.0, (wp.x + 400.0) / 800.0)).r;
  float fall = 1.0 - smoothstep(0.5, 6.5, wp.y - gy);
  return texture2D(uLightMap, (wp.xz + 400.0) / 800.0).rgb * uLampK * fall;
}
float aHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float aNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(aHash(i), aHash(i + vec2(1.0, 0.0)), u.x), mix(aHash(i + vec2(0.0, 1.0)), aHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;
const FOG_FRAG_BODY = /* glsl */ `
{
  // fog runs after tone mapping and the output transform, so the haze colours arrive
  // already mapped to screen space (see toScreen) and match the sky behind them
  vec3 hazeC = uHazeOut;
  vec3 mistC = uMistOut;
  vec3 fogC = uFogOut;
  float fd = length(vAWorld - cameraPosition);
  float aerial = (1.0 - exp(-fd / uHazeDist)) * uHazeMax;
  // aerial perspective is stronger low in the valley, thinner up on the peaks
  aerial *= mix(1.0, 0.7, smoothstep(300.0, 2500.0, vAWorld.y));
  // valley mist is seen edge-on; looking steeply down from high up it all but vanishes
  float steep = smoothstep(0.25, 0.75, abs(vAWorld.y - cameraPosition.y) / max(fd, 1.0));
  float mist = smoothstep(uMist.x, uMist.y, fd) * 0.35 * (1.0 - smoothstep(150.0, 900.0, vAWorld.y)) * (1.0 - steep);
  aerial *= 1.0 - 0.6 * steep;
  gl_FragColor.rgb = mix(gl_FragColor.rgb, mistC, mist);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, hazeC, aerial);
  float bl = smoothstep(uFogNear, uFogFar, fd);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogC, bl);
}
`;

type Shader = {
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, { value: unknown }>;
};
function withFog(sh: Shader) {
  Object.assign(sh.uniforms, U);
  sh.vertexShader = sh.vertexShader
    .replace("#include <common>", "#include <common>\n" + FOG_VERT_HEAD)
    .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + FOG_VERT_BODY);
  sh.fragmentShader = sh.fragmentShader
    .replace("#include <common>", "#include <common>\n" + FOG_FRAG_HEAD)
    .replace("#include <fog_fragment>", FOG_FRAG_BODY);
}

/** chalets, props and set pieces: texture-array albedo, lit windows, sparkling snow */
function facadeMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 });
  mat.fog = false;
  mat.onBeforeCompile = (sh) => {
    withFog(sh as unknown as Shader);
    sh.uniforms["uArr"] = { value: alpineArray() };
    sh.vertexShader = sh.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute vec2 aUv2;\nattribute vec3 aFac;\nvarying vec2 vFuv;\nvarying vec3 vFac;",
      )
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFuv = aUv2;\nvFac = aFac;");
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
precision highp sampler2DArray;
uniform sampler2DArray uArr;
varying vec2 vFuv;
varying vec3 vFac;`,
      )
      .replace(
        "#include <map_fragment>",
        `float aLayer = floor(vFac.x + 0.5);
vec4 aTex = texture(uArr, vec3(vFuv, aLayer));
diffuseColor.rgb *= aTex.rgb;
bool aWin = aLayer == ${T.window}.0 || aLayer == ${T.glasswall}.0 || aLayer == ${T.door}.0 || aLayer == ${T.arched}.0;
float aMask = aTex.a;`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `float roughnessFactor = roughness;
if (aWin) roughnessFactor = mix(roughness, 0.12, aMask);
if (aLayer == ${T.ice}.0) roughnessFactor = 0.18;
if (aLayer == ${T.metal}.0 || aLayer == ${T.copper}.0) roughnessFactor = 0.55;`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * aLamp(vAWorld) * 0.9;
{
  // snow is a huge soft reflector: walls facing away from the moon still catch its bounce
  vec3 bwN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
  totalEmissiveRadiance += diffuseColor.rgb * uBounce * (0.35 + 0.65 * (1.0 - abs(bwN.y)));
}
if (aWin && aMask > 0.3) {
  float h = aHash(vec2(vFac.y * 977.0, aLayer));
  float lit = step(h, uWin * 0.88);
  vec3 warm = mix(vec3(1.0, 0.5, 0.18), vec3(1.0, 0.72, 0.4), fract(h * 13.7));
  // a little depth: brighter low in the pane, curtain shadow at the top
  float grad = mix(1.1, 0.65, fract(vFuv.y));
  totalEmissiveRadiance += warm * lit * aMask * (aLayer == ${T.glasswall}.0 ? 0.55 : 1.05) * grad;
}
if (aLayer == ${T.snow}.0) {
  vec3 V = normalize(cameraPosition - vAWorld);
  vec3 wN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
  float g = pow(max(dot(reflect(-uSunDir, wN), V), 0.0), 12.0);
  totalEmissiveRadiance += vec3(0.9, 0.95, 1.0) * aMask * (g * 1.5 + dot(aLamp(vAWorld), vec3(0.6)));
  totalEmissiveRadiance += diffuseColor.rgb * uPeakLit * uAlpen * 0.12 * max(dot(wN, uSunDir), 0.0);
}`,
      );
  };
  mat.customProgramCacheKey = () => "alpine-facade-v1";
  return mat;
}

/** the snow itself: packed paths, groomed pistes, ice, rock, forest floor, far forest */
function terrainMaterial(surf: THREE.Texture, forest: THREE.Texture, ao: THREE.Texture) {
  const mat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.9, metalness: 0 });
  mat.fog = false;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms["uSurf"] = { value: surf };
    sh.uniforms["uForest"] = { value: forest };
    sh.uniforms["uAO"] = { value: ao };
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\nfloat inPlayK(vec2 p) { return 1.0 - smoothstep(380.0, 400.0, max(abs(p.x), abs(p.y))); }\nuniform sampler2D uSurf;\nuniform sampler2D uForest;\nuniform sampler2D uAO;\nfloat aSparkle;\nfloat aIce;\nvec2 aBump;\n
// snow relief (metres): wind-sculpted drifts and sastrugi on open snow, trodden dimples on
// paths, twin ski tracks and footpath trails wandering across the fields
float aSnowH(vec2 p, float packedK, float pisteK) {
  float h = aNoise(p * 0.11) * 0.28 + aNoise(p * 0.37) * 0.08;
  h += 0.035 * sin(dot(p, vec2(0.8, 0.6)) * 2.6 + aNoise(p * 0.45) * 5.0) * (1.0 - packedK);
  h += aNoise(p * 5.0) * 0.03 * packedK;
  h -= 0.04 * pisteK * smoothstep(0.35, 0.5, abs(fract((p.x + p.y) * 0.9) - 0.5) * 2.0);
  return h;
}`,
      )
      .replace(
        "#include <map_fragment>",
        `vec3 wN = normalize((vec4(normalize(vNormal), 0.0) * viewMatrix).xyz);
vec2 wp = vAWorld.xz;
bool inPlay = abs(wp.x) < 399.0 && abs(wp.y) < 399.0;
vec4 sf = inPlay ? texture2D(uSurf, (wp + 400.0) / 800.0) : vec4(0.0);
float ao = inPlay ? texture2D(uAO, (wp + 400.0) / 800.0).r : 0.0;
// piste = green alone, ploughed road = green on packed (so neither bleeds into the ice's
// blue channel as the bilinear filter crosses a lake shore)
float pisteK = sf.g * (1.0 - sf.r);
float roadK = min(sf.g, sf.r);
// footpath trails and ski tracks across the open snow (contours of a slow noise field)
float tn = aNoise(wp * 0.021);
float trail = (1.0 - smoothstep(0.006, 0.016, abs(tn - 0.5))) * (1.0 - sf.r) * (1.0 - sf.b) * step(abs(wp.x), 399.0);
float tn2 = aNoise(wp * 0.017 + 40.0);
float ski = (1.0 - smoothstep(0.0015, 0.004, abs(abs(tn2 - 0.5) - 0.012))) * pisteK;
{
  float pk = clamp(sf.r + trail, 0.0, 1.0);
  float e = 0.25;
  float h0 = aSnowH(wp, pk, pisteK);
  aBump = vec2(aSnowH(wp + vec2(e, 0.0), pk, pisteK) - h0, aSnowH(wp + vec2(0.0, e), pk, pisteK) - h0) / e;
  aBump *= (1.0 - smoothstep(60.0, 160.0, length(vAWorld - cameraPosition))) * inPlayK(wp);
}
float farForest = inPlay ? 0.0 : texture2D(uForest, (wp + ${FOREST_EXTENT}.0) / ${FOREST_EXTENT * 2}.0).r;
float n1 = aNoise(wp * 0.05);
float n2 = aNoise(wp * 0.6);
float n3 = aNoise(wp * 3.1);
float slope = 1.0 - wN.y;
// fresh snow: blue-white with soft wind-sculpted variation
vec3 col = mix(vec3(0.9, 0.93, 0.98), vec3(0.97, 0.98, 1.0), n1);
col *= 0.96 + 0.05 * n2;
// packed snow on streets and plazas: warmer, trodden, cobbles peeking through
vec3 packed = mix(vec3(0.8, 0.8, 0.82), vec3(0.88, 0.88, 0.9), n3);
// trodden ruts and the odd cobble showing through
packed *= 0.94 + 0.06 * aNoise(vec2(wp.x * 0.4, wp.y * 4.0));
packed = mix(packed, vec3(0.6, 0.57, 0.55), smoothstep(0.86, 0.95, aNoise(wp * 2.3)) * 0.35);
col = mix(col, packed, sf.r * 0.85);
// ploughed road: darker, grit
col = mix(col, vec3(0.55, 0.55, 0.58) * (0.9 + 0.2 * n3), roadK * 0.8);
// groomed piste: smooth and bright with faint corduroy
float cord = 0.97 + 0.03 * sin((wp.x + wp.y) * 9.0);
col = mix(col, vec3(0.96, 0.97, 1.0) * cord, pisteK * 0.7);
// ice: lake, creek, rink. The shore wanders with a noise so it never follows the 2 m cell
// grid in straight runs and square corners
aIce = smoothstep(0.42, 0.58, sf.b + (aNoise(wp * 0.23) - 0.5) * 0.55 + (aNoise(wp * 0.9) - 0.5) * 0.18);
vec3 ice = mix(vec3(0.55, 0.68, 0.8), vec3(0.72, 0.84, 0.92), aNoise(wp * 0.35));
ice = mix(ice, vec3(0.93, 0.96, 1.0), smoothstep(0.55, 0.8, aNoise(wp * 0.9 + 3.0)) * 0.7);
col = mix(col, ice, aIce);
// trodden trails and ski tracks: compacted, slightly grey
col *= 1.0 - 0.1 * trail - 0.12 * ski;
// walls and trunks shade the snow at their feet
col *= 1.0 - 0.38 * ao;
// forest floor: shaded snow with needle litter
col = mix(col, vec3(0.74, 0.78, 0.82) * (0.9 + 0.15 * n3), sf.a * 0.45);
// far forest seen from above: dark canopy flecked with snow
// (near the map the instanced far trees stand on white snow; the painted canopy takes over
// where they stop)
float canopy = smoothstep(0.15, 0.7, farForest) * (0.55 + 0.45 * aNoise(wp * 0.08)) * smoothstep(650.0, 900.0, max(abs(wp.x), abs(wp.y)));
col = mix(col, mix(vec3(0.13, 0.18, 0.17), vec3(0.7, 0.75, 0.8), step(0.72, n2) * 0.6), canopy * 0.85);
// rock on steep faces and outcrops, snow held in the ledges
float rock = smoothstep(0.42, 0.62, slope + (n2 - 0.5) * 0.25);
vec3 rockC = mix(vec3(0.34, 0.34, 0.37), vec3(0.5, 0.5, 0.53), n3);
col = mix(col, rockC, clamp(rock, 0.0, 1.0) * (1.0 - step(0.8, n1 * n2 * 2.0) * 0.6));
// glaciers: blue-white ice fields high on the gentler slopes
float gl = smoothstep(900.0, 1300.0, vAWorld.y) * (1.0 - smoothstep(0.25, 0.4, slope)) * smoothstep(0.45, 0.6, aNoise(wp * 0.0012));
col = mix(col, vec3(0.74, 0.86, 0.97), gl * 0.6);
diffuseColor.rgb = col;
aSparkle = (1.0 - rock) * (1.0 - sf.r) * (1.0 - canopy) * (1.0 - ao);`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `float roughnessFactor = mix(roughness, 0.2, aIce);`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
normal = normalize(normal - (viewMatrix * vec4(aBump.x, 0.0, aBump.y, 0.0)).xyz * 0.9);`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
{
  vec3 V = normalize(cameraPosition - vAWorld);
  // snow sparkle: rare glints that follow the view
  vec2 cell = floor(vAWorld.xz * 34.0);
  float h = aHash(cell);
  float spec = pow(max(dot(reflect(-uSunDir, wN), V), 0.0), 4.0);
  float fdist = length(vAWorld - cameraPosition);
  // each glint only flashes from some view angles, like real snow crystals
  float facet = step(0.6, aHash(cell + floor(V.xz * 6.0)));
  float glintLight = spec * 2.2 + dot(aLamp(vAWorld), vec3(0.8));
  totalEmissiveRadiance += vec3(0.95, 0.97, 1.0) * step(0.996, h) * facet * aSparkle * glintLight * (1.0 - smoothstep(4.0, 22.0, fdist));
  // lamp light pooling on the snow
  totalEmissiveRadiance += diffuseColor.rgb * aLamp(vAWorld) * 1.0;
  // alpenglow: the high snow catches the low sun long after the valley has gone blue
  float hi = smoothstep(160.0, 1400.0, vAWorld.y);
  totalEmissiveRadiance += diffuseColor.rgb * uPeakLit * uAlpen * hi * max(dot(wN, uSunDir) + 0.25, 0.0) * 0.85;
}`,
      );
    // after our own helpers, so the fog helpers (aNoise, aHash...) land in front of them
    withFog(sh as unknown as Shader);
  };
  mat.customProgramCacheKey = () => "alpine-terrain-v3";
  return mat;
}

function treeMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  mat.fog = false;
  mat.onBeforeCompile = (sh) => {
    withFog(sh as unknown as Shader);
    sh.fragmentShader = sh.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
{
  vec3 wN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
  float snowy = step(0.8, diffuseColor.r);
  totalEmissiveRadiance += diffuseColor.rgb * uPeakLit * uAlpen * 0.1 * snowy * max(dot(wN, uSunDir), 0.0);
}`,
    );
  };
  mat.customProgramCacheKey = () => "alpine-tree-v1";
  return mat;
}

function basicFog<M extends THREE.MeshBasicMaterial | THREE.MeshStandardMaterial>(
  mat: M,
  key: string,
): M {
  mat.fog = false;
  mat.onBeforeCompile = (sh) => withFog(sh as unknown as Shader);
  mat.customProgramCacheKey = () => key;
  return mat;
}

// ---------------------------------------------------------------------------------------
// sky: gradient, sun glow and alpenglow band, moon, stars and aurora at night

function skyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color() },
      uMid: { value: new THREE.Color() },
      uHor: { value: new THREE.Color() },
      uGlow: { value: new THREE.Color() },
      uSun: U.uSunDir,
      uNight: { value: 0 },
      uAurora: { value: 0 },
      uBlizz: { value: 0 },
      uFogCol: U.uFogCol,
      uTime: U.uTime,
    },
    vertexShader: /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`,
    fragmentShader: /* glsl */ `
varying vec3 vDir;
uniform vec3 uTop;
uniform vec3 uMid;
uniform vec3 uHor;
uniform vec3 uGlow;
uniform vec3 uSun;
uniform float uNight;
uniform float uAurora;
uniform float uBlizz;
uniform vec3 uFogCol;
uniform float uTime;
float h1(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
float n2(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5);
  float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5);
  float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5);
  float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHor, uMid, smoothstep(0.0, 0.22, h));
  col = mix(col, uTop, smoothstep(0.18, 0.85, h));
  col = mix(col, uHor * 0.8, smoothstep(0.0, -0.1, h));
  vec3 sd = normalize(uSun);
  float s = max(dot(d, sd), 0.0);
  float horiz = 1.0 - smoothstep(0.0, 0.35, h);
  float wDusk = 1.0 - smoothstep(0.3, 0.7, uNight);
  float wNight = smoothstep(0.3, 0.7, uNight);
  if (wDusk > 0.0) {
    // the afterglow over the western ridge and the pink belt of Venus opposite it
    col += uGlow * (pow(s, 6.0) * 0.55 + pow(s, 48.0) * 0.6) * horiz * wDusk;
    float anti = max(dot(normalize(d.xz), -normalize(sd.xz)), 0.0);
    col += vec3(0.35, 0.16, 0.22) * anti * exp(-pow((h - 0.1) * 9.0, 2.0)) * 0.6 * wDusk;
  }
  if (wNight > 0.0) {
    vec3 nightAdd = vec3(0.0);
    // moon and its halo
    nightAdd += vec3(0.85, 0.9, 1.0) * smoothstep(0.9993, 0.9996, s) * 1.6;
    nightAdd += uGlow * pow(s, 90.0) * 0.4 + uGlow * pow(s, 8.0) * 0.06;
    // stars, thinning towards the horizon
    vec3 sp = floor(d * 420.0);
    float st = step(0.9982, h1(sp));
    float tw = 0.6 + 0.4 * sin(uTime * 2.0 + h1(sp + 3.0) * 40.0);
    nightAdd += vec3(0.9, 0.93, 1.0) * st * tw * smoothstep(0.02, 0.25, h) * (0.5 + h1(sp + 7.0));
    // milky band
    nightAdd += vec3(0.05, 0.06, 0.09) * n2(d.xz * 9.0) * exp(-pow(dot(d, normalize(vec3(0.6, 0.3, 0.74))) * 3.0, 2.0));
    // aurora curtains low in the northern sky
    if (uAurora > 0.0 && d.z < 0.0) {
      float az = atan(d.x, -d.z);
      float band = 0.28 + 0.07 * sin(az * 2.3 + uTime * 0.05) + 0.04 * n2(vec2(az * 3.0, uTime * 0.03));
      float curtain = exp(-pow((h - band) * 7.0, 2.0)) * smoothstep(0.02, 0.1, h);
      float rays = 0.55 + 0.45 * n2(vec2(az * 28.0, uTime * 0.12));
      float fold = smoothstep(-1.2, -0.2, az) * (1.0 - smoothstep(0.6, 1.4, az));
      vec3 ac = mix(vec3(0.1, 0.9, 0.55), vec3(0.55, 0.25, 0.8), smoothstep(band, band + 0.12, h));
      nightAdd += ac * curtain * rays * fold * uAurora * 0.32;
    }
    col += nightAdd * wNight;
  }
  col = mix(col, uFogCol, uBlizz);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
  });
}

// ---------------------------------------------------------------------------------------
// falling snow (points) and blizzard streaks (lines), both wrapped around the camera

/** soft round camera-facing points, drawn procedurally (no sprite texture, any browser) */
function roundPoints(
  size: number,
  additive: boolean,
  vertexColors: boolean,
  color: string,
  opacity: number,
) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    vertexColors,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: {
      uSize: { value: size },
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
      uPx: { value: 1 },
    },
    vertexShader: /* glsl */ `
uniform float uSize;
uniform float uPx;
varying vec3 vCol;
void main() {
  #ifdef USE_COLOR
  vCol = color;
  #else
  vCol = vec3(1.0);
  #endif
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(96.0, uSize * uPx * 420.0 / max(-mv.z, 0.5));
}`,
    fragmentShader: /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying vec3 vCol;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a = pow(1.0 - d, 1.6);
  gl_FragColor = vec4(uColor * vCol, a * uOpacity);
}`,
  });
}

const SNOW_BOX = 70;
function snowMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    uniforms: {
      ...shelterUniforms(),
      uTime: U.uTime,
      uCam: { value: new THREE.Vector3() },
      uWind: { value: new THREE.Vector3() },
      uCol: { value: new THREE.Color("#ffffff") },
      uBlizz: { value: 0 },
      uTex: { value: glowTexture() },
      uPx: { value: 1 },
      uLightMap: U.uLightMap,
      uLampK: U.uLampK,
      uGround: U.uGround,
    },
    vertexShader: /* glsl */ `
${SHELTER_GLSL}
attribute float aSeed;
uniform float uTime;
uniform vec3 uCam;
uniform vec3 uWind;
uniform float uBlizz;
uniform float uPx;
uniform sampler2D uLightMap;
uniform sampler2D uGround;
uniform float uLampK;
varying float vA;
varying vec3 vLamp;
void main() {
  float B = ${SNOW_BOX}.0;
  vec3 p = position * B;
  float fall = 1.1 + aSeed * 0.9;
  p.y -= uTime * fall;
  p.xz += uWind.xz * uTime * (0.6 + aSeed * 0.8);
  p.x += sin(uTime * 0.8 + aSeed * 40.0) * 0.7 * (1.0 - uBlizz);
  p.z += cos(uTime * 0.6 + aSeed * 23.0) * 0.7 * (1.0 - uBlizz);
  p = mod(p - uCam + B * 0.5, B) + uCam - B * 0.5;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = -mv.z;
  // real flakes are ~5-15 mm: a few pixels at most, never a big square near the lens
  gl_PointSize = clamp(uPx * (0.012 + aSeed * 0.014) * 900.0 / max(dist, 0.5), 1.0, 4.5 * uPx);
  vLamp = vec3(0.0);
  if (abs(p.x) < 399.0 && abs(p.z) < 399.0) {
    float gy = texture2D(uGround, vec2((p.z + 400.0) / 800.0, (p.x + 400.0) / 800.0)).r;
    vLamp = texture2D(uLightMap, (p.xz + 400.0) / 800.0).rgb * uLampK * 2.4 * (1.0 - smoothstep(2.0, 9.0, p.y - gy));
  }
  float keep = step(aSeed, 0.35 + uBlizz * 0.65);
  vA = outsideShelter(p) * keep * smoothstep(1.2, 3.5, dist) * (1.0 - smoothstep(B * 0.3, B * 0.5, dist));
}`,
    fragmentShader: /* glsl */ `
uniform sampler2D uTex;
uniform vec3 uCol;
varying float vA;
varying vec3 vLamp;
void main() {
  if (vA < 0.01) discard;
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a = 1.0 - d * d;
  gl_FragColor = vec4(uCol + vLamp, a * vA * 0.9);
}`,
  });
}
function streakMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    uniforms: {
      ...shelterUniforms(),
      uTime: U.uTime,
      uCam: { value: new THREE.Vector3() },
      uWind: { value: new THREE.Vector3() },
      uCol: { value: new THREE.Color("#ffffff") },
      uBlizz: { value: 0 },
    },
    vertexShader: /* glsl */ `
${SHELTER_GLSL}
attribute float aSeed;
attribute float aEnd;
uniform float uTime;
uniform vec3 uCam;
uniform vec3 uWind;
uniform float uBlizz;
varying float vA;
void main() {
  float B = 40.0;
  vec3 vel = vec3(uWind.x * 6.0, -3.0, uWind.z * 6.0) * (0.7 + aSeed * 0.6);
  vec3 p = position * B + vel * uTime;
  p = mod(p - uCam + B * 0.5, B) + uCam - B * 0.5;
  p -= vel * aEnd * 0.03;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = -mv.z;
  vA = outsideShelter(p) * uBlizz * smoothstep(4.0, 8.0, dist) * (1.0 - smoothstep(14.0, 24.0, dist)) * (1.0 - aEnd * 0.7);
}`,
    fragmentShader: /* glsl */ `
uniform vec3 uCol;
varying float vA;
void main() { gl_FragColor = vec4(uCol, vA * 0.3); }`,
  });
}

// ---------------------------------------------------------------------------------------
// the chairlift path: up the west cable, round the top bullwheel, down the east cable

function chairGeo() {
  const g = new Geo();
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, col: string) => {
    g.mat(0, 0, 0).col(col);
    g.box(x, y, z, w, h, d, true);
  };
  box(0, -2.4, 0, 0.08, 2.4, 0.08, "#8a8e96"); // hanger
  box(0, -0.12, 0, 0.35, 0.24, 0.5, "#40444c"); // grip
  box(0, -2.45, 0, 2.4, 0.12, 0.1, "#8a8e96");
  box(0, -2.6, 0.05, 2.3, 0.1, 0.62, "#2a5ad6"); // seat
  box(0, -2.5, 0.38, 2.3, 0.62, 0.08, "#2a5ad6"); // back
  box(0, -2.52, 0.03, 2.25, 0.08, 0.56, "#f3f6fb"); // snow on the seat
  box(0, -2.05, -0.55, 2.3, 0.05, 0.05, "#8a8e96"); // safety bar
  box(0, -3.05, -0.45, 1.8, 0.04, 0.3, "#8a8e96"); // footrest
  const b = new THREE.BufferGeometry();
  const src = g.build("uv");
  b.setAttribute("position", src.getAttribute("position"));
  b.setAttribute("normal", src.getAttribute("normal"));
  b.setAttribute("color", src.getAttribute("color"));
  b.computeBoundingSphere();
  return b;
}

// ---------------------------------------------------------------------------------------

type Built = {
  chunks: {
    x0: number;
    z0: number;
    x1: number;
    z1: number;
    main: THREE.BufferGeometry | null;
    detail: THREE.BufferGeometry | null;
    glow: THREE.BufferGeometry | null;
    signs: THREE.BufferGeometry | null;
    pools: THREE.BufferGeometry | null;
  }[];
  terrain: ReturnType<typeof playTerrain>;
  outer: THREE.BufferGeometry;
  /** every tree's instance matrix and tint; split into near / mid LOD at run time */
  trees: { n: number; mats: Float32Array; cols: Float32Array; x: Float32Array; z: Float32Array };
  far: THREE.Matrix4[];
  smoke: [number, number, number][];
  lamps: [number, number, number, number][];
  surf: THREE.DataTexture;
  ao: THREE.DataTexture;
  light: THREE.CanvasTexture;
  ground: THREE.DataTexture;
  forest: THREE.DataTexture;
  stats: { verts: number; trees: number; far: number };
};

function build(layout: AlpineLayout): Built {
  const a = layout.alpine;
  const half = layout.half;
  const nc = Math.ceil((half * 2) / CHUNK);
  const kits: Kit[] = [];
  for (let i = 0; i < nc * nc; i++)
    kits.push({
      main: new Geo(),
      detail: new Geo(),
      glow: new Geo(),
      signs: new Geo(),
      pools: new Geo(),
      lights: [],
      smoke: [],
      lamps: [],
    });
  const kitAt = (x: number, z: number) => {
    const i = Math.max(0, Math.min(nc - 1, Math.floor((x + half) / CHUNK)));
    const j = Math.max(0, Math.min(nc - 1, Math.floor((z + half) / CHUNK)));
    return kits[i * nc + j]!;
  };
  buildInto(kitAt, a, terrainY);
  // unlit glow boxes share the sign material: point their uvs at the atlas's white texel
  for (const k of kits) {
    const gb = k.glow.buf;
    for (let v2 = 0; v2 < k.glow.n; v2++) {
      gb[v2 * 14 + 9] = WHITE_UV[0];
      gb[v2 * 14 + 10] = WHITE_UV[1];
    }
    if (k.glow.n) k.signs.stamp(k.glow.freeze(), 0, 0, 0);
    k.glow.n = 0;
  }
  let verts = 0;
  const chunks: Built["chunks"] = kits.map((k, idx) => {
    const i = Math.floor(idx / nc);
    const j = idx % nc;
    const mk = (g: Geo, uv = "aUv2") => {
      if (g.n === 0) return null;
      verts += g.n;
      return g.build(uv);
    };
    return {
      x0: -half + i * CHUNK,
      z0: -half + j * CHUNK,
      x1: -half + (i + 1) * CHUNK,
      z1: -half + (j + 1) * CHUNK,
      main: mk(k.main),
      detail: mk(k.detail),
      glow: mk(k.glow),
      signs: mk(k.signs, "uv"),
      pools: mk(k.pools, "uv"),
    };
  });
  // trees: matrices and tints, bucketed by distance every few metres of travel
  const n = a.trees.length;
  const trees: Built["trees"] = {
    n,
    mats: new Float32Array(n * 16),
    cols: new Float32Array(n * 3),
    x: new Float32Array(n),
    z: new Float32Array(n),
  };
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  const r = mulberry(4711);
  const c = new THREE.Color();
  a.trees.forEach((t, k) => {
    e.set((r() - 0.5) * 0.06, t.rot, (r() - 0.5) * 0.06);
    const wk = (t.w / 0.3) * (t.k === 1 ? 0.72 : 1);
    m4.compose(v.set(t.x, t.y - 0.3, t.z), q.setFromEuler(e), s.set(t.h * wk, t.h, t.h * wk));
    m4.toArray(trees.mats, k * 16);
    c.setHSL(0.36 + (r() - 0.5) * 0.06, 0.1 + r() * 0.15, 0.85 + r() * 0.3);
    trees.cols.set([c.r, c.g, c.b], k * 3);
    trees.x[k] = t.x;
    trees.z[k] = t.z;
  });
  const ft = farTrees(half, 820);
  const far: THREE.Matrix4[] = [];
  for (let k = 0; k < ft.length; k += 5) {
    e.set(0, ft[k + 4]!, 0);
    const h = ft[k + 3]!;
    m4.compose(v.set(ft[k]!, ft[k + 1]! - 0.3, ft[k + 2]!), q.setFromEuler(e), s.set(h, h, h));
    far.push(m4.clone());
  }
  const smoke: Built["smoke"] = [];
  const lamps: Built["lamps"] = [];
  const lights: Kit["lights"] = [];
  for (const k of kits) {
    smoke.push(...k.smoke);
    lamps.push(...k.lamps);
    lights.push(...k.lights);
  }
  return {
    chunks,
    terrain: playTerrain(a),
    outer: outerTerrain(half),
    trees,
    far,
    smoke,
    lamps,
    surf: surfTexture(a),
    ao: aoTexture(a),
    light: lightMap(lights, half),
    ground: groundTexture(withPlatforms(a), a.terrain.n + 1),
    forest: forestTexture(),
    stats: { verts, trees: a.trees.length, far: far.length },
  };
}

// ---------------------------------------------------------------------------------------

export const AlpineScene = memo(function AlpineScene({
  layout,
  isHost,
  playing,
}: {
  layout: AlpineLayout;
  /** legacy: the time of day now comes from timeOfDay.ts */
  time?: TimeOfDay;
  isHost: boolean;
  playing: boolean;
}) {
  // the time of day in 1/64 steps (the match runs from sunset into night)
  const nk = useTodK();
  const nl = (n: number, s: number) => s + (n - s) * nk;
  const { scene, camera } = useThree();
  const built = useMemo(() => {
    const t0 = performance.now();
    const b = build(layout);
    console.info(
      `[alpine] built ${b.chunks.length} chunks, ${b.stats.verts} verts, ${b.stats.trees} trees + ${b.stats.far} far in ${Math.round(performance.now() - t0)} ms`,
    );
    return b;
  }, [layout]);
  const look: AlpineLook = alpineLookAt(nk);
  U.uLightMap.value = built.light;
  U.uGround.value = built.ground;
  useEffect(() => {
    // test handle (?debug=1): the shared weather / lift clock
    if (new URLSearchParams(window.location.search).get("debug") === "1")
      Object.assign(window as unknown as Record<string, unknown>, {
        __alpine: alpine,
        __ride: ride,
      });
  }, []);

  const mats = useMemo(
    () => ({
      facade: facadeMaterial(),
      signs: basicFog(
        new THREE.MeshBasicMaterial({ vertexColors: true, map: signTexture(), toneMapped: false }),
        "alpine-signs",
      ),
      pools: new THREE.MeshBasicMaterial({
        vertexColors: true,
        map: glowTexture(),
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        fog: false,
      }),
      terrain: terrainMaterial(built.surf, built.forest, built.ao),
      tree: treeMaterial(),
      sky: skyMaterial(),
      snow: snowMaterial(),
      streak: streakMaterial(),
      chair: basicFog(
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }),
        "alpine-chair",
      ),
      halo: roundPoints(3, true, true, "#ffffff", 0.85),
      smoke: roundPoints(2.6, false, false, "#dfe2ea", 0.2),
    }),
    [built],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  useEffect(
    () => () => {
      for (const c of built.chunks)
        [c.main, c.detail, c.glow, c.signs, c.pools].forEach((g) => g?.dispose());
      for (const t of built.terrain) t.geo.dispose();
      built.outer.dispose();
      built.surf.dispose();
      built.ao.dispose();
      built.light.dispose();
      built.ground.dispose();
      built.forest.dispose();
    },
    [built],
  );

  const geos = useMemo(() => {
    const snowN = 12000;
    const sp = new Float32Array(snowN * 3);
    const ss = new Float32Array(snowN);
    const r = mulberry(99);
    for (let i = 0; i < snowN; i++) {
      sp[i * 3] = r();
      sp[i * 3 + 1] = r();
      sp[i * 3 + 2] = r();
      ss[i] = r();
    }
    const snow = new THREE.BufferGeometry();
    snow.setAttribute("position", new THREE.BufferAttribute(sp, 3));
    snow.setAttribute("aSeed", new THREE.BufferAttribute(ss, 1));
    snow.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const stN = 2600;
    const lp = new Float32Array(stN * 2 * 3);
    const ls = new Float32Array(stN * 2);
    const le = new Float32Array(stN * 2);
    for (let i = 0; i < stN; i++) {
      const x = r();
      const y = r();
      const z = r();
      const sd = r();
      for (let k = 0; k < 2; k++) {
        lp[(i * 2 + k) * 3] = x;
        lp[(i * 2 + k) * 3 + 1] = y;
        lp[(i * 2 + k) * 3 + 2] = z;
        ls[i * 2 + k] = sd;
        le[i * 2 + k] = k;
      }
    }
    const streak = new THREE.BufferGeometry();
    streak.setAttribute("position", new THREE.BufferAttribute(lp, 3));
    streak.setAttribute("aSeed", new THREE.BufferAttribute(ls, 1));
    streak.setAttribute("aEnd", new THREE.BufferAttribute(le, 1));
    streak.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    // lamp halos
    const hp = new Float32Array(built.lamps.length * 3);
    const hc = new Float32Array(built.lamps.length * 3);
    const col = new THREE.Color();
    built.lamps.forEach((l, i) => {
      hp.set([l[0], l[1], l[2]], i * 3);
      col.set(l[3] === 1 ? "#cfdcff" : l[3] === 2 ? "#ffb070" : "#ffc27a");
      hc.set([col.r, col.g, col.b], i * 3);
    });
    const halo = new THREE.BufferGeometry();
    halo.setAttribute("position", new THREE.BufferAttribute(hp, 3));
    halo.setAttribute("color", new THREE.BufferAttribute(hc, 3));
    halo.computeBoundingSphere();
    // chimney smoke: 8 puffs per chimney, animated on the CPU
    const smokeP = new Float32Array(built.smoke.length * 8 * 3);
    const smoke = new THREE.BufferGeometry();
    smoke.setAttribute("position", new THREE.BufferAttribute(smokeP, 3));
    smoke.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return {
      snow,
      streak,
      halo,
      smoke,
      sky: new THREE.SphereGeometry(9000, 32, 16),
      spruce: spruceGeo(false),
      farSpruce: farSpruceGeo(),
      chair: chairGeo(),
    };
  }, [built]);
  useEffect(() => () => Object.values(geos).forEach((g) => g.dispose()), [geos]);

  // instanced forest per chunk (near + far LOD) and the far ring
  // The near / mid forest meshes are built here, each with its own instance-colour buffer,
  // and handed to the scene as objects. (Declared in JSX with a child <instancedBufferAttribute>,
  // a world rebuild - solo to co-op on the host - left the recreated mesh drawing a colour
  // buffer the LOD never filled: every near spruce rendered black.)
  const lodAt = useRef({ x: 1e9, z: 1e9 });
  const forest = useMemo(() => {
    const near = new THREE.InstancedMesh(geos.spruce, mats.tree, MAX_NEAR);
    near.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_NEAR * 3), 3);
    near.castShadow = true;
    near.frustumCulled = false;
    near.count = 0;
    const mid = new THREE.InstancedMesh(geos.farSpruce, mats.tree, Math.max(1, built.trees.n));
    mid.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(Math.max(1, built.trees.n) * 3),
      3,
    );
    mid.frustumCulled = false;
    mid.count = 0;
    return { near, mid };
  }, [geos, mats, built]);
  useEffect(
    () => () => {
      forest.near.dispose();
      forest.mid.dispose();
    },
    [forest],
  );
  const nearRef = useRef<THREE.InstancedMesh | null>(null);
  const midRef = useRef<THREE.InstancedMesh | null>(null);
  nearRef.current = forest.near;
  midRef.current = forest.mid;
  useLayoutEffect(() => {
    lodAt.current = { x: 1e9, z: 1e9 }; // re-sort into the fresh meshes
  }, [forest]);
  const farRef = useRef<THREE.InstancedMesh>(null);
  const chairRef = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    lodAt.current = { x: 1e9, z: 1e9 };
    const f = farRef.current;
    if (f) {
      built.far.forEach((m, k) => f.setMatrixAt(k, m));
      f.instanceMatrix.needsUpdate = true;
      f.computeBoundingSphere();
    }
  }, [built]);

  const lift = layout.alpine.lift;
  const nChairs = chairCount(lift);

  // time of day: sky colours, light tints, window glow
  const skyRef = useRef<THREE.Mesh>(null);
  const haloBase = useRef(0.6);
  useEffect(() => {
    const m = mats.sky;
    (m.uniforms["uTop"]!.value as THREE.Color).set(look.skyTop);
    (m.uniforms["uMid"]!.value as THREE.Color).set(look.skyMid);
    (m.uniforms["uHor"]!.value as THREE.Color).set(look.skyHorizon);
    (m.uniforms["uGlow"]!.value as THREE.Color).set(look.sunGlow);
    m.uniforms["uNight"]!.value = nk;
    m.uniforms["uAurora"]!.value = look.aurora;
    U.uSunDir.value.set(...look.sunDir).normalize();
    U.uPeakLit.value.set(look.peakLit);
    U.uAlpen.value = nl(0.18, 1);
    U.uWin.value = look.windows;
    U.uHaze.value.set(look.haze);
    U.uMistCol.value.set(look.haze);
    U.uHazeDist.value = nl(5200, 7000);
    U.uHazeMax.value = nl(0.9, 0.8);
    mats.signs.color.setScalar(nl(1.25, 0.95));
    U.uLampK.value = nl(0.85, 0.2);
    U.uBounce.value.set("#8a8fbc").lerp(new THREE.Color("#5a6ca8"), nk);
    haloBase.current = nl(0.85, 0.35);
    (mats.snow.uniforms["uCol"]!.value as THREE.Color).set(look.snow);
    (mats.streak.uniforms["uCol"]!.value as THREE.Color).set(look.snow);
    (mats.smoke.uniforms["uColor"]!.value as THREE.Color)
      .set("#e8d6dc")
      .lerp(new THREE.Color("#7a849c"), nk);
    const prev = scene.background;
    scene.background = new THREE.Color(look.skyHorizon);
    return () => {
      scene.background = prev;
    };
  }, [nk, look, mats, scene]); // eslint-disable-line react-hooks/exhaustive-deps -- nl reads nk

  const detailRefs = useRef<(THREE.Mesh | null)[]>([]);
  const lodTick = useRef(0);
  const [px] = useState(() =>
    typeof window !== "undefined" ? Math.min(2, window.devicePixelRatio || 1) : 1,
  );
  const skyCol = useMemo(() => new THREE.Color(), []);
  const blizCol = useMemo(() => new THREE.Color(), []);
  const m4 = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const ax = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const sc = useMemo(() => new THREE.Vector3(1, 1, 1), []);
  const pv = useMemo(() => new THREE.Vector3(), []);

  useFrame((state, raw) => {
    const dt = Math.min(raw, 0.05);
    const cam = state.camera.position;
    tickAlpine(dt, isHost, playing);
    U.uTime.value = state.clock.elapsedTime;
    const b = alpine.blizzard;
    // blizzard: visibility closes to ~20 m, everything washes to the storm colour
    blizCol.set(look.blizzard);
    U.uFogCol.value.copy(blizCol);
    const bb = b * b * (3 - 2 * b);
    U.uFogNear.value = bb > 0.001 ? THREE.MathUtils.lerp(900, 1.5, Math.pow(bb, 0.35)) : 1e5;
    U.uFogFar.value = bb > 0.001 ? THREE.MathUtils.lerp(2600, 24, Math.pow(bb, 0.35)) : 2e5;
    U.uMist.value.set(nl(260, 380), nl(1800, 2600));
    mats.sky.uniforms["uBlizz"]!.value = Math.min(1, bb * 1.15);
    mats.halo.uniforms["uOpacity"]!.value = haloBase.current * (1 - 0.85 * bb); // lamps sink into a whiteout
    const f = scene.fog as THREE.Fog | null;
    if (f && "near" in f) {
      skyCol.set(look.fogColor);
      f.color.copy(skyCol).lerp(blizCol, bb);
      f.near = THREE.MathUtils.lerp(look.fog[0], 1.5, Math.pow(bb, 0.35));
      f.far = THREE.MathUtils.lerp(look.fog[1], 24, Math.pow(bb, 0.35));
    }
    toScreen(U.uHaze.value, U.uHazeOut.value, state.gl.toneMappingExposure);
    toScreen(U.uMistCol.value, U.uMistOut.value, state.gl.toneMappingExposure);
    toScreen(U.uFogCol.value, U.uFogOut.value, state.gl.toneMappingExposure);
    const sky = skyRef.current;
    if (sky) sky.position.copy(cam);
    // snow
    for (const m of [mats.snow, mats.streak]) {
      (m.uniforms["uCam"]!.value as THREE.Vector3).copy(cam);
      (m.uniforms["uWind"]!.value as THREE.Vector3).set(
        Math.sin(alpine.windDir) * (0.4 + b * 5),
        0,
        Math.cos(alpine.windDir) * (0.4 + b * 5),
      );
      m.uniforms["uBlizz"]!.value = b;
    }
    mats.snow.uniforms["uPx"]!.value = px * (state.size.height / 900);
    // chairs ride the cable on the shared clock
    const ch = chairRef.current;
    if (ch) {
      for (let i = 0; i < nChairs; i++) {
        const p = chairAt(lift, i);
        q.setFromAxisAngle(ax, p.yaw);
        // (you sit on the left-hand seat, so your own chair shows under you)
        m4.compose(pv.set(p.x, p.y, p.z), q, sc);
        ch.setMatrixAt(i, m4);
      }
      ch.instanceMatrix.needsUpdate = true;
    }
    // chimney smoke drifting downwind
    const sp = geos.smoke.getAttribute("position") as THREE.BufferAttribute;
    const arr = sp.array as Float32Array;
    const t = state.clock.elapsedTime;
    const wx = Math.sin(alpine.windDir) * (0.6 + b * 6);
    const wz = Math.cos(alpine.windDir) * (0.6 + b * 6);
    for (let c = 0; c < built.smoke.length; c++) {
      const s = built.smoke[c]!;
      const near = Math.abs(s[0] - cam.x) < 500 && Math.abs(s[2] - cam.z) < 500;
      for (let k = 0; k < 8; k++) {
        const o = (c * 8 + k) * 3;
        if (!near) {
          arr[o + 1] = -1e4;
          continue;
        }
        const age = (t * 0.25 + k / 8 + c * 0.137) % 1;
        arr[o] = s[0] + wx * age * 3 + Math.sin(age * 6 + c) * 0.4;
        arr[o + 1] = s[1] + age * 7;
        arr[o + 2] = s[2] + wz * age * 3;
      }
    }
    sp.needsUpdate = true;
    // forest LOD: detailed spruce near the player, simple cones beyond (re-sorted every 8 m)
    const nm = nearRef.current;
    const mm = midRef.current;
    if (nm && mm && Math.hypot(cam.x - lodAt.current.x, cam.z - lodAt.current.z) > 8) {
      lodAt.current = { x: cam.x, z: cam.z };
      const T2 = built.trees;
      const na = nm.instanceMatrix.array as Float32Array;
      const ma = mm.instanceMatrix.array as Float32Array;
      const nc = nm.instanceColor!.array as Float32Array;
      const mc = mm.instanceColor!.array as Float32Array;
      let ni = 0;
      let mi = 0;
      const R2 = TREE_NEAR * TREE_NEAR;
      for (let k = 0; k < T2.n; k++) {
        const dx = T2.x[k]! - cam.x;
        const dz = T2.z[k]! - cam.z;
        if (dx * dx + dz * dz < R2 && ni < MAX_NEAR) {
          na.set(T2.mats.subarray(k * 16, k * 16 + 16), ni * 16);
          nc.set(T2.cols.subarray(k * 3, k * 3 + 3), ni * 3);
          ni++;
        } else {
          ma.set(T2.mats.subarray(k * 16, k * 16 + 16), mi * 16);
          mc.set(T2.cols.subarray(k * 3, k * 3 + 3), mi * 3);
          mi++;
        }
      }
      nm.count = ni;
      mm.count = mi;
      nm.instanceMatrix.needsUpdate = true;
      mm.instanceMatrix.needsUpdate = true;
      nm.instanceColor!.needsUpdate = true;
      mm.instanceColor!.needsUpdate = true;
    }
    // distance LOD a few times a second
    lodTick.current -= 1;
    if (lodTick.current <= 0) {
      lodTick.current = 8;
      built.chunks.forEach((c, i) => {
        const d = Math.hypot(
          Math.max(c.x0 - cam.x, 0, cam.x - c.x1),
          Math.max(c.z0 - cam.z, 0, cam.z - c.z1),
        );
        const det = detailRefs.current[i];
        if (det) det.visible = d < DETAIL_RANGE;
      });
    }
  });

  return (
    <group>
      <mesh
        ref={skyRef}
        geometry={geos.sky}
        material={mats.sky}
        renderOrder={-10}
        frustumCulled={false}
      />
      {built.terrain.map((t, i) => (
        <mesh key={`t${i}`} geometry={t.geo} material={mats.terrain} receiveShadow />
      ))}
      <mesh geometry={built.outer} material={mats.terrain} />
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
            />
          )}
          {c.signs && <mesh geometry={c.signs} material={mats.signs} />}
        </group>
      ))}
      <primitive object={forest.near} />
      <primitive object={forest.mid} />
      {built.far.length > 0 && (
        <instancedMesh ref={farRef} args={[geos.farSpruce, mats.tree, built.far.length]} />
      )}
      <instancedMesh
        ref={chairRef}
        args={[geos.chair, mats.chair, nChairs]}
        castShadow
        frustumCulled={false}
      />
      <points geometry={geos.halo} material={mats.halo} renderOrder={3} />
      <points geometry={geos.smoke} material={mats.smoke} renderOrder={3} frustumCulled={false} />
      <points geometry={geos.snow} material={mats.snow} renderOrder={4} frustumCulled={false} />
      <lineSegments
        geometry={geos.streak}
        material={mats.streak}
        renderOrder={4}
        frustumCulled={false}
      />
    </group>
  );
});

// ---------------------------------------------------------------------------------------

const SUN_RANGE = 90;
const SUN_MAP = 2048;
const SUN_DIST = 700;

/** Low sun (or moon) whose shadow frustum follows the player; its shadow follows the quality tier. */
export function AlpineSun(_props: { time?: TimeOfDay }) {
  const ref = useRef<THREE.DirectionalLight>(null);
  const shadow = useSunShadow(ref, SUN_MAP);
  useFrame((state, raw) => {
    // the blended sun (sinking at dusk) or moon for the current time of day
    const dir = liveLook.sunDir;
    const l = ref.current;
    if (!l) return;
    const texel = (SUN_RANGE * 2) / shadow.size;
    const cx = Math.round(state.camera.position.x / texel) * texel;
    const cz = Math.round(state.camera.position.z / texel) * texel;
    const cy = state.camera.position.y;
    l.target.position.set(cx, cy, cz);
    l.target.updateMatrixWorld();
    l.position.set(cx + dir.x * SUN_DIST, cy + dir.y * SUN_DIST, cz + dir.z * SUN_DIST);
    // the blizzard dims the sun
    l.color.copy(liveLook.sunColor);
    l.intensity = liveLook.sunI * (1 - alpine.blizzard * 0.75);
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
