import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { holdQuality } from "./quality";

export type Preparation = {
  phase: "preparing" | "ready" | "error";
  completed: number;
  total: number;
  error?: string;
};
const warmLog: {
  frame: number;
  ms: number;
  wallMs: number;
  maxStepMs: number;
  programs: number;
  before: number;
  passes: number[];
}[] = [];
if (typeof window !== "undefined") (window as unknown as { __rsWarm?: unknown }).__rsWarm = warmLog;

/** Prepare each lighting/output variant separately. Safari still needs an actual draw
 * after compilation. All temporary scene/renderer changes are restored in the same tick;
 * asynchronous completion never owns live scene state. */
export function Prewarm({
  when,
  withSpot = false,
  withTarget = false,
  onProgress,
}: {
  when: number;
  withSpot?: boolean;
  withTarget?: boolean;
  onProgress: (seed: number, state: Preparation) => void;
}) {
  const { gl, scene, camera } = useThree();
  const [generation, setGeneration] = useState(0);
  const notify = useRef(onProgress);
  notify.current = onProgress;
  const job = useRef<{
    seed: number;
    cancelled: boolean;
    compiling: boolean;
    compiled: boolean;
    index: number;
    variants: { spot: boolean; target: boolean }[];
    passes: number[];
    before: number;
    started: number;
    steps: number[];
    activeMs: number;
    rt: THREE.WebGLRenderTarget | null;
    spot: THREE.SpotLight | null;
  } | null>(null);
  useEffect(() => {
    const variants = [{ spot: false, target: false }];
    if (withTarget) variants.push({ spot: false, target: true });
    if (withSpot) {
      variants.push({ spot: true, target: false });
      if (withTarget) variants.push({ spot: true, target: true });
    }
    const j = {
      seed: when,
      cancelled: false,
      compiling: false,
      compiled: false,
      index: 0,
      variants,
      passes: [] as number[],
      before: gl.info.programs?.length ?? 0,
      started: performance.now(),
      steps: [] as number[],
      activeMs: 0,
      rt: withTarget
        ? new THREE.WebGLRenderTarget(64, 64, { type: THREE.HalfFloatType, depthBuffer: true })
        : null,
      spot: withSpot ? new THREE.SpotLight("#ffffff", 0) : null,
    };
    job.current = j;
    holdQuality(2000);
    notify.current(when, { phase: "preparing", completed: 0, total: variants.length });
    return () => {
      j.cancelled = true;
      j.rt?.dispose();
      j.spot?.dispose();
      if (job.current === j) job.current = null;
    };
  }, [when, withSpot, withTarget, gl, generation]);
  useEffect(() => {
    const lost = () => {
      if (job.current) job.current.cancelled = true;
      notify.current(when, {
        phase: "error",
        completed: 0,
        total: 0,
        error: "Graphics context lost",
      });
    };
    const restored = () => setGeneration((g) => g + 1);
    gl.domElement.addEventListener("webglcontextlost", lost);
    gl.domElement.addEventListener("webglcontextrestored", restored);
    return () => {
      gl.domElement.removeEventListener("webglcontextlost", lost);
      gl.domElement.removeEventListener("webglcontextrestored", restored);
    };
  }, [gl, when]);

  useFrame((_, delta) => {
    const j = job.current;
    if (!j || j.seed !== when || j.cancelled || j.index >= j.variants.length) return;
    holdQuality(2000);
    if (!document.hidden) j.activeMs += Math.min(delta * 1000, 1000);
    if (j.activeMs > 30000) {
      j.cancelled = true;
      notify.current(when, {
        phase: "error",
        completed: j.index,
        total: j.variants.length,
        error: "Preparation timed out",
      });
      return;
    }
    if (j.compiling) return;
    const stepStarted = performance.now();
    const variant = j.variants[j.index]!;
    const visible: THREE.Object3D[] = [],
      culled: THREE.Object3D[] = [];
    const previousTarget = gl.getRenderTarget();
    const previousWarm = scene.userData["scrapfallPrewarm"];
    let compilation: Promise<unknown> | undefined;
    const fail = (error: unknown) => {
      if (j.cancelled) return;
      j.cancelled = true;
      notify.current(when, {
        phase: "error",
        completed: j.index,
        total: j.variants.length,
        error: error instanceof Error ? error.message : String(error),
      });
    };
    try {
      scene.userData["scrapfallPrewarm"] = true;
      scene.traverse((o) => {
        if (!o.visible) {
          o.visible = true;
          visible.push(o);
        }
        if (o.frustumCulled) {
          o.frustumCulled = false;
          culled.push(o);
        }
      });
      if (variant.spot && j.spot) scene.add(j.spot);
      gl.setRenderTarget(variant.target ? j.rt : previousTarget);
      if (!j.compiled) {
        j.compiling = true;
        compilation = gl.compileAsync(scene, camera);
      } else {
        const t = performance.now();
        gl.render(scene, camera);
        j.passes.push(performance.now() - t);
        j.index++;
        j.compiled = false;
        const ready = j.index === j.variants.length;
        notify.current(when, {
          phase: ready ? "ready" : "preparing",
          completed: j.index,
          total: j.variants.length,
        });
      }
    } catch (error) {
      fail(error);
    } finally {
      gl.setRenderTarget(previousTarget);
      if (j.spot) scene.remove(j.spot);
      for (const o of visible) o.visible = false;
      for (const o of culled) o.frustumCulled = true;
      if (previousWarm === undefined) delete scene.userData["scrapfallPrewarm"];
      else scene.userData["scrapfallPrewarm"] = previousWarm;
    }
    j.steps.push(performance.now() - stepStarted);
    if (!j.cancelled && j.index === j.variants.length) {
      warmLog.push({
        frame: gl.info.render.frame,
        ms: Math.round(j.steps.reduce((a, b) => a + b, 0)),
        wallMs: performance.now() - j.started,
        maxStepMs: Math.max(...j.steps),
        programs: gl.info.programs?.length ?? 0,
        before: j.before,
        passes: [...j.passes],
      });
      if (warmLog.length > 20) warmLog.shift();
      j.rt?.dispose();
      j.rt = null;
      j.spot?.dispose();
      j.spot = null;
    }
    compilation?.then(() => {
      if (!j.cancelled) {
        j.compiling = false;
        j.compiled = true;
      }
    }, fail);
  }, -999);
  return null;
}
