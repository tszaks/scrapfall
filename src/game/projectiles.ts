import { wheelWorld, wheelEye } from "./beach/wheelRide";
import { remoteFloorY } from "./access/world";
import { alpine } from "./alpine/weather";
import { riderEye } from "./alpine/ride";
import * as THREE from "three";
import { groundY, shotHits } from "./terrain";

import { playGun } from "./audio";
import { DecalPool, MeshPool, RingPool, SegPool, spec } from "./fxCore";
import {
  BOOMER_R, FX, VF, VK, airBurst, beam, bolt, chips, classify, explosion, glow, impact, punchThrough, puffs,
  robotAt, seg, shatter, sound, sparks, type Contact, type FxEnemy, type FxEnv, type Surface, type VisKind,
} from "./impacts";
import type { NetHandle, NetMsg, RemoteState } from "./net";

/**
 * Per-weapon projectile looks and feel: what each round looks like in flight, the muzzle
 * flash, casings, tethers and arcs, and what it does when it lands. Game.tsx keeps the
 * authoritative bullet simulation and calls the small `fx*` hooks below; everything here
 * is visual-only and pooled (no React state per shot, no real lights).
 *
 * Co-op: each client broadcasts a compact `fire` event; everyone else replays it as
 * visual-only "ghost" rounds. Damage still only travels through the existing `hit` path.
 */

// ---------------------------------------------------------------- geometry

type Part = { geo: THREE.BufferGeometry; color: (y: number) => number };
/** bake a vertex colour per part and merge (positions + colours only: the rounds are unlit) */
function build(parts: Part[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  for (const p of parts) {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
    const a = g.getAttribute("position");
    for (let i = 0; i < a.count; i++) {
      const y = a.getY(i);
      pos.push(a.getX(i), y, a.getZ(i));
      c.set(p.color(y));
      col.push(c.r, c.g, c.b);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}
const lathe = (pts: [number, number][], s: number, seg = 10) =>
  new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x * s, y * s)), seg);
const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, rz = 0) => {
  g.rotateX(rx); g.rotateZ(rz); g.translate(x, y, z);
  return g;
};

// all rounds are modelled along +Y (nose up), matching Toby's BULLET_GEO, then aligned to velocity
const BULLET_PTS: [number, number][] = [
  [0, -1.35], [0.52, -1.35], [0.56, -0.55], [0.56, 0.25], [0.48, 0.7], [0.32, 1.05], [0.14, 1.28], [0, 1.35],
];
const GEO = {
  // brass case, copper jacket nose
  bullet: build([{ geo: lathe(BULLET_PTS, 0.14), color: (y) => (y > 0.03 ? 0xd07a3c : y < -0.17 ? 0x9c7a2c : 0xe0b04a) }]),
  pellet: build([{ geo: new THREE.IcosahedronGeometry(0.055, 0), color: () => 0xd8c890 }]),
  // LANCE: a thin glowing needle
  slug: build([
    { geo: new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6), color: () => 0xffc8ff },
    { geo: at(new THREE.ConeGeometry(0.03, 0.14, 6), 0, 0.32, 0), color: () => 0xffffff },
  ]),
  // BOOMER: squat steel shell, copper driving band, glowing base
  shell: build([{
    geo: lathe([[0, -0.36], [0.15, -0.36], [0.16, -0.31], [0.16, 0.06], [0.14, 0.18], [0.09, 0.29], [0.03, 0.35], [0, 0.36]], 1, 14),
    color: (y) => (y < -0.33 ? 0xff5030 : y > -0.3 && y < -0.22 ? 0xc0743a : y > 0.27 ? 0xff5a3a : 0x3a3c44),
  }]),
  // FLAK: olive shell with an orange nose band and fuse
  flak: build([{
    geo: lathe([[0, -0.3], [0.12, -0.3], [0.13, -0.25], [0.13, 0.08], [0.1, 0.2], [0.05, 0.28], [0, 0.3]], 1, 10),
    color: (y) => (y > 0.24 ? 0xe0e0d0 : y > 0.1 ? 0xff9d3b : 0x6b6450),
  }]),
  orbGreen: build([{ geo: new THREE.IcosahedronGeometry(0.17, 2), color: () => 0xb8ff9c }]),
  orbBlue: build([{ geo: new THREE.IcosahedronGeometry(0.14, 2), color: () => 0xcfe0ff }]),
  // HARPOON: steel shaft, bright barbed head, red tail fins
  harpoon: build([
    { geo: new THREE.CylinderGeometry(0.022, 0.022, 1.0, 6), color: () => 0x9aa2ac },
    { geo: at(new THREE.ConeGeometry(0.06, 0.24, 6), 0, 0.62, 0), color: () => 0xf2ead6 },
    { geo: at(new THREE.ConeGeometry(0.02, 0.16, 4), 0.05, 0.46, 0, 0, 2.6), color: () => 0xe0d8c0 },
    { geo: at(new THREE.ConeGeometry(0.02, 0.16, 4), -0.05, 0.46, 0, 0, -2.6), color: () => 0xe0d8c0 },
    { geo: at(new THREE.ConeGeometry(0.02, 0.16, 4), 0, 0.46, 0.05, -2.6, 0), color: () => 0xe0d8c0 },
    { geo: at(new THREE.BoxGeometry(0.16, 0.18, 0.01), 0, -0.44, 0), color: () => 0xc03a2a },
    { geo: at(new THREE.BoxGeometry(0.01, 0.18, 0.16), 0, -0.44, 0), color: () => 0xc03a2a },
  ]),
  // GLACIER: a long crystal with two splinters
  ice: build([
    { geo: new THREE.OctahedronGeometry(0.1, 0).scale(0.75, 2.9, 0.75), color: (y) => (y > 0.12 ? 0xffffff : y < -0.12 ? 0x6fcde8 : 0xaeeeff) },
    { geo: at(new THREE.OctahedronGeometry(0.05, 0).scale(0.7, 2.4, 0.7), 0.06, -0.08, 0.02, 0, -0.5), color: () => 0xd8f8ff },
    { geo: at(new THREE.OctahedronGeometry(0.045, 0).scale(0.7, 2.2, 0.7), -0.05, -0.12, -0.03, 0.4, 0.45), color: () => 0xbff0ff },
  ]),
  // Toby's guns: PLASMA FAN's pink bolt and VOID ORB's violet orb
  orbPink: build([{ geo: new THREE.IcosahedronGeometry(0.13, 2), color: () => 0xffb0f0 }]),
  orbVoid: build([{ geo: new THREE.IcosahedronGeometry(0.2, 2), color: (y) => (y > 0.1 ? 0xe8d0ff : 0x9a5cff) }]),
  casing: build([{ geo: new THREE.CylinderGeometry(0.009, 0.009, 0.032, 6), color: (y) => (y < -0.02 ? 0x8a6a24 : 0xd8a847) }]),
};
type GeoKey = keyof typeof GEO;

/** everything a weapon's round needs to know about how to look */
type Look = {
  geo: GeoKey; base: number; col: number; core: number; glowCol: number;
  len: number; coreW: number; glowW: number; power: number; kick: number;
  flash: { w: number; spikes: number; len: number; col: number; smoke: number; life: number };
  muzzle: [number, number];
};
const LOOKS: Record<VisKind, Look> = {
  [VK.PISTOL]: { geo: "bullet", base: 0.14, col: 0xff8a1f, core: 0xffe2b8, glowCol: 0xff8a1f, len: 2.2, coreW: 0.036, glowW: 0.15, power: 1, kick: 0.01, flash: { w: 0.24, spikes: 4, len: 0.26, col: 0xffb050, smoke: 0, life: 0.05 }, muzzle: [0, -0.34] },
  [VK.SCATTER]: { geo: "pellet", base: 0.12, col: 0xffd23f, core: 0xfff2b0, glowCol: 0xffc23f, len: 0.6, coreW: 0.022, glowW: 0.08, power: 0.6, kick: 0.035, flash: { w: 0.55, spikes: 7, len: 0.55, col: 0xffb040, smoke: 4, life: 0.06 }, muzzle: [0, -0.62] },
  [VK.SMG]: { geo: "bullet", base: 0.14, col: 0x4fe3ff, core: 0xd8fbff, glowCol: 0x4fe3ff, len: 1.2, coreW: 0.022, glowW: 0.08, power: 0.7, kick: 0.005, flash: { w: 0.2, spikes: 3, len: 0.2, col: 0xffd890, smoke: 0, life: 0.035 }, muzzle: [0, -0.56] },
  [VK.RAIL]: { geo: "slug", base: 0.1, col: 0xe04bff, core: 0xffe6ff, glowCol: 0xe04bff, len: 3, coreW: 0.05, glowW: 0.26, power: 2, kick: 0.03, flash: { w: 0.4, spikes: 0, len: 0, col: 0xe04bff, smoke: 0, life: 0.08 }, muzzle: [0, -0.72] },
  [VK.CANNON]: { geo: "shell", base: 0.38, col: 0xff3b2a, core: 0xffb080, glowCol: 0xff3b2a, len: 0.6, coreW: 0.08, glowW: 0.3, power: 3, kick: 0.06, flash: { w: 0.7, spikes: 6, len: 0.65, col: 0xff7a30, smoke: 5, life: 0.08 }, muzzle: [0, -0.56] },
  [VK.REBOUND]: { geo: "orbGreen", base: 0.17, col: 0x7cff4f, core: 0xeaffd8, glowCol: 0x7cff4f, len: 0, coreW: 0, glowW: 0, power: 1.4, kick: 0.014, flash: { w: 0.42, spikes: 0, len: 0, col: 0x7cff4f, smoke: 0, life: 0.07 }, muzzle: [0.06, -0.44] },
  [VK.HARPOON]: { geo: "harpoon", base: 0.1, col: 0xf2ead6, core: 0xffffff, glowCol: 0xd8ccb0, len: 1, coreW: 0.02, glowW: 0.06, power: 1.6, kick: 0.02, flash: { w: 0.16, spikes: 0, len: 0, col: 0xfff0d0, smoke: 2, life: 0.05 }, muzzle: [0.02, -0.72] },
  [VK.CRYO]: { geo: "ice", base: 0.12, col: 0x9fe8ff, core: 0xf0fcff, glowCol: 0x9fe8ff, len: 0.7, coreW: 0.02, glowW: 0.1, power: 0.8, kick: 0.006, flash: { w: 0.28, spikes: 0, len: 0, col: 0x9fe8ff, smoke: 0, life: 0.05 }, muzzle: [0, -0.62] },
  [VK.FLAK]: { geo: "flak", base: 0.3, col: 0xff9d3b, core: 0xffd0a0, glowCol: 0xff9d3b, len: 0.8, coreW: 0.03, glowW: 0.12, power: 1.5, kick: 0.035, flash: { w: 0.5, spikes: 6, len: 0.45, col: 0xffa040, smoke: 3, life: 0.07 }, muzzle: [0, -0.63] },
  [VK.TESLA]: { geo: "orbBlue", base: 0.14, col: 0x5f9bff, core: 0xe0ecff, glowCol: 0x5f9bff, len: 1.2, coreW: 0.02, glowW: 0.08, power: 1.2, kick: 0.012, flash: { w: 0.34, spikes: 0, len: 0, col: 0x7fb0ff, smoke: 0, life: 0.07 }, muzzle: [0, -0.48] },
  [VK.TURRET]: { geo: "bullet", base: 0.14, col: 0x4fe3ff, core: 0xd8fbff, glowCol: 0x4fe3ff, len: 2, coreW: 0.025, glowW: 0.1, power: 0.6, kick: 0, flash: { w: 0.3, spikes: 4, len: 0.3, col: 0x9ff0ff, smoke: 0, life: 0.05 }, muzzle: [0, 0] },
  [VK.FRAG]: { geo: "pellet", base: 0.14, col: 0xff9d3b, core: 0xffd8a0, glowCol: 0xff8a2b, len: 0.5, coreW: 0.025, glowW: 0.09, power: 0.5, kick: 0, flash: { w: 0, spikes: 0, len: 0, col: 0, smoke: 0, life: 0 }, muzzle: [0, 0] },
  [VK.REVOLVER]: { geo: "bullet", base: 0.13, col: 0xffcf6b, core: 0xfff0c8, glowCol: 0xffb040, len: 2.4, coreW: 0.04, glowW: 0.16, power: 1.8, kick: 0.03, flash: { w: 0.4, spikes: 5, len: 0.4, col: 0xffb050, smoke: 2, life: 0.06 }, muzzle: [0.02, -0.48] },
  [VK.MINIGUN]: { geo: "bullet", base: 0.14, col: 0xffe14f, core: 0xfff6c0, glowCol: 0xffd040, len: 1.4, coreW: 0.02, glowW: 0.07, power: 0.6, kick: 0.004, flash: { w: 0.26, spikes: 4, len: 0.28, col: 0xffd890, smoke: 0, life: 0.035 }, muzzle: [0, -0.6] },
  [VK.CROSSBOW]: { geo: "harpoon", base: 0.07, col: 0xc8f07a, core: 0xf4ffd8, glowCol: 0xc8f07a, len: 1, coreW: 0.02, glowW: 0.06, power: 1.4, kick: 0.015, flash: { w: 0.12, spikes: 0, len: 0, col: 0xe8ffc0, smoke: 0, life: 0.04 }, muzzle: [0, -0.5] },
  [VK.PLASMA]: { geo: "orbPink", base: 0.15, col: 0xff4fd8, core: 0xffe0f8, glowCol: 0xff4fd8, len: 1, coreW: 0.02, glowW: 0.09, power: 1.2, kick: 0.012, flash: { w: 0.36, spikes: 0, len: 0, col: 0xff7fe0, smoke: 0, life: 0.06 }, muzzle: [0, -0.48] },
  [VK.VOIDORB]: { geo: "orbVoid", base: 0.36, col: 0xb06bff, core: 0xf0e0ff, glowCol: 0xb06bff, len: 0.6, coreW: 0.03, glowW: 0.14, power: 1.8, kick: 0.03, flash: { w: 0.5, spikes: 0, len: 0, col: 0xc090ff, smoke: 0, life: 0.09 }, muzzle: [0, -0.5] },
  [VK.SHATTER]: { geo: "ice", base: 0.2, col: 0xb8f4ff, core: 0xf0fcff, glowCol: 0x9fe8ff, len: 0.8, coreW: 0.03, glowW: 0.12, power: 1.4, kick: 0.03, flash: { w: 0.4, spikes: 0, len: 0, col: 0x9fe8ff, smoke: 2, life: 0.06 }, muzzle: [0, -0.56] },
  [VK.MORTAR]: { geo: "flak", base: 0.3, col: 0xff9d3b, core: 0xffd0a0, glowCol: 0xff9d3b, len: 0.8, coreW: 0.035, glowW: 0.14, power: 1.6, kick: 0.04, flash: { w: 0.55, spikes: 6, len: 0.5, col: 0xffa040, smoke: 4, life: 0.07 }, muzzle: [0, -0.4] },
};
/** the gun names Game.tsx uses, by VK number (for sounds and ghost stats); 10-12 are not guns */
const GUN_IDS = [
  "pistol", "scatter", "smg", "rail", "cannon", "rebound", "harpoon", "cryo", "flak", "tesla",
  "", "", "",
  "revolver", "minigun", "crossbow", "plasma", "voidorb", "shatter",
] as const;
/** the look for a gun name (Game.tsx's Weapon); unknown names fall back on the pistol */
export function visOf(weapon: string): VisKind {
  const i = weapon ? GUN_IDS.indexOf(weapon as (typeof GUN_IDS)[number]) : -1;
  return (i >= 0 ? i : 0) as VisKind;
}
const isGun = (kind: number) => !!GUN_IDS[kind];

// ---------------------------------------------------------------- per-round state

type Proj = {
  on: boolean;
  pos: THREE.Vector3; vel: THREE.Vector3;
  prev: THREE.Vector3; spawn: THREE.Vector3; vo: THREE.Vector3;
  kind: VisKind; flags: number; age: number; trailT: number; scale: number;
  /** metres of flight over which the muzzle offset fades out (where the shot will land) */
  conv: number;
  /** where the harpoon's tether is tied: null = the local gun, else a remote player id */
  owner: string | null;
  // ghost-only simulation
  life: number; bounce: number; pierce: number; cluster: number; chain: number;
  /** BOOMER: the local shot's blast radius (0 = the default) */
  blastR: number;
};
const mkProj = (): Proj => ({
  on: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), prev: new THREE.Vector3(), spawn: new THREE.Vector3(),
  vo: new THREE.Vector3(), kind: VK.PISTOL, flags: 0, age: 0, trailT: 0, scale: 1, conv: 7, owner: null,
  life: 0, bounce: 0, pierce: 0, cluster: 0, chain: 0, blastR: 0,
});
/** local rounds, indexed by Game.tsx's bullet slot */
const L: Proj[] = [];
/** other players' rounds (visual only) */
const GHOSTS = 160;
const G: Proj[] = Array.from({ length: GHOSTS }, mkProj);

type BulletLike = { pos: THREE.Vector3; vel: THREE.Vector3; active: boolean; size: number; color: string; pierce: number; blast?: number };

type Arc = { a: FxEnemy | null; ax: number; az: number; b: FxEnemy; t: number };
const arcs: Arc[] = [];
/** tesla chains jump target to target: the last robot each bolt reached */
let chainFrom: FxEnemy | null = null;

type Stuck = { p: THREE.Vector3; q: THREE.Quaternion; t: number; e: FxEnemy | null; ox: number; oz: number; s: number };
const stuck: Stuck[] = Array.from({ length: 10 }, () => ({ p: new THREE.Vector3(), q: new THREE.Quaternion(), t: 0, e: null, ox: 0, oz: 0, s: 1 }));
let stuckNext = 0;

type Casing = { p: THREE.Vector3; v: THREE.Vector3; ax: THREE.Vector3; spin: number; ang: number; t: number; bounced: boolean };
const casings: Casing[] = Array.from({ length: 40 }, () => ({
  p: new THREE.Vector3(), v: new THREE.Vector3(), ax: new THREE.Vector3(1, 0, 0), spin: 0, ang: 0, t: 0, bounced: false,
}));
let casingNext = 0;

type Flash = { t: number; kind: VisKind; flags: number; fixed: boolean; p: THREE.Vector3; d: THREE.Vector3 };
const flashes: Flash[] = Array.from({ length: 8 }, () => ({ t: 0, kind: VK.PISTOL, flags: 0, fixed: false, p: new THREE.Vector3(), d: new THREE.Vector3() }));
let flashNext = 0;

/** remote id -> performance.now() of their last shot (Remote.tsx kicks their gun) */
export const REMOTE_SHOT = new Map<string, number>();

const V1 = new THREE.Vector3();
const V2 = new THREE.Vector3();
const V3 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const QA = new THREE.Quaternion();
const QB = new THREE.Quaternion();
const CONTACT: Contact = { p: new THREE.Vector3(), n: new THREE.Vector3() };
const rnd = (a = 1) => (Math.random() * 2 - 1) * a;

let cam: THREE.Camera | null = null;
const WORLD_MUZZLE = new THREE.Vector3();
let worldMuzzle = false;
/** Third-person gun origin; first-person and remote effects retain their own paths. */
export function setWorldMuzzle(p: THREE.Vector3 | null) {
  worldMuzzle = p !== null;
  if (p) WORLD_MUZZLE.copy(p);
}
/** the local gun's muzzle this frame (world) */
const MUZZLE = new THREE.Vector3();
let viewKind: VisKind = VK.PISTOL;
let viewModel: THREE.Object3D | null = null;


/** tiny deterministic PRNG so the shooter and every viewer agree on the spread */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** pellet `s` of a `count`-pellet shot: the same spread rule Game.tsx has always used */
export function aimDir(out: THREE.Vector3, fwd: THREE.Vector3, count: number, spread: number, s: number, r: () => number) {
  const off = count > 1 ? s - (count - 1) / 2 : (r() - 0.5) * 2;
  out.copy(fwd).applyAxisAngle(UP, off * spread);
  out.y += (r() - 0.5) * spread * 0.6;
  return out.normalize();
}

// ---------------------------------------------------------------- muzzles

/** the local gun's muzzle in world space, from the camera (used at the moment of firing) */
function localMuzzle(kind: VisKind, flags: number, out: THREE.Vector3) {
  if (worldMuzzle) return out.copy(WORLD_MUZZLE);
  const lk = LOOKS[kind];
  const z = kind === VK.PISTOL && flags & VF.MAGNUM ? -0.48 : lk.muzzle[1];
  if (viewModel && viewModel.visible) {
    // the view model's pose from last frame, carried along by the camera's movement since
    out.set(0, lk.muzzle[0], z).multiplyScalar(0.7).applyQuaternion(viewModel.quaternion).add(viewModel.position);
    if (cam) out.add(V3.copy(cam.position).sub(lastCam));
    return out;
  }
  if (cam) return out.copy(cam.position);
  return out.set(0, 0, 0);
}
const lastCam = new THREE.Vector3();
const MUZ_FIRE = new THREE.Vector3();
const MUZ_REMOTE = new THREE.Vector3();

/** a teammate's gun tip, from their smoothed avatar pose (Remote.tsx draws the gun there) */
function remoteMuzzle(r: RemoteState, out: THREE.Vector3) {
  const th = r.ry + Math.PI;
  const c = Math.cos(th), s = Math.sin(th);
  const lift = alpine.active ? alpine.lift : null;
  const seat = wheelWorld.wheel && (r.wr ?? -1) >= 0 ? wheelEye(wheelWorld.wheel,r.wr!) : lift && (r.rc ?? -1) >= 0 ? riderEye(lift,r.rc!) : null;
  const gy = groundY(r.rx,r.rz);
  const feet = seat ? seat.y - 1.6 : (r.az ? remoteFloorY(r.az,r.ay,gy) : gy) + (r.jy ?? 0);
  const pitch = r.pitch ?? 0;
  return out.set((seat?.x ?? r.rx) - .24 * c + .7 * Math.cos(pitch) * s,
    feet + 1.24 + .7 * Math.sin(pitch), (seat?.z ?? r.rz) + .24 * s + .7 * Math.cos(pitch) * c);
}

// ---------------------------------------------------------------- hooks for Game.tsx

export function fxEnv(env: FxEnv) {
  FX.env = env;
}

function start(P: Proj, pos: THREE.Vector3, kind: VisKind, flags: number, size: number, from: THREE.Vector3 | null) {
  P.on = true;
  P.kind = kind;
  P.flags = flags;
  P.age = 0;
  P.trailT = 0;
  P.scale = size / LOOKS[kind].base;
  P.prev.copy(pos);
  P.spawn.copy(pos);
  // the round really starts under the crosshair; draw it leaving the muzzle and meeting the
  // flight line where it will land, so tracers read at an angle instead of end-on
  if (from) {
    P.vo.copy(from).sub(pos);
    CONV_DIR.copy(P.vel).normalize();
    P.conv = Math.max(3, Math.min(60, rayHit(pos, CONV_DIR, 60)));
  } else P.vo.set(0, 0, 0);
  if (kind === VK.HARPOON) P.vo.set(0, 0, 0);
}

/** a local round was just put in bullet slot `i` */
export function fxShot(i: number, b: BulletLike, kind: VisKind, flags = 0, from?: THREE.Vector3) {
  if (i < 0) return;
  const P = (L[i] ??= mkProj());
  P.pos = b.pos;
  P.vel = b.vel;
  P.owner = null;
  const muz = from ?? (kind === VK.FRAG ? null : localMuzzle(kind, flags, V1));
  start(P, b.pos, kind, flags, b.size, muz);
  P.blastR = b.blast ?? 0; // the drawn blast matches the local shot's (perk-widened) radius
}

/**
 * Once per trigger pull (after the rounds are in the pool): muzzle flash, casings, camera
 * kick, the LANCE beam, and the co-op broadcast.
 */
export function fxFired(
  kind: VisKind, flags: number, origin: THREE.Vector3, dir: THREE.Vector3, seed: number, speed: number,
  net: NetHandle | null, at?: THREE.Vector3,
) {
  const lk = LOOKS[kind];
  const muz = at ? MUZ_FIRE.copy(at) : localMuzzle(kind, flags, MUZ_FIRE);
  const f = flashes[flashNext]!;
  flashNext = (flashNext + 1) % flashes.length;
  f.t = lk.flash.life * (flags & VF.MAGNUM ? 1.4 : 1);
  f.kind = kind;
  f.flags = flags;
  f.fixed = !!at || worldMuzzle;
  f.p.copy(muz);
  f.d.copy(dir);
  if (!at) {
    const k = lk.kick * (flags & VF.MAGNUM ? 2 : 1);
    FX.kick.pitch += k;
    FX.kick.yaw += rnd(k * 0.35);
    if (kind === VK.PISTOL || kind === VK.SMG) ejectCasing(kind);
  }
  if (kind === VK.RAIL) railBeam(muz, origin, dir, speed * 1.5);
  queueFire(kind, flags, origin, dir, seed, speed, net);
}

export function fxBounce(i: number) {
  const P = L[i];
  if (P?.on) bounceVis(P);
}
export function fxHit(i: number, b: BulletLike, e: FxEnemy) {
  const P = L[i];
  if (!P?.on) return;
  const terminal = b.pierce <= 0;
  hitVis(P, e, terminal);
  if (terminal) P.on = false;
}
export function fxChain(e: FxEnemy, o: FxEnemy) {
  chainArc(e, o);
}
/** a FLAK / mortar shell's cluster just burst */
export function fxBurst(b: BulletLike, r?: number) {
  airBurst(b.pos.x, b.pos.y, b.pos.z, r);
}
/** a local round stopped: `wall` = it hit something solid, else it ran out of life */
export function fxDie(i: number, wall: boolean) {
  const P = L[i];
  if (!P?.on) return;
  dieVis(P, wall);
  P.on = false;
}

/** style Toby's pooled bullet mesh for its round (called right after his per-frame update) */
export function fxStyle(i: number, m: THREE.Mesh, b: BulletLike) {
  const P = L[i];
  if (!P?.on || !b.active) return;
  const lk = LOOKS[P.kind];
  const geo = GEO[lk.geo];
  if (m.geometry !== geo) m.geometry = geo;
  const mat = m.material as THREE.MeshBasicMaterial;
  if (!mat.vertexColors) {
    mat.vertexColors = true;
    mat.needsUpdate = true;
  }
  mat.color.setRGB(1, 1, 1);
  m.scale.setScalar(P.scale * (P.flags & VF.MAGNUM ? 1.35 : 1));
  const k = converge(b.pos.distanceTo(P.spawn), P);
  m.position.copy(b.pos).addScaledVector(P.vo, k);
  orient(m.quaternion, b.vel, spinOf(P));
}

/** muzzle offset remaining after `d` metres of flight: gone by the point the shot lands */
const converge = (d: number, P: Proj) => Math.max(0, 1 - d / P.conv);
const CONV_DIR = new THREE.Vector3();

function spinOf(P: Proj) {
  if (P.kind === VK.CRYO) return P.age * 22;
  if (P.kind === VK.HARPOON) return P.age * 4;
  if (P.kind === VK.FRAG) return P.age * 30;
  if (P.kind === VK.PISTOL || P.kind === VK.SMG) return P.age * 40; // rifling
  return 0;
}
function orient(q: THREE.Quaternion, vel: THREE.Vector3, spin: number) {
  if (vel.lengthSq() < 1e-6) return;
  V3.copy(vel).normalize();
  q.setFromUnitVectors(UP, V3);
  if (spin) q.multiply(QB.setFromAxisAngle(UP, spin));
}

// ---------------------------------------------------------------- shared visuals

function bounceVis(P: Proj) {
  const p = P.pos;
  glow(p.x, p.y, p.z, 1.5, 0x7cff4f, 0.18, 1, 1.2, 44);
  glow(p.x, p.y, p.z, 0.55, 0xffffff, 0.07, 1, 1, 12);
  V1.copy(P.vel).normalize();
  sparks(p.x, p.y, p.z, 12, 0x7cff4f, 7, V1.x, V1.y + 0.2, V1.z, 0.8, -10, 0.35, 0.04, 0xeaffd8);
  FX.rings?.add(p.x, p.y, p.z, 0.1, 0.9, 0.18, 0x7cff4f, false);
  sound("ricochet", p.x, p.y, p.z);
}

function hitVis(P: Proj, e: FxEnemy, terminal: boolean) {
  const lk = LOOKS[P.kind];
  const p = P.pos;
  if (!terminal) {
    punchThrough(p, P.vel, lk.col);
    return;
  }
  CONTACT.p.copy(p);
  CONTACT.n.set(-P.vel.x, 0, -P.vel.z).normalize();
  switch (P.kind) {
    case VK.CANNON:
      explosion(p.x, p.y, p.z, 2, P.blastR || BOOMER_R);
      break;
    case VK.CRYO:
      shatter(CONTACT, "robot");
      break;
    case VK.REBOUND:
      energyPop(p, 0x7cff4f);
      break;
    case VK.HARPOON:
      stick(P, e);
      impact("robot", CONTACT, P.vel, 1.2, lk.col);
      break;
    case VK.TESLA:
      glow(p.x, p.y, p.z, 1.5, 0x5f9bff, 0.22, 1, 1.3, 46);
      glow(p.x, p.y, p.z, 0.5, 0xe0ecff, 0.08, 1, 1, 12);
      sparks(p.x, p.y, p.z, 12, 0x7fb0ff, 7, 0, 0.5, 0, 1, -8, 0.3, 0.035, 0xe0ecff);
      sound("zap", p.x, p.y, p.z);
      chainFrom = e;
      break;
    case VK.RAIL:
      punchThrough(p, P.vel, lk.col);
      glow(p.x, p.y, p.z, 1.8, lk.col, 0.26, 1, 1.4, 64);
      break;
    case VK.FLAK:
    case VK.MORTAR:
      break; // the burst is the effect
    default:
      impact("robot", CONTACT, P.vel, lk.power * (P.flags & VF.MAGNUM ? 1.8 : 1), lk.col);
      if (P.flags & VF.INCEND) fireBurst(p, false);
  }
}

function dieVis(P: Proj, wall: boolean) {
  const lk = LOOKS[P.kind];
  const surf: Surface = wall ? classify(P.prev, P.pos, P.vel, CONTACT) : "air";
  if (!wall) {
    CONTACT.p.copy(P.pos);
    CONTACT.n.set(0, 1, 0);
  }
  const c = CONTACT.p;
  switch (P.kind) {
    case VK.CANNON:
      explosion(c.x, c.y, c.z, 2, P.blastR || BOOMER_R);
      return;
    case VK.CRYO:
      shatter(CONTACT, surf);
      return;
    case VK.REBOUND:
      energyPop(c, 0x7cff4f);
      return;
    case VK.FLAK:
    case VK.MORTAR:
      return;
    case VK.HARPOON:
      if (surf === "wall" || surf === "ground") {
        stick(P, null);
        chips(c.x, c.y, c.z, 4, 0x2a2622, 3, CONTACT.n.x, CONTACT.n.y, CONTACT.n.z);
        puffs(c.x, c.y, c.z, 2, FX.env?.dust ?? 0x9a9080, 0.2, 0.6, 0.4);
        sound("thunk", c.x, c.y, c.z);
      } else if (surf !== "air") impact(surf, CONTACT, P.vel, 1, lk.col, false);
      return;
    case VK.TESLA:
      glow(c.x, c.y, c.z, 1.1, 0x5f9bff, 0.18, 1, 1.2, 38);
      sparks(c.x, c.y, c.z, 10, 0x7fb0ff, 5, CONTACT.n.x, CONTACT.n.y, CONTACT.n.z, 1, -8, 0.3, 0.03, 0xe0ecff);
      if (surf === "wall" || surf === "ground") FX.decals?.add(c.x, c.y, c.z, CONTACT.n.x, CONTACT.n.y, CONTACT.n.z, 0.5, 1, 5, 0.6);
      if (surf !== "air") sound("zap", c.x, c.y, c.z);
      return;
    case VK.RAIL:
      if (surf !== "air") {
        impact(surf, CONTACT, P.vel, 2, lk.col);
        glow(c.x, c.y, c.z, 1.4, lk.col, 0.22, 1, 1.3, 46);
        FX.rings?.add(c.x + CONTACT.n.x * 0.05, c.y + CONTACT.n.y * 0.05, c.z + CONTACT.n.z * 0.05, 0.1, 0.8, 0.2, lk.col, false);
      }
      return;
    default:
      if (surf === "air") return;
      impact(surf, CONTACT, P.vel, lk.power * (P.flags & VF.MAGNUM ? 1.8 : 1), lk.col, P.kind !== VK.FRAG);
      if (P.flags & VF.INCEND) fireBurst(c, surf === "wall" || surf === "ground");
  }
}

function energyPop(p: THREE.Vector3, col: number) {
  glow(p.x, p.y, p.z, 1.6, col, 0.2, 1, 1.3, 46);
  glow(p.x, p.y, p.z, 0.55, 0xffffff, 0.08, 1, 1, 12);
  sparks(p.x, p.y, p.z, 16, col, 6, 0, 0.3, 0, 1.2, -6, 0.4, 0.04, 0xeaffd8);
  FX.rings?.add(p.x, p.y, p.z, 0.1, 1.2, 0.22, col, false);
  sound("fizz", p.x, p.y, p.z);
}

/** incendiary round: a lick of flame and a scorch where it lands */
function fireBurst(p: THREE.Vector3, scorch: boolean) {
  const pool = FX.add;
  if (pool) {
    for (let k = 0; k < 7; k++) {
      const s = spec();
      s.x = p.x + rnd(0.15); s.y = p.y + rnd(0.1); s.z = p.z + rnd(0.15);
      s.vx = rnd(0.8); s.vy = 1 + Math.random() * 1.6; s.vz = rnd(0.8);
      s.drag = 2; s.w0 = 0.25 + Math.random() * 0.2; s.w1 = 0.05; s.c0 = 0xffd060; s.c1 = 0xd02008; s.a = 0.9;
      s.life = 0.3 + Math.random() * 0.3; s.flicker = true;
      pool.emit(s);
    }
  }
  if (scorch && FX.decals) FX.decals.add(p.x, p.y, p.z, CONTACT.n.x, CONTACT.n.y, CONTACT.n.z, 0.6, 1, 6, 1);
}

function stick(P: Proj, e: FxEnemy | null) {
  const s = stuck[stuckNext]!;
  stuckNext = (stuckNext + 1) % stuck.length;
  V1.copy(P.vel).normalize();
  // bury the head: centre sits a bit back from the contact point
  s.p.copy(e ? P.pos : CONTACT.p).addScaledVector(V1, -0.35 * P.scale);
  orient(s.q, P.vel, 0);
  s.t = e ? 1.4 : 2.6;
  s.e = e;
  s.s = P.scale;
  if (e) { s.ox = s.p.x - e.x; s.oz = s.p.z - e.z; }
}

function chainArc(e: FxEnemy, o: FxEnemy) {
  const from = chainFrom && chainFrom !== o ? chainFrom : e;
  if (arcs.length >= 24) arcs.shift();
  arcs.push({ a: from, ax: from.x, az: from.z, b: o, t: 0.3 });
  fxNetStats.arcs++;
  chainFrom = o;
  sound("zap", o.x, 1, o.z);
}

/** LANCE: an instant, crisp beam from the muzzle to whatever it will strike, with an ionised spiral */
const RB1 = new THREE.Vector3(), RB2 = new THREE.Vector3(), RB3 = new THREE.Vector3(), RBW = new THREE.Vector3();
/** how far a straight shot travels before it meets a wall, the ground, a car or a robot */
function rayHit(origin: THREE.Vector3, dir: THREE.Vector3, range: number) {
  const env = FX.env;
  let t = range;
  if (!env) return t;
  const h = env.half();
  for (let s = 0.3; s < range; s += 0.35) {
    const x = origin.x + dir.x * s, y = origin.y + dir.y * s, z = origin.z + dir.z * s;
    if (y < groundY(x, z) || Math.abs(x) > h || Math.abs(z) > h || (shotHits(x, y, z) ?? env.solid(x, z, y)) || env.car(x, y, z)) { t = s; break; }
  }
  // robots: closest approach on the ground plane
  const fl = Math.hypot(dir.x, dir.z) || 1;
  for (const e of env.enemies) {
    if (!e.alive) continue;
    const ex = e.x - origin.x, ez = e.z - origin.z;
    const along = (ex * dir.x + ez * dir.z) / fl;
    if (along <= 0) continue;
    const s3 = along / fl;
    if (s3 >= t) continue;
    const cx = ex - (dir.x / fl) * along, cz = ez - (dir.z / fl) * along;
    if (Math.hypot(cx, cz) < env.radius(e.kind) + 0.2 && origin.y + dir.y * s3 < env.height(e.kind)) t = s3;
  }
  return t;
}

function railBeam(muz: THREE.Vector3, origin: THREE.Vector3, dir: THREE.Vector3, range: number) {
  const t = rayHit(origin, dir, range);
  RB3.copy(origin).addScaledVector(dir, t);
  const ax = muz.x, ay = muz.y, az = muz.z, bx = RB3.x, by = RB3.y, bz = RB3.z;
  // white-hot core inside a wide violet sheath, both with a floor on screen width
  beam(ax, ay, az, bx, by, bz, 0.12, 0.04, 0xffffff, 1, 0.32, 0, 0, 0, 3.5);
  beam(ax, ay, az, bx, by, bz, 0.3, 0.12, 0xffb8ff, 0.8, 0.38, 0, 0, 0, 7);
  beam(ax, ay, az, bx, by, bz, 0.7, 1.1, 0xe04bff, 0.6, 0.5, 0, 0, 0, 16);
  // helix of ionised air around the beam line
  const len = Math.hypot(bx - ax, by - ay, bz - az);
  RB1.set(bx - ax, by - ay, bz - az).normalize();
  RB2.set(0, 1, 0).cross(V1);
  if (RB2.lengthSq() < 1e-4) RB2.set(1, 0, 0);
  RB2.normalize();
  const w = RBW.crossVectors(RB1, RB2);
  const steps = Math.min(150, Math.floor(len / 0.22));
  let px = ax, py = ay, pz = az;
  for (let s = 1; s <= steps; s++) {
    const d = (s / steps) * len;
    const a = d * 2.4;
    const r = 0.1 + d * 0.004;
    const ca = Math.cos(a) * r, sa = Math.sin(a) * r;
    const qx = ax + RB1.x * d + RB2.x * ca + w.x * sa;
    const qy = ay + RB1.y * d + RB2.y * ca + w.y * sa;
    const qz = az + RB1.z * d + RB2.z * ca + w.z * sa;
    if (s > 1) beam(px, py, pz, qx, qy, qz, 0.035, 0.012, 0xc070ff, 0.7, 0.55 + (s / steps) * 0.25, (RB2.x * ca + w.x * sa) * 3, (RB2.y * ca + w.y * sa) * 3 + 0.15, (RB2.z * ca + w.z * sa) * 3, 2);
    px = qx; py = qy; pz = qz;
  }
  glow(bx, by, bz, 1.3, 0xe04bff, 0.26, 1, 1.3, 46);
}

function ejectCasing(kind: VisKind) {
  if (!viewModel || !cam) return;
  const c = casings[casingNext]!;
  casingNext = (casingNext + 1) % casings.length;
  // ejection port: right side of the receiver
  c.p.set(0.06, 0.05, kind === VK.SMG ? -0.12 : -0.1).multiplyScalar(0.7).applyQuaternion(viewModel.quaternion).add(viewModel.position);
  V1.set(1, 0, 0).applyQuaternion(cam.quaternion);
  V2.set(0, 1, 0);
  V3.set(0, 0, 1).applyQuaternion(cam.quaternion);
  c.v.set(0, 0, 0).addScaledVector(V1, 1.6 + Math.random()).addScaledVector(V2, 1.8 + Math.random()).addScaledVector(V3, 0.4 + rnd(0.3));
  c.ax.set(rnd(), rnd(), rnd()).normalize();
  c.spin = 18 + Math.random() * 14;
  c.ang = 0;
  c.t = 1.4;
  c.bounced = false;
}

// ---------------------------------------------------------------- per-frame flight visuals

function trail(P: Proj, dt: number) {
  const lk = LOOKS[P.kind];
  const add = FX.add;
  if (!add) return;
  const travelled = P.pos.distanceTo(P.spawn);
  const k = converge(travelled, P);
  // visual head: drawn leaving the gun's muzzle and converging onto the real flight line
  const hx = P.pos.x + P.vo.x * k, hy = P.pos.y + P.vo.y * k, hz = P.pos.z + P.vo.z * k;
  const sp = P.vel.length() || 1;
  const dx = P.vel.x / sp, dy = P.vel.y / sp, dz = P.vel.z / sp;
  const streak = (len: number, core: number, glowW: number, cCol: number, gCol: number, a = 1, pxC = 2.6, pxG = 8) => {
    // hot spot at the head: stays a few pixels wide however far away the round is
    glow(hx, hy, hz, glowW * 2, gCol, 0, 0.85 * a, 1, pxG + 6);
    const l = Math.min(len * 1.6, travelled);
    if (l <= 0.01) return;
    const kt = converge(travelled - l, P);
    const tx = P.pos.x - dx * l + P.vo.x * kt, ty = P.pos.y - dy * l + P.vo.y * kt, tz = P.pos.z - dz * l + P.vo.z * kt;
    seg(tx, ty, tz, hx, hy, hz, glowW * 1.6, gCol, 0.75 * a, FX.add, pxG);
    const mx = tx + (hx - tx) * 0.3, my = ty + (hy - ty) * 0.3, mz = tz + (hz - tz) * 0.3;
    seg(mx, my, mz, hx, hy, hz, core * 1.5, cCol, a, FX.add, pxC);
  };
  P.trailT -= dt;
  const tick = (every: number) => {
    if (P.trailT > 0) return false;
    P.trailT += every;
    if (P.trailT < 0) P.trailT = every;
    return true;
  };
  const tx = hx - dx * 0.3 * P.scale, ty = hy - dy * 0.3 * P.scale, tz = hz - dz * 0.3 * P.scale;
  switch (P.kind) {
    case VK.PISTOL: {
      const mag = P.flags & VF.MAGNUM, inc = P.flags & VF.INCEND, crit = P.flags & VF.CRIT;
      if (mag) {
        streak(2.4, 0.05, 0.22, 0xfff4d0, 0xffc060, 1);
        glow(hx, hy, hz, 0.3, 0xffd080, 0, 0.7);
      } else streak(lk.len, crit ? 0.045 : lk.coreW, lk.glowW, crit ? 0xffffff : lk.core, inc ? 0xff4a18 : lk.glowCol);
      if (inc && tick(0.012)) {
        const s = spec();
        s.x = hx; s.y = hy; s.z = hz; s.vx = -dx * 1.5 + rnd(0.8); s.vy = rnd(0.6) + 0.4; s.vz = -dz * 1.5 + rnd(0.8);
        s.grav = 1.6; s.drag = 1.2; s.w0 = 0.07; s.w1 = 0.02; s.c0 = 0xffd060; s.c1 = 0xff2000; s.life = 0.35 + Math.random() * 0.25;
        s.flicker = true;
        add.emit(s);
      }
      break;
    }
    case VK.SMG:
      if (P.flags & VF.TRACER) streak(4, 0.04, 0.18, 0xe8fdff, 0x4fe3ff, 1, 3, 8);
      else streak(lk.len, lk.coreW, lk.glowW, lk.core, lk.glowCol, 0.7, 1.6, 3.5);
      break;
    case VK.TURRET:
    case VK.SCATTER:
    case VK.FRAG:
    case VK.REVOLVER:
    case VK.MINIGUN:
    case VK.CROSSBOW:
      streak(lk.len, lk.coreW, lk.glowW, lk.core, lk.glowCol);
      break;
    case VK.PLASMA:
    case VK.VOIDORB:
      streak(lk.len, lk.coreW, lk.glowW, lk.core, lk.glowCol, 0.6);
      glow(hx, hy, hz, lk.glowW * 6, lk.glowCol, 0, 0.7, 1, 16);
      glow(hx, hy, hz, lk.glowW * 2, 0xffffff, 0, 0.9, 1, 6);
      break;
    case VK.RAIL:
      streak(lk.len, lk.coreW, lk.glowW, lk.core, lk.glowCol);
      glow(hx, hy, hz, 0.5, 0xffd0ff, 0, 0.9, 1, 12);
      break;
    case VK.CANNON:
      seg(tx, ty, tz, tx, ty, tz, 0.6, 0xff6a2a, 0.7 + Math.random() * 0.3, FX.add, 14);
      streak(0.9, 0.06, 0.25, 0xffb080, 0xff3b2a, 0.5);
      if (tick(0.022)) {
        puffs(tx, ty, tz, 1, 0x6a6660, 0.26, 1.3, 0.5, 0.15, 0.2, 0, -0.1, 0, 4.2, 0x2c2a28);
        if (Math.random() < 0.4) sparks(tx, ty, tz, 1, 0xff6a20, 1.5, -dx, 0.2, -dz, 0.6, -4, 0.3, 0.03);
      }
      break;
    case VK.REBOUND: {
      glow(hx, hy, hz, 0.95, 0x7cff4f, 0, 0.55, 1, 16);
      glow(hx, hy, hz, 0.36, 0xeaffd8, 0, 0.9, 1, 7);
      // motion trail: a ribbon of fading discs
      const s = spec();
      s.x = hx; s.y = hy; s.z = hz; s.w0 = 0.4; s.w1 = 0.05; s.c0 = 0x7cff4f; s.c1 = 0x2a8a10; s.a = 0.65; s.life = 0.3; s.fpow = 1.3; s.px = 6;
      add.emit(s);
      break;
    }
    case VK.HARPOON:
      streak(1, 0.02, 0.06, 0xffffff, 0xd8ccb0, 0.5, 1.5, 4);
      tether(P, tx, ty, tz);
      break;
    case VK.CRYO:
    case VK.SHATTER:
      streak(lk.len, lk.coreW, lk.glowW, lk.core, lk.glowCol, 0.6);
      if (tick(0.018)) {
        puffs(tx, ty, tz, 1, 0xe4f8ff, 0.13, 0.65, 0.32, 0.12, 0.04, 0, 0, 0, 3.6, 0x9fd8f0);
        const s = spec();
        s.x = hx + rnd(0.12); s.y = hy + rnd(0.12); s.z = hz + rnd(0.12); s.vy = -0.3; s.w0 = 0.05; s.w1 = 0.01;
        s.c0 = 0xffffff; s.c1 = 0x9fe8ff; s.life = 0.35; s.flicker = true;
        add.emit(s);
      }
      break;
    case VK.FLAK:
    case VK.MORTAR:
      streak(lk.len, lk.coreW, lk.glowW, lk.core, lk.glowCol, 0.6);
      seg(tx, ty, tz, tx, ty, tz, 0.2, 0xffc070, 0.6 + Math.random() * 0.4, FX.add, 9);
      if (tick(0.03)) puffs(tx, ty, tz, 1, 0x7a746a, 0.14, 0.8, 0.35, 0.1, 0.15, 0, 0, 0, 3.5);
      break;
    case VK.TESLA:
      streak(lk.len, lk.coreW, lk.glowW, lk.core, lk.glowCol, 0.6);
      glow(hx, hy, hz, 0.7, 0x5f9bff, 0, 0.7, 1, 16);
      glow(hx, hy, hz, 0.22, 0xffffff, 0, 1, 1, 6);
      for (let a = 0; a < 3; a++) {
        V1.set(rnd(), rnd(), rnd()).normalize().multiplyScalar(0.3 + Math.random() * 0.25);
        bolt(hx, hy, hz, hx + V1.x, hy + V1.y, hz + V1.z, 0.014, 0x7fb0ff, 0.1, 0);
      }
      break;
  }
}

/** HARPOON's line back to whoever threw it, with a little sag */
function tether(P: Proj, tx: number, ty: number, tz: number) {
  let ax: number, ay: number, az: number;
  if (P.owner === null) {
    if (!worldMuzzle && !viewModel?.visible) return;
    ax = MUZZLE.x; ay = MUZZLE.y; az = MUZZLE.z;
  } else {
    const r = remotesRef?.get(P.owner);
    if (!r) return;
    remoteMuzzle(r, V2);
    ax = V2.x; ay = V2.y; az = V2.z;
  }
  const len = Math.hypot(tx - ax, ty - ay, tz - az);
  const sag = Math.min(0.9, len * 0.03);
  const N = 8;
  let px = ax, py = ay, pz = az;
  for (let s = 1; s <= N; s++) {
    const t = s / N;
    const qx = ax + (tx - ax) * t, qz = az + (tz - az) * t;
    const qy = ay + (ty - ay) * t - sag * 4 * t * (1 - t);
    seg(px, py, pz, qx, qy, qz, 0.03, 0xeee4cc, 0.95, FX.alpha, 2.5);
    px = qx; py = qy; pz = qz;
  }
}

function drawFlash(f: Flash, dt: number) {
  if (f.t <= 0) return;
  f.t -= dt;
  const lk = LOOKS[f.kind];
  const fl = lk.flash;
  const p = f.fixed ? f.p : MUZZLE;
  if (!f.fixed && !viewModel?.visible) return;
  const mag = f.flags & VF.MAGNUM ? 1.5 : 1;
  const d = f.d;
  // the flash sits just in front of the barrel
  const cx = p.x + d.x * 0.06, cy = p.y + d.y * 0.06, cz = p.z + d.z * 0.06;
  const far = f.fixed ? 1 : 0; // seen from afar (teammates, turrets): keep a floor on screen size
  if (fl.w > 0) {
    seg(cx, cy, cz, cx, cy, cz, fl.w * 1.4 * mag * (0.8 + Math.random() * 0.4), fl.col, 0.95, FX.add, far * (14 + fl.w * 30));
    seg(cx, cy, cz, cx, cy, cz, fl.w * 0.6 * mag, 0xffffff, 0.95, FX.add, far * 6);
  }
  if (fl.len > 0) {
    // forward cone plus a star of side spikes
    const L2 = fl.len * 1.4 * mag * (0.7 + Math.random() * 0.6);
    seg(cx, cy, cz, cx + d.x * L2, cy + d.y * L2, cz + d.z * L2, fl.w * 0.6 * mag, fl.col, 0.85, FX.add, far * 5);
    for (let s = 0; s < fl.spikes; s++) {
      V1.set(rnd(), rnd(), rnd());
      V1.addScaledVector(d, -V1.dot(d)).normalize().addScaledVector(d, 0.5).normalize();
      const sl = fl.len * 0.7 * mag * (0.5 + Math.random());
      seg(cx, cy, cz, cx + V1.x * sl, cy + V1.y * sl, cz + V1.z * sl, 0.05 * mag, fl.col, 0.8, FX.add, far * 2);
    }
  }
  if (f.kind === VK.TESLA) {
    for (let a = 0; a < 3; a++) {
      V1.set(rnd(), rnd(), rnd()).normalize().multiplyScalar(0.25).addScaledVector(d, 0.3);
      bolt(cx, cy, cz, cx + V1.x, cy + V1.y, cz + V1.z, 0.012, 0x7fb0ff, 0.08, 0);
    }
  }
  if (f.kind === VK.RAIL && f.t + dt >= fl.life) FX.rings?.add(cx, cy, cz, 0.03, 0.16, 0.12, 0x9a30b0, false);
  // smoke is emitted once, on the first frame
  if (fl.smoke > 0 && f.t + dt >= fl.life * (f.flags & VF.MAGNUM ? 1.4 : 1)) {
    puffs(cx, cy, cz, fl.smoke, f.kind === VK.HARPOON ? 0xd8d4cc : 0x8a8680, 0.12, 0.9, 0.3, 0.25, 0.2, d.x * 1.4, d.y * 1.4, d.z * 1.4, 4);
  }
  if (f.kind === VK.CRYO && f.t + dt >= fl.life) puffs(cx, cy, cz, 2, 0xe4f8ff, 0.1, 0.5, 0.35, 0.2, 0.05, d.x, d.y, d.z, 3);
}

// ---------------------------------------------------------------- co-op: fire events

const pending: number[] = [];
let lastSend = 0;
let netRef: NetHandle | null = null;
/** bytes / messages sent, for the co-op bandwidth check (?debug=1 exposes it) */
export const fxNetStats = { msgs: 0, bytes: 0, shots: 0, recv: 0, recvShots: 0, arcs: 0, cpuMs: 0, frames: 0 };
const GROUP = 11;
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

function queueFire(kind: VisKind, flags: number, o: THREE.Vector3, d: THREE.Vector3, seed: number, speed: number, net: NetHandle | null) {
  if (!net) return;
  netRef = net;
  fxNetStats.shots++;
  // a burst of the same gun inside one 50 ms window rides along as a count
  for (let j = 0; j < pending.length; j += GROUP) {
    if (pending[j] === kind) {
      pending[j + 10] = pending[j + 10]! + 1;
      pending[j + 1] = r2(o.x); pending[j + 2] = r2(o.y); pending[j + 3] = r2(o.z);
      pending[j + 4] = r3(d.x); pending[j + 5] = r3(d.y); pending[j + 6] = r3(d.z);
      return;
    }
  }
  pending.push(kind, r2(o.x), r2(o.y), r2(o.z), r3(d.x), r3(d.y), r3(d.z), seed, flags, Math.round(speed * 10) / 10, 1);
}

function flushFire() {
  if (!pending.length || !netRef) return;
  const now = performance.now();
  if (now - lastSend < 50) return;
  lastSend = now;
  const msg = { type: "fire", s: pending.slice() };
  netRef.broadcast(msg);
  fxNetStats.msgs++;
  fxNetStats.bytes += JSON.stringify(msg).length;
  pending.length = 0;
}

let remotesRef: Map<string, RemoteState> | null = null;
type GhostGun = { count: number; spread: number; life: number; size: number; bounce?: number; pierce?: number; cluster?: number; chain?: number };
/** ghost stats by VK number (Game.tsx passes every gun under its visOf number) */
let ghostGuns: Partial<Record<number, GhostGun>> = {};
/** Game.tsx hands over its gun table so ghost rounds fly exactly like the real ones */
export function fxGuns(guns: Partial<Record<number, GhostGun>>) {
  ghostGuns = guns;
}
const EXTRA_GUNS: Partial<Record<VisKind, GhostGun>> = {
  [VK.TURRET]: { count: 1, spread: 0, life: 0.4, size: 0.11 },
  [VK.MORTAR]: { count: 1, spread: 0, life: 2.2, size: 0.34, cluster: 5 },
};

/** a teammate fired: replay it as visual-only rounds from their gun */
export function fxRemoteFire(m: NetMsg, remotes: Map<string, RemoteState>) {
  remotesRef = remotes;
  const s = Array.isArray(m.s) ? (m.s as number[]) : [];
  const id = String(m.from ?? "host");
  fxNetStats.recv++;
  const r = remotes.get(id);
  for (let j = 0; j + GROUP <= s.length; j += GROUP) {
    const kind = s[j]! as VisKind;
    const g = isGun(kind) ? ghostGuns[kind] : EXTRA_GUNS[kind];
    if (!g || !LOOKS[kind]) continue;
    const flags = s[j + 8]!, speed = s[j + 9]!, n = Math.min(4, s[j + 10]!);
    V1.set(s[j + 1]!, s[j + 2]!, s[j + 3]!);
    V2.set(s[j + 4]!, s[j + 5]!, s[j + 6]!).normalize();
    const muz = kind === VK.TURRET || !r ? V1 : remoteMuzzle(r, MUZ_REMOTE);
    if (kind !== VK.TURRET) REMOTE_SHOT.set(id, performance.now());
    const f = flashes[flashNext]!;
    flashNext = (flashNext + 1) % flashes.length;
    Object.assign(f, { t: LOOKS[kind].flash.life, kind, flags, fixed: true });
    f.p.copy(muz);
    f.d.copy(V2);
    const dist = Math.hypot(muz.x - FX.ear.x, muz.z - FX.ear.z);
    if (dist < 60 && isGun(kind)) playGun(GUN_IDS[kind as number] || "pistol", dist > 14);
    if (kind === VK.RAIL) railBeam(muz, V1, V2, speed * g.life);
    fxNetStats.recvShots += n;
    for (let c = 0; c < n; c++) {
      const rand = rng(s[j + 7]! + c);
      for (let p = 0; p < g.count; p++) {
        const d = aimDir(V3, V2, g.count, g.spread, p, rand);
        spawnGhost(kind, flags, V1, d.multiplyScalar(speed), g, muz, id);
      }
    }
  }
}

function spawnGhost(kind: VisKind, flags: number, pos: THREE.Vector3, vel: THREE.Vector3, g: GhostGun, from: THREE.Vector3 | null, owner: string | null) {
  let P: Proj | undefined;
  for (const q of G) if (!q.on) { P = q; break; }
  if (!P) return;
  P.pos.copy(pos);
  P.vel.copy(vel);
  P.owner = owner;
  start(P, pos, kind, flags, g.size, from);
  P.life = g.life;
  P.bounce = g.bounce ?? 0;
  P.pierce = (g.pierce ?? 0) + (flags & VF.MAGNUM ? 1 : 0);
  P.cluster = g.cluster ?? 0;
  P.chain = g.chain ?? 0;
}

function ghostStep(P: Proj, dt: number) {
  const env = FX.env;
  P.prev.copy(P.pos);
  const px = P.pos.x, pz = P.pos.z;
  P.pos.addScaledVector(P.vel, dt);
  P.life -= dt;
  const p = P.pos;
  const h = env ? env.half() : 1e9;
  const wall = !!env && (p.y < groundY(p.x, p.z) || Math.abs(p.x) > h || Math.abs(p.z) > h || (shotHits(p.x, p.y, p.z) ?? env.solid(p.x, p.z, p.y)) || env.car(p.x, p.y, p.z));
  if (wall && P.bounce > 0 && env) {
    P.bounce--;
    if (env.solid(p.x, pz, p.y) || Math.abs(p.x) > h) P.vel.x *= -1;
    else P.vel.z *= -1;
    p.set(px, p.y, pz);
    bounceVis(P);
    return;
  }
  if (P.life <= 0 || wall) {
    ghostDie(P, wall);
    return;
  }
  const e = robotAt(p, 0.2);
  if (e) {
    const terminal = P.pierce <= 0;
    hitVis(P, e, terminal);
    if (P.kind === VK.TESLA && P.chain > 0 && env) {
      let left = P.chain;
      for (const o of env.enemies) {
        if (left <= 0) break;
        if (!o.alive || o === e) continue;
        if (Math.hypot(o.x - e.x, o.z - e.z) < 6) { chainArc(e, o); left--; }
      }
    }
    if (terminal) ghostDie(P, false, true);
    else P.pierce--;
  }
}

function ghostDie(P: Proj, wall: boolean, alreadyHit = false) {
  if (!alreadyHit) dieVis(P, wall);
  if (P.cluster > 0) {
    airBurst(P.pos.x, P.pos.y, P.pos.z);
    for (let s = 0; s < P.cluster; s++) {
      const a = (s / P.cluster) * Math.PI * 2 + Math.random();
      V3.set(Math.sin(a), 0.1, Math.cos(a)).multiplyScalar(14);
      spawnGhost(VK.FRAG, 0, P.pos, V3, { count: 1, spread: 0, life: 0.45, size: 0.14 }, null, null);
    }
    P.cluster = 0;
  }
  P.on = false;
}

// ---------------------------------------------------------------- the frame

const ghostPools: Partial<Record<GeoKey, MeshPool>> = {};
let ghostList: MeshPool[] = [];
let casingPool: MeshPool | null = null;
const QC = new THREE.Quaternion();

/**
 * Runs once per frame after the gun has been posed (end of Game.tsx's view-model frame):
 * steps every pool, draws flight visuals, and flushes the co-op fire queue.
 */
export function fxFrame(dt: number, camera: THREE.Camera, vm: THREE.Object3D | null, bullets: BulletLike[], weapon: string) {
  const t0 = performance.now();
  frame(dt, camera, vm, bullets, weapon);
  fxNetStats.cpuMs += performance.now() - t0;
  fxNetStats.frames++;
}
function frame(dt: number, camera: THREE.Camera, vm: THREE.Object3D | null, bullets: BulletLike[], weapon: string) {
  cam = camera;
  viewModel = vm;
  FX.ear.copy(camera.position);
  viewKind = visOf(weapon);
  const add = FX.add, alpha = FX.alpha;
  if (!add || !alpha) return;
  add.step(dt);
  alpha.step(dt);
  const fov = (camera as THREE.PerspectiveCamera).fov ?? 75;
  const px = (2 * Math.tan((fov * Math.PI) / 360)) / Math.max(200, FX.viewH);
  add.setPixel(px);
  alpha.setPixel(px);

  if (worldMuzzle) MUZZLE.copy(WORLD_MUZZLE);
  else if (vm && vm.visible) {
    const lk = LOOKS[viewKind];
    MUZZLE.set(0, lk.muzzle[0], lk.muzzle[1]).multiplyScalar(0.7).applyQuaternion(vm.quaternion).add(vm.position);
  }

  // local rounds
  for (let i = 0; i < bullets.length; i++) {
    const b = bullets[i]!;
    let P = L[i];
    if (b.active && (!P || !P.on)) {
      // a round we were not told about (a new shooter somewhere): give it a plain tracer
      P = L[i] ??= mkProj();
      P.pos = b.pos; P.vel = b.vel; P.owner = null;
      start(P, b.pos, VK.TURRET, 0, b.size, null);
    }
    if (!P) continue;
    if (!b.active) { P.on = false; continue; }
    P.age += dt;
    trail(P, dt);
    P.prev.copy(b.pos);
  }

  // ghosts
  for (const pool of ghostList) pool.begin();
  for (const P of G) {
    if (!P.on) continue;
    P.age += dt;
    ghostStep(P, dt);
    if (!P.on) continue;
    trail(P, dt);
    const lk = LOOKS[P.kind];
    const pool = ghostPools[lk.geo];
    if (pool) {
      const k = converge(P.pos.distanceTo(P.spawn), P);
      V1.copy(P.pos).addScaledVector(P.vo, k);
      orient(QA, P.vel, spinOf(P));
      pool.add(V1, QA, P.scale);
    }
  }
  for (const pool of ghostList) pool.end();

  // tesla arcs crackle: a fresh jagged path every frame
  for (let a = arcs.length - 1; a >= 0; a--) {
    const arc = arcs[a]!;
    arc.t -= dt;
    if (arc.t <= 0) { arcs.splice(a, 1); continue; }
    let ax = arc.a ? arc.a.x : arc.ax, az = arc.a ? arc.a.z : arc.az;
    let bx = arc.b.x, bz = arc.b.z;
    // run surface to surface, not centre to centre, so the bodies don't swallow the arc
    const dl = Math.hypot(bx - ax, bz - az) || 1;
    const env = FX.env;
    const ra = arc.a && env ? env.radius(arc.a.kind) * 0.9 : 0, rb = env ? env.radius(arc.b.kind) * 0.9 : 0;
    if (dl > ra + rb + 0.2) {
      const ux = (bx - ax) / dl, uz = (bz - az) / dl;
      ax += ux * ra; az += uz * ra; bx -= ux * rb; bz -= uz * rb;
    }
    // arch over the bodies, head to head, with a hot spot where it bites
    const ya = arc.a && env ? env.height(arc.a.kind) * 0.8 : 1.4, yb = env ? env.height(arc.b.kind) * 0.8 : 1.4;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2, my = Math.max(ya, yb) + 0.25 + dl * 0.08;
    bolt(ax, ya, az, mx, my, mz, 0.1, 0x6fa8ff, 0.4, 1);
    bolt(mx, my, mz, bx, yb, bz, 0.1, 0x6fa8ff, 0.4, 1);
    glow(ax, ya, az, 1, 0x6fa8ff, 0, 0.8, 1, 22);
    glow(bx, yb, bz, 1.1, 0x9fc4ff, 0, 0.9, 1, 26);
  }

  // muzzle flashes
  for (const f of flashes) drawFlash(f, dt);

  // spent casings
  if (casingPool) {
    casingPool.begin();
    for (const c of casings) {
      if (c.t <= 0) continue;
      c.t -= dt;
      c.v.y -= 12 * dt;
      c.p.addScaledVector(c.v, dt);
      c.ang += c.spin * dt;
      const cg = groundY(c.p.x, c.p.z) + 0.012;
      if (c.p.y < cg) {
        c.p.y = cg;
        if (!c.bounced) sound("casing", c.p.x, 0, c.p.z);
        c.bounced = true;
        c.v.y = Math.abs(c.v.y) * 0.3;
        c.v.x *= 0.5; c.v.z *= 0.5;
        c.spin *= 0.5;
      }
      QC.setFromAxisAngle(c.ax, c.ang);
      casingPool.add(c.p, QC, 1);
    }
    casingPool.end();
  }

  // harpoons left sticking in things
  const sp = FX.stuck;
  if (sp) {
    sp.begin();
    for (const s of stuck) {
      if (s.t <= 0) continue;
      s.t -= dt;
      if (s.e) {
        if (s.e.alive) { s.p.x = s.e.x + s.ox; s.p.z = s.e.z + s.oz; } else s.e = null;
      }
      sp.add(s.p, s.q, s.s * Math.min(1, s.t / 0.25));
    }
    sp.end();
  }

  // camera kick springs back; explosions shake
  const K = FX.kick;
  const dk = Math.exp(-dt * 12);
  K.pitch *= dk;
  K.yaw *= dk;
  K.shake = Math.max(0, K.shake - dt * 2.4);

  FX.decals?.step(dt);
  FX.rings?.step(dt, camera);
  add.upload();
  alpha.upload();
  lastCam.copy(camera.position);
  flushFire();
}

/** extra camera angles to add on top of the player's look (kick + explosion shake) */
export function fxKick() {
  const K = FX.kick;
  const j = K.shake * 0.025;
  return { pitch: K.pitch + (j ? (Math.random() * 2 - 1) * j : 0), yaw: K.yaw + (j ? (Math.random() * 2 - 1) * j : 0) };
}

export function fxReset() {
  FX.add?.clear();
  FX.alpha?.clear();
  FX.decals?.clear();
  FX.rings?.clear();
  for (const P of L) P.on = false;
  for (const P of G) P.on = false;
  arcs.length = 0;
  for (const s of stuck) s.t = 0;
  for (const c of casings) c.t = 0;
  for (const f of flashes) f.t = 0;
  pending.length = 0;
  chainFrom = null;
}

export type FxObjects = {
  add: SegPool; alpha: SegPool; decals: DecalPool; rings: RingPool; stuckPool: MeshPool; casing: MeshPool;
  ghosts: Partial<Record<GeoKey, MeshPool>>;
};
/** build every pooled effect mesh (CombatFx.tsx puts them in the scene) */
export function fxCreate(): FxObjects {
  const add = new SegPool(4096, true);
  const alpha = new SegPool(2048, false);
  const decals = new DecalPool(96);
  const rings = new RingPool(16);
  const basic = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
  const stuckPool = new MeshPool(GEO.harpoon, basic, 10);
  const casing = new MeshPool(GEO.casing, new THREE.MeshBasicMaterial({ vertexColors: true }), 40);
  const ghosts: Partial<Record<GeoKey, MeshPool>> = {};
  for (const k of ["bullet", "pellet", "slug", "shell", "flak", "orbGreen", "orbBlue", "orbPink", "orbVoid", "harpoon", "ice"] as GeoKey[]) {
    ghosts[k] = new MeshPool(GEO[k], basic, k === "pellet" || k === "bullet" ? 64 : 24);
  }
  return { add, alpha, decals, rings, stuckPool, casing, ghosts };
}
export function fxMount(o: FxObjects) {
  FX.add = o.add;
  FX.alpha = o.alpha;
  FX.decals = o.decals;
  FX.rings = o.rings;
  FX.stuck = o.stuckPool;
  casingPool = o.casing;
  Object.assign(ghostPools, o.ghosts);
  ghostList = Object.values(o.ghosts).filter((p): p is MeshPool => !!p);
}
export function fxUnmount() {
  fxReset();
  FX.add = FX.alpha = null;
  FX.decals = null;
  FX.rings = null;
  FX.stuck = null;
  casingPool = null;
  for (const k of Object.keys(ghostPools)) delete ghostPools[k as GeoKey];
  ghostList = [];
}
