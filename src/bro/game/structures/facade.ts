import type { Structure } from "./plan";
/** Rectangular pieces of an existing facade left around real, world-coordinate rooms. */
export function facadePieces(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  y0: number,
  y1: number,
  rooms: readonly Structure[],
) {
  const dx = bx - ax,
    dz = bz - az,
    alongX = Math.abs(dx) > Math.abs(dz);
  const cuts: { t0: number; t1: number; y0: number; y1: number }[] = [];
  for (const p of rooms) {
    const r = p.bounds;
    if (alongX ? az < r.z0 - 0.25 || az > r.z1 + 0.25 : ax < r.x0 - 0.25 || ax > r.x1 + 0.25)
      continue;
    const a = alongX ? (r.x0 - ax) / dx : (r.z0 - az) / dz,
      b = alongX ? (r.x1 - ax) / dx : (r.z1 - az) / dz;
    const t0 = Math.max(0, Math.min(a, b)),
      t1 = Math.min(1, Math.max(a, b)),
      lo = Math.max(y0, p.base),
      hi = Math.min(y1, p.top);
    if (t1 > t0 && hi > lo) cuts.push({ t0, t1, y0: lo, y1: hi });
  }
  const ts = [...new Set([0, 1, ...cuts.flatMap((c) => [c.t0, c.t1])])].sort((a, b) => a - b);
  const ys = [...new Set([y0, y1, ...cuts.flatMap((c) => [c.y0, c.y1])])].sort((a, b) => a - b);
  const out: { t0: number; t1: number; y0: number; y1: number }[] = [];
  for (let i = 0; i < ts.length - 1; i++)
    for (let j = 0; j < ys.length - 1; j++) {
      const ta = ts[i]!,
        tb = ts[i + 1]!,
        ya = ys[j]!,
        yb = ys[j + 1]!,
        tm = (ta + tb) / 2,
        ym = (ya + yb) / 2;
      if (!cuts.some((c) => tm > c.t0 && tm < c.t1 && ym > c.y0 && ym < c.y1))
        out.push({ t0: ta, t1: tb, y0: ya, y1: yb });
    }
  return out;
}
