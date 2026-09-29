import type { AccessBuilding } from "./layout";
import { IGeo, type BakeLight } from "./geo";
import { spiralPoint, TAU } from "./spiral";

/** Baked geometry, shared across clients. The treads follow the same annular path as physics. */
export function buildSpiral(b: AccessBuilding, G: IGeo, P: IGeo, glow: IGeo) {
  const s = b.stair!, sp = s.spiral!;
  const w = s.W / 2, gy = b.groundY, top = b.top;
  const front = s.v0 + s.Ls, end = sp.centerD + sp.outer;
  const ceil = b.room ? top : top + 2.9;
  const q = b.portals[1];
  const rustic = b.spec.doorStyle === "wood";
  const lights: BakeLight[] = [];
  G.color(rustic ? "#b2a48e" : "#d1c8b6");
  G.wallA(s.v0, end, gy, ceil, -w, true, .9);
  G.wallA(.25, s.v0, gy, gy + 2.7, -w, true, .9);
  G.wallA(.25, s.v0, gy, gy + 2.7, w, false, .9);
  G.wallA(s.v0, end, gy, top, w, false, .9);
  G.wallA(s.v0, q.d - q.half, top, ceil, w, false, .9);
  G.wallA(q.d + q.half, end, top, ceil, w, false, .9);
  if (ceil > top + 2.3) G.wallA(q.d - q.half, q.d + q.half, top + 2.3, ceil, w, false);
  G.wallD(-w, w, gy, ceil, end, false, .9);
  const doorH = b.spec.doorH ?? 2.45, hw = b.portals[0].half;
  G.wallD(-w, -hw, gy, gy + doorH, .25, true);
  G.wallD(hw, w, gy, gy + doorH, .25, true);
  G.wallD(-w, w, gy + doorH, ceil, s.v0, true, .8);
  G.wallA(0, .25, gy, gy + doorH, -hw, true);
  G.wallA(0, .25, gy, gy + doorH, hw, false);
  G.flat(-hw, hw, 0, .25, gy, true);
  G.flat(-w, w, .25, s.v0, gy + doorH + .15, false);
  if (!b.room) G.flat(-w, w, s.v0, end, ceil, false, .9);
  P.color(rustic ? "#4b3528" : "#635342");
  P.cyl(0, sp.centerD, gy, top - gy + 1.05, sp.inner, 20);
  const pt = (t: number, r: number, y: number) => {
    const [a, d] = spiralPoint(sp, t, r); return [a, y, d];
  };
  const slab = (t0: number, t1: number, y: number, thick: number, landing = false) => {
    const a = pt(t0, sp.inner, y), c = pt(t1, sp.outer, y);
    const b0 = pt(t0, sp.outer, y), d = pt(t1, sp.inner, y);
    if (landing) for (const p of [a,b0,c,d]) p[2] = Math.max(front, p[2]!);
    G.quad(a, b0, c, d); // radial clockwise footprint has upward normal
    const lo = (p: number[]) => [p[0]!, p[1]! - thick, p[2]!];
    G.quad(lo(d), lo(c), lo(b0), lo(a));
    G.quad(lo(a), lo(b0), b0, a);
    G.quad(lo(c), lo(d), d, c);
    G.quad(lo(b0), lo(c), c, b0);
  };
  const rail = (t0: number, t1: number, y0: number, y1: number, r: number) => {
    const [a0, d0] = spiralPoint(sp, t0, r), [a1, d1] = spiralPoint(sp, t1, r);
    const dx = a1 - a0, dz = d1 - d0, l = Math.hypot(dx, dz) || 1;
    const x = -dz / l * .035, z = dx / l * .035;
    P.quad([a0+x,y0-.035,d0+z],[a1+x,y1-.035,d1+z],[a1+x,y1+.035,d1+z],[a0+x,y0+.035,d0+z]);
    P.quad([a1-x,y1-.035,d1-z],[a0-x,y0-.035,d0-z],[a0-x,y0+.035,d0-z],[a1-x,y1+.035,d1-z]);
    P.quad([a0-x,y0+.035,d0-z],[a0+x,y0+.035,d0+z],[a1+x,y1+.035,d1+z],[a1-x,y1+.035,d1-z]);
  };
  for (let lap = 0; lap <= s.laps; lap++) {
    const y = gy + lap * s.h;
    G.color(rustic ? "#a58a65" : "#c6b99e");
    G.box(-w, w, y - .17, y, lap ? s.v0 : .25, front, "", .7);
    // Flat sector joins the end of one turn to the start of the next.
    for (let k = 0; k < 12; k++) slab(-sp.gap + k * sp.gap / 6, -sp.gap + (k+1)*sp.gap/6, y, .17, true);
    const ly = y + 2.05;
    if (ly < ceil) {
      P.color("#39332b"); P.box(-w, -w+.09, ly-.08, ly+.28, s.v0+.6, s.v0+.95);
      glow.color("#ffe0a7"); glow.box(-w+.09,-w+.12,ly,ly+.2,s.v0+.63,s.v0+.92);
      lights.push({a:-w+.4,y:ly,d:s.v0+.8,r:3.3,k:1.35,col:"#ffdfa9"});
    }
    if (lap === s.laps) break;
    const da = (TAU - 2 * sp.gap) / s.steps, rise = s.h / s.steps;
    for (let k=0;k<s.steps;k++) {
      const t0=sp.gap+k*da,t1=t0+da, y0=y+k*rise, y1=y0+rise;
      G.color(rustic ? (k%2 ? "#9f8461":"#ad9270") : "#c6b99e"); slab(t0,t1,y1,rise+.12);
      P.color(rustic?"#553b27":"#b09455");
      rail(t0,t1,y0+.95,y1+.95,sp.outer-.06);
      if (k%2===0) {
        const [a,d]=spiralPoint(sp,t0,sp.outer-.06);
        P.box(a-.025,a+.025,y0,y0+.95,d-.025,d+.025);
      }
    }
  }
  // Guard the two missing flights. The central column and outer rail enclose the void.
  P.color(rustic?"#553b27":"#b09455");
  for (const [angle,y] of [[TAU-sp.gap,gy],[sp.gap,top]]) {
    const [a0,d0]=spiralPoint(sp,angle!,sp.inner),[a1,d1]=spiralPoint(sp,angle!,sp.outer);
    P.quad([a0,y!+.9,d0],[a1,y!+.9,d1],[a1,y!+1,d1],[a0,y!+1,d0]);
    P.quad([a1,y!+.9,d1],[a0,y!+.9,d0],[a0,y!+1,d0],[a1,y!+1,d1]);
    for(let k=0;k<=4;k++) { const a=a0+(a1-a0)*k/4,d=d0+(d1-d0)*k/4;P.box(a-.025,a+.025,y!,y!+.95,d-.025,d+.025); }
  }
  G.bake(lights,.27); P.bake(lights,.3);
}
