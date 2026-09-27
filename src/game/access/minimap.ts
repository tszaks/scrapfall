// Minimap icons for the access buildings: an up-arrow badge on elevator towers, a stairs badge
// on walk-ups, and a small marker at each lobby door. Buildings without access show nothing.
import { accessList } from "./world";

export function drawAccessIcons(
  g: CanvasRenderingContext2D,
  wx: (x: number) => number,
  wz: (z: number) => number,
  dpr: number,
  R: number,
  yaw: number,
) {
  const list = accessList();
  if (list.length === 0) return;
  const pad = 9 * dpr;
  for (const b of list) {
    const r = b.spec.roof;
    const cx = wx((r.x0 + r.x1) / 2);
    const cz = wz((r.z0 + r.z1) / 2);
    const dx = wx(b.ox);
    const dz = wz(b.oz);
    if (cx * cx + cz * cz > (R + pad) * (R + pad)) continue;
    // lobby door: a small bright bar across the doorway
    const alongX = Math.abs(b.tx) > 0.5;
    g.fillStyle = b.kind === "elevator" ? "#ffb838" : "#4fe39a";
    g.strokeStyle = "#2b2118";
    g.lineWidth = dpr;
    g.save();
    g.translate(dx, dz);
    g.rotate(alongX ? 0 : Math.PI / 2);
    g.fillRect(-3 * dpr, -1.5 * dpr, 6 * dpr, 3 * dpr);
    g.strokeRect(-3 * dpr, -1.5 * dpr, 6 * dpr, 3 * dpr);
    g.restore();
    // badge, kept upright on the rotating radar
    g.save();
    g.translate(cx, cz);
    g.rotate(-yaw);
    const s = 6.5 * dpr;
    if (b.kind === "elevator") {
      g.fillStyle = "#1b2a4a";
      g.strokeStyle = "#f3e6cf";
      g.lineWidth = 1.4 * dpr;
      g.beginPath();
      g.arc(0, 0, s, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = "#ffb838";
      g.beginPath();
      g.moveTo(0, -s * 0.62);
      g.lineTo(s * 0.55, s * 0.05);
      g.lineTo(s * 0.2, s * 0.05);
      g.lineTo(s * 0.2, s * 0.6);
      g.lineTo(-s * 0.2, s * 0.6);
      g.lineTo(-s * 0.2, s * 0.05);
      g.lineTo(-s * 0.55, s * 0.05);
      g.closePath();
      g.fill();
    } else {
      g.fillStyle = "#123a26";
      g.strokeStyle = "#f3e6cf";
      g.lineWidth = 1.4 * dpr;
      g.beginPath();
      g.rect(-s, -s, s * 2, s * 2);
      g.fill();
      g.stroke();
      // a three-step staircase glyph
      g.fillStyle = "#7dffb4";
      g.beginPath();
      g.moveTo(-s * 0.62, s * 0.6);
      g.lineTo(-s * 0.62, s * 0.22);
      g.lineTo(-s * 0.2, s * 0.22);
      g.lineTo(-s * 0.2, -s * 0.16);
      g.lineTo(s * 0.2, -s * 0.16);
      g.lineTo(s * 0.2, -s * 0.54);
      g.lineTo(s * 0.62, -s * 0.54);
      g.lineTo(s * 0.62, s * 0.6);
      g.closePath();
      g.fill();
    }
    g.restore();
  }
}
