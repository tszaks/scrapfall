// Directional haze: three.js fog, but the fog colour warms toward the sun, the way aerial
// perspective does at golden hour (distant towers dissolve into gold on the sun side and
// into dusky blue-violet away from it). One shared set of uniforms for every material:
// the fog shader chunks are patched once and each material's program picks up the shared
// uniform objects when it compiles.
import * as THREE from "three";

export const skyFog = {
  fogSunDir: { value: new THREE.Vector3(0, 0.1, 1).normalize() },
  fogSunColor: { value: new THREE.Color("#ffb472") },
  fogSunK: { value: 0 },
};

/** add the shared haze uniforms to a shader (call from custom onBeforeCompile hooks too) */
export function addSkyFogUniforms(shader: { uniforms: Record<string, THREE.IUniform> }) {
  Object.assign(shader.uniforms, skyFog);
}

let installed = false;
export function installSkyFog() {
  if (installed) return;
  installed = true;
  THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogDir;
#endif`;
  THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  // world-space view ray (the view matrix's rotation is orthonormal)
  vFogDir = transpose( mat3( viewMatrix ) ) * mvPosition.xyz;
#endif`;
  THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform vec3 fogSunColor;
  uniform vec3 fogSunDir;
  uniform float fogSunK;
  varying float vFogDepth;
  varying vec3 vFogDir;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
  THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  #ifdef WATER_FOG
    fogFactor *= 0.6;
  #endif
  vec3 fogD = normalize( vFogDir );
  float fogS = max( dot( fogD, fogSunDir ), 0.0 );
  // broad warm lobe plus a tighter forward-scatter glow round the sun
  float fogW = fogSunK * ( 0.55 * fogS * fogS + 0.45 * pow( fogS, 12.0 ) );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, mix( fogColor, fogSunColor, clamp( fogW, 0.0, 1.0 ) ), fogFactor );
#endif`;
  // every built-in material shares the uniforms (materials with their own onBeforeCompile
  // call addSkyFogUniforms themselves)
  THREE.Material.prototype.onBeforeCompile = function (shader) {
    addSkyFogUniforms(shader);
  };
}
