import { Model } from "../art/kit";
import type { Structure } from "./plan";

/** Trim follows real wall pieces, so sill caps and jambs cannot bridge a usable opening. */
export function constructionDetail(m: Model, p: Structure) {
  let count = 0;
  const timber = p.kind === "chalet" || p.kind === "lodge" || p.kind === "hotel";
  const trim = timber ? "#705946" : "#b3b1a7";
  const foot = timber ? "#79756c" : "#959c98";
  for (const v of p.solids) {
    if (v.hidden || v.glass || v.glow) continue;
    const w = v.x1 - v.x0,
      d = v.z1 - v.z0,
      h = v.y1 - v.y0;
    // Only thin exterior wall pieces; never decks, internal partitions or host-shell proxies.
    if (h < 0.3 || Math.min(w, d) > 0.3) continue;
    const faces: { alongX: boolean; edge: number; sign: number }[] = [];
    if (d <= 0.3 && Math.abs(v.z0 - p.bounds.z0) < 0.01)
      faces.push({ alongX: true, edge: v.z0, sign: -1 });
    if (d <= 0.3 && Math.abs(v.z1 - p.bounds.z1) < 0.01)
      faces.push({ alongX: true, edge: v.z1, sign: 1 });
    if (w <= 0.3 && Math.abs(v.x0 - p.bounds.x0) < 0.01)
      faces.push({ alongX: false, edge: v.x0, sign: -1 });
    if (w <= 0.3 && Math.abs(v.x1 - p.bounds.x1) < 0.01)
      faces.push({ alongX: false, edge: v.x1, sign: 1 });
    for (const { alongX, edge, sign } of faces) {
      const a = alongX ? v.x0 : v.z0,
        b = alongX ? v.x1 : v.z1;
      const strip = (
        u0: number,
        u1: number,
        y0: number,
        y1: number,
        color: string,
        relief = 0.016,
      ) => {
        if (u1 - u0 < 0.025 || y1 - y0 < 0.025) return;
        // Jambs remain flush; deeper drip edges are confined above player height.
        const center = edge + sign * (relief / 2 - 0.004);
        count++;
        m.box(
          alongX ? u1 - u0 : relief,
          y1 - y0,
          alongX ? relief : u1 - u0,
          [alongX ? (u0 + u1) / 2 : center, (y0 + y1) / 2, alongX ? center : (u0 + u1) / 2],
          color,
          [0.83, 0, 0.015, 0],
        );
      };
      if (b - a < 0.5) {
        // Narrow existing piers define the window/door reveals without covering glass.
        strip(a + 0.025, b - 0.025, v.y0 + 0.025, v.y1 - 0.025, trim);
      } else {
        if (Math.abs(v.y0 - p.base) < 0.02)
          strip(a, b, v.y0 + 0.015, v.y0 + Math.min(0.24, h * 0.3), foot);
        // Split wall fragments naturally put caps directly below glazing and above doors.
        strip(
          a,
          b,
          v.y1 - Math.min(0.09, h * 0.2),
          v.y1 - 0.008,
          trim,
          v.y1 > p.base + 2.8 ? 0.12 : 0.016,
        );
        if (h > 1.2) strip(a, b, v.y0 + 0.008, v.y0 + 0.075, trim);
        // Weatherboard courses stay within the physical wall fragments; the upper
        // fascia has a real drip edge, while all eye-height trim remains flush.
        if (timber && h > 1.2 && b - a > 1) {
          for (let y = v.y0 + 0.3; y < v.y1 - 0.12; y += 0.3)
            strip(a + 0.02, b - 0.02, y, y + 0.028, "#584c3f");
        }
        // Bounded panel joints give blank side walls construction scale.
        if (h > 2 && b - a > 5) {
          const bays = Math.min(6, Math.ceil((b - a) / 4));
          for (let i = 1; i < bays; i++) {
            const u = a + ((b - a) * i) / bays;
            strip(u - 0.02, u + 0.02, v.y0 + 0.25, v.y1 - 0.1, foot);
          }
        }
      }
    }
  }
  return count;
}
