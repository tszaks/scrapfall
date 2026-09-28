// Robots break apart when they die: a burst of plating chunks in the robot's own colours
// that tumble, bounce once or twice on the ground and shrink away. One pooled
// InstancedMesh for every death on the map (one draw call), added to the scene on first use.
import * as THREE from "three";

import { groundY } from "../terrain";
import { Model, SURF, artMaterial } from "./kit";
import type { RobotKind } from "./rig";

const MAX = 180;
const LIFE = 1.7;
const PER_DEATH = 9;

type Chunk = {
  on: boolean;
  p: THREE.Vector3;
  v: THREE.Vector3;
  q: THREE.Quaternion;
  w: THREE.Vector3;
  s: THREE.Vector3;
  t: number;
};

let mesh: THREE.InstancedMesh | null = null;
let owner: THREE.Scene | null = null;
const chunks: Chunk[] = [];
let next = 0;
let lastFrame = -1;

function build() {
  // a bent plate with a bracket: reads as torn plating at a glance
  const m = new Model();
  m.box(1, 0.28, 0.8, [0, 0, 0], "#ffffff", SURF.paint, { bevel: 0.08 });
  m.box(0.3, 0.5, 0.3, [0.25, -0.3, 0.1], "#8a8e94", SURF.steel, { bevel: 0.05 });
  const g = m.build();
  const mat = artMaterial({ wear: 0.8, scale: 6 });
  const im = new THREE.InstancedMesh(g, mat, MAX);
  im.frustumCulled = false;
  im.count = MAX;
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const white = new THREE.Color(1, 1, 1);
  for (let i = 0; i < MAX; i++) {
    im.setMatrixAt(i, zero);
    im.setColorAt(i, white);
    chunks.push({
      on: false,
      p: new THREE.Vector3(),
      v: new THREE.Vector3(),
      q: new THREE.Quaternion(),
      w: new THREE.Vector3(),
      s: new THREE.Vector3(1, 1, 1),
      t: 0,
    });
  }
  return im;
}

const palettes = new WeakMap<RobotKind, THREE.Color[]>();
/** the robot's main (non-glowing) colours, most used first */
function paletteOf(kind: RobotKind) {
  let pal = palettes.get(kind);
  if (pal) return pal;
  const col = kind.near.getAttribute("color");
  const surf = kind.near.getAttribute("aSurf");
  const counts = new Map<number, number>();
  for (let i = 0; i < col.count; i += 3) {
    if (surf && surf.getZ(i) > 0) continue;
    const key =
      (Math.round(col.getX(i) * 31) << 10) |
      (Math.round(col.getY(i) * 31) << 5) |
      Math.round(col.getZ(i) * 31);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  pal = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k]) => new THREE.Color(((k >> 10) & 31) / 31, ((k >> 5) & 31) / 31, (k & 31) / 31));
  if (!pal.length) pal = [new THREE.Color(0.4, 0.4, 0.42)];
  palettes.set(kind, pal);
  return pal;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

/** burst a dead robot into chunks at world (x, y, z); `size` scales the pieces and the spread */
export function spawnDebris(
  scene: THREE.Scene,
  kind: RobotKind,
  x: number,
  y: number,
  z: number,
  size = 1,
) {
  if (!mesh) mesh = build();
  if (owner !== scene) {
    owner?.remove(mesh);
    scene.add(mesh);
    owner = scene;
  }
  const pal = paletteOf(kind);
  const n = Math.round(PER_DEATH * Math.min(2, size));
  for (let k = 0; k < n; k++) {
    const i = next;
    next = (next + 1) % MAX;
    const c = chunks[i]!;
    c.on = true;
    c.t = 0;
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 0.5 * size;
    c.p.set(x + Math.sin(a) * r, y + (0.4 + Math.random() * 1.4) * size, z + Math.cos(a) * r);
    const sp = (2 + Math.random() * 4) * Math.sqrt(size);
    c.v.set(Math.sin(a) * sp, 3 + Math.random() * 4, Math.cos(a) * sp);
    c.q.setFromEuler(_e.set(Math.random() * 6, Math.random() * 6, Math.random() * 6));
    c.w.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(14);
    const sc = (0.18 + Math.random() * 0.22) * size;
    c.s.set(sc, sc * (0.6 + Math.random() * 0.8), sc);
    mesh.setColorAt(i, pal[k % pal.length]!);
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

/** step the chunks (once per rendered frame; any number of callers) */
export function debrisFrame(frame: number, dt: number) {
  if (!mesh || frame === lastFrame) return;
  lastFrame = frame;
  let any = false;
  for (let i = 0; i < MAX; i++) {
    const c = chunks[i]!;
    if (!c.on) continue;
    any = true;
    c.t += dt;
    if (c.t >= LIFE) {
      c.on = false;
      mesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
      continue;
    }
    c.v.y -= 16 * dt;
    c.p.addScaledVector(c.v, dt);
    const gy = groundY(c.p.x, c.p.z) + c.s.y * 0.15;
    if (c.p.y < gy) {
      c.p.y = gy;
      if (c.v.y < 0) c.v.y *= -0.35;
      c.v.x *= 0.6;
      c.v.z *= 0.6;
      c.w.multiplyScalar(0.6);
    }
    _q.setFromEuler(_e.set(c.w.x * dt, c.w.y * dt, c.w.z * dt));
    c.q.multiply(_q);
    const fade = c.t > LIFE - 0.4 ? (LIFE - c.t) / 0.4 : 1;
    _m.compose(c.p, c.q, _e2.copy(c.s).multiplyScalar(fade));
    mesh.setMatrixAt(i, _m);
  }
  if (any) mesh.instanceMatrix.needsUpdate = true;
}
const _e2 = new THREE.Vector3();
