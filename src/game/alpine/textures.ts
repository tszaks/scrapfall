// Procedural textures for Whiteout Pass, painted once on canvases in the browser.
//
// One texture ARRAY holds every surface style (timber, stone, plaster, snow, shingles,
// windows...), so a chunk of chalets, props and set pieces draws with one material.
//   RGB = albedo (near white where vertex colours should tint it)
//   A   = mask: glass panes / lit parts for window layers, sparkle for snow
// Tiling layers cover 2 x 2 m per tile (geometry UVs are metres / 2); window-like layers
// cover one element per tile (UV 0..1).
import * as THREE from "three";

import { SIGN_WORDS } from "./layout";

export const T = {
  plain: 0,
  log: 1,
  board: 2,
  stone: 3,
  plaster: 4,
  snow: 5,
  shingle: 6,
  window: 7,
  rock: 8,
  bark: 9,
  metal: 10,
  rail: 11,
  copper: 12,
  stripes: 13,
  mesh: 14,
  glasswall: 15,
  clock: 16,
  door: 17,
  hazard: 18,
  arched: 19,
  ice: 20,
  needles: 21,
} as const;
const LAYERS = 22;
const S = 256;

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
const rect = (c: Ctx, s: string, x: number, y: number, w: number, h: number) => {
  c.fillStyle = s;
  c.fillRect(x, y, w, h);
};
function speckle(c: Ctx, r: () => number, n: number, col: string, a: number, size = 2) {
  for (let i = 0; i < n; i++) {
    c.globalAlpha = a * (0.4 + r() * 0.6);
    rect(c, col, r() * S, r() * S, size * (0.5 + r()), size * (0.5 + r()));
  }
  c.globalAlpha = 1;
}

type P = { d: Ctx; m: Ctx; r: () => number };
const PAINT: Record<number, (p: P) => void> = {
  [T.plain]: () => {},
  [T.log]: ({ d, r }) => {
    // 8 round logs per 2 m, darker grooves, end grain lighter
    const h = S / 8;
    for (let k = 0; k < 8; k++) {
      const y = k * h;
      const g = d.createLinearGradient(0, y, 0, y + h);
      const base = 150 + Math.floor(r() * 30);
      g.addColorStop(0, `rgb(${base - 70},${base - 95},${base - 115})`);
      g.addColorStop(0.18, `rgb(${base},${base - 38},${base - 70})`);
      g.addColorStop(0.55, `rgb(${base + 12},${base - 26},${base - 60})`);
      g.addColorStop(0.9, `rgb(${base - 40},${base - 70},${base - 92})`);
      g.addColorStop(1, `rgb(${base - 90},${base - 110},${base - 125})`);
      d.fillStyle = g;
      d.fillRect(0, y, S, h);
      for (let i = 0; i < 12; i++) {
        d.globalAlpha = 0.18;
        rect(d, "#3a2412", r() * S, y + 4 + r() * (h - 8), 20 + r() * 60, 1);
      }
      d.globalAlpha = 1;
      if (r() < 0.5) {
        d.globalAlpha = 0.35;
        d.fillStyle = "#2a1a0e";
        d.beginPath();
        d.arc(r() * S, y + h / 2, 2 + r() * 2, 0, Math.PI * 2);
        d.fill();
        d.globalAlpha = 1;
      }
    }
  },
  [T.board]: ({ d, r }) => {
    // vertical boards 0.2 m with dark seams, weathered brown
    const w = S / 10;
    for (let k = 0; k < 10; k++) {
      const v = 120 + Math.floor(r() * 40);
      rect(d, `rgb(${v},${Math.floor(v * 0.72)},${Math.floor(v * 0.5)})`, k * w, 0, w, S);
      for (let i = 0; i < 18; i++) {
        d.globalAlpha = 0.16;
        rect(d, "#2e1c0e", k * w + 2 + r() * (w - 4), r() * S, 1, 20 + r() * 50);
      }
      d.globalAlpha = 1;
      rect(d, "#2a1a0c", k * w, 0, 2, S);
    }
    speckle(d, r, 300, "#000", 0.08);
  },
  [T.stone]: ({ d, r }) => {
    // rubble stone: irregular grey blocks with mortar
    rect(d, "#8a8680", 0, 0, S, S);
    let y = 0;
    while (y < S) {
      const h = 22 + r() * 26;
      let x = -r() * 30;
      while (x < S) {
        const w = 30 + r() * 44;
        const v = 120 + Math.floor(r() * 70);
        const t = Math.floor(r() * 14) - 7;
        d.fillStyle = `rgb(${v + t},${v + t * 0.5},${v - t})`;
        d.beginPath();
        const j = () => (r() - 0.5) * 5;
        d.moveTo(x + 3 + j(), y + 3 + j());
        d.lineTo(x + w - 3 + j(), y + 3 + j());
        d.lineTo(x + w - 3 + j(), y + h - 3 + j());
        d.lineTo(x + 3 + j(), y + h - 3 + j());
        d.closePath();
        d.fill();
        d.globalAlpha = 0.25;
        rect(d, "#fff", x + 5, y + 4, w - 12, 3);
        d.globalAlpha = 1;
        x += w;
      }
      y += h;
    }
    speckle(d, r, 900, "#3a3a3a", 0.18);
  },
  [T.plaster]: ({ d, r }) => {
    rect(d, "#f1ece2", 0, 0, S, S);
    speckle(d, r, 1400, "#c8bca8", 0.12, 3);
    speckle(d, r, 600, "#ffffff", 0.2, 3);
  },
  [T.snow]: ({ d, m, r }) => {
    rect(d, "#f7f9fc", 0, 0, S, S);
    speckle(d, r, 900, "#d8e2f0", 0.25, 6);
    rect(m, "#000", 0, 0, S, S);
    for (let i = 0; i < 260; i++) rect(m, "#fff", Math.floor(r() * S), Math.floor(r() * S), 1, 1);
  },
  [T.shingle]: ({ d, r }) => {
    const rh = S / 10;
    for (let k = 0; k < 10; k++) {
      const off = (k % 2) * 12;
      for (let x = -off; x < S; x += 24) {
        const v = 90 + Math.floor(r() * 40);
        rect(d, `rgb(${v},${Math.floor(v * 0.72)},${Math.floor(v * 0.55)})`, x, k * rh, 23, rh);
        rect(d, "#2a1c10", x, k * rh + rh - 3, 24, 3);
      }
    }
  },
  [T.window]: ({ d, m }) => {
    // one chalet window: carved frame, 2 x 3 panes, a sill
    rect(d, "#4a2e18", 0, 0, S, S);
    rect(d, "#6b4424", 10, 10, S - 20, S - 20);
    rect(m, "#000", 0, 0, S, S);
    const cols = 2;
    const rows = 3;
    const pw = (S - 56) / cols;
    const ph = (S - 64) / rows;
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < rows; j++) {
        const x = 24 + i * (pw + 8);
        const y = 22 + j * (ph + 8);
        const g = d.createLinearGradient(x, y, x + pw, y + ph);
        g.addColorStop(0, "#5a6a80");
        g.addColorStop(1, "#27303e");
        d.fillStyle = g;
        d.fillRect(x, y, pw, ph);
        rect(m, "#fff", x, y, pw, ph);
      }
    // lace curtain hint
    d.globalAlpha = 0.18;
    rect(d, "#fff", 24, 22, S - 48, 26);
    d.globalAlpha = 1;
    rect(d, "#3a2412", 0, S - 18, S, 18);
  },
  [T.rock]: ({ d, r }) => {
    rect(d, "#7d7f84", 0, 0, S, S);
    for (let i = 0; i < 70; i++) {
      d.globalAlpha = 0.25;
      d.fillStyle = r() < 0.5 ? "#5a5c62" : "#a2a4a8";
      d.beginPath();
      const x = r() * S;
      const y = r() * S;
      d.moveTo(x, y);
      d.lineTo(x + 10 + r() * 40, y + (r() - 0.5) * 20);
      d.lineTo(x + r() * 30, y + 8 + r() * 30);
      d.fill();
    }
    d.globalAlpha = 1;
    speckle(d, r, 1600, "#303238", 0.22);
  },
  [T.bark]: ({ d, r }) => {
    rect(d, "#4a3322", 0, 0, S, S);
    for (let i = 0; i < 120; i++) {
      d.globalAlpha = 0.4;
      rect(d, r() < 0.5 ? "#2a1a10" : "#6a4a32", r() * S, r() * S, 3 + r() * 6, 20 + r() * 50);
    }
    d.globalAlpha = 1;
  },
  [T.metal]: ({ d, r }) => {
    rect(d, "#d8dce0", 0, 0, S, S);
    for (let x = 0; x < S; x += 32) rect(d, "#9aa0a8", x, 0, 2, S);
    speckle(d, r, 400, "#6a7078", 0.1);
  },
  [T.rail]: ({ d, m }) => {
    // Swiss balcony railing: vertical boards with cut-out hearts, a top rail
    rect(d, "#8a5a32", 0, 0, S, S);
    rect(m, "#000", 0, 0, S, S);
    const w = S / 8;
    for (let k = 0; k < 8; k++) {
      rect(d, "#2a1a0c", k * w, 0, 2, S);
      const cx = k * w + w / 2;
      const cy = S * 0.55;
      d.fillStyle = "#1a1008";
      d.beginPath();
      d.moveTo(cx, cy + 12);
      d.bezierCurveTo(cx - 16, cy, cx - 10, cy - 14, cx, cy - 5);
      d.bezierCurveTo(cx + 10, cy - 14, cx + 16, cy, cx, cy + 12);
      d.fill();
    }
    rect(d, "#5a3a1e", 0, 0, S, 26);
    rect(d, "#5a3a1e", 0, S - 18, S, 18);
  },
  [T.copper]: ({ d, r }) => {
    rect(d, "#5fa08c", 0, 0, S, S);
    for (let x = 0; x < S; x += 21) rect(d, "#427a68", x, 0, 3, S);
    speckle(d, r, 900, "#8cc8b0", 0.25, 4);
    speckle(d, r, 400, "#2e5a4a", 0.2, 4);
  },
  [T.stripes]: ({ d }) => {
    for (let k = 0; k < 8; k++) rect(d, k % 2 ? "#f4efe6" : "#b8252a", k * (S / 8), 0, S / 8, S);
    rect(d, "#7a1418", 0, S - 20, S, 20);
  },
  [T.mesh]: ({ d, r }) => {
    // orange plastic safety mesh
    rect(d, "#ff7a1a", 0, 0, S, S);
    for (let y = 0; y < S; y += 16)
      for (let x = (y / 16) % 2 ? 8 : 0; x < S; x += 16) {
        d.fillStyle = "#6a2a08";
        d.beginPath();
        d.ellipse(x + 8, y + 8, 5, 3.5, 0, 0, Math.PI * 2);
        d.fill();
      }
    speckle(d, r, 200, "#ffd0a0", 0.3);
  },
  [T.glasswall]: ({ d, m }) => {
    rect(d, "#3a3e44", 0, 0, S, S);
    rect(m, "#000", 0, 0, S, S);
    const n = 4;
    const w = S / n;
    for (let i = 0; i < n; i++) {
      const g = d.createLinearGradient(0, 0, 0, S);
      g.addColorStop(0, "#8aa4c0");
      g.addColorStop(1, "#2c3a4c");
      d.fillStyle = g;
      d.fillRect(i * w + 6, 8, w - 12, S - 16);
      rect(m, "#fff", i * w + 6, 8, w - 12, S - 16);
    }
  },
  [T.clock]: ({ d }) => {
    rect(d, "#e8dcc0", 0, 0, S, S);
    d.fillStyle = "#1a1a1a";
    d.beginPath();
    d.arc(S / 2, S / 2, S * 0.46, 0, Math.PI * 2);
    d.fill();
    d.fillStyle = "#f4ecd8";
    d.beginPath();
    d.arc(S / 2, S / 2, S * 0.42, 0, Math.PI * 2);
    d.fill();
    d.fillStyle = "#1a1a1a";
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      d.save();
      d.translate(S / 2 + Math.sin(a) * S * 0.36, S / 2 - Math.cos(a) * S * 0.36);
      d.rotate(a);
      d.fillRect(-3, -10, 6, k % 3 ? 14 : 22);
      d.restore();
    }
    d.lineCap = "round";
    d.strokeStyle = "#111";
    d.lineWidth = 9;
    d.beginPath();
    d.moveTo(S / 2, S / 2);
    d.lineTo(S / 2 + S * 0.16, S / 2 - S * 0.12);
    d.stroke();
    d.lineWidth = 6;
    d.beginPath();
    d.moveTo(S / 2, S / 2);
    d.lineTo(S / 2 - S * 0.05, S / 2 - S * 0.32);
    d.stroke();
  },
  [T.door]: ({ d, m }) => {
    rect(d, "#3a2412", 0, 0, S, S);
    rect(d, "#6a3e1e", 16, 12, S - 32, S - 12);
    for (let k = 0; k < 6; k++) rect(d, "#4a2a12", 16 + k * ((S - 32) / 6), 12, 3, S);
    rect(m, "#000", 0, 0, S, S);
    rect(d, "#c8a040", S - 60, S * 0.55, 12, 12);
    // small lit transom
    rect(d, "#51606e", 40, 24, S - 80, 30);
    rect(m, "#fff", 40, 24, S - 80, 30);
  },
  [T.hazard]: ({ d }) => {
    rect(d, "#f4f0e8", 0, 0, S, S);
    d.fillStyle = "#d8261e";
    for (let k = -4; k < 8; k++) {
      d.beginPath();
      d.moveTo(k * 48, 0);
      d.lineTo(k * 48 + 24, 0);
      d.lineTo(k * 48 + 24 + S, S);
      d.lineTo(k * 48 + S, S);
      d.fill();
    }
  },
  [T.arched]: ({ d, m }) => {
    // church window: tall, round-headed, leaded
    rect(d, "#e8e2d4", 0, 0, S, S);
    rect(m, "#000", 0, 0, S, S);
    const path = (c: Ctx) => {
      c.beginPath();
      c.moveTo(40, S - 10);
      c.lineTo(40, 90);
      c.arc(S / 2, 90, S / 2 - 40, Math.PI, 0);
      c.lineTo(S - 40, S - 10);
      c.closePath();
    };
    d.fillStyle = "#34405a";
    path(d);
    d.fill();
    m.fillStyle = "#fff";
    path(m);
    m.fill();
    d.strokeStyle = "#222";
    d.lineWidth = 3;
    for (let y = 100; y < S; y += 34) {
      d.beginPath();
      d.moveTo(40, y);
      d.lineTo(S - 40, y);
      d.stroke();
    }
    d.beginPath();
    d.moveTo(S / 2, 40);
    d.lineTo(S / 2, S - 10);
    d.stroke();
  },
  [T.ice]: ({ d, r }) => {
    rect(d, "#b8d6ea", 0, 0, S, S);
    d.strokeStyle = "rgba(255,255,255,0.5)";
    for (let i = 0; i < 30; i++) {
      d.lineWidth = 0.5 + r();
      d.beginPath();
      let x = r() * S;
      let y = r() * S;
      d.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        x += (r() - 0.5) * 60;
        y += (r() - 0.5) * 60;
        d.lineTo(x, y);
      }
      d.stroke();
    }
    speckle(d, r, 500, "#ffffff", 0.25, 4);
  },
  [T.needles]: ({ d, r }) => {
    rect(d, "#2f4a3a", 0, 0, S, S);
    for (let i = 0; i < 900; i++) {
      d.globalAlpha = 0.5;
      rect(d, r() < 0.5 ? "#1e3428" : "#4a6a52", r() * S, r() * S, 1, 6 + r() * 8);
    }
    d.globalAlpha = 1;
  },
};

let arr: THREE.DataArrayTexture | null = null;

/** The alpine texture array (built once). */
export function alpineArray() {
  if (arr) return arr;
  const data = new Uint8Array(S * S * 4 * LAYERS);
  const [, d] = canvas(S, S);
  const [, m] = canvas(S, S);
  for (let layer = 0; layer < LAYERS; layer++) {
    rect(d, "#fff", 0, 0, S, S);
    rect(m, "#000", 0, 0, S, S);
    PAINT[layer]?.({ d, m, r: rng(4242 + layer * 7919) });
    const D = d.getImageData(0, 0, S, S).data;
    const M = m.getImageData(0, 0, S, S).data;
    const off = layer * S * S * 4;
    for (let y = 0; y < S; y++) {
      const src = (S - 1 - y) * S * 4;
      const dst = off + y * S * 4;
      for (let x = 0; x < S * 4; x += 4) {
        data[dst + x] = D[src + x]!;
        data[dst + x + 1] = D[src + x + 1]!;
        data[dst + x + 2] = D[src + x + 2]!;
        data[dst + x + 3] = M[src + x]!;
      }
    }
  }
  const t = new THREE.DataArrayTexture(data, S, S, LAYERS);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  arr = t;
  return t;
}

// ---- sign atlas: one word per row, carved-wood and enamel styles ----
export const SIGN_ROWS = 16;
let signs: THREE.CanvasTexture | null = null;
export function signTexture() {
  if (signs) return signs;
  const W = 1024;
  const RH = 64;
  const [c, g] = canvas(W, RH * SIGN_ROWS);
  SIGN_WORDS.forEach((word, i) => {
    const y = i * RH;
    const warn = i >= 8 && i <= 10;
    g.fillStyle = warn ? (i === 9 ? "#f2c418" : "#d8261e") : i === 0 ? "#1c2a4a" : "#4a2a14";
    g.fillRect(0, y, W, RH);
    g.strokeStyle = warn ? "#1a1a1a" : "#d8b060";
    g.lineWidth = 4;
    g.strokeRect(4, y + 4, W - 8, RH - 8);
    g.fillStyle = warn ? (i === 9 ? "#1a1a1a" : "#ffffff") : "#f4dca0";
    g.font = `bold ${warn ? 40 : 42}px Georgia, 'Times New Roman', serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(word, W / 2, y + RH / 2 + 2);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  signs = t;
  return t;
}
/** uv rect [u0, v0, u1, v1] of a sign word (texture v runs bottom-up) */
export function signUV(i: number) {
  const v1 = 1 - i / SIGN_ROWS;
  const v0 = 1 - (i + 1) / SIGN_ROWS;
  return [0, v0, 1, v1] as const;
}

// ---- soft round glow sprite (lamp halos, light pools, smoke puffs) ----
let glow: THREE.CanvasTexture | null = null;
export function glowTexture() {
  if (glow) return glow;
  const [c, g] = canvas(128, 128);
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(0.25, "rgba(255,255,255,0.55)");
  gr.addColorStop(0.6, "rgba(255,255,255,0.12)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  glow = new THREE.CanvasTexture(c);
  glow.needsUpdate = true;
  return glow;
}
