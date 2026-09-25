export type Theme = {
  name: string;
  sky: string;
  ground: string;
  grid: [string, string];
  blocks: [string, string, string];
  wall: string;
  hemi: [string, string];
  enemy: {
    drifter: { body: string; emissive: string; eye: string };
    brute: { body: string; head: string; eye: string; club: string; clubHead: string };
    shooter: { body: string; barrel: string; eye: string };
  };
  enemyBullet: string;
  blockShape: "box" | "tree" | "crystal" | "rock";
  boss: {
    name: string;
    shape: "golem" | "yeti" | "treant" | "magma" | "mech" | "ronin" | "drake";
    body: string;
    limb: string;
    eye: string;
    weapon: string;
    glow: string;
  };
  /** Ground condition that only applies during the boss round. */
  hazard: { name: string; slip: number };
};


export const THEMES: Theme[] = [
  {
    name: "Dust Basin",
    sky: "#c9b28c",
    ground: "#8d7f63",
    grid: ["#6e6350", "#7b6f59"],
    blocks: ["#b4653f", "#9a6b4b", "#6f5945"],
    wall: "#54473a",
    hemi: ["#ffe7c4", "#5b4a34"],
    enemy: {
      drifter: { body: "#c9452f", emissive: "#3d0e06", eye: "#ffd9a0" },
      brute: { body: "#4f5a3a", head: "#3b4429", eye: "#ffcf6a", club: "#6b4a2c", clubHead: "#8a8a86" },
      shooter: { body: "#3d6f86", barrel: "#222222", eye: "#9ef0ff" },
    },
    enemyBullet: "#39d0ff",
    blockShape: "box",
    boss: { name: "DUNE COLOSSUS", shape: "golem", body: "#a9713f", limb: "#7e5230", eye: "#ffd27a", weapon: "#6b4526", glow: "#ffb34a" },
    hazard: { name: "SAND TREMORS", slip: 0.35 },
  },
  {
    name: "Frost Shelf",
    sky: "#cfe3ee",
    ground: "#e9f2f6",
    grid: ["#b9cfdc", "#cddde6"],
    blocks: ["#8fc4dc", "#a9d6e8", "#6fa6c4"],
    wall: "#5f7f95",
    hemi: ["#ffffff", "#7a93a8"],
    enemy: {
      drifter: { body: "#5a3fb8", emissive: "#140a3a", eye: "#e6fbff" },
      brute: { body: "#e8eef2", head: "#c8d4dc", eye: "#2fb6ff", club: "#7b8a96", clubHead: "#b8f0ff" },
      shooter: { body: "#1f3b5c", barrel: "#0d1a2a", eye: "#ff6b8a" },
    },
    enemyBullet: "#ff4f7a",
    blockShape: "crystal",
    boss: { name: "THE YETI", shape: "yeti", body: "#f2f8fb", limb: "#d4e4ee", eye: "#2fd8ff", weapon: "#7b8a96", glow: "#9ff0ff" },
    hazard: { name: "SLICK ICE", slip: 0.93 },
  },
  {
    name: "Mossy Woods",
    sky: "#a9c2a0",
    ground: "#4f6b3a",
    grid: ["#435c31", "#4a6436"],
    blocks: ["#2f5a2b", "#3d6b33", "#284a24"],
    wall: "#3a2e22",
    hemi: ["#f2f6d8", "#2a3a1c"],
    enemy: {
      drifter: { body: "#e0a52a", emissive: "#3a2604", eye: "#1a1208" },
      brute: { body: "#6b4a2c", head: "#523820", eye: "#c8ff5a", club: "#3b2a1a", clubHead: "#8a7a5a" },
      shooter: { body: "#8a2f5a", barrel: "#2a1020", eye: "#fff27a" },
    },
    enemyBullet: "#d4ff3a",
    blockShape: "tree",
    boss: { name: "ANCIENT TREANT", shape: "treant", body: "#4a3a22", limb: "#35291a", eye: "#c8ff5a", weapon: "#2f5a2b", glow: "#b6ff6a" },
    hazard: { name: "TANGLED ROOTS", slip: 0.22 },
  },
  {
    name: "Ash Crater",
    sky: "#8a7a72",
    ground: "#3f3634",
    grid: ["#2e2725", "#362e2c"],
    blocks: ["#5a4a44", "#4a3c38", "#6b3a2a"],
    wall: "#241d1b",
    hemi: ["#ffd2b0", "#3a1a10"],
    enemy: {
      drifter: { body: "#ff7a2a", emissive: "#5a1a00", eye: "#fff2c0" },
      brute: { body: "#2a2422", head: "#1a1614", eye: "#ff5a1a", club: "#3a2a22", clubHead: "#c24a1a" },
      shooter: { body: "#7a2a1a", barrel: "#1a0e0a", eye: "#ffe04a" },
    },
    enemyBullet: "#ffb02a",
    blockShape: "rock",
    boss: { name: "MAGMA DREADNOUGHT", shape: "magma", body: "#2a211f", limb: "#3d2b25", eye: "#ff5a1a", weapon: "#c24a1a", glow: "#ff8c2a" },
    hazard: { name: "ASH SLIDE", slip: 0.5 },
  },
  {
    name: "Canyon Mesa",
    sky: "#e8b98a",
    ground: "#c07a4a",
    grid: ["#a86a3e", "#b47244"],
    blocks: ["#d08a54", "#b86a3a", "#9a5530"],
    wall: "#6a3a20",
    hemi: ["#fff0d8", "#6a3a20"],
    enemy: {
      drifter: { body: "#2a8a8a", emissive: "#062a2a", eye: "#fff6d0" },
      brute: { body: "#5a3a5a", head: "#442a44", eye: "#ffd24a", club: "#3a2418", clubHead: "#d8c8a8" },
      shooter: { body: "#e8e0c8", barrel: "#3a2a1a", eye: "#e0462a" },
    },
    enemyBullet: "#1ad0c0",
    blockShape: "box",
    boss: { name: "BRASS AUTOMATON", shape: "mech", body: "#c9a04a", limb: "#8a6a2a", eye: "#e0462a", weapon: "#5a4a2a", glow: "#ffd76a" },
    hazard: { name: "CANYON GALE", slip: 0.45 },
  },
  {
    name: "Cherry Grove",
    sky: "#f2d6dc",
    ground: "#8fae6a",
    grid: ["#7f9e5c", "#88a664"],
    blocks: ["#f0a0b8", "#e888a8", "#f6c0d0"],
    wall: "#6a4a3a",
    hemi: ["#fff4f6", "#5a6a3a"],
    enemy: {
      drifter: { body: "#4a4a8a", emissive: "#10103a", eye: "#fff0f4" },
      brute: { body: "#3a5a4a", head: "#2a4438", eye: "#ff8ab0", club: "#5a3a2a", clubHead: "#b8b0a0" },
      shooter: { body: "#c83a4a", barrel: "#2a1014", eye: "#fff6a0" },
    },
    enemyBullet: "#9a4aff",
    blockShape: "tree",
    boss: { name: "BLOSSOM RONIN", shape: "ronin", body: "#b03a5a", limb: "#6a2438", eye: "#fff0a0", weapon: "#e8e0e4", glow: "#ff9ac0" },
    hazard: { name: "PETAL CYCLONE", slip: 0.4 },
  },
  {
    name: "Glacier Rift",
    sky: "#9fb8d0",
    ground: "#c8d8e6",
    grid: ["#aabdd0", "#b8cadb"],
    blocks: ["#e6f4ff", "#b0d0ec", "#8ab0d8"],
    wall: "#3f5a78",
    hemi: ["#f0f8ff", "#4a5a7a"],
    enemy: {
      drifter: { body: "#c82a4a", emissive: "#3a0612", eye: "#ffffff" },
      brute: { body: "#3a4a6a", head: "#2a3854", eye: "#aaffea", club: "#5a6a7a", clubHead: "#e0f0ff" },
      shooter: { body: "#e0a02a", barrel: "#3a2a0a", eye: "#2a3a6a" },
    },
    enemyBullet: "#ff3a6a",
    blockShape: "rock",
    boss: { name: "FROST DRAKE", shape: "drake", body: "#7fb6dc", limb: "#4a6f96", eye: "#eaffff", weapon: "#d8f2ff", glow: "#7fe8ff" },
    hazard: { name: "PERMAFROST", slip: 0.95 },
