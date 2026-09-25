import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import {
  ARENA, HALF, BLOCK, blocked, generateLevel, randomSpawn, type Block,
  solidGrid, flowField, nextWaypoint, clearLine, toCell,
} from "./level";
import { THEMES, type Theme } from "./themes";
import { useKeyboard } from "./useKeyboard";

type Kind = "drifter" | "brute" | "shooter" | "runner" | "boss";
type Weapon = "pistol" | "scatter";
type Enemy = {
  kind: Kind;
  x: number;
  z: number;
  hp: number;
  alive: boolean;
  cooldown: number;
  swing: number; // >0 while swinging
  flash: number; // hit flash timer
  shot: number; // boss volley timer
};
type Bullet = { pos: THREE.Vector3; vel: THREE.Vector3; life: number; active: boolean };

const BOSS_HP = 45;
const STATS: Record<Kind, { hp: number; speed: number; radius: number }> = {
  drifter: { hp: 1, speed: 2.4, radius: 0.6 },
  brute: { hp: 5, speed: 1.5, radius: 0.8 },
  shooter: { hp: 2, speed: 1.8, radius: 0.6 },
  runner: { hp: 1, speed: 4.2, radius: 0.45 },
  boss: { hp: BOSS_HP, speed: 1.2, radius: 1.5 },
};

// 10 waves: [drifters, brutes, shooters, runners, boss]
const WAVES: [number, number, number, number, number][] = [
  [5, 0, 0, 0, 0],
  [5, 1, 1, 0, 0],
  [4, 1, 2, 3, 0],
  [5, 2, 3, 2, 0],
  [6, 3, 3, 3, 0],
  [4, 2, 4, 6, 0],
  [6, 4, 4, 4, 0],
  [5, 5, 5, 5, 0],
  [8, 5, 6, 6, 0],
  [4, 2, 2, 2, 1], // boss round
];
const PICKUP_WAVE = 3;
const MAX_ENEMIES = 26;
const MAX_HP = 8;

const BULLET_SPEED = 22;
const ENEMY_BULLET_SPEED = 11;
const TURN_SPEED = 2.4;
const MAX_BULLETS = 60;
const SPEED = 7;
const EYE = 1.6;

const FORWARD = new THREE.Vector3();
const RIGHT = new THREE.Vector3();
const MOVE = new THREE.Vector3();

function Obstacle({ b, theme }: { b: Block; theme: Theme }) {
  const color = b.tone > 0.6 ? theme.blocks[0] : b.tone > 0.3 ? theme.blocks[1] : theme.blocks[2];
  if (theme.blockShape === "tree") {
    const trunk = 1 + b.h * 0.25;
    return (
      <group position={[b.x, 0, b.z]}>
        <mesh position-y={trunk / 2} castShadow>
          <cylinderGeometry args={[0.3, 0.4, trunk, 6]} />
          <meshLambertMaterial color="#4a3320" flatShading />
        </mesh>
        <mesh position-y={trunk + b.h * 0.45} castShadow>
          <coneGeometry args={[1.3, b.h * 0.9 + 1, 7]} />
          <meshLambertMaterial color={color} flatShading />
        </mesh>
        <mesh position-y={trunk + b.h * 0.9} castShadow>
          <coneGeometry args={[0.9, b.h * 0.6 + 0.6, 7]} />
          <meshLambertMaterial color={color} flatShading />
        </mesh>
      </group>
    );
  }
  if (theme.blockShape === "rock") {
    return (
      <mesh position={[b.x, b.h * 0.4, b.z]} rotation={[b.tone, b.tone * 3, 0]} scale={[1.2, b.h * 0.5 + 0.4, 1.2]} castShadow receiveShadow>
        <dodecahedronGeometry args={[1, 0]} />
        <meshLambertMaterial color={color} flatShading />
      </mesh>
    );
  }
  if (theme.blockShape === "crystal") {
    return (
      <group position={[b.x, 0, b.z]} rotation-y={b.tone * Math.PI}>
        <mesh position-y={b.h / 2} castShadow receiveShadow>
          <cylinderGeometry args={[0.8, 1.1, b.h, 5]} />
          <meshLambertMaterial color={color} flatShading emissive={color} emissiveIntensity={0.15} />
        </mesh>
        <mesh position-y={b.h + 0.5}>
          <coneGeometry args={[0.8, 1, 5]} />
          <meshLambertMaterial color="#f4fbff" flatShading />
        </mesh>
      </group>
    );
  }
  return (
    <mesh position={[b.x, b.h / 2, b.z]} castShadow receiveShadow>
      <boxGeometry args={[BLOCK, b.h, BLOCK]} />
      <meshLambertMaterial color={color} flatShading />
    </mesh>
  );
}

function Level({ blocks, theme }: { blocks: Block[]; theme: Theme }) {
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[ARENA, ARENA]} />
        <meshLambertMaterial color={theme.ground} />
      </mesh>
      <gridHelper args={[ARENA, ARENA / 2, theme.grid[0], theme.grid[1]]} position-y={0.01} />
      {blocks.map((b, i) => (
        <Obstacle key={i} b={b} theme={theme} />
      ))}
      {([
        [0, -HALF, ARENA, 1],
        [0, HALF, ARENA, 1],
        [-HALF, 0, 1, ARENA],
        [HALF, 0, 1, ARENA],
      ] as const).map(([x, z, w, d], i) => (
        <mesh key={`w${i}`} position={[x, 2, z]}>
          <boxGeometry args={[w, 4, d]} />
          <meshLambertMaterial color={theme.wall} flatShading />
        </mesh>
      ))}
    </group>
  );
}

function EnemyMesh({ data, theme }: { data: Enemy; theme: Theme }) {
  const c = theme.enemy;
  const ref = useRef<THREE.Group>(null);
  const drifter = useRef<THREE.Group>(null);
  const brute = useRef<THREE.Group>(null);
  const shooter = useRef<THREE.Group>(null);
  const club = useRef<THREE.Group>(null);
  const crown = useRef<THREE.Group>(null);
  useFrame((state) => {
    const g = ref.current;
    if (!g) return;
    g.visible = data.alive;
    if (!data.alive) return;
    const t = state.clock.elapsedTime;
    const heavy = data.kind === "brute" || data.kind === "boss";
    const bob = heavy ? 0 : Math.sin(t * (data.kind === "runner" ? 10 : 4) + data.x) * 0.08;
    g.position.set(data.x, bob, data.z);
    g.lookAt(state.camera.position.x, 0, state.camera.position.z);
    const base = data.kind === "boss" ? 2 : data.kind === "runner" ? 0.6 : 1;
    const s = base * (data.flash > 0 ? 1.15 : 1);
    g.scale.setScalar(s);
    if (drifter.current) drifter.current.visible = data.kind === "drifter" || data.kind === "runner";
    if (brute.current) brute.current.visible = heavy;
    if (crown.current) crown.current.visible = data.kind === "boss";
    if (shooter.current) shooter.current.visible = data.kind === "shooter";
    if (drifter.current) drifter.current.rotation.y = data.kind === "runner" ? t * 8 : 0;
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
          <meshLambertMaterial color={c.drifter.body} flatShading emissive={c.drifter.emissive} />
        </mesh>
        <mesh position={[0, 0, 0.65]}>
          <sphereGeometry args={[0.15, 8, 8]} />
          <meshBasicMaterial color={c.drifter.eye} />
        </mesh>
      </group>
      <group ref={brute}>
        <group ref={crown} position-y={2.65}>
          {[0, 1, 2, 3, 4].map((i) => (
            <mesh key={i} position={[Math.sin((i / 5) * Math.PI * 2) * 0.35, 0, Math.cos((i / 5) * Math.PI * 2) * 0.35]}>
              <coneGeometry args={[0.1, 0.35, 4]} />
              <meshBasicMaterial color={c.shooter.eye} />
            </mesh>
          ))}
        </group>
        <mesh position-y={1.1} castShadow>
          <boxGeometry args={[1.4, 1.8, 1]} />
          <meshLambertMaterial color={c.brute.body} flatShading />
        </mesh>
        <mesh position={[0, 2.25, 0]} castShadow>
          <boxGeometry args={[0.8, 0.6, 0.7]} />
          <meshLambertMaterial color={c.brute.head} flatShading />
        </mesh>
        <mesh position={[0, 2.3, 0.36]}>
          <boxGeometry args={[0.55, 0.12, 0.05]} />
          <meshBasicMaterial color={c.brute.eye} />
        </mesh>
        <group ref={club} position={[0.85, 1.6, 0]}>
          <mesh position={[0, 0.7, 0]} castShadow>
            <boxGeometry args={[0.18, 1.4, 0.18]} />
            <meshLambertMaterial color={c.brute.club} />
          </mesh>
          <mesh position={[0, 1.45, 0]} castShadow>
            <boxGeometry args={[0.4, 0.4, 0.4]} />
            <meshLambertMaterial color={c.brute.clubHead} flatShading />
          </mesh>
        </group>
      </group>
      <group ref={shooter} position-y={1.3}>
        <mesh castShadow>
          <cylinderGeometry args={[0.45, 0.6, 1.4, 6]} />
          <meshLambertMaterial color={c.shooter.body} flatShading />
        </mesh>
        <mesh position={[0, 0.2, 0.55]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.12, 0.12, 0.7, 8]} />
          <meshLambertMaterial color={c.shooter.barrel} />
        </mesh>
        <mesh position={[0, 0.5, 0.4]}>
          <sphereGeometry args={[0.12, 8, 8]} />
          <meshBasicMaterial color={c.shooter.eye} />
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
  theme,
  locked,
  gameOver,
  onScore,
  onHurt,
  onStatus,
  onBoss,
  onWeapon,
}: {
  blocks: Block[];
  enemies: Enemy[];
  rand: () => number;
  theme: Theme;
  locked: boolean;
  gameOver: boolean;
  onScore: () => void;
  onHurt: () => void;
  onStatus: (wave: number, remaining: number, won: boolean, banner: boolean) => void;
  onBoss: (hp: number) => void;
  onWeapon: (w: Weapon) => void;
}) {
  const keys = useKeyboard();
  const look = useRef({ yaw: 0, pitch: 0 });
  const meleeCooldown = useRef(0);
  const { camera } = useThree();
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const weapon = useRef<Weapon>("pistol");
  const pickup = useRef({ x: 0, z: 0, active: false });
  const pickupMesh = useRef<THREE.Group>(null);

  const solid = useMemo(() => solidGrid(blocks), [blocks]);
  const field = useRef<{ key: number; dist: Float32Array } | null>(null);
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
    weapon.current = "pistol";
    pickup.current.active = false;
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
      if (weapon.current === "scatter") {
        for (let s = -2; s <= 2; s++) {
          const dir = FORWARD.clone().applyAxisAngle(camera.up, s * 0.07);
          dir.y += (Math.random() - 0.5) * 0.04;
          fireInto(bullets.current, pos, dir.normalize().multiplyScalar(BULLET_SPEED), 0.8);
        }
      } else {
        fireInto(bullets.current, pos, FORWARD.clone().multiplyScalar(BULLET_SPEED), 2);
      }
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
    const [d, b, s, r, boss] = WAVES[n - 1] ?? [0, 0, 0, 0, 0];
    const kinds: Kind[] = [
      ...Array(boss).fill("boss"),
      ...Array(d).fill("drifter"),
      ...Array(b).fill("brute"),
      ...Array(s).fill("shooter"),
      ...Array(r).fill("runner"),
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
        shot: 2,
      });
    });
    if (boss) onBoss(BOSS_HP);
    if (n === PICKUP_WAVE && weapon.current === "pistol") {
      const p = randomSpawn(blocks, rand);
      pickup.current = { x: p.x, z: p.z, active: true };
    }
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

    // weapon pickup
    const pk = pickup.current;
    if (pickupMesh.current) {
      pickupMesh.current.visible = pk.active;
      if (pk.active) {
        pickupMesh.current.position.set(pk.x, Math.sin(state.clock.elapsedTime * 3) * 0.15, pk.z);
        pickupMesh.current.rotation.y += delta * 2;
      }
    }
    if (pk.active && Math.hypot(cam.position.x - pk.x, cam.position.z - pk.z) < 1.3) {
      pk.active = false;
      weapon.current = "scatter";
      onWeapon("scatter");
    }

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
    const pi = toCell(cam.position.x);
    const pj = toCell(cam.position.z);
    const key = pi * 1000 + pj;
    if (!field.current || field.current.key !== key) field.current = { key, dist: flowField(solid, pi, pj) };
    meleeCooldown.current -= delta;
    for (const e of enemies) {
      if (!e.alive) continue;
      e.flash -= delta;
      e.cooldown -= delta;
      const st = STATS[e.kind];
      const dx = cam.position.x - e.x;
      const dz = cam.position.z - e.z;
      const d = Math.hypot(dx, dz) || 1;

      // route around obstacles: go straight if clear, else follow the flow field
      let tx = cam.position.x;
      let tz = cam.position.z;
      if (!clearLine(blocks, e.x, e.z, tx, tz, Math.min(st.radius, 0.8) * 0.9)) {
        const wp = nextWaypoint(solid, field.current!.dist, e.x, e.z);
        tx = wp.x;
        tz = wp.z;
      }
      const mx = tx - e.x;
      const mz = tz - e.z;
      const md = Math.hypot(mx, mz) || 1;
      let dir = 1;
      if (e.kind === "shooter") dir = d > 11 ? 1 : d < 7 ? -1 : 0;
      if (e.kind === "brute" && d < 1.8) dir = 0;
      if (e.kind === "boss" && d < 3) dir = 0;
      if (e.swing > 0) dir = 0;
      const step = st.speed * delta * dir;
      const nx = e.x + (mx / md) * step;
      const nz = e.z + (mz / md) * step;
      // boss is big but squeezes through gaps like a brute
      const r = Math.min(st.radius, 0.8);
      if (!blocked(blocks, nx, e.z, r)) e.x = nx;
      if (!blocked(blocks, e.x, nz, r)) e.z = nz;

      if ((e.kind === "drifter" || e.kind === "runner") && d < 1.3 && meleeCooldown.current <= 0) {
        meleeCooldown.current = 1;
        onHurt();
      }
      if (e.kind === "brute" || e.kind === "boss") {
        const reach = e.kind === "boss" ? 3.6 : 2.4;
        if (e.swing > 0) {
          const before = e.swing;
          e.swing -= delta;
          if (before > 0.2 && e.swing <= 0.2 && d < reach) {
            onHurt();
            if (e.kind === "boss") onHurt();
          }
        } else if (d < reach - 0.2 && e.cooldown <= 0) {
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
      if (e.kind === "boss") {
        e.shot -= delta;
        if (e.shot <= 0 && d < 26) {
          e.shot = 2.2;
          const from = new THREE.Vector3(e.x, 2.6, e.z);
          const base = Math.atan2(dx, dz);
          for (let s = -2; s <= 2; s++) {
            const a = base + s * 0.18;
            const vel = new THREE.Vector3(Math.sin(a), (cam.position.y - 2.6) / d, Math.cos(a)).normalize();
            const p = from.clone().addScaledVector(vel, 1.6);
            fireInto(enemyBullets.current, p, vel.multiplyScalar(ENEMY_BULLET_SPEED * 0.9), 3.5);
          }
        }
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
            const h = e.kind === "boss" ? 5 : e.kind === "brute" ? 2.6 : 2;
            if (Math.hypot(b.pos.x - e.x, b.pos.z - e.z) < STATS[e.kind].radius + 0.2 && b.pos.y < h) {
              b.active = false;
              e.hp -= 1;
              e.flash = 0.1;
              if (e.kind === "boss") onBoss(Math.max(0, e.hp));
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
      <color attach="background" args={[theme.sky]} />
      <fog attach="fog" args={[theme.sky, 12, 46]} />
      <hemisphereLight args={[theme.hemi[0], theme.hemi[1], 1.1]} />
      <directionalLight
        position={[18, 26, 10]}
        intensity={1.5}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <Level blocks={blocks} theme={theme} />
      {enemies.map((e, i) => (
        <EnemyMesh key={i} data={e} theme={theme} />
      ))}
      <group ref={pickupMesh} visible={false}>
        <mesh position-y={0.2} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[0.7, 0.9, 24]} />
          <meshBasicMaterial color="#ffd23f" fog={false} />
        </mesh>
        <mesh position-y={1}>
          <boxGeometry args={[1, 0.3, 0.3]} />
          <meshLambertMaterial color="#2b2118" emissive="#ff8a1f" emissiveIntensity={0.6} />
        </mesh>
        <mesh position={[-0.35, 0.8, 0]}>
          <boxGeometry args={[0.2, 0.4, 0.25]} />
          <meshLambertMaterial color="#6b4a2c" />
        </mesh>
      </group>
      <BulletPool meshes={bulletMeshes} color="#ff8a1f" size={0.14} />
      <BulletPool meshes={enemyBulletMeshes} color={theme.enemyBullet} size={0.18} />
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
  const [weapon, setWeapon] = useState<Weapon>("pistol");
  const [bossHp, setBossHp] = useState(0);
  const [pickupMsg, setPickupMsg] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pickupMsg) return;
    const t = window.setTimeout(() => setPickupMsg(false), 2000);
    return () => window.clearTimeout(t);
  }, [pickupMsg]);

  const { blocks, enemies, rand, theme } = useMemo(() => {
    const level = generateLevel(seed);
    const theme = THEMES[seed % THEMES.length]!;
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
      shot: 0,
    }));
    return { blocks: level.blocks, enemies: list, rand: level.rand, theme };
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

  // free the mouse when the round ends so the button can be clicked
  useEffect(() => {
    if (ended && document.pointerLockElement) document.exitPointerLock();
  }, [ended]);

  const start = () => {
    if (ended) {
      setSeed(Math.floor(Math.random() * 1e9));
      setScore(0);
      setHealth(MAX_HP);
      setStatus({ wave: 1, remaining: 0, won: false });
      setWeapon("pistol");
      setBossHp(0);
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
          theme={theme}
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
          onBoss={setBossHp}
          onWeapon={(w) => {
            setWeapon(w);
            if (w === "scatter") setPickupMsg(true);
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
          <div className="flex flex-wrap gap-2">
            <div className="rounded-md bg-[#f3e6cf]/80 px-3 py-1.5 text-sm tracking-widest">
              {theme.name.toUpperCase()}
            </div>
            <div className="rounded-md bg-[#f3e6cf]/80 px-3 py-1.5 text-sm tracking-widest">
              WAVE {status.wave}/{WAVES.length}
            </div>
            <div className="rounded-md bg-[#f3e6cf]/80 px-3 py-1.5 text-sm tracking-widest">
              LEFT {status.remaining}
            </div>
            <div className="rounded-md bg-[#f3e6cf]/80 px-3 py-1.5 text-sm tracking-widest">
              KILLS {score}
            </div>
            <div className="rounded-md bg-[#f3e6cf]/80 px-3 py-1.5 text-sm tracking-widest">
              {weapon === "scatter" ? "SCATTER" : "PISTOL"}
            </div>
          </div>
          <div className="rounded-md bg-[#f3e6cf]/80 px-3 py-1.5 text-sm tracking-widest">
            {"♦".repeat(health)}
            <span className="opacity-30">{"♦".repeat(MAX_HP - health)}</span>
          </div>
        </div>
        {bossHp > 0 && locked && !ended && (
          <div className="absolute left-1/2 top-16 w-80 -translate-x-1/2 text-center text-xs tracking-[0.3em] text-[#2b2118]">
            <div className="mb-1 rounded bg-[#f3e6cf]/80 py-0.5">WARLORD</div>
            <div className="h-3 overflow-hidden rounded bg-[#2b2118]/60">
              <div className="h-full bg-[#b3261e]" style={{ width: `${(bossHp / BOSS_HP) * 100}%` }} />
            </div>
          </div>
        )}
        {banner && locked && !ended && (
          <div className="absolute left-1/2 top-1/3 -translate-x-1/2 rounded-lg bg-[#2b2118]/80 px-6 py-3 text-2xl font-bold tracking-[0.3em] text-[#f3e6cf]">
            {status.wave === WAVES.length ? "BOSS ROUND" : `WAVE ${status.wave}`}
          </div>
        )}
        {pickupMsg && locked && !ended && (
          <div className="absolute left-1/2 top-[58%] -translate-x-1/2 rounded-lg bg-[#2b2118]/80 px-4 py-2 text-sm tracking-[0.25em] text-[#f3e6cf]">
            SCATTER GUN ACQUIRED
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
              {gameOver ? "You got swarmed" : status.won ? "Arena cleared!" : theme.name}
            </h1>
            <p className="mt-2 text-sm opacity-70">
              {gameOver
                ? `You fell on wave ${status.wave} with ${score} kills.`
                : status.won
                  ? `All ${WAVES.length} waves survived · ${score} kills.`
                  : `Survive ${WAVES.length} waves and beat the Warlord. Grab the glowing scatter gun when it drops on wave 3.`}
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
