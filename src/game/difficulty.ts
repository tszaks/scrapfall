// Difficulty: five levels and the wave curve they share. Everything that decides how hard a
// run is lives here, so the balance can be read (and tuned) in one place.
//
// OVERCLOCK (the default) plays the curve below: a gentle first wave, the newer enemy types
// introduced one at a time with room to learn each, a big-map crowd that grows from 1.0x to
// 1.5x (1.65x by the boss) instead of a flat 1.75x, and enemy damage / attack tempo that ramp up to full by
// wave 8. MELTDOWN is the game as it was before this rebalance (the old wave table, the flat
// 1.75x big-map crowd, random heavies from wave 1). RUST BUCKET and SALVAGE soften the curve;
// SCRAPFALL sharpens the old game.

export type DifficultyId = "rust" | "salvage" | "overclock" | "meltdown" | "scrapfall";
export const DIFFICULTY_IDS: DifficultyId[] = ["rust", "salvage", "overclock", "meltdown", "scrapfall"];
export const DEFAULT_DIFFICULTY: DifficultyId = "overclock";
export const DIFFICULTY_KEY = "scrapfall-difficulty";

export type Difficulty = {
  id: DifficultyId;
  name: string;
  desc: string;
  color: string;
  /** "curve" = the new wave table below; "legacy" = the old one (the game before the rebalance) */
  table: "curve" | "legacy";
  /** multiplies every wave's counts (after the map's crowd multiplier) */
  countMul: number;
  /** multiplies enemy health */
  hpMul: number;
  /** multiplies the map boss's health */
  bossMul: number;
  /** extra enemy health per wave after the first (0.09 = +9% a wave) */
  hpRamp: number;
  /** multiplies the damage you take, by wave */
  dmgMul: (wave: number) => number;
  /** enemy attack clock: 1.25 = cooldowns, wind-ups and telegraphs run 25% slower */
  tempo: (wave: number) => number;
  /** waves the newer types' introductions move later (+) or earlier (-); curve table only */
  introShift: number;
  /** solo health packs: every `gap(wave)` waves (co-op always gets one every wave) */
  healGap: (wave: number) => number;
  /** first wave that rolls random heavies on top of the lineup, and how many at most */
  surpriseFrom: number;
  surpriseMax: (wave: number) => number;
  /** no single hit can take more than this share of your max health (1 = uncapped) */
  hitCap: (wave: number) => number;
};

const ramp = (from: number, to: number, w0: number, w1: number) => (wave: number) =>
  wave <= w0 ? from : wave >= w1 ? to : from + ((to - from) * (wave - w0)) / (w1 - w0);

export const DIFFICULTIES: Record<DifficultyId, Difficulty> = {
  rust: {
    id: "rust",
    name: "RUST BUCKET",
    desc: "Very forgiving: fewer, weaker, slower robots and a health pack every wave.",
    color: "#8a9a5b",
    table: "curve",
    countMul: 0.45,
    hpMul: 0.6,
    bossMul: 0.35,
    hpRamp: 0.03,
    dmgMul: () => 0.35,
    tempo: () => 1.6,
    introShift: 2,
    healGap: () => 1,
    surpriseFrom: 9,
    surpriseMax: () => 1,
    hitCap: () => 0.2,
  },
  salvage: {
    id: "salvage",
    name: "SALVAGE",
    desc: "Relaxed: a gentler curve with room to breathe and plenty of repairs.",
    color: "#5b8a9a",
    table: "curve",
    countMul: 0.6,
    hpMul: 0.8,
    bossMul: 0.6,
    hpRamp: 0.06,
    dmgMul: ramp(0.45, 0.7, 1, 10),
    tempo: ramp(1.5, 1.25, 1, 10),
    introShift: 1,
    healGap: () => 1,
    surpriseFrom: 7,
    surpriseMax: () => 1,
    hitCap: () => 0.3,
  },
  overclock: {
    id: "overclock",
    name: "OVERCLOCK",
    desc: "The intended game: starts easy, ramps up wave by wave, ends intense.",
    color: "#b4653f",
    table: "curve",
    countMul: 1,
    hpMul: 1,
    bossMul: 1,
    hpRamp: 0.06,
    dmgMul: ramp(0.7, 1, 1, 8),
    tempo: ramp(1.3, 1, 1, 8),
    introShift: 0,
    healGap: (w) => (w <= 6 ? 1 : 2),
    surpriseFrom: 4,
    surpriseMax: (w) => (w >= 8 ? 2 : 1),
    hitCap: (w) => (w <= 6 ? 0.3 : 0.45),
  },
  meltdown: {
    id: "meltdown",
    name: "MELTDOWN",
    desc: "The old game: a full crowd from wave 1 and random heavies every wave.",
    color: "#c2412b",
    table: "legacy",
    countMul: 1,
    hpMul: 1,
    bossMul: 1,
    hpRamp: 0.09,
    dmgMul: () => 1,
    tempo: () => 1,
    introShift: 0,
    healGap: () => 2,
    surpriseFrom: 1,
    surpriseMax: () => 2,
    hitCap: () => 1,
  },
  scrapfall: {
    id: "scrapfall",
    name: "SCRAPFALL",
    desc: "Brutal: more, tougher, harder-hitting robots, faster fire, scarce repairs.",
    color: "#7a1f1f",
    table: "legacy",
    countMul: 1.5,
    hpMul: 1.25,
    bossMul: 1.2,
    hpRamp: 0.1,
    dmgMul: () => 1.5,
    tempo: () => 0.8,
    introShift: 0,
    healGap: () => 3,
    surpriseFrom: 1,
    surpriseMax: () => 3,
    hitCap: () => 1,
  },
};

export const difficultyOf = (id: string | null | undefined): Difficulty =>
  DIFFICULTIES[(id ?? "") as DifficultyId] ?? DIFFICULTIES[DEFAULT_DIFFICULTY];

export type WaveSpec = Record<string, number>;

/** The newer types, in the order the curve introduces them (hornet 3, flanker 4, grenadier 5,
 * sniper 6, bulwark + charger 7, medic + cloaker 8, gatling 9, rocketeer 10). */
const NEWER = new Set(["hornet", "flanker", "grenadier", "sniper", "bulwark", "charger", "medic", "cloaker", "gatling", "rocketeer"]);

// The OVERCLOCK curve, before the map's crowd multiplier. Each newer type's first wave has
// just one of it (a hornet pack is three); waves 10-12 match the old endgame.
export const CURVE: WaveSpec[] = [
  { drifter: 4 },
  { drifter: 5, shooter: 1, runner: 1 },
  { drifter: 5, brute: 1, shooter: 1, runner: 1, hornet: 3 },
  { drifter: 5, brute: 1, shooter: 2, runner: 2, specter: 1, flanker: 1 },
  { drifter: 5, brute: 1, shooter: 2, runner: 2, bomber: 1, special: 1, hornet: 3, grenadier: 1 },
  { drifter: 5, brute: 2, shooter: 2, runner: 2, specter: 1, special: 1, flanker: 1, grenadier: 1, sniper: 1 },
  { drifter: 5, brute: 1, shooter: 2, runner: 2, specter: 1, vanguard: 1, special: 1, bomber: 1, flanker: 1, sniper: 1, bulwark: 1, charger: 1, hornet: 3 },
  { drifter: 5, brute: 2, shooter: 2, runner: 3, specter: 1, bomber: 1, vanguard: 1, special: 2, grenadier: 1, bulwark: 1, charger: 1, medic: 1, cloaker: 1, hornet: 3 },
  { drifter: 5, brute: 2, shooter: 3, runner: 3, specter: 2, bomber: 1, vanguard: 1, special: 2, flanker: 2, grenadier: 1, sniper: 1, bulwark: 1, charger: 1, medic: 1, cloaker: 1, gatling: 1, hornet: 4 },
  { drifter: 5, brute: 3, shooter: 3, runner: 3, specter: 2, bomber: 2, vanguard: 1, special: 2, flanker: 2, grenadier: 2, sniper: 2, bulwark: 1, charger: 1, medic: 1, cloaker: 2, gatling: 1, rocketeer: 1, hornet: 4 },
  { drifter: 6, brute: 3, shooter: 3, runner: 4, specter: 2, bomber: 2, vanguard: 2, special: 2, flanker: 3, grenadier: 2, sniper: 2, bulwark: 1, charger: 1, medic: 2, cloaker: 2, gatling: 1, rocketeer: 2, hornet: 5 },
  { boss: 1, drifter: 4, brute: 2, shooter: 2, runner: 2, specter: 1, bomber: 1, vanguard: 1, special: 1, flanker: 1, bulwark: 1, sniper: 1, medic: 1, hornet: 3 },
];

/** a wave's lineup for this difficulty: the legacy table as-is, or the curve with the newer
 * types' arrivals shifted by `introShift` waves (the boss wave keeps its own lineup) */
export function waveLineup(d: Difficulty, n: number, legacy: WaveSpec[]): WaveSpec {
  if (d.table === "legacy") return legacy[n - 1] ?? {};
  const base = CURVE[n - 1] ?? {};
  if (d.introShift === 0 || n >= CURVE.length) return base;
  const out: WaveSpec = {};
  for (const [k, v] of Object.entries(base)) if (!NEWER.has(k)) out[k] = v;
  const from = CURVE[n - 1 - d.introShift];
  if (from) for (const [k, v] of Object.entries(from)) if (NEWER.has(k)) out[k] = v;
  return out;
}

/** crowd multiplier for the map. Big real-scale maps (Vice Heights, Dry Gulch) hide enemies
 * behind blocks, so they send more; the curve grows that crowd instead of starting at full. */
export function crowdMul(d: Difficulty, n: number, big: boolean) {
  if (d.table === "legacy") return big ? 1.75 : 1.25 + 0.1 * (n - 1);
  if (big) return n >= 10 ? 1.5 + 0.05 * (n - 9) : ramp(1, 1.5, 1, 9)(n);
  return 1 + 0.08 * (n - 1);
}

/** the damage you actually take from one hit: difficulty scaling (rounded up or down at random
 * so fractional scaling still averages out) and the per-hit cap */
export function scaleHit(d: Difficulty, wave: number, dmg: number, maxHp: number, rnd = Math.random) {
  const raw = dmg * d.dmgMul(Math.max(1, wave));
  let out = Math.floor(raw) + (rnd() < raw - Math.floor(raw) ? 1 : 0);
  const cap = d.hitCap(Math.max(1, wave));
  if (cap < 1) out = Math.min(out, Math.max(1, Math.round(maxHp * cap)));
  return out;
}
