import type { StatMods } from "./perks";

export type ClassId = "vanguard" | "recon" | "commando" | "prospector" | "siphon";

export type ClassInfo = {
  name: string;
  role: string;
  pros: string[];
  cons: string[];
  color: string;
  mods: StatMods;
};

export const CLASS_IDS: ClassId[] = ["vanguard", "recon", "commando", "prospector", "siphon"];

export const CLASSES: Record<ClassId, ClassInfo> = {
  vanguard: {
    name: "VANGUARD",
    role: "Front-line juggernaut",
    pros: ["+6 Hull Integrity", "+20% Armor Plating", "+30% Impact Force"],
    cons: ["-15% Thruster Speed"],
    color: "#8fa3b8",
    mods: { maxHp: 6, armor: 0.2, knock: 0.3, speed: -0.15 },
  },
  recon: {
    name: "RECON",
    role: "Precision deadshot",
    pros: ["+20% Crit Protocol", "+25% Firepower", "+1 Piercing"],
    cons: ["-2 Hull Integrity", "-15% Flux Magnet"],
    color: "#ffe14f",
    mods: { crit: 0.2, dmg: 0.25, pierce: 1, maxHp: -2, magnet: -0.5 },
  },
  commando: {
    name: "COMMANDO",
    role: "Lead-storm run-and-gun",
    pros: ["+25% Cycle Rate", "+20% Thruster Speed", "+30% Ammo Capacity"],
    cons: ["-10% Firepower"],
    color: "#ff9d3b",
    mods: { rate: 0.25, speed: 0.2, ammoMul: 0.3, dmg: -0.1 },
  },
  prospector: {
    name: "PROSPECTOR",
    role: "Economy and shop manipulator",
    pros: ["+40% Salvage Yield", "+50% Flux Magnet", "+1 Free Reroll each break"],
    cons: ["-10% Armor Plating"],
    color: "#e7b25c",
    mods: { greed: 0.4, magnet: 1.5, freeRerolls: 1, armor: -0.1 },
  },
  siphon: {
    name: "BIO-SIPHON",
    role: "Aggressive self-healing leech",
    pros: ["+5% Life Siphon", "+10% Combustion"],
    cons: ["No Nano-Regen", "-15% Ammo Capacity"],
    color: "#d6204f",
    mods: { steal: 0.05, boom: 0.1, noRegen: true, ammoMul: -0.15 },
  },
};
