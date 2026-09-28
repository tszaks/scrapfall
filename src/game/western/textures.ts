// Procedural textures for Dry Gulch. Built once, lazily, in the browser.
//
// Every surface in town - painted clapboard, weathered board-and-batten, adobe, brick, the
// jail's stone, tin and shingle roofs, the boardwalk, the red-rock strata, the painted signs,
// wagon canvas, cactus skin and the ground - lives in ONE texture array (one layer per
// material), so whole chunks of the town draw with a single material.
//
// Facade layers are a tile of 4 window modules across and 4 storeys up (row 0 = the ground
// floor storefront); the geometry's UVs count modules and storeys, so doors and windows land
// on real floors. Plain layers tile in metres (see TILE_M).
//   day   RGB = albedo (paintable walls near white; vertex colours tint them), A = glass
//   night RGB = lamp-lit window colour,                                  A = window mask
import * as THREE from "three";

import type { TimeOfDay } from "../lighting";

export const TEX = 512;
export const FAC_COLS = 4;
export const FAC_ROWS = 4;

/** layers in the texture array */
export const WL = {
  F_CLAP: 0,
  F_BOARD: 1,
  F_ADOBE: 2,
  F_BRICK: 3,
  F_STONE: 4,
  F_CHURCH: 5,
  F_BARN: 6,
  F_LOG: 7,
  P_CLAP: 8,
  P_BOARD: 9,
  P_ADOBE: 10,
  P_BRICK: 11,
  P_STONE: 12,
  P_LOG: 13,
  TIN: 14,
  SHINGLE: 15,
  DECK: 16,
  ROCK: 17,
  TIMBER: 18,
  SIGNS: 19,
  CANVAS: 20,
  CACTUS: 21,
  SAND: 22,
  DIRT: 23,
  MUD: 24,
  YARD: 25,
  BALLAST: 26,
  IRON: 27,
  PAINT: 28,
} as const;
const LAYERS = 29;

/** real-world width of one facade module, metres */
export const MODULE_W: Record<number, number> = {
  [WL.F_CLAP]: 3,
  [WL.F_BOARD]: 3,
  [WL.F_ADOBE]: 3.5,
  [WL.F_BRICK]: 3,
  [WL.F_STONE]: 3.2,
  [WL.F_CHURCH]: 3.5,
  [WL.F_BARN]: 4,
  [WL.F_LOG]: 3.2,
};
/** metres covered by one repeat of a plain layer (u and v) */
export const TILE_M: Record<number, [number, number]> = {
  [WL.P_CLAP]: [4, 4],
  [WL.P_BOARD]: [4, 4],
  [WL.P_ADOBE]: [5, 5],
  [WL.P_BRICK]: [4, 4],
  [WL.P_STONE]: [5, 5],
  [WL.P_LOG]: [4, 4],
  [WL.TIN]: [4, 4],
  [WL.SHINGLE]: [4, 4],
  [WL.DECK]: [4, 4],
  [WL.ROCK]: [30, 15],
  [WL.TIMBER]: [2, 2],
  [WL.CANVAS]: [3, 3],
  [WL.CACTUS]: [1, 2],
  [WL.SAND]: [9, 9],
  [WL.DIRT]: [10, 10],
  [WL.MUD]: [7, 7],
  [WL.YARD]: [8, 8],
  [WL.BALLAST]: [3, 3],
  [WL.IRON]: [2, 2],
  [WL.PAINT]: [2, 2],
};
/** sign atlas: 2 columns x 14 rows of painted boards */
export const SIGN_COLS = 2;
export const SIGN_ROWS = 14;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d", { willReadFrequently: true })!] as const;
}
type Ctx = CanvasRenderingContext2D;
type Painter = { d: Ctx; g: Ctx; n: Ctx; m: Ctx; r: () => number; words: readonly string[] };

const rect = (c: Ctx, s: string | CanvasGradient, x: number, y: number, w: number, h: number) => {
  c.fillStyle = s;
  c.fillRect(x, y, w, h);
};
const rgba = (r: number, g: number, b: number, a: number) =>
  `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a.toFixed(3)})`;

/** fine grain + a few blotches over the whole tile (albedo only) */
function grain(P: Painter, amt: number, blot = 0) {
  const { d, r } = P;
  for (let i = 0; i < 2600 * amt; i++) {
    const v = r() < 0.5 ? 0 : 255;
    rect(d, rgba(v, v, v, 0.04 + r() * 0.06), r() * TEX, r() * TEX, 1 + r() * 2, 1 + r() * 2);
  }
  for (let i = 0; i < blot; i++) {
    const x = r() * TEX;
    const y = r() * TEX;
    const rad = 10 + r() * 50;
    const gr = d.createRadialGradient(x, y, 0, x, y, rad);
    const dark = r() < 0.6;
    gr.addColorStop(0, dark ? "rgba(60,40,20,0.10)" : "rgba(255,245,225,0.10)");
    gr.addColorStop(1, "rgba(0,0,0,0)");
    d.fillStyle = gr;
    d.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
}

/** paint gone: ragged patches where the whitewash has flaked off the bare grey boards,
 * a lighter lip of lifting paint round each, and rust-brown drips below nail heads */
function peel(c: Ctx, x: number, y: number, w: number, h: number, r: () => number, n: number) {
  for (let i = 0; i < n; i++) {
    const cx = x + r() * w;
    const cy = y + r() * h;
    const rw = 6 + r() * 26;
    const rh = 3 + r() * 10;
    c.beginPath();
    const pts = 9;
    for (let k = 0; k <= pts; k++) {
      const a = (k / pts) * Math.PI * 2;
      const f = 0.6 + r() * 0.5;
      const px = cx + Math.cos(a) * rw * f;
      const py = cy + Math.sin(a) * rh * f;
      if (k === 0) c.moveTo(px, py);
      else c.lineTo(px, py);
    }
    c.closePath();
    c.fillStyle = rgba(128 + r() * 20, 116 + r() * 16, 100 + r() * 12, 0.85);
    c.fill();
    c.strokeStyle = rgba(255, 250, 240, 0.35);
    c.lineWidth = 1;
    c.stroke();
    // bare wood grain inside
    for (let g = 0; g < 3; g++)
      rect(c, rgba(90, 78, 64, 0.35), cx - rw * 0.8, cy - rh * 0.5 + r() * rh, rw * 1.6, 1);
  }
  // rust drips from nail heads
  for (let i = 0; i < n * 1.5; i++) {
    const nx = x + r() * w;
    const ny = y + r() * h;
    rect(c, rgba(120, 70, 40, 0.18 + r() * 0.2), nx, ny, 1.2, 4 + r() * 18);
  }
}

/** horizontal lap siding: `exp` px per board, shadow under each lap */
function clapboard(
  c: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  exp: number,
  r: () => number,
) {
  for (let yy = y; yy < y + h; yy += exp) {
    const g = c.createLinearGradient(0, yy, 0, yy + exp);
    const k = 0.9 + r() * 0.1;
    g.addColorStop(0, rgba(255 * k, 252 * k, 246 * k, 1));
    g.addColorStop(0.8, rgba(236 * k, 232 * k, 224 * k, 1));
    g.addColorStop(1, rgba(170, 164, 152, 1));
    rect(c, g, x, yy, w, exp);
  }
  // weathering streaks and paint wear
  for (let i = 0; i < (w * h) / 900; i++) {
    const sx = x + r() * w;
    rect(c, rgba(120, 100, 80, 0.05 + r() * 0.08), sx, y + r() * h, 1 + r() * 2, 6 + r() * 40);
  }
  peel(c, x, y, w, h, r, Math.round((w * h) / 9000));
  for (let i = 0; i < (w * h) / 5000; i++)
    rect(
      c,
      rgba(140, 125, 105, 0.35 + r() * 0.3),
      x + r() * w,
      y + r() * h,
      4 + r() * 16,
      2 + r() * 4,
    );
}

/** vertical board-and-batten, weathered wood colour baked in */
function boards(
  c: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  bw: number,
  r: () => number,
  base: [number, number, number],
) {
  for (let xx = x; xx < x + w; xx += bw) {
    const k = 0.78 + r() * 0.32;
    rect(c, rgba(base[0] * k, base[1] * k, base[2] * k, 1), xx, y, bw, h);
    // grain
    for (let g = 0; g < 5; g++)
      rect(
        c,
        rgba(base[0] * k * 0.7, base[1] * k * 0.7, base[2] * k * 0.7, 0.35),
        xx + r() * bw,
        y,
        1,
        h,
      );
    // knots
    if (r() < 0.5) {
      c.fillStyle = rgba(base[0] * 0.45, base[1] * 0.4, base[2] * 0.35, 0.8);
      c.beginPath();
      c.ellipse(xx + bw * (0.3 + r() * 0.4), y + r() * h, 1.5, 2.5, 0, 0, Math.PI * 2);
      c.fill();
    }
    // batten
    rect(c, rgba(base[0] * 1.08, base[1] * 1.05, base[2] * 1.02, 1), xx - 1.5, y, 3, h);
    rect(c, "rgba(0,0,0,0.35)", xx + 1.5, y, 1.5, h);
  }
  // sun-bleached tops, dark rot at the bottom
  const g = c.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, "rgba(255,250,235,0.08)");
  g.addColorStop(1, "rgba(40,25,10,0.12)");
  rect(c, g, x, y, w, h);
}

function bricks(c: Ctx, x: number, y: number, w: number, h: number, r: () => number) {
  rect(c, "#b9ab98", x, y, w, h); // mortar
  const bh = 5;
  const bw = 13;
  for (let yy = y, row = 0; yy < y + h; yy += bh, row++) {
    for (let xx = x - (row % 2) * (bw / 2); xx < x + w; xx += bw) {
      const k = 0.8 + r() * 0.35;
      rect(c, rgba(150 * k, 68 * k, 46 * k, 1), xx + 0.5, yy + 0.5, bw - 1, bh - 1);
    }
  }
  grainRect(c, x, y, w, h, r, 0.1);
}
function stones(c: Ctx, x: number, y: number, w: number, h: number, r: () => number, sh = 16) {
  rect(c, "#6d655a", x, y, w, h);
  for (let yy = y, row = 0; yy < y + h; yy += sh, row++) {
    let xx = x - r() * 20;
    while (xx < x + w) {
      const sw = 22 + r() * 26;
      const k = 0.82 + r() * 0.3;
      const g = c.createLinearGradient(0, yy, 0, yy + sh);
      g.addColorStop(0, rgba(196 * k, 182 * k, 156 * k, 1));
      g.addColorStop(1, rgba(150 * k, 138 * k, 118 * k, 1));
      rect(c, g, xx + 1, yy + 1, sw - 2, sh - 2);
      xx += sw;
    }
  }
  grainRect(c, x, y, w, h, r, 0.12);
}
function adobeWall(c: Ctx, x: number, y: number, w: number, h: number, r: () => number) {
  rect(c, "#d7b48c", x, y, w, h);
  for (let i = 0; i < (w * h) / 60; i++) {
    const k = r();
    rect(
      c,
      rgba(150 + k * 90, 110 + k * 70, 70 + k * 50, 0.08 + r() * 0.1),
      x + r() * w,
      y + r() * h,
      2 + r() * 10,
      2 + r() * 8,
    );
  }
  // exposed mud bricks where the plaster has fallen off
  for (let i = 0; i < (w * h) / 26000; i++) {
    const px = x + r() * (w - 40);
    const py = y + r() * (h - 30);
    const pw = 20 + r() * 30;
    const ph = 12 + r() * 20;
    rect(c, "#9a7050", px, py, pw, ph);
    for (let yy = py; yy < py + ph; yy += 6)
      for (let xx = px + ((yy / 6) % 2) * 6; xx < px + pw; xx += 12)
        rect(c, "#b0805a", xx, yy, 11, 5);
  }
  // rain streaks from the roof beams
  for (let i = 0; i < w / 30; i++)
    rect(c, "rgba(90,60,35,0.12)", x + r() * w, y, 2 + r() * 3, 20 + r() * 60);
}
function logs(c: Ctx, x: number, y: number, w: number, h: number, r: () => number) {
  const lh = 10;
  for (let yy = y; yy < y + h; yy += lh) {
    const k = 0.8 + r() * 0.25;
    const g = c.createLinearGradient(0, yy, 0, yy + lh);
    g.addColorStop(0, rgba(150 * k, 110 * k, 72 * k, 1));
    g.addColorStop(0.5, rgba(122 * k, 86 * k, 54 * k, 1));
    g.addColorStop(1, rgba(70 * k, 48 * k, 30 * k, 1));
    rect(c, g, x, yy, w, lh - 1.5);
    rect(c, "#cbb89a", x, yy + lh - 1.5, w, 1.5); // chinking
    for (let g2 = 0; g2 < 4; g2++) rect(c, "rgba(40,25,10,0.25)", x, yy + 2 + r() * (lh - 4), w, 1);
  }
}
function grainRect(c: Ctx, x: number, y: number, w: number, h: number, r: () => number, a: number) {
  for (let i = 0; i < (w * h) / 40; i++) {
    const v = r() < 0.5 ? 0 : 255;
    rect(c, rgba(v, v, v, a * r()), x + r() * w, y + r() * h, 1 + r(), 1 + r());
  }
}

// ---- windows and doors (module space: a module is 128 px wide, a storey 128 px tall) ----
const MW = TEX / FAC_COLS;
const SH = TEX / FAC_ROWS;
const LIT = ["#ffb45a", "#ffc878", "#ffd9a0", "#ffa446", "#ffcf8a"];

function glassPane(
  P: Painter,
  x: number,
  y: number,
  w: number,
  h: number,
  bars: [number, number],
  lit: number,
) {
  const { d, g, n, m, r } = P;
  const gr = d.createLinearGradient(x, y, x + w * 0.4, y + h);
  gr.addColorStop(0, "#5d6a70");
  gr.addColorStop(0.5, "#27302f");
  gr.addColorStop(1, "#3e4644");
  rect(d, gr, x, y, w, h);
  // curtains
  const cur = r();
  if (cur < 0.55) {
    const cc = ["#8a2a22", "#d8cfb8", "#5a6a3a", "#a88a58"][Math.floor(r() * 4)]!;
    rect(d, cc, x, y, w * (0.18 + r() * 0.1), h);
    rect(d, cc, x + w * (0.78 - r() * 0.1), y, w * 0.3, h);
  }
  rect(g, "#fff", x, y, w, h);
  rect(m, "#fff", x, y, w, h);
  if (r() < lit) {
    const col = LIT[Math.floor(r() * LIT.length)]!;
    const lg = n.createRadialGradient(
      x + w / 2,
      y + h * 0.6,
      2,
      x + w / 2,
      y + h * 0.6,
      Math.max(w, h),
    );
    lg.addColorStop(0, col);
    lg.addColorStop(1, "#6a3010");
    rect(n, lg, x, y, w, h);
    if (cur < 0.55) {
      n.globalAlpha = 0.55;
      rect(n, "#3a1a08", x, y, w * 0.22, h);
      rect(n, "#3a1a08", x + w * 0.74, y, w * 0.26, h);
      n.globalAlpha = 1;
    }
    // somebody at the window, now and then
    if (r() < 0.12) {
      n.fillStyle = "#2a1206";
      n.beginPath();
      n.ellipse(x + w * 0.5, y + h * 0.45, w * 0.12, h * 0.12, 0, 0, Math.PI * 2);
      n.fill();
      rect(n, "#2a1206", x + w * 0.32, y + h * 0.56, w * 0.36, h * 0.5);
    }
  }
  // glazing bars
  const [bx, by] = bars;
  for (let i = 1; i < bx; i++) {
    rect(d, "#e8e2d4", x + (w * i) / bx - 1, y, 2, h);
    rect(g, "#000", x + (w * i) / bx - 1, y, 2, h);
    rect(n, "#000", x + (w * i) / bx - 1, y, 2, h);
  }
  for (let i = 1; i < by; i++) {
    rect(d, "#e8e2d4", x, y + (h * i) / by - 1, w, 2);
    rect(g, "#000", x, y + (h * i) / by - 1, w, 2);
    rect(n, "#000", x, y + (h * i) / by - 1, w, 2);
  }
}
/** painted trim frame round an opening */
function trim(c: Ctx, x: number, y: number, w: number, h: number, t: number, col = "#f4efe4") {
  rect(c, col, x - t, y - t, w + t * 2, t);
  rect(c, col, x - t, y + h, w + t * 2, t * 1.4);
  rect(c, col, x - t, y, t, h);
  rect(c, col, x + w, y, t, h);
  rect(c, "rgba(0,0,0,0.25)", x - t, y + h + t * 1.4, w + t * 2, 2);
}
function sash(
  P: Painter,
  col: number,
  row: number,
  opts: { shutters?: string | undefined; trimCol?: string; lit?: number } = {},
) {
  const x = col * MW + MW * 0.28;
  const w = MW * 0.44;
  const y = (FAC_ROWS - 1 - row) * SH + SH * 0.18;
  const h = SH * 0.58;
  trim(P.d, x, y, w, h, 4, opts.trimCol);
  glassPane(P, x, y, w, h, [2, 2], opts.lit ?? 0.55);
  if (opts.shutters) {
    for (const sx of [x - 4 - w * 0.42, x + w + 4]) {
      rect(P.d, opts.shutters, sx, y - 2, w * 0.42, h + 4);
      for (let yy = y + 3; yy < y + h; yy += 5)
        rect(P.d, "rgba(0,0,0,0.28)", sx + 2, yy, w * 0.42 - 4, 1.5);
    }
  }
  // sill
  rect(P.d, "rgba(0,0,0,0.35)", x - 6, y + h + 5, w + 12, 3);
}
function door(
  P: Painter,
  col: number,
  row: number,
  wFrac: number,
  kind: "panel" | "glass" | "saloon" | "plank" | "double",
  paint = "#6a3a22",
) {
  const { d, g, m, n, r } = P;
  const w = MW * wFrac;
  const x = col * MW + (MW - w) / 2;
  const top = (FAC_ROWS - 1 - row) * SH;
  const y = top + SH * 0.16;
  const h = SH - (y - top);
  // dark doorway recess
  rect(d, "#1c140e", x, y, w, h);
  rect(m, "#fff", x, y, w, h);
  rect(n, "#7a3a12", x, y, w, h);
  if (r() < 0.5) {
    const lg = n.createLinearGradient(0, y, 0, y + h);
    lg.addColorStop(0, "#ffb050");
    lg.addColorStop(1, "#a04a14");
    rect(n, lg, x, y, w, h);
  }
  trim(d, x, y, w, h, 5, "#efe8da");
  if (kind === "saloon") {
    // batwing doors hanging in the doorway
    const dy = y + h * 0.28;
    const dh = h * 0.42;
    for (const [sx, sw] of [
      [x + 2, w / 2 - 3],
      [x + w / 2 + 1, w / 2 - 3],
    ] as const) {
      rect(d, paint, sx, dy, sw, dh);
      rect(n, "#000", sx, dy, sw, dh);
      for (let yy = dy + 4; yy < dy + dh - 4; yy += 6)
        rect(d, "rgba(0,0,0,0.35)", sx + 3, yy, sw - 6, 2);
      d.fillStyle = paint;
      d.beginPath();
      d.moveTo(sx, dy);
      d.quadraticCurveTo(sx + sw / 2, dy - 10, sx + sw, dy);
      d.fill();
    }
    return;
  }
  if (kind === "double") {
    for (const sx of [x, x + w / 2]) {
      rect(d, paint, sx + 2, y + 2, w / 2 - 4, h - 2);
      rect(n, "#000", sx + 2, y + 2, w / 2 - 4, h - 2);
      rect(m, "#000", sx + 2, y + 2, w / 2 - 4, h - 2);
      glassPane(P, sx + 6, y + 8, w / 2 - 12, h * 0.42, [1, 2], 0.5);
      rect(d, "rgba(0,0,0,0.3)", sx + 6, y + h * 0.62, w / 2 - 12, h * 0.25);
    }
    rect(g, "#000", x, y + h * 0.55, w, h * 0.45);
    return;
  }
  rect(d, paint, x + 2, y + 2, w - 4, h - 2);
  rect(n, "#000", x + 2, y + 2, w - 4, h - 2);
  rect(m, "#000", x + 2, y + 2, w - 4, h - 2);
  if (kind === "glass") {
    glassPane(P, x + 7, y + 7, w - 14, h * 0.45, [1, 2], 0.6);
    rect(d, "rgba(0,0,0,0.3)", x + 8, y + h * 0.6, w - 16, h * 0.3);
  } else if (kind === "plank") {
    for (let xx = x + 2; xx < x + w - 2; xx += 7) rect(d, "rgba(0,0,0,0.3)", xx, y + 2, 1.5, h - 2);
    rect(d, "rgba(0,0,0,0.35)", x + 2, y + h * 0.25, w - 4, 3);
    rect(d, "rgba(0,0,0,0.35)", x + 2, y + h * 0.7, w - 4, 3);
  } else {
    rect(d, "rgba(0,0,0,0.25)", x + 7, y + 8, w - 14, h * 0.38);
    rect(d, "rgba(0,0,0,0.25)", x + 7, y + h * 0.55, w - 14, h * 0.38);
  }
  // brass knob
  rect(d, "#c8a040", x + w - 12, y + h * 0.55, 4, 4);
}
function display(P: Painter, col: number, row: number, trimCol = "#efe8da") {
  const x = col * MW + 10;
  const w = MW - 20;
  const top = (FAC_ROWS - 1 - row) * SH;
  const y = top + SH * 0.2;
  const h = SH * 0.55;
  trim(P.d, x, y, w, h, 5, trimCol);
  glassPane(P, x, y, w, h, [3, 2], 0.65);
  // bulkhead panel below the window
  rect(P.d, "rgba(0,0,0,0.18)", x, y + h + 8, w, SH - (y - top) - h - 12);
  rect(P.d, "rgba(255,255,255,0.3)", x + 4, y + h + 12, w - 8, 2);
  // goods in the window: bolts of cloth, bottles, hats (albedo only)
  for (let i = 0; i < 6; i++)
    rect(
      P.d,
      ["#8a5a2a", "#c0a060", "#5a3a2a", "#9a3a2a", "#4a6a8a"][Math.floor(P.r() * 5)]!,
      x + 6 + P.r() * (w - 20),
      y + h - 10 - P.r() * 16,
      6 + P.r() * 10,
      8 + P.r() * 14,
    );
}

// ---- per-layer painters ----
const PAINT: Record<number, (P: Painter) => void> = {
  [WL.F_CLAP]: (P) => {
    clapboard(P.d, 0, 0, TEX, TEX, 6, P.r);
    const shut = ["#3a5a3a", "#5a2a22", "#2a3a4a", "#4a3a2a"];
    for (let col = 0; col < FAC_COLS; col++) {
      for (let row = 1; row < FAC_ROWS; row++)
        sash(P, col, row, { shutters: P.r() < 0.5 ? shut[col % 4]! : undefined, lit: 0.5 });
      if (col === 0) door(P, col, 0, 0.55, "double", "#5a2e1c");
      else if (col === 3) door(P, col, 0, 0.42, "glass", "#3a4a3a");
      else display(P, col, 0);
    }
    grain(P, 0.6, 12);
  },
  [WL.F_BOARD]: (P) => {
    boards(P.d, 0, 0, TEX, TEX, 11, P.r, [150, 128, 104]);
    for (let col = 0; col < FAC_COLS; col++) {
      for (let row = 1; row < FAC_ROWS; row++) sash(P, col, row, { trimCol: "#b8a88c", lit: 0.45 });
      if (col === 1) door(P, col, 0, 0.45, "plank", "#5a4230");
      else if (col === 3) door(P, col, 0, 0.42, "glass", "#6a4a30");
      else display(P, col, 0, "#b8a88c");
    }
    grain(P, 0.6, 16);
  },
  [WL.F_ADOBE]: (P) => {
    adobeWall(P.d, 0, 0, TEX, TEX, P.r);
    for (let col = 0; col < FAC_COLS; col++)
      for (let row = 0; row < FAC_ROWS; row++) {
        if (row === 0 && col % 2 === 0) {
          door(P, col, 0, 0.36, "plank", "#6a4428");
          continue;
        }
        const x = col * MW + MW * 0.34;
        const w = MW * 0.32;
        const y = (FAC_ROWS - 1 - row) * SH + SH * 0.25;
        const h = SH * 0.36;
        rect(P.d, "#4a3020", x - 6, y - 8, w + 12, 7); // wooden lintel
        rect(P.d, "#3a2616", x - 3, y - 3, w + 6, h + 6); // deep reveal
        glassPane(P, x, y, w, h, [2, 2], 0.6);
      }
    grain(P, 0.8, 30);
  },
  [WL.F_BRICK]: (P) => {
    bricks(P.d, 0, 0, TEX, TEX, P.r);
    for (let col = 0; col < FAC_COLS; col++) {
      for (let row = 0; row < FAC_ROWS; row++) {
        const x = col * MW + MW * 0.27;
        const w = MW * 0.46;
        const y = (FAC_ROWS - 1 - row) * SH + SH * (row === 0 ? 0.14 : 0.2);
        const h = SH * (row === 0 ? 0.86 : 0.6);
        if (row === 0 && col === 1) {
          door(P, col, 0, 0.6, "double", "#3a2418");
          continue;
        }
        // arched window, stone keystone and sill
        P.d.fillStyle = "#d8ccb4";
        P.d.beginPath();
        P.d.arc(x + w / 2, y + w / 2, w / 2 + 6, Math.PI, 0);
        P.d.fill();
        rect(P.d, "#d8ccb4", x - 6, y + w / 2, w + 12, h - w / 2 + 6);
        rect(P.d, "#efe6d2", x + w / 2 - 5, y - 6, 10, 12);
        glassPane(P, x, y + w / 2, w, h - w / 2, [2, 3], 0.55);
        P.d.fillStyle = "#2a3232";
        P.d.beginPath();
        P.d.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0);
        P.d.fill();
        P.g.fillStyle = "#fff";
        P.g.beginPath();
        P.g.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0);
        P.g.fill();
      }
    }
    // stone string course between storeys
    for (let row = 1; row < FAC_ROWS; row++) rect(P.d, "#d8ccb4", 0, row * SH - 5, TEX, 6);
    grain(P, 0.4, 8);
  },
  [WL.F_STONE]: (P) => {
    stones(P.d, 0, 0, TEX, TEX, P.r);
    for (let col = 0; col < FAC_COLS; col++)
      for (let row = 0; row < FAC_ROWS; row++) {
        if (row === 0 && col === 0) {
          door(P, col, 0, 0.5, "plank", "#3a2a1c");
          continue;
        }
        const x = col * MW + MW * 0.32;
        const w = MW * 0.36;
        const y = (FAC_ROWS - 1 - row) * SH + SH * 0.24;
        const h = SH * 0.42;
        rect(P.d, "#4a4238", x - 6, y - 6, w + 12, h + 12);
        glassPane(P, x, y, w, h, [1, 1], 0.4);
        for (let i = 1; i < 5; i++) rect(P.d, "#1a1a1a", x + (w * i) / 5 - 1.5, y, 3, h); // jail bars
        rect(P.d, "#1a1a1a", x, y + h / 2 - 1, w, 2);
      }
    grain(P, 0.5, 14);
  },
  [WL.F_CHURCH]: (P) => {
    clapboard(P.d, 0, 0, TEX, TEX, 6, P.r);
    for (let col = 0; col < FAC_COLS; col++)
      for (let row = 0; row < FAC_ROWS; row += 2) {
        // one tall pointed (gothic) window across two storeys
        const x = col * MW + MW * 0.33;
        const w = MW * 0.34;
        const y = (FAC_ROWS - 2 - row) * SH + SH * 0.3;
        const h = SH * 1.45;
        const d = P.d;
        d.fillStyle = "#f4efe4";
        d.beginPath();
        d.moveTo(x - 6, y + h + 6);
        d.lineTo(x - 6, y + w * 0.5);
        d.quadraticCurveTo(x + w / 2, y - w * 0.55, x + w + 6, y + w * 0.5);
        d.lineTo(x + w + 6, y + h + 6);
        d.fill();
        for (const c of [d, P.g, P.m]) {
          c.fillStyle = c === d ? "#2a3848" : "#fff";
          c.beginPath();
          c.moveTo(x, y + h);
          c.lineTo(x, y + w * 0.5);
          c.quadraticCurveTo(x + w / 2, y - w * 0.4, x + w, y + w * 0.5);
          c.lineTo(x + w, y + h);
          c.fill();
        }
        // stained glass: diamond quarries in muted jewel tones (ruby, sapphire, emerald, amber,
        // amethyst) held in lead, lit softly by candles inside (warmest low in the middle)
        const jewels: [number, number, number][] = [
          [110, 26, 34],
          [30, 50, 100],
          [28, 80, 56],
          [140, 88, 30],
          [70, 38, 88],
          [96, 70, 44],
        ];
        const arch = (c: CanvasRenderingContext2D) => {
          c.beginPath();
          c.moveTo(x, y + h);
          c.lineTo(x, y + w * 0.5);
          c.quadraticCurveTo(x + w / 2, y - w * 0.4, x + w, y + w * 0.5);
          c.lineTo(x + w, y + h);
          c.closePath();
        };
        const dx = w / 4;
        const dy = dx * 1.4;
        const picks: number[] = [];
        for (let k = 0; k < 400; k++) picks.push(Math.floor(P.r() * jewels.length));
        for (const [c, lum] of [
          [P.n, 0.62],
          [d, 0.6],
        ] as const) {
          c.save();
          arch(c);
          c.clip();
          c.fillStyle = "#000";
          c.fillRect(x, y - w, w, h + w);
          let k = 0;
          for (let j = -2; j * (dy / 2) < h + w; j++)
            for (let i = -1; i <= 4; i++) {
              const cx = x + i * dx + (j % 2 === 0 ? 0 : dx / 2);
              const cy = y - w * 0.4 + (j * dy) / 2;
              const [r, g, b] = jewels[picks[k++ % picks.length]!]!;
              // candle glow: brightest low and centred, dimmer toward the arch
              const glow =
                lum *
                (0.55 + 0.45 * Math.min(1, (cy - y) / h)) *
                (1 - (0.35 * Math.abs(cx - (x + w / 2))) / (w / 2));
              c.fillStyle = `rgb(${Math.round(r * glow)},${Math.round(g * glow)},${Math.round(b * glow)})`;
              c.beginPath();
              c.moveTo(cx, cy - dy / 2);
              c.lineTo(cx + dx / 2, cy);
              c.lineTo(cx, cy + dy / 2);
              c.lineTo(cx - dx / 2, cy);
              c.closePath();
              c.fill();
            }
          // the lead: the diamond lattice, a centre mullion and saddle bars
          c.strokeStyle = "#0a0806";
          c.lineWidth = 1.6;
          for (let t = -h * 2; t < w + h * 2; t += dx) {
            c.beginPath();
            c.moveTo(x + t, y - w);
            c.lineTo(x + t + ((h + w) * dx) / dy, y + h);
            c.moveTo(x + t, y - w);
            c.lineTo(x + t - ((h + w) * dx) / dy, y + h);
            c.stroke();
          }
          c.fillStyle = "#0a0806";
          c.fillRect(x + w / 2 - 1.5, y - w, 3, h + w);
          for (let yy = y + h * 0.2; yy < y + h; yy += h * 0.26) c.fillRect(x, yy, w, 2.5);
          c.restore();
        }
      }
    grain(P, 0.4, 6);
  },
  [WL.F_BARN]: (P) => {
    boards(P.d, 0, 0, TEX, TEX, 12, P.r, [150, 52, 36]);
    const d = P.d;
    for (let col = 0; col < FAC_COLS; col++) {
      if (col === 1 || col === 2) {
        // big X-braced barn door, white trim
        const x = col * MW + 8;
        const w = MW - 16;
        const y = (FAC_ROWS - 1) * SH + 14;
        const h = SH - 14;
        rect(d, "#8a2a1c", x, y, w, h);
        d.strokeStyle = "#eee6d6";
        d.lineWidth = 6;
        d.strokeRect(x + 3, y + 3, w - 6, h - 6);
        d.beginPath();
        d.moveTo(x + 3, y + 3);
        d.lineTo(x + w - 3, y + h - 3);
        d.moveTo(x + w - 3, y + 3);
        d.lineTo(x + 3, y + h - 3);
        d.stroke();
        rect(P.m, "#000", x, y, w, h);
      } else {
        sash(P, col, 0, { trimCol: "#eee6d6", lit: 0.3 });
      }
      // hay loft door, up top
      if (col === 1) {
        const x = col * MW + MW * 0.55;
        const y = (FAC_ROWS - 2) * SH + 20;
        rect(d, "#2a1a10", x, y, MW * 0.9, SH * 0.7);
        d.strokeStyle = "#eee6d6";
        d.lineWidth = 5;
        d.strokeRect(x, y, MW * 0.9, SH * 0.7);
      } else if (col !== 2) sash(P, col, 1, { trimCol: "#eee6d6", lit: 0.2 });
      for (let row = 2; row < FAC_ROWS; row++)
        if (col !== 2) sash(P, col, row, { trimCol: "#eee6d6", lit: 0.2 });
    }
    grain(P, 0.6, 20);
  },
  [WL.F_LOG]: (P) => {
    logs(P.d, 0, 0, TEX, TEX, P.r);
    for (let col = 0; col < FAC_COLS; col++)
      for (let row = 0; row < FAC_ROWS; row++) {
        if (row === 0 && col === 2) {
          door(P, col, 0, 0.42, "plank", "#5a3a22");
          continue;
        }
        const x = col * MW + MW * 0.3;
        const w = MW * 0.4;
        const y = (FAC_ROWS - 1 - row) * SH + SH * 0.24;
        const h = SH * 0.42;
        rect(P.d, "#4a3020", x - 5, y - 5, w + 10, h + 10);
        glassPane(P, x, y, w, h, [2, 2], 0.7);
      }
    grain(P, 0.5, 10);
  },
  [WL.P_CLAP]: (P) => {
    clapboard(P.d, 0, 0, TEX, TEX, 7, P.r);
    grain(P, 0.6, 12);
  },
  [WL.P_BOARD]: (P) => {
    boards(P.d, 0, 0, TEX, TEX, 14, P.r, [150, 128, 104]);
    grain(P, 0.6, 16);
  },
  [WL.P_ADOBE]: (P) => {
    adobeWall(P.d, 0, 0, TEX, TEX, P.r);
    grain(P, 0.8, 30);
  },
  [WL.P_BRICK]: (P) => bricks(P.d, 0, 0, TEX, TEX, P.r),
  [WL.P_STONE]: (P) => stones(P.d, 0, 0, TEX, TEX, P.r, 22),
  [WL.P_LOG]: (P) => logs(P.d, 0, 0, TEX, TEX, P.r),
  [WL.TIN]: (P) => {
    const { d, r } = P;
    for (let x = 0; x < TEX; x += 10) {
      const g = d.createLinearGradient(x, 0, x + 10, 0);
      g.addColorStop(0, "#9aa0a0");
      g.addColorStop(0.5, "#cfd2cc");
      g.addColorStop(1, "#7a8080");
      rect(d, g, x, 0, 10, TEX);
    }
    // rust: streaks from the nail rows, blotches, whole rusted sheets
    for (let i = 0; i < 40; i++) {
      const x = Math.floor(r() * 8) * 64;
      const y = Math.floor(r() * 4) * 128;
      if (r() < 0.35) rect(d, rgba(150, 80, 40, 0.35 + r() * 0.4), x, y, 64, 128);
    }
    for (let i = 0; i < 260; i++)
      rect(
        d,
        rgba(140 + r() * 40, 70, 30, 0.2 + r() * 0.3),
        r() * TEX,
        r() * TEX,
        2 + r() * 5,
        6 + r() * 60,
      );
    for (let y = 0; y < TEX; y += 128) rect(d, "rgba(40,30,20,0.5)", 0, y, TEX, 2); // sheet laps
  },
  [WL.SHINGLE]: (P) => {
    const { d, r } = P;
    rect(d, "#3a3028", 0, 0, TEX, TEX);
    for (let y = 0, row = 0; y < TEX; y += 16, row++)
      for (let x = -(row % 2) * 10; x < TEX;) {
        const w = 12 + r() * 16;
        const k = 0.75 + r() * 0.4;
        const g = d.createLinearGradient(0, y, 0, y + 16);
        g.addColorStop(0, rgba(118 * k, 100 * k, 82 * k, 1));
        g.addColorStop(1, rgba(84 * k, 70 * k, 58 * k, 1));
        rect(d, g, x + 1, y, w - 2, 15);
        x += w;
      }
    grain(P, 0.5, 10);
  },
  [WL.DECK]: (P) => {
    boards(P.d, 0, 0, TEX, TEX, 20, P.r, [140, 112, 84]);
    // nail heads, gaps between planks read dark
    for (let x = 0; x < TEX; x += 20) rect(P.d, "rgba(20,12,6,0.7)", x, 0, 2.5, TEX);
    for (let y = 0; y < TEX; y += 128)
      for (let x = 4; x < TEX; x += 20) rect(P.d, "#2a2018", x, y + 6, 2, 2);
    grain(P, 0.6, 18);
  },
  [WL.ROCK]: (P) => {
    // red sandstone strata: bands of rust, salmon and cream, desert varnish streaks, cracks
    const { d, r } = P;
    const bands = [
      "#b2512c",
      "#c4653a",
      "#a4452a",
      "#d07a48",
      "#b85a34",
      "#e0a070",
      "#9a4028",
      "#c96d40",
    ];
    let y = 0;
    while (y < TEX) {
      const h = 6 + r() * 34;
      const col = bands[Math.floor(r() * bands.length)]!;
      rect(d, col, 0, y, TEX, h);
      // wavy band edge
      for (let x = 0; x < TEX; x += 4) rect(d, col, x, y - 2 + Math.sin(x * 0.05 + y) * 2, 4, 3);
      y += h;
    }
    for (let i = 0; i < 9000; i++) {
      const k = r();
      rect(
        d,
        rgba(80 + k * 140, 40 + k * 80, 20 + k * 50, 0.08 + r() * 0.12),
        r() * TEX,
        r() * TEX,
        1 + r() * 4,
        1 + r() * 2,
      );
    }
    // desert varnish: dark streaks running down from ledges
    for (let i = 0; i < 90; i++) {
      const x = r() * TEX;
      const y0 = r() * TEX;
      const g = d.createLinearGradient(0, y0, 0, y0 + 40 + r() * 140);
      g.addColorStop(0, "rgba(40,20,14,0.35)");
      g.addColorStop(1, "rgba(40,20,14,0)");
      rect(d, g, x, y0, 2 + r() * 8, 180);
    }
    // vertical joints / cracks (faint: this tile covers a lot of cliff)
    for (let i = 0; i < 26; i++) {
      let x = r() * TEX;
      let yy = r() * TEX;
      d.strokeStyle = "rgba(60,28,16,0.22)";
      d.lineWidth = 1;
      d.beginPath();
      d.moveTo(x, yy);
      for (let s = 0; s < 8; s++) {
        x += (r() - 0.5) * 6;
        yy += 6 + r() * 10;
        d.lineTo(x, yy);
      }
      d.stroke();
    }
  },
  [WL.TIMBER]: (P) => {
    const { d, r } = P;
    rect(d, "#8a6a4a", 0, 0, TEX, TEX);
    for (let i = 0; i < 600; i++) {
      const y = r() * TEX;
      const k = r();
      rect(
        d,
        rgba(70 + k * 90, 50 + k * 60, 30 + k * 40, 0.3 + r() * 0.3),
        0,
        y,
        TEX,
        1 + r() * 2.5,
      );
    }
    for (let i = 0; i < 30; i++) {
      d.fillStyle = "rgba(50,32,18,0.6)";
      d.beginPath();
      d.ellipse(r() * TEX, r() * TEX, 5 + r() * 4, 2 + r() * 2, 0, 0, Math.PI * 2);
      d.fill();
    }
    grain(P, 0.6, 20);
  },
  [WL.SIGNS]: (P) => {
    const { d, r, words } = P;
    const cw = TEX / SIGN_COLS;
    const ch = TEX / SIGN_ROWS;
    const palettes: [string, string, string][] = [
      ["#7a1e16", "#f4e2b8", "#2a0a06"], // cream on oxblood
      ["#f0e6cc", "#1e1a16", "#8a7a5a"], // black on white
      ["#1f3a2a", "#e8c25a", "#0a140e"], // gold on green
      ["#2a2a34", "#f2ead6", "#0a0a0e"], // white on black
      ["#c8a050", "#3a1a10", "#6a4a20"], // brown on ochre
      ["#20304a", "#f2d68a", "#0a1020"], // gold on navy
    ];
    words.forEach((word, i) => {
      const x = (i % SIGN_COLS) * cw;
      const y = Math.floor(i / SIGN_COLS) * ch;
      const warn = word === "ROAD CLOSED" || word === "BRIDGE OUT" || word === "KEEP OUT";
      const [bg, fg, sh] =
        word === "WANTED"
          ? (["#e8dcb8", "#2a1a10", "#a89878"] as const)
          : warn
            ? (["#a82418", "#f6ecd8", "#3a0a06"] as const)
            : palettes[(i * 5 + 1) % palettes.length]!;
      rect(d, bg, x, y, cw, ch);
      // board grain and a painted border
      for (let g = 0; g < 14; g++) rect(d, "rgba(0,0,0,0.12)", x, y + r() * ch, cw, 1);
      d.strokeStyle = fg;
      d.lineWidth = 2;
      d.strokeRect(x + 4, y + 4, cw - 8, ch - 8);
      let size = 30;
      d.font = `bold ${size}px Georgia, 'Times New Roman', serif`;
      const maxW = cw - 26;
      while (d.measureText(word).width > maxW && size > 12) {
        size -= 1;
        d.font = `bold ${size}px Georgia, 'Times New Roman', serif`;
      }
      d.textAlign = "center";
      d.textBaseline = "middle";
      d.fillStyle = sh;
      d.fillText(word, x + cw / 2 + 1.5, y + ch / 2 + 2);
      d.fillStyle = fg;
      d.fillText(word, x + cw / 2, y + ch / 2 + 0.5);
      // sun-faded, chipped paint
      for (let k = 0; k < 60; k++)
        rect(
          d,
          rgba(255, 245, 220, 0.12 * r()),
          x + r() * cw,
          y + r() * ch,
          2 + r() * 6,
          1 + r() * 2,
        );
    });
  },
  [WL.CANVAS]: (P) => {
    const { d, r } = P;
    rect(d, "#ece2cc", 0, 0, TEX, TEX);
    for (let x = 0; x < TEX; x += 3) rect(d, "rgba(120,100,70,0.06)", x, 0, 1, TEX);
    for (let y = 0; y < TEX; y += 3) rect(d, "rgba(120,100,70,0.06)", 0, y, TEX, 1);
    for (let i = 0; i < 25; i++) {
      const x = r() * TEX;
      const y = r() * TEX;
      const rad = 20 + r() * 60;
      const g = d.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, "rgba(140,110,70,0.18)");
      g.addColorStop(1, "rgba(140,110,70,0)");
      rect(d, g, x - rad, y - rad, rad * 2, rad * 2);
    }
    // seams
    for (let x = 0; x < TEX; x += 128) rect(d, "rgba(100,80,50,0.3)", x, 0, 2, TEX);
  },
  [WL.CACTUS]: (P) => {
    const { d, r } = P;
    for (let x = 0; x < TEX; x += 32) {
      const g = d.createLinearGradient(x, 0, x + 32, 0);
      g.addColorStop(0, "#3a5a30");
      g.addColorStop(0.5, "#7a9a5a");
      g.addColorStop(1, "#3a5a30");
      rect(d, g, x, 0, 32, TEX);
      // spines along the ribs
      for (let y = 0; y < TEX; y += 10) rect(d, "#e8e0c0", x + 15, y + r() * 4, 2, 2);
    }
    grain(P, 0.4, 8);
  },
  [WL.SAND]: (P) => {
    const { d, r } = P;
    rect(d, "#d2a574", 0, 0, TEX, TEX);
    for (let i = 0; i < 16000; i++) {
      const k = r();
      rect(
        d,
        rgba(150 + k * 100, 110 + k * 80, 70 + k * 60, 0.25),
        r() * TEX,
        r() * TEX,
        1 + r() * 2,
        1 + r() * 2,
      );
    }
    // wind ripples
    for (let y = 0; y < TEX; y += 7 + r() * 5) {
      d.strokeStyle = "rgba(150,100,60,0.12)";
      d.lineWidth = 1.5;
      d.beginPath();
      for (let x = 0; x <= TEX; x += 8) d.lineTo(x, y + Math.sin(x * 0.03 + y) * 3);
      d.stroke();
    }
    // pebbles
    for (let i = 0; i < 260; i++) {
      const k = r();
      d.fillStyle = rgba(120 + k * 80, 80 + k * 60, 50 + k * 40, 0.9);
      d.beginPath();
      d.ellipse(r() * TEX, r() * TEX, 1 + r() * 3, 1 + r() * 2, r() * 3, 0, Math.PI * 2);
      d.fill();
    }
  },
  [WL.DIRT]: (P) => {
    const { d, r } = P;
    rect(d, "#a57a52", 0, 0, TEX, TEX);
    for (let i = 0; i < 14000; i++) {
      const k = r();
      rect(
        d,
        rgba(110 + k * 90, 75 + k * 70, 45 + k * 50, 0.28),
        r() * TEX,
        r() * TEX,
        1 + r() * 3,
        1 + r() * 2,
      );
    }
    // wheel ruts along the street (u = along the street)
    for (const y of [0.22, 0.34, 0.66, 0.78]) {
      const g = d.createLinearGradient(0, y * TEX - 10, 0, y * TEX + 10);
      g.addColorStop(0, "rgba(70,45,25,0)");
      g.addColorStop(0.5, "rgba(70,45,25,0.28)");
      g.addColorStop(1, "rgba(70,45,25,0)");
      rect(d, g, 0, y * TEX - 10, TEX, 20);
    }
    // hoof prints and boot prints
    for (let i = 0; i < 220; i++) {
      d.fillStyle = "rgba(60,38,20,0.35)";
      d.beginPath();
      d.ellipse(r() * TEX, r() * TEX, 3 + r() * 2, 2.5 + r() * 2, r() * 3, 0, Math.PI * 2);
      d.fill();
    }
    // horse apples, straw
    for (let i = 0; i < 40; i++)
      rect(d, "rgba(200,170,90,0.6)", r() * TEX, r() * TEX, 6 + r() * 8, 1);
  },
  [WL.MUD]: (P) => {
    // a dry wash bed: sun-baked silt broken into curling plates of uneven size, each its own
    // shade, the cracks wide and dark in places and hairline in others, sand blown into them
    const { d, r } = P;
    rect(d, "#b89a74", 0, 0, TEX, TEX);
    const pts: [number, number, number, number][] = [];
    for (let i = 0; i < 110; i++)
      pts.push([r() * TEX, r() * TEX, 0.86 + r() * 0.2, 0.6 + r() * 2.2]);
    const img = d.getImageData(0, 0, TEX, TEX);
    const data = img.data;
    for (let y = 0; y < TEX; y += 1)
      for (let x = 0; x < TEX; x += 1) {
        let b1 = 1e9;
        let b2 = 1e9;
        let i1 = 0;
        // a little wobble in the edges so no two plates share a straight line
        const wx = x + Math.sin(y * 0.09 + x * 0.013) * 2.5;
        const wy = y + Math.cos(x * 0.08 + y * 0.017) * 2.5;
        for (let i = 0; i < pts.length; i++) {
          const q = pts[i]!;
          let dx = Math.abs(q[0] - wx);
          let dy = Math.abs(q[1] - wy);
          if (dx > TEX / 2) dx = TEX - dx;
          if (dy > TEX / 2) dy = TEX - dy;
          const dd = dx * dx + dy * dy;
          if (dd < b1) {
            b2 = b1;
            b1 = dd;
            i1 = i;
          } else if (dd < b2) b2 = dd;
        }
        const edge = Math.sqrt(b2) - Math.sqrt(b1);
        const [, , shade, cw] = pts[i1]!;
        const o = (y * TEX + x) * 4;
        let k: number;
        let sand = 0;
        if (edge < cw) {
          k = 0.48 + edge * 0.05; // the crack
          sand = edge < cw * 0.4 ? 0.35 : 0; // blown sand in the wide ones
        } else if (edge < cw + 2.2)
          k = shade * 1.08; // the plate's curled, sunlit lip
        else k = shade * (1 - Math.min(0.1, Math.sqrt(b1) / 420));
        data[o] = data[o]! * k + sand * 60;
        data[o + 1] = data[o + 1]! * k + sand * 45;
        data[o + 2] = data[o + 2]! * k + sand * 25;
      }
    d.putImageData(img, 0, 0);
    grain(P, 0.7, 26);
  },
  [WL.YARD]: (P) => {
    const { d, r } = P;
    rect(d, "#b08a60", 0, 0, TEX, TEX);
    for (let i = 0; i < 12000; i++) {
      const k = r();
      rect(
        d,
        rgba(120 + k * 90, 90 + k * 70, 55 + k * 50, 0.25),
        r() * TEX,
        r() * TEX,
        1 + r() * 3,
        1 + r() * 2,
      );
    }
    for (let i = 0; i < 400; i++) {
      d.strokeStyle = rgba(210, 180, 100, 0.5 + r() * 0.3);
      d.lineWidth = 1;
      const x = r() * TEX;
      const y = r() * TEX;
      const a = r() * 6.28;
      d.beginPath();
      d.moveTo(x, y);
      d.lineTo(x + Math.cos(a) * 8, y + Math.sin(a) * 8);
      d.stroke();
    }
  },
  [WL.BALLAST]: (P) => {
    const { d, r } = P;
    rect(d, "#7a6a5a", 0, 0, TEX, TEX);
    for (let i = 0; i < 9000; i++) {
      const k = r();
      d.fillStyle = rgba(80 + k * 110, 70 + k * 90, 60 + k * 70, 1);
      d.beginPath();
      d.ellipse(r() * TEX, r() * TEX, 1.5 + r() * 3, 1 + r() * 2.5, r() * 3, 0, Math.PI * 2);
      d.fill();
    }
  },
  [WL.IRON]: (P) => {
    const { d, r } = P;
    rect(d, "#3a3a3c", 0, 0, TEX, TEX);
    for (let i = 0; i < 4000; i++)
      rect(
        d,
        rgba(90 + r() * 60, 60 + r() * 30, 40, 0.12),
        r() * TEX,
        r() * TEX,
        1 + r() * 4,
        1 + r() * 4,
      );
    for (let y = 32; y < TEX; y += 128)
      for (let x = 8; x < TEX; x += 16) rect(d, "#5a5a5c", x, y, 3, 3); // rivets
    for (let y = 0; y < TEX; y += 128) rect(d, "rgba(0,0,0,0.5)", 0, y, TEX, 2);
  },
  [WL.PAINT]: (P) => {
    rect(P.d, "#f4f0e8", 0, 0, TEX, TEX);
    grain(P, 0.5, 14);
  },
};

let arr: { day: THREE.DataArrayTexture; night: THREE.DataArrayTexture } | null = null;
const NIGHT_TEX = 256;

/** The western texture arrays (built once). `words` fills the sign layer. */
export function westernArrays(words: readonly string[]) {
  if (arr) return arr;
  const day = new Uint8Array(TEX * TEX * 4 * LAYERS);
  const night = new Uint8Array(NIGHT_TEX * NIGHT_TEX * 4 * LAYERS);
  const [, d] = canvas(TEX, TEX);
  const [, g] = canvas(TEX, TEX);
  const [, n] = canvas(TEX, TEX);
  const [, m] = canvas(TEX, TEX);
  const [, small] = canvas(NIGHT_TEX, NIGHT_TEX);
  for (let layer = 0; layer < LAYERS; layer++) {
    rect(d, "#fff", 0, 0, TEX, TEX);
    rect(g, "#000", 0, 0, TEX, TEX);
    rect(n, "#000", 0, 0, TEX, TEX);
    rect(m, "#000", 0, 0, TEX, TEX);
    PAINT[layer]?.({ d, g, n, m, r: rng(733 + layer * 7919), words });
    const D = d.getImageData(0, 0, TEX, TEX).data;
    const G = g.getImageData(0, 0, TEX, TEX).data;
    const off = layer * TEX * TEX * 4;
    // canvas row 0 is the top; texture row 0 is the bottom (v = 0)
    for (let y = 0; y < TEX; y++) {
      const src = (TEX - 1 - y) * TEX * 4;
      const dst = off + y * TEX * 4;
      for (let x = 0; x < TEX * 4; x += 4) {
        day[dst + x] = D[src + x]!;
        day[dst + x + 1] = D[src + x + 1]!;
        day[dst + x + 2] = D[src + x + 2]!;
        day[dst + x + 3] = G[src + x]!;
      }
    }
    // night: lit colour + window mask, at half resolution
    small.clearRect(0, 0, NIGHT_TEX, NIGHT_TEX);
    small.drawImage(n.canvas, 0, 0, NIGHT_TEX, NIGHT_TEX);
    const Nn = small.getImageData(0, 0, NIGHT_TEX, NIGHT_TEX).data;
    small.clearRect(0, 0, NIGHT_TEX, NIGHT_TEX);
    small.drawImage(m.canvas, 0, 0, NIGHT_TEX, NIGHT_TEX);
    const M = small.getImageData(0, 0, NIGHT_TEX, NIGHT_TEX).data;
    const noff = layer * NIGHT_TEX * NIGHT_TEX * 4;
    for (let y = 0; y < NIGHT_TEX; y++) {
      const src = (NIGHT_TEX - 1 - y) * NIGHT_TEX * 4;
      const dst = noff + y * NIGHT_TEX * 4;
      for (let x = 0; x < NIGHT_TEX * 4; x += 4) {
        night[dst + x] = Nn[src + x]!;
        night[dst + x + 1] = Nn[src + x + 1]!;
        night[dst + x + 2] = Nn[src + x + 2]!;
        night[dst + x + 3] = M[src + x]!;
      }
    }
  }
  const make = (data: Uint8Array, size: number) => {
    const t = new THREE.DataArrayTexture(data, size, size, LAYERS);
    t.format = THREE.RGBAFormat;
    t.type = THREE.UnsignedByteType;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 8;
    t.colorSpace = THREE.SRGBColorSpace; // alpha channels are masks; only RGB is converted
    t.needsUpdate = true;
    return t;
  };
  arr = { day: make(day, TEX), night: make(night, NIGHT_TEX) };
  return arr;
}

/** UV rectangle [u0, v0, u1, v1] of a word in the sign layer */
export function signUV(i: number) {
  const col = i % SIGN_COLS;
  const row = Math.floor(i / SIGN_COLS);
  const u0 = col / SIGN_COLS;
  const v1 = 1 - row / SIGN_ROWS;
  return [u0 + 0.004, v1 - 1 / SIGN_ROWS + 0.004, u0 + 1 / SIGN_COLS - 0.004, v1 - 0.004] as const;
}

// ---------------------------------------------------------------------------------------
// Sky: sunset (the hero) and night, as equirectangular canvases.
// ---------------------------------------------------------------------------------------
export type WMode = TimeOfDay;
/** direction TOWARD the sun (sunset) or the moon (night) */
export const SKY_DIR: Record<WMode, [number, number, number]> = {
  // low in the west, a touch south: it hangs just beside the church's bell tower
  sunset: [-0.972, 0.185, 0.143],
  // the moon rides over the buttes in the east-north-east
  night: [0.62, 0.42, -0.66],
};
const skyCache: Partial<Record<WMode, THREE.CanvasTexture>> = {};

export function westernSky(mode: WMode) {
  const hit = skyCache[mode];
  if (hit) return hit;
  const W = 2048;
  const H = 1024;
  const [c, g] = canvas(W, H);
  const r = rng(mode === "sunset" ? 17 : 23);
  const [sx, sy, sz] = SKY_DIR[mode];
  // three.js equirect convention: u = atan2(z, x)
  const su = (Math.atan2(sz, sx) / (Math.PI * 2) + 0.5) * W;
  const sv = (0.5 - Math.asin(sy) / Math.PI) * H;
  const horizon = H * 0.5;
  if (mode === "sunset") {
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, "#1c2a52");
    gr.addColorStop(0.22, "#4a4a7a");
    gr.addColorStop(0.36, "#a2607a");
    gr.addColorStop(0.44, "#e6865a");
    gr.addColorStop(0.49, "#ffb060");
    gr.addColorStop(0.505, "#ffc27a");
    gr.addColorStop(0.53, "#c47a52");
    gr.addColorStop(1, "#7a4a36");
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    // the whole western half glows; the east fades to dusky violet
    for (let x = 0; x < W; x += 4) {
      let du = Math.abs(x - su);
      if (du > W / 2) du = W - du;
      const k = 1 - du / (W / 2);
      g.fillStyle = `rgba(255,150,70,${(0.35 * k * k).toFixed(3)})`;
      g.fillRect(x, H * 0.28, 4, horizon - H * 0.28 + 20);
      g.fillStyle = `rgba(60,40,100,${(0.3 * (1 - k)).toFixed(3)})`;
      g.fillRect(x, 0, 4, horizon);
    }
    // glow round the sun
    for (const [rad, a, col] of [
      [520, 0.35, "255,140,60"],
      [220, 0.5, "255,170,80"],
      [90, 0.8, "255,210,130"],
    ] as const) {
      const sg = g.createRadialGradient(su, sv, 0, su, sv, rad);
      sg.addColorStop(0, `rgba(${col},${a})`);
      sg.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = sg;
      g.fillRect(su - rad, sv - rad, rad * 2, rad * 2);
    }
    // long streaky clouds lit from below: gold near the sun, pink and violet away from it
    for (let k = 0; k < 90; k++) {
      const cx = r() * W;
      const cy = H * (0.2 + r() * 0.26);
      const w = 80 + r() * 320;
      const h = 3 + r() * 10;
      let du = Math.abs(cx - su);
      if (du > W / 2) du = W - du;
      const near = 1 - du / (W / 2);
      const col = near > 0.7 ? "255,190,110" : near > 0.4 ? "250,140,120" : "150,100,150";
      const cg = g.createRadialGradient(cx, cy, 0, cx, cy, w);
      cg.addColorStop(0, `rgba(${col},${(0.25 + r() * 0.4).toFixed(2)})`);
      cg.addColorStop(1, `rgba(${col},0)`);
      g.save();
      g.translate(cx, cy);
      g.scale(1, h / w);
      g.translate(-cx, -cy);
      g.fillStyle = cg;
      g.fillRect(cx - w, cy - w, w * 2, w * 2);
      g.restore();
    }
  } else {
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, "#02040c");
    gr.addColorStop(0.3, "#07102a");
    gr.addColorStop(0.46, "#16204a");
    gr.addColorStop(0.5, "#2a3060");
    gr.addColorStop(0.52, "#141830");
    gr.addColorStop(1, "#0a0c16");
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    // the milky way: a soft band of haze and dense faint stars across the sky
    g.save();
    g.translate(W * 0.5, H * 0.22);
    g.rotate(-0.35);
    for (let k = 0; k < 60; k++) {
      const x = (r() - 0.5) * W * 1.4;
      const y = (r() - 0.5) * 70;
      const rad = 40 + r() * 90;
      const mg = g.createRadialGradient(x, y, 0, x, y, rad);
      mg.addColorStop(0, "rgba(170,180,230,0.07)");
      mg.addColorStop(1, "rgba(170,180,230,0)");
      g.fillStyle = mg;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    for (let k = 0; k < 4000; k++) {
      const x = (r() - 0.5) * W * 1.4;
      const y = (r() + r() + r() - 1.5) * 60;
      g.fillStyle = `rgba(230,235,255,${(0.2 + r() * 0.5).toFixed(2)})`;
      g.fillRect(x, y, 1, 1);
    }
    g.restore();
    for (let k = 0; k < 2200; k++) {
      const y = Math.pow(r(), 1.4) * horizon;
      g.fillStyle = `rgba(240,240,255,${(0.25 + r() * 0.6).toFixed(2)})`;
      const s = r() < 0.04 ? 2 : 1;
      g.fillRect(r() * W, y, s, s);
    }
    // moon glow
    const mg = g.createRadialGradient(su, sv, 0, su, sv, 160);
    mg.addColorStop(0, "rgba(220,230,255,0.55)");
    mg.addColorStop(0.2, "rgba(180,200,255,0.2)");
    mg.addColorStop(1, "rgba(120,140,220,0)");
    g.fillStyle = mg;
    g.fillRect(su - 160, sv - 160, 320, 320);
    // a faint warm glow on the horizon toward town's lamps (west)
    const hz = g.createLinearGradient(0, horizon - 40, 0, horizon + 4);
    hz.addColorStop(0, "rgba(90,70,90,0)");
    hz.addColorStop(1, "rgba(90,70,110,0.35)");
    g.fillStyle = hz;
    g.fillRect(0, horizon - 40, W, 44);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.needsUpdate = true;
  skyCache[mode] = t;
  return t;
}

let discTex: THREE.CanvasTexture | null = null;
/** A soft disc with a halo: the big setting sun, or the moon (tinted by the material). */
export function discTexture() {
  if (discTex) return discTex;
  const [c, g] = canvas(256, 256);
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(0.3, "rgba(255,255,255,1)");
  gr.addColorStop(0.34, "rgba(255,255,255,0.55)");
  gr.addColorStop(0.5, "rgba(255,255,255,0.18)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 256, 256);
  discTex = new THREE.CanvasTexture(c);
  discTex.colorSpace = THREE.SRGBColorSpace;
  return discTex;
}

let sunTex: THREE.CanvasTexture | null = null;
/** the big setting sun: a hot pale-gold core, a limb-darkened orange rim, a red halo */
export function sunTexture() {
  if (sunTex) return sunTex;
  const [c, g] = canvas(256, 256);
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, "rgba(255,246,220,1)");
  gr.addColorStop(0.2, "rgba(255,226,170,1)");
  gr.addColorStop(0.285, "rgba(255,184,104,1)");
  gr.addColorStop(0.3, "rgba(255,150,70,0.6)");
  gr.addColorStop(0.42, "rgba(255,120,60,0.2)");
  gr.addColorStop(0.7, "rgba(255,100,60,0.05)");
  gr.addColorStop(1, "rgba(255,90,60,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 256, 256);
  sunTex = new THREE.CanvasTexture(c);
  sunTex.colorSpace = THREE.SRGBColorSpace;
  return sunTex;
}

let moonTex: THREE.CanvasTexture | null = null;
/** the moon: a cratered disc with a soft halo */
export function moonTexture() {
  if (moonTex) return moonTex;
  const [c, g] = canvas(256, 256);
  const halo = g.createRadialGradient(128, 128, 30, 128, 128, 128);
  halo.addColorStop(0, "rgba(200,215,255,0.35)");
  halo.addColorStop(1, "rgba(200,215,255,0)");
  g.fillStyle = halo;
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = "#eef0f6";
  g.beginPath();
  g.arc(128, 128, 36, 0, Math.PI * 2);
  g.fill();
  const r = rng(5);
  for (let i = 0; i < 14; i++) {
    g.fillStyle = `rgba(150,158,180,${(0.25 + r() * 0.3).toFixed(2)})`;
    g.beginPath();
    const a = r() * 6.28;
    const d = r() * 28;
    g.arc(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 3 + r() * 9, 0, Math.PI * 2);
    g.fill();
  }
  moonTex = new THREE.CanvasTexture(c);
  moonTex.colorSpace = THREE.SRGBColorSpace;
  return moonTex;
}

let glowTex: THREE.CanvasTexture | null = null;
/** Soft radial falloff for lantern light pools and dust puffs. */
export function softGlow() {
  if (glowTex) return glowTex;
  const [c, g] = canvas(128, 128);
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(0.4, "rgba(255,255,255,0.45)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

let puffTex: THREE.CanvasTexture | null = null;
/** A lumpy smoke / dust puff sprite. */
export function puffTexture() {
  if (puffTex) return puffTex;
  const [c, g] = canvas(128, 128);
  const r = rng(77);
  for (let i = 0; i < 14; i++) {
    const x = 64 + (r() - 0.5) * 50;
    const y = 64 + (r() - 0.5) * 50;
    const rad = 18 + r() * 26;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, "rgba(255,255,255,0.5)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
  }
  puffTex = new THREE.CanvasTexture(c);
  puffTex.colorSpace = THREE.SRGBColorSpace;
  return puffTex;
}
