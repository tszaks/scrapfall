// Dry Gulch's street life on screen: riders, buckboards and the stagecoach from riders.ts,
// drawn as a handful of instanced meshes (horse bodies, swinging legs, riders' parts, coach and
// wagon bodies), stepped on the host with the train's clock discipline and synced in its
// snapshot. They bump you like cars, stop bullets like cars, and the posse's chase shows on
// the minimap with Vice Heights' pursuit dots.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { Geo } from "../cityGeo";
import { groundY } from "../terrain";
import { liveCars, pursuitDots, type TrafficLink } from "../trafficCore";
import { mapEvent } from "../events/mapEvents";
import { facadeMaterial, syncEnv } from "./materials";
import { propTemplate } from "./mesh";
import { BOX, ROLE_OUTLAW, ROLE_POSSE, ROLE_TOWN, TOWNFOLK, coastSim, decodeSim, encodeSim, newSim, stepSim, type Agent, type Sim } from "./riderSim";
import { pistolShot } from "./sound";
import type { WesternLayout } from "./layout";

/** the train's snapshot carries the riders too (Train.tsx calls these) */
export const riderSync: { encode: (() => number[]) | null; decode: ((a: number[]) => void) | null } = {
  encode: null,
  decode: null,
};

const COATS = ["#6a3a22", "#8a4a26", "#2a2220", "#a8a098", "#c8a060", "#b08a58"];
const SHIRTS = ["#d8cfb8", "#7a4a3a", "#4a5a6a", "#a8844a", "#5a6a4a", "#e8e0cc"];
const HATS = ["#6a5a44", "#3a3028", "#8a7a5a", "#2a2420", "#a89878", "#4a3a2a"];

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qa = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _c = new THREE.Color();
const _up = new THREE.Vector3(0, 1, 0);
const _x = new THREE.Vector3(1, 0, 0);

function geoOf(key: Parameters<typeof propTemplate>[0]) {
  const t = propTemplate(key);
  const g = new Geo();
  if (t) g.stamp(t.d, 0, 0, 0, 0);
  return g.build();
}

/** horses of an agent: offsets (local x, z) of each horse from the agent's centre */
function team(a: Agent): [number, number][] {
  if (a.kind === 0) return [[0, 0]];
  if (a.kind === 1) return [[-0.45, 2.2], [0.45, 2.2]];
  return [[-0.45, 1.5], [0.45, 1.5], [-0.45, 3.3], [0.45, 3.3]];
}
/** the rider's seat: local offset and height shift from a saddle */
function seat(a: Agent): [number, number, number] {
  if (a.kind === 0) return [0, 0, 0];
  if (a.kind === 1) return [0, -1.8 + 1.45, -0.35]; // on the buckboard's seat
  return [0, 0.75, -0.9]; // up on the coach's box
}

const MAX_HORSES = TOWNFOLK * 4 + 4;

export function WesternRiders({
  layout,
  seed,
  link,
}: {
  layout: WesternLayout;
  seed: number;
  link: React.MutableRefObject<TrafficLink>;
}) {
  const sim = useRef<Sim>(newSim(seed));
  const nightK = useMemo(() => ({ value: 0 }), []);
  const mat = useMemo(() => facadeMaterial(nightK), [nightK]);
  const geos = useMemo(
    () => ({
      body: geoOf("horsebody"),
      leg: geoOf("horseleg"),
      torso: geoOf("riderTorso"),
      hat: geoOf("riderHat"),
      legs: geoOf("riderLegs"),
      coach: geoOf("stagecoach"),
      wagon: geoOf("wagon"),
    }),
    [],
  );
  useEffect(
    () => () => {
      Object.values(geos).forEach((g) => g.dispose());
      mat.dispose();
    },
    [geos, mat],
  );
  const refs = {
    body: useRef<THREE.InstancedMesh>(null),
    leg: useRef<THREE.InstancedMesh>(null),
    torso: useRef<THREE.InstancedMesh>(null),
    hat: useRef<THREE.InstancedMesh>(null),
    legs: useRef<THREE.InstancedMesh>(null),
    coach: useRef<THREE.InstancedMesh>(null),
    wagon: useRef<THREE.InstancedMesh>(null),
  };
  const flash = useRef<THREE.Mesh>(null);
  const flashT = useRef(0);
  const acc = useRef(0);
  const bumpCd = useRef(new Map<number, number>());
  const lastBanner = useRef(0);

  // (a test handle with ?debug=1: the sim itself)
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("debug") === "1")
      (window as unknown as { __rsRiders?: unknown }).__rsRiders = sim.current;
  }, []);
  // sync through the train's snapshot
  useEffect(() => {
    riderSync.encode = () => encodeSim(sim.current);
    riderSync.decode = (a) => decodeSim(sim.current, a, 0);
    return () => {
      riderSync.encode = null;
      riderSync.decode = null;
    };
  }, []);
  void layout;

  useFrame((state, raw) => {
    const dt = Math.min(raw, 0.05);
    syncEnv(mat);
    const L = link.current;
    const S = sim.current;
    const guest = L.role === "guest";
    // ---- step (host / solo) or coast (guest) ----
    if (guest) coastSim(S, dt);
    else {
      acc.current += dt;
      const players = [{ x: L.px, z: L.pz, r: 0.45 }, ...L.others.map((o) => ({ x: o.x, z: o.z, r: 0.45 }))];
      let n = 0;
      while (acc.current >= 1 / 30 && n < 4) {
        acc.current -= 1 / 30;
        stepSim(S, 1 / 30, players);
        n++;
      }
      if (n === 4) acc.current = 0;
      // the chase's news for the HUD
      for (const ev of S.events) {
        if (ev === "chase" && S.t - lastBanner.current > 5) {
          mapEvent.banner = { title: "OUTLAW ON THE RUN", sub: "THE SHERIFF'S POSSE IS RIDING HIM DOWN", color: "#8a4a1c", at: performance.now() };
          lastBanner.current = S.t;
        } else if (ev === "caught") {
          mapEvent.banner = { title: "THE POSSE GOT HIM", sub: "THE OUTLAW IS UNDER ARREST", color: "#5a6a3a", at: performance.now() };
        }
      }
      S.events.length = 0;
    }
    const cam = state.camera.position;
    // ---- posse gunfire: a flash at the muzzle and the crack of a pistol ----
    for (const sh of S.shots) {
      const d = Math.hypot(sh.x - cam.x, sh.z - cam.z);
      if (d < 160) {
        const f = flash.current;
        if (f) {
          f.position.set(sh.x + (sh.tx - sh.x) * 0.02, groundY(sh.x, sh.z) + 2.3, sh.z + (sh.tz - sh.z) * 0.02);
          flashT.current = 0.07;
        }
        const pan = Math.sin(Math.atan2(sh.x - cam.x, sh.z - cam.z) - state.camera.rotation.y);
        pistolShot(d, pan);
      }
    }
    if (flash.current) {
      flashT.current -= dt;
      flash.current.visible = flashT.current > 0;
    }
    // ---- bumps: you get knocked like by a car; enemies are shoved aside ----
    for (let i = 0; i < S.agents.length; i++) {
      const a = S.agents[i]!;
      if (a.hold === Infinity || a.speed < 0.8) continue;
      const B = BOX[a.kind];
      const hx = Math.sin(a.yaw);
      const hz = Math.cos(a.yaw);
      const cx = a.x + hx * (a.kind === 0 ? 0 : 0.6);
      const cz = a.z + hz * (a.kind === 0 ? 0 : 0.6);
      const inBox = (x: number, z: number, r: number) => {
        const dx = x - cx;
        const dz = z - cz;
        const al = dx * hx + dz * hz;
        const lt = dx * hz - dz * hx;
        return Math.abs(al) < B.hl + r && Math.abs(lt) < B.hw + r ? lt : null;
      };
      const lt = inBox(L.px, L.pz, 0.4);
      const cd = bumpCd.current.get(i) ?? 0;
      if (lt !== null && L.active && performance.now() > cd) {
        bumpCd.current.set(i, performance.now() + 900);
        const side = lt >= 0 ? 1 : -1;
        const push = 2.5 + a.speed * 0.6;
        L.hitPlayer(a.kind === 2 ? 2 : 1, hx * a.speed * 0.6 + hz * side * push, hz * a.speed * 0.6 - hx * side * push, Math.min(1, a.speed / 8));
      }
      if (!guest)
        for (const e of L.enemies) {
          if (!e.alive) continue;
          const el = inBox(e.x, e.z, L.radiusOf(e));
          if (el === null) continue;
          const side = el >= 0 ? 1 : -1;
          e.x += hz * side * 0.25;
          e.z -= hx * side * 0.25;
        }
    }
    // ---- bullets stop on them (after the train has published its cars this frame) ----
    for (const a of S.agents) {
      if (a.hold === Infinity) continue;
      const B = BOX[a.kind];
      const hx = Math.sin(a.yaw);
      const hz = Math.cos(a.yaw);
      liveCars.push({ x: a.x + hx * (a.kind === 0 ? 0 : 0.6), z: a.z + hz * (a.kind === 0 ? 0 : 0.6), sin: hx, cos: hz, hl: B.hl, hw: B.hw, h: B.h });
    }
    // ---- the minimap's pursuit dots ----
    pursuitDots.length = 0;
    S.agents.forEach((a, i) => {
      if (a.hold === Infinity || a.role === ROLE_TOWN) return;
      pursuitDots.push({ x: a.x, z: a.z, kind: a.role === ROLE_OUTLAW ? 2 : 1, i });
    });
    // ---- draw ----
    const r = refs;
    const body = r.body.current;
    const leg = r.leg.current;
    const torso = r.torso.current;
    const hat = r.hat.current;
    const legs = r.legs.current;
    const coach = r.coach.current;
    const wagon = r.wagon.current;
    if (!body || !leg || !torso || !hat || !legs || !coach || !wagon) return;
    let nh = 0;
    let nl = 0;
    let nr = 0;
    let nc = 0;
    let nw = 0;
    for (const a of S.agents) {
      if (a.hold === Infinity) continue;
      if (Math.hypot(a.x - cam.x, a.z - cam.z) > 420) continue;
      const gy = groundY(a.x, a.z);
      _q.setFromAxisAngle(_up, a.yaw);
      const hx = Math.sin(a.yaw);
      const hz = Math.cos(a.yaw);
      const rx = hz;
      const rz = -hx;
      const at = (lx: number, lz: number, y: number) => _p.set(a.x + rx * lx + hx * lz, gy + y, a.z + rz * lx + hz * lz);
      // the gait: a walk, a trot, a gallop by speed; legs swing in diagonal pairs
      const sp = a.speed;
      const amp = Math.min(0.75, 0.15 + sp * 0.07);
      const bob = Math.abs(Math.sin(a.ph)) * Math.min(0.12, sp * 0.015);
      const coatAt = (k: number) => _c.set(COATS[(a.look + k) % COATS.length]!);
      team(a).forEach(([lx, lz], k) => {
        body.setMatrixAt(nh, _m.compose(at(lx, lz, bob), _q, _s));
        body.setColorAt(nh, a.role === ROLE_POSSE ? _c.set("#8a5a32") : a.role === ROLE_OUTLAW ? _c.set("#1e1a18") : coatAt(k));
        nh++;
        const hips: [number, number, number][] = [
          [-0.19, 0.55, 0],
          [0.19, 0.55, Math.PI],
          [-0.19, -0.6, Math.PI],
          [0.19, -0.6, 0],
        ];
        for (const [hxo, hzo, off] of hips) {
          const sw = Math.sin(a.ph + off + k) * amp;
          _qa.setFromAxisAngle(_x, sw).premultiply(_q);
          leg.setMatrixAt(nl, _m.compose(at(lx + hxo, lz + hzo, 1.05 + bob), _qa, _s));
          leg.setColorAt(nl, a.role === ROLE_OUTLAW ? _c.set("#1e1a18") : a.role === ROLE_POSSE ? _c.set("#8a5a32") : coatAt(k));
          nl++;
        }
      });
      // the rider (or the driver)
      const [sx, sy, sz] = seat(a);
      const riderPos = at(sx, sz, sy + (a.kind === 0 ? bob : 0));
      _m.compose(riderPos, _q, _s);
      torso.setMatrixAt(nr, _m);
      torso.setColorAt(nr, _c.set(a.role === ROLE_POSSE ? "#b8a07a" : a.role === ROLE_OUTLAW ? "#6a1a14" : SHIRTS[a.look % SHIRTS.length]!));
      hat.setMatrixAt(nr, _m);
      hat.setColorAt(nr, _c.set(a.role === ROLE_POSSE ? "#e8e0cc" : a.role === ROLE_OUTLAW ? "#141210" : HATS[a.look % HATS.length]!));
      legs.setMatrixAt(nr, _m);
      nr++;
      if (a.kind === 2) {
        coach.setMatrixAt(nc++, _m.compose(at(0, -2.3, 0), _q, _s));
      } else if (a.kind === 1) {
        wagon.setMatrixAt(nw++, _m.compose(at(0, -1.7, 0), _q, _s));
      }
    }
    body.count = nh;
    leg.count = nl;
    torso.count = hat.count = legs.count = nr;
    coach.count = nc;
    wagon.count = nw;
    for (const m of [body, leg, torso, hat, legs, coach, wagon]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  });

  const white = useMemo(() => new THREE.Color("#ffffff"), []);
  const inst = (k: keyof typeof geos, count: number, colored: boolean) => (
    <instancedMesh
      ref={refs[k]}
      args={[geos[k], mat, count]}
      frustumCulled={false}
      castShadow
      receiveShadow
      onUpdate={(m) => {
        if (colored && !m.instanceColor) {
          for (let i = 0; i < count; i++) m.setColorAt(i, white);
        }
      }}
    />
  );
  return (
    <group>
      {inst("body", MAX_HORSES, true)}
      {inst("leg", MAX_HORSES * 4, true)}
      {inst("torso", TOWNFOLK + 4, true)}
      {inst("hat", TOWNFOLK + 4, true)}
      {inst("legs", TOWNFOLK + 4, false)}
      {inst("coach", 2, false)}
      {inst("wagon", 4, false)}
      <mesh ref={flash} visible={false}>
        <sphereGeometry args={[0.18, 8, 6]} />
        <meshBasicMaterial color="#ffe0a0" toneMapped={false} />
      </mesh>
    </group>
  );
}
