/** Keep perk names, but explain their effect with plain gameplay terms. */
export function perkExplanation(text: string) {
  return text
    .replace(/firepower/gi, "weapon damage")
    .replace(/cycle rate/gi, "fire rate")
    .replace(/hull integrity/gi, "max health")
    .replace(/thruster speed/gi, "move speed")
    .replace(/flux magnet/gi, "pickup range")
    .replace(/salvage yield/gi, "money earned")
    .replace(/life siphon/gi, "healing from damage")
    .replace(/phase shift/gi, "dodge chance")
    .replace(/recharge haste/gi, "ability recharge");
}
