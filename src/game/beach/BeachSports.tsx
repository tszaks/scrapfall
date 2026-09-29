import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Model, SURF, artMaterial } from "../art/kit";
import { registerStaticInstances } from "../staticCollision";
import { trafficClock } from "../trafficCore";
import { beachTerrain } from "./terrain";
import { volleyballBall, volleyballPose } from "./beachActivity";
import type { BeachLayout } from "./beachLayout";

// One merged body, one merged pair of arms and one ball model, instanced across three
// contained games. No independent pathfinding, crowd spawning or per-person draw calls.
function models() {
  const body = new Model(),
    arms = new Model(),
    ball = new Model();
  // artMaterial({ paint: true }) uses aSurf.w as the instance-tint mask. Only the jersey
  // has w=1; skin, hair and shorts keep their authored colours (polymer defaults to w=0).
  const skin = "#be8c67",
    cloth = [0.9, 0, 0, 1] as const;
  for (const s of [-1, 1]) {
    body.box(0.15, 0.07, 0.28, [s * 0.16, 0.035, 0.025], skin, SURF.polymer);
    body.cyl(0.075, 0.55, [s * 0.16, 0.33, 0], skin, SURF.polymer, { seg: 6 });
    body.box(0.23, 0.29, 0.25, [s * 0.14, 0.65, 0], "#263d4a", SURF.polymer);
    arms.cyl(0.065, 0.32, [s * 0.28, -0.13, 0.1], skin, SURF.polymer, {
      seg: 6,
      rot: [-0.5, 0, s * 0.22],
    });
    arms.cyl(0.055, 0.34, [s * 0.2, -0.18, 0.34], skin, SURF.polymer, {
      seg: 6,
      rot: [1.22, 0, s * 0.3],
    });
  }
  body.box(0.47, 0.48, 0.28, [0, 1.0, 0], "#ffffff", cloth);
  body.cyl(0.075, 0.13, [0, 1.29, 0], skin, SURF.polymer, { seg: 6 });
  body.sphere(0.155, [0, 1.48, 0], skin, SURF.polymer, { low: true, s: [0.87, 1.1, 0.9] });
  body.dome(0.16, [0, 1.52, 0], "#473828", SURF.polymer);
  body.box(0.24, 0.055, 0.03, [0, 1.5, 0.135], "#27333a", SURF.polymer);
  ball.sphere(0.12, [0, 0, 0], "#f2dc94", SURF.polymer, { low: true });
  return { body: body.build(), arms: arms.build(), ball: ball.build() };
}

const matrix = new THREE.Matrix4(),
  pos = new THREE.Vector3(),
  scale = new THREE.Vector3(1, 1, 1);
const rotation = new THREE.Quaternion(),
  euler = new THREE.Euler();
export function BeachSports({ city }: { city: BeachLayout }) {
  const built = useMemo(() => {
    const courts = city.beach.activity.courts.filter((c) => c.active);
    const geometry = models(),
      material = artMaterial({ paint: true, wear: 0 });
    const bodies = new THREE.InstancedMesh(geometry.body, material, courts.length * 4);
    const arms = new THREE.InstancedMesh(geometry.arms, material, courts.length * 4);
    const balls = new THREE.InstancedMesh(geometry.ball, material, courts.length);
    const terrain = beachTerrain(city),
      players: { x: number; y: number; z: number; yaw: number }[] = [];
    const collisions: { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }[] = [];
    for (const [ci, court] of courts.entries())
      for (let k = 0; k < 4; k++) {
        const pose = volleyballPose(court, k, 0),
          y = terrain.height(pose.x, pose.z);
        players.push({ ...pose, y });
        pos.set(pose.x, y, pose.z);
        rotation.setFromEuler(euler.set(0, pose.yaw, 0));
        matrix.compose(pos, rotation, scale);
        bodies.setMatrixAt(ci * 4 + k, matrix);
        bodies.setColorAt(ci * 4 + k, new THREE.Color(k < 2 ? "#37aeb5" : "#ee8863"));
        collisions.push({ geometry: geometry.body, matrix: matrix.clone() });
      }
    for (const [name, mesh] of [
      ["players", bodies],
      ["arms", arms],
      ["balls", balls],
    ] as const) {
      mesh.name = `beach-volleyball-${name}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
    }
    return { courts, geometry, material, bodies, arms, balls, players, collisions };
  }, [city]);
  useEffect(() => {
    // Bodies are fixed at the same grounded positions as their visible instances. Animated
    // forearms are decoration; the occupied player footprint is always physically present.
    const remove = registerStaticInstances("beach-volleyball", built.collisions, {
      support: false,
    });
    return () => {
      remove();
      for (const mesh of [built.bodies, built.arms, built.balls]) mesh.dispose();
      for (const g of Object.values(built.geometry)) g.dispose();
      built.material.dispose();
    };
  }, [built]);
  useFrame(({ camera }) => {
    let nearby = false;
    for (const court of built.courts)
      if (Math.hypot(camera.position.x - court.x, camera.position.z - court.z) < 260) nearby = true;
    built.bodies.visible = built.arms.visible = built.balls.visible = nearby;
    if (!nearby) return;
    for (const [ci, court] of built.courts.entries()) {
      for (let k = 0; k < 4; k++) {
        const p = built.players[ci * 4 + k]!,
          pose = volleyballPose(court, k, trafficClock.t);
        pos.set(p.x, p.y + 1.18, p.z);
        rotation.setFromEuler(euler.set(-pose.lift * 0.55, pose.yaw, 0, "YXZ"));
        matrix.compose(pos, rotation, scale);
        built.arms.setMatrixAt(ci * 4 + k, matrix);
      }
      const b = volleyballBall(court, trafficClock.t);
      pos.set(b.x, b.y, b.z);
      rotation.setFromEuler(euler.set(trafficClock.t, 0, trafficClock.t * 0.6));
      matrix.compose(pos, rotation, scale);
      built.balls.setMatrixAt(ci, matrix);
    }
    built.arms.instanceMatrix.needsUpdate = true;
    built.balls.instanceMatrix.needsUpdate = true;
  });
  return (
    <group>
      <primitive object={built.bodies} />
      <primitive object={built.arms} />
      <primitive object={built.balls} />
    </group>
  );
}
