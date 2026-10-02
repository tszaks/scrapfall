// Detail pass for the 10 procedural arenas: a painted ground texture, instanced ground cover,
// and a skyline of biome silhouettes beyond the walls — so the detailed robots don't sit on a
// bare plane. Everything is deterministic from the block layout (matches in co-op).
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import type { Theme } from "../themes";

type B = { x: number; z: number };

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const texCache = new Map<string, THREE.CanvasTexture>();
/** painted ground: mottled base, stones/cracks, faint tile seams (replaces the grid lines) */
export function groundTexture(theme: Theme) {
  const hit = texCache.get(theme.name);
  if (hit) return hit;
  const S = 512;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  const r = rng(theme.name.length * 7919);
  g.fillStyle = theme.ground;
  g.fillRect(0, 0, S, S);
  const shades = [theme.grid[0], theme.grid[1], theme.blocks[2], theme.ground];
  for (let i = 0; i < 260; i++) {
    g.globalAlpha = 0.08 + r() * 0.12;
    g.fillStyle = shades[i % shades.length]!;
    const x = r() * S, y = r() * S, rad = 6 + r() * 38;
    g.beginPath();
    g.ellipse(x, y, rad, rad * (0.5 + r() * 0.5), r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  // speckle
  for (let i = 0; i < 2200; i++) {
    g.globalAlpha = 0.06 + r() * 0.1;
    g.fillStyle = r() > 0.25 ? "#000000" : "#ffffff";
    g.fillRect(r() * S, r() * S, 1 + r() * 2, 1 + r() * 2);
  }
  // cracks
  g.strokeStyle = theme.wall;
  g.lineWidth = 1.4;
  for (let i = 0; i < 14; i++) {
    g.globalAlpha = 0.25 + r() * 0.2;
    let x = r() * S, y = r() * S;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      x += (r() - 0.5) * 50;
      y += (r() - 0.5) * 50;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // faint tile seams (neon map keeps a lit grid)
  const neon = theme.blockShape === "server";
  g.globalAlpha = neon ? 0.55 : 0.12;
  g.strokeStyle = neon ? theme.grid[1] : theme.grid[0];
  g.lineWidth = neon ? 2 : 2;
  for (let k = 0; k <= 4; k++) {
    g.beginPath(); g.moveTo(k * (S / 4), 0); g.lineTo(k * (S / 4), S); g.stroke();
    g.beginPath(); g.moveTo(0, k * (S / 4)); g.lineTo(S, k * (S / 4)); g.stroke();
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  texCache.set(theme.name, t);
  return t;
}

export function Ground({ theme, size }: { theme: Theme; size: number }) {
  const tex = useMemo(() => {
    const t = groundTexture(theme).clone();
    t.needsUpdate = true;
    t.repeat.set(size / 8, size / 8);
    return t;
  }, [theme, size]);
  return (
    <mesh rotation-x={-Math.PI / 2} receiveShadow>
      <planeGeometry args={[size, size]} />
      <meshLambertMaterial map={tex} />
    </mesh>
  );
}

function Instanced({
  geo,
  color,
  emissive,
  items,
}: {
  geo: THREE.BufferGeometry;
  color: string;
  emissive?: string | undefined;
  items: { x: number; y: number; z: number; s: number; sy?: number; ry: number; tilt?: number }[];
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    items.forEach((it, i) => {
      o.position.set(it.x, it.y, it.z);
      o.rotation.set(it.tilt ?? 0, it.ry, (it.tilt ?? 0) * 0.6);
      o.scale.set(it.s, it.s * (it.sy ?? 1), it.s);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [items]);
  if (!items.length) return null;
  return (
    <instancedMesh ref={ref} args={[geo, undefined, items.length]} receiveShadow>
      <meshLambertMaterial
        color={color}
        flatShading
        emissive={emissive ?? "#000000"}
        emissiveIntensity={emissive ? 0.5 : 0}
      />
    </instancedMesh>
  );
}

const GEO = {
  blade: new THREE.ConeGeometry(0.05, 0.4, 3).translate(0, 0.2, 0),
  pebble: new THREE.DodecahedronGeometry(0.12, 0),
  chip: new THREE.OctahedronGeometry(0.1, 0).scale(1, 1.8, 1),
  dot: new THREE.BoxGeometry(0.12, 0.03, 0.12),
  pine: new THREE.ConeGeometry(1, 3, 6).translate(0, 1.5, 0),
  rock: new THREE.DodecahedronGeometry(1, 0).scale(1, 0.7, 1),
  spire: new THREE.ConeGeometry(0.8, 4, 5).translate(0, 2, 0),
  tower: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
  mesa: new THREE.CylinderGeometry(0.9, 1.1, 1, 7).translate(0, 0.5, 0),
  tank: new THREE.CylinderGeometry(0.8, 0.8, 1, 10).translate(0, 0.5, 0),
  shrub: new THREE.IcosahedronGeometry(0.32, 0).scale(1, 0.7, 1).translate(0, 0.18, 0),
  log: new THREE.CylinderGeometry(0.09, 0.11, 1.3, 6).rotateZ(Math.PI / 2).translate(0, 0.09, 0),
  bloom: new THREE.OctahedronGeometry(0.06, 0).translate(0, 0.22, 0),
  stem: new THREE.CylinderGeometry(0.012, 0.012, 0.22, 3).translate(0, 0.11, 0),
  slab: new THREE.BoxGeometry(0.7, 0.04, 0.5).translate(0, 0.02, 0),
};

function coverFor(theme: Theme) {
  switch (theme.blockShape) {
    case "tree": return { geo: GEO.blade, color: "#5f8a3c", alt: "#3f6a2c" };
    case "pagoda": return { geo: GEO.blade, color: "#9fbf6a", alt: "#f3b8c8" };
    case "crystal":
    case "berg": return { geo: GEO.chip, color: "#e8f7ff", alt: theme.blocks[2] };
    case "server": return { geo: GEO.dot, color: theme.grid[0], alt: theme.grid[1], glow: true };
    case "coral": return { geo: GEO.pebble, color: theme.blocks[1], alt: theme.blocks[0], glow: true };
    default: return { geo: GEO.pebble, color: theme.blocks[2], alt: theme.wall };
  }
}

function skylineFor(theme: Theme) {
  switch (theme.blockShape) {
    case "tree": return { geo: GEO.pine, h: [1.4, 2.4] };
    case "pagoda": return { geo: GEO.pine, h: [1, 1.6] };
    case "crystal":
    case "berg": return { geo: GEO.spire, h: [1.2, 3] };
    case "server": return { geo: GEO.tower, h: [8, 22] };
    case "butte":
    case "monument": return { geo: GEO.mesa, h: [4, 11] };
    case "vat": return { geo: GEO.tank, h: [3, 8] };
    case "coral": return { geo: GEO.spire, h: [1.5, 3.5] };
    default: return { geo: GEO.rock, h: [2, 5] };
  }
}

export function MapDressing({ theme, blocks, half }: { theme: Theme; blocks: B[]; half: number }) {
  const data = useMemo(() => {
    const r = rng(Math.round(half * 1000 + blocks.length * 31 + (blocks[0]?.x ?? 0) * 97));
    const clear = (x: number, z: number) =>
      blocks.every((b) => Math.abs(b.x - x) > 1.25 || Math.abs(b.z - z) > 1.25);
    const a: Parameters<typeof Instanced>[0]["items"] = [];
    const b: Parameters<typeof Instanced>[0]["items"] = [];
    const n = Math.round(half * half * 1.6);
    for (let i = 0; i < n; i++) {
      const x = (r() - 0.5) * (half * 2 - 2);
      const z = (r() - 0.5) * (half * 2 - 2);
      if (!clear(x, z)) continue;
      const it = { x, y: 0.02, z, s: 0.6 + r() * 0.9, ry: r() * 6.28, tilt: (r() - 0.5) * 0.4 };
      (r() > 0.4 ? a : b).push(it);
    }
    // skyline ring beyond the walls
    const sky = skylineFor(theme);
    const ring: typeof a = [];
    const ring2: typeof a = [];
    for (let i = 0; i < 46; i++) {
      const ang = (i / 46) * Math.PI * 2 + r() * 0.1;
      const d = half + 4 + r() * 14;
      // square-ish ring so corners aren't empty
      const k = 1 / Math.max(Math.abs(Math.cos(ang)), Math.abs(Math.sin(ang)));
      const dist = Math.min(d * k, d * 1.35);
      const s = sky.geo === GEO.tower ? 2 + r() * 3 : 1.6 + r() * 2.4;
      const h = sky.h[0]! + r() * (sky.h[1]! - sky.h[0]!);
      (i % 2 ? ring : ring2).push({
        x: Math.cos(ang) * dist,
        y: 0,
        z: Math.sin(ang) * dist,
        s,
        sy: sky.geo === GEO.tower || sky.geo === GEO.mesa || sky.geo === GEO.tank ? h / s : h / 1.6,
        ry: r() * 6.28,
      });
    }
    // scattered stones and debris across the floor
    const rocks: typeof a = [];
    for (let i = 0; i < Math.round(half * 4); i++) {
      const x = (r() - 0.5) * (half * 2 - 3), z = (r() - 0.5) * (half * 2 - 3);
      if (!clear(x, z)) continue;
      rocks.push({ x, y: 0, z, s: 0.15 + r() * 0.35, ry: r() * 6.28, tilt: (r() - 0.5) * 0.6 });
    }
    // rubble piled at the foot of every piece of cover and along the walls
    const base: typeof a = [];
    for (const bl of blocks) for (let k = 0; k < 5; k++) {
      const ang = r() * 6.28, d = 1.15 + r() * 0.4;
      base.push({ x: bl.x + Math.cos(ang) * d, y: 0.03, z: bl.z + Math.sin(ang) * d, s: 0.7 + r() * 1.1, ry: r() * 6.28, tilt: r() * 0.5 });
    }
    for (let i = 0; i < Math.round(half * 8); i++) {
      const t = (r() - 0.5) * (half * 2 - 2), side = Math.floor(r() * 4), e = half - 1.2 - r() * 0.8;
      const [x, z] = side === 0 ? [t, e] : side === 1 ? [t, -e] : side === 2 ? [e, t] : [-e, t];
      base.push({ x, y: 0.03, z, s: 0.8 + r() * 1.4, ry: r() * 6.28, tilt: r() * 0.5 });
    }
    // two more skyline layers for depth
    const far: typeof a = [];
    for (let i = 0; i < 70; i++) {
      const ang = (i / 70) * Math.PI * 2 + r() * 0.08, d = half + 22 + r() * 30;
      const h = sky.h[0]! + r() * (sky.h[1]! - sky.h[0]!) * 1.4, sc = 2 + r() * 3;
      far.push({ x: Math.cos(ang) * d, y: 0, z: Math.sin(ang) * d, s: sc, sy: sky.geo === GEO.tower || sky.geo === GEO.mesa || sky.geo === GEO.tank ? (h * 1.3) / sc : h / 1.2, ry: r() * 6.28 });
    }
    // ankle-height detail you walk through: shrub clumps, fallen logs, little flowers, flat slabs
    const shrubs: typeof a = [], logs: typeof a = [], blooms: typeof a = [], slabs: typeof a = [];
    for (let i = 0; i < Math.round(half * 6); i++) {
      const x = (r() - 0.5) * (half * 2 - 3), z = (r() - 0.5) * (half * 2 - 3);
      if (!clear(x, z)) continue;
      const c = r();
      if (c < 0.45) for (let k = 0; k < 3; k++) shrubs.push({ x: x + (r() - 0.5) * 0.7, y: 0, z: z + (r() - 0.5) * 0.7, s: 0.6 + r() * 0.6, ry: r() * 6.28 });
      else if (c < 0.6) logs.push({ x, y: 0, z, s: 0.7 + r() * 0.6, ry: r() * 6.28 });
      else if (c < 0.85) for (let k = 0; k < 6; k++) blooms.push({ x: x + (r() - 0.5) * 1.2, y: 0, z: z + (r() - 0.5) * 1.2, s: 0.8 + r() * 0.6, ry: r() * 6.28 });
      else slabs.push({ x, y: 0.01, z, s: 0.8 + r() * 0.9, ry: r() * 6.28, tilt: (r() - 0.5) * 0.08 });
    }
    return { a, b, ring, ring2, sky, rocks, base, far, shrubs, logs, blooms, slabs };
  }, [theme, blocks, half]);

  const cov = coverFor(theme);
  const outer = half * 2 + 80;
  return (
    <group>
      {/* ground beyond the walls so the skyline stands on something */}
      <mesh rotation-x={-Math.PI / 2} position-y={-0.02}>
        <ringGeometry args={[half * 1.02, outer, 4, 1, Math.PI / 4]} />
        <meshLambertMaterial color={theme.grid[0]} />
      </mesh>
      <Instanced geo={cov.geo} color={cov.color} emissive={cov.glow ? cov.color : undefined} items={data.a} />
      <Instanced geo={cov.geo} color={cov.alt} emissive={cov.glow ? cov.alt : undefined} items={data.b} />
      <Instanced geo={data.sky.geo} color={theme.blocks[2]} items={data.ring} />
      <Instanced geo={data.sky.geo} color={theme.wall} items={data.ring2} />
      <Instanced geo={GEO.rock} color={theme.blocks[2]} items={data.rocks} />
      <Instanced geo={GEO.pebble} color={theme.wall} items={data.base} />
      <Instanced geo={data.sky.geo} color={theme.grid[1] ?? theme.wall} items={data.far} />
      <Instanced geo={GEO.shrub} color={cov.alt} emissive={cov.glow ? cov.alt : undefined} items={data.shrubs} />
      <Instanced geo={GEO.log} color={theme.blocks[2]} items={data.logs} />
      <Instanced geo={GEO.stem} color={cov.color} items={data.blooms} />
      <Instanced geo={GEO.bloom} color={theme.enemyBullet} emissive={theme.enemyBullet} items={data.blooms} />
      <Instanced geo={GEO.slab} color={theme.wall} items={data.slabs} />
    </group>
  );
}
