// Dry Gulch on the HUD radar: the street, boardwalks and buildings, the rail line, the dry
// riverbed and the red rock (shaded by height), one pixel per 2 m cell.
import type { Block } from "../level";
import type { MinimapSource } from "../Minimap";
import { WK, type WesternLayout } from "./layout";

const COL: Record<number, [number, number, number]> = {
  [WK.DESERT]: [214, 180, 132],
  [WK.STREET]: [176, 136, 96],
  [WK.BOARD]: [150, 112, 76],
  [WK.LOT]: [110, 84, 62],
  [WK.RAIL]: [92, 80, 72],
  [WK.RIVER]: [226, 204, 168],
  [WK.TRAIL]: [192, 154, 110],
  [WK.YARD]: [196, 160, 118],
  [WK.PLATFORM]: [140, 104, 72],
};

export function westernMinimap(L: WesternLayout, blocks: Block[], playHalf: number): MinimapSource {
  const n = L.cells;
  const c = document.createElement("canvas");
  c.width = n;
  c.height = n;
  const g = c.getContext("2d")!;
  const img = g.createImageData(n, n);
  const solidH = new Float32Array(n * n);
  for (const b of blocks) {
    const i = Math.floor((b.x + L.half) / 2);
    const j = Math.floor((b.z + L.half) / 2);
    if (i >= 0 && j >= 0 && i < n && j < n) solidH[i * n + j] = Math.max(solidH[i * n + j]!, b.h);
  }
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const k = i * n + j;
      const kind = L.ground[k]!;
      const r = L.rock[k]!;
      let col = COL[kind] ?? COL[WK.DESERT]!;
      if (r > 0) {
        // red rock, darker the higher it stands
        const t = Math.min(1, r / 50);
        col = [Math.round(186 - 80 * t), Math.round(96 - 50 * t), Math.round(62 - 30 * t)];
      } else if (kind === WK.LOT) {
        col = [96, 70, 52];
      } else if (solidH[k]! > 0 && kind !== WK.RAIL) {
        // wagons, troughs, boulders, fences
        col = [128, 98, 72];
      }
      const o = (j * n + i) * 4;
      img.data[o] = col[0];
      img.data[o + 1] = col[1];
      img.data[o + 2] = col[2];
      img.data[o + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return {
    cells: n,
    half: L.half,
    base: c,
    land: "#b0703e",
    sea: null,
    landmark: { x: L.church.x, z: L.church.z },
    playHalf,
  };
}
