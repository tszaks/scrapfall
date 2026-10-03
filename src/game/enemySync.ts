// Compact enemy state for the host -> guest snapshot: 4 integers per enemy
// (PeerJS binarypack sends integers under 65536 in 3 bytes, fractional numbers in 9).
// [kind | flags << 5 | heading7 << 9, x*100, z*100, swing*100 or vis]
// flags: 1 alive, 2 hit flash, 4 elite champion, 8 leaping (the leaper's jump pose)
// kinds from `visFrom` on (the newer types) never swing, so their 4th integer carries
// their visual state instead (telegraphs, lasers, shields, cloak; see enemyKinds.ts).

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
  vis?: number;
};

const TAU = Math.PI * 2;

export function packEnemy(e: Packable, kinds: readonly string[], visFrom = 9): [number, number, number, number] {
  const kind = Math.max(0, kinds.indexOf(e.kind));
  if (!e.alive) return [kind, Math.round(e.x * 100), Math.round(e.z * 100), 0];
  const leaping = (e.aux ?? 0) > 0 && e.kind === "special";
  const flags = 1 | (e.flash > 0 ? 2 : 0) | (e.elite ? 4 : 0) | (leaping ? 8 : 0);
  const yaw = (((e.yaw ?? 0) % TAU) + TAU) % TAU;
  const h7 = Math.round((yaw / TAU) * 128) & 127;
  const last = kind >= visFrom ? (e.vis ?? 0) & 0xffff : Math.round(Math.max(0, e.swing) * 100);
  return [kind | (flags << 5) | (h7 << 9), Math.round(e.x * 100), Math.round(e.z * 100), last];
}

export function unpackEnemy<K extends string>(a: number[], o: number, kinds: readonly K[], visFrom = 9) {
  const p = a[o]!;
  const flags = (p >> 5) & 15;
  const k = p & 31;
  const last = a[o + 3]!;
  return {
    kind: kinds[k] ?? kinds[0]!,
    alive: (flags & 1) !== 0,
    flash: (flags & 2) !== 0,
    elite: (flags & 4) !== 0,
    leaping: (flags & 8) !== 0,
    yaw: (((p >> 9) & 127) / 128) * TAU,
    x: a[o + 1]! / 100,
    z: a[o + 2]! / 100,
    swing: k >= visFrom ? 0 : last / 100,
    vis: k >= visFrom ? last : 0,
  };
}
