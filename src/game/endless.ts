export type MutatorId = "flare" | "cryo" | "blood" | "gravity" | "surge" | "none";

export type Mutator = { id: MutatorId; name: string; desc: string; color: string };

export const MUTATORS: Mutator[] = [
  { id: "flare", name: "SOLAR FLARE", desc: "Enemies burst into flame when they die", color: "#ff9a3a" },
  { id: "cryo", name: "CRYO SURGE", desc: "You move slower, but every shot chills", color: "#7fe8ff" },
  { id: "blood", name: "BLOOD MOON", desc: "Enemies regenerate — your life siphon doubles", color: "#ff4a6a" },
  { id: "gravity", name: "HEAVY GRAVITY", desc: "Slower steps, double impact force", color: "#a98cff" },
  { id: "surge", name: "OVERDRIVE", desc: "You fire faster, enemies run faster", color: "#ffd24a" },
];

export function rollMutator(rand: () => number): Mutator {
  return MUTATORS[Math.floor(rand() * MUTATORS.length)] ?? MUTATORS[0]!;
}

export const HIGH_WAVE_KEY = "scrapfall-high-wave";

export function readHighWave(): number {
  if (typeof localStorage === "undefined") return 0;
  return Number(localStorage.getItem(HIGH_WAVE_KEY) ?? 0) || 0;
}

export function saveHighWave(w: number) {
  if (typeof localStorage === "undefined") return;
  if (w > readHighWave()) localStorage.setItem(HIGH_WAVE_KEY, String(w));
}
