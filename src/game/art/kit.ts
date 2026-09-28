// Scrapfall art kit: the shared look for guns, robots and cars.
//
// Every model is authored as many small parts (bevelled panels, lathed barrels, pistons,
// cables, bolts) and merged into ONE geometry per moving piece, so detail costs vertices,
// not draw calls. Each vertex carries its own albedo (`color`) and surface (`aSurf`:
// roughness, metalness, glow, paint mask), and one shared MeshStandardMaterial variant
// turns that into grounded PBR metal and polymer, with procedural wear (grime, scratches,
// chipped paint, a faint hammered bump) computed in the shader from object-space
// position: no textures to download, no UVs needed.
//
// Metal needs something to reflect, and the game has no environment map, so the
// material reflects a cheap analytic sky instead: the time of day's hemisphere colours
// plus a sun glint (`artFrame` copies them from the blended look once per frame).
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { liveLook, todFrame } from "../timeOfDay";

// ---------------------------------------------------------------- surfaces
/** roughness, metalness, glow (emissive x albedo), paint (1 = tinted by instance colour) */
export type Surf = readonly [r: number, m: number, e?: number, p?: number];
export const SURF = {
  steel: [0.42, 0.9],
  darkSteel: [0.55, 0.85],
  gunmetal: [0.36, 0.8],
  blued: [0.3, 0.85],
  chrome: [0.1, 1],
  brushed: [0.28, 1],
  brass: [0.32, 1],
  copper: [0.34, 1],
  rust: [0.88, 0.3],
  paint: [0.5, 0.25],
  enamel: [0.35, 0.15],
  polymer: [0.72, 0],
  rubber: [0.92, 0],
  cable: [0.6, 0.1],
  wood: [0.72, 0],
  leather: [0.62, 0],
  glass: [0.06, 0.4],
  lens: [0.05, 0.6, 0.15],
  glow: [1, 0, 1.6],
  glowSoft: [0.9, 0, 0.8],
  carPaint: [0.26, 0.4, 0, 1],
  carPaintMatte: [0.55, 0.2, 0, 1],
  trim: [0.6, 0.2],
  tyre: [0.93, 0],
} as const satisfies Record<string, Surf>;

// ---------------------------------------------------------------- shared unit geometry
const UNIT = {
  box: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.SphereGeometry(1, 12, 8),
  sphereLo: new THREE.SphereGeometry(1, 8, 6),
  hemi: new THREE.SphereGeometry(1, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2),
};
const cylCache = new Map<string, THREE.BufferGeometry>();
function cylGeo(rt: number, rb: number, seg: number, open: boolean) {
  const k = `${rt.toFixed(3)}|${rb.toFixed(3)}|${seg}|${open}`;
  let g = cylCache.get(k);
  if (!g) {
    g = new THREE.CylinderGeometry(rt, rb, 1, seg, 1, open);
    cylCache.set(k, g);
  }
  return g;
}
const cbCache = new Map<string, THREE.BufferGeometry>();
/**
 * A chamfered box: flat faces joined by 45-degree edge strips and corner facets (132
 * vertices, a quarter of a rounded box), so panels catch a machined highlight on every edge.
 * The chamfer is absolute (metres) so small and big panels read the same.
 */
function chamferBox(w: number, h: number, d: number, bevel: number) {
  const b = Math.max(1e-4, Math.min(bevel, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
  const k = `${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}|${b.toFixed(4)}`;
  let g = cbCache.get(k);
  if (g) return g;
  const H = [w / 2, h / 2, d / 2];
  // three points per corner, one on each face that meets there
  const pt = (s: number[], axis: number) => {
    const v = [0, 1, 2].map((a) => s[a]! * (a === axis ? H[a]! : H[a]! - b));
    return new THREE.Vector3(v[0], v[1], v[2]);
  };
  const corners: number[][] = [];
  for (const x of [-1, 1])
    for (const y of [-1, 1]) for (const z of [-1, 1]) corners.push([x, y, z]);
  const polys: THREE.Vector3[][] = [];
  // the six faces
  for (let a = 0; a < 3; a++)
    for (const sgn of [-1, 1]) {
      const ps = corners.filter((c) => c[a] === sgn).map((c) => pt(c, a));
      const u = (a + 1) % 3;
      const v = (a + 2) % 3;
      ps.sort(
        (p, q) =>
          Math.atan2(p.getComponent(v), p.getComponent(u)) -
          Math.atan2(q.getComponent(v), q.getComponent(u)),
      );
      polys.push(ps);
    }
  // the twelve edge strips
  for (let e = 0; e < 3; e++) {
    const a = (e + 1) % 3;
    const c2 = (e + 2) % 3;
    for (const sa of [-1, 1])
      for (const sb of [-1, 1]) {
        const c1 = [0, 0, 0];
        c1[a] = sa;
        c1[c2] = sb;
        c1[e] = -1;
        const cc = [...c1];
        cc[e] = 1;
        polys.push([pt(c1, a), pt(c1, c2), pt(cc, c2), pt(cc, a)]);
      }
  }
  // the eight corner facets
  for (const c of corners) polys.push([pt(c, 0), pt(c, 1), pt(c, 2)]);
  const pos: number[] = [];
  const n = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  for (const ps of polys)
    for (let i = 1; i + 1 < ps.length; i++) {
      const A = ps[0]!;
      let B = ps[i]!;
      let C = ps[i + 1]!;
      n.crossVectors(e1.subVectors(B, A), e2.subVectors(C, A));
      if (n.dot(A.clone().add(B).add(C)) < 0) [B, C] = [C, B]; // face outward (convex, centred)
      pos.push(A.x, A.y, A.z, B.x, B.y, B.z, C.x, C.y, C.z);
    }
  g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  cbCache.set(k, g);
  return g;
}

export type V3 = readonly [number, number, number];
export type PartOpts = {
  /** euler rotation (radians, XYZ) */
  rot?: V3;
  /** bone index for skinned rigs (default: the current `bone`) */
  bone?: number;
  /** detail level: 0 = always, 1 = near model only (bolts, cables, greebles) */
  lod?: 0 | 1;
};

type Part = {
  geo: THREE.BufferGeometry;
  /** cheaper stand-in for the far LOD (plain box for a chamfered one, fewer segments) */
  lo?: THREE.BufferGeometry | undefined;
  m: THREE.Matrix4;
  color: THREE.Color;
  surf: Surf;
  bone: number;
  lod: 0 | 1;
};

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();

/**
 * Authoring helper: add parts in metres (y up, +z forward), nest sub-assemblies with
 * `push`/`pop`, then `build()` one merged geometry. Colours are sRGB hex strings or numbers.
 */
export class Model {
  private parts: Part[] = [];
  private stack: THREE.Matrix4[] = [new THREE.Matrix4()];
  /** bone index applied to parts added from now on */
  bone = 0;

  private get top() {
    return this.stack[this.stack.length - 1]!;
  }
  /** enter a local frame (position, euler rotation, uniform or xyz scale) */
  push(p: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], scale: number | V3 = 1) {
    _e.set(rot[0], rot[1], rot[2]);
    _q.setFromEuler(_e);
    const s =
      typeof scale === "number"
        ? _s.set(scale, scale, scale)
        : _s.set(scale[0], scale[1], scale[2]);
    _m.compose(_v.set(p[0], p[1], p[2]), _q, s);
    this.stack.push(this.top.clone().multiply(_m));
    return this;
  }
  pop() {
    if (this.stack.length > 1) this.stack.pop();
    return this;
  }
  /** mirror everything added inside `fn` across x (adds both sides) */
  both(fn: (side: 1 | -1) => void) {
    fn(1);
    this.push([0, 0, 0], [0, 0, 0], [-1, 1, 1]);
    fn(-1);
    this.pop();
    return this;
  }

  /** any geometry, placed with a local position / rotation / scale */
  geo(
    g: THREE.BufferGeometry,
    p: V3,
    scale: V3,
    color: THREE.ColorRepresentation,
    surf: Surf,
    o: PartOpts & { lo?: THREE.BufferGeometry | undefined } = {},
  ) {
    const r = o.rot ?? [0, 0, 0];
    _e.set(r[0], r[1], r[2]);
    _q.setFromEuler(_e);
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3(p[0], p[1], p[2]),
      _q.clone(),
      new THREE.Vector3(scale[0], scale[1], scale[2]),
    );
    this.parts.push({
      geo: g,
      lo: o.lo ?? (g === UNIT.sphere ? UNIT.sphereLo : undefined),
      m: this.top.clone().multiply(local),
      color: new THREE.Color(color),
      surf,
      bone: o.bone ?? this.bone,
      lod: o.lod ?? 0,
    });
    return this;
  }
  /** box; `bevel` > 0 rounds its edges (metres) */
  box(
    w: number,
    h: number,
    d: number,
    p: V3,
    color: THREE.ColorRepresentation,
    surf: Surf,
    o: PartOpts & { bevel?: number } = {},
  ) {
    if (o.bevel && o.bevel > 0) {
      const lo = new THREE.BoxGeometry(w, h, d);
      return this.geo(chamferBox(w, h, d, o.bevel), p, [1, 1, 1], color, surf, { ...o, lo });
    }
    return this.geo(UNIT.box, p, [w, h, d], color, surf, o);
  }
  /** cylinder along y (use rot to lay it down); rb = bottom radius */
  cyl(
    r: number,
    h: number,
    p: V3,
    color: THREE.ColorRepresentation,
    surf: Surf,
    o: PartOpts & { rb?: number; seg?: number; open?: boolean } = {},
  ) {
    const rb = o.rb ?? r;
    const seg = o.seg ?? 12;
    const k = Math.max(r, rb) || 1;
    const lo =
      seg > 6 ? cylGeo(r / k, rb / k, Math.max(6, Math.round(seg / 2)), !!o.open) : undefined;
    return this.geo(cylGeo(r / k, rb / k, seg, !!o.open), p, [k, h, k], color, surf, { ...o, lo });
  }
  /** cylinder along z (a barrel pointing forward) */
  tubeZ(
    r: number,
    len: number,
    p: V3,
    color: THREE.ColorRepresentation,
    surf: Surf,
    o: PartOpts & { rb?: number; seg?: number; open?: boolean } = {},
  ) {
    return this.cyl(r, len, p, color, surf, { ...o, rot: [Math.PI / 2, 0, 0] });
  }
  /** cylinder along x (an axle) */
  tubeX(
    r: number,
    len: number,
    p: V3,
    color: THREE.ColorRepresentation,
    surf: Surf,
    o: PartOpts & { rb?: number; seg?: number } = {},
  ) {
    return this.cyl(r, len, p, color, surf, { ...o, rot: [0, 0, Math.PI / 2] });
  }
  sphere(
    r: number,
    p: V3,
    color: THREE.ColorRepresentation,
    surf: Surf,
    o: PartOpts & { s?: V3; low?: boolean } = {},
  ) {
    const s = o.s ?? [1, 1, 1];
    return this.geo(
      o.low ? UNIT.sphereLo : UNIT.sphere,
      p,
      [r * s[0], r * s[1], r * s[2]],
      color,
      surf,
      {
        ...(o.rot ? { rot: o.rot } : {}),
        ...(o.bone !== undefined ? { bone: o.bone } : {}),
        ...(o.lod !== undefined ? { lod: o.lod } : {}),
      },
    );
  }
  /** upper half sphere (a dome), flat side down */
  dome(
    r: number,
    p: V3,
    color: THREE.ColorRepresentation,
    surf: Surf,
    o: PartOpts & { s?: V3 } = {},
  ) {
    const s = o.s ?? [1, 1, 1];
    return this.geo(UNIT.hemi, p, [r * s[0], r * s[1], r * s[2]], color, surf, o);
  }
  cone(
    r: number,
    h: number,
    p: V3,
    color: THREE.ColorRepresentation,
    surf: Surf,
    o: PartOpts & { seg?: number } = {},
  ) {
    return this.cyl(0.0001, h, p, color, surf, { ...o, rb: r, seg: o.seg ?? 10 });
  }
  torus(
    R: number,
    tube: number,
    p: V3,
    color: THREE.ColorRepresentation,
    surf: Surf,
    o: PartOpts & { seg?: number; arc?: number } = {},
  ) {
    const g = new THREE.TorusGeometry(R, tube, 5, o.seg ?? 16, o.arc ?? Math.PI * 2);
    return this.geo(g, p, [1, 1, 1], color, surf, o);
  }
  /** lathe a profile [radius, y][] around y */
  lathe(
    profile: readonly (readonly [number, number])[],
    p: V3,
    color: THREE.ColorRepresentation,
    surf: Surf,
    o: PartOpts & { seg?: number } = {},
  ) {
    const g = new THREE.LatheGeometry(
      profile.map(([x, y]) => new THREE.Vector2(x, y)),
      o.seg ?? 16,
    );
    return this.geo(g, p, [1, 1, 1], color, surf, o);
  }
  /** extrude a 2D outline (x right, y up) `depth` along +z, centred on z, with a bevel */
  extrude(
    outline: readonly (readonly [number, number])[],
    depth: number,
    p: V3,
    color: THREE.ColorRepresentation,
    surf: Surf,
    o: PartOpts & {
      bevel?: number;
      holes?: (readonly (readonly [number, number])[])[];
      curve?: number;
    } = {},
  ) {
    const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
    for (const h of o.holes ?? [])
      shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
    const bevel = o.bevel ?? 0;
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(1e-4, depth - bevel * 2),
      bevelEnabled: bevel > 0,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 2,
      curveSegments: o.curve ?? 6,
    });
    g.translate(0, 0, -depth / 2 + bevel);
    g.deleteAttribute("uv");
    g.computeVertexNormals();
    return this.geo(g, p, [1, 1, 1], color, surf, o);
  }
  /** a flexible cable / hose through points */
  cable(
    points: readonly V3[],
    r: number,
    color: THREE.ColorRepresentation,
    surf: Surf = SURF.cable,
    o: PartOpts & { seg?: number } = {},
  ) {
    const curve = new THREE.CatmullRomCurve3(
      points.map((q) => new THREE.Vector3(q[0], q[1], q[2])),
    );
    const g = new THREE.TubeGeometry(curve, o.seg ?? Math.max(6, points.length * 4), r, 5, false);
    return this.geo(g, [0, 0, 0], [1, 1, 1], color, surf, { lod: 1, ...o });
  }
  /** a row of bolt heads along a line (greeble, near LOD only) */
  bolts(
    from: V3,
    to: V3,
    n: number,
    r: number,
    color: THREE.ColorRepresentation,
    o: PartOpts = {},
  ) {
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      this.cyl(
        r,
        r * 0.8,
        [
          from[0] + (to[0] - from[0]) * t,
          from[1] + (to[1] - from[1]) * t,
          from[2] + (to[2] - from[2]) * t,
        ],
        color,
        SURF.steel,
        { seg: 6, lod: 1, ...o },
      );
    }
    return this;
  }
  /** number of parts so far */
  get count() {
    return this.parts.length;
  }

  /**
   * Merge into one indexed-free geometry with position, normal, color, aSurf and (when
   * `skin` is set) skinIndex/skinWeight for rigid-part skinning. `lod` 1 keeps only the
   * silhouette parts.
   */
  build(opts: { lod?: 0 | 1; skin?: boolean } = {}) {
    const lod = opts.lod ?? 0;
    const geos: THREE.BufferGeometry[] = [];
    const nm = new THREE.Matrix3();
    for (const pt of this.parts) {
      if (lod === 1 && pt.lod === 1) continue;
      const base = lod === 1 && pt.lo ? pt.lo : pt.geo;
      const src = base.index ? base.toNonIndexed() : base.clone();
      for (const k of Object.keys(src.attributes))
        if (k !== "position" && k !== "normal") src.deleteAttribute(k);
      if (!src.getAttribute("normal")) src.computeVertexNormals();
      src.applyMatrix4(pt.m);
      // a mirrored (negative determinant) frame flips the winding: swap two corners back
      if (pt.m.determinant() < 0) flipWinding(src);
      nm.getNormalMatrix(pt.m);
      const n = src.getAttribute("position").count;
      const col = new Float32Array(n * 3);
      const surf = new Float32Array(n * 4);
      const lin = pt.color.clone(); // THREE.Color stores linear; vertex colours are linear too
      for (let i = 0; i < n; i++) {
        col[i * 3] = lin.r;
        col[i * 3 + 1] = lin.g;
        col[i * 3 + 2] = lin.b;
        surf[i * 4] = pt.surf[0];
        surf[i * 4 + 1] = pt.surf[1];
        surf[i * 4 + 2] = pt.surf[2] ?? 0;
        surf[i * 4 + 3] = pt.surf[3] ?? 0;
      }
      src.setAttribute("color", new THREE.BufferAttribute(col, 3));
      src.setAttribute("aSurf", new THREE.BufferAttribute(surf, 4));
      if (opts.skin) {
        const si = new Uint16Array(n * 4);
        const sw = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) {
          si[i * 4] = pt.bone;
          sw[i * 4] = 1;
        }
        src.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si, 4));
        src.setAttribute("skinWeight", new THREE.BufferAttribute(sw, 4));
      }
      geos.push(src);
    }
    if (!geos.length) {
      const empty = new THREE.BufferGeometry();
      empty.setAttribute("position", new THREE.BufferAttribute(new Float32Array(9), 3));
      empty.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(9), 3));
      empty.setAttribute("color", new THREE.BufferAttribute(new Float32Array(9), 3));
      empty.setAttribute("aSurf", new THREE.BufferAttribute(new Float32Array(12), 4));
      return empty;
    }
    const out = mergeGeometries(geos, false)!;
    ART_STATS.verts += out.getAttribute("position").count;
    geos.forEach((g) => g.dispose());
    out.computeBoundingSphere();
    out.computeBoundingBox();
    return out;
  }
}

function flipWinding(g: THREE.BufferGeometry) {
  for (const name of ["position", "normal"]) {
    const a = g.getAttribute(name) as THREE.BufferAttribute;
    const arr = a.array as Float32Array;
    for (let i = 0; i < a.count; i += 3) {
      for (let c = 0; c < 3; c++) {
        const t = arr[(i + 1) * 3 + c]!;
        arr[(i + 1) * 3 + c] = arr[(i + 2) * 3 + c]!;
        arr[(i + 2) * 3 + c] = t;
      }
    }
    a.needsUpdate = true;
  }
}

/** running total of built vertices (debug: exposed as window.__artStats) */
export const ART_STATS = { verts: 0, models: {} as Record<string, number> };
if (typeof window !== "undefined")
  (window as unknown as { __artStats?: unknown }).__artStats = ART_STATS;

// ---------------------------------------------------------------- shared uniforms
/** the analytic sky every art material reflects, and the global wear / lift controls */
export const ART_U = {
  uEnvSky: { value: new THREE.Color(0.5, 0.55, 0.65) },
  uEnvGround: { value: new THREE.Color(0.18, 0.16, 0.14) },
  uSunDir: { value: new THREE.Vector3(0.3, 0.6, 0.4).normalize() },
  uSunCol: { value: new THREE.Color(1, 0.8, 0.6) },
  /** self-light: a share of each part's own colour, so silhouettes survive the night */
  uLift: { value: 0.12 },
};
let lastVersion = -1;
/** copy the time of day into the art uniforms (cheap; call from any art component's frame) */
export function artFrame() {
  if (todFrame.version === lastVersion) return;
  lastVersion = todFrame.version;
  const L = liveLook;
  const hi = Math.max(0.25, L.hemiI);
  ART_U.uEnvSky.value.copy(L.hemiSky).multiplyScalar(0.55 * hi);
  ART_U.uEnvGround.value.copy(L.hemiGround).multiplyScalar(0.45 * hi);
  ART_U.uSunDir.value.copy(L.sunDir).normalize();
  ART_U.uSunCol.value.copy(L.sunColor).multiplyScalar(Math.min(1.4, L.sunI * 0.55));
  // the night needs more self-light than the sunset to keep silhouettes readable
  const night = Math.max(0, Math.min(1, 1 - L.sunI / 1.2));
  ART_U.uLift.value = 0.06 + night * 0.1;
}

// ---------------------------------------------------------------- shader patch
const NOISE = /* glsl */ `
float artHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float artNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(artHash(i), artHash(i + vec3(1,0,0)), f.x), mix(artHash(i + vec3(0,1,0)), artHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(artHash(i + vec3(0,0,1)), artHash(i + vec3(1,0,1)), f.x), mix(artHash(i + vec3(0,1,1)), artHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}`;

export type ArtOpts = {
  /** rigid-part skinning (SkinnedMesh) */
  skin?: boolean;
  /** instanced colour tints only the paint-masked parts (cars) */
  paint?: boolean;
  /** wear amount 0..1 (grime, scratches, chips) */
  wear?: number;
  /** object-space noise scale (1 / metres): bigger for small props like guns */
  scale?: number;
  /** multiplies the glow parts (e.g. 0 to kill them, 3 for a white-hot flash) */
  glow?: number;
  /** mixes every albedo toward this colour (elite gilding, hit flash); w = amount */
  tint?: THREE.Vector4 | undefined;
  transparent?: boolean;
  opacity?: number;
  fog?: boolean;
};

/**
 * One art material. Every variant shares one program per (skin, paint, transparent)
 * combination; wear / scale / glow / tint are uniforms, so variants are cheap.
 */
export function artMaterial(o: ArtOpts = {}) {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 1,
    transparent: !!o.transparent,
    opacity: o.opacity ?? 1,
    fog: o.fog ?? true,
    depthWrite: !o.transparent,
  });
  const U = {
    uWear: { value: o.wear ?? 0.7 },
    uNScale: { value: o.scale ?? 3 },
    uGlow: { value: o.glow ?? 1 },
    uTint: { value: o.tint ?? new THREE.Vector4(1, 1, 1, 0) },
  };
  m.userData["art"] = U;
  const paint = !!o.paint;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, ART_U, U);
    sh.vertexShader = sh.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute vec4 aSurf;
varying vec4 vSurf;
varying vec3 vArtPos;
varying vec3 vArtNrm;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vSurf = aSurf;
vArtPos = position;
vArtNrm = normal;`,
      );
    if (paint)
      sh.vertexShader = sh.vertexShader.replace(
        "#include <color_vertex>",
        `#include <color_vertex>
#ifdef USE_INSTANCING_COLOR
vColor.rgb = color.rgb * mix(vec3(1.0), instanceColor.rgb, aSurf.w);
#endif`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec4 vSurf;
varying vec3 vArtPos;
varying vec3 vArtNrm;
uniform float uWear;
uniform float uNScale;
uniform float uGlow;
uniform vec4 uTint;
uniform vec3 uEnvSky;
uniform vec3 uEnvGround;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform float uLift;
${NOISE}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
vec3 artBase = diffuseColor.rgb;
float artGlowK = vSurf.z;
vec3 aP = vArtPos * uNScale;
float aN1 = artNoise(aP);
float aN2 = artNoise(aP * 4.3 + 17.0);
// grime: big soft blotches, heavier low down and in the recesses the normal faces down into
float aGrime = smoothstep(0.35, 0.95, aN1 * 0.65 + aN2 * 0.35) * uWear;
aGrime += clamp(-vArtNrm.y, 0.0, 1.0) * 0.25 * uWear;
// scratches: long thin streaks (stretched noise) catch the light on bare metal
vec3 aS = vArtPos * uNScale * vec3(9.0, 1.2, 9.0);
float aScr = smoothstep(0.83, 0.93, artNoise(aS + aN2 * 2.0)) * uWear;
// chips: painted parts lose flakes of paint to the steel underneath
float aN3 = artNoise(aP * 11.0 + 5.0);
float aChip = smoothstep(0.8, 0.84, aN3 * 0.75 + aN1 * 0.25) * uWear * (1.0 - vSurf.y) * (1.0 - step(0.001, vSurf.z)) * (1.0 - step(0.8, vSurf.x));
float aMetal = clamp(vSurf.y + aChip * 0.7, 0.0, 1.0);
float aRough = clamp(vSurf.x + (aGrime - 0.3) * 0.25 - aScr * 0.3 - aChip * 0.25, 0.04, 1.0);
diffuseColor.rgb *= 1.0 - aGrime * 0.35 * (1.0 - artGlowK);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.3, 0.31, 0.33), aChip * 0.7);
diffuseColor.rgb += aScr * vSurf.y * 0.18;
diffuseColor.rgb = mix(diffuseColor.rgb, uTint.rgb * (0.4 + 0.6 * dot(artBase, vec3(0.3, 0.59, 0.11)) * 2.0), uTint.w * (1.0 - artGlowK));`,
      )
      .replace("#include <roughnessmap_fragment>", `float roughnessFactor = aRough;`)
      .replace("#include <metalnessmap_fragment>", `float metalnessFactor = aMetal;`)
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
{
  // a faint hammered / pitted bump from the same noise (surface-gradient bump mapping)
  float h = (aN2 * 0.6 + aN1 * 0.4) * 0.012 * uWear + aScr * 0.004;
  vec3 dpx = dFdx(-vViewPosition); vec3 dpy = dFdy(-vViewPosition);
  float hx = dFdx(h); float hy = dFdy(h);
  vec3 r1 = cross(dpy, normal); vec3 r2 = cross(normal, dpx);
  float det = dot(dpx, r1);
  vec3 grad = sign(det) * (hx * r1 + hy * r2);
  normal = normalize(abs(det) * normal - grad);
}`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
totalEmissiveRadiance += artBase * artGlowK * uGlow + diffuseColor.rgb * uLift * (1.0 - artGlowK);`,
      )
      .replace(
        "#include <lights_fragment_maps>",
        `#include <lights_fragment_maps>
#if defined( RE_IndirectSpecular )
{
  vec3 rd = inverseTransformDirection(reflect(-geometryViewDir, geometryNormal), viewMatrix);
  vec3 env = mix(uEnvGround, uEnvSky, smoothstep(-0.25, 0.5, rd.y));
  env += uSunCol * pow(max(dot(rd, uSunDir), 0.0), mix(64.0, 4.0, aRough)) * (1.0 - aRough * 0.7);
  radiance += env;
}
#endif`,
      );
  };
  m.customProgramCacheKey = () => `scrapfall-art|${o.skin ? 1 : 0}|${paint ? 1 : 0}`;
  return m;
}

/** set a material's per-variant uniforms (safe before first compile) */
export function artSet(
  m: THREE.Material,
  v: { wear?: number; glow?: number; tint?: [number, number, number, number] },
) {
  const U = m.userData["art"] as
    | { uWear: { value: number }; uGlow: { value: number }; uTint: { value: THREE.Vector4 } }
    | undefined;
  if (!U) return;
  if (v.wear !== undefined) U.uWear.value = v.wear;
  if (v.glow !== undefined) U.uGlow.value = v.glow;
  if (v.tint) U.uTint.value.set(...v.tint);
}

/** sRGB hex -> THREE.Color helper for callers that need to scale colours */
export const col = (c: THREE.ColorRepresentation) => new THREE.Color(c);
