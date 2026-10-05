import { useFrame, type RenderCallback } from "@react-three/fiber";
import { useRef } from "react";
import { simulationPause } from "./simulationPause";

/** Keep rendering and network health alive while gameplay holds still. Each
 * callback drops the first delta after a transition, including a hidden-tab gap. */
export function useSimulationFrame(callback: RenderCallback, priority?: number) {
  const revision = useRef(simulationPause.revision);
  useFrame((state, delta, frame) => {
    if (simulationPause.paused) return;
    const resumed = revision.current !== simulationPause.revision;
    revision.current = simulationPause.revision;
    callback(state, resumed ? 0 : delta, frame);
  }, priority);
}
