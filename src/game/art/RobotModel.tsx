// React side of the skinned robots: one RobotRig per enemy slot, posed every frame from the
// enemy's synced state (position, facing is on the parent group, telegraph values here).
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import type * as THREE from "three";

import { artFrame } from "./kit";
import { RobotRig, robotMaterial, type RobotKind } from "./rig";

/** the enemy fields the robots read (a structural subset of Game.tsx's Enemy) */
export type RobotData = {
  x: number;
  z: number;
  alive: boolean;
  flash: number;
  elite?: number;
  swing?: number;
  cooldown?: number;
  shot?: number;
  aux?: number;
  vis?: number;
  kind?: string;
};

export type RobotInputs = (d: RobotData) => { wind: number; aux: number };
const NONE = { wind: 0, aux: 0 };

/**
 * Draw `kind` for enemy `data`. `inputs` maps the enemy state to the attack wind-up and a
 * per-kind value; `onPose` runs after the bones are posed (for extra meshes that follow them).
 */
export function RobotModel({
  kind,
  data,
  inputs,
  wear,
  gait = 1,
  onPose,
}: {
  kind: RobotKind;
  data: RobotData;
  inputs?: RobotInputs;
  wear?: number;
  /** stride scale (a robot drawn at 0.6x takes shorter steps) */
  gait?: number;
  onPose?: (rig: RobotRig, state: { camera: THREE.Camera }) => void;
}) {
  const rig = useMemo(
    () => new RobotRig(kind, robotMaterial("base", wear ?? kind.def.wear ?? 0.75)),
    [kind, wear],
  );
  useEffect(() => () => rig.dispose(), [rig]);
  useFrame((state, delta) => {
    if (!data.alive) {
      rig.reset();
      return;
    }
    artFrame();
    const cam = state.camera.position;
    const d = Math.hypot(cam.x - data.x, cam.z - data.z);
    const inp = inputs ? inputs(data) : NONE;
    rig.update(
      state.clock.elapsedTime,
      Math.min(delta, 0.05),
      data.x,
      data.z,
      inp.wind,
      inp.aux,
      d,
      gait,
    );
    const w = wear ?? kind.def.wear ?? 0.75;
    const want =
      data.flash > 0
        ? robotMaterial("hot", w)
        : data.elite
          ? robotMaterial("elite", w)
          : robotMaterial("base", w);
    if (rig.mesh.material !== want) rig.mesh.material = want;
    onPose?.(rig, state);
  });
  return <primitive object={rig.mesh} />;
}
