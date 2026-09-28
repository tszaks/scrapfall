// Joining rebuilds the shared world synchronously. A first heartbeat can therefore
// arrive after the ordinary silence limit, especially on a slower device.
const JOIN_GRACE_MS = 15_000;

export function connectionTimedOut(
  now: number,
  heardAt: number,
  openedAt: number,
  silenceMs: number,
) {
  return now - openedAt >= JOIN_GRACE_MS && now - heardAt > silenceMs;
}
