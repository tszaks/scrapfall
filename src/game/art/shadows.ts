// Soft contact shadows under the robots: a dark radial blob on the ground below each one,
// so they stand on the street instead of floating over it. Every robot on the map shares
// one instanced quad (one transparent draw call); each RobotModel owns a slot.
import * as THREE from "three";

const MAX = 128;
let mesh: THREE.InstancedMesh | null = null;
let owner: THREE.Scene | null = null;
const free: number[] = [];
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

function blobTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(0,0,0,0.62)");
  grd.addColorStop(0.45, "rgba(0,0,0,0.42)");
  grd.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function build() {
  const mat = new THREE.MeshBasicMaterial({
    map: blobTexture(),
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    color: 0xffffff,
  });
  const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, MAX);
  im.frustumCulled = false;
  im.renderOrder = -1;
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < MAX; i++) {
    im.setMatrixAt(i, zero);
    free.push(MAX - 1 - i);
  }
  return im;
}

/** claim a shadow slot (or -1 when the pool is full) */
export function claimShadow(scene: THREE.Scene) {
  if (!mesh) mesh = build();
  if (owner !== scene) {
    owner?.remove(mesh);
    scene.add(mesh);
    owner = scene;
  }
  return free.pop() ?? -1;
}

export function releaseShadow(i: number) {
  if (i < 0 || !mesh) return;
  mesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
  mesh.instanceMatrix.needsUpdate = true;
  free.push(i);
}

/** place slot `i` at ground (x, y, z) with radius `r` (0 hides it) */
export function placeShadow(i: number, x: number, y: number, z: number, r: number) {
  if (i < 0 || !mesh) return;
  if (r <= 0) _m.makeScale(0, 0, 0);
  else _m.compose(_p.set(x, y + 0.04, z), _q, _s.set(r * 2, r * 2, 1));
  mesh.setMatrixAt(i, _m);
  mesh.instanceMatrix.needsUpdate = true;
}
