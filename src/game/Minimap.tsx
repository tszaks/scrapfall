// City minimap: a rotating radar in the HUD corner. The street map is painted once per
// city (one pixel per 2 m cell, buildings shaded by height); each frame draws the slice
// around the player, turned so "up" is where you are looking, plus teammates (in their
// player colours), enemies, the boss and pickups. Off-map teammates and pickups stick to
// the rim so you can always find them.
import { useEffect, useMemo, useRef } from "react";

import {
  K_ALLEY,
  K_BOARD,
  K_MEDIAN,
  K_OPEN,
  K_PARK,
  K_PARKLANE,
  K_PATH,
  K_ROAD,
  K_WALK,
  type CityLayout,
} from "./cityLayout";
import type { Block } from "./level";
import type { AlpineLayout } from "./alpine/layout";
import { paintAlpine } from "./alpine/minimap";

export type MapItem = {
  x: number;
  z: number;
  kind: "gun" | "heal" | "crate";
  color: string;
  active: boolean;
};
export type MapFeed = { x: number; z: number; yaw: number; items: MapItem[] };
type MapEnemy = { x: number; z: number; alive: boolean; kind: string; elite?: number };
type MapRemote = { x: number; z: number; color: string; hp: number; last: number };

const SIZE = 184; // css px
const RANGE = 95; // metres from the centre to the rim

const KIND_COL: Record<number, [number, number, number]> = {
  [K_ROAD]: [70, 72, 78],
  [K_PARKLANE]: [82, 84, 90],
  [K_WALK]: [196, 188, 172],
  [K_MEDIAN]: [120, 150, 90],
  [K_ALLEY]: [90, 90, 94],
  [K_PARK]: [118, 160, 86],
  [K_PATH]: [210, 192, 150],
  [K_BOARD]: [176, 138, 96],
  [K_OPEN]: [206, 198, 182],
};

function paintBase(city: CityLayout, blocks: Block[]) {
  const n = city.cells;
  const c = document.createElement("canvas");
  c.width = n;
  c.height = n;
  const g = c.getContext("2d")!;
  const img = g.createImageData(n, n);
  const heights = new Float32Array(n * n);
  for (const b of blocks) {
    const i = Math.floor((b.x + city.half) / 2);
    const j = Math.floor((b.z + city.half) / 2);
    if (i >= 0 && j >= 0 && i < n && j < n) heights[i * n + j] = Math.max(heights[i * n + j]!, b.h);
  }
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const k = city.kind[i * n + j]!;
      const h = heights[i * n + j]!;
      let col = KIND_COL[k] ?? [150, 144, 132];
      if (h > 0 && k !== K_PARKLANE && k !== K_ROAD) {
        // buildings: darker the taller, in the HUD's ink colour
        const t = Math.min(1, Math.log2(1 + h / 6) / 5.5);
        col = [Math.round(150 - 107 * t), Math.round(140 - 107 * t), Math.round(124 - 100 * t)];
      }
      const o = (j * n + i) * 4; // canvas x = world x, canvas y = world z
      img.data[o] = col[0];
      img.data[o + 1] = col[1];
      img.data[o + 2] = col[2];
      img.data[o + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return c;
}

export function Minimap({
  city,
  blocks,
  feed,
  enemies,
  remotes,
  myColor,
}: {
  city: CityLayout;
  blocks: Block[];
  feed: React.MutableRefObject<MapFeed>;
  enemies: MapEnemy[];
  remotes: React.MutableRefObject<Map<string, MapRemote>>;
  myColor: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const alpine = "alpine" in city;
  const base = useMemo(
    () => ("alpine" in city ? paintAlpine(city as AlpineLayout) : paintBase(city, blocks)),
    [city, blocks],
  );
  const colorRef = useRef(myColor);
  colorRef.current = myColor;

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = SIZE * dpr;
    cv.height = SIZE * dpr;
    const g = cv.getContext("2d")!;
    let raf = 0;
    let last = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 45) return; // ~20 fps is plenty for a radar
      last = now;
      const f = feed.current;
      const R = (SIZE / 2) * dpr;
      const s = R / RANGE; // px per metre
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, cv.width, cv.height);
      g.save();
      g.beginPath();
      g.arc(R, R, R - 1, 0, Math.PI * 2);
      g.clip();
      g.translate(R, R);
      g.rotate(f.yaw);
      const wx = (x: number) => (x - f.x) * s;
      const wz = (z: number) => (z - f.z) * s;
      // backdrop land, the sea, then the street map
      g.fillStyle = alpine ? "#8a9098" : "#a8a397";
      g.fillRect(-R * 2, -R * 2, R * 4, R * 4);
      if (!alpine) {
        g.fillStyle = "#4f8fb0";
        g.fillRect(-R * 3, wz(city.waterZ), R * 6, R * 6);
      }
      g.imageSmoothingEnabled = false;
      g.drawImage(base, wx(-city.half), wz(-city.half), city.cells * 2 * s, city.cells * 2 * s);
      if (city.landmark) {
        g.fillStyle = "#2b2118";
        g.beginPath();
        g.arc(wx(city.landmark.x), wz(city.landmark.z), 4 * dpr, 0, Math.PI * 2);
        g.fill();
      }
      // enemies
      for (const e of enemies) {
        if (!e.alive) continue;
        const x = wx(e.x);
        const z = wz(e.z);
        if (x * x + z * z > R * R) continue;
        const boss = e.kind === "boss";
        g.fillStyle = boss ? "#7a0f0a" : e.elite ? "#e8b020" : "#e8322a";
        g.strokeStyle = "#2b2118";
        g.lineWidth = dpr;
        g.beginPath();
        g.arc(x, z, (boss ? 5.5 : e.elite ? 4 : 2.6) * dpr, 0, Math.PI * 2);
        g.fill();
        if (boss || e.elite) g.stroke();
      }
      // pickups and teammates stick to the rim when they're off the map
      const rim = (x: number, z: number, pad: number) => {
        const d = Math.hypot(x, z);
        const max = R - pad * dpr;
        return d > max ? [(x / d) * max, (z / d) * max, 1] : [x, z, 0];
      };
      for (const it of f.items) {
        if (!it.active) continue;
        const [x, z] = rim(wx(it.x), wz(it.z), 7);
        g.fillStyle = it.color;
        g.strokeStyle = "#2b2118";
        g.lineWidth = 1.2 * dpr;
        if (it.kind === "heal") {
          g.fillRect(x! - 1.5 * dpr, z! - 5 * dpr, 3 * dpr, 10 * dpr);
          g.fillRect(x! - 5 * dpr, z! - 1.5 * dpr, 10 * dpr, 3 * dpr);
        } else {
          g.beginPath();
          g.rect(x! - 4 * dpr, z! - 4 * dpr, 8 * dpr, 8 * dpr);
          g.fill();
          g.stroke();
        }
      }
      const now2 = performance.now();
      remotes.current.forEach((r) => {
        if (now2 - r.last > 4000) return;
        const [x, z] = rim(wx(r.x), wz(r.z), 8);
        g.fillStyle = r.hp > 0 ? r.color : "#8a8680";
        g.strokeStyle = "#2b2118";
        g.lineWidth = 1.5 * dpr;
        g.beginPath();
        g.arc(x!, z!, 5 * dpr, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      });
      g.restore();
      // me: an arrow pointing where I look (always up), then the rim and a north marker
      g.save();
      g.translate(R, R);
      g.fillStyle = colorRef.current;
      g.strokeStyle = "#2b2118";
      g.lineWidth = 1.6 * dpr;
      g.beginPath();
      g.moveTo(0, -8 * dpr);
      g.lineTo(6 * dpr, 7 * dpr);
      g.lineTo(0, 3.5 * dpr);
      g.lineTo(-6 * dpr, 7 * dpr);
      g.closePath();
      g.fill();
      g.stroke();
      g.restore();
      g.strokeStyle = "#2b2118";
      g.lineWidth = 2.5 * dpr;
      g.beginPath();
      g.arc(R, R, R - 1.5 * dpr, 0, Math.PI * 2);
      g.stroke();
      const nx = R + Math.sin(f.yaw) * (R - 11 * dpr);
      const ny = R - Math.cos(f.yaw) * (R - 11 * dpr);
      g.fillStyle = "#f3e6cf";
      g.beginPath();
      g.arc(nx, ny, 8 * dpr, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = "#2b2118";
      g.font = `bold ${10 * dpr}px ui-monospace, monospace`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("N", nx, ny + 0.5 * dpr);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [alpine, base, city, enemies, feed, remotes]);

  return (
    <div className="rounded-full bg-[#f3e6cf]/80 p-1 shadow-md">
      <canvas ref={ref} style={{ width: SIZE, height: SIZE }} className="block rounded-full" />
    </div>
  );
}
