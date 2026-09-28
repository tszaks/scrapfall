import { generateCity, type CityLayout } from "./cityLayout";
import { generateWestern, type WesternLayout } from "./western/layout";
import { generateAlpine } from "./alpine/layout";
import { generateBeach } from "./beach/beachLayout";
import { groundY, raised, strictNav } from "./terrain";

export type Block = { x: number; z: number; h: number; tone: number };
export type LayoutMode = "scatter" | "city" | "alpine" | "beach" | "western";

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

/**
 * Procedurally lay out the arena, keeping spawn clear. "scatter" is the classic
 * sparse block maze; "city" is a street grid of multi-cell buildings (one Block
 * per occupied cell, so collision and pathfinding work unchanged).
 */
export function generateLevel(seed: number, mode: LayoutMode = "scatter", solo = false) {
  const rand = mulberry32(seed);
  const blocks: Block[] = [];
  const cells = Math.floor(ARENA / BLOCK);
  let city: CityLayout | null = null;
  let western: WesternLayout | null = null;

  if (mode === "beach") {
    // the full map in solo and co-op; solo seals a smaller square with blockades. The caller
    // installs its ground (beachTerrain) through terrain.ts, like the alpine heightfield.
    const out = generateBeach(rand, cells, HALF, solo);
    return { blocks: out.blocks, seed, rand, city: out.layout as CityLayout, western };
  }

  if (mode === "city") {
    const out = generateCity(rand, cells, HALF);
    city = out.layout;
    return { blocks: out.blocks, seed, rand, city, western };
  }
  if (mode === "western") {
    const out = generateWestern(rand, cells, HALF);
    western = out.layout;
    return { blocks: out.blocks, seed, rand, city, western };
  }
  if (mode === "alpine") {
    // the full map in solo and co-op; solo seals a smaller square with blockades
    const out = generateAlpine(seed, solo);
    city = out.layout;
    return { blocks: out.blocks, seed, rand, city, western };
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
  return { blocks, seed, rand, city, western };
}

// Collision lookups go through a per-array cell grid: the city map has hundreds of
// blocks and enemies ray-march clearLine every frame. Blocks sitting exactly on a
// cell centre (all of them, today) go in the grid; anything else is checked linearly.
type BlockGrid = { cells: number; half: number; g: Uint8Array; loose: Block[] };
const gridCache = new WeakMap<Block[], BlockGrid>();
function gridFor(blocks: Block[]): BlockGrid {
  const hit = gridCache.get(blocks);
  if (hit && hit.cells === CELLS && hit.half === HALF) return hit;
  const g = new Uint8Array(CELLS * CELLS);
  const loose: Block[] = [];
  for (const b of blocks) {
    const i = Math.round((b.x + HALF - BLOCK / 2) / BLOCK);
    const j = Math.round((b.z + HALF - BLOCK / 2) / BLOCK);
    const inside = i >= 0 && j >= 0 && i < CELLS && j < CELLS;
    const centred = Math.abs(cellCenter(i) - b.x) < 1e-6 && Math.abs(cellCenter(j) - b.z) < 1e-6;
    const onGrid = inside && centred;
    if (onGrid) g[i * CELLS + j] = 1;
    else loose.push(b);
  }
  const grid = { cells: CELLS, half: HALF, g, loose };
  gridCache.set(blocks, grid);
  return grid;
}

/** Extra collision layered over the block grid: the building-access system (access/world.ts)
 * answers for points on a walkable roof (its parapet and rooftop props), `undefined` elsewhere. */
export const blockHook: { fn: ((x: number, z: number, r: number) => boolean | undefined) | null } = {
  fn: null,
};

/** Thin solid props (lamp posts, sign poles, benches, hydrants): small collision circles
 * that the 2 m block grid can't express. Each map installs its own list (or none). */
export type Post = { x: number; z: number; r: number };
let postGrid: Map<number, Post[]> | null = null;
const postKey = (i: number, j: number) => i * 65536 + j;
export function setPosts(list: Post[] | null) {
  if (!list || list.length === 0) {
    postGrid = null;
    return;
  }
  postGrid = new Map();
  for (const p of list)
    for (let i = Math.floor((p.x - p.r) / 4); i <= Math.floor((p.x + p.r) / 4); i++)
      for (let j = Math.floor((p.z - p.r) / 4); j <= Math.floor((p.z + p.r) / 4); j++) {
        const k = postKey(i, j);
        let a = postGrid.get(k);
        if (!a) postGrid.set(k, (a = []));
        a.push(p);
      }
}
function hitsPost(x: number, z: number, radius: number) {
  if (!postGrid) return false;
  const i0 = Math.floor((x - radius - 1) / 4);
  const i1 = Math.floor((x + radius + 1) / 4);
  const j0 = Math.floor((z - radius - 1) / 4);
  const j1 = Math.floor((z + radius + 1) / 4);
  for (let i = i0; i <= i1; i++)
    for (let j = j0; j <= j1; j++) {
      const a = postGrid.get(postKey(i, j));
      if (!a) continue;
      for (const p of a) if (Math.hypot(p.x - x, p.z - z) < p.r + radius) return true;
    }
  return false;
}

export function blocked(blocks: Block[], x: number, z: number, radius: number) {
  if (Math.abs(x) > HALF - 1 || Math.abs(z) > HALF - 1) return true;
  if (blockHook.fn) {
    const h = blockHook.fn(x, z, radius);
    if (h !== undefined) return h;
  }
  // (thin posts only stop bodies, not bullets: shots test with a tiny radius)
  if (radius >= 0.2 && hitsPost(x, z, radius)) return true;
  const half = BLOCK / 2 + radius;
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

export function randomSpawn(blocks: Block[], rand: () => number) {
  for (let i = 0; i < 60; i++) {
    const x = (rand() - 0.5) * (PLAY_HALF * 2 - 6);
    const z = (rand() - 0.5) * (PLAY_HALF * 2 - 6);
    if (!blocked(blocks, x, z, 1) && Math.hypot(x, z) > 10) return { x, z };
  }
  return { x: HALF - 4, z: HALF - 4 };
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
  for (let i = 0; i < 96; i++) {
    const p = players[Math.floor(rand() * players.length)]!;
    const a = rand() * Math.PI * 2;
    const d = rMin + rand() * (rMax - rMin);
    const x = p.x + Math.sin(a) * d;
    const z = p.z + Math.cos(a) * d;
    if (Math.abs(x) > PLAY_HALF - 3 || Math.abs(z) > PLAY_HALF - 3) continue;
    if (blocked(blocks, x, z, radius) || !ok(x, z)) continue;
    if (players.some((q) => Math.hypot(q.x - x, q.z - z) < rMin * 0.8)) continue;
    if (!hidden || !clearLine(blocks, p.x, p.z, x, z, 0.1)) return { x, z };
    fallback ??= { x, z };
  }
  if (fallback) return fallback;
  // tight spot (e.g. deep in an alley, or out on a narrow pier): anything open near the first
  // player, preferring routable spots at least half the minimum distance away
  const p = players[0]!;
  for (let pass = 0; pass < 2; pass++)
    for (let i = 0; i < 80; i++) {
      const x = p.x + (rand() - 0.5) * rMax * 2;
      const z = p.z + (rand() - 0.5) * rMax * 2;
      if (Math.abs(x) >= PLAY_HALF - 3 || Math.abs(z) >= PLAY_HALF - 3 || blocked(blocks, x, z, radius)) continue;
      if (pass === 0 && (!ok(x, z) || Math.hypot(x - p.x, z - p.z) < rMin * 0.5)) continue;
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
/** Nav cells over raised stair-only ground (see terrain.ts raised) are solid for enemies. */
export function closeRaised(nav: NavGrid): NavGrid {
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
          if (fine[fi * CELLS + fj]) continue;
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
export function navTarget(nav: NavGrid, x: number, z: number, blocks?: Block[]): [number, number] {
  const ti = toNav(x);
  const tj = toNav(z);
  if (!strictNav()) return [ti, tj];
  const n = nav.n;
  const gy = groundY(x, z);
  const same = (k: number) => !nav.g[k] && Math.abs(groundY(nav.px[k]!, nav.pz[k]!) - gy) < 1.2;
  if (same(ti * n + tj)) return [ti, tj];
  // prefer the nearest open cell on the same level that has a clear walk to the point, so an
  // enemy that arrives there can step straight to a player standing along a railing
  let best: [number, number] = [ti, tj];
  let bd = Infinity;
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
        best = [i, j];
      }
    }
  return best;
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
      if (c === s0 && Math.abs(groundY(cellCenter(i0 + na), cellCenter(j0 + nb)) - gy) > 1.2) continue;
      const nd = dist[c]! + (da && db ? 1.414 : 1);
      if (nd < dist[k]!) {
        dist[k] = nd;
        q.push(k);
      }
    }
  }
  return { i0, j0, w, dist };
}
/** next point down a fine field from (x, z), or null when outside it / not connected / there */
export function fineStep(f: FineField, x: number, z: number): { x: number; z: number } | null {
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
    const d = f.dist[na * w + nb]!;
    if (d < best) {
      best = d;
      ba = na;
      bb = nb;
    }
  }
  if (ba === a && bb === b) return null;
  return { x: cellCenter(f.i0 + ba), z: cellCenter(f.j0 + bb) };
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
    for (const [di, dj] of DIRS) {
      const ni = ci + di;
      const nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
      const k = ni * n + nj;
      if (solid[k]) continue;
      if (di && dj && (solid[(ci + di) * n + cj] || solid[ci * n + cj + dj])) continue;
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

/** World-space point the enemy should walk to next. */
export function nextWaypoint(nav: NavGrid, dist: Float32Array, x: number, z: number) {
  const { g: solid, n } = nav;
  const ci = toNav(x);
  const cj = toNav(z);
  let best = dist[ci * n + cj]!;
  let bi = ci;
  let bj = cj;
  for (const [di, dj] of DIRS) {
    const ni = ci + di;
    const nj = cj + dj;
    if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
    if (di && dj && (solid[(ci + di) * n + cj] || solid[ci * n + cj + dj])) continue;
    const d = dist[ni * n + nj]!;
    if (d < best) {
      best = d;
      bi = ni;
      bj = nj;
    }
  }
  const k = bi * n + bj;
  if (NAV_SCALE === 1) return { x: cellCenter(bi), z: cellCenter(bj) };
  return { x: nav.px[k]!, z: nav.pz[k]! };
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
