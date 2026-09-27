// Solo on Dry Gulch: every pass through the ring of ridges (roads, the dry riverbed, trails)
// is closed by a deliberate, believable barricade: overturned wagons, stacked barrels and
// crates, rockslides, a sheriff's sawhorse barricade with a wanted poster, ROAD CLOSED and
// BRIDGE OUT signs. The collision comes from soloBounds.sealGaps(); this only dresses it.
// Everything stands on or beyond the sealed ring of cells, so nothing pokes into the
// playable square, and it's all taller than a person.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";

import { Geo } from "../cityGeo";
import type { TimeOfDay } from "../lighting";
import type { Gap } from "../soloBounds";
import { W, WK, type WesternLayout } from "./layout";
import { WESTERN_LOOK } from "./look";
import { geoKit, propTemplate } from "./mesh";
import { WL, softGlow } from "./textures";
import { facadeMaterial, syncEnv } from "./materials";

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const { boxP, beam, cylP, signBoard } = geoKit;

/** an overturned wagon lying on its side (local: long axis x, bed facing +z, base y = 0) */
function overturnedWagon(G: Geo, r: () => number) {
  G.col("#c4a47e");
  // the bed on its side: bottom boards face the player
  boxP(G, WL.TIMBER, -2.2, 0, -0.5, 2.2, 1.75, 0.35);
  G.col("#9a7a58");
  for (const x of [-2.1, -0.7, 0.7, 2.1])
    boxP(G, WL.TIMBER, x - 0.08, 0, 0.35, x + 0.08, 1.75, 0.45); // cross members
  boxP(G, WL.TIMBER, -2.3, 1.55, 0.3, 2.3, 1.7, 0.5); // axle beam (upper)
  boxP(G, WL.TIMBER, -2.3, 0.1, 0.3, 2.3, 0.25, 0.5);
  // wheels: the upper pair stick out flat, one sags, a broken one leans on the bed
  const wheel = (x: number, y: number, z: number, rad: number, flat: boolean, tilt = 0) => {
    const seg = 14;
    G.col("#8a6a4a");
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      if (flat)
        beam(
          G,
          x + Math.cos(a0) * rad,
          y + Math.sin(a0) * rad * tilt,
          z + Math.sin(a0) * rad,
          x + Math.cos(a1) * rad,
          y + Math.sin(a1) * rad * tilt,
          z + Math.sin(a1) * rad,
          0.09,
        );
      else
        beam(
          G,
          x + Math.cos(a0) * rad,
          y + Math.sin(a0) * rad,
          z,
          x + Math.cos(a1) * rad,
          y + Math.sin(a1) * rad,
          z,
          0.09,
        );
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI;
      if (flat)
        beam(
          G,
          x - Math.cos(a) * rad,
          y - Math.sin(a) * rad * tilt,
          z - Math.sin(a) * rad,
          x + Math.cos(a) * rad,
          y + Math.sin(a) * rad * tilt,
          z + Math.sin(a) * rad,
          0.045,
        );
      else
        beam(
          G,
          x - Math.cos(a) * rad,
          y - Math.sin(a) * rad,
          z,
          x + Math.cos(a) * rad,
          y + Math.sin(a) * rad,
          z,
          0.045,
        );
    }
  };
  wheel(-1.4, 2.1, 0.4, 0.62, true, 0.15);
  wheel(1.5, 2.05, 0.35, 0.5, true, -0.2);
  wheel(-1.3, 0.55, 0.9, 0.55, false);
  if (r() < 0.7) wheel(2.6, 0.6, 1.1, 0.58, false);
  // the canvas bonnet torn and trailing on the ground behind
  G.col("#ffffff", 0.9).mat(WL.CANVAS);
  G.quad(-2.0, 0.05, -0.6, 2.0, 0.05, -0.6, 2.2, 1.4, -1.9, -1.8, 1.2, -2.1, [0, 0, 1.3, 0.6]);
  G.quad(2.0, 0.05, -0.6, -2.0, 0.05, -0.6, -1.8, 1.2, -2.1, 2.2, 1.4, -2.1, [0, 0, 1.3, 0.6]);
}

/** a sheriff's sawhorse barricade with a wanted poster nailed to it (local: along x) */
function sawhorse(G: Geo, E: Geo, w: number) {
  G.col("#a88a66");
  for (const x of [-w / 2 + 0.2, w / 2 - 0.2]) {
    beam(G, x, 0, -0.45, x, 1.25, 0, 0.09);
    beam(G, x, 0, 0.45, x, 1.25, 0, 0.09);
  }
  G.col("#e8dcc0");
  boxP(G, WL.PAINT, -w / 2, 1.0, -0.06, w / 2, 1.3, 0.06);
  boxP(G, WL.PAINT, -w / 2, 0.5, -0.06, w / 2, 0.72, 0.06);
  // red stripes on the rails
  G.col("#a82418");
  for (let x = -w / 2 + 0.2; x < w / 2 - 0.3; x += 0.7) {
    boxP(G, WL.PAINT, x, 1.0, 0.061, x + 0.3, 1.3, 0.07);
    boxP(G, WL.PAINT, x + 0.35, 0.5, 0.061, x + 0.65, 0.72, 0.07);
  }
  signBoard(G, W["WANTED"], -w / 4, 0.78, 0.07, 0.62, 0.8, false);
  signBoard(G, W["KEEP OUT"], w / 4, 1.34, 0.0, 1.6, 0.42, false);
  // a lantern hung on the post
  G.col("#2a2420");
  boxP(G, WL.IRON, w / 2 - 0.32, 1.3, -0.1, w / 2 - 0.08, 1.35, 0.14);
  E.col("#ffb050");
  E.box(w / 2 - 0.2, 1.36, 0.02, 0.16, 0.28, 0.16);
}

/** a big painted road sign on two posts (local: along x, facing +z) */
function roadSign(G: Geo, word: number) {
  G.col("#9a7a58");
  boxP(G, WL.TIMBER, -1.5, 0, -0.08, -1.34, 2.9, 0.08);
  boxP(G, WL.TIMBER, 1.34, 0, -0.08, 1.5, 2.9, 0.08);
  signBoard(G, word, 0, 1.8, 0.09, 3.2, 0.95);
}

function buildBlockades(L: WesternLayout, gaps: Gap[]) {
  const G = new Geo();
  const E = new Geo();
  const P = new Geo();
  G.mat(WL.TIMBER, 0.5, 0);
  const barrels = propTemplate("barrels");
  const barrel = propTemplate("barrel");
  const crates = propTemplate("crates");
  const crate = propTemplate("crate");
  const boulder = propTemplate("boulder");
  // sun-bleached: the barricades face away from the sunset, so they are paler than town props
  const tint = new THREE.Color(1.5, 1.45, 1.4);
  const groundAt = (x: number, z: number) => {
    const i = Math.floor((x + L.half) / 2);
    const j = Math.floor((z + L.half) / 2);
    return i >= 0 && j >= 0 && i < L.cells && j < L.cells ? L.ground[i * L.cells + j]! : WK.DESERT;
  };
  for (const g of gaps) {
    const r = mulberry(Math.round(g.x * 7 + g.z * 13) + 991);
    const out = g.axis === "x" ? Math.sign(g.z) : Math.sign(g.x);
    // local frame: +x along the gap, +z toward the playable square (inward)
    const rot = g.axis === "x" ? (g.z < 0 ? 0 : Math.PI) : g.x < 0 ? Math.PI / 2 : -Math.PI / 2;
    const s = Math.sin(rot);
    const c = Math.cos(rot);
    // world position of a local point (t along the gap, o outward from the ring's inner edge)
    const at = (t: number, o: number) => {
      const ring = (g.axis === "x" ? g.z : g.x) - out * 1; // the ring cell's inner edge (280)
      return g.axis === "x" ? { x: g.x + t, z: ring + out * o } : { x: ring + out * o, z: g.z + t };
    };
    const stampLocal = (build: (G2: Geo, E2: Geo) => void, t: number, o: number, yaw = 0) => {
      const G2 = new Geo();
      const E2 = new Geo();
      G2.mat(WL.TIMBER, 0.5, 0);
      build(G2, E2);
      const p = at(t, o);
      if (G2.n) G.stamp(G2.freeze(), p.x, 0, p.z, rot + yaw);
      if (E2.n) E.stamp(E2.freeze(), p.x, 0, p.z, rot + yaw);
    };
    const mid = at(0, 0);
    const kind = groundAt(
      mid.x + (g.axis === "z" ? -out * 3 : 0),
      mid.z + (g.axis === "x" ? -out * 3 : 0),
    );
    const rocky = kind === WK.RIVER || g.w < 16;
    const w = g.w;
    let t = -w / 2 - 0.6;
    if (rocky) {
      // a rockslide: a heap of boulders, the big ones behind, smaller ones spilling forward
      while (t < w / 2 + 0.6) {
        const sc = 1.3 + r() * 1.3;
        const p = at(t + sc * 0.6, 1.6 + r() * 1.2);
        if (boulder)
          G.stamp(
            boulder.d,
            p.x,
            -0.1,
            p.z,
            r() * 6.28,
            sc * 1.25,
            sc * (1.25 + r() * 0.5),
            sc * 1.25,
            tint,
          );
        t += sc * 0.9;
      }
      for (let k = 0; k < w / 2.5; k++) {
        const p = at(-w / 2 + r() * w, 0.9 + r() * 0.6);
        if (boulder)
          G.stamp(
            boulder.d,
            p.x,
            -0.15,
            p.z,
            r() * 6.28,
            0.6 + r() * 0.5,
            0.6 + r() * 0.5,
            0.6 + r() * 0.5,
            tint,
          );
      }
      // a sign for the riverbed crossing
      if (kind === WK.RIVER)
        stampLocal((G2) => roadSign(G2, W["BRIDGE OUT"]), 0, 0.2, (r() - 0.5) * 0.3);
      else stampLocal((G2) => roadSign(G2, W["KEEP OUT"]), r() < 0.5 ? -w / 4 : w / 4, 0.2);
    } else {
      // a road: wagons tipped across it, barrels and crates stacked in the gaps
      let n = 0;
      while (t < w / 2 + 0.4) {
        const pick = n % 3 === 0 ? "wagon" : r() < 0.5 ? "barrels" : "crates";
        if (pick === "wagon") {
          stampLocal((G2) => overturnedWagon(G2, r), t + 2.3, 1.1, (r() - 0.5) * 0.25);
          t += 4.4;
        } else {
          // a stack two or three high
          const tt = t + 1.1;
          const p = at(tt, 1.0 + r() * 0.3);
          const tmpl = pick === "barrels" ? barrels : crates;
          if (tmpl) G.stamp(tmpl.d, p.x, 0, p.z, rot + r(), 1.15, 1.15, 1.15, tint);
          const top = pick === "barrels" ? barrel : crate;
          if (top) {
            const q = at(tt + (r() - 0.5) * 0.3, 1.1);
            G.stamp(
              top.d,
              q.x,
              pick === "barrels" ? 1.75 : 1.5,
              q.z,
              r() * 6.28,
              1.1,
              1.1,
              1.1,
              tint,
            );
          }
          t += 2.1;
        }
        n++;
      }
      // in front: the sheriff's barricade with its wanted poster, and the big sign
      stampLocal((G2, E2) => sawhorse(G2, E2, 2.6), -Math.min(w / 4, 5), 0.35);
      stampLocal((G2) => roadSign(G2, W["ROAD CLOSED"]), Math.min(w / 4, 5), 0.25);
      const lp = at(-Math.min(w / 4, 5) + 1.1, 0.35);
      P.col("#ffb060").mat(0, 0, 0);
      P.flat(lp.x - 2.5, lp.z - 2.5, lp.x + 2.5, lp.z + 2.5, 0.07);
    }
    void s;
    void c;
    void cylP;
  }
  return {
    main: G.n ? G.build() : null,
    glow: E.n ? E.build() : null,
    pools: P.n ? P.build("uv") : null,
  };
}

export function WesternBlockades({
  layout,
  gaps,
  time,
}: {
  layout: WesternLayout;
  gaps: Gap[];
  time: TimeOfDay;
}) {
  const built = useMemo(() => buildBlockades(layout, gaps), [layout, gaps]);
  const nightK = useMemo(() => ({ value: 0 }), []);
  const mats = useMemo(
    () => ({
      main: facadeMaterial(nightK),
      glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
      pools: new THREE.MeshBasicMaterial({
        vertexColors: true,
        map: softGlow(),
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    }),
    [nightK],
  );
  useEffect(() => {
    mats.glow.color.setScalar(WESTERN_LOOK[time].flames);
  }, [mats, time]);
  useEffect(
    () => () => {
      [built.main, built.glow, built.pools].forEach((g) => g?.dispose());
    },
    [built],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  useFrame(() => syncEnv(mats.main));
  return (
    <group>
      {built.main && <mesh geometry={built.main} material={mats.main} castShadow receiveShadow />}
      {built.glow && <mesh geometry={built.glow} material={mats.glow} />}
      {built.pools && time === "night" && (
        <mesh geometry={built.pools} material={mats.pools} renderOrder={2} />
      )}
    </group>
  );
}
