// Skip hidden subtrees in the per-frame world-matrix walk.
//
// three recomputes every object's world matrix every frame, visible or not. The maps keep
// most of their scene graph hidden at any moment (pooled enemies, marks, deployables, the
// other enemy kinds' bodies, far props): ~2200 of the city's ~3200 objects. In a big fight
// updateMatrixWorld + its matrix multiplies were the largest single JS cost of a frame
// (~14% of the main thread in a profile).
//
// A hidden object is now skipped and flagged, so the frame it is shown again it (and its
// whole subtree) is brought up to date before the render reads it. Code that needs a hidden
// object's world position must call updateWorldMatrix() itself (three's getWorldPosition()
// and friends already do).
import * as THREE from "three";

let installed = false;
export function skipHiddenMatrixUpdates() {
  if (installed) return;
  installed = true;
  const P = THREE.Object3D.prototype;
  const orig = P.updateMatrixWorld;
  P.updateMatrixWorld = function (this: THREE.Object3D, force?: boolean) {
    if (!this.visible && this.parent !== null) {
      this.matrixWorldNeedsUpdate = true;
      return;
    }
    orig.call(this, force);
  };
}
