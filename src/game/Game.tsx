import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { ARENA, HALF, BLOCK, blocked, generateLevel, randomSpawn, type Block } from "./level";
import { useKeyboard } from "./useKeyboard";

type Kind = "drifter" | "brute" | "shooter";
type Enemy = {
  kind: Kind;
  x: number;
  z: number;
  hp: number;
  alive: boolean;
  cooldown: number;
  swing: number; // >0 while swinging
  flash: number; // hit flash timer
};
type Bullet = { pos: THREE.Vector3; vel: THREE.Vector3; life: number; active: boolean };

const STATS: Record<Kind, { hp: number; speed: number; radius: number }> = {
  drifter: { hp: 1, speed: 2.4, radius: 0.6 },
  brute: { hp: 5, speed: 1.5, radius: 0.8 },
  shooter: { hp: 2, speed: 1.8, radius: 0.6 },
};

// 5 waves: [drifters, brutes, shooters]
const WAVES: [number, number, number][] = [
  [5, 0, 0],
  [5, 1, 1],
  [4, 2, 2],
  [5, 2, 4],
  [6, 4, 4],
];
const MAX_ENEMIES = 14;
const MAX_HP = 8;

const BULLET_SPEED = 22;
const ENEMY_BULLET_SPEED = 11;
const TURN_SPEED = 2.4;
const MAX_BULLETS = 30;
const SPEED = 7;
const EYE = 1.6;

const FORWARD = new THREE.Vector3();
const RIGHT = new THREE.Vector3();
const MOVE = new THREE.Vector3();

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
  const drifter = useRef<THREE.Group>(null);
  const brute = useRef<THREE.Group>(null);
  const shooter = useRef<THREE.Group>(null);
  const club = useRef<THREE.Group>(null);
  useFrame((state) => {
    const g = ref.current;
    if (!g) return;
    g.visible = data.alive;
    if (!data.alive) return;
    const t = state.clock.elapsedTime;
    const bob = data.kind === "brute" ? 0 : Math.sin(t * 4 + data.x) * 0.08;
    g.position.set(data.x, bob, data.z);
    g.lookAt(state.camera.position.x, 0, state.camera.position.z);
    const s = data.flash > 0 ? 1.15 : 1;
    g.scale.setScalar(s);
    if (drifter.current) drifter.current.visible = data.kind === "drifter";
    if (brute.current) brute.current.visible = data.kind === "brute";
    if (shooter.current) shooter.current.visible = data.kind === "shooter";
    if (club.current) {
      // swing from raised to forward
      const p = data.swing > 0 ? 1 - data.swing / 0.4 : 0;
      club.current.rotation.x = -1.4 + p * 2.4;
    }
  });
  return (
    <group ref={ref}>
      <group ref={drifter} position-y={0.9}>
        <mesh castShadow>
          <octahedronGeometry args={[0.8, 0]} />
          <meshLambertMaterial color="#c9452f" flatShading emissive="#3d0e06" />
        </mesh>
        <mesh position={[0, 0, 0.65]}>
          <sphereGeometry args={[0.15, 8, 8]} />
          <meshBasicMaterial color="#ffd9a0" />
        </mesh>
      </group>
      <group ref={brute}>
        <mesh position-y={1.1} castShadow>
          <boxGeometry args={[1.4, 1.8, 1]} />
          <meshLambertMaterial color="#4f5a3a" flatShading />
        </mesh>
        <mesh position={[0, 2.25, 0]} castShadow>
          <boxGeometry args={[0.8, 0.6, 0.7]} />
          <meshLambertMaterial color="#3b4429" flatShading />
        </mesh>
        <mesh position={[0, 2.3, 0.36]}>
          <boxGeometry args={[0.55, 0.12, 0.05]} />
          <meshBasicMaterial color="#ffcf6a" />
        </mesh>
        <group ref={club} position={[0.85, 1.6, 0]}>
          <mesh position={[0, 0.7, 0]} castShadow>
            <boxGeometry args={[0.18, 1.4, 0.18]} />
            <meshLambertMaterial color="#6b4a2c" />
          </mesh>
          <mesh position={[0, 1.45, 0]} castShadow>
            <boxGeometry args={[0.4, 0.4, 0.4]} />
            <meshLambertMaterial color="#8a8a86" flatShading />
          </mesh>
        </group>
      </group>
      <group ref={shooter} position-y={1.3}>
        <mesh castShadow>
          <cylinderGeometry args={[0.45, 0.6, 1.4, 6]} />
          <meshLambertMaterial color="#3d6f86" flatShading />
        </mesh>
        <mesh position={[0, 0.2, 0.55]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.12, 0.12, 0.7, 8]} />
          <meshLambertMaterial color="#222" />
        </mesh>
        <mesh position={[0, 0.5, 0.4]}>
          <sphereGeometry args={[0.12, 8, 8]} />
          <meshBasicMaterial color="#9ef0ff" />
        </mesh>
      </group>
    </group>
  );
}

function BulletPool({
  meshes,
  color,
  size,
}: {
  meshes: { current: (THREE.Mesh | null)[] };
  color: string;
  size: number;
}) {
  return (
    <>
      {Array.from({ length: MAX_BULLETS }, (_, i) => (
        <mesh key={i} ref={(m) => { meshes.current[i] = m; }} visible={false}>
          <sphereGeometry args={[size, 10, 10]} />
          <meshBasicMaterial color={color} fog={false} />
        </mesh>
      ))}
    </>
  );
}

function fireInto(pool: Bullet[], pos: THREE.Vector3, vel: THREE.Vector3, life: number) {
  const slot = pool.find((b) => !b.active);
  if (slot) {
    slot.pos.copy(pos);
    slot.vel.copy(vel);
    slot.life = life;
    slot.active = true;
  } else if (pool.length < MAX_BULLETS) {
    pool.push({ pos: pos.clone(), vel: vel.clone(), life, active: true });
  }
}

function World({
  blocks,
  enemies,
  rand,
  locked,
  gameOver,
  onScore,
  onHurt,
  onStatus,
}: {
  blocks: Block[];
  enemies: Enemy[];
  rand: () => number;
  locked: boolean;
  gameOver: boolean;
  onScore: () => void;
  onHurt: () => void;
  onStatus: (wave: number, remaining: number, won: boolean, banner: boolean) => void;
}) {
  const keys = useKeyboard();
  const look = useRef({ yaw: 0, pitch: 0 });
  const meleeCooldown = useRef(0);
  const { camera } = useThree();
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  const wave = useRef(0);
  const nextWaveTimer = useRef(1.5);
  const lastRemaining = useRef(-1);

  const bullets = useRef<Bullet[]>([]);
  const bulletMeshes = useRef<(THREE.Mesh | null)[]>([]);
  const enemyBullets = useRef<Bullet[]>([]);
  const enemyBulletMeshes = useRef<(THREE.Mesh | null)[]>([]);

  useEffect(() => {
    camera.position.set(0, EYE, 0);
    look.current = { yaw: 0, pitch: 0 };
    wave.current = 0;
    nextWaveTimer.current = 1.5;
    bullets.current.forEach((b) => (b.active = false));
    enemyBullets.current.forEach((b) => (b.active = false));
    onStatus(1, 0, false, true);
  }, [blocks, camera]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!document.pointerLockElement) return;
      look.current.yaw -= e.movementX * 0.0022;
      look.current.pitch = Math.max(-1.2, Math.min(1.2, look.current.pitch - e.movementY * 0.0022));
    };
    document.addEventListener("mousemove", onMove);
    return () => document.removeEventListener("mousemove", onMove);
  }, []);

  useEffect(() => {
    const fire = () => {
      if (!lockedRef.current || gameOver) return;
      camera.getWorldDirection(FORWARD);
      const pos = camera.position.clone().addScaledVector(FORWARD, 0.6);
      pos.y -= 0.25;
      fireInto(bullets.current, pos, FORWARD.clone().multiplyScalar(BULLET_SPEED), 2);
    };
    const onDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement)?.tagName === "CANVAS") fire();
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.code === "Space" || e.code === "Enter" || e.code === "NumpadEnter") && !e.repeat) fire();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [camera, gameOver]);

  const spawnWave = (n: number) => {
    const [d, b, s] = WAVES[n - 1] ?? [0, 0, 0];
    const kinds: Kind[] = [
      ...Array(d).fill("drifter"),
      ...Array(b).fill("brute"),
      ...Array(s).fill("shooter"),
    ];
    enemies.forEach((e, i) => {
      const kind = kinds[i];
      if (!kind) {
        e.alive = false;
        return;
      }
      const p = randomSpawn(blocks, rand);
      Object.assign(e, {
        kind,
        x: p.x,
        z: p.z,
        hp: STATS[kind].hp,
        alive: true,
        cooldown: 1 + rand() * 2,
        swing: 0,
        flash: 0,
      });
    });
  };

  const outOfBounds = (p: THREE.Vector3) =>
    p.y < 0 || Math.abs(p.x) > HALF || Math.abs(p.z) > HALF || blocked(blocks, p.x, p.z, 0.05);

  useFrame((state, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const cam = state.camera;
    const k = keys.current;

    if (!gameOver && locked) {
      look.current.yaw += ((k.has("ArrowLeft") ? 1 : 0) - (k.has("ArrowRight") ? 1 : 0)) * TURN_SPEED * delta;
      look.current.pitch = Math.max(
        -1.2,
        Math.min(1.2, look.current.pitch + ((k.has("ArrowUp") ? 1 : 0) - (k.has("ArrowDown") ? 1 : 0)) * TURN_SPEED * 0.7 * delta),
      );
    }
    cam.rotation.order = "YXZ";
    cam.rotation.set(look.current.pitch, look.current.yaw, 0);

    if (gameOver || !locked) return;

    // player movement
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

    // waves
    const remaining = enemies.filter((e) => e.alive).length;
    if (remaining === 0 && wave.current <= WAVES.length) {
      if (wave.current === WAVES.length) {
        wave.current++;
        onStatus(WAVES.length, 0, true, false);
        return;
      }
      nextWaveTimer.current -= delta;
      if (nextWaveTimer.current <= 0) {
        wave.current++;
        spawnWave(wave.current);
        nextWaveTimer.current = 2.5;
        onStatus(wave.current, enemies.filter((e) => e.alive).length, false, true);
        lastRemaining.current = -1;
      }
    } else if (remaining !== lastRemaining.current) {
      lastRemaining.current = remaining;
      onStatus(Math.max(1, wave.current), remaining, false, false);
    }

    // enemies
    meleeCooldown.current -= delta;
    for (const e of enemies) {
      if (!e.alive) continue;
      e.flash -= delta;
      e.cooldown -= delta;
      const st = STATS[e.kind];
      const dx = cam.position.x - e.x;
      const dz = cam.position.z - e.z;
      const d = Math.hypot(dx, dz) || 1;

      let dir = 1;
      if (e.kind === "shooter") dir = d > 11 ? 1 : d < 7 ? -1 : 0;
      if (e.kind === "brute" && d < 1.8) dir = 0;
      if (e.swing > 0) dir = 0;
      const step = st.speed * delta * dir;
      const nx = e.x + (dx / d) * step;
      const nz = e.z + (dz / d) * step;
      if (!blocked(blocks, nx, e.z, st.radius)) e.x = nx;
      if (!blocked(blocks, e.x, nz, st.radius)) e.z = nz;

      if (e.kind === "drifter" && d < 1.3 && meleeCooldown.current <= 0) {
        meleeCooldown.current = 1;
        onHurt();
      }
      if (e.kind === "brute") {
        if (e.swing > 0) {
          const before = e.swing;
          e.swing -= delta;
          // damage lands midway through the swing
          if (before > 0.2 && e.swing <= 0.2 && d < 2.4) onHurt();
        } else if (d < 2.2 && e.cooldown <= 0) {
          e.swing = 0.4;
          e.cooldown = 1.6;
        }
      }
      if (e.kind === "shooter" && e.cooldown <= 0 && d < 22) {
        e.cooldown = 2 + rand() * 0.8;
        const from = new THREE.Vector3(e.x, 1.5, e.z);
        const vel = new THREE.Vector3(cam.position.x, cam.position.y - 0.2, cam.position.z)
          .sub(from)
          .normalize();
        from.addScaledVector(vel, 0.8);
        fireInto(enemyBullets.current, from, vel.multiplyScalar(ENEMY_BULLET_SPEED), 3.5);
      }
    }

    // player bullets
    bullets.current.forEach((b, i) => {
      const m = bulletMeshes.current[i];
      if (b.active) {
        b.pos.addScaledVector(b.vel, delta);
        b.life -= delta;
        if (b.life <= 0 || outOfBounds(b.pos)) b.active = false;
        else {
          for (const e of enemies) {
            if (!e.alive) continue;
            const h = e.kind === "brute" ? 2.6 : 2;
            if (Math.hypot(b.pos.x - e.x, b.pos.z - e.z) < STATS[e.kind].radius + 0.2 && b.pos.y < h) {
              b.active = false;
              e.hp -= 1;
              e.flash = 0.1;
              if (e.hp <= 0) {
                e.alive = false;
                onScore();
              }
              break;
            }
          }
        }
      }
      if (m) {
        m.visible = b.active;
        m.position.copy(b.pos);
      }
    });

    // enemy bullets
    enemyBullets.current.forEach((b, i) => {
      const m = enemyBulletMeshes.current[i];
      if (b.active) {
        b.pos.addScaledVector(b.vel, delta);
        b.life -= delta;
        if (b.life <= 0 || outOfBounds(b.pos)) b.active = false;
        else if (b.pos.distanceTo(cam.position) < 0.6) {
          b.active = false;
          onHurt();
        }
      }
      if (m) {
        m.visible = b.active;
        m.position.copy(b.pos);
      }
    });
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
      <BulletPool meshes={bulletMeshes} color="#ff8a1f" size={0.14} />
      <BulletPool meshes={enemyBulletMeshes} color="#39d0ff" size={0.18} />
    </>
  );
}

export function Game() {
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9));
  const [score, setScore] = useState(0);
  const [health, setHealth] = useState(MAX_HP);
  const [locked, setLocked] = useState(false);
  const [status, setStatus] = useState({ wave: 1, remaining: 0, won: false });
  const [banner, setBanner] = useState(false);
  const [hurtFlash, setHurtFlash] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const { blocks, enemies, rand } = useMemo(() => {
    const level = generateLevel(seed);
    level.blocks = level.blocks.filter((b) => Math.max(Math.abs(b.x), Math.abs(b.z)) > BLOCK / 2 + 2.5);
    const list: Enemy[] = Array.from({ length: MAX_ENEMIES }, () => ({
      kind: "drifter" as Kind,
      x: 0,
      z: 0,
      hp: 0,
      alive: false,
      cooldown: 0,
      swing: 0,
      flash: 0,
    }));
    return { blocks: level.blocks, enemies: list, rand: level.rand };
  }, [seed]);

  useEffect(() => {
    const wasLocked = { v: false };
    const onChange = () => {
      if (document.pointerLockElement) wasLocked.v = true;
      else if (wasLocked.v) {
        wasLocked.v = false;
        setLocked(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape") setLocked(false);
    };
    document.addEventListener("pointerlockchange", onChange);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerlockchange", onChange);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (!banner) return;
    const t = window.setTimeout(() => setBanner(false), 1800);
    return () => window.clearTimeout(t);
  }, [banner, status.wave]);

  const gameOver = health <= 0;
  const ended = gameOver || status.won;

  const start = () => {
    if (ended) {
      setSeed(Math.floor(Math.random() * 1e9));
      setScore(0);
      setHealth(MAX_HP);
      setStatus({ wave: 1, remaining: 0, won: false });
    }
    setLocked(true);
    try {
      const r = wrapRef.current?.requestPointerLock() as unknown as Promise<void> | undefined;
      r?.catch?.(() => {});
    } catch {
      /* pointer lock unavailable — arrow keys still work */
    }
  };

  return (
    <div ref={wrapRef} className="fixed inset-0 cursor-crosshair select-none">
      <Canvas shadows camera={{ position: [0, EYE, 0], fov: 75, near: 0.1, far: 120 }}>
        <World
          blocks={blocks}
          enemies={enemies}
          rand={rand}
          locked={locked}
          gameOver={ended}
          onScore={() => setScore((s) => s + 1)}
          onHurt={() => {
            setHealth((h) => Math.max(0, h - 1));
            setHurtFlash((n) => n + 1);
          }}
          onStatus={(wave, remaining, won, showBanner) => {
            setStatus({ wave, remaining, won });
            if (showBanner) setBanner(true);
          }}
        />
      </Canvas>

      {hurtFlash > 0 && (
        <div
          key={hurtFlash}
          className="pointer-events-none fixed inset-0 z-10 animate-[hurt_0.35s_ease-out_forwards] bg-[#b3261e]/40"
        />
      )}
      <style>{`@keyframes hurt { from { opacity: 1 } to { opacity: 0 } }`}</style>

      <div className="pointer-events-none fixed inset-0 z-10 font-mono">
        <div className="flex items-start justify-between p-5 text-[#2b2118]">
          <div className="flex gap-2">
            <div className="rounded-md bg-[#f3e6cf]/80 px-3 py-1.5 text-sm tracking-widest">
              WAVE {status.wave}/{WAVES.length}
            </div>
            <div className="rounded-md bg-[#f3e6cf]/80 px-3 py-1.5 text-sm tracking-widest">
              LEFT {status.remaining}
            </div>
            <div className="rounded-md bg-[#f3e6cf]/80 px-3 py-1.5 text-sm tracking-widest">
              KILLS {score}
            </div>
          </div>
          <div className="rounded-md bg-[#f3e6cf]/80 px-3 py-1.5 text-sm tracking-widest">
            {"♦".repeat(health)}
            <span className="opacity-30">{"♦".repeat(MAX_HP - health)}</span>
          </div>
        </div>
        {banner && locked && !ended && (
          <div className="absolute left-1/2 top-1/3 -translate-x-1/2 rounded-lg bg-[#2b2118]/80 px-6 py-3 text-2xl font-bold tracking-[0.3em] text-[#f3e6cf]">
            WAVE {status.wave}
          </div>
        )}
        {locked && !ended && (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <div className="h-5 w-[2px] bg-[#2b2118]/70" />
            <div className="absolute left-1/2 top-1/2 h-[2px] w-5 -translate-x-1/2 -translate-y-1/2 bg-[#2b2118]/70" />
          </div>
        )}
      </div>

      {(!locked || ended) && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-[#2b2118]/70 p-6">
          <div className="max-w-sm rounded-xl bg-[#f3e6cf] p-7 text-center font-mono text-[#2b2118] shadow-2xl">
            <h1 className="text-2xl font-bold tracking-tight">
              {gameOver ? "You got swarmed" : status.won ? "Arena cleared!" : "DUSTFIELD"}
            </h1>
            <p className="mt-2 text-sm opacity-70">
              {gameOver
                ? `You fell on wave ${status.wave} with ${score} kills.`
                : status.won
                  ? `All ${WAVES.length} waves survived · ${score} kills.`
                  : `Survive ${WAVES.length} waves. Red drifters ram you, green brutes swing clubs, blue gunners shoot from range.`}
            </p>
            <p className="mt-4 text-xs leading-relaxed opacity-60">
              WASD to move · mouse or arrow keys to look · Space to shoot · Esc to pause
            </p>
            <button
              onClick={start}
              className="pointer-events-auto mt-6 rounded-md bg-[#b4653f] px-6 py-2 text-sm font-semibold tracking-widest text-[#f7eeda] transition-transform hover:scale-105"
            >
              {ended ? "NEW ARENA" : "CLICK TO PLAY"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
