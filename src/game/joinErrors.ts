// Why a co-op join failed, in words a player can act on. net.ts tags each failure
// with a `type` (PeerJS errors already carry one); Game.tsx shows the message.

/** The room exists but no connection opened in time: usually NATs with no relay. */
export const CONNECT_TIMEOUT = "connect-timeout";

export function joinFailure(type: string, message: string): Error & { type: string } {
  return Object.assign(new Error(message), { type });
}

export function joinFailureMessage(e: unknown): string {
  const type = (e as { type?: unknown } | null)?.type;
  // the signalling server knows no host with that id
  if (type === "peer-unavailable") return "No arena found with that code.";
  if (type === CONNECT_TIMEOUT)
    return "Found the arena but couldn't connect. Try again, or try another network.";
  // the PeerJS signalling server itself was unreachable or refused us
  if (type === "network" || type === "server-error" || type === "socket-error")
    return "Couldn't reach the co-op server. Check your connection and try again.";
  if (type === "browser-incompatible") return "This browser can't do co-op. Try Chrome or Safari.";
  return "Couldn't join that arena. Try again.";
}
