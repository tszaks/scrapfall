import { prepareDetailGeometry } from "../environment/detailQuality";
// Snow-laden spruce: cutout needle sprays nearby and solid boughs at distance.
// Both unit-height models share the existing instanced forest and trunk collision.
import * as THREE from "three";

type Build = { pos: number[]; col: number[]; nor: number[]; uv: number[] };
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
    b.uv.push(0.015, 0.015);
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
  g.setAttribute("uv", new THREE.Float32BufferAttribute(b.uv, 2));
  g.computeBoundingSphere();
  return g;
}

const NEEDLE = "#3e5947";
const SNOWC = "#eef3fa";
const RIM = "#b4c4c0";
const RIM2 = "#8ea49c";

/** near spruce, unit height, base radius ~0.22 */
export function spruceGeo(narrow = false, trunkOnly = false) {
  const b: Build = { pos: [], col: [], nor: [], uv: [] };
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
  // Radial branches carry interleaved needle sprays. Each spray has a fine cutout
  // silhouette rather than a solid triangular snow shelf; irregular levels overlap.
  const highDetail: [number, number][] = [];
  const rBase = narrow ? 0.17 : 0.225;
  const card = (root: number[], tip: number[], width: number, a: number, roll: number) => {
    const ux = -Math.sin(a) * Math.cos(roll),
      uz = Math.cos(a) * Math.cos(roll);
    const uy = Math.sin(roll);
    const A = [root[0]! - ux * width, root[1]! - uy * width, root[2]! - uz * width];
    const B = [root[0]! + ux * width, root[1]! + uy * width, root[2]! + uz * width];
    const C = [tip[0]! + ux * width * 0.6, tip[1]! + uy * width * 0.6, tip[2]! + uz * width * 0.6];
    const D = [tip[0]! - ux * width * 0.6, tip[1]! - uy * width * 0.6, tip[2]! - uz * width * 0.6];
    const start = b.uv.length;
    tri(b, A, B, C, "#ffffff");
    tri(b, A, C, D, "#ffffff");
    b.uv.splice(start, 12, 0.05, 0.12, 0.95, 0.12, 0.95, 0.98, 0.05, 0.12, 0.95, 0.98, 0.05, 0.98);
  };
  const levels = 12;
  for (let level = 0; level < levels; level++) {
    const t = level / levels;
    const y = 0.1 + t * 0.84;
    const arms = 6;
    for (let arm = 0; arm < arms; arm++) {
      const a = (arm * Math.PI * 2) / arms + level * 2.399;
      const radius =
        rBase * Math.pow(1 - t, 0.78) * (0.82 + 0.18 * Math.sin(arm * 3.7 + level * 1.9));
      const dx = Math.cos(a),
        dz = Math.sin(a);
      const root = [dx * 0.01, y + radius * 0.15, dz * 0.01];
      const tip = [dx * radius, y - radius * 0.2, dz * radius];
      // Branch wood connects the trunk to its needle spray, retaining visible gaps.
      tri(
        b,
        [root[0]! - dz * 0.005, root[1]!, root[2]! + dx * 0.005],
        tip,
        [root[0]! + dz * 0.005, root[1]! - 0.007, root[2]! - dx * 0.005],
        "#51422f",
      );
      card(root, tip, radius * 0.4, a, 0.25 * Math.sin(level + arm));
      const detailStart = b.pos.length / 3;
      card(root, tip, radius * 0.32, a, Math.PI * 0.38);
      if (level % 2 || arm % 2) highDetail.push([detailStart, b.pos.length / 3 - detailStart]);
    }
  }
  card([0, 0.88, 0], [0, 1, 0], 0.028, 0, 0);
  card([0, 0.88, 0], [0, 1, 0], 0.028, Math.PI / 2, 0);
  const geometry = toGeo(b);
  prepareDetailGeometry(geometry, highDetail);
  return geometry;
}

/** Solid overlapping boughs retain a forest silhouette beyond the needle texture mip range. */
export function farSpruceGeo() {
  const b: Build = { pos: [], col: [], nor: [], uv: [] };
  const shelf = (y: number, r: number, rot: number) => {
    const n = 8;
    const rim: number[][] = [];
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * Math.PI * 2;
      const rr = i % 2 ? r * 0.68 : r * (0.94 + 0.06 * Math.sin(i * 4.1 + rot));
      rim.push([Math.cos(a) * rr, y - (i % 2 ? 0 : r * 0.1), Math.sin(a) * rr]);
    }
    const apex = [0, y + r * 0.7, 0];
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
  shelf(0.12, 0.225, 0);
  shelf(0.28, 0.194, 2.399);
  shelf(0.44, 0.161, 4.798);
  shelf(0.6, 0.125, 7.197);
  shelf(0.76, 0.085, 9.596);
  shelf(0.9, 0.035, 11.995);
  return toGeo(b);
}

/** Original needle-and-snow spray atlas. The solid corner also serves trunks/far meshes. */
export function spruceTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const c = canvas.getContext("2d")!;
  c.fillStyle = "white";
  c.fillRect(0, 248, 12, 8);
  let seed = 731;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return (seed >>> 0) / 4294967296;
  };
  c.lineCap = "round";
  const branch = (x: number, y: number, tx: number, ty: number, snow: boolean) => {
    c.strokeStyle = "#493e2d";
    c.lineWidth = 2.3;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(tx, ty);
    c.stroke();
    const dx = tx - x,
      dy = ty - y,
      len = Math.hypot(dx, dy),
      nx = -dy / len,
      ny = dx / len;
    for (let j = 0; j < 22; j++) {
      const t = j / 22,
        bx = x + dx * t,
        by = y + dy * t,
        needle = 5 + (1 - t) * 7 + rand() * 4;
      for (const side of [-1, 1]) {
        c.strokeStyle = ["#263e30", "#36533d", "#476047", "#567152"][Math.floor(rand() * 4)]!;
        c.lineWidth = 2.6;
        c.beginPath();
        c.moveTo(bx, by);
        c.lineTo(
          bx + nx * needle * side + (dx / len) * 4,
          by + ny * needle * side + (dy / len) * 4,
        );
        c.stroke();
      }
    }
    if (snow) {
      for (let j = 2; j < 10; j++) {
        const t = j / 12,
          bx = x + dx * t,
          by = y + dy * t;
        c.fillStyle = j % 3 ? "#dce5e9" : "#f2f5f6";
        c.beginPath();
        c.ellipse(bx, by - 2, 5 + rand() * 3, 3 + rand() * 2, Math.atan2(dy, dx), 0, Math.PI * 2);
        c.fill();
      }
    }
  };
  branch(128, 222, 128, 15, false);
  for (let i = 0; i < 10; i++) {
    const y = 210 - i * 18,
      width = 80 * (1 - i / 13);
    branch(128, y, 128 - width, y - 32, i % 3 !== 1);
    branch(128, y - 6, 128 + width * (0.8 + rand() * 0.2), y - 43, i % 3 !== 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
