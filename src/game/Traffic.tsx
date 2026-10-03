import { registerDriveCar, driveCars, driving } from "./driving";
import { registerStaticInstances } from "./staticCollision";
// Moving traffic for the city map, and the map's parked cars. Every vehicle draws through one
// CarBatch (art/cars.ts): an InstancedMesh per vehicle type and LOD, plus shared wheel, glass
// and lamp meshes, updated in one useFrame.
import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { type CityLayout } from "./cityLayout";
import { CarBatch, vehicleModel, vehicleModelKey, wheelGeometry } from "./art/cars";
import { liveCars, pursuitDots, trafficClock, type TrafficLink } from "./trafficCore";
import {
  ROLE_COP,
  ROLE_NORMAL,
  ROLE_SUSPECT,
  SIM_DT,
  markFar,
  headingOf,
  spawnTraffic,
  posOf as simPos,
  stepCars,
  trafficStats,
  type Car,
  type SimEnemy,
  type SimEnv,
} from "./trafficSim";
import { newDirector, stepDirector } from "./pursuit";
import { setAmbienceTraffic } from "./ambience";
import { playSfx, setSiren } from "./audio";
import { glowTexture } from "./cityTextures";
import type { TimeOfDay } from "./lighting";
import { liveCity, tod } from "./timeOfDay";

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
const sirenPool: SirenSrc[] = [];
// (this frame's lists are rebuilt from pooled slots: fresh objects per car per frame were a
// measurable GC source — everything that reads them does so within the frame)
type LiveSlot = {
  driveId?: string;
  i: number;
  x: number;
  z: number;
  sin: number;
  cos: number;
  hl: number;
  hw: number;
  h: number;
  base?: number;
  bounds?: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
  rayContact?: (
    a: { x: number; y: number; z: number },
    b: { x: number; y: number; z: number },
  ) => number | undefined;
  contact?: (x: number, y: number, z: number) => boolean;
};
// pools are per CarBatch so the contact closures always call the live batch
const livePools = new WeakMap<CarBatch, LiveSlot[]>();
function liveSlot(batch: CarBatch, i: number): LiveSlot {
  let pool = livePools.get(batch);
  if (!pool) livePools.set(batch, (pool = []));
  let s = pool[i];
  if (!s) {
    s = pool[i] = { i, x: 0, z: 0, sin: 0, cos: 0, hl: 0, hw: 0, h: 0 };
    s.rayContact = (a, b) => batch.rayContact(s!.i, a, b);
    s.contact = (x, y, z) => batch.pointContact(s!.i, x, y, z);
  }
  return s;
}
const pdPool: { x: number; z: number; kind: 1 | 2; i: number }[] = [];
const _simEnemies: SimEnemy[] = [];
const _simPlayers: { x: number; z: number }[] = [];
const _np = { x: 0, z: 0 };
const _tyre = { x: 0, z: 0, speed: 0 };
const _env: SimEnv = {
  roadX: [],
  roadZ: [],
  rand: Math.random,
  players: [],
  enemies: [],
  onEnemyContact: undefined,
};
/** what each siren voice is doing (debug handle only) */
const sirenDebug: ({
  car: number;
  d: number;
  gain: number;
  doppler: number;
  pan: number;
  yelp: boolean;
} | null)[] = [];

/** lightbar state: 0 off, 1 red lit, 2 blue lit */
type Bar = 0 | 1 | 2;
/** flasher phase for car `i` at traffic time `t`: each cruiser flashes out of step with the others */
const barAt = (t: number, i: number): Bar => {
  const ph = (t * 2.6 + i * 0.37) % 1;
  // red half, blue half, each with a quick double-flash flicker: R R . B B .
  if (ph < 0.5) return ph > 0.2 && ph < 0.26 ? 0 : 1;
  return ph > 0.7 && ph < 0.76 ? 0 : 2;
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
  cars: carCount,
  coastal = false,
}: {
  city: CityLayout;
  seed: number;
  /** legacy: the time of day now comes from timeOfDay.ts */
  time?: TimeOfDay;
  link: React.MutableRefObject<TrafficLink>;
  /** fixed number of moving cars (default: about one per 45 m of street, 40-60) */
  cars?: number;
  coastal?: boolean;
}) {
  const { roadX, roadZ } = city;

  // ---- moving cars, deterministic start from the seed ----
  const cars = useMemo(
    () => spawnTraffic(roadX, roadZ, city.spawn, seed, carCount, coastal),
    [seed, roadX, roadZ, city.spawn, carCount, coastal],
  );

  useEffect(()=>{
    cars.forEach((c,i)=>{const d=registerDriveCar(`city-${i}`,c.v.len/2,c.v.wid/2,c.h,c.v.type==="sports"?32:c.v.type==="bus"?14:c.v.type==="van"?17:22,c.v.type==="bus"?240:100);d.x=c.x;d.z=c.z;d.yaw=c.yaw;});
    return ()=>{cars.forEach((_,i)=>driveCars.delete(`city-${i}`));};
  },[cars]);
  // ---- one batch for every vehicle: the moving cars first, then the parked ones ----
  const parked = city.parked;
  const parkedCount = cars.length; // index of the first parked car in the batch
  const batch = useMemo(
    () => new CarBatch([...cars.map((c) => c.v), ...parked.map((pc) => pc.v)], cars.length),
    [cars, parked],
  );
  useEffect(() => () => batch.dispose(), [batch]);
  const geo = useMemo(() => {
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
    return { cone, pool, spill, halo };
  }, []);
  const mats = useMemo(
    () => ({
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

  const coneRef = useRef<THREE.InstancedMesh>(null);
  const poolRef = useRef<THREE.InstancedMesh>(null);
  const spillRef = useRef<THREE.InstancedMesh>(null);
  const haloRef = useRef<THREE.InstancedMesh>(null);

  // parked cars: placed once, lights off
  useLayoutEffect(() => {
    parked.forEach((pc, i) =>
      batch.place(parkedCount + i, pc.x, (pc as { y?: number }).y ?? 0, pc.z, pc.rot),
    );
  }, [batch, parked, parkedCount]);
  useLayoutEffect(() => {
    const entries: { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }[] = [];
    for (const pc of parked) {
      const md = vehicleModel(vehicleModelKey(pc.v));
      const transform = new THREE.Matrix4()
        .makeRotationY(pc.rot)
        .setPosition(pc.x, pc.y ?? 0, pc.z);
      const body = transform
        .clone()
        .scale(new THREE.Vector3(pc.v.wid / md.spec.wid, 1, pc.v.len / md.spec.len));
      entries.push({ geometry: md.near, matrix: body });
      if (md.glass) entries.push({ geometry: md.glass, matrix: body });
      for (const w of md.wheels(pc.v))
        entries.push({
          geometry: wheelGeometry(),
          matrix: transform
            .clone()
            .multiply(new THREE.Matrix4().makeTranslation(w.x, w.y, w.z))
            .scale(new THREE.Vector3(w.w, w.r, w.r)),
        });
    }
    return registerStaticInstances("parked-cars", entries);
  }, [parked]);
  const lastPos = useRef<Float32Array>(new Float32Array(0));

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
      const players = _simPlayers;
      players.length = 0;
      {
        const p0 = _simPlayers[0] ?? { x: 0, z: 0 };
        p0.x = L.px;
        p0.z = L.pz;
        players.push(p0);
        for (const o of L.others) {
          const s = _simPlayers[players.length] ?? { x: 0, z: 0 };
          s.x = o.x;
          s.z = o.z;
          players.push(s);
        }
      }
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
        const nc = (netCars.current[i] ??= {
          x: 0,
          z: 0,
          yaw: 0,
          speed: 0,
          flags: 0,
          at: 0,
        });
        nc.x = a[o + 1]! / 100;
        nc.z = a[o + 2]! / 100;
        nc.yaw = a[o + 3]! / 100;
        nc.speed = (sf % 1000) / 10;
        nc.flags = Math.floor(sf / 1000);
        nc.at = now;
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
        __rsSiren: sirenDebug,
        __rsCarBatch: batch,
      });
  }, [cars, director, batch]);

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
      const enemies = _simEnemies;
      enemies.length = 0;
      for (const e of L.enemies) {
        const s = _simEnemies[enemies.length] ?? { x: 0, z: 0, alive: false, r: 0, big: false };
        s.x = e.x;
        s.z = e.z;
        s.alive = e.alive;
        s.r = L.radiusOf(e);
        s.big = L.isBig(e);
        enemies.push(s);
      }
      const players = _simPlayers;
      players.length = 0;
      {
        const p0 = _simPlayers[0] ?? { x: 0, z: 0 };
        p0.x = L.px;
        p0.z = L.pz;
        players.push(p0);
        for (const o of L.others) {
          const s = _simPlayers[players.length] ?? { x: 0, z: 0 };
          s.x = o.x;
          s.z = o.z;
          players.push(s);
        }
      }
      const onEnemyContact = L.isHost && L.hurtEnemy ? contact : undefined;
      // far cars (nobody within FAR_SIM) run at a quarter of the rate with a 4x step;
      // pursuit cars always run at the full rate
      markFar(cars, players, FAR_SIM);
      acc.current += dt;
      let steps = 0;
      while (acc.current >= SIM_DT && steps < 6) {
        acc.current -= SIM_DT;
        steps++;
        trafficClock.t += SIM_DT;
        tick.current++;
        _env.roadX = roadX;
        _env.roadZ = roadZ;
        _env.rand = rand;
        _env.players = players;
        _env.enemies = enemies;
        _env.onEnemyContact = onEnemyContact;
        stepDirector(director, cars, _env, trafficClock.t);
        if (tick.current % 4 === 0) stepCars(cars, _env, SIM_DT * 4, trafficClock.t, true);
        for (const ci of stepCars(cars, _env, SIM_DT, trafficClock.t, false)) {
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
    if (lastPos.current.length !== cars.length * 2)
      lastPos.current = new Float32Array(cars.length * 2);
    // headlight beams and road pools: full at night, faint in the dusk light
    mats.cone.opacity = liveCity.cone;
    mats.pool.opacity = liveCity.headPool;
    const nightK = tod.v;
    liveCars.length = 0;
    pursuitDots.length = 0;
    const cam = state.camera;
    // camera right vector, for panning the sirens
    _right.set(1, 0, 0).applyQuaternion(cam.quaternion);
    sirens.length = 0;
    // the car whose tyres you'd hear most (fast and close): the rain's tyre hiss follows it
    let tyreBest = 0;
    const tyre = _tyre;
    tyre.x = 0;
    tyre.z = 0;
    tyre.speed = 0;

    for (let ci = 0; ci < cars.length; ci++) {
      const c = cars[ci]!;
      c.hitCd -= dt;
      c.honk -= dt;

      const half = c.v.len / 2;
      const np = _np; // shared scratch: everything below reads it synchronously
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
          // mirror the host's pursuit roles (render-only here: guests never simulate)
          c.role = flags & F_SIREN ? ROLE_COP : flags & F_SUSPECT ? ROLE_SUSPECT : ROLE_NORMAL;
        } else {
          yaw = c.yawVis;
          c.speed = 0;
        }
        np.x = c.gx;
        np.z = c.gz;
        let dy = yaw - c.yawVis;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        c.yawVis += dy * (1 - Math.exp(-dt * 9)); // same easing at any frame rate
      } else {
        // interpolate between the last two fixed simulation steps (far cars step 4x coarser)
        const a = c.far
          ? Math.min(1, ((tick.current % 4) + acc.current / SIM_DT) / 4)
          : acc.current / SIM_DT;
        np.x = c.px + (c.x - c.px) * a;
        np.z = c.pz + (c.z - c.pz) * a;
        let dy = c.yaw - c.pyaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        c.yawVis = c.pyaw + dy * a;
        flags =
          (c.role === ROLE_COP ? F_SIREN : 0) |
          (c.role === ROLE_SUSPECT ? F_SUSPECT : 0) |
          (c.park ? F_PARKED : 0);
      }
      const drive=driveCars.get(`city-${ci}`);
      if(drive?.claimed) {
        c.driven=true;c.x=np.x=drive.x;c.z=np.z=drive.z;c.yaw=c.yawVis=drive.yaw;c.speed=drive.speed;
      } else if(drive) {drive.x=np.x;drive.z=np.z;drive.yaw=c.yawVis;}
      const wreck=!!drive && drive.hp<=0;
      if(wreck)batch.setWreck(ci);
      const siren = !wreck && (flags & F_SIREN) !== 0;
      const bar: Bar = siren ? barAt(t, ci) : 0;
      // ---- draw ----
      // wheel roll: metres moved since the last frame (a snap / respawn is not a roll)
      const lp = lastPos.current;
      const moved = Math.hypot(np.x - lp[ci * 2]!, np.z - lp[ci * 2 + 1]!);
      lp[ci * 2] = np.x;
      lp[ci * 2 + 1] = np.z;
      batch.place(ci, np.x, 0, np.z, c.yawVis, { lit: !wreck, bar, roll: moved < 3 ? moved : 0 });
      const sin = Math.sin(c.yawVis);
      const cos = Math.cos(c.yawVis);
      {
        const slot = liveSlot(batch, ci);
        slot.i = ci;
        if(drive){slot.driveId=drive.id;drive.box=slot;}
        slot.x = np.x;
        slot.z = np.z;
        slot.sin = sin;
        slot.cos = cos;
        slot.hl = half;
        slot.hw = c.v.wid / 2;
        slot.h = c.h;
        slot.bounds = batch.contactBounds(ci);
        liveCars.push(slot);
      }
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
          const hs = 2.4 + nightK;
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
      {
        const td = Math.hypot(np.x - cam.position.x, np.z - cam.position.z);
        const w = c.speed / (1 + (td / 12) * (td / 12));
        if (w > tyreBest) {
          tyreBest = w;
          tyre.x = np.x;
          tyre.z = np.z;
          tyre.speed = c.speed;
        }
      }
      if (siren || flags & F_SUSPECT) {
        const d = pdPool[pursuitDots.length] ?? { x: 0, z: 0, kind: 1 as const, i: 0 };
        d.x = np.x;
        d.z = np.z;
        d.kind = siren ? 1 : 2;
        d.i = ci;
        pursuitDots.push(d);
      }
      if (siren) {
        const d = Math.hypot(np.x - cam.position.x, np.z - cam.position.z);
        if (d < SIREN_RANGE) {
          const s =
            sirenPool[sirens.length] ?? { ci: 0, d: 0, x: 0, z: 0, yaw: 0, speed: 0 };
          s.ci = ci;
          s.d = d;
          s.x = np.x;
          s.z = np.z;
          s.yaw = c.yawVis;
          s.speed = c.speed;
          sirens.push(s);
        }
      }

      // ---- bumping into the player ----
      const dx = L.px - np.x;
      const dz = L.pz - np.z;
      const a = dx * sin + dz * cos;
      const lat = dx * cos - dz * sin;
      if (
        L.active &&
        c.hitCd <= 0 && drive?.owner !== driving.self &&
        batch.bodyContact(ci, L.px, L.pz, 0.4, L.feet ?? (L.py ?? 1.6) - 1.6, L.bodyHeight ?? 1.8)
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
    setAmbienceTraffic(L.active ? tyre.speed : 0, tyre.x, tyre.z);
    // ---- sirens: the nearest cruisers, louder when close, pitch bent by their motion ----
    sirens.sort((p, q) => p.d - q.d);
    for (let k = 0; k < SIREN_VOICES; k++) {
      const s = sirens[k];
      if (!s || !L.active) {
        setSiren(k, 700, 0, 0, 0);
        sirenDebug[k] = null;
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
      const base = sirenPitch(t, s.ci, s.d < 50);
      setSiren(k, base * dop, 0.2 * near * fade, pan, near);
      const sd = (sirenDebug[k] ??= {
        car: 0,
        d: 0,
        gain: 0,
        doppler: 0,
        pan: 0,
        yelp: false,
      });
      sd.car = s.ci;
      sd.d = s.d;
      sd.gain = 0.2 * near * fade;
      sd.doppler = dop;
      sd.pan = pan;
      sd.yelp = s.d < 50;
    }
    batch.commit(cam);
    for (const m of [coneRef.current, poolRef.current, spillRef.current, haloRef.current]) {
      if (!m) continue;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    // police light spill reads on the road at night and (fainter) at dusk
    if (spillRef.current) mats.spill.opacity = liveCity.spill;
  });

  return (
    <group>
      <primitive object={batch.group} />
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
