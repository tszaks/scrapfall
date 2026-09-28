import {
  geometryBounds,
  geometryBody,
  geometryPoint,
  geometryRayContact,
  boundsMayTouchBody,
} from "../staticCollision";
import { useMemo, useEffect, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { artMaterial, artFrame } from "../art/kit";
import { snowVehicle, skiModel } from "./models";
import { skiRoutes, routePose, snowRoad, type RoutePose } from "./routes";
import { alpine } from "../alpine/weather";
import type { AlpineLayout } from "../alpine/layout";
import { terrainY, groundY } from "../terrain";
import { liveCars, type TrafficLink, type CarBox } from "../trafficCore";
import { showToast } from "../squadState";
const pos: RoutePose = { x: 0, z: 0, yaw: 0 },
  ahead: RoutePose = { x: 0, z: 0, yaw: 0 };
const lampMatrix = new THREE.Matrix4(),
  lampLocal = new THREE.Matrix4();
const m = new THREE.Matrix4(),
  q = new THREE.Quaternion(),
  e = new THREE.Euler(),
  v = new THREE.Vector3(),
  scale = new THREE.Vector3(1, 1, 1);

export function AlpineLife({
  layout,
  link,
}: {
  layout: AlpineLayout;
  link: MutableRefObject<TrafficLink>;
}) {
  const built = useMemo(() => {
    const mat = artMaterial({ paint: true, wear: 0.22 });
    const types = ["cat", "mobile", "patrol"] as const;
    const vehicles = types.map((kind) => {
      const mesh = new THREE.InstancedMesh(snowVehicle(kind), mat, 2);
      mesh.name = `snow-${kind}`;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    });
    const road = snowRoad();
    const starts = [
      road.length * 0.08,
      road.length * 0.55,
      road.length * 0.3,
      road.length * 0.8,
      road.length * 0.3 - 18,
      road.length * 0.8 - 18,
    ];
    const cars = Array.from({ length: 6 }, (_, i) => {
      const geometry = vehicles[Math.floor(i / 2)]!.geometry;
      const matrix = new THREE.Matrix4(),
        bounds = new THREE.Box3();
      return {
        geometry,
        matrix,
        bounds,
        distance: starts[i]!,
        speed: 0,
        hit: 0,
        box: {
          x: 0,
          z: 0,
          sin: 0,
          cos: 1,
          hl: i < 2 ? 2.8 : 1.7,
          hw: i < 2 ? 1.8 : 0.7,
          h: 0,
          base: 0,
          bounds,
          contact: (x: number, y: number, z: number) => geometryPoint(geometry, matrix, x, y, z),
          rayContact: (
            a: { x: number; y: number; z: number },
            b: { x: number; y: number; z: number },
          ) => geometryRayContact(geometry, matrix, a, b),
        } as CarBox,
      };
    });
    const paths = skiRoutes(layout, terrainY);
    const skiers = new THREE.InstancedMesh(skiModel(), mat, paths.length * 5);
    skiers.name = "whiteout-skiers";
    skiers.frustumCulled = false;
    skiers.castShadow = true;
    for (let i = 0; i < skiers.count; i++)
      skiers.setColorAt(
        i,
        new THREE.Color([0xdc4a36, 0x3c80a5, 0xe7b33b, 0x66a272, 0x855c99][i % 5]!),
      );
    const lamps = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.19, 0.13, 0.17),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      4,
    );
    lamps.frustumCulled = false;
    for (let i = 0; i < 4; i++) lamps.setColorAt(i, new THREE.Color(i % 2 ? 0x3984ff : 0xff3833));
    return { mat, vehicles, road, cars, paths, skiers, lamps, lastChase: -1 };
  }, [layout]);
  useEffect(() => {
    const encode = () =>
      built.cars.flatMap((c) => [Math.round(c.distance * 100), Math.round(c.speed * 100)]);
    const decode = (a: number[]) => {
      if (a.length !== built.cars.length * 2) return;
      built.cars.forEach((c, i) => {
        const d = a[i * 2]!,
          s = a[i * 2 + 1]!;
        if (Number.isFinite(d) && Number.isFinite(s)) {
          c.distance = d / 100;
          c.speed = Math.max(0, Math.min(15, s / 100));
        }
      });
    };
    link.current.encode = encode;
    link.current.decode = decode;
    return () => {
      if (link.current.encode === encode) {
        link.current.encode = null;
        link.current.decode = null;
      }
      for (const mesh of built.vehicles) mesh.geometry.dispose();
      built.skiers.geometry.dispose();
      built.mat.dispose();
      built.lamps.geometry.dispose();
      (built.lamps.material as THREE.Material).dispose();
      liveCars.length = 0;
    };
  }, [built, link]);
  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.05),
      ctx = link.current,
      t = alpine.t,
      cycle = Math.floor(t / 110),
      chase = t % 110 >= 40 && t % 110 < 66;
    artFrame();
    liveCars.length = 0;
    if (chase && built.lastChase !== cycle && ctx.active) {
      built.lastChase = cycle;
      showToast("SKI PATROL · SNOWMOBILE PURSUIT ON DORFSTRASSE");
    }
    built.cars.forEach((car, i) => {
      const cat = i < 2,
        patrol = i >= 4;
      routePose(built.road, car.distance, pos);
      const y = groundY(pos.x, pos.z),
        top = y + (cat ? 2.9 : 2.25);
      if (ctx.role !== "guest") {
        let stop = false;
        for (let j = -1; j < ctx.others.length; j++) {
          const person = j < 0 ? null : ctx.others[j]!;
          const py = person?.y ?? ctx.py;
          if (py !== undefined && (py < y - 0.5 || py > top + 1.6)) continue;
          const dx = (person?.x ?? ctx.px) - pos.x,
            dz = (person?.z ?? ctx.pz) - pos.z;
          const along = dx * Math.sin(pos.yaw) + dz * Math.cos(pos.yaw),
            lat = dx * Math.cos(pos.yaw) - dz * Math.sin(pos.yaw);
          if (
            along > 0 &&
            along < car.box.hl + 3 + car.speed * 0.7 &&
            Math.abs(lat) < car.box.hw + 0.7
          )
            stop = true;
        }
        for (const other of built.cars)
          if (other !== car) {
            const gap = (other.distance - car.distance + built.road.length) % built.road.length;
            if (gap < car.box.hl + other.box.hl + 3 + car.speed * 0.65) stop = true;
          }
        for (const enemy of ctx.enemies)
          if (enemy.alive) {
            const dx = enemy.x - pos.x,
              dz = enemy.z - pos.z;
            const along = dx * Math.sin(pos.yaw) + dz * Math.cos(pos.yaw),
              lat = dx * Math.cos(pos.yaw) - dz * Math.sin(pos.yaw);
            if (
              along > 0 &&
              along < car.box.hl + 4 + car.speed * 0.5 &&
              Math.abs(lat) < car.box.hw + ctx.radiusOf(enemy)
            )
              stop = true;
          }
        const target = stop ? 0 : cat ? 4.2 : chase ? (patrol ? 11.5 : 11) : 6.7;
        car.speed += Math.max(-dt * 9, Math.min(dt * 2.5, target - car.speed));
      }
      car.distance = (car.distance + car.speed * dt) % built.road.length;
      routePose(built.road, car.distance, pos);
      routePose(built.road, car.distance + 1, ahead);
      const floor = groundY(pos.x, pos.z),
        pitch = -Math.atan2(groundY(ahead.x, ahead.z) - floor, 1);
      e.set(pitch, pos.yaw, 0, "YXZ");
      q.setFromEuler(e);
      v.set(pos.x, floor + 0.07, pos.z);
      scale.set(1, 1, 1);
      m.compose(v, q, scale);
      built.vehicles[Math.floor(i / 2)]!.setMatrixAt(i % 2, m);
      car.matrix.copy(m);
      geometryBounds(car.geometry, car.matrix, car.bounds);
      if (patrol)
        for (let side = 0; side < 2; side++) {
          lampLocal.makeTranslation(side ? 0.4 : -0.4, 1.11, 0.75);
          lampMatrix.copy(m).multiply(lampLocal);
          if (!chase || Math.floor(t * 8 + i) % 2 !== side) lampMatrix.scale(scale.setScalar(0));
          built.lamps.setMatrixAt((i - 4) * 2 + side, lampMatrix);
        }
      Object.assign(car.box, {
        x: pos.x,
        z: pos.z,
        sin: Math.sin(pos.yaw),
        cos: Math.cos(pos.yaw),
        h: floor + (cat ? 2.9 : 2.25),
        base: floor,
      });
      liveCars.push(car.box);
      car.hit = Math.max(0, car.hit - dt);
      const feet = ctx.feet ?? (ctx.py ?? floor + 1.6) - 1.6;
      const height = ctx.bodyHeight ?? 1.8;
      if (
        ctx.active &&
        car.hit <= 0 &&
        boundsMayTouchBody(car.bounds, ctx.px, ctx.pz, 0.4, feet, height)
      ) {
        const dx = ctx.px - pos.x,
          dz = ctx.pz - pos.z;
        const lat = dx * car.box.cos - dz * car.box.sin;
        if (geometryBody(car.geometry, car.matrix, ctx.px, ctx.pz, 0.4, feet, height)) {
          car.hit = 0.8;
          const sign = lat < 0 ? -1 : 1;
          ctx.hitPlayer(
            car.speed > 5 ? 1 : 0,
            car.box.cos * sign * 3,
            -car.box.sin * sign * 3,
            0.13,
          );
        }
      }
    });
    for (const mesh of built.vehicles) mesh.instanceMatrix.needsUpdate = true;
    built.lamps.instanceMatrix.needsUpdate = true;
    let idx = 0;
    for (const path of built.paths)
      for (let k = 0; k < 5; k++) {
        const speed = 6 + k * 0.35,
          duration = path.length / speed,
          local = (t + (k * duration) / 5) % (duration + 25),
          on = local < duration;
        routePose(path, Math.min(duration, local) * speed, pos);
        const carve = Math.sin(local * 1.1 + k) * 2.1;
        const x = pos.x + Math.cos(pos.yaw) * carve,
          z = pos.z - Math.sin(pos.yaw) * carve;
        routePose(path, Math.min(path.length, local * speed + 1), ahead);
        const floor = terrainY(x, z),
          pitch = -Math.atan2(terrainY(ahead.x, ahead.z) - terrainY(pos.x, pos.z), 1);
        e.set(
          pitch,
          pos.yaw + Math.sin(local * 1.1 + k) * 0.22,
          -Math.cos(local * 1.1 + k) * 0.16,
          "YXZ",
        );
        q.setFromEuler(e);
        v.set(x, floor + 0.04, z);
        const fade = on ? Math.min(1, local / 0.8, (duration - local) / 0.8) : 0;
        scale.setScalar(Math.max(0, fade));
        m.compose(v, q, scale);
        built.skiers.setMatrixAt(idx++, m);
      }
    built.skiers.instanceMatrix.needsUpdate = true;
  });
  return (
    <group>
      {built.vehicles.map((mesh, i) => (
        <primitive key={i} object={mesh} />
      ))}
      <primitive object={built.skiers} />
      <primitive object={built.lamps} />
    </group>
  );
}
