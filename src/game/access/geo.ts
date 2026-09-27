// Triangle accumulator for the access geometry. Works in a building's local frame
// (a along the entrance facade, y up, d into the building) and writes world coordinates.
// Interiors get their lighting baked into vertex colours (soft point lights with falloff), so
// the lobby, car and stairwell are lit warmly without adding a single real light to the scene
// (every real light would cost every material in the city).
import * as THREE from "three";

export type Frame = { ox: number; oz: number; ix: number; iz: number; tx: number; tz: number };
export const IDENTITY: Frame = { ox: 0, oz: 0, ix: 0, iz: 1, tx: 1, tz: 0 };

export type BakeLight = { a: number; y: number; d: number; r: number; k: number; col?: string };

const _c = new THREE.Color();

export class IGeo {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  uv: number[] = [];
  f: Frame = IDENTITY;
  private r = 1;
  private g = 1;
  private b = 1;

  frame(f: Frame) {
    this.f = f;
    return this;
  }
  color(c: THREE.ColorRepresentation, k = 1) {
    _c.set(c);
    this.r = _c.r * k;
    this.g = _c.g * k;
    this.b = _c.b * k;
    return this;
  }
  private v(a: number, y: number, d: number, na: number, ny: number, nd: number, u: number, w: number) {
    const f = this.f;
    this.pos.push(f.ox + f.tx * a + f.ix * d, y, f.oz + f.tz * a + f.iz * d);
    this.nor.push(f.tx * na + f.ix * nd, ny, f.tz * na + f.iz * nd);
    this.col.push(this.r, this.g, this.b);
    this.uv.push(u, w);
  }
  /** quad p0 p1 p2 p3 counter-clockwise seen from the front (local coordinates [a, y, d]),
   * optionally subdivided n x m (for smooth baked light), uv spans [u0 v0 u1 v1] */
  quad(
    p0: number[],
    p1: number[],
    p2: number[],
    p3: number[],
    n = 1,
    m = 1,
    uv: readonly number[] = [0, 0, 1, 1],
  ) {
    const ux = p1[0]! - p0[0]!,
      uy = p1[1]! - p0[1]!,
      uz = p1[2]! - p0[2]!;
    const wx = p3[0]! - p0[0]!,
      wy = p3[1]! - p0[1]!,
      wz = p3[2]! - p0[2]!;
    // local frame is right-handed (a, y, d) ~ (x, y, z)
    let na = uy * wz - uz * wy;
    let ny = uz * wx - ux * wz;
    let nd = ux * wy - uy * wx;
    const l = Math.hypot(na, ny, nd) || 1;
    na /= l;
    ny /= l;
    nd /= l;
    const P = (s: number, t: number) => {
      // bilinear between the four corners
      const out = [0, 0, 0];
      for (let k = 0; k < 3; k++)
        out[k] =
          p0[k]! * (1 - s) * (1 - t) + p1[k]! * s * (1 - t) + p2[k]! * s * t + p3[k]! * (1 - s) * t;
      return out;
    };
    const [u0, v0, u1, v1] = uv as [number, number, number, number];
    for (let i = 0; i < n; i++)
      for (let j = 0; j < m; j++) {
        const s0 = i / n,
          s1 = (i + 1) / n,
          t0 = j / m,
          t1 = (j + 1) / m;
        const a = P(s0, t0),
          b = P(s1, t0),
          c = P(s1, t1),
          d = P(s0, t1);
        const U = (s: number) => u0 + (u1 - u0) * s;
        const V = (t: number) => v0 + (v1 - v0) * t;
        this.v(a[0]!, a[1]!, a[2]!, na, ny, nd, U(s0), V(t0));
        this.v(b[0]!, b[1]!, b[2]!, na, ny, nd, U(s1), V(t0));
        this.v(c[0]!, c[1]!, c[2]!, na, ny, nd, U(s1), V(t1));
        this.v(a[0]!, a[1]!, a[2]!, na, ny, nd, U(s0), V(t0));
        this.v(c[0]!, c[1]!, c[2]!, na, ny, nd, U(s1), V(t1));
        this.v(d[0]!, d[1]!, d[2]!, na, ny, nd, U(s0), V(t1));
      }
  }
  /** subdivision count for a length at a target tile size */
  static sub(len: number, tile = 0.7) {
    return Math.max(1, Math.min(24, Math.round(Math.abs(len) / tile)));
  }
  /** wall in the plane d (normal toward +d if facePlusD) spanning a0..a1 */
  wallD(a0: number, a1: number, y0: number, y1: number, d: number, facePlusD: boolean, tile = 0) {
    const n = tile ? IGeo.sub(a1 - a0, tile) : 1;
    const m = tile ? IGeo.sub(y1 - y0, tile) : 1;
    if (facePlusD) this.quad([a0, y0, d], [a1, y0, d], [a1, y1, d], [a0, y1, d], n, m);
    else this.quad([a1, y0, d], [a0, y0, d], [a0, y1, d], [a1, y1, d], n, m);
  }
  /** wall at a (normal toward +a if facePlusA) spanning d0..d1 */
  wallA(d0: number, d1: number, y0: number, y1: number, a: number, facePlusA: boolean, tile = 0) {
    const n = tile ? IGeo.sub(d1 - d0, tile) : 1;
    const m = tile ? IGeo.sub(y1 - y0, tile) : 1;
    if (facePlusA) this.quad([a, y0, d1], [a, y0, d0], [a, y1, d0], [a, y1, d1], n, m);
    else this.quad([a, y0, d0], [a, y0, d1], [a, y1, d1], [a, y1, d0], n, m);
  }
  /** horizontal rectangle facing up (or down) */
  flat(a0: number, a1: number, d0: number, d1: number, y: number, up = true, tile = 0) {
    const n = tile ? IGeo.sub(a1 - a0, tile) : 1;
    const m = tile ? IGeo.sub(d1 - d0, tile) : 1;
    if (up) this.quad([a0, y, d1], [a1, y, d1], [a1, y, d0], [a0, y, d0], n, m);
    else this.quad([a0, y, d0], [a1, y, d0], [a1, y, d1], [a0, y, d1], n, m);
  }
  /** solid box, outward faces; `skip` omits faces: "b" bottom, "t" top, "-a" "+a" "-d" "+d" */
  box(a0: number, a1: number, y0: number, y1: number, d0: number, d1: number, skip = "", tile = 0) {
    if (!skip.includes("t")) this.flat(a0, a1, d0, d1, y1, true, tile);
    if (!skip.includes("b")) this.flat(a0, a1, d0, d1, y0, false, tile);
    if (!skip.includes("-d")) this.wallD(a0, a1, y0, y1, d0, false, tile);
    if (!skip.includes("+d")) this.wallD(a0, a1, y0, y1, d1, true, tile);
    if (!skip.includes("-a")) this.wallA(d0, d1, y0, y1, a0, false, tile);
    if (!skip.includes("+a")) this.wallA(d0, d1, y0, y1, a1, true, tile);
  }
  /** vertical n-gon prism (outward), centre (a, d) */
  cyl(a: number, d: number, y0: number, h: number, r: number, seg = 10, top = true, r1 = r) {
    for (let i = 0; i < seg; i++) {
      const t0 = (i / seg) * Math.PI * 2;
      const t1 = ((i + 1) / seg) * Math.PI * 2;
      const A = [a + Math.cos(t0) * r, y0, d + Math.sin(t0) * r];
      const B = [a + Math.cos(t1) * r, y0, d + Math.sin(t1) * r];
      const C = [a + Math.cos(t1) * r1, y0 + h, d + Math.sin(t1) * r1];
      const D = [a + Math.cos(t0) * r1, y0 + h, d + Math.sin(t0) * r1];
      this.quad(B, A, D, C);
      if (top && r1 > 0.001) this.tri([a, y0 + h, d], C, D);
    }
  }
  tri(p0: number[], p1: number[], p2: number[]) {
    const ux = p1[0]! - p0[0]!,
      uy = p1[1]! - p0[1]!,
      uz = p1[2]! - p0[2]!;
    const wx = p2[0]! - p0[0]!,
      wy = p2[1]! - p0[1]!,
      wz = p2[2]! - p0[2]!;
    let na = uy * wz - uz * wy;
    let ny = uz * wx - ux * wz;
    let nd = ux * wy - uy * wx;
    const l = Math.hypot(na, ny, nd) || 1;
    na /= l;
    ny /= l;
    nd /= l;
    this.v(p0[0]!, p0[1]!, p0[2]!, na, ny, nd, 0, 0);
    this.v(p1[0]!, p1[1]!, p1[2]!, na, ny, nd, 1, 0);
    this.v(p2[0]!, p2[1]!, p2[2]!, na, ny, nd, 1, 1);
  }
  /** cone / pyramid */
  cone(a: number, d: number, y0: number, h: number, r: number, seg = 8) {
    for (let i = 0; i < seg; i++) {
      const t0 = (i / seg) * Math.PI * 2;
      const t1 = ((i + 1) / seg) * Math.PI * 2;
      this.tri(
        [a + Math.cos(t1) * r, y0, d + Math.sin(t1) * r],
        [a + Math.cos(t0) * r, y0, d + Math.sin(t0) * r],
        [a, y0 + h, d],
      );
    }
  }
  get count() {
    return this.pos.length / 3;
  }
  /**
   * Multiply vertex colours by baked light: ambient plus soft point lights (world-space
   * lights given in this geometry's local frame via `f`). Only vertices from `from` on.
   */
  bake(lights: BakeLight[], ambient: number, from = 0, f: Frame = this.f, cap = 1.0) {
    const L = lights.map((l) => {
      _c.set(l.col ?? "#fff1dc");
      return {
        x: f.ox + f.tx * l.a + f.ix * l.d,
        y: l.y,
        z: f.oz + f.tz * l.a + f.iz * l.d,
        r: l.r,
        k: l.k,
        cr: _c.r,
        cg: _c.g,
        cb: _c.b,
      };
    });
    for (let i = from; i < this.count; i++) {
      const px = this.pos[i * 3]!,
        py = this.pos[i * 3 + 1]!,
        pz = this.pos[i * 3 + 2]!;
      const nx = this.nor[i * 3]!,
        ny = this.nor[i * 3 + 1]!,
        nz = this.nor[i * 3 + 2]!;
      let r = ambient,
        g = ambient,
        b = ambient;
      for (const l of L) {
        const dx = l.x - px,
          dy = l.y - py,
          dz = l.z - pz;
        const dist = Math.hypot(dx, dy, dz) || 1e-3;
        const lam = Math.max(0, (dx * nx + dy * ny + dz * nz) / dist);
        const att = 1 / (1 + (dist / l.r) * (dist / l.r));
        const e = l.k * att * (0.3 + 0.7 * lam);
        r += e * l.cr;
        g += e * l.cg;
        b += e * l.cb;
      }
      // light never pushes a surface past its own colour (no blown-out white walls)
      const m = Math.max(r, g, b);
      const k = m > cap ? cap / m : 1;
      this.col[i * 3] = this.col[i * 3]! * r * k;
      this.col[i * 3 + 1] = this.col[i * 3 + 1]! * g * k;
      this.col[i * 3 + 2] = this.col[i * 3 + 2]! * b * k;
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    return g;
  }
}
