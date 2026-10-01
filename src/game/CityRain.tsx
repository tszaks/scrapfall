import { shelterUniforms, SHELTER_GLSL } from "./structures/weather";
// Night rain over Vice Heights, drawn around the player:
//   streaks   - 10k thin, camera-facing streaks, wrapped in a box around the camera on the
//               GPU (one draw call, no per-frame CPU work), fading with distance
//   splashes  - little crowns of droplets where drops hit the street near the player
//   drips     - drops running off the awning edges, splashing on the pavement below
//   sky       - an overcast deck that hides the stars and glows with the city's light
//   reflection- the wet streets' mirror: the scene rendered upside down about the street
//               plane into a half-resolution HDR target (planar reflection; lower quality
//               tiers: smaller and refreshed less often, or off), only while the
//               streets are wet. The facade shader (cityWeather.ts, WET_GLSL) blurs and stretches it.
//
// Planar reflection was picked over screen-space reflections: SSR needs a depth + colour
// pre-pass and a full-screen march that misses anything off screen (neon behind the camera's
// view edge, lamp heads above the frame), and the city has no post-processing chain to hang
// it on. The mirror pass costs one extra scene render at quarter pixel count, drawn only when
// it rains, and gets every light in the city right, including headlights and lit windows.
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { setAmbienceRain } from "./ambience";
import type { CityLayout } from "./cityLayout";
import type { TimeOfDay } from "./lighting";
import { liveLook, tod, todSmooth } from "./timeOfDay";
import { blackTexture, resetWeather, tickWeather, weather, wetUniforms } from "./cityWeather";
import { player as accessPlayer } from "./access/world";
import { quality } from "./quality";

const BOX = new THREE.Vector3(38, 26, 38);
const STREAKS = 10000;
const SPLASHES = 320;
const DROPS = 160;
/** the street plane the reflection mirrors about (roads are at 0, pavements at 0.15) */
const PLANE_Y = 0.02;
const REFL_FAR = 450;
/** radius of the overcast cloud deck (inside the camera's 1600 m far plane) */
const SKY_R = 1300;

const _fwd = new THREE.Vector3();

/** `?refl=0` turns the street mirror off (A/B testing; the streets still darken and gloss) */
const REFL_ALLOWED =
  typeof window === "undefined" || new URLSearchParams(window.location.search).get("refl") !== "0";

function rnd(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- shaders -------------------------------------------------------------------------

/** width of a thin line: at least ~0.8 px, so far streaks never alias (their alpha drops instead) */
const STREAK_COMMON = /* glsl */ `
uniform float uPixK;
varying float vA;
varying vec2 vQ;
vec3 streak(vec3 head, vec3 tail, vec2 q, float width, out float alphaK) {
  vec3 wp = mix(head, tail, q.y);
  vec3 dir = normalize(head - tail);
  vec3 toCam = cameraPosition - wp;
  float depth = length(toCam);
  vec3 side = normalize(cross(toCam / depth, dir));
  float w = max(width, depth * uPixK * 0.85);
  alphaK = width / w;
  return wp + side * q.x * w;
}
`;

export const STREAK_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vA;
varying vec2 vQ;
void main() {
  float a = vA * sin(3.14159 * vQ.y) * (1.0 - abs(vQ.x) * 1.2);
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

export const RAIN_VERT = /* glsl */ `
${SHELTER_GLSL}
attribute vec4 aSeed;
uniform float uTime;
uniform float uRain;
uniform vec3 uBox;
uniform vec3 uCenter;
uniform vec2 uWind;
${STREAK_COMMON}
void main() {
  float speed = 8.5 + aSeed.w * 3.5;
  vec3 vel = vec3(uWind.x, -speed, uWind.y);
  vec3 base = aSeed.xyz * uBox + vel * uTime;
  vec3 p = uCenter + mod(base - uCenter + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 dir = normalize(vel);
  float len = speed * 0.05;
  float k;
  vec3 wp = streak(p, p - dir * len, position.xy, 0.0035, k);
  float dxz = length((p - uCenter).xz) / (uBox.x * 0.5);
  float dy = abs(p.y - uCenter.y) / (uBox.y * 0.5);
  float depth = length(cameraPosition - wp);
  float on = step(fract(aSeed.w * 91.7), uRain);
  float fade = smoothstep(0.6, 2.0, depth) * (1.0 - smoothstep(0.6, 1.0, dxz)) * (1.0 - smoothstep(0.75, 1.0, dy));
  fade *= step(0.0, p.y) * (1.0 - smoothstep(12.0, 19.0, depth));
  vA = outsideShelter(p) * on * fade * k * 0.9;
  vQ = position.xy;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const DROP_VERT = /* glsl */ `
attribute vec4 aDrop;
${STREAK_COMMON}
void main() {
  float len = clamp(aDrop.w * 0.035, 0.03, 0.22);
  float k;
  vec3 head = aDrop.xyz;
  vec3 wp = streak(head, head + vec3(0.0, len, 0.0), position.xy, 0.004, k);
  vA = step(0.0, aDrop.y) * k * 0.7;
  vQ = position.xy;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const SPLASH_VERT = /* glsl */ `
attribute vec4 aP;
attribute float aS;
uniform float uTime;
varying vec2 vUv;
varying float vT;
void main() {
  float t = (uTime - aP.w) / 0.32;
  vT = t;
  vUv = position.xy;
  vec3 toCam = cameraPosition - aP.xyz;
  vec3 side = normalize(vec3(toCam.z, 0.0, -toCam.x));
  vec3 wp = aP.xyz + side * position.x * 0.22 * aS + vec3(0.0, position.y * 0.12 * aS, 0.0);
  gl_Position = (t < 0.0 || t > 1.0) ? vec4(0.0, 0.0, 2.0, 1.0) : projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const SPLASH_FRAG = /* glsl */ `
uniform vec3 uColor;
varying vec2 vUv;
varying float vT;
void main() {
  // a crown of six droplets thrown out on little arcs
  float a = 0.0;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float sx = (fi / 5.0 - 0.5) * 1.7;
    float h = 0.55 + 0.45 * fract(fi * 0.618);
    vec2 c = vec2(sx * vT, 4.0 * vT * (1.0 - vT) * h);
    vec2 d = (vUv - c) * vec2(1.0, 1.6);
    a += smoothstep(0.06, 0.015, length(d));
  }
  // the base ring flattening out
  float ring = smoothstep(0.06, 0.0, abs(length(vUv * vec2(1.0, 5.0)) - vT * 0.8)) * step(vUv.y, 0.08);
  a = (a + ring * 0.5) * (1.0 - vT) * 0.38;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const SKY_FRAG = /* glsl */ `
uniform float uRain;
uniform float uTime;
varying vec3 vDir;
float h1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h1(i), h1(i + vec2(1.0, 0.0)), f.x), mix(h1(i + vec2(0.0, 1.0)), h1(i + 1.0), f.x), f.y);
}
void main() {
  float y = max(vDir.y, 0.0);
  // low cloud lit orange-pink from below by the city, darker overhead
  vec3 zen = vec3(0.028, 0.03, 0.04);
  vec3 hor = vec3(0.16, 0.11, 0.12);
  vec3 c = mix(hor, zen, pow(y, 0.45));
  vec2 p = vDir.xz / (0.25 + y) * 3.0 + uTime * 0.01;
  c *= 0.8 + 0.4 * (n2(p) * 0.6 + n2(p * 2.7) * 0.4);
  float a = uRain * 0.985 * smoothstep(-0.05, 0.04, vDir.y);
  gl_FragColor = vec4(c, a);
}
`;

// ---- component ------------------------------------------------------------------------

export function CityRain({
  city,
  isHost,
  drips,
  heights,
}: {
  city: CityLayout;
  /** legacy: the time of day now comes from timeOfDay.ts (rain falls once it's dark) */
  time?: TimeOfDay;
  isHost: boolean;
  drips: [number, number, number, number][];
  heights: Float32Array;
}) {
  const { gl, scene } = useThree();
  const group = useRef<THREE.Group>(null);
  const skyRef = useRef<THREE.Mesh>(null);

  // a new city (or first mount): the host rolls the weather
  const hostRef = useRef(isHost);
  hostRef.current = isHost;
  useEffect(() => {
    resetWeather(true, hostRef.current);
    return () => {
      weather.active = false;
      weather.shown = false;
      setAmbienceRain(0);
      wetUniforms.uWet.value = 0;
      wetUniforms.uReflOn.value = 0;
    };
  }, [city]);

  const time0 = useMemo(() => ({ value: 0 }), []);
  const rainU = useMemo(() => ({ value: 0 }), []);
  const pixK = useMemo(() => ({ value: 0.001 }), []);

  const streaks = useMemo(() => {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(
        new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]),
        3,
      ),
    );
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const r = rnd(4242);
    const seeds = new Float32Array(STREAKS * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = r();
    g.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 4));
    g.instanceCount = STREAKS;
    const m = new THREE.ShaderMaterial({
      vertexShader: RAIN_VERT,
      fragmentShader: STREAK_FRAG,
      uniforms: {
        uTime: time0,
        ...shelterUniforms(),
        uRain: rainU,
        uBox: { value: BOX },
        uCenter: { value: new THREE.Vector3() },
        uWind: { value: new THREE.Vector2(0.9, 0.4) },
        uPixK: pixK,
        uColor: { value: new THREE.Color(0.7, 0.75, 0.86) },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    return { g, m };
  }, [time0, rainU, pixK]);

  const drops = useMemo(() => {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", streaks.g.getAttribute("position"));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const a = new THREE.InstancedBufferAttribute(new Float32Array(DROPS * 4).fill(-10), 4);
    a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("aDrop", a);
    g.instanceCount = DROPS;
    const m = new THREE.ShaderMaterial({
      vertexShader: DROP_VERT,
      fragmentShader: STREAK_FRAG,
      uniforms: { uPixK: pixK, uColor: { value: new THREE.Color(0.8, 0.84, 0.92) } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    // simulation state: position, vertical speed, alive
    const s = {
      x: new Float32Array(DROPS),
      y: new Float32Array(DROPS).fill(-10),
      z: new Float32Array(DROPS),
      v: new Float32Array(DROPS),
      floor: new Float32Array(DROPS),
      next: 0,
    };
    return { g, m, a, s };
  }, [streaks, pixK]);

  const splashes = useMemo(() => {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0]), 3),
    );
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const p = new THREE.InstancedBufferAttribute(new Float32Array(SPLASHES * 4).fill(-100), 4);
    p.setUsage(THREE.DynamicDrawUsage);
    const sz = new THREE.InstancedBufferAttribute(new Float32Array(SPLASHES).fill(1), 1);
    sz.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("aP", p);
    g.setAttribute("aS", sz);
    g.instanceCount = SPLASHES;
    const m = new THREE.ShaderMaterial({
      vertexShader: SPLASH_VERT,
      fragmentShader: SPLASH_FRAG,
      uniforms: { uTime: time0, uColor: { value: new THREE.Color(0.72, 0.77, 0.88) } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    return { g, m, p, sz, next: 0, carry: 0 };
  }, [time0]);

  const sky = useMemo(() => {
    const g = new THREE.SphereGeometry(SKY_R, 24, 12);
    const m = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: { uRain: rainU, uTime: time0 },
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      fog: false,
    });
    return { g, m };
  }, [rainU, time0]);

  useEffect(
    () => () => {
      [streaks, drops, splashes, sky].forEach((o) => {
        o.g.dispose();
        o.m.dispose();
      });
    },
    [streaks, drops, splashes, sky],
  );

  // ---- planar reflection of the street ----
  const refl = useMemo(() => {
    const rt = new THREE.WebGLRenderTarget(16, 16, {
      type: THREE.HalfFloatType,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    });
    return { rt, cam: new THREE.PerspectiveCamera(), on: false, busy: false, frame: 0 };
  }, []);
  useEffect(() => () => refl.rt.dispose(), [refl]);

  useEffect(() => {
    const prev = scene.onBeforeRender;
    const size = new THREE.Vector2();
    const normal = new THREE.Vector3(0, 1, 0);
    const planePt = new THREE.Vector3(0, PLANE_Y, 0);
    const camPos = new THREE.Vector3();
    const rot = new THREE.Matrix4();
    const look = new THREE.Vector3();
    const target = new THREE.Vector3();
    const view = new THREE.Vector3();
    const plane = new THREE.Plane();
    const clip = new THREE.Vector4();
    const q = new THREE.Vector4();
    const previousDomeScale = new THREE.Vector3();
    const texM = wetUniforms.uReflMat.value;
    type SceneHook = (
      this: THREE.Object3D,
      r: THREE.WebGLRenderer,
      s: THREE.Scene,
      c: THREE.Camera,
      t: THREE.WebGLRenderTarget | null,
    ) => void;
    // three calls a Scene's hook with the current render target as the 4th argument
    scene.onBeforeRender = function (renderer, sc, cam, arg) {
      const rtarget = arg as unknown as THREE.WebGLRenderTarget | null;
      (prev as unknown as SceneHook).call(this, renderer, sc as THREE.Scene, cam, rtarget);
      if (
        scene.userData["scrapfallPrewarm"] ||
        refl.busy ||
        rtarget !== null ||
        !(cam as THREE.PerspectiveCamera).isPerspectiveCamera
      )
        return;
      if (!refl.on) {
        wetUniforms.uReflOn.value = 0;
        return;
      }
      // the mirror refreshes every other frame (60 Hz at 120 fps): the facade samples it
      // through the projector it was rendered with, so a frame-old image still lines up
      // (lower quality tiers refresh it less often, at a lower resolution: quality.ts)
      const qs = quality().spec;
      refl.frame++;
      if (refl.frame % qs.reflEvery !== 0 && wetUniforms.uReflOn.value > 0) return;
      const c = cam as THREE.PerspectiveCamera;
      renderer.getDrawingBufferSize(size);
      const w = Math.max(16, Math.round(size.x * qs.reflScale));
      const h = Math.max(16, Math.round(size.y * qs.reflScale));
      if (refl.rt.width !== w || refl.rt.height !== h) refl.rt.setSize(w, h);
      camPos.setFromMatrixPosition(c.matrixWorld);
      if (camPos.y < PLANE_Y + 0.05) {
        wetUniforms.uReflOn.value = 0;
        return;
      }
      // mirror the camera about the street plane (as three's Reflector does)
      view.subVectors(planePt, camPos).reflect(normal).negate().add(planePt);
      rot.extractRotation(c.matrixWorld);
      look.set(0, 0, -1).applyMatrix4(rot).add(camPos);
      target.subVectors(planePt, look).reflect(normal).negate().add(planePt);
      const vc = refl.cam;
      vc.position.copy(view);
      vc.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal);
      vc.lookAt(target);
      vc.layers.mask = c.layers.mask;
      vc.updateMatrixWorld();
      // a shorter view: past ~450 m the reflection is a sliver at the horizon, lost in the rain haze
      vc.fov = c.fov;
      vc.aspect = c.aspect;
      vc.near = c.near;
      vc.far = Math.min(c.far, REFL_FAR);
      vc.updateProjectionMatrix();
      texM.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
      texM.multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse);
      // oblique near plane: clip everything below the street
      plane.setFromNormalAndCoplanarPoint(normal, planePt).applyMatrix4(vc.matrixWorldInverse);
      clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
      const pm = vc.projectionMatrix.elements;
      q.set(
        (Math.sign(clip.x) + pm[8]!) / pm[0]!,
        (Math.sign(clip.y) + pm[9]!) / pm[5]!,
        -1,
        (1 + pm[10]!) / pm[14]!,
      );
      clip.multiplyScalar(2 / clip.dot(q));
      pm[2] = clip.x;
      pm[6] = clip.y;
      pm[10] = clip.z + 1;
      pm[14] = clip.w;
      vc.projectionMatrixInverse.copy(vc.projectionMatrix).invert();

      const g0 = group.current;
      const previousVisible = g0?.visible;
      const prevRT = renderer.getRenderTarget();
      const prevShadow = renderer.shadowMap.autoUpdate;
      const prevAuto = sc.matrixWorldAutoUpdate;
      const dome = skyRef.current;
      if (dome) previousDomeScale.copy(dome.scale);
      refl.busy = true;
      try {
        if (g0) g0.visible = false;
        wetUniforms.uRefl.value = blackTexture;
        wetUniforms.uReflOn.value = 0;
        renderer.shadowMap.autoUpdate = false;
        sc.matrixWorldAutoUpdate = false;
        renderer.setRenderTarget(refl.rt);
        renderer.state.buffers.depth.setMask(true);
        if (renderer.autoClear === false) renderer.clear();
        if (dome) {
          dome.scale.setScalar((REFL_FAR * 0.9) / SKY_R);
          dome.updateMatrixWorld();
        }
        renderer.render(sc, vc);
      } finally {
        if (dome) {
          dome.scale.copy(previousDomeScale);
          dome.updateMatrixWorld();
        }
        renderer.setRenderTarget(prevRT);
        renderer.shadowMap.autoUpdate = prevShadow;
        sc.matrixWorldAutoUpdate = prevAuto;
        if (g0) g0.visible = previousVisible!;
        refl.busy = false;
      }
      wetUniforms.uRefl.value = refl.rt.texture;
      wetUniforms.uReflOn.value = 1;
      wetUniforms.uReflTexel.value.set(1 / w, 1 / h);
    };
    return () => {
      scene.onBeforeRender = prev;
      wetUniforms.uRefl.value = blackTexture;
      wetUniforms.uReflOn.value = 0;
    };
  }, [scene, refl]);

  // ---- fog closes in under the rain ----
  const fogBase = useRef<{ fog: THREE.Fog | null; near: number; far: number }>({
    fog: null,
    near: 0,
    far: 0,
  });

  const nearDrips = useRef<number[]>([]);
  const dripTick = useRef(0);

  useFrame((state, dt) => {
    const delta = Math.min(dt, 0.1);
    tickWeather(delta, hostRef.current, true);
    // the rain belongs to the night: it fades in as the dusk darkens (timeOfDay.ts)
    const nightF = 1;
    const shown = nightF > 0.001;
    weather.shown = shown;
    const rain = shown ? weather.rain * nightF : 0;
    // the ambience reads the live weather (same value as rainIntensity())
    // (its own rain soundscape; indoors the access code muffles the whole ambience: setIndoor)
    setAmbienceRain(rain);
    const wet = shown ? weather.wet * nightF : 0;
    const t = weather.t;
    time0.value = t;
    rainU.value = rain;
    wetUniforms.uWet.value = wet;
    wetUniforms.uRainK.value = rain;
    wetUniforms.uRainT.value = t;
    const qs = quality().spec;
    refl.on = REFL_ALLOWED && wet > 0.02 && qs.reflScale > 0;
    // lower quality tiers draw fewer streaks (the same field, thinned)
    streaks.g.instanceCount = Math.round(STREAKS * qs.rain);
    const g0 = group.current;
    // (no rain indoors: the lobbies, cars and stairwells of the access buildings)
    if (g0) g0.visible = rain > 0.001 && accessPlayer.zone !== 1;
    if (skyRef.current) skyRef.current.visible = rain > 0.001;

    // fog
    const fog = scene.fog;
    const fb = fogBase.current;
    if (fog instanceof THREE.Fog) {
      // the clear-weather fog comes from the blended time-of-day look
      fb.fog = fog;
      fb.near = liveLook.fogNear;
      fb.far = liveLook.fogFar;
      // up on a roof you look out over the rain, not through a street of it: the rain's fog
      // thins with height (a quarter of it from ~170 m up), so the skyline stays
      const up = Math.min(0.75, Math.max(0, (state.camera.position.y - 20) / 200));
      const rf = rain * (1 - up);
      fog.near = fb.near * (1 - 0.55 * rf);
      fog.far = fb.far * (1 - 0.5 * rf);
    }

    if (rain <= 0.001) return;
    const cam = state.camera as THREE.PerspectiveCamera;
    const cp = cam.position;
    cam.getWorldDirection(_fwd);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, -1);
    _fwd.normalize();
    // the streak box sits a little ahead of the camera, where the eye is looking
    const center = streaks.m.uniforms["uCenter"]!.value as THREE.Vector3;
    center.set(cp.x + _fwd.x * BOX.x * 0.28, cp.y + BOX.y * 0.2, cp.z + _fwd.z * BOX.z * 0.28);
    pixK.value =
      (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))) / Math.max(1, gl.domElement.height);

    const half = city.half;
    const cells = city.cells;
    const groundAt = (x: number, z: number) => {
      const i = Math.floor((x + half) / 2);
      const j = Math.floor((z + half) / 2);
      if (i < 0 || j < 0 || i >= cells || j >= cells) return null;
      const c = i * cells + j;
      if (city.solid[c]) return null;
      return heights[c]!;
    };

    // splashes: respawn expired ones at random street spots in front of the player
    const S = splashes;
    S.carry += delta * 650 * rain;
    const pa = S.p.array as Float32Array;
    const sa = S.sz.array as Float32Array;
    let spawned = 0;
    const yaw = Math.atan2(_fwd.x, _fwd.z);
    const spawnSplash = (x: number, y: number, z: number, s: number) => {
      const k = S.next;
      S.next = (S.next + 1) % SPLASHES;
      pa[k * 4] = x;
      pa[k * 4 + 1] = y;
      pa[k * 4 + 2] = z;
      pa[k * 4 + 3] = t - Math.random() * 0.05;
      sa[k] = s;
      spawned++;
    };
    while (S.carry >= 1) {
      S.carry -= 1;
      const a = yaw + (Math.random() - 0.5) * 2.3;
      const d = 1.2 + Math.pow(Math.random(), 0.8) * 13;
      const x = cp.x + Math.sin(a) * d;
      const z = cp.z + Math.cos(a) * d;
      const y = groundAt(x, z);
      if (y === null) continue;
      spawnSplash(x, y + 0.003, z, 0.7 + Math.random() * 0.6);
    }

    // drips off the awnings near the player
    dripTick.current -= delta;
    if (dripTick.current <= 0) {
      dripTick.current = 0.5;
      const list: number[] = [];
      drips.forEach((d, i) => {
        const mx = (d[0] + d[2]) / 2;
        const mz = (d[1] + d[3]) / 2;
        if (Math.abs(mx - cp.x) < 26 && Math.abs(mz - cp.z) < 26) list.push(i);
      });
      nearDrips.current = list;
    }
    const D = drops.s;
    const da = drops.a.array as Float32Array;
    for (const i of nearDrips.current) {
      const d = drips[i]!;
      const len = Math.hypot(d[2] - d[0], d[3] - d[1]);
      let n = len * 2.2 * rain * delta;
      while (n > 0) {
        if (Math.random() < Math.min(1, n)) {
          const k = D.next;
          D.next = (D.next + 1) % DROPS;
          const u = Math.random();
          D.x[k] = d[0] + (d[2] - d[0]) * u;
          D.z[k] = d[1] + (d[3] - d[1]) * u;
          D.y[k] = 2.84;
          D.v[k] = 0;
          D.floor[k] = groundAt(D.x[k]!, D.z[k]!) ?? 0.15;
        }
        n -= 1;
      }
    }
    for (let k = 0; k < DROPS; k++) {
      if (D.y[k]! < -5) continue;
      D.v[k] = D.v[k]! + 9.8 * delta;
      D.y[k] = D.y[k]! - D.v[k]! * delta;
      if (D.y[k]! <= D.floor[k]!) {
        spawnSplash(D.x[k]!, D.floor[k]! + 0.003, D.z[k]!, 0.8);
        D.y[k] = -10;
      }
      da[k * 4] = D.x[k]!;
      da[k * 4 + 1] = D.y[k]!;
      da[k * 4 + 2] = D.z[k]!;
      da[k * 4 + 3] = D.v[k]!;
    }
    drops.a.needsUpdate = true;
    if (spawned) {
      S.p.needsUpdate = true;
      S.sz.needsUpdate = true;
    }
    const sm = skyRef.current;
    if (sm) sm.position.copy(cp);
  });

  return (
    <>
      {/* the cloud deck rides with the camera (and shows in the street's reflection) */}
      <mesh
        ref={skyRef}
        geometry={sky.g}
        material={sky.m}
        frustumCulled={false}
        renderOrder={1}
        visible={false}
      />
      <group ref={group} visible={false}>
        <mesh geometry={streaks.g} material={streaks.m} frustumCulled={false} renderOrder={20} />
        <mesh geometry={drops.g} material={drops.m} frustumCulled={false} renderOrder={20} />
        <mesh geometry={splashes.g} material={splashes.m} frustumCulled={false} renderOrder={19} />
      </group>
    </>
  );
}
