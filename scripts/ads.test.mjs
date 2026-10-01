import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { rolldown } from "rolldown";
import * as THREE from "three";

// The ADS + accuracy overhaul's checks. The real modules are bundled with the
// project's bundler so these assertions run against the shipped tables and helpers —
// the same viewModelPos the game poses the viewmodel with, the same ACC cones.
async function bundled(path) {
  const b = await rolldown({
    input: fileURLToPath(new URL(path, import.meta.url)),
  });
  const { output } = await b.generate({ format: "esm", codeSplitting: false });
  return import(`data:text/javascript;base64,${Buffer.from(output[0].code).toString("base64")}`);
}
const sights = await bundled("../src/game/art/sights.ts");
const guns = await bundled("../src/game/art/guns.ts");
const acc = await bundled("../src/game/accuracy.ts");

const GUN_IDS = [
  "pistol",
  "scatter",
  "smg",
  "rail",
  "cannon",
  "rebound",
  "harpoon",
  "cryo",
  "flak",
  "tesla",
  "revolver",
  "minigun",
  "crossbow",
  "plasma",
  "voidorb",
  "shatter",
  "sniper",
];
// what Game.tsx feeds aimDir for multi-pellet guns (count, fan width)
const FAN = {
  scatter: { count: 5, spread: 0.07 },
  plasma: { count: 3, spread: 0.05 },
};

const W = 1512;
const H = 982;

test("every gun's sight mark lands within 1px of screen centre when aimed", () => {
  const cam = new THREE.PerspectiveCamera(75, W / H, 0.05, 10);
  cam.updateProjectionMatrix(); // identity: camera space is world space
  const org = new THREE.Vector3();
  const mark = new THREE.Vector3();
  const rows = [];
  for (const w of GUN_IDS) {
    const s = sights.sightOf(w);
    sights.viewModelPos(s, 1, org);
    const m = sights.sightMark(w);
    mark.set(m[0], m[1], m[2]).multiplyScalar(sights.VM_SCALE).add(org).project(cam);
    const px = (mark.x * 0.5 + 0.5) * W;
    const py = (0.5 - mark.y * 0.5) * H;
    const err = Math.hypot(px - W / 2, py - H / 2);
    rows.push(`${w.padEnd(9)} err ${err.toFixed(3)}px`);
    assert.ok(err <= 1, `${w}: sight mark ${err.toFixed(2)}px off centre (${rows.at(-1)})`);
  }
});

/**
 * Software raster of the built gun in its aimed pose: how much of the central box
 * (middle 30% of width and height at 1512x982) the weapon actually covers.
 */
function centreCoverage(w, blend = 1) {
  const g = guns.gunBuild(w, "", "#8a8f96", "#4a4d52");
  const s = sights.sightOf(w);
  const cam = new THREE.PerspectiveCamera(75, W / H, 0.05, 10);
  cam.updateProjectionMatrix();
  const org = sights.viewModelPos(s, blend, new THREE.Vector3());
  // cell grid over the central box
  const GX = 90;
  const GY = 60;
  const bx0 = W * 0.35,
    bx1 = W * 0.65,
    by0 = H * 0.35,
    by1 = H * 0.65;
  const cellW = (bx1 - bx0) / GX,
    cellH = (by1 - by0) / GY;
  const covered = new Uint8Array(GX * GY);
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  const cross = (p0, p1, px, py) => (p1.x - p0.x) * (py - p0.y) - (p1.y - p0.y) * (px - p0.x);
  const raster = (geo) => {
    const pos = geo.getAttribute("position");
    const idx = geo.index;
    const n = idx ? idx.count : pos.count;
    const toPx = (out, vi) => {
      out.fromBufferAttribute(pos, vi).multiplyScalar(sights.VM_SCALE).add(org).project(cam);
      out.set((out.x * 0.5 + 0.5) * W, (0.5 - out.y * 0.5) * H, out.z);
    };
    for (let i = 0; i + 2 < n; i += 3) {
      toPx(a, idx ? idx.getX(i) : i);
      toPx(b, idx ? idx.getX(i + 1) : i + 1);
      toPx(c, idx ? idx.getX(i + 2) : i + 2);
      if (a.z > 1 && b.z > 1 && c.z > 1) continue; // fully behind the camera
      const x0 = Math.max(bx0, Math.min(a.x, b.x, c.x));
      const x1 = Math.min(bx1, Math.max(a.x, b.x, c.x));
      const y0 = Math.max(by0, Math.min(a.y, b.y, c.y));
      const y1 = Math.min(by1, Math.max(a.y, b.y, c.y));
      if (x0 >= x1 || y0 >= y1) continue;
      for (let cy = Math.floor((y0 - by0) / cellH); cy <= (y1 - by0) / cellH && cy < GY; cy++)
        for (let cx = Math.floor((x0 - bx0) / cellW); cx <= (x1 - bx0) / cellW && cx < GX; cx++) {
          if (cy < 0 || cx < 0 || covered[cy * GX + cx]) continue;
          const px = bx0 + (cx + 0.5) * cellW,
            py = by0 + (cy + 0.5) * cellH;
          const s0 = cross(a, b, px, py),
            s1 = cross(b, c, px, py),
            s2 = cross(c, a, px, py);
          const inside = (s0 >= 0 && s1 >= 0 && s2 >= 0) || (s0 <= 0 && s1 <= 0 && s2 <= 0);
          if (inside) covered[cy * GX + cx] = 1;
        }
    }
  };
  raster(g.body);
  for (const p of g.parts) raster(p.geo);
  return covered.reduce((n, v) => n + v, 0) / (GX * GY);
}

test("aimed guns leave the reticle's centre box at most 25% covered", () => {
  const out = [];
  for (const w of GUN_IDS) {
    const cov = centreCoverage(w, 1);
    const hip = centreCoverage(w, 0);
    out.push(`${w.padEnd(9)} hip ${(hip * 100).toFixed(1)}%  ads ${(cov * 100).toFixed(1)}%`);
    assert.ok(
      cov <= 0.25,
      `${w}: aimed gun covers ${(cov * 100).toFixed(1)}% of the centre box (max 25%)`,
    );
  }
  console.log("centre coverage:\n" + out.join("\n"));
});

test("ADS is tighter than hipfire for every gun", () => {
  // the same pellet rule Game.tsx / projectiles.ts use, kept tiny here for the
  // grouping check: yaw = off*spread about UP, pitch += jitter*spread*0.6
  const rng = (seed) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const aimDir = (count, spread, s, r) => {
    const off = count > 1 ? s - (count - 1) / 2 : (r() - 0.5) * 2;
    const x = Math.sin(off * spread),
      z = -Math.cos(off * spread),
      y = (r() - 0.5) * spread * 0.6;
    const l = Math.hypot(x, y, z);
    return { x: x / l, y: y / l, z: z / l };
  };
  const DIST = 20;
  const group = (w, { blend, move }) => {
    const g = FAN[w] ?? { count: 1, spread: 0 };
    acc.accReset();
    acc.accState.move = move;
    acc.aimState.blend = blend;
    const pts = [];
    for (let i = 0; i < 100; i++) {
      const r = rng(i * 7919 + 1);
      const d = aimDir(g.count, acc.effSpread(w, g), i % g.count, r);
      pts.push([(d.x / -d.z) * DIST, (d.y / -d.z) * DIST]);
    }
    const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const rms = Math.sqrt(
      pts.reduce((s, p) => s + (p[0] - mx) ** 2 + (p[1] - my) ** 2, 0) / pts.length,
    );
    const max = Math.max(...pts.map((p) => Math.hypot(p[0] - mx, p[1] - my)));
    return { rms, max };
  };
  const rows = [];
  for (const w of GUN_IDS) {
    const hipS = group(w, { blend: 0, move: 0 });
    const hipW = group(w, { blend: 0, move: 0.6 });
    const adsS = group(w, { blend: 1, move: 0 });
    const adsW = group(w, { blend: 1, move: 0.6 });
    rows.push(
      `${w.padEnd(9)} hip ${hipS.rms.toFixed(3)}m stand / ${hipW.rms.toFixed(3)}m walk | ` +
        `ads ${adsS.rms.toFixed(3)}m stand / ${adsW.rms.toFixed(3)}m walk`,
    );
    assert.ok(adsS.rms < hipS.rms, `${w}: aimed ${adsS.rms} not tighter than hip ${hipS.rms}`);
    assert.ok(adsW.rms < hipW.rms, `${w}: aimed walk ${adsW.rms} not tighter than hip ${hipW.rms}`);
  }
  console.log("group radius (RMS, 100 shots @20m):\n" + rows.join("\n"));
});

test("sustained fire blooms and recovers; the first aimed shot from rest is exact", () => {
  acc.accReset();
  acc.aimState.blend = 1;
  acc.accState.move = 0;
  // standstill + fully aimed: every gun's first cone is exactly its `ads` value
  for (const w of GUN_IDS) {
    acc.accState.bloom = 0;
    assert.ok(
      Math.abs(acc.shotCone(w) - acc.ACC[w].ads) < 1e-9,
      `${w} first aimed shot not exact: ${acc.shotCone(w)} vs ${acc.ACC[w].ads}`,
    );
    // a burst grows the cone, then decay brings it back
    for (let i = 0; i < 12; i++) acc.accShot(w);
    const peak = acc.shotCone(w);
    assert.ok(peak > acc.ACC[w].ads, `${w}: bloom did not open the cone`);
    assert.ok(peak <= acc.ACC[w].ads + acc.ACC[w].bloomMax * 0.55 + 1e-9, `${w}: bloom cap`);
    acc.accState.bloom = 0;
  }
});

test("optic side supports meet their hood instead of leaving a floating top bar", () => {
  for (const w of GUN_IDS) {
    const s = sights.sightOf(w);
    if (s.built || !["reflex", "holo"].includes(s.type)) continue;
    const boxes = [];
    sights.drawSight(
      { box: (width, height, depth, at) => boxes.push({ width, height, depth, at }) },
      w,
      "#ffffff",
    );
    const hood = boxes.find((b) => b.width === (s.type === "reflex" ? 0.035 : 0.042));
    const sides = boxes.filter((b) => Math.abs(b.at[0]) === (s.type === "reflex" ? 0.015 : 0.018));
    assert.equal(sides.length, 2, `${w} has both supports`);
    for (const side of sides)
      assert.ok(
        side.at[1] + side.height / 2 > hood.at[1] - hood.height / 2,
        `${w} hood touches its side`,
      );
  }
});
