import type { Bld } from "../cityLayout";
import type { Vehicle } from "../vehicles";
import { box, slab, type Structure, type Rect } from "./plan";

/** All visible decks and columns share these exact solids, floors and stair openings. */
export function openBuilding(b: Bld): Structure {
  const r = b.parts[0]!,
    frame = b.t === "construction",
    floorH = frame ? 4 : 3.1;
  const levels = frame ? Math.floor((r.h / 4) * 0.72) : Math.round(r.h / 3.1);
  const p: Structure = {
    id: `vice-${frame ? "frame" : "garage"}-${r.x0}-${r.z0}`,
    bounds: { x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1 },
    base: 0,
    top: frame ? r.h + 4 : r.h + 1.2,
    kind: frame ? "frame" : "garage",
    floors: [],
    stairs: [],
    solids: [],
    decor: [],
    doors: [],
    cars: [],
  };
  const w = r.x1 - r.x0,
    d = r.z1 - r.z0,
    run = Math.min(d - 6, floorH * 2.2),
    width = 2.4;
  slab(p, p.bounds, 0, 0);
  for (let f = 1; f <= levels; f++) {
    const x0 = f % 2 ? r.x0 + 1.25 : r.x1 - 1.25 - width;
    const s = {
      x0,
      x1: x0 + width,
      z0: r.z0 + 3,
      z1: r.z0 + 3 + run,
      axis: "z" as const,
      reverse: false,
      y0: (f - 1) * floorH,
      y1: f * floorH,
      level: f,
    };
    p.stairs.push(s);
    slab(p, p.bounds, f * floorH, f, {
      x0: x0 - 0.08,
      x1: x0 + width + 0.08,
      z0: s.z0 - 0.15,
      z1: s.z1,
    });
    const side = f % 2 ? x0 + width + 0.12 : x0 - 0.12;
    box(
      p,
      { x0: side - 0.04, x1: side + 0.04, z0: s.z0, z1: s.z1 - 0.2 },
      f * floorH + 0.98,
      f * floorH + 1.06,
      "#d2b258",
    );
    for (let z = s.z0; z < s.z1 - 0.2; z += 0.8)
      box(
        p,
        { x0: side - 0.035, x1: side + 0.035, z0: z - 0.035, z1: z + 0.035 },
        f * floorH,
        f * floorH + 1.02,
        "#6e7378",
      );
    box(
      p,
      { x0: x0 - 0.08, x1: x0 + width + 0.08, z0: s.z0 - 0.23, z1: s.z0 - 0.15 },
      f * floorH,
      f * floorH + 1.06,
      "#70757a",
    );
    // Continuous perimeter guards keep the open decks safe without closing their views.
    for (const edge of [
      { x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z0 + 0.18 },
      { x0: r.x0, x1: r.x1, z0: r.z1 - 0.18, z1: r.z1 },
      { x0: r.x0, x1: r.x0 + 0.18, z0: r.z0, z1: r.z1 },
      { x0: r.x1 - 0.18, x1: r.x1, z0: r.z0, z1: r.z1 },
    ]) {
      box(p, edge, f * floorH, f * floorH + 0.62, frame ? "#cb6b36" : "#85878a");
      box(p, edge, f * floorH + 0.98, f * floorH + 1.07, "#b8b8ae");
    }
  }
  // The corner grid leaves both stair lanes between the perimeter and the next column row.
  const nx = Math.max(1, Math.round(w / 8)),
    nz = Math.max(1, Math.round(d / 8));
  for (let i = 0; i <= nx; i++)
    for (let j = 0; j <= nz; j++) {
      const x = r.x0 + 0.5 + ((w - 1) * i) / nx,
        z = r.z0 + 0.5 + ((d - 1) * j) / nz;
      if (
        p.stairs.some(
          (s) =>
            x + 0.35 > s.x0 - 0.5 &&
            x - 0.35 < s.x1 + 0.5 &&
            z + 0.35 > s.z0 - 0.5 &&
            z - 0.35 < s.z1 + 0.5,
        )
      )
        continue;
      box(
        p,
        { x0: x - 0.35, x1: x + 0.35, z0: z - 0.35, z1: z + 0.35 },
        0,
        frame ? r.h : r.h,
        "#a7a59e",
      );
    }
  if (frame) {
    const cw = Math.min(10, w * 0.3),
      cx = (r.x0 + r.x1) / 2,
      cz = (r.z0 + r.z1) / 2;
    box(
      p,
      { x0: cx - cw / 2, x1: cx + cw / 2, z0: cz - cw / 2, z1: cz + cw / 2 },
      0,
      r.h + 4,
      "#9c9a95",
    );
  } else
    for (let f = 0; f <= levels; f++)
      for (const side of [-1, 1]) {
        const x = (r.x0 + r.x1) / 2 + side * Math.min(5, w * 0.15),
          z = r.z1 - 4,
          y = f * floorH;
        const v: Vehicle = {
          type: "sedan",
          len: 4.4,
          wid: 1.8,
          wheel: 0.33,
          color: [0xced4d9, 0x363f45, 0xb8543d, 0x668377][(f + (side + 1) / 2) % 4]!,
          extras: 0,
          mass: 1,
        };
        p.cars!.push({ x, z, y, rot: Math.PI / 2, v });
        const body = box(
          p,
          { x0: x - 2.2, x1: x + 2.2, z0: z - 0.9, z1: z + 0.9 },
          y + 0.15,
          y + 1.5,
          "#888888",
        );
        body.hidden = true;
      }
  // Mark a real bay between columns, not a column that happens to sit at the midpoint.
  const bayX = r.x0 + 0.5 + ((w - 1) * (Math.floor((nx - 1) / 2) + 0.5)) / nx;
  const bayZ = r.z0 + 0.5 + ((d - 1) * (Math.floor((nz - 1) / 2) + 0.5)) / nz;
  p.doors.push(
    { x: bayX, z: r.z0, facing: 0 },
    { x: bayX, z: r.z1, facing: 2 },
    { x: r.x0, z: bayZ, facing: 3 },
    { x: r.x1, z: bayZ, facing: 1 },
  );
  return p;
}

/** Open arcades and porticoes keep only their actual masonry and visible columns solid. */
export function colonnade(b: Bld): Structure | null {
  const r = b.parts[0]!;
  const recessed =
    b.t === "mid" &&
    b.parts.length === 2 &&
    r.role === "body" &&
    b.parts[1]!.role === "body" &&
    b.parts[1]!.y0 > 0 &&
    (b.parts[1]!.x0 < r.x0 ||
      b.parts[1]!.x1 > r.x1 ||
      b.parts[1]!.z0 < r.z0 ||
      b.parts[1]!.z1 > r.z1);
  if (b.t !== "convention" && b.t !== "civic" && !recessed) return null;
  const bounds = { x0: r.x0 - 5, x1: r.x1 + 5, z0: r.z0 - 5, z1: r.z1 + 5 };
  const p: Structure = {
    id: `vice-colonnade-${b.x0}-${b.z0}`,
    bounds,
    base: 0,
    top: b.h + 1.2,
    kind: "colonnade",
    floors: [],
    stairs: [],
    solids: [],
    decor: [],
    doors: [],
  };
  slab(p, bounds, 0, 0);
  for (const v of p.solids) v.hidden = true;
  const hidden = (q: Rect, y0: number, y1: number) => {
    const v = box(p, q, y0, y1, "#cccccc");
    v.hidden = true;
  };
  for (const part of b.parts) hidden(part, part.y0, part.y0 + part.h);
  if (b.t === "convention") {
    hidden(bounds, r.h, r.h + 1.2);
    for (let x = r.x0 - 4; x <= r.x1 + 4; x += 12)
      for (const z of [r.z0 - 4, r.z1 + 4])
        hidden({ x0: x - 0.45, x1: x + 0.45, z0: z - 0.45, z1: z + 0.45 }, 0, r.h);
  }
  if (b.t === "civic") {
    const nx = b.front === 1 ? 1 : b.front === 3 ? -1 : 0,
      nz = b.front === 2 ? 1 : b.front === 0 ? -1 : 0,
      cx = (r.x0 + r.x1) / 2,
      cz = (r.z0 + r.z1) / 2;
    const fx = nx > 0 ? r.x1 : nx < 0 ? r.x0 : cx,
      fz = nz > 0 ? r.z1 : nz < 0 ? r.z0 : cz,
      span = (nz ? r.x1 - r.x0 : r.z1 - r.z0) * 0.6;
    const local = (u0: number, v0: number, u1: number, v1: number): Rect => ({
      x0: Math.min(fx + nx * v0 + (nz ? u0 : 0), fx + nx * v1 + (nz ? u1 : 0)),
      x1: Math.max(fx + nx * v0 + (nz ? u0 : 0), fx + nx * v1 + (nz ? u1 : 0)),
      z0: Math.min(fz + nz * v0 + (nx ? u0 : 0), fz + nz * v1 + (nx ? u1 : 0)),
      z1: Math.max(fz + nz * v0 + (nx ? u0 : 0), fz + nz * v1 + (nx ? u1 : 0)),
    });
    for (let j = 0; j < 3; j++)
      slab(p, local(-span / 2 - 1, 0, span / 2 + 1, 4.6 - j * 0.6), (j + 1) * 0.3, 0);
    // Fill the stone risers; thin collision surfaces above already prevent entering below them.
    for (const f of p.floors.slice(1)) box(p, f, 0, f.y - 0.18, "#b3a58e", false);
    for (let k = 0; k < 6; k++) {
      const t = -span / 2 + (k / 5) * span;
      hidden(local(t - 0.55, 2.8 - 0.55, t + 0.55, 2.8 + 0.55), 0.9, 13.4);
    }
    hidden(local(-span / 2 - 0.8, -0.2, span / 2 + 0.8, 4.6), 13.4, 15);
  }
  if (recessed) {
    const q = b.parts[1]!;
    p.bounds = {
      x0: Math.min(r.x0, q.x0),
      x1: Math.max(r.x1, q.x1),
      z0: Math.min(r.z0, q.z0),
      z1: Math.max(r.z1, q.z1),
    };
    p.floors[0] = { ...p.bounds, y: 0, holes: [], level: 0 };
  }
  return p;
}
