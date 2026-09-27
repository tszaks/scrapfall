// The city's radar source for the HUD minimap: the street map painted once per city,
// one pixel per 2 m cell, buildings shaded by height.
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
import type { MinimapSource } from "./Minimap";

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

/** the city's radar source */
export function cityMinimap(city: CityLayout, blocks: Block[], playHalf: number): MinimapSource {
  return {
    cells: city.cells,
    half: city.half,
    base: paintBase(city, blocks),
    land: "#a8a397",
    sea: { z: city.waterZ, color: "#4f8fb0" },
    landmark: city.landmark,
    playHalf,
  };
}

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
