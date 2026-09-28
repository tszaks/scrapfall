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
import type * as THREE from "three";

const warmLog: { frame: number; ms: number; programs: number; before: number }[] = [];
if (typeof window !== "undefined") (window as unknown as { __rsWarm?: unknown }).__rsWarm = warmLog;

export function Prewarm({ when, delay = 20 }: { when: unknown; delay?: number }) {
  const { gl, scene, camera } = useThree();
  const left = useRef(delay);
  useEffect(() => {
    left.current = delay;
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
    try {
      gl.render(scene, camera);
    } finally {
      for (const o of shown) o.visible = false;
      for (const o of culled) o.frustumCulled = true;
    }
    warmLog.push({ frame: gl.info.render.frame, ms: Math.round(performance.now() - t0), programs: gl.info.programs?.length ?? 0, before });
  }, -999);
  return null;
}
