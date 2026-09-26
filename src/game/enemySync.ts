// Compact enemy state for the host -> guest snapshot: 4 integers per enemy
// (PeerJS binarypack sends small integers in ~3 bytes, fractional numbers in 9).
// [kind | flags << 4 | heading8 << 8, x*100, z*100, swing*100]
// flags: 1 alive, 2 hit flash, 4 elite champion, 8 leaping (the leaper's jump pose)

export const ENEMY_FIELDS = 4;

type Packable = {
  kind: string;
  alive: boolean;
  x: number;
  z: number;
  swing: number;
  flash: number;
  elite?: number;
  aux?: number;
  yaw?: number;
};

const TAU = Math.PI * 2;

export function packEnemy(e: Packable, kinds: readonly string[]): [number, number, number, number] {
  const kind = Math.max(0, kinds.indexOf(e.kind));
  if (!e.alive) return [kind, 0, 0, 0];
  const leaping = (e.aux ?? 0) > 0 && e.kind === "special";
  const flags = 1 | (e.flash > 0 ? 2 : 0) | (e.elite ? 4 : 0) | (leaping ? 8 : 0);
  const yaw = (((e.yaw ?? 0) % TAU) + TAU) % TAU;
  const h8 = Math.round((yaw / TAU) * 256) & 255;
  return [
    kind | (flags << 4) | (h8 << 8),
    Math.round(e.x * 100),
    Math.round(e.z * 100),
    Math.round(Math.max(0, e.swing) * 100),
  ];
}

export function unpackEnemy<K extends string>(a: number[], o: number, kinds: readonly K[]) {
  const p = a[o]!;
  const flags = (p >> 4) & 15;
  return {
    kind: kinds[p & 15] ?? kinds[0]!,
    alive: (flags & 1) !== 0,
    flash: (flags & 2) !== 0,
    elite: (flags & 4) !== 0,
    leaping: (flags & 8) !== 0,
    yaw: (((p >> 8) & 255) / 256) * TAU,
    x: a[o + 1]! / 100,
    z: a[o + 2]! / 100,
    swing: a[o + 3]! / 100,
  };
}
