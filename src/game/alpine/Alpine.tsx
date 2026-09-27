// Renders Whiteout Pass: the heightfield terrain and the endless land beyond, merged
// chunks of chalets and props (one texture-array material), the instanced spruce forest,
// the running chairlift, a painted sky with alpenglow / stars / aurora, falling snow,
// chimney smoke and lamp halos, and the blizzard that closes it all down to ~20 m.
import { useFrame, useThree } from "@react-three/fiber";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { Geo } from "../cityGeo";
import { groundY } from "../terrain";
import { buildInto, cableY, type Kit } from "./build";
import { farSpruceGeo, spruceGeo } from "./forest";
import type { AlpineLayout, Lift } from "./layout";
import { alpineLook, type AlpineLook } from "./look";
import { mulberry } from "./noise";
import { alpineArray, glowTexture, signTexture, T } from "./textures";
import {
  FOREST_EXTENT,
  farTrees,
  forestTexture,
  outerTerrain,
  playTerrain,
  surfTexture,
} from "./terrainMesh";
import { alpine, tickAlpine } from "./weather";

const CHUNK = 200;
const DETAIL_RANGE = 280;
const TREE_NEAR = 240;

// ---------------------------------------------------------------------------------------
// shared uniforms: every alpine material reads the same atmosphere

const U = {
  uHaze: { value: new THREE.Color("#c9a3b4") },
  uHazeDist: { value: 7000 },
  uHazeMax: { value: 0.82 },
  uMistCol: { value: new THREE.Color("#c9a3b4") },
  uMist: { value: new THREE.Vector2(400, 2600) },
  uFogCol: { value: new THREE.Color("#b9bfd4") },
  uFogNear: { value: 1e5 },
  uFogFar: { value: 2e5 },
  uSunDir: { value: new THREE.Vector3(-0.8, 0.2, -0.5).normalize() },
  uPeakLit: { value: new THREE.Color("#ff9e84") },
  uAlpen: { value: 1 },
  uWin: { value: 0.6 },
  uTime: { value: 0 },
};

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
uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uSunDir;
uniform vec3 uPeakLit;
uniform float uAlpen;
uniform float uWin;
uniform float uTime;
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
  float fd = length(vAWorld - cameraPosition);
  float aerial = (1.0 - exp(-fd / uHazeDist)) * uHazeMax;
  // aerial perspective is stronger low in the valley, thinner up on the peaks
  aerial *= mix(1.0, 0.7, smoothstep(300.0, 2500.0, vAWorld.y));
  float mist = smoothstep(uMist.x, uMist.y, fd) * 0.35 * (1.0 - smoothstep(150.0, 900.0, vAWorld.y));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uMistCol, mist);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze, aerial);
  float bl = smoothstep(uFogNear, uFogFar, fd);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogCol, bl);
}
`;

type Shader = { vertexShader: string; fragmentShader: string; uniforms: Record<string, { value: unknown }> };
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
      .replace("#include <common>", "#include <common>\nattribute vec2 aUv2;\nattribute vec3 aFac;\nvarying vec2 vFuv;\nvarying vec3 vFac;")
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
if (aWin && aMask > 0.3) {
  float h = aHash(vec2(vFac.y * 977.0, aLayer));
  float lit = step(h, uWin * 0.88);
  vec3 warm = mix(vec3(1.0, 0.62, 0.3), vec3(1.0, 0.8, 0.52), fract(h * 13.7));
  // a little depth: brighter low in the pane, curtain shadow at the top
  float grad = mix(1.15, 0.7, fract(vFuv.y));
  totalEmissiveRadiance += warm * lit * aMask * 1.6 * grad;
}
if (aLayer == ${T.snow}.0) {
  vec3 V = normalize(cameraPosition - vAWorld);
  vec3 wN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
  float g = pow(max(dot(reflect(-uSunDir, wN), V), 0.0), 12.0);
  totalEmissiveRadiance += vec3(0.9, 0.95, 1.0) * aMask * (0.25 + g * 2.0);
  totalEmissiveRadiance += diffuseColor.rgb * uPeakLit * uAlpen * 0.12 * max(dot(wN, uSunDir), 0.0);
}`,
      );
  };
  mat.customProgramCacheKey = () => "alpine-facade-v1";
  return mat;
}

/** the snow itself: packed paths, groomed pistes, ice, rock, forest floor, far forest */
function terrainMaterial(surf: THREE.Texture, forest: THREE.Texture) {
  const mat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.9, metalness: 0 });
  mat.fog = false;
  mat.onBeforeCompile = (sh) => {
    withFog(sh as unknown as Shader);
    sh.uniforms["uSurf"] = { value: surf };
    sh.uniforms["uForest"] = { value: forest };
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\nuniform sampler2D uSurf;\nuniform sampler2D uForest;\nfloat aSparkle;\nfloat aIce;`)
      .replace(
        "#include <map_fragment>",
        `vec3 wN = normalize((vec4(normalize(vNormal), 0.0) * viewMatrix).xyz);
vec2 wp = vAWorld.xz;
bool inPlay = abs(wp.x) < 399.0 && abs(wp.y) < 399.0;
vec4 sf = inPlay ? texture2D(uSurf, (wp + 400.0) / 800.0) : vec4(0.0);
float farForest = inPlay ? 0.0 : texture2D(uForest, (wp + ${FOREST_EXTENT}.0) / ${FOREST_EXTENT * 2}.0).r;
float n1 = aNoise(wp * 0.05);
float n2 = aNoise(wp * 0.6);
float n3 = aNoise(wp * 3.1);
float slope = 1.0 - wN.y;
// fresh snow: blue-white with soft wind-sculpted variation
vec3 col = mix(vec3(0.9, 0.93, 0.98), vec3(0.97, 0.98, 1.0), n1);
col *= 0.96 + 0.05 * n2;
// packed snow on streets and plazas: warmer, trodden, cobbles peeking through
vec3 packed = mix(vec3(0.74, 0.73, 0.74), vec3(0.86, 0.85, 0.86), n3);
packed = mix(packed, vec3(0.52, 0.48, 0.46), step(0.78, aNoise(wp * 1.7)) * 0.5);
col = mix(col, packed, sf.r * 0.85);
// ploughed road: darker, grit
col = mix(col, vec3(0.55, 0.55, 0.58) * (0.9 + 0.2 * n3), sf.b < 0.2 ? smoothstep(0.1, 0.2, sf.b) * 0.8 : 0.0);
// groomed piste: smooth and bright with faint corduroy
float cord = 0.97 + 0.03 * sin((wp.x + wp.y) * 9.0);
col = mix(col, vec3(0.96, 0.97, 1.0) * cord, sf.g * 0.7);
// ice: lake, creek, rink
aIce = smoothstep(0.6, 0.9, sf.b);
vec3 ice = mix(vec3(0.55, 0.68, 0.8), vec3(0.72, 0.84, 0.92), aNoise(wp * 0.35));
ice = mix(ice, vec3(0.93, 0.96, 1.0), smoothstep(0.55, 0.8, aNoise(wp * 0.9 + 3.0)) * 0.7);
col = mix(col, ice, aIce);
// forest floor: shaded snow with needle litter
col = mix(col, vec3(0.74, 0.78, 0.82) * (0.9 + 0.15 * n3), sf.a * 0.45);
// far forest seen from above: dark canopy flecked with snow
float canopy = smoothstep(0.15, 0.7, farForest) * (0.55 + 0.45 * aNoise(wp * 0.08));
col = mix(col, mix(vec3(0.13, 0.18, 0.17), vec3(0.7, 0.75, 0.8), step(0.72, n2) * 0.6), canopy * 0.85);
// rock on steep faces and outcrops, snow held in the ledges
float rock = smoothstep(0.42, 0.62, slope + (n2 - 0.5) * 0.25) + smoothstep(0.3, 0.4, sf.b) * (1.0 - aIce);
vec3 rockC = mix(vec3(0.34, 0.34, 0.37), vec3(0.5, 0.5, 0.53), n3);
col = mix(col, rockC, clamp(rock, 0.0, 1.0) * (1.0 - step(0.8, n1 * n2 * 2.0) * 0.6));
// glaciers: blue-white ice fields high on the gentler slopes
float gl = smoothstep(900.0, 1300.0, vAWorld.y) * (1.0 - smoothstep(0.25, 0.4, slope)) * smoothstep(0.45, 0.6, aNoise(wp * 0.0012));
col = mix(col, vec3(0.74, 0.86, 0.97), gl * 0.6);
diffuseColor.rgb = col;
aSparkle = (1.0 - rock) * (1.0 - sf.r) * (1.0 - canopy);`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `float roughnessFactor = mix(roughness, 0.2, aIce);`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
{
  vec3 V = normalize(cameraPosition - vAWorld);
  // snow sparkle: rare glints that follow the view
  vec2 cell = floor(vAWorld.xz * 14.0);
  float h = aHash(cell);
  float spec = pow(max(dot(reflect(-uSunDir, wN), V), 0.0), 6.0);
  float fdist = length(vAWorld - cameraPosition);
  totalEmissiveRadiance += vec3(0.95, 0.97, 1.0) * step(0.985, h) * aSparkle * (0.35 + spec * 2.5) * (1.0 - smoothstep(20.0, 70.0, fdist));
  // alpenglow: the high snow catches the low sun long after the valley has gone blue
  float hi = smoothstep(160.0, 1400.0, vAWorld.y);
  totalEmissiveRadiance += diffuseColor.rgb * uPeakLit * uAlpen * hi * max(dot(wN, uSunDir) + 0.25, 0.0) * 0.85;
}`,
      );
  };
  mat.customProgramCacheKey = () => "alpine-terrain-v1";
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

function basicFog<M extends THREE.MeshBasicMaterial | THREE.MeshStandardMaterial>(mat: M, key: string): M {
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
  if (uNight < 0.5) {
    // the afterglow over the western ridge and the pink belt of Venus opposite it
    col += uGlow * (pow(s, 6.0) * 0.55 + pow(s, 48.0) * 0.6) * horiz;
    float anti = max(dot(normalize(d.xz), -normalize(sd.xz)), 0.0);
    col += vec3(0.35, 0.16, 0.22) * anti * exp(-pow((h - 0.1) * 9.0, 2.0)) * 0.6;
  } else {
    // moon and its halo
    col += vec3(0.85, 0.9, 1.0) * smoothstep(0.9993, 0.9996, s) * 1.6;
    col += uGlow * pow(s, 90.0) * 0.4 + uGlow * pow(s, 8.0) * 0.06;
    // stars, thinning towards the horizon
    vec3 sp = floor(d * 420.0);
    float st = step(0.9982, h1(sp));
    float tw = 0.6 + 0.4 * sin(uTime * 2.0 + h1(sp + 3.0) * 40.0);
    col += vec3(0.9, 0.93, 1.0) * st * tw * smoothstep(0.02, 0.25, h) * (0.5 + h1(sp + 7.0));
    // milky band
    col += vec3(0.05, 0.06, 0.09) * n2(d.xz * 9.0) * exp(-pow(dot(d, normalize(vec3(0.6, 0.3, 0.74))) * 3.0, 2.0));
    // aurora curtains low in the northern sky
    if (uAurora > 0.0 && d.z < 0.0) {
      float az = atan(d.x, -d.z);
      float band = 0.28 + 0.07 * sin(az * 2.3 + uTime * 0.05) + 0.04 * n2(vec2(az * 3.0, uTime * 0.03));
      float curtain = exp(-pow((h - band) * 7.0, 2.0)) * smoothstep(0.02, 0.1, h);
      float rays = 0.55 + 0.45 * n2(vec2(az * 28.0, uTime * 0.12));
      float fold = smoothstep(-1.2, -0.2, az) * (1.0 - smoothstep(0.6, 1.4, az));
      vec3 ac = mix(vec3(0.1, 0.9, 0.55), vec3(0.55, 0.25, 0.8), smoothstep(band, band + 0.12, h));
      col += ac * curtain * rays * fold * uAurora * 0.55;
    }
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

const SNOW_BOX = 70;
function snowMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTime: U.uTime,
      uCam: { value: new THREE.Vector3() },
      uWind: { value: new THREE.Vector3() },
      uCol: { value: new THREE.Color("#ffffff") },
      uBlizz: { value: 0 },
      uTex: { value: glowTexture() },
      uPx: { value: 1 },
    },
    vertexShader: /* glsl */ `
attribute float aSeed;
uniform float uTime;
uniform vec3 uCam;
uniform vec3 uWind;
uniform float uBlizz;
uniform float uPx;
varying float vA;
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
  gl_PointSize = uPx * (0.05 + aSeed * 0.05) * 900.0 / max(dist, 0.5);
  float keep = step(aSeed, 0.35 + uBlizz * 0.65);
  vA = keep * smoothstep(0.4, 2.0, dist) * (1.0 - smoothstep(B * 0.3, B * 0.5, dist));
}`,
    fragmentShader: /* glsl */ `
uniform sampler2D uTex;
uniform vec3 uCol;
varying float vA;
void main() {
  if (vA < 0.01) discard;
  float a = texture2D(uTex, gl_PointCoord).a;
  gl_FragColor = vec4(uCol, a * vA * 0.9);
}`,
  });
}
function streakMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTime: U.uTime,
      uCam: { value: new THREE.Vector3() },
      uWind: { value: new THREE.Vector3() },
      uCol: { value: new THREE.Color("#ffffff") },
      uBlizz: { value: 0 },
    },
    vertexShader: /* glsl */ `
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
  p -= vel * aEnd * 0.06;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = -mv.z;
  vA = uBlizz * smoothstep(0.3, 1.5, dist) * (1.0 - smoothstep(10.0, 20.0, dist)) * (1.0 - aEnd * 0.7);
}`,
    fragmentShader: /* glsl */ `
uniform vec3 uCol;
varying float vA;
void main() { gl_FragColor = vec4(uCol, vA * 0.55); }`,
  });
}

// ---------------------------------------------------------------------------------------
// the chairlift path: up the west cable, round the top bullwheel, down the east cable

function liftPath(lift: Lift) {
  const s0 = lift.supports[0]!;
  const s1 = lift.supports[lift.supports.length - 1]!;
  const run = Math.abs(s0.z - s1.z);
  const bull = Math.PI * lift.gauge;
  const total = run * 2 + bull * 2;
  const yAtZ = (z: number) => {
    for (let i = 0; i + 1 < lift.supports.length; i++) {
      const p = lift.supports[i]!;
      const q = lift.supports[i + 1]!;
      if (z <= p.z && z >= q.z) return cableY(p, q, (p.z - z) / (p.z - q.z));
    }
    return z > s0.z ? s0.y : s1.y;
  };
  const out = { x: 0, y: 0, z: 0, yaw: 0 };
  const at = (s: number) => {
    s = ((s % total) + total) % total;
    if (s < run) {
      out.x = lift.x - lift.gauge;
      out.z = s0.z - s;
      out.yaw = 0;
    } else if (s < run + bull) {
      const a = ((s - run) / bull) * Math.PI;
      out.x = lift.x - Math.cos(a) * lift.gauge;
      out.z = s1.z - Math.sin(a) * lift.gauge;
      out.yaw = -a;
    } else if (s < run * 2 + bull) {
      out.x = lift.x + lift.gauge;
      out.z = s1.z + (s - run - bull);
      out.yaw = Math.PI;
    } else {
      const a = ((s - run * 2 - bull) / bull) * Math.PI;
      out.x = lift.x + Math.cos(a) * lift.gauge;
      out.z = s0.z + Math.sin(a) * lift.gauge;
      out.yaw = Math.PI - a;
    }
    out.y = yAtZ(Math.max(Math.min(out.z, s0.z), s1.z));
    return out;
  };
  return { total, at };
}

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
  chunks: { x0: number; z0: number; x1: number; z1: number; main: THREE.BufferGeometry | null; detail: THREE.BufferGeometry | null; glow: THREE.BufferGeometry | null; signs: THREE.BufferGeometry | null; pools: THREE.BufferGeometry | null }[];
  terrain: ReturnType<typeof playTerrain>;
  outer: THREE.BufferGeometry;
  trees: { x: number; z: number; near: THREE.Matrix4[]; tall: THREE.Matrix4[]; col: THREE.Color[]; tallCol: THREE.Color[] }[];
  far: THREE.Matrix4[];
  smoke: [number, number, number][];
  lamps: [number, number, number, number][];
  surf: THREE.DataTexture;
  forest: THREE.DataTexture;
  stats: { verts: number; trees: number; far: number };
};

function build(layout: AlpineLayout): Built {
  const a = layout.alpine;
  const half = layout.half;
  const nc = Math.ceil((half * 2) / CHUNK);
  const kits: Kit[] = [];
  for (let i = 0; i < nc * nc; i++)
    kits.push({ main: new Geo(), detail: new Geo(), glow: new Geo(), signs: new Geo(), pools: new Geo(), smoke: [], lamps: [] });
  const kitAt = (x: number, z: number) => {
    const i = Math.max(0, Math.min(nc - 1, Math.floor((x + half) / CHUNK)));
    const j = Math.max(0, Math.min(nc - 1, Math.floor((z + half) / CHUNK)));
    return kits[i * nc + j]!;
  };
  buildInto(kitAt, a, groundY);
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
  // trees per chunk
  const trees: Built["trees"] = [];
  for (let i = 0; i < nc; i++)
    for (let j = 0; j < nc; j++) trees.push({ x: -half + (i + 0.5) * CHUNK, z: -half + (j + 0.5) * CHUNK, near: [], tall: [], col: [], tallCol: [] });
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  const r = mulberry(4711);
  for (const t of a.trees) {
    const i = Math.max(0, Math.min(nc - 1, Math.floor((t.x + half) / CHUNK)));
    const j = Math.max(0, Math.min(nc - 1, Math.floor((t.z + half) / CHUNK)));
    const bucket = trees[i * nc + j]!;
    e.set((r() - 0.5) * 0.06, t.rot, (r() - 0.5) * 0.06);
    const wk = t.w / 0.3;
    m4.compose(v.set(t.x, t.y - 0.3, t.z), q.setFromEuler(e), s.set(t.h * wk, t.h, t.h * wk));
    const c = new THREE.Color().setHSL(0.36 + (r() - 0.5) * 0.06, 0.1 + r() * 0.15, 0.85 + r() * 0.3);
    if (t.k === 1) {
      bucket.tall.push(m4.clone());
      bucket.tallCol.push(c);
    } else {
      bucket.near.push(m4.clone());
      bucket.col.push(c);
    }
  }
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
  for (const k of kits) {
    smoke.push(...k.smoke);
    lamps.push(...k.lamps);
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
    forest: forestTexture(),
    stats: { verts, trees: a.trees.length, far: far.length },
  };
}

// ---------------------------------------------------------------------------------------

export const AlpineScene = memo(function AlpineScene({
  layout,
  night,
  isHost,
  playing,
}: {
  layout: AlpineLayout;
  night: boolean;
  isHost: boolean;
  playing: boolean;
}) {
  const { scene, camera } = useThree();
  const built = useMemo(() => {
    const t0 = performance.now();
    const b = build(layout);
    console.info(`[alpine] built ${b.chunks.length} chunks, ${b.stats.verts} verts, ${b.stats.trees} trees + ${b.stats.far} far in ${Math.round(performance.now() - t0)} ms`);
    return b;
  }, [layout]);
  const look: AlpineLook = alpineLook(night);

  const mats = useMemo(
    () => ({
      facade: facadeMaterial(),
      glow: basicFog(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), "alpine-glow"),
      signs: basicFog(new THREE.MeshBasicMaterial({ vertexColors: true, map: signTexture(), toneMapped: false }), "alpine-signs"),
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
      terrain: terrainMaterial(built.surf, built.forest),
      tree: treeMaterial(),
      sky: skyMaterial(),
      snow: snowMaterial(),
      streak: streakMaterial(),
      chair: basicFog(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), "alpine-chair"),
      halo: new THREE.PointsMaterial({
        map: glowTexture(),
        size: 3,
        sizeAttenuation: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexColors: true,
        fog: false,
        toneMapped: false,
      }),
      smoke: new THREE.PointsMaterial({
        map: glowTexture(),
        size: 5,
        sizeAttenuation: true,
        transparent: true,
        depthWrite: false,
        opacity: 0.32,
        color: "#dfe2ea",
        fog: false,
      }),
    }),
    [built],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  useEffect(
    () => () => {
      for (const c of built.chunks) [c.main, c.detail, c.glow, c.signs, c.pools].forEach((g) => g?.dispose());
      for (const t of built.terrain) t.geo.dispose();
      built.outer.dispose();
      built.surf.dispose();
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
      fir: spruceGeo(true),
      farSpruce: farSpruceGeo(),
      chair: chairGeo(),
    };
  }, [built]);
  useEffect(() => () => Object.values(geos).forEach((g) => g.dispose()), [geos]);

  // instanced forest per chunk (near + far LOD) and the far ring
  const nearRefs = useRef<(THREE.InstancedMesh | null)[]>([]);
  const tallRefs = useRef<(THREE.InstancedMesh | null)[]>([]);
  const lodRefs = useRef<(THREE.InstancedMesh | null)[]>([]);
  const farRef = useRef<THREE.InstancedMesh>(null);
  const chairRef = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    built.trees.forEach((t, i) => {
      const n = nearRefs.current[i];
      if (n) {
        t.near.forEach((m, k) => {
          n.setMatrixAt(k, m);
          n.setColorAt(k, t.col[k]!);
        });
        n.instanceMatrix.needsUpdate = true;
        if (n.instanceColor) n.instanceColor.needsUpdate = true;
        n.computeBoundingSphere();
      }
      const tl = tallRefs.current[i];
      if (tl) {
        t.tall.forEach((m, k) => {
          tl.setMatrixAt(k, m);
          tl.setColorAt(k, t.tallCol[k]!);
        });
        tl.instanceMatrix.needsUpdate = true;
        if (tl.instanceColor) tl.instanceColor.needsUpdate = true;
        tl.computeBoundingSphere();
      }
      const l = lodRefs.current[i];
      if (l) {
        [...t.near, ...t.tall].forEach((m, k) => l.setMatrixAt(k, m));
        l.instanceMatrix.needsUpdate = true;
        l.computeBoundingSphere();
      }
    });
    const f = farRef.current;
    if (f) {
      built.far.forEach((m, k) => f.setMatrixAt(k, m));
      f.instanceMatrix.needsUpdate = true;
      f.computeBoundingSphere();
    }
  }, [built]);

  const path = useMemo(() => liftPath(layout.alpine.lift), [layout]);
  const chairCount = Math.floor(path.total / 15);

  // time of day: sky colours, light tints, window glow
  const skyRef = useRef<THREE.Mesh>(null);
  useEffect(() => {
    const m = mats.sky;
    (m.uniforms["uTop"]!.value as THREE.Color).set(look.skyTop);
    (m.uniforms["uMid"]!.value as THREE.Color).set(look.skyMid);
    (m.uniforms["uHor"]!.value as THREE.Color).set(look.skyHorizon);
    (m.uniforms["uGlow"]!.value as THREE.Color).set(look.sunGlow);
    m.uniforms["uNight"]!.value = night ? 1 : 0;
    m.uniforms["uAurora"]!.value = look.aurora;
    U.uSunDir.value.set(...look.sunDir).normalize();
    U.uPeakLit.value.set(look.peakLit);
    U.uAlpen.value = night ? 0.18 : 1;
    U.uWin.value = look.windows;
    U.uHaze.value.set(look.haze);
    U.uMistCol.value.set(look.haze);
    U.uHazeDist.value = night ? 5200 : 7000;
    U.uHazeMax.value = night ? 0.9 : 0.8;
    mats.glow.color.setScalar(night ? 1.4 : 0.9);
    mats.signs.color.setScalar(night ? 1.1 : 0.85);
    mats.pools.opacity = night ? 0.55 : 0.18;
    mats.halo.opacity = night ? 0.85 : 0.35;
    (mats.snow.uniforms["uCol"]!.value as THREE.Color).set(look.snow);
    (mats.streak.uniforms["uCol"]!.value as THREE.Color).set(look.snow);
    mats.smoke.color.set(night ? "#7a849c" : "#e8d6dc");
    const prev = scene.background;
    scene.background = new THREE.Color(look.skyHorizon);
    return () => {
      scene.background = prev;
    };
  }, [night, look, mats, scene]);

  const detailRefs = useRef<(THREE.Mesh | null)[]>([]);
  const lodTick = useRef(0);
  const [px] = useState(() => (typeof window !== "undefined" ? Math.min(2, window.devicePixelRatio || 1) : 1));
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
    U.uMist.value.set(night ? 260 : 380, night ? 1800 : 2600);
    mats.sky.uniforms["uBlizz"]!.value = Math.min(1, bb * 1.15);
    const f = scene.fog as THREE.Fog | null;
    if (f && "near" in f) {
      skyCol.set(look.sky);
      f.color.copy(skyCol).lerp(blizCol, bb);
      f.near = THREE.MathUtils.lerp(look.fog[0], 1.5, Math.pow(bb, 0.35));
      f.far = THREE.MathUtils.lerp(look.fog[1], 24, Math.pow(bb, 0.35));
    }
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
      const s0 = alpine.t * 2.3;
      for (let i = 0; i < chairCount; i++) {
        const p = path.at(s0 + (i * path.total) / chairCount);
        q.setFromAxisAngle(ax, p.yaw);
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
    // distance LOD a few times a second
    lodTick.current -= 1;
    if (lodTick.current <= 0) {
      lodTick.current = 8;
      built.chunks.forEach((c, i) => {
        const d = Math.hypot(Math.max(c.x0 - cam.x, 0, cam.x - c.x1), Math.max(c.z0 - cam.z, 0, cam.z - c.z1));
        const det = detailRefs.current[i];
        if (det) det.visible = d < DETAIL_RANGE;
        const nearT = d < TREE_NEAR;
        const n = nearRefs.current[i];
        const tl = tallRefs.current[i];
        const l = lodRefs.current[i];
        if (n) n.visible = nearT;
        if (tl) tl.visible = nearT;
        if (l) l.visible = !nearT;
      });
    }
  });

  return (
    <group>
      <mesh ref={skyRef} geometry={geos.sky} material={mats.sky} renderOrder={-10} frustumCulled={false} />
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
          {c.glow && <mesh geometry={c.glow} material={mats.glow} />}
          {c.signs && <mesh geometry={c.signs} material={mats.signs} />}
          {c.pools && <mesh geometry={c.pools} material={mats.pools} renderOrder={2} />}
        </group>
      ))}
      {built.trees.map((t, i) => (
        <group key={`tr${i}`}>
          {t.near.length > 0 && (
            <instancedMesh
              ref={(m) => {
                nearRefs.current[i] = m;
              }}
              args={[geos.spruce, mats.tree, t.near.length]}
              castShadow
              receiveShadow
            />
          )}
          {t.tall.length > 0 && (
            <instancedMesh
              ref={(m) => {
                tallRefs.current[i] = m;
              }}
              args={[geos.fir, mats.tree, t.tall.length]}
              castShadow
              receiveShadow
            />
          )}
          {t.near.length + t.tall.length > 0 && (
            <instancedMesh
              ref={(m) => {
                lodRefs.current[i] = m;
              }}
              args={[geos.farSpruce, mats.tree, t.near.length + t.tall.length]}
              visible={false}
            />
          )}
        </group>
      ))}
      {built.far.length > 0 && <instancedMesh ref={farRef} args={[geos.farSpruce, mats.tree, built.far.length]} />}
      <instancedMesh ref={chairRef} args={[geos.chair, mats.chair, chairCount]} castShadow frustumCulled={false} />
      <points geometry={geos.halo} material={mats.halo} renderOrder={3} />
      <points geometry={geos.smoke} material={mats.smoke} renderOrder={3} frustumCulled={false} />
      <points geometry={geos.snow} material={mats.snow} renderOrder={4} frustumCulled={false} />
      <lineSegments geometry={geos.streak} material={mats.streak} renderOrder={4} frustumCulled={false} />
    </group>
  );
});

// ---------------------------------------------------------------------------------------

/** `?shadows=0` forces shadows off, `?shadows=1` keeps them on (no auto fallback). */
function shadowParam(): boolean | null {
  if (typeof window === "undefined") return null;
  const v = new URLSearchParams(window.location.search).get("shadows");
  return v === "0" ? false : v === "1" ? true : null;
}
const SUN_RANGE = 90;
const SUN_MAP = 2048;
const SUN_DIST = 700;

/** Low sun (or moon) whose shadow frustum follows the player; auto-off on slow devices. */
export function AlpineSun({ night }: { night: boolean }) {
  const ref = useRef<THREE.DirectionalLight>(null);
  const forced = useMemo(shadowParam, []);
  const [low, setLow] = useState(forced === false);
  const ema = useRef(1 / 60);
  const slowFor = useRef(0);
  const look = alpineLook(night);
  const dir = useMemo(() => new THREE.Vector3(...look.sunDir).normalize(), [look]);
  useFrame((state, raw) => {
    const l = ref.current;
    if (!l) return;
    const texel = (SUN_RANGE * 2) / SUN_MAP;
    const cx = Math.round(state.camera.position.x / texel) * texel;
    const cz = Math.round(state.camera.position.z / texel) * texel;
    const cy = state.camera.position.y;
    l.target.position.set(cx, cy, cz);
    l.target.updateMatrixWorld();
    l.position.set(cx + dir.x * SUN_DIST, cy + dir.y * SUN_DIST, cz + dir.z * SUN_DIST);
    // the blizzard dims the sun
    l.intensity = look.sun.intensity * (1 - alpine.blizzard * 0.75);
    if (forced !== null || low) return;
    ema.current += (Math.min(raw, 0.25) - ema.current) * 0.05;
    if (ema.current > 0.04) {
      slowFor.current += raw;
      if (slowFor.current > 3) {
        console.info("[alpine] frames are slow: switching shadows off (use ?shadows=1 to keep them)");
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
