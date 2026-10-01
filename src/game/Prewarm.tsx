// Shader pre-warm: draws the whole scene once, everything visible and nothing culled, a few
// frames after a map is built, so every material's GPU program (and, on Safari/Metal, its
// pipeline) exists before the player walks into it.
//
// Without it a material compiles the first time it comes into view, and that frame stalls:
// 150-200 ms hitches were measured walking Dry Gulch and at the start of the pier's wave surge
// (WebKit compiles on first draw, so three's `compile()` alone doesn't help there: the draw
// is what matters).
//
// The warm is spread over several frames instead of one giant one: drawables are sliced into
// batches, tagged onto a private layer for one frame each, and drawn with a camera that sees
// only that layer — so each warm frame compiles a slice of the scene's programs. It all runs
// before the normal render of the same frame, which overwrites it, so it is never seen
// (during loading the veil covers the canvas anyway).
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";

import { holdQuality } from "./quality";

const warmLog: { frame: number; ms: number; programs: number; before: number }[] = [];
if (typeof window !== "undefined") (window as unknown as { __rsWarm?: unknown }).__rsWarm = warmLog;

/** layer tag for the object slice being warmed this frame (the game uses no layers) */
const WARM_LAYER = 20;
/** groups drawables whose draw shares one driver program (material + light-dependence) */
const matIds = new WeakMap<THREE.Material, number>();
let nextMatId = 1;
function materialKey(o: Drawable): number {
  const m = (o as THREE.Mesh).material;
  const one = Array.isArray(m) ? m[0] : m;
  if (!one) return 0;
  let id = matIds.get(one);
  if (!id) matIds.set(one, (id = nextMatId++));
  return id;
}
/** how many frames a warm run spreads over — finer slices keep each warm task small even
 *  when a batch carries several driver program links (throttled CPU makes links pricey) */
const BATCHES = 16;

type Drawable = THREE.Object3D & {
  isMesh?: boolean;
  isSprite?: boolean;
  isLine?: boolean;
  isPoints?: boolean;
};

type Plan = {
  /** countdown before the warm frames start */
  left: number;
  /** drawable slices, or null until the first warm frame builds them */
  batches: THREE.Object3D[][] | null;
  /** lights ride on the warm layer for the whole run so the compiles see real lighting */
  lights: THREE.Object3D[];
  i: number;
  cam: THREE.Camera | null;
  rt: THREE.WebGLRenderTarget | null;
  spot: THREE.SpotLight | null;
  /** wall-clock start: a slow GPU caps the run instead of holding the veil up forever */
  t0: number;
  done: boolean;
};

const idle = (delay: number): Plan => ({
  left: delay,
  batches: null,
  lights: [],
  i: 0,
  cam: null,
  rt: null,
  spot: null,
  t0: performance.now(),
  done: false,
});

/** the frame-count delay before warming starts is also wall-clock bounded (slow GPUs
 *  render few frames per second; the veil must not wait on them) */
const DELAY_CAP_MS = 1200;
/** the whole warm run caps out here — batches left unwarmed compile lazily, as before */
const WARM_CAP_MS = 3500;

/**
 * `withSpot`: also draw each batch once more with a (dark) spot light in the scene: the
 * blackout's flashlight is a spot light, and every lit material needs a variant for it.
 * Compiling them is not enough on Safari/Metal: the first real draw still builds the
 * pipelines (a 0.5-1.7 s freeze at the blackout's first dark frame), so they are drawn here,
 * unseen.
 */
export function Prewarm({
  when,
  delay = 20,
  withSpot = false,
  withTarget = false,
  batches = BATCHES,
  onDone,
}: {
  when: unknown;
  delay?: number;
  withSpot?: boolean;
  /** also draw into an HDR render target (the city's rain mirror) */
  withTarget?: boolean;
  /** frames the warm spreads over */
  batches?: number;
  /** after the last warm frame (fires once per `when`) */
  onDone?: () => void;
}) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const plan = useRef<Plan>(idle(delay));
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => {
    const p = idle(delay);
    plan.current = p;
    // the map's first seconds (and this warm run) are slow by design: keep AUTO from reacting
    holdQuality(8000);
    return () => {
      for (const l of p.lights) l.layers.disable(WARM_LAYER);
      p.rt?.dispose();
      p.spot?.dispose();
    };
  }, [when, delay]);
  useFrame(() => {
    const p = plan.current;
    if (p.done) return;
    if (p.left-- > 0 && performance.now() - p.t0 < DELAY_CAP_MS) return;
    const t0 = performance.now();
    const before = gl.info.programs?.length ?? 0;
    if (!p.batches) {
      const drawables: Drawable[] = [];
      scene.traverse((o) => {
        const l = o as THREE.Light;
        if (l.isLight) p.lights.push(o);
        else {
          const d = o as Drawable;
          if (d.isMesh || d.isSprite || d.isLine || d.isPoints) drawables.push(d);
        }
      });
      // order by material so a batch shares programs: the driver's program links land a
      // few per warm frame instead of piling onto whichever batch draws first
      drawables.sort((a, b) => materialKey(a) - materialKey(b));
      const slices: THREE.Object3D[][] = [];
      drawables.forEach((o, i) =>
        (slices[Math.min(batches - 1, Math.floor((i * batches) / drawables.length))] ??= []).push(
          o,
        ),
      );
      p.batches = slices;
      for (const l of p.lights) l.layers.enable(WARM_LAYER);
      const cam = camera.clone();
      cam.layers.set(WARM_LAYER);
      p.cam = cam;
      // the wet streets' mirror renders the scene into a linear HDR target: every material
      // needs a second (linear output) variant, compiled the first time it rains otherwise
      p.rt = withTarget
        ? new THREE.WebGLRenderTarget(64, 64, { type: THREE.HalfFloatType, depthBuffer: true })
        : null;
      p.spot = withSpot ? new THREE.SpotLight("#ffffff", 0) : null;
      if (p.spot) p.spot.layers.set(WARM_LAYER);
    }
    const batch = p.batches[p.i];
    const prevRT = gl.getRenderTarget();
    const previousWarm = scene.userData["scrapfallPrewarm"];
    const shown: THREE.Object3D[] = [];
    const culled: THREE.Object3D[] = [];
    try {
      scene.userData["scrapfallPrewarm"] = true;
      if (batch) {
        const cam = p.cam!;
        for (const o of batch) {
          o.layers.enable(WARM_LAYER);
          if (o.frustumCulled) {
            o.frustumCulled = false;
            culled.push(o);
          }
          // invisible ancestors would still keep the batch out of the draw
          for (let a: THREE.Object3D | null = o; a; a = a.parent)
            if (!a.visible) {
              a.visible = true;
              shown.push(a);
            }
        }
        gl.render(scene, cam);
        if (p.rt) {
          gl.setRenderTarget(p.rt);
          gl.render(scene, cam);
          gl.setRenderTarget(prevRT);
        }
        if (p.spot) {
          scene.add(p.spot);
          gl.render(scene, cam);
          if (p.rt) {
            gl.setRenderTarget(p.rt);
            gl.render(scene, cam);
            gl.setRenderTarget(prevRT);
          }
          scene.remove(p.spot);
        }
      }
    } finally {
      gl.setRenderTarget(prevRT);
      if (p.spot) scene.remove(p.spot);
      if (previousWarm === undefined) delete scene.userData["scrapfallPrewarm"];
      else scene.userData["scrapfallPrewarm"] = previousWarm;
      for (const o of batch ?? []) o.layers.disable(WARM_LAYER);
      for (const o of shown) o.visible = false;
      for (const o of culled) o.frustumCulled = true;
    }
    warmLog.push({
      frame: gl.info.render.frame,
      ms: Math.round(performance.now() - t0),
      programs: gl.info.programs?.length ?? 0,
      before,
    });
    if (warmLog.length > 128) warmLog.splice(0, warmLog.length - 128);
    if (++p.i >= p.batches.length || t0 - p.t0 > WARM_CAP_MS) {
      p.done = true;
      for (const l of p.lights) l.layers.disable(WARM_LAYER);
      p.rt?.dispose();
      p.spot?.dispose();
      onDoneRef.current?.();
    }
  }, -999);
  return null;
}
