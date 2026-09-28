// Geometry scans for Pacific Pier: coplanar overlapping triangles (z-fighting), floating or
// buried things, and moving-part clearance. Run: npx jiti scripts/beach-scan.ts
import type * as THREE from "three";
import { setArenaSize, generateLevel, BEACH_SIZE } from "../src/game/level";
import { groundY as groundAt, setTerrain } from "../src/game/terrain";
import { beachTerrain } from "../src/game/beach/terrain";
import { isBeach, DECK } from "../src/game/beach/beachLayout";
import { buildBeachMeshes } from "../src/game/beach/beachMesh";

const TOL = Number(process.env.TOL || 0.01); // plane distance tolerance (m)
const MIN_AREA = Number(process.env.MINA || 0.05); // m^2 of overlap to count
type T = {
  a: number[];
  b: number[];
  c: number[];
  layer: string;
  cx: number;
  cy: number;
  cz: number;
};

function tris(
  g: THREE.BufferGeometry | null,
  layer: string,
  out: Map<string, (T & { n: number[]; d: number })[]>,
) {
  if (!g) return;
  const p = g.getAttribute("position");
  for (let i = 0; i + 2 < p.count; i += 3) {
    const a = [p.getX(i), p.getY(i), p.getZ(i)],
      b = [p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)],
      c = [p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
      w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const l = Math.hypot(n[0], n[1], n[2]);
    if (l < 1e-6) continue;
    n = n.map((x) => x / l);
    const d = n[0] * a[0] + n[1] * a[1] + n[2] * a[2];
    const key = `${Math.round(n[0] * 200)},${Math.round(n[1] * 200)},${Math.round(n[2] * 200)}|${Math.round(d / 0.5)}`;
    const t = {
      a,
      b,
      c,
      n,
      d,
      layer,
      cx: (a[0] + b[0] + c[0]) / 3,
      cy: (a[1] + b[1] + c[1]) / 3,
      cz: (a[2] + b[2] + c[2]) / 3,
    };
    let arr = out.get(key);
    if (!arr) out.set(key, (arr = []));
    arr.push(t);
  }
}
// 2D projection on the plane
function basis(n: number[]) {
  const up = Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  let u = [up[1] * n[2] - up[2] * n[1], up[2] * n[0] - up[0] * n[2], up[0] * n[1] - up[1] * n[0]];
  const l = Math.hypot(...u);
  u = u.map((x) => x / l);
  const v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  return { u, v };
}
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
type P = [number, number];
function clip(subject: P[], clipPoly: P[]): P[] {
  let out = subject;
  for (let i = 0; i < clipPoly.length; i++) {
    const A = clipPoly[i],
      B = clipPoly[(i + 1) % clipPoly.length];
    const inside = (p: P) => (B[0] - A[0]) * (p[1] - A[1]) - (B[1] - A[1]) * (p[0] - A[0]) >= -1e-9;
    const inp = out;
    out = [];
    for (let j = 0; j < inp.length; j++) {
      const P1 = inp[j],
        P2 = inp[(j + 1) % inp.length];
      const i1 = inside(P1),
        i2 = inside(P2);
      if (i1) out.push(P1);
      if (i1 !== i2) {
        const x1 = P1[0],
          y1 = P1[1],
          x2 = P2[0],
          y2 = P2[1],
          x3 = A[0],
          y3 = A[1],
          x4 = B[0],
          y4 = B[1];
        const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
        if (Math.abs(den) < 1e-12) continue;
        const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
        out.push([x1 + t * (x2 - x1), y1 + t * (y2 - y1)]);
      }
    }
    if (!out.length) break;
  }
  return out;
}
const area = (p: P[]) => {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i],
      b = p[(i + 1) % p.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
};
const ccw = (p: P[]) => (area(p) < 0 ? [...p].reverse() : p);

setArenaSize(BEACH_SIZE, 2);
const lv = generateLevel(1000, "beach", true);
if (isBeach(lv.city)) setTerrain(beachTerrain(lv.city));
const city = lv.city!;
if (!isBeach(city)) throw new Error("not beach");
const m = buildBeachMeshes(city);
const groups = new Map<string, any[]>();
for (const c of m.chunks)
  if (!c.far) {
    tris(c.main, "main", groups);
    tris(c.detail, "detail", groups);
    tris(c.signs, "signs", groups);
  }
let hits = 0,
  hitArea = 0,
  carHits = 0;
const cats = new Map<string, number>();
const where: string[] = [];
for (const [key, arr] of groups) {
  const [nk, dk] = key.split("|");
  const cand = [...arr];
  const nb = groups.get(`${nk}|${Number(dk) + 1}`);
  if (nb) cand.push(...nb.map((t: any) => ({ ...t, _nb: true })));
  const { u, v } = basis(arr[0].n);
  const proj = cand.map((t: any) => {
    const pts = ccw([t.a, t.b, t.c].map((q: number[]) => [dot(q, u), dot(q, v)] as P));
    let x0 = Infinity,
      x1 = -Infinity,
      y0 = Infinity,
      y1 = -Infinity;
    for (const q of pts) {
      x0 = Math.min(x0, q[0]);
      x1 = Math.max(x1, q[0]);
      y0 = Math.min(y0, q[1]);
      y1 = Math.max(y1, q[1]);
    }
    return { t, pts, x0, x1, y0, y1 };
  });
  const idx = proj
    .map((_: any, i: number) => i)
    .sort((a: number, b: number) => proj[a].x0 - proj[b].x0);
  for (let ii = 0; ii < idx.length; ii++) {
    const A = proj[idx[ii]];
    for (let jj = ii + 1; jj < idx.length; jj++) {
      const B = proj[idx[jj]];
      if (B.x0 > A.x1 - 1e-4) break;
      if (A.t._nb && B.t._nb) continue;
      if (B.y0 > A.y1 - 1e-4 || B.y1 < A.y0 + 1e-4) continue;
      if (Math.abs(A.t.d - B.t.d) > TOL) continue;
      const inter = clip(A.pts, B.pts);
      if (inter.length < 3) continue;
      const Ar = Math.abs(area(inter));
      if (Ar < MIN_AREA) continue;
      hits++;
      hitArea += Ar;
      if (
        city.beach.parked.some(
          (c) => Math.hypot(c.x - A.t.cx, c.z - A.t.cz) < 3.2 && Math.abs(c.y - A.t.cy) < 2.5,
        )
      )
        carHits++;
      const cat = `${A.t.layer}/${B.t.layer} n${A.t.n.map((x: number) => Math.round(x)).join("")} x${Math.round(A.t.cx / 40) * 40} y${Math.round(A.t.cy)}`;
      cats.set(cat, (cats.get(cat) ?? 0) + 1);
      if (where.length < 25 && (!process.env.ONLY || A.t.layer === process.env.ONLY))
        where.push(
          `${A.t.layer}/${B.t.layer} (${A.t.cx.toFixed(1)},${A.t.cy.toFixed(1)},${A.t.cz.toFixed(1)}) n=(${A.t.n.map((x: number) => x.toFixed(2))}) A=${Ar.toFixed(2)}`,
        );
    }
  }
}
console.log(
  `z-fight: ${hits} coplanar overlapping triangle pairs, ${hitArea.toFixed(1)} m^2 (${carHits} of them inside parked cars' own parts)`,
);
for (const w of where.slice(0, process.env.V ? 25 : 0)) console.log("  " + w);
for (const [k, v] of [...cats].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log("  ", v, k);

// ---- floating / buried ----
const B = city.beach;
const gv = (x: number, z: number) => groundAt(x, z);
let floatB = 0,
  buriedB = 0;
for (const b of B.buildings) {
  if (b.backdrop || b.y0 > 3) continue;
  let lo = Infinity,
    hi = -Infinity;
  for (let i = 0; i <= 4; i++)
    for (let j = 0; j <= 4; j++) {
      const x = b.x0 + ((b.x1 - b.x0) * i) / 4,
        z = b.z0 + ((b.z1 - b.z0) * j) / 4;
      const h = x > 228 ? b.y0 : Math.min(gv(x + 0.01, z + 0.01), 99);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
  if (lo < b.y0 - 1.5) {
    floatB++;
    console.log("  building floats", b.t, b.x0, b.z0, lo.toFixed(2));
  }
  if (hi > b.y0 + 0.35) {
    buriedB++;
    console.log("  building buried", b.t, b.x0, b.z0, hi.toFixed(2));
  }
}
let floatP = 0;
for (const p of B.props) {
  if (
    p.k === "buoy" ||
    p.k === "globe" ||
    p.k === "rod" ||
    p.k === "scope" ||
    p.k === "flag" ||
    p.k === "sign66" ||
    p.y > 5
  )
    continue;
  const g = groundAt(p.x, p.z);
  if (Math.abs(g - p.y) > 0.3) {
    floatP++;
    if (floatP < 8)
      console.log(
        "  prop off the ground",
        p.k,
        p.x.toFixed(1),
        p.z.toFixed(1),
        p.y.toFixed(2),
        g.toFixed(2),
      );
  }
}
let floatC = 0;
for (const c of B.parked) {
  for (const [dx, dz] of [
    [-2, -1],
    [2, 1],
    [-2, 1],
    [2, -1],
  ]) {
    const g = groundAt(c.x + dx, c.z + dz);
    if (Math.abs(g - c.y) > 0.25) {
      floatC++;
      break;
    }
  }
}
console.log(
  `floating/buried: buildings ${floatB}/${buriedB}, props off ground ${floatP} of ${B.props.length}, parked cars off level ground ${floatC} of ${B.parked.length}`,
);
// ---- moving parts ----
const w = B.wheel;
const gondolaLow = w.y - w.r - 2.9;
console.log(
  `ferris wheel: lowest gondola bottom ${(gondolaLow - DECK).toFixed(2)} m above the deck (base platform top +1.2)`,
);
const cMin = Math.min(...B.coaster.pts.map((p) => p[1]));
console.log(`coaster: lowest rail ${(cMin - DECK).toFixed(2)} m above the deck; car top +1.25`);

// ---- tilt: tall faces (uprights: posts, poles, legs, piles, walls) that lean 2-30 degrees ----
{
  const cats = new Map<string, number>();
  let n = 0;
  for (const c of m.chunks) {
    if (c.far) continue;
    for (const g of [c.main, c.detail]) {
      if (!g) continue;
      const p = g.getAttribute("position");
      for (let i = 0; i + 2 < p.count; i += 3) {
        const ys = [p.getY(i), p.getY(i + 1), p.getY(i + 2)];
        if (Math.max(...ys) - Math.min(...ys) < 1.5) continue;
        const ax = p.getX(i),
          az = p.getZ(i);
        const ux = p.getX(i + 1) - ax,
          uy = ys[1]! - ys[0]!,
          uz = p.getZ(i + 1) - az;
        const wx = p.getX(i + 2) - ax,
          wy = ys[2]! - ys[0]!,
          wz = p.getZ(i + 2) - az;
        const nx = uy * wz - uz * wy,
          ny = uz * wx - ux * wz,
          nz = ux * wy - uy * wx;
        const l = Math.hypot(nx, ny, nz) || 1;
        const tilt = Math.abs(ny / l);
        if (tilt < Math.sin((2 * Math.PI) / 180) || tilt > Math.sin((12 * Math.PI) / 180)) continue;
        // where: which structure is it?
        // foliage and rocks are meant to be irregular: skip green canopies/shrubs and the stones
        const col = g.getAttribute("color");
        const r0 = col.getX(i),
          g0 = col.getY(i),
          b0 = col.getZ(i);
        if ((g0 > r0 && g0 > b0) || (Math.abs(r0 - 0.323) < 0.03 && Math.abs(g0 - 0.254) < 0.03))
          continue;
        const x = ax,
          z = az;
        const w = city.beach.wheel;
        const what =
          Math.hypot(x - w.x, z - w.z) < 14
            ? "ferris wheel A-frame (deliberate)"
            : x < -40 && x > -125 && z > 8 && z < 34
              ? "coaster track/ties"
              : x > 228 && x < 262
                ? "bluff stair cheek walls (follow the slope)"
                : "other";
        cats.set(what, (cats.get(what) ?? 0) + 1);
        if ((what === "other" || process.env.T === "all") && n < 400 && process.env.T)
          console.log("   tilt at", x.toFixed(1), ys[0]!.toFixed(1), z.toFixed(1), tilt.toFixed(3));
        n++;
      }
    }
  }
  console.log(
    `tilt: ${n} tall faces lean 2-12 deg (a leaning upright; shrubs and tree canopies are steeper)`,
  );
  for (const [k, v] of cats) console.log("  ", v, k);
}
