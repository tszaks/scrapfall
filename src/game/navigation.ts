// A coarse cell can be partly open while a fence cuts its connection to the next
// cell. Store walkable edges once; moving targets reuse them when fields rebuild.
import { blocked, type Block, type NavGrid } from "./level";
import { climbable } from "./terrain";

export const NAV_DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

export function navigationLine(
  blocks: Block[],
  ax: number,
  az: number,
  bx: number,
  bz: number,
  r: number,
) {
  const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.4));
  let x = ax,
    z = az;
  for (let i = 1; i <= steps; i++) {
    const nx = ax + ((bx - ax) * i) / steps,
      nz = az + ((bz - az) * i) / steps;
    if (blocked(blocks, nx, nz, r) || !climbable(x, z, nx, nz)) return false;
    x = nx;
    z = nz;
  }
  return true;
}

/** Base walker clearance; bigger bodies validate their live local route separately. */
export function connectNavigation(nav: NavGrid, blocks: Block[], radius = 0.6) {
  const { n, g, px, pz } = nav;
  const links = new Uint8Array(n * n);
  for (let k = 0; k < g.length; k++) if (!g[k] && blocked(blocks, px[k]!, pz[k]!, radius)) g[k] = 1;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const k = i * n + j;
      if (g[k]) continue;
      for (let d = 0; d < NAV_DIRS.length; d++) {
        const [di, dj] = NAV_DIRS[d]!;
        const ni = i + di,
          nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
        const nk = ni * n + nj;
        if (g[nk] || (di && dj && (g[ni * n + j] || g[i * n + nj]))) continue;
        if (navigationLine(blocks, px[k]!, pz[k]!, px[nk]!, pz[nk]!, radius))
          links[k] = links[k]! | (1 << d);
      }
    }
  nav.links = links;
  return nav;
}
