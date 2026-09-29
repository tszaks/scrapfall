export type Block = { x: number; z: number; h: number; tone: number };

export const SOLO_ARENA = 44;
export const COOP_ARENA = 62;
export let ARENA = SOLO_ARENA; // world size (centered at origin)
export let HALF = ARENA / 2;
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

/** Procedurally lay out a sparse block maze on a grid, keeping spawn clear. */
export function generateLevel(seed: number) {
  const rand = mulberry32(seed);
  const blocks: Block[] = [];
  const cells = Math.floor(ARENA / BLOCK);

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
  return { blocks, seed, rand };
}

/**
 * Collision half-width of a piece of cover. Slim props (trees, coral) use a
 * tighter box than the grid cell so shots and steps line up with what you see.
 */
export let BLOCK_HALF = BLOCK / 2;
export function setBlockHalf(v: number) {
  BLOCK_HALF = v;
}

// Big maps have thousands of blocks: look them up through a cell grid instead of a scan.
let gridFor: Block[] | null = null;
let gridCells: Map<number, Block[]> = new Map();
function cellGrid(blocks: Block[]) {
  if (gridFor !== blocks) {
    gridFor = blocks;
    gridCells = new Map();
    for (const b of blocks) {
      const k = Math.floor(b.x / BLOCK) * 100003 + Math.floor(b.z / BLOCK);
      const l = gridCells.get(k);
      if (l) l.push(b); else gridCells.set(k, [b]);
    }
  }
  return gridCells;
}

/** Big maps: enemies and pickups appear around this point instead of anywhere on the map. */
export const spawnFocus: { x: number; z: number; r: number; on: boolean } = { x: 0, z: 0, r: 40, on: false };

export function blocked(blocks: Block[], x: number, z: number, radius: number) {
  if (Math.abs(x) > HALF - 1 || Math.abs(z) > HALF - 1) return true;
  if (blocks.length > 400) {
    const g = cellGrid(blocks);
    const half = BLOCK_HALF + radius;
    const i0 = Math.floor((x - half - BLOCK) / BLOCK), i1 = Math.floor((x + half + BLOCK) / BLOCK);
    const j0 = Math.floor((z - half - BLOCK) / BLOCK), j1 = Math.floor((z + half + BLOCK) / BLOCK);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const l = g.get(i * 100003 + j);
        if (l) for (const b of l) if (Math.abs(x - b.x) < half && Math.abs(z - b.z) < half) return true;
      }
    return false;
  }
  for (const b of blocks) {
    const half = BLOCK_HALF + radius;
    if (Math.abs(x - b.x) < half && Math.abs(z - b.z) < half) return true;
  }
  return false;
}

export function randomSpawn(blocks: Block[], rand: () => number) {
  // wide clearance first so even the biggest enemies never appear inside cover
  if (spawnFocus.on) {
    for (const clear of [1.8, 1.4, 1.1])
      for (let i = 0; i < 120; i++) {
        const a = rand() * Math.PI * 2, d = 12 + rand() * (spawnFocus.r - 12);
        const x = spawnFocus.x + Math.cos(a) * d, z = spawnFocus.z + Math.sin(a) * d;
        if (!blocked(blocks, x, z, clear)) return { x, z };
      }
    return { x: spawnFocus.x, z: spawnFocus.z };
  }
  for (const clear of [1.8, 1.4, 1.1]) {
    for (let i = 0; i < 80; i++) {
      const x = (rand() - 0.5) * (ARENA - 6);
      const z = (rand() - 0.5) * (ARENA - 6);
      if (!blocked(blocks, x, z, clear) && Math.hypot(x, z) > 10) return { x, z };
    }
  }
  // last resort: scan the grid for any genuinely open cell
  const cells = Math.floor(ARENA / BLOCK);
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      const x = -HALF + BLOCK / 2 + i * BLOCK;
      const z = -HALF + BLOCK / 2 + j * BLOCK;
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


// ---------- pathfinding (flow field over the block grid) ----------
export let CELLS = Math.floor(ARENA / BLOCK);

/** Resize the arena (co-op uses a bigger field). Call before generating a level. */
export function setArenaSize(size: number) {
  ARENA = size;
  HALF = size / 2;
  CELLS = Math.floor(size / BLOCK);
}

export const toCell = (v: number) =>
  Math.max(0, Math.min(CELLS - 1, Math.floor((v + HALF) / BLOCK)));
export const cellCenter = (i: number) => -HALF + BLOCK / 2 + i * BLOCK;

export function solidGrid(blocks: Block[]) {
  const g = new Uint8Array(CELLS * CELLS);
  for (const b of blocks) g[toCell(b.x) * CELLS + toCell(b.z)] = 1;
  // edge ring is against the arena wall — treat as solid for routing
  for (let i = 0; i < CELLS; i++) {
    g[i * CELLS] = g[i * CELLS + CELLS - 1] = 1;
    g[i] = g[(CELLS - 1) * CELLS + i] = 1;
  }
  return g;
}

const DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
] as const;

/** Distance (in steps) from every cell to the target cell. */
export function flowField(solid: Uint8Array, ti: number, tj: number) {
  const dist = new Float32Array(CELLS * CELLS).fill(Infinity);
  const q: number[] = [];
  const start = ti * CELLS + tj;
  dist[start] = 0;
  q.push(start);
  for (let h = 0; h < q.length; h++) {
    const c = q[h]!;
    const ci = Math.floor(c / CELLS);
    const cj = c % CELLS;
    for (const [di, dj] of DIRS) {
      const ni = ci + di;
      const nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= CELLS || nj >= CELLS) continue;
      const n = ni * CELLS + nj;
      if (solid[n]) continue;
      if (di && dj && (solid[(ci + di) * CELLS + cj] || solid[ci * CELLS + cj + dj])) continue;
      const nd = dist[c]! + (di && dj ? 1.414 : 1);
      if (CELLS > 100 && nd > 70) continue; // big maps: only route near the players
      if (nd < dist[n]!) {
        dist[n] = nd;
        q.push(n);
      }
    }
  }
  return dist;
}

/** World-space point the enemy should walk to next. */
export function nextWaypoint(solid: Uint8Array, dist: Float32Array, x: number, z: number) {
  const ci = toCell(x);
  const cj = toCell(z);
  let best = dist[ci * CELLS + cj]!;
  let bi = ci;
  let bj = cj;
  for (const [di, dj] of DIRS) {
    const ni = ci + di;
    const nj = cj + dj;
    if (ni < 0 || nj < 0 || ni >= CELLS || nj >= CELLS) continue;
    if (di && dj && (solid[(ci + di) * CELLS + cj] || solid[ci * CELLS + cj + dj])) continue;
    const d = dist[ni * CELLS + nj]!;
    if (d < best) {
      best = d;
      bi = ni;
      bj = nj;
    }
  }
  return { x: cellCenter(bi), z: cellCenter(bj) };
}

/** True when a straight walk from a to b is clear for the given radius. */
export function clearLine(blocks: Block[], ax: number, az: number, bx: number, bz: number, r: number) {
  const len = Math.hypot(bx - ax, bz - az);
  const steps = Math.ceil(len / 0.5);
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    if (blocked(blocks, ax + (bx - ax) * t, az + (bz - az) * t, r)) return false;
  }
  return true;
}
