// ICE servers for co-op: how two browsers find a path to each other.
// STUN lets peers on friendly networks connect directly; TURN relays the traffic when
// NATs or firewalls block that (common between different homes or a phone hotspot).
// PeerJS's built-in TURN hosts no longer resolve, so /game/api/turn (api/turn.ts) mints
// Cloudflare TURN credentials. If that endpoint is missing or slow, co-op falls back to
// STUN only, which is exactly how it behaved before.

export const FALLBACK_ICE: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

/** Long enough for a cold function start, short enough not to stall the join button. */
const FETCH_TIMEOUT_MS = 3000;
/** Credentials last 24 h; refresh at half that so a match never starts on stale ones. */
const REUSE_MS = 12 * 60 * 60 * 1000;

/** Well-formed servers from the endpoint's JSON, or null when there are none. */
export function parseIceServers(body: unknown): RTCIceServer[] | null {
  const raw = (body as { iceServers?: unknown } | null)?.iceServers;
  if (!Array.isArray(raw)) return null;
  const out: RTCIceServer[] = [];
  for (const s of raw) {
    const urls = (s as { urls?: unknown })?.urls;
    const list = (Array.isArray(urls) ? urls : [urls]).filter((u) => typeof u === "string");
    if (!list.length) continue;
    const { username, credential } = s as { username?: unknown; credential?: unknown };
    const server: RTCIceServer = { urls: list as string[] };
    if (typeof username === "string") server.username = username;
    if (typeof credential === "string") server.credential = credential;
    out.push(server);
  }
  return out.length ? out : null;
}

/**
 * A cached loader. A success is reused for REUSE_MS; a failure falls back to
 * FALLBACK_ICE for this call only, so the next host or join tries the relay again.
 */
export function makeIceLoader(
  url: string,
  fetchImpl: typeof fetch = (...a) => fetch(...a),
  now: () => number = () => Date.now(),
  timeoutMs = FETCH_TIMEOUT_MS,
) {
  let cached: { at: number; servers: Promise<RTCIceServer[] | null> } | null = null;
  return async (): Promise<RTCIceServer[]> => {
    if (!cached || now() - cached.at > REUSE_MS) {
      const servers = (async () => {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), timeoutMs);
        try {
          const res = await fetchImpl(url, { method: "POST", signal: ctl.signal });
          return res.ok ? parseIceServers(await res.json()) : null;
        } catch {
          return null;
        } finally {
          clearTimeout(t);
        }
      })();
      cached = { at: now(), servers };
    }
    const entry = cached;
    const servers = await entry.servers;
    if (servers) return servers;
    if (cached === entry) cached = null; // don't remember the failure
    return FALLBACK_ICE;
  };
}

export const loadIceServers = makeIceLoader(`${import.meta.env?.BASE_URL ?? "/game/"}api/turn`);
