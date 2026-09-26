// Procedural canvas textures for the city map. Built once, lazily, in the browser.
import * as THREE from "three";

export type FacadeKind = "glass" | "office" | "brick";
/** One texture tile covers this many window columns and floors. */
export const TILE_COLS = 8;
export const TILE_ROWS = 16;

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
  return [c, c.getContext("2d")!] as const;
}

function toTexture(c: HTMLCanvasElement, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

const LIT = ["#ffd9a0", "#fff1cf", "#ffe3b0", "#ffcf8a", "#fff8e8", "#cfe4ff", "#ffb87a"];

const cache = new Map<FacadeKind, { day: THREE.CanvasTexture; night: THREE.CanvasTexture }>();

/** Day colour map (walls near white, so vertex colours tint them) + a matching lit-window emissive map. */
export function facadeTextures(kind: FacadeKind) {
  const hit = cache.get(kind);
  if (hit) return hit;
  const CW = 32;
  const CH = 32;
  const W = CW * TILE_COLS;
  const H = CH * TILE_ROWS;
  const [dc, d] = canvas(W, H);
  const [nc, n] = canvas(W, H);
  const r = rng(kind === "glass" ? 11 : kind === "office" ? 23 : 37);
  n.fillStyle = "#000";
  n.fillRect(0, 0, W, H);
  if (kind === "glass") {
    d.fillStyle = "#e4ebef";
    d.fillRect(0, 0, W, H);
  } else if (kind === "office") {
    d.fillStyle = "#f4f1ea";
    d.fillRect(0, 0, W, H);
  } else {
    d.fillStyle = "#f2efea";
    d.fillRect(0, 0, W, H);
    // faint mortar courses
    d.fillStyle = "rgba(0,0,0,0.07)";
    for (let y = 0; y < H; y += 4) d.fillRect(0, y, W, 1);
  }
  const litChance = kind === "glass" ? 0.42 : kind === "office" ? 0.38 : 0.34;
  for (let row = 0; row < TILE_ROWS; row++) {
    // whole floors of an office are often lit together
    const floorLit = r() < 0.18;
    for (let col = 0; col < TILE_COLS; col++) {
      const x0 = col * CW;
      const y0 = row * CH;
      let wx: number, wy: number, ww: number, wh: number;
      if (kind === "glass") {
        wx = x0 + 1;
        wy = y0 + 5;
        ww = CW - 2;
        wh = CH - 7;
      } else if (kind === "office") {
        wx = x0 + 5;
        wy = y0 + 8;
        ww = CW - 10;
        wh = CH - 13;
      } else {
        wx = x0 + 9;
        wy = y0 + 8;
        ww = CW - 18;
        wh = CH - 13;
      }
      const j = (r() - 0.5) * 18;
      if (kind === "glass") {
        const g = d.createLinearGradient(0, wy, 0, wy + wh);
        g.addColorStop(0, `rgb(${178 + j},${204 + j},${222 + j})`);
        g.addColorStop(1, `rgb(${86 + j},${118 + j},${146 + j})`);
        d.fillStyle = g;
        d.fillRect(wx, wy, ww, wh);
        d.fillStyle = "rgba(255,255,255,0.18)";
        d.fillRect(wx, wy, ww * 0.35, wh);
        d.fillStyle = "rgba(0,0,0,0.12)";
        d.fillRect(x0, y0 + 2, CW, 3); // spandrel between floors
      } else {
        d.fillStyle =
          kind === "office"
            ? `rgb(${80 + j},${100 + j},${120 + j})`
            : `rgb(${58 + j},${66 + j},${80 + j})`;
        d.fillRect(wx, wy, ww, wh);
        d.fillStyle = "rgba(255,255,255,0.22)";
        d.fillRect(wx, wy, ww, 2);
        d.fillStyle = "rgba(0,0,0,0.18)";
        d.fillRect(wx - 1, wy + wh, ww + 2, 2); // sill shadow
        if (kind === "brick" && r() < 0.35) {
          d.fillStyle = r() < 0.5 ? "rgba(230,210,170,0.55)" : "rgba(160,60,50,0.4)"; // curtains
          d.fillRect(wx, wy, ww, wh * (0.4 + r() * 0.5));
        }
      }
      const lit = floorLit ? r() < 0.8 : r() < litChance;
      if (lit) {
        n.fillStyle = LIT[Math.floor(r() * LIT.length)]!;
        n.globalAlpha = 0.65 + r() * 0.35;
        n.fillRect(wx, wy, ww, wh);
        n.globalAlpha = 1;
      } else if (kind === "glass") {
        n.fillStyle = "#070b12";
        n.fillRect(wx, wy, ww, wh);
      }
    }
  }
  const out = { day: toTexture(dc), night: toTexture(nc) };
  cache.set(kind, out);
  return out;
}

let adsTex: THREE.CanvasTexture | null = null;
/** 2x2 atlas of made-up billboard ads. */
export function adsTexture() {
  if (adsTex) return adsTex;
  const [c, g] = canvas(1024, 512);
  const ads: ((x: number, y: number) => void)[] = [
    (x, y) => {
      const gr = g.createLinearGradient(x, y, x, y + 256);
      gr.addColorStop(0, "#ff4fa0");
      gr.addColorStop(1, "#5a1a8a");
      g.fillStyle = gr;
      g.fillRect(x, y, 512, 256);
      g.fillStyle = "#ffe36a";
      g.beginPath();
      g.arc(x + 400, y + 150, 70, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#fff";
      g.font = "bold 84px sans-serif";
      g.fillText("VICE FM", x + 30, y + 120);
      g.font = "bold 54px sans-serif";
      g.fillText("98.3  RADIO", x + 34, y + 200);
    },
    (x, y) => {
      g.fillStyle = "#d8232a";
      g.fillRect(x, y, 512, 256);
      g.fillStyle = "#fff";
      g.beginPath();
      g.ellipse(x + 256, y + 128, 230, 70, -0.15, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#d8232a";
      g.font = "italic bold 92px sans-serif";
      g.fillText("ZAPP", x + 150, y + 160);
      g.fillStyle = "#fff";
      g.font = "bold 36px sans-serif";
      g.fillText("ICE COLD COLA", x + 140, y + 240);
    },
    (x, y) => {
      const gr = g.createLinearGradient(x, y, x, y + 256);
      gr.addColorStop(0, "#ffb347");
      gr.addColorStop(0.6, "#ff5e62");
      gr.addColorStop(1, "#6a2a6a");
      g.fillStyle = gr;
      g.fillRect(x, y, 512, 256);
      g.fillStyle = "rgba(255,255,255,0.25)";
      for (let i = 0; i < 5; i++) g.fillRect(x, y + 150 + i * 20, 512, 8);
      g.fillStyle = "#fff";
      g.font = "bold 70px sans-serif";
      g.fillText("SUNSET", x + 40, y + 95);
      g.fillText("MOTORS", x + 40, y + 170);
    },
    (x, y) => {
      g.fillStyle = "#127a78";
      g.fillRect(x, y, 512, 256);
      g.strokeStyle = "#f2c86a";
      g.lineWidth = 10;
      g.strokeRect(x + 16, y + 16, 480, 224);
      g.fillStyle = "#f2c86a";
      g.font = "bold 64px serif";
      g.fillText("GOLDEN PALM", x + 40, y + 120);
      g.font = "bold 40px serif";
      g.fillText("HOTEL & CASINO", x + 70, y + 190);
    },
  ];
  ads.forEach((draw, i) => draw((i % 2) * 512, Math.floor(i / 2) * 256));
  adsTex = toTexture(c, false);
  return adsTex;
}

let glowTex: THREE.CanvasTexture | null = null;
/** Soft radial falloff used for fake light pools on the ground. */
export function glowTexture() {
  if (glowTex) return glowTex;
  const [c, g] = canvas(128, 128);
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(0.4, "rgba(255,255,255,0.45)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  glowTex = toTexture(c, false);
  return glowTex;
}
