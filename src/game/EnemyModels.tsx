// Models for the ten newer enemy types and their ordnance. Each robot is one skinned,
// detailed model (art/robots/newKinds.ts: one draw call, one shared geometry per type, its
// own bones), so a crowd of 100 costs a couple of draw calls per enemy. Only the moving
// telegraph parts (laser, shield, lanes, beams, wings, glows) are separate meshes here.

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { groundY } from "./terrain";

import { playEnemySfx, type EnemySfx } from "./audio";
import { PH_ACT, PH_AFTER, PH_WIND, visExtra, visPhase, visProg, type NewKind } from "./enemyKinds";
import { GRENADE_FUSE, MAX_ORD, ORD_BLAST, ORD_GRENADE, ORD_ROCKET, type Ord } from "./enemyAI";
import { artMaterial } from "./art/kit";
import { RobotModel } from "./art/RobotModel";
import type { RobotRig } from "./art/rig";
import { NEW_ACCENT, newRobot, visInputs } from "./art/robots/newKinds";

// ---------------------------------------------------------------- shared materials
const CLOAK = new THREE.MeshBasicMaterial({
  color: "#cfe0ff",
  transparent: true,
  opacity: 0.09,
  depthWrite: false,
});
/** the charger's glows flaring while it winds up and dashes (same program as every robot) */
const CHARGE_HOT = artMaterial({ skin: true, wear: 0.75, scale: 2.6, glow: 4 });
const HOT = new THREE.MeshBasicMaterial({ color: "#ffffff", fog: false });
const basic = new Map<string, THREE.MeshBasicMaterial>();
/** one shared unlit material per colour (and opacity) */
function mat(color: string, opacity = 1) {
  const key = `${color}/${opacity}`;
  let m = basic.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color,
      fog: false,
      transparent: opacity < 1,
      opacity,
      depthWrite: opacity >= 1,
    });
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

const X90: [number, number, number] = [Math.PI / 2, 0, 0];
const ACCENT = NEW_ACCENT;

/** body heights above the ground: fliers hover */
const HOVER: Partial<Record<NewKind, number>> = { medic: 2.5, hornet: 1.2 }; // hornets are drawn 1.3x, so ~1.55 m

type Data = {
  kind: string;
  x: number;
  z: number;
  alive: boolean;
  vis?: number;
  yaw?: number;
  flash: number;
  elite?: number;
};

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** sound for a telegraph starting, faded by distance; silent past ~35 m */
function cue(kind: EnemySfx, g: THREE.Object3D, cam: THREE.Camera) {
  g.getWorldPosition(_v);
  const d = _v.distanceTo(cam.position);
  if (d < 38) playEnemySfx(kind, 1 - d / 40);
}

export function NewEnemyModel({ kind, data, all }: { kind: NewKind; data: Data; all: Data[] }) {
  const root = useRef<THREE.Group>(null);
  const hover = useRef<THREE.Group>(null);
  const look = useRef({ hot: false, faint: false, spin: 0 }); // robot material / barrel state for onPose
  const a = useRef<THREE.Mesh>(null); // primary telegraph part
  const b = useRef<THREE.Mesh>(null); // secondary telegraph part
  const grp = useRef<THREE.Group>(null); // animated sub-assembly (arm, barrels, rotor, wings, shield)
  const prev = useRef({ ph: 0, ex: 0, blk: 0 });
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
    if (h)
      h.position.y =
        (HOVER[kind] ?? 0) +
        (HOVER[kind]
          ? Math.sin(t * (kind === "hornet" ? 9 : 2.2) + data.x) * (kind === "hornet" ? 0.12 : 0.1)
          : 0);

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
          L.material =
            ph === PH_WIND
              ? mat(accent, 0.35 + pr * 0.4)
              : ph === PH_ACT
                ? Math.floor(t * 16) % 2
                  ? HOT
                  : mat(accent)
                : HOT;
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
        if (arm)
          arm.rotation.x =
            ph === PH_WIND ? -2.6 * Math.min(1, pr * 1.6) : Math.sin(t * 3 + data.x) * 0.1;
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
          a.current.material = blk
            ? mat("#e8fbff", 0.7)
            : mat(accent, 0.32 + Math.sin(t * 5) * 0.05);
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
          lane.position.set(0, 0.2, 1.2 + 7.5 * inv); // above the city's 0.15 m pavements
          lane.material = mat(
            accent,
            pr > 0.7 ? (Math.floor(t * 14) % 2 ? 0.65 : 0.3) : 0.18 + pr * 0.25,
          );
        }
        look.current.hot = (ph === PH_WIND || ph === PH_ACT) && Math.floor(t * 12) % 2 === 1;
        if (grp.current) {
          grp.current.visible = ph === PH_AFTER; // dizzy sparks while stunned
          grp.current.rotation.y = t * 5;
        }
        if (h) h.position.y = ph === PH_WIND ? Math.abs(Math.sin(t * 18)) * 0.06 : 0; // pawing the ground
        if (ph === PH_WIND && was.ph !== PH_WIND) cue("charge", r, cam);
        break;
      }
      case "medic": {
        const beam = a.current;
        const pat = ex > 0 ? all[ex - 1] : undefined;
        if (beam) {
          beam.visible = ph === PH_ACT && !!pat?.alive;
          if (beam.visible && pat) {
            // stretch a box from the drone's emitter to the patient, in the drone's local space
            beam.parent!.getWorldPosition(_v);
            _v.y -= 0.35;
            _w.set(pat.x, groundY(pat.x, pat.z) + 1.2, pat.z);
            const mid = _v.clone().add(_w).multiplyScalar(0.5);
            beam.parent!.worldToLocal(mid);
            beam.position.copy(mid);
            beam.parent!.getWorldQuaternion(_q).invert();
            const dir = _w.clone().sub(_v);
            const len = dir.length();
            beam.quaternion.setFromUnitVectors(
              new THREE.Vector3(0, 1, 0),
              dir.normalize().applyQuaternion(_q),
            );
            beam.scale.set(0.08 * inv, len * inv, 0.08 * inv);
            beam.material = mat(accent, 0.5 + Math.sin(t * 30) * 0.2);
          }
        }
        if (ph === PH_ACT && was.ph !== PH_ACT) cue("heal", r, cam);
        break;
      }
      case "hornet": {
        if (grp.current)
          grp.current.children.forEach(
            (w, i) => (w.rotation.z = (i ? -1 : 1) * (0.3 + Math.sin(t * 60 + i) * 0.5)),
          );
        if (a.current) {
          a.current.visible = ph === PH_WIND || ph === PH_ACT;
          a.current.scale.setScalar(0.3 + pr * 0.15);
        }
        if (ph === PH_WIND && was.ph !== PH_WIND) cue("buzz", r, cam);
        break;
      }
      case "gatling": {
        const spin =
          ph === PH_WIND ? 4 + pr * 26 : ph === PH_ACT ? 32 : ph === PH_AFTER ? pr * 20 : 0.5;
        look.current.spin += spin * Math.min(0.05, delta);
        if (a.current) {
          a.current.visible = ph !== 0;
          const s = ph === PH_WIND ? 0.12 + pr * 0.1 : ph === PH_ACT ? 0.24 : 0.12 * pr;
          a.current.scale.setScalar(Math.max(0.01, s));
          a.current.material =
            ph === PH_ACT ? (Math.floor(t * 20) % 2 ? HOT : mat(accent)) : mat(accent);
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
        look.current.faint = faint;
        if (a.current) {
          a.current.visible = ph === PH_WIND; // the reared blade glows white-hot
        }
        if (shimmer && was.ex !== 2) cue("cloak", r, cam);
        break;
      }
    }
    was.ph = ph;
    was.ex = ex;
  });

  // after the robot is posed: the charger's flaring glows, the cloaker going faint, the
  // gatling's barrels (their spin accumulates here so it eases up and down smoothly)
  const onPose = (rig: RobotRig) => {
    const L = look.current;
    if (kind === "charger" && L.hot) rig.mesh.material = CHARGE_HOT;
    else if (kind === "cloaker" && L.faint) rig.mesh.material = CLOAK;
    else if (kind === "gatling") rig.byName["barrels"]!.rotation.z = L.spin;
  };

  return (
    <group ref={root}>
      <group ref={hover}>
        <RobotModel kind={newRobot(kind)} data={data} inputs={visInputs} onPose={onPose} />
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
            <mesh
              ref={a}
              geometry={G.sphere}
              material={mat(accent)}
              scale={0.13}
              position={[0, -0.64, 0]}
              visible={false}
            />
          </group>
        )}
        {kind === "bulwark" && (
          <group ref={grp}>
            <mesh
              ref={a}
              geometry={G.hex}
              material={mat("#55ddff", 0.68)}
              position={[0, 1.25, 0.95]}
              rotation={[Math.PI / 2, Math.PI / 6, 0]}
              scale={[1.05, 0.05, 1.12]}
            />
          </group>
        )}
        {kind === "charger" && (
          <>
            <group ref={grp} position={[0, 2.05, 0.6]} visible={false}>
              {[0, 1, 2, 3].map((i) => (
                <mesh
                  key={i}
                  geometry={G.sphere}
                  material={mat(accent)}
                  scale={0.07}
                  position={[Math.sin(i * 1.57) * 0.35, 0, Math.cos(i * 1.57) * 0.35]}
                />
              ))}
            </group>
          </>
        )}
        {kind === "medic" && (
          <>
            <mesh ref={a} geometry={G.cyl6} material={mat(accent, 0.6)} visible={false} />
          </>
        )}
        {kind === "hornet" && (
          <>
            <group ref={grp}>
              <mesh
                geometry={G.box}
                material={mat("#eef4ff", 0.55)}
                position={[0.2, 0.1, 0.02]}
                scale={[0.36, 0.01, 0.14]}
              />
              <mesh
                geometry={G.box}
                material={mat("#eef4ff", 0.55)}
                position={[-0.2, 0.1, 0.02]}
                scale={[0.36, 0.01, 0.14]}
              />
            </group>
            <mesh ref={a} geometry={G.sphere} material={mat(accent, 0.45)} visible={false} />
          </>
        )}
        {kind === "gatling" && (
          <group position={[0.72, 1.3, 0.55]}>
            <mesh
              ref={a}
              geometry={G.sphere}
              material={mat(accent)}
              position={[0, 0, 0.8]}
              visible={false}
            />
          </group>
        )}
        {kind === "rocketeer" && (
          <mesh
            ref={a}
            geometry={G.sphere}
            material={mat(accent)}
            position={[0.45, 1.62, 0.68]}
            visible={false}
          />
        )}
        {kind === "cloaker" && (
          <mesh
            ref={a}
            geometry={G.box}
            material={HOT}
            position={[0.33, 1.0, 0.76]}
            rotation={[-0.15, 0, 0]}
            scale={[0.05, 0.08, 0.8]}
            visible={false}
          />
        )}
      </group>
      {kind === "charger" && (
        <mesh
          ref={a}
          geometry={G.plane}
          material={mat(accent, 0.3)}
          rotation={[-Math.PI / 2, 0, 0]}
          visible={false}
        />
      )}
    </group>
  );
}

// ---------------------------------------------------------------- ordnance pool
/** Grenades (with their landing warning ring), homing rockets and blasts, for every client. */
export function OrdnancePool({
  ords,
  guestTx,
  guest,
}: {
  ords: Ord[];
  guestTx: Float32Array;
  guest: React.MutableRefObject<boolean>;
}) {
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
      if (!o.on) {
        seen.current[i] = false;
        continue;
      }
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
        ring.position.set(o.lx, groundY(o.lx, o.lz) + 0.21, o.lz); // above the city's 0.15 m pavements
        ring.scale.setScalar(o.r);
        fill.position.set(o.lx, groundY(o.lx, o.lz) + 0.2, o.lz);
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
        (boom as THREE.Mesh).material = mat(
          p < 0.3 ? "#fff2c0" : "#ff7a1a",
          Math.max(0.05, 0.75 * (1 - p)),
        );
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
        <group
          key={i}
          ref={(g) => {
            refs.current[i] = g;
          }}
          visible={false}
        >
          <mesh geometry={G.sphere} material={mat("#ff8c1a")} scale={0.16} />
          <mesh geometry={G.ring} material={mat("#ff2a1a", 0.85)} rotation={[-Math.PI / 2, 0, 0]} />
          <mesh geometry={G.disc} material={mat("#ff2a1a", 0.28)} rotation={[-Math.PI / 2, 0, 0]} />
          <group>
            <mesh
              geometry={G.cyl6}
              material={mat("#e8e4dc")}
              rotation={X90}
              scale={[0.16, 0.7, 0.16]}
            />
            <mesh
              geometry={G.cone}
              material={mat("#ff4fa3")}
              position={[0, 0, 0.45]}
              rotation={X90}
              scale={[0.18, 0.25, 0.18]}
            />
            <mesh
              geometry={G.cone}
              material={mat("#ffd08a", 0.8)}
              position={[0, 0, -0.55]}
              rotation={[-Math.PI / 2, 0, 0]}
              scale={[0.2, 0.5, 0.2]}
            />
          </group>
          <mesh geometry={G.sphere} material={mat("#ff7a1a", 0.6)} />
        </group>
      ))}
    </>
  );
}
