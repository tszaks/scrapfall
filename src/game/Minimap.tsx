// Big-map radar (after tszaks/scrapfall): a rotating map in the HUD corner, "up" is where you
// look. Shows the painted base map, teammates in their colours and enemies (boss larger).
import { useEffect, useRef } from "react";

export const radarFeed = { x: 0, z: 0, yaw: 0 };

type Enemy = { x: number; z: number; alive: boolean; kind: string };
type Mate = { x: number; z: number; color: string; hp: number; last: number };

const SIZE = 150;
const RANGE = 40; // metres from the centre to the rim

export function Minimap({
  base,
  half,
  enemies,
  remotes,
  myColor,
  compact,
}: {
  base: HTMLCanvasElement;
  half: number;
  enemies: Enemy[];
  remotes: React.MutableRefObject<Map<string, Mate>>;
  myColor: string;
  compact?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const size = compact ? 110 : SIZE;
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = size * dpr;
    cv.height = size * dpr;
    const g = cv.getContext("2d")!;
    const px = size / 2 / RANGE; // css px per metre
    let raf = 0;
    let last = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 45) return;
      last = now;
      const { x, z, yaw } = radarFeed;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, size, size);
      g.save();
      g.beginPath();
      g.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
      g.clip();
      g.fillStyle = "#9aa6b2";
      g.fillRect(0, 0, size, size);
      // world -> radar: translate to player, rotate so look direction is up
      g.translate(size / 2, size / 2);
      g.rotate(yaw);
      g.scale(px, px);
      g.translate(-x, -z);
      g.imageSmoothingEnabled = false;
      g.drawImage(base, -half, -half, half * 2, half * 2);
      const now2 = performance.now();
      for (const r of remotes.current.values()) {
        if (now2 - r.last > 5000) continue;
        g.fillStyle = r.hp > 0 ? r.color : "#555";
        g.beginPath();
        g.arc(r.x, r.z, 1.4, 0, Math.PI * 2);
        g.fill();
      }
      for (const e of enemies) {
        if (!e.alive) continue;
        g.fillStyle = e.kind === "boss" ? "#ff2a1a" : "#d8342a";
        g.beginPath();
        g.arc(e.x, e.z, e.kind === "boss" ? 2.2 : 0.9, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
      // you: an arrow pointing up
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = myColor;
      g.strokeStyle = "#2b2118";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(size / 2, size / 2 - 7);
      g.lineTo(size / 2 + 5, size / 2 + 5);
      g.lineTo(size / 2, size / 2 + 2);
      g.lineTo(size / 2 - 5, size / 2 + 5);
      g.closePath();
      g.fill();
      g.stroke();
      g.strokeStyle = "rgba(43,33,24,0.8)";
      g.lineWidth = 2;
      g.beginPath();
      g.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
      g.stroke();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [base, half, enemies, remotes, myColor, size]);
  return <canvas ref={ref} style={{ width: size, height: size }} className="rounded-full" />;
}
