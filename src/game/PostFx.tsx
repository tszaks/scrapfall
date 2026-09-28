// Post-processing overlay: the frame is finished by the normal canvas render, then a
// soft bloom is layered on top of it — the displayed image is copied once, the bright
// parts (lamps, neon, lit windows, the sun) are picked out and blurred at a fraction
// of the resolution, and the result is drawn back as an additive glow.
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

import { quality } from "./quality";

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

// keep the bright parts; saturated colours pass a little easier than grey ones so the
// neon signs glow before the pale sky does
const BRIGHT_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform float uTh;
uniform float uKnee;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float mx = max(c.r, max(c.g, c.b));
  float w = smoothstep(uTh, uTh + uKnee, max(l, mx * 0.72));
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

const COPY_FRAG = /* glsl */ `
uniform sampler2D tSrc;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(tSrc, vUv); }`;

// additive glow: writes raw values on top of the displayed frame (tone-mapped space)
const MIX_FRAG = /* glsl */ `
uniform sampler2D tA;
uniform sampler2D tB;
uniform vec2 uW;
varying vec2 vUv;
void main() {
  vec3 g = texture2D(tA, vUv).rgb * uW.x + texture2D(tB, vUv).rgb * uW.y;
  gl_FragColor = vec4(g, 1.0);
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
  copy: THREE.ShaderMaterial;
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
  });
  const blurH = mat(BLUR_FRAG, {
    tSrc: { value: null },
    uDir: { value: new THREE.Vector2() },
  });
  const blurV = mat(BLUR_FRAG, {
    tSrc: { value: null },
    uDir: { value: new THREE.Vector2() },
  });
  const copy = mat(COPY_FRAG, { tSrc: { value: null } });
  const mix = mat(
    MIX_FRAG,
    { tA: { value: null }, tB: { value: null }, uW: { value: new THREE.Vector2(0.78, 0.68) } },
    true,
  );
  parts = { quad, mesh, cam, geo, bright, blurH, blurV, copy, mix };
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
    // grab the finished frame (a device-side blit; the multisample canvas resolves)
    gl.copyFramebufferToTexture(k.tex);
    const ctx = gl.getContext();
    if (ctx.getError() !== ctx.NO_ERROR) {
      bad = true;
      console.warn("post: framebuffer copy unsupported, bloom disabled");
      return;
    }
    gl.autoClear = false;
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
      p.copy.uniforms["tSrc"]!.value = k.rtA.texture;
      run(p.copy, k.rtC);
      p.blurH.uniforms["tSrc"]!.value = k.rtC.texture;
      (p.blurH.uniforms["uDir"]!.value as THREE.Vector2).set(1 / k.rtC.width, 0);
      run(p.blurH, k.rtD);
      p.blurV.uniforms["tSrc"]!.value = k.rtD.texture;
      (p.blurV.uniforms["uDir"]!.value as THREE.Vector2).set(0, 1 / k.rtC.height);
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
        for (const m of [p.bright, p.blurH, p.blurV, p.copy, p.mix]) m.dispose();
      }
      const k = kit;
      kit = null;
      if (k) {
        for (const rt of [k.rtA, k.rtB, k.rtC, k.rtD]) rt.dispose();
        k.tex.dispose();
      }
      bad = false;
    },
    [],
  );
  return null;
}
