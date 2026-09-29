// Scrapfall bridge: mounts the brother's big maps (copied unchanged) inside our game.
import { memo, useRef } from "react";
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
import { NUKE_SIZE } from "./nuketown/layout";
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
};

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
  };
}

export const BigMapScene = memo(function BigMapScene({ map, playing }: { map: BigMap; playing: boolean }) {
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
});

function Beach({ map }: { map: BigMap }) {
  const time = useTodNearest();
  const link = useRef<TrafficLink>({
    active: false, px: 0, pz: 0, isHost: true, role: "solo", others: [], encode: null, decode: null,
    enemies: [], radiusOf: () => 0.6, isBig: () => false, hurtEnemy: null, hitPlayer: () => {},
  });
  const theme = THEMES.find((t) => t.blockShape === "beach") ?? THEMES[0]!;
  return <BeachWorld key={map.seed} city={map.city as never} seed={map.seed} time={time} link={link} look={worldLook(theme, time, map.size)} />;
}
