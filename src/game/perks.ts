export type PerkId = "dmg" | "rate" | "speed" | "maxhp" | "heal" | "magnet" | "greed" | "regen";
export type Perks = Record<PerkId, number>;

export const NO_PERKS: Perks = { dmg: 0, rate: 0, speed: 0, maxhp: 0, heal: 0, magnet: 0, greed: 0, regen: 0 };

export const PERK_INFO: Record<PerkId, { name: string; desc: string; base: number; color: string }> = {
  dmg: { name: "HOLLOW POINTS", desc: "+8% damage, every gun", base: 8, color: "#e8322a" },
  rate: { name: "HAIR TRIGGER", desc: "+7% fire rate, every gun", base: 8, color: "#ff9d3b" },
  speed: { name: "LIGHT BOOTS", desc: "+6% move speed", base: 6, color: "#4fe3ff" },
  maxhp: { name: "IRON HEART", desc: "+2 max health", base: 10, color: "#b3261e" },
  heal: { name: "PATCH KIT", desc: "Restore 5 health now", base: 5, color: "#7cff4f" },
  magnet: { name: "SHARD MAGNET", desc: "Pull shards from farther away", base: 4, color: "#5ff6ff" },
  greed: { name: "PROSPECTOR", desc: "+25% shards from kills", base: 7, color: "#e7b25c" },
  regen: { name: "NANO MEND", desc: "Slowly regenerate health", base: 12, color: "#a855f7" },
};

export const PERK_IDS = Object.keys(PERK_INFO) as PerkId[];

export const perkCost = (id: PerkId, lvl: number) =>
  id === "heal" ? PERK_INFO.heal.base : Math.round(PERK_INFO[id].base * (1 + 0.5 * lvl));

export const derive = (p: Perks) => ({
  dmg: 1 + 0.08 * p.dmg,
  rate: 1 + 0.07 * p.rate,
  speed: 1 + 0.06 * p.speed,
  maxHp: 10 + 2 * p.maxhp,
  magnet: 2 + 1.5 * p.magnet,
  greed: 1 + 0.25 * p.greed,
  regen: p.regen,
});
export type Derived = ReturnType<typeof derive>;
