// Procedural textures for the city map. Built once, lazily, in the browser.
//
// Every facade style lives in ONE texture array (one layer per style), so a whole city
// chunk - glass towers, brick walk-ups, storefronts, parking decks, even the asphalt -
// draws with a single material. Each layer tile is 8 window modules wide and 16 storeys
// tall; geometry UVs count modules and storeys, so windows always land on real floors.
//   day   RGB = albedo (walls near white, vertex colours tint them), A = glass (reflectivity)
//   night RGB = lit-window colour,                                  A = window mask
import * as THREE from "three";
import { drain, runSliced } from "./slice";

export const TILE_COLS = 8;
export const TILE_ROWS = 16;
const CW = 32;
const CH = 32;
const TW = CW * TILE_COLS;
const TH = CH * TILE_ROWS;

/** facade layers in the texture array */
export const L = {
  plain: 0,
  glass: 1,
  ribbon: 2,
  office: 3,
  brick: 4,
  resid: 5,
  store: 6,
  dark: 7,
  garage: 8,
  warehouse: 9,
  stone: 10,
  deco: 11,
  panel: 12,
  ground: 13,
  paving: 14,
} as const;
export type Layer = (typeof L)[keyof typeof L];
const LAYERS = 15;
export const FACADE_LAYERS = LAYERS;
/** rooms behind the windows (interiors.ts), per layer: -1 none, 0 offices, 1 homes, 2 shops */
const ROOM_CATS: Record<number, number> = {
  [L.glass]: 0,
  [L.ribbon]: 0,
  [L.office]: 0,
  [L.dark]: 0,
  [L.panel]: 0,
  [L.brick]: 1,
  [L.resid]: 1,
  [L.stone]: 1,
  [L.deco]: 1,
  [L.store]: 2,
};
/** GLSL array literals: room category and window modules per room, per facade layer */
export const ROOM_CAT = Array.from({ length: LAYERS }, (_, i) =>
  (ROOM_CATS[i] ?? -1).toFixed(1),
).join(", ");
export const ROOM_SPAN = Array.from({ length: LAYERS }, (_, i) =>
  i === L.glass || i === L.dark ? "2.0" : "1.0",
).join(", ");
/** real-world width of one window module per layer, metres */
export const MODULE_W: Record<number, number> = {
  [L.plain]: 3,
  [L.glass]: 1.5,
  [L.ribbon]: 3,
  [L.office]: 2.4,
  [L.brick]: 2.2,
  [L.resid]: 3,
  [L.store]: 4.5,
  [L.dark]: 1.5,
  [L.garage]: 6,
  [L.warehouse]: 4,
  [L.stone]: 4,
  [L.deco]: 2.6,
  [L.panel]: 3,
  [L.ground]: 3,
  [L.paving]: 1.5,
};

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

function toTexture(c: HTMLCanvasElement, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

const LIT = [
  "#ffd9a0",
  "#fff1cf",
  "#ffe3b0",
  "#ffcf8a",
  "#fff8e8",
  "#dcebff",
  "#ffc27a",
  "#f4f8ff",
];
const OFFICE_LIT = ["#dfe8f4", "#d4def0", "#f2e6cc", "#c8d6ec", "#efe2c4", "#f6d8a8"];

type Ctx = CanvasRenderingContext2D;
type Painter = {
  /** albedo */
  d: Ctx;
  /** glass mask (white = glass) */
  g: Ctx;
  /** lit-window colour */
  n: Ctx;
  /** window mask (white = a window that can light up) */
  m: Ctx;
  r: () => number;
};

const rect = (
  c: Ctx,
  style: string | CanvasGradient,
  x: number,
  y: number,
  w: number,
  h: number,
) => {
  c.fillStyle = style;
  c.fillRect(x, y, w, h);
};

/** a window pane: albedo, glass mask, window mask and (maybe) a lit colour */
function pane(
  P: Painter,
  x: number,
  y: number,
  w: number,
  h: number,
  albedo: string | CanvasGradient,
  glass: number,
  lit: number,
  palette = LIT,
) {
  rect(P.d, albedo, x, y, w, h);
  rect(P.g, `rgb(${glass},${glass},${glass})`, x, y, w, h);
  rect(P.m, "#fff", x, y, w, h);
  if (P.r() < lit) {
    P.n.globalAlpha = 0.7 + P.r() * 0.3;
    rect(P.n, palette[Math.floor(P.r() * palette.length)]!, x, y, w, h);
    P.n.globalAlpha = 1;
    const blind = P.r();
    if (blind < 0.25) rect(P.n, "#000", x, y, w, h * (0.25 + P.r() * 0.5));
    else if (blind < 0.35) {
      P.n.globalAlpha = 0.55;
      for (let yy = y; yy < y + h; yy += 3) rect(P.n, "#000", x, yy, w, 1);
      P.n.globalAlpha = 1;
    }
  }
}

const glassGrad = (c: Ctx, y: number, h: number, j: number, hi = 205, lo = 120) => {
  const g = c.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, `rgb(${hi + j},${hi + 12 + j},${hi + 20 + j})`);
  g.addColorStop(1, `rgb(${lo + j},${lo + 16 + j},${lo + 30 + j})`);
  return g;
};

/** per-layer painters: fill one 8 x 16 tile */
const PAINT: Record<number, (P: Painter) => void> = {
  [L.plain]: (P) => rect(P.d, "#fff", 0, 0, TW, TH),
  [L.glass]: (P) => {
    rect(P.d, "#d6dde2", 0, 0, TW, TH);
    rect(P.g, "#303030", 0, 0, TW, TH);
    for (let row = 0; row < TILE_ROWS; row++) {
      const floorLit = P.r() < 0.5 ? 0.12 : 0.55;
      for (let col = 0; col < TILE_COLS; col++) {
        const x0 = col * CW;
        const y0 = row * CH;
        const j = (P.r() - 0.5) * 14;
        pane(
          P,
          x0 + 1,
          y0 + 1,
          CW - 2,
          CH - 5,
          glassGrad(P.d, y0, CH - 5, j, 190, 125),
          255,
          floorLit,
          OFFICE_LIT,
        );
        rect(P.d, "rgba(255,255,255,0.10)", x0 + 1, y0 + 1, (CW - 2) * 0.3, CH - 5);
        rect(P.d, "#9aa6ae", x0, y0 + CH - 4, CW, 4); // slim spandrel at the slab
        rect(P.g, "#606060", x0, y0 + CH - 4, CW, 4);
      }
    }
  },
  [L.ribbon]: (P) => {
    rect(P.d, "#ebe8e2", 0, 0, TW, TH);
    for (let row = 0; row < TILE_ROWS; row++) {
      const lit = P.r() < 0.5 ? 0.15 : 0.6;
      for (let col = 0; col < TILE_COLS; col++) {
        const x0 = col * CW;
        const y0 = row * CH;
        const j = (P.r() - 0.5) * 10;
        pane(
          P,
          x0,
          y0 + 9,
          CW - 1,
          CH - 18,
          glassGrad(P.d, y0 + 9, CH - 18, j, 150, 90),
          235,
          lit,
          OFFICE_LIT,
        );
        rect(P.d, "#8a939a", x0 + CW - 1, y0 + 9, 1, CH - 18); // mullion
        rect(P.d, "rgba(0,0,0,0.12)", x0, y0 + CH - 9, CW, 2);
      }
    }
  },
  [L.office]: (P) => {
    rect(P.d, "#f0ede6", 0, 0, TW, TH);
    for (let row = 0; row < TILE_ROWS; row++) {
      const lit = P.r() < 0.5 ? 0.12 : 0.5;
      for (let col = 0; col < TILE_COLS; col++) {
        const x0 = col * CW;
        const y0 = row * CH;
        const j = (P.r() - 0.5) * 16;
        rect(P.d, "rgba(0,0,0,0.16)", x0 + 5, y0 + 6, CW - 10, CH - 12); // reveal
        pane(
          P,
          x0 + 6,
          y0 + 7,
          CW - 12,
          CH - 14,
          glassGrad(P.d, y0 + 7, CH - 14, j, 120, 70),
          170,
          lit,
          OFFICE_LIT,
        );
        rect(P.d, "rgba(255,255,255,0.35)", x0 + 5, y0 + CH - 7, CW - 10, 2); // sill
        rect(P.d, "rgba(0,0,0,0.08)", x0, y0 + CH - 2, CW, 2);
      }
    }
  },
  [L.brick]: (P) => {
    rect(P.d, "#f2ede6", 0, 0, TW, TH);
    // brick courses: mortar lines + staggered joints, a little per-brick tone
    for (let y = 0; y < TH; y += 4) {
      rect(P.d, "rgba(60,40,30,0.16)", 0, y, TW, 1);
      for (let x = (y / 4) % 2 ? 0 : 4; x < TW; x += 8) {
        rect(P.d, "rgba(60,40,30,0.14)", x, y, 1, 4);
        rect(
          P.d,
          `rgba(${P.r() < 0.5 ? "0,0,0" : "255,255,255"},${(P.r() * 0.07).toFixed(3)})`,
          x + 1,
          y + 1,
          7,
          3,
        );
      }
    }
    for (let row = 0; row < TILE_ROWS; row++) {
      for (let col = 0; col < TILE_COLS; col++) {
        const x0 = col * CW;
        const y0 = row * CH;
        const j = (P.r() - 0.5) * 18;
        rect(P.d, "#e8e2d6", x0 + 7, y0 + 3, CW - 14, 3); // stone lintel
        rect(P.d, "#f6f4ee", x0 + 8, y0 + 6, CW - 16, CH - 11); // white frame
        pane(P, x0 + 10, y0 + 8, CW - 20, CH - 15, `rgb(${56 + j},${64 + j},${76 + j})`, 110, 0.36);
        rect(P.d, "#f6f4ee", x0 + 10, y0 + 15, CW - 20, 1); // sash
        if (P.r() < 0.4)
          rect(
            P.d,
            P.r() < 0.5 ? "rgba(230,210,170,0.6)" : "rgba(170,70,60,0.45)",
            x0 + 10,
            y0 + 8,
            CW - 20,
            (CH - 15) * (0.3 + P.r() * 0.5),
          );
        rect(P.d, "#e2dccf", x0 + 7, y0 + CH - 5, CW - 14, 2); // sill
      }
    }
  },
  [L.resid]: (P) => {
    rect(P.d, "#f5f2eb", 0, 0, TW, TH);
    for (let row = 0; row < TILE_ROWS; row++) {
      for (let col = 0; col < TILE_COLS; col++) {
        const x0 = col * CW;
        const y0 = row * CH;
        const j = (P.r() - 0.5) * 18;
        if (col % 2 === 0) {
          // balcony door: full-height glass
          rect(P.d, "rgba(0,0,0,0.12)", x0 + 6, y0 + 4, CW - 12, CH - 4);
          pane(
            P,
            x0 + 7,
            y0 + 5,
            CW - 14,
            CH - 6,
            glassGrad(P.d, y0 + 5, CH - 6, j, 130, 80),
            150,
            0.32,
          );
        } else {
          rect(P.d, "rgba(0,0,0,0.12)", x0 + 8, y0 + 8, CW - 16, CH - 16);
          pane(
            P,
            x0 + 9,
            y0 + 9,
            CW - 18,
            CH - 18,
            glassGrad(P.d, y0 + 9, CH - 18, j, 130, 80),
            150,
            0.3,
          );
          if (P.r() < 0.45)
            rect(P.d, "rgba(235,220,190,0.6)", x0 + 9, y0 + 9, CW - 18, (CH - 18) * 0.5);
        }
      }
    }
  },
  [L.store]: (P) => {
    rect(P.d, "#e9e5dc", 0, 0, TW, TH);
    for (let row = 0; row < TILE_ROWS; row++) {
      for (let col = 0; col < TILE_COLS; col++) {
        const x0 = col * CW;
        const y0 = row * CH;
        const j = (P.r() - 0.5) * 20;
        rect(P.d, "#3a3a3c", x0, y0, CW, 6); // sign fascia
        rect(P.d, "#2e3034", x0 + 1, y0 + 7, CW - 2, CH - 9); // frame
        const door = col % 4 === 1;
        if (door) {
          pane(P, x0 + 3, y0 + 8, CW - 6, 5, glassGrad(P.d, y0 + 8, 5, j, 150, 110), 200, 0.8);
          pane(P, x0 + 10, y0 + 14, 12, CH - 16, `rgb(${40 + j},${48 + j},${56 + j})`, 200, 0.75);
          rect(P.d, "#c8ccd0", x0 + 19, y0 + 22, 1, 4);
          rect(P.d, "#2e3034", x0 + 3, y0 + 14, 7, CH - 16);
          rect(P.d, "#2e3034", x0 + 22, y0 + 14, 7, CH - 16);
        } else {
          pane(
            P,
            x0 + 3,
            y0 + 8,
            CW - 6,
            CH - 13,
            glassGrad(P.d, y0 + 8, CH - 13, j, 175, 95),
            210,
            0.82,
          );
          rect(P.d, "rgba(255,255,255,0.18)", x0 + 3, y0 + 8, (CW - 6) * 0.35, CH - 13);
        }
        rect(P.d, "#26282a", x0, y0 + CH - 3, CW, 3); // kick plate
      }
    }
  },
  [L.dark]: (P) => {
    rect(P.d, "#8a7a62", 0, 0, TW, TH);
    for (let row = 0; row < TILE_ROWS; row++) {
      const lit = P.r() < 0.5 ? 0.08 : 0.45;
      for (let col = 0; col < TILE_COLS; col++) {
        const x0 = col * CW;
        const y0 = row * CH;
        const j = (P.r() - 0.5) * 8;
        pane(
          P,
          x0 + 1,
          y0 + 1,
          CW - 2,
          CH - 4,
          glassGrad(P.d, y0, CH - 4, j, 70, 38),
          255,
          lit,
          OFFICE_LIT,
        );
      }
    }
  },
  [L.garage]: (P) => {
    rect(P.d, "#d9d6cf", 0, 0, TW, TH);
    for (let row = 0; row < TILE_ROWS; row++) {
      for (let col = 0; col < TILE_COLS; col++) {
        const x0 = col * CW;
        const y0 = row * CH;
        rect(P.d, "#1d1f22", x0, y0 + 7, CW, 14); // open deck
        rect(P.d, "#2a2c30", x0, y0 + 16, CW, 5);
        rect(P.d, "#cfccc4", x0, y0 + 7, 3, 14); // column
        rect(P.m, "#fff", x0 + 3, y0 + 7, CW - 3, 14);
        rect(P.n, P.r() < 0.8 ? "#8a6a3a" : "#5a4a30", x0 + 3, y0 + 7, CW - 3, 14);
        rect(P.d, "rgba(0,0,0,0.15)", x0, y0 + 21, CW, 2);
      }
    }
  },
  [L.warehouse]: (P) => {
    rect(P.d, "#e6e4df", 0, 0, TW, TH);
    for (let x = 0; x < TW; x += 4)
      rect(P.d, x % 8 ? "rgba(0,0,0,0.10)" : "rgba(255,255,255,0.25)", x, 0, 2, TH);
    for (let row = 0; row < TILE_ROWS; row += 2) {
      for (let col = 0; col < TILE_COLS; col++) {
        const x0 = col * CW;
        const y0 = row * CH;
        pane(P, x0 + 6, y0 + 4, CW - 12, 7, "#5a6670", 80, 0.25);
      }
    }
  },
  [L.stone]: (P) => {
    rect(P.d, "#f1ece2", 0, 0, TW, TH);
    for (let y = 0; y < TH; y += 8) {
      rect(P.d, "rgba(70,60,40,0.14)", 0, y, TW, 1);
      for (let x = (y / 8) % 2 ? 0 : 8; x < TW; x += 16)
        rect(P.d, "rgba(70,60,40,0.12)", x, y, 1, 8);
    }
    for (let row = 0; row < TILE_ROWS; row++) {
      for (let col = 0; col < TILE_COLS; col++) {
        const x0 = col * CW;
        const y0 = row * CH;
        const j = (P.r() - 0.5) * 12;
        // tall arched window with a keystone
        P.d.fillStyle = "rgba(0,0,0,0.14)";
        P.d.beginPath();
        P.d.moveTo(x0 + 9, y0 + CH - 3);
        P.d.lineTo(x0 + 9, y0 + 12);
        P.d.arc(x0 + 16, y0 + 12, 7, Math.PI, 0);
        P.d.lineTo(x0 + 23, y0 + CH - 3);
        P.d.fill();
        pane(P, x0 + 10, y0 + 12, 12, CH - 16, `rgb(${60 + j},${68 + j},${78 + j})`, 90, 0.3);
        rect(P.d, "#faf6ee", x0 + 15, y0 + 3, 2, 3);
        rect(P.d, "#e4dccb", x0 + 8, y0 + CH - 3, 16, 2);
      }
    }
  },
  [L.deco]: (P) => {
    rect(P.d, "#f4f0e8", 0, 0, TW, TH);
    for (let row = 0; row < TILE_ROWS; row++) {
      for (let col = 0; col < TILE_COLS; col++) {
        const x0 = col * CW;
        const y0 = row * CH;
        const j = (P.r() - 0.5) * 14;
        rect(P.d, "#ffffff", x0, y0, 3, CH); // pier highlight
        rect(P.d, "rgba(0,0,0,0.12)", x0 + 7, y0, 2, CH); // pier shadow
        pane(
          P,
          x0 + 10,
          y0 + 3,
          CW - 12,
          CH - 12,
          glassGrad(P.d, y0 + 3, CH - 12, j, 110, 70),
          150,
          0.34,
        );
        rect(P.d, "rgba(0,0,0,0.18)", x0 + 10, y0 + CH - 9, CW - 12, 7); // spandrel panel
        rect(P.d, "rgba(255,255,255,0.3)", x0 + 13, y0 + CH - 7, CW - 18, 1);
        rect(P.d, "rgba(255,255,255,0.3)", x0 + 13, y0 + CH - 4, CW - 18, 1);
      }
    }
  },
  [L.panel]: (P) => {
    rect(P.d, "#ece9e2", 0, 0, TW, TH);
    for (let row = 0; row < TILE_ROWS; row++) {
      for (let col = 0; col < TILE_COLS; col++) {
        const x0 = col * CW;
        const y0 = row * CH;
        const j = (P.r() - 0.5) * 14;
        rect(P.d, "rgba(0,0,0,0.13)", x0, y0 + CH - 1, CW, 1);
        rect(P.d, "rgba(0,0,0,0.10)", x0 + CW - 1, y0, 1, CH);
        rect(P.d, `rgba(0,0,0,${(P.r() * 0.05).toFixed(3)})`, x0, y0, CW - 1, CH - 1);
        pane(
          P,
          x0 + 9,
          y0 + 9,
          CW - 18,
          CH - 17,
          `rgb(${70 + j},${80 + j},${92 + j})`,
          150,
          0.3,
          OFFICE_LIT,
        );
      }
    }
  },
  [L.ground]: (P) => {
    const img = P.d.createImageData(TW, TH);
    for (let k = 0; k < TW * TH; k++) {
      const v = 214 + (P.r() - 0.5) * 34 + (P.r() < 0.02 ? 30 : 0);
      img.data[k * 4] = img.data[k * 4 + 1] = img.data[k * 4 + 2] = Math.max(0, Math.min(255, v));
      img.data[k * 4 + 3] = 255;
    }
    P.d.putImageData(img, 0, 0);
    // soft blotches (patches, stains)
    for (let k = 0; k < 40; k++) {
      P.d.fillStyle = `rgba(${P.r() < 0.5 ? "0,0,0" : "255,255,255"},0.025)`;
      P.d.beginPath();
      P.d.arc(P.r() * TW, P.r() * TH, 6 + P.r() * 30, 0, Math.PI * 2);
      P.d.fill();
    }
  },
};

// paving slabs: one 32 px cell per slab, thin joints, a little tone per slab
PAINT[L.paving] = (P) => {
  const img = P.d.createImageData(TW, TH);
  for (let k = 0; k < TW * TH; k++) {
    const v = 226 + (P.r() - 0.5) * 22;
    img.data[k * 4] = img.data[k * 4 + 1] = img.data[k * 4 + 2] = v;
    img.data[k * 4 + 3] = 255;
  }
  P.d.putImageData(img, 0, 0);
  for (let row = 0; row < TILE_ROWS; row++)
    for (let col = 0; col < TILE_COLS; col++) {
      const x0 = col * CW;
      const y0 = row * CH;
      rect(
        P.d,
        `rgba(${P.r() < 0.5 ? "0,0,0" : "255,255,255"},${(P.r() * 0.06).toFixed(3)})`,
        x0,
        y0,
        CW,
        CH,
      );
      rect(P.d, "rgba(40,36,30,0.28)", x0, y0, CW, 1);
      rect(P.d, "rgba(40,36,30,0.28)", x0, y0, 1, CH);
      if (P.r() < 0.06)
        rect(P.d, "rgba(0,0,0,0.08)", x0 + 4 + P.r() * 16, y0 + 4 + P.r() * 16, 6, 5); // gum / stain
    }
};

let facadeArr: { day: THREE.DataArrayTexture; night: THREE.DataArrayTexture } | null = null;

/** The facade texture arrays (built once). */
function* bakeFacadeArrays(): Generator<
  void,
  { day: THREE.DataArrayTexture; night: THREE.DataArrayTexture },
  void
> {
  if (facadeArr) return facadeArr;
  const day = new Uint8Array(TW * TH * 4 * LAYERS);
  const night = new Uint8Array(TW * TH * 4 * LAYERS);
  const [, d] = canvas(TW, TH);
  const [, g] = canvas(TW, TH);
  const [, n] = canvas(TW, TH);
  const [, m] = canvas(TW, TH);
  for (let layer = 0; layer < LAYERS; layer++) {
    yield;
    rect(d, "#fff", 0, 0, TW, TH);
    rect(g, "#000", 0, 0, TW, TH);
    rect(n, "#000", 0, 0, TW, TH);
    rect(m, "#000", 0, 0, TW, TH);
    PAINT[layer]?.({ d, g, n, m, r: rng(101 + layer * 7919) });
    const D = d.getImageData(0, 0, TW, TH).data;
    const G = g.getImageData(0, 0, TW, TH).data;
    const Nn = n.getImageData(0, 0, TW, TH).data;
    const M = m.getImageData(0, 0, TW, TH).data;
    const off = layer * TW * TH * 4;
    // canvas row 0 is the top; texture row 0 is the bottom (v = 0)
    for (let y = 0; y < TH; y++) {
      const src = (TH - 1 - y) * TW * 4;
      const dst = off + y * TW * 4;
      for (let x = 0; x < TW * 4; x += 4) {
        day[dst + x] = D[src + x]!;
        day[dst + x + 1] = D[src + x + 1]!;
        day[dst + x + 2] = D[src + x + 2]!;
        day[dst + x + 3] = G[src + x]!;
        night[dst + x] = Nn[src + x]!;
        night[dst + x + 1] = Nn[src + x + 1]!;
        night[dst + x + 2] = Nn[src + x + 2]!;
        night[dst + x + 3] = M[src + x]!;
      }
    }
  }
  const make = (data: Uint8Array, srgb: boolean) => {
    const t = new THREE.DataArrayTexture(data, TW, TH, LAYERS);
    t.format = THREE.RGBAFormat;
    t.type = THREE.UnsignedByteType;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 8;
    // the alpha channels are masks, so the colour space only applies to RGB
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  facadeArr = { day: make(day, true), night: make(night, true) };
  return facadeArr;
}
export function facadeArrays() {
  return (facadeArr ??= drain(bakeFacadeArrays()));
}
/** the world build bakes the atlas across tasks; the scene's call is then a hit */
export async function prepareFacadeArrays(): Promise<void> {
  facadeArr ??= await runSliced(bakeFacadeArrays());
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

let signTex: THREE.CanvasTexture | null = null;
export const SIGN_WORDS = [
  "DINER",
  "HOTEL",
  "GAS",
  "PHARMACY",
  "PIZZA",
  "BAR",
  "LIQUOR",
  "DELI",
  "CAFE",
  "PAWN",
  "TATTOO",
  "NAILS",
  "VIDEO",
  "BANK",
  "SUSHI",
  "OPEN",
];
export const W_DINER = 0;
export const W_HOTEL = 1;
export const W_GAS = 2;
/** uv rect [u0, v0, u1, v1] of a sign word in the sign atlas */
export function wordUV(i: number) {
  const col = i % 4;
  const row = Math.floor(i / 4);
  const v1 = 1 - row * 0.125;
  return [col / 4, v1 - 0.125, (col + 1) / 4, v1] as const;
}
/** uv rect of a billboard ad in the sign atlas */
export function adUV(k: number) {
  const col = k % 2;
  const row = Math.floor(k / 2) % 2;
  const v1 = 0.5 - row * 0.25;
  return [col * 0.5, v1 - 0.25, col * 0.5 + 0.5, v1] as const;
}
/** One atlas for every sign in the city: 16 shop / neon words on top, 4 billboard ads below. */
export function signTexture() {
  if (signTex) return signTex;
  const [c, g] = canvas(1024, 1024);
  const cols = [
    "#ff4fa0",
    "#3affd8",
    "#ffe14a",
    "#ff7a3a",
    "#9a6aff",
    "#4fd0ff",
    "#ff3a3a",
    "#7cff6a",
  ];
  SIGN_WORDS.forEach((w, i) => {
    const x = (i % 4) * 256;
    const y = Math.floor(i / 4) * 128;
    g.fillStyle = "#15121a";
    g.fillRect(x, y, 256, 128);
    const col = cols[i % cols.length]!;
    g.strokeStyle = col;
    g.lineWidth = 6;
    g.strokeRect(x + 8, y + 8, 240, 112);
    g.fillStyle = col;
    g.shadowColor = col;
    g.shadowBlur = 12;
    g.font = `bold ${w.length > 6 ? 40 : 58}px sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(w, x + 128, y + 66);
    g.shadowBlur = 0;
  });
  const ads = adsTexture().image as HTMLCanvasElement;
  g.drawImage(ads, 0, 512, 1024, 512);
  signTex = toTexture(c, false);
  signTex.anisotropy = 4;
  return signTex;
}
