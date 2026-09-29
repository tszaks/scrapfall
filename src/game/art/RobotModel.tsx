// React side of the skinned robots: one RobotRig per enemy slot, posed every frame from the
// enemy's synced state (position, facing is on the parent group, telegraph values here).
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import type * as THREE from "three";

import { groundY } from "../terrain";

import { debrisFrame, spawnDebris } from "./debris";
import { artFrame } from "./kit";
import { claimShadow, placeShadow, releaseShadow } from "./shadows";
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
  /** A render-only shader probe owns no gameplay effects or contact-shadow slot. */
  preview?: boolean;
};

export type RobotInputs = (d: RobotData, o: { wind: number; aux: number }) => void;
// per-frame scratch: `inputs` fills it and rig.update consumes it synchronously
const INP = { wind: 0, aux: 0 };

/** contact-shadow radius from the model's footprint (fliers get a smaller, fainter one) */
function footprint(kind: RobotKind) {
  const bb = kind.near.boundingBox ?? (kind.near.computeBoundingBox(), kind.near.boundingBox!);
  const r = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 0.42;
  return { r: bb.min.y > 0.5 ? r * 0.6 : r };
}

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
  noDebris = false,
}: {
  kind: RobotKind;
  data: RobotData;
  inputs?: RobotInputs;
  wear?: number;
  /** stride scale (a robot drawn at 0.6x takes shorter steps) */
  gait?: number;
  onPose?: (rig: RobotRig, state: { camera: THREE.Camera }) => void;
  /** skip the break-apart burst on death (previews, or kinds with their own death) */
  noDebris?: boolean;
}) {
  const rig = useMemo(
    () => new RobotRig(kind, robotMaterial("base", wear ?? kind.def.wear ?? 0.75)),
    [kind, wear],
  );
  useEffect(() => () => rig.dispose(), [rig]);
  const wasAlive = useRef(false);
  const scene = useThree((st) => st.scene);
  const shadow = useRef(-1);
  useEffect(() => {
    if (data.preview) return;
    shadow.current = claimShadow(scene);
    return () => {
      releaseShadow(shadow.current);
      shadow.current = -1;
    };
  }, [scene, data.preview]);
  const foot = useMemo(() => footprint(kind), [kind]);
  useFrame((state, delta) => {
    if (data.preview) return;
    debrisFrame(state.gl.info.render.frame, Math.min(delta, 0.05));
    if (!data.alive) {
      // it just died: break it into chunks where it stood
      if (wasAlive.current && !noDebris) {
        const g = rig.mesh.parent;
        const y = g ? g.position.y : 0;
        spawnDebris(state.scene, kind, data.x, y, data.z, g ? g.scale.x : 1);
      }
      wasAlive.current = false;
      rig.reset();
      placeShadow(shadow.current, 0, 0, 0, 0);
      return;
    }
    wasAlive.current = true;
    artFrame();
    const cam = state.camera.position;
    const d = Math.hypot(cam.x - data.x, cam.z - data.z);
    const inp = INP;
    if (inputs) inputs(data, inp);
    else {
      inp.wind = 0;
      inp.aux = 0;
    }
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
    const g = rig.mesh.parent;
    if (g && g.visible) {
      const k = g.scale.x;
      placeShadow(
        shadow.current,
        data.x,
        groundY(data.x, data.z),
        data.z,
        foot.r * k * (d > 70 ? 0 : 1),
      );
    } else placeShadow(shadow.current, 0, 0, 0, 0);
  });
  return <primitive object={rig.mesh} />;
}
