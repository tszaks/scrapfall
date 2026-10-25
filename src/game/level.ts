import {
  staticCollisionReady,
  staticPoint,
  staticSegment,
  withoutStaticPoints,
} from "./staticCollision";
import { structureStreet, structureShot, structurePathClear } from "./structures/world";
import type { CityLayout } from "./cityLayout";
import type { WesternLayout } from "./western/layout";
import type { BeachLayout } from "./beach/beachLayout";
import {
  baseGroundY,
  groundHits,
  groundOwnsHits,
  groundY,
  raised,
  shotHits,
  strictNav,
} from "./terrain";
import { runSliced } from "./slice";

export type Block = { x: number; z: number; h: number; tone: number; boundary?: boolean };
export type LayoutMode = "scatter" | "city" | "alpine" | "beach" | "western" | "nuketown";

export const SOLO_ARENA = 44;
export const COOP_ARENA = 62;
/** Vice Heights is real-scale (1 unit = 1 m): ~6x4 city blocks solo, ~8x6 in co-op */
export const CITY_SOLO = 600;
export const CITY_COOP = 800;
/** Pacific Pier: the full 800 m map in both modes (solo seals a 560 m square with blockades) */
export const BEACH_SIZE = 800;
export let ARENA = SOLO_ARENA; // world size (centered at origin)
export let HALF = ARENA / 2;
/** Half-size of the square players can actually reach: the whole arena, except on a big
 * map in solo, where blockades fence play into a smaller square (see soloBounds.ts). */
export let PLAY_HALF = HALF;
export const BLOCK = 2; // block footprint (square)
/**
 * Collision half-width of a piece of cover. Slim props (trees, coral) use a
 * tighter box than the grid cell so shots and steps line up with what you see.
 */
export let BLOCK_HALF = BLOCK / 2;
export function setBlockHalf(v: number) {
  BLOCK_HALF = v;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type LevelGen = {
  blocks: Block[];
  seed: number;
  rand: () => number;
  city: CityLayout | null;
  western: WesternLayout | null;
};

/**
 * Procedurally lay out the arena, keeping spawn clear. "scatter" is the classic
 * sparse block maze; "city" is a street grid of multi-cell buildings (one Block
 * per occupied cell, so collision and pathfinding work unchanged).
 *
 * Staged: each map's module loads on demand (so a session downloads only the map it
 * shows) and its generator runs as a coroutine — it `yield`s between chunks of work
 * and runSliced hands the event loop a turn whenever a slice runs long.
 */
export async function generateLevelStaged(
  seed: number,
  mode: LayoutMode = "scatter",
  solo = false,
): Promise<LevelGen> {
  const rand = mulberry32(seed);
  const blocks: Block[] = [];
  const cells = Math.floor(ARENA / BLOCK);
  const base = { seed, rand };

  if (mode === "nuketown") {
    // Coarse navigation only; the rendered fence and vehicle models own precise contact.
    for (let i = 0; i < cells; i++)
      for (let j = 0; j < cells; j++) {
        const x = -HALF + i * BLOCK + 1,
          z = -HALF + j * BLOCK + 1;
        if (
          Math.abs(x) > 33 ||
          Math.abs(z) > 43 ||
          (x > -11.5 && x < -0.5 && z > -4.3 && z < -1.3) ||
          (x > 3 && x < 13.5 && z > 1.5 && z < 4.5)
        )
          blocks.push({ x, z, h: 4, tone: 0 });
      }
    return { ...base, blocks, city: null, western: null };
  }
  if (mode === "beach") {
    // the full map in solo and co-op; solo seals a smaller square with blockades. The caller
    // installs its ground (beachTerrain) through terrain.ts, like the alpine heightfield.
    const { generateBeach } = await import("./beach/beachLayout");
    const out = await runSliced(generateBeach(rand, cells, HALF, solo));
    return { ...base, blocks: out.blocks, city: out.layout as CityLayout, western: null };
  }

  if (mode === "city") {
    const { generateCity } = await import("./cityLayout");
    const out = await runSliced(generateCity(rand, cells, HALF));
    return { ...base, blocks: out.blocks, city: out.layout, western: null };
  }
  if (mode === "western") {
    const { generateWestern } = await import("./western/layout");
    const out = await runSliced(generateWestern(rand, cells, HALF));
    return { ...base, blocks: out.blocks, city: null, western: out.layout };
  }
  if (mode === "alpine") {
    // the full map in solo and co-op; solo seals a smaller square with blockades
    const { generateAlpine } = await import("./alpine/layout");
    const out = await runSliced(generateAlpine(seed, solo));
    return { ...base, blocks: out.blocks, city: out.layout, western: null };
  }

  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      const x = -HALF + BLOCK / 2 + i * BLOCK;
      const z = -HALF + BLOCK / 2 + j * BLOCK;
      if (Math.hypot(x, z) < 6) continue; // spawn clearing
      if (rand() > 0.16) continue;
      blocks.push({
        x,
        z,
        h: 2 + Math.floor(rand() * 3) * 1.4,
        tone: rand(),
      });
    }
  }
  return { ...base, blocks, city: null, western: null };
}

// Collision lookups go through a per-array cell grid: the city map has hundreds of
// blocks and enemies ray-march clearLine every frame. Blocks sitting exactly on a
// cell centre (all of them, today) go in the grid; anything else is checked linearly.
type BlockGrid = { cells: number; half: number; g: Uint8Array; h: Float32Array; loose: Block[] };
const gridCache = new WeakMap<Block[], BlockGrid>();
function gridFor(blocks: Block[]): BlockGrid {
  const hit = gridCache.get(blocks);
  if (hit && hit.cells === CELLS && hit.half === HALF) return hit;
  const g = new Uint8Array(CELLS * CELLS);
  const hg = new Float32Array(CELLS * CELLS);
  const loose: Block[] = [];
  for (const b of blocks) {
    const i = Math.round((b.x + HALF - BLOCK / 2) / BLOCK);
    const j = Math.round((b.z + HALF - BLOCK / 2) / BLOCK);
    const inside = i >= 0 && j >= 0 && i < CELLS && j < CELLS;
    const centred = Math.abs(cellCenter(i) - b.x) < 1e-6 && Math.abs(cellCenter(j) - b.z) < 1e-6;
    const onGrid = inside && centred;
    if (onGrid) {
      g[i * CELLS + j] = 1;
      // (a cell's shot height: its tallest block; a missing height counts as full)
      hg[i * CELLS + j] = Math.max(hg[i * CELLS + j]!, b.h > 0 ? b.h : FULL_H);
    } else loose.push(b);
  }
  const grid = { cells: CELLS, half: HALF, g, h: hg, loose };
  gridCache.set(blocks, grid);
  return grid;
}

/** Extra collision layered over the block grid: the building-access system (access/world.ts)
 * answers for points on a walkable roof (its parapet and rooftop props), `undefined` elsewhere. */
export const blockHook: { fn: ((x: number, z: number, r: number) => boolean | undefined) | null } =
  {
    fn: null,
  };

/** Thin solid props (lamp posts, sign poles, benches, hydrants): small collision circles
 * that the 2 m block grid can't express. Each map installs its own list (or none). */
export type Post = {
  x: number;
  z: number;
  r: number;
  /** a low prop's height (m): a jumping player whose feet are higher passes over it.
   * Absent = blocks at any height (posts, railings, porch posts, blockades). */
  h?: number;
  /** also stops shots (a horse, a hay bale) */
  shot?: boolean;
};
/** the local player's feet above the ground while jumping (input/movement.ts); 0 on foot.
 * Set only around the player's own movement, so enemies are never affected. */
export const jumpBody = { lift: 0 };
// dense 4 m bucket grid: blocked() -> hitsPost runs thousands of times a frame in a
// crowd, and the old Map lookups were its biggest single cost
const POST_CELL = 4;
let postGrid: (Post[] | undefined)[] | null = null;
let postGW = 0;
const postI = (v: number) => Math.floor((v + HALF) / POST_CELL) + 1;
export function setPosts(list: Post[] | null) {
  if (!list || list.length === 0) {
    postGrid = null;
    return;
  }
  postGW = postI(HALF) + 1;
  const g = new Array<Post[] | undefined>(postGW * postGW);
  for (const p of list) {
    const i0 = Math.max(0, postI(p.x - p.r));
    const i1 = Math.min(postGW - 1, postI(p.x + p.r));
    const j0 = Math.max(0, postI(p.z - p.r));
    const j1 = Math.min(postGW - 1, postI(p.z + p.r));
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const k = i * postGW + j;
        (g[k] ??= []).push(p);
      }
  }
  postGrid = g;
}
export function hitsPost(x: number, z: number, radius: number, shotsOnly = false, feet?: number) {
  if (!postGrid) return false;
  const i0 = Math.max(0, postI(x - radius - 1));
  const i1 = Math.min(postGW - 1, postI(x + radius + 1));
  const j0 = Math.max(0, postI(z - radius - 1));
  const j1 = Math.min(postGW - 1, postI(z + radius + 1));
  for (let i = i0; i <= i1; i++)
    for (let j = j0; j <= j1; j++) {
      const a = postGrid[i * postGW + j];
      if (!a) continue;
      for (const p of a) {
        if (feet !== undefined && feet > groundY(p.x, p.z) + (p.h ?? 4.5)) continue;
        if (shotsOnly ? !p.shot : p.h !== undefined && jumpBody.lift > p.h) continue; // jumped over it
        const dx = p.x - x,
          dz = p.z - z,
          rr = p.r + radius;
        if (dx * dx + dz * dz < rr * rr) return true;
      }
    }
  return false;
}
/** shot-stopping posts (horses, hay, walk-in walls) at height y: a low one (h) only below its top */
function shotPost(x: number, y: number, z: number) {
  if (!postGrid) return false;
  const a = postGrid[postI(x) * postGW + postI(z)];
  if (!a) return false;
  let base = NaN;
  for (const p of a) {
    if (!p.shot || Math.hypot(p.x - x, p.z - z) >= p.r + 0.05) continue;
    if (Number.isNaN(base)) base = groundY(x, z);
    if (y < base + (p.h ?? 4.5)) return true;
  }
  return false;
}

export function blocked(blocks: Block[], x: number, z: number, radius: number) {
  if (Math.abs(x) > HALF - 1 || Math.abs(z) > HALF - 1) return true;
  if (blockHook.fn) {
    const h = blockHook.fn(x, z, radius);
    if (h !== undefined) return h;
  }
  // (thin posts only stop bodies, not bullets (shots test with a tiny radius), unless they're
  // bulky enough to stop a shot: a tied horse, a hay bale, a crate stack)
  if (radius >= 0.2 ? hitsPost(x, z, radius) : hitsPost(x, z, radius, true)) return true;
  const room = structureStreet(x, z, radius);
  if (room !== undefined) return room;
  const half = BLOCK_HALF + radius;
  const grid = gridFor(blocks);
  // cells whose centre lies within `half` of the point on both axes
  const i0 = Math.max(0, Math.floor((x - half + HALF - BLOCK / 2) / BLOCK));
  const i1 = Math.min(CELLS - 1, Math.ceil((x + half + HALF - BLOCK / 2) / BLOCK));
  const j0 = Math.max(0, Math.floor((z - half + HALF - BLOCK / 2) / BLOCK));
  const j1 = Math.min(CELLS - 1, Math.ceil((z + half + HALF - BLOCK / 2) / BLOCK));
  for (let i = i0; i <= i1; i++) {
    if (Math.abs(x - cellCenter(i)) >= half) continue;
    for (let j = j0; j <= j1; j++) {
      if (grid.g[i * CELLS + j] && Math.abs(z - cellCenter(j)) < half) return true;
    }
  }
  for (const b of grid.loose) {
    if (Math.abs(x - b.x) < half && Math.abs(z - b.z) < half) return true;
  }
  return false;
}

/** Blocks this tall or more stop shots at any height (buildings: their upper storeys are not
 * all on the grid); lower ones (cars, barriers, planters, boards, fences) only stop shots
 * below their top, so you can shoot over cover and a bullet hole lands on the real surface. */
export const FULL_H = 3;

/**
 * Height-aware version of blocked(blocks, x, z, 0.05) for projectiles at height y: map edges,
 * the roof hook and tall blocks stop everything; low blocks stop only what is below their top.
 */
export function shotBlocked(blocks: Block[], x: number, y: number, z: number) {
  const r = 0.05;
  if (Math.abs(x) > HALF - 1 || Math.abs(z) > HALF - 1) return true;
  if (blockHook.fn) {
    const h = blockHook.fn(x, z, r);
    if (h !== undefined) return h;
  }
  if (shotPost(x, y, z)) return true;
  const half = BLOCK_HALF + r;
  const grid = gridFor(blocks);
  const i0 = Math.max(0, Math.floor((x - half + HALF - BLOCK / 2) / BLOCK));
  const i1 = Math.min(CELLS - 1, Math.ceil((x + half + HALF - BLOCK / 2) / BLOCK));
  const j0 = Math.max(0, Math.floor((z - half + HALF - BLOCK / 2) / BLOCK));
  const j1 = Math.min(CELLS - 1, Math.ceil((z + half + HALF - BLOCK / 2) / BLOCK));
  let base = NaN;
  for (let i = i0; i <= i1; i++) {
    if (Math.abs(x - cellCenter(i)) >= half) continue;
    for (let j = j0; j <= j1; j++) {
      if (!grid.g[i * CELLS + j] || Math.abs(z - cellCenter(j)) >= half) continue;
      const h = grid.h[i * CELLS + j]!;
      if (h >= FULL_H) return true;
      if (Number.isNaN(base)) base = groundY(x, z);
      if (y < base + h) return true;
    }
  }
  for (const b of grid.loose) {
    if (Math.abs(x - b.x) < half && Math.abs(z - b.z) < half) {
      if (!(b.h > 0) || b.h >= FULL_H) return true;
      if (Number.isNaN(base)) base = groundY(x, z);
      if (y < base + b.h) return true;
    }
  }
  return false;
}

/**
 * The one shot test for the world (minus traffic and building interiors): the alpine
 * heightfield's solids, the pier's decks / railings / sea, or the ground plus height-aware
 * blocks everywhere else. True when a projectile at (x, y, z) has hit something.
 */
export function shotStop(blocks: Block[], x: number, y: number, z: number) {
  if (staticCollisionReady())
    return structureShot(x, y, z) ?? (y < baseGroundY(x, z) || staticPoint(x, y, z));
  return (
    structureShot(x, y, z) ??
    shotHits(x, y, z) ??
    (groundOwnsHits() ? groundHits(x, y, z) : y < groundY(x, z) || shotBlocked(blocks, x, y, z))
  );
}

/** a clear flight from a to b (3D, samples every 0.4 m): nothing shotStop()s it */
export function clearShot(
  blocks: Block[],
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
) {
  if (staticCollisionReady() && staticSegment(ax, ay, az, bx, by, bz)) return false;
  return withoutStaticPoints(() => {
    const len = Math.hypot(bx - ax, by - ay, bz - az),
      steps = Math.ceil(len / 0.1);
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      if (shotStop(blocks, ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t))
        return false;
    }
    return true;
  });
}

export function randomSpawn(blocks: Block[], rand: () => number) {
  // wide clearance first so even the biggest enemies never appear inside cover
  // (PLAY_HALF keeps solo big-map spawns inside the fenced play square)
  for (const clear of [1.8, 1.4, 1.1]) {
    for (let i = 0; i < 80; i++) {
      const x = (rand() - 0.5) * (PLAY_HALF * 2 - 6);
      const z = (rand() - 0.5) * (PLAY_HALF * 2 - 6);
      if (!blocked(blocks, x, z, clear) && Math.hypot(x, z) > 10) return { x, z };
    }
  }
  // last resort: scan the grid for any genuinely open cell
  const cells = Math.floor((PLAY_HALF * 2) / BLOCK);
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      const x = -PLAY_HALF + BLOCK / 2 + i * BLOCK;
      const z = -PLAY_HALF + BLOCK / 2 + j * BLOCK;
      if (!blocked(blocks, x, z, 1.1) && Math.hypot(x, z) > 10) return { x, z };
    }
  }
  return { x: 0, z: 0 };
}

/** Nearest open spot to (x,z) — used to free anything wedged inside cover. */
export function pushOut(blocks: Block[], x: number, z: number, radius: number) {
  if (!blocked(blocks, x, z, radius)) return { x, z };
  for (let ring = 1; ring <= 8; ring++) {
    const step = ring * 0.5;
    for (let a = 0; a < 12; a++) {
      const ang = (a / 12) * Math.PI * 2;
      const nx = x + Math.cos(ang) * step;
      const nz = z + Math.sin(ang) * step;
      if (!blocked(blocks, nx, nz, radius)) return { x: nx, z: nz };
    }
  }
  return { x, z };
}

/**
 * A walkable spot rMin..rMax metres from a random one of `players`, preferably out of that
 * player's line of sight (so enemies don't pop in on screen). Every open city cell is
 * reachable (the generator seals the rest), so "not blocked" means "reachable".
 */
export function spawnNear(
  blocks: Block[],
  rand: () => number,
  players: { x: number; z: number }[],
  rMin: number,
  rMax: number,
  hidden = true,
  radius = 1,
  /** extra test, e.g. "the coarse nav grid can route from here" */
  ok: (x: number, z: number) => boolean = () => true,
) {
  if (players.length === 0) return randomSpawn(blocks, rand);
  let fallback: { x: number; z: number } | null = null;
  // hidden = out of every player's sight. An open plaza can leave the first ring all in view:
  // a second, wider ring (to 1.6x) is tried before settling for a spot someone can see
  for (let i = 0; i < (hidden ? 160 : 96); i++) {
    const p = players[Math.floor(rand() * players.length)]!;
    const a = rand() * Math.PI * 2;
    const wide = i >= 96 ? 1.6 : 1;
    const d = rMin + rand() * (rMax * wide - rMin);
    const x = p.x + Math.sin(a) * d;
    const z = p.z + Math.cos(a) * d;
    if (Math.abs(x) > PLAY_HALF - 3 || Math.abs(z) > PLAY_HALF - 3) continue;
    if (blocked(blocks, x, z, radius) || !ok(x, z)) continue;
    if (players.some((q) => Math.hypot(q.x - x, q.z - z) < rMin * 0.8)) continue;
    if (!hidden || !players.some((q) => clearLine(blocks, q.x, q.z, x, z, 0.1))) return { x, z };
    if (i < 96) fallback ??= { x, z };
  }
  if (fallback) return fallback;
  // tight spot (e.g. deep in an alley, or out on a narrow pier): anything open near the first
  // player, preferring routable spots at least half the minimum distance away
  const p = players[0]!;
  for (let pass = 0; pass < 2; pass++)
    for (let i = 0; i < 80; i++) {
      const x = p.x + (rand() - 0.5) * rMax * 2;
      const z = p.z + (rand() - 0.5) * rMax * 2;
      if (
        Math.abs(x) >= PLAY_HALF - 3 ||
        Math.abs(z) >= PLAY_HALF - 3 ||
        blocked(blocks, x, z, radius)
      )
        continue;
      if (!ok(x, z) || players.some(q=>Math.hypot(x-q.x,z-q.z)<Math.min(rMin,30))) continue;
      return { x, z };
    }
  return randomSpawn(blocks, rand);
}

// ---------- pathfinding (flow field over a nav grid) ----------
export let CELLS = Math.floor(ARENA / BLOCK);
/** Nav grid: BLOCK * NAV_SCALE metres per cell. The big city routes on 4 m cells
 * (collision stays on the 2 m grid) so each flow field stays cheap. */
export let NAV_SCALE = 1;
export let NAV_CELLS = CELLS;

/** Resize the arena (co-op uses a bigger field, the city far bigger). Call before generating a level.
 * `playHalf` fences play into a smaller central square (solo on the big maps). */
/** Thin walls the route planner must respect (walk-in buildings' walls are posts, which the
 * nav grid can't see): segments, and the doorways that stay open through them. */
let navWallSegs: { ax: number; az: number; bx: number; bz: number }[] = [];
let navWallDoors: { x: number; z: number }[] = [];
export function setNavWalls(walls: typeof navWallSegs | null, doors: typeof navWallDoors | null) {
  navWallSegs = walls ?? [];
  navWallDoors = doors ?? [];
}
function closeNavWalls(nav: NavGrid) {
  if (!navWallSegs.length) return;
  const cs = BLOCK * NAV_SCALE;
  for (const w of navWallSegs) {
    const len = Math.hypot(w.bx - w.ax, w.bz - w.az);
    for (let d = 0; d <= len; d += cs * 0.25) {
      const x = w.ax + ((w.bx - w.ax) * d) / len;
      const z = w.az + ((w.bz - w.az) * d) / len;
      if (navWallDoors.some((q) => Math.hypot(q.x - x, q.z - z) < cs * 0.6)) continue;
      const i = Math.floor((x + HALF) / cs);
      const j = Math.floor((z + HALF) / cs);
      if (i < 0 || j < 0 || i >= nav.n || j >= nav.n) continue;
      nav.g[i * nav.n + j] = 1;
    }
  }
}

/** Nav cells over raised stair-only ground (see terrain.ts raised) are solid for enemies. */
export function closeRaised(nav: NavGrid): NavGrid {
  closeNavWalls(nav);
  const cs = BLOCK * NAV_SCALE;
  for (let i = 0; i < nav.n; i++)
    for (let j = 0; j < nav.n; j++) {
      const k = i * nav.n + j;
      if (nav.g[k]) continue;
      const cx = -HALF + (i + 0.5) * cs;
      const cz = -HALF + (j + 0.5) * cs;
      if (raised(cx, cz)) nav.g[k] = 1;
    }
  return nav;
}

export function setArenaSize(size: number, navScale = 1, playHalf = size / 2) {
  ARENA = size;
  HALF = size / 2;
  PLAY_HALF = playHalf;
  CELLS = Math.floor(size / BLOCK);
  NAV_SCALE = navScale;
  NAV_CELLS = Math.ceil(CELLS / navScale);
}

export const toCell = (v: number) =>
  Math.max(0, Math.min(CELLS - 1, Math.floor((v + HALF) / BLOCK)));
export const cellCenter = (i: number) => -HALF + BLOCK / 2 + i * BLOCK;
export const toNav = (v: number) =>
  Math.max(0, Math.min(NAV_CELLS - 1, Math.floor((v + HALF) / (BLOCK * NAV_SCALE))));

export type NavGrid = {
  /** 1 = solid nav cell */
  g: Uint8Array;
  /** walk-to point per nav cell (centre of its open 2 m sub-cells) */
  px: Float32Array;
  pz: Float32Array;
  n: number;
  /** Directed, clearance-checked links in DIRS order. */
  links?: Uint8Array;
};

export function solidGrid(blocks: Block[]): NavGrid {
  const n = NAV_CELLS;
  const sc = NAV_SCALE;
  const fine = new Uint8Array(CELLS * CELLS);
  for (const b of blocks) fine[toCell(b.x) * CELLS + toCell(b.z)] = 1;
  const g = new Uint8Array(n * n);
  const px = new Float32Array(n * n);
  const pz = new Float32Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let open = 0;
      let sx = 0;
      let sz = 0;
      let total = 0;
      for (let a = 0; a < sc; a++) {
        for (let b = 0; b < sc; b++) {
          const fi = i * sc + a;
          const fj = j * sc + b;
          if (fi >= CELLS || fj >= CELLS) continue;
          total++;
          if (structureStreet(cellCenter(fi), cellCenter(fj), 0.45) ?? !!fine[fi * CELLS + fj])
            continue;
          open++;
          sx += cellCenter(fi);
          sz += cellCenter(fj);
        }
      }
      const k = i * n + j;
      // solid unless at least half of the sub-cells are open. On a ground that asks for strict
      // nav (the beach: a railing between a deck and the sand must cut the route) any solid
      // sub-cell makes the nav cell solid. Never outside the play square.
      const cx = -HALF + (i + 0.5) * BLOCK * sc;
      const cz = -HALF + (j + 0.5) * BLOCK * sc;
      const out = Math.abs(cx) > PLAY_HALF || Math.abs(cz) > PLAY_HALF;
      g[k] = (strictNav() ? open < total : open * 2 < total) || open === 0 || out ? 1 : 0;
      px[k] = open ? sx / open : 0;
      pz[k] = open ? sz / open : 0;
    }
  }
  // edge ring is against the arena wall — treat as solid for routing
  for (let i = 0; i < n; i++) {
    g[i * n] = g[i * n + n - 1] = 1;
    g[i] = g[(n - 1) * n + i] = 1;
  }
  return { g, px, pz, n };
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

/**
 * The nav cell a flow field toward (x, z) should start from. Usually just the cell under the
 * point; on maps with stacked ground (the beach: a deck above the sand, strict nav) a player
 * standing by a railing is in a solid cell that touches both levels, so the field would leak
 * down to the sand below. There the nearest open cell on the player's own level is used.
 */
const navTargetOut: [number, number] = [0, 0];
export function navTarget(nav: NavGrid, x: number, z: number, blocks?: Block[]): [number, number] {
  const ti = toNav(x);
  const tj = toNav(z);
  // (shared result: callers destructure immediately — this runs inside enemy route picks)
  const r = navTargetOut;
  r[0] = ti;
  r[1] = tj;
  if (!strictNav() && !nav.links) return r;
  const n = nav.n;
  const gy = groundY(x, z);
  const same = (k: number) =>
    !nav.g[k] && (!nav.links || nav.links[k] !== 0) &&
    Math.abs(groundY(nav.px[k]!, nav.pz[k]!) - gy) < 1.2;
  if (same(ti * n + tj)) return r;
  // prefer the nearest open cell on the same level that has a clear walk to the point, so an
  // enemy that arrives there can step straight to a player standing along a railing
  let bd = Infinity;
  let bi = ti;
  let bj = tj;
  for (let di = -3; di <= 3; di++)
    for (let dj = -3; dj <= 3; dj++) {
      const i = ti + di;
      const j = tj + dj;
      if (i < 0 || j < 0 || i >= n || j >= n || !same(i * n + j)) continue;
      const k = i * n + j;
      let d = Math.hypot(nav.px[k]! - x, nav.pz[k]! - z);
      if (blocks && !clearLine(blocks, nav.px[k]!, nav.pz[k]!, x, z, 0.45)) d += 1000;
      if (d < bd) {
        bd = d;
        bi = i;
        bj = j;
      }
    }
  r[0] = bi;
  r[1] = bj;
  return r;
}

/**
 * A fine (2 m) distance field round a target, for the last stretch on maps with stacked ground
 * (the beach): the 4 m nav grid can't see a 2 m corridor between a railing and the coaster, so
 * enemies that got close follow this instead. `R` is the window radius in 2 m cells.
 */
export type FineField = { i0: number; j0: number; w: number; dist: Float32Array };
export function fineField(blocks: Block[], x: number, z: number, R = 24): FineField {
  const ti = toCell(x);
  const tj = toCell(z);
  const i0 = Math.max(0, ti - R);
  const j0 = Math.max(0, tj - R);
  const w = 2 * R + 1;
  const dist = new Float32Array(w * w).fill(Infinity);
  const open = new Uint8Array(w * w);
  for (let a = 0; a < w; a++)
    for (let b = 0; b < w; b++) {
      const i = i0 + a;
      const j = j0 + b;
      if (i >= CELLS || j >= CELLS) continue;
      open[a * w + b] = blocked(blocks, cellCenter(i), cellCenter(j), 0.45) ? 0 : 1;
    }
  const s0 = (ti - i0) * w + (tj - j0);
  const gy = groundY(x, z);
  dist[s0] = 0;
  open[s0] = 1; // the target itself may stand hard against a railing
  const q = [s0];
  for (let h = 0; h < q.length; h++) {
    const c = q[h]!;
    const a = Math.floor(c / w);
    const b = c - a * w;
    for (const [da, db] of DIRS) {
      const na = a + da;
      const nb = b + db;
      if (na < 0 || nb < 0 || na >= w || nb >= w) continue;
      const k = na * w + nb;
      if (!open[k]) continue;
      if (da && db && (!open[(a + da) * w + b] || !open[a * w + b + db])) continue;
      // out of the target's own cell only onto its level (not over a railing to the sand below)
      if (c === s0 && Math.abs(groundY(cellCenter(i0 + na), cellCenter(j0 + nb)) - gy) > 1.2)
        continue;
      if (
        !structurePathClear(
          cellCenter(i0 + a),
          cellCenter(j0 + b),
          cellCenter(i0 + na),
          cellCenter(j0 + nb),
        )
      )
        continue;
      const nd = dist[c]! + (da && db ? 1.414 : 1);
      if (nd < dist[k]!) {
        dist[k] = nd;
        q.push(k);
      }
    }
  }
  return { i0, j0, w, dist };
}
/** next point down a fine field from (x, z), or null when outside it / not connected / there.
 * `out` is a caller scratch — read it before the next call. */
export function fineStep(
  f: FineField,
  x: number,
  z: number,
  out: { x: number; z: number },
): { x: number; z: number } | null {
  const a = toCell(x) - f.i0;
  const b = toCell(z) - f.j0;
  const w = f.w;
  if (a < 0 || b < 0 || a >= w || b >= w) return null;
  const here = f.dist[a * w + b]!;
  if (!isFinite(here) || here === 0) return null;
  let best = here;
  let ba = a;
  let bb = b;
  for (const [da, db] of DIRS) {
    const na = a + da;
    const nb = b + db;
    if (na < 0 || nb < 0 || na >= w || nb >= w) continue;
    if (!structurePathClear(x, z, cellCenter(f.i0 + na), cellCenter(f.j0 + nb))) continue;
    const d = f.dist[na * w + nb]!;
    if (d < best) {
      best = d;
      ba = na;
      bb = nb;
    }
  }
  if (ba === a && bb === b) return null;
  out.x = cellCenter(f.i0 + ba);
  out.z = cellCenter(f.j0 + bb);
  return out;
}

/** Distance (in steps) from every nav cell to the target nav cell. `maxD` bounds the search
 * (the big city only needs routes within a couple of hundred metres of each player). */
export function flowField(nav: NavGrid, ti: number, tj: number, maxD = Infinity) {
  const { g: solid, n } = nav;
  const dist = new Float32Array(n * n).fill(Infinity);
  const q: number[] = [];
  const start = ti * n + tj;
  dist[start] = 0;
  q.push(start);
  for (let h = 0; h < q.length; h++) {
    const c = q[h]!;
    const ci = Math.floor(c / n);
    const cj = c - ci * n;
    const dc = dist[c]!;
    for (let direction = 0; direction < DIRS.length; direction++) {
      const [di, dj] = DIRS[direction]!;
      const ni = ci + di;
      const nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
      const k = ni * n + nj;
      if (solid[k]) continue;
      const reverse = direction < 4 ? direction ^ 1 : 11 - direction;
      if (nav.links && !(nav.links[k]! & (1 << reverse))) continue;
      if (di && dj && (solid[(ci + di) * n + cj] || solid[ci * n + cj + dj])) continue;
      if (!structurePathClear(nav.px[c]!, nav.pz[c]!, nav.px[k]!, nav.pz[k]!)) continue;
      const nd = dc + (di && dj ? 1.414 : 1);
      if (nd > maxD) continue;
      if (nd < dist[k]!) {
        dist[k] = nd;
        q.push(k);
      }
    }
  }
  return dist;
}

/** World-space point the enemy should walk to next. `out` is a caller scratch (this runs
 * per enemy per frame) — read it before the next call. */
export function nextWaypoint(
  nav: NavGrid,
  dist: Float32Array,
  x: number,
  z: number,
  out: { x: number; z: number },
) {
  const { g: solid, n } = nav;
  const ci = toNav(x);
  const cj = toNav(z);
  let best = dist[ci * n + cj]!;
  let bi = ci;
  let bj = cj;
  for (let direction = 0; direction < DIRS.length; direction++) {
    const [di, dj] = DIRS[direction]!;
    const ni = ci + di;
    const nj = cj + dj;
    if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
    if (nav.links && !(nav.links[ci * n + cj]! & (1 << direction))) continue;
    if (di && dj && (solid[(ci + di) * n + cj] || solid[ci * n + cj + dj])) continue;
    if (!structurePathClear(x, z, nav.px[ni * n + nj]!, nav.pz[ni * n + nj]!)) continue;
    const d = dist[ni * n + nj]!;
    if (d < best) {
      best = d;
      bi = ni;
      bj = nj;
    }
  }
  if (bi === ci && bj === cj) return null;
  const k = bi * n + bj;
  if (NAV_SCALE === 1) {
    out.x = cellCenter(bi);
    out.z = cellCenter(bj);
    return out;
  }
  out.x = nav.px[k]!;
  out.z = nav.pz[k]!;
  return out;
}

/** True when a straight walk from a to b is clear for the given radius. */
export function clearLine(
  blocks: Block[],
  ax: number,
  az: number,
  bx: number,
  bz: number,
  r: number,
) {
  const len = Math.hypot(bx - ax, bz - az);
  const steps = Math.ceil(len / 0.5);
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    if (blocked(blocks, ax + (bx - ax) * t, az + (bz - az) * t, r)) return false;
  }
  return true;
}

// Only authored world limits retain a grid. Props use their visible surfaces.
const limits = new WeakMap<Block[], Map<number, Block>>();
export function boundaryBlocked(blocks: Block[], x: number, z: number, r: number) {
  if (Math.abs(x) + r > PLAY_HALF - 1 || Math.abs(z) + r > PLAY_HALF - 1) return true;
  let grid = limits.get(blocks);
  if (!grid) {
    grid = new Map();
    for (const b of blocks)
      if (b.boundary) grid.set(Math.floor(b.x / 2) * 4096 + Math.floor(b.z / 2), b);
    limits.set(blocks, grid);
  }
  for (let i = Math.floor((x - r - 1) / 2); i <= Math.floor((x + r + 1) / 2); i++)
    for (let j = Math.floor((z - r - 1) / 2); j <= Math.floor((z + r + 1) / 2); j++) {
      const b = grid.get(i * 4096 + j);
      if (!b) continue;
      const dx = Math.max(0, Math.abs(x - b.x) - 1),
        dz = Math.max(0, Math.abs(z - b.z) - 1);
      if (dx * dx + dz * dz < r * r) return true;
    }
  return false;
}
