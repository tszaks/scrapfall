import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import {
  ARENA, HALF, BLOCK, blocked, generateLevel, randomSpawn, pushOut, type Block,
  solidGrid, flowField, nextWaypoint, clearLine, toCell,
  setArenaSize, setBlockHalf, SOLO_ARENA, COOP_ARENA,
} from "./level";

import { THEMES, type Theme } from "./themes";
import { useKeyboard } from "./useKeyboard";
import { touchInput, resetTouchInput, isTouchDevice } from "./touch";
import { MobileControls } from "./MobileControls";
import { RobotModel } from "./art/RobotModel";
import { ArtBoss, ArtSpecial } from "./art/SpecialBoss";
import { hasArtBoss } from "./art/robots/bosses";
import { hasArtSpecial } from "./art/robots/specials";
import { classicRobot, swingInputs, shooterInputs, bomberInputs, specterInputs } from "./art/robots/classic";
import { RemotePlayers } from "./Remote";
import { colorFor, hostRoom, joinRoom, type NetHandle, type NetMsg, type RemoteState } from "./net";
import { Shards } from "./Shards";
import { hookAudioUnlock, initAudio, playGun, playSfx, setMusicIntensity, setMusicMenu, setMusicTheme, setVolumes, startMusic, stopMusic } from "./audio";
import { ABILITIES, ABILITY_IDS, type AbilityId } from "./abilities";
import { NO_PERKS, PERK_IDS, PERK_INFO, MOD_SLOTS, PISTOL_MODS, derive, modsEquipped, perkAvailable, perkBadge, perkCost, type Derived, type PerkId, type Perks } from "./perks";
import { CLASSES, CLASS_IDS, type ClassId } from "./classes";
import { hazardFor, HAZARD_COUNT, type HazardDef } from "./hazards";
import { mutatorById, rollMutator, readHighWave, saveHighWave, type Mutator } from "./endless";
import { Ground, MapDressing } from "./art/MapDressing";
import { BIG_MAPS, BigMapScene, bigMinimap, setupBigMap, bigPlayerBlocked, bigFloorY, type BigMap, type BigMapId } from "@/bro/game/BigMaps";
import { setBigGround, groundY } from "./terrain";
import { spawnFocus } from "./level";
import { Minimap, radarFeed } from "./Minimap";
import "./r3fDevFix";



type Kind = "drifter" | "brute" | "shooter" | "runner" | "boss" | "specter" | "bomber" | "vanguard" | "special";
type Weapon =
  | "pistol" | "scatter" | "smg" | "rail" | "cannon"
  | "rebound" | "harpoon" | "cryo" | "flak" | "tesla"
  | "revolver" | "minigun" | "crossbow" | "plasma" | "voidorb" | "shatter";
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
  revolver: { name: "HAND CANNON", wave: 3, cooldown: 0.55, count: 1, spread: 0, speed: 30, life: 2, damage: 4, size: 0.13, color: "#ffcf6b", body: "#5a4a3a", ammo: 24, pierce: 1 },
  minigun: { name: "SHREDDER", wave: 7, cooldown: 0.05, count: 1, spread: 0.06, speed: 28, life: 1.3, damage: 1, size: 0.08, color: "#ffe14f", body: "#3a3a3a", ammo: 220 },
  crossbow: { name: "CROSSBOW", wave: 5, cooldown: 0.75, count: 1, spread: 0, speed: 44, life: 2, damage: 4, size: 0.09, color: "#c8f07a", body: "#6b4a2c", ammo: 14, pierce: 2, slow: 1 },
  plasma: { name: "PLASMA FAN", wave: 6, cooldown: 0.45, count: 3, spread: 0.05, speed: 24, life: 1.6, damage: 2, size: 0.15, color: "#ff4fd8", body: "#3a2050", ammo: 30, bounce: 1 },
  voidorb: { name: "VOID ORB", wave: 8, cooldown: 1.1, count: 1, spread: 0, speed: 8, life: 4, damage: 3, size: 0.36, color: "#b06bff", body: "#1c1030", ammo: 10, chain: 4, pierce: 4 },
  shatter: { name: "SHATTERGUN", wave: 9, cooldown: 0.9, count: 1, spread: 0, speed: 18, life: 1.8, damage: 3, size: 0.25, color: "#b8f4ff", body: "#2a4a5a", ammo: 12, cluster: 5, slow: 2 },
};
const ORDER: Weapon[] = ["pistol", "scatter", "smg", "rail", "cannon", "rebound", "harpoon", "cryo", "flak", "tesla", "revolver", "minigun", "crossbow", "plasma", "voidorb", "shatter"];
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
const TURRET_LIFE = 30;

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
  slow: number; // slowed timer
  frozen?: number; // cryo nova: fully frozen timer
  burn: number; // burning timer from incendiary rounds
  burnTick: number;
  max?: number; // spawn health, for the executioner hammer
  shredUntil?: number; // shredder rounds: takes extra damage until this time
  aux?: number; // special-enemy state (leap / beam timer)
  elite?: number; // 1 = event champion (gold, tougher, big shard payout)
};
type Bullet = {
  pos: THREE.Vector3; vel: THREE.Vector3; life: number; active: boolean; damage: number; color: string; size: number;
  bounce: number; pierce: number; slow: number; cluster: number; chain: number; burn: number; knock: number; mods: number; track?: number;
};
const M_SHRED = 1, M_EXEC = 2, M_BOUNTY = 4;


const BOSS_HP = 450; // 1.5x tougher arena boss
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
  { drifter: 5, brute: 1 },
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
  { boss: 1, drifter: 10, brute: 6, shooter: 6, runner: 6, specter: 4, bomber: 3, vanguard: 3, special: 3 },
];
const MAX_ENEMIES = 110;
const MARK_TIME = 2; // seconds a red X flashes before an enemy appears
const MAX_HP = 10;
const SHOP_KEYS = ["KeyZ", "KeyX", "KeyC"];
const PATCH_COST = 6; // permanent emergency heal slot in the shop



const BULLET_SPEED = 22;
const ENEMY_BULLET_SPEED = 11;
const TURN_SPEED = 2.4;
const MAX_BULLETS = 90;
const SPEED = 7;
const EYE = 1.6;

// Big maps (copied from tszaks/scrapfall): seeds above BIG_BASE name a map; its layout is fixed.
const BIG_BASE = 1_500_000_000;
const BIG_IDS: BigMapId[] = ["alpine", "beach", "city", "western", "nuketown"];
const BIG_LAYOUT_SEED: Record<BigMapId, number> = { alpine: 20240611, beach: 20240612, city: 20240613, western: 20240614, nuketown: 20240615 };
function bigSeed(id: BigMapId) { return BIG_BASE + BIG_IDS.indexOf(id) * 10_000_000 + Math.floor(Math.random() * 1e6); }
/** Testing only: ?bigmap=alpine opens that map in solo. */
function testMap(): BigMapId | null {
  if (typeof window === "undefined") return null;
  const v = new URLSearchParams(window.location.search).get("bigmap");
  return v && (BIG_IDS as string[]).includes(v) ? (v as BigMapId) : null;
}
function bigIdOf(seed: number): BigMapId | null { return seed >= BIG_BASE ? BIG_IDS[Math.floor((seed - BIG_BASE) / 10_000_000)] ?? null : null; }
const OUR_BOSS = new Set(["golem", "yeti", "treant", "magma", "mech", "ronin", "drake"]);
const OUR_SPECIAL = new Set(["stalker", "mite", "spore", "pyre", "leaper", "shinobi", "wyrm", "nautilus", "hacker", "bile"]);
/** His map colours fit our theme shape; his newer boss/special kinds fall back to ones we draw. */
function toOurTheme(t: Theme): Theme {
  return {
    ...t,
    blockShape: "alpine",
    boss: { ...t.boss, shape: OUR_BOSS.has(t.boss.shape) ? t.boss.shape : "mech" },
    special: { ...t.special, type: OUR_SPECIAL.has(t.special.type) ? t.special.type : "leaper" },
  };
}
const RUN_MUL = 1.45; // Shift / RUN button
const JUMP_V = 6.2;
const GRAVITY = 18;

const FORWARD = new THREE.Vector3();
const RIGHT = new THREE.Vector3();
const MOVE = new THREE.Vector3();

function Obstacle({ b, theme }: { b: Block; theme: Theme }) {
  const color = b.tone > 0.6 ? theme.blocks[0] : b.tone > 0.3 ? theme.blocks[1] : theme.blocks[2];
  const shape = theme.blockShape;
  const glow = theme.enemyBullet;

  if (shape === "tree") {
    // trunk stays slim, canopy sits directly on top of it and tapers upward so
    // the tiers never float apart or read as hollow cones
    const trunk = 1.1 + b.h * 0.22;
    const canopy = b.h * 0.85 + 1.4;
    return (
      <group position={[b.x, 0, b.z]} rotation-y={b.tone * Math.PI * 2}>
        {/* root flare keeps the base planted in the ground */}
        <mesh position-y={0.18} castShadow receiveShadow>
          <cylinderGeometry args={[0.42, 0.68, 0.36, 7]} />
          <meshLambertMaterial color="#3b2818" flatShading />
        </mesh>
        <mesh position-y={trunk / 2 + 0.2} castShadow>
          <cylinderGeometry args={[0.26, 0.4, trunk, 7]} />
          <meshLambertMaterial color="#4a3320" flatShading />
        </mesh>
        {/* three overlapping tiers, each seated inside the one below it */}
        <mesh position-y={trunk + canopy * 0.18} castShadow>
          <coneGeometry args={[1.35, canopy * 0.6, 8]} />
          <meshLambertMaterial color={theme.blocks[2]} flatShading />
        </mesh>
        <mesh position-y={trunk + canopy * 0.42} castShadow>
          <coneGeometry args={[1.08, canopy * 0.55, 8]} />
          <meshLambertMaterial color={color} flatShading />
        </mesh>
        <mesh position-y={trunk + canopy * 0.68} castShadow>
          <coneGeometry args={[0.78, canopy * 0.5, 8]} />
          <meshLambertMaterial color={theme.blocks[0]} flatShading />
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

/** Small scatter prop that belongs to the map it sits in. */
function Decor({ theme, seed }: { theme: Theme; seed: number }) {
  const s = theme.blockShape;
  const glow = theme.enemyBullet;

  // forests: mushroom clusters and mossy stones
  if (s === "tree" || s === "pagoda") {
    const cap = s === "tree" ? "#c8543a" : "#f0a0b8";
    return (
      <group>
        <mesh position-y={0.1} receiveShadow>
          <sphereGeometry args={[0.42, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshLambertMaterial color={theme.wall} flatShading />
        </mesh>
        {[0, 1, 2].map((i) => {
          const a = i * 2.1 + seed * 6;
          const h = 0.26 + ((i + seed) % 1) * 0.22;
          return (
            <group key={i} position={[Math.cos(a) * 0.34, 0, Math.sin(a) * 0.34]}>
              <mesh position-y={h / 2} castShadow>
                <cylinderGeometry args={[0.055, 0.075, h, 6]} />
                <meshLambertMaterial color="#e8dcc4" flatShading />
              </mesh>
              <mesh position-y={h} castShadow>
                <sphereGeometry args={[0.16, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2]} />
                <meshLambertMaterial color={cap} flatShading />
              </mesh>
            </group>
          );
        })}
      </group>
    );
  }

  // ice fields: frost shards pushing out of the snow
  if (s === "crystal" || s === "berg") {
    return (
      <group>
        {[0, 1, 2].map((i) => {
          const a = i * 2.3 + seed * 5;
          const h = 0.5 + ((i * 7 + seed * 10) % 5) * 0.14;
          return (
            <mesh key={i} position={[Math.cos(a) * 0.3, h / 2, Math.sin(a) * 0.3]} rotation-z={Math.cos(a) * 0.25} castShadow>
              <coneGeometry args={[0.13, h, 5]} />
              <meshLambertMaterial color="#e8f7ff" flatShading emissive="#5fd8ff" emissiveIntensity={0.12} />
            </mesh>
          );
        })}
      </group>
    );
  }

  // volcanic and dry maps: cracked slabs with an ember seam
  if (s === "basalt" || s === "monument" || s === "butte") {
    return (
      <group>
        <mesh position-y={0.14} rotation-y={seed * 3} castShadow receiveShadow>
          <boxGeometry args={[0.9, 0.28, 0.7]} />
          <meshLambertMaterial color={theme.blocks[2]} flatShading />
        </mesh>
        <mesh position-y={0.3} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[0.7, 0.09]} />
          <meshBasicMaterial color={theme.boss.glow} fog={false} />
        </mesh>
      </group>
    );
  }

  // deep sea: kelp fronds swaying off a rock
  if (s === "coral") {
    return (
      <group>
        <mesh position-y={0.12} receiveShadow>
          <dodecahedronGeometry args={[0.32, 0]} />
          <meshLambertMaterial color={theme.blocks[2]} flatShading />
        </mesh>
        {[0, 1, 2].map((i) => {
          const a = i * 2.2 + seed * 4;
          return (
            <mesh key={i} position={[Math.cos(a) * 0.22, 0.6, Math.sin(a) * 0.22]} rotation-z={Math.cos(a) * 0.35} castShadow>
              <cylinderGeometry args={[0.03, 0.07, 1.1, 5]} />
              <meshLambertMaterial color={theme.blocks[0]} flatShading emissive={glow} emissiveIntensity={0.15} />
            </mesh>
          );
        })}
      </group>
    );
  }

  // neon city: a low conduit box with a lit strip
  if (s === "server") {
    return (
      <group>
        <mesh position-y={0.22} castShadow receiveShadow>
          <boxGeometry args={[0.7, 0.44, 0.5]} />
          <meshLambertMaterial color={theme.blocks[1]} flatShading />
        </mesh>
        <mesh position={[0, 0.3, 0.26]}>
          <boxGeometry args={[0.5, 0.06, 0.03]} />
          <meshBasicMaterial color={theme.grid[0]} fog={false} />
        </mesh>
        <mesh position-y={0.58} rotation-x={Math.PI / 2}>
          <torusGeometry args={[0.13, 0.03, 6, 12]} />
          <meshBasicMaterial color={theme.grid[1]} fog={false} />
        </mesh>
      </group>
    );
  }

  // industrial: a leaking pipe stub with a puddle
  return (
    <group>
      <mesh position-y={0.3} rotation-z={Math.PI / 2} castShadow>
        <cylinderGeometry args={[0.13, 0.13, 0.8, 8]} />
        <meshLambertMaterial color={theme.blocks[1]} flatShading />
      </mesh>
      <mesh position-y={0.02} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[0.45, 14]} />
        <meshBasicMaterial color={glow} transparent opacity={0.45} fog={false} />
      </mesh>
    </group>
  );
}

/** The shootable hazard prop for a map: drum, pod, condenser, relay, geyser or vat. */
const HazardProp = memo(function HazardProp({ def }: { def: HazardDef }) {
  const { shell, core, look } = def;
  if (look === "pod") {
    return (
      <group>
        <mesh position-y={0.12}><cylinderGeometry args={[0.22, 0.34, 0.24, 7]} /><meshLambertMaterial color="#3b2818" flatShading /></mesh>
        <mesh position-y={0.72} castShadow><sphereGeometry args={[0.55, 10, 8]} /><meshLambertMaterial color={shell} flatShading emissive={core} emissiveIntensity={0.25} /></mesh>
        <mesh position-y={1.28}><coneGeometry args={[0.2, 0.42, 6]} /><meshBasicMaterial color={core} fog={false} /></mesh>
      </group>
    );
  }
  if (look === "condenser") {
    return (
      <group>
        <mesh position-y={0.15}><cylinderGeometry args={[0.42, 0.5, 0.3, 8]} /><meshLambertMaterial color="#5f7f95" flatShading /></mesh>
        <mesh position-y={0.85} castShadow><icosahedronGeometry args={[0.55, 0]} /><meshLambertMaterial color={shell} flatShading emissive={core} emissiveIntensity={0.35} /></mesh>
        <mesh position-y={0.85} rotation-x={Math.PI / 2}><torusGeometry args={[0.62, 0.05, 6, 16]} /><meshBasicMaterial color={core} fog={false} /></mesh>
      </group>
    );
  }
  if (look === "relay") {
    return (
      <group>
        <mesh position-y={0.5} castShadow><boxGeometry args={[0.6, 1, 0.6]} /><meshLambertMaterial color={shell} flatShading /></mesh>
        <mesh position-y={1.15}><sphereGeometry args={[0.3, 10, 8]} /><meshBasicMaterial color={core} fog={false} /></mesh>
        {[0.35, 0.7].map((y, i) => (
          <mesh key={i} position={[0, y, 0.31]}><boxGeometry args={[0.42, 0.06, 0.03]} /><meshBasicMaterial color={core} fog={false} /></mesh>
        ))}
      </group>
    );
  }
  if (look === "geyser") {
    return (
      <group>
        <mesh position-y={0.2} castShadow><cylinderGeometry args={[0.45, 0.75, 0.4, 9]} /><meshLambertMaterial color={shell} flatShading /></mesh>
        <mesh position-y={0.42}><cylinderGeometry args={[0.36, 0.36, 0.08, 9]} /><meshBasicMaterial color={core} fog={false} /></mesh>
        <mesh position-y={0.9}><coneGeometry args={[0.3, 0.9, 8, 1, true]} /><meshBasicMaterial color={core} transparent opacity={0.5} fog={false} /></mesh>
      </group>
    );
  }
  if (look === "vat") {
    return (
      <group>
        <mesh position-y={0.5} castShadow><cylinderGeometry args={[0.45, 0.45, 1, 10]} /><meshLambertMaterial color={shell} flatShading /></mesh>
        <mesh position-y={1.02}><cylinderGeometry args={[0.4, 0.45, 0.14, 10]} /><meshBasicMaterial color={core} fog={false} /></mesh>
        <mesh position-y={0.55}><cylinderGeometry args={[0.47, 0.47, 0.18, 10]} /><meshLambertMaterial color="#2b2118" flatShading /></mesh>
      </group>
    );
  }
  // drum
  return (
    <group>
      <mesh position-y={0.55} castShadow><cylinderGeometry args={[0.42, 0.42, 1.1, 12]} /><meshLambertMaterial color={shell} flatShading /></mesh>
      {[0.35, 0.75].map((y, i) => (
        <mesh key={i} position-y={y}><cylinderGeometry args={[0.44, 0.44, 0.09, 12]} /><meshBasicMaterial color={core} fog={false} /></mesh>
      ))}
      <mesh position-y={1.12}><cylinderGeometry args={[0.44, 0.42, 0.1, 12]} /><meshLambertMaterial color="#2b2118" flatShading /></mesh>
    </group>
  );
});


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
      <Ground theme={theme} size={ARENA} />
      <MapDressing theme={theme} blocks={blocks} half={HALF} />
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
      {/* small dressing props, chosen to match the map instead of generic posts */}
      {posts.map((b, i) => (
        <group key={`p${i}`} position={[b.x + 1.9, 0, b.z - 1.9]} rotation-y={b.tone * 6.28}>
          <Decor theme={theme} seed={b.tone} />
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
  const flame = useRef<THREE.Group>(null);
  const ice = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    const g = ref.current;
    if (!g) return;
    g.visible = data.alive;
    if (!data.alive) return;
    if (data.kind !== kind) setKind(data.kind);
    const t = state.clock.elapsedTime;
    const k = data.kind;
    const heavy = k === "brute" || k === "boss" || k === "vanguard";
    // robots walk on the ground; only specials/boss keep the old hover bob
    const bob = k === "special" ? Math.sin(t * 4 + data.x) * 0.08 : 0;
    g.position.set(data.x, bob + groundY(data.x, data.z), data.z);
    g.lookAt(state.camera.position.x, 0, state.camera.position.z);
    const base = k === "special" ? 1 : k === "boss" ? 1.6 : k === "runner" ? 0.6 : k === "vanguard" ? 1.05 : 1;
    g.scale.setScalar(base * (data.elite ? 1.6 : 1) * (data.flash > 0 ? 1.15 : 1));
    if (aura.current) {
      aura.current.visible = !!data.elite;
      aura.current.rotation.y = t * 1.2;
    }
    if (ice.current) ice.current.visible = (data.frozen ?? 0) > 0;
    if (flame.current) {
      const burning = data.burn > 0;
      flame.current.visible = burning;
      if (burning) {
        flame.current.rotation.y = t * 6;
        const f = 0.85 + Math.sin(t * 24 + data.x) * 0.18 + Math.sin(t * 37) * 0.07;
        flame.current.scale.set(f, 1.05 + Math.sin(t * 19 + data.z) * 0.3, f);
      }
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
      {/* burning: flame tongues shown only while incendiary damage ticks */}
      <mesh ref={ice} visible={false} position-y={0.9}>
        <icosahedronGeometry args={[0.95, 0]} />
        <meshStandardMaterial color="#bff4ff" emissive="#5fd8ff" emissiveIntensity={0.5} transparent opacity={0.45} flatShading roughness={0.1} />
      </mesh>
      <group ref={flame} visible={false} position-y={0.75}>
        {[
          [0, 0.55, 0, 0.42, 1.5, "#ffe066"],
          [0.38, 0.3, 0.1, 0.3, 1.0, "#ff8c1a"],
          [-0.34, 0.25, -0.16, 0.28, 0.9, "#ff5a1a"],
          [0.08, 0.15, 0.4, 0.26, 0.8, "#e02a12"],
          [-0.12, 0.2, -0.42, 0.24, 0.85, "#ffb020"],
        ].map(([x, y, z, r, h, col], i) => (
          <mesh key={i} position={[x as number, y as number, z as number]}>
            <coneGeometry args={[r as number, h as number, 6]} />
            <meshBasicMaterial color={col as string} transparent opacity={0.8} fog={false} depthWrite={false} blending={THREE.AdditiveBlending} />
          </mesh>
        ))}
      </group>

      {/* DRIFTER / RUNNER: floating core inside a caged shell */}
      {/* detailed skinned robots (ported art kit) — one draw call each */}
      {kind === "drifter" && <RobotModel kind={classicRobot("drifter", theme)} data={data} />}
      {kind === "runner" && <RobotModel kind={classicRobot("runner", theme)} data={data} gait={0.6} />}
      {kind === "brute" && <RobotModel kind={classicRobot("brute", theme)} data={data} inputs={swingInputs} />}
      {kind === "shooter" && <RobotModel kind={classicRobot("shooter", theme)} data={data} inputs={shooterInputs} />}
      {kind === "bomber" && <RobotModel kind={classicRobot("bomber", theme)} data={data} inputs={bomberInputs} />}
      {kind === "specter" && <RobotModel kind={classicRobot("specter", theme)} data={data} inputs={specterInputs} />}
      {kind === "vanguard" && <RobotModel kind={classicRobot("vanguard", theme)} data={data} inputs={swingInputs} />}
      {false && (kind==="drifter"||kind==="runner") && (<group ref={drifter} position-y={0.9}>
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
      {false && (kind==="brute") && (<group ref={brute}>
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
        {hasArtBoss(theme) ? <ArtBoss theme={theme} data={data} /> : <BossBody theme={theme} />}
        <group ref={bossArm} position={[1.05, 1.9, 0]} visible={!hasArtBoss(theme)}>
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
      {false && (kind==="shooter") && (<group ref={shooter} position-y={1.3}>
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
      {false && (kind==="specter") && (<group ref={specter} position-y={1.5}>
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
      {false && (kind==="bomber") && (<group ref={bomber} position-y={0.8}>
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
      {kind === "special" && (hasArtSpecial(theme) ? <ArtSpecial theme={theme} data={data} /> : <SpecialModel theme={theme} data={data} />)}
      {false && (kind==="vanguard") && (<group ref={vanguard}>
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

// A real bullet silhouette: straight casing with a tapered nose, lathed as one
// mesh so the pool stays one draw call per slot and keeps per-shot tinting.
const BULLET_PROFILE = [
  [0, -1.35], [0.52, -1.35], [0.56, -0.55], [0.56, 0.25],
  [0.48, 0.7], [0.32, 1.05], [0.14, 1.28], [0, 1.35],
] as const;
const BULLET_GEO = new THREE.LatheGeometry(
  BULLET_PROFILE.map(([x, y]) => new THREE.Vector2(x * 0.14, y * 0.14)),
  10,
);
const BULLET_UP = new THREE.Vector3(0, 1, 0);
const BULLET_BAND = new THREE.CylinderGeometry(0.082, 0.082, 0.05, 10);
const BULLET_BAND_MAT = new THREE.MeshBasicMaterial({ color: "#d9a53a", fog: false });
// tapered streak: wide at the round, fading to a point behind it
const TRACER_GEO = new THREE.CylinderGeometry(0.05, 0.005, 0.8, 6);
const TMP_DIR = new THREE.Vector3();


const BulletPool = memo(function BulletPool({
  meshes,
  color,
  size,
  shape = "bullet",
}: {
  meshes: { current: (THREE.Mesh | null)[] };
  color: string;
  size: number;
  shape?: "bullet" | "sphere";
}) {
  return (
    <>
      {Array.from({ length: MAX_BULLETS }, (_, i) => (
        <mesh
          key={i}
          ref={(m) => { meshes.current[i] = m; }}
          visible={false}
          {...(shape === "bullet" ? { geometry: BULLET_GEO } : {})}
        >
          {shape === "sphere" && <sphereGeometry args={[size, 10, 10]} />}
          <meshBasicMaterial color={color} fog={false} />
          {shape === "bullet" && (<>
            {/* brass casing band + glowing tracer streak behind the round */}
            <mesh geometry={BULLET_BAND} material={BULLET_BAND_MAT} position={[0, -0.13, 0]} />
            <mesh geometry={TRACER_GEO} position={[0, -0.6, 0]}>
              <meshBasicMaterial color={color} fog={false} transparent opacity={0.35} depthWrite={false} blending={THREE.AdditiveBlending} />
            </mesh>
          </>)}
        </mesh>
      ))}
    </>
  );
});


type Fx = { bounce?: number; pierce?: number; slow?: number; cluster?: number; chain?: number; burn?: number; knock?: number; mods?: number; track?: number };
function fireInto(pool: Bullet[], pos: THREE.Vector3, vel: THREE.Vector3, life: number, damage = 1, color = "", size = 0, fx: Fx = {}) {
  const base = {
    life, active: true, damage, color, size,
    bounce: fx.bounce ?? 0, pierce: fx.pierce ?? 0, slow: fx.slow ?? 0, cluster: fx.cluster ?? 0, chain: fx.chain ?? 0,
    burn: fx.burn ?? 0, knock: fx.knock ?? 0, mods: fx.mods ?? 0, track: fx.track ?? 0,
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
      {w === "revolver" && (<>
        <mesh position={[0, 0.02, -0.25]} rotation-x={Math.PI / 2}><cylinderGeometry args={[0.035, 0.035, 0.45, 8]} />{body}</mesh>
        <mesh position={[0, 0, -0.05]} rotation-x={Math.PI / 2}><cylinderGeometry args={[0.08, 0.08, 0.14, 6]} /><meshLambertMaterial color="#8a7a66" /></mesh>
        <mesh position={[0, 0.07, -0.46]}><boxGeometry args={[0.02, 0.03, 0.03]} />{glow}</mesh>
        <mesh position={[0, -0.13, 0.06]} rotation-x={0.35}><boxGeometry args={[0.07, 0.2, 0.1]} /><meshLambertMaterial color="#3b2a1a" /></mesh>
      </>)}
      {w === "minigun" && (<>
        {[0, 1, 2, 3, 4, 5].map((k) => (
          <mesh key={k} position={[Math.cos(k) * 0.05, Math.sin(k) * 0.05, -0.32]} rotation-x={Math.PI / 2}><cylinderGeometry args={[0.018, 0.018, 0.55, 6]} /><meshLambertMaterial color="#222" /></mesh>
        ))}
        <mesh position={[0, 0, -0.05]}><boxGeometry args={[0.18, 0.18, 0.25]} />{body}</mesh>
        <mesh position={[0, 0, -0.58]} rotation-x={Math.PI / 2}><torusGeometry args={[0.07, 0.015, 6, 12]} />{glow}</mesh>
      </>)}
      {w === "crossbow" && (<>
        <mesh position={[0, 0, -0.2]}><boxGeometry args={[0.07, 0.08, 0.55]} />{body}</mesh>
        <mesh position={[0, 0.02, -0.4]}><boxGeometry args={[0.5, 0.03, 0.04]} /><meshLambertMaterial color="#3b2a1a" /></mesh>
        <mesh position={[0, 0.06, -0.35]} rotation-x={Math.PI / 2}><cylinderGeometry args={[0.008, 0.008, 0.45, 4]} />{glow}</mesh>
      </>)}
      {w === "plasma" && (<>
        <mesh position={[0, 0, -0.2]}><boxGeometry args={[0.14, 0.12, 0.45]} />{body}</mesh>
        {[-0.06, 0, 0.06].map((x) => (
          <mesh key={x} position={[x, 0.02, -0.46]}><sphereGeometry args={[0.03, 8, 8]} />{glow}</mesh>
        ))}
        <mesh position={[0, -0.13, 0.02]}><boxGeometry args={[0.07, 0.2, 0.11]} />{body}</mesh>
      </>)}
      {w === "voidorb" && (<>
        <mesh position={[0, 0, -0.15]}><boxGeometry args={[0.12, 0.12, 0.35]} />{body}</mesh>
        <mesh position={[0, 0.03, -0.45]}><sphereGeometry args={[0.1, 12, 12]} />{glow}</mesh>
        <mesh position={[0, 0.03, -0.45]} rotation-x={Math.PI / 2}><torusGeometry args={[0.14, 0.015, 6, 16]} /><meshLambertMaterial color="#444" /></mesh>
        <mesh position={[0, -0.13, 0.02]}><boxGeometry args={[0.07, 0.2, 0.11]} />{body}</mesh>
      </>)}
      {w === "shatter" && (<>
        <mesh position={[0, 0, -0.25]} rotation-x={Math.PI / 2}><cylinderGeometry args={[0.09, 0.12, 0.5, 6]} />{body}</mesh>
        <mesh position={[0, 0, -0.52]} rotation-x={-Math.PI / 2}><coneGeometry args={[0.1, 0.12, 6]} />{glow}</mesh>
        <mesh position={[0, 0.13, -0.2]}><octahedronGeometry args={[0.06]} />{glow}</mesh>
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
  waveNum,
  players,
  msgSink,
  health,
  slots,
  stats,
  onShard,
  onLeech,
  onCrate,
  onDeploys,
  ability,
  onAbilityCd,
  onStat,
  onEvent,
  onMutator,
  endless,



  alpine,
}: {
  alpine: BigMap | null;
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
  waveNum: number;
  players: number;
  msgSink: React.MutableRefObject<(m: NetMsg) => void>;
  health: number;
  slots: React.MutableRefObject<Record<string, number>>;
  stats: React.MutableRefObject<Derived>;
  onShard: (v: number) => void;
  onLeech: () => void;
  onCrate: (kind: CrateKind) => void;
  onDeploys: (d: { turret: number; mines: number }) => void;
  ability: AbilityId;
  onAbilityCd: (left: number, max: number) => void;
  onStat: (k: "shot" | "hit" | "dmg" | "taken", n: number) => void;
  onEvent: (name: string | null) => void;
  onMutator: (id: Mutator["id"]) => void;
  /** overtime: keep spawning waves past the map boss instead of winning */
  endless: React.MutableRefObject<boolean>;

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
  const ammo = useRef<Record<Weapon, number>>(Object.fromEntries(ORDER.map((w) => [w, w === "pistol" ? GUNS.pistol.ammo : 0])) as Record<Weapon, number>);
  const lostQueue = useRef<Weapon[]>([]);
  const dropOrder = useRef<Weapon[]>([...DROPPABLE]);
  /** wave on which a gun ran dry, so it can't come straight back */
  const depletedWave = useRef<Partial<Record<Weapon, number>>>({});
  /** waves in a row with no gun drop (2 dry waves => the next one drops two) */
  const dryWaves = useRef(0);
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
  /** active overtime condition, null during the normal 12 waves */
  const mutator = useRef<Mutator | null>(null);
  /** set inside the frame loop so network messages can trigger a blast too */
  const hazardBlow = useRef<(i: number, visualOnly?: boolean) => void>(() => {});
  // shootable map hazards (fuel drums, cryo condensers, spore pods, ...)
  const hazards = useRef<{ x: number; z: number; alive: boolean }[]>(
    Array.from({ length: HAZARD_COUNT }, () => ({ x: 0, z: 0, alive: false })),
  );
  const hazardMeshes = useRef<(THREE.Group | null)[]>([]);
  const hazardDef = hazardFor(theme);
  const hazardRef = useRef(hazardDef);
  hazardRef.current = hazardDef;
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
  const strikeAt = useRef({ x: 0, z: 0 });
  const stealBank = useRef(0);
  const barrierMesh = useRef<THREE.Mesh>(null);
  // ---- visible ability effects ----
  const ringMesh = useRef<THREE.Mesh>(null);
  const ringFx = useRef({ t: 0, dur: 0, r0: 1, r1: 9, x: 0, y: 0.12, z: 0, color: "#ffffff" });
  const boltMeshes = useRef<(THREE.Mesh | null)[]>([]);
  const boltFx = useRef({ t: 0, dur: 0 });
  const strikeRing = useRef<THREE.Mesh>(null);
  const strikeBeam = useRef<THREE.Mesh>(null);
  const strikeFlash = useRef({ t: 0 });
  const playFx = (color: string, r0: number, r1: number, dur: number, x: number, z: number, y = 0.12) => {
    ringFx.current = { t: dur, dur, r0, r1, x, y, z, color };
  };
  const cdReport = useRef(0);


  // armour soaks damage; getting hit can discharge a shock ring
  const takeHit = (dmg: number) => {
    if (invuln.current > 0) return; // dash i-frames / kinetic barrier
    const s2 = stats.current;
    if (s2.dodge > 0 && Math.random() < s2.dodge) return; // phase shift: the blow passes through
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
  const bobAmt = useRef(0);
  const jumpY = useRef(0);
  const feetY = useRef(0);
  const jumpV = useRef(0);

  const solid = useMemo(() => solidGrid(blocks), [blocks]);
  const field = useRef<{ key: number; dist: Float32Array } | null>(null);
  const wave = useRef(0);
  const nextWaveTimer = useRef(1.5);
  const lastRemaining = useRef(-1);
  /** stops the victory status from firing on every frame once the boss is down */
  const wonLatch = useRef(false);
  const pending = useRef<({ x: number; z: number; t: number } | null)[]>([]);
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
  const dashT = useRef(0); // phase dash burst timer

  const playersRef = useRef(players);
  playersRef.current = players;
  const healthRef = useRef(health);
  healthRef.current = health;
  const coopRef = useRef(!!net);
  coopRef.current = !!net;

  const tTimer = useRef(0);
  const snapTimer = useRef(0);
  const guestTarget = useRef<{ x: number; z: number }[]>(enemies.map(() => ({ x: 0, z: 0 })));
  const fields = useRef(new Map<number, Float32Array>());
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

  const takenShards = useRef(new Set<string>());
  const applySnap = (m: NetMsg) => {
    const arr = (m.e as number[]) ?? [];
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i]!;
      const o = i * 5;
      if (o + 4 >= arr.length) { e.alive = false; continue; }
      const alive = arr[o] === 1;
      e.kind = KINDS[arr[o + 1]!] ?? "drifter";
      e.swing = arr[o + 4]!;
      const t = guestTarget.current[i] ?? (guestTarget.current[i] = { x: 0, z: 0 });
      t.x = arr[o + 2]!;
      t.z = arr[o + 3]!;
      if (!e.alive || !alive) { e.x = t.x; e.z = t.z; }
      e.alive = alive;
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
      if (m.type === "shard") { takenShards.current.add(String(m.id)); return; }
      if (m.type === "left") { remotes.current.delete(String(m.from)); return; }
      if (isHostRef.current) {
        if (m.type === "hit") {
          const e = enemies[Number(m.i)];
          if (e?.alive) {
            e.hp -= Number(m.dmg);
            e.flash = 0.1;
            if (Number(m.slow) > 0) e.slow = Number(m.slow);
            if (e.kind === "boss") onBoss(Math.max(0, e.hp));
            // credit the kill to the teammate who landed it, not the host
            if (e.hp <= 0) { e.alive = false; n?.sendTo(String(m.from), { type: "kill" }); }
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
      // a hazard someone else shot: show the blast without re-applying the damage
      if (m.type === "haz") hazardBlow.current(Number(m.i), !isHostRef.current);
      // the host decides where the hazard props stand each round
      if (m.type === "hazset" && !isHostRef.current) {
        const p = m.p as [number, number][];
        hazards.current.forEach((h, i) => {
          const spot = p[i];
          if (!spot) { h.alive = false; return; }
          h.x = spot[0];
          h.z = spot[1];
          h.alive = true;
        });
      }
    };
  }); // eslint-disable-line react-hooks/exhaustive-deps




  useEffect(() => {
    camera.position.set(alpine?.spawn.x ?? 0, EYE + groundY(alpine?.spawn.x ?? 0, alpine?.spawn.z ?? 0), alpine?.spawn.z ?? 0);
    look.current = { yaw: 0, pitch: 0 };
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
    depletedWave.current = {};
    dryWaves.current = 0;
    turrets.current = [];
    mines.current = [];
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

  const placePickup = (gun: Weapon) => {
    const p = randomSpawn(blocks, rand);
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
    // rounds leave the gun's muzzle (view-model offset) and converge on the crosshair
    const pos = new THREE.Vector3(0.3, -0.24, -1.15).applyQuaternion(camera.quaternion).add(camera.position);
    const aim = camera.position.clone().addScaledVector(FORWARD, 28).sub(pos).normalize();
    for (let s = 0; s < g.count; s++) {
      const off = g.count > 1 ? s - (g.count - 1) / 2 : (Math.random() - 0.5) * 2;
      const dir = aim.clone().applyAxisAngle(camera.up, off * g.spread);
      dir.y += (Math.random() - 0.5) * g.spread * 0.6;
      const isP = w === "pistol";
      const crit = Math.random() < s2.crit + (isP && s2.laser ? 0.25 : 0);
      const dmg = g.damage * s2.dmg * (crit ? (isP && s2.suppr ? 3 : 2) : 1);
      const fx: Fx = {
        bounce: (g.bounce ?? 0) + (Math.random() < s2.ricochet ? 1 : 0),
        pierce: (g.pierce ?? 0) + s2.pierce,
        slow: g.slow ?? 0,
        cluster: g.cluster ?? 0,
        chain: g.chain ?? 0,
        knock: s2.knock + (isP && s2.comp ? 0.8 : 0),
        burn: isP && s2.incend ? 3 : 0,
        mods: isP ? (s2.shred ? M_SHRED : 0) | (s2.exec ? M_EXEC : 0) | (s2.bounty ? M_BOUNTY : 0) : 0,
        track: 1,
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
      // a dry gun is gone: it does NOT drop back into the arena right away
      owned.current.delete(w);
      equip("pistol");
      depletedWave.current[w] = wave.current;
      if (!dropOrder.current.includes(w)) dropOrder.current.push(w);
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

  // every player (host and guests) gets a full sidearm when a new wave starts
  useEffect(() => {
    if (waveNum < 1) return;
    ammo.current.pistol = Math.round((stats.current.extmag ? 220 : GUNS.pistol.ammo) * stats.current.ammoMul);
    onAmmo(ammo.current[weapon.current]);
    syncInv();
  }, [waveNum]); // eslint-disable-line react-hooks/exhaustive-deps



  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement)?.tagName === "CANVAS") trigger.current = true;
    };
    const onUp = () => (trigger.current = false);
    const isFire = (e: KeyboardEvent) => e.code === "Enter" || e.code === "NumpadEnter";
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
    // waves get fuller as the run goes: 1.25x on wave 1, +0.10x every wave after
    const waveMul = 1.25 + 0.1 * (n - 1);
    const enemyMul = waveMul * (1 + 0.6 * extra);
    // past wave 12 the run goes into overtime: the roster keeps growing and a
    // boss shows up on every fifth wave
    const spec: WaveSpec = WAVES[n - 1] ?? {
      ...WAVES[WAVES.length - 2]!,
      ...((n - WAVES.length) % 5 === 0 ? { boss: 1 } : {}),
    };
    const scale = (v: number) => (v > 0 ? Math.max(1, Math.round(v * enemyMul)) : 0);
    // wave events: a horde rush, a bounty champion, then a recon mini-boss
    const event = n === 4 ? "DRIFTER HORDE" : n === 7 ? "ELITE BOUNTY" : n === 10 ? "RECON ENFORCER" : null;
    // a couple of slots each wave are rolled from the heavier pool, so no two runs feel identical
    const surprisePool: Kind[] = n >= 5 ? ["brute", "specter", "bomber", "vanguard", "special"] : n >= 3 ? ["brute", "shooter", "specter", "special"] : ["brute", "shooter", "runner"];
    const surprises = Array<Kind>(1 + Math.floor(rand() * 2)).fill("drifter").map(() => surprisePool[Math.floor(rand() * surprisePool.length)] ?? "brute");
    const roster: Kind[] = ([] as Kind[])
      .concat(...KINDS.map((k) => Array<Kind>(k === "boss" ? (spec.boss ?? 0) : scale(spec[k] ?? 0)).fill(k)))
      .concat(surprises)
      .concat(event === "DRIFTER HORDE" ? Array<Kind>(scale(8)).fill("drifter").concat(Array<Kind>(scale(4)).fill("runner")) : []);
    // shuffle arrivals so enemy types come mixed instead of type-by-type
    const boss: Kind[] = roster.filter((k) => k === "boss");
    const rest: Kind[] = roster.filter((k) => k !== "boss");
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = rest[i]!;
      rest[i] = rest[j]!;
      rest[j] = tmp;
    }
    const kinds: Kind[] = boss.concat(rest).slice(0, MAX_ENEMIES);
    // later rounds send sturdier enemies; overtime ramps harder still
    const hpMul = n <= WAVES.length
      ? 1 + 0.09 * (n - 1)
      : 1 + 0.09 * (WAVES.length - 1) + 0.15 * (n - WAVES.length);
    // overtime rolls a new global condition every round
    if (n > WAVES.length) {
      const m = rollMutator(rand);
      mutator.current = m;
      onMutator(m.id);
      netRef.current?.broadcast({ type: "mut", id: m.id });
    } else if (mutator.current) {
      mutator.current = null;
      onMutator("none");
    }
    // hazard props reset each round so there is always something to shoot open
    hazards.current.forEach((h) => {
      const p = randomSpawn(blocks, rand);
      h.x = p.x;
      h.z = p.z;
      h.alive = true;
    });
    netRef.current?.broadcast({ type: "hazset", p: hazards.current.map((h) => [Math.round(h.x * 10) / 10, Math.round(h.z * 10) / 10]) });

    // spread arrivals across the wave: a few right away, the rest trickle in
    let delay = 0;
    enemies.forEach((e, i) => {
      const kind = kinds[i];
      pending.current[i] = null;
      if (!kind) {
        e.alive = false;
        return;
      }
      const p = randomSpawn(blocks, rand);
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
      delay += i < 2 ? 0.4 : 0.5 + rand() * 1.6;

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
    // health: guaranteed pack every wave in co-op, every other wave solo
    const healGap = extra > 0 ? 1 : 2;
    if (n >= (extra > 0 ? 1 : 2) && n - lastHealWave.current >= healGap) {
      const h = randomSpawn(blocks, rand);
      heal.current = { x: h.x, z: h.z, active: true };
      lastHealWave.current = n;
    }

    // supply crate: turret kit, barrier, cryo mine or ammo cache
    if (!crate.current.active) { // exactly one supply drop per wave
      const c = randomSpawn(blocks, rand);
      const kind = CRATE_KINDS[Math.floor(rand() * CRATE_KINDS.length)] ?? "ammo";
      crate.current = { x: c.x, z: c.z, active: true, kind };
    }
    // weapons: one new gun per wave at 80%, doubled after two dry waves.
    // co-op multiplies the number of guns by the player count.
    const players = Math.max(1, 1 + extra);
    const pity = dryWaves.current >= 2;
    const wantSolo = pity ? 2 : Math.random() < 0.8 ? 1 : 0;
    let want = wantSolo * players;
    let placed = 0;
    while (want > 0) {
      want--;
      // in co-op a gun you are carrying can still drop for your teammates
      const fresh = dropOrder.current.filter(
        (w) =>
          (coopRef.current || !owned.current.has(w)) &&
          !lostQueue.current.includes(w) &&
          !(pickup.current.active && pickup.current.gun === w),
      );
      // a gun you just ran dry on almost never comes straight back
      const ready = fresh.filter((w) => {
        const d = depletedWave.current[w];
        return d === undefined || n - d >= 2 || Math.random() < 0.05;
      });
      const drop = ready[0] ?? (pity ? fresh[0] : undefined);
      if (!drop) break;
      delete depletedWave.current[drop];
      if (pickup.current.active) lostQueue.current.push(pickup.current.gun);
      placePickup(drop);
      placed++;
    }
    dryWaves.current = placed > 0 ? 0 : dryWaves.current + 1;
  };


  const outOfBounds = (p: THREE.Vector3) =>
    p.y < 0 || Math.abs(p.x) > HALF || Math.abs(p.z) > HALF || blocked(blocks, p.x, p.z, 0.05);

  useFrame((state, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const cam = state.camera;
    const k = keys.current;

    if (!gameOver && locked) {
      look.current.yaw += ((k.has("ArrowLeft") ? 1 : 0) - (k.has("ArrowRight") ? 1 : 0)) * TURN_SPEED * sensX * delta;
      look.current.pitch = Math.max(
        -1.2,
        Math.min(1.2, look.current.pitch + ((k.has("ArrowUp") ? 1 : 0) - (k.has("ArrowDown") ? 1 : 0)) * TURN_SPEED * sensY * 0.7 * delta),
      );
      // touch drag look (right thumb)
      if (touchInput.lookX || touchInput.lookY) {
        look.current.yaw -= touchInput.lookX * 0.0032 * sensXRef.current;
        look.current.pitch = Math.max(-1.2, Math.min(1.2, look.current.pitch - touchInput.lookY * 0.0032 * sensYRef.current));
        touchInput.lookX = 0;
        touchInput.lookY = 0;
      }
    }
    cam.rotation.order = "YXZ";
    cam.rotation.set(look.current.pitch, look.current.yaw, 0);

    if (gameOver || !locked) return;

    const n = netRef.current;
    const isH = isHostRef.current;
    const spectating = deadRef.current;

    // on-screen controls
    if (touchInput.ability) {
      touchInput.ability = false;
      abilFire.current = true;
    }
    if (touchInput.swap) {
      const dir = touchInput.swap;
      touchInput.swap = 0;
      const list = [...owned.current];
      const i = list.indexOf(weapon.current);
      const next = list[(i + (dir > 0 ? 1 : list.length - 1)) % list.length];
      if (next) equip(next);
    }
    if (touchInput.pick) {
      const want = touchInput.pick as Weapon;
      touchInput.pick = null;
      if (owned.current.has(want)) equip(want);
    }


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
    } else if ((trigger.current || touchInput.fire) && !spectating && fireCd.current <= 0) {
      const w = weapon.current;
      fire();
      // the sidearm always fires at its stock cadence; fire-rate perks skip it
      fireCd.current = (w === "pistol" ? GUNS.pistol.cooldown : GUNS[w].cooldown / stats.current.rate)
        * (overdrive.current > 0 ? 0.5 : 1)
        * (mutator.current?.id === "surge" ? 0.77 : 1); // OVERDRIVE round: everyone shoots faster
    }

    // player movement — the boss round makes the ground treacherous, so you slide
    const fwd = (k.has("KeyW") ? 1 : 0) - (k.has("KeyS") ? 1 : 0) + touchInput.moveZ;
    const strafe = (k.has("KeyD") ? 1 : 0) - (k.has("KeyA") ? 1 : 0) + touchInput.moveX;
    cam.getWorldDirection(FORWARD);
    FORWARD.y = 0;
    FORWARD.normalize();
    RIGHT.crossVectors(FORWARD, cam.up).normalize();
    MOVE.set(0, 0, 0).addScaledVector(FORWARD, fwd).addScaledVector(RIGHT, strafe);
    const moving = MOVE.lengthSq() > 0.0004;
    if (MOVE.lengthSq() > 1) MOVE.normalize();
    const slip = wave.current === WAVES.length ? theme.hazard.slip : 0;
    const resp = slip > 0 ? Math.min(1, delta * (1.5 + (1 - slip) * 22)) : 1;
    const mut = mutator.current?.id;
    const running = k.has("ShiftLeft") || k.has("ShiftRight") || touchInput.run;
    const spd = SPEED * stats.current.speed
      * (running ? RUN_MUL : 1)
      * (stats.current.holster && weapon.current === "pistol" ? 1.15 : 1)
      * (overdrive.current > 0 ? 1.3 : 1)
      * (mut === "cryo" ? 0.85 : mut === "gravity" ? 0.9 : 1); // CRYO SURGE / HEAVY GRAVITY drag you down
    if (dashT.current > 0) {
      // dash burst: carry the impulse, easing off, instead of snapping to walk speed
      dashT.current -= delta;
      const k = Math.min(1, delta * 4);
      slide.current.x += (MOVE.x * spd - slide.current.x) * k;
      slide.current.z += (MOVE.z * spd - slide.current.z) * k;
    } else {
      slide.current.x += (MOVE.x * spd - slide.current.x) * resp;
      slide.current.z += (MOVE.z * spd - slide.current.z) * resp;
    }
    if (Math.abs(slide.current.x) > 0.001 || Math.abs(slide.current.z) > 0.001) {
      const nx = cam.position.x + slide.current.x * delta;
      const nz = cam.position.z + slide.current.z * delta;
      const hit = alpine ? (x: number, z: number) => bigPlayerBlocked(blocks, x, z, 0.4, feetY.current, jumpY.current > 0) : (x: number, z: number) => blocked(blocks, x, z, 0.4);
      if (!hit(nx, cam.position.z)) cam.position.x = nx; else slide.current.x = 0;
      if (!hit(cam.position.x, nz)) cam.position.z = nz; else slide.current.z = 0;
    }

    bobAmt.current += ((moving ? 1 : 0) - bobAmt.current) * Math.min(1, delta * 8);
    // jump: Space on desktop, JUMP button on touch
    const wantJump = k.has("Space") || touchInput.jump;
    if (wantJump && jumpY.current <= 0 && jumpV.current <= 0 && !spectating) jumpV.current = JUMP_V;
    if (jumpY.current > 0 || jumpV.current > 0) {
      const dt = Math.min(delta, 0.05);
      jumpV.current -= GRAVITY * (mut === "gravity" ? 1.4 : 1) * dt;
      jumpY.current += jumpV.current * dt;
      if (jumpY.current <= 0) { jumpY.current = 0; jumpV.current = 0; }
    }
    const floorY = alpine ? bigFloorY(cam.position.x, cam.position.z, feetY.current) : groundY(cam.position.x, cam.position.z);
    feetY.current = floorY;
    cam.position.y = EYE + jumpY.current + floorY;
    if (alpine) { spawnFocus.x = cam.position.x; spawnFocus.z = cam.position.z; radarFeed.x = cam.position.x; radarFeed.z = cam.position.z; radarFeed.yaw = look.current.yaw; }

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
        pickupMesh.current.position.set(pk.x, Math.sin(state.clock.elapsedTime * 3) * 0.15, pk.z);
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
        healMesh.current.position.set(hp.x, 0.9 + Math.sin(state.clock.elapsedTime * 3) * 0.15, hp.z);
        healMesh.current.rotation.y += delta * 1.5;
      }
    }
    if (hp.active && !spectating && Math.hypot(cam.position.x - hp.x, cam.position.z - hp.z) < 1.3) {
      hp.active = false;
      onHeal();
      if (!isH) n?.broadcast({ type: "take", what: "heal" });
    }

    // hazard props: keep each one parked on its spot until it is blown open
    hazards.current.forEach((hz, i) => {
      const g = hazardMeshes.current[i];
      if (!g) return;
      g.visible = hz.alive;
      if (hz.alive) {
        g.position.set(hz.x, 0, hz.z);
        g.rotation.y = i * 1.3;
      }
    });


    // supply crate pickup
    const ck = crate.current;
    if (crateKindRef.current !== ck.kind) {
      crateKindRef.current = ck.kind;
      setCrateKind(ck.kind);
    }
    if (crateMesh.current) {
      crateMesh.current.visible = ck.active;
      if (ck.active) {
        crateMesh.current.position.set(ck.x, 0.5 + Math.sin(state.clock.elapsedTime * 2.4) * 0.12, ck.z);
        crateMesh.current.rotation.y += delta * 1.2;
      }
    }
    if (ck.active && !spectating && Math.hypot(cam.position.x - ck.x, cam.position.z - ck.z) < 1.4) {
      ck.active = false;
      if (ck.kind === "turret" && turrets.current.length < 6) turrets.current.push({ x: cam.position.x, z: cam.position.z, t: TURRET_LIFE, cd: 0 });
      if (ck.kind === "mine" && mines.current.length < 6) mines.current.push({ x: cam.position.x, z: cam.position.z, armed: 1 });
      if (ck.kind === "ammo") {
        owned.current.forEach((w) => {
          const cap = Math.round((w === "pistol" && stats.current.extmag ? 220 : GUNS[w].ammo) * stats.current.ammoMul);
          ammo.current[w] = Math.min(cap, ammo.current[w] + Math.round(cap * 0.5));
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
        mesh.position.set(t.x, 0, t.z);
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
        fireInto(bullets.current, new THREE.Vector3(t.x, 1.1, t.z), v, 0.4, 0.5, "#4fe3ff", 0.11, { knock: stats.current.knock });
        if (mesh) mesh.rotation.y = Math.atan2(best.x - t.x, best.z - t.z);
      }
    }
    for (let i = turrets.current.length; i < 6; i++) { const m2 = turretMeshes.current[i]; if (m2) m2.visible = false; }
    for (let i = mines.current.length; i < 6; i++) { const m2 = mineMeshes.current[i]; if (m2) m2.visible = false; }

    // keep the HUD status panel in sync with what's deployed
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
      const mid = mutator.current?.id;
      if (mid === "cryo" && slow < 1.2) slow = 1.2; // CRYO SURGE: every shot chills
      if (mid === "gravity") kb *= 2; // HEAVY GRAVITY: hits shove much harder
      const siphon = stats.current.steal * (mid === "blood" ? 2 : 1); // BLOOD MOON doubles life siphon
      if (siphon > 0 && dmg > 0) {
        stealBank.current += dmg * siphon;
        if (stealBank.current >= 1) { stealBank.current -= 1; onLeech(); }
      }
      if (kb > 0 && e.kind !== "boss") {
        const len = Math.hypot(kx, kz) || 1;
        const push = kb * (e.kind === "brute" || e.kind === "vanguard" ? 0.5 : 1);
        // walk the push in small steps so a shove never drives anyone into cover
        const er = Math.min(STATS[e.kind].radius, 0.8);
        const steps = Math.max(1, Math.ceil(push / 0.35));
        const sx = (kx / len) * (push / steps);
        const sz = (kz / len) * (push / steps);
        for (let s = 0; s < steps; s++) {
          const nx = e.x + sx;
          const nz = e.z + sz;
          const okX = !blocked(blocks, nx, e.z, er);
          const okZ = !blocked(blocks, e.x, nz, er);
          if (!okX && !okZ) break;
          if (okX) e.x = nx;
          if (okZ) e.z = nz;
        }
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
            fireInto(enemyBullets.current, new THREE.Vector3(e.x + v.x * 0.6, 1.2, e.z + v.z * 0.6), v.multiplyScalar(9), 0.9, 1, "", 0.14);
          }
        }
        onScore();
        if (e.elite) { onShard(15); e.elite = 0; }
        // elites, mini-bosses and bosses always leave a medkit behind
        if (e.kind === "boss" || e.kind === "vanguard") heal.current = { x: e.x, z: e.z, active: true };
        // SOLAR FLARE round: every corpse pops in a small fire blast
        if (mid === "flare") {
          playFx("#ff9a3a", 0.4, 3.2, 0.3, e.x, e.z);
          if (!spectating && Math.hypot(cam.position.x - e.x, cam.position.z - e.z) < 2.6) takeHit(1);
        }
        onKill(e);

      }
    };

    /** A shot hazard prop goes off: everything close takes the map's own effect. */
    const blowHazard = (idx: number, share = true, visualOnly = false) => {
      const h = hazards.current[idx];
      if (!h || !h.alive) return;
      h.alive = false;
      const def = hazardRef.current;
      playFx(def.core, 0.6, def.radius, 0.45, h.x, h.z);
      playSfx("boom");
      for (let ei = 0; !visualOnly && ei < enemies.length; ei++) {
        const e = enemies[ei]!;
        if (!e.alive) continue;
        const d = Math.hypot(e.x - h.x, e.z - h.z);
        if (d > def.radius) continue;
        const dx = e.x - h.x;
        const dz = e.z - h.z;
        if (def.effect === "fire") hurtEnemy(e, def.damage, ei, 0, 3, 3, dx, dz);
        else if (def.effect === "freeze") { e.frozen = 3; hurtEnemy(e, def.damage, ei, 3); }
        else if (def.effect === "toxic") hurtEnemy(e, def.damage, ei, 2.5, 2.5);
        else if (def.effect === "shock") hurtEnemy(e, def.damage, ei, 1.5, 0, 2, dx, dz);
        else if (def.effect === "root") hurtEnemy(e, def.damage, ei, 4);
        else hurtEnemy(e, def.damage, ei, 1, 0, Math.max(0, d - 1), -dx, -dz); // pull
      }
      // players standing in a blast get singed too, so they stay dangerous
      if (!spectating && Math.hypot(cam.position.x - h.x, cam.position.z - h.z) < def.radius * 0.7) takeHit(2);
      if (share) netRef.current?.broadcast({ type: "haz", i: idx });
    };
    hazardBlow.current = (i: number, visualOnly = false) => blowHazard(i, false, visualOnly);



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
    // --- orbital strike: targeting marker, then a beam crashing out of the sky ---
    if (flareTimer.current > 0) {
      flareTimer.current -= delta;
      if (flareTimer.current <= 0) {
        for (let ei = 0; ei < enemies.length; ei++) {
          const e = enemies[ei]!;
          if (e.alive && Math.hypot(e.x - strikeAt.current.x, e.z - strikeAt.current.z) < 5) hurtEnemy(e, 7, ei);
        }
        strikeFlash.current.t = 0.5;
        playFx("#ffd46a", 1, 10, 0.5, strikeAt.current.x, strikeAt.current.z);
      }
    }
    if (strikeRing.current) {
      const aiming = flareTimer.current > 0;
      strikeRing.current.visible = aiming;
      if (aiming) {
        const p = 1 - flareTimer.current / 1.2;
        strikeRing.current.position.set(strikeAt.current.x, 0.08, strikeAt.current.z);
        strikeRing.current.rotation.z = state.clock.elapsedTime * 3;
        strikeRing.current.scale.setScalar(5 * (1.7 - p * 0.7));
        (strikeRing.current.material as THREE.MeshBasicMaterial).opacity = 0.45 + Math.sin(state.clock.elapsedTime * 26) * 0.3;
      }
    }
    if (strikeBeam.current) {
      const f = strikeFlash.current;
      if (f.t > 0) f.t -= delta;
      strikeBeam.current.visible = f.t > 0;
      if (f.t > 0) {
        const k = f.t / 0.5;
        strikeBeam.current.position.set(strikeAt.current.x, 22, strikeAt.current.z);
        strikeBeam.current.scale.set(1 + (1 - k) * 1.6, 1, 1 + (1 - k) * 1.6);
        (strikeBeam.current.material as THREE.MeshBasicMaterial).opacity = Math.min(1, k * 1.2);
      }
    }
    // --- shared ground shockwave ring used by the other abilities ---
    if (ringMesh.current) {
      const r = ringFx.current;
      if (r.t > 0) r.t -= delta;
      ringMesh.current.visible = r.t > 0;
      if (r.t > 0) {
        const p = 1 - r.t / r.dur;
        ringMesh.current.position.set(r.x, r.y, r.z);
        ringMesh.current.scale.setScalar(r.r0 + (r.r1 - r.r0) * p);
        const mat = ringMesh.current.material as THREE.MeshBasicMaterial;
        mat.color.set(r.color);
        mat.opacity = 0.85 * (1 - p);
      }
    }
    // --- chain storm lightning arcs ---
    {
      const b = boltFx.current;
      if (b.t > 0) {
        b.t -= delta;
        const flick = b.t > 0 ? 0.35 + Math.random() * 0.65 : 0;
        for (let bi = 0; bi < 6; bi++) {
          const m = boltMeshes.current[bi];
          if (!m || !m.visible) continue;
          if (b.t <= 0) { m.visible = false; continue; }
          m.rotateOnAxis(BULLET_UP, delta * 24);
          (m.material as THREE.MeshBasicMaterial).opacity = flick;
        }
      }
    }

    if (abilFire.current) {
      abilFire.current = false;
      const id = abilityRef.current;
      if (!spectating && abilCd.current <= 0) {
        abilCd.current = ABILITIES[id].cd * (1 - stats.current.haste);
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
          slide.current.x = FORWARD.x * 30;
          slide.current.z = FORWARD.z * 30;
          dashT.current = 0.3;
          invuln.current = 0.7;
          playFx("#bfe9ff", 0.6, 5, 0.35, cam.position.x, cam.position.z);
        } else if (id === "well") {
          const cx = cam.position.x + FORWARD.x * 6, cz = cam.position.z + FORWARD.z * 6;
          for (let ei = 0; ei < enemies.length; ei++) {
            const e = enemies[ei]!;
            const d = Math.hypot(cx - e.x, cz - e.z);
            if (e.alive && d < 13) hurtEnemy(e, 1, ei, 2.5, 0, Math.max(0, d - 1), cx - e.x, cz - e.z);
          }
          // collapsing vortex ring at the well's centre
          playFx("#a55cff", 13, 0.6, 0.9, cx, cz);
        } else if (id === "repulse") {
          near(9, (e, ei) => hurtEnemy(e, 2, ei, 0, 0, 7, e.x - cam.position.x, e.z - cam.position.z));
          playFx("#68d0ff", 0.6, 9, 0.45, cam.position.x, cam.position.z);
        } else if (id === "nova") {
          near(8, (e, ei) => { e.frozen = 3.5; hurtEnemy(e, 1, ei, 3.5); });
          playFx("#9ff4ff", 0.5, 8, 0.6, cam.position.x, cam.position.z);
        } else if (id === "storm") {
          const list = enemies.map((e, i) => ({ e, i, d: Math.hypot(e.x - cam.position.x, e.z - cam.position.z) }))
            .filter((o) => o.e.alive && o.d < 20).sort((a, b) => a.d - b.d).slice(0, 6);
          list.forEach((o) => hurtEnemy(o.e, 4, o.i));
          // draw a lightning arc from the player to every zapped enemy
          boltFx.current = { t: 0.42, dur: 0.42 };
          for (let bi = 0; bi < 6; bi++) {
            const m = boltMeshes.current[bi];
            if (!m) continue;
            const tgt = list[bi];
            m.visible = !!tgt;
            if (!tgt) continue;
            const ax = cam.position.x, az = cam.position.z, ay = cam.position.y - 0.4;
            const bx = tgt.e.x, bz = tgt.e.z, by = 1.1;
            const len = Math.hypot(bx - ax, bz - az, by - ay);
            m.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
            m.scale.set(1, len, 1);
            TMP_DIR.set(bx - ax, by - ay, bz - az).normalize();
            m.quaternion.setFromUnitVectors(BULLET_UP, TMP_DIR);
          }
          playFx("#7fdcff", 0.6, 20, 0.35, cam.position.x, cam.position.z);
        } else if (id === "warp") {
          near(9999, (e, ei) => hurtEnemy(e, 0, ei, 5));
          playFx("#c9a6ff", 0.6, 40, 0.8, cam.position.x, cam.position.z);
        } else if (id === "strike") {
          strikeAt.current = { x: cam.position.x + FORWARD.x * 10, z: cam.position.z + FORWARD.z * 10 };
          flareTimer.current = 1.2;
        } else if (id === "barrier") {
          invuln.current = 6;
          playFx("#7ad7ff", 0.6, 3.2, 0.5, cam.position.x, cam.position.z);
        }

      } else if (abilCd.current > 0) {
        playSfx("deny");
      }
    }
    cdReport.current -= delta;
    if (cdReport.current <= 0) {
      cdReport.current = 0.2;
      onAbilityCd(abilCd.current, ABILITIES[abilityRef.current].cd * (1 - stats.current.haste));
    }

    // cryo mines freeze and hurt whatever walks onto them
    for (let mi = mines.current.length - 1; mi >= 0; mi--) {
      const mn = mines.current[mi]!;
      const mesh = mineMeshes.current[mi];
      if (mesh) { mesh.visible = true; mesh.position.set(mn.x, 0.2, mn.z); }
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
        if (pd.t <= 0) {
          const e = enemies[i]!;
          e.x = pd.x;
          e.z = pd.z;
          e.alive = true;
          if (e.kind === "boss") onBoss(BOSS_HP);
          pending.current[i] = null;
        }
      });
      // waves
      const remaining = enemies.filter((e) => e.alive).length + pending.current.filter(Boolean).length;
      if (remaining === 0 && (endless.current || wave.current <= WAVES.length)) {
        // clearing the map boss ends the run — unless overtime is switched on
        if (wave.current === WAVES.length && !endless.current) {
          if (!wonLatch.current) {
            wonLatch.current = true;
            status(WAVES.length, 0, true, false);
          }
          return;
        }
        wonLatch.current = false;
        // wave cleared: tell everyone so the shop opens during the break
        if (wave.current > 0 && lastRemaining.current !== 0) {
          lastRemaining.current = 0;
          status(wave.current, 0, false, false);
        }
        nextWaveTimer.current -= delta;
        if (nextWaveTimer.current <= 0) {
          wave.current++;
          spawnWave(wave.current);
          nextWaveTimer.current = 15; // shopping break before the next wave
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
        if (r.hp > 0 && now - r.last < 4000) targets.push({ id: r.id, x: r.x, z: r.z, y: EYE });
      });
      if (targets.length === 0) targets.push({ id: null, x: cam.position.x, z: cam.position.z, y: cam.position.y });

      const hurtTarget = (t: Target, dmg: number) => {
        if (t.id === null) takeHit(dmg);
        else n?.sendTo(t.id, { type: "hurt", dmg });
      };

      // flow field per target cell (cached)
      const used = new Set<number>();
      for (const t of targets) {
        const key = toCell(t.x) * 1000 + toCell(t.z);
        used.add(key);
        if (!fields.current.has(key)) fields.current.set(key, flowField(solid, toCell(t.x), toCell(t.z)));
      }
      if (fields.current.size > 12) {
        fields.current.forEach((_, key) => { if (!used.has(key)) fields.current.delete(key); });
      }

      meleeCooldown.current -= delta;
      for (const e of enemies) {
        if (!e.alive) continue;
        e.flash -= delta;
        e.cooldown -= delta;
        if (e.slow > 0) e.slow -= delta;
        if ((e.frozen ?? 0) > 0) {
          // frozen solid: no moving, no attacking, attack timers paused
          e.frozen! -= delta;
          if (e.burn > 0) { e.burn -= delta; }
          e.cooldown += delta;
          e.shot += delta;
          continue;
        }
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

        // route around obstacles: go straight if clear, else follow the flow field
        let tx = target.x;
        let tz = target.z;
        const ghost = e.kind === "specter"; // specters drift straight through cover
        if (!ghost && !clearLine(blocks, e.x, e.z, tx, tz, Math.min(st.radius, 0.8) * 0.9)) {
          const dist = fields.current.get(toCell(target.x) * 1000 + toCell(target.z));
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
        }
        if (e.swing > 0) dir = 0;
        // OVERDRIVE rounds make the swarm faster; BLOOD MOON knits their wounds back
        const mutId2 = mutator.current?.id;
        if (mutId2 === "blood" && e.max && e.hp < e.max) e.hp = Math.min(e.max, e.hp + delta * 0.8);
        const step = st.speed * spMul * (mutId2 === "surge" ? 1.25 : 1) * (e.slow > 0 ? 0.5 : 1) * delta * dir;
        let nx = e.x + (mx / md) * step;
        let nz = e.z + (mz / md) * step;
        if (spType === "stalker" || spType === "shinobi") {
          // flanking arcs / zig-zag dash-steps
          const now = performance.now() / 1000;
          const side = spType === "shinobi" ? Math.sign(Math.sin(now * 3.2 + (e.max ?? 1))) * 3.2 : Math.sin(now * 1.3 + (e.max ?? 1)) * 2.4;
          nx += (-dz / d) * side * delta * (e.slow > 0 ? 0.5 : 1);
          nz += (dx / d) * side * delta * (e.slow > 0 ? 0.5 : 1);
        }
        const r = Math.min(st.radius, 0.8);
        if (ghost) { e.x = nx; e.z = nz; }
        else {
          // if anything ever ends up wedged inside cover, slide it back out
          if (blocked(blocks, e.x, e.z, r)) {
            const out = pushOut(blocks, e.x, e.z, r);
            e.x = out.x;
            e.z = out.z;
          }
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
          const from = new THREE.Vector3(e.x, 1.5, e.z);
          const vel = new THREE.Vector3(target.x, target.y - 0.2, target.z).sub(from).normalize();
          from.addScaledVector(vel, 0.8);
          fireInto(enemyBullets.current, from, vel.multiplyScalar(ENEMY_BULLET_SPEED), 3.5, st.dmg);
        }
        // BOMBER: heavy shells lobbed from above, they clear low cover
        if (e.kind === "bomber") {
          e.shot -= delta;
          if (e.shot <= 0 && d < 30) {
            e.shot = 3 + rand();
            const from = new THREE.Vector3(e.x, 3.2, e.z);
            const vel = new THREE.Vector3(target.x - e.x, target.y - 3.2, target.z - e.z).normalize();
            from.addScaledVector(vel, 1.2);
            fireInto(enemyBullets.current, from, vel.multiplyScalar(ENEMY_BULLET_SPEED * 0.8), 4.5, st.dmg, "", 0.36);
          }
        }
        if (spType) {
          e.shot -= delta;
          const aim = (y: number, spd: number, spread: number, n: number, dmg: number, life = 3.5, size = 0.2) => {
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
        }
        if (e.kind === "boss") {
          e.shot -= delta;
          if (e.shot <= 0 && d < 30) {
            e.shot = 1.8;
            const from = new THREE.Vector3(e.x, 2.6, e.z);
            const base = Math.atan2(dx, dz);
            for (let s = -3; s <= 3; s++) {
              const a = base + s * 0.16;
              const vel = new THREE.Vector3(Math.sin(a), (target.y - 2.6) / d, Math.cos(a)).normalize();
              const p = from.clone().addScaledVector(vel, 1.6);
              fireInto(enemyBullets.current, p, vel.multiplyScalar(ENEMY_BULLET_SPEED), 4, st.dmg - 1, "", 0.3);
            }
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
          // shooting a hazard prop sets it off before anything else
          let popped = false;
          for (let hi = 0; hi < hazards.current.length; hi++) {
            const hz = hazards.current[hi]!;
            if (!hz.alive) continue;
            if (Math.hypot(b.pos.x - hz.x, b.pos.z - hz.z) < 0.85 && b.pos.y < 2) {
              if (b.track === 1) { onStat("hit", 1); b.track = 2; }
              blowHazard(hi, true, !isH); // the host works out who the blast hurts
              burst(b);
              b.active = false;
              popped = true;
              break;
            }
          }
          if (popped) { if (m) m.visible = false; return; }
          for (let ei = 0; ei < enemies.length; ei++) {
            const e = enemies[ei]!;
            if (!e.alive) continue;
            const h = e.kind === "boss" ? 5 : e.kind === "brute" || e.kind === "vanguard" ? 2.6 : 2;
            if (Math.hypot(b.pos.x - e.x, b.pos.z - e.z) < STATS[e.kind].radius + 0.2 && b.pos.y < h) {
              // a vanguard's slab soaks most of a normal hit; piercing shots go right through it
              let dmg = e.kind === "vanguard" && b.pierce <= 0 ? Math.max(1, Math.round(b.damage * 0.34)) : b.damage;
              if (b.mods & M_EXEC && e.hp < (e.max ?? e.hp) * 0.5) dmg *= 2;
              const lethal = e.hp - dmg * ((e.shredUntil ?? 0) > performance.now() ? 1.3 : 1) <= 0;
              hurtEnemy(e, dmg, ei, b.slow, b.burn, b.knock, b.vel.x, b.vel.z);
              // accuracy: a shot you fired counts as a hit once, no matter how many it pierces
              if (b.track === 1) { onStat("hit", 1); b.track = 2; }
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
          // point the round along its flight path
          if (b.vel.lengthSq() > 0.0001) {
            TMP_DIR.copy(b.vel).normalize();
            m.quaternion.setFromUnitVectors(BULLET_UP, TMP_DIR);
          }
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
          for (const en of enemies) {
            e.push(en.alive ? 1 : 0, KINDS.indexOf(en.kind), Math.round(en.x * 100) / 100, Math.round(en.z * 100) / 100, en.swing);
          }
          const b: number[] = [];
          for (const bu of enemyBullets.current) {
            if (bu.active) b.push(Math.round(bu.pos.x * 100) / 100, Math.round(bu.pos.y * 100) / 100, Math.round(bu.pos.z * 100) / 100);
          }
          const mk: number[] = [];
          pending.current.forEach((pd, i) => {
            if (pd && pd.t <= MARK_TIME) mk.push(i, Math.round(pd.x * 100) / 100, Math.round(pd.z * 100) / 100, Math.round(pd.t * 100) / 100);
          });
          n.broadcast({
            type: "snap", e, b, mk,
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
      if (pd) g.position.set(pd.x, 0, pd.z);
    });
    const v = viewModel.current;
    if (!v) return;
    v.visible = !deadRef.current; // spectators carry no weapon

    v.position.copy(cam.position);
    v.quaternion.copy(cam.quaternion);
    // gun stays rock steady while moving — only recoil nudges it
    v.translateX(0.3);
    v.translateY(-0.28 + recoil.current * 0.03);
    v.translateZ(-0.75 + recoil.current * 0.08);
    v.rotateX(recoil.current * 0.15);
  });

  return (
    <>
      {!alpine && <color attach="background" args={[theme.sky]} />}
      {!alpine && <fog attach="fog" args={[theme.sky, 16, ARENA * 1.7]} />}
      {!alpine && <hemisphereLight args={[theme.hemi[0], theme.hemi[1], 1.1]} />}
      {!alpine && <directionalLight
        position={[18, 26, 10]}
        intensity={1.5}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />}
      {alpine ? <BigMapScene map={alpine} playing={locked && !gameOver} isHost={isHost} /> : <Level blocks={blocks} theme={theme} />}
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
      {/* ability shockwave ring (unit radius, scaled per effect) */}
      <mesh ref={ringMesh} visible={false} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.86, 1, 48]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.8} fog={false} depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
      </mesh>
      {/* chain storm arcs */}
      {Array.from({ length: 6 }, (_, i) => (
        <mesh key={`bolt${i}`} ref={(m) => { boltMeshes.current[i] = m; }} visible={false}>
          <cylinderGeometry args={[0.05, 0.05, 1, 3, 1, true]} />
          <meshBasicMaterial color="#9fe8ff" transparent opacity={0.9} fog={false} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
      ))}
      {/* orbital strike: ground marker + falling beam */}
      <mesh ref={strikeRing} visible={false} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.72, 1, 6]} />
        <meshBasicMaterial color="#ff5a28" transparent opacity={0.7} fog={false} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={strikeBeam} visible={false}>
        <cylinderGeometry args={[4.4, 2.6, 44, 20, 1, true]} />
        <meshBasicMaterial color="#ffd77a" transparent opacity={0.9} fog={false} depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
      </mesh>
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
      {/* shootable hazard props, styled to the map they sit in */}
      {Array.from({ length: HAZARD_COUNT }, (_, i) => (
        <group key={`haz${i}`} ref={(g) => { hazardMeshes.current[i] = g; }} visible={false}>
          <HazardProp def={hazardDef} />
        </group>
      ))}
      <mesh ref={barrierMesh} visible={false}>
        <sphereGeometry args={[1.6, 16, 12]} />
        <meshBasicMaterial color="#7cc6ff" wireframe transparent opacity={0.45} fog={false} />
      </mesh>
      <group ref={viewModel} scale={0.7}>
        <GunModel w={held} mods={stats.current} />
      </group>
      <RemotePlayers remotes={remotes} />
      <Shards enemies={enemies} active={shardActive} magnet={magnetRef} onCollect={onShard} taken={takenShards} onTake={(id) => netRef.current?.broadcast({ type: "shard", id })} />
      <BulletPool meshes={bulletMeshes} color="#ff8a1f" size={0.14} />

      <BulletPool meshes={enemyBulletMeshes} color={theme.enemyBullet} size={0.18} shape="sphere" />
    </>
  );
}

export function Game() {
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9));
  // Anti-repeat: roll a new seed whose map differs from the current one.
  const coopMapRef = useRef<"arenas" | BigMapId>("arenas");
  useEffect(() => { const t = testMap(); if (t) setSeed(bigSeed(t)); }, []);
  const freshSeed = (prev: number) => {
    if (coopMapRef.current !== "arenas" && netHolder.current) return bigSeed(coopMapRef.current);
    // solo: Nuketown joins the rotation of the 10 arenas
    if (!netHolder.current && bigIdOf(prev) !== "nuketown" && Math.random() < 1 / 11) return bigSeed("nuketown");
    let s = Math.floor(Math.random() * 1e9);
    while (s % THEMES.length === prev % THEMES.length) s = Math.floor(Math.random() * 1e9);
    return s;
  };
  const [score, setScore] = useState(0);
  const [health, setHealth] = useState(MAX_HP);
  const [locked, setLocked] = useState(false);
  const pausedRef = useRef(false);
  pausedRef.current = !locked;
  const [started, setStarted] = useState(false);
  const [status, setStatus] = useState({ wave: 1, remaining: 0, won: false });
  const [banner, setBanner] = useState(false);
  /** overtime past the map boss, plus the round condition it rolled */
  const endlessRef = useRef(false);
  const goingOvertime = useRef(false);
  const [mutId, setMutId] = useState<Mutator["id"]>("none");
  const [highWave, setHighWave] = useState(0);
  useEffect(() => setHighWave(readHighWave()), []);
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
  /** starter class, chosen on the loadout screen alongside the ability */
  const [cls, setCls] = useState<ClassId>(() => {
    if (typeof window === "undefined") return "vanguard";
    const saved = window.localStorage.getItem("df-class") as ClassId | null;
    return saved && CLASSES[saved] ? saved : "vanguard";
  });
  /** ability pick screen shown after pressing START, before the match begins */
  const [picking, setPicking] = useState(false);
  /** what every squad member has chosen, keyed by player number */
  const [picks, setPicks] = useState<Record<number, AbilityId>>({});
  const [clsPicks, setClsPicks] = useState<Record<number, ClassId>>({});
  const [abilCd, setAbilCd] = useState({ left: 0, max: 6 });
  /** phones and tablets play with on-screen controls instead of mouse + keyboard */
  useEffect(() => {
    if (!locked) resetTouchInput();
  }, [locked]);
  const [touchUi, setTouchUi] = useState(false);
  const [portrait, setPortrait] = useState(false);
  useEffect(() => {
    setTouchUi(isTouchDevice());
    const onResize = () => setPortrait(window.innerHeight > window.innerWidth);
    onResize();
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);
  const [eventMsg, setEventMsg] = useState<string | null>(null);
  // run tally for the post-game recap
  const run = useRef({ shots: 0, hits: 0, dmg: 0, taken: 0, shards: 0 });
  const [squad, setSquad] = useState<Record<number, { kills: number; dmg: number; acc: number; shards: number; taken: number }>>({});
  const [perks, setPerks] = useState<Perks>(NO_PERKS);
  const perksRef = useRef(perks);
  perksRef.current = perks;
  const clsMods = CLASSES[cls].mods;
  const clsRef = useRef(clsMods);
  clsRef.current = clsMods;
  const statsRef = useRef<Derived>(derive(perks, clsMods));
  statsRef.current = derive(perks, clsMods);

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
      setHealth(derive(NO_PERKS, clsRef.current).maxHp);
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
    if (m.type === "ot") { endlessRef.current = true; setStatus((s) => ({ ...s, won: false })); return; }
    if (m.type === "mut") { setMutId(String(m.id) as Mutator["id"]); return; }
    if (m.type === "pick") {
      const num = Number(m.num);
      const id = String(m.ability) as AbilityId;
      const c = String(m.cls) as ClassId;
      if (num >= 1 && ABILITIES[id]) setPicks((p) => (p[num] === id ? p : { ...p, [num]: id }));
      if (num >= 1 && CLASSES[c]) setClsPicks((p) => (p[num] === c ? p : { ...p, [num]: c }));
      return;
    }

    if (m.type === "kill") { setScore((s) => s + 1); return; }
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
    if (m.type === "status" && m.banner) setHealth((h) => (h <= 0 ? derive(perksRef.current, clsRef.current).maxHp : h));
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
    setPicks({});
  };

  /** quit a match in progress and go back to the title screen */
  const leaveGame = () => {
    leaveRoom();
    setLocked(false);
    setPicking(false);
    setStarted(false);
    setScore(0);
    setHealth(derive(NO_PERKS, clsRef.current).maxHp);
    setPerks(NO_PERKS);
    setShards(0);
    setBossHp(0);
    setStatus({ wave: 1, remaining: 0, won: false });
    endlessRef.current = false;
    setMutId("none");
    setWeapon("pistol");
    setSeed((p) => freshSeed(p));
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
      const v = JSON.parse(localStorage.getItem("scrapfall-settings") ?? "{}");
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
    localStorage.setItem("scrapfall-settings", JSON.stringify({ fov, sensX, sensY, musicVol, sfxVol }));
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
  const { blocks, enemies, rand, theme, alpine } = useMemo(() => {
    let bigId = bigIdOf(seed);
    if (bigId && bigId !== "nuketown" && !coop && !testMap()) bigId = null; // the 4 huge maps are co-op only
    const alpine = bigId ? setupBigMap(bigId, BIG_LAYOUT_SEED[bigId], !coop) : null;
    setBigGround(!!alpine);
    spawnFocus.on = !!alpine && alpine.size > 200;
    if (alpine) { spawnFocus.x = alpine.spawn.x; spawnFocus.z = alpine.spawn.z; }
    setArenaSize(alpine ? alpine.size : coop ? COOP_ARENA : SOLO_ARENA); // co-op gets a bigger field
    const level = alpine ? { blocks: alpine.blocks, seed, rand: generateLevel(seed).rand } : generateLevel(seed);
    const theme = alpine ? toOurTheme(alpine.theme as unknown as Theme) : THEMES[seed % THEMES.length]!;
    // slim props get a tighter collision box so shots line up with the trunk
    const slim = theme.blockShape === "tree" || theme.blockShape === "coral";
    setBlockHalf(alpine ? 1 : slim ? 0.72 : theme.blockShape === "pagoda" ? 0.86 : BLOCK / 2);
    if (!alpine) level.blocks = level.blocks.filter((b) => Math.max(Math.abs(b.x), Math.abs(b.z)) > BLOCK / 2 + 2.5);
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
    return { blocks: level.blocks, enemies: list, rand: level.rand, theme, alpine };
  }, [seed, coop]);
  const alpineMap = useMemo(() => (alpine && typeof document !== "undefined" ? bigMinimap(alpine) : null), [alpine]);


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
      // P is the pause key on desktop; Escape still works since the browser
      // drops pointer lock on it anyway
      if (e.code === "Escape" || e.code === "KeyP") {
        setLocked(false);
        if (document.pointerLockElement) document.exitPointerLock();
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
    if (typeof window !== "undefined") window.localStorage.setItem("df-class", cls);
  }, [cls]);

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
  const [deathMsg, setDeathMsg] = useState(false);
  useEffect(() => {
    if (!dead) { setDeathMsg(false); return; }
    setDeathMsg(true);
    const t = window.setTimeout(() => setDeathMsg(false), 5000);
    return () => window.clearTimeout(t);
  }, [dead]);
  const gameOver = multiplayer ? allDown : dead;
  const ended = gameOver || status.won;
  // keep the deepest wave ever reached, overtime included
  useEffect(() => {
    if (!ended) return;
    const reached = status.won && !endlessRef.current ? WAVES.length : Math.max(0, status.wave - 1);
    setHighWave((h) => {
      if (reached <= h) return h;
      saveHighWave(reached);
      return reached;
    });
  }, [ended, status.won, status.wave]);
  const isHost = !net || net.role === "host";
  const myNum = !net || net.role === "host" ? 1 : (roster.find((r) => r.id === net.self)?.num ?? 2);
  const connected = [{ id: "host", num: 1 }, ...roster];
  const paused = started && !ended && !locked;
  // keep my own pick in the squad list and tell everyone else about it
  useEffect(() => {
    setPicks((p) => (p[myNum] === ability ? p : { ...p, [myNum]: ability }));
    setClsPicks((p) => (p[myNum] === cls ? p : { ...p, [myNum]: cls }));
    netHolder.current?.broadcast({ type: "pick", num: myNum, ability, cls });
  }, [ability, cls, myNum, roster.length, picking]);

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
    // going into overtime keeps the current run, build and map intact
    const overtime = goingOvertime.current;
    goingOvertime.current = false;
    const resuming = (started && !ended) || overtime;
    setPicking(false);
    setStarted(true);
    if (ended && !fromNet && !overtime) {
      run.current = { shots: 0, hits: 0, dmg: 0, taken: 0, shards: 0 };
      setSquad({});
      if (isHost) {
        const s = freshSeed(seed);
        setSeed(s);
        net?.broadcast({ type: "seed", seed: s });
      }
      setScore(0);
      setHealth(derive(NO_PERKS, clsRef.current).maxHp);
      setPerks(NO_PERKS);
      setShards(0);
      setAllDown(false);
      setStatus({ wave: 1, remaining: 0, won: false });
      setWeapon("pistol");
      setBossHp(0);
      endlessRef.current = false;
      setMutId("none");
    }
    // fresh run: start at the class's full max HP (e.g. Vanguard 16)
    if (!resuming) setHealth(derive(perksRef.current, clsRef.current).maxHp);
    setLocked(true);
    // the whole squad starts and resumes together
    if (!fromNet && net && (resuming || isHost)) net.broadcast({ type: resuming ? "resume" : "begin" });
    if (touchUi) {
      resetTouchInput();
      try {
        const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
        if (!document.fullscreenElement) {
          const r = el.requestFullscreen?.({ navigationUI: "hide" }) ?? el.webkitRequestFullscreen?.();
          (r as Promise<void> | undefined)?.then?.(() => (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.("landscape").catch(() => {})).catch?.(() => {});
        }
      } catch {
        /* fullscreen not supported (iPhone Safari) */
      }
      return; // touch devices steer with the on-screen controls, no pointer lock
    }
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
  const shopBreak = started && !ended && (multiplayer || !dead) && status.remaining === 0 && fought === status.wave && status.wave < WAVES.length;
  const shopOpen = shopBreak && locked;
  const [offers, setOffers] = useState<PerkId[]>([]);
  const [bought, setBought] = useState<number[]>([]);
  const [shopLeft, setShopLeft] = useState(15);
  const [rerolls, setRerolls] = useState(0);
  const lastOffered = useRef<PerkId[]>([]);
  // reroll price climbs with the wave: +1 +1 +1 +2 +2 +2 +3 ... and doubles
  // for every reroll bought inside the same break
  const rerollBase = (w: number) => {
    let p = 4;
    for (let i = 2; i <= w; i++) p += Math.ceil((i - 1) / 3);
    return p;
  };
  const freeRerolls = statsRef.current.freeRerolls;
  const freeLeft = Math.max(0, freeRerolls - rerolls);
  const rerollCost = freeLeft > 0 ? 0 : rerollBase(status.wave) * Math.pow(2, Math.max(0, rerolls - freeRerolls));
  const drawOffers = () => {
    const avail = PERK_IDS.filter((p) => perkAvailable(p, perksRef.current));
    let pool = avail.filter((p) => !lastOffered.current.includes(p));
    if (pool.length < 3) pool = avail;
    const picks = [...pool].sort(() => Math.random() - 0.5).slice(0, 3);
    lastOffered.current = picks;
    setOffers(picks);
  };
  useEffect(() => {
    if (!shopBreak) return;
    // cards can repeat, just never two rounds in a row; maxed pistol mods drop out
    drawOffers();
    setBought([]);
    setShopLeft(15);
    setRerolls(0);
    // the countdown holds while the game is paused
    const id = setInterval(() => { if (!pausedRef.current) setShopLeft((s) => Math.max(0, s - 1)); }, 1000);
    return () => clearInterval(id);
  }, [shopBreak, status.wave]);
  const rerollRef = useRef<() => void>(() => {});
  rerollRef.current = () => {
    if (!shopOpen) return;
    if (shards < rerollCost) { playSfx("deny"); return; }
    setShards((s) => s - rerollCost);
    setRerolls((r) => r + 1);
    setBought([]);
    drawOffers();

    playSfx("buy");
  };
  const patchRef = useRef<() => void>(() => {});
  patchRef.current = () => {
    if (!shopOpen) return;
    if (shards < PATCH_COST) { playSfx("deny"); return; }
    if (health <= 0 || health >= maxHp) { playSfx("deny"); return; }
    setShards((s) => s - PATCH_COST);
    setHealth((h) => Math.min(maxHp, h + 5));
    playSfx("buy");
  };
  const buyRef = useRef<(i: number) => void>(() => {});
  buyRef.current = (i: number) => {
    const id = offers[i];
    if (!shopOpen || !id || bought.includes(i)) return;
    const cost = perkCost(id, perks[id]);
    if (shards < cost) { playSfx("deny"); return; }
    setShards((s) => s - cost);
    setBought((b) => [...b, i]);
    playSfx("buy");
    if (id === "heal") { setHealth((h) => (h > 0 ? Math.min(maxHp, h + 5) : h)); return; }
    setPerks((p) => ({ ...p, [id]: p[id] + 1 }));
    if (id === "maxhp") setHealth((h) => (h > 0 ? h + 2 : h));
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const i = SHOP_KEYS.indexOf(e.code);
      if (i >= 0) buyRef.current(i);
      else if (e.code === "KeyR") rerollRef.current();
      else if (e.code === "KeyV") patchRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);

  }, []);

  // regen perk
  const regenRate = statsRef.current.regen;
  useEffect(() => {
    if (!regenRate || !started || !locked || ended || dead) return;
    const id = window.setInterval(() => setHealth((h) => (h > 0 ? Math.min(maxHp, h + 1) : h)), 14000 / regenRate);
    return () => window.clearInterval(id);
  }, [regenRate, started, locked, ended, dead, maxHp]);


  // soundtrack: plays on the menu too (muffled, drumless) and opens up in combat
  useEffect(() => { hookAudioUnlock(); }, []);
  const inCombat = started && locked && !ended;
  useEffect(() => {
    setMusicMenu(!inCombat);
    startMusic();
  }, [inCombat]);
  // if the browser blocked sound until now, the next click/keypress starts it
  useEffect(() => {
    const retry = () => { initAudio(); startMusic(); };
    retry();
    window.addEventListener("pointerdown", retry);
    window.addEventListener("keydown", retry);
    document.addEventListener("visibilitychange", retry);
    return () => {
      window.removeEventListener("pointerdown", retry);
      window.removeEventListener("keydown", retry);
      document.removeEventListener("visibilitychange", retry);
    };
  }, []);

  useEffect(() => setMusicIntensity(status.wave === WAVES.length && !status.won), [status.wave, status.won]);
  useEffect(() => setMusicTheme(theme.name), [theme.name]);
  useEffect(() => setVolumes(musicVol, sfxVol), [musicVol, sfxVol]);
  useEffect(() => () => stopMusic(), []);
  phase.current = { started, ended };

  // HUD status lists

  // every purchased card, with what it does and how many times it was bought
  const boughtCards = PERK_IDS.filter((id) => id !== "heal" && perks[id] > 0).map((id) => {
    const info = PERK_INFO[id];
    const lvl = perks[id];
    const mod = PISTOL_MODS.includes(id);
    const effects: { text: string; bad?: boolean }[] = [];
    if (info.pros?.length || info.cons?.length) {
      info.pros?.forEach((t) => effects.push({ text: t }));
      info.cons?.forEach((t) => effects.push({ text: t, bad: true }));
    } else if (info.desc) {
      effects.push({ text: info.desc });
    }
    const total = mod ? null : perkBadge(id, lvl);
    if (total && lvl > 1) effects.push({ text: `Total: ${total}` });
    return { id, name: info.name, color: info.color === "#000" ? "#2b2118" : info.color, lvl, mod, effects };
  });



  return (
    <div ref={wrapRef} className="fixed inset-0 cursor-crosshair touch-none select-none overscroll-none">
      <Canvas shadows dpr={[1, 1.6]} gl={{ powerPreference: "high-performance", antialias: true }} camera={{ position: [0, EYE, 0], fov: 75, near: 0.1, far: alpine ? 1200 : 220 }}>
        <World
          alpine={alpine}
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
              if (perksRef.current.mend > 0 && wave > 1) setHealth((h) => (h > 0 ? Math.min(maxHp, h + 3 * perksRef.current.mend) : h));
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
          waveNum={status.wave}
          players={multiplayer ? peerCount + 1 : 1}
          msgSink={msgSink}
          health={health}
          slots={slots}
          stats={statsRef}
          onShard={(v) => {
            const gain = Math.max(1, Math.round(v * statsRef.current.greed * (multiplayer ? (1 + 0.5 * peerCount) * 0.8 : 1)));
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
          onMutator={setMutId}
          endless={endlessRef}



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

      <div className={`pointer-events-none fixed inset-0 font-mono ${touchUi ? "z-[25]" : "z-10"}`}>
        <div className="flex items-start justify-between p-5 text-[#2b2118]">
          <div className={`flex flex-col items-start gap-2 ${touchUi ? "mt-10 text-xs" : ""}`}>
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
          <div className={`flex flex-col items-end gap-2`}>
            <div className="rounded-md bg-[#f3e6cf]/80 px-3 py-1.5 text-sm tracking-widest">
              {"♦".repeat(Math.max(0, health))}
              <span className="opacity-30">{"♦".repeat(Math.max(0, maxHp - health))}</span>
            </div>
            <div className="rounded-md bg-[#f3e6cf]/80 px-3 py-1.5 text-sm tracking-widest">
              <span className="text-[#1aa6b8]">◆</span> {shards}
            </div>
            {alpineMap && locked && (
              <Minimap base={alpineMap.base} half={alpineMap.half} enemies={enemies} remotes={remotes} myColor={colorFor(myNum)} compact={touchUi} />
            )}
        {multiplayer && locked && !ended && (
          <div className={`space-y-1 text-right font-mono tracking-widest text-[#2b2118] ${touchUi ? "text-[10px]" : "text-xs"}`}>
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
        </div>

        <div className={`absolute left-1/2 flex -translate-x-1/2 flex-wrap justify-center ${touchUi ? "top-3 max-w-[calc(100vw-9rem)] gap-1.5" : "top-5 max-w-[calc(100vw-26rem)] gap-2"}`}>
          {inv.map((slot, i) => {
            const g = GUNS[slot.w];
            const active = slot.w === weapon;
            return (
              <div
                key={slot.w}
                onPointerDown={touchUi ? () => { touchInput.pick = slot.w; } : undefined}
                className={`relative rounded-md border tracking-widest ${touchUi ? "pointer-events-auto px-1.5 py-0.5 text-[9px]" : "px-3 py-1.5 text-xs"} ${
                  active
                    ? "border-[#2b2118] bg-[#f3e6cf] text-[#2b2118]"
                    : "border-transparent bg-[#f3e6cf]/55 text-[#2b2118]/70"
                }`}
              >
                <span
                  className={`absolute -left-1 -top-1 flex items-center justify-center rounded-full bg-[#2b2118] font-bold text-[#f7eeda] ${touchUi ? "h-3 w-3 text-[7px]" : "h-4 w-4 text-[10px]"}`}
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
        {locked && !ended && !touchUi && (
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
        {/* overtime condition for this round */}
        {(() => {
          const mu = mutatorById(mutId);
          if (!mu || !locked || ended) return null;
          return (
            <div
              className="absolute left-1/2 top-[13%] -translate-x-1/2 rounded-md border px-4 py-1 text-center text-[10px] font-bold tracking-[0.25em]"
              style={{ color: mu.color, borderColor: `${mu.color}80`, background: "#2b211899" }}
            >
              {mu.name} · {mu.desc}
            </div>
          );
        })()}
        {locked && !ended && (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <div className="h-5 w-[2px] bg-[#2b2118]/70" />
            <div className="absolute left-1/2 top-1/2 h-[2px] w-5 -translate-x-1/2 -translate-y-1/2 bg-[#2b2118]/70" />
          </div>
        )}
      </div>

      {shopOpen && (
        <div className={`pointer-events-none fixed inset-x-0 z-30 font-mono text-[#2b2118] ${touchUi ? "bottom-2 pl-4 pr-48" : "bottom-6"}`}>
          <div className="mb-2 text-center text-xs tracking-[0.3em] text-[#f3e6cf] [text-shadow:0_1px_2px_#2b2118]">
            SHOP · NEXT WAVE IN {shopLeft}s · {shards} SHARDS
          </div>
          <div className="mb-2 flex flex-wrap justify-center gap-2 px-3">
            <button
              onClick={() => patchRef.current()}
              className="pointer-events-auto flex items-center gap-2 rounded-md border border-[#000] bg-[#f3e6cf]/95 px-2.5 py-1 text-[11px] text-[#000] active:bg-[#e8c98f]"
            >
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#2b2118] text-[9px] font-bold text-[#f7eeda]">V</span>
              <span className="font-bold tracking-widest">FIELD DRESSING</span>
              <span className="opacity-60">+5 HP · {health}/{maxHp}</span>
              <span className="font-bold">◆ {PATCH_COST}</span>
            </button>
            <button
              onClick={() => rerollRef.current()}
              className="pointer-events-auto flex items-center gap-2 rounded-md border border-[#000] bg-[#f3e6cf]/95 px-2.5 py-1 text-[11px] text-[#000] active:bg-[#e8c98f]"
            >
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#2b2118] text-[9px] font-bold text-[#f7eeda]">R</span>
              <span className="font-bold tracking-widest">REROLL</span>
              <span className="opacity-60">
                {freeLeft > 0 ? `${freeLeft} FREE LEFT` : rerolls > 0 ? `USED ${rerolls}x` : "DOUBLES EACH USE"}
              </span>
              <span className="font-bold">{rerollCost === 0 ? "FREE" : `◆ ${rerollCost}`}</span>
            </button>
          </div>
          <div className="flex flex-wrap justify-center gap-2 px-3 sm:gap-3">


            {offers.map((id, i) => {
              const info = PERK_INFO[id];
              const cost = perkCost(id, perks[id]);
              if (bought.includes(i)) return null;
              const isMod = PISTOL_MODS.includes(id);
              return (
                <button
                  key={i}
                  onClick={() => buyRef.current(i)}
                  className={`pointer-events-auto relative rounded-lg border-2 border-[#000] bg-[#f3e6cf]/95 text-center text-[#000] active:bg-[#e8c98f] ${touchUi ? "w-32 p-2" : "w-36 p-3 sm:w-44"}`}
                  
                >
                  <span className="absolute -left-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-[#2b2118] text-xs font-bold text-[#f7eeda]">
                    {SHOP_KEYS[i]!.slice(3)}
                  </span>
                  {isMod && <PistolBadge />}
                  <div className="text-xs font-bold tracking-widest">{info.name}</div>
                  {info.pros ? (
                    <div className="mt-1 space-y-0.5 text-[11px] leading-snug">
                      {info.pros.map((t) => (
                        <div key={t} className="font-bold text-[#1d7a37]">▲ {t}</div>
                      ))}
                      {info.cons?.map((t) => (
                        <div key={t} className="font-bold text-[#b3261e]">▼ {t}</div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-1 text-[11px] leading-snug opacity-80">{info.desc}</div>
                  )}
                  {id !== "heal" && <div className="mt-1 text-[10px] opacity-50">LEVEL {perks[id]}</div>}
                  <div className="mt-2 text-sm font-bold">◆ {cost}</div>
                </button>

              );
            })}
          </div>


        </div>
      )}

      {touchUi && locked && !ended && (
        <MobileControls
          onPause={() => {
            setLocked(false);
            if (phase.current.started && !phase.current.ended) netHolder.current?.broadcast({ type: "pause" });
          }}
          abilityName={ABILITIES[ability].name}
          abilityLeft={abilCd.left}
        />
      )}
      {touchUi && locked && !ended && (
        <button
          aria-label="Pause"
          onPointerDown={(e) => {
            e.preventDefault();
            setLocked(false);
            if (phase.current.started && !phase.current.ended) netHolder.current?.broadcast({ type: "pause" });
          }}
          style={{ left: "max(0.75rem, env(safe-area-inset-left))", top: "max(0.75rem, env(safe-area-inset-top))" }}
          className="fixed z-40 flex h-10 w-10 touch-none items-center justify-center rounded-full border-2 border-[#f3e6cf]/80 bg-[#2b2118]/60 text-[#f3e6cf] shadow-lg backdrop-blur-sm active:scale-95 active:bg-[#2b2118]"
        >
          <svg width="14" height="16" viewBox="0 0 14 16" aria-hidden="true">
            <rect x="1" y="1" width="4" height="14" rx="1.6" fill="currentColor" />
            <rect x="9" y="1" width="4" height="14" rx="1.6" fill="currentColor" />
          </svg>
        </button>

      )}
      {touchUi && portrait && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2b2118] p-8 text-center font-mono text-[#f3e6cf]">
          <div>
            <div className="text-2xl font-bold tracking-[0.2em]">ROTATE YOUR DEVICE</div>
            <div className="mt-2 text-xs tracking-[0.25em] opacity-60">SCRAPFALL PLAYS IN LANDSCAPE</div>
          </div>
        </div>
      )}
      {healMsg > 0 && locked && !ended && (
        <div className="pointer-events-none fixed left-1/2 top-1/3 z-10 -translate-x-1/2 rounded-md bg-[#f3e6cf]/85 px-4 py-1.5 font-mono text-sm tracking-widest text-[#b3261e]">
          +3 HEALTH
        </div>
      )}
      {multiplayer && dead && deathMsg && !ended && locked && (
        <div className="pointer-events-none fixed left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-lg bg-[#2b2118]/85 px-8 py-5 text-center font-mono text-[#f3e6cf]">
          <div className="text-2xl font-bold tracking-[0.3em] text-[#e8322a]">YOU DIED</div>
          <div className="mt-2 text-xs tracking-[0.25em] opacity-80">SPECTATING · YOU RESPAWN NEXT WAVE</div>
          <div className="mt-1 text-[11px] tracking-[0.2em] opacity-50">WALK AROUND FREELY · P TO PAUSE</div>
        </div>
      )}


      {(!locked || ended) && picking && (
        <div className={`fixed inset-0 z-30 flex items-center justify-center bg-[#2b2118]/80 ${touchUi ? "p-2" : "p-6"}`}>
          <div className={`max-h-[96dvh] w-full touch-auto overflow-y-auto overscroll-contain rounded-xl bg-[#f3e6cf] text-center ${touchUi ? "loadout-compact max-w-2xl p-3" : "max-w-md p-7"} font-mono text-[#2b2118] shadow-2xl`}>
            <h1 className="text-2xl font-bold tracking-tight">Choose your loadout</h1>
            <p className="mt-1 text-[10px] tracking-[0.25em] opacity-50">CLASS · ABILITY</p>

            <div className="mt-4 grid grid-cols-5 gap-1">
              {CLASS_IDS.map((id) => (
                <button
                  key={id}
                  onClick={() => setCls(id)}
                  className={`pointer-events-auto rounded px-1 py-1.5 text-[10px] font-bold tracking-wider ${
                    cls === id ? "text-[#f7eeda]" : "bg-[#2b2118]/10"
                  }`}
                  style={cls === id ? { background: CLASSES[id].color } : undefined}
                >
                  {CLASSES[id].name}
                </button>
              ))}
            </div>
            <div className="mt-2 text-[11px] leading-snug opacity-70">{CLASSES[cls].role}</div>
            <div className="mt-1 flex flex-wrap justify-center gap-x-3 text-[10px] font-bold">
              {CLASSES[cls].pros.map((t) => (
                <span key={t} className="text-[#1d7a37]">▲ {t}</span>
              ))}
              {CLASSES[cls].cons.map((t) => (
                <span key={t} className="text-[#b3261e]">▼ {t}</span>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-1">
              {ABILITY_IDS.map((id) => (
                <button
                  key={id}
                  onClick={() => setAbility(id)}
                  className={`pointer-events-auto rounded px-2 py-1.5 text-[11px] font-bold tracking-wider ${
                    ability === id ? "bg-[#2b2118] text-[#f7eeda]" : "bg-[#2b2118]/10"
                  }`}
                >
                  {ABILITIES[id].name}
                </button>
              ))}
            </div>
            <div className="mt-2 text-[11px] leading-snug opacity-70">{ABILITIES[ability].desc}</div>

            {multiplayer && (
              <div className="mt-5 text-left">
                <div className="text-[9px] tracking-[0.25em] opacity-50">SQUAD</div>
                <div className="mt-2 space-y-1 text-[11px] tracking-wider">
                  {connected.map((p) => (
                    <div key={p.id} className="flex items-center gap-2">
                      <span style={{ color: colorFor(p.num), WebkitTextStroke: "0.5px #2b2118" }}>■</span>
                      <span>{p.num === 1 ? "HOST" : `PLAYER ${p.num}`}</span>
                      <span className="font-bold" style={{ color: clsPicks[p.num] ? CLASSES[clsPicks[p.num]!].color : undefined }}>
                        {clsPicks[p.num] ? CLASSES[clsPicks[p.num]!].name : "—"}
                      </span>
                      <span className="opacity-60">
                        {picks[p.num] ? ABILITIES[picks[p.num]!].name : "CHOOSING…"}
                      </span>
                      {p.num === myNum && <span className="opacity-40">(YOU)</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}


            {multiplayer && !isHost ? (
              <div className="mt-6 rounded-md bg-[#2b2118]/10 px-6 py-2 text-xs tracking-widest opacity-70">
                WAITING FOR THE HOST TO START
              </div>
            ) : (
              <button
                onClick={() => start()}
                className="pointer-events-auto mt-6 rounded-md bg-[#b4653f] px-6 py-3 text-sm font-semibold tracking-widest text-[#f7eeda] transition-transform active:scale-95 [@media(hover:hover)]:hover:scale-105"
              >
                ENTER ARENA
              </button>
            )}
            <div>
              <button
                onClick={() => setPicking(false)}
                className="pointer-events-auto mt-3 text-xs tracking-widest underline opacity-60 hover:opacity-100"
              >
                BACK
              </button>
            </div>
          </div>
        </div>
      )}

      {(!locked || ended) && !picking && (
        <div className="fixed inset-0 z-40 flex touch-auto items-start justify-center overflow-y-auto overscroll-contain bg-[#2b2118]/70 p-6 sm:items-center">
          <div className="my-auto w-full max-w-sm touch-auto rounded-xl bg-[#f3e6cf] p-7 text-center font-mono text-[#2b2118] shadow-2xl">


            {!started && !ended && !paused && (
              <div className="mb-2 text-[10px] tracking-[0.45em] opacity-50">SCRAPFALL</div>
            )}
            <h1 className="text-2xl font-bold tracking-tight">
              {gameOver ? "You got swarmed" : status.won ? "Arena cleared!" : paused ? "Paused" : theme.name}
            </h1>
            {(gameOver || status.won || paused) && (
              <p className="mt-2 text-sm opacity-70">
                {gameOver
                  ? `You fell on wave ${status.wave} with ${score} kills.`
                  : status.won
                    ? `All ${WAVES.length} waves survived · ${score} kills.`
                    : `Wave ${status.wave} · ${score} kills so far.`}
              </p>
            )}
            {!paused && (
              <p className="mt-4 text-xs leading-relaxed opacity-60">
                {touchUi
                  ? "Left thumb: drag to move · right thumb: drag to aim · hold FIRE to shoot · ABILITY button · tap a gun to swap · pause button up top"
                  : "WASD to move · mouse or arrow keys to look · click or Enter to shoot · Space to jump · Shift to run · F for your ability · 1-0 / Q E swap guns · P to pause"}
              </p>
            )}
            {/* beat the boss: bank the win, or push the run into overtime */}
            {status.won && !gameOver && isHost && (
              <button
                onClick={() => {
                  initAudio();
                  endlessRef.current = true;
                  goingOvertime.current = true;
                  setStatus((s) => ({ ...s, won: false }));
                  net?.broadcast({ type: "ot" });
                  start();
                }}
                className="pointer-events-auto mt-6 w-full rounded-md border-2 border-[#2b2118] px-6 py-3 text-sm font-semibold tracking-widest text-[#2b2118] transition-transform active:scale-95 [@media(hover:hover)]:hover:scale-105"
              >
                OVERTIME // KEEP GOING
              </button>
            )}
            {multiplayer && !isHost && (ended || !started) ? (
              <div className="mt-6">
                <div className="rounded-md bg-[#2b2118]/10 px-6 py-2 text-xs tracking-widest opacity-70">
                  {ended ? "WAITING FOR THE HOST TO START A NEW ARENA" : "WAITING FOR THE HOST TO START"}
                </div>
                <button
                  onClick={() => { initAudio(); setPicking(true); }}
                  className="pointer-events-auto mt-3 rounded-md bg-[#b4653f] px-6 py-3 text-sm font-semibold tracking-widest text-[#f7eeda] transition-transform active:scale-95 [@media(hover:hover)]:hover:scale-105"
                >
                  CHOOSE LOADOUT
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  if (started && !ended) { start(); return; } // resume straight back in
                  initAudio();
                  setPicking(true);
                }}
                className="pointer-events-auto mt-6 rounded-md bg-[#b4653f] px-6 py-3 text-sm font-semibold tracking-widest text-[#f7eeda] transition-transform active:scale-95 [@media(hover:hover)]:hover:scale-105"
              >
                {ended ? "NEW ARENA" : started ? "RESUME" : "START"}
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
                    <div>WAVES SURVIVED · {status.won && !endlessRef.current ? WAVES.length : Math.max(0, status.wave - 1)}</div>
                    <div>BEST EVER · WAVE {highWave}</div>
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


            {paused && (
              <div className="w-full max-w-sm px-4">
                <StatSheet d={statsRef.current} cls={cls} />
                {boughtCards.length > 0 && (
                  <div className="mt-3 text-left">
                    <div className="text-[9px] tracking-[0.25em] text-black/50">UPGRADES BOUGHT</div>
                    <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                      {boughtCards.map((c) => (
                        <div
                          key={c.id}
                          className="relative rounded-md border p-1.5"
                          style={{ borderColor: `${c.color}80`, background: `${c.color}14` }}
                        >
                          {c.mod && <PistolBadge />}
                          <div className="pr-4 text-[9px] font-bold tracking-wider text-black">{c.name}</div>
                          <div className="mt-0.5 space-y-0.5 text-[9px] leading-tight">
                            {c.effects.map((e, i) => (
                              <div key={i} className={e.bad ? "text-[#b3261e]" : "text-black/70"}>
                                {e.text}
                              </div>
                            ))}
                          </div>
                          <div className="mt-1 text-[9px] font-bold tracking-widest text-black/60">{c.lvl}x</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}



            {paused || (multiplayer && ended) ? (
              <div className="mt-3">
                <button
                  onClick={leaveGame}
                  className="pointer-events-auto rounded-md bg-[#2b2118] px-6 py-3 text-sm font-semibold tracking-widest text-[#f7eeda] transition-transform active:scale-95 [@media(hover:hover)]:hover:scale-105"
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
                          <span className="opacity-50">· {picks[p.num] ? ABILITIES[picks[p.num]!].name : "CHOOSING…"}</span>
                          {p.num === myNum && <span className="opacity-50">(YOU)</span>}
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 text-left">
                      <div className="opacity-60">MAP</div>
                      {net.role === "host" ? (
                        <div className="mt-1 grid grid-cols-2 gap-1">
                          {([["arenas", "RANDOM ARENA"], ...(Object.keys(BIG_MAPS) as BigMapId[]).map((k) => [k, BIG_MAPS[k].name] as const)] as const).map(([id, label]) => {
                            const on = id === "arenas" ? !bigIdOf(seed) : bigIdOf(seed) === id;
                            return (
                              <button
                                key={id}
                                onClick={() => {
                                  coopMapRef.current = id;
                                  const s2 = id === "arenas" ? Math.floor(Math.random() * 1e9) : bigSeed(id);
                                  setSeed(s2);
                                  net.broadcast({ type: "seed", seed: s2 });
                                }}
                                className={`pointer-events-auto flex-1 rounded-md border border-[#2b2118]/40 px-2 py-1.5 text-[11px] font-semibold tracking-wider ${on ? "bg-[#2b2118] text-[#f7eeda]" : "bg-transparent"}`}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="mt-1 font-semibold">{bigIdOf(seed) ? BIG_MAPS[bigIdOf(seed)!].name : "RANDOM ARENA"}</div>
                      )}
                      {bigIdOf(seed) && <div className="mt-1 text-[11px] opacity-60">Big co-op map · radar on</div>}
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
                  onClick={() => setShowSettings(true)}
                  className="pointer-events-auto mt-3 text-xs tracking-widest underline opacity-70 hover:opacity-100"
                >
                  SETTINGS
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
              <div className="pointer-events-auto fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-black/75 p-4 font-mono text-[#f2ead6] sm:items-center">
                <div className="w-full max-w-md rounded-lg border border-[#b4653f] bg-[#2b2118] p-5">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold tracking-[0.3em]">SETTINGS</h2>
                    <button
                      onClick={() => setShowSettings(false)}
                      className="rounded px-3 py-1 text-xs tracking-widest opacity-70 hover:bg-white/10 hover:opacity-100"
                    >
                      CLOSE
                    </button>
                  </div>
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
                  <button
                    onClick={() => setShowSettings(false)}
                    className="pointer-events-auto mt-5 w-full rounded bg-[#b4653f] py-3 text-sm font-bold tracking-widest active:scale-95"
                  >
                    DONE
                  </button>
                  <div className="mt-4 border-t border-white/10 pt-3 text-center text-[10px] tracking-[0.3em] opacity-50">
                    SCRAPFALL · v1.0.4
                  </div>
                </div>
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
  revolver: "Heavy six-shooter. Slow, but each round hits for 4 and punches through one enemy.",
  minigun: "Spins up a huge wall of lead. 220 rounds, sprays wide.",
  crossbow: "Silent bolts that pierce 2 enemies and briefly slow them.",
  plasma: "Fans out 3 pink plasma bolts that bounce off a wall once.",
  voidorb: "A slow drifting orb that passes through enemies and arcs lightning to 4 more.",
  shatter: "Frozen shell that bursts into 5 icy shards, slowing everything it hits.",
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

/** tiny pistol silhouette shown on pistol-mod shop cards */
function PistolBadge() {
  return (
    <svg viewBox="0 0 24 16" className="absolute right-1.5 top-1.5 h-4 w-6 opacity-70" aria-hidden>
      <path
        d="M2 3h16v4h-4l-1 2H9l-1.5 5H4l1.5-5H2z"
        fill="#2b2118"
      />
      <rect x="13" y="6.5" width="8" height="1.6" fill="#2b2118" />
    </svg>
  );
}

type StatRow = { label: string; value: string; tone: -1 | 0 | 1 };

/** Brotato-style stat sheet: green above baseline, red below */
export function StatSheet({ d, cls }: { d: Derived; cls: ClassId }) {
  const [tab, setTab] = useState<"combat" | "survival">("combat");
  const [showCls, setShowCls] = useState(false);
  const pct = (v: number, base = 1): StatRow["tone"] => (v > base + 1e-6 ? 1 : v < base - 1e-6 ? -1 : 0);
  const combat: StatRow[] = [
    { label: "Firepower", value: `${Math.round(d.dmg * 100)}%`, tone: pct(d.dmg) },
    { label: "Cycle Rate", value: `${Math.round(d.rate * 100)}%`, tone: pct(d.rate) },
    { label: "Crit Protocol", value: `${Math.round(d.crit * 100)}%`, tone: pct(d.crit, 0) },
    { label: "Piercing", value: `${d.pierce}`, tone: pct(d.pierce, 0) },
    { label: "Ricochet", value: `${Math.round(d.ricochet * 100)}%`, tone: pct(d.ricochet, 0) },
    { label: "Combustion", value: `${Math.round(d.boom * 100)}%`, tone: pct(d.boom, 0) },
    { label: "Impact Force", value: `${Math.round(d.knock * 100)}%`, tone: pct(d.knock, 0) },
    { label: "Ammo Capacity", value: `${Math.round(d.ammoMul * 100)}%`, tone: pct(d.ammoMul) },
  ];
  const survival: StatRow[] = [
    { label: "Hull Integrity", value: `${d.maxHp}`, tone: pct(d.maxHp, 10) },
    { label: "Armor Plating", value: `${Math.round(d.armor * 100)}%`, tone: pct(d.armor, 0) },
    { label: "Phase Shift", value: `${Math.round(d.dodge * 100)}%`, tone: pct(d.dodge, 0) },
    { label: "Life Siphon", value: `${Math.round(d.steal * 100)}%`, tone: pct(d.steal, 0) },
    { label: "Nano-Regen", value: d.regen ? `x${d.regen}` : "0", tone: d.regen ? 1 : 0 },
    { label: "Shock Thorns", value: `${Math.round(d.thorns * 100)}%`, tone: pct(d.thorns, 0) },
    { label: "Thruster Speed", value: `${Math.round(d.speed * 100)}%`, tone: pct(d.speed) },
    { label: "Flux Magnet", value: `${d.magnet.toFixed(1)}m`, tone: pct(d.magnet, 2) },
    { label: "Salvage Yield", value: `${Math.round(d.greed * 100)}%`, tone: pct(d.greed) },
    { label: "Recharge Haste", value: `${Math.round(d.haste * 100)}%`, tone: pct(d.haste, 0) },
    { label: "Free Rerolls", value: `${d.freeRerolls}`, tone: pct(d.freeRerolls, 0) },
  ];
  const rows = tab === "combat" ? combat : survival;
  return (
    <div className="mt-5 w-full rounded-lg bg-[#2b2118] p-3 text-left font-mono text-[#f3e6cf]">
      <div className="flex items-center justify-between">
        <div className="text-[9px] tracking-[0.25em] opacity-60">STATS</div>
        <div className="relative">
          <button
            onMouseEnter={() => setShowCls(true)}
            onMouseLeave={() => setShowCls(false)}
            onClick={() => setShowCls((v) => !v)}
            className="pointer-events-auto text-[9px] tracking-[0.2em] underline decoration-dotted underline-offset-2"
            style={{ color: CLASSES[cls].color }}
          >
            {CLASSES[cls].name}
          </button>
          {showCls && (
            <div className="absolute right-0 top-full z-20 mt-1 w-52 rounded-md border border-[#f3e6cf]/20 bg-[#1d160f] p-2 text-left shadow-lg">
              <div className="text-[9px] tracking-[0.2em]" style={{ color: CLASSES[cls].color }}>
                {CLASSES[cls].name}
              </div>
              <div className="mt-0.5 text-[9px] opacity-60">{CLASSES[cls].role}</div>
              <div className="mt-1.5 text-[9px] tracking-[0.2em] opacity-50">STARTING STATS</div>
              <div className="mt-1 space-y-0.5 text-[10px]">
                {CLASSES[cls].pros.map((p) => (
                  <div key={p} className="text-[#7cff4f]">{p}</div>
                ))}
                {CLASSES[cls].cons.map((c) => (
                  <div key={c} className="text-[#ff6b5e]">{c}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="mt-2 flex gap-1">
        {(["combat", "survival"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`pointer-events-auto flex-1 rounded px-2 py-1 text-[10px] font-bold tracking-widest ${
              tab === t ? "bg-[#f3e6cf] text-[#2b2118]" : "bg-[#f3e6cf]/10 text-[#f3e6cf]/70"
            }`}
          >
            {t === "combat" ? "COMBAT" : "SURVIVAL"}
          </button>
        ))}
      </div>
      <div className="mt-2 space-y-0.5 text-[11px]">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between">
            <span className={r.tone === 1 ? "text-[#7cff4f]" : r.tone === -1 ? "text-[#ff6b5e]" : "text-[#f3e6cf]/75"}>
              {r.label}
            </span>
            <span className={`font-bold ${r.tone === 1 ? "text-[#7cff4f]" : r.tone === -1 ? "text-[#ff6b5e]" : ""}`}>
              {r.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
