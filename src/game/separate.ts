// Crowd separation: enemies keep out of each other and out of the players so a pack
// doesn't stack into one blob. Fliers pass over everything on the ground but still hover
// clear of players' heads.
//
// The pair checks run through a dense flat grid (Int32Array head/next chains), not a
// Map of cells: no per-frame allocation, no hash lookups — O(1) cell access.
import { FLYERS } from "./enemyKinds";
import { blocked, type Block } from "./level";
import { climbable, ghostOK, groundY } from "./terrain";

const CELL = 2.5;
const KRAKEN_R = 4.2; // the beach boss's reach (Game.tsx KRAKEN_R)
const PLAYER_R = 0.4;
const EYE = 1.6;

export type SepBody = {
  alive: boolean;
  kind: string;
  x: number;
  z: number;
  elite?: number;
};

export type SepTarget = { x: number; z: number; y: number };

type SepDeps = {
  blocks: Block[];
  half: number;
  /** theme.boss.shape === "kraken" */
  kraken: boolean;
  /** the caller's kind -> body table (Game.tsx STATS) */
  stats: Record<string, { radius: number }>;
};

type Grid = {
  cols: number;
  head: Int32Array;
  tail: Int32Array;
  next: Int32Array;
};

let grid: Grid | null = null;
let deps: SepDeps;

function ensureGrid(bodies: readonly SepBody[], half: number): Grid {
  // one extra ring of cells covers bodies a little past the edge (they are clamped in)
  const cols = Math.max(8, Math.ceil((half * 2) / CELL) + 2);
  if (grid && grid.cols === cols && grid.next.length >= bodies.length) return grid;
  grid = {
    cols,
    head: new Int32Array(cols * cols),
    tail: new Int32Array(cols * cols),
    next: new Int32Array(Math.max(bodies.length, 64)),
  };
  return grid;
}

const cellX = (x: number, half: number, cols: number) =>
  Math.min(cols - 1, Math.max(0, Math.floor((x + half) / CELL)));

function bodyR(e: SepBody, kraken: boolean) {
  return e.kind === "boss" && kraken
    ? KRAKEN_R
    : deps.stats[e.kind]!.radius * (e.elite ? 1.6 : 1);
}

function nudge(e: SepBody, px: number, pz: number) {
  const rr = Math.min(deps.stats[e.kind]!.radius, 0.8);
  const ghost = e.kind === "specter";
  // (the crowd never pushes anyone up a step it couldn't walk: the tower face, a balcony edge)
  if (
    ghost
      ? ghostOK(e.x + px, e.z)
      : !blocked(deps.blocks, e.x + px, e.z, rr) && climbable(e.x, e.z, e.x + px, e.z)
  )
    e.x += px;
  if (
    ghost
      ? ghostOK(e.x, e.z + pz)
      : !blocked(deps.blocks, e.x, e.z + pz, rr) && climbable(e.x, e.z, e.x, e.z + pz)
  )
    e.z += pz;
}

/** one separation pass; `delta` is the frame's clamped step (same units as the old loop) */
export function separateEnemies(
  enemies: readonly SepBody[],
  targets: readonly SepTarget[],
  delta: number,
  d: SepDeps,
) {
  deps = d;
  const g = ensureGrid(enemies, d.half);
  const cols = g.cols;
  g.head.fill(-1);
  for (let ei = 0; ei < enemies.length; ei++) {
    const e = enemies[ei]!;
    if (!e.alive || FLYERS.has(e.kind)) continue;
    const k = cellX(e.x, d.half, cols) * cols + cellX(e.z, d.half, cols);
    // append, so cells iterate in the same order the old array cells did
    g.next[ei] = -1;
    if (g.head[k] === -1) g.head[k] = ei;
    else g.next[g.tail[k]!] = ei;
    g.tail[k] = ei;
  }
  const kraken = d.kraken;
  for (let ei = 0; ei < enemies.length; ei++) {
    const a = enemies[ei]!;
    if (!a.alive || FLYERS.has(a.kind)) continue;
    const ra = bodyR(a, kraken);
    const ci = cellX(a.x, d.half, cols);
    const cj = cellX(a.z, d.half, cols);
    for (let di = -1; di <= 1; di++) {
      const ii = ci + di;
      if (ii < 0 || ii >= cols) continue;
      for (let dj = -1; dj <= 1; dj++) {
        const jj = cj + dj;
        if (jj < 0 || jj >= cols) continue;
        for (let oj = g.head[ii * cols + jj]!; oj !== -1; oj = g.next[oj]!) {
          if (oj <= ei) continue;
          const b = enemies[oj]!;
          const rb = bodyR(b, kraken);
          const reach = (ra + rb) * 0.8;
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
      if (Math.abs(t.y - EYE - groundY(a.x, a.z)) > 1.8) continue;
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
      if (Math.abs(t.y - EYE - groundY(f.x, f.z)) > 3) continue;
      const r = deps.stats[f.kind]!.radius + PLAYER_R + 0.3;
      const ox = f.x - t.x;
      const oz = f.z - t.z;
      const dd = ox * ox + oz * oz;
      if (dd >= r * r) continue;
      const dist = Math.sqrt(dd) || 0.01;
      nudge(f, (ox / dist) * (r - dist), (oz / dist) * (r - dist));
    }
  }
}
