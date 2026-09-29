// Minimap icons for the access buildings: an up-arrow badge on elevator towers, a stairs badge
// on walk-ups, and a small marker at each lobby door. Buildings without access show nothing.
import { accessList, accessMarkers } from "./world";
import type { AccessKind } from "./types";

export function drawAccessIcons(
  g: CanvasRenderingContext2D,
  wx: (x: number) => number,
  wz: (z: number) => number,
  dpr: number,
  R: number,
  yaw: number,
) {
  const list = accessList();
  const marks = accessMarkers();
  if (list.length === 0 && marks.length === 0) return;
  const pad = 9 * dpr;
  const inside = (x: number, z: number) => x * x + z * z <= (R + pad) * (R + pad);
  for (const b of list) {
    const r = b.spec.roof;
    const cx = wx((r.x0 + r.x1) / 2);
    const cz = wz((r.z0 + r.z1) / 2);
    const dx = wx(b.ox);
    const dz = wz(b.oz);
    if (!inside(cx, cz)) continue;
    // lobby door / ladder foot: a small bright bar across the doorway
    const alongX = Math.abs(b.tx) > 0.5;
    g.fillStyle = COL[b.kind];
    g.strokeStyle = "#2b2118";
    g.lineWidth = dpr;
    g.save();
    g.translate(dx, dz);
    g.rotate(alongX ? 0 : Math.PI / 2);
    g.fillRect(-3 * dpr, -1.5 * dpr, 6 * dpr, 3 * dpr);
    g.strokeRect(-3 * dpr, -1.5 * dpr, 6 * dpr, 3 * dpr);
    g.restore();
    badge(g, b.kind, cx, cz, dpr, yaw, b.kind === "ladder" ? 0.8 : 1);
  }
  for (const m of marks) {
    const x = wx(m.x);
    const z = wz(m.z);
    if (inside(x, z)) badge(g, m.kind, x, z, dpr, yaw, 0.9);
  }
}

const COL: Record<AccessKind, string> = { elevator: "#ffb838", stairs: "#4fe39a", ladder: "#ff8a4a" };

/** a badge kept upright on the rotating radar: up-arrow (elevator), steps (stairs), rungs (ladder) */
function badge(g: CanvasRenderingContext2D, kind: AccessKind, cx: number, cz: number, dpr: number, yaw: number, k: number) {
  g.save();
  g.translate(cx, cz);
  g.rotate(-yaw);
  const s = 6.5 * dpr * k;
  g.strokeStyle = "#f3e6cf";
  g.lineWidth = 1.4 * dpr;
  if (kind === "elevator") {
    g.fillStyle = "#1b2a4a";
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
  } else if (kind === "stairs") {
    g.fillStyle = "#123a26";
    g.beginPath();
    g.rect(-s, -s, s * 2, s * 2);
    g.fill();
    g.stroke();
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
  } else {
    // a diamond with two rails and three rungs
    g.fillStyle = "#4a2410";
    g.beginPath();
    g.moveTo(0, -s * 1.15);
    g.lineTo(s * 1.15, 0);
    g.lineTo(0, s * 1.15);
    g.lineTo(-s * 1.15, 0);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = "#ffae6a";
    g.fillRect(-s * 0.42, -s * 0.62, s * 0.16, s * 1.24);
    g.fillRect(s * 0.26, -s * 0.62, s * 0.16, s * 1.24);
    for (const y of [-0.4, 0, 0.4]) g.fillRect(-s * 0.3, s * y - s * 0.07, s * 0.6, s * 0.14);
  }
  g.restore();
}
