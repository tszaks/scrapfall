// Procedural textures for Pacific Pier: the sunset / night sky (background + reflections) and
// one sign atlas for every shop sign, neon word, closure notice and the pier arch.
import * as THREE from "three";

import { BEACH_LOOK, type BeachMode } from "./beachLook";

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d", { willReadFrequently: true })!] as const;
}
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const _a = new THREE.Color();
const _b = new THREE.Color();
/** sRGB-space colour mix into an [r, g, b] 0..255 triple */
function mixRGB(a: string, b: string, t: number): [number, number, number] {
  _a.set(a);
  _b.set(b);
  const ha = _a.getHex(THREE.SRGBColorSpace);
  const hb = _b.getHex(THREE.SRGBColorSpace);
  const k = Math.max(0, Math.min(1, t));
  const ch = (sh: number) => ((ha >> sh) & 255) * (1 - k) + ((hb >> sh) & 255) * k;
  return [ch(16), ch(8), ch(0)];
}
const sstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const skyCache: Partial<Record<BeachMode, THREE.CanvasTexture>> = {};

/**
 * Equirectangular sky (u = atan2(x, -z) / 2pi + 0.5, v = elevation). The horizon glows gold
 * towards the sun and fades to pink and violet away from it; streaky clouds are lit from below.
 */
export function beachSky(mode: BeachMode) {
  const hit = skyCache[mode];
  if (hit) return hit;
  const L = BEACH_LOOK[mode];
  const S = L.sky;
  const W = 2048;
  const H = 1024;
  const [c, g] = canvas(W, H);
  const img = g.createImageData(W, H);
  const [sx, sy, sz] = L.sunDir;
  const sunAz = Math.atan2(sx, -sz);
  const sunEl = Math.asin(sy);
  const night = mode === "night";
  const P = (hex: string) => mixRGB(hex, hex, 0);
  const cAway = P(S.horizonAway);
  const cSun = P(S.horizonSun);
  const cBand = P(S.band);
  const cMid = P(S.mid);
  const cZen = P(S.zenith);
  const cBelow = P(S.below);
  const cHalo = P(S.halo);
  // per column: how much each azimuth faces the sun
  const toSunCol = new Float32Array(W);
  const azCol = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    const az = ((x + 0.5) / W - 0.5) * Math.PI * 2;
    azCol[x] = az;
    let dAz = Math.abs(az - sunAz);
    if (dAz > Math.PI) dAz = Math.PI * 2 - dAz;
    toSunCol[x] = Math.pow(Math.max(0, Math.cos(dAz)), night ? 3 : 1.6);
  }
  const hor: [number, number, number] = [0, 0, 0];
  const band: [number, number, number] = [0, 0, 0];
  const mid: [number, number, number] = [0, 0, 0];
  const mixTo = (o: [number, number, number], a: [number, number, number], b: [number, number, number], t: number) => {
    o[0] = a[0] + (b[0] - a[0]) * t;
    o[1] = a[1] + (b[1] - a[1]) * t;
    o[2] = a[2] + (b[2] - a[2]) * t;
    return o;
  };
  const col: [number, number, number] = [0, 0, 0];
  for (let y = 0; y < H; y++) {
    const el = (0.5 - (y + 0.5) / H) * Math.PI; // radians
    const eD = (el * 180) / Math.PI;
    const cosEl = Math.cos(el);
    const sinEl = Math.sin(el);
    for (let x = 0; x < W; x++) {
      const toSun = toSunCol[x]!;
      mixTo(hor, cAway, cSun, toSun);
      if (eD < 0) {
        mixTo(col, hor, cBelow, sstep(0, 8, -eD));
      } else {
        // horizon -> band (4 deg) -> mid (26 deg) -> zenith
        mixTo(band, cBand, cSun, toSun * 0.55);
        mixTo(mid, cMid, cBand, toSun * 0.25 * (1 - sstep(10, 40, eD)));
        if (eD < 4) mixTo(col, hor, band, sstep(0, 4, eD));
        else if (eD < 26) mixTo(col, band, mid, sstep(4, 26, eD));
        else mixTo(col, mid, cZen, sstep(26, 80, eD));
      }
      // sun / moon halo on the sphere
      const cosA = cosEl * Math.cos(sunEl) * Math.cos(azCol[x]! - sunAz) + sinEl * Math.sin(sunEl);
      const ang = Math.acos(Math.max(-1, Math.min(1, cosA)));
      const hk = night ? Math.exp(-ang / 0.09) * 0.55 : Math.exp(-ang / 0.16) * 0.75 + Math.exp(-ang / 0.5) * 0.25;
      mixTo(col, col, cHalo, Math.min(1, hk) * (eD > -1 ? 1 : 0.4));
      const o = (y * W + x) * 4;
      img.data[o] = col[0];
      img.data[o + 1] = col[1];
      img.data[o + 2] = col[2];
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const u = (sunAz / (Math.PI * 2) + 0.5) * W;
  const v = (0.5 - sunEl / Math.PI) * H;
  const r = rng(night ? 71 : 29);
  // clouds: thin streaks, lit from underneath on the sun side
  const clouds = night ? 26 : 60;
  for (let k = 0; k < clouds; k++) {
    const cx = r() * W;
    const cy = H * (0.5 - (0.012 + Math.pow(r(), 1.6) * 0.12));
    const w = 60 + r() * 260;
    const h = 2 + r() * 6;
    let dAz = Math.abs((cx / W - 0.5) * Math.PI * 2 - sunAz);
    if (dAz > Math.PI) dAz = Math.PI * 2 - dAz;
    const lit = Math.pow(Math.max(0, Math.cos(dAz)), 1.2);
    const [cr, cg, cb] = mixRGB(S.clouds, S.cloudLit, lit * 0.9 + 0.1);
    const cgr = g.createRadialGradient(cx, cy, 0, cx, cy, w);
    const a = night ? 0.35 : 0.55 + r() * 0.3;
    cgr.addColorStop(0, `rgba(${cr | 0},${cg | 0},${cb | 0},${a.toFixed(2)})`);
    cgr.addColorStop(1, `rgba(${cr | 0},${cg | 0},${cb | 0},0)`);
    g.save();
    g.translate(cx, cy);
    g.scale(1, h / w);
    g.translate(-cx, -cy);
    g.fillStyle = cgr;
    g.fillRect(cx - w, cy - w, w * 2, w * 2);
    g.restore();
  }
  // the disc
  const discR = night ? 7 : 9;
  const dg = g.createRadialGradient(u, v, 0, u, v, discR * 1.6);
  dg.addColorStop(0, S.disc);
  dg.addColorStop(0.62, S.disc);
  dg.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = dg;
  g.fillRect(u - discR * 2, v - discR * 2, discR * 4, discR * 4);
  if (night) {
    // faint town glow along the eastern horizon
    const eastU = ((Math.atan2(1, 0) / (Math.PI * 2)) + 0.5) * W;
    const tg = g.createRadialGradient(eastU, H * 0.5, 0, eastU, H * 0.5, W * 0.22);
    tg.addColorStop(0, "rgba(150,100,70,0.35)");
    tg.addColorStop(1, "rgba(150,100,70,0)");
    g.save();
    g.translate(eastU, H * 0.5);
    g.scale(1, 0.12);
    g.translate(-eastU, -H * 0.5);
    g.fillStyle = tg;
    g.fillRect(eastU - W * 0.25, H * 0.5 - W * 0.25, W * 0.5, W * 0.5);
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.needsUpdate = true;
  skyCache[mode] = t;
  return t;
}

// ---------------------------------------------------------------------------------------
// sign atlas: 4 x 8 tiles of 256 x 128 px

export const BEACH_WORDS = [
  "TACOS",
  "SURF SHOP",
  "MOTEL",
  "T-SHIRTS",
  "SUNGLASSES",
  "ICE CREAM",
  "CAFE",
  "SMOOTHIES",
  "ARCADE",
  "HOTEL",
  "LIFEGUARD",
  "BIKE RENTAL",
  "SURF RENTAL",
  "WEST COASTER",
  "GAMES",
  "CORN DOGS",
  "BAIT & TACKLE",
  "SEAFOOD",
  "BEACH CLOSED",
  "ROAD CLOSED",
  "BOARDWALK CLOSED",
  "PARK CLOSED",
  "END OF THE TRAIL",
  "MUSCLE BEACH",
  "SKATE PARK",
  "PACIFIC PIER",
  "VACANCY",
  "OPEN",
  "COCKTAILS",
  "PIZZA",
  "FISH TACOS",
  "KEEP OUT",
] as const;
export const W = Object.fromEntries(BEACH_WORDS.map((w, i) => [w, i])) as Record<(typeof BEACH_WORDS)[number], number>;
/** closure notices by blockade label */
export const CLOSED_WORD = [W["BEACH CLOSED"], W["ROAD CLOSED"], W["BOARDWALK CLOSED"], W["PARK CLOSED"]];

/** uv rect [u0, v0, u1, v1] of a word tile */
export function beachWordUV(i: number) {
  const col = i % 4;
  const row = Math.floor(i / 4);
  const v1 = 1 - row * 0.125;
  return [col / 4, v1 - 0.125, (col + 1) / 4, v1] as const;
}

let signTex: THREE.CanvasTexture | null = null;
export function beachSignTexture() {
  if (signTex) return signTex;
  const [c, g] = canvas(1024, 1024);
  const neon = ["#ff4fa0", "#3affd8", "#ffe14a", "#ff7a3a", "#9a6aff", "#4fd0ff", "#ff3a3a", "#7cff6a"];
  BEACH_WORDS.forEach((w, i) => {
    const x = (i % 4) * 256;
    const y = Math.floor(i / 4) * 128;
    g.save();
    g.textAlign = "center";
    g.textBaseline = "middle";
    const closure = i >= W["BEACH CLOSED"] && i <= W["PARK CLOSED"];
    if (closure || w === "KEEP OUT") {
      // municipal notice: white board, red band, black letters
      g.fillStyle = "#f4f2ea";
      g.fillRect(x + 4, y + 4, 248, 120);
      g.fillStyle = "#c8201a";
      g.fillRect(x + 4, y + 4, 248, 30);
      g.fillStyle = "#fff";
      g.font = "bold 22px sans-serif";
      g.fillText("CITY OF PACIFIC", x + 128, y + 20);
      g.fillStyle = "#15120e";
      g.font = `bold ${w.length > 12 ? 30 : 38}px sans-serif`;
      g.fillText(w, x + 128, y + 80);
    } else if (w === "PACIFIC PIER") {
      // the arch: blue with gold letters and a bulb border
      g.fillStyle = "#12418a";
      g.fillRect(x, y, 256, 128);
      g.strokeStyle = "#f2c64a";
      g.lineWidth = 6;
      g.strokeRect(x + 7, y + 7, 242, 114);
      g.fillStyle = "#f2c64a";
      g.shadowColor = "#ffdc7a";
      g.shadowBlur = 10;
      g.font = "bold 44px serif";
      g.fillText("PACIFIC PIER", x + 128, y + 56);
      g.font = "bold 18px sans-serif";
      g.fillText("SPORT FISHING · BOATING · CAFES", x + 128, y + 96);
      g.shadowBlur = 0;
      for (let k = 0; k < 16; k++) {
        g.fillStyle = "#fff4c8";
        g.beginPath();
        g.arc(x + 12 + k * 15.5, y + 118, 2.6, 0, Math.PI * 2);
        g.fill();
      }
    } else if (w === "END OF THE TRAIL") {
      g.fillStyle = "#f4f2ea";
      g.fillRect(x + 4, y + 4, 248, 120);
      g.strokeStyle = "#15120e";
      g.lineWidth = 4;
      g.strokeRect(x + 10, y + 10, 236, 108);
      g.fillStyle = "#15120e";
      g.font = "bold 26px serif";
      g.fillText("SANTA MONICA", x + 128, y + 34);
      g.font = "bold 20px serif";
      g.fillText("66 · END OF THE TRAIL", x + 128, y + 70);
      g.font = "14px serif";
      g.fillText("HISTORIC ROUTE", x + 128, y + 100);
    } else {
      g.fillStyle = "#15121a";
      g.fillRect(x, y, 256, 128);
      const col = neon[i % neon.length]!;
      g.strokeStyle = col;
      g.lineWidth = 5;
      g.strokeRect(x + 8, y + 8, 240, 112);
      g.fillStyle = col;
      g.shadowColor = col;
      g.shadowBlur = 14;
      g.font = `bold ${w.length > 10 ? 32 : w.length > 6 ? 42 : 58}px sans-serif`;
      g.fillText(w, x + 128, y + 66);
      g.shadowBlur = 0;
    }
    g.restore();
  });
  signTex = new THREE.CanvasTexture(c);
  signTex.colorSpace = THREE.SRGBColorSpace;
  signTex.anisotropy = 4;
  signTex.needsUpdate = true;
  return signTex;
}
