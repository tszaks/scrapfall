// Blending two authored look tables key by key (numbers, hex colours, tuples, nested
// objects): how a map's night / sunset tables become any point of the dusk in between.
import * as THREE from "three";

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** blend any two tables of numbers / hex colours / tuples key by key (map look tables) */
export function blendTable<T extends Record<string, unknown>>(a: T, b: T, k: number): T {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(a)) {
    out[key] = blendValue(a[key], b[key], k);
  }
  return out as T;
}
function blendValue(a: unknown, b: unknown, k: number): unknown {
  if (typeof a === "number" && typeof b === "number") return lerp(a, b, k);
  if (typeof a === "string" && typeof b === "string" && a.startsWith("#") && b.startsWith("#"))
    return "#" + new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString();
  if (Array.isArray(a) && Array.isArray(b)) return a.map((v, i) => blendValue(v, b[i], k));
  if (a && b && typeof a === "object" && typeof b === "object")
    return blendTable(a as Record<string, unknown>, b as Record<string, unknown>, k);
  return k < 0.5 ? a : b;
}

