// Post-processing overlay: the frame is finished by the normal canvas render, then a
// soft bloom is layered on top of it — the displayed image is copied once, the bright
// parts (lamps, neon, lit windows, the sun) are picked out and blurred at a fraction
// of the resolution, and the result is drawn back as an additive glow.
// In daylight matches (sunny/rain) the bright-pass threshold rises past sunlit
// diffuse surfaces and the overlay fades to a whisper, so bloom only ever comes from
// genuine emitters: lamps, neon, lit windows, muzzle flashes, the moon and sun disc.
//
// Working on the displayed (already tone-mapped) image means none of the hand-tuned
// materials, custom shaders or skies change their look: the pass only adds light.
// The copy+blur+add is a handful of tiny fullscreen draws — far cheaper than
// re-rendering the scene into an HDR target.
//
// IMPORTANT: the scene must render exactly once per frame. PlayerView owns the final
// render (its priority useFrame, with the third-person viewCamera when active) and
// calls `renderWithPost` instead of `gl.render` — a parallel render pass would either
// wipe this overlay or double the frame's cost. `quality().spec.bloom` picks
// 0 = off (a straight gl.render, nothing else), 1 = one quarter-res glow scale,
// 2 = a second wider eighth-res halo on top. `?post=0..2` forces a level (testing).
import { useEffect } from "react";
import * as THREE from "three";

import { matchEnvironment } from "./matchEnvironment";
import { quality } from "./quality";

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

// keep the bright parts — but only genuine emitters: pixels must either carry a
// colour cast (neon, lit windows, muzzle flash) or sit near the clip (sun/moon disc),
// so pale diffuse surfaces (moonlit snow, sand, sky) can never bloom. In daylight
// (uDay) the threshold rises further and the overlay fades, so sunlit scenes keep
// their contrast and even true emitters read only faintly.
const BRIGHT_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform float uTh;
uniform float uKnee;
uniform float uDay;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb;
  float th = mix(uTh, 0.96, uDay);
  float kn = uKnee * (1.0 - uDay * 0.85);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float sat = (mx - mn) / max(mx, 0.001);
  // emitters carry a colour cast (neon, warm windows) or sit near the clip
  // (sun/moon disc, blown highlights); moonlit snow and other pale diffuse
  // surfaces are desaturated and must not bloom even when bright
  float emis = max(smoothstep(0.9, 0.97, l), smoothstep(0.28, 0.45, sat));
  float w = smoothstep(th, th + kn, max(l, mx * 0.72)) * emis;
  gl_FragColor = vec4(c * w, 1.0);
}`;

// 5-sample gaussian pair (linear-sampled): uDir is one source texel per step
const BLUR_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb * 0.227027;
  c += (texture2D(tSrc, vUv + uDir * 1.384615) + texture2D(tSrc, vUv - uDir * 1.384615)).rgb * 0.316216;
  c += (texture2D(tSrc, vUv + uDir * 3.230769) + texture2D(tSrc, vUv - uDir * 3.230769)).rgb * 0.070270;
  gl_FragColor = vec4(c, 1.0);
}`;

// additive glow: writes raw values on top of the displayed frame (tone-mapped space);
// daylight (uDay) fades the overlay so sunlit scenes keep their contrast
const MIX_FRAG = /* glsl */ `
uniform sampler2D tA;
uniform sampler2D tB;
uniform vec2 uW;
uniform float uDay;
varying vec2 vUv;
void main() {
  vec3 g = texture2D(tA, vUv).rgb * uW.x + texture2D(tB, vUv).rgb * uW.y;
  gl_FragColor = vec4(g * (1.0 - uDay * 0.88), 1.0);
}`;

function mat(frag: string, uniforms: Record<string, THREE.IUniform>, additive = false) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: QUAD_VERT,
    fragmentShader: frag,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    fog: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NoBlending,
    transparent: additive,
  });
}

const forced = (() => {
  if (typeof window === "undefined") return null;
  const v = new URLSearchParams(window.location.search).get("post");
  if (v === "0" || v === "1" || v === "2") return Number(v);
  return null;
})();

function postLevel() {
  return forced ?? quality().spec.bloom;
}

type Parts = {
  quad: THREE.Scene;
  mesh: THREE.Mesh;
  cam: THREE.Camera;
  geo: THREE.BufferGeometry;
  bright: THREE.ShaderMaterial;
  blurH: THREE.ShaderMaterial;
  blurV: THREE.ShaderMaterial;
  mix: THREE.ShaderMaterial;
};
type Kit = {
  tex: THREE.FramebufferTexture;
  rtA: THREE.WebGLRenderTarget;
  rtB: THREE.WebGLRenderTarget;
  rtC: THREE.WebGLRenderTarget;
  rtD: THREE.WebGLRenderTarget;
  w: number;
  h: number;
};

let parts: Parts | null = null;
let kit: Kit | null = null;
let bad = false;
let probed = false;

function getParts() {
  if (parts) return parts;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
  );
  const quad = new THREE.Scene();
  const mesh = new THREE.Mesh(geo);
  mesh.frustumCulled = false;
  quad.add(mesh);
  const cam = new THREE.Camera();
  const bright = mat(BRIGHT_FRAG, {
    tSrc: { value: null },
    uTh: { value: 0.66 },
    uKnee: { value: 0.32 },
    uDay: { value: 0 },
  });
  const blurH = mat(BLUR_FRAG, {
    tSrc: { value: null },
    uDir: { value: new THREE.Vector2() },
  });
  const blurV = mat(BLUR_FRAG, {
    tSrc: { value: null },
    uDir: { value: new THREE.Vector2() },
  });
  const mix = mat(
    MIX_FRAG,
    {
      tA: { value: null },
      tB: { value: null },
      uW: { value: new THREE.Vector2(0.78, 0.68) },
      uDay: { value: 0 },
    },
    true,
  );
  parts = { quad, mesh, cam, geo, bright, blurH, blurV, mix };
  return parts;
}

function ensureKit(gl: THREE.WebGLRenderer, w: number, h: number) {
  if (kit && kit.w === w && kit.h === h) return kit;
  if (kit) {
    for (const rt of [kit.rtA, kit.rtB, kit.rtC, kit.rtD]) rt.dispose();
    kit.tex.dispose();
  }
  const opts = {
    depthBuffer: false,
    stencilBuffer: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  };
  const tex = new THREE.FramebufferTexture(w, h);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  kit = {
    tex,
    rtA: new THREE.WebGLRenderTarget(Math.ceil(w / 4), Math.ceil(h / 4), opts),
    rtB: new THREE.WebGLRenderTarget(Math.ceil(w / 4), Math.ceil(h / 4), opts),
    rtC: new THREE.WebGLRenderTarget(Math.ceil(w / 8), Math.ceil(h / 8), opts),
    rtD: new THREE.WebGLRenderTarget(Math.ceil(w / 8), Math.ceil(h / 8), opts),
    w,
    h,
  };
  return kit;
}

/**
 * The frame's one and only scene render, plus the bloom overlay on tiers that have it.
 * Called by PlayerView's priority useFrame with whichever camera is on screen.
 */
export function renderWithPost(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
) {
  gl.render(scene, camera);
  const level = postLevel();
  if (!level || bad) return;

  const size = gl.getDrawingBufferSize(new THREE.Vector2());
  const w = Math.max(1, Math.floor(size.x));
  const h = Math.max(1, Math.floor(size.y));
  const k = ensureKit(gl, w, h);
  const p = getParts();
  const run = (m: THREE.ShaderMaterial, rt: THREE.WebGLRenderTarget | null) => {
    p.mesh.material = m;
    gl.setRenderTarget(rt);
    gl.render(p.quad, p.cam);
  };

  const prevRT = gl.getRenderTarget();
  const prevClear = gl.autoClear;
  try {
    // grab the finished frame (a device-side copy; the multisample canvas resolves).
    // a scaled blit would be cheaper but WebGL2 forbids downscaling blits out of a
    // multisampled default framebuffer. the support probe runs exactly once —
    // getError forces a GPU sync each call
    gl.copyFramebufferToTexture(k.tex);
    if (!probed) {
      probed = true;
      const ctx = gl.getContext();
      if (ctx.getError() !== ctx.NO_ERROR) {
        bad = true;
        console.warn("post: framebuffer copy unsupported, bloom disabled");
        return;
      }
    }
    gl.autoClear = false;
    // daylight matches run a high threshold and a faint overlay: sunlit surfaces
    // stay under the knee and only true emitters (and the sun itself) still pass
    const day = matchEnvironment.kind === "sunny" || matchEnvironment.kind === "rain" ? 1 : 0;
    p.bright.uniforms["uDay"]!.value = day;
    p.mix.uniforms["uDay"]!.value = day;
    p.bright.uniforms["tSrc"]!.value = k.tex;
    run(p.bright, k.rtA);
    const tx = 1 / k.rtA.width;
    const ty = 1 / k.rtA.height;
    p.blurH.uniforms["tSrc"]!.value = k.rtA.texture;
    (p.blurH.uniforms["uDir"]!.value as THREE.Vector2).set(tx, 0);
    run(p.blurH, k.rtB);
    p.blurV.uniforms["tSrc"]!.value = k.rtB.texture;
    (p.blurV.uniforms["uDir"]!.value as THREE.Vector2).set(0, ty);
    run(p.blurV, k.rtA);
    if (level > 1) {
      // wider, softer halo: blur the quarter-res glow again into the eighth-res pair —
      // drawing into the smaller target halves the footprint, so no copy pass is needed
      p.blurH.uniforms["tSrc"]!.value = k.rtA.texture;
      (p.blurH.uniforms["uDir"]!.value as THREE.Vector2).set(2 * tx, 0);
      run(p.blurH, k.rtD);
      p.blurV.uniforms["tSrc"]!.value = k.rtD.texture;
      (p.blurV.uniforms["uDir"]!.value as THREE.Vector2).set(0, 2 * ty);
      run(p.blurV, k.rtC);
    }
    p.mix.uniforms["tA"]!.value = k.rtA.texture;
    p.mix.uniforms["tB"]!.value = level > 1 ? k.rtC.texture : null;
    (p.mix.uniforms["uW"]!.value as THREE.Vector2).set(0.78, level > 1 ? 0.68 : 0);
    run(p.mix, null);
  } finally {
    gl.setRenderTarget(prevRT);
    gl.autoClear = prevClear;
  }
}

/** Owns the module's GPU resources for as long as the canvas lives. Renders nothing. */
export function PostFx() {
  useEffect(
    () => () => {
      const p = parts;
      parts = null;
      if (p) {
        p.geo.dispose();
        for (const m of [p.bright, p.blurH, p.blurV, p.mix]) m.dispose();
      }
      const k = kit;
      kit = null;
      if (k) {
        for (const rt of [k.rtA, k.rtB, k.rtC, k.rtD]) rt.dispose();
        k.tex.dispose();
      }
      bad = false;
      probed = false;
    },
    [],
  );
  return null;
}
