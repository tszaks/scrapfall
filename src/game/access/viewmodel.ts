// Keeps the gun viewmodel from clipping into the walls of tight interiors (the elevator car is
// 2.2 m wide; the gun reaches ~0.9 m in front of the eye). While enabled, the gun is drawn last
// against a cleared depth buffer: a tiny marker drawn just before it clears depth, the gun's
// own parts still depth-test against each other. Outside interiors nothing changes.
import * as THREE from "three";

const ON_TOP = 10000;
const marked = new WeakMap<THREE.Group, THREE.Mesh>();
const saved = new WeakMap<THREE.Material, boolean>();

function marker() {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0.001, 0, 0, 0, 0.001, 0], 3));
  const m = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false, transparent: true });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = ON_TOP - 1;
  mesh.onBeforeRender = (renderer) => renderer.clearDepth();
  mesh.name = "viewmodel-depth-clear";
  return mesh;
}

export function viewOnTop(group: THREE.Group, on: boolean) {
  let mk = marked.get(group);
  if (!mk) {
    mk = marker();
    group.add(mk);
    marked.set(group, mk);
  }
  mk.visible = on;
  group.traverse((o) => {
    if (o === mk || !(o as THREE.Mesh).isMesh) return;
    const mesh = o as THREE.Mesh;
    const want = on ? ON_TOP : 0;
    if (mesh.renderOrder === want) return;
    mesh.renderOrder = want;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (on) {
        if (!saved.has(mat)) saved.set(mat, mat.transparent);
        mat.transparent = true;
      } else if (saved.has(mat)) {
        mat.transparent = saved.get(mat)!;
        saved.delete(mat);
      }
    }
  });
}
