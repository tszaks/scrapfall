// Moving traffic for the city map (parked cars are static chunk geometry, see cityMesh.ts).
// Every vehicle part is an instance in one of three InstancedMeshes (paint / wheels / lamps),
// updated in one useFrame.
import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { type CityLayout } from "./cityLayout";
import { vehicleParts, type Part, type Vehicle } from "./vehicles";
import { liveCars, pursuitDots, trafficClock, type TrafficLink } from "./trafficCore";
import {
  ROLE_COP,
  ROLE_NORMAL,
  ROLE_SUSPECT,
  SIM_DT,
  headingOf,
  spawnTraffic,
  posOf as simPos,
  stepCars,
  trafficStats,
  type Car,
  type SimEnemy,
} from "./trafficSim";
import { newDirector, stepDirector } from "./pursuit";
import { playSfx, setSiren } from "./audio";
import { glowTexture } from "./cityTextures";
import type { TimeOfDay } from "./lighting";

/**
 * Numbers per car in the network snapshot: index, x, z, heading, speed + flags.
 * The last one is round(speed * 10) + 1000 * flags (siren / suspect / parked), which
 * stays a 3-byte uint16 on the wire, so pursuits cost no extra bytes per car.
 */
const CAR_FIELDS = 5;
const F_SIREN = 1;
const F_SUSPECT = 2;
const F_PARKED = 4;
/** siren voices (nearest cruisers) and how far a siren carries */
const SIREN_VOICES = 2;
const SIREN_RANGE = 280;
/** cars farther than this from every player are simulated at a quarter of the rate */
const FAR_SIM = 220;
/** cars within this of any player go in every snapshot; the rest take turns */
const NEAR_NET = 260;
const FAR_NET_SLICES = 5;
// integers on the wire: PeerJS binarypack sends small ints in ~3 bytes but any
// fractional number as a 9-byte float64
const q100 = (v: number) => Math.round(v * 100);

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _m = new THREE.Matrix4();
const _car = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();
const _right = new THREE.Vector3();
type SirenSrc = { ci: number; d: number; x: number; z: number; yaw: number; speed: number };
const sirens: SirenSrc[] = [];

function partMatrix(p: Part) {
  const m = new THREE.Matrix4();
  // wheel geometry is a unit cylinder lying along x: scale x = tyre width, y/z = diameter
  if (p.kind === "wheel") m.compose(_p.set(p.x, p.y, p.z), _q.identity(), _s.set(p.sz, p.sy, p.sx));
  else m.compose(_p.set(p.x, p.y, p.z), _q.identity(), _s.set(p.sx, p.sy, p.sz));
  return m;
}

type Slot = { mesh: "paint" | "wheel" | "lamp"; index: number; local: THREE.Matrix4; part: Part };
/** lightbar state: 0 off, 1 red lit, 2 blue lit */
type Bar = 0 | 1 | 2;
/** flasher phase for car `i` at traffic time `t`: each cruiser flashes out of step with the others */
const barAt = (t: number, i: number): Bar => {
  const ph = (t * 3.2 + i * 0.37) % 1;
  // double flash on each side: R R . B B .
  if (ph < 0.12 || (ph > 0.18 && ph < 0.3)) return 1;
  if ((ph > 0.5 && ph < 0.62) || (ph > 0.68 && ph < 0.8)) return 2;
  return 0;
};
/** siren tone: a slow wail far away, the fast yelp up close */
const sirenPitch = (t: number, i: number, yelp: boolean) => {
  if (yelp) {
    const p = (t * 3.1 + i * 0.29) % 1;
    return 720 + 820 * (p < 0.5 ? p * 2 : 2 - p * 2);
  }
  const p = (t / 4.4 + i * 0.23) % 1;
  return (
    640 +
    700 *
      (p < 0.6 ? Math.sin((p / 0.6) * Math.PI * 0.5) : Math.cos(((p - 0.6) / 0.4) * Math.PI * 0.5))
  );
};

export function CityTraffic({
  city,
  seed,
  time,
  link,
}: {
  city: CityLayout;
  seed: number;
  time: TimeOfDay;
  link: React.MutableRefObject<TrafficLink>;
}) {
  const { roadX, roadZ } = city;
  const timeRef = useRef(time);
  timeRef.current = time;

  // ---- moving cars, deterministic start from the seed ----
  const cars = useMemo(
    () => spawnTraffic(roadX, roadZ, city.spawn, seed),
    [seed, roadX, roadZ, city.spawn],
  );

  // ---- instance slots for every part of every vehicle (parked first, then moving) ----
  const { slots, counts, parkedCount } = useMemo(() => {
    const slots: Slot[][] = [];
    const counts = { paint: 0, wheel: 0, lamp: 0 };
    const add = (v: Vehicle) => {
      const mine: Slot[] = [];
      for (const part of vehicleParts(v)) {
        const mesh = part.kind === "paint" ? "paint" : part.kind === "wheel" ? "wheel" : "lamp";
        mine.push({ mesh, index: counts[mesh]++, local: partMatrix(part), part });
      }
      slots.push(mine);
    };
    cars.forEach((c) => add(c.v));
    return { slots, counts, parkedCount: 0 };
  }, [cars]);

  const geo = useMemo(() => {
    const wheel = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
    wheel.rotateZ(Math.PI / 2);
    const cone = new THREE.ConeGeometry(1.7, 7.5, 14, 1, true);
    cone.translate(0, -3.75, 0); // apex at the origin
    cone.rotateX(-Math.PI / 2); // opening toward +z (forward)
    const pool = new THREE.PlaneGeometry(3.2, 6.5);
    pool.rotateX(-Math.PI / 2);
    pool.translate(0, 0, 3.6);
    // police light spill on the road (flat) and the lightbar's glow (camera-facing)
    const spill = new THREE.PlaneGeometry(1, 1);
    spill.rotateX(-Math.PI / 2);
    const halo = new THREE.PlaneGeometry(1, 1);
    return { box: new THREE.BoxGeometry(1, 1, 1), wheel, cone, pool, spill, halo };
  }, []);
  const mats = useMemo(
    () => ({
      paint: new THREE.MeshLambertMaterial({ color: 0xffffff }),
      wheel: new THREE.MeshLambertMaterial({ color: 0xffffff }),
      lamp: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
      cone: new THREE.MeshBasicMaterial({
        color: 0xfff0c8,
        transparent: true,
        opacity: 0.06,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
      pool: new THREE.MeshBasicMaterial({
        color: 0xfff0c8,
        map: glowTexture(),
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
      spill: new THREE.MeshBasicMaterial({
        color: 0xffffff,
        map: glowTexture(),
        transparent: true,
        opacity: 0.75,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
      halo: new THREE.MeshBasicMaterial({
        color: 0xffffff,
        map: glowTexture(),
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    }),
    [],
  );
  useEffect(
    () => () => {
      Object.values(geo).forEach((g) => g.dispose());
      Object.values(mats).forEach((m) => m.dispose()); // the shared glow texture stays cached
    },
    [geo, mats],
  );

  // headlight beams and road pools: full at night, faint in the dusk light
  useEffect(() => {
    mats.cone.opacity = time === "night" ? 0.06 : 0.025;
    mats.pool.opacity = time === "night" ? 0.5 : 0.22;
  }, [time, mats]);

  const paintRef = useRef<THREE.InstancedMesh>(null);
  const wheelRef = useRef<THREE.InstancedMesh>(null);
  const lampRef = useRef<THREE.InstancedMesh>(null);
  const coneRef = useRef<THREE.InstancedMesh>(null);
  const poolRef = useRef<THREE.InstancedMesh>(null);
  const spillRef = useRef<THREE.InstancedMesh>(null);
  const haloRef = useRef<THREE.InstancedMesh>(null);

  const meshOf = (k: Slot["mesh"]) =>
    k === "paint" ? paintRef.current : k === "wheel" ? wheelRef.current : lampRef.current;

  /** lamp colours (lights are on at night and at dusk) depend on whether the car is moving,
   * and the police lightbar (dark unless the siren is on, then red and blue take turns) */
  const lampColor = (part: Part, moving: boolean, bar: Bar) => {
    if (part.kind === "head") return _c.set(moving ? 0xfff6d8 : 0x3a3a36);
    if (part.kind === "tail") return _c.set(moving ? 0xff2a1a : 0x3a0a08);
    if (part.kind === "sign") return _c.set(part.color);
    if (part.kind === "barR") return _c.set(bar === 1 ? 0xff2020 : 0x5a1010);
    if (part.kind === "barB") return _c.set(bar === 2 ? 0x3060ff : 0x10205a);
    return _c.set(part.color);
  };

  const placeCar = (i: number, x: number, z: number, yaw: number, moving: boolean, bar: Bar) => {
    _car.compose(_p.set(x, 0, z), _q.setFromAxisAngle(_up, yaw), _s.set(1, 1, 1));
    for (const sl of slots[i]!) {
      const mesh = meshOf(sl.mesh);
      if (!mesh) continue;
      _m.multiplyMatrices(_car, sl.local);
      mesh.setMatrixAt(sl.index, _m);
      if (sl.mesh === "lamp") mesh.setColorAt(sl.index, lampColor(sl.part, moving, bar));
    }
  };

  // static colours, once per layout
  useLayoutEffect(() => {
    for (const sl of slots.flat()) {
      if (sl.mesh === "lamp") continue;
      meshOf(sl.mesh)?.setColorAt(sl.index, _c.set(sl.part.color));
    }
    for (const m of [paintRef.current, wheelRef.current, lampRef.current]) {
      if (!m) continue;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }, [slots]);

  const rand = useMemo(() => mulberry(seed ^ 0x7a11c), [seed]);
  // guest: latest host state per car + when it arrived
  const netCars = useRef<
    { x: number; z: number; yaw: number; speed: number; flags: number; at: number }[]
  >([]);
  // police pursuits (host / solo decide; guests see the flags in the snapshot)
  const director = useMemo(() => newDirector(seed), [seed, cars]); // eslint-disable-line react-hooks/exhaustive-deps
  const hostClock = useRef<{ t: number; at: number } | null>(null);

  const posOf = (c: Car) => simPos(c, roadX, roadZ);
  const acc = useRef(0);
  const tick = useRef(0);

  // a new arena (new seed) restarts traffic identically everywhere
  useEffect(() => {
    // new arena: drop every piece of per-run traffic state so nothing stale survives
    trafficClock.t = 0;
    netCars.current = [];
    hostClock.current = null;
    enemyHit.current.clear();
    acc.current = 0;
    liveCars.length = 0;
    pursuitDots.length = 0;
    trafficStats.redRunsNormal = 0;
    trafficStats.redRunsSpecial = 0;
  }, [cars]);

  // network hooks: the host encodes, guests decode (motion only; types come from the seed).
  // The payload is bounded: cars near any player every snapshot, far cars a slice at a time.
  const netSlice = useRef(0);
  useEffect(() => {
    const L = link.current;
    L.encode = () => {
      const out: number[] = [q100(trafficClock.t)];
      const players = [{ x: L.px, z: L.pz }, ...L.others];
      const slice = netSlice.current++ % FAR_NET_SLICES;
      cars.forEach((c, i) => {
        // pursuit cars always go out (at most 9), so guests see chases coming on the minimap
        const near =
          c.role !== ROLE_NORMAL ||
          players.some((p) => Math.abs(p.x - c.x) < NEAR_NET && Math.abs(p.z - c.z) < NEAR_NET);
        if (!near && i % FAR_NET_SLICES !== slice) return;
        const flags =
          (c.role === ROLE_COP ? F_SIREN : 0) |
          (c.role === ROLE_SUSPECT ? F_SUSPECT : 0) |
          (c.park ? F_PARKED : 0);
        out.push(i, q100(c.x), q100(c.z), q100(c.yaw), Math.round(c.speed * 10) + 1000 * flags);
      });
      return out;
    };
    L.decode = (a) => {
      if (!Array.isArray(a) || (a.length - 1) % CAR_FIELDS !== 0) return;
      const now = performance.now();
      hostClock.current = { t: a[0]! / 100, at: now };
      for (let o = 1; o + CAR_FIELDS - 1 < a.length; o += CAR_FIELDS) {
        const i = a[o]!;
        if (i < 0 || i >= cars.length) continue;
        const sf = a[o + 4]!;
        netCars.current[i] = {
          x: a[o + 1]! / 100,
          z: a[o + 2]! / 100,
          yaw: a[o + 3]! / 100,
          speed: (sf % 1000) / 10,
          flags: Math.floor(sf / 1000),
          at: now,
        };
      }
    };
    return () => {
      L.encode = null;
      L.decode = null;
    };
  }, [cars]); // eslint-disable-line react-hooks/exhaustive-deps
  const enemyHit = useRef(new Map<number, number>());

  useEffect(
    () => () => {
      liveCars.length = 0;
      pursuitDots.length = 0;
      for (let k = 0; k < SIREN_VOICES; k++) setSiren(k, 700, 0, 0, 0);
    },
    [],
  );
  useEffect(() => {
    const debug =
      import.meta.env.DEV || new URLSearchParams(window.location.search).get("debug") === "1";
    if (debug)
      Object.assign(window, {
        __rsCars: cars,
        __rsPursuit: director,
        __rsTrafficStats: trafficStats,
      });
  }, [cars, director]);

  // a moving car touched an enemy (host only). Small ones get thrown aside and hurt;
  // big ones (brute, vanguard, elites, mini-boss, boss) stop the car and just take a knock.
  const contact = (c: Car, idx: number, big: boolean) => {
    const L = link.current;
    const tt = trafficClock.t;
    const last = enemyHit.current.get(idx) ?? -9;
    if (tt - last < 0.8 || !L.hurtEnemy) return;
    enemyHit.current.set(idx, tt);
    const e = L.enemies[idx]!;
    const yaw = headingOf(c);
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    const side = (e.x - c.x) * cos - (e.z - c.z) * sin >= 0 ? 1 : -1;
    if (big) L.hurtEnemy(idx, 1, 0, 0);
    else L.hurtEnemy(idx, Math.round(2 + c.speed * c.v.mass * 0.35), cos * side, -sin * side);
  };

  useFrame((state, raw) => {
    const dt = Math.min(raw, 0.05);
    const L = link.current;
    const guest = L.role === "guest";
    const now = performance.now();
    if (guest && hostClock.current)
      trafficClock.t = hostClock.current.t + (now - hostClock.current.at) / 1000;
    if (!guest) {
      // fixed timestep: the same path at any frame rate
      const enemies: SimEnemy[] = L.enemies.map((e) => ({
        x: e.x,
        z: e.z,
        alive: e.alive,
        r: L.radiusOf(e),
        big: L.isBig(e),
      }));
      const players = [{ x: L.px, z: L.pz }, ...L.others];
      const onEnemyContact = L.isHost && L.hurtEnemy ? contact : undefined;
      // far cars (nobody within FAR_SIM) run at a quarter of the rate with a 4x step;
      // pursuit cars always run at the full rate
      for (const c of cars)
        c.far =
          c.role === ROLE_NORMAL &&
          !players.some((p) => Math.abs(p.x - c.x) < FAR_SIM && Math.abs(p.z - c.z) < FAR_SIM);
      acc.current += dt;
      let steps = 0;
      while (acc.current >= SIM_DT && steps < 6) {
        acc.current -= SIM_DT;
        steps++;
        trafficClock.t += SIM_DT;
        tick.current++;
        const env = { roadX, roadZ, rand, players, enemies, onEnemyContact };
        stepDirector(director, cars, env, trafficClock.t);
        if (tick.current % 4 === 0) stepCars(cars, env, SIM_DT * 4, trafficClock.t, true);
        for (const ci of stepCars(cars, env, SIM_DT, trafficClock.t, false)) {
          const c = cars[ci]!;
          if (L.active && c.honk <= 0 && c.speed > 2.5) {
            c.honk = 3;
            playSfx("horn");
          }
        }
      }
      if (steps === 6) acc.current = 0; // hopelessly behind (tab was hidden): don't spiral
    }
    const t = trafficClock.t;
    const isNight = timeRef.current === "night";
    liveCars.length = 0;
    pursuitDots.length = 0;
    const cam = state.camera;
    // camera right vector, for panning the sirens
    _right.set(1, 0, 0).applyQuaternion(cam.quaternion);
    sirens.length = 0;

    for (let ci = 0; ci < cars.length; ci++) {
      const c = cars[ci]!;
      c.hitCd -= dt;
      c.honk -= dt;

      const half = c.v.len / 2;
      let np: { x: number; z: number };
      let yaw: number;
      let flags = 0;
      if (guest) {
        // follow the host: dead-reckon from the last snapshot, then ease toward it
        const ns = netCars.current[ci];
        const start = posOf(c);
        if (c.gx === undefined || c.gz === undefined) {
          c.gx = start.x;
          c.gz = start.z;
        }
        if (ns) {
          const age = (now - ns.at) / 1000;
          const live = age < 0.4; // host went quiet (paused): hold still
          const sp = live ? ns.speed : 0;
          const ahead = Math.min(age, 0.25); // short horizon: braking cars would overshoot
          const tx = ns.x + Math.sin(ns.yaw) * ns.speed * ahead;
          const tz = ns.z + Math.cos(ns.yaw) * ns.speed * ahead;
          c.gx += Math.sin(ns.yaw) * sp * dt;
          c.gz += Math.cos(ns.yaw) * sp * dt;
          // fast pursuit cars drift further between snapshots before a snap is warranted
          if (Math.hypot(tx - c.gx, tz - c.gz) > 6 + ns.speed * 0.25) {
            c.gx = tx; // first snapshot or a big correction: snap
            c.gz = tz;
            c.yawVis = ns.yaw;
          } else {
            const k = 1 - Math.exp(-dt * 8);
            c.gx += (tx - c.gx) * k;
            c.gz += (tz - c.gz) * k;
          }
          c.speed = sp;
          yaw = ns.yaw;
          flags = ns.flags;
        } else {
          yaw = c.yawVis;
          c.speed = 0;
        }
        np = { x: c.gx, z: c.gz };
        let dy = yaw - c.yawVis;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        c.yawVis += dy * (1 - Math.exp(-dt * 9)); // same easing at any frame rate
      } else {
        // interpolate between the last two fixed simulation steps (far cars step 4x coarser)
        const a = c.far
          ? Math.min(1, ((tick.current % 4) + acc.current / SIM_DT) / 4)
          : acc.current / SIM_DT;
        np = { x: c.px + (c.x - c.px) * a, z: c.pz + (c.z - c.pz) * a };
        let dy = c.yaw - c.pyaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        c.yawVis = c.pyaw + dy * a;
        flags =
          (c.role === ROLE_COP ? F_SIREN : 0) |
          (c.role === ROLE_SUSPECT ? F_SUSPECT : 0) |
          (c.park ? F_PARKED : 0);
      }
      const siren = (flags & F_SIREN) !== 0;
      const bar: Bar = siren ? barAt(t, ci) : 0;
      // ---- draw ----
      placeCar(parkedCount + ci, np.x, np.z, c.yawVis, true, bar);
      const sin = Math.sin(c.yawVis);
      const cos = Math.cos(c.yawVis);
      liveCars.push({ x: np.x, z: np.z, sin, cos, hl: half, hw: c.v.wid / 2, h: c.h });
      if (coneRef.current && poolRef.current) {
        _car.compose(
          _p.set(np.x + sin * half, 0.62, np.z + cos * half),
          _q.setFromAxisAngle(_up, c.yawVis),
          _s.set(1, 1, 1),
        );
        coneRef.current.setMatrixAt(ci, _car);
        _car.compose(
          _p.set(np.x + sin * half, 0.03, np.z + cos * half),
          _q.setFromAxisAngle(_up, c.yawVis),
          _s.set(1, 1, 1),
        );
        poolRef.current.setMatrixAt(ci, _car);
      }
      // ---- police lights: road spill (night) and the lightbar glow ----
      if (spillRef.current && haloRef.current) {
        if (bar) {
          // the lit side of the bar throws its colour on the road around that side of the car
          const side = bar === 1 ? -1 : 1;
          const col = bar === 1 ? 0xff1a14 : 0x2a50ff;
          _car.compose(
            _p.set(np.x + cos * side * 1.6, 0.04, np.z - sin * side * 1.6),
            _q.setFromAxisAngle(_up, c.yawVis),
            _s.set(11, 1, 13),
          );
          spillRef.current.setMatrixAt(ci, _car);
          spillRef.current.setColorAt(ci, _c.set(col));
          const hs = isNight ? 3.4 : 2.4;
          _car.compose(
            _p.set(np.x + cos * side * 0.35, c.h + 0.3, np.z - sin * side * 0.35),
            cam.quaternion,
            _s.set(hs, hs, hs),
          );
          haloRef.current.setMatrixAt(ci, _car);
          haloRef.current.setColorAt(ci, _c.set(col));
        } else {
          _car.makeScale(0, 0, 0);
          spillRef.current.setMatrixAt(ci, _car);
          haloRef.current.setMatrixAt(ci, _car);
        }
      }
      if (siren || flags & F_SUSPECT)
        pursuitDots.push({ x: np.x, z: np.z, kind: siren ? 1 : 2, i: ci });
      if (siren) {
        const d = Math.hypot(np.x - cam.position.x, np.z - cam.position.z);
        if (d < SIREN_RANGE)
          sirens.push({ ci, d, x: np.x, z: np.z, yaw: c.yawVis, speed: c.speed });
      }

      // ---- bumping into the player ----
      const dx = L.px - np.x;
      const dz = L.pz - np.z;
      const a = dx * sin + dz * cos;
      const lat = dx * cos - dz * sin;
      if (
        L.active &&
        c.hitCd <= 0 &&
        Math.abs(a) < half + 0.45 &&
        Math.abs(lat) < c.v.wid / 2 + 0.45
      ) {
        const side = lat >= 0 ? 1 : -1;
        // (cos, -sin) is sideways across the car in world space
        const pursuit = (flags & (F_SIREN | F_SUSPECT)) !== 0;
        if (c.speed > 1.2) {
          // pursuit cars don't stop for you, and they hit a lot harder
          const cap = pursuit ? 34 : 22;
          const force = Math.min(cap, (3 + c.speed * 1.25) * Math.sqrt(c.v.mass));
          const kx = sin * force * 0.75 + cos * side * force * 0.65;
          const kz = cos * force * 0.75 - sin * side * force * 0.65;
          const impact = c.speed * c.v.mass;
          const dmg = impact > 5 ? Math.max(1, Math.round(impact / (pursuit ? 4 : 5))) : 0;
          L.hitPlayer(dmg, kx, kz, Math.min(1, impact / 12));
          c.hitCd = 0.6;
          if (!guest) c.speed *= pursuit ? 0.85 : 0.5;
        } else {
          // crawling: just nudge the player out of the way
          L.hitPlayer(0, cos * side * 2.5, -sin * side * 2.5, 0);
          c.hitCd = 0.25;
        }
      }
    }
    // ---- sirens: the nearest cruisers, louder when close, pitch bent by their motion ----
    sirens.sort((p, q) => p.d - q.d);
    for (let k = 0; k < SIREN_VOICES; k++) {
      const s = sirens[k];
      if (!s || !L.active) {
        setSiren(k, 700, 0, 0, 0);
        continue;
      }
      const lx = cam.position.x - s.x;
      const lz = cam.position.z - s.z;
      const dd = Math.max(1, Math.hypot(lx, lz));
      // speed toward the listener -> simple Doppler, clamped so it never sounds silly
      const vr = ((Math.sin(s.yaw) * lx + Math.cos(s.yaw) * lz) / dd) * s.speed;
      const dop = Math.max(0.88, Math.min(1.14, 343 / (343 - vr)));
      const near = 1 / (1 + Math.pow(s.d / 22, 1.4));
      const fade = Math.max(0, 1 - s.d / SIREN_RANGE);
      const pan = Math.max(-0.85, Math.min(0.85, (-lx * _right.x - lz * _right.z) / dd));
      setSiren(k, sirenPitch(t, s.ci, s.d < 50) * dop, 0.2 * near * fade, pan, near);
    }
    for (const m of [
      paintRef.current,
      wheelRef.current,
      lampRef.current,
      coneRef.current,
      poolRef.current,
      spillRef.current,
      haloRef.current,
    ]) {
      if (!m) continue;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    // police light spill reads on the road at night and (fainter) at dusk
    if (spillRef.current) mats.spill.opacity = isNight ? 0.75 : 0.4;
  });

  return (
    <group>
      {counts.paint > 0 && (
        <instancedMesh
          ref={paintRef}
          args={[geo.box, mats.paint, counts.paint]}
          receiveShadow
          frustumCulled={false}
        />
      )}
      {counts.wheel > 0 && (
        <instancedMesh
          ref={wheelRef}
          args={[geo.wheel, mats.wheel, counts.wheel]}
          frustumCulled={false}
        />
      )}
      {counts.lamp > 0 && (
        <instancedMesh
          ref={lampRef}
          args={[geo.box, mats.lamp, counts.lamp]}
          frustumCulled={false}
        />
      )}
      {cars.length > 0 && (
        <>
          <instancedMesh
            ref={coneRef}
            args={[geo.cone, mats.cone, cars.length]}
            frustumCulled={false}
          />
          <instancedMesh
            ref={poolRef}
            args={[geo.pool, mats.pool, cars.length]}
            frustumCulled={false}
          />
          <instancedMesh
            ref={spillRef}
            args={[geo.spill, mats.spill, cars.length]}
            frustumCulled={false}
          />
          <instancedMesh
            ref={haloRef}
            args={[geo.halo, mats.halo, cars.length]}
            frustumCulled={false}
          />
        </>
      )}
    </group>
  );
}
