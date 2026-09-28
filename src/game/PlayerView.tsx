import { createPortal, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, type ReactNode, type MutableRefObject } from "react";
import * as THREE from "three";
import { newPlayerRig } from "./art/player";
import { artFrame } from "./art/kit";
import { getViewMode, toggleView, setViewMode, useViewMode } from "./viewMode";
import { showToast } from "./squadState";

const eye = new THREE.Vector3(),
  desired = new THREE.Vector3();
const direction = new THREE.Vector3(),
  target = new THREE.Vector3(),
  test = new THREE.Vector3();
/** Updated only during final rendering. Simulation, networking and pickups keep the eye pose. */
export const viewCamera = new THREE.PerspectiveCamera();
export const presentationCamera = (logical: THREE.Camera) =>
  shoulderView.active ? viewCamera : logical;
export const shoulderView = {
  active: false,
  origin: new THREE.Vector3(),
  direction: new THREE.Vector3(0, 0, -1),
  distance: 0,
};
type Stop = (p: THREE.Vector3) => boolean;

/** Sweep a small camera body from the eye; never look through a wall when the boom retracts. */
export function shoulderPose(camera: THREE.Camera, stop: Stop, out: THREE.Vector3) {
  desired.set(0.65, 0.3, 3.1).applyQuaternion(camera.quaternion).add(camera.position);
  const length = desired.distanceTo(camera.position),
    steps = Math.ceil(length / 0.12);
  out.copy(camera.position);
  for (let i = 1; i <= steps; i++) {
    test.lerpVectors(camera.position, desired, i / steps);
    let blocked = stop(test);
    for (const [axis, sign] of [
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [2, 1],
      [2, -1],
    ] as const) {
      test.setComponent(axis, test.getComponent(axis) + sign * 0.18);
      blocked ||= stop(test);
      test.setComponent(axis, test.getComponent(axis) - sign * 0.18);
    }
    if (blocked) break;
    out.copy(test);
  }
  return out.distanceTo(camera.position);
}

/** Recompute from the logical eye before firing as well as rendering, so fast turns agree. */
export function updateViewCamera(camera: THREE.Camera, stop: Stop) {
  viewCamera.copy(camera as THREE.PerspectiveCamera, false);
  camera.getWorldDirection(direction);
  target.copy(camera.position).addScaledVector(direction, 35);
  shoulderView.distance = shoulderPose(camera, stop, shoulderView.origin);
  viewCamera.position.copy(shoulderView.origin);
  viewCamera.lookAt(target);
  viewCamera.updateMatrixWorld();
  viewCamera.getWorldDirection(shoulderView.direction);
  return viewCamera;
}
export const playerMuzzle = (camera: THREE.Camera, out: THREE.Vector3) =>
  out.set(0.24, -0.36, -0.7).applyQuaternion(camera.quaternion).add(camera.position);
export type AimBody = { x: number; z: number; bottom: number; top: number; radius: number };
/** Reticle-to-muzzle convergence, using the same world collision and enemy hit bands as combat. */
export function shoulderAim(
  camera: THREE.Camera,
  muzzle: THREE.Vector3,
  stop: Stop,
  bodies: readonly AimBody[],
  out: THREE.Vector3,
) {
  updateViewCamera(camera, stop);
  const o = shoulderView.origin,
    d = shoulderView.direction;
  let distance = 180;
  for (let t = 0; t < distance; t += 0.25) {
    test.copy(o).addScaledVector(d, t);
    if (stop(test)) {
      distance = t;
      break;
    }
  }
  const a = d.x * d.x + d.z * d.z;
  for (const e of bodies) {
    const x = o.x - e.x,
      z = o.z - e.z,
      b = x * d.x + z * d.z,
      c = x * x + z * z - e.radius * e.radius;
    const disc = b * b - a * c;
    if (a < 1e-8 || disc < 0) continue;
    const enter = Math.max(0, (-b - Math.sqrt(disc)) / a),
      leave = (-b + Math.sqrt(disc)) / a;
    let lo = enter,
      hi = leave;
    if (Math.abs(d.y) < 1e-8) {
      if (o.y < e.bottom || o.y > e.top) continue;
    } else {
      const p = (e.bottom - o.y) / d.y,
        q = (e.top - o.y) / d.y;
      lo = Math.max(lo, Math.min(p, q));
      hi = Math.min(hi, Math.max(p, q));
    }
    if (lo <= hi && lo < distance) distance = lo;
  }
  return out.copy(o).addScaledVector(d, distance).sub(muzzle).normalize();
}

export function PlayerView({
  active,
  hidden,
  look,
  recoil,
  downed,
  stop,
  children,
}: {
  active: boolean;
  hidden: MutableRefObject<boolean>;
  look: MutableRefObject<{ yaw: number; pitch: number }>;
  recoil: MutableRefObject<number>;
  downed: MutableRefObject<boolean>;
  stop: Stop;
  children: ReactNode;
}) {
  const rig = useMemo(newPlayerRig, []);
  useEffect(() => () => rig.dispose(), [rig]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!active || e.code !== "KeyV" || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (
        e.target instanceof HTMLElement &&
        (e.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName))
      )
        return;
      toggleView();
      showToast(`${getViewMode() === "third" ? "THIRD" : "FIRST"} PERSON · V TO SWITCH`);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [active]);
  useFrame(({ camera, gl, scene, clock }, dt) => {
    artFrame();
    eye.copy(camera.position);
    const on = !hidden.current && getViewMode() === "third";
    shoulderView.active = on;
    rig.mesh.visible = false;
    if (on) {
      updateViewCamera(camera, stop);
      const distance = shoulderView.distance;
      rig.mesh.visible = distance > 0.85;
      rig.mesh.position.set(eye.x, eye.y - (downed.current ? 0.15 : 1.6), eye.z);
      rig.mesh.rotation.set(downed.current ? -Math.PI / 2 : 0, look.current.yaw + Math.PI, 0);
      rig.update(
        clock.elapsedTime,
        Math.min(dt, 0.05),
        eye.x,
        eye.z,
        recoil.current,
        -look.current.pitch,
        0,
      );
    }
    gl.render(scene, on ? viewCamera : camera);
  }, 1);
  return (
    <>
      <primitive object={rig.mesh} dispose={null} />
      {createPortal(
        <group rotation-y={Math.PI} scale={0.65}>
          {children}
        </group>,
        rig.byName["hands"]!,
      )}
    </>
  );
}

export function ViewSettings() {
  const mode = useViewMode();
  return (
    <div className="space-y-2 border-t border-white/10 pt-4">
      <div className="text-[11px] font-bold tracking-[0.3em]">CAMERA · V</div>
      <div className="flex gap-2">
        {(["first", "third"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setViewMode(v)}
            className={`rounded px-3 py-1 text-[11px] font-bold tracking-widest ${mode === v ? "bg-[#b4653f]" : "bg-white/10 opacity-80"}`}
          >
            {v === "first" ? "FIRST PERSON" : "THIRD PERSON"}
          </button>
        ))}
      </div>
    </div>
  );
}
