// Per-gun sighting: where the eye sits in ADS, what the sight looks like, and the
// geometry that draws it. Gun space is the same as guns.ts — the barrel points down
// -z, y is up, the origin sits just above the grip. Every sight line is the gun-space
// line (0, y, *) — kept x-centred and parallel to the bore, so the ADS pose only has
// to place that line on the camera's centre ray (see adsOffset).
//
// Types: iron (rear notch/ghost ring + front post, pure geometry), reflex (a small
// glass with an emissive dot), holo (a bigger window with a ring-and-dot reticle) and
// scope (the gun model hides and ScopeOverlay takes over). Guns that already carry
// sight hardware in guns.ts are marked `built` and only get a reticle, if any.
import * as THREE from "three";

import { Model, SURF, type V3 } from "./kit";
import type { GunId, PistolMods } from "./guns";

export type SightType = "iron" | "reflex" | "holo" | "scope";

export type SightSpec = {
  type: SightType;
  /** sight-line height above the gun origin (gun space, m) */
  y: number;
  /** rear element z — the notch / ocular nearest the eye (+z is back toward it) */
  rear: number;
  /** front post / reticle plane z */
  front: number;
  /** eye relief: camera → rear distance once fully aimed (m, camera space) */
  relief: number;
  /** ADS fov = hip fov × fovMul (scopes may set fovAbs instead) */
  fovMul: number;
  /** absolute ADS fov, e.g. the LONGSHOT's magnified 20° */
  fovAbs?: number;
  /** seconds for the full aim-in */
  adsIn: number;
  /** move-speed multiplier while aimed */
  moveMul: number;
  /** the model already carries the sight hardware — only a reticle is added */
  built?: boolean;
  /** receiver top height under the sight: a riser climbs from it to the sight */
  mount?: number;
  /** riser z extent [back, front]; defaults to the housing extent */
  mountZ?: readonly [number, number];
  /** where the front post stands (barrel / rib top); defaults to `mount` */
  frontMount?: number;
};

const SIGHTS: Record<Exclude<GunId, "pistol">, SightSpec> = {
  scatter: {
    type: "iron", // rear ghost ring, front post on the vent rib
    y: 0.05,
    rear: 0.055,
    front: -0.6,
    relief: 0.3,
    fovMul: 0.85,
    adsIn: 0.17,
    moveMul: 0.8,
    mount: 0.026, // vent rib top
    mountZ: [0.06, -0.62],
  },
  smg: {
    type: "reflex", // a see-through window above the top rail
    y: 0.086,
    rear: -0.02,
    front: -0.094,
    relief: 0.27,
    fovMul: 0.8,
    adsIn: 0.12,
    moveMul: 0.9,
    mount: 0.052,
  },
  rail: {
    type: "holo", // ring sight on a rail where the placeholder scope sat
    y: 0.1,
    rear: 0.05,
    front: -0.12,
    relief: 0.28,
    fovMul: 0.72,
    adsIn: 0.18,
    moveMul: 0.75,
    mount: 0.05,
    mountZ: [0.07, -0.16],
  },
  cannon: {
    type: "iron", // reads through the top rung of the flip-up ladder sight
    y: 0.125,
    rear: 0.06,
    front: -0.218,
    relief: 0.32,
    fovMul: 0.85,
    adsIn: 0.22,
    moveMul: 0.62,
    built: true,
  },
  rebound: {
    type: "reflex", // tall riser clearing the disc drum on top
    y: 0.162,
    rear: 0.08,
    front: -0.08,
    relief: 0.3,
    fovMul: 0.85,
    adsIn: 0.2,
    moveMul: 0.7,
    mount: 0.045,
    mountZ: [0.12, -0.16],
  },
  harpoon: {
    type: "iron", // slim notch + pin, speargun style
    y: 0.052,
    rear: 0.1,
    front: -0.55,
    relief: 0.28,
    fovMul: 0.8,
    adsIn: 0.17,
    moveMul: 0.72,
    mount: 0.008,
    mountZ: [0.12, -0.56],
    frontMount: 0.027, // the muzzle yoke top
  },
  cryo: {
    type: "holo", // raised over the cryo canister
    y: 0.15,
    rear: 0.14,
    front: 0.02,
    relief: 0.28,
    fovMul: 0.8,
    adsIn: 0.16,
    moveMul: 0.82,
    mount: 0.045,
    mountZ: [0.16, -0.02],
  },
  flak: {
    type: "reflex", // sits on the carry handle
    y: 0.142,
    rear: 0.0,
    front: -0.1,
    relief: 0.28,
    fovMul: 0.85,
    adsIn: 0.2,
    moveMul: 0.65,
    mount: 0.12,
    mountZ: [0.02, -0.14],
  },
  tesla: {
    type: "holo", // on a centre rail; the coil tower moved to a side pod
    y: 0.088,
    rear: 0.12,
    front: -0.04,
    relief: 0.28,
    fovMul: 0.75,
    adsIn: 0.16,
    moveMul: 0.78,
    mount: 0.05,
    mountZ: [0.14, -0.12],
  },
  revolver: {
    type: "iron", // notch cut into the top strap, tall front blade
    y: 0.09,
    rear: 0.08,
    front: -0.46,
    relief: 0.24,
    fovMul: 0.78,
    adsIn: 0.15,
    moveMul: 0.8,
    mount: 0.08, // top strap surface
    mountZ: [0.09, 0.06],
    frontMount: 0.052, // the vent rib over the barrel
  },
  minigun: {
    type: "reflex", // on the carry handle, over the spinning cluster
    y: 0.162,
    rear: 0.02,
    front: -0.06,
    relief: 0.3,
    fovMul: 0.8,
    adsIn: 0.24,
    moveMul: 0.55,
    mount: 0.14,
    mountZ: [0.04, -0.12],
  },
  crossbow: {
    type: "scope", // the modelled low-power scope, generalised overlay
    y: 0.06,
    rear: -0.03,
    front: -0.22,
    relief: 0.22,
    fovMul: 0.5,
    adsIn: 0.2,
    moveMul: 0.7,
    built: true,
  },
  plasma: {
    type: "holo", // clears the plasma chamber on top
    y: 0.112,
    rear: 0.14,
    front: -0.04,
    relief: 0.28,
    fovMul: 0.78,
    adsIn: 0.18,
    moveMul: 0.78,
    mount: 0.05,
    mountZ: [0.16, -0.04],
  },
  voidorb: {
    type: "holo", // clears the upper containment prong
    y: 0.12,
    rear: 0.14,
    front: -0.02,
    relief: 0.28,
    fovMul: 0.78,
    adsIn: 0.18,
    moveMul: 0.78,
    mount: 0.05,
    mountZ: [0.16, -0.02],
  },
  shatter: {
    type: "holo", // raised over the ice shards
    y: 0.14,
    rear: 0.08,
    front: -0.08,
    relief: 0.28,
    fovMul: 0.8,
    adsIn: 0.2,
    moveMul: 0.72,
    mount: 0.05,
    mountZ: [0.1, -0.1],
  },
  sniper: {
    type: "scope", // the magnified LONGSHOT optic + overlay
    y: 0.125,
    rear: 0.07,
    front: -0.36,
    relief: 0.24,
    fovMul: 0.267,
    fovAbs: 20,
    adsIn: 0.28,
    moveMul: 0.55,
    built: true,
  },
};

/** the pistol's front sight sits on the slide, whose length depends on mods */
const pistolSpecs: Record<string, SightSpec> = {};
export function sightOf(w: GunId, mods?: PistolMods): SightSpec {
  if (w === "pistol") {
    const key = mods?.magnum ? "magnum" : "std";
    return (pistolSpecs[key] ??= {
      type: "iron", // the slide's tritium notch-and-post set
      y: 0.05,
      rear: 0.029,
      front: -(mods?.magnum ? 0.48 : 0.34) + 0.021,
      relief: 0.26,
      fovMul: 0.82,
      adsIn: 0.13,
      moveMul: 0.85,
      built: true,
    });
  }
  return SIGHTS[w];
}

export const VM_SCALE = 0.7; // the first-person viewmodel's scale (Game.tsx)

/**
 * The camera-space offset that puts a gun's sight line on the centre ray: the rear
 * element lands `relief` metres out, and since the sight line is the gun-space line
 * (0, y, ·) its whole length then lies on the axis — post, notch and reticle all
 * centred. (The viewmodel group is scaled; gun-space points shrink by it.)
 */
export function adsOffset(w: GunId, mods?: PistolMods): V3 {
  const s = sightOf(w, mods);
  return [0, -s.y * VM_SCALE, -(s.rear * VM_SCALE + s.relief)];
}

/** gun-space point drawn on the screen centre once aimed (front post / reticle) */
export function sightMark(w: GunId, mods?: PistolMods): V3 {
  const s = sightOf(w, mods);
  return [0, s.y, s.front];
}

/** hip-fire viewmodel offset (unchanged from before the overhaul) */
export const HIP_POSE: V3 = [0.3, -0.28, -0.75];

/**
 * The viewmodel's camera-space origin for aim blend `t` (before bob, recoil and the
 * sprint pose): lerps the hip pose into the ADS pose, where the sight line sits on
 * the centre ray. One formula shared by the game and the alignment test.
 */
export function viewModelPos(s: SightSpec, t: number, out: THREE.Vector3) {
  return out.set(
    HIP_POSE[0] * (1 - t),
    HIP_POSE[1] * (1 - t) - s.y * VM_SCALE * t,
    HIP_POSE[2] * (1 - t) - (s.rear * VM_SCALE + s.relief) * t,
  );
}

// ---------------------------------------------------------------- geometry

const GM = "#3a3d43";
const BLK = "#27282c";
const STL = "#8d9299";
const S = SURF;

/**
 * Riser under a sight: a top-rail bar from `mount` up to just under the sight line,
 * plus the housing. Returns the y the sight furniture stands on.
 */
function riser(m: Model, s: SightSpec, top: number) {
  if (s.mount === undefined) return;
  const [z0, z1] = s.mountZ ?? [s.rear, s.front];
  // the mount bar itself — a low picatinny-ish strip
  m.box(0.032, top - s.mount, z0 - z1, [0, (top + s.mount) / 2, (z0 + z1) / 2], BLK, S.gunmetal);
  const n = Math.max(2, Math.round((z0 - z1) / 0.022));
  for (let i = 0; i < n; i++)
    m.box(0.036, 0.004, 0.008, [0, top - 0.004, z0 - ((z0 - z1) * (i + 0.5)) / n], GM, S.gunmetal, {
      lod: 1,
    });
}

/** rear notch: two wings with a gap, on a shoe that tops out just under the line */
function rearNotch(m: Model, s: SightSpec) {
  const base = s.mount ?? s.y - 0.02;
  const shoe = Math.max(0.004, s.y - 0.002 - base);
  m.box(0.034, shoe, 0.008, [0, base + shoe / 2, s.rear], BLK, S.gunmetal);
  for (const x of [-0.0125, 0.0125])
    m.box(0.007, 0.018, 0.007, [x, s.y + 0.006, s.rear], GM, S.gunmetal, { bevel: 0.002 });
}

/** front blade: a thin post whose tip is exactly on the sight line */
function frontPost(m: Model, s: SightSpec, base: number, col: string) {
  m.box(0.006, s.y - base, 0.01, [0, (s.y + base) / 2, s.front], GM, S.gunmetal, {
    bevel: 0.0015,
  });
  m.box(0.008, 0.003, 0.003, [0, s.y - 0.003, s.front + 0.0055], col, S.glow); // fibre dot
}

/** open-top reflex housing on a riser (glass + dot are returned separately) */
function reflexBody(m: Model, s: SightSpec) {
  const base = s.mount !== undefined ? s.y - 0.03 : s.y - 0.026;
  riser(m, s, base);
  const z0 = s.rear + 0.012,
    z1 = s.front - 0.004;
  m.box(0.032, 0.016, z0 - z1, [0, base + 0.008, (z0 + z1) / 2], BLK, S.gunmetal, {
    bevel: 0.003,
  });
  // side walls framing the glass, and a low hood lip over the top edge
  for (const x of [-0.015, 0.015])
    m.box(
      0.005,
      s.y + 0.018 - base,
      z0 - z1,
      [x, (base + s.y + 0.018) / 2, (z0 + z1) / 2],
      BLK,
      S.gunmetal,
      {
        bevel: 0.002,
      },
    );
  m.box(0.035, 0.005, z0 - z1, [0, s.y + 0.017, (z0 + z1) / 2], BLK, S.gunmetal, {
    bevel: 0.002,
  });
  m.box(0.014, 0.006, 0.006, [0, base + 0.02, z0 - 0.004], STL, S.steel); // brightness knob
}

/** EOTech-style holo: a hooded window on a riser */
function holoBody(m: Model, s: SightSpec) {
  const base = s.mount !== undefined ? s.y - 0.034 : s.y - 0.03;
  riser(m, s, base);
  const z0 = s.rear + 0.014,
    z1 = s.front - 0.006;
  m.box(0.036, 0.018, z0 - z1, [0, base + 0.009, (z0 + z1) / 2], BLK, S.gunmetal, {
    bevel: 0.003,
  });
  for (const x of [-0.018, 0.018])
    m.box(
      0.006,
      s.y + 0.022 - base,
      z0 - z1,
      [x, (base + s.y + 0.022) / 2, (z0 + z1) / 2],
      BLK,
      S.gunmetal,
      {
        bevel: 0.002,
      },
    );
  m.box(0.042, 0.006, z0 - z1, [0, s.y + 0.02, (z0 + z1) / 2], BLK, S.gunmetal, {
    bevel: 0.002,
  });
  for (const x of [-0.011, 0.011])
    m.box(0.004, 0.008, 0.005, [x, base + 0.024, z0 - 0.003], GM, S.gunmetal); // buttons
}

/**
 * The opaque sight furniture, merged into the gun's body build. Guns marked `built`
 * already wear theirs in guns.ts.
 */
export function drawSight(m: Model, w: GunId, col: string, mods?: PistolMods) {
  const s = sightOf(w, mods);
  if (s.built) return;
  if (s.type === "iron") {
    if (w === "scatter") {
      // ghost ring on the receiver, bead-post on the vent rib
      const top = s.y - 0.016;
      m.box(
        0.03,
        top - (s.mount ?? 0) + 0.02,
        0.014,
        [0, (top + (s.mount ?? 0)) / 2 - 0.01, s.rear],
        BLK,
        S.gunmetal,
      );
      m.torus(0.013, 0.0028, [0, s.y - 0.002, s.rear], GM, S.gunmetal, { seg: 18 });
      for (const x of [-0.016, 0.016])
        m.box(0.006, 0.006, 0.006, [x, s.y - 0.014, s.rear], GM, S.gunmetal);
      frontPost(m, s, s.frontMount ?? s.mount ?? 0.02, col);
      return;
    }
    rearNotch(m, s);
    frontPost(m, s, s.frontMount ?? s.mount ?? 0.02, col);
    return;
  }
  if (s.type === "reflex") reflexBody(m, s);
  else if (s.type === "holo") holoBody(m, s);
}

/**
 * The transparent pane and the emissive reticle, rendered with their own materials.
 * Gun space, so they ride the same viewmodel transform as the body.
 */
export function sightGlass(
  w: GunId,
  mods?: PistolMods,
): {
  glass: THREE.BufferGeometry | null;
  reticle: THREE.BufferGeometry | null;
} {
  const s = sightOf(w, mods);
  if (s.type === "reflex") {
    if (s.built) {
      // the BUZZER's enclosed dot tube: dot painted on the rear lens
      const dot = new THREE.CircleGeometry(0.0035, 12);
      dot.translate(0, s.y, s.rear - 0.0008);
      return { glass: null, reticle: dot };
    }
    const glass = new THREE.BoxGeometry(0.024, 0.026, 0.0015);
    glass.translate(0, s.y + 0.001, s.front);
    const dot = new THREE.CircleGeometry(0.0022, 12);
    dot.translate(0, s.y + 0.001, s.front + 0.0012);
    return { glass, reticle: dot };
  }
  if (s.type === "holo") {
    const glass = new THREE.BoxGeometry(0.03, 0.03, 0.0015);
    glass.translate(0, s.y, s.front + 0.002);
    const ring = new THREE.RingGeometry(0.0048, 0.006, 24);
    ring.translate(0, s.y, s.front + 0.0032);
    const dot = new THREE.CircleGeometry(0.0016, 10);
    dot.translate(0, s.y, s.front + 0.0034);
    const reticle = mergeGeo([ring, dot]);
    return { glass, reticle };
  }
  return { glass: null, reticle: null };
}

function mergeGeo(src: THREE.BufferGeometry[]) {
  // minimal merge for identical-attribute geometries (position/normal/uv)
  const list = src.map((g) => (g.index ? g.toNonIndexed() : g));
  let total = 0;
  for (const g of list) total += g.getAttribute("position").count;
  const pos = new Float32Array(total * 3);
  const norm = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  let o = 0;
  for (const g of list) {
    const n = g.getAttribute("position").count;
    pos.set(g.getAttribute("position").array as Float32Array, o * 3);
    norm.set(g.getAttribute("normal").array as Float32Array, o * 3);
    uv.set(g.getAttribute("uv").array as Float32Array, o * 2);
    o += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(norm, 3));
  out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return out;
}
