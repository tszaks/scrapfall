// React side of the live maps' special enemies and bosses (art/robots/specials.ts,
// bosses.ts): picks the rig for the theme, turns the synced enemy state into the
// animation inputs (smoothed where the old models eased), and adds the few extra meshes
// that are not part of the skinned body (the Desperado's quick-draw glints).
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";

import type { Theme } from "../themes";
import { RobotModel, type RobotData, type RobotInputs } from "./RobotModel";
import { bossRobot } from "./robots/bosses";
import { specialRobot, specialRobotFor, type ArtSpecialType } from "./robots/specials";

/** ease a per-enemy value toward a target (frame-rate independent), keyed by the enemy */
const eased = new WeakMap<object, { v: number; t: number }>();
function ease(d: object, target: number, rate: number) {
  const now = performance.now();
  let s = eased.get(d);
  if (!s) {
    s = { v: target, t: now };
    eased.set(d, s);
  }
  const dt = Math.min(0.1, (now - s.t) / 1000);
  s.t = now;
  s.v += (target - s.v) * (1 - Math.exp(-dt * rate));
  return s.v;
}

const SPECIAL_INPUTS: Record<ArtSpecialType, RobotInputs> = {
  // leap: the synced aux runs while airborne
  leaper: (d) => ({ wind: ease(d, (d.aux ?? 0) > 0 ? 1 : 0, 12), aux: 0 }),
  // quick-draw: aux > 0 while the revolvers come up (the old model eased 35% a frame)
  desperado: (d) => ({ wind: ease(d, (d.aux ?? 0) > 0 ? 1 : 0, 22), aux: 0 }),
  // crawler: claws snap right after a pinch (host cooldown resets to 1.2)
  crawler: (d) => ({ wind: (d.cooldown ?? 0) > 0.85 ? 1 : 0, aux: 0 }),
  skier: () => ({ wind: 0, aux: 0 }),
};

const GLINT = new THREE.MeshBasicMaterial({ color: "#fff6c0", fog: false });
const GLINT_GEO = new THREE.OctahedronGeometry(0.12, 0);

/** the live map's special enemy (null for the old arena specials) */
export function ArtSpecial({ theme, data }: { theme: Theme; data: RobotData }) {
  const kind = specialRobot(theme);
  if (!kind) return null;
  const type = theme.special.type as ArtSpecialType;
  return (
    <>
      <RobotModel kind={kind} data={data} inputs={SPECIAL_INPUTS[type]} />
      {type === "desperado" && <Glints data={data} />}
    </>
  );
}

/** the Desperado on its own (Dry Gulch's DesperadoModel delegates here) */
export function ArtDesperado({
  sp,
  data,
}: {
  sp: { body: string; accent: string; glow: string };
  data: RobotData;
}) {
  return (
    <>
      <RobotModel
        kind={specialRobotFor("desperado", sp)}
        data={data}
        inputs={SPECIAL_INPUTS.desperado}
      />
      <Glints data={data} />
    </>
  );
}

/** the quick-draw glint: two flickering stars at the muzzles while the revolvers come up */
function Glints({ data }: { data: RobotData }) {
  const g = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (!g.current) return;
    g.current.visible = (data.aux ?? 0) > 0 && Math.floor(state.clock.elapsedTime * 14) % 2 === 0;
  });
  return (
    <group ref={g} visible={false}>
      <mesh geometry={GLINT_GEO} material={GLINT} position={[0.38, 1.46, 1.02]} />
      <mesh geometry={GLINT_GEO} material={GLINT} position={[-0.38, 1.46, 1.02]} />
    </group>
  );
}

// ---------------------------------------------------------------- bosses
const BOSS_INPUTS: RobotInputs = (d) => ({
  wind: (d.swing ?? 0) > 0 ? 1 - (d.swing ?? 0) / 0.4 : 0,
  // the Marshal's lasso wind-up (synced aux), eased so the loop opens and closes smoothly
  aux: ease(d, (d.aux ?? 0) > 0 ? 1 : 0, 10),
});

/** the live map's boss (null for the old arena bosses) */
export function ArtBoss({ theme, data }: { theme: Theme; data: RobotData }) {
  const kind = bossRobot(theme);
  if (!kind) return null;
  return (
    <>
      <RobotModel kind={kind} data={data} inputs={BOSS_INPUTS} />
      {(theme.boss.shape as string) === "marshal" && <Steam />}
    </>
  );
}

const STEAM_GEO = new THREE.SphereGeometry(1, 8, 6);
const STEAM_MAT = new THREE.MeshLambertMaterial({
  color: "#d8d0c8",
  transparent: true,
  opacity: 0.45,
  depthWrite: false,
});
/** the Iron Marshal's smokestack steam (three rising, growing puffs) */
function Steam() {
  const g = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (!g.current) return;
    const t = state.clock.elapsedTime;
    g.current.children.forEach((c, i) => {
      const k = (t * 0.8 + i / 3) % 1;
      c.position.y = 4.05 + k * 1.6;
      c.position.x = Math.sin(t * 0.7 + i) * 0.1 * k;
      c.scale.setScalar(0.22 + k * 0.6);
    });
  });
  return (
    <group ref={g} position={[0.45, 0, -0.55]}>
      {[0, 1, 2].map((i) => (
        <mesh key={i} geometry={STEAM_GEO} material={STEAM_MAT} />
      ))}
    </group>
  );
}
