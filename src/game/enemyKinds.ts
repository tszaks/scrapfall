// The ten "street war" enemy types added on top of the original roster. Everything the
// game needs to know about them that is not AI (enemyAI.ts) or models (EnemyModels.tsx):
// stats, the in-game reference text, the co-op visual-state encoding and hit boxes.

import { chase } from "./input/movement";

export const NEW_KINDS = [
  "sniper", "flanker", "grenadier", "bulwark", "charger",
  "medic", "hornet", "gatling", "rocketeer", "cloaker",
] as const;
export type NewKind = (typeof NEW_KINDS)[number];

const NEW_SET = new Set<string>(NEW_KINDS);
export const isNewKind = (k: string): k is NewKind => NEW_SET.has(k);

/** hp / speed (m/s) / body radius (m) / damage per hit. Same meaning as the old STATS table.
 * chase() re-tunes authored chase speeds from the old 7 m/s run to today's SPEED.run. */
export const NEW_STATS: Record<NewKind, { hp: number; speed: number; radius: number; dmg: number }> = {
  sniper: { hp: 3, speed: chase(2.2), radius: 0.55, dmg: 3 },
  flanker: { hp: 3, speed: chase(3.4), radius: 0.55, dmg: 1 },
  grenadier: { hp: 4, speed: chase(1.9), radius: 0.65, dmg: 2 },
  bulwark: { hp: 6, speed: chase(1.7), radius: 0.85, dmg: 2 },
  charger: { hp: 7, speed: chase(1.7), radius: 1.0, dmg: 3 },
  medic: { hp: 3, speed: chase(3), radius: 0.5, dmg: 1 },
  hornet: { hp: 1, speed: chase(5), radius: 0.35, dmg: 1 },
  gatling: { hp: 12, speed: chase(1.1), radius: 0.95, dmg: 1 },
  rocketeer: { hp: 5, speed: chase(1.3), radius: 0.65, dmg: 3 },
  cloaker: { hp: 4, speed: chase(3.4), radius: 0.6, dmg: 2 },
};

/** fliers hover over traffic and crowds; bullets must be aimed up at them */
export const FLYERS = new Set<string>(["hornet", "medic"]);
/** heavy enough to stop a car and to shrug off half of any knockback */
export const HEAVY_NEW = new Set<string>(["bulwark", "charger", "gatling"]);

/** vertical band (metres) a bullet has to pass through to hit the body */
export function hitBand(kind: string): [number, number] {
  if (kind === "hornet") return [0.8, 2.4];
  if (kind === "medic") return [1.6, 3.5];
  if (kind === "boss") return [0, 5];
  if (kind === "brute" || kind === "vanguard" || kind === "bulwark" || kind === "gatling" || kind === "charger") return [0, 2.6];
  if (kind === "sniper") return [0, 2.4];
  return [0, 2];
}
/** hitBand without the allocation: fills `out` (hot loops reuse one tuple) */
export function hitBandInto(kind: string, out: [number, number]): [number, number] {
  if (kind === "hornet") {
    out[0] = 0.8;
    out[1] = 2.4;
  } else if (kind === "medic") {
    out[0] = 1.6;
    out[1] = 3.5;
  } else if (kind === "boss") {
    out[0] = 0;
    out[1] = 5;
  } else if (
    kind === "brute" ||
    kind === "vanguard" ||
    kind === "bulwark" ||
    kind === "gatling" ||
    kind === "charger"
  ) {
    out[0] = 0;
    out[1] = 2.6;
  } else if (kind === "sniper") {
    out[0] = 0;
    out[1] = 2.4;
  } else {
    out[0] = 0;
    out[1] = 2;
  }
  return out;
}

/** shard payout on death (see Shards.tsx) */
export const NEW_VALUE: Record<NewKind, number> = {
  sniper: 3, flanker: 2, grenadier: 3, bulwark: 4, charger: 4,
  medic: 3, hornet: 1, gatling: 5, rocketeer: 4, cloaker: 3,
};

// ---- co-op visual state ("vis"), packed into the 4th snapshot integer for new kinds ----
// phase lives in the low 2 bits for every kind; the rest is per kind (see below).
export const PH_IDLE = 0;
export const PH_WIND = 1; // telegraph: aiming, spinning up, winding up
export const PH_ACT = 2; // attacking: locked / firing / dashing / beam on
export const PH_AFTER = 3; // just fired (sniper tracer), stunned (charger), cooling (gatling)

/** phase(2) | progress 0-15 (4) << 2 | extra (10) << 6 — always < 65536 */
export const packVis = (phase: number, prog = 0, extra = 0) =>
  (phase & 3) | ((Math.max(0, Math.min(15, Math.round(prog * 15))) & 15) << 2) | ((extra & 1023) << 6);
export const visPhase = (v: number) => v & 3;
export const visProg = (v: number) => ((v >> 2) & 15) / 15;
export const visExtra = (v: number) => (v >> 6) & 1023;
// extra meanings: sniper = laser length in metres; medic = heal-beam target index + 1;
// bulwark = 1 shield up | 2 just blocked a shot; cloaker = 1 cloaked

/** reference card text (ENEMIES panel), in the order they appear in a run */
export type EnemyInfo = { name: string; wave: number; weapon: string; tactic: string; accent: string };
export const ENEMY_INFO: Record<string, EnemyInfo> = {
  drifter: { name: "DRIFTER", wave: 1, weapon: "Contact shock", tactic: "Swarms straight at you in numbers.", accent: "#e8322a" },
  shooter: { name: "SHOOTER", wave: 2, weapon: "Blaster", tactic: "Holds 7-11 m away and fires single bolts.", accent: "#4fd6ff" },
  runner: { name: "RUNNER", wave: 2, weapon: "Contact shock", tactic: "Small and very fast. Closes the gap before you can turn.", accent: "#ff8a1f" },
  hornet: { name: "HORNET", wave: 2, weapon: "Stinger dive", tactic: "Tiny flying drones in packs of 3-5. Each one buzzes red, then dives. One hit kills.", accent: "#ffd21a" },
  brute: { name: "BRUTE", wave: 3, weapon: "Power maul", tactic: "Slow tank. Winds up a big swing when it reaches you.", accent: "#8a8a86" },
  specter: { name: "SPECTER", wave: 3, weapon: "Claw", tactic: "Drifts through walls and blinks in behind you.", accent: "#b89cff" },
  flanker: { name: "FLANKER", wave: 3, weapon: "3-round burst", tactic: "Circles round the block to your side or back, then fires a burst. Its guns glow green first.", accent: "#a6ff3a" },
  grenadier: { name: "GRENADIER", wave: 3, weapon: "Arcing grenade", tactic: "Lobs grenades over cover. A red ring marks where each one lands; step out of it.", accent: "#ff8c1a" },
  special: { name: "MAP SPECIAL", wave: 3, weapon: "Varies", tactic: "Each map has its own exclusive creature.", accent: "#ffd24a" },
  bomber: { name: "BOMBER", wave: 4, weapon: "Mortar shell", tactic: "Hangs back 9-16 m and lobs heavy shells.", accent: "#39d0ff" },
  sniper: { name: "SNIPER", wave: 4, weapon: "Laser rifle, 3 damage", tactic: "Picks a far spot with a clear view. Its red laser tracks you, turns white and freezes, then fires. Move or break line of sight when it goes white.", accent: "#ff2b2b" },
  vanguard: { name: "VANGUARD", wave: 5, weapon: "Slab strike", tactic: "Heavy armour soaks most of each hit. Piercing shots go through.", accent: "#4a6a86" },
  bulwark: { name: "BULWARK", wave: 5, weapon: "Shield bash", tactic: "A cyan shield blocks every shot from the front, even ones aimed past it. It turns slowly: get round it, use splash, or break the shield.", accent: "#4fe0ff" },
  charger: { name: "CHARGER", wave: 5, weapon: "Horn ram, 3 damage", tactic: "Paws the ground while a lane lights up, then rams in a straight line. Sidestep it; if it hits a wall it is stunned and takes extra damage.", accent: "#ffc21a" },
  medic: { name: "MEDIC DRONE", wave: 6, weapon: "Repair beam", tactic: "Hovers behind the others and beams them back to health. Shoot it first.", accent: "#34ff86" },
  cloaker: { name: "CLOAKER", wave: 7, weapon: "Arm blade", tactic: "Nearly invisible until it is 6 m away. It shimmers, strikes and backs off to cloak again. Hitting it reveals it.", accent: "#9fd8ff" },
  gatling: { name: "GATLING", wave: 8, weapon: "Rotary cannon", tactic: "Slow and tough. Its barrels spin up and glow violet, then it sprays. It turns slowly, so strafe or take cover.", accent: "#b060ff" },
  rocketeer: { name: "ROCKETEER", wave: 8, weapon: "Homing rocket, 3 damage", tactic: "Fires a slow rocket that follows you. Shoot the rocket down or sidestep late.", accent: "#ff4fa3" },
  boss: { name: "MAP BOSS", wave: 12, weapon: "Varies", tactic: "The final wave's giant.", accent: "#b3261e" },
};
