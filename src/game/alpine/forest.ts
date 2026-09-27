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

/** a jagged cone tier: `pts` alternating outer / inner radii, apex above */
function tier(b: Build, y0: number, y1: number, r: number, pts: number, col: string, snow: string, rot: number) {
  const ring: number[][] = [];
  for (let i = 0; i < pts * 2; i++) {
    const a = rot + (i / (pts * 2)) * Math.PI * 2;
    const rr = i % 2 ? r * 0.62 : r;
    // branch tips droop a little below the tier base
    ring.push([Math.cos(a) * rr, y0 - (i % 2 ? 0 : r * 0.12), Math.sin(a) * rr]);
  }
  const apex = [0, y1, 0];
  const mid = (p: number[], t: number) => [p[0]! * (1 - t), p[1]! + (y1 - p[1]!) * t, p[2]! * (1 - t)];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    // needles on the lower half, snow resting on the upper half
    const pm = mid(p, 0.45);
    const qm = mid(q, 0.45);
    tri(b, p, pm, q, col, i % 2 ? 0.8 : 1);
    tri(b, q, pm, qm, col, i % 2 ? 0.8 : 1);
    const lift = (v: number[]) => [v[0]! * 1.04, v[1]! + 0.012, v[2]! * 1.04];
    tri(b, lift(pm), apex, lift(qm), snow, i % 2 ? 0.92 : 1);
    // a clump of snow on each branch tip
    if (i % 2 === 0) {
      const t0 = mid(p, 0.1);
      tri(b, lift(t0), lift(pm), lift(mid(ring[(i + ring.length - 1) % ring.length]!, 0.3)), snow, 0.96);
    }
    // underside, dark
    tri(b, p, q, [0, y0 + (y1 - y0) * 0.1, 0], "#16241c");
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

const NEEDLE = "#2c4636";
const SNOWC = "#eef3fa";

/** near spruce, unit height, base radius ~0.21 */
export function spruceGeo(narrow = false) {
  const b: Build = { pos: [], col: [], nor: [] };
  // trunk
  const tr = 0.022;
  for (let i = 0; i < 5; i++) {
    const a0 = (i / 5) * Math.PI * 2;
    const a1 = ((i + 1) / 5) * Math.PI * 2;
    const p0 = [Math.cos(a0) * tr, -0.05, Math.sin(a0) * tr];
    const p1 = [Math.cos(a1) * tr, -0.05, Math.sin(a1) * tr];
    const q0 = [Math.cos(a0) * tr * 0.6, 0.35, Math.sin(a0) * tr * 0.6];
    const q1 = [Math.cos(a1) * tr * 0.6, 0.35, Math.sin(a1) * tr * 0.6];
    tri(b, p0, q0, p1, "#4a3526");
    tri(b, p1, q0, q1, "#4a3526");
  }
  const n = narrow ? 5 : 4;
  const rBase = narrow ? 0.16 : 0.22;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const y0 = 0.1 + t * 0.78;
    const y1 = Math.min(1, y0 + (narrow ? 0.3 : 0.36));
    tier(b, y0, i === n - 1 ? 1 : y1, rBase * (1 - t * 0.78), 7, NEEDLE, SNOWC, i * 0.7);
  }
  return toGeo(b);
}

/** far spruce: two plain cones with snowy tops */
export function farSpruceGeo() {
  const b: Build = { pos: [], col: [], nor: [] };
  const cone = (y0: number, y1: number, r: number, snowFrom: number) => {
    const seg = 6;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      const p = [Math.cos(a0) * r, y0, Math.sin(a0) * r];
      const q = [Math.cos(a1) * r, y0, Math.sin(a1) * r];
      const pm = [p[0]! * (1 - snowFrom), y0 + (y1 - y0) * snowFrom, p[2]! * (1 - snowFrom)];
      const qm = [q[0]! * (1 - snowFrom), y0 + (y1 - y0) * snowFrom, q[2]! * (1 - snowFrom)];
      tri(b, p, pm, q, NEEDLE);
      tri(b, q, pm, qm, NEEDLE);
      tri(b, pm, [0, y1, 0], qm, SNOWC, 0.95);
    }
  };
  cone(0.08, 0.62, 0.21, 0.45);
  cone(0.45, 1, 0.14, 0.4);
  return toGeo(b);
}
