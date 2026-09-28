// A tumbleweed: a loose ball of thin, dry, curling twigs (Russian thistle), not a solid orb.
// Built once as a shell of branches that wander round the sphere, each a thin three-sided
// stalk, forking as they go, with a denser, darker core of stems inside.
import * as THREE from "three";

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * radius r (m), `twigs` branches of `segs` segments each. Positions and normals only
 * (non-indexed), centred on the origin; vertex colours pale straw to grey-brown.
 */
export function tumbleweedGeometry(r = 0.45, twigs = 60, segs = 4, seed = 7) {
  const R = rng(seed);
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const d = new THREE.Vector3();
  const u = new THREE.Vector3();
  const v = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const tmp = new THREE.Vector3();
  const pale = new THREE.Color("#c8b27e");
  const dark = new THREE.Color("#7a6440");
  const c = new THREE.Color();
  /** a thin triangular stalk from a to b, width w */
  const stalk = (w: number, k: number) => {
    d.subVectors(b, a);
    const len = d.length();
    if (len < 1e-4) return;
    d.divideScalar(len);
    u.crossVectors(d, Math.abs(d.y) > 0.9 ? tmp.set(1, 0, 0) : up).normalize();
    v.crossVectors(d, u).normalize();
    c.copy(dark).lerp(pale, k);
    const corners: THREE.Vector3[] = [];
    for (let i = 0; i < 3; i++) {
      const t = (i / 3) * Math.PI * 2;
      corners.push(
        u
          .clone()
          .multiplyScalar(Math.cos(t) * w)
          .addScaledVector(v, Math.sin(t) * w),
      );
    }
    for (let i = 0; i < 3; i++) {
      const o0 = corners[i]!;
      const o1 = corners[(i + 1) % 3]!;
      const n = o0.clone().add(o1).normalize();
      const quad = [a.clone().add(o0), a.clone().add(o1), b.clone().add(o1), b.clone().add(o0)];
      for (const idx of [0, 1, 2, 0, 2, 3]) {
        const p = quad[idx]!;
        pos.push(p.x, p.y, p.z);
        nor.push(n.x, n.y, n.z);
        col.push(c.r, c.g, c.b);
      }
    }
  };
  const onShell = (p: THREE.Vector3, rr: number) => p.normalize().multiplyScalar(rr);
  for (let i = 0; i < twigs; i++) {
    // start near the centre, strike out to the shell, then wander along it
    const dir = new THREE.Vector3(R() * 2 - 1, R() * 2 - 1, R() * 2 - 1).normalize();
    const core = i < twigs * 0.25;
    a.copy(dir).multiplyScalar(r * (0.05 + R() * 0.15));
    b.copy(dir).multiplyScalar(r * (core ? 0.45 + R() * 0.2 : 0.8 + R() * 0.2));
    stalk(r * (core ? 0.022 : 0.016), core ? 0.1 : 0.4);
    if (core) continue;
    // wander: each step turns a little along the sphere, sometimes forking
    const heading = new THREE.Vector3(R() * 2 - 1, R() * 2 - 1, R() * 2 - 1);
    heading.addScaledVector(dir, -heading.dot(dir)).normalize();
    for (let s = 0; s < segs; s++) {
      a.copy(b);
      const step = r * (0.28 + R() * 0.2);
      tmp.copy(a).addScaledVector(heading, step);
      const rr = r * (0.82 + R() * 0.2);
      b.copy(onShell(tmp, rr));
      stalk(r * (0.013 - s * 0.002), 0.55 + s * 0.12);
      // curl: the heading bends round the ball
      const n = a.clone().normalize();
      heading.addScaledVector(n, -heading.dot(n));
      heading
        .add(new THREE.Vector3(R() - 0.5, R() - 0.5, R() - 0.5).multiplyScalar(0.9))
        .normalize();
      if (R() < 0.35) {
        // a short fork off this point
        const fa = a.clone();
        const fb = onShell(
          a.clone().addScaledVector(n.cross(heading).normalize(), step * 0.6),
          rr * 0.95,
        );
        const saveA = a.clone();
        const saveB = b.clone();
        a.copy(fa);
        b.copy(fb);
        stalk(r * 0.009, 0.8);
        a.copy(saveA);
        b.copy(saveB);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return g;
}
