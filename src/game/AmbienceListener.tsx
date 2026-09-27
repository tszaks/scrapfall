// Feeds the camera (the player's ears) to the ambience every frame; the ambience throttles itself.
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { updateAmbience } from "./ambience";

const dir = new THREE.Vector3();

export function AmbienceListener() {
  const camera = useThree((s) => s.camera);
  useFrame(() => {
    camera.getWorldDirection(dir);
    updateAmbience(camera.position.x, camera.position.y, camera.position.z, dir.x, dir.z);
  });
  return null;
}
