import { prepareDetailGeometry } from "../environment/detailQuality";
// Snow-laden spruce for Whiteout Pass: one near model (jagged drooping tiers, snow on
// every tier, a visible trunk) and one far model (two cones), both unit-height, drawn as
// instanced meshes per chunk so the whole forest costs a couple of dozen draw calls.
import * as THREE from "three";

type Build = { pos: number[]; col: number[]; nor: number[] };
const _c = new THREE.Color();

function tri(b: Build, a: number[], c: number[], d: number[], col: string, k = 1) {
  const ux = c[0]! - a[0]!;
  const uy = c[1]! - a[1]!;
  const uz = c[2]! - a[2]!;
  const wx = d[0]! - a[0]!;
  const wy = d[1]! - a[1]!;
  const wz = d[2]! - a[2]!;
  let nx = uy * wz - uz * wy;
  let ny = uz * wx - ux * wz;
  let nz = ux * wy - uy * wx;
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l;
  ny /= l;
  nz /= l;
  _c.set(col).multiplyScalar(k);
  for (const p of [a, c, d]) {
    b.pos.push(p[0]!, p[1]!, p[2]!);
    b.nor.push(nx, ny, nz);
    b.col.push(_c.r, _c.g, _c.b);
  }
}

/**
 * One tier of a snow-laden spruce: a white snow shelf sloping up from a jagged rim, a band
 * of dark drooping branch tips below the rim, and (low tiers) a dark underside.
 */
function tier(
  b: Build,
  y: number,
  r: number,
  pts: number,
  rot: number,
  under: boolean,
  shelf: number,
) {
  const rim: number[][] = [];
  for (let i = 0; i < pts * 2; i++) {
    const a = rot + (i / (pts * 2)) * Math.PI * 2;
    const tip = i % 2 === 0;
    const rr = tip ? r : r * 0.74;
    rim.push([Math.cos(a) * rr, y - (tip ? r * 0.1 : 0), Math.sin(a) * rr]);
  }
  const apex = [0, y + r * shelf, 0];
  const fringe = r * 0.34;
  for (let i = 0; i < rim.length; i++) {
    const p = rim[i]!;
    const q = rim[(i + 1) % rim.length]!;
    // snow shelf, thinner (showing needles) towards the branch tips
    triC(b, p, apex, q, i % 2 ? RIM2 : RIM, SNOWC, i % 2 ? RIM : RIM2);
    // needle fringe hanging below the rim
    const pd = [p[0]! * 0.9, p[1]! - fringe, p[2]! * 0.9];
    const qd = [q[0]! * 0.9, q[1]! - fringe, q[2]! * 0.9];
    tri(b, p, q, pd, NEEDLE, i % 2 ? 0.85 : 1);
    tri(b, q, qd, pd, NEEDLE, i % 2 ? 0.75 : 0.9);
    if (under) tri(b, qd, [0, y - fringe * 0.6, 0], pd, "#3e5e4a");
  }
}

/** triangle with a colour per corner */
function triC(b: Build, a: number[], c: number[], d: number[], ca: string, cc: string, cd: string) {
  const n0 = b.col.length;
  tri(b, a, c, d, ca);
  for (const [k, col] of [
    [1, cc],
    [2, cd],
  ] as const) {
    _c.set(col);
    b.col[n0 + k * 3] = _c.r;
    b.col[n0 + k * 3 + 1] = _c.g;
    b.col[n0 + k * 3 + 2] = _c.b;
  }
}

function toGeo(b: Build) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(b.nor, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(b.col, 3));
  g.computeBoundingSphere();
  return g;
}

const NEEDLE = "#3e5947";
const SNOWC = "#eef3fa";
const RIM = "#b4c4c0";
const RIM2 = "#8ea49c";

/** near spruce, unit height, base radius ~0.22 */
export function spruceGeo(narrow = false, trunkOnly = false) {
  const b: Build = { pos: [], col: [], nor: [] };
  // trunk
  const tr = 0.024;
  for (let i = 0; i < 5; i++) {
    const a0 = (i / 5) * Math.PI * 2;
    const a1 = ((i + 1) / 5) * Math.PI * 2;
    const p0 = [Math.cos(a0) * tr, -0.05, Math.sin(a0) * tr];
    const p1 = [Math.cos(a1) * tr, -0.05, Math.sin(a1) * tr];
    // the trunk runs right up through every tier to the leader, so no tier floats
    const q0 = [Math.cos(a0) * tr * 0.25, 0.97, Math.sin(a0) * tr * 0.25];
    const q1 = [Math.cos(a1) * tr * 0.25, 0.97, Math.sin(a1) * tr * 0.25];
    tri(b, p0, q0, p1, "#4a3526");
    tri(b, p1, q0, q1, "#4a3526");
  }
  if (trunkOnly) return toGeo(b);
  // Open, irregular branch whorls. Snow rests on individual boughs, not solid cones.
  // Stay inside the old crown bounds so ski routes and trunk collision do not change.
  const n = narrow ? 9 : 8;
  const highDetail: [number, number][] = [];
  const rBase = narrow ? 0.14 : 0.18;
  for (let level = 0; level < n; level++) {
    const detailStart = b.pos.length / 3;
    const t = level / n;
    const y = 0.11 + t * 0.76;
    for (let arm = 0; arm < 7; arm++) {
      const a = (arm * Math.PI * 2) / 7 + level * 1.73;
      const r = rBase * (1 - t * 0.82) * (0.86 + 0.14 * Math.sin(arm * 7 + level * 3));
      const dx = Math.cos(a),
        dz = Math.sin(a);
      for (let twig = 0; twig < 3; twig++) {
        const twigStart = b.pos.length / 3;
        const f = 0.15 + twig * 0.28;
        const width = r * (1 - f) * 0.62;
        const cy = y + Math.sin(f * Math.PI) * r * 0.2 - f * r * 0.18;
        const root = [dx * r * f, cy, dz * r * f];
        const tip = [dx * r * (f + 0.28), cy - r * 0.12, dz * r * (f + 0.28)];
        const left = [root[0]! - dz * width, cy - r * 0.07, root[2]! + dx * width];
        const right = [root[0]! + dz * width, cy - r * 0.07, root[2]! - dx * width];
        tri(b, root, left, tip, NEEDLE, 0.85 + f * 0.15);
        tri(b, root, tip, right, NEEDLE);
        const hanging = [root[0]!, cy - r * 0.28, root[2]!];
        tri(b, left, hanging, tip, NEEDLE, 0.8);
        tri(b, tip, hanging, right, NEEDLE, 0.85);
        // A narrow snow ridge leaves needles visible along each edge.
        const ridge = [root[0]!, cy + r * 0.04, root[2]!];
        const snowTip = [tip[0]! * 0.91, tip[1]! + r * 0.035, tip[2]! * 0.91];
        triC(
          b,
          ridge,
          [root[0]! - dz * width * 0.55, cy, root[2]! + dx * width * 0.55],
          snowTip,
          SNOWC,
          RIM,
          RIM2,
        );
        triC(
          b,
          ridge,
          snowTip,
          [root[0]! + dz * width * 0.55, cy, root[2]! - dx * width * 0.55],
          SNOWC,
          RIM2,
          RIM,
        );
        if (twig === 1) highDetail.push([twigStart, b.pos.length / 3 - twigStart]);
      }
    }
    if (narrow ? level % 3 === 1 : level === 1 || level === 5)
      highDetail.push([detailStart, b.pos.length / 3 - detailStart]);
  }
  // snowy leader at the top
  tier(b, 0.9, rBase * 0.12, 4, 0.3, false, 0.9);
  const tip = [0, 1, 0];
  const base = 0.88;
  for (let i = 0; i < 4; i++) {
    const a0 = (i / 4) * Math.PI * 2;
    const a1 = ((i + 1) / 4) * Math.PI * 2;
    tri(
      b,
      [Math.cos(a0) * 0.02, base, Math.sin(a0) * 0.02],
      tip,
      [Math.cos(a1) * 0.02, base, Math.sin(a1) * 0.02],
      SNOWC,
    );
  }
  const geometry = toGeo(b);
  prepareDetailGeometry(geometry, highDetail);
  return geometry;
}

/** far spruce: three snow shelves over short dark fringes, a fraction of the near cost */
export function farSpruceGeo() {
  const b: Build = { pos: [], col: [], nor: [] };
  const shelf = (y: number, r: number, rot: number) => {
    const n = 10;
    const rim: number[][] = [];
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * Math.PI * 2;
      const rr = i % 2 ? r * 0.72 : r;
      rim.push([Math.cos(a) * rr, y - (i % 2 ? 0 : r * 0.1), Math.sin(a) * rr]);
    }
    const apex = [0, y + r * 1.0, 0];
    for (let i = 0; i < n; i++) {
      const p = rim[i]!;
      const q = rim[(i + 1) % n]!;
      triC(b, p, apex, q, i % 2 ? RIM2 : RIM, SNOWC, i % 2 ? RIM : RIM2);
      tri(b, p, q, [p[0]! * 0.2, p[1]! - r * 0.5, p[2]! * 0.2], NEEDLE, 0.9);
    }
  };
  // a trunk to the ground, and shelves reaching low (no floating umbrellas at the edge)
  for (let i = 0; i < 4; i++) {
    const a0 = (i / 4) * Math.PI * 2;
    const a1 = ((i + 1) / 4) * Math.PI * 2;
    const tr = 0.03;
    tri(
      b,
      [Math.cos(a0) * tr, -0.2, Math.sin(a0) * tr],
      [Math.cos(a0) * tr * 0.5, 0.9, Math.sin(a0) * tr * 0.5],
      [Math.cos(a1) * tr, -0.2, Math.sin(a1) * tr],
      "#4a3526",
    );
    tri(
      b,
      [Math.cos(a1) * tr, -0.2, Math.sin(a1) * tr],
      [Math.cos(a0) * tr * 0.5, 0.9, Math.sin(a0) * tr * 0.5],
      [Math.cos(a1) * tr * 0.5, 0.9, Math.sin(a1) * tr * 0.5],
      "#4a3526",
    );
  }
  shelf(0.16, 0.24, 0);
  shelf(0.4, 0.19, 0.6);
  shelf(0.62, 0.13, 1.2);
  shelf(0.82, 0.07, 1.8);
  return toGeo(b);
}
