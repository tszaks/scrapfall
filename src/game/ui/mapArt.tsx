// Painted map thumbnails for the loadout picker: a flat "postcard" per arena, drawn from the
// theme's own palette (sky / ground / blocks / glow) so the card matches the live backdrop.
import { useEffect, useRef } from "react";
import { layoutOf, type Theme } from "../themes";

const W = 264;
const H = 132;

const shade = (hex: string, f: number) => {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, Math.round(((n >> 16) & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((n >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((n & 255) * f)));
  return `rgb(${r},${g},${b})`;
};

function sky(g: CanvasRenderingContext2D, t: Theme) {
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, shade(t.sky, 0.82));
  grad.addColorStop(0.62, t.sky);
  grad.addColorStop(1, shade(t.sky, 1.12));
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // sun / moon disc in the boss's glow colour
  g.fillStyle = t.boss.glow;
  g.globalAlpha = 0.9;
  g.beginPath();
  g.arc(W * 0.78, H * 0.24, 13, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 0.28;
  g.beginPath();
  g.arc(W * 0.78, H * 0.24, 20, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;
}

function ground(g: CanvasRenderingContext2D, t: Theme, y = H * 0.72) {
  g.fillStyle = t.ground;
  g.fillRect(0, y, W, H - y);
  g.strokeStyle = t.grid[0];
  g.globalAlpha = 0.55;
  g.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const gy = y + ((H - y) * (i + 1)) / 5;
    g.beginPath();
    g.moveTo(0, gy);
    g.lineTo(W, gy);
    g.stroke();
  }
  g.globalAlpha = 1;
}

const house = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string, roof?: string) => {
  g.fillStyle = c;
  g.fillRect(x, y - h, w, h);
  g.fillStyle = roof ?? shade(c, 0.6);
  g.beginPath();
  g.moveTo(x - 3, y - h);
  g.lineTo(x + w / 2, y - h - w * 0.32);
  g.lineTo(x + w + 3, y - h);
  g.fill();
  g.fillStyle = "rgba(20,14,8,0.72)";
  g.fillRect(x + w * 0.18, y - h * 0.62, w * 0.2, h * 0.24);
  g.fillRect(x + w * 0.62, y - h * 0.62, w * 0.2, h * 0.24);
};

function paint(g: CanvasRenderingContext2D, t: Theme) {
  const kind = layoutOf(t);
  const horizon = H * 0.72;
  sky(g, t);
  const [b0, b1, b2] = t.blocks;
  if (kind === "city") {
    // skyline: two rows of towers with lit windows
    for (const [row, y0, col] of [
      [0, horizon - 4, b2],
      [1, horizon, b0],
    ] as const) {
      let x = row ? 4 : 10;
      let i = 0;
      while (x < W) {
        const w = 16 + ((x * 7 + row * 13) % 18);
        const h = (row ? 34 : 22) + ((x * 11) % 30);
        g.fillStyle = shade(col, row ? 1 : 0.72);
        g.fillRect(x, y0 - h, w, h);
        if (row === 1) {
          g.fillStyle = "rgba(255,240,200,0.75)";
          for (let wy = y0 - h + 4; wy < y0 - 5; wy += 7)
            for (let wx = x + 3; wx < x + w - 3; wx += 6)
              if ((wx * wy + i) % 3 === 0) g.fillRect(wx, wy, 3, 3);
        }
        x += w + 3;
        i++;
      }
    }
    // foreground palms
    g.fillStyle = shade(b1, 0.55);
    for (const px of [30, 226]) {
      g.fillRect(px, horizon - 16, 3, 18);
      for (let a = 0; a < 5; a++) {
        const ang = -Math.PI / 2 + (a - 2) * 0.5;
        g.beginPath();
        g.ellipse(px + 1.5 + Math.cos(ang) * 7, horizon - 18 + Math.sin(ang) * 4, 7, 2.4, ang, 0, Math.PI * 2);
        g.fill();
      }
    }
  } else if (kind === "alpine") {
    // ridgelines, chalets, a chairlift line
    g.fillStyle = shade(b1, 0.8);
    for (const [x, w, h] of [
      [-20, 120, 52],
      [70, 130, 66],
      [170, 130, 46],
    ] as const) {
      g.beginPath();
      g.moveTo(x, horizon);
      g.lineTo(x + w / 2, horizon - h);
      g.lineTo(x + w, horizon);
      g.fill();
      g.fillStyle = "#f4f7fb";
      g.beginPath();
      g.moveTo(x + w / 2 - w * 0.16, horizon - h * 0.72);
      g.lineTo(x + w / 2, horizon - h);
      g.lineTo(x + w / 2 + w * 0.16, horizon - h * 0.72);
      g.fill();
      g.fillStyle = shade(b1, 0.8);
    }
    house(g, 22, horizon, 26, 18, b0, "#5a4030");
    house(g, 200, horizon, 30, 20, b0, "#5a4030");
    g.strokeStyle = "#2b2118";
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(0, horizon - 34);
    g.lineTo(W, horizon - 12);
    g.stroke();
    for (const cx of [52, 130, 210]) {
      g.beginPath();
      g.moveTo(cx, horizon - 34 + (cx / W) * 22);
      g.lineTo(cx, horizon - 26 + (cx / W) * 22);
      g.stroke();
      g.fillStyle = "#b4653f";
      g.fillRect(cx - 4, horizon - 26 + (cx / W) * 22, 8, 6);
    }
  } else if (kind === "beach") {
    // sea band, pier posts and the Ferris wheel
    g.fillStyle = shade("#3a9ab0", 1.05);
    g.fillRect(0, horizon - 8, W, 10);
    g.fillStyle = t.special.glow;
    for (let i = 0; i < 9; i++) g.fillRect(i * 30 + 6, horizon - 6, 16, 1.4);
    ground(g, t, horizon + 2);
    const cx = W * 0.72,
      cy = horizon - 34,
      r = 26;
    g.strokeStyle = "#2b2118";
    g.lineWidth = 2;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.stroke();
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r);
      g.stroke();
      g.fillStyle = t.boss.glow;
      g.fillRect(cx + Math.cos(ang) * r - 2.5, cy + Math.sin(ang) * r - 2.5, 5, 5);
    }
    g.beginPath();
    g.moveTo(cx - 14, horizon + 2);
    g.lineTo(cx, cy);
    g.lineTo(cx + 14, horizon + 2);
    g.stroke();
    g.fillStyle = shade(b0, 0.95);
    g.fillRect(18, horizon - 10, 74, 7);
    for (let i = 0; i < 6; i++) g.fillRect(22 + i * 13, horizon - 3, 3, 7);
  } else if (kind === "western") {
    // twin mesas and the storefront row
    g.fillStyle = shade(b2, 0.85);
    g.fillRect(8, horizon - 40, 54, 40);
    g.fillRect(196, horizon - 34, 60, 34);
    g.fillStyle = shade(b1, 0.9);
    g.fillRect(70, horizon - 26, 40, 26);
    g.fillStyle = b0;
    house(g, 96, horizon, 26, 22, b0, shade(b0, 0.6));
    house(g, 128, horizon, 22, 18, shade(b1, 1.05), "#6a3a20");
    house(g, 156, horizon, 24, 26, b0, "#6a3a20");
    // church steeple
    g.fillStyle = shade(b0, 1.08);
    g.fillRect(176, horizon - 30, 12, 30);
    g.beginPath();
    g.moveTo(173, horizon - 30);
    g.lineTo(182, horizon - 42);
    g.lineTo(191, horizon - 30);
    g.fill();
    g.fillStyle = t.boss.glow;
    g.beginPath();
    g.arc(182, horizon - 24, 3, 0, Math.PI * 2);
    g.fill();
  } else if (kind === "nuketown") {
    // test-site suburb: fence, two houses, the tower
    ground(g, t, horizon);
    g.strokeStyle = "#ded6bb";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, horizon - 10);
    g.lineTo(W, horizon - 10);
    g.stroke();
    for (let x = 0; x < W; x += 8) {
      g.beginPath();
      g.moveTo(x, horizon - 12);
      g.lineTo(x, horizon - 6);
      g.stroke();
    }
    house(g, 30, horizon - 2, 34, 20, "#e3bf60", "#8a4a2a");
    house(g, 168, horizon - 2, 36, 22, "#68aaa1", "#8a4a2a");
    g.fillStyle = "#8a6a4a";
    g.fillRect(112, horizon - 46, 8, 46);
    g.fillStyle = "#e4b746";
    g.beginPath();
    g.arc(116, horizon - 50, 9, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#2b2118";
    g.beginPath();
    g.arc(116, horizon - 50, 4, 0, Math.PI * 2);
    g.fill();
  } else {
    // generic arena: stacked monuments
    g.fillStyle = shade(b2, 0.8);
    g.fillRect(30, horizon - 22, 40, 22);
    g.fillRect(180, horizon - 30, 52, 30);
    g.fillStyle = shade(b0, 0.95);
    g.fillRect(76, horizon - 36, 30, 36);
    g.fillRect(140, horizon - 18, 36, 18);
    g.fillStyle = t.boss.glow;
    g.fillRect(88, horizon - 42, 6, 6);
  }
  if (kind !== "beach" && kind !== "nuketown") ground(g, t, horizon);
  // vignette + paper grain
  const vg = g.createLinearGradient(0, 0, 0, H);
  vg.addColorStop(0, "rgba(20,14,8,0.0)");
  vg.addColorStop(1, "rgba(20,14,8,0.22)");
  g.fillStyle = vg;
  g.fillRect(0, 0, W, H);
}

export function MapThumb({ theme, className = "" }: { theme: Theme; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W * dpr;
    cv.height = H * dpr;
    const g = cv.getContext("2d")!;
    g.scale(dpr, dpr);
    paint(g, theme);
  }, [theme]);
  return (
    <canvas
      ref={ref}
      style={{ width: "100%", aspectRatio: `${W}/${H}` }}
      className={`block ${className}`}
      aria-hidden
    />
  );
}

/** one-line card descriptions, keyed by theme name (only `offered` maps get cards) */
export const MAP_BLURB: Record<string, { tag: string; blurb: string }> = {
  "Vice Heights": {
    tag: "PASTEL DOWNTOWN",
    blurb: "Towers, rooftops and working lifts under the Kingpin.",
  },
  "Whiteout Pass": {
    tag: "ALPINE VILLAGE",
    blurb: "Snowed-in chalets and a chairlift under the Avalanche Engine.",
  },
  "Pacific Pier": {
    tag: "BEACH BOARDWALK",
    blurb: "Surf, a Ferris wheel and the Kraken Rig offshore.",
  },
  "Dry Gulch": {
    tag: "RAILROAD FRONTIER",
    blurb: "A dust-blown boomtown; the Iron Marshal rides at noon.",
  },
  Nuketown: {
    tag: "TEST SITE",
    blurb: "A suburb built for the blast. The Test Subject waits.",
  },
};
