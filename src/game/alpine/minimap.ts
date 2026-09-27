// The Whiteout Pass radar base: one pixel per 2 m cell, coloured by surface (snow, forest,
// pistes, streets, ice, rock, buildings) with a soft hillshade so the slopes read. In solo
// everything beyond the blockades is dimmed and hatched.
import {
  S_BLD,
  S_BLOCKADE,
  S_DECK,
  S_FOREST,
  S_ICE,
  S_PATH,
  S_PISTE,
  S_PLAZA,
  S_ROAD,
  S_ROCK,
  type AlpineLayout,
} from "./layout";

const COL: Record<number, [number, number, number]> = {
  0: [226, 232, 240],
  [S_PATH]: [184, 176, 164],
  [S_ROAD]: [150, 146, 140],
  [S_PISTE]: [246, 250, 255],
  [S_ICE]: [150, 196, 222],
  [S_ROCK]: [128, 130, 136],
  [S_FOREST]: [140, 164, 150],
  [S_PLAZA]: [196, 186, 170],
  [S_BLD]: [70, 54, 44],
  [S_DECK]: [150, 112, 76],
  [S_BLOCKADE]: [200, 60, 40],
};

export function paintAlpine(city: AlpineLayout) {
  const a = city.alpine;
  const n = city.cells;
  const c = document.createElement("canvas");
  c.width = n;
  c.height = n;
  const g = c.getContext("2d")!;
  const img = g.createImageData(n, n);
  const H = a.terrain.h;
  const s = n + 1;
  const sh = a.soloHalf;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const k = a.surf[i * n + j]!;
      const base = COL[k] ?? COL[0]!;
      // hillshade from the north-west
      const dx = H[(i + 1) * s + j]! - H[i * s + j]!;
      const dz = H[i * s + j + 1]! - H[i * s + j]!;
      let lit = 1 + (-dx - dz) * 0.09;
      lit = Math.max(0.72, Math.min(1.12, lit));
      let r = base[0] * lit;
      let gg = base[1] * lit;
      let b = base[2] * lit;
      if (sh !== null) {
        const x = -city.half + 1 + i * 2;
        const z = -city.half + 1 + j * 2;
        if (Math.abs(x) > sh || Math.abs(z) > sh) {
          const hatch = (i + j) % 6 < 2 ? 0.34 : 0.46;
          r *= hatch;
          gg *= hatch;
          b *= hatch;
        }
      }
      const o = (j * n + i) * 4;
      img.data[o] = Math.min(255, r);
      img.data[o + 1] = Math.min(255, gg);
      img.data[o + 2] = Math.min(255, b);
      img.data[o + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  // the chairlift line
  g.strokeStyle = "rgba(43,33,24,0.85)";
  g.lineWidth = 1.2;
  g.setLineDash([2, 1.5]);
  const lf = a.lift;
  const p0 = lf.supports[0]!;
  const p1 = lf.supports[lf.supports.length - 1]!;
  g.beginPath();
  g.moveTo((lf.x + city.half) / 2, (p0.z + city.half) / 2);
  g.lineTo((lf.x + city.half) / 2, (p1.z + city.half) / 2);
  g.stroke();
  return c;
}
