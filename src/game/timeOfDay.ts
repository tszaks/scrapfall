import * as THREE from "three";
/** Fixed daylight look feeding the ported robot materials (our maps have no day cycle). */
export const todFrame = { version: 1, lastK: -1 };
export const liveLook = {
  hemiSky: new THREE.Color("#cfe0ff"),
  hemiGround: new THREE.Color("#6a5a48"),
  hemiI: 1.1,
  sunDir: new THREE.Vector3(0.4, 0.8, 0.3),
  sunColor: new THREE.Color("#fff1dc"),
  sunI: 1.6,
};
