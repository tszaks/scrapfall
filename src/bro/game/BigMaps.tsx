// Scrapfall bridge: mounts the brother's big maps (copied unchanged) inside our game.
import { memo, useMemo, useRef } from "react";
import * as THREE from "three";
import { NightStars, SkyDome, TimeDriver, TimeLights } from "./TimeScene";
import { ARENA_SUN } from "./lighting";
import { arenaSunsetSky } from "./sky";
import type { TrafficLink } from "./trafficCore";
import { worldLook } from "./lighting";
import { useTodNearest } from "./timeOfDay";
import { THEMES } from "./themes";
import { setArenaSize, generateLevel, CITY_COOP, BEACH_SIZE, type Block, type LayoutMode } from "./level";
import { resetStaticCollision } from "./staticCollision";
import { setTerrain } from "./terrain";
import { configureEnvironment } from "./matchEnvironment";
import { isBeach } from "./beach/beachLayout";
import { beachTerrain } from "./beach/terrain";
import { mapPosts } from "./posts";
import { setPosts } from "./level";
import { ALPINE_SIZE, type AlpineLayout } from "./alpine/layout";
import { resetAlpine } from "./alpine/weather";
import { resetRide } from "./alpine/ride";
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
  spawn: { x: number; z: number };
  theme: Theme;
};

const LAYOUT_THEME: Record<BigMapId, string> = {
  alpine: "Whiteout Pass", beach: "Pacific Pier", city: "Vice Heights", western: "Dry Gulch", nuketown: "Nuketown",
};

/** His ground height (hills, decks, boardwalks) for the active big map. */
export const bigGroundY = groundY;

/** His HUD radar painting for this map (browser only). */
export function bigMinimap(m: BigMap): { base: HTMLCanvasElement; half: number } | null {
  const src = m.alpine
    ? alpineMinimap(m.alpine)
    : m.city
      ? cityMinimap(m.city, m.blocks, PLAY_HALF)
      : m.western
        ? westernMinimap(m.western, m.blocks, PLAY_HALF)
        : m.id === "nuketown"
          ? nuketownMinimap()
          : null;
  return src ? { base: src.base, half: src.half } : null;
}

/** Same setup order as his Game.tsx: arena size, collision reset, layout, ground, props. */
export function setupBigMap(id: BigMapId, seed: number, solo: boolean): BigMap {
  const size = BIG_MAPS[id].size;
  configureEnvironment(seed, false);
  setArenaSize(size, id === "nuketown" ? 1 : 2);
  resetStaticCollision();
  const level = generateLevel(seed, id as LayoutMode, solo);
  const alp = level.city && "alpine" in level.city ? (level.city as unknown as AlpineLayout) : null;
  setTerrain(
    alp
      ? (alp as unknown as { alpine: { terrain: Parameters<typeof setTerrain>[0] } }).alpine.terrain
      : isBeach(level.city)
        ? beachTerrain(level.city)
        : level.western
          ? level.western.terrain
          : null,
  );
  resetAlpine(alp !== null, alp ? (alp as unknown as { alpine: { lift: never } }).alpine.lift : null);
  resetRide();
  setPosts(null);
  setPosts(mapPosts(level.city, level.western ?? null));
  return {
    id,
    seed,
    size,
    blocks: level.blocks,
    city: alp ? null : level.city,
    western: level.western ?? null,
    alpine: alp,
    spawn: id === "nuketown" ? NUKE_SPAWN : (alp ?? level.city ?? level.western)?.spawn ?? { x: 0, z: 0 },
    theme: THEMES.find((t) => t.name === LAYOUT_THEME[id]) ?? THEMES.find((t) => t.layout === id) ?? THEMES[0]!,
  };
}

/** His match lighting, sky and fog around the map, as his Game.tsx mounts them. */
export const BigMapScene = memo(function BigMapScene({ map, playing }: { map: BigMap; playing: boolean }) {
  const big = map.id === "city" || map.id === "western" || map.id === "alpine" || map.id === "beach";
  const night = useMemo(() => new THREE.Color(worldLook(map.theme, "night", map.size).sky), [map]);
  return (
    <>
      <TimeDriver theme={map.theme} arena={map.size} />
      <TimeLights ownSun={big} ownFog={map.id === "alpine" || map.id === "beach"} />
      {!big && <SkyDome sunset={arenaSunsetSky(map.theme.name, map.theme.sky, ARENA_SUN.sunset)} night={night} />}
      {map.id !== "alpine" && (
        <NightStars radius={big ? 900 : 90} depth={big ? 200 : 20} count={big ? 3000 : 1500} factor={big ? 26 : 4} />
      )}
      <MapBody map={map} playing={playing} />
    </>
  );
});

function MapBody({ map, playing }: { map: BigMap; playing: boolean }) {
  switch (map.id) {
    case "alpine":
      return (
        <>
          <AlpineSun />
          <AlpineScene key={map.seed} layout={map.alpine!} isHost playing={playing} />
        </>
      );
    case "beach":
      return <Beach map={map} />;
    case "city":
      return (
        <>
          <CitySun />
          <CityScene city={map.city!} isHost />
        </>
      );
    case "western":
      return (
        <>
          <WesternSun />
          <WesternScene layout={map.western!} />
        </>
      );
    case "nuketown":
      return <Nuketown seed={map.seed} />;
  }
}

function Beach({ map }: { map: BigMap }) {
  const time = useTodNearest();
  const link = useRef<TrafficLink>({
    active: false, px: 0, pz: 0, isHost: true, role: "solo", others: [], encode: null, decode: null,
    enemies: [], radiusOf: () => 0.6, isBig: () => false, hurtEnemy: null, hitPlayer: () => {},
  });
  const theme = THEMES.find((t) => t.layout === "beach") ?? THEMES[0]!;
  return <BeachWorld key={map.seed} city={map.city as never} seed={map.seed} time={time} link={link} look={worldLook(theme, time, map.size)} />;
}
