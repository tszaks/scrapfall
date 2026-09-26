// Parked cars + moving traffic for the city map. Every vehicle part is an instance
// in one of three InstancedMeshes (paint / wheels / lamps), updated in one useFrame.
import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import type { CityLayout } from "./cityLayout";
import { makeVehicle, vehicleHeight, vehicleParts, type Part, type Vehicle } from "./vehicles";
import { liveCars, trafficClock, type TrafficLink } from "./trafficCore";
import {
  HALF_ROAD,
  SIM_DT,
  headingOf,
  laneOff,
  posOf as simPos,
  stepCars,
  type Car,
  type SimEnemy,
} from "./trafficSim";
import { playSfx } from "./audio";
import { glowTexture } from "./cityTextures";

/** Numbers per car in the network snapshot: x, z, heading, speed. */
const CAR_FIELDS = 4;
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

function partMatrix(p: Part) {
  const m = new THREE.Matrix4();
  // wheel geometry is a unit cylinder lying along x: scale x = tyre width, y/z = diameter
  if (p.kind === "wheel") m.compose(_p.set(p.x, p.y, p.z), _q.identity(), _s.set(p.sz, p.sy, p.sx));
  else m.compose(_p.set(p.x, p.y, p.z), _q.identity(), _s.set(p.sx, p.sy, p.sz));
  return m;
}

type Slot = { mesh: "paint" | "wheel" | "lamp"; index: number; local: THREE.Matrix4; part: Part };

export function CityTraffic({
  city,
  seed,
  night,
  link,
}: {
  city: CityLayout;
  seed: number;
  night: boolean;
  link: React.MutableRefObject<TrafficLink>;
}) {
  const { roadX, roadZ } = city;
  const nightRef = useRef(night);
  nightRef.current = night;

  // ---- moving cars, deterministic start from the seed ----
  const cars = useMemo(() => {
    const rand = mulberry(seed ^ 0x51f15e);
    const list: Car[] = [];
    if (roadX.length < 2) return list;
    const lo = roadX[0]!;
    const hi = roadX[roadX.length - 1]!;
    const want = Math.round(roadX.length * roadZ.length * 1.5) + (city.cells > 26 ? 2 : 0);
    for (let tries = 0; list.length < want && tries < 400; tries++) {
      const axis = (rand() < 0.5 ? 0 : 1) as 0 | 1;
      const dir = (rand() < 0.5 ? 1 : -1) as 1 | -1;
      const line = Math.floor(rand() * (axis === 0 ? roadZ.length : roadX.length));
      const cross = axis === 0 ? roadX : roadZ;
      const s = lo + 5 + rand() * (hi - lo - 10);
      // never start inside an intersection or right on top of the spawn plaza
      if (cross.some((c) => Math.abs(c - s) < HALF_ROAD + 3)) continue;
      const perp = (axis === 0 ? roadZ : roadX)[line]! + laneOff(axis, dir);
      const x = axis === 0 ? s : perp;
      const z = axis === 0 ? perp : s;
      if (Math.hypot(x, z) < 9) continue;
      const v = makeVehicle(rand, Infinity)!;
      if (
        list.some(
          (o) =>
            o.axis === axis &&
            o.dir === dir &&
            o.line === line &&
            Math.abs(o.s - s) < (o.v.len + v.len) / 2 + 4,
        )
      )
        continue;
      let next = dir > 0 ? cross.findIndex((c) => c > s) : -1;
      if (dir < 0)
        for (let k = cross.length - 1; k >= 0; k--)
          if (cross[k]! < s) {
            next = k;
            break;
          }
      if (next < 0) continue;
      const vmax =
        v.type === "bus" ? 5.5 : v.type === "van" ? 6.5 : v.type === "sports" ? 8.5 : 7.5;
      list.push({
        v,
        h: vehicleHeight(v),
        axis,
        dir,
        line,
        s,
        speed: vmax * 0.6,
        vmax,
        next,
        turn: null,
        yawVis: Math.atan2(axis === 0 ? dir : 0, axis === 1 ? dir : 0),
        honk: 0,
        hitCd: 0,
        px: x,
        pz: z,
        x,
        z,
      });
    }
    return list;
  }, [seed, roadX, roadZ, city.cells]);

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
    city.parked.forEach((p) => add(p.v));
    cars.forEach((c) => add(c.v));
    return { slots, counts, parkedCount: city.parked.length };
  }, [city.parked, cars]);

  const geo = useMemo(() => {
    const wheel = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
    wheel.rotateZ(Math.PI / 2);
    const cone = new THREE.ConeGeometry(1.7, 7.5, 14, 1, true);
    cone.translate(0, -3.75, 0); // apex at the origin
    cone.rotateX(-Math.PI / 2); // opening toward +z (forward)
    const pool = new THREE.PlaneGeometry(3.2, 6.5);
    pool.rotateX(-Math.PI / 2);
    pool.translate(0, 0, 3.6);
    return { box: new THREE.BoxGeometry(1, 1, 1), wheel, cone, pool };
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

  const paintRef = useRef<THREE.InstancedMesh>(null);
  const wheelRef = useRef<THREE.InstancedMesh>(null);
  const lampRef = useRef<THREE.InstancedMesh>(null);
  const coneRef = useRef<THREE.InstancedMesh>(null);
  const poolRef = useRef<THREE.InstancedMesh>(null);

  const meshOf = (k: Slot["mesh"]) =>
    k === "paint" ? paintRef.current : k === "wheel" ? wheelRef.current : lampRef.current;

  /** lamp colours depend on day/night, whether the car is moving, and the police flasher */
  const lampColor = (part: Part, moving: boolean, flash: boolean, isNight: boolean) => {
    if (part.kind === "head")
      return _c.set(moving ? (isNight ? 0xfff6d8 : 0xe8e6dc) : isNight ? 0x3a3a36 : 0xb8b8b0);
    if (part.kind === "tail")
      return _c.set(moving ? (isNight ? 0xff2a1a : 0x8a1a18) : isNight ? 0x3a0a08 : 0x6a1612);
    if (part.kind === "sign") return _c.set(isNight ? part.color : 0xd8d0a0);
    if (part.kind === "barR") return _c.set(moving && flash ? 0xff2020 : 0x5a1010);
    if (part.kind === "barB") return _c.set(moving && !flash ? 0x3060ff : 0x10205a);
    return _c.set(part.color);
  };

  const placeCar = (
    i: number,
    x: number,
    z: number,
    yaw: number,
    moving: boolean,
    flash: boolean,
    isNight: boolean,
  ) => {
    _car.compose(_p.set(x, 0, z), _q.setFromAxisAngle(_up, yaw), _s.set(1, 1, 1));
    for (const sl of slots[i]!) {
      const mesh = meshOf(sl.mesh);
      if (!mesh) continue;
      _m.multiplyMatrices(_car, sl.local);
      mesh.setMatrixAt(sl.index, _m);
      if (sl.mesh === "lamp") mesh.setColorAt(sl.index, lampColor(sl.part, moving, flash, isNight));
    }
  };

  // static colours + parked cars, once per layout (and again when day/night flips)
  useLayoutEffect(() => {
    for (const sl of slots.flat()) {
      if (sl.mesh === "lamp") continue;
      meshOf(sl.mesh)?.setColorAt(sl.index, _c.set(sl.part.color));
    }
    city.parked.forEach((p, i) => placeCar(i, p.x, p.z, p.rot, false, false, night));
    for (const m of [paintRef.current, wheelRef.current, lampRef.current]) {
      if (!m) continue;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }, [slots, night]); // eslint-disable-line react-hooks/exhaustive-deps

  const rand = useMemo(() => mulberry(seed ^ 0x7a11c), [seed]);
  // guest: latest host state per car + when it arrived
  const netCars = useRef<{ x: number; z: number; yaw: number; speed: number; at: number }[]>([]);
  const hostClock = useRef<{ t: number; at: number } | null>(null);

  const posOf = (c: Car) => simPos(c, roadX, roadZ);
  const acc = useRef(0);

  // a new arena (new seed) restarts traffic identically everywhere
  useEffect(() => {
    // new arena: drop every piece of per-run traffic state so nothing stale survives
    trafficClock.t = 0;
    netCars.current = [];
    hostClock.current = null;
    enemyHit.current.clear();
    acc.current = 0;
    liveCars.length = 0;
  }, [cars]);

  // network hooks: the host encodes, guests decode (motion only; types come from the seed)
  useEffect(() => {
    const L = link.current;
    L.encode = () => {
      const out: number[] = [q100(trafficClock.t)];
      for (const c of cars) {
        const p = posOf(c);
        const yaw = Math.atan2(c.axis === 0 ? c.dir : 0, c.axis === 1 ? c.dir : 0);
        out.push(q100(p.x), q100(p.z), q100(yaw), Math.round(c.speed * 10));
      }
      return out;
    };
    L.decode = (a) => {
      if (!Array.isArray(a) || a.length !== 1 + cars.length * CAR_FIELDS) return;
      const now = performance.now();
      hostClock.current = { t: a[0]! / 100, at: now };
      for (let i = 0; i < cars.length; i++) {
        const o = 1 + i * CAR_FIELDS;
        netCars.current[i] = {
          x: a[o]! / 100,
          z: a[o + 1]! / 100,
          yaw: a[o + 2]! / 100,
          speed: a[o + 3]! / 10,
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
    },
    [],
  );
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __rsCars?: Car[] }).__rsCars = cars;
  }, [cars]);

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

  useFrame((_, raw) => {
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
      acc.current += dt;
      let steps = 0;
      while (acc.current >= SIM_DT && steps < 6) {
        acc.current -= SIM_DT;
        steps++;
        trafficClock.t += SIM_DT;
        const env = { roadX, roadZ, rand, players, enemies, onEnemyContact };
        for (const ci of stepCars(cars, env, SIM_DT, trafficClock.t)) {
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
    const isNight = nightRef.current;
    const flash = Math.floor(t * 4) % 2 === 0;
    liveCars.length = 0;

    for (let ci = 0; ci < cars.length; ci++) {
      const c = cars[ci]!;
      const cross = c.axis === 0 ? roadX : roadZ;
      const along = c.axis === 0 ? roadZ : roadX; // roads parallel to us, indexed by line
      c.hitCd -= dt;
      c.honk -= dt;

      const half = c.v.len / 2;
      let np: { x: number; z: number };
      let yaw: number;
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
          if (Math.hypot(tx - c.gx, tz - c.gz) > 6) {
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
        } else {
          yaw = c.yawVis;
          c.speed = 0;
        }
        np = { x: c.gx, z: c.gz };
      } else {
        // interpolate between the last two fixed simulation steps
        const a = acc.current / SIM_DT;
        np = { x: c.px + (c.x - c.px) * a, z: c.pz + (c.z - c.pz) * a };
        yaw = headingOf(c);
      }
      // ---- draw ----
      let dy = yaw - c.yawVis;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      c.yawVis += dy * (1 - Math.exp(-dt * 9)); // same easing at any frame rate
      placeCar(parkedCount + ci, np.x, np.z, c.yawVis, true, flash, isNight);
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
        // (cos, -sin) is the car's right-hand side in world space
        if (c.speed > 1.2) {
          const force = Math.min(22, (3 + c.speed * 1.25) * Math.sqrt(c.v.mass));
          const kx = sin * force * 0.75 + cos * side * force * 0.65;
          const kz = cos * force * 0.75 - sin * side * force * 0.65;
          const impact = c.speed * c.v.mass;
          const dmg = impact > 5 ? Math.max(1, Math.round(impact / 5)) : 0;
          L.hitPlayer(dmg, kx, kz, Math.min(1, impact / 12));
          c.hitCd = 0.6;
          c.speed *= 0.5;
        } else {
          // crawling: just nudge the player out of the way
          L.hitPlayer(0, cos * side * 2.5, -sin * side * 2.5, 0);
          c.hitCd = 0.25;
        }
      }
    }
    for (const m of [
      paintRef.current,
      wheelRef.current,
      lampRef.current,
      coneRef.current,
      poolRef.current,
    ]) {
      if (!m) continue;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    if (coneRef.current) coneRef.current.visible = isNight;
    if (poolRef.current) poolRef.current.visible = isNight;
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
            visible={night}
          />
          <instancedMesh
            ref={poolRef}
            args={[geo.pool, mats.pool, cars.length]}
            frustumCulled={false}
            visible={night}
          />
        </>
      )}
    </group>
  );
}
