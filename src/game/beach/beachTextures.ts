// Pacific Pier's sign atlas: every shop sign, neon word, closure notice and the pier arch.
// (The sky comes from sky.ts, painted from the map's own sunset palette in beachLook.ts.)
import * as THREE from "three";

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d", { willReadFrequently: true })!] as const;
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
export const W = Object.fromEntries(BEACH_WORDS.map((w, i) => [w, i])) as Record<
  (typeof BEACH_WORDS)[number],
  number
>;
/** closure notices by blockade label */
export const CLOSED_WORD = [
  W["BEACH CLOSED"],
  W["ROAD CLOSED"],
  W["BOARDWALK CLOSED"],
  W["PARK CLOSED"],
];

/** uv rect [u0, v0, u1, v1] of a word tile */
export function beachWordUV(i: number) {
  const col = i % 4;
  const row = Math.floor(i / 4);
  const v1 = 1 - row * 0.125;
  return [col / 4, v1 - 0.125, (col + 1) / 4, v1] as const;
}

let signTex: THREE.CanvasTexture | null = null;
/** draw centred text, squeezed horizontally if it would overflow `maxW` pixels */
function fit(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number) {
  const w = g.measureText(text).width;
  if (w <= maxW) {
    g.fillText(text, x, y);
    return;
  }
  g.save();
  g.translate(x, y);
  g.scale(maxW / w, 1);
  g.fillText(text, 0, 0);
  g.restore();
}

export function beachSignTexture() {
  if (signTex) return signTex;
  const [c, g] = canvas(1024, 1024);
  const neon = [
    "#ff4fa0",
    "#3affd8",
    "#ffe14a",
    "#ff7a3a",
    "#9a6aff",
    "#4fd0ff",
    "#ff3a3a",
    "#7cff6a",
  ];
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
      fit(g, "CITY OF PACIFIC", x + 128, y + 20, 228);
      g.fillStyle = "#15120e";
      g.font = `bold ${w.length > 12 ? 30 : 38}px sans-serif`;
      fit(g, w, x + 128, y + 80, 228);
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
      fit(g, "PACIFIC PIER", x + 128, y + 56, 228);
      g.font = "bold 18px sans-serif";
      fit(g, "SPORT FISHING · BOATING · CAFES", x + 128, y + 96, 228);
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
      fit(g, "PACIFIC PIER", x + 128, y + 34, 228);
      g.font = "bold 20px serif";
      fit(g, "66 · END OF THE TRAIL", x + 128, y + 70, 228);
      g.font = "14px serif";
      fit(g, "HISTORIC ROUTE", x + 128, y + 100, 228);
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
      fit(g, w, x + 128, y + 66, 228);
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
