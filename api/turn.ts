/// <reference types="node" />
// Vercel Function: mints short-lived Cloudflare Realtime TURN credentials for co-op.
// Served at /api/turn and, through the vercel.json rewrite, at /game/api/turn, which is
// the path szakacsmedia.com/game/* proxies here. Players on different networks often
// cannot reach each other directly; a TURN server relays their traffic instead.
// The key id and token stay server-side; never log them.

/** Credentials outlive any match; the client re-fetches well before they expire. */
const TTL_S = 86400;
const UPSTREAM_TIMEOUT_MS = 2500;

export type TurnEnv = {
  CLOUDFLARE_TURN_KEY_ID?: string | undefined;
  CLOUDFLARE_TURN_API_TOKEN?: string | undefined;
};

type IceServer = { urls: string | string[]; username?: string; credential?: string };

/** Cloudflare also offers port 53, which browsers block (the URL just times out). */
const usable = (url: string) => !/:53(\?|$)/.test(url);

/** Keep well-formed entries only, minus the port-53 URLs. */
export function cleanIceServers(raw: unknown): IceServer[] {
  if (!Array.isArray(raw)) return [];
  const out: IceServer[] = [];
  for (const s of raw) {
    if (!s || typeof s !== "object") continue;
    const e = s as Record<string, unknown>;
    const list = (Array.isArray(e["urls"]) ? e["urls"] : [e["urls"]]).filter(
      (u): u is string => typeof u === "string" && usable(u),
    );
    if (!list.length) continue;
    const server: IceServer = { urls: list };
    if (typeof e["username"] === "string") server.username = e["username"];
    if (typeof e["credential"] === "string") server.credential = e["credential"];
    out.push(server);
  }
  return out;
}

/** The whole job, minus the HTTP plumbing (so it can be tested with a fake fetch). */
export async function mintIceServers(
  env: TurnEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const id = env.CLOUDFLARE_TURN_KEY_ID?.trim();
  const token = env.CLOUDFLARE_TURN_API_TOKEN?.trim();
  if (!id || !token) return { status: 503, body: { error: "turn-not-configured" } };
  try {
    const res = await fetchImpl(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(id)}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl: TTL_S }),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      },
    );
    if (!res.ok) {
      console.error(`[turn] Cloudflare answered ${res.status}`);
      return { status: 502, body: { error: "turn-upstream" } };
    }
    const iceServers = cleanIceServers(((await res.json()) as { iceServers?: unknown }).iceServers);
    if (!iceServers.length) {
      console.error("[turn] Cloudflare returned no usable ICE servers");
      return { status: 502, body: { error: "turn-upstream" } };
    }
    return { status: 200, body: { iceServers, ttl: TTL_S } };
  } catch (e) {
    console.error(`[turn] Cloudflare request failed: ${(e as Error)?.name ?? "error"}`);
    return { status: 502, body: { error: "turn-upstream" } };
  }
}

export const config = { maxDuration: 10 };

export async function POST(): Promise<Response> {
  const { status, body } = await mintIceServers(process.env);
  return new Response(JSON.stringify(body), {
    status,
    // credentials are per-request: never let a CDN or browser cache hand them to someone else
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
