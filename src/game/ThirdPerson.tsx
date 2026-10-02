// Optional over-the-shoulder camera: the game still runs from the player's eyes; only the
// rendered view is pulled back behind your own scavenger character, then put back after drawing.
import { createPortal, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";

import { newPlayerRig } from "@/bro/game/art/player";
import { GunView } from "@/bro/game/art/GunView";
import type { GunId } from "@/bro/game/art/guns";
import { padOpts } from "./binds";

const saved = new THREE.Vector3();
const back = new THREE.Vector3();

export function ThirdPersonCam({
  active,
  eye,
  weapon,
  look,
}: {
  active: boolean;
  eye: number;
  weapon: string;
  look: { color: string; body: string };
}) {
  const { scene, camera } = useThree();
  const rig = useMemo(newPlayerRig, []);
  const root = useMemo(() => new THREE.Group(), []);
  useEffect(() => {
    root.add(rig.mesh);
    return () => rig.dispose();
  }, [rig, root]);

  useEffect(() => {
    const before = scene.onBeforeRender;
    const after = scene.onAfterRender;
    let moved = false;
    scene.onBeforeRender = (...a) => {
      before.apply(scene, a);
      if (!padOpts.third || !active) return;
      saved.copy(camera.position);
      camera.getWorldDirection(back);
      camera.position.addScaledVector(back, -3.2).add(new THREE.Vector3(0, 0.55, 0));
      camera.updateMatrixWorld();
      moved = true;
    };
    scene.onAfterRender = (...a) => {
      after.apply(scene, a);
      if (!moved) return;
      camera.position.copy(saved);
      camera.updateMatrixWorld();
      moved = false;
    };
    return () => {
      scene.onBeforeRender = before;
      scene.onAfterRender = after;
    };
  }, [scene, camera, active]);

  useFrame((state, dt) => {
    root.visible = padOpts.third && active;
    if (!root.visible) return;
    const p = camera.position;
    const yaw = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ");
    root.position.set(p.x, p.y - eye, p.z);
    root.rotation.set(0, yaw.y + Math.PI, 0);
    rig.update(state.clock.elapsedTime, Math.min(dt, 0.05), p.x, p.z, 0, yaw.x, 0);
  }, -1);

  const hands = rig.bones[7];
  return (
    <>
      <primitive object={root} dispose={null} />
      {hands &&
        createPortal(
          <group position={[0.06, 0.02, 0.12]} rotation-y={Math.PI} scale={0.9}>
            <GunView w={weapon as GunId} color={look.color} body={look.body} animate={false} />
          </group>,
          hands,
        )}
    </>
  );
}
