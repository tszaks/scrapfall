// Big-map minimap: a rotating radar in the HUD corner. The map is painted once per arena
// by the map (cityMinimap.ts, western/minimap.ts); each frame draws the slice
// around the player, turned so "up" is where you are looking, plus teammates (in their
// player colours), enemies, the boss and pickups. Off-map teammates and pickups stick to
// the rim so you can always find them.
import { useEffect, useRef } from "react";

import { pursuitDots } from "./trafficCore";

export type MapItem = {
  x: number;
  z: number;
  kind: "gun" | "heal" | "crate";
  color: string;
  active: boolean;
};
export type MapFeed = { x: number; z: number; yaw: number; items: MapItem[] };
/** What a big map hands the radar: its painted base map and a few landmarks. */
export type MinimapSource = {
  cells: number;
  half: number;
  /** one pixel per 2 m cell, canvas x = world x, canvas y = world z */
  base: HTMLCanvasElement;
  /** colour of the land beyond the map */
  land: string;
  /** the sea south of this z (the city's waterfront) */
  sea: { z: number; color: string } | null;
  /** the sea west of this x (the beach's Pacific) */
  seaWest?: { x: number; color: string };
  landmark: { x: number; z: number } | null;
  /** half-size of the playable square (solo); the area beyond it is dimmed */
  playHalf: number;
};
type MapEnemy = { x: number; z: number; alive: boolean; kind: string; elite?: number; vis?: number };
type MapRemote = { x: number; z: number; color: string; hp: number; last: number };

const SIZE = 184; // css px
const RANGE = 95; // metres from the centre to the rim

export function Minimap({
  src,
  feed,
  enemies,
  remotes,
  myColor,
}: {
  src: MinimapSource;
  feed: React.MutableRefObject<MapFeed>;
  enemies: MapEnemy[];
  remotes: React.MutableRefObject<Map<string, MapRemote>>;
  myColor: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const base = src.base;
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
      g.fillStyle = src.land;
      g.fillRect(-R * 2, -R * 2, R * 4, R * 4);
      if (src.sea) {
        g.fillStyle = src.sea.color;
        g.fillRect(-R * 3, wz(src.sea.z), R * 6, R * 6);
      }
      if (src.seaWest) {
        g.fillStyle = src.seaWest.color;
        g.fillRect(wx(src.seaWest.x) - R * 6, -R * 3, R * 6, R * 6);
      }
      g.imageSmoothingEnabled = false;
      g.drawImage(base, wx(-src.half), wz(-src.half), src.cells * 2 * s, src.cells * 2 * s);
      // solo: everything beyond the blockades is dimmed, the edge drawn as a dashed line
      if (src.playHalf < src.half - 1) {
        const p0 = -src.playHalf;
        const p1 = src.playHalf;
        const far = src.half * 3;
        g.fillStyle = "rgba(24,18,12,0.62)";
        g.fillRect(wx(-far), wz(-far), far * 2 * s, (far - p1) * s); // north
        g.fillRect(wx(-far), wz(p1), far * 2 * s, (far - p1) * s); // south
        g.fillRect(wx(-far), wz(p0), (far - p1) * s, (p1 - p0) * s); // west
        g.fillRect(wx(p1), wz(p0), (far - p1) * s, (p1 - p0) * s); // east
        g.setLineDash([6 * dpr, 4 * dpr]);
        g.strokeStyle = "rgba(200,40,24,0.95)";
        g.lineWidth = 2.2 * dpr;
        g.strokeRect(wx(p0), wz(p0), (p1 - p0) * s, (p1 - p0) * s);
        g.setLineDash([]);
      }
      if (src.landmark) {
        g.fillStyle = "#2b2118";
        g.beginPath();
        g.arc(wx(src.landmark.x), wz(src.landmark.z), 4 * dpr, 0, Math.PI * 2);
        g.fill();
      }
      // enemies
      for (const e of enemies) {
        if (!e.alive) continue;
        if (e.kind === "cloaker" && ((e.vis ?? 0) >> 6) === 1) continue; // cloaked: off the radar too
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
      // police chases: cruisers flash red/blue (on the rim when they're further out, so you
      // see them coming), the suspect is a small white dot
      const blink = Math.floor(now / 160) % 2 === 0;
      for (const d of pursuitDots) {
        const x0 = wx(d.x);
        const z0 = wz(d.z);
        const inside = x0 * x0 + z0 * z0 < (R - 4 * dpr) ** 2;
        if (d.kind === 2) {
          if (!inside) continue;
          g.fillStyle = "#ffffff";
          g.strokeStyle = "#2b2118";
          g.lineWidth = dpr;
          g.beginPath();
          g.arc(x0, z0, 2.6 * dpr, 0, Math.PI * 2);
          g.fill();
          g.stroke();
          continue;
        }
        if (!inside && Math.hypot(d.x - f.x, d.z - f.z) > 300) continue;
        const [x, z] = rim(x0, z0, 6);
        const red = blink !== (d.i % 2 === 0);
        g.fillStyle = red ? "#ff2a22" : "#2f64ff";
        g.strokeStyle = "#f3e6cf";
        g.lineWidth = 1.2 * dpr;
        g.beginPath();
        g.arc(x!, z!, (inside ? 4 : 3.2) * dpr, 0, Math.PI * 2);
        g.fill();
        g.stroke();
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
  }, [base, src, enemies, feed, remotes]);

  return (
    <div className="rounded-full bg-[#f3e6cf]/80 p-1 shadow-md">
      <canvas ref={ref} style={{ width: SIZE, height: SIZE }} className="block rounded-full" />
    </div>
  );
}
