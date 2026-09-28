// The gun component: draws a gun from art/guns.ts and, in first person, animates it:
// idle breathing, per-gun firing motion (slide, pump, cylinder, drum, spinning barrels,
// coil glow, the spear / bolt being re-seated), a raise on every equip and a tilt-and-rack
// when the pistol's magazine refills. The world pickup and the WEAPONS panel draw the same
// model without the first-person animation.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { artFrame, artMaterial, artSet } from "./kit";
import { gunBuild, modKey, type GunId, type PistolMods } from "./guns";
import { gunFx as fx } from "./gunFx";

function gunMaterial() {
  // small props: a finer wear pattern and lighter wear than the robots
  return artMaterial({ wear: 0.45, scale: 16 });
}

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
/** a kick curve: snaps to 1 in `a` seconds, eases back to 0 by `a + b` */
const kick = (s: number, a: number, b: number) =>
  s < 0 ? 0 : s < a ? s / a : s < a + b ? 1 - ease((s - a) / b) : 0;

export function GunView({
  w,
  mods,
  color,
  body,
}: {
  w: GunId;
  mods?: PistolMods | undefined;
  color: string;
  body: string;
}) {
  const view = mods !== undefined; // first person (the pickup and the panel pass no mods)
  // test hook (like window.__rs): contact sheets can force pistol mod looks without buying perks
  const forced = view ? (globalThis as { __artGunMods?: PistolMods }).__artGunMods : undefined;
  const key = w === "pistol" ? modKey(forced ?? mods) : "";
  const g = useMemo(() => gunBuild(w, key, color, body), [w, key, color, body]);
  const mats = useMemo(() => ({ main: gunMaterial(), pulse: gunMaterial() }), []);
  const beamMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#ff2020",
        transparent: true,
        opacity: 0.55,
        fog: false,
        depthWrite: false,
      }),
    [],
  );
  useEffect(
    () => () => {
      mats.main.dispose();
      mats.pulse.dispose();
      beamMat.dispose();
    },
    [mats, beamMat],
  );
  const root = useRef<THREE.Group>(null);
  const parts = useRef<(THREE.Group | null)[]>([]);
  const st = useRef({
    w: "" as string,
    equip: -1e9,
    shots: fx.shots,
    turn: 0,
    turnTo: 0,
    spin: 0,
    reload: fx.reload,
  });

  useFrame((state, raw) => {
    artFrame();
    const dt = Math.min(raw, 0.05);
    const r = root.current;
    if (!r) return;
    const now = performance.now();
    const S = st.current;
    if (S.w !== w) {
      S.w = w;
      S.equip = now;
      S.shots = fx.shots;
    }
    if (!view) {
      r.position.set(0, 0, 0);
      r.rotation.set(0, 0, 0);
      return;
    }
    const t = state.clock.elapsedTime;
    const since = fx.hold ?? (now - fx.last) / 1000; // (hold: test hook, freezes the pose)
    const fresh = fx.shots !== S.shots;
    if (fresh) {
      S.turnTo += fx.shots - S.shots;
      S.shots = fx.shots;
    }
    // equip raise (from below, tilted) and the refill tilt-and-rack
    const eq = 1 - ease((now - S.equip) / 350);
    const rl = (now - fx.reload) / 1000;
    const tilt = rl >= 0 && rl < 0.75 ? Math.sin((rl / 0.75) * Math.PI) : 0;
    r.position.set(0, -0.14 * eq * eq - 0.04 * tilt + Math.sin(t * 1.3) * 0.002, 0.03 * tilt);
    r.rotation.set(
      -0.9 * eq * eq - 0.28 * tilt + Math.sin(t * 1.3) * 0.008,
      Math.sin(t * 0.9) * 0.01,
      0.55 * tilt,
    );
    // a rack (slide / pump / bolt) plays at the end of a raise or a refill as well as after shots
    const rackS = Math.min((now - S.equip) / 1000 - 0.22, rl >= 0 ? rl - 0.4 : 9);
    const shotS = since;

    // cylinders / drums ease a notch round per shot
    S.turn += (S.turnTo - S.turn) * Math.min(1, dt * 18);
    // spinning barrels: spool while firing, coast down after
    S.spin += dt * (since < 0.15 ? 40 : Math.max(0, 40 - since * 60) * 0.5);

    g.parts.forEach((p, i) => {
      const o = parts.current[i];
      if (!o) return;
      o.position.set(p.pivot[0], p.pivot[1], p.pivot[2]);
      o.rotation.set(0, 0, 0);
      o.visible = true;
      switch (p.name) {
        case "slide": {
          const k = Math.max(kick(shotS, 0.025, 0.09), kick(rackS, 0.08, 0.14));
          o.position.z += 0.05 * k;
          break;
        }
        case "pump": {
          const k = Math.max(kick(shotS - 0.12, 0.1, 0.18), kick(rackS, 0.1, 0.18));
          o.position.z += 0.075 * k;
          break;
        }
        case "bolt": {
          if (w === "crossbow") {
            // the bolt leaves, then a fresh one slides onto the rail
            const gone = shotS >= 0 && shotS < 0.2;
            o.visible = !gone;
            o.position.z +=
              shotS >= 0.2 && shotS < 0.5 ? 0.12 * (1 - ease((shotS - 0.2) / 0.3)) : 0;
          } else o.position.z += 0.03 * Math.max(kick(shotS, 0.02, 0.06), kick(rackS, 0.08, 0.12));
          break;
        }
        case "spear": {
          const gone = shotS >= 0 && shotS < 0.25;
          o.visible = !gone;
          o.position.z +=
            shotS >= 0.25 && shotS < 0.6 ? 0.18 * (1 - ease((shotS - 0.25) / 0.35)) : 0;
          break;
        }
        case "cyl":
        case "drum":
          if (w === "flak") o.rotation.x = S.turn * (Math.PI / 4);
          else o.rotation.z = -S.turn * (Math.PI / 3);
          break;
        case "barrels":
          o.rotation.z = S.spin;
          break;
        case "disc":
          o.rotation.y = t * 6 + S.spin * 0.5;
          break;
        case "ring":
          o.rotation.z = t * 2.2 + S.spin * 0.3;
          o.rotation.x = Math.sin(t * 1.1) * 0.25;
          break;
        case "coil":
          break;
      }
    });
    // pulsing glow: a throb on every shot on top of a slow idle hum
    artSet(mats.pulse, {
      glow: 1 + 2.4 * Math.exp(-Math.max(0, since) * 7) + Math.sin(t * 5) * 0.15,
    });
  });

  return (
    <group ref={root}>
      <mesh geometry={g.body} material={mats.main} />
      {g.parts.map((p, i) => (
        <group
          key={`${w}${key}${i}`}
          ref={(o) => {
            parts.current[i] = o;
          }}
          position={p.pivot}
        >
          <mesh
            geometry={p.geo}
            material={p.pulse ? mats.pulse : mats.main}
            position={[-p.pivot[0], -p.pivot[1], -p.pivot[2]]}
          />
        </group>
      ))}
      {g.laser && view && (
        <mesh position={[g.laser[0], g.laser[1], g.laser[2] - 3]} material={beamMat}>
          <boxGeometry args={[0.005, 0.005, 6]} />
        </mesh>
      )}
    </group>
  );
}
