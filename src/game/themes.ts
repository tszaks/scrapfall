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
  blockShape: "box" | "tree" | "crystal";
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
  },
];
