import { Geo, L, sideOf, type P2 } from "../cityGeo";
import { MODULE_W } from "../cityTextures";
import { facadePieces } from "../structures/facade";
import type { Structure } from "../structures/plan";

type FacadeStyle = { layer: number; tint: number; fh: number; seed: number; uOff: number };

/** Shallow construction relief on the lower six floors, baked into the existing detail
 * chunk. Uses the facade texture's module grid; never puts a ledge across a real room.
 * Everything is above the player and cosmetic, so LOW cannot change movement. */
export function facadeDepth(
  g: Geo,
  poly: P2[],
  y0: number,
  y1: number,
  st: FacadeStyle,
  street: number,
  store: boolean,
  rooms: readonly Structure[] = [],
) {
  const supported: number[] = [L.glass, L.dark, L.ribbon, L.office, L.brick, L.resid, L.panel];
  if (!supported.includes(st.layer)) return;
  const start = g.n;
  for (let edge = 0; edge < poly.length; edge++) {
    const p = poly[edge]!,
      q = poly[(edge + 1) % poly.length]!;
    const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (length < 3 || length > 100) continue;
    const ux = (q[0] - p[0]) / length,
      uz = (q[1] - p[1]) / length;
    const nx = uz,
      nz = -ux,
      rotation = Math.atan2(nx, nz);
    const side = sideOf(p, q);
    const storefront = store && y0 < 0.1 && y1 > 6 && side >= 0 && ((street >> side) & 1) === 1;
    const base = storefront ? 4.5 : 0;
    const modules = Math.max(1, Math.round(length / (MODULE_W[st.layer] ?? 3)));
    const mw = length / modules;
    const top = Math.min(y1, 26, base + st.fh * 6);
    const spans = facadePieces(p[0], p[1], q[0], q[1], Math.max(3.05, y0), top, rooms);
    const box = (
      a: number,
      b: number,
      lo: number,
      hi: number,
      depth: number,
      color: number | string,
    ) => {
      if (lo < Math.max(3.05, y0) || hi > top || b <= a) return;
      if (
        !spans.some(
          (s) =>
            a >= s.t0 * length - 0.001 && b <= s.t1 * length + 0.001 && lo >= s.y0 && hi <= s.y1,
        )
      )
        return;
      const t = (a + b) / 2;
      g.mat(L.plain, st.seed, 1).col(color);
      g.obox(
        p[0] + ux * t + nx * depth * 0.45,
        lo,
        p[1] + uz * t + nz * depth * 0.45,
        b - a,
        hi - lo,
        depth,
        rotation,
        true,
        true,
      );
    };
    for (
      let floor = Math.max(0, Math.floor((y0 - base) / st.fh));
      base + floor * st.fh < top;
      floor++
    ) {
      const y = base + floor * st.fh;
      // Ribbon windows get continuous sill/drip edges and real vertical mullions.
      if (st.layer === L.ribbon || st.layer === L.glass || st.layer === L.dark) {
        const ribbon = st.layer === L.ribbon;
        const lo = y + st.fh * (ribbon ? 9 / 32 : 4 / 32);
        const hi = y + st.fh * (ribbon ? 23 / 32 : 31 / 32);
        // Continuous courses avoid rebuilding a sill box for every pane.
        for (const span of spans) {
          const a = span.t0 * length,
            b = span.t1 * length;
          box(a, b, lo - 0.075, lo, ribbon ? 0.18 : 0.09, ribbon ? st.tint : "#687378");
          box(a, b, hi, hi + 0.055, 0.1, ribbon ? st.tint : "#687378");
        }
        for (let m = 0; m < modules; m++) {
          const a = m * mw;
          box(a, a + Math.min(0.055, mw / 32), lo, hi, 0.085, "#586269");
        }
      } else {
        for (let m = 0; m < modules; m++) {
          const col = st.uOff + modules - 1 - m;
          // Canvas rows run downward; geometry UVs run upward.
          const door = st.layer === L.resid && col % 2 === 0;
          const left = st.layer === L.brick ? 8 : st.layer === L.office ? 5 : door ? 6 : 8;
          const bottom = st.layer === L.brick ? 5 : st.layer === L.office ? 7 : door ? 1 : 9;
          const upper = st.layer === L.brick ? 26 : st.layer === L.office ? 25 : door ? 27 : 23;
          const a = (m + left / 32) * mw,
            b = (m + 1 - left / 32) * mw;
          const lo = y + (bottom / 32) * st.fh,
            hi = y + (upper / 32) * st.fh;
          box(a - 0.055, b + 0.055, lo - 0.09, lo, 0.19, "#b6b3a7");
          box(a - 0.04, b + 0.04, hi, hi + 0.075, 0.12, "#c0bcb0");
          box(a - 0.04, a + 0.025, lo, hi, 0.09, "#797c77");
          box(b - 0.025, b + 0.04, lo, hi, 0.09, "#797c77");
        }
      }
    }
  }
  g.excludeSince(start);
  g.highDetailSince(start);
}
