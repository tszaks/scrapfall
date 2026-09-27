// The city's palm trees, instanced by species (one draw call each, plus one shadow pass):
//   washingtonia - Mexican fan palm down the boulevard median: 16-25 m, pencil-thin trunk,
//                  a small head of round fan fronds over a skirt of dead ones
//   royal        - along the main-street sidewalks: 11-15 m smooth grey column, a green
//                  crownshaft and arching feather fronds
//   coconut      - on the boardwalk: 8-13 m, curved trunks leaning out toward the sea,
//                  a big drooping crown
// Every frond is a few bent, V-folded segments with leaflets from one shared cut-out
// texture. Trunk curve and a light wind sway happen in the vertex shader.
import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { K_BOARD, K_MEDIAN, type CityLayout } from "./cityLayout";
import { addSkyFogUniforms } from "./skyFog";

type Species = "washingtonia" | "royal" | "coconut";
const SPECIES: Species[] = ["washingtonia", "royal", "coconut"];
/** modelled height in metres (instances scale from this) */
const BASE_H: Record<Species, number> = { washingtonia: 20, royal: 13, coconut: 10 };

// ---- atlas: bark | feather frond | fan frond (top) + dead skirt (bottom) ----
const AT = 512;
const U_BARK: [number, number] = [0, 0.25];
const U_FEATHER: [number, number] = [0.25, 0.75];
const U_FAN: [number, number] = [0.75, 1];

let atlasTex: THREE.CanvasTexture | null = null;
function atlas() {
  if (atlasTex) return atlasTex;
  const c = document.createElement("canvas");
  c.width = AT;
  c.height = AT;
  const g = c.getContext("2d")!;
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  // bark: pale, with a ring every 16 px (leaf scars) and some speckle
  g.fillStyle = "#d6cfc4";
  g.fillRect(0, 0, 128, AT);
  for (let y = 0; y < AT; y += 16) {
    g.fillStyle = "rgba(60,48,36,0.55)";
    g.fillRect(0, y, 128, 3);
    g.fillStyle = "rgba(255,255,255,0.25)";
    g.fillRect(0, y + 3, 128, 2);
  }
  for (let k = 0; k < 900; k++) {
    g.fillStyle = `rgba(${r() < 0.5 ? "40,30,20" : "255,250,240"},${(r() * 0.18).toFixed(2)})`;
    g.fillRect(r() * 128, r() * AT, 1 + r() * 3, 1 + r() * 2);
  }
  // feather frond, 256 wide: rachis down the middle (bottom = base, top = tip), leaflets
  // sweeping forward on both sides, longest in the middle of the frond
  g.lineCap = "round";
  const fx = 128;
  const cx = fx + 128;
  for (let y = 8; y < AT - 4; y += 6) {
    const t = 1 - y / AT; // 0 at the base (bottom), 1 at the tip (top)
    const len = 118 * Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.95)) * (0.85 + r() * 0.15);
    if (len < 6) continue;
    for (const side of [-1, 1]) {
      const shade = 200 + Math.floor(r() * 55);
      g.strokeStyle = `rgb(${shade},${shade},${shade})`;
      g.lineWidth = 4.2 - t * 1.6;
      g.beginPath();
      g.moveTo(cx, y);
      // leaflets angle toward the tip and droop a little at their ends
      g.quadraticCurveTo(cx + side * len * 0.55, y - len * 0.32, cx + side * len, y - len * 0.2);
      g.stroke();
    }
  }
  g.strokeStyle = "#e8e0c8";
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(cx, AT);
  g.lineTo(cx, 4);
  g.stroke();
  // fan frond (top half of the last column): radiating pleats from the bottom centre
  const ox = 384 + 64;
  const oy = 250;
  for (let k = 0; k <= 40; k++) {
    const a = Math.PI * (0.06 + (k / 40) * 0.88);
    const len = 118 + r() * 10;
    const shade = 190 + Math.floor(r() * 65);
    g.strokeStyle = `rgb(${shade},${shade},${shade})`;
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(ox, oy);
    g.lineTo(ox - Math.cos(a) * len * 0.85, oy - Math.sin(a) * len * 0.85);
    g.stroke();
    // split, drooping tips
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(ox - Math.cos(a) * len * 0.8, oy - Math.sin(a) * len * 0.8);
    g.lineTo(ox - Math.cos(a) * len * 1.02, oy - Math.sin(a) * len * 1.02 + 6);
    g.stroke();
  }
  // dead-frond skirt (bottom half of the last column): hanging straw strands
  for (let k = 0; k < 260; k++) {
    const x = 384 + r() * 128;
    const y0 = 262 + r() * 20;
    const y1 = y0 + 150 + r() * 80;
    const shade = 150 + Math.floor(r() * 90);
    g.strokeStyle = `rgb(${shade},${Math.floor(shade * 0.92)},${Math.floor(shade * 0.8)})`;
    g.lineWidth = 1.5 + r() * 2;
    g.beginPath();
    g.moveTo(x, y0);
    g.lineTo(x + (r() - 0.5) * 14, Math.min(AT - 2, y1));
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  atlasTex = t;
  return t;
}

// ---- geometry builder ----
class PalmGeo {
  pos: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  /** trunk-height fraction a vertex hangs off (drives the lean and the sway) */
  bend: number[] = [];
  /** how freely a vertex flutters in the wind (frond tips) */
  flex: number[] = [];
  private c = new THREE.Color();
  color(hex: string, k = 1) {
    this.c.set(hex).multiplyScalar(k);
    return this;
  }
  v(p: THREE.Vector3, n: THREE.Vector3, u: number, w: number, bend: number, flex: number) {
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.uv.push(u, w);
    this.col.push(this.c.r, this.c.g, this.c.b);
    this.bend.push(bend);
    this.flex.push(flex);
  }
  /** a quad a b c d (counter-clockwise from the front) */
  quad(
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    d: THREE.Vector3,
    uv: [number, number, number, number, number, number, number, number],
    n: THREE.Vector3 | null,
    bend: [number, number, number, number],
    flex: [number, number, number, number],
  ) {
    const nn =
      n ??
      new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
    const P = [a, b, c, d];
    for (const i of [0, 1, 2, 0, 2, 3])
      this.v(P[i]!, nn, uv[i * 2]!, uv[i * 2 + 1]!, bend[i]!, flex[i]!);
  }
  /** tapering trunk from y0 to y1, n sides, rings of bark texture every `ringH` metres */
  trunk(H: number, r0: number, r1: number, segs: number, sides: number, hex: string, bulge = 0) {
    const [ua, ub] = U_BARK;
    for (let s = 0; s < segs; s++) {
      const ya = (s / segs) * H;
      const yb = ((s + 1) / segs) * H;
      const rad = (y: number) => {
        const t = y / H;
        // a flared foot (and, for royals, a swelling a third of the way up)
        return (
          (r0 + (r1 - r0) * t) *
          (1 + 0.35 * Math.exp(-t * 18) + bulge * Math.sin(Math.PI * Math.min(1, t * 1.6)))
        );
      };
      const ra = rad(ya);
      const rb = rad(yb);
      // the atlas repeats vertically: a ring every ~19 cm
      const vA = ya / 6;
      const vB = yb / 6;
      for (let i = 0; i < sides; i++) {
        const t0 = (i / sides) * Math.PI * 2;
        const t1 = ((i + 1) / sides) * Math.PI * 2;
        const n0 = new THREE.Vector3(Math.cos(t0), 0.1, Math.sin(t0)).normalize();
        const n1 = new THREE.Vector3(Math.cos(t1), 0.1, Math.sin(t1)).normalize();
        const k = 0.88 + ((i * 7) % 5) * 0.03;
        this.color(hex, k);
        const p = (t: number, r: number, y: number) =>
          new THREE.Vector3(Math.cos(t) * r, y, Math.sin(t) * r);
        const u0 = ua + ((ub - ua) * i) / sides;
        const u1 = ua + ((ub - ua) * (i + 1)) / sides;
        // smooth normals round the trunk (two tris per side, each vertex with its own normal)
        const A = p(t0, ra, ya);
        const B = p(t1, ra, ya);
        const C = p(t1, rb, yb);
        const D = p(t0, rb, yb);
        const ba = ya / H;
        const bb = yb / H;
        for (const [P, n, u, w, bd] of [
          [A, n0, u0, vA, ba],
          [D, n0, u0, vB, bb],
          [C, n1, u1, vB, bb],
          [A, n0, u0, vA, ba],
          [C, n1, u1, vB, bb],
          [B, n1, u1, vA, ba],
        ] as const)
          this.v(P, n, u, w, bd, 0);
      }
    }
  }
  /**
   * A feather frond from `base`, pointing along compass angle `az`, starting `pitch` radians
   * above horizontal and drooping under its own weight: `segs` bent segments, each a
   * V-folded pair of leaflet strips.
   */
  feather(
    base: THREE.Vector3,
    az: number,
    pitch: number,
    len: number,
    width: number,
    droop: number,
    fold: number,
    hex: string,
    segs = 5,
  ) {
    const [ua, ub] = U_FEATHER;
    const um = (ua + ub) / 2;
    const dirH = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
    const side = new THREE.Vector3(-Math.sin(az), 0, Math.cos(az));
    // spine points along a drooping arc
    const pts: THREE.Vector3[] = [base.clone()];
    let ang = pitch;
    const step = len / segs;
    for (let s = 0; s < segs; s++) {
      const p = pts[s]!.clone()
        .addScaledVector(dirH, Math.cos(ang) * step)
        .add(new THREE.Vector3(0, Math.sin(ang) * step, 0));
      pts.push(p);
      ang -= droop / segs;
    }
    this.color(hex);
    for (let s = 0; s < segs; s++) {
      const a = pts[s]!;
      const b = pts[s + 1]!;
      const ta = s / segs;
      const tb = (s + 1) / segs;
      const wA = width * Math.sin(Math.PI * Math.min(1, 0.15 + ta * 0.95));
      const wB = width * Math.sin(Math.PI * Math.min(1, 0.15 + tb * 0.95));
      // leaflets rise from the rachis in a V (fold), so the frond reads in 3D from any side
      const up = new THREE.Vector3(0, 1, 0);
      for (const sd of [-1, 1]) {
        const off = side
          .clone()
          .multiplyScalar(sd * Math.cos(fold))
          .addScaledVector(up, Math.sin(fold));
        const aE = a.clone().addScaledVector(off, wA);
        const bE = b.clone().addScaledVector(off, wB);
        const uE = sd < 0 ? ua : ub;
        // lighting: mostly sky-facing, so the crown doesn't go black from below
        const n = up
          .clone()
          .multiplyScalar(0.8)
          .addScaledVector(off, -0.3 * sd)
          .normalize();
        const fa = 0.25 + ta * 0.75;
        const fb = 0.25 + tb * 0.75;
        this.quad(
          a,
          b,
          bE,
          aE,
          [um, ta, um, tb, uE, tb, uE, ta],
          n,
          [1, 1, 1, 1],
          [fa, fb, fb, fa],
        );
      }
    }
  }
  /** a round fan frond on a short stalk (Washingtonia), a bent card facing out and up */
  fan(base: THREE.Vector3, az: number, pitch: number, stalk: number, size: number, hex: string) {
    const [ua, ub] = U_FAN;
    const dirH = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
    const side = new THREE.Vector3(-Math.sin(az), 0, Math.cos(az));
    const dir = dirH
      .clone()
      .multiplyScalar(Math.cos(pitch))
      .add(new THREE.Vector3(0, Math.sin(pitch), 0));
    const c = base.clone().addScaledVector(dir, stalk);
    // the fan's "up" is along the stalk; it's cupped (the side halves bend back)
    const tip = c.clone().addScaledVector(dir, size);
    const n = new THREE.Vector3().crossVectors(side, dir).normalize();
    if (n.y < 0) n.negate();
    this.color(hex);
    const bendBack = n.clone().multiplyScalar(-size * 0.22);
    const l0 = c
      .clone()
      .addScaledVector(side, -size * 0.5)
      .add(bendBack);
    const r0 = c
      .clone()
      .addScaledVector(side, size * 0.5)
      .add(bendBack);
    const l1 = tip
      .clone()
      .addScaledVector(side, -size * 0.5)
      .add(bendBack);
    const r1 = tip
      .clone()
      .addScaledVector(side, size * 0.5)
      .add(bendBack);
    const m0 = c.clone();
    const m1 = tip.clone();
    const um = (ua + ub) / 2;
    // two halves meeting at the midrib (texture: fan in the top half of its column, v 0.5..1)
    this.quad(
      l0,
      m0,
      m1,
      l1,
      [ua, 0.5, um, 0.5, um, 1, ua, 1],
      n,
      [1, 1, 1, 1],
      [0.5, 0.3, 0.8, 1],
    );
    this.quad(
      m0,
      r0,
      r1,
      m1,
      [um, 0.5, ub, 0.5, ub, 1, um, 1],
      n,
      [1, 1, 1, 1],
      [0.3, 0.5, 1, 0.8],
    );
    // the stalk
    this.color("#7a6a48");
    const s0 = base.clone();
    const w = side.clone().multiplyScalar(0.05);
    this.quad(
      s0.clone().sub(w),
      s0.clone().add(w),
      c.clone().add(w),
      c.clone().sub(w),
      [0.01, 0, 0.02, 0, 0.02, 1, 0.01, 1],
      null,
      [1, 1, 1, 1],
      [0, 0, 0.3, 0.3],
    );
  }
  /** hanging skirt of dead fronds (Washingtonia): an open cone of straw strands */
  skirt(y0: number, y1: number, rTop: number, rBot: number, sides: number) {
    const [ua, ub] = U_FAN;
    this.color("#b89a70");
    for (let i = 0; i < sides; i++) {
      const t0 = (i / sides) * Math.PI * 2;
      const t1 = ((i + 1) / sides) * Math.PI * 2;
      const p = (t: number, r: number, y: number) =>
        new THREE.Vector3(Math.cos(t) * r, y, Math.sin(t) * r);
      const n = new THREE.Vector3(
        Math.cos((t0 + t1) / 2),
        0.2,
        Math.sin((t0 + t1) / 2),
      ).normalize();
      this.quad(
        p(t0, rBot, y0),
        p(t1, rBot, y0),
        p(t1, rTop, y1),
        p(t0, rTop, y1),
        [ua, 0.02, ub, 0.02, ub, 0.48, ua, 0.48],
        n,
        [1, 1, 1, 1],
        [0.15, 0.15, 0, 0],
      );
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute("aBend", new THREE.Float32BufferAttribute(this.bend, 1));
    g.setAttribute("aFlex", new THREE.Float32BufferAttribute(this.flex, 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** frond colours: fresh upper fronds, older lower ones going olive and yellow */
const FROND = ["#3f7f34", "#4a8a3a", "#55923e", "#6a9440", "#8a9a48", "#a39a52"];

function speciesGeo(sp: Species) {
  const G = new PalmGeo();
  const H = BASE_H[sp];
  let seed = sp.length * 977;
  const r = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const golden = 2.39996;
  if (sp === "washingtonia") {
    G.trunk(H - 1.4, 0.19, 0.13, 9, 7, "#a08a70");
    G.skirt(H - 3.4, H - 1.0, 0.3, 0.42, 8);
    const top = new THREE.Vector3(0, H - 0.5, 0);
    for (let k = 0; k < 24; k++) {
      const low = k / 24; // later fronds hang lower
      G.fan(
        top.clone().add(new THREE.Vector3(0, -low * 0.7, 0)),
        k * golden,
        1.05 - low * 1.35 + (r() - 0.5) * 0.2,
        0.6 + low * 0.35,
        1.6 + r() * 0.35,
        FROND[Math.min(FROND.length - 1, Math.floor(low * 3 + r() * 2))]!,
      );
    }
  } else if (sp === "royal") {
    G.trunk(H - 3, 0.28, 0.22, 8, 8, "#d4d0c6", 0.12);
    // glossy green crownshaft
    G.color("#5e8c45");
    const y0 = H - 3;
    const y1 = H - 0.6;
    for (let i = 0; i < 8; i++) {
      const t0 = (i / 8) * Math.PI * 2;
      const t1 = ((i + 1) / 8) * Math.PI * 2;
      const p = (t: number, rr: number, y: number) =>
        new THREE.Vector3(Math.cos(t) * rr, y, Math.sin(t) * rr);
      const n = new THREE.Vector3(Math.cos((t0 + t1) / 2), 0, Math.sin((t0 + t1) / 2));
      G.quad(
        p(t0, 0.27, y0),
        p(t1, 0.27, y0),
        p(t1, 0.25, y1),
        p(t0, 0.25, y1),
        [0.02, 0.1, 0.03, 0.1, 0.03, 0.2, 0.02, 0.2],
        n,
        [y0 / H, y0 / H, 1, 1],
        [0, 0, 0, 0],
      );
    }
    const top = new THREE.Vector3(0, H - 0.5, 0);
    for (let k = 0; k < 14; k++) {
      const low = k / 14;
      G.feather(
        top,
        k * golden,
        1.05 - low * 1.3 + (r() - 0.5) * 0.15,
        4.2 + r() * 0.6,
        0.85,
        1.2 + low * 0.8,
        0.35,
        FROND[Math.min(FROND.length - 1, Math.floor(low * 3.5 + r() * 1.5))]!,
      );
    }
  } else {
    G.trunk(H - 0.4, 0.24, 0.16, 9, 7, "#a89a88");
    // husk and a few coconuts under the crown
    G.color("#6a5a32");
    const top = new THREE.Vector3(0, H - 0.3, 0);
    for (let k = 0; k < 16; k++) {
      const low = k / 16;
      G.feather(
        top,
        k * golden,
        0.75 - low * 1.2 + (r() - 0.5) * 0.25,
        4.4 + r() * 0.8,
        0.95,
        1.6 + low * 1.0,
        0.25,
        FROND[Math.min(FROND.length - 1, Math.floor(low * 3.2 + r() * 2))]!,
      );
    }
    for (let k = 0; k < 4; k++) {
      const a = k * 1.7;
      const p = new THREE.Vector3(Math.cos(a) * 0.28, H - 0.8, Math.sin(a) * 0.28);
      G.color("#5a6a2a");
      const s = 0.14;
      const n = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      G.quad(
        p.clone().add(new THREE.Vector3(-s, -s, 0)),
        p.clone().add(new THREE.Vector3(s, -s, 0)),
        p.clone().add(new THREE.Vector3(s, s, 0)),
        p.clone().add(new THREE.Vector3(-s, s, 0)),
        [0.02, 0.1, 0.03, 0.1, 0.03, 0.2, 0.02, 0.2],
        n,
        [1, 1, 1, 1],
        [0, 0, 0, 0],
      );
    }
  }
  return G.build();
}

/** shared wind: one time uniform for every palm material */
const wind = { uTime: { value: 0 } };

/** vertex shader patch: trunk lean/curve (per instance) and a gentle wind sway */
function patchSway(sh: THREE.WebGLProgramParametersWithUniforms, H: number) {
  sh.uniforms["uTime"] = wind.uTime;
  sh.vertexShader = sh.vertexShader
    .replace(
      "#include <common>",
      `#include <common>
attribute float aBend;
attribute float aFlex;
attribute float aLean;
uniform float uTime;`,
    )
    .replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
// curve the trunk: offset grows with the square of the height it hangs from
transformed.x += aLean * ${H.toFixed(1)} * aBend * aBend;`,
    )
    .replace(
      "#include <project_vertex>",
      `vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
  // wind (world space: these meshes sit at the origin): the whole palm sways, fronds flutter
  float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
  float sc = length( instanceMatrix[0].xyz );
  float sw = sin( uTime * 0.8 + ph ) * 0.6 + sin( uTime * 1.9 + ph * 1.7 ) * 0.25;
  mvPosition.xz += vec2( 0.8, 0.45 ) * sw * aBend * aBend * 0.18 * sc;
  mvPosition.y += aFlex * sin( uTime * 3.3 + ph * 3.0 + transformed.x * 1.3 + transformed.z ) * 0.09 * sc;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,
    );
}

/** which species grows where: boardwalk coconuts, median fan palms, sidewalk royals */
function speciesAt(city: CityLayout, x: number, z: number): Species {
  const i = Math.floor((x + city.half) / 2);
  const j = Math.floor((z + city.half) / 2);
  const k = city.kind[i * city.cells + j];
  return k === K_BOARD ? "coconut" : k === K_MEDIAN ? "washingtonia" : "royal";
}

type Inst = { x: number; z: number; rot: number; s: number; lean: number; tint: number };

export function CityPalms({ city }: { city: CityLayout }) {
  const groups = useMemo(() => {
    const out: Record<Species, Inst[]> = { washingtonia: [], royal: [], coconut: [] };
    for (const p of city.props) {
      if (p.k !== "palm") continue;
      const sp = speciesAt(city, p.x, p.z);
      // deterministic per-tree variety from the position
      const h1 = Math.abs(Math.sin(p.x * 12.9898 + p.z * 78.233) * 43758.5453) % 1;
      const h2 = Math.abs(Math.sin(p.x * 39.346 + p.z * 11.135) * 24634.6345) % 1;
      const s0 = p.s ?? 10; // 8-14 from the layout
      const t = Math.min(1, Math.max(0, (s0 - 8) / 6));
      const scale =
        sp === "washingtonia" ? 0.8 + t * 0.45 : sp === "royal" ? 0.88 + t * 0.26 : 0.8 + t * 0.5;
      // coconuts lean out over the water (+z) and curve; the others stand nearly straight
      const rot = sp === "coconut" ? -Math.PI / 2 + (h1 - 0.5) * 1.6 : p.rot;
      const lean =
        sp === "coconut" ? 0.1 + h2 * 0.22 : sp === "washingtonia" ? h2 * 0.05 : h2 * 0.02;
      out[sp].push({ x: p.x, z: p.z, rot, s: scale, lean, tint: 0.85 + h1 * 0.3 });
    }
    return out;
  }, [city]);

  const res = useMemo(() => {
    const map = atlas();
    const make = (sp: Species) => {
      const geo = speciesGeo(sp);
      const mat = new THREE.MeshLambertMaterial({
        map,
        vertexColors: true,
        alphaTest: 0.5,
        // soft leaflet edges with MSAA instead of a shimmering hard cut-out
        alphaToCoverage: true,
        side: THREE.DoubleSide,
      });
      mat.onBeforeCompile = (sh) => {
        addSkyFogUniforms(sh);
        patchSway(sh, BASE_H[sp]);
      };
      mat.customProgramCacheKey = () => `palm-${sp}`;
      const depth = new THREE.MeshDepthMaterial({
        depthPacking: THREE.RGBADepthPacking,
        map,
        alphaTest: 0.5,
      });
      depth.onBeforeCompile = (sh) => patchSway(sh, BASE_H[sp]);
      depth.customProgramCacheKey = () => `palm-depth-${sp}`;
      return { geo, mat, depth };
    };
    return { washingtonia: make("washingtonia"), royal: make("royal"), coconut: make("coconut") };
  }, []);
  useEffect(
    () => () => {
      for (const sp of SPECIES) {
        res[sp].geo.dispose();
        res[sp].mat.dispose();
        res[sp].depth.dispose();
      }
    },
    [res],
  );

  const refs = useRef<Record<Species, THREE.InstancedMesh | null>>({
    washingtonia: null,
    royal: null,
    coconut: null,
  });
  useLayoutEffect(() => {
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    for (const sp of SPECIES) {
      const mesh = refs.current[sp];
      const list = groups[sp];
      if (!mesh || !list.length) continue;
      const lean = new Float32Array(list.length);
      list.forEach((p, i) => {
        q.setFromAxisAngle(up, p.rot);
        m4.compose(new THREE.Vector3(p.x, 0.15, p.z), q, new THREE.Vector3(p.s, p.s, p.s));
        mesh.setMatrixAt(i, m4);
        mesh.setColorAt(i, col.setScalar(p.tint));
        lean[i] = p.lean;
      });
      mesh.geometry.setAttribute("aLean", new THREE.InstancedBufferAttribute(lean, 1));
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }, [groups, res]);

  useFrame((state) => {
    wind.uTime.value = state.clock.elapsedTime;
  });

  return (
    <group>
      {SPECIES.map((sp) =>
        groups[sp].length ? (
          <instancedMesh
            key={sp}
            ref={(m) => {
              refs.current[sp] = m;
            }}
            args={[res[sp].geo, res[sp].mat, groups[sp].length]}
            customDepthMaterial={res[sp].depth}
            castShadow
            receiveShadow
          />
        ) : null,
      )}
    </group>
  );
}
