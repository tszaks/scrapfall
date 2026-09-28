import * as THREE from "three";
export type Route = { pts: { x: number; z: number }[]; length: number; closed: boolean };
export type RoutePose = { x: number; z: number; yaw: number };
/** Arc-length table: no spline allocation or iterative distance lookup in the frame loop. */
export function makeRoute(points: readonly (readonly [number, number])[], closed = false): Route {
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(p[0], 0, p[1])),
    closed,
    "centripetal",
  );
  const length = curve.getLength(),
    n = Math.ceil(length / 0.6),
    pts = curve.getSpacedPoints(n).map((p) => ({ x: p.x, z: p.z }));
  return { pts, length, closed };
}
export function routePose(route: Route, distance: number, out: RoutePose) {
  const u = route.closed
    ? (((distance % route.length) + route.length) % route.length) / route.length
    : Math.max(0, Math.min(1, distance / route.length));
  const f = u * (route.pts.length - 1),
    i = Math.min(route.pts.length - 2, Math.floor(f)),
    t = f - i;
  const a = route.pts[i]!,
    b = route.pts[i + 1]!;
  out.x = a.x + (b.x - a.x) * t;
  out.z = a.z + (b.z - a.z) * t;
  out.yaw = Math.atan2(b.x - a.x, b.z - a.z);
  return out;
}
export function snowRoad() {
  // The covered creek bridge is single lane: village service traffic turns before it.
  return makeRoute(
    [
      [-88, 28.1],
      [-60, 28.1],
      [80, 28.1],
      [152, 28.1],
      [220, 33.7],
      [240, 35.8],
      [244, 38.7],
      [240, 41.1],
      [220, 38.5],
      [152, 31.9],
      [80, 31.9],
      [-60, 31.9],
      [-88, 31.9],
      [-91, 30],
    ],
    true,
  );
}

/** Keep sporting actors on the piste, clear of lodge decks, barriers and tree trunks. The
 * mountain is intentionally closed to walking; use actual objects, not the player nav mask. */
export function skiRoutes(
  layout: import("../alpine/layout").AlpineLayout,
  height: (x: number, z: number) => number,
) {
  const paths = layout.alpine.paths.filter(
    (p) =>
      p.kind === "piste" &&
      !p.coop &&
      p.pts.every(
        (p) =>
          Math.abs(p[0]) < (layout.alpine.soloHalf ?? layout.half) - 5 &&
          Math.abs(p[1]) < (layout.alpine.soloHalf ?? layout.half) - 5,
      ),
  );
  const out: Route[] = [];
  for (const path of paths) {
    const route = makeRoute(path.pts);
    let start = 0,
      best0 = 0,
      best1 = 0;
    for (let i = 0; i <= route.pts.length; i++) {
      const p = route.pts[i],
        next = route.pts[Math.min(i + 1, route.pts.length - 1)];
      const yaw = p && next ? Math.atan2(next.x - p.x, next.z - p.z) : 0;
      let clear = !!p;
      if (p)
        for (const lateral of [-2.6, -1.3, 0, 1.3, 2.6]) {
          const x = p.x + Math.cos(yaw) * lateral,
            z = p.z - Math.sin(yaw) * lateral;
          if (layout.alpine.terrain.shot?.(x, height(x, z) + 0.35, z)) clear = false;
        }
      if (!clear) {
        if (i - start > best1 - best0) {
          best0 = start;
          best1 = i;
        }
        start = i + 1;
      }
    }
    if (best1 - best0 < 85) continue;
    const pts = route.pts.slice(best0 + 2, best1 - 2),
      length = ((pts.length - 1) * route.length) / (route.pts.length - 1);
    out.push({ pts, length, closed: false });
  }
  return out;
}
