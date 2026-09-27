// Shared materials and skies for Dry Gulch: the facade material every building, prop,
// rock face, train car and barricade draws with, and the sky behind the town.
import * as THREE from "three";

import { sunsetBackground } from "../sky";
import { addSkyFogUniforms } from "../skyFog";
import { WORDS } from "./layout";
import { WESTERN_SUNSET } from "./look";
import { westernArrays, westernSky, type WMode } from "./textures";

/** The reflection / sky-light env map the scene built for the current time of day. The
 * train and the barricades pick it up so their shaded sides get the same sky light. */
export const westernEnv: { map: THREE.Texture | null; intensity: number } = { map: null, intensity: 1 };
/** keep a material's env map in step with the scene's (call every frame; cheap) */
export function syncEnv(mat: THREE.MeshStandardMaterial) {
  if (mat.envMap === westernEnv.map && mat.envMapIntensity === westernEnv.intensity) return;
  mat.envMap = westernEnv.map;
  mat.envMapIntensity = westernEnv.intensity;
  mat.needsUpdate = true;
}

/** The western facade material: MeshStandard + the texture array, lamp-lit windows at night,
 * reflective window glass, and a little ground-level darkening on walls. */
export function facadeMaterial(nightK: { value: number }) {
  const arr = westernArrays(WORDS);
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.93,
    metalness: 0,
    envMapIntensity: 1,
  });
  mat.onBeforeCompile = (sh) => {
    addSkyFogUniforms(sh);
    sh.uniforms["uDay"] = { value: arr.day };
    sh.uniforms["uNight"] = { value: arr.night };
    sh.uniforms["uNightK"] = nightK;
    sh.vertexShader = sh.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute vec2 aUv2;\nattribute vec3 aFac;\nvarying vec2 vFuv;\nvarying vec3 vFac;\nvarying float vWy;\nvarying vec3 vWp;\nvarying vec3 vWn;",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvFuv = aUv2;\nvFac = aFac;\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWy = vWp.y;\nvWn = normalize(mat3(modelMatrix) * objectNormal);",
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
varying vec3 vWp;
varying vec3 vWn;
float wHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float wNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), f.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// Dry Gulch's cliff faces, built in world space so every face (however big its triangles)
// gets the same close-up rock: sandstone strata with a ledge lip and a recessed underside,
// vertical fractures, and dark desert-varnish streaks running down from the ledges.
// rockBump is the ledge/fracture tilt (x: along the wall, y: up), used to bend the normal.
vec2 rockBump;
vec3 rockDetail(vec3 col) {
  rockBump = vec2(0.0);
  vec3 n = normalize(vWn);
  float wall = 1.0 - smoothstep(0.55, 0.8, abs(n.y));
  if (wall <= 0.0) return col;
  // the horizontal coordinate along the face
  float along = abs(n.x) > abs(n.z) ? vWp.z : vWp.x;
  float warp = wNoise(vec2(along * 0.035, vWp.y * 0.02)) * 2.6 + wNoise(vec2(along * 0.21, 3.1)) * 0.35;
  float s = vWp.y * 0.62 + warp;
  float band = floor(s);
  float p = fract(s);
  // each stratum its own tone: rust, pale cream, deep red, chocolate
  float hb = wHash(vec2(band, 7.0));
  vec3 tone = hb < 0.18 ? vec3(1.18, 1.1, 1.0) : hb < 0.45 ? vec3(1.06, 0.92, 0.84) : hb < 0.8 ? vec3(0.94, 0.8, 0.74) : vec3(0.74, 0.62, 0.56);
  // ledge: a lit lip at the top of each stratum, a shadowed undercut below it
  float lip = smoothstep(0.84, 0.97, p);
  float under = 1.0 - smoothstep(0.0, 0.16, p);
  rockBump.y = lip * 0.75 - under * 0.6;
  // fractures: near-vertical cracks every few metres, wandering a little
  float cx = along * 0.28 + wNoise(vec2(along * 0.05, vWp.y * 0.09)) * 1.6;
  float cr = abs(fract(cx) - 0.5);
  float crack = (1.0 - smoothstep(0.0, 0.035, cr)) * step(0.35, wNoise(vec2(floor(cx), band * 0.5)));
  rockBump.x = (fract(cx) < 0.5 ? -1.0 : 1.0) * (1.0 - smoothstep(0.0, 0.07, cr)) * 0.5;
  // desert varnish: dark streaks hanging below the ledges
  // (thin, of uneven length, fading out as they run down the face)
  float st = wNoise(vec2(along * 1.7, band * 0.37)) * wNoise(vec2(along * 0.23, 1.7));
  float run = wNoise(vec2(along * 0.6, band * 1.3));
  float streak = smoothstep(0.2, 0.4, st) * smoothstep(1.0 - run, 1.0, p + 0.25) * 0.85;
  vec3 c = col * tone;
  c *= 1.0 - streak * 0.42;
  c *= 1.0 - crack * 0.55;
  c *= 1.0 - under * 0.28;
  c *= 1.0 + lip * 0.14;
  // fine pitting
  c *= 0.9 + 0.2 * wNoise(vWp.xz * 1.7 + vWp.y * 1.3);
  rockBump *= wall;
  return mix(col, c, wall);
}`,
      )
      .replace(
        "#include <map_fragment>",
        `vec4 facT = texture(uDay, vec3(vFuv, vFac.x));
diffuseColor.rgb *= facT.rgb;
// close-up grit on the red rock: a fine second sample so cliffs stay crisp at arm's length
rockBump = vec2(0.0);
if (abs(vFac.x - 17.0) < 0.5) {
  vec3 grit = texture(uDay, vec3(vFuv * 11.0, 22.0)).rgb;
  diffuseColor.rgb *= mix(vec3(0.82), vec3(1.12), dot(grit, vec3(0.333)));
  diffuseColor.rgb = rockDetail(diffuseColor.rgb);
}
float glassK = facT.a;
float aoK = step(5.0, vFac.z);
float litMode = mod(vFac.z, 10.0);
diffuseColor.rgb *= mix(1.0, mix(0.62, 1.0, smoothstep(0.0, 2.6, vWy)), aoK);`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
if (rockBump.x != 0.0 || rockBump.y != 0.0) {
  // bend the normal: up/down at the ledges, sideways into the cracks (world axes -> view)
  vec3 wn = normalize(vWn);
  vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), wn) + vec3(1e-4));
  vec3 bend = vec3(0.0, 1.0, 0.0) * rockBump.y + side * rockBump.x;
  normal = normalize(normal + (viewMatrix * vec4(bend, 0.0)).xyz);
}`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        "float roughnessFactor = mix(roughness, 0.14, glassK);",
      )
      .replace(
        "#include <metalnessmap_fragment>",
        "float metalnessFactor = mix(metalness, 0.55, glassK);",
      )
      .replace(
        "#include <emissivemap_fragment>",
        `if (uNightK > 0.0 && litMode > 0.5) {
  vec4 nt = texture(uNight, vec3(vFuv, vFac.x));
  float hf = wHash(floor(vFuv * 4.0) + vec2(vFac.y * 97.0, vFac.y * 13.0));
  float on = litMode > 1.5 ? 1.0 : step(0.42, hf);
  float k = litMode > 1.5 ? 1.7 : 1.0;
  totalEmissiveRadiance += nt.rgb * nt.a * on * k * uNightK;
}`,
      );
  };
  mat.customProgramCacheKey = () => "western-facade-v3";
  return mat;
}

/** the sky behind Dry Gulch: the painted sunset (sun low in the west) or the starry night */
let sunsetSky: THREE.Texture | null = null;
export function westernBackground(mode: WMode) {
  if (mode === "night") return westernSky("night");
  sunsetSky ??= sunsetBackground("western-sunset", WESTERN_SUNSET, 1536, 768);
  return sunsetSky;
}
