import { matchEnvironment, rainyMatch } from "./matchEnvironment";
// Vice Heights weather: night rain and wet streets.
//
// The host owns the weather. Each match rolls a chance of starting in the rain; otherwise
// (or after a shower passes) a front can roll in mid-match. The host ships one number to
// the guests in the world snapshot (the current rain strength), so everyone sees the same
// storm. Rain only shows at night; at sunset the same state is kept but drawn dry.
//
// `rainIntensity()` is the value the audio can read (0 = dry, 1 = downpour), already zero
// when the rain isn't being drawn (sunset, other maps).
import * as THREE from "three";

import { L } from "./cityTextures";

export const weather = {
  /** true while the city map is loaded */
  active: false,
  /** rain strength 0..1 (eased), and where it is heading */
  rain: 0,
  target: 0,
  /** how wet the streets are 0..1: soaks up quickly, dries slowly */
  wet: 0,
  /** host: seconds until the weather may turn */
  next: 0,
  /** whether rain is drawn at all (night on the city map) */
  shown: false,
  /** shared-ish clock for the rain animation */
  t: 0,
};

/** Audio hook: current audible / visible rain, 0..1. */
export function rainIntensity() {
  return weather.active && weather.shown ? weather.rain : 0;
}

/** `?rain=1` pins the rain on, `?rain=0` keeps it dry (testing / screenshots). */
function forcedRain(): number | null {
  if (typeof window === "undefined") return null;
  const v = new URLSearchParams(window.location.search).get("rain");
  return v === "1" ? 1 : v === "0" ? 0 : null;
}
export const FORCED_RAIN = forcedRain();

/** New map: weather is selected by the shared seed and remains fixed. */
export function resetWeather(active: boolean, _isHost: boolean) {
  weather.active = active;
  weather.t = 0;
  weather.rain =
    weather.target =
    weather.wet =
      (matchEnvironment.allowOverrides ? FORCED_RAIN : null) ?? (rainyMatch() ? 1 : 0);
  weather.next = Infinity;
}
export function tickWeather(delta: number, _isHost: boolean, _playing: boolean) {
  if (!weather.active) return;
  weather.t += delta;
  weather.rain =
    weather.target =
    weather.wet =
      (matchEnvironment.allowOverrides ? FORCED_RAIN : null) ?? (rainyMatch() ? 1 : 0);
}

/** host -> guests: one number, the rain strength (null when not on the city map) */
export function encodeWeather(): number | null {
  if (!weather.active) return null;
  return Math.round(weather.rain * 1000) / 1000;
}

export function decodeWeather(v: number) {
  if (!weather.active || !Number.isFinite(v)) return;
  if (FORCED_RAIN !== null) return;
  // first snapshot after joining: snap (and soak the streets) instead of fading in
  if (weather.t < 2 && Math.abs(v - weather.rain) > 0.5) {
    weather.rain = v;
    weather.wet = Math.min(1, v * 1.6);
  } else weather.rain += (v - weather.rain) * 0.3;
  weather.target = v;
}

// ---------------------------------------------------------------------------------------
// wet streets (used by the city facade material, which also draws the ground)

/** 1x1 black stand-in while the reflection isn't available (and during its own render) */
const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
black.needsUpdate = true;

export const wetUniforms = {
  /** how wet the streets are 0..1 (0 = the whole wet path is skipped) */
  uWet: { value: 0 },
  /** rain strength 0..1 (drop ripples) */
  uRainK: { value: 0 },
  uRainT: { value: 0 },
  /** planar reflection of the street level (HDR, mipmapped) and its projector */
  uRefl: { value: black as THREE.Texture },
  uReflMat: { value: new THREE.Matrix4() },
  uReflOn: { value: 0 },
  uReflTexel: { value: new THREE.Vector2(1, 1) },
};
export const blackTexture = black;

export function addWetUniforms(sh: { uniforms: Record<string, THREE.IUniform> }) {
  Object.assign(sh.uniforms, wetUniforms);
}

/**
 * GLSL for the facade material's fragment shader (after `#include <color_pars_fragment>`;
 * expects vWPos, vFac and vColor). `cityWet(...)` darkens up-facing ground, lowers its roughness, masks
 * puddles with noise and adds the planar reflection: blurred and stretched on wet asphalt,
 * mirror-sharp (and rippled by the drops) in puddles, weighted by water's Fresnel.
 */
export const WET_GLSL = /* glsl */ `
uniform float uWet;
uniform float uRainK;
uniform float uRainT;
uniform sampler2D uRefl;
uniform mat4 uReflMat;
uniform float uReflOn;
uniform vec2 uReflTexel;
float wetHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float wetNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = wetHash(i);
  float b = wetHash(i + vec2(1.0, 0.0));
  float c = wetHash(i + vec2(0.0, 1.0));
  float d = wetHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
// expanding rings from drops: one drop per 0.5 m cell, a fresh one every ~0.8 s
vec2 wetRipple(vec2 p, float t) {
  vec2 g = p * 2.0;
  vec2 c = floor(g);
  vec2 f = fract(g) - 0.5;
  vec2 off = (vec2(wetHash(c), wetHash(c + 3.1)) - 0.5) * 0.5;
  float ph = fract(t * 1.25 + wetHash(c + 7.7));
  vec2 dv = f - off;
  float r = length(dv);
  float rr = ph * 0.42;
  float ring = sin((r - rr) * 55.0) * (1.0 - ph) * (1.0 - smoothstep(0.0, 0.07, abs(r - rr)));
  return dv / max(r, 1e-3) * ring;
}
void cityWet(inout vec4 dc, inout float rough, inout vec3 em, vec3 nView) {
  vec3 nW = (vec4(nView, 0.0) * viewMatrix).xyz;
  float up = smoothstep(0.8, 0.95, nW.y) * (1.0 - smoothstep(0.35, 0.5, vWPos.y));
  if (up <= 0.0) return;
  vec2 p = vWPos.xz;
  // grass and dirt soak it up: no sheen there
  float green = smoothstep(0.02, 0.08, vColor.g - max(vColor.r, vColor.b));
  float paving = step(abs(vFac.x - ${L.paving}.0), 0.1);
  float wet = up * uWet * (1.0 - green * 0.85);
  float n = wetNoise(p * 0.21) * 0.62 + wetNoise(p * 0.83 + 7.1) * 0.28 + wetNoise(p * 3.1) * 0.1;
  float puddle = smoothstep(0.53, 0.6, n - paving * 0.04) * smoothstep(0.35, 0.9, uWet) * wet;
  dc.rgb *= mix(1.0, 0.5, wet) * mix(1.0, 0.55, puddle);
  // the mirror comes from the planar reflection; the lighting model keeps a broad sheen only
  rough = mix(rough, 0.62, wet);
  if (uReflOn < 0.5) return;
  float dist = length(vWPos - cameraPosition);
  vec2 rip = wetRipple(p, uRainT) * uRainK * (1.0 - smoothstep(6.0, 22.0, dist));
  vec3 v = normalize(vViewPosition);
  float ndv = clamp(dot(nView, v), 0.0, 1.0);
  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  vec4 rc = uReflMat * vec4(vWPos, 1.0);
  vec2 ruv = rc.xy / rc.w + rip * mix(0.004, 0.012, puddle);
  // rough water film: a blurred mip, stretched vertically into the classic street streaks
  float lod = mix(3.2, 0.3, puddle);
  float stepY = uReflTexel.y * mix(9.0, 1.2, puddle) * exp2(lod * 0.5);
  vec3 r = textureLod(uRefl, ruv, lod).rgb * 0.3;
  r += (textureLod(uRefl, ruv + vec2(0.0, stepY), lod).rgb + textureLod(uRefl, ruv - vec2(0.0, stepY), lod).rgb) * 0.22;
  r += (textureLod(uRefl, ruv + vec2(0.0, stepY * 2.3), lod + 0.6).rgb + textureLod(uRefl, ruv - vec2(0.0, stepY * 2.3), lod + 0.6).rgb) * 0.13;
  float k = wet * mix(0.07 + 0.75 * fres, min(1.0, fres * 1.3 + 0.04), puddle);
  em += r * k;
}
`;
