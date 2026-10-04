// Low-level geometry accumulator for the city: one interleaved vertex stream per mesh
// (position, normal, colour, facade uv, facade params), so a whole chunk of buildings,
// props and ground merges into a handful of draw calls.
import * as THREE from "three";
import { prepareDetailGeometry } from "./environment/detailQuality";

import { L, MODULE_W } from "./cityTextures";

/** floats per vertex: pos 3, normal 3, colour 3, uv 2, fac 3 (layer, seed, building flag) */
export const STRIDE = 14;
const _c = new THREE.Color();

export type P2 = [number, number];

/** A frozen chunk of local-space vertices that can be stamped many times. */
export type Tmpl = {
  data: Float32Array;
  count: number;
  nonSolid?: [number, number][];
  highDetail?: [number, number][];
};

export class Geo {
  buf = new Float32Array(STRIDE * 2048);
  n = 0;
  private highDetail: [number, number][] = [];
  highDetailSince(start: number) {
    if (this.n > start) this.highDetail.push([start, this.n - start]);
  }
  private nonSolid: [number, number][] = [];
  decoration<T>(draw: () => T): T {
    const start = this.n;
    const out = draw();
    this.excludeSince(start);
    return out;
  }
  excludeSince(start: number) {
    if (this.n > start) this.nonSolid.push([start, this.n - start]);
  }
  private L = 0;
  private S = 0;
  private F = 0;
  private r = 1;
  private g = 1;
  private b = 1;

  private grow(extra: number) {
    const need = (this.n + extra) * STRIDE;
    if (need <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < need) cap *= 2;
    const nb = new Float32Array(cap);
    nb.set(this.buf.subarray(0, this.n * STRIDE));
    this.buf = nb;
  }
  /** facade layer, per-building seed (0..1) and building flag (1 = ground-level darkening) */
  mat(layer: number, seed = this.S, flag = this.F) {
    this.L = layer;
    this.S = seed;
    this.F = flag;
    return this;
  }
  col(c: THREE.ColorRepresentation, k = 1) {
    _c.set(c);
    this.r = _c.r * k;
    this.g = _c.g * k;
    this.b = _c.b * k;
    return this;
  }
  colLinear(r: number, g: number, b: number) {
    this.r = r;
    this.g = g;
    this.b = b;
    return this;
  }
  v(x: number, y: number, z: number, nx: number, ny: number, nz: number, u = 0, w = 0) {
    this.grow(1);
    const o = this.n * STRIDE;
    const a = this.buf;
    a[o] = x;
    a[o + 1] = y;
    a[o + 2] = z;
    a[o + 3] = nx;
    a[o + 4] = ny;
    a[o + 5] = nz;
    a[o + 6] = this.r;
    a[o + 7] = this.g;
    a[o + 8] = this.b;
    a[o + 9] = u;
    a[o + 10] = w;
    a[o + 11] = this.L;
    a[o + 12] = this.S;
    a[o + 13] = this.F;
    this.n++;
  }
  /** a b c d counter-clockwise seen from the front; uv = [u0, v0, u1, v1] (a = u0 v0, c = u1 v1) */
  quad(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
    dx: number,
    dy: number,
    dz: number,
    uv: readonly number[] = Q01,
  ) {
    // face normal from the geometry
    const ux = bx - ax,
      uy = by - ay,
      uz = bz - az;
    const wx = dx - ax,
      wy = dy - ay,
      wz = dz - az;
    let nx = uy * wz - uz * wy;
    let ny = uz * wx - ux * wz;
    let nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const [u0, v0, u1, v1] = uv as [number, number, number, number];
    this.v(ax, ay, az, nx, ny, nz, u0, v0);
    this.v(bx, by, bz, nx, ny, nz, u1, v0);
    this.v(cx, cy, cz, nx, ny, nz, u1, v1);
    this.v(ax, ay, az, nx, ny, nz, u0, v0);
    this.v(cx, cy, cz, nx, ny, nz, u1, v1);
    this.v(dx, dy, dz, nx, ny, nz, u0, v1);
  }
  tri(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
  ) {
    const ux = bx - ax,
      uy = by - ay,
      uz = bz - az;
    const wx = cx - ax,
      wy = cy - ay,
      wz = cz - az;
    let nx = uy * wz - uz * wy;
    let ny = uz * wx - ux * wz;
    let nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    this.v(ax, ay, az, nx, ny, nz);
    this.v(bx, by, bz, nx, ny, nz);
    this.v(cx, cy, cz, nx, ny, nz);
  }
  /** vertical wall along the outline edge p -> q (outline counter-clockwise from above = -y) */
  wall(p: P2, q: P2, y0: number, y1: number, uv: readonly number[] = Q01) {
    this.quad(q[0], y0, q[1], p[0], y0, p[1], p[0], y1, p[1], q[0], y1, q[1], uv);
  }
  /** horizontal ground-facing-up rectangle */
  flat(x0: number, z0: number, x1: number, z1: number, y: number, uv: readonly number[] = Q01) {
    this.quad(x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z0, uv);
  }
  /** fan-triangulated convex cap facing up (or down) */
  cap(poly: P2[], y: number, down = false) {
    const [p0] = poly;
    for (let i = 1; i + 1 < poly.length; i++) {
      const a = poly[i]!;
      const b = poly[i + 1]!;
      if (down) this.tri(p0![0], y, p0![1], a[0], y, a[1], b[0], y, b[1]);
      else this.tri(p0![0], y, p0![1], b[0], y, b[1], a[0], y, a[1]);
    }
  }
  /** axis-aligned box (centre x/z, from y0 up), no bottom */
  box(x: number, y0: number, z: number, w: number, h: number, d: number, top = true) {
    const x0 = x - w / 2,
      x1 = x + w / 2,
      z0 = z - d / 2,
      z1 = z + d / 2,
      y1 = y0 + h;
    const poly: P2[] = [
      [x0, z0],
      [x1, z0],
      [x1, z1],
      [x0, z1],
    ];
    for (let i = 0; i < 4; i++) this.wall(poly[i]!, poly[(i + 1) % 4]!, y0, y1);
    if (top) this.cap(poly, y1);
  }
  /** box rotated about y by `rot` (local +z maps to (sin rot, cos rot)) */
  obox(x: number, y0: number, z: number, w: number, h: number, d: number, rot: number, top = true) {
    const s = Math.sin(rot);
    const c = Math.cos(rot);
    const pt = (lx: number, lz: number): P2 => [x + lx * c + lz * s, z - lx * s + lz * c];
    const poly: P2[] = [pt(-w / 2, -d / 2), pt(w / 2, -d / 2), pt(w / 2, d / 2), pt(-w / 2, d / 2)];
    for (let i = 0; i < 4; i++) this.wall(poly[i]!, poly[(i + 1) % 4]!, y0, y0 + h);
    if (top) this.cap(poly, y0 + h);
  }
  /** vertical prism with an n-gon section (cylinder-ish), from y0 up */
  cyl(x: number, y0: number, z: number, r: number, h: number, seg = 8, top = true, r1 = r) {
    const a: P2[] = [];
    const b: P2[] = [];
    for (let i = 0; i < seg; i++) {
      const t = (i / seg) * Math.PI * 2;
      a.push([x + Math.cos(t) * r, z + Math.sin(t) * r]);
      b.push([x + Math.cos(t) * r1, z + Math.sin(t) * r1]);
    }
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      const p = a[i]!,
        q = a[j]!,
        pt = b[i]!,
        qt = b[j]!;
      this.quad(q[0], y0, q[1], p[0], y0, p[1], pt[0], y0 + h, pt[1], qt[0], y0 + h, qt[1]);
    }
    if (top && r1 > 0.001) this.cap(b, y0 + h);
  }
  /** Hollow, capped masonry rim: open center stays open to rendering and collision. */
  ring(x: number, y: number, z: number, outer: number, inner: number, h: number, seg = 48) {
    this.cyl(x, y, z, outer, h, seg, false);
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2,
        b = ((i + 1) / seg) * Math.PI * 2;
      const ax = x + Math.cos(a) * inner,
        az = z + Math.sin(a) * inner;
      const bx = x + Math.cos(b) * inner,
        bz = z + Math.sin(b) * inner;
      this.quad(ax, y, az, bx, y, bz, bx, y + h, bz, ax, y + h, az);
      this.quad(
        ax,
        y + h,
        az,
        bx,
        y + h,
        bz,
        x + Math.cos(b) * outer,
        y + h,
        z + Math.sin(b) * outer,
        x + Math.cos(a) * outer,
        y + h,
        z + Math.sin(a) * outer,
      );
    }
  }
  /** pointed n-sided spire */
  cone(x: number, y0: number, z: number, r: number, h: number, seg = 4, rot = Math.PI / 4) {
    for (let i = 0; i < seg; i++) {
      const t0 = rot + (i / seg) * Math.PI * 2;
      const t1 = rot + ((i + 1) / seg) * Math.PI * 2;
      this.tri(
        x + Math.cos(t1) * r,
        y0,
        z + Math.sin(t1) * r,
        x + Math.cos(t0) * r,
        y0,
        z + Math.sin(t0) * r,
        x,
        y0 + h,
        z,
      );
    }
  }
  /** stamp a template: rotate about y, scale, translate */
  stamp(
    t: Tmpl,
    x: number,
    y: number,
    z: number,
    rot = 0,
    sx = 1,
    sy = 1,
    sz = 1,
    tint?: THREE.Color,
  ) {
    this.grow(t.count);
    for (const [start, count] of t.highDetail ?? []) this.highDetail.push([this.n + start, count]);
    for (const [start, count] of t.nonSolid ?? []) this.nonSolid.push([this.n + start, count]);
    const s = Math.sin(rot);
    const c = Math.cos(rot);
    const src = t.data;
    const a = this.buf;
    let o = this.n * STRIDE;
    for (let i = 0; i < t.count; i++) {
      const k = i * STRIDE;
      const lx = src[k]! * sx;
      const ly = src[k + 1]! * sy;
      const lz = src[k + 2]! * sz;
      a[o] = x + lx * c + lz * s;
      a[o + 1] = y + ly;
      a[o + 2] = z - lx * s + lz * c;
      // normals: rotate (non-uniform scale is small enough to ignore)
      const nx = src[k + 3]!;
      const nz = src[k + 5]!;
      a[o + 3] = nx * c + nz * s;
      a[o + 4] = src[k + 4]!;
      a[o + 5] = -nx * s + nz * c;
      a[o + 6] = src[k + 6]! * (tint ? tint.r : 1);
      a[o + 7] = src[k + 7]! * (tint ? tint.g : 1);
      a[o + 8] = src[k + 8]! * (tint ? tint.b : 1);
      a[o + 9] = src[k + 9]!;
      a[o + 10] = src[k + 10]!;
      a[o + 11] = src[k + 11]!;
      a[o + 12] = src[k + 12]!;
      a[o + 13] = src[k + 13]!;
      o += STRIDE;
    }
    this.n += t.count;
  }
  freeze(): Tmpl {
    return {
      data: this.buf.slice(0, this.n * STRIDE),
      count: this.n,
      nonSolid: this.nonSolid.slice(),
      highDetail: this.highDetail.slice(),
    };
  }
  /** append a three.js geometry through a matrix (plain layer, current colour) */
  add(g: THREE.BufferGeometry, m: THREE.Matrix4) {
    const src = g.index ? g.toNonIndexed() : g;
    const pos = src.getAttribute("position");
    const nor = src.getAttribute("normal");
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const p = new THREE.Vector3();
    const q = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(m);
      q.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
      this.v(p.x, p.y, p.z, q.x, q.y, q.z);
    }
    if (src !== g) src.dispose();
  }
  /** build a BufferGeometry; `uvName` is "aUv2" for the facade material, "uv" for textured basics */
  build(uvName = "aUv2") {
    const g = new THREE.BufferGeometry();
    const ib = new THREE.InterleavedBuffer(this.buf.slice(0, this.n * STRIDE), STRIDE);
    g.setAttribute("position", new THREE.InterleavedBufferAttribute(ib, 3, 0));
    g.setAttribute("normal", new THREE.InterleavedBufferAttribute(ib, 3, 3));
    g.setAttribute("color", new THREE.InterleavedBufferAttribute(ib, 3, 6));
    g.setAttribute(uvName, new THREE.InterleavedBufferAttribute(ib, 2, 9));
    g.setAttribute("aFac", new THREE.InterleavedBufferAttribute(ib, 3, 11));
    g.userData["nonSolid"] = this.nonSolid.slice();
    prepareDetailGeometry(g, this.highDetail);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
export const Q01 = [0, 0, 1, 1] as const;

/** outward side index of an outline edge: 0 -z, 1 +x, 2 +z, 3 -x, -1 diagonal */
export function sideOf(p: P2, q: P2) {
  const dx = q[0] - p[0];
  const dz = q[1] - p[1];
  const l = Math.hypot(dx, dz) || 1;
  const nx = dz / l;
  const nz = -dx / l;
  if (nz < -0.9) return 0;
  if (nx > 0.9) return 1;
  if (nz > 0.9) return 2;
  if (nx < -0.9) return 3;
  return -1;
}

/** inset a convex, counter-clockwise outline by d metres */
export function insetPoly(poly: P2[], d: number): P2[] {
  const n = poly.length;
  const lines: { px: number; pz: number; dx: number; dz: number }[] = [];
  for (let i = 0; i < n; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % n]!;
    let dx = q[0] - p[0];
    let dz = q[1] - p[1];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    // inward normal is (-dz, dx)
    lines.push({ px: p[0] - dz * d, pz: p[1] + dx * d, dx, dz });
  }
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const a = lines[(i + n - 1) % n]!;
    const b = lines[i]!;
    const den = a.dx * b.dz - a.dz * b.dx;
    if (Math.abs(den) < 1e-6) {
      out.push([b.px, b.pz]);
      continue;
    }
    const t = ((b.px - a.px) * b.dz - (b.pz - a.pz) * b.dx) / den;
    out.push([a.px + a.dx * t, a.pz + a.dz * t]);
  }
  return out;
}

export function scalePoly(poly: P2[], k: number): P2[] {
  let cx = 0;
  let cz = 0;
  for (const p of poly) {
    cx += p[0];
    cz += p[1];
  }
  cx /= poly.length;
  cz /= poly.length;
  return poly.map((p) => [cx + (p[0] - cx) * k, cz + (p[1] - cz) * k]);
}

/** rectangle outline, counter-clockwise from above */
export const rectPoly = (x0: number, z0: number, x1: number, z1: number): P2[] => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
];

/** facade UVs for one wall: whole modules across, storeys up */
export function facadeUV(
  layer: number,
  faceW: number,
  ya: number,
  yb: number,
  fh: number,
  uOff: number,
  vOff: number,
) {
  const mods = Math.max(1, Math.round(faceW / (MODULE_W[layer] ?? 3)));
  return [uOff, vOff + ya / fh, uOff + mods, vOff + yb / fh] as const;
}

export { L };
