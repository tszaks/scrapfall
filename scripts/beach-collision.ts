// Collision audit for Pacific Pier: points sampled inside every rendered solid thing must be
// blocked for the player. Run: npx jiti scripts/beach-collision.ts [seeds]
import { setArenaSize, generateLevel, blocked, BEACH_SIZE } from "../src/game/level";
import { groundY as groundAt, setTerrain } from "../src/game/terrain";
import { beachTerrain } from "../src/game/beach/terrain";
import { isBeach, DECK } from "../src/game/beach/beachLayout";

const seeds = Number(process.argv[2] ?? 3);
const tally: Record<string, [number, number]> = {};
const add = (k: string, ok: boolean) => {
  const t = (tally[k] ??= [0, 0]);
  t[0]++;
  if (!ok) t[1]++;
};
for (const solo of [true, false])
  for (let s = 0; s < seeds; s++) {
    setArenaSize(BEACH_SIZE, 2);
    const lv = generateLevel(1000 + s * 7919, "beach", solo);
    if (isBeach(lv.city)) setTerrain(beachTerrain(lv.city));
    const c = lv.city!;
    if (!isBeach(c)) throw new Error("not beach");
    const B = c.beach;
    const inside = (k: string, x0: number, z0: number, x1: number, z1: number, inset = 0.3) => {
      for (let i = 0; i < 12; i++) {
        const x = x0 + inset + ((x1 - x0 - 2 * inset) * ((i * 7) % 12)) / 11;
        const z = z0 + inset + ((z1 - z0 - 2 * inset) * ((i * 5) % 12)) / 11;
        add(k, blocked(lv.blocks, x, z, 0.4));
      }
    };
    for (const b of B.buildings) if (!b.backdrop) inside("building:" + b.t, b.x0, b.z0, b.x1, b.z1);
    for (const p of B.parked) {
      const along = Math.abs(Math.sin(p.rot)) > 0.7; // rot pi/2: the car lies along x
      const hx = along ? p.v.len / 2 : p.v.wid / 2;
      const hz = along ? p.v.wid / 2 : p.v.len / 2;
      inside("parked car", p.x - hx, p.z - hz, p.x + hx, p.z + hz, 0.2);
    }
    for (const t of B.towers) inside("lifeguard tower", t.x - 1.5, t.z - 1.5, t.x + 1.5, t.z + 1.5);
    const w = B.wheel;
    inside("ferris wheel base", w.x - 8, w.z - 3, w.x + 8, w.z + 3);
    inside("carousel", B.carousel.x - 5, B.carousel.z - 5, B.carousel.x + 5, B.carousel.z + 5);
    inside("drop tower", B.drop.x - 1.1, B.drop.z - 1.1, B.drop.x + 1.1, B.drop.z + 1.1, 0);
    for (const q of B.qpipes) inside("quarter pipe", q.x0, q.z0, q.x1, q.z1);
    B.coaster.pts.forEach((a, k) => {
      if (k % 4 === 0 && a[1] > DECK + 2)
        add("coaster column", blocked(lv.blocks, a[0], a[2], 0.4));
    });
    for (const p of B.props)
      if (
        [
          "cart",
          "bars",
          "rings",
          "rack",
          "hoop",
          "swing",
          "net",
          "shower",
          "busstop",
          "table",
          "sign66",
          "rail",
        ].includes(p.k)
      )
        add("prop:" + p.k, blocked(lv.blocks, p.x, p.z, 0.4));
    for (const b of B.blockades)
      if (["fence", "jersey", "aframe"].includes(b.k))
        add("blockade:" + b.k, blocked(lv.blocks, b.x, b.z, 0.4));
    // pier railings: a point just past each deck edge, at deck level, must be blocked
    for (const rg of B.regions) {
      if (rg.kind !== "flat" || rg.h0 < 3) continue;
      for (let x = rg.x0 + 3; x < rg.x1 - 3; x += 5) {
        // open only where a stair landing continues the deck at the same height
        for (const [zi, zo] of [
          [rg.z0 + 0.6, rg.z0 - 1.5],
          [rg.z1 - 0.6, rg.z1 + 1.5],
        ] as const) {
          const stopped =
            blocked(lv.blocks, x, zi, 0.4) || blocked(lv.blocks, x, (zi + zo) / 2, 0.4);
          const landing =
            Math.abs(groundAt(x, zo) - rg.h0) < 0.9 && !blocked(lv.blocks, x, zo, 0.4);
          add("pier edge", stopped || landing);
        }
      }
    }
  }
const rows = Object.entries(tally).sort();
let fails = 0;
for (const [k, [n, f]] of rows) {
  fails += f;
  console.log(`${k.padEnd(26)} samples ${String(n).padStart(5)}  NOT blocked ${f}`);
}
console.log(fails ? `FAIL: ${fails} unblocked samples` : "OK: every sample blocked");
