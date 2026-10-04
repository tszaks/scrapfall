import { useLayoutEffect } from "react";
import type { BufferGeometry } from "three";
import { quality, useQuality } from "../quality";

// Shared uniform reads the current tier when Three uploads it. Both AUTO and manual
// changes take effect without replacing materials or recompiling a map mid-fight.
export const surfaceDetail = {
  get value() {
    return quality().tier !== "low";
  },
};

// Keep all vertex attributes and collision exclusions stable. Optional decorative
// triangles go at the end of one index buffer, so LOW submits fewer triangles with
// no new draw calls, buffers, map rebuild, or instance-colour replacement.
export function prepareDetailGeometry(geometry: BufferGeometry, optional: [number, number][]) {
  if (!optional.length) return;
  const count = geometry.getAttribute("position").count;
  const high = new Uint8Array(count);
  for (const [start, length] of optional) high.fill(1, start, start + length);
  const base: number[] = [],
    extra: number[] = [];
  for (let i = 0; i < count; i++) (high[i] ? extra : base).push(i);
  geometry.setIndex(base.concat(extra));
  geometry.userData["detailCounts"] = { low: base.length, high: count };
  setGeometryDetail(geometry, quality().tier === "low");
}

export function setGeometryDetail(geometry: BufferGeometry, low: boolean) {
  const counts = geometry.userData["detailCounts"];
  if (counts) geometry.setDrawRange(0, low ? counts.low : counts.high);
}

export function useGeometryDetail(geometries: (BufferGeometry | null | undefined)[]) {
  const { tier } = useQuality();
  useLayoutEffect(() => {
    for (const geometry of geometries) if (geometry) setGeometryDetail(geometry, tier === "low");
  }, [geometries, tier]);
}
