import { prepareScans } from "./environment/scannedSurface";
// The world build, staged: the same steps the Game memo used to run synchronously,
// now an async pipeline that returns control to the event loop between phases and
// pumps the map generators as coroutines (they `yield` at safe points — see
// slice.ts). The loading veil covers the screen while this runs; menus stay
// responsive because no task here is longer than a few dozen ms.
import {
  BLOCK,
  blocked,
  boundaryBlocked,
  generateLevelStaged,
  PLAY_HALF,
  setArenaSize,
  setNavWalls,
  setPosts,
  CITY_COOP,
  BEACH_SIZE,
  SOLO_ARENA,
  COOP_ARENA,
  type Block,
} from "./level";
import { configureEnvironment } from "./matchEnvironment";
import { prepareStaticSurfaces, resetStaticCollision } from "./staticCollision";
import { installStructures, structureList } from "./structures/world";
import { installAccess } from "./access/world";
import type { AccessBuilding } from "./access/layout";
import { setTerrain, groundY, raised } from "./terrain";
import { findGaps, sealGaps, soloHalf, walkableFromBlocks, type Gap } from "./soloBounds";
import { mapPosts, movePropsFromDoors, snugPlazaProps } from "./posts";
import { WEED_COUNT, resetWeeds } from "./western/tumbleweedSim";
import { resetAlpine } from "./alpine/weather";
import { resetRide } from "./alpine/ride";
import { resetWheel } from "./beach/wheelRide";
import { yieldControl } from "./slice";
import { playableTheme, layoutOf, type Theme } from "./themes";
import type { CityLayout } from "./cityLayout";
import type { BeachLayout } from "./beach/beachLayout";
import type { WesternLayout } from "./western/layout";
import type { AlpineLayout } from "./alpine/layout";

export type BuiltWorld = {
  blocks: Block[];
  rand: () => number;
  theme: Theme;
  city: CityLayout | null;
  western: WesternLayout | null;
  gaps: Gap[];
};

/**
 * Build a world for `seed`/`coop`/`mapChoice`, pausing between stages so the main
 * thread never holds a task long enough to drop input. `cancelled()` aborts the
 * build early — a stale build must stop mutating the shared collision/terrain
 * globals before a newer build starts writing them.
 */
export async function buildWorld(
  seed: number,
  coop: boolean,
  mapChoice: number | null,
  cancelled: () => boolean,
): Promise<BuiltWorld | null> {
  const mark = (s: string) =>
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("debug") === "1" &&
    console.info(`[wb] ${s} @${Math.round(performance.now())}`);
  mark("start");
  if (cancelled()) return null;
  // the map decides the layout, so pick the theme first (still purely from the shared seed)
  const theme = playableTheme(seed, coop, mapChoice);
  // co-op gets a bigger field. The big real-scale maps always build the full co-op map and
  // route on 4 m nav cells; solo fences the city and Dry Gulch into the middle 70% with
  // in-world blockades (soloBounds.ts) and the rest stays on screen as backdrop. The alpine
  // and beach maps seal their own solo squares inside their generators.
  const mode = layoutOf(theme);
  await prepareScans(mode);
  if (cancelled()) return null;
  configureEnvironment(seed, !coop);
  const sealed = mode === "city" || mode === "western";
  if (sealed) setArenaSize(CITY_COOP, 2, coop ? CITY_COOP / 2 : soloHalf(CITY_COOP / 2));
  else if (mode === "alpine") setArenaSize((await import("./alpine/layout")).ALPINE_SIZE, 2);
  else if (mode === "beach") setArenaSize(BEACH_SIZE, 2);
  else if (import.meta.env.DEV && mode === "nuketown") setArenaSize((await import("./nuketown/layout")).NUKE_SIZE, 1);
  else setArenaSize(coop ? COOP_ARENA : SOLO_ARENA);
  resetStaticCollision();
  await yieldControl();
  if (cancelled()) return null;
  mark("gen");
  const level = await generateLevelStaged(seed, mode, !coop);
  mark("gen done");
  if (cancelled()) return null;
  const isB = level.city !== null && "beach" in level.city;
  const alp = level.city && "alpine" in level.city ? (level.city as AlpineLayout).alpine : null;
  // one ground API (terrain.ts): the alpine heightfield, the beach's decks and bowls, Dry
  // Gulch's boardwalks, balconies and riverbed, or flat
  setTerrain(
    alp
      ? alp.terrain
      : isB
        ? (await import("./beach/terrain")).beachTerrain(level.city as BeachLayout)
        : level.western
          ? level.western.terrain
          : null,
  );
  // building access (elevators, stairwells, walkable roofs): Vice Heights today. Solo only
  // uses buildings inside the sealed square. (`?access=0` turns it off, for A/B testing)
  const accessOn =
    typeof window === "undefined" ||
    new URLSearchParams(window.location.search).get("access") !== "0";
  installStructures([]);
  const adapters = () => import("./structures/adapters");
  if (isB) installStructures((await adapters()).beachRooms(level.city as BeachLayout, PLAY_HALF));
  await yieldControl();
  const cityOpen =
    mode === "city" && level.city
      ? (await adapters()).cityOpenStructures(level.city as CityLayout, PLAY_HALF)
      : [];
  mark("cityOpen");
  if (cityOpen.length) installStructures(cityOpen);
  installAccess(null); // (the adapters read the new map's ground, not the last map's roofs)
  // thin props (lamp posts, sign poles, benches, hydrants) block bodies on every big map;
  // the access adapters keep their doors clear of them
  if (import.meta.env.DEV && mode === "nuketown")
    installStructures((await import("./nuketown/layout")).nuketownStructures());
  await yieldControl();
  const posts0 = mapPosts(level.city, level.western ?? null);
  await yieldControl();
  if (cancelled()) return null;
  let accessList0: AccessBuilding[] | null;
  if (!accessOn) accessList0 = null;
  else if (mode === "city" && level.city) {
    accessList0 = (await import("./access/cityAccess")).cityAccess(
      level.city as CityLayout,
      coop ? null : PLAY_HALF,
    );
    mark("cityAccess");
  } else if (isB)
    accessList0 = (await import("./access/beachAccess")).beachAccess(
      level.city as BeachLayout,
      !coop,
      posts0,
    );
  else if (alp && level.city) {
    // (chalet balconies wall off the ground under them: extra collision)
    const aa = (await import("./access/alpineAccess")).alpineAccessFull(
      level.city as AlpineLayout,
      !coop,
      posts0,
    );
    level.blocks = level.blocks.concat(aa.blocks);
    accessList0 = aa.list;
  } else if (level.western) accessList0 = (await import("./western/belfry")).westernBelfry();
  else accessList0 = null;
  await yieldControl();
  if (cancelled()) return null;
  if (alp && level.city)
    installStructures(
      (await adapters()).alpineRooms(level.city as AlpineLayout, PLAY_HALF, accessList0 ?? []),
    );
  if (mode === "city" && level.city) {
    // cityRooms plans interiors for every tower — the single heaviest adapter
    await yieldControl();
    installStructures([
      ...cityOpen,
      ...(await adapters()).cityRooms(level.city as CityLayout, PLAY_HALF),
    ]);
  }
  mark("rooms");
  mark("access");
  await yieldControl();
  installAccess(
    accessList0,
    level.western && accessOn
      ? (await import("./access/westernMarkers")).westernMarkers(level.western)
      : [],
  );
  resetAlpine(alp !== null, alp ? alp.lift : null);
  resetRide();
  resetWheel(isB ? (level.city as BeachLayout).beach.wheel : null);
  // a door no adapter could keep clear (the church tower's lamp, a city hydrant): the prop
  // moves along the facade and stays solid (before the map's meshes are built from it)
  setPosts(null);
  await yieldControl();
  if (cancelled()) return null;
  // Close narrow plaza masonry gaps without relocating ordinary kerb furniture.
  if (mode === "city" && level.city)
    snugPlazaProps(
      level.city as CityLayout,
      (accessList0 ?? []).map((b) => b.spec.door),
    );
  movePropsFromDoors(
    level.city,
    level.western ?? null,
    [...(accessList0 ?? []).map((b) => b.spec.door), ...structureList().flatMap((p) => p.doors)],
    (x, z) => blocked(level.blocks, x, z, 0.35),
  );
  setPosts(mapPosts(level.city, level.western ?? null));
  // Dry Gulch's walk-in buildings: their thin walls, for the enemies' route planner
  setNavWalls(level.western?.navWalls ?? null, level.western?.navDoors ?? null);
  await yieldControl();
  if (cancelled()) return null;
  let gaps: Gap[] = [];
  if (sealed && !coop) {
    gaps = findGaps(walkableFromBlocks(level.blocks, CITY_COOP / 2), PLAY_HALF, BLOCK);
    level.blocks = level.blocks.concat(sealGaps(gaps));
  }
  await yieldControl();
  if (cancelled()) return null;
  mark("props");
  const weedPositions: { x: number; y: number; z: number }[] = [];
  if (level.western) {
    let v = seed ^ 0x74eeda;
    const random = () => {
      v = (Math.imul(v, 1664525) + 1013904223) | 0;
      return (v >>> 0) / 4294967296;
    };
    const origin = level.western.spawn;
    for (let tries = 0; tries < 3000 && weedPositions.length < WEED_COUNT; tries++) {
      const radius = weedPositions.length < 12 ? 8 + random() * 45 : 35 + random() * 160,
        angle = random() * Math.PI * 2;
      const x = origin.x + Math.cos(angle) * radius,
        z = origin.z + Math.sin(angle) * radius;
      if (
        boundaryBlocked(level.blocks, x, z, 0.6) ||
        blocked(level.blocks, x, z, 0.6) ||
        raised(x, z) ||
        weedPositions.some((p) => Math.hypot(p.x - x, p.z - z) < 3)
      )
        continue;
      weedPositions.push({ x, y: groundY(x, z), z });
    }
  }
  resetWeeds(seed, weedPositions);
  // the city generator keeps its own spawn plaza clear and every cell reachable;
  // trimming its blocks here would leave buildings without collision
  if (!level.city && !level.western) {
    level.blocks = level.blocks.filter(
      (b) => Math.max(Math.abs(b.x), Math.abs(b.z)) > BLOCK / 2 + 2.5,
    );
  }
  await yieldControl();
  mark("mesh");
  if (cancelled()) return null;
  // the map's vertex pass, sliced the same way and cached on the layout — the scene
  // mounts it with one WeakMap lookup instead of rebuilding in render (the eager
  // part of the map's dynamic import also lands here, off the render path). The
  // collision BVH for each chunk is warmed the same way (staticCollision.ts caches
  // on the geometry), so the mount's registerStaticGeometry is all cache hits.
  if (level.western) {
    const w = await import("./western/mesh");
    await w.prepareWesternMeshes(level.western);
    await (await import("./western/Western")).prepareWesternExtras(level.western);
    const wm = w.westernMeshes(level.western);
    await prepareStaticSurfaces(
      wm.chunks.flatMap((c) => [c.main]).concat(wm.details.map((d) => d.geometry)),
    );
  } else if (isB) {
    const m = await import("./beach/beachMesh");
    const s = await import("./sky");
    const l = await import("./beach/beachLook");
    // the same sliced warm for the beach's painted sunset + the night gradient
    await s.prepareSunsetBackground(l.BEACH_SKY_KEY, l.BEACH_SUNSET, 2048, 1024);
    await s.prepareSunsetEnv(`${l.BEACH_SKY_KEY}-env`, l.BEACH_SUNSET, 1024, 512);
    s.skyTexture("night");
    await m.prepareBeachMeshes(level.city as BeachLayout);
    await prepareStaticSurfaces(
      m
        .beachMeshes(level.city as BeachLayout)
        .chunks.filter((c) => !c.far)
        .flatMap((c) => [c.main, c.detail]),
    );
  } else if (alp && level.city) {
    const m = await import("./alpine/Alpine");
    await m.prepareAlpineBuild(level.city as AlpineLayout);
    await prepareStaticSurfaces(
      m.alpineBuild(level.city as AlpineLayout).chunks.flatMap((c) => [c.main, c.detail]),
    );
  } else if (mode === "city" && level.city) {
    const m = await import("./cityMesh");
    const s = await import("./sky");
    await s.prepareSunsetBackground("sunset", s.CITY_SUNSET, 2048, 1024);
    await s.prepareSunsetEnv("sunset-env", s.CITY_SUNSET, 1024, 512);
    s.skyTexture("night");
    const ct = await import("./cityTextures");
    await ct.prepareFacadeArrays();
    await yieldControl();
    ct.adsTexture();
    ct.signTexture();
    ct.glowTexture();
    await m.prepareCityMeshes(level.city as CityLayout);
    await prepareStaticSurfaces(
      m.cityMeshes(level.city as CityLayout).chunks.flatMap((c) => [c.main, c.detail]),
    );
  }
  // the access interiors bake vertex light per building — slice it here as well so
  // AccessScene's mount is a WeakMap hit, and warm its collision the same way
  if (accessOn) {
    const a = await import("./access/world");
    const b = await import("./access/build");
    const list = a.accessList();
    await b.prepareAccess(list);
    const built = b.builtAccessFor(list);
    await prepareStaticSurfaces([
      built.ext,
      ...built.per.flatMap((g) =>
        g.high ? [g.high.base, g.high.steel, g.high.wood, g.high.conc] : [],
      ),
    ]);
  }
  if (cancelled()) return null;
  mark("done");
  return {
    blocks: level.blocks,
    rand: level.rand,
    theme,
    city: level.city,
    western: level.western,
    gaps,
  };
}
