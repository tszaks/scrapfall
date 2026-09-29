// Whiteout Pass — the first big co-op-only map. A snowed-in ski village on a flat valley
// floor: chalets round a square with a chapel, a frozen lake, a chairlift up the east
// side, and spruce forest along the north. Pure data from the seed, so every co-op client
// builds the identical map.
import type { Block } from "../level";
import type { Theme } from "../themes";

export const WHITEOUT_SIZE = 104;
/** seeds at or above this mean "Whiteout Pass" (regular arena seeds stay below 1e9) */
export const WHITEOUT_BASE = 1_500_000_000;
export const isWhiteoutSeed = (s: number) => s >= WHITEOUT_BASE;
export const whiteoutSeed = () => WHITEOUT_BASE + Math.floor(Math.random() * 5e8);

export const WHITEOUT_THEME: Theme = {
  name: "Whiteout Pass",
  sky: "#dbe5ee",
  ground: "#eef3f7",
  grid: ["#d6e0e9", "#e2e9f0"],
  blocks: ["#7a4a2c", "#5e3a22", "#8e9cab"],
  wall: "#5f6f80",
  hemi: ["#ffffff", "#8a9aac"],
  enemy: {
    drifter: { body: "#b8342a", emissive: "#3a0a06", eye: "#fff2e0" },
    brute: { body: "#39465a", head: "#2a3446", eye: "#9ff0ff", club: "#5a6a7a", clubHead: "#e0f0ff" },
    shooter: { body: "#e0a02a", barrel: "#2a1a0a", eye: "#1f3b5c" },
  },
  enemyBullet: "#ff5a3a",
  blockShape: "alpine",
  boss: { name: "AVALANCHE YETI", shape: "yeti", body: "#f4f8fb", limb: "#cfdce6", eye: "#ff5a3a", weapon: "#7b8a96", glow: "#ffb08a" },
  hazard: { name: "BLIZZARD", slip: 0.9 },
  special: { name: "GLACIER MITE", type: "mite", body: "#bfe8ff", accent: "#5a8fb0", glow: "#2fd8ff" },
};

export type Chalet = { x: number; z: number; w: number; d: number; h: number; rot: 0 | 1; wood: string; roof: string; kind: "chalet" | "chapel" | "station" };
export type Spruce = { x: number; z: number; s: number; ry: number };
export type Rock = { x: number; z: number; s: number; ry: number };
export type WhiteoutLayout = {
  chalets: Chalet[];
  spruce: Spruce[];
  rocks: Rock[];
  lake: { x: number; z: number; r: number };
  lift: { x: number; z0: number; z1: number; towers: number[] };
  blocks: Block[];
};

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WOODS = ["#7a4a2c", "#8a5634", "#6a3f26", "#946040"];
const ROOFS = ["#5a3a2e", "#3e4a58", "#6b2f2a", "#4a3a30"];
const H = WHITEOUT_SIZE / 2;
const snap = (v: number) => Math.round((v - 1) / 2) * 2 + 1; // centre of a 2 m cell

export function buildWhiteout(seed: number): WhiteoutLayout {
  const r = mulberry(seed);
  const cells = new Set<string>();
  const blocks: Block[] = [];
  const lake = { x: -30, z: 20, r: 11 };
  const lift = { x: 34, z0: 40, z1: -44, towers: [] as number[] };
  const key = (x: number, z: number) => `${x},${z}`;
  const addCell = (x: number, z: number, h: number, tone: number) => {
    const k = key(x, z);
    if (cells.has(k)) return;
    cells.add(k);
    blocks.push({ x, z, h, tone });
  };
  const free = (x: number, z: number, pad: number) => {
    if (Math.abs(x) > H - 4 || Math.abs(z) > H - 4) return false;
    if (Math.hypot(x, z) < 9 + pad) return false; // village square / spawn
    if (Math.abs(z - 6) < 3 + pad) return false; // main street (east-west)
    if (Math.abs(x) < 2.5 + pad && z > 0) return false; // south lane
    if (Math.hypot(x - lake.x, z - lake.z) < lake.r + 1.5 + pad) return false;
    if (Math.abs(x - lift.x) < 3 + pad) return false;
    for (let dx = -pad; dx <= pad; dx += 2)
      for (let dz = -pad; dz <= pad; dz += 2) if (cells.has(key(snap(x + dx), snap(z + dz)))) return false;
    return true;
  };

  const chalets: Chalet[] = [];
  const placeBuilding = (cx: number, cz: number, cw: number, cd: number, h: number, kind: Chalet["kind"]) => {
    const x0 = snap(cx) - (cw - 1);
    const z0 = snap(cz) - (cd - 1);
    for (let i = 0; i < cw; i++) for (let j = 0; j < cd; j++) if (!free(x0 + i * 2, z0 + j * 2, 0)) return false;
    for (let i = 0; i < cw; i++) for (let j = 0; j < cd; j++) addCell(x0 + i * 2, z0 + j * 2, h, 0.5);
    chalets.push({
      x: x0 + (cw - 1),
      z: z0 + (cd - 1),
      w: cw * 2,
      d: cd * 2,
      h,
      rot: cw >= cd ? 0 : 1,
      wood: kind === "chapel" ? "#e8e2d6" : WOODS[Math.floor(r() * WOODS.length)]!,
      roof: kind === "chapel" ? "#3e4a58" : ROOFS[Math.floor(r() * ROOFS.length)]!,
      kind,
    });
    return true;
  };

  // set pieces: chapel on the square's north side, lift stations at both ends
  placeBuilding(0, -15, 3, 4, 4.2, "chapel");
  placeBuilding(lift.x - 5, lift.z0 - 2, 2, 3, 3, "station");
  placeBuilding(lift.x - 5, lift.z1 + 2, 2, 3, 3, "station");

  // chalets in a loose ring round the village
  for (let tries = 0, n = 0; tries < 400 && n < 22; tries++) {
    const a = r() * Math.PI * 2;
    const d = 13 + r() * 30;
    const cw = 2 + Math.floor(r() * 2);
    const cd = 2 + Math.floor(r() * 2);
    if (placeBuilding(Math.cos(a) * d, Math.sin(a) * d, cw, cd, 2.6 + r() * 1.2, "chalet")) n++;
  }

  // chairlift towers
  for (let z = lift.z0 - 12; z > lift.z1 + 6; z -= 16) {
    lift.towers.push(z);
    addCell(snap(lift.x), snap(z), 6, 0.2);
  }

  // spruce: dense along the north, patches elsewhere
  const spruce: Spruce[] = [];
  const plant = (x: number, z: number) => {
    const sx = snap(x), sz = snap(z);
    if (!free(sx, sz, 2)) return;
    addCell(sx, sz, 6, 0.9);
    spruce.push({ x: sx + (r() - 0.5) * 0.4, z: sz + (r() - 0.5) * 0.4, s: 5.5 + r() * 3.5, ry: r() * 6.28 });
  };
  for (let i = 0; i < 90; i++) plant((r() - 0.5) * (WHITEOUT_SIZE - 10), -H + 5 + r() * 14);
  for (let c = 0; c < 7; c++) {
    const cx = (r() - 0.5) * (WHITEOUT_SIZE - 16);
    const cz = (r() - 0.5) * (WHITEOUT_SIZE - 16);
    for (let i = 0; i < 9; i++) plant(cx + (r() - 0.5) * 12, cz + (r() - 0.5) * 12);
  }

  // boulders (cover out in the open snow)
  const rocks: Rock[] = [];
  for (let i = 0; i < 26; i++) {
    const x = snap((r() - 0.5) * (WHITEOUT_SIZE - 10));
    const z = snap((r() - 0.5) * (WHITEOUT_SIZE - 10));
    if (!free(x, z, 2)) continue;
    addCell(x, z, 1.6, 0.1);
    rocks.push({ x, z, s: 1 + r() * 0.5, ry: r() * 6.28 });
  }

  return { chalets, spruce, rocks, lake, lift, blocks };
}
