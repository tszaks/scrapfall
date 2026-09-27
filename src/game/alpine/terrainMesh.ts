// Terrain geometry for Whiteout Pass: the playable heightfield in 200 m chunks, square
// rings of ever coarser terrain out to the far range (so the valley feels endless), a
// surface-class texture for the terrain shader and a baked forest-density map that the
// far terrain and the far trees share.
import * as THREE from "three";

import { S_BLD, S_BLOCKADE, S_DECK, S_FOREST, S_ICE, S_PATH, S_PISTE, S_PLAZA, S_ROAD, S_ROCK, type AlpineData } from "./layout";
import { fbm, hash2, naturalHeight, smooth } from "./noise";

export const TCHUNK = 200;

export type TerrainChunk = { x0: number; z0: number; x1: number; z1: number; geo: THREE.BufferGeometry };

/** the playable terrain, from the layout's heightfield (the same surface players walk on) */
export function playTerrain(a: AlpineData): TerrainChunk[] {
  const t = a.terrain;
  const n = t.n;
  const s = n + 1;
  const H = t.h;
  const hv = (i: number, j: number) => {
    if (i >= 0 && j >= 0 && i <= n && j <= n) return H[i * s + j]!;
    return naturalHeight(-t.half + i * t.cell, -t.half + j * t.cell);
  };
  const per = TCHUNK / t.cell;
  const out: TerrainChunk[] = [];
  for (let ci = 0; ci < n / per; ci++)
    for (let cj = 0; cj < n / per; cj++) {
      const i0 = ci * per;
      const j0 = cj * per;
      const vcount = (per + 1) * (per + 1);
      const pos = new Float32Array(vcount * 3);
      const nor = new Float32Array(vcount * 3);
      let k = 0;
      for (let a2 = 0; a2 <= per; a2++)
        for (let b = 0; b <= per; b++) {
          const i = i0 + a2;
          const j = j0 + b;
          pos[k * 3] = -t.half + i * t.cell;
          pos[k * 3 + 1] = hv(i, j);
          pos[k * 3 + 2] = -t.half + j * t.cell;
          const dx = hv(i + 1, j) - hv(i - 1, j);
          const dz = hv(i, j + 1) - hv(i, j - 1);
          const l = Math.hypot(dx, 2 * t.cell, dz) || 1;
          nor[k * 3] = -dx / l;
          nor[k * 3 + 1] = (2 * t.cell) / l;
          nor[k * 3 + 2] = -dz / l;
          k++;
        }
      const idx = new Uint32Array(per * per * 6);
      let q = 0;
      for (let a2 = 0; a2 < per; a2++)
        for (let b = 0; b < per; b++) {
          const v0 = a2 * (per + 1) + b;
          const v1 = v0 + 1;
          const v2 = v0 + per + 1;
          const v3 = v2 + 1;
          idx[q++] = v0;
          idx[q++] = v1;
          idx[q++] = v2;
          idx[q++] = v1;
          idx[q++] = v3;
          idx[q++] = v2;
        }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.computeBoundingBox();
      geo.computeBoundingSphere();
      out.push({ x0: -t.half + i0 * t.cell, z0: -t.half + j0 * t.cell, x1: -t.half + (i0 + per) * t.cell, z1: -t.half + (j0 + per) * t.cell, geo });
    }
  return out;
}

/**
 * The land beyond the play area: square rings (400-800 m, 800-1600, ... 12.8 km), each a
 * 100 x 100 grid with the inner quarter left out, plus a skirt hiding the seams.
 */
export function outerTerrain(half: number) {
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  let base = 0;
  const N = 100;
  let inner = half;
  for (let ring = 0; ring < 5; ring++) {
    const outer = inner * 2;
    const step = (outer * 2) / N;
    const H = new Float32Array((N + 3) * (N + 3));
    const at = (i: number, j: number) => H[(i + 1) * (N + 3) + (j + 1)]!;
    for (let i = -1; i <= N + 1; i++)
      for (let j = -1; j <= N + 1; j++) H[(i + 1) * (N + 3) + (j + 1)] = naturalHeight(-outer + i * step, -outer + j * step);
    const vid = new Int32Array((N + 1) * (N + 1)).fill(-1);
    const lo = Math.round((outer - inner) / step);
    const hi = N - lo;
    const inHole = (i: number, j: number) => i > lo && i < hi && j > lo && j < hi;
    for (let i = 0; i <= N; i++)
      for (let j = 0; j <= N; j++) {
        if (inHole(i, j)) continue;
        vid[i * (N + 1) + j] = base++;
        const x = -outer + i * step;
        const z = -outer + j * step;
        pos.push(x, at(i, j), z);
        const dx = at(i + 1, j) - at(i - 1, j);
        const dz = at(i, j + 1) - at(i, j - 1);
        const l = Math.hypot(dx, 2 * step, dz) || 1;
        nor.push(-dx / l, (2 * step) / l, -dz / l);
      }
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++) {
        if (i >= lo && i < hi && j >= lo && j < hi) continue;
        const v0 = vid[i * (N + 1) + j]!;
        const v1 = vid[i * (N + 1) + j + 1]!;
        const v2 = vid[(i + 1) * (N + 1) + j]!;
        const v3 = vid[(i + 1) * (N + 1) + j + 1]!;
        if (v0 < 0 || v1 < 0 || v2 < 0 || v3 < 0) continue;
        idx.push(v0, v1, v2, v1, v3, v2);
      }
    // skirt on the inner edge: drop a curtain so T-junction cracks never show sky
    const drop = step * 1.5;
    const edge: [number, number][] = [];
    for (let i = lo; i < hi; i++) edge.push([i, lo]);
    for (let j = lo; j < hi; j++) edge.push([hi, j]);
    for (let i = hi; i > lo; i--) edge.push([i, hi]);
    for (let j = hi; j > lo; j--) edge.push([lo, j]);
    for (let e = 0; e < edge.length; e++) {
      const [i, j] = edge[e]!;
      const [i2, j2] = edge[(e + 1) % edge.length]!;
      const a = vid[i * (N + 1) + j]!;
      const b = vid[i2 * (N + 1) + j2]!;
      if (a < 0 || b < 0) continue;
      const ax = pos[a * 3]!;
      const ay = pos[a * 3 + 1]!;
      const az = pos[a * 3 + 2]!;
      const bx = pos[b * 3]!;
      const by = pos[b * 3 + 1]!;
      const bz = pos[b * 3 + 2]!;
      pos.push(ax, ay - drop, az, bx, by - drop, bz);
      nor.push(0, 1, 0, 0, 1, 0);
      const c = base++;
      const d = base++;
      idx.push(a, c, b, b, c, d, a, b, c, b, d, c);
    }
    inner = outer;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

/** surface classes per 2 m cell as RGBA: packed snow, piste, ice, forest floor */
export function surfTexture(a: AlpineData) {
  const n = Math.round((a.terrain.half * 2) / 2);
  const data = new Uint8Array(n * n * 4);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const k = a.surf[i * n + j]!;
      const o = (j * n + i) * 4; // texture x = world x, texture y = world z
      data[o] = k === S_PATH || k === S_PLAZA || k === S_ROAD || k === S_DECK || k === S_BLD ? 255 : 0;
      data[o + 1] = k === S_PISTE ? 255 : 0;
      data[o + 2] = k === S_ICE ? 255 : k === S_ROCK ? 90 : 0;
      data[o + 3] = k === S_FOREST ? 255 : k === S_BLOCKADE ? 160 : 0;
      if (k === S_ROAD) data[o + 2] = 40;
    }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

// ---- the forest beyond the play area ----
export const FOREST_EXTENT = 3200;
/** 0..1 how densely forested the land is at (x, z) (outside the play area) */
export function forestDensity(x: number, z: number, h: number, slope: number) {
  let d = 0.35 + 0.9 * (fbm(x / 260, z / 260, 3, 311) - 0.45);
  d *= 1 - smooth(330, 520, h); // tree line
  d *= 1 - smooth(0.7, 1.1, slope);
  // meadows and clearings on the valley floor
  if (h < 30) d *= smooth(0.45, 0.6, fbm(x / 140, z / 140, 2, 97));
  return Math.max(0, Math.min(1, d));
}

export function forestTexture() {
  const n = 256;
  const data = new Uint8Array(n * n * 4);
  const step = (FOREST_EXTENT * 2) / n;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const x = -FOREST_EXTENT + (i + 0.5) * step;
      const z = -FOREST_EXTENT + (j + 0.5) * step;
      const h = naturalHeight(x, z);
      const s = (Math.abs(naturalHeight(x + 12, z) - naturalHeight(x - 12, z)) + Math.abs(naturalHeight(x, z + 12) - naturalHeight(x, z - 12))) / 24;
      const o = (j * n + i) * 4;
      data[o] = Math.round(forestDensity(x, z, h, s) * 255);
      data[o + 3] = 255;
    }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** far-LOD trees on the land just beyond the play area (visual only) */
export function farTrees(half: number, reach: number) {
  const out: number[] = []; // x, y, z, h, rot
  const G = 9;
  for (let x = -reach; x < reach; x += G)
    for (let z = -reach; z < reach; z += G) {
      if (Math.abs(x) < half + 2 && Math.abs(z) < half + 2) continue;
      const jx = x + (hash2(Math.round(x), Math.round(z), 5) - 0.5) * G * 0.9;
      const jz = z + (hash2(Math.round(x), Math.round(z), 6) - 0.5) * G * 0.9;
      if (Math.abs(jx) < half + 1 && Math.abs(jz) < half + 1) continue;
      const h = naturalHeight(jx, jz);
      const s = (Math.abs(naturalHeight(jx + 6, jz) - naturalHeight(jx - 6, jz)) + Math.abs(naturalHeight(jx, jz + 6) - naturalHeight(jx, jz - 6))) / 12;
      const d = forestDensity(jx, jz, h, s);
      if (hash2(Math.round(jx * 3), Math.round(jz * 3), 9) > d) continue;
      out.push(jx, h, jz, 9 + hash2(Math.round(jx), Math.round(jz), 11) * 11, hash2(Math.round(jx), Math.round(jz), 12) * 6.28);
    }
  return out;
}
