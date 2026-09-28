// A match owns one environment. The shared map seed selects it once for every peer.
export const ENVIRONMENTS = ["sunny", "rain", "night", "sunset"] as const;
export type MatchEnvironment = (typeof ENVIRONMENTS)[number];
export const matchEnvironment = {
  kind: "sunset" as MatchEnvironment,
  version: 0,
  allowOverrides: false,
};
export function configureEnvironment(seed: number, allowOverride = false) {
  let h = Math.imul(seed ^ 0x6a09e667, 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  let kind = ENVIRONMENTS[((h ^ (h >>> 16)) >>> 0) % ENVIRONMENTS.length]!;
  if (allowOverride && typeof window !== "undefined") {
    const q = new URLSearchParams(window.location.search);
    const requested = q.get("weather") ?? q.get("time");
    if (ENVIRONMENTS.includes(requested as MatchEnvironment)) kind = requested as MatchEnvironment;
  }
  matchEnvironment.allowOverrides = allowOverride;
  matchEnvironment.kind = kind;
  matchEnvironment.version++;
}
export const rainyMatch = () => matchEnvironment.kind === "rain";
