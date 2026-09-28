// Post-processing overlay (post.ts used to live here): the frame is finished by the
// normal canvas render exactly as before; this then adds a soft bloom on top of it —
// the displayed image is copied once, the bright parts (lamps, neon, lit windows, the
// sun) are picked out and blurred at a fraction of the resolution, and the result is
// drawn back as an additive glow.
//
// Working on the displayed (already tone-mapped) image means none of the hand-tuned
// materials, custom shaders or skies change their look: the pass only adds light.
// The copy+blur+add is a handful of tiny draws — far cheaper than re-rendering the
// scene into an HDR target — so it stays within the frame budget the governor fights
// for. `quality().spec.bloom` picks 0 = off, 1 = one quarter-res glow scale,
// 2 = a second wider eighth-res halo on top. `?post=0..2` forces a level (testing).
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
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

type Kit = {
  tex: THREE.FramebufferTexture;
  rtA: THREE.WebGLRenderTarget;
  rtB: THREE.WebGLRenderTarget;
  rtC: THREE.WebGLRenderTarget;
  rtD: THREE.WebGLRenderTarget;
  w: number;
  h: number;
};

/**
 * Renders the scene to the canvas itself (taking over the frame so the overlay can
 * follow), then layers the bloom pass on top. Renders nothing visible of its own.
 */
export function PostFx() {
  const kit = useRef<Kit | null>(null);
  const bad = useRef(false);
  const parts = useMemo(() => {
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
    const blurH = mat(BLUR_FRAG, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
    const blurV = mat(BLUR_FRAG, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
    const copy = mat(COPY_FRAG, { tSrc: { value: null } });
    const mix = mat(
      MIX_FRAG,
      { tA: { value: null }, tB: { value: null }, uW: { value: new THREE.Vector2(0.62, 0.55) } },
      true,
    );
    return { geo, quad, mesh, cam, bright, blurH, blurV, copy, mix };
  }, []);

  useEffect(
    () => () => {
      parts.geo.dispose();
      for (const m of [parts.bright, parts.blurH, parts.blurV, parts.copy, parts.mix])
        m.dispose();
      const k = kit.current;
      if (k) {
        for (const rt of [k.rtA, k.rtB, k.rtC, k.rtD]) rt.dispose();
        k.tex.dispose();
      }
    },
    [parts],
  );

  useFrame((state) => {
    const { gl, scene, camera } = state;
    gl.render(scene, camera);
    const level = forced ?? quality().spec.bloom;
    if (!level || bad.current) return;

    const size = gl.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(1, Math.floor(size.x));
    const h = Math.max(1, Math.floor(size.y));
    let k = kit.current;
    if (!k || k.w !== w || k.h !== h) {
      if (k) {
        for (const rt of [k.rtA, k.rtB, k.rtC, k.rtD]) rt.dispose();
        k.tex.dispose();
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
      k = kit.current = {
        tex,
        rtA: new THREE.WebGLRenderTarget(Math.ceil(w / 4), Math.ceil(h / 4), opts),
        rtB: new THREE.WebGLRenderTarget(Math.ceil(w / 4), Math.ceil(h / 4), opts),
        rtC: new THREE.WebGLRenderTarget(Math.ceil(w / 8), Math.ceil(h / 8), opts),
        rtD: new THREE.WebGLRenderTarget(Math.ceil(w / 8), Math.ceil(h / 8), opts),
        w,
        h,
      };
    }

    const { quad, mesh, cam, bright, blurH, blurV, copy, mix } = parts;
    const run = (m: THREE.ShaderMaterial, rt: THREE.WebGLRenderTarget | null) => {
      mesh.material = m;
      gl.setRenderTarget(rt);
      gl.render(quad, cam);
    };

    const prevRT = gl.getRenderTarget();
    const prevClear = gl.autoClear;
    try {
      // grab the finished frame (a device-side blit; the multisample canvas resolves)
      gl.copyFramebufferToTexture(k.tex);
      const ctx = gl.getContext();
      if (ctx.getError() !== ctx.NO_ERROR) {
        bad.current = true;
        console.warn("post: framebuffer copy unsupported, bloom disabled");
        return;
      }
      gl.autoClear = false;
      bright.uniforms["tSrc"]!.value = k.tex;
      run(bright, k.rtA);
      const tx = 1 / k.rtA.width;
      const ty = 1 / k.rtA.height;
      blurH.uniforms["tSrc"]!.value = k.rtA.texture;
      (blurH.uniforms["uDir"]!.value as THREE.Vector2).set(tx, 0);
      run(blurH, k.rtB);
      blurV.uniforms["tSrc"]!.value = k.rtB.texture;
      (blurV.uniforms["uDir"]!.value as THREE.Vector2).set(0, ty);
      run(blurV, k.rtA);
      if (level > 1) {
        copy.uniforms["tSrc"]!.value = k.rtA.texture;
        run(copy, k.rtC);
        blurH.uniforms["tSrc"]!.value = k.rtC.texture;
        (blurH.uniforms["uDir"]!.value as THREE.Vector2).set(1 / k.rtC.width, 0);
        run(blurH, k.rtD);
        blurV.uniforms["tSrc"]!.value = k.rtD.texture;
        (blurV.uniforms["uDir"]!.value as THREE.Vector2).set(0, 1 / k.rtC.height);
        run(blurV, k.rtC);
      }
      mix.uniforms["tA"]!.value = k.rtA.texture;
      mix.uniforms["tB"]!.value = level > 1 ? k.rtC.texture : null;
      (mix.uniforms["uW"]!.value as THREE.Vector2).set(0.78, level > 1 ? 0.68 : 0);
      run(mix, null);
    } finally {
      gl.setRenderTarget(prevRT);
      gl.autoClear = prevClear;
    }
  }, 1);
  return null;
}
