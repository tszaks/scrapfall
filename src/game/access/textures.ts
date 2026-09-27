// Canvas textures for the access buildings: the sign atlas (entrance signs, EXIT, floor
// numbers), brushed steel for the car and doors, and the live floor-indicator displays.
import * as THREE from "three";

const canvas = (w: number, h: number) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};

/** sign atlas rows: 10 rows of 128 px in a 1024 x 1280 canvas */
export const SIGN = {
  ELEVATOR: 0,
  STAIRS: 1,
  EXIT: 2,
  ROOF: 3,
  UP: 4, // "ELEVATOR ▲ TO ROOF" plaque for walls
  FLOOR: 5, // digits 1..9 + R in 10 cells
  LOBBY: 6,
  STAIRUP: 7,
  FIRE: 8, // "FIRE EXTINGUISHER"
  EXITARROW: 9, // "EXIT ←" for the stairwell
} as const;
const ROWS = 10;

/** uv rectangle [u0 v0 u1 v1] of a sign row (or one cell of a row split in n) */
export function signUV(row: number, cell = 0, n = 1): [number, number, number, number] {
  const v1 = 1 - row / ROWS;
  const v0 = 1 - (row + 1) / ROWS;
  const u0 = cell / n;
  const u1 = (cell + 1) / n;
  return [u0, v0 + 0.004, u1, v1 - 0.004];
}

let signTex: THREE.CanvasTexture | null = null;
export function signTexture() {
  if (signTex) return signTex;
  const c = canvas(1024, 128 * ROWS);
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
  text("LOBBY", 512, row(6) + 66, 84, "#d9c9a8");
  // stairwell: "ROOF ▲"
  g.fillStyle = "#f2c230";
  g.fillRect(0, row(7), 1024, 128);
  arrowUp(120, row(7) + 64, 42, "#1a1a1a");
  text("ROOF", 560, row(7) + 68, 100, "#1a1a1a");
  // fire extinguisher: white on red
  g.fillStyle = "#b3161b";
  g.fillRect(0, row(8), 1024, 128);
  text("FIRE EXTINGUISHER", 512, row(8) + 66, 78, "#ffffff");
  // EXIT with an arrow pointing down the stairs
  g.fillStyle = "#0a6b35";
  g.fillRect(0, row(9), 1024, 128);
  text("EXIT", 380, row(9) + 66, 100, "#eafff0");
  g.fillStyle = "#eafff0";
  g.beginPath();
  g.moveTo(640, row(9) + 64);
  g.lineTo(720, row(9) + 20);
  g.lineTo(720, row(9) + 46);
  g.lineTo(820, row(9) + 46);
  g.lineTo(820, row(9) + 82);
  g.lineTo(720, row(9) + 82);
  g.lineTo(720, row(9) + 108);
  g.closePath();
  g.fill();
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
    const v = 150 + Math.floor(rnd() * 100);
    g.strokeStyle = `rgba(${v},${v + 2},${v + 5},0.3)`;
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

const noiseCanvas = (w: number, h: number, base: string, paint: (g: CanvasRenderingContext2D, rnd: () => number) => void) => {
  const c = canvas(w, h);
  const g = c.getContext("2d")!;
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  let s0 = 987654321;
  const rnd = () => ((s0 = (s0 * 16807) % 2147483647) / 2147483647);
  paint(g, rnd);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
};

let woodTex: THREE.CanvasTexture | null = null;
/** walnut veneer: long wavy grain along u (1 repeat = 1.2 m) */
export function woodTexture() {
  if (woodTex) return woodTex;
  woodTex = noiseCanvas(512, 256, "#b9b9b9", (g, rnd) => {
    for (let i = 0; i < 220; i++) {
      const y = rnd() * 256;
      const a = 2 + rnd() * 6;
      const f = 0.01 + rnd() * 0.02;
      const v = 120 + Math.floor(rnd() * 120);
      g.strokeStyle = `rgba(${v},${v},${v},${0.25 + rnd() * 0.35})`;
      g.lineWidth = 0.8 + rnd() * 2.4;
      g.beginPath();
      for (let x = 0; x <= 512; x += 8) {
        const yy = y + Math.sin(x * f + i) * a;
        if (x === 0) g.moveTo(x, yy);
        else g.lineTo(x, yy);
      }
      g.stroke();
    }
    // a few knots
    for (let k = 0; k < 3; k++) {
      const x = rnd() * 512;
      const y = rnd() * 256;
      const grd = g.createRadialGradient(x, y, 1, x, y, 6 + rnd() * 5);
      grd.addColorStop(0, "rgba(90,90,90,0.35)");
      grd.addColorStop(1, "rgba(90,90,90,0)");
      g.fillStyle = grd;
      g.fillRect(x - 30, y - 30, 60, 60);
    }
  });
  return woodTex;
}

let concTex: THREE.CanvasTexture | null = null;
/** poured / block concrete: speckle, soft blotches and faint form lines (1 repeat = 2 m) */
export function concreteTexture() {
  if (concTex) return concTex;
  concTex = noiseCanvas(512, 512, "#c8c8c8", (g, rnd) => {
    for (let i = 0; i < 90; i++) {
      const x = rnd() * 512;
      const y = rnd() * 512;
      const r = 20 + rnd() * 90;
      const v = rnd() < 0.5 ? 150 : 225;
      const grd = g.createRadialGradient(x, y, 1, x, y, r);
      grd.addColorStop(0, `rgba(${v},${v},${v},0.22)`);
      grd.addColorStop(1, `rgba(${v},${v},${v},0)`);
      g.fillStyle = grd;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (let i = 0; i < 9000; i++) {
      const v = Math.floor(rnd() * 255);
      g.fillStyle = `rgba(${v},${v},${v},0.16)`;
      g.fillRect(rnd() * 512, rnd() * 512, 1 + rnd() * 1.5, 1 + rnd() * 1.5);
    }
    // block joints every quarter (blocks 0.5 m x 0.25 m at 2 m per repeat)
    g.strokeStyle = "rgba(110,110,110,0.22)";
    g.lineWidth = 1.5;
    for (let r = 0; r < 8; r++) {
      const y = r * 64;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(512, y);
      g.stroke();
      for (let k = 0; k < 4; k++) {
        const x = k * 128 + (r % 2) * 64;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x, y + 64);
        g.stroke();
      }
    }
  });
  return concTex;
}

/**
 * The car's button panel: L and R call buttons over a grid of floor buttons for the block of
 * floors the car is passing, the current floor's button lit. Redraws only on change.
 */
export class CopPanel {
  tex: THREE.CanvasTexture;
  private g: CanvasRenderingContext2D;
  private key = "";
  constructor() {
    const c = canvas(128, 320);
    this.g = c.getContext("2d")!;
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.show(1, 1, 0, false);
  }
  show(floor: number, top: number, dest: 0 | 1, emergency: boolean) {
    const key = `${floor}|${top}|${dest}|${emergency}`;
    if (key === this.key) return;
    this.key = key;
    const g = this.g;
    const lit = emergency ? "#ff4a2a" : "#ffb030";
    g.fillStyle = "#c9ccd0";
    g.fillRect(0, 0, 128, 320);
    g.fillStyle = "#b2b5ba";
    g.fillRect(6, 6, 116, 308);
    const btn = (x: number, y: number, label: string, on: boolean, r = 11) => {
      g.beginPath();
      g.arc(x, y, r + 2, 0, Math.PI * 2);
      g.fillStyle = "#8e9196";
      g.fill();
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fillStyle = on ? lit : "#e9eaec";
      if (on) {
        g.shadowColor = lit;
        g.shadowBlur = 10;
      }
      g.fill();
      g.shadowBlur = 0;
      g.fillStyle = on ? "#3a1a00" : "#2b2d31";
      g.font = `700 ${label.length > 2 ? 9 : 11}px Arial, sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(label, x, y + 0.5);
    };
    // call buttons (destination lit)
    btn(40, 30, "R", dest === 1, 14);
    btn(88, 30, "L", dest === 0, 14);
    // floor block: 4 columns x 6 rows, counting up from the bottom
    const per = 24;
    const base = Math.floor((floor - 1) / per) * per + 1;
    for (let k = 0; k < per; k++) {
      const f = base + k;
      if (f > top) break;
      const col = k % 4;
      const rowI = Math.floor(k / 4);
      btn(22 + col * 28, 290 - rowI * 38, String(f), f === floor);
    }
    // alarm and door buttons
    g.fillStyle = "#d8b02a";
    g.fillRect(30, 54, 68, 4);
    this.tex.needsUpdate = true;
  }
  dispose() {
    this.tex.dispose();
  }
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
  show(floor: number, dir: number, caption: string, emergency = false) {
    const key = `${floor}|${dir}|${caption}|${emergency}`;
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
    g.fillStyle = emergency ? "#ff3a22" : "#ffae3a";
    g.shadowColor = emergency ? "#ff1a00" : "#ff8a00";
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
