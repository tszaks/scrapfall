// Rigid-part skinned robots: one SkinnedMesh (one draw call) per robot, whose parts ride
// a handful of bones (hips, legs, arms, head, weapon). Every robot of a kind shares one
// geometry and one material; each robot only owns its bones.
//
// Author a kind with `defineRobot`: list its bones (pivot points in model space, y up,
// +z = the way it faces), add parts to the Model with `m.bone = B.legL` etc., and give it
// an `animate` that poses the bones from the robot's gait and attack state.
import * as THREE from "three";

import { ART_STATS, Model, artMaterial, type V3 } from "./kit";

export type BoneDef<N extends string = string> = { name: N; parent?: N; at: V3 };

/** everything an animation gets each frame */
export type Pose = {
  /** seconds (global clock) */
  t: number;
  dt: number;
  /** walk cycle phase (radians), advanced by ground speed */
  phase: number;
  /** 0 standing still .. 1 at full stride */
  move: number;
  /** attack wind-up 0..1 (1 = the moment it strikes / fires) */
  wind: number;
  /** extra per-kind value (telegraph phase etc.) */
  aux: number;
  /** per-robot random 0..1, to desync idles */
  seed: number;
};

export type RobotDef<N extends string = string> = {
  /** debug label (vertex stats) */
  name?: string;
  bones: BoneDef<N>[];
  /** author the parts; `B` maps bone names to indices */
  build: (m: Model, B: Record<N, number>) => void;
  /** pose the bones (they start each frame at rest) */
  animate?: (b: Record<N, THREE.Bone>, p: Pose) => void;
  /** metres per walk cycle (bigger = slower legs) */
  stride?: number;
  wear?: number;
};

export type RobotKind = {
  def: RobotDef;
  near: THREE.BufferGeometry;
  far: THREE.BufferGeometry;
  inverses: THREE.Matrix4[];
  names: string[];
  rest: THREE.Vector3[];
  parents: number[];
  radius: number;
};

export function defineRobot<const N extends string>(typed: RobotDef<N>): RobotKind {
  const def = typed as unknown as RobotDef;
  const label = def.name ?? "robot";
  const names = def.bones.map((b) => b.name);
  const B: Record<string, number> = {};
  names.forEach((n, i) => (B[n] = i));
  const m = new Model();
  def.build(m, B);
  const near = m.build({ skin: true, lod: 0 });
  const far = m.build({ skin: true, lod: 1 });
  ART_STATS.models[label] = near.getAttribute("position").count;
  ART_STATS.models[label + ":far"] = far.getAttribute("position").count;
  const parents = def.bones.map((b) => (b.parent ? B[b.parent]! : -1));
  const rest = def.bones.map((b, i) => {
    const p = parents[i]!;
    const at = new THREE.Vector3(...b.at);
    if (p >= 0) at.sub(new THREE.Vector3(...def.bones[p]!.at));
    return at;
  });
  const inverses = def.bones.map((b) =>
    new THREE.Matrix4().makeTranslation(-b.at[0], -b.at[1], -b.at[2]),
  );
  near.computeBoundingSphere();
  const radius = (near.boundingSphere?.radius ?? 2) * 1.35;
  return { def, near, far, inverses, names, rest, parents, radius };
}

const mats = new Map<string, THREE.MeshStandardMaterial>();
/** the shared skinned art material for a wear level / variant */
export function robotMaterial(variant: "base" | "elite" | "hot" = "base", wear = 0.75) {
  const k = `${variant}|${wear}`;
  let mt = mats.get(k);
  if (!mt) {
    mt = artMaterial({
      skin: true,
      wear,
      scale: 2.6,
      glow: variant === "hot" ? 3.5 : 1,
      // elite: gilded plating; hot: the hit flash (a white wash and flaring glows)
      tint:
        variant === "elite"
          ? new THREE.Vector4(1.0, 0.78, 0.3, 0.45)
          : variant === "hot"
            ? new THREE.Vector4(1.0, 0.96, 0.9, 0.4)
            : undefined,
    });
    mats.set(k, mt);
  }
  return mt;
}

/** one robot instance: its bones and its skinned mesh (add `mesh` to the scene) */
export class RobotRig {
  mesh: THREE.SkinnedMesh;
  bones: THREE.Bone[];
  byName: Record<string, THREE.Bone> = {};
  kind: RobotKind;
  pose: Pose;
  private lastX = NaN;
  private lastZ = NaN;
  private far = false;

  constructor(kind: RobotKind, material: THREE.Material = robotMaterial()) {
    this.kind = kind;
    this.bones = kind.names.map((n, i) => {
      const b = new THREE.Bone();
      b.name = n;
      b.position.copy(kind.rest[i]!);
      return b;
    });
    this.bones.forEach((b, i) => {
      const p = kind.parents[i]!;
      if (p >= 0) this.bones[p]!.add(b);
      this.byName[kind.names[i]!] = b;
    });
    this.mesh = new THREE.SkinnedMesh(kind.near, material);
    this.bones.forEach((b, i) => {
      if (kind.parents[i]! < 0) this.mesh.add(b);
    });
    this.mesh.bind(new THREE.Skeleton(this.bones, kind.inverses), new THREE.Matrix4());
    this.mesh.frustumCulled = true;
    this.mesh.boundingSphere = new THREE.Sphere(
      kind.near.boundingSphere?.center.clone() ?? new THREE.Vector3(0, 1, 0),
      kind.radius,
    );
    this.pose = {
      t: 0,
      dt: 0,
      phase: Math.random() * 6.28,
      move: 0,
      wind: 0,
      aux: 0,
      seed: Math.random(),
    };
  }

  /**
   * Advance the gait from the robot's world position and pose the bones.
   * `x, z` = where the robot stands now (world), `camDist` picks the LOD.
   */
  update(
    t: number,
    dt: number,
    x: number,
    z: number,
    wind: number,
    aux: number,
    camDist: number,
    scale = 1,
  ) {
    const P = this.pose;
    P.t = t;
    P.dt = dt;
    P.wind = wind;
    P.aux = aux;
    if (Number.isFinite(this.lastX) && dt > 0) {
      const d = Math.hypot(x - this.lastX, z - this.lastZ);
      const v = d > 3 ? 0 : d / dt; // a teleport (respawn) is not a stride
      const target = Math.min(1, v / (2.2 * scale));
      P.move += (target - P.move) * Math.min(1, dt * 6);
      P.phase += (Math.min(d, 0.5) / ((this.kind.def.stride ?? 1.4) * scale)) * Math.PI * 2;
    }
    this.lastX = x;
    this.lastZ = z;
    // rest pose, then the kind's animation
    for (let i = 0; i < this.bones.length; i++) {
      const b = this.bones[i]!;
      b.position.copy(this.kind.rest[i]!);
      b.rotation.set(0, 0, 0);
      b.scale.set(1, 1, 1);
    }
    this.kind.def.animate?.(this.byName, P);
    const far = camDist > 42;
    if (far !== this.far) {
      this.far = far;
      this.mesh.geometry = far ? this.kind.far : this.kind.near;
    }
  }

  /** forget the last position (after a respawn / kind change) */
  reset() {
    this.lastX = NaN;
    this.lastZ = NaN;
    this.pose.move = 0;
  }

  dispose() {
    this.mesh.skeleton.dispose();
  }
}

// ---------------------------------------------------------------- gait helpers
/** a biped stride: thighs swing, knees bend on the forward swing, hips bob */
type Legs = Partial<Record<"legL" | "legR" | "shinL" | "shinR" | "hip", THREE.Bone>>;
export function walkLegs(b: Legs, p: Pose, amp = 0.55) {
  const s = Math.sin(p.phase);
  const c = Math.cos(p.phase);
  const a = amp * p.move;
  if (b.legL) b.legL.rotation.x = s * a;
  if (b.legR) b.legR.rotation.x = -s * a;
  if (b.shinL) b.shinL.rotation.x = Math.max(0, -c) * a * 1.3;
  if (b.shinR) b.shinR.rotation.x = Math.max(0, c) * a * 1.3;
  if (b.hip) {
    b.hip.position.y += Math.abs(c) * 0.06 * p.move - 0.03 * p.move;
    b.hip.rotation.z = s * 0.04 * p.move;
    b.hip.rotation.y = s * 0.08 * p.move;
  }
}

/** idle breathing / servo hum on a torso bone */
export function idle(bone: THREE.Bone | undefined, p: Pose, k = 1) {
  if (!bone) return;
  bone.rotation.x += Math.sin(p.t * 1.7 + p.seed * 6) * 0.025 * k;
  bone.rotation.z += Math.sin(p.t * 1.1 + p.seed * 9) * 0.015 * k;
}
