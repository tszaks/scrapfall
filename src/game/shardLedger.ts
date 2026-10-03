export const shardLedger = new Map<string, { value: number; x: number; z: number }>();
/** One award for one shared drop, even when two players reach it on the same frame. */
export function claimShard(id: string, taken: Set<string>) {
  const drop = shardLedger.get(id);
  if (!drop || taken.has(id)) return 0;
  taken.add(id);
  return drop.value;
}
