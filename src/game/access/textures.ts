// Canvas textures for the access buildings: the sign atlas (entrance signs, EXIT, floor
// numbers), brushed steel for the car and doors, and the live floor-indicator displays.
import * as THREE from "three";

const canvas = (w: number, h: number) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};

/** sign atlas rows: 8 rows of 128 px in a 1024 x 1024 canvas */
export const SIGN = {
  ELEVATOR: 0,
  STAIRS: 1,
  EXIT: 2,
  ROOF: 3,
  UP: 4, // "ELEVATOR ▲ TO ROOF" plaque for walls
  FLOOR: 5, // digits 1..9 + R in 10 cells
  LOBBY: 6,
  STAIRUP: 7,
} as const;

/** uv rectangle [u0 v0 u1 v1] of a sign row (or one cell of a row split in n) */
export function signUV(row: number, cell = 0, n = 1): [number, number, number, number] {
  const v1 = 1 - row / 8;
  const v0 = 1 - (row + 1) / 8;
  const u0 = cell / n;
  const u1 = (cell + 1) / n;
  return [u0, v0 + 0.004, u1, v1 - 0.004];
}

let signTex: THREE.CanvasTexture | null = null;
export function signTexture() {
  if (signTex) return signTex;
  const c = canvas(1024, 1024);
  const g = c.getContext("2d")!;
  const row = (r: number) => r * 128;
  const panel = (r: number, bg: string, edge: string) => {
    g.fillStyle = bg;
    g.fillRect(0, row(r), 1024, 128);
    g.strokeStyle = edge;
    g.lineWidth = 6;
    g.strokeRect(6, row(r) + 6, 1012, 116);
  };
  const arrowUp = (x: number, y: number, s: number, col: string) => {
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(x, y - s);
    g.lineTo(x + s * 0.9, y + s * 0.2);
    g.lineTo(x + s * 0.35, y + s * 0.2);
    g.lineTo(x + s * 0.35, y + s);
    g.lineTo(x - s * 0.35, y + s);
    g.lineTo(x - s * 0.35, y + s * 0.2);
    g.lineTo(x - s * 0.9, y + s * 0.2);
    g.closePath();
    g.fill();
  };
  const text = (t: string, x: number, y: number, size: number, col: string, align: CanvasTextAlign = "center") => {
    g.font = `800 ${size}px "Helvetica Neue", Arial, sans-serif`;
    g.textAlign = align;
    g.textBaseline = "middle";
    g.fillStyle = col;
    g.fillText(t, x, y);
  };
  // ELEVATOR (backlit white on deep blue, amber arrow)
  panel(SIGN.ELEVATOR, "#0e1a33", "#7fb0ff");
  arrowUp(112, row(0) + 64, 40, "#ffb838");
  text("ELEVATOR", 580, row(0) + 66, 92, "#ffffff");
  // STAIRS (white on green)
  panel(SIGN.STAIRS, "#0d3a24", "#7dffb4");
  arrowUp(112, row(1) + 64, 40, "#ffffff");
  text("STAIRS · ROOF", 580, row(1) + 66, 80, "#ffffff");
  // EXIT (green)
  g.fillStyle = "#0a6b35";
  g.fillRect(0, row(2), 1024, 128);
  text("EXIT", 512, row(2) + 66, 104, "#eafff0");
  // ROOF (for the penthouse door)
  panel(SIGN.ROOF, "#1a1a1c", "#ffb838");
  text("ROOF ACCESS", 512, row(3) + 66, 84, "#ffd88a");
  // wall plaque: ELEVATOR ▲ ROOF
  g.fillStyle = "#23201d";
  g.fillRect(0, row(4), 1024, 128);
  arrowUp(96, row(4) + 64, 36, "#e8c27a");
  text("ELEVATORS  ·  ROOF", 560, row(4) + 66, 70, "#e8dcc4");
  // floor numbers 1..9, R: stencilled on the stairwell walls
  for (let k = 0; k < 10; k++) {
    g.fillStyle = "#f2c230";
    g.fillRect(k * 102.4 + 4, row(5) + 4, 94, 120);
    text(k < 9 ? String(k + 1) : "R", k * 102.4 + 51, row(5) + 68, 100, "#1a1a1a");
  }
  // LOBBY directory
  g.fillStyle = "#2b2622";
  g.fillRect(0, row(6), 1024, 128);
  text("VICE HEIGHTS", 512, row(6) + 66, 76, "#d9c9a8");
  // stairwell: "ROOF ▲"
  g.fillStyle = "#f2c230";
  g.fillRect(0, row(7), 1024, 128);
  arrowUp(120, row(7) + 64, 42, "#1a1a1a");
  text("ROOF", 560, row(7) + 68, 100, "#1a1a1a");
  signTex = new THREE.CanvasTexture(c);
  signTex.colorSpace = THREE.SRGBColorSpace;
  signTex.anisotropy = 8;
  signTex.generateMipmaps = true;
  signTex.minFilter = THREE.LinearMipmapLinearFilter;
  return signTex;
}

let steelTex: THREE.CanvasTexture | null = null;
/** brushed steel: fine horizontal streaks (sampled with world-ish uvs) */
export function steelTexture() {
  if (steelTex) return steelTex;
  const c = canvas(256, 256);
  const g = c.getContext("2d")!;
  g.fillStyle = "#cdd0d3";
  g.fillRect(0, 0, 256, 256);
  let s = 1234567;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 1400; i++) {
    const y = rnd() * 256;
    const l = 20 + rnd() * 200;
    const x = rnd() * 256;
    const v = 185 + Math.floor(rnd() * 60);
    g.strokeStyle = `rgba(${v},${v + 2},${v + 5},0.16)`;
    g.lineWidth = 0.6 + rnd();
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + l, y + (rnd() - 0.5) * 0.6);
    g.stroke();
  }
  steelTex = new THREE.CanvasTexture(c);
  steelTex.colorSpace = THREE.SRGBColorSpace;
  steelTex.wrapS = steelTex.wrapT = THREE.RepeatWrapping;
  steelTex.anisotropy = 4;
  return steelTex;
}

/** a live floor indicator: redraws only when what it shows changes */
export class Display {
  tex: THREE.CanvasTexture;
  private g: CanvasRenderingContext2D;
  private key = "";
  constructor() {
    const c = canvas(256, 128);
    this.g = c.getContext("2d")!;
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.show(1, 0, "");
  }
  /** floor number, direction (1 up, -1 down, 0 none), caption under the number */
  show(floor: number, dir: number, caption: string) {
    const key = `${floor}|${dir}|${caption}`;
    if (key === this.key) return;
    this.key = key;
    const g = this.g;
    g.fillStyle = "#050404";
    g.fillRect(0, 0, 256, 128);
    // faint unlit segments give it depth
    g.fillStyle = "#1a0d06";
    g.font = `700 86px "Courier New", ui-monospace, monospace`;
    g.textAlign = "right";
    g.textBaseline = "alphabetic";
    g.fillText("888", 240, caption ? 88 : 100);
    g.fillStyle = "#ffae3a";
    g.shadowColor = "#ff8a00";
    g.shadowBlur = 14;
    g.fillText(String(floor), 240, caption ? 88 : 100);
    if (dir !== 0) {
      g.beginPath();
      const x = 34;
      const y = caption ? 56 : 64;
      if (dir > 0) {
        g.moveTo(x, y - 26);
        g.lineTo(x + 22, y + 10);
        g.lineTo(x - 22, y + 10);
      } else {
        g.moveTo(x, y + 26);
        g.lineTo(x + 22, y - 10);
        g.lineTo(x - 22, y - 10);
      }
      g.closePath();
      g.fill();
    }
    if (caption) {
      g.font = `700 24px "Helvetica Neue", Arial, sans-serif`;
      g.textAlign = "center";
      g.fillText(caption, 128, 118);
    }
    g.shadowBlur = 0;
    this.tex.needsUpdate = true;
  }
  dispose() {
    this.tex.dispose();
  }
}
