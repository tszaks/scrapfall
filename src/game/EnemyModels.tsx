// Models for the ten newer enemy types and their ordnance. Each type's static body is one
// merged, vertex-coloured geometry (plus one merged glow geometry), shared by every enemy of
// that type, so a crowd of 100 costs a few draw calls per enemy and no per-enemy materials.
// Only the moving telegraph parts (laser, shield, barrels, lanes, beams) are separate meshes.

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { playEnemySfx, type EnemySfx } from "./audio";
import { PH_ACT, PH_AFTER, PH_WIND, visExtra, visPhase, visProg, type NewKind } from "./enemyKinds";
import { GRENADE_FUSE, MAX_ORD, ORD_BLAST, ORD_GRENADE, ORD_ROCKET, type Ord } from "./enemyAI";

// ---------------------------------------------------------------- shared materials
const LIT = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
// a little self-light (a quarter of each part's own colour) so the bodies keep their colour
// and silhouette at sunset and at night instead of going flat black
LIT.onBeforeCompile = (sh) => {
  sh.fragmentShader = sh.fragmentShader.replace(
    "vec3 totalEmissiveRadiance = emissive;",
    "vec3 totalEmissiveRadiance = emissive + vColor.rgb * 0.26;",
  );
};
const GLOW = new THREE.MeshBasicMaterial({ vertexColors: true });
const CLOAK = new THREE.MeshBasicMaterial({ color: "#cfe0ff", transparent: true, opacity: 0.09, depthWrite: false });
const CLOAK_GLOW = new THREE.MeshBasicMaterial({ color: "#9fd8ff", transparent: true, opacity: 0.18, depthWrite: false });
const HOT = new THREE.MeshBasicMaterial({ color: "#ffffff", fog: false });
const basic = new Map<string, THREE.MeshBasicMaterial>();
/** one shared unlit material per colour (and opacity) */
function mat(color: string, opacity = 1) {
  const key = `${color}/${opacity}`;
  let m = basic.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, fog: false, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
    if (opacity < 1) m.side = THREE.DoubleSide;
    basic.set(key, m);
  }
  return m;
}

// ---------------------------------------------------------------- shared unit geometry
const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.SphereGeometry(1, 8, 6),
  cyl6: new THREE.CylinderGeometry(0.5, 0.5, 1, 6),
  cyl10: new THREE.CylinderGeometry(0.5, 0.5, 1, 10),
  cone: new THREE.ConeGeometry(0.5, 1, 5),
  ring: new THREE.RingGeometry(0.86, 1, 28),
  disc: new THREE.CircleGeometry(1, 28),
  torus: new THREE.TorusGeometry(1, 0.08, 5, 16),
  plane: new THREE.PlaneGeometry(1, 1),
  hex: new THREE.CylinderGeometry(1, 1, 1, 6),
};

// ---------------------------------------------------------------- merged body builder
type V3 = [number, number, number];
type Part = { g: THREE.BufferGeometry; c: string; p: V3; s: V3; r?: V3 | undefined; glow?: boolean | undefined };
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _c = new THREE.Color();
function merge(parts: Part[]) {
  if (!parts.length) return new THREE.BufferGeometry();
  const geos = parts.map((pt) => {
    const g = (pt.g.index ? pt.g.toNonIndexed() : pt.g.clone());
    g.deleteAttribute("uv");
    _e.set(...(pt.r ?? [0, 0, 0]));
    _q.setFromEuler(_e);
    _m.compose(new THREE.Vector3(...pt.p), _q, new THREE.Vector3(...pt.s));
    g.applyMatrix4(_m);
    _c.set(pt.c);
    const n = g.getAttribute("position").count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return g;
  });
  const out = mergeGeometries(geos, false)!;
  geos.forEach((g) => g.dispose());
  out.computeBoundingSphere();
  return out;
}
// part helpers: box / cylinder / sphere / cone / torus, sizes in metres
const bx = (w: number, h: number, d: number, p: V3, c: string, r?: V3, glow?: boolean): Part => ({ g: G.box, c, p, s: [w, h, d], r, glow });
const cy = (dia: number, h: number, p: V3, c: string, r?: V3, glow?: boolean, seg = 6): Part => ({ g: seg > 6 ? G.cyl10 : G.cyl6, c, p, s: [dia, h, dia], r, glow });
const sp = (rad: number, p: V3, c: string, sc: V3 = [1, 1, 1], glow?: boolean): Part => ({ g: G.sphere, c, p, s: [rad * sc[0], rad * sc[1], rad * sc[2]], glow });
const cn = (dia: number, h: number, p: V3, c: string, r?: V3, glow?: boolean): Part => ({ g: G.cone, c, p, s: [dia, h, dia], r, glow });
const to = (R: number, p: V3, c: string, r?: V3, glow?: boolean): Part => ({ g: G.torus, c, p, s: [R, R, R], r, glow });
const X90: V3 = [Math.PI / 2, 0, 0];

const ACCENT: Record<NewKind, string> = {
  sniper: "#ff2b2b", flanker: "#a6ff3a", grenadier: "#ff8c1a", bulwark: "#4fe0ff", charger: "#ffc21a",
  medic: "#34ff86", hornet: "#ff3020", gatling: "#b060ff", rocketeer: "#ff4fa3", cloaker: "#9fd8ff",
};

function partsFor(kind: NewKind): Part[] {
  const A = ACCENT[kind];
  switch (kind) {
    case "sniper": {
      const m = "#3b4048", dk = "#22262b", ol = "#34402f";
      return [
        cy(0.12, 1.05, [0.16, 0.52, 0], m), cy(0.12, 1.05, [-0.16, 0.52, 0], m),
        bx(0.16, 0.08, 0.3, [0.16, 0.04, 0.05], dk), bx(0.16, 0.08, 0.3, [-0.16, 0.04, 0.05], dk),
        bx(0.42, 0.18, 0.3, [0, 1.08, 0], dk),
        bx(0.46, 0.62, 0.32, [0, 1.45, 0], m),
        cn(0.9, 1.0, [0, 1.4, -0.1], ol, undefined),
        bx(0.26, 0.24, 0.26, [0, 1.9, 0], dk),
        cn(0.46, 0.3, [0, 2.1, -0.02], ol),
        cy(0.18, 0.08, [0, 1.9, 0.15], A, X90, true, 10),
        bx(0.07, 0.07, 1.5, [0.14, 1.62, 0.45], dk),
        bx(0.1, 0.16, 0.4, [0.14, 1.58, -0.15], m),
        cy(0.1, 0.35, [0.14, 1.72, 0.25], dk, X90, false, 10),
        bx(0.1, 0.1, 0.5, [0.24, 1.55, 0.12], m),
        bx(0.1, 0.1, 0.55, [-0.06, 1.56, 0.32], m, [0, 0.35, 0]),
        bx(0.05, 0.05, 0.05, [0.14, 1.62, 1.21], A, undefined, true),
      ];
    }
    case "flanker": {
      const b = "#2e3a2a", m = "#4a5a3a", dk = "#1c231a";
      const legs: Part[] = [];
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        legs.push(bx(0.08, 0.5, 0.08, [sx * 0.42, 0.62, sz * 0.32], m, [0, 0, sx * 0.7]));
        legs.push(bx(0.07, 0.6, 0.07, [sx * 0.62, 0.28, sz * 0.32], dk, [0, 0, -sx * 0.25]));
      }
      return [
        ...legs,
        bx(0.7, 0.32, 1.0, [0, 0.78, 0], b, [-0.12, 0, 0]),
        cn(0.5, 0.55, [0, 0.74, 0.72], m, X90),
        bx(0.06, 0.25, 0.6, [0, 1.02, -0.1], m),
        bx(0.3, 0.16, 0.25, [0, 0.97, 0.35], dk),
        bx(0.24, 0.05, 0.04, [0, 0.98, 0.48], A, undefined, true),
        cy(0.1, 0.6, [0.45, 0.8, 0.35], dk, X90), cy(0.1, 0.6, [-0.45, 0.8, 0.35], dk, X90),
        bx(0.08, 0.2, 0.9, [0.3, 0.9, -0.15], A, [0.1, 0, 0], true),
      ];
    }
    case "grenadier": {
      const k = "#6b5a40", dk = "#3a3228", o = "#e07818";
      return [
        bx(0.22, 0.6, 0.26, [0.2, 0.3, 0], dk), bx(0.22, 0.6, 0.26, [-0.2, 0.3, 0], dk),
        sp(0.5, [0, 1.05, 0], k, [1, 0.9, 0.85]),
        bx(0.6, 0.4, 0.1, [0, 0.95, 0.42], dk),
        bx(0.08, 0.95, 0.08, [0, 1.05, 0.45], dk, [0, 0, 0.7]),
        sp(0.07, [-0.18, 1.25, 0.49], A, [1, 1, 1], true), sp(0.07, [0, 1.05, 0.5], A, [1, 1, 1], true), sp(0.07, [0.18, 0.85, 0.49], A, [1, 1, 1], true),
        sp(0.3, [0, 1.6, 0], k, [1, 0.8, 1]),
        bx(0.3, 0.06, 0.04, [0, 1.58, 0.27], A, undefined, true),
        bx(0.5, 0.5, 0.25, [0, 1.15, -0.45], dk),
        sp(0.1, [0.13, 1.02, -0.6], o), sp(0.1, [-0.13, 1.02, -0.6], o), sp(0.1, [0.13, 1.3, -0.6], o), sp(0.1, [-0.13, 1.3, -0.6], o),
        bx(0.16, 0.55, 0.18, [-0.55, 1.0, 0], k, [0, 0, 0.2]),
      ];
    }
    case "bulwark": {
      const s = "#3a4a5a", dk = "#242e38";
      return [
        bx(0.34, 0.7, 0.4, [0.28, 0.35, 0], dk), bx(0.34, 0.7, 0.4, [-0.28, 0.35, 0], dk),
        bx(1.05, 1.0, 0.75, [0, 1.2, 0], s),
        bx(0.45, 0.35, 0.8, [0.68, 1.62, 0], dk, [0, 0, -0.2]), bx(0.45, 0.35, 0.8, [-0.68, 1.62, 0], dk, [0, 0, 0.2]),
        bx(0.42, 0.35, 0.4, [0, 1.9, 0], dk),
        bx(0.34, 0.07, 0.04, [0, 1.92, 0.21], A, undefined, true),
        bx(0.2, 0.2, 0.04, [0, 1.3, 0.39], A, undefined, true),
        bx(0.2, 0.2, 0.55, [-0.3, 1.3, 0.55], s),
        bx(0.1, 2.05, 0.08, [0, 1.25, 0.86], dk), bx(1.8, 0.1, 0.08, [0, 1.25, 0.86], dk),
      ];
    }
    case "charger": {
      const r = "#6a2a22", dk = "#3a1a16", mt = "#8a7a70";
      const legs: Part[] = [];
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) legs.push(bx(0.26, 0.6, 0.3, [sx * 0.38, 0.3, sz * 0.5], dk));
      return [
        ...legs,
        bx(1.0, 0.85, 1.5, [0, 1.0, 0], r),
        bx(0.8, 0.4, 0.7, [0, 1.55, -0.1], r),
        bx(0.6, 0.55, 0.55, [0, 0.95, 0.95], dk),
        bx(0.72, 0.36, 0.12, [0, 0.95, 1.24], mt),
        bx(0.1, 0.06, 0.04, [0.18, 1.08, 1.23], A, undefined, true), bx(0.1, 0.06, 0.04, [-0.18, 1.08, 1.23], A, undefined, true),
        cy(0.14, 0.4, [0.25, 1.7, -0.55], mt), cy(0.14, 0.4, [-0.25, 1.7, -0.55], mt),
        bx(0.9, 0.06, 1.2, [0, 1.44, 0], A, undefined, true),
      ];
    }
    case "medic": {
      const w = "#e8ecef", g = "#9aa4ad";
      return [
        cy(0.95, 0.22, [0, 0, 0], w, undefined, false, 10),
        sp(0.3, [0, 0.12, 0], "#cfd8de", [1, 0.6, 1]),
        cn(0.3, 0.25, [0, -0.22, 0], g, [Math.PI, 0, 0]),
        sp(0.07, [0, -0.36, 0], A, [1, 1, 1], true),
        bx(0.26, 0.08, 0.02, [0, 0, 0.49], A, undefined, true), bx(0.08, 0.26, 0.02, [0, 0, 0.49], A, undefined, true),
        bx(0.3, 0.02, 0.09, [0, 0.31, 0], A, undefined, true), bx(0.09, 0.02, 0.3, [0, 0.31, 0], A, undefined, true),
        bx(0.05, 0.3, 0.05, [0.3, -0.25, 0], g, [0, 0, 0.4]),
      ];
    }
    case "hornet": {
      const y = "#ffd21a", k = "#1a1a1a";
      return [
        sp(0.14, [0, 0, 0.08], k),
        sp(0.18, [0, -0.02, -0.24], y, [1, 1, 1.5]),
        to(0.175, [0, -0.02, -0.2], k), to(0.16, [0, -0.02, -0.34], k),
        sp(0.1, [0, 0.01, 0.25], k),
        cn(0.07, 0.2, [0, -0.02, -0.55], k, [-Math.PI / 2, 0, 0]),
        sp(0.035, [0.05, 0.03, 0.33], A, [1, 1, 1], true), sp(0.035, [-0.05, 0.03, 0.33], A, [1, 1, 1], true),
      ];
    }
    case "gatling": {
      const i = "#5a554f", dk = "#34302b";
      return [
        bx(0.38, 0.75, 0.45, [0.35, 0.37, 0], dk), bx(0.38, 0.75, 0.45, [-0.35, 0.37, 0], dk),
        bx(1.25, 1.0, 0.95, [0, 1.25, 0], i),
        bx(0.45, 0.3, 0.45, [0, 1.9, 0.1], dk),
        bx(0.36, 0.07, 0.04, [0, 1.9, 0.34], A, undefined, true),
        cy(0.76, 0.9, [0, 1.35, -0.62], dk, [0, 0, Math.PI / 2], false, 10),
        cy(0.78, 0.08, [0, 1.35, -0.62], A, [0, 0, Math.PI / 2], true, 10),
        bx(0.25, 0.7, 0.28, [-0.75, 1.1, 0.1], i),
        bx(0.35, 0.35, 0.5, [0.72, 1.3, 0.3], dk),
        bx(0.9, 0.08, 0.08, [0, 1.5, 0.48], A, undefined, true),
      ];
    }
    case "rocketeer": {
      const w = "#d8d4c8", g = "#8a8680", dk = "#3a3834";
      const tips: Part[] = [];
      for (const ox of [-0.11, 0.11]) for (const oy of [-0.11, 0.11]) tips.push(cy(0.14, 0.04, [-0.5 + ox, 1.6 + oy, 0.26], A, X90, true, 10));
      return [
        bx(0.2, 0.7, 0.24, [0.18, 0.35, 0], dk), bx(0.2, 0.7, 0.24, [-0.18, 0.35, 0], dk),
        bx(0.6, 0.7, 0.4, [0, 1.1, 0], w),
        bx(0.3, 0.3, 0.3, [0, 1.62, 0], w),
        bx(0.24, 0.06, 0.04, [0, 1.64, 0.16], A, undefined, true),
        bx(0.5, 0.45, 0.5, [-0.5, 1.6, 0], g),
        ...tips,
        cy(0.26, 1.1, [0.45, 1.62, 0.1], dk, X90, false, 10),
        bx(0.12, 0.5, 0.14, [0.38, 1.05, 0.05], g), bx(0.12, 0.5, 0.14, [-0.38, 1.05, 0.05], g),
      ];
    }
    case "cloaker": {
      const k = "#15171c", g = "#2a2e38";
      return [
        bx(0.1, 0.6, 0.1, [0.15, 0.32, -0.05], g, [0.3, 0, 0]), bx(0.1, 0.6, 0.1, [-0.15, 0.32, -0.05], g, [0.3, 0, 0]),
        bx(0.4, 0.62, 0.28, [0, 1.12, 0.05], k, [0.35, 0, 0]),
        bx(0.22, 0.2, 0.3, [0, 1.5, 0.22], k),
        bx(0.05, 0.02, 0.03, [0.06, 1.52, 0.37], A, undefined, true), bx(0.05, 0.02, 0.03, [-0.06, 1.52, 0.37], A, undefined, true),
        bx(0.08, 0.7, 0.08, [0.3, 1.0, 0.2], g, [-0.5, 0, 0]), bx(0.08, 0.7, 0.08, [-0.3, 1.0, 0.2], g, [-0.5, 0, 0]),
        bx(0.03, 0.06, 0.75, [0.33, 0.78, 0.6], A, [0.25, 0, 0], true), bx(0.03, 0.06, 0.75, [-0.33, 0.78, 0.6], A, [0.25, 0, 0], true),
      ];
    }
  }
}

const bodies = new Map<NewKind, { lit: THREE.BufferGeometry; glow: THREE.BufferGeometry }>();
function bodyOf(kind: NewKind) {
  let b = bodies.get(kind);
  if (!b) {
    const parts = partsFor(kind);
    b = { lit: merge(parts.filter((p) => !p.glow)), glow: merge(parts.filter((p) => p.glow)) };
    bodies.set(kind, b);
  }
  return b;
}

/** body heights above the ground: fliers hover */
const HOVER: Partial<Record<NewKind, number>> = { medic: 2.5, hornet: 1.2 }; // hornets are drawn 1.3x, so ~1.55 m

type Data = { kind: string; x: number; z: number; alive: boolean; vis?: number; yaw?: number; flash: number; elite?: number };

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

/** sound for a telegraph starting, faded by distance; silent past ~35 m */
function cue(kind: EnemySfx, g: THREE.Object3D, cam: THREE.Camera) {
  g.getWorldPosition(_v);
  const d = _v.distanceTo(cam.position);
  if (d < 38) playEnemySfx(kind, 1 - d / 40);
}

export function NewEnemyModel({ kind, data, all }: { kind: NewKind; data: Data; all: Data[] }) {
  const root = useRef<THREE.Group>(null);
  const hover = useRef<THREE.Group>(null);
  const body = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.Mesh>(null);
  const a = useRef<THREE.Mesh>(null); // primary telegraph part
  const b = useRef<THREE.Mesh>(null); // secondary telegraph part
  const grp = useRef<THREE.Group>(null); // animated sub-assembly (arm, barrels, rotor, wings, shield)
  const prev = useRef({ ph: 0, ex: 0, blk: 0 });
  const { lit, glow: glowGeo } = bodyOf(kind);
  const accent = ACCENT[kind];

  useFrame((state, delta) => {
    const r = root.current;
    if (!r || !data.alive) return;
    const t = state.clock.elapsedTime;
    const v = data.vis ?? 0;
    const ph = visPhase(v);
    const pr = visProg(v);
    const ex = visExtra(v);
    const inv = 1 / (r.parent?.scale.x || 1); // telegraph lanes / lasers ignore the hit-flash scale
    const was = prev.current;
    const cam = state.camera;
    const h = hover.current;
    if (h) h.position.y = (HOVER[kind] ?? 0) + (HOVER[kind] ? Math.sin(t * (kind === "hornet" ? 9 : 2.2) + data.x) * (kind === "hornet" ? 0.12 : 0.1) : 0);

    switch (kind) {
      case "sniper": {
        // laser: thin red while aiming, thick white-hot once locked, a bright tracer on the shot
        // aimed at the target's chest and stopping 2.5 m short, so from the victim's eyes it
        // reads as a line climbing from below the crosshair to the rifle, not a wall of red
        const L = a.current;
        const pivot = grp.current;
        if (L && pivot) {
          pivot.visible = ph >= PH_WIND && ex > 0;
          const len = Math.max(0.1, ex - 2.5);
          pivot.rotation.x = Math.atan2(0.55, Math.max(1, ex));
          const thick = ph === PH_WIND ? 0.02 + pr * 0.02 : ph === PH_ACT ? 0.05 : 0.1;
          L.scale.set(thick * inv, thick * inv, len * inv);
          L.position.set(0, 0, (len * inv) / 2);
          L.material = ph === PH_WIND ? mat(accent, 0.35 + pr * 0.4) : ph === PH_ACT ? (Math.floor(t * 16) % 2 ? HOT : mat(accent)) : HOT;
        }
        if (ph === PH_WIND && was.ph !== PH_WIND) cue("aim", r, cam);
        if (ph === PH_ACT && was.ph !== PH_ACT) cue("lock", r, cam);
        if (ph === PH_AFTER && was.ph !== PH_AFTER) cue("snipe", r, cam);
        break;
      }
      case "flanker": {
        const tips = grp.current;
        if (tips) {
          tips.visible = ph >= PH_WIND;
          const s = ph === PH_WIND ? 0.08 + pr * 0.12 : 0.14 + Math.random() * 0.1;
          tips.children.forEach((m) => {
            m.scale.setScalar(s);
            (m as THREE.Mesh).material = ph === PH_ACT ? HOT : mat(accent);
          });
        }
        if (ph === PH_WIND && was.ph !== PH_WIND) cue("click", r, cam);
        break;
      }
      case "grenadier": {
        const arm = grp.current;
        if (arm) arm.rotation.x = ph === PH_WIND ? -2.6 * Math.min(1, pr * 1.6) : Math.sin(t * 3 + data.x) * 0.1;
        if (a.current) {
          a.current.visible = ph === PH_WIND;
          a.current.material = Math.floor(t * 10) % 2 ? HOT : mat(accent);
        }
        if (was.ph === PH_WIND && ph !== PH_WIND) cue("throw", r, cam);
        break;
      }
      case "bulwark": {
        const up = (ex & 1) !== 0;
        const blk = (ex & 2) !== 0;
        if (a.current) {
          a.current.visible = up;
          a.current.material = blk ? mat("#e8fbff", 0.7) : mat(accent, 0.32 + Math.sin(t * 5) * 0.05);
        }
        if (grp.current) grp.current.position.z = ph === PH_WIND ? -0.35 * pr : 0; // shield pulls back before the bash
        if (blk && !was.blk) cue("block", r, cam);
        was.blk = blk ? 1 : 0;
        break;
      }
      case "charger": {
        const lane = a.current;
        if (lane) {
          lane.visible = ph === PH_WIND;
          lane.scale.set(1.7 * inv, 15 * inv, 1);
          lane.position.set(0, 0.2, 1.2 + (7.5 * inv)); // above the city's 0.15 m pavements
          lane.material = mat(accent, pr > 0.7 ? (Math.floor(t * 14) % 2 ? 0.65 : 0.3) : 0.18 + pr * 0.25);
        }
        if (glow.current) glow.current.material = ph === PH_WIND || ph === PH_ACT ? (Math.floor(t * 12) % 2 ? HOT : GLOW) : GLOW;
        if (grp.current) {
          grp.current.visible = ph === PH_AFTER; // dizzy sparks while stunned
          grp.current.rotation.y = t * 5;
        }
        if (h) h.position.y = ph === PH_WIND ? Math.abs(Math.sin(t * 18)) * 0.06 : 0; // pawing the ground
        if (ph === PH_WIND && was.ph !== PH_WIND) cue("charge", r, cam);
        break;
      }
      case "medic": {
        if (grp.current) grp.current.rotation.y = t * 9;
        const beam = a.current;
        const pat = ex > 0 ? all[ex - 1] : undefined;
        if (beam) {
          beam.visible = ph === PH_ACT && !!pat?.alive;
          if (beam.visible && pat) {
            // stretch a box from the drone's emitter to the patient, in the drone's local space
            beam.parent!.getWorldPosition(_v);
            _v.y -= 0.35;
            _w.set(pat.x, 1.2, pat.z);
            const mid = _v.clone().add(_w).multiplyScalar(0.5);
            beam.parent!.worldToLocal(mid);
            beam.position.copy(mid);
            beam.parent!.getWorldQuaternion(_q).invert();
            const dir = _w.clone().sub(_v);
            const len = dir.length();
            beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize().applyQuaternion(_q));
            beam.scale.set(0.08 * inv, len * inv, 0.08 * inv);
            beam.material = mat(accent, 0.5 + Math.sin(t * 30) * 0.2);
          }
        }
        if (ph === PH_ACT && was.ph !== PH_ACT) cue("heal", r, cam);
        break;
      }
      case "hornet": {
        if (grp.current) grp.current.children.forEach((w, i) => (w.rotation.z = (i ? -1 : 1) * (0.3 + Math.sin(t * 60 + i) * 0.5)));
        if (a.current) {
          a.current.visible = ph === PH_WIND || ph === PH_ACT;
          a.current.scale.setScalar(0.3 + pr * 0.15);
        }
        if (ph === PH_WIND && was.ph !== PH_WIND) cue("buzz", r, cam);
        break;
      }
      case "gatling": {
        const spin = ph === PH_WIND ? 4 + pr * 26 : ph === PH_ACT ? 32 : ph === PH_AFTER ? pr * 20 : 0.5;
        if (grp.current) grp.current.rotation.z += spin * Math.min(0.05, delta);
        if (a.current) {
          a.current.visible = ph !== 0;
          const s = ph === PH_WIND ? 0.12 + pr * 0.1 : ph === PH_ACT ? 0.24 : 0.12 * pr;
          a.current.scale.setScalar(Math.max(0.01, s));
          a.current.material = ph === PH_ACT ? (Math.floor(t * 20) % 2 ? HOT : mat(accent)) : mat(accent);
        }
        if (ph === PH_WIND && was.ph !== PH_WIND) cue("spin", r, cam);
        break;
      }
      case "rocketeer": {
        if (a.current) {
          a.current.visible = ph === PH_WIND;
          a.current.scale.setScalar(0.08 + pr * 0.14);
          a.current.material = pr > 0.6 && Math.floor(t * 14) % 2 ? HOT : mat(accent);
        }
        if (was.ph === PH_WIND && ph !== PH_WIND) cue("launch", r, cam);
        break;
      }
      case "cloaker": {
        const cloaked = ex === 1;
        const shimmer = ex === 2;
        const faint = cloaked || (shimmer && Math.floor(t * 18) % 2 === 0);
        if (body.current) body.current.material = faint ? CLOAK : LIT;
        if (glow.current) glow.current.material = faint ? CLOAK_GLOW : GLOW;
        if (a.current) {
          a.current.visible = ph === PH_WIND;
          a.current.scale.set(1, 1, 1);
        }
        if (shimmer && was.ex !== 2) cue("cloak", r, cam);
        break;
      }
    }
    was.ph = ph;
    was.ex = ex;
  });

  return (
    <group ref={root}>
      <group ref={hover}>
        <mesh ref={body} geometry={lit} material={LIT} castShadow={false} />
        <mesh ref={glow} geometry={glowGeo} material={GLOW} />
        {kind === "sniper" && (
          <group ref={grp} position={[0.14, 1.62, 1.22]} visible={false}>
            <mesh ref={a} geometry={G.box} material={mat(accent, 0.5)} />
          </group>
        )}
        {kind === "flanker" && (
          <group ref={grp} visible={false}>
            <mesh geometry={G.sphere} material={mat(accent)} position={[0.45, 0.8, 0.7]} />
            <mesh geometry={G.sphere} material={mat(accent)} position={[-0.45, 0.8, 0.7]} />
          </group>
        )}
        {kind === "grenadier" && (
          <group ref={grp} position={[0.55, 1.3, 0]}>
            <mesh geometry={G.box} material={LIT} scale={[0.16, 0.6, 0.18]} position={[0, -0.3, 0]} />
            <mesh ref={a} geometry={G.sphere} material={mat(accent)} scale={0.13} position={[0, -0.64, 0]} visible={false} />
          </group>
        )}
        {kind === "bulwark" && (
          <group ref={grp}>
            <mesh ref={a} geometry={G.hex} material={mat(accent, 0.32)} position={[0, 1.25, 0.95]} rotation={[Math.PI / 2, Math.PI / 6, 0]} scale={[1.05, 0.05, 1.12]} />
          </group>
        )}
        {kind === "charger" && (
          <>
            {[-1, 1].map((s) => (
              <mesh key={s} geometry={G.cone} material={mat("#e8dcc8")} position={[s * 0.32, 1.18, 1.38]} rotation={[Math.PI / 2, 0, s * -0.35]} scale={[0.16, 0.6, 0.16]} />
            ))}
            <group ref={grp} position={[0, 2.05, 0.6]} visible={false}>
              {[0, 1, 2, 3].map((i) => (
                <mesh key={i} geometry={G.sphere} material={mat(accent)} scale={0.07} position={[Math.sin(i * 1.57) * 0.35, 0, Math.cos(i * 1.57) * 0.35]} />
              ))}
            </group>
          </>
        )}
        {kind === "medic" && (
          <>
            <group ref={grp}>
              <mesh geometry={G.torus} material={mat("#9aa4ad")} rotation={[Math.PI / 2, 0, 0]} scale={0.62} />
              {[0, 1, 2].map((i) => (
                <mesh key={i} geometry={G.box} material={mat("#c8d0d6")} rotation={[0, (i * Math.PI * 2) / 3, 0]} position={[Math.sin((i * Math.PI * 2) / 3) * 0.32, 0.02, Math.cos((i * Math.PI * 2) / 3) * 0.32]} scale={[0.08, 0.02, 0.6]} />
              ))}
            </group>
            <mesh ref={a} geometry={G.cyl6} material={mat(accent, 0.6)} visible={false} />
          </>
        )}
        {kind === "hornet" && (
          <>
            <group ref={grp}>
              <mesh geometry={G.box} material={mat("#eef4ff", 0.55)} position={[0.2, 0.1, 0.02]} scale={[0.36, 0.01, 0.14]} />
              <mesh geometry={G.box} material={mat("#eef4ff", 0.55)} position={[-0.2, 0.1, 0.02]} scale={[0.36, 0.01, 0.14]} />
            </group>
            <mesh ref={a} geometry={G.sphere} material={mat(accent, 0.45)} visible={false} />
          </>
        )}
        {kind === "gatling" && (
          <group position={[0.72, 1.3, 0.55]}>
            <group ref={grp}>
              {[0, 1, 2, 3, 4, 5].map((i) => {
                const an = (i / 6) * Math.PI * 2;
                return <mesh key={i} geometry={G.cyl6} material={mat("#2e2b28")} position={[Math.cos(an) * 0.12, Math.sin(an) * 0.12, 0.38]} rotation={X90} scale={[0.09, 0.76, 0.09]} />;
              })}
              <mesh geometry={G.torus} material={mat("#3a3632")} position={[0, 0, 0.6]} scale={0.16} />
            </group>
            <mesh ref={a} geometry={G.sphere} material={mat(accent)} position={[0, 0, 0.8]} visible={false} />
          </group>
        )}
        {kind === "rocketeer" && <mesh ref={a} geometry={G.sphere} material={mat(accent)} position={[0.45, 1.62, 0.68]} visible={false} />}
        {kind === "cloaker" && (
          <mesh ref={a} geometry={G.box} material={HOT} position={[0.33, 0.95, 0.75]} rotation={[-0.4, 0, 0]} scale={[0.05, 0.08, 0.8]} visible={false} />
        )}
      </group>
      {kind === "charger" && <mesh ref={a} geometry={G.plane} material={mat(accent, 0.3)} rotation={[-Math.PI / 2, 0, 0]} visible={false} />}
    </group>
  );
}

// ---------------------------------------------------------------- ordnance pool
/** Grenades (with their landing warning ring), homing rockets and blasts, for every client. */
export function OrdnancePool({ ords, guestTx, guest }: { ords: Ord[]; guestTx: Float32Array; guest: React.MutableRefObject<boolean> }) {
  const refs = useRef<(THREE.Group | null)[]>([]);
  const seen = useRef<boolean[]>([]);
  useFrame((state, raw) => {
    const dt = Math.min(raw, 0.05);
    const t = state.clock.elapsedTime;
    for (let i = 0; i < MAX_ORD; i++) {
      const g = refs.current[i];
      const o = ords[i];
      if (!g || !o) continue;
      g.visible = o.on;
      if (!o.on) { seen.current[i] = false; continue; }
      if (guest.current) {
        const f = Math.min(1, dt * 14);
        o.x += (guestTx[i * 3]! - o.x) * f;
        o.y += (guestTx[i * 3 + 1]! - o.y) * f;
        o.z += (guestTx[i * 3 + 2]! - o.z) * f;
        o.t += dt;
      }
      const [shell, ring, fill, rocket, boom] = g.children as THREE.Object3D[];
      if (!shell || !ring || !fill || !rocket || !boom) continue;
      shell.visible = o.tp === ORD_GRENADE;
      ring.visible = o.tp === ORD_GRENADE;
      fill.visible = o.tp === ORD_GRENADE;
      rocket.visible = o.tp === ORD_ROCKET;
      boom.visible = o.tp === ORD_BLAST;
      if (o.tp === ORD_GRENADE) {
        shell.position.set(o.x, o.y, o.z);
        const p = Math.min(1, o.t / (o.T + GRENADE_FUSE));
        ring.position.set(o.lx, 0.21, o.lz); // above the city's 0.15 m pavements
        ring.scale.setScalar(o.r);
        fill.position.set(o.lx, 0.2, o.lz);
        fill.scale.setScalar(Math.max(0.05, o.r * p));
        const m = fill as THREE.Mesh;
        m.material = p > 0.8 && Math.floor(t * 16) % 2 ? mat("#ffffff", 0.5) : mat("#ff2a1a", 0.28);
      } else if (o.tp === ORD_ROCKET) {
        rocket.position.set(o.x, o.y, o.z);
        rocket.rotation.set(0, o.yaw, 0);
      } else {
        const p = Math.min(1, o.t / o.T);
        boom.position.set(o.x, o.y, o.z);
        boom.scale.setScalar(Math.max(0.1, o.r * (0.4 + p * 0.7)));
        (boom as THREE.Mesh).material = mat(p < 0.3 ? "#fff2c0" : "#ff7a1a", Math.max(0.05, 0.75 * (1 - p)));
        if (!seen.current[i]) {
          const d = Math.hypot(o.x - state.camera.position.x, o.z - state.camera.position.z);
          if (d < 45) playEnemySfx("boom", 1 - d / 48);
        }
      }
      seen.current[i] = true;
    }
  });
  return (
    <>
      {Array.from({ length: MAX_ORD }, (_, i) => (
        <group key={i} ref={(g) => { refs.current[i] = g; }} visible={false}>
          <mesh geometry={G.sphere} material={mat("#ff8c1a")} scale={0.16} />
          <mesh geometry={G.ring} material={mat("#ff2a1a", 0.85)} rotation={[-Math.PI / 2, 0, 0]} />
          <mesh geometry={G.disc} material={mat("#ff2a1a", 0.28)} rotation={[-Math.PI / 2, 0, 0]} />
          <group>
            <mesh geometry={G.cyl6} material={mat("#e8e4dc")} rotation={X90} scale={[0.16, 0.7, 0.16]} />
            <mesh geometry={G.cone} material={mat("#ff4fa3")} position={[0, 0, 0.45]} rotation={X90} scale={[0.18, 0.25, 0.18]} />
            <mesh geometry={G.cone} material={mat("#ffd08a", 0.8)} position={[0, 0, -0.55]} rotation={[-Math.PI / 2, 0, 0]} scale={[0.2, 0.5, 0.2]} />
          </group>
          <mesh geometry={G.sphere} material={mat("#ff7a1a", 0.6)} />
        </group>
      ))}
    </>
  );
}
