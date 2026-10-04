import { Matrix4, PerspectiveCamera, Vector3, type Camera } from "three";

type Car = {
  id: string;
  x: number;
  z: number;
  yaw: number;
  half: number;
  width: number;
  height: number;
};
type Sweep = (from: Vector3, to: Vector3) => number | undefined;
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
const RADIUS = 0.24;

/** Presentation only: the logical eye, saved view mode and controller look remain untouched. */
export class VehicleCamera {
  readonly camera = new PerspectiveCamera();
  private vehicle = "";
  private sourceCamera: Camera | undefined;
  private sourceFov = NaN;
  private readonly sourceProjection = new Matrix4();
  private lookYaw = 0;
  private orbit = 0;
  private yaw = 0;
  private readonly anchor = new Vector3();
  private readonly target = new Vector3();
  private readonly focus = new Vector3();
  private readonly desired = new Vector3();
  private readonly follow = new Vector3();
  private readonly direction = new Vector3();
  private readonly from = new Vector3();
  private readonly to = new Vector3();

  reset() {
    this.vehicle = "";
  }

  update(logical: Camera, car: Car, ground: number, dt: number, sweep: Sweep) {
    const camera = this.camera;
    const eye = logical as PerspectiveCamera;
    // The chase owns its pose. Copy lens state only when the logical projection changes.
    if (
      this.sourceCamera !== logical ||
      this.sourceFov !== eye.fov ||
      !this.sourceProjection.equals(eye.projectionMatrix)
    ) {
      camera.copy(eye, false);
      camera.fov = Math.max(eye.fov, Math.min(100, Math.max(82, eye.fov + 8)));
      camera.updateProjectionMatrix();
      this.sourceCamera = logical;
      this.sourceFov = eye.fov;
      this.sourceProjection.copy(eye.projectionMatrix);
    }
    camera.layers.mask = logical.layers.mask;
    camera.up.copy(logical.up);
    logical.getWorldDirection(this.direction);
    const lookYaw = Math.atan2(-this.direction.x, -this.direction.z);
    const fresh = this.vehicle !== car.id;
    if (fresh) {
      this.vehicle = car.id;
      this.orbit = wrap(lookYaw - car.yaw - Math.PI);
      this.yaw = car.yaw + Math.PI + this.orbit;
    } else {
      this.orbit = wrap(this.orbit + wrap(lookYaw - this.lookYaw));
    }
    this.lookYaw = lookYaw;
    const blend = 1 - Math.exp(-10 * Math.max(0, Math.min(dt, 0.1)));
    this.yaw += wrap(car.yaw + Math.PI + this.orbit - this.yaw) * blend;

    // Fit the hull in the narrower screen dimension, with room around every edge.
    const halfFov = Math.atan(Math.tan((camera.fov * Math.PI) / 360) * Math.min(1, camera.aspect));
    const radius = Math.hypot(car.half, car.width, car.height / 2);
    const distance = Math.max(car.half + 3, radius / Math.sin(halfFov) / 0.82);
    const pitch = Math.max(0.08, Math.min(0.85, 0.32 - Math.asin(this.direction.y)));
    this.target.set(car.x, ground + car.height * 0.6, car.z);
    if (fresh || this.focus.distanceToSquared(this.target) > 900) this.focus.copy(this.target);
    else this.focus.lerp(this.target, blend);
    // Start above the roof so the car's own collision hull cannot retract its boom.
    this.anchor.set(car.x, ground + car.height + 0.6, car.z);
    this.desired.set(
      car.x + Math.sin(this.yaw) * Math.cos(pitch) * distance,
      this.anchor.y + Math.sin(pitch) * distance,
      car.z + Math.cos(this.yaw) * Math.cos(pitch) * distance,
    );
    if (fresh || this.follow.distanceToSquared(this.desired) > 900) this.follow.copy(this.desired);
    else this.follow.lerp(this.desired, blend);

    // A swept camera body retracts immediately; easing only happens toward clear space.
    // Rays include static triangles and ground/traffic via the caller's world sweep.
    let limit = 1;
    for (let probe = 0; probe < 7; probe++) {
      this.from.copy(this.anchor);
      this.to.lerpVectors(this.anchor, this.follow, limit);
      if (probe > 0) {
        const axis = Math.floor((probe - 1) / 2);
        const offset = probe % 2 ? RADIUS : -RADIUS;
        this.from.setComponent(axis, this.from.getComponent(axis) + offset);
        this.to.setComponent(axis, this.to.getComponent(axis) + offset);
      }
      limit *= sweep(this.from, this.to) ?? 1;
      if (limit === 0) break;
    }
    const length = this.anchor.distanceTo(this.follow);
    camera.position.lerpVectors(
      this.anchor,
      this.follow,
      Math.max(0, limit - (limit < 1 ? 0.08 / Math.max(length, 0.001) : 0)),
    );
    if (limit < 1) this.follow.copy(camera.position);
    camera.lookAt(this.focus);
    camera.updateMatrixWorld();
    return camera;
  }
}
