import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { ARENA, HALF, BLOCK, blocked, generateLevel, randomSpawn, type Block } from "./level";
import { useKeyboard } from "./useKeyboard";

type Enemy = { x: number; z: number; alive: boolean };

const SPEED = 7;
const ENEMY_SPEED = 2.1;
const ENEMY_COUNT = 8;
const EYE = 1.6;

const FORWARD = new THREE.Vector3();
const RIGHT = new THREE.Vector3();
const MOVE = new THREE.Vector3();
const TO_ENEMY = new THREE.Vector3();

function Level({ blocks }: { blocks: Block[] }) {
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[ARENA, ARENA]} />
        <meshLambertMaterial color="#8d7f63" />
      </mesh>
      <gridHelper args={[ARENA, ARENA / 2, "#6e6350", "#7b6f59"]} position-y={0.01} />
      {blocks.map((b, i) => (
        <mesh key={i} position={[b.x, b.h / 2, b.z]} castShadow receiveShadow>
          <boxGeometry args={[BLOCK, b.h, BLOCK]} />
          <meshLambertMaterial
            color={b.tone > 0.6 ? "#b4653f" : b.tone > 0.3 ? "#9a6b4b" : "#6f5945"}
            flatShading
          />
        </mesh>
      ))}
      {/* arena walls */}
      {([
        [0, -HALF, ARENA, 1],
        [0, HALF, ARENA, 1],
        [-HALF, 0, 1, ARENA],
        [HALF, 0, 1, ARENA],
      ] as const).map(([x, z, w, d], i) => (
        <mesh key={`w${i}`} position={[x, 2, z]}>
          <boxGeometry args={[w, 4, d]} />
          <meshLambertMaterial color="#54473a" flatShading />
        </mesh>
      ))}
    </group>
  );
}

function EnemyMesh({ data }: { data: Enemy }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((state) => {
    const g = ref.current;
    if (!g) return;
    g.visible = data.alive;
    g.position.set(data.x, 0.9 + Math.sin(state.clock.elapsedTime * 4 + data.x) * 0.08, data.z);
    g.lookAt(state.camera.position.x, g.position.y, state.camera.position.z);
  });
  return (
    <group ref={ref}>
      <mesh castShadow>
        <octahedronGeometry args={[0.85, 0]} />
        <meshLambertMaterial color="#c9452f" flatShading emissive="#3d0e06" />
      </mesh>
      <mesh position={[0, 0, 0.7]}>
        <sphereGeometry args={[0.16, 8, 8]} />
        <meshBasicMaterial color="#ffd9a0" />
      </mesh>
    </group>
  );
}

function World({
  blocks,
  enemies,
  locked,
  onScore,
  onHurt,
  gameOver,
  respawnEnemy,
}: {
  blocks: Block[];
  enemies: Enemy[];
  locked: boolean;
  onScore: () => void;
  onHurt: () => void;
  gameOver: boolean;
  respawnEnemy: (e: Enemy) => void;
}) {
  const keys = useKeyboard();
  const look = useRef({ yaw: 0, pitch: 0 });
  const hurtCooldown = useRef(0);
  const { camera } = useThree();

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!document.pointerLockElement) return;
      look.current.yaw -= e.movementX * 0.0022;
      look.current.pitch = Math.max(
        -1.2,
        Math.min(1.2, look.current.pitch - e.movementY * 0.0022),
      );
    };
    document.addEventListener("mousemove", onMove);
    return () => document.removeEventListener("mousemove", onMove);
  }, []);

  // Shooting
  useEffect(() => {
    const onClick = () => {
      if (!document.pointerLockElement || gameOver) return;
      camera.getWorldDirection(FORWARD);
      let best: Enemy | null = null;
      let bestDist = Infinity;
      for (const e of enemies) {
        if (!e.alive) continue;
        TO_ENEMY.set(e.x - camera.position.x, 0, e.z - camera.position.z);
        const dist = TO_ENEMY.length();
        TO_ENEMY.normalize();
        const flat = FORWARD.clone();
        flat.y = 0;
        flat.normalize();
        if (TO_ENEMY.dot(flat) > 1 - 0.006 * Math.max(1, dist * 0.5) && dist < bestDist) {
          best = e;
          bestDist = dist;
        }
      }
      if (best) {
        best.alive = false;
        onScore();
        window.setTimeout(() => respawnEnemy(best!), 1200);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [camera, enemies, gameOver, onScore, respawnEnemy]);

  useFrame((state, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const cam = state.camera;
    cam.rotation.order = "YXZ";
    cam.rotation.set(look.current.pitch, look.current.yaw, 0);

    if (gameOver || !locked) return;

    const k = keys.current;
    const fwd = (k.has("KeyW") ? 1 : 0) - (k.has("KeyS") ? 1 : 0);
    const strafe = (k.has("KeyD") ? 1 : 0) - (k.has("KeyA") ? 1 : 0);
    cam.getWorldDirection(FORWARD);
    FORWARD.y = 0;
    FORWARD.normalize();
    RIGHT.crossVectors(FORWARD, cam.up).normalize();
    MOVE.set(0, 0, 0).addScaledVector(FORWARD, fwd).addScaledVector(RIGHT, strafe);
    if (MOVE.lengthSq() > 0) {
      MOVE.normalize().multiplyScalar(SPEED * delta);
      const nx = cam.position.x + MOVE.x;
      const nz = cam.position.z + MOVE.z;
      if (!blocked(blocks, nx, cam.position.z, 0.4)) cam.position.x = nx;
      if (!blocked(blocks, cam.position.x, nz, 0.4)) cam.position.z = nz;
    }
    cam.position.y = EYE + Math.sin(state.clock.elapsedTime * 9) * (MOVE.lengthSq() > 0 ? 0.04 : 0);

    hurtCooldown.current -= delta;
    for (const e of enemies) {
      if (!e.alive) continue;
      const dx = cam.position.x - e.x;
      const dz = cam.position.z - e.z;
      const d = Math.hypot(dx, dz) || 1;
      const step = ENEMY_SPEED * delta;
      const nx = e.x + (dx / d) * step;
      const nz = e.z + (dz / d) * step;
      if (!blocked(blocks, nx, e.z, 0.6)) e.x = nx;
      if (!blocked(blocks, e.x, nz, 0.6)) e.z = nz;
      if (d < 1.3 && hurtCooldown.current <= 0) {
        hurtCooldown.current = 1;
        onHurt();
      }
    }
  });

  return (
    <>
      <color attach="background" args={["#c9b28c"]} />
      <fog attach="fog" args={["#c9b28c", 12, 46]} />
      <hemisphereLight args={["#ffe7c4", "#5b4a34", 1.1]} />
      <directionalLight
        position={[18, 26, 10]}
        intensity={1.5}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <Level blocks={blocks} />
      {enemies.map((e, i) => (
        <EnemyMesh key={i} data={e} />
      ))}
    </>
  );
}

export function Game() {
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9));
  const [score, setScore] = useState(0);
  const [health, setHealth] = useState(5);
  const [locked, setLocked] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const { blocks, enemies, respawnEnemy } = useMemo(() => {
    const level = generateLevel(seed);
    const list: Enemy[] = [];
    for (let i = 0; i < ENEMY_COUNT; i++) {
      const p = randomSpawn(level.blocks, level.rand);
      list.push({ ...p, alive: true });
    }
    const respawn = (e: Enemy) => {
      const p = randomSpawn(level.blocks, level.rand);
      e.x = p.x;
      e.z = p.z;
      e.alive = true;
    };
    return { blocks: level.blocks, enemies: list, respawnEnemy: respawn };
  }, [seed]);

  useEffect(() => {
    const onChange = () => setLocked(!!document.pointerLockElement);
    document.addEventListener("pointerlockchange", onChange);
    return () => document.removeEventListener("pointerlockchange", onChange);
  }, []);

  const gameOver = health <= 0;

  const start = () => {
    if (gameOver) {
      setSeed(Math.floor(Math.random() * 1e9));
      setScore(0);
      setHealth(5);
    }
    wrapRef.current?.requestPointerLock();
  };

  return (
    <div ref={wrapRef} className="fixed inset-0 cursor-crosshair select-none">
      <Canvas shadows camera={{ position: [0, EYE, 0], fov: 75, near: 0.1, far: 120 }}>
        <World
          blocks={blocks}
          enemies={enemies}
          locked={locked}
          gameOver={gameOver}
          onScore={() => setScore((s) => s + 1)}
          onHurt={() => setHealth((h) => Math.max(0, h - 1))}
          respawnEnemy={respawnEnemy}
        />
      </Canvas>

      {/* HUD */}
      <div className="pointer-events-none fixed inset-0 z-10 font-mono">
        <div className="flex items-start justify-between p-5 text-[#2b2118]">
          <div className="rounded-md bg-[#f3e6cf]/80 px-3 py-1.5 text-sm tracking-widest">
            HITS {score}
          </div>
          <div className="rounded-md bg-[#f3e6cf]/80 px-3 py-1.5 text-sm tracking-widest">
            {"♦".repeat(health)}
            <span className="opacity-30">{"♦".repeat(5 - health)}</span>
          </div>
        </div>
        {locked && !gameOver && (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <div className="h-5 w-[2px] bg-[#2b2118]/70" />
            <div className="absolute left-1/2 top-1/2 h-[2px] w-5 -translate-x-1/2 -translate-y-1/2 bg-[#2b2118]/70" />
          </div>
        )}
      </div>

      {(!locked || gameOver) && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-[#2b2118]/70 p-6">
          <div className="max-w-sm rounded-xl bg-[#f3e6cf] p-7 text-center font-mono text-[#2b2118] shadow-2xl">
            <h1 className="text-2xl font-bold tracking-tight">
              {gameOver ? "You got swarmed" : "DUSTFIELD"}
            </h1>
            <p className="mt-2 text-sm opacity-70">
              {gameOver
                ? `Final score: ${score} hits.`
                : "A new arena is generated every round. Clear the drifters."}
            </p>
            <p className="mt-4 text-xs leading-relaxed opacity-60">
              WASD to move · mouse to look · click to shoot · Esc to release the cursor
            </p>
            <button
              onClick={start}
              className="pointer-events-auto mt-6 rounded-md bg-[#b4653f] px-6 py-2 text-sm font-semibold tracking-widest text-[#f7eeda] transition-transform hover:scale-105"
            >
              {gameOver ? "NEW ARENA" : "CLICK TO PLAY"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
