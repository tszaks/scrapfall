// Reachability / sanity check for Pacific Pier (run: npx jiti scripts/beach-check.ts [seeds])
import {
  setArenaSize,
  generateLevel,
  solidGrid,
  flowField,
  toNav,
  NAV_CELLS,
  groundAt,
  terrain,
  BEACH_SIZE,
  blocked,
} from "../src/game/level";
import { isBeach } from "../src/game/beach/beachLayout";

const seeds = Number(process.argv[2] ?? 6);
for (const solo of [true, false]) {
  for (let s = 0; s < seeds; s++) {
    const seed = 1000 + s * 7919;
    setArenaSize(BEACH_SIZE, 2);
    const t0 = performance.now();
    const lv = generateLevel(seed, "beach", solo);
    const ms = performance.now() - t0;
    const city = lv.city!;
    if (!isBeach(city)) throw new Error("not beach");
    const n = city.cells,
      half = city.half;
    const cx = (i: number) => -half + 1 + i * 2;
    // fine-grid reachability from spawn (4-connected, not blocked)
    const open = new Uint8Array(n * n);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) open[i * n + j] = city.solid[i * n + j] ? 0 : 1;
    const si = Math.floor((city.spawn.x + half) / 2),
      sj = Math.floor((city.spawn.z + half) / 2);
    const reach = new Uint8Array(n * n);
    const q = [si * n + sj];
    reach[q[0]!] = 1;
    for (let h = 0; h < q.length; h++) {
      const c = q[h]!;
      const i = Math.floor(c / n),
        j = c - i * n;
      for (const [a, b] of [
        [i + 1, j],
        [i - 1, j],
        [i, j + 1],
        [i, j - 1],
      ]) {
        if (a < 0 || b < 0 || a >= n || b >= n) continue;
        const k = a * n + b;
        if (reach[k] || !open[k]) continue;
        reach[k] = 1;
        q.push(k);
      }
    }
    let openCells = 0,
      unreach = 0,
      outside = 0,
      deepOpen = 0,
      stepBad = 0;
    const sh = city.soloHalf;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const c = i * n + j;
        if (!open[c]) continue;
        openCells++;
        if (!reach[c]) unreach++;
        if (sh !== null && (Math.abs(cx(i)) > sh || Math.abs(cx(j)) > sh)) outside++;
        if (city.beach.deep[c]) deepOpen++;
        // height continuity with open 4-neighbours at the shared edge
        for (const [a, b, ex, ez] of [
          [i + 1, j, cx(i) + 1, cx(j)],
          [i, j + 1, cx(i), cx(j) + 1],
        ] as const) {
          if (a >= n || b >= n) continue;
          const k = a * n + b;
          if (!open[k]) continue;
          const h1 = groundAt(ex - 0.01, ez - (b > j ? 0.01 : 0)),
            h2 = groundAt(ex + (a > i ? 0.01 : 0), ez + (b > j ? 0.01 : 0));
          if (Math.abs(h1 - h2) > 0.95) stepBad++;
        }
      }
    // nav connectivity: can the flow field from spawn reach key points?
    const nav = solidGrid(lv.blocks);
    const dist = flowField(nav, toNav(city.spawn.x), toNav(city.spawn.z));
    const keys: [string, number, number][] = [
      ["pierEnd", -204, 12],
      ["wheelMid", -100, 0],
      ["carousel", 60, 8],
      ["sandN", 20, -120],
      ["sandS", 20, 140],
      ["surf", -90, 100],
      ["bluffTop", 270, -20],
      ["skate", 82, 66],
      ["gym", 108, -70],
      ["road", 214, -150],
      ["stairS1", 20, -14],
      ["stairS4", 0, 27],
      ["coasterArea", -100, 20],
    ];
    const navRes = keys.map(([k, x, z]) => {
      const d = dist[toNav(x) * nav.n + toNav(z)]!;
      return `${k}:${isFinite(d) ? Math.round(d) : "X"}`;
    });
    let navOpen = 0,
      navUnreach = 0;
    for (let k = 0; k < nav.n * nav.n; k++)
      if (!nav.g[k]) {
        navOpen++;
        if (!isFinite(dist[k]!)) navUnreach++;
      }
    console.log(
      JSON.stringify({
        solo,
        seed,
        ms: Math.round(ms),
        blocks: lv.blocks.length,
        openCells,
        unreach,
        outside,
        deepOpen,
        stepBad,
        navOpen,
        navUnreach,
        gaps: city.beach.gaps.length,
        blockades: city.beach.blockades.length,
        bld: city.beach.buildings.length,
        props: city.beach.props.length,
        parked: city.beach.parked.length,
      }),
    );
    console.log("  nav", navRes.join(" "));
    void terrain;
    void NAV_CELLS;
    void blocked;
  }
}
