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
float wHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}`,
      )
      .replace(
        "#include <map_fragment>",
        `vec4 facT = texture(uDay, vec3(vFuv, vFac.x));
diffuseColor.rgb *= facT.rgb;
float glassK = facT.a;
float aoK = step(5.0, vFac.z);
float litMode = mod(vFac.z, 10.0);
diffuseColor.rgb *= mix(1.0, mix(0.62, 1.0, smoothstep(0.0, 2.6, vWy)), aoK);`,
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
  mat.customProgramCacheKey = () => "western-facade-v1";
  return mat;
}

/** the sky behind Dry Gulch: the painted sunset (sun low in the west) or the starry night */
let sunsetSky: THREE.Texture | null = null;
export function westernBackground(mode: WMode) {
  if (mode === "night") return westernSky("night");
  sunsetSky ??= sunsetBackground("western-sunset", WESTERN_SUNSET, 1536, 768);
  return sunsetSky;
}
