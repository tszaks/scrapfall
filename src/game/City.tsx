// Renders the "city" map: every building (arena + backdrop skyline) is merged into a
// handful of meshes by material, street furniture is instanced, and night mode only
// flips material parameters (lit-window emissive maps, glowing bulbs, fake light pools).
import { useFrame } from "@react-three/fiber";
import { memo, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { K_PARK, K_ROAD, K_WALK, type Building, type CityLayout } from "./cityLayout";
import {
  TILE_COLS,
  TILE_ROWS,
  adsTexture,
  facadeTextures,
  glowTexture,
  type FacadeKind,
} from "./cityTextures";
import { signal, GREEN, YELLOW } from "./trafficCore";

type V3 = [number, number, number];
const _col = new THREE.Color();

/** Tiny non-indexed geometry accumulator with per-vertex colours. */
class Geo {
  p: number[] = [];
  n: number[] = [];
  u: number[] = [];
  c: number[] = [];
  private vert(v: V3, nn: V3, uv: [number, number]) {
    this.p.push(v[0], v[1], v[2]);
    this.n.push(nn[0], nn[1], nn[2]);
    this.u.push(uv[0], uv[1]);
    this.c.push(_col.r, _col.g, _col.b);
  }
  /** a b c d counter-clockwise seen from the front; uv = [u0, v0, u1, v1] */
  quad(
    a: V3,
    b: V3,
    c: V3,
    d: V3,
    nn: V3,
    color: THREE.ColorRepresentation,
    uv: [number, number, number, number] = [0, 0, 1, 1],
  ) {
    _col.set(color);
    const [u0, v0, u1, v1] = uv;
    this.vert(a, nn, [u0, v0]);
    this.vert(b, nn, [u1, v0]);
    this.vert(c, nn, [u1, v1]);
    this.vert(a, nn, [u0, v0]);
    this.vert(c, nn, [u1, v1]);
    this.vert(d, nn, [u0, v1]);
  }
  /** axis-aligned box from y0 up, optional per-side uv provider */
  box(
    x: number,
    y0: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: THREE.ColorRepresentation,
    opt: {
      top?: boolean;
      bottom?: boolean;
      sides?: boolean;
      uv?: (faceW: number) => [number, number, number, number];
    } = {},
  ) {
    const x0 = x - w / 2,
      x1 = x + w / 2,
      z0 = z - d / 2,
      z1 = z + d / 2,
      y1 = y0 + h;
    const uv = opt.uv;
    if (opt.sides !== false) {
      this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], color, uv?.(w));
      this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], color, uv?.(w));
      this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], color, uv?.(d));
      this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], color, uv?.(d));
    }
    if (opt.top !== false)
      this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], color);
    if (opt.bottom)
      this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], color);
  }
  /** append any three.js geometry through a transform */
  add(g: THREE.BufferGeometry, m: THREE.Matrix4, color: THREE.ColorRepresentation) {
    const src = g.index ? g.toNonIndexed() : g;
    const pos = src.getAttribute("position");
    const nor = src.getAttribute("normal");
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const v = new THREE.Vector3();
    _col.set(color);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      this.p.push(v.x, v.y, v.z);
      v.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
      this.n.push(v.x, v.y, v.z);
      this.u.push(0, 0);
      this.c.push(_col.r, _col.g, _col.b);
    }
    if (src !== g) src.dispose();
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return g;
  }
}

const PALETTE: Record<Building["style"], string[]> = {
  glass: ["#6fb3c8", "#4f86b8", "#7cc8b8", "#5a7898", "#8fb0c8", "#b8a878", "#3f6f8f"],
  office: ["#d8d2c4", "#bfb8aa", "#e6e0d2", "#a8a49c", "#cfc4b0", "#9aa0a6", "#c9b99a"],
  brick: ["#a4543c", "#8e5a44", "#b8704a", "#7a4032", "#c08a6a", "#9a6a50"],
  deco: ["#f4a8bc", "#9fe2c9", "#f9e2a8", "#a9d9f2", "#f7c29c", "#d9bcf2", "#fbf6ee"],
  shop: ["#f4a8bc", "#9fe2c9", "#f9e2a8", "#e6e0d2", "#b8704a", "#a9d9f2"],
};
const TEX: Record<Building["style"], FacadeKind> = {
  glass: "glass",
  office: "office",
  brick: "brick",
  deco: "office",
  shop: "brick",
};
const FLOOR: Record<FacadeKind, number> = { glass: 2.5, office: 2.8, brick: 2.9 };
const WIN_W: Record<FacadeKind, number> = { glass: 1.3, office: 1.6, brick: 1.8 };
const NEON = ["#ff4fa0", "#3affd8", "#ffe14a", "#9a6aff", "#ff7a3a"];
const AWNING = ["#d8403a", "#2e8a6a", "#2a5aa8", "#e8a82a", "#f4f4f4", "#ff6fae"];

type Groups = {
  facade: Record<FacadeKind, Geo>;
  plain: Geo;
  glow: Geo;
  ads: Geo;
  beacons: V3[];
};

/** deterministic per-building sub-random, from the building's own rolls */
function sub(b: Building) {
  let a = Math.floor(b.roll * 1e9) ^ Math.floor(b.tone * 7e8);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CYL = new THREE.CylinderGeometry(1, 1, 1, 10);
const CONE = new THREE.ConeGeometry(1, 1, 10);
const RING = new THREE.RingGeometry(0.82, 1, 24).rotateX(-Math.PI / 2);
const BEACON = new THREE.SphereGeometry(1, 6, 4);
const _mat4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const place = (x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0) =>
  _mat4.compose(
    _v.set(x, y, z),
    _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry),
    _s.set(sx, sy, sz),
  );

function addBuilding(b: Building, G: Groups) {
  const r = sub(b);
  const pal = PALETTE[b.style];
  const color = pal[Math.floor(b.tone * pal.length)]!;
  const kind = TEX[b.style];
  const fh = FLOOR[kind];
  const h = Math.max(fh, Math.round(b.h / fh) * fh);
  const roof = b.style === "glass" ? "#3a4048" : "#6a6862";

  // facade uv: whole windows across each face, floors anchored to world height
  const facade = (
    x: number,
    y0: number,
    z: number,
    w: number,
    hh: number,
    d: number,
    col: string,
    k: FacadeKind = kind,
  ) => {
    const f = FLOOR[k];
    const uOff = Math.floor(r() * TILE_COLS) / TILE_COLS;
    const vOff = Math.floor(r() * TILE_ROWS) / TILE_ROWS;
    const v0 = Math.round(y0 / f) / TILE_ROWS + vOff;
    const v1 = v0 + Math.max(1, Math.round(hh / f)) / TILE_ROWS;
    G.facade[k].box(x, y0, z, w, hh, d, col, {
      top: false,
      uv: (faceW) => [uOff, v0, uOff + Math.max(1, Math.round(faceW / WIN_W[k])) / TILE_COLS, v1],
    });
  };
  const roofCap = (x: number, y: number, z: number, w: number, d: number) =>
    G.plain.box(x, y - 0.02, z, w, 0.04, d, roof, { sides: false });

  let topY = h;
  let topW = b.w;
  let topD = b.d;

  if (b.backdrop) {
    facade(b.x, 0, b.z, b.w, h, b.d, color);
    roofCap(b.x, h, b.z, b.w, b.d);
    if (b.style === "glass" && b.roll > 0.5 && h > 30) {
      facade(b.x, h, b.z, b.w * 0.7, fh * 3, b.d * 0.7, color);
      roofCap(b.x, h + fh * 3, b.z, b.w * 0.7, b.d * 0.7);
      topY = h + fh * 3;
    }
    if (topY > 42) G.beacons.push([b.x, topY + 0.6, b.z]);
    return;
  }

  if (b.style === "glass") {
    const split = h > 30 && b.roll < 0.6 ? Math.round((h * 0.62) / fh) * fh : h;
    facade(b.x, 0, b.z, b.w, split, b.d, color);
    if (split < h) {
      G.plain.box(b.x, split, b.z, b.w + 0.2, 0.3, b.d + 0.2, "#dfe6ea");
      topW = b.w - 1.2;
      topD = b.d - 1.2;
      facade(b.x, split + 0.3, b.z, topW, h - split - 0.3, topD, color);
    }
    roofCap(b.x, h, b.z, topW, topD);
    if (b.roll > 0.45 && !b.helipad) {
      // crown + spire
      facade(b.x, h, b.z, topW * 0.62, fh * 2, topD * 0.62, color);
      G.plain.box(b.x, h + fh * 2, b.z, topW * 0.66, 0.3, topD * 0.66, "#dfe6ea");
      topY = h + fh * 2 + 0.3;
      topW *= 0.6;
      topD *= 0.6;
    }
  } else if (b.style === "office") {
    const tiers = h > 30 ? 3 : h > 16 ? 2 : 1;
    const fr = tiers === 3 ? [0.5, 0.32, 0.18] : tiers === 2 ? [0.65, 0.35] : [1];
    let y = 0;
    let w = b.w;
    let d = b.d;
    for (let t = 0; t < tiers; t++) {
      const hh = t === tiers - 1 ? h - y : Math.max(fh, Math.round((h * fr[t]!) / fh) * fh);
      facade(b.x, y, b.z, w, hh, d, color);
      y += hh;
      G.plain.box(b.x, y, b.z, w + 0.25, 0.35, d + 0.25, "#e8e2d4");
      y += 0.35;
      if (t < tiers - 1) {
        w = Math.max(2, w - b.w * 0.16);
        d = Math.max(2, d - b.d * 0.16);
      }
    }
    topY = y;
    topW = w;
    topD = d;
    roofCap(b.x, y, b.z, w, d);
  } else if (b.style === "brick" || b.style === "shop") {
    const store = b.style === "shop" || b.roll < 0.45;
    if (store) {
      // storefront glass at street level with an awning and a sign
      facade(b.x, 0, b.z, b.w + 0.06, 2.6, b.d + 0.06, "#6a7a86", "glass");
      facade(b.x, 2.6, b.z, b.w, h - 2.6, b.d, color);
      G.plain.box(
        b.x,
        2.7,
        b.z,
        b.w + 1.1,
        0.14,
        b.d + 1.1,
        AWNING[Math.floor(r() * AWNING.length)]!,
      );
      const side = Math.floor(r() * 4);
      const sw = (side < 2 ? b.w : b.d) * 0.6;
      const off = (side < 2 ? b.d : b.w) / 2 + 0.06;
      const sx = side === 2 ? off : side === 3 ? -off : 0;
      const sz = side === 0 ? off : side === 1 ? -off : 0;
      G.glow.box(
        b.x + sx,
        3.1,
        b.z + sz,
        side < 2 ? sw : 0.08,
        0.55,
        side < 2 ? 0.08 : sw,
        NEON[Math.floor(r() * NEON.length)]!,
      );
    } else {
      facade(b.x, 0, b.z, b.w, h, b.d, color);
    }
    G.plain.box(
      b.x,
      h - 0.35,
      b.z,
      b.w + 0.3,
      0.45,
      b.d + 0.3,
      b.style === "brick" ? "#d8cfc0" : "#ffffff",
    );
    roofCap(b.x, h + 0.1, b.z, b.w + 0.3, b.d + 0.3);
    topY = h + 0.1;
  } else {
    // art deco: pastel body, white bands, stepped crown, a vertical fin and a neon crown strip
    facade(b.x, 0, b.z, b.w, h, b.d, color);
    for (const f of [0.33, 0.66])
      G.plain.box(
        b.x,
        Math.round((h * f) / fh) * fh - 0.15,
        b.z,
        b.w + 0.12,
        0.3,
        b.d + 0.12,
        "#fbf8f2",
      );
    G.plain.box(b.x, h, b.z, b.w + 0.2, 0.4, b.d + 0.2, "#fbf8f2");
    G.glow.box(
      b.x,
      h - 0.55,
      b.z,
      b.w + 0.1,
      0.14,
      b.d + 0.1,
      NEON[Math.floor(r() * NEON.length)]!,
    );
    let y = h + 0.4;
    let w = b.w * 0.72;
    let d = b.d * 0.72;
    for (let t = 0; t < 2; t++) {
      const hh = t === 0 ? 1.8 : 1.3;
      G.plain.box(b.x, y, b.z, w, hh, d, color);
      y += hh;
      w *= 0.65;
      d *= 0.65;
    }
    topY = y;
    topW = w;
    topD = d;
    const onZ = r() < 0.5;
    const fs = r() < 0.5 ? 1 : -1;
    G.plain.box(
      b.x + (onZ ? 0 : fs * (b.w / 2 + 0.15)),
      0,
      b.z + (onZ ? fs * (b.d / 2 + 0.15) : 0),
      onZ ? 0.5 : 0.3,
      h + 2.2,
      onZ ? 0.3 : 0.5,
      "#fbf8f2",
    );
  }

  // ---- rooftop dressing ----
  if (b.helipad) {
    const rad = Math.min(topW, topD) * 0.45;
    G.plain.add(CYL, place(b.x, topY + 0.1, b.z, rad, 0.2, rad), "#2a2d33");
    G.plain.add(RING, place(b.x, topY + 0.215, b.z, rad * 0.8, 1, rad * 0.8), "#f2c21a");
    const hs = rad * 0.5;
    G.plain.box(b.x - hs * 0.45, topY + 0.2, b.z, hs * 0.18, 0.03, hs, "#f4f4f4");
    G.plain.box(b.x + hs * 0.45, topY + 0.2, b.z, hs * 0.18, 0.03, hs, "#f4f4f4");
    G.plain.box(b.x, topY + 0.2, b.z, hs * 0.9, 0.03, hs * 0.18, "#f4f4f4");
    for (const [dx, dz] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ] as const)
      G.beacons.push([b.x + dx * rad * 0.75, topY + 0.35, b.z + dz * rad * 0.75]);
    return;
  }
  const units = 1 + Math.floor(r() * 3);
  for (let u = 0; u < units && topW > 2.2 && topD > 2.2; u++) {
    const ux = b.x + (r() - 0.5) * (topW - 1.4);
    const uz = b.z + (r() - 0.5) * (topD - 1.4);
    G.plain.box(ux, topY, uz, 0.9, 0.6, 0.9, "#c8ccd0");
    G.plain.box(ux, topY + 0.6, uz, 0.6, 0.06, 0.6, "#8a8e92");
  }
  if (
    (b.style === "brick" || b.style === "office") &&
    b.roll > 0.4 &&
    topW > 2.5 &&
    topD > 2.5 &&
    h < 30
  ) {
    // classic wooden water tank on legs
    const tx = b.x + (topW / 2 - 1) * (r() < 0.5 ? 1 : -1);
    const tz = b.z + (topD / 2 - 1) * (r() < 0.5 ? 1 : -1);
    for (const [dx, dz] of [
      [0.45, 0.45],
      [0.45, -0.45],
      [-0.45, 0.45],
      [-0.45, -0.45],
    ] as const)
      G.plain.box(tx + dx, topY, tz + dz, 0.08, 1, 0.08, "#3a3430");
    G.plain.add(CYL, place(tx, topY + 1.65, tz, 0.7, 1.3, 0.7), "#7a5a3a");
    G.plain.add(CONE, place(tx, topY + 2.55, tz, 0.78, 0.5, 0.78), "#5a4030");
  }
  if (topY > 24) {
    const ah = 3.5 + b.roll * 6;
    G.plain.add(
      CYL,
      place(b.x + topW * 0.2, topY + ah / 2, b.z - topD * 0.2, 0.06, ah, 0.06),
      "#b0b4b8",
    );
    G.beacons.push([b.x + topW * 0.2, topY + ah + 0.1, b.z - topD * 0.2]);
  }
  if (b.billboard) {
    const alongX = r() < 0.5;
    const bw = Math.min(5.2, (alongX ? topW : topD) * 0.95);
    const bh = bw * 0.45;
    const y0 = topY + 1.2;
    const off = (alongX ? topD : topW) * 0.3;
    const fs = r() < 0.5 ? 1 : -1;
    const cx = b.x + (alongX ? 0 : fs * off);
    const cz = b.z + (alongX ? fs * off : 0);
    for (const s of [-0.35, 0.35]) {
      G.plain.box(
        cx + (alongX ? s * bw : 0),
        topY,
        cz + (alongX ? 0 : s * bw),
        0.12,
        1.3,
        0.12,
        "#4a4d52",
      );
    }
    G.plain.box(
      cx,
      y0,
      cz,
      alongX ? bw + 0.2 : 0.18,
      bh + 0.2,
      alongX ? 0.18 : bw + 0.2,
      "#26282c",
    );
    // ad face on the outward side
    const ad = Math.floor(r() * 4);
    const u0 = (ad % 2) * 0.5;
    const v0 = ad < 2 ? 0.5 : 0; // canvas row 0 is the top of the texture
    const uv: [number, number, number, number] = [u0, v0, u0 + 0.5, v0 + 0.5];
    const f = 0.1;
    const y1 = y0 + 0.1;
    const y2 = y1 + bh;
    if (alongX) {
      const z = cz + fs * f;
      const x0 = cx - bw / 2,
        x1 = cx + bw / 2;
      if (fs > 0)
        G.ads.quad([x0, y1, z], [x1, y1, z], [x1, y2, z], [x0, y2, z], [0, 0, 1], "#ffffff", uv);
      else
        G.ads.quad([x1, y1, z], [x0, y1, z], [x0, y2, z], [x1, y2, z], [0, 0, -1], "#ffffff", uv);
    } else {
      const x = cx + fs * f;
      const z0 = cz - bw / 2,
        z1 = cz + bw / 2;
      if (fs > 0)
        G.ads.quad([x, y1, z1], [x, y1, z0], [x, y2, z0], [x, y2, z1], [1, 0, 0], "#ffffff", uv);
      else
        G.ads.quad([x, y1, z0], [x, y1, z1], [x, y2, z1], [x, y2, z0], [-1, 0, 0], "#ffffff", uv);
    }
  }
}

/** Road markings: double yellow centre lines, zebra crossings and stop lines. */
function addStreets(city: CityLayout, S: Geo, half: number) {
  const reach = half + 46;
  const roads = city.farRoads.filter((r) => Math.abs(r) < reach);
  const Y = 0.018;
  const strip = (x0: number, z0: number, x1: number, z1: number, color: string) =>
    S.quad([x0, Y, z1], [x1, Y, z1], [x1, Y, z0], [x0, Y, z0], [0, 1, 0], color);
  for (const R of roads) {
    // segments between consecutive cross roads
    const cuts = [-reach, ...roads, reach];
    for (let k = 0; k < cuts.length - 1; k++) {
      const a = cuts[k]! + (k === 0 ? 0 : 4.2);
      const b = cuts[k + 1]! - (k === cuts.length - 2 ? 0 : 4.2);
      if (b <= a) continue;
      // along z (north-south road at x = R)
      strip(R - 0.2, a, R - 0.08, b, "#e8c23a");
      strip(R + 0.08, a, R + 0.2, b, "#e8c23a");
      // along x (east-west road at z = R)
      strip(a, R - 0.2, b, R - 0.08, "#e8c23a");
      strip(a, R + 0.08, b, R + 0.2, "#e8c23a");
    }
    for (const C of roads) {
      for (const side of [-1, 1]) {
        // zebra crossing on each approach
        for (let s = 0; s < 6; s++) {
          const o = -1.75 + s * 0.68;
          const c0 = C + side * 2.2;
          const c1 = C + side * 3.8;
          strip(R + o, Math.min(c0, c1), R + o + 0.36, Math.max(c0, c1), "#e8e6e0");
          strip(Math.min(c0, c1), R + o, Math.max(c0, c1), R + o + 0.36, "#e8e6e0");
        }
        // stop line across the approaching lane (right-hand traffic)
        const sl = C + side * 4.05;
        // north-south road, cars approaching from +z (side 1) drive at x = R + 1
        strip(side > 0 ? R : R - 2, sl - 0.13, side > 0 ? R + 2 : R, sl + 0.13, "#f4f4f0");
        // east-west road, cars approaching from +x drive at z = R - 1
        strip(sl - 0.13, side > 0 ? R - 2 : R, sl + 0.13, side > 0 ? R : R + 2, "#f4f4f0");
      }
    }
  }
  // the spawn intersection is a little plaza: terracotta ring around a compass rose
  S.add(RING, place(0, 0.02, 0, 1.9, 1, 1.9), "#c8704a");
  S.add(
    new THREE.CircleGeometry(1.55, 24).rotateX(-Math.PI / 2),
    place(0, 0.021, 0, 1, 1, 1),
    "#e6d6b8",
  );
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const tri = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.28, 0, 0),
      new THREE.Vector3(0, 0, -1.4),
      new THREE.Vector3(0.28, 0, 0),
    ]);
    tri.computeVertexNormals();
    tri.setAttribute("normal", new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    S.add(tri, place(0, 0.024, 0, 1, 1, 1, a), k === 0 ? "#b8402a" : "#5a4a3a");
    tri.dispose();
  }
  // parking lot: slightly different asphalt with white stall lines
  for (const p of city.parking) {
    S.quad(
      [p.x - 1, 0.01, p.z + 1],
      [p.x + 1, 0.01, p.z + 1],
      [p.x + 1, 0.01, p.z - 1],
      [p.x - 1, 0.01, p.z - 1],
      [0, 1, 0],
      "#4a4c52",
    );
    strip(p.x - 1, p.z - 1, p.x + 1, p.z - 0.92, "#e8e6e0");
    strip(p.x - 1, p.z - 1, p.x - 0.92, p.z + 1, "#e8e6e0");
  }
}

type Item = {
  x: number;
  y?: number;
  z: number;
  rot?: number;
  sx?: number;
  sy?: number;
  sz?: number;
  tilt?: number;
  color?: THREE.ColorRepresentation;
};

function Instanced({
  geometry,
  material,
  items,
  cast = false,
  receive = false,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  items: Item[];
  cast?: boolean;
  receive?: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    items.forEach((it, i) => {
      e.set(it.tilt ?? 0, it.rot ?? 0, 0, "YXZ");
      q.setFromEuler(e);
      _mat4.compose(_v.set(it.x, it.y ?? 0, it.z), q, _s.set(it.sx ?? 1, it.sy ?? 1, it.sz ?? 1));
      m.setMatrixAt(i, _mat4);
      if (it.color !== undefined) m.setColorAt(i, _col.set(it.color));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [items]);
  if (items.length === 0) return null;
  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, items.length]}
      castShadow={cast}
      receiveShadow={receive}
    />
  );
}

function propGeo(build: (g: Geo) => void) {
  const g = new Geo();
  build(g);
  return g.build();
}

export const CityScene = memo(function CityScene({
  city,
  night,
}: {
  city: CityLayout;
  night: boolean;
}) {
  const half = city.half;

  const built = useMemo(() => {
    const G: Groups = {
      facade: { glass: new Geo(), office: new Geo(), brick: new Geo() },
      plain: new Geo(),
      glow: new Geo(),
      ads: new Geo(),
      beacons: [],
    };
    for (const b of city.buildings) addBuilding(b, G);

    const S = new Geo();
    // raised sidewalks with a kerb
    for (const w of city.walks) {
      const tone = 0.94 + ((((w.x * 7 + w.z * 13) % 5) + 5) % 5) * 0.015;
      _col.set("#b8b1a4").multiplyScalar(tone);
      S.box(w.x, 0, w.z, 2, 0.16, 2, _col.getHex());
    }
    addStreets(city, S, half);

    const facades = (Object.keys(G.facade) as FacadeKind[]).map((k) => {
      const tex = facadeTextures(k);
      const mat = new THREE.MeshLambertMaterial({
        vertexColors: true,
        map: tex.day,
        emissiveMap: tex.night,
        emissive: 0x000000,
      });
      return { k, geo: G.facade[k].build(), mat };
    });
    return {
      facades,
      plain: G.plain.build(),
      glow: G.glow.build(),
      ads: G.ads.build(),
      streets: S.build(),
      beacons: G.beacons,
    };
  }, [city, half]);

  const mats = useMemo(
    () => ({
      plain: new THREE.MeshLambertMaterial({ vertexColors: true }),
      streets: new THREE.MeshLambertMaterial({ vertexColors: true }),
      ground: new THREE.MeshLambertMaterial({ color: "#3a3c41" }),
      glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
      ads: new THREE.MeshLambertMaterial({
        map: adsTexture(),
        emissiveMap: adsTexture(),
        emissive: 0xffffff,
        emissiveIntensity: 0.3,
      }),
      beacon: new THREE.MeshBasicMaterial({ color: "#ff2a1a", toneMapped: false }),
      bulb: new THREE.MeshBasicMaterial({ color: "#d8dadc", toneMapped: false }),
      lamp: new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false }),
      cone: new THREE.MeshBasicMaterial({
        color: "#ffd9a0",
        transparent: true,
        opacity: 0.045,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
      pool: new THREE.MeshBasicMaterial({
        color: "#ffcf8a",
        map: glowTexture(),
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
      prop: new THREE.MeshLambertMaterial({ vertexColors: true }),
      tinted: new THREE.MeshLambertMaterial({ color: "#ffffff" }),
      fence: new THREE.MeshLambertMaterial({
        color: "#9aa0a4",
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    }),
    [],
  );

  // ---- instanced street furniture ----
  const props = useMemo(() => {
    const streetlight = propGeo((g) => {
      g.add(CYL, place(0, 2.6, 0, 0.07, 5.2, 0.07), "#4a4f55");
      g.box(0, 5.05, 0.75, 0.08, 0.08, 1.5, "#4a4f55");
      g.box(0, 4.95, 1.5, 0.36, 0.14, 0.62, "#3a3e44");
      g.add(CYL, place(0, 0.3, 0, 0.14, 0.6, 0.14), "#3a3e44");
    });
    const bulb = new THREE.BoxGeometry(0.28, 0.04, 0.5).translate(0, 4.87, 1.5);
    const cone = new THREE.ConeGeometry(2.3, 4.85, 16, 1, true).translate(0, 4.87 - 2.425, 1.5);
    const pool = new THREE.PlaneGeometry(5.4, 5.4).rotateX(-Math.PI / 2).translate(0, 0.19, 1.5);
    const trunk = propGeo((g) => {
      for (let k = 0; k < 5; k++)
        g.add(
          CYL,
          place(0, k * 0.2 + 0.1, 0, 0.2 - k * 0.018, 0.2, 0.2 - k * 0.018),
          k % 2 ? "#8a6a48" : "#7a5a3c",
        );
    });
    const fronds = propGeo((g) => {
      const leaf = new THREE.BoxGeometry(0.42, 0.05, 2.6).translate(0, 0, 1.3);
      for (let k = 0; k < 8; k++) {
        const m = new THREE.Matrix4()
          .makeRotationY((k / 8) * Math.PI * 2)
          .multiply(new THREE.Matrix4().makeRotationX(0.45 + (k % 2) * 0.25));
        g.add(leaf, m, k % 2 ? "#3f8a3a" : "#2f7a36");
      }
      g.add(new THREE.SphereGeometry(0.28, 6, 5), place(0, -0.15, 0, 1, 1, 1), "#5a4a2a");
      leaf.dispose();
    });
    const hydrant = propGeo((g) => {
      g.add(CYL, place(0, 0.32, 0, 0.16, 0.64, 0.16), "#c8302a");
      g.add(CYL, place(0, 0.7, 0, 0.12, 0.14, 0.12), "#e0e0dc");
      g.box(0, 0.38, 0, 0.5, 0.1, 0.1, "#c8302a");
    });
    const bench = propGeo((g) => {
      g.box(0, 0.42, 0, 1.5, 0.07, 0.45, "#8a5a34");
      g.box(0, 0.55, -0.22, 1.5, 0.4, 0.06, "#8a5a34");
      g.box(-0.6, 0, 0, 0.07, 0.42, 0.4, "#2a2c30");
      g.box(0.6, 0, 0, 0.07, 0.42, 0.4, "#2a2c30");
    });
    const tlPole = propGeo((g) => {
      g.add(CYL, place(0, 2.6, 0, 0.09, 5.2, 0.09), "#2e3236");
      g.box(0, 5.0, 0.95, 0.09, 0.09, 1.9, "#2e3236");
      g.box(0, 4.05, 1.7, 0.3, 1.0, 0.3, "#1e2124");
      g.box(0.05, 1.2, 0, 0.18, 0.28, 0.16, "#e6c02a"); // push-button box
    });
    const tlLamp = new THREE.BoxGeometry(0.06, 0.2, 0.2);
    const barrier = propGeo((g) => {
      g.box(0, 0, 0, 1.9, 0.3, 0.62, "#ffffff");
      g.box(0, 0.3, 0, 1.9, 0.55, 0.3, "#ffffff");
    });
    const fencePost = propGeo((g) => {
      g.add(CYL, place(0, 1.6, 0, 0.05, 3.2, 0.05), "#8a8e92");
      g.box(0, 3.15, 1, 0.06, 0.06, 2, "#8a8e92");
    });
    const fencePanel = new THREE.PlaneGeometry(2, 3.1).translate(0, 1.55, 0);

    const lights: Item[] = city.streetlights.map((s) => ({ x: s.x, z: s.z, rot: s.rot }));
    const palms: Item[] = city.palms.map((p) => ({
      x: p.x,
      z: p.z,
      rot: p.rot,
      sy: p.h,
      tilt: 0.05 + (p.rot % 0.1),
    }));
    const fr: Item[] = city.palms.map((p) => ({
      x: p.x + Math.sin(p.rot) * p.h * (0.05 + (p.rot % 0.1)),
      y: p.h * 0.995,
      z: p.z + Math.cos(p.rot) * p.h * (0.05 + (p.rot % 0.1)),
      rot: p.rot,
    }));
    const hyd: Item[] = city.hydrants.map((s) => ({ x: s.x, z: s.z, rot: s.rot, y: 0.16 }));
    const ben: Item[] = city.benches.map((s) => ({
      x: s.x,
      z: s.z,
      rot: s.rot + Math.PI,
      y: 0.16,
    }));

    // traffic lights: one pole per corner, each serving the approach whose right lane it overhangs
    const poles: Item[] = [];
    const lamps: { item: Item; node: number; axis: 0 | 1; which: 0 | 1 | 2 }[] = [];
    const nZ = city.roadZ.length;
    city.roadX.forEach((xc, a) =>
      city.roadZ.forEach((zc, b) => {
        const node = a * nZ + b;
        // [corner sx, corner sz, rot, axis]: see traffic.ts for the lane rules
        const corners: [number, number, number, 0 | 1][] = [
          [-1, 1, Math.PI, 0],
          [1, -1, 0, 0],
          [-1, -1, Math.PI / 2, 1],
          [1, 1, -Math.PI / 2, 1],
        ];
        for (const [sx, sz, rot, axis] of corners) {
          const px = xc + sx * 2.75;
          const pz = zc + sz * 2.75;
          poles.push({ x: px, y: 0.16, z: pz, rot });
          // head is at local (0.17, y, 1.7), facing local +x
          const hx = px + Math.cos(rot) * 0.17 + Math.sin(rot) * 1.7;
          const hz = pz - Math.sin(rot) * 0.17 + Math.cos(rot) * 1.7;
          ([4.37, 4.07, 3.77] as const).forEach((y, which) => {
            lamps.push({
              item: { x: hx, y: y + 0.16, z: hz, rot },
              node,
              axis,
              which: which as 0 | 1 | 2,
            });
          });
        }
      }),
    );

    // perimeter: jersey barriers + see-through construction fence wherever no building backs the wall
    const bars: Item[] = [];
    const posts: Item[] = [];
    const panels: Item[] = [];
    const n = city.cells;
    const cc = (i: number) => -half + 1 + i * 2;
    for (let i = 0; i < n; i++) {
      for (const [ci, cj, nx, nz] of [
        [i, 0, 0, -1],
        [i, n - 1, 0, 1],
        [0, i, -1, 0],
        [n - 1, i, 1, 0],
      ] as const) {
        const k = city.kind[ci * n + cj]!;
        if (k !== K_ROAD && k !== K_WALK && k !== K_PARK) continue;
        const along = nx === 0;
        const x = nx === 0 ? cc(ci) : nx * (half - 0.45);
        const z = nz === 0 ? cc(cj) : nz * (half - 0.45);
        const rot = along ? 0 : Math.PI / 2;
        bars.push({ x, z, rot, color: i % 2 ? "#e8e6e0" : "#d8502a" });
        const fx = nx === 0 ? cc(ci) - 1 : nx * (half - 0.05);
        const fz = nz === 0 ? cc(cj) - 1 : nz * (half - 0.05);
        posts.push({ x: fx, z: fz, rot: along ? Math.PI / 2 : 0 });
        panels.push({ x: nx === 0 ? cc(ci) : fx, z: nz === 0 ? cc(cj) : fz, rot });
      }
    }
    return {
      streetlight,
      bulb,
      cone,
      pool,
      trunk,
      fronds,
      hydrant,
      bench,
      tlPole,
      tlLamp,
      barrier,
      fencePost,
      fencePanel,
      lights,
      palms,
      fr,
      hyd,
      ben,
      poles,
      lamps,
      bars,
      posts,
      panels,
    };
  }, [city, half]);

  useEffect(
    () => () => {
      built.facades.forEach((f) => {
        f.geo.dispose();
        f.mat.dispose();
      });
      [built.plain, built.glow, built.ads, built.streets].forEach((g) => g.dispose());
    },
    [built],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  useEffect(
    () => () => {
      (
        [
          "streetlight",
          "bulb",
          "cone",
          "pool",
          "trunk",
          "fronds",
          "hydrant",
          "bench",
          "tlPole",
          "tlLamp",
          "barrier",
          "fencePost",
          "fencePanel",
        ] as const
      ).forEach((k) => props[k].dispose());
    },
    [props],
  );

  // ---- day / night: only material parameters change ----
  useEffect(() => {
    built.facades.forEach((f) => {
      f.mat.emissive.set(night ? 0xffffff : 0x000000);
      f.mat.emissiveIntensity = night ? 1.0 : 0;
    });
    mats.glow.color.setScalar(night ? 1.25 : 0.7);
    mats.ads.emissiveIntensity = night ? 0.95 : 0.3;
    mats.bulb.color.set(night ? "#fff0c8" : "#d8dadc");
  }, [night, built, mats]);

  const beaconRef = useRef<THREE.InstancedMesh>(null);
  const lampRef = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = beaconRef.current;
    if (!m) return;
    built.beacons.forEach((p, i) => m.setMatrixAt(i, place(p[0], p[1], p[2], 0.16, 0.16, 0.16)));
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [built]);
  const lastPhase = useRef("");
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    // aviation lights blink in unison
    mats.beacon.color.setScalar(Math.sin(t * 3.2) > 0.2 ? 1 : 0.12).multiply(_col.set("#ff2a1a"));
    const m = lampRef.current;
    if (!m) return;
    const states = props.lamps.map((l) => signal(l.node, t, l.axis));
    const key = states.join("");
    if (key === lastPhase.current) return;
    lastPhase.current = key;
    props.lamps.forEach((l, i) => {
      const s = states[i]!;
      const on =
        (l.which === 0 && s === 2) ||
        (l.which === 1 && s === YELLOW) ||
        (l.which === 2 && s === GREEN);
      const base = l.which === 0 ? "#ff2a1a" : l.which === 1 ? "#ffb81a" : "#2aff6a";
      _col.set(base);
      if (!on) _col.multiplyScalar(0.12);
      m.setColorAt(i, _col);
    });
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
  useLayoutEffect(() => {
    const m = lampRef.current;
    if (!m) return;
    props.lamps.forEach((l, i) => {
      const e = new THREE.Euler(0, l.item.rot ?? 0, 0);
      _mat4.compose(_v.set(l.item.x, l.item.y ?? 0, l.item.z), _q.setFromEuler(e), _s.set(1, 1, 1));
      m.setMatrixAt(i, _mat4);
      m.setColorAt(i, _col.set("#333"));
    });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
    lastPhase.current = "";
  }, [props]);

  const extent = city.extent * 2 + 40;
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.01} receiveShadow material={mats.ground}>
        <planeGeometry args={[extent, extent]} />
      </mesh>
      <mesh geometry={built.streets} material={mats.streets} receiveShadow />
      {built.facades.map((f) => (
        <mesh key={f.k} geometry={f.geo} material={f.mat} castShadow receiveShadow />
      ))}
      <mesh geometry={built.plain} material={mats.plain} castShadow receiveShadow />
      <mesh geometry={built.glow} material={mats.glow} />
      <mesh geometry={built.ads} material={mats.ads} />
      {built.beacons.length > 0 && (
        <instancedMesh ref={beaconRef} args={[BEACON, mats.beacon, built.beacons.length]} />
      )}

      <Instanced geometry={props.streetlight} material={mats.prop} items={props.lights} cast />
      <Instanced geometry={props.bulb} material={mats.bulb} items={props.lights} />
      {night && <Instanced geometry={props.cone} material={mats.cone} items={props.lights} />}
      {night && <Instanced geometry={props.pool} material={mats.pool} items={props.lights} />}
      <Instanced geometry={props.trunk} material={mats.prop} items={props.palms} cast />
      <Instanced geometry={props.fronds} material={mats.prop} items={props.fr} cast />
      <Instanced geometry={props.hydrant} material={mats.prop} items={props.hyd} />
      <Instanced geometry={props.bench} material={mats.prop} items={props.ben} />
      <Instanced geometry={props.tlPole} material={mats.prop} items={props.poles} cast />
      {props.lamps.length > 0 && (
        <instancedMesh ref={lampRef} args={[props.tlLamp, mats.lamp, props.lamps.length]} />
      )}
      <Instanced geometry={props.barrier} material={mats.tinted} items={props.bars} receive />
      <Instanced geometry={props.fencePost} material={mats.prop} items={props.posts} />
      <Instanced geometry={props.fencePanel} material={mats.fence} items={props.panels} />
    </group>
  );
});
