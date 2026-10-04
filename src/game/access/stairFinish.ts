import type { IGeo } from "./geo";
import { BULKHEAD_H, type AccessBuilding } from "./layout";

/** Finish bonded to existing walls: no freestanding collision, threshold or new draw call. */
export function stairFinish(g: IGeo, b: AccessBuilding) {
  const s = b.stair!;
  const w = s.W / 2,
    end = s.v0 + s.Ls + s.Lr + s.Ln;
  const rustic = b.spec.doorStyle === "wood";
  const top = b.room ? b.top : b.top + BULKHEAD_H;
  for (let n = 0; n < s.laps; n++) {
    const y = b.groundY + n * s.h;
    // Wall base scuffs follow each landing rather than a stripe floating beside a flight.
    for (const a of [-w, w]) {
      const inset = a < 0 ? 0.018 : -0.018;
      g.color(rustic ? "#554c3e" : "#696d67");
      g.wallA(n === 0 ? 0.25 : s.v0, s.v0 + s.Ls, y + 0.035, y + 0.15, a + inset, a < 0);
      g.wallA(end - s.Ln, end, y + s.h / 2 + 0.035, y + s.h / 2 + 0.15, a + inset, a < 0);
    }
    // A shallow junction box and its conduit sit against the closed back wall.
    if (!rustic && y + s.h / 2 + 1.75 < top) {
      const h = y + s.h / 2;
      g.color("#555b58");
      g.box(w - 0.48, w - 0.25, h + 0.75, h + 1.04, end - 0.055, end, "+d");
      g.color("#a4a79b");
      g.box(w - 0.44, w - 0.29, h + 0.8, h + 0.99, end - 0.065, end - 0.055, "+d");
      g.box(w - 0.38, w - 0.35, h + 1.04, Math.min(top, h + 2.4), end - 0.027, end, "+d");
    }
  }
}
