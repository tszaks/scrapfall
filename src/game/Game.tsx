import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import {
  ARENA, HALF, BLOCK, blocked, generateLevel, randomSpawn, pushOut, type Block,
  solidGrid, flowField, navTarget, fineField, fineStep, toCell, type FineField, nextWaypoint, clearLine, toNav, spawnNear,
  closeRaised, setArenaSize, SOLO_ARENA, COOP_ARENA, CITY_COOP, PLAY_HALF,
  BEACH_SIZE, setPosts,
} from "./level";

import { THEMES, layoutOf, offered, type Theme } from "./themes";
import { isBeach } from "./beach/beachLayout";
import { mapPosts, movePropsFromDoors } from "./posts";
import { BeachWorld } from "./beach/Beach";
import type { CityLayout } from "./cityLayout";
import { CityScene, CitySun } from "./City";
import { CityTraffic } from "./Traffic";
import { CURB } from "./cityLayout";
import { CityBlockades } from "./cityBlockades";
import { findGaps, sealGaps, soloHalf, walkableFromBlocks, type Gap } from "./soloBounds";
import type { WesternLayout } from "./western/layout";
import { WesternScene, WesternSun } from "./western/Western";
import { WesternTrain } from "./western/Train";
import { WesternWeather } from "./western/Weather";
import { WesternBlockades } from "./western/Blockades";
import { bossSpot as trainBossSpot, callBossTrain, trainClock } from "./western/trainSim";
import { DesperadoModel, IronMarshalParts } from "./western/enemies";
import { desperadoDir, desperadoTick, marshalTick } from "./western/enemyAI";
import { westernMinimap } from "./western/minimap";
import { Minimap, type MapFeed } from "./Minimap";
import { alpineMinimap, cityMinimap } from "./cityMinimap";
import { hitsTraffic, liveCars, type TrafficLink } from "./trafficCore";
import { ARENA_SUN, worldLook, type TimeOfDay } from "./lighting";
import { arenaSunsetSky } from "./sky";
import { NightStars, SkyDome, TimeDriver, TimeLights } from "./TimeScene";
import { beginMatchTime, cycleTimeMode, initialMode, pinTime, resetMatchTime, setTimeMode, setWaveClock, tod, toggleTimeLock, useTodMode, useTodNearest, waveStage } from "./timeOfDay";
import { climbable, ghostOK, raised, strictNav, groundHits, groundOwnsHits, groundSpeed, groundY, setTerrain, shotHits, wind, worldFx } from "./terrain";
import { beachTerrain } from "./beach/terrain";
import { AlpineScene, AlpineSun } from "./alpine/Alpine";
import { PloughBody, SkierModel } from "./alpine/enemies";
import { alpine, decodeAlpine, encodeAlpine, resetAlpine } from "./alpine/weather";
import { decodeWeather, encodeWeather } from "./cityWeather";
import { ALPINE_SIZE, alpineZone, type AlpineLayout } from "./alpine/layout";
import { leaveRide, resetRide, ride, riderEye, stepRide } from "./alpine/ride";
import { cityAccess } from "./access/cityAccess";
import { beachAccess } from "./access/beachAccess";
import { alpineAccessFull } from "./access/alpineAccess";
import { westernMarkers } from "./access/westernMarkers";
import { AccessScene } from "./access/AccessScene";
import {
  accessActive, accessList, accessMarkers, azBuilding, bulletBlocked, debugState as accessDebug, decodeCars, doorstep,
  encodeCars, installAccess, patchNav, player as accPlayer, playerAz, playerBlocked, playerZoneKey,
  pressCarButton, roofCount, roofSpot, stepCars, stepDoors, stepPlayer, zoneAt, zoneKeyOfAz, ROOF_KEY,
} from "./access/world";
import { Stars } from "@react-three/drei";
import { ENEMY_FIELDS, packEnemy, unpackEnemy } from "./enemySync";
import { ENEMY_INFO, FLYERS, HEAVY_NEW, NEW_KINDS, NEW_STATS, hitBand, isNewKind, packVis, type NewKind } from "./enemyKinds";
import {
  MAX_ORD, MELEE_DY, blast, damageMul, drainShield, newOrd, packOrds, rocketAt, shieldBlocks, stepNewKind, stepOrds, unpackOrds,
  type AICtx, type Ord,
} from "./enemyAI";
import { NewEnemyModel, OrdnancePool } from "./EnemyModels";
import { RemoteDeployables, type RemoteDeps } from "./RemoteDeployables";
import { useKeyboard } from "./useKeyboard";
import { touchInput, resetTouchInput, isTouchDevice } from "./touch";
import { MobileControls } from "./MobileControls";
import { RemotePlayers } from "./Remote";
import { colorFor, hostRoom, joinRoom, type NetHandle, type NetMsg, type RemoteState } from "./net";
import { Shards } from "./Shards";
import { CombatFx } from "./CombatFx";
import { visOf, aimDir, fxBounce, fxBurst, fxChain, fxDie, fxEnv, fxFired, fxFrame, fxGuns, fxHit, fxKick, fxNetStats, fxRemoteFire, fxReset, fxShot, fxStyle, rng } from "./projectiles";
import { BOOMER_R, FLAK_R, FX, VF, VK, type VisKind } from "./impacts";
import { hookAudioUnlock, initAudio, playGun, playSfx, setMusicIntensity, setMusicMenu, setMusicProgress, setMusicTheme, setVolumes, startMusic, stopMusic } from "./audio";
import { setAmbienceActive, setAmbienceHazard, setAmbienceScene, setAmbienceTime } from "./ambience";
import { AmbienceListener } from "./AmbienceListener";
import { ABILITIES, ABILITY_IDS, type AbilityId } from "./abilities";
import { MapEvents } from "./events/EventsLayer";
import { forceMapEvent, mapEvent, onMapEventMsg } from "./events/mapEvents";
import { power } from "./events/power";
import { HudOverlay, SquadDriver } from "./Squad";
import { handleSquadMsg, resetSquad, showToast } from "./squadState";
import { pings, type PingWorld } from "./ping";
import { DOWN, REVIVE_HP, REVIVE_RANGE, me as squadMe, reviveInterrupted, squad, squad as downTable } from "./revive";
import { NO_PERKS, PERK_IDS, PERK_INFO, MOD_SLOTS, PISTOL_MODS, derive, modsEquipped, perkAvailable, perkBadge, perkCost, type Derived, type PerkId, type Perks } from "./perks";
import { CLASSES, CLASS_IDS, type ClassId } from "./classes";



type Kind = "drifter" | "brute" | "shooter" | "runner" | "boss" | "specter" | "bomber" | "vanguard" | "special" | NewKind;
type Weapon =
  | "pistol" | "scatter" | "smg" | "rail" | "cannon"
  | "rebound" | "harpoon" | "cryo" | "flak" | "tesla"
  | "revolver" | "minigun" | "crossbow" | "plasma" | "voidorb" | "shatter";
type Gun = {
  name: string; wave: number; cooldown: number; count: number; spread: number;
  speed: number; life: number; damage: number; size: number; color: string; body: string; ammo: number;
  bounce?: number; pierce?: number; slow?: number; cluster?: number; chain?: number;
  /** splash radius (m): the round explodes on impact with anything, or at max range */
  blast?: number;
  /** splash damage as a share of the round's damage (full at the centre, 35% at the edge) */
  blastMul?: number;
};
const GUNS: Record<Weapon, Gun> = {
  pistol: { name: "PISTOL", wave: 0, cooldown: 0.28, count: 1, spread: 0, speed: 22, life: 2, damage: 1, size: 0.14, color: "#ff8a1f", body: "#3a2f26", ammo: 140 },
  scatter: { name: "SCATTER", wave: 3, cooldown: 0.7, count: 5, spread: 0.07, speed: 22, life: 0.8, damage: 1, size: 0.12, color: "#ffd23f", body: "#6b4a2c", ammo: 16 },
  smg: { name: "BUZZER", wave: 5, cooldown: 0.08, count: 1, spread: 0.03, speed: 26, life: 1.4, damage: 1, size: 0.09, color: "#4fe3ff", body: "#2c4a5c", ammo: 120 },
  rail: { name: "LANCE", wave: 7, cooldown: 0.9, count: 1, spread: 0, speed: 48, life: 1.5, damage: 5, size: 0.1, color: "#e04bff", body: "#e8e2d4", ammo: 10 },
  cannon: { name: "BOOMER", wave: 9, cooldown: 1.1, count: 1, spread: 0, speed: 13, life: 3, damage: 8, size: 0.38, color: "#ff3b2a", body: "#1e1e1e", ammo: 6, blast: BOOMER_R, blastMul: 1 },
  rebound: { name: "REBOUNDER", wave: 4, cooldown: 0.5, count: 1, spread: 0, speed: 20, life: 3, damage: 2, size: 0.17, color: "#7cff4f", body: "#2f4a22", ammo: 20, bounce: 3 },
  harpoon: { name: "HARPOON", wave: 6, cooldown: 0.8, count: 1, spread: 0, speed: 40, life: 2, damage: 3, size: 0.1, color: "#f2ead6", body: "#4a4238", ammo: 12, pierce: 3 },
  cryo: { name: "GLACIER", wave: 4, cooldown: 0.25, count: 1, spread: 0.02, speed: 28, life: 1.5, damage: 1, size: 0.12, color: "#9fe8ff", body: "#2a5f6e", ammo: 30, slow: 2.5 },
  flak: { name: "FLAK", wave: 8, cooldown: 1, count: 1, spread: 0, speed: 16, life: 2, damage: 3, size: 0.3, color: "#ff9d3b", body: "#3c3a2a", ammo: 8, cluster: 4, blast: FLAK_R, blastMul: 0.5 },
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
// wire order for co-op snapshots: only ever append (index 9 on are the newer types)
const KINDS: Kind[] = ["drifter", "brute", "shooter", "runner", "boss", "specter", "bomber", "vanguard", "special", ...NEW_KINDS];
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
  slow: number; // slowed timer
  frozen?: number; // cryo nova: fully frozen timer (host sim)
  iceUntil?: number; // cryo nova: performance.now() until which the ice shell shows (the caster's client)
  burn: number; // burning timer from incendiary rounds
  burnTick: number;
  max?: number; // spawn health, for the executioner hammer
  shredUntil?: number; // shredder rounds: takes extra damage until this time
  aux?: number; // special-enemy state (leap / beam timer)
  yaw?: number; // facing, decided by the host (toward its target) and synced to guests
  elite?: number; // 1 = event champion (gold, tougher, big shard payout)
  // newer enemy types (enemyAI.ts): AI state, telegraph state synced to guests, shield
  vis?: number;
  st?: number;
  t1?: number;
  ax?: number | undefined;
  az?: number | undefined;
  side?: number | undefined;
  plan?: number;
  shots?: number;
  stuck?: number;
  gd0?: number;
  detour?: number;
  shield?: number;
  shieldMax?: number;
  shieldT?: number;
  blockT?: number;
  hitT?: number;
  tgt?: number;
  /** who set it on fire (co-op kill credit for burn kills; null = host) */
  burnFrom?: string | null;
};
type Bullet = {
  pos: THREE.Vector3; vel: THREE.Vector3; life: number; active: boolean; damage: number; color: string; size: number;
  bounce: number; pierce: number; slow: number; cluster: number; chain: number; burn: number; knock: number; mods: number;
  blast: number; blastMul: number;
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
  ...NEW_STATS,
};

// 12 rounds, ramping; the last one is the map boss. From wave 2 on, one or two of the newer
// types join each round (hornet 2; flanker + grenadier 3; sniper 4; bulwark + charger 5;
// medic 6; cloaker 7; gatling + rocketeer 8), and the old roster is thinned to make room,
// so a round's total pressure stays close to what it was. The city multiplies counts by 1.75.
type WaveSpec = Partial<Record<Kind, number>>;
const WAVES: WaveSpec[] = [
  { drifter: 5, brute: 1 },
  { drifter: 5, shooter: 1, runner: 1, hornet: 3 },
  { drifter: 5, brute: 1, shooter: 1, specter: 1, special: 1, flanker: 1, grenadier: 1 },
  { drifter: 4, brute: 2, shooter: 2, runner: 2, bomber: 1, special: 1, hornet: 3, sniper: 1 },
  { drifter: 5, brute: 1, shooter: 2, runner: 2, specter: 1, vanguard: 1, special: 1, flanker: 1, bulwark: 1, charger: 1, hornet: 3 },
  { drifter: 5, brute: 1, shooter: 2, runner: 2, bomber: 1, vanguard: 1, special: 2, grenadier: 1, sniper: 1, charger: 1, medic: 1, hornet: 3 },
  { drifter: 5, brute: 2, shooter: 2, runner: 3, specter: 2, bomber: 1, vanguard: 1, special: 2, flanker: 2, bulwark: 1, medic: 1, cloaker: 2, hornet: 3 },
  { drifter: 5, brute: 2, shooter: 3, runner: 3, specter: 2, bomber: 1, vanguard: 1, special: 2, grenadier: 1, sniper: 1, charger: 1, cloaker: 1, gatling: 1, rocketeer: 1, hornet: 4 },
  { drifter: 5, brute: 3, shooter: 3, runner: 3, specter: 2, bomber: 1, vanguard: 1, special: 2, flanker: 2, grenadier: 1, sniper: 2, bulwark: 1, medic: 1, cloaker: 1, gatling: 1, rocketeer: 1, hornet: 4 },
  { drifter: 5, brute: 3, shooter: 3, runner: 4, specter: 2, bomber: 2, vanguard: 1, special: 2, flanker: 2, grenadier: 2, sniper: 2, bulwark: 1, charger: 1, medic: 1, cloaker: 2, gatling: 1, rocketeer: 1, hornet: 4 },
  { drifter: 6, brute: 3, shooter: 3, runner: 4, specter: 2, bomber: 2, vanguard: 2, special: 2, flanker: 3, grenadier: 2, sniper: 2, bulwark: 1, charger: 1, medic: 2, cloaker: 2, gatling: 1, rocketeer: 2, hornet: 5 },
  { boss: 1, drifter: 4, brute: 2, shooter: 2, runner: 2, specter: 1, bomber: 1, vanguard: 1, special: 1, flanker: 1, bulwark: 1, sniper: 1, medic: 1, hornet: 3 },
];
const MAX_ENEMIES = 110;
const MARK_TIME = 2; // seconds a red X flashes before an enemy appears
const MAX_HP = 10;
const SHOP_KEYS = ["KeyZ", "KeyX", "KeyC"];
/** Toby's release this build is based on (shown on the settings page with "TS BUILD") */
const GAME_VERSION = "1.0.2";
const PATCH_COST = 6; // permanent emergency heal slot in the shop



const BULLET_SPEED = 22;
const ENEMY_BULLET_SPEED = 11;
const TURN_SPEED = 2.4;
const MAX_BULLETS = 90;
const SPEED = 7;
const EYE = 1.6;

const FORWARD = new THREE.Vector3();
const RIGHT = new THREE.Vector3();
const MOVE = new THREE.Vector3();
const TMP_A = new THREE.Vector3();
const TMP_B = new THREE.Vector3();
const PLAYER_R = 0.4; // player body radius for enemy contact
/** THE KRAKEN RIG's drawn reach (hull + curled tentacles at the boss's 1.6x scale): the solid
 * body and standoff it keeps from players, so the camera never ends up inside the model */
const KRAKEN_R = 4.2;

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
      {b.shape === "marshal" && <IronMarshalParts b={b} />}
      {b.shape === "kraken" && <KrakenRig b={b} />}
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

// THE KRAKEN RIG (Pacific Pier): a rusted pressure hull on a drilling derrick, dragging six
// segmented steel tentacles.
function KrakenRig({ b }: { b: Theme["boss"] }) {
  const hull = <meshLambertMaterial color={b.body} flatShading />;
  const steel = <meshLambertMaterial color={b.limb} flatShading />;
  const brass = <meshLambertMaterial color={b.weapon} flatShading />;
  const glow = <meshBasicMaterial color={b.glow} fog={false} />;
  const eye = <meshBasicMaterial color={b.eye} fog={false} />;
  return (
    <group>
      <mesh position-y={1.7} castShadow><cylinderGeometry args={[1.2, 1.5, 2.8, 10]} />{hull}</mesh>
      <mesh position-y={3.15} castShadow><sphereGeometry args={[1.2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />{hull}</mesh>
      {[0.9, 1.9, 2.8].map((y) => (
        <mesh key={y} position-y={y}><torusGeometry args={[1.36 - y * 0.05, 0.07, 5, 14]} />{brass}</mesh>
      ))}
      <mesh position={[0, 2.1, 1.18]}><sphereGeometry args={[0.46, 12, 10]} />{eye}</mesh>
      <mesh position={[0, 2.1, 1.12]} rotation-x={Math.PI / 2}><torusGeometry args={[0.52, 0.09, 6, 16]} />{brass}</mesh>
      {[-0.75, 0.75].map((x) => (
        <mesh key={x} position={[x, 1.25, 1.02]} rotation-x={Math.PI / 2}><cylinderGeometry args={[0.16, 0.16, 0.1, 10]} />{glow}</mesh>
      ))}
      {/* derrick */}
      {[0, 1, 2, 3].map((k) => {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        return (
          <mesh key={k} position={[Math.sin(a) * 0.45, 4.7, Math.cos(a) * 0.45]} rotation={[Math.cos(a) * -0.18, 0, Math.sin(a) * 0.18]}>
            <boxGeometry args={[0.1, 2.6, 0.1]} />{steel}
          </mesh>
        );
      })}
      {[4.1, 4.9, 5.6].map((y) => (
        <mesh key={y} position-y={y}><boxGeometry args={[1.1 - (y - 4.1) * 0.45, 0.07, 1.1 - (y - 4.1) * 0.45]} />{steel}</mesh>
      ))}
      <mesh position-y={6.05}><sphereGeometry args={[0.2, 8, 6]} />{glow}</mesh>
      {/* tentacles: jointed steel segments curling out and up from the base */}
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const a = (i / 6) * Math.PI * 2 + 0.3;
        const segs: { y: number; r: number; th: number; k: number }[] = [];
        let py = 0.3;
        let pr = 1.35;
        for (let k = 0; k < 6; k++) {
          // tentacles curl up tight so the rig stays within its standoff (see KRAKEN_R)
          const th = 0.35 + k * 0.38 + (i % 2) * 0.08;
          const L = 0.55 - k * 0.04;
          segs.push({ y: py + (Math.sin(th) * L) / 2, r: pr + (Math.cos(th) * L) / 2, th, k });
          py += Math.sin(th) * L;
          pr += Math.cos(th) * L;
        }
        return (
          <group key={i} rotation-y={a}>
            {segs.map((sg) => (
              <mesh key={sg.k} position={[0, sg.y, sg.r]} rotation-x={Math.PI / 2 - sg.th} castShadow>
                <cylinderGeometry args={[0.2 - sg.k * 0.025, 0.27 - sg.k * 0.025, 0.74, 7]} />{sg.k % 2 ? brass : steel}
              </mesh>
            ))}
            <mesh position={[0, py, pr]}><sphereGeometry args={[0.13, 6, 5]} />{glow}</mesh>
          </group>
        );
      })}
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
      else if (sp.type === "crawler") {
        part.current.rotation.z = Math.sin(t * 16) * 0.07;
        part.current.position.y = Math.abs(Math.sin(t * 16)) * 0.05;
      }
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
      {sp.type === "desperado" && <DesperadoModel sp={sp} data={data} />}
      {sp.type === "crawler" && (<group ref={part}>
        <mesh position-y={0.62} scale={[1.15, 0.42, 0.9]} castShadow><sphereGeometry args={[0.62, 12, 8]} />{B}</mesh>
        {[-0.28, 0, 0.28].map((x) => (
          <mesh key={x} position={[x, 0.86, -0.05]} scale={[0.16, 0.08, 0.5]}><sphereGeometry args={[0.6, 6, 5]} />{A}</mesh>
        ))}
        {[-0.18, 0.18].map((x) => (
          <group key={`e${x}`} position={[x, 0.9, 0.4]}>
            <mesh position-y={0.12}><cylinderGeometry args={[0.03, 0.035, 0.26, 5]} />{A}</mesh>
            <mesh position-y={0.28}><sphereGeometry args={[0.07, 8, 6]} />{G}</mesh>
          </group>
        ))}
        {[-1, 1].map((sd) => (
          <group key={`c${sd}`} position={[sd * 0.55, 0.6, 0.45]} rotation-y={sd * -0.5}>
            <mesh position-z={0.22} rotation-x={Math.PI / 2}><cylinderGeometry args={[0.07, 0.09, 0.45, 6]} />{B}</mesh>
            <mesh position={[0, 0.02, 0.55]} scale={[0.9, 0.55, 1.2]}><sphereGeometry args={[0.2, 8, 6]} />{B}</mesh>
            <mesh position={[sd * 0.06, 0.1, 0.76]} rotation-x={0.35}><boxGeometry args={[0.1, 0.06, 0.3]} />{B}</mesh>
            <mesh position={[sd * 0.06, -0.06, 0.76]} rotation-x={-0.35}><boxGeometry args={[0.1, 0.06, 0.26]} />{A}</mesh>
          </group>
        ))}
        {[-1, 1].map((sd) =>
          [-0.3, 0, 0.3].map((z) => (
            <mesh key={`l${sd}${z}`} position={[sd * 0.72, 0.32, z]} rotation={[0, 0, sd * 0.9]}>
              <cylinderGeometry args={[0.035, 0.05, 0.7, 5]} />{A}
            </mesh>
          )),
        )}
        <mesh position-y={0.05} rotation-x={-Math.PI / 2}><ringGeometry args={[0.7, 0.85, 18]} /><meshBasicMaterial color={sp.glow} transparent opacity={0.35} /></mesh>
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

const NO_ENEMIES: Enemy[] = [];
const EnemyMesh = memo(function EnemyMesh({ data, theme, all }: { data: Enemy; theme: Theme; all?: Enemy[] }) {
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
    const heavy = k === "brute" || k === "boss" || k === "vanguard" || isNewKind(k); // newer types animate themselves
    const bob = heavy ? 0 : Math.sin(t * (k === "runner" ? 10 : 4) + data.x) * (k === "specter" ? 0.22 : 0.08);
    g.position.set(data.x, bob + groundY(data.x, data.z), data.z);
    g.rotation.set(0, data.yaw ?? 0, 0); // same facing on every screen
    const base = k === "special" ? 1 : k === "boss" ? 1.6 : k === "runner" ? 0.6 : k === "vanguard" ? 1.05 : k === "hornet" ? 1.3 : 1;
    g.scale.setScalar(base * (data.elite ? 1.6 : 1) * (data.flash > 0 ? 1.15 : 1));
    if (aura.current) {
      aura.current.visible = !!data.elite;
      aura.current.rotation.y = t * 1.2;
    }
    if (ice.current) ice.current.visible = (data.frozen ?? 0) > 0 || (data.iceUntil ?? 0) > performance.now();
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
        <mesh position-y={0.2} rotation-x={-Math.PI / 2}>
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
      {isNewKind(kind) && <NewEnemyModel kind={kind} data={data} all={all ?? NO_ENEMIES} />}
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
const TMP_DIR = new THREE.Vector3();
const BLAST_AT = new THREE.Vector3();


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
        </mesh>
      ))}
    </>
  );
});

/** is this bulwark's shield raised? The host knows its shield strength; guests read the synced flag. */
function shieldUp(e: Enemy, host: boolean) {
  if (e.kind !== "bulwark") return false;
  return host ? (e.shield ?? 0) > 0 && (e.shieldT ?? 0) <= 0 : (((e.vis ?? 0) >> 6) & 1) === 1;
}

type Fx = { bounce?: number; pierce?: number; slow?: number; cluster?: number; chain?: number; burn?: number; knock?: number; mods?: number; blast?: number; blastMul?: number };
function fireInto(pool: Bullet[], pos: THREE.Vector3, vel: THREE.Vector3, life: number, damage = 1, color = "", size = 0, fx: Fx = {}) {
  const base = {
    life, active: true, damage, color, size,
    bounce: fx.bounce ?? 0, pierce: fx.pierce ?? 0, slow: fx.slow ?? 0, cluster: fx.cluster ?? 0, chain: fx.chain ?? 0,
    burn: fx.burn ?? 0, knock: fx.knock ?? 0, mods: fx.mods ?? 0,
    blast: fx.blast ?? 0, blastMul: fx.blastMul ?? 0,
  };
  const i = pool.findIndex((b) => !b.active);
  const slot = pool[i];
  if (slot) {
    Object.assign(slot, base);
    slot.pos.copy(pos);
    slot.vel.copy(vel);
    return i;
  } else if (pool.length < MAX_BULLETS) {
    pool.push({ pos: pos.clone(), vel: vel.clone(), ...base });
    return pool.length - 1;
  }
  return -1;
}


/** Simple blocky gun model, different silhouette per weapon. */
type ModLooks = Partial<Record<"burst" | "incend" | "magnum" | "extmag" | "shred" | "laser" | "comp" | "suppr" | "exec" | "holster" | "bounty", boolean>>;
/**
 * A modest rim and fill light on the first-person gun's lit materials, so a dark gun still
 * reads against a bright sunset or a dark night: a soft edge highlight where its surfaces turn
 * away from the eye, and a small lift of its own colour. Patched once per material.
 */
function addGunRim(m: THREE.Material) {
  if (m.userData["gunRim"] || !(m instanceof THREE.MeshLambertMaterial || m instanceof THREE.MeshStandardMaterial)) return;
  m.userData["gunRim"] = true;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.fragmentShader = sh.fragmentShader.replace(
      "#include <aomap_fragment>",
      `#include <aomap_fragment>
{
  vec3 vd = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition);
  float rim = pow(1.0 - clamp(dot(normal, vd), 0.0, 1.0), 3.0);
  totalEmissiveRadiance += (diffuseColor.rgb * 0.5 + vec3(0.32, 0.34, 0.38)) * rim * 0.42 + diffuseColor.rgb * 0.07;
}`,
    );
  };
  const key = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => key() + "|gun-rim";
  m.needsUpdate = true;
}

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
  western,
  gaps,
  seed,
  time,
  ability,
  onAbilityCd,
  onStat,
  onEvent,
  mapFeed,
  downed,
  pingWorld,
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
  /** Dry Gulch, the western big map */
  western: WesternLayout | null;
  /** solo blockade openings on a big map (empty in co-op) */
  gaps: Gap[];
  seed: number;
  time: TimeOfDay;
  ability: AbilityId;
  onAbilityCd: (left: number, max: number) => void;
  onStat: (k: "shot" | "hit" | "dmg" | "taken", n: number) => void;
  onEvent: (name: string | null) => void;
  mapFeed: React.MutableRefObject<MapFeed>;
  /** co-op: out of health but not yet bled out (crawling, waiting for a revive) */
  downed: boolean;
  /** what pings can hit (filled here, read by the SquadDriver) */
  pingWorld: React.MutableRefObject<PingWorld | null>;
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
  // (big maps: the ring sits on the ground there, or at your feet on a roof / in a car)
  const fxFloor = (x: number, z: number) =>
    Math.hypot(x - camera.position.x, z - camera.position.z) < 0.5 ? camera.position.y - EYE : groundY(x, z);
  const playFx = (color: string, r0: number, r1: number, dur: number, x: number, z: number, y = fxFloor(x, z) + 0.12) => {
    ringFx.current = { t: dur, dur, r0, r1, x, y, z, color };
  };
  const cdReport = useRef(0);


  // armour soaks damage; getting hit can discharge a shock ring
  // knocked back by a ram / blast: same decaying push as a car bump
  const shove = (kx: number, kz: number) => {
    knock.current.x = kx;
    knock.current.z = kz;
    knock.current.shake = Math.max(knock.current.shake, 0.5);
  };
  const hitLog = useRef<{ dmg: number; t: number }[]>([]); // test handle: every incoming hit
  const takeHit = (dmg: number) => {
    if (hitLog.current.length < 400) hitLog.current.push({ dmg, t: performance.now() });
    if (invuln.current > 0) return; // dash i-frames / kinetic barrier
    reviveInterrupted(); // taking damage breaks off a revive in progress
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
  const look3 = worldLook(theme, time, ARENA);
  const arenaNight = useMemo(() => new THREE.Color(worldLook(theme, "night", ARENA).sky), [theme]);
  /** the big real-scale maps (the city, Dry Gulch) share spawning, recycling and the minimap */
  const big = city ?? western;
  // solo on the city: traffic keeps to the streets inside the blockades (it turns back at
  // the last crossing instead of driving into the barricades)
  const trafficCity = useMemo(() => {
    if (!city || gaps.length === 0) return null;
    const inside = (r: CityLayout["roadX"][number]) => Math.abs(r.c) + CURB[r.cls] + 6 < PLAY_HALF;
    // (each road keeps its index in the full grid, so the light phases stay the drawn ones)
    const nz = city.roadZ.length;
    return {
      ...city,
      roadX: city.roadX.map((r, i) => ({ ...r, sig: i })).filter(inside),
      roadZ: city.roadZ.map((r, i) => ({ ...r, sig: i, sigN: nz })).filter(inside),
    };
  }, [city, gaps]);
  const alpineMap = city && "alpine" in city ? (city as AlpineLayout) : null;
  const { gl, scene } = useThree();
  useEffect(() => {
    // dev-only handle for poking at the scene from the console / test tooling
    if (debugHandles()) {
      const handle = { gl, scene, camera, look, liveCars, knock, city, western, gaps, traffic, remotes };
      Object.assign(handle, { enemies, turrets, mines, remoteDeps, spawnWave, groundAt: groundY, blockedAt: (x: number, z: number, r: number) => blocked(blocks, x, z, r) });
      // enemy testing: ordnance, the hit log, the wave director, the damage path
      Object.assign(handle, { ords, hitLog, packLead, blocks, keys, pending, wave, nextWaveTimer, hurtEnemy, blastAt });
      // weapon testing: every gun with deep ammo, a trigger to hold, stats for the co-op fire feed
      const giveAll = () => {
        for (const w of ORDER) { owned.current.add(w); ammo.current[w] = 9999; }
        syncInv();
      };
      Object.assign(handle, { giveAll, equip, trigger, weapon, invuln, stats, bullets, fxNetStats, net: netRef, fx: FX });
      // building access: the buildings, the local player's zone state, cars and doors
      Object.assign(handle, { access: { list: accessList, markers: accessMarkers, state: accessDebug, player: accPlayer, zoneAt, solid, los: (ax: number, az: number, bx: number, bz: number) => clearLine(blocks, ax, az, bx, bz, 0.1), blocked: (x: number, z: number, r: number) => blocked(blocks, x, z, r) } });
      // gameplay testing: the time of day, map events, the power grid, pings and revives
      Object.assign(handle, { tod, mapEvent, forceMapEvent, power, pings, squad, waveTotal, healthRef, owned, downedRef });
      (window as unknown as { __rs?: unknown }).__rs = handle;
    }
  }, [gl, scene, camera, city, western, gaps, remotes, enemies]); // eslint-disable-line react-hooks/exhaustive-deps -- test handle: the functions read refs, so the first render's copies stay valid
  // combat effects need to know the world: what is solid, where the robots are, the gun table
  useEffect(() => {
    fxGuns(Object.fromEntries(ORDER.map((w) => [visOf(w), GUNS[w]])));
    const dust = parseInt((theme.blocks[1] ?? "#9a9080").slice(1), 16);
    fxEnv({
      solid: (x, z) => blocked(blocks, x, z, 0.05),
      car: (x, y, z) => (city !== null || western !== null) && hitsTraffic(x, y, z),
      half: () => HALF,
      waterZ: city ? city.waterZ : null,
      enemies,
      radius: (k) => STATS[k as Kind]?.radius ?? 0.6,
      height: (k) => hitBand(k)[1], // fliers hover: their band tops out higher (enemyKinds.ts)
      dust: Number.isFinite(dust) ? dust : 0x9a9080,
    });
  }, [blocks, city, western, enemies, theme]);
  useEffect(() => {
    // the city needs a much deeper view so the skyline reads; other maps keep 120
    const c = camera as THREE.PerspectiveCamera;
    c.far = look3.camFar;
    c.updateProjectionMatrix();
  }, [look3.camFar, camera]);
  const bobAmt = useRef(0);
  /** smoothed ground height under the player (decks, stairs, bowls on maps with relief) */
  const camGround = useRef(0);

  // what a ping can land on (read by the SquadDriver)
  useEffect(() => {
    pingWorld.current = {
      enemies,
      items: [
        { get x() { return pickup.current.x; }, get z() { return pickup.current.z; }, get active() { return pickup.current.active; }, kind: "gun", get label() { return GUNS[pickup.current.gun].name; } },
        { get x() { return heal.current.x; }, get z() { return heal.current.z; }, get active() { return heal.current.active; }, kind: "heal", label: "HEALTH" },
        { get x() { return crate.current.x; }, get z() { return crate.current.z; }, get active() { return crate.current.active; }, kind: "crate", get label() { return CRATE_INFO[crate.current.kind].name; } },
      ],
      solid: (x, z) => blocked(blocks, x, z, 0),
      ground: groundY,
      los: (ax, az, bx, bz) => clearLine(blocks, ax, az, bx, bz, 0.05),
      band: (k) => hitBand(k),
      radius: (k) => STATS[k as Kind]?.radius ?? 0.6,
      enemyLabel: (e) => (e.kind === "boss" ? theme.boss.name : e.kind === "special" ? theme.special.name : (ENEMY_INFO[e.kind]?.name ?? e.kind.toUpperCase())),
    };
  }, [blocks, enemies, theme, pingWorld]);

  // (roofs of access buildings get their own nav cells, walled off from the street)
  const solid = useMemo(() => closeRaised(patchNav(solidGrid(blocks))), [blocks]);
  /** flow-field cache key: the nav cell a field toward this target starts from (level.ts navTarget) */
  const navKey = (t: { x: number; z: number }) => {
    const [i, j] = navTarget(solid, t.x, t.z, blocks);
    return i * 1000 + j;
  };
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
  // grenades / rockets / blasts from the newer enemy types (the host simulates, guests mirror)
  const ords = useRef<Ord[]>(Array.from({ length: MAX_ORD }, newOrd));
  const ordTx = useRef(new Float32Array(MAX_ORD * 3));
  const hornetCd = useRef({ v: 0 });
  const guestRef = useRef(false);
  // hornet packs: index of the pack leader each follower spawns beside (-1 = none)
  const packLead = useRef(new Int16Array(MAX_ENEMIES).fill(-1));
  const sepGrid = useRef(new Map<number, number[]>());

  // ---------- networking ----------
  const netRef = useRef<NetHandle | null>(net);
  netRef.current = net;
  const isHost = !net || net.role === "host";
  const isHostRef = useRef(isHost);
  isHostRef.current = isHost;
  guestRef.current = !isHost;
  const deadRef = useRef(dead);
  deadRef.current = dead;
  const downedRef = useRef(downed);
  downedRef.current = downed;
  const aliveRef = useRef(!dead);
  aliveRef.current = !dead;
  const waveTotal = useRef(1);
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
    // fliers (hornets, medic drones) pass over traffic: a hugely negative radius never touches
    radiusOf: (e) => (FLYERS.has(e.kind) ? -99 : (STATS[e.kind as Kind]?.radius ?? 0.6) * (e.elite ? 1.6 : 1)),
    isBig: (e) => !!e.elite || e.kind === "boss" || e.kind === "brute" || e.kind === "vanguard" || HEAVY_NEW.has(e.kind),
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
  /** fine 2 m fields round each target (stacked-ground maps only, see level.ts fineField) */
  const fines = useRef(new Map<number, FineField>());
  const fineKey = (t: { x: number; z: number }) => toCell(t.x) * 1000 + toCell(t.z);
  const recycleT = useRef(1);
  const krakenT = useRef(4);
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
    r.az = Number(m.az ?? 0);
    if (m.ap !== undefined) r.ap = Number(m.ap); // elevator button presses (host compares counts) // building access: which zone (roof / lobby / car) and floor height
    r.ay = m.ay !== undefined ? Number(m.ay) : undefined;
    r.rc = Number(m.rc ?? -1);
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
      e.vis = u.vis; // telegraphs, lasers, shields and cloak of the newer types
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
    unpackOrds(ords.current, Array.isArray(m.od) ? (m.od as number[]) : [], ordTx.current);
    const eb = (m.b as number[]) ?? [];
    enemyBullets.current.forEach((b) => (b.active = false));
    for (let i = 0; i * 3 + 2 < eb.length; i++) {
      let b = enemyBullets.current[i];
      if (!b) {
        b = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 1, active: false, damage: 1, color: "", size: 0, bounce: 0, pierce: 0, slow: 0, cluster: 0, chain: 0, burn: 0, knock: 0, mods: 0, blast: 0, blastMul: 0 };
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
    if (Array.isArray(m.ac)) decodeCars(m.ac as number[]);
    if (typeof m.tk === "number") tod.hostK = m.tk / 1000;
    if (typeof m.rn === "number") decodeWeather(m.rn);
    const mk = (m.mk as number[]) ?? [];
    pending.current = enemies.map(() => null);
    for (let j = 0; j + 3 < mk.length; j += 4) {
      pending.current[mk[j]!] = { x: mk[j + 1]!, z: mk[j + 2]!, t: mk[j + 3]! };
    }
  };

  useEffect(() => {
    msgSink.current = (m: NetMsg) => {
      const n = netRef.current;
      if (onMapEventMsg(m)) return;
      if (m.type === "t") { upsertRemote(m); return; }
      if (m.type === "fire") { fxRemoteFire(m, remotes.current); return; } // visual-only replay
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
          // a guest's hit runs through exactly the same path as the host's own; a direct shot
          // into a raised shield is re-checked with the host's facing (the host has final say)
          const i = Number(m.i);
          const e = enemies[i];
          if (e?.alive) {
            applyHit(e, i, Number(m.dmg) || 0, {
              slow: Number(m.slow ?? 0), burn: Number(m.burn ?? 0), kb: Number(m.kb ?? 0),
              kx: Number(m.kx ?? 0), kz: Number(m.kz ?? 0), direct: m.d === 1,
              shred: m.sh === 1, exec: m.ex === 1, bounty: m.bo === 1, freeze: Number(m.fz ?? 0),
            }, String(m.from));
          }
        } else if (m.type === "blast") {
          // a guest's BOOMER / FLAK exploded: the host resolves the splash and credits the guest
          applyBlast(Number(m.x), Number(m.y), Number(m.z), Math.min(8, Number(m.r) || 0), Number(m.d) || 0,
            Number(m.vx) || 0, Number(m.vz) || 0, Number(m.s ?? -1), String(m.from));
        } else if (m.type === "shield") {
          const e = enemies[Number(m.i)];
          if (e?.alive && e.kind === "bulwark") drainShield(e, Number(m.dmg));
        } else if (m.type === "odhit") {
          const o = ords.current[Number(m.i)];
          if (o?.on && o.tp === 1) { o.on = false; blast(ords.current, o.x, o.z, 0.8, o.y); }
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
        else if (m.type === "status") {
          onStatus(Number(m.w), Number(m.rem), !!m.won, !!m.banner);
          if (m.banner) {
            // a new wave: guests get the same fresh sidearm magazine the host's spawnWave hands out
            ammo.current.pistol = Math.round((stats.current.extmag ? 220 : GUNS.pistol.ammo) * stats.current.ammoMul);
            onAmmo(ammo.current[weapon.current]);
            syncInv();
          }
        }
        else if (m.type === "boss") onBoss(Number(m.hp));
        else if (m.type === "kill") {
          const e = enemies[Number(m.i)];
          if (e) creditKill(e, m.el === 1, m.bo === 1); // I landed the killing blow
        }
        else if (m.type === "hurt") {
          if (m.kx !== undefined && invuln.current <= 0) shove(Number(m.kx), Number(m.kz));
          takeHit(Number(m.dmg) || 1);
        }
      }
    };
  }); // eslint-disable-line react-hooks/exhaustive-deps




  useEffect(() => {
    // the city starts on the landmark's plaza, looking up the tower
    look.current = {
      yaw: western ? western.spawnYaw : isBeach(city) ? city.spawnYaw : alpineMap ? alpineMap.alpine.spawnYaw : 0,
      pitch: city ? 0.12 : 0,
    };
    placeAtSpawn();
    resetRide();
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
    fxReset();

    syncInv();

    // fresh random gun order for this run
    const pool: Weapon[] = [...DROPPABLE];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    dropOrder.current = pool;
    // a full sidearm from the first frame (the HUD used to flash "PISTOL 0" until wave 1)
    ammo.current.pistol = Math.round((stats.current.extmag ? 220 : GUNS.pistol.ammo) * stats.current.ammoMul);
    onAmmo(ammo.current.pistol);
    syncInv();
    bullets.current.forEach((b) => (b.active = false));
    enemyBullets.current.forEach((b) => (b.active = false));
    ords.current.forEach((o) => (o.on = false));
    onStatus(1, 0, false, true);
  }, [blocks, camera]); // eslint-disable-line react-hooks/exhaustive-deps

  // co-op players stand side by side at the spawn (a small ring by player number), not inside
  // each other
  const spawnNum = () => (!net || net.role === "host" ? 1 : (slots.current[net.self] ?? 2));
  const placeAtSpawn = () => {
    const sx = big ? big.spawn.x : 0;
    const sz = big ? big.spawn.z : 0;
    const num = spawnNum();
    let x = sx;
    let z = sz;
    if (num > 1) {
      // to the right, left, then behind the host, relative to the spawn facing
      const yaw = look.current.yaw;
      const rx = Math.cos(yaw);
      const rz = -Math.sin(yaw);
      const bx = Math.sin(yaw);
      const bz = Math.cos(yaw);
      const offs: [number, number][] = num === 2 ? [[2.4, 0], [-2.4, 0], [0, 2.4]] : num === 3 ? [[-2.4, 0], [2.4, 0], [0, 2.4]] : [[0, 2.4], [2.4, 2.4], [-2.4, 2.4]];
      for (const r of [1, 1.6, 2.2]) {
        const hit = offs.find(([a, b]) => !blocked(blocks, sx + (rx * a + bx * b) * r, sz + (rz * a + bz * b) * r, 0.5));
        if (hit) {
          x = sx + (rx * hit[0] + bx * hit[1]) * r;
          z = sz + (rz * hit[0] + bz * hit[1]) * r;
          break;
        }
      }
    }
    camera.position.set(x, EYE + (big ? groundY(x, z) : 0), z);
    camGround.current = camera.position.y - EYE;
  };
  // the roster (my player number) can arrive just after the new arena: re-place before the match starts
  const lastSpawnNum = useRef(0);
  useEffect(() => {
    const id = window.setInterval(() => {
      const num = spawnNum();
      if (num !== lastSpawnNum.current && wave.current === 0 && !lockedRef.current) {
        lastSpawnNum.current = num;
        placeAtSpawn();
      }
    }, 300);
    return () => window.clearInterval(id);
  }); // eslint-disable-line react-hooks/exhaustive-deps

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
  /** chairlift chairs teammates are riding (so two players never share one) */
  const ridersTaken = () => {
    const out = new Set<number>();
    const now = performance.now();
    remotes.current.forEach((r) => {
      if (now - r.last < 4000 && (r.rc ?? -1) >= 0) out.add(r.rc!);
    });
    return out;
  };
  const livePlayers = (zone?: number) => {
    const out: { x: number; z: number }[] = [];
    const ok = (x: number, z: number, onLift: boolean) =>
      !alpineMap || (!onLift && (zone === undefined || alpineZone(x, z) === zone));
    if (!deadRef.current && ok(camera.position.x, camera.position.z, ride.chair >= 0))
      out.push({ x: camera.position.x, z: camera.position.z });
    const now = performance.now();
    remotes.current.forEach((r) => {
      if (r.hp > 0 && now - r.last < 4000 && ok(r.x, r.z, (r.rc ?? -1) >= 0)) out.push({ x: r.x, z: r.z });
    });
    if (out.length === 0) out.push({ x: camera.position.x, z: camera.position.z });
    return out;
  };
  /** a spawn spot: anywhere on the small maps; near a living player in the big city */
  const navOpen = (x: number, z: number) => !solid.g[toNav(x) * solid.n + toNav(z)] && !raised(x, z);
  /** alpine: which zones (0 village, 1 summit) have a player standing in them (not riding) */
  const liveZones = () => {
    const z = new Set<number>();
    for (const p of livePlayers()) z.add(alpineZone(p.x, p.z));
    return z;
  };
  // building access zones: roofs are 100 + b, inside a building (or on the alpine lift) -1,
  // the street is the map's own zone (0; the alpine village 0 / summit 1)
  const baseZone = (x: number, z: number) => (alpineMap ? alpineZone(x, z) : 0);
  const zoneOf = (x: number, z: number) => zoneAt(x, z) || baseZone(x, z);
  const myZone = () => {
    const k = playerZoneKey();
    if (k !== 0) return k;
    if (alpineMap && ride.chair >= 0) return -1;
    return baseZone(camera.position.x, camera.position.z);
  };
  const remoteZone = (r: RemoteState) => {
    const k = zoneKeyOfAz(r.az);
    if (k !== 0) return k;
    if (alpineMap && (r.rc ?? -1) >= 0) return -1;
    return baseZone(r.x, r.z);
  };
  /** building access: every live player with their zone */
  const zonePlayers = () => {
    const out: { x: number; z: number; zn: number; b: number }[] = [];
    if (!deadRef.current) out.push({ x: camera.position.x, z: camera.position.z, zn: myZone(), b: accPlayer.b });
    const now = performance.now();
    remotes.current.forEach((r) => {
      if (r.hp > 0 && now - r.last < 4000) out.push({ x: r.x, z: r.z, zn: remoteZone(r), b: r.az ? azBuilding(r.az) : -1 });
    });
    return out;
  };
  const streetIn = (zn: number) => (x: number, z: number) => navOpen(x, z) && zoneOf(x, z) === zn;
  /**
   * A spawn spot. Big city: near a living player, out of sight. With building access the spot
   * is in a zone that has players standing in it (`zone` forces one): on a roof it is behind
   * rooftop structures or at the roof door, and a full roof sends the rest to wait round the
   * building's entrance on the street.
   */
  const spot = (rMin: number, rMax: number, hidden: boolean, zone?: number, already = false) => {
    if (!big) return randomSpawn(blocks, rand);
    if (!accessActive()) {
      const q = spawnNear(
        blocks, rand, livePlayers(zone), rMin, rMax, hidden, 1,
        alpineMap && zone !== undefined ? (x, z) => navOpen(x, z) && alpineZone(x, z) === zone : navOpen,
      );
      // the alpine summit is a small open island where the ring search often finds nothing out
      // of sight: fall back to any open island cell no player can see (behind the lodge or the
      // top station), before ever appearing in view
      if (hidden && alpineMap && alpineZone(q.x, q.z) === 1) {
        const ps = livePlayers(1);
        const seen = (x: number, z: number) => ps.some((p) => clearLine(blocks, p.x, p.z, x, z, 0.1));
        if (seen(q.x, q.z)) {
          const isl = alpineMap.alpine.island;
          for (let k = 0; k < 120; k++) {
            const x = isl.x0 + 1 + rand() * (isl.x1 - isl.x0 - 2);
            const z = isl.z0 + 1 + rand() * (isl.z1 - isl.z0 - 2);
            if (blocked(blocks, x, z, 1) || !navOpen(x, z) || seen(x, z)) continue;
            if (ps.some((p) => Math.hypot(p.x - x, p.z - z) < 10)) continue;
            return { x, z };
          }
        }
      }
      return q;
    }
    const zp = zonePlayers();
    const standing = zp.filter((p) => p.zn >= 0);
    const zn = zone ?? (standing.length ? standing[Math.floor(rand() * standing.length)]!.zn : baseZone(camera.position.x, camera.position.z));
    if (zn >= ROOF_KEY) {
      const b = zn - ROOF_KEY;
      // (`already`: the caller is an enemy on that roof, re-placing itself: it has a place)
      if (already || roofCount(b, enemies, pending.current) < (accessList()[b]?.cap ?? 0))
        return roofSpot(b, blocks, standing.filter((p) => p.zn === zn), rand, hidden);
      const ds = doorstep(b);
      return spawnNear(blocks, rand, [ds], rMin, rMax, hidden, 1, streetIn(baseZone(ds.x, ds.z)));
    }
    let anchors: { x: number; z: number }[] = standing.filter((p) => p.zn === zn);
    // nobody on the street: gather round the buildings the squad went into
    if (!anchors.length) anchors = zp.filter((p) => p.b >= 0).map((p) => doorstep(p.b));
    if (!anchors.length) anchors = livePlayers();
    return spawnNear(blocks, rand, anchors, rMin, rMax, hidden, 1, streetIn(zn));
  };
  /** snipers take to the rooftops: a roof with a player on it (and room), if there is one */
  const sniperZone = () => {
    if (!accessActive()) return undefined;
    const roofs = zonePlayers().filter((p) => p.zn >= ROOF_KEY).map((p) => p.zn);
    const ok = roofs.filter((z) => roofCount(z - ROOF_KEY, enemies, pending.current) < (accessList()[z - ROOF_KEY]?.cap ?? 0));
    return ok.length ? ok[Math.floor(rand() * ok.length)] : undefined;
  };

  /** where the boss appears: Dry Gulch's Iron Marshal steps off his train at the platform */
  const bossSpot = () => (western ? trainBossSpot() : spot(25, 40, false));

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
  const tracerCount = useRef(0);
  const bountyKills = useRef(0);

  // ---- damage: ONE host-side path for every hit, the host's own and the guests' ----
  // Guests never apply damage themselves: they send the full hit (damage, slow, burn,
  // knockback, shred / executioner / bounty flags, shot direction) and the host runs
  // applyHit exactly as for its own shots. Kill credit and kill rewards go back to the
  // shooter, so nothing is lost and nothing is counted twice.
  type HitFx = { slow?: number; burn?: number; kb?: number; kx?: number; kz?: number; direct?: boolean; shred?: boolean; exec?: boolean; bounty?: boolean; freeze?: number };
  /** kill credit and kill rewards, on the client of whoever landed the blow */
  const creditKill = (e: Enemy, elite: boolean, bounty: boolean) => {
    onScore();
    if (elite) onShard(15);
    if (bounty) {
      onShard(1);
      bountyKills.current++;
      if (bountyKills.current % 6 === 0) onLeech();
    }
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
  /** host: an enemy dies; `from` is the shooter (null = this host player) */
  const killEnemy = (e: Enemy, idx: number, from: string | null, bounty: boolean) => {
    e.alive = false;
    e.burn = 0;
    if (e.kind === "special" && theme.special.type === "mite") {
      // shell shatters into a ring of cold shrapnel
      for (let s = 0; s < 8; s++) {
        const a = (s / 8) * Math.PI * 2;
        const v = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
        fireInto(enemyBullets.current, new THREE.Vector3(e.x + v.x * 0.6, groundY(e.x, e.z) + 1.2, e.z + v.z * 0.6), v.multiplyScalar(9), 0.9, 1, "", 0.14);
      }
    }
    const elite = !!e.elite;
    e.elite = 0;
    // elites, mini-bosses and bosses always leave a medkit behind (Toby); only on open ground
    // (not up on a roof, where the pack would drop into the building below)
    if ((e.kind === "boss" || e.kind === "vanguard") && !blocked(blocks, e.x, e.z, 0.5)) heal.current = { x: e.x, z: e.z, active: true };
    if (from === null) creditKill(e, elite, bounty);
    else netRef.current?.sendTo(from, { type: "kill", i: idx, el: elite ? 1 : 0, bo: bounty ? 1 : 0 });
  };
  /** host only: apply one hit with all its effects */
  const applyHit = (e: Enemy, idx: number, dmg: number, h: HitFx, from: string | null) => {
    if (!e.alive) return;
    // a direct shot into a raised bulwark shield is stopped, whoever fired it
    if (h.direct && shieldBlocks(e, h.kx ?? 0, h.kz ?? 0, shieldUp(e, true))) {
      drainShield(e, dmg);
      return;
    }
    const now = performance.now();
    if (h.exec && e.hp < (e.max ?? e.hp) * 0.5) dmg *= 2; // executioner: judged on the host's true health
    if ((e.shredUntil ?? 0) > now) dmg *= 1.3;
    if (e.kind === "special" && theme.special.type === "nautilus") dmg *= 0.5; // shell soaks half
    if (e.kind === "special" && theme.special.type === "crawler") dmg *= 0.7; // crab shell
    dmg *= damageMul(e); // a charger stunned against a wall takes extra
    const kb = h.kb ?? 0;
    if (kb > 0 && e.kind !== "boss") {
      const kx = h.kx ?? 0;
      const kz = h.kz ?? 0;
      const len = Math.hypot(kx, kz) || 1;
      const push = kb * (e.kind === "brute" || e.kind === "vanguard" || HEAVY_NEW.has(e.kind) ? 0.5 : 1);
      // walk the push in small steps so a shove never drives anyone into cover (Toby), and
      // never lifts it onto a balcony or up the tower's face (climbable)
      const er = Math.min(STATS[e.kind].radius, 0.8);
      const steps = Math.max(1, Math.ceil(push / 0.35));
      const sx = (kx / len) * (push / steps);
      const sz = (kz / len) * (push / steps);
      for (let s = 0; s < steps; s++) {
        const nx = e.x + sx;
        const nz = e.z + sz;
        const okX = !blocked(blocks, nx, e.z, er) && climbable(e.x, e.z, nx, e.z);
        if (okX) e.x = nx;
        const okZ = !blocked(blocks, e.x, nz, er) && climbable(e.x, e.z, e.x, nz);
        if (okZ) e.z = nz;
        if (!okX && !okZ) break;
      }
    }
    e.hp -= dmg;
    e.flash = 0.1;
    e.hitT = 2; // cloakers flicker into view when hurt
    if ((h.slow ?? 0) > 0) e.slow = h.slow!;
    if ((h.freeze ?? 0) > 0) e.frozen = Math.max(e.frozen ?? 0, h.freeze!); // cryo nova
    if ((h.burn ?? 0) > 0) { e.burn = h.burn!; e.burnTick = 1; e.burnFrom = from; }
    if (h.shred) e.shredUntil = now + 3000;
    if (e.kind === "boss") onBoss(Math.max(0, e.hp));
    if (e.hp <= 0) killEnemy(e, idx, from, !!h.bounty);
  };
  /** this client's player deals damage: applied on the host, sent to the host from a guest */
  const hurtEnemy = (e: Enemy, dmg: number, idx: number, slow = 0, burn = 0, kb = 0, kx = 0, kz = 0, fx: Omit<HitFx, "slow" | "burn" | "kb" | "kx" | "kz"> = {}) => {
    // life steal (Blood Siphon, Blood Pact, the Bio-Siphon class) heals whoever dealt the damage
    if (stats.current.steal > 0 && dmg > 0 && e.alive) {
      stealBank.current += dmg * stats.current.steal;
      if (stealBank.current >= 1) { stealBank.current -= 1; onLeech(); }
    }
    if (!isHostRef.current) {
      netRef.current?.broadcast({
        type: "hit", i: idx, dmg,
        ...(slow ? { slow } : {}),
        ...(burn ? { burn } : {}),
        ...(kb ? { kb } : {}),
        ...(kb || fx.direct ? { kx: Math.round(kx * 100) / 100, kz: Math.round(kz * 100) / 100 } : {}),
        ...(fx.direct ? { d: 1 } : {}),
        ...(fx.shred ? { sh: 1 } : {}),
        ...(fx.exec ? { ex: 1 } : {}),
        ...(fx.bounty ? { bo: 1 } : {}),
        ...(fx.freeze ? { fz: fx.freeze } : {}),
      });
      e.flash = 0.1;
      return;
    }
    applyHit(e, idx, dmg, { slow, burn, kb, kx, kz, ...fx }, null);
  };
  /**
   * BOOMER / FLAK splash, host only: every robot within `r` of the blast (and in its line of
   * sight: walls shield what is behind them) takes `dmg` with falloff, 100% at the centre and
   * 35% at the edge, plus a shove away from the centre. Each hit runs through applyHit as a
   * direct hit from the blast's direction, so a bulwark facing the blast blocks it, and the
   * kill credit goes to the shooter (`from`).
   */
  const applyBlast = (x: number, y: number, z: number, r: number, dmg: number, vx: number, vz: number, skip: number, from: string | null) => {
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i]!;
      if (!e.alive || i === skip) continue;
      const dx = e.x - x;
      const dz = e.z - z;
      const d = Math.hypot(dx, dz);
      const er = STATS[e.kind].radius;
      const dd = Math.max(0, d - er);
      if (dd > r) continue;
      const [lo, hi] = hitBand(e.kind);
      const ey = groundY(e.x, e.z);
      if (y < ey + lo - r || y > ey + hi + r) continue; // far above or below (a roof, a hornet)
      if (d > er + 0.3 && !clearLine(blocks, x, z, e.x, e.z, 0.1)) continue;
      const k = 1 - 0.65 * Math.min(1, dd / r);
      // at the centre the blast travels the way the shell was flying
      const [kx, kz] = d > 0.3 ? [dx / d, dz / d] : [vx, vz];
      applyHit(e, i, dmg * k, { kb: 2.4 * k, kx, kz, direct: true }, from);
    }
  };
  /** this client's round exploded: resolved on the host (a guest sends one "blast" message) */
  const blastAt = (x: number, y: number, z: number, r: number, dmg: number, vx: number, vz: number, skip = -1) => {
    onStat("hit", 1);
    onStat("dmg", dmg);
    if (stats.current.steal > 0) {
      stealBank.current += dmg * stats.current.steal;
      if (stealBank.current >= 1) { stealBank.current -= 1; onLeech(); }
    }
    // no friendly fire, but a close blast gives your own player a gentle push
    const c = camera.position;
    const pd = Math.hypot(c.x - x, c.z - z);
    if (pd < r && Math.abs(c.y - EYE - y) < r) {
      const push = 4 * (1 - pd / r);
      knock.current.x += ((c.x - x) / (pd || 1)) * push;
      knock.current.z += ((c.z - z) / (pd || 1)) * push;
    }
    const q = (v: number) => Math.round(v * 100) / 100;
    const vl = Math.hypot(vx, vz) || 1;
    if (isHostRef.current) applyBlast(x, y, z, r, dmg, vx / vl, vz / vl, skip, null);
    else netRef.current?.broadcast({ type: "blast", x: q(x), y: q(y), z: q(z), r: q(r), d: q(dmg), vx: q(vx / vl), vz: q(vz / vl), s: skip });
  };
  const burstTimer = useRef(0);

  const spit = () => {
    const w = weapon.current;
    const g = gunFor(w);
    const s2 = stats.current;
    camera.getWorldDirection(FORWARD);
    const pos = camera.position.clone().addScaledVector(FORWARD, 0.6);
    pos.y -= 0.25;
    // seeded spread so co-op viewers can replay the exact same pellets
    const seed = (Math.random() * 1e9) | 0;
    const spread = rng(seed);
    const kind = visOf(w);
    let vf = w === "pistol" ? (s2.magnum ? VF.MAGNUM : 0) | (s2.incend ? VF.INCEND : 0) : 0;
    if (w === "smg" && ++tracerCount.current % 3 === 0) vf |= VF.TRACER;
    for (let s = 0; s < g.count; s++) {
      const dir = aimDir(new THREE.Vector3(), FORWARD, g.count, g.spread, s, spread);
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
        // Combustion (perks, the Bio-Siphon class, Cluster Charge) widens the blast a little
        blast: g.blast ? g.blast * (1 + 0.5 * s2.boom) : 0,
        blastMul: g.blastMul ?? 0,
        mods: isP ? (s2.shred ? M_SHRED : 0) | (s2.exec ? M_EXEC : 0) | (s2.bounty ? M_BOUNTY : 0) : 0,
      };
      const slot = fireInto(
        bullets.current, pos, dir.normalize().multiplyScalar(g.speed), g.life, dmg,
        crit ? "#ffffff" : g.color, crit ? g.size * 1.4 : g.size, fx,
      );
      if (slot >= 0) fxShot(slot, bullets.current[slot]!, kind, vf | (crit ? VF.CRIT : 0));
      onStat("shot", 1);
    }
    fxFired(kind, vf, pos, FORWARD, seed, g.speed, netRef.current);
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

  // dying costs you every gun but the pistol; upgrades and pistol mods are kept. Going DOWN
  // in co-op is not dying: the guns go only if the bleed-out runs out (or solo death).
  useEffect(() => {
    if (!dead || downed) return;
    const lost = [...owned.current].filter((w) => w !== "pistol");
    lost.forEach((w) => {
      owned.current.delete(w);
      ammo.current[w] = 0;
      if (!dropOrder.current.includes(w)) dropOrder.current.push(w);
    });
    ammo.current.pistol = Math.round((stats.current.extmag ? 220 : GUNS.pistol.ammo) * stats.current.ammoMul);
    equip("pistol");
  }, [dead, downed]); // eslint-disable-line react-hooks/exhaustive-deps



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
      // in an elevator car, E presses the floor button (instead of the next weapon)
      if (e.code === "KeyE" && accessActive() && pressCarButton()) return;
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

  /** an open spot right next to (x, z): hornet pack members land around their leader */
  const besides = (x: number, z: number) => {
    // close beside the leader first, then a little wider; never a blocked or stair-only spot
    for (let k = 0; k < 20; k++) {
      const w = k < 8 ? 2.4 : 7;
      const qx = x + (rand() - 0.5) * w;
      const qz = z + (rand() - 0.5) * w;
      if (!blocked(blocks, qx, qz, 0.5) && !raised(qx, qz)) return { x: qx, z: qz };
    }
    return spot(25, 45, true);
  };

  const spawnWave = (n: number) => {
    // every wave hands the sidearm a fresh magazine
    ammo.current.pistol = Math.round((stats.current.extmag ? 220 : GUNS.pistol.ammo) * stats.current.ammoMul);
    onAmmo(ammo.current[weapon.current]);
    syncInv();
    const extra = Math.max(0, playersRef.current - 1); // each extra player scales the round
    // arenas: Toby's fuller waves as the run goes (1.25x on wave 1, +0.10x every wave after).
    // The big real-scale maps keep their own tuned crowd (1.75x: enemies hide behind blocks).
    const waveMul = big ? 1.75 : 1.25 + 0.1 * (n - 1);
    const enemyMul = (1 + 0.6 * extra) * waveMul;
    const lootMul = 1 + 0.65 * extra;
    const spec: WaveSpec = WAVES[n - 1] ?? {};
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
    // arrival order: the boss first, then a shuffled mix, so the newer types turn up through
    // the wave instead of all at the end; hornets arrive as one pack of 3-5 from one spot
    const units: Kind[][] = roster.filter((k) => k !== "hornet" && k !== "boss").map((k) => [k]);
    const hornets = roster.filter((k) => k === "hornet");
    for (let h = 0; h < hornets.length; ) {
      const left = hornets.length - h;
      const size = left <= 5 ? left : 4;
      units.push(hornets.slice(h, h + size));
      h += size;
    }
    for (let u = units.length - 1; u > 0; u--) {
      const j = Math.floor(rand() * (u + 1));
      [units[u], units[j]] = [units[j]!, units[u]!];
    }
    const kinds: Kind[] = [];
    const leadOf: number[] = [];
    roster.filter((k) => k === "boss").forEach((k) => { kinds.push(k); leadOf.push(-1); });
    for (const unit of units) {
      const first = kinds.length;
      unit.forEach((k, m) => { kinds.push(k); leadOf.push(m === 0 ? -1 : first); });
    }
    kinds.length = Math.min(kinds.length, MAX_ENEMIES);
    waveTotal.current = Math.max(1, kinds.length); // the time of day follows how much is cleared
    const hpMul = 1 + 0.09 * (n - 1); // later rounds send sturdier enemies
    // Dry Gulch: the Iron Marshal rides in on his own train and steps off at the platform
    const bossTrain = western && kinds.includes("boss") ? callBossTrain(trainClock.t) : 0;

    // spread arrivals across the wave: a few right away, the rest trickle in
    let delay = 0;
    enemies.forEach((e, i) => {
      const kind = kinds[i];
      pending.current[i] = null;
      if (!kind) {
        e.alive = false;
        return;
      }
      const lead = leadOf[i] ?? -1;
      packLead.current[i] = lead;
      const lp = lead >= 0 ? pending.current[lead] : null;
      const p = lp ? besides(lp.x, lp.z) : kind === "boss" ? bossSpot() : spot(25, 45, true);
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
        vis: 0,
        st: 0,
        t1: 0,
        ax: undefined,
        az: undefined,
        side: undefined,
        plan: 0,
        shots: 0,
        stuck: 0,
        gd0: 99,
        detour: 0,
        shield: kind === "bulwark" ? Math.round(8 * hpMul) : 0,
        shieldMax: kind === "bulwark" ? Math.round(8 * hpMul) : 0,
        shieldT: 0,
        blockT: 0,
        hitT: 0,
        tgt: -1,
      });
      e.elite = 0;
      pending.current[i] = { x: p.x, z: p.z, t: MARK_TIME + delay + (kind === "boss" ? bossTrain : 0) };
      // a steady trickle; the city's bigger crowd trickles a little faster so waves don't drag.
      // A hornet pack lands together, a beat apart.
      const nextLead = leadOf[i + 1] ?? -1;
      delay += nextLead >= 0 ? 0.12 : i < 2 ? 0.4 : big ? 0.4 + rand() * 1.2 : 0.5 + rand() * 1.6;

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
    if (n >= 2 && n - lastHealWave.current >= healGap) {
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
    bulletBlocked(p.x, p.y, p.z) ??
    // the beach's ground decides shots itself (they fly over railings, stop on decks and the
    // sea); every other map: under the ground or into a solid cell
    // (alpine: solids have a height, so shots fly over walls and mountain slopes they clear)
    ((shotHits(p.x, p.y, p.z) ??
      (groundOwnsHits() ? groundHits(p.x, p.y, p.z) : p.y < groundY(p.x, p.z) || blocked(blocks, p.x, p.z, 0.05))) ||
    Math.abs(p.x) > HALF ||
    Math.abs(p.z) > HALF ||
    (big !== null && hitsTraffic(p.x, p.y, p.z)));
  // the local player's collision: interiors (lobby, car, stairwell) have their own walls
  const pBlocked = (x: number, z: number, r: number) => playerBlocked(x, z, r) ?? blocked(blocks, x, z, r);

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
      // touch drag look (right thumb)
      if (touchInput.lookX || touchInput.lookY) {
        look.current.yaw -= touchInput.lookX * 0.0032 * sensXRef.current;
        look.current.pitch = Math.max(-1.2, Math.min(1.2, look.current.pitch - touchInput.lookY * 0.0032 * sensYRef.current));
        touchInput.lookX = 0;
        touchInput.lookY = 0;
      }
    }
    cam.rotation.order = "YXZ";
    const kn = knock.current;
    kn.shake = Math.max(0, kn.shake - delta * 2.2);
    const roll = kn.shake > 0 ? Math.sin(state.clock.elapsedTime * 38) * 0.06 * kn.shake : 0;
    const kick = fxKick(); // per-weapon camera kick + explosion shake
    cam.rotation.set(look.current.pitch + roll * 0.4 + kick.pitch, look.current.yaw + kick.yaw, roll);

    if (gameOver || !locked) return;

    const n = netRef.current;
    const isH = isHostRef.current;
    const spectating = deadRef.current;

    // on-screen controls
    if (touchInput.ability) {
      touchInput.ability = false;
      abilFire.current = true;
    }
    // touch USE: the elevator car's floor button (E on a keyboard)
    if (touchInput.use) {
      touchInput.use = false;
      if (accessActive()) pressCarButton();
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
        * (overdrive.current > 0 ? 0.5 : 1);
    }

    // a step is allowed when nothing solid is there and it isn't a wall-steep climb (terrain)
    // (building access: interiors have their own walls, see pBlocked)
    // (already overlapping something, e.g. dropped onto a thin post: step out with a slimmer
    // body instead of being frozen in place)
    const overlapping = pBlocked(cam.position.x, cam.position.z, 0.4);
    const walkTo = (x: number, z: number) =>
      !pBlocked(x, z, overlapping ? 0.1 : 0.4) && (accPlayer.zone !== 0 || climbable(cam.position.x, cam.position.z, x, z));
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
    alpine.boss = wave.current === WAVES.length; // the alpine boss round brings a blizzard
    worldFx.hazard = slip > 0 || enemies.some((e) => e.alive && e.kind === "boss"); // the beach's marine layer
    const resp = slip > 0 ? Math.min(1, delta * (1.5 + (1 - slip) * 22)) : 1;
    const spd = SPEED * stats.current.speed
      * (stats.current.holster && weapon.current === "pistol" ? 1.15 : 1)
      * (overdrive.current > 0 ? 1.3 : 1)
      * groundSpeed(cam.position.x, cam.position.z) // deep snow off the paths
      * (downedRef.current ? 0.2 : 1); // DOWN: a slow crawl
    slide.current.x += (MOVE.x * spd - slide.current.x) * resp;
    slide.current.z += (MOVE.z * spd - slide.current.z) * resp;
    if (Math.abs(slide.current.x) > 0.001 || Math.abs(slide.current.z) > 0.001) {
      const nx = cam.position.x + slide.current.x * delta;
      const nz = cam.position.z + slide.current.z * delta;
      if (walkTo(nx, cam.position.z)) cam.position.x = nx; else slide.current.x = 0;
      if (walkTo(cam.position.x, nz)) cam.position.z = nz; else slide.current.z = 0;
    }
    // weather: blizzard gusts shove you downwind (not while you wait on a loading line)
    const onLoadingLine =
      !!alpineMap &&
      [alpineMap.alpine.ride.boardUp, alpineMap.alpine.ride.boardDown].some(
        ([bx, bz]) => Math.hypot(cam.position.x - bx, cam.position.z - bz) < 5,
      );
    if ((wind.x !== 0 || wind.z !== 0) && !onLoadingLine) {
      const wx = cam.position.x + wind.x * delta;
      const wz = cam.position.z + wind.z * delta;
      if (walkTo(wx, cam.position.z)) cam.position.x = wx;
      if (walkTo(cam.position.x, wz)) cam.position.z = wz;
    }

    // car bumps: velocity that decays quickly, sliding along walls instead of through them
    if (Math.abs(kn.x) > 0.01 || Math.abs(kn.z) > 0.01) {
      const steps = Math.ceil((Math.hypot(kn.x, kn.z) * delta) / 0.25);
      for (let st = 0; st < steps; st++) {
        const nx = cam.position.x + (kn.x * delta) / steps;
        const nz = cam.position.z + (kn.z * delta) / steps;
        if (walkTo(nx, cam.position.z)) cam.position.x = nx;
        else kn.x *= -0.2;
        if (walkTo(cam.position.x, nz)) cam.position.z = nz;
        else kn.z *= -0.2;
      }
      const decay = Math.exp(-delta * 6);
      kn.x *= decay;
      kn.z *= decay;
    }

    // enemies are solid: push the player back out of any body it walked into and let it slide
    // round. Walls win (an enemy can never shove you into a building). Every client resolves
    // its own player against the enemies it sees; fliers pass overhead; the phase dash goes
    // straight through ("shrug off every hit").
    const phasing = invuln.current > 0 && abilityRef.current === "dash";
    if (!spectating && !phasing) {
      for (let pass = 0; pass < 2; pass++) {
        for (const e of enemies) {
          if (!e.alive || FLYERS.has(e.kind)) continue;
          const r = (e.kind === "boss" && theme.boss.shape === "kraken" ? KRAKEN_R : STATS[e.kind].radius * (e.elite ? 1.6 : 1)) + PLAYER_R;
          const ox = cam.position.x - e.x;
          const oz = cam.position.z - e.z;
          const dd = ox * ox + oz * oz;
          if (dd >= r * r) continue;
          const dist = Math.sqrt(dd);
          // dead centre (e.g. it spawned on you): step out backwards
          const nx = dist > 1e-4 ? ox / dist : -FORWARD.x;
          const nz = dist > 1e-4 ? oz / dist : -FORWARD.z;
          const push = r - dist;
          const tx = cam.position.x + nx * push;
          const tz = cam.position.z + nz * push;
          if (!pBlocked(tx, cam.position.z, 0.4)) cam.position.x = tx;
          if (!pBlocked(cam.position.x, tz, 0.4)) cam.position.z = tz;
          // drop the velocity into the body so walking into it slides instead of bouncing
          const vn = slide.current.x * nx + slide.current.z * nz;
          if (vn < 0) {
            slide.current.x -= vn * nx;
            slide.current.z -= vn * nz;
          }
        }
      }
    }

    bobAmt.current += ((moving ? 1 : 0) - bobAmt.current) * Math.min(1, delta * 8);
    bob.current += delta * 9 * bobAmt.current;
    {
      // follow the ground; the beach eases up and down its stairs and bowls (snapping on big
      // jumps: respawn, a teleport), other maps follow it directly. Building access: doorways,
      // stairs, the car and the roof decide the floor under you
      const gy = accessActive()
        ? stepPlayer(cam.position, MOVE.x, MOVE.z, (x, z, r) => blocked(blocks, x, z, r), delta)
        : groundY(cam.position.x, cam.position.z);
      const dg = gy - camGround.current;
      camGround.current =
        !groundOwnsHits() || accPlayer.zone !== 0 || Math.abs(dg) > 3 ? gy : camGround.current + dg * Math.min(1, delta * 16);
    }
    // DOWN in co-op: the view drops to the ground (a crawl)
    cam.position.y = camGround.current + (downedRef.current ? 0.45 : EYE) + Math.sin(bob.current) * 0.03 * bobAmt.current;
    if (accessActive()) {
      // elevator cars (the host decides, guests follow the snapshot) and the auto doors
      const people = [{ x: cam.position.x, z: cam.position.z, az: spectating ? 0 : playerAz(), y: camGround.current, id: "me", press: accPlayer.press }];
      const now = performance.now();
      remotes.current.forEach((r) => {
        if (r.hp > 0 && now - r.last < 4000) people.push({ x: r.x, z: r.z, az: r.az ?? 0, y: r.ay ?? 0, id: r.id, press: r.ap ?? 0 });
      });
      stepCars(delta, people, isH);
      stepDoors(delta, people);
    }
    // in a car the floor counter sits where the ammo pills are: the HUD hides them (CSS)
    const inCarNow = accessActive() && accPlayer.inCar;
    if (inCarNow !== inCarHud) {
      inCarHud = inCarNow;
      if (typeof document !== "undefined") document.documentElement.classList.toggle("rs-incar", inCarNow);
    }
    // alpine chairlift: stand on a loading line to board; seated, the chair carries you
    if (alpineMap && spectating && ride.chair >= 0) leaveRide(cam, alpineMap.alpine); // died on the chair
    if (alpineMap && !spectating && stepRide(cam, alpineMap.alpine, delta, look.current, ridersTaken())) {
      slide.current.x = 0;
      slide.current.z = 0;
    }

    // minimap feed (the HUD reads it)
    if (big) {
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
          ...(accPlayer.zone !== 0 ? { az: playerAz(), ay: Math.round(accPlayer.y * 100) / 100, ap: accPlayer.press } : {}),
          ...(alpineMap ? { rc: ride.chair } : {}),
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
        const from = new THREE.Vector3(t.x, groundY(t.x, t.z) + 1.1, t.z);
        const tip = from.clone().addScaledVector(v, 0.85 / 30).setY(from.y - 0.2);
        const ts = fireInto(bullets.current, from, v, 0.4, 0.5, "#4fe3ff", 0.11, { knock: stats.current.knock });
        if (ts >= 0) fxShot(ts, bullets.current[ts]!, VK.TURRET, 0, tip);
        fxFired(VK.TURRET, 0, from, v.clone().normalize(), 0, 30, n, tip);
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
        strikeRing.current.position.set(strikeAt.current.x, groundY(strikeAt.current.x, strikeAt.current.z) + 0.08, strikeAt.current.z);
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
        strikeBeam.current.position.set(strikeAt.current.x, groundY(strikeAt.current.x, strikeAt.current.z) + 22, strikeAt.current.z);
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
          // rides the decaying knock velocity (~4 m, sliding along walls): an impulse on
          // `slide` was overwritten by the next frame's walk speed, so the dash never moved you
          knock.current.x += FORWARD.x * 26;
          knock.current.z += FORWARD.z * 26;
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
          // frozen solid on the host (guests send the freeze with the hit); the ice shows here at once
          near(8, (e, ei) => { e.iceUntil = performance.now() + 3500; hurtEnemy(e, 1, ei, 3.5, 0, 0, 0, 0, { freeze: 3.5 }); });
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
            const bx = tgt.e.x, bz = tgt.e.z, by = groundY(bx, bz) + 1.1;
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
        if (big && !pd.placed && pd.t <= MARK_TIME) {
          // late arrivals appear near wherever the squad is now, not where it was
          pd.placed = true;
          const lead = packLead.current[i]!;
          const lp = lead >= 0 ? pending.current[lead] : null;
          const le = lead >= 0 ? enemies[lead] : undefined;
          const q = lp ? besides(lp.x, lp.z)
            : le?.alive && le.kind === "hornet" ? besides(le.x, le.z)
            : enemies[i]!.kind === "boss" ? bossSpot()
            : enemies[i]!.kind === "sniper" ? spot(30, 55, true, sniperZone())
            : spot(25, 45, true);
          // (alpine: spot() only anchors on players standing in a zone, never riders)
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
      setWaveClock(wave.current, wave.current > WAVES.length ? 1 : 1 - remaining / waveTotal.current);
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
      // fx/fz: which way each player faces (the camera looks down -z at yaw 0); flankers use it
      // zn: building-access zone (0 street, 1 + b roof b, -1 inside a building: untargetable)
      type Target = { id: string | null; x: number; z: number; y: number; fx: number; fz: number; zn?: number; air?: boolean };
      const lf = { fx: -Math.sin(look.current.yaw), fz: -Math.cos(look.current.yaw) };
      const targets: Target[] = [];
      if (!spectating) targets.push({ id: null, x: cam.position.x, z: cam.position.z, y: cam.position.y, ...lf, zn: myZone(), air: ride.chair >= 0 });
      remotes.current.forEach((r) => {
        if (r.hp > 0 && now - r.last < 4000) {
          const ry = alpineMap && (r.rc ?? -1) >= 0 ? riderEye(alpineMap.alpine.lift, r.rc!).y : EYE + (r.ay ?? groundY(r.x, r.z));
          targets.push({ id: r.id, x: r.x, z: r.z, y: ry, fx: -Math.sin(r.yaw), fz: -Math.cos(r.yaw), zn: remoteZone(r), air: (r.rc ?? -1) >= 0 });
        }
      });
      if (targets.length === 0) targets.push({ id: null, x: cam.position.x, z: cam.position.z, y: cam.position.y, ...lf, zn: myZone() });
      const accOn = accessActive();

      const hurtTarget = (t: Target, dmg: number, kx = 0, kz = 0) => {
        if (t.id === null) {
          if ((kx || kz) && invuln.current <= 0) shove(kx, kz);
          takeHit(dmg);
        } else n?.sendTo(t.id, kx || kz ? { type: "hurt", dmg, kx, kz } : { type: "hurt", dmg });
      };
      const aiCtx: AICtx = {
        delta,
        time: state.clock.elapsedTime,
        blocks,
        solid,
        targets,
        enemies,
        rand,
        fieldFor: (t) => fields.current.get(navKey(t)),
        fineFor: (t) => fines.current.get(fineKey(t)),
        hurtTarget,
        shoot: (x, y, z, vx, vy, vz, life, dmg, size) =>
          fireInto(enemyBullets.current, TMP_A.set(x, y, z), TMP_B.set(vx, vy, vz), life, dmg, "", size),
        ords: ords.current,
        hornetCd: hornetCd.current,
        navOpen,
      };
      hornetCd.current.v -= delta;

      // flow field per target cell (cached)
      const used = new Set<number>();
      for (const t of targets) {
        const key = navKey(t);
        const [ni, nj] = navTarget(solid, t.x, t.z, blocks);
        used.add(key);
        if (!fields.current.has(key))
          fields.current.set(key, flowField(solid, ni, nj, big ? 70 : Infinity));
      }
      if (fields.current.size > 12) {
        fields.current.forEach((_, key) => { if (!used.has(key)) fields.current.delete(key); });
      }
      if (strictNav()) {
        const usedF = new Set<number>();
        for (const t of targets) {
          const key = fineKey(t);
          usedF.add(key);
          if (!fines.current.has(key)) fines.current.set(key, fineField(blocks, t.x, t.z));
        }
        if (fines.current.size > 12) fines.current.forEach((_, key) => { if (!usedF.has(key)) fines.current.delete(key); });
      }

      // the city is huge: enemies stranded far from every player get recycled nearby
      if (big) {
        recycleT.current -= delta;
        if (recycleT.current <= 0) {
          recycleT.current = 1;
          // building access zones (the alpine rule): when the last player has left a zone and
          // nobody is inside a building, its enemies re-enter out of sight where the players
          // are (a full roof keeps the rest waiting round the entrance); while anyone is inside
          // (riding the car, on the stairs) every enemy stays put
          const zp = accOn ? zonePlayers() : [];
          const aRiding = zp.some((p) => p.zn < 0);
          const aZones = new Set(zp.filter((p) => p.zn >= 0).map((p) => p.zn));
          if (accOn && aZones.size > 0 && !aRiding) {
            const list = [...aZones];
            for (const e of enemies) {
              if (!e.alive) continue;
              const ez = zoneOf(e.x, e.z);
              if (aZones.has(ez)) continue;
              const pick = list[Math.floor(rand() * list.length)]!;
              const q = e.kind === "boss" ? spot(25, 40, false, pick) : spot(25, 45, true, pick);
              if (zoneOf(q.x, q.z) === ez) continue; // no room up there: it waits where it is
              e.x = q.x;
              e.z = q.z;
              e.stuckFor = 0;
              delete e.lastX;
            }
          }
          // alpine zones: when the last player has left a zone (and nobody is on the lift),
          // its enemies re-enter out of sight in a zone that has players; otherwise every
          // enemy stays in its own zone
          // (with building access on, its zone rule above covers the alpine zones too)
          const zones = alpineMap && !accOn ? liveZones() : null;
          const anyRiding = !!alpineMap && (ride.chair >= 0 || [...remotes.current.values()].some((r) => (r.rc ?? -1) >= 0 && r.hp > 0));
          const zoneFor = (x: number, z: number) => {
            if (!zones || zones.size === 0) return undefined;
            const ez = alpineZone(x, z);
            return zones.has(ez) ? ez : [...zones][0];
          };
          if (zones && zones.size > 0 && !anyRiding) {
            for (const e of enemies) {
              if (!e.alive || zones.has(alpineZone(e.x, e.z))) continue;
              if (targets.some((t) => clearLine(blocks, t.x, t.z, e.x, e.z, 0.1))) continue;
              const q = spot(25, 45, true, zoneFor(e.x, e.z));
              e.x = q.x;
              e.z = q.z;
              e.stuckFor = 0;
            }
            pending.current.forEach((pd) => {
              if (pd?.placed && !zones.has(alpineZone(pd.x, pd.z))) {
                const q = spot(25, 45, true, zoneFor(pd.x, pd.z));
                pd.x = q.x;
                pd.z = q.z;
              }
            });
          }
          for (const e of enemies) {
            if (!e.alive) continue;
            if (accOn && !aZones.has(zoneOf(e.x, e.z))) {
              e.stuckFor = 0; // parked in an empty zone (someone is riding): not stuck
              continue;
            }
            let dmin = Infinity;
            for (const t of targets) dmin = Math.min(dmin, Math.hypot(t.x - e.x, t.z - e.z));
            // (the Iron Marshal gets a head start from the station before he's brought closer)
            if (zones && (anyRiding || !zones.has(alpineZone(e.x, e.z)))) {
              // nobody in its zone yet (or someone mid-ride): it stays put
            } else if (dmin > (e.kind === "boss" ? (western ? 160 : 70) : 80)) {
              const home = accOn ? zoneOf(e.x, e.z) : zoneFor(e.x, e.z); // stays in its own zone
              const onRoof = accOn && (home ?? 0) >= ROOF_KEY;
              const q = e.kind === "boss" ? spot(25, 40, false, home, onRoof) : spot(25, 45, true, home, onRoof);
              e.x = q.x;
              e.z = q.z;
              e.stuckFor = 0;
            } else {
              // wedged on a corner the coarse nav grid thinks is open: once it has made no
              // progress for 3 s and nobody can see it, it re-enters from another hidden spot
              // (the boss too: a wedged boss is a turret, and a sealed-in one never dies)
              const moved = e.lastX === undefined ? 99 : Math.hypot(e.x - e.lastX, e.z - e.lastZ!);
              // (a melee type standing still short of its target is stuck too, even in plain sight)
              const melee = e.kind === "drifter" || e.kind === "runner" || e.kind === "brute" || e.kind === "vanguard";
              e.stuckFor = moved < 0.5 && (dmin > 18 || (melee && dmin > 3)) ? (e.stuckFor ?? 0) + 1 : 0;
              const seen = targets.some((t) => clearLine(blocks, t.x, t.z, e.x, e.z, 0.1));
              if ((e.stuckFor >= 3 && !seen) || e.stuckFor >= 8) {
                const hidden = e.kind !== "boss";
                const q = accOn
                  ? spot(25, 45, hidden, zoneOf(e.x, e.z), zoneOf(e.x, e.z) >= ROOF_KEY)
                  : spot(25, 45, hidden, zoneFor(e.x, e.z));
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
      for (let ei = 0; ei < enemies.length; ei++) {
        const e = enemies[ei]!;
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
            if (e.hp <= 0) { killEnemy(e, ei, e.burnFrom ?? null, false); continue; }
          }
        }
        const st = STATS[e.kind];
        // nearest player (alpine: chase someone in your own zone if there is anyone; others are
        // unreachable. Building access: only players in this enemy's zone, a player on a roof or
        // inside a building can't be reached from the street, so it holds)
        let target: Target | null = null;
        let d = Infinity;
        const ez = accOn ? zoneOf(e.x, e.z) : alpineMap ? alpineZone(e.x, e.z) : 0;
        const same = alpineMap && !accOn ? targets.some((t) => alpineZone(t.x, t.z) === ez) : true;
        for (const t of targets) {
          if (accOn && (t.zn ?? 0) !== ez) continue;
          if (alpineMap && !accOn && same && alpineZone(t.x, t.z) !== ez) continue;
          const dd = Math.hypot(t.x - e.x, t.z - e.z) || 1;
          if (dd < d) { d = dd; target = t; }
        }
        if (!target) continue;
        const dx = target.x - e.x;
        const dz = target.z - e.z;
        // melee needs vertical proximity on every map: a player up on a deck, a rooftop or a
        // chairlift is out of reach from the ground below (shots and ordnance leave from each
        // enemy's own ground in enemyAI.ts). The beach's stairs keep its roomier 2.2 m.
        const vReach = groundOwnsHits() ? 2.2 : MELEE_DY;
        const inReach = !target.air && Math.abs(target.y - EYE - groundY(e.x, e.z)) < vReach;
        if (isNewKind(e.kind)) {
          stepNewKind(e, ei, target, inReach ? d : Math.max(d, 3.5), aiCtx); // enemyAI.ts
          continue;
        }
        e.yaw = Math.atan2(dx, dz); // face whoever this enemy is after (synced to guests)
        const dm = inReach ? d : Infinity;

        // route around obstacles: go straight if clear, else follow the flow field
        let tx = target.x;
        let tz = target.z;
        const ghost = e.kind === "specter"; // specters drift straight through cover
        if (!ghost && !clearLine(blocks, e.x, e.z, tx, tz, Math.min(st.radius, 0.8) * 0.9)) {
          const dist = fields.current.get(navKey(target));
          // at the field's own cell (the target is right there, e.g. against a railing) walk
          // straight at it instead of parking on the cell centre
          // close in: the fine field knows the 2 m corridors the nav grid can't see
          const ff = strictNav() ? fines.current.get(fineKey(target)) : undefined;
          const fs = ff ? fineStep(ff, e.x, e.z) : null;
          if (fs) {
            tx = fs.x;
            tz = fs.z;
          } else if (dist && dist[toNav(e.x) * solid.n + toNav(e.z)]! > 0) {
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
        if (e.kind === "boss" && d < (theme.boss.shape === "kraken" ? KRAKEN_R + 1.4 : 3)) dir = 0;
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
          if (spType === "desperado") dir = desperadoDir(e, d);
          // RIDGE RAIDER: carves in fast on skis, quicker still in a whiteout
          if (spType === "skier") { dir = d > 6 ? 1 : 0; spMul = 1.5 + alpine.blizzard * 0.5; }
          if (spType === "crawler") { dir = d > 1.3 ? 1 : 0; spMul = 1.45; }
        }
        if (e.swing > 0) dir = 0;
        const step = st.speed * spMul * (e.slow > 0 ? 0.5 : 1) * delta * dir
          * (groundOwnsHits() ? 0.5 + 0.5 * groundSpeed(e.x, e.z) : 1); // beach sand drags a little
        let nx = e.x + (mx / md) * step;
        let nz = e.z + (mz / md) * step;
        if (spType === "stalker" || spType === "shinobi" || spType === "skier" || spType === "crawler") {
          // flanking arcs / zig-zag dash-steps / a crab's sideways scuttle
          const now = performance.now() / 1000;
          const side = spType === "shinobi" ? Math.sign(Math.sin(now * 3.2 + (e.max ?? 1))) * 3.2
            : spType === "crawler" ? Math.sign(Math.sin(now * 1.9 + (e.max ?? 1) * 1.7)) * 3.8
            : Math.sin(now * 1.3 + (e.max ?? 1)) * 2.4;
          nx += (-dz / d) * side * delta * (e.slow > 0 ? 0.5 : 1);
          nz += (dx / d) * side * delta * (e.slow > 0 ? 0.5 : 1);
        }
        const r = Math.min(st.radius, 0.8);
        // ghosts drift through walls but never over ground no one could walk on (a cliff, the
        // mountain face under the chairlift, another zone, past a blockade)
        if (ghost) { if (ghostOK(nx, nz)) { e.x = nx; e.z = nz; } }
        else {
          // arenas: if anything ever ends up wedged inside cover, slide it back out (Toby). The
          // big maps have roofs and raised ground; they keep their own unstick below.
          if (!big && blocked(blocks, e.x, e.z, r)) {
            const out = pushOut(blocks, e.x, e.z, r);
            e.x = out.x;
            e.z = out.z;
          }
          const ox = e.x;
          const oz = e.z;
          // (and only steps it could walk: no hopping up a balcony edge or the tower's face)
          const can = (fx: number, fz: number, tx: number, tz: number) => !blocked(blocks, tx, tz, r) && climbable(fx, fz, tx, tz);
          if (can(e.x, e.z, nx, e.z)) e.x = nx;
          if (can(e.x, e.z, e.x, nz)) e.z = nz;
          // wedged on a thin prop (a bus shelter post, a bench) the nav grid can't see: slide
          // sideways round it instead of pushing into it forever
          const want = Math.hypot(nx - ox, nz - oz);
          if (want > 1e-4 && Math.hypot(e.x - ox, e.z - oz) < want * 0.2) {
            const px = -(nz - oz);
            const pz = nx - ox;
            const side = Math.sin(ei * 12.9898 + (performance.now() / 1500 | 0)) > 0 ? 1 : -1;
            for (const sgn of [side, -side]) {
              const sx = ox + px * sgn;
              const sz = oz + pz * sgn;
              if (can(ox, oz, sx, sz)) { e.x = sx; e.z = sz; break; }
            }
          }
        }

        if ((e.kind === "drifter" || e.kind === "runner") && dm < 1.3 && meleeCooldown.current <= 0) {
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
            // only onto open, walkable ground near a target standing on it (never under a rider)
            const onGround = Math.abs(target.y - EYE - groundY(bx, bz)) < MELEE_DY;
            const sameZone = !alpineMap || alpineZone(bx, bz) === alpineZone(e.x, e.z);
            if (onGround && sameZone && ghostOK(bx, bz) && !blocked(blocks, bx, bz, 0.6)) { e.x = bx; e.z = bz; }
          }
          if (dm < 1.6 && e.cooldown <= 0) {
            e.cooldown = 1.4;
            hurtTarget(target, st.dmg);
          }
        }
        if (e.kind === "brute" || e.kind === "boss" || e.kind === "vanguard") {
          const reach = e.kind === "boss" ? (theme.boss.shape === "kraken" ? KRAKEN_R + 2.2 : 3.6) : e.kind === "vanguard" ? 2.6 : 2.4;
          if (e.swing > 0) {
            const before = e.swing;
            e.swing -= delta;
            if (before > 0.2 && e.swing <= 0.2 && dm < reach) hurtTarget(target, st.dmg);
          } else if (dm < reach - 0.2 && e.cooldown <= 0) {
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
          if ((spType === "mite") && dm < 1.2 && e.cooldown <= 0) { e.cooldown = 1; hurtTarget(target, 1); }
          if (spType === "spore" && ready && d < 26) { e.shot = 3.2; aim(3, ENEMY_BULLET_SPEED * 0.7, 0, 1, 1, 5, 0.42); }
          if (spType === "pyre" && ready && d < 24) { e.shot = 3; aim(1.1, 22, 0, 1, 2, 2.5, 0.34); }
          if (spType === "leaper") {
            if ((e.aux ?? 0) > 0) {
              e.aux = (e.aux ?? 0) - delta;
              const lx = e.x + (dx / d) * 14 * delta;
              const lz = e.z + (dz / d) * 14 * delta;
              if (!blocked(blocks, lx, e.z, 0.6) && climbable(e.x, e.z, lx, e.z)) e.x = lx;
              if (!blocked(blocks, e.x, lz, 0.6) && climbable(e.x, e.z, e.x, lz)) e.z = lz;
              if (dm < 1.4) { e.aux = 0; hurtTarget(target, 2); }
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
          if (spType === "desperado") desperadoTick(e, d, delta, ready, aim);
          if (spType === "skier") {
            // a fan of thrown ice picks at mid range, a pole jab up close
            if (ready && d < 20 && d > 4) { e.shot = 2.3; aim(1.3, 17, 0.12, 3, 1, 2, 0.12); }
            if (dm < 1.7 && e.cooldown <= 0) { e.cooldown = 1.1; hurtTarget(target, 1); }
          }
          // TIDE CRAWLER: pincer snaps up close, a fan of sea-foam bubbles from mid range
          if (spType === "crawler" && dm < 1.5 && e.cooldown <= 0) { e.cooldown = 1.2; hurtTarget(target, 2); }
          if (spType === "crawler" && ready && d > 5 && d < 14) { e.shot = 3.4; aim(0.6, 11, 0.22, 5, 1, 1.3, 0.18); }
        }
        if (e.kind === "boss" && theme.boss.shape === "marshal") {
          // THE IRON MARSHAL: Gatling bursts and a lasso that drags you in
          const aimB = (y: number, spd: number, spread: number, nb: number, dmg: number, life = 3.5, size = 0.2) => {
            const from = new THREE.Vector3(e.x + (dz / d) * 1.4, y, e.z - (dx / d) * 1.4);
            for (let s = 0; s < nb; s++) {
              const a = Math.atan2(dx, dz) + (Math.random() - 0.5) * spread * 2;
              const vel = new THREE.Vector3(Math.sin(a), (target.y - y) / d, Math.cos(a)).normalize();
              fireInto(enemyBullets.current, from.clone().addScaledVector(vel, 1.8), vel.multiplyScalar(spd), life, dmg, "", size);
            }
          };
          // the lasso lands: 1 damage and a yank toward him (a shove, synced like any hit)
          marshalTick(e, inReach ? d : Math.max(d, 3.5), dx, dz, delta, aimB, (kx, kz) => hurtTarget(target, 1, kx, kz));
        } else if (e.kind === "boss") {
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
              if (dm < 3.2 && e.cooldown <= 0) { e.cooldown = 1.2; hurtTarget(target, 3); }
            } else if (e.aux <= -1.4) e.aux = d > 5 && d < 28 ? 5 + rand() * 3 : 1;
          }
          // THE KRAKEN RIG: every few seconds its tentacles sweep a ring of shots all round
          if (theme.boss.shape === "kraken") {
            krakenT.current -= delta;
            if (krakenT.current <= 0 && d < 34) {
              krakenT.current = 5;
              for (let s = 0; s < 14; s++) {
                const a = (s / 14) * Math.PI * 2 + rand();
                const vel = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
                fireInto(enemyBullets.current, new THREE.Vector3(e.x + vel.x * 2.6, 1.1 + groundY(e.x, e.z), e.z + vel.z * 2.6), vel.multiplyScalar(ENEMY_BULLET_SPEED * 0.8), 3.2, 1, "", 0.26);
              }
            }
          }
        }
      }

      // grenades and homing rockets
      stepOrds(aiCtx);

      // solid bodies. Enemies stay out of every player (melee attackers stop touching you, not
      // inside you), and push apart lightly so a crowd doesn't stack into one blob. Fliers pass
      // over everything. A spatial hash keeps the pair checks cheap with 110 enemies.
      const grid = sepGrid.current;
      if (grid.size > 3000) grid.clear(); // the crowd wanders the whole city: drop stale cells
      grid.forEach((cell) => (cell.length = 0));
      const CELL = 2.5;
      const keyOf = (x: number, z: number) => Math.floor((x + HALF) / CELL) * 4096 + Math.floor((z + HALF) / CELL);
      const bodyR = (e: Enemy) => (e.kind === "boss" && theme.boss.shape === "kraken" ? KRAKEN_R : STATS[e.kind].radius * (e.elite ? 1.6 : 1));
      for (let ei = 0; ei < enemies.length; ei++) {
        const e = enemies[ei]!;
        if (!e.alive || FLYERS.has(e.kind)) continue;
        const k = keyOf(e.x, e.z);
        let cell = grid.get(k);
        if (!cell) grid.set(k, (cell = []));
        cell.push(ei);
      }
      const nudge = (e: Enemy, px: number, pz: number) => {
        const rr = Math.min(STATS[e.kind].radius, 0.8);
        const ghost = e.kind === "specter";
        // (the crowd never pushes anyone up a step it couldn't walk: the tower face, a balcony edge)
        if (ghost ? ghostOK(e.x + px, e.z) : !blocked(blocks, e.x + px, e.z, rr) && climbable(e.x, e.z, e.x + px, e.z)) e.x += px;
        if (ghost ? ghostOK(e.x, e.z + pz) : !blocked(blocks, e.x, e.z + pz, rr) && climbable(e.x, e.z, e.x, e.z + pz)) e.z += pz;
      };
      for (let ei = 0; ei < enemies.length; ei++) {
        const a = enemies[ei]!;
        if (!a.alive || FLYERS.has(a.kind)) continue;
        const ra = bodyR(a);
        const ci = Math.floor((a.x + HALF) / CELL);
        const cj = Math.floor((a.z + HALF) / CELL);
        for (let di = -1; di <= 1; di++) {
          for (let dj = -1; dj <= 1; dj++) {
            const cell = grid.get((ci + di) * 4096 + cj + dj);
            if (!cell) continue;
            for (const oj of cell) {
              if (oj <= ei) continue;
              const b = enemies[oj]!;
              const rb = bodyR(b);
              const reach = (ra + rb) * 0.8; // light: a little overlap is fine
              const ox = b.x - a.x;
              const oz = b.z - a.z;
              const dd = ox * ox + oz * oz;
              if (dd >= reach * reach) continue;
              const dist = Math.sqrt(dd) || 0.01;
              const nx = dd > 1e-6 ? ox / dist : Math.cos(ei);
              const nz = dd > 1e-6 ? oz / dist : Math.sin(ei);
              // soft: resolve part of the overlap per frame; the bigger body gives less ground
              const push = Math.min(reach - dist, 0.5) * Math.min(1, delta * 10);
              const wa = (rb * rb) / (ra * ra + rb * rb);
              const bossA = a.kind === "boss" ? 0.1 : 1;
              const bossB = b.kind === "boss" ? 0.1 : 1;
              nudge(a, -nx * push * wa * bossA, -nz * push * wa * bossA);
              nudge(b, nx * push * (1 - wa) * bossB, nz * push * (1 - wa) * bossB);
            }
          }
        }
        // keep out of the players: at most touching
        for (const t of targets) {
          const r = ra + PLAYER_R;
          const ox = a.x - t.x;
          const oz = a.z - t.z;
          const dd = ox * ox + oz * oz;
          if (dd >= r * r) continue;
          const dist = Math.sqrt(dd) || 0.01;
          nudge(a, (ox / dist) * (r - dist), (oz / dist) * (r - dist));
        }
      }
      // fliers aren't solid, but they still hover at arm's length rather than inside your head
      for (const f of enemies) {
        if (!f.alive || !FLYERS.has(f.kind)) continue;
        for (const t of targets) {
          const r = STATS[f.kind].radius + PLAYER_R + 0.3;
          const ox = f.x - t.x;
          const oz = f.z - t.z;
          const dd = ox * ox + oz * oz;
          if (dd >= r * r) continue;
          const dist = Math.sqrt(dd) || 0.01;
          nudge(f, (ox / dist) * (r - dist), (oz / dist) * (r - dist));
        }
      }
    }

    // player bullets
    const burst = (b: Bullet, at: THREE.Vector3 = b.pos, skip = -1) => {
      const blastR = b.blast;
      if (b.blast > 0) {
        const r = b.blast;
        b.blast = 0;
        blastAt(at.x, at.y, at.z, r, b.damage * b.blastMul, b.vel.x, b.vel.z, skip);
      }
      if (b.cluster <= 0) return;
      const n2 = b.cluster;
      b.cluster = 0;
      fxBurst(b, blastR || undefined);
      for (let s = 0; s < n2; s++) {
        const a = (s / n2) * Math.PI * 2 + Math.random();
        const v = new THREE.Vector3(Math.sin(a), 0.1, Math.cos(a)).multiplyScalar(14);
        const fs = fireInto(bullets.current, b.pos, v, 0.45, Math.max(1, Math.round(b.damage / 2)), b.color, b.size * 0.45, { cluster: 0 });
        if (fs >= 0) fxShot(fs, bullets.current[fs]!, VK.FRAG);
      }
    };
    bullets.current.forEach((b, i) => {
      const m = bulletMeshes.current[i];
      if (b.active) {
        const px = b.pos.x;
        const pz = b.pos.z;
        BLAST_AT.copy(b.pos); // a shell that hits a wall explodes just in front of it
        b.pos.addScaledVector(b.vel, delta);
        b.life -= delta;
        const hitWall = outOfBounds(b.pos);
        if (hitWall && b.bounce > 0 && b.blast <= 0) {
          // bounce off whichever side it ran into
          b.bounce--;
          if (blocked(blocks, b.pos.x, pz, 0.05) || Math.abs(b.pos.x) > HALF) b.vel.x *= -1;
          else b.vel.z *= -1;
          b.pos.set(px, b.pos.y, pz);
          fxBounce(i);
        } else if (b.life <= 0 || hitWall) {
          burst(b, hitWall ? BLAST_AT : b.pos);
          fxDie(i, hitWall);
          b.active = false;
        } else {
          // a homing rocket can be shot down (the host has the final say in co-op)
          const ri = rocketAt(ords.current, b.pos.x, b.pos.y, b.pos.z);
          if (ri >= 0) {
            const o = ords.current[ri]!;
            o.on = false;
            if (isH) blast(ords.current, o.x, o.z, 0.8, o.y);
            else n?.broadcast({ type: "odhit", i: ri });
            fxDie(i, true);
            b.active = false;
            onStat("hit", 1);
          }
          for (let ei = 0; b.active && ei < enemies.length; ei++) {
            const e = enemies[ei]!;
            if (!e.alive) continue;
            // bulwark: the shield face stops shots from the front, including ones aimed past it
            if (e.kind === "bulwark" && shieldUp(e, isH)) {
              const fx = Math.sin(e.yaw ?? 0);
              const fz = Math.cos(e.yaw ?? 0);
              const rx = b.pos.x - e.x;
              const rz = b.pos.z - e.z;
              const fwd = rx * fx + rz * fz;
              const lat = rx * fz - rz * fx;
              if (fwd > 0.2 && fwd < 1.6 && Math.abs(lat) < 1.15 && b.pos.y - groundY(e.x, e.z) < 2.5 && shieldBlocks(e, b.vel.x, b.vel.z, true)) {
                if (isH) drainShield(e, b.damage);
                else n?.broadcast({ type: "shield", i: ei, dmg: b.damage });
                burst(b);
                fxDie(i, true); // the round sparks off the shield face
                b.active = false;
                break;
              }
            }
            const [lo, hi] = hitBand(e.kind);
            const by = b.pos.y - groundY(e.x, e.z); // height above the enemy's ground (alpine slopes)
            if (Math.hypot(b.pos.x - e.x, b.pos.z - e.z) < STATS[e.kind].radius + 0.2 && by < hi && by > lo) {
              if (b.blast > 0 && b.blastMul >= 1) {
                // BOOMER: the shell detonates on the robot; the blast does all the damage
                fxHit(i, b, e);
                burst(b);
                b.active = false;
                break;
              }
              // a vanguard's slab soaks most of a normal hit; piercing shots go right through it
              const dmg = e.kind === "vanguard" && b.pierce <= 0 ? Math.max(1, Math.round(b.damage * 0.34)) : b.damage;
              // executioner / shredder / bounty are judged on the host (it has the true health)
              hurtEnemy(e, dmg, ei, b.slow, b.burn, b.knock, b.vel.x, b.vel.z, {
                direct: true, shred: !!(b.mods & M_SHRED), exec: !!(b.mods & M_EXEC), bounty: !!(b.mods & M_BOUNTY),
              });
              fxHit(i, b, e);
              onStat("hit", 1);
              onStat("dmg", dmg);

              if (b.chain > 0) {
                let left = b.chain;
                for (let oi = 0; oi < enemies.length; oi++) {
                  const o = enemies[oi]!;
                  if (left <= 0) break;
                  if (!o.alive || o === e) continue;
                  if (Math.hypot(o.x - e.x, o.z - e.z) < 6) {
                    hurtEnemy(o, b.damage, oi);
                    fxChain(e, o);
                    left--;
                  }
                }
              }
              if (b.pierce > 0) b.pierce--;
              else {
                burst(b, b.pos, ei); // (FLAK's splash spares the robot it just hit directly)
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
          fxStyle(i, m, b); // per-weapon round (projectiles.tsx)
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
          const ac = encodeCars();
          const rn = encodeWeather();
          const od = packOrds(ords.current);
          n.broadcast({
            type: "snap", e, b, mk,
            tk: Math.round(waveStage(tod.wave, tod.progress) * 1000), // the host's time of day
            ...(od.length ? { od } : {}),
            ...(tr ? { tr } : {}),
            ...(al ? { al } : {}),
            ...(ac ? { ac } : {}),
            ...(rn !== null ? { rn } : {}),
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
    // the gun joins the transparent queue at the very end, after a depth clear (see below)
    v.traverse((o) => {
      if (o.renderOrder < 999) o.renderOrder = 1000;
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m && !Array.isArray(m) && !m.transparent) m.transparent = true;
      if (m && !Array.isArray(m)) addGunRim(m);
    });
    fxFrame(delta, cam, v, bullets.current, weapon.current); // combat effects, after the gun is posed
  });

  return (
    <>
      {/* time of day: sunset into night with the waves (timeOfDay.ts / TimeScene.tsx) */}
      <TimeDriver theme={theme} arena={ARENA} />
      <TimeLights ownSun={!!big} ownFog={!!alpineMap || isBeach(city)} />
      {!big && <SkyDome sunset={arenaSunsetSky(theme.name, theme.sky, ARENA_SUN.sunset)} night={arenaNight} />}
      {!alpineMap && (
        <NightStars
          radius={big ? 900 : 90}
          depth={big ? 200 : 20}
          count={big ? 3000 : 1500}
          factor={big ? 26 : 4}
        />
      )}
      {western ? (
        <WesternSun key="sun-western" />
      ) : alpineMap ? (
        <AlpineSun key="sun-alpine" />
      ) : isBeach(city) ? null : city ? (
        // city sun: shadow frustum follows the player, auto-off on slow devices
        <CitySun key="sun-city" />
      ) : null}
      {alpineMap ? (
        <AlpineScene layout={alpineMap} time={time} isHost={isHost} playing={locked && !gameOver} />
      ) : isBeach(city) ? (
        <BeachWorld city={city} seed={seed} time={time} link={traffic} look={look3} />
      ) : city ? (
        <>
          <CityScene city={city} time={time} isHost={isHost} />
          <CityTraffic city={trafficCity ?? city} seed={seed} time={time} link={traffic} />
          {gaps.length > 0 && <CityBlockades city={city} gaps={gaps} time={time} />}
        </>
      ) : western ? (
        <>
          <WesternScene layout={western} time={time} />
          <WesternTrain layout={western} seed={seed} time={time} link={traffic} />
          <WesternWeather layout={western} time={time} blocks={blocks} link={traffic} />
          {gaps.length > 0 && <WesternBlockades layout={western} gaps={gaps} time={time} />}
        </>
      ) : (
        <Level blocks={blocks} theme={theme} />
      )}
      {big && <AccessScene time={time} cityKey={big} />}
      <MapEvents
        theme={theme}
        city={city}
        enemies={enemies}
        net={net}
        isHost={isHost}
        wave={wave}
        playing={locked && !gameOver}
        matchSeed={seed}
        alive={aliveRef}
        hurtPlayer={(dmg, kx, kz, shake) => {
          if (deadRef.current) return;
          if (kx || kz) shove(kx, kz);
          knock.current.shake = Math.max(knock.current.shake, shake);
          if (dmg > 0) takeHit(dmg);
        }}
        movePlayer={(dx, dz) => {
          const p = camera.position;
          if (!blocked(blocks, p.x + dx, p.z, 0.4)) p.x += dx;
          if (!blocked(blocks, p.x, p.z + dz, 0.4)) p.z += dz;
        }}
        hurtEnemy={(i, dmg, kx, kz) => {
          const e = enemies[i];
          if (e?.alive) hurtEnemy(e, dmg, i, 0, 0, 3, kx, kz);
        }}
        spawnEnemies={(kindName, n, x, z) => {
          // extra enemies for an event (the train robbery's gang): free slots, the same set-up
          // as a wave's arrivals, a red X first; they count toward the wave
          if (!(KINDS as string[]).includes(kindName) || kindName === "boss") return 0;
          const kind = kindName as Kind;
          const hpMul = 1 + 0.09 * (Math.max(1, wave.current) - 1);
          let placed = 0;
          for (let i = 0; i < enemies.length && placed < n; i++) {
            const e = enemies[i]!;
            if (e.alive || pending.current[i]) continue;
            const p = besides(x, z);
            const hp = Math.max(1, Math.round(STATS[kind].hp * hpMul));
            Object.assign(e, {
              kind, x: p.x, z: p.z, hp, max: hp, shredUntil: 0, aux: 0, alive: false,
              cooldown: 1 + rand() * 2, swing: 0, flash: 0, shot: 2, slow: 0, burn: 0, burnTick: 0,
              vis: 0, st: 0, t1: 0, ax: undefined, az: undefined, side: undefined, plan: 0, shots: 0,
              stuck: 0, gd0: 99, detour: 0, shield: 0, shieldMax: 0, shieldT: 0, blockT: 0, hitT: 0, tgt: -1,
            });
            e.elite = 0;
            packLead.current[i] = -1;
            pending.current[i] = { x: p.x, z: p.z, t: MARK_TIME + placed * 0.3, placed: true };
            placed++;
          }
          waveTotal.current += placed;
          return placed;
        }}
      />
      {enemies.map((e, i) => (
        <EnemyMesh key={i} data={e} theme={theme} all={enemies} />
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
      <RemoteDeployables deps={remoteDeps} enemies={enemies} />
      <OrdnancePool ords={ords.current} guestTx={ordTx.current} guest={guestRef} />
      <mesh ref={barrierMesh} visible={false}>
        <sphereGeometry args={[1.6, 16, 12]} />
        <meshBasicMaterial color="#7cc6ff" wireframe transparent opacity={0.45} fog={false} />
      </mesh>
      <group ref={viewModel} scale={0.7}>
        {/* the gun draws last (end of the transparent queue) over a cleared depth buffer, so
            walls and railings never cut into it and the world's own effects still sort normally */}
        <mesh renderOrder={999} frustumCulled={false} onBeforeRender={(r) => r.clearDepth()}>
          <planeGeometry args={[0.001, 0.001]} />
          <meshBasicMaterial colorWrite={false} depthWrite={false} transparent />
        </mesh>
        <GunModel w={held} mods={stats.current} />
      </group>
      <RemotePlayers remotes={remotes} />
      <CombatFx />
      <Shards enemies={enemies} active={shardActive} magnet={magnetRef} onCollect={onShard} />
      <BulletPool meshes={bulletMeshes} color="#ff8a1f" size={0.14} />

      <BulletPool meshes={enemyBulletMeshes} color={theme.enemyBullet} size={0.18} shape="sphere" />
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
/** `?seed=N` pins the first arena's layout (testing: the same city on every load) */
function seedParam(): number | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("seed");
  const n = raw === null ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** is the HUD in its in-elevator-car state (the html element's rs-incar class)? */
let inCarHud = false;

const CITY_MAP = THEMES.findIndex((t) => t.blockShape === "city");
/** Every visit opens on the city unless `?map=` names another; the start-menu picker
 * switches for the rest of the visit. null = random. */
function initialMapChoice(): number | null {
  return forcedMapIndex() ?? CITY_MAP;
}

/** New arena seed. With a picked map the seed is nudged onto it, so a co-op host's
 * guests (who derive the map from the shared seed) land on the same one. Random only rolls
 * the offered maps (the four big ones) and, given the previous seed, never repeats its map
 * (Toby's anti-repeat roll). */
function newSeed(choice: number | null, prev?: number) {
  let s = Math.floor(Math.random() * 1e9);
  const prevMap = prev === undefined ? -1 : prev % THEMES.length;
  const pool = THEMES.filter((t) => offered(t)).length;
  const reroll = (v: number) =>
    !offered(THEMES[v % THEMES.length]!) || (pool > 1 && v % THEMES.length === prevMap);
  while (choice === null && reroll(s)) s = Math.floor(Math.random() * 1e9);
  return choice === null ? s : s - (s % THEMES.length) + choice;
}

export function Game() {
  const [mapChoice, setMapChoice] = useState(initialMapChoice);
  const mapChoiceRef = useRef(mapChoice);
  mapChoiceRef.current = mapChoice;
  const [seed, setSeed] = useState(() => seedParam() ?? newSeed(mapChoice));
  // time of day (timeOfDay.ts): AUTO follows the waves from sunset into night; N locks
  // this player's choice for the rest of the match. `?time=` overrides for testing.
  const time = useTodNearest();
  const timeMode = useTodMode();
  useEffect(() => {
    const init = initialMode();
    setTimeMode(init.mode);
    if (init.k !== null) pinTime(init.k);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "KeyN" || e.repeat) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      pinTime(null);
      const inMatch = phase.current.started && !phase.current.ended;
      toggleTimeLock(inMatch);
      if (inMatch) showToast(`${tod.mode === "night" ? "NIGHT" : "SUNSET"} LOCKED FOR THIS MATCH · AUTO OFF`);
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

  const [ammoLeft, setAmmoLeft] = useState(GUNS.pistol.ammo); // (not 0: the HUD showed "PISTOL 0" until the first wave)
  const [inv, setInv] = useState<{ w: Weapon; ammo: number }[]>([{ w: "pistol", ammo: 0 }]);
  const slotOf = (w: Weapon) => inv.findIndex((s) => s.w === w) + 1;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showWeapons, setShowWeapons] = useState(false);
  const [showEnemies, setShowEnemies] = useState(false);
  const [fov, setFov] = useState(75);
  const [sensX, setSensX] = useState(1);
  const [sensY, setSensY] = useState(1);
  const [healMsg, setHealMsg] = useState(0);
  const [musicVol, setMusicVol] = useState(0.5);
  const [sfxVol, setSfxVol] = useState(0.7);
  const [ambVol, setAmbVol] = useState(0.6);
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
  // co-op revive (revive.ts): the bleed-out ran out, so this player is dead until next wave
  const [bledOut, setBledOut] = useState(false);
  const pingWorld = useRef<PingWorld | null>(null);
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
    // pings and revives (Squad.tsx)
    if (handleSquadMsg(m, squadCb)) return;
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
    if (m.type === "pick") {
      const num = Number(m.num);
      const id = String(m.ability) as AbilityId;
      const c = String(m.cls) as ClassId;
      if (num >= 1 && ABILITIES[id]) setPicks((p) => (p[num] === id ? p : { ...p, [num]: id }));
      if (num >= 1 && CLASSES[c]) setClsPicks((p) => (p[num] === c ? p : { ...p, [num]: c }));
      return;
    }

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
      // a match is already running: the newcomer drops straight into it
      if (phase.current.started && !phase.current.ended) netHolder.current?.sendTo(id, { type: "begin" });
    }
    if (m.type === "left") {
      delete slots.current[String(m.from)];
      publishRoster();
    }
    if (m.type === "status" && m.banner) setHealth((h) => (h <= 0 ? derive(perksRef.current, clsRef.current).maxHp : h));
    if (m.type === "hurt") setHurtFlash((x) => x + 1);
    msgSink.current(m);
  };
  const squadCb = {
    isHost: () => !netHolder.current || netHolder.current.role === "host",
    numOf: (id: string) => (id === "host" ? 1 : (slots.current[id] ?? 2)),
    onRevived: () => {
      setHealth((h) => (h > 0 ? h : Math.max(1, Math.round(derive(perksRef.current).maxHp * REVIVE_HP))));
    },
    onBleedOut: () => setBledOut(true),
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
    setWeapon("pistol");
    setSeed((p) => newSeed(mapChoiceRef.current, p));
    if (document.pointerLockElement) document.exitPointerLock();
  };

  // host: end the run when the whole squad is down
  useEffect(() => {
    if (!net || net.role !== "host") return;
    const id = window.setInterval(() => {
      const list = [...remotes.current.values()].filter((r) => performance.now() - r.last < 5000);
      // nobody left standing, including nobody left at all (the teammates quit): the run ends
      if (phase.current.started && !phase.current.ended && healthRef.current <= 0 && list.every((r) => r.hp <= 0)) {
        net.broadcast({ type: "over" });
        setAllDown(true);
      }
    }, 800);
    return () => window.clearInterval(id);
  }, [net]);

  useEffect(() => {
    try {
      // (the key was "dustfield-settings" before the Scrapfall rename: carry those over)
      const v = JSON.parse(localStorage.getItem("scrapfall-settings") ?? localStorage.getItem("dustfield-settings") ?? "{}");
      if (typeof v.fov === "number") setFov(v.fov);
      if (typeof v.sensX === "number") setSensX(v.sensX);
      else if (typeof v.sens === "number") setSensX(v.sens);
      if (typeof v.sensY === "number") setSensY(v.sensY);
      else if (typeof v.sens === "number") setSensY(v.sens);
      if (typeof v.musicVol === "number") setMusicVol(v.musicVol);
      if (typeof v.sfxVol === "number") setSfxVol(v.sfxVol);
      if (typeof v.ambVol === "number") setAmbVol(v.ambVol);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    localStorage.setItem("scrapfall-settings", JSON.stringify({ fov, sensX, sensY, musicVol, sfxVol, ambVol }));
  }, [fov, sensX, sensY, musicVol, sfxVol, ambVol]);
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
  const { blocks, enemies, rand, theme, city, western, gaps } = useMemo(() => {
    // the map decides the layout, so pick the theme first (still purely from the shared seed)
    const forced = !coop && mapChoice !== null ? THEMES[mapChoice] : undefined;
    const theme = forced ?? THEMES[seed % THEMES.length]!;
    // co-op gets a bigger field. The big real-scale maps always build the full co-op map and
    // route on 4 m nav cells; solo fences the city and Dry Gulch into the middle 70% with
    // in-world blockades (soloBounds.ts) and the rest stays on screen as backdrop. The alpine
    // and beach maps seal their own solo squares inside their generators.
    const mode = layoutOf(theme);
    const sealed = mode === "city" || mode === "western";
    if (sealed) setArenaSize(CITY_COOP, 2, coop ? CITY_COOP / 2 : soloHalf(CITY_COOP / 2));
    else if (mode === "alpine") setArenaSize(ALPINE_SIZE, 2);
    else if (mode === "beach") setArenaSize(BEACH_SIZE, 2);
    else setArenaSize(coop ? COOP_ARENA : SOLO_ARENA);
    const level = generateLevel(seed, mode, !coop);
    const alp = level.city && "alpine" in level.city ? (level.city as AlpineLayout).alpine : null;
    // one ground API (terrain.ts): the alpine heightfield, the beach's decks and bowls, Dry
    // Gulch's boardwalks, balconies and riverbed, or flat
    setTerrain(
      alp ? alp.terrain : isBeach(level.city) ? beachTerrain(level.city) : level.western ? level.western.terrain : null,
    );
    // building access (elevators, stairwells, walkable roofs): Vice Heights today. Solo only
    // uses buildings inside the sealed square. (`?access=0` turns it off, for A/B testing)
    const accessOn = typeof window === "undefined" || new URLSearchParams(window.location.search).get("access") !== "0";
    installAccess(null); // (the adapters read the new map's ground, not the last map's roofs)
    // thin props (lamp posts, sign poles, benches, hydrants) block bodies on every big map;
    // the access adapters keep their doors clear of them
    const posts0 = mapPosts(level.city, level.western ?? null);
    const accessList0 = !accessOn
      ? null
      : mode === "city" && level.city
        ? cityAccess(level.city as CityLayout, coop ? null : PLAY_HALF)
        : isBeach(level.city)
          ? beachAccess(level.city, !coop, posts0)
          : alp && level.city
            ? (() => {
                // (chalet balconies wall off the ground under them: extra collision)
                const aa = alpineAccessFull(level.city as AlpineLayout, !coop, posts0);
                level.blocks = level.blocks.concat(aa.blocks);
                return aa.list;
              })()
            : null;
    installAccess(accessList0, level.western && accessOn ? westernMarkers(level.western) : []);
    resetAlpine(alp !== null, alp ? alp.lift : null);
    resetRide();
    // a door no adapter could keep clear (the church tower's lamp, a city hydrant): the prop
    // moves along the facade and stays solid (before the map's meshes are built from it)
    setPosts(null);
    movePropsFromDoors(
      level.city,
      level.western ?? null,
      (accessList0 ?? []).map((b) => b.spec.door),
      (x, z) => blocked(level.blocks, x, z, 0.35),
    );
    setPosts(mapPosts(level.city, level.western ?? null));
    let gaps: Gap[] = [];
    if (sealed && !coop) {
      gaps = findGaps(walkableFromBlocks(level.blocks, CITY_COOP / 2), PLAY_HALF, BLOCK);
      level.blocks = level.blocks.concat(sealGaps(gaps));
    }
    // the city generator keeps its own spawn plaza clear and every cell reachable;
    // trimming its blocks here would leave buildings without collision
    if (!level.city && !level.western) {
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
    return { blocks: level.blocks, enemies: list, rand: level.rand, theme, city: level.city, western: level.western, gaps };
  }, [seed, coop, mapChoice]);
  // the HUD radar for the big maps (solo dims everything beyond the blockades)
  const miniSrc = useMemo(
    () =>
      city && "alpine" in city
        ? alpineMinimap(city as AlpineLayout)
        : city
          ? cityMinimap(city, blocks, PLAY_HALF)
          : western
            ? westernMinimap(western, blocks, PLAY_HALF)
            : null,
    [city, western, blocks],
  );


  useEffect(() => {
    // pausing puts the whole squad on hold
    // closing the tab releases the pointer lock too: that must not pause everyone else
    let unloading = false;
    const onUnload = () => (unloading = true);
    window.addEventListener("beforeunload", onUnload);
    window.addEventListener("pagehide", onUnload);
    const pauseAll = () => {
      if (unloading || document.visibilityState === "hidden") return;
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
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("pagehide", onUnload);
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
  // co-op: out of health but still bleeding out, waiting for a revive
  const downed = multiplayer && dead && !bledOut;
  useEffect(() => {
    if (health > 0) setBledOut(false);
  }, [health]);
  const selfRef = useRef({ hp: 1, bledOut: false, playing: false });
  selfRef.current = { hp: health, bledOut, playing: started && locked && !(multiplayer ? allDown : dead) };
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
    const resuming = started && !ended;
    setPicking(false);
    if (!resuming) beginMatchTime();
    setStarted(true);
    if (ended && !fromNet) {
      run.current = { shots: 0, hits: 0, dmg: 0, taken: 0, shards: 0 };
      setSquad({});
      if (isHost) {
        const s = newSeed(mapChoiceRef.current, seed);
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
  const shopBreak = started && !ended && !dead && status.remaining === 0 && fought === status.wave && status.wave < WAVES.length;
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
  const reviveNearbyRef = useRef<() => boolean>(() => false);
  reviveNearbyRef.current = () =>
    [...remotes.current.values()].some(
      (r) => downTable.get(r.id)?.st === DOWN && Math.hypot(r.x - squadMe.x, r.z - squadMe.z) <= REVIVE_RANGE,
    );
  const patchRef = useRef<() => void>(() => {});
  patchRef.current = () => {
    if (!shopOpen) return;
    if (shards < PATCH_COST) { playSfx("deny"); return; }
    if (health >= maxHp) { playSfx("deny"); return; }
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
    if (id === "heal") { setHealth((h) => Math.min(maxHp, h + 5)); return; }
    setPerks((p) => ({ ...p, [id]: p[id] + 1 }));
    if (id === "maxhp") setHealth((h) => h + 2);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const i = SHOP_KEYS.indexOf(e.code);
      if (i >= 0) buyRef.current(i);
      // R is also "hold to revive": next to a downed teammate it revives instead of rerolling
      else if (e.code === "KeyR" && !e.repeat && !reviveNearbyRef.current()) rerollRef.current();
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

  // soundtrack: Toby's menu march plays on the menus (muffled); the map's track opens up in
  // combat, and the background soundscape plays (and pauses) with the match
  useEffect(() => { hookAudioUnlock(); }, []);
  const inCombat = started && locked && !ended;
  useEffect(() => {
    setMusicMenu(!inCombat);
    startMusic();
    setAmbienceActive(inCombat);
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

  useEffect(() => {
    const boss = status.wave === WAVES.length && !status.won;
    setMusicIntensity(boss);
    setMusicProgress(status.wave, WAVES.length);
    // the map's hazard (blizzard, dust storm, marine layer...) comes with the boss round
    setAmbienceHazard(boss);
  }, [status.wave, status.won]);
  useEffect(() => setMusicTheme(theme.name, layoutOf(theme)), [theme]);
  useEffect(() => setAmbienceScene(theme.name, layoutOf(theme), city ?? western), [theme, city, western]);
  useEffect(() => setAmbienceTime(time), [time]);
  useEffect(() => setVolumes(musicVol, sfxVol, ambVol), [musicVol, sfxVol, ambVol]);
  useEffect(() => () => stopMusic(), []);
  phase.current = { started, ended };
  // the time of day runs with the match; a new arena opens straight onto its wave-1 sunset
  useEffect(() => { tod.playing = started; }, [started]);
  useEffect(() => { resetMatchTime(); tod.snap = true; resetSquad(); setBledOut(false); }, [seed]);

  // HUD status lists
  const activeMods = PISTOL_MODS.filter((id) => perks[id] > 0);
  const activePerks = PERK_IDS.filter((id) => !PISTOL_MODS.includes(id) && id !== "heal" && perks[id] > 0)
    .map((id) => ({ id, label: perkBadge(id, perks[id]) }))
    .filter((p): p is { id: PerkId; label: string } => p.label !== null);



  return (
    <div ref={wrapRef} className="fixed inset-0 cursor-crosshair touch-none select-none overscroll-none">
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
          western={western}
          gaps={gaps}
          seed={seed}
          time={time}
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
          downed={downed}
          pingWorld={pingWorld}



          onWeapon={(w, picked) => {
            setWeapon(w);
            if (picked) setPickupMsg(true);
          }}
          onInv={setInv}

        />
        <SquadDriver
          net={net}
          remotes={remotes}
          self={selfRef}
          world={pingWorld}
          myNum={myNum}
          onRevived={squadCb.onRevived}
          onBleedOut={squadCb.onBleedOut}
        />
        <AmbienceListener />
      </Canvas>
      <HudOverlay remotes={remotes} active={started && locked && !ended} coop={multiplayer} numOf={squadCb.numOf} />

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
        {multiplayer && locked && !ended && (
          <div className={`space-y-1 text-right font-mono tracking-widest text-[#2b2118] ${touchUi ? "text-[10px]" : "text-xs"}`}>
            <div className="rounded bg-[#f3e6cf]/80 px-2 py-1">ROOM {net?.code} · {peerCount + 1} {peerCount === 0 ? "PLAYER" : "PLAYERS"}</div>
            {[...remotes.current.values()].map((r) => (
              <div key={r.id} className="flex items-center justify-end gap-2 rounded bg-[#f3e6cf]/80 px-2 py-1">
                <span style={{ color: r.color, WebkitTextStroke: "0.5px #2b2118" }}>■</span>
                <span className="opacity-70">{r.num === 1 ? "HOST" : `P${r.num}`}</span>
                {r.hp > 0 ? (
                  <span>
                    {/* (a class can lift max health past 10: Vanguard has 16) */}
                    {"♦".repeat(Math.max(0, Math.min(24, Math.round(r.hp))))}
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

        <div className={`absolute left-1/2 flex -translate-x-1/2 flex-wrap justify-center transition-opacity [.rs-incar_&]:opacity-0 ${touchUi ? "top-3 max-w-[calc(100vw-9rem)] gap-1.5" : "top-5 max-w-[calc(100vw-26rem)] gap-2"}`}>
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

        {/* in an elevator car: how to ride (world.ts pressCarButton) */}
        <div className="absolute left-1/2 bottom-24 hidden -translate-x-1/2 rounded-md bg-[#2b2118]/75 px-3 py-1 text-xs tracking-[0.3em] text-[#f3e6cf] [.rs-incar_&]:block">
          E · FLOOR BUTTON
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
        {locked && !ended && (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <div className="h-5 w-[2px] bg-[#2b2118]/70" />
            <div className="absolute left-1/2 top-1/2 h-[2px] w-5 -translate-x-1/2 -translate-y-1/2 bg-[#2b2118]/70" />
          </div>
        )}
        {miniSrc && started && !ended && (
          // phones: the fire / ability / ping buttons own the bottom-right corner and the co-op
          // list sits under the shards, so a smaller map sits just left of the buttons
          <div className={touchUi ? "absolute bottom-3 right-[13.5rem] origin-bottom-right scale-[0.55]" : "absolute bottom-5 right-5"}>
            <Minimap
              src={miniSrc}
              feed={mapFeed}
              enemies={enemies}
              remotes={remotes}
              myColor={colorFor(myNum)}
            />
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
          coop={multiplayer}
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
      {multiplayer && dead && !downed && !ended && locked && (
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

            {/* map: Tyler's four big maps + Random (themes.ts offered()); the host picks */}
            <p className="mt-4 text-[10px] tracking-[0.25em] opacity-50">{isHost ? "MAP" : "MAP · THE HOST PICKS"}</p>
            <div className="mt-2 grid grid-cols-5 gap-1">
              {([null, ...THEMES.flatMap((t, i) => (!offered(t) && mapChoice !== i ? [] : [i]))] as (number | null)[]).map((i) => {
                const on = isHost ? mapChoice === i : i === seed % THEMES.length;
                return (
                  <button
                    key={i ?? "random"}
                    onClick={() => pickMap(i)}
                    disabled={!isHost}
                    className={`pointer-events-auto rounded px-1 py-1.5 text-[10px] font-bold tracking-wider ${
                      on ? "bg-[#2b2118] text-[#f7eeda]" : "bg-[#2b2118]/10"
                    } ${isHost ? "" : "cursor-default"}`}
                  >
                    {i === null ? "RANDOM" : THEMES[i]!.name.toUpperCase()}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => { pinTime(null); cycleTimeMode(); }}
              title="AUTO: the match starts at sunset and darkens into night as the waves go on. N in a match locks your choice (auto off)."
              className="pointer-events-auto mt-2 w-full rounded bg-[#2b2118]/10 px-2 py-1.5 text-[10px] font-bold tracking-wider"
            >
              {timeMode === "auto"
                ? "TIME · AUTO (SUNSET INTO NIGHT)"
                : timeMode === "night"
                  ? "TIME · ☾ NIGHT (LOCKED)"
                  : "TIME · SUNSET (LOCKED)"}
            </button>

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
                  ? "Left thumb: drag to move · right thumb: drag to aim · hold FIRE to shoot · ABILITY button · USE for elevators · PING · hold REVIVE by a downed teammate · tap a gun to swap · pause button up top"
                  : "WASD to move · mouse or arrow keys to look · hold Space to shoot · F for your ability · 1-0 / Q E swap guns · E in an elevator car for the floor button · middle mouse or G to ping · hold R to revive a teammate · N locks night/sunset · P to pause"}
              </p>
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
              // best-in-squad badges need a squad (and something to be best at)
              if (rows.length > 1) {
                if (mine.dmg > 0 && rows.every((x) => mine.dmg >= x.dmg)) badges.push("HEAVY GUNNER");
                if (mine.shards > 0 && rows.every((x) => mine.shards >= x.shards)) badges.push("SCAVENGER");
                if (rows.every((x) => mine.taken <= x.taken)) badges.push("IRON WILL");
              }
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


            {paused && (
              <div className="w-full max-w-sm px-4">
                <StatSheet d={statsRef.current} cls={cls} />
                {(activeMods.length > 0 || activePerks.length > 0) && (
                  <div className="mt-3 text-left text-black">
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
                  onClick={() => { pinTime(null); cycleTimeMode(); }}
                  title="AUTO: the match starts at sunset and darkens into night as the waves go on. N in a match locks your choice (auto off)."
                  className={`pointer-events-auto mt-4 w-full rounded-md ${paused ? "block" : "hidden"} border border-[#2b2118]/30 px-3 py-1.5 text-xs font-semibold tracking-widest transition-transform hover:scale-[1.02]`}
                >
                  {timeMode === "auto"
                    ? "TIME · AUTO (SUNSET INTO NIGHT)"
                    : timeMode === "night"
                      ? "TIME · ☾ NIGHT (LOCKED)"
                      : "TIME · SUNSET (LOCKED)"}
                </button>
                {started && !ended && (
                  <div className="mt-1 text-[10px] tracking-wider opacity-50">
                    {timeMode === "auto" ? "N LOCKS YOUR LOOK FOR THIS MATCH (AUTO OFF)" : "LOCKED FOR THIS MATCH · CLICK FOR AUTO"}
                  </div>
                )}
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
                {!paused && <button
                  onClick={() => setShowEnemies(true)}
                  className="pointer-events-auto ml-4 mt-3 text-xs tracking-widest underline opacity-70 hover:opacity-100"
                >
                  ENEMIES
                </button>}
                {showWeapons && <WeaponsPanel onClose={() => setShowWeapons(false)} />}
                {showEnemies && <EnemiesPanel theme={theme} onClose={() => setShowEnemies(false)} />}
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
                    <label className="block">
                      AMBIENCE VOLUME · {Math.round(ambVol * 100)}%
                      <input type="range" min={0} max={1} step={0.05} value={ambVol}
                        onChange={(e) => setAmbVol(Number(e.target.value))}
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
                    SCRAPFALL · v{GAME_VERSION} · TS BUILD
                    <div className="mt-1 text-[9px] tracking-[0.2em] opacity-80">BASED ON TOBY&apos;S 1.0.2 · BIG MAPS BY TYLER</div>
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
        <div className="text-[9px] tracking-[0.2em]" style={{ color: CLASSES[cls].color }}>
          {CLASSES[cls].name}
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

// ---------------------------------------------------------------- enemy reference
const PANEL_KINDS = Object.keys(ENEMY_INFO).filter((k): k is Kind => (KINDS as string[]).includes(k));
const fakeEnemy = (kind: Kind, x = 0, z = 0): Enemy => ({
  kind, x, z, hp: 1, alive: true, cooldown: 0, swing: 0, flash: 0, shot: 0, slow: 0, burn: 0, burnTick: 0, yaw: 0, vis: 0,
});

function LookAt({ y, z }: { y: number; z: number }) {
  const { camera } = useThree();
  useEffect(() => camera.lookAt(0, y, z), [camera, y, z]);
  return null;
}

/** loops each newer type through idle, telegraph, attack and after, so the card shows its tell */
function TelegraphDemo({ list, still }: { list: Enemy[]; still?: boolean }) {
  useFrame(({ clock }) => {
    if (still) {
      // lineup: everyone at rest, shields raised, cloakers drawn solid so they can be seen
      for (const e of list) if (e.kind === "bulwark") e.vis = packVis(0, 0, 1);
      return;
    }
    const t = clock.elapsedTime % 4.2;
    const ph = t < 1.2 ? 0 : t < 2.8 ? 1 : t < 3.6 ? 2 : 3;
    const pr = ph === 1 ? (t - 1.2) / 1.6 : ph === 2 ? 1 : ph === 3 ? 1 - (t - 3.6) / 0.6 : 0;
    for (const e of list) {
      if (!isNewKind(e.kind)) continue;
      let ex = 0;
      if (e.kind === "sniper") ex = list.length > 1 ? 3 : 9;
      if (e.kind === "bulwark") ex = ph === 2 ? 3 : 1;
      if (e.kind === "cloaker") ex = ph === 0 ? 1 : ph === 1 ? 2 : 0;
      e.vis = packVis(ph, pr, ex);
    }
  });
  return null;
}

export function EnemiesPanel({ theme, onClose }: { theme: Theme; onClose: () => void }) {
  const [sel, setSel] = useState<Kind | "lineup">("lineup");
  const lineup = useMemo(() => {
    // the boss is huge: it stands in the middle of the back row
    const rest = PANEL_KINDS.filter((k) => !isNewKind(k) && k !== "boss");
    const old = [...rest.slice(0, 4), "boss" as Kind, ...rest.slice(4)];
    const fresh = PANEL_KINDS.filter((k) => isNewKind(k));
    return [
      ...old.map((k, i) => fakeEnemy(k, (i - (old.length - 1) / 2) * 2.5, -4.5)),
      ...fresh.map((k, i) => fakeEnemy(k, (i - (fresh.length - 1) / 2) * 2.2, 1.5)),
    ];
  }, []);
  const single = useMemo(() => (sel === "lineup" ? [] : [fakeEnemy(sel)]), [sel]);
  const list = sel === "lineup" ? lineup : single;
  const info = sel === "lineup" ? null : ENEMY_INFO[sel];
  const st = sel === "lineup" ? null : STATS[sel];
  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 font-mono text-[#f2ead6]">
      <div className="flex max-h-full w-full max-w-5xl flex-col gap-4 overflow-auto rounded-lg border border-[#b4653f] bg-[#2b2118] p-5 md:flex-row">
        <div className="grid grid-cols-2 gap-1 md:w-60 md:grid-cols-1">
          <button onClick={() => setSel("lineup")}
            className={`rounded px-3 py-1.5 text-left text-xs tracking-widest ${sel === "lineup" ? "bg-[#b4653f]" : "hover:bg-white/10"}`}>
            ALL · LINEUP
          </button>
          {PANEL_KINDS.map((k) => (
            <button key={k} onClick={() => setSel(k)}
              className={`rounded px-3 py-1 text-left text-xs tracking-widest ${sel === k ? "bg-[#b4653f]" : "hover:bg-white/10"}`}>
              <span style={{ color: ENEMY_INFO[k]!.accent }}>■</span> {k === "special" ? theme.special.name : ENEMY_INFO[k]!.name}
              <span className="float-right opacity-50">W{ENEMY_INFO[k]!.wave}</span>
            </button>
          ))}
        </div>
        <div className="flex-1">
          <div className={`${sel === "lineup" ? "h-[22rem]" : "h-64"} w-full overflow-hidden rounded bg-[#1a1410]`}>
            <Canvas key={sel === "lineup" ? "lineup" : "one"} camera={sel === "lineup" ? { position: [0, 6, 25], fov: 28 } : { position: [2.6, 2.4, 4.6], fov: 42 }}>
              <LookAt y={sel === "lineup" ? 0.5 : 0} z={sel === "lineup" ? -1.5 : 0} />
              <ambientLight intensity={0.9} />
              <hemisphereLight args={["#ffe7c4", "#3a3028", 0.6]} />
              <directionalLight position={[3, 6, 5]} intensity={1.6} />
              <TelegraphDemo list={list} still={sel === "lineup"} />
              {sel === "lineup" ? (
                <group position={[0, -1.4, 0]}>
                  {list.map((e) => <EnemyMesh key={e.kind} data={e} theme={theme} all={list} />)}
                </group>
              ) : (
                <Spin><group position={[0, -1.1, 0]}>{list.map((e) => <EnemyMesh key={e.kind} data={e} theme={theme} all={list} />)}</group></Spin>
              )}
            </Canvas>
          </div>
          {info && st ? (
            <>
              <h2 className="mt-3 text-2xl font-bold tracking-[0.3em]" style={{ color: info.accent }}>
                {sel === "special" ? theme.special.name : info.name}
              </h2>
              <p className="mt-2 text-sm opacity-90">{info.tactic}</p>
              <div className="mt-3 grid grid-cols-4 gap-2 text-[11px] tracking-widest opacity-80">
                <div>HEALTH<br /><b className="text-base">{sel === "boss" ? BOSS_HP : st.hp}</b></div>
                <div>SPEED<br /><b className="text-base">{st.speed} m/s</b></div>
                <div>WEAPON<br /><b className="text-xs">{info.weapon}</b></div>
                <div>FIRST WAVE<br /><b className="text-base">{info.wave}</b></div>
              </div>
            </>
          ) : (
            <div className="mt-3 space-y-1 text-[11px] tracking-wider">
              {[["BACK ROW", false], ["FRONT ROW", true]].map(([label, fresh]) => (
                <div key={String(label)}>
                  <span className="opacity-50">{label} · </span>
                  {lineup.map((e) => e.kind).filter((k) => isNewKind(k) === fresh).map((k, i) => (
                    <span key={k} style={{ color: ENEMY_INFO[k]!.accent }}>{i ? " · " : ""}{k === "special" ? theme.special.name : ENEMY_INFO[k]!.name}</span>
                  ))}
                </div>
              ))}
              <p className="pt-1 text-sm opacity-80">
                Every attack is telegraphed: watch for the glow, the laser, the lit lane or the red ring, then move.
              </p>
            </div>
          )}
          <button onClick={onClose} className="mt-4 rounded bg-[#b4653f] px-4 py-2 text-xs tracking-widest hover:opacity-90">CLOSE</button>
        </div>
      </div>
    </div>
  );
}
