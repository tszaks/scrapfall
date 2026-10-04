import { myVehicle } from "./driving";
import { VehicleCamera } from "./vehicleCamera";
import { baseGroundY } from "./terrain";
import { aimState } from "./input/aim";
import { firstWorldHit } from "./enemyProjectiles";
import { KeyHint } from "./input/Glyph";
import { actionLabel } from "./input/labels";
import { subscribeActions } from "./input/remap";
import { createPortal, useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, type ReactNode, type MutableRefObject } from "react";
import * as THREE from "three";
import { newPlayerRig } from "./art/player";
import { artFrame } from "./art/kit";
import { getViewMode, toggleView, setViewMode, useViewMode } from "./viewMode";
import { renderWithPost } from "./PostFx";
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
/** Clip a proposed origin to cover between the eye and the actual barrel. */
export function playerMuzzle(
  camera: THREE.Camera,
  out: THREE.Vector3,
  stop: Stop,
  muzzle: THREE.Vector3,
) {
  const contact = firstWorldHit(camera.position, muzzle, (p) => stop(test.set(p.x, p.y, p.z)));
  const length = camera.position.distanceTo(muzzle);
  return out.lerpVectors(
    camera.position,
    muzzle,
    contact === undefined ? 1 : Math.max(0, contact - 0.02 / Math.max(0.001, length)),
  );
}
export type PreparePlayer = (camera: THREE.Camera, time: number, dt: number) => THREE.Object3D;
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
  target.copy(o).addScaledVector(d, 180);
  let distance = (firstWorldHit(o, target, (p) => stop(test.set(p.x, p.y, p.z))) ?? 1) * 180;
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
  out.copy(o).addScaledVector(d, distance).sub(muzzle).normalize();
  camera.getWorldDirection(direction);
  // A close obstruction can sit behind the muzzle's reticle intersection: fire into it,
  // never turn the projectile back toward the player.
  if (out.dot(direction) <= 0.05) out.copy(direction);
  return out;
}

export function PlayerView({
  active,
  hidden,
  look,
  recoil,
  downed,
  seated,
  airborne,
  stop,
  children,
  prepare,
}: {
  active: boolean;
  hidden: MutableRefObject<boolean>;
  look: MutableRefObject<{ yaw: number; pitch: number }>;
  recoil: MutableRefObject<number>;
  downed: MutableRefObject<boolean>;
  seated: () => boolean;
  airborne: () => boolean;
  stop: Stop;
  children: ReactNode;
  prepare: MutableRefObject<PreparePlayer | null>;
}) {
  const rig = useMemo(newPlayerRig, []);
  const chase = useMemo(() => new VehicleCamera(), []);
  const sweep = useMemo(() => {
    const pointStop = (p: { x: number; y: number; z: number }) => stop(test.set(p.x, p.y, p.z));
    return (from: THREE.Vector3, to: THREE.Vector3) => firstWorldHit(from, to, pointStop);
  }, [stop]);
  useEffect(
    () => () => {
      rig.dispose();
      chase.reset();
      shoulderView.active = false;
    },
    [rig, chase],
  );
  useEffect(
    () =>
      subscribeActions((a, down, repeat) => {
        if (!active || a !== "camera" || !down || repeat) return;
        toggleView();
        showToast(
          `${getViewMode() === "third" ? "THIRD" : "FIRST"} PERSON · ${actionLabel("camera")} TO SWITCH`,
        );
      }),
    [active],
  );

  useLayoutEffect(() => {
    prepare.current = (camera, time, dt) => {
      artFrame();
      eye.copy(camera.position);
      const vehicle = !hidden.current && !downed.current ? myVehicle() : null;
      const on =
        (!hidden.current || downed.current) && getViewMode() === "third" && !aimState.scoped;
      shoulderView.active = on || !!vehicle;
      rig.mesh.visible = false;
      if (on && !vehicle) {
        updateViewCamera(camera, stop);
        const distance = shoulderView.distance;
        rig.mesh.visible = distance > 0.85 && !myVehicle();
        rig.mesh.position.set(eye.x, eye.y - (downed.current ? 0.15 : 1.6), eye.z);
        rig.mesh.rotation.set(downed.current ? -Math.PI / 2 : 0, look.current.yaw + Math.PI, 0);
        rig.pose.seated = seated();
        rig.pose.airborne = airborne();
        rig.update(time, Math.min(dt, 0.05), eye.x, eye.z, recoil.current, -look.current.pitch, 0);
      }
      return rig.mesh;
    };
    return () => {
      prepare.current = null;
      shoulderView.active = false;
    };
  }, [prepare, rig, hidden, downed, look, recoil, seated, airborne, stop, chase]);

  useFrame(({ camera, gl, scene }, dt) => {
    const vehicle = !hidden.current && !downed.current ? myVehicle() : null;
    const on =
      !!vehicle ||
      ((!hidden.current || downed.current) && getViewMode() === "third" && !aimState.scoped);
    shoulderView.active = on;
    if (vehicle) {
      viewCamera.copy(
        chase.update(camera, vehicle, baseGroundY(vehicle.x, vehicle.z), dt, sweep),
        false,
      );
      shoulderView.origin.copy(viewCamera.position);
      viewCamera.getWorldDirection(shoulderView.direction);
      shoulderView.distance = viewCamera.position.distanceTo(camera.position);
      rig.mesh.visible = false;
    } else {
      chase.reset();
      if (on) updateViewCamera(camera, stop);
    }
    // the single scene render per frame; PostFx layers its bloom on top of it
    renderWithPost(gl, scene, on ? viewCamera : camera);
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
      <div className="text-[11px] font-bold tracking-[0.3em]">
        CAMERA · <KeyHint action="camera" />
      </div>
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
