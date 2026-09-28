// Shader pre-warm: draws the whole scene once, everything visible and nothing culled, a few
// frames after a map is built, so every material's GPU program (and, on Safari/Metal, its
// pipeline) exists before the player walks into it.
//
// Without it a material compiles the first time it comes into view, and that frame stalls:
// 150-200 ms hitches were measured walking Dry Gulch and at the start of the pier's wave surge
// (WebKit compiles on first draw, so three's `compile()` alone doesn't help there: the draw
// is what matters). The warm frame runs before the normal render of the same frame, which
// overwrites it, so it is never seen.
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";

import { holdQuality } from "./quality";

const warmLog: { frame: number; ms: number; programs: number; before: number }[] = [];
if (typeof window !== "undefined") (window as unknown as { __rsWarm?: unknown }).__rsWarm = warmLog;

/**
 * `withSpot`: also draw it once more with a (dark) spot light in the scene: the blackout's
 * flashlight is a spot light, and every lit material needs a variant for it. Compiling them
 * is not enough on Safari/Metal: the first real draw still builds the pipelines (a 0.5-1.7 s
 * freeze at the blackout's first dark frame), so they are drawn here, unseen.
 */
export function Prewarm({
  when,
  delay = 20,
  withSpot = false,
  withTarget = false,
}: {
  when: unknown;
  delay?: number;
  withSpot?: boolean;
  /** also draw into an HDR render target (the city's rain mirror) */
  withTarget?: boolean;
}) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const left = useRef(delay);
  useEffect(() => {
    left.current = delay;
    // the map's first seconds (and this warm frame) are slow by design: keep AUTO from reacting
    holdQuality(8000);
  }, [when, delay]);
  useFrame(() => {
    if (left.current < 0) return;
    if (left.current-- > 0) return;
    const t0 = performance.now();
    const before = gl.info.programs?.length ?? 0;
    const shown: THREE.Object3D[] = [];
    const culled: THREE.Object3D[] = [];
    scene.traverse((o) => {
      if (!o.visible) {
        o.visible = true;
        shown.push(o);
      }
      if (o.frustumCulled) {
        o.frustumCulled = false;
        culled.push(o);
      }
    });
    const spot = withSpot ? new THREE.SpotLight("#ffffff", 0) : null;
    // the wet streets' mirror renders the scene into a linear HDR target: every material needs
    // a second (linear output) variant, compiled the first time it rains at night otherwise
    const rt = withTarget
      ? new THREE.WebGLRenderTarget(64, 64, { type: THREE.HalfFloatType, depthBuffer: true })
      : null;
    const prevRT = gl.getRenderTarget();
    try {
      gl.render(scene, camera);
      if (rt) {
        gl.setRenderTarget(rt);
        gl.render(scene, camera);
        gl.setRenderTarget(prevRT);
      }
      if (spot) {
        scene.add(spot);
        gl.render(scene, camera);
        if (rt) {
          gl.setRenderTarget(rt);
          gl.render(scene, camera);
          gl.setRenderTarget(prevRT);
        }
      }
    } finally {
      gl.setRenderTarget(prevRT);
      rt?.dispose();
      if (spot) {
        scene.remove(spot);
        spot.dispose();
      }
      for (const o of shown) o.visible = false;
      for (const o of culled) o.frustumCulled = true;
    }
    warmLog.push({
      frame: gl.info.render.frame,
      ms: Math.round(performance.now() - t0),
      programs: gl.info.programs?.length ?? 0,
      before,
    });
  }, -999);
  return null;
}
