export type Block = { x: number; z: number; h: number; tone: number };

export const ARENA = 44; // world size (centered at origin)
export const HALF = ARENA / 2;
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

export function blocked(blocks: Block[], x: number, z: number, radius: number) {
  if (Math.abs(x) > HALF - 1 || Math.abs(z) > HALF - 1) return true;
  for (const b of blocks) {
    const half = BLOCK / 2 + radius;
    if (Math.abs(x - b.x) < half && Math.abs(z - b.z) < half) return true;
  }
  return false;
}

export function randomSpawn(blocks: Block[], rand: () => number) {
  for (let i = 0; i < 60; i++) {
    const x = (rand() - 0.5) * (ARENA - 6);
    const z = (rand() - 0.5) * (ARENA - 6);
    if (!blocked(blocks, x, z, 1) && Math.hypot(x, z) > 10) return { x, z };
  }
  return { x: HALF - 4, z: HALF - 4 };
}
