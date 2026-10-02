// Scrapfall bridge: mounts the brother's big maps (copied unchanged) inside our game.
import { memo, useMemo, useRef } from "react";
import type { MapFeed, MinimapSource } from "./Minimap";
import * as THREE from "three";
import { NightStars, SkyDome, TimeDriver, TimeLights } from "./TimeScene";
import { ARENA_SUN } from "./lighting";
import { arenaSunsetSky } from "./sky";
import type { TrafficLink } from "./trafficCore";
import { worldLook } from "./lighting";
import { useTodNearest } from "./timeOfDay";
import { THEMES } from "./themes";
import { setArenaSize, generateLevelStaged, CITY_COOP, BEACH_SIZE, type Block, type LayoutMode } from "./level";
import { resetStaticCollision, staticBody, staticSupport, staticCollisionReady } from "./staticCollision";
import { setTerrain } from "./terrain";
import { configureEnvironment } from "./matchEnvironment";
import { isBeach } from "./beach/beachLayout";
import { beachTerrain } from "./beach/terrain";
import { mapPosts } from "./posts";
import { setPosts } from "./level";
import { ALPINE_SIZE, type AlpineLayout } from "./alpine/layout";
import { resetAlpine } from "./alpine/weather";
import { resetRide, ride, stepRide, leaveRide } from "./alpine/ride";
import { NUKE_SIZE, NUKE_SPAWN, nuketownMinimap } from "./nuketown/layout";
import { alpineMinimap, cityMinimap } from "./cityMinimap";
import { westernMinimap } from "./western/minimap";
import { PLAY_HALF } from "./level";
import { groundY } from "./terrain";
import type { Theme } from "./themes";
import type { CityLayout } from "./cityLayout";
import type { WesternLayout } from "./western/layout";
import { AlpineScene, AlpineSun } from "./alpine/Alpine";
import { BeachWorld } from "./beach/Beach";
import { CityScene, CitySun } from "./City";
import { WesternScene, WesternSun } from "./western/Western";
import { Nuketown } from "./nuketown/Nuketown";
import { nuketownStructures } from "./nuketown/layout";
import { MatchRain } from "./MatchRain";
import { Structures } from "./structures/Structures";
import { beachRooms, alpineRooms, cityRooms, cityOpenStructures } from "./structures/adapters";
import { installStructures, structureList, structureBody, structureFloor } from "./structures/world";
import { AlpineLife } from "./life/AlpineLife";
import { resetWheel, wheelRide, stepWheel, leaveWheel } from "./beach/wheelRide";
import { cityAccess } from "./access/cityAccess";
import { beachAccess } from "./access/beachAccess";
import { alpineAccessFull } from "./access/alpineAccess";
import { westernMarkers } from "./access/westernMarkers";
import { AccessScene } from "./access/AccessScene";
import { installAccess, playerBlocked, accessActive, stepPlayer, stepCars, stepDoors, pressCarButton, player as accPlayer } from "./access/world";
import { callBossTrain, trainClock } from "./western/trainSim";
import { westernBelfry } from "./western/belfry";
import { snugPlazaProps, movePropsFromDoors } from "./posts";
import { blocked, boundaryBlocked, setNavWalls, BLOCK } from "./level";
import { raised } from "./terrain";
import { findGaps, sealGaps, soloHalf, walkableFromBlocks, type Gap } from "./soloBounds";
import { WEED_COUNT, resetWeeds } from "./western/tumbleweedSim";
import { CityTraffic } from "./Traffic";
import { CityBlockades } from "./cityBlockades";
import { WesternTrain } from "./western/Train";
import { WesternRiders } from "./western/Riders";
import { Tumbleweeds } from "./western/Tumbleweeds";
import { WesternWeather } from "./western/Weather";
import { WesternBlockades } from "./western/Blockades";

export type BigMapId = "alpine" | "beach" | "city" | "western" | "nuketown";

export const BIG_MAPS: Record<BigMapId, { name: string; size: number }> = {
  alpine: { name: "WHITEOUT PASS", size: ALPINE_SIZE },
  beach: { name: "PACIFIC PIER", size: BEACH_SIZE },
  city: { name: "VICE HEIGHTS", size: CITY_COOP },
  western: { name: "DRY GULCH", size: CITY_COOP },
  nuketown: { name: "NUKETOWN", size: NUKE_SIZE },
};

export type BigMap = {
  id: BigMapId;
  seed: number;
  size: number;
  blocks: Block[];
  city: CityLayout | null;
  western: WesternLayout | null;
  alpine: AlpineLayout | null;
  gaps: Gap[];
  spawn: { x: number; z: number };
  theme: Theme;
};

const LAYOUT_THEME: Record<BigMapId, string> = {
  alpine: "Whiteout Pass", beach: "Pacific Pier", city: "Vice Heights", western: "Dry Gulch", nuketown: "Nuketown",
};

/** His ground height (hills, decks, boardwalks) for the active big map. */
export const bigGroundY = groundY;

/** His HUD radar painting for this map (browser only). */
export function bigMinimap(m: BigMap): MinimapSource | null {
  return m.alpine
    ? alpineMinimap(m.alpine)
    : m.city
      ? cityMinimap(m.city, m.blocks, PLAY_HALF)
      : m.western
        ? westernMinimap(m.western, m.blocks, PLAY_HALF)
        : m.id === "nuketown"
          ? nuketownMinimap()
          : null;
}

/** What his radar reads each frame (position, facing, pickups). */
export const bigFeed: { current: MapFeed } = { current: { x: 0, z: 0, yaw: 0, items: [] } };
export { Minimap as BigMinimap } from "./Minimap";

/** His Game.tsx map setup, step for step (arena, collision, layout, ground, rooms, lifts, props). */
export async function setupBigMap(id: BigMapId, seed: number, solo: boolean): Promise<BigMap> {
  const coop = !solo;
  const mode = id as LayoutMode;
  configureEnvironment(seed, !coop);
  const sealed = mode === "city" || mode === "western";
  if (sealed) setArenaSize(CITY_COOP, 2, coop ? CITY_COOP / 2 : soloHalf(CITY_COOP / 2));
  else if (mode === "alpine") setArenaSize(ALPINE_SIZE, 2);
  else if (mode === "beach") setArenaSize(BEACH_SIZE, 2);
  else setArenaSize(NUKE_SIZE, 1);
  resetStaticCollision();
  const level = await generateLevelStaged(seed, mode, !coop);
  const alp = level.city && "alpine" in level.city ? (level.city as AlpineLayout).alpine : null;
  setTerrain(alp ? alp.terrain : isBeach(level.city) ? beachTerrain(level.city) : level.western ? level.western.terrain : null);
  installStructures([]);
  installStructures(isBeach(level.city) ? beachRooms(level.city, PLAY_HALF) : []);
  const cityOpen = mode === "city" && level.city ? cityOpenStructures(level.city as CityLayout, PLAY_HALF) : [];
  if (cityOpen.length) installStructures(cityOpen);
  installAccess(null);
  if (mode === "nuketown") installStructures(nuketownStructures());
  const posts0 = mapPosts(level.city, level.western ?? null);
  const accessList0 =
    mode === "city" && level.city
      ? cityAccess(level.city as CityLayout, coop ? null : PLAY_HALF)
      : isBeach(level.city)
        ? beachAccess(level.city, !coop, posts0)
        : alp && level.city
          ? (() => {
              const aa = alpineAccessFull(level.city as AlpineLayout, !coop, posts0);
              level.blocks = level.blocks.concat(aa.blocks);
              return aa.list;
            })()
          : level.western
            ? westernBelfry()
            : null;
  if (alp && level.city) installStructures(alpineRooms(level.city as AlpineLayout, PLAY_HALF, accessList0 ?? []));
  if (mode === "city" && level.city) installStructures([...cityOpen, ...cityRooms(level.city as CityLayout, PLAY_HALF)]);
  installAccess(accessList0, level.western ? westernMarkers(level.western) : []);
  resetAlpine(alp !== null, alp ? alp.lift : null);
  resetRide();
  resetWheel(isBeach(level.city) ? level.city.beach.wheel : null);
  setPosts(null);
  if (mode === "city" && level.city)
    snugPlazaProps(level.city as CityLayout, (accessList0 ?? []).map((b) => b.spec.door));
  movePropsFromDoors(
    level.city,
    level.western ?? null,
    [...(accessList0 ?? []).map((b) => b.spec.door), ...structureList().flatMap((p) => p.doors)],
    (x, z) => blocked(level.blocks, x, z, 0.35),
  );
  setPosts(mapPosts(level.city, level.western ?? null));
  setNavWalls(level.western?.navWalls ?? null, level.western?.navDoors ?? null);
  let gaps: Gap[] = [];
  if (sealed && !coop) {
    gaps = findGaps(walkableFromBlocks(level.blocks, CITY_COOP / 2), PLAY_HALF, BLOCK);
    level.blocks = level.blocks.concat(sealGaps(gaps));
  }
  const weeds: { x: number; y: number; z: number }[] = [];
  if (level.western) {
    let v = seed ^ 0x74eeda;
    const random = () => {
      v = (Math.imul(v, 1664525) + 1013904223) | 0;
      return (v >>> 0) / 4294967296;
    };
    const origin = level.western.spawn;
    for (let tries = 0; tries < 3000 && weeds.length < WEED_COUNT; tries++) {
      const radius = weeds.length < 12 ? 8 + random() * 45 : 35 + random() * 160,
        angle = random() * Math.PI * 2;
      const x = origin.x + Math.cos(angle) * radius,
        z = origin.z + Math.sin(angle) * radius;
      if (
        boundaryBlocked(level.blocks, x, z, 0.6) ||
        blocked(level.blocks, x, z, 0.6) ||
        raised(x, z) ||
        weeds.some((p) => Math.hypot(p.x - x, p.z - z) < 3)
      )
        continue;
      weeds.push({ x, y: groundY(x, z), z });
    }
  }
  resetWeeds(seed, weeds);
  const alpLayout = alp ? (level.city as AlpineLayout) : null;
  return {
    id,
    seed,
    size: BIG_MAPS[id].size,
    blocks: level.blocks,
    city: alpLayout ? null : level.city,
    western: level.western ?? null,
    alpine: alpLayout,
    gaps,
    spawn: id === "nuketown" ? NUKE_SPAWN : (alpLayout ?? level.city ?? level.western)?.spawn ?? { x: 0, z: 0 },
    theme: THEMES.find((t) => t.name === LAYOUT_THEME[id]) ?? THEMES.find((t) => t.layout === id) ?? THEMES[0]!,
  };
}

const newLink = (): TrafficLink => ({
  active: false, px: 0, pz: 0, isHost: true, role: "solo", others: [], encode: null, decode: null,
  enemies: [], radiusOf: () => 0.6, isBig: () => false, hurtEnemy: null, hitPlayer: () => {},
});

/** Shared traffic/train/rider link: our Game fills it in every frame. */
export const bigLink: { current: TrafficLink } = { current: newLink() };

/** Chairlift, Ferris wheel, elevator cars and doors: returns true while a ride carries you. */
export function stepBigRides(
  map: BigMap,
  cam: { position: THREE.Vector3 },
  delta: number,
  look: { yaw: number; pitch: number },
  dead: boolean,
  playerNumber: number,
  coop: boolean,
  toast: (s: string) => void,
): boolean {
  if (accessActive()) {
    const people = [{ x: cam.position.x, z: cam.position.z, az: 0, y: cam.position.y - 1.6, id: "me", press: accPlayer.press }];
    stepCars(delta, people, true);
    stepDoors(delta, people);
  }
  if (map.alpine) {
    const a = map.alpine.alpine;
    if (dead && ride.chair >= 0) leaveRide(cam, a);
    const was = ride.chair >= 0;
    if (!dead && stepRide(cam as never, a, delta, look)) {
      if (!was) toast("CHAIRLIFT · ENJOY THE RIDE");
      return true;
    }
  }
  if (map.city && isBeach(map.city)) {
    const w = map.city.beach.wheel;
    const was = wheelRide.cabin >= 0;
    if (dead && was) leaveWheel(cam.position, w);
    else if (!dead && stepWheel(cam.position, w, delta, playerNumber, coop)) {
      if (!was) toast("FERRIS WHEEL · ENJOY THE FULL CIRCUIT");
      return true;
    }
  }
  return false;
}

/** E in an elevator car: press the other floor's button. */
export const bigPressUse = () => accessActive() && pressCarButton();
export const bigInCar = () => accessActive() && accPlayer.inCar;

/** Boss wave on Dry Gulch: the Iron Marshal's train rolls in. */
export const bigBossTrain = (map: BigMap) => (map.western ? callBossTrain(trainClock.t) : 0);

/** His floor rule with lifts, stairwells and roofs (stepPlayer can move you through doors). */
export function bigStepFloor(blocks: Block[], pos: { x: number; z: number }, vx: number, vz: number, prevFeet: number, dt: number): number {
  const room = structureFloor(pos.x, pos.z, prevFeet);
  if (room) return room.y;
  let gy = accessActive() ? stepPlayer(pos, vx, vz, (x, z, r) => blocked(blocks, x, z, r), dt) : groundY(pos.x, pos.z);
  if (staticCollisionReady() && !accPlayer.inCar && accPlayer.zone !== 1 && ride.chair < 0 && wheelRide.cabin < 0) {
    const bound = gy <= prevFeet + 0.24 ? gy : Math.min(gy, prevFeet);
    gy = staticSupport(pos.x, pos.z, prevFeet, bound, 0.22) ?? gy;
  }
  return gy;
}

/** His match lighting, sky, fog, rooms and lifts around the map, as his Game.tsx mounts them. */
export const BigMapScene = memo(function BigMapScene({ map, playing, isHost = true }: { map: BigMap; playing: boolean; isHost?: boolean }) {
  const big = map.id === "city" || map.id === "western" || map.id === "alpine" || map.id === "beach";
  const night = useMemo(() => new THREE.Color(worldLook(map.theme, "night", map.size).sky), [map]);
  const time = useTodNearest();
  return (
    <>
      <Structures seed={map.seed} />
      <TimeDriver theme={map.theme} arena={map.size} />
      <TimeLights ownSun={big} ownFog={map.id === "alpine" || map.id === "beach"} />
      {!big && <SkyDome sunset={arenaSunsetSky(map.theme.name, map.theme.sky, ARENA_SUN.sunset)} night={night} />}
      {map.id !== "alpine" && (
        <NightStars radius={big ? 900 : 90} depth={big ? 200 : 20} count={big ? 3000 : 1500} factor={big ? 26 : 4} />
      )}
      <MapBody map={map} playing={playing} isHost={isHost} time={time} />
      {big && <AccessScene time={time} cityKey={map.id} />}
    </>
  );
});

function MapBody({ map, playing, isHost, time }: { map: BigMap; playing: boolean; isHost: boolean; time: ReturnType<typeof useTodNearest> }) {
  const link = bigLink;
  link.current.isHost = isHost;
  const { seed, gaps } = map;
  switch (map.id) {
    case "alpine":
      return (
        <>
          <AlpineSun />
          <AlpineScene key={seed} layout={map.alpine!} time={time} isHost={isHost} playing={playing} />
          <AlpineLife layout={map.alpine!} link={link} />
        </>
      );
    case "beach":
      return (
        <>
          <BeachWorld key={`beach-${seed}`} city={map.city as never} seed={seed} time={time} link={link} look={worldLook(map.theme, time, map.size)} />
          <MatchRain key={`rain-${seed}`} />
        </>
      );
    case "city":
      return (
        <>
          <CitySun />
          <CityScene city={map.city!} time={time} isHost={isHost} />
          <CityTraffic city={map.city!} seed={seed} time={time} link={link} />
          {gaps.length > 0 && <CityBlockades city={map.city!} gaps={gaps} time={time} />}
        </>
      );
    case "western":
      return (
        <>
          <WesternSun />
          <WesternScene layout={map.western!} time={time} />
          <MatchRain key={seed} western={map.western!} />
          <WesternTrain layout={map.western!} seed={seed} time={time} link={link} />
          <WesternRiders layout={map.western!} seed={seed} link={link} />
          <Tumbleweeds />
          <WesternWeather layout={map.western!} time={time} blocks={map.blocks} link={link} />
          {gaps.length > 0 && <WesternBlockades layout={map.western!} gaps={gaps} time={time} />}
        </>
      );
    case "nuketown":
      return <Nuketown seed={seed} />;
  }
}

/** His player wall rule (rooms, lifts, walls, props) for our movement. */
export function bigPlayerBlocked(blocks: Block[], x: number, z: number, r: number, feet: number, airborne: boolean): boolean {
  if (staticCollisionReady()) {
    if (boundaryBlocked(blocks, x, z, r)) return true;
    const interior = playerBlocked(x, z, r, feet);
    if (interior !== undefined) return interior;
    return structureBody(x, z, r, feet) ?? staticBody(x, z, r, feet, 1.8, airborne ? 0 : 0.2);
  }
  return structureBody(x, z, r, feet) ?? playerBlocked(x, z, r) ?? blocked(blocks, x, z, r);
}

/** His floor rule: room floors, decks and boardwalks, else the ground. */
export function bigFloorY(x: number, z: number, prevFeet: number): number {
  const base = groundY(x, z);
  const room = structureFloor(x, z, prevFeet);
  if (room) return room.y;
  if (!staticCollisionReady()) return base;
  return staticSupport(x, z, prevFeet, base, 0.55) ?? base;
}
