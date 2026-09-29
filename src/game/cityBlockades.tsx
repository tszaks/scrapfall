// Solo on Vice Heights: the city always builds its full co-op grid, and solo play is fenced
// into the middle 70% (soloBounds.ts). Every street, sidewalk and park path that crosses the
// fence line gets a police blockade: jersey barriers, construction fencing hung with ROAD
// CLOSED signs, striped sawhorses with amber flashers, cones, and on the wider streets two
// police cruisers parked nose to nose with their light bars going. The collision comes from
// soloBounds.sealGaps(); this only dresses it. Everything stands on or beyond the sealed ring.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { Geo } from "./cityGeo";
import type { CityLayout } from "./cityLayout";
import type { TimeOfDay } from "./lighting";
import type { Gap } from "./soloBounds";
import { bakeCar, vehicleLamps } from "./art/cars";
import { makeVehicle } from "./vehicles";

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let signTex: THREE.CanvasTexture | null = null;
/** 1 x 2 atlas: ROAD CLOSED (top), POLICE LINE tape (bottom) */
function signTexture() {
  if (signTex) return signTex;
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const g = c.getContext("2d")!;
  // ROAD CLOSED: white board, red border, orange/white stripes under the words
  g.fillStyle = "#f4f2ec";
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = "#c81e1e";
  g.lineWidth = 10;
  g.strokeRect(6, 6, 500, 116);
  g.fillStyle = "#111";
  g.font = "bold 58px Arial, Helvetica, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("ROAD CLOSED", 256, 66);
  // POLICE LINE tape
  g.fillStyle = "#f2c81a";
  g.fillRect(0, 128, 512, 128);
  g.fillStyle = "#111";
  g.font = "bold 40px Arial, Helvetica, sans-serif";
  g.fillText("POLICE LINE  DO NOT CROSS", 256, 192);
  signTex = new THREE.CanvasTexture(c);
  signTex.colorSpace = THREE.SRGBColorSpace;
  signTex.anisotropy = 8;
  signTex.wrapS = THREE.RepeatWrapping;
  return signTex;
}
let fenceTex: THREE.CanvasTexture | null = null;
/** chain-link: a diamond wire pattern with transparent holes */
function fenceTexture() {
  if (fenceTex) return fenceTex;
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = "rgba(210,214,218,1)";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(64, 64);
  g.moveTo(64, 0);
  g.lineTo(0, 64);
  g.stroke();
  fenceTex = new THREE.CanvasTexture(c);
  fenceTex.wrapS = fenceTex.wrapT = THREE.RepeatWrapping;
  fenceTex.colorSpace = THREE.SRGBColorSpace;
  return fenceTex;
}

type Light = { x: number; y: number; z: number; kind: "red" | "blue" | "amber"; ph: number };

function build(city: CityLayout, gaps: Gap[]) {
  const body = new Geo();
  const signs = new Geo();
  const fence = new Geo();
  const lights: Light[] = [];
  body.mat(0, 0.5, 0);
  for (const gap of gaps) {
    const r = mulberry(Math.round(gap.x * 7 + gap.z * 13) + 17);
    const out = gap.axis === "x" ? Math.sign(gap.z) : Math.sign(gap.x);
    const rot =
      gap.axis === "x" ? (gap.z < 0 ? 0 : Math.PI) : gap.x < 0 ? Math.PI / 2 : -Math.PI / 2;
    const s = Math.sin(rot);
    const c = Math.cos(rot);
    const ring = (gap.axis === "x" ? gap.z : gap.x) - out; // inner edge of the sealed ring
    /** local (t along the gap, o outward from the ring's inner edge, y) -> world */
    const W = (t: number, o: number) =>
      gap.axis === "x" ? { x: gap.x + t, z: ring + out * o } : { x: ring + out * o, z: gap.z + t };
    // local unit vectors in world space: +x along the gap (as the stamp sees it), +z inward
    const lx = { x: c, z: -s };
    const lz = { x: s, z: c };
    const P = (t: number, o: number, y: number, ax: number, az: number) => {
      const p = W(t, o);
      return [p.x + lx.x * ax + lz.x * az, y, p.z + lx.z * ax + lz.z * az] as const;
    };
    const w = gap.w;
    const half = w / 2 + 0.6;
    // ---- jersey barriers along the whole opening ----
    for (let t = -half; t < half; t += 3.7) {
      const cx = t + 1.8;
      const q = (ax: number, y: number, az: number) => P(cx, 0.55, y, ax, az);
      body.col(r() < 0.8 ? "#bdb8ae" : "#d8d2c6");
      const L = 1.8;
      // trapezoid prism: base 0.62 wide, top 0.2, 0.82 tall (profile across local z)
      const prof: [number, number][] = [
        [0.31, 0],
        [0.18, 0.25],
        [0.1, 0.82],
        [-0.1, 0.82],
        [-0.18, 0.25],
        [-0.31, 0],
      ];
      for (let i = 0; i + 1 < prof.length; i++) {
        const [za, ya] = prof[i]!;
        const [zb, yb] = prof[i + 1]!;
        const a = q(-L, ya, za);
        const b = q(L, ya, za);
        const cc = q(L, yb, zb);
        const d = q(-L, yb, zb);
        body.quad(a[0], a[1], a[2], b[0], b[1], b[2], cc[0], cc[1], cc[2], d[0], d[1], d[2]);
      }
      for (const e of [-L, L]) {
        const pts = prof.map(([z, y]) => q(e, y, z));
        for (let i = 1; i + 1 < pts.length; i++) {
          const [p0, p1, p2] =
            e < 0 ? [pts[0]!, pts[i]!, pts[i + 1]!] : [pts[0]!, pts[i + 1]!, pts[i]!];
          body.tri(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]);
        }
      }
      // reflective stripe
      body.col("#e8e0c8");
    }
    // ---- construction fencing behind: 2.3 m panels on block feet, hung with ROAD CLOSED ----
    for (let t = -half; t < half; t += 3.5) {
      const a = P(t, 1.6, 0, 0, 0);
      const b = P(t + 3.5, 1.6, 0, 0, 0);
      fence.col("#ffffff");
      fence.mat(0);
      // double-sided mesh quad, uv in metres
      fence.quad(a[0], 0.12, a[2], b[0], 0.12, b[2], b[0], 2.3, b[2], a[0], 2.3, a[2], [
        0,
        0,
        3.5 / 0.15,
        2.2 / 0.15,
      ]);
      fence.quad(b[0], 0.12, b[2], a[0], 0.12, a[2], a[0], 2.3, a[2], b[0], 2.3, b[2], [
        0,
        0,
        3.5 / 0.15,
        2.2 / 0.15,
      ]);
      body.col("#8a8e92");
      for (const e of [0, 3.5]) {
        const p = W(t + e, 1.6);
        body.box(p.x, 0, p.z, 0.06, 2.35, 0.06);
        body.col("#c8c2b8");
        body.obox(p.x, 0, p.z, 0.5, 0.14, 0.7, rot);
        body.col("#8a8e92");
      }
      const top0 = P(t, 1.6, 2.28, 0, 0);
      const top1 = P(t + 3.5, 1.6, 2.28, 0, 0);
      body.col("#8a8e92");
      body.obox((top0[0] + top1[0]) / 2, 2.28, (top0[2] + top1[2]) / 2, 3.5, 0.05, 0.05, rot);
    }
    // ROAD CLOSED boards on the fence and a length of police tape
    const nb = Math.max(1, Math.round(w / 9));
    for (let k = 0; k < nb; k++) {
      const t = -w / 2 + ((k + 0.5) * w) / nb;
      const a = P(t, 1.52, 1.1, -1.25, 0);
      const b = P(t, 1.52, 1.1, 1.25, 0);
      signs.col("#ffffff");
      signs.quad(
        a[0],
        1.1,
        a[2],
        b[0],
        1.1,
        b[2],
        b[0],
        1.72,
        b[2],
        a[0],
        1.72,
        a[2],
        [0, 0.5, 1, 1],
      );
    }
    {
      const a = P(-half, 0.52, 0.95, 0, 0);
      const b = P(half, 0.52, 0.95, 0, 0);
      signs.col("#ffffff");
      signs.quad(a[0], 0.86, a[2], b[0], 0.86, b[2], b[0], 1.02, b[2], a[0], 1.02, a[2], [
        0,
        0,
        w / 5,
        0.5,
      ]);
      signs.quad(b[0], 0.86, b[2], a[0], 0.86, a[2], a[0], 1.02, a[2], b[0], 1.02, b[2], [
        0,
        0,
        w / 5,
        0.5,
      ]);
    }
    // ---- striped sawhorses with amber flashers in front of the fence ----
    const nsh = Math.max(1, Math.floor(w / 7));
    for (let k = 0; k < nsh; k++) {
      const t = -w / 2 + ((k + 0.5) * w) / nsh + (r() - 0.5);
      for (const [y, h] of [
        [1.0, 0.2],
        [0.55, 0.2],
      ] as const) {
        for (let i = 0; i < 6; i++) {
          const p = P(t, 0.3, 0, -1.2 + i * 0.4 + 0.2, 0);
          body.col(i % 2 ? "#f4f2ec" : "#e8641a");
          body.obox(p[0], y, p[2], 0.4, h, 0.05, rot);
        }
      }
      body.col("#6a6e72");
      for (const e of [-1.1, 1.1]) {
        const p = P(t, 0.3, 0, e, 0);
        body.obox(p[0], 0, p[2], 0.06, 1.2, 0.5, rot);
      }
      const lp = P(t, 0.3, 1.3, -1.05, 0);
      lights.push({ x: lp[0], y: 1.32, z: lp[2], kind: "amber", ph: r() });
    }
    // ---- cruisers nose to nose on the wider streets ----
    if (w >= 14) {
      for (const side of [-1, 1]) {
        const v = makeVehicle(r, Infinity, ["police"])!;
        const yaw = rot + (side > 0 ? -Math.PI / 2 - 0.45 : Math.PI / 2 + 0.45);
        const p = W(side * (v.len / 2 + 0.3), 4.6);
        const sy = Math.sin(yaw);
        const cy = Math.cos(yaw);
        bakeCar(body, v, p.x, 0, p.z, yaw);
        for (const part of vehicleLamps(v)) {
          if (part.kind !== "barR" && part.kind !== "barB") continue;
          lights.push({
            x: p.x + part.x * cy + part.z * sy,
            y: part.y,
            z: p.z - part.x * sy + part.z * cy,
            kind: part.kind === "barR" ? "red" : "blue",
            ph: side > 0 ? 0 : 0.5,
          });
        }
      }
      // cones fanned out in front of the cruisers
      for (let k = 0; k < 7; k++) {
        const p = W(-6 + k * 2, 3.0 + Math.sin(k) * 0.4);
        body.col("#ff6a1a");
        body.cyl(p.x, 0, p.z, 0.2, 0.7, 8, true, 0.03);
        body.col("#f4f2ec");
        body.cyl(p.x, 0.35, p.z, 0.12, 0.12, 8, false, 0.1);
        body.col("#2a2a2a");
        body.box(p.x, 0, p.z, 0.46, 0.04, 0.46);
      }
    }
  }
  void city;
  return {
    body: body.n ? body.build() : null,
    signs: signs.n ? signs.build("uv") : null,
    fence: fence.n ? fence.build("uv") : null,
    lights,
  };
}

export function CityBlockades({
  city,
  gaps,
  time,
}: {
  city: CityLayout;
  gaps: Gap[];
  time: TimeOfDay;
}) {
  const built = useMemo(() => build(city, gaps), [city, gaps]);
  const mats = useMemo(
    () => ({
      body: new THREE.MeshLambertMaterial({ vertexColors: true }),
      signs: new THREE.MeshLambertMaterial({ vertexColors: true, map: signTexture() }),
      fence: new THREE.MeshLambertMaterial({
        vertexColors: true,
        map: fenceTexture(),
        alphaTest: 0.4,
        side: THREE.DoubleSide,
      }),
      light: new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false }),
    }),
    [],
  );
  const lightGeo = useMemo(() => new THREE.BoxGeometry(0.34, 0.16, 0.24), []);
  useEffect(
    () => () => {
      [built.body, built.signs, built.fence].forEach((g) => g?.dispose());
    },
    [built],
  );
  useEffect(
    () => () => {
      Object.values(mats).forEach((m) => m.dispose());
      lightGeo.dispose();
    },
    [mats, lightGeo],
  );
  const lightRef = useRef<THREE.InstancedMesh>(null);
  const _m = useMemo(() => new THREE.Matrix4(), []);
  const _c = useMemo(() => new THREE.Color(), []);
  const lightCols = useMemo(
    () => ({
      red: new THREE.Color("#ff2020"),
      blue: new THREE.Color("#2a5aff"),
      amber: new THREE.Color("#ffb020"),
    }),
    [],
  );
  useEffect(() => {
    const m = lightRef.current;
    if (!m) return;
    built.lights.forEach((l, i) => m.setMatrixAt(i, _m.makeTranslation(l.x, l.y, l.z)));
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [built, _m]);
  useFrame((state) => {
    const m = lightRef.current;
    if (!m) return;
    const t = state.clock.elapsedTime;
    const k = time === "night" ? 1.6 : 1.1;
    built.lights.forEach((l, i) => {
      const phase = (t * (l.kind === "amber" ? 1.3 : 2.4) + l.ph) % 1;
      const on = l.kind === "amber" ? phase < 0.5 : l.kind === "red" ? phase < 0.5 : phase >= 0.5;
      _c.copy(lightCols[l.kind]).multiplyScalar(on ? k : 0.12);
      m.setColorAt(i, _c);
    });
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
  return (
    <group>
      {built.body && <mesh geometry={built.body} material={mats.body} castShadow receiveShadow />}
      {built.signs && <mesh geometry={built.signs} material={mats.signs} />}
      {built.fence && <mesh geometry={built.fence} material={mats.fence} castShadow />}
      {built.lights.length > 0 && (
        <instancedMesh ref={lightRef} args={[lightGeo, mats.light, built.lights.length]} />
      )}
    </group>
  );
}
