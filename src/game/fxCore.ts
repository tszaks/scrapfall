import * as THREE from "three";

/**
 * Pooled, instanced building blocks for combat effects. Nothing here allocates per
 * frame or per particle: every pool is a fixed-size typed array feeding one draw call.
 *
 * SegPool   soft capsules between two points (sparks, tracers, beams, arcs, smoke puffs)
 * DecalPool bullet holes, scorch marks and frost on walls and ground
 * RingPool  expanding shockwave rings
 * MeshPool  small instanced meshes (casings, stuck harpoons, other players' projectiles)
 */

/** hex colour -> raw sRGB 0..1 (shaders write it straight out, no colour management) */
export function rgb(hex: number): [number, number, number] {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

const SEG_VERT = /* glsl */ `
attribute vec3 iA;
attribute vec3 iB;
attribute float iW;
attribute vec4 iC;
varying vec4 vC;
varying vec2 vP;
varying float vLen;
varying float vR;
void main() {
  vec3 a = (modelViewMatrix * vec4(iA, 1.0)).xyz;
  vec3 b = (modelViewMatrix * vec4(iB, 1.0)).xyz;
  vec3 d = b - a;
  float len = length(d);
  vec3 dir = len > 1e-4 ? d / len : vec3(1.0, 0.0, 0.0);
  vec3 mid = (a + b) * 0.5;
  vec3 side = cross(dir, normalize(mid + vec3(0.0, 0.0, 1e-4)));
  float sl = length(side);
  side = sl > 1e-4 ? side / sl : vec3(0.0, 1.0, 0.0);
  float r = iW * 0.5;
  float along = mix(-r, len + r, position.x);
  vec3 p = a + dir * along + side * (position.y * r);
  vP = vec2(along, position.y * r);
  vLen = len;
  vR = r;
  vC = iC;
  gl_Position = projectionMatrix * vec4(p, 1.0);
}`;

const SEG_FRAG = /* glsl */ `
uniform float uAdd;
varying vec4 vC;
varying vec2 vP;
varying float vLen;
varying float vR;
void main() {
  float s = vP.x - clamp(vP.x, 0.0, vLen);
  float dist = length(vec2(s, vP.y)) / max(vR, 1e-5);
  if (dist >= 1.0) discard;
  float f = 1.0 - dist;
  if (uAdd > 0.5) {
    // glow: soft falloff with a white-hot core
    float g = pow(f, 1.4) * 0.85 + pow(f, 6.0) * 0.8;
    gl_FragColor = vec4(mix(vC.rgb, vec3(1.0), pow(f, 6.0) * 0.55) * vC.a * g, 1.0);
  } else {
    gl_FragColor = vec4(vC.rgb, vC.a * smoothstep(0.0, 0.8, f));
  }
}`;

/** reusable emit spec: grab with `spec()`, fill in, pass to `SegPool.emit` */
export type Spec = {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** fixed segment: B = A + (ox, oy, oz) */
  ox: number; oy: number; oz: number;
  life: number;
  w0: number; w1: number;
  c0: number; c1: number;
  a: number;
  /** alpha curve: (1 - t)^fpow, faded in over the first `fin` of the life */
  fpow: number; fin: number;
  grav: number; drag: number;
  /** streak: tail = pos - vel * stretch */
  stretch: number;
  flicker: boolean;
  /** draw exactly once this frame, then drop */
  once: boolean;
};
const SPEC: Spec = {
  x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, ox: 0, oy: 0, oz: 0, life: 0.3, w0: 0.1, w1: 0.1,
  c0: 0xffffff, c1: -1, a: 1, fpow: 1, fin: 0, grav: 0, drag: 0, stretch: 0, flicker: false, once: false,
};
export function spec(): Spec {
  SPEC.x = SPEC.y = SPEC.z = SPEC.vx = SPEC.vy = SPEC.vz = SPEC.ox = SPEC.oy = SPEC.oz = 0;
  SPEC.life = 0.3; SPEC.w0 = SPEC.w1 = 0.1; SPEC.c0 = 0xffffff; SPEC.c1 = -1; SPEC.a = 1;
  SPEC.fpow = 1; SPEC.fin = 0; SPEC.grav = 0; SPEC.drag = 0; SPEC.stretch = 0; SPEC.flicker = false; SPEC.once = false;
  return SPEC;
}

export class SegPool {
  readonly cap: number;
  n = 0;
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  // simulation state (structure of arrays)
  private p: Float32Array; private v: Float32Array; private o: Float32Array;
  private life: Float32Array; private max: Float32Array;
  private w0: Float32Array; private w1: Float32Array;
  private c0: Float32Array; private c1: Float32Array;
  private a: Float32Array; private fpow: Float32Array; private fin: Float32Array;
  private grav: Float32Array; private drag: Float32Array; private str: Float32Array;
  private flags: Uint8Array;
  // GPU attributes
  private aA: THREE.InstancedBufferAttribute; private aB: THREE.InstancedBufferAttribute;
  private aW: THREE.InstancedBufferAttribute; private aC: THREE.InstancedBufferAttribute;

  constructor(cap: number, additive: boolean) {
    this.cap = cap;
    const f = (k: number) => new Float32Array(cap * k);
    this.p = f(3); this.v = f(3); this.o = f(3); this.life = f(1); this.max = f(1);
    this.w0 = f(1); this.w1 = f(1); this.c0 = f(3); this.c1 = f(3); this.a = f(1);
    this.fpow = f(1); this.fin = f(1); this.grav = f(1); this.drag = f(1); this.str = f(1);
    this.flags = new Uint8Array(cap);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = (k: number) => {
      const at = new THREE.InstancedBufferAttribute(new Float32Array(cap * k), k);
      at.setUsage(THREE.DynamicDrawUsage);
      return at;
    };
    this.aA = mk(3); this.aB = mk(3); this.aW = mk(1); this.aC = mk(4);
    geo.setAttribute("iA", this.aA);
    geo.setAttribute("iB", this.aB);
    geo.setAttribute("iW", this.aW);
    geo.setAttribute("iC", this.aC);
    geo.instanceCount = 0;
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      vertexShader: SEG_VERT,
      fragmentShader: SEG_FRAG,
      uniforms: { uAdd: { value: additive ? 1 : 0 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 12 : 11;
  }

  emit(s: Spec) {
    if (this.n >= this.cap) return -1;
    const i = this.n++;
    const i3 = i * 3;
    this.p[i3] = s.x; this.p[i3 + 1] = s.y; this.p[i3 + 2] = s.z;
    this.v[i3] = s.vx; this.v[i3 + 1] = s.vy; this.v[i3 + 2] = s.vz;
    this.o[i3] = s.ox; this.o[i3 + 1] = s.oy; this.o[i3 + 2] = s.oz;
    this.life[i] = s.once ? 1 : s.life; this.max[i] = s.once ? 1 : s.life;
    this.w0[i] = s.w0; this.w1[i] = s.w1;
    const c0 = rgb(s.c0), c1 = s.c1 < 0 ? c0 : rgb(s.c1);
    this.c0[i3] = c0[0]; this.c0[i3 + 1] = c0[1]; this.c0[i3 + 2] = c0[2];
    this.c1[i3] = c1[0]; this.c1[i3 + 1] = c1[1]; this.c1[i3 + 2] = c1[2];
    this.a[i] = s.a; this.fpow[i] = s.fpow; this.fin[i] = s.fin;
    this.grav[i] = s.grav; this.drag[i] = s.drag; this.str[i] = s.stretch;
    this.flags[i] = (s.flicker ? 1 : 0) | (s.once ? 2 : 0) | (s.ox || s.oy || s.oz ? 4 : 0);
    return i;
  }

  private kill(i: number) {
    const j = --this.n;
    if (i === j) return;
    const i3 = i * 3, j3 = j * 3;
    for (let k = 0; k < 3; k++) {
      this.p[i3 + k] = this.p[j3 + k]!; this.v[i3 + k] = this.v[j3 + k]!; this.o[i3 + k] = this.o[j3 + k]!;
      this.c0[i3 + k] = this.c0[j3 + k]!; this.c1[i3 + k] = this.c1[j3 + k]!;
    }
    this.life[i] = this.life[j]!; this.max[i] = this.max[j]!; this.w0[i] = this.w0[j]!; this.w1[i] = this.w1[j]!;
    this.a[i] = this.a[j]!; this.fpow[i] = this.fpow[j]!; this.fin[i] = this.fin[j]!;
    this.grav[i] = this.grav[j]!; this.drag[i] = this.drag[j]!; this.str[i] = this.str[j]!; this.flags[i] = this.flags[j]!;
  }

  /** age and move everything, dropping what has expired (one-shot entries survive to `upload`) */
  step(dt: number) {
    for (let i = this.n - 1; i >= 0; i--) {
      if (this.flags[i]! & 2) continue;
      const l = (this.life[i] = this.life[i]! - dt);
      if (l <= 0) { this.kill(i); continue; }
      const i3 = i * 3;
      const dr = this.drag[i]! > 0 ? Math.exp(-this.drag[i]! * dt) : 1;
      this.v[i3] = this.v[i3]! * dr;
      this.v[i3 + 1] = (this.v[i3 + 1]! + this.grav[i]! * dt) * dr;
      this.v[i3 + 2] = this.v[i3 + 2]! * dr;
      this.p[i3] = this.p[i3]! + this.v[i3]! * dt;
      this.p[i3 + 1] = this.p[i3 + 1]! + this.v[i3 + 1]! * dt;
      this.p[i3 + 2] = this.p[i3 + 2]! + this.v[i3 + 2]! * dt;
    }
  }

  /** write the GPU buffers, then forget this frame's one-shot entries */
  upload() {
    const A = this.aA.array as Float32Array, B = this.aB.array as Float32Array;
    const W = this.aW.array as Float32Array, C = this.aC.array as Float32Array;
    for (let i = 0; i < this.n; i++) {
      const i3 = i * 3, i4 = i * 4;
      const t = 1 - this.life[i]! / this.max[i]!;
      const px = this.p[i3]!, py = this.p[i3 + 1]!, pz = this.p[i3 + 2]!;
      const fl = this.flags[i]!;
      if (fl & 4) {
        A[i3] = px; A[i3 + 1] = py; A[i3 + 2] = pz;
        B[i3] = px + this.o[i3]!; B[i3 + 1] = py + this.o[i3 + 1]!; B[i3 + 2] = pz + this.o[i3 + 2]!;
      } else {
        const s = this.str[i]!;
        A[i3] = px - this.v[i3]! * s; A[i3 + 1] = py - this.v[i3 + 1]! * s; A[i3 + 2] = pz - this.v[i3 + 2]! * s;
        B[i3] = px; B[i3 + 1] = py; B[i3 + 2] = pz;
      }
      W[i] = this.w0[i]! + (this.w1[i]! - this.w0[i]!) * t;
      let al = this.a[i]! * Math.pow(1 - t, this.fpow[i]!);
      if (this.fin[i]! > 0 && t < this.fin[i]!) al *= t / this.fin[i]!;
      if (fl & 1) al *= 0.35 + Math.random() * 0.65;
      C[i4] = this.c0[i3]! + (this.c1[i3]! - this.c0[i3]!) * t;
      C[i4 + 1] = this.c0[i3 + 1]! + (this.c1[i3 + 1]! - this.c0[i3 + 1]!) * t;
      C[i4 + 2] = this.c0[i3 + 2]! + (this.c1[i3 + 2]! - this.c0[i3 + 2]!) * t;
      C[i4 + 3] = al;
    }
    this.geo.instanceCount = this.n;
    this.mesh.visible = this.n > 0;
    if (this.n > 0) {
      for (const at of [this.aA, this.aB, this.aW, this.aC]) {
        at.clearUpdateRanges();
        at.addUpdateRange(0, this.n * at.itemSize);
        at.needsUpdate = true;
      }
    }
    for (let i = this.n - 1; i >= 0; i--) if (this.flags[i]! & 2) this.kill(i);
  }

  clear() { this.n = 0; }
}

// ---------------------------------------------------------------- decals

const DECAL_VERT = /* glsl */ `
attribute vec3 iP;
attribute vec3 iN;
attribute vec4 iC;
attribute vec4 iX; // size, rotation, type, heat
varying vec2 vUv;
varying vec4 vC;
varying vec2 vX;
void main() {
  vec3 n = normalize(iN);
  vec3 up = abs(n.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t = normalize(cross(up, n));
  vec3 b = cross(n, t);
  float c = cos(iX.y), s = sin(iX.y);
  vec2 q = vec2(position.x * c - position.y * s, position.x * s + position.y * c);
  vec3 p = iP + n * 0.02 + (t * q.x + b * q.y) * iX.x;
  vUv = position.xy * 2.0;
  vC = iC;
  vX = iX.zw;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const DECAL_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec4 vC;
varying vec2 vX;
float hash(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float ang = atan(vUv.y, vUv.x);
  float type = vX.x;
  vec3 col = vec3(0.0);
  float a = 0.0;
  if (type < 0.5) {
    // bullet hole: dark core, chipped grey rim, a few radial cracks, cooling hot edge
    float core = 1.0 - smoothstep(0.22, 0.3, r);
    float rim = smoothstep(0.26, 0.36, r) * (1.0 - smoothstep(0.45, 0.62, r));
    float k = floor((ang + 3.1416) / 6.2832 * 7.0);
    float crack = step(0.55, hash(k + vC.r * 13.0)) * (1.0 - smoothstep(0.02, 0.05, abs(fract((ang + 3.1416) / 6.2832 * 7.0) - 0.5) * r)) * (1.0 - smoothstep(0.4, 0.95, r));
    col = mix(vec3(0.62, 0.6, 0.56), vec3(0.03), max(core, crack * 0.8));
    col = mix(col, vec3(1.0, 0.45, 0.1), vX.y * (1.0 - smoothstep(0.18, 0.4, r)));
    a = max(core, max(rim * 0.55, crack * 0.7));
  } else if (type < 1.5) {
    // scorch: soft sooty blotch with a ragged edge
    float edge = 0.75 + 0.2 * sin(ang * 5.0 + vC.r * 7.0) + 0.08 * sin(ang * 13.0);
    a = (1.0 - smoothstep(edge * 0.35, edge, r)) * 0.85;
    col = mix(vec3(0.02), vec3(0.9, 0.35, 0.08), vX.y * (1.0 - smoothstep(0.0, 0.35, r)));
  } else {
    // frost: pale crystalline star over an icy disc
    float spikes = pow(abs(cos(ang * 3.0)), 18.0) + pow(abs(cos(ang * 3.0 + 0.52)), 30.0) * 0.6;
    float disc = 1.0 - smoothstep(0.3, 0.75, r);
    a = max(disc * 0.55, spikes * (1.0 - smoothstep(0.2, 1.0, r)));
    col = mix(vec3(0.75, 0.93, 1.0), vec3(1.0), spikes);
  }
  gl_FragColor = vec4(col, a * vC.a);
}`;

type Decal = { t: number; max: number };
export class DecalPool {
  readonly cap: number;
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private next = 0;
  private live: Decal[];
  private base: Float32Array; // per-decal starting alpha + heat
  private aP: THREE.InstancedBufferAttribute; private aN: THREE.InstancedBufferAttribute;
  private aC: THREE.InstancedBufferAttribute; private aX: THREE.InstancedBufferAttribute;
  constructor(cap: number) {
    this.cap = cap;
    this.live = Array.from({ length: cap }, () => ({ t: 0, max: 1 }));
    this.base = new Float32Array(cap * 2);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = (k: number) => {
      const at = new THREE.InstancedBufferAttribute(new Float32Array(cap * k), k);
      at.setUsage(THREE.DynamicDrawUsage);
      return at;
    };
    this.aP = mk(3); this.aN = mk(3); this.aC = mk(4); this.aX = mk(4);
    geo.setAttribute("iP", this.aP); geo.setAttribute("iN", this.aN);
    geo.setAttribute("iC", this.aC); geo.setAttribute("iX", this.aX);
    geo.instanceCount = cap;
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      vertexShader: DECAL_VERT, fragmentShader: DECAL_FRAG, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
  }
  /** type 0 = bullet hole, 1 = scorch, 2 = frost */
  add(x: number, y: number, z: number, nx: number, ny: number, nz: number, size: number, type: number, life = 8, heat = 0) {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    this.live[i]!.t = life; this.live[i]!.max = life;
    const P = this.aP.array as Float32Array, N = this.aN.array as Float32Array, X = this.aX.array as Float32Array;
    P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z;
    N[i * 3] = nx; N[i * 3 + 1] = ny; N[i * 3 + 2] = nz;
    X[i * 4] = size; X[i * 4 + 1] = Math.random() * 6.283; X[i * 4 + 2] = type; X[i * 4 + 3] = heat;
    this.base[i * 2] = Math.random();
    this.base[i * 2 + 1] = heat;
    this.aP.needsUpdate = true; this.aN.needsUpdate = true;
  }
  step(dt: number) {
    const C = this.aC.array as Float32Array, X = this.aX.array as Float32Array;
    let any = false;
    for (let i = 0; i < this.cap; i++) {
      const d = this.live[i]!;
      if (d.t <= 0) { C[i * 4 + 3] = 0; continue; }
      d.t -= dt;
      any = true;
      const age = d.max - d.t;
      // red channel carries the per-decal random seed (crack pattern, ragged edge)
      C[i * 4] = this.base[i * 2]!;
      C[i * 4 + 3] = Math.max(0, Math.min(1, d.t / 1.5));
      X[i * 4 + 3] = Math.max(0, this.base[i * 2 + 1]! * (1 - age / 0.9));
    }
    this.mesh.visible = any;
    if (any) { this.aC.needsUpdate = true; this.aX.needsUpdate = true; }
  }
  clear() { for (const d of this.live) d.t = 0; }
}

// ---------------------------------------------------------------- rings

type Ring = { t: number; max: number; x: number; y: number; z: number; r0: number; r1: number; col: THREE.Color; flat: boolean };
export class RingPool {
  readonly mesh: THREE.InstancedMesh;
  private rings: Ring[];
  private next = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private c = new THREE.Color();
  private flatQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  constructor(cap: number) {
    const geo = new THREE.RingGeometry(0.82, 1, 48);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, fog: false, toneMapped: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 12;
    this.rings = Array.from({ length: cap }, () => ({ t: 0, max: 1, x: 0, y: 0, z: 0, r0: 0, r1: 1, col: new THREE.Color(), flat: true }));
    this.mesh.setColorAt(0, this.c.set(0));
  }
  add(x: number, y: number, z: number, r0: number, r1: number, life: number, hex: number, flat: boolean) {
    const r = this.rings[this.next]!;
    this.next = (this.next + 1) % this.rings.length;
    Object.assign(r, { t: life, max: life, x, y, z, r0, r1, flat });
    r.col.set(hex);
  }
  step(dt: number, cam: THREE.Camera) {
    let n = 0;
    for (const r of this.rings) {
      if (r.t <= 0) continue;
      r.t -= dt;
      if (r.t <= 0) continue;
      const k = 1 - r.t / r.max;
      const e = 1 - (1 - k) * (1 - k); // ease out
      const rad = r.r0 + (r.r1 - r.r0) * e;
      this.q.copy(r.flat ? this.flatQ : cam.quaternion);
      this.m.compose(this.p.set(r.x, r.y, r.z), this.q, this.s.set(rad, rad, rad));
      this.mesh.setMatrixAt(n, this.m);
      this.mesh.setColorAt(n, this.c.copy(r.col).multiplyScalar((1 - k) * (1 - k)));
      n++;
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }
  clear() { for (const r of this.rings) r.t = 0; }
}

// ---------------------------------------------------------------- meshes

export class MeshPool {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private m = new THREE.Matrix4();
  private s = new THREE.Vector3();
  private c = new THREE.Color();
  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, readonly cap: number) {
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }
  begin() { this.n = 0; }
  add(p: THREE.Vector3, q: THREE.Quaternion, scale: number, tint?: number) {
    if (this.n >= this.cap) return;
    this.m.compose(p, q, this.s.set(scale, scale, scale));
    this.mesh.setMatrixAt(this.n, this.m);
    if (tint !== undefined) this.mesh.setColorAt(this.n, this.c.set(tint));
    this.n++;
  }
  end() {
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0;
    if (this.n > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }
}
