import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import {
  ARENA, HALF, BLOCK, blocked, generateLevel, randomSpawn, type Block,
  solidGrid, flowField, nextWaypoint, clearLine, toNav, spawnNear,
  setArenaSize, SOLO_ARENA, COOP_ARENA, CITY_SOLO, CITY_COOP,
} from "./level";

import { THEMES, layoutOf, type Theme } from "./themes";
import type { CityLayout } from "./cityLayout";
import { CityScene, CitySun } from "./City";
import { CityTraffic } from "./Traffic";
import { Minimap, type MapFeed } from "./Minimap";
import { hitsTraffic, liveCars, type TrafficLink } from "./trafficCore";
import { worldLook } from "./lighting";
import { groundY, groundSpeed, setTerrain, wind } from "./terrain";
import { AlpineScene, AlpineSun } from "./alpine/Alpine";
import { PloughBody, SkierModel } from "./alpine/enemies";
import { alpine, decodeAlpine, encodeAlpine, resetAlpine } from "./alpine/weather";
import { ALPINE_SIZE, type AlpineLayout } from "./alpine/layout";
import { Stars } from "@react-three/drei";
import { ENEMY_FIELDS, packEnemy, unpackEnemy } from "./enemySync";
import { RemoteDeployables, type RemoteDeps } from "./RemoteDeployables";
import { useKeyboard } from "./useKeyboard";
import { RemotePlayers } from "./Remote";
import { colorFor, hostRoom, joinRoom, type NetHandle, type NetMsg, type RemoteState } from "./net";
import { Shards } from "./Shards";
import { initAudio, playGun, playSfx, setMusicIntensity, setMusicTheme, setVolumes, startMusic, stopMusic } from "./audio";
import { ABILITIES, ABILITY_IDS, type AbilityId } from "./abilities";
import { NO_PERKS, PERK_IDS, PERK_INFO, MOD_SLOTS, PISTOL_MODS, derive, modsEquipped, perkAvailable, perkBadge, perkCost, type Derived, type PerkId, type Perks } from "./perks";


type Kind = "drifter" | "brute" | "shooter" | "runner" | "boss" | "specter" | "bomber" | "vanguard" | "special";
type Weapon =
  | "pistol" | "scatter" | "smg" | "rail" | "cannon"
  | "rebound" | "harpoon" | "cryo" | "flak" | "tesla";
type Gun = {
  name: string; wave: number; cooldown: number; count: number; spread: number;
  speed: number; life: number; damage: number; size: number; color: string; body: string; ammo: number;
  bounce?: number; pierce?: number; slow?: number; cluster?: number; chain?: number;
};
const GUNS: Record<Weapon, Gun> = {
  pistol: { name: "PISTOL", wave: 0, cooldown: 0.28, count: 1, spread: 0, speed: 22, life: 2, damage: 1, size: 0.14, color: "#ff8a1f", body: "#3a2f26", ammo: 140 },
  scatter: { name: "SCATTER", wave: 3, cooldown: 0.7, count: 5, spread: 0.07, speed: 22, life: 0.8, damage: 1, size: 0.12, color: "#ffd23f", body: "#6b4a2c", ammo: 16 },
  smg: { name: "BUZZER", wave: 5, cooldown: 0.08, count: 1, spread: 0.03, speed: 26, life: 1.4, damage: 1, size: 0.09, color: "#4fe3ff", body: "#2c4a5c", ammo: 120 },
  rail: { name: "LANCE", wave: 7, cooldown: 0.9, count: 1, spread: 0, speed: 48, life: 1.5, damage: 5, size: 0.1, color: "#e04bff", body: "#e8e2d4", ammo: 10 },
  cannon: { name: "BOOMER", wave: 9, cooldown: 1.1, count: 1, spread: 0, speed: 13, life: 3, damage: 8, size: 0.38, color: "#ff3b2a", body: "#1e1e1e", ammo: 6 },
  rebound: { name: "REBOUNDER", wave: 4, cooldown: 0.5, count: 1, spread: 0, speed: 20, life: 3, damage: 2, size: 0.17, color: "#7cff4f", body: "#2f4a22", ammo: 20, bounce: 3 },
  harpoon: { name: "HARPOON", wave: 6, cooldown: 0.8, count: 1, spread: 0, speed: 40, life: 2, damage: 3, size: 0.1, color: "#f2ead6", body: "#4a4238", ammo: 12, pierce: 3 },
  cryo: { name: "GLACIER", wave: 4, cooldown: 0.25, count: 1, spread: 0.02, speed: 28, life: 1.5, damage: 1, size: 0.12, color: "#9fe8ff", body: "#2a5f6e", ammo: 30, slow: 2.5 },
  flak: { name: "FLAK", wave: 8, cooldown: 1, count: 1, spread: 0, speed: 16, life: 2, damage: 3, size: 0.3, color: "#ff9d3b", body: "#3c3a2a", ammo: 8, cluster: 4 },
  tesla: { name: "TESLA", wave: 6, cooldown: 0.35, count: 1, spread: 0, speed: 34, life: 1.2, damage: 2, size: 0.14, color: "#5f9bff", body: "#20304f", ammo: 40, chain: 2 },
};
const ORDER: Weapon[] = ["pistol", "scatter", "smg", "rail", "cannon", "rebound", "harpoon", "cryo", "flak", "tesla"];
const DROPPABLE: Weapon[] = ORDER.filter((w) => w !== "pistol");
const KINDS: Kind[] = ["drifter", "brute", "shooter", "runner", "boss", "specter", "bomber", "vanguard", "special"];
type CrateKind = "turret" | "shield" | "mine" | "ammo";
const CRATE_KINDS: CrateKind[] = ["turret", "mine", "ammo"];
const CRATE_INFO: Record<CrateKind, { name: string; color: string }> = {
  turret: { name: "SENTRY TURRET", color: "#4fe3ff" },
  shield: { name: "NANO BARRIER", color: "#7cc6ff" },
  mine: { name: "CRYO MINE", color: "#9fe8ff" },
  ammo: { name: "AMMO CACHE", color: "#e7b25c" },
};
const TURRET_LIFE = 15;

type Enemy = {
  kind: Kind;
  /** city unstick tracking: last sampled spot and seconds without progress */
  lastX?: number;
  lastZ?: number;
  stuckFor?: number;
  x: number;
  z: number;
  hp: number;
  alive: boolean;
  cooldown: number;
  swing: number; // >0 while swinging
  flash: number; // hit flash timer
  shot: number; // boss volley timer
  slow: number; // frozen timer
  burn: number; // burning timer from incendiary rounds
  burnTick: number;
  max?: number; // spawn health, for the executioner hammer
  shredUntil?: number; // shredder rounds: takes extra damage until this time
  aux?: number; // special-enemy state (leap / beam timer)
  yaw?: number; // facing, decided by the host (toward its target) and synced to guests
  elite?: number; // 1 = event champion (gold, tougher, big shard payout)
};
type Bullet = {
  pos: THREE.Vector3; vel: THREE.Vector3; life: number; active: boolean; damage: number; color: string; size: number;
  bounce: number; pierce: number; slow: number; cluster: number; chain: number; burn: number; knock: number; mods: number;
};
const M_SHRED = 1, M_EXEC = 2, M_BOUNTY = 4;


const BOSS_HP = 300;
const STATS: Record<Kind, { hp: number; speed: number; radius: number; dmg: number }> = {
  drifter: { hp: 2, speed: 2.6, radius: 0.6, dmg: 1 },
  brute: { hp: 7, speed: 1.6, radius: 0.8, dmg: 2 },
  shooter: { hp: 3, speed: 2, radius: 0.6, dmg: 1 },
  runner: { hp: 2, speed: 4.3, radius: 0.45, dmg: 1 },
  boss: { hp: BOSS_HP, speed: 1.4, radius: 1.5, dmg: 3 },
  specter: { hp: 3, speed: 3.3, radius: 0.55, dmg: 2 },
  bomber: { hp: 4, speed: 1.5, radius: 0.7, dmg: 2 },
  vanguard: { hp: 11, speed: 1.2, radius: 0.9, dmg: 2 },
  special: { hp: 6, speed: 2.6, radius: 0.65, dmg: 1 },
};

// 12 rounds, ramping; the last one is the map boss
type WaveSpec = Partial<Record<Kind, number>>;
const WAVES: WaveSpec[] = [
  { drifter: 5 },
  { drifter: 6, shooter: 1, runner: 1 },
  { drifter: 6, brute: 1, shooter: 2, specter: 1, special: 1 },
  { drifter: 6, brute: 2, shooter: 3, runner: 2, bomber: 1, special: 1 },
  { drifter: 7, brute: 2, shooter: 3, runner: 3, specter: 2, vanguard: 1, special: 2 },
  { drifter: 7, brute: 3, shooter: 3, runner: 4, bomber: 1, vanguard: 1, special: 2 },
  { drifter: 8, brute: 3, shooter: 4, runner: 4, specter: 3, bomber: 2, vanguard: 1, special: 2 },
  { drifter: 8, brute: 4, shooter: 5, runner: 5, specter: 3, bomber: 2, vanguard: 2, special: 3 },
  { drifter: 9, brute: 5, shooter: 5, runner: 6, specter: 4, bomber: 2, vanguard: 2, special: 3 },
  { drifter: 9, brute: 5, shooter: 6, runner: 7, specter: 4, bomber: 3, vanguard: 3, special: 3 },
  { drifter: 10, brute: 6, shooter: 7, runner: 8, specter: 5, bomber: 3, vanguard: 3, special: 4 },
  { boss: 1, drifter: 6, brute: 3, shooter: 3, runner: 3, specter: 2, bomber: 1, vanguard: 1, special: 1 },
];
const MAX_ENEMIES = 110;
const MARK_TIME = 2; // seconds a red X flashes before an enemy appears
const MAX_HP = 10;
const SHOP_KEYS = ["KeyZ", "KeyX", "KeyC"];


const BULLET_SPEED = 22;
const ENEMY_BULLET_SPEED = 11;
const TURN_SPEED = 2.4;
const MAX_BULLETS = 90;
const SPEED = 7;
const EYE = 1.6;

const FORWARD = new THREE.Vector3();
const RIGHT = new THREE.Vector3();
const MOVE = new THREE.Vector3();

function Obstacle({ b, theme }: { b: Block; theme: Theme }) {
  const color = b.tone > 0.6 ? theme.blocks[0] : b.tone > 0.3 ? theme.blocks[1] : theme.blocks[2];
  const shape = theme.blockShape;
  const glow = theme.enemyBullet;

  if (shape === "tree") {
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

  if (shape === "crystal") {
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
        {[0, 1].map((i) => (
          <mesh key={i} position={[Math.sin(i * 2.2) * 0.9, b.h * 0.3, Math.cos(i * 2.2) * 0.9]} rotation-z={0.3 - i * 0.6} castShadow>
            <coneGeometry args={[0.28, b.h * 0.7, 5]} />
            <meshLambertMaterial color={theme.blocks[1]} flatShading />
          </mesh>
        ))}
      </group>
    );
  }

  // DESERT: stepped sandstone monument with a bleached bone arch
  if (shape === "monument") {
    return (
      <group position={[b.x, 0, b.z]} rotation-y={b.tone * 1.2}>
        <mesh position-y={b.h * 0.3} castShadow receiveShadow>
          <boxGeometry args={[BLOCK, b.h * 0.6, BLOCK]} />
          <meshLambertMaterial color={color} flatShading />
        </mesh>
        <mesh position-y={b.h * 0.75} castShadow>
          <boxGeometry args={[BLOCK * 0.72, b.h * 0.3, BLOCK * 0.72]} />
          <meshLambertMaterial color={theme.blocks[1]} flatShading />
        </mesh>
        <mesh position-y={b.h * 0.98} castShadow>
          <boxGeometry args={[BLOCK * 0.42, b.h * 0.16, BLOCK * 0.42]} />
          <meshLambertMaterial color={theme.blocks[2]} flatShading />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 1.15, 0.45, 0.2]} rotation-z={s * 0.35}>
            <cylinderGeometry args={[0.07, 0.09, 1, 5]} />
            <meshLambertMaterial color="#e8dcc0" flatShading />
          </mesh>
        ))}
      </group>
    );
  }

  // VOLCANO: hexagonal basalt columns split by a magma seam
  if (shape === "basalt") {
    return (
      <group position={[b.x, 0, b.z]} rotation-y={b.tone * Math.PI}>
        {[[-0.45, -0.3, 1], [0.5, 0.35, 0.78], [0.1, -0.6, 0.6]].map(([dx, dz, f], i) => (
          <mesh key={i} position={[dx as number, (b.h * (f as number)) / 2, dz as number]} castShadow receiveShadow>
            <cylinderGeometry args={[0.55, 0.6, b.h * (f as number), 6]} />
            <meshLambertMaterial color={i === 1 ? theme.blocks[1] : color} flatShading />
          </mesh>
        ))}
        <mesh position={[0, 0.06, 0]} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[0.7, 1.15, 12]} />
          <meshBasicMaterial color={theme.boss.glow} fog={false} />
        </mesh>
        <mesh position={[-0.45, b.h + 0.18, -0.3]}>
          <sphereGeometry args={[0.2, 8, 6]} />
          <meshBasicMaterial color={theme.boss.glow} fog={false} />
        </mesh>
      </group>
    );
  }

  // BADLANDS: layered flat-topped butte with a rusted strut
  if (shape === "butte") {
    return (
      <group position={[b.x, 0, b.z]} rotation-y={b.tone * 2}>
        {[0, 1, 2].map((i) => (
          <mesh key={i} position-y={b.h * (0.18 + i * 0.28)} castShadow receiveShadow>
            <cylinderGeometry args={[1.25 - i * 0.22, 1.35 - i * 0.22, b.h * 0.3, 7]} />
            <meshLambertMaterial color={i === 1 ? theme.blocks[1] : color} flatShading />
          </mesh>
        ))}
        <mesh position={[0.9, b.h * 0.6, 0.5]} rotation-z={0.4} castShadow>
          <boxGeometry args={[0.1, b.h * 1.1, 0.1]} />
          <meshLambertMaterial color={theme.wall} flatShading />
        </mesh>
      </group>
    );
  }

  // BLOSSOM: tiered stone pagoda lantern
  if (shape === "pagoda") {
    return (
      <group position={[b.x, 0, b.z]} rotation-y={b.tone * 1.5}>
        <mesh position-y={0.25} castShadow receiveShadow>
          <boxGeometry args={[1.5, 0.5, 1.5]} />
          <meshLambertMaterial color={theme.wall} flatShading />
        </mesh>
        <mesh position-y={b.h * 0.45} castShadow>
          <cylinderGeometry args={[0.42, 0.5, b.h * 0.7, 8]} />
          <meshLambertMaterial color="#d8d2c4" flatShading />
        </mesh>
        {[0.55, 0.9].map((f, i) => (
          <mesh key={i} position-y={b.h * f} castShadow>
            <coneGeometry args={[1.15 - i * 0.25, 0.45, 4]} />
            <meshLambertMaterial color={color} flatShading />
          </mesh>
        ))}
        <mesh position-y={b.h * 0.68}>
          <boxGeometry args={[0.36, 0.4, 0.36]} />
          <meshBasicMaterial color="#ffd98a" fog={false} />
        </mesh>
        <mesh position-y={b.h + 0.3}>
          <sphereGeometry args={[0.16, 8, 6]} />
          <meshLambertMaterial color={theme.blocks[2]} flatShading />
        </mesh>
      </group>
    );
  }

  // DEEP ICE: fractured iceberg slabs
  if (shape === "berg") {
    return (
      <group position={[b.x, 0, b.z]} rotation-y={b.tone * Math.PI}>
        <mesh position-y={b.h * 0.42} rotation-y={0.4} castShadow receiveShadow>
          <boxGeometry args={[1.7, b.h * 0.85, 1.4]} />
          <meshLambertMaterial color={color} flatShading />
        </mesh>
        <mesh position={[0.35, b.h * 0.8, -0.2]} rotation-z={0.45} rotation-y={0.8} castShadow>
          <boxGeometry args={[1.1, b.h * 0.6, 0.9]} />
          <meshLambertMaterial color={theme.blocks[0]} flatShading />
        </mesh>
        <mesh position={[-0.6, b.h * 0.35, 0.6]} rotation-z={-0.3} castShadow>
          <coneGeometry args={[0.4, b.h * 0.9, 4]} />
          <meshLambertMaterial color="#f2fbff" flatShading />
        </mesh>
      </group>
    );
  }

  // OCEAN: branching bioluminescent coral
  if (shape === "coral") {
    return (
      <group position={[b.x, 0, b.z]} rotation-y={b.tone * Math.PI * 2}>
        <mesh position-y={0.28} castShadow receiveShadow>
          <sphereGeometry args={[0.85, 8, 6]} />
          <meshLambertMaterial color={theme.blocks[2]} flatShading />
        </mesh>
        {[0, 1, 2].map((i) => {
          const a = (i / 3) * Math.PI * 2 + b.tone;
          return (
            <group key={i} position={[Math.cos(a) * 0.4, 0, Math.sin(a) * 0.4]} rotation-z={Math.cos(a) * 0.3} rotation-x={-Math.sin(a) * 0.3}>
              <mesh position-y={b.h * 0.45} castShadow>
                <cylinderGeometry args={[0.13, 0.26, b.h * 0.9, 6]} />
                <meshLambertMaterial color={color} flatShading />
              </mesh>
              <mesh position-y={b.h * 0.92}>
                <sphereGeometry args={[0.26, 8, 6]} />
                <meshBasicMaterial color={glow} fog={false} />
              </mesh>
            </group>
          );
        })}
      </group>
    );
  }

  // CYBERPUNK: server mainframe tower with lit circuit strips
  if (shape === "server") {
    return (
      <group position={[b.x, 0, b.z]} rotation-y={b.tone * 1.6}>
        <mesh position-y={b.h / 2} castShadow receiveShadow>
          <boxGeometry args={[1.5, b.h, 1.2]} />
          <meshLambertMaterial color={color} flatShading />
        </mesh>
        {[0.3, 0.55, 0.8].map((f, i) => (
          <mesh key={i} position={[0, b.h * f, 0.62]}>
            <boxGeometry args={[1.1, 0.07, 0.04]} />
            <meshBasicMaterial color={i % 2 ? theme.grid[0] : theme.grid[1]} fog={false} />
          </mesh>
        ))}
        <mesh position-y={b.h + 0.12} castShadow>
          <boxGeometry args={[1.6, 0.24, 1.3]} />
          <meshLambertMaterial color={theme.wall} flatShading />
        </mesh>
        <mesh position-y={b.h + 0.5} rotation-x={Math.PI / 2}>
          <torusGeometry args={[0.3, 0.06, 6, 12]} />
          <meshBasicMaterial color={theme.grid[1]} fog={false} />
        </mesh>
      </group>
    );
  }

  // INDUSTRIAL: chemical vat with hazard band and pipework
  if (shape === "vat") {
    return (
      <group position={[b.x, 0, b.z]} rotation-y={b.tone * 3}>
        <mesh position-y={b.h * 0.45} castShadow receiveShadow>
          <cylinderGeometry args={[0.95, 0.95, b.h * 0.9, 10]} />
          <meshLambertMaterial color={color} flatShading />
        </mesh>
        <mesh position-y={b.h * 0.55}>
          <cylinderGeometry args={[0.98, 0.98, 0.3, 10]} />
          <meshLambertMaterial color="#2b2118" flatShading />
        </mesh>
        <mesh position-y={b.h * 0.92}>
          <cylinderGeometry args={[0.8, 0.95, 0.24, 10]} />
          <meshBasicMaterial color={glow} fog={false} />
        </mesh>
        <mesh position={[0.95, b.h * 0.3, 0]} rotation-z={Math.PI / 2}>
          <cylinderGeometry args={[0.12, 0.12, 0.9, 8]} />
          <meshLambertMaterial color={theme.blocks[1]} flatShading />
        </mesh>
        <mesh position={[0, 0.12, 0]} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[1.05, 1.3, 12]} />
          <meshBasicMaterial color={glow} fog={false} />
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

const Level = memo(function Level({ blocks, theme }: { blocks: Block[]; theme: Theme }) {
  // deterministic scatter so the arena dressing matches for everyone in co-op
  const debris = blocks.flatMap((b, i) => {
    if (i % 2 === 1) return [];
    const a = (i * 2.399) % (Math.PI * 2);
    const r = 1.5 + ((i * 37) % 9) * 0.12;
    return [{
      key: `d${i}`,
      x: b.x + Math.cos(a) * r,
      z: b.z + Math.sin(a) * r,
      s: 0.22 + ((i * 13) % 5) * 0.06,
      rot: a,
    }];
  });
  const posts = blocks.filter((_, i) => i % 3 === 0).slice(0, 14);
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
      {/* loose rubble around the cover, so the floor is not a bare plane */}
      {debris.map((d) => (
        <mesh key={d.key} position={[d.x, d.s * 0.5, d.z]} rotation={[d.rot, d.rot * 2, 0]} receiveShadow>
          <dodecahedronGeometry args={[d.s, 0]} />
          <meshLambertMaterial color={theme.blocks[2]} flatShading />
        </mesh>
      ))}
      {/* marker posts with a lit cap dotted through the arena */}
      {posts.map((b, i) => (
        <group key={`p${i}`} position={[b.x + 1.9, 0, b.z - 1.9]}>
          <mesh position-y={0.55} castShadow>
            <cylinderGeometry args={[0.07, 0.11, 1.1, 6]} />
            <meshLambertMaterial color={theme.wall} flatShading />
          </mesh>
          <mesh position-y={1.18}>
            <sphereGeometry args={[0.13, 8, 6]} />
            <meshBasicMaterial color={theme.enemy.drifter.eye} fog={false} />
          </mesh>
        </group>
      ))}
      {([
        [0, -HALF, ARENA, 1],
        [0, HALF, ARENA, 1],
        [-HALF, 0, 1, ARENA],
        [HALF, 0, 1, ARENA],
      ] as const).map(([x, z, w, d], i) => (
        <group key={`w${i}`}>
          <mesh position={[x, 2, z]}>
            <boxGeometry args={[w, 4, d]} />
            <meshLambertMaterial color={theme.wall} flatShading />
          </mesh>
          {/* capping rail + a darker plinth give the walls some depth */}
          <mesh position={[x, 4.15, z]}>
            <boxGeometry args={[w + 0.3, 0.3, d + 0.3]} />
            <meshLambertMaterial color={theme.blocks[2]} flatShading />
          </mesh>
          <mesh position={[x, 0.35, z]}>
            <boxGeometry args={[w + 0.45, 0.7, d + 0.45]} />
            <meshLambertMaterial color={theme.blocks[2]} flatShading />
          </mesh>
        </group>
      ))}
      {/* corner beacons */}
      {([[-HALF + 1.2, -HALF + 1.2], [HALF - 1.2, -HALF + 1.2], [-HALF + 1.2, HALF - 1.2], [HALF - 1.2, HALF - 1.2]] as const).map(([x, z], i) => (
        <group key={`c${i}`} position={[x, 0, z]}>
          <mesh position-y={1.4} castShadow>
            <cylinderGeometry args={[0.18, 0.3, 2.8, 6]} />
            <meshLambertMaterial color={theme.wall} flatShading />
          </mesh>
          <mesh position-y={3}>
            <octahedronGeometry args={[0.32, 0]} />
            <meshBasicMaterial color={theme.enemyBullet} fog={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
});

function BossBody({ theme }: { theme: Theme }) {
  const b = theme.boss;
  if (b.shape === "plough") return <PloughBody theme={theme} />;
  const skin = <meshLambertMaterial color={b.body} flatShading />;
  const limb = <meshLambertMaterial color={b.limb} flatShading />;
  const glow = <meshBasicMaterial color={b.glow} fog={false} />;
  return (
    <group>
      {/* torso + head shared by every boss, dressed differently per map */}
      <mesh position-y={1.35} castShadow><boxGeometry args={[1.7, 2, 1.2]} />{skin}</mesh>
      <mesh position-y={2.75} castShadow><boxGeometry args={[1, 0.8, 0.9]} />{skin}</mesh>
      <mesh position={[-0.24, 2.8, 0.47]}><boxGeometry args={[0.22, 0.14, 0.06]} />{glow}</mesh>
      <mesh position={[0.24, 2.8, 0.47]}><boxGeometry args={[0.22, 0.14, 0.06]} />{glow}</mesh>
      <mesh position={[-0.95, 1.2, 0]} castShadow><boxGeometry args={[0.35, 1.6, 0.4]} />{limb}</mesh>
      <mesh position={[0.45, 0.2, 0]} castShadow><boxGeometry args={[0.45, 0.6, 0.5]} />{limb}</mesh>
      <mesh position={[-0.45, 0.2, 0]} castShadow><boxGeometry args={[0.45, 0.6, 0.5]} />{limb}</mesh>

      {b.shape === "yeti" && (<>
        {[-0.5, 0.5].map((x) => (
          <mesh key={x} position={[x, 3.15, 0]} rotation-z={x * 0.4}><coneGeometry args={[0.14, 0.7, 5]} />{glow}</mesh>
        ))}
        <mesh position-y={1.5} castShadow><sphereGeometry args={[1.05, 8, 6]} />{skin}</mesh>
      </>)}
      {b.shape === "golem" && (<>
        <mesh position-y={2.2} rotation-y={0.4} castShadow><boxGeometry args={[2, 0.35, 1.4]} />{limb}</mesh>
        <mesh position={[0, 3.35, 0]}><coneGeometry args={[0.5, 0.7, 4]} />{glow}</mesh>
      </>)}
      {b.shape === "treant" && (<>
        <mesh position-y={3.3} castShadow><sphereGeometry args={[1.2, 7, 5]} /><meshLambertMaterial color={b.weapon} flatShading /></mesh>
        {[0, 1, 2].map((i) => (
          <mesh key={i} position={[Math.sin(i * 2) * 0.8, 3.9, Math.cos(i * 2) * 0.8]}><sphereGeometry args={[0.22, 6, 6]} />{glow}</mesh>
        ))}
      </>)}
      {b.shape === "magma" && (<>
        <mesh position={[0, 1.5, 0.62]}><boxGeometry args={[0.7, 0.9, 0.1]} />{glow}</mesh>
        {[-0.6, 0, 0.6].map((x) => (
          <mesh key={x} position={[x, 3.2, -0.2]}><coneGeometry args={[0.16, 0.6, 4]} />{glow}</mesh>
        ))}
      </>)}
      {b.shape === "mech" && (<>
        {[-0.5, 0.5].map((x) => (
          <mesh key={x} position={[x, 3.3, -0.35]} rotation-x={0.2}><cylinderGeometry args={[0.13, 0.16, 0.8, 8]} /><meshLambertMaterial color={b.weapon} flatShading /></mesh>
        ))}
        <mesh position={[0, 1.6, 0.64]} rotation-x={Math.PI / 2}><torusGeometry args={[0.35, 0.08, 6, 14]} />{glow}</mesh>
      </>)}
      {b.shape === "ronin" && (<>
        <mesh position={[0, 3.25, -0.1]} rotation-x={-0.25}><coneGeometry args={[0.75, 0.45, 6]} /><meshLambertMaterial color={b.weapon} flatShading /></mesh>
        <mesh position={[0, 3.6, -0.1]}><coneGeometry args={[0.12, 0.6, 4]} />{glow}</mesh>
        <mesh position={[0, 1.45, 0.63]}><boxGeometry args={[1.2, 0.18, 0.08]} />{glow}</mesh>
      </>)}
      {b.shape === "drake" && (<>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 1.5, 2.2, -0.4]} rotation-z={s * 0.5} castShadow>
            <boxGeometry args={[1.8, 0.12, 1.1]} /><meshLambertMaterial color={b.weapon} flatShading />
          </mesh>
        ))}
        {[0.4, 1.1, 1.8].map((y) => (
          <mesh key={y} position={[0, y + 0.6, -0.65]}><coneGeometry args={[0.16, 0.5, 4]} />{glow}</mesh>
        ))}
      </>)}
    </group>
  );
}

// Map-exclusive special enemies: one intricate model per biome.
function SpecialModel({ theme, data }: { theme: Theme; data: Enemy }) {
  const sp = theme.special;
  const spin = useRef<THREE.Group>(null);
  const part = useRef<THREE.Group>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (spin.current) spin.current.rotation.y = t * (sp.type === "hacker" ? 6 : 1.4);
    if (part.current) {
      if (sp.type === "stalker") part.current.rotation.x = -0.6 + Math.sin(t * 6) * 0.25;
      else if (sp.type === "spore") part.current.scale.setScalar(1 + Math.sin(t * 3) * 0.12);
      else if (sp.type === "leaper") part.current.position.y = (data.aux ?? 0) > 0 ? 1.4 : Math.abs(Math.sin(t * 5)) * 0.15;
      else if (sp.type === "wyrm") part.current.rotation.z = Math.sin(t * 2) * 0.3;
      else part.current.rotation.z = Math.sin(t * 4) * 0.15;
    }
  });
  const B = <meshLambertMaterial color={sp.body} flatShading />;
  const A = <meshLambertMaterial color={sp.accent} flatShading />;
  const G = <meshBasicMaterial color={sp.glow} />;
  return (
    <group>
      {sp.type === "stalker" && (<group>
        <mesh position-y={0.45} castShadow><boxGeometry args={[0.9, 0.35, 1.3]} />{B}</mesh>
        <mesh position={[0, 0.65, 0.2]}><boxGeometry args={[0.6, 0.2, 0.7]} />{A}</mesh>
        {[-0.55, 0.55].map((x) => [-0.4, 0, 0.4].map((z) => (
          <mesh key={`${x}${z}`} position={[x, 0.25, z]} rotation-z={x > 0 ? -0.8 : 0.8}><boxGeometry args={[0.5, 0.07, 0.07]} />{A}</mesh>
        )))}
        {[-0.35, 0.35].map((x) => (
          <group key={`p${x}`} position={[x, 0.45, 0.75]}>
            <mesh><boxGeometry args={[0.14, 0.14, 0.4]} />{A}</mesh>
            <mesh position={[x * 0.3, 0, 0.25]} rotation-y={x * 1.2}><coneGeometry args={[0.08, 0.3, 4]} />{B}</mesh>
          </group>
        ))}
        <group ref={part} position={[0, 0.6, -0.6]}>
          {[0, 1, 2].map((i) => (
            <mesh key={i} position={[0, 0.25 + i * 0.3, -0.1 * i]}><sphereGeometry args={[0.16 - i * 0.02, 6, 5]} />{B}</mesh>
          ))}
          <mesh position={[0, 1.2, 0.15]} rotation-x={1.2}><coneGeometry args={[0.08, 0.35, 5]} />{G}</mesh>
        </group>
        {[-0.15, 0.15].map((x) => <mesh key={`e${x}`} position={[x, 0.7, 0.58]}><sphereGeometry args={[0.05, 6, 6]} />{G}</mesh>)}
      </group>)}
      {sp.type === "mite" && (<group>
        <mesh position-y={0.55} castShadow><octahedronGeometry args={[0.5, 0]} />{B}</mesh>
        <mesh position-y={0.55}><octahedronGeometry args={[0.22, 0]} />{G}</mesh>
        {[0, 1, 2, 3, 4, 5].map((i) => {
          const a = (i / 6) * Math.PI * 2;
          return (
            <mesh key={i} position={[Math.sin(a) * 0.55, 0.3, Math.cos(a) * 0.55]} rotation={[Math.cos(a) * 0.9, 0, -Math.sin(a) * 0.9]}>
              <coneGeometry args={[0.06, 0.7, 4]} />{A}
            </mesh>
          );
        })}
        {[-0.2, 0, 0.2].map((x) => <mesh key={`c${x}`} position={[x, 0.95, 0]} rotation-z={x * 2}><coneGeometry args={[0.07, 0.35, 4]} />{B}</mesh>)}
        {[-0.12, 0.12].map((x) => <mesh key={`e${x}`} position={[x, 0.62, 0.42]}><sphereGeometry args={[0.05, 6, 6]} />{G}</mesh>)}
      </group>)}
      {sp.type === "spore" && (<group>
        {[0, 1, 2, 3, 4].map((i) => {
          const a = (i / 5) * Math.PI * 2;
          return <mesh key={i} position={[Math.sin(a) * 0.5, 0.1, Math.cos(a) * 0.5]} rotation={[Math.cos(a) * 1.2, 0, -Math.sin(a) * 1.2]}><cylinderGeometry args={[0.04, 0.1, 0.8, 5]} />{A}</mesh>;
        })}
        <mesh position-y={0.6} castShadow><cylinderGeometry args={[0.25, 0.4, 0.8, 7]} />{A}</mesh>
        <group ref={part} position-y={1.2}>
          <mesh><sphereGeometry args={[0.45, 9, 7]} />{B}</mesh>
          {[0, 1, 2, 3, 4, 5].map((i) => {
            const a = (i / 6) * Math.PI * 2;
            return <mesh key={i} position={[Math.sin(a) * 0.42, 0.1, Math.cos(a) * 0.42]} rotation={[Math.cos(a) * 0.8, 0, -Math.sin(a) * 0.8]}><coneGeometry args={[0.16, 0.5, 4]} />{A}</mesh>;
          })}
          {[0, 1, 2, 3].map((i) => <mesh key={`g${i}`} position={[Math.sin(i * 1.6) * 0.3, 0.3, Math.cos(i * 1.6) * 0.3]}><sphereGeometry args={[0.07, 6, 6]} />{G}</mesh>)}
        </group>
      </group>)}
      {sp.type === "pyre" && (<group position-y={1.2}>
        <mesh castShadow><sphereGeometry args={[0.45, 12, 10]} />{G}</mesh>
        <group ref={spin}>
          {[0, 1, 2, 3].map((i) => {
            const a = (i / 4) * Math.PI * 2;
            return <mesh key={i} position={[Math.sin(a) * 0.6, 0, Math.cos(a) * 0.6]} rotation-y={a}><boxGeometry args={[0.5, 0.8, 0.12]} />{B}</mesh>;
          })}
        </group>
        <group ref={part}>
          {[-1, 1].map((y) => <mesh key={y} position-y={y * 0.55} rotation-x={Math.PI / 2}><torusGeometry args={[0.35, 0.06, 5, 10]} />{A}</mesh>)}
        </group>
        <mesh position-y={-0.9}><coneGeometry args={[0.2, 0.5, 6]} />{G}</mesh>
      </group>)}
      {sp.type === "leaper" && (<group ref={part}>
        <mesh position-y={1.1} castShadow><boxGeometry args={[0.8, 0.6, 0.7]} />{B}</mesh>
        <mesh position={[0, 1.2, 0.36]}><sphereGeometry args={[0.1, 8, 8]} />{G}</mesh>
        <mesh position={[0, 1.45, 0]}><boxGeometry args={[0.5, 0.15, 0.5]} />{A}</mesh>
        {[-0.3, 0.3].map((x) => (
          <group key={x} position={[x, 0.5, 0]}>
            <mesh rotation-x={0.4}><cylinderGeometry args={[0.07, 0.07, 0.6, 6]} />{A}</mesh>
            <mesh position-y={-0.25}><torusGeometry args={[0.1, 0.03, 4, 8]} />{A}</mesh>
            <mesh position={[0, -0.4, 0.1]}><boxGeometry args={[0.2, 0.08, 0.35]} />{B}</mesh>
          </group>
        ))}
        {[-0.5, 0.5].map((x) => (
          <mesh key={`s${x}`} position={[x, 1.1, 0.35]} rotation-z={Math.PI / 2}><cylinderGeometry args={[0.28, 0.28, 0.04, 10]} />{A}</mesh>
        ))}
      </group>)}
      {sp.type === "shinobi" && (<group>
        <mesh position-y={0.9} castShadow><cylinderGeometry args={[0.2, 0.32, 1.1, 7]} />{B}</mesh>
        <mesh position-y={0.9}><torusGeometry args={[0.26, 0.05, 4, 10]} />{A}</mesh>
        <mesh position-y={1.65}><sphereGeometry args={[0.25, 8, 7]} />{B}</mesh>
        <mesh position={[0, 1.66, 0.2]}><boxGeometry args={[0.36, 0.08, 0.1]} />{A}</mesh>
        {[-0.08, 0.08].map((x) => <mesh key={x} position={[x, 1.68, 0.26]}><boxGeometry args={[0.05, 0.03, 0.02]} />{G}</mesh>)}
        {[-0.12, 0.12].map((x) => <mesh key={`r${x}`} position={[x, 1.95, -0.15]} rotation-x={-0.6}><boxGeometry args={[0.04, 0.6, 0.02]} />{A}</mesh>)}
        {[-0.3, 0.3].map((x) => <mesh key={`l${x}`} position={[x * 0.5, 0.25, 0]}><cylinderGeometry args={[0.06, 0.05, 0.5, 5]} />{A}</mesh>)}
        <group ref={spin} position-y={1.1}>
          {[-1, 1].map((sd) => (
            <mesh key={sd} position={[sd * 0.6, 0, 0]} rotation-x={Math.PI / 2}><coneGeometry args={[0.07, 0.45, 4]} />{G}</mesh>
          ))}
        </group>
      </group>)}
      {sp.type === "wyrm" && (<group ref={part} position-y={1.6}>
        {[0, 1, 2, 3, 4].map((i) => (
          <mesh key={i} position={[Math.sin(i * 0.9) * 0.25, -i * 0.05, -i * 0.38]}><icosahedronGeometry args={[0.3 - i * 0.04, 0]} />{i === 0 ? B : A}</mesh>
        ))}
        {[0, 1, 2, 3].map((i) => <mesh key={`f${i}`} position={[Math.sin(i * 0.9) * 0.25, 0.25 - i * 0.05, -i * 0.38]}><coneGeometry args={[0.07, 0.3, 4]} />{B}</mesh>)}
        {[-0.12, 0.12].map((x) => <mesh key={x} position={[x, 0.08, 0.26]}><sphereGeometry args={[0.05, 6, 6]} />{G}</mesh>)}
        <mesh position={[0, -0.05, 0.3]} rotation-x={Math.PI / 2}><coneGeometry args={[0.1, 0.25, 6]} />{G}</mesh>
      </group>)}
      {sp.type === "nautilus" && (<group position-y={1.1}>
        <mesh castShadow><sphereGeometry args={[0.6, 12, 10]} />{B}</mesh>
        {[0, 1, 2, 3, 4].map((i) => (
          <mesh key={i} rotation-y={Math.PI / 2} rotation-x={i * 0.5} position-z={-0.05}><torusGeometry args={[0.6, 0.05, 4, 16, Math.PI]} />{A}</mesh>
        ))}
        <mesh position={[0, 0, 0.55]}><sphereGeometry args={[0.18, 10, 8]} />{G}</mesh>
        <group ref={part}>
          {[0, 1, 2, 3].map((i) => {
            const a = (i / 4) * Math.PI * 2;
            return <mesh key={i} position={[Math.sin(a) * 0.35, -0.6, 0.3 + Math.cos(a) * 0.15]}><cylinderGeometry args={[0.04, 0.07, 0.6, 5]} />{A}</mesh>;
          })}
        </group>
      </group>)}
      {sp.type === "hacker" && (<group position-y={1.7}>
        <mesh castShadow><octahedronGeometry args={[0.4, 0]} />{B}</mesh>
        <mesh position-z={0.3}><boxGeometry args={[0.3, 0.1, 0.1]} />{G}</mesh>
        <group ref={spin}>
          {[-0.65, 0.65].map((x) => (
            <group key={x} position-x={x}>
              <mesh rotation-x={Math.PI / 2}><torusGeometry args={[0.28, 0.04, 4, 14]} />{A}</mesh>
              <mesh><boxGeometry args={[0.5, 0.02, 0.06]} />{A}</mesh>
            </group>
          ))}
        </group>
        <mesh position-y={-0.55} rotation-x={Math.PI}><coneGeometry args={[0.35, 0.5, 8, 1, true]} /><meshBasicMaterial color={sp.glow} transparent opacity={0.35} /></mesh>
        <mesh position-y={-0.8} rotation-x={Math.PI / 2}><ringGeometry args={[0.25, 0.32, 16]} />{G}</mesh>
      </group>)}
      {sp.type === "bile" && (<group>
        <mesh position-y={1} castShadow><boxGeometry args={[0.8, 0.9, 0.7]} />{B}</mesh>
        <mesh position={[0, 1.6, 0.1]}><sphereGeometry args={[0.3, 8, 7]} />{A}</mesh>
        <mesh position={[0, 1.55, 0.45]} rotation-x={Math.PI / 2}><cylinderGeometry args={[0.1, 0.22, 0.4, 8]} />{A}</mesh>
        <mesh position={[0, 1.55, 0.66]} rotation-x={Math.PI / 2}><torusGeometry args={[0.2, 0.04, 4, 10]} />{G}</mesh>
        {[-0.22, 0.22].map((x) => (
          <group key={x} position={[x, 1.2, -0.5]}>
            <mesh><cylinderGeometry args={[0.16, 0.16, 0.8, 8]} /><meshLambertMaterial color={sp.glow} transparent opacity={0.8} /></mesh>
            <mesh position-y={0.45}><cylinderGeometry args={[0.1, 0.16, 0.12, 8]} />{A}</mesh>
          </group>
        ))}
        {[0.8, 1.2].map((y) => <mesh key={y} position={[0, y, 0.36]}><boxGeometry args={[0.82, 0.08, 0.02]} />{A}</mesh>)}
        {[-0.25, 0.25].map((x) => <mesh key={`l${x}`} position={[x, 0.3, 0]}><boxGeometry args={[0.22, 0.6, 0.3]} />{A}</mesh>)}
      </group>)}
    </group>
  );
}

const EnemyMesh = memo(function EnemyMesh({ data, theme }: { data: Enemy; theme: Theme }) {
  const c = theme.enemy;
  const [kind, setKind] = useState(data.kind);
  const ref = useRef<THREE.Group>(null);
  const drifter = useRef<THREE.Group>(null);
  const brute = useRef<THREE.Group>(null);
  const shooter = useRef<THREE.Group>(null);
  const specter = useRef<THREE.Group>(null);
  const bomber = useRef<THREE.Group>(null);
  const vanguard = useRef<THREE.Group>(null);
  const bossGrp = useRef<THREE.Group>(null);
  const club = useRef<THREE.Group>(null);
  const bossArm = useRef<THREE.Group>(null);
  const aura = useRef<THREE.Group>(null);
  useFrame((state) => {
    const g = ref.current;
    if (!g) return;
    g.visible = data.alive;
    if (!data.alive) return;
    if (data.kind !== kind) setKind(data.kind);
    const t = state.clock.elapsedTime;
    const k = data.kind;
    const heavy = k === "brute" || k === "boss" || k === "vanguard";
    const bob = heavy ? 0 : Math.sin(t * (k === "runner" ? 10 : 4) + data.x) * (k === "specter" ? 0.22 : 0.08);
    g.position.set(data.x, bob + groundY(data.x, data.z), data.z);
    g.rotation.set(0, data.yaw ?? 0, 0); // same facing on every screen
    const base = k === "special" ? 1 : k === "boss" ? 1.6 : k === "runner" ? 0.6 : k === "vanguard" ? 1.05 : 1;
    g.scale.setScalar(base * (data.elite ? 1.6 : 1) * (data.flash > 0 ? 1.15 : 1));
    if (aura.current) {
      aura.current.visible = !!data.elite;
      aura.current.rotation.y = t * 1.2;
    }
    if (drifter.current) drifter.current.visible = k === "drifter" || k === "runner";
    if (brute.current) brute.current.visible = k === "brute";
    if (bossGrp.current) bossGrp.current.visible = k === "boss";
    if (shooter.current) shooter.current.visible = k === "shooter";
    if (specter.current) {
      specter.current.visible = k === "specter";
      specter.current.rotation.y = t * 1.6;
    }
    if (bomber.current) bomber.current.visible = k === "bomber";
    if (vanguard.current) vanguard.current.visible = k === "vanguard";
    if (drifter.current) drifter.current.rotation.y = k === "runner" ? t * 8 : 0;
    const swingRot = data.swing > 0 ? -1.4 + (1 - data.swing / 0.4) * 2.4 : -1.4;
    if (club.current) club.current.rotation.x = swingRot;
    if (bossArm.current) bossArm.current.rotation.x = swingRot;
  });
  return (
    <group ref={ref}>
      {/* event champion: gold halo + ground ring */}
      <group ref={aura} visible={false}>
        <mesh position-y={0.06} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[1.1, 1.35, 20]} />
          <meshBasicMaterial color="#ffd24a" fog={false} />
        </mesh>
        <mesh position-y={2.5} rotation-x={Math.PI / 2}>
          <torusGeometry args={[0.55, 0.08, 6, 16]} />
          <meshBasicMaterial color="#ffd24a" fog={false} />
        </mesh>
      </group>
      {/* DRIFTER / RUNNER: floating core inside a caged shell */}
      {(kind==="drifter"||kind==="runner") && (<group ref={drifter} position-y={0.9}>
        <mesh>
          <octahedronGeometry args={[0.8, 0]} />
          <meshLambertMaterial color={c.drifter.body} flatShading emissive={c.drifter.emissive} />
        </mesh>
        <mesh rotation-x={Math.PI / 2}>
          <torusGeometry args={[0.82, 0.07, 6, 12]} />
          <meshLambertMaterial color={c.brute.clubHead} flatShading />
        </mesh>
        <mesh rotation-z={Math.PI / 2}>
          <torusGeometry args={[0.7, 0.05, 6, 12]} />
          <meshLambertMaterial color={c.brute.club} flatShading />
        </mesh>
        <mesh position={[0, 0, 0.65]}>
          <sphereGeometry args={[0.15, 8, 8]} />
          <meshBasicMaterial color={c.drifter.eye} />
        </mesh>
        <mesh position={[0, 0, 0.72]} rotation-x={Math.PI / 2}>
          <torusGeometry args={[0.24, 0.04, 5, 10]} />
          <meshBasicMaterial color={c.drifter.eye} />
        </mesh>
        {[-0.55, 0.55].map((x) => (
          <mesh key={x} position={[x, -0.35, -0.2]} rotation-z={x * 0.5}>
            <coneGeometry args={[0.14, 0.4, 5]} />
            <meshLambertMaterial color={c.brute.club} flatShading />
          </mesh>
        ))}
        <mesh position={[0, -0.78, 0]}>
          <sphereGeometry args={[0.18, 8, 6]} />
          <meshBasicMaterial color={c.drifter.eye} />
        </mesh>
      </group> )}
      {/* BRUTE: hulking bruiser with layered plating and a power maul */}
      {(kind==="brute") && (<group ref={brute}>
        <mesh position-y={1.1}>
          <boxGeometry args={[1.4, 1.8, 1]} />
          <meshLambertMaterial color={c.brute.body} flatShading />
        </mesh>
        <mesh position={[0, 1.55, 0.53]}>
          <boxGeometry args={[1.05, 0.75, 0.16]} />
          <meshLambertMaterial color={c.brute.head} flatShading />
        </mesh>
        <mesh position={[0, 1.05, 0.58]}>
          <boxGeometry args={[0.3, 0.12, 0.06]} />
          <meshBasicMaterial color={c.brute.eye} />
        </mesh>
        {[-0.82, 0.82].map((x) => (
          <mesh key={x} position={[x, 1.85, 0]} rotation-z={x * 0.25}>
            <boxGeometry args={[0.5, 0.42, 1.05]} />
            <meshLambertMaterial color={c.brute.head} flatShading />
          </mesh>
        ))}
        {[-0.3, 0.3].map((x) => (
          <mesh key={`v${x}`} position={[x, 2.05, -0.5]}>
            <cylinderGeometry args={[0.1, 0.13, 0.5, 6]} />
            <meshLambertMaterial color={c.brute.club} flatShading />
          </mesh>
        ))}
        <mesh position={[0, 2.25, 0]}>
          <boxGeometry args={[0.8, 0.6, 0.7]} />
          <meshLambertMaterial color={c.brute.head} flatShading />
        </mesh>
        <mesh position={[0, 2.3, 0.36]}>
          <boxGeometry args={[0.55, 0.12, 0.05]} />
          <meshBasicMaterial color={c.brute.eye} />
        </mesh>
        {[-0.45, 0.45].map((x) => (
          <mesh key={`h${x}`} position={[x, 2.6, 0]} rotation-z={x * 0.6}>
            <coneGeometry args={[0.1, 0.42, 4]} />
            <meshLambertMaterial color={c.brute.clubHead} flatShading />
          </mesh>
        ))}
        {[-0.4, 0.4].map((x) => (
          <mesh key={`l${x}`} position={[x, 0.15, 0]}>
            <boxGeometry args={[0.42, 0.5, 0.52]} />
            <meshLambertMaterial color={c.brute.head} flatShading />
          </mesh>
        ))}
        <group ref={club} position={[0.85, 1.6, 0]}>
          <mesh position={[0, 0.7, 0]}>
            <boxGeometry args={[0.18, 1.4, 0.18]} />
            <meshLambertMaterial color={c.brute.club} />
          </mesh>
          <mesh position={[0, 1.45, 0]}>
            <boxGeometry args={[0.4, 0.4, 0.4]} />
            <meshLambertMaterial color={c.brute.clubHead} flatShading />
          </mesh>
          <mesh position={[0, 1.45, 0]}>
            <boxGeometry args={[0.46, 0.1, 0.46]} />
            <meshBasicMaterial color={c.brute.eye} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.28, 1.45, 0]} rotation-z={-s * Math.PI / 2}>
              <coneGeometry args={[0.13, 0.22, 4]} />
              <meshLambertMaterial color={c.brute.clubHead} flatShading />
            </mesh>
          ))}
        </group>
      </group> )}
      {(kind==="boss") && (<group ref={bossGrp}>
        <BossBody theme={theme} />
        <group ref={bossArm} position={[1.05, 1.9, 0]}>
          <mesh position={[0, 0.9, 0]}>
            <boxGeometry args={[0.24, 1.8, 0.24]} />
            <meshLambertMaterial color={theme.boss.limb} flatShading />
          </mesh>
          <mesh position={[0, 0.5, 0]}>
            <boxGeometry args={[0.36, 0.3, 0.36]} />
            <meshLambertMaterial color={theme.boss.weapon} flatShading />
          </mesh>
          <mesh position={[0, 1.95, 0]}>
            <boxGeometry args={[0.6, 0.6, 0.6]} />
            <meshLambertMaterial color={theme.boss.weapon} flatShading />
          </mesh>
          <mesh position={[0, 1.95, 0]}>
            <boxGeometry args={[0.66, 0.12, 0.66]} />
            <meshBasicMaterial color={theme.boss.glow} fog={false} />
          </mesh>
          <mesh position={[0, 2.42, 0]}>
            <coneGeometry args={[0.24, 0.45, 5]} />
            <meshLambertMaterial color={theme.boss.weapon} flatShading />
          </mesh>
        </group>
      </group> )}
      {/* SHOOTER: sensor-headed gunner on a tripod chassis */}
      {(kind==="shooter") && (<group ref={shooter} position-y={1.3}>
        <mesh>
          <cylinderGeometry args={[0.45, 0.6, 1.4, 6]} />
          <meshLambertMaterial color={c.shooter.body} flatShading />
        </mesh>
        <mesh position-y={0.62}>
          <cylinderGeometry args={[0.5, 0.42, 0.22, 6]} />
          <meshLambertMaterial color={c.shooter.barrel} flatShading />
        </mesh>
        <mesh position-y={0.8}>
          <sphereGeometry args={[0.3, 8, 6]} />
          <meshLambertMaterial color={c.shooter.barrel} flatShading />
        </mesh>
        <mesh position={[0, 0.82, 0.26]}>
          <boxGeometry args={[0.36, 0.1, 0.06]} />
          <meshBasicMaterial color={c.shooter.eye} />
        </mesh>
        {[-0.5, 0.5].map((x) => (
          <mesh key={x} position={[x, 0.15, -0.1]} rotation-z={x * 0.35}>
            <boxGeometry args={[0.12, 0.8, 0.3]} />
            <meshLambertMaterial color={c.shooter.barrel} flatShading />
          </mesh>
        ))}
        {[-0.42, 0, 0.42].map((x) => (
          <mesh key={`leg${x}`} position={[x, -1.0, 0]} rotation-z={x * 0.5}>
            <cylinderGeometry args={[0.07, 0.05, 0.9, 5]} />
            <meshLambertMaterial color={c.shooter.barrel} flatShading />
          </mesh>
        ))}
        <mesh position={[0, 0.2, 0.55]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.12, 0.12, 0.7, 8]} />
          <meshLambertMaterial color={c.shooter.barrel} />
        </mesh>
        <mesh position={[0, 0.2, 0.86]}>
          <torusGeometry args={[0.16, 0.04, 5, 10]} />
          <meshBasicMaterial color={c.shooter.eye} />
        </mesh>
        <mesh position={[0, 0.5, 0.4]}>
          <sphereGeometry args={[0.12, 8, 8]} />
          <meshBasicMaterial color={c.shooter.eye} />
        </mesh>
      </group> )}
      {/* SPECTER: drifting, see-through wraith that blinks toward you */}
      {(kind==="specter") && (<group ref={specter} position-y={1.5}>
        <mesh>
          <coneGeometry args={[0.6, 1.8, 6]} />
          <meshLambertMaterial color={c.drifter.body} flatShading transparent opacity={0.55} emissive={c.drifter.emissive} />
        </mesh>
        <mesh position-y={-0.75} rotation-x={Math.PI}>
          <coneGeometry args={[0.45, 1.1, 6]} />
          <meshLambertMaterial color={c.drifter.body} flatShading transparent opacity={0.3} emissive={c.drifter.emissive} />
        </mesh>
        <mesh position-y={0.1} rotation-x={Math.PI / 2}>
          <torusGeometry args={[0.72, 0.05, 5, 14]} />
          <meshBasicMaterial color={c.shooter.eye} />
        </mesh>
        <mesh position-y={-0.3} rotation-x={Math.PI / 2}>
          <torusGeometry args={[0.5, 0.04, 5, 12]} />
          <meshBasicMaterial color={c.drifter.eye} />
        </mesh>
        <mesh position-y={0.55}>
          <sphereGeometry args={[0.2, 8, 6]} />
          <meshBasicMaterial color={c.drifter.eye} />
        </mesh>
        <mesh position={[0, 0.5, 0.35]}>
          <sphereGeometry args={[0.14, 8, 8]} />
          <meshBasicMaterial color={c.shooter.eye} />
        </mesh>
        <mesh position={[0, 0.5, -0.35]}>
          <sphereGeometry args={[0.1, 8, 8]} />
          <meshBasicMaterial color={c.shooter.eye} />
        </mesh>
      </group> )}
      {/* BOMBER: squat mortar unit that lobs shells over cover */}
      {(kind==="bomber") && (<group ref={bomber} position-y={0.8}>
        <mesh>
          <sphereGeometry args={[0.75, 8, 6]} />
          <meshLambertMaterial color={c.brute.body} flatShading />
        </mesh>
        <mesh position-y={0.1} rotation-x={Math.PI / 2}>
          <torusGeometry args={[0.76, 0.08, 6, 12]} />
          <meshLambertMaterial color={c.brute.head} flatShading />
        </mesh>
        <mesh position={[0, 0.75, 0.1]} rotation-x={-0.7}>
          <cylinderGeometry args={[0.24, 0.3, 0.9, 8]} />
          <meshLambertMaterial color={c.shooter.barrel} flatShading />
        </mesh>
        <mesh position={[0, 1.05, 0.33]} rotation-x={-0.7}>
          <torusGeometry args={[0.24, 0.05, 5, 10]} />
          <meshBasicMaterial color={theme.enemyBullet} />
        </mesh>
        {[-0.62, 0.62].map((x) => (
          <mesh key={x} position={[x, 0.35, -0.1]} rotation-z={x * 0.6}>
            <boxGeometry args={[0.24, 0.4, 0.34]} />
            <meshLambertMaterial color={c.brute.head} flatShading />
          </mesh>
        ))}
        {[-0.5, 0.5].map((x) => (
          <mesh key={`f${x}`} position={[x, -0.55, 0.2]} rotation-z={x * 0.5}>
            <cylinderGeometry args={[0.09, 0.14, 0.5, 5]} />
            <meshLambertMaterial color={c.shooter.barrel} flatShading />
          </mesh>
        ))}
        <mesh position={[0, 0.3, 0.6]}>
          <sphereGeometry args={[0.13, 8, 8]} />
          <meshBasicMaterial color={theme.enemyBullet} />
        </mesh>
      </group> )}
      {/* VANGUARD: armoured shield wall, tough from the front */}
      {kind === "special" && (theme.special.type === "skier" ? <SkierModel theme={theme} data={data} /> : <SpecialModel theme={theme} data={data} />)}
      {(kind==="vanguard") && (<group ref={vanguard}>
        <mesh position-y={1.2}>
          <boxGeometry args={[1.2, 2, 0.9]} />
          <meshLambertMaterial color={c.shooter.body} flatShading />
        </mesh>
        <mesh position={[0, 1.55, 0.48]}>
          <boxGeometry args={[0.95, 0.9, 0.14]} />
          <meshLambertMaterial color={c.brute.head} flatShading />
        </mesh>
        {[-0.72, 0.72].map((x) => (
          <mesh key={x} position={[x, 1.95, 0]} rotation-z={x * 0.3}>
            <boxGeometry args={[0.42, 0.38, 0.95]} />
            <meshLambertMaterial color={c.brute.head} flatShading />
          </mesh>
        ))}
        <mesh position={[0, 2.45, 0]}>
          <boxGeometry args={[0.7, 0.55, 0.7]} />
          <meshLambertMaterial color={c.brute.head} flatShading />
        </mesh>
        <mesh position={[0, 2.5, 0.37]}>
          <boxGeometry args={[0.45, 0.1, 0.05]} />
          <meshBasicMaterial color={c.brute.eye} />
        </mesh>
        <mesh position={[0, 2.78, 0]}>
          <boxGeometry args={[0.16, 0.34, 0.16]} />
          <meshLambertMaterial color={c.brute.clubHead} flatShading />
        </mesh>
        {[-0.38, 0.38].map((x) => (
          <mesh key={`lg${x}`} position={[x, 0.2, 0]}>
            <boxGeometry args={[0.38, 0.55, 0.48]} />
            <meshLambertMaterial color={c.brute.head} flatShading />
          </mesh>
        ))}
        <mesh position={[0, 1.3, 0.75]}>
          <boxGeometry args={[1.7, 2.1, 0.18]} />
          <meshLambertMaterial color={c.brute.clubHead} flatShading />
        </mesh>
        {[-0.6, 0.6].map((x) => (
          <mesh key={`r${x}`} position={[x, 1.3, 0.86]}>
            <boxGeometry args={[0.16, 2, 0.08]} />
            <meshLambertMaterial color={c.shooter.body} flatShading />
          </mesh>
        ))}
        {[-0.7, 0, 0.7].map((y) => (
          <mesh key={`b${y}`} position={[0, 1.3 + y, 0.86]} rotation-z={Math.PI / 4}>
            <boxGeometry args={[0.18, 0.18, 0.05]} />
            <meshBasicMaterial color={theme.enemyBullet} />
          </mesh>
        ))}
        <mesh position={[0, 1.3, 0.86]}>
          <boxGeometry args={[0.3, 0.9, 0.04]} />
          <meshBasicMaterial color={theme.enemyBullet} />
        </mesh>
      </group> )}
    </group>
  );
});

const BulletPool = memo(function BulletPool({
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
});

type Fx = { bounce?: number; pierce?: number; slow?: number; cluster?: number; chain?: number; burn?: number; knock?: number; mods?: number };
function fireInto(pool: Bullet[], pos: THREE.Vector3, vel: THREE.Vector3, life: number, damage = 1, color = "", size = 0, fx: Fx = {}) {
  const base = {
    life, active: true, damage, color, size,
    bounce: fx.bounce ?? 0, pierce: fx.pierce ?? 0, slow: fx.slow ?? 0, cluster: fx.cluster ?? 0, chain: fx.chain ?? 0,
    burn: fx.burn ?? 0, knock: fx.knock ?? 0, mods: fx.mods ?? 0,
  };
  const slot = pool.find((b) => !b.active);
  if (slot) {
    Object.assign(slot, base);
    slot.pos.copy(pos);
    slot.vel.copy(vel);
  } else if (pool.length < MAX_BULLETS) {
    pool.push({ pos: pos.clone(), vel: vel.clone(), ...base });
  }
}


/** Simple blocky gun model, different silhouette per weapon. */
type ModLooks = Partial<Record<"burst" | "incend" | "magnum" | "extmag" | "shred" | "laser" | "comp" | "suppr" | "exec" | "holster" | "bounty", boolean>>;
function GunModel({ w, mods }: { w: Weapon; mods?: ModLooks }) {
  const g = GUNS[w];
  const glow = <meshBasicMaterial color={g.color} fog={false} />;
  const body = <meshLambertMaterial color={g.body} />;
  const mg = w === "pistol" && mods?.magnum;
  return (
    <group>
      {w === "pistol" && (<>
        {/* magnum: longer gold-trimmed barrel */}
        <mesh position={[0, 0, mg ? -0.22 : -0.15]}><boxGeometry args={[0.1, 0.12, mg ? 0.5 : 0.35]} />{body}</mesh>
        <mesh position={[0, -0.12, -0.02]} rotation-x={0.3}><boxGeometry args={[0.08, 0.18, 0.1]} />{body}</mesh>
        <mesh position={[0, 0.07, mg ? -0.44 : -0.3]}><boxGeometry args={[0.03, 0.03, 0.03]} />{glow}</mesh>
        {mg && (<>
          <mesh position={[0, 0.075, -0.2]}><boxGeometry args={[0.11, 0.02, 0.46]} /><meshBasicMaterial color="#e8b93a" fog={false} /></mesh>
          <mesh position={[0, 0, -0.03]} rotation-z={Math.PI / 2}><cylinderGeometry args={[0.075, 0.075, 0.12, 6]} /><meshLambertMaterial color="#8a6a24" /></mesh>
        </>)}
        {/* burst: extended magazine + triple muzzle vents */}
        {mods?.burst && (<>
          <mesh position={[0, -0.27, 0]} rotation-x={0.3}><boxGeometry args={[0.06, 0.14, 0.07]} /><meshBasicMaterial color="#4fd6ff" fog={false} /></mesh>
          {[-0.03, 0, 0.03].map((x) => (
            <mesh key={x} position={[x, -0.035, mg ? -0.48 : -0.33]}><boxGeometry args={[0.018, 0.018, 0.04]} /><meshBasicMaterial color="#4fd6ff" fog={false} /></mesh>
          ))}
        </>)}
        {/* incendiary: glowing fuel canister under the barrel */}
        {mods?.incend && (
          <mesh position={[0, -0.09, -0.2]} rotation-x={Math.PI / 2}><cylinderGeometry args={[0.035, 0.035, 0.22, 8]} /><meshBasicMaterial color="#ff5a1f" fog={false} /></mesh>
        )}
        {/* extended mag: chunky drum at the grip base */}
        {mods?.extmag && (
          <mesh position={[0, -0.25, 0.02]} rotation-z={Math.PI / 2}><cylinderGeometry args={[0.07, 0.07, 0.09, 10]} /><meshLambertMaterial color="#2a2a2a" /></mesh>
        )}
        {/* shredder: serrated muzzle brake */}
        {mods?.shred && [0, 1, 2].map((k) => (
          <mesh key={k} position={[0, 0, (mg ? -0.47 : -0.32) - (mods?.suppr ? 0.2 : 0) - k * 0.035]} rotation-z={k * 0.5}><boxGeometry args={[0.14, 0.14, 0.02]} /><meshLambertMaterial color="#9a9a9a" /></mesh>
        ))}
        {/* laser sight: emitter + beam */}
        {mods?.laser && (<>
          <mesh position={[0.07, -0.05, -0.22]}><boxGeometry args={[0.04, 0.04, 0.12]} /><meshLambertMaterial color="#222" /></mesh>
          <mesh position={[0.07, -0.05, -3.3]}><boxGeometry args={[0.006, 0.006, 6]} /><meshBasicMaterial color="#ff2020" fog={false} transparent opacity={0.6} /></mesh>
        </>)}
        {/* compensator: squared ported block on the tip */}
        {mods?.comp && !mods?.suppr && (<>
          <mesh position={[0, 0, mg ? -0.5 : -0.36]}><boxGeometry args={[0.13, 0.13, 0.08]} /><meshLambertMaterial color="#4a4a4a" /></mesh>
          <mesh position={[0, 0.066, mg ? -0.5 : -0.36]}><boxGeometry args={[0.06, 0.01, 0.05]} /><meshBasicMaterial color="#111" /></mesh>
        </>)}
        {/* suppressor: long matte shroud */}
        {mods?.suppr && (
          <mesh position={[0, 0, mg ? -0.57 : -0.43]} rotation-x={Math.PI / 2}><cylinderGeometry args={[0.055, 0.055, 0.22, 12]} /><meshLambertMaterial color="#141414" /></mesh>
        )}
        {/* executioner: serrated hammer on the rear */}
        {mods?.exec && (<>
          <mesh position={[0, 0.1, 0.06]} rotation-x={-0.5}><boxGeometry args={[0.04, 0.1, 0.05]} /><meshLambertMaterial color="#6a1010" /></mesh>
          <mesh position={[0, 0.15, 0.09]}><boxGeometry args={[0.1, 0.03, 0.03]} /><meshLambertMaterial color="#b8b8b8" /></mesh>
        </>)}
        {/* holster: skeletonized match grip panels */}
        {mods?.holster && [-0.045, 0.045].map((x) => (
          <mesh key={x} position={[x, -0.12, -0.02]} rotation-x={0.3}><boxGeometry args={[0.012, 0.16, 0.09]} /><meshLambertMaterial color="#3fae5a" /></mesh>
        ))}
        {/* bounty: glowing capacitor under the trigger guard */}
        {mods?.bounty && (
          <mesh position={[0, -0.09, -0.06]}><boxGeometry args={[0.05, 0.04, 0.07]} /><meshBasicMaterial color="#39c6ff" fog={false} /></mesh>
        )}
      </>)}
      {w === "scatter" && (<>
        <mesh position={[-0.04, 0, -0.3]} rotation-x={Math.PI / 2}><cylinderGeometry args={[0.04, 0.04, 0.6, 8]} />{body}</mesh>
        <mesh position={[0.04, 0, -0.3]} rotation-x={Math.PI / 2}><cylinderGeometry args={[0.04, 0.04, 0.6, 8]} />{body}</mesh>
        <mesh position={[0, -0.04, 0.05]}><boxGeometry args={[0.14, 0.14, 0.3]} /><meshLambertMaterial color="#3b2a1a" /></mesh>
        <mesh position={[0, -0.06, -0.2]}><boxGeometry args={[0.16, 0.05, 0.12]} />{glow}</mesh>
      </>)}
      {w === "smg" && (<>
        <mesh position={[0, 0, -0.15]}><boxGeometry args={[0.12, 0.14, 0.45]} />{body}</mesh>
        <mesh position={[0, 0, -0.45]} rotation-x={Math.PI / 2}><cylinderGeometry args={[0.025, 0.025, 0.2, 6]} /><meshLambertMaterial color="#111" /></mesh>
        <mesh position={[0, -0.16, -0.12]}><boxGeometry args={[0.06, 0.22, 0.08]} />{body}</mesh>
        <mesh position={[0.065, 0.02, -0.15]}><boxGeometry args={[0.01, 0.04, 0.3]} />{glow}</mesh>
      </>)}
      {w === "rail" && (<>
        <mesh position={[0, 0, -0.3]}><boxGeometry args={[0.09, 0.09, 0.8]} />{body}</mesh>
        {[-0.5, -0.35, -0.2].map((z) => (
          <mesh key={z} position={[0, 0, z]} rotation-x={Math.PI / 2}><torusGeometry args={[0.08, 0.018, 6, 12]} />{glow}</mesh>
        ))}
        <mesh position={[0, -0.1, 0.05]}><boxGeometry args={[0.08, 0.16, 0.14]} /><meshLambertMaterial color="#555" /></mesh>
      </>)}
      {w === "cannon" && (<>
        <mesh position={[0, 0, -0.25]} rotation-x={Math.PI / 2}><cylinderGeometry args={[0.13, 0.1, 0.55, 12]} />{body}</mesh>
        <mesh position={[0, 0, -0.53]} rotation-x={Math.PI / 2}><torusGeometry args={[0.13, 0.03, 6, 14]} />{glow}</mesh>
        <mesh position={[0, 0.16, -0.15]}><sphereGeometry args={[0.06, 8, 8]} />{glow}</mesh>
      </>)}
      {w === "rebound" && (<>
        <mesh position={[0, 0, -0.18]}><boxGeometry args={[0.11, 0.16, 0.42]} />{body}</mesh>
        <mesh position={[0, 0.06, -0.42]} rotation-y={Math.PI / 2}><cylinderGeometry args={[0.16, 0.16, 0.03, 10]} />{glow}</mesh>
        <mesh position={[0, -0.14, 0]}><boxGeometry args={[0.07, 0.2, 0.1]} />{body}</mesh>
      </>)}
      {w === "harpoon" && (<>
        <mesh position={[0, 0, -0.3]}><boxGeometry args={[0.07, 0.08, 0.7]} />{body}</mesh>
        <mesh position={[0, 0.02, -0.25]} rotation-z={Math.PI / 2}><cylinderGeometry args={[0.012, 0.012, 0.44, 6]} /><meshLambertMaterial color="#8c7f66" /></mesh>
        <mesh position={[0, 0.02, -0.62]} rotation-x={-Math.PI / 2}><coneGeometry args={[0.05, 0.18, 6]} />{glow}</mesh>
        <mesh position={[0, -0.12, 0.02]}><boxGeometry args={[0.07, 0.18, 0.12]} />{body}</mesh>
      </>)}
      {w === "cryo" && (<>
        <mesh position={[0, 0, -0.22]}><boxGeometry args={[0.1, 0.13, 0.5]} />{body}</mesh>
        <mesh position={[0, 0.11, -0.2]} rotation-z={Math.PI / 2}><cylinderGeometry args={[0.06, 0.06, 0.3, 8]} />{glow}</mesh>
        <mesh position={[0, 0, -0.52]} rotation-x={-Math.PI / 2}><coneGeometry args={[0.07, 0.16, 6]} />{glow}</mesh>
        <mesh position={[0, -0.13, 0.02]}><boxGeometry args={[0.07, 0.2, 0.11]} />{body}</mesh>
      </>)}
      {w === "flak" && (<>
        <mesh position={[0, 0, -0.28]} rotation-x={Math.PI / 2}><cylinderGeometry args={[0.1, 0.14, 0.5, 8]} />{body}</mesh>
        <mesh position={[0, 0, -0.55]} rotation-x={Math.PI / 2}><cylinderGeometry args={[0.15, 0.11, 0.12, 8]} />{glow}</mesh>
        <mesh position={[0, 0.14, -0.06]}><boxGeometry args={[0.1, 0.12, 0.22]} /><meshLambertMaterial color="#6b6450" /></mesh>
        <mesh position={[0, -0.14, 0.02]}><boxGeometry args={[0.08, 0.2, 0.12]} />{body}</mesh>
      </>)}
      {w === "tesla" && (<>
        <mesh position={[0, 0, -0.22]}><boxGeometry args={[0.11, 0.12, 0.5]} />{body}</mesh>
        {[-0.42, -0.3].map((z) => (
          <mesh key={z} position={[0, 0.08, z]} rotation-x={Math.PI / 2}><torusGeometry args={[0.09, 0.022, 6, 12]} />{glow}</mesh>
        ))}
        <mesh position={[0, 0.2, -0.36]}><sphereGeometry args={[0.07, 10, 10]} />{glow}</mesh>
        <mesh position={[0, -0.13, 0.02]}><boxGeometry args={[0.07, 0.2, 0.11]} />{body}</mesh>
      </>)}

    </group>
  );
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
  onInv,
  onAmmo,
  onHeal,
  sensX,
  sensY,
  fov,
  net,
  remotes,
  dead,
  players,
  msgSink,
  health,
  slots,
  stats,
  onShard,
  onLeech,
  onCrate,
  onDeploys,
  city,
  seed,
  night,
  ability,
  onAbilityCd,
  onStat,
  onEvent,
  mapFeed,
}: {
  blocks: Block[];
  enemies: Enemy[];
  rand: () => number;
  theme: Theme;
  locked: boolean;
  gameOver: boolean;
  onScore: () => void;
  onHurt: (dmg?: number) => void;
  onStatus: (wave: number, remaining: number, won: boolean, banner: boolean) => void;
  onBoss: (hp: number) => void;
  onWeapon: (w: Weapon, picked: boolean) => void;
  onInv: (inv: { w: Weapon; ammo: number }[]) => void;
  onAmmo: (n: number) => void;
  onHeal: () => void;
  sensX: number;
  sensY: number;
  fov: number;
  net: NetHandle | null;
  remotes: React.MutableRefObject<Map<string, RemoteState>>;
  dead: boolean;
  players: number;
  msgSink: React.MutableRefObject<(m: NetMsg) => void>;
  health: number;
  slots: React.MutableRefObject<Record<string, number>>;
  stats: React.MutableRefObject<Derived>;
  onShard: (v: number) => void;
  onLeech: () => void;
  onCrate: (kind: CrateKind) => void;
  onDeploys: (d: { turret: number; mines: number }) => void;
  city: CityLayout | null;
  seed: number;
  night: boolean;
  ability: AbilityId;
  onAbilityCd: (left: number, max: number) => void;
  onStat: (k: "shot" | "hit" | "dmg" | "taken", n: number) => void;
  onEvent: (name: string | null) => void;
  mapFeed: React.MutableRefObject<MapFeed>;
}) {


  const keys = useKeyboard();
  const look = useRef({ yaw: 0, pitch: 0 });
  const meleeCooldown = useRef(0);
  const { camera } = useThree();
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const shardActive = useRef(false);
  shardActive.current = locked && !gameOver && !dead;
  const magnetRef = useRef(2);
  magnetRef.current = stats.current.magnet;
  const weapon = useRef<Weapon>("pistol");
  const [held, setHeld] = useState<Weapon>("pistol");
  const [dropGun, setDropGun] = useState<Weapon>("scatter");
  const owned = useRef<Set<Weapon>>(new Set(["pistol"]));
  const trigger = useRef(false);
  const fireCd = useRef(0);
  const viewModel = useRef<THREE.Group>(null);
  const recoil = useRef(0);
  const pickup = useRef<{ x: number; z: number; active: boolean; gun: Weapon }>({ x: 0, z: 0, active: false, gun: "scatter" });
  const pickupMesh = useRef<THREE.Group>(null);
  const ammo = useRef<Record<Weapon, number>>({ pistol: GUNS.pistol.ammo, scatter: 0, smg: 0, rail: 0, cannon: 0, rebound: 0, harpoon: 0, cryo: 0, flak: 0, tesla: 0 });
  const lostQueue = useRef<Weapon[]>([]);
  const dropOrder = useRef<Weapon[]>([...DROPPABLE]);
  const bob = useRef(0);
  const sensXRef = useRef(sensX);
  const sensYRef = useRef(sensY);
  sensXRef.current = sensX;
  sensYRef.current = sensY;
  const heal = useRef({ x: 0, z: 0, active: false });
  const lastHealWave = useRef(-99);
  const healMesh = useRef<THREE.Group>(null);
  // supply crates: turret kit, overshield, cryo mine, ammo cache
  const crate = useRef<{ x: number; z: number; active: boolean; kind: CrateKind }>({ x: 0, z: 0, active: false, kind: "turret" });
  const crateMesh = useRef<THREE.Group>(null);
  const [crateKind, setCrateKind] = useState<CrateKind>("turret");
  const crateKindRef = useRef<CrateKind>("turret");
  const turrets = useRef<{ x: number; z: number; t: number; cd: number }[]>([]);
  const deployTick = useRef(0);
  const lastDeploys = useRef({ turret: -1, mines: -1 });

  const mines = useRef<{ x: number; z: number; armed: number }[]>([]);
  const turretMeshes = useRef<(THREE.Group | null)[]>([]);
  const mineMeshes = useRef<(THREE.Group | null)[]>([]);
  const thornsPending = useRef(0);
  // ---- active ability (F) ----
  const abilityRef = useRef<AbilityId>(ability);
  abilityRef.current = ability;
  const abilCd = useRef(0);
  const abilFire = useRef(false);
  const invuln = useRef(0);
  const overdrive = useRef(0);
  const poolTicks = useRef(0);
  const poolTimer = useRef(0);
  const flareTimer = useRef(0);
  const barrierMesh = useRef<THREE.Mesh>(null);
  const cdReport = useRef(0);
  // armour soaks damage; getting hit can discharge a shock ring
  const takeHit = (dmg: number) => {
    if (invuln.current > 0) return; // dash i-frames / kinetic barrier
    const s2 = stats.current;
    const d = Math.max(1, Math.round(dmg * (1 - s2.armor)));
    if (s2.thorns > 0 && Math.random() < s2.thorns) thornsPending.current = 1;
    onStat("taken", d);
    onHurt(d);
  };
  useEffect(() => {
    const c = camera as THREE.PerspectiveCamera;
    c.fov = fov;
    c.updateProjectionMatrix();
  }, [fov, camera]);
  const look3 = worldLook(theme, night, ARENA);
  const alpineMap = city && "alpine" in city ? (city as AlpineLayout) : null;
  const { gl, scene } = useThree();
  useEffect(() => {
    // dev-only handle for poking at the scene from the console / test tooling
    if (debugHandles()) {
      const handle = { gl, scene, camera, look, liveCars, knock, city, traffic, remotes };
      Object.assign(handle, { enemies, turrets, mines, remoteDeps, spawnWave });
      (window as unknown as { __rs?: unknown }).__rs = handle;
    }
  }, [gl, scene, camera, city, remotes, enemies]);
  useEffect(() => {
    // the city needs a much deeper view so the skyline reads; other maps keep 120
    const c = camera as THREE.PerspectiveCamera;
    c.far = look3.camFar;
    c.updateProjectionMatrix();
  }, [look3.camFar, camera]);
  const bobAmt = useRef(0);

  const solid = useMemo(() => solidGrid(blocks), [blocks]);
  const field = useRef<{ key: number; dist: Float32Array } | null>(null);
  const wave = useRef(0);
  const nextWaveTimer = useRef(1.5);
  const lastRemaining = useRef(-1);
  const pending = useRef<({ x: number; z: number; t: number; placed?: boolean } | null)[]>([]);
  const markMeshes = useRef<(THREE.Group | null)[]>([]);

  const bullets = useRef<Bullet[]>([]);
  const bulletMeshes = useRef<(THREE.Mesh | null)[]>([]);
  const enemyBullets = useRef<Bullet[]>([]);
  const enemyBulletMeshes = useRef<(THREE.Mesh | null)[]>([]);

  // ---------- networking ----------
  const netRef = useRef<NetHandle | null>(net);
  netRef.current = net;
  const isHost = !net || net.role === "host";
  const isHostRef = useRef(isHost);
  isHostRef.current = isHost;
  const deadRef = useRef(dead);
  deadRef.current = dead;
  const slide = useRef({ x: 0, z: 0 }); // carried momentum, used for slippery boss floors
  // city traffic: bumped around by cars (velocity decays), with a short camera shake
  const knock = useRef({ x: 0, z: 0, shake: 0 });
  const traffic = useRef<TrafficLink>({
    active: false,
    px: 0,
    pz: 0,
    isHost: true,
    role: "solo",
    others: [],
    encode: null,
    decode: null,
    enemies,
    // cars treat enemies at their drawn size: elites (bounty champion, mini-boss) are 1.6x
    radiusOf: (e) => (STATS[e.kind as Kind]?.radius ?? 0.6) * (e.elite ? 1.6 : 1),
    isBig: (e) => !!e.elite || e.kind === "boss" || e.kind === "brute" || e.kind === "vanguard",
    hurtEnemy: null,
    hitPlayer: () => {},
  });
  // guests never simulate traffic; they follow the host's snapshots
  traffic.current.role = !net ? "solo" : net.role;
  traffic.current.isHost = !net || net.role === "host";
  traffic.current.enemies = enemies;
  traffic.current.hitPlayer = (dmg, kx, kz, shake) => {
    knock.current.x = kx;
    knock.current.z = kz;
    knock.current.shake = Math.max(knock.current.shake, shake);
    if (shake > 0) playSfx("thud");
    if (dmg > 0) takeHit(dmg);
  };

  const playersRef = useRef(players);
  playersRef.current = players;
  const healthRef = useRef(health);
  healthRef.current = health;
  const coopRef = useRef(!!net);
  coopRef.current = !!net;

  const tTimer = useRef(0);
  const snapTimer = useRef(0);
  // other players' turrets / mines (visual copies; their owner's client fires them and the
  // host applies the damage through the normal "hit" messages)
  const remoteDeps = useRef<RemoteDeps>(new Map());
  const depTick = useRef(0);
  const lastDepKey = useRef("");
  type GuestTarget = { x: number; z: number; yaw: number };
  const guestTarget = useRef<GuestTarget[]>(enemies.map(() => ({ x: 0, z: 0, yaw: 0 })));
  const fields = useRef(new Map<number, Float32Array>());
  const recycleT = useRef(1);
  const dropGunRef = useRef<Weapon>("scatter");

  const upsertRemote = (m: NetMsg) => {
    const id = String(m.from ?? "host");
    const num = id === "host" ? 1 : (slots.current[id] ?? 2);
    let r = remotes.current.get(id);
    if (!r) {
      r = {
        id, x: 0, z: 0, yaw: 0, hp: MAX_HP, weapon: "pistol",
        num, color: colorFor(num),
        last: 0, rx: Number(m.x ?? 0), rz: Number(m.z ?? 0), ry: 0,
      };
      remotes.current.set(id, r);
    }
    r.num = num;
    r.color = colorFor(num);
    r.x = Number(m.x ?? 0);
    r.z = Number(m.z ?? 0);
    r.yaw = Number(m.yaw ?? 0);
    r.hp = Number(m.hp ?? MAX_HP);
    r.weapon = String(m.w ?? "pistol");
    r.last = performance.now();
  };

  const applySnap = (m: NetMsg) => {
    const arr = (m.e as number[]) ?? [];
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i]!;
      const o = i * ENEMY_FIELDS;
      if (o + ENEMY_FIELDS - 1 >= arr.length) {
        e.alive = false;
        continue;
      }
      const u = unpackEnemy(arr, o, KINDS);
      e.kind = u.kind;
      e.swing = u.swing;
      if (u.flash) e.flash = 0.1;
      e.elite = u.elite ? 1 : 0;
      e.aux = u.leaping ? 1 : 0; // only drives the leaper's jump pose on guests
      const t = guestTarget.current[i] ?? (guestTarget.current[i] = { x: 0, z: 0, yaw: 0 });
      t.x = u.x;
      t.z = u.z;
      t.yaw = u.yaw;
      if (!e.alive || !u.alive) {
        e.x = t.x;
        e.z = t.z;
        e.yaw = u.yaw;
      }
      e.alive = u.alive;
    }
    const eb = (m.b as number[]) ?? [];
    enemyBullets.current.forEach((b) => (b.active = false));
    for (let i = 0; i * 3 + 2 < eb.length; i++) {
      let b = enemyBullets.current[i];
      if (!b) {
        b = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 1, active: false, damage: 1, color: "", size: 0, bounce: 0, pierce: 0, slow: 0, cluster: 0, chain: 0, burn: 0, knock: 0, mods: 0 };
        enemyBullets.current.push(b);
      }
      b.active = true;
      b.pos.set(eb[i * 3]!, eb[i * 3 + 1]!, eb[i * 3 + 2]!);
    }
    const p = (m.p as number[]) ?? [0, 0, 0, 1];
    pickup.current.x = p[0]!;
    pickup.current.z = p[1]!;
    pickup.current.active = p[2] === 1;
    pickup.current.gun = ORDER[p[3]!] ?? "scatter";
    if (dropGunRef.current !== pickup.current.gun) {
      dropGunRef.current = pickup.current.gun;
      setDropGun(pickup.current.gun);
    }
    const h = (m.h as number[]) ?? [0, 0, 0];
    heal.current.x = h[0]!;
    heal.current.z = h[1]!;
    heal.current.active = h[2] === 1;
    const c = (m.c as number[]) ?? [0, 0, 0, 0];
    crate.current.x = c[0]!;
    crate.current.z = c[1]!;
    crate.current.active = c[2] === 1;
    crate.current.kind = CRATE_KINDS[c[3]!] ?? "turret";
    if (Array.isArray(m.tr)) traffic.current.decode?.(m.tr as number[]);
    if (Array.isArray(m.al)) decodeAlpine(m.al as number[]);
    const mk = (m.mk as number[]) ?? [];
    pending.current = enemies.map(() => null);
    for (let j = 0; j + 3 < mk.length; j += 4) {
      pending.current[mk[j]!] = { x: mk[j + 1]!, z: mk[j + 2]!, t: mk[j + 3]! };
    }
  };

  useEffect(() => {
    msgSink.current = (m: NetMsg) => {
      const n = netRef.current;
      if (m.type === "t") { upsertRemote(m); return; }
      if (m.type === "left") {
        remotes.current.delete(String(m.from));
        remoteDeps.current.delete(String(m.from));
        return;
      }
      if (m.type === "dep") {
        remoteDeps.current.set(String(m.from ?? "host"), {
          t: Array.isArray(m.t) ? (m.t as number[]) : [],
          m: Array.isArray(m.m) ? (m.m as number[]) : [],
          at: performance.now(),
        });
        return;
      }
      if (isHostRef.current) {
        if (m.type === "hit") {
          const e = enemies[Number(m.i)];
          if (e?.alive) {
            e.hp -= Number(m.dmg);
            e.flash = 0.1;
            if (Number(m.slow) > 0) e.slow = Number(m.slow);
            if (e.kind === "boss") onBoss(Math.max(0, e.hp));
            if (e.hp <= 0) { e.alive = false; onScore(); }
          }
        } else if (m.type === "ebhit") {
          const b = enemyBullets.current[Number(m.i)];
          if (b) b.active = false;
        } else if (m.type === "take") {
          if (m.what === "gun") {
            pickup.current.active = false;
            const next = lostQueue.current.shift();
            if (next) placePickup(next);
          } else if (m.what === "crate") {
            crate.current.active = false;
          } else {
            heal.current.active = false;
          }
        } else if (m.type === "joined") {
          n?.sendTo(String(m.from), { type: "status", w: Math.max(1, wave.current), rem: enemies.filter((e) => e.alive).length, won: false, banner: true });
        }
      } else {
        if (m.type === "snap") applySnap(m);
        else if (m.type === "status") onStatus(Number(m.w), Number(m.rem), !!m.won, !!m.banner);
        else if (m.type === "boss") onBoss(Number(m.hp));
        else if (m.type === "hurt") takeHit(Number(m.dmg) || 1);
      }
    };
  }); // eslint-disable-line react-hooks/exhaustive-deps




  useEffect(() => {
    // the city starts on the landmark's plaza, looking up the tower
    camera.position.set(city ? city.spawn.x : 0, EYE + (city ? groundY(city.spawn.x, city.spawn.z) : 0), city ? city.spawn.z : 0);
    look.current = { yaw: 0, pitch: city ? 0.12 : 0 };
    wave.current = 0;
    nextWaveTimer.current = 1.5;
    pending.current = [];
    weapon.current = "pistol";
    owned.current = new Set(["pistol"]);
    setHeld("pistol");
    pickup.current.active = false;
    heal.current.active = false;
    lastHealWave.current = -99;
    lostQueue.current = [];
    turrets.current = [];
    mines.current = [];
    remoteDeps.current.clear();
    lastDepKey.current = "";
    lastDeploys.current = { turret: -1, mines: -1 };
    onDeploys({ turret: 0, mines: 0 });

    syncInv();

    // fresh random gun order for this run
    const pool: Weapon[] = [...DROPPABLE];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    dropOrder.current = pool;
    onAmmo(0);
    bullets.current.forEach((b) => (b.active = false));
    enemyBullets.current.forEach((b) => (b.active = false));
    onStatus(1, 0, false, true);
  }, [blocks, camera]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!document.pointerLockElement) return;
      look.current.yaw -= e.movementX * 0.0022 * sensXRef.current;
      look.current.pitch = Math.max(-1.2, Math.min(1.2, look.current.pitch - e.movementY * 0.0022 * sensYRef.current));
    };
    document.addEventListener("mousemove", onMove);
    return () => document.removeEventListener("mousemove", onMove);
  }, []);

  const onInvRef = useRef(onInv);
  onInvRef.current = onInv;
  const syncInv = () => {
    onInvRef.current([...owned.current].map((w) => ({ w, ammo: ammo.current[w] })));
  };

  const equip = (w: Weapon) => {
    weapon.current = w;
    setHeld(w);
    onWeapon(w, false);
    onAmmo(ammo.current[w]);
    syncInv();
  };

  /** where the living players are (the host sees everyone) */
  const livePlayers = () => {
    const out: { x: number; z: number }[] = [];
    if (!deadRef.current) out.push({ x: camera.position.x, z: camera.position.z });
    const now = performance.now();
    remotes.current.forEach((r) => {
      if (r.hp > 0 && now - r.last < 4000) out.push({ x: r.x, z: r.z });
    });
    if (out.length === 0) out.push({ x: camera.position.x, z: camera.position.z });
    return out;
  };
  /** a spawn spot: anywhere on the small maps; near a living player in the big city */
  const navOpen = (x: number, z: number) => !solid.g[toNav(x) * solid.n + toNav(z)];
  const spot = (rMin: number, rMax: number, hidden: boolean) =>
    city
      ? spawnNear(blocks, rand, livePlayers(), rMin, rMax, hidden, 1, navOpen)
      : randomSpawn(blocks, rand);

  const placePickup = (gun: Weapon) => {
    const p = spot(8, 26, false);
    pickup.current = { x: p.x, z: p.z, active: true, gun };
    setDropGun(gun);
  };

  // pistol mod cards rewrite the sidearm
  const gunFor = (w: Weapon): Gun => {
    const g = GUNS[w];
    if (w !== "pistol") return g;
    const s = stats.current;
    let out: Gun = g;
    if (s.magnum) out = { ...out, damage: out.damage + 1, speed: out.speed * 1.5, pierce: 1, color: "#ffd9a0" };
    if (s.comp) out = { ...out, speed: out.speed * 1.3 };
    return out;
  };

  const burstQueue = useRef(0);
  const bountyKills = useRef(0);
  const burstTimer = useRef(0);

  const spit = () => {
    const w = weapon.current;
    const g = gunFor(w);
    const s2 = stats.current;
    camera.getWorldDirection(FORWARD);
    const pos = camera.position.clone().addScaledVector(FORWARD, 0.6);
    pos.y -= 0.25;
    for (let s = 0; s < g.count; s++) {
      const off = g.count > 1 ? s - (g.count - 1) / 2 : (Math.random() - 0.5) * 2;
      const dir = FORWARD.clone().applyAxisAngle(camera.up, off * g.spread);
      dir.y += (Math.random() - 0.5) * g.spread * 0.6;
      const isP = w === "pistol";
      const crit = Math.random() < s2.crit + (isP && s2.laser ? 0.25 : 0);
      const dmg = g.damage * s2.dmg * (crit ? (isP && s2.suppr ? 3 : 2) : 1);
      const fx: Fx = {
        bounce: (g.bounce ?? 0) + (Math.random() < s2.ricochet ? 1 : 0),
        pierce: g.pierce ?? 0,
        slow: g.slow ?? 0,
        cluster: g.cluster ?? 0,
        chain: g.chain ?? 0,
        knock: s2.knock + (isP && s2.comp ? 0.8 : 0),
        burn: isP && s2.incend ? 3 : 0,
        mods: isP ? (s2.shred ? M_SHRED : 0) | (s2.exec ? M_EXEC : 0) | (s2.bounty ? M_BOUNTY : 0) : 0,
      };
      fireInto(
        bullets.current, pos, dir.normalize().multiplyScalar(g.speed), g.life, dmg,
        crit ? "#ffffff" : g.color, crit ? g.size * 1.4 : g.size, fx,
      );
      onStat("shot", 1);
    }
    playGun(w, w === "pistol" && s2.suppr);
    recoil.current = w === "pistol" && s2.comp ? 0 : g.damage > 3 ? 1 : 0.5;
  };

  const fire = () => {
    const w = weapon.current;
    if (ammo.current[w] <= 0) return; // dry: wait for a drop or the next wave
    spit();
    if (overdrive.current > 0) return; // adrenaline burns no reserve
    ammo.current[w]--;
    onAmmo(ammo.current[w]);
    if (w === "pistol") {
      // the pistol never drops; it just refills at the start of each wave
      if (stats.current.burst && ammo.current[w] > 0) {
        burstQueue.current = Math.min(2, ammo.current[w]);
        burstTimer.current = 0.07;
      }
      syncInv();
      return;
    }
    if (ammo.current[w] <= 0) {
      owned.current.delete(w);
      equip("pistol");
      if (pickup.current.active) lostQueue.current.push(w);
      else placePickup(w);
    } else {
      syncInv();
    }
  };

  // dying costs you every gun but the pistol; upgrades and pistol mods are kept
  useEffect(() => {
    if (!dead) return;
    const lost = [...owned.current].filter((w) => w !== "pistol");
    lost.forEach((w) => {
      owned.current.delete(w);
      ammo.current[w] = 0;
      if (!dropOrder.current.includes(w)) dropOrder.current.push(w);
    });
    ammo.current.pistol = Math.round((stats.current.extmag ? 220 : GUNS.pistol.ammo) * stats.current.ammoMul);
    equip("pistol");
  }, [dead]); // eslint-disable-line react-hooks/exhaustive-deps



  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement)?.tagName === "CANVAS") trigger.current = true;
    };
    const onUp = () => (trigger.current = false);
    const isFire = (e: KeyboardEvent) => e.code === "Space" || e.code === "Enter" || e.code === "NumpadEnter";
    const onKey = (e: KeyboardEvent) => {
      if (isFire(e)) trigger.current = true;
      if (/^[0-9]$/.test(e.key)) {
        const n = Number(e.key);
        const slot = n === 0 ? 10 : n; // 0 acts as slot 10
        const w = [...owned.current][slot - 1];
        if (w) equip(w);
      }
      if (e.code === "KeyF") abilFire.current = true;
      if (e.code === "KeyQ" || e.code === "KeyE") {
        const list = [...owned.current];
        const i = list.indexOf(weapon.current);
        const next = list[(i + (e.code === "KeyE" ? 1 : list.length - 1)) % list.length];
        if (next) equip(next);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (isFire(e)) trigger.current = false;
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [camera]); // eslint-disable-line react-hooks/exhaustive-deps

  const spawnWave = (n: number) => {
    // every wave hands the sidearm a fresh magazine
    ammo.current.pistol = Math.round((stats.current.extmag ? 220 : GUNS.pistol.ammo) * stats.current.ammoMul);
    onAmmo(ammo.current[weapon.current]);
    syncInv();
    const extra = Math.max(0, playersRef.current - 1); // each extra player scales the round
    // the real-scale city hides enemies behind blocks and streets, so it sends a bigger crowd
    const enemyMul = (1 + 0.6 * extra) * (city ? 1.75 : 1);
    const lootMul = 1 + 0.65 * extra;
    const spec: WaveSpec = WAVES[n - 1] ?? {};
    const scale = (v: number) => Math.round(v * enemyMul);
    // wave events: a horde rush, a bounty champion, then a recon mini-boss
    const event = n === 4 ? "DRIFTER HORDE" : n === 7 ? "ELITE BOUNTY" : n === 10 ? "RECON ENFORCER" : null;
    const kinds: Kind[] = ([] as Kind[])
      .concat(...KINDS.map((k) => Array<Kind>(k === "boss" ? (spec.boss ?? 0) : scale(spec[k] ?? 0)).fill(k)))
      .concat(event === "DRIFTER HORDE" ? Array<Kind>(scale(8)).fill("drifter").concat(Array<Kind>(scale(4)).fill("runner")) : [])
      .sort((a) => (a === "boss" ? -1 : 0))
      .slice(0, MAX_ENEMIES);
    const hpMul = 1 + 0.09 * (n - 1); // later rounds send sturdier enemies

    // spread arrivals across the wave: a few right away, the rest trickle in
    let delay = 0;
    enemies.forEach((e, i) => {
      const kind = kinds[i];
      pending.current[i] = null;
      if (!kind) {
        e.alive = false;
        return;
      }
      const p = kind === "boss" ? spot(25, 40, false) : spot(25, 45, true);
      Object.assign(e, {
        kind,
        x: p.x,
        z: p.z,
        hp: kind === "boss" ? Math.round(BOSS_HP + 100 * extra) : Math.max(1, Math.round(STATS[kind].hp * hpMul)),
        max: kind === "boss" ? Math.round(BOSS_HP + 100 * extra) : Math.max(1, Math.round(STATS[kind].hp * hpMul)),
        shredUntil: 0,
        aux: 0,
        alive: false,
        cooldown: 1 + rand() * 2,
        swing: 0,
        flash: 0,
        shot: 2,
        slow: 0,
        burn: 0,
        burnTick: 0,
      });
      e.elite = 0;
      pending.current[i] = { x: p.x, z: p.z, t: MARK_TIME + delay };
      // a steady trickle; the city's bigger crowd trickles a little faster so waves don't drag
      delay += i < 2 ? 0.4 : city ? 0.4 + rand() * 1.2 : 0.5 + rand() * 1.6;

    });
    // the champion: a gold, far tougher version of one of the wave's heavies
    if (event === "ELITE BOUNTY" || event === "RECON ENFORCER") {
      const mul = event === "RECON ENFORCER" ? 9 : 5;
      const pick =
        enemies.findIndex((e, i) => kinds[i] === "vanguard") >= 0
          ? enemies.findIndex((e, i) => kinds[i] === "vanguard")
          : enemies.findIndex((e, i) => kinds[i] === "brute");
      const champ = enemies[pick >= 0 ? pick : 0];
      if (champ && kinds[pick >= 0 ? pick : 0]) {
        champ.elite = 1;
        champ.hp = Math.round(champ.hp * mul);
        champ.max = champ.hp;
      }
    }
    if (event) {
      onEvent(event);
      netRef.current?.broadcast({ type: "event", name: event });
    }
    // health: random; solo waits 2 waves between packs, co-op packs come more often
    const healGap = extra > 0 ? 1 : 2;
    if (n >= 2 && n - lastHealWave.current >= healGap && rand() < Math.min(0.95, 0.5 * lootMul)) {
      const h = spot(8, 28, false);
      heal.current = { x: h.x, z: h.z, active: true };
      lastHealWave.current = n;
    }
    // supply crate: turret kit, barrier, cryo mine or ammo cache
    if (!crate.current.active) { // exactly one supply drop per wave
      const c = spot(8, 28, false);
      const kind = CRATE_KINDS[Math.floor(rand() * CRATE_KINDS.length)] ?? "ammo";
      crate.current = { x: c.x, z: c.z, active: true, kind };
    }
    // weapons: 80% chance each wave (more rolls in co-op), following this run's shuffled gun order
    const rolls = Math.max(1, Math.round(lootMul));
    const chance = Math.min(0.95, (0.8 * lootMul) / rolls);
    for (let i = 0; i < rolls; i++) {
      // in co-op a gun you are carrying can still drop for your teammates
      const candidates = dropOrder.current.filter(
        (w) =>
          (coopRef.current || !owned.current.has(w)) &&
          !lostQueue.current.includes(w) &&
          !(pickup.current.active && pickup.current.gun === w),
      );
      const drop = candidates[0];
      if (!drop || Math.random() >= chance) continue;
      if (pickup.current.active) lostQueue.current.push(pickup.current.gun);
      placePickup(drop);
    }
  };


  const outOfBounds = (p: THREE.Vector3) =>
    p.y < groundY(p.x, p.z) ||
    Math.abs(p.x) > HALF ||
    Math.abs(p.z) > HALF ||
    blocked(blocks, p.x, p.z, 0.05) ||
    (city !== null && hitsTraffic(p.x, p.y, p.z));

  useFrame((state, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const cam = state.camera;
    const k = keys.current;
    traffic.current.active = false;
    traffic.current.px = cam.position.x;
    traffic.current.pz = cam.position.z;
    if (traffic.current.role === "host") {
      // the host's cars must brake for every live player in the lane, not just the host
      const now = performance.now();
      traffic.current.others = [...remotes.current.values()]
        .filter((r) => r.hp > 0 && now - r.last < 4000)
        .map((r) => ({ x: r.x, z: r.z }));
    } else if (traffic.current.others.length) traffic.current.others = [];

    if (!gameOver && locked) {
      look.current.yaw += ((k.has("ArrowLeft") ? 1 : 0) - (k.has("ArrowRight") ? 1 : 0)) * TURN_SPEED * sensX * delta;
      look.current.pitch = Math.max(
        -1.2,
        Math.min(1.2, look.current.pitch + ((k.has("ArrowUp") ? 1 : 0) - (k.has("ArrowDown") ? 1 : 0)) * TURN_SPEED * sensY * 0.7 * delta),
      );
    }
    cam.rotation.order = "YXZ";
    const kn = knock.current;
    kn.shake = Math.max(0, kn.shake - delta * 2.2);
    const roll = kn.shake > 0 ? Math.sin(state.clock.elapsedTime * 38) * 0.06 * kn.shake : 0;
    cam.rotation.set(look.current.pitch + roll * 0.4, look.current.yaw, roll);

    if (gameOver || !locked) return;

    const n = netRef.current;
    const isH = isHostRef.current;
    const spectating = deadRef.current;

    fireCd.current -= delta;
    if (burstQueue.current > 0 && !spectating) {
      burstTimer.current -= delta;
      if (burstTimer.current <= 0) {
        burstQueue.current--;
        burstTimer.current = 0.07;
        if (ammo.current.pistol > 0) {
          spit();
          ammo.current.pistol--;
          onAmmo(ammo.current.pistol);
        } else {
          burstQueue.current = 0;
        }
      }
    } else if (trigger.current && !spectating && fireCd.current <= 0) {
      const w = weapon.current;
      fire();
      // the sidearm always fires at its stock cadence; fire-rate perks skip it
      fireCd.current = (w === "pistol" ? GUNS.pistol.cooldown : GUNS[w].cooldown / stats.current.rate)
        * (overdrive.current > 0 ? 0.5 : 1);
    }

    // player movement — the boss round makes the ground treacherous, so you slide
    const fwd = (k.has("KeyW") ? 1 : 0) - (k.has("KeyS") ? 1 : 0);
    const strafe = (k.has("KeyD") ? 1 : 0) - (k.has("KeyA") ? 1 : 0);
    cam.getWorldDirection(FORWARD);
    FORWARD.y = 0;
    FORWARD.normalize();
    RIGHT.crossVectors(FORWARD, cam.up).normalize();
    MOVE.set(0, 0, 0).addScaledVector(FORWARD, fwd).addScaledVector(RIGHT, strafe);
    const moving = MOVE.lengthSq() > 0;
    if (moving) MOVE.normalize();
    const slip = wave.current === WAVES.length ? theme.hazard.slip : 0;
    alpine.boss = wave.current === WAVES.length; // the alpine boss round brings a blizzard
    const resp = slip > 0 ? Math.min(1, delta * (1.5 + (1 - slip) * 22)) : 1;
    const spd = SPEED * stats.current.speed
      * (stats.current.holster && weapon.current === "pistol" ? 1.15 : 1)
      * (overdrive.current > 0 ? 1.3 : 1)
      * groundSpeed(cam.position.x, cam.position.z); // deep snow off the paths
    slide.current.x += (MOVE.x * spd - slide.current.x) * resp;
    slide.current.z += (MOVE.z * spd - slide.current.z) * resp;
    if (Math.abs(slide.current.x) > 0.001 || Math.abs(slide.current.z) > 0.001) {
      const nx = cam.position.x + slide.current.x * delta;
      const nz = cam.position.z + slide.current.z * delta;
      if (!blocked(blocks, nx, cam.position.z, 0.4)) cam.position.x = nx; else slide.current.x = 0;
      if (!blocked(blocks, cam.position.x, nz, 0.4)) cam.position.z = nz; else slide.current.z = 0;
    }
    // weather: blizzard gusts shove you downwind
    if (wind.x !== 0 || wind.z !== 0) {
      const wx = cam.position.x + wind.x * delta;
      const wz = cam.position.z + wind.z * delta;
      if (!blocked(blocks, wx, cam.position.z, 0.4)) cam.position.x = wx;
      if (!blocked(blocks, cam.position.x, wz, 0.4)) cam.position.z = wz;
    }

    // car bumps: velocity that decays quickly, sliding along walls instead of through them
    if (Math.abs(kn.x) > 0.01 || Math.abs(kn.z) > 0.01) {
      const steps = Math.ceil((Math.hypot(kn.x, kn.z) * delta) / 0.25);
      for (let st = 0; st < steps; st++) {
        const nx = cam.position.x + (kn.x * delta) / steps;
        const nz = cam.position.z + (kn.z * delta) / steps;
        if (!blocked(blocks, nx, cam.position.z, 0.4)) cam.position.x = nx;
        else kn.x *= -0.2;
        if (!blocked(blocks, cam.position.x, nz, 0.4)) cam.position.z = nz;
        else kn.z *= -0.2;
      }
      const decay = Math.exp(-delta * 6);
      kn.x *= decay;
      kn.z *= decay;
    }

    bobAmt.current += ((moving ? 1 : 0) - bobAmt.current) * Math.min(1, delta * 8);
    bob.current += delta * 9 * bobAmt.current;
    cam.position.y = groundY(cam.position.x, cam.position.z) + EYE + Math.sin(bob.current) * 0.03 * bobAmt.current;

    // minimap feed (the HUD reads it)
    if (city) {
      const mf = mapFeed.current;
      mf.x = cam.position.x;
      mf.z = cam.position.z;
      mf.yaw = look.current.yaw;
      const [g0, h0, c0] = mf.items;
      if (g0 && h0 && c0) {
        g0.x = pickup.current.x;
        g0.z = pickup.current.z;
        g0.active = pickup.current.active && !owned.current.has(pickup.current.gun);
        g0.color = GUNS[pickup.current.gun].color;
        h0.x = heal.current.x;
        h0.z = heal.current.z;
        h0.active = heal.current.active;
        c0.x = crate.current.x;
        c0.z = crate.current.z;
        c0.active = crate.current.active;
        c0.color = CRATE_INFO[crate.current.kind].color;
      }
    }

    // share my position with the room
    if (n) {
      tTimer.current -= delta;
      if (tTimer.current <= 0) {
        tTimer.current = 0.05;
        n.broadcast({
          type: "t", x: cam.position.x, z: cam.position.z, yaw: look.current.yaw,
          hp: spectating ? 0 : Math.max(1, healthRef.current), w: weapon.current,
        });
      }
    }

    // weapon pickup
    const pk = pickup.current;
    // in co-op a gun someone else already carries still spawns; you just can't grab a duplicate
    const canTake = !owned.current.has(pk.gun);
    if (pickupMesh.current) {
      pickupMesh.current.visible = pk.active && canTake;
      if (pk.active) {
        pickupMesh.current.position.set(pk.x, groundY(pk.x, pk.z) + Math.sin(state.clock.elapsedTime * 3) * 0.15, pk.z);
        pickupMesh.current.rotation.y += delta * 2;
      }
    }
    if (pk.active && canTake && !spectating && Math.hypot(cam.position.x - pk.x, cam.position.z - pk.z) < 1.3) {
      pk.active = false;
      owned.current.add(pk.gun);
      ammo.current[pk.gun] = Math.round(GUNS[pk.gun].ammo * stats.current.ammoMul);
      equip(pk.gun);
      onWeapon(pk.gun, true);
      if (isH) {
        const next = lostQueue.current.shift();
        if (next) placePickup(next);
      } else n?.broadcast({ type: "take", what: "gun" });
    }

    // health pickup
    const hp = heal.current;
    if (healMesh.current) {
      healMesh.current.visible = hp.active;
      if (hp.active) {
        healMesh.current.position.set(hp.x, groundY(hp.x, hp.z) + 0.9 + Math.sin(state.clock.elapsedTime * 3) * 0.15, hp.z);
        healMesh.current.rotation.y += delta * 1.5;
      }
    }
    if (hp.active && !spectating && Math.hypot(cam.position.x - hp.x, cam.position.z - hp.z) < 1.3) {
      hp.active = false;
      onHeal();
      if (!isH) n?.broadcast({ type: "take", what: "heal" });
    }

    // supply crate pickup
    const ck = crate.current;
    if (crateKindRef.current !== ck.kind) {
      crateKindRef.current = ck.kind;
      setCrateKind(ck.kind);
    }
    if (crateMesh.current) {
      crateMesh.current.visible = ck.active;
      if (ck.active) {
        crateMesh.current.position.set(ck.x, groundY(ck.x, ck.z) + 0.5 + Math.sin(state.clock.elapsedTime * 2.4) * 0.12, ck.z);
        crateMesh.current.rotation.y += delta * 1.2;
      }
    }
    if (ck.active && !spectating && Math.hypot(cam.position.x - ck.x, cam.position.z - ck.z) < 1.4) {
      ck.active = false;
      if (ck.kind === "turret" && turrets.current.length < 6) turrets.current.push({ x: cam.position.x, z: cam.position.z, t: TURRET_LIFE, cd: 0 });
      if (ck.kind === "mine" && mines.current.length < 6) mines.current.push({ x: cam.position.x, z: cam.position.z, armed: 1 });
      if (ck.kind === "ammo") {
        owned.current.forEach((w) => {
          if (w === "pistol") return;
          ammo.current[w] = Math.min(
            Math.round(GUNS[w].ammo * stats.current.ammoMul),
            ammo.current[w] + Math.round(GUNS[w].ammo * 0.5),
          );
        });
        onAmmo(ammo.current[weapon.current]);
        syncInv();
      }
      onCrate(ck.kind);
      if (!isH) n?.broadcast({ type: "take", what: "crate" });
    }

    // deployed sentries shoot the nearest enemy for you
    for (let ti = turrets.current.length - 1; ti >= 0; ti--) {
      const t = turrets.current[ti]!;
      t.t -= delta;
      const mesh = turretMeshes.current[ti];
      if (mesh) {
        mesh.visible = t.t > 0;
        mesh.position.set(t.x, groundY(t.x, t.z), t.z);
      }
      if (t.t <= 0) { turrets.current.splice(ti, 1); continue; }
      t.cd -= delta;
      let best: Enemy | null = null;
      let bd = 5.5;
      for (const e of enemies) {
        if (!e.alive) continue;
        const d2 = Math.hypot(e.x - t.x, e.z - t.z);
        if (d2 < bd) { bd = d2; best = e; }
      }
      if (best && t.cd <= 0) {
        t.cd = 0.3;
        playSfx("turret");
        const v = new THREE.Vector3(best.x - t.x, 0, best.z - t.z).normalize().multiplyScalar(30);
        fireInto(bullets.current, new THREE.Vector3(t.x, groundY(t.x, t.z) + 1.1, t.z), v, 0.4, 0.5, "#4fe3ff", 0.11, { knock: stats.current.knock });
        if (mesh) mesh.rotation.y = Math.atan2(best.x - t.x, best.z - t.z);
      }
    }
    for (let i = turrets.current.length; i < 6; i++) { const m2 = turretMeshes.current[i]; if (m2) m2.visible = false; }
    for (let i = mines.current.length; i < 6; i++) { const m2 = mineMeshes.current[i]; if (m2) m2.visible = false; }

    // keep the HUD status panel in sync with what's deployed
    // share my turrets / mines with the room: on change, and a 1 s heartbeat
    if (n) {
      depTick.current -= delta;
      const r100 = (v: number) => Math.round(v * 100);
      const t = turrets.current.flatMap((q) => [r100(q.x), r100(q.z), Math.round(q.t * 10)]);
      const m = mines.current.flatMap((q) => [r100(q.x), r100(q.z)]);
      const key = `${turrets.current.length}:${m.join(",")}`;
      if (key !== lastDepKey.current || depTick.current <= 0) {
        lastDepKey.current = key;
        depTick.current = 1;
        n.broadcast({ type: "dep", t, m });
      }
    }

    deployTick.current -= delta;
    if (deployTick.current <= 0) {
      deployTick.current = 0.25;
      const tl = turrets.current.reduce((m2, t) => Math.max(m2, t.t), 0);
      const secs = Math.ceil(tl);
      const mc = mines.current.length;
      if (secs !== lastDeploys.current.turret || mc !== lastDeploys.current.mines) {
        lastDeploys.current = { turret: secs, mines: mc };
        onDeploys({ turret: secs, mines: mc });
      }
    }




    // ---- guests: play back the host's world, then handle their own bullets ----
    if (!isH) {
      enemies.forEach((e, i) => {
        const t = guestTarget.current[i];
        if (!t || !e.alive) return;
        const f = Math.min(1, delta * 12);
        e.x += (t.x - e.x) * f;
        e.z += (t.z - e.z) * f;
        const dy = Math.atan2(Math.sin(t.yaw - (e.yaw ?? 0)), Math.cos(t.yaw - (e.yaw ?? 0)));
        e.yaw = (e.yaw ?? 0) + dy * (1 - Math.exp(-delta * 14));
        e.flash -= delta;
      });
      enemyBullets.current.forEach((b, i) => {
        const m = enemyBulletMeshes.current[i];
        if (b.active) {
          b.pos.addScaledVector(b.vel, delta);
          if (!spectating && b.pos.distanceTo(cam.position) < 0.8) {
            b.active = false;
            takeHit(b.damage);

            n?.broadcast({ type: "ebhit", i });
          }
        }
        if (m) {
          m.visible = b.active;
          m.position.copy(b.pos);
        }
      });
    }

    const status = (w: number, rem: number, won: boolean, bannerOn: boolean) => {
      onStatus(w, rem, won, bannerOn);
      if (isH) n?.broadcast({ type: "status", w, rem, won, banner: bannerOn });
    };

    const onKill = (e: Enemy) => {
      const s2 = stats.current;
      if (s2.leech > 0 && Math.random() < s2.leech) onLeech();
      if (s2.boom > 0 && Math.random() < s2.boom) {
        for (let oi = 0; oi < enemies.length; oi++) {
          const o = enemies[oi]!;
          if (!o.alive || o === e) continue;
          if (Math.hypot(o.x - e.x, o.z - e.z) < 3.4) hurtEnemy(o, 3, oi);
        }
      }
    };
    const hurtEnemy = (e: Enemy, dmg: number, idx: number, slow = 0, burn = 0, kb = 0, kx = 0, kz = 0) => {
      if ((e.shredUntil ?? 0) > performance.now()) dmg *= 1.3;
      if (e.kind === "special" && theme.special.type === "nautilus") dmg *= 0.5; // shell soaks half
      if (kb > 0 && e.kind !== "boss") {
        const len = Math.hypot(kx, kz) || 1;
        const push = kb * (e.kind === "brute" || e.kind === "vanguard" ? 0.5 : 1);
        e.x += (kx / len) * push;
        e.z += (kz / len) * push;
      }
      if (!isH) {
        n?.broadcast({ type: "hit", i: idx, dmg, slow });
        e.flash = 0.1;
        return;
      }
      e.hp -= dmg;
      e.flash = 0.1;
      if (slow > 0) e.slow = slow;
      if (burn > 0) { e.burn = burn; e.burnTick = 1; }
      if (e.kind === "boss") onBoss(Math.max(0, e.hp));
      if (e.hp <= 0) {
        e.alive = false;
        if (e.kind === "special" && theme.special.type === "mite") {
          // shell shatters into a ring of cold shrapnel
          for (let s = 0; s < 8; s++) {
            const a = (s / 8) * Math.PI * 2;
            const v = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
            fireInto(enemyBullets.current, new THREE.Vector3(e.x + v.x * 0.6, groundY(e.x, e.z) + 1.2, e.z + v.z * 0.6), v.multiplyScalar(9), 0.9, 1, "", 0.14);
          }
        }
        onScore();
        if (e.elite) { onShard(15); e.elite = 0; }
        onKill(e);
      }
    };

    // city traffic reads the player and can shove enemies through the regular hit path
    traffic.current.active = !spectating;
    traffic.current.hurtEnemy = (idx, dmg, kx, kz) => {
      const e = enemies[idx];
      if (e?.alive) hurtEnemy(e, dmg, idx, 0, 0, 1.6, kx, kz);
    };

    // shock thorns: getting hit can discharge a ring that zaps whoever is close
    if (thornsPending.current > 0) {
      thornsPending.current = 0;
      for (let ei = 0; ei < enemies.length; ei++) {
        const e = enemies[ei]!;
        if (!e.alive) continue;
        if (Math.hypot(e.x - cam.position.x, e.z - cam.position.z) < 4) hurtEnemy(e, 2, ei);
      }
    }

    // ---- active ability (F) ----
    if (abilCd.current > 0) abilCd.current = Math.max(0, abilCd.current - delta);
    if (invuln.current > 0) invuln.current -= delta;
    if (overdrive.current > 0) overdrive.current -= delta;
    if (barrierMesh.current) {
      barrierMesh.current.visible = invuln.current > 0 && abilityRef.current === "barrier";
      barrierMesh.current.position.copy(cam.position);
    }
    if (poolTicks.current > 0) {
      poolTimer.current -= delta;
      if (poolTimer.current <= 0) { poolTimer.current = 1; poolTicks.current--; onLeech(); }
    }
    if (flareTimer.current > 0) {
      flareTimer.current -= delta;
      if (flareTimer.current <= 0) {
        for (let ei = 0; ei < enemies.length; ei++) {
          const e = enemies[ei]!;
          if (e.alive && Math.hypot(e.x - cam.position.x, e.z - cam.position.z) < 9) hurtEnemy(e, 3, ei);
        }
      }
    }
    if (abilFire.current) {
      abilFire.current = false;
      const id = abilityRef.current;
      if (!spectating && abilCd.current <= 0) {
        abilCd.current = ABILITIES[id].cd;
        playSfx("buy");
        cam.getWorldDirection(FORWARD);
        FORWARD.y = 0;
        FORWARD.normalize();
        const near = (radius: number, fn: (e: Enemy, i: number) => void) => {
          for (let ei = 0; ei < enemies.length; ei++) {
            const e = enemies[ei]!;
            if (e.alive && Math.hypot(e.x - cam.position.x, e.z - cam.position.z) < radius) fn(e, ei);
          }
        };
        if (id === "dash") {
          slide.current.x += FORWARD.x * 26;
          slide.current.z += FORWARD.z * 26;
          invuln.current = 0.7;
        } else if (id === "pool") {
          poolTicks.current = 3;
          poolTimer.current = 0.1;
        } else if (id === "repulse") {
          near(9, (e, ei) => hurtEnemy(e, 2, ei, 0, 0, 7, e.x - cam.position.x, e.z - cam.position.z));
        } else if (id === "nova") {
          near(8, (e, ei) => hurtEnemy(e, 1, ei, 3.5));
        } else if (id === "flare") {
          near(12, (e, ei) => hurtEnemy(e, 1, ei, 4));
          flareTimer.current = 4;
        } else if (id === "mortar") {
          const pos = cam.position.clone().addScaledVector(FORWARD, 0.8);
          pos.y -= 0.2;
          fireInto(bullets.current, pos, FORWARD.clone().multiplyScalar(18), 2.2, 4, "#ff9d3b", 0.34, { cluster: 5 });
        } else if (id === "barrier") {
          invuln.current = 6;
        } else if (id === "overdrive") {
          overdrive.current = 4;
        }
      } else if (abilCd.current > 0) {
        playSfx("deny");
      }
    }
    cdReport.current -= delta;
    if (cdReport.current <= 0) {
      cdReport.current = 0.2;
      onAbilityCd(abilCd.current, ABILITIES[abilityRef.current].cd);
    }

    // cryo mines freeze and hurt whatever walks onto them
    for (let mi = mines.current.length - 1; mi >= 0; mi--) {
      const mn = mines.current[mi]!;
      const mesh = mineMeshes.current[mi];
      if (mesh) { mesh.visible = true; mesh.position.set(mn.x, groundY(mn.x, mn.z) + 0.2, mn.z); }
      let hit = false;
      for (let ei = 0; ei < enemies.length; ei++) {
        const e = enemies[ei]!;
        if (!e.alive) continue;
        if (Math.hypot(e.x - mn.x, e.z - mn.z) < 3) { hurtEnemy(e, 2, ei, 4); hit = true; }
      }
      if (hit) {
        mines.current.splice(mi, 1);
        if (mesh) mesh.visible = false;
      }
    }


    if (isH) {
      // staggered spawns: red X flashes for MARK_TIME, then the enemy appears
      pending.current.forEach((pd, i) => {
        if (!pd) return;
        pd.t -= delta;
        if (city && !pd.placed && pd.t <= MARK_TIME) {
          // late arrivals appear near wherever the squad is now, not where it was
          pd.placed = true;
          const q = enemies[i]!.kind === "boss" ? spot(25, 40, false) : spot(25, 45, true);
          pd.x = q.x;
          pd.z = q.z;
        }
        if (pd.t <= 0) {
          const e = enemies[i]!;
          e.x = pd.x;
          e.z = pd.z;
          e.alive = true;
          delete e.lastX;
          e.stuckFor = 0;
          if (e.kind === "boss") onBoss(BOSS_HP);
          pending.current[i] = null;
        }
      });
      // waves
      const remaining = enemies.filter((e) => e.alive).length + pending.current.filter(Boolean).length;
      if (remaining === 0 && wave.current <= WAVES.length) {
        if (wave.current === WAVES.length) {
          wave.current++;
          status(WAVES.length, 0, true, false);
          return;
        }
        // wave cleared: tell everyone so the shop opens during the break
        if (wave.current > 0 && lastRemaining.current !== 0) {
          lastRemaining.current = 0;
          status(wave.current, 0, false, false);
        }
        nextWaveTimer.current -= delta;
        if (nextWaveTimer.current <= 0) {
          wave.current++;
          spawnWave(wave.current);
          nextWaveTimer.current = 10; // shopping break before the next wave
          status(wave.current, enemies.filter((e) => e.alive).length, false, true);
          lastRemaining.current = -1;
        }
      } else if (remaining !== lastRemaining.current) {
        lastRemaining.current = remaining;
        status(Math.max(1, wave.current), remaining, false, false);
      }

      // everyone the enemies can go after
      const now = performance.now();
      type Target = { id: string | null; x: number; z: number; y: number };
      const targets: Target[] = [];
      if (!spectating) targets.push({ id: null, x: cam.position.x, z: cam.position.z, y: cam.position.y });
      remotes.current.forEach((r) => {
        if (r.hp > 0 && now - r.last < 4000) targets.push({ id: r.id, x: r.x, z: r.z, y: EYE + groundY(r.x, r.z) });
      });
      if (targets.length === 0) targets.push({ id: null, x: cam.position.x, z: cam.position.z, y: cam.position.y });

      const hurtTarget = (t: Target, dmg: number) => {
        if (t.id === null) takeHit(dmg);
        else n?.sendTo(t.id, { type: "hurt", dmg });
      };

      // flow field per target cell (cached)
      const used = new Set<number>();
      for (const t of targets) {
        const key = toNav(t.x) * 1000 + toNav(t.z);
        used.add(key);
        if (!fields.current.has(key))
          fields.current.set(key, flowField(solid, toNav(t.x), toNav(t.z), city ? 70 : Infinity));
      }
      if (fields.current.size > 12) {
        fields.current.forEach((_, key) => { if (!used.has(key)) fields.current.delete(key); });
      }

      // the city is huge: enemies stranded far from every player get recycled nearby
      if (city) {
        recycleT.current -= delta;
        if (recycleT.current <= 0) {
          recycleT.current = 1;
          for (const e of enemies) {
            if (!e.alive) continue;
            let dmin = Infinity;
            for (const t of targets) dmin = Math.min(dmin, Math.hypot(t.x - e.x, t.z - e.z));
            if (dmin > (e.kind === "boss" ? 70 : 80)) {
              const q = e.kind === "boss" ? spot(25, 40, false) : spot(25, 45, true);
              e.x = q.x;
              e.z = q.z;
              e.stuckFor = 0;
            } else if (e.kind !== "boss") {
              // wedged on a corner the coarse nav grid thinks is open: once it has made no
              // progress for 3 s and nobody can see it, it re-enters from another hidden spot
              const moved = e.lastX === undefined ? 99 : Math.hypot(e.x - e.lastX, e.z - e.lastZ!);
              e.stuckFor = moved < 0.5 && dmin > 18 ? (e.stuckFor ?? 0) + 1 : 0;
              const seen = targets.some((t) => clearLine(blocks, t.x, t.z, e.x, e.z, 0.1));
              if (e.stuckFor >= 3 && !seen) {
                const q = spot(25, 45, true);
                e.x = q.x;
                e.z = q.z;
                e.stuckFor = 0;
              }
            }
            e.lastX = e.x;
            e.lastZ = e.z;
          }
        }
      }

      meleeCooldown.current -= delta;
      for (const e of enemies) {
        if (!e.alive) continue;
        e.flash -= delta;
        e.cooldown -= delta;
        if (e.slow > 0) e.slow -= delta;
        if (e.burn > 0) {
          e.burn -= delta;
          e.burnTick -= delta;
          if (e.burnTick <= 0) {
            e.burnTick = 1;
            e.hp -= 1;
            e.flash = 0.1;
            if (e.kind === "boss") onBoss(Math.max(0, e.hp));
            if (e.hp <= 0) { e.alive = false; e.burn = 0; onScore(); onKill(e); continue; }
          }
        }
        const st = STATS[e.kind];
        // nearest player
        let target = targets[0]!;
        let d = Math.hypot(target.x - e.x, target.z - e.z) || 1;
        for (const t of targets) {
          const dd = Math.hypot(t.x - e.x, t.z - e.z) || 1;
          if (dd < d) { d = dd; target = t; }
        }
        const dx = target.x - e.x;
        const dz = target.z - e.z;
        e.yaw = Math.atan2(dx, dz); // face whoever this enemy is after (synced to guests)

        // route around obstacles: go straight if clear, else follow the flow field
        let tx = target.x;
        let tz = target.z;
        const ghost = e.kind === "specter"; // specters drift straight through cover
        if (!ghost && !clearLine(blocks, e.x, e.z, tx, tz, Math.min(st.radius, 0.8) * 0.9)) {
          const dist = fields.current.get(toNav(target.x) * 1000 + toNav(target.z));
          if (dist) {
            const wp = nextWaypoint(solid, dist, e.x, e.z);
            tx = wp.x;
            tz = wp.z;
          }
        }
        const mx = tx - e.x;
        const mz = tz - e.z;
        const md = Math.hypot(mx, mz) || 1;
        let dir = 1;
        if (e.kind === "shooter") dir = d > 11 ? 1 : d < 7 ? -1 : 0;
        if (e.kind === "bomber") dir = d > 16 ? 1 : d < 9 ? -1 : 0;
        if (e.kind === "brute" && d < 1.8) dir = 0;
        if (e.kind === "vanguard" && d < 2) dir = 0;
        if (e.kind === "boss" && d < 3) dir = 0;
        const spType = e.kind === "special" ? theme.special.type : null;
        let spMul = 1;
        if (spType) {
          if (spType === "stalker") { dir = d > 7 ? 1 : 0; spMul = 1.3; }
          if (spType === "mite") spMul = 1.6;
          if (spType === "spore") dir = d > 14 ? 1 : d < 8 ? -1 : 0;
          if (spType === "pyre" || spType === "wyrm") dir = d > 12 ? 1 : d < 7 ? -1 : 0;
          if (spType === "leaper") dir = d > 9 ? 1 : 0;
          if (spType === "shinobi") spMul = 1.4;
          if (spType === "nautilus") dir = d > 13 ? 1 : d < 8 ? -1 : 0;
          if (spType === "hacker") dir = d > 15 ? 1 : d < 10 ? -1 : 0;
          if (spType === "bile") dir = d > 5 ? 1 : 0;
          // RIDGE RAIDER: carves in fast on skis, quicker still in a whiteout
          if (spType === "skier") { dir = d > 6 ? 1 : 0; spMul = 1.5 + alpine.blizzard * 0.5; }
        }
        if (e.swing > 0) dir = 0;
        const step = st.speed * spMul * (e.slow > 0 ? 0.5 : 1) * delta * dir;
        let nx = e.x + (mx / md) * step;
        let nz = e.z + (mz / md) * step;
        if (spType === "stalker" || spType === "shinobi" || spType === "skier") {
          // flanking arcs / zig-zag dash-steps
          const now = performance.now() / 1000;
          const side = spType === "shinobi" ? Math.sign(Math.sin(now * 3.2 + (e.max ?? 1))) * 3.2 : Math.sin(now * 1.3 + (e.max ?? 1)) * 2.4;
          nx += (-dz / d) * side * delta * (e.slow > 0 ? 0.5 : 1);
          nz += (dx / d) * side * delta * (e.slow > 0 ? 0.5 : 1);
        }
        const r = Math.min(st.radius, 0.8);
        if (ghost) { e.x = nx; e.z = nz; }
        else {
          if (!blocked(blocks, nx, e.z, r)) e.x = nx;
          if (!blocked(blocks, e.x, nz, r)) e.z = nz;
        }

        if ((e.kind === "drifter" || e.kind === "runner") && d < 1.3 && meleeCooldown.current <= 0) {
          meleeCooldown.current = 1;
          hurtTarget(target, st.dmg);
        }
        // SPECTER: blinks in behind whoever it is hunting, then slashes
        if (e.kind === "specter") {
          e.shot -= delta;
          if (e.shot <= 0 && d > 9) {
            e.shot = 5 + rand() * 3;
            const a = rand() * Math.PI * 2;
            const bx = target.x + Math.sin(a) * 4;
            const bz = target.z + Math.cos(a) * 4;
            if (!blocked(blocks, bx, bz, 0.6)) { e.x = bx; e.z = bz; }
          }
          if (d < 1.6 && e.cooldown <= 0) {
            e.cooldown = 1.4;
            hurtTarget(target, st.dmg);
          }
        }
        if (e.kind === "brute" || e.kind === "boss" || e.kind === "vanguard") {
          const reach = e.kind === "boss" ? 3.6 : e.kind === "vanguard" ? 2.6 : 2.4;
          if (e.swing > 0) {
            const before = e.swing;
            e.swing -= delta;
            if (before > 0.2 && e.swing <= 0.2 && d < reach) hurtTarget(target, st.dmg);
          } else if (d < reach - 0.2 && e.cooldown <= 0) {
            e.swing = 0.4;
            e.cooldown = e.kind === "boss" ? 1.3 : 1.6;
          }
        }
        if (e.kind === "shooter" && e.cooldown <= 0 && d < 22) {
          e.cooldown = 1.5 + rand() * 0.6;
          const from = new THREE.Vector3(e.x, groundY(e.x, e.z) + 1.5, e.z);
          const vel = new THREE.Vector3(target.x, target.y - 0.2, target.z).sub(from).normalize();
          from.addScaledVector(vel, 0.8);
          fireInto(enemyBullets.current, from, vel.multiplyScalar(ENEMY_BULLET_SPEED), 3.5, st.dmg);
        }
        // BOMBER: heavy shells lobbed from above, they clear low cover
        if (e.kind === "bomber") {
          e.shot -= delta;
          if (e.shot <= 0 && d < 30) {
            e.shot = 3 + rand();
            const from = new THREE.Vector3(e.x, groundY(e.x, e.z) + 3.2, e.z);
            const vel = new THREE.Vector3(target.x - e.x, target.y - from.y, target.z - e.z).normalize();
            from.addScaledVector(vel, 1.2);
            fireInto(enemyBullets.current, from, vel.multiplyScalar(ENEMY_BULLET_SPEED * 0.8), 4.5, st.dmg, "", 0.36);
          }
        }
        if (spType) {
          e.shot -= delta;
          const aim = (y0: number, spd: number, spread: number, n: number, dmg: number, life = 3.5, size = 0.2) => {
            const y = y0 + groundY(e.x, e.z);
            const from = new THREE.Vector3(e.x, y, e.z);
            const base = Math.atan2(dx, dz);
            for (let s = 0; s < n; s++) {
              const a = base + (n > 1 ? (s - (n - 1) / 2) * spread : 0);
              const vel = new THREE.Vector3(Math.sin(a), (target.y - y) / d, Math.cos(a)).normalize();
              fireInto(enemyBullets.current, from.clone().addScaledVector(vel, 0.8), vel.multiplyScalar(spd), life, dmg, "", size);
            }
          };
          const ready = e.shot <= 0;
          if (spType === "stalker" && ready && d < 18) { e.shot = 2.4; aim(0.9, 16, 0.08, 3, 1, 2.5, 0.12); }
          if ((spType === "mite") && d < 1.2 && e.cooldown <= 0) { e.cooldown = 1; hurtTarget(target, 1); }
          if (spType === "spore" && ready && d < 26) { e.shot = 3.2; aim(3, ENEMY_BULLET_SPEED * 0.7, 0, 1, 1, 5, 0.42); }
          if (spType === "pyre" && ready && d < 24) { e.shot = 3; aim(1.1, 22, 0, 1, 2, 2.5, 0.34); }
          if (spType === "leaper") {
            if ((e.aux ?? 0) > 0) {
              e.aux = (e.aux ?? 0) - delta;
              const lx = e.x + (dx / d) * 14 * delta;
              const lz = e.z + (dz / d) * 14 * delta;
              if (!blocked(blocks, lx, e.z, 0.6)) e.x = lx;
              if (!blocked(blocks, e.x, lz, 0.6)) e.z = lz;
              if (d < 1.4) { e.aux = 0; hurtTarget(target, 2); }
            } else if (ready && d < 10) { e.shot = 4; e.aux = 0.5; }
          }
          if (spType === "shinobi" && ready && d < 16) { e.shot = 2; aim(1.3, 15, 0.25, 2, 1, 2, 0.16); }
          if (spType === "wyrm") {
            if ((e.aux ?? 0) > 0) {
              e.aux = (e.aux ?? 0) - delta;
              if (e.cooldown <= 0) { e.cooldown = 0.15; aim(1.8, 20, 0, 1, 1, 2, 0.1); }
            } else if (ready && d < 20) { e.shot = 4; e.aux = 0.6; }
          }
          if (spType === "nautilus" && ready && d < 22) { e.shot = 2.8; aim(1.2, 8, 0.3, 2, 1, 4.5, 0.3); }
          if (spType === "hacker" && ready) {
            // overcharge pulse: nearby enemies shake off slows, fire right away and patch up
            e.shot = 5;
            for (const o of enemies) {
              if (!o.alive || o === e || Math.hypot(o.x - e.x, o.z - e.z) > 9) continue;
              o.cooldown = 0; o.slow = 0; o.hp = Math.min(o.max ?? o.hp, o.hp + 1);
            }
            if (d < 20) aim(1.6, 18, 0, 1, 1, 2, 0.14);
          }
          if (spType === "bile" && ready && d < 9) { e.shot = 2.2; aim(1, 12, 0.14, 6, 1, 0.9, 0.16); }
          if (spType === "skier") {
            // a fan of thrown ice picks at mid range, a pole jab up close
            if (ready && d < 20 && d > 4) { e.shot = 2.3; aim(1.3, 17, 0.12, 3, 1, 2, 0.12); }
            if (d < 1.7 && e.cooldown <= 0) { e.cooldown = 1.1; hurtTarget(target, 1); }
          }
        }
        if (e.kind === "boss") {
          e.shot -= delta;
          if (e.shot <= 0 && d < 30) {
            e.shot = 1.8;
            const from = new THREE.Vector3(e.x, groundY(e.x, e.z) + 2.6, e.z);
            const base = Math.atan2(dx, dz);
            for (let s = -3; s <= 3; s++) {
              const a = base + s * 0.16;
              const vel = new THREE.Vector3(Math.sin(a), (target.y - from.y) / d, Math.cos(a)).normalize();
              const p = from.clone().addScaledVector(vel, 1.6);
              fireInto(enemyBullets.current, p, vel.multiplyScalar(ENEMY_BULLET_SPEED), 4, st.dmg - 1, "", 0.3);
            }
          }
          // THE AVALANCHE ENGINE: every few seconds it drops the blade and ploughs straight at you
          if (theme.boss.shape === "plough") {
            e.aux = (e.aux ?? 5) - delta;
            if (e.aux < 0 && e.aux > -1.4) {
              const cx = e.x + (dx / d) * 10 * delta;
              const cz = e.z + (dz / d) * 10 * delta;
              if (!blocked(blocks, cx, e.z, 1.2)) e.x = cx;
              if (!blocked(blocks, e.x, cz, 1.2)) e.z = cz;
              if (d < 3.2 && e.cooldown <= 0) { e.cooldown = 1.2; hurtTarget(target, 3); }
            } else if (e.aux <= -1.4) e.aux = d > 5 && d < 28 ? 5 + rand() * 3 : 1;
          }
        }
      }

    }

    // player bullets
    const burst = (b: Bullet) => {
      if (b.cluster <= 0) return;
      const n2 = b.cluster;
      b.cluster = 0;
      for (let s = 0; s < n2; s++) {
        const a = (s / n2) * Math.PI * 2 + Math.random();
        const v = new THREE.Vector3(Math.sin(a), 0.1, Math.cos(a)).multiplyScalar(14);
        fireInto(bullets.current, b.pos, v, 0.45, Math.max(1, Math.round(b.damage / 2)), b.color, b.size * 0.45, { cluster: 0 });
      }
    };
    bullets.current.forEach((b, i) => {
      const m = bulletMeshes.current[i];
      if (b.active) {
        const px = b.pos.x;
        const pz = b.pos.z;
        b.pos.addScaledVector(b.vel, delta);
        b.life -= delta;
        const hitWall = outOfBounds(b.pos);
        if (hitWall && b.bounce > 0) {
          // bounce off whichever side it ran into
          b.bounce--;
          if (blocked(blocks, b.pos.x, pz, 0.05) || Math.abs(b.pos.x) > HALF) b.vel.x *= -1;
          else b.vel.z *= -1;
          b.pos.set(px, b.pos.y, pz);
        } else if (b.life <= 0 || hitWall) {
          burst(b);
          b.active = false;
        } else {
          for (let ei = 0; ei < enemies.length; ei++) {
            const e = enemies[ei]!;
            if (!e.alive) continue;
            const h = e.kind === "boss" ? 5 : e.kind === "brute" || e.kind === "vanguard" ? 2.6 : 2;
            if (Math.hypot(b.pos.x - e.x, b.pos.z - e.z) < STATS[e.kind].radius + 0.2 && b.pos.y - groundY(e.x, e.z) < h) {
              // a vanguard's slab soaks most of a normal hit; piercing shots go right through it
              let dmg = e.kind === "vanguard" && b.pierce <= 0 ? Math.max(1, Math.round(b.damage * 0.34)) : b.damage;
              if (b.mods & M_EXEC && e.hp < (e.max ?? e.hp) * 0.5) dmg *= 2;
              const lethal = e.hp - dmg * ((e.shredUntil ?? 0) > performance.now() ? 1.3 : 1) <= 0;
              hurtEnemy(e, dmg, ei, b.slow, b.burn, b.knock, b.vel.x, b.vel.z);
              onStat("hit", 1);
              onStat("dmg", dmg);
              if (b.mods & M_SHRED) e.shredUntil = performance.now() + 3000;
              if (b.mods & M_BOUNTY && lethal) {
                onShard(1);
                bountyKills.current++;
                if (bountyKills.current % 6 === 0) onLeech();
              }

              if (b.chain > 0) {
                let left = b.chain;
                for (let oi = 0; oi < enemies.length; oi++) {
                  const o = enemies[oi]!;
                  if (left <= 0) break;
                  if (!o.alive || o === e) continue;
                  if (Math.hypot(o.x - e.x, o.z - e.z) < 6) {
                    hurtEnemy(o, b.damage, oi);
                    left--;
                  }
                }
              }
              if (b.pierce > 0) b.pierce--;
              else {
                burst(b);
                b.active = false;
              }
              break;
            }
          }
        }
      }
      if (m) {
        m.visible = b.active;
        m.position.copy(b.pos);
        if (b.active) {
          m.scale.setScalar(b.size / 0.14);
          (m.material as THREE.MeshBasicMaterial).color.set(b.color);
        }
      }
    });


    // enemy bullets (host simulates them for everyone)
    if (isH) {
      enemyBullets.current.forEach((b, i) => {
        const m = enemyBulletMeshes.current[i];
        if (b.active) {
          b.pos.addScaledVector(b.vel, delta);
          b.life -= delta;
          if (b.life <= 0 || outOfBounds(b.pos)) b.active = false;
          else if (!spectating && b.pos.distanceTo(cam.position) < 0.6) {
            b.active = false;
            takeHit(b.damage);

          }
        }
        if (m) {
          m.visible = b.active;
          m.position.copy(b.pos);
        }
      });

      // broadcast the world to the guests
      if (n) {
        snapTimer.current -= delta;
        if (snapTimer.current <= 0) {
          snapTimer.current = 0.05;
          const e: number[] = [];
          for (const en of enemies) e.push(...packEnemy(en, KINDS));
          const b: number[] = [];
          for (const bu of enemyBullets.current) {
            if (bu.active) b.push(Math.round(bu.pos.x * 100) / 100, Math.round(bu.pos.y * 100) / 100, Math.round(bu.pos.z * 100) / 100);
          }
          const mk: number[] = [];
          pending.current.forEach((pd, i) => {
            if (pd && pd.t <= MARK_TIME) mk.push(i, Math.round(pd.x * 100) / 100, Math.round(pd.z * 100) / 100, Math.round(pd.t * 100) / 100);
          });
          const tr = traffic.current.encode?.();
          const al = encodeAlpine();
          n.broadcast({
            type: "snap", e, b, mk,
            ...(tr ? { tr } : {}),
            ...(al ? { al } : {}),
            p: [pickup.current.x, pickup.current.z, pickup.current.active ? 1 : 0, ORDER.indexOf(pickup.current.gun)],
            h: [heal.current.x, heal.current.z, heal.current.active ? 1 : 0],
            c: [crate.current.x, crate.current.z, crate.current.active ? 1 : 0, CRATE_KINDS.indexOf(crate.current.kind)],
          });
        }
      }
    }

  });

  // runs after the main frame so the gun uses this frame's final camera pose
  useFrame((state, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const cam = state.camera;
    recoil.current = Math.max(0, recoil.current - delta * 6);
    markMeshes.current.forEach((g, i) => {
      if (!g) return;
      const pd = pending.current[i];
      const show = !!pd && pd.t <= MARK_TIME && Math.floor(state.clock.elapsedTime * 6) % 2 === 0;
      g.visible = show;
      if (pd) g.position.set(pd.x, groundY(pd.x, pd.z), pd.z);
    });
    const v = viewModel.current;
    if (!v) return;
    v.visible = !deadRef.current; // spectators carry no weapon

    v.position.copy(cam.position);
    v.quaternion.copy(cam.quaternion);
    const sway = bobAmt.current;
    v.translateX(0.3 + Math.sin(bob.current * 0.5) * 0.012 * sway);
    v.translateY(-0.28 - Math.abs(Math.cos(bob.current * 0.5)) * 0.01 * sway + recoil.current * 0.03);
    v.translateZ(-0.75 + recoil.current * 0.08);
    v.rotateX(recoil.current * 0.15);
  });

  return (
    <>
      {!city && <color attach="background" args={[look3.sky]} />}
      <fog attach="fog" args={[look3.sky, look3.fog[0], look3.fog[1]]} />
      <hemisphereLight args={[look3.hemi[0], look3.hemi[1], look3.hemi[2]]} />
      {look3.ambient > 0 && <ambientLight intensity={look3.ambient} color="#9fb0e0" />}
      {night && !alpineMap && (
        <Stars
          radius={city ? 900 : 90}
          depth={city ? 200 : 20}
          count={city ? 3000 : 1500}
          factor={city ? 26 : 4}
          fade
          speed={0.3}
        />
      )}
      {alpineMap ? (
        <AlpineSun key="sun-alpine" night={night} />
      ) : city ? (
        // city sun: shadow frustum follows the player, auto-off on slow devices
        <CitySun
          key="sun-city"
          night={night}
          color={look3.sun.color}
          intensity={look3.sun.intensity}
        />
      ) : (
        <directionalLight
          key="sun"
          position={look3.sun.pos}
          color={look3.sun.color}
          intensity={look3.sun.intensity}
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
        />
      )}
      {alpineMap ? (
        <AlpineScene layout={alpineMap} night={night} isHost={isHost} playing={locked && !gameOver} />
      ) : city ? (
        <>
          <CityScene city={city} night={night} />
          <CityTraffic city={city} seed={seed} night={night} link={traffic} />
        </>
      ) : (
        <Level blocks={blocks} theme={theme} />
      )}
      {enemies.map((e, i) => (
        <EnemyMesh key={i} data={e} theme={theme} />
      ))}
      {enemies.map((_, i) => (
        <group key={`x${i}`} ref={(g) => { markMeshes.current[i] = g; }} visible={false}>
          <mesh position-y={0.04} rotation-x={-Math.PI / 2} rotation-z={Math.PI / 4}>
            <planeGeometry args={[2, 0.4]} />
            <meshBasicMaterial color="#e8221a" fog={false} />
          </mesh>
          <mesh position-y={0.045} rotation-x={-Math.PI / 2} rotation-z={-Math.PI / 4}>
            <planeGeometry args={[2, 0.4]} />
            <meshBasicMaterial color="#e8221a" fog={false} />
          </mesh>
        </group>
      ))}
      <group ref={pickupMesh} visible={false}>
        <mesh position-y={0.2} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[0.7, 0.9, 24]} />
          <meshBasicMaterial color={GUNS[dropGun].color} fog={false} />
        </mesh>
        <group position-y={1} scale={2.2} rotation-y={Math.PI / 2}>
          <GunModel w={dropGun} />
        </group>
      </group>
      <group ref={healMesh} visible={false}>
        <mesh><boxGeometry args={[0.7, 0.22, 0.22]} /><meshBasicMaterial color="#e8322a" fog={false} /></mesh>
        <mesh><boxGeometry args={[0.22, 0.7, 0.22]} /><meshBasicMaterial color="#e8322a" fog={false} /></mesh>
        <mesh position-y={-0.8} rotation-x={-Math.PI / 2}><ringGeometry args={[0.5, 0.65, 20]} /><meshBasicMaterial color="#e8322a" fog={false} /></mesh>
      </group>
      <group ref={crateMesh} visible={false}>
        <mesh><boxGeometry args={[0.8, 0.8, 0.8]} /><meshStandardMaterial color="#2a2a2a" /></mesh>
        <mesh scale={1.02}><boxGeometry args={[0.82, 0.3, 0.82]} /><meshBasicMaterial color={CRATE_INFO[crateKind].color} fog={false} /></mesh>
        <mesh position-y={-0.6} rotation-x={-Math.PI / 2}><ringGeometry args={[0.6, 0.78, 20]} /><meshBasicMaterial color={CRATE_INFO[crateKind].color} fog={false} /></mesh>
      </group>
      {Array.from({ length: 6 }, (_, i) => (
        <group key={`turret${i}`} ref={(g) => { turretMeshes.current[i] = g; }} visible={false}>
          <mesh position-y={0.35}><cylinderGeometry args={[0.28, 0.36, 0.7, 8]} /><meshStandardMaterial color="#39424d" /></mesh>
          <mesh position-y={0.85}><sphereGeometry args={[0.28, 10, 8]} /><meshStandardMaterial color="#1f2731" /></mesh>
          <mesh position={[0, 0.9, 0.45]} rotation-x={Math.PI / 2}><cylinderGeometry args={[0.07, 0.07, 0.8, 8]} /><meshBasicMaterial color="#4fe3ff" fog={false} /></mesh>
        </group>
      ))}
      {Array.from({ length: 6 }, (_, i) => (
        <group key={`mine${i}`} ref={(g) => { mineMeshes.current[i] = g; }} visible={false}>
          <mesh rotation-x={-Math.PI / 2}><cylinderGeometry args={[0.35, 0.35, 0.12, 10]} /><meshBasicMaterial color="#9fe8ff" fog={false} /></mesh>
          <mesh rotation-x={-Math.PI / 2}><ringGeometry args={[0.5, 0.6, 18]} /><meshBasicMaterial color="#9fe8ff" fog={false} /></mesh>
        </group>
      ))}
      <RemoteDeployables deps={remoteDeps} enemies={enemies} />
      <mesh ref={barrierMesh} visible={false}>
        <sphereGeometry args={[1.6, 16, 12]} />
        <meshBasicMaterial color="#7cc6ff" wireframe transparent opacity={0.45} fog={false} />
      </mesh>
      <group ref={viewModel} scale={0.7}>
        <GunModel w={held} mods={stats.current} />
      </group>
      <RemotePlayers remotes={remotes} />
      <Shards enemies={enemies} active={shardActive} magnet={magnetRef} onCollect={onShard} />
      <BulletPool meshes={bulletMeshes} color="#ff8a1f" size={0.14} />

      <BulletPool meshes={enemyBulletMeshes} color={theme.enemyBullet} size={0.18} />
    </>
  );
}

/** the `window.__rs` test handle: always in dev, and in production builds with `?debug=1` */
function debugHandles() {
  if (import.meta.env.DEV) return true;
  return (
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("debug") === "1"
  );
}

/** `?map=vice` (case-insensitive name substring), `?map=city` (layout type) or `?map=3` (index) forces the solo map for testing. */
function forcedMapIndex(): number | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("map");
  if (!raw) return null;
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 0 && n < THEMES.length) return n;
  const q = raw.toLowerCase();
  const i = THEMES.findIndex((t) => t.name.toLowerCase().includes(q) || t.blockShape === q);
  return i >= 0 ? i : null;
}
const NIGHT_KEY = "dustfield-night";
/** `?night=1` / `?night=0` overrides the saved preference (without overwriting it). */
function nightOverride(): boolean | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("night");
  return raw === "1" ? true : raw === "0" ? false : null;
}

const CITY_MAP = THEMES.findIndex((t) => t.blockShape === "city");
/** Every visit opens on the city unless `?map=` names another; the start-menu picker
 * switches for the rest of the visit. null = random. */
function initialMapChoice(): number | null {
  return forcedMapIndex() ?? CITY_MAP;
}

/** New arena seed. With a picked map the seed is nudged onto it, so a co-op host's
 * guests (who derive the map from the shared seed) land on the same one. */
function newSeed(choice: number | null) {
  const s = Math.floor(Math.random() * 1e9);
  return choice === null ? s : s - (s % THEMES.length) + choice;
}

export function Game() {
  const [mapChoice, setMapChoice] = useState(initialMapChoice);
  const mapChoiceRef = useRef(mapChoice);
  mapChoiceRef.current = mapChoice;
  const [seed, setSeed] = useState(() => newSeed(mapChoice));
  const [night, setNight] = useState(false);
  useEffect(() => {
    const o = nightOverride();
    if (o !== null) setNight(o);
    else setNight(localStorage.getItem(NIGHT_KEY) === "1");
  }, []);
  const toggleNight = () => {
    setNight((v) => {
      localStorage.setItem(NIGHT_KEY, v ? "0" : "1");
      return !v;
    });
  };
  const toggleNightRef = useRef(toggleNight);
  toggleNightRef.current = toggleNight;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "KeyN" || e.repeat) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      toggleNightRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const [score, setScore] = useState(0);
  const [health, setHealth] = useState(MAX_HP);
  const [locked, setLocked] = useState(false);
  const pausedRef = useRef(false);
  pausedRef.current = !locked;
  const [started, setStarted] = useState(false);
  const [status, setStatus] = useState({ wave: 1, remaining: 0, won: false });
  const [banner, setBanner] = useState(false);
  const [hurtFlash, setHurtFlash] = useState(0);
  const [weapon, setWeapon] = useState<Weapon>("pistol");
  const [bossHp, setBossHp] = useState(0);
  const [pickupMsg, setPickupMsg] = useState(false);
  const [crateMsg, setCrateMsg] = useState<string | null>(null);
  const [deploys, setDeploys] = useState({ turret: 0, mines: 0 });

  const [ammoLeft, setAmmoLeft] = useState(0);
  const [inv, setInv] = useState<{ w: Weapon; ammo: number }[]>([{ w: "pistol", ammo: 0 }]);
  const slotOf = (w: Weapon) => inv.findIndex((s) => s.w === w) + 1;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showWeapons, setShowWeapons] = useState(false);
  const [fov, setFov] = useState(75);
  const [sensX, setSensX] = useState(1);
  const [sensY, setSensY] = useState(1);
  const [healMsg, setHealMsg] = useState(0);
  const [musicVol, setMusicVol] = useState(0.5);
  const [sfxVol, setSfxVol] = useState(0.7);
  const [shards, setShards] = useState(0);
  const [ability, setAbility] = useState<AbilityId>(() => {
    if (typeof window === "undefined") return "dash";
    const saved = window.localStorage.getItem("df-ability") as AbilityId | null;
    return saved && ABILITIES[saved] ? saved : "dash";
  });
  const [abilCd, setAbilCd] = useState({ left: 0, max: 6 });
  const [eventMsg, setEventMsg] = useState<string | null>(null);
  // run tally for the post-game recap
  const run = useRef({ shots: 0, hits: 0, dmg: 0, taken: 0, shards: 0 });
  const [squad, setSquad] = useState<Record<number, { kills: number; dmg: number; acc: number; shards: number; taken: number }>>({});
  const [perks, setPerks] = useState<Perks>(NO_PERKS);
  const perksRef = useRef(perks);
  perksRef.current = perks;
  const statsRef = useRef<Derived>(derive(perks));
  statsRef.current = derive(perks);
  const maxHp = statsRef.current.maxHp;

  // ---------- co-op room ----------
  const [net, setNet] = useState<NetHandle | null>(null);
  const [peerCount, setPeerCount] = useState(0);
  const [joining, setJoining] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [netError, setNetError] = useState("");
  const [allDown, setAllDown] = useState(false);
  const remotes = useRef(new Map<string, RemoteState>());
  const msgSink = useRef<(m: NetMsg) => void>(() => {});
  const seedRef = useRef(seed);
  seedRef.current = seed;
  const netHolder = useRef<NetHandle | null>(null);
  const healthRef = useRef(MAX_HP);
  healthRef.current = health;
  // player numbers: host is always 1, guests take 2-4 in join order
  const slots = useRef<Record<string, number>>({});
  const [roster, setRoster] = useState<{ id: string; num: number }[]>([]);
  // lets network messages kick off / resume the match, and keeps pause state handy
  const startRef = useRef<(fromNet?: boolean) => void>(() => {});
  const phase = useRef({ started: false, ended: false });

  const publishRoster = () => {
    const list = Object.entries(slots.current)
      .map(([id, num]) => ({ id, num }))
      .sort((a, b) => a.num - b.num);
    setRoster(list);
    remotes.current.forEach((r) => {
      r.num = r.id === "host" ? 1 : (slots.current[r.id] ?? r.num);
      r.color = colorFor(r.num);
    });
    netHolder.current?.broadcast({ type: "roster", slots: { ...slots.current } });
  };

  const handleMsg = (m: NetMsg) => {
    if (m.type === "roster") {
      slots.current = (m.slots ?? {}) as Record<string, number>;
      setRoster(
        Object.entries(slots.current)
          .map(([id, num]) => ({ id, num: Number(num) }))
          .sort((a, b) => a.num - b.num),
      );
      remotes.current.forEach((r) => {
        r.num = r.id === "host" ? 1 : (slots.current[r.id] ?? r.num);
        r.color = colorFor(r.num);
      });
      return;
    }
    if (m.type === "seed") {
      run.current = { shots: 0, hits: 0, dmg: 0, taken: 0, shards: 0 };
      setSquad({});
      setSeed(Number(m.seed));
      setScore(0);
      setHealth(MAX_HP);
      setPerks(NO_PERKS);
      setShards(0);
      setAllDown(false);
      setStatus({ wave: 1, remaining: 0, won: false });
      setWeapon("pistol");
      setBossHp(0);
      return;
    }
    if (m.type === "over") { setAllDown(true); return; }
    if (m.type === "event") { setEventMsg(String(m.name)); return; }
    if (m.type === "statline") {
      const num = Number(m.num);
      setSquad((q) => ({ ...q, [num]: { kills: Number(m.kills), dmg: Number(m.dmg), acc: Number(m.acc), shards: Number(m.shards), taken: Number(m.taken) } }));
      return;
    }
    if (m.type === "pause") {
      setLocked(false);
      if (document.pointerLockElement) document.exitPointerLock();
      return;
    }
    if (m.type === "resume") { startRef.current(true); return; }
    if (m.type === "begin") { startRef.current(true); return; }
    if (m.type === "joined") {
      const id = String(m.from);
      if (!slots.current[id]) {
        const used = new Set(Object.values(slots.current));
        for (let n = 2; n <= 4; n++) if (!used.has(n)) { slots.current[id] = n; break; }
      }
      netHolder.current?.sendTo(id, { type: "seed", seed: seedRef.current });
      publishRoster();
    }
    if (m.type === "left") {
      delete slots.current[String(m.from)];
      publishRoster();
    }
    if (m.type === "status" && m.banner) setHealth((h) => (h <= 0 ? derive(perksRef.current).maxHp : h));
    if (m.type === "hurt") setHurtFlash((x) => x + 1);
    msgSink.current(m);
  };
  const handleMsgRef = useRef(handleMsg);
  handleMsgRef.current = handleMsg;

  const startHost = async () => {
    setNetError("");
    setJoining(true);
    try {
      const h = await hostRoom({
        onMsg: (m) => handleMsgRef.current(m),
        onPeers: (ids) => setPeerCount(ids.length),
      });
      netHolder.current = h;
      setNet(h);
    } catch {
      setNetError("Couldn't open a room. Check your connection and try again.");
    }
    setJoining(false);
  };

  const startJoin = async () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length < 4) { setNetError("Enter the 4-letter code."); return; }
    setNetError("");
    setJoining(true);
    try {
      const h = await joinRoom(code, {
        onMsg: (m) => handleMsgRef.current(m),
        onPeers: () => setPeerCount(1),
        onClose: () => setNetError("Lost connection to the host."),
      });
      netHolder.current = h;
      setNet(h);
      setPeerCount(1);
    } catch {
      setNetError("No arena found with that code.");
    }
    setJoining(false);
  };

  const leaveRoom = () => {
    netHolder.current?.close();
    netHolder.current = null;
    remotes.current.clear();
    slots.current = {};
    setRoster([]);
    setNet(null);
    setPeerCount(0);
    setAllDown(false);
  };

  /** quit a match in progress and go back to the title screen */
  const leaveGame = () => {
    leaveRoom();
    setLocked(false);
    setStarted(false);
    setScore(0);
    setHealth(MAX_HP);
    setPerks(NO_PERKS);
    setShards(0);
    setBossHp(0);
    setStatus({ wave: 1, remaining: 0, won: false });
    setWeapon("pistol");
    setSeed(newSeed(mapChoiceRef.current));
    if (document.pointerLockElement) document.exitPointerLock();
  };

  // host: end the run when the whole squad is down
  useEffect(() => {
    if (!net || net.role !== "host") return;
    const id = window.setInterval(() => {
      const list = [...remotes.current.values()].filter((r) => performance.now() - r.last < 5000);
      if (healthRef.current <= 0 && list.length > 0 && list.every((r) => r.hp <= 0)) {
        net.broadcast({ type: "over" });
        setAllDown(true);
      }
    }, 800);
    return () => window.clearInterval(id);
  }, [net]);

  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem("dustfield-settings") ?? "{}");
      if (typeof v.fov === "number") setFov(v.fov);
      if (typeof v.sensX === "number") setSensX(v.sensX);
      else if (typeof v.sens === "number") setSensX(v.sens);
      if (typeof v.sensY === "number") setSensY(v.sensY);
      else if (typeof v.sens === "number") setSensY(v.sens);
      if (typeof v.musicVol === "number") setMusicVol(v.musicVol);
      if (typeof v.sfxVol === "number") setSfxVol(v.sfxVol);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    localStorage.setItem("dustfield-settings", JSON.stringify({ fov, sensX, sensY, musicVol, sfxVol }));
  }, [fov, sensX, sensY, musicVol, sfxVol]);
  useEffect(() => {
    if (!healMsg) return;
    const t = window.setTimeout(() => setHealMsg(0), 1500);
    return () => window.clearTimeout(t);
  }, [healMsg]);

  useEffect(() => {
    if (!pickupMsg) return;
    const t = window.setTimeout(() => setPickupMsg(false), 2000);
    return () => window.clearTimeout(t);
  }, [pickupMsg]);

  useEffect(() => {
    if (!crateMsg) return;
    const t = window.setTimeout(() => setCrateMsg(null), 2200);
    return () => window.clearTimeout(t);
  }, [crateMsg]);

  const coop = !!net;
  const mapFeed = useRef<MapFeed>({
    x: 0,
    z: 0,
    yaw: 0,
    items: [
      { x: 0, z: 0, kind: "gun", color: "#ffffff", active: false },
      { x: 0, z: 0, kind: "heal", color: "#e8322a", active: false },
      { x: 0, z: 0, kind: "crate", color: "#9fe8ff", active: false },
    ],
  });
  const { blocks, enemies, rand, theme, city } = useMemo(() => {
    // the map decides the layout, so pick the theme first (still purely from the shared seed)
    const forced = !coop && mapChoice !== null ? THEMES[mapChoice] : undefined;
    const theme = forced ?? THEMES[seed % THEMES.length]!;
    // co-op gets a bigger field; the real-scale city is far bigger and routes on 4 m nav cells
    const mode = layoutOf(theme);
    if (mode === "city") setArenaSize(coop ? CITY_COOP : CITY_SOLO, 2);
    // the alpine map is always the full co-op size; solo seals a smaller square with blockades
    else if (mode === "alpine") setArenaSize(ALPINE_SIZE, 2);
    else setArenaSize(coop ? COOP_ARENA : SOLO_ARENA);
    const level = generateLevel(seed, mode, !coop);
    const alp = level.city && "alpine" in level.city ? (level.city as AlpineLayout).alpine : null;
    setTerrain(alp ? alp.terrain : null);
    resetAlpine(alp !== null);
    // the city generator keeps its own spawn plaza clear and every cell reachable;
    // trimming its blocks here would leave buildings without collision
    if (!level.city) {
      level.blocks = level.blocks.filter(
        (b) => Math.max(Math.abs(b.x), Math.abs(b.z)) > BLOCK / 2 + 2.5,
      );
    }
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
      slow: 0,
      burn: 0,
      burnTick: 0,
    }));
    return { blocks: level.blocks, enemies: list, rand: level.rand, theme, city: level.city };
  }, [seed, coop, mapChoice]);


  useEffect(() => {
    // pausing puts the whole squad on hold
    const pauseAll = () => {
      if (phase.current.started && !phase.current.ended) netHolder.current?.broadcast({ type: "pause" });
    };
    const wasLocked = { v: false };
    const onChange = () => {
      if (document.pointerLockElement) wasLocked.v = true;
      else if (wasLocked.v) {
        wasLocked.v = false;
        setLocked(false);
        pauseAll();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape") {
        setLocked(false);
        pauseAll();
      }
    };
    document.addEventListener("pointerlockchange", onChange);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerlockchange", onChange);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem("df-ability", ability);
  }, [ability]);
  useEffect(() => {
    if (!eventMsg) return;
    const t = window.setTimeout(() => setEventMsg(null), 3500);
    return () => window.clearTimeout(t);
  }, [eventMsg]);
  useEffect(() => {
    if (!banner) return;
    const t = window.setTimeout(() => setBanner(false), 1800);
    return () => window.clearTimeout(t);
  }, [banner, status.wave]);

  const multiplayer = !!net;
  const dead = health <= 0;
  const gameOver = multiplayer ? allDown : dead;
  const ended = gameOver || status.won;
  const isHost = !net || net.role === "host";
  // start-menu map picker: the host (or a solo player) rolls a seed that lands on the pick
  const pickMap = (choice: number | null) => {
    if (!isHost) return;
    setMapChoice(choice);
    const s = newSeed(choice);
    setSeed(s);
    net?.broadcast({ type: "seed", seed: s });
  };
  const myNum = !net || net.role === "host" ? 1 : (roster.find((r) => r.id === net.self)?.num ?? 2);
  const connected = [{ id: "host", num: 1 }, ...roster];
  const paused = started && !ended && !locked;
  // teammate health lives in a ref: nudge the HUD so it stays current
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!net) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 250);
    return () => window.clearInterval(id);
  }, [net]);

  // hand my run report to the rest of the squad
  useEffect(() => {
    if (!ended) return;
    const r = run.current;
    netHolder.current?.broadcast({
      type: "statline", num: myNum, kills: score, dmg: Math.round(r.dmg),
      acc: r.shots ? Math.round((r.hits / r.shots) * 100) : 0, shards: r.shards, taken: r.taken,
    });
  }, [ended]); // eslint-disable-line react-hooks/exhaustive-deps

  // free the mouse when the round ends so the button can be clicked
  useEffect(() => {
    if (ended && document.pointerLockElement) document.exitPointerLock();
  }, [ended]);

  const start = (fromNet = false) => {
    initAudio();
    if (!fromNet && ended && !isHost) return; // only the host starts a new arena
    const resuming = started && !ended;
    setStarted(true);
    if (ended && !fromNet) {
      run.current = { shots: 0, hits: 0, dmg: 0, taken: 0, shards: 0 };
      setSquad({});
      if (isHost) {
        const s = newSeed(mapChoiceRef.current);
        setSeed(s);
        net?.broadcast({ type: "seed", seed: s });
      }
      setScore(0);
      setHealth(MAX_HP);
      setPerks(NO_PERKS);
      setShards(0);
      setAllDown(false);
      setStatus({ wave: 1, remaining: 0, won: false });
      setWeapon("pistol");
      setBossHp(0);
    }
    setLocked(true);
    // the whole squad starts and resumes together
    if (!fromNet && net && (resuming || isHost)) net.broadcast({ type: resuming ? "resume" : "begin" });
    try {
      const r = wrapRef.current?.requestPointerLock() as unknown as Promise<void> | undefined;
      r?.catch?.(() => {});
    } catch {
      /* pointer lock unavailable — arrow keys still work */
    }
  };
  startRef.current = start;

  // a wave counts as fought once it had enemies (score is personal, so guests may have 0 kills)
  const [fought, setFought] = useState(0);
  useEffect(() => {
    if (status.remaining > 0) setFought(status.wave);
    else if (status.wave === 1 && !started) setFought(0);
  }, [status.remaining, status.wave, started]);
  // ---- shop: open during the break after a cleared wave ----
  // NOTE: the break itself does not depend on pointer lock, so pausing and
  // resuming keeps the same cards and remembers the ones already bought.
  const shopBreak = started && !ended && !dead && status.remaining === 0 && fought === status.wave && status.wave < WAVES.length;
  const shopOpen = shopBreak && locked;
  const [offers, setOffers] = useState<PerkId[]>([]);
  const [bought, setBought] = useState<number[]>([]);
  const [shopLeft, setShopLeft] = useState(10);
  const lastOffered = useRef<PerkId[]>([]);
  useEffect(() => {
    if (!shopBreak) return;
    // cards can repeat, just never two rounds in a row; maxed pistol mods drop out
    const avail = PERK_IDS.filter((p) => perkAvailable(p, perksRef.current));
    let pool = avail.filter((p) => !lastOffered.current.includes(p));
    if (pool.length < 3) pool = avail;
    const picks = [...pool].sort(() => Math.random() - 0.5).slice(0, 3);
    lastOffered.current = picks;
    setOffers(picks);
    setBought([]);
    setShopLeft(10);
    // the countdown holds while the game is paused
    const id = setInterval(() => { if (!pausedRef.current) setShopLeft((s) => Math.max(0, s - 1)); }, 1000);
    return () => clearInterval(id);
  }, [shopBreak, status.wave]);
  const buyRef = useRef<(i: number) => void>(() => {});
  buyRef.current = (i: number) => {
    const id = offers[i];
    if (!shopOpen || !id || bought.includes(i)) return;
    const cost = perkCost(id, perks[id]);
    if (shards < cost) { playSfx("deny"); return; }
    setShards((s) => s - cost);
    setBought((b) => [...b, i]);
    playSfx("buy");
    if (id === "heal") { setHealth((h) => Math.min(maxHp, h + 5)); return; }
    setPerks((p) => ({ ...p, [id]: p[id] + 1 }));
    if (id === "maxhp") setHealth((h) => h + 2);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const i = SHOP_KEYS.indexOf(e.code);
      if (i >= 0) buyRef.current(i);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // regen perk
  useEffect(() => {
    if (!perks.regen || !started || !locked || ended || dead) return;
    const id = window.setInterval(() => setHealth((h) => (h > 0 ? Math.min(maxHp, h + 1) : h)), 14000 / perks.regen);
    return () => window.clearInterval(id);
  }, [perks.regen, started, locked, ended, dead, maxHp]);

  // soundtrack
  useEffect(() => {
    if (started && locked && !ended) startMusic();
    else stopMusic();
  }, [started, locked, ended]);
  useEffect(() => setMusicIntensity(status.wave === WAVES.length && !status.won), [status.wave, status.won]);
  useEffect(() => setMusicTheme(theme.name), [theme.name]);
  useEffect(() => setVolumes(musicVol, sfxVol), [musicVol, sfxVol]);
  useEffect(() => () => stopMusic(), []);
  phase.current = { started, ended };

  // HUD status lists
  const activeMods = PISTOL_MODS.filter((id) => perks[id] > 0);
  const activePerks = PERK_IDS.filter((id) => !PISTOL_MODS.includes(id) && id !== "heal" && perks[id] > 0)
    .map((id) => ({ id, label: perkBadge(id, perks[id]) }))
    .filter((p): p is { id: PerkId; label: string } => p.label !== null);



  return (
    <div ref={wrapRef} className="fixed inset-0 cursor-crosshair select-none">
      <Canvas shadows="percentage" dpr={[1, 1.6]} gl={{ powerPreference: "high-performance", antialias: true }} camera={{ position: [0, EYE, 0], fov: 75, near: 0.1, far: 120 }}>
        <World
          blocks={blocks}
          enemies={enemies}
          rand={rand}
          theme={theme}
          locked={locked}
          gameOver={ended}
          onScore={() => setScore((s) => s + 1)}
          onHurt={(dmg = 1) => {
            setHealth((h) => Math.max(0, h - dmg));
            setHurtFlash((n) => n + 1);
            playSfx("hurt");
          }}

          onStatus={(wave, remaining, won, showBanner) => {
            setStatus({ wave, remaining, won });
            if (showBanner) {
              setBanner(true);
              if (multiplayer) setHealth((h) => (h <= 0 ? maxHp : h));
            }
          }}
          onBoss={(hp) => {
            setBossHp(hp);
            if (isHost) net?.broadcast({ type: "boss", hp });
          }}
          onAmmo={setAmmoLeft}
          onHeal={() => {
            setHealth((h) => Math.min(maxHp, h + 3));
            playSfx("pickup");
            setHealMsg((n) => n + 1);
          }}
          sensX={sensX}
          sensY={sensY}
          fov={fov}
          net={net}
          remotes={remotes}
          dead={dead}
          players={multiplayer ? peerCount + 1 : 1}
          msgSink={msgSink}
          health={health}
          slots={slots}
          stats={statsRef}
          onShard={(v) => {
            const gain = Math.max(1, Math.round(v * statsRef.current.greed * (multiplayer ? 1 + 0.5 * peerCount : 1)));
            run.current.shards += gain;
            setShards((s) => s + gain);
            playSfx("shard");
          }}
          onLeech={() => {
            setHealth((h) => (h > 0 ? Math.min(maxHp, h + 1) : h));
            playSfx("pickup");
          }}
          onCrate={(kind) => {
            playSfx("pickup");
            if (kind === "shield") setHealth((h) => (h > 0 ? Math.min(maxHp + 5, h + 5) : h));
            setCrateMsg(CRATE_INFO[kind].name);
          }}
          onDeploys={setDeploys}
          city={city}
          seed={seed}
          night={night}
          ability={ability}
          onAbilityCd={(left, max) => setAbilCd((c) => (Math.abs(c.left - left) < 0.05 && c.max === max ? c : { left, max }))}
          onStat={(k, n) => {
            const r = run.current;
            if (k === "shot") r.shots += n;
            else if (k === "hit") r.hits += n;
            else if (k === "dmg") r.dmg += n;
            else r.taken += n;
          }}
          onEvent={setEventMsg}
          mapFeed={mapFeed}



          onWeapon={(w, picked) => {
            setWeapon(w);
            if (picked) setPickupMsg(true);
          }}
          onInv={setInv}

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
          <div className="flex flex-col items-start gap-2">
            <div className="rounded-md bg-[#f3e6cf]/80 px-3 py-1.5 text-sm tracking-widest">
              {theme.name.toUpperCase()}
            </div>
            <div className="rounded-md bg-[#f3e6cf]/80 px-3 py-1.5 text-sm tracking-widest">
              WAVE {status.wave}/{WAVES.length}
            </div>
            <div className="rounded-md bg-[#f3e6cf]/80 px-3 py-1.5 text-sm tracking-widest">
              KILLS {score}
            </div>


          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="rounded-md bg-[#f3e6cf]/80 px-3 py-1.5 text-sm tracking-widest">
              {"♦".repeat(Math.max(0, health))}
              <span className="opacity-30">{"♦".repeat(Math.max(0, maxHp - health))}</span>
            </div>
            <div className="rounded-md bg-[#f3e6cf]/80 px-3 py-1.5 text-sm tracking-widest">
              <span className="text-[#1aa6b8]">◆</span> {shards}
            </div>
          </div>
        </div>

        <div className="absolute left-1/2 top-5 flex max-w-[calc(100vw-26rem)] -translate-x-1/2 flex-wrap justify-center gap-2">
          {inv.map((slot, i) => {
            const g = GUNS[slot.w];
            const active = slot.w === weapon;
            return (
              <div
                key={slot.w}
                className={`relative rounded-md border px-3 py-1.5 text-xs tracking-widest ${
                  active
                    ? "border-[#2b2118] bg-[#f3e6cf] text-[#2b2118]"
                    : "border-transparent bg-[#f3e6cf]/55 text-[#2b2118]/70"
                }`}
              >
                <span
                  className="absolute -left-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#2b2118] text-[10px] font-bold text-[#f7eeda]"
                >
                  {i === 9 ? 0 : i + 1}
                </span>
                <span style={{ color: g.color }}>■</span> {g.name}{" "}
                <b>{active ? ammoLeft : slot.ammo}</b>
                {slot.w === "pistol" && (
                  <div className="mt-0.5 flex justify-center gap-1">
                    {Array.from({ length: MOD_SLOTS }, (_, k) => (
                      <span key={k} className={`h-1.5 w-1.5 rounded-full border border-[#2b2118] ${k < modsEquipped(perks) ? "bg-[#2b2118]" : ""}`} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {bossHp > 0 && locked && !ended && (
          <div className="absolute left-1/2 top-20 w-80 -translate-x-1/2 text-center text-xs tracking-[0.3em] text-[#2b2118]">

            <div className="mb-1 rounded bg-[#f3e6cf]/80 py-0.5">{theme.boss.name}</div>
            <div className="h-3 overflow-hidden rounded bg-[#2b2118]/60">
              <div className="h-full bg-[#b3261e]" style={{ width: `${Math.min(100, (bossHp / BOSS_HP) * 100)}%` }} />
            </div>
          </div>
        )}
        {banner && locked && !ended && (
          <div className="absolute left-1/2 top-1/3 -translate-x-1/2 rounded-lg bg-[#2b2118]/80 px-6 py-3 text-center text-2xl font-bold tracking-[0.3em] text-[#f3e6cf]">
            {status.wave === WAVES.length ? (
              <>
                {theme.boss.name}
                <div className="mt-1 text-xs tracking-[0.3em] text-[#e7b25c]">{theme.hazard.name}</div>
              </>
            ) : (
              `WAVE ${status.wave}`
            )}
          </div>
        )}

        {pickupMsg && locked && !ended && (
          <div className="absolute left-1/2 top-[58%] -translate-x-1/2 rounded-lg bg-[#2b2118]/80 px-4 py-2 text-sm tracking-[0.25em] text-[#f3e6cf]">
            {GUNS[weapon].name} ACQUIRED · PRESS {slotOf(weapon) === 10 ? 0 : slotOf(weapon) || 1}
          </div>
        )}
        {crateMsg && locked && !ended && (
          <div className="absolute left-1/2 top-[63%] -translate-x-1/2 rounded-lg bg-[#2b2118]/80 px-4 py-2 text-sm tracking-[0.25em] text-[#9fe8ff]">
            {crateMsg} DEPLOYED
          </div>
        )}
        {locked && !ended && (
          <div className="absolute bottom-6 left-5 rounded-md bg-[#f3e6cf]/80 px-3 py-1.5 text-xs tracking-widest">
            [F] {ABILITIES[ability].name} ·{" "}
            {abilCd.left > 0 ? <span className="opacity-50">{Math.ceil(abilCd.left)}s</span> : <b>READY</b>}
          </div>
        )}
        {eventMsg && locked && !ended && (
          <div className="absolute left-1/2 top-[22%] -translate-x-1/2 rounded-lg bg-[#b3261e]/90 px-6 py-2 text-center text-lg font-bold tracking-[0.3em] text-[#f7eeda]">
            ⚠ {eventMsg} ⚠
          </div>
        )}
        {locked && !ended && (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <div className="h-5 w-[2px] bg-[#2b2118]/70" />
            <div className="absolute left-1/2 top-1/2 h-[2px] w-5 -translate-x-1/2 -translate-y-1/2 bg-[#2b2118]/70" />
          </div>
        )}
        {city && started && !ended && (
          <div className="absolute bottom-5 right-5">
            <Minimap
              city={city}
              blocks={blocks}
              feed={mapFeed}
              enemies={enemies}
              remotes={remotes}
              myColor={colorFor(myNum)}
            />
          </div>
        )}
        {multiplayer && locked && !ended && (
          <div className="absolute right-5 top-[7.5rem] space-y-1 text-right font-mono text-xs tracking-widest text-[#2b2118]">
            <div className="rounded bg-[#f3e6cf]/80 px-2 py-1">ROOM {net?.code} · {peerCount + 1} PLAYERS</div>
            {[...remotes.current.values()].map((r) => (
              <div key={r.id} className="flex items-center justify-end gap-2 rounded bg-[#f3e6cf]/80 px-2 py-1">
                <span style={{ color: r.color, WebkitTextStroke: "0.5px #2b2118" }}>■</span>
                <span className="opacity-70">{r.num === 1 ? "HOST" : `P${r.num}`}</span>
                {r.hp > 0 ? (
                  <span>
                    {"♦".repeat(Math.max(0, Math.min(MAX_HP, Math.round(r.hp))))}
                    <span className="opacity-30">{"♦".repeat(Math.max(0, MAX_HP - Math.round(r.hp)))}</span>
                  </span>
                ) : (
                  <span className="text-[#b3261e]">DOWN</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {shopOpen && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-10 font-mono text-[#2b2118]">
          <div className="mb-2 text-center text-xs tracking-[0.3em] text-[#f3e6cf] [text-shadow:0_1px_2px_#2b2118]">
            SHOP · NEXT WAVE IN {shopLeft}s · {shards} SHARDS
          </div>
          <div className="flex justify-center gap-3">
            {offers.map((id, i) => {
              const info = PERK_INFO[id];
              const cost = perkCost(id, perks[id]);
              if (bought.includes(i)) return null;
              const sold = false;
              return (
                <div
                  key={i}
                  className="relative w-44 rounded-lg border-2 border-[#000] bg-[#f3e6cf]/95 p-3 text-center text-[#000]"
                >
                  <span className="absolute -left-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-[#2b2118] text-xs font-bold text-[#f7eeda]">
                    {SHOP_KEYS[i]!.slice(3)}
                  </span>
                  <div className="text-xs font-bold tracking-widest">{info.name}</div>
                  <div className="mt-1 text-[11px] leading-snug opacity-80">{info.desc}</div>
                  {id !== "heal" && <div className="mt-1 text-[10px] opacity-50">LEVEL {perks[id]}</div>}
                  <div className="mt-2 text-sm font-bold">{sold ? "BOUGHT" : `◆ ${cost}`}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {healMsg > 0 && locked && !ended && (
        <div className="pointer-events-none fixed left-1/2 top-1/3 z-10 -translate-x-1/2 rounded-md bg-[#f3e6cf]/85 px-4 py-1.5 font-mono text-sm tracking-widest text-[#b3261e]">
          +3 HEALTH
        </div>
      )}
      {multiplayer && dead && !ended && locked && (
        <div className="pointer-events-none fixed left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-lg bg-[#2b2118]/85 px-8 py-5 text-center font-mono text-[#f3e6cf]">
          <div className="text-2xl font-bold tracking-[0.3em] text-[#e8322a]">YOU DIED</div>
          <div className="mt-2 text-xs tracking-[0.25em] opacity-80">SPECTATING · YOU RESPAWN NEXT WAVE</div>
          <div className="mt-1 text-[11px] tracking-[0.2em] opacity-50">WALK AROUND FREELY · ESC TO PAUSE</div>
        </div>
      )}


      {(!locked || ended) && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-[#2b2118]/70 p-6">
          <div className="max-h-full max-w-sm overflow-y-auto rounded-xl bg-[#f3e6cf] p-7 text-center font-mono text-[#2b2118] shadow-2xl">
            <h1 className="text-2xl font-bold tracking-tight">
              {gameOver ? "You got swarmed" : status.won ? "Arena cleared!" : paused ? "Paused" : theme.name}
            </h1>
            <p className="mt-2 text-sm opacity-70">
              {gameOver
                ? `You fell on wave ${status.wave} with ${score} kills.`
                : status.won
                  ? `All ${WAVES.length} waves survived · ${score} kills.`
                  : paused
                    ? `Wave ${status.wave} · ${score} kills so far.`
                    : `Survive ${WAVES.length} waves, then face ${theme.boss.name}. Die and you lose every gun but the pistol.`}
            </p>
            {!paused && (
              <p className="mt-4 text-xs leading-relaxed opacity-60">
                WASD to move · mouse or arrow keys to look · hold Space to shoot · F for your
                ability · 1-0 / Q E swap guns · N day/night · Esc to pause
              </p>
            )}
            {multiplayer && !isHost && (ended || !started) ? (
              <div className="mt-6 rounded-md bg-[#2b2118]/10 px-6 py-2 text-xs tracking-widest opacity-70">
                {ended ? "WAITING FOR THE HOST TO START A NEW ARENA" : "WAITING FOR THE HOST TO START"}
              </div>
            ) : (
              <button
                onClick={() => start()}
                className="pointer-events-auto mt-6 rounded-md bg-[#b4653f] px-6 py-2 text-sm font-semibold tracking-widest text-[#f7eeda] transition-transform hover:scale-105"
              >
                {ended ? "NEW ARENA" : started ? "RESUME" : "CLICK TO PLAY"}
              </button>
            )}

            {ended && (() => {
              const r = run.current;
              const acc = r.shots ? Math.round((r.hits / r.shots) * 100) : 0;
              const mine = { kills: score, dmg: Math.round(r.dmg), acc, shards: r.shards, taken: r.taken };
              const rows = [{ num: myNum, ...mine }, ...Object.entries(squad)
                .filter(([n]) => Number(n) !== myNum)
                .map(([n, v]) => ({ num: Number(n), ...v }))]
                .sort((a, b) => a.num - b.num);
              const badges: string[] = [];
              if (acc >= 60) badges.push("SHARPSHOOTER");
              if (rows.every((x) => mine.dmg >= x.dmg)) badges.push("HEAVY GUNNER");
              if (rows.every((x) => mine.shards >= x.shards)) badges.push("SCAVENGER");
              if (rows.every((x) => mine.taken <= x.taken)) badges.push("IRON WILL");
              if (status.won) badges.push("BOSS SLAYER");
              return (
                <div className="mt-5 text-left text-black">
                  <div className="text-[9px] tracking-[0.25em] opacity-50">RUN REPORT</div>
                  <div className="mt-2 space-y-1 text-[11px] tracking-wider">
                    <div>WAVES SURVIVED · {status.won ? WAVES.length : Math.max(0, status.wave - 1)}</div>
                    <div>KILLS · {mine.kills}</div>
                    <div>DAMAGE DEALT · {mine.dmg}</div>
                    <div>ACCURACY · {acc}%</div>
                    <div>SHARDS COLLECTED · {mine.shards}</div>
                    <div>DAMAGE TAKEN · {mine.taken}</div>
                  </div>
                  {badges.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-bold tracking-wider">
                      {badges.map((b) => <span key={b}>{b}</span>)}
                    </div>
                  )}
                  {multiplayer && rows.length > 1 && (
                    <div className="mt-3 space-y-1 text-[10px] tracking-wider">
                      <div className="text-[9px] tracking-[0.25em] opacity-50">SQUAD</div>
                      {rows.map((x) => (
                        <div key={x.num} className="flex items-center gap-2">
                          <span style={{ color: colorFor(x.num), WebkitTextStroke: "0.5px #2b2118" }}>■</span>
                          <span>{x.num === 1 ? "HOST" : `P${x.num}`}</span>
                          <span className="opacity-60">{x.kills} kills · {x.dmg} dmg · {x.acc}%</span>
                          {x.num === myNum && <span className="opacity-40">(YOU)</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            {(!started || ended) && !paused && (
              <div className="mt-5 text-left text-black">
                <div className="text-[9px] tracking-[0.25em] opacity-50">
                  {isHost ? "MAP" : "MAP · THE HOST PICKS"}
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1">
                  {([null, ...THEMES.map((_, i) => i)] as (number | null)[]).map((i) => {
                    const on = isHost ? mapChoice === i : i === seed % THEMES.length;
                    return (
                      <button
                        key={i ?? "random"}
                        onClick={() => pickMap(i)}
                        disabled={!isHost}
                        className={`pointer-events-auto rounded px-2 py-1 text-[10px] font-bold tracking-wider ${
                          on ? "bg-[#2b2118] text-[#f7eeda]" : "bg-[#2b2118]/10"
                        } ${isHost ? "" : "cursor-default"}`}
                      >
                        {i === null ? "RANDOM" : THEMES[i]!.name.toUpperCase()}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-4 text-[9px] tracking-[0.25em] opacity-50">ABILITY · PRESS F IN GAME</div>
                <div className="mt-2 grid grid-cols-2 gap-1">
                  {ABILITY_IDS.map((id) => (
                    <button
                      key={id}
                      onClick={() => setAbility(id)}
                      className={`pointer-events-auto rounded px-2 py-1 text-[10px] font-bold tracking-wider ${
                        ability === id ? "bg-[#2b2118] text-[#f7eeda]" : "bg-[#2b2118]/10"
                      }`}
                    >
                      {ABILITIES[id].name}
                    </button>
                  ))}
                </div>
                <div className="mt-1.5 text-[10px] leading-snug opacity-60">{ABILITIES[ability].desc}</div>
              </div>
            )}

            {paused && (activeMods.length > 0 || activePerks.length > 0) && (
              <div className="mt-5 w-full max-w-sm px-4 py-3 text-left text-black">
                <div className="text-[9px] tracking-[0.25em] opacity-50">ATTRIBUTES</div>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                  {activeMods.map((id) => (
                    <span key={id} className="text-[10px] font-bold tracking-wider text-black">
                      {perkBadge(id, 1)}
                    </span>
                  ))}
                  {activePerks.map(({ id, label }) => (
                    <span key={id} className="text-[10px] tracking-wider text-black">
                      {label}
                    </span>
                  ))}
                </div>
              </div>
            )}


            {paused || (multiplayer && ended) ? (
              <div className="mt-3">
                <button
                  onClick={leaveGame}
                  className="pointer-events-auto rounded-md bg-[#2b2118] px-6 py-2 text-sm font-semibold tracking-widest text-[#f7eeda] transition-transform hover:scale-105"
                >
                  {multiplayer ? "LEAVE ROOM" : "LEAVE GAME"}
                </button>
              </div>
            ) : (
              <div className="mt-5 border-t border-[#2b2118]/20 pt-4 text-xs tracking-widest">
                {!net ? (
                  <>
                    <div className="opacity-60">CO-OP · UP TO 4 PLAYERS</div>
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={startHost}
                        disabled={joining}
                        className="pointer-events-auto flex-1 rounded-md bg-[#2b2118] px-3 py-2 font-semibold text-[#f7eeda] disabled:opacity-50"
                      >
                        HOST
                      </button>
                      <input
                        value={joinCode}
                        onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 4))}
                        placeholder="CODE"
                        className="pointer-events-auto w-20 rounded-md border border-[#2b2118]/30 bg-transparent px-2 text-center tracking-[0.3em] outline-none"
                      />
                      <button
                        onClick={startJoin}
                        disabled={joining}
                        className="pointer-events-auto flex-1 rounded-md bg-[#2b2118] px-3 py-2 font-semibold text-[#f7eeda] disabled:opacity-50"
                      >
                        JOIN
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="opacity-60">{net.role === "host" ? "HOSTING ROOM" : "JOINED ROOM"}</div>
                    <div className="mt-1 text-2xl font-bold tracking-[0.4em]">{net.code}</div>
                    <div className="mt-3 space-y-1 text-left">
                      {connected.map((p) => (
                        <div key={p.id} className="flex items-center gap-2">
                          <span style={{ color: colorFor(p.num), WebkitTextStroke: "0.5px #2b2118" }}>■</span>
                          <span>{p.num === 1 ? "HOST" : `PLAYER ${p.num}`}</span>
                          <span className="opacity-50">· CONNECTED</span>
                          {p.num === myNum && <span className="opacity-50">(YOU)</span>}
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 opacity-60">
                      {net.role === "host" ? "share the code" : "waiting for the host"}
                    </div>
                    <button
                      onClick={leaveRoom}
                      className="pointer-events-auto mt-2 text-[11px] underline opacity-60 hover:opacity-100"
                    >
                      LEAVE ROOM
                    </button>
                  </>
                )}
                {joining && <div className="mt-2 opacity-60">CONNECTING…</div>}
                {netError && <div className="mt-2 text-[#b3261e]">{netError}</div>}
              </div>
            )}

            {(
              <div>
                <button
                  onClick={toggleNight}
                  aria-pressed={night}
                  title="Toggle day / night (N)"
                  className="pointer-events-auto mt-4 block w-full rounded-md border border-[#2b2118]/30 px-3 py-1.5 text-xs font-semibold tracking-widest transition-transform hover:scale-[1.02]"
                >
                  {night ? "☾ NIGHT" : "☀ DAY"} · PRESS N TO SWITCH
                </button>
                <button
                  onClick={() => setShowSettings((v) => !v)}
                  className="pointer-events-auto mt-3 text-xs tracking-widest underline opacity-70 hover:opacity-100"
                >
                  {showSettings ? "HIDE SETTINGS" : "SETTINGS"}
                </button>
                {!paused && <button
                  onClick={() => setShowWeapons(true)}
                  className="pointer-events-auto ml-4 mt-3 text-xs tracking-widest underline opacity-70 hover:opacity-100"
                >
                  WEAPONS
                </button>}
                {showWeapons && <WeaponsPanel onClose={() => setShowWeapons(false)} />}
              </div>
            )}
            {showSettings && (
              <div className="mt-4 space-y-4 text-left text-xs tracking-widest">
                <label className="block">
                  FIELD OF VIEW · {fov}°
                  <input type="range" min={50} max={110} step={1} value={fov}
                    onChange={(e) => setFov(Number(e.target.value))}
                    className="pointer-events-auto mt-1 w-full accent-[#b4653f]" />
                </label>
                <label className="block">
                  LOOK SPEED · LEFT/RIGHT · {sensX.toFixed(1)}x
                  <input type="range" min={0.2} max={3} step={0.1} value={sensX}
                    onChange={(e) => setSensX(Number(e.target.value))}
                    className="pointer-events-auto mt-1 w-full accent-[#b4653f]" />
                </label>
                <label className="block">
                  LOOK SPEED · UP/DOWN · {sensY.toFixed(1)}x
                  <input type="range" min={0.2} max={3} step={0.1} value={sensY}
                    onChange={(e) => setSensY(Number(e.target.value))}
                    className="pointer-events-auto mt-1 w-full accent-[#b4653f]" />
                </label>
                <label className="block">
                  MUSIC VOLUME · {Math.round(musicVol * 100)}%
                  <input type="range" min={0} max={1} step={0.05} value={musicVol}
                    onChange={(e) => setMusicVol(Number(e.target.value))}
                    className="pointer-events-auto mt-1 w-full accent-[#b4653f]" />
                </label>
                <label className="block">
                  EFFECTS VOLUME · {Math.round(sfxVol * 100)}%
                  <input type="range" min={0} max={1} step={0.05} value={sfxVol}
                    onChange={(e) => setSfxVol(Number(e.target.value))}
                    className="pointer-events-auto mt-1 w-full accent-[#b4653f]" />
                </label>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const GUN_INFO: Record<Weapon, string> = {
  pistol: "Your trusty sidearm. 140 rounds, refilled at the start of every wave.",
  scatter: "Blasts five pellets in a wide spread. Brutal up close, weak at range.",
  smg: "Hold to spray a fast stream of small rounds. Big magazine, low damage per hit.",
  rail: "Heavy long-range beam. The shot itself is near-instant and hits for 5 damage, but it takes almost a second to charge the next one.",
  cannon: "Lobs a huge slow shell for 8 damage. Only a handful of shots — make them count.",
  rebound: "Fires saw discs that bounce off walls up to 3 times. Great around corners.",
  harpoon: "Fast bolts that pierce straight through up to 3 enemies in a line.",
  cryo: "Rapid icy shots that freeze enemies, slowing them to half speed.",
  flak: "Fires a shell that bursts into shrapnel when it hits something or runs out of range.",
  tesla: "Electric shots that chain lightning to 2 more nearby enemies.",
};

function Spin({ children }: { children: React.ReactNode }) {
  const g = useRef<THREE.Group>(null);
  useFrame((_, d) => { if (g.current) g.current.rotation.y += d * 0.8; });
  return <group ref={g}>{children}</group>;
}

export function WeaponsPanel({ onClose }: { onClose: () => void }) {
  const [sel, setSel] = useState<Weapon>("pistol");
  const g = GUNS[sel];
  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 font-mono text-[#f2ead6]">
      <div className="flex max-h-full w-full max-w-3xl flex-col gap-4 overflow-auto rounded-lg border border-[#b4653f] bg-[#2b2118] p-5 md:flex-row">
        <div className="grid grid-cols-2 gap-1 md:w-56 md:grid-cols-1">
          {ORDER.map((w, i) => (
            <button key={w} onClick={() => setSel(w)}
              className={`rounded px-3 py-1.5 text-left text-xs tracking-widest ${sel === w ? "bg-[#b4653f]" : "hover:bg-white/10"}`}>
              <span className="opacity-60">{i + 1}</span> {GUNS[w].name}
            </button>
          ))}
        </div>
        <div className="flex-1">
          <div className="h-56 w-full overflow-hidden rounded bg-[#1a1410]">
            <Canvas camera={{ position: [0.9, 0.35, 0.9], fov: 40 }}>
              <ambientLight intensity={0.8} />
              <directionalLight position={[2, 3, 2]} intensity={1.4} />
              <Spin><group position={[0, -0.05, 0.15]}><GunModel w={sel} /></group></Spin>
            </Canvas>
          </div>
          <h2 className="mt-3 text-2xl font-bold tracking-[0.3em]" style={{ color: g.color }}>{g.name}</h2>
          <p className="mt-2 text-sm opacity-90">{GUN_INFO[sel]}</p>
          <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] tracking-widest opacity-80">
            <div>DAMAGE<br /><b className="text-base">{g.damage}{g.count > 1 ? `×${g.count}` : ""}</b></div>
            <div>AMMO<br /><b className="text-base">{g.ammo || "∞"}</b></div>
            <div>FIRE RATE<br /><b className="text-base">{(1 / g.cooldown).toFixed(1)}/s</b></div>
          </div>
          <button onClick={onClose} className="mt-4 rounded bg-[#b4653f] px-4 py-2 text-xs tracking-widest hover:opacity-90">CLOSE</button>
        </div>
      </div>
    </div>
  );
}
