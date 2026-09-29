// VICE HEIGHTS BLACKOUT: mid-wave the grid fails. A warning flicker and the air-raid
// siren, then the city dies district by district in a sweep across the map (windows,
// street lights, neon, signs and traffic lights; cars creep through the dead junctions),
// about 40 s of darkness lit by flashlights and glowing robot eyes, then the power comes
// back district by district. Everything is a function of (seed, t), so co-op clients agree.
import { GRID, commitPower, districtCentre, power, powerAt, restorePower } from "./power";
import type { EventCtx, MapEventDef } from "./mapEvents";
import { playPowerClunk } from "./sfx";

const WARN = 4; // flicker + siren
const FALL = 6; // the sweep of dying districts
const DARK_UNTIL = 46; // power starts coming back
const BACK = 6; // the sweep of returning districts
export const BLACKOUT_LEN = DARK_UNTIL + BACK + 1;

const hash = (a: number, b: number) => {
  let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** when each district dies and comes back, for one blackout */
function plan(seed: number) {
  const n = GRID * GRID;
  const o1 = Math.floor(hash(seed, 1) * n);
  const o2 = Math.floor(hash(seed, 2) * n);
  const dist = (a: number, b: number) =>
    Math.hypot(Math.floor(a / GRID) - Math.floor(b / GRID), (a % GRID) - (b % GRID));
  const maxD = Math.hypot(GRID, GRID);
  const off = new Float32Array(n);
  const on = new Float32Array(n);
  for (let d = 0; d < n; d++) {
    off[d] = WARN + (dist(d, o1) / maxD) * FALL + hash(seed, d + 10) * 0.8;
    on[d] = DARK_UNTIL + (dist(d, o2) / maxD) * BACK + hash(seed, d + 99) * 0.6;
  }
  return { off, on };
}
let cached: { seed: number; p: ReturnType<typeof plan> } | null = null;

/** a stuttering light: mostly on, dropping out in quick irregular blinks */
function flicker(seed: number, t: number, d: number, depth: number) {
  const f = Math.floor(t * 15);
  const r = hash(seed + d * 31, f);
  return r > 0.58 ? 1 - depth * (0.6 + 0.4 * hash(f, d)) : 1;
}

let lastLocal = 1;
let restoredBanner = false;

function step(ctx: EventCtx) {
  const { t, seed } = ctx;
  if (!cached || cached.seed !== seed) cached = { seed, p: plan(seed) };
  const { off, on } = cached.p;
  for (let d = 0; d < GRID * GRID; d++) {
    let v: number;
    if (t < WARN) v = flicker(seed, t, d, 0.8);
    else if (t < off[d]!) v = off[d]! - t < 0.7 ? flicker(seed, t, d, 1) : 1;
    else if (t < on[d]!) v = 0;
    else v = t - on[d]! < 0.6 ? 1 - flicker(seed, t, d, 1) * 0.9 : 1;
    power.values[d] = v;
  }
  commitPower();
  // the player's own district dying / coming back: a relay clunk
  const here = powerAt(ctx.player.x, ctx.player.z);
  if (lastLocal >= 0.5 && here < 0.5 && t > WARN) playPowerClunk(false);
  if (lastLocal < 0.5 && here >= 0.5 && t > DARK_UNTIL) playPowerClunk(true);
  lastLocal = here;
  if (!restoredBanner && t > DARK_UNTIL + 0.5) {
    restoredBanner = true;
    ctx.banner("POWER RESTORED", "THE GRID IS BACK", "#2b8a4a");
  }
}

export const BLACKOUT_EVENT: MapEventDef = {
  id: "blackout",
  title: "BLACKOUT",
  sub: "THE GRID IS FAILING · FLASHLIGHTS ON",
  color: "#1c2340",
  applies: (theme) => theme.blockShape === "city",
  // after dark, when the lights mean the most
  waves: [4, 11],
  chance: 0.45,
  cooldown: 4,
  guarantee: 8,
  delay: [8, 22],
  duration: BLACKOUT_LEN,
  sound: "siren",
  start: () => {
    lastLocal = 1;
    restoredBanner = false;
  },
  step,
  end: () => restorePower(),
};

/** where the sweep starts (for tests) */
export function blackoutOrigin(seed: number) {
  const n = GRID * GRID;
  return districtCentre(Math.floor(hash(seed, 1) * n));
}
export const BLACKOUT_TIMES = { WARN, FALL, DARK_UNTIL, BACK };
