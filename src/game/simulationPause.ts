/** Match time stops during an explicit room pause or local connection recovery.
 * Networking deliberately continues to use performance.now(). */
export const simulationPause = { paused: false, revision: 0, since: 0, held: 0 };
export function setSimulationPaused(paused: boolean, now = performance.now()) {
  if (simulationPause.paused === paused) return;
  if (paused) simulationPause.since = now;
  else simulationPause.held += Math.max(0, now - simulationPause.since);
  simulationPause.paused = paused;
  simulationPause.revision++;
}
export function simulationNow(now = performance.now()) {
  return (simulationPause.paused ? simulationPause.since : now) - simulationPause.held;
}

/** Only lifecycle/handshake data may mutate a paused room. In-flight gameplay
 * commands are discarded, never queued for a burst of damage on resume. */
export const PAUSED_GUEST_MESSAGES = new Set(["hb", "world-ready", "pick", "statline"]);
export const HOST_MESSAGES = new Set([
  "pause", "resume", "pause-state", "begin", "seed", "diff", "roster", "snap", "status",
  "boss", "hurt", "kill", "over", "ot", "mut", "event", "pst", "revived", "bleed",
  "hazset", "shard-award", "vehicle-explosion", "flare-fx", "members", "handoff",
  "authority", "reconnecting", "reconnected", "joined", "left", "peer-heartbeat",
]);
