// Whiteout Pass's map-exclusive enemies.
//   RIDGE RAIDER (special): a rogue ski patroller in white camo who carves in on skis,
//     fans thrown ice picks at mid range and jabs with a pole up close.
//   THE AVALANCHE ENGINE (boss): a tracked snow-plough war machine with a V blade, a
//     snow-blower chute, amber beacons and a glowing cab; it ploughs straight at you.
// Both models now live in art/robots (specials.ts / bosses.ts, drawn via art/SpecialBoss.tsx).
import { ArtSpecial } from "../art/SpecialBoss";
import type { RobotData } from "../art/RobotModel";
import type { Theme } from "../themes";

/** The Ridge Raider: now the detailed skinned robot in art/robots/specials.ts. */
export function SkierModel({ theme, data }: { theme: Theme; data: RobotData }) {
  return <ArtSpecial theme={theme} data={data} />;
}
