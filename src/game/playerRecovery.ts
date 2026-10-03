/** The pause menu requests recovery; the world owns the actual safe placement. */
export const playerRecovery = { requested: false, last: -Infinity };
export function requestRecovery() {
  playerRecovery.requested = true;
}
