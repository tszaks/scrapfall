// Rooms behind windows: interior mapping (a parallax "fake room" per window, after Joost van
// Dongen's interior mapping). Nothing is modelled: the fragment shader traces the view ray
// through an imaginary box behind the glass (back wall, side walls, floor, ceiling, plus one
// furniture card standing in the room) and looks the hit up in a small room atlas that is
// painted here, procedurally, the first time it's needed.
//
// Reusable by any material with window cells in its UVs: call `addInteriorUniforms(shader)`,
// paste `INTERIOR_GLSL` after `#include <common>`, and call `irTrace(...)` from the fragment
// shader with the window's cell coordinates. City.tsx is the reference user; the alpine,
// beach and western facades can opt in the same way (pick a category, pass their cell UVs).
import * as THREE from "three";

/** room types (atlas columns) */
export const ROOM = {
  office: 0,
  meeting: 1,
  living: 2,
  bedroom: 3,
  kitchen: 4,
  empty: 5,
  stairs: 6,
  shop: 7,
} as const;
const TYPES = 8;
/** faces per room type (atlas layers): back, back (alt), side wall, floor, ceiling, furniture, furniture (alt) */
export const FACES = 7;
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

type Ctx = CanvasRenderingContext2D;
/** c = colour (alpha = coverage on furniture cards), e = emissive mask (lamps, screens, signs) */
type Face = { c: Ctx; e: Ctx; r: () => number };

const box = (g: Ctx, col: string | CanvasGradient, x: number, y: number, w: number, h: number) => {
  g.fillStyle = col;
  g.fillRect(x, y, w, h);
};
const vgrad = (g: Ctx, y0: number, y1: number, a: string, b: string) => {
  const gr = g.createLinearGradient(0, y0, 0, y1);
  gr.addColorStop(0, a);
  gr.addColorStop(1, b);
  return gr;
};
const glow = (F: Face, x: number, y: number, w: number, h: number, col: string, k = 1) => {
  box(F.c, col, x, y, w, h);
  F.e.globalAlpha = k;
  box(F.e, "#fff", x, y, w, h);
  F.e.globalAlpha = 1;
};
const disc = (g: Ctx, col: string, x: number, y: number, rx: number, ry = rx) => {
  g.fillStyle = col;
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  g.fill();
};
const poly = (g: Ctx, col: string, pts: number[]) => {
  g.fillStyle = col;
  g.beginPath();
  g.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i]!, pts[i + 1]!);
  g.closePath();
  g.fill();
};

/** soft corner occlusion on a wall / floor / ceiling (darker toward the edges) */
function occlude(g: Ctx, k = 0.28) {
  const e = S * 0.22;
  const sides: [number, number, number, number, number, number, number, number][] = [
    [0, 0, S, e, 0, 0, 0, e],
    [0, S - e, S, e, 0, S, 0, S - e],
    [0, 0, e, S, 0, 0, e, 0],
    [S - e, 0, e, S, S, 0, S - e, 0],
  ];
  for (const [x, y, w, h, x0, y0, x1, y1] of sides) {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, `rgba(0,0,0,${k})`);
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr;
    g.fillRect(x, y, w, h);
  }
}

/** a plain painted wall: soft vertical gradient, skirting board */
function wall(F: Face, top: string, bottom: string, skirting = "#8a8278") {
  box(F.c, vgrad(F.c, 0, S, top, bottom), 0, 0, S, S);
  box(F.c, skirting, 0, S - 10, S, 10);
}
function frame(F: Face, x: number, y: number, w: number, h: number) {
  const r = F.r;
  box(F.c, "#3a2e26", x - 3, y - 3, w + 6, h + 6);
  const hues = ["#c85a3a", "#3a6ab0", "#e0b040", "#4a9a6a", "#b04a8a", "#e8e0d0"];
  box(F.c, hues[Math.floor(r() * hues.length)]!, x, y, w, h);
  for (let k = 0; k < 3; k++)
    disc(
      F.c,
      hues[Math.floor(r() * hues.length)]!,
      x + r() * w,
      y + r() * h,
      4 + r() * w * 0.3,
      4 + r() * h * 0.25,
    );
}
function door(F: Face, x: number, w = 46, col = "#8a6a4a") {
  box(F.c, "#5a4a3a", x - 3, S - 150, w + 6, 150);
  box(F.c, col, x, S - 146, w, 146);
  box(F.c, "rgba(0,0,0,0.12)", x + 6, S - 136, w - 12, 56);
  box(F.c, "rgba(0,0,0,0.12)", x + 6, S - 72, w - 12, 56);
  box(F.c, "#d8d0b8", x + w - 10, S - 80, 5, 5);
}
function ceilingTiles(F: Face, base: string, lamps: [number, number][], lamp = "#f4f8ff") {
  box(F.c, base, 0, 0, S, S);
  for (let k = 0; k <= S; k += 32) {
    box(F.c, "rgba(0,0,0,0.10)", k, 0, 2, S);
    box(F.c, "rgba(0,0,0,0.10)", 0, k, S, 2);
  }
  for (const [x, y] of lamps) glow(F, x, y, 60, 26, lamp);
}
function planks(F: Face, a: string, b: string) {
  const r = F.r;
  for (let y = 0; y < S; y += 16) {
    let x = -r() * 80;
    while (x < S) {
      const w = 60 + r() * 70;
      box(F.c, r() < 0.5 ? a : b, x, y, w, 15);
      box(F.c, `rgba(0,0,0,${0.04 + r() * 0.08})`, x, y, w, 15);
      box(F.c, "rgba(0,0,0,0.25)", x, y, 1, 16);
      x += w;
    }
    box(F.c, "rgba(0,0,0,0.25)", 0, y + 15, S, 1);
  }
}
function carpet(F: Face, col: string, tile = 0) {
  const r = F.r;
  box(F.c, col, 0, 0, S, S);
  const img = F.c.getImageData(0, 0, S, S);
  for (let k = 0; k < S * S; k++) {
    const n = (r() - 0.5) * 18;
    const d = img.data;
    d[k * 4] = d[k * 4]! + n;
    d[k * 4 + 1] = d[k * 4 + 1]! + n;
    d[k * 4 + 2] = d[k * 4 + 2]! + n;
  }
  F.c.putImageData(img, 0, 0);
  if (tile)
    for (let k = 0; k <= S; k += tile) {
      box(F.c, "rgba(0,0,0,0.08)", k, 0, 1, S);
      box(F.c, "rgba(0,0,0,0.08)", 0, k, S, 1);
    }
}
function monitor(F: Face, x: number, y: number, w: number) {
  const h = w * 0.62;
  box(F.c, "#1a1c20", x - 2, y - 2, w + 4, h + 4);
  const sc = ["#8ab8ff", "#bfe0ff", "#9ad0c8", "#e8f0ff"][Math.floor(F.r() * 4)]!;
  glow(F, x, y, w, h, sc, 0.9);
  box(F.c, "rgba(255,255,255,0.35)", x + 3, y + 3, w * 0.5, 2);
  box(F.c, "rgba(40,60,90,0.35)", x + 3, y + 8, w * 0.7, 2);
  box(F.c, "#1a1c20", x + w / 2 - 2, y + h, 4, 8);
  box(F.c, "#1a1c20", x + w / 2 - 8, y + h + 7, 16, 3);
}
function chair(g: Ctx, x: number, y: number, col = "#26282e") {
  box(g, col, x, y, 26, 30); // back
  box(g, col, x - 3, y + 30, 32, 8); // seat
  box(g, "#18191c", x + 11, y + 38, 4, 16);
  box(g, "#18191c", x - 2, y + 54, 30, 3);
}
function plant(F: Face, x: number, base: number, h = 70) {
  const g = F.c;
  poly(g, "#8a5a3a", [x - 13, base - 24, x + 13, base - 24, x + 9, base, x - 9, base]);
  const greens = ["#2f6a3a", "#3f8a44", "#285a30", "#4a9a4a"];
  for (let k = 0; k < 16; k++) {
    const a = -Math.PI / 2 + (F.r() - 0.5) * 2.4;
    const l = h * (0.4 + F.r() * 0.6);
    const cx = x + Math.cos(a) * l * 0.5;
    const cy = base - 24 + Math.sin(a) * l * 0.5;
    g.save();
    g.translate(cx, cy);
    g.rotate(a + Math.PI / 2);
    disc(g, greens[k % greens.length]!, 0, 0, 5 + F.r() * 4, l * 0.5);
    g.restore();
  }
}
function floorLamp(F: Face, x: number, base: number) {
  box(F.c, "#2a2a2a", x - 1.5, base - 150, 3, 150);
  box(F.c, "#2a2a2a", x - 14, base - 4, 28, 4);
  poly(F.c, "#fff2d0", [
    x - 18,
    base - 150,
    x + 18,
    base - 150,
    x + 12,
    base - 178,
    x - 12,
    base - 178,
  ]);
  F.e.fillStyle = "#fff";
  poly(F.e, "#fff", [
    x - 18,
    base - 150,
    x + 18,
    base - 150,
    x + 12,
    base - 178,
    x - 12,
    base - 178,
  ]);
}
function bookshelf(F: Face, x: number, y: number, w: number, h: number) {
  const r = F.r;
  box(F.c, "#5a3e2a", x, y, w, h);
  const books = ["#b03a2e", "#2e5a9a", "#e0c060", "#3a7a4a", "#6a3a7a", "#d8d0c0", "#1e1e22"];
  for (let sy = y + 6; sy + 26 < y + h; sy += 32) {
    let bx = x + 5;
    while (bx < x + w - 10) {
      const bw = 4 + r() * 6;
      const bh = 16 + r() * 9;
      box(F.c, books[Math.floor(r() * books.length)]!, bx, sy + 26 - bh, bw, bh);
      bx += bw + (r() < 0.12 ? 8 : 1);
    }
    box(F.c, "#3e2a1c", x, sy + 26, w, 5);
  }
}

// ---- per room type: back, back2, side, floor, ceiling, furniture, furniture2 ----
type Painter = (F: Face) => void;
const OFFICE_WALL = ["#e6e4de", "#d4d2cc"];
const P: Painter[][] = [];

P[ROOM.office] = [
  (F) => {
    wall(F, ...(OFFICE_WALL as [string, string]), "#5a5a5e");
    box(F.c, "#f4f4f2", 70, 70, 120, 70); // whiteboard
    box(F.c, "#9aa0a8", 66, 66, 128, 4);
    box(F.c, "#9aa0a8", 66, 140, 128, 4);
    F.c.strokeStyle = "#3a6ab0";
    F.c.lineWidth = 2;
    F.c.beginPath();
    F.c.moveTo(82, 120);
    F.c.lineTo(110, 94);
    F.c.lineTo(134, 110);
    F.c.lineTo(170, 84);
    F.c.stroke();
    door(F, 196, 44, "#b8bcc2");
    occlude(F.c);
  },
  (F) => {
    wall(F, "#d8dde2", "#c4c8cc", "#4a4c50");
    for (let k = 0; k < 4; k++) {
      box(F.c, "#7a8088", 20 + k * 58, 128, 50, 118); // filing cabinets
      for (let d = 0; d < 3; d++) box(F.c, "#9aa0a8", 24 + k * 58, 134 + d * 38, 42, 32);
    }
    disc(F.c, "#f4f4f0", 128, 70, 18);
    disc(F.c, "#2a2a2a", 128, 70, 2);
    box(F.c, "#2a2a2a", 127, 56, 2, 14);
    occlude(F.c);
  },
  (F) => {
    wall(F, ...(OFFICE_WALL as [string, string]), "#5a5a5e");
    box(F.c, "#a8b8c8", 150, 60, 70, 90); // glass partition to the next office
    box(F.c, "#6a7078", 148, 58, 74, 3);
    frame(F, 50, 80, 50, 36);
    occlude(F.c);
  },
  (F) => {
    carpet(F, "#5a6270", 64);
    occlude(F.c, 0.2);
  },
  (F) => {
    ceilingTiles(F, "#e8e8e4", [
      [30, 60],
      [166, 60],
      [30, 170],
      [166, 170],
    ]);
    occlude(F.c, 0.18);
  },
  (F) => {
    // a row of desks with monitors and chairs
    const g = F.c;
    for (const x of [8, 132]) {
      box(g, "#cfc6b4", x, 168, 116, 8); // desk top
      box(g, "#8a8272", x, 176, 116, 4);
      box(g, "#6a6258", x + 4, 180, 4, 76);
      box(g, "#6a6258", x + 108, 180, 4, 76);
      box(g, "#9a9488", x + 70, 180, 40, 50); // drawers
      monitor(F, x + 18, 128, 38);
      monitor(F, x + 62, 128, 38);
      chair(g, x + 30, 190);
    }
  },
  (F) => {
    // cubicle partitions
    const g = F.c;
    for (const x of [0, 128]) {
      box(g, "#8a8e96", x + 4, 150, 120, 106);
      box(g, "#6a6e76", x + 4, 150, 120, 5);
      box(g, "#7a7e86", x + 62, 150, 4, 106);
      monitor(F, x + 22, 116, 36);
      monitor(F, x + 78, 118, 32);
    }
    plant(F, 240, 256, 80);
  },
];

P[ROOM.meeting] = [
  (F) => {
    wall(F, "#dcd6ca", "#c8c0b0", "#4a4038");
    box(F.c, "#141418", 60, 66, 136, 80); // big screen
    glow(F, 64, 70, 128, 72, "#2a5aa8", 0.8);
    box(F.c, "#e8f0ff", 76, 84, 60, 6);
    box(F.c, "#9ab8e8", 76, 98, 90, 4);
    box(F.c, "#9ab8e8", 76, 108, 70, 4);
    box(F.c, "#5a4432", 40, 200, 176, 46); // credenza
    occlude(F.c);
  },
  (F) => {
    wall(F, "#4a5a6a", "#3a4858", "#2a2a2e"); // feature wall
    for (let k = 0; k < 5; k++) box(F.c, "rgba(255,255,255,0.06)", k * 52, 0, 26, S);
    box(F.c, "#e8e0c8", 88, 90, 80, 22);
    box(F.c, "#2a3440", 94, 96, 68, 10);
    occlude(F.c);
  },
  (F) => {
    wall(F, "#dcd6ca", "#c8c0b0", "#4a4038");
    frame(F, 90, 70, 80, 56);
    occlude(F.c);
  },
  (F) => {
    carpet(F, "#4a4a52");
    occlude(F.c, 0.2);
  },
  (F) => {
    box(F.c, "#ecebe6", 0, 0, S, S);
    for (const [x, y] of [
      [64, 64],
      [192, 64],
      [64, 192],
      [192, 192],
      [128, 128],
    ] as const) {
      disc(F.c, "#fffaf0", x, y, 12);
      F.e.fillStyle = "#fff";
      disc(F.e, "#fff", x, y, 12);
    }
    occlude(F.c, 0.22);
  },
  (F) => {
    // conference table and chairs
    const g = F.c;
    for (let k = 0; k < 5; k++) chair(g, 18 + k * 48, 150, "#2e2a28");
    box(g, "#6a4a34", 6, 186, 244, 12);
    box(g, "#4a3424", 6, 198, 244, 6);
    box(g, "#3a2a1e", 40, 204, 12, 52);
    box(g, "#3a2a1e", 204, 204, 12, 52);
    box(g, "#e8e8e8", 100, 180, 30, 6); // laptop
    box(g, "#1a1a1e", 104, 170, 22, 12);
  },
  (F) => {
    // reception desk
    const g = F.c;
    box(g, "#e8e4dc", 30, 170, 196, 86);
    box(g, "#b8a888", 30, 164, 196, 10);
    box(g, "#c8c0b0", 30, 230, 196, 26);
    monitor(F, 110, 136, 34);
    plant(F, 236, 256, 90);
    plant(F, 18, 256, 70);
  },
];

const WARM_WALL = ["#f0ebe2", "#e2dace"];
P[ROOM.living] = [
  (F) => {
    wall(F, ...(WARM_WALL as [string, string]), "#e8e2d6");
    frame(F, 40, 60, 56, 40);
    frame(F, 110, 50, 40, 56);
    frame(F, 166, 64, 50, 34);
    box(F.c, "#6a4a32", 60, 190, 136, 30); // TV stand
    box(F.c, "#18181c", 84, 132, 88, 54); // TV
    glow(F, 87, 135, 82, 48, "#4a6aa8", 0.55);
    occlude(F.c);
  },
  (F) => {
    wall(F, ...(WARM_WALL as [string, string]), "#e8e2d6");
    bookshelf(F, 30, 56, 110, 190);
    frame(F, 170, 80, 50, 64);
    occlude(F.c);
  },
  (F) => {
    wall(F, ...(WARM_WALL as [string, string]), "#e8e2d6");
    door(F, 150, 48, "#f2eee6");
    frame(F, 50, 84, 44, 34);
    occlude(F.c);
  },
  (F) => {
    planks(F, "#a8784a", "#9a6c42");
    box(F.c, "#a83a3a", 40, 60, 176, 110); // rug
    box(F.c, "rgba(255,230,200,0.25)", 50, 70, 156, 90);
    occlude(F.c, 0.25);
  },
  (F) => {
    box(F.c, "#f2eee6", 0, 0, S, S);
    disc(F.c, "#e4ded2", 128, 128, 30);
    disc(F.c, "#fff4d8", 128, 128, 16); // pendant shade
    F.e.fillStyle = "#fff";
    disc(F.e, "#fff", 128, 128, 16);
    occlude(F.c, 0.25);
  },
  (F) => {
    // sofa, floor lamp, plant, coffee table
    const g = F.c;
    const sofa = ["#4a6a8a", "#8a4a3a", "#5a7a4a", "#6a5a7a", "#9a8a6a"][Math.floor(F.r() * 5)]!;
    box(g, sofa, 40, 170, 170, 50);
    box(g, "rgba(0,0,0,0.15)", 40, 200, 170, 20);
    box(g, sofa, 30, 186, 22, 50);
    box(g, sofa, 198, 186, 22, 50);
    box(g, "rgba(255,255,255,0.15)", 56, 176, 60, 22); // cushions
    box(g, "rgba(255,255,255,0.15)", 130, 176, 60, 22);
    box(g, "#2a2020", 50, 236, 6, 12);
    box(g, "#2a2020", 194, 236, 6, 12);
    box(g, "#5a3e2a", 90, 228, 76, 8); // coffee table
    box(g, "#3e2a1c", 96, 236, 4, 20);
    box(g, "#3e2a1c", 156, 236, 4, 20);
    floorLamp(F, 234, 256);
    plant(F, 16, 256, 90);
  },
  (F) => {
    const g = F.c;
    box(g, "#6a3a2a", 150, 170, 80, 60); // armchair
    box(g, "#5a2e20", 140, 190, 18, 50);
    box(g, "#5a2e20", 222, 190, 18, 50);
    box(g, "#2a2020", 150, 240, 6, 16);
    box(g, "#2a2020", 224, 240, 6, 16);
    floorLamp(F, 120, 256);
    plant(F, 40, 256, 110);
  },
];

P[ROOM.bedroom] = [
  (F) => {
    wall(F, "#e6e0ee", "#d6cfe0", "#efeaf2");
    box(F.c, "#e8e2d8", 20, 50, 90, 196); // wardrobe
    box(F.c, "rgba(0,0,0,0.12)", 64, 50, 2, 196);
    box(F.c, "#a8a098", 58, 140, 3, 16);
    box(F.c, "#a8a098", 69, 140, 3, 16);
    frame(F, 150, 70, 64, 46);
    occlude(F.c);
  },
  (F) => {
    wall(F, "#e8eef0", "#d4dce0", "#f2f2f2");
    frame(F, 60, 60, 46, 60);
    frame(F, 130, 70, 60, 42);
    box(F.c, "#8a6a4a", 50, 170, 150, 76); // dresser
    for (let d = 0; d < 2; d++) box(F.c, "#9a7a5a", 56, 178 + d * 34, 138, 28);
    occlude(F.c);
  },
  (F) => {
    wall(F, "#e6e0ee", "#d6cfe0", "#efeaf2");
    frame(F, 120, 80, 50, 40);
    occlude(F.c);
  },
  (F) => {
    carpet(F, "#c8b89a");
    occlude(F.c, 0.25);
  },
  (F) => {
    box(F.c, "#f4f2ee", 0, 0, S, S);
    disc(F.c, "#fff8e8", 128, 128, 22);
    F.e.fillStyle = "#fff";
    disc(F.e, "#fff", 128, 128, 22);
    occlude(F.c, 0.25);
  },
  (F) => {
    // bed with a headboard, nightstand and lamp
    const g = F.c;
    const quilt = ["#e8e4dc", "#6a8ab0", "#c87a6a", "#8aa88a", "#d8c89a"][Math.floor(F.r() * 5)]!;
    box(g, "#6a4a34", 30, 150, 170, 70); // headboard
    box(g, "#f4f2ee", 44, 186, 60, 22); // pillows
    box(g, "#f4f2ee", 126, 186, 60, 22);
    box(g, quilt, 30, 206, 170, 40);
    box(g, "rgba(0,0,0,0.12)", 30, 236, 170, 10);
    box(g, "#4a3424", 32, 246, 6, 10);
    box(g, "#4a3424", 192, 246, 6, 10);
    box(g, "#7a5a3e", 210, 206, 40, 50); // nightstand
    box(g, "#8a8070", 226, 190, 8, 16);
    poly(g, "#fff0c8", [216, 190, 244, 190, 238, 170, 222, 170]);
    F.e.fillStyle = "#fff";
    poly(F.e, "#fff", [216, 190, 244, 190, 238, 170, 222, 170]);
  },
  (F) => {
    // desk, chair, plant
    const g = F.c;
    box(g, "#d8ccb4", 20, 178, 130, 8);
    box(g, "#8a7a64", 24, 186, 5, 70);
    box(g, "#8a7a64", 141, 186, 5, 70);
    monitor(F, 60, 142, 40);
    chair(g, 70, 196, "#8a3a3a");
    plant(F, 210, 256, 110);
  },
];

P[ROOM.kitchen] = [
  (F) => {
    wall(F, "#f2efe6", "#e6e2d6", "#e6e2d6");
    // backsplash tiles, upper and lower cabinets, a window-less wall
    for (let y = 110; y < 170; y += 10)
      for (let x = (y / 10) % 2 ? 0 : 10; x < S; x += 20) box(F.c, "#dfe8ea", x + 1, y + 1, 18, 8);
    const cab = ["#e8e4da", "#5a7a6a", "#3a4a5a", "#b88a5a"][Math.floor(F.r() * 4)]!;
    for (let k = 0; k < 4; k++) {
      box(F.c, cab, 8 + k * 60, 40, 56, 66);
      box(F.c, "rgba(0,0,0,0.15)", 34 + k * 60, 66, 4, 16);
      box(F.c, cab, 8 + k * 60, 176, 56, 70);
      box(F.c, "rgba(0,0,0,0.15)", 30 + k * 60, 186, 12, 3);
    }
    box(F.c, "#3a3a3e", 0, 168, S, 10); // counter
    box(F.c, "#c8ccd0", 150, 150, 36, 18); // microwave
    box(F.c, "#1a1a1e", 154, 154, 22, 10);
    occlude(F.c);
  },
  (F) => {
    wall(F, "#f4efe4", "#e8e0d0", "#e8e0d0");
    box(F.c, "#dcdcdc", 170, 40, 70, 206); // fridge
    box(F.c, "rgba(0,0,0,0.12)", 170, 120, 70, 2);
    box(F.c, "#9a9a9a", 176, 90, 4, 22);
    box(F.c, "#9a9a9a", 176, 130, 4, 30);
    box(F.c, "#3a3a3e", 0, 168, 164, 10);
    box(F.c, "#e8e4da", 0, 178, 164, 68);
    for (let k = 0; k < 3; k++) box(F.c, "rgba(0,0,0,0.12)", 50 + k * 54, 178, 2, 68);
    disc(F.c, "#f4f4f0", 70, 80, 16);
    disc(F.c, "#3a3a3a", 70, 80, 2);
    occlude(F.c);
  },
  (F) => {
    wall(F, "#f2efe6", "#e6e2d6", "#e6e2d6");
    box(F.c, "#c8c0b0", 60, 60, 60, 20); // shelf with jars
    for (let k = 0; k < 5; k++)
      box(F.c, ["#c85a3a", "#e0c060", "#8aa870"][k % 3]!, 64 + k * 11, 44, 8, 16);
    occlude(F.c);
  },
  (F) => {
    for (let y = 0; y < S; y += 32)
      for (let x = 0; x < S; x += 32) box(F.c, (x + y) % 64 ? "#e8e4dc" : "#3a3a3e", x, y, 32, 32);
    occlude(F.c, 0.22);
  },
  (F) => {
    box(F.c, "#f6f4f0", 0, 0, S, S);
    glow(F, 60, 110, 136, 36, "#fffaf0");
    occlude(F.c, 0.2);
  },
  (F) => {
    // dining table, chairs, a pendant lamp over it
    const g = F.c;
    box(g, "#1e1e22", 127, 0, 2, 90);
    poly(g, "#e8c070", [104, 110, 152, 110, 142, 88, 114, 88]);
    F.e.fillStyle = "#fff";
    poly(F.e, "#fff", [104, 110, 152, 110, 142, 88, 114, 88]);
    for (const x of [44, 176]) {
      box(g, "#5a3e2a", x, 150, 8, 106);
      box(g, "#5a3e2a", x - 4 + (x < 128 ? 0 : -18), 200, 30, 6);
    }
    box(g, "#8a6040", 60, 194, 136, 8);
    box(g, "#6a4a30", 70, 202, 6, 54);
    box(g, "#6a4a30", 180, 202, 6, 54);
    disc(g, "#f4f4f0", 110, 192, 12, 3);
    disc(g, "#f4f4f0", 150, 192, 12, 3);
  },
  (F) => {
    // island with stools
    const g = F.c;
    box(g, "#3a3a3e", 30, 180, 196, 10);
    box(g, "#e8e4da", 36, 190, 184, 66);
    for (const x of [60, 120, 180]) {
      box(g, "#2a2a2a", x, 206, 22, 6);
      box(g, "#2a2a2a", x + 9, 212, 4, 44);
    }
    box(g, "#c85a3a", 100, 168, 16, 12); // fruit bowl
    disc(g, "#e0c040", 108, 166, 9, 5);
  },
];

P[ROOM.empty] = [
  (F) => {
    wall(F, "#d8d4cc", "#c4bfb4", "#a8a298");
    box(F.c, "rgba(255,255,255,0.3)", 60, 70, 60, 44); // pale patch where a picture hung
    box(F.c, "#e8e4dc", 196, 150, 14, 20); // switch plate
    occlude(F.c, 0.35);
  },
  (F) => {
    wall(F, "#c8ccd0", "#b4b8bc", "#8a8e92");
    door(F, 100, 50, "#c0c4c8");
    occlude(F.c, 0.35);
  },
  (F) => {
    wall(F, "#d8d4cc", "#c4bfb4", "#a8a298");
    occlude(F.c, 0.35);
  },
  (F) => {
    carpet(F, "#8a8680");
    box(F.c, "rgba(0,0,0,0.08)", 30, 40, 90, 60);
    occlude(F.c, 0.3);
  },
  (F) => {
    box(F.c, "#e0ddd6", 0, 0, S, S);
    disc(F.c, "#fffae8", 128, 128, 8); // bare bulb
    F.e.fillStyle = "#fff";
    disc(F.e, "#fff", 128, 128, 8);
    occlude(F.c, 0.3);
  },
  (F) => {
    // a few moving boxes and a ladder
    const g = F.c;
    box(g, "#b8905a", 20, 200, 60, 56);
    box(g, "#a8804a", 30, 160, 44, 40);
    box(g, "rgba(0,0,0,0.12)", 20, 226, 60, 3);
    box(g, "#c8a060", 180, 220, 50, 36);
    box(g, "#8a8e92", 120, 110, 4, 146);
    box(g, "#8a8e92", 150, 110, 4, 146);
    for (let y = 130; y < 256; y += 30) box(g, "#8a8e92", 120, y, 34, 4);
  },
  () => {
    // nothing at all
  },
];

P[ROOM.stairs] = [
  (F) => {
    // concrete block wall with a flight of stairs rising across it, a handrail, an exit sign
    box(F.c, "#b8b4ac", 0, 0, S, S);
    for (let y = 0; y < S; y += 16)
      for (let x = (y / 16) % 2 ? 0 : 20; x < S; x += 40) box(F.c, "rgba(0,0,0,0.08)", x, y, 1, 16);
    for (let y = 0; y < S; y += 16) box(F.c, "rgba(0,0,0,0.08)", 0, y, S, 1);
    for (let k = 0; k < 12; k++) {
      box(F.c, "#8a8680", k * 20, S - 20 - k * 18, 22, 20 + k * 18);
      box(F.c, "#a8a49c", k * 20, S - 20 - k * 18, 22, 3);
    }
    F.c.strokeStyle = "#c8b030";
    F.c.lineWidth = 4;
    F.c.beginPath();
    F.c.moveTo(0, S - 80);
    F.c.lineTo(S, S - 80 - 230);
    F.c.stroke();
    glow(F, 30, 40, 40, 16, "#2ad85a");
    box(F.c, "#e8fff0", 38, 45, 24, 6);
    occlude(F.c, 0.35);
  },
  (F) => {
    box(F.c, "#b0aca4", 0, 0, S, S);
    for (let y = 0; y < S; y += 16) box(F.c, "rgba(0,0,0,0.08)", 0, y, S, 1);
    for (let k = 0; k < 12; k++) {
      box(F.c, "#8a8680", S - 22 - k * 20, S - 20 - k * 18, 22, 20 + k * 18);
      box(F.c, "#a8a49c", S - 22 - k * 20, S - 20 - k * 18, 22, 3);
    }
    box(F.c, "#c83a2a", 24, 140, 30, 50); // fire hose cabinet
    box(F.c, "#e8e0d0", 28, 144, 22, 20);
    box(F.c, "#f4f0e0", 180, 30, 50, 20);
    box(F.c, "#2a2a2a", 186, 36, 38, 8);
    occlude(F.c, 0.35);
  },
  (F) => {
    box(F.c, "#b8b4ac", 0, 0, S, S);
    for (let y = 0; y < S; y += 16) box(F.c, "rgba(0,0,0,0.08)", 0, y, S, 1);
    box(F.c, "#5a6a7a", 150, S - 150, 56, 150); // steel door
    box(F.c, "#8a9aaa", 156, S - 100, 44, 6);
    occlude(F.c, 0.35);
  },
  (F) => {
    box(F.c, "#9a968e", 0, 0, S, S);
    box(F.c, "#c8b030", 0, 0, S, 8); // yellow nosing line at the window
    occlude(F.c, 0.3);
  },
  (F) => {
    box(F.c, "#c8c4bc", 0, 0, S, S);
    glow(F, 40, 118, 176, 18, "#f0f8ff");
    occlude(F.c, 0.3);
  },
  (F) => {
    // the next flight, in front: a sloped stringer with balusters and a rail
    const g = F.c;
    poly(g, "#6a6660", [0, 256, 0, 236, 256, 60, 256, 88]);
    for (let x = 8; x < 256; x += 22) {
      const y = 236 - (x / 256) * 176;
      box(g, "#3a3a3a", x, y - 60, 3, 60);
    }
    g.strokeStyle = "#c8b030";
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(0, 176);
    g.lineTo(256, 0);
    g.stroke();
  },
  (F) => {
    const g = F.c;
    poly(g, "#6a6660", [256, 256, 256, 236, 0, 60, 0, 88]);
    for (let x = 8; x < 256; x += 22) {
      const y = 60 + (x / 256) * 176;
      box(g, "#3a3a3a", x, y - 60, 3, 60);
    }
  },
];

P[ROOM.shop] = [
  (F) => {
    // shelves stocked with colourful goods
    box(F.c, "#e8e6e0", 0, 0, S, S);
    const r = F.r;
    const goods = ["#d83a2a", "#2a6ad8", "#f0c030", "#3aa85a", "#f07a2a", "#8a3ab8", "#f4f4f4"];
    for (let y = 60; y < 240; y += 36) {
      box(F.c, "#8a8e92", 0, y + 30, S, 5);
      let x = 2;
      while (x < S) {
        const w = 6 + r() * 12;
        box(F.c, goods[Math.floor(r() * goods.length)]!, x, y + 30 - (14 + r() * 14), w, 30);
        x += w + 1;
      }
      box(F.c, "rgba(0,0,0,0.15)", 0, y, S, 30);
    }
    glow(F, 40, 12, 176, 30, "#f8e8a0", 0.9); // sign
    box(F.c, "#c83a2a", 70, 20, 116, 14);
    occlude(F.c, 0.25);
  },
  (F) => {
    // clothes racks
    box(F.c, "#f0ece4", 0, 0, S, S);
    const r = F.r;
    for (const y of [70, 160]) {
      box(F.c, "#6a6e72", 10, y, 236, 4);
      for (let x = 14; x < 240; x += 7)
        box(
          F.c,
          ["#2a2a3a", "#c8c0b0", "#8a3a3a", "#3a5a8a", "#e8e0d0", "#5a7a5a"][Math.floor(r() * 6)]!,
          x,
          y + 4,
          6,
          50 + r() * 16,
        );
    }
    occlude(F.c, 0.22);
  },
  (F) => {
    box(F.c, "#e8e6e0", 0, 0, S, S);
    const r = F.r;
    for (let y = 80; y < 240; y += 40) {
      box(F.c, "#8a8e92", 0, y + 32, S, 5);
      for (let x = 4; x < S; x += 16)
        box(
          F.c,
          ["#d83a2a", "#2a6ad8", "#f0c030", "#3aa85a"][Math.floor(r() * 4)]!,
          x,
          y + 10,
          14,
          22,
        );
    }
    occlude(F.c, 0.25);
  },
  (F) => {
    for (let y = 0; y < S; y += 64)
      for (let x = 0; x < S; x += 64) box(F.c, (x + y) % 128 ? "#e4e2dc" : "#d4d2cc", x, y, 64, 64);
    box(F.c, "rgba(255,255,255,0.12)", 0, 0, S, S);
    occlude(F.c, 0.18);
  },
  (F) => {
    ceilingTiles(
      F,
      "#f0f0ec",
      [
        [20, 40],
        [176, 40],
        [20, 120],
        [176, 120],
        [20, 200],
        [176, 200],
        [98, 80],
        [98, 160],
      ],
      "#ffffff",
    );
  },
  (F) => {
    // counter with a till, a display table
    const g = F.c;
    box(g, "#3a3a40", 130, 176, 120, 80);
    box(g, "#8a6a4a", 126, 170, 128, 8);
    box(g, "#1a1a1e", 200, 150, 30, 20);
    glow(F, 203, 152, 24, 10, "#6ad0a0", 0.8);
    box(g, "#c8b8a0", 10, 206, 90, 8);
    box(g, "#8a7a64", 16, 214, 6, 42);
    box(g, "#8a7a64", 88, 214, 6, 42);
    for (let k = 0; k < 5; k++)
      box(g, ["#d83a2a", "#2a6ad8", "#f0c030"][k % 3]!, 16 + k * 16, 190, 12, 16);
  },
  (F) => {
    // mannequins
    const g = F.c;
    for (const x of [60, 190]) {
      disc(g, "#e8dcd0", x, 96, 11, 13);
      const top = ["#c83a3a", "#2a4a8a", "#e8e0d0", "#2a2a2a"][Math.floor(F.r() * 4)]!;
      poly(g, top, [x - 22, 112, x + 22, 112, x + 18, 180, x - 18, 180]);
      box(g, "#2a2a30", x - 16, 180, 32, 50);
      box(g, "#8a8e92", x - 2, 230, 4, 20);
      box(g, "#8a8e92", x - 16, 250, 32, 4);
    }
  },
];

let atlas: THREE.DataArrayTexture | null = null;

/** The shared room atlas: a texture array, one 256 px layer per (room type, face). Built once. */
export function roomAtlas() {
  if (atlas) return atlas;
  const mk = () => {
    const c = document.createElement("canvas");
    c.width = c.height = S;
    return c.getContext("2d", { willReadFrequently: true })!;
  };
  const c = mk();
  const e = mk();
  const layers = TYPES * FACES;
  const data = new Uint8Array(S * S * 4 * layers);
  for (let t = 0; t < TYPES; t++)
    for (let f = 0; f < FACES; f++) {
      const card = f >= 5;
      c.clearRect(0, 0, S, S);
      if (!card) box(c, "#888", 0, 0, S, S);
      e.fillStyle = "#000";
      e.fillRect(0, 0, S, S);
      P[t]?.[f]?.({ c, e, r: rng(7 + t * 131 + f * 17) });
      const C = c.getImageData(0, 0, S, S).data;
      const E = e.getImageData(0, 0, S, S).data;
      const off = (t * FACES + f) * S * S * 4;
      for (let y = 0; y < S; y++) {
        const src = (S - 1 - y) * S * 4; // canvas top row = texture top (v = 1)
        const dst = off + y * S * 4;
        for (let x = 0; x < S * 4; x += 4) {
          data[dst + x] = C[src + x]!;
          data[dst + x + 1] = C[src + x + 1]!;
          data[dst + x + 2] = C[src + x + 2]!;
          // faces: alpha = 1 - emissive; furniture cards: alpha = coverage
          data[dst + x + 3] = card ? C[src + x + 3]! : 255 - E[src + x]!;
        }
      }
    }
  const tex = new THREE.DataArrayTexture(data, S, S, layers);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  atlas = tex;
  return tex;
}

/** Room lighting that changes with the time of day (shared by every material using rooms). */
export const interiorUniforms = {
  uRooms: { value: null as THREE.DataArrayTexture | null },
  /** brightness of an unlit room (daylight / sky glow through the glass) */
  uRoomAmb: { value: new THREE.Color("#1a2238") },
  /** brightness multiplier for lit rooms */
  uRoomLit: { value: 1 },
  /** 0 turns the rooms off (`?rooms=0`, for A/B testing): windows fall back to the flat glow */
  uRoomOn: { value: roomsParam() },
};

function roomsParam() {
  if (typeof window === "undefined") return 1;
  return new URLSearchParams(window.location.search).get("rooms") === "0" ? 0 : 1;
}

/** the graphics quality turns the rooms on or off (`?rooms=0` keeps them off) */
export function setRoomsEnabled(on: boolean) {
  interiorUniforms.uRoomOn.value = on ? roomsParam() : 0;
}

export function addInteriorUniforms(sh: { uniforms: Record<string, THREE.IUniform> }) {
  interiorUniforms.uRooms.value = roomAtlas();
  sh.uniforms["uRooms"] = interiorUniforms.uRooms;
  sh.uniforms["uRoomAmb"] = interiorUniforms.uRoomAmb;
  sh.uniforms["uRoomLit"] = interiorUniforms.uRoomLit;
  sh.uniforms["uRoomOn"] = interiorUniforms.uRoomOn;
}

/**
 * GLSL (after `#include <common>`). Main entry:
 *
 *   vec3 irTrace(vec2 f, vec3 d, float type, vec4 rnd, float lit, vec3 lamp, vec2 gx, vec2 gy)
 *
 *   f    position inside the room's window plane, 0..1 (x across, y floor to ceiling)
 *   d    view ray in room units (x across per room width, y per storey, z into the room per
 *        room depth; z > 0)
 *   type room type (ROOM.*), rnd four per-room randoms, lit 0..1, lamp = light colour
 *   gx gy screen-space gradients of f (for the atlas lookups)
 *
 * `irRayD(...)` builds `d` from screen-space derivatives, so any UV layout works.
 */
export const INTERIOR_GLSL = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray uRooms;
uniform vec3 uRoomAmb;
uniform float uRoomLit;
uniform float uRoomOn;
float irHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec4 irHash4(vec2 p) {
  return vec4(irHash(p), irHash(p + 17.31), irHash(p + 41.77), irHash(p + 73.13));
}
// View ray through the room, from screen-space derivatives: pos = view-space position and
// its dFdx / dFdy, du1 du2 = dFdx / dFdy of the continuous room coordinate (1 unit = one room
// across / one storey up), n = outward view-space normal, depth = room depth in metres.
// Take the derivatives in uniform control flow and pass them in.
vec3 irRayD(vec3 pos, vec3 dp1, vec3 dp2, vec2 du1, vec2 du2, vec3 n, float depth) {
  vec3 p2 = cross(dp2, n);
  vec3 p1 = cross(n, dp1);
  float det = dot(dp1, p2);
  det = abs(det) < 1e-14 ? 1e-14 : det;
  vec3 gu = (p2 * du1.x + p1 * du2.x) / det;
  vec3 gv = (p2 * du1.y + p1 * du2.y) / det;
  vec3 v = normalize(pos);
  return vec3(dot(v, gu), dot(v, gv), max(-dot(v, n), 0.02) / depth);
}
vec3 irTrace(vec2 f, vec3 d, float type, vec4 rnd, float lit, vec3 lamp, vec2 gx, vec2 gy) {
  if (rnd.x < 0.5) { f.x = 1.0 - f.x; d.x = -d.x; gx.x = -gx.x; gy.x = -gy.x; }
  vec3 o = vec3(clamp(f, 0.001, 0.999), 0.0);
  vec3 tt = (step(0.0, d) - o) / d;
  float t = min(min(tt.x, tt.y), tt.z);
  vec3 h = o + d * t;
  float base = type * ${FACES.toFixed(1)};
  vec2 uv;
  float face;
  float wallK = 0.0;
  if (t == tt.z) { uv = h.xy; face = rnd.y < 0.5 ? 0.0 : 1.0; wallK = 1.0; }
  else if (t == tt.x) { uv = vec2(h.z, h.y); face = 2.0; wallK = 1.0; }
  else { uv = vec2(h.x, h.z); face = d.y < 0.0 ? 3.0 : 4.0; }
  // the far faces shrink with depth: widen the lookup footprint to match
  float grow = 1.0 + t * 0.6;
  vec4 c = textureGrad(uRooms, vec3(uv, base + face), gx * grow, gy * grow);
  vec3 alb = c.rgb;
  float em = 1.0 - c.a;
  // painted walls in homes take a per-room colour
  if (wallK > 0.0 && type >= 2.0 && type <= 4.0) {
    vec3 tint = mix(vec3(1.0), 0.55 + 0.45 * cos(6.2832 * (rnd.w * 0.8 + vec3(0.0, 0.33, 0.67))), 0.35);
    alb *= tint;
  }
  vec3 hp = h;
  // the furniture card stands a little over halfway back
  float wm = 0.55 + rnd.z * 0.2;
  float tm = wm / d.z;
  if (tm < t) {
    vec2 hm = o.xy + d.xy * tm;
    if (hm.x > 0.0 && hm.x < 1.0 && hm.y > 0.0 && hm.y < 1.0) {
      float g2 = 1.0 + tm * 0.6;
      vec4 fc = textureGrad(uRooms, vec3(hm, base + (rnd.z < 0.5 ? 5.0 : 6.0)), gx * g2, gy * g2);
      alb = mix(alb, fc.rgb, fc.a);
      em *= 1.0 - fc.a;
      hp = mix(hp, vec3(hm, wm), fc.a);
    }
  }
  // one ceiling lamp near the middle of the room
  vec3 lp = (hp - vec3(0.5, 0.8, 0.45)) * vec3(1.0, 1.4, 1.0);
  float fall = 1.0 / (1.0 + 3.0 * dot(lp, lp));
  vec3 lightC = mix(uRoomAmb, lamp * (0.1 + 0.95 * fall) * uRoomLit, lit);
  return alb * lightC + alb * em * lamp * (1.8 * lit * uRoomLit);
}
// Blinds and curtains hanging at the glass, in window-plane coordinates. Returns rgb and
// coverage (a); kind: 0 none, 1 venetian blind, 2 roller blind, 3 curtains.
vec4 irDressing(vec2 f, float kind, float amount, float hue, float lit, vec3 lamp, float fw) {
  if (kind < 0.5) return vec4(0.0);
  vec3 col;
  float a = 0.0;
  if (kind < 1.5) {
    a = step(1.0 - amount, f.y);
    float slat = 0.5 + 0.5 * sin(f.y * 150.0);
    slat = mix(slat, 0.5, clamp(fw * 40.0, 0.0, 1.0));
    col = vec3(0.78, 0.76, 0.72) * (0.75 + 0.25 * slat);
  } else if (kind < 2.5) {
    a = step(1.0 - amount, f.y);
    col = mix(vec3(0.85, 0.8, 0.7), vec3(0.45, 0.5, 0.58), hue);
  } else {
    float w = amount * 0.45;
    a = step(f.x, w) + step(1.0 - w, f.x);
    float fold = 0.75 + 0.25 * sin(f.x * 70.0);
    fold = mix(fold, 0.75, clamp(fw * 25.0, 0.0, 1.0));
    col = (0.55 + 0.45 * cos(6.2832 * (hue + vec3(0.0, 0.33, 0.67)))) * 0.8 * fold;
  }
  // lit from behind, the fabric glows; unlit it just catches a little sky
  vec3 c = col * mix(uRoomAmb * 1.5, lamp * 0.8 * uRoomLit, lit);
  return vec4(c, clamp(a, 0.0, 1.0));
}
`;
